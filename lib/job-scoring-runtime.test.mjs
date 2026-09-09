import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { prepareJobScoringSession } from "./job-scoring-runtime.ts";
import { JOB_SCORING_CONTRACT } from "../extension/robin/job-evidence.ts";
import { registerJobTools } from "../extension/robin/job-tools.ts";
import { ROBIN_SCORING_TOOL_NAMES } from "../extension/robin/tools.ts";

const currentTools = [];
registerJobTools({ registerTool(tool) { currentTools.push({ ...tool, active: true }); } });
const scoringTools = currentTools.filter(tool => ROBIN_SCORING_TOOL_NAMES.includes(tool.name));

test("preflight reloads first, reapplies the literal allow-list and checks the runtime contract", async () => {
  const calls = [];
  await prepareJobScoringSession({ async send(command) {
    calls.push(command);
    if (command.type === "get_tools") return scoringTools;
  } });
  assert.deepEqual(calls.map(call => call.type), ["reload", "set_tools", "get_tools"]);
  assert.deepEqual(calls[1], { type: "set_tools", exact: true, toolNames: [...ROBIN_SCORING_TOOL_NAMES] });
});

test("missing, cached, or overprivileged tools stop before any model call", async () => {
  for (const tools of [[], currentTools, scoringTools.map(tool => ({ ...tool, parameters: {} })),
    scoringTools.map(tool => tool.name === "job_score" ? { ...tool, parameters: { properties: {} } } : tool)]) {
    await assert.rejects(prepareJobScoringSession({ async send(command) {
      if (command.type === "get_tools") return tools;
      assert.notEqual(command.type, "prompt");
    } }), /missing or stale/);
  }
});

test("actual SDK: a new loader reuses stale factories; explicit reload refreshes dependency code", async () => {
  const dir = mkdtempSync(join(tmpdir(), "robin-scoring-cache-"));
  try {
    const agentDir = join(dir, "agent"); mkdirSync(agentDir);
    const dependency = join(dir, "version.ts");
    const extension = join(dir, "extension.ts");
    const update = version => writeFileSync(dependency, `export const version: string = ${JSON.stringify(version)};\n`);
    update("old");
    writeFileSync(extension, `import { version } from "./version.ts";
      export default function (pi) { pi.registerTool({ name: "probe", label: "Probe", description: version,
        parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: version }] }) }); }`);
    const loader = () => new DefaultResourceLoader({ cwd: dir, agentDir,
      settingsManager: SettingsManager.inMemory(), additionalExtensionPaths: [extension],
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
    const first = loader(); await first.reload();
    const probe = resource => resource.getExtensions().extensions.flatMap(ext => [...ext.tools.values()])
      .find(tool => tool.definition.name === "probe").definition;
    assert.equal(probe(first).description, "old");
    update(JOB_SCORING_CONTRACT);
    const next = loader(); await next.reload();
    assert.equal(probe(next).description, "old", "new session does not imply fresh code");
    await next.reload();
    const result = await probe(next).execute();
    assert.equal(result.content[0].text, JOB_SCORING_CONTRACT);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
