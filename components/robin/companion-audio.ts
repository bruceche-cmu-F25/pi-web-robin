import { pcmVoiceWav } from "./voice-audio";

export type Utterance = { samples: Float32Array; sampleRate: number; limited: boolean };
/** Energy-based turn segmentation, NOT speaker identification or semantic VAD. */
export class UtteranceGate {
  private pre: Float32Array[] = [];
  private frames: Float32Array[] = [];
  private candidate = 0;
  private elapsed = 0;
  private quiet = 0;
  private started = false;
  private noise = 0.002;
  constructor(private sampleRate: number, private onStart: () => void, private onEnd: (utterance: Utterance) => void) {}
  reset() { this.pre = []; this.frames = []; this.candidate = 0; this.elapsed = 0; this.quiet = 0; this.started = false; }
  push(samples: Float32Array) {
    if (!samples.length) return;
    const ms = samples.length / this.sampleRate * 1000;
    const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
    const voiced = rms > Math.max(0.009, this.noise * 3.5);
    if (!this.started) {
      this.pre.push(samples);
      while (this.pre.length > Math.ceil(this.sampleRate * 0.4 / samples.length)) this.pre.shift();
      this.candidate = voiced ? this.candidate + ms : 0;
      if (!voiced) this.noise = this.noise * 0.98 + Math.min(rms, 0.01) * 0.02;
      if (this.candidate < 180) return;
      this.started = true; this.frames = this.pre; this.pre = []; this.elapsed = this.candidate;
      this.onStart();
      return;
    }
    this.frames.push(samples); this.elapsed += ms; this.quiet = voiced ? 0 : this.quiet + ms;
    const limited = this.elapsed >= 45_000;
    // Pause threshold is deliberately conservative. A UI Finish button is always available.
    if (this.quiet >= 1500 || limited) this.flush(limited);
  }
  flush(limited = false) {
    if (!this.started) return;
    const frames = this.frames;
    const samples = new Float32Array(frames.reduce((sum, frame) => sum + frame.length, 0));
    let offset = 0;
    for (const frame of frames) { samples.set(frame, offset); offset += frame.length; }
    this.reset();
    this.onEnd({ samples, sampleRate: this.sampleRate, limited });
  }
}

export async function utteranceWav(utterance: Utterance): Promise<ArrayBuffer> {
  const { samples, sampleRate } = utterance;
  if (samples.length / sampleRate > 60 || !samples.length) throw new Error("audio");
  if (sampleRate === 16_000) return pcmVoiceWav(samples);
  const context = new OfflineAudioContext(1, Math.ceil(samples.length * 16_000 / sampleRate), 16_000);
  const buffer = context.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(new Float32Array(samples), 0);
  const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.start();
  return pcmVoiceWav((await context.startRendering()).getChannelData(0));
}
