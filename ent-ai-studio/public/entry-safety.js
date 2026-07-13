const MAX_OBJECTS = 120;
const MAX_COLLECTION_ITEMS = 500;
const MAX_SCRIPT_THREADS = 120;
const MAX_BLOCKS = 20000;
const MAX_BLOCK_DEPTH = 48;
const MAX_TEXT_LENGTH = 50000;
const MAX_DATA_URL_LENGTH = 8 * 1024 * 1024;

export const ENTRY_SAFE_BLOCK_TYPES = Object.freeze([
  "_if",
  "add_effect_amount",
  "add_value_to_list",
  "angle",
  "ask_and_wait",
  "boolean_and_or",
  "boolean_basic_operator",
  "boolean_not",
  "boolean_shell",
  "bounce_wall",
  "calc_basic",
  "calc_operation",
  "calc_rand",
  "change_effect_amount",
  "change_hex_to_rgb",
  "change_object_index",
  "change_rgb_to_hex",
  "change_scale_size",
  "change_string_case",
  "change_to_next_shape",
  "change_to_some_shape",
  "change_value_list_index",
  "change_variable",
  "char_at",
  "check_block_execution",
  "check_goal_success",
  "check_lecture_goal",
  "check_object_property",
  "check_variable_by_name",
  "choose_project_timer_action",
  "combine_something",
  "continue_repeat",
  "coordinate_mouse",
  "coordinate_object",
  "count_match_string",
  "create_clone",
  "delete_clone",
  "dialog",
  "dialog_time",
  "direction_absolute",
  "direction_relative",
  "direction_relative_duration",
  "distance_something",
  "erase_all_effects",
  "flip_x",
  "flip_y",
  "function_create",
  "function_field_boolean",
  "function_field_label",
  "function_field_string",
  "get_block_count",
  "get_boolean_value",
  "get_canvas_input_value",
  "get_date",
  "get_nickname",
  "get_pictures",
  "get_project_timer_value",
  "get_user_name",
  "get_variable",
  "hide",
  "hide_list",
  "hide_variable",
  "if_else",
  "index_of_string",
  "insert_value_to_list",
  "is_answer_submited",
  "is_boost_mode",
  "is_clicked",
  "is_current_device_type",
  "is_included_in_list",
  "is_object_clicked",
  "is_press_some_key",
  "is_touch_supported",
  "is_type",
  "length_of_list",
  "length_of_string",
  "locate",
  "locate_object_time",
  "locate_x",
  "locate_xy",
  "locate_xy_time",
  "locate_y",
  "message_cast",
  "message_cast_wait",
  "mouse_click_cancled",
  "mouse_clicked",
  "move_direction",
  "move_to_angle",
  "move_x",
  "move_xy_time",
  "move_y",
  "negative_number",
  "number",
  "positive_number",
  "quotient_and_mod",
  "reach_something",
  "register_score",
  "remove_all_clones",
  "remove_dialog",
  "remove_value_from_list",
  "repeat_basic",
  "repeat_inf",
  "repeat_while_true",
  "replace_string",
  "reset_scale_size",
  "restart_project",
  "reverse_of_string",
  "rotate_absolute",
  "rotate_by_time",
  "rotate_relative",
  "see_angle_object",
  "set_scale_size",
  "set_variable",
  "set_visible_answer",
  "set_visible_project_timer",
  "show",
  "show_list",
  "show_prompt",
  "show_variable",
  "start_neighbor_scene",
  "start_scene",
  "stop_object",
  "stop_repeat",
  "stretch_scale_size",
  "substring",
  "switch_scope",
  "text",
  "value_of_index_from_list",
  "wait_second",
  "wait_until_true",
  "when_clone_start",
  "when_message_cast",
  "when_object_click",
  "when_object_click_canceled",
  "when_run_button_click",
  "when_scene_start",
  "when_some_key_pressed",
  "wildcard_boolean",
  "wildcard_string",
]);

const SAFE_BLOCK_SET = new Set(ENTRY_SAFE_BLOCK_TYPES);
const VARIABLE_REFERENCE_TYPES = new Set([
  "change_variable",
  "get_variable",
  "hide_variable",
  "set_variable",
  "show_variable",
]);
const MESSAGE_REFERENCE_INDEX = new Map([
  ["message_cast", 0],
  ["message_cast_wait", 0],
  ["when_message_cast", 1],
]);
const SCENE_REFERENCE_INDEX = new Map([["start_scene", 0]]);
const LIST_REFERENCE_INDEX = new Map([
  ["add_value_to_list", 1],
  ["insert_value_to_list", 1],
  ["value_of_index_from_list", 1],
  ["change_value_list_index", 1],
  ["remove_value_from_list", 1],
  ["is_included_in_list", 1],
  ["length_of_list", 0],
  ["show_list", 0],
  ["hide_list", 0],
]);
const EVENT_BLOCK_TYPES = new Set([
  "when_clone_start",
  "when_message_cast",
  "when_object_click",
  "when_object_click_canceled",
  "when_run_button_click",
  "when_scene_start",
  "when_some_key_pressed",
]);

export function collectArchiveAssetNames(entries = []) {
  const names = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.name !== "string" || entry.typeFlag === "5") {
      continue;
    }
    const normalized = normalizeAssetPath(entry.name);
    names.add(normalized);
    names.add(normalized.replace(/^temp\//, ""));
    const basename = normalized.split("/").pop();
    if (basename) {
      names.add(basename);
    }
  }
  return names;
}

