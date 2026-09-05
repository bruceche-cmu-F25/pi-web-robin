"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getInitialNavigation } from "@/lib/initial-navigation";
import type { MailReview } from "@/extension/robin/mail";
import type { Job } from "@/extension/robin/jobs";
import type { PracticeRecord } from "@/extension/robin/practice";
import type { TechEvent } from "@/extension/robin/tech-events";
import type { Todo } from "@/extension/robin/todo-domain";
import { usePolledResource } from "./usePolledResource";

interface TodosResponse {
  todos: Todo[];
  today: string;
}

interface GmailResponse {
  review: MailReview | null;
}

interface JobsResponse {
  jobs: Job[];
}

interface PracticeResponse {
  records: PracticeRecord[];
  today: string;
}

interface TechEventsResponse {
  events: TechEvent[];
}

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
type NavTone = "clay" | "sage" | "teal" | "slate" | "plum" | "honey" | "fern";

interface NavStatus {
  count?: number;
  hasNew?: boolean;
}

interface NavItem {
  href: string;
  path: string;
  label: string;
  icon: Icon;
  tone: NavTone;
  status?: NavStatus;
  exact?: boolean;
  /**
   * Extra path prefixes this entry owns. The coding workspace is reached
   * through the hub rather than from the bar, so without this the bar would go
   * blank the moment you opened a problem — no entry marked, and no way to
   * tell which part of the app you were in.
   */
  covers?: string[];
}

const ATTENTION_MAIL_CATEGORIES = new Set(["important", "interview", "oa", "deadline"]);

function isCurrent(pathname: string, item: NavItem): boolean {
  const under = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
  if (item.covers?.some(under)) return true;
  return item.exact ? pathname === item.path : under(item.path);
}

function NavBadge({ status, actionLabel, newLabel }: {
  status?: NavStatus;
  actionLabel: (count: number) => string;
  newLabel: string;
}) {
  if (status?.count) {
    return (
      <span className="robin-nav-badge" aria-label={actionLabel(status.count)} title={actionLabel(status.count)}>
        {status.count > 99 ? "99+" : status.count}
      </span>
    );
  }
  if (status?.hasNew) {
    return <span className="robin-nav-dot" aria-label={newLabel} title={newLabel} />;
  }
  return null;
}

function NavEntry({ item, pathname, onNavigate }: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const current = isCurrent(pathname, item);
  const IconComponent = item.icon;

  return (
    <a
      href={item.href}
      onClick={onNavigate}
      className={`robin-nav-entry${current ? " is-current" : ""}`}
      aria-current={current ? "page" : undefined}
    >
      <span className="robin-nav-icon" style={{ color: `var(--todo-${item.tone})` }}>
        <IconComponent aria-hidden="true" />
      </span>
      <span className="robin-nav-label">{item.label}</span>
      <NavBadge
        status={item.status}
        actionLabel={(count) => t("robin.nav.actionCount", { count })}
        newLabel={t("robin.nav.newContent")}
      />
    </a>
  );
}

