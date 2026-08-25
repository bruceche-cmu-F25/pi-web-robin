# Robin — a personal dashboard for pi-web

[中文文档](./README.zh-CN.md)

Todos, a calendar, and saved links, all driven by pi. Everything lives in plain
JSON files under `~/.pi/robin`, and the agent that touches them is restricted to
a fixed allow-list — no shell, no filesystem.

- **Dashboard** at `/dashboard` — assistant box, calendar (agenda / week / month), todos, links.
- **Agent tools** usable from the dashboard, the `pi` CLI, and Telegram.
- **Google Calendar** read-only, merged into the calendar views.
- **Gmail** read-only: `/dashboard/gmail` shows the inbox, and a daily email digest goes to Telegram.
- **Learning Hub** at `/learn` — the front door: a way into each track, where you
  already are in it, and the study links. Nothing else.
- **Coding workspace** at `/coding` — two tracks. **Problems** embeds the NeetCode
  roadmap next to a coach that hints instead of answering; **Curriculum** opens a
  syllabus that runs from JavaScript to system design next to a mentor that
  explains and ties every answer back to what the module is for. Both keep your
  own record.
- **Telegram bridge** so the same assistant works when you are away from the machine —
  commands, inline buttons, voice notes, and four kinds of push.

---

## Setup

### 1. The extension

pi loads extensions from `~/.pi/agent/extensions`. Symlink this directory there:

```bash
ln -sfn "$PWD/extension/robin" ~/.pi/agent/extensions/robin
```

No build step — jiti imports the TypeScript directly.

> **Editing anything under `extension/robin` requires restarting pi-web** (or the
> `pi` CLI). Extensions are loaded and cached when a session starts, so a running
> session keeps the old tool definitions. React components under
> `components/robin` hot-reload normally.

### 2. Run pi-web

```bash
npm run dev
```

Then open <http://localhost:30141/dashboard>, or use the grid icon in the sidebar
header, next to **+ New**.

> Do **not** run `npm run build` during development — see AGENTS.md; it pollutes
> `.next/` and breaks `npm run dev`.

### 3. Credentials (optional)

Google and Telegram are configured at **/dashboard/settings**, not in `.env.local`.
Values are stored in `~/.pi/robin/secrets.json` with mode `0600` and are read per
request, so a change takes effect without restarting the server. An environment
variable of the same name still works as a fallback, and the settings page says
when a value is coming from one.

The page never displays a stored secret — only whether it is set and its last four
characters. The server does not send secrets back to the browser.

---

## What the agent can do

The tool allow-list is in `tools.ts`; registrations are split by domain in
`*-tools.ts` modules and composed by `index.ts`:

| Tool | Say something like |
| --- | --- |
| `todo_add` | "remember to pay rent tomorrow" |
| `todo_update` | "move the rent todo to Friday" |
| `todo_delete` | "delete the rent todo" |
| `todo_complete` | "I finished washing the car" |
| `todo_list` | "what's left to do?" |
| `calendar_create_event` | "design review Thursday 3–4pm in room B" |
| `calendar_list_events` | "what's on today?" |
| `link_add` | paste a bare URL |
| `link_list` | "what did I save?" |
| `gmail_list` | "any important email today?" |
| `gmail_get` | "read me that interview email" |
| `gmail_review` | used by the mail-review turn to persist categories |
| `provider_usage` | "how much OpenAI and Anthropic quota is left?" |
| `job_profile` | read the CV and scoring rubric before scoring jobs |
| `job_pending` | list unscored jobs |
| `job_score` | score one discovered job |
| `job_list` | "show my best job leads" |
| `job_status` | shortlist, apply, or drop a job |
| `job_scan` | scan configured job boards |
| `practice_current` | "how should I start this one?" |
| `practice_list` | "what's left in Two Pointers?" |
| `practice_record` | "I solved it, took about 20 minutes" |
| `practice_status` | "mark Valid Anagram as done" |
| `practice_note` | "remember: sort, then compare" |
| `practice_due` | "what should I review today?" |
| `study_current` | "what is this page for?" |
| `study_outline` | "how does the architecture track fit together?" |

