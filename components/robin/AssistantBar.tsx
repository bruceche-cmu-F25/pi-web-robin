"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import { getInitialNavigation } from "@/lib/initial-navigation";
import {
  searchDashboard,
  type DashboardSearchData,
  type DashboardSearchResult,
} from "@/extension/robin/search";
import { todoUrl } from "@/extension/robin/todo-links";
import { addDays, localDate } from "@/extension/robin/dates";
import type { DashboardEvent } from "@/extension/robin/events";
import { eventRecordHref, todoRecordHref } from "./dashboard-view";
import { formatLinkPaste } from "@/lib/clipboard";
import { onRefreshRequest, requestRefresh } from "./refreshBus";
import { splitReplyLinks } from "./reply-links";
import { usePolledResource } from "./usePolledResource";
import { VoiceControls, type VoiceHandle } from "./VoiceControls";

interface AssistantResponse {
  reply: string;
  usedTools: string[];
  sessionId?: string;
}

interface AssistantTrace {
  sessionId: string | null;
  running: boolean;
}

/**
 * Exact-match page shortcuts. An exact match skips link search entirely, so a
 * shortcut must be named after the page, never after a service the user keeps
 * a link to: `gmail` used to land on this app's Email page and hide the saved
 * Gmail link that the user was actually looking for.
 */
const COMMAND_ROUTES: Record<string, string> = {
  daily: "/dashboard",
  job: "/dashboard/jobs",
  jobs: "/dashboard/jobs",
  email: "/dashboard/gmail",
  mail: "/dashboard/gmail",
  events: "/dashboard/events",
  learn: "/learn",
  research: "/research",
  product: "/product",
  chat: "/",
};

export function dashboardCommandPath(input: string): string | null {
  return COMMAND_ROUTES[input.trim().toLowerCase()] ?? null;
}

/** Tool names map to message keys so the summary follows the chosen language. */
const TOOL_KEYS: Record<string, string> = {
  todo_add: "robin.tool.todoAdd",
  todo_update: "robin.tool.todoUpdate",
  todo_delete: "robin.tool.todoDelete",
  todo_complete: "robin.tool.todoComplete",
  todo_list: "robin.tool.todoList",
  calendar_create_event: "robin.tool.eventAdd",
  calendar_list_events: "robin.tool.eventList",
  link_add: "robin.tool.linkAdd",
  link_list: "robin.tool.linkList",
  provider_usage: "robin.tool.providerUsage",
};

function describeTools(usedTools: string[], t: (key: string) => string): string | null {
  const described = [...new Set(usedTools)].map((name) => {
    const key = TOOL_KEYS[name];
    return key ? t(key) : name;
  });
  return described.length > 0 ? described.join(", ") : null;
}

async function fetchSearchResource<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? `Request failed (${response.status})`);
  return body;
}

