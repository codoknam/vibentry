import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, "..");
const workspaceDir = path.resolve(appDir, "..");
const sourcePath = path.join(workspaceDir, "work", "generated_project.json");
const outputDir = path.join(appDir, "templates");
const outputPath = path.join(outputDir, "blank-entry-template.json");

function block(id, type, params = [], statements = [], x = 0, y = 0) {
  return {
    id,
    x,
    y,
    type,
    params,
    statements,
    movable: null,
    deletable: 1,
    emphasized: false,
    readOnly: null,
    copyable: true,
    assemble: true,
    extensions: [],
  };
}

function textBlock(id, value) {
  return block(id, "text", [value]);
}

function whenRunBlock() {
  return block("v001", "when_run_button_click", [null], [], 50, 30);
}

function dialogBlock(message) {
  return block("v003", "dialog", [textBlock("v002", message), "speak", null]);
}

function createStarterScript() {
  return JSON.stringify([[whenRunBlock(), dialogBlock("메시지를 여기에 넣어 주세요")]]);
}

function createTemplate(baseProject) {
  const baseObject = Array.isArray(baseProject.objects) ? baseProject.objects[0] : null;
  const sceneId = baseProject?.scenes?.[0]?.id || "scene1";
  const objectId = "vbot";
  const pictures = Array.isArray(baseObject?.sprite?.pictures)
    ? baseObject.sprite.pictures.map((picture, index) => ({
        ...picture,
        id: index === 0 ? "vpic" : picture.id,
      }))
    : [];

  const selectedPictureId = pictures[0]?.id || "vpic";
  const sprite = {
    pictures,
    sounds: Array.isArray(baseObject?.sprite?.sounds) ? baseObject.sprite.sounds : [],
  };

  const entity = {
    x: -150,
    y: -80,
    regX: baseObject?.entity?.regX ?? 72,
    regY: baseObject?.entity?.regY ?? 123,
    scaleX: baseObject?.entity?.scaleX ?? 0.5128205128205128,
    scaleY: baseObject?.entity?.scaleY ?? 0.5128205128205128,
    rotation: 0,
    direction: 90,
    width: baseObject?.entity?.width ?? 144,
    height: baseObject?.entity?.height ?? 246,
    font: baseObject?.entity?.font ?? "undefinedpx ",
    visible: true,
  };

  return {
    objects: [
      {
        id: objectId,
        name: "엔트리봇",
        script: createStarterScript(),
        objectType: "sprite",
        rotateMethod: "free",
        scene: sceneId,
        sprite,
        selectedPictureId,
        lock: false,
        entity,
      },
    ],
    scenes: [
      {
        id: sceneId,
        name: "장면 1",
      },
    ],
    variables: [
      {
        name: "초시계",
        id: "vtmr",
        visible: false,
        value: "0",
        variableType: "timer",
        isCloud: false,
        isRealTime: false,
        cloudDate: false,
        object: null,
        x: 134,
        y: -70,
      },
      {
        name: "대답",
        id: "vans",
        visible: false,
        value: "0",
        variableType: "answer",
        isCloud: false,
        isRealTime: false,
        cloudDate: false,
        object: null,
        x: 150,
        y: -100,
      },
    ],
    messages: [],
    functions: [],
    tables: [],
    speed: 60,
    interface: {
      menuWidth: 280,
      canvasWidth: 480,
      object: objectId,
    },
    expansionBlocks: [],
    aiUtilizeBlocks: [],
    hardwareLiteBlocks: [],
    externalModules: [],
    externalModulesLite: [],
    likeCnt: 0,
    visit: 0,
    isopen: true,
    name: "vibentry 기본 템플릿",
    isPracticalCourse: false,
    user: baseProject?.user ?? "",
    recentLikeCnt: 0,
    childCnt: 0,
    comment: 0,
  };
}

const baseProject = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const template = createTemplate(baseProject);
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(template, null, 2), "utf8");
console.log(outputPath);
