import assert from "node:assert/strict";
import { PREFERRED_GEMINI_MODELS, selectGeminiTextModels } from "../public/gemini-models.js";

const selected = selectGeminiTextModels({
  models: [
    { name: "models/gemini-3.1-flash-image", supportedGenerationMethods: ["generateContent"], thinking: true },
    { name: "models/gemini-3.1-flash-live", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-embedding-2", supportedGenerationMethods: ["embedContent"] },
    { name: "models/gemini-2.5-flash", baseModelId: "gemini-2.5-flash", supportedGenerationMethods: ["generateContent"], thinking: true },
    { name: "models/gemini-3.1-pro-preview", baseModelId: "gemini-3.1-pro-preview", supportedGenerationMethods: ["generateContent"], thinking: true },
    { name: "models/gemini-3.5-flash", baseModelId: "gemini-3.5-flash", supportedGenerationMethods: ["generateContent"], thinking: true },
    { name: "models/gemini-3.5-flash-001", supportedGenerationMethods: ["generateContent"], thinking: true, outputTokenLimit: 65536 },
  ],
});

assert.deepEqual(selected.slice(0, 3), ["gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-2.5-flash"]);
assert.ok(selected.includes("gemini-3.5-flash-001"));
assert.ok(!selected.some((id) => /image|live|embedding/.test(id)));
assert.deepEqual(selectGeminiTextModels(null, 2), PREFERRED_GEMINI_MODELS.slice(0, 2));

console.log(`gemini models ok: ${selected.length} quality-ranked text candidates`);
