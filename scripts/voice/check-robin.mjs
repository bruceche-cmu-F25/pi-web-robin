#!/usr/bin/env node
// Health by default. A model turn requires an explicit --live flag.
import { randomUUID } from 'node:crypto';
import { RobinReadOnlyBackend } from './robin-backend.mjs';

const [flag, ...words] = process.argv.slice(2);
if (flag && flag !== '--live') {
  console.error('Usage: node scripts/voice/check-robin.mjs [--live optional question]');
  process.exitCode = 1;
} else {
  const backend = new RobinReadOnlyBackend({
    origin: process.env.ROBIN_VOICE_ORIGIN || 'http://127.0.0.1:30141',
    password: process.env.PI_WEB_PASSWORD || '',
  });
  const abort = () => void backend.close();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    await backend.start();
    if (!(await backend.health()).ok) throw new Error('Robin unavailable or authentication required; check the local server and PI_WEB_PASSWORD.');
    if (flag === '--live') {
      console.log('Running one read-only Robin model turn; model usage may be billed. Ctrl+C cancels delivery.');
      const result = await backend.submit({
        id: randomUUID(), ownerId: 'robin-local', instruction: words.join(' ') || '请读取我的待办，简短说明今天需要处理什么；不要修改任何数据。',
      });
      console.log(result.content);
    } else {
      console.log('Robin is reachable and authenticated. No model turn or speech API was called.');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await backend.close();
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}
