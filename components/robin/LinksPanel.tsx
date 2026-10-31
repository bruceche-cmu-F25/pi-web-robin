"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile, useIsSplitLayout } from "@/hooks/useIsMobile";
import { SavedLinkLaunch } from "./SavedLinkLaunch";
import { usePopoverDismiss } from "./usePopoverDismiss";
import type { Link } from "@/extension/robin/links";
import { SavedLinkIcon, useLinkIconBackfill } from "./SavedLinkIcon";
import { linkSections } from "@/extension/robin/link-families";
import { mutate, mutateResponse, usePolledResource } from "./usePolledResource";
import { requestRefresh } from "./refreshBus";
import styles from "./LinksPanel.module.css";

interface LinksResponse {
  links: Link[];
}

// This is the user's category, not the broader inferred "daily" family.
const DAILY_GROUP = "日常入口";

export function LinksPanel({ placement = "all", embedded = false }: {
  placement?: "all" | "daily" | "other";
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const mobile = useIsMobile();
  const desktop = useIsSplitLayout();
  const [expandedLists, setExpandedLists] = useState<Set<string>>(() => new Set());
  const { data, error, loading, refresh, updateData } = usePolledResource<LinksResponse>("/api/robin/links", 30000);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [group, setGroup] = useState("");
  // Empty string means the panel-level form; a group name means its inline form.
  const [addingGroup, setAddingGroup] = useState<string | null>(null);
  // Collapsed rather than expanded: everything opens by default, and a shelf
  // saved a minute from now opens with the rest instead of hiding.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [collapsedFamilies, setCollapsedFamilies] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [reordering, setReordering] = useState(false);
  const editRef = useRef<HTMLInputElement>(null);
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editingId) editRef.current?.select();
  }, [editingId]);

  const links = useMemo(() => (data?.links ?? []).filter((link) =>
    placement === "all" || (placement === "daily" ? link.group === DAILY_GROUP : link.group !== DAILY_GROUP)), [data, placement]);
  const sections = useMemo(() => linkSections(links), [links]);

  useLinkIconBackfill(links, refresh);

  async function run(action: () => Promise<void>) {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    try {
      setActionError(null);
      await action();
      // The write receipt releases the controls; a slow read is not a pending save.
      void refresh();
      requestRefresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  const saveLink = async (method: "POST" | "PATCH", body: unknown) => {
    const response = await mutateResponse("/api/robin/links", method, body);
    const { link } = await response.json() as { link: Link };
    updateData(current => ({ links: current?.links.some(item => item.id === link.id)
      ? current.links.map(item => item.id === link.id ? link : item)
      : [...(current?.links ?? []), link] }));
  };

  const addLink = (event: React.FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    void run(async () => {
      await saveLink("POST", {
        url,
        ...(title.trim() ? { title } : {}),
        ...(group.trim() ? { group } : {}),
      });
      setUrl("");
      setTitle("");
      setGroup("");
      setAddingGroup(null);
    });
  };

  const startEdit = (link: Link) => {
    if (writing.current) return;
    setActionError(null);
    setEditingId(link.id);
    setDraftTitle(link.title);
    setDraftUrl(link.url);
  };

  const commitEdit = (id: string) => {
    const title = draftTitle.trim();
    const url = draftUrl.trim();
    const original = data?.links.find((link) => link.id === id);
    if (writing.current || !original || !title || !url) return;
    if (title === original.title && url === original.url) { setEditingId(null); return; }

    // Both fields go together: changing the address re-fetches the icon, and
    // sending the title alongside keeps an edited name from being overwritten
    // by the new page's own.
    void run(async () => {
      await saveLink("PATCH", { id, title, url });
      setEditingId(null);
    });
  };

  /**
   * Only the flat group order is stored, so both moves end by flattening the
   * sections back down. Re-clustering that order is a no-op — a family's groups
   * are already adjacent — which is what keeps a move from being undone.
   */
  const persistOrder = (order: string[]) => {
    if (writing.current) return;
    // Reorder only this panel's slots; never drop or move the hidden category.
    const visible = new Set(order);
    let index = 0;
    const groups = linkSections(data?.links ?? []).flatMap((section) => section.groups.map(({ group }) =>
      visible.has(group) ? order[index++] : group));
    setReordering(true);
    void run(() => mutate("/api/robin/links", "PATCH", {
      action: "reorderGroups",
      groups,
    })).finally(() => setReordering(false));
  };

  const moveSection = (index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= sections.length || reordering) return;
    const reordered = [...sections];
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    persistOrder(reordered.flatMap((section) => section.groups.map(({ group }) => group)));
  };

  const moveWithinFamily = (sectionIndex: number, groupIndex: number, offset: -1 | 1) => {
    const section = sections[sectionIndex];
    const destination = groupIndex + offset;
    if (!section || destination < 0 || destination >= section.groups.length || reordering) return;
    const names = section.groups.map(({ group }) => group);
    [names[groupIndex], names[destination]] = [names[destination], names[groupIndex]];
    persistOrder(sections.flatMap((current, index) =>
      index === sectionIndex ? names : current.groups.map(({ group }) => group)));
  };

  const toggle = (setCollapsed: typeof setCollapsedGroups, name: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleGroup = (name: string) => {
    toggle(setCollapsedGroups, name);
    if (!collapsedGroups.has(name) && addingGroup === name) setAddingGroup(null);
  };

  const toggleAdd = (name: string) => {
    if (writing.current) return;
    if (addingGroup === name) {
      setAddingGroup(null);
      return;
    }
    setUrl("");
    setTitle("");
    // "Other" represents links without an explicit group in groupLinks().
    setGroup(placement === "daily" ? DAILY_GROUP : name === "Other" ? "" : name);
    setAddingGroup(name);
    if (name) {
      setCollapsedGroups((current) => {
        const next = new Set(current);
        next.delete(name);
        return next;
      });
    }
  };

  const renderActions = (link: Link) => (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => (editingId === link.id ? commitEdit(link.id) : startEdit(link))}
        aria-label={editingId === link.id ? t(busy ? "robin.common.saving" : "robin.common.save") : t("robin.links.edit", { title: link.title })}
        title={t("robin.links.edit", { title: link.title })}
        className="ui-action h-[44px] w-[44px] shrink-0 text-xs desktop:h-[28px] desktop:w-[28px]"
        style={{ color: editingId === link.id ? "var(--accent)" : "var(--text-muted)" }}
      >
        {editingId === link.id ? "✓" : "✎"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (writing.current) return;
          if (editingId === link.id) setEditingId(null);
          else if (window.confirm(t("robin.common.deleteConfirm", { title: link.title }))) {
            void run(async () => {
              await mutate("/api/robin/links", "DELETE", { id: link.id });
              updateData(current => current && { links: current.links.filter(item => item.id !== link.id) });
            });
          }
        }}
        aria-label={editingId === link.id ? t("robin.common.cancel") : t("robin.links.delete", { title: link.title })}
        className="ui-action h-[44px] w-[44px] shrink-0 text-xs desktop:h-[28px] desktop:w-[28px]"
        style={{ color: "var(--text-muted)" }}
      >
        ✕
      </button>
    </>
  );

  const renderAddForm = (showGroup: boolean) => (
    <form onSubmit={addLink} className="flex flex-col gap-2">
      <input
        value={url}
        disabled={busy}
        onChange={(event) => setUrl(event.target.value)}
        placeholder={t("robin.links.urlPlaceholder")}
        aria-label={t("robin.links.urlPlaceholder")}
        inputMode="url"
        autoFocus
        className="rounded px-2 py-1 text-sm outline-none"
        style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
      />
      <div className="robin-link-fields flex gap-2">
        <input
          value={title}
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("robin.links.namePlaceholder")}
          aria-label={t("robin.links.namePlaceholder")}
          className="min-w-0 flex-1 rounded px-2 py-1 text-sm outline-none"
        />
        {showGroup && (
          <input
            value={group}
            disabled={busy}
            onChange={(event) => setGroup(event.target.value)}
            placeholder={t("robin.links.groupPlaceholder")}
            aria-label={t("robin.links.groupPlaceholder")}
            className="w-24 rounded px-2 py-1 text-sm outline-none"
            style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
        )}
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="ui-action ui-action--outline pi-bracket px-3 disabled:opacity-40"
          data-state="accent"
        >
          {t(busy ? "robin.common.saving" : "robin.common.save")}
        </button>
      </div>
    </form>
  );

  return (
    <section
      id={placement === "daily" ? "dashboard-daily-links" : "dashboard-links"}
      tabIndex={-1}
      aria-busy={busy}
      className={`flex scroll-mt-24 flex-col gap-3 ${styles.panel}${embedded ? "" : " pi-card p-4"}`}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="pi-section-title">{placement === "daily" ? DAILY_GROUP : t("robin.links.title")}</h2>
        <div className="flex items-center gap-2">
          {placement !== "daily" && <a href="https://www.notion.so/" target="_blank" rel="noopener noreferrer" className="ui-action pi-chrome-label pi-bracket text-xs">
            Notion ↗
          </a>}
          <button
            type="button"
            onClick={() => toggleAdd("")}
            disabled={busy}
            className="robin-panel-add ui-action pi-chrome-label pi-bracket text-xs"
          >
            {addingGroup === "" ? t("robin.common.cancel") : t("robin.common.add")}
          </button>
        </div>
      </header>

      {addingGroup === "" && renderAddForm(placement !== "daily")}

      {(error || actionError) && (
        <div role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
          <p>{actionError ?? error}</p>
          {error && <button type="button" className="ui-action pi-bracket min-h-11" onClick={() => void refresh()}>{t("robin.common.retry")}</button>}
        </div>
      )}

      {!loading && !error && sections.length === 0 && (
        <p className="py-2 text-sm" style={{ color: "var(--text-dim)" }}>{t("robin.links.empty")}</p>
      )}

      <div className={styles.groups} data-link-groups>
      {sections.map((section, sectionIndex) => {
        const accent = section.color ? `var(--todo-${section.color})` : undefined;
        const familyOpen = !section.family || !collapsedFamilies.has(section.family);
        return (
        <div
          key={section.family ?? section.groups[0]?.group}
          className="mb-1 flex break-inside-avoid flex-col gap-1"
        >
          {section.family && (
            <div className="flex min-h-8 items-center gap-1">
              <button
                type="button"
                onClick={() => toggle(setCollapsedFamilies, section.family as string)}
                aria-expanded={familyOpen}
                className="ui-action ui-action--surface flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded px-1 text-left"
              >
                <span className={styles.familyMark} style={{ background: accent }} aria-hidden="true" />
                <Chevron open={familyOpen} />
                <h3 className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>
                  {t(`robin.links.family.${section.family}`)}
                </h3>
                <span className="text-xs" style={{ color: "var(--text-dim)" }}>{section.links}</span>
              </button>
              {sections.length > 1 && (
                <MoveButtons
                  label={t(`robin.links.family.${section.family}`)}
                  disabled={reordering}
                  atStart={sectionIndex === 0}
                  atEnd={sectionIndex === sections.length - 1}
                  onMove={(offset) => moveSection(sectionIndex, offset)}
                  t={t}
                />
              )}
            </div>
          )}

          {familyOpen && section.groups.map(({ group: name, links }, groupIndex) => {
        const expanded = placement === "daily" || !collapsedGroups.has(name);
        const displayName = name === "Other" ? t("robin.links.otherGroup") : name;
        const shortened = mobile && links.length > 4;
        const showAll = expandedLists.has(name);
        const visibleLinks = shortened && !showAll ? links.slice(0, 4) : links;
        return (
        <div
          key={name}
          className="flex flex-col gap-1"
          // Nested groups sit inside their family's colour rather than
          // repeating its name on every row.
          style={section.family ? { marginLeft: 8, paddingLeft: 6, borderLeft: `1px solid ${accent}` } : undefined}
        >
          {placement !== "daily" && <div className="flex min-h-8 items-center gap-1">
            <button
              type="button"
              onClick={() => toggleGroup(name)}
              aria-expanded={expanded}
              className="ui-action ui-action--surface flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded px-1 text-left"
            >
              <Chevron open={expanded} />
              <h3 className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-dim)" }}>
                {displayName}
              </h3>
              <span className="text-xs" style={{ color: "var(--text-dim)" }}>{links.length}</span>
            </button>
            <button
              type="button"
              onClick={() => toggleAdd(name)}
              aria-label={addingGroup === name
                ? t("robin.common.cancel")
                : t("robin.links.addToGroup", { group: displayName })}
              title={addingGroup === name
                ? t("robin.common.cancel")
                : t("robin.links.addToGroup", { group: displayName })}
              className="ui-action ui-action--outline-soft flex size-8 items-center justify-center rounded"
            >
              {addingGroup === name ? (
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M2.5 2.5l7 7m0-7-7 7" />
                </svg>
              ) : (
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M6 2v8M2 6h8" />
                </svg>
              )}
            </button>
            {/* A group inside a family moves among its siblings; a group that is
                its own section moves against the other sections. */}
            {(section.family ? section.groups.length > 1 : sections.length > 1) && (
              <MoveButtons
                label={displayName}
                disabled={reordering}
                atStart={section.family ? groupIndex === 0 : sectionIndex === 0}
                atEnd={section.family
                  ? groupIndex === section.groups.length - 1
                  : sectionIndex === sections.length - 1}
                onMove={(offset) => section.family
                  ? moveWithinFamily(sectionIndex, groupIndex, offset)
                  : moveSection(sectionIndex, offset)}
                t={t}
              />
            )}
          </div>}
          {expanded && (
            <>
              {addingGroup === name && renderAddForm(false)}
              {visibleLinks.map((link) => (
            <div
              key={link.id}
              className="group flex items-center gap-2 rounded px-2 py-1"
              style={{ background: "var(--bg-subtle)" }}
            >
              {editingId === link.id && <SavedLinkIcon link={link} />}
              {editingId === link.id ? (
                // Two fields, so saving is explicit: blur-to-save would fire
                // while moving between them.
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <input
                    ref={editRef}
                    value={draftTitle}
                    disabled={busy}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (writing.current || event.nativeEvent.isComposing) return;
                      if (event.key === "Enter") commitEdit(link.id);
                      if (event.key === "Escape") setEditingId(null);
                    }}
                    aria-label={t("robin.links.namePlaceholder")}
                    autoFocus
                    className="w-full rounded px-1 py-0.5 text-sm outline-none"
                    style={{ background: "var(--bg)", border: "1px solid var(--accent)", color: "var(--text)" }}
                  />
                  <input
                    value={draftUrl}
                    disabled={busy}
                    onChange={(event) => setDraftUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (writing.current || event.nativeEvent.isComposing) return;
                      if (event.key === "Enter") commitEdit(link.id);
                      if (event.key === "Escape") setEditingId(null);
                    }}
                    aria-label={t("robin.links.urlPlaceholder")}
                    spellCheck={false}
                    className="w-full rounded px-1 py-0.5 text-xs outline-none"
                    style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
                  />
                </div>
              ) : (
                <SavedLinkLaunch link={link} mobile={!desktop} compact />
              )}
              {!desktop && editingId !== link.id ? (
                <LinkActions label={t("robin.links.actions", { title: link.title })}>
                  <a href={link.url} target="_blank" rel="noopener noreferrer" className="ui-action flex min-h-11 items-center px-2 text-sm" aria-label={t("daily.links.webLabel", { title: link.title })}>{t("daily.links.web")}</a>
                  {renderActions(link)}
                </LinkActions>
              ) : renderActions(link)}
            </div>
              ))}
              {shortened && (
                <button
                  type="button"
                  className="robin-links-more ui-action min-h-11 self-start text-xs"
                  aria-expanded={showAll}
                  disabled={Boolean(editingId)}
                  onClick={() => toggle(setExpandedLists, name)}
                >
                  {showAll ? t("robin.common.showLess") : t("robin.common.showMoreCount", { count: String(links.length - 4) })}
                </button>
              )}
            </>
          )}
        </div>
        );
          })}
        </div>
        );
      })}
      </div>
    </section>
  );
}

