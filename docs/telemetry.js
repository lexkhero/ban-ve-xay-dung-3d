/* telemetry.js - Gửi lượt truy cập, lưu bản vẽ người dùng mở và báo lỗi lên máy chủ Google Apps Script (server/Code.gs).
 * Mỗi bản vẽ nhận diện bằng mã SHA-256 tính ngay trong trình duyệt; máy chủ chỉ xin nội dung tệp khi chưa có.
 * Yêu cầu gửi dạng text/plain để trình duyệt không phải hỏi CORS trước (Apps Script không trả lời yêu cầu OPTIONS). */
var Tele = (function () {
  'use strict';
  var cfg = window.APP_CONFIG || {}, api = String(cfg.apiUrl || '').trim();
  var on = /^https?:\/\//.test(api);
  var MAX_UPLOAD = 30 * 1024 * 1024;
  var cur = null; // { file, ext, hash: Promise<string>, uploaded: Promise|null }

  function visitorId() {
    var k = 'dung3d.vid', v = null;
    try { v = localStorage.getItem(k); } catch (e) { /* trình duyệt chặn lưu trữ */ }
    if (!v) {
      v = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
      try { localStorage.setItem(k, v); } catch (e) { /* bỏ qua */ }
    }
    return v;
  }
  var vid = on ? visitorId() : '';

  function post(o) {
    return fetch(api, { method: 'POST', body: JSON.stringify(o), redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j || !j.ok) throw new Error((j && j.error) || 'Máy chủ không nhận'); return j; });
  }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function sha256(file) { return file.arrayBuffer().then(function (b) { return crypto.subtle.digest('SHA-256', b); }).then(hex); }
  function base64(file) {
    return new Promise(function (ok, fail) {
      var r = new FileReader();
      r.onload = function () { ok(String(r.result).replace(/^data:[^,]*,/, '')); };
      r.onerror = function () { fail(r.error); };
      r.readAsDataURL(file);
    });
  }
  function upload() {
    if (!cur) return Promise.resolve();
    if (!cur.uploaded) {
      var c = cur;
      c.uploaded = Promise.all([c.hash, base64(c.file)]).then(function (a) { return post({ a: 'file', hash: a[0], data: a[1] }); })
        .catch(function (e) { c.uploaded = null; throw e; });
    }
    return cur.uploaded;
  }
  function status(t) { if (Tele.onStatus) Tele.onStatus(t); }

  return {
    enabled: function () { return on; },
    onStatus: null,
    visit: function () {
      if (!on) return;
      post({ a: 'visit', vid: vid, page: location.pathname, ua: navigator.userAgent, ref: document.referrer,
        scr: screen.width + 'x' + screen.height, lang: navigator.language }).catch(function () { /* không ảnh hưởng người dùng */ });
    },
    // Gọi sau khi đã dựng xong (hoặc đọc hỏng). summary: đối tượng mô tả kết quả, result: 'ok' | 'err'
    fileOpened: function (file, ext, summary, result) {
      if (!on || !file) return Promise.resolve();
      cur = { file: file, ext: ext, hash: sha256(file), uploaded: null };
      var c = cur;
      return c.hash.then(function (h) {
        return post({ a: 'open', vid: vid, hash: h, name: file.name, ext: ext, size: file.size, result: result, summary: JSON.stringify(summary) });
      }).then(function (r) {
        if (!r.need || c !== cur) return;
        if (file.size > MAX_UPLOAD) return;
        status('Đang lưu bản vẽ...');
        return upload().then(function () { status('Đã lưu bản vẽ.'); });
      }).catch(function (e) { status(''); console.warn('Không gửi được thông tin bản vẽ:', e && e.message || e); });
    },
    // Báo lỗi bản vẽ đang mở. Trả về Promise; lỗi mạng thì ném lỗi để giao diện báo lại.
    report: function (o) {
      if (!on) return Promise.reject(new Error('Chưa cấu hình máy chủ'));
      if (!cur) return Promise.reject(new Error('Chưa mở bản vẽ nào'));
      var c = cur;
      return c.hash.then(function (h) {
        return post({ a: 'report', vid: vid, hash: h, name: c.file.name, ext: c.ext, size: c.file.size,
          kinds: o.kinds, text: o.text, contact: o.contact, summary: JSON.stringify(o.summary), shot: o.shot || '' });
      }).then(function (r) {
        if (r.need && c.file.size <= MAX_UPLOAD) return upload();
      });
    },
    current: function () { return cur ? { name: cur.file.name, size: cur.file.size } : null; },
    tooBig: function (file) { return file && file.size > MAX_UPLOAD; }
  };
})();
