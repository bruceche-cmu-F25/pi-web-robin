import { configureHttpDispatcher } from "@/lib/http-dispatcher";
import { closeAllAgentEventStreams } from "@/lib/agent-event-stream";
import { startRobinSessionCleanup } from "@/lib/robin-session-lifecycle";
import { startJarvisOutbox } from "@/lib/jarvis-outbox";
import { startJarvisDaily } from "@/lib/jarvis-daily";

export function registerNodeInstrumentation(): void {
  configureHttpDispatcher();
  startRobinSessionCleanup();
  startJarvisOutbox();
  startJarvisDaily();

  // In production Next 16 answers SIGINT/SIGTERM with server.close() and waits
  // for every connection to end, without a timeout. SSE streams only end when
  // the client disconnects, so close them here or the process never exits.
  const shutdownStreams = () => closeAllAgentEventStreams();
  process.on("SIGINT", shutdownStreams);
  process.on("SIGTERM", shutdownStreams);
}
