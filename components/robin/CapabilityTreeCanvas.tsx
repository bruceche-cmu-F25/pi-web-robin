"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  bracePath,
  braceStem,
  layoutCapabilityTree,
  type PlacedNode,
  type TreeNode,
} from "@/extension/robin/capability-tree";
import type { CapabilityRole } from "@/extension/robin/capability-map";

// Floored well above "thumbnail". Below roughly 0.5 the labels stop being
// information and become texture, and a map you cannot read is not a map.
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.4;

interface CapabilityTreeCanvasProps {
  root: TreeNode;
  expanded: ReadonlySet<string>;
  role: CapabilityRole;
  selectedId: string | null;
  /** Ids that matched the current search; empty when there is no query. */
  matches: ReadonlySet<string>;
  searching: boolean;
  zh: boolean;
  /** Bumped by the parent to request a re-fit (role switch, collapse all…). */
  fitToken: number;
  onToggle: (node: PlacedNode) => void;
  onSelect: (node: PlacedNode) => void;
}

export function CapabilityTreeCanvas({
  root,
  expanded,
  role,
  selectedId,
  matches,
  searching,
  zh,
  fitToken,
  onToggle,
  onSelect,
}: CapabilityTreeCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 0.62 });
  const [panning, setPanning] = useState(false);
  /** Node whose on-screen position must survive the next relayout. */
  const anchorRef = useRef<{ id: string; screenY: number; opening: boolean } | null>(null);

  const layout = useMemo(
    () => layoutCapabilityTree(root, expanded, role),
    [expanded, role, root],
  );
  // Whatever moves the view — drag, zoom, an accordion fold that shrinks the
  // tree under the reader — the map must never end up entirely off-screen.
  const layoutRef = useRef(layout);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  const clamp = useCallback((next: { x: number; y: number; zoom: number }) => {
    const viewport = viewportRef.current;
    if (!viewport?.clientWidth) return next;
    const keep = 160;
    const width = layoutRef.current.width * next.zoom;
    const height = layoutRef.current.height * next.zoom;
    return {
      zoom: next.zoom,
      x: Math.max(keep - width, Math.min(viewport.clientWidth - keep, next.x)),
      y: Math.max(keep - height, Math.min(viewport.clientHeight - keep, next.y)),
    };
  }, []);

  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const { clientWidth, clientHeight } = viewport;
    if (!clientWidth || !clientHeight) return;
    // Never fits by shrinking past legibility: if the branch is taller than the
    // viewport the reader scrolls, which is cheaper than squinting. A phone is
    // narrower than any two columns, so it gets a lower floor and zooms back in.
    const floor = clientWidth < 720 ? 0.52 : 0.72;
    const zoom = Math.max(
      floor,
      Math.min(1.2, Math.min(clientWidth / layout.width, clientHeight / layout.height) * 0.94),
    );
    const scaledWidth = layout.width * zoom;
    const scaledHeight = layout.height * zoom;
    setView({
      x: scaledWidth < clientWidth ? (clientWidth - scaledWidth) / 2 : 16,
      y: scaledHeight < clientHeight ? (clientHeight - scaledHeight) / 2 : 16,
      zoom,
    });
  }, [layout.height, layout.width]);

  // Refit only when the parent asks. Depending on `fit` directly would refit on
  // every expand, undoing the anchoring below.
  const fitRef = useRef(fit);
  useEffect(() => { fitRef.current = fit; }, [fit]);
  useEffect(() => { fitRef.current(); }, [fitToken]);

  // A viewport that mounts at zero width (hidden tab, panel opening) cannot be
  // fitted yet, and would otherwise stay parked at its default zoom forever.
  const fittedRef = useRef(false);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (viewport.clientWidth) fittedRef.current = true;
    const observer = new ResizeObserver(() => {
      if (fittedRef.current || !viewport.clientWidth) return;
      fittedRef.current = true;
      fitRef.current();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // Keep the toggled branch under the cursor: without this the whole map jumps
  // downward every time an earlier continent opens, which is exactly the
  // "I lost where I was" feeling the force-directed version had.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (!anchor) return;
    const node = layout.nodes.find((item) => item.id === anchor.id);
    if (!node) return;
    const centre = node.y + node.height / 2;
    // Children open into the next column, which is often past the right edge.
    const child = anchor.opening
      ? layout.nodes.find((item) => item.trail[item.trail.length - 1] === node.id)
      : undefined;
    const viewportWidth = viewportRef.current?.clientWidth ?? 0;
    setView((current) => {
      let x = current.x;
      if (child && viewportWidth) {
        const right = (child.x + child.width) * current.zoom + x;
        if (right > viewportWidth - 24) x -= right - (viewportWidth - 24);
      }
      return clamp({ ...current, x, y: anchor.screenY - centre * current.zoom });
    });
  }, [clamp, layout]);

  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const px = clientX === undefined ? rect.width / 2 : clientX - rect.left;
    const py = clientY === undefined ? rect.height / 2 : clientY - rect.top;
    setView((current) => {
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.zoom * factor));
      if (zoom === current.zoom) return current;
      const ratio = zoom / current.zoom;
      return clamp({ zoom, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio });
    });
  }, [clamp]);

  // Zoom on pinch (⌘/Ctrl + wheel) only. A plain wheel is left alone so the
  // page keeps scrolling past the canvas — a map that eats the scroll wheel
  // strands the reader mid-page and quietly pans itself a thousand pixels away.
  // Registered natively because React's onWheel is passive and cannot
  // preventDefault the browser's own pinch-zoom.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!(event.target as HTMLElement).closest("[data-pan-surface]")) return;
    if (event.button !== 0) return;
    const start = { x: event.clientX, y: event.clientY, view };
    setPanning(true);
    const move = (moveEvent: PointerEvent) => {
      setView(clamp({
        ...start.view,
        x: start.view.x + (moveEvent.clientX - start.x),
        y: start.view.y + (moveEvent.clientY - start.y),
      }));
    };
    const up = () => {
      setPanning(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const handleToggle = (node: PlacedNode) => {
    if (node.hasChildren) {
      anchorRef.current = {
        id: node.id,
        screenY: (node.y + node.height / 2) * view.zoom + view.y,
        opening: !node.expanded,
      };
    }
    onToggle(node);
  };

  const trailIds = useMemo(() => {
    const selected = layout.nodes.find((node) => node.id === selectedId);
    return new Set(selected ? [...selected.trail, selected.id] : []);
  }, [layout.nodes, selectedId]);

  return (
    <div className="capability-tree-shell">
      {/* Controls live above the canvas rather than floating on it: an overlay
          always ends up sitting on top of whichever branch you just opened. */}
      <div className="capability-tree-controls">
        <button type="button" className="ui-action" onClick={() => zoomAt(1.25)} aria-label={zh ? "放大" : "Zoom in"}>+</button>
        <button type="button" className="ui-action" onClick={() => zoomAt(0.8)} aria-label={zh ? "缩小" : "Zoom out"}>−</button>
        <button type="button" className="ui-action" onClick={fit}>{zh ? "适应" : "Fit"}</button>
        <span className="capability-tree-zoom">{Math.round(view.zoom * 100)}%</span>
        <span className="capability-tree-hint">
          {zh
            ? "拖动平移 · ⌘/Ctrl + 滚轮缩放 · 点节点展开下一层"
            : "Drag to pan · ⌘/Ctrl + scroll to zoom · click a node to unfold it"}
        </span>
      </div>
      <div
        ref={viewportRef}
        className="capability-tree-viewport"
        data-panning={panning ? "true" : "false"}
        onPointerDown={onPointerDown}
        role="application"
        aria-label={zh ? "能力知识图谱画布" : "Capability atlas canvas"}
      >
        <div className="capability-tree-surface" data-pan-surface="true" />
        <div
          className="capability-tree-stage"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})`,
          }}
        >
          <svg
            className="capability-tree-braces"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            aria-hidden="true"
          >
            {layout.braces.map((brace) => (
              <g key={brace.id} data-domain={brace.domain} data-depth={brace.childDepth}>
                <path className="capability-tree-stem" d={braceStem(brace)} />
                <path className="capability-tree-brace" d={bracePath(brace)} />
              </g>
            ))}
          </svg>

          <div className="capability-tree-nodes" role="tree" aria-label={zh ? "能力层级" : "Capability hierarchy"}>
            {layout.nodes.map((node) => (
              <TreeNodeBox
                key={node.id}
                node={node}
                zh={zh}
                selected={node.id === selectedId}
                onTrail={trailIds.has(node.id)}
                dimmed={searching && !matches.has(node.id)}
                highlighted={searching && matches.has(node.id)}
                onToggle={handleToggle}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

function TreeNodeBox({
  node,
  zh,
  selected,
  onTrail,
  dimmed,
  highlighted,
  onToggle,
  onSelect,
}: {
  node: PlacedNode;
  zh: boolean;
  selected: boolean;
  onTrail: boolean;
  dimmed: boolean;
  highlighted: boolean;
  onToggle: (node: PlacedNode) => void;
  onSelect: (node: PlacedNode) => void;
}) {
  const leaf = !node.hasChildren;
  return (
    <button
      type="button"
      className="capability-tree-node"
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      data-kind={node.kind}
      data-domain={node.domain || "root"}
      data-demand={node.demand ?? "none"}
      data-selected={selected ? "true" : "false"}
      data-trail={onTrail ? "true" : "false"}
      data-dimmed={dimmed ? "true" : "false"}
      data-match={highlighted ? "true" : "false"}
      data-open={node.expanded ? "true" : "false"}
      role="treeitem"
      aria-level={node.depth + 1}
      aria-expanded={leaf ? undefined : node.expanded}
      aria-selected={selected}
      onClick={() => {
        onSelect(node);
        if (!leaf) onToggle(node);
      }}
    >
      <span className="capability-tree-label">{node.label}</span>
      {leaf ? null : (
        <span className="capability-tree-count" aria-hidden="true">
          {node.expanded ? "−" : `+${node.children.length}`}
        </span>
      )}
      {node.kind === "capability" ? <i className="capability-tree-dot" aria-hidden="true" /> : null}
      <span className="sr-only">
        {leaf ? "" : node.expanded ? (zh ? "已展开" : "expanded") : (zh ? "点击展开" : "click to expand")}
      </span>
    </button>
  );
}
