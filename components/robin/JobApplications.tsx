"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { applicationBoard } from "@/extension/robin/job-application-domain";
import { APPLICATION_WORKFLOW_VERSION } from "@/extension/robin/job-applications";
import { mutate, usePolledResource } from "./usePolledResource";
import { ApplicationAnswers } from "./ApplicationAnswers";
import { requestRefresh } from "./refreshBus";
import styles from "./JobApplications.module.css";

type Board = ReturnType<typeof applicationBoard>;
const endpoint = "/api/robin/jobs/applications";
const actionClass = "ui-action pi-bracket font-mono text-xs disabled:opacity-40";
const collapsedRowCount = 5;

/** The review is evidence, not a second editable copy of the employer's form. */
export function JobApplications({ listReady }: { listReady: boolean }) {
  const { locale } = useI18n();
  const text = (en: string, zh: string) => locale.startsWith("zh") ? zh : en;
  const { data, error, loading, refresh } = usePolledResource<Board>(endpoint, (data) => data?.running ? 5000 : 60_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const [answersOpen, setAnswersOpen] = useState(false);
  const [answerFocus, setAnswerFocus] = useState<{ jobId: string; fieldKey: string } | undefined>();
  const [approvedJob, setApprovedJob] = useState<string | null>(null);
  const settingsRef = useRef<HTMLDetailsElement>(null);
  const historyRef = useRef<HTMLDetailsElement>(null);
  const followedLink = useRef(false);
  const followedQuestions = useRef(false);
  const followedReport = useRef(false);
  const followedFollowUps = useRef(false);
  useEffect(() => { if (window.location.hash === "#application-answers") setAnswersOpen(true); }, []);
  useEffect(() => {
    if (!listReady || !data || followedReport.current || window.location.hash !== "#application-report") return;
    const frame = requestAnimationFrame(() => { document.getElementById("application-report")?.scrollIntoView({ block: "start" }); followedReport.current = true; });
    return () => cancelAnimationFrame(frame);
  }, [data, listReady]);
  useEffect(() => {
    if (!listReady || !data || followedFollowUps.current || window.location.hash !== "#application-follow-ups") return;
    const frame = requestAnimationFrame(() => {
      const section = document.getElementById("application-follow-ups");
      if (!section) return;
      section.scrollIntoView({ block: "start" });
      followedFollowUps.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [data, listReady]);
  useEffect(() => {
    if (!listReady || !data || followedQuestions.current || window.location.hash !== "#application-questions") return;
    const frame = requestAnimationFrame(() => {
      const section = document.getElementById("application-questions") as HTMLDetailsElement | null;
      if (!section) return;
      section.open = true;
      section.scrollIntoView({ block: "start" });
      followedQuestions.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [data, listReady]);
  useEffect(() => {
    if (!answersOpen || !data || window.location.hash !== "#application-answers") return;
    settingsRef.current?.setAttribute("open", "");
    if (!listReady || followedLink.current) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById("application-personal-profile")?.scrollIntoView({ block: "start" });
      followedLink.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [answersOpen, data, listReady]);
  const labels = {
    preparing: text("Autofill / checking", "填充／校验中"), review: text("Validated, not submitted", "校验通过，未提交"),
    attention: text("Needs your answer", "需要你确认"), error: text("Automation error", "技术失败"),
    unavailable: text("Posting unavailable", "职位不可访问"),
    blocked: text("Sources changed", "资料有变"), submitting: text("Submitting", "提交中"),
    uncertain: text("Receipt uncertain — no retry", "结果不明，禁止重投"), submitted: text("Submitted · receipt confirmed", "已提交 · 回执确认"),
  };
  const action = async (kind: string, id?: string) => {
    setBusy(`${id ?? "batch"}:${kind}`); setActionError(null);
    try { await mutate(endpoint, "POST", { action: kind, id }); if (kind === "drop") requestRefresh(); await refresh(); }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(null); }
  };
  const autoEnabled = Boolean(data?.settings.enabled && data.settings.dailyLimit > 0);
  const toggle = async () => {
    setBusy("schedule"); setActionError(null);
    try { await mutate(endpoint, "PATCH", { enabled: !autoEnabled,
      ...(!autoEnabled && data?.settings.dailyLimit === 0 ? { dailyLimit: 5 } : {}) }); await refresh(); }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(null); }
  };
  const disabled = Boolean(busy || data?.running);
  const rows = data?.rows.filter((row) => filter === "all" || (filter === "legacy"
    ? row.application.workflowVersion !== APPLICATION_WORKFLOW_VERSION
    : row.application.workflowVersion === APPLICATION_WORKFLOW_VERSION && row.application.stage === filter)) ?? [];
  const needsInput = data?.rows.filter((row) => row.application.workflowVersion === APPLICATION_WORKFLOW_VERSION
    && (row.application.stage === "attention" || row.application.stage === "blocked" && row.pendingQuestionKeys.length > 0)) ?? [];
  const needsRecovery = data?.rows.filter((row) => row.application.workflowVersion === APPLICATION_WORKFLOW_VERSION
    && ["error", "unavailable", "uncertain"].includes(row.application.stage))
    .sort((a, b) => Number(b.application.stage === "uncertain") - Number(a.application.stage === "uncertain")) ?? [];
  const approvedRow = data?.rows.find((row) => row.id === approvedJob);
  const canContinue = (row: Board["rows"][number]) => !row.application.submission && ["new", "shortlist"].includes(row.status)
    && !["uncertain", "unavailable", "submitted"].includes(row.application.stage);
  const rerun = (row: Board["rows"][number]) => {
    if (window.confirm(text("Rerun Jobright and audit this job? If checked submission is authorized, a validated form may be submitted. Never rerun an uncertain submission.", "重新运行 Jobright 并核查该岗位？如果已授权校验后提交，表单验证通过可能会提交。结果不明的申请绝不可重投。"))) {
      setApprovedJob(null); void action("prepare", row.id);
    }
  };
  const answerQuestion = (jobId: string, fieldKey: string) => {
    if (answerFocus && (answerFocus.jobId !== jobId || answerFocus.fieldKey !== fieldKey)
      && !window.confirm(text("Switch questions? Unsaved changes to the current job answer will be lost.", "切换问题？当前岗位答案未保存的修改将丢失。"))) return;
    if (answersOpen) setAnswersOpen(false);
    setAnswerFocus({ jobId, fieldKey });
  };
  const recovery = (row: Board["rows"][number]) => {
    const { stage, blockers } = row.application;
    if (stage === "uncertain") return text("Next: check this posting's receipt and search employer confirmation mail. If neither resolves it, contact the employer to ask whether this exact application arrived. Reapply only after definite evidence it was not received and a fresh audit; approval alone cannot make an unknown Submit safe to retry.", "下一步：检查本岗位回执并搜索雇主确认邮件；仍无结果则联系雇主核实这份申请是否收到。只有取得明确未收到的证据、重新核验表单后才考虑重投；单纯点击批准不能安全解除未知提交锁。");
    if (stage === "unavailable") return text("Posting unavailable. Check the application page; do not retry a removed posting.", "职位页面不可访问。请核查原申请页；已下架职位不应重试。");
    if (blockers.some((item) => item.includes("APPLICATION_FORM_UNAVAILABLE"))) return text("Employer form is not auditable (possibly an iframe). No answer can fix this; open the page and apply manually if appropriate.", "雇主表单无法审计（可能是跨域嵌入）。补答案无法解决；可打开网页核查，必要时自行申请。");
    if (blockers.some((item) => item.includes("JOBRIGHT_INCOMPLETE"))) return text("Jobright completion was not verified. Check its login and form in Chrome, then rerun; the resume was not checked.", "未核验到 Jobright 完成。请在 Chrome 中检查登录和表单，再重跑；简历附件尚未核查。");
    if (blockers.some((item) => /missing-text|document_changed|permission_denied|BSK_|not-ready/.test(item))) return text("Browser read failed before submission. Check Chrome / BSK connection, then rerun this job.", "提交前浏览器读取失败。检查 Chrome / BSK 连接后，可重跑该岗位。");
    return text("Automation stopped before submission. Review the reason below; rerun only after the cause is fixed.", "自动流程在提交前停止。请查看下方原因，排除故障后再重跑。");
  };
  const issueLabels: Record<NonNullable<Board["dailyCheck"]>["issues"][number], string> = {
    "scan-stale": text("Discovery scan overdue", "岗位扫描过期"), "scan-errors": text("Discovery scan errors", "岗位扫描有错误"),
    "scoring-error": text("Scoring failed", "岗位评分失败"), "scoring-pending": text("Scoring backlog", "有岗位待评分"),
    "supply-empty": text("No eligible new jobs", "暂无新的可投岗位"), "no-receipts": text("No confirmed submissions", "尚无确认回执"),
    "submission-uncertain": text("Submission outcomes unclear", "提交结果不明"), "application-error": text("Application failures", "投递流程失败"),
    paused: text("Auto-apply paused", "自动投递已暂停"),
  };
  const failureLabel = (reason: string) => ({ JOBRIGHT_INCOMPLETE: text("Jobright did not finish", "Jobright 未确认完成"),
    SUBMISSION_UNCERTAIN: text("Receipt not confirmed", "回执未确认"), UNCLASSIFIED_ERROR: text("Cause not classified", "原因尚未归类"),
    ANSWER_REQUIRED: text("Answer required", "需要回答问题") })[reason] ?? reason;
  const report = data?.report;
  const todayReportRows = report?.rows.filter((row) => row.attemptedToday || (row.receiptAt
    && new Intl.DateTimeFormat("en-CA", { timeZone: report.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(row.receiptAt)) === report.day)) ?? [];
  const pendingReportRows = report?.rows.filter((row) => !todayReportRows.includes(row)) ?? [];
  const approvedAnswer = (id: string) => {
    setApprovedJob(id);
    const next = data?.rows.find((row) => row.id === id)?.pendingQuestionKeys.find((key) => key !== answerFocus?.fieldKey);
    setAnswerFocus(next ? { jobId: id, fieldKey: next } : undefined);
  };
  const openRecord = (id: string) => {
    historyRef.current?.setAttribute("open", "");
    setFilter("all"); setExpanded(true);
    requestAnimationFrame(() => {
      const target = document.getElementById(`job-application-${id}`) as HTMLDetailsElement | null;
      if (target) { target.open = true; target.scrollIntoView({ block: "start" }); }
    });
  };
  const reportItem = (row: NonNullable<Board["report"]>["rows"][number]) => <li key={row.id} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t py-2.5 text-sm" style={{ borderColor: "var(--border)" }}>
    <span className="min-w-0 break-words"><strong className="font-medium">{row.company}</strong> · {row.title}
      {data?.rows.find((item) => item.id === row.id && ["error", "unavailable", "uncertain"].includes(item.application.stage)) && <small className="block text-xs" style={{ color: "var(--text-muted)" }}>{recovery(data.rows.find((item) => item.id === row.id)!)}</small>}
    </span>
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span style={{ color: row.stage === "error" ? "var(--danger)" : row.stage === "submitted" ? "var(--success)" : "var(--text-muted)" }}>{labels[row.stage]}</span>
      {data?.rows.some((item) => item.id === row.id) && <button type="button" className={`${actionClass} min-h-11`} onClick={() => openRecord(row.id)}>{text("View record", "查看记录")}</button>}
    </span>
  </li>;

  return <section id="application-answers" className={`${styles.desk} pi-card scroll-mt-24 flex flex-col gap-3 p-4`} aria-labelledby="applications-heading">
    <header className={styles.header}>
      <div>
        <h2 id="applications-heading" className={styles.title}>{text("Auto-apply", "自动投递")}</h2>
        <p className={styles.subtitle}>{text("We handle the forms. You only answer what we can't know.", "表单交给系统；只有它不知道的问题才找你。")}</p>
      </div>
      <div className={styles.actions}>
        <button type="button" className={`ui-action ui-action--primary ${styles.primary}`} aria-pressed={autoEnabled}
          disabled={Boolean(busy) || !data?.settings.configured} onClick={() => void toggle()}>
          {autoEnabled ? text("Pause auto-apply", "暂停自动投递") : text("Enable auto-apply", "开启自动投递")}
        </button>
      </div>
    </header>
    {(error || actionError) && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{actionError || error}</p>}
    {loading && !data && <p role="status">{text("Loading application reviews…", "加载申请审核记录…")}</p>}
    {data?.preflightError && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
      {text("Browser tool unavailable. Check Chrome / BSK, then continue. No roles were spent on this check.", "浏览器工具不可用。检查 Chrome / BSK 后继续投递；这次检查没有占用岗位名额。")}
      <span className="sr-only">{data.preflightError.message} · {new Date(data.preflightError.at).toLocaleString(locale)}</span>
    </p>}
    {data && <>
      {report && <section id="application-report" aria-label={text("Daily application report", "每日投递简报")} className="scroll-mt-24">
        <div className={styles.summary}>
          <div className={styles.confirmed}><strong>{report.confirmed}</strong><span>{text("receipt-confirmed today", "今日回执确认")}</span></div>
          <div className={styles.metrics}>
            <span><strong>{report.attempted}</strong> {text("attempted", "已尝试")}</span>
            <span>{data.settings.dailyLimit > 0 ? text(`Auto-run · up to ${data.settings.dailyLimit} roles per batch`, `自动运行 · 每轮最多 ${data.settings.dailyLimit} 个岗位`) : text("Auto-run paused · enable for 5 per batch", "自动运行暂停 · 开启后每轮最多 5 个岗位")}</span>
          </div>
        </div>
      </section>}
      {data.dailyCheck && <p role="status" className={styles.quiet}>
        {text(`Daily pipeline check · ${data.dailyCheck.day}: ${data.dailyCheck.discovered} discovered, ${data.dailyCheck.unscored} not scored (${data.dailyCheck.pendingScoring} in scoring queue), ${data.dailyCheck.eligible} eligible now; ${data.dailyCheck.attempted} attempts, ${data.dailyCheck.confirmed} receipts; ${data.dailyCheck.unresolved} unresolved overall.`, `每日流程检查 · ${data.dailyCheck.day}：发现 ${data.dailyCheck.discovered}，未评分 ${data.dailyCheck.unscored}（待评分队列 ${data.dailyCheck.pendingScoring}），当前可投 ${data.dailyCheck.eligible}；尝试 ${data.dailyCheck.attempted}，回执 ${data.dailyCheck.confirmed}；累计结果不明 ${data.dailyCheck.unresolved}。`)}
        {data.dailyCheck.issues.length > 0 && <span className="block" style={{ color: "var(--danger)" }}>
          {text(`Needs attention: ${data.dailyCheck.issues.map(issue => issueLabels[issue]).join(", ")}. Failure records: ${data.dailyCheck.failures.map(f => `${failureLabel(f.reason)} (${f.count})`).join(", ") || "none"}.`, `需关注：${data.dailyCheck.issues.map(issue => issueLabels[issue]).join("、")}。失败记录：${data.dailyCheck.failures.map(f => `${failureLabel(f.reason)}（${f.count}）`).join("、") || "无"}。`)}
        </span>}
      </p>}
      {!data.settings.configured && <p role="status">{text("Approve a PDF resume and common answers with the assistant before enabling this workflow.", "请先与助手确认 PDF 简历及通用答案，再开启此流程。")}</p>}
      {data.settings.preferencesChanged && <p role="alert" style={{ color: "var(--warning)" }}>{text("Jobs preferences changed. Reconfirm common answers with the assistant before preparing more applications.", "Jobs 偏好已改变，请先与助手重新确认通用答案。")}</p>}
      {approvedRow && <p role="status" className={styles.quiet}>{approvedRow.company} — {approvedRow.title} · {approvedRow.pendingQuestionKeys.length
        ? text("Answer saved. Finish the remaining questions; automatic processing waits.", "答案已保存。请继续填写剩余问题；自动流程会等你答完。")
        : autoEnabled ? text("Answers saved. The next automatic run will recheck the form before any submission.", "答案已保存。下一轮自动运行会在提交前重新核查表单。")
          : text("Answers saved. Enable auto-apply to continue.", "答案已保存。开启自动投递后会继续处理。")}</p>}
      {needsInput.length > 0 && <details id="application-questions" open className={`${styles.task} scroll-mt-24`}>
        <summary className="min-h-11 cursor-pointer"><span className={styles.taskHeading}><strong>{needsInput.length}</strong> {text("applications need you", "个申请需要你")}</span></summary>
        <p className={styles.quiet}>{text("Answer only what isn't in your saved profile; we'll continue with the rest.", "只回答档案里没有的问题，其他岗位照常处理。")}</p>
        <ul className="flex min-w-0 flex-col gap-3">
          {needsInput.map((row) => {
            const questions = row.application.fields.filter((field) => row.pendingQuestionKeys.includes(field.key ?? ""));
            return <li key={row.id} className="min-w-0 pt-3">
              <p className={styles.quiet}>{row.company} — {row.title}</p>
              {questions.length ? <ul>
                {questions.map((field, index) => <li key={field.key ?? index} className={styles.question}>
                  <span>{field.label}{field.required ? " *" : ""}</span>
                  {field.key && <button type="button" className={`ui-action ${styles.secondary}`} onClick={() => answerQuestion(row.id, field.key!)}>{text("Answer", "填写答案")}</button>}
                </li>)}
              </ul> : <p className="mt-2 text-sm">{row.application.blockers[0]}</p>}
              {answerFocus?.jobId === row.id && <ApplicationAnswers rows={data.rows} running={data.running}
                autoSubmit={data.settings.autoSubmit} scheduleEnabled={autoEnabled} focus={answerFocus}
                onSaved={refresh} onApprovedField={approvedAnswer} onClose={() => setAnswerFocus(undefined)} />}
              {!questions.length && <button type="button" className={`ui-action ${styles.secondary}`} disabled={disabled} onClick={() => void action("focus", row.id)}>{text("Open in Chrome / sign in", "在 Chrome 中打开／登录")}</button>}
              {(["new", "shortlist"].includes(row.status) && !row.application.submission && !row.application.receipt) && <button type="button" className={`ui-action ${styles.secondary} mt-2 disabled:opacity-40`} data-hover="danger" disabled={disabled} onClick={() => {
                if (!window.confirm(text(`Drop ${row.company} — ${row.title}? This drops the whole job, not just one required question. It will not be automatically submitted; attempts and evidence remain.`, `放弃 ${row.company} — ${row.title}？这会放弃整个岗位，而非跳过某道必答题。此岗位不再自动投递；尝试记录和证据仍保留。`))) return;
                setAnswerFocus(undefined); void action("drop", row.id);
              }}>{text("Drop this job", "放弃此岗位")}</button>}
            </li>;
          })}
        </ul>
      </details>}
      {needsRecovery.length > 0 && <details id="application-follow-ups" open className={`${styles.task} scroll-mt-24`}>
        <summary className="min-h-11 cursor-pointer"><span className={styles.taskHeading}><strong>{needsRecovery.length}</strong> {text("applications need follow-up", "个申请待跟进")}</span></summary>
        <p className={styles.quiet}>{text("These remain here until resolved. An uncertain Submit is not a failed application or permission to reapply.", "这些申请会保留在此处，直到结果有证据可核实。结果不明不等于投递失败，也不能直接重投。")}</p>
        <ul className="mt-2 flex flex-col gap-3">{needsRecovery.map((row) => <li key={row.id} className="min-w-0 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <strong className="break-words">{row.company} — {row.title} · {labels[row.application.stage]}</strong>
          <small className="block" style={{ color: "var(--text-muted)" }}>{new Date(row.application.updatedAt).toLocaleString(locale)}</small>
          <p className="mt-1">{recovery(row)}</p>
          <ul className="mt-1 list-disc break-words pl-5" style={{ color: "var(--text-muted)" }}>{row.application.blockers.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
          <div className="mt-2 flex flex-wrap gap-2">
            {row.application.stage === "uncertain" && <>
              <button type="button" className={`${actionClass} min-h-11`} disabled={disabled} onClick={() => void action("receipt", row.id)}>{text("Check receipt", "检查回执")}</button>
              <a className={`${actionClass} min-h-11 inline-flex items-center`} target="_blank" rel="noopener noreferrer" href={`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`${row.company} application`)}`}>{text("Search confirmation mail", "搜索确认邮件")}</a>
            </>}
            {canContinue(row) && <button type="button" className={`${actionClass} min-h-11`} disabled={disabled} onClick={() => rerun(row)}>{text("Rerun after fixing", "修复后重跑")}</button>}
            {/^https?:\/\//i.test(row.application.url) && <a href={row.application.url} target="_blank" rel="noopener noreferrer" className={`${actionClass} min-h-11 inline-flex items-center`}>{text("Open application page", "打开申请网页")}</a>}
          </div>
        </li>)}</ul>
      </details>}
      <details ref={historyRef} data-application-history className={styles.disclosure}>
        <summary>{text("Application history", "投递记录")}{` · ${data.total}`}</summary>
        {report && <p className={styles.quiet}>{text(`${report.day} · ${report.attempted} attempted · ${report.confirmed} receipt-confirmed. Attempts are not submissions.`, `${report.day} · 尝试 ${report.attempted} · 回执确认 ${report.confirmed}；尝试不等于成功。`)}</p>}
        {todayReportRows.length > 0 && <details className="text-sm"><summary className="min-h-11 cursor-pointer py-2">{text("Today's roles", "今日岗位")} · {todayReportRows.length}</summary><ul>{todayReportRows.map(reportItem)}</ul></details>}
        {pendingReportRows.length > 0 && <details className="text-sm"><summary className="min-h-11 cursor-pointer py-2">{text("Earlier unresolved", "此前未解决")} · {pendingReportRows.length}</summary><ul>{pendingReportRows.map(reportItem)}</ul></details>}
        {report && report.total > report.shown && <p className={styles.quiet}>{text("Showing the first 40 report entries.", "日报只展示前 40 条。")}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm" style={{ borderColor: "var(--border)" }}>
        <label className="flex min-w-0 flex-wrap items-center gap-1">{text("Show", "显示")}{" "}
          <select className="max-w-full min-w-0" value={filter} onChange={(event) => { setFilter(event.target.value); setExpanded(false); }}>
            <option value="all">{text("All", "全部")}</option>
            <option value="legacy">{text("Old workflow · needs rerun", "旧流程 · 待重跑")}</option>
            {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <details className="text-xs" style={{ color: "var(--text-muted)" }}>
        <summary className="min-h-11 cursor-pointer py-2">{text("All-time status counts", "历次状态统计")}</summary>
        <p>{Object.entries(labels).filter(([key]) => (data.counts[key] ?? 0) > 0).map(([key, label], index) => <span key={key}>
          {index > 0 && " · "}<span style={key === "error" ? { color: "var(--danger)" } : undefined}>{`${label} ${data.counts[key]}`}</span>
        </span>)}{Boolean(data.legacy) && ` · ${text("Old workflow", "旧流程")} ${data.legacy}`}</p>
      </details>
      {rows.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>{text("No workflow records yet. Only eligible, unsubmitted roles from Jobs are processed; duplicates and applied roles are excluded.", "暂无流程记录。只处理 Jobs 中符合筛选条件、尚未申请的职位；排除重复及已申请职位。")}</p>}
      {(expanded ? rows : rows.slice(0, collapsedRowCount)).map((row) => <details key={row.id} id={`job-application-${row.id}`} data-application-record className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
        <summary className="cursor-pointer text-sm">
          <strong>{row.company}</strong>{` — ${row.title} · `}<span style={row.application.stage === "error" ? { color: "var(--danger)" } : undefined}>
            {row.application.workflowVersion === APPLICATION_WORKFLOW_VERSION ? labels[row.application.stage] : text("Old workflow · needs rerun", "旧流程 · 待重跑")}
          </span>
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          {/^https?:\/\//i.test(row.application.url) && <a href={row.application.url} target="_blank" rel="noopener noreferrer"
            className={`${actionClass} self-start`} title={row.application.url}>
            {text("Open application page", "打开申请网页")}
          </a>}
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{new Date(row.application.updatedAt).toLocaleString(locale)} · {row.application.phase}</p>
          {row.application.autofill && <p className="text-sm">Jobright: {row.application.autofill.summary === "Employer form and resume stable after Jobright Autofill; completion report not observed"
            ? text("Employer form and resume stable after Autofill; Jobright completion report was not seen.", "自动填写后，雇主表单与简历附件已稳定回读；未看到 Jobright 完成报告。")
            : row.application.autofill.summary}</p>}
          {Boolean(row.application.rejections?.length) && <details className="text-xs" style={{ color: "var(--text-muted)" }}>
            <summary className="cursor-pointer">{text("Earlier form-validation failures", "此前的表单校验失败")}{` (${row.application.rejections!.length})`}</summary>
            <ul className="list-disc pl-4">{row.application.rejections!.map((rejection) => <li key={rejection.attemptId}>{rejection.text}</li>)}</ul>
          </details>}
          {row.application.blockers.length > 0 && <ul className="list-disc pl-5 text-sm" style={{ color: row.application.stage === "error" ? "var(--danger)" : "var(--warning)" }}>
            {row.application.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}
          </ul>}
          <p className="text-sm">{row.application.resumeVerified
            ? text("Resume attachment observed; submission success requires a receipt.", "已看到简历附件；提交成功以回执为准。")
            : row.application.fields.length > 0
              ? text("Form was read, but no resume attachment was observed; submission blocked.", "已读取表单，但未看到简历附件；不会提交。")
              : row.application.blockers.includes("APPLICATION_FORM_UNAVAILABLE")
                ? text("Employer form unavailable or unauditable; Jobright was not clicked and resume attachment was not checked.", "雇主表单未出现或无法核查；未点击 Jobright，简历附件也未核查。")
              : row.application.blockers.includes("JOBRIGHT_INCOMPLETE")
                ? text("Jobright Autofill completion was not observed; form and resume attachment were not checked.", "未能确认 Jobright Autofill 完成；表单与简历附件均未核查。")
                : text("Form and resume attachment were not checked.", "表单与简历附件均未核查。")}</p>
          {row.application.fields.length > 0 && <dl className="flex flex-col gap-2 text-sm">
            {row.application.fields.map((field, index) => <div key={index} className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
              <dt className="font-medium">{field.label}{field.required ? " *" : ""}</dt>
              <dd className="whitespace-pre-wrap break-words">{field.value || "—"}</dd>
              <dd className="text-xs" style={{ color: "var(--text-muted)" }}>{field.check === "matches-approved"
                ? text("Matches approved answer (page only)", "与已确认答案一致（仅页面）")
                : field.check === "empty" ? text("Not filled", "未填写") : text("Not validated — blocks submission", "未通过核验 — 不会提交")}</dd>
              {field.source && <dd className="text-xs" style={{ color: "var(--text-muted)" }}><details>
                <summary className="cursor-pointer">{text("Approved source", "批准资料中的依据")}</summary>
                <blockquote className="whitespace-pre-wrap break-words">{field.source}</blockquote>
              </details></dd>}
            </div>)}
          </dl>}
          {row.application.receipt && <blockquote className="border-l-2 pl-3 text-sm" style={{ borderColor: "var(--success)" }}>
            <p>{row.application.receipt.text}</p>
            <p>{new Date(row.application.receipt.at).toLocaleString(locale)}</p>
          </blockquote>}
          <button type="button" className={`${actionClass} self-start`} disabled={disabled} onClick={() => {
            if (window.confirm(`${row.company} — ${row.title}\n\n${text("Remove this record from the automation list? The job, daily attempt count and duplicate-submission protection will be kept. It will not be automatically queued again.", "从自动化列表移除这条记录？职位、今日尝试计数及防重复投递保护仍保留，不会自动重新排队。")}`)) void action("dismiss", row.id);
          }}>{text("Remove record", "移除记录")}</button>
          {row.application.stage !== "submitted" && <div className="flex flex-wrap gap-x-4 gap-y-2">
            <button type="button" className={actionClass} disabled={disabled} onClick={() => void action("focus", row.id)}>{text("Open draft in Chrome", "在 Chrome 打开草稿")}</button>
            <button type="button" className={actionClass} disabled={disabled || Boolean(row.application.submission)} onClick={() => void action("inspect", row.id)}>{text("Read back again", "重新回读校验")}</button>
            <button type="button" className={actionClass} disabled={disabled} onClick={() => void action("receipt", row.id)}>{text("Check submission receipt", "检查提交回执")}</button>
            <button type="button" className={actionClass} disabled={disabled || Boolean(row.application.submission) || !["new", "shortlist"].includes(row.status)} onClick={() => {
              rerun(row);
            }}>{text("Rerun workflow", "重跑自动流程")}</button>
          </div>}
        </div>
      </details>)}
      {rows.length > collapsedRowCount && <button type="button" className={`${actionClass} min-h-11 self-start`}
        aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        {expanded ? text("Collapse list", "收起列表") : text(`Show all ${rows.length} records`, `展开全部 ${rows.length} 条记录`)}
      </button>}
      {data.total > data.rows.length && <p className="text-xs">{text("All unresolved applications are above; older resolved records are limited to the latest 100.", "待处理申请均保留在上方；已解决的历史记录只显示最近 100 条。")}</p>}
      </details>
      <details id="application-personal-profile" ref={settingsRef} open={answersOpen ? true : undefined} className={styles.disclosure} style={{ borderColor: "var(--border)" }}>
        <summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-2" style={{ color: "var(--text-muted)" }}>
          {text("Settings & approved sources", "设置与授权资料")}
        </summary>
        <div className="flex flex-col gap-3 pb-2">
          {!answersOpen && <button type="button" className={`${actionClass} min-h-11 self-start`} onClick={() => setAnswersOpen(true)}>
            {text("Edit personal answers", "编辑个人答案")}
          </button>}
          {answersOpen && <ApplicationAnswers rows={data.rows} running={data.running}
            autoSubmit={data.settings.autoSubmit} scheduleEnabled={autoEnabled} focus={answerFocus}
            onSaved={refresh} onApprovedField={setApprovedJob} onClose={() => { setAnswersOpen(false); setAnswerFocus(undefined); settingsRef.current?.removeAttribute("open"); }} />}
          {data.settings.resumeName && <details className="text-sm">
            <summary className="min-h-11 cursor-pointer">{text("How it works · Answer reference", "工作方式 · 答案核对资料")}: {data.settings.resumeName}</summary>
            <p className="mt-2" style={{ color: "var(--text-muted)" }}>{text("Ashby / Greenhouse. Mac, Chrome, Jobright login and Robin must be available. Jobright fills and supplies the resume; we never replace it. The approved PDF and confirmed facts are used only to audit answers. Technical failures are separate from questions only you can answer. An ambiguous submission is locked against automatic retry. Attempts are not successful applications. Automatic runs process up to the configured batch size, then continue on later checks. Attempts are counted; only receipts confirm success.", "支持 Ashby / Greenhouse。需要 Mac、Chrome、已登录的 Jobright 和 Robin 可用。Jobright 负责填写及提供简历，我们不替换文件。批准的 PDF 和已确认事实仅用于核对表单答案。技术失败与真正需要你确认的问题分开；提交结果不明时锁定重试。尝试不等于成功申请。自动流程每轮最多处理配置的岗位数，后续检查会继续；每次尝试都计数，成功只看回执。")}</p>
            <p className="mt-2 break-all font-mono text-xs">SHA-256: {data.settings.resumeHash}</p>
          </details>}
        </div>
      </details>
    </>}
  </section>;
}
