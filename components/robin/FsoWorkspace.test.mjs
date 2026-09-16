import assert from "node:assert/strict";
import { test } from "node:test";
import { FSO_CHAPTERS, chapterForStep, continueChapter, findChapter, nextChapter } from "../../extension/robin/fso.ts";
import { FULLSTACK_STEPS, fullstackPlan } from "../../extension/robin/learning.ts";
import { deferred, findElement, hookHarness, settle } from "../../scripts/react-hook-harness.mjs";

function workspaceHarness(query = "") {
  const requests = [];
  const urls = [];
  const polls = [];
  const Roadmap = () => null;
  const Mentor = () => null;
  const Editor = () => null;
  const fso = { data: { notes: {}, fullstack: fullstackPlan([]) }, error: null, refresh: async () => {} };
  const fetch = (url, options) => {
    const pending = deferred();
    requests.push({ ...pending, url, body: JSON.parse(options.body) });
    return pending.promise;
  };
  const harness = hookHarness(new URL("./FsoWorkspace.tsx", import.meta.url), {
    "next/navigation": { useSearchParams: () => new URLSearchParams(query) },
    "@/hooks/useI18n": { useI18n: () => ({ t: (key) => key }) },
    "@/hooks/useIsMobile": { useIsMobile: () => false },
    "@/extension/robin/fso": { chapterForStep, continueChapter, findChapter, nextChapter },
    "@/extension/robin/learning": { FULLSTACK_STEPS },
    "./AgentPanel": { AgentPanel: Mentor },
    "./FsoNotes": { FsoNoteEditor: Editor, FsoNotebook: () => null },
    "./FsoRail": { FsoRail: () => null },
    "./FsoRoadmap": { FsoRoadmap: Roadmap },
    "./PaneDivider": { PaneDivider: () => null },
    "./WorkspaceHeader": { WorkspacePane: () => null, WorkspacePaneSwitch: () => null },
    "./usePaneWidths": { usePaneWidths: () => ({ rail: {}, panel: {} }) },
    "./usePolledResource": {
      usePolledResource(url) {
        polls.push(url);
        return url.endsWith("/fso") ? fso : { ...fso, data: { fullstack: fullstackPlan([]) } };
      },
      mutate: async (url, method, body) => {
        const response = await fetch(url, { method, body: JSON.stringify(body) });
        if (!response.ok) throw new Error((await response.json()).error);
      },
    },
    "./FsoWorkspace.module.css": { default: {} },
  }, { fetch, window: { history: { replaceState: (_a, _b, url) => urls.push(url) }, localStorage: { getItem: () => null } } });
  const render = () => harness.render(() => harness.exports.FsoWorkspace());
  const find = (predicate) => findElement(render(), predicate);
  return {
    ...harness, requests, urls, polls, render,
    frame: () => find((node) => node.type === "iframe"),
    mentor: () => find((node) => node.type === Mentor),
    editor: () => find((node) => node.type === Editor),
    alert: () => find((node) => node.props?.role === "alert"),
    open: (chapter) => find((node) => node.type === Roadmap).props.onOpen(chapter),
    next: () => find((node) => node.type === "button" && [node.props.children].flat().includes("fso.next")).props.onClick(),
    retry: () => find((node) => node.type === "button" && node.props.children === "fso.open.retry").props.onClick(),
    ok: (index, id = requests[index].body.chapter) => requests[index].resolve({ ok: true, json: async () => ({ openChapterId: id }) }),
    fail: (index) => requests[index].resolve({ ok: false, status: 500, json: async () => ({ error: "Cannot save chapter" }) }),
  };
}

test("FSO reads its own ticks without polling the mixed learning track", () => {
  const h = workspaceHarness();
  h.render();
  assert.deepEqual([...new Set(h.polls)], ["/api/robin/fso"]);
  h.unmount();
});

test("deep links wait for persisted identity before mounting a frame or mentor", async () => {
  const chapter = FSO_CHAPTERS[0];
  const h = workspaceHarness(`step=${encodeURIComponent(chapter.id)}`);
  h.render();
  await settle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.frame(), null);
  assert.equal(h.mentor(), null);
  assert.deepEqual(h.urls, []);
  h.ok(0);
  await settle();
  assert.equal(h.frame().props.src, chapter.url);
  assert.equal(h.mentor().props.disabled, false);
  assert.match(h.urls[0], /chapter=/);
  h.unmount();
});

test("failed deep links report an error and retry through the same opening path", async () => {
  const chapter = FSO_CHAPTERS[0];
  const h = workspaceHarness(`chapter=${encodeURIComponent(chapter.id)}`);
  h.render();
  await settle();
  h.fail(0);
  await settle();
  assert.ok(h.alert());
  assert.equal(h.frame(), null);
  assert.equal(h.mentor(), null);
  h.retry();
  await settle();
  h.ok(1);
  await settle();
  assert.equal(h.frame().props.src, chapter.url);
  assert.equal(h.alert(), null);
  assert.equal(h.requests.length, 2, "rendering and URL changes never replay initial selection");
  h.unmount();
});

test("selection is single-flight; failure preserves the frame and blocks uncertain mentor context", async () => {
  const h = workspaceHarness();
  h.render();
  h.open(FSO_CHAPTERS[0]);
  await settle();
  h.ok(0);
  await settle();
  const previousUrl = h.urls.at(-1);
  h.next();
  h.next(); // Even callbacks fired before a disabled render cannot race a write.
  await settle();
  assert.equal(h.requests.length, 2);
  assert.equal(h.frame().props.src, FSO_CHAPTERS[0].url);
  assert.equal(h.mentor().props.disabled, true);
  h.fail(1);
  await settle();
  assert.equal(h.frame().props.src, FSO_CHAPTERS[0].url);
  assert.equal(h.urls.at(-1), previousUrl);
  assert.equal(h.mentor().props.disabled, true, "a lost response may still have committed on the server");
  h.retry();
  await settle();
  h.ok(2);
  await settle();
  assert.equal(h.frame().props.src, FSO_CHAPTERS[1].url);
  assert.equal(h.mentor().props.disabled, false);
  h.unmount();
});

test("unmounting during a chapter write cannot navigate a different page", async () => {
  const h = workspaceHarness();
  h.open(FSO_CHAPTERS[0]);
  await settle();
  h.unmount();
  h.ok(0);
  await settle();
  assert.deepEqual(h.urls, []);
});

test("a mismatched successful response cannot switch the frame", async () => {
  const h = workspaceHarness();
  h.open(FSO_CHAPTERS[0]);
  await settle();
  h.ok(0, FSO_CHAPTERS[1].id);
  await settle();
  assert.equal(h.frame(), null);
  assert.ok(h.alert());
  h.unmount();
});

test("unsaved notes must flush before a chapter switch, and a failed flush keeps the draft mounted", async () => {
  const h = workspaceHarness();
  h.open(FSO_CHAPTERS[0]);
  await settle(); h.ok(0); await settle();
  const editor = h.editor();
  editor.props.ref.current = { flush: async () => { throw new Error("Note is unsaved"); } };
  h.next();
  await settle();
  assert.equal(h.requests.length, 1, "no chapter write after a failed note save");
  assert.equal(h.frame().props.src, FSO_CHAPTERS[0].url);
  assert.ok(h.alert());
  h.unmount();
});
