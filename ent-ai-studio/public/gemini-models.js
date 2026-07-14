export const PREFERRED_GEMINI_MODELS = Object.freeze([
  "gemini-3.5-flash",
  "gemini-3.1-pro-preview",
  "gemini-2.5-pro",
  "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite",
]);

const SPECIALIZED_MODEL = /(?:^|[-_.])(image|imagen|veo|tts|live|audio|embedding|embed|robotics|computer-use|deep-research|omni|lyria|aqa)(?:$|[-_.])/i;

export function selectGeminiTextModels(payload, limit = 8) {
  const records = Array.isArray(payload?.models) ? payload.models : [];
  const candidates = records
    .map((record) => ({ record, id: modelId(record) }))
    .filter(({ record, id }) => isTextGenerationModel(record, id));
  const available = new Set(candidates.map(({ id }) => id));
  const ranked = candidates
    .sort((left, right) => modelScore(right.record, right.id) - modelScore(left.record, left.id))
    .map(({ id }) => id);
  const preferredAvailable = PREFERRED_GEMINI_MODELS.filter((id) => available.has(id));
  return [...new Set([...preferredAvailable, ...ranked, ...PREFERRED_GEMINI_MODELS])].slice(0, limit);
}

function modelId(record) {
  return String(record?.baseModelId || record?.name || "").replace(/^models\//, "");
}

function isTextGenerationModel(record, id) {
  if (!/^gemini-/i.test(id) || SPECIALIZED_MODEL.test(id)) return false;
  const methods = record?.supportedGenerationMethods || record?.supportedActions || [];
  return !methods.length || methods.includes("generateContent");
}

function modelScore(record, id) {
  const preferredIndex = PREFERRED_GEMINI_MODELS.indexOf(id);
  if (preferredIndex >= 0) return 100_000 - preferredIndex;
  let score = 0;
  if (/3\.5/.test(id)) score += 800;
  else if (/3\.1/.test(id)) score += 700;
  else if (/gemini-3/.test(id)) score += 600;
  else if (/2\.5/.test(id)) score += 500;
  if (/-pro(?:-|$)/.test(id)) score += 180;
  if (/-flash(?:-|$)/.test(id)) score += 80;
  if (/-latest$/.test(id)) score += 40;
  if (record?.thinking === true) score += 100;
  if (/-lite(?:-|$)/.test(id)) score -= 160;
  if (/-preview(?:-|$)/.test(id)) score -= 30;
  if (/(?:^|-)exp(?:erimental)?(?:-|$)/.test(id)) score -= 300;
  score += Math.min(100, Number(record?.outputTokenLimit || 0) / 1000);
  return score;
}
