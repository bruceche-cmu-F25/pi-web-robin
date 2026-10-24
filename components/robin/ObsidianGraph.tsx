"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import { useI18n } from "@/hooks/useI18n";
import type { VaultEntry } from "@/extension/robin/obsidian-browser-domain";
import { fitGraph, folderTone, graphData, hitNode, nodeRadius, toScreen, toWorld, zoomAt, type Camera, type GraphNode, type Point } from "./obsidian-graph";
import styles from "./ObsidianGraph.module.css";

type Command = "in" | "out" | "fit" | "release";
interface Controller {
  command: (command: Command) => void;
  select: (id: string, center?: boolean) => void;
  activate: (active: boolean) => void;
}

export default function ObsidianGraph({ notes, selected, choose, open, active }: {
  notes: VaultEntry[]; selected: string; choose: (path: string) => void; open: (path: string) => void; active: boolean;
}) {
  const { t } = useI18n();
  const descriptionId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controller = useRef<Controller | null>(null);
  const layout = useRef(new Map<string, { x: number; y: number; fx?: number | null; fy?: number | null }>());
  const cameraMemory = useRef<Camera | null>(null);
  const data = useMemo(() => graphData(notes), [notes]);
  const [hover, setHover] = useState<GraphNode | null>(null);
  const [scale, setScale] = useState(100);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const context = canvas.getContext("2d");
    if (!context) { setFailed(true); setReady(true); return; }
    setFailed(false);
    const ctx = context;
    setReady(false); setHover(null);
    const { nodes, edges, neighbors } = data;
    for (const node of nodes) Object.assign(node, layout.current.get(node.id));
    const groups = [...new Set(nodes.map((node) => node.folder))].sort();
    const groupPoint = (node: GraphNode) => {
      const angle = groups.indexOf(node.folder) / Math.max(1, groups.length) * Math.PI * 2;
      const radius = groups.length > 1 ? Math.min(260, 60 + nodes.length * 2) : 0;
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    };
    const simulation = forceSimulation(nodes).stop().alphaDecay(.065)
      .force("charge", forceManyBody<GraphNode>().strength(-230).distanceMax(700))
      .force("link", forceLink<GraphNode, typeof edges[number]>(edges).distance(110).strength(.22))
      .force("collision", forceCollide<GraphNode>().radius((node) => node.radius + 24))
      .force("x", forceX<GraphNode>((node) => groupPoint(node).x).strength(.035))
      .force("y", forceY<GraphNode>((node) => groupPoint(node).y).strength(.035));
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 1, height = 1, dpr = 1, frame = 0, disposed = false, enabled = true;
    let settling = nodes.length > 1, touched = !!cameraMemory.current, initialized = false;
    let camera: Camera = cameraMemory.current ?? { x: 0, y: 0, k: 1 };
    let selectedId = "", hoveredId = "";
    let colors = { text: "", muted: "", line: "", accent: "", ground: "", groups: new Map<string, string>(), font: "monospace" };
    const points = new Map<number, Point>();
    let gesture: { start: Point; previous: Point; node?: GraphNode; moved: boolean } | null = null;

    function palette() {
      const css = getComputedStyle(canvas);
      const token = (name: string) => css.getPropertyValue(name).trim();
      colors = { text: token("--text"), muted: token("--text-muted"), line: token("--border"), accent: token("--accent"), ground: token("--bg"),
        groups: new Map(groups.map((group) => [group, token(`--todo-${folderTone(group)}`)])), font: token("--font-mono") || "monospace" };
      schedule();
    }
    function remember() {
      for (const node of nodes) layout.current.set(node.id, { x: node.x, y: node.y, fx: node.fx, fy: node.fy });
    }
    function updateCamera(next: Camera) {
      camera = next; cameraMemory.current = camera;
      setScale(Math.round(camera.k * 100));
      schedule();
    }
    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
      // Screen-space grid and labels stay readable regardless of world zoom.
      const step = 32 * Math.max(.75, Math.min(1.5, camera.k));
      ctx.fillStyle = colors.line;
      for (let x = camera.x % step; x < width; x += step) for (let y = camera.y % step; y < height; y += step) ctx.fillRect(x, y, 1, 1);
      const focus = hoveredId || selectedId;
      const adjacent = focus ? neighbors.get(focus) : undefined;
      const lit = (id: string) => !focus || id === focus || adjacent?.has(id);
      for (const edge of edges) {
        const emphasized = edge.source.id === focus || edge.target.id === focus;
        const a = toScreen(camera, edge.source), b = toScreen(camera, edge.target);
        ctx.globalAlpha = focus ? emphasized ? .85 : .1 : .4;
        ctx.strokeStyle = emphasized ? colors.accent : colors.muted; ctx.lineWidth = emphasized ? 1.5 : .7;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.font = `12px ${colors.font}`; ctx.textAlign = "center"; ctx.textBaseline = "top";
      const labels: Array<{ node: GraphNode; point: Point; radius: number }> = [];
      for (const node of nodes) {
        const p = toScreen(camera, node), radius = nodeRadius(node, camera.k);
        if (p.x < -100 || p.x > width + 100 || p.y < -50 || p.y > height + 50) continue;
        ctx.globalAlpha = lit(node.id) ? 1 : .18;
        const color = colors.groups.get(node.folder) || colors.accent;
        if (node.id === selectedId || node.id === hoveredId) {
          ctx.strokeStyle = color; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, radius + 5, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill();
        if (node.fx != null) { ctx.fillStyle = colors.ground; ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
        if (node.id === focus || node.id === selectedId || (lit(node.id) && (nodes.length <= 50 || camera.k > 1.3 || (node.degree > 4 && camera.k > .65)))) labels.push({ node, point: p, radius });
      }
      for (const { node, point: p, radius } of labels) {
        const text = node.title.length > 28 ? `${node.title.slice(0, 27)}…` : node.title;
        ctx.globalAlpha = 1; ctx.lineWidth = 4; ctx.strokeStyle = colors.ground;
        ctx.strokeText(text, p.x, p.y + radius + 10);
        ctx.fillStyle = node.id === focus || node.id === selectedId ? colors.text : colors.muted;
        ctx.fillText(text, p.x, p.y + radius + 10);
      }
      ctx.globalAlpha = 1;
      canvas.dataset.camera = `${camera.x.toFixed(1)},${camera.y.toFixed(1)},${camera.k.toFixed(3)}`;
      canvas.dataset.hovered = hoveredId;
    }
    function render() {
      frame = 0;
      if (disposed || !enabled || document.hidden || width < 2 || height < 2) return;
      if (settling) {
        // Bounded slices: no synchronous 1,000-node warm-up, no endless background simulation.
        const until = performance.now() + 6;
        do { simulation.tick(); } while (performance.now() < until && simulation.alpha() > .02);
        settling = simulation.alpha() > .02;
        if (!settling) {
          remember();
          if (!touched) updateCamera(fitGraph(nodes, width, height));
          setReady(true);
        }
      } else setReady(true);
      if (!initialized) { camera = cameraMemory.current ?? fitGraph(nodes, width, height); initialized = true; }
      if (!motion.matches || !settling) draw();
      if (settling) schedule();
    }
    function schedule() { if (!frame && !disposed && enabled && !document.hidden) frame = requestAnimationFrame(render); }
    function resize() {
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const oldWidth = width, oldHeight = height;
      width = bounds.width; height = bounds.height; dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      if (initialized) updateCamera({ ...camera, x: camera.x + (width - oldWidth) / 2, y: camera.y + (height - oldHeight) / 2 });
      schedule();
    }
    function point(event: MouseEvent | PointerEvent | WheelEvent): Point {
      const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }
    function hoverNode(node?: GraphNode) {
      if (hoveredId !== (node?.id ?? "")) { hoveredId = node?.id ?? ""; setHover(node ?? null); schedule(); }
      canvas.style.cursor = gesture ? "grabbing" : node ? "pointer" : "grab";
    }
    function down(event: PointerEvent) {
      if (event.button !== 0) return;
      canvas.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId);
      const p = point(event); points.set(event.pointerId, p);
      settling = false; touched = true; setReady(true);
      if (points.size === 1) gesture = { start: p, previous: p, node: hitNode(nodes, camera, p), moved: false };
      else if (gesture) { gesture.moved = true; gesture.node = undefined; }
      hoverNode(); schedule();
    }
    function move(event: PointerEvent) {
      const p = point(event);
      if (!points.has(event.pointerId) || !gesture) { hoverNode(hitNode(nodes, camera, p)); return; }
      const before = [...points.values()]; points.set(event.pointerId, p);
      if (points.size > 1) {
        const after = [...points.values()];
        const center = (pair: Point[]) => ({ x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 });
        const a = center(before), b = center(after);
        const distance = (pair: Point[]) => Math.max(1, Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y));
        const next = zoomAt(camera, camera.k * distance(after) / distance(before), a);
        updateCamera({ ...next, x: next.x + b.x - a.x, y: next.y + b.y - a.y });
      } else {
        if (Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > 4) gesture.moved = true;
        if (gesture.moved && gesture.node) {
          const world = toWorld(camera, p);
          gesture.node.x = gesture.node.fx = world.x; gesture.node.y = gesture.node.fy = world.y;
          remember(); schedule();
        } else if (gesture.moved) updateCamera({ ...camera, x: camera.x + p.x - gesture.previous.x, y: camera.y + p.y - gesture.previous.y });
      }
      gesture.previous = p;
    }
    function end(event: PointerEvent) {
      if (!points.has(event.pointerId)) return;
      points.delete(event.pointerId);
      if (event.type === "pointerup" && gesture?.node && !gesture.moved) choose(gesture.node.id);
      if (!points.size) gesture = null;
      else if (gesture) { gesture.previous = [...points.values()][0]; gesture.start = gesture.previous; gesture.moved = true; gesture.node = undefined; }
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      hoverNode(); schedule();
    }
    function wheel(event: WheelEvent) {
      event.preventDefault(); touched = true;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
      updateCamera(zoomAt(camera, camera.k * Math.exp(-Math.max(-150, Math.min(150, delta)) * .004), point(event)));
    }
    function doubleClick(event: MouseEvent) { const node = hitNode(nodes, camera, point(event)); if (node) open(node.id); }
    function command(command: Command) {
      touched = true;
      if (command === "fit") updateCamera(fitGraph(nodes, width, height));
      else if (command === "release") {
        for (const node of nodes) { node.fx = null; node.fy = null; }
        simulation.alpha(.6); settling = true; touched = false; setReady(false); schedule();
      } else updateCamera(zoomAt(camera, camera.k * (command === "in" ? 1.25 : .8), { x: width / 2, y: height / 2 }));
    }
    function key(event: KeyboardEvent) {
      if (["+", "=", "-", "0"].includes(event.key)) { event.preventDefault(); command(event.key === "0" ? "fit" : event.key === "-" ? "out" : "in"); }
      else if (event.key.startsWith("Arrow")) {
        event.preventDefault(); touched = true;
        updateCamera({ ...camera, x: camera.x + (event.key === "ArrowLeft" ? 40 : event.key === "ArrowRight" ? -40 : 0), y: camera.y + (event.key === "ArrowUp" ? 40 : event.key === "ArrowDown" ? -40 : 0) });
      } else if (event.key === "Enter" && selectedId) open(selectedId);
    }
    const leave = () => { if (!gesture) hoverNode(); };
    const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else schedule(); };
    controller.current = { command, select(id, center = false) {
      selectedId = id; const node = nodes.find((node) => node.id === id);
      if (center && node) { touched = true; updateCamera({ ...camera, x: width / 2 - node.x * camera.k, y: height / 2 - node.y * camera.k }); }
      schedule();
    }, activate(value) { enabled = value; if (!value) { cancelAnimationFrame(frame); frame = 0; } else { resize(); schedule(); } } };
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    const theme = new MutationObserver(palette); theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
    palette(); resize();
    canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end); canvas.addEventListener("lostpointercapture", end);
    canvas.addEventListener("pointerleave", leave); canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("dblclick", doubleClick); canvas.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", visibility); motion.addEventListener("change", schedule);
    return () => {
      disposed = true; remember();
      if (initialized) cameraMemory.current = camera;
      simulation.stop(); cancelAnimationFrame(frame);
      observer.disconnect(); theme.disconnect(); controller.current = null;
      for (const id of points.keys()) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
      canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", end); canvas.removeEventListener("pointercancel", end); canvas.removeEventListener("lostpointercapture", end);
      canvas.removeEventListener("pointerleave", leave); canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("dblclick", doubleClick); canvas.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", visibility); motion.removeEventListener("change", schedule);
    };
  }, [data, choose, open]);

  useEffect(() => controller.current?.select(selected), [selected, data, choose, open]);
  useEffect(() => controller.current?.activate(active), [active, data, choose, open]);

  return <div className={styles.graph} data-ready={ready} role="group" aria-label={t("obsidian.graph")}>
    <div className={styles.bar}>
      <label className={styles.locate}><span>{t("obsidian.locate")}</span><select value={data.nodes.some((node) => node.id === selected) ? selected : ""} onChange={(event) => {
        if (event.target.value) { choose(event.target.value); controller.current?.select(event.target.value, true); }
      }}><option value="">{t("obsidian.chooseNode")}</option>{data.nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}</select></label>
      <div className={styles.actions}>
        <button type="button" aria-label={t("obsidian.zoomOut")} title={t("obsidian.zoomOut")} onClick={() => controller.current?.command("out")}>−</button>
        <output aria-label={t("obsidian.zoom")}>{scale}%</output>
        <button type="button" aria-label={t("obsidian.zoomIn")} title={t("obsidian.zoomIn")} onClick={() => controller.current?.command("in")}>+</button>
        <button type="button" onClick={() => controller.current?.command("fit")}>{t("obsidian.fit")}</button>
        <button type="button" onClick={() => controller.current?.command("release")}>{t("obsidian.relayout")}</button>
      </div>
    </div>
    <div className={styles.surface}>
      <canvas ref={canvasRef} tabIndex={0} aria-label={t("obsidian.canvas")} aria-describedby={descriptionId} />
      {!ready && <p className={styles.loading} role="status">{t("obsidian.arranging")}</p>}
      {failed && <p className={styles.loading} role="alert">{t("obsidian.canvasFailed")}</p>}
      {!data.nodes.length && <p className={styles.loading}>{t("obsidian.noMatches")}</p>}
      {hover && <div className={styles.hover} role="status"><strong>{hover.title}</strong><span>{hover.id}</span><small>{t("obsidian.degree", { count: hover.degree })}</small></div>}
      <div className={styles.legend}>{[...new Set(data.nodes.map((node) => node.folder))].sort().map((folder) => <span key={folder}><i style={{ background: `var(--todo-${folderTone(folder)})` }} />{folder || t("obsidian.root")}</span>)}</div>
    </div>
    <div className={styles.footer}><span id={descriptionId}>{t("obsidian.gestures")}</span><span>{t("obsidian.graphCount", { count: data.nodes.length, links: data.edges.length })}</span></div>
    {data.edges.length < data.totalEdges && <p className={styles.limit} role="status">{t("obsidian.edgeLimit")}</p>}
  </div>;
}
