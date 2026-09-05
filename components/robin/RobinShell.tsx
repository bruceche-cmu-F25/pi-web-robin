"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import { useIsSplitLayout } from "@/hooks/useIsMobile";
import { RobinMargin } from "./RobinMargin";
import { AssistantPalette } from "./AssistantPalette";

/** Shared top navigation on wide screens and an off-canvas drawer on narrow screens. */
export function RobinShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname() ?? "";
  const inline = useIsSplitLayout();
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (inline) setOpen(false);
  }, [inline]);

  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setSettled(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);

  useEffect(() => {
    if (!inline && open) navRef.current?.focus();
  }, [inline, open]);

  const closeDrawer = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (inline || !open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDrawer, inline, open]);

  const state = `${open ? "robin-navigation-open" : "robin-navigation-closed"}${settled ? "" : " robin-navigation-pending"}`;

  return (
    <div className="robin-shell">
      <button
        ref={triggerRef}
        type="button"
        className="robin-mobile-nav-trigger"
        onClick={() => setOpen(true)}
        aria-controls="robin-navigation"
        aria-expanded={open}
        aria-label={t("sidebar.show")}
        title={t("sidebar.show")}
      >
        <span /><span /><span />
      </button>

      <button
        type="button"
        className={`robin-navigation-scrim${open ? " is-open" : ""}${settled ? "" : " robin-navigation-pending"}`}
        onClick={closeDrawer}
        aria-label={t("sidebar.hide")}
        tabIndex={open && !inline ? 0 : -1}
      />

      <div
        ref={navRef}
        id="robin-navigation"
        className={`robin-navigation-container ${state}`}
        inert={!inline && !open}
        tabIndex={-1}
      >
        <RobinMargin
          drawer={!inline}
          onClose={closeDrawer}
          onNavigate={inline ? undefined : closeDrawer}
        />
      </div>

      <div
        className={`robin-shell-content${pathname === "/dashboard" ? " is-dashboard" : ""}`}
        inert={!inline && open}
      >
        {children}
      </div>

      <AssistantPalette />
    </div>
  );
}
