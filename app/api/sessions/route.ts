import { NextResponse } from "next/server";
import {
  attachSessionProjectInfo,
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
    const [initialPersistedSessions, runtimeSessions] = await Promise.all([
      listAllSessions({ force }),
      attachSessionProjectInfo(getRpcSessionInfos()),
    ]);
    const retention = await maybePruneExpiredSessionPayloads(
      initialPersistedSessions,
      (id) => Boolean(getRpcSession(id)?.isAlive()),
    );
    let persistedSessions = initialPersistedSessions;
    if (retention.filesChanged > 0) {
      invalidateSessionListCache();
      persistedSessions = await listAllSessions();
    }
    const sessions = mergeSessionLists(persistedSessions, runtimeSessions);
    return NextResponse.json(
      {
        sessions,
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
