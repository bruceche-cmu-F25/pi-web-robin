# Dashboard weekly planner

`PlannerPanel` sits immediately below the calendar (desktop and mobile). It combines existing todos and the local +
connected Google calendar without creating another task collection. The ordinary
Todo/Kanban views and the daily work queue remain usable.

## Low-friction flow

- Open **Plan my week**. Tasks due this week, ongoing/next tasks and existing plans
  are preselected; otherwise suggest the first three todos. Expand the task pool
  to change the selection. Opening, polling and scheduling never invoke a model.
- Optionally describe the week in one note. **Organize my note** runs a stateless,
  zero-tool extraction turn: tasks, date-only deadlines, duration estimates and
  fixed appointments. Existing task ids are linked rather than recreated. This
  step writes nothing. The note survives reload in this tab's sessionStorage.
- Review the extracted rows. Durations have 0.5/1/2/4/8-hour buttons and a custom
  minutes field; choose splittable or uninterrupted work. Estimates not supplied
  by the user remain visibly tentative. Missing appointment times stay empty.
  Without a start time, an entry stays in the all-day band and reserves no time.
  With a start but no end, it also reserves no time; the known start remains visible.
- **Add & preview** explicitly saves the reviewed todos/appointments, then previews
  their timetable. These are separate operations: discarding a timetable does not
  delete captured tasks or appointments. If capture succeeds but preview fails,
  the UI does not resubmit capture. Keep the capture request id on response failure.
- Existing tasks can go directly to **Preview schedule**, without any model use.
  The preview shows new and retained slots, fixed appointments, and all unplaced
  effort. **Accept this plan** is the only operation that reserves focus slots.
- Default scope is the remaining local Monday–Sunday week. Preferences are saved
  in this browser: 09–18, four focus hours/day, weekdays only. Lunch 12–13 and
  15-minute breaks/meeting buffers are always reserved. At most three distinct
  tasks/day; splittable tasks use 30–90 minute chunks (a smaller final remainder is
  allowed); uninterrupted work needs one whole gap. Unknown tasks start at a
  clearly tentative two-hour estimate, never a claim the whole task fits in 30 min.
- Deadline evening overflow is enabled by default and can be disabled in Work
  preferences. First finish the normal-hours pass for every selected task. Only
  still-unplaced tasks due between today and this Sunday may then use 19:00–22:00,
  starting no earlier than the normal work window ends. This adds at most 180
  focus minutes/day beyond the normal budget (breaks reduce actual capacity).
  Calendar conflicts, buffers, continuity, start/work dates, weekend exclusions
  and the three-task limit still apply; no past time or post-deadline work is added.
  Undated, overdue and next-week tasks never receive this overflow. Mark each
  extra slot as `evening` and preserve that flag on acceptance so later previews
  charge retained/logged evening work to its own allowance, not the normal one.
  The preview calls out extra hours, blocks/detail/dashboard rows label them,
  and the grid expands to show all focus slots, including accepted evenings after
  the option is disabled. Disabling changes new proposals, not saved reservations.
- Deadlines sort first and work is placed as early as possible. Work on its due
  date is explicitly flagged as lacking a full-day buffer. Overdue tasks require
  review; the existing Todo Continue decision permits work without rewriting the
  old deadline. Date-only Kanban work commitments are respected and charged even
  if not selected here. Including one converts it into concrete slots no earlier
  than its chosen work date.
- Confirmed slots stay put by default. **Replan selected tasks' future slots**
  explicitly replaces only future slots for the selection, preserving in-progress
  and logged work. Missed/unlogged slots do not count as work done; preview includes
  that effort again. Calendar/deadline conflicts are flagged, never silently moved.
- The dashboard shows today's slots (or the whole week), with links to original
  task destinations. **Did this block** logs planned effort, **Free this slot**
  releases a reservation, and **Finish task** completes the original todo. These
  are distinct operations; elapsed time alone never logs or completes anything.
  Logging can be undone. Completed/archived/deleted tasks release future bookings.

## Reading and adjusting the plan

- Desktop uses a two-pane dialog: compact task/effort controls on the left and
  the timetable on the right. Each task shows its estimate immediately; click
  that estimate to reveal duration presets and uninterrupted/splittable controls.
  Work preferences and repair policy stay folded until needed. The note is optional.
- Phones and narrow windows use Tasks & time / Timetable switches, and the chart
  shows one day at a time with 44px date targets. A successful preview opens the
  timetable. Date/view changes and block inspection are read-only, never model
  calls or schedule writes. Header close and footer preview/accept stay inside
  the iOS safe area, including standalone mode. The footer offers Back to tasks
  without discarding the draft; a zero-slot preview offers preview again, not a
  disabled accept action.
- The week/day grid uses a shared vertical time scale: block height means actual
  duration, including short final remainders. Fixed appointments, confirmed focus
  and proposed focus have labels, different borders and surfaces, not color alone.
  Lunch and excluded days are visibly shaded. Free-looking space still includes
  scheduling buffers; it is not a recommendation to fill every minute.
