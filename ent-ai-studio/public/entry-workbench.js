const EVENT_TYPES = new Set([
  "when_run_button_click",
  "when_object_click",
  "when_some_key_pressed",
]);

export const QUICK_BLOCK_CATALOG = Object.freeze([
  { id: "start", type: "when_run_button_click", label: "시작 버튼을 클릭했을 때", kind: "event", placeholder: "" },
  { id: "click", type: "when_object_click", label: "오브젝트를 클릭했을 때", kind: "event", placeholder: "" },
  { id: "key", type: "when_some_key_pressed", label: "키를 눌렀을 때", kind: "event", placeholder: "키 코드: 32" },
  { id: "say", type: "dialog", label: "말하기", kind: "action", placeholder: "안녕!" },
  { id: "wait", type: "wait_second", label: "기다리기", kind: "action", placeholder: "초: 1" },
  { id: "moveX", type: "move_x", label: "x만큼 움직이기", kind: "action", placeholder: "10" },
  { id: "moveY", type: "move_y", label: "y만큼 움직이기", kind: "action", placeholder: "10" },
  { id: "locate", type: "locate_xy", label: "x, y 위치로 이동", kind: "action", placeholder: "0, 0" },
  { id: "rotate", type: "rotate_relative", label: "각도만큼 회전", kind: "action", placeholder: "15" },
  { id: "show", type: "show", label: "보이기", kind: "action", placeholder: "" },
  { id: "hide", type: "hide", label: "숨기기", kind: "action", placeholder: "" },
]);

export function createWorkbenchDraft(project, fallbackProject) {
  return structuredClone(project || fallbackProject);
}

export function addWorkbenchObject(project, fallbackProject, requestedName = "새 오브젝트") {
  assertProject(project);
  const source = fallbackProject?.objects?.[0] || project.objects?.[0];
  if (!source) throw new Error("새 오브젝트의 기준 모양을 찾지 못했어요.");

  const object = structuredClone(source);
  object.id = makeId("obj");
  object.name = uniqueObjectName(project, requestedName);
  object.scene = project.scenes?.[0]?.id || source.scene;
  object.script = JSON.stringify([[makeBlock("when_run_button_click", [null], { x: 40, y: 40 })]]);
  object.lock = false;
  object.entity = {
    ...(object.entity || {}),
    x: 0,
    y: 0,
    rotation: 0,
    direction: 90,
    visible: true,
  };

  const pictures = (object.sprite?.pictures || []).map((picture) => ({
    ...picture,
    id: makeId("pic"),
  }));
  object.sprite = { ...(object.sprite || {}), pictures };
  object.selectedPictureId = pictures[0]?.id || object.selectedPictureId;
  project.objects = [...(project.objects || []), object];
  project.interface = { ...(project.interface || {}), object: object.id };
  return object.id;
}

export function removeWorkbenchObject(project, objectId) {
  assertProject(project);
  if ((project.objects || []).length <= 1) {
    throw new Error("Entry 작품에는 최소 한 개의 오브젝트가 필요해요.");
  }
  const before = project.objects.length;
  project.objects = project.objects.filter((item) => item.id !== objectId);
  if (project.objects.length === before) return false;
  if (project.interface?.object === objectId) {
    project.interface.object = project.objects[0].id;
  }
  return true;
}

export function updateWorkbenchObject(project, objectId, values = {}) {
  const object = findObject(project, objectId);
  if (typeof values.name === "string") {
    const nextName = values.name.trim().slice(0, 80);
    if (nextName) object.name = nextName;
  }
  object.entity = { ...(object.entity || {}) };
  for (const key of ["x", "y", "rotation", "direction"]) {
    if (values[key] !== undefined && Number.isFinite(Number(values[key]))) {
      object.entity[key] = clamp(Number(values[key]), key === "x" ? -240 : key === "y" ? -135 : -3600, key === "x" ? 240 : key === "y" ? 135 : 3600);
    }
  }
  if (values.scale !== undefined && Number.isFinite(Number(values.scale))) {
    const scale = clamp(Number(values.scale) / 100, 0.05, 10);
    object.entity.scaleX = scale;
    object.entity.scaleY = scale;
  }
  if (typeof values.visible === "boolean") object.entity.visible = values.visible;
  return object;
}

export function appendQuickBlock(project, objectId, catalogId, rawValue = "", threadIndex = 0) {
  const object = findObject(project, objectId);
  const descriptor = QUICK_BLOCK_CATALOG.find((item) => item.id === catalogId);
  if (!descriptor) throw new Error("지원하지 않는 빠른 블록이에요.");
  const threads = parseObjectScript(object.script);
  const block = createCatalogBlock(descriptor, rawValue);

  if (descriptor.kind === "event") {
    block.x = 40 + threads.length * 24;
    block.y = 40 + threads.length * 28;
    threads.push([block]);
  } else {
    if (!threads.length) {
      threads.push([makeBlock("when_run_button_click", [null], { x: 40, y: 40 })]);
    }
    const targetIndex = clamp(Math.trunc(Number(threadIndex) || 0), 0, threads.length - 1);
    if (!EVENT_TYPES.has(threads[targetIndex]?.[0]?.type)) {
      threads[targetIndex].unshift(makeBlock("when_run_button_click", [null], { x: 40, y: 40 }));
    }
    threads[targetIndex].push(block);
  }

  object.script = JSON.stringify(threads);
  return block.id;
}