export function repairEntryProject(candidate, baseProject, options = {}) {
  if (!isPlainObject(baseProject)) {
    throw new Error("안전한 기준 project.json이 없어요.");
  }

  const reporter = createReporter();
  const source = isPlainObject(candidate) ? candidate : {};
  if (!isPlainObject(candidate)) {
    reporter.add("projectFallback", "AI 결과가 객체가 아니어서 기준 작품으로 복구했어요.");
  }

  const project = cloneJson(baseProject);
  const baseBlockTypes = collectProjectBlockTypes(baseProject);
  const allowedBlockTypes = new Set([...SAFE_BLOCK_SET, ...baseBlockTypes]);
  const availableAssets = options.availableAssets instanceof Set
    ? options.availableAssets
    : new Set(options.availableAssets || []);
  const baseAssetUrls = collectProjectAssetUrls(baseProject);
  const blockIds = new Set();
  const blockCounter = { value: 0 };

  project.name = cleanText(source.name, project.name || "vibentry 작품", 120);
  project.speed = finiteNumber(source.speed, project.speed, 1, 120);

  const sceneState = normalizeScenes(source.scenes, baseProject.scenes, reporter);
  project.scenes = sceneState.items;

  const legacyLists = safeArray(source.tables).filter((item) =>
    isPlainObject(item) && (item.listType === "list" || Array.isArray(item.data) || Array.isArray(item.array))
  );
  const sourceVariables = [...safeArray(source.variables), ...legacyLists.map(normalizeLegacyList)];
  const variableState = normalizeVariables(sourceVariables, baseProject.variables, reporter);
  project.variables = variableState.items;

  const messageState = normalizeMessages(source.messages, baseProject.messages, reporter);
  project.messages = messageState.items;

  const functionState = normalizeFunctions(source.functions, baseProject.functions, reporter);
  project.functions = functionState.items;
  for (const functionItem of project.functions) {
    allowedBlockTypes.add(`func_${functionItem.id}`);
  }

  const objectState = normalizeObjects(
    source.objects,
    baseProject.objects,
    sceneState,
    { availableAssets, baseAssetUrls },
    reporter
  );
  project.objects = objectState.items;

  const scriptContext = {
    allowedBlockTypes,
    blockIds,
    blockCounter,
    reporter,
    variableState,
    messageState,
    sceneState,
    functionState,
    objectState,
    blockCount: 0,
  };

  project.functions = project.functions.flatMap((functionItem, index) => {
    const raw = functionState.rawScripts[index];
    const fallback = functionState.fallbackScripts[index];
    let content = normalizeScript(raw, fallback, scriptContext, `함수 ${functionItem.id}`);
    if (!scriptHasBlockType(content, "function_create") && scriptHasBlockType(fallback, "function_create")) {
      reporter.add("functionRestored", "함수 정의 블록이 빠져 기준 함수 코드로 복구했어요.");
      content = normalizeScript(fallback, "[]", scriptContext, `함수 ${functionItem.id} 기준 코드`);
    }
    if (content === null || !scriptHasBlockType(content, "function_create")) {
      reporter.add("functionRemoved", "복구할 수 없는 함수는 안전하게 제외했어요.");
      return [];
    }
    return [{ ...functionItem, content }];
  });

  const validFunctionIds = new Set(project.functions.map((item) => item.id));
  scriptContext.validFunctionIds = validFunctionIds;
  project.objects = project.objects.map((objectItem, index) => ({
    ...objectItem,
    script: normalizeScript(
      objectState.rawScripts[index],
      objectState.fallbackScripts[index],
      scriptContext,
      `오브젝트 ${objectItem.name}`
    ) || "[]",
  }));

  project.tables = normalizeOpaqueCollection(
    safeArray(source.tables).filter((item) => !legacyLists.includes(item)),
    baseProject.tables,
    "표",
    reporter
  );
  project.interface = normalizeInterface(source.interface, baseProject.interface, project.objects, objectState);

  const objectIds = new Set(project.objects.map((item) => item.id));
  project.variables = project.variables.map((item) => ({
    ...item,
    object: item.object && objectIds.has(objectState.idMap.get(item.object) || item.object)
      ? objectState.idMap.get(item.object) || item.object
      : null,
  }));

  const validation = validateEntryProject(project, {
    baseProject,
    availableAssets,
  });

  return {
    project,
    repaired: reporter.count > 0,
    warnings: reporter.toMessages(),
    validation,
  };
}

export function validateEntryProject(project, options = {}) {
  const errors = [];
  const warnings = [];
  const stats = { objects: 0, scripts: 0, blocks: 0, assets: 0 };

  if (!isPlainObject(project)) {
    return {
      errors: ["project.json의 최상위 값이 객체가 아니에요."],
      warnings,
      stats,
    };
  }

  const requiredArrays = ["objects", "scenes", "variables", "messages", "functions", "tables"];
  for (const key of requiredArrays) {
    if (!Array.isArray(project[key])) {
      errors.push(`${key} 값이 배열이 아니에요.`);
    }
  }
  if (!Array.isArray(project.objects) || project.objects.length === 0) {
    errors.push("오브젝트가 하나도 없어요.");
  }
  if (!Array.isArray(project.scenes) || project.scenes.length === 0) {
    errors.push("장면이 하나도 없어요.");
  }
  if (!isPlainObject(project.interface)) {
    errors.push("interface 정보가 없어요.");
  }

  const objectIds = validateUniqueIds(project.objects, "오브젝트", errors);
  const sceneIds = validateUniqueIds(project.scenes, "장면", errors);
  const variableIds = validateUniqueIds(project.variables, "변수", errors);
  const listIds = new Set(safeArray(project.variables)
    .filter((item) => item?.variableType === "list")
    .map((item) => item.id));
  const messageIds = validateUniqueIds(project.messages, "신호", errors);
  const functionIds = validateUniqueIds(project.functions, "함수", errors);
  const allowedBlockTypes = new Set(ENTRY_SAFE_BLOCK_TYPES);
  for (const type of collectProjectBlockTypes(options.baseProject || {})) {
    allowedBlockTypes.add(type);
  }
  for (const id of functionIds) {
    allowedBlockTypes.add(`func_${id}`);
  }

  if (project.interface?.object && !objectIds.has(project.interface.object)) {
    errors.push("interface.object가 존재하지 않는 오브젝트를 가리켜요.");
  }

  const usedBlockIds = new Set();
  const availableAssets = options.availableAssets instanceof Set
    ? options.availableAssets
    : new Set(options.availableAssets || []);
  const baseAssetUrls = collectProjectAssetUrls(options.baseProject || {});

  for (const objectItem of Array.isArray(project.objects) ? project.objects : []) {
    stats.objects += 1;
    if (!sceneIds.has(objectItem.scene)) {
      errors.push(`${labelObject(objectItem)}의 장면 참조가 잘못됐어요.`);
    }
    validateObjectAssets(objectItem, baseAssetUrls, availableAssets, errors, warnings, stats);
    validateScript(objectItem.script, `${labelObject(objectItem)} 스크립트`, {
      errors,
      warnings,
      stats,
      usedBlockIds,
      allowedBlockTypes,
      variableIds,
      listIds,
      messageIds,
      sceneIds,
      functionIds,
    });
  }

  for (const functionItem of Array.isArray(project.functions) ? project.functions : []) {
    if (!scriptHasBlockType(functionItem.content, "function_create")) {
      errors.push(`함수 ${functionItem.id}에 함수 정의 블록이 없어요.`);
    }
    validateScript(functionItem.content, `함수 ${functionItem.id}`, {
      errors,
      warnings,
      stats,
      usedBlockIds,
      allowedBlockTypes,
      variableIds,
      listIds,
      messageIds,
      sceneIds,
      functionIds,
    });
  }

  try {
    const raw = JSON.stringify(project);
    if (raw.length > 25 * 1024 * 1024) {
      warnings.push("project.json이 25MB보다 커서 엔트리에서 느릴 수 있어요.");
    }
  } catch {
    errors.push("project.json을 JSON 문자열로 저장할 수 없어요.");
  }

  return { errors: uniqueStrings(errors), warnings: uniqueStrings(warnings), stats };
}

