# Local toolbox

Open **Dashboard → Toolbox** (`/tools`) from the header shortcuts. Utilities do not get global navigation tabs. Dashboard remains selected on tool routes. The catalog includes **Speech to text**, linking to the existing `/recordings` workspace; its return link leads back to the toolbox. Existing recording URLs, saved audio and transcripts remain unchanged.

## Shipped tools

| Tool | Behavior | Processing location |
| --- | --- | --- |
| Speech to text | Opens `/recordings`: microphone capture/upload, saved originals, resumable long-audio transcription, editable/exportable TXT | Robin computer / existing offline Whisper |
| Video summary | Opens `/tools/video-summary`: YouTube URL, public captions, saved bilingual AI summary and timestamped points, Markdown export | YouTube + configured AI model (quota/API billing) |
| Audio | MP3/M4A/WAV/FLAC conversion, bitrate presets, time-range trimming; accepts video to extract sound | Robin computer / FFmpeg |
| Video | MP4 720p/1080p compression, time-range trimming, mute, 480px/12fps GIF | Robin computer / FFmpeg |
| Images | PNG/JPEG/WebP conversion, maximum-edge resizing without upscaling, centered 1:1/16:9 crop | Browser |
| PDF | Merge in file order, extract/reorder with page ranges, split selected pages to ZIP, rotate selected pages while keeping the others | Browser |
| Subtitles | SRT/VTT with Whisper's real timestamps; text may be corrected before downloading | Robin computer / existing offline Whisper |
| OCR | Chinese/English PNG/JPEG recognition, up to ten images sequentially; editable combined text | Robin computer / macOS Vision |
| Text | One explicit operation: deduplicate lines, remove blank lines, trim whitespace, unwrap paragraphs, CJK/Latin spacing | Browser |
| Rename | Preview literal replacement and `{name}`/`{n}`/`{date}` templates, reorder files, download renamed copies as ZIP | Browser |
| QR | Generate text/URL or Wi-Fi PNG; decode an uploaded image to text, never auto-open links | Browser |
| Developer | JSON format/validation/minify, bounded line diff, URL and UTF-8 Base64 conversion, explicit seconds/milliseconds/ISO timestamps | Browser |
| CSV | CSV/TSV/flat-object JSON conversion, column selection/order, duplicate-row removal, first-20-row table preview | Browser |

**Not shipped:** Office-to-PDF, PDF-to-Word layout reconstruction, AI background removal or photo restoration. These were the dependency/quality caveats in the proposal, not pretend working buttons. The page explicitly discloses their absence. Conversion tools never fall back to a cloud provider; Video summary explicitly uses the configured AI model.

## Behavior and limits

