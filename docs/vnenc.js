/* vnenc.js - Đổi chữ tiếng Việt kiểu cũ trong bản vẽ CAD sang Unicode.
 * Nhiều bản vẽ Việt Nam vẫn dùng font .VnTime/.VnArial (bảng mã TCVN3, còn gọi là ABC) hoặc VNI-Times (bảng mã VNI).
 * Chữ lưu trong tệp khi đó là các ký tự Latin-1 lạ, ví dụ "MÆT B»NG TÇNG 1" (TCVN3) hay "THUYEÁT MINH" (VNI).
 * Tên font trong tệp thường không đọc được, và một tệp có thể trộn cả ba kiểu, nên ở đây đoán theo nội dung từng dòng:
 *   - dòng có chữ Unicode tiếng Việt thật (ặ, ư, đ...) thì giữ nguyên;
 *   - dòng có cặp "nguyên âm + dấu VNI" (aù, eá, oà, uø...) hoặc ñ/Ñ thì giải mã VNI;
 *   - dòng có ký tự Latin-1 không bao giờ xuất hiện trong tiếng Việt Unicode (Æ, », ¸, ­, ®...) thì giải mã TCVN3.
 * Fix(s) trả về chuỗi Unicode (NFC). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VnEnc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // TCVN3: mã Latin-1 -> chữ Unicode. Font chữ hoa (.VnTimeH) dùng chung mã với chữ thường.
  var TCVN3 = {
    'µ': 'à', '¶': 'ả', '·': 'ã', '¸': 'á', '¹': 'ạ',
    '¨': 'ă', '»': 'ằ', '¼': 'ẳ', '½': 'ẵ', '¾': 'ắ', 'Æ': 'ặ',
    '©': 'â', 'Ç': 'ầ', 'È': 'ẩ', 'É': 'ẫ', 'Ê': 'ấ', 'Ë': 'ậ',
    '®': 'đ',
    'Ì': 'è', 'Î': 'ẻ', 'Ï': 'ẽ', 'Ð': 'é', 'Ñ': 'ẹ',
    'ª': 'ê', 'Ò': 'ề', 'Ó': 'ể', 'Ô': 'ễ', 'Õ': 'ế', 'Ö': 'ệ',
    '×': 'ì', 'Ø': 'ỉ', 'Ü': 'ĩ', 'Ý': 'í', 'Þ': 'ị',
    'ß': 'ò', 'á': 'ỏ', 'â': 'õ', 'ã': 'ó', 'ä': 'ọ',
    '«': 'ô', 'å': 'ồ', 'æ': 'ổ', 'ç': 'ỗ', 'è': 'ố', 'é': 'ộ',
    '¬': 'ơ', 'ê': 'ờ', 'ë': 'ở', 'ì': 'ỡ', 'í': 'ớ', 'î': 'ợ',
    'ï': 'ù', 'ñ': 'ủ', 'ò': 'ũ', 'ó': 'ú', 'ô': 'ụ',
    '­': 'ư', 'õ': 'ừ', 'ö': 'ử', '÷': 'ữ', 'ø': 'ứ', 'ù': 'ự',
    'ú': 'ỳ', 'û': 'ỷ', 'ü': 'ỹ', 'ý': 'ý', 'þ': 'ỵ',
    '¡': 'Ă', '¢': 'Â', '§': 'Đ', '£': 'Ê', '¤': 'Ô', '¥': 'Ơ', '¦': 'Ư'
  };

  // VNI: nguyên âm + ký tự dấu. [dấu mũ/trăng: 0 không, 'c' mũ, 'b' trăng; thanh: 0..5 = ngang, huyền, sắc, hỏi, ngã, nặng]
  var VNI_MARK = {
    'ø': [0, 1], 'ù': [0, 2], 'û': [0, 3], 'õ': [0, 4], 'ï': [0, 5],
    'â': ['c', 0], 'à': ['c', 1], 'á': ['c', 2], 'å': ['c', 3], 'ã': ['c', 4], 'ä': ['c', 5],
    'ê': ['b', 0], 'è': ['b', 1], 'é': ['b', 2], 'ú': ['b', 3], 'ü': ['b', 4], 'ë': ['b', 5]
  };
  var VNI_SINGLE = {
    'ô': 'ơ', 'ö': 'ư', 'ñ': 'đ', 'ì': 'ì', 'í': 'í', 'æ': 'ỉ', 'ó': 'ĩ', 'ò': 'ị', 'î': 'ỵ',
    'Ô': 'Ơ', 'Ö': 'Ư', 'Ñ': 'Đ', 'Ì': 'Ì', 'Í': 'Í', 'Æ': 'Ỉ', 'Ó': 'Ĩ', 'Ò': 'Ị', 'Î': 'Ỵ'
  };
  var TONE = ['', '̀', '́', '̉', '̃', '̣'];
  // nguyên âm nào được mang dấu nào trong VNI
  function vniAllowed(base, mod) {
    var b = base.toLowerCase();
    if (mod === 'b') return b === 'a';
    if (mod === 'c') return b === 'a' || b === 'e' || b === 'o';
    return 'aeouyơư'.indexOf(b) >= 0;
  }
  function vniMark(ch) { return VNI_MARK[ch] || VNI_MARK[ch.toLowerCase()]; }

  function decodeVNI(s) {
    var out = '', i = 0;
    while (i < s.length) {
      var c = s[i], base = c;
      if (VNI_SINGLE[c] && (c === 'ô' || c === 'ö' || c === 'Ô' || c === 'Ö')) base = VNI_SINGLE[c];
      var m = i + 1 < s.length ? vniMark(s[i + 1]) : null;
      if (m && /[aeouyAEOUYơưƠƯ]/.test(base) && vniAllowed(base, m[0])) {
        var comb = m[0] === 'c' ? '̂' : m[0] === 'b' ? '̆' : '';
        out += (base + comb + TONE[m[1]]).normalize('NFC');
        i += 2; continue;
      }
      out += VNI_SINGLE[c] || c;
      i++;
    }
    return out;
  }

  function decodeTCVN3(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) out += TCVN3[s[i]] || s[i];
    // Font chữ hoa: nếu các chữ cái thường (a-z) đều viết hoa thì đưa cả dòng về chữ hoa
    var up = s.replace(/[^A-Za-z]/g, '');
    if (up.length >= 2 && up === up.toUpperCase()) return out.toUpperCase();
    // Dòng trộn: tiếng nào viết hoa phần chữ Latin (MÆT -> "MặT") thì đưa cả tiếng về chữ hoa (MẶT)
    return out.replace(/[^\s\-:,.()\/]+/g, function (w) { return /[A-Z]/.test(w) && !/[a-z]/.test(w) ? w.toUpperCase() : w; });
  }

  // Chữ cái Unicode tiếng Việt nằm ngoài Latin-1: dòng có chúng là Unicode thật
  var REAL_VN = /[ĂăĐđĨĩŨũƠơƯưẠ-ỹ]/;
  // Latin-1 có trong tiếng Việt Unicode (dạng dựng sẵn)
  var VN_LATIN1 = 'ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúý';
  // Ký hiệu Latin-1 hay gặp trên bản vẽ, không coi là dấu hiệu TCVN3: ° ± ² ³ ´ × ÷ º ¼ ½ ¾ (½ ¾ chỉ khi đứng cạnh số)
  var NEUTRAL = ' °±²³´º×÷';
  // Cặp chỉ có trong VNI, không có trong tiếng Việt Unicode
  var VNI_PAIR = /[aAyY][øùûõïâàáåãäêèéúüëØÙÛÕÏÂÀÁÅÃÄÊÈÉÚÜË]|[eE][øùûõïâàáåãäØÙÛÕÏÂÀÁÅÃÄ]|[oO][øûïâåäØÛÏÂÅÄ]|[uU][øùûõïØÙÛÕÏ]|[ôöÔÖ][øùûõïØÙÛÕÏ]/g;

  function tcvnSignal(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s[i], k = c.charCodeAt(0);
      if (k < 0xA1 || k > 0xFF || NEUTRAL.indexOf(c) >= 0 || VN_LATIN1.indexOf(c) >= 0) continue;
      if ((c === '¼' || c === '½' || c === '¾') && /\d/.test((s[i - 1] || '') + (s[i + 1] || ''))) continue;
      if (TCVN3[c]) n++;
    }
    return n;
  }

  // Độ "sai" của một cách giải mã: tiếng có hơn một dấu thanh, và ký tự Latin-1 lạ còn sót lại
  var TONE_RE = /[\u0300\u0301\u0303\u0309\u0323]/g;
  function penalty(t) {
    var p = 0;
    t.split(/[^A-Za-z\u00C0-\u024F\u1E00-\u1EFF]+/).forEach(function (w) {
      if (!w) return;
      var n = (w.normalize('NFD').match(TONE_RE) || []).length;
      if (n > 1) p += n - 1;
    });
    for (var i = 0; i < t.length; i++) {
      var k = t.charCodeAt(i);
      if (k >= 0xA1 && k <= 0xFF && NEUTRAL.indexOf(t[i]) < 0 && VN_LATIN1.indexOf(t[i]) < 0) p++;
    }
    return p;
  }

  function fix(s) {
    s = String(s == null ? '' : s);
    if (!/[\u00A1-\u00FF]/.test(s) || REAL_VN.test(s)) return s;
    var vni = (s.match(VNI_PAIR) || []).length + (s.match(/[ñÑ]/g) || []).length;
    var tc = tcvnSignal(s);
    if (!vni && !tc) return s;
    var best = s, bp = penalty(s) + 0.5; // giữ nguyên nếu giải mã không làm tốt hơn
    if (tc) { var a = decodeTCVN3(s), pa = penalty(a) + (vni > tc ? 0.25 : 0); if (pa < bp) { best = a; bp = pa; } }
    if (vni) { var b = decodeVNI(s), pb = penalty(b) + (tc >= vni ? 0.25 : 0); if (pb < bp) { best = b; bp = pb; } }
    return best;
  }

  return { fix: fix, decodeTCVN3: decodeTCVN3, decodeVNI: decodeVNI };
});
