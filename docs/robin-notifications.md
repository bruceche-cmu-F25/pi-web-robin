# Robin scheduled notifications

## Behavior

- One delivery choice for the existing daily agenda, mail digest, job digest and calendar reminders: phone Web Push or Telegram. Switching channels does not enable disabled schedules, change times, remove Telegram credentials, or redirect interactive Telegram replies.
- Existing installations keep Telegram until explicitly switched. This installation is switched to phone at the user's request. Category switches are the existing schedule switches.
- Phone notifications are short lock-screen summaries linking to the relevant Robin page, not a second copy of a long Telegram message. No new-job notification is sent when there are no eligible jobs. A fresh structured mail review containing only FYI/handled items consumes the slot without a notification; a missing/stale review never establishes that the inbox is quiet.
- A phone must register once from its installed HTTPS app. Server and supervised bridge must remain running; phone mode needs no Telegram token or reachable Telegram service. The bridge's independent timer owns these schedules; the web server does not start a second scheduler.
- Calendar checks continue while a digest is running. The same digest never overlaps itself. Settings are re-read on each timer tick.
- Sending to a push service is acceptance, not proof that iOS displayed/read a notification. No subscriptions or no successful acceptance must not be marked delivered. Invalid subscriptions are removed; temporary failures are retained. With multiple devices, acceptance on at least one counts as delivered (best effort, not a per-device guaranteed queue).
- Existing delivery ledgers remain authoritative. Recipient `0` is reserved for the Web Push audience (Telegram has no chat 0). Existing numeric chat records are not rewritten. A slot already sent to a configured Telegram recipient is not replayed on switching to phone; a phone-delivered slot is not replayed on switching back. This also prevents restarting an already-completed nightly sweep.
- A stable notification id suppresses repeat delivery to already-accepted subscriptions, including retries after an HTTP response is lost. Receipts live with the existing push subscription state, expire after seven days and are bounded. Reusing an accepted id for different content returns 409 rather than reporting that an unsent, different job batch was delivered; callers must reuse the same payload for retries. Network acceptance followed by a crash before saving remains an uncertainty window; this is not exactly-once delivery.
- Calendar notifications have a short lifetime ending around the event start; scheduled summaries expire after an hour. Session-completion behavior is unchanged.

## Interface and scope

`lib/web-push.ts` exposes `sendPushNotification({ id, title, body, url, ttl? })` and reports accepted/failed/expired subscription counts. `POST /api/push/send` is the authenticated HTTP adapter for external scheduled callers; `GET` reports only the registered subscription count. Payloads and same-origin relative links are validated before sending. Neither route exposes subscription endpoints or keys.

The existing bridge calls this interface for its four scheduled categories. Telegram chat messages still use the Telegram transport. Other independent automation (including the separately configured AI weekly scheduler) is not silently enabled or redirected; it can adopt this interface explicitly.

## Checks

- Transport tests: generic payloads, bounded payloads/links/TTL, receipts across restart, repeat/concurrent requests, partial and total failure, 404/410 cleanup; existing session notifications remain localized.
- Bridge tests: push needs no chat id/token, no Telegram duplicate, failed push consumes no jobs/ledger slot, zero jobs stays quiet, stable reminder IDs/deep links, slow jobs do not delay reminders, Telegram outage does not stop timer ticks.
- Settings tests: channel validation and persistence without changing existing schedule/credential fields. Browser check at phone width; existing category controls remain usable.
