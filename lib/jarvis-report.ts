import { isSendableCore, jarvisComposeLinks, type JarvisLead, type JarvisState } from "../extension/robin/jarvis-shape.ts";

const COHORTS: Record<string, string> = {
  clinic: "Clinic / healthcare", professional_services: "Professional services", nontech_exec: "Non-tech executive", small_tech: "Small tech",
  founder: "Adjacent · founder", investor: "Adjacent · investor", product: "Adjacent · product", research: "Adjacent · research",
};
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const link = (href: string, label: string) => href ? `<a href="${escape(href)}" target="_blank" rel="noreferrer">${escape(label)}</a>` : "";

function row(lead: JarvisLead, index: number): string {
  const compose = jarvisComposeLinks(lead);
  const emailCell = lead.email
    ? `<a href="mailto:${escape(lead.email)}">${escape(lead.email)}</a><small class="${lead.emailCheck}">${lead.emailCheck === "source_found" ? "seen on source page" : "unconfirmed"}</small>${link(lead.emailSource, "source ↗")}`
    : `<small class="missing">no public work email</small>`;
  const draft = compose
    ? `${link(compose.gmail, "Gmail")} · <a href="${escape(compose.mailto)}">Mail app</a>`
    : lead.email ? `<small>approve in Robin first</small>` : "";
  return `<tr data-cohort="${lead.audienceFit}" data-sendable="${isSendableCore(lead)}" data-search="${escape(`${lead.name} ${lead.company} ${lead.role} ${lead.industry} ${lead.email}`.toLowerCase())}">
<td>${index + 1}</td>
<td><strong>${escape(lead.name)}</strong>${link(lead.profileUrl, "profile ↗")}</td>
<td>${escape(lead.company)}<small>${escape(lead.role)}</small></td>
<td>${escape(COHORTS[lead.segment] ?? lead.segment)}<small>${escape(lead.industry)}</small></td>
<td>${emailCell}</td>
<td class="evidence"><q>${escape(lead.evidence)}</q>${link(lead.evidenceUrl, "evidence ↗")}</td>
<td><span class="status ${lead.status}">${escape(lead.status.replace(/_/g, " "))}</span>${lead.sentAt ? `<small>sent ${lead.sentAt.slice(0, 10)}</small>` : ""}${lead.reviewed ? "<small>reviewed</small>" : ""}</td>
<td><details><summary>${escape(lead.subject)}</summary><pre>${escape(lead.body)}</pre></details>
<div class="copy">${lead.email ? `<button type="button" data-copy="${escape(lead.email)}">Copy email</button>` : ""}<button type="button" data-copy="${escape(lead.subject)}">Copy subject</button><button type="button" data-copy="${escape(lead.body)}">Copy body</button></div>${draft}</td>
</tr>`;
}

/** A self-contained snapshot of the campaign. Compose links follow the same review gate as the page. */
export function renderJarvisReport(state: JarvisState, generatedAt = new Date()): string {
  const leads = [...state.leads].sort((a, b) => Number(isSendableCore(b)) - Number(isSendableCore(a)) || a.segment.localeCompare(b.segment) || a.name.localeCompare(b.name));
  const core = leads.filter((lead) => lead.audienceFit === "core");
  const stats: Array<[number, string]> = [
    [leads.filter(isSendableCore).length, "sendable core / 100"],
    [core.length, "core candidates"],
    [leads.filter((lead) => lead.email).length, "work emails (all)"],
    [leads.filter((lead) => lead.sentAt).length, "sent"],
    [leads.filter((lead) => lead.repliedAt).length, "replied"],
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
small.source_found{color:var(--ok)}small.unconfirmed{color:var(--warn)}small.missing{color:var(--bad)}
.status{font-size:12px;font-weight:600;text-transform:capitalize}.status.replied,.status.interested{color:var(--ok)}.status.declined,.status.bounced,.status.do_not_contact{color:var(--bad)}
.copy{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}button{font:inherit;font-size:12px;padding:3px 8px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);cursor:pointer}button:hover{border-color:var(--accent)}
pre{white-space:pre-wrap;font:12px/1.5 inherit;max-width:420px;margin:8px 0}summary{cursor:pointer;font-size:12px}
</style></head><body><main>
<h1>Jarvis.day · outreach list</h1>
<p class="meta">Generated ${escape(generatedAt.toISOString().replace("T", " ").slice(0, 16))} UTC. “Seen on source page” means the address appeared on the cited public page; it does not verify deliverability. Nothing here sends mail.</p>
<section class="stats">${stats.map(([n, label]) => `<div><strong>${n}</strong><span>${label}</span></div>`).join("")}</section>
<div class="controls"><input type="search" id="q" placeholder="Filter name, company, email…" aria-label="Filter">
<select id="view" aria-label="Show"><option value="sendable">Sendable core only</option><option value="core">All core</option><option value="all">Everyone</option></select><span id="count"></span><button type="button" id="export">Export HTML</button></div>
<div class="wrap"><table><thead><tr><th>#</th><th>Name</th><th>Company · role</th><th>Cohort · industry</th><th>Work email</th><th>Why this person</th><th>Status</th><th>Draft</th></tr></thead>
<tbody>${leads.map(row).join("\n")}</tbody></table></div>
</main><script>
const q=document.getElementById("q"),v=document.getElementById("view"),rows=[...document.querySelectorAll("tbody tr")],c=document.getElementById("count");
function apply(){const t=q.value.toLowerCase();let n=0;for(const r of rows){const ok=r.dataset.search.includes(t)&&(v.value==="all"||(v.value==="core"?r.dataset.cohort==="core":r.dataset.sendable==="true"));r.hidden=!ok;if(ok)n++}c.textContent=n+" shown"}
q.addEventListener("input",apply);v.addEventListener("change",apply);apply();
async function copyText(b){const t=b.dataset.copy;try{await navigator.clipboard.writeText(t)}catch{const a=document.createElement("textarea");a.value=t;document.body.appendChild(a);a.select();document.execCommand("copy");a.remove()}const l=b.textContent;b.textContent="Copied";setTimeout(()=>b.textContent=l,1500)}
document.addEventListener("click",e=>{const b=e.target.closest("button[data-copy]");if(b)copyText(b)});
// Saves this page as a standalone file; it keeps working offline because everything is inline.
document.getElementById("export").addEventListener("click",()=>{const html="<!doctype html>\\n"+document.documentElement.outerHTML;const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([html],{type:"text/html"}));a.download="jarvis-outreach-"+new Date().toISOString().slice(0,10)+".html";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
</script></body></html>`;
}
