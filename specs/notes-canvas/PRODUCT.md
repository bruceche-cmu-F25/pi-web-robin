# Notes Canvas

## Summary
Notes gains independent, named whiteboards in its left-hand library, alongside Markdown drafts. The user confirmed separate canvases and the existing Notes visual style, rather than a canvas attached to every note.

## Figma
None provided; retain Notes' paper/grid ground, square controls, serif headings and token-based light/dark colors.

## Behavior
1. The left library has a Canvas section with New, named boards, selection, and confirmed deletion. Multiple boards coexist with Markdown drafts; creating or deleting one does not change notes.
2. Selecting a board opens it in Notes. Its URL identifies the board, and reload/back/forward restore the selection. A missing board shows an error, never a replacement empty board.
3. A board supports infinite pan/zoom, editable text, sticky notes, rectangles/ellipses/diamonds, arrows/lines, free drawing, images, selection/multi-selection, moving/resizing, and undo/redo. A sticky-note action inserts a filled rectangle with editable text. Space-drag pans; the editor supplies its keyboard help and zoom controls.
4. Boards have editable titles. Edits and images save automatically to the local application's server, independently per board. Loading, unsaved, saving, saved and failure states are visible. A failure retains the current drawing and offers retry; it must never be shown as saved.
5. Switching boards or returning to a note waits for pending saves. A failed save keeps the current board open. Closing/reloading with unsaved changes triggers the browser's warning. Large boards are bounded at 16 MiB and excessive size is reported without replacing saved content.
6. Concurrent tabs must not silently overwrite one another. An outdated revision stops saving and explains the conflict; the user can export the current drawing before explicitly reloading the server version.
7. The editor offers local file import/export and image export. It does not provide cloud publishing, real-time multiplayer, or automatic Notion archiving. Imports replace the current board's contents, not other boards.
8. Desktop retains the collapsible library and right-side Agent. The Notes header also toggles the Agent for both notes and canvases; folding releases its column without discarding the typed message or interrupting a reply. On narrow screens the existing library / document / Agent tabs remain regardless of desktop folding, and canvas state survives tab changes.
9. The Agent receives the current board's text and element/connection positions, clearly identified as canvas data. It is told that images are not included in that textual snapshot and cannot claim to see their contents. A reply can be explicitly inserted as a sticky note. The Agent does not edit the board autonomously.
10. Existing note editing, attachments, saving, Notion filing and note conversations continue unchanged. Canvas conversations are separate from notes and from other boards.
11. The editor's Library is a shared, reusable asset collection, distinct from the left-hand list of boards. Users can browse official Excalidraw Libraries and confirm imports back into the selected board, or use native library file import/export. Added and removed assets persist on the local application server across reloads and boards; deleting a board does not delete assets. Library saves have the same retry, conflict and navigation protections as drawings. The library is bounded at 16 MiB, 1,000 items and 10,000 elements; embedded pages and images are not supported in library items.
12. Toolbar actions have accessible labels, keyboard focus indicators and translated English/Chinese chrome. Default canvas text and sticky notes use Notes' body serif font stack, including Chinese fallbacks, consistently while editing, drawing and exporting SVG/images. Existing default-font objects adopt the same typography; explicitly chosen/imported alternative fonts are preserved. The drawing editor provides its own keyboard controls; no new motion is required. Embedded external web pages are disabled.
