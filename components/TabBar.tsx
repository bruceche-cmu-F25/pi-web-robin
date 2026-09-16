"use client";

import { useEffect, useId, useRef, useState } from "react";
import { getFileIcon } from "./FileIcons";
import { useI18n } from "@/hooks/useI18n";
import type { FileViewerDisplayMode, FileViewerState } from "@/lib/file-viewer-state";

export interface Tab {
  id: string;
  label: string;
  filePath: string;
  kind?: "file" | "terminal";
  sourceSessionId?: string | null;
  terminalId?: string;
  /** A terminal whose shell has ended. The server has already dropped its PTY. */
  terminalExited?: boolean;
  initialDisplayMode?: FileViewerDisplayMode;
  viewerState?: FileViewerState;
  viewerRevision?: number;
}

function TerminalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <polyline points="7 9 10 12 7 15" />
      <line x1="13" y1="15" x2="17" y2="15" />
    </svg>
  );
}

interface Props {
  tabs: Tab[];
  activeTabId: string;
  mobile?: boolean;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

function TabIcon({ tab }: { tab: Tab }) {
  return tab.kind === "terminal" ? <TerminalIcon /> : getFileIcon(tab.label, 13);
}

function CloseIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <line x1="2" y1="2" x2="8" y2="8" />
      <line x1="8" y1="2" x2="2" y2="8" />
    </svg>
  );
}

export function TabBar({ tabs, activeTabId, mobile = false, onSelectTab, onCloseTab }: Props) {
  const { t } = useI18n();
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const mobileListId = useId();
  const mobilePickerRef = useRef<HTMLDivElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  useEffect(() => {
    if (!mobileListOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (mobilePickerRef.current && event.composedPath().includes(mobilePickerRef.current)) return;
      setMobileListOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileListOpen(false);
      mobileTriggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileListOpen]);

  if (mobile) {
    return (
      <div ref={mobilePickerRef} style={{ position: "relative", height: 44, background: "var(--bg-panel)" }}>
        <button
          ref={mobileTriggerRef}
          type="button"
          className="ui-action"
          data-hover="accent"
          data-open={mobileListOpen ? "true" : undefined}
          onClick={() => setMobileListOpen((open) => !open)}
          aria-expanded={mobileListOpen}
          aria-controls={mobileListId}
          aria-haspopup="true"
          aria-label={`${t("files.openTabs")} (${tabs.length})`}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            width: "100%", height: 44, minWidth: 0,
            padding: "0 12px", border: "none",
            color: "var(--text)", fontSize: 12, textAlign: "left",
          }}
        >
          {activeTab && <span style={{ display: "flex", flexShrink: 0 }}><TabIcon tab={activeTab} /></span>}
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
            {activeTab?.label ?? t("files.openTabs")}
          </span>
          <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>{tabs.length}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
            <polyline points={mobileListOpen ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
          </svg>
        </button>

        {mobileListOpen && (
          <div
            id={mobileListId}
            aria-label={t("files.openTabs")}
            style={{
              position: "absolute", top: 44, left: 0, zIndex: 3,
              width: "100%", maxHeight: "calc(var(--app-viewport-height, 100dvh) - var(--chat-panel-safe-top) - 60px)",
              overflowY: "auto", overscrollBehavior: "contain",
              background: "var(--bg-panel)", borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
              boxShadow: "var(--popover-shadow)",
            }}
          >
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div key={tab.id} style={{ display: "flex", minHeight: 44, borderBottom: "1px solid var(--border)", background: isActive ? "var(--bg-selected)" : "transparent" }}>
                  <button
                    type="button"
                    className="ui-action"
                    onClick={() => { onSelectTab(tab.id); setMobileListOpen(false); }}
                    aria-current={isActive ? "page" : undefined}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      flex: 1, minWidth: 0, padding: "0 12px", border: "none", background: "transparent",
                      color: isActive ? "var(--text)" : "var(--text-muted)", fontSize: 12, textAlign: "left",
                    }}
                  >
                    <span style={{ display: "flex", flexShrink: 0, opacity: isActive ? 1 : 0.7 }}><TabIcon tab={tab} /></span>
                    <span title={tab.filePath} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: isActive ? 500 : 400 }}>
                      {tab.label}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ui-action"
                    onClick={() => { onCloseTab(tab.id); if (tabs.length === 1) setMobileListOpen(false); }}
                    title={t("i18n.close")}
                    aria-label={`${t("i18n.close")} ${tab.label}`}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: 44, minWidth: 44, height: 44, padding: 0,
                      border: "none", borderLeft: "1px solid var(--border)", background: "transparent", color: "var(--text-dim)",
                    }}
                  >
                    <CloseIcon />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        background: "var(--bg-panel)",
        overflowX: "auto",
        flexShrink: 0,
        height: 36,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              onCloseTab(tab.id);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 36,
              paddingLeft: 12,
              paddingRight: 6,
              borderRight: "1px solid var(--border)",
              background: isActive ? "var(--bg)" : "var(--bg-panel)",
              cursor: "pointer",
              fontSize: 12,
              color: isActive ? "var(--text)" : "var(--text-muted)",
              whiteSpace: "nowrap",
              maxWidth: 180,
              minWidth: 80,
              flexShrink: 0,
              userSelect: "none",
              transition: "background 0.1s, color 0.1s",
            }}
          >
            <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7, display: "flex", alignItems: "center" }}>
              <TabIcon tab={tab} />
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
                fontWeight: isActive ? 500 : 400,
              }}
              title={tab.filePath}
            >
              {tab.label}
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              onMouseEnter={() => setHoveredClose(tab.id)}
              onMouseLeave={() => setHoveredClose(null)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 24, height: 24,
                background: hoveredClose === tab.id ? "var(--bg-hover)" : "transparent",
                border: "none",
                borderRadius: 0,
                color: hoveredClose === tab.id ? "var(--text)" : "var(--text-dim)",
                cursor: "pointer",
                padding: 0,
                flexShrink: 0,
                transition: "background 0.1s, color 0.1s",
              }}
              title={t("i18n.close")}
              aria-label={`${t("i18n.close")} ${tab.label}`}
            >
              <CloseIcon />
            </button>
          </div>
        );
      })}
    </div>
  );
}