Details worth knowing:

- **A date range is one event.** "19th to the 22nd in Chicago" becomes a single
  event with `endDate`, not four separate ones.
- **Pasted links get their real title.** `link_add` fetches the page `<title>`
  rather than guessing from the URL, and the tool result says which happened.
- **`calendar_list_events` includes Google events**, matching what the dashboard
  shows. They are marked read-only.
- **Relative dates resolve against your local date**, which the list tools state
  explicitly in their output.
- **Subscription usage comes directly from the providers.** `provider_usage`
  resolves the OpenAI Codex and Anthropic OAuth logins already managed by Pi,
  returns only percentages and reset times, and never exposes the tokens. These
  provider-specific usage endpoints are not a stable standard and may change.

### What it deliberately cannot do

- **No shell, no filesystem.** The assistant session activates only the
  allow-list; pi's `bash`, `read`, `write`, and `edit` stay inactive. This
  is a tool-registration boundary, not a prompt instruction.
- **No writing to Google.** The integration is read-only: it can show your Google
  events but cannot create, change, or delete them.
- **No deleting.** There are no delete tools. Removing a todo, event, or link is a
  click on the dashboard. Remote deletion is a risk that buys little.

---

## The dashboard

**Assistant box** — type a sentence, the agent acts, and the panels refresh
immediately. The line under the reply ("added a todo") comes from tool calls that
actually executed, not from the model's prose.

**Calendar** — three views, remembered per browser:

- **Agenda** — the next three days in full, then one line per remaining day.
- **Week** — a time grid with an all-day band on top. Overlapping events share the
  day's width. The grid is sized to its content (07:00–22:00 by default, widening
  to cover every event) so it never traps the page's scroll.
- **Month** — a rolling four-week window starting from the current week, not a
  calendar month. Multi-day events draw as one continuous bar across the row.

**Todos** — grouped Overdue / Today / Tomorrow / Later / Someday. Items completed
on the current local day remain visible at the bottom; older completions are hidden.

**Links** — grouped, opened with `rel="noopener noreferrer"`.

The UI follows the language selected in pi-web's top bar, including date
formatting.

---

## The coding workspace

`/learn` is the way in — two entries, the shelf of study links, and the place a
third entry would go. Only the practice entry carries a number, because it is
the only side that keeps one. Each entry lands on a track
directly (`/coding?track=curriculum`), which also becomes the remembered
default.

**The shelf is the same resources, arranged the other way.** The syllabus
orders them for teaching: what has to be understood before what. The shelf
keeps the groups the reading list was collected in, which is how you find
something again when you already know what you are looking for. It holds item
ids rather than URLs, so the two can never disagree about where a link points.
The dashboard's saved links are a different shelf for a different part of the
day and stay where they are.

`/coding` is two tracks. **Problems** is three panes — the roadmap rail,
NeetCode itself in a frame, and the coach. **Curriculum** is two — the syllabus
and the mentor — because there is nothing worth framing: two thirds of the
catalog is either a milestone or a site that refuses to be embedded, and a
tutorial reads better in a real tab than in a letterbox. Its resources open in
one. Which track you are on is a browser preference; what is open in each is
server state, because the agents read it.

**What the user is looking at is a black box.** A cross-origin frame reports
nothing back — not its URL, not what you solved — and a tab we opened reports
even less. So clicking is not decoration: it is what tells the server which
problem or resource is open, and that record is the only reason the agent on
the right can answer a question about "this one". The frame is
NeetCode's own problem page, editor and judge included, so you can solve it
without leaving the page.

