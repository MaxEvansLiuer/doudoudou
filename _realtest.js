/* 真实截图评测（与 app 内流程一致）：自动对齐 → 采样 → 按图例总数自动调空白阈值 → 按数量定色号 → 核对
 * node _realtest.js [name]
 */
'use strict';
const fs = require('fs'), path = require('path');
const PC = require('./core.js');
const pal = require('../mard-palette.json');
PC.init(pal.colors);
const DIR = path.join(__dirname, '..', 'testdata');
const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json'), 'utf8'));

const CASES = {
  yinxingye: { gw: 27, gh: 27, legend: { A20: 109, A13: 77, A26: 68, F11: 56, F10: 28, G6: 19, A6: 13, G13: 10, F18: 5 } },
  siyecao: { gw: 35, gh: 39, legend: { B16: 287, B14: 132, E16: 126, B31: 103, B30: 81, F14: 68, E11: 30, E15: 8, F21: 6, F11: 4 } },
  kitty: { gw: 50, gh: 52, legend: { G8: 303, H2: 266, G20: 130, F11: 66, G9: 56, F19: 48, F6: 45, F10: 41, M13: 31, A6: 30, A14: 20, A7: 17, E15: 10, A25: 2 } },
  gridnine: { gw: 70, gh: 70, legend: { H7: 714, A7: 178, H2: 176, H6: 175, A26: 71, H11: 36, D6: 22, E18: 8, D7: 7, B17: 4, F13: 4 } },
  huaxiangsu: { gw: 48, gh: 48, legend: null, total: 2304 },
  xiaowangzi: { gw: 99, gh: 103, legend: null, total: 5159 },
  mard3646: { gw: 85, gh: 97, legend: { H1: 673, D9: 552, H2: 492, D6: 391, D18: 348, D23: 342, D14: 181, D26: 172, D8: 161, D21: 147, D7: 140, D5: 45, E8: 1, H3: 1 } }
};

function load(name) {
  const m = meta[name];
  return { data: new Uint8ClampedArray(fs.readFileSync(path.join(DIR, name + '.rgba'))), iw: m.w, ih: m.h };
}
function beadCount(samples, bg, thr) {
  let n = 0;
  for (const sm of samples) if (!PC.isEmptyCell(sm, bg, thr)) n++;
  return n;
}

const names = process.argv[2] ? [process.argv[2]] : Object.keys(CASES);
const summary = [];
for (const name of names) {
  const c = CASES[name];
  const { data, iw, ih } = load(name);
  const t0 = Date.now();
  const geo = PC.autoAlign(data, iw, ih, c.gw, c.gh);
  const tAlign = Date.now() - t0;
  const legendTotal = c.legend ? Object.values(c.legend).reduce((a, b) => a + b, 0) : (c.total || 0);
  const legendCount = c.legend ? Object.keys(c.legend).length : 0;
  console.log(`\n===== ${name} ${iw}×${ih} 真值 ${c.gw}×${c.gh}` +
    (c.legend ? ` / ${legendCount}色 / ${legendTotal}颗` : '') + ' =====');
  if (!geo) {
    console.log('  ✗ 自动对齐失败（需手动框选）');
    summary.push({ name, align: '✗', beads: '-', ok: '-' });
    continue;
  }
  console.log(`  对齐 ${geo.cw.toFixed(2)}×${geo.ch.toFixed(2)} 起点 ${geo.gx.toFixed(1)},${geo.gy.toFixed(1)} (${tAlign}ms)`);
  const r = PC.sampleGrid(data, iw, ih, geo, 22);
  let bestThr = 22, bestDiff = Infinity, bestN = 0;
  if (legendTotal) {
    for (const thr of [10, 14, 18, 22, 26, 30, 34, 38, 44, 50, 56]) {
      const n = beadCount(r.samples, r.bg, thr);
      const d = Math.abs(n - legendTotal);
      if (d < bestDiff) { bestDiff = d; bestThr = thr; bestN = n; }
    }
  }
  const nFinal = legendTotal ? bestN : beadCount(r.samples, r.bg, 22);
  const t1 = Date.now();
  const b = PC.buildClusters(r.samples, bestThr, r.bg, { maxColors: legendCount });
  let cells = b.cells;
  if (c.legend) {
    var legendArr = Object.keys(c.legend).map(k => ({ code: k, count: c.legend[k] }));
    var cap = PC.assignLegend(b.clusters, r.samples, legendArr);
    if (cap) {
      cells = cap.cells;
      console.log('  （用图例数量做容量分配：成功）');
    } else {
      PC.matchByLegend(b.clusters, legendArr);
      cells = PC.applyCodes(b.clusters, r.samples.length);
      console.log('  （容量分配不可用：豆数与图例总数不等，退回颜色聚类）');
    }
  }
  const st = PC.countCodes(cells);
  console.log(`  阈值=${bestThr}  色簇=${b.clusters.length}${legendCount ? '/' + legendCount : ''}  ` +
    `豆=${nFinal}${legendTotal ? '/' + legendTotal : ''}  采样聚类 ${Date.now() - t1}ms`);
  if (c.legend) {
    const got = {};
    st.rows.forEach(x => { got[x.code] = x.n; });
    let okColors = 0;
    for (const k of Object.keys(c.legend)) if (got[k] === c.legend[k]) okColors++;
    const wantC = Object.values(c.legend).sort((a, b2) => b2 - a);
    const gotC = b.clusters.map(x => x.cells.length).sort((a, b2) => b2 - a);
    let exact = 0;
    for (let i = 0; i < Math.min(wantC.length, gotC.length); i++) if (wantC[i] === gotC[i]) exact++;
    console.log(`  色号数量完全对上：${okColors}/${legendCount}（只看数量吻合 ${exact}/${wantC.length}）`);
    summary.push({ name, align: '✓', beads: nFinal + '/' + legendTotal, ok: okColors + '/' + legendCount });
  } else {
    console.log(`  豆=${nFinal}${c.total ? ' / 真值 ' + c.total : ''}`);
    summary.push({ name, align: '✓', beads: nFinal + '/' + (c.total || '?'), ok: '-' });
  }
}
console.log('\n====== 汇总 ======');
summary.forEach(s => console.log(`  ${s.name.padEnd(11)} 对齐${s.align}  豆 ${String(s.beads).padEnd(12)} 色号 ${s.ok}`));
