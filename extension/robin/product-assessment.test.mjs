import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { writeJsonObject } from "./paths.ts";
import { addIdea, listIdeas } from "./product-domain.ts";
import { assessProductOpportunity, readProductAssessments, PRODUCT_ASSESSMENT_TOOLS } from "./product-assessment-domain.ts";
import { PRODUCT_ASSESSMENT_CRITERIA } from "./product-assessment.ts";

const previous = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), "product-assessment-"));
process.env.ROBIN_DATA_DIR = dir;
after(() => { rmSync(dir, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
const SOURCE = "https://www.starterstory.com/data/ios-app-ideas";
const item = { id: "sample", title: "Voice notes", url: "https://www.starterstory.com/businesses/sample", productHost: "sample.example", source: SOURCE, revenue: "$800/mo", monthlyUsd: 800, revenueBasis: "reported" };
const seed = (catalog = [item], catalogSource = SOURCE) => writeJsonObject("product-opportunities.json", { catalogSource, catalog, opportunities: [{ ...item, id: "legacy" }] });
beforeEach(() => { seed(); rmSync(join(dir, "product-assessments.json"), { force: true }); });
const draft = () => ({
  verdict: "test", reason: "A narrow test is plausible; distribution is the largest risk.", wedge: "Test task extraction, not a new notes platform.",
  firstTest: "Proposed: show five users a manual prototype; proceed if three repeat the task.", stopRule: "Stop if nobody returns.", unknowns: [],
  criteria: Object.fromEntries(PRODUCT_ASSESSMENT_CRITERIA.map(({ id }) => [id, { status: "supported", reason: "A cited basis for this limited test, not proof of success.", sourceIds: [1, 2] }])),
  sources: [{ title: "Official product", url: "https://sample.example/pricing", quote: "The product offers a free trial." }, { title: "Store", url: "https://apps.apple.com/us/app/sample/id123", quote: "Turn your voice into written notes." }],
});
const generate = (value, usedTools = ["fetch_content"]) => async () => ({ reply: `<product-assessment>${JSON.stringify(value)}</product-assessment>`, usedTools });
const assess = (value = draft(), tools) => assessProductOpportunity("sample", "en", generate(value, tools));

test("explicit assessment persists independently, contains the exact candidate, and cannot edit ideas", async () => {
  addIdea({ name: "My own name", note: "My own words", step: "research" });
  const before = listIdeas();
  const result = await assessProductOpportunity("sample", "en", async (message) => {
    const input = JSON.parse(message);
    assert.equal(input.untrustedDirectoryData.id, "sample");
    assert.equal(input.untrustedDirectoryData.source, SOURCE);
    assert.equal(input.language, "English");
    assert.deepEqual(PRODUCT_ASSESSMENT_TOOLS, ["web_search", "source_check", "fetch_content", "get_search_content"]);
    return generate(draft())();
  });
  assert.equal(result.verdict, "test");
  assert.equal(result.confidence, "medium");
  assert.equal(readProductAssessments([item]).sample.stale, false);
  assert.deepEqual(listIdeas(), before);
  const second = { ...item, id: "second" };
  seed([item, second]);
  await assessProductOpportunity("second", "zh", generate(draft()));
  assert.deepEqual(Object.keys(readProductAssessments([item, second])).sort(), ["sample", "second"]);
});

test("high revenue, a solo score and directory-only citations cannot pass the evidence gate", async () => {
  seed([{ ...item, revenue: "$1M/mo", monthlyUsd: 1_000_000, soloScore: 100 }]);
  const value = draft();
  value.sources = value.sources.map((source, i) => ({ ...source, url: `https://www.starterstory.com/stories/claim-${i}` }));
  const result = await assess(value);
  assert.equal(result.verdict, "research");
  assert.ok(result.guardrail);
});

test("material unknowns, no reading tool, missing official evidence and weak distribution cap a positive verdict", async () => {
  for (const change of [
    (value) => { value.criteria.economics.status = "unknown"; },
    (value) => { value.unknowns = ["Whether the needed API is publicly available"]; },
    (value) => { value.criteria.distribution.status = "risk"; },
    (value) => { value.sources.forEach((source, i) => { source.url = `https://third-party.example/${i}`; }); },
    (value) => { value.sources[1].url = value.sources[0].url; },
    (value) => { Object.values(value.criteria).forEach((criterion) => { criterion.sourceIds = [1]; }); },
  ]) {
    const value = draft(); change(value);
    const result = await assess(value);
    assert.equal(result.verdict, "research");
    assert.ok(result.guardrail);
  }
  assert.equal((await assess(draft(), ["web_search"])).verdict, "research");
});

test("sourced blockers reject; absent evidence alone does not", async () => {
  const blocked = draft(); blocked.criteria.operations.status = "blocked";
  assert.equal((await assess(blocked)).verdict, "pass");
  const unknown = draft(); unknown.verdict = "pass"; unknown.sources = [];
  Object.values(unknown.criteria).forEach((criterion) => { criterion.status = "unknown"; criterion.sourceIds = []; });
  const result = await assess(unknown, []);
  assert.equal(result.verdict, "research");
  assert.equal(result.confidence, "low");
});

test("invalid model output and model failures retain the previous saved result", async () => {
  await assess();
  const before = readProductAssessments([item]);
  for (const change of [
    (value) => { delete value.criteria.build; },
    (value) => { value.verdict = ["test"]; },
    (value) => { value.criteria.build.status = ["supported"]; },
    (value) => { value.criteria.build.sourceIds = [100]; },
    (value) => { value.criteria.build.sourceIds = []; },
    (value) => { value.sources[0].url = "javascript:alert(1)"; },
    (value) => { value.sources[0].url = "https://user:password@example.com"; },
    (value) => { value.reason = "x".repeat(1201); },
  ]) {
    const value = draft(); change(value);
    await assert.rejects(assess(value));
    assert.deepEqual(readProductAssessments([item]), before);
  }
  await assert.rejects(assessProductOpportunity("sample", "en", async () => ({ reply: "truncated", usedTools: [] })), /incomplete/);
  await assert.rejects(assessProductOpportunity("sample", "en", async () => { throw new Error("Model unavailable"); }), /unavailable/);
  assert.deepEqual(readProductAssessments([item]), before);
});

test("only current-directory candidates are accepted, before any model spend", async () => {
  const never = async () => { assert.fail("must not invoke the model"); };
  for (const id of ["missing", "legacy", "constructor", "__proto__"]) await assert.rejects(assessProductOpportunity(id, "en", never), /not found/);
  seed([item], "https://www.starterstory.com/data/other-list");
  await assert.rejects(assessProductOpportunity("sample", "en", never), /not found/);
});

test("changed source facts mark saved results stale and reject an in-flight obsolete write", async () => {
  await assess();
  const changed = { ...item, monthlyUsd: 900, revenue: "$900/mo" };
  assert.equal(readProductAssessments([changed]).sample.stale, true);
  const before = readProductAssessments([item]);
  await assert.rejects(assessProductOpportunity("sample", "en", async () => { seed([changed]); return generate(draft())(); }), /facts changed/);
  assert.deepEqual(readProductAssessments([item]), before);
  assert.deepEqual(readProductAssessments([{ ...item, id: "constructor" }]), {});
});
