import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = mkdtempSync(join(tmpdir(), "jarvis-test-"));
process.env.ROBIN_DATA_DIR = root;
const d = await import("./jarvis-domain.ts");
const { hasDtcPrimaryRoute, isJarvisFollowUpDue, isQualifiedInfoExec, jarvisTier, isJarvisExecutive, isSendableCore, jarvisComposeLinks, jarvisListPriority, newsBurdenTotal, JARVIS_DELIVERY_POLICY } = await import("./jarvis-shape.ts");
const r = await import("./jarvis-research.ts");
const outreach = await import("./outreach-shape.ts");
beforeEach(() => rmSync(join(root, "jarvis-discovery.json"), { force: true }));
after(() => rmSync(root, { recursive: true, force: true }));
const candidate = (extra = {}) => ({ name: "Ada Example", company: "Example Inc", role: "CTO", seniority: "Executive", industry: "AI tools", segment: "clinic", profileUrl: "https://example.com/team/ada", evidence: "Ada Example is CTO of Example Inc.", evidenceUrl: "https://example.com/team", needHypothesis: "可能需要追踪 AI 工具；待访谈验证。", email: "ada@example.com", emailSource: "https://example.com/team/ada", emailQuote: "Contact Ada: ada@example.com", opener: "I came across your work as CTO of Example Inc.", ...extra });
function add(extra = {}) { d.addJarvisCandidates([candidate(extra)]); return d.readJarvis().leads.at(-1); }

for (const [platform, url] of Object.entries({ linkedin: "https://www.linkedin.com/in/ada", x: "https://x.com/ada", tiktok: "https://www.tiktok.com/@ada" })) {
  test(`${platform} batch review preserves exact channel, revokes edited drafts, and tracks contact/reply without email`, () => {
    const lead = add({
      segment: "info_exec", persona: "ecommerce_owner",
      watchList: "customers, platforms, inventory, competitors and channels",
      newsBurden: burden(3, 3, 2, 2), ...sprint(),
      socials: { [platform]: url, instagram: "https://www.instagram.com/ada/" },
    });
    assert.equal(outreach.canReviewChannel(lead, platform), true);
    assert.equal(outreach.canReviewChannel(lead, "email"), false, "unconfirmed emails are not queueable");
    const item = { id: lead.id, revision: lead.revision ?? 0, route: url, draft: "Hi Ada, could we discuss your workflow?\n\nhttps://your-secretary.com", identityChecked: true, draftChecked: true };
    assert.throws(() => d.prepareJarvisOutreachBatch({ channel: platform, confirmed: true, items: [{ ...item, route: "https://example.com/wrong" }] }), /profile changed/);
    assert.equal(d.readJarvis().leads[0].outreachApproval, undefined);
    d.prepareJarvisOutreachBatch({ channel: platform, confirmed: true, items: [item] });
    let saved = d.readJarvis().leads[0];
    assert.equal(saved.outreachApproval.channel, platform);
    assert.equal(saved.socialOutreach.instagram, undefined);
    assert.equal(saved.queuedAt, undefined);
    assert.equal(outreach.outreachStage(saved), "ready");
    saved = d.updateJarvisSocialOutreach(lead.id, { op: "save", platform, revision: saved.revision, draft: "Changed copy\n\nhttps://your-secretary.com" });
    assert.equal(saved.outreachApproval, undefined);
    assert.equal(outreach.outreachStage(saved), "new");
    d.prepareJarvisOutreachBatch({ channel: platform, confirmed: true, items: [{ ...item, revision: saved.revision, draft: "Changed copy\n\nhttps://your-secretary.com" }] });
    saved = d.readJarvis().leads[0];
    saved = d.updateJarvisSocialOutreach(lead.id, { op: "sent", platform, revision: saved.revision });
    assert.equal(outreach.outreachStage(saved), "sent");
    assert.equal(saved.socialOutreach[platform].sentText, "Changed copy\n\nhttps://your-secretary.com");
    assert.equal(saved.sentAt, undefined);
    assert.equal(outreach.canReviewChannel(saved, "instagram"), false, "do not double-contact through another channel");
    saved = d.updateJarvisSocialOutreach(lead.id, { op: "replied", platform, revision: saved.revision });
    assert.equal(outreach.outreachStage(saved), "replied");
  });
}

test("social draft uses short product introduction and preserves existing copy", () => {
  const lead = add({ socials: { linkedin: "https://www.linkedin.com/in/ada" } });
  assert.match(outreach.socialDraft(lead, "linkedin"), /deserves your attention/);
  assert.doesNotMatch(outreach.socialDraft(lead, "linkedin"), /I came across|CMU|AI product/);
  assert.equal(outreach.socialDraft({ ...lead, socialOutreach: { linkedin: { draft: "My personal message" } } }, "linkedin"), "My personal message");
});

test("research is deduplicated without overwriting user status, notes or email drafts", () => {
  const lead = add();
  d.updateJarvisLead(lead.id, { body: "My edited draft", notes: "Interview next week", reviewed: true, status: "sent" });
  assert.equal(d.addJarvisCandidates([candidate({ profileUrl: "http://www.example.com/team/ada/?utm_source=x", company: "Example INC." })]), 0);
  const saved = d.readJarvis().leads[0];
  assert.equal(saved.body, "My edited draft");
  assert.equal(saved.notes, "Interview next week");
  assert.equal(saved.status, "sent");
  assert.ok(saved.sentAt);
  assert.equal(d.addJarvisCandidates([candidate({ name: "Different Name" })]), 0, "same email is not a new person");
});

const burden = (change, breadth, unfiltered, footprint) => Object.fromEntries(Object.entries({ change, breadth, unfiltered, footprint }).map(([key, score]) => [key, { score, evidence: `${key} sourced reason` }]));
const sprint = (sourcingLane = "dtc_shopify") => ({
  sourcingLane,
  informationNeedEvidence: { url: "https://example.com/project", quote: "Ada reviews customer, platform and inventory signals to make operating decisions." },
  whyNow: { summary: "The company recently launched a new product line.", url: "https://example.com/news", quote: "The new product line launched in 2026." },
  companyFit: { score: 42, evidence: "A hands-on operator monitors several changing inputs." },
  reachability: { score: 40, evidence: "The current founder has a public professional contact route." },
});

test("current validation prospects keep burden scores for prioritization and allow DTC personal Instagram", () => {
  const exec = (extra) => candidate({ segment: "info_exec", persona: "ecommerce_owner", watchList: "customer behavior, platform changes, inventory, competitors and channel performance", email: "", emailSource: "", emailQuote: "", socials: { instagram: "https://www.instagram.com/adaresearch/" }, ...sprint(), ...extra });
  assert.throws(() => d.parseJarvisCandidate(exec({})), /newsBurden/, "info_exec is chosen for its burden, so the scores are required");
  assert.throws(() => d.parseJarvisCandidate(exec({ newsBurden: burden(4, 3, 3, 3) })), /score/);
  assert.throws(() => d.parseJarvisCandidate(exec({ persona: "executive", newsBurden: burden(3, 3, 3, 3) })), /persona/, "persona is one of the four");
  assert.throws(() => d.parseJarvisCandidate(exec({ persona: "researcher", newsBurden: burden(3, 3, 3, 3) })), /persona/, "legacy personas are no longer targeted");
  assert.throws(() => d.parseJarvisCandidate(exec({ watchList: "", newsBurden: burden(3, 3, 3, 3) })), /watchList/, "a target user needs a named watch list");
  assert.throws(() => d.parseJarvisCandidate(exec({ newsBurden: { ...burden(3, 3, 3, 3), footprint: { score: 3, evidence: "" } } })), /evidence/);
  d.addJarvisCandidates([exec({ newsBurden: burden(3, 3, 2, 2) }), exec({ name: "Low Burden", newsBurden: burden(3, 3, 3, 0) }), exec({ name: "Thin Burden", newsBurden: burden(2, 2, 2, 2) })]);
  const [strong, zero, thin] = d.readJarvis().leads;
  assert.equal(strong.assessedVersion, 6);
  assert.equal(strong.persona, "ecommerce_owner");
  assert.equal(newsBurdenTotal(strong), 10);
  assert.equal(isQualifiedInfoExec(strong), true, "a missing email means LinkedIn or an intro, not disqualification");
  assert.equal(isSendableCore(strong), false);
  assert.equal(strong.emailCheck, "missing");
  assert.equal(isQualifiedInfoExec(zero), true, "an interview, not public pages, validates the information-pain hypothesis");
  assert.equal(isQualifiedInfoExec(thin), true, "a modest burden score remains useful for prioritization without excluding the prospect");
  d.updateJarvisLead(strong.id, { status: "do_not_contact" });
  assert.equal(isQualifiedInfoExec(d.readJarvis().leads[0]), false);
});

test("research prompt requires a personal email or Instagram and keeps email required elsewhere", () => {
  assert.throws(() => r.jarvisResearchPrompt([], "info_exec", 3), /persona/);
  const exec = r.jarvisResearchPrompt([], "info_exec", 3, "ecommerce_owner", false, "dtc_shopify");
  assert.match(exec, /Persona ecommerce_owner\./);
  assert.match(exec, /Shopify|DTC brand/);
  assert.match(exec, /either a sourced individual work email or a trustworthy PERSONAL Instagram/);
  assert.match(exec, /LinkedIn.*do not satisfy/);
  assert.match(exec, /contact-route-first/);
  assert.match(exec, /current role/);
  assert.match(exec, /Reddit\/Facebook\/TEDx are discovery only/);
  assert.match(exec, /Targeted source sweep for this run/);
  assert.match(exec, /Unbounce customer stories/);
  assert.match(r.jarvisResearchPrompt([], "info_exec", 3, "ecommerce_owner", false, "dtc_shopify", undefined, 1), /Shopify or ecommerce-platform merchant\/customer stories/);
  assert.match(exec, /old case study only as a discovery seed/);
  assert.match(r.JARVIS_RESEARCH_PREAMBLE, /Do not join private Facebook groups/);
  assert.doesNotMatch(exec, /skip anyone whose email/);
  assert.match(r.jarvisResearchPrompt([], "clinic", 3), /skip anyone whose email/);
  assert.match(r.JARVIS_RESEARCH_PREAMBLE, /Never a target user: generic influencers/);
  assert.match(r.JARVIS_RESEARCH_PREAMBLE, /Grants and fellowships are one example/);
  assert.match(r.jarvisRescorePrompt([], true), /do not search or fetch/);
});

test("grant primary routes exclude LinkedIn-only records", () => {
  assert.equal(hasDtcPrimaryRoute({ email: "", emailCheck: "missing", emailSource: "", emailQuote: "", socials: { linkedin: "https://linkedin.com/in/ada" } }), false);
  assert.equal(hasDtcPrimaryRoute({ email: "", emailCheck: "missing", emailSource: "", emailQuote: "", socials: { instagram: "https://instagram.com/ada" } }), true);
  assert.equal(hasDtcPrimaryRoute({ email: "ada@example.com", emailCheck: "source_found", emailSource: "https://example.com/team", emailQuote: "Ada: ada@example.com", socials: { linkedin: "https://linkedin.com/in/ada" } }), true);
});

test("person work location and company HQ stay distinct, sourced and time-zone-aware", async () => {
  const lead = add({
    personLocation: "Chicago, Illinois", personLocationSource: "https://example.com/team/ada",
    companyLocation: "HQ: Boston, Massachusetts", companyLocationSource: "https://example.com/about",
    timeZone: "America/Chicago",
  });
  assert.equal(lead.timeZone, "America/Chicago");
  assert.equal(lead.companyLocation, "HQ: Boston, Massachusetts");
  assert.throws(() => d.updateJarvisLead(lead.id, { personLocationSource: "" }), /source URL/);
  assert.throws(() => d.updateJarvisLead(lead.id, { companyLocationSource: "http://localhost/about" }), /public URL/);
  assert.throws(() => d.updateJarvisLead(lead.id, { timeZone: "CST" }), /IANA/);
  const moved = d.updateJarvisLead(lead.id, { personLocation: "Phoenix, Arizona", personLocationSource: "https://example.com/team/ada", timeZone: "America/Chicago" });
  assert.equal(moved.timeZone, "", "changing a person's location clears an unchanged (possibly stale) time zone");
  assert.equal(moved.companyLocation, "HQ: Boston, Massachusetts");
  assert.equal(d.updateJarvisLead(lead.id, { timeZone: "America/Phoenix" }).timeZone, "America/Phoenix");
  const unsourced = add({ name: "Other", email: "other@example.com", emailQuote: "other@example.com", profileUrl: "https://example.com/other", personLocation: "Somewhere", timeZone: "America/New_York" });
  assert.equal(unsourced.personLocation, "");
  assert.equal(unsourced.timeZone, "");
  const { renderJarvisReport } = await import("../../lib/jarvis-report.ts");
  const html = renderJarvisReport(d.readJarvis());
  assert.match(html, /Work: Phoenix, Arizona/);
  assert.match(html, /Company: HQ: Boston, Massachusetts/);
  assert.match(html, /Time zone: America\/Phoenix/);
});

