import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred, hookHarness, settle } from "../../scripts/react-hook-harness.mjs";
import { paperSummary, researchHref } from "./research-client.ts";

function readerHarness(projectId) {
  const requests = [], navigation = [], switches = [], external = [], sends = [], imports = [];
  let params = new URLSearchParams(), turnOptions, flushes = 0, changes = 0;
  const router = { push: (href) => navigation.push({ kind: "push", href }), replace: (href) => navigation.push({ kind: "replace", href }) };
  const thread = { state: { messages: [], run: null }, busy: false, elsewhere: false, send: async (...args) => { sends.push(args); return true; } };
  const options = { projectId, beforeAsk: async () => { flushes++; }, onProjectsChange: async () => { changes++; }, onSwitch: async (...args) => { switches.push(args); } };
  const t = (key, values) => values?.title ? `${key}:${values.title}` : key;
  const h = hookHarness(new URL("./useResearchReader.ts", import.meta.url), {
    "next/navigation": { useRouter: () => router, useSearchParams: () => params },
    "@/hooks/useI18n": { useI18n: () => ({ t, locale: "en" }) },
    "./useResearchThread": { useResearchThread: (next) => { turnOptions = next; return thread; } },
    "./research-client": { GENERAL: "general", researchHref, paperSummary,
      importPaperPdf: (...args) => { const request = { ...deferred(), args }; imports.push(request); return request.promise; },
      researchRequest: (url, init) => { const request = { ...deferred(), url, ...init }; requests.push(request); return request.promise; } },
  }, { URL, Map, Error, window: { location: { origin: "http://localhost", href: "http://localhost/research" }, open: (...args) => external.push(args) } });
  return { ...h, requests, navigation, switches, external, sends, imports, options, thread,
    get turnOptions() { return turnOptions; }, get flushes() { return flushes; }, get changes() { return changes; },
    at(query) { params = new URLSearchParams(query); },
    render: () => h.render(() => h.exports.useResearchReader(options)),
  };
}
const query = (nav) => new URL(nav.href, "http://localhost").searchParams;
const paper = (id) => ({ id, title: `Paper ${id}`, exports: [], projectIds: [], authors: [], note: "", tags: "" });

