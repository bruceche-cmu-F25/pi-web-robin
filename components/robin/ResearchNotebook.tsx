"use client";

import { useCallback, useId, useRef, useState } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import { researchHeadingTree, type ResearchHeading } from "./research-outline";
import s from "./ResearchWorkspace.module.css";

const headingsIn = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"));

/** Index the actual Markdown rendering: fences, Setext headings and duplicate titles stay correct. */
export function ResearchNotebook({ markdown }: { markdown: string }) {
  const { t } = useI18n();
  const branchId = useId();
  const content = useRef<HTMLDivElement | null>(null);
  const [outline, setOutline] = useState<{ source: string; tree: ResearchHeading[]; count: number }>({ source: "", tree: [], count: 0 });
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const [active, setActive] = useState<number | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => {
    content.current = node;
    if (!node) return;
    const headings = headingsIn(node).map(heading => ({ level: Number(heading.tagName[1]), title: heading.textContent?.trim() || "—" }));
    setOutline({ source: markdown, tree: researchHeadingTree(headings), count: headings.length });
    setCollapsed(new Set());
    setActive(null);
  }, [markdown]);

  function jump(index: number) {
    const heading = content.current && headingsIn(content.current)[index];
    if (!heading) return;
    // A heading can belong to a Markdown <details>; reveal it before focusing it.
    for (let parent = heading.parentElement; parent && parent !== content.current; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    heading.tabIndex = -1;
    heading.scrollIntoView({ block: "start", behavior: "instant" });
    heading.focus({ preventScroll: true });
    setActive(index);
  }

  function branches(nodes: ResearchHeading[]) {
    return nodes.map(node => <li key={node.index}>
      <div className={s.outlineRow}>
        {node.children.length ? <button type="button" className={s.outlineToggle} aria-label={t(collapsed.has(node.index) ? "rw.outline.expand" : "rw.outline.collapse", { title: node.title })}
          aria-expanded={!collapsed.has(node.index)} aria-controls={`${branchId}-${node.index}`} onClick={() => setCollapsed(current => { const next = new Set(current); if (next.has(node.index)) next.delete(node.index); else next.add(node.index); return next; })}>
          <span aria-hidden="true">{collapsed.has(node.index) ? "+" : "−"}</span>
        </button> : <span className={s.outlineLeaf} aria-hidden="true">·</span>}
        <button type="button" className={s.outlineLink} aria-current={active === node.index ? "location" : undefined} onClick={() => jump(node.index)}>{node.title}</button>
      </div>
      {!!node.children.length && <ul id={`${branchId}-${node.index}`} hidden={collapsed.has(node.index)}>{branches(node.children)}</ul>}
    </li>);
  }

  return <div className={s.notebookReading}>
    <nav className={s.notebookOutline} aria-label={t("rw.outline.title")}>
      <details open>
        <summary>{t("rw.outline.title")}<span>{outline.source === markdown ? outline.count : 0}</span></summary>
        {outline.source === markdown && outline.tree.length ? <ul>{branches(outline.tree)}</ul> : <p>{t("rw.outline.empty")}</p>}
      </details>
    </nav>
    <div ref={attach} className={`${s.prose} ${s.noteView}`} tabIndex={0} role="region" aria-label={t("rw.notebook")}><MarkdownBody>{markdown}</MarkdownBody></div>
  </div>;
}
