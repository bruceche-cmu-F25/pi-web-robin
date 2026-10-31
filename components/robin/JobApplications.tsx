"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { applicationBoard } from "@/extension/robin/job-application-domain";
import { APPLICATION_WORKFLOW_VERSION } from "@/extension/robin/job-applications";
import { mutate, usePolledResource } from "./usePolledResource";

type Board = ReturnType<typeof applicationBoard>;
const endpoint = "/api/robin/jobs/applications";
const actionClass = "ui-action pi-bracket font-mono text-xs disabled:opacity-40";
const collapsedRowCount = 5;

/** The review is evidence, not a second editable copy of the employer's form. */
export function JobApplications() {
  const { locale } = useI18n();
  const text = (en: string, zh: string) => locale.startsWith("zh") ? zh : en;
  const { data, error, loading, refresh } = usePolledResource<Board>(endpoint, (data) => data?.running ? 5000 : 60_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const labels = {
    preparing: text("Autofill / checking", "填充／校验中"), review: text("Validated, not submitted", "校验通过，未提交"),
    attention: text("Needs your answer", "需要你确认"), error: text("Automation error", "技术失败"),
    unavailable: text("Posting unavailable", "职位不可访问"),
    blocked: text("Sources changed", "资料有变"), submitting: text("Submitting", "提交中"),
    uncertain: text("Receipt uncertain — no retry", "结果不明，禁止重投"), submitted: text("Submitted · receipt confirmed", "已提交 · 回执确认"),
  };
  const action = async (kind: string, id?: string) => {
    setBusy(`${id ?? "batch"}:${kind}`); setActionError(null);
    try { await mutate(endpoint, "POST", { action: kind, id }); await refresh(); }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(null); }
  };
  const toggle = async () => {
    setBusy("schedule"); setActionError(null);
    try { await mutate(endpoint, "PATCH", { enabled: !data?.settings.enabled }); await refresh(); }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(null); }
  };
  const disabled = Boolean(busy || data?.running);
  const rows = data?.rows.filter((row) => filter === "all" || (filter === "legacy"
    ? row.application.workflowVersion !== APPLICATION_WORKFLOW_VERSION
    : row.application.workflowVersion === APPLICATION_WORKFLOW_VERSION && row.application.stage === filter)) ?? [];

  return <section className="pi-card flex flex-col gap-3 p-4" aria-labelledby="applications-heading">
    <header className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="applications-heading" className="pi-label">{text("Application automation", "申请自动化")}</h2>
      <div className="flex flex-wrap gap-3">
        <button type="button" className={actionClass} disabled={disabled || !data?.settings.configured}
          onClick={() => void action("prepare")}>{data?.running ? text("Working…", "处理中…") : text("Run today's applications", "执行今日申请")}</button>
        <button type="button" className={actionClass} aria-pressed={data?.settings.enabled ?? false}
          disabled={Boolean(busy) || !data?.settings.configured} onClick={() => void toggle()}>
          {data?.settings.enabled ? text("Pause daily", "暂停每日运行") : text("Enable daily", "开启每日运行")}
        </button>
      </div>
    </header>
    {(error || actionError) && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{actionError || error}</p>}
    {loading && !data && <p role="status">{text("Loading application reviews…", "加载申请审核记录…")}</p>}
    {data && <>
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {data.settings.enabled ? text("Daily workflow on", "每日流程已开启") : text("Daily workflow paused", "每日流程已暂停")}
        {` · ${data.settings.at} ${data.settings.timeZone} · ${data.day}`}
        <br />{text("Roles attempted today", "今日尝试职位")}{` ${data.today}/${data.settings.dailyLimit} · `}{text("Receipt-confirmed submissions", "回执确认提交")}{` ${data.todaySubmitted ?? 0}`}
      </p>
      <p className="text-sm">
        {text("Jobright Autofill → evidence-based checks and repairs → ", "Jobright Autofill → 核对资料、修正补漏 → ")}
        {data.settings.autoSubmit ? text("submit only when validation passes → verify receipt.", "校验通过后自动提交 → 核验回执。") : text("submission authorization is off.", "自动提交尚未授权。")}
      </p>
      {!data.settings.configured && <p role="status">{text("Approve a PDF resume and common answers with the assistant before enabling this workflow.", "请先与助手确认 PDF 简历及通用答案，再开启此流程。")}</p>}
      {data.settings.preferencesChanged && <p role="alert" style={{ color: "var(--warning)" }}>{text("Jobs preferences changed. Reconfirm common answers with the assistant before preparing more applications.", "Jobs 偏好已改变，请先与助手重新确认通用答案。")}</p>}
      {data.settings.resumeName && <details className="text-sm">
        <summary className="cursor-pointer">{text("How it works · Answer reference", "工作方式 · 答案核对资料")}: {data.settings.resumeName}</summary>
        <p className="mt-2" style={{ color: "var(--text-muted)" }}>{text("Ashby / Greenhouse. Mac, Chrome, Jobright login and Robin must be available. Jobright fills and supplies the resume; we never replace it. The approved PDF and confirmed facts are used only to audit answers. Technical failures are separate from questions only you can answer. An ambiguous submission is locked against automatic retry. Attempts are a daily work limit, not successful applications.", "支持 Ashby / Greenhouse。需要 Mac、Chrome、已登录的 Jobright 和 Robin 可用。Jobright 负责填写及提供简历，我们不替换文件。批准的 PDF 和已确认事实仅用于核对表单答案。技术失败与真正需要你确认的问题分开；提交结果不明时锁定重试。每日尝试上限不代表成功申请数。")}</p>
        <p className="mt-2 break-all font-mono text-xs">SHA-256: {data.settings.resumeHash}</p>
      </details>}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex min-w-0 flex-wrap items-center gap-1">{text("Show", "显示")}{" "}
          <select className="max-w-full min-w-0" value={filter} onChange={(event) => { setFilter(event.target.value); setExpanded(false); }}>
            <option value="all">{text("All", "全部")}</option>
            <option value="legacy">{text("Old workflow · needs rerun", "旧流程 · 待重跑")}</option>
            {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <span role="status" style={{ color: "var(--text-muted)" }}>
          {Object.entries(labels).filter(([key]) => (data.counts[key] ?? 0) > 0).map(([key, label], index) => <span key={key}>
            {index > 0 && " · "}<span style={key === "error" ? { color: "var(--danger)" } : undefined}>{`${label} ${data.counts[key]}`}</span>
          </span>)}
          {Boolean(data.legacy) && ` · ${text("Old workflow", "旧流程")} ${data.legacy}`}
        </span>
      </div>
      {rows.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>{text("No workflow records yet. Only eligible, unsubmitted roles from Jobs are processed; duplicates and applied roles are excluded.", "暂无流程记录。只处理 Jobs 中符合筛选条件、尚未申请的职位；排除重复及已申请职位。")}</p>}
      {(expanded ? rows : rows.slice(0, collapsedRowCount)).map((row) => <details key={row.id} className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
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
          {row.application.autofill && <p className="text-sm">Jobright: {row.application.autofill.summary}</p>}
          {Boolean(row.application.rejections?.length) && <details className="text-xs" style={{ color: "var(--text-muted)" }}>
            <summary className="cursor-pointer">{text("Earlier form-validation failures", "此前的表单校验失败")}{` (${row.application.rejections!.length})`}</summary>
            <ul className="list-disc pl-4">{row.application.rejections!.map((rejection) => <li key={rejection.attemptId}>{rejection.text}</li>)}</ul>
          </details>}
          {row.application.blockers.length > 0 && <ul className="list-disc pl-5 text-sm" style={{ color: row.application.stage === "error" ? "var(--danger)" : "var(--warning)" }}>
            {row.application.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}
          </ul>}
          <p className="text-sm">{row.application.resumeVerified
            ? text("Resume attachment observed; submission success requires a receipt.", "已看到简历附件；提交成功以回执为准。")
            : text("No resume attachment observed on the application page.", "尚未在申请页看到简历附件。")}</p>
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
              if (window.confirm(text("Rerun Jobright, audit and repair this application? If checked submission is authorized, it will submit after validation. Save manual answers before reloading.", "重新运行 Jobright、检查并补漏？已授权自动提交时，校验通过后会提交。重载前请先保存手填答案。"))) void action("prepare", row.id);
            }}>{text("Rerun workflow", "重跑自动流程")}</button>
          </div>}
        </div>
      </details>)}
      {rows.length > collapsedRowCount && <button type="button" className={`${actionClass} min-h-11 self-start`}
        aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        {expanded ? text("Collapse list", "收起列表") : text(`Show all ${rows.length} records`, `展开全部 ${rows.length} 条记录`)}
      </button>}
      {data.total > data.rows.length && <p className="text-xs">{text("Showing the latest 100 records.", "显示最近 100 条记录。")}</p>}
    </>}
  </section>;
}
