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

  function cleanText(s) {
    if (s && typeof s === 'object') s = s.text;
    s = String(s || '');
    return s.replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;\\{}]*;/g, '').replace(/\\[LlOoKk]/g, '')
      .replace(/[{}]/g, '').replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/\s+/g, ' ').trim();
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
  function findPlans(ents, texts, roles, unitFactor) {
    var boxes = [];
    ents.forEach(function (e) {
      if (roles[e.layer] !== 'wall') return;
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      e.pts.forEach(function (p) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; });
      boxes.push([x0, y0, x1, y1]);
    });
    var gap = 2.5 / unitFactor; // các nét cách nhau dưới 2,5 m thuộc cùng một bản vẽ
    boxes.sort(function (a, b) { return a[0] - b[0]; });
    var clusters = [];
    boxes.forEach(function (b) {
      var hit = null;
      for (var i = clusters.length - 1; i >= 0; i--) {
        var c = clusters[i];
        if (b[0] - gap <= c[2] && c[0] - gap <= b[2] && b[1] - gap <= c[3] && c[1] - gap <= b[3]) {
          if (!hit) { hit = c; c[0] = Math.min(c[0], b[0]); c[1] = Math.min(c[1], b[1]); c[2] = Math.max(c[2], b[2]); c[3] = Math.max(c[3], b[3]); c[4]++; }
          else { hit[0] = Math.min(hit[0], c[0]); hit[1] = Math.min(hit[1], c[1]); hit[2] = Math.max(hit[2], c[2]); hit[3] = Math.max(hit[3], c[3]); hit[4] += c[4]; clusters.splice(i, 1); }
        }
      }
      if (!hit) clusters.push([b[0], b[1], b[2], b[3], 1]);
    });
    // gộp lại lần nữa vì sau khi nở ra các cụm có thể chạm nhau
    for (var pass = 0; pass < 4; pass++) {
      var merged = false;
      for (var i = 0; i < clusters.length; i++) for (var j = i + 1; j < clusters.length; j++) {
        var a = clusters[i], b = clusters[j];
        if (b[0] - gap <= a[2] && a[0] - gap <= b[2] && b[1] - gap <= a[3] && a[1] - gap <= b[3]) {
          a[0] = Math.min(a[0], b[0]); a[1] = Math.min(a[1], b[1]); a[2] = Math.max(a[2], b[2]); a[3] = Math.max(a[3], b[3]); a[4] += b[4];
          clusters.splice(j, 1); j--; merged = true;
        }
      }
      if (!merged) break;
    }
    var minSize = 3 / unitFactor;
    clusters = clusters.filter(function (c) { return c[4] >= 3; });
    var bigEnough = function (p) { return Math.min(p.box[2] - p.box[0], p.box[3] - p.box[1]) >= minSize && p.n >= 8; };
    // Gắn mỗi cụm vào tiêu đề "MẶT BẰNG ..." gần nhất nằm ở phía dưới hoặc dưới bên phải của cụm
    var titleRe = /m[ặa]t\s*b[ằa]ng/i, titles = [];
    texts.forEach(function (t) {
      if (!titleRe.test(t.text)) return;
      var dup = titles.some(function (q) { return q.text === t.text && Math.hypot(q.x - t.x, q.y - t.y) < 0.5 / unitFactor; });
      if (!dup) titles.push(t);
    });
    var mainTitles = titles.filter(function (t) { return /t[ầa]ng|m[áa]i|t[ổo]ng\s*th[ểe]|thang/i.test(t.text); });
    if (!mainTitles.length) mainTitles = titles;
    var maxD = 20 / unitFactor, groups = {}, loose = [];
    clusters.forEach(function (c) {
      var cy = (c[1] + c[3]) / 2, best = -1, bestD = Infinity;
      titles.forEach(function (t, ti) {
        if (mainTitles.indexOf(t) < 0) return;
        if (cy < t.y - 1 / unitFactor || c[0] > t.x + 3 / unitFactor) return;
        var dx = t.x < c[0] ? c[0] - t.x : t.x > c[2] ? t.x - c[2] : 0;
        var dy = t.y < c[1] ? c[1] - t.y : t.y > c[3] ? t.y - c[3] : 0;
        var d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; best = ti; }
      });
      if (best >= 0 && bestD <= maxD) (groups[best] || (groups[best] = [])).push(c);
      else if (c[4] >= 40) loose.push({ box: c.slice(0, 4), n: c[4], title: '' });
    });
    var plans = Object.keys(groups).map(function (ti) {
      var cs = groups[ti], box = [Infinity, Infinity, -Infinity, -Infinity], n = 0;
      cs.forEach(function (c) { box[0] = Math.min(box[0], c[0]); box[1] = Math.min(box[1], c[1]); box[2] = Math.max(box[2], c[2]); box[3] = Math.max(box[3], c[3]); n += c[4]; });
      var t = titles[ti], sub = '', sd = Infinity;
      titles.forEach(function (q) {
        if (q === t || /t[ầa]ng|m[áa]i|thang/i.test(q.text)) return;
        var dx = q.x - t.x, dy = Math.abs(q.y - t.y);
        if (dx < 0 || dx > 12 / unitFactor || dy > 30 / unitFactor) return;
        if (dx + dy < sd) { sd = dx + dy; sub = q.text; }
      });
      return { box: box, n: n, title: t.text, sheet: sub.replace(/^m[ặa]t\s*b[ằa]ng\s*/i, ''), tx: t.x, ty: t.y };
    }).concat(loose);
    plans = plans.filter(bigEnough);
    var rowTol = 5 / unitFactor;
    plans.sort(function (p, q) { return Math.abs(q.box[3] - p.box[3]) > rowTol ? q.box[3] - p.box[3] : p.box[0] - q.box[0]; });
    return plans;
  }


  /* Tìm các khung giấy (tờ bản vẽ đặt trong Model): hình chữ nhật lớn nằm ngang/dọc, tỉ lệ cạnh 1,2 - 2,2.
   * Trả về [{ box:[x0,y0,x1,y1], title, texts }] theo thứ tự đọc (trên xuống, trái sang phải). */
  function findSheets(ents, texts, unitFactor) {
    var minW = 8 / unitFactor, rects = [];
    ents.forEach(function (e) {
      if (e.kind === 'F' || e.pts.length < 4 || e.pts.length > 5) return;
      var p = e.pts;
      if (p.length === 5 && (Math.abs(p[0][0] - p[4][0]) > 1e-6 || Math.abs(p[0][1] - p[4][1]) > 1e-6)) return;
      if (!e.closed && p.length === 4) return;
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (var i = 0; i < 4; i++) { x0 = Math.min(x0, p[i][0]); x1 = Math.max(x1, p[i][0]); y0 = Math.min(y0, p[i][1]); y1 = Math.max(y1, p[i][1]); }
      var w = x1 - x0, h = y1 - y0, tol = 1e-3 * Math.max(w, h);
      if (Math.max(w, h) < minW) return;
      var ar = Math.max(w, h) / Math.max(1e-9, Math.min(w, h));
      if (ar < 1.2 || ar > 2.2) return;
      // các đỉnh phải nằm ở góc (hình chữ nhật thẳng trục)
      for (i = 0; i < 4; i++) {
        var onX = Math.abs(p[i][0] - x0) < tol || Math.abs(p[i][0] - x1) < tol, onY = Math.abs(p[i][1] - y0) < tol || Math.abs(p[i][1] - y1) < tol;
        if (!onX || !onY) return;
      }
      rects.push([x0, y0, x1, y1]);
    });
    // bỏ khung nằm trong khung khác (viền trong của cùng một tờ)
    rects.sort(function (a, b) { return (b[2] - b[0]) * (b[3] - b[1]) - (a[2] - a[0]) * (a[3] - a[1]); });
    var sheets = [];
    rects.forEach(function (r) {
      var inside = sheets.some(function (s) { return r[0] >= s[0] - 1e-6 && r[1] >= s[1] - 1e-6 && r[2] <= s[2] + 1e-6 && r[3] <= s[3] + 1e-6; });
      if (!inside) sheets.push(r);
    });
    var titleRe = /m[ặa]t\s*b[ằa]ng|m[ặa]t\s*[đd][ứu]ng|m[ặa]t\s*c[ắa]t|chi\s*ti[ếe]t/i;
    var out = sheets.map(function (b) {
      var ts = texts.filter(function (t) { return t.x >= b[0] && t.x <= b[2] && t.y >= b[1] && t.y <= b[3]; });
      var best = null;
      ts.forEach(function (t) { if (titleRe.test(t.text) && (!best || (t.h || 0) > (best.h || 0))) best = t; });
      return { box: b, title: best ? best.text : '', texts: ts };
    });
    var rowTol = 5 / unitFactor;
    out.sort(function (p, q) { return Math.abs(q.box[3] - p.box[3]) > rowTol ? q.box[3] - p.box[3] : p.box[0] - q.box[0]; });
    return out;
  }

  function planKind(p) {
    var t = p.title || '';
    return /m[áa]i/i.test(t) && !/[áa]p\s*m[áa]i/i.test(t) ? 'roof' : 'floor';
  }

  // Chọn mặt bằng cho các tầng: tầng 1, 2, 3..., rồi áp mái, rồi tầng mái.
  // Với mỗi tầng ưu tiên tờ "bố trí cửa" (có ký hiệu cửa), rồi "tường xây", "kích thước", các tờ khác.
  function pickFloors(plans) {
    function prio(p) {
      var s = p.sheet || '';
      return /c[ửu]a/i.test(s) ? 0 : /t[ưu][ờo]ng\s*x[âa]y/i.test(s) ? 1 : /k[íi]ch\s*th/i.test(s) ? 2 : /n[ộo]i\s*th[ấa]t/i.test(s) ? 4 : 3;
    }
    function best(re) {
      var c = plans.filter(function (p) { return re.test(p.title || ''); });
      c.sort(function (a, b) { return prio(a) - prio(b); });
      return c[0] || null;
    }
    var out = [];
    for (var f = 1; f <= 30; f++) {
      var p = best(new RegExp('t[ầa]ng\\s*' + f + '(?![0-9])', 'i'));
      if (!p) break;
      out.push(p);
    }
    var attic = best(/[áa]p\s*m[áa]i/i);
    if (attic && out.length) out.push(attic);
    var roof = best(/(t[ầa]ng\s*m[áa]i|b[ằa]ng\s*m[áa]i)/i);
    if (roof && out.length && planKind(roof) === 'roof') out.push(roof);
    if (!out.length && plans.length) out.push(plans[0]);
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
  function planLevels(plans, chosen, texts, unitFactor) {
    var inside = function (t, b, m) { return t.x >= b[0] - m && t.x <= b[2] + m && t.y >= b[1] - m && t.y <= b[3] + m; };
    var m = 0.5 / unitFactor, freq = {};
    texts.forEach(function (t) {
      var v = coteOf(t.text); if (v === null) return;
      if (plans.some(function (p) { return p.title && inside(t, p.box, m); })) return;
      freq[v.toFixed(3)] = (freq[v.toFixed(3)] || 0) + 1;
    });
    return chosen.map(function (p) {
      var local = {};
      texts.forEach(function (t) { var v = coteOf(t.text); if (v !== null && inside(t, p.box, m)) local[v.toFixed(3)] = (local[v.toFixed(3)] || 0) + 1; });
      var best = null, bs = -1;
      Object.keys(local).forEach(function (k) { var sc = (freq[k] || 0) * 100 + local[k]; if ((freq[k] || 0) > 0 && sc > bs) { bs = sc; best = +k; } });
      if (best === null && Object.keys(local).length === 1) best = +Object.keys(local)[0];
      return best;
    });
  }

  function inBox(e, b, m) {
    var cx = 0, cy = 0, n = e.pts.length;
    for (var i = 0; i < n; i++) { cx += e.pts[i][0]; cy += e.pts[i][1]; }
    cx /= n; cy /= n;
    return cx >= b[0] - m && cx <= b[2] + m && cy >= b[1] - m && cy <= b[3] + m;
  }

  return { convert: convert, findPlans: findPlans, findSheets: findSheets, pickFloors: pickFloors, planKind: planKind, planLevels: planLevels, inBox: inBox, cleanText: cleanText };
});
