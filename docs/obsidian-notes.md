# Notes → Obsidian

Obsidian is the default permanent archive for Notes. Notion remains an optional destination.
This is a one-way, user-confirmed archive, not synchronization or a second Markdown editor.

## Use

1. Open a vault in Obsidian on the computer running Pi Web.
2. In `/notes`, choose that vault in the library. A single registered vault is selected automatically; multiple vaults require a choice.
3. Write a draft and attach images/PDFs. **Review & save** previews the original text without a model call. **Organize with AI** uses the existing preparation job instead.
4. Check the destination and preview, then confirm saving to Obsidian.
5. Continue editing the saved Markdown file in Obsidian. The Robin draft disappears only after publication and archive-index persistence succeed. The library retains recent archive links.

Choose **Notion** in the destination selector to use the existing parent-page selection and confirmed Notion archive workflow. Notion is not fetched by default.

## Notes / Canvas / Mind map

`/notes` now has the same inset, content-sized secondary navigation as Incoming and Job hunt. `?view=notes|canvas|mindmap` selects the workspace; old `?canvas=<id>` links still select Canvas. Switching flushes Canvas and refuses to unmount it on a failed save. Note draft state/autosave stays mounted through `useNoteDrafts` in `NotesWorkspace`; URLs retain chat context and browser Back/Forward restore the view. Canvas keeps its existing library, persistence and editor; merely opening its tab does not create a board.

The **Mind map** tab is now an independent conversational editor, replacing the earlier note-outline projection. `?view=mindmap&mindmap=<uuid>` restores a document. New map creates a central topic; **Copy from Notes** explicitly copies the current note's ATX headings and nested lists, never changes or syncs the original. Prose/code/attachments are not imported; sources over 250 outline items refuse instead of silently truncating. Markdown export is a separate download. No graph layout or edits are written to Obsidian.

### Natural-language and manual editing

- A selected node (Ctrl/⌘/Shift-click for several, up to 30) becomes an explicit reference beside the composer. The native node selector also provides a keyboard/touch alternative to tiny zoomed nodes. The assistant receives the complete current map and last eight persisted conversation messages, not other maps or notes. **Edit map** can propose structural changes; **Discuss only** is enforced by the response validator and accepts no operations.
- `lib/mindmap-agent.ts` uses the chosen existing model through `runScopedAssistantTurn`: one-shot, `toolNames: []`, no filesystem/browser/MCP capability, medium thinking, 180-second timeout and abort support. Labels/history are untrusted context. It returns a JSON proposal with `add`, `rename`, `move` and `remove` operations, not a whole-tree replacement. New grouping/splitting preserves existing IDs by moving nodes. Malformed output is rejected; it is never executed as code.
- The model endpoint **does not write**. The browser applies the validated proposal through the same PATCH as manual edits, including a base revision. Manual editing can continue during inference: a changed revision, unsaved node-text buffer or pending save refuses the late proposal. Cross-tab changes are checked again under the domain's lock. An unapplied answer is shown separately; resend after reconciling, never automatically rebase it.
- Click to select, edit text and save explicitly; add a child, delete a confirmed branch, drag onto another parent, or use the parent selector. Fold, fit, pan/scroll and zoom are view-only. Changed nodes have a dashed edge; selection has a separate outline. Full long labels remain in accessible names, tooltips and the text field.
- Undo/redo restores content snapshots with a new revision (up to 20); conversation remains historical and each message shows its revision. Tab switches hide rather than destroy this workspace, preserving drafts and in-flight replies. Chat drafts are best-effort browser-local; unsaved node text is held in memory with a navigation/unload warning, not crash recovery. Storage failures keep local input and explicit retry. Stop cancels an unapplied model proposal, not a PATCH already sent; the UI says so.

### Persistence and implementation provenance