function normalizeScenes(candidate, fallback, reporter) {
  const fallbackItems = safeArray(fallback);
  const source = safeArray(candidate).length ? safeArray(candidate) : fallbackItems;
  if (!safeArray(candidate).length) {
    reporter.add("sceneFallback", "장면 정보가 비어 있어 기준 장면을 유지했어요.");
  }

  const used = new Set();
  const counter = { value: 0 };
  const idMap = new Map();
  const items = source.slice(0, MAX_COLLECTION_ITEMS).map((item, index) => {
    const safeItem = isPlainObject(item) ? item : {};
    const oldId = cleanId(safeItem.id);
    const template = findTemplate(fallbackItems, safeItem, index) || {};
    const id = allocateId(oldId || template.id, "s", used, counter, reporter);
    rememberId(idMap, oldId || template.id, id);
    return {
      ...cloneJson(template),
      id,
      name: cleanText(safeItem.name, template.name || `장면 ${index + 1}`, 120),
    };
  });

  if (!items.length) {
    items.push({ id: "scene1", name: "장면 1" });
    reporter.add("sceneCreated", "필수 장면이 없어 새 장면을 만들었어요.");
  }

  return { items, ids: new Set(items.map((item) => item.id)), idMap };
}

function normalizeVariables(candidate, fallback, reporter) {
  const fallbackItems = safeArray(fallback);
  const source = safeArray(candidate).length ? safeArray(candidate) : fallbackItems;
  const used = new Set();
  const counter = { value: 0 };
  const idMap = new Map();
  const items = [];

  for (const [index, item] of source.slice(0, MAX_COLLECTION_ITEMS).entries()) {
    if (!isPlainObject(item)) {
      reporter.add("invalidVariable", "형식이 잘못된 변수를 제외했어요.");
      continue;
    }
    const template = findTemplate(fallbackItems, item, index) || {};
    const oldId = cleanId(item.id);
    const id = allocateId(oldId || template.id, "v", used, counter, reporter);
    rememberId(idMap, oldId || template.id, id);
    const variableType = cleanText(item.variableType, template.variableType || "variable", 40);
    const normalized = {
      ...cloneJson(template),
      id,
      name: cleanText(item.name, template.name || `변수 ${items.length + 1}`, 120),
      visible: booleanValue(item.visible, template.visible, false),
      value: safeJsonValue(item.value, template.value ?? "0"),
      variableType,
      isCloud: booleanValue(item.isCloud, template.isCloud, false),
      isRealTime: booleanValue(item.isRealTime, template.isRealTime, false),
      cloudDate: booleanValue(item.cloudDate, template.cloudDate, false),
      object: typeof item.object === "string" ? item.object : null,
      x: finiteNumber(item.x, template.x, -100000, 100000),
      y: finiteNumber(item.y, template.y, -100000, 100000),
    };
    if (variableType === "list") {
      normalized.array = safeArray(item.array).slice(0, MAX_COLLECTION_ITEMS).map((entry) => ({
        data: cleanText(isPlainObject(entry) ? entry.data : entry, "", MAX_TEXT_LENGTH),
      }));
    }
    items.push(normalized);
  }

  for (const builtin of fallbackItems.filter((item) => item?.variableType === "timer" || item?.variableType === "answer")) {
    if (items.some((item) => item.variableType === builtin.variableType)) {
      continue;
    }
    const id = allocateId(builtin.id, "v", used, counter, reporter);
    rememberId(idMap, builtin.id, id);
    items.push({ ...cloneJson(builtin), id });
    reporter.add("builtinVariable", "엔트리 필수 기본 변수를 복원했어요.");
  }

  const nameMap = new Map(items.map((item) => [item.name, item.id]));
  return { items, ids: new Set(items.map((item) => item.id)), idMap, nameMap };
}

function normalizeLegacyList(item) {
  const values = Array.isArray(item.array) ? item.array : safeArray(item.data);
  return {
    ...item,
    variableType: "list",
    value: "0",
    array: values.map((entry) => ({ data: String(isPlainObject(entry) ? entry.data ?? "" : entry ?? "") })),
    isCloud: item.isCloud === true,
    isRealTime: item.isRealTime === true,
  };
}