- Drag/drop or native file input replaces the list. Multi-file tools offer up/down and remove buttons; PDF merging honors this visible order. Run is explicit; neither selecting files nor editing settings uploads anything.
- Conversion tools never rename, overwrite, delete, or place original files in the recordings library. Their results are in-memory browser blobs, not persistent history. Speech to text opens the existing persistent recording workflow separately. Download to retain them. Switching/clearing populated tools asks for confirmation; cancelling keeps inputs/results. Leaving a populated or running page has a native unload guard. Ordinary browser refresh still loses inputs if the warning is accepted.
- Controls are disabled while processing. Local requests have Cancel, an AbortSignal propagated to child processes, and no automatic retries. A server may take a short time to finish killing/cleaning a cancelled job; a retry during that window can return busy. No hidden background queue or invented percentage progress. OCR reports the current image count.
- The browser-only tools never send their files/text to an API. Audio/video/subtitles/OCR upload only to the computer hosting Robin, which can be a different computer from the browser/phone. Temporary data is removed after success/failure/cancellation. A hard process crash can leave a private directory; the next local job removes abandoned directories older than 24 hours. This is not a promise of timed cleanup while Robin is stopped.
- Media upload limit is 100 MiB; output limit 200 MiB. Reject unknown duration, sources longer than two hours and oversized video dimensions. Audio range max two hours; video range max 30 minutes; GIF range max 30 seconds; subtitles range max 20 minutes. If the source is too long, choose an explicit shorter range; never silently truncate it. Some duration-less WebM recordings must first be remuxed with a duration. Compression may increase already-small files. Video mute also re-encodes to at most 720p, as labeled.
- Subtitle timestamps start at zero for the chosen clip, not the original file's trim offset. Existing saved TXT-only transcripts do not contain time alignment; generating subtitles is a new local inference, not fabricated timing. Inference has the existing 30-minute timeout, and media conversion has a ten-minute timeout. Host/proxy limits may be shorter; keep the page open and computer awake. Use `/recordings` for long resumable text transcription.
- Images: 20 MiB, 24 megapixels, 8192px per input side. Output edge 64–4096px. Browser-decodable formats only; animated input becomes one still, metadata is not retained, JPEG composites transparency on white. Unsupported encoders fail instead of silently giving PNG a WebP extension.
- PDF: 30 inputs, 50 MiB total, 1000 pages, split limited to 200 outputs. Page selections are 1-based and can descend or repeat (`3-1,2`); invalid selections fail. Encrypted PDFs are rejected. Modifications invalidate signatures; forms, links, bookmarks and accessibility structure are not promised to survive page copying. The original remains untouched for comparison.
- OCR: macOS Vision via the system JXA bridge (`osascript`), **not Swift**. This avoids requiring a working Swift SDK; the development machine's Swift SDK had duplicate module-map errors. The script does not control other applications. Browser-normalized PNG is validated again server-side by signature/IHDR and dimensions; 20 MiB / 24 megapixels each, ten files, 100 MiB total, output at most 2 MiB. No scanned-PDF input or Linux/Windows OCR backend yet. Capability checks report macOS/system bridge availability, not a guarantee that every OS image will recognize successfully.
- Text/CSV: two million input characters. CSV requires rectangular rows; JSON needs unique non-empty headers, supports only flat objects, and emits string values. At most 10,000 data rows and 200 columns; oversized input fails rather than truncates. The shared CSV parser is deliberately lenient about malformed quotes; review imported data. Spreadsheet formula escaping is on by default for CSV/TSV, optional and explicit; JSON values are unmodified. JSON formatting follows JavaScript number precision; quote large integers to preserve them.
- Rename: 100 files / 50 MiB, extensions retained, path separators/control characters sanitized, case-insensitive collisions rejected. ZIP uses stored entries for bounded work, never a filesystem rename. A dated name uses the browser's local date. Downloads from PDF splitting/renaming are limited to 100 MiB total uncompressed data.
- QR content max 1500 UTF-8 bytes. Wi-Fi passwords remain in memory and in the resulting image, so treat that image as a credential. Decoded URLs are plain text and are never fetched or executed.

## Implementation boundaries

`extension/robin/toolbox-domain.ts` owns server jobs, validation, isolated temporary directories and cleanup; `/api/robin/toolbox` is its host/origin-protected HTTP adapter. Multipart bytes are bounded before parsing, including chunked bodies. Only one local toolbox job per Web process is allowed; multi-process hosting would require an OS-wide lease. This semaphore does not serialize the separate recordings workspace. Temporary files live under `ROBIN_DATA_DIR/toolbox-tmp/job-*`, outside task SQLite; capability reads and jobs do not touch cloud settings.

Subprocesses use `execFile`, fixed argument lists and a minimal environment without API keys/web passwords. FFmpeg/ffprobe disallow playlist/image/concat demuxers and network protocols; metadata/chapters are stripped and only explicit audio/video streams are mapped. Processing, output bytes, input dimensions and parser allocations are bounded, but these codecs are not a security sandbox: keep local media tooling patched and don't expose Robin as an anonymous public converter. Temp directories are private and user filenames are never server paths. HTTP output is an attachment with no-store/nosniff; there is no public download filesystem route.

`components/robin/toolbox-browser.ts` owns browser transforms; `ToolboxWorkspace.tsx` owns presentation. Libraries are imported lazily on first use: `pdf-lib` for a real PDF parser/writer, `fflate` for ZIP, `qrcode`/`jsqr` for QR generation/recognition, and `diff` for bounded line comparison. These formats have no sufficient cross-browser native API; do not replace them with hand-written encoders. Versions are pinned. Existing CSV parsing, native Canvas/Blob/download APIs and current FFmpeg/Whisper are reused.

