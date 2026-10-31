# Robin voice — local dictation

## Current scope

**Speech input runs on the Robin host with whisper.cpp. No cloud speech key is needed.** Phones and other computers record in their browser and upload to the existing authenticated Robin HTTPS endpoint. Two explicit destinations share one capture UI:

- **Talk to Robin / 跟 Robin 说**: a dedicated microphone beside the desktop Dashboard search/Act bar and in the phone header. Tap starts recording immediately; **Done speaking**, a hold/release, or the time limit only transcribes into a visible editable draft. The user must click **Confirm and send** to send the edited text to the **existing default Robin conversation** (`POST /api/robin/assistant`). Closing/reopening retains that in-memory draft without opening the microphone again; explicitly recording more appends rather than replacing corrections. Clearing all text leaves the field editable and Send disabled. This is page-lifetime state, not crash/navigation recovery. No second agent, new mode, tool expansion or separate memory. The working/result state and actual execution-record link remain visible. Closing this UI never cancels/undoes or automatically retries a dispatched turn; failed/uncertain responses direct the user to the execution record.
- **Dictation**: microphones in Dashboard Search/Act, Cmd/Ctrl+K, shared `AgentPanel` and main `ChatInput` use the same tap/hold capture but only insert text into their existing draft. Search never executes. Chat preserves current selection, attachments, undo and draft persistence; sending, commands, IME, session/cwd changes and unmount invalidate pending recognition. The owning panel's original endpoint/model/tool scope stays unchanged.
- Main Chat's dictation uses a **compact inline capsule beside the existing composer**, not the floating voice dialog: cancel, actual left-moving volume history and stop-to-transcribe. It does not blur a focused textarea, replace its DOM or move the original held trigger. Success inserts through the existing selection/undo/attachment-safe path, releases the voice layer and removes the bar; a live-region receipt says text was inserted, never a lingering “microphone off” success panel. Errors remain inline with retry and a settings link. The original Send button remains the explicit submission step; no arrow that silently sends unreviewed recognition. Dashboard's standalone entry now also requires separate text review and Send; other dictation destinations keep their original draft/endpoint.
- Custom panels, the research thread and compact quote-question composer remain **not integrated**.
- **Gesture rules**: short tap latches recording; another tap finishes. A ≥300 ms hold with known permission finishes on release. Moving up ≥64 px changes the visible instruction to **Release to cancel**. A visible Cancel button and Escape are non-gesture alternatives. First/unknown permission, or release before permission resolves, always stays in tap mode; no permission-dialog release can authorize submission. Pointer cancellation/lost capture cancels, never sends. Repeated keyboard events and trailing native clicks do not duplicate dispatch.
- A nonmodal manual popover keeps the held trigger interactive. Phones get a bottom panel, desktop a compact floating panel; older Safari gets a fixed fallback inside the owning dialog/body. Opening does not focus a text field. **Listening** appears only after MediaRecorder starts; real Web Audio level bars and elapsed time distinguish capture from recognition/agent work. Float32 RMS from a 1024-sample window maps -60 to -20 dBFS onto a visible envelope, with 120 ms attack / 240 ms release. Nine small mirrored rounded bars in the floating panel show the recent level spreading from the centre (a stylized level indicator, not a spectrum). Only transforms/opacity change outside React; silence settles to dots, reduced motion keeps dots stationary and changes opacity. No decorative looping waveform. Another panel claiming the microphone dismisses the old voice panel.
- **Visuals**: the floating panel is a compact capture row (cancel, central listening/status + real level indicator, 44px stop), not a large titled sheet with a second full-width record action. Recognition has three small opacity-only progress dots, stationary under reduced motion; these indicate processing, never microphone level. Review shows an unboxed 16px textarea and explicit Send; long results scroll within a bounded area. Voice options contains privacy, settings and optional TTS controls, absent during capture. The panel reuses Glass / Dark glass's overlay tint, CSS frost, directional thin rim and shadow tokens; foreground text stays unfiltered. There is no nested blur or fake looping audio waveform. Ordinary themes remain opaque; reduced transparency, high contrast and forced colors restore solid surfaces and defined borders. This is the shared web material, not a claim of native Apple refraction.
- Up to 60 seconds. The time limit is **not** consent to send: it produces a reviewable draft, with explicit Confirm and send for the global entry. Near-digital-silence audio is rejected before ASR (not a general VAD/speech detector). No auto-stop on pauses, live partial recognition, wake word or full duplex.
- Optional Beijing DashScope TTS remains explicit and hidden when unconfigured. A separate checkbox opts into spoken excerpts when Send is clicked; no paid call was made for this change. Semantic spoken rewriting and a durable device-wide speech preference remain unimplemented.

## Install once on the host

The development Mac has **whisper.cpp 1.9.5** and the verified multilingual **Small Q5_1** model installed. Nothing needs installing on client devices apart from access to the private network when using Tailscale.

For another Mac:

