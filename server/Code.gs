/**
 * Máy chủ nhỏ cho công cụ "Dựng 3D từ bản vẽ", chạy bằng Google Apps Script (miễn phí, không cần máy chủ riêng).
 *   - Ghi lượt truy cập vào trang tính "TruyCap", có bảng "ThongKe" tự tính.
 *   - Lưu bản vẽ người dùng mở vào một thư mục Google Drive nếu chưa có (nhận diện bằng mã SHA-256 của tệp).
 *   - Nhận báo lỗi, đánh dấu bản vẽ là "LỖI" trong trang tính "BanVe", lưu ảnh chụp màn hình kèm theo.
 *   - API quản trị (cần khoá ADMIN_KEY) để tải các bản vẽ đã báo lỗi về máy kiểm thử.
 *
 * Cài đặt: xem server/HUONG_DAN_MAY_CHU.md. Tóm tắt: dán tệp này vào script.google.com, chạy hàm setup() một lần,
 * rồi Deploy > New deployment > Web app, "Execute as: Me", "Who has access: Anyone".
 */

var VERSION = 1;
var MAX_FILE_BYTES = 30 * 1024 * 1024;   // Apps Script nhận tối đa khoảng 50 MB mỗi lần gửi; base64 làm tệp to thêm 1/3
var MAX_SHOT_BYTES = 1.5 * 1024 * 1024;
var EXTS = { dwg: 1, dxf: 1, pdf: 1, png: 1, jpg: 1, jpeg: 1, webp: 1, bmp: 1, gif: 1 };

var SHEETS = {
  TruyCap: ['Thời gian', 'Mã khách', 'Trang', 'Trình duyệt', 'Đến từ', 'Màn hình', 'Ngôn ngữ'],
  BanVe: ['SHA-256', 'Tên tệp', 'Loại', 'Dung lượng (byte)', 'Mở lần đầu', 'Mở gần nhất', 'Số lần mở', 'Mã khách đầu tiên',
    'Kết quả tự động', 'Tóm tắt kết quả', 'Trạng thái', 'Số lần báo lỗi', 'Drive ID', 'Liên kết tệp', 'Ghi chú'],
  BaoLoi: ['Thời gian', 'SHA-256', 'Tên tệp', 'Loại lỗi', 'Mô tả', 'Liên hệ', 'Mã khách', 'Tóm tắt kết quả', 'Ảnh chụp', 'Đã xử lý']
};
var COL = { hash: 1, name: 2, ext: 3, size: 4, first: 5, last: 6, opens: 7, vid: 8, auto: 9, summary: 10, status: 11, reports: 12, fileId: 13, link: 14 };

