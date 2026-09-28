"use client";

import Link from "next/link";
import { memo, type CSSProperties, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { BALANCED_JARVIS_QUOTA, CORE_JARVIS_SEGMENTS, JARVIS_PERSONAS, JARVIS_TARGET_PERSONAS, JARVIS_PERSONA_QUOTA, JARVIS_NEWS_BURDEN_KEYS, JARVIS_NEWS_BURDEN_MAX, JARVIS_STATUSES, DEFAULT_JARVIS_OUTBOX, DEFAULT_JARVIS_DAILY, isJarvisFollowUpDue, jarvisSentToday, jarvisTier, isReachableTierExec, JARVIS_PERSONA_PLAYBOOK, isQualifiedInfoExec, isResearchedTargetUser, isSendableCore, newsBurdenTotal, jarvisComposeLinks, jarvisListPriority, type CoreJarvisSegment, type JarvisLead, type JarvisPersona, type JarvisSegment, type JarvisState, type JarvisStatus } from "@/extension/robin/jarvis-shape";
import { mutate, usePolledResource } from "./usePolledResource";
import styles from "./JarvisDiscovery.module.css";
import { JarvisOutbox, queueOrder } from "./JarvisOutbox";

const API = "/api/robin/jarvis";
const SEGMENTS: Record<JarvisSegment, [string, string]> = {
  info_exec: ["目标用户画像", "Target personas"],
  clinic: ["诊所 / 医疗运营", "Clinics / healthcare operators"],
  professional_services: ["专业服务", "Professional services"],
  nontech_exec: ["非科技行业管理者", "Non-tech executives"],
  small_tech: ["小型科技公司 · 非技术管理者", "Small tech · non-technical leaders"],
  founder: ["原名单 · 创始人 / CTO", "Original · founders / CTOs"], investor: ["原名单 · 投资人", "Original · investors"],
  product: ["原名单 · 产品 / 战略", "Original · product / strategy"], research: ["原名单 · 应用研究", "Original · applied research"],
};
const PERSONAS: Record<JarvisPersona, [string, string]> = {
  vc: ["VC / 天使 / 家族办公室", "VC / angel / family office"],
  client_advisor: ["客户顾问 / BD", "Client advisor / BD"],
  startup_leader: ["创业公司创始人 / 高管", "Startup founder / leader"],
  nontech_tech_leader: ["非科技公司技术与战略负责人", "Non-tech company tech & strategy leader"],
  researcher: ["研究者", "Researcher"],
};
const BURDEN: Record<typeof JARVIS_NEWS_BURDEN_KEYS[number], [string, string]> = {
  change: ["变化速度", "Pace of change"], breadth: ["信息面", "Breadth"], unfiltered: ["无人代筛", "No one filters"], footprint: ["可建画像", "Public footprint"],
};
/** Contacts a batch approval can queue: unsent, with an address seen on its source page. */
const canQueue = (lead: JarvisLead) => ["new", "ready"].includes(lead.status) && !lead.sendAttempt && !lead.sentAt && !lead.queuedAt && Boolean(lead.email) && lead.emailCheck === "source_found";
/** Sent with nothing back yet: nothing to do until a reply or the follow-up. */
const isArchived = (lead: JarvisLead) => lead.status === "sent";
const STATUSES: Record<JarvisStatus, [string, string]> = {
  new: ["待核对", "Needs review"], ready: ["待发送", "Ready"], sent: ["已发送", "Sent"],
  replied: ["已回复", "Replied"], interested: ["有兴趣", "Interested"], declined: ["不感兴趣", "Declined"],
  bounced: ["退信", "Bounced"], do_not_contact: ["不再联系", "Do not contact"],
};
/** The pipeline reads left to right; the three dead ends share one "closed" column. */
const OPEN_STAGES = ["new", "ready", "sent", "replied", "interested"] as const satisfies readonly JarvisStatus[];
const CLOSED: readonly JarvisStatus[] = ["declined", "bounced", "do_not_contact"];
type StageFilter = JarvisStatus | "closed" | "all";
type SegmentFilter = JarvisSegment | "core" | "adjacent" | "all" | "exec";
type SortKey = "priority" | "burden" | "updated";
type Tab = "overview" | "email" | "activity";

// Built once per lead object; the payload is only re-parsed when the server's JSON changes.
const haystacks = new WeakMap<JarvisLead, string>();
const haystack = (lead: JarvisLead) => {
  let text = haystacks.get(lead);
  if (text === undefined) {
    text = `${lead.name} ${lead.company} ${lead.role} ${lead.industry} ${lead.seniority} ${lead.needHypothesis} ${lead.personLocation ?? ""} ${lead.companyLocation ?? ""} ${lead.timeZone ?? ""} ${lead.email}`.toLowerCase();
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
  useEffect(() => { setResearching(running || rescoring); }, [running, rescoring]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const toggleChecked = useCallback((id: string) => setChecked((set) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
  }), []);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [segment, setSegment] = useState<SegmentFilter>("core");
  const [stage, setStage] = useState<StageFilter>("all");
  const [persona, setPersona] = useState<JarvisPersona | null>(null);
  const [sort, setSort] = useState<SortKey>("priority");
  const [dueOnly, setDueOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const dirtyRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const benchRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const onDirty = useCallback((dirty: boolean) => { dirtyRef.current = dirty; }, []);

  const leads = useMemo(() => data?.leads ?? [], [data]);
  const stats = useMemo(() => {
    const now = Date.now();
    const core = leads.filter((lead) => lead.audienceFit === "core");
    const byStage = Object.fromEntries(JARVIS_STATUSES.map((s) => [s, 0])) as Record<JarvisStatus, number>;
    for (const lead of core) byStage[lead.status]++;
    const due = new Set(leads.filter((lead) => isJarvisFollowUpDue(lead, now)).map((lead) => lead.id));
    return {
      core, byStage, due,
      adjacent: leads.length - core.length,
      sendable: leads.filter(isSendableCore).length,
      qualifiedExecs: leads.filter(isQualifiedInfoExec).length,
      researched: leads.filter(isResearchedTargetUser).length,
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
      // Personas count qualified people, the same rule as the info_exec target.
      persona: Object.fromEntries(JARVIS_PERSONAS.map((p) => [p, leads.filter((lead) => lead.persona === p && isQualifiedInfoExec(lead)).length])) as Record<JarvisPersona, number>,
      cohort: Object.fromEntries(CORE_JARVIS_SEGMENTS.map((s) => [s, core.filter((lead) => lead.segment === s && lead.email).length])) as Record<CoreJarvisSegment, number>,
    };
  }, [leads]);
  const { core, due, sendable, qualifiedExecs } = stats;

  const visible = useMemo(() => {
    // "Target personas" also shows rescored contacts from other cohorts that fit a persona.
    const rows = leads.filter((lead) => (segment === "all" || segment === lead.audienceFit || lead.segment === segment || (segment === "info_exec" && Boolean(lead.persona)) || (segment === "exec" && jarvisTier(lead) !== null))
      && (!persona || segment !== "info_exec" || lead.persona === persona)
      && (stage === "all" || (stage === "closed" ? CLOSED.includes(lead.status) : lead.status === stage))
      && (!dueOnly || due.has(lead.id))
      // Sent and awaiting a reply is done for now: archived unless asked for.
      && (showArchived || dueOnly || stage === "sent" || !isArchived(lead))
      && (!deferredQuery || haystack(lead).includes(deferredQuery)));
    const compare: Record<SortKey, (a: JarvisLead, b: JarvisLead) => number> = {
      priority: (a, b) => jarvisListPriority(a) - jarvisListPriority(b) || newsBurdenTotal(b) - newsBurdenTotal(a),
      burden: (a, b) => newsBurdenTotal(b) - newsBurdenTotal(a) || jarvisListPriority(a) - jarvisListPriority(b),
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    };
    return rows.sort(compare[sort]);
  }, [leads, segment, persona, stage, dueOnly, due, deferredQuery, sort, showArchived]);
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
    // Stacked layout: the editor sits below the list, so bring it into view.
    if (window.matchMedia("(max-width: 960px)").matches) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: "start" }));
  }, [zh]);

  // A new contact opens at its top, and a new filter or sort starts the list over.
  useEffect(() => { detailRef.current?.scrollTo({ top: 0 }); }, [selected]);
  useEffect(() => { listRef.current?.scrollTo({ top: 0 }); }, [segment, persona, stage, dueOnly, sort, deferredQuery]);

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
      const gap = bench.getBoundingClientRect().top - page.getBoundingClientRect().top - dock;
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
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
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
  }, [visible, selected, selectLead]);

  const act = async (body: unknown) => {
    setBusy(true); setActionError("");
    try { await mutate(API, "POST", body); await refresh(); }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const start = (target: number, focus?: CoreJarvisSegment, wide = false) => {
    if ((focus || target > sendable + 3) && !window.confirm(wide
      ? t(`广撒网：找有公开邮箱的 executive，直到研究找到的 A/B 类可联系者共 ${target} 位。质量底线：现任 executive、非行业协会、信息负担 ≥ 6/12。可能消耗模型和搜索额度；不会发邮件。继续？`, `Wide net: research executives with a published email until research has found ${target} reachable A/B executives. Quality floor: current executive, not an association, news burden ≥ 6/12. This uses model/search quota; no mail will be sent.`)
      : focus
      ? t(`搜索 A 类目标用户（四类 executive 画像），直到研究找到的达标者共 ${target} 位（门槛 + 信息负担 ≥ 9/12；重新打分的人不计入）。没有公开邮箱的人也会收录，改用 LinkedIn 或引荐联系；可能消耗模型和搜索额度。继续？`, `Research A-tier target users across the four executive personas until research has found ${target} qualified people (gates plus news burden ≥ 9/12; rescored contacts do not count)? People without a public email are kept for LinkedIn or introductions. This uses model/search quota; no mail will be sent.`)
      : t("将使用当前模型与搜索服务，分批收集，直到 100 位核心受众有公开工作邮箱。可能运行较久并消耗模型/搜索额度；可随时停止。继续？", "Research until 100 core contacts have a sourced work email, using the current model and search provider? This uses model/search quota and may take a while. You can stop at any time."))) return;
    void act({ action: "discover", target, ...(focus ? { focus } : {}), ...(wide ? { wide } : {}) });
  };
  const queueable = visible.filter(canQueue);
  const queuePosition = useMemo(() => new Map(queueOrder(leads).map((lead, index) => [lead.id, index + 1])), [leads]);
  const checkedLeads = leads.filter((lead) => checked.has(lead.id) && canQueue(lead));
  const queueChecked = async () => {
    if (!checkedLeads.length) return;
    if (!window.confirm(t(`批准并排队 ${checkedLeads.length} 封邮件？发送箱会在对方工作日的工作时间里逐封发出（${outbox.dailyLimit ? `每天最多 ${outbox.dailyLimit} 封，` : ""}间隔 6–12 分钟）。请确认你已看过这些人的身份、邮箱来源和草稿。`, `Approve and queue ${checkedLeads.length} emails? The outbox sends them one at a time during the recipient's weekday working hours (${outbox.dailyLimit ? `at most ${outbox.dailyLimit} a day, ` : ""}6–12 minutes apart). Confirm you have checked each identity, email source and draft.`))) return;
    setBusy(true); setActionError("");
    try {
      const response = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "queue", items: checkedLeads.map((lead) => ({ id: lead.id, revision: lead.revision ?? 0 })) }) });
      const result = await response.json().catch(() => null) as { queued?: number; skipped?: Array<{ id: string; reason: string }>; error?: string } | null;
      if (!response.ok || !result?.skipped) throw new Error(result?.error ?? `Request failed (${response.status})`);
      setChecked(new Set());
      if (result.skipped.length) setActionError(t(`${result.skipped.length} 位未排队：`, `${result.skipped.length} not queued: `) + result.skipped.map((item) => `${leads.find((lead) => lead.id === item.id)?.name ?? item.id} (${item.reason})`).join("; "));
      await refresh();
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const outbox = { ...DEFAULT_JARVIS_OUTBOX, ...data?.outbox };
  const daily = { ...DEFAULT_JARVIS_DAILY, ...data?.daily };
  const [exported, setExported] = useState("");
  // Writes the same HTML as "HTML list" into the Jarvis.day repo's outreach/candidates.html.
  const syncJarvisDay = async () => {
    setBusy(true); setActionError("");
    try {
      await mutate(API, "POST", { action: "export-file" });
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
          <span className={styles.titleLinks}>
            <Link href="/product" className="ui-action pi-bracket text-xs">{t("返回 Product", "Back to Product")}</Link>
            <a className="ui-action pi-bracket text-xs" href={`${API}/report?inline=1`} target="_blank" rel="noreferrer">{t("HTML 名单", "HTML list")}</a>
            <a className="ui-action pi-bracket text-xs" href={`${API}/report`} download>{t("导出 HTML", "Export HTML")}</a>
            <button type="button" className="ui-action pi-bracket text-xs" disabled={busy} title="~/Jarvis_Day/outreach/candidates.html" onClick={() => void syncJarvisDay()}>{exported ? t(`已同步 ${exported}`, `Synced ${exported}`) : t("同步到 Jarvis.day", "Sync to Jarvis.day")}</button>
          </span>
          <h1>Jarvis<span className={styles.day}>.day</span></h1>
          <span className="pi-eyebrow">MARKET DISCOVERY</span>
        </div>
        <section className={styles.kpis} aria-label={t("探索进度", "Discovery progress")}>
          {([[stats.tiers[0]!.total, t("A 类目标用户", "A-tier target users"), "info_exec", 0], [stats.tiers[1]!.total, t("B 类 executive", "B-tier executives"), "ready", 0], [sendable, t("核心有邮箱 / 100（含已发送）", "Core work emails / 100 (incl. sent)"), "ready", 100], [stats.unsentWithEmail, t("未发送 · 有邮箱", "Unsent · with email"), "new", 0], [stats.coreSent, t("核心已发送", "Core sent"), "sent", 0], [stats.coreReplied, t("核心已回复", "Core replied"), "replied", 0]] as const).map(([value, label, tone, target]) => <div key={label} data-tone={tone}>
            <strong>{n(value)}</strong><span>{label}</span>
            {target ? <i className={styles.meter} style={{ "--p": `${Math.min(100, data ? value / target * 100 : 0)}%` } as CSSProperties} aria-hidden /> : null}
          </div>)}
        </section>
      </header>

      <nav className={styles.pipeline} aria-label={t("联系阶段", "Pipeline stages")}>
        {OPEN_STAGES.map((s) => <button key={s} type="button" data-status={s} aria-pressed={stage === s} onClick={() => { setStage(stage === s ? "all" : s); setDueOnly(false); }}>
          <span>{STATUSES[s][zh ? 0 : 1]}</span><strong>{n(stats.byStage[s])}</strong>
        </button>)}
        <button type="button" className={styles.closedStage} data-status="closed" aria-pressed={stage === "closed"} onClick={() => { setStage(stage === "closed" ? "all" : "closed"); setDueOnly(false); }}>
          <span>{t("已结束", "Closed")}</span><strong>{n(CLOSED.reduce((sum, s) => sum + stats.byStage[s], 0))}</strong>
        </button>
      </nav>
      <p className="sr-only">{t("阶段计数只含核心受众。", "Stage counts cover the core audience only.")}</p>

      {due.size > 0 ? <div className={styles.followUpNotice} role="status" aria-atomic="true">
        <span>{t(`${due.size} 位联系人发信已满 7 天，尚未记录回信或跟进。`, `${due.size} contacts were sent an email 7+ days ago, with no reply or follow-up recorded.`)}</span>
        <button type="button" className="ui-action pi-bracket" onClick={showFollowUps}>{t("查看待跟进", "View follow-ups")}</button>
      </div> : null}

      <JarvisOutbox tiers={stats.tiers} leads={leads} outbox={data?.outbox} sentToday={stats.sentToday} checked={checkedLeads.length} queueable={queueable.length} busy={busy} zh={zh} locale={locale}
        onQueue={() => void queueChecked()} onTickAll={() => setChecked(new Set(queueable.map((lead) => lead.id)))} onClear={() => setChecked(new Set())}
        onToggle={() => void act({ action: "outbox", enabled: !(outbox.enabled && !outbox.pausedReason) })}
        onStart={(startAt) => { if (startAt || window.confirm(t("现在就开始发送排队的邮件？", "Start sending the queued emails now?"))) void act({ action: "outbox", enabled: true, startAt }); }}
        onUnqueue={(id) => void act({ action: "unqueue", ids: [id] })} onSelect={selectLead} onSync={() => void act({ action: "sync" })} onLimit={(dailyLimit) => void act({ action: "outbox", dailyLimit })} />
      <details className={styles.research} open={running || undefined}>
        <summary>
          <span className="pi-label">{t("研究队列", "Research queue")}</span>
          <span className={`text-xs ${styles.runLine}`} role={data?.run?.status === "error" ? "alert" : "status"}>{data?.run ? `${data.run.status} · ${data.run.message}` : t("LLM + Web Search · 每批最多 3 人", "LLM + web search · up to 3 per batch")}</span>
          {running ? <span className={styles.pulse} aria-hidden /> : null}
        </summary>
        <p className="text-xs">{t("目标用户按信息负担达标计数，有没有邮箱都算；原平衡活动只计有公开工作邮箱的人。来源可查 · 自动去重 · 仅公开信息（含 LinkedIn 搜索结果）。可离开页面，搜索在本地服务器继续；服务器重启后需手动续跑。", "Target users count when their news burden qualifies, email or not; the original balanced campaign counts only public work emails. Sourced · deduplicated · public information only, including LinkedIn search results. Research continues on this local server when you leave the page; restart manually after a server restart.")}</p>
        <details className={styles.playbook}>
          <summary>{t("每类目标用户从哪里找（研究时原样发给模型）", "Where each persona is searched for (sent to research verbatim)")}</summary>
          <dl>{JARVIS_TARGET_PERSONAS.map((p) => <div key={p}><dt>{PERSONAS[p][zh ? 0 : 1]} · {JARVIS_PERSONA_QUOTA[p]}%</dt><dd>{JARVIS_PERSONA_PLAYBOOK[p].replace(/^Persona \w+\.\s*/, "")}</dd></div>)}</dl>
          <p className="text-xs">{t("先过四道门槛：必须是 executive；组织约 500 人以内；能说出具体的关注清单；所在领域变化快。再按四项打分（变化速度、信息面、无人代筛、可建画像，各 0–3，证据不足默认 1 分，3 分必须有具体证据），≥ 9/12 且无 0 分才算目标用户。", "Four gates first: an executive, an organization of about 500 or fewer, a named watch list, and a fast-moving field. Then four scores (pace of change, breadth, no one filters, public footprint; 0–3 each, 1 by default when evidence is thin, 3 only with specific evidence); a target user needs ≥ 9/12 with no zero.")}</p>
        </details>
        <div className={styles.daily} data-on={daily.enabled || undefined}>
          <label className={styles.dailySwitch}><input type="checkbox" checked={daily.enabled} disabled={busy || !data} onChange={(e) => void act({ action: "daily", enabled: e.target.checked })} />{t("每日自动研究", "Daily research")}</label>
          <label>{t("每天", "Every day at")} <select value={daily.hour} disabled={busy || !data} onChange={(e) => void act({ action: "daily", hour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select></label>
          <label>{t("找", "find")} <select value={daily.count} disabled={busy || !data} onChange={(e) => void act({ action: "daily", count: Number(e.target.value) })}>{[5, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}</select> {t("位有公开邮箱的 A/B 类 executive", "reachable A/B executives with a public email")}</label>
          <span className="text-xs">{daily.lastRunOn ? t(`上次：${daily.lastRunOn}`, `Last: ${daily.lastRunOn}`) : t("尚未运行", "Not run yet")} · {t("新人进「待核对」，不会自动排队或发信", "New people land in Needs review; nothing is queued or sent")}</span>
        </div>
        {data?.rescore ? <p className={`text-xs ${styles.runLine}`} role={data.rescore.status === "error" ? "alert" : "status"}>{t("重新打分", "Rescoring")} · {data.rescore.status} · {data.rescore.message}</p> : null}
        <div className={styles.actions}>
          {running ? <button className="ui-action pi-bracket" disabled={busy} onClick={() => void act({ action: "stop" })}>{t("停止搜索", "Stop research")}</button> : <>
            <button className="ui-action pi-bracket" disabled={busy || !data || sendable >= 100} onClick={() => start(Math.min(100, sendable + 3))}>{t("找下一批 3 人", "Find next 3")}</button>
            <button className="ui-action pi-bracket" disabled={busy || !data || sendable >= 100} onClick={() => start(100)}>{t("自动补齐 100 位可发邮件的人", "Research to 100 sendable")}</button>
            <button className="ui-action pi-bracket" disabled={busy || !data} onClick={() => start(stats.researched + 3, "info_exec")}>{t("找 3 位目标用户", "Find 3 target users")}</button>
            <button className="ui-action pi-bracket" disabled={busy || !data} onClick={() => start(stats.researched + 30, "info_exec")}>{t("再找 30 位 A 类目标用户", "Find 30 more A-tier users")}</button>
            <button className="ui-action pi-bracket" disabled={busy || !data} onClick={() => start(leads.filter(isReachableTierExec).length + 50, "info_exec", true)}>{t("广撒网 · 找 50 位有邮箱的 executive", "Wide net · 50 executives with email")}</button>
          </>}
          {rescoring ? <button className="ui-action pi-bracket" disabled={busy} onClick={() => void act({ action: "stop-rescore" })}>{t("停止重新打分", "Stop rescoring")}</button>
            : <button className="ui-action pi-bracket" disabled={busy || !data || stats.unassessed === 0} onClick={() => { if (window.confirm(t(`按五类用户画像给 ${stats.unassessed} 位未评估的联系人重新打分？会逐个查公开资料，消耗模型和搜索额度；不会发邮件。`, `Rescore ${stats.unassessed} unassessed contacts against the five personas? This researches public sources and uses model/search quota; no mail is sent.`))) void act({ action: "rescore" }); }}>{t(`重新打分现有联系人 · ${stats.unassessed}`, `Rescore existing contacts · ${stats.unassessed}`)}</button>}
          <a className="ui-action pi-bracket" href="https://jarvis.day" target="_blank" rel="noreferrer">{t("产品网站", "Product site")}</a>
        </div>
      </details>
      {error || actionError ? <p role="alert" className={styles.error}>{error || actionError}</p> : null}

      <div ref={benchRef} className={styles.workbench}>
        <div className={styles.listPane}>
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
          <div className={styles.cohorts} role="group" aria-label={t("人群", "Cohort")}>
            <button className="ui-action" aria-pressed={segment === "exec"} onClick={() => setSegment("exec")}>{t("Executive · A+B", "Executives · A+B")} <span>{stats.tiers[0]!.total + stats.tiers[1]!.total}</span></button>
            <button className="ui-action" aria-pressed={segment === "core"} onClick={() => setSegment("core")}>{t("核心受众", "Core audience")} <span>{core.length}</span></button>
            {CORE_JARVIS_SEGMENTS.map((s) => {
              // Target personas are uncapped and count qualified people, email or not; the balanced cohorts count work emails.
              if (s === "info_exec") return <button key={s} className="ui-action" data-segment={s} aria-pressed={segment === s} onClick={() => setSegment(s)}>{SEGMENTS[s][zh ? 0 : 1]} <span>{qualifiedExecs}</span></button>;
              const [count, target] = [stats.cohort[s], BALANCED_JARVIS_QUOTA[s]];
              return <button key={s} className="ui-action" data-segment={s} style={{ "--p": `${Math.min(100, count / target * 100)}%` } as CSSProperties} aria-pressed={segment === s} onClick={() => setSegment(s)}>{SEGMENTS[s][zh ? 0 : 1]} <span>{count}/{target}</span></button>;
            })}
            <button className="ui-action" aria-pressed={segment === "adjacent"} onClick={() => setSegment("adjacent")}>{t("原科技圈名单", "Original tech-heavy list")} <span>{stats.adjacent}</span></button>
            <button className="ui-action" aria-pressed={segment === "all"} onClick={() => setSegment("all")}>{t("全部", "All")} <span>{leads.length}</span></button>
          </div>
          {segment === "info_exec" ? <div className={styles.personas} role="group" aria-label={t("用户画像", "Personas")}>
            {JARVIS_TARGET_PERSONAS.map((p) => <button key={p} type="button" data-persona={p} aria-pressed={persona === p} title={t(`计划占比 ${JARVIS_PERSONA_QUOTA[p]}%`, `Planned share ${JARVIS_PERSONA_QUOTA[p]}%`)} onClick={() => setPersona(persona === p ? null : p)}>{PERSONAS[p][zh ? 0 : 1]} <span>{stats.persona[p]}</span></button>)}
          </div> : null}
          <p className={`text-xs ${styles.count}`} aria-live="polite">{data ? t(`${visible.length} 位 · j/k 切换`, `${visible.length} shown · j/k to move`) : ""}</p>
          <section ref={listRef} aria-label={t("候选人名单", "Candidates")} className={styles.list}>
            {!data ? <p role="status" className={styles.empty}>{t("正在读取名单…", "Loading contacts…")}</p> : visible.length === 0 ? <div className={styles.empty}><h2>{leads.length ? t("没有符合筛选条件的人", "No matching contacts") : t("第一位受访者，从这里开始。", "Your first conversation starts here.")}</h2><p>{t("打开「研究队列」，点击「找下一批 3 人」。没有查到邮箱的人会保留在名单里，不会猜测地址。", "Open the research queue and choose Find next 3. People without a sourced email remain in the list; addresses are never guessed.")}</p></div> : null}
            {visible.map((lead) => <LeadRow key={lead.id} lead={lead} zh={zh} active={selected === lead.id} due={due.has(lead.id)} onSelect={selectLead} checked={checked.has(lead.id)} onCheck={toggleChecked} position={queuePosition.get(lead.id)} />)}
          </section>
          {checkedLeads.length ? <div className={styles.selectionBar} role="region" aria-label={t("已勾选", "Selection")}>
            <span><strong>{checkedLeads.length}</strong> {t("位已勾选 · 批准后由发送台逐封发出", "ticked · the outbox sends them one at a time once approved")}</span>
            <button type="button" className={`ui-action pi-bracket ${styles.outboxPrimary}`} disabled={busy} onClick={() => void queueChecked()}>{t(`批准并排队 ${checkedLeads.length} 封`, `Approve and queue ${checkedLeads.length}`)}</button>
            <button type="button" className="ui-action pi-bracket" disabled={busy} onClick={() => setChecked(new Set())}>{t("清除", "Clear")}</button>
          </div> : null}
        </div>
        <section ref={detailRef} className={styles.detail} aria-label={t("联系人详情与邮件", "Contact details and email")}>
          {current ? <LeadEditor key={current.id} lead={current} zh={zh} locale={locale} tab={tab} onTab={setTab} due={due.has(current.id)} refresh={refresh} onDirty={onDirty} /> : <div className={styles.empty}><h2>{t("先看依据，再发邮件。", "Evidence first. Email second.")}</h2><p>{t("选择一位候选人，核对他的工作、需求假设和邮箱来源，然后编辑邮件。只有你批准并排队的邮件才会由发送箱发出。", "Select a contact to inspect their work, need hypothesis and email source, then edit the draft. The outbox sends only what you approve and queue.")}</p></div>}
        </section>
      </div>
    </div>
  </main>;
}

const emailState = (lead: JarvisLead, zh: boolean) => {
  const t = (cn: string, en: string) => zh ? cn : en;
  if (lead.email) return lead.reviewed ? t("已人工核对", "Human-reviewed") : t("有邮箱 · 待人工核对", "Email found · review required");
  return lead.segment === "info_exec" ? t("无公开邮箱 · 走 LinkedIn 或引荐", "No public email · LinkedIn or intro") : t("工作邮箱待补充", "Work email missing");
};

/** One dense row. Polls keep the same lead objects until the server JSON changes, so identity is enough. */
const LeadRow = memo(function LeadRow({ lead, zh, active, due, onSelect, checked, onCheck, position }: { lead: JarvisLead; zh: boolean; active: boolean; due: boolean; onSelect: (id: string) => void; checked: boolean; onCheck: (id: string) => void; position?: number }) {
  const t = (cn: string, en: string) => zh ? cn : en;
  const burden = lead.newsBurden ? newsBurdenTotal(lead) : null;
  const queued = Boolean(lead.queuedAt) && !lead.sendAttempt;
  const tier = jarvisTier(lead);
  const sendChip = queued ? t(`排队 #${position ?? "—"}`, `Queued #${position ?? "—"}`)
    : lead.sendAttempt?.state === "pending" ? t("发送中", "Sending")
    : lead.sendAttempt?.state === "uncertain" ? t("结果不确定", "Uncertain")
    : lead.repliedAt ? t("已回复", "Replied")
    : lead.followUpAttempt ? t("已跟进", "Followed up")
    : lead.sentAt ? t(`已发 ${new Date(lead.sentAt).toLocaleDateString(zh ? "zh-CN" : "en-US", { month: "numeric", day: "numeric" })}`, `Sent ${new Date(lead.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`)
    : null;
  const sendTone = queued || lead.sendAttempt?.state === "pending" ? "ready" : lead.sendAttempt?.state === "uncertain" ? "uncertain" : lead.repliedAt ? "replied" : "sent";
  return <div className={styles.rowWrap} data-queued={queued || undefined} data-checked={checked || undefined}>
    <label className={styles.rowCheck} title={queued ? t("已排队", "Queued") : canQueue(lead) ? t("勾选以批准并排队", "Tick to approve and queue") : t("不可排队：已联系、已排队，或邮箱未在来源页确认", "Not queueable: contacted, queued, or email not confirmed on its source")}>
      <span className="sr-only">{t(`选择 ${lead.name}`, `Select ${lead.name}`)}</span>
      {queued ? <span aria-hidden>✓</span> : <input type="checkbox" checked={checked} disabled={!canQueue(lead)} onChange={() => onCheck(lead.id)} />}
    </label>
    <button id={`jarvis-row-${lead.id}`} type="button" className={styles.row} aria-pressed={active} onClick={() => onSelect(lead.id)}>
    <span className={styles.rowName}><i className={styles.dot} data-segment={lead.segment} title={SEGMENTS[lead.segment][zh ? 0 : 1]} aria-hidden /><strong>{lead.name}</strong>{tier ? <span className={styles.tierBadge} data-tier={tier} title={tier === "A" ? t("A 类：严格标准下的目标用户", "A: target user under the strict rubric") : t("B 类：广撒网，达到质量底线的 executive", "B: wide net, an executive above the quality floor")}>{tier}</span> : null}{due ? <span className={styles.followUpBadge}>{t("待跟进", "Follow up")}</span> : null}</span>
    <span className={styles.stage} data-status={lead.status}>{STATUSES[lead.status][zh ? 0 : 1]}</span>
    <span className={styles.rowMeta}>{lead.company} · {lead.role}</span>
    <span className={styles.rowSignals}>
      {burden !== null ? <span className={styles.burdenChip} data-level={burden >= 8 ? "high" : burden >= 5 ? "mid" : "low"}>{t("信息负担", "News burden")} {burden}/{JARVIS_NEWS_BURDEN_MAX}</span> : null}
      <span data-email={lead.email ? (lead.reviewed ? "reviewed" : "found") : "missing"}>{emailState(lead, zh)}</span>
    </span>
    <span className={styles.rowHint}>{sendChip ? <span className={styles.sendChip} data-tone={sendTone}>{sendChip}</span> : null}{lead.persona ? <span className={styles.personaTag} data-persona={lead.persona}>{PERSONAS[lead.persona][zh ? 0 : 1]}</span> : null}{lead.industry}{lead.personLocation ? ` · ${lead.personLocation}` : ""}</span>
  </button>
  </div>;
});

function localTime(timeZone: string | undefined, locale: string) {
  if (!timeZone) return "";
  try { return new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date()); }
  catch { return ""; }
}

function LeadEditor({ lead, zh, locale, tab, onTab, due, refresh, onDirty }: { lead: JarvisLead; zh: boolean; locale: string; tab: Tab; onTab: (tab: Tab) => void; due: boolean; refresh: () => Promise<void>; onDirty: (dirty: boolean) => void }) {
  const t = (cn: string, en: string) => zh ? cn : en;
  // Explicit Save avoids polling overwriting an unsaved email or interview note.
  const [draft, setDraft] = useState(() => ({ subject: lead.subject, body: lead.body, email: lead.email, emailSource: lead.emailSource, emailQuote: lead.emailQuote,
    notes: lead.notes, confirmedNeeds: lead.confirmedNeeds, role: lead.role, seniority: lead.seniority, industry: lead.industry, needHypothesis: lead.needHypothesis,
    personLocation: lead.personLocation ?? "", personLocationSource: lead.personLocationSource ?? "", companyLocation: lead.companyLocation ?? "", companyLocationSource: lead.companyLocationSource ?? "", timeZone: lead.timeZone ?? "" }));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState("");
  const [sendAccess, setSendAccess] = useState(false);
  const [preview, setPreview] = useState<{ revision: number; email: string; subject: string; body: string } | null>(null);
  useEffect(() => { void loadSendAccess().then(setSendAccess); }, []);
  const connect = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/robin/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "connect" }) });
      const result = await response.json() as { authorizeUrl?: string; error?: string };
      if (!response.ok || !result.authorizeUrl) throw new Error(result.error ?? "Google authorization failed");
      window.location.assign(result.authorizeUrl);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); setBusy(false); }
  };
  const send = async () => {
    if (!preview) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await mutate(API, "POST", { action: "send", id: lead.id, revision: preview.revision, confirmed: true });
      setMessage(t("Gmail 已接受这封邮件并记录为已发送。", "Gmail accepted the message; recorded as Sent."));
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setPreview(null); await refresh(); setBusy(false); }
  };
  // Copies what is on screen, including unsaved edits: copying sends nothing.
  const copy = async (key: string, value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(key); window.setTimeout(() => setCopied((c) => c === key ? "" : c), 1500); }
    catch { setError(t("浏览器拒绝了剪贴板访问，请手动选择复制。", "The browser blocked clipboard access; select and copy manually.")); }
  };
  const copyButton = (key: string, label: string, value: string) => <button type="button" className="ui-action pi-bracket" disabled={!value} onClick={() => void copy(key, value)}>{copied === key ? t("已复制", "Copied") : label}</button>;
  useEffect(() => { onDirty(dirty || busy); }, [dirty, busy, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
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
  const tabs: Array<[Tab, string]> = [["overview", t("概览", "Overview")], ["email", t("邮件", "Email")], ["activity", t("进度与笔记", "Activity & notes")]];

  return <article className={styles.editor}>
    <header className={styles.editorHead} data-segment={lead.segment}>
      <div>
        <span className={`pi-eyebrow ${styles.segmentTag}`} data-segment={lead.segment}>{SEGMENTS[lead.segment][zh ? 0 : 1]}{lead.persona ? ` · ${PERSONAS[lead.persona][zh ? 0 : 1]}` : ""}</span>
        <h2>{lead.name}</h2>
        <p>{lead.company} · {lead.role}</p>
        <p className="text-xs">
          <span className={styles.stage} data-status={lead.status}>{STATUSES[lead.status][zh ? 0 : 1]}</span>
          {clock ? <span> · {t("对方当地", "Their time")} {clock}</span> : null}
          {lead.sentAt ? <span> · {t("发信", "Sent")} {new Date(lead.sentAt).toLocaleDateString()}</span> : null}
        </p>
        <a href={lead.profileUrl} target="_blank" rel="noreferrer">{t("公开职业资料 ↗", "Public professional profile ↗")}</a>
      </div>
      <div className={styles.quickStatus}><span className="text-xs">{t("标记为", "Mark as")}</span>{(["sent", "replied", "do_not_contact"] as const).map((s) => <button key={s} className="ui-action pi-bracket" disabled={busy || dirty || lead.status === "do_not_contact" || lead.status === s || (s === "sent" && (!lead.reviewed || blocked))} onClick={() => void save({ status: s })}>{STATUSES[s][zh ? 0 : 1]}</button>)}</div>
    </header>

    <div className={styles.tabs} role="tablist" aria-label={t("联系人分区", "Contact sections")}>
      {tabs.map(([key, label]) => <button key={key} type="button" role="tab" id={`jarvis-tab-${key}`} aria-controls={`jarvis-panel-${key}`} aria-selected={tab === key} onClick={() => onTab(key)}>{label}</button>)}
    </div>

    {/* Panels stay mounted so a draft on one tab survives looking at another. */}
    <div role="tabpanel" id="jarvis-panel-overview" aria-labelledby="jarvis-tab-overview" hidden={tab !== "overview"} className={styles.panel}>
      <section><h3 className="pi-label">{t("为什么找这个人", "Why this person")}</h3>{lead.watchList ? <p><strong>{t("关注清单", "Watch list")}:</strong> {lead.watchList}</p> : null}{lead.foundVia ? <p className="text-xs">{t("发现于", "Found via")}: <a href={lead.foundVia.url} target="_blank" rel="noreferrer">{lead.foundVia.source} ↗</a></p> : null}<blockquote>{lead.evidence}</blockquote><a href={lead.evidenceUrl} target="_blank" rel="noreferrer">{t("查看证据来源 ↗", "Read evidence source ↗")}</a><p className="text-xs">{t("AI 收集的资料，需核对当前职位；以下需求仅是假设，不代表对方已表达痛点。", "AI-researched data: check the current role. Needs below are hypotheses, not stated pain.")}</p>{field("needHypothesis", t("需求假设", "Need hypothesis"), true)}
        {lead.newsBurden ? <div><h4 className="pi-label">{t("信息负担", "News burden")} · {newsBurdenTotal(lead)}/{JARVIS_NEWS_BURDEN_MAX}</h4><ul className={`text-xs ${styles.burden}`}>{JARVIS_NEWS_BURDEN_KEYS.map((key) => <li key={key}><span className={styles.burdenHead}><strong>{BURDEN[key][zh ? 0 : 1]}</strong><span className={styles.pips} data-score={lead.newsBurden![key].score} aria-label={`${lead.newsBurden![key].score}/3`}><i /><i /><i /></span></span>{lead.newsBurden![key].evidence}</li>)}</ul></div> : null}
        <details><summary>{t("修正行业与职级", "Correct industry and seniority")}</summary><div className={styles.fields}>{field("industry", t("行业", "Industry"))}{field("role", t("职位", "Role"))}{field("seniority", t("职级", "Seniority"))}</div></details>
      </section>
      <section><h3 className="pi-label">{t("地点与时区", "Locations and time zone")}</h3>
        <p className="text-xs">{t("只记录公开的工作地点，不记录住址。公司总部不能推定个人所在地；IANA 时区按个人工作地推定，会随夏令时调整。没有来源则留空。", "Public work locations only, never home addresses. Company HQ does not establish a person's location; IANA time zone is inferred from their work location and handles DST. Leave unsupported fields blank.")}</p>
        <div className={styles.fields}>{field("personLocation", t("个人工作所在地 · 城市 / 州 / 国家", "Person's work location · city / region / country"))}{field("personLocationSource", t("个人工作地来源 URL", "Person location source URL"))}
        {lead.personLocationSource ? <a href={lead.personLocationSource} target="_blank" rel="noreferrer">{t("核对个人地点来源 ↗", "Check person location source ↗")}</a> : null}
        {field("companyLocation", t("公司总部或办公室 · 请写明类型", "Company HQ or office · specify which"))}{field("companyLocationSource", t("公司地点来源 URL", "Company location source URL"))}
        {lead.companyLocationSource ? <a href={lead.companyLocationSource} target="_blank" rel="noreferrer">{t("核对公司地点来源 ↗", "Check company location source ↗")}</a> : null}
        {field("timeZone", t("个人时区 · IANA（如 America/Chicago）", "Person's time zone · IANA (e.g. America/Chicago)"))}</div>
      </section>
    </div>

    <div role="tabpanel" id="jarvis-panel-email" aria-labelledby="jarvis-tab-email" hidden={tab !== "email"} className={styles.panel}>
      <section><h3 className="pi-label">{t("工作邮箱", "Work email")}</h3><p className="text-xs">{lead.emailCheck === "source_found" ? t("已在来源页面找到该地址；不保证归属、可投递性或联系许可。", "Address found on the source page; ownership, deliverability and permission are not verified.") : t("尚未独立确认该地址。请核对公开来源，不使用猜测或私人邮箱。", "Address not independently confirmed. Check a public professional source; no guessed or private-life email.")}</p>
        {field("email", t("邮箱地址", "Email address"))}{field("emailSource", t("公开邮箱来源 URL", "Public email source URL"))}{field("emailQuote", t("包含完整邮箱的原文", "Source quote containing the exact email"), true, 2)}
        {lead.emailSource ? <a href={lead.emailSource} target="_blank" rel="noreferrer">{t("核对邮箱来源 ↗", "Check email source ↗")}</a> : null}
      </section>
      <section><h3 className="pi-label">{t("邮件草稿 · 英文", "Email draft · English")}</h3>{field("subject", t("主题", "Subject"))}{field("body", t("正文", "Body"), true, 15)}
        <div className={styles.actions}>{copyButton("email", t("复制邮箱", "Copy email"), draft.email)}{copyButton("subject", t("复制主题", "Copy subject"), draft.subject)}{copyButton("body", t("复制正文", "Copy body"), draft.body)}</div>
        <div className={styles.actions}><button className="ui-action pi-bracket" disabled={busy || !dirty} onClick={() => void save(draft)}>{t("保存修改", "Save changes")}</button><button className="ui-action pi-bracket" disabled={busy || blocked || !draft.email} onClick={() => void save({ ...draft, reviewed: true, ...(lead.status === "new" ? { status: "ready" } : {}) })}>{t("已核对身份、邮箱与草稿", "Approve identity, email and draft")}</button></div>
        {lead.queuedAt && !lead.sendAttempt ? <div className={styles.actions}><span className="text-xs">{t("已排队：发送箱会在对方工作时间自动发出这份草稿。修改草稿或邮箱会将其移出队列。", "Queued: the outbox sends this draft during the recipient's working hours. Editing the draft or email removes it from the queue.")}</span><button type="button" className="ui-action pi-bracket" disabled={busy} onClick={() => void (async () => { setBusy(true); try { await mutate(API, "POST", { action: "unqueue", ids: [lead.id] }); await refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); } finally { setBusy(false); } })()}>{t("移出队列", "Remove from queue")}</button></div> : null}
        {lead.followUpAttempt ? <p className="text-xs">{t("自动跟进", "Automatic follow-up")}: {lead.followUpAttempt.state === "sent" ? t("已发出", "sent") : t("结果不确定，请查 Gmail 已发送", "outcome uncertain; check Gmail Sent")} · {new Date(lead.followUpAttempt.at).toLocaleString()}</p> : null}
        {links ? <div className={styles.actions}><a className="ui-action pi-bracket" href={links.gmail} target="_blank" rel="noreferrer">{t("在 Gmail 打开", "Open in Gmail")}</a><a className="ui-action pi-bracket" href={links.mailto}>{t("打开邮件客户端", "Open email app")}</a></div> : <p className="text-xs">{t("保存并核对后才显示邮件链接。不再联系、退信和拒绝的联系人不会显示链接。", "Save and approve to enable compose links. Suppressed, bounced or declined contacts have no compose links.")}</p>}
        <p className="text-xs">{t("上面的链接只打开草稿；下面的发送按钮会真正通过 Gmail 发出一封邮件。", "The links above only open drafts; the send button below actually sends one email via Gmail.")}</p>
        {(lead.sendAttempt?.state === "pending" || lead.sendAttempt?.state === "uncertain") && !["sent", "do_not_contact"].includes(lead.status) ? <p role="alert" className={styles.error}>{t("这封邮件的发送结果不确定。请先到 Gmail「已发送」核对；系统不会自动重试。", "Delivery outcome is uncertain. Check Gmail Sent; this contact cannot be retried automatically.")}</p> : null}
        {!sendAccess && lead.status === "ready" && lead.reviewed && !lead.sendAttempt ? <button type="button" className="ui-action pi-bracket" disabled={busy} onClick={() => void connect()}>{t("连接 Google 并授权 Gmail 发送", "Connect Google for Gmail send access")}</button> : null}
        {sendAccess && lead.status === "ready" && lead.reviewed && !lead.sendAttempt ? <button type="button" className="ui-action pi-bracket" disabled={busy || dirty} onClick={() => setPreview({ revision: lead.revision ?? 0, email: lead.email, subject: lead.subject, body: lead.body })}>{t("预览并确认发送一封", "Review and send one email")}</button> : null}
        {preview ? <div role="group" aria-label={t("发送前核对完整邮件", "Review full email before sending")} className={styles.sendPreview}>
          <strong>{t("即将真实发送（不会再打开草稿）", "This will actually send, not open a draft")}</strong>
          <p>To: {preview.email}</p><p>Subject: {preview.subject}</p><pre>{preview.body}</pre>
          <div className={styles.actions}><button type="button" className="ui-action pi-bracket" disabled={busy} onClick={() => void send()}>{t(`确认发送给 ${preview.email}`, `Confirm send to ${preview.email}`)}</button><button type="button" className="ui-action pi-bracket" disabled={busy} onClick={() => setPreview(null)}>{t("取消", "Cancel")}</button></div>
        </div> : null}
      </section>
    </div>

    <div role="tabpanel" id="jarvis-panel-activity" aria-labelledby="jarvis-tab-activity" hidden={tab !== "activity"} className={styles.panel}>
      <section><h3 className="pi-label">{t("联系进度", "Contact progress")}</h3>
        {due ? <div className={styles.followUpNotice}>
          <span>{t(`发信于 ${new Date(lead.sentAt!).toLocaleDateString()}，已满 7 天且尚未记录回复。请先检查邮箱。`, `Sent ${new Date(lead.sentAt!).toLocaleDateString()}; 7+ days with no reply recorded. Check your inbox first.`)}</span>
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
      {dirty ? <p role="status">{t("有未保存修改，请保存后再切换联系人。", "Unsaved changes: save before switching contacts.")}</p> : null}
      {message ? <p role="status">{message}</p> : null}{error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </div>
  </article>;
}

// One Google status request per page load, not one per contact opened.
let sendAccessRequest: Promise<boolean> | null = null;
function loadSendAccess(): Promise<boolean> {
  sendAccessRequest ??= fetch("/api/robin/google").then((r) => r.json()).then((value: { canSendGmail?: boolean }) => value.canSendGmail === true).catch(() => { sendAccessRequest = null; return false; });
  return sendAccessRequest;
}
