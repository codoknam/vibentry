const MIME_EXTENSIONS = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
});

export function embedImageAsset(project, sourceEntries, {
  objectId,
  name = "AI 생성 이미지",
  dataUrl,
  dimension = { width: 512, height: 512 },
} = {}) {
  if (!project || !Array.isArray(project.objects)) throw new Error("이미지를 넣을 Entry 작품이 없어요.");
  const object = project.objects.find((item) => item.id === objectId || item.name === objectId);
  if (!object) throw new Error(`${objectId || "대상"} 오브젝트를 찾지 못했어요.`);

  const decoded = decodeImageDataUrl(dataUrl);
  const fileId = crypto.randomUUID().replaceAll("-", "");
  const pictureId = `pic_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const prefixA = fileId.slice(0, 2);
  const prefixB = fileId.slice(2, 4);
  const imagePath = `${prefixA}/${prefixB}/image/${fileId}.${decoded.extension}`;
  const thumbPath = `${prefixA}/${prefixB}/thumb/${fileId}.${decoded.extension}`;

  const width = positiveDimension(dimension?.width, 512);
  const height = positiveDimension(dimension?.height, 512);
  const oldWidth = positiveDimension(object.entity?.width, object.sprite?.pictures?.[0]?.dimension?.width || 100);
  const oldHeight = positiveDimension(object.entity?.height, object.sprite?.pictures?.[0]?.dimension?.height || 100);
  const oldScale = Math.max(Math.abs(Number(object.entity?.scaleX) || 1), Math.abs(Number(object.entity?.scaleY) || 1));
  const displayedSize = Math.max(32, Math.min(220, Math.max(oldWidth, oldHeight) * oldScale));
  const nextScale = displayedSize / Math.max(width, height);
  object.sprite = {
    ...(object.sprite || {}),
    pictures: [{
      id: pictureId,
      name: String(name || "AI 생성 이미지").slice(0, 120),
      fileurl: imagePath,
      thumbUrl: thumbPath,
      dimension: { width, height },
      imageType: decoded.extension,
    }],
    sounds: object.sprite?.sounds || [],
  };
  object.selectedPictureId = pictureId;
  object.entity = {
    ...(object.entity || {}),
    width,
    height,
    regX: width / 2,
    regY: height / 2,
    scaleX: nextScale,
    scaleY: nextScale,
  };

  const entries = mergeArchiveEntries(sourceEntries, [
    directoryEntry(`temp/${prefixA}/`),
    directoryEntry(`temp/${prefixA}/${prefixB}/`),
    directoryEntry(`temp/${prefixA}/${prefixB}/image/`),
    directoryEntry(`temp/${prefixA}/${prefixB}/thumb/`),
    fileEntry(`temp/${imagePath}`, decoded.bytes),
    fileEntry(`temp/${thumbPath}`, decoded.bytes),
  ]);

  return {
    project,
    entries,
    picture: object.sprite.pictures[0],
    archivePaths: [`temp/${imagePath}`, `temp/${thumbPath}`],
  };
}

export function decodeImageDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) throw new Error("생성된 이미지 데이터 형식이 올바르지 않아요.");
  const mimeType = match[1].toLowerCase();
  const extension = MIME_EXTENSIONS[mimeType];
  if (!extension) throw new Error(`${mimeType} 이미지는 Entry 자산으로 넣을 수 없어요.`);
  const binary = atob(match[2].replace(/\s+/g, ""));
  if (!binary.length || binary.length > 8 * 1024 * 1024) throw new Error("이미지 크기가 비어 있거나 8MB를 넘었어요.");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { mimeType, extension, bytes };
}

export function mergeArchiveEntries(sourceEntries = [], addedEntries = []) {
  const merged = new Map();
  for (const entry of [...sourceEntries, ...addedEntries]) {
    if (!entry || typeof entry.name !== "string") continue;
    merged.set(entry.name.replace(/\\/g, "/"), entry);
  }
  return [...merged.values()];
}

function directoryEntry(name) {
  return { name, data: new Uint8Array(0), typeFlag: "5", mode: 0o755 };
}

function fileEntry(name, data) {
  return { name, data, typeFlag: "0", mode: 0o644 };
}

function positiveDimension(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
