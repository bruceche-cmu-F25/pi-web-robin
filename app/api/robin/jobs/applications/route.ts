import { NextResponse } from "next/server";
import { applicationBoard, checkApplicationPreparation, configureApplications, dismissApplication } from "@/extension/robin/job-application-domain";
import { runApplications, startApplicationScheduler } from "@/lib/job-application-runner";
import { apiError, apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = apiRoute(async () => {
  // Also refresh the timer's implementation after a dev HMR reload; production starts it in instrumentation.
  startApplicationScheduler();
  return NextResponse.json(applicationBoard());
});

/** Schedule only: webpage content cannot replace the approved CV or common answers. */
export const PATCH = apiRoute(async (request) => {
  const body = await request.json() as Record<string, unknown>;
  if (!body || Object.keys(body).some((key) => !["enabled", "at", "timeZone", "dailyLimit"].includes(key))) return apiError(new Error("Only schedule settings can be changed here"));
  if (body.enabled !== undefined && typeof body.enabled !== "boolean"
    || body.at !== undefined && typeof body.at !== "string"
    || body.timeZone !== undefined && typeof body.timeZone !== "string"
    || body.dailyLimit !== undefined && typeof body.dailyLimit !== "number") return apiError(new Error("Invalid schedule settings"));
  configureApplications(body);
  return NextResponse.json(applicationBoard());
});

export const POST = apiRoute(async (request) => {
  const body = await request.json() as { action?: unknown; id?: unknown };
  if (!body || !["prepare", "inspect", "focus", "receipt", "dismiss"].includes(String(body.action))) return apiError(new Error("Unknown application action"));
  if (body.id !== undefined && (typeof body.id !== "string" || !body.id || body.id.length > 100)) return apiError(new Error("Invalid job id"));
  const action = body.action as "prepare" | "inspect" | "focus" | "receipt" | "dismiss";
  if (action !== "prepare" && !body.id) return apiError(new Error("Choose an application first"));
  if (applicationBoard().running) return apiError(new Error("Another application browser operation is running"), 409);
  if (action === "dismiss") {
    dismissApplication(body.id as string);
    return NextResponse.json(applicationBoard());
  }
  const options = { mode: action, ...(typeof body.id === "string" ? { id: body.id } : {}) };
  if (action === "prepare") {
    checkApplicationPreparation(options.id);
    // The domain reserves synchronously before the first browser await. Progress and errors live on Jobs.
    void runApplications(options).catch(() => console.error("[job-applications] preparation stopped; inspect Jobs"));
    return NextResponse.json(applicationBoard(), { status: 202 });
  }
  const execution = await runApplications(options);
  if (!execution.started) return apiError(new Error("Another browser operation started first"), 409);
  return NextResponse.json(applicationBoard());
});
