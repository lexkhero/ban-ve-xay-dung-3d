// Đóng gói thư viện đọc DWG @mlightcad/libredwg-web (LibreDWG, GPL-3.0) thành script thường,
// để công cụ mở bằng file:// vẫn đọc được DWG (Chrome chặn ES module và fetch trên file://).
//   lib/libredwg.bundle.js : mã nạp WebAssembly + lớp LibreDwg, gắn vào window["libredwg-web"]
//   lib/libredwg.wasm.js   : tệp .wasm nén gzip, nhúng base64 vào window.LIBREDWG_WASM_GZ_B64
// Chạy: node tools/bundle_libredwg.js [thư_mục_package] [thư_mục_lib]
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const pkg = path.resolve(process.argv[2] || path.join(__dirname, '..', 'vendor', 'package'));
const out = path.resolve(process.argv[3] || path.join(__dirname, '..', 'lib'));
const ver = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
let glue = fs.readFileSync(path.join(pkg, 'wasm', 'libredwg-web.js'), 'utf8');
const n0 = (glue.match(/import\.meta\.url/g) || []).length;
glue = glue.replace(/import\.meta\.url/g, '(typeof document !== "undefined" && document.baseURI || "file:///")');
glue = glue.replace(/export\s+default\s+createModule\s*;?\s*$/m, 'self.createModule = createModule;');
if (/^\s*export\b/m.test(glue)) throw new Error('Còn câu lệnh export trong mã nạp WebAssembly');
const umd = fs.readFileSync(path.join(pkg, 'dist', 'libredwg-web.umd.cjs'), 'utf8');
const banner = `/* libredwg.bundle.js - @mlightcad/libredwg-web ${ver} (LibreDWG, GPL-3.0, https://github.com/mlightcad/libredwg-web)\n * đóng gói lại thành script thường bằng tools/bundle_libredwg.js. Không chỉnh sửa tay. */\n`;
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'libredwg.bundle.js'), banner + glue + '\n;\n' + umd + '\n');
const wasm = fs.readFileSync(path.join(pkg, 'wasm', 'libredwg-web.wasm'));
const gz = zlib.gzipSync(wasm, { level: 9 });
fs.writeFileSync(path.join(out, 'libredwg.wasm.js'), `/* libredwg-web ${ver}: tệp WebAssembly nén gzip, mã hoá base64 (${wasm.length} byte gốc). */\nself.LIBREDWG_WASM_GZ_B64 = "${gz.toString('base64')}";\n`);
console.log('Đã ghi lib/libredwg.bundle.js và lib/libredwg.wasm.js (wasm', (wasm.length / 1048576).toFixed(1), 'MB -> gzip', (gz.length / 1048576).toFixed(1), 'MB), import.meta thay', n0, 'chỗ');
