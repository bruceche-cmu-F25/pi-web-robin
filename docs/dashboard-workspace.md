# Robin's daily workspace

## Purpose

Robin is a personal daily workspace maintained with an agent's help, not a task
commander. Natural-language capture is one maintenance entrance. The user retains
direction; Robin may propose a plan when asked, but opening the dashboard neither
chooses today's work nor accepts a schedule. Calendar, tasks, saved links and
specialist workspaces are different views of the user's life, not inventories the
user must clear. The same record can appear in several places without being
maintained several times.

## Phone and desktop

The user-facing workspace name is **Home / 首页 / 首頁**, including navigation, desktop title, browser title and help copy. `/dashboard` URLs and internal names stay unchanged for compatibility.

Below the 960px split breakpoint `/dashboard` has four named destinations:
**Home / Calendar / Tasks / More**, in a bottom navigation bar (`view=daily` remains the stable URL). Its old hamburger
and five anchor shortcuts are not shown alongside that navigation. Other Robin
workspaces keep their existing navigation; More supplies their stable directory,
including tools and settings, preserving session/cwd links. Kanban's page, API and
specialized components have been removed; shared todos and saved work plans remain intact. **Chat stays
in the phone header**, not hidden in More; desktop uses the existing global
navigation link rather than repeating it beside search. The phone link uses the
same native document navigation as RobinMargin (Chat owns a different shell),
preserves session/cwd, and browser Back returns to the originating view. The phone header keeps Chat and read-only Search, with a quiet "Type to Robin" entrance below them for typing. Voice is a 56px center action in the bottom dock between Calendar and Tasks, not another top-bar button. It starts the existing continuous voice conversation directly on tap; typing opens Act without submitting. On this Dashboard, search and typing palettes have no mode switch or shared draft. Desktop's inline mode switch and other workspaces' command palette remain unchanged.

- **Chat reviews** sit above Home's calendar on phones, with a pending count on the header's Chat link. A visible phone dashboard polls `/api/sessions/reviews` every 2.5 seconds across its four tabs; returning from the background refreshes immediately. The first three replies show with chat title, project and completion time; a native disclosure reaches the rest. Links use `/?session=<id>` without a stale cwd and cross the native Chat document boundary. Tapping the entire row (including its solid green dot) acknowledges the displayed reply, then opens the chat; a failed save keeps the row and stays on Home. Swipe left to reveal **Noted** on the right to acknowledge without opening the chat. Neither action deletes the session. Errors keep the row; a newer reply cannot be cleared by an older acknowledgement. Loading/read errors are not presented as a zero count. The queue is a compact native-UI-font list: 16px heading, regular 15px titles, one-line project/time metadata, and an 8px solid green ready indicator inside the link, not an acceptance control. Each row uses native horizontal overflow with two scroll-snap stops (closed / Noted), closed at the native zero scroll position (link then trailing button, with no CSS reordering or initialization effect), including initially hidden panes/disclosures. Native touch scrolling preserves vertical pan, cancellation and click suppression; full swipes never submit. Tab moves from the link to the offscreen Noted button and native focus scrolling reveals it, providing a non-gesture path. The button has a full accessible name, at least a 44px target, saving text and a synchronous pending guard. There are no custom pointer handlers, springs, per-frame state, timers or dependencies. Guidance remains as the section's screen-reader description rather than a permanent explanation row. Glass themes reuse the calendar's CSS frost surface and thin bright edge; accessibility preferences restore an opaque bordered list. Desktop stays unchanged.
  Reviews start with newly completed normal Chat replies, not a backfill of old conversations or a claim that the work is correct. Successful visible final answers qualify; stopped/error/truncated/tool-only runs, scoped workspace agents and subagents do not. One latest reply per chat persists with the existing locked session UI state, shared across browsers and server restarts; duplicate completion cannot resurrect an accepted reply. Running chats are hidden until idle, deleted chats are omitted, and session deletion removes its review state. This is independent of the sidebar's per-browser unread dots.
