"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { CORE_JARVIS_SEGMENTS, JARVIS_STATUSES, isSendableCore, jarvisComposeLinks, type JarvisLead, type JarvisSegment, type JarvisState, type JarvisStatus } from "@/extension/robin/jarvis-shape";
import { mutate, usePolledResource } from "./usePolledResource";
import styles from "./JarvisDiscovery.module.css";

const API = "/api/robin/jarvis";
const SEGMENTS: Record<JarvisSegment, [string, string]> = {
  clinic: ["诊所 / 医疗运营", "Clinics / healthcare operators"],
  professional_services: ["专业服务", "Professional services"],
  nontech_exec: ["非科技行业管理者", "Non-tech executives"],
  small_tech: ["小型科技公司 · 非技术管理者", "Small tech · non-technical leaders"],
  founder: ["原名单 · 创始人 / CTO", "Original · founders / CTOs"], investor: ["原名单 · 投资人", "Original · investors"],
  product: ["原名单 · 产品 / 战略", "Original · product / strategy"], research: ["原名单 · 应用研究", "Original · applied research"],
};
const STATUSES: Record<JarvisStatus, [string, string]> = {
  new: ["待核对", "Needs review"], ready: ["待发送", "Ready"], sent: ["已发送", "Sent"],
  replied: ["已回复", "Replied"], interested: ["有兴趣", "Interested"], declined: ["不感兴趣", "Declined"],
  bounced: ["退信", "Bounced"], do_not_contact: ["不再联系", "Do not contact"],
};

