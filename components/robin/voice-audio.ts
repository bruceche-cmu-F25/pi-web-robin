import { VOICE_SAMPLE_RATE, VOICE_SECONDS } from "@/extension/robin/voice";

/** Canonical 16-bit mono WAV. No recording survives a page close. */
export function pcmVoiceWav(samples: Float32Array): ArrayBuffer {
  if (!samples.length || samples.length > VOICE_SAMPLE_RATE * VOICE_SECONDS) throw new Error("audio");
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const tag = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  tag(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); tag(8, "WAVE"); tag(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, VOICE_SAMPLE_RATE, true); view.setUint32(28, VOICE_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, i) => { const sample = Math.max(-1, Math.min(1, value)); view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true); });
  return buffer;
}

export async function recordingToWav(blob: Blob, context: AudioContext): Promise<ArrayBuffer> {
  const decoded = await context.decodeAudioData(await blob.arrayBuffer());
  if (!decoded.length || decoded.duration > VOICE_SECONDS) throw new Error("audio");
  const frames = Math.ceil(decoded.duration * VOICE_SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, frames, VOICE_SAMPLE_RATE);
  const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
  const rendered = await offline.startRendering();
  return pcmVoiceWav(rendered.getChannelData(0));
}
