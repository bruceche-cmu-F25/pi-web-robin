import { isHealthcareLead } from "../extension/robin/outreach-automation-domain.ts";
import { randomUUID } from "node:crypto";
import { cancelJarvisWebsiteRun, claimJarvisWebsiteRun, heartbeatJarvisWebsiteRun, patchJarvisWebsiteRun, readJarvis, saveJarvisWebsiteResearch } from "../extension/robin/jarvis-domain.ts";
import { isCurrentValidationProspect, type JarvisLead, type JarvisWebsiteContact, type JarvisWebsiteResearch, type JarvisWebsiteRun } from "../extension/robin/jarvis-shape.ts";
import { isPublicWebHost } from "../extension/robin/public-web.ts";
import { runScopedAssistantTurn } from "./robin-assistant.ts";
import { JARVIS_RUN_LEASE_MS, JARVIS_RUNTIME_OWNER_ID, startJarvisRunHeartbeat } from "./jarvis-run-lease.ts";

const WORKERS = 4;
const MAX_PAGES = 5;
const BLOCKED_SOURCE_HOST = /(^|\.)(linkedin\.com|instagram\.com|facebook\.com|x\.com|twitter\.com|tiktok\.com|youtube\.com|forbes\.com|crunchbase\.com|substack\.com|medium\.com|inc\.com|prnewswire\.com|businesswire\.com|globenewswire\.com|spotify\.com|apple\.com|amazon\.com|walmart\.com|target\.com|shopify\.com|builtwith\.com|storeleads\.app|pitchbook\.com|bloomberg\.com|yahoo\.com|google\.com)$/i;
const CONTACT_PATH = /(?:^|\/)(?:contact(?:-us)?|about(?:-us)?|(?:our-)?team|staff|leadership|providers|doctors|press(?:-room)?|media(?:-kit)?|wholesale|partners?(?:hips)?|support|help)(?:\/|$|-)/i;
const FORM_PATH = /(?:^|\/)(?:contact(?:-us)?|wholesale|partners?(?:hips)?|support|help)(?:\/|$|-)/i;
const GENERIC_LOCAL = /^(hello|hi|info|support|help|contact|sales|press|media|pr|care|service|customerservice|customer\.service|wholesale|partnerships?|collab|marketing|orders?|team|office|admin|inquiries|enquiries)$/i;
const registry = globalThis as typeof globalThis & { __jarvisWebsiteRun?: { id: string; controller: AbortController; heartbeatTimer: ReturnType<typeof setInterval> } };

function publicUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol) || !isPublicWebHost(url.hostname) || BLOCKED_SOURCE_HOST.test(url.hostname)) return null;
    url.hash = "";
    return url;
  } catch { return null; }
}

/** Best official-site candidate already supported by the contact's saved evidence. */
export function officialWebsiteCandidate(lead: JarvisLead): string | undefined {
  const candidates = [lead.profileUrl, lead.evidenceUrl, lead.shopifyEvidence?.url, lead.whyNow?.url, lead.foundVia?.url];
  const companyTokens = lead.company.toLowerCase().replace(/\([^)]*\)/g, " ").split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !["company", "brand", "beauty", "foods", "naturals"].includes(token));
  for (const candidate of candidates) {
    const url = publicUrl(candidate);
    if (!url) continue;
    const compactHost = url.hostname.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9]/g, "");
    if (!companyTokens.some((token) => compactHost.includes(token))) continue;
    return new URL("/", url).toString();
  }
}

async function safeFetchHtml(input: string, signal: AbortSignal): Promise<{ url: string; status: number; html: string }> {
  let url = new URL(input);
  for (let redirect = 0; redirect < 4; redirect++) {
    if (!isPublicWebHost(url.hostname)) throw new Error("Refused a non-public website host");
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 (compatible; JarvisContactResearch/1.0; public-contact-discovery)" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { url: url.toString(), status: response.status, html: "" };
      url = new URL(location, url);
      continue;
    }
    const type = response.headers.get("content-type") ?? "";
    const html = type.includes("html") ? (await response.text()).slice(0, 1_500_000) : "";
    return { url: url.toString(), status: response.status, html };
  }
  throw new Error("Too many website redirects");
}

