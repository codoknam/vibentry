import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { embedImageAsset } from "../public/entry-assets.js";
import { buildEntBlob, readEntArchive } from "../public/entry-archive.js";
import { collectArchiveAssetNames, repairEntryProject } from "../public/entry-safety.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = JSON.parse(fs.readFileSync(path.join(root, "templates", "blank-entry-template.json"), "utf8"));
const project = structuredClone(template);
const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const embedded = embedImageAsset(project, [], {
  objectId: project.objects[0].id,
  name: "AI 픽셀",
  dataUrl: tinyPng,
  dimension: { width: 1024, height: 1024 },
});

assert.match(embedded.picture.fileurl, /^[a-f0-9]{2}\/[a-f0-9]{2}\/image\/[a-f0-9]{32}\.png$/);
assert.match(embedded.picture.thumbUrl, /^[a-f0-9]{2}\/[a-f0-9]{2}\/thumb\/[a-f0-9]{32}\.png$/);
assert.equal(embedded.entries.filter((entry) => entry.typeFlag !== "5").length, 2);
assert.ok(embedded.project.objects[0].entity.scaleX < 1);
assert.ok(embedded.entries.some((entry) => entry.name === `temp/${embedded.picture.fileurl}`));

const repaired = repairEntryProject(embedded.project, template, {
  availableAssets: collectArchiveAssetNames(embedded.entries),
});
assert.deepEqual(repaired.validation.errors, []);
assert.equal(repaired.project.objects[0].sprite.pictures[0].fileurl, embedded.picture.fileurl);

const blob = await buildEntBlob(repaired.project, embedded.entries);
const reopened = await readEntArchive(blob);
assert.ok(reopened.entries.some((entry) => entry.name === `temp/${embedded.picture.fileurl}`));
assert.deepEqual(
  [...reopened.entries.find((entry) => entry.name === `temp/${embedded.picture.fileurl}`).data],
  [...embedded.entries.find((entry) => entry.name === `temp/${embedded.picture.fileurl}`).data]
);

const filesOnlyBlob = await buildEntBlob(repaired.project, embedded.entries.filter((entry) => entry.typeFlag !== "5"));
const filesOnlyReopened = await readEntArchive(filesOnlyBlob);
const imageDirectory = `temp/${embedded.picture.fileurl.split("/").slice(0, -1).join("/")}/`;
assert.ok(filesOnlyReopened.entries.some((entry) => entry.name === imageDirectory && entry.typeFlag === "5"));

console.log(`entry assets ok: ${embedded.archivePaths.length} image files embedded with official sharded paths`);
