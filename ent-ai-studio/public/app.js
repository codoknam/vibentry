import {
  ENTRY_SAFE_BLOCK_TYPES,
  collectArchiveAssetNames,
  repairEntryProject,
  validateEntryProject,
} from "./entry-safety.js";
import { buildEntBlob, readEntArchive } from "./entry-archive.js";

const storageKeys = {
  apiKey: "vibentry:api-key",
  remember: "vibentry:remember-key",
  prompt: "vibentry:last-prompt",
  mode: "vibentry:last-mode",
  history: "vibentry:history",
};

const autoModelCandidates = [
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-flash-latest",
  "gemini-2.5-pro",
];

const requestSchema = {
  type: "object",
  properties: {
    assistant_message: { type: "string" },
    project_name: { type: "string" },
    download_name: { type: "string" },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
    project_json: {
      type: "object",
      additionalProperties: true,
    },
  },
  required: ["assistant_message", "project_name", "project_json"],
  additionalProperties: true,
};

const samplePrompts = {
  quiz:
    "초보도 쉽게 쓸 수 있는 퀴즈 작품을 만들어 줘. 시작 버튼, 점수 변수, 문제 3개, 정답과 오답 메시지, 다시 시작 버튼을 넣어 줘.",
  story:
    "짧은 스토리 작품을 만들어 줘. 등장인물 2명, 장면 전환 3번, 다음 버튼, 마지막 다시 보기 버튼을 넣어 줘.",
  tool:
    "학습 도우미 작품을 만들어 줘. 단어 카드가 하나씩 나오고 설명과 다음 버튼이 보이게 해 줘.",
};

const apiKeyInput = document.querySelector("#apiKey");
const rememberKeyInput = document.querySelector("#rememberKey");
const promptInput = document.querySelector("#userPrompt");
const fileInput = document.querySelector("#fileInput");
const fileList = document.querySelector("#fileList");
const historyList = document.querySelector("#historyList");
const modelStatus = document.querySelector("#modelStatus");
const statusBox = document.querySelector("#statusBox");
const alertBox = document.querySelector("#alertBox");
const responseBox = document.querySelector("#responseBox");
const assistantFiles = document.querySelector("#assistantFiles");
const projectSummary = document.querySelector("#projectSummary");
const generateBtn = document.querySelector("#generateBtn");
const modeButtons = [...document.querySelectorAll(".mode-btn")];
const sampleButtons = [...document.querySelectorAll(".soft-btn[data-sample]")];
const previewEmpty = document.querySelector("#previewEmpty");
const previewShell = document.querySelector("#previewShell");
const previewMeta = document.querySelector("#previewMeta");
const previewSceneList = document.querySelector("#previewSceneList");
const stagePreview = document.querySelector("#stagePreview");
const objectList = document.querySelector("#objectList");
const objectDetail = document.querySelector("#objectDetail");
const variableList = document.querySelector("#variableList");
const projectInspector = document.querySelector("#projectInspector");

let currentMode = "create";
let starterTemplate = null;
let loadedFiles = [];
let generatedProject = null;
let generatedProjectName = "vibentry-project";
let generatedArchiveEntries = [];
let generatedBaseProject = null;
let generatedValidation = null;
let historyEntries = [];
let selectedObjectId = null;
let selectedModelName = "";

init().catch((error) => {
  setStatus(`초기화 실패: ${error.message}`, false);
  setAlert("페이지를 준비하는 중 문제가 생겼어요. 새로고침 후 다시 시도해 주세요.", "error");
});

async function init() {
  restoreLocalState();
  bindEvents();
  updateAutoModelHint();
  historyEntries = loadHistoryEntries();
  renderHistory();
  await loadStarterTemplate();
  renderPreviewFromState();
  renderAssistantFiles();
  setStatus("준비 완료. 만들고 싶은 엔트리 작품을 적어 주세요.", false);
}

function bindEvents() {
  rememberKeyInput.addEventListener("change", () => {
    persistLocalState();
    updateAutoModelHint();
  });
  apiKeyInput.addEventListener("input", () => {
    persistLocalState();
    updateAutoModelHint();
  });
  promptInput.addEventListener("input", persistLocalState);

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode || "create"));
  });

  sampleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const sample = samplePrompts[button.dataset.sample];
      if (!sample) {
        return;
      }
      promptInput.value = sample;
      persistLocalState();
      setStatus("예시 프롬프트를 넣어 두었어요. 그대로 쓰거나 수정해도 됩니다.", false);
    });
  });

  fileInput.addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    await loadSelectedFiles(files);
  });

  generateBtn.addEventListener("click", handleGenerate);
}

function restoreLocalState() {
  const remember = localStorage.getItem(storageKeys.remember) === "true";
  const savedApiKey = localStorage.getItem(storageKeys.apiKey) || "";
  const savedPrompt = localStorage.getItem(storageKeys.prompt) || "";
  const savedMode = localStorage.getItem(storageKeys.mode) || "create";

  rememberKeyInput.checked = remember;
  if (remember) {
    apiKeyInput.value = savedApiKey;
  }
  promptInput.value = savedPrompt;
  setMode(savedMode, false);
}

function persistLocalState() {
  localStorage.setItem(storageKeys.remember, String(rememberKeyInput.checked));
  localStorage.setItem(storageKeys.prompt, promptInput.value);
  localStorage.setItem(storageKeys.mode, currentMode);

  if (rememberKeyInput.checked) {
    localStorage.setItem(storageKeys.apiKey, apiKeyInput.value);
  } else {
    localStorage.removeItem(storageKeys.apiKey);
  }
}