export function AssistantBar({
  sessionId,
  cwd,
  onNavigate,
  initialMode = "search",
  modeSwitch = true,
  active = true,
}: {
  sessionId?: string | null;
  cwd?: string | null;
  onNavigate?: () => void;
  initialMode?: "search" | "execute";
  modeSwitch?: boolean;
  active?: boolean;
} = {}) {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const navigation = getInitialNavigation(searchParams);
  const preservedSessionId = sessionId === undefined ? navigation.sessionId : sessionId;
  const preservedCwd = cwd === undefined ? navigation.requestedCwd : cwd;
  const [mode, setMode] = useState<"search" | "execute">(initialMode);
  const [animateMode, setAnimateMode] = useState(false);
  useEffect(() => { if (active) { setAnimateMode(false); setMode(initialMode); } }, [initialMode, active]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<AssistantResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: trace, error: traceError, refresh: refreshTrace, updateData: updateTrace } = usePolledResource<AssistantTrace>("/api/robin/assistant", 60_000, active);
  useEffect(() => {
    if (!active || mode !== "execute") return;
    void refreshTrace();
    if (!busy && !trace?.running) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refreshTrace(); }, 2_000);
    return () => clearInterval(timer);
  }, [active, mode, busy, trace?.running, refreshTrace]);
  const executing = busy || trace?.running === true;
  const traceId = reply?.sessionId ?? trace?.sessionId;
  const traceHref = typeof traceId === "string" && traceId ? `/?session=${encodeURIComponent(traceId)}` : null;
  const [searchData, setSearchData] = useState<DashboardSearchData | null>(null);
  useEffect(() => onRefreshRequest(() => setSearchData(null)), []);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [calendarSearchIncomplete, setCalendarSearchIncomplete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const traceLinkRef = useRef<HTMLAnchorElement>(null);
  const searchResultsRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const voiceRef = useRef<VoiceHandle>(null);
  const [voiceTrigger, setVoiceTrigger] = useState<HTMLSpanElement | null>(null);
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  const commandPath = mode === "search" ? dashboardCommandPath(message) : null;
  const commandQuery = preservedSessionId
    ? `?session=${encodeURIComponent(preservedSessionId)}`
    : preservedCwd
      ? `?cwd=${encodeURIComponent(preservedCwd)}`
      : "";
  const commandHref = commandPath ? `${commandPath}${commandQuery}` : null;

  // Search is read-only. Only explicit execute mode can invoke the assistant.
  // Load the small collections once, then filter locally while typing.
  useEffect(() => {
    if (!active || mode !== "search" || !message.trim() || commandPath) {
      setSearchData(null);
      setSearchError(null);
      return;
    }
    if (searchData) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearchError(null);
      const day = localDate();
      void Promise.all([
        fetchSearchResource<Pick<DashboardSearchData, "links">>("/api/robin/links", controller.signal),
        fetchSearchResource<Pick<DashboardSearchData, "todos">>("/api/robin/todos", controller.signal),
        fetchSearchResource<{ events: DashboardEvent[]; google?: { error?: string } }>(
          `/api/robin/events?from=${addDays(day, -30)}&to=${addDays(day, 90)}`, controller.signal,
        ).catch(() => null),
      ]).then(([links, todos, calendar]) => {
        if (controller.signal.aborted) return;
        setCalendarSearchIncomplete(!calendar || Boolean(calendar.google?.error));
        setSearchData({ links: links.links, todos: todos.todos, events: calendar?.events ?? [] });
      }).catch((caught: unknown) => {
        if ((caught as { name?: string }).name !== "AbortError") {
          setSearchError(caught instanceof Error ? caught.message : String(caught));
        }
      });
    }, 150);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, mode, commandPath, message, searchData]);

  const searchResults = useMemo(
    () => searchData ? searchDashboard(searchData, message) : [],
    [searchData, message],
  );

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const text = message.trim();
    if (!text || inFlight.current) return;

    if (mode === "search") {
      voiceRef.current?.end();
      if (commandHref) {
        setMessage("");
        router.push(commandHref, { scroll: false });
        onNavigate?.();
      } else {
        // A link whose title is exactly what was typed is the destination, not a
        // candidate: "gmail" + Enter opens Gmail. Anything else lands on the list.
        const top = searchResults[0];
        if (top?.kind === "link" && top.item.title.trim().toLocaleLowerCase() === text.toLocaleLowerCase()) {
          window.open(top.item.url, "_blank", "noopener,noreferrer");
          setMessage("");
          onNavigate?.();
          return;
        }
        const results = searchResultsRef.current;
        (results?.querySelector<HTMLAnchorElement>("a") ?? results)?.focus();
      }
      return;
    }

    if (trace?.running) return;
    inFlight.current = true;
    const speakReply = voiceRef.current?.prepareReply();
    setBusy(true);
    setError(null);
    setReply(null);
    try {
      const response = await fetch("/api/robin/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const body = await response.json().catch(() => null) as
        (AssistantResponse & { error?: string }) | null;
      if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);

      setMessage("");
      setSearchData(null);
      setReply({ reply: body?.reply ?? "", usedTools: body?.usedTools ?? [], sessionId: body?.sessionId });
      speakReply?.(body?.reply ?? null);
      if (body?.sessionId) updateTrace(() => ({ sessionId: body.sessionId!, running: false }));
      // The agent wrote straight to the JSON stores; pull the panels forward.
      requestRefresh();
    } catch (caught) {
      speakReply?.(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      inFlight.current = false;
      setBusy(false);
      void refreshTrace();
      // The input is disabled while busy; focus lands after React re-enables it.
      requestAnimationFrame(() => { if (inputRef.current?.getClientRects().length) inputRef.current.focus(); });
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const replacement = formatLinkPaste(
      event.clipboardData.getData("text/plain") || event.clipboardData.getData("text"),
      event.clipboardData.getData("text/html"),
      input.value.slice(start, end),
    );
    if (!replacement) return;

    event.preventDefault();
    const nextMessage = input.value.slice(0, start) + replacement + input.value.slice(end);
    const nextCursor = start + replacement.length;
    setMessage(nextMessage);
    requestAnimationFrame(() => input.setSelectionRange(nextCursor, nextCursor));
  };

  const actions = reply ? describeTools(reply.usedTools, t) : null;
  const changeMode = (next: "search" | "execute", animate = false) => {
    voiceRef.current?.end();
    setAnimateMode(animate);
    setMode(next); setError(null); setReply(null);
    inputRef.current?.focus();
  };

  return (
    // One inset control row; results share a quiet list surface below it.
    // Switching modes never submits; Enter is the explicit execution gesture.
    <section
      className="robin-assistant-bar pi-card flex flex-col"
      data-mode={mode}
    >
      <div className="robin-assistant-row flex min-w-0 items-stretch">
        {!modeSwitch && <span className="robin-assistant-title">{t(mode === "search" ? "daily.search" : "daily.askRobin")}</span>}
        {modeSwitch && <div role="group" aria-label={t("robin.assistant.mode")} className="robin-assistant-modes shrink-0" data-animate={animateMode || undefined}>
          <span className="robin-assistant-mode-thumb" aria-hidden="true" />
          {(["search", "execute"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              disabled={busy}
              data-active={mode === value ? "true" : undefined}
              title={t(`robin.assistant.${value}Mode`)}
              className="ui-action disabled:opacity-40"
              onClick={(event) => changeMode(value, event.detail > 0)}
            >
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {value === "search" ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></> : <><path d="m5 6 6 6-6 6M14 18h5" /></>}
              </svg>
              {t(`robin.assistant.${value}Short`)}
            </button>
          ))}
          <select className="robin-assistant-mobile-mode" aria-label={t("robin.assistant.mode")} value={mode} disabled={busy}
            onChange={(event) => changeMode(event.target.value as "search" | "execute")}>
            <option value="search">{t("robin.assistant.searchShort")}</option>
            <option value="execute">{t("robin.assistant.executeShort")}</option>
          </select>
        </div>}
        <form
          onSubmit={submit}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
          }}
          className="robin-assistant-form flex min-w-0 flex-1 items-center gap-2.5"
        >
          <label htmlFor={fieldId} className="sr-only">{t(`robin.assistant.${mode}Label`)}</label>
          <input
            id={fieldId}
            name={mode === "search" ? "query" : "instruction"}
            aria-describedby={hintId}
            autoComplete="off"
            enterKeyHint={mode === "execute" ? "send" : "search"}
            ref={inputRef}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onPaste={handlePaste}
            disabled={busy}
            placeholder={modeSwitch ? t(`robin.assistant.${mode}Placeholder`) : ""}
            className="min-w-0 flex-1 py-2 text-sm disabled:opacity-60"
          />
          {mode === "execute" && modeSwitch && <kbd className="robin-assistant-enter-hint" aria-hidden="true" title={t("robin.assistant.executeHint")}>↵</kbd>}
          <span ref={setVoiceTrigger} className="flex shrink-0 items-center" />
          {!modeSwitch && mode === "execute" && <button type="submit" className="robin-assistant-send ui-action" disabled={!message.trim() || executing} aria-label={t("robin.assistant.send")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
          </button>}
        </form>
      </div>
      {active && <VoiceControls key={mode} ref={voiceRef} triggerTarget={voiceTrigger} dictationOnly={mode === "search"} inputKind={mode === "search" ? "search" : "message"}
        onTranscript={text => setMessage(previous => [previous.trim(), text].filter(Boolean).join(" "))}
        onSend={() => void submit()} canSend={!!message.trim()} busy={mode === "execute" && executing} replyText={reply?.reply} />}
      <p id={hintId} className="sr-only">
        {t(`robin.assistant.${mode}Hint`)}
      </p>

      {!busy && commandHref && (
        <a
          href={commandHref}
          onClick={onNavigate}
          className="robin-assistant-command ui-action ui-action--surface flex min-h-11 items-center gap-3 px-3"
        >
          <span className="pi-eyebrow">{t("robin.assistant.open")}</span>
          <strong className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--text)" }}>
            {message.trim().toLowerCase()}
          </strong>
          <span aria-hidden="true" style={{ color: "var(--text-dim)" }}>↵</span>
        </a>
      )}

      {mode === "search" && !commandHref && message.trim() && searchResults.length > 0 && (
        <SearchResults results={searchResults} containerRef={searchResultsRef} t={t} onNavigate={onNavigate} />
      )}

      {mode === "search" && message.trim() && !commandHref && <p className="text-xs px-3 py-2" style={{ color: "var(--text-muted)" }}>
        {t("daily.searchScope")}{calendarSearchIncomplete && ` ${t("daily.searchPartial")}`}
      </p>}
      <div role="status" aria-live="polite" aria-atomic="true" className="text-xs empty:hidden" style={{ color: "var(--text-muted)" }}>
        {mode === "execute" && executing ? t("robin.assistant.working") : reply ? t("robin.assistant.finished") :
          mode === "search" && message.trim() && !commandHref && !searchError ? (
            !searchData ? t("robin.assistant.searching") :
              searchResults.length ? t("robin.assistant.resultCount", { count: String(searchResults.length) }) : t("robin.assistant.noResults")
          ) : null}
      </div>

      {mode === "execute" && (traceHref || reply || error || executing || traceError) && <div className="robin-assistant-result-toolbar" data-idle={!reply && !error && !executing && !traceError || undefined}>
        {traceHref ? <a ref={traceLinkRef} href={traceHref} target="_blank" rel="noopener noreferrer" className="ui-action"
          aria-label={t("robin.assistant.trace")}>
          {t("robin.assistant.trace")} <span aria-hidden="true">↗</span>
        </a> : <span className="text-xs">{t(traceError ? "robin.assistant.traceUnavailable" : "robin.assistant.tracePending")}</span>}
        {(reply || error) && <button type="button" className="ui-action" aria-label={t("robin.assistant.dismissReply")}
          onClick={() => { setReply(null); setError(null); traceLinkRef.current?.focus({ preventScroll: true }); }}>×</button>}
      </div>}
      {mode === "execute" && traceError && traceHref && <p role="status" className="text-xs">{t("robin.assistant.traceUnavailable")}</p>}

      {mode === "search" && searchError && message.trim() && (
        <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{searchError}</p>
      )}
      {error && <div role="alert" className="text-xs" style={{ color: "var(--danger)" }}>
        <p>{error}</p><p>{t("robin.assistant.checkBeforeRetry")}</p>
      </div>}

      {mode === "execute" && reply && !busy && (
        <div className="robin-assistant-reply flex flex-col gap-1">
          {reply.reply && (
            <p className="whitespace-pre-wrap break-words text-sm" style={{ color: "var(--text-muted)" }}>
              {splitReplyLinks(reply.reply).map((segment, index) => segment.type === "link" ? (
                <a
                  key={`${segment.href}:${index}`}
                  href={segment.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: 3 }}
                >
                  {segment.value}
                </a>
              ) : segment.value)}
            </p>
          )}
          {actions && (
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>{actions}</p>
          )}
        </div>
      )}
    </section>
  );
}