test("the old tech-heavy batch is retained as adjacent while new research counts as core", () => {
  d.writeJarvisRun({ id: "migration", status: "done", target: 100, added: 0, batches: 0, startedAt: new Date().toISOString(), message: "" });
  const statePath = join(root, "jarvis-discovery.json");
  const raw = JSON.parse(readFileSync(statePath, "utf8"));
  raw.leads = [{ ...candidate(), id: "legacy", segment: "founder", status: "new", reviewed: false, emailCheck: "missing", subject: "s", body: "b", notes: "", confirmedNeeds: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [] }];
  writeFileSync(statePath, JSON.stringify(raw));
  assert.equal(d.readJarvis().leads[0].audienceFit, "adjacent");
});

test("two people may share a team-page profile without being duplicates", () => {
  add({ profileUrl: "https://example.com/team" });
  assert.equal(d.addJarvisCandidates([candidate({ name: "Bob Example", profileUrl: "https://example.com/team", email: "", emailSource: "", emailQuote: "" })]), 1);
});

test("validation rejects header injection, unsupported URLs, missing email evidence and unknown fields", () => {
  for (const extra of [{ email: "ada@example.com\r\nBcc: x@example.com" }, { emailSource: "javascript:alert(1)" }, { profileUrl: "http://127.0.0.1/private" }, { emailQuote: "probably first.last" }, { segment: "random" }, { email: "ada@gmail.com", emailSource: "https://example.com", emailQuote: "ada@gmail.com" }, { email: "director@example.org", emailSource: "https://example.org/team", emailQuote: "director@example.org" }, { socials: { instagram: "https://linkedin.com/in/ada" } }, { opener: "Ada Example is CTO at Example Inc." }]) {
    assert.throws(() => d.addJarvisCandidates([candidate(extra)]));
  }
  assert.equal(d.readJarvis().leads.length, 0);
  const lead = add();
  assert.throws(() => d.updateJarvisLead(lead.id, { sentAt: "yesterday" }));
  assert.throws(() => d.updateJarvisLead(lead.id, { reviewed: "yes" }));
  assert.throws(() => d.updateJarvisLead(lead.id, { status: "sent" }));
});

test("compose needs human review and never marks sent; changed drafts revoke review", () => {
  const lead = add();
  assert.equal(jarvisComposeLinks(lead), null);
  const ready = d.updateJarvisLead(lead.id, { reviewed: true, status: "ready", subject: "A & B?", body: "Hello\nA & B # C" });
  const links = jarvisComposeLinks(ready);
  assert.ok(links.mailto.startsWith("mailto:ada%40example.com?subject=A%20%26%20B%3F"));
  assert.equal(new URL(links.gmail).searchParams.get("body"), "Hello\nA & B # C");
  assert.equal(d.readJarvis().leads[0].sentAt, undefined);
  const edited = d.updateJarvisLead(lead.id, { body: "A different email" });
  assert.equal(edited.reviewed, false);
  assert.equal(edited.status, "new");
  assert.equal(edited.history.at(-1).status, "new");
  assert.equal(jarvisComposeLinks(edited), null);
});

test("sending claims a reviewed snapshot once, records Gmail id only on success, and never retries unknown outcomes", () => {
  const lead = add();
  assert.throws(() => d.claimJarvisSend(lead.id, lead.revision ?? 0), /not approved/);
  const ready = d.updateJarvisLead(lead.id, { reviewed: true, status: "ready" });
  assert.throws(() => d.claimJarvisSend(lead.id, lead.revision ?? 0), /changed/);
  const claimed = d.claimJarvisSend(lead.id, ready.revision);
  assert.equal(claimed.email, "ada@example.com");
  assert.throws(() => d.claimJarvisSend(lead.id, ready.revision));
  assert.throws(() => d.updateJarvisLead(lead.id, { email: "other@example.com" }));
  d.finishJarvisSend(lead.id, claimed.attemptId, "gmail-message-123");
  const sent = d.readJarvis().leads[0];
  assert.equal(sent.status, "sent");
  assert.equal(sent.sendAttempt.messageId, "gmail-message-123");
  assert.ok(sent.sentAt);
  assert.throws(() => d.claimJarvisSend(lead.id, sent.revision));
  assert.throws(() => d.finishJarvisSend(lead.id, claimed.attemptId, "again"));

  const other = add({ name: "Other", email: "other@example.com", emailQuote: "other@example.com", profileUrl: "https://example.com/other" });
  const approved = d.updateJarvisLead(other.id, { reviewed: true, status: "ready" });
  const second = d.claimJarvisSend(other.id, approved.revision);
  d.finishJarvisSend(other.id, second.attemptId);
  const uncertain = d.readJarvis().leads.find((item) => item.id === other.id);
  assert.equal(uncertain.sendAttempt.state, "uncertain");
  assert.equal(uncertain.sentAt, undefined);
  assert.equal(jarvisComposeLinks(uncertain), null);
  assert.throws(() => d.claimJarvisSend(other.id, uncertain.revision));
  assert.equal(d.updateJarvisLead(other.id, { status: "sent" }).status, "sent", "manual reconciliation remains possible");
});

test("Gmail MIME uses UTF-8 and blocks header injection", async () => {
  const { encodeJarvisMessage } = await import("./jarvis-mail.ts");
  const raw = Buffer.from(encodeJarvisMessage("ada@example.com", "你好 👋", "First\nSecond ✓"), "base64url").toString("utf8");
  assert.match(raw, /^To: ada@example.com\r\nSubject: =\?UTF-8\?B\?/);
  assert.equal(Buffer.from(raw.split("\r\n\r\n")[1], "base64").toString(), "First\r\nSecond ✓");
  assert.throws(() => encodeJarvisMessage("ada@example.com", "Hi\r\nBcc: bad@example.com", "body"));
  const long = Buffer.from(encodeJarvisMessage("ada@example.com", "你好".repeat(70), "x".repeat(1000)), "base64url").toString();
  assert.ok(long.split("\r\n\r\n")[0].split("\r\n").every((line) => line.length <= 78), "MIME headers are folded");
  assert.ok(long.split("\r\n\r\n")[1].split("\r\n").every((line) => line.length <= 76), "base64 body is folded");
});

test("sender requires the new Gmail grant and sends exactly one stored MIME message", async () => {
  const { sendJarvisEmail } = await import("./jarvis-mail.ts");
  const tokenFile = join(root, "google-outreach.json");
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    assert.equal(options.headers.Authorization, "Bearer test-token");
    const message = Buffer.from(JSON.parse(options.body).raw, "base64url").toString("utf8");
    assert.match(message, /^To: ada@example.com\r\nSubject: /);
    return Response.json({ id: "google-id" });
  };
  try {
    const token = { email: "personal@example.com", refreshToken: "test-refresh", accessToken: "test-token", accessTokenExpiresAt: Date.now() + 300000, connectedAt: new Date().toISOString(), scopes: [] };
    writeFileSync(tokenFile, JSON.stringify(token));
    await assert.rejects(() => sendJarvisEmail("ada@example.com", "Hi", "Body"), /Connect your personal Gmail/);
    assert.equal(calls, 0);
    writeFileSync(tokenFile, JSON.stringify({ ...token, scopes: ["https://www.googleapis.com/auth/gmail.send"] }));
    assert.deepEqual(await sendJarvisEmail("ada@example.com", "Hi", "Body"), { id: "google-id" });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = oldFetch; rmSync(tokenFile, { force: true }); }
});

test("no email is valid research, not sendable; do-not-contact is sticky", () => {
  const missing = add({ email: "", emailSource: "", emailQuote: "" });
  assert.equal(missing.emailCheck, "missing");
  assert.throws(() => d.updateJarvisLead(missing.id, { reviewed: true }));
  const lead = add({ name: "Another Person", profileUrl: "https://example.com/another" });
  d.updateJarvisLead(lead.id, { reviewed: true, status: "sent" });
  const replied = d.updateJarvisLead(lead.id, { status: "replied", confirmedNeeds: "I spend two hours each morning reading." });
  assert.ok(replied.repliedAt);
  assert.equal(replied.needHypothesis, candidate().needHypothesis);
  const suppressed = d.updateJarvisLead(lead.id, { status: "do_not_contact" });
  assert.equal(jarvisComposeLinks(suppressed), null);
  assert.throws(() => d.updateJarvisLead(lead.id, { status: "ready" }));
  assert.equal(d.addJarvisCandidates([candidate({ name: "Another Person", profileUrl: "https://example.com/another" })]), 0);
});

test("cancelled/replaced jobs cannot import late results or overwrite the next run", () => {
  const run = { id: "one", status: "running", target: 5, added: 0, batches: 0, startedAt: new Date().toISOString(), message: "" };
  d.writeJarvisRun(run);
  assert.equal(d.addJarvisCandidates([candidate()], new Set(["ada@example.com"]), "one"), 1);
  assert.equal(d.readJarvis().leads[0].emailCheck, "source_found");
  assert.equal(d.readJarvis().run.added, 1);
  d.patchJarvisRun("one", { status: "cancelled" });
  assert.equal(d.addJarvisCandidates([candidate({ name: "New", email: "", emailSource: "", emailQuote: "" })], new Set(), "one"), 0);
  d.writeJarvisRun({ ...run, id: "two" });
  d.patchJarvisRun("one", { status: "done" });
  assert.equal(d.readJarvis().run.status, "running");
});

test("research leases are claimed, renewed, expired and cancelled atomically", () => {
  const run = { id: "one", ownerId: "runtime-one", heartbeatAt: "2026-10-04T10:00:00.000Z", status: "running", target: 5, added: 0, batches: 0, startedAt: "2026-10-04T10:00:00.000Z", message: "" };
  d.claimJarvisRun(run, Date.parse("2026-10-04T09:58:00.000Z"));
  assert.throws(() => d.claimJarvisRun({ ...run, id: "two", ownerId: "runtime-two" }, Date.parse("2026-10-04T09:59:00.000Z")), /already running/);
  assert.equal(d.heartbeatJarvisRun("one", "runtime-two", "2026-10-04T10:01:00.000Z"), false);
  assert.equal(d.heartbeatJarvisRun("one", "runtime-one", "2026-10-04T10:01:00.000Z"), true);
  d.claimJarvisRun({ ...run, id: "two", ownerId: "runtime-two", heartbeatAt: "2026-10-04T10:03:00.000Z" }, Date.parse("2026-10-04T10:02:00.000Z"));
  assert.equal(d.heartbeatJarvisRun("one", "runtime-one", "2026-10-04T10:04:00.000Z"), false);
  assert.equal(d.cancelJarvisRun("2026-10-04T10:04:00.000Z"), "two");
  assert.equal(d.readJarvis().run.status, "cancelled");
  assert.equal(d.readJarvis().run.finishedAt, "2026-10-04T10:04:00.000Z");
});

test("manual and outbox delivery share one renewable cross-process lease", () => {
  assert.equal(d.claimJarvisDeliveryLease("runtime-one:manual", Date.parse("2026-10-04T09:58:00.000Z"), "2026-10-04T10:00:00.000Z"), true);
  assert.equal(d.claimJarvisDeliveryLease("runtime-two:outbox", Date.parse("2026-10-04T09:59:00.000Z"), "2026-10-04T10:00:30.000Z"), false);
  assert.equal(d.heartbeatJarvisDeliveryLease("runtime-two:outbox", "2026-10-04T10:01:00.000Z"), false);
  assert.equal(d.heartbeatJarvisDeliveryLease("runtime-one:manual", "2026-10-04T10:01:00.000Z"), true);
  assert.equal(d.releaseJarvisDeliveryLease("runtime-two:outbox"), false);
  assert.equal(d.releaseJarvisDeliveryLease("runtime-one:manual"), true);
  assert.equal(d.claimJarvisDeliveryLease("runtime-two:outbox", Date.parse("2026-10-04T09:59:00.000Z"), "2026-10-04T10:02:00.000Z"), true);
});

test("rescoring and website enrichment reject fresh owners and discard late writes after takeover", () => {
  const lead = add();
  const rescore = { id: "score-one", ownerId: "runtime-one", heartbeatAt: "2026-10-04T10:00:00.000Z", status: "running", total: 1, assessed: 0, startedAt: "2026-10-04T10:00:00.000Z", message: "" };
  d.claimJarvisRescore(rescore, Date.parse("2026-10-04T09:58:00.000Z"));
  assert.throws(() => d.claimJarvisRescore({ ...rescore, id: "score-two", ownerId: "runtime-two" }, Date.parse("2026-10-04T09:59:00.000Z")), /already running/);
  assert.equal(d.heartbeatJarvisRescore("score-one", "runtime-one", "2026-10-04T10:01:00.000Z"), true);
  d.claimJarvisRescore({ ...rescore, id: "score-two", ownerId: "runtime-two", heartbeatAt: "2026-10-04T10:03:00.000Z" }, Date.parse("2026-10-04T10:02:00.000Z"));
  assert.equal(d.applyJarvisAssessment(lead.id, { persona: "none", newsBurden: burden(3, 3, 2, 2) }, "score-one"), false, "replaced runs cannot save a late assessment");
  assert.equal(d.cancelJarvisRescore("2026-10-04T10:04:00.000Z"), "score-two");

  const website = { id: "web-one", ownerId: "runtime-one", heartbeatAt: "2026-10-04T10:00:00.000Z", status: "running", total: 1, checked: 0, found: 0, failed: 0, activeWorkers: 1, startedAt: "2026-10-04T10:00:00.000Z", message: "" };
  d.claimJarvisWebsiteRun(website, Date.parse("2026-10-04T09:58:00.000Z"));
  assert.equal(d.saveJarvisWebsiteResearch("web-one", lead.id, { status: "none", contacts: [], checkedAt: "2026-10-04T10:00:30.000Z" }), true);
  assert.throws(() => d.claimJarvisWebsiteRun({ ...website, id: "web-two", ownerId: "runtime-two" }, Date.parse("2026-10-04T09:59:00.000Z")), /already running/);
  d.claimJarvisWebsiteRun({ ...website, id: "web-two", ownerId: "runtime-two", heartbeatAt: "2026-10-04T10:03:00.000Z" }, Date.parse("2026-10-04T10:02:00.000Z"));
  assert.equal(d.readJarvis().leads[0].websiteResearch, undefined, "claiming a full pass clears prior generated evidence atomically");
  assert.equal(d.saveJarvisWebsiteResearch("web-one", lead.id, { status: "found", contacts: [], checkedAt: "2026-10-04T10:03:30.000Z" }), false);
  assert.equal(d.cancelJarvisWebsiteRun("2026-10-04T10:04:00.000Z"), "web-two");
  assert.equal(d.readJarvis().websiteRun.activeWorkers, 0);
});

