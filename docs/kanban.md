# Kanban focus planning

`/dashboard/kanban` is another view of Robin todos, not a separate task store.

## Interaction design

Reference review: [Vikunja views](https://vikunja.io/help/views/) (compact cards,
explicit WIP feedback, multiple task views) and [Linear board layout](https://linear.app/docs/board-layout)
(board/list parity and details on demand). These are interaction references, not
copied components; Pi's existing typography, straight edges and theme tokens stay.

- Tasks occupy the first screen. Today/This week/Pool are primary; review and
  abandoned history are secondary. One short sentence explains the current scope.
- Board and compact list share the same tasks, ordering and controls. Desktop
  columns scroll independently; the list has one scrollport. No second data store.
- Cards show only present properties, not repeated “no deadline/no estimate” text.
  Work dates and deadlines stay labelled separately; approximate Agent estimates
  retain their visible ≈ marker, tooltip and accessible description.
- Titles retain their existing source links. The labelled details button opens a
  right-side editing drawer, with a multiline title field and separate date fields.
- The header's Plan work button opens the calendar-aware planner in a native modal
  drawer. Preferences are collapsed; warnings and proposed work remain explicit.
  Closing it retains the suggestion without accepting it. Escape and focus return
  use native dialog behavior; acceptance cannot be interrupted by closing.
- On phones, a status switch shows one board column at a time (list mode still
  shows all groups). Moving a task switches to its destination. Unplanning a task
  that disappears returns keyboard focus to the board. Short landscape screens
  use page scrolling rather than squeezing the board into a tiny scrollport.
- Empty focus has an explicit action to choose from the pool. WIP remains a soft
  warning across all active tasks, never a new blocker on manual edits.
- Interaction feedback changes surfaces and text, not borders: short color
  transitions for hover/press/selection, a tinted drop column, and one 480ms color
  wash after a confirmed move (green for completion). Polling and failed writes
  never trigger it. Drawers fade in without moving targets. Reduced-motion mode
  skips transitions/animations; keyboard focus uses contrasting fill and system
  high-contrast mode retains a native outline. Existing structural rules stay.

## Behavior

- Today is the default. Today/This week show explicitly planned tasks, recent
  completion, ongoing work, and the explicitly chosen next task. This week is
  Monday–Sunday, using the server's local calendar.
- Task pool holds non-archived work and completion history. Tasks needing review
  normally live in Review, but ongoing/next work remains visible in Today, Week
  and Pool with a rescheduling action. Its dates are never silently rolled forward.
  A deadline alone still does not select a task for focus.
- One active task can be marked next, atomically across the collection. It sorts
  first within its workflow column in both layouts and appears in focus without
  changing dates or status. Completion, abandonment, or choosing another clears it.
- `plannedOn` is a work date; `due` is a deadline. Changing or clearing one never
  changes the other. The older `startDate`/`due` range remains supported.
- A passed deadline or missed planned date enters Needs review. Continue preserves
  the deadline, clears an expired work date, and asks again in seven days. Abandon
  is reversible, not completion or deletion. Archived tasks are excluded from
  ordinary todo/calendar/round queries unless explicitly requested.
- Completed history is no longer automatically pruned. Previously pruned records
  are not recovered. Task writes, including batch acceptance, are atomic under
  a SQLite transaction after [explicit cutover](robin-task-storage.md), or the
  existing file lock before cutover.

## Editing and navigation safety

- The editor submits only fields that actually changed. Todo GET/POST/PATCH
  responses include a computed per-task `revision`, never stored on the task.
  Kanban sends it on edits, deletion, review, and next/status/plan actions. The
  domain checks it inside the storage transaction (legacy JSON: file lock), and
  HTTP returns 409 on conflict.
  Unrelated task updates do not conflict. Legacy tools/clients may omit revisions.
- Dirty drafts are saved to this tab's sessionStorage with their original base
  values and revision. Reopening after a reload restores them without bypassing
  conflict detection. Closing dirty edits asks before discarding; successful save
  or explicit discard clears the draft. Storage-unavailable browsers retain the
  closing/unload guard but cannot restore a draft after leaving the page.
- Conflicts retain the draft. Loading latest data explicitly asks before discarding
  it; failed writes never close the drawer. Deleted tasks keep their draft visible
  for copying. Desktop focuses the title; touch devices do not force the keyboard.
- `view`, `q`, `scope`, `column`, and `layout` are URL state, preserving unrelated
  parameters such as `session`. View/scope changes use history pushes; typing and
  layout/column changes replace the current entry. Back/forward and reload restore
  context. Layout also has a browser preference, with explicit URLs taking priority.
- Search explains its scope and offers all-task search with the number of matches
  outside the current view, even when there are partial results. All-task search
  includes archived/review work, labels its state, and preserves the keyword.

## Capacity and proposals

The dashboard's [weekly planner](weekly-planner.md) adds concrete focus slots on
`Todo.workPlan.blocks`, projected read-only into the calendar. Kanban shows their
work dates too. Its day-only generator excludes tasks already carrying focus
slots, and capacity charges the projected slots' duration and distinct-task count
once rather than adding the same task's whole estimate again.

The on-demand planning drawer uses existing local and connected Google events. Its
preferences (daytime window, daily minute budget, horizon, all-day policy) are
saved in this browser. Default budget: 120 minutes; at most three planned tasks
per day. The user can manually exceed these, with a capacity warning. Ongoing and
next-task visibility does not reserve time: only dated plans consume that budget.

Calendar intervals are clipped to the remaining daytime window and merged, so
local/Google duplicates and overlapping meetings are not double-counted. Entries
without an end time reserve no time. Existing plans without estimates reserve 30 minutes.
All-day entries are explicitly flagged but not deducted by default; the user can
choose to block those days. No end-of-class/holiday semantics are guessed. This
is a conservative capacity estimate, not a claim that the user's calendar is
complete. If connected Google data cannot be fully read, generation and acceptance
are refused. Disconnected Google is reported as local-only.

An explicit button invokes a stateless Agent with **zero tools**. Calendar/task
text is untrusted input. It can only propose existing, unplanned, review-cleared
task IDs, dates, effort estimates and short reasons. Large/vague goals should be
left out rather than squeezed into tiny blocks. Output is validated against
identity, deadline/start dates, daily task/budget limits and contiguous free gaps.
Agent estimates remain labelled after acceptance until manually edited.

Suggestions are ephemeral and do not write anything. Acceptance re-reads tasks
and calendar, checks the original revision, validates the selected subset against
current remaining time, and atomically writes only work dates and estimates.
Changes made in another tab or by another agent require a new proposal. No
calendar appointments are created and no statuses are changed. There is no
scheduled paid Agent run: review eligibility updates on the normal polling path.

## Code and checks

- `extension/robin/kanban.ts`: browser-safe view, review and capacity rules.
- `extension/robin/kanban-domain.ts`: current inputs, revision and proposal boundary.
- `extension/robin/todo-domain.ts`: all task writes and history.
- `app/api/robin/kanban/route.ts`: read capacity, generate, explicitly accept.
- `components/robin/KanbanPlanner.tsx`: preferences and proposal confirmation.
- `components/robin/KanbanTaskEditor.tsx` + `kanban-editor.ts`: draft lifecycle,
  minimal field patches and explicit conflict recovery.
- `npm test`; `tsc --noEmit`.
- `PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/kanban.mjs`
  against an existing dev server. Browser tests mock Robin APIs and never edit
  personal tasks; route tests use a temporary store and a stub model. Browser
  checks cover board/list density, 60-task backlogs, mobile column switching,
  drawer focus/retained failed edits, missing calendar data, Chinese/English,
  light/dark themes, narrow/landscape viewports, dirty-close protection, draft
  restoration, concurrent completion, URL history/search scope, cross-day ongoing
  work, and exclusive next-task ordering/cleanup.
