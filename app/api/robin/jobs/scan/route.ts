import { NextResponse } from "next/server";
import { runJobScan } from "@/extension/robin/job-scan";
import { executeBackgroundRun } from "@/extension/robin/background-run-domain";
import { apiRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";
// A scan fans out to every enabled board. Twenty companies at six in flight,
// with Ashby's ten-second latency floor among them, does not fit the default.
export const maxDuration = 120;
const JOB_SCAN_RUN = "job-forward-scan";

/**
 * Run one scan and report what it found.
 *
 * POST rather than GET because it writes: the store gains rows and the scan
 * state is replaced. There is no body — everything the scan needs is in the
 * saved profile, so the browser and the Telegram bridge call it identically.
 *
 * Costs no tokens, so it is safe to leave on a button.
 */
export const POST = apiRoute(async () => {
  try {
    const execution = await executeBackgroundRun(JOB_SCAN_RUN, ({ signal, commit }) =>
      runJobScan({ signal, commit }));
    if (!execution.started) {
      return NextResponse.json({ error: "A job scan is already running.", reason: "already-running" }, { status: 409 });
    }
    return NextResponse.json({ scan: execution.value });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});