export function removeWorkbenchBlock(project, objectId, threadIndex, blockIndex) {
  const object = findObject(project, objectId);
  const threads = parseObjectScript(object.script);
  const thread = threads[threadIndex];
  if (!thread) return false;
  if (blockIndex === 0) {
    threads.splice(threadIndex, 1);
  } else if (thread[blockIndex]) {
    thread.splice(blockIndex, 1);
  } else {
    return false;
  }
  object.script = JSON.stringify(threads);
  return true;
}

export function setWorkbenchScript(project, objectId, rawScript) {
  const object = findObject(project, objectId);
  const parsed = typeof rawScript === "string" ? JSON.parse(rawScript) : rawScript;
  if (!Array.isArray(parsed) || parsed.some((thread) => !Array.isArray(thread))) {
    throw new Error("스크립트는 [[블록, 블록], [블록]] 형태여야 해요.");
  }
  object.script = JSON.stringify(parsed);
  return parsed;
}

export function parseObjectScript(rawScript) {
  try {
    const parsed = JSON.parse(rawScript || "[]");
    return Array.isArray(parsed) ? parsed.filter(Array.isArray) : [];
  } catch {
    return [];
  }
}

export function describeWorkbenchBlock(block) {
  const descriptor = QUICK_BLOCK_CATALOG.find((item) => item.type === block?.type);
  const value = readableBlockValue(block);
  return `${descriptor?.label || block?.type || "알 수 없는 블록"}${value ? ` · ${value}` : ""}`;
}

export function workbenchProjectStats(project) {
  let blocks = 0;
  let threads = 0;
  for (const object of project?.objects || []) {
    const script = parseObjectScript(object.script);
    threads += script.length;
    for (const thread of script) blocks += countNestedBlocks(thread);
  }
  return {
    objects: project?.objects?.length || 0,
    variables: project?.variables?.length || 0,
    threads,
    blocks,
  };
}

function createCatalogBlock(descriptor, rawValue) {
  const textValue = String(rawValue || "").trim();
  switch (descriptor.id) {
    case "start": return makeBlock(descriptor.type, [null]);
    case "click": return makeBlock(descriptor.type, [null]);
    case "key": return makeBlock(descriptor.type, [null, normalizeNumberString(textValue || "32")]);
    case "say": return makeBlock(descriptor.type, [literal("text", textValue || "안녕!"), "speak", null]);
    case "wait": return makeBlock(descriptor.type, [literal("number", normalizeNumberString(textValue || "1")), null]);
    case "moveX": return makeBlock(descriptor.type, [literal("number", normalizeNumberString(textValue || "10")), null]);
    case "moveY": return makeBlock(descriptor.type, [literal("number", normalizeNumberString(textValue || "10")), null]);
    case "locate": {
      const [x = "0", y = "0"] = textValue.split(/[,\s]+/).filter(Boolean);
      return makeBlock(descriptor.type, [literal("number", normalizeNumberString(x)), literal("number", normalizeNumberString(y)), null]);
    }
    case "rotate": return makeBlock(descriptor.type, [literal("number", normalizeNumberString(textValue || "15")), null]);
    case "show": return makeBlock(descriptor.type, [null]);
    case "hide": return makeBlock(descriptor.type, [null]);
    default: throw new Error("빠른 블록 구조를 만들 수 없어요.");
  }
}

function makeBlock(type, params, { x = 0, y = 0, statements = [] } = {}) {
  return {
    id: makeId("blk"),
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

function literal(type, value) {
  return makeBlock(type, [String(value)]);
}

function readableBlockValue(block) {
  if (!block || !Array.isArray(block.params)) return "";
  const values = [];
  for (const param of block.params) {
    if (typeof param === "string" && param !== "speak") values.push(param);
    if (param && typeof param === "object" && ["text", "number"].includes(param.type)) values.push(param.params?.[0]);
  }
  return values.filter((value) => value !== undefined && value !== "").join(", ");
}

function countNestedBlocks(value) {
  if (!Array.isArray(value)) return 0;
  let count = 0;
  for (const item of value) {
    if (item && typeof item === "object" && typeof item.type === "string") {
      count += 1;
      count += countNestedBlocks(item.params);
      count += countNestedBlocks(item.statements);
    } else if (Array.isArray(item)) {
      count += countNestedBlocks(item);
    }
  }
  return count;
}

function normalizeNumberString(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "0";
}

function findObject(project, objectId) {
  assertProject(project);
  const object = project.objects.find((item) => item.id === objectId);
  if (!object) throw new Error("선택한 오브젝트를 찾지 못했어요.");
  return object;
}

function uniqueObjectName(project, requestedName) {
  const base = String(requestedName || "새 오브젝트").trim().slice(0, 70) || "새 오브젝트";
  const names = new Set((project.objects || []).map((item) => item.name));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

function assertProject(project) {
  if (!project || typeof project !== "object" || !Array.isArray(project.objects)) {
    throw new Error("편집할 Entry 작품이 준비되지 않았어요.");
  }
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
