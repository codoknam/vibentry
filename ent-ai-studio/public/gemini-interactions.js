function asItems(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function flattenInteractionContent(value) {
  const queue = [...asItems(value)];
  const flattened = [];

  while (queue.length) {
    const item = queue.shift();
    if (item == null) continue;
    flattened.push(item);

    if (typeof item !== "object") continue;
    queue.push(...asItems(item.content));
    queue.push(...asItems(item.parts));
  }

  return flattened;
}

export function extractInteractionText(data = {}) {
  for (const direct of [data.output_text, data.outputText]) {
    if (typeof direct === "string" && direct.length) return direct;
  }

  const candidates = [
    ...asItems(data.steps),
    ...asItems(data.outputs),
    ...asItems(data.output),
  ];

  for (const item of flattenInteractionContent(candidates)) {
    if (typeof item === "string" && item.length) return item;
    for (const text of [item?.text, item?.output_text, item?.outputText]) {
      if (typeof text === "string" && text.length) return text;
    }
  }

  throw new Error("Gemini 응답에서 작품 JSON을 찾지 못했어요.");
}

export function extractInteractionImage(data = {}) {
  const candidates = [
    data.output_image,
    data.outputImage,
    data.image,
    ...asItems(data.steps),
    ...asItems(data.outputs),
    ...asItems(data.output),
  ];

  for (const part of flattenInteractionContent(candidates)) {
    if (typeof part === "string" && part.startsWith("data:image/")) return part;
    if (!part || typeof part !== "object") continue;

    const raw = part.data
      || part.image?.data
      || part.inline_data?.data
      || part.inlineData?.data;
    if (!raw) continue;

    const mimeType = part.mime_type
      || part.mimeType
      || part.image?.mime_type
      || part.image?.mimeType
      || part.inline_data?.mime_type
      || part.inlineData?.mimeType
      || "image/jpeg";
    return `data:${mimeType};base64,${raw}`;
  }

  return null;
}

export function extractInteractionCitations(data = {}) {
  const candidates = [
    ...asItems(data.steps),
    ...asItems(data.outputs),
    ...asItems(data.output),
  ];
  const citations = new Map();

  for (const item of flattenInteractionContent(candidates)) {
    for (const annotation of asItems(item?.annotations)) {
      if (annotation?.type !== "url_citation" || typeof annotation.url !== "string") continue;
      if (citations.has(annotation.url)) continue;
      citations.set(annotation.url, {
        url: annotation.url,
        title: typeof annotation.title === "string" && annotation.title.trim()
          ? annotation.title.trim().slice(0, 180)
          : annotation.url,
      });
    }
  }
  return [...citations.values()];
}
