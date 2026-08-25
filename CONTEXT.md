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

**Curriculum Item**:
One entry in the hand-curated study syllabus, identified by a stable id: a course, docs, video, book, repo, gallery, or a Milestone. Read-only reference data; the user's history on it is a Study Record.
_Avoid_: Link, bookmark, lesson

**Milestone**:
A Curriculum Item that is built rather than read. It closes a module by naming what reaching the outcome would look like. Nothing counts or checks it — it is a statement of the target, not a task.
_Avoid_: Exercise, assignment, project

**Study State**:
The only thing the curriculum side stores: which Curriculum Item was opened last and which track the syllabus is showing. It exists because that item opened in a tab of the user's own, which reports nothing back, so the mentor would otherwise have no way to answer "this page". Deliberately not a record of what was read — the curriculum keeps no status, counts, or progress of any kind. Study behavior belongs to the Study domain module; HTTP and Pi tools are adapters.
_Avoid_: Study record, progress, reading history

**Track**:
Overloaded by position, and deliberately kept apart. A *coding track* is which half of the `/coding` workspace is showing — problems or curriculum — and is a browser preference. A *curriculum track* is one of the six top-level groupings of the syllabus and is stored, because both the page and the mentor read it.
_Avoid_: Tab, section, path

**Learning Hub**:
The page at `/learn`: the entries into each learning surface, the progress in each, and the Learning Shelf. A front door, not a second dashboard — calendar, todos, and jobs stay on the dashboard.
_Avoid_: Home, landing page, portal

**Learning Shelf**:
The study links on the Learning Hub, grouped the way the reading list was collected rather than the way the curriculum teaches. A second arrangement of the Curriculum Items, holding their ids rather than their URLs. Distinct from a Saved Link, which is a bookmark for the rest of the day.
_Avoid_: Links panel, bookmarks, resource list

**Metrics**:
Counting, scoring, or scheduling someone's work: statuses, progress totals, review dates. They belong to the practice side, where a review schedule depends on them, and are deliberately absent from the curriculum side.
_Avoid_: Stats, tracking, gamification
