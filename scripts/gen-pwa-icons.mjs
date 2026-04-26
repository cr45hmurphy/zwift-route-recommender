// Generates solid-color PNG icons for the PWA manifest using only Node.js built-ins.
import { createDeflate } from 'zlib';
import { writeFileSync } from 'fs';
import { promisify } from 'util';
import { pipeline } from 'stream';
import { Readable, Writable } from 'stream';

const pipelineAsync = promisify(pipeline);

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length);
  const body = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(body));
  return Buffer.concat([lenBuf, body, crcBuf]);
}

async function buildPNG(size, r, g, b) {
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR: width, height, bit depth 8, color type 2 (RGB), compression 0, filter 0, interlace 0
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Build raw scanlines: filter byte 0 + RGB per pixel
  const rowSize = 1 + size * 3;
  const raw = Buffer.allocUnsafe(size * rowSize);
  for (let y = 0; y < size; y++) {
    const off = y * rowSize;
    raw[off] = 0; // filter type None
    for (let x = 0; x < size; x++) {
      raw[off + 1 + x * 3 + 0] = r;
      raw[off + 1 + x * 3 + 1] = g;
      raw[off + 1 + x * 3 + 2] = b;
    }
  }

  // Compress with deflate
  const compressed = await new Promise((resolve, reject) => {
    const chunks = [];
    const deflate = createDeflate({ level: 6 });
    deflate.on('data', d => chunks.push(d));
    deflate.on('end', () => resolve(Buffer.concat(chunks)));
    deflate.on('error', reject);
    deflate.end(raw);
  });

  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// #e47000 → rgb(228, 112, 0)
const sizes = [192, 512];
for (const size of sizes) {
  const png = await buildPNG(size, 228, 112, 0);
  const outPath = `public/assets/icon-${size}.png`;
  writeFileSync(outPath, png);
  console.log(`Written ${outPath} (${png.length} bytes)`);
}
