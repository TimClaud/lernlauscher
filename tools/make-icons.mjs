// Erzeugt die App-Icons (PNG) ohne Zusatzpakete: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function draw(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const top = hex('#E9C08A'), bot = hex('#B8693A'), sun = hex('#FFF3DF'), bar = hex('#2E2620');
  const pad = maskable ? 0.18 : 0.1;
  const S = 4; // Kantenglättung
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let acc = [0, 0, 0];
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const u = (x + (sx + 0.5) / S) / size, v = (y + (sy + 0.5) / S) / size;
      let c = mix(top, bot, Math.min(1, Math.max(0, (v - 0.1) / 0.9)));
      // Sonne
      const cx = 0.5, cy = 0.47, r = 0.25 * (1 - pad * 0.6);
      if ((u - cx) ** 2 + (v - cy) ** 2 < r * r) c = sun;
      // Horizont / Savanne
      const hz = 0.66 + 0.025 * Math.sin(u * 7);
      if (v > hz) c = mix(hex('#7D8B5A'), hex('#5E6B42'), Math.min(1, (v - hz) / 0.3));
      // Schallwellen-Balken in der Sonne
      const heights = [0.07, 0.13, 0.19, 0.13, 0.07];
      const bw = 0.034 * (1 - pad * 0.6), gap = 0.062 * (1 - pad * 0.6);
      heights.forEach((hh0, i) => {
        const hh = hh0 * (1 - pad * 0.6);
        const bx = cx + (i - 2) * gap;
        const dx = Math.abs(u - bx), dy = Math.abs(v - cy);
        const inRect = dx < bw / 2 && dy < hh - bw / 2;
        const inCap = dx < bw / 2 && (dx ** 2 + (dy - (hh - bw / 2)) ** 2 < (bw / 2) ** 2);
        if (inRect || inCap) c = bar;
      });
      acc = acc.map((a, i) => a + c[i]);
    }
    const o = (y * size + x) * 4;
    px[o] = acc[0] / (S * S); px[o + 1] = acc[1] / (S * S); px[o + 2] = acc[2] / (S * S); px[o + 3] = 255;
  }
  return png(size, size, px);
}
for (const [name, size, mask] of [['icon-180.png', 180, false], ['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true]]) {
  writeFileSync(join(out, name), draw(size, mask));
  console.log('ok', name);
}
