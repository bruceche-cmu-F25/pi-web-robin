"use client";
import { OutreachAutomation } from "./OutreachAutomation";

import outreachStyles from "./OutreachStatus.module.css";

import Link from "next/link";
import { memo, type CSSProperties, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { BALANCED_JARVIS_QUOTA, CORE_JARVIS_SEGMENTS, JARVIS_RESEARCH_LANES, JARVIS_RESEARCH_LANE_QUOTA, JARVIS_TARGET_PERSONAS, JARVIS_PERSONA_QUOTA, JARVIS_NEWS_BURDEN_KEYS, JARVIS_NEWS_BURDEN_MAX, JARVIS_SOCIAL_PLATFORMS, JARVIS_STATUSES, DEFAULT_JARVIS_OUTBOX, DEFAULT_JARVIS_DAILY, JARVIS_DELIVERY_POLICY, isCurrentValidationProspect, isJarvisFollowUpDue, jarvisSentToday, jarvisTier, hasJarvisSocialOutreach, JARVIS_PERSONA_PLAYBOOK, isQualifiedInfoExec, isResearchedTargetUser, isVerifiedJarvisTarget, isOutreachApprovedFor, jarvisContactMethods, newsBurdenTotal, jarvisComposeLinks, jarvisListPriority, type CoreJarvisSegment, type JarvisResearchLane, type JarvisLead, type JarvisPersona, type JarvisSegment, type JarvisState, type JarvisStatus, type JarvisTemplate } from "@/extension/robin/jarvis-shape";
import { mutate, usePolledResource } from "./usePolledResource";
import styles from "./JarvisDiscovery.module.css";
import { JarvisOutbox, queueOrder } from "./JarvisOutbox";
import { JarvisSocialOutreach } from "./JarvisSocialOutreach";
import { OutreachContacts } from "./OutreachContacts";
import { SocialTemplateEditor } from "./SocialTemplateEditor";
import { FollowUpTemplateEditor } from "./FollowUpTemplateEditor";
import { GoogleConnect } from "./GoogleConnect";
import { OutreachConnections } from "./OutreachConnections";
import { OutreachCrm } from "./OutreachCrm";
import { OutreachSent } from "./OutreachSent";
import { OutreachQueue } from "./OutreachQueue";
import { DEFAULT_SOCIAL_TEMPLATES, OUTREACH_STATES, outreachDisplayState, outreachDisplayRank, hasSentOutreach, isLinkedInConnectionPending, canAddToReviewQueue, canReviewChannel, channelName, OUTREACH_CHANNELS, outreachStage, socialDraft, inReviewQueue, inSendQueue, type OutreachChannel } from "@/extension/robin/outreach-shape";
import { JARVIS_OUTREACH_API, JARVIS_PREFERENCES_API, JARVIS_REPORT_API, JARVIS_STATE_API, jarvisActionApi } from "@/lib/jarvis-api";

const API = JARVIS_STATE_API;
const SEGMENTS: Record<JarvisSegment, [string, string]> = {
  info_exec: ["目标用户画像", "Target personas"],
  clinic: ["诊所 / 医疗运营", "Clinics / healthcare operators"],
  professional_services: ["专业服务", "Professional services"],
  nontech_exec: ["非科技行业管理者", "Non-tech executives"],
  small_tech: ["小型科技公司 · 非技术管理者", "Small tech · non-technical leaders"],
  founder: ["原名单 · 创始人 / CTO", "Original · founders / CTOs"], investor: ["原名单 · 投资人", "Original · investors"],
  product: ["原名单 · 产品 / 战略", "Original · product / strategy"], research: ["原名单 · 应用研究", "Original · applied research"],
};
const TARGET_DESCRIPTIONS: Record<typeof JARVIS_TARGET_PERSONAS[number], [string, string]> = {
  ecommerce_owner: ["亲自经营小型 DTC / Shopify 品牌、需要跨渠道判断变化的创办人和运营高管。", "Hands-on founders and operating executives at small DTC / Shopify brands who make cross-channel decisions."],
  healthcare_operator: ["对支付、监管、人员或运营变化负有决策责任的医疗经营者。", "Healthcare operators responsible for payer, regulatory, staffing or operating decisions."],
  cross_source_operator: ["有公开证据表明其持续筛选多个来源并据此决策的其他小型企业负责人。", "Other small-business operators with public evidence of cross-source monitoring and decision responsibility."],
};
const RESEARCH_LANES: Record<JarvisResearchLane, [string, string]> = {
  dtc_shopify: ["DTC / Shopify", "DTC / Shopify"], healthcare_operations: ["医疗运营", "Healthcare operations"], cross_source_operations: ["跨来源运营", "Cross-source operations"],
};
const PERSONAS: Record<JarvisPersona, [string, string]> = {
  grant_researcher: ["研究者", "Grant-seeking researcher"],
  nonprofit_operator: ["非营利 / 社会影响负责人", "Nonprofit / impact operator"],
  independent_creator: ["独立创作者", "Independent creator"],
  ecommerce_owner: ["Shopify / DTC 品牌主", "Shopify / DTC owner"],
  healthcare_operator: ["医疗机构经营者", "Healthcare operator"],
  cross_source_operator: ["跨来源运营负责人", "Cross-source operator"],
  legal_leader: ["交易 / 监管法律负责人", "Transaction / regulatory legal leader"],
  vc: ["旧画像 · VC", "Legacy · VC"], client_advisor: ["旧画像 · 顾问", "Legacy · advisor"],
  startup_leader: ["旧画像 · 创业公司", "Legacy · startup"], nontech_tech_leader: ["旧画像 · 技术高管", "Legacy · tech executive"],
  researcher: ["旧画像 · 研究者", "Legacy · researcher"],
};
const BURDEN: Record<typeof JARVIS_NEWS_BURDEN_KEYS[number], [string, string]> = {
  change: ["变化速度", "Pace of change"], breadth: ["信息面", "Breadth"], unfiltered: ["无人代筛", "No one filters"], footprint: ["可建画像", "Public footprint"],
};
/** Contacts a batch approval can queue: unsent, with an address seen on its source page. */
const isCurrentCandidate = isCurrentValidationProspect;
const canQueue = (lead: JarvisLead) => isVerifiedJarvisTarget(lead) && !hasJarvisSocialOutreach(lead) && ["new", "ready"].includes(lead.status) && !lead.sendAttempt && !lead.sentAt && !lead.queuedAt && Boolean(lead.email) && lead.emailCheck === "source_found";
/** Sent with nothing back yet: nothing to do until a reply or the follow-up. */
const isArchived = (lead: JarvisLead) => lead.status === "sent";
const STATUSES: Record<JarvisStatus, [string, string]> = {
  new: ["待核对", "Needs review"], ready: ["待发送", "Ready"], sent: ["已联系", "Contacted"],
  replied: ["已回复", "Replied"], interested: ["有兴趣", "Interested"], declined: ["不感兴趣", "Declined"],
  bounced: ["退信", "Bounced"], do_not_contact: ["不再联系", "Do not contact"],
};
/** The pipeline reads left to right; the three dead ends share one "closed" column. */
const OPEN_STAGES = ["new", "ready", "sent", "replied", "interested"] as const satisfies readonly JarvisStatus[];
const CLOSED: readonly JarvisStatus[] = ["declined", "bounced", "do_not_contact"];
type StageFilter = JarvisStatus | "closed" | "all";
type SegmentFilter = JarvisSegment | "core" | "adjacent" | "all" | "exec";
type SortKey = "priority" | "burden" | "updated";
type Tab = "overview" | "email" | "social" | "activity";

// Built once per lead object; the payload is only re-parsed when the server's JSON changes.
const haystacks = new WeakMap<JarvisLead, string>();
const haystack = (lead: JarvisLead) => {
  let text = haystacks.get(lead);
  if (text === undefined) {
    text = `${lead.name} ${lead.company} ${lead.role} ${lead.industry} ${lead.seniority} ${lead.needHypothesis} ${lead.personLocation ?? ""} ${lead.companyLocation ?? ""} ${lead.timeZone ?? ""} ${lead.email} ${Object.values(lead.socials ?? {}).join(" ")}`.toLowerCase();
    haystacks.set(lead, text);
  }
  return text;
};
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function JarvisDiscovery() {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const t = (cn: string, en: string) => zh ? cn : en;
  // Poll fast only while research is writing new contacts; otherwise the list rarely changes.
  const [researching, setResearching] = useState(false);
  const { data, error, refresh } = usePolledResource<JarvisState>(API, researching ? 5000 : 30_000);
  const running = data?.run?.status === "running";
  const rescoring = data?.rescore?.status === "running";
  const websiteRunning = data?.websiteRun?.status === "running";
  useEffect(() => { setResearching(running || rescoring || websiteRunning); }, [running, rescoring, websiteRunning]);
  const [workspace, setWorkspace] = useState<"crm" | "contacts" | "review" | "send" | "sent" | "connections" | "templates" | "automation">("contacts");
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const toggleChecked = useCallback((id: string) => setChecked((set) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
  }), []);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [segment, setSegment] = useState<SegmentFilter>("info_exec");
  const [stage, setStage] = useState<StageFilter>("all");
  const [contactFilter, setContactFilter] = useState<"all" | "email" | "social" | "contacted" | "untouched">("all");
  const [reviewFilter, setReviewFilter] = useState<"all" | "pending" | "verified" | "adjacent">("all");
  const [persona, setPersona] = useState<JarvisPersona | null>(null);
  const [sort, setSort] = useState<SortKey>("priority");
  const [dueOnly, setDueOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [reviewNotice, setReviewNotice] = useState("");
  const [manualCount, setManualCount] = useState(30);
  const dirtyRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const benchRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const switchWorkspace = (next: typeof workspace) => {
    if (dirtyRef.current && !window.confirm(t("放弃未保存的修改？", "Discard unsaved edits?"))) return;
    dirtyRef.current = false; setWorkspace(next);
  };
  const onDirty = useCallback((dirty: boolean) => { dirtyRef.current = dirty; }, []);

  const leads = useMemo(() => data?.leads ?? [], [data]);
  const stats = useMemo(() => {
    const now = Date.now();
    const core = leads.filter((lead) => lead.audienceFit === "core");
    const byStage = Object.fromEntries(JARVIS_STATUSES.map((s) => [s, 0])) as Record<JarvisStatus, number>;
    for (const lead of leads) byStage[outreachStage(lead)]++;
    const due = new Set(leads.filter((lead) => isJarvisFollowUpDue(lead, now)).map((lead) => lead.id));
    return {
      core, byStage, due,
      adjacent: leads.length - core.length,
      researched: leads.filter(isResearchedTargetUser).length,
      candidates: leads.filter(isCurrentCandidate).length,
      instagram: leads.filter((lead) => isCurrentCandidate(lead) && Boolean(lead.socials?.instagram)).length,
      websiteChecked: leads.filter((lead) => isCurrentCandidate(lead) && Boolean(lead.websiteResearch)).length,
      websiteFound: leads.filter((lead) => isCurrentCandidate(lead) && lead.websiteResearch?.status === "found").length,
      verified: leads.filter(isVerifiedJarvisTarget).length,
      pendingReview: leads.filter((lead) => isCurrentCandidate(lead) && (!lead.icpReview || lead.icpReview.verdict === "pending")).length,
      adjacentReview: leads.filter((lead) => lead.segment === "info_exec" && lead.icpReview?.verdict === "adjacent").length,
      emailReady: leads.filter((lead) => isCurrentCandidate(lead) && lead.email && !lead.sentAt).length,
      socialReady: leads.filter((lead) => isCurrentCandidate(lead) && !lead.sentAt && !hasJarvisSocialOutreach(lead) && lead.emailCheck !== "source_found" && JARVIS_SOCIAL_PLATFORMS.some((p) => lead.socials?.[p])).length,
      contacted: leads.filter((lead) => isResearchedTargetUser(lead) && (lead.sentAt || hasJarvisSocialOutreach(lead))).length,
      confirmedNeeds: leads.filter((lead) => isCurrentCandidate(lead) && Boolean(lead.confirmedNeeds.trim())).length,
      contactMethods: leads.filter(isQualifiedInfoExec).reduce((sum, lead) => sum + jarvisContactMethods(lead).length, 0),
      // Per-tier outcome: the experiment is whether executives reply, and whether A beats B.
      tiers: (["A", "B"] as const).map((tier) => {
        const rows = leads.filter((lead) => jarvisTier(lead) === tier);
        const sent = rows.filter((lead) => lead.sentAt);
        return { tier, total: rows.length, reachable: rows.filter((lead) => lead.emailCheck === "source_found" && !lead.sentAt).length, sent: sent.length, replied: sent.filter((lead) => lead.repliedAt).length };
      }),
      queued: leads.filter((lead) => lead.queuedAt && !lead.sendAttempt).length,
      unassessed: leads.filter((lead) => !lead.assessedAt && !CLOSED.includes(lead.status)).length,
      sentToday: jarvisSentToday(leads),
      unsentWithEmail: core.filter((lead) => lead.email && !lead.sentAt && !CLOSED.includes(lead.status)).length,
      coreSent: core.filter((lead) => lead.sentAt).length,
      coreReplied: core.filter((lead) => lead.repliedAt).length,
      // Match the discovery target: strict ICP, researched in the new cohort, with a public contact route.
      persona: Object.fromEntries(JARVIS_TARGET_PERSONAS.map((p) => [p, leads.filter((lead) => lead.persona === p && isCurrentCandidate(lead)).length])) as Record<typeof JARVIS_TARGET_PERSONAS[number], number>,
      lane: Object.fromEntries(JARVIS_RESEARCH_LANES.map((lane) => [lane, leads.filter((lead) => lead.sourcingLane === lane && isCurrentCandidate(lead)).length])) as Record<JarvisResearchLane, number>,
      cohort: Object.fromEntries(CORE_JARVIS_SEGMENTS.map((s) => [s, core.filter((lead) => lead.segment === s && lead.email).length])) as Record<CoreJarvisSegment, number>,
    };
  }, [leads]);
  const { core, due } = stats;

  const filtered = useMemo(() => {
    // Keep every current candidate visible, including those whose contact links were corrected or removed.
    const rows = leads.filter((lead) => (segment === "info_exec" ? isCurrentCandidate(lead) : segment === "all" || segment === lead.audienceFit || lead.segment === segment || (segment === "exec" && jarvisTier(lead) !== null))
      && (!persona || segment !== "info_exec" || lead.persona === persona)
      && (segment !== "info_exec" || reviewFilter === "all" || (lead.icpReview?.verdict ?? "pending") === reviewFilter)
      && (stage === "all" || (stage === "closed" ? CLOSED.includes(outreachStage(lead)) : outreachStage(lead) === stage))
      && (!dueOnly || due.has(lead.id))
      // Sent and awaiting a reply is done for now: archived unless asked for.
      && (showArchived || dueOnly || stage === "sent" || !isArchived(lead))
      && (!deferredQuery || haystack(lead).includes(deferredQuery)));
    const compare: Record<SortKey, (a: JarvisLead, b: JarvisLead) => number> = {
      priority: (a, b) => jarvisListPriority(a) - jarvisListPriority(b) || newsBurdenTotal(b) - newsBurdenTotal(a),
      burden: (a, b) => newsBurdenTotal(b) - newsBurdenTotal(a) || jarvisListPriority(a) - jarvisListPriority(b),
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    };
    return rows.sort((a, b) => outreachDisplayRank(a) - outreachDisplayRank(b) || (segment === "info_exec" && !persona
      ? JARVIS_TARGET_PERSONAS.indexOf(a.persona as typeof JARVIS_TARGET_PERSONAS[number]) - JARVIS_TARGET_PERSONAS.indexOf(b.persona as typeof JARVIS_TARGET_PERSONAS[number]) || compare[sort](a, b)
      : compare[sort](a, b)));
  }, [leads, segment, persona, stage, reviewFilter, dueOnly, due, deferredQuery, sort, showArchived]);
  const matchesChannel = (lead: JarvisLead, filter: typeof contactFilter) => filter === "all" || (filter === "untouched" ? outreachDisplayState(lead) === "untouched" : filter === "email"
    ? canReviewChannel(lead, "email")
    : filter === "social" ? JARVIS_SOCIAL_PLATFORMS.some((p) => canReviewChannel(lead, p))
    : Boolean(lead.sentAt || hasJarvisSocialOutreach(lead)));
  const visible = filtered.filter((lead) => matchesChannel(lead, contactFilter));
  const untouchedCount = leads.filter(lead => isCurrentCandidate(lead) && outreachDisplayState(lead) === "untouched").length;
  const showCurrentContacts = (untouchedOnly = false) => {
    if (dirtyRef.current && !window.confirm(t("放弃未保存的修改？", "Discard unsaved edits?"))) return;
    dirtyRef.current = false;
    setWorkspace("contacts"); setSegment("info_exec"); setPersona(null); setStage("all");
    setReviewFilter("all"); setContactFilter(untouchedOnly ? "untouched" : "all");
    setQuery(""); setDueOnly(false); setShowArchived(true); setSelected(null); setChecked(new Set());
    listRef.current?.scrollTo({ top: 0 });
  };
  const archivedCount = useMemo(() => leads.filter(isArchived).length, [leads]);

  const current = leads.find((lead) => lead.id === selected);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // Stable across selections, so memoized rows do not all re-render on each click.
  const selectLead = useCallback((id: string) => {
    if (id === selectedRef.current) return;
    if (dirtyRef.current && !window.confirm(zh ? "放弃未保存的修改并切换联系人？" : "Discard unsaved edits and switch contacts?")) return;
    dirtyRef.current = false;
    setSelected(id);
    setTab("overview");
    // Stacked layout: the editor sits below the list, so bring it into view.
    if (window.matchMedia("(max-width: 960px)").matches) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: "start" }));
  }, [zh]);

  // A new contact opens at its top, and a new filter or sort starts the list over.
  useEffect(() => { detailRef.current?.scrollTo({ top: 0 }); }, [selected]);
  useEffect(() => { listRef.current?.scrollTo({ top: 0 }); }, [segment, persona, stage, contactFilter, dueOnly, sort, deferredQuery]);

  // Wide layout: until the panes dock at the top of the page, a downward wheel over
  // them moves the page. Otherwise the list or editor scrolls while most of it is
  // still below the fold, and the page seems stuck under the pointer.
  useEffect(() => {
    const page = pageRef.current, bench = benchRef.current;
    if (!page || !bench) return;
    const wide = window.matchMedia("(min-width: 961px)");
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY <= 0 || event.ctrlKey || !wide.matches) return;
      const dock = parseFloat(getComputedStyle(bench).getPropertyValue("--dock")) || 0;
      const gap = (listRef.current?.getBoundingClientRect().top ?? bench.getBoundingClientRect().top) - page.getBoundingClientRect().top - dock;
      if (gap < 1 || page.scrollTop + page.clientHeight >= page.scrollHeight - 1) return;
      event.preventDefault();
      const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? event.deltaY * page.clientHeight : event.deltaY;
      page.scrollBy({ top: Math.min(delta, gap) });
    };
    bench.addEventListener("wheel", onWheel, { passive: false });
    return () => bench.removeEventListener("wheel", onWheel);
  }, []);

  // j/k walk the visible list anywhere, ↓/↑ only from inside it so the arrows
  // still scroll the page; "/" jumps to search. Never while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (workspace !== "contacts" || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (event.key === "/") { event.preventDefault(); searchRef.current?.focus(); return; }
      const inList = event.target instanceof Node && Boolean(listRef.current?.contains(event.target));
      const step = event.key === "j" || (inList && event.key === "ArrowDown") ? 1 : event.key === "k" || (inList && event.key === "ArrowUp") ? -1 : 0;
      if (!step || !visible.length) return;
      event.preventDefault();
      const index = visible.findIndex((lead) => lead.id === selected);
      const next = visible[index < 0 ? 0 : Math.min(visible.length - 1, Math.max(0, index + step))];
      selectLead(next.id);
      const row = document.getElementById(`jarvis-row-${next.id}`);
      row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selected, selectLead, workspace]);

  const act = async (body: unknown) => {
    setBusy(true); setActionError("");
    try {
      const action = (body as { action?: unknown })?.action;
      if (typeof action !== "string") throw new Error("Jarvis action is required");
      await mutate(jarvisActionApi(action), "POST", body); await refresh();
    }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const start = (target: number) => {
    if (!window.confirm(t(`手动启动研究流水线，直到名单达到 ${target} 位有公开联系方式的品牌决策者。三个工作线程会独立保存结果；已由你审核并加入发送箱的邮件可继续限速发送，新发现的人不会自动联系。继续？`, `Start the research pipeline manually toward ${target} contactable brand decision-makers. Three workers save independently; previously reviewed and queued email may keep sending at the configured pace, while newly found people are never contacted automatically. Continue?`))) return;
    void act({ action: "discover", target, focus: "info_exec" });
  };
  const startInstagram = () => {
    const target = stats.instagram + 20;
    if (!window.confirm(t("寻找 20 位新的当前 ICP 目标用户，并要求每人都有可信本人 Instagram。医疗负责人仍只接受已核实个人工作邮箱。结果会进入待核对，不会自动私信。继续？", "Find 20 new current-ICP prospects with a trustworthy personal Instagram. Healthcare operators still require a verified individual work email. Results land in Needs review and are never auto-DMed. Continue?"))) return;
    void act({ action: "discover", target, focus: "info_exec", channelFocus: "instagram" });
  };
  const queueable = visible.filter(canQueue);
  const queuePosition = useMemo(() => new Map(queueOrder(leads).map((lead, index) => [lead.id, index + 1])), [leads]);
  const checkedLeads = [...checked].map((id) => leads.find((lead) => lead.id === id)).filter((lead): lead is JarvisLead => Boolean(lead && canAddToReviewQueue(lead)));
  const reviewQueue = leads.filter(inReviewQueue);
  const [sendFocus, setSendFocus] = useState<string | null>(null);
  const sentLeads = leads.filter((lead) => lead.sentAt || hasJarvisSocialOutreach(lead)).sort((a, b) => Math.max(...[b.sentAt, ...Object.values(b.socialOutreach ?? {}).map((s) => s.sentAt)].map((at) => at ? Date.parse(at) : 0)) - Math.max(...[a.sentAt, ...Object.values(a.socialOutreach ?? {}).map((s) => s.sentAt)].map((at) => at ? Date.parse(at) : 0)));
  const sendQueue = leads.filter(inSendQueue);
  const sendView = sendFocus ? [...leads.filter((lead) => lead.id === sendFocus), ...sendQueue.filter((lead) => lead.id !== sendFocus)] : sendQueue;
  const addToReview = async (ids: string[]) => {
    if (dirtyRef.current) { setActionError(t("请先保存联系人修改。", "Save contact edits first.")); return; }
    setBusy(true); setActionError("");
    try {
      setReviewNotice("");
      const response = await fetch(JARVIS_OUTREACH_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review-queue", op: "add", ids }) });
      const result = await response.json() as { added: number; skipped: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not add contacts to review");
      setReviewNotice(t(`本次新增 ${result.added} 人；跳过 ${result.skipped} 人（已在流程中或当前不可加入）。`, `Added ${result.added}; skipped ${result.skipped} (already in the workflow or currently unavailable).`));
      await refresh(); setChecked(new Set()); setWorkspace("review");
      pageRef.current?.scrollTo({ top: 0 });
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const openBatch = (channel: OutreachChannel, ids?: string[]) => {
    void channel;
    void addToReview(ids ?? checkedLeads.map((lead) => lead.id));
  };
  const outbox = { ...DEFAULT_JARVIS_OUTBOX, ...data?.outbox };
  const daily = { ...DEFAULT_JARVIS_DAILY, ...data?.daily };
  const [exported, setExported] = useState("");
  // Writes the same HTML as "HTML list" into the Jarvis.day repo's outreach/candidates.html.
  const syncJarvisDay = async () => {
    setBusy(true); setActionError("");
    try {
      await mutate(JARVIS_REPORT_API, "POST", {});
      setExported(new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }));
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const showFollowUps = () => { setSegment("all"); setStage("all"); setDueOnly(true); };
  const n = (value: number) => data ? value : "—";

  return <main ref={pageRef} className={`robin-page robin-dashboard ${styles.page}`}>
    <div className={styles.inner}>
      <header className={styles.header}>
        <div className={styles.title}>
          <span className="pi-eyebrow">PRODUCT OUTREACH CRM</span>
          <h1>Cold Reach</h1>
          <div className={styles.productBar}>
            <label>{t("产品 / Idea", "Product / idea")} <select aria-label={t("产品 / Idea", "Product / idea")} value="jarvis" onChange={() => {}}><option value="jarvis">Jarvis</option></select></label>
            <span>{t("跨领域个人情报过滤器 · DTC、医疗与跨来源运营", "Cross-domain personal intelligence · DTC, healthcare and cross-source operators")}</span>
            <Link href="/product" className="ui-action pi-bracket text-xs">{t("产品与想法", "Products & ideas")}</Link>
          </div>
        </div>
        <section className={styles.kpis} aria-label={t("探索进度", "Discovery progress")}>
          {([[leads.length, t("联系人", "Contacts")], [stats.byStage.new, t("待审核", "Needs review")], [stats.queued, t("邮件排队", "Email queued")], [stats.byStage.replied, t("已回复", "Replied")]] as const).map(([value, label]) => <div key={label}><strong>{n(value)}</strong><span>{label}</span></div>)}
        </section>
      </header>

      <div className={styles.routeFilters} aria-label={t("当前名单快捷入口", "Current list shortcuts")}>
        <button type="button" onClick={() => showCurrentContacts()}>{t(`当前名单 · ${stats.candidates} 人 · 清除筛选`, `Current list · ${stats.candidates} · Clear filters`)}</button>
        <button type="button" onClick={() => showCurrentContacts(true)}>{t(`○ 未处理 · ${untouchedCount} 人`, `○ Untouched · ${untouchedCount}`)}</button>
      </div>
      <nav className={styles.workflowNav} aria-label="Outreach workflow">
        <button aria-pressed={workspace === "automation"} onClick={() => switchWorkspace("automation")}>{t("自动任务", "Automation")}</button>
        <button aria-pressed={workspace === "crm"} onClick={() => switchWorkspace("crm")}>{t("CRM 概览", "CRM overview")}</button>
        <button aria-pressed={workspace === "contacts"} onClick={() => switchWorkspace("contacts")}>{t("1 · 选人", "1 · Contacts")}</button>
        <button aria-pressed={workspace === "review"} onClick={() => switchWorkspace("review")}>{t("2 · 审核队列", "2 · Review queue")} · {reviewQueue.length}</button>
        <button aria-pressed={workspace === "send"} onClick={() => { setSendFocus(null); switchWorkspace("send"); }}>{t("3 · 发送队列", "3 · Send queue")} · {sendQueue.length}</button>
        <button aria-pressed={workspace === "connections"} onClick={() => switchWorkspace("connections")}>Connect · {leads.filter((lead) => lead.linkedinConnection && !lead.linkedinConnection.acceptedAt).length}</button>
        <button aria-pressed={workspace === "sent"} onClick={() => switchWorkspace("sent")}>{t("已发送", "Sent")} · {sentLeads.length}</button>
        <button aria-pressed={workspace === "templates"} onClick={() => switchWorkspace("templates")}>{t("消息模板", "Message templates")}</button>
      </nav>
      <GoogleConnect account="outreach" onChanged={() => void refresh()} />
      <div hidden={workspace !== "contacts"}>
      <nav className={styles.pipeline} aria-label={t("联系阶段", "Pipeline stages")}>
        {OPEN_STAGES.map((s) => <button key={s} type="button" data-status={s} aria-pressed={stage === s} onClick={() => { setStage(stage === s ? "all" : s); setSegment("all"); setPersona(null); setReviewFilter("all"); setContactFilter("all"); setQuery(""); setShowArchived(true); setDueOnly(false); }}>
          <span>{STATUSES[s][zh ? 0 : 1]}</span><strong>{n(stats.byStage[s])}</strong>
        </button>)}
        <button type="button" className={styles.closedStage} data-status="closed" aria-pressed={stage === "closed"} onClick={() => { setStage(stage === "closed" ? "all" : "closed"); setSegment("all"); setContactFilter("all"); setQuery(""); setShowArchived(true); setDueOnly(false); }}>
          <span>{t("已结束", "Closed")}</span><strong>{n(CLOSED.reduce((sum, s) => sum + stats.byStage[s], 0))}</strong>
        </button>
      </nav>
      <p className="sr-only">{t("阶段计数包含 Jarvis 全部联系人的邮件和社媒进度。", "Stages include email and social outreach across all Jarvis contacts.")}</p>

      {due.size > 0 ? <div className={styles.followUpNotice} role="status" aria-atomic="true">
        <span>{t(`${due.size} 位联系人发信已满 ${JARVIS_DELIVERY_POLICY.followUpDelayHours} 小时，尚未记录回信或跟进。`, `${due.size} contacts were sent an email ${JARVIS_DELIVERY_POLICY.followUpDelayHours}+ hours ago, with no reply or follow-up recorded.`)}</span>
        <button type="button" className="ui-action pi-bracket" onClick={showFollowUps}>{t("查看待跟进", "View follow-ups")}</button>
      </div> : null}

      <details className={styles.workspaceSettings}>
        <summary>{t("ICP 与找人", "ICP & discovery")} <span>{running ? t("研究进行中", "Research running") : t("查看画像、公开来源与研究设置", "Personas, public sources and research settings")}</span></summary>
      <section className={styles.targetSection} aria-labelledby="jarvis-target-title">
        <div className={styles.targetIntro}>
          <div><span className="pi-eyebrow">VALIDATION SPRINT</span><h2 id="jarvis-target-title">{t("今天找到 100 位跨领域个人情报目标用户", "Find 100 cross-domain personal-intelligence prospects today")}</h2></div>
          <p>{t("下方是研究候选人，不等于已核实的 ICP。先确认职位、来源和个人联系入口；待核实与相邻人群不会进入邮件发送箱。", "These are research candidates, not verified ICPs. Confirm role, sources and a personal contact route first; pending and adjacent leads cannot enter the email outbox.")}</p>
        </div>
        <div className={styles.targetCards}>
          {JARVIS_TARGET_PERSONAS.map((p, i) => <button key={p} type="button" className={styles.targetCard} aria-pressed={segment === "info_exec" && persona === p} onClick={() => { setSegment("info_exec"); setPersona(p); setStage("all"); setQuery(""); setDueOnly(false); setShowArchived(true); setContactFilter("all"); benchRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); }}>
            <span className={styles.targetCardTop}><span>0{i + 1} / {JARVIS_PERSONA_QUOTA[p]}%</span><strong>{n(stats.persona[p])}</strong></span>
            <span className={styles.targetCardName}>{PERSONAS[p][zh ? 0 : 1]}</span>
            <span className={styles.targetCardDescription}>{TARGET_DESCRIPTIONS[p][zh ? 0 : 1]}</span>
            <span className={styles.targetCardAction}>{t("查看名单 →", "View list →")}</span>
          </button>)}
          {JARVIS_RESEARCH_LANES.map((lane) => <div key={lane} className={styles.targetCard}>
            <span className={styles.targetCardTop}><span>{JARVIS_RESEARCH_LANE_QUOTA[lane]} TARGET</span><strong>{n(stats.lane[lane])}</strong></span>
            <span className={styles.targetCardName}>{RESEARCH_LANES[lane][zh ? 0 : 1]}</span>
            <span className={styles.targetCardDescription}>{lane === "dtc_shopify" ? t("小型品牌中亲自负责渠道、库存、客户或运营决策的人。", "Hands-on leaders making channel, inventory, customer or operating decisions at small brands.") : lane === "healthcare_operations" ? t("对支付、监管、人员或运营变化负有决策责任的人。", "Leaders responsible for payer, regulatory, staffing or operating changes.") : t("有公开证据证明需要跨多个来源筛选信息并行动的运营负责人。", "Operators with public evidence that they filter multiple sources and act on the result.")}</span>
          </div>)}
        </div>
      </section>

      <details className={styles.research} open>
        <summary>
          <span className="pi-label">{t("研究队列", "Research queue")}</span>
          <span className={`text-xs ${styles.runLine}`} role={data?.run?.status === "error" ? "alert" : "status"}>{data?.run ? `${data.run.status} · ${data.run.message}` : t("事件驱动研究队列 · 三个独立工作线程", "Event-driven research queue · three independent workers")}</span>
          {data?.run?.lastError ? <p role="status" className="text-xs">{t("最近研究错误：", "Last research error: ")}{data.run.lastError}</p> : null}
          {running ? <span className={styles.pulse} aria-hidden /> : null}
        </summary>
        <p className="text-xs">{t("研究结果完成一个就立即保存，不再等待最慢赛道。已审核并入队的邮件可与研究同时限速发送；新发现的人仍需人工核验和批准，系统不会自动私信。", "Each completed result is saved immediately instead of waiting for the slowest lane. Reviewed, queued email may send at the configured pace while research runs; newly found people still require human verification and approval, and the system never auto-DMs.")}</p>
        <p className={`text-xs ${styles.runLine}`} role="status">{t(
          `候选人 ${stats.candidates} → 证据完整 ${stats.researched} → 人工核实 ${stats.verified} → 邮件排队 ${stats.queued}`,
          `Prospects ${stats.candidates} → evidence complete ${stats.researched} → human verified ${stats.verified} → email queued ${stats.queued}`,
        )}{data?.run?.pipeline ? ` · ${t("工作线程", "workers")} ${data.run.pipeline.activeWorkers} · ${t("任务完成", "completed")} ${data.run.pipeline.completed} · ${t("隔离失败", "isolated failures")} ${data.run.pipeline.failed}` : ""}</p>
        <details className={styles.playbook}>
          <summary>{t("每类目标用户从哪里找（研究时原样发给模型）", "Where each persona is searched for (sent to research verbatim)")}</summary>
          <dl>{JARVIS_TARGET_PERSONAS.map((p) => <div key={p}><dt>{PERSONAS[p][zh ? 0 : 1]} · {JARVIS_PERSONA_QUOTA[p]}%</dt><dd>{JARVIS_PERSONA_PLAYBOOK[p].replace(/^Persona \w+\.\s*/, "")}</dd></div>)}</dl>
          <p className="text-xs">{t("硬门槛：当前角色与决策职责；具体的跨来源信息筛选证据；需求匹配 ≥35/50；可联系性 ≥30/50；近期 why-now 事件；DTC / 其他运营者需本人 Instagram 或核实个人工作邮箱，医疗负责人必须有核实个人工作邮箱。职位名称本身不算需求证明。", "Hard gates: current role and decision responsibility; concrete evidence of cross-source information filtering; fit ≥35/50; reachability ≥30/50; a recent why-now event; DTC / other operators need a personal Instagram or verified individual work email, while healthcare operators require the verified email. A title alone is not need evidence.")}</p>
        </details>
        <div className={styles.daily} data-on={daily.enabled || undefined}>
          <label className={styles.dailySwitch}><input type="checkbox" checked={daily.enabled} disabled={busy || !data} onChange={(e) => void act({ action: "daily", enabled: e.target.checked })} />{t("每日自动研究", "Daily research")}</label>
          <label>{t("每天", "Every day at")} <select value={daily.hour} disabled={busy || !data} onChange={(e) => void act({ action: "daily", hour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select></label>
          <label>{t("找", "find")} <select value={daily.count} disabled={busy || !data} onChange={(e) => void act({ action: "daily", count: Number(e.target.value) })}>{[5, 10, 15, 20, 30, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select> {t("位有公开联系方式的核心 ICP", "contactable core ICPs")}</label>
          <span className="text-xs">{daily.lastRunOn ? t(`上次：${daily.lastRunOn}`, `Last: ${daily.lastRunOn}`) : t("尚未运行", "Not run yet")} · {t("新人进「待核对」，不会自动排队或发信", "New people land in Needs review; nothing is queued or sent")}</span>
        </div>
        {data?.rescore ? <p className={`text-xs ${styles.runLine}`} role={data.rescore.status === "error" ? "alert" : "status"}>{t("重新打分", "Rescoring")} · {data.rescore.status} · {data.rescore.message}</p> : null}
        <div className={styles.actions}>
          {running ? <button className="ui-action pi-bracket" disabled={busy} onClick={() => void act({ action: "stop" })}>{t("停止搜索", "Stop research")}</button> : <>
            <label>{t("本次新增", "Add")} <select value={manualCount} disabled={busy || !data} onChange={(event) => setManualCount(Number(event.target.value))}>{[3, 10, 30, 50, 100].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
            <button className="ui-action pi-bracket" disabled={busy || !data} onClick={() => start(stats.candidates + manualCount)}>{t("手动开跑研究流水线", "Run research pipeline")}</button>
            <button className="ui-action pi-bracket" disabled={busy || !data} onClick={startInstagram}>{t(`Instagram 优先补 20 人 · 当前 ${stats.instagram}`, `Add 20 Instagram-first prospects · ${stats.instagram} now`)}</button>
            <button className="ui-action pi-bracket" disabled={busy || !data || stats.candidates >= 100} onClick={() => start(100)}>{t("今天补齐 100 位有联系方式的候选人", "Research to 100 contactable prospects")}</button>
          </>}
          {rescoring ? <button className="ui-action pi-bracket" disabled={busy} onClick={() => void act({ action: "stop-rescore" })}>{t("停止重新打分", "Stop rescoring")}</button>
            : <button className="ui-action pi-bracket" disabled={busy || !data || stats.unassessed === 0} onClick={() => { if (window.confirm(t(`按三类新 ICP 给 ${stats.unassessed} 位旧联系人重新打分？会消耗模型和搜索额度；不会联系任何人。`, `Rescore ${stats.unassessed} old contacts against the three new ICPs? This uses model/search quota and contacts nobody.`))) void act({ action: "rescore" }); }}>{t(`重新打分现有联系人 · ${stats.unassessed}`, `Rescore existing contacts · ${stats.unassessed}`)}</button>}
          {websiteRunning ? <button className="ui-action pi-bracket" disabled={busy} onClick={() => void act({ action: "stop-website-enrich" })}>{t("停止官网补全", "Stop website enrichment")}</button>
            : <button className="ui-action pi-bracket" disabled={busy || !data} onClick={() => { if (window.confirm(t("检查当前 ICP 的官网、公开个人工作邮箱、电话和联系表单？结果逐个保存，但不会提交表单或发送消息。", "Check current-ICP official sites for public individual work emails, phone numbers and contact forms? Results are saved per contact; no form is submitted and no message is sent."))) void act({ action: "website-enrich" }); }}>{t(`补全官网联系方式 · 已检查 ${stats.websiteChecked}`, `Enrich website contacts · ${stats.websiteChecked} checked`)}</button>}
          <a className="ui-action pi-bracket" href="https://your-secretary.com" target="_blank" rel="noreferrer">{t("产品网站", "Product site")}</a>
        </div>
        {data?.websiteRun ? <p className={`text-xs ${styles.runLine}`} role={data.websiteRun.status === "error" ? "alert" : "status"}>{t("官网补全", "Website enrichment")} · {data.websiteRun.status} · {data.websiteRun.message}</p> : null}
      </details>
      </details>
      <details className={styles.workspaceSettings}>
        <summary>{t("话术与发送箱", "Copy & outbox")} <span>{t(`${stats.queued} 封排队 · 今日已发 ${stats.sentToday} 封`, `${stats.queued} queued · ${stats.sentToday} sent today`)}</span></summary>
        {data?.template ? <TemplateEditor template={data.template} refresh={refresh} zh={zh} /> : null}
        {data?.followUpTemplate ? <FollowUpTemplateEditor key={data.followUpTemplate} template={data.followUpTemplate} refresh={refresh} zh={zh} /> : null}
      <details className={styles.outboxContainer} open={stats.queued > 0 || Boolean(outbox.pausedReason) || undefined}>
        <summary><strong>{t("邮件发送箱", "Email outbox")}</strong><span>{t(`${stats.queued} 封排队 · 今日已发 ${stats.sentToday} 封`, `${stats.queued} queued · ${stats.sentToday} sent today`)}{outbox.pausedReason ? ` · ${t("发送已暂停", "Sending paused")}` : ""}</span></summary>
      <JarvisOutbox tiers={stats.tiers} leads={leads} outbox={data?.outbox} sentToday={stats.sentToday} checked={checkedLeads.length} queueable={queueable.length} busy={busy} zh={zh} locale={locale}
        onQueue={() => openBatch("email")} onTickAll={() => setChecked(new Set(queueable.map((lead) => lead.id)))} onClear={() => setChecked(new Set())}
        onToggle={() => void act({ action: "outbox", enabled: !(outbox.enabled && !outbox.pausedReason) })}
        onStart={(startAt) => { if (startAt || window.confirm(t("现在就开始发送排队的邮件？", "Start sending the queued emails now?"))) void act({ action: "outbox", enabled: true, startAt }); }}
        onUnqueue={(id) => void act({ action: "unqueue", ids: [id] })} onSelect={selectLead} onSync={() => void act({ action: "sync" })} onLimit={(dailyLimit) => void act({ action: "outbox", dailyLimit })} />
      </details>
      </details>
      {error || actionError ? <p role="alert" className={styles.error}>{error || actionError}</p> : null}

      <div className={styles.batchToolbar} aria-label={t("批量审核", "Batch review")}>
        <span>{t(`已选 ${checkedLeads.length}`, `${checkedLeads.length} selected`)}</span>
        <button type="button" className="ui-action pi-bracket" disabled={!visible.some(canAddToReviewQueue)} onClick={() => setChecked(new Set(visible.filter(canAddToReviewQueue).map((lead) => lead.id)))}>{t("全选尚未加入流程的人", "Select people not yet in workflow")}</button>
        <button type="button" className="ui-action pi-bracket" disabled={busy || !checkedLeads.length} onClick={() => void addToReview(checkedLeads.map((lead) => lead.id))}>{t(`加入审核队列 · ${checkedLeads.length} →`, `Add to review queue · ${checkedLeads.length} →`)}</button>
        {checkedLeads.length ? <button type="button" className="ui-action pi-bracket" onClick={() => setChecked(new Set())}>{t("清除", "Clear")}</button> : null}
        <small>{t("先选人，审核时再决定联系方式。", "Select people first; choose their contact channel during review.")}</small>
      </div>
      <div ref={benchRef} className={styles.workbench}>
        <div className={styles.filters}>
          <div className={styles.toolbar}>
            <label className={styles.search}><span className="sr-only">{t("搜索姓名、公司、行业、需求", "Search name, company, industry, needs")}</span>
              <input ref={searchRef} type="search" value={query} placeholder={t("搜索姓名、公司、行业…  /", "Search name, company, industry…  /")} onChange={(e) => setQuery(e.target.value)} /></label>
            <label><span className="sr-only">{t("排序", "Sort")}</span><select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="priority">{t("按下一步排序", "Next action first")}</option>
              <option value="burden">{t("按信息负担", "News burden")}</option>
              <option value="updated">{t("最近更新", "Recently updated")}</option>
            </select></label>
            {archivedCount ? <button type="button" className="ui-action pi-bracket" aria-pressed={showArchived} title={t("已发送、尚无回复的联系人自动归档", "Contacts sent an email with no reply yet are archived automatically")} onClick={() => setShowArchived((value) => !value)}>{showArchived ? t(`隐藏已归档 · ${archivedCount}`, `Hide archived · ${archivedCount}`) : t(`已归档 · ${archivedCount}`, `Archived · ${archivedCount}`)}</button> : null}
            {(due.size > 0 || dueOnly) ? <button type="button" className="ui-action pi-bracket" aria-pressed={dueOnly} onClick={() => { setDueOnly((value) => !value); setStage("all"); setSegment("all"); }}>{dueOnly ? t("显示全部", "Show all") : t(`待跟进 · ${due.size}`, `Follow-ups due · ${due.size}`)}</button> : null}
          </div>
          <div className={styles.routeFilters} role="group" aria-label={t("联系渠道", "Outreach channel")}>
            {([["all", t("全部渠道", "All channels")], ["email", t("Email 可审核", "Email to review")], ["social", t("社媒可审核", "Social to review")], ["contacted", t("已联系", "Contacted")]] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={contactFilter === key} onClick={() => setContactFilter(key)}>{label} <span>{filtered.filter((lead) => matchesChannel(lead, key)).length}</span></button>)}
          </div>
          <details className={styles.moreFilters}><summary>{t("更多筛选 · 画像、ICP 审核与历史名单", "More filters · persona, ICP review and historical lists")}</summary>
          <div className={styles.primaryFilters} role="group" aria-label={t("目标用户名单", "Target user lists")}>
            <button type="button" aria-pressed={segment === "info_exec" && persona === null} onClick={() => { setSegment("info_exec"); setPersona(null); setStage("all"); setQuery(""); setDueOnly(false); setShowArchived(true); setContactFilter("all"); }}>{t("当前目标客户", "Current target customers")} <span>{stats.candidates}</span></button>
            {JARVIS_TARGET_PERSONAS.map((p) => <button key={p} type="button" aria-pressed={segment === "info_exec" && persona === p} onClick={() => { setSegment("info_exec"); setPersona(p); setStage("all"); setQuery(""); setDueOnly(false); setShowArchived(true); setContactFilter("all"); }}>{PERSONAS[p][zh ? 0 : 1]} <span>{stats.persona[p]}</span></button>)}
          </div>
          <div className={styles.routeFilters} role="group" aria-label={t("ICP 复核", "ICP review")}>{([["all", t("全部候选", "All candidates"), stats.candidates], ["pending", t("待核实", "Needs review"), stats.pendingReview], ["verified", t("已核实", "Verified"), stats.verified], ["adjacent", t("相邻人群", "Adjacent"), stats.adjacentReview]] as const).map(([key, label, count]) => <button key={key} type="button" aria-pressed={reviewFilter === key} onClick={() => { setSegment("info_exec"); setContactFilter("all"); setReviewFilter(key); setStage("all"); }}>{label} <span>{count}</span></button>)}</div>
          <details className={styles.legacyFilters} open={segment !== "info_exec" || undefined}>
            <summary>{t("历史名单与其他人群", "Historical lists and other audiences")}{segment !== "info_exec" ? <span>{t("正在查看历史视图", "Viewing historical list")}</span> : null}</summary>
            <div className={styles.cohorts} role="group" aria-label={t("历史人群", "Historical cohorts")}>
            <button className="ui-action" aria-pressed={segment === "exec"} onClick={() => setSegment("exec")}>{t("旧 Executive · A+B", "Legacy executives · A+B")} <span>{stats.tiers[0]!.total + stats.tiers[1]!.total}</span></button>
            <button className="ui-action" aria-pressed={segment === "core"} onClick={() => setSegment("core")}>{t("旧核心受众", "Legacy core audience")} <span>{core.length}</span></button>
            {CORE_JARVIS_SEGMENTS.map((s) => {
              // The other balanced cohorts are retained for historical review, not the new ICP.
              if (s === "info_exec") return null;
              const [count, target] = [stats.cohort[s], BALANCED_JARVIS_QUOTA[s]];
              return <button key={s} className="ui-action" data-segment={s} style={{ "--p": `${Math.min(100, count / target * 100)}%` } as CSSProperties} aria-pressed={segment === s} onClick={() => setSegment(s)}>{SEGMENTS[s][zh ? 0 : 1]} <span>{count}/{target}</span></button>;
            })}
            <button className="ui-action" aria-pressed={segment === "adjacent"} onClick={() => setSegment("adjacent")}>{t("原科技圈名单", "Original tech-heavy list")} <span>{stats.adjacent}</span></button>
            <button className="ui-action" aria-pressed={segment === "all"} onClick={() => setSegment("all")}>{t("全部", "All")} <span>{leads.length}</span></button>
            </div>
          </details>
          </details>
          <p className={`text-xs ${styles.count}`} aria-live="polite">{data ? t(`${visible.length} 位 · 未处理优先 · 图标和颜色区分状态 · j/k 切换`, `${visible.length} shown · Untouched first · Status icons and colors · j/k to move`) : ""}</p>
        </div>
        <div className={styles.listPane}>
          <section ref={listRef} aria-label={t("候选人名单", "Candidates")} className={styles.list}>
            {!data ? <p role="status" className={styles.empty}>{t("正在读取名单…", "Loading contacts…")}</p> : visible.length === 0 ? <div className={styles.empty}><h2>{leads.length ? t("没有符合筛选条件的人", "No matching contacts") : t("第一位受访者，从这里开始。", "Your first conversation starts here.")}</h2><p>{segment === "info_exec" ? t("可清除搜索和阶段筛选，或在「研究队列」继续寻找。仅有公开联系方式且符合严格画像的人会进入当前名单。", "Clear the search or stage filter, or continue in Research queue. Only strict-ICP people with public contact routes appear in the current list.") : t("清除搜索或阶段筛选以查看更多历史联系人。", "Clear the search or stage filter to see more historical contacts.")}</p></div> : null}
            {visible.map((lead) => <LeadRow key={lead.id} lead={lead} zh={zh} active={selected === lead.id} due={due.has(lead.id)} onSelect={selectLead} checked={checked.has(lead.id)} onCheck={toggleChecked} position={queuePosition.get(lead.id)} showPersona={persona === null} />)}
          </section>

        </div>
        <section ref={detailRef} className={styles.detail} aria-label={t("联系人详情与邮件", "Contact details and email")}>
          {checkedLeads.length > 0 ? <section className={styles.selectionPanel} aria-label={t("已选联系人", "Selected people")}>
            <span className="pi-eyebrow">{t("下一步 · 人工审核", "NEXT · HUMAN REVIEW")}</span>
            <div className={styles.selectionTitle}><strong>{checkedLeads.length}</strong><div><h2>{t("位联系人已选", "people selected")}</h2><p>{t("准备好开始逐个审核了", "Ready for your review")}</p></div></div>
            <div className={styles.selectedNames}>{checkedLeads.slice(0, 5).map((lead) => <span key={lead.id}>{lead.name}</span>)}{checkedLeads.length > 5 ? <span>{t(`另 ${checkedLeads.length - 5} 人`, `+${checkedLeads.length - 5} more`)}</span> : null}</div>
            <button type="button" className={styles.selectionPrimary} disabled={busy} onClick={() => void addToReview(checkedLeads.map((lead) => lead.id))}>{busy ? t("正在加入…", "Adding…") : t("加入审核队列", "Add to review queue")}<span aria-hidden>→</span></button>
            <p className={styles.selectionHint}>{t("逐个核对资料和话术，通过后再进入发送队列。", "Review each person and their message, then move approved contacts to Send queue.")}</p>
            <div className={styles.selectionFooter}><span>{t("加入队列不会发送消息", "No messages sent at this step")}</span><button type="button" disabled={busy} onClick={() => setChecked(new Set())}>{t("取消选择", "Clear selection")}</button></div>
            {actionError ? <p role="alert">{actionError}</p> : null}
          </section> : null}
          {current ? <LeadEditor onReview={(channel) => openBatch(channel, [current.id])} key={current.id} lead={current} zh={zh} locale={locale} tab={tab} onTab={setTab} due={due.has(current.id)} refresh={refresh} onDirty={onDirty} /> : !checkedLeads.length ? <div className={styles.empty}>
            <span className="pi-eyebrow">REVIEW WORKFLOW</span>
            <h2>{checkedLeads.length ? t(`已选 ${checkedLeads.length} 人，准备审核`, `${checkedLeads.length} people selected for review`) : t("勾选左侧联系人，加入审核队列", "Select people to add to Review queue")}</h2>
            <ol className={styles.reviewSteps}>
              <li><strong>01</strong>{t("核对身份、职位与来源", "Check identity, role and sources")}</li>
              <li><strong>02</strong>{t("查看联系方式与个人邮件草稿", "Review contact route and personal draft")}</li>
              <li><strong>03</strong>{t("确认后再批准；未经批准不会发信", "Approve only after review; no automatic send")}</li>
            </ol>
          </div> : null}
        </section>
      </div>
      <details className={styles.workspaceSettings}><summary>{t("导出名单", "Export contacts")}</summary><div className={styles.actions}>
        <a className="ui-action pi-bracket" href={`${JARVIS_REPORT_API}?inline=1`} target="_blank" rel="noreferrer">{t("HTML 名单", "HTML list")}</a>
        <a className="ui-action pi-bracket" href={JARVIS_REPORT_API} download>{t("导出 HTML", "Export HTML")}</a>
        <button type="button" className="ui-action pi-bracket" disabled={busy} onClick={() => void syncJarvisDay()}>{exported ? t(`已同步 ${exported}`, `Synced ${exported}`) : t("同步到 Jarvis.day", "Sync to Jarvis.day")}</button>
      </div></details>
      </div>
      {reviewNotice ? <p role="status">{reviewNotice}</p> : null}
      {workspace !== "contacts" && actionError ? <p role="alert" className={styles.error}>{actionError}</p> : null}
      {workspace === "review" || workspace === "send" ? <OutreachQueue undo={data?.outreachUndo} key={workspace} leads={workspace === "review" ? reviewQueue : sendView} mode={workspace} zh={zh} refresh={refresh} onDirty={onDirty} onSendQueue={() => switchWorkspace("send")} /> : null}
      {workspace === "connections" ? <OutreachConnections undo={data?.outreachUndo} leads={leads} zh={zh} refresh={refresh} onMessage={(id) => { setSendFocus(id); switchWorkspace("send"); }} /> : null}
      {workspace === "automation" ? <OutreachAutomation zh={zh} /> : null}
      {workspace === "crm" ? <OutreachCrm leads={leads} zh={zh} loading={!data && !error} error={error} audienceLabel={(lead) => lead.persona ? PERSONAS[lead.persona][zh ? 0 : 1] : SEGMENTS[lead.segment][zh ? 0 : 1]} /> : null}
      {workspace === "sent" ? <OutreachSent leads={sentLeads} zh={zh} onPlan={(id) => { setSendFocus(id); switchWorkspace("send"); }} /> : null}
      {workspace === "templates" ? <section className={styles.templateWorkspace}><h2>{t("消息模板", "Message templates")}</h2><p>{t("分别编辑邮件、Instagram 和 LinkedIn 的联系话术。", "Edit email, Instagram and LinkedIn messages separately.")}</p>{data?.template ? <TemplateEditor template={data.template} refresh={refresh} zh={zh} /> : null}{data?.followUpTemplate ? <FollowUpTemplateEditor key={data.followUpTemplate} template={data.followUpTemplate} refresh={refresh} zh={zh} /> : null}{(["instagram", "linkedin"] as const).map(platform => <SocialTemplateEditor key={platform} platform={platform} template={data?.socialTemplates?.[platform] ?? DEFAULT_SOCIAL_TEMPLATES[platform]} refresh={refresh} zh={zh} />)}</section> : null}

    </div>
  </main>;
}

function TemplateEditor({ template, refresh, zh }: { template: JarvisTemplate; refresh: () => Promise<void>; zh: boolean }) {
  const t = (cn: string, en: string) => zh ? cn : en;
  const [draft, setDraft] = useState(template);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dirty = draft.subject !== template.subject || draft.body !== template.body;
  useEffect(() => { if (!dirty) setDraft(template); }, [template, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const request = async (dryRun: boolean) => {
    const response = await fetch(JARVIS_PREFERENCES_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "template", ...draft, dryRun }) });
    const result = await response.json().catch(() => null) as { updated?: number; kept?: number; sample?: { name: string; subject: string; body: string }; error?: string } | null;
    if (!response.ok || result?.updated === undefined || result.kept === undefined) throw new Error(result?.error ?? `Request failed (${response.status})`);
    return result;
  };
  const generate = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const preview = await request(true);
      if (!window.confirm(t(`将保存模板并重新生成 ${preview.updated} 份当前 ICP 的未修改草稿；其他 ${preview.kept} 份（含旧联系人、已编辑或已联系邮件）保持原样。不会排队或发送邮件。继续？`, `Save the template and regenerate ${preview.updated} untouched current-ICP drafts? The other ${preview.kept} drafts (including legacy, edited or contacted) stay unchanged. Nothing is queued or sent.`))) return;
      const result = await request(false);
      await refresh();
      setMessage(t(`已保存模板，生成 ${result.updated} 份草稿；保留 ${result.kept} 份。未发送邮件。`, `Template saved; ${result.updated} drafts generated, ${result.kept} kept. No email sent.`));
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  return <details className={styles.template}>
    <summary>{t("邮件模板 · 编辑与生成草稿", "Email template · edit and generate drafts")}{dirty ? <span>{t("未保存", "Unsaved")}</span> : null}</summary>
    <div className={styles.templateForm}>
      <p>{t("用于新发现的联系人。保存时仅重写当前严格 ICP 中未编辑、未批准、未排队的草稿；旧联系人和已联系邮件保留，不会发信。", "Used for newly discovered contacts. Saving only rewrites untouched, unapproved, unqueued strict-ICP drafts; legacy and contacted drafts stay unchanged. No mail is sent.")}</p>
      <label>{t("主题", "Subject")}<input value={draft.subject} maxLength={300} disabled={busy} onChange={(e) => { setDraft((value) => ({ ...value, subject: e.target.value })); setMessage(""); }} /></label>
      <label>{t("正文", "Body")}<textarea value={draft.body} maxLength={12000} rows={12} disabled={busy} onChange={(e) => { setDraft((value) => ({ ...value, body: e.target.value })); setMessage(""); }} /></label>
      <p className="text-xs">{t("可用变量：", "Placeholders: ")}<code>{"{{firstName}} {{name}} {{company}} {{role}} {{area}} {{work}} {{opener}} {{shortOpener}}"}</code></p>
      <button type="button" className="ui-action pi-bracket" disabled={busy || !dirty} onClick={() => void generate()}>{busy ? t("正在生成…", "Generating…") : t("保存模板并重新生成草稿", "Save template and regenerate drafts")}</button>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  </details>;
}

const emailState = (lead: JarvisLead, zh: boolean) => {
  const t = (cn: string, en: string) => zh ? cn : en;
  if (lead.email) return lead.emailCheck !== "source_found" ? t("邮箱 · 来源待核对", "Email · check source") : lead.reviewed ? t("邮箱 · 已人工核对", "Email · human-reviewed") : t("邮箱 · 有公开来源", "Email · public source");
  const social = jarvisContactMethods(lead).find((method) => method.platform !== "email");
  if (social) return t(`有 ${social.platform} · 人工联系`, `${social.platform} found · manual outreach`);
  return lead.segment === "info_exec" ? t("无公开联系方式", "No public contact route") : t("工作邮箱待补充", "Work email missing");
};

/** One dense row. Polls keep the same lead objects until the server JSON changes, so identity is enough. */
const LeadRow = memo(function LeadRow({ lead, zh, active, due, onSelect, checked, onCheck, position, showPersona }: { lead: JarvisLead; zh: boolean; active: boolean; due: boolean; onSelect: (id: string) => void; checked: boolean; onCheck: (id: string) => void; position?: number; showPersona: boolean }) {
  const t = (cn: string, en: string) => zh ? cn : en;
  const burden = lead.newsBurden ? newsBurdenTotal(lead) : null;
  const queued = Boolean(lead.queuedAt) && !lead.sendAttempt;
  const tier = jarvisTier(lead);
  const state = outreachDisplayState(lead);
  const marker = OUTREACH_STATES[state];
  const sent = hasSentOutreach(lead);
  const connectionPending = isLinkedInConnectionPending(lead);
  const socialSent = JARVIS_SOCIAL_PLATFORMS.find((platform) => lead.socialOutreach?.[platform]?.sentAt);
  const sendChip = socialSent ? t(`${socialSent} · 已人工联系`, `${socialSent} · contacted manually`) : queued ? t(`排队 #${position ?? "—"}`, `Queued #${position ?? "—"}`)
    : lead.sendAttempt?.state === "pending" ? t("发送中", "Sending")
    : lead.sendAttempt?.state === "uncertain" ? t("结果不确定", "Uncertain")
    : lead.repliedAt ? t("已回复", "Replied")
    : lead.followedUpAt || lead.followUpAttempt?.state === "sent" ? t("已跟进", "Followed up")
    : lead.sentAt ? t(`已发 ${new Date(lead.sentAt).toLocaleDateString(zh ? "zh-CN" : "en-US", { month: "numeric", day: "numeric" })}`, `Sent ${new Date(lead.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`)
    : null;
  const sendTone = queued || lead.sendAttempt?.state === "pending" ? "ready" : lead.sendAttempt?.state === "uncertain" ? "uncertain" : lead.repliedAt ? "replied" : "sent";
  return <div className={`${styles.rowWrap} ${outreachStyles.row}`} data-workflow={state} data-sent={sent || undefined} data-connect-pending={!sent && connectionPending || undefined} data-queued={queued || undefined} data-checked={checked || undefined}>
    <label className={styles.rowCheck} title={queued ? t("已排队", "Queued") : lead.outreachWorkflow ? t("已在审核、发送或 Connect 流程中，无需重复加入", "Already in review, send or Connect workflow") : canAddToReviewQueue(lead) ? t("选择以审核匹配理由与文案", "Select to review fit and copy") : t("已联系、排队或不再联系", "Contacted, queued or closed")}>
      <span className="sr-only">{t(`选择 ${lead.name}`, `Select ${lead.name}`)}</span>
      {queued ? <span aria-hidden>✓</span> : <input type="checkbox" checked={checked} disabled={!canAddToReviewQueue(lead)} onChange={() => onCheck(lead.id)} />}
    </label>
    <button id={`jarvis-row-${lead.id}`} type="button" className={styles.row} aria-pressed={active} onClick={() => onSelect(lead.id)}>
    <span className={styles.rowName}><i className={styles.dot} data-segment={lead.segment} title={SEGMENTS[lead.segment][zh ? 0 : 1]} aria-hidden /><strong>{lead.name}</strong>{sent ? <span className={styles.sendChip} data-tone="sent">{t("✓ 已发消息", "✓ Message sent")}</span> : null}{connectionPending && state !== "connect_pending" ? <span className={styles.sendChip} data-tone="ready">{t("Connect 待通过", "Connect pending")}</span> : null}{tier ? <span className={styles.tierBadge} data-tier={tier} title={t("模型评分，非人工核实", "Model score, not human verification")}>{tier}</span> : null}{lead.segment === "info_exec" ? <span className={styles.personaTag}>{lead.icpReview?.verdict === "verified" ? t("已核实", "Verified") : lead.icpReview?.verdict === "adjacent" ? t("相邻", "Adjacent") : t("待核实", "Unverified")}</span> : null}{due ? <span className={styles.followUpBadge}>{t("待跟进", "Follow up")}</span> : null}</span>
    <span className={outreachStyles.badge}>{marker[0]} {marker[zh ? 1 : 2]}</span>
    <span className={styles.rowMeta}>{lead.company} · {lead.role}</span>
    <span className={styles.rowSignals}>
      {burden !== null ? <span className={styles.burdenChip} data-level={burden >= 8 ? "high" : burden >= 5 ? "mid" : "low"}>{t("信息负担", "News burden")} {burden}/{JARVIS_NEWS_BURDEN_MAX}</span> : null}
      <span data-email={lead.email ? (lead.reviewed ? "reviewed" : "found") : "missing"}>{emailState(lead, zh)}</span>
    </span>
    <span className={styles.rowHint}>{sendChip ? <span className={styles.sendChip} data-tone={sendTone}>{sendChip}</span> : null}{showPersona && lead.persona ? <span className={styles.personaTag} data-persona={lead.persona}>{PERSONAS[lead.persona][zh ? 0 : 1]}</span> : null}{lead.industry}{lead.personLocation ? ` · ${lead.personLocation}` : ""}</span>
  </button>
  </div>;
});

function localTime(timeZone: string | undefined, locale: string) {
  if (!timeZone) return "";
  try { return new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date()); }
  catch { return ""; }
}

function LeadEditor({ lead, zh, locale, tab, onTab, due, refresh, onDirty, onReview }: { onReview: (channel: OutreachChannel) => void; lead: JarvisLead; zh: boolean; locale: string; tab: Tab; onTab: (tab: Tab) => void; due: boolean; refresh: () => Promise<void>; onDirty: (dirty: boolean) => void }) {
  const t = (cn: string, en: string) => zh ? cn : en;
  // Explicit Save avoids polling overwriting an unsaved email or interview note.
  const [draft, setDraft] = useState(() => ({ subject: lead.subject, body: lead.body, email: lead.email, emailSource: lead.emailSource, emailQuote: lead.emailQuote,
    notes: lead.notes, confirmedNeeds: lead.confirmedNeeds, role: lead.role, seniority: lead.seniority, industry: lead.industry, needHypothesis: lead.needHypothesis,
    personLocation: lead.personLocation ?? "", personLocationSource: lead.personLocationSource ?? "", companyLocation: lead.companyLocation ?? "", companyLocationSource: lead.companyLocationSource ?? "", timeZone: lead.timeZone ?? "" }));
  const [dirty, setDirty] = useState(false);
  const [copyChannel, setCopyChannel] = useState<OutreachChannel>(() => lead.email ? "email" : JARVIS_SOCIAL_PLATFORMS.find((p) => lead.socials?.[p]) ?? "email");
  const [socialDirty, setSocialDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reviewReason, setReviewReason] = useState(lead.icpReview?.reason ?? "");
  const [copied, setCopied] = useState("");
  const [sendAccess, setSendAccess] = useState(false);
  const [preview, setPreview] = useState<{ revision: number; email: string; subject: string; body: string } | null>(null);
  useEffect(() => { void loadSendAccess().then(setSendAccess); }, []);
  const connect = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/robin/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "connect", account: "outreach" }) });
      const result = await response.json() as { authorizeUrl?: string; error?: string };
      if (!response.ok || !result.authorizeUrl) throw new Error(result.error ?? "Google authorization failed");
      window.location.assign(result.authorizeUrl);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); setBusy(false); }
  };
  const send = async () => {
    if (!preview) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await mutate(JARVIS_OUTREACH_API, "POST", { action: "send", id: lead.id, revision: preview.revision, confirmed: true });
      setMessage(t("Gmail 已接受这封邮件并记录为已发送。", "Gmail accepted the message; recorded as Sent."));
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setPreview(null); await refresh(); setBusy(false); }
  };
  // Copies what is on screen, including unsaved edits: copying sends nothing.
  const copy = async (key: string, value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(key); window.setTimeout(() => setCopied((c) => c === key ? "" : c), 1500); }
    catch { setError(t("浏览器拒绝了剪贴板访问，请手动选择复制。", "The browser blocked clipboard access; select and copy manually.")); }
  };
  const copyButton = (key: string, label: string, value: string) => <button type="button" className="ui-action pi-bracket" disabled={!value || (lead.segment === "info_exec" && !isOutreachApprovedFor(lead, "email"))} onClick={() => void copy(key, value)}>{copied === key ? t("已复制", "Copied") : label}</button>;
  useEffect(() => { onDirty(dirty || socialDirty || busy); }, [dirty, socialDirty, busy, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => {
    if (!dirty && !socialDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, socialDirty]);
  const edit = (key: keyof typeof draft, value: string) => { setPreview(null); setDraft((d) => ({ ...d, [key]: value, ...(["personLocation", "personLocationSource"].includes(key) ? { timeZone: "" } : {}) })); setDirty(true); setMessage(""); };
  const save = async (patch: Record<string, unknown>) => {
    setPreview(null); setBusy(true); setError(""); setMessage("");
    try {
      await mutate(API, "PATCH", { id: lead.id, patch });
      setDirty(false); await refresh(); setMessage(patch.followUp ? t("已记录手动跟进；没有发送邮件。", "Manual follow-up recorded; no email was sent.") : t("已保存", "Saved"));
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const links = dirty || busy ? null : jarvisComposeLinks(lead);
  const blocked = CLOSED.includes(lead.status);
  const field = (key: keyof typeof draft, label: string, multiline = false, rows = 3) => <label>{label}{multiline ? <textarea disabled={busy} rows={rows} value={draft[key]} onChange={(e) => edit(key, e.target.value)} /> : <input disabled={busy} value={draft[key]} onChange={(e) => edit(key, e.target.value)} />}</label>;
  const clock = localTime(lead.timeZone, locale);
  const routes = jarvisContactMethods(lead);
  const tabs: Array<[Tab, string]> = [["overview", t("概览", "Overview")], ["email", t("邮件", "Email")], ["social", t("社媒", "Social")], ["activity", t("记录", "Notes")]];

  return <article className={styles.editor}>
    <header className={styles.editorHead} data-segment={lead.segment}>
      <span className={`pi-eyebrow ${styles.segmentTag}`} data-segment={lead.segment}>{lead.persona ? PERSONAS[lead.persona][zh ? 0 : 1] : SEGMENTS[lead.segment][zh ? 0 : 1]}</span>
      <h2>{lead.name}</h2>
      <p className={styles.editorRole}>{lead.role} · {lead.company}</p>
      <div className={styles.editorFacts}>
        <span className={styles.stage} data-status={outreachStage(lead)}>{STATUSES[outreachStage(lead)][zh ? 0 : 1]}</span>
        <span>{emailState(lead, zh)}</span>
        {lead.segment === "info_exec" ? <span>{lead.icpReview?.verdict === "verified" ? t("ICP 已核实", "ICP verified") : lead.icpReview?.verdict === "adjacent" ? t("相邻人群", "Adjacent audience") : t("ICP 待核实", "ICP unverified")}</span> : null}
        {clock ? <span>{t("对方当地", "Their time")} {clock}</span> : null}
        {lead.sentAt ? <span>{t("发信", "Sent")} {new Date(lead.sentAt).toLocaleDateString()}</span> : null}
      </div>
      <OutreachContacts lead={lead} zh={zh} />
    </header>

    <div className={styles.tabs} role="tablist" aria-label={t("联系人分区", "Contact sections")}>
      {tabs.map(([key, label]) => <button key={key} type="button" role="tab" id={`jarvis-tab-${key}`} aria-controls={`jarvis-panel-${key}`} aria-selected={tab === key} onClick={() => onTab(key)}>{label}</button>)}
    </div>

    {/* Panels stay mounted so a draft on one tab survives looking at another. */}
    <div role="tabpanel" id="jarvis-panel-overview" aria-labelledby="jarvis-tab-overview" hidden={tab !== "overview"} className={styles.panel}>
      <section className={styles.quickSummary}>
        <h3>{t("为什么适合", "Why they may fit")}</h3>
        <p>{lead.needHypothesis || lead.evidence}</p>
        <a href={lead.evidenceUrl} target="_blank" rel="noreferrer">{t("查看依据 ↗", "View evidence ↗")}</a>
        {lead.whyNow ? <p><strong>{t("近期动态：", "Why now: ")}</strong>{lead.whyNow.summary}</p> : null}
      </section>
      <section className={styles.quickSummary}>
        <div className={styles.copyHeading}><h3>{t("联系话术", "Outreach message")}</h3><select aria-label={t("预览话术渠道", "Message preview channel")} value={copyChannel} onChange={(event) => setCopyChannel(event.target.value as OutreachChannel)}>{OUTREACH_CHANNELS.filter((channel) => channel === "email" ? lead.email : lead.socials?.[channel]).map((channel) => <option key={channel} value={channel}>{channelName(channel)}</option>)}</select></div>
        {copyChannel === "email" ? <strong>{draft.subject}</strong> : null}
        <pre className={styles.quickCopy}>{copyChannel === "email" ? draft.body : socialDraft(lead, copyChannel)}</pre>
        <div className={styles.actions}><button type="button" className="ui-action pi-bracket" onClick={() => onTab(copyChannel === "email" ? "email" : "social")}>{t("编辑话术", "Edit message")}</button>{canReviewChannel(lead, copyChannel) ? <button type="button" className="ui-action pi-bracket" disabled={busy || dirty || socialDirty} onClick={() => onReview(copyChannel)}>{t("审核并准备联系 →", "Review & prepare →")}</button> : null}</div>
      </section>
      <details className={styles.detailExtras}><summary>{t("ICP 复核与资料编辑", "ICP review & profile editing")}</summary>
      {lead.segment === "info_exec" ? <section className={styles.contactSection}>
        <h3 className="pi-label">{t("人工 ICP 复核", "Human ICP review")}</h3>
        <p className="text-xs">{t("模型评分只代表候选假设。核对当前身份、真实决策职责、跨来源信息筛选证据、why-now、来源和个人联系入口；职位名称或无法读取的社交内容不能算已验证需求。", "The model score is only a candidate hypothesis. Check current identity, real decision responsibility, cross-source information-filtering evidence, why-now, sources and the personal contact route. A title or inaccessible social content is not verified demand.")}</p>
        <p className="text-xs" role="status">{lead.icpReview?.verdict === "verified" ? t("已核实", "Verified") : lead.icpReview?.verdict === "adjacent" ? t("相邻人群 · 不计入可联系名单", "Adjacent · not outreach-eligible") : t("待核实 · 不可发送", "Pending · sending blocked")}{lead.icpReview?.reason ? ` · ${lead.icpReview.reason}` : ""}</p>
        <label>{t("复核依据（必填：已核实 / 相邻）", "Review basis (required for Verified / Adjacent)")}<textarea rows={3} maxLength={1000} value={reviewReason} disabled={busy} onChange={(event) => setReviewReason(event.target.value)} /></label>
        <div className={styles.actions}>{([["verified", t("确认符合 ICP", "Verify ICP")], ["pending", t("保留待核实", "Keep pending")], ["adjacent", t("标记为相邻", "Mark adjacent")]] as const).map(([verdict, label]) => <button key={verdict} type="button" className="ui-action pi-bracket" disabled={busy || dirty || socialDirty || (verdict !== "pending" && !reviewReason.trim())} onClick={() => void save({ icpReview: { verdict, reason: reviewReason.trim() } })}>{label}</button>)}</div>
      </section> : null}
      <section className={styles.contactSection}>
        <h3 className="pi-label">{t("公开联系方式", "Public contact routes")}</h3>
        {lead.email ? <div className={styles.contactRoute}><div><strong>{lead.email}</strong><span>{lead.emailCheck === "source_found" ? t("公开来源已找到；仍需人工核对归属", "Found on public source; verify ownership") : t("来源待核对，不要使用猜测地址", "Source unconfirmed; do not guess")}</span></div>{lead.emailSource ? <a href={lead.emailSource} target="_blank" rel="noreferrer">{t("查看邮箱来源 ↗", "Check email source ↗")}</a> : null}</div> : null}
        <div className={styles.sourceLinks}><a href={lead.profileUrl} target="_blank" rel="noreferrer">{t("职业资料 ↗", "Professional profile ↗")}</a>{JARVIS_SOCIAL_PLATFORMS.flatMap((platform) => lead.socials?.[platform] ? [<a key={platform} href={lead.socials[platform]} target="_blank" rel="noreferrer">{platform === "x" ? "X" : platform[0]!.toUpperCase() + platform.slice(1)} ↗</a>] : [])}</div>
        {lead.socialLoginRequired?.length ? <p className="text-xs">{t("社交内容需要你登录后核对：", "Sign in yourself to review these social profiles: ")}{lead.socialLoginRequired.map((platform) => lead.socials?.[platform] ? <a key={platform} href={lead.socials[platform]} target="_blank" rel="noreferrer"> {platform === "x" ? "X" : platform[0]!.toUpperCase() + platform.slice(1)} ↗</a> : null)}{t("。登录不会自动让研究程序读取你的账号；需要我分析时，请分享具体帖文链接或内容。", ". Signing in does not give the research worker access; share a specific post URL or content if you'd like me to analyze it.")}</p> : null}
        {lead.socialEvidence ? <div className={styles.evidenceBlock}><span className="pi-eyebrow">{t("公开社交内容 · 待核对", "PUBLIC SOCIAL POST · VERIFY")}</span><blockquote>{lead.socialEvidence.quote}</blockquote><a href={lead.socialEvidence.url} target="_blank" rel="noreferrer">{t("查看原帖 ↗", "Read original post ↗")}</a></div> : <p className="text-xs">{t("暂无可核对的公开社交帖文；主页链接不代表已阅读内容。", "No readable social post recorded; a profile link does not mean its content was read.")}</p>}
        {lead.websiteResearch ? <div className={styles.evidenceBlock}>
          <span className="pi-eyebrow">{t("官网联系方式 · 待核对", "WEBSITE CONTACTS · VERIFY")}</span>
          <p className="text-xs">{lead.websiteResearch.status} · {new Date(lead.websiteResearch.checkedAt).toLocaleString(locale)}{lead.websiteResearch.note ? ` · ${lead.websiteResearch.note}` : ""}</p>
          <div className={styles.sourceLinks}>{lead.websiteResearch.websiteUrl ? <a href={lead.websiteResearch.websiteUrl} target="_blank" rel="noreferrer">{t("公司官网 ↗", "Company website ↗")}</a> : null}{lead.websiteResearch.contacts.map((contact) => <a key={`${contact.kind}:${contact.value}`} href={contact.kind.endsWith("email") ? `mailto:${contact.value}` : contact.kind === "phone" ? `tel:${contact.value}` : contact.value} target="_blank" rel="noreferrer">{contact.kind === "personal_email" ? t("个人邮箱", "Personal email") : contact.kind === "company_email" ? t("公司邮箱", "Company email") : contact.kind === "contact_form" ? t("联系表单", "Contact form") : t("电话", "Phone")} · {contact.value} ↗</a>)}</div>
          <p className="text-xs">{t("公司通用邮箱与表单不会自动变成个人邮件，也不会进入发送箱。", "Company inboxes and forms never become personal email automatically and are not added to the outbox.")}</p>
        </div> : null}
        {!routes.length ? <p className="text-xs">{t("未找到公开工作邮箱或可信社交主页。", "No public work email or trusted social profile found.")}</p> : !lead.email ? <p className="text-xs">{t("只有社交主页：供人工核对与联系，系统不会自动私信。", "Social profile only: manual review and outreach; no automatic DMs.")}</p> : null}
      </section>
      <section>
        <h3 className="pi-label">{t("为什么值得联系", "Why this person")}</h3>
        {lead.sourcingLane ? <div className={styles.watchList}><span className="pi-eyebrow">{t("验证分组", "VALIDATION LANE")}</span><p>{((RESEARCH_LANES as Record<string, [string, string]>)[lead.sourcingLane]?.[zh ? 0 : 1] ?? lead.sourcingLane)} · {t("需求匹配", "need fit")} {lead.companyFit?.score ?? "—"}/50 · {t("可联系性", "reachability")} {lead.reachability?.score ?? "—"}/50</p></div> : null}
        {lead.informationNeedEvidence ? <div className={styles.evidenceBlock}><span className="pi-eyebrow">{t("跨来源决策证据 · 待核对", "CROSS-SOURCE DECISION EVIDENCE · VERIFY")}</span><blockquote>{lead.informationNeedEvidence.quote}</blockquote><a href={lead.informationNeedEvidence.url} target="_blank" rel="noreferrer">{t("查看需求证据 ↗", "Check need evidence ↗")}</a></div> : null}
        {lead.opportunityNeedEvidence ? <div className={styles.evidenceBlock}><span className="pi-eyebrow">{t("当前项目证据 · 待核对", "ACTIVE-WORK EVIDENCE · VERIFY")}</span><blockquote>{lead.opportunityNeedEvidence.quote}</blockquote><a href={lead.opportunityNeedEvidence.url} target="_blank" rel="noreferrer">{t("查看项目证据 ↗", "Check active-work evidence ↗")}</a></div> : null}
        {lead.shopifyEvidence ? <div className={styles.evidenceBlock}><span className="pi-eyebrow">SHOPIFY PROOF · VERIFY</span><blockquote>{lead.shopifyEvidence.quote}</blockquote><a href={lead.shopifyEvidence.url} target="_blank" rel="noreferrer">{t("查看 Shopify 证据 ↗", "Check Shopify proof ↗")}</a></div> : null}
        {lead.whyNow ? <div className={styles.evidenceBlock}><span className="pi-eyebrow">WHY NOW · VERIFY</span><p>{lead.whyNow.summary}</p><blockquote>{lead.whyNow.quote}</blockquote><a href={lead.whyNow.url} target="_blank" rel="noreferrer">{t("查看触发事件来源 ↗", "Check trigger source ↗")}</a></div> : null}
        {lead.companyFit ? <p className="text-xs"><strong>{t("信息需求匹配依据：", "Information-need fit: ")}</strong>{lead.companyFit.evidence}</p> : null}
        {lead.reachability ? <p className="text-xs"><strong>{t("联系依据：", "Reachability evidence: ")}</strong>{lead.reachability.evidence}</p> : null}
        {lead.watchList ? <div className={styles.watchList}><span className="pi-eyebrow">{t("需关注的变化", "WATCH LIST")}</span><p>{lead.watchList}</p></div> : null}
        <div className={styles.evidenceBlock}><span className="pi-eyebrow">{t("公开证据 · 待核对", "PUBLIC EVIDENCE · VERIFY")}</span><blockquote>{lead.evidence}</blockquote><div className={styles.sourceLinks}><a href={lead.evidenceUrl} target="_blank" rel="noreferrer">{t("查看证据来源 ↗", "Read evidence source ↗")}</a>{lead.foundVia ? <a href={lead.foundVia.url} target="_blank" rel="noreferrer">{t("发现来源", "Found via")}: {lead.foundVia.source} ↗</a> : null}</div></div>
        <p className="text-xs">{t("AI 收集的资料，需核对当前职位。以下需求仅是假设，不代表对方已表达痛点。", "AI-researched: verify the current role. The need below is a hypothesis, not something they said.")}</p>
        {field("needHypothesis", t("需求假设 · 待访谈验证", "Need hypothesis · unverified"), true)}
        {lead.newsBurden ? <details className={styles.editorDisclosure}><summary>{t(`查看信息负担依据 · ${newsBurdenTotal(lead)}/${JARVIS_NEWS_BURDEN_MAX}`, `View news-burden evidence · ${newsBurdenTotal(lead)}/${JARVIS_NEWS_BURDEN_MAX}`)}</summary><ul className={`text-xs ${styles.burden}`}>{JARVIS_NEWS_BURDEN_KEYS.map((key) => <li key={key}><span className={styles.burdenHead}><strong>{BURDEN[key][zh ? 0 : 1]}</strong><span className={styles.pips} data-score={lead.newsBurden![key].score} aria-label={`${lead.newsBurden![key].score}/3`}><i /><i /><i /></span></span>{lead.newsBurden![key].evidence}</li>)}</ul></details> : null}
        <details className={styles.editorDisclosure}><summary>{t("修正行业与职级", "Correct industry and seniority")}</summary><div className={styles.fields}>{field("industry", t("行业", "Industry"))}{field("role", t("职位", "Role"))}{field("seniority", t("职级", "Seniority"))}</div></details>
      </section>
      <section><details className={styles.editorDisclosure}>
        <summary>{t("工作地点与时区", "Work locations and time zone")}{lead.personLocation ? <span> · {lead.personLocation}</span> : null}</summary>
        <p className="text-xs">{t("只记录公开的工作地点，不记录住址。公司总部不能推定个人所在地；IANA 时区按个人工作地推定，会随夏令时调整。没有来源则留空。", "Public work locations only, never home addresses. Company HQ does not establish a person's location; IANA time zone is inferred from their work location and handles DST. Leave unsupported fields blank.")}</p>
        <div className={styles.fields}>{field("personLocation", t("个人工作所在地 · 城市 / 州 / 国家", "Person's work location · city / region / country"))}{field("personLocationSource", t("个人工作地来源 URL", "Person location source URL"))}
        {lead.personLocationSource ? <a href={lead.personLocationSource} target="_blank" rel="noreferrer">{t("核对个人地点来源 ↗", "Check person location source ↗")}</a> : null}
        {field("companyLocation", t("公司总部或办公室 · 请写明类型", "Company HQ or office · specify which"))}{field("companyLocationSource", t("公司地点来源 URL", "Company location source URL"))}
        {lead.companyLocationSource ? <a href={lead.companyLocationSource} target="_blank" rel="noreferrer">{t("核对公司地点来源 ↗", "Check company location source ↗")}</a> : null}
        {field("timeZone", t("个人时区 · IANA（如 America/Chicago）", "Person's time zone · IANA (e.g. America/Chicago)"))}</div>
      </details></section>
      </details>
      {dirty ? <div className={styles.editorSave}><button type="button" className="ui-action pi-bracket" disabled={busy} onClick={() => void save(draft)}>{t("保存联系人修改", "Save contact changes")}</button></div> : null}
    </div>

    <div role="tabpanel" id="jarvis-panel-email" aria-labelledby="jarvis-tab-email" hidden={tab !== "email"} className={styles.panel}>
      <section className={styles.emailRecipient}>
        <h3 className="pi-label">{t("收件人 · 公开工作邮箱", "Recipient · public work email")}</h3>
        <strong>{draft.email || t("尚无公开工作邮箱", "No public work email")}</strong>
        <p className="text-xs">{lead.emailCheck === "source_found" ? t("来源页找到该地址；请核对归属与联系许可，不保证可投递。", "Address found on a source page; verify ownership and permission. Deliverability is unknown.") : t("尚未独立确认地址。不要猜测或使用私人邮箱。只有社交主页时请人工联系。", "Address not confirmed. Never guess or use private email; social-only outreach is manual.")}</p>
        <details className={styles.editorDisclosure} open={!lead.email || lead.emailCheck !== "source_found" || undefined}><summary>{t("查看或修正邮箱与来源", "View or correct email and source")}</summary>
          <div className={styles.fields}>{field("email", t("邮箱地址", "Email address"))}{field("emailSource", t("公开邮箱来源 URL", "Public email source URL"))}{field("emailQuote", t("包含完整邮箱的原文", "Source quote containing the exact email"), true, 2)}
          {lead.emailSource ? <a href={lead.emailSource} target="_blank" rel="noreferrer">{t("核对邮箱来源 ↗", "Check email source ↗")}</a> : null}</div>
        </details>
      </section>
      <section><h3 className="pi-label">{t("个性化邮件草稿 · 英文", "Personalized email draft · English")}</h3>{field("subject", t("主题", "Subject"))}{field("body", t("正文", "Body"), true, 15)}
        <div className={styles.actions}>{copyButton("email", t("复制邮箱", "Copy email"), draft.email)}{copyButton("subject", t("复制主题", "Copy subject"), draft.subject)}{copyButton("body", t("复制正文", "Copy body"), draft.body)}</div>
        <div className={styles.actions}><button className="ui-action pi-bracket" disabled={busy || !dirty} onClick={() => void save(draft)}>{t("保存修改", "Save changes")}</button><button className={`ui-action pi-bracket ${styles.approveDraft}`} disabled={busy || blocked || (lead.segment === "info_exec" && !isOutreachApprovedFor(lead, "email")) || !draft.email || hasJarvisSocialOutreach(lead)} onClick={() => void save({ ...draft, reviewed: true, ...(lead.status === "new" ? { status: "ready" } : {}) })}>{t("已核对身份、邮箱与草稿", "Approve identity, email and draft")}</button></div>
        {hasJarvisSocialOutreach(lead) ? <p className="text-xs">{t("已在社媒人工联系过这位用户。为避免重复打扰，不能再批准或发送首次邮件。", "Already contacted manually on social. First-email approval and sending are blocked to prevent duplicate outreach.")}</p> : null}
        {lead.queuedAt && !lead.sendAttempt ? <div className={styles.actions}><span className="text-xs">{t(`已排队：发送箱可随时按顺序发出，邮件间隔 ${JARVIS_DELIVERY_POLICY.minimumGapMinutes}–${JARVIS_DELIVERY_POLICY.maximumGapMinutes} 分钟。修改草稿或邮箱会将其移出队列。`, `Queued: the outbox may send this draft at any hour, in order, with a ${JARVIS_DELIVERY_POLICY.minimumGapMinutes}–${JARVIS_DELIVERY_POLICY.maximumGapMinutes} minute gap. Editing the draft or email removes it from the queue.`)}</span><button type="button" className="ui-action pi-bracket" disabled={busy} onClick={() => void (async () => { setBusy(true); try { await mutate(JARVIS_OUTREACH_API, "POST", { action: "unqueue", ids: [lead.id] }); await refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); } finally { setBusy(false); } })()}>{t("移出队列", "Remove from queue")}</button></div> : null}
        {lead.followUpAttempt ? <p className="text-xs">{t("自动跟进", "Automatic follow-up")}: {lead.followUpAttempt.state === "sent" ? t("已发出", "sent") : t("结果不确定，请查 Gmail 已发送", "outcome uncertain; check Gmail Sent")} · {new Date(lead.followUpAttempt.at).toLocaleString()}</p> : null}
        {lead.segment === "info_exec" && !isOutreachApprovedFor(lead, "email") ? <p className="text-xs">{t("先在 Cold Reach 批次审核中核对身份与完整文案，才能批准或发送。", "Review identity and full copy in Cold Reach before approving or sending.")}</p> : null}
        {links ? <div className={styles.actions}><a className="ui-action pi-bracket" href={links.gmail} target="_blank" rel="noreferrer">{t("在 Gmail 打开", "Open in Gmail")}</a><a className="ui-action pi-bracket" href={links.mailto}>{t("打开邮件客户端", "Open email app")}</a></div> : <p className="text-xs">{t("保存并核对后才显示邮件链接。不再联系、退信和拒绝的联系人不会显示链接。", "Save and approve to enable compose links. Suppressed, bounced or declined contacts have no compose links.")}</p>}
        <p className="text-xs">{t("上面的链接只打开草稿；下面的发送按钮会真正通过 Gmail 发出一封邮件。", "The links above only open drafts; the send button below actually sends one email via Gmail.")}</p>
        {(lead.sendAttempt?.state === "pending" || lead.sendAttempt?.state === "uncertain") && !["sent", "do_not_contact"].includes(lead.status) ? <p role="alert" className={styles.error}>{t("这封邮件的发送结果不确定。请先到 Gmail「已发送」核对；系统不会自动重试。", "Delivery outcome is uncertain. Check Gmail Sent; this contact cannot be retried automatically.")}</p> : null}
        {!sendAccess && lead.status === "ready" && lead.reviewed && !hasJarvisSocialOutreach(lead) && !lead.sendAttempt ? <button type="button" className="ui-action pi-bracket" disabled={busy} onClick={() => void connect()}>{t("连接个人 Gmail 用于 Cold Reach", "Connect personal Gmail for Cold Reach")}</button> : null}
        {sendAccess && lead.status === "ready" && lead.reviewed && !hasJarvisSocialOutreach(lead) && !lead.sendAttempt ? <button type="button" className="ui-action pi-bracket" disabled={busy || dirty} onClick={() => setPreview({ revision: lead.revision ?? 0, email: lead.email, subject: lead.subject, body: lead.body })}>{t("预览并确认发送一封", "Review and send one email")}</button> : null}
        {preview ? <div role="group" aria-label={t("发送前核对完整邮件", "Review full email before sending")} className={styles.sendPreview}>
          <strong>{t("即将真实发送（不会再打开草稿）", "This will actually send, not open a draft")}</strong>
          <p>To: {preview.email}</p><p>Subject: {preview.subject}</p><pre>{preview.body}</pre>
          <div className={styles.actions}><button type="button" className="ui-action pi-bracket" disabled={busy} onClick={() => void send()}>{t(`确认发送给 ${preview.email}`, `Confirm send to ${preview.email}`)}</button><button type="button" className="ui-action pi-bracket" disabled={busy} onClick={() => setPreview(null)}>{t("取消", "Cancel")}</button></div>
        </div> : null}
      </section>
    </div>

    <div role="tabpanel" id="jarvis-panel-social" aria-labelledby="jarvis-tab-social" hidden={tab !== "social"} className={styles.panel}>
      <JarvisSocialOutreach lead={lead} zh={zh} refresh={refresh} onDirty={setSocialDirty} />
    </div>

    <div role="tabpanel" id="jarvis-panel-activity" aria-labelledby="jarvis-tab-activity" hidden={tab !== "activity"} className={styles.panel}>
      <section><h3 className="pi-label">{t("联系进度", "Contact progress")}</h3>
        {due ? <div className={styles.followUpNotice}>
          <span>{t(`发信于 ${new Date(lead.sentAt!).toLocaleDateString()}，已满 ${JARVIS_DELIVERY_POLICY.followUpDelayHours} 小时且尚未记录回复。请先检查邮箱。`, `Sent ${new Date(lead.sentAt!).toLocaleDateString()}; ${JARVIS_DELIVERY_POLICY.followUpDelayHours}+ hours with no reply recorded. Check your inbox first.`)}</span>
        </div> : null}
        {lead.status === "sent" && lead.sentAt && !lead.repliedAt && !lead.followedUpAt ? <button type="button" className="ui-action pi-bracket" disabled={busy || dirty} onClick={() => { if (window.confirm(t("已手动跟进这位联系人？这里只记录时间，不会发送邮件。", "Have you already followed up? This records the date; it does not send an email."))) void save({ followUp: true }); }}>{t("已手动跟进", "Mark followed up")}</button> : null}
        {lead.followedUpAt ? <p className="text-xs">{t("已手动跟进", "Followed up")}: {new Date(lead.followedUpAt).toLocaleString()}</p> : null}
        <label>{t("当前状态", "Current status")}<select value={lead.status} disabled={busy || dirty || lead.status === "do_not_contact"} onChange={(e) => void save({ status: e.target.value })}>{JARVIS_STATUSES.map((s) => <option key={s} value={s} disabled={["ready", "sent"].includes(s) && (!lead.reviewed || blocked)}>{STATUSES[s][zh ? 0 : 1]}</option>)}</select></label>
        {field("confirmedNeeds", t("真实需求 / 对方原话（人工记录）", "Confirmed needs / their words (manual)"), true)}{field("notes", t("回复、现有工具、付费信号与下一步", "Reply, current tools, payment signals and next step"), true)}
        <button className="ui-action pi-bracket" disabled={busy || !dirty} onClick={() => void save(draft)}>{t("保存记录", "Save notes")}</button>
      </section>
      <section><h3 className="pi-label">{t("状态历史", "Status history")}</h3>
        <ol className={styles.timeline}>{[...lead.history].reverse().map((h, i) => <li key={i} data-status={h.status}><span className={styles.stage} data-status={h.status}>{STATUSES[h.status][zh ? 0 : 1]}</span><time dateTime={h.at}>{new Date(h.at).toLocaleString()}</time></li>)}</ol>
      </section>
    </div>

    <div className={styles.editorFoot}>
      {dirty || socialDirty ? <p role="status">{t("有未保存修改，请保存后再切换联系人。", "Unsaved changes: save before switching contacts.")}</p> : null}
      {message ? <p role="status">{message}</p> : null}{error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </div>
  </article>;
}

// One Google status request per page load, not one per contact opened.
let sendAccessRequest: Promise<boolean> | null = null;
function loadSendAccess(): Promise<boolean> {
  sendAccessRequest ??= fetch("/api/robin/google?account=outreach").then((r) => r.json()).then((value: { canSendGmail?: boolean }) => value.canSendGmail === true).catch(() => { sendAccessRequest = null; return false; });
  return sendAccessRequest;
}
