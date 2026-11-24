// Renders icons/icon-{16,32,48,128}.png with no dependencies (zlib PNG encoder,
// 4x4 supersampling). Run: npm run icons
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// Shapes in unit space, painted in order. r = corner radius; top = round only top corners.
const SHAPES = [
  { x0: 0, y0: 0, x1: 1, y1: 1, r: 0.22, c: hex('#1d1b16') },
  { x0: 0.14, y0: 0.47, x1: 0.36, y1: 0.72, r: 0.05, top: true, c: hex('#8a857a') },
  { x0: 0.39, y0: 0.47, x1: 0.61, y1: 0.72, r: 0.05, top: true, c: hex('#8a857a') },
  { x0: 0.64, y0: 0.28, x1: 0.86, y1: 0.72, r: 0.05, top: true, c: hex('#f97316') },
  { x0: 0.12, y0: 0.72, x1: 0.88, y1: 0.79, r: 0.02, c: hex('#f6f3ec') },
];

function inside(s, x, y) {
  if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) return false;
  const r = s.r;
  const cx = x < s.x0 + r ? s.x0 + r : x > s.x1 - r ? s.x1 - r : x;
  let cy = y < s.y0 + r ? s.y0 + r : y > s.y1 - r ? s.y1 - r : y;
  if (s.top && y > s.y1 - r) cy = y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function render(size) {
  const SS = 4;
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          let col = null;
          for (const s of SHAPES) if (inside(s, x, y)) col = s.c;
          if (col) { r += col[0]; g += col[1]; b += col[2]; a += 1; }
        }
      }
      const o = 1 + px * 4;
      if (a) { row[o] = r / a; row[o + 1] = g / a; row[o + 2] = b / a; }
      row[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
    rows.push(row);
  }
  return png(size, Buffer.concat(rows));
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(join(root, 'icons'), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(root, 'icons', `icon-${size}.png`), render(size));
}
console.log('icons written');
