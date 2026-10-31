"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import { useChatAppearance } from "@/hooks/useChatAppearance";
import { useIsSplitLayout } from "@/hooks/useIsMobile";
import { useNavigationPlacement } from "@/hooks/useNavigationPlacement";
import { useDrawerGesture } from "@/hooks/useDrawerGesture";
import { RobinMargin } from "./RobinMargin";
import { AssistantPalette } from "./AssistantPalette";
import { LiquidGlassEffects } from "../LiquidGlassEffects";

/** Shared desktop navigation (left rail or top bar) and the existing narrow-screen drawer. */
export function RobinShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  useChatAppearance(); // Restore the same chat type scale on direct workspace visits.
  const pathname = usePathname() ?? "";
  const inline = useIsSplitLayout();
  const navigationPlacement = useNavigationPlacement();
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLButtonElement>(null);
  const [keyboardMotion, setKeyboardMotion] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (inline || pathname === "/dashboard") setOpen(false);
  }, [inline, pathname]);

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

  useDrawerGesture(navRef, scrimRef, !inline && open, closeDrawer);

  useEffect(() => {
    if (inline || !open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape inside a popover (the focus timer) closes that, not the drawer too.
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { setKeyboardMotion(true); closeDrawer(); }
      if (event.key === "Tab") {
        const panel = navRef.current;
        const controls = Array.from(panel?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), [tabindex="0"]') ?? []).filter(element => element.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDrawer, inline, open]);

  const state = `${open ? "robin-navigation-open" : "robin-navigation-closed"}${settled && !keyboardMotion ? "" : " robin-navigation-pending"}`;

  return (
    <div className="robin-shell" data-navigation-placement={navigationPlacement}
      onPointerDownCapture={() => setKeyboardMotion(false)}
      onKeyDownCapture={() => setKeyboardMotion(true)}>
      {pathname !== "/dashboard" && <button
        ref={triggerRef}
        type="button"
        className="robin-mobile-nav-trigger"
        onClick={(event) => { setKeyboardMotion(event.detail === 0); setOpen(true); }}
        aria-controls="robin-navigation"
        aria-expanded={open}
        aria-label={t("sidebar.show")}
        title={t("sidebar.show")}
      >
        <span /><span /><span />
      </button>}

      <button
        ref={scrimRef}
        type="button"
        className={`robin-navigation-scrim${open ? " is-open" : ""}${settled && !keyboardMotion ? "" : " robin-navigation-pending"}`}
        onClick={closeDrawer}
        aria-label={t("sidebar.hide")}
        tabIndex={-1}
      />

      <div
        ref={navRef}
        id="robin-navigation"
        className={`robin-navigation-container ${state}`}
        inert={!inline && !open}
        role={inline ? undefined : "dialog"}
        aria-modal={!inline && open ? true : undefined}
        aria-label={inline ? undefined : t("sidebar.mainNavigation")}
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
      <LiquidGlassEffects />
    </div>
  );
}
