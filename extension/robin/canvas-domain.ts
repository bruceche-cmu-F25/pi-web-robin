import { randomUUID } from "node:crypto";
import { readdirSync, rmSync } from "node:fs";
import { dataPath, readJsonObject, updateJsonObject, withFileLock, writeJsonObject } from "./paths.ts";
import { MAX_CANVAS_BYTES, type CanvasAssetLibrary, type CanvasContent, type CanvasDocument, type CanvasScene, type CanvasSummary } from "./canvas.ts";

export class CanvasError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
const TYPES = new Set(["rectangle", "diamond", "ellipse", "text", "arrow", "line", "freedraw", "image", "frame"]);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 10_000_000;

function filename(id: unknown): string {
  if (typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new CanvasError("Invalid canvas id");
  return `canvases/${id}.json`;
}
function title(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new CanvasError("Canvas title must contain 1–200 characters");
  return value.trim();
}
function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new CanvasError("Invalid canvas revision");
  return value;
}

function scene(value: unknown): CanvasScene {
  if (!object(value) || !Array.isArray(value.elements) || value.elements.length > 10_000 || !object(value.files) || !object(value.appState)) throw new CanvasError("Invalid canvas scene");
  const ids = new Set<string>();
  for (const element of value.elements) {
    if (!object(element) || typeof element.id !== "string" || !element.id || element.id.length > 100 || ids.has(element.id) || !TYPES.has(String(element.type))
      || ![element.x, element.y, element.width, element.height].every(finite) || Number(element.width) < 0 || Number(element.height) < 0) throw new CanvasError("Invalid canvas element");
    ids.add(element.id);
    if (element.type === "text" && (typeof element.text !== "string" || element.text.length > 100_000)) throw new CanvasError("Invalid canvas text");
    if (element.points !== undefined && (!Array.isArray(element.points) || element.points.length > 100_000 || !element.points.every((p) => Array.isArray(p) && p.length === 2 && p.every(finite)))) throw new CanvasError("Invalid canvas points");
    if (element.link && (typeof element.link !== "string" || !/^(https?:\/\/|mailto:|#)/i.test(element.link))) throw new CanvasError("Unsupported canvas link");
  }
  const files = Object.entries(value.files);
  if (files.length > 200) throw new CanvasError("A canvas can contain at most 200 image files");
  for (const [id, file] of files) {
    if (!object(file) || file.id !== id || typeof file.dataURL !== "string" || typeof file.mimeType !== "string"
      || !/^image\/(png|jpeg|webp|gif|avif)$/.test(file.mimeType)
      || !file.dataURL.startsWith(`data:${file.mimeType};base64,`)
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.dataURL.slice(file.dataURL.indexOf(",") + 1))) throw new CanvasError("Canvas images must be embedded PNG, JPEG, WebP, GIF or AVIF files");
  }
  const state = value.appState;
  if (!finite(state.scrollX) || !finite(state.scrollY) || !object(state.zoom) || !finite(state.zoom.value) || state.zoom.value < 0.1 || state.zoom.value > 30) throw new CanvasError("Invalid canvas viewport");
  // Transient editor state never enters the persistent document.
  const result = { elements: value.elements, files: value.files, appState: { scrollX: state.scrollX, scrollY: state.scrollY, zoom: { value: state.zoom.value as CanvasScene["appState"]["zoom"]["value"] } } } as CanvasScene;
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_CANVAS_BYTES) throw new CanvasError("Canvas exceeds the 16 MiB limit; export it and remove some images", 413);
  return result;
}
function summary(board: CanvasDocument): CanvasSummary {
  const { id, title, revision, createdAt, updatedAt } = board;
  return { id, title, revision, createdAt, updatedAt };
}

// Shared by every canvas, but separate from board documents and their deletion.
export function readCanvasAssetLibrary(): CanvasAssetLibrary {
  return readJsonObject<CanvasAssetLibrary>("canvas-library.json") ?? { revision: 0, libraryItems: [] };
}
export function saveCanvasAssetLibrary(expectedRevision: unknown, items: unknown): Pick<CanvasAssetLibrary, "revision"> {
  const expected = revision(expectedRevision);
  if (!Array.isArray(items) || items.length > 1000) throw new CanvasError("A library can contain at most 1,000 items");
  if (Buffer.byteLength(JSON.stringify(items)) > MAX_CANVAS_BYTES) throw new CanvasError("Library exceeds the 16 MiB limit", 413);
  const ids = new Set<string>();
  let elementCount = 0;
  for (const item of items) {
    if (!object(item) || typeof item.id !== "string" || !item.id || item.id.length > 100 || ids.has(item.id)
      || !["published", "unpublished"].includes(String(item.status)) || typeof item.created !== "number" || !Number.isFinite(item.created)
      || !Array.isArray(item.elements) || !item.elements.length) throw new CanvasError("Invalid library item");
    ids.add(item.id);
    elementCount += item.elements.length;
    if (elementCount > 10_000) throw new CanvasError("A library can contain at most 10,000 elements");
    // Reuse the scene's geometry/link guards; libraries do not carry image files.
    const checked = scene({ elements: item.elements, files: {}, appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 } } });
    if (checked.elements.some((element) => element.type === "image")) throw new CanvasError("Library items cannot contain images");
  }
  return updateJsonObject<CanvasAssetLibrary, Pick<CanvasAssetLibrary, "revision">>("canvas-library.json", (stored) => {
    const current = stored ?? { revision: 0, libraryItems: [] };
    if (current.revision !== expected) throw new CanvasError("Library changed in another tab. Export your library before reloading.", 409);
    const value: CanvasAssetLibrary = { revision: current.revision + 1, libraryItems: items };
    return { value, result: { revision: value.revision }, changed: true };
  });
}

