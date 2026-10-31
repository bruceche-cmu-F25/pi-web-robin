import assert from 'node:assert/strict';
import test from 'node:test';
import { isIOSLinkPlatform, savedLinkLaunch } from './saved-link-launch.ts';

test('OS identity selects URI handlers, not layout or installation status', () => {
  assert.equal(isIOSLinkPlatform({ userAgent: 'Mozilla iPhone', platform: 'iPhone', maxTouchPoints: 5 }), true);
  assert.equal(isIOSLinkPlatform({ userAgent: 'Mozilla Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(isIOSLinkPlatform({ userAgent: 'Mozilla Macintosh', platform: 'MacIntel', maxTouchPoints: 0 }), false);
  assert.equal(isIOSLinkPlatform({ userAgent: 'Mozilla Android', platform: 'Linux', maxTouchPoints: 5 }), false);
});

test('home shortcuts explicitly open the iOS app home, not an invented account or record', () => {
  for (const [url, href, app] of [
    ['https://mail.google.com/mail/u/0/#inbox', 'googlegmail://', 'Gmail'],
    ['https://calendar.google.com/', 'googlecalendar://', 'Google Calendar'],
    ['https://docs.google.com/document/u/0/?tgif=d', 'googledocs://', 'Google Docs'],
  ]) {
    assert.deepEqual(savedLinkLaunch(url, true), { href, app, home: true });
    assert.deepEqual(savedLinkLaunch(url, false), { href: url });
  }
});

test('supported page handoffs preserve the exact path, query and fragment', () => {
  const notion = 'https://www.notion.so/Project-1234567890abcdef1234567890abcdef?source=copy_link#notes';
  assert.deepEqual(savedLinkLaunch(notion, true), { href: notion.replace('https:', 'notion:'), app: 'Notion' });
  const doc = 'https://docs.google.com/document/d/fixture_123/edit?tab=t.abc#heading=h.xyz';
  assert.deepEqual(savedLinkLaunch(doc, true), { href: `googledocs://${doc}`, app: 'Google Docs' });
});

test('unknown sites, unsafe host lookalikes and specific Gmail/calendar records never become app-home links', () => {
  for (const url of [
    'https://mail.google.com/mail/u/0/#inbox/message-id',
    'https://mail.google.com/mail/u/0/?authuser=someone@example.com#inbox',
    'https://calendar.google.com/calendar/event?eid=record',
    'https://calendar.google.com/?eid=record',
    'https://github.com/', 'https://chatgpt.com/', 'https://claude.ai/',
    'https://notebooklm.google.com/notebook/record',
    'https://mobile.eprintitsaas.com/app/add-files?locationid=fixture',
    'https://www.notion.so/login', 'https://www.notion.so.evil.test/1234567890abcdef1234567890abcdef',
    'https://mail.google.com.evil.test/mail/u/0/#inbox',
    'https://mail.google.com@evil.test/mail/u/0/#inbox',
    'https://user:pass@calendar.google.com/', 'https://calendar.google.com:8443/',
    'http://calendar.google.com/', 'not a URL', 'javascript:alert(1)',
  ]) assert.deepEqual(savedLinkLaunch(url, true), { href: url });
});
