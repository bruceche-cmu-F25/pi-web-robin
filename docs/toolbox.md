# Local toolbox

Open **Dashboard → Tools → Local toolbox** (`/tools`). The entry stays directly above Links; utilities do not get global navigation tabs. Dashboard remains selected on tool routes. The catalog includes **Speech to text**, linking to the existing `/recordings` workspace; its return link leads back to the toolbox. Existing recording URLs, saved audio and transcripts remain unchanged.

## Shipped tools

| Tool | Behavior | Processing location |
| --- | --- | --- |
| Speech to text | Opens `/recordings`: microphone capture/upload, saved originals, resumable long-audio transcription, editable/exportable TXT | Robin computer / existing offline Whisper |
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

**Not shipped:** Office-to-PDF, PDF-to-Word layout reconstruction, AI background removal or photo restoration. These were the dependency/quality caveats in the proposal, not pretend working buttons. The page explicitly discloses their absence. No tool falls back to a cloud provider.

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

The catalog opens first, with twelve borderless entries in three named groups: audio/video, images/documents, and text/data. A solid paper surface, generous spacing and thin group separators replace boxed cards, shadows and gradients. Existing clay/plum/fern theme colors appear only behind the small icons; ordinary text retains its contrast. Each entry pairs a decorative 24px outline icon with a name and short use-case description. Repeated counts, arrows, badges and processing-location footers are omitted; exact processing boundaries remain visible inside each workspace. Wide screens show four entries per group; narrower screens show two, without clipping labels.

Selecting a card reveals only that tool's workspace and focuses its heading. **All tools** returns to the catalog without clearing files, settings or results; it focuses the current card, labeled **Continue your work** when it contains content. The workspace stays mounted but hidden, preserving file inputs and previews. Choosing a different populated tool still confirms clearing; cancellation stays in the catalog. The return action is disabled during processing. Speech to text remains a native link protected by the existing unload guard. No new dependency, backend tool kind or persistent draft store is added.

UI tokens match the existing paper/straight-edge visual language. Controls are 44px, visible labels and keyboard focus are preserved, state does not depend on an animation ending, and reduced motion removes spinner/reveal/press animations and smooth scrolling. Small-screen tool selection focuses/scrolls to the working area; completion focuses the result heading without opening a mobile keyboard.

## Validation

```sh
node --experimental-strip-types --test components/robin/toolbox-browser.test.mjs extension/robin/toolbox-domain.test.mjs app/api/robin/toolbox/route.test.mjs extension/robin/local-transcription.test.mjs lib/i18n/registry.test.mjs
node_modules/.bin/tsc --noEmit
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/toolbox.mjs
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local --experimental-strip-types e2e/recordings.mjs
```

Pure/domain/API checks exercise generated PDFs and all media presets, Unicode/base64, archive names and contents, CSV quoting/injection protection, real macOS OCR of `fixtures/toolbox-ocr.png` (synthetic canvas text), cancellation/cleanup, validation and origin/body boundaries. Media/OCR tests skip only when their platform engine is absent. Whisper format/cancellation regression tests stub inference; a separate real local smoke check generated speech with macOS `say` and verified SRT timestamps and words using the installed checkpoint, with no paid call.

Browser checks exercise grouped cards, focused workspaces, returning/reopening without losing inputs/results, focus restoration, all twelve catalog icons, keyboard navigation to/from speech transcription, cancelled speech navigation preserving inputs/results, all eleven conversion surfaces, actual client-side outputs/downloads, clipboard, cancelled navigation, no-upload boundaries for browser tools, editable server results, cancellation, dark/light layouts and reduced motion. Server conversions are mocked there, not invoked on personal files. The original recording tests guard the neighboring utility and dashboard placement.
