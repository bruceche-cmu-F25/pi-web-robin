# Robin voice — local dictation

## Current scope

**Speech input runs on the Robin host with whisper.cpp. No cloud speech key is needed.** Phones and other computers record in their browser, upload to the existing authenticated Robin HTTPS endpoint, and receive editable text. Recognition never submits a message or starts an agent.

- Dashboard and Cmd/Ctrl+K: microphone on the input line in **Search / 搜索** and **Act / 执行**. Search only fills the query; ordinary filtering continues, but nothing navigates or executes automatically.
- Shared `AgentPanel` workspaces, including coding coach and Full Stack Open mentor: controls below the composer. Existing text is preserved and recognition appended.
- Main Pi / Agent chat (`ChatInput`), in both fresh and existing sessions: microphone beside Send, not in the toolbar hidden by mobile keyboards. It is dictation-only; no speech controls or separate agent. Native insertion uses the current selection and preserves attachments/undo. Sending, a built-in command, IME composition, draft rekeying or switching session/cwd discards pending recognition. Text follows the existing per-tab draft persistence.
- Custom panels, the research thread and the compact quote-question composer are **not integrated** by this change.
- Choose **Voice → Dictate → Done speaking**, review/correct text, then explicitly search or send using the existing controls. Up to 60 seconds per recording.
- The owning panel keeps its original model, endpoint, session, mode and tool scope. No Qwen Gateway, second agent, duplicate memory, auto-send, live partial recognition, wake word or full duplex.
- TTS changes are deferred. Existing optional Beijing DashScope TTS remains unchanged; its controls are hidden when its configuration is absent. No paid TTS call was made for this change. Semantic spoken rewriting and a durable independent speech toggle remain unimplemented.

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
4. Tap the microphone, record, stop, then review the filled text. No model or speech API key belongs on the phone.

HTTPS, MediaRecorder, AudioContext and OfflineAudioContext are required. Safari's MP4 and Chromium's Opus recordings use the same browser decode/resample path to canonical mono 16 kHz PCM16 WAV. Unsupported browsers show an error rather than a cloud/browser-speech fallback. Backgrounding, locking or hiding the page ends/discards capture; continuous background recording is not supported.

## Processing and safety

- `POST /api/robin/voice?op=transcribe` retains web-password and Host/Origin guards, bounded upload size and strict canonical WAV validation. Browser capture stops at 59 seconds; overlong audio is rejected, not clipped.
- `local-voice.ts` launches the **local CLI**, not an HTTP Whisper server, with explicit model/input/output paths, automatic language detection, no translation and zero prior text context. No new port/service, Python/ML dependency or frontend model download.
- One inference at a time per Web process; another device receives a busy error, not an unbounded queue. The deadline is 60 seconds. Cancellation/deadline sends SIGKILL and waits for child close before releasing the slot or files. No retry, cloud fallback or agent dispatch.
- Each request uses a fresh private temporary directory (0700), WAV file (0600) and bounded output. Files are deleted in `finally` on success, failure and normal cancellation. No audio/history is added to Robin's recordings store. **A host/server crash may leave private temp files in the OS temp directory**; this is not a no-disk or secure-erasure promise.
- Child stdout/stderr are discarded, and the environment is allow-listed; API keys/passwords are not passed. Responses expose safe error codes, not transcripts in error messages, command output, model paths or credentials. Successful transcript/readiness responses are `no-store` / `nosniff`.
- Silence, noise and brief/mixed-language speech can produce incorrect words or a different Chinese script. Always review dates, numbers and negations; local recognition is not proof the text is correct. Confirmed messages follow the existing chat/model privacy policy.
- Epoch guards discard late permission grants/results; closing, switching Search/Act, changing panels, unmounting, backgrounding, device loss, hidden controls and another panel claiming the microphone release resources. There is no cross-browser-tab microphone lock.
- Ending voice/playback does not cancel or undo a submitted assistant task.

## Existing optional TTS (unchanged)

`ROBIN_VOICE_API_KEY` or `DASHSCOPE_API_KEY` enables `qwen3-tts-flash` / Cherry / Auto. `ROBIN_VOICE_ORIGIN` permits only the legacy Beijing DashScope origin or a Beijing workspace-specific origin. **These credentials affect TTS only, never recognition.** DeepInfra/provider selection is not implemented.

With TTS configured, Voice conversation opts into spoken reply excerpts but still requires explicit sending. Reply consent is snapshotted and one-shot. Replies are still **extractive** (up to three complete sentences / 600 characters), not the requested future semantic rewrite. The full answer remains on screen. Without TTS configuration these controls are hidden and local dictation remains available.

TTS sends only excerpt text to Alibaba Cloud; no microphone audio goes there. Downloads retain the fixed Beijing bucket allow-list, TLS, no redirected credentials, 8 MiB/WAV limits and two-operation ceiling. Browser autoplay may require manual Play. No claims of verified voice quality or paid provider access.

## Code and checks

- `extension/robin/local-voice.ts`: local process, private files, readiness, concurrency and hard cancellation.
- `extension/robin/voice-domain.ts`: validation, local-ASR delegation and unchanged cloud-TTS boundary.
- `extension/robin/voice.ts`: shared limits, safe errors/readiness and legacy excerpt extraction.
- `app/api/robin/voice/route.ts`: authenticated HTTP adapter.
- `components/robin/useRobinVoice.ts`, `voice-audio.ts`, `VoiceControls.tsx`: browser lifetime, canonical WAV, separate microphone/TTS readiness and draft-only capture.

```sh
node --import ./scripts/test-style-stub.mjs --experimental-strip-types --test \
  extension/robin/local-voice.test.mjs extension/robin/voice-domain.test.mjs \
  components/robin/useRobinVoice.test.mjs components/robin/AgentPanel.voice.test.mjs \
  app/api/robin/voice/route.test.mjs components/robin/AssistantPalette.test.mjs \
  app/api/robin/assistant/route.test.mjs
node_modules/.bin/tsc --noEmit
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/robin-voice.mjs
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/chat-voice.mjs
PLAYWRIGHT_CHANNEL=chrome node --env-file-if-exists=.env.local e2e/assistant-act.mjs
```

Unit tests use a real spawned fixture executable to check arguments, secret filtering, file modes/deletion, missing outputs, errors, bounded output, concurrent rejection and actual child death on cancellation. Browser tests use real MediaRecorder/Web Audio with a synthetic microphone and mocked ASR/TTS/agent; they cover dictation without TTS configuration, no auto-submit, existing drafts, lifecycle and 320/390/1440px layouts. `e2e/chat-voice.mjs` additionally checks both fresh and saved Agent composers, selection insertion, attachment preservation, editing while recognition waits, IME/session-change cancellation and persistence across reload.

Live checks on this M4: a synthetic, non-sensitive 4.03-second Chinese sentence (macOS Tingting: “明天下午三点提醒我开会，不是今天。”) produced “明天下午三點提醒我開會,不是今天”. First direct invocation took ~9.0 s; subsequent authenticated request through the existing Tailscale HTTPS endpoint took ~1.4 s. The unauthenticated endpoint returned 401; readiness reported local configured / TTS unconfigured. A Chrome browser check at 390px through the same HTTPS entry also passed the complete synthetic-microphone → real local ASR → existing search draft flow (one upload, zero agent/TTS calls; screenshot `outputs/robin-voice/local-https-390.png`). The fixture microphone loops its audio, so the captured text can include the start of the next repetition. These are synthetic samples, not a latency/accuracy benchmark. No physical iPhone/Android microphone or cellular-network test has been performed.