function normalizeMessages(candidate, fallback, reporter) {
  const fallbackItems = safeArray(fallback);
  const source = Array.isArray(candidate) ? candidate : fallbackItems;
  const used = new Set();
  const counter = { value: 0 };
  const idMap = new Map();
  const items = [];

  for (const [index, item] of source.slice(0, MAX_COLLECTION_ITEMS).entries()) {
    if (!isPlainObject(item)) {
      reporter.add("invalidMessage", "형식이 잘못된 신호를 제외했어요.");
      continue;
    }
    const template = findTemplate(fallbackItems, item, index) || {};
    const oldId = cleanId(item.id);
    const id = allocateId(oldId || template.id, "m", used, counter, reporter);
    rememberId(idMap, oldId || template.id, id);
    items.push({
      ...cloneJson(template),
      id,
      name: cleanText(item.name, template.name || `신호 ${items.length + 1}`, 120),
    });
  }

  const nameMap = new Map(items.map((item) => [item.name, item.id]));
  return { items, ids: new Set(items.map((item) => item.id)), idMap, nameMap };
}

function normalizeFunctions(candidate, fallback, reporter) {
  const fallbackItems = safeArray(fallback);
  const source = Array.isArray(candidate) ? candidate : fallbackItems;
  const used = new Set();
  const counter = { value: 0 };
  const idMap = new Map();
  const items = [];
  const rawScripts = [];
  const fallbackScripts = [];

  for (const [index, item] of source.slice(0, MAX_COLLECTION_ITEMS).entries()) {
    if (!isPlainObject(item)) {
      reporter.add("invalidFunction", "형식이 잘못된 함수를 제외했어요.");
      continue;
    }
    const template = findTemplate(fallbackItems, item, index) || {};
    const oldId = cleanId(item.id);
    const id = allocateId(oldId || template.id, "f", used, counter, reporter);
    rememberId(idMap, oldId || template.id, id);
    items.push({
      ...cloneJson(template),
      id,
      type: item.type === "normal" || template.type !== "normal" ? cleanText(item.type, template.type || "normal", 40) : "normal",
      localVariables: Array.isArray(item.localVariables) ? cloneJson(item.localVariables) : cloneJson(template.localVariables || []),
      useLocalVariables: booleanValue(item.useLocalVariables, template.useLocalVariables, false),
    });
    rawScripts.push(item.content);
    fallbackScripts.push(template.content || "[]");
  }

  return {
    items,
    rawScripts,
    fallbackScripts,
    ids: new Set(items.map((item) => item.id)),
    idMap,
  };
}

function normalizeObjects(candidate, fallback, sceneState, assetContext, reporter) {
  const fallbackItems = safeArray(fallback);
  const source = safeArray(candidate).length ? safeArray(candidate) : fallbackItems;
  if (!safeArray(candidate).length) {
    reporter.add("objectFallback", "오브젝트가 비어 있어 기준 오브젝트를 유지했어요.");
  }

  const used = new Set();
  const counter = { value: 0 };
  const idMap = new Map();
  const nameMap = new Map();
  const items = [];
  const rawScripts = [];
  const fallbackScripts = [];

  for (const [index, item] of source.slice(0, MAX_OBJECTS).entries()) {
    if (!isPlainObject(item)) {
      reporter.add("invalidObject", "형식이 잘못된 오브젝트를 제외했어요.");
      continue;
    }
    const template = findTemplate(fallbackItems, item, index) || fallbackItems[0] || {};
    const oldId = cleanId(item.id);
    const id = allocateId(oldId || template.id, "o", used, counter, reporter);
    rememberId(idMap, oldId || template.id, id);
    const scene = resolveReference(item.scene, sceneState) || sceneState.items[0].id;
    if (item.scene && scene !== item.scene) {
      reporter.add("sceneReference", "존재하지 않는 장면 참조를 실제 장면으로 연결했어요.");
    }
    const spriteState = normalizeSprite(item.sprite, template.sprite, assetContext, reporter);
    const selectedPictureId = resolveSelectedPicture(
      item.selectedPictureId,
      spriteState,
      template.selectedPictureId,
      reporter
    );
    const name = cleanText(item.name, template.name || `오브젝트 ${items.length + 1}`, 120);
    items.push({
      ...cloneJson(template),
      id,
      name,
      objectType: cleanText(template.objectType, "sprite", 40),
      rotateMethod: ["free", "vertical", "none"].includes(item.rotateMethod)
        ? item.rotateMethod
        : template.rotateMethod || "free",
      scene,
      sprite: spriteState.sprite,
      selectedPictureId,
      lock: booleanValue(item.lock, template.lock, false),
      entity: normalizeEntity(item.entity, template.entity),
    });
    rawScripts.push(item.script);
    fallbackScripts.push(template.script || "[]");
    nameMap.set(name, id);
  }

  if (!items.length && fallbackItems[0]) {
    const template = cloneJson(fallbackItems[0]);
    const id = allocateId(template.id, "o", used, counter, reporter);
    items.push({ ...template, id, scene: sceneState.items[0].id });
    rawScripts.push(template.script || "[]");
    fallbackScripts.push(template.script || "[]");
    rememberId(idMap, template.id, id);
    nameMap.set(template.name || id, id);
    reporter.add("objectCreated", "필수 오브젝트를 기준 템플릿에서 복원했어요.");
  }

  return {
    items,
    rawScripts,
    fallbackScripts,
    ids: new Set(items.map((item) => item.id)),
    idMap,
    nameMap,
  };
}

function normalizeSprite(candidate, fallback, assetContext, reporter) {
  const safeFallback = isPlainObject(fallback) ? fallback : { pictures: [], sounds: [] };
  const safeCandidate = isPlainObject(candidate) ? candidate : {};
  const pictureState = normalizeAssets(
    safeCandidate.pictures,
    safeFallback.pictures,
    "picture",
    assetContext,
    reporter
  );
  const soundState = normalizeAssets(
    safeCandidate.sounds,
    safeFallback.sounds,
    "sound",
    assetContext,
    reporter
  );

  return {
    sprite: {
      ...cloneJson(safeFallback),
      pictures: pictureState.items,
      sounds: soundState.items,
    },
    pictureIds: pictureState.ids,
    pictureIdMap: pictureState.idMap,
    pictureNameMap: pictureState.nameMap,
    soundIds: soundState.ids,
    soundIdMap: soundState.idMap,
    soundNameMap: soundState.nameMap,
  };
}