- Clicking a block opens its full title/date/time/source and original task link;
  Adjust this task returns to its estimate controls. Native nested-dialog Escape
  closes only the detail, preserving the outer preview and returning focus.
  An optional full-detail list provides generous targets for very short slots.
- All-day and missing-end entries stay in a separate Unscheduled band, with the
  known start time shown when present. They never stretch across the time grid.
  Complete timed multi-day events are clipped into each affected day.
  Events wholly outside the work window remain available under an
  explicit disclosure, rather than disappearing or stretching the whole chart.
- The scheduled-focus total includes retained reservations/logged work; the footer
  distinguishes newly proposed effort. Unplaced work has an always-visible count
  and expandable reasons. Acceptance remains explicit; drawing a time grid is
  never confirmation. The outer dashboard's daily slots have a compact time rail
  with the logging action visible and release/finish actions under More.

## Boundaries and safety

- `planner.ts` owns browser-safe types and deterministic scheduling. This is an
  earliest-deadline greedy planner, not an optimal solver. Infeasible effort stays
  visible; it never shrinks a task or extends an unreviewed deadline to hide overload.
- `planner-domain.ts` owns current inputs, proposal revisions, extraction parsing,
  acceptance and block actions. `/api/robin/planner` is a guarded HTTP adapter.
  There is no background replan or paid daily model turn.
- Slots live in `Todo.workPlan.blocks`; whole-task effort reuses `estimateMinutes`.
  `calendarBoard` projects those slots as `source: planner` events. No duplicate
  local calendar records, new SQLite table, or storage migration is needed.
  Split tasks carry chronological `1/6 · …` labels in the main calendar; these
  are distinct effort slots, not six copies of the whole task. Labels never
  change the task title, block identity or total reserved effort.
  Calendar editors treat the projection as read-only and link back to the planner;
  source filtering includes it under Local, not Google. Kanban includes these work
  dates, excludes already slotted tasks from its older day-only generator, and
  charges their duration/task count once.
- Generation fails closed when a connected calendar is incomplete. Disconnected
  Google is explicitly local-only. Only entries with both start and end times reserve time.
  All-day/date-only entries (including multi-day ones) stay visible in the all-day
  band but never consume capacity, shade a day as busy or cause focus conflicts.
  No reminder checkbox or per-event exception is needed; old reminder-id preferences
  are ignored. Entries without an end also reserve no time or buffers and cause no
  focus conflicts, even if they span dates. Google mapping preserves real cross-day
  ends and discards compatibility ends flagged endTimeUnspecified. The revision
  includes the scheduling policy so previews from an older policy must be regenerated.
- Acceptance re-reads the calendar/tasks, checks the revision and local event race,
  then recomputes the shown proposal from validated options/selection/time. Client
  slots are never trusted. Expired (>30 min) or already-past proposals are refused.
  All estimates/slots update in one task-collection write, atomic in SQLite and
  under the JSON collection lock. A receipt makes lost-response retries idempotent.
- Capture uses deterministic ids and validates before writes. SQLite commits todos
  and fixed events together. Transitional JSON has the existing per-file guarantee,
  not a cross-file transaction; retrying the unchanged capture resumes safely.
- `createCalendarEvent` checks an occurrence key under the event storage lock,
  including fresh tool/UI/capture requests: normalized title, date range, start,
  end, location and meeting URL must all match. Request ids that reuse an existing
  local event are retained on it so changed-draft retries still fail closed.
  Calendar and planner views (and calendar tool listings) collapse matching copies
  without deleting records; source filters run first, planner slots stay distinct,
  and raw board records remain intact for revision/race checks. Different titles,
  times or locations are not fuzzy-merged. Google remains strictly read-only;
  preventing local creates does not remove duplicates already in Google.
- Requests are origin/JSON guarded. The extraction agent has no tools, no remembered
  session and a bounded timeout/abort signal. Employer/calendar/task text is data,
  never authority. All extracted dates, ids, sizes and durations are validated again.
- Time follows the existing floating calendar model in the **server's timezone**,
  displayed in the planner. This is not Google write-back or a timezone migration.
- Current limits: no next-week navigation, drag-to-move, optimal packing, automatic
  learning of work habits, or exact-time todo deadlines. If a note specifies a
  deadline time, extraction must call out the date-only limitation. The dialog
  preserves edits on errors/close; only the note and preferences survive reload.

## Checks

```sh
node --experimental-strip-types --test extension/robin/planner*.test.mjs app/api/robin/planner/route.test.mjs
ROBIN_TEST_TASK_BACKEND=json node --experimental-strip-types --test extension/robin/planner*.test.mjs app/api/robin/planner/route.test.mjs
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/weekly-planner.mjs
```

Tests cover deadline order, blocked/fragmented/unknown time, lunches/buffers,
continuous tasks, budget and WIP limits, partial packing, past time/weekends,
completed effort, retained/repaired slots, stale input, read-only previews,
idempotent acceptance/capture, completion vs logging, malformed model output and
request guards. Seeded calendar fuzzing checks overlap and effort conservation.
Browser tests mock every dashboard API: no personal task/calendar writes and no
model calls. They cover capture/effort chips, failed acceptance, retry, reload,
partial-calendar failure, modal focus and English/Chinese phone/desktop layouts.