The catalog opens first, with fourteen rounded cards in four named groups: this Mac, audio/video, images/documents, and text/data. The Mac entry links to the separate monitor/cleanup workspace, without starting scans here. A 24px rounded title/search surface and 16px tool cards sit on the theme ground with the existing subtle shadow. Catalog and workspaces share vivid teal/orange/purple/blue category colors: solid icon tiles, 3px top borders and short heading markers. Text retains its theme contrast; there are no gradients, moving hover effects or extra polls. Hover/press emphasize the border, keyboard focus uses a visible category-colored ring, and resumed work retains its explicit label. Each entry pairs a decorative 24px outline icon with a name and short use-case description. Repeated counts, arrows, badges and processing-location footers are omitted; exact processing boundaries remain visible inside each workspace. Wide screens show four entries per group, intermediate screens two, and phones up to 480px a single compact icon/title/description row per tool. The lone Mac entry uses the full available row instead of leaving three empty columns. Search filters localized names, short descriptions and tool ids in memory (case-insensitive, NFKC-normalized), with a result count, empty state and clear action; it never runs a job or uploads content.

Selecting a card reveals only that tool's workspace and focuses its heading. **All tools** returns to the catalog without clearing files, settings or results; it focuses the current card, labeled **Continue your work** when it contains content. The workspace stays mounted but hidden, preserving file inputs and previews. Choosing a different populated tool still confirms clearing; cancellation stays in the catalog. The return action is disabled during processing. Speech to text remains a native link protected by the existing unload guard. No new dependency, backend tool kind or persistent draft store is added.

The working view has one primary tool title, without repeating the catalog masthead. Source and processing options use two columns when the workspace itself is at least 720px wide (a CSS container query), and stack otherwise. OCR has no empty options column. The large drop target retains a native, labeled, keyboard-focusable file picker; selecting/dropping replaces the list, not the originals. All format/size/processing-location caveats remain visible. Download/copy actions sit beside the result heading, before the potentially long editable output. An unavailable clipboard reports manual-copy/download alternatives without discarding the result.

The working view and catalog intentionally use the same vivid category palette. Per the requested tool-specific treatment, audio/video uses saturated orange, images/documents purple, and text/data blue. Local light/dark color pairs style the title icon, upload icon/border, section markers, solid primary action, focus ring and result border without changing global theme tokens. Source, options and results are independent 16px cards on the theme's ground, using shared panel/shadow tokens; controls and upload areas use the 8px control radius. Options keep their natural height instead of stretching into an empty card; the file drop area fills available source space. Error/warning states still use semantic colors and explicit text. Recordings uses the same orange family and rounded capture/editor/setup surfaces; Mac uses teal primary actions, separate rounded metric cards, disk/directory/cache cards and a 24px confirmation dialog. Neither recording behavior nor monitoring/cleanup logic changes. Catalog cards remain rounded on phones, with compact icon/title/description rows. Controls are 44px, fields at least 16px, labels and keyboard focus are preserved. Pointer hover is fine-pointer-only, press feedback changes color without moving controls, and results no longer animate in. Only active processing uses a spinner, disabled under reduced motion. Small-screen tool selection focuses/scrolls to the working area; completion focuses the result heading without opening a mobile keyboard. No animation library, additional polling, conversion engine or backend change was introduced.

## Video summary pipeline

`/tools/video-summary` is a separate **Video summary / 视频总结** card in the audio/video group. Its input is prefilled with the requested `67BmkptgTms` example; neither opening the page nor choosing the example submits it. Unlike the conversion tools, this explicitly uses the configured AI model's quota/API billing. Catalog assurance copy calls out this exception.

An explicit submit runs **video info → captions → AI summary → save**, with real stage events over NDJSON, not fabricated percentage progress. The tool accepts HTTPS YouTube watch/share/shorts/live/embed URLs only, extracts a strict video id and constructs its own requests; it never fetches the supplied URL or its extra parameters. Missing, empty or unavailable captions fail before model work, with no description-only fallback. It does not download video, run Whisper automatically, analyze visual content, create tasks, or send notifications. Caption input is capped at 360,000 characters; this tool refuses oversized new transcripts rather than summarizing only the beginning.

The server reuses `podcast-scan.ts`'s request bounds, shared per-video renewable lease, in-flight join and completed-summary cache. The paid adapter is an isolated one-shot `runScopedAssistantTurn` with **zero tools** and a four-minute model deadline. Metadata and captions are untrusted source data. Title/author and the bilingual summary commit together under the existing ownership fence in `podcasts.json`; no task-storage migration or separate job store. The shared listening shelf still works. Older cached partial summaries remain explicitly marked partial; old records without metadata display the video id rather than guessing a title. Timestamps locate supplied minute-sized transcript paragraphs; unknown/model-invented positions become unstamped points, not citations. Summaries are AI interpretations, not verified claims.

