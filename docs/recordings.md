# Recordings workspace

`/recordings` is reached from **Dashboard → Tools → Local toolbox → Speech to text**. The Dashboard tools entry stays directly above Links, after the learning panel; individual utilities live together in the toolbox rather than separate Dashboard entries or global navigation tabs. The recording page keeps Dashboard selected and returns to `/tools`. Existing `/recordings` links and saved recordings remain valid.

Record or choose audio, **Save audio**, then **Transcribe / resume**. Transcription uses **local OpenAI Whisper small on CPU**, not the OpenAI API. There is no API key, subscription requirement, per-minute API charge, or automatic cloud fallback. “Local” means the computer running Robin: accessing it from a phone still uploads the audio to that computer, not to a transcription provider.

## One-time setup

The server needs `ffmpeg`, `ffprobe`, and OpenAI's `whisper` CLI. On macOS:

```sh
brew install openai-whisper ffmpeg
node --experimental-strip-types scripts/setup-local-transcription.ts
```

On other platforms install `openai-whisper` in a suitable Python environment and ensure its `whisper` executable and ffmpeg/ffprobe are on the server's PATH. `ROBIN_WHISPER_BIN` can point to the executable explicitly. The downloader is run from this project directory on the server; the browser never executes shell commands.

The setup script downloads the multilingual **small** checkpoint (~461 MiB) from OpenAI's model registry URL, pins/verifies its SHA-256, fsyncs a temporary file and renames it only after validation. The model lives at `ROBIN_DATA_DIR/models/whisper-small.pt` (default `~/.pi/robin/models/whisper-small.pt`). Re-running setup verifies/reuses the existing checkpoint. Setup downloads model weights only; it never reads or sends audio. A hard-killed download can leave a uniquely named `.download` file, which is never treated as a ready model; inspect/remove that incomplete file before rerunning if disk space is tight.

Readiness checks the local executable and model presence. Missing setup has an explanation next to the disabled transcription button and a button to focus the setup instructions. Refresh after installing. No cloud settings are read or changed by the recordings domain/page; existing Telegram voice-note settings remain independent and unchanged.

## Behavior and limits

- Maximum 100 MiB / two hours per recording. Supported containers: MP3, MP4/M4A, WAV, WebM, Ogg, FLAC and AAC. No silent truncation. These are microphone recordings, not system/meeting-tab audio capture.
- Zero completed segments is no transcript yet, not a partial transcript. Each completed segment is saved; text is editable after all segments finish, and partial text can already be copied/downloaded. Save changes is explicit; stale revisions never overwrite newer work. Delete confirms removal of original audio, chunks and transcript.
- A successful empty Whisper output is a completed silent segment, not a permanent retry loop. If the whole recording has no detected speech, the page says so instead of inventing words.
- CPU processing can take several minutes per ten-minute segment, depending on speech and hardware. Keep the page open and computer awake. Stop-after-segment preserves the current result and starts no more work. There is no automatic transcription on upload or readiness check.
- Browser recording needs HTTPS or localhost. Permission failures still allow upload. Pause/resume and stop release capture correctly. Mobile background recording is not guaranteed. Five-second IndexedDB drafts are recovered where storage is available; Web Locks prevent tabs from mixing/clearing the same draft. Without locks/storage, audio stays in memory with a warning. Sudden browser termination can lose the latest chunk; download important recordings. Draft clearing requires a confirmed server save or explicit discard.
- No speaker diarization, summaries, word timestamps, Notion writes or background capture. Ten-minute split boundaries may interrupt a word; review the transcript against the original. Language is detected by Whisper; the task is transcription, not translation.

## Interaction and motion

- Ready local setup collapses to a compact native disclosure; missing setup remains expanded. The explicit setup link opens and focuses it, and a successful readiness check returns focus to its summary. Consent remains visible by the recording controls.
- Capture/upload feedback stays in the capture card; segment status/errors sit beside transcription controls; edit/copy results sit beside the editor actions. Completion, stop-after-segment and unsaved edits have explicit text. Permission waiting, live recording, pause and draft preparation are distinct; the timer is not a live region announcing every second.
- The accessible progress bar counts **persisted segments**, never invented within-segment percentages. Its fill transitions only on saved progress; switching recordings resets the bar's identity, not the player on each progress update. Stop waits for the current segment, disables further stop clicks and retains saved parts.
- An explicit save reveals/focuses the transcript; selecting a library item does so on mobile. A segment arriving never scrolls or steals focus. Cancelling the unsaved-text confirmation preserves the draft and selection.
- CSS-only 100–320 ms press/reveal/progress feedback, with a live recording dot and a working indicator. Pause stops the recording pulse. `prefers-reduced-motion` removes scoped animation/transitions and smooth scrolling without hiding status; no animation dependency or animation-end-driven state. Native file input, 44px actions, visible keyboard focus and theme tokens are retained.

