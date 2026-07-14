import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CloudStore } from "./lib/cloud-store.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const templateJsonPath = path.join(__dirname, "templates", "blank-entry-template.json");
const port = Number(process.env.PORT || 4173);
const host = "0.0.0.0";
const MAX_JSON_BYTES = 14 * 1024 * 1024;
const loginAttempts = new Map();

const cloud = new CloudStore({
  connectionString: process.env.DATABASE_URL,
  secret: process.env.CLOUD_TOKEN_SECRET,
});
let cloudError = "";
try {
  if (process.env.DATABASE_URL && !process.env.CLOUD_TOKEN_SECRET) {
    throw new Error("CLOUD_TOKEN_SECRET is required when DATABASE_URL is configured");
  }
  await cloud.init();
} catch (error) {
  cloudError = error instanceof Error ? error.message : "Cloud initialization failed";
  console.error(`vibentry cloud disabled: ${cloudError}`);
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error("request failed", error);
    if (!res.headersSent) {
      sendJson(res, errorStatus(error), { ok: false, error: friendlyServerError(error) });
    } else {
      res.end();
    }
  });
});
let shuttingDown = false;

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/api/template") {
    const project = JSON.parse(fs.readFileSync(templateJsonPath, "utf8"));
    return sendJson(res, 200, { ok: true, project, source: path.basename(templateJsonPath) });
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    return sendJson(res, 200, {
      ok: true,
      app: "vibentry",
      geminiOnly: true,
      templatePresent: fs.existsSync(templateJsonPath),
      cloudStorage: cloud.ready,
      cloudMessage: cloud.ready ? "ready" : cloudError || "DATABASE_URL is not configured",
    });
  }

  if (url.pathname === "/api/cloud/register" && req.method === "POST") {
    assertCloudReady();
    enforceAuthRateLimit(req, "register", 6);
    const body = await readJson(req);
    const account = await cloud.register({ displayName: body.displayName, pin: body.pin });
    return sendJson(res, 201, { ok: true, account });
  }

  if (url.pathname === "/api/cloud/login" && req.method === "POST") {
    assertCloudReady();
    enforceAuthRateLimit(req, "login", 10);
    const body = await readJson(req);
    const account = await cloud.login({ syncCode: body.syncCode, pin: body.pin });
    if (!account) {
      return sendJson(res, 401, { ok: false, error: "동기화 코드 또는 PIN이 맞지 않아요." });
    }
    return sendJson(res, 200, { ok: true, account });
  }

  if (url.pathname.startsWith("/api/cloud/")) {
    assertCloudReady();
    const token = bearerToken(req);
    const account = await cloud.authenticate(token);
    if (!account) {
      return sendJson(res, 401, { ok: false, error: "클라우드 로그인이 만료됐어요. 다시 연결해 주세요." });
    }

    if (url.pathname === "/api/cloud/bootstrap" && req.method === "GET") {
      const sessions = await cloud.listSessions(account.id);
      return sendJson(res, 200, { ok: true, account: publicAccount(account), sessions });
    }

    if (url.pathname === "/api/cloud/memory" && req.method === "PUT") {
      const body = await readJson(req);
      const memory = await cloud.updateMemory(account.id, body.memory);
      return sendJson(res, 200, { ok: true, memory });
    }

    if (url.pathname === "/api/cloud/logout" && req.method === "POST") {
      await cloud.revokeToken(token);
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === "/api/cloud/account" && req.method === "DELETE") {
      await cloud.deleteAccount(account.id);
      return sendJson(res, 200, { ok: true });
    }

    const sessionMatch = url.pathname.match(/^\/api\/cloud\/sessions\/([a-zA-Z0-9_-]{8,80})$/);
    if (sessionMatch && req.method === "PUT") {
      const body = await readJson(req);
      if (body.session?.id !== sessionMatch[1]) {
        return sendJson(res, 400, { ok: false, error: "대화 ID가 요청 주소와 일치하지 않아요." });
      }
      const result = await cloud.putSession(account.id, body.session);
      return sendJson(res, 200, { ok: true, ...result });
    }

    return sendJson(res, 404, { ok: false, error: "클라우드 저장 주소를 찾지 못했어요." });
  }

  if (url.pathname.startsWith("/api/")) {
    return sendJson(res, 404, { ok: false, error: "API 주소를 찾지 못했어요." });
  }

  return serveStatic(url.pathname, res);
}

