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

No automatic migration of existing Notes, Product ideas, FSO notes or Notion pages occurs. Task status, progress and product stages remain in Robin. There is no vault search or two-way editing in this version. Archive links are creation receipts, not a live file index: renaming or moving a file in Obsidian does not update its link in Robin.

## Conversation → linked knowledge

The conversation toolbar's **Capture knowledge / 沉淀到知识库** action is a separate workflow from draft archiving. It never deletes a draft or modifies the source session.

1. Select the current branch's entire conversation, last 12 text messages, or last 4. Check the expandable source before sending it to the chosen model. Sources over 80,000 characters are refused, not silently truncated.
2. Choose the registered vault, project name and model. Only user/assistant text from that ancestor chain plus a bounded catalog of vault filenames is sent. Thinking, tool results, system/custom messages, images, sibling branches and existing note bodies are excluded. The catalog skips hidden/symlinked entries and stops at 200 Markdown files or 5,000 directory entries.
3. A tool-free, one-shot model call proposes 1–5 ideas, decisions, architecture notes, progress snapshots or summaries. Suggestions must remain distinguishable from confirmed decisions; reported progress is not verified live state. Model output can cite known message/note IDs, never choose arbitrary filesystem paths.
4. Review each new note or append-only supplement, its destination, project entry page, explicit `[[links]]`, provenance and (for supplements) the unchanged existing text. Confirmation saves the stored proposal, not a second generation. The first version saves all proposed notes together; go back and prepare again if the proposal is unsuitable.
5. Open saved notes in Obsidian, or find their links in Notes' existing archive list. Native backlinks and Graph View connect them through the project entry page and suggested relationships. No separate graph database or embedded graph is introduced.

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

The browser check reuses the existing dev server, verifies real discovery read-only, and mocks note/AI writes. Domain and HTTP tests use temporary vaults only.
