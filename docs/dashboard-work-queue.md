# Dashboard work queue

`WorkQueuePanel.tsx` sits directly below the calendar in the main dashboard lane.
It uses the existing todos and calendar endpoints, without an agent turn, external
notifications, calendar writes, or another task collection.

## Daily loop

- Suggest up to three active todos: explicit Next, in-progress, planned work,
  then deadlines. Exclude archived/completed tasks and future start/work dates.
- The user confirms the queue or edits its membership/order. Polling does not
  replenish or reorder a confirmed queue. Completion remains the todo's own state.
- Inside the configurable same-day work window (default 09:00–18:00), recommend
  the first task whose user-confirmed estimate fits. Otherwise offer a clearly
  labelled five-minute kickoff, not a five-minute estimate for the whole task.
- Starting marks the original todo Doing and starts a local five-minute check-in.
  The task title opens its existing link. Timer expiry never completes the todo.
- Later hides that task from automatic recommendations for 30 minutes. After two
  deferrals, open the editor and suggest making the next step smaller or removing
  the task from today. Removal never deletes the original task or changes its DDL.
- Rest pauses suggestions for 30 minutes, with an explicit resume action. A note
  beside the active task records the next small step / where to resume.

## Availability and persistence boundaries

`work-queue.ts` is browser-safe pure scheduling and storage parsing logic. Times
follow the device's wall clock, consistent with the calendar's floating-time model.
The panel requests today's events independently of the calendar's selected view.
Ten-minute buffers surround events with both endpoints; overlapping/multi-day
intervals block their actual times. All-day/date-only and missing-end entries
reserve no time or buffers, including multi-day entries.
Loading, errors and partial Google reads suppress automatic free-time suggestions. Manual starts remain available. Disconnected Google is
explicitly described as local-calendar-only coverage.

The first version deliberately stores queue/order, next-step notes, deferrals,
work hours and check-in timer in `localStorage` (`robin-work-queue:v1`). It is
browser-local, not cross-device planning. Storage events synchronize open tabs;
unavailable storage is disclosed and the current tab remains usable. Midnight
requires a fresh daily selection while preserving notes and work hours. Old daily
commitments/timers are not carried over. Parsing bounds membership and notes.

Task status and whole-task estimates still use revision-checked PATCH requests to
`/api/robin/todos`. Confirmed responses update the panel and the shared refresh bus;
failed writes retain the task and display the error. `plannedOn` and `due` are
inputs, never overwritten by this panel.

## Checks

```sh
node --experimental-strip-types --test components/robin/work-queue.test.mjs
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/work-queue.mjs
```

The browser test uses the existing dev server and mocks all dashboard APIs. It
covers confirmation, fit, reload recovery, timer expiry, failed completion writes,
completion, repeated deferral, removal, rest, partial-calendar failure/recovery,
and phone/desktop layouts in English and Chinese. No personal task data is written.
