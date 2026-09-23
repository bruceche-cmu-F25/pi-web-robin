import { NextResponse } from "next/server";
import { jsonResponse } from "@/lib/json-response";
import {
  attachSessionProjectInfo,
  getSessionListVersion,
  invalidateSessionListCache,
  listAllSessions,
  mergeSessionLists,
} from "@/lib/session-reader";
import {
  getCompletionNotificationSuppressedRpcSessionIds,
  getRpcSession,
  getRpcSessionInfos,
  getRunningRpcSessionIds,
} from "@/lib/rpc-manager";
import { maybePruneExpiredSessionPayloads } from "@/lib/session-history-retention";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const persistedSessionsPromise = listAllSessions({ force });
    // Capture before awaiting: mutations during the scan still require a later refresh.
    let sessionListVersion = getSessionListVersion();
    const [initialPersistedSessions, runtimeSessions] = await Promise.all([
      persistedSessionsPromise,
      attachSessionProjectInfo(getRpcSessionInfos()),
    ]);
    const retention = await maybePruneExpiredSessionPayloads(
      initialPersistedSessions,
      (id) => Boolean(getRpcSession(id)?.isAlive()),
    );
    let persistedSessions = initialPersistedSessions;
    if (retention.filesChanged > 0) {
      invalidateSessionListCache();
      const refreshedSessions = listAllSessions();
      sessionListVersion = getSessionListVersion();
      persistedSessions = await refreshedSessions;
    }
    const sessions = mergeSessionLists(persistedSessions, runtimeSessions);
    return jsonResponse(
      req,
      {
        sessions,
        sessionListVersion,
        runningSessionIds: getRunningRpcSessionIds(),
        completionNotificationSuppressedSessionIds: getCompletionNotificationSuppressedRpcSessionIds(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