/* ------------------------------------------------------------------------------------------ */
/* Cài đặt một lần                                                                              */
/* ------------------------------------------------------------------------------------------ */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var ss = props.getProperty('SHEET_ID') ? SpreadsheetApp.openById(props.getProperty('SHEET_ID')) : SpreadsheetApp.create('Dựng 3D - thống kê và bản vẽ');
  props.setProperty('SHEET_ID', ss.getId());
  ss.setSpreadsheetTimeZone('Asia/Ho_Chi_Minh');
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  var st = ss.getSheetByName('ThongKe') || ss.insertSheet('ThongKe', 0);
  st.clear();
  // Công thức trong Apps Script luôn viết theo kiểu tiếng Anh (dấu phẩy), trang tính tự đổi theo vùng hiển thị
  var rows = [
    ['Chỉ số', 'Giá trị'],
    ['Tổng lượt truy cập', '=MAX(0,COUNTA(TruyCap!A:A)-1)'],
    ['Số khách khác nhau', '=COUNTUNIQUE(TruyCap!B2:B)'],
    ['Lượt truy cập hôm nay', '=COUNTIFS(TruyCap!A2:A,">="&TODAY())'],
    ['Lượt truy cập 7 ngày qua', '=COUNTIFS(TruyCap!A2:A,">="&(TODAY()-6))'],
    ['Lượt truy cập 30 ngày qua', '=COUNTIFS(TruyCap!A2:A,">="&(TODAY()-29))'],
    ['Số bản vẽ khác nhau', '=MAX(0,COUNTA(BanVe!A:A)-1)'],
    ['Tổng lượt mở bản vẽ', '=SUM(BanVe!G2:G)'],
    ['Bản vẽ đã lưu tệp', '=COUNTIF(BanVe!M2:M,"?*")'],
    ['Bản vẽ bị báo lỗi', '=COUNTIF(BanVe!K2:K,"LỖI")'],
    ['Bản vẽ đọc hỏng (tự động)', '=COUNTIF(BanVe!I2:I,"hỏng")'],
    ['Số lần báo lỗi', '=MAX(0,COUNTA(BaoLoi!A:A)-1)']
  ];
  st.getRange(1, 1, rows.length, 2).setValues(rows);
  st.getRange(1, 1, 1, 2).setFontWeight('bold');
  st.getRange(1, 4).setValue('Lượt truy cập theo ngày').setFontWeight('bold');
  st.getRange(2, 4).setFormula('=IFERROR(QUERY(TruyCap!A2:B,"select toDate(A), count(A) where A is not null group by toDate(A) order by toDate(A) desc label toDate(A) \'Ngày\', count(A) \'Lượt\'",0),"Chưa có")');
  st.setColumnWidth(1, 230);
  var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Trang tính1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  var folder = props.getProperty('FOLDER_ID') ? DriveApp.getFolderById(props.getProperty('FOLDER_ID')) : DriveApp.createFolder('Dựng 3D - bản vẽ người dùng');
  props.setProperty('FOLDER_ID', folder.getId());
  var shots = props.getProperty('SHOT_FOLDER_ID') ? DriveApp.getFolderById(props.getProperty('SHOT_FOLDER_ID')) : folder.createFolder('Ảnh báo lỗi');
  props.setProperty('SHOT_FOLDER_ID', shots.getId());
  if (!props.getProperty('ADMIN_KEY')) props.setProperty('ADMIN_KEY', Utilities.getUuid().replace(/-/g, ''));

  Logger.log('Trang tính: ' + ss.getUrl());
  Logger.log('Thư mục bản vẽ: ' + folder.getUrl());
  Logger.log('Khoá quản trị ADMIN_KEY (chép vào admin.json, không chia sẻ): ' + props.getProperty('ADMIN_KEY'));
}

