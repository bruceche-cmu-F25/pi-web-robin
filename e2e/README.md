# CI and browser regression tests

Adapted from @Nuctori's CI/E2E proposal in #617 and #599. The performance
scanner, reverse reader, sidebar changes, and timing benchmarks are not included.

```sh
npm ci
npx playwright install chromium
npm run test:e2e
```

The script starts and stops its own Turbopack dev server on an available
loopback port. Run it in a checkout without an active dev server; Next.js
shares `.next/dev/lock` within a checkout. All fixtures are created before
startup in a temporary `PI_CODING_AGENT_DIR` and removed on completion.
No model credentials or existing Pi sessions are needed.

CI runs lint, type checking, and unit tests in one job. A separate job builds
the application in a clean checkout and runs the same browser tests with
`E2E_SERVER_MODE=start` against `next start`. Do not build in a checkout used
for development.

Coverage:

- A 5,000-message session opens with exactly the last 50 entries, bounded
  detail/context responses, and no browser errors.
- Desktop and mobile scrolling load two consecutive older pages. Each response
  has the expected IDs, no gaps or duplicates, and the messages appear once in
  the chat. A small session checks pagination through the root.
- Branch context follows the selected leaf and excludes the other branch.
- Markdown, code blocks, and real tool-call/tool-result blocks render.
- Chat width and font size persist, existing drafts resize, and short settings
  panels keep every language option reachable on desktop and mobile.
- Unknown sessions and paths outside the fixture project are rejected.
- A local extension checks dialog keyboard navigation, Esc cancellation,
  collapse/expand draft preservation, countdown display, and server-side expiry.

For the incremental Robin navigation check against an **already running** dev
server (all application APIs mocked, no personal data writes):

```sh
node --env-file-if-exists=.env.local --experimental-strip-types e2e/robin-navigation.mjs
# Set PLAYWRIGHT_CHANNEL=chrome to use installed Chrome instead of bundled Chromium.
```

This checks document reuse between the six opted-in overview routes, retained
Dashboard navigation, history, keyboard/new-tab behavior, the mobile drawer,
session/cwd parameters, native editor exit guards, and expired-login redirects.
Printed timings use mocked data and include browser automation overhead; they
are diagnostic, not production benchmarks. Editors and chat remain native
navigation boundaries; no route prefetching or data-cache changes are included.

Dashboard work queue (existing server, all dashboard APIs mocked):

```sh
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/work-queue.mjs
```

Checks daily confirmation, gap fitting, five-minute starts, reload recovery,
failed writes, completion, repeated deferral, rest, calendar failure/recovery and
responsive English/Chinese layouts. No real task data is changed. See
[`docs/dashboard-work-queue.md`](../docs/dashboard-work-queue.md) for storage and
availability boundaries. `E2E_SCREENSHOT_DIR` captures both themes.

Dashboard responsive regression (existing server, all dashboard APIs mocked):

```sh
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/dashboard-mobile.mjs
```

Checks English/Chinese at 320–2560px, phone Day defaults, separate phone/desktop
view preferences and explicit URL overrides, one/two/three-column placement against the
actual workspace width, consistent italic section headings and upright controls,
forms, anchors, horizontal overflow, and draft retention during reflow. Phone checks
also cover a one-row search bar, two-row calendar toolbar with non-overlapping 44px
targets, no duplicated Day heading controls, readable copy without per-item toggles,
secondary task/link menus, on-screen nested editors and equal-width round actions.
Mode/layout changes preserve the search draft and never execute it. Long-list
fixtures (60 additional tasks and 80 additional links) verify independent lanes,
collapse/expand reflow, and link-group columns based on the card's own width.
The action queue checks OA/mail/todo deduplication, deadline ordering, source errors,
workspace links and live empty-state removal; job previews check the score floor,
role deduplication and five-item limit. Only Todo and Links use the side lane. Set
`E2E_SCREENSHOT_DIR` for mobile and wide-layout screenshots in both themes.

Act result and execution-record regression (all APIs mocked; no model runs):

```sh
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/assistant-act.mjs
```

Checks English/Chinese, 320–430px close controls, bounded long replies, live session
links, dismissal without deletion, record recovery after reload, unavailable status,
timeouts with a still-running agent, retained drafts and no automatic duplicate writes.
Read-only status and exact reply session IDs are covered by
`app/api/robin/assistant/route.test.mjs`.

Inline attention settlement regression (existing server; all writes mocked):

```sh
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/attention-settle.mjs
```

Covers mail handled, round done/missed/cancelled, undo/reopen, exact source IDs,
duplicate activation, failed writes/undo, confirmed saves with failed refreshes,
last-item feedback, reload persistence, and Chinese phone-width controls. Neither
Gmail nor personal hiring statuses are changed by this test.

Calendar interaction regression (also uses an **already running** server and mocks
all dashboard APIs):

```sh
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/calendar-edit.mjs
```

Covers natural-month navigation, visible-range reads, day view, source filters,
full-height 06:00–21:00 day/week grids, page wheel/drag-edge scrolling, boundary-hour
creation and clipped-event rendering, blank-cell/range creation, 15-minute timed moves, end resizing,
inclusive multi-day ranges grabbed from the middle, mouse/touch cancellation,
dense all-day headers, dirty-draft cancellation, keyboard editing,
Google edit guidance (English/Chinese, event link or safe fallback, no local writes),
save failure, duplicate submission, lost-create-response retries, confirmed saves
surviving failed refreshes, stale-edit conflicts, and late deletion callbacks.
Month date numbers and overflow links open the selected day. Set
`E2E_SCREENSHOT_DIR` to save week/month screenshots. Storage validation and atomic
compare-and-patch tests live in `app/api/robin/events/route.test.mjs`; run them with
both the default SQLite backend and `ROBIN_TEST_TASK_BACKEND=json`.

Todo calendar rescheduling (mocked APIs; no personal task writes):

```sh
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/todo-calendar-drag.mjs
```

Covers calendar and sidebar grips, undated tasks, date-only deadlines, clipped
multi-day ranges, month/agenda moves, mouse/touch cancellation, duplicate writes,
revision conflicts, confirmed saves with failed refreshes, retained failed drafts,
keyboard date editing and the Chinese phone dialog. Desktop week titles at
1024/1600px expose full English/Chinese/unbroken text through hover, focus and
keyboard activation. At 320/375/640px phones show full text directly, with no
preview button or popover. Tests cover resizing an open preview to phone layout,
viewport bounds, pointer entry/exit, Escape without reopening, and no layout shift.
`E2E_SCREENSHOT_DIR` saves compact desktop cards, previews and expanded phone text.
Planning dates, estimates and
links remain unchanged. Todo PATCH regression tests also run against SQLite and JSON.

Model prompts, live model streaming, and agent execution are outside this suite.
Failures save a screenshot, Playwright trace, and server log under
`test-results/e2e/`; CI uploads that directory. Open a trace with
`npx playwright show-trace test-results/e2e/trace.zip`.
