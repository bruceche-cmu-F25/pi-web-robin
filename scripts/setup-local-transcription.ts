/** Explicit one-time download of OpenAI's multilingual Whisper small checkpoint. No audio is read. */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { localWhisperModelPath } from "../extension/robin/local-transcription.ts";

// Pinned to the checksum/URL in OpenAI Whisper's model registry (20250625).
const SHA256 = "9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794";
const URL = `https://openaipublic.azureedge.net/main/whisper/models/${SHA256}/small.pt`;
const MAX_BYTES = 550 * 1024 * 1024;
const destination = localWhisperModelPath();
async function checksum(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
async function install() {
  try {
    if (await checksum(destination) === SHA256) { console.log(`Whisper small is already verified: ${destination}`); return; }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomUUID()}.download`;
  try {
    console.log("Downloading Whisper small (~460 MiB). Only model weights are downloaded; no audio is uploaded.");
    const response = await fetch(URL, { redirect: "error", signal: AbortSignal.timeout(15 * 60_000) });
    if (!response.ok || !response.body) throw new Error(`Model download failed (HTTP ${response.status})`);
    const file = await open(temporary, "wx", 0o600);
    let bytes = 0, lastProgress = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        bytes += chunk.byteLength;
        if (bytes > MAX_BYTES) throw new Error("Model download exceeded the expected size");
        // FileHandle.writeFile consumes the entire chunk, including partial OS writes.
        await file.writeFile(chunk);
        if (bytes - lastProgress >= 50 * 1024 * 1024) {
          console.log(`${Math.round(bytes / 1024 / 1024)} MiB downloaded`); lastProgress = bytes;
        }
      }
      await file.sync();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      await file.close();
    }
    if (await checksum(temporary) !== SHA256) throw new Error("Whisper model checksum mismatch; the download was not installed");
    await rename(temporary, destination);
    console.log(`Verified and installed: ${destination}`);
  } finally { await rm(temporary, { force: true }); }
}
await install();
