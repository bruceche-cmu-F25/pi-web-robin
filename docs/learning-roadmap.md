# Learning Roadmap: the map first, click to read

`/learn/roadmap` now defaults to **the actual saved roadmap layout**, not the 23-lesson course or the rejected three-mode prototype. The user explicitly preferred the original roadmap with click-to-expand and lower interaction overhead. No mode chooser, force layout, prerequisite gate or assessment step precedes reading.

## Original-layout roadmap (current default)

- `LearningGraph.tsx` reads `.roadmap.md` documents from the selected registered Obsidian vault through GET-only `/api/robin/learning/graph`. One vault is automatic; multiple require a choice. No hardcoded vault ID, absolute path or personal graph is bundled in application code.
- Each document has one fenced `roadmap-graph` JSON block (version 1) containing original node IDs, types, labels, positions, dimensions and edge endpoint/handle identities. Its Markdown explanations follow explicit `<!-- roadmap-node: ID -->` markers. The optional first `##` heading is omitted in the inline reader because its header already names the node. Duplicate names do not merge; markers inside code fences do not attach content.
- The one-time local import created three new documents from the user's existing 2026-10-24 published snapshots: Full Stack (37 topic/subtopic nodes), AI Engineer (190), FDE (94). All original nodes, including decorative labels/sections/lines, and explicit edges were retained. Missing width/height fields use the snapshot's measured dimensions. These are dated snapshots, not a live upstream sync. Application colours and Bezier connectors are redrawn, not pixel-identical upstream styling/routing. Connections are not promoted to inferred prerequisites.
- The shared map renderer distinguishes core topics (amber, heavier border/type), branch topics (slate blue) and external resources (purple, dashed border), with a localized legend. Colours identify node types, never learning progress; fills are composited over an opaque panel so connectors cannot show through. Both light and dark themes reuse existing semantic palette tokens.
- Snapshot paragraph bounds sometimes include sibling buttons. `graphTextLayout` reserves the free text band above/below overlapping controls (8px clearance) in a display-only projection; it does not change saved geometry, topic positions, edges or notes. Labels use their full imported width without extra padding, and text backplates interrupt connectors. The reader's cut uses the corrected text bounds too. Fully occupied malformed bands retain source geometry rather than silently hiding content; this is not a general graph auto-layout engine.
- Full Stack has 37 short authored Chinese introductions/checkpoints, explicitly distinguished from official node articles and from a complete course. AI Engineer and FDE currently have the original structure, not prepared node explanations. The UI reports exact prepared/total counts and honestly shows missing content. Do not claim 321 complete lessons.
- Clicking a topic/subtopic inserts one reading band just below its row; later nodes move down without changing horizontal placement. Clicking again, Collapse or Escape inside the reader closes it; Collapse returns focus to its node. Browser history and `?vault=…&map=…&node=…` restore selection. A native topic selector jumps directly to a node. Small screens scroll the same map horizontally rather than shrinking text; the reading band fits the visible viewport.
- Both graph and explanations are read live from Obsidian. Edit there, then Refresh. The importer created new files only; original notes, raw snapshots, and every existing learning record were left unchanged. There is no web write endpoint, automatic synchronization, model call or progress write. The discarded static interaction prototype has been removed; its research record remains historical documentation.
- `learning-graph-domain.ts` owns discovery/validation/projection. It reuses `readVaultNote` and its registered-root, regular-file/no-symlink/no-hidden-file, 256 KiB and bounded-scan safeguards. Only validated graph fields leave the server: finite/bounded geometry, known node types, unique IDs, valid edge handles/references, and HTTP(S) URLs. Markdown skips raw HTML and images. The endpoint uses the shared origin/auth guard and private/no-store responses.

Checks: `node --experimental-strip-types --test extension/robin/learning-graph-domain.test.mjs`; `node --env-file-if-exists=.env.local e2e/learning-graph.mjs`. The browser fixture never accesses personal notes. Opt-in `LEARNING_GRAPH_LIVE=1` reads the single registered vault's roadmap documents, then serves those responses through browser mocks; no writes. It visited all 321 topic nodes and checked edge counts, expansion/collapse, focus, history, reload and 320–1440px reader layouts. The visual regression also checks text containment and pairwise text/control bounds for all three maps in light/dark at those widths, distinct resolved type colours, and that every expanded reader clears the graph after its measurement frame. Synthetic fixtures reproduce paragraphs containing links, overlap with a preceding control, and labels wrapping because of unnecessary padding. This does not verify teaching effectiveness or industry adoption.

