import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerJobTools } from "./job-tools.ts";
import { DEFAULT_JOB_PROFILE, digestCandidates } from "./jobs.ts";
import { ELIGIBILITY_CHECKS } from "./job-evidence.ts";
import { readJobs, writeJobs, writeJobProfile } from "./store.ts";

const previous = process.env.ROBIN_DATA_DIR;
process.env.ROBIN_DATA_DIR = mkdtempSync(join(tmpdir(), "robin-job-tools-"));
after(() => {
  rmSync(process.env.ROBIN_DATA_DIR, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previous;
});
const tools = new Map();
registerJobTools({ registerTool(tool) { tools.set(tool.name, tool); } });
const invoke = async (name, params = {}) => (await tools.get(name).execute("test", params)).content.map(part => part.text ?? "").join("\n");

test("the scoring tools expose summaries first, full evidence on demand, and a verified recommendation", async () => {
  const cv = "Built production FastAPI backends and LangGraph agent workflows.";
  const quote = "Requirements: Build Python backends and agent workflows.";
  const profile = { ...DEFAULT_JOB_PROFILE, cv, boards: [], companies: [] };
  const description = "Our team builds products for customers. ".repeat(110) + quote;
  writeJobProfile(profile);
  writeJobs([{ id: "role", title: "AI Engineer", company: "Acme", location: "Remote US", description,
    source: "ashby", url: "https://jobs.ashbyhq.com/acme/role", status: "new", discoveredAt: new Date().toISOString() }]);
  assert.match(await invoke("job_profile"), /Verify before recommending/);
  const summary = await invoke("job_pending", { limit: 40 });
  assert.match(summary, /summaries, NOT full JDs/);
  assert.ok(summary.length < description.length);
  const full = await invoke("job_pending", { id: "role" });
  assert.ok(full.includes(description));
  assert.match(full, /<<untrusted-posting>>/);
  const context = full.match(/Review context: (\S+)/)[1];
  await invoke("job_score", { id: "role", score: 4.5, reason: "Python/agent evidence matches", review: {
    context, roleEvidence: quote, cvEvidence: cv,
    checks: Object.fromEntries(ELIGIBILITY_CHECKS.map(field => [field, field === "location"
      ? { status: "met", quote: "Remote US" } : { status: "not-stated" }])),
  } });
  assert.equal(digestCandidates(readJobs(), profile).length, 1);
  assert.match(await invoke("job_pending"), /No jobs/);
  assert.equal(readJobs()[0].status, "new");
  assert.match(await invoke("job_pending", { id: "missing" }), /No job/);
});
