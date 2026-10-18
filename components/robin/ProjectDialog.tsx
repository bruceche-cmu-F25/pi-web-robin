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
  const [name, setName] = useState(project?.name ?? "");
  const [brief, setBrief] = useState(project?.brief ?? "");
  const [objective, setObjective] = useState("");
  const [links, setLinks] = useState(project ? formatLinks(project.links) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (inline) return;
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [inline]);
  async function save(patch?: { archived: boolean }) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = project
        ? await researchRequest<{ project: ResearchProject }>("/api/research/projects", researchJson("PATCH", { id: project.id, patch: patch ?? { name, brief, links: parseLinks(links) } }))
        : await researchRequest<{ project: ResearchProject }>("/api/research/projects", researchJson("POST", { name, brief, objective, links: parseLinks(links) }));
      onSaved(result.project);
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("rw.error")); }
    finally { setBusy(false); }
  }
  const form = <form className={s.projectForm} onSubmit={(event) => { event.preventDefault(); void save(); }}>
    {inline ? <header><h2>{t("rw.setup.title")}</h2><p>{t("rw.setup.hint")}</p></header>
      : <h2 id="research-project-dialog">{t(project ? "rw.project.edit" : "rw.project.new")}</h2>}
    <label className={s.field}>{t("rw.project.name")}
      <input required value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder={t("rw.project.namePlaceholder")} autoFocus />
    </label>
    <label className={s.field}>{t("rw.project.brief")}
      <textarea value={brief} maxLength={20_000} rows={5} onChange={(event) => setBrief(event.target.value)} placeholder={t("rw.project.briefPlaceholder")} />
      <small>{t("rw.project.briefHint")}</small>
    </label>
    {!project && <label className={s.field}>{t("rw.focus")}
      <textarea value={objective} maxLength={10_000} rows={2} onChange={(event) => setObjective(event.target.value)} placeholder={t("rw.focusPlaceholder")} />
    </label>}
    <label className={s.field}>{t("rw.project.links")}
      <textarea value={links} rows={3} onChange={(event) => setLinks(event.target.value)} placeholder={"Repository | https://github.com/…\nShared drive | https://drive.google.com/…"} />
      <small>{t("rw.project.linksHint")}</small>
    </label>
    {error && <p role="alert" className={s.error}>{error}</p>}
    <div className={s.formActions}>
      {project && <button type="button" className={s.textButton} disabled={busy} onClick={() => void save({ archived: !project.archived })}>{t(project.archived ? "rw.project.restore" : "rw.project.archive")}</button>}
      <span />
      {onClose && <button type="button" className={s.button} disabled={busy} onClick={onClose}>{t("rw.cancel")}</button>}
      <button className={`${s.button} ${s.primary}`} disabled={busy || !name.trim()}>{t(project ? "rw.save" : "rw.project.create")}</button>
    </div>
  </form>;
  if (inline) return <section className={s.setup}>{form}</section>;
  return <dialog ref={dialog} className={s.projectDialog} aria-labelledby="research-project-dialog" onCancel={(event) => { event.preventDefault(); onClose?.(); }}>{form}</dialog>;
}