## Learning hub entry points

`/learn` keeps today's FSO/NeetCode work and the study shelf in the main column. A shared `WorkspaceRail` on the right groups the saved roadmap, Full Stack Open, GPT-2 walkthrough and video watch list; the FDE reference keeps its four checkpoints in a disclosure. At widths up to 1150px the rail starts folded above the daily work. `/learn/map` and its capability-atlas UI were retired at the user's request; GPT-2, video ticks, roadmap notes/course records and all learning progress remain unchanged. The main roadmap at `/learn/roadmap` is not the retired capability map.

### Full Stack Open note writes

The separate `/learn/fso` editor compares draft text with confirmed text **inside**
its serialized write queue, after earlier requests settle. Comparing before the
queue loses A → B → A edits when B is still in flight. The same rule applies to
unmount's best-effort keepalive save. A failed response invalidates the previous
confirmation: it cannot prove that an older write never committed. Flush/mentor
requests must await the corrective write, and a failed correction remains
retryable without sending the mentor a known-stale note. This does not add
cross-tab conflict protection or guarantee delivery on browser shutdown.
`components/robin/FsoNotes.test.mjs` covers these interleavings with controlled
requests; course ticks and chapter-selection persistence remain unchanged.

## Preserved earlier workspaces

The earlier course is at `?view=course`; `?lesson=…` deep links still open it. The source reader remains at `?view=notes`; existing `?note=…&vault=…` deep links still open it. Neither view edits Obsidian or changes FSO/NeetCode progress. The following sections describe these preserved workspaces, not the new default map.

## The teaching contract

The user's correction was that the old screen displayed categories and generic self-assessment prompts without actually teaching. Do not fix that with more navigation, topic labels or another unprepared assistant chat.

- The course has 23 substantive lessons across six stages: orientation (1), Web delivery (6), model foundations (2), AI applications (6), optional training/Infra (4), customer delivery (4). The same **ticket-and-knowledge assistant** provides continuity. Examples are synthetic teaching designs, not claims about an actual customer's system.
- Every lesson contains a motivating question, an observable outcome, prerequisites, one takeaway, a labelled relationship/process diagram, three explained concepts, a worked example, a misconception with correction, a specific multiple-choice check with feedback for every option, and a distinct practical exercise with two hints, a reference answer and a three-part rubric. No generic fallback questions are used in the course.
- Answers and hints are collapsed initially; feedback checks the selected choice only. Viewing, answering a choice, revealing a solution or following a link never writes a learning record. Open-ended practice is **not** automatically graded or executed.
- Application learners may skip training/Infra and proceed to delivery. Prerequisites are links, not enforced locks. This is a cross-layer foundation, not a replacement for complete programming-language courses, formal ML study or verified professional competence.
- `learning-course-{web,ai,training,delivery}.ts` contain the authored teaching material. `learning-course.ts` defines its schema, stages and official references. Content is intentionally Simplified Chinese and marked `lang=zh-CN`; interface controls use the existing locale layer. No claim of translated lesson bodies is made.
- Preparation used the user's 18 career-roadmap/AI-map notes and official references (MDN, React, PostgreSQL, OWASP, Hugging Face/TRL, LoRA/QLoRA papers, Inspect, MCP, PyTorch, vLLM and Microsoft's RAG design guide). Notes are source material, not verbatim curriculum or execution instructions. Each lesson exposes relevant official links and their purpose. Numerical examples state assumptions; library/model behavior should be rechecked against concrete versions before production work.

## Workspace behavior

`LearningCourse.tsx` fetches the prepared course and independent records from `/api/robin/learning/course`. It has a six-stage panorama, a lesson search, a human-marked weak-spot filter, explanatory reading and guided practice on one page. Small screens collapse the panorama and outline so the actual lesson is not buried behind navigation. Desktop keeps the outline sticky. No new global navigation item or dependency is introduced.

`?lesson=<stable-id>` preserves the selected lesson across reloads, without overwriting unrelated query parameters. Invalid IDs show a missing-lesson state. Lesson selection focuses/scrolls to its heading. Navigation within the course asks before discarding unsaved practice; a pending save blocks it. A native before-unload warning protects full-page exits. This is not a global router blocker for unrelated SPA navigation.

