import { ENTRY_SAFE_BLOCK_TYPES, collectArchiveAssetNames, repairEntryProject } from "./entry-safety.js";
import { buildEntBlob, readEntArchive } from "./entry-archive.js";

const $ = (selector) => document.querySelector(selector);
const ui = {
  apiKey: $("#apiKey"), rememberKey: $("#rememberKey"), prompt: $("#userPrompt"), file: $("#fileInput"),
  thread: $("#chatThread"), history: $("#historyList"), attachments: $("#attachmentList"), alert: $("#alertBox"),
  send: $("#generateBtn"), title: $("#chatTitle"), model: $("#modelStatus"), summary: $("#projectSummary"),
  stage: $("#stagePreview"), objects: $("#objectList"), ent: $("#downloadEntBtn"), json: $("#downloadJsonBtn"),
  sidebar: $("#sidebar"), inspector: $("#inspector"), settings: $("#settingsDialog"),
};
const MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-2.5-pro"];
const IMAGE_MODEL = "gemini-3.1-flash-image";
const SESSION_DB = "vibentry-conversations";
const schema = { type:"object", properties:{
  assistant_message:{type:"string"}, project_name:{type:"string"}, download_name:{type:"string"},
  warnings:{type:"array",items:{type:"string"}}, project_json:{type:"object",additionalProperties:true},
  asset_requests:{type:"array",items:{type:"object",properties:{object_id:{type:"string"},name:{type:"string"},prompt:{type:"string"},source_image_name:{type:"string"}},required:["object_id","name","prompt"]}}
}, required:["assistant_message","project_name","project_json"], additionalProperties:true };

let template;
let session;
let sessions = [];
let files = [];
let busy = false;

init().catch((error) => showAlert(`초기화하지 못했어요: ${error.message}`, true));

async function init() {
  template = await fetch("/api/template").then((response) => response.json()).then((data) => data.project);
  restoreSettings();
  sessions = await dbAll();
  session = sessions.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0] || newSession();
  bindEvents();
  renderAll();
}

function bindEvents() {
  $("#newChatBtn").onclick = async () => { session = newSession(); files=[]; await saveSession(); renderAll(); closePanels(); };
  $("#settingsBtn").onclick = () => ui.settings.showModal();
  $("#saveSettingsBtn").onclick = saveSettings;
  $("#menuBtn").onclick = () => ui.sidebar.classList.toggle("open");
  $("#previewBtn").onclick = () => ui.inspector.classList.toggle("open");
  $("#closePreviewBtn").onclick = () => ui.inspector.classList.remove("open");
  ui.send.onclick = sendMessage;
  ui.file.onchange = (event) => loadFiles([...event.target.files]);
  ui.prompt.addEventListener("input", autoGrow);
  ui.prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); }
  });
  ui.ent.onclick = downloadEnt;
  ui.json.onclick = () => downloadBlob(new Blob([JSON.stringify(session.project,null,2)],{type:"application/json"}), `${safeName(session.project.name)}.json`);
  document.addEventListener("click", (event) => {
    const sample = event.target.closest("[data-sample]");
    if (sample) { ui.prompt.value=sample.dataset.sample; autoGrow(); ui.prompt.focus(); }
  });
}

function newSession() {
  return { id:crypto.randomUUID(), title:"새 Entry 작품", createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), messages:[], project:null, archiveEntries:[], baseProject:null, interactionId:null };
}

