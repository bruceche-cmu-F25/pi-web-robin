import assert from "node:assert/strict";
import { test } from "node:test";
import * as dates from "../../extension/robin/dates.ts";
import { deferred, findElement, hookHarness, settle } from "../../scripts/react-hook-harness.mjs";

const today = "2026-10-29";
const task = { id: "fixture", title: "Synthetic task", done: false, revision: "v1" };
const completedAt = new Date(2026, 9, 29, 12).toISOString();

function panelHarness({ embedded = false, search = "" } = {}) {
  const requests = [];
  const params = new URLSearchParams(search);
  // Real resource/mutation implementation: transport alone is replaced, including
  // responses that ignore AbortSignal. The panel and resource keep separate hook slots.
  const resource = hookHarness(new URL("./usePolledResource.ts", import.meta.url), {
    "./refreshBus": { onRefreshRequest: () => () => {} },
    "@/hooks/useI18n": { useI18n: () => ({ t: String }) },
  }, {
    Error,
    fetch(url, init = {}) {
      const request = { ...deferred(), url, method: init.method ?? "GET", body: init.body && JSON.parse(init.body), signal: init.signal };
      requests.push(request);
      return request.promise;
    },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    setInterval: () => 1, clearInterval() {},
  });
  let currentResource;
  const panel = hookHarness(new URL("./TodoPanel.tsx", import.meta.url), {
    "next/navigation": { useSearchParams: () => params },
    "@/lib/url-state": { writeUrlState(patch) { for (const [key, value] of Object.entries(patch)) { if (value === null) params.delete(key); else params.set(key, value); } } },
    "@/extension/robin/dates": dates,
    "./TodoDetailsDialog": {},
    "@/hooks/useI18n": { useI18n: () => ({ t: key => key, locale: "en" }) },
    "@/hooks/useIsMobile": { useIsSplitLayout: () => true },
    "@/extension/robin/eventColors": { EVENT_COLOR_KEYS: [] },
    "@/extension/robin/todo-links": { todoUrl: () => "", inferTodoUrl: () => "" },
    "./refreshBus": { requestRefresh() {} },
    "./TodoTitle": {}, "./TodoDragHandle": {}, "./ReadableText": {}, "./usePopoverDismiss": {},
    "./usePolledResource": {
      ...resource.exports,
      usePolledResource: (...args) => (currentResource = resource.render(() => resource.exports.usePolledResource(...args))),
    },
    "./TodoPanel.module.css": { default: {} },
  }, { Error });
  const render = () => panel.render(() => panel.exports.TodoPanel({ embedded }));
  return {
    requests, render, params,
    row: (id = task.id) => findElement(render(), node => node.type?.name === "TodoRow" && node.props.todo.id === id)?.props,
    refresh: () => currentResource.refresh(),
    respond(request, body, status = 200) {
      request.resolve({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });
    },
    async load(todos = [task]) {
      render(); this.respond(requests[0], { today, todos }); await settle(); render();
    },
    failRead() { this.respond(requests.at(-1), { error: "Read offline" }, 503); },
    unmount() { panel.unmount(); resource.unmount(); },
  };
}

test("desktop defaults to upcoming deadlines; phone and explicit filters retain their scope", async () => {
  const todos = [task, { ...task, id: "near", due: dates.addDays(today, 7) },
    { ...task, id: "later", due: dates.addDays(today, 8) }, { ...task, id: "late", due: dates.addDays(today, -1) },
    { ...task, id: "done", done: true, completedAt: "2020-01-01T12:00:00Z" }];
  for (const [options, visible] of [
    [{ embedded: true }, ["near", "late"]],
    [{ embedded: false }, ["fixture", "near", "later", "late"]],
    [{ embedded: true, search: "tasks=all" }, ["fixture", "near", "later", "late"]],
    [{ embedded: true, search: "tasks=done" }, ["done"]],
    [{ embedded: false, search: "tasks=near" }, ["near", "late"]],
  ]) {
    const h = panelHarness(options);
    try {
      await h.load(todos);
      assert.deepEqual(todos.filter(todo => h.row(todo.id)).map(todo => todo.id).sort(), visible.sort());
      assert.equal(h.requests.length, 1, "Filtering makes no writes");
    } finally { h.unmount(); }
  }
});

