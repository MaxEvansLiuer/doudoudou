/* 新版界面 UI 冒烟测试：用 jsdom 真跑 index.html，验证脚本初始化 + 关键交互绑定
 * 运行：NODE_PATH=.../node_modules node _uismoke.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const FILE = path.join(__dirname, 'index.html');
const errors = [];

function fakeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'canvas') return { width: 100, height: 100 };
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

const dom = new JSDOM(fs.readFileSync(FILE, 'utf8'), {
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  url: 'file:///' + FILE.replace(/\\/g, '/'),
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(); };
    w.HTMLCanvasElement.prototype.toBlob = function () {};
    w.HTMLElement.prototype.requestFullscreen = function () {};
    w.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e.error)));
    const origErr = w.console.error;
    w.console.error = function () {
      errors.push('console.error: ' + Array.prototype.join.call(arguments, ' '));
      origErr.apply(w.console, arguments);
    };
  }
});

const w = dom.window, d = w.document;
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const change = (el) => el.dispatchEvent(new w.Event('change', { bubbles: true }));
const $ = (s) => d.querySelector(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function ok(name, cond, extra) {
  results.push({ name, cond: !!cond, extra: extra || '' });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  ' + (extra || '')));
}

(async () => {
  await wait(400);

  ok('脚本全部加载（无运行时错误）', errors.length === 0, errors.join(' | '));
  ok('状态栏已初始化', /等待载入图片/.test($('#status').textContent), $('#status').textContent);
  ok('初始为图纸截图模式', d.body.getAttribute('data-mode') === 'scan');
  ok('左栏 6 张步骤卡', d.querySelectorAll('.rail-left .card').length === 6,
    '实际 ' + d.querySelectorAll('.rail-left .card').length);
  ok('右栏 4 张卡', d.querySelectorAll('.rail-right .card').length === 4,
    '实际 ' + d.querySelectorAll('.rail-right .card').length);
  ok('画布区有 canvas', !!$('#cv'));
  ok('预览 canvas 有尺寸', $('#pv').width > 0);

  // 模式切换
  click($('#modePhoto'));
  ok('切到照片模式 → data-mode=photo', d.body.getAttribute('data-mode') === 'photo');
  ok('照片模式按钮高亮', $('#modePhoto').classList.contains('on') && !$('#modeScan').classList.contains('on'));
  click($('#modeScan'));
  ok('切回截图模式', d.body.getAttribute('data-mode') === 'scan');

  // 网格校准 Tab
  click($('#tabManual'));
  ok('手动调整 Tab 生效', $('#paneManual').style.display !== 'none' && $('#paneAuto').style.display === 'none');
  click($('#tabAuto'));
  ok('自动识别 Tab 切回', $('#paneAuto').style.display !== 'none' && $('#paneManual').style.display === 'none');

  // 步进器
  const gw0 = parseInt($('#gw').value, 10);
  click($('[data-step-in="gw"][data-dir="1"]'));
  ok('网格宽步进 +1', parseInt($('#gw').value, 10) === gw0 + 1, $('#gw').value);
  click($('[data-step-in="gw"][data-dir="-1"]'));
  ok('网格宽步进 -1', parseInt($('#gw').value, 10) === gw0, $('#gw').value);
  const th0 = parseInt($('#thick').value, 10);
  click($('[data-step-in="thick"][data-dir="1"]'));
  ok('线宽步进 +1', parseInt($('#thick').value, 10) === th0 + 1, $('#thick').value);

  // 工具切换
  click($('#toolErase'));
  ok('擦除工具高亮', $('#toolErase').classList.contains('on') && !$('#toolSel').classList.contains('on'));
  ok('未载入图片时光标保持不变（守卫生效）', $('#cv').style.cursor === '', $('#cv').style.cursor);
  click($('#toolPan'));
  ok('移动工具高亮', $('#toolPan').classList.contains('on'));
  click($('#toolSel'));
  ok('回到选择工具', $('#toolSel').classList.contains('on'));

  // 开关
  const sb = $('#showBorder');
  sb.checked = false; change(sb);
  ok('显示边框开关可切换', sb.checked === false);
  const pg = $('#pillGrid');
  pg.checked = false; change(pg);
  ok('工具栏「显示网格」与左栏开关联动', $('#showGrid').checked === false);
  pg.checked = true; change(pg);
  ok('联动回开', $('#showGrid').checked === true);

  // 预览 Tab
  click($('#pvTabImage'));
  ok('预览切到原始图片', $('#pvTabImage').classList.contains('on'));
  click($('#pvTabPattern'));
  ok('预览切回拼豆图纸', $('#pvTabPattern').classList.contains('on'));

  // 图例弹层
  click($('#legendOpen'));
  ok('图例对账弹层打开', !$('#legendModal').classList.contains('hidden'));
  $('#legendIn').value = 'A20 109\nA13 77';
  click($('#applyLegend'));
  await wait(50);
  ok('未载入图片时套用图例给出提示', /载入图片/.test($('#toast').textContent), $('#toast').textContent);
  click($('#legendClose'));
  ok('图例弹层关闭', $('#legendModal').classList.contains('hidden'));

  // 色号弹层
  click($('#palClose'));
  ok('色号弹层默认关闭', $('#modal').classList.contains('hidden'));

  // 清空图片
  click($('#fileClear'));
  await wait(50);
  ok('移除图片后文件名复位', /未选择图片/.test($('#fileName').textContent), $('#fileName').textContent);
  ok('移除图片后色板为空态', /载入图片后显示/.test($('#clusterList').textContent));
  ok('移除图片后统计为空态', /暂无/.test($('#stats').textContent));

  // 检查器占位
  ok('图像信息未载入时显示 —', $('#infoSize').textContent === '—', $('#infoSize').textContent);
  ok('画布 chips 显示未载入', /未载入/.test($('#chipSize').textContent), $('#chipSize').textContent);

  // 主题切换
  ok('主题已初始化（html 上有 data-theme）', !!d.documentElement.getAttribute('data-theme'),
    d.documentElement.getAttribute('data-theme'));
  click($('#themeBtn'));
  ok('点主题按钮弹出菜单', !$('#themeMenu').classList.contains('hidden'));
  click($('[data-theme-set="dark"]'));
  ok('切到深色 → data-theme=dark', d.documentElement.getAttribute('data-theme') === 'dark',
    d.documentElement.getAttribute('data-theme'));
  ok('选完自动关闭菜单', $('#themeMenu').classList.contains('hidden'));
  ok('深色项被标记为选中', $('[data-theme-set="dark"]').classList.contains('on'));
  click($('#themeBtn'));
  click($('[data-theme-set="light"]'));
  ok('切回浅色 → data-theme=light', d.documentElement.getAttribute('data-theme') === 'light',
    d.documentElement.getAttribute('data-theme'));
  click($('#themeBtn'));
  click($('[data-theme-set="auto"]'));
  ok('跟随系统 → data-theme-mode=auto', d.documentElement.getAttribute('data-theme-mode') === 'auto',
    d.documentElement.getAttribute('data-theme-mode'));
  click($('#themeBtn'));
  click($('#themeBtn'));
  ok('再点按钮可收起菜单', $('#themeMenu').classList.contains('hidden'));

  // 常用规格
  ok('网格侧 6 个常用规格', d.querySelectorAll('[data-grid-preset]').length === 6,
    '实际 ' + d.querySelectorAll('[data-grid-preset]').length);
  click($('[data-grid-preset="26"]'));
  ok('点 26×26 → 宽高都变 26', $('#gw').value === '26' && $('#gh').value === '26',
    $('#gw').value + '×' + $('#gh').value);
  ok('26×26 按钮高亮', $('[data-grid-preset="26"]').classList.contains('on'));
  click($('[data-grid-preset="104"]'));
  ok('点 104×104 → 宽高都变 104', $('#gw').value === '104' && $('#gh').value === '104',
    $('#gw').value + '×' + $('#gh').value);
  ok('高亮跟着换到 104', $('[data-grid-preset="104"]').classList.contains('on') &&
    !$('[data-grid-preset="26"]').classList.contains('on'));
  click($('#modePhoto'));
  ok('照片侧也是 6 个常用规格', d.querySelectorAll('[data-photo-preset]').length === 6,
    '实际 ' + d.querySelectorAll('[data-photo-preset]').length);
  click($('[data-photo-preset="52"]'));
  ok('照片模式点 52×52 → 目标宽高都变 52', $('#pgw').value === '52' && $('#pgh').value === '52',
    $('#pgw').value + '×' + $('#pgh').value);
  click($('#modeScan'));

  // 照片适配方式
  ok('适配方式默认「完整补边」', $('#pFit').value === 'contain', $('#pFit').value);
  ok('适配方式有三个选项', $('#pFit').options.length === 3, String($('#pFit').options.length));
  $('#pFit').value = 'crop';
  ok('可切到裁剪居中', $('#pFit').value === 'crop');
  $('#pFit').value = 'contain';

  // 横向溢出
  await wait(100);
  const noOverflow = d.documentElement.scrollWidth <= d.documentElement.clientWidth + 1;
  ok('无横向溢出', noOverflow,
    'scrollWidth=' + d.documentElement.scrollWidth + ' clientWidth=' + d.documentElement.clientWidth);

  const bad = results.filter((r) => !r.cond).length;
  console.log('\n=== 运行时错误: ' + (errors.length ? errors.length + ' 条' : '无') + ' ===');
  if (errors.length) errors.slice(0, 8).forEach((e) => console.log('   ! ' + e));
  console.log(bad ? '\n✗ UI 冒烟测试失败：' + bad + ' 条' : '\n✔ UI 冒烟测试通过：' + results.length + ' 条断言全绿');
  process.exit(bad || errors.length ? 1 : 0);
})();
