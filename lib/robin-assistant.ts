/**
 * The Robin assistant's session machinery.
 *
 * Extracted from the route so the scoring runner can drive a turn directly
 * instead of making pi-web call its own HTTP endpoint — which would have to
 * get past the same basic auth that protects it from everyone else.
 */
import { mkdirSync } from "node:fs";
import {
  dataDir,
  readJobProfile,
  readAssistantSessionId,
  readCoachSessionId,
  readDailyAgendaSessionId,
  readJobScorerSessionId,
  readMailReviewSessionId,
  readMentorSessionId,
  writeAssistantSessionId,
  writeCoachSessionId,
  writeDailyAgendaSessionId,
  writeJobScorerSessionId,
  writeMailReviewSessionId,
  writeMentorSessionId,
} from "@/extension/robin/store";
import {
  ROBIN_COACH_TOOL_NAMES,
  ROBIN_MAIL_TOOL_NAMES,
  ROBIN_MENTOR_TOOL_NAMES,
  ROBIN_READ_ONLY_TOOL_NAMES,
  ROBIN_SCORING_TOOL_NAMES,
  ROBIN_TOOL_NAMES,
} from "@/extension/robin/tools";
import { getRpcSession, startRpcSession, type AgentSessionWrapper } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";

/** A dashboard command is a sentence, not a coding task; well under a minute. */
const TURN_TIMEOUT_MS = 90_000;

/**
 * Scoring is a batch, not a sentence: one turn walks a dozen postings and
 * calls a tool for each. It is also unattended — nobody is watching a spinner —
 * so it gets room to finish rather than being cut off halfway through a batch,
 * which would leave half the jobs unscored and invisible.
 */
const SCORING_TIMEOUT_MS = 300_000;

/**
 * The mail review reads a day's worth of mail and writes todos/events; it is
 * more work than a sentence but less than a scoring batch. Generous enough for
 * a full inbox day, short enough not to hang the page forever.
 */
const MAIL_TIMEOUT_MS = 180_000;
const MAIL_MODEL = { provider: "deepseek", modelId: "deepseek-v4-flash" } as const;

const TOOL_NAMES = [...ROBIN_TOOL_NAMES];

/**
 * Who the coach is, sent once when its session is created.
 *
 * Once, not every turn: the session is long-lived, so re-sending this would
 * pay for it on every message forever. The tools carry the operational rules
 * (the hint ladder lives in `practice_current`'s guidelines, which pi injects
 * whenever the tool is active); this preamble carries only what a tool
 * description has no place to say — who is being talked to and what the point
 * of the whole conversation is.
 */
const COACH_PREAMBLE = [
  "You are this user's coding coach: a senior Python and full-stack engineer sitting next to them while they work through the NeetCode roadmap.",
  "",
  "Two jobs, in this order. First, the problem in front of them — coach it, never solve it for them; climb the hint ladder in your tool guidelines one rung at a time and stop as soon as they are moving again. Second, the engineer they are becoming: idiomatic Python, complexity they can derive rather than recite, naming and structure you would accept in review, and the occasional short aside on how the same idea shows up in real systems.",
  "",
  "Reply in the language they write in. Keep answers short — this is a side panel next to a problem, not an article. Ask before assuming; they would rather be questioned than lectured.",
].join("\n");

/**
 * Who the mentor is, sent once when its session is created.
 *
 * The counterpart to the coach, and written against it. The coach withholds
 * because a problem someone else solves teaches nothing; the mentor is being
 * asked "what is this and why does it matter", where withholding is just being
 * unhelpful. What it holds onto instead is the transfer: no explanation of a
 * tutorial page is finished until it has been connected to a decision someone
 * makes in a real system.
 */
const MENTOR_PREAMBLE = [
  "You are this user's engineering mentor: a staff engineer who has designed and operated real systems, sitting next to them while they work through a curriculum that runs from JavaScript fundamentals to architecture and system design.",
  "",
  "Three jobs, in this order. First, the thing in front of them — explain it properly, with a concrete example, and check it landed by asking them to apply it once. Second, the shape of the whole: every answer gets anchored to the outcome its module names, so they are building a capability rather than finishing pages. Third, the transfer — take the idea up a level to where it decides something in a real system: what breaks at scale, where a boundary belongs, what a trade-off costs. That last part is what reading alone never produces, and it is why this track exists.",
  "",
  "Use their own codebase as the example wherever a concept appears in it; Robin and Pi Web are better material than an invented shop-and-orders domain. Nothing on this side is tracked — no progress, no status, no counts — so never claim to have recorded anything and never tell them how far along they are. You cannot know, and a guess dressed as a number is worse than silence.",
  "",
  "Reply in the language they write in. Keep answers short — this is a side panel next to what they are reading, not an article.",
].join("\n");