GET reads the latest 50 saved summaries (including those from the listening shelf); it starts no network/model work and does not delete older records. The UI preserves a confirmed result on history read failure, guards duplicate submission synchronously, and offers source/time links, copying and Markdown export. It shows caption/automatic-caption and non-visual limitations. Failed input remains available for correction. Closing/disconnecting the tab stops progress display, **not** an already-submitted paid run; a completed result can be found by refreshing history. There is no automatic retry, durable failed-run queue, or multi-process exactly-once promise. The client bounds its stream to 256 KB / 320 seconds; a timeout tells the user to check history before retrying.

Checks: `extension/robin/video-summary.test.mjs` covers URL boundaries, real stage ordering, metadata+summary publication, cache reuse, in-flight joining, hallucinated times, empty/missing/oversized captions and invalid model replies. `app/api/robin/video-summary/route.test.mjs` covers origin/JSON/body bounds, read-only history, streamed errors and the zero-tool deadline. `e2e/video-summary.mjs` uses synthetic fixtures only, checking the searchable catalog link, explicit submit, duplicate guard, failure recovery, source/time links, Markdown download, retained receipts after failed reads, bilingual copy and four palettes at 320/390/812/1440px. The supplied real video was also processed successfully through the live API, producing eight saved timestamped bilingual points; fixture/browser tests themselves never spend tokens. Physical phone/Safari behavior is unverified.

## Validation

```sh
node --experimental-strip-types --test components/robin/toolbox-browser.test.mjs extension/robin/toolbox-domain.test.mjs app/api/robin/toolbox/route.test.mjs extension/robin/local-transcription.test.mjs lib/i18n/registry.test.mjs
node_modules/.bin/tsc --noEmit
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/toolbox.mjs
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/recordings.mjs
```

Pure/domain/API checks exercise generated PDFs and all media presets, Unicode/base64, archive names and contents, CSV quoting/injection protection, real macOS OCR of `fixtures/toolbox-ocr.png` (synthetic canvas text), cancellation/cleanup, validation and origin/body boundaries. Media/OCR tests skip only when their platform engine is absent. Whisper format/cancellation regression tests stub inference; a separate real local smoke check generated speech with macOS `say` and verified SRT timestamps and words using the installed checkpoint, with no paid call.

Browser checks exercise grouped cards, focused workspaces, returning/reopening without losing inputs/results, focus restoration, all thirteen catalog icons, keyboard navigation to/from speech transcription, cancelled speech navigation preserving inputs/results, all eleven conversion surfaces, actual client-side outputs/downloads, clipboard, cancelled navigation, no-upload boundaries for browser tools, editable server results, cancellation, dark/light layouts and reduced motion. Server conversions are mocked there, not invoked on personal files. The original recording tests guard the neighboring utility and dashboard placement.

The UI follow-up reran the complete Toolbox browser script plus 11 browser-helper,
locale and navigation unit checks, full TypeScript checking and targeted ESLint.
New browser assertions cover search/empty states, bilingual queries, one workspace
title, source/options reflow, keyboard file selection and its visible focus ring,
long filenames at 320px, top-aligned result actions, unavailable clipboard, engine
recheck preserving files, and Wi-Fi QR generation/decoding. Dark/light viewport
checks cover 320, 375, 844 and 1440px; sampled catalog text remains ≥4.5:1 contrast.
The rounded/color follow-up checks computed 16px source/options/result radii and
8px controls across all eleven inline tools in light/dark mobile/desktop layouts,
with primary-color saturation ≥65% and enabled primary text contrast ≥4.5:1.
The complete recordings and Mac browser regressions were also rerun with computed
card/button/dialog styling checks. Recordings uses synthetic microphone input and
mocked APIs; Mac reads live metrics once, then mocks all scan/cleanup operations.
The recordings test's obsolete Dashboard Tools row was updated to the existing
header shortcut; no Dashboard behavior was changed here. Server conversions are
mocked and files are synthetic. Real phone/Safari behavior remains unverified.

The catalog follow-up additionally checks all thirteen actual 16px card radii,
24px title/search surface, four distinct saturated category colors, matching top
borders, icon contrast ≥4.5:1 and visible keyboard rings in both light/dark themes.
Search, retained work, keyboard navigation and all eleven conversions still run
through the complete browser regression. The change is CSS-only in production;
no dependencies, backend behavior or persistent data were changed.
