import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = mkdtempSync(join(tmpdir(), "jarvis-test-"));
process.env.ROBIN_DATA_DIR = root;
const d = await import("./jarvis-domain.ts");
const { isJarvisFollowUpDue, isQualifiedInfoExec, jarvisTier, isJarvisExecutive, isSendableCore, jarvisComposeLinks, jarvisListPriority, newsBurdenTotal } = await import("./jarvis-shape.ts");
const r = await import("./jarvis-research.ts");
beforeEach(() => rmSync(join(root, "jarvis-discovery.json"), { force: true }));
after(() => rmSync(root, { recursive: true, force: true }));
const candidate = (extra = {}) => ({ name: "Ada Example", company: "Example Inc", role: "CTO", seniority: "Executive", industry: "AI tools", segment: "clinic", profileUrl: "https://example.com/team/ada", evidence: "Ada Example is CTO of Example Inc.", evidenceUrl: "https://example.com/team", needHypothesis: "可能需要追踪 AI 工具；待访谈验证。", email: "ada@example.com", emailSource: "https://example.com/team/ada", emailQuote: "Contact Ada: ada@example.com", opener: "I came across your work as CTO of Example Inc.", ...extra });
function add(extra = {}) { d.addJarvisCandidates([candidate(extra)]); return d.readJarvis().leads.at(-1); }

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

test("info-heavy executives need a scored news burden and qualify without a public email", () => {
  const exec = (extra) => candidate({ segment: "info_exec", persona: "vc", watchList: "12 seed-stage vertical-AI portfolio companies", email: "", emailSource: "", emailQuote: "", ...extra });
  assert.throws(() => d.parseJarvisCandidate(exec({})), /newsBurden/, "info_exec is chosen for its burden, so the scores are required");
  assert.throws(() => d.parseJarvisCandidate(exec({ newsBurden: burden(4, 3, 3, 3) })), /score/);
  assert.throws(() => d.parseJarvisCandidate(exec({ persona: "executive", newsBurden: burden(3, 3, 3, 3) })), /persona/, "persona is one of the four");
  assert.throws(() => d.parseJarvisCandidate(exec({ persona: "researcher", newsBurden: burden(3, 3, 3, 3) })), /persona/, "researchers are no longer targeted");
  assert.throws(() => d.parseJarvisCandidate(exec({ watchList: "", newsBurden: burden(3, 3, 3, 3) })), /watchList/, "a target user needs a named watch list");
  assert.throws(() => d.parseJarvisCandidate(exec({ newsBurden: { ...burden(3, 3, 3, 3), footprint: { score: 3, evidence: "" } } })), /evidence/);
  d.addJarvisCandidates([exec({ newsBurden: burden(3, 3, 2, 2) }), exec({ name: "Low Burden", newsBurden: burden(3, 3, 3, 0) }), exec({ name: "Thin Burden", newsBurden: burden(2, 2, 2, 2) })]);
  const [strong, zero, thin] = d.readJarvis().leads;
  assert.equal(strong.assessedVersion, 2);
  assert.equal(strong.persona, "vc");
  assert.equal(newsBurdenTotal(strong), 10);
  assert.equal(isQualifiedInfoExec(strong), true, "a missing email means LinkedIn or an intro, not disqualification");
  assert.equal(isSendableCore(strong), false);
  assert.equal(strong.emailCheck, "missing");
  assert.equal(isQualifiedInfoExec(zero), false, "no dimension may be zero");
  assert.equal(isQualifiedInfoExec(thin), false, "8/12 is below the v2 bar of 9");
  d.updateJarvisLead(strong.id, { status: "do_not_contact" });
  assert.equal(isQualifiedInfoExec(d.readJarvis().leads[0]), false);
});