function updateAutoModelHint() {
  if (!apiKeyInput.value.trim()) {
    modelStatus.textContent = "API 키를 넣으면 자동으로 제미나이 모델을 선택해요.";
    return;
  }

  const modelName = selectedModelName || autoModelCandidates[0];
  modelStatus.textContent = `자동 선택 준비됨: ${modelName}`;
}

function setMode(mode, save = true) {
  currentMode = mode === "edit" ? "edit" : "create";
  modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === currentMode);
  });
  if (save) {
    persistLocalState();
  }
}

async function loadStarterTemplate() {
  const response = await fetch("/api/template");
  const data = await response.json();
  if (!response.ok || !data.ok || !data.project) {
    throw new Error(data.error || "기본 템플릿을 불러오지 못했어요.");
  }
  starterTemplate = data.project;
}

async function loadSelectedFiles(files) {
  if (!files.length) {
    loadedFiles = [];
    renderFileList();
    renderPreviewFromState();
    setStatus("선택된 파일이 없어요.", false);
    return;
  }

  setStatus("업로드한 파일을 읽는 중이에요...", true);
  clearAlert();
  loadedFiles = [];

  for (const file of files) {
    try {
      loadedFiles.push(await inspectFile(file));
    } catch (error) {
      loadedFiles.push({
        kind: "error",
        name: file.name,
        size: file.size,
        summary: `읽기 실패: ${error.message}`,
      });
    }
  }

  renderFileList();
  renderPreviewFromState();
  setStatus("파일을 읽었어요. 이제 바로 생성할 수 있어요.", false);
}

async function inspectFile(file) {
  if (file.name.toLowerCase().endsWith(".ent")) {
    const archive = await readEntArchive(file);
    const project = archive.project;
    return {
      kind: "ent",
      name: file.name,
      size: file.size,
      project,
      archiveEntries: archive.entries,
      summary: summarizeProject(project),
    };
  }

  if (isTextLike(file)) {
    const text = await file.text();
    return {
      kind: "text",
      name: file.name,
      size: file.size,
      text,
      summary: `텍스트 파일, ${Math.min(text.length, 120000).toLocaleString()}자 읽음`,
    };
  }

  return {
    kind: "binary",
    name: file.name,
    size: file.size,
    summary: "바이너리 파일이라 파일 이름과 크기만 참고 자료로 전달해요.",
  };
}

function isTextLike(file) {
  const lower = file.name.toLowerCase();
  return (
    file.type.startsWith("text/") ||
    lower.endsWith(".json") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".js") ||
    lower.endsWith(".ts") ||
    lower.endsWith(".html") ||
    lower.endsWith(".css") ||
    lower.endsWith(".csv")
  );
}

function summarizeProject(project) {
  const objectCount = countItems(project?.objects);
  const variableCount = countItems(project?.variables);
  const functionCount = countItems(project?.functions);
  const objectNames = (Array.isArray(project?.objects) ? project.objects : [])
    .slice(0, 6)
    .map((item) => item.name || item.id || "이름 없음")
    .join(", ");

  return [
    `작품 이름: ${project?.name || "(이름 없음)"}`,
    `오브젝트 수: ${objectCount}`,
    `변수 수: ${variableCount}`,
    `함수 수: ${functionCount}`,
    objectNames ? `오브젝트 목록: ${objectNames}` : "",
  ].filter(Boolean).join("\n");
}

function renderFileList() {
  if (!loadedFiles.length) {
    fileList.className = "file-list compact empty";
    fileList.textContent = "아직 불러온 파일이 없어요.";
    return;
  }

  fileList.className = "file-list compact";
  fileList.innerHTML = loadedFiles.map((file) => `
    <article class="file-card">
      <h3>${escapeHtml(file.name)}</h3>
      <div class="file-meta">
        <div>종류: ${escapeHtml(file.kind)}</div>
        <div>크기: ${Number(file.size || 0).toLocaleString()} bytes</div>
        <div>${escapeHtml(file.summary)}</div>
      </div>
    </article>
  `).join("");
}