function normalizeAssets(candidate, fallback, kind, assetContext, reporter) {
  const fallbackItems = safeArray(fallback);
  const source = Array.isArray(candidate) ? candidate : fallbackItems;
  const used = new Set();
  const counter = { value: 0 };
  const idMap = new Map();
  const items = [];

  for (const [index, item] of source.slice(0, MAX_COLLECTION_ITEMS).entries()) {
    if (!isPlainObject(item)) {
      reporter.add("invalidAsset", "형식이 잘못된 그림이나 소리를 제외했어요.");
      continue;
    }
    const template = findTemplate(fallbackItems, item, index) || {};
    const fileurl = cleanText(item.fileurl, template.fileurl || "", MAX_DATA_URL_LENGTH);
    if (!isUsableAssetUrl(fileurl, assetContext.baseAssetUrls, assetContext.availableAssets)) {
      reporter.add("assetFallback", "확인할 수 없는 이미지·소리 경로를 기준 자산으로 되돌렸어요.");
      continue;
    }
    const oldId = cleanId(item.id);
    const id = allocateId(oldId || template.id, kind === "picture" ? "p" : "a", used, counter, reporter);
    rememberId(idMap, oldId || template.id, id);
    const normalized = {
      ...cloneJson(template),
      id,
      name: cleanText(item.name, template.name || `${kind} ${items.length + 1}`, 160),
      fileurl,
    };
    if (kind === "picture") {
      normalized.thumbUrl = isUsableAssetUrl(item.thumbUrl, assetContext.baseAssetUrls, assetContext.availableAssets)
        ? item.thumbUrl
        : fileurl;
      normalized.dimension = normalizeDimension(item.dimension, template.dimension);
      normalized.imageType = cleanText(item.imageType, template.imageType || inferImageType(fileurl), 20);
    } else {
      normalized.duration = finiteNumber(item.duration, template.duration, 0, 24 * 60 * 60);
      normalized.ext = cleanText(item.ext, template.ext || inferExtension(fileurl), 16);
    }
    items.push(normalized);
  }

  if (!items.length && fallbackItems.length) {
    for (const item of fallbackItems) {
      const id = allocateId(item.id, kind === "picture" ? "p" : "a", used, counter, reporter);
      items.push({ ...cloneJson(item), id });
      rememberId(idMap, item.id, id);
    }
    reporter.add("assetRestored", "오브젝트가 보이도록 기준 그림·소리를 복원했어요.");
  }

  return {
    items,
    ids: new Set(items.map((item) => item.id)),
    idMap,
    nameMap: new Map(items.map((item) => [item.name, item.id])),
  };
}

function resolveSelectedPicture(candidateId, spriteState, fallbackId, reporter) {
  const resolved = spriteState.pictureIdMap.get(candidateId) || candidateId;
  if (resolved && spriteState.pictureIds.has(resolved)) {
    return resolved;
  }
  const fallbackResolved = spriteState.pictureIdMap.get(fallbackId) || fallbackId;
  if (fallbackResolved && spriteState.pictureIds.has(fallbackResolved)) {
    reporter.add("pictureReference", "선택 그림 참조를 실제 그림 ID로 복구했어요.");
    return fallbackResolved;
  }
  const first = spriteState.sprite.pictures[0]?.id || null;
  if (first) {
    reporter.add("pictureReference", "선택 그림 참조를 첫 번째 그림으로 복구했어요.");
  }
  return first;
}

function normalizeEntity(candidate, fallback) {
  const source = isPlainObject(candidate) ? candidate : {};
  const base = isPlainObject(fallback) ? fallback : {};
  return {
    ...cloneJson(base),
    x: finiteNumber(source.x, base.x, -100000, 100000),
    y: finiteNumber(source.y, base.y, -100000, 100000),
    regX: finiteNumber(source.regX, base.regX, -100000, 100000),
    regY: finiteNumber(source.regY, base.regY, -100000, 100000),
    scaleX: finiteNumber(source.scaleX, base.scaleX, -100, 100),
    scaleY: finiteNumber(source.scaleY, base.scaleY, -100, 100),
    rotation: finiteNumber(source.rotation, base.rotation, -100000, 100000),
    direction: finiteNumber(source.direction, base.direction, -100000, 100000),
    width: finiteNumber(source.width, base.width, 0, 100000),
    height: finiteNumber(source.height, base.height, 0, 100000),
    font: cleanText(source.font, base.font || "undefinedpx ", 200),
    visible: booleanValue(source.visible, base.visible, true),
  };
}

function normalizeDimension(candidate, fallback) {
  const source = isPlainObject(candidate) ? candidate : {};
  const base = isPlainObject(fallback) ? fallback : {};
  return {
    width: finiteNumber(source.width, base.width, 1, 100000),
    height: finiteNumber(source.height, base.height, 1, 100000),
  };
}

function normalizeInterface(candidate, fallback, objects, objectState) {
  const source = isPlainObject(candidate) ? candidate : {};
  const base = isPlainObject(fallback) ? fallback : {};
  const objectIds = new Set(objects.map((item) => item.id));
  const requested = objectState.idMap.get(source.object) || source.object;
  const selected = requested && objectIds.has(requested) ? requested : objects[0]?.id || null;
  return {
    ...cloneJson(base),
    menuWidth: finiteNumber(source.menuWidth, base.menuWidth, 0, 5000),
    canvasWidth: finiteNumber(source.canvasWidth, base.canvasWidth, 1, 10000),
    object: selected,
  };
}

function normalizeOpaqueCollection(candidate, fallback, label, reporter) {
  if (!Array.isArray(candidate)) {
    return cloneJson(safeArray(fallback));
  }
  const safeItems = candidate
    .slice(0, MAX_COLLECTION_ITEMS)
    .filter(isPlainObject)
    .map((item) => safeJsonValue(item, {}));
  if (safeItems.length !== candidate.length) {
    reporter.add("opaqueCollection", `형식이 잘못된 ${label} 항목을 제외했어요.`);
  }
  return safeItems;
}