export function listCanvases(): CanvasSummary[] {
  let names: string[];
  try { names = readdirSync(dataPath("canvases")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  // Personal library: one atomic file per board, no second index to keep in sync.
  return names.filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
    .flatMap((name) => { const board = readJsonObject<CanvasDocument>(`canvases/${name}`); return board ? [summary(board)] : []; })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function readCanvas(id: unknown): CanvasDocument {
  const board = readJsonObject<CanvasDocument>(filename(id));
  if (!board) throw new CanvasError("Canvas not found", 404);
  return board;
}
export function createCanvas(value: unknown): CanvasDocument {
  const now = new Date().toISOString();
  const board: CanvasDocument = { id: randomUUID(), title: title(value), revision: 0, createdAt: now, updatedAt: now,
    scene: { elements: [], files: {}, appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 as CanvasScene["appState"]["zoom"]["value"] } } } };
  writeJsonObject(filename(board.id), board);
  return board;
}
export function saveCanvas(id: unknown, expectedRevision: unknown, content: unknown): CanvasSummary {
  const file = filename(id);
  const expected = revision(expectedRevision);
  if (!object(content)) throw new CanvasError("Invalid canvas content");
  const next: CanvasContent = { title: title(content.title), scene: scene(content.scene) };
  return updateJsonObject<CanvasDocument, CanvasSummary>(file, (current) => {
    if (!current) throw new CanvasError("Canvas not found", 404);
    if (current.revision !== expected) throw new CanvasError("This canvas changed in another tab. Export your drawing before reloading the saved version.", 409);
    const updated = { ...current, ...next, revision: current.revision + 1, updatedAt: new Date().toISOString() };
    return { value: updated, result: summary(updated), changed: true };
  });
}
export function deleteCanvas(id: unknown, expectedRevision: unknown): void {
  const file = filename(id);
  const expected = revision(expectedRevision);
  withFileLock(dataPath(file), () => {
    const current = readCanvas(id);
    if (current.revision !== expected) throw new CanvasError("Canvas changed; reload before deleting it", 409);
    rmSync(dataPath(file));
  });
}