async function handleGenerate() {
  clearAlert();

  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    setStatus("Gemini API 키를 먼저 넣어 주세요.", false);
    setAlert("API 키가 비어 있어요. Google AI Studio에서 받은 Gemini API 키를 먼저 입력해 주세요.", "warning");
    return;
  }

  if (!starterTemplate) {
    setStatus("기본 템플릿이 아직 준비되지 않았어요.", false);
    setAlert("서버에서 기본 템플릿을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.", "error");
    return;
  }

  if (!promptInput.value.trim()) {
    setStatus("어떤 작품을 만들지 적어 주세요.", false);
    setAlert("프롬프트가 비어 있어요. 쉬운 문장으로 1~3줄 정도만 적어도 충분해요.", "warning");
    return;
  }

  if (currentMode === "edit" && !getPrimaryEntFile()) {
    setStatus("수정 모드에서는 .ent 파일이 필요해요.", false);
    setAlert("지금은 수정 모드예요. 수정할 `.ent` 파일을 먼저 올려 주세요.", "warning");
    return;
  }

  generatedProject = null;
  generatedArchiveEntries = [];
  generatedBaseProject = null;
  generatedValidation = null;
  renderAssistantFiles();
  generateBtn.disabled = true;
  setStatus("Gemini가 엔트리 작품 구조를 만드는 중이에요...", true);

  try {
    const prompt = buildPromptV2();
    const rawResult = await callGeminiAuto(apiKey, prompt);
    const result = normalizeSimpleRequestResult(promptInput.value.trim(), rawResult) || {};
    const primaryEnt = getPrimaryEntFile();
    const baseProject = currentMode === "edit" && primaryEnt ? primaryEnt.project : starterTemplate;
    const sourceEntries = currentMode === "edit" && primaryEnt ? primaryEnt.archiveEntries || [] : [];
    const availableAssets = collectArchiveAssetNames(sourceEntries);
    const candidateProject = result.project_name && result.project_json && typeof result.project_json === "object"
      ? { ...result.project_json, name: result.project_name }
      : result.project_json;
    const safety = repairEntryProject(candidateProject, baseProject, {
      mode: currentMode,
      availableAssets,
    });

    if (safety.validation.errors.length) {
      throw {
        kind: "project_validation",
        message: "AI 결과를 자동 복구한 뒤에도 안전 검사 오류가 남았어요.",
        issues: safety.validation.errors,
      };
    }

    result.project_json = safety.project;
    result.warnings = uniqueTextItems([
      ...(Array.isArray(result.warnings) ? result.warnings : []),
      ...safety.warnings,
      ...safety.validation.warnings,
    ]);
    result.safety_summary = safety.repaired
      ? `안전 컴파일 완료: ${safety.warnings.length}종류를 자동 복구하고 ${safety.validation.stats.blocks}개 블록을 검사했어요.`
      : `안전 검사 통과: ${safety.validation.stats.blocks}개 블록과 모든 주요 참조를 확인했어요.`;

    generatedProject = safety.project;
    generatedArchiveEntries = sourceEntries;
    generatedBaseProject = baseProject;
    generatedValidation = safety.validation;
    result.project_name = generatedProject.name || result.project_name || "vibentry 작품";
    generatedProjectName = sanitizeFileStem(
      result.download_name || result.project_name || generatedProject?.name || "vibentry-project"
    );

    ensureProjectLooksValid(generatedProject, generatedBaseProject, availableAssets);
    renderResponse(result);
    renderGeneratedProjectSummary(generatedProject);
    renderPreviewProject(generatedProject);
    renderAssistantFiles();
    pushHistoryEntry({
      projectName: generatedProject.name || generatedProjectName,
      mode: currentMode,
      prompt: promptInput.value.trim(),
      project: generatedProject,
      sourceEntName: primaryEnt?.name || "",
      requiresSourceArchive: archiveHasProjectAssets(generatedArchiveEntries),
    });

    if (Array.isArray(result.warnings) && result.warnings.length) {
      setAlert(`결과는 만들었지만 확인할 점이 있어요.\n\n- ${result.warnings.join("\n- ")}`, "warning");
    } else {
      setAlert("작품 초안이 준비됐어요. AI가 만든 파일 칩을 눌러 바로 받을 수 있어요.", "success");
    }

    setStatus("완료됐어요. AI 응답 아래에 파일이 준비됐어요.", false);
  } catch (error) {
    const friendly = toFriendlyGeminiError(error);
    setStatus(friendly.statusText, false);
    setAlert(friendly.alertText, friendly.alertType);
  } finally {
    generateBtn.disabled = false;
    updateAutoModelHint();
  }
}

function buildPrompt() {
  const primaryEnt = getPrimaryEntFile();
  const otherFiles = loadedFiles.filter((file) => file !== primaryEnt);
  const baseProject = currentMode === "edit" && primaryEnt ? primaryEnt.project : starterTemplate;

  const otherFileSections = otherFiles.map((file) => {
    if (file.kind === "text") {
      return [
        `파일 이름: ${file.name}`,
        "종류: text",
        "내용:",
        trimText(file.text, 18000),
      ].join("\n");
    }

    return [
      `파일 이름: ${file.name}`,
      `종류: ${file.kind}`,
      `요약: ${file.summary}`,
    ].join("\n");
  }).join("\n\n---\n\n");

  return [
    "너는 Entry .ent 작품의 project.json을 생성하고 수정하는 전문가다.",
    currentMode === "edit"
      ? "이번 작업은 수정 모드다. 업로드한 .ent 작품을 기반으로 고쳐라."
      : "이번 작업은 생성 모드다. 기본 템플릿을 기반으로 새 Entry 작품을 만들어라.",
    "응답은 완전한 project_json 객체 하나만 반환해야 한다.",
    "가능하면 기존 구조와 필드 이름을 유지하라.",
    "assistant_message는 초보 사용자도 이해할 수 있는 쉬운 한국어로 작성하라.",
    "마크다운 없이 JSON 하나만 반환하라.",
    "",
    "[사용자 요청]",
    promptInput.value.trim(),
    "",
    primaryEnt ? `[업로드한 .ent 요약]\n${primaryEnt.summary}` : "[업로드한 .ent 요약]\n없음",
    otherFileSections ? `\n[추가 파일]\n${otherFileSections}` : "\n[추가 파일]\n없음",
    "",
    "[기준 project_json]",
    JSON.stringify(baseProject),
  ].join("\n");
}

function getPrimaryEntFile() {
  return loadedFiles.find((file) => file.kind === "ent") || null;
}