function normalizeScript(rawValue, fallbackValue, context, label) {
  const parsed = parseScript(rawValue);
  const fallback = parseScript(fallbackValue);
  let source = parsed;
  if (!source) {
    source = fallback;
    context.reporter.add("scriptFallback", `${label}의 깨진 스크립트 JSON을 기준 코드로 복구했어요.`);
  }
  if (!source) {
    return null;
  }

  const normalized = [];
  let sourceBlockCount = 0;
  for (const thread of source.slice(0, MAX_SCRIPT_THREADS)) {
    if (!Array.isArray(thread)) {
      context.reporter.add("invalidThread", `${label}의 잘못된 코드 묶음을 제외했어요.`);
      continue;
    }
    const blocks = [];
    for (const rawBlock of thread) {
      sourceBlockCount += 1;
      const block = normalizeBlock(rawBlock, context, 0, label);
      if (block) {
        blocks.push(block);
        if (EVENT_BLOCK_TYPES.has(block.type) && block.statements.some((statement) => statement.length)) {
          blocks.push(...block.statements.flat());
          block.statements = [];
          context.reporter.add("eventBodyFlattened", `${label}의 이벤트 안쪽 코드를 실행 순서에 맞게 복구했어요.`);
        }
      }
    }
    if (blocks.length) {
      normalized.push(blocks);
    }
  }

  if (sourceBlockCount > 0 && normalized.length === 0 && fallback && source !== fallback) {
    context.reporter.add("scriptRestored", `${label}에서 사용할 수 있는 블록이 없어 기준 코드를 유지했어요.`);
    return normalizeScript(fallbackValue, "[]", context, `${label} 기준 코드`);
  }

  return JSON.stringify(normalized);
}

function normalizeBlock(rawBlock, context, depth, label) {
  if (!isPlainObject(rawBlock) || depth > MAX_BLOCK_DEPTH || context.blockCount >= MAX_BLOCKS) {
    context.reporter.add("invalidBlock", `${label}의 형식이 잘못된 블록을 제외했어요.`);
    return null;
  }

  let type = cleanText(rawBlock.type, "", 120);
  if (type.startsWith("func_")) {
    const oldFunctionId = type.slice(5);
    const mappedFunctionId = context.functionState.idMap.get(oldFunctionId) || oldFunctionId;
    type = `func_${mappedFunctionId}`;
  }
  if (!type || !context.allowedBlockTypes.has(type)) {
    context.reporter.add("unknownBlock", `엔트리에 확인되지 않은 블록(${type || "이름 없음"})을 제외했어요.`);
    return null;
  }

  context.blockCount += 1;
  const id = allocateId(rawBlock.id, "b", context.blockIds, context.blockCounter, context.reporter);
  const params = Array.isArray(rawBlock.params)
    ? rawBlock.params.map((value) => normalizeBlockValue(value, context, depth + 1, label))
    : [];
  const statements = Array.isArray(rawBlock.statements)
    ? rawBlock.statements.map((statement) => {
        if (!Array.isArray(statement)) {
          context.reporter.add("invalidStatement", `${label}의 잘못된 실행 공간을 비웠어요.`);
          return [];
        }
        return statement
          .map((child) => normalizeBlock(child, context, depth + 1, label))
          .filter(Boolean);
      })
    : [];

  const block = {
    id,
    x: finiteNumber(rawBlock.x, 0, -1000000, 1000000),
    y: finiteNumber(rawBlock.y, 0, -1000000, 1000000),
    type,
    params,
    statements,
    movable: rawBlock.movable === true || rawBlock.movable === false ? rawBlock.movable : null,
    deletable: rawBlock.deletable === false ? false : 1,
    emphasized: rawBlock.emphasized === true,
    readOnly: rawBlock.readOnly === true || rawBlock.readOnly === false ? rawBlock.readOnly : null,
    copyable: rawBlock.copyable !== false,
    assemble: rawBlock.assemble !== false,
    extensions: Array.isArray(rawBlock.extensions) ? safeJsonValue(rawBlock.extensions, []) : [],
  };

  if (!repairBlockReference(block, context)) {
    context.reporter.add("brokenReference", `${label}에서 없는 변수·신호·장면을 가리키는 블록을 제외했어요.`);
    return null;
  }
  return block;
}

function normalizeBlockValue(value, context, depth, label) {
  if (depth > MAX_BLOCK_DEPTH) {
    context.reporter.add("blockValueDepth", `${label}의 지나치게 깊은 블록 값을 비웠어요.`);
    return null;
  }
  if (isPlainObject(value) && typeof value.type === "string") {
    return normalizeBlock(value, context, depth, label);
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_COLLECTION_ITEMS).map((item) => normalizeBlockValue(item, context, depth + 1, label));
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return Number.isFinite(value) || typeof value !== "number" ? value : 0;
  }
  if (typeof value === "string") {
    return value.slice(0, MAX_TEXT_LENGTH);
  }
  return null;
}

function repairBlockReference(block, context) {
  if (VARIABLE_REFERENCE_TYPES.has(block.type)) {
    return replaceRequiredReference(block.params, 0, context.variableState);
  }
  if (MESSAGE_REFERENCE_INDEX.has(block.type)) {
    return replaceRequiredReference(block.params, MESSAGE_REFERENCE_INDEX.get(block.type), context.messageState);
  }
  if (SCENE_REFERENCE_INDEX.has(block.type)) {
    return replaceRequiredReference(block.params, SCENE_REFERENCE_INDEX.get(block.type), context.sceneState);
  }
  if (LIST_REFERENCE_INDEX.has(block.type)) {
    const index = LIST_REFERENCE_INDEX.get(block.type);
    const current = block.params[index];
    const resolved = resolveReference(current, context.variableState);
    const list = context.variableState.items.find((item) => item.id === resolved && item.variableType === "list");
    if (!list) {
      return false;
    }
    block.params[index] = list.id;
  }
  if (block.type.startsWith("func_")) {
    const id = block.type.slice(5);
    return context.validFunctionIds
      ? context.validFunctionIds.has(id)
      : context.functionState.ids.has(id);
  }
  return true;
}

function replaceRequiredReference(params, index, state) {
  const current = params[index];
  if (typeof current !== "string") {
    return false;
  }
  const resolved = resolveReference(current, state);
  if (!resolved) {
    return false;
  }
  params[index] = resolved;
  return true;
}