/* ------------------------------------------------------------------------------------------ */
/* Tiện ích                                                                                     */
/* ------------------------------------------------------------------------------------------ */
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function prop(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function book() { return SpreadsheetApp.openById(prop('SHEET_ID')); }
function sheet(name) { return book().getSheetByName(name); }
function cut(s, n) { s = s === undefined || s === null ? '' : String(s); return s.length > n ? s.slice(0, n) + '…' : s; }
// Ô bắt đầu bằng = + - @ bị trang tính hiểu là công thức: thêm dấu ' để giữ nguyên chữ
function safe(s, n) { s = cut(s, n || 500); return /^[=+\-@]/.test(s) ? "'" + s : s; }
function isHash(h) { return /^[0-9a-f]{64}$/.test(String(h || '')); }
function hex(bytes) { return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
function findRow(sh, hash) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var hit = sh.getRange(2, COL.hash, last - 1, 1).createTextFinder(hash).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}
function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function isAdmin(key) { return key && prop('ADMIN_KEY') && String(key) === prop('ADMIN_KEY'); }

/* ------------------------------------------------------------------------------------------ */
/* Nhận yêu cầu từ trang (POST, thân là JSON gửi dạng text/plain để trình duyệt không hỏi CORS trước) */
/* ------------------------------------------------------------------------------------------ */
function doPost(e) {
  var req;
  try { req = JSON.parse(e && e.postData ? e.postData.contents : '{}'); } catch (err) { return json({ ok: false, error: 'Yêu cầu không hợp lệ' }); }
  try {
    switch (req.a) {
      case 'visit': return json(visit(req));
      case 'open': return json(withLock(function () { return opened(req); }));
      case 'file': return json(saveFile(req));
      case 'report': return json(report(req));
      default: return json({ ok: false, error: 'Không rõ yêu cầu' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function visit(r) {
  sheet('TruyCap').appendRow([new Date(), safe(r.vid, 40), safe(r.page, 200), safe(r.ua, 200), safe(r.ref, 200), safe(r.scr, 20), safe(r.lang, 20)]);
  return { ok: true };
}

// Người dùng mở một bản vẽ: thêm dòng nếu chưa có, tăng số lần mở nếu đã có. need = máy chủ cần tệp.
function opened(r) {
  if (!isHash(r.hash)) return { ok: false, error: 'Mã tệp không hợp lệ' };
  var ext = String(r.ext || '').toLowerCase();
  if (!EXTS[ext]) return { ok: false, error: 'Loại tệp không nhận' };
  var sh = sheet('BanVe'), row = findRow(sh, r.hash), now = new Date();
  var auto = r.result === 'err' ? 'hỏng' : 'dựng được';
  if (!row) {
    sh.appendRow([r.hash, safe(r.name, 200), ext, Number(r.size) || 0, now, now, 1, safe(r.vid, 40), auto, safe(r.summary, 4000), '', 0, '', '', '']);
    row = sh.getLastRow();
  } else {
    sh.getRange(row, COL.last).setValue(now);
    sh.getRange(row, COL.opens).setValue((Number(sh.getRange(row, COL.opens).getValue()) || 0) + 1);
    sh.getRange(row, COL.auto, 1, 2).setValues([[auto, safe(r.summary, 4000)]]); // kết quả của phiên bản công cụ mới nhất
  }
  var hasFile = !!sh.getRange(row, COL.fileId).getValue();
  return { ok: true, need: !hasFile && (Number(r.size) || 0) <= MAX_FILE_BYTES };
}

// Nhận nội dung tệp (base64). Kiểm tra mã SHA-256 khớp rồi mới lưu.
function saveFile(r) {
  if (!isHash(r.hash) || !r.data) return { ok: false, error: 'Thiếu dữ liệu' };
  var bytes = Utilities.base64Decode(r.data);
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, error: 'Tệp quá lớn' };
  if (hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)) !== r.hash) return { ok: false, error: 'Mã tệp không khớp nội dung' };
  return withLock(function () {
    var sh = sheet('BanVe'), row = findRow(sh, r.hash);
    if (!row) return { ok: false, error: 'Chưa có bản ghi của tệp' };
    if (sh.getRange(row, COL.fileId).getValue()) return { ok: true, already: true };
    var name = r.hash.slice(0, 12) + '_' + String(sh.getRange(row, COL.name).getValue()).replace(/[\\\/:*?"<>|]/g, '_');
    var file = DriveApp.getFolderById(prop('FOLDER_ID')).createFile(Utilities.newBlob(bytes, 'application/octet-stream', name));
    sh.getRange(row, COL.fileId, 1, 2).setValues([[file.getId(), file.getUrl()]]);
    return { ok: true };
  });
}

// Báo lỗi: ghi vào BaoLoi, đánh dấu bản vẽ "LỖI", lưu ảnh chụp nếu có.
function report(r) {
  if (!isHash(r.hash)) return { ok: false, error: 'Mã tệp không hợp lệ' };
  var shotUrl = '';
  if (r.shot) {
    try {
      var b = Utilities.base64Decode(String(r.shot).replace(/^data:image\/\w+;base64,/, ''));
      if (b.length <= MAX_SHOT_BYTES) {
        var f = DriveApp.getFolderById(prop('SHOT_FOLDER_ID')).createFile(Utilities.newBlob(b, 'image/jpeg', r.hash.slice(0, 12) + '_' + Date.now() + '.jpg'));
        shotUrl = f.getUrl();
      }
    } catch (err) { /* ảnh hỏng thì bỏ qua */ }
  }
  return withLock(function () {
    var sh = sheet('BanVe'), row = findRow(sh, r.hash), now = new Date();
    if (!row) {
      var ext = String(r.ext || '').toLowerCase();
      sh.appendRow([r.hash, safe(r.name, 200), EXTS[ext] ? ext : '', Number(r.size) || 0, now, now, 1, safe(r.vid, 40), '', safe(r.summary, 4000), '', 0, '', '', '']);
      row = sh.getLastRow();
    }
    sh.getRange(row, COL.status).setValue('LỖI');
    sh.getRange(row, COL.reports).setValue((Number(sh.getRange(row, COL.reports).getValue()) || 0) + 1);
    sheet('BaoLoi').appendRow([now, r.hash, safe(r.name, 200), safe((r.kinds || []).join(', '), 300), safe(r.text, 3000), safe(r.contact, 200),
      safe(r.vid, 40), safe(r.summary, 4000), shotUrl, '']);
    var hasFile = !!sh.getRange(row, COL.fileId).getValue();
    return { ok: true, need: !hasFile && (Number(r.size) || 0) <= MAX_FILE_BYTES };
  });
}

/* ------------------------------------------------------------------------------------------ */
/* API quản trị (GET, cần ?key=ADMIN_KEY)                                                       */
/*   ?a=list&key=...&status=LOI|all   danh sách bản vẽ (mặc định chỉ bản vẽ bị báo lỗi)            */
/*   ?a=download&key=...&hash=...     nội dung tệp (base64)                                       */
/*   ?a=mark&key=...&hash=...&status=OK|LOI  đổi trạng thái sau khi đã sửa                        */
/*   ?a=stats                          số liệu tổng (không cần khoá)                               */
/* ------------------------------------------------------------------------------------------ */
function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.a === 'ping') return json({ ok: true, version: VERSION });
    if (p.a === 'stats') return json(stats());
    if (!isAdmin(p.key)) return json({ ok: false, error: 'Sai khoá quản trị' });
    if (p.a === 'list') return json(list(String(p.status || 'LOI').toUpperCase()));
    if (p.a === 'download') return json(download(p.hash));
    if (p.a === 'mark') return json(mark(p.hash, p.status));
    return json({ ok: false, error: 'Không rõ yêu cầu' });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function stats() {
  var v = sheet('ThongKe').getRange(2, 1, 11, 2).getValues(), o = {};
  v.forEach(function (r) { if (r[0]) o[r[0]] = r[1]; });
  return { ok: true, stats: o };
}

function list(status) {
  var sh = sheet('BanVe'), last = sh.getLastRow();
  if (last < 2) return { ok: true, items: [] };
  var head = SHEETS.BanVe.length, rows = sh.getRange(2, 1, last - 1, head).getValues();
  var rep = sheet('BaoLoi'), rl = rep.getLastRow(), reps = rl >= 2 ? rep.getRange(2, 1, rl - 1, SHEETS.BaoLoi.length).getValues() : [];
  var items = rows.filter(function (r) { return status === 'ALL' || (status === 'LOI' ? r[COL.status - 1] === 'LỖI' : String(r[COL.status - 1]).toUpperCase() === status); })
    .map(function (r) {
      return {
        hash: r[0], name: r[1], ext: r[2], size: r[3], opens: r[6], auto: r[8], summary: r[9], status: r[10], reports: r[11], hasFile: !!r[12],
        reportList: reps.filter(function (q) { return q[1] === r[0]; }).map(function (q) { return { time: q[0], kinds: q[3], text: q[4], summary: q[7], shot: q[8], done: q[9] }; })
      };
    });
  return { ok: true, items: items };
}

function download(hash) {
  if (!isHash(hash)) return { ok: false, error: 'Mã tệp không hợp lệ' };
  var sh = sheet('BanVe'), row = findRow(sh, hash);
  if (!row) return { ok: false, error: 'Không có bản vẽ này' };
  var id = sh.getRange(row, COL.fileId).getValue();
  if (!id) return { ok: false, error: 'Bản vẽ chưa được tải lên (có thể quá lớn)' };
  var f = DriveApp.getFileById(id);
  return { ok: true, name: sh.getRange(row, COL.name).getValue(), data: Utilities.base64Encode(f.getBlob().getBytes()) };
}

function mark(hash, status) {
  if (!isHash(hash)) return { ok: false, error: 'Mã tệp không hợp lệ' };
  var sh = sheet('BanVe'), row = findRow(sh, hash);
  if (!row) return { ok: false, error: 'Không có bản vẽ này' };
  sh.getRange(row, COL.status).setValue(String(status || '').toUpperCase() === 'LOI' ? 'LỖI' : 'ĐÃ SỬA');
  return { ok: true };
}