test("structured research rejects malformed output, and skips invalid candidates only", () => {
  const envelope = (leads) => `<jarvis-leads>${JSON.stringify({ leads })}</jarvis-leads>`;
  assert.throws(() => r.parseJarvisResearch("Here are some people"));
  assert.throws(() => r.parseJarvisResearch(envelope([{ name: "made up" }])), /Invalid core segment/);
  const parsed = r.parseJarvisResearch(`Thinking...\n${envelope([candidate(), { name: "bad" }])}`);
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.rejected, 1);
  assert.deepEqual(r.JARVIS_RESEARCH_TOOLS, ["web_search", "fetch_content", "get_search_content"]);
  assert.match(r.JARVIS_RESEARCH_PREAMBLE, /provider "openai" and workflow "none"/);
});

test("structured research treats null optional evidence objects as omitted", () => {
  const envelope = (leads) => `<jarvis-leads>${JSON.stringify({ leads })}</jarvis-leads>`;
  const parsed = r.parseJarvisResearch(envelope([candidate({
    segment: "info_exec",
    persona: "ecommerce_owner",
    sourcingLane: "dtc_shopify",
    watchList: "customers, platforms, inventory and competitors",
    newsBurden: burden(2, 2, 2, 2),
    shopifyEvidence: null,
    opportunityNeedEvidence: "",
    informationNeedEvidence: null,
    whyNow: null,
    companyFit: null,
    reachability: "",
  })]), "info_exec");
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.rejected, 0);
  assert.equal(parsed.candidates[0].whyNow, undefined);
  assert.equal(parsed.candidates[0].companyFit, undefined);
});

test("email source check is bounded, rejects private hosts and only confirms an exact published address", async () => {
  const signal = new AbortController().signal;
  const fetcher = async () => new Response('<p>Contact ada@example.com</p>', { headers: { "Content-Type": "text/html" } });
  assert.ok((await r.checkJarvisEmailSources([candidate()], signal, fetcher)).has("ada@example.com"));
  const mailtoWithQuery = async () => new Response('<a href="mailto:ada@example.com?subject=Hello">Email Ada</a>', { headers: { "Content-Type": "text/html" } });
  assert.ok((await r.checkJarvisEmailSources([candidate()], signal, mailtoWithQuery)).has("ada@example.com"));
  for (const body of ["notada@example.com", "<script>const x = 'ada@example.com';</script>", "<p>no email</p>"]) {
    assert.equal((await r.checkJarvisEmailSources([candidate()], signal, async () => new Response(body, { headers: { "Content-Type": "text/html" } }))).size, 0);
  }
  const largePublicPage = `<p>${"x".repeat(600_000)}</p><p>Contact ada@example.com</p>`;
  assert.ok((await r.checkJarvisEmailSources([candidate()], signal, async () => new Response(largePublicPage, { headers: { "Content-Type": "text/html" } }))).has("ada@example.com"));
  const overLimitPage = `<p>${"x".repeat(2 * 1024 * 1024)}</p><p>Contact ada@example.com</p>`;
  assert.equal((await r.checkJarvisEmailSources([candidate()], signal, async () => new Response(overLimitPage, { headers: { "Content-Type": "text/html" } }))).size, 0);
  let called = false;
  assert.equal((await r.checkJarvisEmailSources([candidate({ emailSource: "http://localhost/secret" })], signal, async () => { called = true; return fetcher(); })).size, 0);
  assert.equal(called, false);
});

test("drafts use the approved short first-contact copy and retain custom opener support", () => {
  const draft = d.jarvisDraft(candidate({ name: "Dr. Ada Example" }));
  assert.match(draft.body, /^Hi Ada,/);
  assert.match(draft.body, /personal intelligence filter/);
  assert.match(draft.body, /Grants and fellowships can be one use case/);
  assert.match(draft.body, /deserves your attention/);
  assert.match(draft.body, /https:\/\/your-secretary\.com/);
  assert.doesNotMatch(draft.body, /CMU|AI product|free.*trial|trying an early version/);
  assert.ok(draft.body.endsWith("https://www.linkedin.com/in/chi-cheng921/"));
  const custom = { subject: "Question", body: "{{opener}}" };
  assert.match(d.jarvisDraft(candidate({ industry: "Behavioral health", opener: "" }), custom).body, /work in behavioral health\./);
  assert.match(d.jarvisDraft(candidate({ industry: "HVAC distribution", opener: "" }), custom).body, /work in HVAC distribution\./);
  assert.match(d.jarvisDraft(candidate({ area: "Midwest commercial real estate", opener: "" }), custom).body, /work in Midwest commercial real estate\./);
  assert.equal(d.jarvisDraft(candidate({ company: "Example, P.A.", role: "Managing Partner", opener: "" }), { subject: "Question", body: "{{shortOpener}}" }).body, "I came across your work as Managing Partner at Example, P.A.");
});

test("editable template file matches the default used for newly researched contacts", () => {
  const file = readFileSync(new URL("../../scripts/jarvis-email-template.txt", import.meta.url), "utf8").trimEnd();
  assert.equal(file, `Subject: ${d.DEFAULT_JARVIS_TEMPLATE.subject}\n\n${d.DEFAULT_JARVIS_TEMPLATE.body}`);
});

test("the HTML report escapes researched text and gates compose links on review", async () => {
  const { renderJarvisReport } = await import("../../lib/jarvis-report.ts");
  const lead = add({ name: "<script>x</script> Ada" });
  let html = renderJarvisReport(d.readJarvis());
  assert.ok(!html.includes("<script>x</script>"));
  assert.match(html, /Work: unknown/);
  assert.match(html, /Time zone: unknown/);
  assert.ok(!html.includes("mail.google.com"), "unreviewed drafts have no compose link");
  d.updateJarvisLead(lead.id, { reviewed: true });
  html = renderJarvisReport(d.readJarvis());
  assert.ok(html.includes("mail.google.com"));
});

test("a confirmed send without a recorded reply triggers a follow-up reminder after one full day", () => {
  const sent = "2026-09-01T12:00:00.000Z";
  const due = Date.parse(sent) + 24 * 60 * 60 * 1000;
  const lead = { ...add(), status: "sent", sentAt: sent };
  assert.equal(isJarvisFollowUpDue(lead, due - 1), false);
  assert.equal(isJarvisFollowUpDue(lead, due), true);
  assert.equal(isJarvisFollowUpDue({ ...lead, status: "replied", repliedAt: sent }, due), false);
  assert.equal(isJarvisFollowUpDue({ ...lead, status: "do_not_contact" }, due), false);
  assert.equal(isJarvisFollowUpDue({ ...lead, status: "bounced" }, due), false);
  assert.equal(isJarvisFollowUpDue({ ...lead, followedUpAt: sent }, due), false);
  assert.equal(isJarvisFollowUpDue({ ...lead, sentAt: "bad date" }, due), false);
  assert.throws(() => d.updateJarvisLead(lead.id, { followUp: true }), /sent contact/);
  d.updateJarvisLead(lead.id, { reviewed: true, status: "sent" });
  const statePath = join(root, "jarvis-discovery.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.leads[0].sentAt = new Date(Date.now() - 1_000).toISOString();
  writeFileSync(statePath, JSON.stringify(state));
  assert.equal(isJarvisFollowUpDue(d.readJarvis().leads[0]), false);
  state.leads[0].sentAt = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1_000).toISOString();
  writeFileSync(statePath, JSON.stringify(state));
  assert.equal(isJarvisFollowUpDue(d.readJarvis().leads[0]), true);
  const recorded = d.updateJarvisLead(lead.id, { followUp: true });
  assert.ok(recorded.followedUpAt);
  assert.equal(recorded.sentAt, state.leads[0].sentAt, "follow-up does not change original send time");
  assert.equal(isJarvisFollowUpDue(recorded), false);
  assert.throws(() => d.updateJarvisLead(lead.id, { followUp: true }), /prior follow-up/);
  const report = d.readJarvis();
  const early = add({ name: "Another Person", profileUrl: "https://example.com/early", email: "early@example.com", emailQuote: "early@example.com" });
  d.updateJarvisLead(early.id, { reviewed: true, status: "sent" });
  assert.throws(() => d.updateJarvisLead(early.id, { followUp: true }), /one-day wait/);
  const earlyState = JSON.parse(readFileSync(statePath, "utf8"));
  earlyState.leads.find((entry) => entry.id === early.id).sentAt = new Date(Date.now() - 2 * 86400000).toISOString();
  writeFileSync(statePath, JSON.stringify(earlyState));
  const earlyFollowedUp = d.updateJarvisLead(early.id, { followUp: true });
  assert.ok(earlyFollowedUp.followedUpAt, "an earlier manual follow-up prevents a false reminder");
  assert.equal(isJarvisFollowUpDue(earlyFollowedUp, Date.now() + 8 * 86400000), false);
  assert.equal(report.leads[0].followedUpAt, recorded.followedUpAt);
});

test("HTML export shows follow-ups due without treating a draft as a send", async () => {
  const { renderJarvisReport } = await import("../../lib/jarvis-report.ts");
  const sentAt = "2026-09-01T12:00:00.000Z";
  const lead = { ...add(), status: "sent", sentAt };
  const state = { ...d.readJarvis(), leads: [lead] };
  const after = new Date("2026-09-08T12:00:00.000Z");
  assert.match(renderJarvisReport(state, after), /follow-up due · no recorded reply/);
  assert.doesNotMatch(renderJarvisReport({ ...state, leads: [{ ...lead, repliedAt: sentAt }] }, after), /follow-up due · 7\+ days without recorded reply/);
});

test("list and HTML export put unsent email contacts first and sent contacts below missing emails", async () => {
  const base = add();
  const entries = [
    { ...base, id: "sent", name: "Sent Person", status: "sent", sentAt: "2026-09-01T12:00:00Z" },
    { ...base, id: "missing", name: "Missing Person", email: "", status: "new" },
    { ...base, id: "new", name: "New Person", status: "new" },
    { ...base, id: "ready", name: "Ready Person", status: "ready" },
    { ...base, id: "suppressed", name: "Suppressed Person", status: "do_not_contact" },
  ];
  const ordered = [...entries].sort((a, b) => jarvisListPriority(a) - jarvisListPriority(b));
  assert.deepEqual(ordered.map(({ id }) => id), ["ready", "new", "missing", "sent", "suppressed"]);
  const { renderJarvisReport } = await import("../../lib/jarvis-report.ts");
  const html = renderJarvisReport({ ...d.readJarvis(), leads: entries });
  const positions = ordered.map(({ name }) => html.indexOf(`<strong>${name}</strong>`));
  assert.ok(positions.every((at, i) => at >= 0 && (i === 0 || at > positions[i - 1])), "HTML report follows the same priority");
});

test("a new template rewrites only untouched drafts and rejects unknown placeholders", () => {
  const person = (name, email) => add({ name, email, emailQuote: `Email ${email}`, profileUrl: `https://example.com/${email}`, segment: "info_exec", persona: "ecommerce_owner", watchList: "customers, platforms, inventory, competitors and channels", newsBurden: burden(3, 3, 2, 2), ...sprint() });
  const legacy = add({ name: "Old Contact", email: "old@example.com", emailQuote: "old@example.com", profileUrl: "https://example.com/old" });
  const untouched = person("Ann One", "ann@example.com");
  const edited = person("Ben Two", "ben@example.com");
  const approved = person("Cy Three", "cy@example.com");
  const queued = person("Dan Four", "dan@example.com");
  const file = join(root, "jarvis-discovery.json");
  const stored = JSON.parse(readFileSync(file, "utf8"));
  stored.leads.find((lead) => lead.id === queued.id).queuedAt = new Date().toISOString();
  writeFileSync(file, JSON.stringify(stored));
  d.updateJarvisLead(edited.id, { body: "My own words" });
  markSourceFound(untouched.id);
  markSourceFound(approved.id);
  d.updateJarvisLead(approved.id, { icpReview: { verdict: "verified", reason: "Checked the founder and personal work email on source pages" } });
  d.updateJarvisLead(approved.id, { reviewed: true });
  assert.throws(() => d.setJarvisTemplate({ subject: "Hi", body: "Hello {{frstName}}\nhttps://your-secretary.com" }), /Unknown placeholder/);
  const preview = d.setJarvisTemplate({ subject: "For {{company}}", body: "Hello {{firstName}}, {{opener}}\nhttps://your-secretary.com" }, true);
  assert.equal(preview.updated, 1);
  assert.equal(d.readJarvis().leads.find((l) => l.id === untouched.id).subject, untouched.subject, "dry run writes nothing");
  assert.equal(d.setJarvisTemplate({ subject: "For {{company}}", body: "Hello {{firstName}}, {{opener}}\nhttps://your-secretary.com" }).updated, 1);
  const byId = (id) => d.readJarvis().leads.find((l) => l.id === id);
  assert.equal(byId(untouched.id).body, "Hello Ann, I came across your work as CTO of Example Inc.\nhttps://your-secretary.com");
  assert.equal(byId(untouched.id).subject, "For Example Inc");
  assert.equal(byId(edited.id).body, "My own words");
  assert.equal(byId(approved.id).reviewed, true);
  assert.equal(byId(queued.id).body, queued.body, "a queued draft is never replaced, even if still new and unreviewed");
  assert.equal(byId(legacy.id).body, legacy.body, "an untouched legacy draft is retained outside the new ICP");
  d.addJarvisCandidates([candidate({ name: "Dee Four", email: "dee@example.com", emailQuote: "dee@example.com", profileUrl: "https://example.com/d" })]);
  assert.equal(d.readJarvis().leads.at(-1).body, "Hello Dee, I came across your work as CTO of Example Inc.\nhttps://your-secretary.com", "new research uses the saved template");
});