function serveStatic(pathname, res) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    return sendJson(res, 403, { ok: false, error: "Forbidden" });
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return sendFile(res, filePath);
  }
  if (path.extname(requestedPath)) {
    return sendJson(res, 404, { ok: false, error: "File not found" });
  }
  return sendFile(res, path.join(publicDir, "index.html"));
}

function sendJson(res, statusCode, body) {
  const raw = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": raw.length,
    "Cache-Control": "no-store",
    ...securityHeaders(),
  });
  res.end(raw);
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => {
    if (!res.headersSent) {
      sendJson(res, 404, { ok: false, error: "Not found" });
    } else {
      res.end();
    }
  });
  res.writeHead(200, {
    "Content-Type": mimeTypes[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
    ...securityHeaders(),
  });
  stream.pipe(res);
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self'; connect-src 'self' https://generativelanguage.googleapis.com; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'self'; frame-ancestors 'none'",
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > MAX_JSON_BYTES) {
      const error = new Error("한 번에 저장할 수 있는 데이터 크기를 넘었어요.");
      error.code = "PAYLOAD_TOO_LARGE";
      reject(error);
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        const error = new Error("한 번에 저장할 수 있는 데이터 크기를 넘었어요.");
        error.code = "PAYLOAD_TOO_LARGE";
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        const error = new Error("요청 JSON 형식이 올바르지 않아요.");
        error.code = "INVALID_JSON";
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function publicAccount(account) {
  return {
    syncCode: account.syncCode,
    displayName: account.displayName,
    memory: account.memory,
  };
}

function assertCloudReady() {
  if (!cloud.ready) {
    const error = new Error("기기 간 저장 서버가 아직 준비되지 않았어요. Render 데이터베이스 연결을 확인해 주세요.");
    error.code = "CLOUD_UNAVAILABLE";
    throw error;
  }
}

function enforceAuthRateLimit(req, action, maximum) {
  const address = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  const key = `${action}:${address}`;
  const now = Date.now();
  const recent = (loginAttempts.get(key) || []).filter((time) => now - time < 15 * 60_000);
  if (recent.length >= maximum) {
    const error = new Error("로그인 시도가 너무 많아요. 15분 뒤 다시 시도해 주세요.");
    error.code = "RATE_LIMIT";
    throw error;
  }
  recent.push(now);
  loginAttempts.set(key, recent);
}

function errorStatus(error) {
  if (error?.code === "PAYLOAD_TOO_LARGE") return 413;
  if (["INVALID_JSON", "INVALID_PIN", "INVALID_SYNC_CODE"].includes(error?.code)) return 400;
  if (error?.code === "RATE_LIMIT") return 429;
  if (error?.code === "CLOUD_UNAVAILABLE") return 503;
  return 500;
}

function friendlyServerError(error) {
  if (errorStatus(error) < 500 || error?.code === "CLOUD_UNAVAILABLE") {
    return error.message;
  }
  return "서버에서 저장 작업을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`vibentry received ${signal}; closing connections`);
  const deadline = setTimeout(() => {
    console.error("vibentry graceful shutdown timed out");
    process.exit(1);
  }, 25_000);
  deadline.unref();

  try {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections?.();
    });
    await cloud.close();
    clearTimeout(deadline);
    console.log("vibentry shutdown complete");
  } catch (error) {
    clearTimeout(deadline);
    console.error("vibentry shutdown failed", error);
    process.exitCode = 1;
  }
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}

server.listen(port, host, () => {
  console.log(`vibentry running at http://${host}:${port} (cloud: ${cloud.ready ? "ready" : "off"})`);
});
