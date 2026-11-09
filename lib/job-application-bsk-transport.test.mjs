import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertBskApplicationBrowserReady, withBskApplicationSession } from './job-application-bsk-transport.ts';

const ready = { state: { mode: 'ready' }, context_id: 'context-1', observation_id: 'observation-1',
  observation: { text: '@e7 button "Autofill"' } };

function fixture(override = () => undefined) {
  const calls = [];
  const run = async (args, signal) => {
    calls.push({ args, signal });
    const replacement = override(args, signal);
    if (replacement !== undefined) return replacement;
    if (args[0] === 'session' && args[1] === 'start') return { session_id: 'agent-1' };
    if (args[0] === 'session' && args[1] === 'stop') return {};
    if (args[0] === 'navigate') return { final_url: args[1], tab_id: 77 };
    if (args[0] === 'tab') return { tabs: [{ tab_id: 77, url: 'https://jobright.ai/jobs/info/one', scope: 'agent' },
      { tab_id: 78, url: 'https://job-boards.greenhouse.io/embed/job_app?for=test&token=123', scope: 'agent' }] };
    if (args[0] === 'cooperate') return ready;
    if (args[0] === 'evaluate') return { ok: true, value: 'Example job' };
    if (args[0] === 'click') return { ok: true };
    throw new Error(`Unexpected command ${args[0]}`);
  };
  return { calls, run };
}

test('batch preflight requires the exact connected Chrome instance without opening a job tab', async () => {
  const calls = [];
  const run = async (args) => { calls.push(args); return { browsers: [{ instance_id: 'other', unresponsive: false },
    { instance_id: 'verified', unresponsive: false, version_skew: false }] }; };
  await assertBskApplicationBrowserReady('verified', undefined, run);
  await assert.rejects(assertBskApplicationBrowserReady('missing', undefined, run), /BSK_BROWSER_UNAVAILABLE/);
  await assert.rejects(assertBskApplicationBrowserReady('verified', undefined, async () => ({ browsers: [
    { instance_id: 'verified', unresponsive: true }] })), /BSK_BROWSER_UNAVAILABLE/);
  await assert.rejects(assertBskApplicationBrowserReady('verified', undefined, async () => ({ browsers: [
    { instance_id: 'verified', unresponsive: false, version_skew: true }] })), /BSK_BROWSER_UNAVAILABLE/);
  assert.deepEqual(calls, [['status'], ['status']]);
});

test('fresh observation and target precondition precede each BSK action; window always closes', async () => {
  const { calls, run } = fixture();
  await withBskApplicationSession(async (session) => {
    await session.navigate('https://job-boards.greenhouse.io/test/jobs/123');
    assert.match(await session.sync(), /Autofill/);
    assert.equal(await session.read('document.title'), 'Example job');
    await session.click('@e7', [{ target: '@e7', field: 'text', equals: 'Autofill' }]);
    await assert.rejects(session.click('@e7', [{ target: '@e7', field: 'text', equals: 'Autofill' }]), /Synchronize/);
  }, { run });
  assert.deepEqual(calls.map(({ args }) => args.slice(0, 2).join(' ')), [
    'session start', 'navigate https://job-boards.greenhouse.io/test/jobs/123', 'cooperate sync', 'evaluate document.title',
    'click @e7', 'session stop',
  ]);
  const click = calls.find(({ args }) => args[0] === 'click').args;
  assert.equal(click[click.indexOf('--context') + 1], 'context-1');
  assert.deepEqual(JSON.parse(click[click.indexOf('--expect') + 1]), [{ target: '@e7', field: 'text', equals: 'Autofill' }]);
});

test('Quick Apply popup URL is inspected, then the owned tab navigates with a fresh context', async () => {
  const { calls, run } = fixture();
  await withBskApplicationSession(async (session) => {
    await session.navigate('https://jobright.ai/jobs/info/one');
    const tabs = await session.tabs();
    assert.equal(tabs.length, 2);
    assert.equal(tabs[1].tab_id, 78);
    await session.navigate(tabs[1].url);
    await session.sync();
    await session.click('@e7', [{ target: '@e7', field: 'text', equals: 'Autofill' }]);
  }, { run, browser: 'known-profile' });
  const start = calls.find(({ args }) => args[1] === 'start').args;
  assert.equal(start[start.indexOf('--browser') + 1], 'known-profile');
  const navs = calls.filter(({ args }) => args[0] === 'navigate').map(({ args }) => args);
  assert.equal(navs.length, 2);
  assert.equal(navs[1][navs[1].indexOf('--tab-id') + 1], '77');
  assert.equal(navs[1][navs[1].indexOf('--context') + 1], 'context-1');
  assert.equal(navs[1][navs[1].indexOf('--observation') + 1], 'observation-1');
  assert.equal(calls.find(({ args }) => args[0] === 'click').args.includes('78'), false);
});

