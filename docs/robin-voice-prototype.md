# Robin × Qwen Audio: read-only integration probe

## Status and scope

This is a backend integration probe, **not an installed voice assistant**. It adds no dependencies, UI, background process, audio capture or paid API call. Qwen Audio source reviewed/tested: `34f61be426e00b46e9ea899b6dfe08fb2c70a82a` (package 2.0.1; Backend Adapter SDK 3.0.0).

`RobinReadOnlyBackend` in `scripts/voice/robin-backend.mjs` implements the upstream public BackendPort. The path is:

```
Qwen BackendWorkRuntime → RobinReadOnlyBackend
  → POST /api/robin/assistant { mode: "readOnly", message: instruction }
  → existing Robin exact tool scope and one-shot session
```

Only canonical `instruction` reaches the model. No Gateway owner/task IDs, conversation snapshots, credentials, mode/model/tool selections, or workspace metadata are forwarded. Attachments and continuation references are explicitly rejected. This does **not** inherit the current coding conversation, learning context or a persistent Robin chat.

Robin's existing `readOnly` tools are `todo_list`, `calendar_list_events`, `job_list`, `round_list`, `gmail_list`, `gmail_get`. Read-only still reads personal information and uses a model. Its execution creates normal session/runtime records; it means no business write tools, not zero disk writes.

## Safety properties and limits

- Only a loopback origin is accepted; endpoint and `readOnly` mode are fixed in code. Redirects are refused. HTTP failures are not retried and raw server/provider errors are not forwarded to Qwen.
- One configured personal owner (default `robin-local`) may submit. A foreign owner cannot query an active task's status or cancel it. Owner IDs are Gateway routing metadata, **not authentication**. This is not a multi-user integration.
- The adapter can authenticate to Pi Web with server-side `PI_WEB_PASSWORD` / Basic username `pi`. This is a **full Pi Web credential**, not a scoped read-only token. Never send it to a browser/model or expose the sidecar to other users. A compromised Gateway process is outside this prototype's protection. A production deployment needs a separately scoped credential/endpoint or a comparably narrow local IPC interface.
- Admission reserves an ID before awaiting network I/O. Active duplicates and previously submitted IDs are rejected, including failures and cancellations. Maximum 4 active / 1,000 admitted tasks per adapter instance; capacity fails closed rather than evicting IDs. Restart loses this process-local deduplication. No durable replay recovery or exactly-once claim.
- `cancel` stops local HTTP work/delivery, and late results are discarded. The Robin route now forwards `req.signal` **only for readOnly** to the existing cancellation path. Write-capable modes keep their previous disconnect behavior.
- A `cancelled` adapter result is **not a remote cancellation acknowledgement**. A reverse proxy or server may delay disconnect propagation; already-run tools cannot be undone. Production cancellation needs explicit task acknowledgement if that guarantee is required.
- Status reports only that a query is running; it does not invent tool progress. Completion/terminal records belong to the upstream TaskManager, not another Robin task database.
- No automatic retries, private session IDs in results, or separate reminders/long-term memory store.

## Reproduce offline checks

From the Robin repository root:

```sh
node --test scripts/voice/robin-backend.test.mjs app/api/robin/assistant/route.test.mjs

# Also exercise the real upstream public SDK and BackendWorkRuntime:
QWAUDIO_SOURCE=/absolute/path/to/qwen-audio-agent \
  node --test scripts/voice/robin-backend.test.mjs app/api/robin/assistant/route.test.mjs
```

Without `QWAUDIO_SOURCE`, only the upstream-dependent test is explicitly skipped. Use the pinned source above to reproduce. Do not install it in Robin's dependency tree just for this check.

Checks cover upstream conformance, actual BackendWorkRuntime composition, fixed request scope, malformed input, owner isolation, simultaneous duplicates, replay rejection, timeout/caller abort/close, late replies, observer isolation, auth errors and a real local HTTP server disconnect. Route tests use a stubbed model runner and assert signal forwarding while preserving write-mode behavior. **These are not a live-model or full Gateway/WebUI test.**

## Optional local checks (operator initiated)

```sh
# Checks connectivity/auth only; does not create an agent or call a model.
node scripts/voice/check-robin.mjs

# Explicitly spends one Robin model turn, but no ASR/TTS usage:
node scripts/voice/check-robin.mjs --live '我今天有什么待办？'
```

`ROBIN_VOICE_ORIGIN` optionally changes the loopback port; default `http://127.0.0.1:30141`. Supply `PI_WEB_PASSWORD` through a private local environment mechanism if Pi Web requires it. Do not paste it into chat or put it in source control. The script does not discover/copy stored credentials or bypass authentication. Ctrl+C requests cancellation. `--live` output can contain personal information; do not publish its log.

## Gate before starting a real voice Gateway

The adapter can be wrapped with upstream `createBackendAgentHost`, then supplied as `createGatewayApplication({ agent })`. There is deliberately **no auto-start Gateway launcher yet**: booting the default app enables more than this adapter.

Before a microphone trial:

1. Install/run the pinned upstream version separately, use an isolated state directory and loopback listener, and align its personal owner with the adapter.
2. Disable upstream reminders, notes/memory learning, retrieval, MCP/OpenAPI tools and unrelated frontend tools. Inspect the effective tool registry, not just a prompt saying "don't use them". Never enable its built-in Pi/ACP backend alongside this adapter.
3. Restrict frontend delegation to read-only personal queries, require Robin results before claiming personal facts, and explicitly explain unsupported writes/learning workflows. Voice-front-model compliance still requires live testing; backend read-only protection does not guarantee truthful spoken claims.
4. Keep the DashScope key and Pi Web credential server-side. Review Qwen transcript/state retention: no raw audio capture here does not mean upstream text logs are disabled.
5. First run a read-only query, then live voice: factual result, interruption vs task cancellation, duplicate dispatch, reconnect with no automatic resubmission, external-speaker echo, and cost/latency measurement.

No live voice, microphone, full WebUI reconnect, real-tool task cancellation acknowledgement or actual bill has been validated by these offline checks. Cross-process durable identity/recovery and a scoped credential are later production work, not hidden claims of this probe.
