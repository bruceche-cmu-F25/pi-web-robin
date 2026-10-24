import { parseDelimitedRecords } from "@/lib/delimited-table";

export interface ToolOutput { blob: Blob; name: string; text?: string }
export function textOutput(text: string, name = "result.txt", type = "text/plain;charset=utf-8"): ToolOutput {
  return { blob: new Blob([text], { type }), name, text };
}
export function safeFilename(name: string): string {
  const cleaned = name.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_").replace(/[. ]+$/, "").slice(0, 180);
  if (!cleaned || cleaned === "." || cleaned === "..") throw new Error("Empty or unsafe filename");
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned) ? `_${cleaned}` : cleaned;
}
export function renamedFiles(names: string[], pattern: string, find: string, replacement: string, date: string): string[] {
  if (!pattern.trim() || pattern.length > 150) throw new Error("A filename pattern is required (up to 150 characters)");
  const result = names.map((file, i) => {
    const dot = file.lastIndexOf("."), base = dot > 0 ? file.slice(0, dot) : file, extension = dot > 0 ? file.slice(dot) : "";
    const name = find ? base.split(find).join(replacement) : base;
    if (extension.length > 30) throw new Error("File extension is too long");
    const stem = safeFilename(pattern.replace(/\{(name|n|date)\}/g, (_, key: string) => ({ name, n: String(i + 1).padStart(3, "0"), date })[key]!));
    return safeFilename(stem.slice(0, 180 - extension.length) + extension);
  });
  if (new Set(result.map((name) => name.toLowerCase())).size !== result.length) throw new Error("Names collide. Include {n} in the pattern.");
  return result;
}
export async function zipFiles(entries: { name: string; data: Uint8Array }[]): Promise<ToolOutput> {
  if (entries.length > 200 || entries.reduce((n, e) => n + e.data.byteLength, 0) > 100 * 1024 * 1024) throw new Error("ZIP is limited to 200 files / 100 MB");
  const { zipSync } = await import("fflate");
  const names = entries.map((e) => safeFilename(e.name));
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw new Error("Duplicate filenames");
  const files = Object.fromEntries(entries.map((entry, i) => [names[i], entry.data]));
  return { blob: new Blob([new Uint8Array(zipSync(files, { level: 0 }))], { type: "application/zip" }), name: "results.zip" };
}
export function pageNumbers(spec: string, count: number): number[] {
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error("PDF must have 1–1000 pages");
  if (!spec.trim()) return Array.from({ length: count }, (_, i) => i);
  if (spec.length > 5000) throw new Error("Page selection too long");
  const pages: number[] = [];
  for (const token of spec.split(",")) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(token);
    if (!match) throw new Error("Use page numbers/ranges, e.g. 3,1,5-8");
    const from = Number(match[1]), to = Number(match[2] ?? match[1]);
    if (from < 1 || to < 1 || from > count || to > count) throw new Error("Page number is outside the PDF");
    for (let n = from; from <= to ? n <= to : n >= to; n += from <= to ? 1 : -1) {
      pages.push(n - 1);
      if (pages.length > 1000) throw new Error("Select at most 1000 pages");
    }
  }
  return pages;
}
export async function editPdf(files: File[], operation: string, selection: string, rotation: number): Promise<ToolOutput> {
  if (!files.length || files.length > 30 || files.reduce((n, f) => n + f.size, 0) > 50 * 1024 * 1024) throw new Error("PDF: 1–30 files, 50 MB total maximum");
  if (!["merge", "extract", "split", "rotate"].includes(operation) || ![0, 90, 180, 270].includes(rotation)) throw new Error("Invalid PDF operation");
  if (operation !== "merge" && files.length !== 1) throw new Error("Choose one PDF for page operations");
  const { PDFDocument, degrees } = await import("pdf-lib");
  const output = await PDFDocument.create();
  const split: { name: string; data: Uint8Array }[] = [];
  for (const file of files) {
    const source = await PDFDocument.load(await file.arrayBuffer()); // Never ignore encryption.
    const indexes = pageNumbers(operation === "merge" ? "" : selection, source.getPageCount());
    if (output.getPageCount() + indexes.length > 1000 || (operation === "split" && indexes.length > 200)) throw new Error("Too many output pages (split: max 200)");
    if (operation === "split") {
      for (const [i, index] of indexes.entries()) {
        const one = await PDFDocument.create();
        const [page] = await one.copyPages(source, [index]); one.addPage(page);
        split.push({ name: `${String(i + 1).padStart(3, "0")}-page-${index + 1}.pdf`, data: await one.save() });
      }
    } else {
      // Rotation retains unselected pages. Extraction deliberately preserves the requested order.
      const all = operation === "rotate" ? pageNumbers("", source.getPageCount()) : indexes;
      const selected = new Set(indexes);
      const pages = await output.copyPages(source, all);
      for (const [i, page] of pages.entries()) {
        if (operation === "rotate" && selected.has(i)) page.setRotation(degrees((page.getRotation().angle + rotation) % 360));
        output.addPage(page);
      }
    }
  }
  if (operation === "split") return zipFiles(split);
  return { blob: new Blob([new Uint8Array(await output.save())], { type: "application/pdf" }), name: "result.pdf" };
}
export async function imageCanvas(file: Blob): Promise<HTMLCanvasElement> {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("Image limit: 20 MB");
  const url = URL.createObjectURL(file), image = new Image();
  try {
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Unsupported image. Use PNG, JPEG or WebP.")); image.src = url; });
    if (!image.naturalWidth || image.naturalWidth > 8192 || image.naturalHeight > 8192 || image.naturalWidth * image.naturalHeight > 24_000_000) throw new Error("Image limit: 24 megapixels, 8192px per side");
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas unavailable");
    context.drawImage(image, 0, 0); return canvas;
  } finally { URL.revokeObjectURL(url); image.src = ""; }
}
export async function canvasBlob(canvas: HTMLCanvasElement, type: string, quality = .82): Promise<Blob> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("Image encoding failed")), type, quality));
  if (blob.type !== type) throw new Error("Your browser does not support that output format");
  return blob;
}
export async function convertImage(file: File, format: string, edge: number, quality: number, crop: string): Promise<ToolOutput> {
  if (!["jpeg", "png", "webp"].includes(format) || !Number.isInteger(edge) || edge < 64 || edge > 4096 || !Number.isFinite(quality) || quality < .1 || quality > 1 || !["none", "square", "wide"].includes(crop)) throw new Error("Invalid image settings");
  const source = await imageCanvas(file);
  try {
    let w = source.width, h = source.height;
    const ratio = crop === "square" ? 1 : crop === "wide" ? 16 / 9 : w / h;
    if (w / h > ratio) w = h * ratio; else h = w / ratio;
    const scale = Math.min(1, edge / Math.max(w, h));
    const output = document.createElement("canvas"); output.width = Math.max(1, Math.round(w * scale)); output.height = Math.max(1, Math.round(h * scale));
    const ctx = output.getContext("2d")!;
    if (format === "jpeg") { ctx.fillStyle = "white"; ctx.fillRect(0, 0, output.width, output.height); }
    ctx.drawImage(source, (source.width - w) / 2, (source.height - h) / 2, w, h, 0, 0, output.width, output.height);
    return { blob: await canvasBlob(output, `image/${format}`, quality), name: `${safeFilename(file.name.replace(/\.[^.]+$/, ""))}.${format === "jpeg" ? "jpg" : format}` };
  } finally { source.width = source.height = 1; }
}
export function cleanText(input: string, operation: string): string {
  if (input.length > 2_000_000) throw new Error("Text limit: 2 million characters");
  const text = input.replace(/\r\n?/g, "\n");
  switch (operation) {
    case "dedupe": return [...new Set(text.split("\n"))].join("\n");
    case "blank": return text.split("\n").filter((line) => line.trim()).join("\n");
    case "trim": return text.split("\n").map((line) => line.trim()).join("\n");
    case "unwrap": return text.replace(/([^\n])\n(?=[^\n])/g, "$1 ");
    case "spacing": return text.replace(/([\u3400-\u9fff])([A-Za-z0-9])/g, "$1 $2").replace(/([A-Za-z0-9])([\u3400-\u9fff])/g, "$1 $2");
    default: throw new Error("Unknown text operation");
  }
}
export async function developerTool(input: string, operation: string, compare = ""): Promise<string> {
  if (input.length > 2_000_000 || compare.length > 2_000_000) throw new Error("Text limit: 2 million characters");
  switch (operation) {
    case "json": return JSON.stringify(JSON.parse(input), null, 2);
    case "minify": return JSON.stringify(JSON.parse(input));
    case "url-encode": return encodeURIComponent(input);
    case "url-decode": return decodeURIComponent(input);
    case "base64-encode": {
      const bytes = new TextEncoder().encode(input); let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(binary);
    }
    case "base64-decode": return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(input.trim()), (c) => c.charCodeAt(0)));
    case "seconds": case "milliseconds": {
      if (!/^-?\d+$/.test(input.trim())) throw new Error("Enter an integer timestamp");
      const value = Number(input.trim()); if (!Number.isSafeInteger(value)) throw new Error("Timestamp out of range");
      return new Date(value * (operation === "seconds" ? 1000 : 1)).toISOString();
    }
    case "iso": {
      if (!/(Z|[+-]\d\d:\d\d)$/i.test(input.trim())) throw new Error("Include an explicit timezone, e.g. 2026-01-01T12:00:00Z");
      const time = Date.parse(input); if (!Number.isFinite(time)) throw new Error("Invalid ISO date");
      return JSON.stringify({ seconds: Math.floor(time / 1000), milliseconds: time }, null, 2);
    }
    case "diff": {
      const { diffLines } = await import("diff");
      const parts = diffLines(input, compare, { timeout: 1000, maxEditLength: 10000 });
      if (!parts) throw new Error("Diff too large; compare smaller text blocks");
      return parts.map((part) => part.value.split("\n").slice(0, part.value.endsWith("\n") ? -1 : undefined).map((line) => `${part.added ? "+" : part.removed ? "-" : " "} ${line}`).join("\n")).join("\n");
    }
    default: throw new Error("Unknown developer operation");
  }
}
export function tableConvert(text: string, from: string, to: string, columns: string, dedupe: boolean, spreadsheetSafe: boolean): { text: string; rows: string[][] } {
  if (text.length > 2_000_000) throw new Error("Table limit: 2 million characters");
  if (!["csv", "tsv", "json"].includes(from) || !["csv", "tsv", "json"].includes(to)) throw new Error("Unsupported table format");
  let rows: string[][];
  if (from === "json") {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value) || !value.length || value.length > 10000 || value.some((r) => !r || typeof r !== "object" || Array.isArray(r))) throw new Error("JSON must be an array of 1–10000 objects");
    const objects = value as Record<string, unknown>[], keys = [...new Set(objects.flatMap(Object.keys))];
    rows = [keys, ...objects.map((r) => keys.map((key) => { const cell = r[key]; if (cell !== null && typeof cell === "object") throw new Error("Nested JSON values are not supported"); return cell == null ? "" : String(cell); }))];
  } else rows = parseDelimitedRecords(text, from === "tsv" ? "\t" : ",", { maxRecords: 10002 }).records;
  if (!rows.length || rows.length > 10001 || rows.some((r) => r.length > 200)) throw new Error("Table limit: 10000 data rows, 200 columns");
  if (rows.some((r) => r.length !== rows[0].length)) throw new Error("Rows have different column counts; fix the input before converting");
  if (columns.trim()) { const indexes = pageNumbers(columns, rows[0].length); rows = rows.map((row) => indexes.map((i) => row[i])); }
  if (dedupe) { const seen = new Set<string>(); rows = [rows[0], ...rows.slice(1).filter((r) => { const key = JSON.stringify(r); if (seen.has(key)) return false; seen.add(key); return true; })]; }
  let output: string;
  if (to === "json") {
    if (rows[0].some((h) => !h) || new Set(rows[0]).size !== rows[0].length) throw new Error("JSON output needs unique, non-empty column headers");
    output = JSON.stringify(rows.slice(1).map((row) => Object.fromEntries(rows[0].map((key, i) => [key, row[i]]))), null, 2);
  } else {
    const separator = to === "tsv" ? "\t" : ",";
    output = rows.map((row) => row.map((cell) => {
      const value = spreadsheetSafe && /^[\s]*[=+@-]/.test(cell) ? `'${cell}` : cell;
      return value.includes(separator) || /["\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    }).join(separator)).join("\r\n");
  }
  return { text: output, rows };
}
export function wifiPayload(ssid: string, password: string): string {
  const escape = (v: string) => v.replace(/[\\;,:"']/g, "\\$&");
  if (!ssid) throw new Error("Wi-Fi name is required");
  return `WIFI:T:${password ? "WPA" : "nopass"};S:${escape(ssid)};P:${escape(password)};;`;
}
export async function generateQr(text: string): Promise<ToolOutput> {
  if (!text || new TextEncoder().encode(text).length > 1500) throw new Error("QR content must be 1–1500 UTF-8 bytes");
  const QRCode = await import("qrcode");
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, text, { width: 400, margin: 4, errorCorrectionLevel: "M" });
  return { blob: await canvasBlob(canvas, "image/png"), name: "qrcode.png" };
}
export async function readQr(file: File): Promise<string> {
  const canvas = await imageCanvas(file);
  try {
    const { default: jsQR } = await import("jsqr");
    const image = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(image.data, image.width, image.height);
    if (!result) throw new Error("No QR code found; try a clearer, cropped image");
    return result.data; // Text only: never navigate, execute or fetch a decoded URL.
  } finally { canvas.width = canvas.height = 1; }
}