/**
 * Which tools a turn gets, and which session it runs in.
 *
 * The session is part of the mode, not an afterthought. `scoring` reads
 * employer-authored job descriptions, so it runs in its own session: anything
 * a posting tries to talk the model into dies with that turn instead of
 * sitting in the history of the assistant you chat with afterwards.
 */
export const MODES = {
  default: {
    toolNames: TOOL_NAMES,
    read: readAssistantSessionId,
    write: writeAssistantSessionId,
    timeoutMs: TURN_TIMEOUT_MS,
  },
  readOnly: {
    toolNames: [...ROBIN_READ_ONLY_TOOL_NAMES],
    read: readDailyAgendaSessionId,
    write: writeDailyAgendaSessionId,
    timeoutMs: TURN_TIMEOUT_MS,
  },
  scoring: {
    toolNames: [...ROBIN_SCORING_TOOL_NAMES],
    read: readJobScorerSessionId,
    write: writeJobScorerSessionId,
    timeoutMs: SCORING_TIMEOUT_MS,
    /**
     * Every scoring round starts from nothing.
     *
     * Scoring is stateless by nature — read the rubric, read the CV, read
     * forty postings, emit forty numbers — and resuming the previous round
     * buys nothing while costing everything: the session grew from 1.3k
     * tokens to 163k over five nights, re-reading every posting ever scored
     * on every subsequent turn, and descriptions make that grow several times
     * faster. It also undoes the isolation this mode exists for, since a
     * posting's text would otherwise sit in the history of the next round.
     *
     * The last session id is still recorded, so a bad batch can be traced.
     */
    stateless: true,
  },
  coach: {
    toolNames: [...ROBIN_COACH_TOOL_NAMES],
    read: readCoachSessionId,
    write: writeCoachSessionId,
    timeoutMs: TURN_TIMEOUT_MS,
    preamble: COACH_PREAMBLE,
  },
  mentor: {
    toolNames: [...ROBIN_MENTOR_TOOL_NAMES],
    read: readMentorSessionId,
    write: writeMentorSessionId,
    timeoutMs: TURN_TIMEOUT_MS,
    preamble: MENTOR_PREAMBLE,
  },
  mail: {
    toolNames: [...ROBIN_MAIL_TOOL_NAMES],
    read: readMailReviewSessionId,
    write: writeMailReviewSessionId,
    timeoutMs: MAIL_TIMEOUT_MS,
  },
} as const;

export type AssistantMode = keyof typeof MODES;

/** `readOnly: true` predates `mode` and still means the daily-agenda mode. */
export function resolveMode(body: { mode?: unknown; readOnly?: unknown }): AssistantMode {
  if (typeof body.mode === "string" && body.mode in MODES) return body.mode as AssistantMode;
  return body.readOnly === true ? "readOnly" : "default";
}

interface AgentEventLike {
  type: string;
  [key: string]: unknown;
}

/**
 * Acquire the assistant session, restricted to the Robin tools.
 *
 * `set_tools` is re-sent on every acquisition rather than trusted from session
 * creation: a session restored from its file comes back with pi's default tool
 * set, which includes bash. Re-applying the allow-list here is what keeps the
 * restriction true for the life of the session.
 */
async function acquireSession(
  toolNames: string[],
  remembered: string | null,
  remember: (sessionId: string) => void,
  model?: { provider: string; modelId: string } | null,
): Promise<{ session: AgentSessionWrapper; sessionId: string; fresh: boolean }> {
  /**
   * Re-sent on every acquisition, like the tool list and for the same reason:
   * a session restored from its file comes back on whatever pi defaults to, so
   * pinning it once at creation would silently stop applying.
   */
  const applyModel = async (session: AgentSessionWrapper) => {
    if (!model) return;
    try {
      await session.send({ type: "set_model", provider: model.provider, modelId: model.modelId });
    } catch (error) {
      // A model that has been removed or renamed must not take the whole
      // assistant run down — falling back to the default still completes it.
      console.error(
        `[robin] pinned model ${model.provider}/${model.modelId} unavailable, using the default:`,
        error instanceof Error ? error.message : error,
      );
    }
  };

  if (remembered) {
    const live = getRpcSession(remembered);
    if (live?.isAlive()) {
      await live.send({ type: "set_tools", toolNames, exact: true });
      await applyModel(live);
      return { session: live, sessionId: remembered, fresh: false };
    }
    const filePath = await resolveSessionPath(remembered);
    if (filePath) {
      const { session, realSessionId } = await startRpcSession(remembered, filePath, undefined, {
        toolNames,
        exactTools: true,
      });
      await session.send({ type: "set_tools", toolNames, exact: true });
      await applyModel(session);
      return { session, sessionId: realSessionId, fresh: false };
    }
    // Remembered id no longer resolves (session deleted, agent dir moved): fall
    // through and start a fresh one rather than failing the request.
  }

  const cwd = dataDir();
  mkdirSync(cwd, { recursive: true });
  const { session, realSessionId } = await startRpcSession(
    `__robin_assistant__${Date.now()}`,
    "",
    cwd,
    { toolNames, exactTools: true, ...(model ? { initialModel: model } : {}) },
  );
  remember(realSessionId);
  return { session, sessionId: realSessionId, fresh: true };
}

