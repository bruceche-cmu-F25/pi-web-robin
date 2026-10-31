"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { findMindNode, flattenMindTree, type MindNode, type MindmapOperation } from "@/extension/robin/mindmap";
import { layoutMindmap } from "./note-mindmap";
import styles from "./NoteMindmap.module.css";

const tones = ["iris", "teal", "clay", "honey", "fern", "plum"];
export function NoteMindmap({ root, revision, selectedIds, onSelect, changedIds, busy, onEdit, onDirty }: {
  root: MindNode; revision: number; selectedIds: string[]; onSelect: (ids: string[]) => void; changedIds: ReadonlySet<string>;
  busy: boolean; onEdit: (operations: MindmapOperation[]) => Promise<boolean>; onDirty: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);
  const labelRef = useRef<HTMLInputElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const map = useMemo(() => layoutMindmap(root, collapsed), [root, collapsed]);
  const selected = selectedIds.length === 1 ? findMindNode(root, selectedIds[0]) : undefined;
  const [label, setLabel] = useState(selected?.label ?? "");
  const [parent, setParent] = useState("");
  useEffect(() => { setLabel(selected?.label ?? ""); setParent(""); onDirty(false); }, [selected?.id, selected?.label, revision, onDirty]);
  useEffect(() => {
    const element = viewport.current;
    if (!element || fitted.current) return;
    const observer = new ResizeObserver(() => {
      if (fitted.current || !element.clientWidth || !element.clientHeight) return;
      fitted.current = true;
      setZoom(Math.max(0.05, Math.min(1, (element.clientWidth - 32) / map.width, (element.clientHeight - 32) / map.height)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [map.width, map.height]);
  useEffect(() => {
    // Reveal the changed branch without discarding unrelated view-only folds.
    setCollapsed((previous) => {
      const next = new Set(previous);
      for (const node of flattenMindTree(root)) if (flattenMindTree(node).some((child) => changedIds.has(child.id))) next.delete(node.id);
      return next;
    });
  }, [root, changedIds]);
  const dirty = !!selected && label !== selected.label;
  const choose = (ids: string[]) => {
    if (dirty && !window.confirm(t("mindmap.discardLabel"))) return;
    onDirty(false); onSelect(ids);
    setCollapsed((previous) => new Set([...previous].filter((id) => {
      const branch = findMindNode(root, id);
      return branch && !flattenMindTree(branch).some((node) => ids.includes(node.id));
    })));
  };
  const fit = () => {
    const element = viewport.current;
    if (!element) return;
    setZoom(Math.max(0.05, Math.min(1, (element.clientWidth - 32) / map.width, (element.clientHeight - 32) / map.height)));
    element.scrollTo({ left: 0, top: 0 });
  };
  const add = async () => {
    if (!selected || dirty) return;
    const name = window.prompt(t("mindmap.newNode"));
    if (!name?.trim()) return;
    const id = crypto.randomUUID();
    if (await onEdit([{ kind: "add", parent: selected.id, node: { id, label: name.trim(), children: [] } }])) { onSelect([id]); setCollapsed((current) => { const next = new Set(current); next.delete(selected.id); return next; }); }
  };
  const remove = async () => {
    if (!selected || selected.id === root.id || !window.confirm(t("mindmap.removeConfirm", { label: selected.label }))) return;
    if (await onEdit([{ kind: "remove", id: selected.id, keepChildren: false }])) onSelect([root.id]);
  };
  const descendants = new Set(selected ? flattenMindTree(selected).map((n) => n.id) : []);
  return <section className={styles.canvas} aria-label={t("notes.mindmap")}>
    <div className={styles.mapToolbar}>
      <select className={styles.locate} aria-label={t("mindmap.locate")} value={selectedIds.length === 1 ? selectedIds[0] : ""} onChange={(e) => { if (e.target.value) choose([e.target.value]); }}>
        <option value="">{t("mindmap.locate")}</option>{flattenMindTree(root).map((node) => <option key={node.id} value={node.id}>{node.label.slice(0, 80)} · {node.id.slice(-4)}</option>)}
      </select>
      <p>{t("mindmap.canvasHint")}</p>
      <div className={styles.actions}>
        <button type="button" onClick={() => setZoom((n) => Math.max(0.05, n - 0.15))} disabled={zoom <= 0.05} aria-label={t("notes.map.zoomOut")}>−</button>
        <output aria-label={t("notes.map.zoom")}>{Math.round(zoom * 100)}%</output>
        <button type="button" onClick={() => setZoom((n) => Math.min(2, n + 0.15))} disabled={zoom >= 2} aria-label={t("notes.map.zoomIn")}>＋</button>
        <button type="button" onClick={fit}>{t("notes.map.fit")}</button>
        <button type="button" disabled={!collapsed.size} onClick={() => setCollapsed(new Set())}>{t("notes.map.expand")}</button>
      </div>
    </div>
    <div ref={viewport} className={styles.viewport} tabIndex={0} aria-label={t("notes.map.viewport")}
      onPointerDown={(event) => {
        if (event.button !== 0 || event.pointerType !== "mouse" || (event.target as Element).closest("[data-map-node]")) return;
        pan.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => { if (pan.current) { event.currentTarget.scrollLeft = pan.current.left - event.clientX + pan.current.x; event.currentTarget.scrollTop = pan.current.top - event.clientY + pan.current.y; } }}
      onPointerUp={() => { pan.current = null; }} onPointerCancel={() => { pan.current = null; }} onLostPointerCapture={() => { pan.current = null; }}>
      <div className={styles.bounds} style={{ width: map.width * zoom, height: map.height * zoom }}>
        <div className={styles.map} style={{ width: map.width, height: map.height, transform: `scale(${zoom})` }}>
          <svg width={map.width} height={map.height} aria-hidden="true" className={styles.edges}>
            {map.edges.map(({ from, to, side }) => {
              const x1 = from.x + (side > 0 ? from.width : 0), y1 = from.y + from.height / 2;
              const x2 = to.x + (side > 0 ? 0 : to.width), y2 = to.y + to.height / 2;
              return <path key={to.id} d={`M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`} stroke={`var(--todo-${tones[to.tone % tones.length]})`} />;
            })}
          </svg>
          {map.nodes.map((node) => <div key={node.id} data-map-node={node.id} className={styles.nodeWrap} style={{ left: node.x, top: node.y, width: node.width, height: node.height, "--branch": `var(--todo-${tones[node.tone % tones.length] ?? "iris"})` } as CSSProperties}>
            <button type="button" className={styles.node} data-root={node.id === root.id} data-changed={changedIds.has(node.id)} aria-pressed={selectedIds.includes(node.id)} title={node.label} aria-label={node.label}
              onClick={(e) => choose(e.metaKey || e.ctrlKey || e.shiftKey ? selectedIds.includes(node.id) ? selectedIds.filter((id) => id !== node.id) : [...selectedIds, node.id].slice(-30) : [node.id])}
              onDoubleClick={() => { choose([node.id]); requestAnimationFrame(() => labelRef.current?.focus()); }}
              draggable={!busy && !dirty && node.id !== root.id}
              onDragStart={(e) => { e.dataTransfer.setData("application/x-robin-mindmap-node", node.id); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { if (!busy && !dirty && e.dataTransfer.types.includes("application/x-robin-mindmap-node")) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
              onDrop={(e) => { const id = e.dataTransfer.getData("application/x-robin-mindmap-node"); if (!id || busy || dirty) return; e.preventDefault(); void onEdit([{ kind: "move", id, parent: node.id }]); }}>
              {node.lines.map((line, index) => <span key={index}>{line}</span>)}
            </button>
            {node.children.length > 0 && node.id !== root.id && <button type="button" className={styles.fold} aria-label={t("mindmap.fold", { label: node.label })} aria-expanded={!collapsed.has(node.id)} onClick={() => setCollapsed((previous) => { const next = new Set(previous); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; })}>{collapsed.has(node.id) ? `+${node.children.length}` : "−"}</button>}
          </div>)}
        </div>
      </div>
    </div>
    <div className={styles.inspector}>
      {selected ? <>
        <form onSubmit={(e) => { e.preventDefault(); if (dirty && label.trim()) void onEdit([{ kind: "rename", id: selected.id, label }]); }}>
          <label>{t("mindmap.nodeLabel")}<input ref={labelRef} value={label} maxLength={500} disabled={busy} onChange={(e) => { setLabel(e.target.value); onDirty(e.target.value !== selected.label); }} /></label>
          <button type="submit" disabled={busy || !dirty || !label.trim()}>{t("mindmap.saveNode")}</button>
          {dirty && <button type="button" onClick={() => { setLabel(selected.label); onDirty(false); }}>{t("mindmap.cancelEdit")}</button>}
        </form>
        <div className={styles.actions}>
          <button type="button" disabled={busy || dirty} onClick={() => void add()}>{t("mindmap.addChild")}</button>
          {selected.id !== root.id && <>
            <select aria-label={t("mindmap.moveTo")} value={parent} disabled={busy || dirty} onChange={(e) => setParent(e.target.value)}>
              <option value="">{t("mindmap.moveTo")}</option>{flattenMindTree(root).filter((n) => !descendants.has(n.id)).map((n) => <option key={n.id} value={n.id}>{n.label.slice(0, 60)} · {n.id.slice(-4)}</option>)}
            </select>
            <button type="button" disabled={busy || dirty || !parent} onClick={() => void onEdit([{ kind: "move", id: selected.id, parent }])}>{t("mindmap.move")}</button>
            <button type="button" disabled={busy || dirty} onClick={() => void remove()}>{t("mindmap.remove")}</button>
          </>}
        </div>
      </> : <p>{t("mindmap.selectionHint", { count: selectedIds.length })}</p>}
    </div>
  </section>;
}