```bash
brew install whisper.cpp
mkdir -p "$HOME/.pi/robin/models"
cd "$HOME/.pi/robin/models"
curl --fail --location --output ggml-small-q5_1.bin.part \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin
printf '%s  %s\n' \
  ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb \
  ggml-small-q5_1.bin.part | shasum -a 256 -c - && \
  mv ggml-small-q5_1.bin.part ggml-small-q5_1.bin
```

The model is 190,085,487 bytes; Homebrew runtime/dependencies are additional. Do not use an English-only `.en` model or a Python `.pt` checkpoint. There are no model downloads at request time.

Defaults: find `whisper-cli` on PATH, then `/opt/homebrew/bin/whisper-cli` or `/usr/local/bin/whisper-cli`; load `~/.pi/robin/models/ggml-small-q5_1.bin` (`ROBIN_DATA_DIR` relocates the data directory). Optional server-only overrides:

```dotenv
ROBIN_VOICE_WHISPER_BIN=/absolute/path/to/whisper-cli
ROBIN_VOICE_WHISPER_MODEL=/absolute/path/to/ggml-small-q5_1.bin
```

These are separate from the long-recordings/Telegram Python Whisper adapter's `ROBIN_WHISPER_BIN`; that adapter and its model remain unchanged. Environment changes require reloading the existing server; do not start a second dev instance. Installing the default binary/model needs no environment edit: **Check configuration** rechecks their presence.

`GET /api/robin/voice` returns `configured` (local microphone engine/model presence), `ttsConfigured` (optional cloud configuration presence), and public engine names. Presence is not an inference, permissions, model-integrity or balance test. No private paths/keys are returned.

## Phone / other computer

1. Keep the Mac awake, online and Robin running.
2. For the existing private Tailscale HTTPS Serve entry, connect the other device to the same authorized tailnet; access rules must permit this Mac. Open the **existing Robin HTTPS URL**, not `localhost`, a LAN HTTP address, or a Whisper port. This does not enable public access or change Tailscale configuration.
3. Sign in with the existing Pi Web password. Allow microphone access in Safari/Chrome and keep the page in the foreground.
4. Tap **Talk to Robin** to record, finish, review/edit the transcript, then explicitly send; or use a field's **Dictate** microphone to fill its draft. No model or speech API key belongs on the phone.

Each capture obtains one stream; re-entrant starts during permission/recording/transcription are ignored. Finishing or cancelling still releases the microphone, never keeps it live just to suppress prompts. Safari's per-site Microphone → Allow can reduce repeated prompts; private browsing and Home Screen web apps may not retain/inherit that preference, and a website cannot grant itself persistent permission. See [WebKit capture controls](https://webkit.org/blog/7763/a-closer-look-into-webrtc/) and the [reported standalone persistence limitation](https://bugs.webkit.org/show_bug.cgi?id=280394). **Settings → Voice & microphone** (`/dashboard/settings#voice`) contains this guidance, browser permission status, HTTPS/support checks and separate recognition/TTS readiness. Chat General, the floating recording panel and inline capture errors link there in the same tab, like other site pages; the voice link first cancels capture, and browser Back restores the persisted chat draft. Opening settings never requests access. **Check microphone** explicitly requests one stream and immediately releases every track (even a late grant after leaving), without recording/uploading or sending a task. Unsupported permission queries are shown as unknown, not denied. The check does not grant permanent permission; site/browser/OS controls remain authoritative. Telegram's Voice notes configuration remains separate.

HTTPS, MediaRecorder, AudioContext and OfflineAudioContext are required. Safari's MP4 and Chromium's Opus recordings use the same browser decode/resample path to canonical mono 16 kHz PCM16 WAV. Unsupported browsers show an error rather than a cloud/browser-speech fallback. Backgrounding, locking or hiding the page ends/discards capture; continuous background recording is not supported.

## Processing and safety

- `POST /api/robin/voice?op=transcribe` retains web-password and Host/Origin guards, bounded upload size and strict canonical WAV validation. Browser capture stops at 59 seconds; overlong audio is rejected, not clipped.
- `local-voice.ts` launches the **local CLI**, not an HTTP Whisper server, with explicit model/input/output paths, automatic language detection, no translation and zero prior text context. No new port/service, Python/ML dependency or frontend model download.
- One inference at a time per Web process; another device receives a busy error, not an unbounded queue. The deadline is 60 seconds. Cancellation/deadline sends SIGKILL and waits for child close before releasing the slot or files. ASR itself performs no retry, cloud fallback or agent dispatch; only the standalone panel's explicit Send calls the existing assistant endpoint. `VoiceControls` has no automatic transcript-commit callback.
- Each request uses a fresh private temporary directory (0700), WAV file (0600) and bounded output. Files are deleted in `finally` on success, failure and normal cancellation. No audio/history is added to Robin's recordings store. **A host/server crash may leave private temp files in the OS temp directory**; this is not a no-disk or secure-erasure promise.
- Child stdout/stderr are discarded, and the environment is allow-listed; API keys/passwords are not passed. Responses expose safe error codes, not transcripts in error messages, command output, model paths or credentials. Successful transcript/readiness responses are `no-store` / `nosniff`.
- Silence, noise and brief/mixed-language speech can produce incorrect words or a different Chinese script. Always review dates, numbers and negations; local recognition is not proof the text is correct. Confirmed messages follow the existing chat/model privacy policy.
- Epoch guards discard late permission grants/results; closing, switching Search/Act, changing panels, unmounting, backgrounding, device loss, hidden controls and another panel claiming the microphone release resources. There is no cross-browser-tab microphone lock.
- Ending voice/playback does not cancel or undo a submitted assistant task.

