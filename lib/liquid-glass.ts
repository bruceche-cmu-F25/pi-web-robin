import { createGlassMap } from "./liquid-glass-map";

// Structural surfaces only. Never capture/re-render page content or filter its
// foreground. The browser samples the actual backdrop behind each surface.
const surfaces = [
  ".robin-navigation-container", ".sidebar-container", ".pi-topbar",
  ".robin-dashboard-header .robin-assistant-bar", ".robin-mobile-nav-trigger",
  ".robin-dashboard-toolbar", ".robin-dashboard-dock", ".robin-workspace-tabs",
  ".settings-dialog-surface", ".config-panel-root.is-modal > .config-panel-surface",
  ".chat-input-surface:not(.is-compact)", ".robin-command-dialog",
  ".pi-topbar-panel", "[data-session-search-bar]", ".terminal-panel-header", ".workspace-panel-header",
].join(",");
const namespace = "http://www.w3.org/2000/svg";
let nextId = 0;

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>) {
  const element = document.createElementNS(namespace, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

/** Active only in Glass + Chromium. The caller owns theme/preference gating. */
export function startLiquidGlass() {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return () => {};
  const svg = svgElement("svg", { width: 0, height: 0, "aria-hidden": "true", focusable: "false", "data-liquid-glass-defs": "" });
  svg.style.cssText = "position:fixed;pointer-events:none;overflow:hidden";
  const defs = svgElement("defs", {});
  svg.append(defs);
  document.body.append(svg);
  type Surface = { key: string; filter?: SVGFilterElement; pending?: SVGFilterElement };
  const entries = new Map<HTMLElement, Surface>();
  const dirty = new Set<HTMLElement>();
  let frame = 0, resizeTimer = 0, stopped = false;

  function clear(element: HTMLElement, entry: Surface) {
    element.removeAttribute("data-glass-refraction");
    element.style.removeProperty("--glass-refraction");
    entry.pending?.remove();
    entry.filter?.remove();
    entry.pending = entry.filter = undefined;
    entry.key = "";
  }
  function paint(element: HTMLElement, entry: Surface) {
    // Closed drawers retain layout dimensions while off-screen. No maps for
    // those, hidden tabs, or another material nested in a filtered sidebar.
    if (!element.isConnected || !element.matches(surfaces) || element.closest("[hidden], [inert], .right-panel-closed") ||
        element.parentElement?.closest(surfaces) || !element.getClientRects().length) {
      clear(element, entry);
      return;
    }
    const width = element.offsetWidth, height = element.offsetHeight;
    if (width < 4 || height < 4) { clear(element, entry); return; }
    const style = getComputedStyle(element);
    const radius = Math.min(parseFloat(style.borderTopLeftRadius) || 0, width / 2, height / 2);
    const frosted = style.getPropertyValue("--glass-material").trim() === "frost";
    const key = `${width}:${height}:${radius}:${frosted}`;
    if (entry.key === key) return;
    entry.pending?.remove();
    entry.key = key;
    try {
      const map = createGlassMap(width, height, radius);
      canvas.width = map.width;
      canvas.height = map.height;
      const pixels = context!.createImageData(map.width, map.height);
      pixels.data.set(map.data);
      context!.putImageData(pixels, 0, 0);
      const id = `pi-liquid-glass-${++nextId}`;
      // Explicit pixel units avoid stretching a circular map over a long pill.
      // Extra bounds retain the source pixels sampled by the bevel and blur.
      const filter = svgElement("filter", { id, filterUnits: "userSpaceOnUse", primitiveUnits: "userSpaceOnUse", x: -32, y: -32, width: width + 64, height: height + 64, "color-interpolation-filters": "sRGB" });
      const image = svgElement("feImage", { x: 0, y: 0, width, height, preserveAspectRatio: "none", result: "lens" });
      filter.append(
        svgElement("feGaussianBlur", { in: "SourceGraphic", stdDeviation: frosted ? 10 : 0.7, result: "soft" }),
        image,
      );
      // The study's subtle dispersion belongs on small clear controls, not
      // reading panels. Cap three-pass work when a composer grows multiline.
      if (!frosted && height <= 120 && width * height <= 160_000) {
        for (let channel = 0; channel < 3; channel++) {
          filter.append(svgElement("feDisplacementMap", { in: "soft", in2: "lens", scale: map.scale * [1.035, 1, 0.965][channel], xChannelSelector: "R", yChannelSelector: "G", result: `sample${channel}` }));
          const matrix = new Array<number>(20).fill(0);
          matrix[channel * 6] = 1;
          matrix[18] = 1;
          filter.append(svgElement("feColorMatrix", { in: `sample${channel}`, type: "matrix", values: matrix.join(" "), result: `channel${channel}` }));
        }
        filter.append(
          svgElement("feBlend", { in: "channel0", in2: "channel1", mode: "screen", result: "redgreen" }),
          svgElement("feBlend", { in: "redgreen", in2: "channel2", mode: "screen" }),
        );
      } else {
        filter.append(svgElement("feDisplacementMap", { in: "soft", in2: "lens", scale: map.scale * (frosted ? 0.55 : 1), xChannelSelector: "R", yChannelSelector: "G" }));
      }
      entry.pending = filter;
      // Pre-decode the tiny PNG before switching from CSS frost / the old map.
      // feImage itself does not reliably dispatch a load event in Chromium.
      const decoded = new Image();
      const source = canvas.toDataURL();
      image.setAttribute("href", source);
      defs.append(filter);
      decoded.src = source;
      void decoded.decode().then(() => {
        if (stopped || !element.isConnected || entry.pending !== filter) return;
        const old = entry.filter;
        element.style.setProperty("--glass-refraction", `url("#${id}")`);
        element.setAttribute("data-glass-refraction", id);
        entry.filter = filter;
        entry.pending = undefined;
        old?.remove();
      }).catch(() => {
        if (entry.pending === filter) clear(element, entry);
      });
    } catch {
      // Canvas restrictions or allocation failure must never hide controls.
      clear(element, entry);
    }
  }
  function flush() {
    frame = 0;
    for (const [element, entry] of entries) {
      if (!element.isConnected || !element.matches(surfaces)) {
        clear(element, entry);
        resize.unobserve(element);
        entries.delete(element);
      }
    }
    for (const element of dirty) {
      const entry = entries.get(element);
      if (entry) paint(element, entry);
    }
    dirty.clear();
  }
  function schedule() { if (!frame && !stopped) frame = requestAnimationFrame(flush); }
  const resize = new ResizeObserver(records => {
    for (const record of records) dirty.add(record.target as HTMLElement);
    // Rebuild after geometry settles, not on each frame of a sidebar resize.
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(schedule, 100);
  });
  function discover(root: HTMLElement) {
    const found = [...root.querySelectorAll<HTMLElement>(surfaces)];
    if (root.matches(surfaces)) found.push(root);
    for (const element of found) {
      if (!entries.has(element)) {
        entries.set(element, { key: "" });
        resize.observe(element);
      }
      dirty.add(element);
    }
    if (found.length) schedule();
  }
  discover(document.body);
  const tree = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") {
        const element = record.target as HTMLElement;
        if (entries.has(element) || element.matches(surfaces)) {
          discover(element);
          dirty.add(element);
          schedule();
        } else if (element.matches(".config-panel-root, .right-panel-container")) { discover(element); schedule(); }
        if (record.attributeName === "hidden" || record.attributeName === "inert" || record.attributeName === "data-navigation-placement") {
          for (const surface of entries.keys()) if (element.contains(surface)) dirty.add(surface);
          if (dirty.size) schedule();
        }
      } else {
        // Streaming text nodes do not scan the whole document. Only inspect
        // newly mounted element subtrees; SVG map updates are ignored.
        for (const node of record.addedNodes) if (node instanceof HTMLElement) discover(node);
        if (record.removedNodes.length && [...entries.keys()].some(element => !element.isConnected)) schedule();
      }
    }
  });
  tree.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden", "inert", "data-navigation-placement"] });
  return () => {
    stopped = true;
    tree.disconnect();
    resize.disconnect();
    clearTimeout(resizeTimer);
    cancelAnimationFrame(frame);
    for (const [element, entry] of entries) clear(element, entry);
    entries.clear();
    dirty.clear();
    svg.remove();
  };
}