function buildPromptV2() {
  const primaryEnt = getPrimaryEntFile();
  const otherFiles = loadedFiles.filter((file) => file !== primaryEnt);
  const baseProject = currentMode === "edit" && primaryEnt ? primaryEnt.project : starterTemplate;

  const otherFileSections = otherFiles.map((file) => {
    if (file.kind === "text") {
      return [
        `file_name: ${file.name}`,
        "type: text",
        "content:",
        trimText(file.text, 18000),
      ].join("\n");
    }

    return [
      `file_name: ${file.name}`,
      `type: ${file.kind}`,
      `summary: ${file.summary}`,
    ].join("\n");
  }).join("\n\n---\n\n");

  return [
    "You are an expert Entry .ent project.json generator and editor.",
    currentMode === "edit"
      ? "Mode: edit. Update the uploaded Entry project while preserving valid structure."
      : "Mode: create. Use the starter project_json as a minimal template and transform it into the requested new work.",
    "Return exactly one JSON object matching this schema: assistant_message, project_name, optional download_name, optional warnings, project_json.",
    "project_json must be a complete valid Entry project object.",
    "Do not wrap the response in markdown.",
    "Work like a careful compiler: preserve the starter structure first, then change only fields needed by the request.",
    "Keep top-level Entry structure valid: objects, scenes, variables, messages, functions, tables, speed, interface.",
    "Keep references consistent: object ids, scene ids, selectedPictureId, interface.object.",
    "Every object.script and function.content must be a JSON-stringified two-dimensional array of Entry block objects.",
    "Every object, scene, variable, message, function, picture, sound, and block id must be unique and all references must point to an existing id.",
    "Never invent image or sound URLs. Reuse asset metadata already present in starter_project_json.",
    `Only use these verified Entry block types unless the starter already contains another type: ${ENTRY_SAFE_BLOCK_TYPES.join(", ")}.`,
    "If a requested feature cannot be represented safely with those blocks, keep the valid base behavior and explain the limitation in warnings.",
    "If the starter template contains placeholder names or placeholder dialog text, replace them with content that matches the user request.",
    "Do not keep unrelated physics-engine names, variables, objects, or scripts unless the user explicitly asked for them.",
    "When the user only wants a simple speaking project, keep the project minimal.",
    "Use beginner-friendly Korean for assistant_message.",
    "",
    "[user_request]",
    promptInput.value.trim(),
    "",
    primaryEnt ? `[uploaded_ent_summary]\n${primaryEnt.summary}` : "[uploaded_ent_summary]\nnone",
    otherFileSections ? `\n[other_files]\n${otherFileSections}` : "\n[other_files]\nnone",
    "",
    "[starter_project_json]",
    JSON.stringify(baseProject),
  ].join("\n");
}

function normalizeSimpleRequestResult(userPrompt, result) {
  const simpleSpec = parseSimpleSpeakRequest(userPrompt);
  if (!simpleSpec || !starterTemplate) {
    return result;
  }

  if (projectMatchesSimpleSpeak(result?.project_json, simpleSpec)) {
    return result;
  }

  const fallbackProject = buildSimpleSpeakProject(simpleSpec);
  const existingWarnings = Array.isArray(result?.warnings) ? result.warnings : [];

  return {
    ...result,
    assistant_message: [
      `${simpleSpec.objectName}이(가) 시작 버튼을 누르면 "${simpleSpec.message}"라고 말하는 아주 간단한 작품으로 정리했어요.`,
      "AI가 처음 준 결과가 요청보다 복잡하거나 구조가 어긋나서, 가장 안전한 기본 형식으로 자동 보정했어요.",
    ].join("\n\n"),
    project_name: fallbackProject.name,
    download_name: fallbackProject.name,
    warnings: [
      ...existingWarnings,
      "간단한 말하기 요청은 요청과 다른 결과가 나오면 안전한 기본 템플릿으로 자동 보정됩니다.",
    ],
    project_json: fallbackProject,
  };
}

function parseSimpleSpeakRequest(userPrompt) {
  if (!userPrompt || typeof userPrompt !== "string") {
    return null;
  }

  const compact = userPrompt.replace(/\s+/g, " ").trim();
  if (!compact.includes("말")) {
    return null;
  }

  const pattern = /([^\s"'“”]+?)(?:이|가)\s+(.+?)\s*이라고\s*말/;
  const match = compact.match(pattern);
  if (!match) {
    return null;
  }

  const objectName = match[1].trim();
  const message = match[2].trim().replace(/^["'“”]|["'“”]$/g, "");
  if (!objectName || !message) {
    return null;
  }

  return { objectName, message };
}

function projectMatchesSimpleSpeak(project, simpleSpec) {
  if (!project || typeof project !== "object") {
    return false;
  }

  const objects = Array.isArray(project.objects) ? project.objects : [];
  if (objects.length !== 1) {
    return false;
  }

  const object = objects[0];
  if ((object?.name || "").trim() !== simpleSpec.objectName) {
    return false;
  }

  try {
    const threads = JSON.parse(object.script || "[]");
    const blocks = Array.isArray(threads) ? threads.flat() : [];
    const dialog = blocks.find((block) => block?.type === "dialog");
    const textParam = dialog?.params?.[0];
    const message = textParam?.type === "text" ? textParam.params?.[0] : "";
    return message === simpleSpec.message;
  } catch {
    return false;
  }
}

function buildSimpleSpeakProject(simpleSpec) {
  const project = JSON.parse(JSON.stringify(starterTemplate));
  const baseObject = Array.isArray(project.objects) ? project.objects[0] : null;
  const objectId = baseObject?.id || "vbot";

  project.name = `${simpleSpec.objectName} 말하기`;
  project.objects = [{
    ...(baseObject || {}),
    id: objectId,
    name: simpleSpec.objectName,
    script: JSON.stringify([[
      makeSimpleBlock("s001", "when_run_button_click", [null], [], 50, 30),
      makeSimpleBlock("s003", "dialog", [
        makeSimpleBlock("s002", "text", [simpleSpec.message]),
        "speak",
        null,
      ]),
    ]]),
  }];
  project.interface = {
    ...(project.interface || {}),
    object: objectId,
  };

  return project;
}

function makeSimpleBlock(id, type, params = [], statements = [], x = 0, y = 0) {
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

async function callGeminiAuto(apiKey, prompt) {
  const errors = [];

  for (const model of autoModelCandidates) {
    try {
      const result = await callGemini(apiKey, model, prompt);
      selectedModelName = model;
      return result;
    } catch (error) {
      errors.push({ model, error });
      if (!shouldTryNextModel(error)) {
        throw error;
      }
    }
  }

  throw errors[errors.length - 1]?.error || new Error("사용 가능한 Gemini 모델을 찾지 못했어요.");
}

function shouldTryNextModel(error) {
  const raw = `${error?.message || ""} ${error?.error?.status || ""}`.toLowerCase();

  if (error?.status === 404) {
    return true;
  }

  if (error?.status === 400) {
    return raw.includes("model") || raw.includes("not found") || raw.includes("unsupported");
  }

  return raw.includes("model") && (raw.includes("not found") || raw.includes("unsupported"));
}

async function callGemini(apiKey, model, prompt) {
  let response;
  let data;

  try {
    response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model,
        system_instruction: "You are an expert Entry .ent project editor and generator. Return only structured JSON.",
        input: prompt,
        generation_config: {
          thinking_level: "low",
        },
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: requestSchema,
        },
      }),
    });
  } catch (error) {
    throw {
      kind: "network",
      message: error instanceof Error ? error.message : "요청 전송에 실패했어요.",
    };
  }

  data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw {
      kind: "api",
      status: response.status,
      error: data.error || {},
      message: data.error?.message || "Gemini API 호출에 실패했어요.",
    };
  }

  const outputText = extractInteractionText(data);
  if (!outputText) {
    throw {
      kind: "api",
      status: response.status,
      error: {},
      message: "Gemini 응답 텍스트가 비어 있어요.",
    };
  }

  try {
    return JSON.parse(outputText);
  } catch {
    throw {
      kind: "parse",
      message: "Gemini가 JSON 형식이 아닌 응답을 보냈어요.",
    };
  }
}