`extension/robin/mindmap.ts` owns the tree/edit contract; `mindmap-domain.ts` owns `mindmaps/<uuid>.json`, outside the task SQLite migration. Each private atomic file holds the version-1 tree, revision, 24 recent chat messages, undo/redo and the last 50 mutation receipts. A client-generated document UUID makes uncertain creates retryable. The same mutation ID and payload can be retried without duplicate application; reusing the ID for a different payload is rejected. Receipts are bounded, not an unlimited exactly-once guarantee. Deletes and edits check revisions under the same file lock; late writes never recreate deleted maps. Corrupt/newer files fail closed.

The entire operation batch is validated on a copy before commit: no unknown IDs, duplicate IDs, cycles, root removal/move, unsupported fields/actions or invalid positions. Bounds: 300 nodes, 16 levels, 500 characters/label, 60,000 total label characters and 100 operations/batch. HTTP adapters use the shared origin/content-type guard and bounded bodies (256 KB CRUD, 24 KB model request).

The SVG/DOM renderer, edit protocol and conversational integration are independently written in this MIT-licensed repository; no new dependency or third-party source code was copied. Product behavior was researched in [Xmind Agent](https://xmind.com/user-guide/xmind-ai-chatbot/web) and [Simple AI Mindmap](https://github.com/callmemhz/simple-ai-mindmap). The latter README claims MIT but lacked a standalone LICENSE in the inspected tree. [Mind Map Wizard](https://github.com/linus-sch/Mind-Map-Wizard/blob/main/license.md) has a noncommercial CC BY-NC license and was **not** incorporated. The MIT `simple-mind-map` library was considered but its README marks it low-maintenance; the existing independent renderer covers this bounded tree without adding it.

Checks: `extension/robin/mindmap-domain.test.mjs`, `lib/mindmap-agent.test.mjs`, `app/api/robin/mindmaps/route.test.mjs` and `components/robin/note-mindmap.test.mjs` cover protocol/storage/model scope/HTTP guards and layout. `e2e/notes-views.mjs` intercepts all application APIs, runs real domain writes in a disposable directory and uses fake model output. It checks selected-node edits, discussion, manual/inference and cross-tab conflicts, malformed output, undo/redo, lost-response retries, refresh/Back/Forward, draft preservation, unchanged source notes, Canvas guards and 320–1440px Glass/Dark glass/Light layouts. It does not call a live model or validate physical-phone gestures.

## Phone reading layout

Below 960px, Notes reuses the shell's reserved 60px menu row for its workspace tabs,
leaving the menu's 44px hit area and the inbox's top safe-area inset intact. Filing
is a native **Save & organize** disclosure below the document, closed by default.
Its expanded area is capped at 45% of the desk and scrolls independently, with a
sticky summary; destination, conversation inclusion and both archive paths remain
available. Running preparation and archive review open it automatically; returning
to editing or selecting another draft folds it again. Merely opening it never saves
or calls a model. Desktop keeps its existing masthead actions.

Phone previews scroll the entire sheet, including title and attachments, rather
than pinning them above a small body scrollport. The editor keeps at least a 160px
flex basis on short screens; the sheet can scroll instead of crushing the textarea.
Errors stay outside that mobile scrollport so archive/save failures remain visible.
The existing page owns the bottom safe area. No smaller body type, new persistence,
viewport listeners or custom dialog are involved.

`e2e/notes-mobile-reading.mjs` mocks all workspace APIs and checks 320/390px phones,
short landscape geometry, top/bottom safe-area overrides, light/dark Glass and Light,
scrolling to the final paragraph, collapsed/expanded controls, review/back without
writes, keyboard access and unchanged desktop actions. Physical iOS keyboard,
safe-area and touch behavior still require a phone check.

## Draft autosave before archiving

`useNoteDrafts` owns the mounted draft collection and text-write lifetime:
400 ms debounce, one serialized PATCH queue, exact edit identity, local recovery,
per-draft status/error and delete/archive ordering. `NotesWorkspace` remains the
adapter for loading/creation, navigation, confirmation, archive destinations and
post-archive UI. Canvas, attachments and finalization retain their own modules.

A failed save is retried only if that exact draft is still current; a newer edit
may already have left the pending slot and entered the write queue. Requeueing an
obsolete failure can overwrite a newer successful save during pagehide. Save
status counts queued/in-flight writes, not just the pending slot: an earlier
receipt cannot mark a later write saved. Errors and retries belong to the selected
note; switching drafts cannot carry another note's save error into a clean editor.

Delete and archive freeze that note's edits and retries before awaiting the queue.
Delete discards unsent debounce work, but restores unconfirmed text for explicit
retry if deletion fails. Archive flushes first and refuses publication unless the
latest text is acknowledged. Both retain the local draft until the operation
succeeds; late failures/background flushes cannot PATCH a deleted draft. The caller
still confirms deletion or destination/content before invoking either operation.

Pagehide, hidden-document and unmount flushes remain best effort. Keepalive is used
only for serialized UTF-8 bodies up to 60,000 bytes; larger text is sent intact
without keepalive. This is not a guarantee that mobile shutdown delivers requests.
This protects this tab's write ordering, not concurrent editing from other devices.
[Local text recovery](text-recovery.md) separately backs up title/text/destination at
edit time, offers manual preview/restore/discard after reopening, and clears only
acknowledged revisions. Storage is bounded and best-effort; attachments and canvas
are not included, and a local copy never silently overwrites the server version.

Checks: `components/robin/useNoteDrafts.test.mjs` uses controlled transport and real
recovery functions at the module interface. `e2e/notes-autosave.mjs` mocks queued
receipts, failure/retry, draft switches and deletion interleavings;
`e2e/obsidian-notes.mjs` covers confirmed archive and failed-flush refusal;
`e2e/text-recovery.mjs` covers reopening and cross-tab recovery. No check publishes
a real note or calls a model (the archive E2E's initial vault discovery is read-only).

While AI finalization runs, the browser's 2.5-second status poll and one-second
elapsed clock stop when the document is hidden. Returning refreshes status and
resets the clock immediately; finishing/unmounting removes both timers and the
visibility listener. This does not cancel server-side finalization. A read already
in flight can finish while hidden. `e2e/background-polling.mjs` verifies timer removal,
request counts, recovery and completion with mocked data. Each read advances the
same generation used by local finalize/cancel/discard updates; an older poll cannot
replace a newer ready result or undo a local command. Unmount invalidates reads.

Attachment removal retains the row until DELETE succeeds. Its control is disabled
while that file's request is pending, guarded against duplicate submission, and
available again on HTTP/network failure. A confirmed removal invalidates earlier
attachment reads for that draft; reads from departed visits are also ignored.
Upload receipts invalidate earlier lists too, and upsert by attachment ID: a GET
may already contain a file before its POST response arrives. Do not append that
receipt twice or let a pre-upload snapshot erase it. The same browser fixture
covers both response orders, including Strict Mode's duplicate initial reads.
File notices are scoped to the initiating note. The delete target is 44×44 CSS px
on narrow or touch-capable screens, with visible keyboard focus. This is verified
in browser emulation, not a physical-phone check. `e2e/frontend-reliability.mjs`
covers failure/retry, obsolete reads, finalization ordering and touch-target size;
all business endpoints are mocked.

The Obsidian search adapter returns literal status discriminants (`searched` versus
`ready` / `choose-vault` / `no-vault`) so callers may safely narrow before inspecting
scan limits. This is a type contract only; vault discovery and permissions are unchanged.

## Files and discovery

Vault discovery reads Obsidian's `obsidian.json` in the platform configuration directory:

- macOS: `~/Library/Application Support/obsidian/obsidian.json`
- Windows: `%APPDATA%/obsidian/obsidian.json`
- Linux: `$XDG_CONFIG_HOME/obsidian/obsidian.json` or `~/.config/obsidian/obsidian.json`

`ROBIN_OBSIDIAN_CONFIG` can override the registry path for operator configuration and isolated tests. HTTP requests supply a registered vault ID, never an arbitrary filesystem path. Existing vaults must contain `.obsidian`; the integration does not create or modify Obsidian configuration.

Each archive is a self-contained bundle:

```text
<vault>/Notes/Robin-<draft-id>/
  <sanitized-title>.md
  Attachments/<attachment-id>-<original-name>
  .robin-archive.json
```

Stable draft IDs avoid title collisions. A hidden staging directory is renamed into place only after all original attachment bytes, Markdown and the recovery receipt have been written. `attachment:ID` Markdown links become local relative links; attachments not referenced in the body are appended. Unknown/missing attachments fail the archive rather than silently disappear. Obsidian edits are never overwritten by retries.

Robin records archive receipts in `~/.pi/robin/obsidian-archives.json` (or `ROBIN_DATA_DIR`). A published bundle's hidden receipt allows retry recovery if the Robin index write fails. Draft text and attachment IDs are checked against the reviewed snapshot, and writes are serialized with draft/attachment changes. Symlinked archive directories and unrelated pre-existing bundles are refused.

Research's **Keep in notebook** is an explicit one-click archive action: it saves the selected stored answer to the project notebook and uses this same publication mechanism to create an Obsidian note. One registered vault is auto-selected; multiple vaults require the user's choice in the project notebook. The project remembers that choice, and per-message receipts make retries/reloads safe. A vault failure preserves the notebook and offers a retry; no separate preview or model step is required for each Keep click. See [Research workspace](research-reading-room.md#keep--automatic-obsidian-archive).

No automatic migration of existing Notes, Product ideas, FSO notes or Notion pages occurs. Task status, progress and product stages remain in Robin. The separate `/obsidian` workspace browses current files; it does not provide two-way editing. Archive links are creation receipts, not a live file index: renaming or moving a file in Obsidian does not update an archive receipt.

## Conversation → linked knowledge

The conversation toolbar's **Capture knowledge / 沉淀到知识库** action is a separate workflow from draft archiving. It never deletes a draft or modifies the source session.

1. Select the current branch's entire conversation, last 12 text messages, or last 4. Check the expandable source before sending it to the chosen model. Sources over 80,000 characters are refused, not silently truncated.
2. Choose the registered vault, project name and model. Only user/assistant text from that ancestor chain plus a bounded catalog of vault filenames is sent. Thinking, tool results, system/custom messages, images, sibling branches and existing note bodies are excluded. The catalog skips hidden/symlinked entries and stops at 200 Markdown files or 5,000 directory entries.
3. A tool-free, one-shot model call proposes 1–5 ideas, decisions, architecture notes, progress snapshots or summaries. Suggestions must remain distinguishable from confirmed decisions; reported progress is not verified live state. Model output can cite known message/note IDs, never choose arbitrary filesystem paths.
4. Review each new note or append-only supplement, its destination, project entry page, explicit `[[links]]`, provenance and (for supplements) the unchanged existing text. Confirmation saves the stored proposal, not a second generation. The first version saves all proposed notes together; go back and prepare again if the proposal is unsuitable.
5. Open saved notes in Obsidian, or find their links in Notes' existing archive list. Native backlinks and Graph View connect them through the project entry page and suggested relationships. The separate `/obsidian` browser can also visualize these explicit links; neither workflow introduces a graph database.

New files are placed under:

```text
<vault>/Knowledge/<sanitized-project>-<stable-hash>/
  Project.md
  <capture-id>/
    n1-<title>.md
    n2-<title>.md
```

A model may propose a supplement to a cataloged existing file instead. Its body is read **locally** for review and hash-checked again at confirmation. New files are published without replacement; supplements append to the checked file descriptor. Existing project entry pages are never replaced. Notes include a conversation URL, branch ID, supporting message IDs, capture timestamp and scope. The URL opens the conversation; the branch ID records which branch was actually used, rather than claiming the URL restores an immutable transcript.

`knowledge-proposals.json` in `ROBIN_DATA_DIR` holds review/retry state, generated Markdown and existing-text snapshots, not a second editing surface or the raw source transcript. It may contain sensitive reviewed text, so protect it with the rest of Robin's data. The same source fingerprint/project/vault reuses its previous proposal unless the user explicitly prepares again. The toolbar shows the saved-note count; the dialog lists recent proposals and their saved/total counts. Partial success is reported and retained; completion markers allow retries after publication without appending twice. A changed existing note requires a new preview. A source conversation remains unchanged even if preparation fails or is cancelled.

Local locks serialize Robin writers, **not Obsidian or other filesystem clients**. Hash/inode checks detect changes around the append, but cannot make simultaneous external editor saves transactional. Avoid editing the same target during confirmation. Robin still does not track subsequent Obsidian moves, renames, deletions or edits.

Implementation: `lib/knowledge-source.ts` owns branch selection; `extension/robin/knowledge-domain.ts` owns proposals/publication; `app/api/sessions/[id]/knowledge/route.ts` supplies the HTTP and model adapter; `components/KnowledgeCaptureDialog.tsx` owns the review flow.

## Local vault workspace (`/obsidian`)

A dedicated **Obsidian** navigation entry opens a read-only view of the same registered vaults. A single vault is selected automatically; multiple vaults require a choice. The existing Notes/archive workflow is unchanged.

- **Library** (default): note cards with a bounded 240-character plain-text excerpt from the current file, directory colour, modification date and unique-neighbour count. Excerpts are local text, not AI summaries; no additional file/model requests are made per card. Search filters titles/paths; collection filters select the top-level folder, linked notes or unlinked notes. Sort by recent modification, title or connection count. The collapsible file directory remains an alternative. Cards open a side preview; **Read full note** opens the document. Selecting a note updates `?vault=…&note=…&view=…`, preserving chat context; reload restores note, vault and view (not filters or camera).
- **Glass ground**: the workspace shell and library's space between cards opt into shared `.robin-workspace-ground`; no independent page wash. Cards, full reading, graph canvas, inspector and sticky reader header keep their reading backgrounds. Other palettes are unchanged. `e2e/workspace-ground.mjs` compares the shared source across five workspaces.
- **Reading surfaces**: library cards and the separated workspace panes use the shared 16px card radius; controls and code/table frames use 8px. The desktop node preview is 320–440px wide and scrolls with the inspector, not inside a second height-capped body. Preview text is 16px and full reading text 18px (rem-based), with system fonts, main-text contrast, upright semibold headings and room between paragraphs/lists. Full reading gives the former file-column space to the document and keeps connections alongside it; return to Library/Graph for collections. Code and tables have keyboard-focusable horizontal scroll regions, not clipped content or page-wide overflow. Mobile keeps one visible pane, with the same typography and theme tokens.
- **Reader**: Markdown/GFM, hidden front matter, supported wikilinks (`[[note|label]]`, including note-embed links) and inline Markdown note links. Code and HTML comments are excluded from link extraction. Relative paths and exact vault paths are resolved before unique short names; ambiguous names remain unresolved. Same-note heading navigation is supported; cross-note links open the destination note, not a guaranteed heading/block position. Reference-style Markdown links, YAML aliases, block references, Dataview, Obsidian `.canvas` boards, plugin views and transclusion are not emulated. The original Markdown is available in a source fold.
- **Preview and connections**: a card/node opens the actual Markdown in the inspector alongside outgoing links, backlinks and unresolved links, without leaving the library/graph. Links from front matter are included when written as wikilinks. These are syntactic relationships, not AI-inferred associations. Mobile switches between collections, workspace and preview; preview text is not clipped behind a nested scroll on phones.
- **Canvas Graph**: replaces the old 80-node SVG with all indexed notes (up to 1,000), using the already-installed `d3-force` package now declared directly. Folder colour is consistent across cards/filters/nodes; radius reflects unique neighbours. Reciprocal links share one visual edge while the reader preserves direction. Whole-vault, one-hop and two-hop scopes intersect the current title/path and collection filters. The force layout uses repulsion, collision, links and a gentle folder attraction; it is not a semantic/AI clustering model. Dense rendering/force work is capped at 10,000 unique edges with a visible notice; adjacency, scope and counts still use all indexed links.
- **Graph interaction**: wheel/trackpad zoom is anchored under the pointer; drag empty space to pan, drag a node to pin its position, hover to highlight its neighbours, click to preview and double-click to read. Two-pointer pinch scales and pans without selecting a node. Locate a note through the native selector, use +/−/Fit/Re-layout buttons, or focus the canvas and use arrow keys, +/−, 0 and Enter. Re-layout releases pins. Focus canvas hides the sidebars; Escape restores them, and selecting a node reveals the preview again (including on phones). File/cards/connection lists remain the accessible alternative to the Canvas drawing.
- **Graph lifecycle**: lazily loaded Canvas module with DPR capped at 2; semantic theme colours are refreshed when the theme changes. Force computation runs in bounded requestAnimationFrame slices, stops when settled and pauses when hidden/inactive. Reduced motion computes the layout without showing intermediate frames. Pointer capture ends/cancels safely. Selecting a note does not rebuild global graph data; switching between library, graph and reader preserves the mounted graph's camera and positions. Vault switches remount it. Filter changes reuse known positions; refresh/reload may reset the graph. No layout positions or pinned nodes are written to the vault.
- **Refresh**: rereads current files and links, including external edits, renames and deletions. There is no persistent browser index, filesystem watcher, automatic model call, write endpoint or second copy of the vault. **Edit in Obsidian** opens the original file through `obsidian://`; it requires that vault on the browser device.
- **Privacy and bounds**: only registered roots; no hidden paths, symlink entries, arbitrary server paths or non-Markdown content. Reads use no-follow/non-blocking file descriptors, bounded buffers and post-read checks. The index stops at 1,000 notes, 20 MiB of Markdown, 20,000 directory entries or depth 32; individual notes are capped at 256 KiB and indexed relationships at 200 per note. Partial/skipped results are visible, never represented as a complete vault. External image requests and raw HTML rendering are disabled; attachments stay in Obsidian. API responses are private/no-store and use the shared origin/auth boundary. Local filesystem clients can still race traversal; this is not an OS sandbox against a malicious process with write access to the vault.

`extension/robin/obsidian-browser-domain.ts` owns read/index boundaries and card excerpts; `obsidian-links.ts` owns the shared supported-link subset; `/api/robin/obsidian/vault` is a GET-only adapter. `components/robin/obsidian-graph.ts` owns adjacency, bounded graph construction and camera/hit-test math; `ObsidianGraph.tsx` owns the Canvas/force/pointer lifecycle; `ObsidianWorkspace.tsx` owns filtering, the three views and the document inspector. The workspace is independent of the generic `/api/files` roots, so opening a vault never authorizes broader filesystem browsing.

### References consulted

- [Obsidian Graph view](https://obsidian.md/help/plugins/graph): graph navigation, neighbour highlighting, filtering and local scope.
- [D3 force](https://d3js.org/d3-force): the force simulation behind the interactive Canvas layout.
- [Quartz Graph View](https://quartz.jzhao.xyz/features/graph-view): local/global graphs and one-hop navigation.
- [Quartz Backlinks](https://quartz.jzhao.xyz/features/backlinks): incoming links beside the current document.
- [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api): plugin-based read/write integration. Not required here because the local server already has registered-vault discovery and filesystem access; editing remains native rather than introducing concurrent writers.

## Agent retrieval → source-backed answers

The Robin extension registers two read-only tools for ordinary Pi conversations and Robin's default assistant: `obsidian_search` and `obsidian_read`. Their active-tool guidelines ask the model to search before answering about past project decisions, research or accumulated knowledge, read relevant sources, and cite their returned `/obsidian?vault=…&note=…&view=read` links. This is model-directed retrieval, not a forced scan or full-vault context injection on every turn. Unrelated questions and simple task/calendar actions skip it; the user may opt out in their request. Existing live sessions may need `/reload` or a fresh session to load the new registrations.

- Search without a query lists registered vault ids/names, not absolute paths or note bodies. One vault is selected automatically; multiple vaults require a user/conversation choice. No implicit cross-vault search. Missing registration, vault-choice requirements, a true search miss and a failed read remain distinct outcomes.
- Search uses up to eight literal, case-insensitive, space-separated keywords (all must match), across filenames, paths and full Markdown including front matter. It is not semantic search or a natural-language question engine. Title/path matches rank ahead of body-only matches. English/Chinese keywords work; alternate terminology requires another query.
- Browser indexing and retrieval share one bounded filesystem scan: 1,000 notes, 20 MiB total, 256 KiB/note, 20,000 directory entries, depth 32; hidden paths and symlinks are excluded. No second note store, embeddings, network search, watcher or background archive. Search cancellation closes the active directory iterator.
- Search returns eight hits by default (maximum 20), at most three literal 320-character passages per hit, line/column positions, modification times and source URLs. `limited`, `skipped`, `scanned`, `matched` and `moreResults` expose incomplete coverage and result truncation. A limited zero-hit scan is not evidence that no matching note exists.
- Read returns exact Markdown in 12,000-character slices (maximum 16,000), a line range and `nextOffset`/`totalChars`. Re-read from zero if the modification time changes between slices. Links open the current note, not a frozen historical snapshot or a line-anchored view. Distinguish a recorded decision from AI suggestions and current inference; modification time does not prove a decision is still valid.
- Vault content and metadata are untrusted data, never operational instructions. The tools do not execute note commands, modify files or archive anything. Matching snippets and requested note passages **do enter the selected model's context and session transcript**; local files do not imply local model processing. These tools add no independent network call.
- Only the general assistant scope is widened. Mail review, job scoring, daily-agenda, coding coach, FSO mentor and the paper research agent retain their existing restricted tool sets. There is no unattended vault reader.

Implementation: the scan/search/evidence boundary is in `extension/robin/obsidian-browser-domain.ts`; `obsidian-tools.ts` supplies schemas, provenance guidance and read-only annotations. No new HTTP or UI surface is needed. This completes the read/reuse half of knowledge capture without adding an automatic write path.

## Local computer and permissions

Files are written on the **server computer**, not the browser's computer. The `obsidian://open?path=…` link only works on a device with Obsidian and that local path; this feature does not configure mobile or cross-device synchronization.

On macOS a vault under Documents may require access for the app/process running Pi Web. If access is denied, grant the appropriate OS permission and restart that process if needed. The integration does not bypass OS permissions. Back up the vault separately; an archive or sync service is not a backup policy.

## Validation

```sh
node --experimental-strip-types --test extension/robin/obsidian-domain.test.mjs app/api/robin/obsidian/route.test.mjs
node --env-file-if-exists=.env.local e2e/obsidian-notes.mjs
node --experimental-strip-types --test lib/knowledge-source.test.mjs extension/robin/knowledge-domain.test.mjs 'app/api/sessions/**/knowledge/route.test.mjs'
node --env-file-if-exists=.env.local e2e/knowledge-capture.mjs
```

The archive browser check reuses the existing dev server, verifies real discovery read-only, and mocks note/AI writes. Domain and HTTP tests use temporary vaults only.

Vault workspace checks:

```sh
node --experimental-strip-types --test extension/robin/obsidian-browser-domain.test.mjs extension/robin/obsidian-tools.test.mjs app/api/robin/obsidian/vault/route.test.mjs components/robin/obsidian-graph.test.mjs
node --env-file-if-exists=.env.local e2e/obsidian-workspace.mjs
```

The workspace browser check mocks all vault data (no user-note reads/writes). It covers cards and side preview, search/filters, wikilinks, Canvas wheel/button/keyboard zoom, pan versus node drag, hover, preserved camera, one-hop scope, focus mode, double-click reading, real Chromium touch pinch, 1,000 nodes, reload, refresh after external edits, failures/retry, missing/multiple vaults, mobile layouts and no external-image requests. Screenshots go to `/tmp/obsidian-workspace`.