test("research prompt asks info_exec for scores and optional email, and keeps email required elsewhere", () => {
  assert.throws(() => r.jarvisResearchPrompt([], "info_exec", 3), /persona/);
  const exec = r.jarvisResearchPrompt([], "info_exec", 3, "client_advisor");
  assert.match(exec, /Persona client_advisor\./);
  assert.doesNotMatch(exec, /Persona vc\./);
  assert.match(exec, /newsBurden first/);
  assert.doesNotMatch(exec, /skip anyone whose email/);
  assert.match(r.jarvisResearchPrompt([], "clinic", 3), /skip anyone whose email/);
  assert.match(r.JARVIS_RESEARCH_PREAMBLE, /Never a target user: trade\/professional association staff/);
  assert.match(r.JARVIS_RESEARCH_PREAMBLE, /roughly 500 people or fewer/);
  assert.match(r.jarvisRescorePrompt([], true), /do not search or fetch/);
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
  for (const extra of [{ email: "ada@example.com\r\nBcc: x@example.com" }, { emailSource: "javascript:alert(1)" }, { profileUrl: "http://127.0.0.1/private" }, { emailQuote: "probably first.last" }, { segment: "random" }, { email: "ada@gmail.com", emailSource: "https://example.com", emailQuote: "ada@gmail.com" }, { opener: "Ada Example is CTO at Example Inc." }]) {
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
  const tokenFile = join(root, "google.json");
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
    const token = { refreshToken: "test-refresh", accessToken: "test-token", accessTokenExpiresAt: Date.now() + 300000, connectedAt: new Date().toISOString(), scopes: [] };
    writeFileSync(tokenFile, JSON.stringify(token));
    await assert.rejects(() => sendJarvisEmail("ada@example.com", "Hi", "Body"), /Reconnect Google/);
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

test("structured research rejects malformed output, and skips invalid candidates only", () => {
  const envelope = (leads) => `<jarvis-leads>${JSON.stringify({ leads })}</jarvis-leads>`;
  assert.throws(() => r.parseJarvisResearch("Here are some people"));
  assert.throws(() => r.parseJarvisResearch(envelope([{ name: "made up" }])));
  const parsed = r.parseJarvisResearch(`Thinking...\n${envelope([candidate(), { name: "bad" }])}`);
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.rejected, 1);
  assert.deepEqual(r.JARVIS_RESEARCH_TOOLS, ["web_search", "fetch_content", "get_search_content"]);
  assert.match(r.JARVIS_RESEARCH_PREAMBLE, /provider "openai" and workflow "none"/);
});

test("email source check is bounded, rejects private hosts and only confirms an exact published address", async () => {
  const signal = new AbortController().signal;
  const fetcher = async () => new Response('<p>Contact ada@example.com</p>', { headers: { "Content-Type": "text/html" } });
  assert.ok((await r.checkJarvisEmailSources([candidate()], signal, fetcher)).has("ada@example.com"));
  for (const body of ["notada@example.com", "<script>const x = 'ada@example.com';</script>", "<p>no email</p>"]) {
    assert.equal((await r.checkJarvisEmailSources([candidate()], signal, async () => new Response(body, { headers: { "Content-Type": "text/html" } }))).size, 0);
  }
  let called = false;
  assert.equal((await r.checkJarvisEmailSources([candidate({ emailSource: "http://localhost/secret" })], signal, async () => { called = true; return fetcher(); })).size, 0);
  assert.equal(called, false);
});

test("drafts use Bruce's outreach text with the person's first name and area", () => {
  const draft = d.jarvisDraft(candidate({ name: "Dr. Ada Example", area: "running an independent physical-therapy practice" }));
  assert.match(draft.body, /^Hi Ada,/);
  assert.match(draft.body, /I came across your work as CTO of Example Inc\./);
  assert.match(d.jarvisDraft(candidate({ opener: "You lead a team building patient scheduling software." })).body, /\n\nYou lead a team building patient scheduling software\.\n\n/);
  assert.match(draft.body, /personalized TL;DR built around you/);
  assert.match(draft.body, /does the filtering part feel like a real pain or more of a nice-to-have/);
  assert.doesNotMatch(draft.body, /15-minute chat/);
  assert.ok(draft.body.endsWith("Best,\nBruce Cheng"));
  assert.match(d.jarvisDraft(candidate({ industry: "Behavioral health", opener: "" })).body, /work in behavioral health\./);
  assert.match(d.jarvisDraft(candidate({ industry: "HVAC distribution", opener: "" })).body, /work in HVAC distribution\./);
  assert.match(d.jarvisDraft(candidate({ area: "Midwest commercial real estate", opener: "" })).body, /work in Midwest commercial real estate\./);
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

test("seven full days without a recorded reply triggers one manual follow-up reminder", () => {
  const sent = "2026-09-01T12:00:00.000Z";
  const due = Date.parse(sent) + 7 * 24 * 60 * 60 * 1000;
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
  state.leads[0].sentAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
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
  assert.match(renderJarvisReport(state, after), /follow-up due · 7\+ days without recorded reply/);
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
  const person = (name, email) => add({ name, email, emailQuote: `Email ${email}`, profileUrl: `https://example.com/${email}` });
  const untouched = person("Ann One", "ann@example.com");
  const edited = person("Ben Two", "ben@example.com");
  const approved = person("Cy Three", "cy@example.com");
  d.updateJarvisLead(edited.id, { body: "My own words" });
  d.updateJarvisLead(approved.id, { reviewed: true });
  assert.throws(() => d.setJarvisTemplate({ subject: "Hi", body: "Hello {{frstName}}" }), /Unknown placeholder/);
  const preview = d.setJarvisTemplate({ subject: "For {{company}}", body: "Hello {{firstName}}, {{opener}}" }, true);
  assert.equal(preview.updated, 1);
  assert.equal(d.readJarvis().leads.find((l) => l.id === untouched.id).subject, untouched.subject, "dry run writes nothing");
  assert.equal(d.setJarvisTemplate({ subject: "For {{company}}", body: "Hello {{firstName}}, {{opener}}" }).updated, 1);
  const byId = (id) => d.readJarvis().leads.find((l) => l.id === id);
  assert.equal(byId(untouched.id).body, "Hello Ann, I came across your work as CTO of Example Inc.");
  assert.equal(byId(untouched.id).subject, "For Example Inc");
  assert.equal(byId(edited.id).body, "My own words");
  assert.equal(byId(approved.id).reviewed, true);
  d.addJarvisCandidates([candidate({ name: "Dee Four", email: "dee@example.com", emailQuote: "dee@example.com", profileUrl: "https://example.com/d" })]);
  assert.equal(d.readJarvis().leads.at(-1).body, "Hello Dee, I came across your work as CTO of Example Inc.", "new research uses the saved template");
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

test("batch approval queues only unchanged, source-confirmed, uncontacted contacts; any edit dequeues", () => {
  const ok = markSourceFound(add().id);
  const unconfirmed = add({ name: "Bo Example", email: "bo@example.com", emailQuote: "bo@example.com" });
  const stale = markSourceFound(add({ name: "Cy Example", email: "cy@example.com", emailQuote: "cy@example.com" }).id);
  const result = d.queueJarvisLeads([{ id: ok.id, revision: ok.revision ?? 0 }, { id: unconfirmed.id, revision: unconfirmed.revision ?? 0 }, { id: stale.id, revision: (stale.revision ?? 0) + 5 }]);
  assert.equal(result.queued, 1);
  assert.deepEqual(result.skipped.map((item) => item.reason), ["no email confirmed on its source page", "changed since loaded"]);
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
  const first = markSourceFound(add().id);
  const second = markSourceFound(add({ name: "Bo Example", email: "bo@example.com", emailQuote: "bo@example.com" }).id);
  d.queueJarvisLeads([{ id: first.id, revision: first.revision ?? 0 }]);
  d.queueJarvisLeads([{ id: second.id, revision: second.revision ?? 0 }]);
  assert.equal(d.claimQueuedJarvisSend(() => false), null, "outside every recipient's window nothing is claimed");
  const claim = d.claimQueuedJarvisSend();
  assert.equal(claim.id, first.id);
  assert.equal(d.claimQueuedJarvisSend().id, second.id, "a pending claim is never claimed twice");
  assert.equal(d.claimQueuedJarvisSend(), null);
  d.finishJarvisSend(claim.id, claim.attemptId, "gmail-1", "thread-1");
  const sent = d.readJarvis().leads.find((lead) => lead.id === first.id);
  assert.equal(sent.status, "sent");
  assert.equal(sent.sendAttempt.threadId, "thread-1");
  assert.equal(sent.queuedAt, undefined);
});

function sentLead(daysAgo, extra = {}) {
  const lead = markSourceFound(add(extra).id);
  d.queueJarvisLeads([{ id: lead.id, revision: lead.revision ?? 0 }]);
  const claim = d.claimQueuedJarvisSend((entry) => entry.id === lead.id);
  d.finishJarvisSend(claim.id, claim.attemptId, `gmail-${lead.id}`, `thread-${lead.id}`);
  const file = join(root, "jarvis-discovery.json");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  raw.leads.find((entry) => entry.id === lead.id).sentAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
  writeFileSync(file, JSON.stringify(raw));
  return lead.id;
}

test("one automatic follow-up, only after 7 days, a fresh thread check and no reply", () => {
  const id = sentLead(8);
  assert.equal(d.claimJarvisFollowUp(), null, "never without a recent thread check");
  d.recordJarvisThread(id, { outcome: "none" });
  const claim = d.claimJarvisFollowUp();
  assert.equal(claim.id, id);
  assert.equal(claim.subject, "Re: A question about what deserves your attention");
  assert.match(claim.body, /^Hi Ada,/);
  assert.match(claim.body, /won't follow up again/);
  assert.equal(claim.threadId, `thread-${id}`);
  assert.equal(d.claimJarvisFollowUp(), null, "claimed once");
  d.finishJarvisFollowUp(id, claim.attemptId);
  const lead = d.readJarvis().leads[0];
  assert.equal(lead.followUpAttempt.state, "uncertain");
  assert.ok(lead.followedUpAt, "an uncertain follow-up still counts, so it is never retried");
  const recent = sentLead(3, { name: "Bo Example", email: "bo@example.com", emailQuote: "bo@example.com" });
  d.recordJarvisThread(recent, { outcome: "none" });
  assert.equal(d.claimJarvisFollowUp(), null, "not before seven days");
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
  assert.throws(() => d.applyJarvisAssessment(lead.id, { persona: "vc", newsBurden: burden }), /watchList/, "a persona needs a named watch list");
  assert.equal(d.applyJarvisAssessment(lead.id, { persona: "vc", watchList: "a seed portfolio in fintech", newsBurden: burden }), true);
  let saved = d.readJarvis().leads[0];
  assert.equal(saved.persona, "vc");
  assert.equal(saved.watchList, "a seed portfolio in fintech");
  assert.equal(isQualifiedInfoExec(saved), true, "a rescored contact from any cohort can qualify");
  assert.equal(isQualifiedInfoExec({ ...saved, assessedVersion: undefined }), false, "an assessment under the old rubric does not count");
  assert.ok(saved.assessedAt);
  d.applyJarvisAssessment(lead.id, { persona: "none", newsBurden: burden });
  saved = d.readJarvis().leads[0];
  assert.equal(saved.persona, undefined);
  assert.equal(saved.watchList, undefined);
  assert.equal(saved.newsBurden.change.score, 3);
  assert.throws(() => d.applyJarvisAssessment(lead.id, { persona: "ceo", newsBurden: burden }), /persona/);
  assert.equal(d.applyJarvisAssessment("missing", { persona: "vc", watchList: "x", newsBurden: burden }), false);
});

test("a follow-up is threaded with In-Reply-To and rejects header injection", async () => {
  const { encodeJarvisMessage } = await import("./jarvis-mail.ts");
  const mime = Buffer.from(encodeJarvisMessage("ada@example.com", "Re: Hi", "Body", "<abc@mail.gmail.com>"), "base64url").toString("utf8");
  assert.match(mime, /\r\nIn-Reply-To: <abc@mail.gmail.com>\r\nReferences: <abc@mail.gmail.com>\r\n/);
  assert.throws(() => encodeJarvisMessage("ada@example.com", "Re: Hi", "Body", "<a>\r\nBcc: x@example.com"), /In-Reply-To/);
});

test("outbox pacing: weekday working hours in the recipient's zone, and one daily count for sends and follow-ups", async () => {
  const outbox = await import("../../lib/jarvis-outbox.ts");
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
  const tokenFile = join(root, "google.json");
  writeFileSync(tokenFile, JSON.stringify({ refreshToken: "r", accessToken: "test-token", accessTokenExpiresAt: Date.now() + 300000, connectedAt: new Date().toISOString(), scopes: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"] }));
  const oldFetch = globalThis.fetch;
  const sends = [];
  let fail = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/messages/send")) {
      if (fail) return Response.json({ error: { message: "quota" } }, { status: 429 });
      sends.push(Buffer.from(JSON.parse(options.body).raw, "base64url").toString("utf8"));
      return Response.json({ id: `m${sends.length}`, threadId: `t${sends.length}` });
    }
    return Response.json({ messages: [] });
  };
  try {
    const a = markSourceFound(add().id);
    const b = markSourceFound(add({ name: "Bo Example", email: "bo@example.com", emailQuote: "bo@example.com" }).id);
    d.queueJarvisLeads([{ id: a.id, revision: a.revision ?? 0 }, { id: b.id, revision: b.revision ?? 0 }]);
    const tuesday = new Date("2026-09-29T14:00:00Z");
    await outbox.tickJarvisOutbox(new Date("2026-09-26T14:00:00Z"));
    assert.equal(sends.length, 0, "no sends on a Saturday");
    d.setJarvisOutbox({ startAt: "2026-09-29T15:00:00Z" });
    await outbox.tickJarvisOutbox(tuesday);
    assert.equal(sends.length, 0, "nothing before the scheduled start, even inside the window");
    assert.throws(() => d.setJarvisOutbox({ startAt: "tomorrow-ish" }), /startAt/);
    d.setJarvisOutbox({ startAt: null });
    assert.equal(d.readJarvisOutbox().startAt, undefined);
    await outbox.tickJarvisOutbox(tuesday);
    assert.equal(sends.length, 1, "one contact per tick");
    assert.match(sends[0], /^To: ada@example.com/);
    d.setJarvisOutbox({ enabled: false });
    await outbox.tickJarvisOutbox(tuesday);
    assert.equal(sends.length, 1, "a paused outbox sends nothing");
    d.setJarvisOutbox({ enabled: true });
    fail = true;
    await outbox.tickJarvisOutbox(tuesday);
    const state = d.readJarvis();
    assert.match(state.outbox.pausedReason, /unconfirmed/);
    assert.equal(state.leads.find((lead) => lead.id === b.id).sendAttempt.state, "uncertain", "never retried automatically");
  } finally { globalThis.fetch = oldFetch; rmSync(tokenFile, { force: true }); }
});

test("research parsing salvages complete candidates from a malformed envelope and corrects the persona cohort", () => {
  const score = { score: 3, evidence: "sourced" };
  const lead = (name) => ({ ...candidate({ name, email: "", emailSource: "", emailQuote: "" }), segment: "Boutique M&A advisory", persona: "client_advisor", watchList: "healthcare-technology sell-side clients", newsBurden: { change: score, breadth: score, unfiltered: score, footprint: score } });
  const body = JSON.stringify({ leads: [lead("Ada One"), lead("Bo Two")] });
  const broken = `<jarvis-leads>${body.slice(0, -2)}}}</leads>`;
  const salvaged = r.parseJarvisResearch(broken, "info_exec");
  assert.deepEqual(salvaged.candidates.map((c) => [c.name, c.segment]), [["Ada One", "info_exec"], ["Bo Two", "info_exec"]]);
  assert.throws(() => r.parseJarvisResearch(`<jarvis-leads>${body}</jarvis-leads>`), /validation/, "outside a persona run, a wrong segment is still rejected");
  assert.throws(() => r.parseJarvisResearch("no envelope"), /structured/);
});

test("research records where it found a person; an unsourced note is dropped, not the person", () => {
  const withVia = d.parseJarvisCandidate(candidate({ foundVia: { source: "HLTH 2026 speaker list", url: "https://example.com/speakers" } }));
  assert.equal(withVia.foundVia.source, "HLTH 2026 speaker list");
  assert.equal(withVia.foundVia.url, "https://example.com/speakers");
  const bad = d.parseJarvisCandidate(candidate({ foundVia: { source: "somewhere", url: "javascript:alert(1)" } }));
  assert.equal(bad.foundVia, undefined);
  assert.equal(bad.name, "Ada Example");
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
  const lead = (extra) => ({ id: "x", status: "new", role: "Chief Executive Officer", industry: "Fintech", company: "Acme", assessedVersion: 2, newsBurden: burden(2, 2, 1, 1), ...extra });
  assert.equal(jarvisTier(lead({})), "B");
  assert.equal(jarvisTier(lead({ persona: "vc", watchList: "a seed portfolio", newsBurden: burden(3, 3, 2, 2) })), "A");
  assert.equal(jarvisTier(lead({ newsBurden: burden(2, 1, 1, 1) })), null, "5/12 is under the floor");
  assert.equal(jarvisTier(lead({ newsBurden: burden(0, 3, 3, 3) })), null, "a static field is under the floor");
  assert.equal(jarvisTier(lead({ industry: "Banking trade association" })), null, "associations are a channel");
  assert.equal(jarvisTier(lead({ assessedVersion: undefined })), null, "only v2 scores count");
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
  assert.match(r.jarvisResearchPrompt([], "info_exec", 3, "vc", true), /WIDE NET/);
  assert.match(r.jarvisResearchPrompt([], "info_exec", 3, "vc", true), /email is REQUIRED/);
});
