"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_RECORDING_BYTES, MAX_RECORDING_SECONDS } from "@/extension/robin/recordings";

const DB = "robin-recording-draft";
async function draftStore(action: "read" | "clear" | "append", blob?: Blob): Promise<Blob[]> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore("chunks", { autoIncrement: true });
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction("chunks", action === "read" ? "readonly" : "readwrite");
      const store = tx.objectStore("chunks");
      const request = action === "read" ? store.getAll() : action === "clear" ? store.clear() : store.add(blob);
      tx.oncomplete = () => { db.close(); resolve(action === "read" ? request.result as Blob[] : []); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Draft storage failed")); };
    };
  });
}
function audioFile(chunks: Blob[]): File {
  const type = chunks[0]?.type || "audio/webm";
  const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
  return new File(chunks, `recording.${extension}`, { type });
}

export function useAudioRecorder() {
  const [phase, setPhase] = useState<"loading" | "locked" | "idle" | "requesting" | "recording" | "paused" | "stopping" | "ready">("loading");
  const [file, setFile] = useState<File | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [issue, setIssue] = useState<"storage" | "permission" | "unsupported" | "interrupted" | "limit" | "anotherTab" | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const mounted = useRef(false);
  const operation = useRef(false);
  const pendingWrites = useRef<Promise<unknown>>(Promise.resolve());
  const canPersist = useRef(false);
  const releaseDraft = useRef<(() => void) | null>(null);
  const stop = () => {
    const active = recorder.current;
    if (active && active.state !== "inactive") { setPhase("stopping"); active.stop(); }
  };

  useEffect(() => {
    mounted.current = true;
    let live = true;
    const restore = async () => {
      try {
        const chunks = await draftStore("read");
        if (!live) return;
        canPersist.current = true;
        if (chunks.length) { setFile(audioFile(chunks)); setPhase("ready"); }
        else setPhase("idle");
      } catch { if (live) { setIssue("storage"); setPhase("idle"); } }
    };
    // Hold one draft owner for the page lifetime: another tab must not clear or mix its chunks.
    if (navigator.locks) {
      // Defer until after StrictMode's setup/cleanup replay, avoiding a self-contended lock.
      queueMicrotask(() => {
        if (!live) return;
        void navigator.locks.request(DB, { ifAvailable: true }, async (lock) => {
          if (!live) return;
          if (!lock) { setIssue("anotherTab"); setPhase("locked"); return; }
          const released = new Promise<void>((resolve) => { releaseDraft.current = resolve; });
          await restore();
          if (!live) releaseDraft.current?.();
          await released;
        }).catch(() => { if (live) { setIssue("storage"); setPhase("idle"); } });
      });
    } else { setIssue("storage"); setPhase("idle"); }
    return () => {
      live = false;
      mounted.current = false;
      const active = recorder.current;
      if (active) {
        if (active.state !== "inactive") active.stop();
      } else void pendingWrites.current.finally(() => releaseDraft.current?.());
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function start() {
    if (operation.current || !["idle", "ready"].includes(phase)) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setIssue("unsupported"); return;
    }
    operation.current = true;
    setPhase("requesting"); setIssue(null);
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) { media.getTracks().forEach((track) => track.stop()); return; }
      stream.current = media;
      // Never overwrite an earlier draft until the microphone permission has succeeded.
      if (canPersist.current) {
        try { await draftStore("clear"); }
        catch { canPersist.current = false; setIssue("storage"); }
      } else setIssue("storage");
      if (!mounted.current) { media.getTracks().forEach((track) => track.stop()); return; }
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
      const active = new MediaRecorder(media, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64_000 });
      recorder.current = active;
      const chunks: Blob[] = [];
      let bytes = 0, elapsed = 0, tick = performance.now();
      setFile(null); setSeconds(0);
      active.ondataavailable = ({ data }) => {
        if (!data.size) return;
        chunks.push(data); bytes += data.size;
        if (canPersist.current) pendingWrites.current = pendingWrites.current.then(() => {
          if (canPersist.current) return draftStore("append", data);
        }).catch(() => {
          // Keep only a contiguous recoverable prefix; never append after a missing chunk.
          canPersist.current = false;
          if (mounted.current) setIssue("storage");
        });
        if (bytes >= MAX_RECORDING_BYTES && active.state !== "inactive") {
          if (mounted.current) setIssue("limit");
          active.stop();
        }
      };
      active.onerror = () => {
        if (mounted.current) setIssue("interrupted");
        if (active.state !== "inactive") active.stop();
      };
      active.onstop = () => {
        clearInterval(timer);
        media.getTracks().forEach((track) => track.stop());
        recorder.current = null;
        void pendingWrites.current.then(() => {
          if (!mounted.current) { releaseDraft.current?.(); return; }
          setFile(chunks.length ? audioFile(chunks) : null);
          setPhase(chunks.length ? "ready" : "idle");
        });
      };
      media.getAudioTracks().forEach((track) => track.addEventListener("ended", () => {
        if (active.state !== "inactive") { setIssue("interrupted"); active.stop(); }
      }));
      active.start(5_000);
      setPhase("recording");
      timer = setInterval(() => {
        const now = performance.now();
        if (active.state === "recording") elapsed += (now - tick) / 1000;
        tick = now;
        if (mounted.current) setSeconds(elapsed);
        if (elapsed >= MAX_RECORDING_SECONDS && active.state !== "inactive") {
          if (mounted.current) setIssue("limit");
          active.stop();
        }
      }, 250);
    } catch {
      clearInterval(timer);
      recorder.current = null;
      stream.current?.getTracks().forEach((track) => track.stop());
      if (mounted.current) { setIssue("permission"); setPhase(file ? "ready" : "idle"); }
    } finally { operation.current = false; }
  }
  function pause() {
    if (recorder.current?.state === "recording") { recorder.current.pause(); setPhase("paused"); }
    else if (recorder.current?.state === "paused") { recorder.current.resume(); setPhase("recording"); }
  }
  async function discard() {
    await pendingWrites.current;
    // Failure keeps the draft visible rather than claiming it was removed.
    if (releaseDraft.current) await draftStore("clear");
    setFile(null); setSeconds(0); setPhase("idle"); setIssue(null);
  }
  return { phase, file, seconds, issue, start, stop, pause, discard };
}