async function loadFiles(selected) {
  for (const file of selected) {
    if (file.name.toLowerCase().endsWith(".ent")) {
      const archive = await readEntArchive(file);
      files.push({name:file.name,kind:"ent",project:archive.project,entries:archive.entries});
      session.project = archive.project; session.baseProject = archive.project; session.archiveEntries = archive.entries;
      if (!session.messages.length) addMessage("assistant", `${file.name}을 열었어요. 이제 원하는 수정 내용을 말해 주세요.`);
    } else if (file.type.startsWith("image/")) {
      files.push({name:file.name,kind:"image",dataUrl:await readDataUrl(file),type:file.type,size:file.size});
    } else {
      files.push({name:file.name,kind:"text",text:(await file.text()).slice(0,20000),size:file.size});
    }
  }
  await saveSession(); renderAttachments(); renderProject(); renderMessages();
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
  try {
    const base = session.project || files.find((f)=>f.kind==="ent")?.project || template;
    const result = await callAgent(key, buildAgentPrompt(text,base));
    const sourceEnt = files.find((f)=>f.kind==="ent");
    let candidate = hydrateExistingAssets(result.project_json, base);
    if (result.project_name && candidate) candidate={...candidate,name:result.project_name};
    candidate = await applyAssets(key,candidate,result.asset_requests || []);
    const entries = sourceEnt?.entries || session.archiveEntries || [];
    const safety = repairEntryProject(candidate,base,{availableAssets:collectArchiveAssetNames(entries)});
    if (safety.validation.errors.length) throw new Error(`작품 검사 실패: ${safety.validation.errors[0]}`);
    session.project=safety.project; session.baseProject=base; session.archiveEntries=entries;
    session.interactionId=result.interactionId || session.interactionId;
    session.title=(safety.project.name || result.project_name || text).slice(0,40);
    thinking.text=result.assistant_message || "요청한 내용을 작품에 반영했어요."; thinking.pending=false;
    thinking.files=[`${safeName(result.download_name || session.title)}.ent`];
    const warnings=[...(result.warnings||[]),...safety.warnings];
    if (warnings.length) thinking.text += `\n\n확인할 점: ${warnings.slice(0,3).join(" · ")}`;
    files=[];
    await saveSession(); renderAll();
  } catch(error) {
    thinking.pending=false; thinking.text=friendlyError(error); renderMessages(); showAlert(thinking.text,true);
  } finally { busy=false; ui.send.disabled=false; }
}

