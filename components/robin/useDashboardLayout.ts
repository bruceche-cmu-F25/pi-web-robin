"use client";

import { useLayoutEffect, useRef } from "react";

/** Independent vertical lanes, retaining the existing DOM/focus order.
 * Native CSS grid still owns widths; measured row placement avoids shared-row gaps.
 */
export function dashboardPositions(columns: 2 | 3, cards: { id: string; height: number }[], gap: number) {
  const bottoms = Array(columns).fill(0) as number[];
  return cards.map(({ id, height }) => {
    const side = id === "dashboard-todos" || id === "dashboard-links";
    const span = side ? 1 : columns === 3 || id === "calendar" ? 2 : 1;
    const column = side ? columns - 1 : 0;
    const top = Math.max(...bottoms.slice(column, column + span));
    const size = Math.max(1, Math.ceil(height));
    for (let lane = column; lane < column + span; lane++) bottoms[lane] = top + size + gap;
    return { column: `${column + 1} / span ${span}`, top, bottom: top + size };
  });
}

export function useDashboardLayout() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    const cards = Array.from(grid.children) as HTMLElement[];
    let frame = 0;
    const clear = () => {
      delete grid.dataset.packed;
      grid.style.removeProperty("grid-template-rows");
      for (const card of cards) { card.style.removeProperty("grid-column"); card.style.removeProperty("grid-row"); }
    };
    const layout = () => {
      const css = getComputedStyle(grid);
      // Old placements can temporarily create implicit tracks on shrink.
      // The CSS breakpoint, not computed track count, is the source of truth.
      const columns = Number(css.getPropertyValue("--dashboard-columns"));
      if (columns !== 2 && columns !== 3) { clear(); return; }
      const gap = Math.ceil(parseFloat(css.columnGap)) || 16;
      grid.dataset.packed = "true";
      // Empty panels stay mounted for polling/state, but consume no space or gutter.
      const visible = cards.filter((card) => getComputedStyle(card).display !== "none");
      // Set widths before measuring: a resize can change wrapping in every card.
      const placement = dashboardPositions(columns, visible.map((card) => ({ id: card.id || "calendar", height: 1 })), gap);
      visible.forEach((card, index) => { card.style.gridColumn = placement[index].column; });
      const positions = dashboardPositions(columns, visible.map((card) => ({ id: card.id || "calendar", height: card.getBoundingClientRect().height })), gap);
      // Only card edges become grid lines, not one track per pixel.
      // Even very long lists cannot hit the browser's implicit-track limit.
      const edges = [...new Set(positions.flatMap(({ top, bottom }) => [top, bottom]))].sort((a, b) => a - b);
      grid.style.gridTemplateRows = edges.slice(1).map((edge, index) => `${edge - edges[index]}px`).join(" ");
      visible.forEach((card, index) => {
        const { top, bottom } = positions[index];
        const row = `${edges.indexOf(top) + 1} / ${edges.indexOf(bottom) + 1}`;
        if (card.style.gridRow !== row) card.style.gridRow = row;
      });
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    });
    observer.observe(grid);
    cards.forEach((card) => observer.observe(card));
    layout();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); clear(); };
  }, []);
  return ref;
}
