"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { isRoleSpecificApplicationQuestion, type StandingAnswerKey, type StandingAnswers } from "@/extension/robin/job-applications";
import type { applicationBoard } from "@/extension/robin/job-application-domain";
import { mutateResponse, usePolledResource } from "./usePolledResource";

type Board = ReturnType<typeof applicationBoard>;
type Editor = { confirmedFacts: string; standing: StandingAnswers; answers: Record<string, string>; revision: string };
const endpoint = "/api/robin/jobs/applications/answers";
const inputStyle = { background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" };
const inputClass = "min-h-11 min-w-0 max-w-full w-full rounded-xl px-3 py-2 text-base";
const buttonClass = "ui-action pi-bracket min-h-11 text-sm disabled:opacity-40";
const reusableAnswers = (answers: Record<string, string>) => Object.fromEntries(Object.entries(answers)
  .filter(([label]) => !label.startsWith("[job:") && !isRoleSpecificApplicationQuestion(label)));
const standingFields: { key: StandingAnswerKey; en: string; zh: string; yesNo?: boolean }[] = [
  { key: "pronouns", en: "Pronouns", zh: "代词" },
  { key: "raceEthnicity", en: "Race / ethnicity", zh: "族裔／种族" },
  { key: "hispanicLatino", en: "Hispanic / Latino identity", zh: "是否为拉丁裔" },
  { key: "gender", en: "Gender identity", zh: "性别认同" },
  { key: "sponsorshipNow", en: "Require employer visa sponsorship now?", zh: "现在是否需要雇主签证担保？", yesNo: true },
  { key: "sponsorshipFuture", en: "Require employer visa sponsorship in the future?", zh: "将来是否需要雇主签证担保？", yesNo: true },
  { key: "usWorkAuthorization", en: "Authorized to work in the US?", zh: "是否有美国工作许可？", yesNo: true },
  { key: "usCitizenship", en: "US citizenship (if you choose to disclose)", zh: "美国公民身份（如选择披露）" },
  { key: "veteran", en: "Veteran status (optional)", zh: "退伍军人身份（可选）" },
  { key: "disability", en: "Disability status (optional)", zh: "残障状态（可选）" },
  { key: "sexualOrientation", en: "Sexual orientation (optional)", zh: "性取向（可选）" },
];

/** One standing personal profile across jobs; exceptional employer declarations stay question-scoped. */
export function ApplicationAnswers({ rows, running, autoSubmit, scheduleEnabled, focus, onSaved, onApprovedField, onClose }: {
  rows: Board["rows"]; running: boolean; autoSubmit: boolean; scheduleEnabled: boolean;
  focus?: { jobId: string; fieldKey: string };
  onSaved: () => Promise<void>; onApprovedField?: (id: string) => void; onClose: () => void;
}) {
  const { locale } = useI18n();
  const text = (en: string, zh: string) => locale.startsWith("zh") ? zh : en;
  const { data, loading, error, updateData } = usePolledResource<Editor>(endpoint, 60_000);
  const [revision, setRevision] = useState<string | null>(null);
  const [facts, setFacts] = useState("");
  const [standing, setStanding] = useState<StandingAnswers>({});
  const [general, setGeneral] = useState<Record<string, string>>({});
  const [newQuestion, setNewQuestion] = useState("");
  const [newAnswer, setNewAnswer] = useState("");
  const [jobId, setJobId] = useState("");
  const [fieldKey, setFieldKey] = useState("");
  const [answer, setAnswer] = useState("");
  const [reuse, setReuse] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (data && revision === null) {
      setRevision(data.revision); setFacts(data.confirmedFacts); setStanding(data.standing); setGeneral(reusableAnswers(data.answers));
    }
  }, [data, revision]);
  useEffect(() => {
    if (!data || !focus) return;
    const question = rows.find((row) => row.id === focus.jobId)?.application.fields.find((field) => field.key === focus.fieldKey);
    if (!question) return;
    setJobId(focus.jobId); setFieldKey(focus.fieldKey); setReuse(false); setNotice(null);
    setAnswer(data.answers[`[job:${focus.jobId}] ${question.label}`] ?? "");
    document.getElementById("application-specific-answers")?.scrollIntoView({ block: "nearest" });
  // A new focused question resets its answer; polling does not discard an in-progress edit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(data), focus?.jobId, focus?.fieldKey]);

  const available = rows.filter((row) => ["attention", "review", "error", "blocked"].includes(row.application.stage)
    && !row.application.submission && row.application.fields.some((field) => field.kind !== "file"));
  const selected = available.find((row) => row.id === jobId);
  const fields = selected?.application.fields.filter((field) => field.kind !== "file") ?? [];
  const field = fields.find((entry) => entry.key === fieldKey);
  const savedAnswer = field ? data?.answers[`[job:${jobId}] ${field.label}`] : undefined;
  const needsWarning = autoSubmit;
  const disabled = saving || running || !data || (needsWarning && !acknowledged);
  const changed = revision !== null && (facts !== data?.confirmedFacts || JSON.stringify(standing) !== JSON.stringify(data?.standing)
    || JSON.stringify(general) !== JSON.stringify(reusableAnswers(data?.answers ?? {})));
  const stale = revision !== null && data?.revision !== revision;

  const save = async (body: object, message: string, profile = false, approvedId?: string) => {
    setSaving(true); setFailure(null); setNotice(null);
    try {
      const response = await mutateResponse(endpoint, "PATCH", body);
      const receipt = await response.json() as Editor;
      updateData(() => receipt);
      if (profile) { setRevision(receipt.revision); setFacts(receipt.confirmedFacts); setStanding(receipt.standing); setGeneral(reusableAnswers(receipt.answers)); }
      else if (!changed) setRevision(receipt.revision);
      setNotice(message);
      if (approvedId) onApprovedField?.(approvedId);
      void onSaved();
    } catch (caught) { setFailure(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSaving(false); }
  };
  const setStandingAnswer = (key: StandingAnswerKey, value: string) => {
    setStanding((current) => { const next = { ...current }; if (value) next[key] = value; else delete next[key]; return next; });
    setNotice(null);
  };
  const chooseField = (key: string, id: string = jobId) => {
    setFieldKey(key); setReuse(false); setFailure(null); setNotice(null);
    const question = available.find((entry) => entry.id === id)?.application.fields.find((entry) => entry.key === key);
    setAnswer(question ? data?.answers[`[job:${id}] ${question.label}`] ?? "" : "");
  };

  return <div className="flex min-w-0 flex-col gap-4 rounded-xl border p-4 text-sm" style={{ borderColor: "var(--border)" }}>
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="font-medium">{focus && field ? field.label : focus ? text("Your answer", "请回答这道题") : text("Reusable personal answers", "通用个人申请答案")}</h3>
      <button type="button" className={buttonClass} disabled={saving} onClick={() => {
        if ((changed || (focus && !notice && Boolean(field) && answer !== (savedAnswer ?? "")))
          && !window.confirm(text("Discard unsaved changes?", "放弃未保存的修改？"))) return;
        onClose();
      }}>{text("Close", "关闭")}</button>
    </div>
    {!focus && <p style={{ color: "var(--text-muted)" }}>
      {text("Fill this out once. Robin reuses these approved personal facts on later applications when a form question clearly matches. Leave anything you do not want to answer blank; no fact is inferred from another.",
        "在这里填一次。之后遇到含义明确匹配的表单问题，Robin 会复用你授权的个人事实。不想回答的留空；不会从其他答案推断。")}
    </p>}
    {loading && !data && <p role="status">{text("Loading answers…", "正在读取答案…")}</p>}
    {(error || failure) && <p role="alert" style={{ color: "var(--danger)" }}>{failure || error}</p>}
    {notice && <p role="status" style={{ color: "var(--success)" }}>{notice}</p>}
    {data && <>
      {needsWarning && <label className="flex min-h-11 items-start gap-3 rounded-xl border p-3" style={{ borderColor: "var(--warning)" }}>
        <input type="checkbox" className="mt-1" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
        <span>{focus ? text("I understand: this answer may be used on a later checked application. Saving does not submit now.", "我知道：此答案可用于后续校验通过的自动投递；保存不会立即提交。")
          : text(`I understand: checked submission is authorized; the daily schedule is ${scheduleEnabled ? "on" : "paused"}. These answers may be used on a later automatic run; saving does not start an application now.`,
            `我知道：校验后自动提交已获授权，每日运行目前${scheduleEnabled ? "开启" : "暂停"}。这些答案可能用于下一轮自动投递；保存本身不会立即开始投递。`)}</span>
      </label>}
      {!focus && <form className="flex min-w-0 flex-col gap-3" onSubmit={(event) => {
        event.preventDefault();
        if (revision && changed && !stale) void save({ kind: "profile", confirmedFacts: facts, standing, generalAnswers: general, expectedRevision: revision }, text("Personal answers saved for future applications", "个人答案已保存，供以后申请复用"), true);
      }}>
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>
          {text("Use the exact wording of an employer option where possible. Sponsorship, work authorization and citizenship are separate facts. ‘No sponsorship’ does not establish either of the others.",
            "尽量填写雇主表单选项的原文。签证担保、工作许可和公民身份是不同的事实；‘不需要担保’不能证明另外两项。")}
        </p>
        {standingFields.map(({ key, en, zh, yesNo }) => <div key={key} className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`application-standing-${key}`} className="font-medium">{text(en, zh)}</label>
          {yesNo ? <select id={`application-standing-${key}`} className={inputClass} style={inputStyle}
            value={standing[key] ?? ""} onChange={(event) => setStandingAnswer(key, event.target.value)}>
            <option value="">{text("Not provided", "未提供")}</option><option value="Yes">{text("Yes", "是")}</option><option value="No">{text("No", "否")}</option>
          </select> : <input id={`application-standing-${key}`} type="text" className={inputClass} style={inputStyle}
            value={standing[key] ?? ""} maxLength={1000} autoComplete="off"
            onChange={(event) => setStandingAnswer(key, event.target.value)} />}
        </div>)}
        <label htmlFor="application-confirmed-facts" className="font-medium">{text("Other confirmed facts", "其他已确认事实")}</label>
        <textarea id="application-confirmed-facts" className={`${inputClass} min-h-28`} style={inputStyle} rows={4} maxLength={30000}
          autoComplete="off" value={facts} onChange={(event) => { setFacts(event.target.value); setNotice(null); }} />
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>
          {text("For experience, dates, locations and other facts not listed above. Do not put legal consent or sensitive answers here; use the dedicated fields above.",
            "可填写其他经历、日期、地点等事实。法律协议及敏感答案不要写在此处；敏感答案请填上方对应栏。")}
        </p>
        <div className="flex min-w-0 flex-col gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <h4 className="font-medium">{text("Other reusable form answers", "其他可复用的表单答案")}</h4>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>
            {text("Optional: add a recurring question and your exact answer. Salary choices and legal agreements are not reusable here. For different wordings of the personal categories above, use the dedicated fields instead.",
              "可选：添加常见表单问题及准确答案；薪资选择及法律协议不可在此通用授权。对上方个人事实的不同问法，请使用对应的专用栏。")}
          </p>
          {Object.entries(general).map(([label, value], index) => <div key={label} className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`application-general-${index}`}>{label}</label>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <input id={`application-general-${index}`} className={`${inputClass} flex-1`} style={inputStyle} value={value} maxLength={10000}
                onChange={(event) => { setGeneral({ ...general, [label]: event.target.value }); setNotice(null); }} />
              <button type="button" className={buttonClass} aria-label={text(`Remove ${label}`, `移除 ${label}`)}
                onClick={() => { const next = { ...general }; delete next[label]; setGeneral(next); setNotice(null); }}>{text("Remove", "移除")}</button>
            </div>
          </div>)}
          <label htmlFor="application-new-question">{text("Add a recurring question", "添加常见问题")}</label>
          <input id="application-new-question" className={inputClass} style={inputStyle} value={newQuestion} maxLength={1000}
            onChange={(event) => setNewQuestion(event.target.value)} />
          <label htmlFor="application-new-answer">{text("Answer", "答案")}</label>
          <input id="application-new-answer" className={inputClass} style={inputStyle} value={newAnswer} maxLength={10000}
            onChange={(event) => setNewAnswer(event.target.value)} />
          <button type="button" className={`${buttonClass} self-start`} disabled={!newQuestion.trim() || !newAnswer.trim() || isRoleSpecificApplicationQuestion(newQuestion) || newQuestion.startsWith("[job:")}
            onClick={() => { setGeneral({ ...general, [newQuestion.trim()]: newAnswer }); setNewQuestion(""); setNewAnswer(""); setNotice(null); }}>
            {text("Add to profile", "加入档案")}
          </button>
        </div>
        {stale && <p role="alert" style={{ color: "var(--warning)" }}>{text("Answers changed elsewhere. Copy your draft and reload before saving.", "答案已在别处修改；请先复制草稿，再刷新页面。")}</p>}
        <button type="submit" className={`${buttonClass} self-start`} disabled={disabled || !changed || stale}>
          {saving ? text("Saving…", "保存中…") : text("Save personal answers", "保存个人答案")}
        </button>
      </form>}
      <details id="application-specific-answers" open={Boolean(focus)} className={focus ? "min-w-0 scroll-mt-24" : "min-w-0 scroll-mt-24 border-t pt-4"} style={{ borderColor: "var(--border)" }}>
        <summary className={focus ? "hidden" : "min-h-11 cursor-pointer font-medium"}>{text("Answer a question from an application", "回答申请表中的问题")}</summary>
        {!focus && <p className="my-3 text-xs" style={{ color: "var(--text-muted)" }}>
          {text("Recurring personal facts are reusable. Pay preferences vary by role, and employer agreements or certifications vary by employer; approve only the exact question for that job.",
            "通用个人事实可复用；薪资期望因岗位而异，雇主协议及声明因雇主而异。只为该岗位的表单原题逐项授权。")}
        </p>}
        <form className="flex min-w-0 flex-col gap-2" onSubmit={(event) => {
          event.preventDefault();
          if (!field || !answer.trim()) return;
          if (reuse && !changed && !stale && revision && (!savedAnswer || savedAnswer === answer) && !isRoleSpecificApplicationQuestion(field.label)) {
            void save({ kind: "profile", confirmedFacts: facts, standing, generalAnswers: { ...general, [field.label]: answer }, expectedRevision: revision },
              text("Answer saved for this and future exact-match questions", "此答案已保存，供本岗位及以后原题匹配的申请复用"), true, jobId);
          } else if (!reuse) void save({ kind: "field", id: jobId, label: field.label, answer }, text("Question approved for this job only", "仅为该岗位此题授权成功"), false, jobId);
        }}>
          {!focus && <><label htmlFor="application-answer-job">{text("Application", "岗位")}</label>
          <select id="application-answer-job" className={inputClass} style={inputStyle} value={jobId} onChange={(event) => {
            setJobId(event.target.value); chooseField("", event.target.value);
          }}>
            <option value="">{text("Choose an application", "选择岗位")}</option>
            {available.map((row) => <option key={row.id} value={row.id}>{row.company} — {row.title}</option>)}
          </select>
          <label htmlFor="application-answer-question">{text("Exact employer question", "雇主表单原题")}</label>
          <select id="application-answer-question" className={inputClass} style={inputStyle} disabled={!selected} value={fieldKey}
            onChange={(event) => chooseField(event.target.value)}>
            <option value="">{text("Choose a question", "选择问题")}</option>
            {fields.map((question) => <option key={question.key} value={question.key}>{question.label}{question.required ? " *" : ""}</option>)}
          </select></>}
          {field && <>
            <label htmlFor="application-answer-value">{text("Approved answer (exact option when provided)", "授权的答案（有选项时须选原文）")}</label>
            {field.options?.length ? <select id="application-answer-value" className={inputClass} style={inputStyle} value={answer}
              onChange={(event) => { setAnswer(event.target.value); setNotice(null); }}>
              <option value="">{text("Choose an exact option", "选择表单原选项")}</option>
              {field.options.map((option, index) => <option key={`${index}-${option}`} value={option}>{option}</option>)}
            </select> : <input id="application-answer-value" type="text" className={inputClass} style={inputStyle} value={answer}
              autoComplete="off" maxLength={10000} onChange={(event) => { setAnswer(event.target.value); setNotice(null); }} />}
            {!isRoleSpecificApplicationQuestion(field.label) && <label className="flex items-center gap-2">
              <input type="checkbox" checked={reuse} onChange={(event) => setReuse(event.target.checked)} />
              {text("Reuse for future applications with this exact question", "以后遇到完全相同的问题也复用此答案")}
            </label>}
            {reuse && (changed || stale) && <p role="alert" style={{ color: "var(--warning)" }}>{text("Save your pending profile changes first, then approve this reusable answer.", "请先保存档案中的其他修改，再授权复用此答案。")}</p>}
            {reuse && savedAnswer && savedAnswer !== answer && <p role="alert" style={{ color: "var(--warning)" }}>{text("This job has a different saved answer. Remove its approval before reusing a new answer.", "此岗位已保存不同答案；请先撤销该岗位旧授权，再启用新答案复用。")}</p>}
            {!focus && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{text("Pay and legal agreements can only be approved for this job. Saving never submits immediately; the next automatic run checks remaining questions first.", "薪资与法律协议只能逐岗位授权。保存不会立即提交；下一轮自动运行会先检查还有没有未答问题。")}</p>}
            {savedAnswer !== undefined && <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {text("Previously approved:", "之前授权的答案：")} {savedAnswer}
            </p>}
            <div className="flex flex-wrap gap-3">
              <button type="submit" className={focus ? "ui-action ui-action--primary min-h-11 px-4 text-sm disabled:opacity-40" : buttonClass} disabled={disabled || !answer.trim() || (reuse && (changed || stale || Boolean(savedAnswer && savedAnswer !== answer)))}>{focus ? text("Save answer", "保存答案") : text("Approve this question", "授权此题")}</button>
              {savedAnswer !== undefined && <button type="button" className={buttonClass} disabled={disabled} onClick={() => {
                if (window.confirm(text("Remove this job-specific approval?", "撤销该岗位此题的授权？"))) void save({ kind: "field", id: jobId, label: field.label, answer: "" }, text("Approval removed", "授权已撤销"));
              }}>{text("Remove approval", "撤销授权")}</button>}
            </div>
          </>}
          {!available.length && <p style={{ color: "var(--text-muted)" }}>{text("No recorded form questions yet. The reusable personal answers above do not require a job to be present.", "暂无已读取的表单问题。填写上方通用个人答案不需要先有岗位。")}</p>}
        </form>
      </details>
    </>}
  </div>;
}
