/* app.js 冒烟测试：用极简 DOM 桩把界面脚本跑一遍，捕获初始化阶段的引用错误/拼写错误
 * 运行：node _smoketest.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let errors = [];

function noop() {}
function makeCtx() {
  return new Proxy({}, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'canvas') return { width: 100, height: 100 };
      return function () { return undefined; };
    },
    set: (t, k, v) => { t[k] = v; return true; }
  });
}

function makeEl(id) {
  const el = {
    id: id || '', textContent: '', innerHTML: '', value: '', title: '', className: '',
    width: 0, height: 0, clientWidth: 900, clientHeight: 700,
    style: {}, dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, removeEventListener: noop, appendChild: noop,
    removeChild: noop, remove: noop, click: noop, focus: noop, blur: noop,
    setAttribute: noop, getAttribute: () => null, hasAttribute: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 700 }),
    getContext: () => makeCtx(),
    toBlob: noop, toDataURL: () => 'data:,',
    querySelector: () => makeEl('q'),
    querySelectorAll: () => [],
    files: [], checked: false
  };
  return el;
}

const sandbox = {
  console,
  setTimeout: (fn) => 0,
  clearTimeout: noop,
  performance: { now: () => 0 },
  URL: { createObjectURL: () => 'blob:', revokeObjectURL: noop },
  Blob: function () {},
  Event: function (t, o) { this.type = t; this.bubbles = !!(o && o.bubbles); },
  Image: function () { this.onload = null; this.onerror = null; },
  FileReader: function () { this.readAsDataURL = noop; },
  devicePixelRatio: 1,
  Math, Date, JSON, Map, Set, Array, Object, String, Number, Float32Array, Int32Array,
  Uint8Array, Uint16Array, Uint8ClampedArray, parseInt, parseFloat, isNaN,
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.document = {
  getElementById: (id) => makeEl(id),
  createElement: () => makeEl('created'),
  createDocumentFragment: () => makeEl('frag'),
  querySelectorAll: () => [makeEl('sel')],
  querySelector: () => makeEl('q'),
  body: makeEl('body'),
  documentElement: makeEl('html'),
  fullscreenElement: null,
  exitFullscreen: noop,
  addEventListener: noop
};
sandbox.addEventListener = noop;

const ctx = vm.createContext(sandbox);
const dir = __dirname;
const files = ['mard-palette.js', 'core.js', 'app.js'];
for (const f of files) {
  const code = fs.readFileSync(path.join(dir, f), 'utf8');
  try {
    vm.runInContext(code, ctx, { filename: f });
    console.log('  ✓ 执行通过：' + f);
  } catch (e) {
    errors.push(f + ': ' + e.message);
    console.error('  ✗ ' + f + ' → ' + e.message);
  }
}

// 检查关键全局是否就位
const checks = [
  ['PindouCore', sandbox.PindouCore],
  ['MARD_PALETTE', sandbox.MARD_PALETTE],
];
for (const [name, v] of checks) {
  if (!v) { errors.push('缺少全局 ' + name); console.error('  ✗ 缺少全局 ' + name); }
  else console.log('  ✓ 全局 ' + name + ' 就位');
}
if (sandbox.PindouCore) {
  const need = ['init', 'sampleGrid', 'buildClusters', 'autoAlign', 'fitAxis', 'refineAxis', 'isEmptyCell', 'matchByLegend', 'applyCodes', 'countCodes', 'snapToLine', 'byCode'];
  for (const k of need) {
    if (typeof sandbox.PindouCore[k] !== 'function') { errors.push('core 缺函数 ' + k); console.error('  ✗ core 缺函数 ' + k); }
  }
  console.log('  ✓ core 导出函数齐全');
}

// ---- HTML 契约校验：app.js 引用的每个 id 都必须在 index.html 里存在且唯一 ----
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
const htmlIds = new Map();
for (const m of html.matchAll(/\sid="([^"]+)"/g)) {
  htmlIds.set(m[1], (htmlIds.get(m[1]) || 0) + 1);
}
const usedIds = new Set();
for (const m of appSrc.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)) usedIds.add(m[1]);
for (const m of appSrc.matchAll(/getElementById\('([A-Za-z0-9_]+)'\)/g)) usedIds.add(m[1]);

const missing = [...usedIds].filter((id) => !htmlIds.has(id));
const dup = [...htmlIds.entries()].filter(([, n]) => n > 1).map(([id]) => id);
if (missing.length) {
  errors.push('HTML 缺少 id: ' + missing.join(', '));
  console.error('  ✗ index.html 缺少 ' + missing.length + ' 个 id → ' + missing.join(', '));
} else {
  console.log('  ✓ app.js 引用的 ' + usedIds.size + ' 个 id 在 index.html 里全部存在');
}
if (dup.length) {
  errors.push('HTML 重复 id: ' + dup.join(', '));
  console.error('  ✗ index.html 有重复 id → ' + dup.join(', '));
} else {
  console.log('  ✓ index.html 没有重复 id');
}

console.log(errors.length ? '\n✗ 冒烟测试失败：' + errors.length + ' 处' : '\n✔ 冒烟测试通过（界面脚本可正常初始化）');
if (errors.length) process.exitCode = 1;
