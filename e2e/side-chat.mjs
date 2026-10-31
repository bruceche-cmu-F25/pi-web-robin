// Existing dev server; every application API is mocked. No paid prompts or session writes.
// node --env-file-if-exists=.env.local e2e/side-chat.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  if (process.env.PI_WEB_PASSWORD) assert.ok((await context.request.post("/api/web-auth", { headers: { Origin: baseURL }, data: { password: process.env.PI_WEB_PASSWORD } })).ok());
  await context.addInitScript(() => {
    localStorage.setItem("pi-locale", "en");
    localStorage.setItem("pi-quote-selection-enabled", "false");
    localStorage.setItem("pi-tool-preset", "full");
    window.__streams = [];
    window.EventSource = class {
      readyState = 1;
      constructor(url) {
        this.url = url; window.__streams.push(this);
        setTimeout(() => this.emit({ type: "connected", isStreaming: false }), 10);
      }
      emit(data) { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(data) }); }
      close() { this.readyState = 2; }
    };
  });
  const cwd = "/tmp/side-chat-fixture", id = "main-side-chat-fixture", timestamp = new Date().toISOString();
  const model = { provider: "fixture", modelId: "concept-model" };
  const answer = Array.from({ length: 22 }, (_, i) => `Paragraph ${i}: A client may repeat a request after a timeout. The server must handle repeated requests carefully without applying the operation twice. Retries are normal in a distributed system.`).join("\n\n")
    + "\n\nThe key concept is **idempotency**. Multiple identical requests have the same effect as one request.\n\n"
    + Array.from({ length: 18 }, (_, i) => `Example ${i}: A payment endpoint remembers the request key and returns the earlier result. This keeps the explanation anchored while the column changes width.`).join("\n\n");
  const assistant = text => ({ role: "assistant", content: [{ type: "text", text }], model: model.modelId, provider: model.provider, timestamp: Date.now(), stopReason: "stop" });
  const mainMessages = [{ role: "user", content: "UNRELATED_PRIVATE_HISTORY" }, assistant("An unrelated answer."), { role: "user", content: "How do I design a payment retry API?" }, assistant(answer)];
  const info = { id, cwd, projectKey: cwd, projectRoot: cwd, path: `${cwd}/main.jsonl`, name: "Main discussion", created: timestamp, modified: timestamp, messageCount: mainMessages.length, firstMessage: "UNRELATED_PRIVATE_HISTORY" };
  const sessions = new Map([[id, { info, messages: mainMessages, entryIds: ["old-u", "old-a", "question", "answer"], running: false }]]);
  const writes = [], creates = [], prompts = [];
  let rejectNext = false;
  await context.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const body = req.method() === "POST" ? req.postDataJSON() : null;
    if (req.method() !== "GET") writes.push({ path, body });
    if (path === "/api/cwd/validate") return route.fulfill({ json: { cwd: body.cwd } });
    if (path === "/api/sessions") return route.fulfill({ json: { sessions: [info], runningSessionIds: [], sessionListVersion: 1 } });
    if (path === "/api/sessions/ui-state") return route.fulfill({ json: { version: 1, revision: 0, sessions: {}, projects: {} } });
    if (path === "/api/agent/running") return route.fulfill({ json: { runningSessionIds: [...sessions].filter(([, s]) => s.running).map(([id]) => id), awaitingInputSessionIds: [], sessionListVersion: 1 } });
    if (path === "/api/models") return route.fulfill({ json: { models: { "fixture/concept-model": "Concept model" }, modelList: [{ id: model.modelId, name: "Concept model", provider: model.provider }], defaultModel: model } });
    if (path === "/api/worktrees") return route.fulfill({ json: { worktrees: [], projectRoot: cwd, projectKey: cwd, currentWorktreePath: cwd } });
    if (path === "/api/agent/new") {
      creates.push(body);
      const sid = `side-${creates.length}`;
      sessions.set(sid, { info: { ...info, id: sid, messageCount: 0 }, messages: [], entryIds: [], running: false });
      return route.fulfill({ json: { success: true, sessionId: sid, model, thinkingLevel: "off" } });
    }
    const sessionPath = path.match(/^\/api\/sessions\/([^/]+)(?:\/(state|context))?$/);
    if (sessionPath && sessions.has(sessionPath[1])) {
      const sid = sessionPath[1], s = sessions.get(sid);
      if (sessionPath[2] === "state") return route.fulfill({ json: { running: s.running, state: { isStreaming: s.running, isPromptRunning: s.running } } });
      return route.fulfill({ json: { info: s.info, sessionId: sid, leafId: s.entryIds.at(-1) ?? null, tree: [], toolNames: sid === id ? undefined : [], context: { messages: s.messages, entryIds: s.entryIds, oldestEntryId: s.entryIds[0] ?? null, hasMore: false, thinkingLevel: "off", model }, totalActiveMs: 0 } });
    }
    const agentPath = path.match(/^\/api\/agent\/([^/]+)$/);
    if (agentPath && sessions.has(agentPath[1])) {
      const sid = agentPath[1], s = sessions.get(sid);
      if (req.method() === "GET") return route.fulfill({ json: { running: s.running, state: { isStreaming: s.running, isPromptRunning: s.running } } });
      if (body.type === "prompt") {
        prompts.push({ sid, message: body.message });
        if (rejectNext) { rejectNext = false; return route.fulfill({ status: 400, json: { error: "Fixture rejected prompt", code: "prompt_rejected", accepted: false } }); }
        s.messages.push({ role: "user", content: [{ type: "text", text: body.message }], timestamp: Date.now() });
        s.entryIds.push(`u-${s.messages.length}`); s.running = true;
      }
      if (body.type === "abort") s.running = false;
      if (body.type === "set_session_name") s.info.name = body.name;
      return route.fulfill({ json: { success: true, data: body.type === "get_tools" ? { tools: [] } : { model: { provider: model.provider, id: model.modelId }, isStreaming: s.running } } });
    }
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage(); page.setDefaultTimeout(30_000);
  const errors = []; page.on("pageerror", e => { errors.push(e.message); console.error("PAGE ERROR:", e.stack); });
  page.on("console", message => { if (message.type() === "error") console.error("CONSOLE:", message.text()); });
  const emit = (sid, events) => page.evaluate(({ sid, events }) => {
    for (const stream of window.__streams) if (stream.url.includes(`/api/agent/${sid}/events`)) for (const event of events) stream.emit(event);
  }, { sid, events });
  const finish = async (sid, text) => {
    const s = sessions.get(sid), message = assistant(text);
    s.messages.push(message); s.entryIds.push(`a-${s.messages.length}`); s.running = false;
    await emit(sid, [{ type: "message_end", message }, { type: "agent_end" }, { type: "prompt_done", aborted: false }]);
  };
  const waitCount = async (list, count) => {
    for (let i = 0; i < 300 && list.length < count; i++) await page.waitForTimeout(50);
    assert.equal(list.length, count);
  };
  const select = async (word = "idempotency") => {
    return page.evaluate(word => {
      const answer = document.querySelector('[data-message-role="assistant"][data-entry-id="answer"]');
      const walker = document.createTreeWalker(answer, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const at = node.textContent.indexOf(word);
        if (at < 0) continue;
        const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + word.length);
        const scroll = answer.closest(".overflow-y-auto");
        scroll.scrollTop += range.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 180;
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        answer.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
        window.__sourceRange = range.cloneRange();
        return range.getBoundingClientRect().top;
      }
      throw new Error("word not found");
    }, word);
  };
  const assertExplainLabelFits = async () => {
    const button = page.getByRole("button", { name: "Explain this", exact: true });
    await button.waitFor();
    const layouts = await button.evaluate(button => {
      const original = button.textContent;
      try {
        return ["Explain this", "解释一下", "解釋一下"].map(label => {
          button.textContent = label;
          const range = document.createRange(); range.selectNodeContents(button);
          const text = range.getBoundingClientRect(), box = button.getBoundingClientRect();
          return { label, lines: range.getClientRects().length,
            fits: text.left >= box.left && text.right <= box.right && text.top >= box.top && text.bottom <= box.bottom };
        });
      } finally { button.textContent = original; }
    });
    for (const layout of layouts) {
      assert.equal(layout.lines, 1, `${layout.label} must stay on one line`);
      assert.ok(layout.fits, `${layout.label} must fit inside the explanation button`);
    }
  };
  const sourceTop = () => page.evaluate(() => window.__sourceRange.getClientRects()[0].top);
  const side = page.getByRole("region", { name: "Side chat", exact: true });
  await page.goto(`/?session=${id}`);
  // Next's dev-only badge otherwise covers the bottom-right Send button.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.locator('[data-entry-id="answer"][data-message-role="assistant"]').waitFor();
  await page.locator(".chat-input-shell textarea").fill("Keep this unsent main draft");
  const before = await select();
  await assertExplainLabelFits();
  await page.getByRole("button", { name: "Explain this", exact: true }).click();
  await side.waitFor();
  await waitCount(prompts, 1);
  assert.equal(creates.length, 1, "Strict Mode must not duplicate session creation");
  assert.deepEqual(creates[0].toolNames, [], "explicitly chat-only, not the preferred tools");
  assert.equal(creates[0].sideChat, true, "dedicated project-free policy must reach the server");
  assert.equal(creates[0].provider, model.provider);
  assert.equal(creates[0].modelId, model.modelId);
  assert.equal(prompts[0].sid, "side-1");
  const snapshot = JSON.parse(prompts[0].message.split("REFERENCE JSON:\n\n")[1]);
  assert.equal(snapshot.selection, "idempotency");
  assert.equal(snapshot.answer, answer);
  assert.equal(snapshot.question, "How do I design a payment retry API?");
  assert.ok(!prompts[0].message.includes("UNRELATED_PRIVATE_HISTORY"));
  await page.waitForTimeout(500);
  assert.ok(Math.abs(await sourceTop() - before) < 5, `opening reflow lost reading anchor: ${before} -> ${await sourceTop()}`);
  assert.equal(new URL(page.url()).searchParams.get("session"), id);
  assert.equal(await page.locator(".chat-input-shell textarea").inputValue(), "Keep this unsent main draft");
  await emit("side-1", [
    { type: "message_start", message: { ...assistant(""), content: [] } },
    { type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Idempotency means retrying" } },
  ]);
  await side.getByText("Idempotency means retrying", { exact: true }).waitFor();
  await finish("side-1", "Idempotency means retrying a payment never charges twice.");
  await side.getByText("Idempotency means retrying a payment never charges twice.", { exact: true }).waitFor();
  await side.getByRole("button", { name: "Send", exact: true }).waitFor();
  assert.ok(!(await side.textContent()).includes("REFERENCE JSON"), "persisted block-array seed must stay out of the transcript");
  assert.equal(await page.evaluate(() => localStorage.getItem("pi-tool-preset")), "full", "side chat must not change the user's preferred tools");
  await side.locator("textarea").fill("How is the request key chosen?");
  if (process.env.SIDE_CHAT_DEBUG) {
    await page.screenshot({ path: "/tmp/side-chat-debug.png" });
  }
  await side.getByRole("button", { name: "Send", exact: true }).click();
  await waitCount(prompts, 2);
  assert.equal(prompts[1].sid, "side-1");
  assert.equal(prompts[1].message, "How is the request key chosen?");
  await finish("side-1", "The client generates a unique key per intended payment.");
  await side.getByText("The client generates a unique key per intended payment.", { exact: true }).waitFor();
  await side.locator("textarea").fill("Unsent side question");
  await side.getByRole("button", { name: "Back to reading" }).click();
  await page.waitForTimeout(400);
  assert.ok(Math.abs(await sourceTop() - before) < 5, "closing reflow lost reading anchor");
  await page.getByRole("button", { name: "Show file panel", exact: true }).click();
  await side.waitFor();
  assert.equal(await side.locator("textarea").inputValue(), "Unsent side question");
  assert.equal(prompts.length, 2, "reopening must not repeat the seed");
  rejectNext = true;
  await side.locator("textarea").fill("!value is what?");
  await side.getByRole("button", { name: "Send", exact: true }).click();
  await waitCount(prompts, 3);
  await side.getByText("Fixture rejected prompt", { exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('section[aria-label="Side chat"] textarea')].some(el => el.value === "!value is what?"));
  assert.ok(prompts[2].message.startsWith("Explain this literal question"));
  assert.ok(!writes.some(w => w.body?.type === "bash"), "literal questions must not execute commands");
  await side.getByRole("button", { name: "Back to reading" }).click();
  // Invalid cross-message selection must not offer an explanation.
  await page.evaluate(() => {
    const a = document.querySelector('[data-message-role="assistant"][data-entry-id="old-a"] [data-message-text]');
    const b = document.querySelector('[data-message-role="assistant"][data-entry-id="answer"] [data-message-text]');
    const range = document.createRange(); range.setStartBefore(a); range.setEndAfter(b);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    b.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await page.waitForTimeout(250);
  assert.equal(await page.getByRole("button", { name: "Explain this", exact: true }).count(), 0);
  // Phone: a fresh explanation uses the existing full-screen right panel.
  await page.setViewportSize({ width: 390, height: 844 });
  await select("identical requests");
  await assertExplainLabelFits();
  await page.getByRole("button", { name: "Explain this", exact: true }).click();
  await waitCount(prompts, 4);
  assert.equal(creates.length, 2);
  assert.equal(prompts[3].sid, "side-2");
  const mobileSide = page.getByRole("region", { name: "Side chat", exact: true });
  await finish("side-2", "Repeated identical requests do not add another effect.");
  await mobileSide.getByText("Repeated identical requests do not add another effect.", { exact: true }).waitFor();
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [width, height, theme] of [[320, 740, "dark"], [375, 812, "light"], [844, 390, "dark"]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.waitForTimeout(150);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px has horizontal overflow`);
    const sendBox = await mobileSide.getByRole("button", { name: "Send", exact: true }).boundingBox();
    assert.ok(sendBox && sendBox.y >= 0 && sendBox.y + sendBox.height <= height, `${width}px Send is outside viewport`);
    if (process.env.SIDE_CHAT_DEBUG) await page.screenshot({ path: `/tmp/side-chat-${width}-${theme}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await mobileSide.getByRole("button", { name: "Back to reading" }).click();
  assert.equal(new URL(page.url()).searchParams.get("session"), id);
  // Initial rejection offers an explicit retry, never dumps the context into
  // the draft or admits a follow-up without the background.
  rejectNext = true;
  await select("same effect");
  await page.getByRole("button", { name: "Explain this", exact: true }).click();
  await waitCount(prompts, 5);
  await side.getByRole("button", { name: "Retry explanation" }).waitFor();
  assert.equal(await side.locator("textarea").isDisabled(), true);
  assert.equal(await side.locator("textarea").inputValue(), "");
  await side.getByRole("button", { name: "Retry explanation" }).click();
  await waitCount(prompts, 6);
  assert.equal(creates.length, 3);
  assert.equal(prompts[5].sid, "side-3");
  await finish("side-3", "The operation has the same outcome.");
  await side.getByText("The operation has the same outcome.", { exact: true }).waitFor();
  await side.locator("textarea").fill("/api is a command or a path?");
  await side.getByRole("button", { name: "Send", exact: true }).click();
  await waitCount(prompts, 7);
  sessions.get(id).running = true;
  await emit(id, [{ type: "agent_start" }]);
  await side.locator("textarea").press("Escape");
  await page.waitForTimeout(150);
  assert.equal(writes.filter(w => w.path === "/api/agent/side-3" && w.body?.type === "abort").length, 1, "Escape stops the side run exactly once");
  await emit("side-3", [{ type: "prompt_done", aborted: true }]);
  await side.getByRole("button", { name: "Back to reading" }).click();
  assert.ok(!writes.some(w => w.path === `/api/agent/${id}` && ["prompt", "fork", "fork_branch", "abort", "set_session_name"].includes(w.body?.type)), "main session must never be written or stopped");
  assert.deepEqual(errors, []);
  console.log("PASS: isolated context, strict-mode single send, streaming/follow-up, safe literal text, rejection draft, preserved main draft/URL/reading anchor, reopen and phone layout");
} finally { await browser.close(); }