function validateObjectAssets(objectItem, baseAssetUrls, availableAssets, errors, warnings, stats) {
  const pictures = objectItem.sprite?.pictures;
  if (!Array.isArray(pictures) || pictures.length === 0) {
    errors.push(`${labelObject(objectItem)}에 그림이 없어요.`);
    return;
  }
  const pictureIds = validateUniqueIds(pictures, `${labelObject(objectItem)} 그림`, errors);
  if (!pictureIds.has(objectItem.selectedPictureId)) {
    errors.push(`${labelObject(objectItem)}의 선택 그림 ID가 잘못됐어요.`);
  }
  for (const picture of pictures) {
    stats.assets += 1;
    if (!isUsableAssetUrl(picture.fileurl, baseAssetUrls, availableAssets)) {
      errors.push(`${labelObject(objectItem)}의 그림 파일 경로를 사용할 수 없어요.`);
    }
    if (!Number.isFinite(Number(picture.dimension?.width)) || !Number.isFinite(Number(picture.dimension?.height))) {
      errors.push(`${labelObject(objectItem)}의 그림 크기 정보가 잘못됐어요.`);
    }
  }
  for (const sound of safeArray(objectItem.sprite?.sounds)) {
    stats.assets += 1;
    if (!isUsableAssetUrl(sound.fileurl, baseAssetUrls, availableAssets)) {
      warnings.push(`${labelObject(objectItem)}의 소리 경로를 확인할 수 없어 재생되지 않을 수 있어요.`);
    }
  }
}

function validateScript(rawValue, label, context) {
  const script = parseScript(rawValue);
  if (!script) {
    context.errors.push(`${label}가 올바른 JSON 배열이 아니에요.`);
    return;
  }
  context.stats.scripts += 1;
  if (script.length > MAX_SCRIPT_THREADS) {
    context.errors.push(`${label}의 코드 묶음이 너무 많아요.`);
  }
  for (const thread of script) {
    if (!Array.isArray(thread)) {
      context.errors.push(`${label}에 배열이 아닌 코드 묶음이 있어요.`);
      continue;
    }
    for (const block of thread) {
      validateBlock(block, label, context, 0);
    }
  }
}

function validateBlock(block, label, context, depth) {
  if (!isPlainObject(block)) {
    context.errors.push(`${label}에 객체가 아닌 블록이 있어요.`);
    return;
  }
  if (depth > MAX_BLOCK_DEPTH) {
    context.errors.push(`${label}의 블록 중첩이 너무 깊어요.`);
    return;
  }
  context.stats.blocks += 1;
  if (context.stats.blocks > MAX_BLOCKS) {
    context.errors.push("작품 전체 블록 수가 안전 한도를 넘었어요.");
    return;
  }
  if (!cleanId(block.id)) {
    context.errors.push(`${label}에 ID가 없는 블록이 있어요.`);
  } else if (context.usedBlockIds.has(block.id)) {
    context.errors.push(`${label}에 중복 블록 ID(${block.id})가 있어요.`);
  } else {
    context.usedBlockIds.add(block.id);
  }
  if (!context.allowedBlockTypes.has(block.type)) {
    context.errors.push(`${label}에 지원 여부를 확인할 수 없는 블록(${block.type})이 있어요.`);
  }
  if (!Array.isArray(block.params) || !Array.isArray(block.statements)) {
    context.errors.push(`${label}의 ${block.type || "이름 없는"} 블록 구조가 잘못됐어요.`);
    return;
  }
  if (VARIABLE_REFERENCE_TYPES.has(block.type) && !context.variableIds.has(block.params[0])) {
    context.errors.push(`${label}의 ${block.type} 블록이 없는 변수를 가리켜요.`);
  }
  if (LIST_REFERENCE_INDEX.has(block.type)) {
    const listId = block.params[LIST_REFERENCE_INDEX.get(block.type)];
    if (!context.listIds.has(listId)) {
      context.errors.push(`${label}의 ${block.type} 블록이 없는 리스트를 가리켜요.`);
    }
  }
  if (
    MESSAGE_REFERENCE_INDEX.has(block.type)
    && !context.messageIds.has(block.params[MESSAGE_REFERENCE_INDEX.get(block.type)])
  ) {
    context.errors.push(`${label}의 ${block.type} 블록이 없는 신호를 가리켜요.`);
  }
  if (
    SCENE_REFERENCE_INDEX.has(block.type)
    && !context.sceneIds.has(block.params[SCENE_REFERENCE_INDEX.get(block.type)])
  ) {
    context.errors.push(`${label}의 ${block.type} 블록이 없는 장면을 가리켜요.`);
  }
  if (block.type.startsWith("func_") && !context.functionIds.has(block.type.slice(5))) {
    context.errors.push(`${label}의 함수 호출 블록이 없는 함수를 가리켜요.`);
  }
  for (const value of block.params) {
    if (isPlainObject(value) && typeof value.type === "string") {
      validateBlock(value, label, context, depth + 1);
    }
  }
  for (const statement of block.statements) {
    if (!Array.isArray(statement)) {
      context.errors.push(`${label}에 잘못된 실행 공간이 있어요.`);
      continue;
    }
    for (const child of statement) {
      validateBlock(child, label, context, depth + 1);
    }
  }
}