function extractInteractionText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (Array.isArray(data.steps)) {
    const joinedFromSteps = data.steps
      .filter((step) => step?.type === "model_output" && Array.isArray(step.content))
      .flatMap((step) => step.content)
      .filter((item) => item?.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n")
      .trim();
    if (joinedFromSteps) {
      return joinedFromSteps;
    }
  }

  if (Array.isArray(data.outputs)) {
    const joined = data.outputs
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n")
      .trim();
    if (joined) {
      return joined;
    }
  }

  return "";
}

function toFriendlyGeminiError(error) {
  if (error?.kind === "network") {
    return {
      statusText: "인터넷 연결 또는 브라우저 요청에 문제가 있어요.",
      alertType: "error",
      alertText: "Gemini 서버에 연결하지 못했어요. 인터넷 상태를 확인하고 다시 시도해 주세요.",
    };
  }

  if (error?.kind === "parse") {
    return {
      statusText: "AI 응답이 파일로 바꾸기 어려운 형식이었어요.",
      alertType: "warning",
      alertText: "이번 응답은 JSON이 아니었어요. 같은 요청으로 한 번 더 시도하면 정상으로 돌아오는 경우가 많아요.",
    };
  }

  if (error?.kind === "project_validation") {
    const issues = Array.isArray(error.issues) ? error.issues.slice(0, 8) : [];
    return {
      statusText: "안전 검사에서 파일 생성을 중단했어요.",
      alertType: "warning",
      alertText: [
        "AI가 만든 구조에 엔트리에서 오류를 낼 수 있는 부분이 남아 있어 파일을 제공하지 않았어요.",
        "같은 요청을 조금 더 단순하게 적어 다시 시도해 주세요.",
        issues.length ? "" : null,
        ...issues.map((issue) => `- ${issue}`),
      ].filter(Boolean).join("\n"),
    };
  }

  const raw = `${error?.message || ""} ${error?.error?.status || ""}`.toLowerCase();
  if (
    error?.status === 429 ||
    raw.includes("resource_exhausted") ||
    raw.includes("quota") ||
    raw.includes("rate") ||
    raw.includes("exceeded")
  ) {
    return {
      statusText: "Gemini 사용 한도 또는 속도 제한에 걸렸어요.",
      alertType: "warning",
      alertText: [
        "지금은 API 호출 한도가 다 되었거나 너무 짧은 시간에 많이 요청해서 잠시 막힌 상태예요.",
        "",
        "이렇게 해 보세요:",
        "1. 잠깐 기다렸다가 다시 시도하기",
        "2. Google AI Studio에서 사용량과 결제 상태 확인하기",
        "3. 프롬프트를 조금 더 짧게 줄여서 다시 보내기",
      ].join("\n"),
    };
  }

  if (
    error?.status === 400 ||
    error?.status === 401 ||
    error?.status === 403 ||
    raw.includes("api key") ||
    raw.includes("permission") ||
    raw.includes("unauth")
  ) {
    return {
      statusText: "API 키나 제미나이 권한을 다시 확인해 주세요.",
      alertType: "error",
      alertText: [
        "Gemini가 현재 요청을 받아들이지 못했어요.",
        "",
        "확인할 것:",
        "1. API 키가 정확한지",
        "2. 키에 Gemini API 사용 권한이 있는지",
        "3. 사용량이나 결제 제한에 걸리지 않았는지",
      ].join("\n"),
    };
  }

  return {
    statusText: `생성 실패: ${error?.message || "알 수 없는 오류"}`,
    alertType: "error",
    alertText: `Gemini 요청 중 문제가 생겼어요.\n\n원인: ${error?.message || "알 수 없는 오류"}`,
  };
}