export function RobinMargin({ drawer, onClose, onNavigate }: {
  drawer: boolean;
  onClose: () => void;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const { sessionId, requestedCwd: cwd } = getInitialNavigation(searchParams);
  const withChatContext = (path: string) => sessionId
    ? `${path}?session=${encodeURIComponent(sessionId)}`
    : cwd
      ? `${path}?cwd=${encodeURIComponent(cwd)}`
      : path;
  const chatHref = withChatContext("/");

  const todos = usePolledResource<TodosResponse>("/api/robin/todos", 60_000).data;
  const gmail = usePolledResource<GmailResponse>("/api/robin/gmail", 60_000).data;
  const jobs = usePolledResource<JobsResponse>("/api/robin/jobs", 60_000).data;
  const practice = usePolledResource<PracticeResponse>("/api/robin/practice", 60_000).data;
  const techEvents = usePolledResource<TechEventsResponse>("/api/robin/tech-events", 60_000).data;

  const dashboardActions = (todos?.todos ?? []).filter(
    (todo) => !todo.done && todo.due && todo.due <= todos!.today,
  ).length;
  const mailItems = gmail?.review?.items ?? [];
  const gmailActions = mailItems.filter((item) => ATTENTION_MAIL_CATEGORIES.has(item.category)).length;
  const jobItems = jobs?.jobs ?? [];
  const jobsActions = jobItems.filter((job) => job.status === "shortlist").length;
  const jobsNew = jobItems.some((job) => job.status === "new");
  // The badge counts what you decided to go to, not what exists: a city feed
  // always has something on, so a count of "upcoming" would sit at a
  // permanent 40 and stop meaning anything.
  const eventItems = (techEvents?.events ?? []).filter((event) => !event.hidden);
  const savedEvents = eventItems.filter((event) => event.saved).length;
  const upcomingEvents = eventItems.length;
  const learningActions = (practice?.records ?? []).filter(
    (record) => record.status === "solved"
      && record.nextReviewOn
      && record.nextReviewOn <= practice!.today,
  ).length;

  const mainItems: NavItem[] = [
    {
      href: withChatContext("/dashboard"),
      path: "/dashboard",
      label: t("sidebar.dashboard"),
      icon: DashboardIcon,
      tone: "clay",
      status: { count: dashboardActions },
      exact: true,
    },
    {
      href: withChatContext("/dashboard/gmail"),
      path: "/dashboard/gmail",
      label: t("robin.nav.gmail"),
      icon: GmailIcon,
      tone: "sage",
      status: { count: gmailActions, hasNew: mailItems.length > 0 && pathname !== "/dashboard/gmail" },
    },
    {
      href: withChatContext("/dashboard/jobs"),
      path: "/dashboard/jobs",
      label: t("robin.nav.jobs"),
      icon: JobsIcon,
      tone: "teal",
      status: { count: jobsActions, hasNew: jobsNew && pathname !== "/dashboard/jobs" },
    },
    {
      href: withChatContext("/dashboard/events"),
      path: "/dashboard/events",
      label: t("robin.nav.events"),
      icon: EventsIcon,
      // Reuses the chat entry's hue rather than adding a seventh. The six
      // tones are the calendar's hue families (see eventColors.ts), and a
      // stray colour outside that set reads as a different kind of thing.
      // Chat is in the utility row, so the two never sit side by side.
      tone: "plum",
      status: { count: savedEvents, hasNew: upcomingEvents > 0 && pathname !== "/dashboard/events" },
    },
    {
      href: withChatContext("/learn"),
      path: "/learn",
      label: t("robin.nav.learn"),
      icon: LearningIcon,
      tone: "slate",
      status: { count: learningActions },
      covers: ["/coding"],
    },
    {
      href: withChatContext("/research"),
      path: "/research",
      label: t("robin.nav.research"),
      icon: ResearchIcon,
      // Honey also belongs to settings, which lives in the utility row, so
      // the two never sit side by side — the same trade events makes with chat.
      tone: "honey",
    },
    {
      href: withChatContext("/product"),
      path: "/product",
      label: t("robin.nav.product"),
      icon: ProductIcon,
      // Fern is Product's own growth tone; Dashboard keeps clay, so the two
      // workspaces no longer begin and end the main navigation in the same hue.
      tone: "fern",
    },
  ];

  const utilityItems: NavItem[] = [
    {
      href: chatHref,
      path: "/",
      label: t("robin.nav.chatNav"),
      icon: ChatIcon,
      tone: "plum",
      exact: true,
    },
    {
      href: withChatContext("/dashboard/settings"),
      path: "/dashboard/settings",
      label: t("robin.nav.settings"),
      icon: SettingsIcon,
      tone: "honey",
    },
  ];

  return (
    <div className={`robin-nav${drawer ? " is-drawer" : " is-horizontal"}`}>
      {drawer && (
        <div className="robin-nav-header">
          <button
            type="button"
            className="robin-nav-close"
            onClick={onClose}
            aria-label={t("sidebar.hide")}
            title={t("sidebar.hide")}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}

      <nav className="robin-nav-main" aria-label={t("sidebar.mainNavigation")}>
        {mainItems.map((item) => (
          <NavEntry key={item.path} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </nav>

      <nav className="robin-nav-utility" aria-label={t("robin.nav.utilityNavigation")}>
        {utilityItems.map((item) => (
          <NavEntry key={item.path} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </nav>
    </div>
  );
}

function DashboardIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>;
}

function GmailIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" {...props}><path d="M3.5 6.5 12 13l8.5-6.5" /><path d="M4 7v11h16V7" /></svg>;
}

function JobsIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" {...props}><rect x="3" y="7" width="18" height="13" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2" /></svg>;
}

function EventsIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" {...props}><rect x="3" y="5" width="18" height="16" /><path d="M3 10h18M8 3v4M16 3v4" /><circle cx="12" cy="15" r="1.6" /></svg>;
}

function LearningIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" {...props}><path d="M4 4.5h6a3 3 0 0 1 3 3V21a3 3 0 0 0-3-3H4z" /><path d="M20 4.5h-4a3 3 0 0 0-3 3V21a3 3 0 0 1 3-3h4z" /></svg>;
}

function ResearchIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M10 3h4M10.5 3v6.2L5.2 18a2 2 0 0 0 1.7 3h10.2a2 2 0 0 0 1.7-3l-5.3-8.8V3" /><path d="M8 14h8" /></svg>;
}

function ProductIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" {...props}><path d="m12 3 8 4.5-8 4.5-8-4.5z" /><path d="m4 12 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" /></svg>;
}

function ChatIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" {...props}><path d="M20 15a3 3 0 0 1-3 3H9l-5 3V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z" /><path d="M9 9h6M9 13h4" /></svg>;
}

function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.12-1.3l2-1.55-2-3.46-2.45 1A7 7 0 0 0 14.2 5.4L13.85 3h-4l-.35 2.4a7 7 0 0 0-2.23 1.29l-2.45-1-2 3.46 2 1.55a7 7 0 0 0 0 2.6l-2 1.55 2 3.46 2.45-1A7 7 0 0 0 9.5 18.6l.35 2.4h4l.35-2.4a7 7 0 0 0 2.23-1.29l2.45 1 2-3.46-2-1.55A7 7 0 0 0 19 12Z" /></svg>;
}
