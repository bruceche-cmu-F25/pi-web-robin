export const MINDMAP_API = "/api/robin/mindmaps";
export class MapRequestError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }
export async function mindmapRequest<T>(url: string, method = "GET", data?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method, cache: "no-store", signal, ...(data ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}) });
  const body = await response.json();
  if (!response.ok) throw new MapRequestError(body.error ?? `Request failed (${response.status})`, response.status);
  return body;
}
export function downloadMindmapMarkdown(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
