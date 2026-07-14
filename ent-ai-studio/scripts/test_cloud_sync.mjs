import assert from "node:assert/strict";
import {
  CloudStore,
  createSyncCode,
  normalizeCloudSession,
  normalizeMemory,
  normalizeSyncCode,
  validatePin,
} from "../lib/cloud-store.mjs";
import { mergeMemory, vibentryPersonaPrompt } from "../public/vibentry-persona.js";

const codes = new Set(Array.from({ length: 100 }, () => createSyncCode()));
assert.equal(codes.size, 100);
for (const code of codes) {
  assert.match(code, /^VIBE-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  assert.equal(normalizeSyncCode(code.toLowerCase().replaceAll("-", " ")), code);
}

assert.doesNotThrow(() => validatePin("123456"));
assert.throws(() => validatePin("12345"), /6~12/);
assert.throws(() => validatePin("abcdef"), /숫자/);

assert.deepEqual(normalizeMemory([" 초보자 ", "초보자", "", 3]), ["초보자"]);
assert.deepEqual(normalizeMemory(["API 키는 AIza123456789012345678901234567890"]), []);
assert.deepEqual(mergeMemory(["한국어 설명 선호"], ["한국어 설명 선호", "블록 설명을 쉽게 해주기"]), [
  "한국어 설명 선호",
  "블록 설명을 쉽게 해주기",
]);
assert.match(vibentryPersonaPrompt(["사용자는 코딩 초보자다."]), /사용자는 코딩 초보자다/);
assert.match(vibentryPersonaPrompt([]), /Never claim to be conscious/);

const session = normalizeCloudSession({
  id: "12345678-abcd",
  title: "테스트 대화",
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T01:00:00.000Z",
  messages: Array.from({ length: 320 }, (_, index) => ({ id: String(index), role: "user", text: index === 319 ? "PIN: 123456" : `메시지 ${index}` })),
  project: { name: "테스트" },
  archiveEntries: [{ name: "temp/image.png", data: "AQID", encoding: "base64", typeFlag: "0", mode: 0o644 }],
  memorySummary: "진행 중인 테스트",
});
assert.equal(session.messages.length, 300);
assert.equal(session.archiveEntries[0].data, "AQID");
assert.equal(session.project.name, "테스트");
assert.equal(session.messages.at(-1).text, "PIN: [가림]");

const unavailable = new CloudStore({ connectionString: "", secret: "test" });
assert.equal(await unavailable.init(), false);
await assert.rejects(() => unavailable.register({ displayName: "테스트", pin: "123456" }), /연결되지/);

class FakePool {
  constructor() {
    this.account = null;
    this.tokens = new Map();
    this.sessions = new Map();
    this.closed = false;
  }
  async query(sql, params = []) {
    if (sql.includes("CREATE TABLE")) return { rows: [], rowCount: 0 };
    if (sql.startsWith("INSERT INTO vibentry_accounts")) {
      this.account = { id: params[0], sync_code: params[1], pin_hash: params[2], display_name: params[3], memory: [] };
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO vibentry_tokens")) {
      this.tokens.set(params[0], params[1]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("DELETE FROM vibentry_tokens")) {
      if (params.length) this.tokens.delete(params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("DELETE FROM vibentry_accounts")) {
      this.account = null;
      this.tokens.clear();
      this.sessions.clear();
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("SELECT id, pin_hash")) return { rows: this.account?.sync_code === params[0] ? [this.account] : [], rowCount: 1 };
    if (sql.includes("JOIN vibentry_accounts")) {
      const valid = this.tokens.has(params[0]);
      return { rows: valid ? [{ id: this.account.id, sync_code: this.account.sync_code, display_name: this.account.display_name, memory: this.account.memory }] : [] };
    }
    if (sql.startsWith("UPDATE vibentry_tokens")) return { rows: [], rowCount: 1 };
    if (sql.startsWith("SELECT payload")) return { rows: [...this.sessions.values()].map((payload) => ({ payload, updated_at: payload.updatedAt })) };
    if (sql.includes("INSERT INTO vibentry_sessions")) {
      this.sessions.set(params[1], params[2]);
      return { rows: [{ updated_at: params[3] }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE vibentry_accounts SET memory")) {
      this.account.memory = params[1];
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL in fake pool: ${sql.slice(0, 80)}`);
  }
  async end() {
    this.closed = true;
  }
}

const fakePool = new FakePool();
const store = new CloudStore({ pool: fakePool, secret: "unit-test-secret" });
assert.equal(await store.init(), true);
const registered = await store.register({ displayName: "테스트 사용자", pin: "123456" });
assert.match(registered.syncCode, /^VIBE-/);
assert.notEqual(fakePool.account.pin_hash, "123456");
assert.equal([...fakePool.tokens.keys()][0].length, 64);
const loggedIn = await store.login({ syncCode: registered.syncCode, pin: "123456" });
assert.ok(loggedIn?.token);
assert.equal(await store.login({ syncCode: registered.syncCode, pin: "999999" }), null);
const authenticated = await store.authenticate(loggedIn.token);
assert.equal(authenticated.displayName, "테스트 사용자");
await store.putSession(authenticated.id, session);
assert.equal((await store.listSessions(authenticated.id))[0].id, session.id);
assert.deepEqual(await store.updateMemory(authenticated.id, ["쉬운 한국어 설명 선호"]), ["쉬운 한국어 설명 선호"]);
await store.revokeToken(loggedIn.token);
assert.equal(await store.authenticate(loggedIn.token), null);
await store.deleteAccount(authenticated.id);
assert.equal(fakePool.account, null);
assert.equal(fakePool.tokens.size, 0);
assert.equal(fakePool.sessions.size, 0);
await store.close();
assert.equal(fakePool.closed, true);
assert.equal(store.ready, false);

console.log(`cloud sync ok: ${codes.size} unique codes, ${session.messages.length} retained messages, hashed auth and account deletion`);
