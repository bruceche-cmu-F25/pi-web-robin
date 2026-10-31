# Calendar workspace: stable series colors

The phone Dashboard's Calendar destination is the shared **hourly timeline**,
with Day and Week modes. Entering its bottom tab opens Day; legacy Month/Agenda
URLs and stored preferences normalize to Day. Desktop keeps all four views.
Previous/Today/Next controls and the date picker navigate without another date strip.
Home defaults to today using independent `dailyDate` browsing, never Calendar's
`date` (which may be an earlier Monday). Clicking Home resets its browsing date. Today remains a
return-to-today command, not the view name. Phone single-day all-day bars have 44px targets and
remain above the time scale. Event record links no longer force Agenda mode.
The desktop calendar remains alongside tasks. See [Daily workspace](dashboard-workspace.md).

The desktop Dashboard calendar keeps its existing day/week/month/agenda navigation,
06:00–21:00 time scale, source filters, editing, dragging and Google read-only
boundary. In the phone Glass layout the page scrolls underneath Dashboard chrome;
drag previews and edge autoscrolling clip to the actual visible header/dock bounds,
not merely the now-full-height scrollport. `E2E_THEME=glass` runs the calendar-edit
browser suite against this layout as well. The Apple-inspired treatment is scoped to the calendar: system-font
date/event hierarchy, grouped 44px toolbar actions, a red circular today marker,
softer grid lines, 8px timed-event corners and 4px all-day bars. Phone Calendar
restores the earlier serif date/mono time typography, outlined event rectangles
and quiet Add control; desktop retains its current treatment. This is a presentation
restoration, not a rollback of source colors, bounded tasks, read-only rules or
write guards. It does not add
large translucent surfaces, animation dependencies or polling. Dense overlaps
still have limited room; click an event to read its full title/details. Existing
Todo popover motion and drag behavior are unchanged.

## Stored-data briefing reads

`calendarBoard({ localOnly: true })` is an explicit read-only snapshot for the
Unified Brief shadow pipeline. It returns local/focus records without refreshing
Google, and a connected account carries an incomplete-coverage warning. The
ordinary calendar route/tool still use the full read; this option does not change
their default behavior or Google's read-only boundary.

## What a color means

The user chose **event series**, not calendar source. `seriesSeed` uses the
provider's `colorSeed` (Google recurrence identity, already namespaced by the
mapper), falling back to the trimmed title for local events. A Google occurrence
can move or change title without changing the series identity. Local same-title
events intentionally share a color; renaming a local title changes its identity.
No guessed keyword categories, title rewriting or recurrence records are added.

`eventColorKey` hashes that identity into the existing nine keys. The old
`orderSeriesColors` time-ranked deal has been removed: it shifted every later
series when an early one appeared, and ranged Google reads made date navigation
change the set. Automatic colors now depend on neither start time, arrival order,
visible dates nor unrelated additions/deletions. Nine keys can collide; this is
not a promise of a unique color for every series. Manual overrides resolve the
collisions the user cares about without recoloring other series.

`eventSurface.ts` supplies one rule to all views: vivid 3px spine/marker, neutral
text, opaque panel mixed with 12% hue for timed events and 20% for all-day spans.
Week/day formerly called the span surface for timed events; they now use timed.
Month timed rows use the same marker and neutral text. Colors are calendar-only
`--calendar-*` tokens with separate light/dark values in `CalendarPanel.module.css`;
the shared `--event-*` palette used by Todo, Product and Learning is unchanged.
The current-time line/today marker is red and remains a separate UI signal.

## Manual preference, not an event mutation

Open an event's details and use **Series color**, or **Automatic** to remove that
series' override. It applies to every occurrence with that identity in this
browser, including read-only Google events, but never changes the event or sends
a Google/API write. The disclosure says so explicitly.

`useCalendarColors.ts` stores one allow-listed color key per series under
`robin-calendar-series-color:v1:<encoded seed>` in localStorage. Separate keys
prevent two tabs editing different series from overwriting each other's choices;
`storage` events update other tabs. Same-series concurrent choices are last-write
wins. Unknown values are ignored, not interpolated into CSS. Failed writes keep
the previous color and show an error; failed reads retain the last known map.
Automatic colors need no persisted registry. Preferences are plaintext,
origin/browser-local and may be cleared/evicted; they are not account settings,
encrypted storage, cross-device sync or recovered from the server. Only an
explicit choice writes storage; opening the calendar does not assign/save colors.

