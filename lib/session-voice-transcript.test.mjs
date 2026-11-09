import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxText } from '@earendil-works/pi-ai';
import { createJiti } from 'jiti';
const dir = await mkdtemp(join(tmpdir(), 'pi-voice-transcript-'));
process.env.PI_CODING_AGENT_DIR = dir;
const jiti = createJiti(import.meta.url);
const { AgentSessionWrapper } = await jiti.import('./rpc-manager.ts');
const { appendVoiceTranscript } = await jiti.import('./session-voice-transcript.ts');
test.after(() => rm(dir, { recursive: true, force: true }));
const utterance = (id, role = 'user') => ({ id, role, text: role === 'user' ? 'Hi，你好。' : '你好，我听到了。', interrupted: false });

test('Robin copies preserve provenance without falsely claiming Boson ran the task or no tools ran anywhere', () => {
  const manager = SessionManager.create(dir, dir);
  appendVoiceTranscript(manager, { ...utterance('robin-user'), source: 'robin' });
  const value = { ...utterance('robin-reply', 'assistant'), source: 'robin', text: '已记录：喂鱼。' };
  const result = appendVoiceTranscript(manager, value);
  assert.equal(result.message.provider, 'robin');
  assert.match(result.message.content[0].text, /task actions belong to Robin/);
  assert.doesNotMatch(result.message.content[0].text, /No tools executed\./);
  assert.equal(appendVoiceTranscript(manager, value).duplicate, true);
  assert.throws(() => appendVoiceTranscript(manager, { ...value, id: 'forged', source: 'system' }), /Invalid voice/);
});

test('voice appends persist through the owner without a model turn, and the next request sees them', async t => {
  const faux = fauxProvider({ models: [{ id: 'voice-test' }] });
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await resourceLoader.reload();
  const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime, model: faux.getModel('voice-test'),
    sessionManager: SessionManager.create(dir, dir), settingsManager, resourceLoader, tools: [] });
  const wrapper = new AgentSessionWrapper(session);
  t.after(() => wrapper.destroy());
  wrapper.start(); wrapper.beginExtensionBinding(); await wrapper.waitUntilReady();
  const events = []; wrapper.onEvent(e => events.push(e.type));
  const manager = session.sessionManager;
  const startLeaf = manager.getLeafId();
  const u = await wrapper.send({ type: 'append_voice_transcript', transcript: utterance('user-1'), expectedLeaf: startLeaf });
  const a = await wrapper.send({ type: 'append_voice_transcript', transcript: utterance('assistant-1', 'assistant'), expectedLeaf: u.entryId });
  assert.ok(manager.isPersisted(), 'fresh voice-only chat has a file');
  assert.equal(events.filter(e => e === 'message_end').length, 2);
  assert.equal(events.includes('agent_start'), false);
  assert.equal(events.includes('prompt_done'), false);
  const reopened = SessionManager.open(manager.getSessionFile());
  const messages = reopened.buildSessionContext().messages;
  assert.deepEqual(messages.map(m => m.role), ['user', 'assistant']);
  assert.match(JSON.stringify(messages), /Hi，你好/);
  assert.match(JSON.stringify(messages), /No tools executed/);
  assert.equal(appendVoiceTranscript(reopened, utterance('assistant-1', 'assistant'), u.entryId).duplicate, true);
  assert.equal(reopened.getLeafId(), a.entryId);
  await assert.rejects(wrapper.send({ type: 'append_voice_transcript', transcript: utterance('new'), expectedLeaf: startLeaf }), /branch changed/);
  await assert.rejects(wrapper.send({ type: 'append_voice_transcript', transcript: { ...utterance('user-1'), text: 'changed' } }), /id conflict/);
  for (const transcript of [{}, { ...utterance('bad'), text: 'x'.repeat(4001) }, { ...utterance('bad'), role: 'system' }]) {
    await assert.rejects(wrapper.send({ type: 'append_voice_transcript', transcript }), /Invalid voice/);
  }
  t.mock.method(wrapper, 'isRunning', () => true);
  await assert.rejects(wrapper.send({ type: 'append_voice_transcript', transcript: utterance('busy') }), /Chat is busy/);
  t.mock.restoreAll();
  let request;
  faux.setResponses([context => { request = context; return fauxAssistantMessage([fauxText('Text continuation.')]); }]);
  await session.prompt('Continue in text');
  assert.match(JSON.stringify(request.messages), /Hi，你好/);
  assert.match(JSON.stringify(request.messages), /你好，我听到了/);
  assert.equal(request.messages.filter(m => m.voiceTranscript).length, 2);
});