The course works without a registered/available vault. Source-note lookup is lazy: expanding references lists registered vaults; one may be selected automatically, multiple require an explicit choice. Only the chosen vault's bounded roadmap catalog is read, and only exact matching source titles are linked. No hardcoded vault ID/path is shipped. Missing notes, unavailable vaults and limited/skipped scans are reported, never concealed. Source lookup failure does not remove the prepared lesson.

## Source reader (preserved)

- Discovery uses paths containing `roadmap`, `路线图` / `路線圖`, `学习路线` / `學習路線` or `知识地图` / `知識地圖`. Folders form the landscape. This is a naming convention, not semantic discovery or proof that every relevant note was found.
- Notes are read live, never bundled into the client. A header plus top-level ATX `##` headings form chapters; preamble is retained. Fences, YAML and comments do not create chapters. Setext headings, plugins, Canvas and arbitrary outline grammars are not emulated.
- Tables, read-only checkboxes, supported wikilinks and Mermaid render. HTML and external images do not. Practice displays identifiable source exercise/check sections; if absent, the old reader's clearly labelled generic prompts remain. They are not the default teaching experience.
- Source changes preserve older evidence and request reassessment. Renames/moves create new identities; old records are retained, not silently reassigned. Explicit refresh rereads notes; no watcher, model call, semantic index or background synchronization is added.

## Domain and persistence

`learning-roadmap-domain.ts` owns both independent assessment persistence and the two read projections. The existing guarded `/api/robin/learning/roadmap` adapter retains its vault boundary; the new guarded `/api/robin/learning/course` adapter exposes authored content and course saves. Both are private/no-store.

`learning-roadmap-progress.json` under `ROBIN_DATA_DIR` (default `~/.pi/robin`) is unchanged in shape. Original records use registered vault ID, note path and chapter identity. Authored-course records use reserved namespace `@learning-course`, path `software-ai-foundations` and stable lesson ID. These identities never resolve to a vault, and the course save endpoint derives them server-side rather than trusting supplied paths or titles. Existing source records coexist untouched. This document is not a migrated task collection or operational state.

Users explicitly save `unassessed`, `learning`, `gap` or `confident`, with practice text/evidence (max 20,000 characters). `confident` is labelled self-assessed and requires nonblank evidence. Per-record revisions reject stale/concurrent writes. Errors preserve the draft; no automatic retry overwrites other work. Copy important draft text before accepting a reload/discard prompt after a conflict.

A SHA-256 fingerprint covers a source chapter's text or the complete authored lesson plus its referenced source metadata. Updated content retains old evidence but resets the draft to unassessed; stale records do not count toward current confident/gap summaries. A successful explicit reassessment stores the new fingerprint. The atomic JSON writer and cross-process lock protect records; malformed stored data fails closed. No lock spans a vault read. External source edits are detected on the next read, not prevented.

The vault reader retains its registered-root, no-symlink/no-hidden-file, 256 KiB/note, 1,000-note/20 MiB/20,000-entry bounds. This feature sends no personal content to a model, creates no tasks/events, and never executes code from lessons or notes.

## Checks

```sh
node --experimental-strip-types --test extension/robin/learning-course.test.mjs extension/robin/learning-roadmap-domain.test.mjs app/api/robin/learning/course/route.test.mjs app/api/robin/learning/roadmap/route.test.mjs components/robin/LearningHub.navigation.test.mjs
node --env-file-if-exists=.env.local --experimental-strip-types e2e/learning-course.mjs
node --env-file-if-exists=.env.local --experimental-strip-types e2e/learning-roadmap.mjs
node_modules/.bin/tsc --noEmit
```

Domain/API tests isolate progress and vault fixtures. They check complete lesson structure, prerequisite ordering, distinct exercises, answer arithmetic, source references, namespace isolation, unchanged old records, evidence requirements, fingerprints, revisions, malformed storage and HTTP guards. These structural tests are not a substitute for pedagogical review.

Browser checks reuse the running server and mock all personal source/progress requests. They visit all 23 lessons, exercise wrong/right feedback and hidden hints/answers, verify no automatic writes, save/reload, gap filters, conflict preservation, stale evidence, discard guards, source-vault choice and failure, missing lesson IDs and responsive layouts (320–1440px). The separate original-reader suite still covers source parsing, Mermaid and read-only notes. Screenshots: `/tmp/learning-course`, `/tmp/learning-roadmap`.
