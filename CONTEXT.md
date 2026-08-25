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
