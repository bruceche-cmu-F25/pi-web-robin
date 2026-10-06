import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "jarvis-website-test-"));
const assistantStub = join(root, "assistant.mjs");
writeFileSync(assistantStub, "export const runScopedAssistantTurn = async () => { throw new Error('unexpected assistant call'); };\n");
const jiti = createJiti(import.meta.url, { alias: { "./robin-assistant.ts": assistantStub } });
const { crawlJarvisWebsite, officialWebsiteCandidate } = await jiti.import("./jarvis-website-enrichment.ts");

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
after(() => rmSync(root, { recursive: true, force: true }));

const lead = {
  id: "lead-1", name: "Ava Stone", firstName: "Ava", company: "Example Brand", role: "Founder and CEO", seniority: "Executive", industry: "DTC",
  segment: "info_exec", persona: "ecommerce_owner", sourcingLane: "multichannel", profileUrl: "https://www.linkedin.com/in/ava-stone", evidence: "Founder", evidenceUrl: "https://brand.example/about",
  needHypothesis: "Test", email: "", emailSource: "", emailQuote: "", opener: "I saw your work.", socials: { instagram: "https://instagram.com/examplebrand" },
  audienceFit: "core", status: "new", emailCheck: "missing", reviewed: false, subject: "", body: "", notes: "", confirmedNeeds: "", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", history: [],
};

test("official website selection ignores social profiles and uses saved company evidence", () => {
  assert.equal(officialWebsiteCandidate(lead), "https://brand.example/");
  assert.equal(officialWebsiteCandidate({ ...lead, profileUrl: "https://retailbrew.com/story/example", evidenceUrl: "https://retailbrew.com/story/example" }), undefined, "a trade-press source is not treated as the company's site");
});

test("website crawl classifies named and company email, phone and a contact form without submitting it", async () => {
  const requested = [];
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    requested.push({ url, method: options?.method ?? "GET" });
    if (url === "https://brand.example/") return new Response('<script src="package@4.1.0"></script><a href="/contact">Contact us</a><a href="/about">About</a><a href="tel:+1-555-0100">Call</a>', { status: 200, headers: { "content-type": "text/html" } });
    if (url === "https://brand.example/contact") return new Response('<form method="post"><textarea name="message"></textarea></form><a href="mailto:hello@brand.example">hello</a><p>ava@brand.example email@example.com</p>', { status: 200, headers: { "content-type": "text/html" } });
    if (url === "https://brand.example/about") return new Response('<form class="newsletter"><input name="email"></form>', { status: 200, headers: { "content-type": "text/html" } });
    return new Response("", { status: 404 });
  };
  const result = await crawlJarvisWebsite(lead, new AbortController().signal, "https://brand.example/");
  assert.equal(result.status, "found");
  assert.ok(result.contacts.some((item) => item.kind === "personal_email" && item.value === "ava@brand.example"));
  assert.ok(result.contacts.some((item) => item.kind === "company_email" && item.value === "hello@brand.example"));
  assert.ok(result.contacts.some((item) => item.kind === "contact_form" && item.value === "https://brand.example/contact"));
  assert.ok(result.contacts.some((item) => item.kind === "phone" && item.value === "+1-555-0100"));
  assert.ok(!result.contacts.some((item) => /package@|example\.com/.test(item.value)));
  assert.ok(!result.contacts.some((item) => item.kind === "contact_form" && item.value.endsWith("/about")), "newsletter forms are not contact forms");
  assert.ok(requested.every((request) => request.method === "GET"), "the crawler never submits a website form");
});

test("healthcare crawl checks the saved staff bio even if the homepage omits its link", async () => {
  const requested=[];
  globalThis.fetch=async url=>{requested.push(String(url));return new Response(String(url).endsWith('/staff/ava')?'<p>Ava Stone ava@brand.example</p>':'<p>Our clinic</p>',{headers:{'content-type':'text/html'}})};
  const result=await crawlJarvisWebsite({...lead,segment:'clinic',profileUrl:'https://brand.example/staff/ava'},new AbortController().signal,'https://brand.example/');
  assert.ok(requested.includes('https://brand.example/staff/ava'));
  assert.ok(result.contacts.some(c=>c.value==='ava@brand.example'));
});

test("percent-encoded mailto whitespace never becomes part of a healthcare email address", async () => {
 globalThis.fetch=async()=>new Response('<a href="mailto:%20ava%40brand.example">Ava email</a>',{headers:{'content-type':'text/html'}});
 const result=await crawlJarvisWebsite(lead,new AbortController().signal,'https://brand.example/');
 assert.ok(result.contacts.some(c=>c.value==='ava@brand.example'));
 assert.ok(!result.contacts.some(c=>c.value.includes('%20')));
});
