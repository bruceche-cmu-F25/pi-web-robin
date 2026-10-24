import type { SimulationNodeDatum } from "d3-force";
import type { VaultEntry } from "@/extension/robin/obsidian-browser-domain";

export const GRAPH_TONES = ["iris", "fern", "clay", "slate", "honey", "rose"] as const;
export const folderOf = (path: string) => path.includes("/") ? path.split("/")[0] : "";
export function folderTone(folder: string): string {
  let hash = 0;
  for (const char of folder) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return GRAPH_TONES[hash % GRAPH_TONES.length];
}
export function noteNeighbors(notes: readonly VaultEntry[]): Map<string, Set<string>> {
  const result = new Map(notes.map((note) => [note.path, new Set<string>()]));
  for (const note of notes) for (const target of note.links) {
    if (target === note.path || !result.has(target)) continue;
    result.get(note.path)!.add(target); result.get(target)!.add(note.path);
  }
  return result;
}
export function neighborhood(neighbors: Map<string, Set<string>>, path: string, depth: number): Set<string> {
  const result = new Set<string>();
  if (!neighbors.has(path)) return result;
  let frontier = [path]; result.add(path);
  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = [];
    for (const id of frontier) for (const target of neighbors.get(id) ?? []) {
      if (!result.has(target)) { result.add(target); next.push(target); }
    }
    frontier = next;
  }
  return result;
}
export interface GraphNode extends SimulationNodeDatum {
  id: string; title: string; folder: string; radius: number; degree: number; x: number; y: number;
}
export interface GraphEdge { source: GraphNode; target: GraphNode }
export const nodeRadius = (node: GraphNode, scale: number) => Math.max(3, node.radius * Math.sqrt(scale));
export function graphData(notes: readonly VaultEntry[]) {
  const neighbors = noteNeighbors(notes);
  const nodes: GraphNode[] = notes.map((note, i) => ({ id: note.path, title: note.title, folder: folderOf(note.path),
    degree: neighbors.get(note.path)!.size, radius: 5 + Math.min(9, Math.sqrt(neighbors.get(note.path)!.size) * 2),
    x: Math.cos(i * 2.39996) * Math.sqrt(i + 1) * 26, y: Math.sin(i * 2.39996) * Math.sqrt(i + 1) * 26 }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges: GraphEdge[] = [];
  let totalEdges = 0;
  for (const [id, targets] of neighbors) for (const target of targets) {
    if (id >= target) continue; // Reciprocal links share one visual edge; reader preserves direction.
    totalEdges++;
    // ponytail: bound Canvas/force work at 10k edges; use WebGL/worker if larger vaults need every edge.
    if (edges.length < 10_000) edges.push({ source: byId.get(id)!, target: byId.get(target)! });
  }
  return { nodes, edges, neighbors, totalEdges };
}
export interface Point { x: number; y: number }
export interface Camera extends Point { k: number }
export const toWorld = (camera: Camera, point: Point): Point => ({ x: (point.x - camera.x) / camera.k, y: (point.y - camera.y) / camera.k });
export const toScreen = (camera: Camera, point: Point): Point => ({ x: point.x * camera.k + camera.x, y: point.y * camera.k + camera.y });
export function zoomAt(camera: Camera, scale: number, anchor: Point): Camera {
  const k = Math.max(.12, Math.min(5, scale));
  const world = toWorld(camera, anchor);
  return { k, x: anchor.x - world.x * k, y: anchor.y - world.y * k };
}
export function fitGraph(nodes: readonly GraphNode[], width: number, height: number): Camera {
  if (!nodes.length) return { x: width / 2, y: height / 2, k: 1 };
  const minX = Math.min(...nodes.map((n) => n.x - n.radius)), maxX = Math.max(...nodes.map((n) => n.x + n.radius));
  const minY = Math.min(...nodes.map((n) => n.y - n.radius)), maxY = Math.max(...nodes.map((n) => n.y + n.radius));
  const k = Math.max(.12, Math.min(1.6, (width - 100) / Math.max(100, maxX - minX), (height - 100) / Math.max(100, maxY - minY)));
  return { k, x: width / 2 - (minX + maxX) / 2 * k, y: height / 2 - (minY + maxY) / 2 * k };
}
export function hitNode(nodes: readonly GraphNode[], camera: Camera, point: Point): GraphNode | undefined {
  const world = toWorld(camera, point);
  let nearest: GraphNode | undefined, distance = Infinity;
  for (const node of nodes) {
    const d = Math.hypot(world.x - node.x, world.y - node.y);
    if (d <= Math.max(nodeRadius(node, camera.k) + 4, 14) / camera.k && d < distance) { nearest = node; distance = d; }
  }
  return nearest;
}