for (const projectId of ["general", "heat"]) {
  test(`${projectId}: list scope, default reading, closing and accepted-turn navigation use the same rules`, async () => {
    const h = readerHarness(projectId);
    try {
      h.at("paper=A");
      const defaultId = `paper:${projectId}:A`;
      h.thread.state.conversation = { id: defaultId, paperId: "A" };
      let reader = h.render();
      assert.equal(h.requests[0].url, projectId === "general" ? "/api/research/papers" : "/api/research/papers?project=heat");
      h.requests[0].resolve({ papers: [paper("A")] }); h.requests[1].resolve({ paper: paper("A") }); await settle();
      reader = h.render(); assert.equal(reader.titles.get("A"), "Paper A");
      reader.open("A"); assert.equal(query(h.navigation.at(-1)).get("conversation"), defaultId);
      reader.open("B"); assert.equal(query(h.navigation.at(-1)).get("conversation"), null);
      assert.equal(query(h.navigation.at(-1)).get("paper"), "B");
      reader.open(null); assert.equal(query(h.navigation.at(-1)).get("paper"), null);
      assert.equal(query(h.navigation.at(-1)).get("conversation"), defaultId);
      h.turnOptions.onConversation(defaultId, "A"); assert.equal(h.navigation.at(-1).kind, "replace");
      h.turnOptions.onConversation("new-reading", "B"); assert.equal(h.navigation.at(-1).kind, "push");
      assert.equal(query(h.navigation.at(-1)).get("paper"), null);
      assert.equal(query(h.navigation.at(-1)).get("conversation"), "new-reading");
      await reader.selectConversation("topic", true);
      assert.equal(h.flushes, 1); assert.equal(query(h.navigation.at(-1)).get("paper"), "A");
      assert.equal(query(h.navigation.at(-1)).get("project"), projectId === "general" ? null : projectId);
    } finally { h.unmount(); }
  });

  test(`${projectId}: failed saves block topic changes; deep links retain both paper and conversation`, async () => {
    const h = readerHarness(projectId);
    try {
      h.at("paper=A");
      h.options.beforeAsk = async () => { throw new Error("Save failed"); };
      let reader = h.render();
      await assert.rejects(reader.selectConversation("topic", true), /Save failed/);
      reader.navigate(`/research?project=${projectId}&paper=B&conversation=topic-B`); await settle();
      assert.equal(h.navigation.length, 0); assert.equal(h.render().error, "Save failed");
      h.options.beforeAsk = async () => {}; reader = h.render();
      reader.navigate(`/research?project=${projectId}&paper=B&conversation=topic-B`); await settle();
      assert.equal(query(h.navigation.at(-1)).get("paper"), "B");
      assert.equal(query(h.navigation.at(-1)).get("conversation"), "topic-B");
      reader.navigate("/research?project=other&paper=C&conversation=topic-C"); await settle();
      assert.deepEqual(h.switches.at(-1), ["other", "/research?project=other&paper=C&conversation=topic-C"]);
      reader.navigate("javascript:alert(1)"); assert.equal(h.external.length, 0);
      reader.navigate("https://example.org/paper"); assert.equal(h.external[0][2], "noopener,noreferrer");
    } finally { h.unmount(); }
  });

  test(`${projectId}: late paper fetches, accepted turns and slow flushes cannot navigate back`, async () => {
    const h = readerHarness(projectId);
    try {
      const gate = deferred(); h.options.beforeAsk = () => gate.promise;
      h.at("paper=A&conversation=topic-A");
      let reader = h.render(); const oldFetch = h.requests.at(-1), accepted = h.turnOptions.onConversation;
      const selecting = reader.selectConversation("another-A", true);
      h.at("paper=B&conversation=topic-B"); reader = h.render();
      assert.equal(oldFetch.signal.aborted, true);
      h.requests.at(-1).resolve({ paper: paper("B") }); await settle();
      oldFetch.resolve({ paper: paper("A") }); gate.resolve(); await selecting; await settle();
      accepted("late-A", "A");
      assert.equal(h.navigation.length, 0); assert.equal(h.render().paper.id, "B");
      // A back/forward URL change derives the reader again, not from the old imperative selection.
      h.at("paper=A&conversation=topic-A"); assert.equal(h.render().paper, null);
      h.requests.at(-1).resolve({ paper: paper("A") }); await settle();
      assert.equal(h.render().paper.id, "A");
    } finally { h.unmount(); }
  });

  test(`${projectId}: direct uploads flush notes, import into the initiating scope and start a paper reading`, async () => {
    const h = readerHarness(projectId);
    try {
      let reader = h.render();
      const controller = new AbortController(), file = { name: "new.pdf" };
      const pending = reader.uploadPdf(file, controller.signal); await settle();
      assert.equal(h.flushes, 1); assert.deepEqual(h.imports[0].args, [projectId, file, controller.signal]);
      h.imports[0].resolve(paper("new"));
      assert.equal((await pending).started, true);
      assert.equal(h.sends[0][1], "new"); assert.equal(h.render().papers[0].id, "new");
      // Busy state must be read at completion, not captured before a slow upload.
      reader = h.render(); const second = reader.uploadPdf(file, controller.signal); await settle();
      h.thread.elsewhere = true; h.render(); h.imports[1].resolve(paper("busy"));
      assert.equal((await second).started, false); assert.equal(h.sends.length, 1);
    } finally { h.unmount(); }
  });

  test(`${projectId}: failed focus saves and navigation during upload never start a late reading`, async () => {
    const h = readerHarness(projectId);
    try {
      h.options.beforeAsk = async () => { throw new Error("Focus conflict"); };
      let reader = h.render();
      await assert.rejects(reader.uploadPdf({}, new AbortController().signal), /Focus conflict/);
      assert.equal(h.imports.length, 0);
      h.options.beforeAsk = async () => {}; reader = h.render();
      const pending = reader.uploadPdf({}, new AbortController().signal); await settle();
      h.at("conversation=other"); h.render(); h.imports[0].resolve(paper("late"));
      assert.equal((await pending).started, false); assert.equal(h.sends.length, 0); assert.equal(h.navigation.length, 0);
      // Component unmount aborts the operation even if a response still arrives.
      reader = h.render(); const controller = new AbortController();
      const cancelled = reader.uploadPdf({}, controller.signal); await settle();
      controller.abort(); h.imports[1].resolve(paper("cancelled"));
      await assert.rejects(cancelled, /abort/i); assert.equal(h.sends.length, 0);
    } finally { h.unmount(); }
  });

  test(`${projectId}: an upload refreshes the library but starts reading only when idle`, () => {
    const h = readerHarness(projectId);
    try {
      let reader = h.render(); reader.uploaded(paper("A"));
      assert.equal(h.sends.length, 1); assert.equal(h.sends[0][1], "A");
      assert.match(h.sends[0][0], projectId === "general" ? /rw.home.readUploaded/ : /rw.paper.readUploadedNamed/);
      h.thread.elsewhere = true; reader = h.render(); reader.uploaded(paper("B"));
      assert.equal(h.sends.length, 1); assert.equal(h.changes, 2);
    } finally { h.unmount(); }
  });
}
