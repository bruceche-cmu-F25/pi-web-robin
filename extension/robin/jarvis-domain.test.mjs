import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = mkdtempSync(join(tmpdir(), "jarvis-test-"));
process.env.ROBIN_DATA_DIR = root;
const d = await import("./jarvis-domain.ts");
const { jarvisComposeLinks } = await import("./jarvis-shape.ts");
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
  for (const extra of [{ email: "ada@example.com\r\nBcc: x@example.com" }, { emailSource: "javascript:alert(1)" }, { profileUrl: "http://127.0.0.1/private" }, { emailQuote: "probably first.last" }, { segment: "random" }, { email: "ada@gmail.com", emailSource: "https://example.com", emailQuote: "ada@gmail.com" }]) {
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
  assert.match(draft.body, /I came across your work running an independent physical-therapy practice, and/);
  assert.match(d.jarvisDraft(candidate({ industry: "Behavioral health" })).body, /work in behavioral health,/);
  assert.match(d.jarvisDraft(candidate({ industry: "HVAC distribution" })).body, /work in HVAC distribution,/);
  assert.match(d.jarvisDraft(candidate({ area: "Midwest commercial real estate" })).body, /work in Midwest commercial real estate,/);
});

test("the HTML report escapes researched text and gates compose links on review", async () => {
  const { renderJarvisReport } = await import("../../lib/jarvis-report.ts");
  const lead = add({ name: "<script>x</script> Ada" });
  let html = renderJarvisReport(d.readJarvis());
  assert.ok(!html.includes("<script>x</script>"));
  assert.ok(!html.includes("mail.google.com"), "unreviewed drafts have no compose link");
  d.updateJarvisLead(lead.id, { reviewed: true });
  html = renderJarvisReport(d.readJarvis());
  assert.ok(html.includes("mail.google.com"));
});

test("a new template rewrites only untouched drafts and rejects unknown placeholders", () => {
  const person = (name, email) => add({ name, email, emailQuote: `Email ${email}`, profileUrl: `https://example.com/${email}` });
  const untouched = person("Ann One", "ann@example.com");
  const edited = person("Ben Two", "ben@example.com");
  const approved = person("Cy Three", "cy@example.com");
  d.updateJarvisLead(edited.id, { body: "My own words" });
  d.updateJarvisLead(approved.id, { reviewed: true });
  assert.throws(() => d.setJarvisTemplate({ subject: "Hi", body: "Hello {{frstName}}" }), /Unknown placeholder/);
  const preview = d.setJarvisTemplate({ subject: "For {{company}}", body: "Hello {{firstName}}, {{work}}." }, true);
  assert.equal(preview.updated, 1);
  assert.equal(d.readJarvis().leads.find((l) => l.id === untouched.id).subject, untouched.subject, "dry run writes nothing");
  assert.equal(d.setJarvisTemplate({ subject: "For {{company}}", body: "Hello {{firstName}}, {{work}}." }).updated, 1);
  const byId = (id) => d.readJarvis().leads.find((l) => l.id === id);
  assert.equal(byId(untouched.id).body, "Hello Ann, your work in AI tools.");
  assert.equal(byId(untouched.id).subject, "For Example Inc");
  assert.equal(byId(edited.id).body, "My own words");
  assert.equal(byId(approved.id).reviewed, true);
  d.addJarvisCandidates([candidate({ name: "Dee Four", email: "dee@example.com", emailQuote: "dee@example.com", profileUrl: "https://example.com/d" })]);
  assert.equal(d.readJarvis().leads.at(-1).body, "Hello Dee, your work in AI tools.", "new research uses the saved template");
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
