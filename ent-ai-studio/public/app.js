import { ENTRY_SAFE_BLOCK_TYPES, collectArchiveAssetNames, repairEntryProject, validateEntryProject } from "./entry-safety.js";
import { buildEntBlob, readEntArchive } from "./entry-archive.js";
import { embedImageAsset } from "./entry-assets.js";
import { entryKnowledgePrompt } from "./entry-knowledge.js";
import { extractInteractionCitations, extractInteractionImage, extractInteractionText } from "./gemini-interactions.js";
import { PREFERRED_GEMINI_MODELS, selectGeminiTextModels } from "./gemini-models.js";
import { createEntryWorkbench } from "./entry-workbench-ui.js";
import { mergeMemory, vibentryPersonaPrompt } from "./vibentry-persona.js";

const $ = (selector) => document.querySelector(selector);
const ui = {
  apiKey: $("#apiKey"), rememberKey: $("#rememberKey"), prompt: $("#userPrompt"), file: $("#fileInput"),
  thread: $("#chatThread"), history: $("#historyList"), attachments: $("#attachmentList"), alert: $("#alertBox"),
  send: $("#generateBtn"), title: $("#chatTitle"), model: $("#modelStatus"), summary: $("#projectSummary"),
  stage: $("#stagePreview"), objects: $("#objectList"),
  sidebar: $("#sidebar"), inspector: $("#inspector"), settings: $("#settingsDialog"),
  cloudBadge: $("#cloudBadge"), cloudStatus: $("#cloudStatus"), cloudDot: $("#cloudDot"),
  cloudSignedOut: $("#cloudSignedOut"), cloudSignedIn: $("#cloudSignedIn"), cloudSyncCode: $("#cloudSyncCode"),
  cloudMemoryList: $("#cloudMemoryList"),
};
const IMAGE_MODEL = "gemini-3.1-flash-image";
const INTERACTIONS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODELS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000";
const INTERACTIONS_REVISION = "2026-05-20";
const IMAGE_INPUT_LIMIT = 8 * 1024 * 1024;
const IMAGE_INPUT_COUNT_LIMIT = 4;
const GEMINI_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const SESSION_DB = "vibentry-conversations";
const schema = { type:"object", properties:{
  assistant_message:{type:"string"}, project_name:{type:"string"}, download_name:{type:"string"},
  warnings:{type:"array",items:{type:"string"}}, project_json:{type:"object",additionalProperties:true},
  conversation_summary:{type:"string"}, memory_updates:{type:"array",items:{type:"string"}},
  work_log:{type:"array",items:{type:"object",properties:{phase:{type:"string"},detail:{type:"string"}},required:["phase","detail"]}},
  asset_requests:{type:"array",items:{type:"object",properties:{object_id:{type:"string"},name:{type:"string"},prompt:{type:"string"},source_image_name:{type:"string"}},required:["object_id","name","prompt"]}}
}, required:["assistant_message","project_name","project_json"], additionalProperties:true };

let template;
let session;
let sessions = [];
let files = [];
let busy = false;
let cloudToken = "";
let cloudAccount = null;
let accountMemory = [];
let cloudBusy = false;
let lastSyncedMemory = "";
let workbench = null;
let activeAgentRequest = null;

init().catch((error) => showAlert(`초기화하지 못했어요: ${error.message}`, true));

async function init() {
  template = await fetch("/api/template").then((response) => response.json()).then((data) => data.project);
  restoreSettings();
  sessions = await dbAll();
  await recoverInterruptedSessions();
  session = sessions.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0] || newSession();
  workbench = createEntryWorkbench({
    getSessionId: () => session.id,
    getSessionVersion: () => session.updatedAt,
    getProject: () => session.project,
    getBaseProject: () => session.baseProject || template,
    getArchiveEntries: () => session.archiveEntries || [],
    onApply: async (project,warnings=[]) => {
      session.project=project;
      session.baseProject=session.baseProject||template;
      session.title=(project.name||session.title).slice(0,40);
      await saveSession();
      renderAll();
      showAlert(warnings.length?`작업실 수정을 적용했어요. 자동 보정: ${warnings.slice(0,2).join(" · ")}`:"작업실 수정을 현재 작품에 적용했어요.");
    },
    onCancelAgent: cancelActiveAgent,
    onAlert: showAlert,
  });
  bindEvents();
  renderAll();
  renderCloudState();
  if (cloudToken) {
    await syncCloud({ quiet: true });
  }
}

function bindEvents() {
  $("#newChatBtn").onclick = async () => { if(busy)return showAlert("AI가 현재 작품을 마칠 때까지 기다리거나 작업실에서 중단해 주세요.");if(!confirmWorkbenchDiscard())return;session = newSession(); files=[]; await saveSession(); renderAll(); closePanels(); };
  $("#settingsBtn").onclick = () => ui.settings.showModal();
  $("#saveSettingsBtn").onclick = saveSettings;
  $("#cloudRegisterBtn").onclick = registerCloudAccount;
  $("#cloudLoginBtn").onclick = loginCloudAccount;
  $("#syncNowBtn").onclick = () => syncCloud();
  $("#copySyncCodeBtn").onclick = copySyncCode;
  $("#cloudLogoutBtn").onclick = logoutCloudAccount;
  $("#cloudDeleteBtn").onclick = deleteCloudAccount;
  $("#clearMemoryBtn").onclick = clearAiMemory;
  $("#menuBtn").onclick = () => ui.sidebar.classList.toggle("open");
  $("#previewBtn").onclick = () => ui.inspector.classList.toggle("open");
  $("#closePreviewBtn").onclick = () => ui.inspector.classList.remove("open");
  ui.send.onclick = sendMessage;
  ui.file.onchange = (event) => loadFiles([...event.target.files]);
  ui.prompt.addEventListener("input", autoGrow);
  ui.prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); }
  });
  document.addEventListener("click", (event) => {
    const artifact = event.target.closest("[data-ent-file]");
    if (artifact) {
      event.preventDefault();
      downloadEnt(artifact.dataset.entFile).catch((error) => showAlert(`파일을 준비하지 못했어요: ${error.message}`, true));
      return;
    }
    const sample = event.target.closest("[data-sample]");
    if (sample) { ui.prompt.value=sample.dataset.sample; autoGrow(); ui.prompt.focus(); }
  });
}

