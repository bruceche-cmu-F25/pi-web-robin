"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ResearchLink, ResearchProject } from "@/extension/robin/research-domain";
import { researchJson, researchRequest, type ProjectSummary } from "./research-client";
import s from "./ResearchWorkspace.module.css";

/** One link per line: "Title | https://…" or a bare URL. */
export function parseLinks(text: string): ResearchLink[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const split = line.lastIndexOf("|");
    const url = (split >= 0 ? line.slice(split + 1) : line.match(/https?:\/\/\S+/)?.[0] ?? line).trim();
    const title = (split >= 0 ? line.slice(0, split) : line.replace(url, "")).trim().replace(/[:：\-–—]\s*$/, "").trim();
    return { title, url };
  });
}
const formatLinks = (links: ResearchLink[]) => links.map((link) => `${link.title} | ${link.url}`).join("\n");

/** Create a project, or edit its brief and links. The brief is what the agent reads to judge relevance. */
export function ProjectDialog({ project, onClose, onSaved, inline = false }: {
  project?: ProjectSummary; onClose?: () => void; onSaved: (project: ResearchProject) => void; inline?: boolean;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const saving = useRef(false);
  const [initial] = useState(() => ({ name: project?.name ?? "", brief: project?.brief ?? "", links: project ? formatLinks(project.links) : "" }));
  const [name, setName] = useState(initial.name);
  const [brief, setBrief] = useState(initial.brief);
  const [objective, setObjective] = useState("");
  const [links, setLinks] = useState(initial.links);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = name !== initial.name || brief !== initial.brief || links !== initial.links || (!project && objective !== "");
  useEffect(() => {
    if (inline) return;
    const element = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Choose the native dialog's initial focus before opening; focusing then blurring
    // an input is too late to prevent the phone keyboard from appearing.
    const touch = window.matchMedia("(max-width: 760px), (any-pointer: coarse)").matches;
    const target = touch ? heading.current : element?.querySelector("input");
    target?.setAttribute("autofocus", "");
    element?.showModal();
    return () => {
      element?.close(); target?.removeAttribute("autofocus");
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [inline]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  const mayDiscard = () => !dirty || window.confirm(t("rw.project.discardConfirm"));
  const close = () => { if (!saving.current && mayDiscard()) onClose?.(); };
  async function save(patch?: { archived: boolean }) {
    if (saving.current || (patch && !mayDiscard())) return;
    saving.current = true;
    setBusy(true); setError("");
    try {
      const result = project
        ? await researchRequest<{ project: ResearchProject }>("/api/research/projects", researchJson("PATCH", { id: project.id, patch: patch ?? { name, brief, links: parseLinks(links) } }))
        : await researchRequest<{ project: ResearchProject }>("/api/research/projects", researchJson("POST", { name, brief, objective, links: parseLinks(links) }));
      onSaved(result.project);
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("rw.error")); }
    finally { saving.current = false; setBusy(false); }
  }
  const form = <form className={s.projectForm} aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void save(); }}>
    {inline ? <header><h2>{t("rw.setup.title")}</h2><p>{t("rw.setup.hint")}</p></header>
      : <h2 ref={heading} tabIndex={-1} id="research-project-dialog">{t(project ? "rw.project.edit" : "rw.project.new")}</h2>}
    <label className={s.field}>{t("rw.project.name")}
      <input required readOnly={busy} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder={t("rw.project.namePlaceholder")} />
    </label>
    <label className={s.field}>{t("rw.project.brief")}
      <textarea readOnly={busy} value={brief} maxLength={20_000} rows={5} onChange={(event) => setBrief(event.target.value)} placeholder={t("rw.project.briefPlaceholder")} />
      <small>{t("rw.project.briefHint")}</small>
    </label>
    {!project && <label className={s.field}>{t("rw.focus")}
      <textarea readOnly={busy} value={objective} maxLength={10_000} rows={2} onChange={(event) => setObjective(event.target.value)} placeholder={t("rw.focusPlaceholder")} />
    </label>}
    <label className={s.field}>{t("rw.project.links")}
      <textarea readOnly={busy} value={links} rows={3} onChange={(event) => setLinks(event.target.value)} placeholder={"Repository | https://github.com/…\nShared drive | https://drive.google.com/…"} />
      <small>{t("rw.project.linksHint")}</small>
    </label>
    {busy && <p role="status">{t("rw.project.savingHint")}</p>}
    {error && <p role="alert" className={s.error}>{error}</p>}
    <div className={s.formActions}>
      {project && <button type="button" className={s.textButton} disabled={busy} onClick={() => void save({ archived: !project.archived })}>{t(project.archived ? "rw.project.restore" : "rw.project.archive")}</button>}
      <span />
      {onClose && <button type="button" className={s.button} disabled={busy} onClick={close}>{t("rw.cancel")}</button>}
      <button className={`${s.button} ${s.primary}`} disabled={busy || !name.trim()}>{t(busy ? "rw.saving" : project ? "rw.save" : "rw.project.create")}</button>
    </div>
  </form>;
  if (inline) return <section className={s.setup}>{form}</section>;
  return <dialog ref={dialog} className={s.projectDialog} aria-labelledby="research-project-dialog"
    onKeyDown={(event) => {
      // Repeated native close-watcher requests can become non-cancelable.
      // Handle Escape before that default so a rejected discard remains rejected.
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    }}
    onCancel={(event) => { event.preventDefault(); close(); }}>{form}</dialog>;
}
