import assert from 'node:assert/strict';
import test from 'node:test';
import { hookHarness, deferred, findElement, settle } from '../../scripts/react-hook-harness.mjs';
function setup(t, fetcher) {
  const VoiceControls = () => null;
  const calls = [], replies = [], ended = [];
  const harness = hookHarness(new URL('./AgentPanel.tsx', import.meta.url), {
    '@/components/MarkdownBody': { MarkdownBody: () => null },
    '@/hooks/useI18n': { useI18n: () => ({ t: key => key }) },
    './agent-attachments': {}, './refreshBus': { requestRefresh() {} }, './VoiceControls': { VoiceControls },
  }, {
    window: { localStorage: { getItem: () => null, setItem() {} } },
    fetch: async (url, options) => { calls.push({ url, options }); return fetcher(); },
  });
  let props = { mode: 'coach', titleKey: 'coach', placeholderKey: 'question', restartHintKey: 'restart', toolKeys: {} };
  const render = (extra = {}) => {
    props = { ...props, ...extra };
    const tree = harness.render(() => harness.exports.AgentPanel(props));
    const voice = findElement(tree, el => el.type === VoiceControls);
    if (voice) voice.props.ref.current = { prepareReply: () => text => replies.push(text), end: () => ended.push(true) };
    return { tree, voice, input: findElement(tree, el => el.type === 'textarea') };
  };
  t.after(() => harness.unmount());
  return { render, calls, replies, ended };
}
test('voice-confirmed submission uses the owning coach route/mode; double click dispatches only once', async t => {
  const response = deferred(); const s = setup(t, () => response.promise);
  s.render().voice.props.onTranscript('我的想法是双指针。');
  const view = s.render(); assert.equal(view.input.props.value, '我的想法是双指针。');
  view.voice.props.onSend(); view.voice.props.onSend();
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, '/api/robin/assistant');
  assert.deepEqual(JSON.parse(s.calls[0].options.body), { mode: 'coach', message: '我的想法是双指针。' });
  response.resolve(Response.json({ reply: '你能推导时间复杂度吗？', sessionId: 'coach-existing', usedTools: [] }));
  await settle(); assert.deepEqual(s.replies, ['你能推导时间复杂度吗？']);
});
test('transcription appends to an existing draft; failures never become a success speech', async t => {
  const s = setup(t, async () => Response.json({ error: 'fixture failure' }, { status: 500 }));
  s.render().input.props.onChange({ target: { value: 'Existing.' } });
  s.render().voice.props.onTranscript('补充问题。');
  const view = s.render(); assert.equal(view.input.props.value, 'Existing.\n补充问题。');
  view.voice.props.onSend(); await settle(); assert.deepEqual(s.replies, [null]);
});
test('closing/collapsing a mounted panel ends its microphone; disabled context cannot submit', async t => {
  const s = setup(t, () => assert.fail('must not dispatch'));
  s.render(); s.render({ collapsed: true }); assert.ok(s.ended.length > 0);
  s.render({ collapsed: false, disabled: true }).voice.props.onTranscript('draft');
  s.render().voice.props.onSend(); assert.equal(s.calls.length, 0);
});
