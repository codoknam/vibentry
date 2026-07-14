import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.join(root, "..");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const server = fs.readFileSync(path.join(root, "server.mjs"), "utf8");
const render = fs.readFileSync(path.join(workspace, "render.yaml"), "utf8");
const workflow = fs.readFileSync(path.join(workspace, ".github", "workflows", "ci.yml"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const workbench = fs.readFileSync(path.join(root, "public", "entry-workbench-ui.js"), "utf8");
const assets = fs.readFileSync(path.join(root, "public", "entry-assets.js"), "utf8");
const models = fs.readFileSync(path.join(root, "public", "gemini-models.js"), "utf8");

for (const id of [
  "cloudRegisterBtn",
  "cloudLoginBtn",
  "cloudSyncCode",
  "syncNowBtn",
  "cloudLogoutBtn",
  "clearMemoryBtn",
  "cloudDeleteBtn",
  "workbenchBtn",
  "workbenchDialog",
  "agentTimeline",
  "workbenchObjectList",
  "workbenchStage",
  "workbenchCodeList",
  "applyWorkbenchBtn",
]) {
  assert.match(html, new RegExp(`id="${id}"`));
}

assert.doesNotMatch(html, /id="downloadEntBtn"/);
assert.doesNotMatch(html, /id="downloadJsonBtn"/);
assert.match(html, /완성 파일은 AI 답변에 첨부돼요/);
assert.match(app, /data-ent-file/);
assert.match(app, /downloadEnt\(artifact\.dataset\.entFile\)/);

assert.match(app, /vibentryPersonaPrompt\(accountMemory\)/);
assert.match(app, /OTHER SAVED CHAT SUMMARIES/);
assert.match(app, /conversation_summary/);
assert.match(app, /memory_updates/);
assert.match(app, /\/api\/cloud\/bootstrap/);
assert.match(app, /\/api\/cloud\/account/);
assert.match(app, /response_format:\{type:"text",mime_type:"application\/json",schema\}/);
assert.match(app, /background:true/);
assert.match(app, /store:true/);
assert.match(app, /thinking_level:"high"/);
assert.match(app, /type:"url_context"/);
assert.match(app, /supportsUrlContext\(model\)/);
assert.match(app, /30\*60_000/);
assert.match(app, /input:buildAgentInput\(prompt\)/);
assert.match(app, /type:"image",mime_type:match\[1\]\.toLowerCase\(\),data:match\[2\]/);
assert.match(app, /IMAGE_INPUT_LIMIT = 8 \* 1024 \* 1024/);
assert.match(app, /selectGeminiTextModels\(await response\.json\(\)\)/);
assert.match(app, /confirmWorkbenchDiscard\(\)/);
assert.match(app, /embedImageAsset\(project,entries/);
assert.match(app, /assetResult\.warnings/);
assert.doesNotMatch(app, /json_schema/);
assert.match(workbench, /addWorkbenchObject/);
assert.match(workbench, /setWorkbenchScript/);
assert.match(workbench, /repairEntryProject\(draft, base/);
assert.match(assets, /\/image\/\$\{fileId\}/);
assert.match(assets, /\/thumb\/\$\{fileId\}/);
assert.match(models, /PREFERRED_GEMINI_MODELS/);
assert.match(models, /supportedGenerationMethods/);

assert.match(server, /CLOUD_TOKEN_SECRET is required/);
assert.ok(server.includes("api\\/cloud\\/sessions"));
assert.match(server, /\/api\/cloud\/account/);
assert.match(server, /Content-Security-Policy/);
assert.match(server, /const host = "0\.0\.0\.0"/);
assert.match(server, /server\.listen\(port, host/);
assert.match(server, /\["SIGTERM", "SIGINT"\]/);
assert.match(server, /await cloud\.close\(\)/);
assert.match(server, /url\.pathname\.startsWith\("\/api\/"\)/);
assert.match(server, /path\.extname\(requestedPath\)/);
assert.equal(packageJson.engines.node, ">=24.0.0 <25.0.0");
assert.match(render, /fromDatabase:[\s\S]*name: vibentry-db[\s\S]*property: connectionString/);
assert.match(render, /CLOUD_TOKEN_SECRET[\s\S]*generateValue: true/);
assert.match(render, /buildCommand: npm ci && npm test/);
assert.match(render, /plan: free/);
assert.match(render, /autoDeployTrigger: checksPass/);
assert.match(render, /maxShutdownDelaySeconds: 30/);
assert.match(workflow, /working-directory: ent-ai-studio/);
assert.match(workflow, /npm ci/);
assert.match(workflow, /npm test/);

console.log("client contract ok: workbench editor, background Gemini, embedded assets, cloud UI, and Render wiring");
