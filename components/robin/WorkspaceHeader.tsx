"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";

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
 * The coding workspace's header: its title, then whatever controls the
 * workspace puts in as children. `compact` drops the title to a line of text
 * so the practice roadmap below gets the height.
 */
export function WorkspaceHeader({ children, compact = false }: { children?: ReactNode; compact?: boolean }) {
  const { t } = useI18n();

  return (
    <header
      className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b px-3 py-2"
      style={{ borderColor: "var(--border)" }}
    >
      {compact
        ? <h1 className="pi-eyebrow flex min-h-11 items-center">{t("coding.title")}</h1>
        : <h1 className="pi-label">{t("coding.title")}</h1>}
      {children}
    </header>
  );
}
