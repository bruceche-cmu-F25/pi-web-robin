/** Experimental, single-user BackendPort for Qwen Audio Agent. No SDK dependency. */
export class RobinReadOnlyBackend {
  #active = new Map();
  #seen = new Set();
  #listeners = new Set();
  #ready = false;
  #closed = false;
  #endpoint;
  #headers;
  #fetch;
  #ownerId;
  #timeoutMs;

  constructor({ origin = 'http://127.0.0.1:30141', password = '', ownerId = 'robin-local', fetchImpl = fetch, timeoutMs = 100_000 } = {}) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol)
      || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Robin origin must be a loopback HTTP(S) origin without credentials or a path');
    }
    if (typeof ownerId !== 'string' || !ownerId.trim()) throw new Error('A personal Gateway owner is required');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid timeout');
    this.#endpoint = new URL('/api/robin/assistant', url).href;
    this.#headers = {
      'Content-Type': 'application/json',
      Origin: url.origin,
      ...(password ? { Authorization: `Basic ${Buffer.from(`pi:${password}`).toString('base64')}` } : {}),
    };
    this.#fetch = fetchImpl;
    this.#ownerId = ownerId;
    this.#timeoutMs = timeoutMs;
  }

  describe() {
    return {
      configured: true, enabled: true, protocol: 'robin-read-only', label: 'Robin (read only)',
      capabilities: { cancel: true, authorization: false, input: false, workUpdates: false },
    };
  }

  async start() {
    if (this.#closed) throw new Error('Robin backend is closed');
    this.#ready = true;
    return { ok: true, status: 'ready' };
  }

  async health() {
    if (!this.#ready || this.#closed) return { ok: false, status: 'stopped' };
    try {
      // GET never creates a model turn; don't return the private session id.
      const response = await this.#fetch(this.#endpoint, {
        headers: this.#headers, redirect: 'error', signal: AbortSignal.timeout(5_000),
      });
      await response.body?.cancel();
      return { ok: response.ok, status: response.ok ? 'ready' : 'unavailable' };
    } catch {
      return { ok: false, status: 'unavailable' };
    }
  }

  async submit(task, { signal: callerSignal } = {}) {
    const { id, ownerId, instruction } = task ?? {};
    if (![id, ownerId, instruction].every(value => typeof value === 'string' && value.trim())) {
      throw new Error('Backend submit requires task id, owner and input');
    }
    if (this.#closed) throw new Error('Robin backend is closed');
    if (ownerId !== this.#ownerId) throw new Error('This backend is restricted to its configured personal owner');
    if (id.length > 256 || instruction.length > 16_000) throw new Error('Task input is too large');
    if (task.resumeContext || (task.inputParts != null && (!Array.isArray(task.inputParts) || task.inputParts.length))) {
      throw new Error('This prototype supports text-only, stateless queries');
    }
    if (this.#active.has(id)) throw new Error('Task is already active');
    if (this.#seen.has(id)) throw new Error('Task was already submitted; no automatic replay');
    // ponytail: bounded process-local deduplication, not durable exactly-once delivery.
    // Fail closed instead of evicting IDs; a new controlled trial uses a fresh adapter.
    if (this.#seen.size >= 1_000 || this.#active.size >= 4) throw new Error('Prototype task capacity reached');
    callerSignal?.throwIfAborted();
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal, AbortSignal.timeout(this.#timeoutMs), ...(callerSignal ? [callerSignal] : []),
    ]);
    this.#seen.add(id);
    this.#active.set(id, { ownerId, controller });
    this.#ready = true;
    this.#emit({
      type: 'backend.activity', taskId: id, ownerId,
      activity: { id: 'robin-query', kind: 'status', status: 'running', message: 'Robin is processing a read-only query' },
    });
    try {
      const response = await this.#fetch(this.#endpoint, {
        method: 'POST', headers: this.#headers, redirect: 'error', signal,
        // Never forward mode, tools, conversation, owner, session or model metadata.
        body: JSON.stringify({ mode: 'readOnly', message: instruction }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Robin query failed (HTTP ${response.status}); not retried`);
      }
      const result = await response.json();
      signal.throwIfAborted(); // A late reply after cancellation must not be spoken.
      if (typeof result?.reply !== 'string' || !result.reply.trim()) throw new Error('Robin returned no usable reply');
      return { content: result.reply, artifacts: [] };
    } catch {
      if (signal.aborted) {
        throw Object.assign(new Error('Robin query cancelled or timed out; no result delivered'), { code: 'WORK_CANCELLED' });
      }
      // Model/provider errors and network messages may contain credentials or private paths.
      throw new Error('Robin query failed; check the local server. No automatic retry.');
    } finally {
      this.#active.delete(id);
    }
  }

  status(taskId, { ownerId } = {}) {
    if (taskId === undefined) return { ok: this.#ready && !this.#closed, status: this.#ready && !this.#closed ? 'ready' : 'stopped' };
    const record = this.#active.get(taskId);
    return { taskId, state: record && (!ownerId || ownerId === record.ownerId) ? 'working' : 'not_found' };
  }

  async cancel(taskId, { ownerId } = {}) {
    const record = this.#active.get(taskId);
    if (!record) return { taskId, state: 'not_found' };
    if (ownerId && ownerId !== record.ownerId) throw new Error('Cannot cancel work owned by another user');
    record.controller.abort();
    // Local delivery is cancelled. HTTP disconnect requests backend cancellation;
    // this is not a server acknowledgement and cannot undo already-run tools.
    return { taskId, state: 'cancelled' };
  }

  async respondAuthorization() { throw new Error('Read-only backend does not support authorization requests'); }
  async respondInput() { throw new Error('Read-only backend does not support input requests'); }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
    if (this.#closed) throw new Error('Robin backend is closed');
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event) {
    for (const listener of this.#listeners) {
      try { listener(structuredClone(event)); } catch { /* An observer cannot stop a task or corrupt another observer's event. */ }
    }
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const { controller } of this.#active.values()) controller.abort();
    this.#listeners.clear();
  }
}