function ensureProjectLooksValid(project, baseProject = starterTemplate, availableAssets = new Set()) {
  const validation = validateEntryProject(project, { baseProject, availableAssets });
  if (validation.errors.length) {
    throw {
      kind: "project_validation",
      message: validation.errors[0],
      issues: validation.errors,
    };
  }
  return validation;
}

function renderResponse(result) {
  const warningText = Array.isArray(result.warnings) && result.warnings.length
    ? `\n\n확인할 점:\n- ${result.warnings.join("\n- ")}`
    : "";
  const modelText = selectedModelName ? `사용한 모델: ${selectedModelName}` : "";

  responseBox.classList.remove("empty");
  responseBox.textContent = [
    `작품 이름: ${result.project_name || "(이름 없음)"}`,
    modelText,
    result.safety_summary || "",
    "",
    result.assistant_message || "설명이 없어요.",
    warningText,
  ].filter(Boolean).join("\n");
}

function renderAssistantFiles() {
  if (!generatedProject) {
    assistantFiles.className = "assistant-files empty";
    assistantFiles.textContent = "AI가 만든 파일이 여기 나타나요.";
    return;
  }

  assistantFiles.className = "assistant-files";
  assistantFiles.innerHTML = `
    <button type="button" class="artifact-chip" data-download-kind="ent">
      ${escapeHtml(`${generatedProjectName}.ent`)}
      <small>AI가 만든 엔트리 작품 파일</small>
    </button>
    <button type="button" class="artifact-chip" data-download-kind="json">
      ${escapeHtml(`${generatedProjectName}.project.json`)}
      <small>작품 내부 project.json</small>
    </button>
  `;

  assistantFiles.querySelectorAll("[data-download-kind]").forEach((button) => {
    button.addEventListener("click", async () => {
      const kind = button.getAttribute("data-download-kind");
      if (kind === "ent") {
        await downloadGeneratedEnt();
        return;
      }
      downloadGeneratedJson();
    });
  });
}

function renderGeneratedProjectSummary(project) {
  projectSummary.classList.remove("empty");
  projectSummary.innerHTML = `
    <div class="summary-grid">
      <div class="summary-chip">
        <small>오브젝트</small>
        <strong>${countItems(project.objects)}</strong>
      </div>
      <div class="summary-chip">
        <small>변수</small>
        <strong>${countItems(project.variables)}</strong>
      </div>
      <div class="summary-chip">
        <small>함수</small>
        <strong>${countItems(project.functions)}</strong>
      </div>
      <div class="summary-chip">
        <small>이름</small>
        <strong>${escapeHtml(project.name || generatedProjectName)}</strong>
      </div>
    </div>
    <div style="margin-top:14px; color: var(--entry-muted); line-height:1.7;">
      ${(Array.isArray(project.objects) ? project.objects : [])
        .slice(0, 6)
        .map((item) => escapeHtml(item.name || item.id || "이름 없음"))
        .join(", ") || "아직 오브젝트가 없어요."}
    </div>
  `;
}

function renderPreviewFromState() {
  const project = generatedProject || getPrimaryEntFile()?.project || starterTemplate;
  renderPreviewProject(project);
}

function renderPreviewProject(project) {
  if (!project || typeof project !== "object") {
    previewEmpty.classList.remove("hidden");
    previewShell.classList.add("hidden");
    return;
  }

  previewEmpty.classList.add("hidden");
  previewShell.classList.remove("hidden");

  const objects = Array.isArray(project.objects) ? project.objects : [];
  const variables = Array.isArray(project.variables) ? project.variables : [];
  const scenes = Array.isArray(project.scenes) ? project.scenes : [];

  if (!objects.length) {
    selectedObjectId = null;
  } else if (!selectedObjectId || !objects.some((item) => item.id === selectedObjectId)) {
    selectedObjectId = objects[0].id;
  }

  previewMeta.innerHTML = `
    ${renderMetaChip("오브젝트", objects.length)}
    ${renderMetaChip("변수", variables.length)}
    ${renderMetaChip("장면", scenes.length)}
    ${renderMetaChip("속도", project.speed ?? "-")}
  `;

  previewSceneList.innerHTML = scenes.length
    ? scenes.map((scene) => `<button type="button" class="scene-chip">${escapeHtml(scene.name || scene.id || "이름 없는 장면")}</button>`).join("")
    : `<div class="file-meta">장면 정보가 없어요.</div>`;

  renderStage(project);
  renderObjectList(project);
  renderObjectDetail(project);
  renderVariableList(project);
  renderInspector(project);
}

function renderMetaChip(label, value) {
  return `
    <div class="meta-chip">
      <small>${escapeHtml(label)}</small>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `;
}

function renderStage(project) {
  const objects = Array.isArray(project.objects) ? project.objects : [];
  stagePreview.innerHTML = "";

  objects.forEach((object, index) => {
    const entity = object.entity || {};
    const point = stagePoint(entity.x, entity.y, index);
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = `stage-object${object.id === selectedObjectId ? " active" : ""}`;
    marker.style.left = `${point.left}%`;
    marker.style.top = `${point.top}%`;
    marker.style.animationDelay = `${(index % 5) * -0.5}s`;
    marker.textContent = shortObjectLabel(object.name || `O${index + 1}`);
    marker.title = object.name || `Object ${index + 1}`;
    marker.addEventListener("click", () => {
      selectedObjectId = object.id;
      renderPreviewProject(project);
    });
    stagePreview.appendChild(marker);
  });
}

