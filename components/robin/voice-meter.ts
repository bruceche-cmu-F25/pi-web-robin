/** Perceptual microphone level, not a speech detector or a frequency spectrum. */
export function voiceLevel(samples: Float32Array): number {
  if (!samples.length) return 0;
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  const rms = Math.sqrt(energy / samples.length);
  // -60 dBFS floor; -20 dBFS fills the meter. Log scaling makes quiet speech visible
  // without amplifying digital silence into a pretend talking animation.
  if (!Number.isFinite(rms) || rms <= 0.001) return 0;
  return Math.min(1, Math.max(0, (20 * Math.log10(rms) + 60) / 40));
}

/** Frame-rate independent envelope: quick response, a softer release, no overshoot. */
export function smoothVoiceLevel(current: number, target: number, deltaMs: number): number {
  const tau = target > current ? 120 : 240;
  const next = current + (target - current) * (1 - Math.exp(-Math.max(0, deltaMs) / tau));
  return next < 0.001 ? 0 : next;
}