test("an undated task created in the near view remains visible after its receipt", async () => {
  const h = panelHarness({ embedded: true, search: "tasks=near&session=keep-me" });
  try {
    await h.load([]);
    findElement(h.render(), node => node.props?.["aria-controls"] === "robin-todo-form").props.onClick();
    findElement(h.render(), node => node.type === "input" && node.props.required === true).props.onChange({ target: { value: "New task" } });
    findElement(h.render(), node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(h.params.get("tasks"), "near", "Do not change filters before the save is confirmed");
    h.respond(h.requests.at(-1), { todo: task, today });
    await settle(); h.failRead(); await settle();
    assert.equal(h.params.get("tasks"), "all");
    assert.equal(h.params.get("session"), "keep-me");
    assert.equal(h.row().todo.id, task.id);
  } finally { h.unmount(); }
});

test("a confirmed Todo completion survives a failed refresh", async () => {
  const h = panelHarness();
  try {
    await h.load();
    const reading = h.refresh();
    const stale = h.requests.at(-1);
    const saving = h.row().onToggle();
    assert.equal(h.requests.at(-1).method, "PATCH");
    assert.equal(h.row().todo.done, false, "no optimistic completion before acknowledgement");
    h.respond(h.requests.at(-1), { todo: { ...task, done: true, completedAt, revision: "v2" }, today });
    await settle(); h.failRead(); await saving;
    assert.equal(stale.signal.aborted, true);
    h.respond(stale, { today, todos: [task] }); await reading;
    assert.equal(h.row().todo.done, true);
    assert.equal(h.row().todo.revision, "v2");
    assert.ok(findElement(h.render(), node => node.props?.role === "alert" && node.props.children === "Read offline"));
  } finally { h.unmount(); }
});

for (const done of [false, true]) {
  for (const field of ["color", "url"]) test(`confirmed ${field} changes survive offline reads on done=${done} rows`, async () => {
    const h = panelHarness();
    try {
      const initial = { ...task, done, ...(done ? { completedAt } : {}) };
      await h.load([initial]);
      if (field === "color") h.row().onColor("teal");
      else h.row().onLink("example.com/task");
      const value = field === "color" ? "teal" : "https://example.com/task";
      h.respond(h.requests.at(-1), { todo: { ...initial, [field]: value, revision: "v2" }, today });
      await settle(); h.failRead(); await settle();
      assert.equal(h.row().todo[field], value, "adopt the server-normalized receipt, not the submitted approximation");
    } finally { h.unmount(); }
  });
}

test("a confirmed reopen keeps the task open despite a failed refresh", async () => {
  const h = panelHarness();
  try {
    await h.load([{ ...task, done: true, completedAt }]);
    const saving = h.row().onToggle();
    assert.equal(h.requests.at(-1).body.done, false);
    h.respond(h.requests.at(-1), { todo: { ...task, revision: "v2" }, today });
    await settle(); h.failRead(); await saving;
    assert.equal(h.row().todo.done, false);
  } finally { h.unmount(); }
});

test("a confirmed deletion cannot reappear from an older read or a failed refresh", async () => {
  const h = panelHarness();
  try {
    await h.load();
    const reading = h.refresh(), stale = h.requests.at(-1);
    h.row().onDelete();
    assert.equal(h.requests.at(-1).method, "DELETE");
    assert.ok(h.row(), "retain the row until deletion is acknowledged");
    h.respond(h.requests.at(-1), { success: true });
    await settle(); h.failRead(); await settle();
    h.respond(stale, { today, todos: [task] }); await reading;
    assert.equal(h.row(), undefined);
  } finally { h.unmount(); }
});

test("manual creation retains the saved record and server date when the follow-up read fails", async () => {
  const h = panelHarness();
  try {
    await h.load([]);
    findElement(h.render(), node => node.props?.["aria-controls"] === "robin-todo-form").props.onClick();
    findElement(h.render(), node => node.type === "input" && node.props.required === true).props.onChange({ target: { value: "  New task  " } });
    findElement(h.render(), node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(h.requests.at(-1).method, "POST");
    h.respond(h.requests.at(-1), { todo: { ...task, title: "New task" }, today: "2026-10-30" });
    await settle(); h.failRead(); await settle();
    assert.equal(h.row().todo.title, "New task");
    assert.equal(h.row().today, "2026-10-30");
    assert.equal(findElement(h.render(), node => node.type === "form"), null);
  } finally { h.unmount(); }
});

for (const firstFails of [false, true]) test(`same-Todo writes stay ordered and the queue survives failure=${firstFails}`, async () => {
  const h = panelHarness();
  try {
    await h.load();
    h.row().onColor("teal");
    const first = h.requests.at(-1);
    const saving = h.row().onToggle();
    assert.equal(h.requests.filter(request => request.method === "PATCH").length, 1, "completion must wait for the older color receipt");
    h.respond(first, firstFails ? { error: "Color refused" } : { todo: { ...task, color: "teal", revision: "v2" }, today }, firstFails ? 409 : 200);
    await settle();
    const second = h.requests.filter(request => request.method === "PATCH")[1];
    assert.ok(second);
    h.respond(second, { todo: { ...task, color: firstFails ? undefined : "teal", done: true, completedAt, revision: "v3" }, today });
    await settle();
    for (const request of h.requests.slice(1).filter(request => request.method === "GET")) h.respond(request, { error: "Read offline" }, 503);
    await saving;
    assert.equal(h.row().todo.done, true);
    assert.equal(h.row().todo.revision, "v3");
  } finally { h.unmount(); }
});

test("a rejected mutation retains the record and exposes the write error without a refresh", async () => {
  const h = panelHarness();
  try {
    await h.load();
    const saving = h.row().onToggle();
    h.respond(h.requests.at(-1), { error: "Write refused" }, 409); await saving;
    assert.equal(h.row().todo.done, false);
    assert.equal(h.row().todo.revision, "v1");
    assert.equal(h.requests.length, 2);
    assert.ok(findElement(h.render(), node => node.props?.role === "alert" && node.props.children === "Write refused"));
  } finally { h.unmount(); }
});
