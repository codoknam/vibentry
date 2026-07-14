import crypto from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

const { Pool } = pg;
const scrypt = promisify(crypto.scrypt);
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const TOKEN_DAYS = 90;

export class CloudStore {
  constructor({ connectionString, secret, pool = null }) {
    this.connectionString = connectionString || "";
    this.secret = secret || "vibentry-local-development-only";
    this.pool = pool;
    this.ready = false;
  }

  async init() {
    if (!this.connectionString && !this.pool) {
      return false;
    }
    if (!this.pool) {
      const config = {
        connectionString: this.connectionString,
        max: 8,
        idleTimeoutMillis: 30_000,
      };
      if (process.env.PGSSLMODE === "require") {
        config.ssl = { rejectUnauthorized: false };
      } else if (process.env.PGSSLMODE === "disable") {
        config.ssl = false;
      }
      this.pool = new Pool(config);
    }
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS vibentry_accounts (
        id UUID PRIMARY KEY,
        sync_code VARCHAR(18) UNIQUE NOT NULL,
        pin_hash TEXT NOT NULL,
        display_name VARCHAR(40) NOT NULL,
        memory JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS vibentry_tokens (
        token_hash CHAR(64) PRIMARY KEY,
        account_id UUID NOT NULL REFERENCES vibentry_accounts(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS vibentry_tokens_account_idx ON vibentry_tokens(account_id);
      CREATE TABLE IF NOT EXISTS vibentry_sessions (
        account_id UUID NOT NULL REFERENCES vibentry_accounts(id) ON DELETE CASCADE,
        session_id VARCHAR(80) NOT NULL,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (account_id, session_id)
      );
      CREATE INDEX IF NOT EXISTS vibentry_sessions_updated_idx ON vibentry_sessions(account_id, updated_at DESC);
    `);
    this.ready = true;
    return true;
  }

  async close() {
    const pool = this.pool;
    this.ready = false;
    this.pool = null;
    if (pool && typeof pool.end === "function") {
      await pool.end();
    }
  }

  async register({ displayName, pin }) {
    this.assertReady();
    validatePin(pin);
    const id = crypto.randomUUID();
    const pinHash = await hashPin(pin, this.secret);
    const cleanName = cleanDisplayName(displayName);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const syncCode = createSyncCode();
      try {
        await this.pool.query(
          "INSERT INTO vibentry_accounts (id, sync_code, pin_hash, display_name) VALUES ($1, $2, $3, $4)",
          [id, syncCode, pinHash, cleanName]
        );
        const token = await this.issueToken(id);
        return { token, syncCode, displayName: cleanName, memory: [] };
      } catch (error) {
        if (error?.code !== "23505") {
          throw error;
        }
      }
    }
    throw new Error("동기화 코드를 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
  }

  async login({ syncCode, pin }) {
    this.assertReady();
    validatePin(pin);
    const normalized = normalizeSyncCode(syncCode);
    const result = await this.pool.query(
      "SELECT id, pin_hash, display_name, memory FROM vibentry_accounts WHERE sync_code = $1",
      [normalized]
    );
    const account = result.rows[0];
    if (!account || !(await verifyPin(pin, account.pin_hash, this.secret))) {
      return null;
    }
    const token = await this.issueToken(account.id);
    return {
      token,
      syncCode: normalized,
      displayName: account.display_name,
      memory: normalizeMemory(account.memory),
    };
  }

  async authenticate(token) {
    this.assertReady();
    if (typeof token !== "string" || token.length < 32) {
      return null;
    }
    const tokenHash = hashToken(token, this.secret);
    const result = await this.pool.query(`
      SELECT a.id, a.sync_code, a.display_name, a.memory
      FROM vibentry_tokens t
      JOIN vibentry_accounts a ON a.id = t.account_id
      WHERE t.token_hash = $1 AND t.expires_at > NOW()
    `, [tokenHash]);
    const account = result.rows[0];
    if (!account) {
      return null;
    }
    this.pool.query("UPDATE vibentry_tokens SET last_used_at = NOW() WHERE token_hash = $1", [tokenHash]).catch(() => {});
    return {
      id: account.id,
      syncCode: account.sync_code,
      displayName: account.display_name,
      memory: normalizeMemory(account.memory),
    };
  }

  async revokeToken(token) {
    this.assertReady();
    if (typeof token !== "string" || token.length < 32) {
      return;
    }
    await this.pool.query("DELETE FROM vibentry_tokens WHERE token_hash = $1", [hashToken(token, this.secret)]);
  }

  async listSessions(accountId) {
    this.assertReady();
    const result = await this.pool.query(
      "SELECT payload, updated_at FROM vibentry_sessions WHERE account_id = $1 ORDER BY updated_at DESC LIMIT 100",
      [accountId]
    );
    return result.rows.map((row) => ({
      ...row.payload,
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  async putSession(accountId, session) {
    this.assertReady();
    const safe = normalizeCloudSession(session);
    const updatedAt = new Date(safe.updatedAt);
    const result = await this.pool.query(`
      INSERT INTO vibentry_sessions (account_id, session_id, payload, updated_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (account_id, session_id) DO UPDATE
      SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
      WHERE vibentry_sessions.updated_at <= EXCLUDED.updated_at
      RETURNING updated_at
    `, [accountId, safe.id, safe, updatedAt]);
    return { saved: result.rowCount > 0, session: safe };
  }

  async updateMemory(accountId, memory) {
    this.assertReady();
    const safe = normalizeMemory(memory);
    await this.pool.query(
      "UPDATE vibentry_accounts SET memory = $2::jsonb, updated_at = NOW() WHERE id = $1",
      [accountId, JSON.stringify(safe)]
    );
    return safe;
  }

  async deleteAccount(accountId) {
    this.assertReady();
    await this.pool.query("DELETE FROM vibentry_accounts WHERE id = $1", [accountId]);
  }

  async issueToken(accountId) {
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token, this.secret);
    await this.pool.query(
      `INSERT INTO vibentry_tokens (token_hash, account_id, expires_at)
       VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 day'))`,
      [tokenHash, accountId, TOKEN_DAYS]
    );
    this.pool.query("DELETE FROM vibentry_tokens WHERE expires_at <= NOW()").catch(() => {});
    return token;
  }

  assertReady() {
    if (!this.ready || !this.pool) {
      const error = new Error("클라우드 저장소가 아직 연결되지 않았어요.");
      error.code = "CLOUD_UNAVAILABLE";
      throw error;
    }
  }
}

export function createSyncCode() {
  const bytes = crypto.randomBytes(8);
  let value = "";
  for (const byte of bytes) {
    value += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return `VIBE-${value.slice(0, 4)}-${value.slice(4)}`;
}

export function normalizeSyncCode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^VIBE[2-9A-HJ-NP-Z]{8}$/.test(compact)) {
    const error = new Error("동기화 코드는 VIBE-XXXX-XXXX 형식이어야 해요.");
    error.code = "INVALID_SYNC_CODE";
    throw error;
  }
  return `VIBE-${compact.slice(4, 8)}-${compact.slice(8)}`;
}

export function validatePin(pin) {
  if (!/^\d{6,12}$/.test(String(pin || ""))) {
    const error = new Error("PIN은 숫자 6~12자리로 입력해 주세요.");
    error.code = "INVALID_PIN";
    throw error;
  }
}

export function normalizeMemory(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim().slice(0, 500))
    .filter(Boolean)
    .filter((item) => !looksSensitive(item)))].slice(0, 30);
}

