/**
 * Erzeugt die App-Icons (PNG) ohne externe Bibliotheken:
 * grünes Feld mit Karten-Pin und gestrichelter Route.
 * Aufruf: node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const GREEN = [31, 111, 92];
const WHITE = [255, 255, 255];
const SAND = [244, 242, 236];
const ACCENT = [217, 115, 44];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(path, size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

// Route als Punktliste (einmal vorberechnet)
const ROUTE = [];
for (let i = 0; i <= 800; i++) {
  const t = i / 800;
  if (Math.floor(t * 14) % 2 !== 0) continue; // gestrichelt
  ROUTE.push([0.16 + 0.44 * t, 0.86 - 0.2 * t - 0.1 * Math.sin(t * Math.PI * 1.6)]);
}

function shade(u, v, maskable) {
  const r = maskable ? 0 : 0.22;
  const dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
  if (!maskable && Math.hypot(dx, dy) > r) return null;
  const s = maskable ? 0.76 : 1;
  const x = (u - 0.5) / s + 0.5;
  const y = (v - 0.5) / s + 0.5;
  // Pin
  const cx = 0.6;
  const cy = 0.4;
  const cr = 0.21;
  const d = Math.hypot(x - cx, y - cy);
  const inTip = y >= 0.4 && y <= 0.8 && Math.abs(x - cx) <= ((0.8 - y) / 0.4) * cr * 0.95;
  if (d <= cr || inTip) return d <= cr * 0.42 ? ACCENT : WHITE;
  if (x > 0.1 && x < 0.66 && y > 0.5 && y < 0.92) {
    for (const [px, py] of ROUTE) if (Math.hypot(x - px, y - py) < 0.028) return SAND;
  }
  return GREEN;
}

function render(size, maskable) {
  const ss = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sj = 0; sj < ss; sj++) {
        for (let si = 0; si < ss; si++) {
          const c = shade((i + (si + 0.5) / ss) / size, (j + (sj + 0.5) / ss) / size, maskable);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a++;
        }
      }
      const o = (j * size + i) * 4;
      if (a > 0) {
        buf[o] = Math.round(r / a);
        buf[o + 1] = Math.round(g / a);
        buf[o + 2] = Math.round(b / a);
        buf[o + 3] = Math.round((a / (ss * ss)) * 255);
      }
    }
  }
  return buf;
}

mkdirSync('public', { recursive: true });
for (const [size, name, maskable] of [
  [192, 'icon-192.png', false],
  [512, 'icon-512.png', false],
  [512, 'icon-maskable-512.png', true],
  [180, 'apple-touch-icon.png', true],
  [32, 'favicon-32.png', false],
]) {
  png(`public/${name}`, size, render(size, maskable));
  console.log('ok', name);
}
