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
node --experimental-strip-types --test extension/robin/obsidian-browser-domain.test.mjs app/api/robin/obsidian/vault/route.test.mjs components/robin/obsidian-graph.test.mjs
node --env-file-if-exists=.env.local e2e/obsidian-workspace.mjs
```

The workspace browser check mocks all vault data (no user-note reads/writes). It covers cards and side preview, search/filters, wikilinks, Canvas wheel/button/keyboard zoom, pan versus node drag, hover, preserved camera, one-hop scope, focus mode, double-click reading, real Chromium touch pinch, 1,000 nodes, reload, refresh after external edits, failures/retry, missing/multiple vaults, mobile layouts and no external-image requests. Screenshots go to `/tmp/obsidian-workspace`.
