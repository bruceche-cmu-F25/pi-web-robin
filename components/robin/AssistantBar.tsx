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
import { formatLinkPaste } from "@/lib/clipboard";
import { requestRefresh } from "./refreshBus";
import { splitReplyLinks } from "./reply-links";

interface AssistantResponse {
  reply: string;
  usedTools: string[];
}

const COMMAND_ROUTES: Record<string, string> = {
  daily: "/dashboard",
  job: "/dashboard/jobs",
  jobs: "/dashboard/jobs",
  gmail: "/dashboard/gmail",
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
}: {
  sessionId?: string | null;
  cwd?: string | null;
  onNavigate?: () => void;
} = {}) {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const navigation = getInitialNavigation(searchParams);
  const preservedSessionId = sessionId === undefined ? navigation.sessionId : sessionId;
  const preservedCwd = cwd === undefined ? navigation.requestedCwd : cwd;
  const [mode, setMode] = useState<"search" | "execute">("search");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<AssistantResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchData, setSearchData] = useState<DashboardSearchData | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchResultsRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
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
    if (mode !== "search" || !message.trim() || commandPath) {
      setSearchData(null);
      setSearchError(null);
      return;
    }
    if (searchData) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearchError(null);
      void Promise.all([
        fetchSearchResource<Pick<DashboardSearchData, "links">>("/api/robin/links", controller.signal),
        fetchSearchResource<Pick<DashboardSearchData, "todos">>("/api/robin/todos", controller.signal),
      ]).then(([links, todos]) => {
        if (controller.signal.aborted) return;
        setSearchData({ links: links.links, todos: todos.todos });
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
  }, [mode, commandPath, message, searchData]);

  const searchResults = useMemo(
    () => searchData ? searchDashboard(searchData, message) : [],
    [searchData, message],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || inFlight.current) return;

    if (mode === "search") {
      if (commandHref) {
        setMessage("");
        router.push(commandHref, { scroll: false });
        onNavigate?.();
      } else {
        const results = searchResultsRef.current;
        (results?.querySelector<HTMLAnchorElement>("a") ?? results)?.focus();
      }
      return;
    }

    inFlight.current = true;
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
      setReply({ reply: body?.reply ?? "", usedTools: body?.usedTools ?? [] });
      // The agent wrote straight to the JSON stores; pull the panels forward.
      requestRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      inFlight.current = false;
      setBusy(false);
      // The input is disabled while busy; focus lands after React re-enables it.
      requestAnimationFrame(() => inputRef.current?.focus());
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

  return (
    // One ruled line in the calendar card's vocabulary: the mode switch marks
    // its current entry with the same stripe as the calendar's view switch, and
    // the action is a bracket button. Act writes to the stores, so it says so
    // on the line itself (accent rule, prompt glyph, accent action) rather
    // than with a hint row that would push the page down when it appears.
    <section
      className="robin-assistant-bar pi-card flex flex-col"
      data-mode={mode}
    >
      <div className="robin-assistant-row flex min-w-0 items-stretch">
        <div role="group" aria-label={t("robin.assistant.mode")} className="robin-assistant-modes flex shrink-0 items-center gap-0.5">
          {(["search", "execute"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              disabled={busy}
              data-active={mode === value ? "true" : undefined}
              title={t(`robin.assistant.${value}Mode`)}
              className={`ui-action min-h-[44px] min-w-[44px] px-2.5 desktop:min-h-7 desktop:min-w-0 disabled:opacity-40${mode === value ? " pi-active-stripe" : ""}`}
              onClick={() => {
                setMode(value);
                setError(null);
                setReply(null);
                inputRef.current?.focus();
              }}
            >
              {t(`robin.assistant.${value}Short`)}
            </button>
          ))}
        </div>
        <form
          onSubmit={submit}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
          }}
          className="robin-assistant-form flex min-w-0 flex-1 items-center gap-2.5"
        >
          <span className="robin-assistant-glyph" aria-hidden="true">
            {mode === "search" ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
              </svg>
            ) : "›"}
          </span>
          <label htmlFor={fieldId} className="sr-only">{t(`robin.assistant.${mode}Label`)}</label>
          <input
            id={fieldId}
            name={mode === "search" ? "query" : "instruction"}
            aria-describedby={hintId}
            autoComplete="off"
            ref={inputRef}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onPaste={handlePaste}
            disabled={busy}
            placeholder={t(`robin.assistant.${mode}Placeholder`)}
            className="min-w-0 flex-1 py-2 text-sm disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy || !message.trim()}
            className="ui-action pi-bracket min-h-[44px] shrink-0 px-2 desktop:min-h-7 disabled:opacity-40"
            data-state={mode === "execute" ? "accent" : undefined}
          >
            {busy ? t("robin.assistant.working") : t(mode === "execute" ? "robin.assistant.execute" : commandHref ? "robin.assistant.open" : "robin.assistant.searchMode")}
          </button>
        </form>
      </div>
      <p id={hintId} className="sr-only">
        {t(`robin.assistant.${mode}Hint`)}
      </p>

      {!busy && commandHref && (
        <a
          href={commandHref}
          onClick={onNavigate}
          className="ui-action ui-action--surface flex min-h-11 items-center gap-3 border px-3"
        >
          <span className="pi-eyebrow">{t("robin.assistant.open")}</span>
          <strong className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--text)" }}>
            {message.trim().toLowerCase()}
          </strong>
          <span aria-hidden="true" style={{ color: "var(--text-dim)" }}>↵</span>
        </a>
      )}

      {mode === "search" && !commandHref && message.trim() && searchResults.length > 0 && (
        <SearchResults results={searchResults} containerRef={searchResultsRef} t={t} />
      )}

      <div role="status" aria-live="polite" aria-atomic="true" className="text-xs empty:hidden" style={{ color: "var(--text-muted)" }}>
        {busy ? t("robin.assistant.working") : reply ? t("robin.assistant.finished") :
          mode === "search" && message.trim() && !commandHref && !searchError ? (
            !searchData ? t("robin.assistant.searching") :
              searchResults.length ? t("robin.assistant.resultCount", { count: String(searchResults.length) }) : t("robin.assistant.noResults")
          ) : null}
      </div>

      {mode === "search" && searchError && message.trim() && (
        <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{searchError}</p>
      )}
      {error && <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}

      {reply && !busy && (
        <div className="flex flex-col gap-1">
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
}: {
  results: DashboardSearchResult[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="region"
      aria-label={t("robin.search.results")}
      className="max-h-64 overflow-y-auto rounded focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
      style={{ border: "1px solid var(--border)", background: "var(--bg)" }}
    >
      <p className="pi-eyebrow px-3 py-2" style={{ color: "var(--text-muted)" }}>{t("robin.search.results")}</p>
      {results.map((result) => {
        const category = result.kind === "link" ? t("robin.links.title") : t("robin.todos.title");
        const detail = result.kind === "link"
          ? linkDetail(result.item.url, result.item.group)
          : [result.item.done ? "✓" : "", result.item.due ?? ""].filter(Boolean).join(" · ");
        const item = result.item;
        const titleColor = result.kind === "todo" && !result.item.done && result.item.color
          ? `var(--todo-${result.item.color})`
          : "var(--text)";
        const content = (
          <>
            <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide" style={{ color: "var(--text-dim)" }}>
              {category}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm" style={{ color: titleColor }}>{item.title}</span>
              {detail && (
                <span className="block truncate text-xs" style={{ color: "var(--text-dim)" }}>{detail}</span>
              )}
            </span>
          </>
        );

        // A todo with a link opens where the task lives, exactly like a saved
        // link does; completion stays in the todo panel's checkbox.
        const href = result.kind === "link" ? result.item.url : todoUrl(result.item);

        return href ? (
          <a
            key={`${result.kind}:${item.id}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="ui-action ui-action--surface flex min-h-11 items-center gap-2 border-b px-3 py-1 last:border-b-0"
          >
            {content}
          </a>
        ) : (
          <div key={`${result.kind}:${item.id}`} className="flex min-h-11 items-center gap-2 border-b px-3 py-1 last:border-b-0">
            {content}
          </div>
        );
      })}
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
