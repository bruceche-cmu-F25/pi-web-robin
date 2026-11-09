import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { promisify } from "node:util";
import { applicationBrowserDirectory } from "../extension/robin/job-application-domain.ts";

const exec = promisify(execFile);
const envKeys = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR", "DISPLAY", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "LOCALAPPDATA", "APPDATA"];
const env = (): NodeJS.ProcessEnv => ({ NODE_ENV: process.env.NODE_ENV, ...Object.fromEntries(envKeys.filter((key) => process.env[key]).map((key) => [key, process.env[key]])) });

type Reply = Record<string, unknown>;
type Command = (args: string[], signal?: AbortSignal) => Promise<Reply>;

async function command(args: string[], signal?: AbortSignal): Promise<Reply> {
  const cwd = applicationBrowserDirectory();
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  try {
    const { stdout } = await exec("bsk", [...args, "--json"], { cwd, env: env(), signal, timeout: 60_000, maxBuffer: 2_000_000 });
    const result: unknown = JSON.parse(stdout);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid reply");
    return result as Reply;
  } catch (error) {
    // Never expose page text, extension connection details or raw transport output.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("BSK_CLI_MISSING: bsk is not on the Pi Web service PATH");
    let code = "transport", reason = "unknown", effect = "unknown";
    try {
      const reply = JSON.parse(String((error as { stdout?: unknown }).stdout ?? "")) as { code?: unknown; data?: { reason?: unknown; effect_state?: unknown } };
      if (typeof reply.code === "string" && /^[a-z_]{1,50}$/.test(reply.code)) code = reply.code;
      if (typeof reply.data?.reason === "string" && /^[a-z_]{1,50}$/.test(reply.data.reason)) reason = reply.data.reason;
      if (typeof reply.data?.effect_state === "string" && /^[a-z_]{1,50}$/.test(reply.data.effect_state)) effect = reply.data.effect_state;
    } catch { /* Unparseable output is unknown, never proof of no effect. */ }
    throw new Error(`BSK ${args[0]} failed (${code}/${reason}/${effect}); action not replayed`);
  }
}

/** Fail a batch before any reservation if the CLI or the configured Chrome extension is absent. */
export async function assertBskApplicationBrowserReady(browser: string, signal?: AbortSignal, run: Command = command): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(browser)) throw new Error("BSK_BROWSER_UNAVAILABLE: no verified browser instance configured");
  const reply = await run(["status"], signal);
  const browsers = reply.browsers;
  if (!Array.isArray(browsers) || !browsers.some((item) => item && typeof item === "object"
    && item.instance_id === browser && item.unresponsive === false && item.version_skew !== true)) {
    throw new Error("BSK_BROWSER_UNAVAILABLE: configured Chrome instance is disconnected or unresponsive");
  }
}

/** One owned Agent Window per job. No reuse of another job's form, and no action is replayed on failure. */
export async function withBskApplicationSession<T>(work: (session: BskApplicationSession) => Promise<T>,
  options: { signal?: AbortSignal; run?: Command; browser?: string } = {}): Promise<T> {
  const run = options.run ?? command;
  options.signal?.throwIfAborted();
  if (options.browser && !/^[a-zA-Z0-9_-]{1,80}$/.test(options.browser)) throw new Error("Invalid BSK browser instance");
  const started = await run(["session", "start", "--name", "Robin Jobright application", ...(options.browser ? ["--browser", options.browser] : [])], options.signal);
  const id = started.session_id;
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error("BSK did not return a usable session id");
  try {
    return await work(new BskApplicationSession(id, run, options.signal));
  } finally {
    // A stopped/aborted run still owns its Agent Window. Do not use the aborted signal for cleanup.
    await run(["session", "stop", id]).catch(() => {});
  }
}

export class BskApplicationSession {
  private context?: string;
  private observation?: string;
  private lastText?: string;
  private ownedTab?: number;
  readonly id: string;
  private readonly run: Command;
  private readonly signal?: AbortSignal;
  constructor(id: string, run: Command, signal?: AbortSignal) {
    this.id = id; this.run = run; this.signal = signal;
  }

  async navigate(url: string): Promise<void> {
    // Jobright opens Quick Apply in a new, unowned popup. Observe that URL, then navigate
    // OUR original tab to the verified ATS target; never take control of the popup.
    const owned = this.ownedTab;
    if (owned && (!this.context || !this.observation)) await this.sync();
    const args = ["navigate", url, "--session", this.id,
      ...(owned ? ["--tab-id", String(owned), "--context", this.context!, "--observation", this.observation!] : [])];
    this.context = undefined; this.observation = undefined; this.lastText = undefined;
    const reply = await this.run(args, this.signal);
    if (typeof reply.final_url !== "string" || !Number.isSafeInteger(reply.tab_id)) throw new Error("BSK navigation did not finish");
    if (owned && reply.tab_id !== owned) throw new Error("BSK navigated a different tab");
    this.ownedTab = reply.tab_id as number;
  }

