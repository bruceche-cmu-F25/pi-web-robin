"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import type { Paper } from "@/extension/robin/papers-domain";
import { GENERAL, importPaperPdf, paperSummary, researchHref, researchRequest, type PaperSummary } from "./research-client";
import { useResearchThread } from "./useResearchThread";

const noFlush = async () => {};
export type SwitchResearchProject = (id: string | null, href?: string) => Promise<void>;

/** Home and project readers share selection/navigation rules, not their page layout or notebook. */
export function useResearchReader({ projectId, beforeAsk = noFlush, onProjectsChange, onSwitch }: {
  projectId: string; beforeAsk?: () => Promise<void>;
  onProjectsChange: () => Promise<void>; onSwitch: SwitchResearchProject;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("paper"), conversationId = params.get("conversation");
  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [loadedPaper, setPaper] = useState<Paper | null>(null);
  const paper = loadedPaper?.id === selected ? loadedPaper : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const scope = `${projectId}:${selected ?? ""}:${conversationId ?? ""}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  useEffect(() => { currentScope.current = scope; return () => { currentScope.current = ""; }; }, [scope]);
  const refresh = useCallback(() => { setReload((n) => n + 1); void onProjectsChange(); }, [onProjectsChange]);
  const accepted = useCallback((id: string, paperId?: string) => {
    if (currentScope.current !== scope) return;
    const href = researchHref(projectId, selected === paperId ? selected : null, id);
    if (id === conversationId || (!conversationId && id === (selected ? `paper:${projectId}:${selected}` : `discussion:${projectId}`))) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  }, [conversationId, projectId, router, scope, selected]);
  const thread = useResearchThread({ projectId, conversationId, paperId: selected, locale, beforeAsk, onChange: refresh, onConversation: accepted, fallbackError: t("rw.error") });
  const latestThread = useRef(thread); latestThread.current = thread;
  const currentConversation = thread.state.conversation;
  const open = useCallback((id: string | null) => router.push(researchHref(projectId, id,
    !id || id === currentConversation?.paperId ? currentConversation?.id ?? conversationId : undefined), { scroll: false }), [conversationId, currentConversation, projectId, router]);
  const selectConversation = useCallback(async (id: string, inPaper = false) => {
    await beforeAsk();
    if (currentScope.current === scope) router.push(researchHref(projectId, inPaper ? selected : null, id), { scroll: false });
  }, [beforeAsk, projectId, router, scope, selected]);
  const navigate = useCallback((href: string) => {
    const url = new URL(href, window.location.href);
    if (url.origin === window.location.origin && url.pathname === "/research") {
      const target = url.searchParams.get("project");
      if (target && target !== projectId) {
        // Preserve paper/conversation deep links while the parent flushes the departing project's notes.
        void onSwitch(target === GENERAL ? null : target, url.pathname + url.search)
          .catch((failure) => { if (currentScope.current === scope) setError(failure instanceof Error ? failure.message : t("rw.error")); });
      } else if (url.searchParams.has("conversation")) {
        void beforeAsk().then(() => {
          if (currentScope.current === scope) router.push(researchHref(projectId, url.searchParams.get("paper"), url.searchParams.get("conversation")), { scroll: false });
        }).catch((failure) => { if (currentScope.current === scope) setError(failure instanceof Error ? failure.message : t("rw.error")); });
      } else open(url.searchParams.get("paper"));
    } else if (url.origin === window.location.origin) router.push(url.pathname + url.search);
    else if (["http:", "https:"].includes(url.protocol)) window.open(url.href, "_blank", "noopener,noreferrer");
  }, [beforeAsk, onSwitch, open, projectId, router, scope, t]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const query = projectId === GENERAL ? "" : `?project=${encodeURIComponent(projectId)}`;
    void researchRequest<{ papers: PaperSummary[] }>(`/api/research/papers${query}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setPapers(result.papers); setError(""); } })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, reload]);
  useEffect(() => {
    if (!selected) { setPaper(null); return; }
    const controller = new AbortController();
    void researchRequest<{ paper: Paper }>(`/api/research/papers?id=${encodeURIComponent(selected)}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setPaper(result.paper); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [selected, reload]);
  const titles = useMemo(() => {
    const result = new Map(papers.map((item) => [item.id, item.title]));
    if (paper && !result.has(paper.id)) result.set(paper.id, paper.title);
    return result;
  }, [paper, papers]);
  function changed(next: Paper) {
    setPaper(next);
    setPapers((current) => current.map((item) => item.id === next.id ? paperSummary(next) : item));
    if (projectId === GENERAL) refresh();
  }
  async function uploaded(item: PaperSummary): Promise<boolean> {
    if (currentScope.current !== scope) return false;
    refresh();
    const current = latestThread.current;
    if (!current.busy && !current.elsewhere) return current.send(t(projectId === GENERAL ? "rw.home.readUploaded" : "rw.paper.readUploadedNamed", { title: item.title }), item.id);
    return false;
  }
  async function uploadPdf(file: File, signal: AbortSignal) {
    await beforeAsk();
    signal.throwIfAborted();
    if (currentScope.current !== scope) return null;
    const saved = await importPaperPdf(projectId, file, signal);
    signal.throwIfAborted();
    // The file belongs to the initiating project, but a late upload must not send into a new topic.
    if (currentScope.current !== scope) { refresh(); return { paper: saved, started: false }; }
    setPapers((current) => [paperSummary(saved), ...current.filter((item) => item.id !== saved.id)]);
    return { paper: saved, started: await uploaded(paperSummary(saved)) };
  }
  return { selected, conversationId, papers, paper, titles, loading, error, thread, refresh, open, navigate, selectConversation, changed, uploaded, uploadPdf };
}
