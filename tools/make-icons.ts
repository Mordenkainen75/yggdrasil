// Draws the app icons with no image tools: a world-tree rune inside a hex,
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
  // A trunk with two branches above and two roots below.
  const tree: [number, number, number, number][] = [
    [0.5, 0.25, 0.5, 0.75],
    [0.5, 0.45, 0.38, 0.31],
    [0.5, 0.45, 0.62, 0.31],
    [0.5, 0.56, 0.38, 0.69],
    [0.5, 0.56, 0.62, 0.69],
  ];
  const hex = Array.from({ length: 7 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    return [0.5 + Math.cos(a) * 0.34, 0.5 + Math.sin(a) * 0.34] as [number, number];
  });

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      let rune = Infinity;
      for (const [ax, ay, bx, by] of tree) {
        rune = Math.min(rune, distToSegment(u, v, ax, ay, bx, by) - 0.024);
      }
      let frame = Infinity;
      for (let i = 1; i < hex.length; i++) {
        frame = Math.min(frame, distToSegment(u, v, hex[i - 1][0], hex[i - 1][1], hex[i][0], hex[i][1]) - 0.011);
      }
      const edge = 1.5 / size;
      const a = Math.max(0, Math.min(1, 0.5 - rune / edge));
      const c = Math.max(0, Math.min(1, 0.5 - frame / edge));
      const bgGlow = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) * 2) * 26;
      let red = 7 + bgGlow * 0.3;
      let green = 10 + bgGlow * 0.5;
      let blue = 16 + bgGlow;
      red += (255 - red) * a;
      green += (180 - green) * a;
      blue += (84 - blue) * a;
      red += (185 - red) * c;
      green += (214 - green) * c;
      blue += (242 - blue) * c;
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