function stagePoint(x = 0, y = 0, index = 0) {
  const hasX = Number.isFinite(Number(x));
  const hasY = Number.isFinite(Number(y));

  if (!hasX && !hasY) {
    const col = index % 5;
    const row = Math.floor(index / 5) % 4;
    return {
      left: 14 + col * 17,
      top: 18 + row * 18,
    };
  }

  return {
    left: clamp((((Number(x) || 0) + 240) / 480) * 100, 3, 97),
    top: clamp(((135 - (Number(y) || 0)) / 270) * 100, 6, 94),
  };
}

function renderObjectList(project) {
  const objects = Array.isArray(project.objects) ? project.objects : [];
  objectList.innerHTML = objects.length
    ? objects.map((object) => `
        <button type="button" class="object-chip${object.id === selectedObjectId ? " active" : ""}" data-object-id="${escapeHtml(object.id)}">
          ${escapeHtml(object.name || object.id || "이름 없음")}
        </button>
      `).join("")
    : `<div class="file-meta">오브젝트가 없어요.</div>`;

  objectList.querySelectorAll("[data-object-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedObjectId = button.getAttribute("data-object-id");
      renderPreviewProject(project);
    });
  });
}

function renderObjectDetail(project) {
  const selected = (Array.isArray(project.objects) ? project.objects : []).find((object) => object.id === selectedObjectId);
  if (!selected) {
    objectDetail.textContent = "선택한 오브젝트가 없어요.";
    return;
  }

  const entity = selected.entity || {};
  const scriptThreads = countScriptThreads(selected.script);
  const pictureCount = countItems(selected.sprite?.pictures);
  const soundCount = countItems(selected.sprite?.sounds);

  objectDetail.innerHTML = [
    `<strong>${escapeHtml(selected.name || selected.id || "이름 없음")}</strong>`,
    `종류: ${escapeHtml(selected.objectType || "unknown")}`,
    `장면: ${escapeHtml(selected.scene || "-")}`,
    `그림 수: ${pictureCount}`,
    `소리 수: ${soundCount}`,
    `스크립트 묶음 수: ${scriptThreads}`,
    `위치: (${Number(entity.x || 0)}, ${Number(entity.y || 0)})`,
    `크기: ${Number(entity.width || 0)} x ${Number(entity.height || 0)}`,
    `회전: ${Number(entity.rotation || 0)}`,
    `보임: ${entity.visible === false ? "아니오" : "예"}`,
  ].join("<br>");
}

function renderVariableList(project) {
  const variables = Array.isArray(project.variables) ? project.variables : [];
  variableList.innerHTML = variables.length
    ? variables.slice(0, 18).map((variable) => `
        <div class="variable-row">
          <div>${escapeHtml(variable.name || variable.id || "이름 없음")}</div>
          <div>${escapeHtml(String(variable.value ?? ""))}</div>
        </div>
      `).join("")
    : "변수가 없어요.";
}

function renderInspector(project) {
  const primaryEnt = getPrimaryEntFile();
  const source = generatedProject
    ? "방금 생성한 결과"
    : primaryEnt
      ? `업로드한 파일: ${primaryEnt.name}`
      : "기본 템플릿";

  projectInspector.innerHTML = [
    `미리보기 기준: <code>${escapeHtml(source)}</code>`,
    `현재 모드: <code>${escapeHtml(currentMode)}</code>`,
    `첫 오브젝트: <code>${escapeHtml((project.objects || [])[0]?.name || "-")}</code>`,
    `인터페이스 오브젝트: <code>${escapeHtml(project.interface?.object || "-")}</code>`,
  ].join("<br>");
}