function newSession() {
  return { id:crypto.randomUUID(), title:"새 Entry 작품", createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), messages:[], project:null, archiveEntries:[], baseProject:null, interactionId:null, memorySummary:"" };
}

async function recoverInterruptedSessions(){
  let changed=false;
  for(const item of sessions){
    let itemChanged=false;
    for(const message of item.messages||[]){
      if(message.pending){
        message.pending=false;
        message.text="이전 작업이 완료되기 전에 창이 닫혔어요. 같은 요청을 다시 보내면 이어서 작업할게요.";
        changed=true;itemChanged=true;
      }
    }
    if(itemChanged)await dbPut(item);
  }
  if(changed)sessions=await dbAll();
}

async function loadFiles(selected) {
  let imageBytes=files.filter((item)=>item.kind==="image").reduce((sum,item)=>sum+(Number(item.size)||0),0);
  let imageCount=files.filter((item)=>item.kind==="image").length;
  for (const file of selected) {
    if (file.name.toLowerCase().endsWith(".ent")) {
      const archive = await readEntArchive(file);
      files.push({name:file.name,kind:"ent",project:archive.project,entries:archive.entries});
      session.project = archive.project; session.baseProject = archive.project; session.archiveEntries = archive.entries;
      if (!session.messages.length) addMessage("assistant", `${file.name}을 열었어요. 이제 원하는 수정 내용을 말해 주세요.`);
    } else if (file.type.startsWith("image/")) {
      if (!GEMINI_IMAGE_TYPES.has(file.type.toLowerCase())) {
        showAlert(`${file.name} 형식은 AI가 직접 볼 수 없어요. PNG, JPG 또는 WebP로 바꾼 뒤 다시 선택해 주세요.`, true);
        continue;
      }
      if (imageCount >= IMAGE_INPUT_COUNT_LIMIT) {
        showAlert("AI가 한 번에 직접 확인할 이미지는 최대 4장이에요.", true);
        continue;
      }
      if (file.size > IMAGE_INPUT_LIMIT || imageBytes + file.size > IMAGE_INPUT_LIMIT) {
        showAlert("AI가 한 번에 읽을 이미지의 합계는 8MB까지예요. 이미지 크기나 장수를 줄여 주세요.", true);
        continue;
      }
      files.push({name:file.name,kind:"image",dataUrl:await readDataUrl(file),type:file.type,size:file.size});
      imageBytes+=file.size;
      imageCount+=1;
    } else {
      files.push({name:file.name,kind:"text",text:(await file.text()).slice(0,20000),size:file.size});
    }
  }
  await saveSession(); renderAttachments(); renderProject(); renderMessages();
  workbench?.loadProject(session.project,{resetDirty:true});
  ui.file.value="";
}

async function sendMessage() {
  if (busy) return;
  const text = ui.prompt.value.trim();
  const key = ui.apiKey.value.trim();
  if (!key) { ui.settings.showModal(); return showAlert("먼저 Gemini API 키를 입력해 주세요."); }
  if (!text) return showAlert("만들거나 수정할 내용을 한 문장으로 적어 주세요.");
  busy=true; ui.send.disabled=true; hideAlert();
  addMessage("user",text); ui.prompt.value=""; autoGrow(); renderMessages();
  const thinking = addMessage("assistant","작품 구조와 블록을 설계하고 있어요…",true); renderMessages();
  await saveSession();
  const base = session.project || files.find((f)=>f.kind==="ent")?.project || template;
  const urls = extractUrls(text);
  workbench?.startAgent({request:text,urls,project:base});
  workbench?.open();
  try {
    workbench?.updateAgent(urls.length?"research":"architecture",urls.length?`${urls.length}개 공개 링크를 URL Context로 읽을 준비를 하고 있어요.`:"필요한 오브젝트와 코드 묶음을 설계하고 있어요.");
    const result = await callAgent(key, buildAgentPrompt(text,base),(stage,detail,meta)=>workbench?.updateAgent(stage,detail,meta));
    const sourceEnt = files.find((f)=>f.kind==="ent");
    let candidate = hydrateExistingAssets(result.project_json, base);
    if (result.project_name && candidate) candidate={...candidate,name:result.project_name};
    workbench?.updateAgent("coding","AI가 만든 전체 project.json 초안을 오브젝트와 블록으로 펼쳤어요.",{project:candidate,citations:result.citations,workLog:result.work_log,model:result.model});
    let entries = sourceEnt?.entries || session.archiveEntries || [];
    const assetResult = await applyAssets(key,candidate,result.asset_requests || [],entries,(detail,project)=>workbench?.updateAgent("assets",detail,{project,citations:result.citations,model:result.model}));
    candidate = assetResult.project;
    entries = assetResult.entries;
    workbench?.updateAgent("validation","고유 ID, 블록 형식, 자산 경로와 모든 참조를 검사하고 있어요.",{project:candidate,citations:result.citations,model:result.model});
    const safety = repairEntryProject(candidate,base,{availableAssets:collectArchiveAssetNames(entries)});
    if (safety.validation.errors.length) throw new Error(`작품 검사 실패: ${safety.validation.errors[0]}`);
    session.project=safety.project; session.baseProject=base; session.archiveEntries=entries;
    session.interactionId=result.interactionId || session.interactionId;
    session.memorySummary=String(result.conversation_summary || session.memorySummary || "").slice(0,4000);
    accountMemory=mergeMemory(accountMemory,result.memory_updates);
    persistMemory();
    session.title=(safety.project.name || result.project_name || text).slice(0,40);
    thinking.text=result.assistant_message || "요청한 내용을 작품에 반영했어요."; thinking.pending=false;
    thinking.files=[`${safeName(result.download_name || session.title)}.ent`];
    const warnings=[...(result.warnings||[]),...(assetResult.warnings||[]),...safety.warnings];
    if (warnings.length) thinking.text += `\n\n확인할 점: ${warnings.slice(0,3).join(" · ")}`;
    files=[];
    await saveSession(); renderAll();
    workbench?.finishAgent({project:safety.project,citations:result.citations,workLog:result.work_log,detail:`오브젝트 ${safety.validation.stats.objects}개와 블록 ${safety.validation.stats.blocks}개를 검사하고 .ent 준비를 마쳤어요.`});
  } catch(error) {
    thinking.pending=false; thinking.text=friendlyError(error); renderMessages(); showAlert(thinking.text,true);
    workbench?.failAgent(thinking.text);
    await saveSession();
  } finally { busy=false; ui.send.disabled=false; activeAgentRequest=null; }
}

