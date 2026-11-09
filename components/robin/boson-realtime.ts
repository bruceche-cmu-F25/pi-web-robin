/** Browser-safe Boson protocol/audio primitives. No credentials or persistence. */
export const BOSON_REALTIME_URL = "wss://api.boson.ai/v1/realtime?model=higgs-realtime";
export const REALTIME_MAX_MS = 10 * 60_000;
export const bosonSession = {
  type: "realtime", model: "higgs-realtime", output_modalities: ["audio"],
  instructions: "你是 Robin 的实时语音试用助手。用用户正在使用的语言自然交谈，通常只说一两句。不要客套、复述或为延续对话而追问；保留否定、日期、风险和不确定性。你能直接理解用户的声音，不要说只能看文字。这个试用没有任何工具，也没有用户的待办、邮件、日历、页面内容或过去对话。绝不能声称查询、添加、修改或安排了事情；需要这些能力时，说明当前是仅聊天试用，请用户切回原版或打开相应页面。只谈论实际知道的内容，不编造执行结果。",
  audio: {
    input: { format: { type: "audio/pcm", rate: 24000 }, noise_reduction: { type: "near_field" },
      transcription: { model: "higgs-stt-3.1" },
      turn_detection: { type: "semantic_vad", threshold: 0.65, prefix_padding_ms: 300, silence_duration_ms: 500, min_speech_duration: 0.125 } },
    output: { format: { type: "audio/pcm", rate: 24000 }, voice: "default" },
  },
  tools: [], tool_choice: "none", max_output_tokens: 256, truncation: "auto",
};

/** Area-averaged streaming resampling; preserves fractional phase across worklet frames. */
export class Pcm24Encoder {
  private sum = 0;
  private weight = 0;
  private readonly ratio: number;
  constructor(sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error("sample-rate");
    this.ratio = sampleRate / 24000;
  }
  encode(samples: Float32Array): string {
    const values: number[] = [];
    for (const sample of samples) {
      let remaining = 1;
      while (remaining > 1e-8) {
        const take = Math.min(remaining, this.ratio - this.weight);
        this.sum += Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0)) * take;
        this.weight += take; remaining -= take;
        if (this.weight >= this.ratio - 1e-8) {
          const value = this.sum / this.ratio;
          values.push(Math.round(value * (value < 0 ? 32768 : 32767)));
          this.sum = 0; this.weight = 0;
        }
      }
    }
    const bytes = new Uint8Array(values.length * 2), view = new DataView(bytes.buffer);
    values.forEach((value, i) => view.setInt16(i * 2, value, true));
    let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
}
export function decodePcm24(base64: string): Float32Array {
  if (!base64.length || base64.length > 256_000) throw new Error("audio-size");
  const binary = atob(base64);
  if (binary.length % 2) throw new Error("audio-format");
  const samples = new Float32Array(binary.length / 2);
  for (let i = 0; i < samples.length; i++) {
    const unsigned = binary.charCodeAt(i * 2) | binary.charCodeAt(i * 2 + 1) << 8;
    samples[i] = (unsigned >= 32768 ? unsigned - 65536 : unsigned) / 32768;
  }
  return samples;
}

/** Bounded PCM queue on the already gesture-unlocked capture AudioContext. */
export class RealtimePlayer {
  private next = 0;
  private nodes = new Set<AudioBufferSourceNode>();
  private spans: { item: string; index: number; start: number; duration: number }[] = [];
  private tick: ReturnType<typeof setInterval> | null = null;
  private playing = false;
  constructor(private context: AudioContext, private onPlaying: () => void, private onDrained: () => void) {}
  append(base64: string, item: string, index: number) {
    // Boson emits an empty delta at an interrupted audio boundary, before done.
    // It carries no PCM and must not tear down a healthy conversation.
    if (base64 === "") return;
    if (this.context.state !== "running") throw new Error("audio-suspended");
    const samples = decodePcm24(base64), duration = samples.length / 24000;
    const start = Math.max(this.next, this.context.currentTime + 0.015);
    if (start + duration - this.context.currentTime > 15 || this.nodes.size >= 256 || this.spans.length >= 1024) throw new Error("audio-backlog");
    const buffer = this.context.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.context.destination);
    this.nodes.add(source); this.spans.push({ item, index, start, duration }); this.next = start + duration;
    source.onended = () => {
      source.disconnect(); this.nodes.delete(source);
      if (!this.nodes.size) { this.playing = false; this.stopTick(); this.onDrained(); }
    };
    source.start(start);
    if (!this.tick) this.tick = setInterval(() => {
      // Clock crossing on a running AudioContext, not receipt of a network chunk.
      if (!this.playing && this.context.state === "running" && this.spans.some(span => this.context.currentTime >= span.start && this.context.currentTime < span.start + span.duration)) {
        this.playing = true; this.onPlaying();
      }
    }, 20);
  }
  position() {
    const last = this.spans.at(-1);
    if (!last) return null;
    const played = this.spans.filter(span => span.item === last.item && span.index === last.index)
      .reduce((sum, span) => sum + Math.max(0, Math.min(span.duration, this.context.currentTime - span.start)), 0);
    return { item_id: last.item, content_index: last.index, audio_end_ms: Math.floor(played * 1000) };
  }
  hasAudio() { return this.nodes.size > 0; }
  clear() {
    this.stopTick(); this.playing = false;
    for (const node of this.nodes) { node.onended = null; node.stop(); node.disconnect(); }
    this.nodes.clear(); this.spans = []; this.next = 0;
  }
  private stopTick() { if (this.tick) clearInterval(this.tick); this.tick = null; }
}
