// Đóng gói Three.js (bản ES module) thành một script thường gắn vào window.THREE,
// để công cụ chạy được khi mở index.html trực tiếp (file://), không cần web server.
// Chạy: node tools/bundle_three.js [thư_mục_three.js-master] [tệp_ra]
const fs = require('fs'), path = require('path');
const src = path.resolve(process.argv[2] || path.join(__dirname, '..', 'three.js-master'));
const out = path.resolve(process.argv[3] || path.join(__dirname, '..', 'lib', 'three.bundle.js'));
const rd = f => fs.readFileSync(path.join(src, f), 'utf8');

function names(list) { // "A, B as C" -> [[local, exported]]
  return list.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const m = s.split(/\s+as\s+/); return [m[0], m[1] || m[0]];
  });
}
function convert(code, file, resolveFrom) {
  let exportsCode = [];
  code = code.replace(/^import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/gm, (all, list, from) =>
    'const {' + names(list).map(([a, b]) => a === b ? a : a + ': ' + b).join(', ') + '} = ' + resolveFrom(from) + ';');
  code = code.replace(/^export\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/gm, (all, list, from) => {
    exportsCode.push(names(list).map(([a, b]) => `__e.${b} = ${resolveFrom(from)}.${a};`).join('\n'));
    return '';
  });
  code = code.replace(/^export\s*\{([\s\S]*?)\};?/gm, (all, list) => {
    exportsCode.push(names(list).map(([a, b]) => `__e.${b} = ${a};`).join('\n'));
    return '';
  });
  if (/^\s*(import|export)\b/m.test(code)) throw new Error('Còn câu lệnh import/export chưa chuyển trong ' + file);
  return `(function(__e){\n${code}\n${exportsCode.join('\n')}\nreturn __e;})({})`;
}
const core = convert(rd('build/three.core.js'), 'three.core.js', f => { throw new Error('core import ' + f); });
const mod = convert(rd('build/three.module.js'), 'three.module.js', f => { if (f === './three.core.js') return '__core'; throw new Error(f); });
const orbit = convert(rd('examples/jsm/controls/OrbitControls.js'), 'OrbitControls.js', f => { if (f === 'three') return '__THREE'; throw new Error(f); });
const ver = JSON.parse(rd('package.json')).version;
const banner = `/* three.bundle.js - Three.js ${ver} (MIT License, https://threejs.org) kèm OrbitControls,\n * đóng gói lại thành script thường bằng tools/bundle_three.js. Không chỉnh sửa tay. */\n`;
const body = `(function(){\n'use strict';\nconst __core = ${core};\nconst __THREE = Object.assign({}, __core, ${mod});\nconst __orbit = ${orbit};\n__THREE.OrbitControls = __orbit.OrbitControls;\nwindow.THREE = __THREE;\n})();\n`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, banner + body);
console.log('Đã ghi', out, (fs.statSync(out).size / 1024 / 1024).toFixed(2), 'MB, Three.js', ver);
