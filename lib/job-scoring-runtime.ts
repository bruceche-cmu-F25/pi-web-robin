import { JOB_SCORING_CONTRACT } from "../extension/robin/job-evidence.ts";
import { ROBIN_SCORING_TOOL_NAMES } from "../extension/robin/tools.ts";

/** A new SDK loader can reuse cached factories. Reload before trusting a paid scoring turn. */
export async function prepareJobScoringSession(session: {
  send(command: { type: string; [key: string]: unknown }): Promise<unknown>;
}): Promise<void> {
  await session.send({ type: "reload" });
  // Reload can restore extension defaults, so apply the restriction AFTER it.
  await session.send({ type: "set_tools", toolNames: [...ROBIN_SCORING_TOOL_NAMES], exact: true });
  const tools = await session.send({ type: "get_tools" }) as Array<{
    name: string; active: boolean;
    parameters?: { $comment?: string; properties?: Record<string, unknown> };
  }>;
  const active = Array.isArray(tools) ? tools.filter(tool => tool.active) : [];
  if (active.length !== ROBIN_SCORING_TOOL_NAMES.length
    || ROBIN_SCORING_TOOL_NAMES.some(name => !active.some(tool => tool.name === name))
    || active.find(tool => tool.name === "job_profile")?.parameters?.$comment !== JOB_SCORING_CONTRACT
    || !active.find(tool => tool.name === "job_pending")?.parameters?.properties?.id
    || !active.find(tool => tool.name === "job_score")?.parameters?.properties?.review) {
    throw new Error("Job scoring tools are missing or stale after reload; scoring stopped before calling the model.");
  }
}
