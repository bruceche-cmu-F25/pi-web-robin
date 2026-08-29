/**
 * When the agent event stream reattaches, keeps polling, or closes.
 *
 * After a prompt settles the hook does not close the SSE stream immediately: a
 * single logical turn can emit several `agent_end` events before retrying,
 * compacting, or draining messages queued by an extension. Instead it starts an
 * idle grace period and then asks the server what is actually happening. The
 * timers, the refs, and the fetch stay in the hook; the decisions live here so
 * they can be exercised without React, a DOM, or a live connection.
 */

/** `GET /api/agent/:id`'s `state`, narrowed to what the grace check reads. */
export interface AgentRunState {
  isStreaming?: boolean;
  isPromptRunning?: boolean;
  isCompacting?: boolean;
}

/** `GET /api/agent/:id`'s body, narrowed to what the grace check reads. */
export interface AgentStatusReport {
  running?: boolean;
  state?: AgentRunState | null;
}

export type GraceOutcome =
  /**
   * The server is still working, so the stream is kept and the UI reattaches to
   * the run already in progress.
   */
  | {
    kind: "adopt";
    sdkAgentActive: boolean;
    rpcPromptPending: boolean;
    phase: "waiting_model" | "running_command";
  }
  /**
   * Nothing is decided yet. `compacting` means the server said so and the
   * compaction indicator should be shown; `unverified` means the status could
   * not be read at all and no indicator should be touched.
   */
  | { kind: "poll"; reason: "compacting" | "unverified" }
  /** The server is idle. The stream can be closed. */
  | { kind: "close" };

/**
 * Decide what the idle grace check does next.
 *
 * Pass `null` when the status request itself failed. An unreadable server is
 * not an idle server, so the stream is kept alive and the check is retried
 * rather than closing a stream that may still be carrying a live run.
 */
export function graceOutcome(report: AgentStatusReport | null): GraceOutcome {
  if (!report) return { kind: "poll", reason: "unverified" };

  const state = report.state;
  if (report.running && state && (state.isStreaming || state.isPromptRunning)) {
    return {
      kind: "adopt",
      sdkAgentActive: Boolean(state.isStreaming),
      rpcPromptPending: Boolean(state.isPromptRunning),
      // A streaming model is waiting on tokens; a prompt running without a
      // stream is a slash command executing on the server.
      phase: state.isStreaming ? "waiting_model" : "running_command",
    };
  }

  if (report.running && state?.isCompacting) {
    return { kind: "poll", reason: "compacting" };
  }

  return { kind: "close" };
}

export interface GraceCheckIdentity {
  /** The grace generation captured when this check was scheduled. */
  generation: number;
  /** The grace generation now. A newer one means the check was superseded. */
  currentGeneration: number;
  /** The session this check was scheduled for. */
  sessionId: string;
  /** The session the hook is showing now. */
  currentSessionId: string | null;
  /** Whether a grace period is still active at all. */
  graceActive: boolean;
}

/**
 * Whether a scheduled grace check has been overtaken and must not act.
 *
 * The check runs after a timeout and again after an await, so it can land after
 * the user switched sessions, after a new run cancelled the grace, or after the
 * grace was already resolved. Acting then would close a stream belonging to a
 * different session or a newer run.
 */
export function isGraceCheckStale(identity: GraceCheckIdentity): boolean {
  return identity.generation !== identity.currentGeneration
    || identity.currentSessionId !== identity.sessionId
    || !identity.graceActive;
}

/**
 * The four events that move a turn between running and settled.
 *
 * The other agent events (messages, tool calls, notices) only paint; these are
 * the ones that decide whether the agent is still working, whether the stream
 * stays open, and whether the caller is told the turn ended.
 */
export type AgentLifecycleEvent = "agent_start" | "agent_end" | "agent_settled" | "prompt_done";

export interface AgentLifecycleState {
  /** Whether the UI is showing a turn in progress. */
  agentRunning: boolean;
  /** Whether the SDK agent loop is active (a model is producing a turn). */
  sdkAgentActive: boolean;
  /** Whether a prompt-level command is running on the server. */
  rpcPromptPending: boolean;
  /** The run whose completion was already announced, so it is announced once. */
  notifiedRunId: number;
  /** The run currently in flight. */
  promptRunId: number;
}

/**
 * What the hook must do, in order. Each name maps to one existing hook helper;
 * this module decides which of them run and when, never how.
 */
export type AgentLifecycleEffect =
  | "cancel-grace"
  | "enter-waiting-model"
  | "stream-start"
  | "stream-end"
  | "clear-phase"
  | "clear-retry"
  | "clear-compacting"
  | "clear-optimistic-user-message"
  | "settle-ui"
  | "reload-session"
  | "reload-agent-state"
  | "schedule-close"
  | "notify-agent-end";

export interface AgentLifecycleTransition {
  next: AgentLifecycleState;
  effects: AgentLifecycleEffect[];
}

/**
 * Decide how one lifecycle event moves the turn along.
 *
 * The subtle part is what *doesn't* end a turn. A single logical prompt can emit
 * several `agent_end` events before it retries, compacts, or drains messages an
 * extension queued, so `agent_end` never settles the UI or closes the stream —
 * only `agent_settled` and `prompt_done` do, and each defers to the other when
 * the other still has work in flight.
 */
export function agentLifecycleTransition(
  event: AgentLifecycleEvent,
  state: AgentLifecycleState,
): AgentLifecycleTransition {
  switch (event) {
    case "agent_start":
      return {
        next: { ...state, sdkAgentActive: true, agentRunning: true },
        effects: ["cancel-grace", "enter-waiting-model", "stream-start"],
      };

    case "agent_end": {
      // A turn that is not running has already been settled by a previous
      // event; a late agent_end must not resurrect or re-end it.
      if (!state.agentRunning) return { next: state, effects: [] };
      return {
        next: state,
        effects: ["clear-phase", "clear-retry", "stream-end", "reload-session", "reload-agent-state"],
      };
    }

    case "agent_settled": {
      const settled = { ...state, sdkAgentActive: false };
      // Nothing was active, or a prompt-level command is still running and owns
      // the completion transition instead.
      if (!state.sdkAgentActive || state.rpcPromptPending) {
        return { next: settled, effects: [] };
      }
      const effects: AgentLifecycleEffect[] = [
        "settle-ui",
        "clear-compacting",
        "reload-session",
        "schedule-close",
      ];
      if (state.agentRunning) effects.push("notify-agent-end");
      return { next: { ...settled, agentRunning: false }, effects };
    }

    case "prompt_done": {
      const next = { ...state, rpcPromptPending: false };
      const effects: AgentLifecycleEffect[] = ["clear-optimistic-user-message"];

      const firstNotification = state.notifiedRunId !== state.promptRunId;
      if (firstNotification) {
        next.notifiedRunId = state.promptRunId;
        effects.push("notify-agent-end");
      }
      // Nothing was pending and this run was already announced: a duplicate.
      if (!state.rpcPromptPending && !firstNotification) return { next, effects };

      effects.push("reload-session");
      // An extension-injected agent may already have started before the
      // command's prompt_done. Leave that active stage visible and let its own
      // agent_settled perform the next completion transition.
      if (!state.sdkAgentActive) {
        next.agentRunning = false;
        effects.push("settle-ui", "schedule-close");
      }
      return { next, effects };
    }
  }
}
