import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { initializeBriefPipeline } from './brief-domain.ts';

test('independent processes share the same claim fence, not a JavaScript busy flag', { timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-process-test-'));
  const previous = process.env.ROBIN_DATA_DIR;
  const children = [];
  process.env.ROBIN_DATA_DIR = root;
  try {
    initializeBriefPipeline();
    const script = `import { runShadowBrief } from ${JSON.stringify(new URL('./brief-domain.ts', import.meta.url).href)};
      try {
        const result = await runShadowBrief(process.env.REQUEST, {
          scope: { day: '2026-10-30', timezone: 'UTC' },
          collect: async source => {
            if (source === 'mail' && process.env.HOLD === '1') { process.send({ ready: true }); await new Promise(resolve => process.once('message', resolve)); }
            return { source, observedAt: new Date().toISOString(), coverage: 'ready', detail: 'fixture', items: [] };
          }
        });
        process.send({ id: result.id });
      } catch(error) { process.send({ error: error.message }); }
      process.disconnect();`;
    const start = (request, hold) => {
      const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
        env: { ...process.env, ROBIN_DATA_DIR: root, NODE_NO_WARNINGS: '1', REQUEST: request, HOLD: hold ? '1' : '0' },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      children.push(child); return child;
    };
    const first = start('worker-one', true);
    assert.deepEqual((await once(first, 'message'))[0], { ready: true });
    const second = start('worker-two', false);
    const secondExit = once(second, 'exit');
    assert.match((await once(second, 'message'))[0].error, /already running/);
    await secondExit;
    const completed = once(first, 'message'), firstExit = once(first, 'exit');
    first.send('continue');
    assert.ok((await completed)[0].id); await firstExit;
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    if (previous === undefined) delete process.env.ROBIN_DATA_DIR; else process.env.ROBIN_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