function parseScript(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function scriptHasBlockType(value, expectedType) {
  const script = parseScript(value);
  if (!script) {
    return false;
  }
  const queue = script.flatMap((thread) => safeArray(thread));
  while (queue.length) {
    const block = queue.shift();
    if (!isPlainObject(block)) {
      continue;
    }
    if (block.type === expectedType) {
      return true;
    }
    for (const param of safeArray(block.params)) {
      if (isPlainObject(param)) {
        queue.push(param);
      }
    }
    for (const statement of safeArray(block.statements)) {
      queue.push(...safeArray(statement));
    }
  }
  return false;
}

function collectProjectBlockTypes(project) {
  const types = new Set();
  const scripts = [
    ...safeArray(project?.objects).map((item) => item?.script),
    ...safeArray(project?.functions).map((item) => item?.content),
  ];
  for (const scriptValue of scripts) {
    const script = parseScript(scriptValue);
    if (!script) {
      continue;
    }
    for (const thread of script) {
      if (!Array.isArray(thread)) {
        continue;
      }
      for (const block of thread) {
        collectBlockTypes(block, types, 0);
      }
    }
  }
  return types;
}

function collectBlockTypes(block, types, depth) {
  if (!isPlainObject(block) || depth > MAX_BLOCK_DEPTH) {
    return;
  }
  if (typeof block.type === "string") {
    types.add(block.type);
  }
  for (const param of safeArray(block.params)) {
    if (isPlainObject(param)) {
      collectBlockTypes(param, types, depth + 1);
    }
  }
  for (const statement of safeArray(block.statements)) {
    for (const child of safeArray(statement)) {
      collectBlockTypes(child, types, depth + 1);
    }
  }
}

function collectProjectAssetUrls(project) {
  const urls = new Set();
  for (const objectItem of safeArray(project?.objects)) {
    for (const picture of safeArray(objectItem?.sprite?.pictures)) {
      if (typeof picture?.fileurl === "string") {
        urls.add(picture.fileurl);
      }
      if (typeof picture?.thumbUrl === "string") {
        urls.add(picture.thumbUrl);
      }
    }
    for (const sound of safeArray(objectItem?.sprite?.sounds)) {
      if (typeof sound?.fileurl === "string") {
        urls.add(sound.fileurl);
      }
    }
  }
  return urls;
}

function isUsableAssetUrl(value, baseAssetUrls, availableAssets) {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }
  const isBuiltIn = /^\.\/bower_components\/entry-js\//.test(value);
  const isRemote = /^https?:\/\//i.test(value);
  if (baseAssetUrls.has(value) && (isBuiltIn || isRemote)) {
    return true;
  }
  if (/^data:(image|audio)\/[a-z0-9.+-]+;base64,/i.test(value)) {
    return value.length <= MAX_DATA_URL_LENGTH;
  }
  const normalized = normalizeAssetPath(value);
  return availableAssets.has(normalized)
    || availableAssets.has(normalized.replace(/^temp\//, ""))
    || availableAssets.has(normalized.split("/").pop());
}

function normalizeAssetPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");
}

function resolveReference(value, state) {
  if (typeof value !== "string") {
    return null;
  }
  const mapped = state.idMap?.get(value) || state.nameMap?.get(value) || value;
  return state.ids?.has(mapped) ? mapped : null;
}

function validateUniqueIds(items, label, errors) {
  const ids = new Set();
  for (const item of safeArray(items)) {
    const id = cleanId(item?.id);
    if (!id) {
      errors.push(`${label} 항목에 ID가 없어요.`);
      continue;
    }
    if (ids.has(id)) {
      errors.push(`${label} ID(${id})가 중복됐어요.`);
      continue;
    }
    ids.add(id);
  }
  return ids;
}

function findTemplate(fallbackItems, item, index) {
  return fallbackItems.find((candidate) => candidate?.id && candidate.id === item?.id)
    || fallbackItems.find((candidate) => candidate?.name && candidate.name === item?.name)
    || fallbackItems[index]
    || null;
}

function allocateId(preferred, prefix, used, counter, reporter) {
  const cleaned = cleanId(preferred);
  if (cleaned && !used.has(cleaned)) {
    used.add(cleaned);
    return cleaned;
  }
  let generated;
  do {
    counter.value += 1;
    generated = `${prefix}${counter.value.toString(36).padStart(3, "0")}`;
  } while (used.has(generated));
  used.add(generated);
  reporter.add("idRepair", "비어 있거나 중복된 ID를 새 ID로 바꿨어요.");
  return generated;
}

function rememberId(map, oldId, newId) {
  if (typeof oldId === "string" && oldId && !map.has(oldId)) {
    map.set(oldId, newId);
  }
}

function cleanId(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(trimmed) ? trimmed : "";
}

function cleanText(value, fallback = "", maxLength = MAX_TEXT_LENGTH) {
  const selected = typeof value === "string" && value.trim() ? value : fallback;
  return String(selected ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, maxLength);
}

function finiteNumber(value, fallback = 0, min = -Infinity, max = Infinity) {
  const number = value === null || value === undefined || value === "" ? Number.NaN : Number(value);
  const fallbackNumber = fallback === null || fallback === undefined || fallback === ""
    ? Number.NaN
    : Number(fallback);
  const selected = Number.isFinite(number) ? number : Number.isFinite(fallbackNumber) ? fallbackNumber : 0;
  return Math.max(min, Math.min(max, selected));
}

function booleanValue(value, fallback, defaultValue) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof fallback === "boolean") {
    return fallback;
  }
  return defaultValue;
}

function safeJsonValue(value, fallback, depth = 0) {
  if (depth > 16) {
    return cloneJson(fallback);
  }
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    return value.slice(0, MAX_TEXT_LENGTH);
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_COLLECTION_ITEMS).map((item) => safeJsonValue(item, null, depth + 1));
  }
  if (isPlainObject(value)) {
    const result = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_COLLECTION_ITEMS)) {
      result[cleanText(key, "key", 160)] = safeJsonValue(item, null, depth + 1);
    }
    return result;
  }
  return cloneJson(fallback);
}

function inferImageType(fileurl) {
  const match = String(fileurl).match(/\.([a-z0-9]+)(?:[?#]|$)/i);
  return match?.[1]?.toLowerCase() || "png";
}

function inferExtension(fileurl) {
  const match = String(fileurl).match(/(\.[a-z0-9]+)(?:[?#]|$)/i);
  return match?.[1]?.toLowerCase() || ".mp3";
}

function labelObject(objectItem) {
  return `오브젝트 ${objectItem?.name || objectItem?.id || "이름 없음"}`;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function createReporter() {
  const issues = new Map();
  return {
    count: 0,
    add(code, message) {
      this.count += 1;
      const current = issues.get(code) || { message, count: 0 };
      current.count += 1;
      issues.set(code, current);
    },
    toMessages() {
      return [...issues.values()].map((issue) => (
        issue.count > 1 ? `${issue.message} (${issue.count}곳)` : issue.message
      ));
    },
  };
}
