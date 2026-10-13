import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, LibraryItems } from "@excalidraw/excalidraw/types";

export const MAX_CANVAS_BYTES = 16 * 1024 * 1024;
export interface CanvasAssetLibrary { revision: number; libraryItems: LibraryItems }
export interface CanvasScene {
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles;
  appState: Pick<AppState, "scrollX" | "scrollY" | "zoom">;
}
export interface CanvasSummary {
  id: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface CanvasDocument extends CanvasSummary { scene: CanvasScene }
export type CanvasContent = Pick<CanvasDocument, "title" | "scene">;

/** History stays in the editor; deleted objects and unused image bytes need not live on disk. */
export function snapshotCanvas(elements: readonly ExcalidrawElement[], state: CanvasScene["appState"], files: BinaryFiles): CanvasScene {
  const live = elements.filter((element) => !element.isDeleted);
  const fileIds = new Set<string>(live.flatMap((element) => element.type === "image" && element.fileId ? [element.fileId] : []));
  return {
    elements: live,
    files: Object.fromEntries(Object.entries(files).filter(([id]) => fileIds.has(id))),
    appState: { scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom },
  };
}

/** A bounded textual snapshot, not a claim that the model can see the images. */
export function canvasContext(scene: CanvasScene): string {
  const elements = scene.elements.filter((element) => !element.isDeleted);
  const lines = elements.map((element) => JSON.stringify({
    id: element.id, type: element.type,
    x: Math.round(element.x), y: Math.round(element.y),
    width: Math.round(element.width), height: Math.round(element.height),
    ...("text" in element ? { text: element.text } : {}),
    ...("containerId" in element ? { containerId: element.containerId } : {}),
    ...("startBinding" in element ? { from: element.startBinding?.elementId, to: element.endBinding?.elementId } : {}),
  }));
  const text = lines.join("\n");
  return `Canvas objects (positions are in canvas coordinates; image contents are NOT included):\n${text.slice(0, 90_000)}${text.length > 90_000 ? "\n[Snapshot truncated]" : ""}`;
}