test("strict ICP review is independent of model score and gates every outreach path", async () => {
  const lead = markSourceFound(add({ segment: "info_exec", persona: "ecommerce_owner", watchList: "customers, platforms, inventory, competitors and channels", newsBurden: burden(3, 3, 2, 2), socials: { linkedin: "https://www.linkedin.com/in/ada-example/" }, ...sprint() }).id);
  const { isVerifiedJarvisTarget, jarvisComposeLinks } = await import("./jarvis-shape.ts");
  assert.equal(isQualifiedInfoExec(lead), true);
  assert.equal(isVerifiedJarvisTarget(lead), false);
  assert.throws(() => d.updateJarvisLead(lead.id, { reviewed: true, status: "ready" }), /Verify this ICP/);
  assert.equal(d.queueJarvisLeads([{ id: lead.id, revision: lead.revision ?? 0 }]).skipped[0].reason, "Outreach needs human verification before sending");
  assert.throws(() => d.updateJarvisSocialOutreach(lead.id, { platform: "linkedin", op: "sent", revision: lead.revision ?? 0 }), /Review this ICP/);
  assert.throws(() => d.updateJarvisLead(lead.id, { icpReview: { verdict: "verified", reason: "" } }), /reason/);
  const verified = d.updateJarvisLead(lead.id, { icpReview: { verdict: "verified", reason: "Confirmed the own-brand founder and work route" } });
  assert.equal(isVerifiedJarvisTarget(verified), true);
  const ready = d.updateJarvisLead(lead.id, { reviewed: true, status: "ready" });
  assert.ok(jarvisComposeLinks(ready));
  const adjacent = d.updateJarvisLead(lead.id, { icpReview: { verdict: "adjacent", reason: "No current grant-eligible project" } });
  assert.equal(adjacent.icpReview.verdict, "adjacent");
  assert.equal(adjacent.reviewed, false);
  assert.equal(adjacent.queuedAt, undefined);
  assert.equal(jarvisComposeLinks(adjacent), null);
  assert.throws(() => d.claimJarvisSend(lead.id, adjacent.revision), /not approved/);
  assert.equal(d.queueJarvisLeads([{ id: lead.id, revision: adjacent.revision }]).skipped[0].reason, "Outreach needs human verification before sending");
  const oldSend = { ...adjacent, status: "sent", sentAt: new Date(Date.now() - 8 * 86400000).toISOString() };
  assert.equal(isJarvisFollowUpDue(oldSend), false, "downgraded strict contacts cannot receive an automatic follow-up");
  assert.equal(isJarvisFollowUpDue({ ...oldSend, icpReview: verified.icpReview }), true);
  const html = (await import("../../lib/jarvis-report.ts")).renderJarvisReport(d.readJarvis());
  assert.match(html, /ICP: adjacent/);
  assert.match(html, /data-target="false"/);
});

test("card-reviewed email batches commit atomically; Instagram approval saves drafts but never sends", () => {
  const make = (name, mail = true) => {
    const lead = add({ name, profileUrl: `https://example.com/${name.toLowerCase()}`, socials: { instagram: `https://www.instagram.com/${name.toLowerCase()}/` }, ...(mail ? { email: `${name.toLowerCase()}@example.com`, emailSource: `https://example.com/${name.toLowerCase()}`, emailQuote: `${name.toLowerCase()}@example.com` } : { email: "", emailSource: "", emailQuote: "" }) });
    // An existing pre-v4 lead remains interviewable after a human checks its source.
    const file = join(root, "jarvis-discovery.json"), state = JSON.parse(readFileSync(file, "utf8"));
    Object.assign(state.leads.find((item) => item.id === lead.id), { segment: "info_exec", persona: "ecommerce_owner", assessedVersion: 6, watchList: "customers, platforms, inventory, competitors and channels", newsBurden: burden(3, 3, 2, 2), ...sprint() });
    writeFileSync(file, JSON.stringify(state));
    return d.readJarvis().leads.find((item) => item.id === lead.id);
  };
  const one = markSourceFound(make("Ann").id), two = markSourceFound(make("Ben").id);
  const emailItem = (lead) => ({ id: lead.id, revision: lead.revision ?? 0, route: lead.email, source: lead.emailSource, subject: `Question for ${lead.name}`, body: "Could I ask you about your workflow?\n\nhttps://your-secretary.com", identityChecked: true, draftChecked: true });
  assert.throws(() => d.prepareJarvisOutreachBatch({ confirmed: true, channel: "email", items: [emailItem(one), { ...emailItem(two), source: "https://example.com/wrong" }] }), /source changed/);
  assert.equal(d.readJarvis().leads.filter((lead) => lead.queuedAt).length, 0, "a bad second card must not queue the first");
  assert.throws(() => d.prepareJarvisOutreachBatch({ confirmed: true, channel: "email", items: [emailItem(one), emailItem(one)] }), /Duplicate/);
  assert.throws(() => d.prepareJarvisOutreachBatch({ confirmed: true, channel: "email", items: [{ ...emailItem(one), draftChecked: false }] }), /needs review/);
  assert.deepEqual(d.prepareJarvisOutreachBatch({ confirmed: true, channel: "email", items: [emailItem(one), emailItem(two)] }), { prepared: 2, channel: "email" });
  const saved = d.readJarvis().leads.find((lead) => lead.id === one.id);
  assert.equal(saved.icpReview, undefined, "general outreach never rewrites product ICP classification");
  assert.equal(saved.outreachApproval.channel, "email");
  assert.equal(saved.status, "ready");
  assert.equal(saved.subject, "Question for Ann");
  assert.ok(saved.queuedAt);
  assert.equal(saved.sentAt, undefined, "the outbox, not batch approval, sends email");
  assert.throws(() => d.prepareJarvisOutreachBatch({ confirmed: true, channel: "email", items: [emailItem(one)] }), /changed/);
  const social = make("Cara", false);
  const adjacent = d.updateJarvisLead(social.id, { icpReview: { verdict: "adjacent", reason: "Not in an older product's ICP" } });
  const instagram = { id: social.id, revision: adjacent.revision ?? 0, route: social.socials.instagram, source: "", draft: "Could we talk for 15 minutes?\n\nhttps://your-secretary.com", identityChecked: true, draftChecked: true };
  assert.deepEqual(d.prepareJarvisOutreachBatch({ confirmed: true, channel: "instagram", items: [instagram] }), { prepared: 1, channel: "instagram" });
  const prepared = d.readJarvis().leads.find((lead) => lead.id === social.id);
  assert.equal(prepared.socialOutreach.instagram.draft, instagram.draft);
  assert.equal(prepared.socialOutreach.instagram.sentAt, undefined);
  assert.equal(prepared.queuedAt, undefined);
  assert.equal(prepared.icpReview.verdict, "adjacent", "general outreach preserves a different product's ICP classification");
  assert.equal(prepared.outreachApproval.channel, "instagram");
  const logged = d.updateJarvisSocialOutreach(social.id, { platform: "instagram", op: "sent", revision: prepared.revision });
  assert.equal(logged.socialOutreach.instagram.sentText, instagram.draft, "an explicitly logged manual send keeps its exact text");
  const blocked = make("Dana", false);
  const card = { id: blocked.id, revision: blocked.revision ?? 0, route: blocked.socials.instagram, draft: "Hi Dana\n\nhttps://your-secretary.com", identityChecked: true, draftChecked: true };
  d.prepareJarvisOutreachBatch({ confirmed: true, channel: "instagram", items: [card] });
  const first = d.readJarvis().leads.find((lead) => lead.id === blocked.id);
  const skipped = d.updateJarvisSocialOutreach(blocked.id, { platform: "instagram", op: "skip", reason: "private", revision: first.revision });
  assert.equal(skipped.socialOutreach.instagram.skipReason, "private");
  assert.equal(skipped.socialOutreach.instagram.sentAt, undefined);
  assert.throws(() => d.updateJarvisSocialOutreach(blocked.id, { platform: "instagram", op: "sent", revision: skipped.revision }), /already be contacted or queued/);
  d.prepareJarvisOutreachBatch({ confirmed: true, channel: "instagram", items: [{ ...card, revision: skipped.revision }] });
  assert.equal(d.readJarvis().leads.find((lead) => lead.id === blocked.id).socialOutreach.instagram.skippedAt, undefined, "a new reviewed batch explicitly reopens a skipped profile");
});

test("the HTML report has per-draft copy buttons and a self-export button", async () => {
  const { renderJarvisReport } = await import("../../lib/jarvis-report.ts");
  add();
  const html = renderJarvisReport(d.readJarvis());
  assert.match(html, /data-copy="ada@example.com">Copy email/);
  assert.match(html, />Copy body</);
  assert.match(html, /id="export">Export HTML</);
});

test("the HTML report's inline script parses", async () => {
  const { renderJarvisReport } = await import("../../lib/jarvis-report.ts");
  add();
  const script = renderJarvisReport(d.readJarvis()).match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(script));
});

function markSourceFound(id) {
  const file = join(root, "jarvis-discovery.json");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  raw.leads.find((lead) => lead.id === id).emailCheck = "source_found";
  writeFileSync(file, JSON.stringify(raw));
  return d.readJarvis().leads.find((lead) => lead.id === id);
}
function qualify(id) {
  d.applyJarvisAssessment(id, { persona: "ecommerce_owner", watchList: "customers, platforms, inventory, competitors and channels", newsBurden: burden(3, 3, 2, 2) });
  const file = join(root, "jarvis-discovery.json");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  Object.assign(raw.leads.find((lead) => lead.id === id), { segment: "info_exec", ...sprint() });
  writeFileSync(file, JSON.stringify(raw));
  return d.readJarvis().leads.find((lead) => lead.id === id);
}
function queueable(extra = {}) {
  const sourced = markSourceFound(qualify(add(extra).id).id);
  const verified = d.updateJarvisLead(sourced.id, {
    icpReview: { verdict: "verified", reason: "Current role, cross-source need, why-now and contact route checked." },
  });
  return verified.email && verified.emailCheck === "source_found"
    ? d.updateJarvisLead(verified.id, { reviewed: true, status: "ready" })
    : verified;
}

test("social drafts are editable, manual outreach is logged separately, and email cannot double-contact", () => {
  const lead = queueable({ socials: { linkedin: "https://www.linkedin.com/in/ada-example/" } });
  const save = d.updateJarvisSocialOutreach(lead.id, { platform: "linkedin", op: "save", revision: lead.revision ?? 0, draft: "Hi Ada, may I get your feedback?\n\nhttps://your-secretary.com" });
  assert.equal(save.socialOutreach.linkedin.sentAt, undefined, "saving does not send");
  assert.throws(() => d.updateJarvisSocialOutreach(lead.id, { platform: "linkedin", op: "sent", revision: lead.revision ?? 0 }), /changed/, "stale actions cannot mark a message sent");
  const ready = d.updateJarvisLead(lead.id, { reviewed: true, status: "ready" });
  const sent = d.updateJarvisSocialOutreach(lead.id, { platform: "linkedin", op: "sent", revision: ready.revision });
  assert.equal(sent.socialOutreach.linkedin.sentText, "Hi Ada, may I get your feedback?\n\nhttps://your-secretary.com");
  assert.equal(jarvisComposeLinks(sent), null, "a manual social contact hides email compose links");
  assert.throws(() => d.claimJarvisSend(lead.id, sent.revision), /not approved/, "manual email send cannot duplicate social outreach");
  const edited = d.updateJarvisSocialOutreach(lead.id, { platform: "linkedin", op: "save", revision: sent.revision, draft: "Updated for next time\n\nhttps://your-secretary.com" });
  assert.equal(edited.socialOutreach.linkedin.sentText, "Hi Ada, may I get your feedback?\n\nhttps://your-secretary.com", "sent text stays in history after an edit");
  assert.equal(d.queueJarvisLeads([{ id: lead.id, revision: edited.revision }]).skipped[0].reason, "already contacted on social media");
  assert.throws(() => d.updateJarvisSocialOutreach(lead.id, { platform: "linkedin", op: "sent", revision: edited.revision }), /already be contacted/);
  const reply = d.updateJarvisSocialOutreach(lead.id, { platform: "linkedin", op: "replied", revision: edited.revision });
  assert.ok(reply.socialOutreach.linkedin.repliedAt);
  assert.equal(reply.sentAt, undefined, "social outreach does not masquerade as a sent email");
});