export function JarvisDiscovery() {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const t = (cn: string, en: string) => zh ? cn : en;
  const { data, error, refresh } = usePolledResource<JarvisState>(API, 5000);
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<JarvisSegment | "core" | "adjacent" | "all">("core");
  const [status, setStatus] = useState<JarvisStatus | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [hasEdits, setHasEdits] = useState(false);
  const selectLead = (id: string) => {
    if (id === selected) return;
    if (hasEdits && !window.confirm(t("放弃未保存的修改并切换联系人？", "Discard unsaved edits and switch contacts?"))) return;
    setHasEdits(false); setSelected(id);
  };
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const leads = data?.leads ?? [];
  const core = leads.filter((lead) => lead.audienceFit === "core");
  const adjacent = leads.filter((lead) => lead.audienceFit === "adjacent");
  const sendable = leads.filter(isSendableCore).length;
  const visible = leads.filter((lead) => (segment === "all" || segment === lead.audienceFit || lead.segment === segment) && (status === "all" || lead.status === status)
    && `${lead.name} ${lead.company} ${lead.role} ${lead.industry} ${lead.seniority} ${lead.needHypothesis}`.toLowerCase().includes(query.toLowerCase()));
  const current = leads.find((lead) => lead.id === selected);
  const running = data?.run?.status === "running";
  const act = async (body: unknown) => {
    setBusy(true); setActionError("");
    try { await mutate(API, "POST", body); await refresh(); }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const start = (target: number) => {
    if (target > sendable + 3 && !window.confirm(t("将使用当前模型与搜索服务，分批收集，直到 100 位核心受众有公开工作邮箱。可能运行较久并消耗模型/搜索额度；可随时停止。继续？", "Research until 100 core contacts have a sourced work email, using the current model and search provider? This uses model/search quota and may take a while. You can stop at any time."))) return;
    void act({ action: "discover", target });
  };

  return <main className={`robin-page robin-dashboard ${styles.page}`}>
    <div className={styles.inner}>
      <Link href="/product" className="ui-action pi-bracket text-xs">{t("返回 Product", "Back to Product")}</Link>
      <header className={styles.header}>
        <div><span className="pi-eyebrow">MARKET DISCOVERY</span><h1>Jarvis<span className={styles.day}>.day</span></h1><p>{t("找到值得交流的人，而不是凑满一张邮件名单。", "Find people worth learning from, not just addresses to fill a list.")}</p></div>
        <a href="https://jarvis.day" target="_blank" rel="noreferrer" className="ui-action pi-bracket text-xs">{t("产品网站", "Product site")}</a>
      </header>

      <section className={styles.summary} aria-label={t("探索进度", "Discovery progress")}>
        {[[sendable, t("可发邮件 · 核心 / 100", "Sendable core / 100")], [core.length, t("核心候选人（含无邮箱）", "Core candidates (incl. no email)")], [core.filter((l) => l.sentAt).length, t("核心已发送 / 100", "Core sent / 100")], [core.filter((l) => l.repliedAt).length, t("核心已回复", "Core replied")]].map(([n, label]) => <div key={label}><strong>{data ? n : "—"}</strong><span>{label}</span></div>)}
      </section>

      <section className={`pi-panel ${styles.research}`} aria-label={t("自动找人", "Automated research")}>
        <div><h2 className="pi-label">{t("研究队列", "Research queue")}</h2><p className="text-xs">{t("LLM + Web Search · 每批最多 3 人 · 只计有公开工作邮箱的人 · 来源可查 · 自动去重 · 仅公开工作联系方式", "LLM + web search · up to 3 per batch · only people with a public work email count · sourced · deduplicated · public work contacts only")}</p></div>
        <div className={styles.actions}>
          {running ? <button className="ui-action pi-bracket" disabled={busy} onClick={() => void act({ action: "stop" })}>{t("停止搜索", "Stop research")}</button> : <>
            <button className="ui-action pi-bracket" disabled={busy || !data || sendable >= 100} onClick={() => start(Math.min(100, sendable + 3))}>{t("找下一批 3 人", "Find next 3")}</button>
            <button className="ui-action pi-bracket" disabled={busy || !data || sendable >= 100} onClick={() => start(100)}>{t("自动补齐 100 位可发邮件的人", "Research to 100 sendable")}</button>
          </>}
          <a className="ui-action pi-bracket" href={`${API}/report?inline=1`} target="_blank" rel="noreferrer">{t("查看 HTML 名单", "View HTML list")}</a>
          <a className="ui-action pi-bracket" href={`${API}/report`} download>{t("导出 HTML", "Export HTML")}</a>
        </div>
        <p className={`text-xs ${styles.full}`} role={data?.run?.status === "error" ? "alert" : "status"}>{data?.run ? `${data.run.status} · ${data.run.message}` : t("先小批量核对质量。可离开页面，搜索会在本地服务器继续；服务器重启后需手动续跑。", "Start small to review quality. Research continues on this local server when you leave the page; restart manually after a server restart.")}</p>
      </section>
      {error || actionError ? <p role="alert" className={styles.error}>{error || actionError}</p> : null}

      <div className={styles.cohorts} role="group" aria-label={t("人群", "Cohort")}>
        <button className="ui-action" aria-pressed={segment === "core"} onClick={() => setSegment("core")}>{t("核心受众", "Core audience")} · {core.length}</button>
        {CORE_JARVIS_SEGMENTS.map((s) => {
          const target = s === "clinic" || s === "nontech_exec" ? 30 : s === "professional_services" ? 25 : 15;
          return <button key={s} className="ui-action" aria-pressed={segment === s} onClick={() => setSegment(s)}>{SEGMENTS[s][zh ? 0 : 1]} <span>{core.filter((lead) => lead.segment === s && lead.email).length} / {target}</span></button>;
        })}
        <button className="ui-action" aria-pressed={segment === "adjacent"} onClick={() => setSegment("adjacent")}>{t("原科技圈名单", "Original tech-heavy list")} · {adjacent.length}</button>
        <button className="ui-action" aria-pressed={segment === "all"} onClick={() => setSegment("all")}>{t("全部", "All")} · {leads.length}</button>
      </div>
      <div className={styles.filters}>
        <label>{t("搜索姓名、公司、行业、需求", "Search name, company, industry, needs")}<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <label>{t("联系状态", "Contact status")}<select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="all">{t("所有状态", "All statuses")}</option>{JARVIS_STATUSES.map((s) => <option key={s} value={s}>{STATUSES[s][zh ? 0 : 1]}</option>)}</select></label>
      </div>
      <div className={styles.workbench}>
        <section aria-label={t("候选人名单", "Candidates")} className={styles.list}>
          {!data ? <p role="status">{t("正在读取名单…", "Loading contacts…")}</p> : visible.length === 0 ? <div className={`pi-panel ${styles.empty}`}><h2>{leads.length ? t("没有符合筛选条件的人", "No matching contacts") : t("第一位受访者，从这里开始。", "Your first conversation starts here.")}</h2><p>{t("点击「找下一批 3 人」。没有查到邮箱的人会保留在名单里，不会猜测地址。", "Choose Find next 3. People without a sourced email remain in the list; addresses are never guessed.")}</p></div> : null}
          {visible.map((lead) => <button key={lead.id} className={`ui-action ${styles.contact}`} aria-pressed={selected === lead.id} onClick={() => selectLead(lead.id)}>
            <span className={styles.contactTop}><strong>{lead.name}</strong><span className="text-xs">{STATUSES[lead.status][zh ? 0 : 1]}</span></span>
            <span>{lead.company} · {lead.role}</span>
            <span className="text-xs">{lead.industry} · {lead.seniority}</span>
            <span className={styles.hypothesis}>{t("假设", "Hypothesis")}: {lead.needHypothesis}</span>
            <span className="text-xs">{lead.email ? (lead.reviewed ? t("已人工核对", "Human-reviewed") : t("有邮箱 · 待人工核对", "Email found · review required")) : t("工作邮箱待补充", "Work email missing")}</span>
          </button>)}
        </section>
        <section className={styles.detail} aria-label={t("联系人详情与邮件", "Contact details and email")}>
          {current ? <LeadEditor key={current.id} lead={current} zh={zh} refresh={refresh} onDirty={setHasEdits} /> : <div className={`pi-panel ${styles.empty}`}><h2>{t("先看依据，再发邮件。", "Evidence first. Email second.")}</h2><p>{t("选择一位候选人，核对他的工作、需求假设和邮箱来源，然后编辑邮件。没有任何自动发送。", "Select a contact to inspect their work, need hypothesis and email source, then edit the draft. Nothing is sent automatically.")}</p></div>}
        </section>
      </div>
    </div>
  </main>;
}

function LeadEditor({ lead, zh, refresh, onDirty }: { lead: JarvisLead; zh: boolean; refresh: () => Promise<void>; onDirty: (dirty: boolean) => void }) {
  const t = (cn: string, en: string) => zh ? cn : en;
  // Explicit Save avoids polling overwriting an unsaved email or interview note.
  const [draft, setDraft] = useState(() => ({ subject: lead.subject, body: lead.body, email: lead.email, emailSource: lead.emailSource, emailQuote: lead.emailQuote,
    notes: lead.notes, confirmedNeeds: lead.confirmedNeeds, role: lead.role, seniority: lead.seniority, industry: lead.industry, needHypothesis: lead.needHypothesis }));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState("");
  // Copies what is on screen, including unsaved edits: copying sends nothing.
  const copy = async (key: string, value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(key); window.setTimeout(() => setCopied((c) => c === key ? "" : c), 1500); }
    catch { setError(t("浏览器拒绝了剪贴板访问，请手动选择复制。", "The browser blocked clipboard access; select and copy manually.")); }
  };
  const copyButton = (key: string, label: string, value: string) => <button type="button" className="ui-action pi-bracket" disabled={!value} onClick={() => void copy(key, value)}>{copied === key ? t("已复制", "Copied") : label}</button>;
  useEffect(() => { onDirty(dirty || busy); }, [dirty, busy, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const edit = (key: keyof typeof draft, value: string) => { setDraft((d) => ({ ...d, [key]: value })); setDirty(true); setMessage(""); };
  const save = async (patch: Record<string, unknown>) => {
    setBusy(true); setError(""); setMessage("");
    try {
      await mutate(API, "PATCH", { id: lead.id, patch });
      setDirty(false); await refresh(); setMessage(t("已保存", "Saved"));
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const links = dirty || busy ? null : jarvisComposeLinks(lead);
  const blocked = ["declined", "bounced", "do_not_contact"].includes(lead.status);
  const field = (key: keyof typeof draft, label: string, multiline = false, rows = 3) => <label>{label}{multiline ? <textarea disabled={busy} rows={rows} value={draft[key]} onChange={(e) => edit(key, e.target.value)} /> : <input disabled={busy} value={draft[key]} onChange={(e) => edit(key, e.target.value)} />}</label>;
  return <article className={`pi-panel ${styles.editor}`}>
    <header><span className="pi-eyebrow">{SEGMENTS[lead.segment][zh ? 0 : 1]}</span><h2>{lead.name}</h2><p>{lead.company} · {lead.role}</p><a href={lead.profileUrl} target="_blank" rel="noreferrer">{t("公开职业资料 ↗", "Public professional profile ↗")}</a></header>
    <section><h3 className="pi-label">{t("为什么找这个人", "Why this person")}</h3><blockquote>{lead.evidence}</blockquote><a href={lead.evidenceUrl} target="_blank" rel="noreferrer">{t("查看证据来源 ↗", "Read evidence source ↗")}</a><p className="text-xs">{t("AI 收集的资料，需核对当前职位；以下需求仅是假设，不代表对方已表达痛点。", "AI-researched data: check the current role. Needs below are hypotheses, not stated pain.")}</p>{field("needHypothesis", t("需求假设", "Need hypothesis"), true)}
      <details><summary>{t("修正行业与职级", "Correct industry and seniority")}</summary><div className={styles.fields}>{field("industry", t("行业", "Industry"))}{field("role", t("职位", "Role"))}{field("seniority", t("职级", "Seniority"))}</div></details>
    </section>
    <section><h3 className="pi-label">{t("工作邮箱", "Work email")}</h3><p className="text-xs">{lead.emailCheck === "source_found" ? t("已在来源页面找到该地址；不保证归属、可投递性或联系许可。", "Address found on the source page; ownership, deliverability and permission are not verified.") : t("尚未独立确认该地址。请核对公开来源，不使用猜测或私人邮箱。", "Address not independently confirmed. Check a public professional source; no guessed or private-life email.")}</p>
      {field("email", t("邮箱地址", "Email address"))}{field("emailSource", t("公开邮箱来源 URL", "Public email source URL"))}{field("emailQuote", t("包含完整邮箱的原文", "Source quote containing the exact email"), true, 2)}
      {lead.emailSource ? <a href={lead.emailSource} target="_blank" rel="noreferrer">{t("核对邮箱来源 ↗", "Check email source ↗")}</a> : null}
    </section>
    <section><h3 className="pi-label">{t("邮件草稿 · 英文", "Email draft · English")}</h3>{field("subject", t("主题", "Subject"))}{field("body", t("正文", "Body"), true, 15)}
      <div className={styles.actions}>{copyButton("email", t("复制邮箱", "Copy email"), draft.email)}{copyButton("subject", t("复制主题", "Copy subject"), draft.subject)}{copyButton("body", t("复制正文", "Copy body"), draft.body)}</div>
      <div className={styles.actions}><button className="ui-action pi-bracket" disabled={busy || !dirty} onClick={() => void save(draft)}>{t("保存修改", "Save changes")}</button><button className="ui-action pi-bracket" disabled={busy || blocked || !draft.email} onClick={() => void save({ ...draft, reviewed: true, ...(lead.status === "new" ? { status: "ready" } : {}) })}>{t("已核对身份、邮箱与草稿", "Approve identity, email and draft")}</button></div>
      {links ? <div className={styles.actions}><a className="ui-action pi-bracket" href={links.gmail} target="_blank" rel="noreferrer">{t("在 Gmail 打开", "Open in Gmail")}</a><a className="ui-action pi-bracket" href={links.mailto}>{t("打开邮件客户端", "Open email app")}</a></div> : <p className="text-xs">{t("保存并核对后才显示邮件链接。不再联系、退信和拒绝的联系人不会显示链接。", "Save and approve to enable compose links. Suppressed, bounced or declined contacts have no compose links.")}</p>}
      <p className="text-xs">{t("只打开草稿，不会发送。发送后请手动标记「已发送」。", "Opens a draft only. After sending it yourself, mark Sent below.")}</p>
    </section>
    <section><h3 className="pi-label">{t("联系进度", "Contact progress")}</h3><label>{t("当前状态", "Current status")}<select value={lead.status} disabled={busy || dirty || lead.status === "do_not_contact"} onChange={(e) => void save({ status: e.target.value })}>{JARVIS_STATUSES.map((s) => <option key={s} value={s} disabled={["ready", "sent"].includes(s) && (!lead.reviewed || blocked)}>{STATUSES[s][zh ? 0 : 1]}</option>)}</select></label>
      <div className={styles.actions}>{(["sent", "replied", "do_not_contact"] as const).map((s) => <button key={s} className="ui-action pi-bracket" disabled={busy || dirty || lead.status === "do_not_contact" || lead.status === s || (s === "sent" && (!lead.reviewed || blocked))} onClick={() => void save({ status: s })}>{STATUSES[s][zh ? 0 : 1]}</button>)}</div>
      {field("confirmedNeeds", t("真实需求 / 对方原话（人工记录）", "Confirmed needs / their words (manual)"), true)}{field("notes", t("回复、现有工具、付费信号与下一步", "Reply, current tools, payment signals and next step"), true)}
      <button className="ui-action pi-bracket" disabled={busy || !dirty} onClick={() => void save(draft)}>{t("保存记录", "Save notes")}</button>
      <details><summary>{t("状态历史", "Status history")}</summary><ol className="text-xs">{lead.history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleString()} · {STATUSES[h.status][zh ? 0 : 1]}</li>)}</ol></details>
    </section>
    {dirty ? <p role="status">{t("有未保存修改，请保存后再切换联系人。", "Unsaved changes: save before switching contacts.")}</p> : null}
    {message ? <p role="status">{message}</p> : null}{error ? <p role="alert" className={styles.error}>{error}</p> : null}
  </article>;
}
