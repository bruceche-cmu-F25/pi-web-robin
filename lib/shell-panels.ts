/**
 * Which of the shell's surfaces is showing.
 *
 * The sidebar, the right panel, the top panels and the mobile overflow menu are
 * four independent booleans on a desktop and four *mutually exclusive* ones on
 * a phone, where each is full-width and showing two at once means showing
 * neither. That rule used to live as `if (isMobile) setSidebarOpen(false)`
 * repeated at roughly ten call sites, which is ten chances to open something
 * that covers what the user just asked for.
 *
 * Pure, so the rules can be tested without a viewport: the reducer takes the
 * current viewport rather than storing it, because `useIsMobile()` already owns
 * that and a second copy could drift from it.
 *
 * Panel *geometry* is not here — `lib/panel-layout.ts` owns the breakpoints and
 * widths, and `hooks/useResizablePanel.ts` owns the drag.
 */

export const TOP_PANELS = ["agents", "branches", "system", "tools", "session"] as const;
export type TopPanel = (typeof TOP_PANELS)[number];

export interface ShellPanelState {
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  /** The panel hanging below the top bar, or null when none is open. */
  activeTopPanel: TopPanel | null;
  /** The phone toolbar's overflow menu. */
  mobileToolbarMoreOpen: boolean;
}

export interface Viewport {
  isMobile: boolean;
  /** Narrow enough that the toolbar overflows into a menu. */
  isNarrowMobile: boolean;
}

export type ShellPanelEvent =
  | { type: "toggle_sidebar" }
  | { type: "close_sidebar" }
  /** Ctrl/Cmd+F: show the sidebar and get everything else out of the way. */
  | { type: "focus_sidebar_for_search" }
  | { type: "toggle_right_panel" }
  | { type: "open_right_panel" }
  | { type: "close_right_panel" }
  | { type: "toggle_top_panel"; panel: TopPanel; keepMobileToolbar?: boolean }
  | { type: "open_top_panel"; panel: TopPanel }
  | { type: "close_top_panel" }
  /** Close this panel only if it is the one showing — it lost its reason to exist. */
  | { type: "close_top_panel_if"; panel: TopPanel }
  | { type: "toggle_mobile_more" }
  | { type: "open_mobile_more" }
  | { type: "close_mobile_more" }
  /** A tap that reveals a workspace: on a phone, clear what would cover it. */
  | { type: "reveal_workspace" };

export const INITIAL_SHELL_PANELS: ShellPanelState = {
  sidebarOpen: true,
  rightPanelOpen: false,
  activeTopPanel: null,
  mobileToolbarMoreOpen: false,
};

/** On a phone every surface is full-width, so showing one hides the rest. */
function clearMobileOverlays(state: ShellPanelState, viewport: Viewport): ShellPanelState {
  if (!viewport.isMobile) return state;
  return { ...state, sidebarOpen: false, activeTopPanel: null, mobileToolbarMoreOpen: false };
}

export function shellPanelReducer(
  state: ShellPanelState,
  event: ShellPanelEvent,
  viewport: Viewport,
): ShellPanelState {
  switch (event.type) {
    case "toggle_sidebar": {
      const cleared = state.sidebarOpen ? state : clearMobileOverlays(state, viewport);
      return { ...cleared, sidebarOpen: !state.sidebarOpen };
    }

    case "close_sidebar":
      return state.sidebarOpen ? { ...state, sidebarOpen: false } : state;

    case "focus_sidebar_for_search":
      // Always shows the sidebar, on any viewport — the shortcut's whole point.
      return { ...state, sidebarOpen: true, activeTopPanel: null, mobileToolbarMoreOpen: false };

    case "toggle_right_panel":
      return state.rightPanelOpen
        ? { ...state, rightPanelOpen: false }
        : { ...clearMobileOverlays(state, viewport), rightPanelOpen: true };

    case "open_right_panel":
      return { ...clearMobileOverlays(state, viewport), rightPanelOpen: true };

    case "close_right_panel":
      return state.rightPanelOpen ? { ...state, rightPanelOpen: false } : state;

    case "toggle_top_panel": {
      const opening = state.activeTopPanel !== event.panel;
      const base = viewport.isMobile ? { ...state, sidebarOpen: false } : state;
      return {
        ...base,
        activeTopPanel: opening ? event.panel : null,
        // The overflow menu stays open only when the tap came from inside it,
        // so the user can reach the next item without reopening the menu.
        mobileToolbarMoreOpen: Boolean(
          event.keepMobileToolbar && viewport.isMobile && viewport.isNarrowMobile,
        ),
      };
    }

    case "open_top_panel":
      return {
        ...(viewport.isMobile ? { ...state, sidebarOpen: false } : state),
        activeTopPanel: event.panel,
        mobileToolbarMoreOpen: false,
      };

    case "close_top_panel":
      return state.activeTopPanel === null ? state : { ...state, activeTopPanel: null };

    case "close_top_panel_if":
      return state.activeTopPanel === event.panel ? { ...state, activeTopPanel: null } : state;

    case "toggle_mobile_more":
      return {
        ...state,
        sidebarOpen: false,
        activeTopPanel: null,
        mobileToolbarMoreOpen: !state.mobileToolbarMoreOpen,
      };

    case "open_mobile_more":
      return state.mobileToolbarMoreOpen ? state : { ...state, mobileToolbarMoreOpen: true };

    case "close_mobile_more":
      return state.mobileToolbarMoreOpen ? { ...state, mobileToolbarMoreOpen: false } : state;

    case "reveal_workspace":
      return clearMobileOverlays(state, viewport);
  }
}