## Implementation and recovery

- `extension/robin/recordings-domain.ts` owns persistence and resumability; `recordings.ts` is the client-safe contract. `local-transcription.ts` owns executable/model checks and CLI invocation. The old cloud transport remains for Telegram only and is not a fallback here.
- Original audio, ten-minute MP3 chunks and `recording.json` live under `ROBIN_DATA_DIR/recordings/<uuid>/`. Directories are 0700; originals/metadata are 0600. This domain is outside task SQLite. Back up recordings separately; model weights can be downloaded again.
- Upload is bounded before multipart parsing (including chunked requests). It buffers up to 100 MiB; not intended for unbounded/high-concurrency uploads. FFmpeg is invoked without a shell, bounded to three minutes, restricted to audio demuxers and file/pipe protocols, and decodes at most one extra minute to detect over-duration audio. Only our re-encoded MP3 reaches ffprobe. Invalid uploads are removed. A process kill during preparation may leave an unpublished directory with no `recording.json`; inspect it before removal.
- One POST to `/api/robin/recordings/<id>` runs the next incomplete segment. The page submits sequentially. Whisper gets an explicit local checkpoint path (never a model name that could trigger a download), four CPU threads, FP32, greedy decoding and no previous-text conditioning to reduce repetition loops. Its child environment contains basic runtime/path/locale variables, not provider keys or the web password.
- Each child has a 30-minute hard timeout; the per-recording ownership lease is 31 minutes and the route's deployment duration is 1860 seconds. Host/proxy timeouts may be shorter and must be configured for long local requests. Successes are published before the next request, never repeated. Reload reads saved progress; a lost response can be resumed without repeating a published chunk. A crash before publication can require rerunning only that unfinished chunk. Never start automatic retries.
- Stale owners cannot publish over newer owners; delete/edit share the metadata lock and revision checks. Inference never runs under that lock. After a server crash, wait for the lease to expire before resuming an unfinished segment.
- Each CLI call has a private fresh temporary output directory; nonzero exit, timeout, missing output (Whisper can catch an exception and still exit zero), or oversized output all fail without changing completed parts. Temporary output is removed on normal completion/error. Child logs/audio text are never echoed into error responses.
- Audio GET supports ranges for seeking, no-store and nosniff. Existing host/origin/site-password guards remain in place. Transcribed text is never executed or automatically sent to an assistant.

## Related utility

**Dashboard → Tools → Local toolbox → Subtitle generator** (`/tools`) generates real SRT/VTT timestamps from uploaded audio/video using the same offline checkpoint. Existing recordings keep their resumable TXT workflow; text-only saved transcripts do not contain timing and are not silently converted into guessed subtitles. See [Local toolbox](toolbox.md) for its separate limits and ephemeral processing.

## Checks

```sh
node --experimental-strip-types --test extension/robin/local-transcription.test.mjs extension/robin/recordings-domain.test.mjs app/api/robin/recordings/route.test.mjs scripts/telegram/bridge.test.mjs
node_modules/.bin/tsc --noEmit
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/recordings.mjs
```

Domain/API tests use temporary data and synthetic PCM; media preparation tests skip if ffmpeg/ffprobe are absent. Inference is stubbed in regression tests, which never download a model or make paid calls. They cover offline invocation, missing dependencies, no output, silence, timeout, cleanup, stale owners and resuming progress. Browser tests use mocked APIs and a synthetic microphone, including missing/ready local setup, absence of a key form, dashboard navigation, delayed progress and safe stop, reduced motion, mobile/keyboard focus, cancelled unsaved edits, inline errors, editing/export, draft recovery, and responsive Chinese/English layouts from 320px. A real local smoke check on the development Mac used synthetic spoken audio and the downloaded small model; accuracy on actual recordings still requires review.
