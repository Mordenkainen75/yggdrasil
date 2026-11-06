// Draws the app icons with no image tools: a curled line-art wyrm around a hex,
// written straight to PNG. Run with `npm run icons`.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function makeIcon(size: number): Buffer {
  // All shapes sit in the centre 70%, the safe zone for Android's masked icons.
  const spiral: [number, number][] = [];
  for (let i = 0; i <= 90; i++) {
    const t = i / 90;
    const a = t * Math.PI * 3.1 + 2.4;
    const r = 0.33 - 0.19 * t;
    spiral.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r]);
  }
  const hex = Array.from({ length: 7 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    return [0.5 + Math.cos(a) * 0.075, 0.5 + Math.sin(a) * 0.075] as [number, number];
  });

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      let wyrm = Infinity;
      for (let i = 1; i < spiral.length; i++) {
        const width = 0.04 * (1 - (i / spiral.length) * 0.65);
        wyrm = Math.min(wyrm, distToSegment(u, v, spiral[i - 1][0], spiral[i - 1][1], spiral[i][0], spiral[i][1]) - width);
      }
      let core = Infinity;
      for (let i = 1; i < hex.length; i++) {
        core = Math.min(core, distToSegment(u, v, hex[i - 1][0], hex[i - 1][1], hex[i][0], hex[i][1]) - 0.009);
      }
      const edge = 1.5 / size;
      const a = Math.max(0, Math.min(1, 0.5 - wyrm / edge));
      const c = Math.max(0, Math.min(1, 0.5 - core / edge));
      const bgGlow = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) * 2) * 26;
      let red = 7 + bgGlow * 0.5;
      let green = 6 + bgGlow * 0.2;
      let blue = 15 + bgGlow;
      red += (255 - red) * a;
      green += (180 - green) * a;
      blue += (84 - blue) * a;
      red += (125 - red) * c;
      green += (240 - green) * c;
      blue += (208 - blue) * c;
      const o = row + 1 + x * 4;
      raw[o] = red;
      raw[o + 1] = green;
      raw[o + 2] = blue;
      raw[o + 3] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  writeFileSync(`public/icon-${size}.png`, makeIcon(size));
  console.log(`wrote public/icon-${size}.png`);
}