function decodeBasicEntities(value: string): string {
  return value.replace(/&#64;|&#x40;|&commat;/gi, "@").replace(/&#46;|&#x2e;/gi, ".").replace(/&amp;/gi, "&");
}

function contactKind(email: string, lead: JarvisLead): "personal_email" | "company_email" {
  const local = email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (GENERIC_LOCAL.test(local)) return "company_email";
  const names = (lead.firstName || lead.name).toLowerCase().replace(/[^a-z\s-]/g, " ").split(/[\s-]+/).filter((part) => part.length > 2);
  return names.some((name) => local.includes(name)) ? "personal_email" : "company_email";
}

function contactsFromHtml(html: string, pageUrl: string, lead: JarvisLead): JarvisWebsiteContact[] {
  const decoded = decodeBasicEntities(html);
  const visible = decoded.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<svg\b[\s\S]*?<\/svg>/gi, " ").replace(/<[^>]+>/g, " ");
  const contacts: JarvisWebsiteContact[] = [];
  const mailtos = [...decoded.matchAll(/href\s*=\s*["']mailto:([^"'?\s]+)[^"']*["']/gi)].map((match) => match[1]!);
  const emailMatches = [...mailtos, ...(visible.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi) ?? [])];
  const websiteHost = new URL(pageUrl).hostname.replace(/^www\./, "");
  for (const email of emailMatches) {
    let decodedEmail: string;
    try { decodedEmail = decodeURIComponent(email); } catch { continue; }
    const normalized = decodedEmail.trim().toLowerCase().replace(/[),.;:]+$/, "");
    if (/\s/.test(normalized)) continue;
    const domain = normalized.split("@")[1] ?? "";
    if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(normalized) || normalized.length > 254 || !domain.includes(".")
      || /^(email|name|yourname|example|test)@|@(example\.com|yourdomain\.com)$/i.test(normalized)
      || !(domain === websiteHost || websiteHost.endsWith(`.${domain}`) || domain.endsWith(`.${websiteHost}`))) continue;
    contacts.push({ kind: contactKind(normalized, lead), value: normalized, sourceUrl: pageUrl });
  }
  for (const match of decoded.matchAll(/href\s*=\s*["']tel:([^"'#?]+)["']/gi)) {
    const phone = match[1]!.trim();
    if (phone.length >= 7 && phone.length <= 30) contacts.push({ kind: "phone", value: phone, sourceUrl: pageUrl });
  }
  if (/<form\b/i.test(decoded) && FORM_PATH.test(new URL(pageUrl).pathname)
    && /<textarea\b|name\s*=\s*["'](?:message|subject|inquiry|enquiry)["']|contact[-_ ]?form/i.test(decoded)) contacts.push({ kind: "contact_form", value: pageUrl, sourceUrl: pageUrl });
  return contacts;
}

function contactLinks(html: string, base: string): string[] {
  const links: string[] = [];
  for (const match of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(decodeBasicEntities(match[1]!), base);
      const root = new URL(base);
      if (url.hostname === root.hostname && /^https?:$/.test(url.protocol) && CONTACT_PATH.test(url.pathname)) {
        url.hash = "";
        links.push(url.toString());
      }
    } catch { /* Ignore malformed page links. */ }
  }
  return [...new Set(links)].slice(0, MAX_PAGES - 1);
}

function dedupeContacts(contacts: JarvisWebsiteContact[]): JarvisWebsiteContact[] {
  const seen = new Set<string>();
  return contacts.filter((contact) => {
    const key = `${contact.kind}:${contact.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

async function resolveOfficialWebsite(lead: JarvisLead, signal: AbortSignal): Promise<string | undefined> {
  const result = await runScopedAssistantTurn({
    remembered: null, remember: () => {}, oneShot: true,
    toolNames: ["web_search", "fetch_content", "get_search_content"],
    preamble: "Find official public company websites. Never guess a domain. Do not contact anyone, log in, submit forms, or use private data.",
    message: `Find the official website for ${lead.company}, led by ${lead.name} (${lead.role}). Search and open a source that proves the domain belongs to this exact company. Return only <official-website>{"url":"https://official-domain/"}</official-website>, or an empty url when not proven.`,
    timeoutMs: 120_000, signal,
  });
  const match = /<official-website>\s*({[\s\S]*?})\s*<\/official-website>/i.exec(result.reply);
  if (!match) return undefined;
  try { return publicUrl(JSON.parse(match[1]!).url)?.toString(); } catch { return undefined; }
}

export async function crawlJarvisWebsite(lead: JarvisLead, signal: AbortSignal, website?: string): Promise<JarvisWebsiteResearch> {
  const checkedAt = new Date().toISOString();
  const candidate = website ?? officialWebsiteCandidate(lead) ?? await resolveOfficialWebsite(lead, signal);
  if (!candidate) return { status: "missing_website", contacts: [], checkedAt, note: "No official company website could be verified from public sources." };
  try {
    const root = await safeFetchHtml(candidate, signal);
    if ([401, 403, 429].includes(root.status)) return { status: "blocked", websiteUrl: root.url, contacts: [], checkedAt, note: `Website returned HTTP ${root.status}.` };
    if (root.status < 200 || root.status >= 400 || !root.html) return { status: "error", websiteUrl: root.url, contacts: [], checkedAt, note: `Website returned HTTP ${root.status} or no HTML.` };
    // Healthcare bios often contain the individual address while the homepage
    // links only to a general inbox. Always inspect the saved official bio.
    const savedPages = [lead.profileUrl, lead.emailSource, lead.evidenceUrl].filter(url => {
      try { return Boolean(url) && new URL(url).origin === new URL(root.url).origin; } catch { return false; }
    });
    const pages = [...new Set([root.url, ...savedPages, ...contactLinks(root.html, root.url)])];
    const contacts = contactsFromHtml(root.html, root.url, lead);
    for (const page of pages.slice(1, MAX_PAGES)) {
      if (signal.aborted) break;
      try {
        const fetched = await safeFetchHtml(page, signal);
        if (fetched.status >= 200 && fetched.status < 400 && fetched.html) contacts.push(...contactsFromHtml(fetched.html, fetched.url, lead));
      } catch { /* One broken contact page must not discard other public routes. */ }
    }
    const unique = dedupeContacts(contacts);
    return { status: unique.length ? "found" : "none", websiteUrl: root.url, contacts: unique, checkedAt, note: unique.length ? undefined : `Checked ${pages.length} public page${pages.length === 1 ? "" : "s"}; no published contact route was found.` };
  } catch (error) {
    if (signal.aborted) throw error;
    return { status: "error", websiteUrl: candidate, contacts: [], checkedAt, note: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) };
  }
}

export function startJarvisWebsiteEnrichment(): JarvisWebsiteRun {
  if (registry.__jarvisWebsiteRun) throw new Error("Website contact enrichment is already running or stopping");
  const leads = readJarvis().leads.filter(lead => isCurrentValidationProspect(lead) || isHealthcareLead(lead))
    .sort((a, b) => Number(!officialWebsiteCandidate(a)) - Number(!officialWebsiteCandidate(b)));
  if (!leads.length) throw new Error("No DTC or healthcare prospects are available for website enrichment");
  const startedAt = new Date().toISOString();
  const run: JarvisWebsiteRun = { id: randomUUID(), ownerId: JARVIS_RUNTIME_OWNER_ID, heartbeatAt: startedAt, status: "running", total: leads.length, checked: 0, found: 0, failed: 0, activeWorkers: WORKERS, startedAt, message: `Starting public website contact checks for ${leads.length} DTC and healthcare prospects…` };
  const controller = new AbortController();
  // Results are generated evidence, not user edits. A new full run replaces a
  // stopped/older pass so stale false positives cannot survive beside new data.
  claimJarvisWebsiteRun(run, Date.now() - JARVIS_RUN_LEASE_MS);
  const heartbeatTimer = startJarvisRunHeartbeat(() => heartbeatJarvisWebsiteRun(run.id, JARVIS_RUNTIME_OWNER_ID), controller);
  registry.__jarvisWebsiteRun = { id: run.id, controller, heartbeatTimer };
  void enrich(run, leads.map((lead) => lead.id), controller.signal).catch((error: unknown) => {
    patchJarvisWebsiteRun(run.id, { status: "error", activeWorkers: 0, message: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() });
  }).finally(() => {
    if (registry.__jarvisWebsiteRun?.id === run.id) {
      clearInterval(registry.__jarvisWebsiteRun.heartbeatTimer);
      delete registry.__jarvisWebsiteRun;
    }
  });
  return run;
}

export function stopJarvisWebsiteEnrichment(): void {
  const active = registry.__jarvisWebsiteRun;
  active?.controller.abort();
  cancelJarvisWebsiteRun();
}

async function enrich(run: JarvisWebsiteRun, ids: string[], signal: AbortSignal): Promise<void> {
  let cursor = 0;
  let checked = 0;
  let found = 0;
  let failed = 0;
  const worker = async () => {
    while (!signal.aborted) {
      const index = cursor++;
      if (index >= ids.length) return;
      const lead = readJarvis().leads.find((item) => item.id === ids[index]);
      if (!lead) continue;
      patchJarvisWebsiteRun(run.id, { checked, found, failed, message: `Checking ${lead.company} · ${checked}/${run.total} completed.` });
      let research: JarvisWebsiteResearch;
      try { research = await crawlJarvisWebsite(lead, signal); }
      catch (error) {
        if (signal.aborted) return;
        research = { status: "error", contacts: [], checkedAt: new Date().toISOString(), note: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) };
      }
      if (signal.aborted) return;
      if (!saveJarvisWebsiteResearch(run.id, lead.id, research)) return;
      checked += 1;
      if (research.status === "found") found += 1;
      if (["blocked", "error", "missing_website"].includes(research.status)) failed += 1;
      patchJarvisWebsiteRun(run.id, { checked, found, failed, message: `Website contacts · ${checked}/${run.total} checked · ${found} with routes · ${failed} unresolved.` });
    }
  };
  await Promise.all(Array.from({ length: Math.min(WORKERS, ids.length) }, worker));
  if (signal.aborted) return;
  patchJarvisWebsiteRun(run.id, { status: "done", checked, found, failed, activeWorkers: 0, message: `Checked all ${checked} DTC and healthcare prospects: ${found} have public website routes; ${failed} need manual follow-up.`, finishedAt: new Date().toISOString() });
}
