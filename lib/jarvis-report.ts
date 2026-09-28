import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { JARVIS_NEWS_BURDEN_KEYS, JARVIS_NEWS_BURDEN_MAX, JARVIS_TARGET_PERSONAS, isJarvisFollowUpDue, isQualifiedInfoExec, jarvisTier, newsBurdenTotal, isSendableCore, jarvisComposeLinks, jarvisListPriority, type JarvisLead, type JarvisState } from "../extension/robin/jarvis-shape.ts";

const COHORTS: Record<string, string> = {
  info_exec: "Target persona", clinic: "Clinic / healthcare", professional_services: "Professional services", nontech_exec: "Non-tech executive", small_tech: "Small tech",
  founder: "Adjacent · founder", investor: "Adjacent · investor", product: "Adjacent · product", research: "Adjacent · research",
};
const PERSONAS: Record<string, string> = {
  vc: "VC / angel / family office", client_advisor: "Client advisor / BD", startup_leader: "Startup founder / leader",
  nontech_tech_leader: "Non-tech company tech & strategy leader", researcher: "Researcher",
};
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const link = (href: string, label: string) => href ? `<a href="${escape(href)}" target="_blank" rel="noreferrer">${escape(label)}</a>` : "";

function row(lead: JarvisLead, index: number, at: number): string {
  const compose = jarvisComposeLinks(lead);
  const emailCell = lead.email
    ? `<a href="mailto:${escape(lead.email)}">${escape(lead.email)}</a><small class="${lead.emailCheck}">${lead.emailCheck === "source_found" ? "seen on source page" : "unconfirmed"}</small>${link(lead.emailSource, "source ↗")}`
    : `<small class="missing">no public work email</small>`;
  const draft = compose
    ? `${link(compose.gmail, "Gmail")} · <a href="${escape(compose.mailto)}">Mail app</a>`
    : lead.email ? `<small>approve in Robin first</small>` : "";
  const queued = Boolean(lead.queuedAt) && !lead.sendAttempt;
  const burden = lead.newsBurden ? `<details class="burden"><summary>news burden ${newsBurdenTotal(lead)}/${JARVIS_NEWS_BURDEN_MAX}</summary><ul>${JARVIS_NEWS_BURDEN_KEYS.map((key) => `<li><b>${key} ${lead.newsBurden![key].score}/3</b> ${escape(lead.newsBurden![key].evidence)}</li>`).join("")}</ul></details>` : "";
  return `<tr data-cohort="${lead.audienceFit}" data-sendable="${isSendableCore(lead)}" data-target="${isQualifiedInfoExec(lead)}" data-tier="${jarvisTier(lead) ?? ""}" data-persona="${lead.persona ?? ""}" data-burden="${newsBurdenTotal(lead)}" data-search="${escape(`${lead.name} ${lead.company} ${lead.role} ${lead.industry} ${lead.email} ${lead.personLocation ?? ""} ${lead.companyLocation ?? ""} ${lead.timeZone ?? ""}`.toLowerCase())}">
<td>${index + 1}</td>
<td><strong>${escape(lead.name)}</strong>${link(lead.profileUrl, "profile ↗")}<small>Work: ${escape(lead.personLocation || "unknown")}${link(lead.personLocationSource ?? "", "source ↗")}</small><small>Time zone: ${escape(lead.timeZone || "unknown")}</small></td>
<td>${escape(lead.company)}<small>${escape(lead.role)}</small><small>Company: ${escape(lead.companyLocation || "unknown")}${link(lead.companyLocationSource ?? "", "source ↗")}</small></td>
<td>${jarvisTier(lead) ? `<span class="tier">${jarvisTier(lead)}</span> ` : ""}${escape(COHORTS[lead.segment] ?? lead.segment)}<small>${escape(lead.industry)}</small>${lead.persona ? `<span class="persona">${escape(PERSONAS[lead.persona] ?? lead.persona)}</span>` : ""}${burden}</td>
<td>${emailCell}</td>
<td class="evidence">${lead.watchList ? `<small class="via"><b>Watch list:</b> ${escape(lead.watchList)}</small>` : ""}${lead.foundVia ? `<small class="via">Found via ${link(lead.foundVia.url, lead.foundVia.source)}</small>` : ""}<q>${escape(lead.evidence)}</q>${link(lead.evidenceUrl, "evidence ↗")}</td>
<td>${queued ? '<span class="status queued">queued</span>' : `<span class="status ${lead.status}">${escape(lead.status.replace(/_/g, " "))}</span>`}${lead.sentAt ? `<small>sent ${lead.sentAt.slice(0, 10)}</small>` : ""}${lead.reviewed ? "<small>reviewed</small>" : ""}${isJarvisFollowUpDue(lead, at) ? '<small class="follow-up-due">follow-up due · 7+ days without recorded reply</small>' : ""}${lead.followedUpAt ? `<small>followed up ${escape(lead.followedUpAt.slice(0, 10))}</small>` : ""}</td>
<td><details><summary>${escape(lead.subject)}</summary><pre>${escape(lead.body)}</pre></details>
<div class="copy">${lead.email ? `<button type="button" data-copy="${escape(lead.email)}">Copy email</button>` : ""}<button type="button" data-copy="${escape(lead.subject)}">Copy subject</button><button type="button" data-copy="${escape(lead.body)}">Copy body</button></div>${draft}</td>
</tr>`;
}