/** Same light-dismiss behavior as the todo row; editing keeps Save/Cancel visible. */
function LinkActions({ label, children, className = "robin-link-actions" }: { label: string; children: ReactNode; className?: string }) {
  const ref = usePopoverDismiss();
  return (
    <details ref={ref} className={`${className} relative shrink-0`}>
      <summary className="ui-action flex size-11 cursor-pointer list-none items-center justify-center" aria-label={label}>
        <span aria-hidden="true">···</span>
      </summary>
      <div className="absolute right-0 top-full flex max-w-[calc(100vw-3rem)] gap-2 border p-2" style={{ zIndex: "var(--z-popover)", background: "var(--bg-panel)", borderColor: "var(--border-strong)", boxShadow: "var(--popover-shadow)" }}>
        {children}
      </div>
    </details>
  );
}

/** The disclosure arrow shared by family and group headers. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
    >
      <polyline points="4 2.5 7.5 6 4 9.5" />
    </svg>
  );
}

/** Move a family among the sections, or a group among its siblings. */
function MoveButtons({
  label,
  disabled,
  atStart,
  atEnd,
  onMove,
  t,
}: {
  label: string;
  disabled: boolean;
  atStart: boolean;
  atEnd: boolean;
  onMove: (offset: -1 | 1) => void;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const mobile = useIsMobile();
  const buttons = (
    <div className="flex gap-1">
      <button
        type="button"
        disabled={disabled || atStart}
        onClick={() => onMove(-1)}
        aria-label={t("robin.links.moveUp", { group: label })}
        title={t("robin.links.moveUp", { group: label })}
        className="ui-action ui-action--outline-soft flex size-8 items-center justify-center rounded disabled:opacity-30"
      >
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="2.5 7.5 6 4 9.5 7.5" />
        </svg>
      </button>
      <button
        type="button"
        disabled={disabled || atEnd}
        onClick={() => onMove(1)}
        aria-label={t("robin.links.moveDown", { group: label })}
        title={t("robin.links.moveDown", { group: label })}
        className="ui-action ui-action--outline-soft flex size-8 items-center justify-center rounded disabled:opacity-30"
      >
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="2.5 4.5 6 8 9.5 4.5" />
        </svg>
      </button>
    </div>
  );
  return mobile ? <LinkActions className="robin-group-actions" label={t("robin.links.actions", { title: label })}>{buttons}</LinkActions> : buttons;
}