  /** Read tab metadata only. Popup tabs must never be controlled by this session. */
  async tabs(): Promise<Array<{ tab_id: number; url: string; scope: string }>> {
    const reply = await this.run(["tab", "list", "--session", this.id, "--scope", "agent"], this.signal);
    const listed = (reply.tabs ?? []) as Array<{ tab_id: number; url: string; scope: string }>;
    if (!Array.isArray(listed)) throw new Error("BSK tab listing failed");
    return listed.filter((tab) => Number.isSafeInteger(tab.tab_id) && typeof tab.url === "string" && tab.scope === "agent");
  }

  async sync(): Promise<string> {
    this.context = undefined; this.observation = undefined;
    const args = ["cooperate", "sync", "--session", this.id, ...(this.ownedTab ? ["--tab-id", String(this.ownedTab)] : []), "--max-tokens", "20000", "--settle"];
    let reply: Reply;
    for (let attempt = 0; ; attempt++) {
      try { reply = await this.run(args, this.signal); }
      catch (error) {
        // A redirect can briefly replace the CDP target. Re-read only; never replay input.
        if (attempt === 2) throw error;
        this.signal?.throwIfAborted();
        await new Promise(resolve => setTimeout(resolve, 250));
        continue;
      }
      if ((reply.state as { mode?: string } | undefined)?.mode !== "unavailable" || attempt === 2) break;
      this.signal?.throwIfAborted();
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const state = reply.state as { mode?: string } | undefined;
    const observation = reply.observation as { text?: string; truncated?: boolean; capture_truncated?: boolean } | undefined;
    const text = reply.kind === "unchanged" && !observation ? this.lastText : observation?.text;
    const reason = state?.mode !== "ready" ? state?.mode === "human" ? "human-control" : "not-ready"
      : typeof reply.context_id !== "string" ? "missing-context"
      : typeof reply.observation_id !== "string" ? "missing-observation"
      : typeof text !== "string" ? "missing-text"
      : observation?.truncated || observation?.capture_truncated ? "truncated" : null;
    if (reason) throw new Error(`BSK cannot safely inspect this page (${reason}); no new browser action was taken`);
    this.context = reply.context_id as string; this.observation = reply.observation_id as string;
    this.lastText = text;
    return text as string;
  }

  /** Read-only browser evaluation; never use this method for clicks or form writes. */
  async read(expression: string): Promise<unknown> {
    if (!this.context || !this.observation) throw new Error("Synchronize BSK before reading the page");
    const evaluate = () => this.run(["evaluate", expression, "--session", this.id,
      ...(this.ownedTab ? ["--tab-id", String(this.ownedTab)] : []), "--context", this.context!, "--observation", this.observation!], this.signal);
    let reply: Reply | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { reply = await evaluate(); break; }
      catch (error) {
        // Only read-only expressions are allowed here. Let a redirect settle;
        // the same rule must never be applied to a click, fill or Submit.
        if (attempt === 2) throw error;
        this.signal?.throwIfAborted();
        await new Promise(resolve => setTimeout(resolve, 250));
        await this.sync();
      }
    }
    if (reply?.ok !== true) throw new Error("BSK page inspection failed");
    return reply.value;
  }

  private async act(action: "click" | "fill" | "select", target: string, value: string | undefined,
    expected: { target: string; field: string; equals: string | boolean }[]): Promise<void> {
    if (!this.context || !this.observation || !expected.length) throw new Error("Synchronize BSK and protect the target before acting");
    const context = this.context;
    // An action can leave the VOM unchanged while Jobright works asynchronously.
    // Keep its text for BSK's `kind: unchanged`; the old control context is still revoked.
    this.context = undefined; this.observation = undefined;
    const args = [action, target,
      ...(action === "fill" || action === "select" ? ["--value", value!] : []),
      "--session", this.id, ...(this.ownedTab ? ["--tab-id", String(this.ownedTab)] : []), "--context", context, "--expect", JSON.stringify(expected)];
    const reply = await this.run(args, this.signal);
    if (reply.ok === false) throw new Error(`BSK ${action} outcome is unknown; observe before any further action`);
  }

  /** Target and expected DOM facts must come from the preceding fresh observation. */
  async click(target: string, expected: { target: string; field: string; equals: string | boolean }[]): Promise<void> {
    await this.act("click", target, undefined, expected);
  }
  async fill(target: string, value: string, expected: { target: string; field: string; equals: string | boolean }[]): Promise<void> {
    await this.act("fill", target, value, expected);
  }
  async select(target: string, value: string, expected: { target: string; field: string; equals: string | boolean }[]): Promise<void> {
    await this.act("select", target, value, expected);
  }
  async press(target: string, key: string, expected: { target: string; field: string; equals: string | boolean }[]): Promise<void> {
    if (!this.context || !this.observation || !expected.length) throw new Error("Synchronize BSK and protect the target before pressing a key");
    const context = this.context;
    this.context = undefined; this.observation = undefined;
    const reply = await this.run(["press", key, "--selector", target, "--session", this.id,
      ...(this.ownedTab ? ["--tab-id", String(this.ownedTab)] : []), "--context", context, "--expect", JSON.stringify(expected)], this.signal);
    if (reply.ok === false) throw new Error("BSK key outcome is unknown; observe before further action");
  }
}