function buildAgentPrompt(request,base) {
  const urls=extractUrls(request);
  const references=files.filter((f)=>f.kind!=="ent").map((f)=>f.kind==="text"?`TEXT ${f.name}:\n${f.text}`:`IMAGE ${f.name} (${f.type}, ${f.size} bytes)`).join("\n\n");
  const recent=session.messages.filter((m)=>!m.pending).slice(-24).map((m)=>`${m.role}: ${String(m.text||"").slice(0,3000)}`).join("\n");
  const otherChats=sessions
    .filter((item)=>item.id!==session.id)
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))
    .slice(0,8)
    .map((item)=>{
      const fallback=(item.messages||[]).filter((message)=>!message.pending).slice(-2).map((message)=>message.text).join(" / ");
      return `- ${item.title}: ${String(item.memorySummary||fallback||"요약 없음").slice(0,600)}`;
    }).join("\n");
  return [
    vibentryPersonaPrompt(accountMemory),
    "You are also a precise agent that creates and edits complete Entry project.json files.",
    "Respond in natural Korean. Continue editing the supplied current project instead of starting over unless asked.",
    "You may add or delete any number of objects. Preserve requested existing behavior and remove only what the user requests.",
    "Use high-effort reasoning before writing the final JSON. First design the object graph, events, variables, lists, signals, and reusable loops; then construct blocks; then audit every reference and parameter index.",
    "Optimize for Entry runtime efficiency: avoid duplicate polling loops, avoid unbounded clone creation, add waits to non-frame-critical infinite loops, reuse variables/signals, and keep each object's responsibility clear.",
    entryKnowledgePrompt(),
    "Use unique IDs and consistent scene, selectedPictureId and interface.object references.",
    `Only use verified block types: ${ENTRY_SAFE_BLOCK_TYPES.join(", ")}.`,
    "For every requested custom visual, add an asset_requests item with the target object_id and a detailed standalone sprite prompt. The app generates the image and embeds image/thumb files into the .ent archive. Keep a temporary valid existing picture until replacement.",
    "Actual IMAGE attachment bytes follow this text as multimodal input. Inspect their visible content before deciding how they should be used. To insert one unchanged, set source_image_name to its exact IMAGE filename in asset_requests. Do not invent asset URLs.",
    "When public URLs are supplied, actually use URL Context to study them. Apply only relevant facts and do not claim a page was read if the tool could not access it.",
    "Return work_log as short, user-visible Korean milestones describing architecture and concrete edits. Do not reveal hidden chain-of-thought.",
    "Return the entire resulting project in project_json, not a patch.",
    "Return conversation_summary as a compact Korean summary of durable decisions and unfinished work in this chat.",
    "Return memory_updates only for safe, durable user preferences allowed by the identity memory policy.",
    urls.length?`[USER_PUBLIC_URLS]\nThe app enabled URL context for these public links: ${urls.join(", ")}`:"No user URLs supplied.",
    `RECENT CONVERSATION:\n${recent || "none"}`,
    `CURRENT CHAT MEMORY SUMMARY:\n${session.memorySummary || "none"}`,
    `OTHER SAVED CHAT SUMMARIES:\n${otherChats || "none"}`,
    `ATTACHMENTS:\n${references || "none"}`,
    `USER REQUEST:\n${request}`,
    `CURRENT PROJECT_JSON:\n${JSON.stringify(compactProjectForPrompt(base))}`,
  ].join("\n\n");
}

