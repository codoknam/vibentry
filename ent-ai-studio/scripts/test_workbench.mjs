import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repairEntryProject } from "../public/entry-safety.js";
import {
  addWorkbenchObject,
  appendQuickBlock,
  createWorkbenchDraft,
  describeWorkbenchBlock,
  parseObjectScript,
  removeWorkbenchBlock,
  removeWorkbenchObject,
  setWorkbenchScript,
  updateWorkbenchObject,
  workbenchProjectStats,
} from "../public/entry-workbench.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = JSON.parse(fs.readFileSync(path.join(root, "templates", "blank-entry-template.json"), "utf8"));
const draft = createWorkbenchDraft(null, template);

assert.notEqual(draft, template);
const objectId = addWorkbenchObject(draft, template, "플레이어");
assert.equal(draft.objects.length, 2);
assert.equal(draft.interface.object, objectId);
assert.equal(draft.objects[1].name, "플레이어");

updateWorkbenchObject(draft, objectId, { name: "큐브", x: 999, y: -999, rotation: 45, scale: 150 });
const cube = draft.objects.find((item) => item.id === objectId);
assert.equal(cube.name, "큐브");
assert.equal(cube.entity.x, 240);
assert.equal(cube.entity.y, -135);
assert.equal(cube.entity.scaleX, 1.5);

appendQuickBlock(draft, objectId, "say", "준비 완료", 0);
appendQuickBlock(draft, objectId, "moveX", "12", 0);
appendQuickBlock(draft, objectId, "key", "38");
let threads = parseObjectScript(cube.script);
assert.equal(threads.length, 2);
assert.deepEqual(threads[0].map((block) => block.type), ["when_run_button_click", "dialog", "move_x"]);
assert.equal(threads[1][0].params[1], "38");
assert.match(describeWorkbenchBlock(threads[0][1]), /준비 완료/);

assert.equal(removeWorkbenchBlock(draft, objectId, 0, 2), true);
threads = parseObjectScript(cube.script);
assert.deepEqual(threads[0].map((block) => block.type), ["when_run_button_click", "dialog"]);
assert.throws(() => setWorkbenchScript(draft, objectId, "{}"), /형태/);
setWorkbenchScript(draft, objectId, JSON.stringify(threads));

const stats = workbenchProjectStats(draft);
assert.equal(stats.objects, 2);
assert.ok(stats.blocks >= 3);

assert.equal(removeWorkbenchObject(draft, objectId), true);
assert.equal(draft.objects.length, 1);
assert.throws(() => removeWorkbenchObject(draft, draft.objects[0].id), /최소 한 개/);

const repaired = repairEntryProject(draft, template);
assert.deepEqual(repaired.validation.errors, []);

console.log(`workbench ok: ${stats.objects} objects, ${stats.threads} threads, ${stats.blocks} nested blocks`);
