/* 拼豆图纸识别 v0.2 —— UI 层（算法在 core.js） */
(function () {
  'use strict';
  var PC = window.PindouCore;
  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };

  var PAL = window.MARD_PALETTE || [];
  PC.init(PAL);
  var BY = {};
  PAL.forEach(function (c) { BY[c.code] = c; });
  var MAT = { P: '珠光', Q: '温变', R: '半透明', T: '全透明', Y: '夜光', ZG: '光变' };
  function hexOf(code) { return BY[code] ? BY[code].hex : '#888888'; }
  function matOf(code) { return PC.materialOf(code); }

  var toastEl = $('toast'), toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 2000);
  }
  function setStatus(msg) { $('status').textContent = msg; }

  var S = {
    img: null, iw: 0, ih: 0, data: null,
    gw: 50, gh: 50,
    gx: 0, gy: 0, cw: 10, ch: 10,
    inkThr: 22, thick: 10, showGrid: true, showImage: true, showBorder: true,
    samples: null, bg: [255, 255, 255],
    clusters: [], cells: null, clusOf: null,
    legend: null, legendTotal: 0,
    gridActive: false,              // 是否已对齐出网格（false = 只显示原图）
    sel: new Set(), mode: 'blob', conn8: false,
    hlCode: null, hlCluster: -1,
    view: { s: 1, tx: 0, ty: 0 },
    tool: 'select', step: 1, spaceDown: false,
    boxDrag: null, boxAnchor: null, boxFirst: null, mouse: null, dragging: null,
    undo: [], redo: []
  };
  function NI() { return S.gw * S.gh; }

  // ---------- 图片 ----------
  function loadFromURL(url, name) {
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      var cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      S.img = img;
      S.iw = c.width; S.ih = c.height;
      S.data = cx.getImageData(0, 0, c.width, c.height).data;
      if ($('fileName')) $('fileName').textContent = name || '图片';
      if ($('fileSize')) $('fileSize').textContent = S.iw + ' × ' + S.ih;
      S.gx = S.iw * 0.10; S.gy = S.ih * 0.10;
      S.cw = (S.iw * 0.80) / S.gw; S.ch = (S.ih * 0.80) / S.gh;
      S.samples = null; S.clusters = []; S.cells = null; S.clusOf = null;
      S.sel = new Set(); S.undo = []; S.redo = [];
      showBoxHint(false);
      updateCursor();
      S.gridActive = false;
      S.samples = null; S.clusters = []; S.cells = null; S.clusOf = null;
      S.sel.clear();
      updateAll();
      fitView();
      setStatus('已载入 ' + S.iw + '×' + S.ih +
        '：填好宽高后点「自动对齐」；没把握就点「框选网格」（拖一下，或点两个对角）');
      toast('已载入 ' + (name || '图片'));
    };
    img.onerror = function () { toast('图片载入失败'); };
    img.src = url;
  }
  function readFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { toast('请选择图片文件'); return; }
    var fr = new FileReader();
    fr.onload = function () { loadFromURL(fr.result, file.name); };
    fr.readAsDataURL(file);
  }

  // ---------- 识别 ----------
  function resample(tuneThr) {
    if (!S.data) return;
    var t0 = performance.now();
    var geo = { gw: S.gw, gh: S.gh, gx: S.gx, gy: S.gy, cw: S.cw, ch: S.ch };
    var r = PC.sampleGrid(S.data, S.iw, S.ih, geo, S.inkThr);
    S.samples = r.samples;
    S.bg = r.bg;
    S.gridActive = true;
    if (tuneThr && S.legendTotal) tuneThreshold();
    rebuildClusters();
    updateAll();
    setStatus('识别：' + S.gw + '×' + S.gh + ' · 色簇 ' + S.clusters.length + ' · 豆子 ' + beadCount() +
      (S.legendTotal ? ' / 图例 ' + S.legendTotal : '') + ' · ' + Math.round(performance.now() - t0) + 'ms');
  }
  function beadCount() {
    if (!S.samples) return 0;
    var n = 0;
    for (var i = 0; i < S.samples.length; i++) if (!PC.isEmptyCell(S.samples[i], S.bg, S.inkThr)) n++;
    return n;
  }
  function tuneThreshold() {
    var best = null, cand = [10, 14, 18, 22, 26, 30, 34, 38, 44, 50, 56];
    for (var i = 0; i < cand.length; i++) {
      S.inkThr = cand[i];
      var n = beadCount();
      var d = Math.abs(n - S.legendTotal);
      if (!best || d < best.d) best = { thr: cand[i], d: d, n: n };
    }
    S.inkThr = best.thr;
    $('inkThr').value = best.thr;
    $('inkThrVal').textContent = best.thr;
  }
  function rebuildClusters() {
    if (!S.samples) return;
    var b = PC.buildClusters(S.samples, S.inkThr, S.bg, { maxColors: S.legend ? S.legend.length : 0 });
    S.clusters = b.clusters;
    S.clusOf = b.clusOf;
    if (S.legend) {
      PC.matchByLegend(S.clusters, S.legend.map(function (e) { return { code: e.code, count: e.count }; }));
      S.cells = PC.applyCodes(S.clusters, NI());
    } else {
      S.cells = b.cells;
    }
  }
  function updateAll() {
    renderClusters(); renderStats(); renderLegendDiff(); renderInspector(); render();
    $('selInfo').textContent = S.sel.size ? '已选 ' + S.sel.size + ' 格' : '';
    $('geoInfo').textContent = S.data ? ('格 ' + S.cw.toFixed(2) + '×' + S.ch.toFixed(2) +
      ' · 起点 ' + S.gx.toFixed(1) + ',' + S.gy.toFixed(1)) : '';
  }

  // ---------- 右栏检查器 ----------
  var pvMode = 'pattern';
  function drawThumbs() {
    ['thumb', 'thumb2'].forEach(function (id) {
      var cv = $(id); if (!cv) return;
      var ctx = cv.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (!S.img) return;
      var s = Math.min(cv.width / S.iw, cv.height / S.ih);
      var w = S.iw * s, h = S.ih * s;
      ctx.drawImage(S.img, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
    });
  }
  function renderPreview() {
    var cv = $('pv'); if (!cv) return;
    var w = cv.width, h = cv.height;
    var ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!S.img) {
      ctx.fillStyle = '#B4B9C2';
      ctx.font = '20px -apple-system,"Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('未载入图片', w / 2, h / 2);
      return;
    }
    if (pvMode === 'image' || !S.cells) {
      var si = Math.min((w - 24) / S.iw, (h - 24) / S.ih);
      ctx.drawImage(S.img, (w - S.iw * si) / 2, (h - S.ih * si) / 2, S.iw * si, S.ih * si);
      return;
    }
    var gwPx = S.gw * S.cw, ghPx = S.gh * S.ch;
    var s2 = Math.min((w - 28) / gwPx, (h - 28) / ghPx);
    drawProject(ctx, { sx: s2, sy: s2, tx: (w - gwPx * s2) / 2 - S.gx * s2, ty: (h - ghPx * s2) / 2 - S.gy * s2 },
      { codes: false, ruler: false, noImage: true, clean: true, fillBg: true });
  }
  function renderColorDetail() {
    var code = null, cl = null;
    if (S.hlCode) code = S.hlCode;
    else if (S.hlCluster >= 0) {
      cl = S.clusters.filter(function (c) { return c.id === S.hlCluster; })[0];
      if (cl) code = cl.code;
    } else if (S.clusters.length) {
      // 没有主动选中时，回落到色板里的第一个色号，右栏不至于全空
      var first = S.clusters.filter(function (c) { return !!c.code; })[0] || S.clusters[0];
      if (first) { cl = first; code = first.code; }
    }
    var n = 0;
    if (code && S.cells) {
      for (var i = 0; i < S.cells.length; i++) if (S.cells[i] === code) n++;
    }
    var sw = $('cdSw'); if (!sw) return;
    if (code) { sw.style.background = hexOf(code); }
    else if (cl) { sw.style.background = 'rgb(' + cl.rgb.join(',') + ')'; }
    else { sw.style.background = '#fff'; }
    $('cdCode').textContent = code || (cl ? '未指定' : '—');
    $('cdHex').textContent = code ? hexOf(code).toUpperCase() : '—';
    $('cdCount').textContent = code ? (n + ' 颗') : '—';
  }
  function renderInspector() {
    var set = function (id, v) { var el = $(id); if (el) el.textContent = v; };
    set('chipSize', S.iw ? (S.iw + ' × ' + S.ih) : '未载入图片');
    set('chipGrid', S.data ? ('网格 ' + S.gw + ' × ' + S.gh) : '网格 —');
    set('chipStep', S.data ? ('步长 ' + S.cw.toFixed(1) + 'px') : '步长 —');
    set('chipColors', S.clusters.length ? ('颜色 ' + S.clusters.length) : '颜色 —');
    set('infoSize', S.iw ? (S.iw + ' × ' + S.ih) : '—');
    set('infoGrid', S.data ? (S.gw + ' × ' + S.gh) : '—');
    set('infoStep', S.data ? (S.cw.toFixed(2) + ' px') : '—');
    set('infoColors', S.clusters.length ? (S.clusters.length + ' 色') : '—');
    set('infoBeads', S.cells ? (PC.countCodes(S.cells).total.toLocaleString() + ' 颗') : '—');
    set('pvMeta', S.data ? ('网格尺寸 ' + S.gw + ' × ' + S.gh + ' · 步长 ' + S.cw.toFixed(1) + 'px') : '网格尺寸 —');
    drawThumbs(); renderPreview(); renderColorDetail();
  }

  // 移除网格：清掉识别结果，只留原图，方便重新对齐
  function removeGrid(silent) {
    S.gridActive = false;
    S.samples = null;
    S.clusters = [];
    S.cells = null;
    S.clusOf = null;
    S.sel.clear();
    S.boxFirst = null; S.boxAnchor = null; S.boxDrag = null;
    S.hlCode = null; S.hlCluster = -1;
    updateAll();
    if (!silent) {
      setStatus('已移除网格：现在只显示原图。可用「框选网格」或「自动对齐」重新对齐');
      toast('已移除网格');
    }
  }

  function autoAlign(silent) {
    if (!S.data) { if (!silent) toast('先载入图片'); return; }
    var t0 = performance.now();
    var geo = PC.autoAlign(S.data, S.iw, S.ih, S.gw, S.gh);
    var why = '';
    if (!geo) why = '没找到稳定的格线';
    else {
      // 没把握的判断：框没盖住大半张图 / 框跑出图外 → 一律不应用，交回手动
      var coverW = geo.gw * geo.cw / S.iw, coverH = geo.gh * geo.ch / S.ih;
      if (coverW < 0.55 || coverH < 0.55) {
        why = '只盖住图片 ' + Math.round(coverW * 100) + '% × ' + Math.round(coverH * 100) + '%';
      } else if (geo.gx < -geo.cw * 2 || geo.gy < -geo.ch * 2 ||
                 geo.gx + geo.gw * geo.cw > S.iw + geo.cw * 2 ||
                 geo.gy + geo.gh * geo.ch > S.ih + geo.ch * 2) {
        why = '网格框跑出图片外了';
      }
    }
    if (why) {
      // 不改变当前几何，直接让用户手动选
      removeGrid(true);                     // 没把握就把旧网格也清掉，画布回到干净的原图
      setStatus('自动对齐没把握（' + why + '）→ 已切到「框选网格」：拖一下，或点两个对角');
      toast('自动对齐没把握，已切到手动框选');
      setTool('box');
      return;
    }
    S.gx = geo.gx; S.gy = geo.gy; S.cw = geo.cw; S.ch = geo.ch;
    resample(true);
    setTool('select');
    fitView();
    if (!silent) toast('自动对齐完成（' + Math.round(performance.now() - t0) + 'ms），不准就微调或框选');
  }

  // ---------- 渲染 ----------
  function fitView() {
    var stage = $('stage');
    var w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h || !S.iw) return;
    if (!S.gridActive) {
      var si = Math.min(w * 0.94 / S.iw, h * 0.94 / S.ih);
      S.view.s = si;
      S.view.tx = (w - S.iw * si) / 2;
      S.view.ty = (h - S.ih * si) / 2;
      render();
      return;
    }
    var gwPx = S.gw * S.cw, ghPx = S.gh * S.ch;
    var s2 = Math.min(w * 0.94 / gwPx, h * 0.90 / ghPx);
    S.view.s = s2;
    S.view.tx = (w - gwPx * s2) / 2 - S.gx * s2;
    S.view.ty = (h - ghPx * s2) / 2 - S.gy * s2;
    render();
  }
  function render() {
    var cv = $('cv'), stage = $('stage');
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#EDEFF2';
    ctx.fillRect(0, 0, w, h);
    var zl = $('zoomReset');
    if (zl) {
      var zt = Math.round(S.view.s * 100) + '%';
      if (zl.textContent !== zt) zl.textContent = zt;
    }
    if (!S.data) return;
    if (!S.gridActive) {
      // 只画原图（不叠网格），方便用户看清楚再去框选
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.drawImage(S.img, S.view.tx, S.view.ty, S.iw * S.view.s, S.ih * S.view.s);
      ctx.restore();
      if (S.boxDrag) {
        var bd = S.boxDrag;
        ctx.save();
        ctx.strokeStyle = '#2E7CF6';
        ctx.fillStyle = 'rgba(46,124,246,.12)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.fillRect(Math.min(bd.x0, bd.x1), Math.min(bd.y0, bd.y1),
          Math.abs(bd.x1 - bd.x0), Math.abs(bd.y1 - bd.y0));
        ctx.strokeRect(Math.min(bd.x0, bd.x1), Math.min(bd.y0, bd.y1),
          Math.abs(bd.x1 - bd.x0), Math.abs(bd.y1 - bd.y0));
        ctx.restore();
      }
      return;
    }
    drawProject(ctx, { sx: S.view.s, sy: S.view.s, tx: S.view.tx, ty: S.view.ty },
      { imageAlpha: S.showImage ? 0.32 : 0, fillBg: true });
    if (S.boxFirst && S.mouse) {
      var ax = S.boxFirst.x, ay = S.boxFirst.y, bx = S.mouse.x, by = S.mouse.y;
      ctx.save();
      ctx.strokeStyle = 'rgba(46,124,246,.9)';
      ctx.fillStyle = 'rgba(46,124,246,.08)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      ctx.setLineDash([]);
      ctx.fillStyle = '#2E7CF6';
      ctx.beginPath(); ctx.arc(ax, ay, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    if (S.boxDrag) {
      var d = S.boxDrag;
      ctx.save();
      ctx.strokeStyle = '#2E7CF6';
      ctx.fillStyle = 'rgba(46,124,246,.12)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      var x0 = Math.min(d.x0, d.x1), y0 = Math.min(d.y0, d.y1);
      ctx.fillRect(x0, y0, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      ctx.strokeRect(x0, y0, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      ctx.restore();
    }
  }
  function drawProject(ctx, view, opt) {
    opt = opt || {};
    var sx = view.sx, sy = view.sy;
    var gw = S.gw, gh = S.gh, cw = S.cw, ch = S.ch, gx = S.gx, gy = S.gy;
    ctx.save();
    ctx.transform(sx, 0, 0, sy, view.tx, view.ty);
    if (opt.fillBg) { ctx.fillStyle = '#fff'; ctx.fillRect(gx, gy, gw * cw, gh * ch); }
    if (S.img && !opt.noImage) {
      ctx.globalAlpha = opt.imageAlpha != null ? opt.imageAlpha : 0.32;
      ctx.drawImage(S.img, 0, 0);
      ctx.globalAlpha = 1;
    }
    var cellPx = cw * sx;
    var i, r, c, x, y, code, hex, pal, alpha, hit;
    if (S.cells) {
      var hlOn = !opt.clean && (S.hlCode || S.hlCluster >= 0);
      for (r = 0; r < gh; r++) {
        for (c = 0; c < gw; c++) {
          i = r * gw + c;
          code = S.cells[i];
          if (!code) continue;
          x = gx + c * cw; y = gy + r * ch;
          pal = BY[code];
          hex = pal ? pal.hex : '#888';
          alpha = 1;
          if (hlOn) {
            hit = (S.hlCode && code === S.hlCode) || (S.hlCluster >= 0 && S.clusOf && S.clusOf[i] === S.hlCluster);
            if (!hit) alpha = 0.16;
          }
          ctx.globalAlpha = alpha;
          ctx.fillStyle = hex;
          ctx.fillRect(x, y, cw + 0.3, ch + 0.3);
          if (cellPx >= 11 && pal && pal.special) {
            ctx.globalAlpha = alpha * 0.85;
            ctx.strokeStyle = 'rgba(0,0,0,.45)';
            ctx.lineWidth = Math.max(0.6, cw * 0.06);
            ctx.beginPath();
            ctx.moveTo(x + cw * 0.25, y + ch * 0.75);
            ctx.lineTo(x + cw * 0.75, y + ch * 0.25);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
      }
    }
    if (S.showGrid || opt.clean) {
      ctx.strokeStyle = 'rgba(0,0,0,.22)';
      ctx.lineWidth = Math.max(0.4, 0.7 / Math.max(sx, 1e-4));
      for (c = 0; c <= gw; c++) { x = gx + c * cw; ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy + gh * ch); ctx.stroke(); }
      for (r = 0; r <= gh; r++) { y = gy + r * ch; ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + gw * cw, y); ctx.stroke(); }
      var tk = Math.max(2, S.thick | 0);
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.lineWidth = Math.max(1, 1.6 / Math.max(sx, 1e-4));
      for (c = 0; c <= gw; c += tk) { x = gx + c * cw; ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy + gh * ch); ctx.stroke(); }
      for (r = 0; r <= gh; r += tk) { y = gy + r * ch; ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + gw * cw, y); ctx.stroke(); }
    }
    if (opt.codes !== false && cellPx >= 34 && S.cells) {
      var fs = cw * 0.44;
      ctx.font = '600 ' + fs.toFixed(2) + 'px ui-monospace,Consolas,monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (r = 0; r < gh; r++) {
        for (c = 0; c < gw; c++) {
          i = r * gw + c; code = S.cells[i];
          if (!code) continue;
          ctx.fillStyle = PC.lumOfHex(hexOf(code)) > 130 ? 'rgba(0,0,0,.8)' : 'rgba(255,255,255,.92)';
          ctx.fillText(code, gx + c * cw + cw / 2, gy + r * ch + ch / 2);
        }
      }
    }
    if (opt.ruler !== false && cellPx >= 5) {
      var fsz = Math.max(6 / sx, cw * 0.4);
      ctx.font = fsz.toFixed(2) + 'px ui-monospace,Consolas,monospace';
      ctx.fillStyle = 'rgba(0,0,0,.72)';
      var every = cellPx >= 26 ? 1 : (cellPx >= 12 ? 5 : 10);
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      for (c = 0; c < gw; c++) { if (c % every) continue; ctx.fillText(String(c + 1), gx + c * cw + cw / 2, gy - cw * 0.16); }
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (r = 0; r < gh; r++) { if (r % every) continue; ctx.fillText(String(r + 1), gx - cw * 0.18, gy + r * ch + ch / 2); }
    }
    if (!opt.clean && S.sel.size) {
      ctx.save();
      ctx.fillStyle = 'rgba(242,160,61,.38)';
      ctx.strokeStyle = '#F2A03D';
      ctx.lineWidth = Math.max(1, 2 / Math.max(sx, 1e-4));
      S.sel.forEach(function (idx) {
        var rr = (idx / gw) | 0, cc = idx % gw;
        var xx = gx + cc * cw, yy = gy + rr * ch;
        ctx.fillRect(xx, yy, cw, ch);
        ctx.strokeRect(xx, yy, cw, ch);
      });
      ctx.restore();
    }
    if (S.showBorder !== false || opt.clean) {
      ctx.strokeStyle = 'rgba(46,124,246,.85)';
      ctx.lineWidth = Math.max(1.2, 2 / Math.max(sx, 1e-4));
      ctx.strokeRect(gx, gy, gw * cw, gh * ch);
    }
    ctx.restore();
  }

  // ---------- 面板 ----------
  function renderClusters() {
    var box = $('clusterList');
    var counts = new Map();
    if (S.cells) {
      for (var i = 0; i < S.cells.length; i++) {
        var cl = S.clusOf[i];
        if (cl < 0 || !S.cells[i]) continue;
        if (S.clusters[cl] && S.cells[i] !== S.clusters[cl].code) continue;  // 手动改过的不再计入原簇
        counts.set(cl, (counts.get(cl) || 0) + 1);
      }
    }
    $('clusterInfo').textContent = S.clusters.length ? '(' + S.clusters.length + ')' : '';
    if (!S.clusters.length) { box.innerHTML = '<div class="emptyLine">载入图片后显示</div>'; return; }
    var list = S.clusters.slice().sort(function (a, b) { return (counts.get(b.id) || 0) - (counts.get(a.id) || 0); });
    box.innerHTML = '';
    var frag = document.createDocumentFragment();
    list.forEach(function (cl) {
      var n = counts.get(cl.id) || 0;
      var mat = cl.code ? matOf(cl.code) : '';
      var b = document.createElement('button');
      b.className = 'swatch' + (S.hlCluster === cl.id ? ' on' : '') + (cl.code ? '' : ' unspec');
      if (cl.code) b.style.background = hexOf(cl.code);
      b.title = (cl.code || '未指定') + (cl.code ? ' · ' + mat : '') + ' · ' + n + ' 颗' +
        (cl.altSpecial && cl.altSpecial.code !== cl.code ? '（≈' + cl.altSpecial.code + '）' : '') +
        ' · 双击改色';
      b.addEventListener('click', function () {
        S.hlCluster = (S.hlCluster === cl.id ? -1 : cl.id);
        S.hlCode = null;
        updateAll();
      });
      b.addEventListener('dblclick', function (e) {
        e.preventDefault();
        openPalette(function (code) { assignCluster(cl, code); });
      });
      frag.appendChild(b);
    });
    box.appendChild(frag);
  }
  function assignCluster(cl, code) {
    cl.code = code; cl.manual = true;
    for (var k = 0; k < cl.cells.length; k++) S.cells[cl.cells[k]] = code;
    updateAll();
    toast('色簇设为 ' + code + (matOf(code) !== '实色' ? '（' + matOf(code) + '）' : ''));
  }
  function renderStats() {
    var st = PC.countCodes(S.cells || []);
    $('statInfo').textContent = st.total ? (st.total + ' 颗 · ' + st.rows.length + ' 色') : '';
    var box = $('stats');
    if (!st.total) { box.innerHTML = '<div class="emptyLine">暂无</div>'; return; }
    box.innerHTML = '';
    var frag = document.createDocumentFragment();
    st.rows.forEach(function (row, i) {
      var pct = row.n / st.total * 100;
      var el = document.createElement('div');
      el.className = 'statRow' + (S.hlCode === row.code ? ' on' : '');
      el.innerHTML = '<span class="idx">' + (i + 1) + '</span>' +
        '<span class="sw" style="background:' + hexOf(row.code) + '"></span>' +
        '<span class="nm">' + row.code + '</span>' +
        '<span class="n">' + row.n + '</span>' +
        '<span class="pct">' + pct.toFixed(1) + '%</span>' +
        '<i class="bar" style="width:' + Math.max(2, Math.round(pct)) + '%"></i>';
      el.title = row.code + ' · ' + matOf(row.code) + ' · ' + row.n + ' 颗 · ' + pct.toFixed(1) + '%';
      el.addEventListener('click', function () {
        S.hlCode = (S.hlCode === row.code ? null : row.code);
        S.hlCluster = -1; updateAll();
      });
      frag.appendChild(el);
    });
    box.appendChild(frag);
  }
  function renderLegendDiff() {
    var box = $('legendDiff');
    if (!S.legend) { box.innerHTML = ''; $('legendInfo').textContent = ''; return; }
    var st = PC.countCodes(S.cells || []);
    var got = {};
    st.rows.forEach(function (r) { got[r.code] = r.n; });
    var diffs = [], same = 0;
    S.legend.forEach(function (e) {
      var g = got[e.code] || 0;
      if (g === e.count) same++; else diffs.push({ code: e.code, want: e.count, got: g });
    });
    var totalWant = 0;
    S.legend.forEach(function (e) { totalWant += e.count; });
    $('legendInfo').textContent = same + '/' + S.legend.length + ' 色吻合 · 豆 ' + st.total + '/' + totalWant;
    if (!diffs.length) { box.innerHTML = '<div class="tiny ok">✔ 每种颜色数量都和图例完全一致</div>'; return; }
    box.innerHTML = '';
    var frag = document.createDocumentFragment();
    diffs.sort(function (a, b) { return Math.abs(b.want - b.got) - Math.abs(a.want - a.got); });
    diffs.forEach(function (d) {
      var el = document.createElement('div');
      el.className = 'rowItem tiny';
      el.innerHTML = '<span class="sw" style="background:' + hexOf(d.code) + '"></span>' +
        '<span class="code">' + d.code + '</span><span class="grow"></span>' +
        '<span class="muted">图例 ' + d.want + '</span><span class="bad">识别 ' + d.got + '</span>';
      frag.appendChild(el);
    });
    box.appendChild(frag);
  }

  // ---------- 图片转像素画 ----------
  function makePattern() {
    if (!S.data) return toast('先载入一张图片/照片');
    var gw = clamp(parseInt($('pgw').value, 10) || 50, 4, 200);
    var gh = clamp(parseInt($('pgh').value, 10) || 50, 4, 200);
    var fit = $('pCrop').checked ? 'crop' : 'stretch';
    var opts = {
      gw: gw, gh: gh, fit: fit,
      maxColors: clamp(parseInt($('pColors').value, 10) || 0, 0, 221),
      dither: $('pDither').value,
      brightness: parseInt($('pBright').value, 10) || 0,
      contrast: parseInt($('pContrast').value, 10) || 0,
      saturation: parseInt($('pSat').value, 10) || 0,
      removeBg: $('pRemoveBg').checked,
      bgTol: 12
    };
    var t0 = performance.now();
    var res = PC.buildPatternFromImage(S.data, S.iw, S.ih, opts);
    if (!res) return toast('转换失败');
    // 几何：网格正好铺满使用的源区域
    var srcW = S.iw, srcH = S.ih, sx0 = 0, sy0 = 0;
    if (fit === 'crop') {
      var tr = gw / gh, sr = S.iw / S.ih;
      if (sr > tr) { srcW = Math.round(S.ih * tr); sx0 = Math.round((S.iw - srcW) / 2); }
      else { srcH = Math.round(S.iw / tr); sy0 = Math.round((S.ih - srcH) / 2); }
    }
    S.gw = gw; S.gh = gh;
    S.gx = sx0; S.gy = sy0;
    S.cw = srcW / gw; S.ch = srcH / gh;
    S.samples = null;
    S.legend = null; S.legendTotal = 0;
    // 用生成结果造色簇（面板/改色/统计都能直接复用）
    var byCodeMap = new Map();
    res.cells.forEach(function (code, i) {
      if (!code) return;
      if (!byCodeMap.has(code)) byCodeMap.set(code, []);
      byCodeMap.get(code).push(i);
    });
    S.clusters = res.paletteUsed.map(function (p, idx) {
      return { id: idx, rgb: p.rgb.slice(), code: p.code, de: 0, cells: byCodeMap.get(p.code) || [], suggest: p.code };
    }).filter(function (cl) { return cl.cells.length; });
    S.clusters.forEach(function (cl, idx) { cl.id = idx; });
    S.clusOf = new Int32Array(S.cells ? S.cells.length : res.cells.length).fill(-1);
    S.cells = res.cells.slice();
    S.clusOf = new Int32Array(S.cells.length).fill(-1);
    S.clusters.forEach(function (cl) {
      cl.cells.forEach(function (i) { S.clusOf[i] = cl.id; });
    });
    S.sel.clear(); S.undo = []; S.redo = [];
    S.gridActive = true;
    $('gw').value = S.gw; $('gh').value = S.gh;
    $('patternInfo').textContent = res.paletteUsed.length + ' 色 / ' + res.total + ' 颗';
    updateAll();
    fitView();
    pushUndo();
    setStatus('已生成像素画：' + S.gw + '×' + S.gh + ' · ' + res.paletteUsed.length + ' 色 · ' +
      res.total + ' 颗 · ' + Math.round(performance.now() - t0) + 'ms（可继续用色簇/选区/导出）');
    toast('已生成像素画');
  }

  // ---------- 图例 ----------
  function parseLegend(text) {
    var out = [], m;
    var re = /([A-Z]{1,2}\d{1,3})\s*[:：,，=\s]\s*(\d{1,5})/g;
    while ((m = re.exec(text))) out.push({ code: m[1].toUpperCase(), count: parseInt(m[2], 10) });
    return out;
  }
  function applyLegend() {
    if (!S.samples) { toast('先载入图片'); return; }
    var list = parseLegend($('legendIn').value || '');
    if (!list.length) { toast('没解析出图例，格式如：A20 109'); return; }
    S.legend = list;
    S.legendTotal = list.reduce(function (a, b) { return a + b.count; }, 0);
    resample(true);
    toast('已套用图例：' + list.length + ' 色 / ' + S.legendTotal + ' 颗（空白判定已自动调）');
  }

  // ---------- 选择与编辑 ----------
  function hitCell(px, py) {
    if (!S.gridActive) return -1;
    var ix = (px - S.view.tx) / S.view.s, iy = (py - S.view.ty) / S.view.s;
    var c = Math.floor((ix - S.gx) / S.cw), r = Math.floor((iy - S.gy) / S.ch);
    if (c < 0 || r < 0 || c >= S.gw || r >= S.gh) return -1;
    return r * S.gw + c;
  }
  function selectCell(idx, add) {
    if (!S.cells) return;
    var code = S.cells[idx];
    if (!code) { S.sel.clear(); updateAll(); return; }   // 点空白 → 清空选择
    var set = new Set();
    if (S.mode === 'color') {
      for (var i = 0; i < S.cells.length; i++) if (S.cells[i] === code) set.add(i);
    } else {
      var gw = S.gw, gh = S.gh, seen = new Uint8Array(S.cells.length), stack = [idx];
      seen[idx] = 1;
      var nb = S.conn8 ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
                       : [[1, 0], [-1, 0], [0, 1], [0, -1]];
      while (stack.length) {
        var cur = stack.pop(); set.add(cur);
        var cr = (cur / gw) | 0, cc = cur % gw;
        for (var d = 0; d < nb.length; d++) {
          var nc = cc + nb[d][0], nr = cr + nb[d][1];
          if (nc < 0 || nr < 0 || nc >= gw || nr >= gh) continue;
          var j = nr * gw + nc;
          if (seen[j] || S.cells[j] !== code) continue;
          seen[j] = 1; stack.push(j);
        }
      }
    }
    // 连续点击累加：该块已全选中 → 再点就取消；否则并入。Shift 点击强制加选。
    var allIn = true;
    set.forEach(function (i2) { if (!S.sel.has(i2)) allIn = false; });
    if (allIn && !add) set.forEach(function (i2) { S.sel.delete(i2); });
    else set.forEach(function (i2) { S.sel.add(i2); });
    updateAll();
  }
  function pushUndo() {
    if (!S.cells) return;
    S.undo.push(S.cells.slice());
    if (S.undo.length > 60) S.undo.shift();
    S.redo.length = 0;
  }
  function doDelete() {
    if (!S.sel.size) return toast('先在图上点选格子');
    pushUndo();
    S.sel.forEach(function (i) { S.cells[i] = null; });
    S.sel.clear(); updateAll(); toast('已置空');
  }
  function doRecolor() {
    if (!S.sel.size) return toast('先在图上点选格子');
    openPalette(function (code) {
      pushUndo();
      S.sel.forEach(function (i) { S.cells[i] = code; });
      S.sel.clear(); updateAll(); toast('已改色为 ' + code);
    });
  }
  function doUndo() {
    if (!S.undo.length) return toast('没有可撤销');
    S.redo.push(S.cells.slice()); S.cells = S.undo.pop(); S.sel.clear(); updateAll();
  }
  function doRedo() {
    if (!S.redo.length) return toast('没有可重做');
    S.undo.push(S.cells.slice()); S.cells = S.redo.pop(); S.sel.clear(); updateAll();
  }

  // 擦除：单击即置空，按住可连续擦；一次笔画只压一条 undo
  var eraseDirty = false;
  function eraseAt(idx) {
    if (!S.cells || idx < 0 || idx >= S.cells.length) return;
    if (!S.cells[idx]) return;
    S.cells[idx] = null;
    if (S.sel.has(idx)) S.sel.delete(idx);
    eraseDirty = true;
    render();
  }

  // ---------- 色号弹窗 ----------
  var palCb = null, palSeries = 'all';
  var CHIPS = [['all', '全部'], ['std', '标准221'], ['P', '珠光'], ['R', '半透明'], ['T', '全透明'],
               ['Y', '夜光'], ['M', '莫兰迪'], ['Q', '温变'], ['ZG', '光变']];
  function openPalette(cb) {
    palCb = cb; palSeries = 'all';
    $('modal').classList.remove('hidden');
    $('palSearch').value = '';
    renderPalette();
    $('palSearch').focus();
  }
  function closePalette() { $('modal').classList.add('hidden'); palCb = null; }
  function renderPalette() {
    var chips = $('palChips');
    chips.innerHTML = '';
    CHIPS.forEach(function (it) {
      var b = document.createElement('span');
      b.className = 'chip' + (palSeries === it[0] ? ' on' : '');
      b.textContent = it[1];
      b.addEventListener('click', function () { palSeries = it[0]; renderPalette(); });
      chips.appendChild(b);
    });
    var q = ($('palSearch').value || '').trim().toUpperCase();
    var grid = $('palGrid');
    grid.innerHTML = '';
    var frag = document.createDocumentFragment();
    PAL.filter(function (c) {
      if (palSeries === 'std') { if (c.special) return false; }
      else if (palSeries !== 'all') { if (c.series !== palSeries) return false; }
      if (!q) return true;
      return c.code.indexOf(q) >= 0 || String(c.group || '').indexOf(q) >= 0;
    }).forEach(function (c) {
      var d = document.createElement('div');
      d.className = 'palItem';
      d.innerHTML = '<div class="cap" style="background:' + c.hex + '"></div><div class="lbl">' + c.code + '</div>';
      d.title = c.code + ' ' + c.hex + (c.special ? ' · ' + (MAT[c.series] || '') : '');
      d.addEventListener('click', function () {
        var code = c.code, fn = palCb;      // 先取出回调，closePalette 会把它清空
        closePalette();
        if (fn) fn(code);
      });
      frag.appendChild(d);
    });
    grid.appendChild(frag);
  }

  // ---------- 画布交互 ----------
  function canvasPos(e) { var r = $('cv').getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  $('cv').addEventListener('contextmenu', function (e) { e.preventDefault(); });
  $('cv').addEventListener('mousedown', function (e) {
    if (!S.data) return;
    var p = canvasPos(e);
    if (S.spaceDown || e.button === 1 || e.button === 2 || S.tool === 'pan') {
      S.dragging = { type: 'pan', px: p.x, py: p.y };
      $('cv').style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }
    if (S.tool === 'box') {
      if (S.boxFirst) {                      // 第二次点：用两个对角定框
        finishBox(S.boxFirst, { x: p.x, y: p.y });
        S.boxFirst = null;
        return;
      }
      S.boxAnchor = { x: p.x, y: p.y };      // 先记下起点，拖了就是拖框，没拖就等第二次点
      S.boxDrag = null;
      render();
      return;
    }
    if (S.tool === 'erase') {
      var ce = hitCell(p.x, p.y);
      if (ce >= 0) {
        if (S.cells && S.cells[ce]) pushUndo();
        eraseAt(ce);
        S.dragging = { type: 'erase' };
      }
      e.preventDefault();
      return;
    }
    var cell = hitCell(p.x, p.y);
    if (cell >= 0) selectCell(cell, e.shiftKey);
  });
  window.addEventListener('mousemove', function (e) {
    var p = canvasPos(e);
    S.mouse = p;
    if (S.dragging && S.dragging.type === 'erase') {
      eraseAt(hitCell(p.x, p.y));
      return;
    }
    if (S.dragging && S.dragging.type === 'pan') {
      S.view.tx += p.x - S.dragging.px; S.view.ty += p.y - S.dragging.py;
      S.dragging.px = p.x; S.dragging.py = p.y;
      render();
    } else if (S.boxAnchor) {
      if (Math.abs(p.x - S.boxAnchor.x) + Math.abs(p.y - S.boxAnchor.y) > 8) {
        S.boxDrag = { x0: S.boxAnchor.x, y0: S.boxAnchor.y, x1: p.x, y1: p.y };
        render();
      }
    } else if (S.boxDrag) {
      S.boxDrag.x1 = p.x; S.boxDrag.y1 = p.y;
      render();
    } else if (S.boxFirst) {
      render();   // 两点模式下跟着鼠标画预览
    }
  });
  window.addEventListener('mouseup', function () {
    if (S.dragging && S.dragging.type === 'erase') {
      S.dragging = null;
      if (eraseDirty) { eraseDirty = false; updateAll(); }
      updateCursor();
      return;
    }
    updateCursor();
    S.dragging = null;
    if (S.boxAnchor) {
      if (S.boxDrag) {
        finishBox({ x: S.boxDrag.x0, y: S.boxDrag.y0 }, { x: S.boxDrag.x1, y: S.boxDrag.y1 });
        S.boxDrag = null;
      } else {
        S.boxFirst = { x: S.boxAnchor.x, y: S.boxAnchor.y };   // 没拖动 → 等用户点第二个角
        toast('已定第一个角，再点一下对角（Esc 取消）');
      }
      S.boxAnchor = null;
      render();
      return;
    }
    if (!S.boxDrag) return;
    var d2 = S.boxDrag; S.boxDrag = null;
    finishBox({ x: d2.x0, y: d2.y0 }, { x: d2.x1, y: d2.y1 });
  });

  // 用两个屏幕坐标（可拖动框出来的，也可点两个对角）定网格：边缘吸附格线后换算成格距
  function finishBox(a, b) {
    var x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    var y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    if (x1 - x0 < 10 || y1 - y0 < 10) { toast('框太小了，请重新框一次'); return; }
    var ix0 = (x0 - S.view.tx) / S.view.s, ix1 = (x1 - S.view.tx) / S.view.s;
    var iy0 = (y0 - S.view.ty) / S.view.s, iy1 = (y1 - S.view.ty) / S.view.s;
    function snap(axis, v) {
      var sv = PC.snapToLine(S.data, S.iw, S.ih, axis, v, 6);
      return Math.abs(sv - v) < 6 ? sv : v;
    }
    S.gx = snap('x', ix0); S.gy = snap('y', iy0);
    var ex = snap('x', ix1), ey = snap('y', iy1);
    S.cw = (ex - S.gx) / S.gw;
    S.ch = (ey - S.gy) / S.gh;
    S.boxFirst = null; S.boxAnchor = null; S.boxDrag = null;
    setTool('select');
    resample(true);
    setStatus('网格已按框选对齐：格 ' + S.cw.toFixed(2) + '×' + S.ch.toFixed(2) +
      '，之后可用方向键微调');
    toast('网格已对齐');
  }

  $('cv').addEventListener('wheel', function (e) {
    if (!S.data) return;
    e.preventDefault();
    var p = canvasPos(e);
    var k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    var s1 = clamp(S.view.s * k, 0.02, 40), real = s1 / S.view.s;
    S.view.tx = p.x - (p.x - S.view.tx) * real;
    S.view.ty = p.y - (p.y - S.view.ty) * real;
    S.view.s = s1;
    render();
  }, { passive: false });

  // ---------- 控件 ----------
  function updateCursor() {
    if (!S.data) return;
    var cur = S.spaceDown ? 'grab'
      : (S.tool === 'box' || S.tool === 'erase') ? 'crosshair'
      : (S.tool === 'pan' ? 'grab' : 'default');
    $('cv').style.cursor = cur;
  }
  function showBoxHint(on) {
    var h = $('hint');
    if (!on) { h.style.display = 'none'; return; }
    h.style.display = 'block';
    h.innerHTML = '在图上<b>拖一个矩形</b>框住整片网格；或者<b>点两个对角点</b>也行' +
      '<br><span class="tiny">（松手会自动吸附到最近的格线，Esc 取消）</span>';
  }
  function setTool(t) {
    if (t !== 'box') { S.boxFirst = null; S.boxAnchor = null; S.boxDrag = null; }
    S.tool = t;
    $('boxTool').classList.toggle('active', t === 'box');
    var map = { select: 'toolSel', erase: 'toolErase', box: 'toolBox', pan: 'toolPan' };
    Object.keys(map).forEach(function (k) {
      var el = $(map[k]); if (el) el.classList.toggle('on', k === t);
    });
    var tbSel = $('tbSelect'); if (tbSel) tbSel.classList.toggle('on', t === 'select');
    showBoxHint(t === 'box');
    updateCursor();
  }
  $('boxTool').addEventListener('click', function () {
    var entering = S.tool !== 'box';
    if (entering) removeGrid(true);      // 进入框选前先清掉旧网格，避免旧框干扰
    setTool(entering ? 'box' : 'select');
  });
  $('autoAlign').addEventListener('click', function () { autoAlign(false); });
  $('resetGrid').addEventListener('click', function () { removeGrid(false); });
  $('fitBtn').addEventListener('click', fitView);
  // 边缘裁一格：裁掉图纸边缘的花纹/杂色带
  function trimEdge(dir) {
    if (!S.gridActive) return toast('还没有网格：先框选或自动对齐');
    if (dir === 'top') { S.gy += S.ch; S.gh -= 1; }
    else if (dir === 'bottom') { S.gh -= 1; }
    else if (dir === 'left') { S.gx += S.cw; S.gw -= 1; }
    else if (dir === 'right') { S.gw -= 1; }
    if (S.gw < 1 || S.gh < 1) { toast('已经裁到没有了'); return; }
    $('gw').value = S.gw; $('gh').value = S.gh;
    resample(true);
    setStatus('已裁掉一侧：现在 ' + S.gw + '×' + S.gh);
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-trim]'), function (b) {
    b.addEventListener('click', function () { trimEdge(b.getAttribute('data-trim')); });
  });

  $('applyGeo').addEventListener('click', function () {
    if (!S.gridActive) { toast('还没有网格：先「框选网格」或「自动对齐」'); return; }
    resample(true);
  });
  $('makePattern').addEventListener('click', makePattern);
  $('pShowImg').addEventListener('change', function (e) {
    S.showImage = e.target.checked;
    if (e.target.parentNode) e.target.parentNode.classList.toggle('on', S.showImage);
    render();
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-preset]'), function (b) {
    b.addEventListener('click', function () {
      var n = parseInt(b.getAttribute('data-preset'), 10);
      $('pgw').value = n; $('pgh').value = n;
    });
  });
  $('pgw').addEventListener('change', function (e) {
    var v = clamp(parseInt(e.target.value, 10) || 50, 4, 200);
    e.target.value = v;
    if ($('pLock').checked && S.iw) $('pgh').value = clamp(Math.round(v * S.ih / S.iw), 4, 200);
  });

  $('applyLegend').addEventListener('click', applyLegend);
  // 清理杂色：把小到不合理的零碎色块整块置空（水印/花边/压缩噪点），并把这些色从色簇列表里移除
  $('cleanNoise').addEventListener('click', function () {
    if (!S.cells || !S.clusters.length) return toast('先识别出结果');
    var total = 0, i;
    for (i = 0; i < S.cells.length; i++) if (S.cells[i]) total++;
    var floor = Math.max(4, Math.round(total * 0.01));
    var tiny = S.clusters.filter(function (cl) { return cl.cells.length < floor; });
    if (!tiny.length) return toast('没有需要清理的小杂色（阈值 ' + floor + ' 颗）');
    pushUndo();
    var killed = 0;
    tiny.forEach(function (cl) {
      cl.cells.forEach(function (ci) { if (S.cells[ci]) { S.cells[ci] = null; killed++; } });
    });
    // 把这些块从色簇列表里删掉，并重建 id / clusOf
    var keep = S.clusters.filter(function (cl) {
      return cl.cells.some(function (ci) { return !!S.cells[ci]; });
    });
    var newClus = new Int32Array(S.cells.length).fill(-1);
    keep.forEach(function (cl, idx) {
      cl.id = idx;
      cl.cells = cl.cells.filter(function (ci) { return !!S.cells[ci]; });
      cl.cells.forEach(function (ci) { newClus[ci] = idx; });
    });
    S.clusters = keep;
    S.clusOf = newClus;
    S.sel.clear();
    updateAll();
    toast('已清理 ' + tiny.length + ' 个杂色块（共 ' + killed + ' 颗 < ' + floor + ' 颗的）');
  });

  $('delBtn').addEventListener('click', doDelete);
  $('recolorBtn').addEventListener('click', doRecolor);
  $('undoBtn').addEventListener('click', doUndo);
  $('redoBtn').addEventListener('click', doRedo);
  $('clearSel').addEventListener('click', function () { S.sel.clear(); updateAll(); });
  $('showGrid').addEventListener('change', function (e) {
    S.showGrid = e.target.checked;
    var pg = $('pillGrid'); if (pg) { pg.checked = S.showGrid; if (pg.parentNode) pg.parentNode.classList.toggle('on', S.showGrid); }
    render();
  });
  $('thick').addEventListener('change', function (e) { S.thick = clamp(parseInt(e.target.value, 10) || 10, 2, 30); render(); });
  $('inkThr').addEventListener('input', function (e) {
    S.inkThr = parseInt(e.target.value, 10) || 22;
    $('inkThrVal').textContent = S.inkThr;
    if (S.samples) { rebuildClusters(); updateAll(); }
  });
  $('gw').addEventListener('change', function (e) {
    S.gw = clamp(parseInt(e.target.value, 10) || 50, 1, 200);
    e.target.value = S.gw;
    removeGrid(true);
    if (S.data) { setTool('box'); setStatus('网格数已改为 ' + S.gw + '×' + S.gh + ' → 请框选网格或自动对齐'); }
    fitView();
  });
  $('gh').addEventListener('change', function (e) {
    S.gh = clamp(parseInt(e.target.value, 10) || 50, 1, 200);
    e.target.value = S.gh;
    removeGrid(true);
    if (S.data) { setTool('box'); setStatus('网格数已改为 ' + S.gw + '×' + S.gh + ' → 请框选网格或自动对齐'); }
    fitView();
  });
  Array.prototype.forEach.call(document.querySelectorAll('.stepBtn'), function (b) {
    b.addEventListener('click', function () {
      S.step = parseFloat(b.getAttribute('data-step'));
      Array.prototype.forEach.call(document.querySelectorAll('.stepBtn'), function (o) { o.classList.remove('active'); });
      b.classList.add('active');
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-nudge]'), function (b) {
    b.addEventListener('click', function () {
      if (!S.gridActive) { toast('还没有网格：先「框选网格」或「自动对齐」'); return; }
      var v = b.getAttribute('data-nudge').split(',').map(Number);
      if (v[0] === -2) S.cw -= S.step;
      else if (v[0] === 2) S.cw += S.step;
      else { S.gx += v[0] * S.step; S.gy += v[1] * S.step; }
      resample(false);
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('input[name=selmode]'), function (r) {
    r.addEventListener('change', function () { S.mode = r.value; });
  });
  $('conn8').addEventListener('change', function (e) { S.conn8 = e.target.checked; });
  $('zoomIn').addEventListener('click', function () { zoomBy(1.25); });
  $('zoomOut').addEventListener('click', function () { zoomBy(1 / 1.25); });
  $('zoomReset').addEventListener('click', function () { S.view.s = 1; render(); });
  function zoomBy(k) {
    var stage = $('stage');
    var cx = stage.clientWidth / 2, cy = stage.clientHeight / 2;
    var s1 = clamp(S.view.s * k, 0.02, 40), real = s1 / S.view.s;
    S.view.tx = cx - (cx - S.view.tx) * real;
    S.view.ty = cy - (cy - S.view.ty) * real;
    S.view.s = s1;
    render();
  }
  $('exportPng').addEventListener('click', exportPng);
  $('exportCsv').addEventListener('click', exportCsv);
  $('file').addEventListener('change', function (e) { readFile(e.target.files && e.target.files[0]); });
  $('palClose').addEventListener('click', closePalette);
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closePalette(); });
  $('palSearch').addEventListener('input', renderPalette);

  window.addEventListener('paste', function (e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image') === 0) {
        readFile(items[i].getAsFile()); e.preventDefault(); return;
      }
    }
  });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readFile(f);
  });
  window.addEventListener('keydown', function (e) {
    var tag = ((e.target && e.target.tagName) || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.code === 'Space' || e.key === ' ') {
      if (!S.spaceDown) { S.spaceDown = true; updateCursor(); }
      e.preventDefault();     // 防止页面滚动
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) doRedo(); else doUndo();
      return;
    }
    if (e.key === 'Delete') { if (S.sel.size) { e.preventDefault(); doDelete(); } return; }
    if (e.key === 'Escape') {
      S.sel.clear(); S.boxFirst = null; S.boxAnchor = null; S.boxDrag = null;
      setTool('select'); closePalette(); updateAll(); return;
    }
    if (!S.data) return;
    if (!S.gridActive) return;
    var step = e.shiftKey ? 5 : S.step;
    if (e.key === 'ArrowLeft') { S.gx -= step; resample(false); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { S.gx += step; resample(false); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { S.gy -= step; resample(false); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { S.gy += step; resample(false); e.preventDefault(); }
  });
  window.addEventListener('keyup', function (e) {
    if (e.code === 'Space' || e.key === ' ') { S.spaceDown = false; updateCursor(); }
  });
  window.addEventListener('blur', function () {
    S.spaceDown = false; S.dragging = null; updateCursor();
  });
  window.addEventListener('resize', function () { render(); });

  // ---------- 导出 ----------
  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  function exportPng() {
    if (!S.cells) return toast('先载入图片');
    var CELL = 18, PAD = 34;
    var w = S.gw * CELL + PAD * 2, h = S.gh * CELL + PAD * 2 + 18;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    var sx = CELL / S.cw, sy = CELL / S.ch;
    drawProject(ctx, { sx: sx, sy: sy, tx: PAD - S.gx * sx, ty: PAD - S.gy * sy },
      { codes: true, noImage: true, clean: true, ruler: true });
    var st = PC.countCodes(S.cells);
    ctx.fillStyle = '#333';
    ctx.font = '12px ui-monospace,Consolas,monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText(S.gw + '×' + S.gh + ' / ' + st.rows.length + ' 色 / 共 ' + st.total + ' 颗', w - 10, h - 6);
    c.toBlob(function (b) { download(b, '拼豆图纸_' + S.gw + 'x' + S.gh + '.png'); }, 'image/png');
  }
  function exportCsv() {
    if (!S.cells) return toast('先载入图片');
    var st = PC.countCodes(S.cells);
    var lines = ['色号,系列,材质,数量,占比%'];
    st.rows.forEach(function (r) {
      lines.push([r.code, PC.seriesOf(r.code), matOf(r.code), r.n, (r.n / st.total * 100).toFixed(2)].join(','));
    });
    lines.push(['合计', '', '', st.total, '100'].join(','));
    download(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), '拼豆用量清单.csv');
  }

  // ---------- v0.3 新界面：模式 / 工具 / 检查器 ----------
  var MODE = 'scan';
  function setMode(m) {
    MODE = m;
    document.body.setAttribute('data-mode', m);
    $('modeScan').classList.toggle('on', m === 'scan');
    $('modePhoto').classList.toggle('on', m === 'photo');
    renderInspector();
  }
  $('modeScan').addEventListener('click', function () { setMode('scan'); });
  $('modePhoto').addEventListener('click', function () { setMode('photo'); });

  $('fileClear').addEventListener('click', function () {
    S.img = null; S.data = null; S.iw = 0; S.ih = 0;
    S.samples = null; S.clusters = []; S.cells = null; S.clusOf = null;
    S.sel.clear(); S.undo = []; S.redo = [];
    S.gridActive = false; S.legend = null; S.legendTotal = 0;
    S.hlCode = null; S.hlCluster = -1;
    $('fileName').textContent = '未选择图片';
    $('fileSize').textContent = '拖入图片或 Ctrl+V';
    $('file').value = '';
    updateAll();
    setStatus('等待载入图片：拖入文件，或按 Ctrl+V 粘贴截图');
    toast('已移除图片');
  });

  function setGeoPane(which) {
    var auto = which === 'auto';
    $('tabAuto').classList.toggle('on', auto);
    $('tabManual').classList.toggle('on', !auto);
    $('paneAuto').style.display = auto ? '' : 'none';
    $('paneManual').style.display = auto ? 'none' : '';
  }
  $('tabAuto').addEventListener('click', function () { setGeoPane('auto'); });
  $('tabManual').addEventListener('click', function () { setGeoPane('manual'); });

  $('toolSel').addEventListener('click', function () { setTool('select'); });
  $('toolErase').addEventListener('click', function () { setTool('erase'); });
  $('toolBox').addEventListener('click', function () { $('boxTool').click(); });
  $('toolPan').addEventListener('click', function () { setTool('pan'); });
  $('tbSelect').addEventListener('click', function () { setTool('select'); });

  $('autoAlignIn').addEventListener('click', function () { $('autoAlign').click(); });
  $('exportPngTop').addEventListener('click', function () { $('exportPng').click(); });
  $('exportCsvTop').addEventListener('click', function () { $('exportCsv').click(); });
  $('exportCsvLink').addEventListener('click', function () { $('exportCsv').click(); });

  $('autoColor').addEventListener('click', function () {
    if (MODE === 'photo') { makePattern(); return; }
    if (!S.data) return toast('先载入图片');
    if (S.gridActive) { resample(true); toast('已按当前网格重新配色'); }
    else { autoAlign(false); }
  });

  $('recolorBtn2').addEventListener('click', function () {
    var cl = S.clusters.filter(function (c) { return c.id === S.hlCluster; })[0];
    if (cl) { openPalette(function (code) { assignCluster(cl, code); }); return; }
    if (S.hlCode) {
      var old = S.hlCode;
      openPalette(function (code) {
        if (!S.cells) return;
        pushUndo();
        for (var i = 0; i < S.cells.length; i++) if (S.cells[i] === old) S.cells[i] = code;
        S.hlCode = code; updateAll(); toast('已替换为 ' + code);
      });
      return;
    }
    doRecolor();
  });

  $('showBorder').addEventListener('change', function (e) { S.showBorder = e.target.checked; render(); });

  $('fullBtn').addEventListener('click', function () {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    var st = $('stage');
    if (st.requestFullscreen) st.requestFullscreen();
  });
  document.addEventListener('fullscreenchange', function () {
    setTimeout(function () { fitView(); render(); }, 60);
  });

  $('pillGrid').addEventListener('change', function (e) {
    S.showGrid = e.target.checked;
    $('showGrid').checked = S.showGrid;
    if (e.target.parentNode) e.target.parentNode.classList.toggle('on', S.showGrid);
    render();
  });

  function syncPvTabs() {
    $('pvTabPattern').classList.toggle('on', pvMode === 'pattern');
    $('pvTabImage').classList.toggle('on', pvMode === 'image');
  }
  $('pvTabPattern').addEventListener('click', function () { pvMode = 'pattern'; syncPvTabs(); renderPreview(); });
  $('pvTabImage').addEventListener('click', function () { pvMode = 'image'; syncPvTabs(); renderPreview(); });

  $('legendOpen').addEventListener('click', function () {
    $('legendModal').classList.remove('hidden');
    $('legendIn').focus();
  });
  $('legendClose').addEventListener('click', function () { $('legendModal').classList.add('hidden'); });
  $('legendModal').addEventListener('click', function (e) {
    if (e.target === $('legendModal')) $('legendModal').classList.add('hidden');
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-step-in]'), function (b) {
    b.addEventListener('click', function () {
      var el = $(b.getAttribute('data-step-in'));
      if (!el) return;
      var dir = parseInt(b.getAttribute('data-dir'), 10) || 1;
      var v = (parseInt(el.value, 10) || 0) + dir;
      var min = parseInt(el.getAttribute('min'), 10), max = parseInt(el.getAttribute('max'), 10);
      if (!isNaN(min)) v = Math.max(min, v);
      if (!isNaN(max)) v = Math.min(max, v);
      el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll('input[type=range][data-out]'), function (r) {
    var out = document.querySelector('[data-for=' + r.id + ']');
    if (!out) return;
    r.addEventListener('input', function () { out.textContent = r.value; });
  });

  $('resetTune').addEventListener('click', function () {
    ['pBright', 'pContrast', 'pSat'].forEach(function (id) {
      var el = $(id); if (!el) return;
      el.value = 0;
      var out = document.querySelector('[data-for=' + id + ']');
      if (out) out.textContent = '0';
    });
    S.inkThr = 22; $('inkThr').value = 22; $('inkThrVal').textContent = '22';
    if (S.samples) { rebuildClusters(); updateAll(); }
    toast('已重置预处理参数');
  });

  function swapWH(vertical) {
    if (!S.data) return toast('先载入图片');
    var need = vertical ? (S.gw >= S.gh) : (S.gh > S.gw);
    if (need) {
      var t = S.gw; S.gw = S.gh; S.gh = t;
      $('gw').value = S.gw; $('gh').value = S.gh;
      S.gx = 0; S.gy = 0;
      S.cw = S.iw / S.gw; S.ch = S.ih / S.gh;
      resample(true); fitView();
      toast('已按' + (vertical ? '竖版' : '横版') + '交换宽高：' + S.gw + ' × ' + S.gh);
    }
    $('dirH').classList.toggle('on', !vertical);
    $('dirV').classList.toggle('on', vertical);
  }
  $('dirH').addEventListener('click', function () { swapWH(false); });
  $('dirV').addEventListener('click', function () { swapWH(true); });

  syncPvTabs();
  setGeoPane('auto');
  setMode('scan');

  setStatus('等待载入图片：拖入文件，或按 Ctrl+V 粘贴截图');
  render();
})();
