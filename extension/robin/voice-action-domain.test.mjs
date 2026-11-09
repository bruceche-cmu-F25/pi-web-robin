import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetTaskStore } from './task-store.test-support.mjs';
import { addTodo, chooseNextTodo, listTodos, updateTodo } from './todo-domain.ts';
import { readVoiceTurn, updateVoiceTurn, writeAssistantSessionId, readAssistantSessionId, clearAssistantSession } from './assistant-sessions.ts';
import { reserveVoiceTurn, executeVoiceTask, withVoiceTaskScope, voiceTurnResult, finishVoiceTurn, undoVoiceTask } from './voice-action-domain.ts';
import { parseVoiceInteraction } from './voice-interaction.ts';
const previous = process.env.ROBIN_DATA_DIR;
const dir = mkdtempSync(join(tmpdir(), 'voice-actions-'));
process.env.ROBIN_DATA_DIR = dir;
beforeEach(() => { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir); resetTaskStore(dir); });
after(() => { rmSync(dir, { recursive: true, force: true }); if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous; });
const input = (patch = {}) => parseVoiceInteraction({ requestId: `${Date.now()}-${randomUUID()}`, message: '明天去三楼喂鱼', allowTasks: true, ...patch });
async function act(request, action) {
  reserveVoiceTurn(request);
  return withVoiceTaskScope('robin', request.requestId, async () => executeVoiceTask('robin', action));
}
test('denies missing/revoked grant, read-only consent, malformed and expired ids', async () => {
  assert.throws(() => executeVoiceTask('robin', { action: 'add', title: 'no' }), /authorization/);
  const request = input({ allowTasks: false }); reserveVoiceTurn(request);
  await withVoiceTaskScope('robin', request.requestId, async () => {
    assert.throws(() => executeVoiceTask('robin', { action: 'add', title: 'no' }), /not authorized/);
    assert.throws(() => executeVoiceTask('other-session', { action: 'add', title: 'no' }), /authorization/);
  });
  assert.throws(() => executeVoiceTask('robin', { action: 'add', title: 'no' }), /authorization/);
  assert.throws(() => parseVoiceInteraction({ ...request, requestId: 'anything' }));
  assert.throws(() => reserveVoiceTurn(input({ requestId: `${Date.now() - 700_000}-${randomUUID()}` })), /Expired/);
  assert.equal(listTodos().todos.length, 0);
});
test('duplicate request/tool events produce one task, and changed replay data is refused', async () => {
  const request = input(), action = { action: 'add', title: '去三楼喂鱼', due: '2030-01-02' };
  assert.equal(reserveVoiceTurn(request).fresh, true);
  await withVoiceTaskScope('robin', request.requestId, async () => {
    const first = executeVoiceTask('robin', action);
    assert.deepEqual(executeVoiceTask('robin', action), first);
    assert.throws(() => executeVoiceTask('robin', { ...action, due: '2030-01-03' }), /already attempted/);
  });
  assert.equal(reserveVoiceTurn(request).fresh, false);
  assert.equal(listTodos().todos.length, 1);
  assert.throws(() => reserveVoiceTurn({ ...request, message: 'different' }), /conflict/);
  const result = finishVoiceTurn(request.requestId, { state: 'uncertain', answer: 'invented', spoken: 'invented' });
  assert.equal(result.state, 'done'); assert.match(result.answer, /已记录：去三楼喂鱼，2030-01-02/);
});
test('follow-up edits the same object; undo restores date then complete status', async () => {
  const added = await act(input(), { action: 'add', title: '去三楼喂鱼', due: '2030-01-02' });
  const edited = await act(input({ lastActionId: added.requestId }), { action: 'update', taskId: added.taskId, due: '2030-01-03' });
  assert.equal(listTodos().todos.length, 1); assert.equal(listTodos().todos[0].due, '2030-01-03');
  const undo = input({ undoOf: edited.requestId }); reserveVoiceTurn(undo); undoVoiceTask(undo.requestId);
  assert.equal(listTodos().todos[0].due, '2030-01-02');
  const completed = await act(input(), { action: 'complete', taskId: added.taskId });
  assert.equal(listTodos().todos.length, 0);
  const reopen = input({ lastActionId: completed.requestId });
  await act(reopen, { action: 'undo' });
  assert.equal(listTodos().todos[0].done, false);
});
test('cancel and undo-add are reversible abandonment, never permanent deletion', async () => {
  const added = await act(input(), { action: 'add', title: 'Keep the record' });
  await act(input({ lastActionId: added.requestId }), { action: 'undo' });
  assert.equal(listTodos().todos.length, 0);
  assert.equal(listTodos({ includeArchived: true }).todos[0].id, added.taskId);
  assert.ok(listTodos({ includeArchived: true }).todos[0].archivedAt);
  const existing = addTodo({ title: 'Cancel this' }).todo;
  const archived = await act(input(), { action: 'archive', taskId: existing.id });
  await act(input({ lastActionId: archived.requestId }), { action: 'undo' });
  assert.equal(listTodos().todos[0].id, existing.id);
});
test('stale snapshot/undo cannot overwrite a subsequent edit or another chosen next task', async () => {
  const todo = addTodo({ title: 'Original' }).todo;
  const req = input(); reserveVoiceTurn(req);
  await withVoiceTaskScope('robin', req.requestId, async () => {
    updateTodo({ id: todo.id }, { title: 'Changed outside voice' });
    assert.throws(() => executeVoiceTask('robin', { action: 'update', taskId: todo.id, title: 'overwrite' }), /unconfirmed/);
  });
  assert.equal(listTodos().todos[0].title, 'Changed outside voice');
  assert.equal(finishVoiceTurn(req.requestId, { state: 'done', answer: 'ok', spoken: 'ok' }).state, 'uncertain');
  chooseNextTodo({ id: todo.id }, true);
  const complete = await act(input(), { action: 'complete', taskId: todo.id });
  const other = addTodo({ title: 'Other' }).todo; chooseNextTodo({ id: other.id }, true);
  await assert.rejects(act(input({ lastActionId: complete.requestId }), { action: 'undo' }), /unconfirmed/);
  assert.equal(listTodos().todos.find(t => t.id === other.id).next, true);
});
test('crash after fence never replays; task receipt survives missing final model answer', async () => {
  const req = input(); reserveVoiceTurn(req);
  updateVoiceTurn(req.requestId, record => ({ record: { ...record, stage: 'executing' }, result: null }));
  assert.equal(reserveVoiceTurn(req).fresh, false);
  await assert.rejects(withVoiceTaskScope('robin', req.requestId, async () => executeVoiceTask('robin', { action: 'add', title: 'duplicate?' })), /already attempted/);
  const good = await act(input(), { action: 'add', title: 'Saved' });
  assert.equal(voiceTurnResult(good.requestId).state, 'done');
  writeAssistantSessionId('shared-robin');
  assert.ok(readVoiceTurn(req.requestId)); assert.equal(readAssistantSessionId(), 'shared-robin');
  clearAssistantSession('default'); assert.ok(readVoiceTurn(good.requestId), 'session rotation retains replay fences');
});
test('ambiguous/unknown ids, permanent delete and unsafe links never mutate', async () => {
  await assert.rejects(act(input(), { action: 'update', taskId: 'invented', due: '2030-01-02' }), /existing task/);
  await assert.rejects(act(input(), { action: 'delete', taskId: 'invented' }), /Unsupported/);
  await assert.rejects(act(input(), { action: 'add', title: 'bad link', url: 'javascript:alert(1)' }), /unconfirmed/);
  assert.equal(listTodos().todos.length, 0);
});
