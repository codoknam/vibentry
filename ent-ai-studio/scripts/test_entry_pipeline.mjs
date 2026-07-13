import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEntBlob, readEntArchive } from "../public/entry-archive.js";
import {
  collectArchiveAssetNames,
  repairEntryProject,
  validateEntryProject,
} from "../public/entry-safety.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(__dirname, "..", "templates", "blank-entry-template.json");
const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));

const cleanResult = repairEntryProject(template, template);
assert.deepEqual(cleanResult.validation.errors, []);
assert.equal(cleanResult.repaired, false);

const emptyResult = repairEntryProject({}, template);
assert.deepEqual(emptyResult.validation.errors, []);
assert.equal(emptyResult.project.objects[0].id, template.objects[0].id);

const broken = structuredClone(template);
broken.name = "안전 복구 테스트";
broken.scenes = [{ id: "scene", name: "테스트 장면" }];
broken.messages = [{ id: "signal", name: "시작 신호" }];
broken.functions = [{ id: "fake", type: "normal", content: "[]" }];
broken.objects = [
  {
    ...broken.objects[0],
    id: "same",
    scene: "missing-scene",
    selectedPictureId: "missing-picture",
    sprite: {
      ...broken.objects[0].sprite,
      pictures: broken.objects[0].sprite.pictures.map((picture) => ({
        ...picture,
        fileurl: "invented-image.png",
      })),
    },
    script: JSON.stringify([[
      {
        id: "duplicate",
        x: 20,
        y: 20,
        type: "when_message_cast",
        params: [null, "signal"],
        statements: [],
      },
      {
        id: "duplicate",
        type: "not_a_real_entry_block",
        params: [],
        statements: [],
      },
      {
        id: "set1",
        type: "set_variable",
        params: ["missing-variable", null, null],
        statements: [],
      },
      {
        id: "call1",
        type: "func_fake",
        params: [null],
        statements: [],
      },
    ]]),
  },
  {
    ...broken.objects[0],
    id: "same",
    scene: "scene",
  },
];
broken.interface.object = "missing-object";

const repaired = repairEntryProject(broken, template);
assert.equal(repaired.validation.errors.length, 0, repaired.validation.errors.join("\n"));
assert.equal(new Set(repaired.project.objects.map((item) => item.id)).size, 2);
assert.equal(repaired.project.interface.object, repaired.project.objects[0].id);
assert.equal(repaired.project.objects[0].scene, repaired.project.scenes[0].id);
assert.ok(repaired.warnings.length > 0);
const repairedBlocks = JSON.parse(repaired.project.objects[0].script).flat();
assert.equal(repairedBlocks.some((block) => block.type === "not_a_real_entry_block"), false);
assert.equal(repairedBlocks.some((block) => block.type === "set_variable"), false);
assert.equal(repairedBlocks.some((block) => block.type === "func_fake"), false);
assert.equal(repaired.project.functions.length, 0);
assert.equal(repairedBlocks.find((block) => block.type === "when_message_cast")?.params[1], "signal");

const preservedAsset = {
  name: "temp/preserved.bin",
  data: new Uint8Array([1, 2, 3, 4]),
  typeFlag: "0",
  mode: 0o644,
};
const blob = await buildEntBlob(repaired.project, [preservedAsset]);
const reopened = await readEntArchive(blob);
assert.deepEqual(reopened.project, repaired.project);
assert.deepEqual(
  [...reopened.entries.find((entry) => entry.name === preservedAsset.name).data],
  [...preservedAsset.data]
);

const finalValidation = validateEntryProject(reopened.project, {
  baseProject: template,
  availableAssets: collectArchiveAssetNames(reopened.entries),
});
assert.deepEqual(finalValidation.errors, []);

const counter = structuredClone(template);
counter.variables.push({
  id: "score", name: "점수", visible: true, value: "0", variableType: "variable",
  isCloud: true, isRealTime: true, cloudDate: false, object: null, x: 0, y: 0,
});
counter.tables = [{ id: "history", name: "기록", listType: "list", data: ["1"] }];
counter.objects[0].script = JSON.stringify([[
  { id:"click", type:"when_object_click", params:[], statements:[[
    { id:"change", type:"change_variable", params:["score", null, { id:"one", type:"number", params:[1], statements:[] }], statements:[] },
    { id:"add", type:"add_value_to_list", params:[{ id:"scoreValue", type:"get_variable", params:["score"], statements:[] }, "history"], statements:[] },
  ]] },
]]);
const fixedCounter = repairEntryProject(counter, template);
assert.deepEqual(fixedCounter.validation.errors, []);
assert.equal(fixedCounter.project.variables.find((item) => item.id === "history")?.variableType, "list");
assert.equal(fixedCounter.project.tables.length, 0);
const counterBlocks = JSON.parse(fixedCounter.project.objects[0].script)[0];
assert.deepEqual(counterBlocks.map((block) => block.type), ["when_object_click", "change_variable", "add_value_to_list"]);
assert.deepEqual(counterBlocks[0].statements, []);

console.log(
  `entry pipeline ok: ${finalValidation.stats.objects} objects, ${finalValidation.stats.blocks} blocks, ${reopened.entries.length} archive entries`
);
