/* pdfvec.js - Bộ đọc nét vector trong PDF, viết thuần JavaScript, không cần PDF.js.
 * Chỉ lấy đường nét và vùng tô (không đọc chữ, không giải mã ảnh).
 * Chạy được trong trình duyệt (kể cả mở bằng file://) và trong Node 18+.
 *
 *   const doc = await PdfVec.open(uint8array);
 *   doc.numPages
 *   const page = await doc.extract(13);   // { ents, width, height, groups }
 *
 * Mỗi phần tử ents: { layer, kind: 'S'|'F', color: '#rrggbb', w (pt), pts: [[x,y],...], closed, grp: null }
 * Toạ độ tính bằng điểm PDF (1 pt = 1/72 inch), gốc ở góc dưới trái trang. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PdfVec = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Kiểu dữ liệu PDF                                                    */
  /* ------------------------------------------------------------------ */
  function Name(n) { this.name = n; }
  function Ref(num, gen) { this.num = num; this.gen = gen; }
  function Cmd(c) { this.cmd = c; }
  var EOF = { eof: true };

  function isWS(c) { return c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0; }
  function isDelim(c) { return c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37; }

  /* ------------------------------------------------------------------ */
  /* Bộ tách từ                                                          */
  /* ------------------------------------------------------------------ */
  function Lexer(buf, pos, end) {
    this.b = buf; this.p = pos || 0; this.end = end === undefined ? buf.length : end;
  }
  Lexer.prototype.skipWS = function () {
    var b = this.b, e = this.end;
    for (;;) {
      while (this.p < e && isWS(b[this.p])) this.p++;
      if (this.p < e && b[this.p] === 37) { // %
        while (this.p < e && b[this.p] !== 10 && b[this.p] !== 13) this.p++;
      } else return;
    }
  };
  Lexer.prototype.next = function () {
    this.skipWS();
    var b = this.b, e = this.end;
    if (this.p >= e) return EOF;
    var c = b[this.p];
    if (c === 47) { // /Name
      var s = ++this.p;
      while (this.p < e && !isWS(b[this.p]) && !isDelim(b[this.p])) this.p++;
      var raw = latin1(b, s, this.p);
      if (raw.indexOf('#') >= 0) raw = raw.replace(/#([0-9a-fA-F]{2})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); });
      return new Name(raw);
    }
    if (c === 40) return this.litString();
    if (c === 60) {
      if (b[this.p + 1] === 60) { this.p += 2; return new Cmd('<<'); }
      return this.hexString();
    }
    if (c === 62 && b[this.p + 1] === 62) { this.p += 2; return new Cmd('>>'); }
    if (c === 91 || c === 93 || c === 123 || c === 125) { this.p++; return new Cmd(String.fromCharCode(c)); }
    if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) {
      var st = this.p; this.p++;
      while (this.p < e) {
        var d = b[this.p];
        if ((d >= 48 && d <= 57) || d === 46 || d === 45) this.p++; else break;
      }
      var v = parseFloat(latin1(b, st, this.p));
      return isNaN(v) ? 0 : v;
    }
    var s2 = this.p;
    while (this.p < e && !isWS(b[this.p]) && !isDelim(b[this.p])) this.p++;
    if (this.p === s2) { this.p++; return new Cmd(String.fromCharCode(c)); }
    var w = latin1(b, s2, this.p);
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'null') return null;
    return new Cmd(w);
  };
  Lexer.prototype.litString = function () {
    var b = this.b, e = this.end, depth = 1, out = [];
    this.p++;
    while (this.p < e && depth > 0) {
      var c = b[this.p++];
      if (c === 92) { // backslash
        var d = b[this.p++];
        if (d === 110) out.push(10); else if (d === 114) out.push(13); else if (d === 116) out.push(9);
        else if (d === 98) out.push(8); else if (d === 102) out.push(12);
        else if (d >= 48 && d <= 55) {
          var o = d - 48, k = 0;
          while (k < 2 && b[this.p] >= 48 && b[this.p] <= 55) { o = o * 8 + b[this.p++] - 48; k++; }
          out.push(o & 255);
        } else if (d === 13) { if (b[this.p] === 10) this.p++; }
        else if (d !== 10) out.push(d);
      } else if (c === 40) { depth++; out.push(c); }
      else if (c === 41) { depth--; if (depth) out.push(c); }
      else out.push(c);
    }
    return String.fromCharCode.apply(null, out.slice(0, 60000));
  };
  Lexer.prototype.hexString = function () {
    var b = this.b, e = this.end, out = [], hi = -1;
    this.p++;
    while (this.p < e && b[this.p] !== 62) {
      var c = b[this.p++], v = -1;
      if (c >= 48 && c <= 57) v = c - 48; else if (c >= 65 && c <= 70) v = c - 55; else if (c >= 97 && c <= 102) v = c - 87;
      if (v < 0) continue;
      if (hi < 0) hi = v; else { out.push(hi * 16 + v); hi = -1; }
    }
    if (hi >= 0) out.push(hi * 16);
    this.p++;
    return String.fromCharCode.apply(null, out.slice(0, 60000));
  };

  function latin1(b, s, e) {
    var r = '';
    for (var i = s; i < e; i += 8192) r += String.fromCharCode.apply(null, b.subarray(i, Math.min(e, i + 8192)));
    return r;
  }

  /* Đọc một đối tượng (có xử lý "n g R") */
  function Parser(lexer) { this.lx = lexer; this.buf = []; }
  Parser.prototype.tok = function () { return this.buf.length ? this.buf.shift() : this.lx.next(); };
  Parser.prototype.peek = function (i) { while (this.buf.length <= i) this.buf.push(this.lx.next()); return this.buf[i]; };
  Parser.prototype.obj = function () {
    var t = this.tok();
    if (t instanceof Cmd) {
      if (t.cmd === '[') {
        var arr = [];
        for (;;) {
          var p = this.peek(0);
          if (p === EOF) break;
          if (p instanceof Cmd && p.cmd === ']') { this.tok(); break; }
          arr.push(this.obj());
        }
        return arr;
      }
      if (t.cmd === '<<') {
        var d = {};
        for (;;) {
          var k = this.tok();
          if (k === EOF || (k instanceof Cmd && k.cmd === '>>')) break;
          if (!(k instanceof Name)) continue;
          var nx = this.peek(0);
          if (nx instanceof Cmd && nx.cmd === '>>') { d[k.name] = null; continue; }
          d[k.name] = this.obj();
        }
        return d;
      }
      return t;
    }
    if (typeof t === 'number' && Number.isInteger(t) && t >= 0) {
      var a = this.peek(0), r = this.peek(1);
      if (typeof a === 'number' && Number.isInteger(a) && r instanceof Cmd && r.cmd === 'R') {
        this.tok(); this.tok();
        return new Ref(t, a);
      }
    }
    return t;
  };

  /* ------------------------------------------------------------------ */
  /* Giải nén                                                            */
  /* ------------------------------------------------------------------ */
  async function inflate(data) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Trình duyệt không hỗ trợ giải nén (DecompressionStream). Hãy dùng Chrome hoặc Edge bản mới.');
    async function run(fmt, input) {
      var ds = new DecompressionStream(fmt), w = ds.writable.getWriter(), rd = ds.readable.getReader();
      var chunks = [], total = 0, err = null;
      w.write(input).catch(function () {});
      w.close().catch(function () {});
      try {
        for (;;) {
          var r = await rd.read();
          if (r.done) break;
          chunks.push(r.value); total += r.value.length;
        }
      } catch (e) { err = e; }
      var out = new Uint8Array(total), o = 0;
      chunks.forEach(function (c) { out.set(c, o); o += c.length; });
      return { out: out, err: err };
    }
    var r = await run('deflate', data);
    if (r.err && !r.out.length && data.length > 2) r = await run('deflate-raw', data.subarray(2));
    if (r.err && !r.out.length) throw new Error('Không giải nén được luồng dữ liệu: ' + r.err.message);
    return r.out;
  }

  function unpredict(data, parms) {
    if (!parms) return data;
    var pred = parms.Predictor || 1;
    if (pred < 10) return data;
    var colors = parms.Colors || 1, bpc = parms.BitsPerComponent || 8, cols = parms.Columns || 1;
    var bpp = Math.max(1, Math.ceil(colors * bpc / 8)), rowLen = Math.ceil(colors * bpc * cols / 8);
    var rows = Math.floor(data.length / (rowLen + 1)), out = new Uint8Array(rows * rowLen), prev = new Uint8Array(rowLen);
    for (var r = 0; r < rows; r++) {
      var ft = data[r * (rowLen + 1)], src = r * (rowLen + 1) + 1, dst = r * rowLen;
      for (var i = 0; i < rowLen; i++) {
        var x = data[src + i], a = i >= bpp ? out[dst + i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0, v;
        if (ft === 0) v = x;
        else if (ft === 1) v = x + a;
        else if (ft === 2) v = x + b;
        else if (ft === 3) v = x + ((a + b) >> 1);
        else { var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
        out[dst + i] = v & 255;
      }
      prev = out.subarray(dst, dst + rowLen);
    }
    return out;
  }

  function asciiHex(d) {
    var out = [], hi = -1;
    for (var i = 0; i < d.length; i++) {
      var c = d[i], v = -1;
      if (c === 62) break;
      if (c >= 48 && c <= 57) v = c - 48; else if (c >= 65 && c <= 70) v = c - 55; else if (c >= 97 && c <= 102) v = c - 87;
      if (v < 0) continue;
      if (hi < 0) hi = v; else { out.push(hi * 16 + v); hi = -1; }
    }
    if (hi >= 0) out.push(hi * 16);
    return new Uint8Array(out);
  }

  function ascii85(d) {
    var out = [], tup = [], i = 0;
    if (d[0] === 60 && d[1] === 126) i = 2;
    for (; i < d.length; i++) {
      var c = d[i];
      if (c === 126) break;
      if (isWS(c)) continue;
      if (c === 122 && !tup.length) { out.push(0, 0, 0, 0); continue; }
      tup.push(c - 33);
      if (tup.length === 5) {
        var n = (((tup[0] * 85 + tup[1]) * 85 + tup[2]) * 85 + tup[3]) * 85 + tup[4];
        out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
        tup = [];
      }
    }
    if (tup.length) {
      var k = tup.length;
      while (tup.length < 5) tup.push(84);
      var m = (((tup[0] * 85 + tup[1]) * 85 + tup[2]) * 85 + tup[3]) * 85 + tup[4];
      var bytes = [(m >>> 24) & 255, (m >>> 16) & 255, (m >>> 8) & 255, m & 255];
      for (var j = 0; j < k - 1; j++) out.push(bytes[j]);
    }
    return new Uint8Array(out);
  }

  function lzw(d) {
    var out = [], dict = [], bits = 9, cur = 0, nb = 0, prev = null, i;
    function reset() { dict = []; for (var k = 0; k < 256; k++) dict.push([k]); dict.push(null, null); bits = 9; }
    reset();
    for (i = 0; i < d.length; i++) {
      cur = (cur << 8) | d[i]; nb += 8;
      while (nb >= bits) {
        var code = (cur >>> (nb - bits)) & ((1 << bits) - 1); nb -= bits;
        if (code === 256) { reset(); prev = null; continue; }
        if (code === 257) return new Uint8Array(out);
        var entry = code < dict.length && dict[code] ? dict[code] : (prev ? prev.concat([prev[0]]) : null);
        if (!entry) return new Uint8Array(out);
        for (var k = 0; k < entry.length; k++) out.push(entry[k]);
        if (prev) dict.push(prev.concat([entry[0]]));
        prev = entry;
        if (dict.length + 1 >= (1 << bits) && bits < 12) bits++;
      }
    }
    return new Uint8Array(out);
  }

  /* ------------------------------------------------------------------ */
  /* Tài liệu                                                            */
  /* ------------------------------------------------------------------ */
  function Doc(bytes) {
    this.b = bytes; this.xref = {}; this.cache = {}; this.trailer = null; this.objStmCache = {};
  }

  Doc.prototype.findBack = function (needle, from) {
    var b = this.b, n = needle.length;
    for (var i = Math.min(from, b.length - n); i >= 0; i--) {
      var ok = true;
      for (var k = 0; k < n; k++) if (b[i + k] !== needle.charCodeAt(k)) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  };
  Doc.prototype.findFwd = function (needle, from, limit) {
    var b = this.b, n = needle.length, end = Math.min(b.length - n, limit === undefined ? b.length : limit), c0 = needle.charCodeAt(0);
    for (var i = from; i <= end; i++) {
      if (b[i] !== c0) continue;
      var ok = true;
      for (var k = 1; k < n; k++) if (b[i + k] !== needle.charCodeAt(k)) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  };

  Doc.prototype.resolve = async function (o) {
    var guard = 0;
    while (o instanceof Ref && guard++ < 20) o = await this.getObj(o.num);
    return o;
  };

  Doc.prototype.load = async function () {
    var ok = false;
    try { ok = await this.readXrefChain(); } catch (e) { ok = false; }
    if (!ok || !this.trailer || !this.trailer.Root) this.scanObjects();
    if (!this.trailer || !this.trailer.Root) throw new Error('Không tìm thấy gốc tài liệu PDF (Root). Tệp có thể bị hỏng hoặc được mã hoá.');
    if (this.trailer.Encrypt) throw new Error('PDF đang được mã hoá (đặt mật khẩu). Hãy in lại ra PDF không mã hoá rồi thử lại.');
    this.pages = [];
    var rootObj = await this.resolve(this.trailer.Root);
    await this.walkPages(await this.resolve(rootObj.Pages), {}, 0);
    if (!this.pages.length) throw new Error('PDF không có trang nào.');
    this.numPages = this.pages.length;
  };

  Doc.prototype.readXrefChain = async function () {
    var sx = this.findBack('startxref', this.b.length - 1);
    if (sx < 0) return false;
    var lx = new Lexer(this.b, sx + 9), off = lx.next(), seen = {};
    while (typeof off === 'number' && off >= 0 && off < this.b.length && !seen[off]) {
      seen[off] = 1;
      var tr = await this.readXrefAt(off);
      if (!tr) return false;
      if (!this.trailer) this.trailer = tr;
      if (typeof tr.XRefStm === 'number') await this.readXrefAt(tr.XRefStm);
      off = tr.Prev;
    }
    return true;
  };

  Doc.prototype.readXrefAt = async function (off) {
    var lx = new Lexer(this.b, off), t = lx.next();
    if (t instanceof Cmd && t.cmd === 'xref') {
      for (;;) {
        var save = lx.p, a = lx.next();
        if (a instanceof Cmd && a.cmd === 'trailer') break;
        if (typeof a !== 'number') { lx.p = save; return null; }
        var count = lx.next();
        for (var i = 0; i < count; i++) {
          var o = lx.next(), g = lx.next(), f = lx.next(), num = a + i;
          if (!(num in this.xref) && f instanceof Cmd && f.cmd === 'n' && o > 0) this.xref[num] = { t: 1, off: o, gen: g };
          else if (!(num in this.xref) && f instanceof Cmd && f.cmd === 'f') this.xref[num] = { t: 0 };
        }
      }
      var p = new Parser(lx);
      return p.obj();
    }
    // Bảng xref dạng luồng
    lx.p = off;
    var head = this.readIndirectAt(off);
    if (!head || !head.stream || !head.value || (head.value.Type && head.value.Type.name !== 'XRef')) return null;
    var d = head.value, data = await this.decodeStream(head);
    var W = d.W, idx = d.Index || [0, d.Size], rec = W[0] + W[1] + W[2], pos = 0;
    function rd(n) { var v = 0; for (var k = 0; k < n; k++) v = v * 256 + data[pos++]; return v; }
    for (var s = 0; s < idx.length; s += 2) {
      for (var j = 0; j < idx[s + 1]; j++) {
        if (pos + rec > data.length) break;
        var type = W[0] ? rd(W[0]) : 1, f2 = rd(W[1]), f3 = rd(W[2]), n2 = idx[s] + j;
        if (n2 in this.xref) continue;
        if (type === 1) this.xref[n2] = { t: 1, off: f2, gen: f3 };
        else if (type === 2) this.xref[n2] = { t: 2, stm: f2, idx: f3 };
        else this.xref[n2] = { t: 0 };
      }
    }
    return d;
  };

  Doc.prototype.scanObjects = function () {
    // Sửa lỗi: dò "n g obj" trên toàn tệp khi bảng xref hỏng.
    var b = this.b, n = b.length;
    for (var i = 0; i < n - 4; i++) {
      if (b[i] === 111 && b[i + 1] === 98 && b[i + 2] === 106 && (i === 0 || isWS(b[i - 1])) && (isWS(b[i + 3]) || isDelim(b[i + 3]))) {
        var j = i - 1;
        while (j > 0 && isWS(b[j])) j--;
        var ge = j; while (j > 0 && b[j] >= 48 && b[j] <= 57) j--;
        if (ge === j) continue;
        var gs = j + 1; while (j > 0 && isWS(b[j])) j--;
        var ne = j; while (j >= 0 && b[j] >= 48 && b[j] <= 57) j--;
        if (ne === j) continue;
        var num = parseInt(latin1(b, j + 1, ne + 1), 10);
        this.xref[num] = { t: 1, off: j + 1, gen: parseInt(latin1(b, gs, ge + 1), 10) };
      }
      if (b[i] === 116 && b[i + 1] === 114 && b[i + 2] === 97 && b[i + 3] === 105 && b[i + 4] === 108 && b[i + 5] === 101 && b[i + 6] === 114) {
        var tr = new Parser(new Lexer(b, i + 7)).obj();
        if (tr && tr.Root) this.trailer = tr;
      }
    }
    if (!this.trailer || !this.trailer.Root) {
      // Tìm /Type /Catalog
      for (var k in this.xref) {
        var h = this.readIndirectAt(this.xref[k].off);
        if (h && h.value && h.value.Type && h.value.Type.name === 'Catalog') { this.trailer = { Root: new Ref(+k, 0) }; break; }
      }
    }
  };

  Doc.prototype.readIndirectAt = function (off) {
    var lx = new Lexer(this.b, off), p = new Parser(lx);
    var n = p.tok(), g = p.tok(), kw = p.tok();
    if (typeof n !== 'number' || !(kw instanceof Cmd) || kw.cmd !== 'obj') return null;
    var v = p.obj(), res = { value: v, stream: false };
    if (p.buf.length) { // con trỏ đã đọc vượt: lùi lại không được, kiểm tra token đã đệm
      var t0 = p.buf[0];
      if (t0 instanceof Cmd && t0.cmd === 'stream' && p.buf.length === 1) return this.streamAfter(res, v, lx.p);
      return res;
    }
    var save = lx.p, t = lx.next();
    if (t instanceof Cmd && t.cmd === 'stream') return this.streamAfter(res, v, lx.p);
    lx.p = save;
    return res;
  };
  Doc.prototype.streamAfter = function (res, dict, p) {
    var b = this.b;
    if (b[p] === 13 && b[p + 1] === 10) p += 2; else if (b[p] === 10 || b[p] === 13) p += 1;
    res.stream = true; res.start = p; res.dict = dict; res.length = dict.Length;
    return res;
  };

  Doc.prototype.getObj = async function (num) {
    if (num in this.cache) return this.cache[num];
    var e = this.xref[num], v = null;
    if (e && e.t === 1) {
      var h = this.readIndirectAt(e.off);
      if (h) {
        if (h.stream) {
          var len = h.length;
          if (len instanceof Ref) { this.cache[num] = null; len = await this.resolve(len); }
          var start = h.start, end = typeof len === 'number' ? start + len : -1;
          var ok = end > start && end <= this.b.length && this.findFwd('endstream', end, end + 24) >= 0;
          if (!ok) { var es = this.findFwd('endstream', start); end = es < 0 ? this.b.length : es; while (end > start && isWS(this.b[end - 1])) end--; }
          v = { stream: true, dict: h.value, raw: this.b.subarray(start, end) };
        } else v = h.value;
      }
    } else if (e && e.t === 2) {
      v = await this.fromObjStm(e.stm, e.idx, num);
    }
    this.cache[num] = v;
    return v;
  };

  Doc.prototype.fromObjStm = async function (stmNum, idx, num) {
    var c = this.objStmCache[stmNum];
    if (!c) {
      var s = await this.getObj(stmNum);
      if (!s || !s.stream) return null;
      var data = await this.decodeStream(s), N = s.dict.N, first = s.dict.First;
      var lx = new Lexer(data), offs = {};
      for (var i = 0; i < N; i++) { var on = lx.next(), oo = lx.next(); offs[on] = oo; }
      c = this.objStmCache[stmNum] = { data: data, first: first, offs: offs };
    }
    if (!(num in c.offs)) return null;
    return new Parser(new Lexer(c.data, c.first + c.offs[num])).obj();
  };

  Doc.prototype.decodeStream = async function (s) {
    var d = s.dict || s.value, raw = s.raw || this.b.subarray(s.start, s.start + (typeof s.length === 'number' ? s.length : 0));
    var filters = await this.resolve(d.Filter), parms = await this.resolve(d.DecodeParms);
    if (!filters) return raw;
    if (!Array.isArray(filters)) { filters = [filters]; parms = [parms]; }
    if (!Array.isArray(parms)) parms = [parms];
    var data = raw;
    for (var i = 0; i < filters.length; i++) {
      var f = filters[i] && filters[i].name, pr = await this.resolve(parms[i]);
      if (f === 'FlateDecode' || f === 'Fl') data = unpredict(await inflate(data), pr);
      else if (f === 'ASCIIHexDecode' || f === 'AHx') data = asciiHex(data);
      else if (f === 'ASCII85Decode' || f === 'A85') data = ascii85(data);
      else if (f === 'LZWDecode' || f === 'LZW') data = unpredict(lzw(data), pr);
      else throw new Error('Bộ lọc ' + f + ' chưa hỗ trợ');
    }
    return data;
  };

  Doc.prototype.walkPages = async function (node, inh, depth) {
    if (!node || depth > 40) return;
    var res = node.Resources !== undefined ? node.Resources : inh.Resources;
    var mb = node.MediaBox !== undefined ? node.MediaBox : inh.MediaBox;
    var cb = node.CropBox !== undefined ? node.CropBox : inh.CropBox;
    var rot = node.Rotate !== undefined ? node.Rotate : inh.Rotate;
    var t = node.Type && node.Type.name;
    if (t === 'Pages' || (node.Kids && t !== 'Page')) {
      var kids = await this.resolve(node.Kids) || [];
      for (var i = 0; i < kids.length; i++) {
        await this.walkPages(await this.resolve(kids[i]), { Resources: res, MediaBox: mb, CropBox: cb, Rotate: rot }, depth + 1);
      }
    } else {
      this.pages.push({ node: node, Resources: res, MediaBox: mb, CropBox: cb, Rotate: rot });
    }
  };

  /* ------------------------------------------------------------------ */
  /* Đọc nội dung trang                                                  */
  /* ------------------------------------------------------------------ */
  function mul(m, n) { // m áp trước, rồi n
    return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
      m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
  }
  function hex2(v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }
  function rgbHex(r, g, b) { return '#' + hex2(r * 255) + hex2(g * 255) + hex2(b * 255); }
  function cmykHex(c, m, y, k) { return rgbHex(1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k)); }

  Doc.prototype.csInfo = async function (res, nameObj) {
    var n = nameObj && nameObj.name;
    if (n === 'DeviceGray' || n === 'G' || n === 'CalGray') return { n: 1, kind: 'gray' };
    if (n === 'DeviceRGB' || n === 'RGB' || n === 'CalRGB') return { n: 3, kind: 'rgb' };
    if (n === 'DeviceCMYK' || n === 'CMYK') return { n: 4, kind: 'cmyk' };
    if (n === 'Pattern') return { n: 0, kind: 'pattern' };
    var csd = res && res.ColorSpace ? await this.resolve(res.ColorSpace) : null;
    var cs = csd && n ? await this.resolve(csd[n]) : null;
    if (Array.isArray(cs)) {
      var fam = cs[0] && cs[0].name;
      if (fam === 'ICCBased') {
        var st = await this.resolve(cs[1]), N = st && st.dict ? st.dict.N : 3;
        return { n: N, kind: N === 1 ? 'gray' : N === 4 ? 'cmyk' : 'rgb' };
      }
      if (fam === 'Separation') return { n: 1, kind: 'tint' };
      if (fam === 'DeviceN') { var names = await this.resolve(cs[1]); return { n: names ? names.length : 1, kind: 'tint' }; }
      if (fam === 'Indexed') return { n: 1, kind: 'indexed' };
      if (fam === 'Pattern') return { n: 0, kind: 'pattern' };
      if (fam === 'CalRGB' || fam === 'Lab') return { n: 3, kind: 'rgb' };
      if (fam === 'CalGray') return { n: 1, kind: 'gray' };
    }
    return { n: 3, kind: 'rgb' };
  };

  function colorOf(cs, vals) {
    if (!vals.length) return '#000000';
    if (cs.kind === 'gray' || (cs.kind !== 'tint' && vals.length === 1)) return rgbHex(vals[0], vals[0], vals[0]);
    if (cs.kind === 'tint') { var t = 0; vals.forEach(function (v) { t = Math.max(t, v); }); return rgbHex(1 - t, 1 - t, 1 - t); }
    if (vals.length === 4) return cmykHex(vals[0], vals[1], vals[2], vals[3]);
    if (vals.length >= 3) return rgbHex(vals[0], vals[1], vals[2]);
    return '#000000';
  }

  function bez(p0, p1, p2, p3, out) {
    for (var i = 1; i <= 8; i++) {
      var t = i / 8, u = 1 - t;
      out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
    }
  }

  Doc.prototype.extract = async function (pageNo, opts) {
    opts = opts || {};
    var pg = this.pages[pageNo - 1];
    if (!pg) throw new Error('Không có trang ' + pageNo);
    var self = this, ents = [], maxEnts = opts.maxEnts || 600000;
    var res = await this.resolve(pg.Resources) || {};
    var mb = (await this.resolve(pg.CropBox)) || (await this.resolve(pg.MediaBox)) || [0, 0, 612, 792];
    mb = mb.map(Number);
    var x0 = Math.min(mb[0], mb[2]), y0 = Math.min(mb[1], mb[3]), x1 = Math.max(mb[0], mb[2]), y1 = Math.max(mb[1], mb[3]);
    var rot = ((Number(await this.resolve(pg.Rotate)) || 0) % 360 + 360) % 360;
    // Ma trận đưa về hệ trang đã xoay, gốc (0,0)
    var base = [1, 0, 0, 1, -x0, -y0], W = x1 - x0, H = y1 - y0;
    if (rot === 90) base = mul(base, [0, -1, 1, 0, 0, W]);
    else if (rot === 180) base = mul(base, [-1, 0, 0, -1, W, H]);
    else if (rot === 270) base = mul(base, [0, 1, -1, 0, H, 0]);
    var outW = rot === 90 || rot === 270 ? H : W, outH = rot === 90 || rot === 270 ? W : H;

    var contents = await this.resolve(pg.node.Contents), parts = [];
    if (contents && !Array.isArray(contents)) contents = [contents];
    for (var i = 0; contents && i < contents.length; i++) {
      var s = await this.resolve(contents[i]);
      if (s && s.stream) parts.push(await this.decodeStream(s));
    }
    var total = 0; parts.forEach(function (p) { total += p.length + 1; });
    var data = new Uint8Array(total), o = 0;
    parts.forEach(function (p) { data.set(p, o); o += p.length; data[o++] = 10; });

    await run(data, res, base, 0);
    var groups = {};
    ents.forEach(function (e) { var g = groups[e.layer] || (groups[e.layer] = { n: 0, pts: 0, kind: e.kind, color: e.color, w: e.w }); g.n++; g.pts += e.pts.length; });
    return { ents: ents, width: outW, height: outH, groups: groups, truncated: ents.length >= maxEnts };

    async function run(bytes, resources, ctm0, depth) {
      var lx = new Lexer(bytes), ops = [], ctm = ctm0.slice(), stack = [];
      var gs = { sc: '#000000', fc: '#000000', lw: 1, scs: { n: 1, kind: 'gray' }, fcs: { n: 1, kind: 'gray' } };
      var path = [], cur = null;
      function T(x, y) { return [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]; }
      function last() { return cur && cur.pts.length ? cur.pts[cur.pts.length - 1] : [0, 0]; }
      for (;;) {
        var t = lx.next();
        if (t === EOF) break;
        if (!(t instanceof Cmd)) {
          if (t instanceof Name || typeof t === 'number' || typeof t === 'string') ops.push(t);
          continue;
        }
        var c = t.cmd, a = ops;
        if (c === '[') { // mảng toán hạng (TJ, d): bỏ qua tới ]
          var dep = 1;
          while (dep > 0) { var u = lx.next(); if (u === EOF) break; if (u instanceof Cmd) { if (u.cmd === '[') dep++; else if (u.cmd === ']') dep--; } }
          ops.push(null); continue;
        }
        if (c === '<<') { // từ điển trong BDC
          var dd = 1;
          while (dd > 0) { var u2 = lx.next(); if (u2 === EOF) break; if (u2 instanceof Cmd) { if (u2.cmd === '<<') dd++; else if (u2.cmd === '>>') dd--; } }
          ops.push(null); continue;
        }
        ops = [];
        switch (c) {
          case 'q': stack.push({ ctm: ctm.slice(), sc: gs.sc, fc: gs.fc, lw: gs.lw, scs: gs.scs, fcs: gs.fcs }); break;
          case 'Q': var st = stack.pop(); if (st) { ctm = st.ctm; gs.sc = st.sc; gs.fc = st.fc; gs.lw = st.lw; gs.scs = st.scs; gs.fcs = st.fcs; } break;
          case 'cm': if (a.length >= 6) ctm = mul(a.slice(-6), ctm); break;
          case 'w': if (a.length) gs.lw = a[a.length - 1]; break;
          case 'G': gs.scs = { n: 1, kind: 'gray' }; gs.sc = colorOf(gs.scs, a); break;
          case 'g': gs.fcs = { n: 1, kind: 'gray' }; gs.fc = colorOf(gs.fcs, a); break;
          case 'RG': gs.scs = { n: 3, kind: 'rgb' }; gs.sc = colorOf(gs.scs, a); break;
          case 'rg': gs.fcs = { n: 3, kind: 'rgb' }; gs.fc = colorOf(gs.fcs, a); break;
          case 'K': gs.scs = { n: 4, kind: 'cmyk' }; gs.sc = colorOf(gs.scs, a); break;
          case 'k': gs.fcs = { n: 4, kind: 'cmyk' }; gs.fc = colorOf(gs.fcs, a); break;
          case 'CS': gs.scs = await self.csInfo(resources, a[a.length - 1]); gs.sc = '#000000'; break;
          case 'cs': gs.fcs = await self.csInfo(resources, a[a.length - 1]); gs.fc = '#000000'; break;
          case 'SC': case 'SCN': gs.sc = colorOf(gs.scs, a.filter(function (v) { return typeof v === 'number'; })); break;
          case 'sc': case 'scn': gs.fc = colorOf(gs.fcs, a.filter(function (v) { return typeof v === 'number'; })); break;
          case 'm': cur = { pts: [T(a[0], a[1])], closed: false }; path.push(cur); break;
          case 'l': if (!cur) { cur = { pts: [], closed: false }; path.push(cur); } cur.pts.push(T(a[0], a[1])); break;
          case 'c': if (cur && a.length >= 6) bez(last(), T(a[0], a[1]), T(a[2], a[3]), T(a[4], a[5]), cur.pts); break;
          case 'v': if (cur && a.length >= 4) { var l0 = last(); bez(l0, l0, T(a[0], a[1]), T(a[2], a[3]), cur.pts); } break;
          case 'y': if (cur && a.length >= 4) { var e1 = T(a[2], a[3]); bez(last(), T(a[0], a[1]), e1, e1, cur.pts); } break;
          case 're':
            if (a.length >= 4) {
              var rx = a[0], ry = a[1], rw = a[2], rh = a[3];
              cur = { pts: [T(rx, ry), T(rx + rw, ry), T(rx + rw, ry + rh), T(rx, ry + rh)], closed: true }; path.push(cur);
            }
            break;
          case 'h': if (cur) cur.closed = true; break;
          case 'S': case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*':
            if (ents.length < maxEnts) {
              var doS = c === 'S' || c === 's' || c[0] === 'B' || c[0] === 'b';
              var doF = c !== 'S' && c !== 's';
              var closeAll = c === 's' || c === 'b' || c === 'b*';
              var scl = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])), wd = Math.round(gs.lw * scl * 100) / 100;
              for (var k = 0; k < path.length; k++) {
                var sp = path[k];
                if (sp.pts.length < 2) continue;
                if (doF && sp.pts.length >= 3) ents.push({ layer: 'Tô ' + gs.fc, kind: 'F', color: gs.fc, w: 0, pts: sp.pts, closed: true, grp: null });
                if (doS) ents.push({ layer: 'Nét ' + gs.sc + ' · ' + wd.toFixed(2) + 'pt', kind: 'S', color: gs.sc, w: wd, pts: sp.pts, closed: sp.closed || closeAll, grp: null });
              }
            }
            path = []; cur = null; break;
          case 'n': path = []; cur = null; break;
          case 'BI': // ảnh nhúng: bỏ qua tới EI
            var bb = lx.b, p = lx.p;
            var idp = self.findIn(bb, 'ID', p, lx.end);
            p = idp < 0 ? lx.end : idp + 3;
            for (; p < lx.end - 2; p++) {
              if (bb[p] === 69 && bb[p + 1] === 73 && (p === 0 || isWS(bb[p - 1])) && (p + 2 >= lx.end || isWS(bb[p + 2]))) { p += 2; break; }
            }
            lx.p = p; break;
          case 'Do':
            if (depth < 8 && a.length) {
              var xd = resources && resources.XObject ? await self.resolve(resources.XObject) : null;
              var xo = xd ? await self.resolve(xd[a[a.length - 1].name]) : null;
              if (xo && xo.stream && xo.dict.Subtype && xo.dict.Subtype.name === 'Form') {
                var mtx = (await self.resolve(xo.dict.Matrix)) || [1, 0, 0, 1, 0, 0];
                var xr = (await self.resolve(xo.dict.Resources)) || resources;
                var savedPath = path; path = []; cur = null;
                try { await run(await self.decodeStream(xo), xr, mul(mtx.map(Number), ctm), depth + 1); } catch (e) { /* bỏ qua form lỗi */ }
                path = savedPath;
              }
            }
            break;
        }
      }
    }
  };
  Doc.prototype.findIn = function (b, needle, from, to) {
    for (var i = from; i < to - needle.length; i++) {
      var ok = true;
      for (var k = 0; k < needle.length; k++) if (b[i + k] !== needle.charCodeAt(k)) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  };

  async function open(bytes) {
    if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
    var doc = new Doc(bytes);
    await doc.load();
    return {
      numPages: doc.numPages,
      pageSize: async function (n) {
        var pg = doc.pages[n - 1], mb = (await doc.resolve(pg.CropBox)) || (await doc.resolve(pg.MediaBox)) || [0, 0, 612, 792];
        return { w: Math.abs(mb[2] - mb[0]), h: Math.abs(mb[3] - mb[1]) };
      },
      extract: function (n, opts) { return doc.extract(n, opts); },
      _doc: doc
    };
  }

  return { open: open, _t: { Lexer: Lexer, Parser: Parser, unpredict: unpredict, ascii85: ascii85, asciiHex: asciiHex } };
});
