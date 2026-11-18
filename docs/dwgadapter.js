/* dwgadapter.js - Chuyển dữ liệu bản vẽ (DwgDatabase của thư viện LibreDWG) thành danh sách nét
 * cùng định dạng với Core.parseDXF: { ents, layers, insunits, texts }.
 *   ents : [{ layer, pts: [[x,y],...], closed, grp, kind: 'S'|'F' }]   (đơn vị gốc của bản vẽ)
 *   texts: [{ text, x, y, h, layer }]                                  (chữ, dùng để tìm tên mặt bằng)
 * Block được bung ra theo ma trận chèn; nét nằm ở lớp "0" trong block mang lớp của INSERT. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DwgAdapter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var IDENT = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  function mmul(m1, m2) { // áp m2 trước rồi m1
    return {
      a: m1.a * m2.a + m1.c * m2.b, b: m1.b * m2.a + m1.d * m2.b,
      c: m1.a * m2.c + m1.c * m2.d, d: m1.b * m2.c + m1.d * m2.d,
      e: m1.a * m2.e + m1.c * m2.f + m1.e, f: m1.b * m2.e + m1.d * m2.f + m1.f
    };
  }
  function mapt(m, x, y) { return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]; }
  var MIRROR = { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 };

  // Hệ toạ độ đối tượng (OCS): với pháp tuyến (0,0,-1) trục X bị lật
  function ocs(ext) { return ext && ext.z < -0.5 ? MIRROR : IDENT; }

  function arcPts(cx, cy, r, a0, a1, ccw) {
    if (ccw === false) { var t = a0; a0 = a1; a1 = t; }
    while (a1 <= a0) a1 += 2 * Math.PI;
    var n = Math.max(4, Math.ceil((a1 - a0) / (10 * Math.PI / 180))), pts = [];
    for (var i = 0; i <= n; i++) { var a = a0 + (a1 - a0) * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    if (ccw === false) pts.reverse();
    return pts;
  }

  function ellipsePts(c, maj, ratio, a0, a1, flip) {
    var L = Math.hypot(maj.x, maj.y), ux = maj.x / L, uy = maj.y / L, b = L * ratio * (flip ? -1 : 1);
    if (a1 <= a0) a1 += 2 * Math.PI;
    var n = Math.max(8, Math.ceil((a1 - a0) / (10 * Math.PI / 180))), pts = [];
    for (var i = 0; i <= n; i++) {
      var t = a0 + (a1 - a0) * i / n, x = L * Math.cos(t), y = b * Math.sin(t);
      pts.push([c.x + x * ux - y * uy, c.y + x * uy + y * ux]);
    }
    return pts;
  }

  function bulgePts(vs, closed) {
    var pts = [], n = vs.length;
    for (var i = 0; i < n; i++) {
      var a = vs[i];
      pts.push([a.x, a.y]);
      if (a.bulge && (i < n - 1 || closed)) {
        var b = vs[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d < 1e-9) continue;
        var th = 4 * Math.atan(a.bulge), k = (d / 2) / Math.tan(th / 2);
        var cx = (a.x + b.x) / 2 - dy / d * k, cy = (a.y + b.y) / 2 + dx / d * k;
        var r = Math.hypot(a.x - cx, a.y - cy), s = Math.atan2(a.y - cy, a.x - cx);
        var m = Math.max(2, Math.ceil(Math.abs(th) / (10 * Math.PI / 180)));
        for (var j = 1; j < m; j++) { var ang = s + th * j / m; pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]); }
      }
    }
    return pts;
  }

  var VN = typeof VnEnc !== 'undefined' ? VnEnc : (typeof require === 'function' ? require('./vnenc.js') : null);
  function cleanText(s) {
    if (s && typeof s === 'object') s = s.text;
    s = String(s || '');
    if (VN) s = VN.fix(s); // chữ TCVN3 / VNI -> Unicode, làm trước khi đổi mã %%c (Ø)
    return s.replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;\\{}]*;/g, '').replace(/\\[LlOoKk]/g, '')
      .replace(/[{}]/g, '').replace(/%%[uUoOkK]/g, '').replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/\s+/g, ' ').trim();
  }

  // Hình học của một đối tượng (toạ độ trong block hoặc model), trả về danh sách {pts, closed, kind}
  function geom(e) {
    var out = [], t = e.type, M, i;
    if (t === 'LINE') {
      out.push({ pts: [[e.startPoint.x, e.startPoint.y], [e.endPoint.x, e.endPoint.y]], closed: false });
    } else if (t === 'LWPOLYLINE') {
      var cl = !!(e.flag & 1), vs = e.vertices || [];
      if (vs.length >= 2) { M = ocs(e.extrusionDirection); out.push({ pts: bulgePts(vs, cl).map(function (p) { return mapt(M, p[0], p[1]); }), closed: cl }); }
    } else if (t === 'POLYLINE2D' || t === 'POLYLINE3D' || t === 'POLYLINE') {
      var pv = (e.vertices || []).filter(function (v) { return !((v.flag || 0) & 16); });
      var pc = !!((e.flag || 0) & 1);
      if (pv.length >= 2) { M = ocs(e.extrusionDirection); out.push({ pts: bulgePts(pv.map(function (v) { return { x: v.x, y: v.y, bulge: v.bulge || 0 }; }), pc).map(function (p) { return mapt(M, p[0], p[1]); }), closed: pc }); }
    } else if (t === 'ARC') {
      M = ocs(e.extrusionDirection);
      out.push({ pts: arcPts(e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle).map(function (p) { return mapt(M, p[0], p[1]); }), closed: false });
    } else if (t === 'CIRCLE') {
      M = ocs(e.extrusionDirection);
      var cp = [];
      for (i = 0; i < 24; i++) cp.push(mapt(M, e.center.x + e.radius * Math.cos(i * Math.PI / 12), e.center.y + e.radius * Math.sin(i * Math.PI / 12)));
      out.push({ pts: cp, closed: true });
    } else if (t === 'ELLIPSE') {
      out.push({ pts: ellipsePts(e.center, e.majorAxisEndPoint, e.axisRatio, e.startAngle, e.endAngle, e.extrusionDirection && e.extrusionDirection.z < -0.5), closed: false });
    } else if (t === 'SPLINE') {
      var sp = (e.fitPoints && e.fitPoints.length ? e.fitPoints : e.controlPoints) || [];
      if (sp.length >= 2) out.push({ pts: sp.map(function (p) { return [p.x, p.y]; }), closed: !!(e.flag & 1) });
    } else if (t === 'SOLID' || t === 'TRACE') {
      var c = e.corner1 || e.firstCorner, d2 = e.corner2 || e.secondCorner, c3 = e.corner3 || e.thirdCorner, c4 = e.corner4 || e.fourthCorner || c3;
      if (c && d2 && c3) out.push({ pts: [[c.x, c.y], [d2.x, d2.y], [c4.x, c4.y], [c3.x, c3.y]], closed: true, kind: 'F' });
    } else if (t === 'HATCH') {
      (e.boundaryPaths || []).forEach(function (bp) {
        var pts = [];
        if (bp.vertices && bp.vertices.length) {
          pts = bulgePts(bp.vertices.map(function (v) { return { x: v.x, y: v.y, bulge: v.bulge || 0 }; }), true);
        } else (bp.edges || []).forEach(function (ed) {
          var seg = [];
          if (ed.type === 1 && ed.start) seg = [[ed.start.x, ed.start.y], [ed.end.x, ed.end.y]];
          else if (ed.type === 2 && ed.center) {
            var ccw = ed.isCCW === undefined ? true : !!ed.isCCW;
            // cung theo chiều kim đồng hồ: góc lưu ở dạng đối xứng, đi từ -start tới -end
            seg = ccw ? arcPts(ed.center.x, ed.center.y, ed.radius, ed.startAngle, ed.endAngle)
                      : arcPts(ed.center.x, ed.center.y, ed.radius, -ed.endAngle, -ed.startAngle).reverse();
          }
          else if (ed.type === 3 && ed.center) seg = ellipsePts(ed.center, ed.end || ed.majorAxisEndPoint, ed.lengthOfMinorAxis || ed.axisRatio || 1, ed.startAngle, ed.endAngle);
          else if (ed.type === 4) seg = ((ed.fitDatum && ed.fitDatum.length ? ed.fitDatum : ed.controlPoints) || []).map(function (p) { return [p.x, p.y]; });
          seg.forEach(function (p) { var l = pts[pts.length - 1]; if (!l || Math.abs(l[0] - p[0]) > 1e-9 || Math.abs(l[1] - p[1]) > 1e-9) pts.push(p); });
        });
        if (pts.length >= 3) out.push({ pts: pts, closed: true, kind: 'F' });
      });
    }
    return out;
  }

  function convert(db, opts) {
    opts = opts || {};
    var blocks = {};
    (db.tables && db.tables.BLOCK_RECORD ? db.tables.BLOCK_RECORD.entries : []).forEach(function (b) { blocks[b.name] = b; });
    var ents = [], texts = [], counter = 0, maxEnts = opts.maxEnts || 2000000;
    var skipText = { TEXT: 1, MTEXT: 1, ATTRIB: 1, ATTDEF: 1 };
    // Kích thước block (đơn vị bản vẽ) để phân biệt block nhỏ (cửa, đồ đạc) với block lớn (cả mặt bằng)
    var UF = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 14: 0.1 }[(db.header && db.header.INSUNITS) || 4] || 0.001;
    var smallLimit = (opts.smallBlockM || 6) / UF, sizeCache = {};
    function blockSize(name) {
      if (name in sizeCache) return sizeCache[name];
      sizeCache[name] = 0;
      var blk = blocks[name], x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      (blk && blk.entities || []).forEach(function (en) {
        var pts = [];
        if (en.type === 'INSERT') { var sz = blockSize(en.name) * Math.max(Math.abs(en.xScale || 1), Math.abs(en.yScale || 1)); pts = [[en.insertionPoint.x - sz / 2, en.insertionPoint.y - sz / 2], [en.insertionPoint.x + sz / 2, en.insertionPoint.y + sz / 2]]; }
        else geom(en).forEach(function (g) { pts = pts.concat(g.pts); });
        pts.forEach(function (p) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; });
      });
      return (sizeCache[name] = x1 >= x0 ? Math.max(x1 - x0, y1 - y0) : 0);
    }

    function emit(list, M, override, grp, depth, inh) {
      for (var i = 0; i < list.length && ents.length < maxEnts; i++) {
        var e = list[i];
        if (e.isVisible === false || e.isInPaperSpace) continue;
        // override: lớp của block nhỏ (cửa, thiết bị) bao ngoài; nét bên trong mang lớp đó.
        // Block lớn (cả một mặt bằng) không đặt override nên nét giữ lớp gốc; nét lớp "0" theo lớp INSERT.
        var layer = override ? override : (e.layer && e.layer !== '0' ? e.layer : (inh || '0'));
        var t = e.type;
        if (skipText[t]) {
          var tx = t === 'ATTRIB' ? (e.text && e.text.startPoint) : (e.startPoint || e.insertionPoint);
          var str = cleanText(t === 'ATTRIB' ? e.text : e.text);
          if (str && tx && depth === 0) {
            var p = mapt(M, tx.x, tx.y), h = (t === 'ATTRIB' ? e.text && e.text.textHeight : e.textHeight) || 0;
            texts.push({ text: str, x: p[0], y: p[1], h: h * Math.sqrt(Math.abs(M.a * M.d - M.b * M.c)), layer: layer });
          }
          continue;
        }
        if (t === 'INSERT') {
          var blk = blocks[e.name];
          if (!blk || depth > 8) continue;
          var bp = blk.basePoint || { x: 0, y: 0 }, rot = e.rotation || 0;
          var sx = e.xScale || 1, sy = e.yScale || 1, cs = Math.cos(rot), sn = Math.sin(rot);
          var nc = Math.max(1, e.columnCount || 1), nr = Math.max(1, e.rowCount || 1);
          var O = ocs(e.extrusionDirection);
          var small = blockSize(e.name) * Math.max(Math.abs(sx), Math.abs(sy)) <= smallLimit;
          var ov = override || (small ? (layer !== '0' ? layer : null) : null);
          var g = grp === null && small ? ++counter : grp;
          for (var ci = 0; ci < nc; ci++) {
            for (var ri = 0; ri < nr; ri++) {
              var ox = e.insertionPoint.x + (ci * (e.columnSpacing || 0)) * cs - (ri * (e.rowSpacing || 0)) * sn;
              var oy = e.insertionPoint.y + (ci * (e.columnSpacing || 0)) * sn + (ri * (e.rowSpacing || 0)) * cs;
              var Mi = { a: cs * sx, b: sn * sx, c: -sn * sy, d: cs * sy, e: 0, f: 0 };
              Mi.e = ox - (Mi.a * bp.x + Mi.c * bp.y); Mi.f = oy - (Mi.b * bp.x + Mi.d * bp.y);
              emit(blk.entities || [], mmul(M, mmul(O, Mi)), ov, g, depth + 1, layer);
            }
          }
          continue;
        }
        if (t === 'DIMENSION' || t === 'VIEWPORT' || t === 'XLINE' || t === 'RAY' || t === 'LEADER' || t === 'MULTILEADER') continue;
        var gs = geom(e);
        for (var k = 0; k < gs.length; k++) {
          var gg = gs[k];
          ents.push({ layer: layer, kind: gg.kind || 'S', closed: gg.closed, grp: grp,
            pts: gg.pts.map(function (q) { return mapt(M, q[0], q[1]); }) });
        }
      }
    }
    emit(db.entities || [], IDENT, null, null, 0, null);
    var layers = {};
    ents.forEach(function (e) { (layers[e.layer] || (layers[e.layer] = { n: 0 })).n++; });
    return { ents: ents, layers: layers, texts: texts, insunits: (db.header && db.header.INSUNITS) || 0, truncated: ents.length >= maxEnts };
  }

  /* Tìm các bản vẽ mặt bằng: gom nét tường thành từng cụm, gắn với tiêu đề "MẶT BẰNG ..." ngay bên dưới cụm. */
  /* ------------------------------------------------------------------------------------------
   * Tìm mặt bằng trong bản vẽ có nhiều tờ đặt cạnh nhau trong Model.
   * 1. Tìm khung tờ giấy: hình chữ nhật lớn tỉ lệ khổ giấy (kín hoặc vẽ hở 3 cạnh), ở bất kỳ lớp nào.
   * 2. Bỏ các nét khung, đường kẻ khung tên khỏi nét tường (nhiều bản vẽ để khung trên lớp tường).
   * 3. Gom nét tường thành cụm trong từng tờ (không gom qua mép tờ).
   * 4. Gắn mỗi cụm vào tiêu đề "MẶT BẰNG ..." gần nhất cùng tờ (ưu tiên tiêu đề nằm dưới hình).
   * Trả về [{ box, n, title, sheet, tx, ty }] theo thứ tự đọc.
   * ------------------------------------------------------------------------------------------ */
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/%%[a-z]/g, ' ').replace(/\s+/g, ' ').trim(); }
  var TITLE_RE = /mat\s*bang|(^|[^a-z])m\.?b\.?\s+(tang|tret|lau|lung|mai|tuong|dinh|bo|ap|tum|thuong|ham)/;
  function isPlanTitle(t) { return TITLE_RE.test(norm(t)); }

  // Hình chữ nhật thẳng trục từ một nét: đa tuyến 4-5 điểm nằm đúng 4 góc (kín, hoặc hở một cạnh)
  function rectOf(e) {
    if (e.kind === 'F' || e.pts.length < 4 || e.pts.length > 5) return null;
    var p = e.pts, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, i;
    for (i = 0; i < p.length; i++) { x0 = Math.min(x0, p[i][0]); x1 = Math.max(x1, p[i][0]); y0 = Math.min(y0, p[i][1]); y1 = Math.max(y1, p[i][1]); }
    var tol = 2e-3 * Math.max(x1 - x0, y1 - y0);
    for (i = 0; i < p.length; i++) {
      var onX = Math.abs(p[i][0] - x0) < tol || Math.abs(p[i][0] - x1) < tol, onY = Math.abs(p[i][1] - y0) < tol || Math.abs(p[i][1] - y1) < tol;
      if (!onX || !onY) return null;
    }
    // đủ 3 cạnh trở lên: các đoạn liên tiếp phải đi dọc mép
    return [x0, y0, x1, y1];
  }
  function frameRects(ents, unitFactor) {
    var minW = 8 / unitFactor, out = [];
    ents.forEach(function (e) {
      var r = rectOf(e); if (!r) return;
      var w = r[2] - r[0], h = r[3] - r[1];
      if (Math.max(w, h) < minW || Math.min(w, h) < minW / 2) return;
      var ar = Math.max(w, h) / Math.max(1e-9, Math.min(w, h));
      if (ar < 1.25 || ar > 1.8) return; // khổ A (1,41) và khổ A kéo dài
      out.push(r);
    });
    // bỏ trùng (một tờ thường có viền ngoài, viền trong vẽ chồng nhiều lần)
    var tol = 1 / unitFactor * 0.05, uniq = [];
    out.forEach(function (r) { if (!uniq.some(function (q) { return Math.abs(q[0] - r[0]) < tol && Math.abs(q[1] - r[1]) < tol && Math.abs(q[2] - r[2]) < tol && Math.abs(q[3] - r[3]) < tol; })) uniq.push(r); });
    return uniq;
  }
  function outerSheets(rects) {
    // khung bao trọn từ 2 khung tờ khác trở lên là khung nhóm, không phải một tờ
    rects = rects.filter(function (r) {
      var tol = 1e-3 * (r[2] - r[0]), inner = 0;
      rects.forEach(function (q) {
        if (q === r || (q[2] - q[0]) > 0.7 * (r[2] - r[0])) return;
        if (q[0] >= r[0] - tol && q[1] >= r[1] - tol && q[2] <= r[2] + tol && q[3] <= r[3] + tol) inner++;
      });
      return inner < 2;
    });
    // Khổ tờ chủ đạo: nhóm kích thước lặp lại có (số lần × diện tích) lớn nhất. Khung nhỏ hơn hẳn (ô phòng, đường bao nhà) không phải tờ.
    var groups = [];
    rects.forEach(function (r) {
      var w = Math.max(r[2] - r[0], r[3] - r[1]), h = Math.min(r[2] - r[0], r[3] - r[1]);
      var g = groups.filter(function (g) { return Math.abs(g.w - w) < 0.02 * w && Math.abs(g.h - h) < 0.02 * h; })[0];
      if (g) g.n++; else groups.push({ w: w, h: h, n: 1 });
    });
    var dom = null;
    groups.forEach(function (g) { if (g.n >= 2 && (!dom || g.n * g.w * g.h > dom.n * dom.w * dom.h)) dom = g; });
    if (!dom) return [];
    rects = rects.filter(function (r) { return Math.max(r[2] - r[0], r[3] - r[1]) >= 0.6 * dom.w && Math.min(r[2] - r[0], r[3] - r[1]) >= 0.6 * dom.h; });
    var sorted = rects.slice().sort(function (a, b) { return (b[2] - b[0]) * (b[3] - b[1]) - (a[2] - a[0]) * (a[3] - a[1]); }), sheets = [];
    sorted.forEach(function (r) {
      var tol = 1e-3 * (r[2] - r[0]);
      if (!sheets.some(function (s) { return r[0] >= s[0] - tol && r[1] >= s[1] - tol && r[2] <= s[2] + tol && r[3] <= s[3] + tol; })) sheets.push(r);
    });
    return sheets;
  }
  // Nét thuộc khung tờ: mọi điểm nằm trên mép một khung, hoặc là đoạn thẳng gần chạy suốt chiều cao/rộng khung (kẻ khung tên)
  function isFrameEnt(e, eb, rects) {
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i], W = r[2] - r[0], H = r[3] - r[1], tol = 3e-3 * Math.max(W, H);
      if (eb[0] < r[0] - tol || eb[1] < r[1] - tol || eb[2] > r[2] + tol || eb[3] > r[3] + tol) continue;
      var onEdge = e.pts.every(function (p) { return Math.abs(p[0] - r[0]) < tol || Math.abs(p[0] - r[2]) < tol || Math.abs(p[1] - r[1]) < tol || Math.abs(p[1] - r[3]) < tol; });
      if (onEdge && Math.max(eb[2] - eb[0], eb[3] - eb[1]) > 0.2 * Math.min(W, H)) return true;
      if (e.pts.length === 2 && ((eb[2] - eb[0] < tol && eb[3] - eb[1] > 0.85 * H) || (eb[3] - eb[1] < tol && eb[2] - eb[0] > 0.85 * W))) return true;
    }
    return false;
  }

  function findPlans(ents, texts, roles, unitFactor) {
    var allRects = frameRects(ents, unitFactor), sheets = outerSheets(allRects);
    // viền ngoài và viền trong của các tờ hợp lệ
    var rects = allRects.filter(function (r) {
      return sheets.some(function (sh) { var tol = 0.08 * (sh[2] - sh[0]); return r[0] >= sh[0] - 1e-6 && r[2] <= sh[2] + 1e-6 && r[1] >= sh[1] - 1e-6 && r[3] <= sh[3] + 1e-6 && (r[2] - r[0]) > (sh[2] - sh[0]) - 2 * tol; });
    });
    function sheetOf(x, y) {
      for (var i = 0; i < sheets.length; i++) { var s = sheets[i]; if (x >= s[0] && x <= s[2] && y >= s[1] && y <= s[3]) return i; }
      return -1;
    }
    var boxes = [];
    ents.forEach(function (e) {
      if (roles[e.layer] !== 'wall') return;
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      e.pts.forEach(function (p) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; });
      var b = [x0, y0, x1, y1];
      if (rects.length && isFrameEnt(e, b, rects)) { e.frame = true; return; } // đánh dấu để không lấy vào tầng
      b.push(0);
      boxes.push(b);
    });
    var gap = 2.5 / unitFactor; // các nét cách nhau dưới 2,5 m thuộc cùng một bản vẽ
    function touch(a, b) { return a[4] === b[4] && b[0] - gap <= a[2] && a[0] - gap <= b[2] && b[1] - gap <= a[3] && a[1] - gap <= b[3]; }
    boxes.sort(function (a, b) { return a[0] - b[0]; });
    var clusters = [];
    boxes.forEach(function (b) {
      var hit = null;
      for (var i = clusters.length - 1; i >= 0; i--) {
        var c = clusters[i];
        if (!touch(c, b)) continue;
        if (!hit) { hit = c; c[0] = Math.min(c[0], b[0]); c[1] = Math.min(c[1], b[1]); c[2] = Math.max(c[2], b[2]); c[3] = Math.max(c[3], b[3]); c[5]++; }
        else { hit[0] = Math.min(hit[0], c[0]); hit[1] = Math.min(hit[1], c[1]); hit[2] = Math.max(hit[2], c[2]); hit[3] = Math.max(hit[3], c[3]); hit[5] += c[5]; clusters.splice(i, 1); }
      }
      if (!hit) clusters.push([b[0], b[1], b[2], b[3], b[4], 1]);
    });
    for (var pass = 0; pass < 6; pass++) { // gộp lại vì sau khi nở ra các cụm có thể chạm nhau
      var merged = false;
      for (var i = 0; i < clusters.length; i++) for (var j = i + 1; j < clusters.length; j++) {
        var a = clusters[i], b = clusters[j];
        if (touch(a, b)) {
          a[0] = Math.min(a[0], b[0]); a[1] = Math.min(a[1], b[1]); a[2] = Math.max(a[2], b[2]); a[3] = Math.max(a[3], b[3]); a[5] += b[5];
          clusters.splice(j, 1); j--; merged = true;
        }
      }
      if (!merged) break;
    }
    clusters = clusters.filter(function (c) { return c[5] >= 3; });
    clusters.forEach(function (c) { c[4] = sheetOf((c[0] + c[2]) / 2, (c[1] + c[3]) / 2); });
    if (sheets.length >= 3) {
      var q = 0.15 / unitFactor, seen = {};
      var keyOf = function (c) { var sh = sheets[c[4]]; return [Math.round((c[2] - c[0]) / q), Math.round((c[3] - c[1]) / q), Math.round((c[0] - sh[0]) / q), Math.round((c[1] - sh[1]) / q)].join(','); };
      clusters.forEach(function (c) { if (c[4] >= 0) { var k = keyOf(c); seen[k] = (seen[k] || 0) + 1; } });
      var limitRep = Math.max(3, Math.ceil(sheets.length * 0.5));
      clusters = clusters.filter(function (c) { return c[4] < 0 || seen[keyOf(c)] < limitRep; });
    }

    // Tiêu đề mặt bằng (bỏ trùng)
    var MAIN = /(tang|tret|lau|lung|ham|thuong|tum|mai)([^a-z]|$)/;
    var DRAW = /mat\s*(bang|dung|cat)|chi\s*tiet|thong\s*ke|so\s*do|phoi\s*canh|(^|[^a-z])mb([^a-z]|$)/;
    var titles = [];
    texts.forEach(function (t) {
      var nt = norm(t.text);
      if (!DRAW.test(nt) || nt.length > 70) return;
      var dup = titles.some(function (q) { return norm(q.text) === norm(t.text) && Math.hypot(q.x - t.x, q.y - t.y) < 0.5 / unitFactor; });
      if (!dup) titles.push({ text: t.text.replace(/%%[uUoOkK]/g, '').trim(), x: t.x, y: t.y, h: t.h || 0, sheet: sheetOf(t.x, t.y),
        plan: isPlanTitle(t.text), main: isPlanTitle(t.text) && MAIN.test(nt) });
    });
    var maxD = 20 / unitFactor, groups = {}, loose = [];
    clusters.forEach(function (c) {
      var best = -1, bestD = Infinity, bestGeo = Infinity, cx = (c[0] + c[2]) / 2;
      titles.forEach(function (t, ti) {
        if (sheets.length && c[4] >= 0 && t.sheet !== c[4]) return;
        var dx = t.x < c[0] ? c[0] - t.x : t.x > c[2] ? t.x - c[2] : 0;
        var dy = t.y < c[1] ? c[1] - t.y : t.y > c[3] ? (t.y - c[3]) * 2.5 : 0; // tiêu đề ở trên hình kém ưu tiên hơn ở dưới
        var d = (Math.hypot(dx * 1.5, dy) + Math.abs(t.x - cx) * 0.05) * (t.main ? 1 : 1.8);
        if (d < bestD) { bestD = d; best = ti; bestGeo = Math.hypot(dx, t.y < c[1] ? c[1] - t.y : t.y > c[3] ? t.y - c[3] : 0); }
      });
      var limit = sheets.length && c[4] >= 0 ? Infinity : maxD; // khoảng cách hình học thật, không tính hệ số ưu tiên
      if (best >= 0 && bestGeo <= limit) { if (titles[best].plan) (groups[best] || (groups[best] = [])).push(c); } // cụm của mặt đứng, chi tiết... bỏ đi
      else if (c[5] >= 40) loose.push({ box: c.slice(0, 4), n: c[5], title: '' });
    });
    var plans = Object.keys(groups).map(function (ti) {
      var cs = groups[ti], box = [Infinity, Infinity, -Infinity, -Infinity], n = 0;
      cs.forEach(function (c) { box[0] = Math.min(box[0], c[0]); box[1] = Math.min(box[1], c[1]); box[2] = Math.max(box[2], c[2]); box[3] = Math.max(box[3], c[3]); n += c[5]; });
      var t = titles[ti], sub = '', sd = Infinity;
      // tên tờ (vd "MẶT BẰNG BỐ TRÍ CỬA" trong khung tên) nằm bên phải tiêu đề chính
      titles.forEach(function (q) {
        if (q === t || !q.plan || MAIN.test(norm(q.text))) return;
        if (sheets.length && t.sheet >= 0 && q.sheet !== t.sheet) return;
        var dx = q.x - t.x, dy = Math.abs(q.y - t.y);
        if (dx < 0 || dx > 12 / unitFactor || dy > 30 / unitFactor) return;
        if (dx + dy < sd) { sd = dx + dy; sub = q.text; }
      });
      return { box: box, n: n, title: t.text, sheet: sub.replace(/^\s*m[ặa]t\s*b[ằa]ng\s*/i, ''), tx: t.x, ty: t.y };
    }).concat(loose);
    var minSize = 3 / unitFactor;
    plans = plans.filter(function (p) { return Math.min(p.box[2] - p.box[0], p.box[3] - p.box[1]) >= minSize && p.n >= 8; });
    var rowTol = 5 / unitFactor;
    plans.sort(function (p, q) { return Math.abs(q.box[3] - p.box[3]) > rowTol ? q.box[3] - p.box[3] : p.box[0] - q.box[0]; });
    return plans;
  }

  /* Tìm các khung giấy (tờ bản vẽ đặt trong Model). Trả về [{ box, title, texts }] theo thứ tự đọc. */
  function findSheets(ents, texts, unitFactor) {
    var sheets = outerSheets(frameRects(ents, unitFactor));
    var titleRe = /mat\s*bang|mat\s*dung|mat\s*cat|chi\s*tiet/;
    var out = sheets.map(function (b) {
      var ts = texts.filter(function (t) { return t.x >= b[0] && t.x <= b[2] && t.y >= b[1] && t.y <= b[3]; });
      var best = null;
      ts.forEach(function (t) { if (titleRe.test(norm(t.text)) && (!best || (t.h || 0) > (best.h || 0))) best = t; });
      return { box: b, title: best ? best.text : '', texts: ts };
    });
    var rowTol = 5 / unitFactor;
    out.sort(function (p, q) { return Math.abs(q.box[3] - p.box[3]) > rowTol ? q.box[3] - p.box[3] : p.box[0] - q.box[0]; });
    return out;
  }

  /* ------------------------------------------------------------------------------------------
   * Đọc tầng từ tiêu đề mặt bằng. Trả về danh sách thứ tự tầng (số, có thể nhiều tầng khi là tầng điển hình)
   * hoặc null nếu không phải mặt bằng kiến trúc của một tầng.
   *   tầng hầm (2) -> -1 (-2); tầng trệt -> 1; lầu N -> N+1; tầng N -> N; tầng lửng (N) -> N+0,5;
   *   tầng 2+3, tầng 2-4, tầng 2 đến 4 -> 2,3(,4); tầng thượng / tum -> 900; áp mái -> 950; mái -> 1000
   * ------------------------------------------------------------------------------------------ */
  // Mặt bằng không phải kiến trúc (kết cấu, điện nước...) hoặc chi tiết: không dùng làm tầng
  var NOT_ARCH = /chi\s*tiet|ve\s*sinh|(^|[^a-z])wc([^a-z]|$)|(^|[^a-z])thang(\s*(bo|may))?([^a-z]|$)|(^|[^a-z])be(\s|$)|tu\s*hoai|(^|[^a-z])mong([^a-z]|$)|giang|(^|[^a-z])dam([^a-z]|$)|thep|ket\s*cau|btct|(^|[^a-z])cot([^a-z]|$)|(^|[^a-z])coc([^a-z]|$)|dien|chieu\s*sang|cap\s*nuoc|thoat\s*nuoc|nuoc|chong\s*set|tin\s*hieu|dieu\s*hoa|pccc|camera|internet|mang\s*lan|(^|[^a-z])ong([^a-z]|$)|tong\s*the|tren\s*dat|hien\s*trang|quy\s*hoach|san\s*vuon|canh\s*quan|sat\s*nhap|phoi\s*canh/;
  function floorKeys(title) {
    var t = norm(title).replace(/^.*?mat\s*bang|^.*?m\.?b\.?\s+/, ' ');
    if (NOT_ARCH.test(t)) return null;
    var m;
    if (/ap\s*mai/.test(t)) return [950];
    if (/thuong|(^|[^a-z])tum([^a-z]|$)/.test(t)) return [900];
    if ((m = /ham\s*(\d+)?/.exec(t))) return [-(m[1] ? +m[1] : 1)];
    if (/tret/.test(t)) {
      if (/lung/.test(t)) return [1.5];
      return [1];
    }
    if ((m = /lung\s*(\d+)?/.exec(t)) && !/tang\s*\d+\s*(-|den)\s*(tang\s*)?lung/.test(t)) {
      var after = /tang\s*(\d+)\s*(va|\+|,)?\s*lung/.exec(t);
      return [(m[1] ? +m[1] : after ? +after[1] : 1) + 0.5];
    }
    if ((m = /lau\s*(\d+)(\s*(\+|-|den|,|va)\s*(lau\s*)?(\d+))?/.exec(t))) {
      var a = +m[1] + 1, b = m[5] ? +m[5] + 1 : a, out = [];
      for (var k = a; k <= Math.min(b, a + 40); k++) out.push(k);
      return out;
    }
    if ((m = /tang\s*(\d+)(\s*(\+|-|den|,|va|~)\s*(tang\s*)?(\d+))?/.exec(t))) {
      var a2 = +m[1], b2 = m[5] ? +m[5] : a2, out2 = [];
      if (b2 < a2 || b2 - a2 > 40) b2 = a2;
      for (var k2 = a2; k2 <= b2; k2++) out2.push(k2);
      return out2;
    }
    if (/(^|[^a-z])mai([^a-z]|$)/.test(t)) return [1000];
    return null;
  }

  // Tên tầng theo thứ tự đọc được từ tiêu đề: 1 -> "Tầng 1", 1.5 -> "Tầng lửng 1", -1 -> "Tầng hầm", 900 -> "Tầng thượng"...
  function levelLabel(title, idx) {
    var k = floorKeys(title || '');
    if (!k) return '';
    if (k.length > 1) return 'Tầng ' + k[0] + '–' + k[k.length - 1];
    var v = k[0];
    if (v >= 1000) return 'Mái';
    if (v >= 950) return 'Áp mái';
    if (v >= 900) return 'Tầng thượng';
    if (v < 0) return v === -1 ? 'Tầng hầm' : 'Tầng hầm ' + (-v);
    var nt = norm(title);
    if (v % 1) return /tret/.test(nt) ? 'Tầng lửng' : 'Tầng lửng ' + Math.floor(v);
    if (/lau\s*\d/.test(nt)) return 'Lầu ' + (v - 1); // cách gọi miền Nam: lầu 1 là tầng 2
    if (v === 1 && /tret/.test(nt)) return 'Tầng trệt';
    return 'Tầng ' + v;
  }

  function planKind(p) {
    var t = norm(p.title);
    return /(^|[^a-z])mai([^a-z]|$)/.test(t) && !/ap\s*mai/.test(t) ? 'roof' : 'floor';
  }

  // Chọn mặt bằng cho các tầng, theo thứ tự từ dưới lên. Mỗi tầng ưu tiên tờ có ký hiệu cửa, rồi tường xây,
  // kích thước, mặt bằng kiến trúc thường, rồi các tờ lát sàn, trần, lanh tô; cùng loại thì chọn tờ nhiều nét tường hơn.
  function pickFloors(plans) {
    function prio(p) {
      var s = norm(p.title + ' ' + (p.sheet || ''));
      if (/cua/.test(s)) return 0;
      if (/tuong/.test(s)) return 1;
      if (/kich\s*thuoc/.test(s)) return 2;
      if (/lat\s*san|tran|lanh\s*to|hoan\s*thien|mau|vat\s*lieu/.test(s)) return 4;
      return 3;
    }
    var byKey = {}, typical = {};
    plans.forEach(function (p) {
      var keys = floorKeys(p.title);
      if (!keys) return;
      keys.forEach(function (k) {
        var bucket = keys.length > 1 ? typical : byKey;
        (bucket[k] || (bucket[k] = [])).push(p);
      });
    });
    Object.keys(typical).forEach(function (k) { if (!byKey[k]) byKey[k] = typical[k]; });
    // Không có tiêu đề tầng nào (nhà một tầng: "MẶT BẰNG", "MẶT BẰNG TƯỜNG XÂY"...): coi là tầng 1
    if (!Object.keys(byKey).some(function (k) { return +k < 1000; })) {
      plans.forEach(function (p) {
        var t = norm(p.title).replace(/^.*?mat\s*bang/, ' ');
        if (p.title && !NOT_ARCH.test(t) && !/(^|[^a-z])mai([^a-z]|$)/.test(t)) (byKey[1] || (byKey[1] = [])).push(p);
      });
    }
    // Kích thước nhà chung: trung vị kích thước các ứng viên. Tờ lệch quá xa (hình bị gộp, bị cắt) bị đẩy xuống.
    var cand = [].concat.apply([], Object.keys(byKey).map(function (k) { return byKey[k]; }));
    var med = function (a) { a = a.slice().sort(function (x, y) { return x - y; }); return a.length ? a[a.length >> 1] : 0; };
    var W = med(cand.map(function (p) { return Math.max(p.box[2] - p.box[0], p.box[3] - p.box[1]); }));
    var H = med(cand.map(function (p) { return Math.min(p.box[2] - p.box[0], p.box[3] - p.box[1]); }));
    function off(p) {
      if (!W || !H) return 0;
      var w = Math.max(p.box[2] - p.box[0], p.box[3] - p.box[1]), h = Math.min(p.box[2] - p.box[0], p.box[3] - p.box[1]);
      var e = Math.max(Math.abs(Math.log(w / W)), Math.abs(Math.log(h / H)));
      return e > 0.45 ? 10 : 0;
    }
    function rank(a, b) { return (off(a) + prio(a)) - (off(b) + prio(b)) || b.n - a.n; }
    var keys = Object.keys(byKey).map(Number).sort(function (a, b) { return a - b; });
    var out = [];
    keys.forEach(function (k) {
      if (k >= 1000) return;
      out.push(byKey[k].slice().sort(rank)[0]);
    });
    if (out.length && byKey[1000]) {
      var r = byKey[1000].slice().sort(rank)[0];
      if (planKind(r) === 'roof') out.push(r);
    }
    if (!out.length && plans.length) {
      // không có tiêu đề tầng: lấy mặt bằng nhiều nét tường nhất
      out.push(plans.slice().sort(function (a, b) { return b.n - a.n; })[0]);
    }
    return out;
  }

  // Cao độ sàn của mặt bằng: chữ dạng +3.750 trong mặt bằng, chọn giá trị xuất hiện nhiều nhất
  // trên mặt cắt, mặt đứng (các chữ cao độ nằm ngoài mọi mặt bằng có tên).
  var COTE = /^[±+\-]\s?(\d+)[.,](\d{3})$/;
  function coteOf(t) {
    var m = COTE.exec(String(t).trim()); if (!m) return null;
    var v = parseInt(m[1], 10) + parseInt(m[2], 10) / 1000;
    return /^\s*-/.test(t) ? -v : v;
  }
  /* Cao độ sàn cho các tầng đã chọn. Chọn cả dãy một lúc (quy hoạch động) để dãy tăng dần hợp lý:
   *   - tầng thường cách tầng thường trước 2,6 - 6,5 m; tầng lửng cách tầng dưới 1 - 4 m; áp mái, mái cách 1 - 8 m;
   *   - ưu tiên chữ cao độ nằm trong chính mặt bằng, rồi chữ cao độ hay gặp trên mặt cắt, mặt đứng; tầng 1 ưu tiên ±0.000.
   * Không tìm được dãy hợp lệ thì trả null cho mọi tầng (khi đó các tầng xếp chồng theo ô "Cao tầng"). */
  function planLevels(plans, chosen, texts, unitFactor) {
    var inside = function (t, b, m) { return t.x >= b[0] - m && t.x <= b[2] + m && t.y >= b[1] - m && t.y <= b[3] + m; };
    var m = 0.5 / unitFactor, freq = {}, cotes = [];
    texts.forEach(function (t) { var v = coteOf(t.text); if (v !== null) cotes.push({ v: v, t: t }); });
    var floorPlans = plans.filter(function (p) { return p.title && (floorKeys(p.title) || planKind(p) === 'roof'); });
    cotes.forEach(function (c) {
      if (floorPlans.some(function (p) { return inside(c.t, p.box, m); })) return;
      var k = c.v.toFixed(3); freq[k] = (freq[k] || 0) + 1;
    });
    var keys = chosen.map(function (p, i) {
      var k = floorKeys(p.title);
      if (k) { // tầng điển hình dùng cùng một tờ cho nhiều tầng: lấy số tầng theo vị trí trong dãy
        var same = 0; for (var j = 0; j < i; j++) if (chosen[j] === p) same++;
        return k[Math.min(same, k.length - 1)];
      }
      return planKind(p) === 'roof' ? 1000 : i + 1;
    });
    var hasZero = cotes.some(function (c) { return Math.abs(c.v) < 1e-6; });
    var cands = chosen.map(function (p, i) {
      var local = {};
      cotes.forEach(function (c) { if (inside(c.t, p.box, m)) { var k = c.v.toFixed(3); local[k] = (local[k] || 0) + 1; } });
      var set = {};
      Object.keys(local).forEach(function (k) { set[k] = 1; });
      Object.keys(freq).forEach(function (k) { if (freq[k] >= 2) set[k] = 1; });
      if (keys[i] === 1 && hasZero) set['0.000'] = 1;
      return Object.keys(set).map(function (k) {
        var v = +k, lc = local[k] || 0, gc = freq[k] || 0;
        var sc = (lc ? 6 + Math.min(lc, 4) : 0) + Math.min(gc, 30) / 5 + (keys[i] === 1 && Math.abs(v) < 1e-6 ? 6 : 0);
        return { v: v, s: sc };
      });
    });
    function isFull(k) { return k === 900 || (k < 900 && Math.abs(k - Math.round(k)) < 1e-6); }
    function ok(i, v, prevV, lastFullV) {
      var k = keys[i];
      if (prevV !== null && v < prevV + 1.0 - 1e-6) return false;
      if (k >= 950) return prevV === null || v - prevV <= 8;
      if (isFull(k)) { if (lastFullV !== null && (v - lastFullV < 2.6 - 1e-6 || v - lastFullV > 6.5 + 1e-6)) return false; }
      else if (prevV !== null && v - prevV > 4 + 1e-6) return false;
      return true;
    }
    // trạng thái: (giá trị tầng hiện tại, giá trị tầng thường gần nhất) -> điểm tốt nhất
    var layer = [{ v: null, f: null, s: 0, path: [] }];
    for (var i = 0; i < chosen.length; i++) {
      var next = {};
      layer.forEach(function (st) {
        cands[i].forEach(function (c) {
          if (!ok(i, c.v, st.v, st.f)) return;
          var f = isFull(keys[i]) ? c.v : st.f, key = c.v + '|' + f, sc = st.s + c.s;
          if (!next[key] || next[key].s < sc) next[key] = { v: c.v, f: f, s: sc, path: st.path.concat([c.v]) };
        });
      });
      layer = Object.keys(next).map(function (k) { return next[k]; });
      if (!layer.length) return chosen.map(function () { return null; });
    }
    var best = layer.sort(function (a, b) { return b.s - a.s; })[0];
    return best.path;
  }

  // Nét thuộc vùng mặt bằng: tâm nằm trong vùng (nới m) và cả nét không thò ra ngoài quá 3m (m = 1 m theo đơn vị bản vẽ).
  // Nét khung tờ, đường kẻ khung tên chạy ngang qua mặt bằng vì thế không bị lấy vào.
  function inBox(e, b, m) {
    if (e.frame) return false;
    var cx = 0, cy = 0, n = e.pts.length, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < n; i++) {
      var p = e.pts[i]; cx += p[0]; cy += p[1];
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    cx /= n; cy /= n;
    if (cx < b[0] - m || cx > b[2] + m || cy < b[1] - m || cy > b[3] + m) return false;
    var M = 3 * m;
    return x0 >= b[0] - M && x1 <= b[2] + M && y0 >= b[1] - M && y1 <= b[3] + M;
  }

  return { convert: convert, findPlans: findPlans, findSheets: findSheets, pickFloors: pickFloors, planKind: planKind, planLevels: planLevels, floorKeys: floorKeys, levelLabel: levelLabel, inBox: inBox, cleanText: cleanText };
});