- **Home** (`首页`, stable `view=daily`) defaults to today's date in its phone heading; only explicit Home date browsing (`dailyDate`) overrides it, with the weekday above it, not a literal Day/Today title plus a duplicate date. All four phone tab titles use the same regular-weight italic 24px serif type (`--font-serif`), including the date title; its `<time>` inherits this typography rather than the global metadata time style. Calendar, Tasks and More no longer use larger 32px/28px titles. Desktop is unchanged. Calendar keeps its date inside its own toolbar instead of repeating it above the page title; Tasks/More retain today's context. Home keeps an interactive calendar and deadlines on the same phone page—not just a link to another destination. It no longer repeats a visible Calendar/Open calendar title row: the bottom Calendar destination already supplies that navigation; a screen-reader heading still names the arrangement section. The seven-day strip is available through **Change date**, collapsed initially so the first deadline is visible alongside the main appointment. Its closed summary does not repeat Today below the page heading; only a non-today selection adds a date label. It uses its own `dailyDate` URL (invalid values fall back to the server's today), never Calendar's `date`; tapping Home clears `dailyDate` and returns to today. It can move between weeks or return to today, and marks days with recorded events. It uses the existing week/date/range/deduplication functions; changing dates does not write anything or move a deadline. All-day entries for the selected date have their own always-visible compact band, never hidden in Other entries. Timed entries feature an explicitly ongoing event first, then the next event, then an unknown-end entry. Missing ends never imply a duration or ongoing status; a started event without an end is labelled accordingly. Other dates retain calendar order. Home copy uses the native UI font (`--font-ui-default`): the featured time is regular 34px with tabular digits (no slashed monospace zero), the event title regular 18px/1.45; serif page/section headings remain. These rules are local to Home, not desktop/calendar-wide font changes. The clock updates every minute; if the device and server days disagree, timing claims are omitted. **Other entries** keeps the remaining records, including finished appointments, in a native disclosure (three previews plus a remaining-count link to the agenda). An empty day takes one line; it never implies free time.
  Below it, three unfinished deadlines through the next two days (including overdue tasks) have direct completion controls. The scope explicitly stays relative to **today**, not the selected calendar date. Writes are guarded synchronously **per task** and revision-checked; only confirmed responses remove a row. Each response retains its own receipt and Reopen using that saved revision, even when concurrent writes finish out of order. Only the submitting checkbox is disabled; its metadata slot shows Saving without changing row height. Failures leave the task and its error visible. Focus returns to the section if the initiating control lost focus, but a late response never steals it from another focused control or a different pane. Task titles still open the original record. Untracked mail/round attention comes before links from the user's exact `日常入口` group: six initially, with an explicit expansion for every later link, preserving saved order. Every section reaches its full collection. No times, task estimates or free-time claims are invented; missing/partial calendar reads never produce an empty-day assurance or fabricated zero counts.
- **Daily brief on Home** (`BriefBoard compact`) is a quiet, read-only paper note below the phone's existing schedule/deadlines/attention, and below the title on desktop. On desktop it spans the calendar-and-tasks grid width: one leading mail summary on the left, up to two shorter ones on the right, then a secondary coverage/link line. With zero or one highlight it stays single-column; below 960px it stays a single vertical list. It shares the workspace's surface color, thin edge and radius but has no card shadow or stacked inner cards. Only an edition dated today appears, and browsing a different Home date hides it rather than presenting today's mail as that day's. It links up to three reviewed, action-suggested mail summaries to their originals; failed reviews are a separate count, never urgent items. Calendar/tasks already visible on Home are not duplicated. Publisher highlights are a secondary count; the noisy edition headline is not repeated. Missing/uninitialized/error states do not create a placeholder or start generation. The link opens the exact immutable edition under Incoming (`feed=brief&edition=…`) with session/cwd preserved. The full reader is one opaque sheet: date/headline and personal/public articles precede coverage, notification, generation and delivery-receipt disclosures. Its form requires separate private-model consent and explicit stored/Gmail/live input choice; manual generation never creates tasks or sends notifications. Live refresh includes Google events and two fixed publisher feeds, while historical-only material says Background reading. The independently gated scheduler can send the same edition; receipts distinguish uncertainty/service acceptance/manual settlement from phone display. See [the operator and privacy rules](brief-pipeline.md). `e2e/unified-brief.mjs` uses synthetic sources only.
- **Calendar** on phones is the shared **06:00–21:00 hourly grid**, with Day and Week
  modes; entering the bottom tab opens Day. Legacy Month/Agenda URL and stored
  preferences normalize to Day, including on a desktop-to-phone resize. Desktop
  retains all four modes. Previous/Today/Next and the date/calendar picker handle
  navigation; there is no extra mobile week strip. Date-only tasks occupy one 60px
  summary opening the existing complete task dialog, never invented hourly slots;
  all-day scrolling is bounded to 150px so neither band hides the timeline.
  Phone typography and quiet controls follow the earlier serif/mono timeline styling,
  while current source colors, bounded tasks, edit safety and 44px targets remain.
  All-day entries stay above the hours. Week/month/agenda remain available; explicit
  URL and stored phone preference win. Desktop has its separate existing view
  preference. Local editing, Google/planner read-only boundaries and dragging
  remain unchanged. Dragging a task's date still edits its deadline, not a work
  appointment; this release does not silently redefine that gesture.
- **Tasks** has Due soon (next seven days and overdue), All open and Completed
  filters. Completed includes older records, not just today's completions. Phone
  titles open the record; the record contains the original external destination.
  Phone rows use the shortcut surface treatment without an enclosing card: normal-weight
  two-line titles, dates inside the title's single hit area, 44px circular check controls,
  and overflow actions. Long titles remain complete in the details dialog and accessible
  name. Titles/dates use regular native UI type, with a 20px one-pixel check ring inside
  its unchanged 44px target. The filters form a quiet rounded segmented control and
  Add is a text action; the duplicate panel title is screen-reader-only.
  In Glass, overdue rows use the semantic `--danger-soft` tint over clear glass,
  not a red side edge or repeated red date ink. All phone task rows (including Home)
  have a visible glass edge with an inset highlight and thin neutral outer outline,
  rather than a heavy drop shadow. The explicit overdue/date wording
  remains. Normal rows stay neutral; explicit non-overdue task colors keep their edge.
  Only overdue rows use the tiny clear blur (no SVG filters); open overflow menus
  raise their row above sibling surfaces. Home's deadline preview uses the same
  separate tinted rows instead of another enclosing frost card. High contrast,
  reduced transparency and forced colors restore solid bordered surfaces, remove
  tint/blur and retain the warning text.
  The 641–959px range must retain these mobile controls, despite Tailwind's separate
  `desktop:` breakpoint. Desktop presentation stays unchanged.
  Checkbox completion and manual creation remain available. TodoPanel applies the
  server's write receipt before revalidating: completion/reopen, color/link edits,
  creation and deletion remain visible even if the following GET fails. The shared
  resource invalidates reads started before that receipt. List writes for the same
  Todo are serialized through acknowledgement (failed writes do not block later
  edits); different Todos remain independent. This is per-mount ordering, not
  cross-tab conflict resolution or a new shared client store.
- **More** contains a stable workspace directory (`DashboardDirectory`), grouped
  as Inbox & work, Learning & knowledge, Ideas & tools, then Preferences. Each
  destination has a distinct line icon, name, one-line description and navigation
  chevron. Group tones supplement text, not replace it. Separate opaque grouped
  lists replace the enclosing More card; the desktop directory is still absent,
  but the desktop Home heading has a visible Toolbox link.
  Below it, **Expand to work here** distinguishes inline tools/previews from
  navigation: disclosures describe their contents, and course/job previews are
  named differently from the full workspaces. More retains a compact entry to the existing
  weekly planner (saved slots can still be expanded to log/release work), and remembered disclosures for the daily queue, links, learning
  and jobs. Planning is opt-in: the Daily link opens the existing planner, but
  preview/acceptance and note extraction still require their own explicit actions.
  The five-minute work queue is optional, not the default experience.
  Phone Chat's top strip exposes Home, Chat, Notes, Learning, Incoming, Jobs and
  Research in one native horizontally scrolling row. More still opens this same
  directory for the other destinations, preserving session/cwd. Badges live on
  each shortcut instead of being duplicated on More; keyboard focus reveals
  offscreen links and all targets remain at least 44px.
  Its Settings destination uses a native document navigation (as global navigation
  does), so Back cannot bypass Settings' unsaved-credential guard.

Desktop keeps calendar and tasks side by side, with a bounded sticky task rail.
Both reading planes use the same `--border` outline and `--card-radius`, including
Glass (frost remains, but its pale material edge no longer replaces the rail's
outline). Open task titles use semibold (600) neutral `--text`, with quieter dates
and controls; completed titles return to normal weight. Explicit task colors
appear on the thin left edge and in the color control. Overdue rows keep their
warning edge/date ink instead of letting a custom color conceal that status.
Planning opens its workspace on request, but saved slots (when present), the two learning tracks and up to five matching jobs are readable directly on desktop Home without opening an accordion. Other saved links follow in the same lower reading sheet; everyday shortcuts stay in the rail. Desktop uses three top-level paper surfaces (calendar, tasks rail, lower reading sheet) with shared background, edge, radius and shadow; inner sections use dividers, not stacked cards. The optional work queue still opens on demand, rather than making a plan just by visiting Home. Daily
links now lead the rail: six shortcuts in saved order, a compact responsive grid,
Show more/less and secondary actions in the existing menu. They no longer sit
behind the task backlog. Desktop tasks default to overdue/next-seven-day deadlines;
explicit `tasks=near|all|done` wins and the phone default remains All open. A confirmed
new undated/later task switches to All open so the saved record stays visible.
Lower disclosures retain a one-line purpose summary and use chevrons, not add signs;
these descriptions do not fetch hidden previews or imply live counts. Both layouts
use the same task/calendar records and existing domain APIs. There is no new business
store or migration.

## Read recovery

`usePolledResource` bounds each read, including its response body, at 30 seconds.
Timeout releases loading, retains the last successful data and reports a localized
retry message. Sequence and abort checks fence late answers, including transports
that ignore abort; unmount/replacement clears the deadline. Polling remains read-only;
no timeout automatically repeats a mutation. `usePolledResource.test.mjs` and
`e2e/ui-recovery.mjs` cover late bodies, failed-vs-empty states and manual recovery.

## Saved-link edits

`LinksPanel` keeps explicit title/URL edits open on write failure. A synchronous
submission guard prevents duplicate writes; fields and conflicting actions lock
only while the write is unconfirmed. Success adopts the server's link receipt
before revalidation, then closes the editor. Creation/deletion also update the
local collection from confirmed results; a failed refresh must not undo them.
A slow follow-up GET does not keep the controls locked. Link read errors have an explicit read-only retry and never display the empty-collection message alongside a failure. Errors use `role="alert"`;
IME confirmation does not submit the editor. Group reorder retains its existing
server contract and refresh behavior.

Checks: `components/robin/LinksPanel.receipts.test.mjs` covers retry, duplicate
submission, normalized receipts, stale/failed reads and creation/deletion through
the actual resource module. `e2e/frontend-reliability.mjs` checks the rendered
editor's failure/retry and offline receipt behavior with synthetic data.

## Mobile app links

`SavedLinkLaunch` is shared by Today and the full saved-link collection; it does
not change stored HTTP(S) URLs, link order, groups or the API. Desktop retains
ordinary new-tab links. Below the dashboard split breakpoint, ordinary HTTPS
links use native same-tab navigation so Universal/App Links can be handled by the
OS. This does not guarantee that a site has an associated app or that the user's
browser preference allows handoff.

`saved-link-launch.ts` has a small explicit iOS URI allow-list. OS detection is
limited to choosing platform-specific handlers (including iPadOS's Mac identity),
never layout, styling, an installed-app claim or a device fingerprint sent anywhere.
Only a deliberate tap follows a URI; no hidden iframe, launch probe, timer,
automatic App Store redirect or background attempt is used.

- Gmail inbox/home shortcuts → `googlegmail://`; Google Calendar home →
  `googlecalendar://`; Google Docs home → `googledocs://`. These say **App home**:
  they do not promise the same account, mailbox or date as the web URL.
- Notion `.so` page URLs retain their full path/query/fragment under `notion://`.
  Google document URLs retain the original HTTPS link after `googledocs://`.
  These say **Open in app**; specific Gmail messages/calendar events are never
  reduced to an unrelated app home.
- Shortcut rows have no permanent Web button or repeated “App or website”
  subtitle. The full collection's **⋯ → Open original link** keeps the unmodified
  saved URL available as a secondary action across phone widths. App-home/page
  hints remain on supported handlers; installing the app and its account choice
  are still outside this page's control.
- Unknown sites, Android and other platforms retain the exact HTTPS link and let
  the OS/site handle it. No guessed schemes for GitHub, Claude, ChatGPT,
  NotebookLM or the printing portal. Open original link opens a normal new tab; the
  browser still owns its ultimate universal-link behavior.

Sources checked for the URI mappings:
[Notion page handoff](https://kevinjalbert.com/using-ios-shortcuts-to-open-notion-pages/),
[Google document handoff](https://mirekdlugosz.com/blog/2023/ios-opening-google-drive-links-directly-in-an-app/),
[Google app-home schemes](https://gist.github.com/bartleby/6588aa4782dfb3f1d50c23ce9a4554e3).
These are community-documented handlers, not stable vendor API guarantees.
[Apple's Universal Links guide](https://developer.apple.com/library/archive/documentation/General/Conceptual/AppSearch/UniversalLinks.html)
explains the OS-controlled fallback. Test real app versions on an iPhone before
calling handoff verified; Chromium with an iPhone UA checks URL selection only.

## Navigation and recovery

`view=daily|calendar|todos|more` owns phone navigation independently of `calendar`.
`tasks=near|all|done` owns the task filter. Missing view defaults to Daily, except
old `?calendar=…` and known dashboard anchors, which still reach their surfaces.
`todo=<id>` and `event=<id>&date=…` are record links; missing records show an honest
unavailable state. A record never opens a different item by title guessing.

Browser Back/Forward and per-view scroll use the existing `useBoardNavigation`
session-storage mechanism. The same filter retains its position on tab switches.
Disclosures remember explicit choices locally. A link naming a collapsed section
opens it. Mounted panes retain forms while switching destinations; hidden panes
pause polling via `ResourceActivity`, including refresh-bus subscriptions. This is
not cross-device layout synchronization. Existing global navigation badge reads
remain independent of pane activity.

The task record dialog reuses the existing `calendar-event-dialog` surface (bottom sheet on narrow phones, centered on wider screens), rather than relying on reset browser defaults. Its header remains visible above a bounded, internally scrolling form; Close and Save stay reachable in short landscape.

Task record edits submit the original revision. Failure/conflict retains the
fields and displays the error, never silently overwrites a newer record. Confirmed
writes update the original task and refresh other views. Closing a dirty editor
via its controls/Escape requires confirmation. These form drafts are in-memory,
not crash recovery or an offline queue. Dates remain date-only deadlines and
optional date ranges; the detail form does not change planned work dates.

## Capture and search

The phone header contains only Chat, Search and continuous Voice. The redundant
quick-add + is removed so the three remaining controls have 4px gaps and retain
44px touch targets. The bottom dock still contains only the four destinations.
Manual creation remains in the Tasks/Calendar headers; no new creation workflow
or store is introduced. `DashboardQuickAdd` is no longer mounted by the header.
`e2e/companion-voice.mjs` checks the three-control row at 320/390/430px. Phone task creation initially shows title and Save; dates
and link expand on demand and keep their values on tab switches. An explicit
`add=todo` reveals/focuses the retained form. Desktop still exposes all fields.
Agenda/month creation starts untimed; day/week grid creation retains its explicit
time preset. Tell Robin uses the shared command dialog in explicit execute mode;
search remains read-only. The dialog keeps its draft/result while closed during
this mount. Hiding it releases voice controls and polling, but does not cancel or
replay a submitted assistant turn. No assistant persona/realtime voice work is
included in this change.

Search now includes tasks, links, and calendar entries from **30 days before to
90 days after** the device's local day. That coverage is displayed, not described
as unlimited global search. Calendar failure leaves task/link search usable and
shows a partial-results warning. Unchanged query keystrokes filter the already
loaded collections; no model is invoked. Archived tasks are excluded. Task/event
results navigate to their records in Robin; saved links still open externally and
task results offer a separate external destination. Exact saved-link shortcuts
keep their existing Enter behavior. The shared search/execute switch uses icon-and-label
buttons over one neutral sliding selection surface on desktop; phones retain the
native selector. Pointer switches move only the thumb's transform for 220ms with
a strong ease-out, retargeting from the visible position on interruption. Keyboard
and reduced-motion switches are immediate; neither changes layout or blocks input.
Both modes omit the redundant submit button. Search filters while typing; Enter
opens an exact shortcut or focuses results. Execute shows a quiet Return hint and
uses Enter (the phone keyboard requests Send); IME confirmation never submits.
Switching modes preserves the draft and never submits it. `e2e/search-surfaces.mjs`
checks intermediate motion, reversal, keyboard/reduced motion, 44px targets and
light/dark/Glass palettes; `e2e/assistant-act.mjs` checks Enter, pending/uncertain
request duplicate prevention and reply recovery with mocked APIs.

## Visual treatment

Today has no giant enclosing card. A quiet canvas supports two sibling grouped surfaces: the interactive calendar and actionable deadlines, then compact shortcut tiles and a quiet planning link. `DailyOverview.module.css` owns this phone homepage independently of the shell and desktop. Phone typography now follows desktop rather than imposing a separate Apple/system-font skin: serif italic page/section headings (`--font-serif` / `.pi-section-title`), mono body and times (`--font-mono`), and the existing UI face for calendar content/controls. All Today weights, including the selected dock item, are 400; hierarchy comes from size and spacing. The date precedes a 32px title. A 36px primary time, 20px event title, 15px task titles and quieter metadata establish hierarchy; pixel floors paired with rem scaling keep this repository's smaller root font from shrinking mobile body copy. Spacing scales with text. The existing engineering grid remains but a phone-only 45% canvas tint reduces its competition with content.

No filters are nested: only the calendar and task groups get CSS frost; shortcuts get a clear fill, a thin rim and the site's actual icon. `SavedLinkIcon` is shared with desktop saved links: per-link cached favicons first, then existing committed site-logo resources, then a neutral globe if neither is available. No letter tiles or guessed brands; browser image requests remain same-origin. Legacy links without an attempted lookup use the existing icon endpoint serially, once per address per mount; hidden panes pause new lookups, and a failed site does not retry forever or block the rest. Secondary actions have 44px targets. The seven date targets remain at least 44px, with native horizontal overflow on very narrow/large-type layouts rather than shrinking targets; the page itself never overflows. Native buttons/checkboxes supply semantics and press feedback without extra animation. Previews retain two title lines and record links expose full text. More and the desktop comparison layout retain their existing behavior.

Daily uses the existing adaptive `--todo-*` palette for small destination accents:
slate blue for arrangements, warm clay for tasks, teal for links, iris for planning.
Section actions and shortcut letter markers carry the accent; the calendar has a restrained slate tint over its material, never an opaque colored card. Only the selected bottom destination gets a matching tint. These
colors describe sections, not urgency or calendar event series; overdue/error
colors and text labels remain unchanged. There are no per-link guessed categories.

The compact header toolbar and single-row inset dock reuse the existing Glass /
Dark glass materials (`app/glass-theme.css` and `lib/liquid-glass.ts`): **clear header
and dock**, thin rim and real backdrop refraction on supported Chromium. Today's
separate calendar/task groups and the desktop task rail instead use **CSS frost**
(48% theme tint + 10px backdrop blur). Buttons retain distinct fills and text stays
sharp. No per-row/nested blur, large reading-plane refraction maps, new dependencies
or forced theme changes; ordinary themes remain opaque. Safari/Firefox keep CSS
blur. On phones in Glass themes, the scrollport spans the entire workspace, behind
the header and dock. `Dashboard` observes both chrome **border boxes** (content-box
observation misses safe-area padding changes), writing their actual heights to
local CSS properties. Initial/end padding and scroll-padding reserve those heights
so first/last controls and keyboard-focused records remain reachable. The keyboard
hides the dock and its measured reservation becomes zero. Ordinary themes and
desktop keep their existing flow layout; no scroll events or per-frame React state.

The scrollport cannot carry a mask (a backdrop root). Separate non-hit-testing
header/footer pseudo-elements soften the passage behind chrome with 48px alpha
ramps extending 32px into the reading region, rather than hiding a hard scrollport
cut. Calendar drag previews and edge scrolling honor the visible header/dock bounds.
High contrast, reduced transparency and forced colors restore solid chrome/planes
and remove refraction and edge effects. The header alone owns the top safe area,
the dock the bottom; `.robin-page` resets vertical padding to avoid double insets.
Horizontal protection remains.

## Checks

```sh
node_modules/.bin/tsc --noEmit
node --experimental-strip-types --test components/robin/dashboard-view.test.mjs extension/robin/search.test.mjs components/robin/usePolledResource.test.mjs components/robin/calendar-view.test.mjs lib/i18n/registry.test.mjs
node --env-file-if-exists=.env.local --experimental-strip-types e2e/dashboard-workspace.mjs
node --env-file-if-exists=.env.local --experimental-strip-types e2e/dashboard-materials.mjs
node --env-file-if-exists=.env.local --experimental-strip-types e2e/dashboard-today.mjs
node --experimental-strip-types --test components/robin/TodoPanel.receipts.test.mjs components/robin/saved-link-launch.test.mjs
node --env-file-if-exists=.env.local --experimental-strip-types e2e/dashboard-mobile-entrypoints.mjs
node --env-file-if-exists=.env.local --experimental-strip-types e2e/dashboard-phone-tabs.mjs
node --env-file-if-exists=.env.local --experimental-strip-types e2e/todo-receipts.mjs
```

The Todo receipt checks use the real polling/mutation module with controlled
transport, including stale GETs, rejected writes, same-record ordering and failed
revalidation. The fixture-only browser check covers pending/rejected completion,
confirmed completion/reopen/delete/create with failed reads at 390px and 1440px.

The browser suite mocks all business/assistant APIs. It covers four destinations,
opt-in planning, no search writes, record links, calendar partial failure, failed
save drafts, confirmation, old completed tasks, URL/Back/Forward/scroll, capture
drafts, long titles, dark/light and 320/390/812/1440px layouts. Screenshots are in
`/tmp/robin-dashboard-workspace` by default. The previous single-long-dashboard
mobile expectations are superseded by this navigation contract. The materials suite
checks actual Chat navigation/Back, cwd/session links, all four palettes, 320–1440px
including short landscape, 0–62px safe-area overrides, button fill separation and
text contrast ≥4.5:1, translucent controls, full-height scrollport overlap,
mid-scroll screenshots, last-action clearance, keyboard reservation updates,
material roles/refraction and high-contrast fallback;
its screenshots use realistic fixture content in `/tmp/robin-dashboard-materials`.
`dashboard-today.mjs` adds the collapsed same-page date strip/URL history, clock-controlled ongoing/next previews, first-deadline clearance above the dock, direct completion and reopen with revisions, independent simultaneous writes/out-of-order receipts, focus preservation, failed writes, long titles/large text, four palettes and honest empty/partial reads. `dashboard-workspace.mjs` also checks the quick-add sheet, cancellation/focus return, both manual form routes, optional fields/drafts, assistant capture and bounded sheet geometry at phone/landscape sizes. Its screenshots live in `/tmp/robin-dashboard-today`. Browser viewport checks do not certify iPhone keyboard, safe-area or touch feel; verify on hardware.