## Existing optional TTS (unchanged)

`ROBIN_VOICE_API_KEY` or `DASHSCOPE_API_KEY` enables `qwen3-tts-flash` / Cherry / Auto. `ROBIN_VOICE_ORIGIN` permits only the legacy Beijing DashScope origin or a Beijing workspace-specific origin. **These credentials affect TTS only, never recognition.** DeepInfra/provider selection is not implemented.

With TTS configured, the Voice replies checkbox opts into spoken reply excerpts. Sending is explicit (the standalone panel's Confirm and send, or the existing composer's Send). Reply consent is snapshotted from the current checkbox at dispatch, including changes made during transcript review, and is one-shot. Replies are still **extractive** (up to three complete sentences / 600 characters), not the requested future semantic rewrite. The full answer remains on screen. Without TTS configuration these controls are hidden and local dictation remains available.

TTS sends only excerpt text to Alibaba Cloud; no microphone audio goes there. Downloads retain the fixed Beijing bucket allow-list, TLS, no redirected credentials, 8 MiB/WAV limits and two-operation ceiling. Browser autoplay may require manual Play. No claims of verified voice quality or paid provider access.

## Code and checks

- `extension/robin/local-voice.ts`: local process, private files, readiness, concurrency and hard cancellation.
- `extension/robin/voice-domain.ts`: validation, local-ASR delegation and unchanged cloud-TTS boundary.
- `extension/robin/voice.ts`: shared limits, safe errors/readiness and legacy excerpt extraction.
- `app/api/robin/voice/route.ts`: authenticated HTTP adapter.
- `components/robin/useRobinVoice.ts`, `voice-audio.ts`: browser lifetime, canonical WAV, commit receipts and separate microphone/TTS readiness.
- `components/robin/useVoiceGesture.ts`, `VoiceControls.tsx`: tap/hold/cancel, permission fallback and accessible capture feedback.
- `components/robin/RobinVoice.tsx`: explicit global voice entry, existing assistant endpoint, no automatic task retry.

```sh
node --import ./scripts/test-style-stub.mjs --experimental-strip-types --test \
  extension/robin/local-voice.test.mjs extension/robin/voice-domain.test.mjs \
  components/robin/useRobinVoice.test.mjs components/robin/useVoiceGesture.test.mjs components/robin/voice-meter.test.mjs components/robin/AgentPanel.voice.test.mjs \
  app/api/robin/voice/route.test.mjs components/robin/AssistantPalette.test.mjs \
  app/api/robin/assistant/route.test.mjs
node_modules/.bin/tsc --noEmit
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/robin-voice.mjs
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/chat-voice.mjs
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/voice-settings.mjs
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/assistant-act.mjs
```

Unit tests use a real spawned fixture executable to check arguments, secret filtering, file modes/deletion, missing outputs, errors, bounded output, concurrent rejection and actual child death on cancellation. Browser tests use real MediaRecorder/Web Audio with a synthetic microphone and mocked ASR/TTS/agent; they cover single-tap start, same-button finish, hold/release (mouse and Chromium touch events) without automatic submission, editable/empty transcripts, close/reopen draft retention without mic acquisition, exact corrected-text dispatch, swipe cancel, late permission, closed recognition, uncertain task results, close/reopen during execution, explicit TTS, read-only search, keyboard, compact capture height and 320/390/1440px layouts. Hook tests additionally pin first-permission behavior, pointer cancellation, multi-touch and uncommitted time-limit drafts. `e2e/chat-voice.mjs` additionally checks both fresh and saved Agent composers, inline capture/focus/geometry, success dismissal, failure/retry, cancelled late recognition, selection insertion, attachment preservation, editing while recognition waits, IME/session-change cancellation and persistence across reload. These browser focus/layout checks do not verify the physical iOS software keyboard.

Live checks on this M4: a synthetic, non-sensitive 4.03-second Chinese sentence (macOS Tingting: “明天下午三点提醒我开会，不是今天。”) produced “明天下午三點提醒我開會,不是今天”. First direct invocation took ~9.0 s; subsequent authenticated request through the existing Tailscale HTTPS endpoint took ~1.4 s. The unauthenticated endpoint returned 401; readiness reported local configured / TTS unconfigured. A Chrome browser check at 390px through the same HTTPS entry also passed the complete synthetic-microphone → real local ASR → existing search draft flow (one upload, zero agent/TTS calls; screenshot `outputs/robin-voice/local-https-390.png`). The fixture microphone loops its audio, so the captured text can include the start of the next repetition. These are synthetic samples, not a latency/accuracy benchmark. No physical iPhone/Android microphone or cellular-network test has been performed.
