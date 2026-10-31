import assert from "node:assert/strict";
import { test } from "node:test";
import { findElement, hookHarness, settle } from "../../scripts/react-hook-harness.mjs";

function panelHarness() {
  const requests = [];
  const h = hookHarness(new URL("./AgentPanel.tsx", import.meta.url), {
    "@/components/MarkdownBody": { MarkdownBody: () => null },
    "@/hooks/useI18n": { useI18n: () => ({ t: (key) => key }) },
    "./refreshBus": { requestRefresh() {} },
    "./VoiceControls": { VoiceControls: () => null },
    "./agent-attachments": {
      MAX_AGENT_DOCUMENTS: 5,
      MAX_AGENT_IMAGES: 10,
      isAttachableFile: () => true,
      readAgentAttachment: async () => { throw new Error("not used"); },
    },
  }, { fetch: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ reply: "confirmed context", usedTools: [] }) };
  } });
  const render = (props = {}) => h.render(() => h.exports.AgentPanel({
    mode: "mentor", titleKey: "title", placeholderKey: "placeholder", restartHintKey: "restart", toolKeys: {}, ...props,
  }));
  const input = (props) => findElement(render(props), (node) => node.type === "textarea");
  return { ...h, render, input, requests };
}
const enter = (input) => input.props.onKeyDown({ key: "Enter", nativeEvent: {}, preventDefault() {} });

test("unconfirmed chapter context blocks sending without clearing the typed draft", async () => {
  const h = panelHarness();
  h.input().props.onChange({ target: { value: "Explain this chapter" } });
  enter(h.input({ disabled: true }));
  await settle();
  assert.equal(h.requests.length, 0);
  assert.equal(h.input({ disabled: true }).props.value, "Explain this chapter");
  enter(h.input({ disabled: false }));
  await settle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].message, "Explain this chapter");
  h.unmount();
});

test("a pending mentor brief waits for confirmed context and is dispatched once", async () => {
  const h = panelHarness();
  const pending = { id: "notes-1", text: "Review my notes" };
  h.render({ disabled: true, pending });
  await settle();
  assert.equal(h.requests.length, 0);
  h.render({ disabled: false, pending });
  await settle();
  h.render({ disabled: false, pending });
  assert.equal(h.requests.length, 1);
  h.unmount();
});

test("the shared composer has a direct send action without opening voice controls", async () => {
  const h = panelHarness();
  const sendButton = () => findElement(h.render(), node => node.type === "button" && node.props["aria-label"] === "chat.send");
  assert.equal(sendButton().props.disabled, true);
  h.input().props.onChange({ target: { value: "A direct question" } });
  assert.equal(sendButton().props.disabled, false);
  sendButton().props.onClick();
  assert.equal(sendButton().props.disabled, true);
  await settle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].message, "A direct question");
  const user = findElement(h.render(), node => node.props?.["data-message-role"] === "user");
  assert.match(user.props.className, /chat-user-bubble/);
  assert.match(h.input().props.className, /chat-input-textarea/);
  h.unmount();
});

test("model controls share the composer, while attachment failures stay visible", async () => {
  const h = panelHarness();
  const props = { attachments: true, footer: "Model controls" };
  const row = findElement(h.render(props), node => node.props?.className === "workspace-agent-controls");
  assert.equal(findElement(row, node => node.props?.className === "workspace-agent-options").props.children, "Model controls");
  assert.ok(findElement(row, node => node.props?.["aria-label"] === "chat.send"));
  assert.equal(findElement(h.render(props), node => node.props?.className === "workspace-agent-footer"), null);
  h.input(props).props.onPaste({ clipboardData: { files: [{ name: "test.pdf", type: "application/pdf" }] }, preventDefault() {} });
  await settle();
  assert.ok(findElement(h.render(props), node => node.props?.role === "status" && String(node.props.children).includes("not used")), "Attachment failure is visible");
  assert.equal(h.requests.length, 0);
  h.unmount();
});

test("IME candidate confirmation and Shift+Enter still do not send", async () => {
  const h = panelHarness();
  h.input().props.onChange({ target: { value: "中文草稿" } });
  h.input().props.onCompositionStart();
  enter(h.input());
  h.input().props.onCompositionEnd();
  enter(h.input());
  h.input().props.onKeyDown({ key: "Enter", shiftKey: true, nativeEvent: {}, preventDefault() {} });
  await settle();
  assert.equal(h.requests.length, 0);
  assert.equal(h.input().props.value, "中文草稿");
  h.unmount();
});