test("batch approval queues only unchanged, source-confirmed, uncontacted contacts; any edit dequeues", () => {
  const ok = queueable();
  const unconfirmed = qualify(add({ name: "Bo Example", email: "bo@example.com", emailQuote: "bo@example.com" }).id);
  const stale = queueable({ name: "Cy Example", email: "cy@example.com", emailQuote: "cy@example.com" });
  const result = d.queueJarvisLeads([{ id: ok.id, revision: ok.revision ?? 0 }, { id: unconfirmed.id, revision: unconfirmed.revision ?? 0 }, { id: stale.id, revision: (stale.revision ?? 0) + 5 }]);
  assert.equal(result.queued, 1);
  assert.deepEqual(result.skipped.map((item) => item.reason), ["Outreach needs human verification before sending", "changed since loaded"]);
  const queued = d.readJarvis().leads.find((lead) => lead.id === ok.id);
  assert.equal(queued.status, "ready");
  assert.equal(queued.reviewed, true);
  assert.ok(queued.queuedAt);
  d.updateJarvisLead(ok.id, { body: "An edited body" });
  const edited = d.readJarvis().leads.find((lead) => lead.id === ok.id);
  assert.equal(edited.queuedAt, undefined, "editing what was approved takes it out of the queue");
  assert.equal(edited.status, "new");
});

test("the outbox claims the oldest queued contact once, and records its Gmail thread", () => {
  const first = queueable();
  const second = queueable({ name: "Bo Example", email: "bo@example.com", emailQuote: "bo@example.com" });
  d.queueJarvisLeads([{ id: first.id, revision: first.revision ?? 0 }]);
  d.queueJarvisLeads([{ id: second.id, revision: second.revision ?? 0 }]);
  assert.equal(d.claimQueuedJarvisSend(() => false), null, "outside every recipient's window nothing is claimed");
  const claimedAt = "2026-10-04T12:00:00.000Z";
  const claim = d.claimQueuedJarvisSend(() => true, undefined, claimedAt);
  assert.equal(claim.id, first.id);
  assert.equal(d.readJarvisOutbox().lastSendAt, claimedAt, "claiming reserves the persisted pacing window before Gmail is called");
  assert.equal(d.claimQueuedJarvisSend().id, second.id, "a pending claim is never claimed twice");
  assert.equal(d.claimQueuedJarvisSend(), null);
  d.finishJarvisSend(claim.id, claim.attemptId, "gmail-1", "thread-1");
  const sent = d.readJarvis().leads.find((lead) => lead.id === first.id);
  assert.equal(sent.status, "sent");
  assert.equal(sent.sendAttempt.threadId, "thread-1");
  assert.equal(sent.queuedAt, undefined);
});

function sentLead(daysAgo, extra = {}) {
  const lead = queueable(extra);
  d.queueJarvisLeads([{ id: lead.id, revision: lead.revision ?? 0 }]);
  const claim = d.claimQueuedJarvisSend((entry) => entry.id === lead.id);
  d.finishJarvisSend(claim.id, claim.attemptId, `gmail-${lead.id}`, `thread-${lead.id}`);
  const file = join(root, "jarvis-discovery.json");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  raw.leads.find((entry) => entry.id === lead.id).sentAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
  writeFileSync(file, JSON.stringify(raw));
  return lead.id;
}

