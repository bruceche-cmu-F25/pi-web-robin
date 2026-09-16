# Pi Web

Pi Web hosts coding-agent sessions for user-selected projects while keeping the web server's runtime concerns separate from project work.

## Language

**Host Runtime Environment**:
The environment owned by the Pi Web server and its framework runtime.
_Avoid_: Project environment, shell environment

**Project Command Environment**:
The environment presented to a command that Pi Web runs on behalf of a user-selected project.
_Avoid_: Host environment, inherited environment

**Built-in Project Shell**:
A shell entry point owned and operated by Pi Web for commands associated with a project.
_Avoid_: Extension shell, arbitrary child process

**Job Intake**:
The shared Robin behavior that turns discovered job postings into stored jobs: admission, description hydration, deduplication, retention, and persistence. Discovery source traversal and progress tracking remain outside it.
_Avoid_: Job scan, directory sweep, provider lifecycle

**Todo**:
A personal task stored by Robin, including its title, due date, completion state, and display color. Todo behavior belongs to the Todo domain module; HTTP and Pi tools are adapters.

**Saved Link**:
A bookmarked URL stored by Robin with its resolved title, group, and cached icon. Saved Link behavior belongs to the Link domain module; HTTP and Pi tools are adapters.

**Job**:
A discovered role in Robin's job pipeline, including scoring, status, notes, delivery state, and application time. Job behavior belongs to the Job domain module; HTTP and Pi tools are adapters.

**Practice Problem**:
A problem in the local NeetCode catalog, identified by its LeetCode slug. Read-only reference data, generated from published sources; the user's history on it is an Attempt, not part of the problem.
_Avoid_: Question, exercise, card

**Attempt**:
One recorded sitting with a Practice Problem, including the outcome, the hint level reached, and the self-rated confidence that schedules the next review. Practice behavior belongs to the Practice domain module; HTTP and Pi tools are adapters.
_Avoid_: Submission, try, session

**Course Step**:
One completable step of Full Stack Open — a chapter's reading or one of its exercises — identified by its catalog path. The user ticks it, on the dashboard or in the Full Stack Open workspace; both write the same progress file, so a tick in one is a tick in the other. The FSO domain module owns course progress reads and writes; the Learning Hub combines the two Tracks, but course behavior never reads through that combined snapshot.
_Avoid_: Lesson, task, card

**Chapter**:
One Full Stack Open section, named by part and letter (3b), holding a reading Course Step and its exercises. The workspace frames it beside the user's notes; a chapter that moved to courses.mooc.fi is external and opens in a tab.
_Avoid_: Page, module, lesson

**Chapter Note**:
The user's own notes on one Chapter, in their words. The mentor reads them and never writes them. Full Stack Open behavior belongs to the FSO domain module; HTTP and Pi tools are adapters.
_Avoid_: Summary, annotation

**Open Chapter**:
Which Chapter the workspace opened last. Written on every open because the frame is cross-origin and reports nothing back, so the mentor would otherwise have no way to answer "this page". Clicks and initial deep links use the same single-flight confirmation: save before changing the frame or URL. An uncertain write leaves the old frame intact and pauses new mentor requests until a selection is confirmed; this does not assign ownership across multiple browser windows.
_Avoid_: Current page, reading position

**Lecture**:
One row of the watch list at `/learn/watch`: a video, or a whole series where one row stands for many short episodes. Ticked by hand — opening a video never marks it watched.
_Avoid_: Episode, video

**Track**:
One of the two daily lines of learning the Learning Hub and dashboard put side by side: problem practice and Full Stack Open.
_Avoid_: Tab, section, path

**Learning Hub**:
The page at `/learn`: today's two Tracks, the other ways in (Full Stack Open, the capability map, the GPT-2 walkthrough, the watch list), and the Learning Shelf. A front door, not a second dashboard — calendar, todos, and jobs stay on the dashboard.
_Avoid_: Home, landing page, portal

**Learning Shelf**:
The fixed reading links on the Learning Hub, in the groups the list was collected in; every link opens in its own tab. Nothing on it is marked read. Distinct from a Saved Link, which is a bookmark for the rest of the day.
_Avoid_: Links panel, bookmarks, resource list

**Metrics**:
Counting, scoring, or scheduling someone's work: statuses, progress totals, review dates. They belong to the practice side, where a review schedule depends on them. Course Steps and Lectures carry only the ticks the user set; nothing scores or schedules them.
_Avoid_: Stats, tracking, gamification