function countScriptThreads(scriptValue) {
  if (!scriptValue) {
    return 0;
  }
  try {
    const parsed = typeof scriptValue === "string" ? JSON.parse(scriptValue) : scriptValue;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function shortObjectLabel(name) {
  const cleaned = String(name || "?").trim();
  return cleaned.slice(0, 4) || "?";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function countItems(value) {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (value && typeof value === "object") {
    return Object.keys(value).length;
  }
  return 0;
}

function loadHistoryEntries() {
  try {
    const raw = localStorage.getItem(storageKeys.history);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pushHistoryEntry({
  projectName,
  mode,
  prompt,
  project,
  sourceEntName = "",
  requiresSourceArchive = false,
}) {
  const entry = {
    id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    projectName,
    mode,
    prompt,
    summary: summarizeProject(project),
    project,
    sourceEntName,
    requiresSourceArchive,
  };

  historyEntries = [entry, ...historyEntries].slice(0, 8);
  persistHistory();
  renderHistory();
}

function persistHistory() {
  let entries = [...historyEntries];
  while (entries.length) {
    try {
      localStorage.setItem(storageKeys.history, JSON.stringify(entries));
      historyEntries = entries;
      return;
    } catch {
      entries = entries.slice(0, -1);
    }
  }

  localStorage.removeItem(storageKeys.history);
  historyEntries = [];
}

function renderHistory() {
  if (!historyEntries.length) {
    historyList.className = "history-list empty";
    historyList.textContent = "아직 저장된 작업이 없어요.";
    return;
  }

  historyList.className = "history-list";
  historyList.innerHTML = historyEntries.map((entry) => `
    <article class="history-card">
      <h3>${escapeHtml(entry.projectName || "이름 없는 작품")}</h3>
      <div class="history-meta">
        <div>${formatDate(entry.createdAt)} | ${entry.mode === "edit" ? "수정 모드" : "생성 모드"}</div>
        <div>${escapeHtml(trimText(entry.prompt || "", 90))}</div>
        ${entry.requiresSourceArchive ? `<div>원본 자산 필요: ${escapeHtml(entry.sourceEntName || ".ent 파일")}</div>` : ""}
      </div>
      <div class="history-actions">
        <button type="button" class="history-btn" data-load-history="${escapeHtml(entry.id)}">불러오기</button>
        <button type="button" class="history-btn" data-reuse-history="${escapeHtml(entry.id)}">프롬프트 재사용</button>
        <button type="button" class="history-btn danger" data-delete-history="${escapeHtml(entry.id)}">삭제</button>
      </div>
    </article>
  `).join("");

  historyList.querySelectorAll("[data-load-history]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = historyEntries.find((item) => item.id === button.getAttribute("data-load-history"));
      if (!entry) {
        return;
      }
      generatedProject = entry.project;
      generatedProjectName = sanitizeFileStem(entry.projectName || "vibentry-project");
      const currentEnt = getPrimaryEntFile();
      const canRestoreAssets = entry.requiresSourceArchive
        && currentEnt
        && (!entry.sourceEntName || currentEnt.name === entry.sourceEntName);
      generatedArchiveEntries = canRestoreAssets ? currentEnt.archiveEntries || [] : [];
      generatedBaseProject = entry.project;
      generatedValidation = validateEntryProject(entry.project, {
        baseProject: entry.project,
        availableAssets: collectArchiveAssetNames(generatedArchiveEntries),
      });
      promptInput.value = entry.prompt || "";
      setMode(entry.mode || "create");
      renderGeneratedProjectSummary(generatedProject);
      renderPreviewProject(generatedProject);
      renderAssistantFiles();
      responseBox.classList.remove("empty");
      responseBox.textContent = `히스토리에서 불러온 결과예요.\n\n${entry.summary}`;
      persistLocalState();
      setStatus("저장된 히스토리를 다시 불러왔어요.", false);
      if (entry.requiresSourceArchive && !canRestoreAssets) {
        setAlert(
          `코드와 미리보기는 불러왔지만 이미지·소리를 포함해 다시 내려받으려면 원본 ${entry.sourceEntName || ".ent 파일"}을 먼저 올려 주세요.`,
          "warning"
        );
      } else {
        setAlert("이전 결과와 필요한 파일 자산을 다시 열었어요.", "success");
      }
    });
  });

  historyList.querySelectorAll("[data-reuse-history]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = historyEntries.find((item) => item.id === button.getAttribute("data-reuse-history"));
      if (!entry) {
        return;
      }
      promptInput.value = entry.prompt || "";
      persistLocalState();
      setStatus("이전 프롬프트를 입력창에 다시 넣었어요.", false);
    });
  });

  historyList.querySelectorAll("[data-delete-history]").forEach((button) => {
    button.addEventListener("click", () => {
      historyEntries = historyEntries.filter((item) => item.id !== button.getAttribute("data-delete-history"));
      persistHistory();
      renderHistory();
      setStatus("선택한 히스토리를 삭제했어요.", false);
    });
  });
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function downloadGeneratedEnt() {
  if (!generatedProject) {
    return;
  }

  setStatus("AI가 만든 .ent 파일을 준비하는 중이에요...", true);
  try {
    const beforeValidation = ensureProjectLooksValid(
      generatedProject,
      generatedBaseProject || starterTemplate,
      collectArchiveAssetNames(generatedArchiveEntries)
    );
    const blob = await buildEntBlob(generatedProject, generatedArchiveEntries);
    const reopened = await readEntArchive(blob);
    const afterValidation = ensureProjectLooksValid(
      reopened.project,
      generatedBaseProject || starterTemplate,
      collectArchiveAssetNames(reopened.entries)
    );
    if (JSON.stringify(reopened.project) !== JSON.stringify(generatedProject)) {
      throw new Error("압축 후 project.json 내용이 달라졌어요.");
    }
    generatedValidation = afterValidation;
    downloadBlob(blob, `${generatedProjectName}.ent`);
    setStatus(
      `자체 테스트 통과: 블록 ${beforeValidation.stats.blocks}개를 확인하고 .ent 파일을 내려줬어요.`,
      false
    );
  } catch (error) {
    setStatus(`.ent 생성 실패: ${error.message}`, false);
    const issues = Array.isArray(error?.issues) ? `\n\n- ${error.issues.slice(0, 8).join("\n- ")}` : "";
    setAlert(`안전한 .ent 파일을 만들지 못해 다운로드를 중단했어요.${issues}`, "error");
  }
}

function downloadGeneratedJson() {
  if (!generatedProject) {
    return;
  }

  const blob = new Blob([JSON.stringify(generatedProject, null, 2)], {
    type: "application/json",
  });
  downloadBlob(blob, `${generatedProjectName}.project.json`);
  setStatus("AI가 project.json 파일을 내려줬어요.", false);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setStatus(text, loading) {
  statusBox.textContent = text;
  statusBox.classList.toggle("loading", loading);
}

function setAlert(text, type = "warning") {
  alertBox.className = `alert-box ${type}`;
  alertBox.textContent = text;
}

function clearAlert() {
  alertBox.className = "alert-box hidden";
  alertBox.textContent = "";
}

function trimText(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n\n[이하 생략: ${text.length - maxLength}자]`;
}

function sanitizeFileStem(value) {
  return String(value)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "vibentry-project";
}

function uniqueTextItems(items) {
  return [...new Set(items.filter((item) => typeof item === "string" && item.trim()))];
}

function archiveHasProjectAssets(entries) {
  return entries.some((entry) => (
    entry?.typeFlag !== "5"
    && entry?.name !== "temp/project.json"
  ));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