export function normalizeCloudSession(value) {
  if (!value || typeof value !== "object") {
    throw new Error("저장할 대화 형식이 올바르지 않아요.");
  }
  const id = String(value.id || "");
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) {
    throw new Error("대화 ID가 올바르지 않아요.");
  }
  const updatedAt = new Date(value.updatedAt || Date.now());
  if (!Number.isFinite(updatedAt.getTime())) {
    throw new Error("대화 저장 시간이 올바르지 않아요.");
  }
  const messages = Array.isArray(value.messages) ? value.messages.slice(-300).map(normalizeMessage) : [];
  const archiveEntries = Array.isArray(value.archiveEntries)
    ? value.archiveEntries.slice(0, 300).map(normalizeArchiveEntry).filter(Boolean)
    : [];
  return {
    id,
    title: String(value.title || "새 Entry 작품").slice(0, 80),
    createdAt: validIso(value.createdAt) || updatedAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    messages,
    project: value.project && typeof value.project === "object" ? value.project : null,
    baseProject: value.baseProject && typeof value.baseProject === "object" ? value.baseProject : null,
    interactionId: typeof value.interactionId === "string" ? value.interactionId.slice(0, 500) : null,
    memorySummary: typeof value.memorySummary === "string" ? value.memorySummary.slice(0, 4000) : "",
    archiveEntries,
  };
}

async function hashPin(pin, secret) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scrypt(`${pin}:${secret}`, salt, 64);
  return `${salt}:${Buffer.from(derived).toString("hex")}`;
}

async function verifyPin(pin, stored, secret) {
  const [salt, expectedHex] = String(stored || "").split(":");
  if (!salt || !expectedHex) {
    return false;
  }
  const actual = Buffer.from(await scrypt(`${pin}:${secret}`, salt, 64));
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function hashToken(token, secret) {
  return crypto.createHash("sha256").update(`${token}:${secret}`).digest("hex");
}

function cleanDisplayName(value) {
  const name = String(value || "사용자").trim().replace(/[<>]/g, "").slice(0, 30);
  return name || "사용자";
}

function validIso(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function normalizeMessage(value) {
  const item = value && typeof value === "object" ? value : {};
  return {
    id: String(item.id || crypto.randomUUID()).slice(0, 80),
    role: item.role === "assistant" ? "assistant" : "user",
    text: redactSecrets(String(item.text || "").slice(0, 30_000)),
    pending: item.pending === true,
    at: validIso(item.at) || new Date().toISOString(),
    files: Array.isArray(item.files) ? item.files.filter((file) => typeof file === "string").map((file) => file.slice(0, 160)).slice(0, 20) : undefined,
  };
}

function normalizeArchiveEntry(value) {
  if (!value || typeof value !== "object" || typeof value.data !== "string" || value.encoding !== "base64") {
    return null;
  }
  const name = String(value.name || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!name || name.includes("..") || value.data.length > 18 * 1024 * 1024) {
    return null;
  }
  return {
    name: name.slice(0, 500),
    data: value.data,
    encoding: "base64",
    typeFlag: String(value.typeFlag || "0").slice(0, 1),
    mode: Number.isFinite(Number(value.mode)) ? Number(value.mode) : 0o644,
  };
}

function redactSecrets(value) {
  return value
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[API 키 가림]")
    .replace(/AQ\.[0-9A-Za-z_-]{20,}/g, "[API 키 가림]")
    .replace(/((?:PIN|비밀번호|password)\s*[:=]?\s*)\d{6,12}/gi, "$1[가림]");
}

function looksSensitive(value) {
  return /AIza[0-9A-Za-z_-]{20,}|AQ\.[0-9A-Za-z_-]{20,}|\b(?:PIN|password|비밀번호|API\s*key|API\s*키|sync\s*code|동기화\s*코드)\b/i.test(value);
}
