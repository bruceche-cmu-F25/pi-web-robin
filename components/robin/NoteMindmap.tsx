"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import { findMindNode, flattenMindTree, mindmapSelectionRoots, mindmapUrl, type MindNode, type MindmapOperation } from "@/extension/robin/mindmap";
import { fitMindmap, layoutMindmap, mindmapEdgePath, mindmapFolds, mindmapPath, positionMindmap, readMindmapOffsets, translateMindmapSelection, zoomMindmap, type MindmapCamera, type MindmapOffsets } from "./note-mindmap";
import { MindmapIcon } from "./MindmapIcon";
import styles from "./NoteMindmap.module.css";

const tones = ["iris", "teal", "clay", "honey", "fern", "plum"];
type NodeDraft = { id: string; label: string; url: string; focusUrl?: boolean; parent?: string; index?: number };
type NodeDrag = { ids: string[]; selection: string[]; pointerId: number; x: number; y: number; zoom: number; moved: boolean; target: string; branch: Set<string>; before: MindmapOffsets; current: MindmapOffsets; root: MindNode };
type ViewSnapshot = { camera: MindmapCamera; collapsed: ReadonlySet<string>; offsets: MindmapOffsets; selectedIds: string[]; arrangementKey: string };
type MindmapProps = {
  mapId: string; root: MindNode; revision: number; selectedIds: string[]; onSelect: (ids: string[]) => void; changedIds: ReadonlySet<string>;
  busy: boolean; onEdit: (operations: MindmapOperation[]) => Promise<boolean>; onDirty: (dirty: boolean) => void;
  chatOpen: boolean; active: boolean; onHistory: (action: "undo" | "redo") => void;
  arrangeRevision: number; onLayoutChange: () => void;
  onSummarize: (node: MindNode) => void; summarizing: boolean; explainedIds: ReadonlySet<string>;
  focusId: string | null; onFocus: (id: string | null, selection: string[]) => void;
};

export function NoteMindmap(props: MindmapProps) {
  // Only one renderer is mounted. View snapshots never copy or replace document content.
  const [views] = useState(() => new Map<string, ViewSnapshot>());
  const path = mindmapPath(props.root, props.focusId), root = path.at(-1)!;
  const remember = useCallback((snapshot: ViewSnapshot) => { views.set(root.id, snapshot); }, [views, root.id]);
  const navigate = (id: string | null) => {
    const target = mindmapPath(props.root, id).at(-1)!;
    const selection = (views.get(target.id)?.selectedIds ?? []).filter((nodeId) => findMindNode(target, nodeId));
    props.onFocus(target.id === props.root.id ? null : target.id, selection);
  };
  return <MindmapView key={root.id} {...props} root={root} path={path} initialView={views.get(root.id)} onRemember={remember} onNavigate={navigate} />;
}