function extractUrls(value){return [...String(value||"").matchAll(/https?:\/\/[^\s<>"']+/g)].map((match)=>match[0].replace(/[),.;!?]+$/g,"")).slice(0,20);}

function buildAgentInput(prompt){
  const input=[{type:"text",text:prompt}];
  for(const file of files.filter((item)=>item.kind==="image").slice(0,4)){
    const match=String(file.dataUrl||"").match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if(!match)continue;
    input.push({type:"image",mime_type:match[1].toLowerCase(),data:match[2]});
  }
  return input;
}

async function callAgent(key,prompt,onProgress=()=>{}) {
  let last;
  let previousInteractionId=session.interactionId;
  onProgress("analysis","API 키에서 사용할 수 있는 Gemini 모델을 확인하고 있어요.",{model:"Gemini 자동 선택"});
  const models=await discoverModels(key);
  for (const model of models) {
    try {
      while(true){
        ui.model.textContent=`${model} 작업 중`;
        onProgress("architecture",`${model}이 오브젝트 역할, 이벤트와 데이터 흐름을 설계하고 있어요.`,{model});
        const body={
          model,
          input:buildAgentInput(prompt),
          response_format:{type:"text",mime_type:"application/json",schema},
          generation_config:{thinking_level:"high",temperature:0.15},
          background:true,
          store:true,
        };
        if (prompt.includes("[USER_PUBLIC_URLS]") && supportsUrlContext(model)) body.tools=[{type:"url_context"}];
        if (previousInteractionId) body.previous_interaction_id=previousInteractionId;
        const response=await fetch(INTERACTIONS_ENDPOINT,{method:"POST",headers:interactionHeaders(key),body:JSON.stringify(body)});
        let data=await response.json();
        if(!response.ok){
          const error=apiError(response.status,data);
          if(previousInteractionId&&/previous[_ ]interaction|interaction.+(?:not found|permission|access)/i.test(error.message)){
            previousInteractionId=null;session.interactionId=null;continue;
          }
          throw error;
        }
        activeAgentRequest={key,interactionId:data.id||"",cancelled:false};
        onProgress("coding",`${model} 백그라운드 작업을 시작했어요. 연결이 끊겨도 서버에서 계속 진행됩니다.`,{model,interactionId:data.id});
        data=await waitForBackgroundInteraction(key,data,model,onProgress);
        const parsed=JSON.parse(extractInteractionText(data));
        parsed.interactionId=data.id;
        parsed.citations=extractInteractionCitations(data);
        parsed.model=model;
        ui.model.textContent=model;
        return parsed;
      }
    } catch(error) {
      last=error;
      activeAgentRequest=null;
      if(error.code==="CANCELLED")throw error;
      if (!isModelCompatibilityError(error)) break;
    }
  }
  throw last || new Error("사용 가능한 Gemini 모델을 찾지 못했어요.");
}

async function discoverModels(key){
  try{
    const response=await fetch(MODELS_ENDPOINT,{headers:{"x-goog-api-key":key}});
    if(!response.ok)return [...PREFERRED_GEMINI_MODELS];
    return selectGeminiTextModels(await response.json());
  }catch{
    return [...PREFERRED_GEMINI_MODELS];
  }
}

function isModelCompatibilityError(error){
  if([400,404].includes(error?.status))return true;
  return error?.status===403 && /model.+(?:not available|unsupported|permission)|(?:not available|unsupported).+model/i.test(String(error?.message||""));
}

function supportsUrlContext(model){
  return /^gemini-(?:3(?:[.-]|$)|2\.5-(?:pro|flash(?:-lite)?)(?:-|$)|(?:flash|pro)-latest$)/.test(model);
}

async function waitForBackgroundInteraction(key,initial,model,onProgress){
  let interaction=initial;
  const started=Date.now();
  while(["in_progress","queued"].includes(interaction.status)){
    if(activeAgentRequest?.cancelled)throw cancelledError();
    if(Date.now()-started>30*60_000){const error=new Error("Gemini 작업이 30분 안에 끝나지 않았어요. 서버에서는 계속 처리 중일 수 있어요.");error.status=408;throw error;}
    await delay(1600);
    const response=await fetch(`${INTERACTIONS_ENDPOINT}/${encodeURIComponent(interaction.id)}`,{headers:interactionHeaders(key,false)});
    const data=await response.json();
    if(!response.ok)throw apiError(response.status,data);
    interaction=data;
    const observed=Array.isArray(data.steps)?data.steps.length:0;
    const citations=extractInteractionCitations(data);
    onProgress("coding",`Gemini가 전체 Entry 코드를 작성 중이에요 · 확인 가능한 실행 단계 ${observed}개`,{model,interactionId:data.id,citations});
  }
  if(activeAgentRequest?.cancelled)throw cancelledError();
  if(interaction.status&&interaction.status!=="completed"){
    const error=new Error(interaction.error?.message||`Gemini 백그라운드 작업이 ${interaction.status} 상태로 끝났어요.`);
    error.status=interaction.error?.code||500;
    throw error;
  }
  return interaction;
}

async function cancelActiveAgent(){
  const request=activeAgentRequest;
  if(!request)return;
  request.cancelled=true;
  if(request.interactionId){
    try{await fetch(`${INTERACTIONS_ENDPOINT}/${encodeURIComponent(request.interactionId)}/cancel`,{method:"POST",headers:interactionHeaders(request.key,false)});}catch{}
  }
  showAlert("AI 작업 중단을 요청했어요. 현재 작품과 저장된 대화는 그대로 유지됩니다.");
}

function interactionHeaders(key,includeContentType=true){
  const headers={"x-goog-api-key":key,"Api-Revision":INTERACTIONS_REVISION};
  if(includeContentType)headers["Content-Type"]="application/json";
  return headers;
}
function cancelledError(){const error=new Error("사용자가 AI 작업을 중단했어요.");error.code="CANCELLED";return error;}
function delay(milliseconds){return new Promise((resolve)=>setTimeout(resolve,milliseconds));}

async function applyAssets(key,project,requests,sourceEntries=[],onProgress=()=>{}) {
  let entries=[...sourceEntries];
  const warnings=[];
  if (!project || !Array.isArray(requests)) return {project,entries,warnings};
  const selectedRequests=requests.slice(0,8);
  if(requests.length>selectedRequests.length)warnings.push(`이미지 요청 ${requests.length}개 중 API 과다 호출을 막기 위해 처음 ${selectedRequests.length}개를 처리했어요.`);
  for (const [index,request] of selectedRequests.entries()) {
    if(activeAgentRequest?.cancelled)throw cancelledError();
    const object=project.objects?.find((item)=>item.id===request.object_id || item.name===request.object_id);
    if (!object) {
      warnings.push(`${request.name||request.object_id||"이미지"}을 넣을 오브젝트를 찾지 못했어요.`);
      continue;
    }
    onProgress(`${request.name||object.name} 이미지 준비 중 · ${index+1}/${selectedRequests.length}`,project);
    let dataUrl;
    const attached=files.find((file)=>file.kind==="image" && file.name===request.source_image_name);
    if (attached) dataUrl=attached.dataUrl;
    else {
      const response=await fetch(INTERACTIONS_ENDPOINT,{method:"POST",headers:interactionHeaders(key),body:JSON.stringify({model:IMAGE_MODEL,input:[{type:"text",text:`Create a production-ready 2D game sprite for Entry block coding. ${request.prompt}. Show the complete subject centered with a clean silhouette, consistent lighting, no crop, no watermark, and a transparent background whenever suitable. Do not add text unless the user explicitly requested it.`}],response_format:{type:"image",mime_type:"image/png",aspect_ratio:"1:1",image_size:"1K"},generation_config:{thinking_level:"high"}})});
      const data=await response.json(); if(!response.ok) throw apiError(response.status,data);
      dataUrl=extractInteractionImage(data);
    }
    if (!dataUrl) throw new Error(`${request.name} 이미지를 만들지 못했어요.`);
    const dimension=await imageSize(dataUrl);
    const embedded=embedImageAsset(project,entries,{objectId:object.id,name:request.name||object.name,dataUrl,dimension});
    entries=embedded.entries;
    onProgress(`${request.name||object.name} 이미지를 .ent의 ${embedded.archivePaths[0]}에 넣었어요.`,project);
  }
  return {project,entries,warnings};
}

function compactProjectForPrompt(project) {
  const copy=structuredClone(project);
  for(const object of copy.objects||[]) for(const picture of object.sprite?.pictures||[]) {
    if(/^data:image\//.test(picture.fileurl||"")){picture.fileurl="__KEEP_EXISTING_ASSET__";picture.thumbUrl="__KEEP_EXISTING_ASSET__";}
  }
  return copy;
}

function hydrateExistingAssets(candidate,base) {
  if(!candidate||!base)return candidate;
  for(const object of candidate.objects||[]){
    const old=base.objects?.find((item)=>item.id===object.id);
    for(const picture of object.sprite?.pictures||[]){
      if(picture.fileurl!=="__KEEP_EXISTING_ASSET__")continue;
      const oldPicture=old?.sprite?.pictures?.find((item)=>item.id===picture.id)||old?.sprite?.pictures?.[0];
      if(oldPicture)Object.assign(picture,structuredClone(oldPicture));
    }
  }
  return candidate;
}

function apiError(status,data){const error=new Error(data?.error?.message||`Gemini 요청 실패 (${status})`);error.status=status;return error;}
function friendlyError(error){const text=String(error?.message||error);if(error?.status===429||/quota|resource_exhausted/i.test(text))return "Gemini 사용 한도를 모두 썼어요. 잠시 기다린 뒤 다시 시도하거나 Google AI Studio에서 사용량을 확인해 주세요. 현재 대화와 작품은 그대로 저장되어 있어요.";if(error?.status===401||error?.status===403)return "API 키를 확인해 주세요. 키가 잘못되었거나 이 모델을 사용할 권한이 없어요.";if(/url_context|URL context/i.test(text))return "링크를 읽지 못했어요. 로그인 없이 열리는 공개 링크인지 확인해 주세요.";return `작품을 완성하지 못했어요. ${text}`;}

function addMessage(role,text,pending=false){const message={id:crypto.randomUUID(),role,text,pending,at:new Date().toISOString()};session.messages.push(message);return message;}
function renderAll(){renderHistory();renderMessages();renderAttachments();renderProject();ui.title.textContent=session.title;workbench?.syncFromSession();}
function renderMessages(){
  const welcome=ui.thread.firstElementChild?.outerHTML || "";
  ui.thread.innerHTML=(session.messages.length?"":welcome)+session.messages.map((m)=>{
    const artifacts=(m.files||[])
      .filter((fileName)=>typeof fileName==="string"&&fileName.toLowerCase().endsWith(".ent"))
      .map((fileName)=>`<button type="button" class="ent-artifact" data-ent-file="${escapeHtml(fileName)}"><span class="ent-file-icon">.ent</span><span class="ent-file-copy"><strong>${escapeHtml(fileName)}</strong><small>AI가 만든 Entry 작품</small></span><span class="ent-file-action">저장</span></button>`)
      .join("");
    return `<article class="message ${m.role}">${m.role==="assistant"?'<div class="avatar">v</div>':""}<div class="bubble">${m.pending?'<strong>생각하는 중</strong> ':""}${escapeHtml(m.text)}${artifacts}</div></article>`;
  }).join("");
  ui.thread.scrollTop=ui.thread.scrollHeight;
}
function renderHistory(){ui.history.innerHTML=sessions.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map((s)=>`<button class="history-item ${s.id===session.id?"active":""}" data-id="${s.id}">${escapeHtml(s.title)}</button>`).join("")||'<span class="rail-label">아직 대화가 없어요.</span>';ui.history.querySelectorAll("button").forEach((button)=>button.onclick=async()=>{if(busy)return showAlert("AI 작업이 끝난 뒤 다른 대화로 이동할 수 있어요.");if(button.dataset.id!==session.id&&!confirmWorkbenchDiscard())return;const found=await dbGet(button.dataset.id);if(found){session=found;files=[];renderAll();closePanels();}});}
function confirmWorkbenchDiscard(){return !workbench?.hasUnsavedChanges?.()||confirm("작업실에 아직 적용하지 않은 수정이 있어요. 이 수정을 버리고 이동할까요?");}
function renderAttachments(){ui.attachments.innerHTML=files.map((f)=>`<span class="attachment">${escapeHtml(f.name)}</span>`).join("");}
function renderProject(){const p=session.project;if(!p){ui.summary.textContent="아직 작품이 없어요.";ui.objects.innerHTML="";return;}const blocks=(p.objects||[]).reduce((sum,o)=>sum+countBlocks(o.script),0);ui.summary.innerHTML=`<strong>${escapeHtml(p.name||"Entry 작품")}</strong><br>오브젝트 ${(p.objects||[]).length}개 · 변수 ${(p.variables||[]).length}개 · 블록 ${blocks}개`;ui.stage.innerHTML=(p.objects||[]).map((o,i)=>{const pic=o.sprite?.pictures?.find((x)=>x.id===o.selectedPictureId)||o.sprite?.pictures?.[0];const left=50+(Number(o.entity?.x)||0)/10;const top=50-(Number(o.entity?.y)||0)/7.5;return `<div class="stage-object" style="left:${clamp(left,5,95)}%;top:${clamp(top,5,95)}%">${pic?`<img src="${escapeHtml(pic.fileurl)}" alt="">`:""}<span>${escapeHtml(o.name)}</span></div>`}).join("")||"<span>오브젝트 없음</span>";ui.objects.innerHTML=(p.objects||[]).map((o)=>{const pic=o.sprite?.pictures?.[0];return `<div class="object-card">${pic?`<img src="${escapeHtml(pic.fileurl)}" alt="">`:""}<div><strong>${escapeHtml(o.name)}</strong><br><small>코드 묶음 ${scriptThreads(o.script)}개</small></div></div>`}).join("");}

async function saveSession(){
  session.updatedAt=new Date().toISOString();
  await dbPut(session);
  sessions=await dbAll();
  if(cloudToken){
    try{
      await pushCloudSession(session);
      await pushCloudMemory();
      setCloudStatus("모든 기기에 저장됨","ready");
    }catch(error){
      setCloudStatus("로컬 저장됨 · 동기화 대기","offline");
      console.warn("cloud save deferred",error);
    }
  }
}
async function downloadEnt(requestedName=""){if(!session.project)return showAlert("이 대화에는 아직 AI가 만든 작품이 없어요.");const base=session.baseProject||template;const safety=repairEntryProject(session.project,base,{availableAssets:collectArchiveAssetNames(session.archiveEntries)});if(safety.validation.errors.length)return showAlert(`파일 검사 실패: ${safety.validation.errors[0]}`,true);const blob=await buildEntBlob(safety.project,session.archiveEntries);const reopened=await readEntArchive(blob);const validation=validateEntryProject(reopened.project,{baseProject:base,availableAssets:collectArchiveAssetNames(reopened.entries)});if(validation.errors.length)return showAlert(`완성 파일 재검사 실패: ${validation.errors[0]}`,true);const fileName=/\.ent$/i.test(requestedName)?safeName(requestedName):`${safeName(safety.project.name)}.ent`;downloadBlob(blob,fileName);}
function downloadBlob(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function saveSettings(){localStorage.setItem("vibentry:remember",String(ui.rememberKey.checked));if(ui.rememberKey.checked)localStorage.setItem("vibentry:key",ui.apiKey.value);else localStorage.removeItem("vibentry:key");}
function restoreSettings(){
  ui.rememberKey.checked=localStorage.getItem("vibentry:remember")==="true";
  if(ui.rememberKey.checked)ui.apiKey.value=localStorage.getItem("vibentry:key")||"";
  cloudToken=localStorage.getItem("vibentry:cloud-token")||"";
  cloudAccount=parseStoredJson("vibentry:cloud-account",null);
  accountMemory=parseStoredJson(memoryStorageKey(),[]);
}

async function registerCloudAccount(){
  if(cloudBusy)return;
  const displayName=$("#cloudDisplayName").value.trim();
  const pin=$("#cloudCreatePin").value.trim();
  cloudBusy=true;setCloudStatus("동기화 계정 만드는 중","syncing");
  try{
    const data=await cloudFetch("/api/cloud/register",{method:"POST",auth:false,body:{displayName,pin}});
    acceptCloudAccount(data.account);
    await syncCloud({quiet:true,force:true});
    showAlert(`기기 간 저장이 켜졌어요. 동기화 코드 ${cloudAccount.syncCode}를 안전한 곳에 기록해 주세요.`);
  }catch(error){showAlert(cloudErrorMessage(error),true);setCloudStatus("연결하지 못함","offline");}
  finally{cloudBusy=false;renderCloudState();}
}

async function loginCloudAccount(){
  if(cloudBusy)return;
  const syncCode=$("#cloudLoginCode").value.trim();
  const pin=$("#cloudLoginPin").value.trim();
  cloudBusy=true;setCloudStatus("기존 대화 불러오는 중","syncing");
  try{
    const data=await cloudFetch("/api/cloud/login",{method:"POST",auth:false,body:{syncCode,pin}});
    acceptCloudAccount(data.account);
    await syncCloud({quiet:true,force:true});
    showAlert("이 기기에 기존 채팅과 작품을 불러왔어요.");
  }catch(error){showAlert(cloudErrorMessage(error),true);setCloudStatus("연결하지 못함","offline");}
  finally{cloudBusy=false;renderCloudState();}
}

async function syncCloud({quiet=false,force=false}={}){
  if(!cloudToken||(cloudBusy&&!force))return;
  cloudBusy=true;setCloudStatus("동기화 중","syncing");
  const activeId=session?.id;
  try{
    const remote=await cloudFetch("/api/cloud/bootstrap");
    cloudAccount={...cloudAccount,...remote.account};
    localStorage.setItem("vibentry:cloud-account",JSON.stringify(cloudAccount));
    const mergedMemory=mergeMemory(accountMemory,remote.account?.memory);
    accountMemory=mergedMemory;persistMemory();

    const localSessions=await dbAll();
    const localById=new Map(localSessions.map((item)=>[item.id,item]));
    const remoteById=new Map((remote.sessions||[]).map((item)=>[item.id,item]));
    for(const remoteSession of remote.sessions||[]){
      const localSession=localById.get(remoteSession.id);
      if(!localSession||toTime(remoteSession.updatedAt)>toTime(localSession.updatedAt)){
        await dbPut(restoreCloudSession(remoteSession));
      }
    }
    for(const localSession of localSessions){
      const remoteSession=remoteById.get(localSession.id);
      if(!remoteSession||toTime(localSession.updatedAt)>toTime(remoteSession.updatedAt)){
        await pushCloudSession(localSession);
      }
    }
    await pushCloudMemory(true);
    sessions=await dbAll();
    session=(activeId&&await dbGet(activeId))||sessions.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]||newSession();
    renderAll();renderCloudState();setCloudStatus("모든 기기에 저장됨","ready");
    if(!quiet)showAlert("최신 채팅과 작품으로 동기화했어요.");
  }catch(error){
    if(error.status===401)clearCloudCredentials();
    setCloudStatus("로컬 저장됨 · 동기화 대기","offline");
    if(!quiet)showAlert(cloudErrorMessage(error),true);
  }finally{cloudBusy=false;renderCloudState();}
}

async function pushCloudSession(value){
  if(!cloudToken)return;
  const safe=await cloudSafeSession(value);
  await cloudFetch(`/api/cloud/sessions/${encodeURIComponent(safe.id)}`,{method:"PUT",body:{session:safe}});
}

async function pushCloudMemory(force=false){
  if(!cloudToken)return;
  const serialized=JSON.stringify(accountMemory);
  if(!force&&serialized===lastSyncedMemory)return;
  const data=await cloudFetch("/api/cloud/memory",{method:"PUT",body:{memory:accountMemory}});
  accountMemory=Array.isArray(data.memory)?data.memory:accountMemory;
  lastSyncedMemory=JSON.stringify(accountMemory);persistMemory();
}

async function cloudSafeSession(value){
  const copy=structuredClone(value);
  copy.archiveEntries=(value.archiveEntries||[])
    .filter((entry)=>entry?.typeFlag!=="5"&&entry?.name!=="temp/project.json")
    .slice(0,300)
    .map((entry)=>({
      name:entry.name,
      data:bytesToBase64(entry.data),
      encoding:"base64",
      typeFlag:entry.typeFlag||"0",
      mode:entry.mode,
    }));
  copy.messages=(copy.messages||[]).slice(-300).map((message)=>({
    ...message,
    text:redactCloudText(String(message.text||"")),
  }));
  return copy;
}

function restoreCloudSession(value){
  const copy=structuredClone(value);
  copy.archiveEntries=(copy.archiveEntries||[]).map((entry)=>({
    name:entry.name,
    data:entry.encoding==="base64"?base64ToBytes(entry.data):new Uint8Array(0),
    typeFlag:entry.typeFlag||"0",
    mode:entry.mode,
  }));
  return copy;
}

async function cloudFetch(pathname,{method="GET",body,auth=true}={}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),20_000);
  try{
    const headers={"Content-Type":"application/json"};
    if(auth&&cloudToken)headers.Authorization=`Bearer ${cloudToken}`;
    const response=await fetch(pathname,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(data.error||`저장 서버 오류 (${response.status})`);error.status=response.status;throw error;}
    return data;
  }catch(error){
    if(error.name==="AbortError")throw new Error("저장 서버 응답이 늦어요. 로컬에는 저장했고 나중에 다시 동기화할게요.");
    throw error;
  }finally{clearTimeout(timeout);}
}

function acceptCloudAccount(account){
  cloudToken=account.token;
  cloudAccount={syncCode:account.syncCode,displayName:account.displayName};
  accountMemory=mergeMemory(parseStoredJson(memoryStorageKey(),[]),account.memory);
  localStorage.setItem("vibentry:cloud-token",cloudToken);
  localStorage.setItem("vibentry:cloud-account",JSON.stringify(cloudAccount));
  persistMemory();lastSyncedMemory=JSON.stringify(accountMemory);
}

async function logoutCloudAccount(){
  try{if(cloudToken)await cloudFetch("/api/cloud/logout",{method:"POST"});}catch{}
  clearCloudCredentials();renderCloudState();showAlert("이 기기의 클라우드 연결을 해제했어요. 로컬 채팅은 그대로 남아 있어요.");
}

async function deleteCloudAccount(){
  if(!cloudToken)return;
  if(!confirm("서버에 저장된 모든 채팅, 작품과 AI 기억을 완전히 삭제할까요? 이 작업은 되돌릴 수 없어요."))return;
  try{
    await cloudFetch("/api/cloud/account",{method:"DELETE"});
    clearCloudCredentials();renderCloudState();showAlert("서버 저장 계정을 삭제했어요. 이 기기의 로컬 채팅은 그대로 남아 있어요.");
  }catch(error){showAlert(cloudErrorMessage(error),true);}
}

async function clearAiMemory(){
  accountMemory=[];persistMemory();lastSyncedMemory="";
  try{await pushCloudMemory(true);renderCloudState();showAlert("AI의 장기 기억을 모두 지웠어요. 채팅과 작품은 삭제되지 않았어요.");}
  catch(error){showAlert(cloudErrorMessage(error),true);}
}

function clearCloudCredentials(){
  cloudToken="";cloudAccount=null;accountMemory=[];lastSyncedMemory="";
  localStorage.removeItem("vibentry:cloud-token");localStorage.removeItem("vibentry:cloud-account");
}

async function copySyncCode(){
  if(!cloudAccount?.syncCode)return;
  try{await navigator.clipboard.writeText(cloudAccount.syncCode);showAlert("동기화 코드를 복사했어요.");}
  catch{showAlert(`동기화 코드: ${cloudAccount.syncCode}`);}
}

function renderCloudState(){
  const connected=Boolean(cloudToken&&cloudAccount);
  ui.cloudSignedOut.classList.toggle("hidden",connected);
  ui.cloudSignedIn.classList.toggle("hidden",!connected);
  ui.cloudSyncCode.textContent=cloudAccount?.syncCode||"VIBE-XXXX-XXXX";
  ui.cloudMemoryList.innerHTML=accountMemory.length
    ? accountMemory.map((item)=>`<div>${escapeHtml(item)}</div>`).join("")
    : "아직 저장된 기억이 없어요.";
  if(!connected)setCloudStatus("연결되지 않음","local");
}

function setCloudStatus(text,mode="local"){
  ui.cloudStatus.textContent=text;ui.cloudBadge.textContent=text;
  ui.cloudDot.className=`cloud-dot ${mode}`;
}

function persistMemory(){localStorage.setItem(memoryStorageKey(),JSON.stringify(accountMemory));}
function memoryStorageKey(){return `vibentry:memory:${cloudAccount?.syncCode||"local"}`;}
function parseStoredJson(key,fallback){try{return JSON.parse(localStorage.getItem(key)||"")??fallback}catch{return fallback}}
function toTime(value){const time=new Date(value||0).getTime();return Number.isFinite(time)?time:0;}
function cloudErrorMessage(error){if(error.status===413)return "이 대화의 이미지가 너무 커서 기기 간 저장 한도를 넘었어요. 채팅은 로컬에 안전하게 남아 있어요.";if(error.status===503)return "배포 서버의 데이터베이스가 아직 연결되지 않았어요. Render의 DATABASE_URL 설정을 확인해 주세요.";return error.message||"기기 간 저장을 완료하지 못했어요.";}
function redactCloudText(value){return value.replace(/AIza[0-9A-Za-z_-]{20,}/g,"[API 키 가림]").replace(/AQ\.[0-9A-Za-z_-]{20,}/g,"[API 키 가림]").replace(/((?:PIN|비밀번호|password)\s*[:=]?\s*)\d{6,12}/gi,"$1[가림]");}
function bytesToBase64(value){const bytes=value instanceof Uint8Array?value:value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value||[]);let binary="";for(let index=0;index<bytes.length;index+=0x8000)binary+=String.fromCharCode(...bytes.subarray(index,index+0x8000));return btoa(binary);}
function base64ToBytes(value){const binary=atob(String(value||""));const bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index+=1)bytes[index]=binary.charCodeAt(index);return bytes;}
function showAlert(text,error=false){ui.alert.textContent=text;ui.alert.className=`alert${error?" error":""}`;}function hideAlert(){ui.alert.classList.add("hidden");}
function autoGrow(){ui.prompt.style.height="auto";ui.prompt.style.height=`${Math.min(ui.prompt.scrollHeight,160)}px`;}
function closePanels(){ui.sidebar.classList.remove("open");ui.inspector.classList.remove("open");}
function readDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});}
function imageSize(src){return new Promise((resolve)=>{const img=new Image();img.onload=()=>resolve({width:img.naturalWidth||512,height:img.naturalHeight||512});img.onerror=()=>resolve({width:512,height:512});img.src=src;});}
function countBlocks(raw){try{return JSON.parse(raw||"[]").flat(Infinity).filter((x)=>x&&typeof x==="object"&&x.type).length}catch{return 0}}
function scriptThreads(raw){try{return JSON.parse(raw||"[]").length}catch{return 0}}
function safeName(value){return String(value||"vibentry-project").replace(/[\\/:*?"<>|]/g,"_").slice(0,80)}
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(SESSION_DB,1);req.onupgradeneeded=()=>req.result.createObjectStore("sessions",{keyPath:"id"});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function dbPut(value){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction("sessions","readwrite");tx.objectStore("sessions").put(structuredClone(value));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function dbGet(id){const db=await openDb();return new Promise((resolve,reject)=>{const req=db.transaction("sessions").objectStore("sessions").get(id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function dbAll(){const db=await openDb();return new Promise((resolve,reject)=>{const req=db.transaction("sessions").objectStore("sessions").getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);});}
