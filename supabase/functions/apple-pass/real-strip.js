// Lightweight, dependency-free PNG for native Apple store-card strips.
// Avoid native/WASM image dependencies in the Edge Function: the test-pass route
// must be able to cold-start even if no real-card artwork is requested.
function rgb(value, fallback) {
  const hex = /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const u32 = n => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const concat = chunks => {
  const size = chunks.reduce((sum, part) => sum + part.length, 0);
  const dest = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) { dest.set(part, offset); offset += part.length; }
  return dest;
};
function crc32(data) {
  let crc = 0xffffffff;
  for (const b of data) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, payload) {
  const tag = new TextEncoder().encode(type);
  return concat([u32(payload.length), tag, payload, u32(crc32(concat([tag, payload])))]);
}
function pixel(pixels, width, x, y, rgb) {
  const index = (y * width + x) * 4;
  pixels[index] = rgb[0]; pixels[index + 1] = rgb[1];
  pixels[index + 2] = rgb[2]; pixels[index + 3] = 255;
}
function circle(pixels, width, height, cx, cy, r, color) {
  const r2 = r * r;
  for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(height, Math.ceil(cy + r)); y++)
    for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(width, Math.ceil(cx + r)); x++)
      if ((x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 <= r2)
        pixel(pixels, width, x, y, color);
}
export async function makeRealStrip(brand, balance, goal, scale = 1) {
  if (![1, 2].includes(scale)) throw new Error('invalid_strip_scale');
  const width = 375 * scale, height = 123 * scale;
  const pixels = new Uint8Array(width * height * 4);
  const primary = rgb(brand.primary, '#2448F0');
  const secondary = rgb(brand.secondary, '#2448F0');
  const accent = rgb(brand.stamps?.filled || brand.accent, '#F2C94C');
  const empty = rgb(brand.stamps?.empty, '#FFFFFF');
  // A restrained branded two-tone band. Native Wallet fields remain legible.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isRight = x >= width * .5;
      const v = isRight ? secondary : primary;
      pixel(pixels, width, x, y, v);
    }
  }
  // Stamps on right half, driven by the REAL card's balance rather than editor demo data.
  const maxStamps = Math.max(1, Math.min(10, Math.floor(Number(goal) || 10)));
  const done = clamp(Math.floor(Math.max(0, Number(balance) || 0) / Math.max(1, Number(goal) || 1) * maxStamps), 0, maxStamps);
  const columns = Math.min(maxStamps, 5), rows = Math.ceil(maxStamps / columns);
  const dX = 31 * scale, dY = (rows === 1 ? 0 : 43 * scale);
  const center = 285 * scale;
  for (let i = 0; i < maxStamps; i++) {
    const col = i % columns, row = Math.floor(i / columns);
    const x = Math.round(center + (col - (columns - 1) / 2) * dX);
    const y = Math.round(height / 2 + (row - (rows - 1) / 2) * dY);
    circle(pixels, width, height, x, y, 12 * scale, i < done ? accent : empty);
    if (i >= done) circle(pixels, width, height, x, y, 9 * scale, secondary);
  }
  // PNG RGBA8, unfiltered scanlines, compressed with standard Web CompressionStream.
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const scanline = y * (1 + width * 4);
    raw[scanline] = 0;
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), scanline + 1);
  }
  const packed = new Uint8Array(await new Response(
    new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))
  ).arrayBuffer());
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', concat([u32(width), u32(height), new Uint8Array([8, 6, 0, 0, 0])])),
    chunk('IDAT', packed),
    chunk('IEND', new Uint8Array()),
  ]);
}
