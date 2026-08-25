"use client";

import { useRef, useState } from "react";
import type { PaneControl } from "./usePaneWidths";

interface Props extends PaneControl {
  /**
   * Which side of the divider the pane it resizes is on. Dragging right makes a
   * left-hand pane wider and a right-hand one narrower.
   */
  edge: "left" | "right";
  label: string;
  /** Shown on hover: how to put it back. */
  title: string;
}

/** How far one arrow key moves the divider. */
const KEY_STEP = 16;

/**
 * The draggable seam between two panes.
 *
 * Pointer capture is the whole trick. The middle pane is a cross-origin
 * iframe, and a plain mousemove listener stops receiving events the instant
 * the cursor crosses into it — the frame's document swallows them and the
 * divider sticks halfway. Capturing the pointer on pointerdown routes every
 * subsequent event back here regardless of what it is over, which is also why
 * this does not need a full-screen overlay while dragging.
 *
 * It is a real separator, not a decoration: focusable, arrow-key adjustable,
 * and double-clickable back to its default, so the layout is reachable without
 * a mouse.
 */
export function PaneDivider({
  edge,
  label,
  title,
  width,
  min,
  max,
  onResize,
  onCommit,
  onReset,
}: Props) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const move = (clientX: number) => {
    if (!start.current) return;
    const dx = clientX - start.current.x;
    onResize(start.current.width + (edge === "left" ? dx : -dx));
  };

  const stop = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onCommit();
  };

  const nudge = (direction: -1 | 1) => {
    onResize(width + direction * KEY_STEP * (edge === "left" ? 1 : -1));
    onCommit();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={title}
      onPointerDown={(event) => {
        // Only the primary button drags; a right-click here should do nothing
        // rather than leave the divider stuck to the cursor.
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, width };
        setDragging(true);
      }}
      onPointerMove={(event) => move(event.clientX)}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        nudge(event.key === "ArrowRight" ? 1 : -1);
      }}
      className="pane-divider"
      data-dragging={dragging ? "true" : undefined}
      style={{
        flex: "0 0 5px",
        width: 5,
        cursor: "col-resize",
        position: "relative",
        // Without this a touch drag scrolls the page instead of moving the seam.
        touchAction: "none",
        // The panes on either side dropped their border for this; the seam is
        // the line now, so it has to keep looking like one when it is idle.
        background: "transparent",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 2,
          width: 1,
          background: dragging ? "var(--accent)" : "var(--border)",
        }}
      />
    </div>
  );
}
