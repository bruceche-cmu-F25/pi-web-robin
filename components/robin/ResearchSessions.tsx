"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ResearchSessionSummary } from "@/extension/robin/research-domain";
import type { ResearchThread } from "./useResearchThread";
import { researchHref, researchJson, researchRequest } from "./research-client";
import s from "./ResearchWorkspace.module.css";

export function ResearchSessions({ projectId, thread, paperId, paperTitles, onSelect, onOpenPaper }: {
  projectId: string; thread: ResearchThread; paperId?: string; paperTitles?: Map<string, string>;
  onSelect: (id: string) => void | Promise<void>; onOpenPaper?: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<"new" | "rename" | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = thread.state.conversation;
  const scope = useRef(""); scope.current = `${projectId}:${current?.id ?? ""}:${paperId ?? ""}`;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const sessions = (thread.state.sessions ?? []).filter((item) => !paperId || item.paperId === paperId);
  const label = (item?: ResearchSessionSummary) => item?.title || t(item?.kind === "history" ? "rw.sessions.history" : paperId ? "rw.sessions.reading" : "rw.sessions.discussion");
  const matches = sessions.filter((item) => !!item.archived === archived && `${label(item)} ${item.paperId ? paperTitles?.get(item.paperId) ?? "" : ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  async function select(id: string) {
    try { await onSelect(id); setExpanded(false); setEditing(null); setError(""); trigger.current?.focus({ preventScroll: true }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t("rw.error")); }
  }
  async function mutate(action: "save" | "archive") {
    if (busy || (action === "archive" && !current)) return;
    const origin = scope.current;
    setBusy(true); setError("");
    try {
      const isNew = action === "save" && editing === "new";
      const result = await researchRequest<{ conversation: ResearchSessionSummary }>("/api/research/sessions", researchJson(isNew ? "POST" : "PATCH", isNew
        ? { projectId, title, paperId: paperId ?? current?.paperId }
        : { projectId, id: current?.id, revision: current?.revision, patch: action === "archive" ? { archived: !current?.archived } : { title } }));
      if (!mounted.current || scope.current !== origin) return;
      setEditing(null);
      if (isNew) await select(result.conversation.id);
      else await thread.reload();
    } catch (failure) { if (mounted.current && scope.current === origin) setError(failure instanceof Error ? failure.message : t("rw.error")); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <section className={s.sessionManager} aria-label={t("rw.sessions.manage")}>
    <div className={s.sessionActions}>
      <button ref={trigger} type="button" className={s.button} aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)}>
        {t("rw.sessions.list")} · {sessions.filter((item) => !item.archived).length} {expanded ? "▴" : "▾"}
      </button>
      <button type="button" className={s.textButton} disabled={busy || !thread.ready} onClick={() => { setEditing("new"); setTitle(""); setError(""); }}>+ {t("rw.sessions.new")}</button>
    </div>
    <div className={s.sessionTitleRow}>
      <h2>{thread.ready ? label(current) : t("rw.loading")}</h2>
      {current?.archived && <span>{t("rw.sessions.archived")}</span>}
    </div>
    {(expanded || current?.archived || (current?.paperId && onOpenPaper)) && <div className={s.sessionActions}>
      {current?.paperId && onOpenPaper && <button type="button" className={s.textButton} onClick={() => onOpenPaper(current.paperId!)}>{t("rw.sessions.openPaper")} →</button>}
      {expanded && <button type="button" className={s.textButton} disabled={busy || !current} onClick={() => { setEditing("rename"); setTitle(label(current)); setError(""); }}>{t("rw.sessions.rename")}</button>}
      {(expanded || current?.archived) && <button type="button" className={s.textButton} disabled={busy || !current || thread.busy} onClick={() => void mutate("archive")}>{t(current?.archived ? "rw.sessions.restore" : "rw.sessions.archive")}</button>}
    </div>}
    {expanded && <div id={listId} className={s.sessionBrowser}>
      <div className={s.sessionSearch}>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t("rw.sessions.search")} placeholder={t("rw.sessions.search")} />
        <button type="button" className={s.button} aria-pressed={archived} onClick={() => setArchived(!archived)}>{t(archived ? "rw.sessions.active" : "rw.sessions.archived")}</button>
      </div>
      <ul className={s.sessionList}>
        {matches.map((item) => <li key={item.id}>
          <button type="button" className={s.sessionRow} disabled={busy} aria-current={item.id === current?.id ? "true" : undefined} onClick={() => void select(item.id)}>
            <strong>{label(item)}</strong>
            <span>{item.paperId && paperTitles?.get(item.paperId) && label(item) !== paperTitles.get(item.paperId) ? `${paperTitles.get(item.paperId)} · ` : ""}{thread.state.run?.conversationId === item.id ? t("rw.sessions.running") : item.archived ? t("rw.sessions.archived") : t("rw.sessions.messages", { count: item.messageCount })}
              {item.updatedAt && <> · <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></>}
            </span>
          </button>
        </li>)}
      </ul>
      {!matches.length && <p className={s.marginHint}>{t("rw.noMatch")}</p>}
    </div>}
    {editing && <form className={s.sessionForm} onSubmit={(event) => { event.preventDefault(); void mutate("save"); }}>
      <label className={s.field}>{t(editing === "new" ? "rw.sessions.newTitle" : "rw.sessions.rename")}
        <input value={title} maxLength={200} autoFocus onChange={(event) => setTitle(event.target.value)} disabled={busy} required />
      </label>
      <div className={s.sessionActions}>
        <button className={s.button} disabled={busy || !title.trim()}>{t(busy ? "rw.saving" : "rw.save")}</button>
        <button type="button" className={s.textButton} disabled={busy} onClick={() => setEditing(null)}>{t("rw.cancel")}</button>
      </div>
    </form>}
    {current?.archived && <p className={s.marginHint}>{t("rw.sessions.archivedHint")}</p>}
    {!thread.ready && thread.error && <a className={s.textButton} href={researchHref(projectId)}>{t("rw.sessions.discussion")} →</a>}
    {error && <p role="alert" className={s.error}>{error} <button className={s.textButton} onClick={() => void thread.reload().catch(() => {})}>{t("rw.retry")}</button></p>}
  </section>;
}
