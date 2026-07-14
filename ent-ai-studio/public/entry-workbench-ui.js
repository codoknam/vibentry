import { collectArchiveAssetNames, repairEntryProject } from "./entry-safety.js";
import {
  QUICK_BLOCK_CATALOG,
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
} from "./entry-workbench.js";

const AGENT_STAGES = Object.freeze([
  { id: "analysis", label: "요청 분석" },
  { id: "research", label: "링크·자료 확인" },
  { id: "architecture", label: "오브젝트 설계" },
  { id: "coding", label: "블록 코딩" },
  { id: "assets", label: "이미지 자산" },
  { id: "validation", label: "Entry 안전 검사" },
]);

export function createEntryWorkbench(options) {
  const elements = getElements();
  let draft = null;
  let selectedObjectId = "";
  let sessionId = "";
  let sessionVersion = "";
  let dirty = false;
  let locked = false;
  let dragging = null;
  let previewUrls = new Map();
  let elapsedTimer = null;
  let agent = freshAgentState();

  initializeControls();
  bindEvents();

  return {
    open,
    close,
    syncFromSession,
    loadProject,
    startAgent,
    updateAgent,
    finishAgent,
    failAgent,
    getDraft: () => draft,
    hasUnsavedChanges: () => dirty,
  };

  function initializeControls() {
    elements.quickBlock.innerHTML = QUICK_BLOCK_CATALOG
      .map((item) => `<option value="${item.id}">${escapeHtml(item.label)}</option>`)
      .join("");
    updateQuickBlockPlaceholder();
  }

  function bindEvents() {
    elements.openButton.onclick = open;
    elements.closeButton.onclick = close;
    elements.cancelButton.onclick = () => options.onCancelAgent?.();
    elements.addObject.onclick = addObject;
    elements.deleteObject.onclick = deleteObject;
    elements.objectList.onclick = selectObjectFromList;
    elements.stage.onpointerdown = startDrag;
    window.addEventListener("pointermove", moveDrag);
    window.addEventListener("pointerup", stopDrag);
    elements.quickBlock.onchange = updateQuickBlockPlaceholder;
    elements.addBlock.onclick = addBlock;
    elements.codeList.onclick = removeBlock;
    elements.applyRaw.onclick = applyRawScript;
    elements.formatRaw.onclick = formatRawScript;
    elements.applyProject.onclick = applyProject;
    elements.resetProject.onclick = resetProject;
    elements.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });

    for (const input of [elements.objectName, elements.objectX, elements.objectY, elements.objectRotation, elements.objectScale, elements.objectVisible]) {
      input.addEventListener(input.type === "checkbox" ? "change" : "input", updateSelectedObject);
    }
  }

  function open() {
    syncFromSession();
    if (!elements.dialog.open) elements.dialog.showModal();
  }

  function close() {
    if (dirty && !locked && !confirm("아직 작품에 적용하지 않은 수정이 있어요. 작업실을 닫을까요?")) return;
    elements.dialog.close();
  }

  function syncFromSession() {
    const nextSessionId = options.getSessionId?.() || "local";
    const nextSessionVersion = options.getSessionVersion?.() || "";
    if (nextSessionId === sessionId && nextSessionVersion === sessionVersion && draft) return;
    if (nextSessionId === sessionId && (dirty || agent.running)) return;
    if (sessionId && nextSessionId !== sessionId && !agent.running) {
      stopElapsedTimer();
      agent = freshAgentState();
      locked = false;
    }
    sessionId = nextSessionId;
    sessionVersion = nextSessionVersion;
    loadProject(options.getProject?.() || options.getBaseProject?.(), { resetDirty: true });
  }

  function loadProject(project, { resetDirty = false, selectObjectId = "" } = {}) {
    if (!project) return;
    revokePreviewUrls();
    draft = createWorkbenchDraft(project, options.getBaseProject?.());
    selectedObjectId = draft.objects?.some((item) => item.id === selectObjectId)
      ? selectObjectId
      : draft.objects?.some((item) => item.id === selectedObjectId)
        ? selectedObjectId
        : draft.objects?.[0]?.id || "";
    if (resetDirty) dirty = false;
    renderAll();
  }

  function addObject() {
    if (!canEdit()) return;
    try {
      selectedObjectId = addWorkbenchObject(draft, options.getBaseProject?.(), elements.newObjectName.value);
      elements.newObjectName.value = "";
      markDirty();
      renderAll();
    } catch (error) {
      options.onAlert?.(error.message, true);
    }
  }

  function deleteObject() {
    if (!canEdit() || !selectedObjectId) return;
    const object = selectedObject();
    if (!confirm(`${object?.name || "이 오브젝트"}를 코드와 함께 삭제할까요?`)) return;
    try {
      removeWorkbenchObject(draft, selectedObjectId);
      selectedObjectId = draft.objects[0]?.id || "";
      markDirty();
      renderAll();
    } catch (error) {
      options.onAlert?.(error.message, true);
    }
  }

  function selectObjectFromList(event) {
    const button = event.target.closest("[data-workbench-object-id]");
    if (!button) return;
    selectedObjectId = button.dataset.workbenchObjectId;
    renderAll();
  }

  function updateSelectedObject() {
    if (!canEdit() || !selectedObjectId) return;
    updateWorkbenchObject(draft, selectedObjectId, {
      name: elements.objectName.value,
      x: elements.objectX.value,
      y: elements.objectY.value,
      rotation: elements.objectRotation.value,
      scale: elements.objectScale.value,
      visible: elements.objectVisible.checked,
    });
    markDirty();
    renderObjectList();
    renderStage();
    renderStats();
  }

  function addBlock() {
    if (!canEdit() || !selectedObjectId) return;
    try {
      appendQuickBlock(
        draft,
        selectedObjectId,
        elements.quickBlock.value,
        elements.quickBlockValue.value,
        elements.quickBlockThread.value
      );
      elements.quickBlockValue.value = "";
      markDirty();
      renderCode();
      renderStats();
    } catch (error) {
      options.onAlert?.(error.message, true);
    }
  }

  function removeBlock(event) {
    const button = event.target.closest("[data-remove-block]");
    if (!button || !canEdit()) return;
    removeWorkbenchBlock(draft, selectedObjectId, Number(button.dataset.thread), Number(button.dataset.block));
    markDirty();
    renderCode();
    renderStats();
  }

  function applyRawScript() {
    if (!canEdit()) return;
    try {
      setWorkbenchScript(draft, selectedObjectId, elements.rawScript.value);
      markDirty();
      renderCode();
      renderStats();
      options.onAlert?.("고급 스크립트를 작업실 초안에 반영했어요.");
    } catch (error) {
      options.onAlert?.(`스크립트 JSON을 확인해 주세요: ${error.message}`, true);
    }
  }

  function formatRawScript() {
    try {
      elements.rawScript.value = JSON.stringify(JSON.parse(elements.rawScript.value || "[]"), null, 2);
    } catch (error) {
      options.onAlert?.(`JSON 형식을 정리하지 못했어요: ${error.message}`, true);
    }
  }

  async function applyProject() {
    if (!canEdit() || !draft) return;
    try {
      const base = options.getBaseProject?.();
      const safety = repairEntryProject(draft, base, {
        availableAssets: collectArchiveAssetNames(options.getArchiveEntries?.() || []),
      });
      if (safety.validation.errors.length) {
        throw new Error(safety.validation.errors[0]);
      }
      draft = safety.project;
      await options.onApply?.(structuredClone(draft), safety.warnings);
      dirty = false;
      sessionVersion = options.getSessionVersion?.() || sessionVersion;
      renderAll();
    } catch (error) {
      options.onAlert?.(`작품에 적용하지 못했어요: ${error.message}`, true);
    }
  }

  function resetProject() {
    if (locked) return;
    if (dirty && !confirm("작업실에서 수정한 내용을 버리고 현재 작품을 다시 불러올까요?")) return;
    loadProject(options.getProject?.() || options.getBaseProject?.(), { resetDirty: true });
  }

  function startDrag(event) {
    const objectElement = event.target.closest("[data-stage-object-id]");
    if (!objectElement || !canEdit()) return;
    selectedObjectId = objectElement.dataset.stageObjectId;
    dragging = { pointerId: event.pointerId };
    objectElement.setPointerCapture?.(event.pointerId);
    moveDrag(event);
  }

  function moveDrag(event) {
    if (!dragging || event.pointerId !== dragging.pointerId || !canEdit()) return;
    const rect = elements.stage.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 480 - 240;
    const y = 135 - ((event.clientY - rect.top) / rect.height) * 270;
    updateWorkbenchObject(draft, selectedObjectId, { x, y });
    markDirty();
    renderStage();
    renderProperties();
    renderObjectList();
    event.preventDefault();
  }

  function stopDrag(event) {
    if (dragging && event.pointerId === dragging.pointerId) dragging = null;
  }

  function startAgent({ request = "", urls = [], project = null } = {}) {
    sessionId = options.getSessionId?.() || sessionId;
    sessionVersion = options.getSessionVersion?.() || sessionVersion;
    agent = freshAgentState();
    agent.running = true;
    agent.startedAt = Date.now();
    agent.request = request;
    agent.urls = urls;
    locked = true;
    if (project) loadProject(project, { resetDirty: true });
    updateAgent("analysis", "요청을 기능, 오브젝트, 블록 단위로 나누고 있어요.");
    startElapsedTimer();
    renderAll();
  }

  function updateAgent(stageId, detail, meta = {}) {
    const index = Math.max(0, AGENT_STAGES.findIndex((stage) => stage.id === stageId));
    agent.activeStage = stageId;
    agent.detail = detail || agent.detail;
    agent.model = meta.model || agent.model;
    agent.interactionId = meta.interactionId || agent.interactionId;
    if (Array.isArray(meta.citations)) agent.citations = meta.citations;
    if (Array.isArray(meta.workLog)) agent.workLog = meta.workLog;
    if (meta.project) loadProject(meta.project, { resetDirty: true });
    agent.stageState = Object.fromEntries(AGENT_STAGES.map((stage, stageIndex) => [
      stage.id,
      stageIndex < index ? "done" : stageIndex === index ? "active" : "pending",
    ]));
    renderAgent();
  }

  function finishAgent({ project, detail = "Entry 호환 검사를 통과했어요.", citations = [], workLog = [] } = {}) {
    agent.running = false;
    agent.detail = detail;
    agent.citations = citations.length ? citations : agent.citations;
    agent.workLog = workLog.length ? workLog : agent.workLog;
    agent.stageState = Object.fromEntries(AGENT_STAGES.map((stage) => [stage.id, "done"]));
    locked = false;
    stopElapsedTimer();
    if (project) loadProject(project, { resetDirty: true });
    sessionVersion = options.getSessionVersion?.() || sessionVersion;
    renderAll();
  }

  function failAgent(message) {
    agent.running = false;
    agent.failed = true;
    agent.detail = message || "작업을 완료하지 못했어요.";
    agent.stageState[agent.activeStage] = "error";
    locked = false;
    stopElapsedTimer();
    renderAll();
  }

  function startElapsedTimer() {
    stopElapsedTimer();
    elapsedTimer = setInterval(renderElapsed, 1000);
  }

  function stopElapsedTimer() {
    if (agent.startedAt) agent.elapsedMs = Math.max(0, Date.now() - agent.startedAt);
    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = null;
    renderElapsed();
  }

  function renderAll() {
    renderObjectList();
    renderStage();
    renderProperties();
    renderCode();
    renderStats();
    renderAgent();
    renderLockedState();
  }

  function renderObjectList() {
    elements.objectList.innerHTML = (draft?.objects || []).map((object) => {
      const picture = selectedPicture(object);
      const preview = previewSource(picture?.fileurl);
      return `<button type="button" class="workbench-object ${object.id === selectedObjectId ? "active" : ""}" data-workbench-object-id="${escapeHtml(object.id)}">${preview ? `<img src="${escapeHtml(preview)}" alt="">` : `<span>${escapeHtml((object.name || "?").slice(0, 1))}</span>`}<span><strong>${escapeHtml(object.name)}</strong><small>x ${round(object.entity?.x)} · y ${round(object.entity?.y)}</small></span></button>`;
    }).join("") || '<p class="workbench-empty">오브젝트가 없어요.</p>';
  }

  function renderStage() {
    elements.stage.innerHTML = (draft?.objects || []).map((object) => {
      const x = ((Number(object.entity?.x) || 0) + 240) / 480 * 100;
      const y = (135 - (Number(object.entity?.y) || 0)) / 270 * 100;
      const scale = Math.max(0.25, Math.min(2.4, Math.abs(Number(object.entity?.scaleX) || 1)));
      const picture = selectedPicture(object);
      const preview = previewSource(picture?.fileurl);
      const hidden = object.entity?.visible === false ? " is-hidden" : "";
      return `<button type="button" class="workbench-stage-object${object.id === selectedObjectId ? " selected" : ""}${hidden}" data-stage-object-id="${escapeHtml(object.id)}" style="left:${x}%;top:${y}%;--object-scale:${scale};--object-rotation:${Number(object.entity?.rotation)||0}deg">${preview ? `<img src="${escapeHtml(preview)}" alt="">` : `<span>${escapeHtml((object.name || "?").slice(0, 1))}</span>`}<small>${escapeHtml(object.name)}</small></button>`;
    }).join("") || "<span>작품이 아직 비어 있어요.</span>";
  }

  function renderProperties() {
    const object = selectedObject();
    const disabled = !object;
    elements.objectName.value = object?.name || "";
    elements.objectX.value = round(object?.entity?.x);
    elements.objectY.value = round(object?.entity?.y);
    elements.objectRotation.value = round(object?.entity?.rotation);
    elements.objectScale.value = round((Math.abs(Number(object?.entity?.scaleX)) || 1) * 100);
    elements.objectVisible.checked = object?.entity?.visible !== false;
    for (const input of [elements.objectName, elements.objectX, elements.objectY, elements.objectRotation, elements.objectScale, elements.objectVisible]) input.disabled = disabled || locked;
  }

  function renderCode() {
    const object = selectedObject();
    const threads = parseObjectScript(object?.script);
    elements.quickBlockThread.innerHTML = threads.map((_, index) => `<option value="${index}">코드 묶음 ${index + 1}</option>`).join("") || '<option value="0">새 코드 묶음</option>';
    elements.codeList.innerHTML = threads.map((thread, threadIndex) => `<section class="code-thread"><header><strong>코드 묶음 ${threadIndex + 1}</strong><small>${thread.length}개 블록</small></header>${thread.map((block, blockIndex) => `<div class="code-block ${blockIndex === 0 ? "event" : "action"}"><span>${escapeHtml(describeWorkbenchBlock(block))}</span><button type="button" data-workbench-edit data-remove-block data-thread="${threadIndex}" data-block="${blockIndex}" aria-label="블록 삭제">×</button></div>`).join("")}</section>`).join("") || '<p class="workbench-empty">아직 코드가 없어요. 빠른 블록을 추가해 보세요.</p>';
    elements.rawScript.value = object ? JSON.stringify(parseObjectScript(object.script), null, 2) : "[]";
  }

  function renderStats() {
    const stats = workbenchProjectStats(draft);
    elements.stats.textContent = `오브젝트 ${stats.objects} · 코드 묶음 ${stats.threads} · 블록 ${stats.blocks} · 변수 ${stats.variables}`;
    elements.dirtyBadge.textContent = dirty ? "적용 안 된 수정 있음" : "현재 작품과 일치";
    elements.dirtyBadge.classList.toggle("dirty", dirty);
  }

  function renderAgent() {
    elements.statusDot.className = `agent-status-dot ${agent.failed ? "error" : agent.running ? "working" : "ready"}`;
    elements.statusText.textContent = agent.failed ? "작업 중 오류" : agent.running ? "AI가 작업 중" : "직접 편집 가능";
    elements.statusDetail.textContent = agent.detail || "오브젝트와 코드를 확인하거나 직접 수정할 수 있어요.";
    elements.model.textContent = agent.model || "Gemini 자동 선택";
    elements.cancelButton.classList.toggle("hidden", !agent.running);
    elements.timeline.innerHTML = AGENT_STAGES.map((stage) => `<li class="${agent.stageState[stage.id] || "pending"}"><span></span><div><strong>${stage.label}</strong>${stage.id === agent.activeStage && agent.detail ? `<small>${escapeHtml(agent.detail)}</small>` : ""}</div></li>`).join("");
    elements.sources.innerHTML = agent.citations.length
      ? agent.citations.slice(0, 8).map((citation) => `<a href="${escapeHtml(safeExternalUrl(citation.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(citation.title || citation.url)}</a>`).join("")
      : agent.urls.length
        ? agent.urls.map((url) => `<span>${escapeHtml(url)}</span>`).join("")
        : '<span class="workbench-empty">이번 요청에는 참고 링크가 없어요.</span>';
    elements.workLog.innerHTML = agent.workLog.length
      ? agent.workLog.slice(0, 12).map((item) => `<li><strong>${escapeHtml(item.phase || "작업")}</strong><span>${escapeHtml(item.detail || String(item))}</span></li>`).join("")
      : '<li class="workbench-empty">완료된 작업 요약이 여기에 표시돼요.</li>';
    renderElapsed();
  }

  function renderElapsed() {
    const elapsed = agent.running && agent.startedAt ? Math.max(0, Date.now() - agent.startedAt) : agent.elapsedMs;
    const seconds = Math.floor(elapsed / 1000);
    elements.elapsed.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function renderLockedState() {
    elements.dialog.classList.toggle("agent-running", locked);
    for (const element of elements.dialog.querySelectorAll("[data-workbench-edit]")) element.disabled = locked;
    elements.lockNotice.classList.toggle("hidden", !locked);
    updateQuickBlockPlaceholder();
  }

  function updateQuickBlockPlaceholder() {
    const descriptor = QUICK_BLOCK_CATALOG.find((item) => item.id === elements.quickBlock.value);
    elements.quickBlockValue.placeholder = descriptor?.placeholder || "추가 값 없음";
    elements.quickBlockValue.disabled = locked || !descriptor?.placeholder;
  }

  function selectedObject() {
    return draft?.objects?.find((item) => item.id === selectedObjectId) || null;
  }

  function markDirty() {
    dirty = true;
    renderStats();
  }

  function canEdit() {
    if (!locked) return true;
    options.onAlert?.("AI 작업이 끝난 뒤 초안을 직접 수정할 수 있어요.");
    return false;
  }

  function selectedPicture(object) {
    return object?.sprite?.pictures?.find((picture) => picture.id === object.selectedPictureId) || object?.sprite?.pictures?.[0];
  }

  function previewSource(fileurl) {
    if (!fileurl) return "";
    if (/^(data:image\/|https?:\/\/|blob:)/i.test(fileurl)) return fileurl;
    if (/^\.\/bower_components\//.test(fileurl)) return "";
    const normalized = String(fileurl).replace(/\\/g, "/").replace(/^\.\//, "").replace(/^temp\//, "");
    const entry = (options.getArchiveEntries?.() || []).find((item) => {
      const name = String(item.name || "").replace(/\\/g, "/").replace(/^temp\//, "");
      return name === normalized;
    });
    if (!entry?.data) return "";
    if (previewUrls.has(normalized)) return previewUrls.get(normalized);
    const url = URL.createObjectURL(new Blob([entry.data], { type: mimeFromPath(normalized) }));
    previewUrls.set(normalized, url);
    return url;
  }

  function revokePreviewUrls() {
    for (const url of previewUrls.values()) URL.revokeObjectURL(url);
    previewUrls.clear();
  }
}

function getElements() {
  const byId = (id) => document.getElementById(id);
  return {
    dialog: byId("workbenchDialog"),
    openButton: byId("workbenchBtn"),
    closeButton: byId("closeWorkbenchBtn"),
    cancelButton: byId("cancelAgentBtn"),
    statusDot: byId("agentStatusDot"),
    statusText: byId("agentStatusText"),
    statusDetail: byId("agentStatusDetail"),
    elapsed: byId("agentElapsed"),
    model: byId("agentModel"),
    timeline: byId("agentTimeline"),
    sources: byId("agentSources"),
    workLog: byId("agentWorkLog"),
    lockNotice: byId("workbenchLockNotice"),
    objectList: byId("workbenchObjectList"),
    newObjectName: byId("newObjectName"),
    addObject: byId("addWorkbenchObjectBtn"),
    deleteObject: byId("deleteWorkbenchObjectBtn"),
    stage: byId("workbenchStage"),
    stats: byId("workbenchStats"),
    dirtyBadge: byId("workbenchDirtyBadge"),
    objectName: byId("workbenchObjectName"),
    objectX: byId("workbenchObjectX"),
    objectY: byId("workbenchObjectY"),
    objectRotation: byId("workbenchObjectRotation"),
    objectScale: byId("workbenchObjectScale"),
    objectVisible: byId("workbenchObjectVisible"),
    quickBlock: byId("quickBlockType"),
    quickBlockValue: byId("quickBlockValue"),
    quickBlockThread: byId("quickBlockThread"),
    addBlock: byId("addQuickBlockBtn"),
    codeList: byId("workbenchCodeList"),
    rawScript: byId("workbenchRawScript"),
    applyRaw: byId("applyRawScriptBtn"),
    formatRaw: byId("formatRawScriptBtn"),
    applyProject: byId("applyWorkbenchBtn"),
    resetProject: byId("resetWorkbenchBtn"),
  };
}

function freshAgentState() {
  return {
    running: false,
    failed: false,
    startedAt: 0,
    elapsedMs: 0,
    activeStage: "analysis",
    stageState: Object.fromEntries(AGENT_STAGES.map((stage) => [stage.id, "pending"])),
    detail: "",
    model: "",
    interactionId: "",
    request: "",
    urls: [],
    citations: [],
    workLog: [],
  };
}

function mimeFromPath(path) {
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.webp$/i.test(path)) return "image/webp";
  if (/\.gif$/i.test(path)) return "image/gif";
  if (/\.svg$/i.test(path)) return "image/svg+xml";
  return "image/jpeg";
}

function round(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : 0;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}
