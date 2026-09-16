"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { stackMarginCards, type MarginItem, type OutlineEntry } from "./note-margin";
import styles from "./NotesWorkspace.module.css";

/** Where the editor's lines are, so margin notes can sit level with them. */
export interface EditorGeometry {
  /** Top of each line's first row, in px from the textarea's content top. */
  lineTops: number[];
  lineHeight: number;
  paddingTop: number;
  scrollTop: number;
  clientHeight: number;
  /** The textarea's top, relative to the margin column's top. */
  offsetTop: number;
}

/**
 * Measure line positions through an off-screen mirror of the textarea: same
 * width, font and wrapping, one block per line. A textarea cannot report
 * where its lines are, and soft-wrapped lines make "index × line height"
 * wrong for everything below the first long one.
 */
export function useEditorGeometry(
  editorRef: RefObject<HTMLTextAreaElement | null>,
  anchorRef: RefObject<HTMLElement | null>,
  text: string,
  enabled: boolean,
): EditorGeometry | null {
  const [geometry, setGeometry] = useState<EditorGeometry | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const frame = useRef(0);

  const measure = useCallback(() => {
    const editor = editorRef.current;
    const anchor = anchorRef.current;
    if (!enabled || !editor || !anchor) {
      setGeometry(null);
      return;
    }
    const style = window.getComputedStyle(editor);
    let mirror = mirrorRef.current;
    if (!mirror) {
      mirror = document.createElement("div");
      mirror.setAttribute("aria-hidden", "true");
      Object.assign(mirror.style, { position: "absolute", top: "0", left: "-10000px", visibility: "hidden", whiteSpace: "pre-wrap" });
      document.body.append(mirror);
      mirrorRef.current = mirror;
    }
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    Object.assign(mirror.style, {
      width: `${Math.max(0, editor.clientWidth - paddingLeft - paddingRight)}px`,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      tabSize: style.tabSize,
      overflowWrap: style.overflowWrap || "break-word",
      wordBreak: style.wordBreak,
    });
    mirror.replaceChildren(...editor.value.split("\n").map((line) => {
      const row = document.createElement("div");
      row.textContent = line || "​";
      return row;
    }));
    setGeometry({
      lineTops: Array.from(mirror.children, (row) => (row as HTMLElement).offsetTop),
      lineHeight: parseFloat(style.lineHeight) || 26,
      paddingTop: parseFloat(style.paddingTop) || 0,
      scrollTop: editor.scrollTop,
      clientHeight: editor.clientHeight,
      offsetTop: editor.getBoundingClientRect().top - anchor.getBoundingClientRect().top,
    });
  }, [anchorRef, editorRef, enabled]);

  const schedule = useCallback(() => {
    window.cancelAnimationFrame(frame.current);
    frame.current = window.requestAnimationFrame(measure);
  }, [measure]);

  useLayoutEffect(() => { schedule(); }, [schedule, text]);

  useEffect(() => {
    const editor = editorRef.current;
    const anchor = anchorRef.current;
    if (!enabled || !editor || !anchor) return;
    // Scrolling moves every line by the same amount: no need to re-measure.
    const onScroll = () => setGeometry((current) => current && { ...current, scrollTop: editor.scrollTop });
    editor.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(editor);
    observer.observe(anchor);
    return () => {
      editor.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [anchorRef, editorRef, enabled, schedule]);

  useEffect(() => () => {
    window.cancelAnimationFrame(frame.current);
    mirrorRef.current?.remove();
    mirrorRef.current = null;
  }, []);

  return geometry;
}

export function NoteOutline({ outline, active, onJump, title, emptyHint, stats }: {
  outline: OutlineEntry[];
  active: number;
  onJump: (entry: OutlineEntry, index: number) => void;
  title: string;
  emptyHint: string;
  stats: string[];
}) {
  return (
    <nav className={styles.outline} aria-label={title}>
      <h2 className="pi-eyebrow">{title}{outline.length ? <span className={styles.count}>{outline.length}</span> : null}</h2>
      {outline.length === 0 ? <p className={styles.marginHint}>{emptyHint}</p> : (
        <ol>
          {outline.map((entry, index) => (
            <li key={`${entry.line}-${entry.text}`} data-level={entry.level}>
              <button type="button" aria-current={index === active ? "location" : undefined} onClick={() => onJump(entry, index)}>
                <span>{entry.line + 1}</span>{entry.text}
              </button>
            </li>
          ))}
        </ol>
      )}
      {stats.length ? <p className={styles.marginStats}>{stats.map((line) => <span key={line}>{line}</span>)}</p> : null}
    </nav>
  );
}

export interface MarginLabels {
  question: string;
  todo: string;
  ask: string;
  addTodo: string;
  added: string;
}

const itemKey = (item: MarginItem) => `${item.kind}:${item.line}:${item.text}`;
/** Gap between the sheet and this column, plus how far into the sheet's padding the connector starts. */
const CONNECTOR_REACH = 64;

/**
 * Questions and open to-dos beside the note. While writing, each card sits
 * level with its line and a connector points back to it; in a preview the
 * lines are not where the text is, so the cards simply stack.
 */
export function MarginNotes({ items, geometry, labels, added, disabled, onAsk, onAddTodo }: {
  items: MarginItem[];
  geometry: EditorGeometry | null;
  labels: MarginLabels;
  added: ReadonlySet<string>;
  disabled: boolean;
  onAsk: (item: MarginItem) => void;
  onAddTodo: (item: MarginItem) => void;
}) {
  const [heights, setHeights] = useState<Record<string, number>>({});
  const cards = useRef(new Map<string, HTMLElement>());

  const visible = geometry
    ? items.flatMap((item) => {
      const top = geometry.lineTops[item.line];
      if (top === undefined) return [];
      const y = geometry.offsetTop + geometry.paddingTop + top + geometry.lineHeight / 2 - geometry.scrollTop;
      return y < geometry.offsetTop || y > geometry.offsetTop + geometry.clientHeight ? [] : [{ item, y }];
    })
    : [];
  const tops = stackMarginCards(visible.map(({ item, y }) => ({ y, height: heights[itemKey(item)] ?? 78 })));

  // Heights are read after layout; a card's text or its neighbours moving can change them.
  useLayoutEffect(() => {
    setHeights((current) => {
      let changed = false;
      const next: Record<string, number> = {};
      for (const [key, node] of cards.current) {
        next[key] = node.offsetHeight;
        if (current[key] !== node.offsetHeight) changed = true;
      }
      return changed ? next : current;
    });
  }, [items, geometry]);

  const card = (item: MarginItem, style?: CSSProperties) => {
    const key = itemKey(item);
    const done = item.kind === "todo" && added.has(item.text);
    return (
      <article
        key={key}
        ref={(node) => { if (node) cards.current.set(key, node); else cards.current.delete(key); }}
        className={styles.marginCard}
        data-kind={item.kind}
        style={style}
      >
        <span className={styles.marginKind}>{item.kind === "question" ? labels.question : labels.todo}</span>
        <p>{item.text}</p>
        {done ? <span className={styles.marginDone}>✓ {labels.added}</span> : (
          <button
            type="button"
            className="ui-action pi-chrome-label pi-bracket"
            disabled={disabled}
            onClick={() => (item.kind === "question" ? onAsk(item) : onAddTodo(item))}
          >
            {item.kind === "question" ? labels.ask : labels.addTodo}
          </button>
        )}
      </article>
    );
  };

  if (!geometry) {
    return <div className={styles.marginStack}>{items.map((item) => card(item))}</div>;
  }

  return (
    <>
      <svg className={styles.marginConnectors} aria-hidden="true" style={{ left: -CONNECTOR_REACH }}>
        {visible.map(({ item, y }, index) => {
          const middle = tops[index] + (heights[itemKey(item)] ?? 78) / 2;
          const bend = CONNECTOR_REACH + 5;
          return (
            <g key={itemKey(item)} data-kind={item.kind}>
              <rect x={0} y={y - 2.5} width={5} height={5} />
              <path d={`M 5 ${y} H ${bend} V ${Math.min(Math.max(y, tops[index] + 8), middle)} H ${CONNECTOR_REACH + 12}`} />
            </g>
          );
        })}
      </svg>
      {visible.map(({ item }, index) => card(item, { position: "absolute", top: tops[index], left: 12 }))}
    </>
  );
}
