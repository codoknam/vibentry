const PROJECT_PATH = "temp/project.json";

export async function readEntArchive(file) {
  if (!("DecompressionStream" in globalThis)) {
    throw new Error("이 환경은 gzip 압축 해제를 지원하지 않아요.");
  }

  const compressed = await file.arrayBuffer();
  const tarBuffer = await gunzipBuffer(compressed);
  const entries = parseTar(tarBuffer);
  const jsonEntry = entries.find((entry) => entry.name === PROJECT_PATH);
  if (!jsonEntry) {
    throw new Error(".ent 안에서 temp/project.json을 찾지 못했어요.");
  }

  const raw = new TextDecoder().decode(jsonEntry.data);
  let project;
  try {
    project = JSON.parse(raw);
  } catch {
    throw new Error("temp/project.json이 올바른 JSON이 아니에요.");
  }
  return { project, entries };
}

export async function buildEntBlob(project, sourceEntries = []) {
  if (!("CompressionStream" in globalThis)) {
    throw new Error("이 환경은 gzip 압축을 지원하지 않아요.");
  }

  const encoder = new TextEncoder();
  const preserved = [];
  const seen = new Set(["temp/", PROJECT_PATH]);
  for (const entry of sourceEntries) {
    if (!entry || typeof entry.name !== "string") {
      continue;
    }
    const name = normalizeTarPath(entry.name, entry.typeFlag === "5");
    if (!name || seen.has(name) || name === PROJECT_PATH) {
      continue;
    }
    seen.add(name);
    preserved.push({
      name,
      data: toUint8Array(entry.data),
      typeFlag: entry.typeFlag === "5" ? "5" : "0",
      mode: Number.isInteger(entry.mode) ? entry.mode : entry.typeFlag === "5" ? 0o755 : 0o644,
    });
  }

  const files = [
    { name: "temp/", data: new Uint8Array(0), typeFlag: "5", mode: 0o755 },
    {
      name: PROJECT_PATH,
      data: encoder.encode(JSON.stringify(project)),
      typeFlag: "0",
      mode: 0o644,
    },
    ...preserved,
  ];

  const tarParts = [];
  for (const file of files) {
    const header = createTarHeader(file.name, file.data.length, file.typeFlag, file.mode);
    tarParts.push(header);
    if (file.data.length) {
      tarParts.push(file.data);
      tarParts.push(new Uint8Array((512 - (file.data.length % 512)) % 512));
    }
  }
  tarParts.push(new Uint8Array(1024));

  const tarBlob = new Blob(tarParts, { type: "application/octet-stream" });
  const gzipStream = tarBlob.stream().pipeThrough(new CompressionStream("gzip"));
  return new Blob([await new Response(gzipStream).arrayBuffer()], { type: "application/gzip" });
}

export function parseTar(buffer) {
  const bytes = new Uint8Array(buffer);
  const entries = [];
  let offset = 0;

  while (offset + 512 <= bytes.length) {
    const header = bytes.slice(offset, offset + 512);
    if (header.every((value) => value === 0)) {
      break;
    }

    verifyTarChecksum(header);
    const shortName = readTarString(header.slice(0, 100));
    const prefix = readTarString(header.slice(345, 500));
    const name = prefix ? `${prefix}/${shortName}` : shortName;
    const size = readTarOctal(header.slice(124, 136));
    const mode = readTarOctal(header.slice(100, 108));
    const typeFlag = header[156] ? String.fromCharCode(header[156]) : "0";
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) {
      throw new Error(`.ent 안의 ${name || "이름 없는 파일"} 크기 정보가 잘못됐어요.`);
    }

    entries.push({
      name,
      data: bytes.slice(dataStart, dataEnd),
      typeFlag: typeFlag === "\0" ? "0" : typeFlag,
      mode,
    });

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  return entries;
}

async function gunzipBuffer(buffer) {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

function createTarHeader(name, size, typeFlag, mode) {
  const header = new Uint8Array(512);
  const { shortName, prefix } = splitTarName(name);
  writeTarString(header, 0, 100, shortName);
  writeTarOctal(header, 100, 8, mode);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, size);
  writeTarOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  header.fill(32, 148, 156);
  header[156] = typeFlag.charCodeAt(0);
  writeTarString(header, 257, 6, "ustar");
  writeTarString(header, 263, 2, "00");
  if (prefix) {
    writeTarString(header, 345, 155, prefix);
  }

  let checksum = 0;
  for (const value of header) {
    checksum += value;
  }
  const checksumText = checksum.toString(8).padStart(6, "0");
  writeTarString(header, 148, 8, `${checksumText}\0 `);
  return header;
}

function splitTarName(name) {
  const encoder = new TextEncoder();
  if (encoder.encode(name).length <= 100) {
    return { shortName: name, prefix: "" };
  }
  const separators = [...name.matchAll(/\//g)].map((match) => match.index);
  for (let index = separators.length - 1; index >= 0; index -= 1) {
    const position = separators[index];
    const prefix = name.slice(0, position);
    const shortName = name.slice(position + 1);
    if (encoder.encode(prefix).length <= 155 && encoder.encode(shortName).length <= 100) {
      return { shortName, prefix };
    }
  }
  throw new Error(`.ent 내부 파일 이름이 너무 길어요: ${name}`);
}

function normalizeTarPath(value, isDirectory) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || normalized.startsWith("/") || parts.includes("..") || /^[A-Za-z]:/.test(normalized)) {
    return "";
  }
  const path = parts.join("/");
  return isDirectory ? `${path}/` : path;
}

function verifyTarChecksum(header) {
  const stored = readTarOctal(header.slice(148, 156));
  if (!stored) {
    return;
  }
  const copy = header.slice();
  copy.fill(32, 148, 156);
  let actual = 0;
  for (const value of copy) {
    actual += value;
  }
  if (stored !== actual) {
    throw new Error(".ent 압축의 TAR 체크섬이 맞지 않아요.");
  }
}

function readTarString(slice) {
  return new TextDecoder().decode(slice).replace(/\0.*$/, "");
}

function readTarOctal(slice) {
  const text = readTarString(slice).trim().replace(/\s+$/, "");
  if (!text) {
    return 0;
  }
  const parsed = Number.parseInt(text, 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

function writeTarString(buffer, start, length, value) {
  const encoded = new TextEncoder().encode(value);
  if (encoded.length > length) {
    throw new Error(`TAR 필드 길이를 넘었어요: ${value}`);
  }
  buffer.set(encoded, start);
}

function writeTarOctal(buffer, start, length, value) {
  const text = Math.max(0, Number(value) || 0).toString(8).padStart(length - 1, "0");
  writeTarString(buffer, start, length, text);
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    return new Uint8Array(value);
  }
  return new Uint8Array(0);
}