## Bounded task band

`CalendarTasks.tsx` owns the day/week task band and the native dialog showing all
unfinished tasks covering one date. Week view uses one bounded 60px row: a two-line
preview of a task due that day (falling back to an ongoing task), plus `+N` for the
remaining tasks. Single tasks show no count; empty dates stay blank. Clicking a
preview opens the full day list. This replaces the count-only “Tasks · N” cells,
without adding a second grid of cards or letting a busy day stretch the calendar.
The accessible name includes the date, total and preview title. Phone Day uses
this same 60px summary and full dialog, keeping task cards from burying the hours;
its all-day scroller is capped at 150px. Desktop Day retains
the following richer task bars. `calendar-task-layout.ts` reuses the existing
span allocator, retains at most three continuous lanes, and counts each hidden
range once on **each date it covers**. It does not split ranges, truncate stored
titles, change dates, or hide tasks from the full list. Range continuity takes
priority over filling every day's three slots. The band can be collapsed for the
current mounted date/view; navigation resets it. No new persistence or polling.

The checkbox and two-line title sit together, with neutral surfaces and light
separators instead of dashed amber cards. Today/overdue deadlines are emphasized;
the full list also labels those states in words. Explicit task colors survive as
small dots, not automatic colored borders. Dates remain visible on range bars.
Desktop fine-pointer secondary actions appear on hover or keyboard focus without
reflow; coarse-pointer controls stay visible with 44px targets. The independent
right-side grip still opens the deadline editor or drags the whole range, keeping
the date **under that grip** as its origin (formerly the grip was on the left).
Desktop Month/Agenda and the separate Todo panel retain their existing presentations.

Desktop clipped titles keep the native full-text popover and its existing motion.
Phone titles now use a two-line button opening the full day list, not unbounded
inline text or a hover popover. The manually selected phone day-grid task band stays a single compact
row; manually chosen phone week view reserves a separate 44px control row. Linked
titles still open their original/inferred destinations from the full list (and
directly from desktop previews). No title rewriting or guessed short names.

The native modal keeps the page inert, scrolls long content inside its bounded
surface, closes with Escape/close/backdrop, and returns focus to the opener or a
surviving calendar control. It shows full titles, date ranges, completion and a
revision-checked **Change date** action through the existing editor. The list
closes before that editor opens. A last completion leaves an explicit empty state.
Completion is server-confirmed, guarded synchronously per task, and disables that
task's controls while pending. Failure retains the task and displays its error
inside the list; a confirmed response updates the cache even if a following read
fails. This adds no task/calendar writes except explicit completion or date edits.

## Verification

```sh
node --experimental-strip-types --test extension/robin/eventColors.test.mjs components/robin/calendar-edit.test.mjs components/robin/calendar-view.test.mjs components/robin/calendar-task-layout.test.mjs lib/i18n/registry.test.mjs
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/calendar-tasks.mjs
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/calendar-design.mjs
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/calendar-edit.mjs
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/todo-calendar-drag.mjs
```

Synthetic API fixtures check different date windows, earlier-series insertion,
recurring occurrences, manual/reset/reload/cross-tab choices, unavailable storage,
invalid stored values, no API writes from preferences, Google read-only actions,
all four views, nine distinct palette values, event-text contrast ≥4.5:1 in light
and dark, and the Chinese 320px picker. Existing editing and Todo drag tests keep
range selection, movement/resizing, failed saves, touch/keyboard alternatives and
popover behavior covered. No personal calendar data is written. Chromium viewport
checks do not certify physical iPhone/Safari behavior or color-blind distinguishability
of every pair; labels/details remain necessary. The task suite adds exact per-date
hidden counts, bounded height, range continuity, collapse, native-modal focus,
links, double activation, failed completion, confirmed receipts with failed reads,
the existing date editor, overdue/last-task states, and English/Chinese light/dark
layouts at 320/375/1024/1600px. All mutations in these suites use synthetic mocks.