function textFromMessage(message: unknown): string {
  if (typeof message !== "object" || message === null) return "";
  const { role, content } = message as { role?: unknown; content?: unknown };
  if (role !== "assistant") return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text: string } =>
      typeof block === "object" && block !== null
      && (block as { type?: unknown }).type === "text"
      && typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
    .join("");
}

/**
 * Send the prompt and wait for the run to finish.
 *
 * `send({type:"prompt"})` resolves once pi accepts the submission, not when the
 * turn ends, so completion has to come off the event stream. Waiting here keeps
 * the browser on a plain request/response instead of a second SSE client.
 */
async function runTurn(
  session: AgentSessionWrapper,
  message: string,
  images: Array<{ type: "image"; data: string; mimeType: string }> = [],
  timeoutMs: number = TURN_TIMEOUT_MS,
): Promise<{ reply: string; usedTools: string[] }> {
  const chunks: string[] = [];
  const usedTools: string[] = [];

  return await new Promise<{ reply: string; usedTools: string[] }>((resolve, reject) => {
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      outcome();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error("The assistant took too long to respond."))),
      timeoutMs,
    );

    const unsubscribe = session.onEvent((event: AgentEventLike) => {
      if (event.type === "message_end") {
        const text = textFromMessage(event.message);
        if (text) chunks.push(text);
        return;
      }
      if (event.type === "tool_execution_end" && typeof event.toolName === "string") {
        usedTools.push(event.toolName);
        return;
      }
      // `prompt_done` is the wrapper's own end-of-run signal; `agent_settled`
      // also covers runs an extension injected without one.
      if (event.type === "prompt_done" || event.type === "agent_settled") {
        finish(() => resolve({ reply: chunks.join("\n\n").trim(), usedTools }));
      }
    });

    session.send({
      type: "prompt",
      message,
      ...(images.length > 0 ? { images } : {}),
    }).catch((error: unknown) => {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    });
  });
}


/** One turn, in the mode's own session, with the mode's own tools and model. */
export async function runAssistantTurn(
  modeName: AssistantMode,
  message: string,
  images: Array<{ type: "image"; data: string; mimeType: string }> = [],
): Promise<{ reply: string; usedTools: string[]; sessionId: string }> {
  const mode = MODES[modeName];
  const stateless = "stateless" in mode && mode.stateless === true;
  const model = modeName === "scoring"
    ? readJobProfile().scoreModel
    : modeName === "mail" ? MAIL_MODEL : null;
  const { session, sessionId, fresh } = await acquireSession(
    [...mode.toolNames],
    stateless ? null : mode.read(),
    mode.write,
    model,
  );
  // A mode's preamble belongs to the session, not to the turn: it rides along
  // with the first message of a new one and is never repeated, because
  // everything after that turn can already see it in the history.
  const preamble = fresh && "preamble" in mode ? mode.preamble : null;
  const prompt = preamble ? `${preamble}\n\n---\n\n${message}` : message;
  const { reply, usedTools } = await runTurn(session, prompt, images, mode.timeoutMs);
  return { reply, usedTools, sessionId };
}

/**
 * One turn for a caller whose session key is data-driven rather than one of the
 * fixed dashboard personas above (for example, one product-agent session per
 * product). The caller still supplies an exact allow-list; this helper never
 * falls back to coding tools.
 */
export async function runScopedAssistantTurn(options: {
  remembered: string | null;
  remember: (sessionId: string) => void;
  toolNames: string[];
  message: string;
  preamble: string;
  images?: Array<{ type: "image"; data: string; mimeType: string }>;
  timeoutMs?: number;
}): Promise<{ reply: string; usedTools: string[]; sessionId: string }> {
  const { session, sessionId, fresh } = await acquireSession(
    options.toolNames,
    options.remembered,
    options.remember,
  );
  const prompt = fresh ? `${options.preamble}\n\n---\n\n${options.message}` : options.message;
  const result = await runTurn(session, prompt, options.images ?? [], options.timeoutMs ?? TURN_TIMEOUT_MS);
  return { ...result, sessionId };
}
