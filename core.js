/* 拼豆图纸识别 —— 核心算法（无 DOM 依赖，可用 node 单独测试）
 * v2：改为"格内众数色 + 纯色彩聚类 + 用图例数量反向定色号"，并把网格自动对齐换成投影强线法
 */
(function (root, factory) {
  var api = factory();
  if (root) root.PindouCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PAL = [], STD = [], SPECIAL = [], labCache = new Map();
  var MAT = { P: '珠光', Q: '温变', R: '半透明', T: '全透明', Y: '夜光', ZG: '光变' };

  function init(palette) {
    PAL = palette || [];
    STD = PAL.filter(function (c) { return !c.special; });
    SPECIAL = PAL.filter(function (c) { return c.special; });
    labCache = new Map();
  }
  function palette() { return PAL; }
  function seriesOf(code) { var m = String(code).match(/^[A-Z]+/); return m ? m[0] : ''; }
  function materialOf(code) { return MAT[seriesOf(code)] || '实色'; }
  function byCode(code) {
    for (var i = 0; i < PAL.length; i++) if (PAL[i].code === code) return PAL[i];
    return null;
  }

  // ==================== 颜色数学 ====================
  function rgb2lab(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
    var X = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
    var Y = (r * 0.2126729 + g * 0.7151522 + b * 0.0721750);
    var Z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883;
    function f(t) { return t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116); }
    var fx = f(X), fy = f(Y), fz = f(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function hueOf(b, a) {
    if (a === 0 && b === 0) return 0;
    var h = Math.atan2(b, a) * 180 / Math.PI;
    return h < 0 ? h + 360 : h;
  }
  function ciede2000(l1, l2) {
    var L1 = l1[0], a1 = l1[1], b1 = l1[2], L2 = l2[0], a2 = l2[1], b2 = l2[2];
    var C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
    var Cb = (C1 + C2) / 2;
    var Cb7 = Math.pow(Cb, 7), G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + Math.pow(25, 7))));
    var a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    var C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
    var h1p = hueOf(b1, a1p), h2p = hueOf(b2, a2p);
    var dLp = L2 - L1, dCp = C2p - C1p, dhp = 0;
    if (C1p * C2p !== 0) {
      dhp = h2p - h1p;
      if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
    }
    var dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * Math.PI / 360);
    var Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2, hbp;
    if (C1p * C2p === 0) hbp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbp = (h1p + h2p + 360) / 2;
    else hbp = (h1p + h2p - 360) / 2;
    var T = 1 - 0.17 * Math.cos((hbp - 30) * Math.PI / 180)
      + 0.24 * Math.cos(2 * hbp * Math.PI / 180)
      + 0.32 * Math.cos((3 * hbp + 6) * Math.PI / 180)
      - 0.20 * Math.cos((4 * hbp - 63) * Math.PI / 180);
    var dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
    var Cbp7 = Math.pow(Cbp, 7), RC = 2 * Math.sqrt(Cbp7 / (Cbp7 + Math.pow(25, 7)));
    var SL = 1 + 0.015 * Math.pow(Lbp - 50, 2) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
    var SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
    var RT = -Math.sin(2 * dTheta * Math.PI / 180) * RC;
    var t1 = dLp / SL, t2 = dCp / SC, t3 = dHp / SH;
    return Math.sqrt(t1 * t1 + t2 * t2 + t3 * t3 + RT * t2 * t3);
  }
  function labOf(rgb) {
    var k = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
    var v = labCache.get(k);
    if (!v) { v = rgb2lab(rgb); if (labCache.size < 40000) labCache.set(k, v); }
    return v;
  }
  function deRgb(a, b) { return ciede2000(labOf(a), labOf(b)); }
  function rgbDist(a, b) {
    var dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }
  function lumOfHex(hex) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // ==================== 单格采样 ====================
  // 取格中心 70% 区域 → 亮度 2-means 分成「填充色簇 / 字迹簇」
  // 填充色用**众数色**（数字版图纸每格是纯色，众数最接近真实渲染色，不受文字抗锯齿影响）
  function cellStats(data, iw, ih, g, r, c) {
    var cw = g.cw, ch = g.ch;
    var x0 = g.gx + c * cw, y0 = g.gy + r * ch;
    var xa = Math.round(x0 + cw * 0.16), xb = Math.round(x0 + cw * 0.84);
    var ya = Math.round(y0 + ch * 0.16), yb = Math.round(y0 + ch * 0.84);
    xa = xa < 0 ? 0 : (xa > iw - 1 ? iw - 1 : xa);
    xb = xb < xa ? xa : (xb > iw - 1 ? iw - 1 : xb);
    ya = ya < 0 ? 0 : (ya > ih - 1 ? ih - 1 : ya);
    yb = yb < ya ? ya : (yb > ih - 1 ? ih - 1 : yb);
    var cnt = (xb - xa + 1) * (yb - ya + 1);
    if (cnt <= 3 || xb <= xa || yb <= ya) return { rgb: [255, 255, 255], text: 0, inkDe: 0, cov: 0, oob: true };

    var lum = new Float32Array(cnt);
    var minL = 255, maxL = 0, k = 0, o, x, y, l;
    for (y = ya; y <= yb; y++) {
      o = (y * iw + xa) * 4;
      for (x = xa; x <= xb; x++, o += 4) {
        l = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
        lum[k++] = l;
        if (l < minL) minL = l;
        if (l > maxL) maxL = l;
      }
    }
    var c1 = minL, c2 = maxL;
    if (c2 - c1 < 6) c2 = c1 + 6;
    var n1 = 0, n2 = 0, s1, s2, i2, lv, it;
    for (it = 0; it < 3; it++) {
      s1 = 0; s2 = 0; n1 = 0; n2 = 0;
      for (i2 = 0; i2 < cnt; i2++) {
        lv = lum[i2];
        if (Math.abs(lv - c1) <= Math.abs(lv - c2)) { s1 += lv; n1++; } else { s2 += lv; n2++; }
      }
      if (n1) c1 = s1 / n1;
      if (n2) c2 = s2 / n2;
    }
    var useC1 = n1 >= n2;
    var target = useC1 ? c1 : c2;
    var other = useC1 ? c2 : c1;

    var modeMap = new Map(), modeBest = null, modeKey, me;
    var ir = 0, ig = 0, ib = 0, cntInk = 0, cntFill = 0;
    k = 0;
    for (y = ya; y <= yb; y++) {
      o = (y * iw + xa) * 4;
      for (x = xa; x <= xb; x++, o += 4) {
        l = lum[k++];
        if (Math.abs(l - target) > Math.abs(l - other)) {
          ir += data[o]; ig += data[o + 1]; ib += data[o + 2]; cntInk++;
          continue;
        }
        cntFill++;
        modeKey = ((data[o] >> 1) << 16) | ((data[o + 1] >> 1) << 8) | (data[o + 2] >> 1);
        me = modeMap.get(modeKey);
        if (!me) { me = { n: 0, r: 0, g: 0, b: 0 }; modeMap.set(modeKey, me); }
        me.n++; me.r += data[o]; me.g += data[o + 1]; me.b += data[o + 2];
        if (!modeBest || me.n > modeBest.n) modeBest = me;
      }
    }
    if (!cntFill || !modeBest) return { rgb: [255, 255, 255], text: 0, inkDe: 0, cov: 0, oob: false };
    var fr = modeBest.r / modeBest.n, fg = modeBest.g / modeBest.n, fb = modeBest.b / modeBest.n;
    var inkDe = 0;
    if (cntInk) inkDe = deRgb([Math.round(ir / cntInk), Math.round(ig / cntInk), Math.round(ib / cntInk)],
                              [Math.round(fr), Math.round(fg), Math.round(fb)]);
    var far = 0, dr, dg, db;
    k = 0;
    for (y = ya; y <= yb; y++) {
      o = (y * iw + xa) * 4;
      for (x = xa; x <= xb; x++, o += 4) {
        k++;
        dr = data[o] - fr; dg = data[o + 1] - fg; db = data[o + 2] - fb;
        if (dr * dr + dg * dg + db * db > 3600) far++;
      }
    }
    return {
      rgb: [Math.round(fr), Math.round(fg), Math.round(fb)],
      text: Math.min(n1, n2) / cnt,
      inkDe: inkDe,
      cov: far / cnt,
      oob: false
    };
  }

  function sampleGrid(data, iw, ih, geo, inkThr) {
    var gw = geo.gw, gh = geo.gh, n = gw * gh;
    var samples = new Array(n);
    for (var r = 0; r < gh; r++) {
      for (var c = 0; c < gw; c++) samples[r * gw + c] = cellStats(data, iw, ih, geo, r, c);
    }
    var bg = estimateBgOutside(data, iw, ih, geo);
    return { samples: samples, bg: bg };
  }

  // 背景 = 网格框外的画面主色（图纸外都是页面底色，比"全图主色"可靠）
  function estimateBgOutside(data, iw, ih, geo) {
    var map = new Map(), best = null, i, e, key;
    function add(x, y) {
      if (x < 0 || y < 0 || x >= iw || y >= ih) return;
      var o = (y * iw + x) * 4;
      key = ((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3);
      e = map.get(key);
      if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; map.set(key, e); }
      e.n++; e.r += data[o]; e.g += data[o + 1]; e.b += data[o + 2];
    }
    var m = 4;
    var L = Math.max(0, Math.floor(geo.gx - m)), R = Math.min(iw, Math.ceil(geo.gx + geo.gw * geo.cw + m));
    var T = Math.max(0, Math.floor(geo.gy - m)), B = Math.min(ih, Math.ceil(geo.gy + geo.gh * geo.ch + m));
    var x, y;
    for (y = 0; y < ih; y += 2) {
      for (x = 0; x < iw; x += 2) {
        if (x >= L && x < R && y >= T && y < B) continue;
        add(x, y);
      }
    }
    map.forEach(function (v) { if (!best || v.n > best.n) best = v; });
    if (!best || !best.n) {   // 网格占满整图 → 退回全图主色
      map = new Map(); best = null;
      for (y = 0; y < ih; y += 2) for (x = 0; x < iw; x += 2) add(x, y);
      map.forEach(function (v) { if (!best || v.n > best.n) best = v; });
    }
    if (!best || !best.n) return [255, 255, 255];
    return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
  }

  // 空格判定：靠"格子里有没有真正的字"（色号文字对比度高；水印对比度低）
  function isEmptyCell(sm, bg, inkThr) {
    if (!sm || sm.oob) return true;
    if (sm.text >= 0.03 && sm.inkDe >= inkThr) return false;
    if (deRgb(sm.rgb, bg) < 12) return true;
    return false;
  }

  // ==================== 色簇（按"最常见渲染色"投票） ====================
  // 同一色号在同一张图里渲染色一致 → 先统计出现最多的若干种颜色（量化后合并），
  // 再把每格分配给最近的一种。这样不会被水印/压缩造成的少量离群点拆成碎簇。
  function medianColor(cellsArr, samples) {
    var rs = [], gs = [], bs = [], i;
    for (i = 0; i < cellsArr.length; i++) {
      var sm = samples[cellsArr[i]];
      rs.push(sm.rgb[0]); gs.push(sm.rgb[1]); bs.push(sm.rgb[2]);
    }
    rs.sort(function (a, b) { return a - b; });
    gs.sort(function (a, b) { return a - b; });
    bs.sort(function (a, b) { return a - b; });
    var m = rs.length >> 1;
    return [rs[m], gs[m], bs[m]];
  }

  function buildClusters(samples, inkThr, bg, opts) {
    opts = opts || {};
    var n = samples.length;
    var maxColors = opts.maxColors || 0;         // 已知色数时用它（最准）
    var minShare = opts.minShare == null ? 0.004 : opts.minShare;
    var i, j, sm;

    // 1) 非空格 + 量化计数
    var keys = new Map(), beadCells = [];
    for (i = 0; i < n; i++) {
      sm = samples[i];
      if (isEmptyCell(sm, bg, inkThr)) continue;
      beadCells.push(i);
      var key = ((sm.rgb[0] >> 2) << 12) | ((sm.rgb[1] >> 2) << 6) | (sm.rgb[2] >> 2);
      var e = keys.get(key);
      if (!e) { e = { n: 0, r: 0, g: 0, b: 0, cells: [] }; keys.set(key, e); }
      e.n++; e.r += sm.rgb[0]; e.g += sm.rgb[1]; e.b += sm.rgb[2]; e.cells.push(i);
    }
    // 2) 按票数降序，合并 ΔE<2.5 的近邻
    var buckets = Array.from(keys.values()).sort(function (a, b) { return b.n - a.n; });
    var totalBeads = beadCells.length;
    var paletteColors = [];
    for (i = 0; i < buckets.length; i++) {
      var bk = buckets[i];
      var rgb = [Math.round(bk.r / bk.n), Math.round(bk.g / bk.n), Math.round(bk.b / bk.n)];
      var merged = false;
      for (j = 0; j < paletteColors.length; j++) {
        if (deRgb(rgb, paletteColors[j].rgb) < 2.5) {
          paletteColors[j].cells = paletteColors[j].cells.concat(bk.cells);
          paletteColors[j].count += bk.n;
          merged = true;
          break;
        }
      }
      if (!merged) paletteColors.push({ rgb: rgb, cells: bk.cells.slice(), count: bk.n });
    }
    paletteColors.sort(function (a, b) { return b.count - a.count; });
    // 2b) 只并掉"噪声级"的近似桶（ΔE<3），**不**为了凑 N 色而把真正的相邻色号并掉
    (function () {
      var changed = true, guard = 0;
      while (changed && guard++ < 400) {
        changed = false;
        for (i = 0; i < paletteColors.length && !changed; i++) {
          for (j = i + 1; j < paletteColors.length; j++) {
            if (deRgb(paletteColors[i].rgb, paletteColors[j].rgb) < 4.5) {
              var A2 = paletteColors[i], B2 = paletteColors[j];
              var tot2 = A2.count + B2.count;
              A2.rgb = [
                Math.round((A2.rgb[0] * A2.count + B2.rgb[0] * B2.count) / tot2),
                Math.round((A2.rgb[1] * A2.count + B2.rgb[1] * B2.count) / tot2),
                Math.round((A2.rgb[2] * A2.count + B2.rgb[2] * B2.count) / tot2)
              ];
              A2.count = tot2;
              A2.cells = A2.cells.concat(B2.cells);
              paletteColors.splice(j, 1);
              changed = true;
              break;
            }
          }
        }
      }
    })();
    paletteColors.sort(function (a, b) { return b.count - a.count; });
    var keep = paletteColors.slice();   // 不再按色数截断：先保留所有分得开的颜色，再由图例数量决定合并
    // 3) 每格分配给最近的保留色
    var clusOf = new Int32Array(n).fill(-1);
    var clusters = keep.map(function (c2, idx) { return { id: idx, rgb: c2.rgb.slice(), cells: [], _s: [0, 0, 0], _n: 0 }; });
    for (i = 0; i < beadCells.length; i++) {
      var ci = beadCells[i], rgb2 = samples[ci].rgb;
      var best = -1, bestD = 1e9;
      for (j = 0; j < clusters.length; j++) {
        var d = deRgb(rgb2, clusters[j].rgb);
        if (d < bestD) { bestD = d; best = j; }
      }
      if (best < 0) continue;
      clusters[best].cells.push(ci);
      clusters[best]._s[0] += rgb2[0]; clusters[best]._s[1] += rgb2[1]; clusters[best]._s[2] += rgb2[2];
      clusters[best]._n++;
      clusOf[ci] = best;
    }
    // 4) 用中位数当最终渲染色，剔除空簇
    clusters = clusters.filter(function (c2) { return c2.cells.length > 0; });
    clusters.forEach(function (c2, idx) {
      c2.id = idx;
      c2.rgb = medianColor(c2.cells, samples);
      var lab = rgb2lab(c2.rgb), cand = [];
      for (j = 0; j < PAL.length; j++) {
        cand.push({ code: PAL[j].code, de: ciede2000(lab, rgb2lab(PAL[j].rgb)), special: !!PAL[j].special });
      }
      cand.sort(function (x, y) { return x.de - y.de; });
      c2.candidates = cand.slice(0, 8);
      c2.de = cand[0].de;
      c2.suggest = cand[0].code;
      var sp = null;
      for (j = 0; j < SPECIAL.length; j++) {
        var dd = ciede2000(lab, rgb2lab(SPECIAL[j].rgb));
        if (!sp || dd < sp.de) sp = { code: SPECIAL[j].code, de: dd };
      }
      c2.altSpecial = (sp && sp.de <= 8) ? sp : null;
    });
    // 重建 clusOf（过滤后 id 变了）
    clusOf = new Int32Array(n).fill(-1);
    clusters.forEach(function (c2) { for (var k2 = 0; k2 < c2.cells.length; k2++) clusOf[c2.cells[k2]] = c2.id; });

    // 杂色清理：把过小的碎簇（水印/花边/压缩噪点）并进最近的正常簇，避免在色簇面板里冒出一堆假颜色
    (function () {
      if (clusters.length < 2) return;
      var total = 0;
      for (var q1 = 0; q1 < clusters.length; q1++) total += clusters[q1].cells.length;
      var floor = Math.max(3, Math.round(total * 0.0015));   // 只并掉 1~3 颗的纯噪点，别把图例里真实的小色号并掉
      var changed2 = true, guard2 = 0;
      while (changed2 && guard2++ < 60) {
        changed2 = false;
        var small = -1;
        for (q1 = 0; q1 < clusters.length; q1++) {
          if (clusters[q1].cells.length < floor) { small = q1; break; }
        }
        if (small < 0) break;
        var sc2 = clusters[small], bi = -1, bd2 = 1e9;
        for (q1 = 0; q1 < clusters.length; q1++) {
          if (q1 === small || clusters[q1].cells.length < floor) continue;
          var dd2 = deRgb(sc2.rgb, clusters[q1].rgb);
          if (dd2 < bd2) { bd2 = dd2; bi = q1; }
        }
        if (bi < 0) break;
        for (var m2 = 0; m2 < sc2.cells.length; m2++) {
          clusters[bi].cells.push(sc2.cells[m2]);
          clusOf[sc2.cells[m2]] = bi;
        }
        clusters[bi].rgb = medianColor(clusters[bi].cells, samples);
        clusters.splice(small, 1);
        for (q1 = 0; q1 < clusters.length; q1++) clusters[q1].id = q1;
        for (q1 = 0; q1 < n; q1++) if (clusOf[q1] > small) clusOf[q1]--;
        changed2 = true;
      }
    })();

    assignDistinct(clusters, opts);
    var cells = new Array(n).fill(null);
    clusters.forEach(function (c2) {
      for (var m = 0; m < c2.cells.length; m++) cells[c2.cells[m]] = c2.code;
    });
    return { cells: cells, clusOf: clusOf, clusters: clusters, beadCount: totalBeads };
  }

  // 建议色号互不重复：按"最确定"的顺序贪心分配（避免两个簇都给 A20）
  function assignDistinct(clusters) {
    var taken = new Map();
    var items = clusters.map(function (c2) { return { c: c2, margin: (c2.candidates[1] ? c2.candidates[1].de : 0) - c2.candidates[0].de }; });
    items.sort(function (a, b) { return b.margin - a.margin; });
    items.forEach(function (it) {
      var c2 = it.c;
      var pick = null;
      for (var i = 0; i < c2.candidates.length; i++) {
        if (!taken.has(c2.candidates[i].code)) { pick = c2.candidates[i]; break; }
      }
      if (!pick) pick = c2.candidates[0];
      c2.code = pick.code;
      c2.de = pick.de;
      if (!taken.has(pick.code)) taken.set(pick.code, c2);
    });
  }

  // 用"图例数量"反定色号：数量唯一匹配最可靠（不需 OCR，也不受色差影响）
  function matchByLegend(clusters, legend) {
    if (!legend || !legend.length) return { matched: 0, unmatched: clusters.length };
    var usedCodes = {}, byCount = new Map();
    legend.forEach(function (l) {
      if (!byCount.has(l.count)) byCount.set(l.count, []);
      byCount.get(l.count).push(l.code);
    });
    var matched = 0;
    var rest = [];
    // 1) 数量完全一致且唯一
    clusters.forEach(function (c2) {
      var list = byCount.get(c2.cells.length);
      if (list) {
        var free = list.filter(function (cd) { return !usedCodes[cd]; });
        if (free.length === 1) {
          c2.code = free[0]; usedCodes[free[0]] = 1; c2.fromLegend = true; matched++;
          return;
        }
      }
      rest.push(c2);
    });
    // 2) 剩下的按颜色最近 + 排除已用色号
    rest.forEach(function (c2) {
      var pick = null;
      for (var i = 0; i < c2.candidates.length; i++) {
        if (!usedCodes[c2.candidates[i].code]) { pick = c2.candidates[i]; break; }
      }
      if (pick) { c2.code = pick.code; usedCodes[pick.code] = 1; }
    });
    return { matched: matched, total: clusters.length };
  }

  // ==================== 用图例给"碎簇"分配色号 ====================
  // 现实是：同一色号的格子会被水印/压缩拆成很多小碎簇，而相邻色号又只差 ΔE 3~8。
  // 图例恰好给了每种颜色的准确颗数 —— 先用"尺寸吻合"锁定一批，再用渲染色最近邻分配剩下的碎簇，
  // 最后逐格微调把每个色号的颗数修到与图例完全一致。
  function assignLegend(clusters, samples, legend) {
    if (!legend || !legend.length || !clusters.length) return null;
    var caps = new Map(), rendered = new Map(), i;
    for (i = 0; i < legend.length; i++) caps.set(legend[i].code, legend[i].count);
    var cs = clusters.slice().sort(function (a, b) { return b.cells.length - a.cells.length; });
    // 先把聚类给的"建议色号"收起来（只用于显示），这里从空白开始按图例分配
    cs.forEach(function (cl) { cl.suggest = cl.code; cl.code = null; });

    // 1) 尺寸与图例颗数吻合的碎簇先锁定
    var locked = new Set();
    cs.forEach(function (cl) {
      var best = null;
      legend.forEach(function (l) {
        if (locked.has(l.code)) return;
        var d = Math.abs(cl.cells.length - l.count) / Math.max(1, l.count);
        if (d <= 0.12 && (!best || d < best.d)) best = { code: l.code, d: d };
      });
      if (best) { locked.add(best.code); rendered.set(best.code, cl.rgb.slice()); cl.code = best.code; cl.fromLegend = true; }
    });

    // 2) 用已锁定的色号估"整体偏色"，给未锁定的色号推出渲染色
    var dx = 0, dy = 0, dz = 0, cnt = 0;
    locked.forEach(function (code) {
      var p2 = byCode(code), rr = rendered.get(code);
      if (!p2 || !rr) return;
      dx += rr[0] - p2.rgb[0]; dy += rr[1] - p2.rgb[1]; dz += rr[2] - p2.rgb[2]; cnt++;
    });
    if (cnt) { dx /= cnt; dy /= cnt; dz /= cnt; } else { dx = dy = dz = 0; }
    function clamp8(v) { return v < 0 ? 0 : (v > 255 ? 255 : Math.round(v)); }
    legend.forEach(function (l) {
      if (rendered.has(l.code)) return;
      var p3 = byCode(l.code);
      rendered.set(l.code, p3 ? [clamp8(p3.rgb[0] + dx), clamp8(p3.rgb[1] + dy), clamp8(p3.rgb[2] + dz)] : [128, 128, 128]);
    });

    // 3) 剩余碎簇：渲染色最近 + 剩余容量
    var left = new Map();
    legend.forEach(function (l) { left.set(l.code, l.count); });
    cs.forEach(function (cl) { if (cl.code) left.set(cl.code, left.get(cl.code) - cl.cells.length); });
    cs.forEach(function (cl) {
      if (cl.code) return;
      var pick = null;
      legend.forEach(function (l) {
        var capLeft = left.get(l.code);
        if (capLeft <= 0) return;
        var d = deRgb(cl.rgb, rendered.get(l.code));
        if (capLeft < cl.cells.length) d += 5 + (cl.cells.length - capLeft) * 0.05;
        if (!pick || d < pick.d) pick = { code: l.code, d: d };
      });
      var code = pick ? pick.code : legend[0].code;
      cl.code = code;
      left.set(code, left.get(code) - cl.cells.length);
    });

    // 4) 在"碎簇"层面搬：把每个色号的颗数修到与图例一致
    var cells = new Array(samples.length).fill(null);
    var counts = new Map();
    legend.forEach(function (l) { counts.set(l.code, 0); });
    cs.forEach(function (cl) {
      for (var m = 0; m < cl.cells.length; m++) cells[cl.cells[m]] = cl.code;
      counts.set(cl.code, (counts.get(cl.code) || 0) + cl.cells.length);
    });
    for (var pass = 0; pass < 500; pass++) {
      var over = null, under = null;
      legend.forEach(function (l) {
        var d2 = counts.get(l.code) - caps.get(l.code);
        if (d2 > 0 && (!over || d2 > over.d)) over = { code: l.code, d: d2 };
        if (d2 < 0 && (!under || d2 < under.d)) under = { code: l.code, d: d2 };
      });
      if (!over || !under) break;
      var target = rendered.get(under.code);
      var cand = cs.filter(function (cl) { return cl.code === over.code && cl.cells.length > 0; });
      if (!cand.length) break;
      cand.sort(function (a2, b2) { return deRgb(a2.rgb, target) - deRgb(b2.rgb, target); });
      var pickCl = cand[0];
      var need = -under.d, surplus = over.d;
      if (pickCl.cells.length <= surplus && pickCl.cells.length <= need) {
        pickCl.code = under.code;
        counts.set(over.code, counts.get(over.code) - pickCl.cells.length);
        counts.set(under.code, counts.get(under.code) + pickCl.cells.length);
        for (i = 0; i < pickCl.cells.length; i++) cells[pickCl.cells[i]] = under.code;
      } else {
        var moveN = Math.min(surplus, need);
        var idxs = pickCl.cells.slice().sort(function (x2, y2) {
          return deRgb(samples[x2].rgb, target) - deRgb(samples[y2].rgb, target);
        }).slice(0, moveN);
        for (i = 0; i < idxs.length; i++) cells[idxs[i]] = under.code;
        counts.set(over.code, counts.get(over.code) - moveN);
        counts.set(under.code, counts.get(under.code) + moveN);
      }
    }
    // 5) 仍多出来的（整张图豆数比图例多）→ 当误检丢掉
    var dropped = 0, deficits = {};
    legend.forEach(function (l) {
      var surplus2 = counts.get(l.code) - caps.get(l.code);
      if (surplus2 > 0) {
        for (i = cells.length - 1; i >= 0 && surplus2 > 0; i--) {
          if (cells[i] === l.code) { cells[i] = null; surplus2--; dropped++; }
        }
        counts.set(l.code, caps.get(l.code));
      } else if (surplus2 < 0) deficits[l.code] = -surplus2;
    });
    return { cells: cells, dropped: dropped, deficits: deficits, rendered: rendered };
  }

  // ==================== 图片 → 像素画（拼豆图纸） ====================
  // 把普通照片缩成 gw×gh 格、每格取区域平均色，再把每格映射到 MARD 标准色（特殊材质不参与，
  // 因为珠光/半透明/夜光在照片里无法可靠反推）。支持亮度/对比度/饱和度、有序抖动/误差扩散、去背景、限色。
  var BAYER4 = [
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5
  ];

  // 3×3 众数滤波：邻居里 ≥5/9 是同一个色号才改，避免把胡须这类细线抹掉
  function smoothCells(cells, gw, gh, pass) {
    var cur = cells.slice(), p, r, c, dy, dx, rr, cc, code, votes, best, bestN;
    for (p = 0; p < (pass || 1); p++) {
      var next = cur.slice();
      for (r = 0; r < gh; r++) {
        for (c = 0; c < gw; c++) {
          votes = new Map();
          for (dy = -1; dy <= 1; dy++) {
            for (dx = -1; dx <= 1; dx++) {
              rr = r + dy; cc = c + dx;
              if (rr < 0 || cc < 0 || rr >= gh || cc >= gw) continue;
              code = cur[rr * gw + cc];
              if (!code) continue;
              votes.set(code, (votes.get(code) || 0) + 1);
            }
          }
          best = cur[r * gw + c]; bestN = 0;
          votes.forEach(function (n, cd) { if (n > bestN) { bestN = n; best = cd; } });
          if (bestN >= 5) next[r * gw + c] = best;
        }
      }
      cur = next;
    }
    return cur;
  }

  function buildPatternFromImage(data, iw, ih, opts) {
    opts = opts || {};
    var gw = Math.round(opts.gw || 50), gh = Math.round(opts.gh || 50);
    if (gw < 2 || gh < 2) return null;
    var fit = opts.fit || 'crop';
    var pal = PAL.filter(function (c) { return !c.special; });
    if (!pal.length) return null;
    var palLab = pal.map(function (c) { return { c: c, lab: rgb2lab(c.rgb) }; });

    // 1) 取源区域（裁剪居中 or 拉伸）
    var srcW = iw, srcH = ih, sx0 = 0, sy0 = 0;
    if (fit === 'crop') {
      var targetRatio = gw / gh, srcRatio = iw / ih;
      if (srcRatio > targetRatio) { srcW = Math.round(ih * targetRatio); sx0 = Math.round((iw - srcW) / 2); }
      else { srcH = Math.round(iw / targetRatio); sy0 = Math.round((ih - srcH) / 2); }
    }

    var bright = (opts.brightness || 0) / 100;
    var contrast = (opts.contrast || 0) / 100;
    var satK = (opts.saturation || 0) / 100;

    // 2) 每格区域均值
    var cellRgb = new Array(gw * gh);
    var x, y, r, c, o, xa, xb, ya, yb, sr, sg, sb, n;
    for (r = 0; r < gh; r++) {
      for (c = 0; c < gw; c++) {
        xa = Math.floor(sx0 + c * srcW / gw); xb = Math.ceil(sx0 + (c + 1) * srcW / gw) - 1;
        ya = Math.floor(sy0 + r * srcH / gh); yb = Math.ceil(sy0 + (r + 1) * srcH / gh) - 1;
        xa = xa < 0 ? 0 : xa; ya = ya < 0 ? 0 : ya;
        xb = xb > iw - 1 ? iw - 1 : xb; yb = yb > ih - 1 ? ih - 1 : yb;
        if (xb < xa) xb = xa;
        if (yb < ya) yb = ya;
        sr = 0; sg = 0; sb = 0; n = 0;
        for (y = ya; y <= yb; y++) {
          o = (y * iw + xa) * 4;
          for (x = xa; x <= xb; x++, o += 4) { sr += data[o]; sg += data[o + 1]; sb += data[o + 2]; n++; }
        }
        if (!n) n = 1;
        var rr = sr / n, gg = sg / n, bb = sb / n;
        // 亮度 / 对比度 / 饱和度
        if (bright) { rr += bright * 255; gg += bright * 255; bb += bright * 255; }
        if (contrast) {
          var k = 1 + contrast;
          rr = (rr - 128) * k + 128; gg = (gg - 128) * k + 128; bb = (bb - 128) * k + 128;
        }
        if (satK) {
          var gray = 0.299 * rr + 0.587 * gg + 0.114 * bb, ks = 1 + satK;
          rr = gray + (rr - gray) * ks; gg = gray + (gg - gray) * ks; bb = gray + (bb - gray) * ks;
        }
        cellRgb[r * gw + c] = [
          rr < 0 ? 0 : (rr > 255 ? 255 : rr),
          gg < 0 ? 0 : (gg > 255 ? 255 : gg),
          bb < 0 ? 0 : (bb > 255 ? 255 : bb)
        ];
      }
    }

    // 3) 去背景：用四个角判断底色，接近底色的格子置空
    var empty = new Array(gw * gh).fill(false);
    if (opts.removeBg) {
      var corners = [cellRgb[0], cellRgb[gw - 1], cellRgb[(gh - 1) * gw], cellRgb[gh * gw - 1]];
      var bg = [0, 0, 0], okAll = true;
      for (var i = 0; i < 4; i++) { bg[0] += corners[i][0]; bg[1] += corners[i][1]; bg[2] += corners[i][2]; }
      bg = [bg[0] / 4, bg[1] / 4, bg[2] / 4];
      for (i = 0; i < 4; i++) if (deRgb(corners[i], bg) > 18) okAll = false;
      if (okAll) {
        var tol = opts.bgTol == null ? 12 : opts.bgTol;
        for (i = 0; i < cellRgb.length; i++) if (deRgb(cellRgb[i], bg) < tol) empty[i] = true;
      }
    }

    // 4) 映射到调色板（带抖动）
    var cache = new Map();
    function nearest(rgb) {
      var key = ((rgb[0] >> 3) << 10) | ((rgb[1] >> 3) << 5) | (rgb[2] >> 3);
      var hit = cache.get(key);
      if (hit) return hit;
      var lab = rgb2lab(rgb), bd = 1e9, bc = null;
      for (var q = 0; q < palLab.length; q++) {
        var d = ciede2000(lab, palLab[q].lab);
        if (d < bd) { bd = d; bc = palLab[q].c; }
      }
      var res = { code: bc.code, rgb: bc.rgb, de: bd };
      cache.set(key, res);
      return res;
    }

    var codes = new Array(gw * gh).fill(null);
    var dither = opts.dither || 'none';
    var strength = opts.ditherStrength == null ? 20 : opts.ditherStrength;
    var err = new Array(gw * gh).fill(null);
    for (r = 0; r < gh; r++) {
      for (c = 0; c < gw; c++) {
        var idx = r * gw + c;
        if (empty[idx]) continue;
        var px = cellRgb[idx].slice();
        if (dither === 'ordered') {
          var b = (BAYER4[(r % 4) * 4 + (c % 4)] / 16 - 0.5) * strength;
          px[0] += b; px[1] += b; px[2] += b;
        } else if (dither === 'fs' && err[idx]) {
          px[0] += err[idx][0]; px[1] += err[idx][1]; px[2] += err[idx][2];
        }
        for (var ch = 0; ch < 3; ch++) px[ch] = px[ch] < 0 ? 0 : (px[ch] > 255 ? 255 : px[ch]);
        var m = nearest(px);
        codes[idx] = m.code;
        if (dither === 'fs') {
          var dr = px[0] - m.rgb[0], dg = px[1] - m.rgb[1], db = px[2] - m.rgb[2];
          var push = function (cc, rr2, w) {
            if (cc < 0 || cc >= gw || rr2 < 0 || rr2 >= gh) return;
            var j = rr2 * gw + cc;
            if (empty[j]) return;
            if (!err[j]) err[j] = [0, 0, 0];
            err[j][0] += dr * w; err[j][1] += dg * w; err[j][2] += db * w;
          };
          push(c + 1, r, 7 / 16); push(c - 1, r + 1, 3 / 16);
          push(c, r + 1, 5 / 16); push(c + 1, r + 1, 1 / 16);
        }
      }
    }

    // 5) 平滑：3×3 众数滤波，去掉格子级的椒盐噪点（源图糊 / JPEG 压缩时特别明显）
    if (opts.smooth !== false) codes = smoothCells(codes, gw, gh, opts.smoothPass || 1);

    // 6) 限制色数：合并"最接近的一对"，而不是删用得最少的
    //    —— 按用量删会把面积小但颜色独特的部分（眼睛、耳朵内）优先干掉，
    //       留下十几种几乎一样的背景蓝。合并最近对则先并近似色，独特色能留住。
    var maxColors = opts.maxColors || 0;
    if (maxColors > 0) {
      var counts = new Map();
      for (i = 0; i < codes.length; i++) if (codes[i]) counts.set(codes[i], (counts.get(codes[i]) || 0) + 1);
      while (counts.size > maxColors) {
        var keys = Array.from(counts.keys()), bestA = null, bestB = null, bestD = 1e9;
        for (var q1 = 0; q1 < keys.length; q1++) {
          for (var q2 = q1 + 1; q2 < keys.length; q2++) {
            var dd = ciede2000(rgb2lab(byCode(keys[q1]).rgb), rgb2lab(byCode(keys[q2]).rgb));
            if (dd < bestD) { bestD = dd; bestA = keys[q1]; bestB = keys[q2]; }
          }
        }
        if (!bestA) break;
        // 保留用得多的那个，把另一个并过去
        var keep = (counts.get(bestA) || 0) >= (counts.get(bestB) || 0) ? bestA : bestB;
        var drop = keep === bestA ? bestB : bestA;
        for (i = 0; i < codes.length; i++) if (codes[i] === drop) codes[i] = keep;
        counts.set(keep, counts.get(keep) + counts.get(drop));
        counts.delete(drop);
      }
    }

    // 7) 汇总
    var used = new Map();
    for (i = 0; i < codes.length; i++) {
      var cd = codes[i];
      if (!cd) continue;
      var e = used.get(cd);
      if (!e) { e = { code: cd, count: 0 }; used.set(cd, e); }
      e.count++;
    }
    var paletteUsed = Array.from(used.values()).map(function (e2) {
      var p3 = byCode(e2.code);
      return { code: e2.code, count: e2.count, rgb: p3 ? p3.rgb : [128, 128, 128], hex: p3 ? p3.hex : '#888888' };
    }).sort(function (a, b) { return b.count - a.count; });

    return { gw: gw, gh: gh, cells: codes, paletteUsed: paletteUsed, total: gw * gh - (codes.filter(function (v) { return !v; }).length) };
  }

  // ==================== 按图例数量做"带容量约束的分配" ====================
  // 思路：图例给了每种颜色的准确颗数。把每个格子看成点，把色号看成带容量的中心，
  // 用"最近中心 + 容量约束"的贪心 + 迭代重估中心（带容量的 k-means），
  // 保证每个色号拿到的颗数和图例完全一致 —— 比单靠颜色聚类稳得多。
  function assignByLegendCounts(samples, bg, inkThr, legend, opts) {
    opts = opts || {};
    var i, k, t;
    var idx = [];
    for (i = 0; i < samples.length; i++) if (!isEmptyCell(samples[i], bg, inkThr)) idx.push(i);
    var totalWant = 0;
    for (k = 0; k < legend.length; k++) totalWant += legend[k].count;
    if (!legend.length) return null;
    if (idx.length < totalWant * 0.75) return null;   // 差太多说明几何没对上，不硬分

    var K = legend.length;
    var codes = [], cap = [], centers = [];
    for (k = 0; k < K; k++) {
      codes.push(legend[k].code);
      cap.push(legend[k].count);
      var p2 = byCode(legend[k].code);
      centers.push(p2 ? p2.rgb.slice() : [128, 128, 128]);
    }
    var nmax = K <= 3 ? 3 : 4;
    var assign = new Int32Array(samples.length).fill(-1);
    var order = [], cand = [];
    for (t = 0; t < idx.length; t++) cand.push({ ci: idx[t], arr: [] });

    for (var round = 0; round < 4; round++) {
      // 每格对各中心的 ΔE，按距离升序
      for (t = 0; t < cand.length; t++) {
        var sm = samples[cand[t].ci];
        var arr = [];
        for (k = 0; k < K; k++) arr.push({ k: k, de: deRgb(sm.rgb, centers[k]) });
        arr.sort(function (a, b) { return a.de - b.de; });
        cand[t].arr = arr;
      }
      // 最确定的先分（第一名和第二名差距大的先定），容量满了就退而求其次
      var sorted = cand.slice().sort(function (a, b) {
        var ga = a.arr.length > 1 ? a.arr[1].de - a.arr[0].de : 99;
        var gb = b.arr.length > 1 ? b.arr[1].de - b.arr[0].de : 99;
        return gb - ga;
      });
      var used = new Array(K).fill(0);
      var ok = true;
      for (t = 0; t < sorted.length; t++) {
        var c = sorted[t], placed = false;
        for (var q = 0; q < c.arr.length; q++) {
          k = c.arr[q].k;
          if (used[k] < cap[k]) { assign[c.ci] = k; used[k]++; placed = true; break; }
        }
        if (!placed) { assign[c.ci] = -1; ok = false; }   // 容量满了 → 当误检丢掉
      }
      if (round === 3) ok = true;
      // 用实际分配到的格子重估中心（中位数，抗水印离群）
      for (k = 0; k < K; k++) {
        var rs = [], gs = [], bs = [];
        for (t = 0; t < idx.length; t++) {
          if (assign[idx[t]] !== k) continue;
          var s2 = samples[idx[t]];
          rs.push(s2.rgb[0]); gs.push(s2.rgb[1]); bs.push(s2.rgb[2]);
        }
        if (rs.length) {
          rs.sort(function (a, b) { return a - b; });
          gs.sort(function (a, b) { return a - b; });
          bs.sort(function (a, b) { return a - b; });
          var m = rs.length >> 1;
          centers[k] = [rs[m], gs[m], bs[m]];
        }
      }
    }
    var cells = new Array(samples.length).fill(null);
    var counts = {}, dropped = 0;
    for (t = 0; t < idx.length; t++) {
      var ai = assign[idx[t]];
      if (ai >= 0) { cells[idx[t]] = codes[ai]; counts[codes[ai]] = (counts[codes[ai]] || 0) + 1; }
      else dropped++;
    }
    var deficits = {};
    for (k = 0; k < K; k++) {
      var gotN = counts[codes[k]] || 0;
      if (gotN < cap[k]) deficits[codes[k]] = cap[k] - gotN;
    }
    return { cells: cells, codes: codes, counts: counts, centers: centers, dropped: dropped, deficits: deficits };
  }

  function applyCodes(clusters, n) {
    var cells = new Array(n).fill(null);
    clusters.forEach(function (c2) {
      for (var i = 0; i < c2.cells.length; i++) cells[c2.cells[i]] = c2.code;
    });
    return cells;
  }

  function countCodes(cells) {
    var map = new Map(), total = 0;
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (!c) continue;
      map.set(c, (map.get(c) || 0) + 1);
      total++;
    }
    return { map: map, total: total, rows: Array.from(map.entries()).map(function (e) { return { code: e[0], n: e[1] }; }).sort(function (a, b) { return b.n - a.n; }) };
  }

  // ==================== 网格自动对齐（投影强线法） ====================
  function toGray(data, iw, ih) {
    var g = new Float32Array(iw * ih);
    for (var i = 0, o = 0; i < g.length; i++, o += 4) {
      g[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    }
    return g;
  }
  function meanProfile(gray, iw, ih, axis) {
    var len = axis === 'x' ? iw : ih, prof = new Float32Array(len), x, y, s, n;
    if (axis === 'x') {
      for (x = 0; x < iw; x++) { s = 0; n = 0; for (y = 0; y < ih; y += 2) { s += gray[y * iw + x]; n++; } prof[x] = s / n; }
    } else {
      for (y = 0; y < ih; y++) { s = 0; n = 0; for (x = 0; x < iw; x += 2) { s += gray[y * iw + x]; n++; } prof[y] = s / n; }
    }
    return prof;
  }
  function lineStrength(prof, k) {
    k = k || 4;
    var out = new Float32Array(prof.length), i, a, b;
    for (i = 0; i < prof.length; i++) {
      a = prof[i - k < 0 ? 0 : i - k];
      b = prof[i + k > prof.length - 1 ? prof.length - 1 : i + k];
      out[i] = Math.abs(prof[i] - (a + b) / 2);
    }
    return out;
  }
  function strongPeaks(st, frac) {
    var mx = 0, i;
    for (i = 0; i < st.length; i++) if (st[i] > mx) mx = st[i];
    var thr = Math.max(mx * frac, 1.2), raw = [];
    for (i = 1; i < st.length - 1; i++) {
      if (st[i] >= thr && st[i] >= st[i - 1] && st[i] >= st[i + 1]) raw.push({ x: i, v: st[i] });
    }
    var merged = [];
    for (i = 0; i < raw.length; i++) {
      var p = raw[i];
      if (merged.length && p.x - merged[merged.length - 1].x <= 5) {
        if (p.v > merged[merged.length - 1].v) merged[merged.length - 1] = p;
      } else merged.push(p);
    }
    return merged;
  }

  // 已知格子数 → 用"强线"间距与数量反推每格像素；再用最小二乘定起点
  function fitAxis(st, cells) {
    var mx = 0, i;
    for (i = 0; i < st.length; i++) if (st[i] > mx) mx = st[i];
    if (mx <= 0) return null;
    var best = null;
    var fracs = [0.5, 0.42, 0.35, 0.28, 0.20, 0.14];
    for (var fi = 0; fi < fracs.length; fi++) {
      var pk = strongPeaks(st, fracs[fi]);
      if (pk.length < 3) continue;
      var gaps = [];
      for (i = 1; i < pk.length; i++) gaps.push(pk[i].x - pk[i - 1].x);
      gaps.sort(function (a, b) { return a - b; });
      var G = gaps[Math.floor(gaps.length / 2)];
      if (!(G > 4)) continue;
      for (var k = 1; k <= 20; k++) {
        var cell = G / k;
        if (cell < 4) continue;
        // 强线每 k 格一条 → 期望强线数 ≈ cells/k+1
        var expect = cells / k + 1;
        if (pk.length > expect * 2.0 + 3 || pk.length < Math.max(3, expect * 0.25)) continue;
        // 最小二乘：x = start + i*(k*cell)
        var xs = pk.map(function (q) { return q.x; });
        var idx = xs.map(function (x) { return Math.round((x - xs[0]) / (k * cell)); });
        var n = xs.length, sk = 0, sx = 0, skk = 0, skx = 0;
        for (i = 0; i < n; i++) { sk += idx[i]; sx += xs[i]; skk += idx[i] * idx[i]; skx += idx[i] * xs[i]; }
        var den = n * skk - sk * sk;
        if (!den) continue;
        var step = (n * skx - sk * sx) / den;   // 每 k 格像素数
        var start = (sx - step * sk) / n;
        var c2 = step / k;
        if (!(c2 >= 4)) continue;
        if (start < -c2 * 3) continue;
        var end = start + cells * c2;
        if (end > st.length + c2 * 3) continue;
        // 校验：预测的每条格线是否落在 st 的峰上
        var hit = 0, tot = 0;
        for (i = 0; i <= cells; i++) {
          var pos = Math.round(start + i * c2);
          tot++;
          var v = Math.max(st[pos - 1] || 0, st[pos] || 0, st[pos + 1] || 0);
          if (v > mx * 0.08) hit++;
        }
        var score = hit / tot - Math.abs(cell - c2) / cell;
        if (!best || score > best.score) best = { cell: c2, start: start, end: end, score: score, k: k, peaks: pk.length };
      }
    }
    if (!best || best.score < 0.55) return null;
    return best;
  }

  // 亚像素精修：把预测的每条格线吸附到附近 st 的局部峰，再最小二乘重估 (cell, start)
  function refineAxis(st, cell, start, cells) {
    var mx = 0, i;
    for (i = 0; i < st.length; i++) if (st[i] > mx) mx = st[i];
    if (mx <= 0) return { cell: cell, start: start, hits: 0 };
    var thr = mx * 0.06;
    for (var round = 0; round < 3; round++) {
      var idx = [], pos = [];
      for (i = 0; i <= cells; i++) {
        var pred = start + i * cell;
        var lo = Math.max(1, Math.round(pred - cell * 0.3));
        var hi = Math.min(st.length - 2, Math.round(pred + cell * 0.3));
        var bx = -1, bv = -1, x;
        for (x = lo; x <= hi; x++) if (st[x] > bv) { bv = st[x]; bx = x; }
        if (bx < 0 || bv < thr) continue;
        var a = st[bx - 1] || 0, b2 = st[bx], c2 = st[bx + 1] || 0;
        var den = a - 2 * b2 + c2;
        var off = den !== 0 ? 0.5 * (a - c2) / den : 0;
        if (off > 0.5) off = 0.5; else if (off < -0.5) off = -0.5;
        idx.push(i); pos.push(bx + off);
      }
      if (idx.length < Math.max(6, cells * 0.35)) break;
      var n = idx.length, sk = 0, sx = 0, skk = 0, skx = 0;
      for (i = 0; i < n; i++) { sk += idx[i]; sx += pos[i]; skk += idx[i] * idx[i]; skx += idx[i] * pos[i]; }
      var d = n * skk - sk * sk;
      if (!d) break;
      var nc = (n * skx - sk * sx) / d, ns = (sx - nc * sk) / n;
      if (!(nc > 2) || Math.abs(nc - cell) > cell * 0.2) break;
      cell = nc; start = ns;
    }
    return { cell: cell, start: start };
  }

  // 用"格内纯净度"做最后一轮局部搜索（对齐越准，格内越平；错开就往格线上取到杂色）
  function impurityScore(data, iw, ih, g) {
    var stride = Math.max(1, Math.round(Math.sqrt(g.gw * g.gh / 400)));
    var sum = 0, cnt = 0, r, c, sm;
    for (r = 0; r < g.gh; r += stride) {
      for (c = 0; c < g.gw; c += stride) {
        sm = cellStats(data, iw, ih, g, r, c);
        if (sm.oob) continue;
        sum += sm.cov;
        cnt++;
      }
    }
    return cnt ? sum / cnt : 1e9;
  }

  function polishGeometry(data, iw, ih, geo) {
    var g = { gw: geo.gw, gh: geo.gh, gx: geo.gx, gy: geo.gy, cw: geo.cw, ch: geo.ch };
    var best = impurityScore(data, iw, ih, g);
    var i, t, sc;
    function tryOne(prop, val) {
      var old = g[prop];
      g[prop] = val;
      var s2 = impurityScore(data, iw, ih, g);
      if (s2 < best - 1e-7) { best = s2; return true; }
      g[prop] = old;
      return false;
    }
    for (var round = 0; round < 2; round++) {
      var cw0 = g.cw;
      for (i = -10; i <= 10; i++) { if (!i) continue; tryOne('cw', cw0 * (1 + i * 0.001)); }
      var ch0 = g.ch;
      for (i = -10; i <= 10; i++) { if (!i) continue; tryOne('ch', ch0 * (1 + i * 0.001)); }
      var gx0 = g.gx;
      for (i = -12; i <= 12; i++) { if (!i) continue; tryOne('gx', gx0 + i * 0.5); }
      var gy0 = g.gy;
      for (i = -12; i <= 12; i++) { if (!i) continue; tryOne('gy', gy0 + i * 0.5); }
    }
    return { gw: g.gw, gh: g.gh, gx: g.gx, gy: g.gy, cw: g.cw, ch: g.ch, score: best };
  }

  // 某个轴向的"格线命中率"：预测的每条格线落在峰上的比例。几何正确时应接近 1。
  function axisQuality(st, cell, start, cells) {
    if (!(cell > 2)) return 0;
    var mx = 0, i;
    for (i = 0; i < st.length; i++) if (st[i] > mx) mx = st[i];
    if (mx <= 0) return 0;
    var thr = mx * 0.08, hit = 0, tot = 0;
    for (i = 0; i <= cells; i++) {
      var pos = Math.round(start + i * cell);
      if (pos < 1 || pos >= st.length - 1) continue;
      tot++;
      if (Math.max(st[pos - 1] || 0, st[pos] || 0, st[pos + 1] || 0) >= thr) hit++;
    }
    return tot ? hit / tot : 0;
  }

  function autoAlign(data, iw, ih, gw, gh) {
    var gray = toGray(data, iw, ih);
    var sx = lineStrength(meanProfile(gray, iw, ih, 'x'));
    var sy = lineStrength(meanProfile(gray, iw, ih, 'y'));
    var fx = fitAxis(sx, gw), fy = fitAxis(sy, gh);
    if (!fx || !fy) return null;
    var rx = refineAxis(sx, fx.cell, fx.start, gw);
    var ry = refineAxis(sy, fy.cell, fy.start, gh);
    var rough = {
      gw: gw, gh: gh,
      gx: rx.start, gy: ry.start, cw: rx.cell, ch: ry.cell,
      score: (fx.score + fy.score) / 2
    };
    return rough;
  }

  // 把某个坐标吸附到最近的"线"上（用户拖框时用）
  function snapToLine(data, iw, ih, axis, value, radius) {
    var gray = toGray(data, iw, ih);
    var st = lineStrength(meanProfile(gray, iw, ih, axis));
    radius = radius || 8;
    var best = value, bestV = -1;
    var lo = Math.max(1, Math.round(value - radius)), hi = Math.min(st.length - 2, Math.round(value + radius));
    for (var i = lo; i <= hi; i++) {
      if (st[i] > bestV) { bestV = st[i]; best = i; }
    }
    return best;
  }

  return {
    init: init, palette: palette, byCode: byCode,
    seriesOf: seriesOf, materialOf: materialOf,
    rgb2lab: rgb2lab, ciede2000: ciede2000, deRgb: deRgb, rgbDist: rgbDist, lumOfHex: lumOfHex,
    cellStats: cellStats, sampleGrid: sampleGrid,
    estimateBgOutside: estimateBgOutside, isEmptyCell: isEmptyCell,
    buildClusters: buildClusters, assignDistinct: assignDistinct, matchByLegend: matchByLegend,
    buildPatternFromImage: buildPatternFromImage,
    applyCodes: applyCodes, countCodes: countCodes, assignByLegendCounts: assignByLegendCounts, assignLegend: assignLegend,
    toGray: toGray, meanProfile: meanProfile, lineStrength: lineStrength, strongPeaks: strongPeaks,
    fitAxis: fitAxis, refineAxis: refineAxis, axisQuality: axisQuality, autoAlign: autoAlign, polishGeometry: polishGeometry, impurityScore: impurityScore, snapToLine: snapToLine
  };
});
