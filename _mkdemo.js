/* 生成一张测试用的拼豆图纸 PNG（24×24 心形），仅用于本地视觉核对，输出到 testdata/（已 gitignore）
 * 运行：node _mkdemo.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const N = 24, CELL = 20, PAD = 20;
const W = N * CELL + PAD * 2, H = W;

const COLORS = {
  '.': [255, 255, 255],
  r: [232, 85, 47],
  o: [245, 160, 90],
  d: [58, 42, 34],
  p: [244, 192, 209],
  w: [255, 250, 240]
};

// 24×24 心形（手绘）
const MAP = [
  '........................',
  '........................',
  '...dddd........dddd.....',
  '..drrrrd......drrrrd....',
  '.drrrrrrd....drrrrrrd...',
  '.drrrrrrrd..drrrrrrrd...',
  'drrrrrrrrrddrrrrrrrrrd..',
  'drrrrrrrrrrrrrrrrrrrrd..',
  'drrrrrrrrrrrrrrrrrrrrd..',
  'drrrrrrrrrrrrrrrrrrrrd..',
  '.drrrrrrrrrrrrrrrrrrd...',
  '..drrrrrrrrrrrrrrrrd....',
  '...drrrrrrrrrrrrrrd.....',
  '....drrrrrrrrrrrrd......',
  '.....drrrrrrrrrrd.......',
  '......drrrrrrrrd........',
  '.......drrrrrrd.........',
  '........drrrrd..........',
  '.........drrd...........',
  '..........dd............',
  '........................',
  '........................',
  '........................',
  '........................'
];

function px(x, y) {
  const cx = Math.floor((x - PAD) / CELL), cy = Math.floor((y - PAD) / CELL);
  if (cx < 0 || cy < 0 || cx >= N || cy >= N) return [255, 255, 255];
  const lx = (x - PAD) % CELL, ly = (y - PAD) % CELL;
  if (lx < 2 || ly < 2) return [150, 152, 158];            // 网格线（深一点，便于自动对齐）
  const ch = (MAP[cy] || '')[cx] || '.';
  return COLORS[ch] || COLORS['.'];
}

// ---- 最小 PNG 编码 ----
const raw = Buffer.alloc((W * 3 + 1) * H);
let p = 0;
for (let y = 0; y < H; y++) {
  raw[p++] = 0;
  for (let x = 0; x < W; x++) {
    const c = px(x, y);
    raw[p++] = c[0]; raw[p++] = c[1]; raw[p++] = c[2];
  }
}

const table = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

module.exports = {
  build: function () {
    var d = new Uint8ClampedArray(W * H * 4), q = 0, x, y, c;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      c = px(x, y);
      d[q++] = c[0]; d[q++] = c[1]; d[q++] = c[2]; d[q++] = 255;
    }
    return { data: d, w: W, h: H, n: N, cell: CELL, pad: PAD, map: MAP, colors: COLORS };
  }
};

if (require.main !== module) return;

const outDir = path.join(__dirname, 'testdata');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'demo.png');
fs.writeFileSync(out, png);
console.log('已生成 ' + out + '（' + W + '×' + H + '，' + N + '×' + N + ' 格）');
