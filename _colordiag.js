/* 颜色诊断：跑一遍 采样 → 聚类 → 配色 全链路，把每簇的"真实色 / 采样色 / 分配色号"摊开对比
 * 用法：node _colordiag.js
 * 目的：量化颜色误差到底出在哪一步（采样 / 聚类合并 / 色卡匹配）
 */
'use strict';
const PC = require('./core.js');
global.window = {};
require('./mard-palette.js');
const PAL = global.window.MARD_PALETTE;
PC.init(PAL);

const { build } = require('./_mkdemo.js');
const img = build();
const { data, w, h, n: N, cell: CELL, pad: PAD, colors } = img;

const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const hexOf = (code) => {
  const c = PAL.find((p) => p.code === code);
  return c ? c.hex : '?';
};

console.log('=== 1. 原图真实色（生成时用的） ===');
Object.keys(colors).forEach((k) => {
  if (k === '.') return;
  console.log('  ' + k + '  ' + hex(colors[k]) + '  rgb(' + colors[k].join(',') + ')');
});
console.log('  背景  #FFFFFF   网格线 ' + hex([150, 152, 158]));

console.log('\n=== 2. 自动对齐 ===');
const geo = PC.autoAlign(data, w, h, N, N);
if (!geo) { console.log('  对齐失败'); process.exit(1); }
console.log('  期望 cell=' + CELL + ' start=' + PAD + '  实得 cell=' + geo.cw.toFixed(2) + ' start=' + geo.gx.toFixed(2) + ',' + geo.gy.toFixed(2));

console.log('\n=== 3. 采样（每格众数色） ===');
const { samples, bg } = PC.sampleGrid(data, w, h, geo, 22);
console.log('  背景判定 rgb(' + bg.join(',') + ')');

const byCell = new Map();
samples.forEach((sm, i) => {
  const ch = (img.map[(i / N) | 0] || '')[i % N] || '.';
  if (ch === '.') return;
  const k = ch;
  if (!byCell.has(k)) byCell.set(k, []);
  byCell.get(k).push(sm.rgb);
});
byCell.forEach((list, ch) => {
  const avg = [0, 1, 2].map((c2) => list.reduce((a, b) => a + b[c2], 0) / list.length);
  const trueRgb = colors[ch];
  console.log('  字母 ' + ch + '：' + list.length + ' 格  采样均值 ' + hex(avg) +
    '  真实 ' + hex(trueRgb) + '  ΔE=' + PC.deRgb(avg, trueRgb).toFixed(2));
});

console.log('\n=== 4. 聚类 ===');
const res = PC.buildClusters(samples, 22, bg, {});
console.log('  色簇数：' + res.clusters.length + '  豆子：' + res.beadCount);
res.clusters.forEach((c2, i) => {
  const de = PC.deRgb(c2.rgb, c2.candidates[0] ? [0, 0, 0] : [0, 0, 0]);
  console.log('  #' + (i + 1) + '  ' + c2.cells.length + ' 格  采样色 ' + hex(c2.rgb) +
    '  → 色号 ' + c2.code + ' (' + hexOf(c2.code) + ')  ΔE=' + c2.de.toFixed(2) +
    '  次选 ' + (c2.candidates[1] ? c2.candidates[1].code + ' ΔE=' + c2.candidates[1].de.toFixed(2) : '-'));
});

console.log('\n=== 5. 分配色号后的整体色差 ===');
let sum = 0, cnt = 0, worst = 0;
res.clusters.forEach((c2) => {
  const target = PAL.find((p) => p.code === c2.code);
  if (!target) return;
  const d = PC.deRgb(c2.rgb, target.rgb);
  sum += d * c2.cells.length; cnt += c2.cells.length;
  if (d > worst) worst = d;
});
console.log('  按颗数加权平均 ΔE：' + (sum / Math.max(1, cnt)).toFixed(2) + '   最大 ΔE：' + worst.toFixed(2));
console.log('  （参考：ΔE<2 肉眼几乎无差，2~5 能看出差，>5 明显不同色）');
