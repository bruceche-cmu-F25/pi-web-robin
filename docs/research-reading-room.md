# Research workspace

`/research` is a general research workspace, not a HEAT page and not a PDF manager. The unit is a **research project** (课题): what you are trying to find out, what you are doing about it this week, what you have learned, and the papers and discussion gathered for it. HEAT is one project among any number.

## Research home

`/research` opens the **home** tab, before the project tabs. Paste any paper link (arXiv, DOI, PDF) or ask about a topic: the agent reads the paper in full and replies with the original abstract, a plain explanation and a structured summary, with no project needed. The margin holds every paper that needs your PDF, the whole library (filter by project or "not in a project", each row tagged with its projects) and the project list. From a paper's sheet, "Add to a project…" files it into a project. The home is a reserved project `general` in `research-projects.json` (never a tab, never archived or renamed); its readings save no project connection, and `research_relate` refuses it. `/research?project=<id>` opens a project tab.

## What a researcher needs, and where it lives

| Need | In the workspace |
| --- | --- |
| Several lines of inquiry, switched quickly | Project tabs at the top; each keeps its own focus, thread, papers and notebook. `+ New project` asks for a name and "What are you trying to find out?" |
| The agent should know what I'm after | The **brief** (project dialog) and **This week** (always editable in place, autosaved). Both are read on every turn; a turn drains pending edits first and refuses to start on a failed save. |
| Find and read papers without clicking through steps | Ask a question or paste a link. The agent searches, obtains the PDF, reads every chunk and saves a reading. No Add/Fetch/Read buttons. |
| Know what is waiting on me | **Needs your PDF** in the margin (and a banner on phones): each paper the agent could not obtain, with its source/PDF links and an **Upload PDF** button. An upload immediately asks the agent to read it. |
| Understand a paper and ask about it | The paper sheet: reading on the left (abstract explained, summary, connection to each project, original abstract, full text by page), **Ask about this paper** on the right with quick asks (explain simply, walk through the method, weaknesses, use it in my project, quiz me). Answers are paper-scoped and also appear in the project thread. |
| Keep conclusions | "Keep in notebook" under any answer appends to the project notebook with the original source links. The notebook downloads as Markdown. |
| Organise readings in Obsidian | Paper sheet → Save to Obsidian: preview, choose a vault, confirm. Front matter carries `projects: ["[[Project]]"]` and a project tag, so the vault groups readings by project. |

Design choices:

- One composer per project and one thread; questions asked while reading land in the same thread, scoped to the paper. The old separate detail-page chat is gone.
- The margin is a document margin (hairline, no panel), per `docs/pi-visual-language.md`. Brief and focus share the top band on desktop so the composer and starters are above the fold at 1440×900; on phones everything stacks and the PDF banner points down to the list.
- Enter sends, Shift+Enter (and touch keyboards, IME composition) make a new line.
- Only one research turn runs at a time across projects; another project shows "the agent is working in X" with Stop.

These are design hypotheses from first principles, not results of a usability study.

## Data model

- `research-domain.ts` owns projects in `research-projects.json`: `{ id, name, brief, objective, note, links, reference?, archived? }` plus the active project. Projects are archived, never deleted. `reference: "heat"` attaches the authored, dated HEAT takeover reference to that project's context only.
- **Migration is read-only until the first write**: with no `research-projects.json`, existing `research-objective.json`, conversation or papers are presented as one project `heat` (name HEAT, the four original links). The first write persists it; the legacy files are left in place and no longer read once the projects file exists.
- `research-conversation.json` holds `{ threads: { [projectId]: messages }, run, errors }`. The legacy single `messages` list reads as the HEAT thread. `run.projectId` names the project a turn serves.
- Papers carry `projectIds`; papers saved before projects (no field) belong to `heat`. New papers start with `[]` and join a project when the agent reads them for it, or via POST `?project=`. "Remove from project" only detaches.
- `analysis.connections[projectId]` holds each project's connection (text, focus at the time, basis "full reading" or "saved reading"). The legacy `heatConnection` reads as HEAT's. A fresh reading keeps other projects' connections.

## Agent

- Tools (`ROBIN_RESEARCH_TOOL_NAMES`, exact allow-list): `research_context`, `research_search`, `research_read`, `research_save_summary`, `research_relate`, `web_search`. No filesystem, coding, mail, calendar, objective or vault writers.
- `research_context` returns the run's project (brief, focus, bounded notebook, links), other projects' names, this project's papers, and `elsewhereInLibrary` (papers read for other projects).
- `research_read` adds the paper to the run's project. `research_save_summary` requires every chunk of the current source to have been returned in this session and records `projectConnection` against the focus the agent read. `research_relate` attaches an already-read paper to this project from its saved reading, refusing outdated or absent readings.
- When a PDF cannot be obtained the agent tries legitimate open-access copies, then says which papers it could not get with their links. It never bypasses paywalls or authenticates to publishers. Abstract-only readings are labelled.
- The previous evidence, cancellation, context-bound and storage limits are unchanged (chunked reads with a per-session ledger, stale-source rejection, 10-minute deadline, 12 × 6,000-character history, 20,000-character notebook context with head + tail).

## HTTP

- `GET/POST/PATCH/PUT /api/research/projects`: list with counts (no notebook bodies), create, edit name/brief/links/archived, set the active project.
- `/api/research/objective?project=`: focus + notebook (GET/PUT) and append (PATCH). Without `project`, the active one; with no projects, the first write creates a general "Research" project.
- `/api/research/agent?project=`: GET the thread; POST `{ question, projectId, paperId?, locale }`; DELETE stops the run.
- `/api/research/papers?project=`: list (needs-PDF rows include `downloadLinks`); `?id=` one paper; PATCH `{ id, removeFromProject }` detaches.
- `/api/research/link-icon?url=`: the icon of a saved project link (GitHub, Sheets, Docs, Drive, or the site's favicon), fetched once and cached locally; other URLs are refused.
- PATCH `/api/research/papers` `{ id, addToProject }` files a paper into a project.
- `/research/heat` (reference stack) edits the HEAT project's notes through `?project=heat`.

## Files

- `extension/robin/research-domain.ts`, `papers-domain.ts`, `research-tools.ts`, `paper-reading-domain.ts`, `lib/research-agent.ts`
- `components/robin/ResearchWorkspace.tsx` (tabs, project head with link chips, focus, layout), `ResearchHome.tsx` (home tab), `ResearchThread.tsx`, `ResearchShelf.tsx` (Needs your PDF, papers, notebook), `PaperSheet.tsx`, `ProjectDialog.tsx`, `PaperExport.tsx`, `useResearchThread.ts`, `useProjectNotes.ts`, `research-client.ts`
- `lib/i18n/messages/research-workspace.ts` (`rw.*`; English, Simplified, Traditional)

## Validation

```sh
node --test extension/robin/research-agent.test.mjs extension/robin/papers-domain.test.mjs extension/robin/paper-sources.test.mjs app/api/research/papers/route.test.mjs app/api/research/objective/route.test.mjs
E2E_BASE_URL=http://127.0.0.1:30141 node --env-file-if-exists=.env.local e2e/research-reading-room.mjs
node_modules/.bin/tsc --noEmit
npm run lint
```

Domain/HTTP tests use temporary stores and stub model calls; they cover project isolation, legacy migration, cross-project relate and Obsidian project links. The browser test mocks every research route and model call. No paid model was invoked; answer quality is not established by these tests.
