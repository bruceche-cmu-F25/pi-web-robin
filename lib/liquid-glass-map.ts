/** The approved standalone study's rounded lens, with bounded map storage.
 * A smooth inward lip, not a physically exact Snell simulation. RGB encodes
 * sampling offsets, NOT a picture of the page; no DOM capture.
 */
export function createGlassMap(width: number, height: number, cornerRadius: number) {
  if (![width, height, cornerRadius].every(Number.isFinite) || width <= 0 || height <= 0 || cornerRadius < 0) {
    throw new RangeError("Invalid glass geometry");
  }
  const radius = Math.min(cornerRadius, width / 2, height / 2);
  const bezel = Math.min(22, Math.min(width, height) * 0.28);
  // Peak inside the bevel, easing back to neutral at both ends. Precompute
  // the curve rather than evaluating a sine for every map pixel.
  const profile = Float64Array.from({ length: 256 }, (_, i) => Math.sin(Math.PI * i / 255) ** 0.7);
  // Independent axis caps preserve the thin dimension of long toolbars.
  // A map never exceeds 256 KiB, regardless of DPR or panel dimensions.
  const mapWidth = Math.min(256, Math.ceil(width));
  const mapHeight = Math.min(256, Math.ceil(height));
  const data = new Uint8ClampedArray(mapWidth * mapHeight * 4);
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const px = (x + 0.5) * width / mapWidth - width / 2;
      const py = (y + 0.5) * height / mapHeight - height / 2;
      const qx = Math.abs(px) - (width / 2 - radius);
      const qy = Math.abs(py) - (height / 2 - radius);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const length = Math.hypot(ox, oy);
      const distance = radius - (length + Math.min(Math.max(qx, qy), 0));
      let dx = 0, dy = 0;
      if (distance >= 0 && distance < bezel) {
        const offset = profile[Math.round(distance / bezel * 255)];
        const nx = length > 0 ? ox / length : qx > qy ? 1 : 0;
        const ny = length > 0 ? oy / length : qx > qy ? 0 : 1;
        dx = -Math.sign(px) * nx * offset;
        dy = -Math.sign(py) * ny * offset;
      }
      const index = (y * mapWidth + x) * 4;
      data[index] = Math.round(128 + 127 * dx);
      data[index + 1] = Math.round(128 + 127 * dy);
      data[index + 2] = 128;
      data[index + 3] = 255;
    }
  }
  // feDisplacementMap multiplies (channel - .5). Keep the study's 36px scale,
  // reduced for narrow controls so sampling never exceeds their bevel width.
  // Neutral 8-bit 128 has a <0.08px quantization bias, not a zoom.
  return { width: mapWidth, height: mapHeight, data, scale: Math.min(36, bezel * 2) };
}