function MindmapView({ mapId, root, revision, selectedIds, onSelect, changedIds, busy, onEdit, onDirty, chatOpen, active, onHistory, arrangeRevision, onLayoutChange, onSummarize, summarizing, explainedIds, path, initialView, onRemember, onNavigate }: MindmapProps & {
  path: MindNode[]; initialView?: ViewSnapshot; onRemember: (snapshot: ViewSnapshot) => void; onNavigate: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const focused = path.length > 1;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => initialView?.collapsed ?? (!focused && flattenMindTree(root).length > 60 ? mindmapFolds(root, 2) : new Set()));
  const restoringFolds = useRef(!!initialView);
  const focusOnMount = useRef(focused || !!initialView);
  const previousCount = useRef(flattenMindTree(root).length);
  const [requestedLevel, setRequestedLevel] = useState<string | null>(null);
  const outlineLevel = useMemo(() => {
    if (!collapsed.size) return "all";
    return [1, 2].find((depth) => { const expected = mindmapFolds(root, depth); return expected.size === collapsed.size && [...expected].every((id) => collapsed.has(id)); })?.toString() ?? "custom";
  }, [root, collapsed]);
  const [camera, setCamera] = useState<MindmapCamera>(initialView?.camera ?? { x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef(camera);
  const viewport = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const fitted = useRef(!!initialView);
  const labelRef = useRef<HTMLTextAreaElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const [linkError, setLinkError] = useState(false);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [draft, setDraft] = useState<NodeDraft | null>(null);
  const draftRef = useRef(draft); draftRef.current = draft;
  const committing = useRef(false);
  const acknowledgedRevision = useRef(revision);
  const [parent, setParent] = useState("");
  const [dropTarget, setDropTarget] = useState("");
  const [offsets, setOffsets] = useState<MindmapOffsets>(() => {
    if (initialView) return readMindmapOffsets(initialView.offsets, root);
    if (focused) return {};
    try { return readMindmapOffsets(JSON.parse(localStorage.getItem(`pi-mindmap-layout:${mapId}`) ?? "null"), root); }
    catch { return {}; }
  });
  const offsetsRef = useRef(offsets); offsetsRef.current = offsets;
  const [layoutWarning, setLayoutWarning] = useState(false);
  const [draggedIds, setDraggedIds] = useState<ReadonlySet<string>>(new Set());
  const dragging = useRef<NodeDrag | null>(null);
  const suppressClick = useRef(false), skipReveal = useRef(!!initialView);
  const displayRoot = useMemo(() => {
    if (!draft?.parent || findMindNode(root, draft.id)) return root;
    // A new topic is local until Enter/Save. Escape must not leave empty saved nodes.
    const copy = structuredClone(root), target = findMindNode(copy, draft.parent);
    target?.children.splice(draft.index ?? target.children.length, 0, { id: draft.id, label: t("mindmap.untitledNode"), children: [] });
    return copy;
  }, [root, draft?.id, draft?.parent, draft?.index, t]);
  const automaticMap = useMemo(() => layoutMindmap(displayRoot, collapsed), [displayRoot, collapsed]);
  const map = useMemo(() => positionMindmap(automaticMap, offsets), [automaticMap, offsets]);
  const mapRef = useRef(map); mapRef.current = map;
  const previousMap = useRef(automaticMap);
  const previousAreaWidth = useRef<number | null>(null);
  const previousViewportSize = useRef<{ width: number; height: number } | null>(null);
  const selected = selectedIds.length === 1 ? findMindNode(root, selectedIds[0]) : undefined;
  const allNodes = useMemo(() => flattenMindTree(root), [root]);
  const selectionRoots = useMemo(() => mindmapSelectionRoots(root, selectedIds), [root, selectedIds]);
  const descendants = new Set(selectionRoots.flatMap((node) => flattenMindTree(node).map((n) => n.id)));
  const mainBranch = !focused && selected && root.children.find((node) => !!findMindNode(node, selected.id));
  const updateCamera = useCallback((next: MindmapCamera) => { cameraRef.current = next; setCamera(next); }, []);
  const area = useCallback(() => {
    const el = viewport.current;
    return { width: Math.max(1, (el?.clientWidth ?? 1) - (el ? parseFloat(getComputedStyle(el).getPropertyValue("--buddy-inset")) || 0 : 0)), height: el?.clientHeight ?? 1 };
  }, []);
  const fit = useCallback(() => {
    const { width, height } = area(), current = mapRef.current;
    const next = fitMindmap(current.width, current.height, width, height);
    updateCamera({ ...next, x: next.x - current.left * next.zoom, y: next.y - current.top * next.zoom });
  }, [area, updateCamera]);
  const zoom = (factor: number) => { const { width, height } = area(); updateCamera(zoomMindmap(cameraRef.current, cameraRef.current.zoom * factor, width / 2, height / 2)); };
  const focusNode = (id: string) => requestAnimationFrame(() => buttons.current.get(id)?.focus({ preventScroll: true }));
  const unfold = (ids: string[]) => setCollapsed((previous) => new Set([...previous].filter((id) => {
    const branch = findMindNode(root, id);
    return branch && !flattenMindTree(branch).some((node) => node.id !== id && ids.includes(node.id));
  })));

  const storeOffsets = useCallback((next: MindmapOffsets) => {
    const clean = readMindmapOffsets(next, root);
    offsetsRef.current = clean; setOffsets(clean);
    // Focus positions belong to this reading view, never overwrite the whole-map layout.
    if (!focused) {
      try { localStorage.setItem(`pi-mindmap-layout:${mapId}`, JSON.stringify(clean)); setLayoutWarning(false); }
      catch { setLayoutWarning(true); }
    }
    onLayoutChange();
  }, [mapId, root, focused, onLayoutChange]);
  const arrangementKey = JSON.stringify([arrangeRevision, root.children.filter((node) => node.branchSide).map((node) => [node.id, node.branchSide])]);
  const previousArrangement = useRef(initialView?.arrangementKey ?? arrangementKey);
  useLayoutEffect(() => { onRemember({ camera, collapsed, offsets, selectedIds, arrangementKey }); }, [camera, collapsed, offsets, selectedIds, arrangementKey, onRemember]);
  useEffect(() => { if (focusOnMount.current) viewport.current?.focus({ preventScroll: true }); }, []);
  const cancelDrag = useCallback(() => {
    const drag = dragging.current;
    if (!drag) return;
    dragging.current = null; suppressClick.current = drag.moved;
    offsetsRef.current = drag.before; setOffsets(drag.before); setDraggedIds(new Set()); setDropTarget("");
  }, []);
  useLayoutEffect(() => {
    if (previousArrangement.current === arrangementKey) return;
    previousArrangement.current = arrangementKey;
    cancelDrag();
    // Only a confirmed layout operation or restored side assignment resets manual offsets.
    storeOffsets({});
    const frame = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(frame);
  }, [arrangementKey, storeOffsets, cancelDrag, fit]);
  useEffect(() => {
    if (dragging.current && (dragging.current.root !== root || busy || !active)) cancelDrag();
  }, [root, busy, active, cancelDrag]);
  useEffect(() => {
    const cancel = () => cancelDrag();
    window.addEventListener("blur", cancel);
    return () => window.removeEventListener("blur", cancel);
  }, [cancelDrag]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (!element.clientWidth || !element.clientHeight) return;
      const size = { width: element.clientWidth, height: element.clientHeight }, previous = previousViewportSize.current;
      previousViewportSize.current = size;
      const width = size.width - (parseFloat(getComputedStyle(element).getPropertyValue("--buddy-inset")) || 0);
      if (fitted.current) {
        if (previous) {
          // Keep the same reading centre through a phone rotation or window resize.
          updateCamera({ ...cameraRef.current, x: cameraRef.current.x + (width - (previousAreaWidth.current ?? width)) / 2, y: cameraRef.current.y + (size.height - previous.height) / 2 });
          previousAreaWidth.current = width;
        }
        return;
      }
      fitted.current = true;
      const current = mapRef.current;
      const fittedCamera = fitMindmap(current.width, current.height, width, element.clientHeight);
      // Start at a readable scale; Fit remains the explicit whole-map overview.
      const zoom = Math.max(0.85, fittedCamera.zoom), centre = current.nodes[0];
      updateCamera({ x: width / 2 - (centre.x + centre.width / 2) * zoom, y: element.clientHeight / 2 - (centre.y + centre.height / 2) * zoom, zoom });
    });
    observer.observe(element);
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest("textarea")) return;
      event.preventDefault();
      if (dragging.current) return;
      const current = cameraRef.current;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        updateCamera(zoomMindmap(current, current.zoom * Math.exp(-event.deltaY * unit * 0.01), event.clientX - rect.left, event.clientY - rect.top));
      } else updateCamera({ ...current, x: current.x - (event.shiftKey ? event.deltaY : event.deltaX) * unit, y: current.y - (event.shiftKey ? 0 : event.deltaY) * unit });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener("wheel", wheel); };
  }, [updateCamera]);
  useEffect(() => {
    const count = flattenMindTree(root).length, growth = count - previousCount.current;
    previousCount.current = count;
    if (restoringFolds.current) { restoringFolds.current = false; return; }
    if (growth > 30) { setCollapsed(mindmapFolds(root, 2)); return; }
    setCollapsed((previous) => {
      const next = new Set(previous);
      for (const node of flattenMindTree(root)) if (flattenMindTree(node).some((child) => changedIds.has(child.id))) next.delete(node.id);
      return next;
    });
  }, [root, changedIds]);
  useEffect(() => {
    if (requestedLevel === null) return;
    // Apply explicit detail choices after the saved tree's automatic reveal effect.
    setCollapsed(requestedLevel === "all" ? new Set() : mindmapFolds(root, Number(requestedLevel)));
    setRequestedLevel(null); requestAnimationFrame(fit);
  }, [requestedLevel, root, fit]);
  useEffect(() => {
    if (acknowledgedRevision.current === revision) return;
    acknowledgedRevision.current = revision;
    const current = draftRef.current;
    // Includes an explicit retry after a lost receipt. Never discard a failed edit.
    if (current && findMindNode(root, current.id)?.label === current.label.trim() && (findMindNode(root, current.id)?.url ?? "") === current.url) {
      setDraft(null); onDirty(false); focusNode(current.id);
    }
  }, [revision, root, onDirty]);
  useEffect(() => {
    if (!draft?.id) return;
    const input = draftRef.current?.focusUrl ? urlRef.current : labelRef.current;
    input?.focus({ preventScroll: true }); input?.select();
  }, [draft?.id]);
  const editingId = draft?.id;
  useLayoutEffect(() => {
    const availableWidth = area().width, oldWidth = previousAreaWidth.current ?? availableWidth;
    previousAreaWidth.current = availableWidth;
    if (!fitted.current) { previousMap.current = automaticMap; return; }
    // Keep the same content centred in the usable canvas when Buddy opens/closes.
    let next = { ...cameraRef.current, x: cameraRef.current.x + (availableWidth - oldWidth) / 2 };
    const oldRoot = previousMap.current.nodes[0], newRoot = automaticMap.nodes[0];
    // Keep the root anchored when layout bounds change; don't refit after each edit.
    next = { ...next, x: next.x + (oldRoot.x - newRoot.x) * next.zoom, y: next.y + (oldRoot.y - newRoot.y) * next.zoom };
    previousMap.current = automaticMap;
    if (dragging.current || skipReveal.current) { skipReveal.current = false; updateCamera(next); return; }
    const node = mapRef.current.nodes.find((n) => n.id === (editingId ?? selectedIds[0]));
    if (node) {
      const { width, height } = area();
      if (editingId && next.zoom < 0.85) next = zoomMindmap(next, 0.85, node.x * next.zoom + next.x, node.y * next.zoom + next.y);
      const x = node.x * next.zoom + next.x, y = node.y * next.zoom + next.y;
      if (x < 48 || x + node.width * next.zoom > width - 48) next.x = (width - node.width * next.zoom) / 2 - node.x * next.zoom;
      const focusHeight = editingId === node.id ? Math.max(node.height, 280) : node.height;
      const top = (toolbar.current?.offsetTop ?? 16) + (toolbar.current?.offsetHeight ?? 58) + 16;
      if (y < top || y + focusHeight * next.zoom > height - 110) next.y = Math.max(top, (height - focusHeight * next.zoom) / 2) - node.y * next.zoom;
    }
    updateCamera(next);
  }, [automaticMap, selectedIds, editingId, chatOpen, area, updateCamera]);

  const cancel = () => {
    if (busy || committing.current) return;
    const id = draft?.parent ?? draft?.id ?? root.id;
    setDraft(null); onDirty(false); onSelect([id]); focusNode(id);
  };
  const commit = async (after: MindmapOperation[] = []): Promise<boolean> => {
    const current = draftRef.current;
    if (busy || committing.current) return false;
    if (!current) return after.length ? onEdit(after) : true;
    if (!current.label.trim()) { labelRef.current?.setCustomValidity(t("mindmap.emptyLabel")); labelRef.current?.reportValidity(); labelRef.current?.focus(); return false; }
    let url: string;
    try { url = current.url.trim() ? mindmapUrl(current.url) : ""; }
    catch { setLinkError(true); urlRef.current?.focus(); return false; }
    setLinkError(false); setDraft({ ...current, url });
    const saved = findMindNode(root, current.id);
    if (!after.length && !current.parent && saved?.label === current.label.trim() && (saved.url ?? "") === url) {
      setDraft(null); onDirty(false); focusNode(current.id); return true;
    }
    committing.current = true;
    try {
      const operations: MindmapOperation[] = current.parent
        ? [{ kind: "add", parent: current.parent, index: current.index, node: { id: current.id, label: current.label.trim(), children: [], ...(url ? { url } : {}) } }]
        : [
          ...(saved?.label !== current.label.trim() ? [{ kind: "rename" as const, id: current.id, label: current.label.trim() }] : []),
          ...((saved?.url ?? "") !== url ? [{ kind: "link" as const, id: current.id, url: url || null }] : []),
        ];
      if (!await onEdit([...operations, ...after])) return false;
      setDraft(null); onDirty(false); onSelect([current.id]); focusNode(current.id); return true;
    } finally { committing.current = false; }
  };
  const choose = async (ids: string[]) => {
    if (!await commit()) return;
    if (ids.length === 1 && cameraRef.current.zoom < 0.85) {
      const { width, height } = area();
      updateCamera(zoomMindmap(cameraRef.current, 0.85, width / 2, height / 2));
    }
    onSelect(ids); setParent(""); if (ids.length === 1) unfold(ids);
    if (ids.length === 1) focusNode(ids[0]);
  };
  const updateDraft = (next: NodeDraft) => {
    const saved = findMindNode(root, next.id);
    setDraft(next); setLinkError(false); labelRef.current?.setCustomValidity("");
    onDirty(!!next.parent || next.label !== saved?.label || next.url !== (saved?.url ?? ""));
  };
  const startEdit = async (id: string, focusUrl = false) => {
    if (busy || (draft && !await commit())) return;
    const node = findMindNode(root, id);
    if (!node) return;
    setLinkError(false); onSelect([id]); setDraft({ id, label: node.label, url: node.url ?? "", focusUrl });
  };
  const add = (sibling = false) => {
    if (!selected || busy || draft) return;
    const target = sibling ? allNodes.find((node) => node.children.some((child) => child.id === selected.id)) : selected;
    if (!target) return;
    const id = crypto.randomUUID();
    const index = sibling ? target.children.findIndex((child) => child.id === selected.id) + 1 : undefined;
    unfold([target.id]); setCollapsed((current) => { const next = new Set(current); next.delete(target.id); return next; });
    setLinkError(false); setDraft({ id, label: "", url: "", parent: target.id, index }); onSelect([id]); onDirty(true);
  };
  const remove = async () => {
    if (!selected || busy || draft || selected.id === root.id || !window.confirm(t("mindmap.removeConfirm", { label: selected.label }))) return;
    const parentId = allNodes.find((n) => n.children.some((c) => c.id === selected.id))?.id ?? root.id;
    if (await onEdit([{ kind: "remove", id: selected.id, keepChildren: false }])) { onSelect([parentId]); focusNode(parentId); }
  };
  const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (dragging.current) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelDrag(); } return; }
    if ((e.target as Element).closest("textarea,input,select,summary") || e.nativeEvent.isComposing) return;
    const nodeButton = (e.target as Element).closest("button[data-topic]");
    if (!nodeButton && e.target !== viewport.current) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") { e.preventDefault(); if (!draft) { skipReveal.current = true; onSelect(allNodes.map((node) => node.id)); } return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (!draft && !busy) onHistory(e.shiftKey ? "redo" : "undo"); return; }
    if (e.altKey && !e.metaKey && !e.ctrlKey && e.key.startsWith("Arrow") && selectedIds.length && !draft && !busy) {
      e.preventDefault();
      storeOffsets(translateMindmapSelection(root, selectedIds, offsetsRef.current, e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0, e.key === "ArrowUp" ? -16 : e.key === "ArrowDown" ? 16 : 0));
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Tab" && !e.shiftKey && selected && !draft && !busy) { e.preventDefault(); add(); }
    else if (e.key === "Enter" && selected && !draft && !busy) { e.preventDefault(); add(selected.id !== root.id); }
    else if (e.key === "F2" && selected) { e.preventDefault(); void startEdit(selected.id); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); void remove(); }
    else if (e.key === "Escape") { e.preventDefault(); onSelect([]); viewport.current?.focus(); }
    else if (e.key === "0") { e.preventDefault(); fit(); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoom(1.2); }
    else if (e.key === "-") { e.preventDefault(); zoom(1 / 1.2); }
    else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const current = map.nodes.find((node) => node.id === selectedIds[0]) ?? map.nodes[0];
      const cx = current.x + current.width / 2, cy = current.y + current.height / 2;
      const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight", direction = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
      const candidates = map.nodes.filter((node) => node.id !== current.id).map((node) => {
        const dx = node.x + node.width / 2 - cx, dy = node.y + node.height / 2 - cy;
        return { id: node.id, forward: (horizontal ? dx : dy) * direction, distance: Math.abs(horizontal ? dx : dy) + Math.abs(horizontal ? dy : dx) * 3 };
      }).filter((n) => n.forward > 1).sort((a, b) => a.distance - b.distance);
      if (candidates[0]) void choose([candidates[0].id]);
    }
  };
  const beginDrag = (event: PointerEvent<HTMLButtonElement>, node: MindNode) => {
    if (event.button !== 0 || busy || draft || dragging.current || pointers.current.size || event.ctrlKey || event.metaKey || event.shiftKey) return;
    suppressClick.current = false;
    const before = readMindmapOffsets(offsetsRef.current, root);
    const selection = selectedIds.includes(node.id) ? selectedIds : [node.id];
    const roots = mindmapSelectionRoots(root, selection);
    dragging.current = { ids: roots.map((n) => n.id), selection, pointerId: event.pointerId, x: event.clientX, y: event.clientY, zoom: cameraRef.current.zoom,
      moved: false, target: "", branch: new Set(roots.flatMap((n) => flattenMindTree(n).map((child) => child.id))), before, current: before, root };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragging.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    if (!drag.moved) { drag.moved = true; setDraggedIds(drag.branch); onLayoutChange(); }
    drag.current = translateMindmapSelection(root, drag.ids, drag.before, dx / drag.zoom, dy / drag.zoom);
    offsetsRef.current = drag.current; setOffsets(drag.current);
    // Captured events still target the dragged button. Hit-test the real surface beneath it.
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const target = hit && viewport.current?.contains(hit) ? hit.closest<HTMLElement>("[data-topic]")?.dataset.topic : undefined;
    drag.target = target && !drag.ids.includes(root.id) && drag.ids.length <= 100 && !drag.branch.has(target) ? target : "";
    setDropTarget(drag.target);
  };
  const finishDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragging.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    if (drag.moved && (!hit || !viewport.current?.contains(hit))) { cancelDrag(); return; }
    const target = hit?.closest<HTMLElement>("[data-topic]")?.dataset.topic;
    drag.target = target && !drag.ids.includes(root.id) && drag.ids.length <= 100 && !drag.branch.has(target) ? target : "";
    dragging.current = null; setDraggedIds(new Set()); setDropTarget("");
    if (!drag.moved) return;
    suppressClick.current = true; skipReveal.current = true; onSelect(drag.selection);
    if (drag.target) {
      // A failed/retried structural write must not leave the optimistic drag position behind.
      offsetsRef.current = drag.before; setOffsets(drag.before);
      void onEdit(drag.ids.map((id) => ({ kind: "move", id, parent: drag.target })));
    } else storeOffsets(drag.current);
  };
  return <section className={styles.canvas} data-buddy={chatOpen} data-focus={focused ? root.id : undefined} aria-label={t("notes.mindmap")}>
    <div ref={toolbar} className={styles.mapToolbar}>
      {focused && <nav className={styles.breadcrumbs} aria-label={t("mindmap.focusPath")}>
        <button type="button" disabled={busy || draggedIds.size > 0} title={path[0].label} onClick={async () => { if (await commit()) onNavigate(null); }}>{t("mindmap.backToMap")}</button>
        {path.slice(1).map((node) => <span key={node.id}><span aria-hidden="true">/</span><button type="button" title={node.label} aria-current={node.id === root.id ? "location" : undefined} disabled={busy || draggedIds.size > 0 || node.id === root.id} onClick={async () => { if (await commit()) onNavigate(node.id); }}>{node.label}</button></span>)}
      </nav>}
      <select id="mindmap-node-locator" className={styles.locate} aria-label={t("mindmap.locate")} value={selected?.id ?? ""} disabled={busy || draggedIds.size > 0} onChange={(e) => { if (e.target.value) void choose([e.target.value]); }}>
        <option value="">{t("mindmap.locate")}</option>{allNodes.map((node) => <option key={node.id} value={node.id}>{node.label.slice(0, 80)}</option>)}
      </select>
      <button type="button" disabled={busy || draggedIds.size > 0} title="⌘/Ctrl A" onClick={async () => { if (!await commit()) return; skipReveal.current = true; onSelect(flattenMindTree(displayRoot).map((node) => node.id)); viewport.current?.focus(); }}><MindmapIcon name="select" /><span>{t("mindmap.selectAll")}</span></button>
      <span className={styles.toolbarDivider} aria-hidden="true" />
      <select className={styles.levelSelect} aria-label={t("mindmap.outlineLevel")} value={outlineLevel} disabled={busy || draggedIds.size > 0} onChange={async (e) => {
        const level = e.target.value;
        if (!draftRef.current) { setCollapsed(level === "all" ? new Set() : mindmapFolds(root, Number(level))); requestAnimationFrame(fit); }
        else if (await commit()) setRequestedLevel(level);
      }}>
        <option value="custom" disabled>{t("mindmap.levelCustom")}</option><option value="1">{t("mindmap.levelOne")}</option><option value="2">{t("mindmap.levelTwo")}</option><option value="all">{t("mindmap.levelAll")}</option>
      </select>
      {!focused && <button type="button" disabled={busy || draggedIds.size > 0} title={t("mindmap.arrangeHint")} onClick={() => void commit([{ kind: "arrange" }])}><MindmapIcon name="arrange" /><span>{t("mindmap.arrange")}</span></button>}
      {Object.keys(offsets).length > 0 && <button type="button" disabled={busy || draggedIds.size > 0} title={t("mindmap.layoutLocal")} onClick={async () => { if (await commit()) storeOffsets({}); }}>{t("mindmap.resetLayout")}</button>}
      {draft && <div className={styles.editingNotice}><span>{t("mindmap.toolbarEditing")}</span><button type="button" disabled={busy} onClick={cancel}>{t("mindmap.cancelEdit")}</button></div>}
    </div>
    {layoutWarning && <p className={styles.layoutWarning} role="alert">{t("mindmap.layoutWarning")}</p>}
    <div ref={viewport} className={styles.viewport} data-dragging={draggedIds.size > 0} tabIndex={0} aria-label={t("notes.map.viewport")} onKeyDown={keyDown}
      onPointerDown={(event) => {
        if (event.button !== 0 || dragging.current || (event.target as Element).closest("[data-map-node]")) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus({ preventScroll: true });
      }}
      onPointerMove={(event) => {
        const old = pointers.current.get(event.pointerId); if (!old) return;
        const before = [...pointers.current.values()];
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const after = [...pointers.current.values()];
        if (before.length === 2) {
          const rect = event.currentTarget.getBoundingClientRect();
          const midpoint = (points: typeof before) => ({ x: (points[0].x + points[1].x) / 2 - rect.left, y: (points[0].y + points[1].y) / 2 - rect.top });
          const distance = (points: typeof before) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
          const a = midpoint(before), b = midpoint(after);
          const next = zoomMindmap(cameraRef.current, cameraRef.current.zoom * distance(after) / Math.max(1, distance(before)), a.x, a.y);
          updateCamera({ ...next, x: next.x + b.x - a.x, y: next.y + b.y - a.y });
        } else updateCamera({ ...cameraRef.current, x: cameraRef.current.x + event.clientX - old.x, y: cameraRef.current.y + event.clientY - old.y });
      }}
      onPointerUp={(e) => pointers.current.delete(e.pointerId)} onPointerCancel={(e) => pointers.current.delete(e.pointerId)} onLostPointerCapture={(e) => pointers.current.delete(e.pointerId)}>
      <div className={styles.map} style={{ width: map.width, height: map.height, transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
        <svg width={map.width} height={map.height} aria-hidden="true" className={styles.edges}>
          {map.edges.map((edge) => <path key={edge.to.id} d={mindmapEdgePath(edge)} stroke={`var(--todo-${tones[edge.to.tone % tones.length]})`} strokeWidth={edge.to.depth === 1 ? 2.5 : 1.5} />)}
        </svg>
        {map.nodes.map((node) => <div key={node.id} data-map-node={node.id} data-side={node.side} data-editing={draft?.id === node.id} data-dragging={draggedIds.has(node.id)} className={styles.nodeWrap} style={{ left: node.x, top: node.y, width: node.width, height: node.height, "--topic-height": `${node.topicHeight}px`, "--branch": `var(--todo-${tones[node.tone % tones.length] ?? "iris"})` } as CSSProperties}>
          {draft?.id === node.id ? <form className={styles.inlineEditor} onSubmit={(e) => { e.preventDefault(); void commit(); }}>
            <textarea ref={labelRef} aria-label={t("mindmap.nodeLabel")} value={draft.label} placeholder={t("mindmap.untitledNode")} required maxLength={500} disabled={busy} rows={Math.max(2, Math.min(6, node.lines.length))}
              onChange={(e) => updateDraft({ ...draft, label: e.target.value })}
              onKeyDown={(e) => { e.stopPropagation(); if (e.nativeEvent.isComposing) return; if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void commit(); } else if (e.key === "Escape") { e.preventDefault(); cancel(); } }} />
            <label className={styles.urlField}>{t("mindmap.resourceUrl")}<input ref={urlRef} type="text" inputMode="url" autoCapitalize="none" autoComplete="off" spellCheck={false} value={draft.url} maxLength={2048} disabled={busy} placeholder="https://…" aria-invalid={linkError} aria-describedby={linkError ? "mindmap-link-error" : undefined} onChange={(e) => updateDraft({ ...draft, url: e.target.value })} onKeyDown={(e) => { e.stopPropagation(); if (e.nativeEvent.isComposing) return; if (e.key === "Enter") { e.preventDefault(); void commit(); } else if (e.key === "Escape") { e.preventDefault(); cancel(); } }} /></label>
            {linkError && <p id="mindmap-link-error" className={styles.urlError} role="alert">{t("mindmap.invalidUrl")}</p>}
            <small className={styles.urlHint}>{t("mindmap.resourceHint")}</small>
            <div><span>{t("mindmap.editHint")}</span><button type="submit" disabled={busy || !draft.label.trim()} aria-label={t("mindmap.saveNode")} title={t("mindmap.saveNode")}><MindmapIcon name="check" /></button></div>
          </form> : <>
            <button type="button" ref={(el) => { if (el) buttons.current.set(node.id, el); else buttons.current.delete(node.id); }} data-topic={node.id} className={styles.node} data-linked={node.links.length > 0} data-root={node.id === root.id} data-depth={node.depth} data-drop={dropTarget === node.id} data-changed={changedIds.has(node.id)} aria-pressed={selectedIds.includes(node.id)} title={node.label} aria-label={node.label} tabIndex={selectedIds[0] === node.id || (!selectedIds.length && node.id === root.id) ? 0 : -1}
              onClick={(e) => {
                if (suppressClick.current && e.detail > 0) { suppressClick.current = false; e.preventDefault(); return; }
                void choose(e.metaKey || e.ctrlKey || e.shiftKey ? selectedIds.includes(node.id) ? selectedIds.filter((id) => id !== node.id) : [...selectedIds, node.id] : [node.id]);
              }}
              onDoubleClick={() => { if (!suppressClick.current) void startEdit(node.id); }}
              draggable={false} onDragStart={(e) => e.preventDefault()}
              onPointerDown={(e) => beginDrag(e, node)} onPointerMove={moveDrag} onPointerUp={finishDrag}
              onPointerCancel={(e) => { if (dragging.current?.pointerId === e.pointerId) cancelDrag(); }}
              onLostPointerCapture={(e) => { if (dragging.current?.pointerId === e.pointerId) cancelDrag(); }}>
              {node.lines.map((line, index) => <span key={index}>{line}</span>)}
            </button>
            {node.links.length > 0 && <div className={styles.nodeLinks}>{node.links.map((link) => <a key={link.url} className={styles.nodeLink} href={link.url} target="_blank" rel="noopener noreferrer" draggable={false} title={link.url} aria-label={t("mindmap.openResource", { label: node.label, url: link.url })} onPointerDown={(e) => e.stopPropagation()}><MindmapIcon name="link" /><span>{link.label}</span><span aria-hidden="true">↗</span></a>)}</div>}
            {node.children.length > 0 && node.id !== root.id && <button type="button" className={styles.fold} aria-label={t("mindmap.fold", { label: node.label })} aria-expanded={!collapsed.has(node.id)} onClick={() => setCollapsed((previous) => { const next = new Set(previous); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; })}>{collapsed.has(node.id) ? `+${node.children.length}` : "−"}</button>}
            {selected?.id === node.id && !draft && <button type="button" className={styles.nodeAdd} disabled={busy} aria-label={t("mindmap.addChild")} title={`${t("mindmap.addChild")} · Tab`} onClick={() => add()}><MindmapIcon name="plus" /></button>}
          </>}
        </div>)}
      </div>
    </div>
    {selected && !draft && <div className={styles.nodeTools} aria-label={t("mindmap.nodeTools")}>
      <button type="button" disabled={busy} aria-label={t("mindmap.editNode")} title={`${t("mindmap.editNode")} · F2`} onClick={() => void startEdit(selected.id)}><MindmapIcon name="edit" /><span>{t("mindmap.editNode")}</span></button>
      <button type="button" className={styles.resourceAction} disabled={busy} aria-label={t("mindmap.editResource")} title={t("mindmap.editResource")} onClick={() => void startEdit(selected.id, true)}><MindmapIcon name="link" /></button>
      <button type="button" disabled={busy} aria-label={t("mindmap.addChild")} title={`${t("mindmap.addChild")} · Tab`} onClick={() => add()}><MindmapIcon name="branch" /><span>{t("mindmap.addChild")}</span></button>
      {selected.id !== root.id && <>
        <button type="button" className={styles.focusAction} disabled={busy} aria-label={t("mindmap.focusBranch")} title={t("mindmap.focusHint")} onClick={() => onNavigate(selected.id)}><MindmapIcon name="fit" /><span>{t("mindmap.focusBranch")}</span></button>
        <button type="button" className={styles.siblingAction} disabled={busy} aria-label={t("mindmap.addSibling")} title={`${t("mindmap.addSibling")} · Enter`} onClick={() => add(true)}><MindmapIcon name="sibling" /><span>{t("mindmap.addSibling")}</span></button>
        <details className={styles.nodeMenu} onKeyDown={(e) => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}><summary aria-label={t("mindmap.more")}>···</summary><div>
          <label>{t("mindmap.moveTo")}<select aria-label={t("mindmap.moveTo")} value={parent} disabled={busy} onChange={(e) => setParent(e.target.value)}>
            <option value="">{t("mindmap.moveTo")}</option>{allNodes.filter((n) => !descendants.has(n.id)).map((n) => <option key={n.id} value={n.id}>{n.label.slice(0, 60)}</option>)}
          </select></label>
          <button type="button" disabled={busy || !parent} onClick={() => void onEdit([{ kind: "move", id: selected.id, parent }])}>{t("mindmap.move")}</button>
          <button type="button" disabled={busy} onClick={() => { skipReveal.current = true; onSelect(flattenMindTree(selected).map((node) => node.id)); }}>{t("mindmap.selectBranch")}</button>
          {mainBranch && <><button type="button" disabled={busy} onClick={() => void onEdit([{ kind: "arrange", id: mainBranch.id, side: "left" }])}>{t("mindmap.placeLeft")}</button><button type="button" disabled={busy} onClick={() => void onEdit([{ kind: "arrange", id: mainBranch.id, side: "right" }])}>{t("mindmap.placeRight")}</button></>}
          <button type="button" className={styles.danger} disabled={busy} onClick={() => void remove()}><MindmapIcon name="trash" />{t("mindmap.remove")}</button>
        </div></details>
      </>}
      <span className={styles.toolbarDivider} aria-hidden="true" />
      <button type="button" className={styles.buddyAction} disabled={busy || summarizing} aria-label={t(explainedIds.has(selected.id) ? "mindmap.readExplanation" : "mindmap.summarize")} title={t("mindmap.summarizeHint", { count: flattenMindTree(selected).length })} onClick={() => onSummarize(selected)}><MindmapIcon name="document" /><span>{t(explainedIds.has(selected.id) ? "mindmap.readExplanation" : "mindmap.summarize")}</span></button>
    </div>}
    {selectedIds.length > 1 && !draft && <div className={`${styles.nodeTools} ${styles.multiTools}`} aria-label={t("mindmap.nodeTools")}>
      <span>{t("mindmap.selectionCount", { count: selectedIds.length })}</span>
      <small>{t("mindmap.dragSelection")}</small>
      <button type="button" onClick={() => onSelect([])}>{t("mindmap.clearSelection")}</button>
    </div>}
    <div className={styles.canvasFooter}>
      <span className={styles.nodeCount}>{t("mindmap.visibleCount", { visible: map.nodes.length, count: allNodes.length })}</span>
      <details className={styles.shortcuts}><summary>{t("mindmap.shortcuts")}</summary><div>{t("mindmap.canvasHint")}</div></details>
      <div className={styles.zoomControls}>
        <button type="button" onClick={() => zoom(1 / 1.2)} disabled={camera.zoom <= 0.08} aria-label={t("notes.map.zoomOut")}>−</button>
        <output aria-label={t("notes.map.zoom")}>{Math.round(camera.zoom * 100)}%</output>
        <button type="button" onClick={() => zoom(1.2)} disabled={camera.zoom >= 2.5} aria-label={t("notes.map.zoomIn")}>+</button>
        <button type="button" onClick={fit} title={t("notes.map.fit")} aria-label={t("notes.map.fit")}><MindmapIcon name="fit" /></button>
        {collapsed.size > 0 && <button type="button" onClick={() => setCollapsed(new Set())}>{t("notes.map.expand")}</button>}
      </div>
    </div>
  </section>;
}
