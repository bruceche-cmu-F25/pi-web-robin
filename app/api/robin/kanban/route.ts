import { NextResponse } from "next/server";
import { acceptPlan, kanbanContext, parsePlanReply, plannerMessage, PLANNER_PREAMBLE } from "@/extension/robin/kanban-domain";
import { planningCandidates, validatePlanningOptions } from "@/extension/robin/kanban";
import { runScopedAssistantTurn } from "@/lib/robin-assistant";
import { apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export const GET = apiRoute(async (req) => {
  const options = validatePlanningOptions(JSON.parse(new URL(req.url).searchParams.get("options") ?? "null"));
  const { capacity, today, google, timezone } = await kanbanContext(options);
  return NextResponse.json({ capacity, today, google, timezone });
}, { errorStatus: 400 });

export const POST = apiRoute(async (req) => {
  const body = await req.json() as { action?: unknown; options?: unknown; locale?: unknown; revision?: unknown; suggestion?: unknown };
  const options = validatePlanningOptions(body.options);
  if (body.action !== "generate" && body.action !== "apply") throw new Error("Unknown planning action");
  const context = await kanbanContext(options);
  if (context.google.error) return NextResponse.json({ error: "Calendar data is incomplete; reconnect or retry before planning" }, { status: 409 });
  if (body.action === "apply") {
    acceptPlan(context, body.revision, body.suggestion);
    return NextResponse.json({ success: true });
  }
  if (!planningCandidates(context.todos, context.today).length || !context.capacity.some((day) => day.remainingMinutes >= 5 && day.remainingTasks > 0)) {
    return NextResponse.json({ revision: context.revision, suggestion: { items: [] } });
  }
  const result = await runScopedAssistantTurn({
    remembered: null, remember: () => {}, oneShot: true,
    // Zero tools: calendar text never gets a path to task writes, shell, or email.
    toolNames: [], preamble: PLANNER_PREAMBLE,
    message: plannerMessage(context, typeof body.locale === "string" ? body.locale : "en"),
    signal: req.signal, timeoutMs: 75_000,
  });
  const suggestion = parsePlanReply(result.reply, context);
  return NextResponse.json({ revision: context.revision, suggestion });
});