**The catalog is local.** `neetcode-catalog.ts` is generated from
[neetcode-gh/leetcode](https://github.com/neetcode-gh/leetcode)'s
`.problemSiteData.json` (MIT), plus NeetCode's own per-problem slugs read from
the site bundle at generation time — all 150 of NeetCode 150 have one, so every
problem on the default list can be framed. Problems without one link out to
LeetCode, which refuses to be embedded. Regenerate with:

```bash
node scripts/refresh-neetcode-catalog.mjs
```

Nothing is fetched from NeetCode at runtime, so the rail, your records, and the
review queue keep working whether or not the frame loads.

**The coach hints, it does not answer.** It runs in its own session with its own
six tools and has no way to fetch a solution — no shell, no filesystem, nothing
that returns an implementation. It climbs a hint ladder (ask what you tried →
name the pattern → give the invariant → sketch the algorithm → write code only
if you ask) and records how far up it went, because a solve that needed four
hints should come back sooner than one that needed none.

**Records** live in `~/.pi/robin/practice.json`. Each problem has a status, its
attempts, a note, and a review date derived from your confidence (1/3/7/21/60
days). You can set status and notes by hand in the panel; the coach writes the
same records through its tools.

---

### The curriculum track

The second track swaps the roadmap for a syllabus and the coach for a mentor,
and drops the middle pane: the syllabus is the page, and every resource on it
opens in a tab. Same habits, one column fewer.

**It is a curriculum, not a bookmark folder.** `curriculum.ts` is hand-written
rather than generated, because the ordering is the content: six tracks —
language foundations, the web end to end, Python engineering, architecture and
system design, a project gym, and craft — each module stating the capability it
is for and ending in a milestone you have to build.

**Nothing on this side is tracked.** No status, no counts, no review queue, and
no tool that could write one — the mentor cannot mark a chapter read because
there is nowhere to write it. The practice side counts because a review
schedule is only as good as its record of what you solved; reading does not
work that way, and a progress bar over someone's reading measures the one
thing that does not matter. The roadmap says what exists and what each module
is for; what you took from it is yours.

**Every entry is a way out.** Clicking one opens it in a tab, so the catalog no
longer records which hosts permit framing — that stopped mattering when the
frame went.

**The mentor explains, where the coach withholds.** They are opposite jobs —
a problem someone else solves teaches nothing, but a concept nobody explains
stays a word — so they run in separate sessions with separate tools. The mentor
anchors answers to the module's outcome, reaches for the system-level framing
whenever it is honest to, and cannot mark anything done that you did not say
you finished.

**Storage** is one file, `~/.pi/robin/study-state.json`, holding two ids: the
resource opened last and the track the syllabus is showing. The first exists
for a mechanical reason — the tab it opened in is not ours to see into, so the
mentor could not otherwise answer a question about "this page".

### Panes

Every seam resizes: drag it, double-click it to put it back, or focus it and
use the arrow keys. Widths are per browser and shared by both tracks — one
workspace, one layout — so the agent panel you widened while reading is that
wide when you go back to solving. The pane between the seams keeps a floor of
320px no matter what the sides ask for, because on the problems track it holds
a whole third-party application and a 90px editor is not a smaller version of
the feature.

Dragging works across the frame because the seam captures the pointer. Without
that, a plain move listener stops hearing events the instant the cursor enters
a cross-origin iframe, and the divider sticks halfway.

---

## Google (read-only: Calendar + Gmail)

The OAuth client must be your own; a shared client secret cannot ship in an open
repository. Calendar and Gmail share one OAuth grant, so a single refresh token
covers both read-only scopes.

1. In the [Google Cloud console](https://console.cloud.google.com/), create or
   pick a project.
2. Enable the **Google Calendar API** and the **Gmail API**.
3. Configure the OAuth consent screen as **External** and add your own account
   under **Test users**.
4. Create credentials → **OAuth client ID** → **Web application**.
5. Add the **Authorized redirect URI** exactly as shown on the settings page —
   for the default port, `http://localhost:30141/api/robin/google/callback`.
6. Paste the client ID and secret into **/dashboard/settings**, then press
   **Connect** under the calendar.

> While the app stays in "Testing", Google expires refresh tokens after **7 days**,
> so you will reconnect weekly until you publish it.
>
> If you connected Google before Gmail was added, **Clear** and connect again so
> Google re-issues a token that includes the Gmail scope — the old token is
> calendar-only and Gmail will answer 403.

Pulled events and messages are never written to the local JSON — they are
fetched per request, so disconnecting removes them immediately.

### Gmail (read-only)

- **Page** `/dashboard/gmail`: not a message list but a categorised answer to
  "what came in today and what needs me". **Check today** runs the mail-review
  turn: the agent reads today's mail, files it into buckets (important / interview
  / OA / appointment / delivery / deadline / document / other), and creates a
  calendar event for appointments, meetings, and confirmed schedules, and a todo
  for deadlines. A row opens the thread in Gmail. There is deliberately no reply,
  delete, or archive.
- **Agent tools** `gmail_list` / `gmail_get` / `gmail_review`: read mail,
  categorise it, and persist the review. Mail is untrusted third-party data, so
  the tool prompts tell the model to extract facts only and never follow
  instructions found inside a message.
- **Email digest** (Settings → Telegram): once a day, the same mail-review turn —
  read, categorise, auto-create todos/events, then push the report to Telegram.
  Send time, language, chat ids, and the Gmail query are all configurable.

---

## Telegram

A standalone process, deliberately not a pi extension: extensions load per
session, so every `pi -p` run and every pi-web session would start its own
poller, and concurrent pollers on one token steal each other's messages.

1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and copy the
   token.
2. Paste it into **/dashboard/settings** → Telegram.
3. Add your chat id to the allow-list. Press **Detect chat id** after messaging
   your bot — or start the bridge with an empty allow-list, which puts it in
   discovery mode: it reports the ids it sees and acts on nothing.
4. Run it:

```bash
npm run telegram
```

**The allow-list is the only gate.** Bot usernames are searchable, so anyone can
find your bot; a message from an unlisted chat produces no agent call and no
reply at all — silence rather than an error, which would confirm the bot exists.
A button press is authorized through the same gate.

### What you can send

- **A sentence** — the full tool set, in the conversational session.
- **A photo** — read by the model, with the caption as the prompt.
- **A voice note** — transcribed, echoed back so you can see what it heard, then
  acted on. Off until you set a key under **Settings → Telegram → Voice notes**;
  it is billed per minute of audio and so is opt-in rather than assumed.
- **A command** — answered without the model wherever the answer is already in
  the store:

  | Command | What it does | Model turn |
  | --- | --- | --- |
  | `/today` | today's calendar and open todos, each with a **done** button | no |
  | `/jobs` | the best job leads waiting, with triage buttons | no |
  | `/mail` | read and file today's email | yes |
  | `/usage` | OpenAI and Anthropic quota windows | yes |
  | `/status` | bridge uptime, and whether pi-web is reachable | no |
  | `/reset` | start a fresh conversation, forgetting the current context | no |
  | `/help` | the list above | no |

  `/today` used to be a two-minute agent turn to answer a question two GETs
  away. Anything that is not a recognised command falls through to the model, so
  a sentence that happens to start with a slash still works.

### Buttons

The job digest, `/jobs` and `/today` carry inline buttons — shortlist / applied /
drop for a job, done for a todo. A press never reaches the model: the payload is
one the bridge wrote, so acting on it is a lookup and a `PATCH`, not an
interpretation. `parseCallback` accepts exactly the payloads the buttons produce
and refuses everything else.

A pressed button is removed from the message; a link button next to it stays,
because the moment you mark something applied is exactly when you might want to
open it. The keyboard is remembered in memory only — after a restart a stale
button still works, because every action behind one is idempotent.

### Pushes

All four are configured under **Settings → Telegram**, and all four record
delivery per chat, so restarting the bridge or retrying a partial broadcast does
not send duplicates.

- **Daily briefing** — today's agenda and open todos at a set time, with a
  **done** button per todo.
- **Email digest** — the agent reads recent mail, files it, creates the todos and
  events it finds, and reports. When Google is not connected the day is skipped
  rather than retried hourly.
- **Job digest** — twice a day: scan, score the backlog, push the best of it with
  numbered triage buttons. A nightly sweep walks the whole ATS directory.
- **Event reminders** — a nudge a configurable number of minutes before something
  starts, Google events included. Not tied to a time of day: it rides the poll
  cycle, which comes round every thirty seconds. Strictly forward-looking, so
  restarting at ten in the morning does not replay the morning.

### Properties worth knowing

- **Long polling, never webhooks.** Nothing listens on a public port; no
  certificate or tunnel is involved.
- The bridge talks to pi-web over HTTP and reuses `/api/robin/assistant`, so it
  inherits the same tool boundary rather than defining a second one.
- Replies follow the sender's Telegram client language.
- **Markdown is rendered.** The model writes Markdown and Telegram renders a
  small HTML subset; `format.ts` converts between them and chunks the result so
  a code block never straddles a message boundary. A message Telegram refuses to
  parse is re-sent as plain text rather than dropped.
- **A turn shows a typing indicator**, refreshed every four seconds, because a
  two-minute turn with no feedback is indistinguishable from a dead bot.
- **Settings are re-read every poll cycle.** Changing a send time or the
  allow-list on the dashboard takes effect within the poll window. The one
  exception is the bot token: it is the address the bridge long-polls on, so
  changing it still needs a restart.
- **Polling and scheduling run side by side.** A job digest that scans, scores,
  and waits for the scorer can take twenty minutes; it no longer holds the
  poller shut while it does.
- **Rate limited per chat** — a token bucket, five in a burst and twelve a
  minute. The allow-list keeps strangers out, so this is a cost ceiling rather
  than a security control.
- **pi-web must be running.** The bridge is its client; if pi-web is down, every
  message answers with an error. `/status` reports both.

### Keeping it running

A bridge that dies takes every reminder, digest and reply with it, and says
nothing about having done so. On macOS:

```bash
scripts/telegram/launchd/install.sh
```

That installs a `KeepAlive` launchd **user agent** — not a daemon: it runs as
you, needs your home directory, and has no business starting before you log in.
Logs land in `~/.pi/robin/logs/`. Pass `--with-pi-web` to supervise pi-web too
(via the published CLI, not `npm run dev` — a supervised service should not be a
dev server), and `--uninstall` to remove both.

---

## Data

Everything is in `~/.pi/robin` (override with `ROBIN_DATA_DIR`):

| File | Contents |
| --- | --- |
| `todos.json` | todo list |
| `events.json` | locally created calendar events |
| `links.json` | saved links |
| `assistant.json` | pi session ids for the interactive and read-only briefing assistants |
| `telegram-state.json` | successful daily-briefing deliveries for the current date |
| `secrets.json` | Google, Telegram and transcription credentials plus Telegram settings — **mode 0600** |
| `google.json` | Google refresh token — **a long-lived credential, mode 0600** |
| `gmail-digest-state.json` | which chats got the email digest on which day |
| `mail-review.json` | today's categorised email review |
| `reminder-state.json` | which events have already been reminded about |

The first five are plain JSON on purpose: `grep` them, put them in git, back them
up like any other file.

`secrets.json` and `google.json` are the exception — they hold standing
credentials for your calendar and your messaging account. Keep them out of any
repository or sync folder you would not put a password in.

---

## Working on Robin

### Module boundary

Client components may import only from the pure modules. A `node:fs` import
anywhere in an imported module's graph breaks the browser bundle — Turbopack
fails the build rather than warning.

| Module | Client-safe | Contains |
| --- | --- | --- |
| `dates.ts` | yes | local calendar dates, week/month grid maths |
| `events.ts` | yes | event model, ordering, grouping |
| `layout.ts` | yes | overlap columns, multi-day bar lanes |
| `links.ts` | yes | link model, URL normalisation, grouping |
| `tools.ts` | yes | the assistant's tool allow-list |
| `*-tools.ts` | **no** | server-only tool registration modules |
| `toolkit.ts` | **no** | shared tool-result helpers |
| `store.ts` | **no** | file-backed reads and writes |
| `paths.ts` | **no** | data directory and atomic JSON I/O |
| `settings.ts` | **no** | credential storage |
| `fetch-title.ts` | **no** | outbound page-title lookup |
| `google-calendar.ts` | **no** | OAuth and the Google Calendar feed |
| `gmail.ts` | **no** | read-only Gmail list / detail fetch |

Importing a *type* from a server-only module is fine — type imports are erased.

### The bridge's modules

`scripts/telegram` is a second, smaller module boundary. Nothing there imports
`bridge.ts`, so the handlers it composes can be tested without it:

| Module | Contains |
| --- | --- |
| `bridge.ts` | composition: the poll loop, the schedules, and what a message means |
| `protocol.ts` | Telegram's wire shapes → the bridge's own. Pure |
| `format.ts` | Markdown → Telegram HTML, and chunking that survives it. Pure |
| `telegram-api.ts` | the Telegram client: send, edit, typing, file download |
| `pi-web.ts` | the pi-web client, including one assistant turn |
| `commands.ts` | slash commands |
| `callbacks.ts` | the button vocabulary, and what a press does |
| `reminders.ts` | which events are about to start |
| `ratelimit.ts` | the per-chat token bucket. Pure |
| `transcribe.ts` | voice notes → text |
| `schedule.ts` | which digests are due, for which chats. Pure |
| `launchd/` | user-agent templates and their installer |

### Time

Two kinds of value, never mixed (see the comment at the top of `dates.ts`):

- **Local calendar dates** (`YYYY-MM-DD`) and **wall-clock times** (`HH:MM`) —
  `Todo.due`, `CalendarEvent.date` / `endDate` / `start` / `end`. What the user
  means by "tomorrow at 3pm". Never converted.
- **Instants** (UTC ISO) — `createdAt`, `completedAt`. When something happened.

Deriving "today" with `new Date().toISOString().slice(0, 10)` is the bug this
split exists to prevent: west of UTC it flips a day early each afternoon. Use
`localDate()`.

`endDate` is **inclusive** — "the 19th to the 22nd" means through the 22nd.
Google's all-day API end is exclusive, so `google-calendar.ts` converts.

### Tests

```bash
npm test
```

The date maths, layout algorithms, Google event mapping, Telegram protocol, and
the settings store are all covered directly, because they fail in ways that are
hard to see in the UI.

---

## Changes to upstream pi-web

Robin is almost entirely additive. New directories: `extension/robin`,
`components/robin`, `app/api/robin`, `app/dashboard`, `scripts/telegram`.

Eight existing files were touched:

| File | Why |
| --- | --- |
| `README.md` | a pointer to this document |
| `components/SessionSidebar.tsx` | dashboard link in the sidebar header |
| `lib/i18n/messages/en.ts`, `zh-CN.ts` | dashboard message catalogue |
| `lib/request-security.ts` | exempt the Google OAuth callback from the same-origin check — a cross-site redirect can never pass it, and the `state` nonce authenticates it instead |
| `lib/request-security.test.mjs` | pin that exemption to one path and one method |
| `tsconfig.json` | `allowImportingTsExtensions`, because these modules are imported by jiti, webpack, and Node's ESM test runner, and Node requires the explicit `.ts` |
| `package.json` | `npm run telegram`, `typebox` for typechecking, `scripts/**` in the test glob |

`package-lock.json` changes with the `typebox` devDependency. Upstream's own
`README.ja.md` and `README.ru.md` are left untouched — those are upstream's
languages; this fork keeps Robin's documentation in English and Chinese only.