test('a transient CDP sync failure retries observation only, never an action', async () => {
  let syncs = 0;
  const { calls, run } = fixture(args => {
    if (args[0] === 'cooperate' && ++syncs === 1) throw new Error('CDP target replaced');
  });
  await withBskApplicationSession(async session => {
    assert.match(await session.sync(), /Autofill/);
    await session.click('@e7', [{ target: '@e7', field: 'text', equals: 'Autofill' }]);
  }, { run });
  assert.equal(syncs, 2);
  assert.equal(calls.filter(({ args }) => args[0] === 'click').length, 1);
});

test('unavailable page during navigation settles with read-only syncs, never a click', async () => {
  let syncs = 0;
  const { calls, run } = fixture(args => {
    if (args[0] === 'cooperate' && ++syncs < 3) return { state: { mode: 'unavailable' } };
  });
  await withBskApplicationSession(async session => {
    assert.match(await session.sync(), /Autofill/);
  }, { run });
  assert.equal(syncs, 3);
  assert.equal(calls.filter(({ args }) => args[0] === 'click').length, 0);
});

test('document replacement between sync and read re-observes before bounded read retries', async () => {
  let reads = 0;
  const { calls, run } = fixture(args => {
    if (args[0] === 'evaluate' && ++reads < 3) throw new Error('document changed');
  });
  await withBskApplicationSession(async session => {
    await session.sync();
    assert.equal(await session.read('document.title'), 'Example job');
  }, { run });
  assert.equal(reads, 3);
  assert.equal(calls.filter(({ args }) => args[0] === 'cooperate').length, 3);
  assert.equal(calls.filter(({ args }) => args[0] === 'click').length, 0);
});

test('an unchanged observation after a delayed click reuses the same page text', async () => {
  let syncs = 0;
  const { calls, run } = fixture(args => {
    if (args[0] === 'cooperate' && ++syncs === 2) return { kind: 'unchanged', state: { mode: 'ready' },
      context_id: 'context-2', observation_id: 'observation-2' };
  });
  await withBskApplicationSession(async session => {
    assert.match(await session.sync(), /Autofill/);
    await session.click('@e7', [{ target: '@e7', field: 'text', equals: 'Autofill' }]);
    assert.match(await session.sync(), /Autofill/);
    assert.equal(await session.read('document.title'), 'Example job');
  }, { run });
  assert.equal(calls.filter(({ args }) => args[0] === 'click').length, 1);
  assert.equal(calls.find(({ args }) => args[0] === 'evaluate').args.at(-1), 'observation-2');
});

test('navigation drops the cached observation instead of reusing old-page refs', async () => {
  let syncs = 0;
  const { calls, run } = fixture(args => {
    if (args[0] === 'cooperate' && ++syncs === 2) return { kind: 'unchanged', state: { mode: 'ready' },
      context_id: 'context-2', observation_id: 'observation-2' };
  });
  await withBskApplicationSession(async session => {
    await session.navigate('https://job-boards.greenhouse.io/test/jobs/123');
    await session.sync();
    await session.navigate('https://job-boards.greenhouse.io/test/jobs/456');
    await assert.rejects(session.sync(), /missing-text/);
  }, { run });
  assert.equal(calls.filter(({ args }) => args[0] === 'click').length, 0);
});

test('ambiguous click is never replayed and cleanup ignores a cancelled signal', async () => {
  const controller = new AbortController();
  const { calls, run } = fixture((args) => {
    if (args[0] === 'click') { controller.abort(); throw new Error('The page may have clicked already'); }
  });
  await assert.rejects(withBskApplicationSession(async (session) => {
    await session.sync();
    await session.click('@e7', [{ target: '@e7', field: 'text', equals: 'Autofill' }]);
  }, { run, signal: controller.signal }), /may have clicked already/);
  assert.equal(calls.filter(({ args }) => args[0] === 'click').length, 1);
  const stopped = calls.find(({ args }) => args[0] === 'session' && args[1] === 'stop');
  assert.equal(stopped.signal, undefined);
});

test('refuses absent, truncated or human-held observations without actions', async () => {
  for (const invalid of [{ ...ready, observation: { ...ready.observation, capture_truncated: true } },
    { ...ready, state: { mode: 'human' } }, { ...ready, context_id: null }]) {
    const { calls, run } = fixture((args) => args[0] === 'cooperate' ? invalid : undefined);
    await assert.rejects(withBskApplicationSession(async (session) => {
      await session.sync();
      await session.click('@e7', [{ target: '@e7', field: 'text', equals: 'Autofill' }]);
    }, { run }), /cannot safely inspect this page \((?:truncated|human-control|missing-context)\)/);
    assert.equal(calls.some(({ args }) => args[0] === 'click'), false);
    assert.equal(calls.at(-1).args[1], 'stop');
  }
});
