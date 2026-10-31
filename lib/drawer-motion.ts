/** Horizontal drawer physics. Coordinates/velocity are pixels and pixels per second. */
export function drawerTarget(x: number, velocity: number, width: number): number {
  // Short projection: a deliberate flick closes, a slow partial drag returns.
  const projected = x + (velocity / 1000) * 0.99 / (1 - 0.99);
  return projected < -width / 2 ? -width : 0;
}

/** Exact critically damped spring, response 0.3 s; independent of frame rate. */
export function drawerSpring(x: number, velocity: number, target: number, seconds: number) {
  const omega = 2 * Math.PI / 0.3;
  const offset = x - target;
  const b = velocity + omega * offset;
  const decay = Math.exp(-omega * seconds);
  return { x: target + (offset + b * seconds) * decay, velocity: (velocity - omega * b * seconds) * decay };
}

export function drawerResistance(x: number, width: number): number {
  const bound = Math.max(-width, Math.min(0, x));
  const overshoot = x - bound;
  return bound + (overshoot * width * 0.55) / (width + 0.55 * Math.abs(overshoot));
}

export function drawerVelocity(points: Array<{ x: number; time: number }>, now: number): number {
  const recent = points.filter(point => now - point.time <= 100);
  const first = recent[0], last = recent.at(-1);
  if (!first || !last || last.time === first.time || now - last.time > 80) return 0;
  return (last.x - first.x) / (last.time - first.time) * 1000;
}