function SearchResults({
  results,
  containerRef,
  t,
  onNavigate,
}: {
  results: DashboardSearchResult[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  t: (key: string, params?: Record<string, string>) => string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="region"
      aria-label={t("robin.search.results")}
      className="robin-search-results"
    >
      <p className="robin-search-heading">{t("robin.search.results")}</p>
      <ul className="robin-search-list">
      {results.map((result) => {
        const category = t(result.kind === "link" ? "robin.links.title" : result.kind === "event" ? "robin.calendar.title" : "robin.todos.title");
        const detail = result.kind === "link"
          ? linkDetail(result.item.url, result.item.group)
          : result.kind === "event" ? [result.item.date, result.item.start, result.item.location].filter(Boolean).join(" · ")
            : [result.item.done ? "✓" : "", result.item.due ?? ""].filter(Boolean).join(" · ");
        const item = result.item;
        const titleColor = result.kind === "todo" && !result.item.done && result.item.color
          ? `var(--todo-${result.item.color})`
          : "var(--text)";
        const content = (
          <>
            <span className="robin-search-copy">
              <span className="robin-search-title" style={{ color: titleColor }}>{item.title}</span>
              {detail && <span className="robin-search-detail">{detail}</span>}
            </span>
            <span className="robin-search-category">{category}</span>
          </>
        );

        const href = result.kind === "link" ? result.item.url : result.kind === "todo"
          ? todoRecordHref(result.item.id) : eventRecordHref(result.item);
        const destination = result.kind === "todo" ? todoUrl(result.item) : undefined;

        return (
          <li key={`${result.kind}:${item.id}`}>
            <a href={href} target={result.kind === "link" ? "_blank" : undefined} rel={result.kind === "link" ? "noopener noreferrer" : undefined}
              onClick={(event) => {
                if (result.kind === "link" || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                const target = new URL(href, window.location.origin);
                for (const key of ["session", "cwd"]) { const value = new URLSearchParams(window.location.search).get(key); if (value) target.searchParams.set(key, value); }
                router.push(target.pathname + target.search, { scroll: false }); onNavigate?.();
              }}
              className="robin-search-row ui-action ui-action--surface">
              {content}
            </a>
            {destination && <a className="ui-action text-xs px-3 min-h-11 inline-flex items-center" href={destination} target="_blank" rel="noopener noreferrer">{t("daily.openDestination")} ↗</a>}
          </li>
        );
      })}
      </ul>
    </div>
  );
}

function linkDetail(url: string, group?: string): string {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // Keep the original address when a legacy item is malformed.
  }
  return [group, host].filter(Boolean).join(" · ");
}