/** A self-contained snapshot of the campaign. Compose links follow the same review gate as the page. */
export function renderJarvisReport(state: JarvisState, generatedAt = new Date()): string {
  const leads = [...state.leads].sort((a, b) => jarvisListPriority(a) - jarvisListPriority(b) || newsBurdenTotal(b) - newsBurdenTotal(a) || a.name.localeCompare(b.name));
  const core = leads.filter((lead) => lead.audienceFit === "core");
  const stats: Array<[number, string]> = [
    [leads.filter((lead) => jarvisTier(lead) === "A").length, "A · strict target users"],
    [leads.filter((lead) => jarvisTier(lead) === "B").length, "B · wide-net executives"],
    [leads.filter((lead) => isQualifiedInfoExec(lead) && lead.emailCheck === "source_found").length, "target users with a confirmed email"],
    [leads.filter((lead) => lead.queuedAt && !lead.sendAttempt).length, "queued"],
    [core.length, "core candidates"],
    [leads.filter((lead) => lead.email).length, "work emails (all)"],
    [leads.filter((lead) => lead.sentAt).length, "sent"],
    [leads.filter((lead) => lead.repliedAt).length, "replied"],
    [leads.filter((lead) => isJarvisFollowUpDue(lead, generatedAt.getTime())).length, "follow-ups due"],
  ];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jarvis Outreach List</title>
<style>
:root{--bg:#faf9f6;--panel:#fff;--text:#1f1d1a;--muted:#6b665e;--border:#e4e0d8;--accent:#8a5a14;--ok:#2f6b3a;--warn:#9a6a00;--bad:#9b2c2c}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--panel:#1e1d1a;--text:#ece8e1;--muted:#a19b91;--border:#34312c;--accent:#e0a94f;--ok:#7fc28b;--warn:#e0b74f;--bad:#ef8a8a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1400px;margin:0 auto;padding:24px 16px 48px}h1{margin:0 0 4px;font-size:24px}p.meta{color:var(--muted);margin:0 0 20px}
.stats{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px}.stats div{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:10px 14px;min-width:130px}
.stats strong{display:block;font-size:22px;font-variant-numeric:tabular-nums}.stats span{color:var(--muted);font-size:12px}
.controls{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:12px}input,select{font:inherit;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--panel);color:var(--text)}
.wrap{overflow-x:auto;border:1px solid var(--border);border-radius:8px;background:var(--panel)}
table{border-collapse:collapse;width:100%;min-width:1100px}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid var(--border)}
th{position:sticky;top:0;background:var(--panel);font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
td small,td a{display:block;font-size:12px}td small{color:var(--muted)}a{color:var(--accent)}td.evidence{max-width:280px}q{color:var(--muted)}
small.source_found{color:var(--ok)}small.unconfirmed,small.follow-up-due{color:var(--warn)}small.missing{color:var(--bad)}
.status{font-size:12px;font-weight:600;text-transform:capitalize}.status.replied,.status.interested{color:var(--ok)}.status.declined,.status.bounced,.status.do_not_contact{color:var(--bad)}
.copy{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}button{font:inherit;font-size:12px;padding:3px 8px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);cursor:pointer}button:hover{border-color:var(--accent)}
.persona{display:inline-block;margin-top:4px;padding:1px 6px;border:1px solid var(--accent);border-radius:4px;font-size:11px;color:var(--accent)}
.burden summary{margin-top:4px;color:var(--ok)}.burden ul{margin:4px 0 0;padding-left:16px;font-size:12px;color:var(--muted);max-width:280px}.burden b{color:var(--text);font-weight:600}
small.via{margin-bottom:4px}.tier{display:inline-block;min-width:18px;text-align:center;border:1px solid var(--accent);border-radius:3px;font-size:11px;font-weight:700;color:var(--accent)}.status.queued{color:var(--accent)}
pre{white-space:pre-wrap;font:12px/1.5 inherit;max-width:420px;margin:8px 0}summary{cursor:pointer;font-size:12px}
</style></head><body><main>
<h1>Jarvis.day · target users &amp; outreach</h1>
<p class="meta">Generated ${escape(generatedAt.toISOString().replace("T", " ").slice(0, 16))} UTC. “Seen on source page” means the address appeared on the cited public page; it does not verify deliverability. Nothing here sends mail. A-tier target users are executives at organizations of about 500 or fewer, in a fast-moving field, with a named watch list, who fit one of Jarvis's four personas with a news burden of at least 9/12 and no zero dimension; open a score to read the cited reason for each dimension. B-tier executives are the wide net: any other current executive outside associations with a news burden of at least 6/12 in a field that is not static.</p>
<section class="stats">${stats.map(([n, label]) => `<div><strong>${n}</strong><span>${label}</span></div>`).join("")}</section>
<div class="controls"><input type="search" id="q" placeholder="Filter name, company, email…" aria-label="Filter">
<select id="view" aria-label="Show"><option value="tiered">Executives · A + B</option><option value="target">A-tier target users</option><option value="sendable">Sendable core</option><option value="core">All core</option><option value="all">Everyone</option></select>
<select id="persona" aria-label="Persona"><option value="">All personas</option>${JARVIS_TARGET_PERSONAS.map((p) => `<option value="${p}">${escape(PERSONAS[p]!)}</option>`).join("")}</select><span id="count"></span><button type="button" id="export">Export HTML</button></div>
<div class="wrap"><table><thead><tr><th>#</th><th>Name</th><th>Company · role</th><th>Persona · score · industry</th><th>Work email</th><th>Why this person</th><th>Status</th><th>Draft</th></tr></thead>
<tbody>${leads.map((lead, index) => row(lead, index, generatedAt.getTime())).join("\n")}</tbody></table></div>
</main><script>
const q=document.getElementById("q"),v=document.getElementById("view"),pe=document.getElementById("persona"),rows=[...document.querySelectorAll("tbody tr")],c=document.getElementById("count");
function inView(r){return v.value==="all"||(v.value==="tiered"?r.dataset.tier!=="":v.value==="target"?r.dataset.target==="true":v.value==="core"?r.dataset.cohort==="core":r.dataset.sendable==="true")}
function apply(){const t=q.value.toLowerCase();let n=0;for(const r of rows){const ok=r.dataset.search.includes(t)&&inView(r)&&(!pe.value||r.dataset.persona===pe.value);r.hidden=!ok;if(ok)n++}c.textContent=n+" shown"}
q.addEventListener("input",apply);v.addEventListener("change",apply);pe.addEventListener("change",apply);apply();
async function copyText(b){const t=b.dataset.copy;try{await navigator.clipboard.writeText(t)}catch{const a=document.createElement("textarea");a.value=t;document.body.appendChild(a);a.select();document.execCommand("copy");a.remove()}const l=b.textContent;b.textContent="Copied";setTimeout(()=>b.textContent=l,1500)}
document.addEventListener("click",e=>{const b=e.target.closest("button[data-copy]");if(b)copyText(b)});
// Saves this page as a standalone file; it keeps working offline because everything is inline.
document.getElementById("export").addEventListener("click",()=>{const html="<!doctype html>\\n"+document.documentElement.outerHTML;const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([html],{type:"text/html"}));a.download="jarvis-outreach-"+new Date().toISOString().slice(0,10)+".html";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
</script></body></html>`;
}

/** The copy kept in the Jarvis.day repo; JARVIS_DAY_OUTREACH_FILE overrides it. */
export function jarvisDayReportPath(): string {
  return process.env.JARVIS_DAY_OUTREACH_FILE || join(homedir(), "Jarvis_Day", "outreach", "candidates.html");
}

/** Writes the same HTML the page serves into the Jarvis.day repo, so the two never drift. */
export function writeJarvisDayReport(state: JarvisState, path: string = jarvisDayReportPath()): { path: string; contacts: number } {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderJarvisReport(state));
  return { path, contacts: state.leads.length };
}