test("one automatic follow-up after one full day, only after a fresh thread check and no reply", () => {
  const id = sentLead(2);
  assert.equal(d.claimJarvisFollowUp(), null, "never without a recent thread check");
  d.recordJarvisThread(id, { outcome: "none" });
  const claim = d.claimJarvisFollowUp();
  assert.equal(claim.id, id);
  assert.equal(claim.subject, `Re: ${d.readJarvis().leads.find(l => l.id === id).subject}`);
  assert.match(claim.body, /^Hi Ada,/);
  assert.match(claim.body, /won't follow up again/);
  assert.equal(claim.threadId, `thread-${id}`);
  assert.equal(d.claimJarvisFollowUp(), null, "claimed once");
  d.finishJarvisFollowUp(id, claim.attemptId);
  const lead = d.readJarvis().leads[0];
  assert.equal(lead.followUpAttempt.state, "uncertain");
  assert.ok(lead.followedUpAt, "an uncertain follow-up still counts, so it is never retried");
  const recent = sentLead(0, { name: "Bo Example", email: "bo@example.com", emailQuote: "bo@example.com" });
  d.recordJarvisThread(recent, { outcome: "none" });
  assert.equal(d.claimJarvisFollowUp(), null, "a fresh first send must wait at least one full day");
});

test("a reply or bounce in the thread updates the status and ends the follow-up", () => {
  const replied = sentLead(8);
  const bounced = sentLead(8, { name: "Bo Example", email: "bo@example.com", emailQuote: "bo@example.com" });
  d.recordJarvisThread(replied, { outcome: "replied", at: "2026-09-25T10:00:00.000Z" });
  d.recordJarvisThread(bounced, { outcome: "bounced" });
  const [a, b] = d.readJarvis().leads;
  assert.equal(a.status, "replied");
  assert.equal(a.repliedAt, "2026-09-25T10:00:00.000Z");
  assert.equal(b.status, "bounced");
  assert.equal(d.claimJarvisFollowUp(), null);
});

test("rescoring sets persona and scores; none clears the persona but keeps the scores", () => {
  const lead = add();
  const burden = { change: { score: 3, evidence: "a" }, breadth: { score: 3, evidence: "b" }, unfiltered: { score: 2, evidence: "c" }, footprint: { score: 2, evidence: "d" } };
  assert.throws(() => d.applyJarvisAssessment(lead.id, { persona: "ecommerce_owner", newsBurden: burden }), /watchList/, "a persona needs a named watch list");
  assert.equal(d.applyJarvisAssessment(lead.id, { persona: "ecommerce_owner", watchList: "customers, platforms, inventory, competitors and channels", newsBurden: burden }), true);
  let saved = d.readJarvis().leads[0];
  assert.equal(saved.persona, "ecommerce_owner");
  assert.equal(saved.watchList, "customers, platforms, inventory, competitors and channels");
  assert.equal(isQualifiedInfoExec(saved), false, "rescoring alone cannot invent current-project proof, a why-now event or sprint fit scores");
  assert.equal(isQualifiedInfoExec({ ...saved, assessedVersion: undefined }), false, "an assessment under the old rubric does not count");
  assert.ok(saved.assessedAt);
  d.applyJarvisAssessment(lead.id, { persona: "none", newsBurden: burden });
  saved = d.readJarvis().leads[0];
  assert.equal(saved.persona, undefined);
  assert.equal(saved.watchList, undefined);
  assert.equal(saved.newsBurden.change.score, 3);
  assert.throws(() => d.applyJarvisAssessment(lead.id, { persona: "ceo", newsBurden: burden }), /persona/);
  assert.equal(d.applyJarvisAssessment("missing", { persona: "ecommerce_owner", watchList: "x", newsBurden: burden }), false);
});

test("a follow-up is threaded with In-Reply-To and rejects header injection", async () => {
  const { encodeJarvisMessage } = await import("./jarvis-mail.ts");
  const mime = Buffer.from(encodeJarvisMessage("ada@example.com", "Re: Hi", "Body", "<abc@mail.gmail.com>"), "base64url").toString("utf8");
  assert.match(mime, /\r\nIn-Reply-To: <abc@mail.gmail.com>\r\nReferences: <abc@mail.gmail.com>\r\n/);
  assert.throws(() => encodeJarvisMessage("ada@example.com", "Re: Hi", "Body", "<a>\r\nBcc: x@example.com"), /In-Reply-To/);
});

test("outbox pacing keeps recipient-local time informational and counts sends plus follow-ups", async () => {
  const outbox = await import("../../lib/jarvis-outbox.ts");
  assert.equal(JARVIS_DELIVERY_POLICY.recipientWindowEnforced, false);
  assert.equal(JARVIS_DELIVERY_POLICY.followUpDelayHours, 24);
  assert.equal(outbox.isCurrentFollowUpIcp({ segment: "info_exec", persona: "ecommerce_owner", assessedVersion: 6, watchList: "customers and platforms", sourcingLane: "dtc_shopify", role: "Founder", profileUrl: "https://example.com/ada", evidence: "Current founder of Example Brand.", evidenceUrl: "https://example.com/about", informationNeedEvidence: { url: "https://example.com/need", quote: "Monitors customers and platforms." }, whyNow: { summary: "Launch", url: "https://example.com/now", quote: "Launched in 2026." }, companyFit: { score: 40 }, reachability: { score: 40 }, newsBurden: burden, socials: { instagram: "https://instagram.com/ada" }, status: "sent", email: "", emailCheck: "missing", emailSource: "", emailQuote: "" }), true);
  assert.equal(outbox.isCurrentFollowUpIcp({ segment: "clinic" }), false);
  assert.equal(outbox.isCurrentFollowUpIcp({ segment: "legal", persona: "legal_leader" }), false, "legacy cohorts are not revived by follow-up automation");
  const tuesday10NewYork = new Date("2026-09-29T14:00:00Z");
  assert.equal(outbox.inSendingWindow({}, tuesday10NewYork), true);
  assert.equal(outbox.inSendingWindow({ timeZone: "America/Los_Angeles" }, tuesday10NewYork), false, "7:00 in Los Angeles");
  assert.equal(outbox.inSendingWindow({}, new Date("2026-09-26T14:00:00Z")), false, "Saturday");
  const today = new Date().toISOString();
  const leads = [{ sendAttempt: { at: today } }, { sendAttempt: { at: "2020-01-01T12:00:00Z" }, followUpAttempt: { at: today } }, {}];
  assert.equal(outbox.sentToday({ leads }), 2);
  assert.equal(outbox.sentToday({ leads: [...leads, { sentAt: today }] }), 3, "a contact marked Sent by hand left the same Gmail and counts");
});

test("an outbox tick sends one queued contact, and a failed send pauses the outbox", async () => {
  const outbox = await import("../../lib/jarvis-outbox.ts");
  const tokenFile = join(root, "google-outreach.json");
  writeFileSync(tokenFile, JSON.stringify({ email: "personal@example.com", refreshToken: "r", accessToken: "test-token", accessTokenExpiresAt: Date.now() + 300000, connectedAt: new Date().toISOString(), scopes: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"] }));
  const oldFetch = globalThis.fetch;
  const sends = [];
  let fail = false;
  let expectedReservedAt;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/messages/send")) {
      if (expectedReservedAt) assert.equal(d.readJarvisOutbox().lastSendAt, expectedReservedAt, "pacing starts when delivery is claimed, after any reply sync");
      if (fail) return Response.json({ error: { message: "quota" } }, { status: 429 });
      sends.push(Buffer.from(JSON.parse(options.body).raw, "base64url").toString("utf8"));
      return Response.json({ id: `m${sends.length}`, threadId: `t${sends.length}` });
    }
    return Response.json({ messages: [] });
  };
  try {
    const a = queueable();
    const b = queueable({ name: "Bo Example", email: "bo@example.com", emailQuote: "bo@example.com" });
    d.queueJarvisLeads([{ id: a.id, revision: a.revision ?? 0 }, { id: b.id, revision: b.revision ?? 0 }]);
    const tuesday = new Date("2026-09-29T14:00:00Z");
    d.setJarvisOutbox({ startAt: "2026-09-29T15:00:00Z" });
    await outbox.tickJarvisOutbox(new Date("2026-09-26T14:00:00Z"));
    assert.equal(sends.length, 0, "scheduled start still gates an otherwise allowed weekend send");
    await outbox.tickJarvisOutbox(tuesday);
    assert.equal(sends.length, 0, "nothing before the scheduled start, even inside the window");
    assert.throws(() => d.setJarvisOutbox({ startAt: "tomorrow-ish" }), /startAt/);
    d.setJarvisOutbox({ startAt: null });
    assert.equal(d.readJarvisOutbox().startAt, undefined);
    expectedReservedAt = "2026-09-26T14:05:00.000Z";
    const deliveryNow = () => new Date(expectedReservedAt);
    await Promise.all([outbox.tickJarvisOutbox(new Date("2026-09-26T14:00:00Z"), deliveryNow), outbox.tickJarvisOutbox(new Date("2026-09-26T14:00:00Z"), deliveryNow)]);
    expectedReservedAt = undefined;
    assert.equal(sends.length, 1, "reviewed mail may send outside recipient business hours");
    assert.match(sends[0], /^To: ada@example.com/);
    d.setJarvisOutbox({ enabled: false });
    await outbox.tickJarvisOutbox(tuesday);
    assert.equal(sends.length, 1, "a paused outbox sends nothing");
    d.setJarvisOutbox({ enabled: true });
    fail = true;
    await outbox.tickJarvisOutbox(new Date(Date.now() + 7 * 60_000));
    const state = d.readJarvis();
    assert.match(state.outbox.pausedReason, /unconfirmed/);
    assert.equal(state.leads.find((lead) => lead.id === b.id).sendAttempt.state, "uncertain", "never retried automatically");
  } finally { globalThis.fetch = oldFetch; rmSync(tokenFile, { force: true }); }
});

test("research parsing salvages complete candidates from a malformed envelope and corrects the persona cohort", () => {
  const score = { score: 3, evidence: "sourced" };
  const lead = (name) => ({ ...candidate({ name, email: "", emailSource: "", emailQuote: "", socials: { linkedin: `https://www.linkedin.com/in/${name.toLowerCase().replace(/ /g, "-")}/` } }), segment: "Research", persona: "ecommerce_owner", watchList: "customers, platforms, inventory, competitors and channels", newsBurden: { change: score, breadth: score, unfiltered: score, footprint: score }, ...sprint() });
  const body = JSON.stringify({ leads: [lead("Ada One"), lead("Bo Two")] });
  const broken = `<jarvis-leads>${body.slice(0, -2)}}}</leads>`;
  const salvaged = r.parseJarvisResearch(broken, "info_exec");
  assert.deepEqual(salvaged.candidates.map((c) => [c.name, c.segment]), [["Ada One", "info_exec"], ["Bo Two", "info_exec"]]);
  assert.throws(() => r.parseJarvisResearch(`<jarvis-leads>${body}</jarvis-leads>`), /validation/, "outside a persona run, a wrong segment is still rejected");
  assert.throws(() => r.parseJarvisResearch("no envelope"), /structured/);
});

test("research normalizes common news-burden schema variants before validation", () => {
  const base = { ...candidate(), segment: "info_exec", persona: "ecommerce_owner", watchList: "customers, platforms, inventory, competitors and channels", ...sprint() };
  const objectVariant = Object.fromEntries(["change", "breadth", "unfiltered", "footprint"].map((key) => [key, { score: 2, justification: `${key} sourced reason` }]));
  const objectResult = r.parseJarvisResearch(`<jarvis-leads>${JSON.stringify({ leads: [{ ...base, newsBurden: objectVariant }] })}</jarvis-leads>`, "info_exec");
  assert.equal(objectResult.candidates[0].newsBurden.change.evidence, "change sourced reason");

  const arrayVariant = ["change", "breadth", "unfiltered", "footprint"].map((dimension) => ({ dimension, score: 2, justification: `${dimension} array reason` }));
  const arrayResult = r.parseJarvisResearch(`<jarvis-leads>${JSON.stringify({ leads: [{ ...base, newsBurden: arrayVariant }] })}</jarvis-leads>`, "info_exec");
  assert.equal(arrayResult.candidates[0].newsBurden.footprint.evidence, "footprint array reason");
});

test("research records discovery and public social routes; an unsourced note is dropped", () => {
  const withVia = d.parseJarvisCandidate(candidate({ socials: { linkedin: "https://www.linkedin.com/in/ada-example/", instagram: "https://instagram.com/examplebrand/" }, foundVia: { source: "HLTH 2026 speaker list", url: "https://example.com/speakers" } }));
  assert.equal(withVia.socials.linkedin, "https://www.linkedin.com/in/ada-example/");
  assert.equal(withVia.socials.instagram, "https://instagram.com/examplebrand/");
  assert.equal(withVia.foundVia.source, "HLTH 2026 speaker list");
  assert.equal(withVia.foundVia.url, "https://example.com/speakers");
  const bad = d.parseJarvisCandidate(candidate({ foundVia: { source: "somewhere", url: "javascript:alert(1)" } }));
  assert.equal(bad.foundVia, undefined);
  assert.equal(bad.name, "Ada Example");
});

test("social posts are distinct from profile routes and require a specific public URL", async () => {
  const post = { url: "https://www.linkedin.com/posts/ada-example_research-update-123/", quote: "We're beginning a new community research project." };
  assert.deepEqual(d.parseJarvisCandidate(candidate({ socialEvidence: post })).socialEvidence, post);
  const saved = add({ socialEvidence: post });
  assert.deepEqual(d.readJarvis().leads[0].socialEvidence, post);
  const { renderJarvisReport } = await import("../../lib/jarvis-report.ts");
  assert.match(renderJarvisReport({ ...d.readJarvis(), leads: [saved] }), /Public social post/);
  const blocked = d.parseJarvisCandidate(candidate({ socials: { linkedin: "https://linkedin.com/in/ada-example/" }, socialLoginRequired: ["linkedin"] }));
  assert.equal(blocked.socialEvidence, undefined);
  assert.deepEqual(blocked.socialLoginRequired, ["linkedin"]);
  assert.throws(() => d.parseJarvisCandidate(candidate({ socialLoginRequired: ["linkedin"] })), /saved social profile URL/);
  assert.throws(() => d.parseJarvisCandidate(candidate({ socials: { linkedin: "https://linkedin.com/in/ada-example/" }, socialLoginRequired: ["instagram"] })), /saved social profile URL/);
  assert.throws(() => d.parseJarvisCandidate(candidate({ socialEvidence: { ...post, url: "https://linkedin.com/in/ada-example/" } })), /post URL/);
  assert.throws(() => d.parseJarvisCandidate(candidate({ socialEvidence: { ...post, url: "https://example.com/posts/123" } })), /post URL/);
  const prompt = r.jarvisResearchPrompt([], "info_exec", 3, "ecommerce_owner", false, "dtc_shopify");
  assert.match(prompt, /either a sourced individual work email or a trustworthy PERSONAL Instagram/);
  assert.match(r.JARVIS_RESEARCH_PREAMBLE, /do not log in or bypass/);
});

test("syncing to Jarvis.day writes the same HTML the page serves", async () => {
  const { renderJarvisReport, writeJarvisDayReport } = await import("../../lib/jarvis-report.ts");
  add();
  const path = join(root, "Jarvis_Day", "outreach", "candidates.html");
  const result = writeJarvisDayReport(d.readJarvis(), path);
  assert.equal(result.contacts, 1);
  const html = readFileSync(path, "utf8");
  assert.match(html, /Ada Example/);
  assert.equal(html.replace(/Generated [^<]*UTC/, ""), renderJarvisReport(d.readJarvis()).replace(/Generated [^<]*UTC/, ""));
});

test("tiers: A is the strict target user, B any current executive above the quality floor", () => {
  const lead = (extra) => ({ id: "x", status: "new", role: "Chief Executive Officer", industry: "Research", company: "Acme", assessedVersion: 6, newsBurden: burden(2, 2, 1, 1), ...extra });
  assert.equal(jarvisTier(lead({})), "B");
  assert.equal(jarvisTier(lead({ persona: "ecommerce_owner", watchList: "customers, platforms, inventory, competitors and channels", newsBurden: burden(3, 3, 2, 2), ...sprint() })), "A");
  assert.equal(jarvisTier(lead({ newsBurden: burden(2, 1, 1, 1) })), null, "5/12 is under the floor");
  assert.equal(jarvisTier(lead({ newsBurden: burden(0, 3, 3, 3) })), null, "a static field is under the floor");
  assert.equal(jarvisTier(lead({ industry: "Banking trade association" })), null, "associations are a channel");
  assert.equal(jarvisTier(lead({ assessedVersion: undefined })), null, "only current-rubric scores count");
  assert.equal(jarvisTier(lead({ role: "Member; former Managing Partner" })), null);
  assert.equal(isJarvisExecutive({ role: "Principal Machine Learning Engineer" }), false);
  assert.equal(isJarvisExecutive({ role: "Principal, Owner" }), true);
  assert.equal(isJarvisExecutive({ role: "Professor; Head of Lab" }), false);
});

test("a wide-net batch keeps scored executives without a persona; a normal batch still requires one", () => {
  const exec = { ...candidate({ segment: "info_exec" }), newsBurden: burden(2, 2, 1, 1), persona: "none", watchList: "" };
  assert.throws(() => d.parseJarvisCandidate(exec), /persona/);
  const wide = d.parseJarvisCandidate(exec, { wide: true });
  assert.equal(wide.persona, undefined);
  assert.equal(wide.newsBurden.change.score, 2);
  assert.match(r.jarvisResearchPrompt([], "info_exec", 3, "ecommerce_owner", true), /WIDE NET/);
  assert.match(r.jarvisResearchPrompt([], "info_exec", 3, "ecommerce_owner", true), /email is REQUIRED/);
});


test("batch review accepts more than twenty people", () => {
  Array.from({ length: 25 }, (_, i) => d.addJarvisCandidates([candidate({ name: `Person ${i}`, email: `person${i}@example.com`, emailQuote: `Contact person${i}@example.com`, profileUrl: `https://example.com/person/${i}`, socials: { linkedin: `https://www.linkedin.com/in/person${i}` } })]));
  const items = d.readJarvis().leads.map(lead => ({ id: lead.id, revision: lead.revision ?? 0, route: lead.socials.linkedin, draft: "We're building a product. Would you share your feedback?\n\nhttps://your-secretary.com", identityChecked: true, draftChecked: true }));
  assert.equal(items.length, 25);
  assert.equal(d.prepareJarvisOutreachBatch({ channel: "linkedin", confirmed: true, items }).prepared, 25);
});

test("legacy unsent copy is unnamed and re-reviewed while sent history stays intact", () => {
  const lead = add();
  const state = d.readJarvis();
  const current = state.leads[0];
  current.subject = "Feedback on Jarvis?";
  current.body = "We're building Jarvis.";
  current.reviewed = true;
  current.queuedAt = new Date().toISOString();
  current.socialOutreach = { linkedin: { draft: "Try Jarvis" }, instagram: { draft: "Try Jarvis", sentText: "Try Jarvis", sentAt: new Date().toISOString() } };
  writeFileSync(join(root, "jarvis-discovery.json"), JSON.stringify(state));
  const view = d.readJarvis().leads[0];
  assert.doesNotMatch(view.body, /Jarvis/i);
  assert.doesNotMatch(view.socialOutreach.linkedin.draft, /Jarvis/i);
  assert.equal(view.socialOutreach.instagram.sentText, "Try Jarvis");
  assert.equal(view.queuedAt, undefined);
  assert.equal(view.reviewed, false);
  assert.equal(view.revision, (lead.revision ?? 0) + 1);
  d.updateJarvisLead(lead.id, { notes: "Persist draft view" });
  assert.equal(d.readJarvis().leads[0].body, view.body);
});

test("unnamed legacy wording stays natural and idempotent", () => {
  const source = "We're building a product we’re building. Would you like to try a product we’re building?";
  const copy = outreach.unbrandedOutreachText(source);
  assert.equal(copy, "We're building a product. Would you like to try it?");
  assert.equal(outreach.unbrandedOutreachText(copy), copy);
  assert.equal(outreach.unbrandedOutreachText("Ideation page: https://jarvis.day"), "Ideation page: https://your-secretary.com");
  assert.equal(outreach.unbrandedOutreachText("Ideation page: https://a product we’re building"), "Ideation page: https://your-secretary.com");
});

test("final outreach guard rejects the retired link and grant-only positioning", () => {
  assert.throws(() => outreach.assertCurrentOutreachCopy("See https://jarvis.day"), /retired jarvis\.day/);
  assert.throws(() => outreach.assertCurrentOutreachCopy("We're building a personal intelligence filter for people pursuing grants and fellowships.\nhttps://your-secretary.com"), /grant-only/);
  assert.doesNotThrow(() => outreach.assertCurrentOutreachCopy("We filter the cross-source updates that matter to your work. Grants can be one example.\nhttps://your-secretary.com"));
});

test("follow-up template validates placeholders and persists independently", () => {
  assert.match(d.DEFAULT_JARVIS_FOLLOW_UP, /personal intelligence filter/);
  assert.throws(() => d.setJarvisFollowUpTemplate("Hi {{fristName}}"), /Unknown placeholder/);
  assert.throws(() => d.setJarvisFollowUpTemplate(""), /body/);
  const original = d.DEFAULT_JARVIS_TEMPLATE.body;
  d.setJarvisFollowUpTemplate("Hi {{firstName}}, interested in trying it?\n\nhttps://your-secretary.com");
  assert.equal(d.readJarvis().followUpTemplate, "Hi {{firstName}}, interested in trying it?\n\nhttps://your-secretary.com");
  assert.equal(d.DEFAULT_JARVIS_TEMPLATE.body, original);
  assert.equal(d.jarvisDraft(candidate(), { subject: "Re: Hello", body: d.readJarvis().followUpTemplate }).body, "Hi Ada, interested in trying it?\n\nhttps://your-secretary.com");
});

test("persistent review queue approves email into manual send queue without starting outbox", () => {
  const lead = queueable();
  assert.equal(d.updateOutreachReviewQueue({ op: "add", ids: [lead.id, lead.id] }).added, 1);
  let saved = d.readJarvis().leads[0];
  assert.equal(outreach.inReviewQueue(saved), true);
  assert.equal(d.updateOutreachReviewQueue({ op: "add", ids: [lead.id] }).added, 0);
  const item = { id: saved.id, revision: saved.revision, route: saved.email, source: saved.emailSource, subject: saved.subject, body: saved.body, identityChecked: true, draftChecked: true };
  d.prepareJarvisOutreachBatch({ channel: "email", confirmed: true, items: [item] }, false);
  saved = d.readJarvis().leads[0];
  assert.equal(saved.queuedAt, undefined);
  assert.equal(saved.sendAttempt, undefined);
  assert.equal(outreach.inSendQueue(saved), true);
  assert.equal(outreach.inReviewQueue(saved), false);
  assert.equal(d.updateOutreachReviewQueue({ op: "add", ids: [lead.id] }).added, 0);
  assert.equal(outreach.inSendQueue(d.readJarvis().leads[0]), true);
  d.updateJarvisLead(lead.id, { body: "Edited email\n\nhttps://your-secretary.com" });
  assert.equal(outreach.inSendQueue(d.readJarvis().leads[0]), false);
  assert.equal(outreach.inReviewQueue(d.readJarvis().leads[0]), true);
  saved = d.readJarvis().leads[0];
  d.prepareJarvisOutreachBatch({ channel: "email", confirmed: true, items: [{ ...item, revision: saved.revision, body: saved.body }] }, false);
  assert.equal(outreach.inSendQueue(d.readJarvis().leads[0]), true);
});

test("review selection accepts social-only contacts and can be removed or reopened", () => {
  const lead = add({ email: "", emailSource: "", emailQuote: "", socials: { linkedin: "https://www.linkedin.com/in/ada" } });
  d.updateOutreachReviewQueue({ op: "add", ids: [lead.id] });
  let saved = d.readJarvis().leads[0];
  d.prepareJarvisOutreachBatch({ channel: "linkedin", confirmed: true, items: [{ id: saved.id, revision: saved.revision, route: saved.socials.linkedin, draft: "Hello Ada\n\nhttps://your-secretary.com", identityChecked: true, draftChecked: true }] }, false);
  assert.equal(outreach.inSendQueue(d.readJarvis().leads[0]), true);
  d.updateOutreachReviewQueue({ op: "reopen", ids: [lead.id] });
  saved = d.readJarvis().leads[0];
  assert.equal(saved.outreachApproval, undefined);
  assert.equal(outreach.inReviewQueue(saved), true);
  d.updateOutreachReviewQueue({ op: "remove", ids: [lead.id] });
  assert.equal(outreach.inReviewQueue(d.readJarvis().leads[0]), false);
});

for (const emailFirst of [true, false]) {
  test(`multi-platform send plan preserves remaining channels, email first=${emailFirst}`, () => {
    const lead = queueable({ socials: { linkedin: "https://www.linkedin.com/in/ada", instagram: "https://www.instagram.com/ada/" } });
    d.updateOutreachReviewQueue({ op: "add", ids: [lead.id] });
    let saved = d.readJarvis().leads[0];
    d.prepareJarvisOutreachBatch({ channel: "email", confirmed: true, items: [{ id: saved.id, revision: saved.revision, route: saved.email, source: saved.emailSource, subject: saved.subject, body: saved.body, identityChecked: true, draftChecked: true }] }, false);
    const plan = (platform) => {
      saved = d.readJarvis().leads[0];
      d.planOutreachChannel({ id: saved.id, revision: saved.revision, confirmed: true, channel: platform, route: saved.socials[platform], body: `Hello on ${platform}\n\nhttps://your-secretary.com` });
    };
    plan("linkedin");
    plan("instagram");
    saved = d.readJarvis().leads[0];
    assert.equal(outreach.hasApprovedChannelPlan(saved, "email"), true, "another platform does not revoke email approval");
    assert.equal(saved.queuedAt, undefined);
    const sendEmail = () => {
      saved = d.readJarvis().leads[0];
      const claim = d.claimJarvisSend(saved.id, saved.revision);
      d.finishJarvisSend(saved.id, claim.attemptId, "fake-message", "fake-thread");
    };
    const logSocial = (platform) => {
      saved = d.readJarvis().leads[0];
      d.updateJarvisSocialOutreach(saved.id, { op: "sent", platform, revision: saved.revision });
    };
    if (emailFirst) sendEmail(); else logSocial("linkedin");
    assert.equal(outreach.inSendQueue(d.readJarvis().leads[0]), true);
    if (emailFirst) logSocial("linkedin"); else sendEmail();
    assert.equal(outreach.inSendQueue(d.readJarvis().leads[0]), true);
    logSocial("instagram");
    saved = d.readJarvis().leads[0];
    assert.equal(outreach.inSendQueue(saved), false);
    assert.ok(saved.sentAt);
    assert.equal(saved.socialOutreach.linkedin.sentText, "Hello on linkedin\n\nhttps://your-secretary.com");
    assert.equal(saved.socialOutreach.instagram.sentText, "Hello on instagram\n\nhttps://your-secretary.com");
    assert.throws(() => d.claimJarvisSend(saved.id, saved.revision), /already sent|not approved/);
    assert.throws(() => d.planOutreachChannel({ id: saved.id, revision: saved.revision, confirmed: true, channel: "linkedin", route: saved.socials.linkedin, body: "Duplicate\n\nhttps://your-secretary.com" }), /unsent available/);
    assert.throws(() => d.updateJarvisSocialOutreach(saved.id, { op: "sent", platform: "linkedin", revision: saved.revision }), /already be contacted/);
  });
}

test("changed channel copy and closed contacts cannot use a send plan", () => {
  const lead = queueable({ socials: { linkedin: "https://www.linkedin.com/in/ada" } });
  d.updateOutreachReviewQueue({ op: "add", ids: [lead.id] });
  let saved = d.readJarvis().leads[0];
  d.prepareJarvisOutreachBatch({ channel: "linkedin", confirmed: true, items: [{ id: saved.id, revision: saved.revision, route: saved.socials.linkedin, draft: "Reviewed message\n\nhttps://your-secretary.com", identityChecked: true, draftChecked: true }] }, false);
  saved = d.readJarvis().leads[0];
  assert.equal(outreach.hasApprovedChannelPlan({ ...saved, socialOutreach: { linkedin: { draft: "Changed" } } }, "linkedin"), false);
  assert.equal(outreach.hasApprovedChannelPlan({ ...saved, status: "do_not_contact" }, "linkedin"), false);
  assert.throws(() => d.planOutreachChannel({ id: saved.id, revision: saved.revision - 1, confirmed: true, channel: "linkedin", route: saved.socials.linkedin, body: "Changed\n\nhttps://your-secretary.com" }), /changed/);
});

for (const firstChannel of ["email", "linkedin"]) {
  test(`send queue retains unprepared contact routes after ${firstChannel}`, () => {
    let lead = queueable({ socials: { linkedin: "https://www.linkedin.com/in/ada", instagram: "https://www.instagram.com/ada/" } });
    d.updateOutreachReviewQueue({ op: "add", ids: [lead.id] });
    lead = d.readJarvis().leads[0];
    d.prepareJarvisOutreachBatch({ channel: firstChannel, confirmed: true, items: [{ id: lead.id, revision: lead.revision ?? 0, route: firstChannel === "email" ? lead.email : lead.socials.linkedin, source: lead.emailSource, subject: lead.subject, body: lead.body, draft: "Hello LinkedIn\n\nhttps://your-secretary.com", identityChecked: true, draftChecked: true }] }, false);
    const send = (channel) => {
      const saved = d.readJarvis().leads[0];
      if (channel === "email") {
        const claim = d.claimJarvisSend(saved.id, saved.revision);
        d.finishJarvisSend(saved.id, claim.attemptId, "fake-message", "fake-thread");
      } else d.updateJarvisSocialOutreach(saved.id, { op: "sent", platform: channel, revision: saved.revision });
    };
    send(firstChannel);
    let saved = d.readJarvis().leads[0];
    assert.equal(outreach.inSendQueue(saved), true, "unprepared channels keep the person in Send queue");
    const remaining = firstChannel === "email" ? ["linkedin", "instagram"] : ["email", "instagram"];
    assert.deepEqual(outreach.remainingOutreachChannels(saved), remaining);
    assert.equal(outreach.inSendQueue({ ...saved, status: "do_not_contact" }), false);
    assert.equal(outreach.inSendQueue({ ...saved, repliedAt: new Date().toISOString() }), false);
    assert.equal(outreach.inSendQueue({ ...saved, socialOutreach: { ...saved.socialOutreach, linkedin: { ...saved.socialOutreach?.linkedin, repliedAt: new Date().toISOString() } } }), false);
    for (const channel of remaining) {
      saved = d.readJarvis().leads[0];
      d.planOutreachChannel({ id: saved.id, revision: saved.revision, confirmed: true, channel, route: channel === "email" ? saved.email : saved.socials[channel], source: saved.emailSource, subject: saved.subject, body: `Hello on ${channel}\n\nhttps://your-secretary.com` });
      send(channel);
      assert.equal(outreach.inSendQueue(d.readJarvis().leads[0]), channel !== "instagram");
    }
    assert.deepEqual(outreach.remainingOutreachChannels(d.readJarvis().leads[0]), []);
  });
}

test("unreachable LinkedIn can be skipped while unprepared routes stay in the send queue", () => {
  const lead = queueable({ email: "", emailSource: "", emailQuote: "", socials: { linkedin: "https://www.linkedin.com/in/ada", instagram: "https://www.instagram.com/ada/" } });
  d.updateOutreachReviewQueue({ op: "add", ids: [lead.id] });
  let saved = d.readJarvis().leads[0];
  d.prepareJarvisOutreachBatch({ channel: "linkedin", confirmed: true, items: [{ id: saved.id, revision: saved.revision, route: saved.socials.linkedin, draft: "Hello Ada\n\nhttps://your-secretary.com", identityChecked: true, draftChecked: true }] }, false);
  saved = d.readJarvis().leads[0];
  saved = d.updateJarvisSocialOutreach(saved.id, { op: "skip", platform: "linkedin", reason: "cannot-dm", revision: saved.revision });
  assert.equal(saved.socialOutreach.linkedin.skipReason, "cannot-dm");
  assert.equal(saved.socialOutreach.linkedin.sentAt, undefined);
  assert.equal(outreach.hasApprovedChannelPlan(saved, "linkedin"), false);
  assert.equal(outreach.inSendQueue(saved), true);
  assert.deepEqual(outreach.remainingOutreachChannels(saved), ["instagram"]);
  assert.throws(() => d.updateJarvisSocialOutreach(saved.id, { op: "sent", platform: "linkedin", revision: saved.revision }), /already be contacted|Review this ICP/);
  saved = d.updateJarvisSocialOutreach(saved.id, { op: "skip", platform: "instagram", reason: "cannot-dm", revision: saved.revision });
  assert.equal(outreach.inSendQueue(saved), false, "all routes skipped completes queue without inventing sends");
  assert.equal(saved.socialOutreach.instagram.sentAt, undefined);
  d.planOutreachChannel({ id: saved.id, revision: saved.revision, confirmed: true, channel: "linkedin", route: saved.socials.linkedin, body: "Now reachable\n\nhttps://your-secretary.com" });
  saved = d.readJarvis().leads[0];
  assert.equal(saved.socialOutreach.linkedin.skippedAt, undefined);
  assert.equal(outreach.inSendQueue(saved), true);
});

test("LinkedIn connection requests wait separately, then acceptance restores messaging", () => {
  const lead = queueable({ socials: { linkedin: "https://www.linkedin.com/in/ada", instagram: "https://www.instagram.com/ada/" } });
  d.updateOutreachReviewQueue({ op: "add", ids: [lead.id] });
  let saved = d.readJarvis().leads[0];
  d.prepareJarvisOutreachBatch({ channel: "linkedin", confirmed: true, items: [{ id: saved.id, revision: saved.revision, route: saved.socials.linkedin, draft: "Hello Ada\n\nhttps://your-secretary.com", identityChecked: true, draftChecked: true }] }, false);
  saved = d.readJarvis().leads[0];
  const request = { op: "requested", route: saved.socials.linkedin, revision: saved.revision };
  saved = d.updateLinkedInConnection(saved.id, request);
  assert.ok(saved.linkedinConnection.requestedAt);
  assert.equal(saved.socialOutreach.linkedin.sentAt, undefined);
  assert.equal(outreach.isLinkedInConnectionPending(saved), true);
  assert.equal(outreach.canPlanChannel(saved, "linkedin"), false);
  assert.equal(outreach.inReviewQueue({ ...saved, email: "", socials: { linkedin: saved.socials.linkedin } }), false, "pending invitations do not return to Review queue");
  assert.equal(outreach.inSendQueue(saved), true, "other contact routes remain available");
  assert.throws(() => d.updateLinkedInConnection(saved.id, request), /changed/);
  assert.throws(() => d.updateLinkedInConnection(saved.id, { ...request, revision: saved.revision }), /already recorded/);
  assert.throws(() => d.updateJarvisSocialOutreach(saved.id, { op: "sent", platform: "linkedin", revision: saved.revision }), /Wait for/);
  assert.throws(() => d.updateLinkedInConnection(saved.id, { op: "accepted", route: "https://linkedin.com/in/other", revision: saved.revision }), /profile first/);
  assert.equal(outreach.inSendQueue({ ...saved, email: "", socials: { linkedin: saved.socials.linkedin } }), false, "LinkedIn-only contact waits outside Send queue");
  saved = d.updateLinkedInConnection(saved.id, { op: "accepted", route: saved.socials.linkedin, revision: saved.revision });
  assert.ok(saved.linkedinConnection.acceptedAt);
  assert.equal(outreach.isLinkedInConnectionPending(saved), false);
  assert.equal(outreach.canPlanChannel(saved, "linkedin"), true);
  assert.equal(outreach.inSendQueue(saved), true);
  assert.throws(() => d.updateLinkedInConnection(saved.id, { op: "accepted", route: saved.socials.linkedin, revision: saved.revision }), /No pending/);
  saved = d.updateJarvisSocialOutreach(saved.id, { op: "sent", platform: "linkedin", revision: saved.revision });
  assert.ok(saved.socialOutreach.linkedin.sentAt);
  assert.ok(saved.linkedinConnection.requestedAt, "connection history survives message send");
});

test("mail attempts retain sender identity and personal sync ignores legacy school threads", async () => {
  const oldId = sentLead(8);
  d.recordJarvisThread(oldId, { outcome: "none" });
  assert.equal(d.claimJarvisFollowUp(Date.now(), (lead) => lead.sendAttempt?.senderEmail === "personal@example.com"), null);
  const lead = queueable({ name: "Personal recipient", email: "personal-recipient@example.com", emailQuote: "personal-recipient@example.com" });
  d.queueJarvisLeads([{ id: lead.id, revision: lead.revision ?? 0 }]);
  const claim = d.claimQueuedJarvisSend((entry) => entry.id === lead.id, "personal@example.com");
  d.finishJarvisSend(claim.id, claim.attemptId, "personal-message", "personal-thread");
  assert.equal(d.readJarvis().leads.find((entry) => entry.id === lead.id).sendAttempt.senderEmail, "personal@example.com");
  const tokenFile = join(root, "google-outreach.json");
  writeFileSync(tokenFile, JSON.stringify({ email: "personal@example.com", refreshToken: "r", accessToken: "personal-token", accessTokenExpiresAt: Date.now() + 300000, scopes: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"] }));
  const oldFetch = globalThis.fetch;
  const reads = [];
  globalThis.fetch = async (url, options) => { reads.push(String(url)); assert.equal(options.headers.Authorization, "Bearer personal-token"); return Response.json({ messages: [] }); };
  try {
    const outbox = await import("../../lib/jarvis-outbox.ts");
    await outbox.syncJarvisReplies();
    assert.equal(reads.length, 1);
    assert.match(reads[0], /personal-thread/);
  } finally { globalThis.fetch = oldFetch; rmSync(tokenFile, { force: true }); }
});

test("review selection excludes existing workflows and add reports actual new contacts", () => {
  const one = queueable();
  const two = queueable({ name: "Bo Example", email: "bo@example.com", emailQuote: "bo@example.com" });
  assert.equal(outreach.canAddToReviewQueue(one), true);
  d.updateOutreachReviewQueue({ op: "add", ids: [one.id] });
  let saved = d.readJarvis().leads.find((lead) => lead.id === one.id);
  assert.equal(outreach.canAddToReviewQueue(saved), false);
  assert.equal(outreach.canAddToReviewQueue({ ...two, outreachWorkflow: { stage: "send", at: new Date().toISOString() }, linkedinConnection: { route: "https://linkedin.com/in/bo", requestedAt: new Date().toISOString() } }), false);
  assert.deepEqual(d.updateOutreachReviewQueue({ op: "add", ids: [one.id, two.id] }), { added: 1, skipped: 1 });
  assert.deepEqual(d.updateOutreachReviewQueue({ op: "add", ids: [one.id, two.id] }), { added: 0, skipped: 2 });
  assert.equal(d.readJarvis().leads.filter(outreach.inReviewQueue).length, 2);
  assert.equal(d.readJarvis().leads.filter(outreach.canAddToReviewQueue).length, 0);
  d.updateOutreachReviewQueue({ op: "remove", ids: [one.id] });
  saved = d.readJarvis().leads.find((lead) => lead.id === one.id);
  assert.equal(outreach.canAddToReviewQueue(saved), true);
});

test("contact display keeps untouched drafts first and separates workflow states", () => {
  const untouched = add();
  const at = new Date().toISOString();
  assert.equal(outreach.outreachDisplayState(untouched), "untouched", "auto-generated drafts are not outreach actions");
  const review = { ...untouched, outreachWorkflow: { stage: "review", at } };
  assert.equal(outreach.outreachDisplayState(review), "review");
  const pending = { ...untouched, socials: { linkedin: "https://linkedin.com/in/ada" }, linkedinConnection: { route: "https://linkedin.com/in/ada", requestedAt: at } };
  assert.equal(outreach.outreachDisplayState(pending), "connect_pending");
  assert.equal(outreach.outreachDisplayState({ ...pending, linkedinConnection: { ...pending.linkedinConnection, acceptedAt: at } }), "connected");
  const sent = { ...untouched, sentAt: at, status: "sent" };
  const partial = { ...sent, socials: { instagram: "https://instagram.com/ada" }, outreachWorkflow: { stage: "send", at } };
  assert.equal(outreach.outreachDisplayState(partial), "partial");
  assert.equal(outreach.outreachDisplayState(sent), "sent");
  assert.deepEqual([sent, review, pending, untouched, partial].sort((a,b) => outreach.outreachDisplayRank(a) - outreach.outreachDisplayRank(b)).map(outreach.outreachDisplayState), ["untouched", "review", "connect_pending", "partial", "sent"]);
});

test("contact display does not disguise an uncertain follow-up as completed", () => {
  const lead = { ...add(), sentAt: new Date().toISOString(), status: "sent" };
  assert.equal(outreach.outreachDisplayState({ ...lead, followUpAttempt: { state: "uncertain" } }), "uncertain");
  assert.equal(outreach.outreachDisplayState({ ...lead, followUpAttempt: { state: "pending" } }), "sending");
  assert.equal(outreach.outreachDisplayState({ ...lead, followUpAttempt: { state: "sent" } }), "followed_up");
  for (const status of ["replied", "interested", "declined", "bounced", "do_not_contact"]) {
    assert.equal(outreach.outreachDisplayState({ ...lead, status }), status);
  }
  const symbols = Object.values(outreach.OUTREACH_STATES).map(state => state[0]);
  assert.equal(new Set(symbols).size, symbols.length);
});

test("social templates persist independently and render without changing saved or sent messages", () => {
  const lead = add({ socials: { instagram: "https://instagram.com/ada", linkedin: "https://linkedin.com/in/ada" } });
  const path = join(root, "jarvis-discovery.json");
  const stored = JSON.parse(readFileSync(path, "utf8"));
  stored.leads[0].socialOutreach = { instagram: { draft: "Personally edited draft" }, linkedin: { draft: "Original message", sentText: "Original message", sentAt: new Date().toISOString() } };
  writeFileSync(path, JSON.stringify(stored));
  d.setJarvisSocialTemplate("instagram", "Hi {{firstName}} — how do you filter information at {{company}}?\n\nhttps://your-secretary.com");
  d.setJarvisSocialTemplate("linkedin", "Hi {{firstName}}, {{opener}} Any insights?\n\nhttps://your-secretary.com");
  const view = d.readJarvis();
  const saved = view.leads.find(l => l.id === lead.id);
  assert.match(saved.socialTemplateDrafts.instagram, /^Hi Ada — how do you filter information at Example Inc\?/);
  assert.match(saved.socialTemplateDrafts.linkedin, /Any insights\?/);
  assert.equal(outreach.socialDraft(saved, "instagram"), "Personally edited draft");
  assert.equal(outreach.socialDraft(saved, "linkedin"), "Original message");
  assert.equal(outreach.socialDraft({ ...saved, socialOutreach: {} }, "instagram"), saved.socialTemplateDrafts.instagram);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(raw.leads[0], stored.leads[0], "template save must not edit lead drafts, approvals, revisions or history");
  assert.equal(raw.socialTemplates.instagram, view.socialTemplates.instagram);
  assert.equal(raw.leads[0].socialTemplateDrafts, undefined, "derived previews stay out of persistent lead data");
  assert.throws(() => d.setJarvisSocialTemplate("email", "test"), /Instagram or LinkedIn/);
  assert.throws(() => d.setJarvisSocialTemplate("instagram", "Hi {{fristName}}"), /Unknown placeholder/);
  assert.throws(() => d.setJarvisSocialTemplate("linkedin", ""));
});

test("explicit email regeneration uses short openings and clears stale email approvals", () => {
  const lead = add({ opener: "I came across your work at Example Inc. " + "An overly long second sentence. ".repeat(12) });
  const path = join(root, "jarvis-discovery.json");
  const state = JSON.parse(readFileSync(path, "utf8"));
  Object.assign(state.leads[0], { reviewed: true, status: "ready", outreachApproval: { channel: "email", route: lead.email }, outreachPlans: { email: { body: "old" }, instagram: { body: "keep" } } });
  writeFileSync(path, JSON.stringify(state));
  const next = { subject: "Pilot", body: "Hi {{firstName}},\n\n{{shortOpener}}\n\nHow do you filter information?\n\nhttps://your-secretary.com" };
  assert.equal(d.setJarvisTemplate(next, true, true).updated, 1);
  assert.equal(d.readJarvis().leads[0].reviewed, true, "preview is read only");
  d.setJarvisTemplate(next, false, true);
  const updated = d.readJarvis().leads[0];
  assert.equal(updated.body, "Hi Ada,\n\nI came across your work at Example Inc.\n\nHow do you filter information?\n\nhttps://your-secretary.com");
  assert.equal(updated.reviewed, false);
  assert.equal(updated.outreachApproval, undefined);
  assert.equal(updated.outreachPlans, undefined);
  assert.ok(d.shortJarvisOpener({ ...lead, opener: "long ".repeat(60) + "." }).split(/\s+/).length < 25);
});

function undoReadyLead() {
  const lead = queueable({ socials: { linkedin: "https://www.linkedin.com/in/ada" } });
  d.updateOutreachReviewQueue({ op: "add", ids: [lead.id] });
  const saved = d.readJarvis().leads[0];
  d.prepareJarvisOutreachBatch({ channel: "linkedin", confirmed: true, items: [{ id: saved.id, revision: saved.revision, route: saved.socials.linkedin, draft: "Hello Ada\n\nhttps://your-secretary.com", identityChecked: true, draftChecked: true }] }, false);
  return d.readJarvis().leads[0];
}
for (const op of ["sent", "skip", "requested", "approve"]) {
  test(`send queue persists undo for ${op} and restores queue eligibility`, () => {
    const before = undoReadyLead();
    if (op === "requested") d.updateLinkedInConnection(before.id, { op, route: before.socials.linkedin, revision: before.revision });
    else if (op === "approve") d.planOutreachChannel({ id: before.id, revision: before.revision, channel: "linkedin", route: before.socials.linkedin, body: "New copy\n\nhttps://your-secretary.com", confirmed: true });
    else d.updateJarvisSocialOutreach(before.id, { op, platform: "linkedin", revision: before.revision, reason: "cannot-dm" });
    const undo = d.readJarvis().outreachUndo;
    assert.ok(undo);
    const saved = d.revertOutreachChange({ id: undo.leadId, revision: undo.revision });
    assert.deepEqual(saved.socialOutreach, before.socialOutreach);
    assert.deepEqual(saved.linkedinConnection, before.linkedinConnection);
    assert.deepEqual(saved.outreachPlans, before.outreachPlans);
    assert.equal(outreach.inSendQueue(saved), true);
    assert.ok(saved.revision > undo.revision);
    assert.equal(d.readJarvis().outreachUndo, undefined);
    assert.throws(() => d.revertOutreachChange({ id: undo.leadId, revision: undo.revision }), /changed/);
  });
}
test("undo rejects stale requests and never restores records over a real email attempt", () => {
  let lead = undoReadyLead();
  lead = d.updateLinkedInConnection(lead.id, { op: "requested", revision: lead.revision, route: lead.socials.linkedin });
  const first = d.readJarvis().outreachUndo;
  lead = d.updateLinkedInConnection(lead.id, { op: "accepted", revision: lead.revision, route: lead.socials.linkedin });
  assert.throws(() => d.revertOutreachChange({ id: first.leadId, revision: first.revision }), /changed/);
  let undo = d.readJarvis().outreachUndo;
  lead = d.revertOutreachChange({ id: undo.leadId, revision: undo.revision });
  assert.equal(outreach.isLinkedInConnectionPending(lead), true);
  d.planOutreachChannel({ id: lead.id, revision: lead.revision, channel: "email", route: lead.email, source: lead.emailSource, subject: lead.subject, body: lead.body, confirmed: true });
  undo = d.readJarvis().outreachUndo;
  lead = d.readJarvis().leads[0];
  d.claimJarvisSend(lead.id, lead.revision, "personal@example.com");
  assert.equal(d.readJarvis().outreachUndo, undefined);
  assert.throws(() => d.revertOutreachChange({ id: undo.leadId, revision: undo.revision }), /changed/);
  assert.ok(d.readJarvis().leads[0].sendAttempt);
});


test("research accepts absent login-review metadata but rejects invalid claimed platforms", () => {
  const envelope = (leads) => `<jarvis-leads>${JSON.stringify({ leads })}</jarvis-leads>`;
  for (const socialLoginRequired of ["", null, []]) {
    const result = r.parseJarvisResearch(envelope([candidate({ socialLoginRequired })]));
    assert.equal(result.candidates.length, 1);
  }
  assert.throws(() => r.parseJarvisResearch(envelope([candidate({ socialLoginRequired: ["instagram"] })])), /saved social profile URL/);
  assert.throws(() => r.parseJarvisResearch(envelope([candidate({ socialLoginRequired: "instagram" })])), /saved social profile URL/);
});
