"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";

export const CODING_TRACKS = ["problems", "curriculum"] as const;
export type CodingTrack = (typeof CODING_TRACKS)[number];

export function isCodingTrack(value: unknown): value is CodingTrack {
  return typeof value === "string" && (CODING_TRACKS as readonly string[]).includes(value);
}

/** What the shell hands each workspace so it can draw the shared chrome. */
export interface WorkspaceChrome {
  track: CodingTrack;
  onTrackChange: (track: CodingTrack) => void;
  /** Where the chat link goes back to — the session or cwd this was opened with. */
  chatHref: string;
}

/**
 * One pane of a workspace, on a phone where the columns become a stack of one.
 *
 * `active === null` means "not a phone": the wrapper leaves the box tree
 * entirely and the pane stays a direct flex item of the row, at whatever width
 * the divider beside it gave it. So the desktop layout is not merely
 * unchanged, it is the same layout.
 *
 * The panes that are not showing are hidden rather than unmounted. The
 * problems track's middle pane is a cross-origin application with a code
 * editor in it: unmounting it on a pane switch reloads NeetCode and takes
 * whatever had been typed with it.
 */
export function WorkspacePane({
  active,
  children,
}: {
  active: boolean | null;
  children: ReactNode;
}) {
  return (
    <div
      style={
        active === null
          ? { display: "contents" }
          : {
            display: active ? "flex" : "none",
            flexDirection: "column",
            flex: 1,
            minWidth: 0,
            minHeight: 0,
          }
      }
    >
      {children}
    </div>
  );
}

/** The phone-only switcher that says which single pane is on screen. */
export function WorkspacePaneSwitch<Pane extends string>({
  panes,
  active,
  onChange,
}: {
  panes: readonly { readonly id: Pane; readonly labelKey: string }[];
  active: Pane;
  onChange: (pane: Pane) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap items-baseline gap-2">
      {panes.map(({ id, labelKey }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className="ui-action pi-chrome-label pi-bracket"
          data-state={id === active ? "accent" : undefined}
          style={{ fontSize: 10 }}
          aria-current={id === active ? "true" : undefined}
        >
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
}

/**
 * The one header both workspaces render.
 *
 * The alternative was for the shell to own the header and each workspace to
 * hand its controls up, which reads fine until you notice that the rail
 * toggle, the next-item link, and the error line are all per-workspace and
 * would have to travel through the shell to get here. So the workspace renders
 * this and puts its own controls in as children — the shared parts stay in one
 * file, and the specific parts stay where they are used.
 */
export function WorkspaceHeader({
  track,
  onTrackChange,
  chatHref,
  children,
}: WorkspaceChrome & { children?: ReactNode }) {
  const { t } = useI18n();

  return (
    <header
      className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b px-3 py-2"
      style={{ borderColor: "var(--border)" }}
    >
      <h1 className="pi-label">{t("coding.title")}</h1>

      <div className="flex flex-wrap items-baseline gap-2">
        {CODING_TRACKS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => onTrackChange(candidate)}
            className="ui-action pi-chrome-label pi-bracket"
            data-state={candidate === track ? "accent" : undefined}
            style={{ fontSize: 10 }}
            aria-current={candidate === track ? "true" : undefined}
          >
            {t(`coding.track.${candidate}`)}
          </button>
        ))}
      </div>

      {children}

      <nav className="ml-auto flex flex-wrap items-baseline gap-3">
        {/* These are deliberately native navigations rather than next/link.
            A client-side RSC fetch can fail silently on a Basic Auth 401;
            a document navigation lets the browser show the login prompt. */}
        <a href="/learn" className="ui-action pi-chrome-label pi-bracket" style={{ fontSize: 10 }}>
          {t("robin.nav.learn")}
        </a>
        <a href="/dashboard" className="ui-action pi-chrome-label pi-bracket" style={{ fontSize: 10 }}>
          {t("robin.nav.back")}
        </a>
        {/* Carries the session or cwd it was opened with, so leaving the
            workspace lands on the chat you came from rather than whatever
            the app last had open. Same contract as the dashboard's link. */}
        <a
          href={chatHref}
          className="ui-action pi-chrome-label pi-bracket"
          data-state="accent"
          style={{ fontSize: 10 }}
        >
          {t("robin.nav.chat")}
        </a>
      </nav>
    </header>
  );
}
