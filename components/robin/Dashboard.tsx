"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import { getInitialNavigation } from "@/lib/initial-navigation";
import { useEffect, useState } from "react";
import { localDate, parseLocalDate } from "@/extension/robin/dates";
import { AssistantBar } from "./AssistantBar";
import { CalendarPanel } from "./CalendarPanel";
import { LinksPanel } from "./LinksPanel";
import { TodoPanel } from "./TodoPanel";
import { PiPageHeader } from "@/components/ui/PiPageHeader";

/**
 * Rendered on the client so the heading follows the viewer's clock. The panels
 * still bucket todos against the server's local date, which is where `due` was
 * written — see app/api/robin/todos/route.ts.
 */
function useLocalToday(): string | null {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setToday(localDate());
    update();
    // Cheap enough to just re-check every minute so the heading survives midnight.
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, []);
  return today;
}

export function Dashboard() {
  const { t, locale } = useI18n();
  const searchParams = useSearchParams();
  const { sessionId, requestedCwd: cwd } = getInitialNavigation(searchParams);
  const today = useLocalToday();
  const heading = today
    ? parseLocalDate(today).toLocaleDateString(locale, {
      weekday: "long",
      month: "long",
      day: "numeric",
    })
    : "";

  return (
    // globals.css locks html/body to the viewport height with
    // overflow:hidden for the chat shell. This page is a document, so it
    // supplies its own scroll container rather than changing that shared rule.
    <div className="pi-dashboard-page flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
      <main className="pi-dashboard-main mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 desktop:p-6">
      <PiPageHeader
        eyebrow="PI / DAILY"
        title={t("sidebar.dashboard")}
        subtitle={<span suppressHydrationWarning>{heading}</span>}
      >
        <Link href="/dashboard/settings">{t("robin.nav.settings")}</Link>
        <Link
          href={{
            pathname: "/",
            query: sessionId
              ? { session: sessionId }
              : cwd
                ? { cwd }
                : {},
          }}
        >
          {t("robin.nav.chat")}
        </Link>
      </PiPageHeader>

      <AssistantBar />

      {/* Full width: the week and month grids need the whole page to stay legible. */}
      <CalendarPanel />

      {/* Each section gets a full row; the links collection can grow without
          making the todo list look like a narrow sidebar. */}
      <div className="flex flex-col gap-4">
        <TodoPanel />
        <LinksPanel />
      </div>
      </main>
    </div>
  );
}
