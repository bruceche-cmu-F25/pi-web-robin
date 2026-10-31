import assert from "node:assert/strict";
import { test } from "node:test";
import { linkSections } from "../../extension/robin/link-families.ts";
import { deferred, findElement, hookHarness, settle } from "../../scripts/react-hook-harness.mjs";

const link = { id: "fixture", title: "Original", url: "https://example.com/old", group: "Test" };
function panelHarness() {
  const requests = [];
  const resource = hookHarness(new URL("./usePolledResource.ts", import.meta.url), {
    "./refreshBus": { onRefreshRequest: () => () => {} },
    "@/hooks/useI18n": { useI18n: () => ({ t: String }) },
  }, {
    Error,
    fetch(url, init = {}) {
      const request = { ...deferred(), url, method: init.method ?? "GET", body: init.body && JSON.parse(init.body), signal: init.signal };
      requests.push(request); return request.promise;
    },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    setInterval: () => 1, clearInterval() {},
  });
  let currentResource;
  const panel = hookHarness(new URL("./LinksPanel.tsx", import.meta.url), {
    "@/hooks/useI18n": { useI18n: () => ({ t: (key, values) => key + (values?.title ? `:${values.title}` : "") }) },
    "@/hooks/useIsMobile": { useIsMobile: () => false, useIsSplitLayout: () => true },
    "./SavedLinkLaunch": { SavedLinkLaunch: function SavedLinkLaunch() {} },
    "./SavedLinkIcon": { useLinkIconBackfill() {} }, "./usePopoverDismiss": {},
    "@/extension/robin/link-families": { linkSections },
    "./refreshBus": { requestRefresh() {} }, "./LinksPanel.module.css": { default: {} },
    "./usePolledResource": { ...resource.exports,
      usePolledResource: (...args) => (currentResource = resource.render(() => resource.exports.usePolledResource(...args))),
    },
  }, { Error, window: { confirm: () => true } });
  const render = () => panel.render(() => panel.exports.LinksPanel({}));
  const input = field => findElement(render(), node => node.type === "input" && node.props["aria-label"] === `robin.links.${field}Placeholder`)?.props;
  const button = label => findElement(render(), node => node.type === "button" && (node.props["aria-label"] === label || node.props.children === label))?.props;
  return {
    requests, render, input, button,
    shown: () => findElement(render(), node => node.type?.name === "SavedLinkLaunch")?.props.link,
    refresh: () => currentResource.refresh(),
    respond(request, body, status = 200) { request.resolve({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body }); },
    async load() { render(); this.respond(requests[0], { links: [link] }); await settle(); render(); },
    edit() { button("robin.links.edit:Original").onClick(); input("name").onChange({ target: { value: "Edited" } }); },
    async offlineRefresh() { await settle(); this.respond(requests.at(-1), { error: "Read offline" }, 503); await settle(); },
    unmount() { panel.unmount(); resource.unmount(); },
  };
}

test("failed edits retain both fields and a retry action; double submission is fenced", async () => {
  const h = panelHarness();
  try {
    await h.load(); h.edit();
    h.input("url").onChange({ target: { value: "https://example.com/new" } });
    const save = h.button("robin.common.save"); save.onClick(); save.onClick();
    assert.equal(h.requests.filter(r => r.method === "PATCH").length, 1);
    assert.equal(h.input("name").disabled, true);
    h.respond(h.requests.at(-1), { error: "Write refused" }, 503); await settle();
    assert.equal(h.input("name").value, "Edited");
    assert.equal(h.input("url").value, "https://example.com/new");
    assert.equal(h.input("name").disabled, false);
    const alert = findElement(h.render(), n => n.props?.role === "alert");
    assert.ok(findElement(alert, n => n.type === "p" && n.props.children === "Write refused"));
    h.button("robin.common.save").onClick();
    h.respond(h.requests.at(-1), { link: { ...link, title: "Edited", url: "https://example.com/new" } });
    await h.offlineRefresh();
    assert.equal(h.input("name"), undefined);
    assert.equal(h.shown().title, "Edited");
  } finally { h.unmount(); }
});

test("confirmed normalized edit survives a failed refresh and an obsolete poll", async () => {
  const h = panelHarness();
  try {
    await h.load(); const read = h.refresh(), stale = h.requests.at(-1);
    h.edit(); h.button("robin.common.save").onClick();
    h.respond(h.requests.at(-1), { link: { ...link, title: "Server title", url: "https://example.com/normalized" } });
    await settle();
    assert.equal(h.button("robin.links.edit:Server title").disabled, false, "a pending read must not lock confirmed writes");
    await h.offlineRefresh();
    h.respond(stale, { links: [link] }); await read;
    assert.equal(stale.signal.aborted, true);
    assert.equal(h.shown().title, "Server title");
    assert.equal(h.shown().url, "https://example.com/normalized");
  } finally { h.unmount(); }
});

test("invalid edits stay open and IME confirmation does not submit", async () => {
  const h = panelHarness();
  try {
    await h.load(); h.edit();
    h.input("name").onKeyDown({ key: "Enter", nativeEvent: { isComposing: true } });
    assert.equal(h.requests.length, 1);
    h.input("name").onChange({ target: { value: " " } });
    h.button("robin.common.save").onClick();
    assert.equal(h.requests.length, 1);
    assert.equal(h.input("name").value, " ");
  } finally { h.unmount(); }
});

test("creation adopts the saved link even if revalidation fails", async () => {
  const h = panelHarness();
  try {
    await h.load(); h.button("robin.common.add").onClick();
    h.input("url").onChange({ target: { value: "https://example.com/new" } });
    findElement(h.render(), n => n.type === "form").props.onSubmit({ preventDefault() {} });
    h.respond(h.requests.at(-1), { link: { ...link, id: "new", title: "New" } });
    await h.offlineRefresh();
    assert.ok(findElement(h.render(), n => n.type?.name === "SavedLinkLaunch" && n.props.link.id === "new"));
    assert.equal(findElement(h.render(), n => n.type === "form"), null);
  } finally { h.unmount(); }
});

for (const success of [false, true]) test(`deletion changes the collection only on acknowledgement: ${success}`, async () => {
  const h = panelHarness();
  try {
    await h.load(); h.button("robin.links.delete:Original").onClick();
    assert.equal(h.shown().id, link.id);
    h.respond(h.requests.at(-1), success ? { success: true } : { error: "Delete refused" }, success ? 200 : 503);
    if (success) await h.offlineRefresh(); else await settle();
    assert.equal(h.shown()?.id, success ? undefined : link.id);
  } finally { h.unmount(); }
});
