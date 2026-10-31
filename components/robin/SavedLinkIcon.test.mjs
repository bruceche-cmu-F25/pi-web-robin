import assert from 'node:assert/strict';
import test from 'node:test';
import { shelfLogo } from '../../extension/robin/shelf-logos.ts';
import { deferred, hookHarness, settle } from '../../scripts/react-hook-harness.mjs';

function harness(fetch = () => { throw new Error('Unexpected fetch'); }) {
  const activity = { value: true };
  const h = hookHarness(new URL('./SavedLinkIcon.tsx', import.meta.url), {
    '@/extension/robin/shelf-logos': { shelfLogo },
    './usePolledResource': { ResourceActivity: activity },
  }, { URL, fetch });
  return { ...h, activity };
}

test('original cached icon, bundled site resource, then neutral fallback; new versions retry', () => {
  const h = harness();
  const link = { id: 'a/b', url: 'https://fullstackopen.com/en/', title: 'Course', icon: 'png', iconCheckedAt: 'v1' };
  const render = () => h.render(() => h.exports.SavedLinkIcon({ link, size: 24 }));
  let icon = render();
  assert.equal(icon.type, 'img');
  assert.equal(icon.props.src, '/api/robin/links/icon/a%2Fb?v=v1');
  assert.equal(icon.props.width, 24); assert.equal(icon.props.alt, '');
  icon.props.onError(); icon = render();
  assert.equal(icon.props.src, '/robin/logos/fullstackopen.com.png');
  icon.props.onError(); icon = render();
  assert.equal(icon.type, 'svg');
  link.iconCheckedAt = 'v2'; icon = render();
  assert.equal(icon.props.src, '/api/robin/links/icon/a%2Fb?v=v2');
  h.unmount();
});

test('missing/invalid sites never invent a brand or make third-party browser requests', () => {
  for (const url of ['mailto:user@example.com', 'not a URL', 'https://unknown.example']) {
    const h = harness();
    assert.equal(h.render(() => h.exports.SavedLinkIcon({ link: { id: 'x', url, title: 'Example' } })).type, 'svg');
    h.unmount();
  }
});

test('legacy backfill is serial, bounded after failures and paused in hidden panes', async () => {
  const requests = []; let refreshes = 0;
  const h = harness((url, options) => { const request = deferred(); requests.push({ ...request, url, options }); return request.promise; });
  let links = [{ id: 'one', url: 'https://one.example' }, { id: 'two', url: 'https://two.example' }];
  const refresh = async () => { refreshes++; };
  const render = () => h.render(() => h.exports.useLinkIconBackfill(links, refresh));
  h.activity.value = false; render(); assert.equal(requests.length, 0);
  h.activity.value = true; render(); render(); assert.equal(requests.length, 1);
  requests[0].reject(new Error('offline')); await settle(); render();
  assert.equal(requests.length, 2, 'Failure advances to the next site, not a retry loop');
  assert.equal(requests[1].url, '/api/robin/links/icon/two');
  requests[1].resolve({ ok: true }); await settle(); render(); render();
  assert.equal(requests.length, 2); assert.equal(refreshes, 2);
  links = [{ ...links[0], url: 'https://changed.example' }, links[1]]; render();
  assert.equal(requests.length, 3, 'An edited URL gets a new lookup');
  requests[2].resolve({ ok: true }); await settle(); h.unmount();
});