function buildAgentPrompt(request,base) {
  const urls=[...request.matchAll(/https?:\/\/[^\s<>"']+/g)].map((m)=>m[0]);
  const references=files.filter((f)=>f.kind!=="ent").map((f)=>f.kind==="text"?`TEXT ${f.name}:\n${f.text}`:`IMAGE ${f.name} (${f.type}, ${f.size} bytes)`).join("\n\n");
  const recent=session.messages.filter((m)=>!m.pending).slice(-10).map((m)=>`${m.role}: ${m.text}`).join("\n");
  return [
    "You are vibentry, a precise conversational agent that creates and edits complete Entry project.json files.",
    "Respond in natural Korean. Continue editing the supplied current project instead of starting over unless asked.",
    "You may add or delete any number of objects. Preserve requested existing behavior and remove only what the user requests.",
    "Every object script is a JSON-stringified 2D array. An event block and following action blocks are sequential elements in one thread; NEVER put event actions in event.statements.",
    "Use statements only for control blocks such as repeat_basic, repeat_inf, _if, if_else, repeat_while_true.",
    "Lists belong in project.variables with variableType='list' and array=[{data:'...'}]. Never put lists in tables.",
    "Variable blocks use variable id in params[0]. List blocks use list id: add/insert/value/change/remove/include params[1], length/show/hide params[0].",
    "For click counters, include when_object_click followed by change_variable, then add_value_to_list or insert_value_to_list with valid nested number/get_variable blocks.",
    "Cloud persistence uses isCloud:true and isRealTime:true only where Entry supports it. Explain sign-in or cloud limitations honestly.",
    "Use unique IDs and consistent scene, selectedPictureId and interface.object references.",
    `Only use verified block types: ${ENTRY_SAFE_BLOCK_TYPES.join(", ")}.`,
    "To create a new image, add an asset_requests item with the target object_id and a detailed visual prompt. Keep a temporary valid existing picture on that object; the app will replace it.",
    "To use an attached image, set source_image_name to its exact IMAGE filename in asset_requests. Do not invent asset URLs.",
    "Return the entire resulting project in project_json, not a patch.",
    urls.length?`The app enabled URL context for these public links: ${urls.join(", ")}`:"No URLs supplied.",
    `RECENT CONVERSATION:\n${recent || "none"}`,
    `ATTACHMENTS:\n${references || "none"}`,
    `USER REQUEST:\n${request}`,
    `CURRENT PROJECT_JSON:\n${JSON.stringify(compactProjectForPrompt(base))}`,
  ].join("\n\n");
}

async function callAgent(key,prompt) {
  let last;
  for (const model of MODELS) {
    try {
      ui.model.textContent=`${model} 작업 중`;
      const body={model,input:[{type:"text",text:prompt}],response_format:{type:"json_schema",json_schema:{name:"entry_project",schema,strict:true}}};
      if (/https?:\/\//.test(prompt)) body.tools=[{type:"url_context"}];
      if (session.interactionId) body.previous_interaction_id=session.interactionId;
      const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify(body)});
      const data=await response.json();
      if (!response.ok) throw apiError(response.status,data);
      const parsed=JSON.parse(extractText(data));
      parsed.interactionId=data.id;
      ui.model.textContent=model;
      return parsed;
    } catch(error) { last=error; if (![404,400].includes(error.status)) break; }
  }
  throw last || new Error("사용 가능한 Gemini 모델을 찾지 못했어요.");
}

async function applyAssets(key,project,requests) {
  if (!project || !Array.isArray(requests)) return project;
  for (const request of requests.slice(0,4)) {
    const object=project.objects?.find((item)=>item.id===request.object_id || item.name===request.object_id);
    if (!object) continue;
    let dataUrl;
    const attached=files.find((file)=>file.kind==="image" && file.name===request.source_image_name);
    if (attached) dataUrl=attached.dataUrl;
    else {
      const response=await fetch("https://generativelanguage.googleapis.com/v1beta/interactions",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({model:IMAGE_MODEL,input:[{type:"text",text:`Create a clean game sprite for Entry. ${request.prompt}. Transparent or simple background, centered subject, no text.`}],response_format:{type:"image",mime_type:"image/png",aspect_ratio:"1:1",image_size:"1K"}})});
      const data=await response.json(); if(!response.ok) throw apiError(response.status,data);
      dataUrl=extractImage(data);
    }
    if (!dataUrl) throw new Error(`${request.name} 이미지를 만들지 못했어요.`);
    const dimension=await imageSize(dataUrl); const id=`img_${crypto.randomUUID().replaceAll("-","").slice(0,10)}`;
    object.sprite={...(object.sprite||{}),pictures:[{id,name:request.name,fileurl:dataUrl,thumbUrl:dataUrl,dimension,imageType:"png"}],sounds:object.sprite?.sounds||[]};
    object.selectedPictureId=id;
  }
  return project;
}

function extractText(data) {
  if (typeof data.output_text==="string") return data.output_text;
  const output=data.outputs || data.output || [];
  for (const item of output) {
    if (typeof item.text==="string") return item.text;
    for (const part of item.content?.parts || item.content || []) if(typeof part.text==="string") return part.text;
  }
  throw new Error("Gemini 응답에서 작품 JSON을 찾지 못했어요.");
}

function extractImage(data) {
  const candidates=[data.output_image,data.image,...(data.outputs||[]),...(data.output||[])];
  for(const item of candidates){const raw=item?.data||item?.image?.data||item?.inline_data?.data||item?.inlineData?.data;if(raw)return `data:${item.mime_type||item.mimeType||"image/png"};base64,${raw}`;}
  return null;
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
function renderAll(){renderHistory();renderMessages();renderAttachments();renderProject();ui.title.textContent=session.title;}
function renderMessages(){
  const welcome=ui.thread.firstElementChild?.outerHTML || "";
  ui.thread.innerHTML=(session.messages.length?"":welcome)+session.messages.map((m)=>`<article class="message ${m.role}">${m.role==="assistant"?'<div class="avatar">v</div>':""}<div class="bubble">${m.pending?'<strong>생각하는 중</strong> ':""}${escapeHtml(m.text)}${m.files?.length?`<span class="meta">파일 준비됨: ${escapeHtml(m.files.join(", "))}</span>`:""}</div></article>`).join("");
  ui.thread.scrollTop=ui.thread.scrollHeight;
}
function renderHistory(){ui.history.innerHTML=sessions.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map((s)=>`<button class="history-item ${s.id===session.id?"active":""}" data-id="${s.id}">${escapeHtml(s.title)}</button>`).join("")||'<span class="rail-label">아직 대화가 없어요.</span>';ui.history.querySelectorAll("button").forEach((button)=>button.onclick=async()=>{const found=await dbGet(button.dataset.id);if(found){session=found;files=[];renderAll();closePanels();}});}
function renderAttachments(){ui.attachments.innerHTML=files.map((f)=>`<span class="attachment">${escapeHtml(f.name)}</span>`).join("");}
function renderProject(){const p=session.project;ui.ent.disabled=ui.json.disabled=!p;if(!p){ui.summary.textContent="아직 작품이 없어요.";ui.objects.innerHTML="";return;}const blocks=(p.objects||[]).reduce((sum,o)=>sum+countBlocks(o.script),0);ui.summary.innerHTML=`<strong>${escapeHtml(p.name||"Entry 작품")}</strong><br>오브젝트 ${(p.objects||[]).length}개 · 변수 ${(p.variables||[]).length}개 · 블록 ${blocks}개`;ui.stage.innerHTML=(p.objects||[]).map((o,i)=>{const pic=o.sprite?.pictures?.find((x)=>x.id===o.selectedPictureId)||o.sprite?.pictures?.[0];const left=50+(Number(o.entity?.x)||0)/10;const top=50-(Number(o.entity?.y)||0)/7.5;return `<div class="stage-object" style="left:${clamp(left,5,95)}%;top:${clamp(top,5,95)}%">${pic?`<img src="${escapeHtml(pic.fileurl)}" alt="">`:""}<span>${escapeHtml(o.name)}</span></div>`}).join("")||"<span>오브젝트 없음</span>";ui.objects.innerHTML=(p.objects||[]).map((o)=>{const pic=o.sprite?.pictures?.[0];return `<div class="object-card">${pic?`<img src="${escapeHtml(pic.fileurl)}" alt="">`:""}<div><strong>${escapeHtml(o.name)}</strong><br><small>코드 묶음 ${scriptThreads(o.script)}개</small></div></div>`}).join("");}

async function saveSession(){session.updatedAt=new Date().toISOString();await dbPut(session);sessions=await dbAll();}
async function downloadEnt(){if(!session.project)return;const safety=repairEntryProject(session.project,session.baseProject||template,{availableAssets:collectArchiveAssetNames(session.archiveEntries)});if(safety.validation.errors.length)return showAlert(`파일 검사 실패: ${safety.validation.errors[0]}`,true);const blob=await buildEntBlob(safety.project,session.archiveEntries);downloadBlob(blob,`${safeName(safety.project.name)}.ent`);}
function downloadBlob(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function saveSettings(){localStorage.setItem("vibentry:remember",String(ui.rememberKey.checked));if(ui.rememberKey.checked)localStorage.setItem("vibentry:key",ui.apiKey.value);else localStorage.removeItem("vibentry:key");}
function restoreSettings(){ui.rememberKey.checked=localStorage.getItem("vibentry:remember")==="true";if(ui.rememberKey.checked)ui.apiKey.value=localStorage.getItem("vibentry:key")||"";}
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
