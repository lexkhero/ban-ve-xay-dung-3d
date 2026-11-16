/* core.js - Lõi chuyển bản vẽ 2D (DXF / PDF vector / ảnh) thành khối 3D.
 * Không phụ thuộc thư viện ngoài, chạy được cả trong trình duyệt lẫn Node.
 * Hệ trục: X, Y nằm trên mặt bằng, Z hướng lên, đơn vị mét. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var D2R = Math.PI / 180;

  var DEFAULTS = {
    unitFactor: 1,       // hệ số đổi đơn vị bản vẽ sang mét
    wallH: 3.0,          // chiều cao tường / tầng (m)
    floors: 1,
    mode: 'double',      // 'double' = tường vẽ hai nét song song, 'center' = một nét tim tường
    centerT: 0.2,        // bề dày khi vẽ một nét (m)
    tMin: 0.07,          // bề dày tường nhỏ nhất khi ghép hai nét (m)
    tMax: 0.45,          // bề dày tường lớn nhất khi ghép hai nét (m)
    doorH: 2.1,
    winSill: 0.9,
    winH: 1.2,
    slabT: 0.15,
    autoSlab: true,
    roof: false,
    roofT: 0.12,
    overhang: 0.3,
    glass: true,
    inferOpenings: true, // tự nhận khe hở giữa hai đoạn tường là ô cửa
    gapMin: 0.5,         // khe nhỏ hơn: coi là tường liền
    gapMax: 4.5,
    gapDoorMax: 1.6,     // khe không có ký hiệu, rộng tới mức này coi là cửa đi; rộng hơn để trống
    autoAlign: true,
    fence: true,         // tường tách rời khỏi nhà ở tầng 1 coi là tường rào
    fenceH: 1.8,
    eaveRise: 0,         // mép mái cao hơn sàn tầng ngay dưới mái (m)
    stairs: true,
    roles: {}
  };

  var MATERIALS = {
    wall:   { name: 'Tuong',  color: [0.92, 0.90, 0.86, 1.0], dxfLayer: '3D_TUONG', aci: 9 },
    glass:  { name: 'Kinh',   color: [0.55, 0.75, 0.90, 0.35], dxfLayer: '3D_KINH', aci: 4 },
    slab:   { name: 'San',    color: [0.62, 0.62, 0.60, 1.0], dxfLayer: '3D_SAN', aci: 8 },
    column: { name: 'Cot',    color: [0.80, 0.74, 0.68, 1.0], dxfLayer: '3D_COT', aci: 30 },
    roof:   { name: 'Mai',    color: [0.62, 0.30, 0.22, 1.0], dxfLayer: '3D_MAI', aci: 12 },
    stair:  { name: 'CauThang', color: [0.78, 0.74, 0.68, 1.0], dxfLayer: '3D_CAUTHANG', aci: 33 },
    frame:  { name: 'KhungCua', color: [0.20, 0.21, 0.23, 1.0], dxfLayer: '3D_KHUNGCUA', aci: 250 },
    door:   { name: 'CanhCua', color: [0.52, 0.35, 0.22, 1.0], dxfLayer: '3D_CANHCUA', aci: 32 },
    rail:   { name: 'LanCan', color: [0.25, 0.26, 0.28, 1.0], dxfLayer: '3D_LANCAN', aci: 251 }
  };
  var GROUP_ORDER = ['wall', 'slab', 'column', 'stair', 'roof', 'frame', 'door', 'rail', 'glass'];

  /* ------------------------------------------------------------------ */
  /* Tiện ích                                                            */
  /* ------------------------------------------------------------------ */
  function stripAccents(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  }

  function robustRange(arr) {
    if (!arr.length) return [0, 0];
    var a = arr.slice().sort(function (p, q) { return p - q; });
    var n = a.length;
    if (n < 60) return [a[0], a[n - 1]];
    return [a[Math.floor(n * 0.01)], a[Math.ceil(n * 0.99) - 1]];
  }

  function polyArea(p) {
    var s = 0;
    for (var i = 0; i < p.length; i++) {
      var a = p[i], b = p[(i + 1) % p.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  }

  function cleanPoly(p) {
    var out = [];
    for (var i = 0; i < p.length; i++) {
      var q = p[i], l = out[out.length - 1];
      if (!l || Math.abs(q[0] - l[0]) > 1e-9 || Math.abs(q[1] - l[1]) > 1e-9) out.push(q);
    }
    if (out.length > 1) {
      var f = out[0], e = out[out.length - 1];
      if (Math.abs(f[0] - e[0]) <= 1e-9 && Math.abs(f[1] - e[1]) <= 1e-9) out.pop();
    }
    return out;
  }

  function convexHull(pts) {
    var p = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    if (p.length < 3) return p;
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], i;
    for (i = 0; i < p.length; i++) {
      while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p[i]) <= 0) lo.pop();
      lo.push(p[i]);
    }
    var up = [];
    for (i = p.length - 1; i >= 0; i--) {
      while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p[i]) <= 0) up.pop();
      up.push(p[i]);
    }
    lo.pop(); up.pop();
    return lo.concat(up);
  }

  /* ------------------------------------------------------------------ */
  /* Ma trận 2x3: x' = a x + c y + e ; y' = b x + d y + f                */
  /* ------------------------------------------------------------------ */
  var IDENT = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  function mmul(m1, m2) { // áp m2 trước, rồi m1
    return {
      a: m1.a * m2.a + m1.c * m2.b, b: m1.b * m2.a + m1.d * m2.b,
      c: m1.a * m2.c + m1.c * m2.d, d: m1.b * m2.c + m1.d * m2.d,
      e: m1.a * m2.e + m1.c * m2.f + m1.e, f: m1.b * m2.e + m1.d * m2.f + m1.f
    };
  }
  function mapt(m, p) { return [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f]; }

  /* ------------------------------------------------------------------ */
  /* Đọc DXF (ASCII)                                                     */
  /* ------------------------------------------------------------------ */
  function tokenize(text) {
    var lines = text.split(/\r?\n/), g = [], i = 0;
    while (i + 1 < lines.length) {
      var code = parseInt(lines[i].trim(), 10);
      if (isNaN(code)) { i++; continue; }
      g.push([code, lines[i + 1]]);
      i += 2;
    }
    return g;
  }

  function sectionsOf(g) {
    var out = {};
    for (var i = 0; i < g.length; i++) {
      if (g[i][0] === 0 && g[i][1].trim() === 'SECTION' && g[i + 1] && g[i + 1][0] === 2) {
        var name = g[i + 1][1].trim(), j = i + 2;
        while (j < g.length && !(g[j][0] === 0 && g[j][1].trim() === 'ENDSEC')) j++;
        out[name] = g.slice(i + 2, j);
        i = j;
      }
    }
    return out;
  }

  function splitEnts(groups) {
    var ents = [], cur = null;
    for (var i = 0; i < groups.length; i++) {
      if (groups[i][0] === 0) { cur = { type: groups[i][1].trim(), g: [] }; ents.push(cur); }
      else if (cur) cur.g.push(groups[i]);
    }
    return ents;
  }

  function gstr(e, code, def) {
    for (var i = 0; i < e.g.length; i++) if (e.g[i][0] === code) return String(e.g[i][1]).trim();
    return def === undefined ? '' : def;
  }
  function gnum(e, code, def) {
    for (var i = 0; i < e.g.length; i++) if (e.g[i][0] === code) { var v = parseFloat(e.g[i][1]); return isNaN(v) ? def : v; }
    return def;
  }

  function bulgeArc(a, b, bulge) {
    var dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d < 1e-12) return [];
    var th = 4 * Math.atan(bulge);
    var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    var k = (d / 2) / Math.tan(th / 2);
    var cx = mx + (-dy / d) * k, cy = my + (dx / d) * k;
    var r = Math.hypot(a.x - cx, a.y - cy);
    var a0 = Math.atan2(a.y - cy, a.x - cx);
    var n = Math.max(2, Math.ceil(Math.abs(th) / (10 * D2R)));
    var pts = [];
    for (var i = 1; i < n; i++) {
      var ang = a0 + th * i / n;
      pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
    }
    return pts;
  }

  function vertsToPts(vs, closed) {
    var pts = [], n = vs.length;
    for (var i = 0; i < n; i++) {
      var a = vs[i];
      pts.push([a.x, a.y]);
      if (a.b && (i < n - 1 || closed)) {
        var arc = bulgeArc(a, vs[(i + 1) % n], a.b);
        for (var k = 0; k < arc.length; k++) pts.push(arc[k]);
      }
    }
    return pts;
  }

  function arcPts(cx, cy, r, a0, a1) {
    var s = a0 * D2R, e = a1 * D2R;
    if (e <= s) e += 2 * Math.PI;
    var n = Math.max(4, Math.ceil((e - s) / (10 * D2R))), pts = [];
    for (var i = 0; i <= n; i++) {
      var a = s + (e - s) * i / n;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  function convertRaw(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i], layer = gstr(e, 8, '0'), t = e.type, j, vs;
      if (t === 'LINE') {
        out.push({ kind: 'poly', layer: layer, closed: false,
          pts: [[gnum(e, 10, 0), gnum(e, 20, 0)], [gnum(e, 11, 0), gnum(e, 21, 0)]] });
      } else if (t === 'LWPOLYLINE') {
        vs = []; var flags = 0;
        for (j = 0; j < e.g.length; j++) {
          var c = e.g[j][0], v = e.g[j][1];
          if (c === 10) vs.push({ x: parseFloat(v), y: 0, b: 0 });
          else if (c === 20 && vs.length) vs[vs.length - 1].y = parseFloat(v);
          else if (c === 42 && vs.length) vs[vs.length - 1].b = parseFloat(v);
          else if (c === 70) flags = parseInt(v, 10) || 0;
        }
        var cl = !!(flags & 1);
        if (vs.length >= 2) out.push({ kind: 'poly', layer: layer, closed: cl, pts: vertsToPts(vs, cl) });
      } else if (t === 'POLYLINE') {
        var pf = gnum(e, 70, 0);
        vs = [];
        j = i + 1;
        while (j < list.length && list[j].type === 'VERTEX') {
          var ve = list[j];
          if (!(gnum(ve, 70, 0) & 16)) vs.push({ x: gnum(ve, 10, 0), y: gnum(ve, 20, 0), b: gnum(ve, 42, 0) });
          j++;
        }
        if (j < list.length && list[j].type === 'SEQEND') j++;
        i = j - 1;
        if (vs.length >= 2 && !(pf & (16 | 64))) {
          var pc = !!(pf & 1);
          out.push({ kind: 'poly', layer: layer, closed: pc, pts: vertsToPts(vs, pc) });
        }
      } else if (t === 'ARC') {
        out.push({ kind: 'poly', layer: layer, closed: false,
          pts: arcPts(gnum(e, 10, 0), gnum(e, 20, 0), gnum(e, 40, 0), gnum(e, 50, 0), gnum(e, 51, 360)) });
      } else if (t === 'CIRCLE') {
        var cx = gnum(e, 10, 0), cy = gnum(e, 20, 0), r = gnum(e, 40, 0), cp = [];
        for (var k = 0; k < 24; k++) cp.push([cx + r * Math.cos(k * Math.PI / 12), cy + r * Math.sin(k * Math.PI / 12)]);
        out.push({ kind: 'poly', layer: layer, closed: true, pts: cp });
      } else if (t === 'SOLID') {
        var p1 = [gnum(e, 10, 0), gnum(e, 20, 0)], p2 = [gnum(e, 11, 0), gnum(e, 21, 0)],
            p3 = [gnum(e, 12, 0), gnum(e, 22, 0)], p4 = [gnum(e, 13, 0), gnum(e, 23, 0)];
        out.push({ kind: 'poly', layer: layer, closed: true, pts: [p1, p2, p4, p3] });
      } else if (t === 'TEXT' || t === 'MTEXT') {
        var txt = '';
        for (j = 0; j < e.g.length; j++) if (e.g[j][0] === 1 || e.g[j][0] === 3) txt += e.g[j][1];
        out.push({ kind: 'text', layer: layer, text: txt, x: gnum(e, 10, 0), y: gnum(e, 20, 0), h: gnum(e, 40, 0) });
      } else if (t === 'INSERT') {
        out.push({ kind: 'insert', layer: layer, name: gstr(e, 2, ''),
          x: gnum(e, 10, 0), y: gnum(e, 20, 0), sx: gnum(e, 41, 1), sy: gnum(e, 42, 1), rot: gnum(e, 50, 0) });
      }
    }
    return out;
  }

  function insertMatrix(p, base) {
    var cs = Math.cos(p.rot * D2R), sn = Math.sin(p.rot * D2R);
    var m = { a: cs * p.sx, b: sn * p.sx, c: -sn * p.sy, d: cs * p.sy, e: 0, f: 0 };
    m.e = p.x - (m.a * base[0] + m.c * base[1]);
    m.f = p.y - (m.b * base[0] + m.d * base[1]);
    return m;
  }

  function cleanMText(s) {
    return String(s || '').replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;\\{}]*;/g, '').replace(/\\[LlOoKk]/g, '')
      .replace(/[{}]/g, '').replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/\s+/g, ' ').trim();
  }

  function parseDXF(text) {
    var g = tokenize(text), sec = sectionsOf(g);
    if (!sec.ENTITIES) throw new Error('Không tìm thấy vùng ENTITIES. Đây có thể là DXF dạng nhị phân hoặc tệp không hợp lệ.');
    var insunits = 0;
    if (sec.HEADER) {
      for (var i = 0; i < sec.HEADER.length; i++) {
        if (sec.HEADER[i][0] === 9 && sec.HEADER[i][1].trim() === '$INSUNITS' && sec.HEADER[i + 1]) {
          insunits = parseInt(sec.HEADER[i + 1][1], 10) || 0;
        }
      }
    }
    var blocks = {}, cur = null;
    if (sec.BLOCKS) {
      var bl = splitEnts(sec.BLOCKS);
      for (var b = 0; b < bl.length; b++) {
        if (bl[b].type === 'BLOCK') cur = blocks[gstr(bl[b], 2, '')] = { base: [gnum(bl[b], 10, 0), gnum(bl[b], 20, 0)], raw: [] };
        else if (bl[b].type === 'ENDBLK') cur = null;
        else if (cur) cur.raw.push(bl[b]);
      }
    }
    var ents = [], texts = [], counter = 0;
    function expand(raw, M, override, grp, depth) {
      var prims = convertRaw(raw);
      for (var k = 0; k < prims.length; k++) {
        var p = prims[k];
        if (p.kind === 'text') {
          if (depth === 0) {
            var tp = mapt(M, [p.x, p.y]);
            texts.push({ text: cleanMText(p.text), x: tp[0], y: tp[1], h: p.h, layer: p.layer });
          }
        } else if (p.kind === 'poly') {
          var layer = (p.layer === '0' && override) ? override : p.layer;
          ents.push({ layer: layer, closed: p.closed, grp: grp,
            pts: p.pts.map(function (q) { return mapt(M, q); }) });
        } else {
          var blk = blocks[p.name];
          if (!blk || depth > 5) continue;
          var ov = p.layer !== '0' ? p.layer : override;
          expand(blk.raw, mmul(M, insertMatrix(p, blk.base)), ov, grp === null ? ++counter : grp, depth + 1);
        }
      }
    }
    expand(splitEnts(sec.ENTITIES), IDENT, null, null, 0);
    var layers = {};
    for (var q = 0; q < ents.length; q++) {
      var l = layers[ents[q].layer] || (layers[ents[q].layer] = { n: 0 });
      l.n++;
    }
    return { ents: ents, layers: layers, insunits: insunits, texts: texts };
  }

  /* ------------------------------------------------------------------ */
  /* Gợi ý vai trò layer và đơn vị                                       */
  /* ------------------------------------------------------------------ */
  function guessRole(name) {
    // bỏ tiền tố số thứ tự ("1 - ") và hậu tố nhóm ("GR", mã màu "7. WW") thường gặp trong bản vẽ Việt Nam
    var s = stripAccents(name).toLowerCase().replace(/^\s*\d+\s*-\s*/, '').replace(/[_]/g, ' ').trim();
    if (/(hatch.?mai|(^|[^a-z])mai ?(ngoi|ton|doc)|(^|[^a-z])roof)/.test(s) && !/ap ?mai/.test(s)) return 'roof';
    if (/(^|[^a-z])(dim|text|txt|hatch|hacth|grid|truc|defpoints|kich ?thuoc|chu|ghi ?chu|note|furn|noi ?that|do ?dung|anno|tieu ?de|khung|title|viewport|vport|axis|center|tim|ky ?hieu|ki ?hieu|thiet ?bi|leader|cay|san ?vuon|dien|den|ong|chi ?gioi|ranh ?gioi|khuat|thay|level)([^a-z]|$)/.test(s)) return 'ignore';
    if (/(net[ -]?cat|^cat).*(be ?tong|btct|cot)|be ?tong.*cat|(^|[^a-z])(cot|column|col)([^a-z]|$)/.test(s)) return 'column';
    if (/net[ -]?cat.*san|san.*cat/.test(s)) return 'ignore';
    if (/(cua ?so|window|glaz|\bwin\b|^wd|cua ?kinh)/.test(s)) return 'window';
    if (/(cua ?di|cua ?chinh|door|^dr\b|\bdr[^a-z])/.test(s)) return 'door';
    if (/(^|[^a-z])cua([^a-z]|$)|cua-/.test(s)) return 'opening';
    if (/(tuong|wall|^wal|net[ -]?cat|^net[ -]?cat|^cat\b)/.test(s)) return 'wall';
    if (/(^|[^a-z])(san|floor|slab|flr)([^a-z]|$)/.test(s)) return 'slab';
    return 'ignore';
  }

  var UNIT_MAP = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 14: 0.1 };

  function autoUnit(ents, insunits, roles) {
    var xs = [], ys = [], i, j;
    var hasWall = ents.some(function (e) { return roles[e.layer] === 'wall'; });
    function useAll(all) {
      xs = []; ys = [];
      for (i = 0; i < ents.length; i++) {
        var r = roles[ents[i].layer];
        if (!all && (hasWall ? r !== 'wall' : (!r || r === 'ignore'))) continue;
        for (j = 0; j < ents[i].pts.length; j++) { xs.push(ents[i].pts[j][0]); ys.push(ents[i].pts[j][1]); }
      }
    }
    useAll(false);
    if (!xs.length) useAll(true);
    var rx = robustRange(xs), ry = robustRange(ys);
    var D = Math.max(rx[1] - rx[0], ry[1] - ry[0]);
    var f = UNIT_MAP[insunits];
    if (f) {
      var m = D * f;
      if (m >= 2 && m <= 400) return { factor: f, source: 'header' };
    }
    return { factor: D >= 2000 ? 0.001 : (D >= 150 ? 0.01 : 1), source: 'guess' };
  }

  /* ------------------------------------------------------------------ */
  /* Tam giác hoá và lăng trụ                                            */
  /* ------------------------------------------------------------------ */
  function pointInTri(p, a, b, c) {
    if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === b[0] && p[1] === b[1]) || (p[0] === c[0] && p[1] === c[1])) return false;
    var d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
    var d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
    var d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
    var neg = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12;
    var pos = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12;
    return !(neg && pos) && Math.abs(d1) > 1e-12 && Math.abs(d2) > 1e-12 && Math.abs(d3) > 1e-12;
  }

  function triangulate(poly) { // poly CCW, không lặp điểm đầu
    var n = poly.length, i;
    if (n < 3) return [];
    if (n === 3) return [0, 1, 2];
    var idx = []; for (i = 0; i < n; i++) idx.push(i);
    var tris = [], guard = 0;
    while (idx.length > 3 && guard++ < 100000) {
      var clipped = false, minAbs = Infinity, minAt = 0;
      for (i = 0; i < idx.length; i++) {
        var ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
        var a = poly[ia], b = poly[ib], c = poly[ic];
        var cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (Math.abs(cr) < minAbs) { minAbs = Math.abs(cr); minAt = i; }
        if (cr <= 1e-12) continue;
        var ok = true;
        for (var k = 0; k < idx.length; k++) {
          var q = idx[k];
          if (q === ia || q === ib || q === ic) continue;
          if (pointInTri(poly[q], a, b, c)) { ok = false; break; }
        }
        if (!ok) continue;
        tris.push(ia, ib, ic);
        idx.splice(i, 1);
        clipped = true;
        break;
      }
      if (!clipped) idx.splice(minAt, 1); // đỉnh suy biến: bỏ qua
    }
    if (idx.length === 3) tris.push(idx[0], idx[1], idx[2]);
    return tris;
  }

  function newGroup() { return { pos: [], nor: [], idx: [] }; }

  function addPrism(g, poly, z0, z1) {
    var p = cleanPoly(poly);
    if (p.length < 3 || z1 - z0 < 1e-6) return;
    if (polyArea(p) < 0) p.reverse();
    if (Math.abs(polyArea(p)) < 1e-8) return;
    var tri = triangulate(p), i, base;
    base = g.pos.length / 3;
    for (i = 0; i < p.length; i++) { g.pos.push(p[i][0], p[i][1], z1); g.nor.push(0, 0, 1); }
    for (i = 0; i < tri.length; i += 3) g.idx.push(base + tri[i], base + tri[i + 1], base + tri[i + 2]);
    base = g.pos.length / 3;
    for (i = 0; i < p.length; i++) { g.pos.push(p[i][0], p[i][1], z0); g.nor.push(0, 0, -1); }
    for (i = 0; i < tri.length; i += 3) g.idx.push(base + tri[i], base + tri[i + 2], base + tri[i + 1]);
    for (i = 0; i < p.length; i++) {
      var a = p[i], b = p[(i + 1) % p.length];
      var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (L < 1e-9) continue;
      var nx = dy / L, ny = -dx / L;
      base = g.pos.length / 3;
      g.pos.push(a[0], a[1], z0, b[0], b[1], z0, b[0], b[1], z1, a[0], a[1], z1);
      for (var k = 0; k < 4; k++) g.nor.push(nx, ny, 0);
      g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Tường: ghép hai nét song song thành tấm tường                       */
  /* ------------------------------------------------------------------ */
  function edgesOf(pts, closed, out) {
    var n = pts.length, last = closed ? n : n - 1;
    for (var i = 0; i < last; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-4) out.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1] });
    }
  }

  // Gom các phần tử theo hướng (góc), có xử lý chỗ nối -90/+90 độ
  function clusterByAngle(items, tol) {
    if (!items.length) return [];
    items.sort(function (a, b) { return a.ang - b.ang; });
    var clusters = [], cl = [items[0]], i;
    for (i = 1; i < items.length; i++) {
      if (items[i].ang - items[i - 1].ang < tol) cl.push(items[i]);
      else { clusters.push(cl); cl = [items[i]]; }
    }
    clusters.push(cl);
    if (clusters.length > 1) {
      var f = clusters[0], l = clusters[clusters.length - 1];
      if (f[0].ang + Math.PI - l[l.length - 1].ang < tol) { clusters[0] = l.concat(f); clusters.pop(); }
    }
    return clusters;
  }

  function canonDir(ux, uy) {
    if (ux < -1e-4 || (Math.abs(ux) <= 1e-4 && uy < 0)) return [-ux, -uy];
    return [ux, uy];
  }

  function pairWalls(segs, tmin, tmax) {
    var items = [], i;
    for (i = 0; i < segs.length; i++) {
      var s = segs[i], dx = s.x1 - s.x0, dy = s.y1 - s.y0, L = Math.hypot(dx, dy);
      if (L < 0.12) continue;
      var u = canonDir(dx / L, dy / L);
      items.push({ x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, ux: u[0], uy: u[1], L: L, ang: Math.atan2(u[1], u[0]) });
    }
    var rects = [], minOv = 0.1;
    clusterByAngle(items, 0.003).forEach(function (c) {
      var ux = c[0].ux, uy = c[0].uy, nx = -uy, ny = ux, list = [];
      c.forEach(function (it) {
        var oA = nx * it.x0 + ny * it.y0, oB = nx * it.x1 + ny * it.y1;
        if (Math.abs(oA - oB) > 0.03 + 0.002 * it.L) return;
        var sA = ux * it.x0 + uy * it.y0, sB = ux * it.x1 + uy * it.y1;
        list.push({ o: (oA + oB) / 2, s0: Math.min(sA, sB), s1: Math.max(sA, sB) });
      });
      list.sort(function (a, b) { return a.o - b.o; });
      for (var a = 0; a < list.length; a++) {
        var I = list[a];
        for (var b = a + 1; b < list.length; b++) {
          var J = list[b], d = J.o - I.o;
          if (d > tmax + 0.02) break;
          if (d < tmin) continue;
          var ovLo = Math.max(I.s0, J.s0), ovHi = Math.min(I.s1, J.s1);
          if (ovHi - ovLo < minOv) continue;
          // Bỏ cặp nếu có nét khác nằm giữa hai nét và che phần lớn đoạn chung
          var blocked = false;
          for (var k = a + 1; k < b && !blocked; k++) {
            var K = list[k];
            if (K.o <= I.o + 0.02 || K.o >= J.o - 0.02) continue;
            var cov = Math.min(K.s1, ovHi) - Math.max(K.s0, ovLo);
            if (cov >= 0.5 * (ovHi - ovLo)) blocked = true;
          }
          if (blocked) continue;
          var lo = Math.max(Math.min(I.s0, J.s0), ovLo - d), hi = Math.min(Math.max(I.s1, J.s1), ovHi + d);
          var oc = (I.o + J.o) / 2;
          rects.push({ x: nx * oc + ux * lo, y: ny * oc + uy * lo, ux: ux, uy: uy, len: hi - lo, t: d });
        }
      }
    });
    return rects;
  }

  function segsToRects(segs, t) {
    var out = [];
    segs.forEach(function (s) {
      var dx = s.x1 - s.x0, dy = s.y1 - s.y0, L = Math.hypot(dx, dy);
      if (L < 0.1) return;
      var ux = dx / L, uy = dy / L;
      out.push({ x: s.x0 - ux * t / 2, y: s.y0 - uy * t / 2, ux: ux, uy: uy, len: L + t, t: t });
    });
    return out;
  }

  // Chia các tấm tường thành từng "đường" thẳng hàng (cùng hướng, cùng tim, cùng bề dày gần nhau)
  function wallLines(rects) {
    var R = rects.map(function (r) {
      var u = canonDir(r.ux, r.uy), x = r.x, y = r.y;
      if (u[0] !== r.ux || u[1] !== r.uy) { x += r.ux * r.len; y += r.uy * r.len; }
      return { src: r, x: x, y: y, ux: u[0], uy: u[1], len: r.len, t: r.t, ops: r.ops, ang: Math.atan2(u[1], u[0]) };
    });
    var lines = [];
    clusterByAngle(R, 0.004).forEach(function (c) {
      var ux = c[0].ux, uy = c[0].uy;
      c.forEach(function (r) {
        r.o = -uy * r.x + ux * r.y;
        r.s0 = r.x * ux + r.y * uy;
        r.s1 = r.s0 + r.len * (r.ux * ux + r.uy * uy);
        if (r.s1 < r.s0) { var t = r.s0; r.s0 = r.s1; r.s1 = t; }
      });
      c.sort(function (a, b) { return a.o - b.o; });
      var cur = [c[0]];
      for (var k = 1; k < c.length; k++) {
        if (c[k].o - c[k - 1].o < 0.03) cur.push(c[k]);
        else { lines.push({ ux: ux, uy: uy, items: cur }); cur = [c[k]]; }
      }
      lines.push({ ux: ux, uy: uy, items: cur });
    });
    lines.forEach(function (L) { L.items.sort(function (a, b) { return a.s0 - b.s0; }); });
    return lines;
  }

  function mergeRects(rects, gap) {
    if (!rects.length) return [];
    var out = [];
    wallLines(rects).forEach(function (L) {
      var ux = L.ux, uy = L.uy, m = null;
      function flush() {
        if (!m) return;
        var o = m.osum / m.n;
        out.push({ x: -uy * o + ux * m.s0, y: ux * o + uy * m.s0, ux: ux, uy: uy, len: m.s1 - m.s0, t: m.t });
      }
      L.items.forEach(function (r) {
        if (m && Math.abs(r.t - m.t) < 0.03 && r.s0 - m.s1 <= gap) {
          m.s1 = Math.max(m.s1, r.s1); m.osum += r.o; m.n++;
        } else { flush(); m = { s0: r.s0, s1: r.s1, t: r.t, osum: r.o, n: 1 }; }
      });
      flush();
    });
    return out.filter(function (r) { return r.len >= 0.1; });
  }

  /* ------------------------------------------------------------------ */
  /* Ô cửa                                                               */
  /* ------------------------------------------------------------------ */
  function bboxOf(pts) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i][0] < x0) x0 = pts[i][0]; if (pts[i][0] > x1) x1 = pts[i][0];
      if (pts[i][1] < y0) y0 = pts[i][1]; if (pts[i][1] > y1) y1 = pts[i][1];
    }
    return [x0, y0, x1, y1];
  }

  // Gộp các khung bao chạm nhau thành một khối (dùng cho cửa và cột)
  function clusterBoxes(list, tol) {
    var boxes = [], byGrp = {};
    list.forEach(function (e) {
      var bb = bboxOf(e.pts);
      if (e.grp !== null && e.grp !== undefined) {
        var g = byGrp[e.grp];
        if (!g) { byGrp[e.grp] = bb.slice(); boxes.push(byGrp[e.grp]); }
        else { g[0] = Math.min(g[0], bb[0]); g[1] = Math.min(g[1], bb[1]); g[2] = Math.max(g[2], bb[2]); g[3] = Math.max(g[3], bb[3]); }
      } else boxes.push(bb);
    });
    // Lưới băm để tránh O(n^2) khi có nhiều hộp
    var n = boxes.length, par = new Int32Array(n), i, j;
    for (i = 0; i < n; i++) par[i] = i;
    function find(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
    var order = []; for (i = 0; i < n; i++) order.push(i);
    order.sort(function (a, b) { return boxes[a][0] - boxes[b][0]; });
    for (var oi = 0; oi < n; oi++) {
      var a = boxes[order[oi]];
      for (var oj = oi + 1; oj < n; oj++) {
        var b = boxes[order[oj]];
        if (b[0] - tol > a[2]) break;
        if (a[1] - tol <= b[3] && b[1] - tol <= a[3]) par[find(order[oi])] = find(order[oj]);
      }
    }
    var merged = {};
    for (i = 0; i < n; i++) {
      var r = find(i), m = merged[r], bb = boxes[i];
      if (!m) merged[r] = bb.slice();
      else { m[0] = Math.min(m[0], bb[0]); m[1] = Math.min(m[1], bb[1]); m[2] = Math.max(m[2], bb[2]); m[3] = Math.max(m[3], bb[3]); }
    }
    // Hộp có thể đã chồng lên nhau sau khi gộp: lặp gộp tiếp
    var res = Object.keys(merged).map(function (k) { return merged[k]; });
    for (var pass = 0; pass < 3; pass++) {
      var changed = false;
      for (i = 0; i < res.length; i++) {
        for (j = i + 1; j < res.length; j++) {
          var p = res[i], q = res[j];
          if (p[0] - tol <= q[2] && q[0] - tol <= p[2] && p[1] - tol <= q[3] && q[1] - tol <= p[3]) {
            p[0] = Math.min(p[0], q[0]); p[1] = Math.min(p[1], q[1]); p[2] = Math.max(p[2], q[2]); p[3] = Math.max(p[3], q[3]);
            res.splice(j, 1); j--; changed = true;
          }
        }
      }
      if (!changed) break;
    }
    return res;
  }

  function clusterOpenings(list) {
    return clusterBoxes(list, 0.03).filter(function (b) {
      var w = b[2] - b[0], h = b[3] - b[1];
      return Math.max(w, h) >= 0.3 && Math.max(w, h) <= 4.5;
    });
  }

  function assignOpening(rects, bb, kind) {
    var best = -1, bestArea = 1e-4, bestIv = null, k;
    var corners = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]];
    for (k = 0; k < rects.length; k++) {
      var r = rects[k], nx = -r.uy, ny = r.ux;
      var smin = Infinity, smax = -Infinity, pmin = Infinity, pmax = -Infinity;
      for (var c = 0; c < 4; c++) {
        var dx = corners[c][0] - r.x, dy = corners[c][1] - r.y;
        var s = dx * r.ux + dy * r.uy, p = dx * nx + dy * ny;
        if (s < smin) smin = s; if (s > smax) smax = s;
        if (p < pmin) pmin = p; if (p > pmax) pmax = p;
      }
      var ds = Math.min(smax, r.len) - Math.max(smin, 0);
      var dp = Math.min(pmax, r.t / 2) - Math.max(pmin, -r.t / 2);
      if (ds <= 0 || dp <= 0) continue;
      var area = ds * dp;
      if (area > bestArea) { bestArea = area; best = k; bestIv = [Math.max(smin, 0), Math.min(smax, r.len)]; }
    }
    if (best < 0 || bestIv[1] - bestIv[0] < 0.3) return false;
    (rects[best].ops || (rects[best].ops = [])).push({ s0: bestIv[0], s1: bestIv[1], kind: kind });
    return true;
  }

  function inRect(r, px, py, m) {
    var dx = px - r.x, dy = py - r.y, s = dx * r.ux + dy * r.uy, p = -dx * r.uy + dy * r.ux;
    return s >= -m && s <= r.len + m && Math.abs(p) <= r.t / 2 + m;
  }

  // Khe hở giữa hai tấm tường thẳng hàng -> ô cửa. Phân loại theo ký hiệu nét mảnh quanh khe.
  function inferOpenings(rects, evid, colBoxes, cfg, tags) {
    var segs = [], curves = [], found = { door: 0, window: 0, open: 0, list: [] };
    evid.forEach(function (it) {
      edgesOf(it.pts, it.closed, segs);
      if (!it.closed && it.pts.length >= 6) curves.push(it.pts);
    });
    var add = [];
    wallLines(rects).forEach(function (L) {
      var ux = L.ux, uy = L.uy, nx = -uy, ny = ux;
      for (var i = 0; i + 1 < L.items.length; i++) {
        var A = L.items[i], B = L.items[i + 1];
        if (Math.abs(A.t - B.t) > 0.03) continue;
        var g0 = A.s1, g1 = B.s0, gap = g1 - g0;
        if (gap < cfg.gapMin || gap > cfg.gapMax) continue;
        var o = (A.o + B.o) / 2, t = Math.max(A.t, B.t), sm = (g0 + g1) / 2;
        var mx = nx * o + ux * sm, my = ny * o + uy * sm;
        var crossed = rects.some(function (r) { return r !== A.src && r !== B.src && inRect(r, mx, my, 0.02); });
        if (crossed) continue;
        if (colBoxes.some(function (b) { return mx >= b[0] - 0.05 && mx <= b[2] + 0.05 && my >= b[1] - 0.05 && my <= b[3] + 0.05; })) continue;
        // Ký hiệu cửa sổ: các nét song song tường nằm trong bề dày tường, dài gần bằng khe
        var par = 0;
        segs.forEach(function (s) {
          var a0 = (s.x0 * ux + s.y0 * uy), a1 = (s.x1 * ux + s.y1 * uy);
          var p0 = (s.x0 * nx + s.y0 * ny) - o, p1 = (s.x1 * nx + s.y1 * ny) - o;
          if (Math.abs(p0 - p1) > 0.02) return;
          if (Math.abs(p0) > t / 2 + 0.06) return;
          var lo = Math.max(Math.min(a0, a1), g0 - 0.05), hi = Math.min(Math.max(a0, a1), g1 + 0.05);
          if (hi - lo >= 0.5 * gap) par++;
        });
        // Ký hiệu cửa đi: cung tròn có một đầu nằm trên mặt tường trong phạm vi khe và vươn ra khỏi tường
        // (cửa xếp nhiều cánh có nhiều cung, đầu cung không nhất thiết ở mép khe)
        var arc = curves.some(function (pts) {
          var tolE = 0.08 + 0.05 * gap, reach = 0;
          function onWall(p) {
            var s = p[0] * ux + p[1] * uy, q = p[0] * nx + p[1] * ny - o;
            return Math.abs(q) < t / 2 + 0.15 && s > g0 - tolE && s < g1 + tolE;
          }
          if (!onWall(pts[0]) && !onWall(pts[pts.length - 1])) return false;
          for (var k = 0; k < pts.length; k++) {
            var s2 = pts[k][0] * ux + pts[k][1] * uy, q2 = Math.abs(pts[k][0] * nx + pts[k][1] * ny - o);
            if (s2 < g0 - tolE || s2 > g1 + tolE) return false;
            if (q2 > reach) reach = q2;
          }
          return reach > t / 2 + Math.min(0.35, 0.25 * gap);
        });
        var kind = arc ? 'door' : par >= 2 ? 'window' : gap <= cfg.gapDoorMax ? 'door' : 'open';
        if (kind === 'open' && tags && tags.length) { var ti = nearestTag(tags, mx, my, 2.5); if (ti !== null) kind = tags[ti].kind; }
        found[kind]++;
        found.list.push({ x: mx, y: my, ux: ux, uy: uy, len: gap, t: t, kind: kind, why: arc ? 'cung cửa' : par >= 2 ? par + ' nét kính' : 'không ký hiệu' });
        if (kind === 'open') continue;
        add.push({ x: nx * o + ux * g0, y: ny * o + uy * g0, ux: ux, uy: uy, len: gap, t: t, inferred: kind,
          ops: [{ s0: 0, s1: gap, kind: kind }] });
      }
    });
    add.forEach(function (r) { rects.push(r); });
    return found;
  }

  /* ------------------------------------------------------------------ */
  /* Hiệu chỉnh tỉ lệ theo bề dày tường                                  */
  /* ------------------------------------------------------------------ */
  // Tìm bề dày tường phổ biến nhất (đơn vị gốc của bản vẽ). Dùng cho PDF in thu nhỏ.
  function wallThickness(ents, roles) {
    var pts = [], segs = [];
    ents.forEach(function (e) { if (roles[e.layer] === 'wall') pts.push(e); });
    if (!pts.length) return null;
    var xs = [], ys = [];
    pts.forEach(function (e) { e.pts.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); }); });
    var rx = robustRange(xs), ry = robustRange(ys), D = Math.max(rx[1] - rx[0], ry[1] - ry[0]);
    if (!(D > 0)) return null;
    var k = 20 / D; // chuẩn hoá: coi khối tường dài 20 đơn vị
    pts.forEach(function (e) { edgesOf(e.pts.map(function (p) { return [p[0] * k, p[1] * k]; }), e.closed, segs); });
    var rects = pairWalls(segs, 0.02, 0.9), hist = {}, total = 0;
    rects.forEach(function (r) { var b = Math.round(r.t / 0.01); hist[b] = (hist[b] || 0) + r.len; total += r.len; });
    var best = null, bestV = 0;
    Object.keys(hist).forEach(function (b) {
      var v = hist[b] + 0.5 * ((hist[+b - 1] || 0) + (hist[+b + 1] || 0));
      if (v > bestV) { bestV = v; best = +b; }
    });
    if (best === null) return null;
    // trung bình có trọng số quanh đỉnh
    var sw = 0, st = 0;
    rects.forEach(function (r) { if (Math.abs(r.t / 0.01 - best) <= 1.5) { sw += r.len; st += r.t * r.len; } });
    return { tRaw: (st / sw) / k, share: bestV / (total || 1), extentRaw: D };
  }

  /* ------------------------------------------------------------------ */
  /* Tự gán vai trò cho các nhóm nét của PDF                              */
  /* ------------------------------------------------------------------ */
  function guessPdfRoles(ents) {
    var groups = {};
    ents.forEach(function (e) {
      var g = groups[e.layer] || (groups[e.layer] = { n: 0, kind: e.kind, color: e.color, w: e.w || 0, ents: [] });
      g.n++; if (g.ents.length < 4000) g.ents.push(e);
    });
    var roles = {}, names = Object.keys(groups), wall = null, opening = null;
    names.forEach(function (n) { roles[n] = 'ignore'; });
    names.forEach(function (n) {
      var g = groups[n];
      if (g.kind !== 'S' || g.n < 8 || g.color === '#ffffff') return;
      if (!wall || g.w > groups[wall].w) wall = n;
    });
    if (wall) roles[wall] = 'wall';
    var th = wall ? wallThickness(ents, roles) : null;
    names.forEach(function (n) {
      var g = groups[n];
      if (n === wall || g.kind !== 'S' || g.n < 8 || g.color !== '#000000') return;
      if (!opening || g.w < groups[opening].w) opening = n;
    });
    if (opening) roles[opening] = 'opening';
    if (th) {
      names.forEach(function (n) {
        var g = groups[n];
        if (g.kind !== 'F' || g.n < 3 || g.color === '#ffffff') return;
        var boxes = clusterBoxes(g.ents, th.tRaw * 0.02), good = 0;
        boxes.forEach(function (b) {
          var w = b[2] - b[0], h = b[3] - b[1], mn = Math.min(w, h), mxv = Math.max(w, h);
          if (mn >= 0.6 * th.tRaw && mxv <= 5 * th.tRaw && mxv / Math.max(mn, 1e-9) <= 3) good++;
        });
        if (good >= 3 && good >= 0.5 * boxes.length) roles[n] = 'column';
      });
    }
    return { roles: roles, thickness: th };
  }


  // Bản vẽ CAD: nếu chưa có lớp cột, tìm lớp vùng tô (hatch) có nhiều ô gần vuông cỡ bề dày tường
  function suggestColumns(ents, roles, unitFactor) {
    var out = {};
    if (ents.filter(function (e) { return roles[e.layer] === 'column' && e.closed && e.pts.length >= 3; }).length >= 4) return out;
    var th = wallThickness(ents, roles), tRaw = th ? th.tRaw : 0.22 / unitFactor, byLayer = {};
    var noise = /(^|[^a-z])(dim|kich ?thuoc|ky ?hieu|ki ?hieu|thiet ?bi|text|chu|noi ?that|do ?dung|truc|den|dien|ong|cay|san ?vuon|leader|khung|tieu ?de)([^a-z]|$)/;
    ents.forEach(function (e) {
      if (e.kind !== 'F' || (roles[e.layer] || 'ignore') !== 'ignore') return;
      if (noise.test(stripAccents(e.layer).toLowerCase().replace(/^\s*\d+\s*-\s*/, ''))) return;
      (byLayer[e.layer] || (byLayer[e.layer] = [])).push(e);
    });
    Object.keys(byLayer).forEach(function (L) {
      var boxes = clusterBoxes(byLayer[L], tRaw * 0.02), good = 0;
      boxes.forEach(function (b) {
        var w = b[2] - b[0], h = b[3] - b[1], mn = Math.min(w, h), mx = Math.max(w, h);
        if (mn >= 0.6 * tRaw && mx <= 5 * tRaw && mx / Math.max(mn, 1e-9) <= 2.5) good++;
      });
      if (good >= 4 && good >= 0.25 * boxes.length) out[L] = 'column';
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Căn các tầng với nhau                                               */
  /* ------------------------------------------------------------------ */
  function voteOffset(A, B, tol) { // tìm (dx,dy) sao cho B + d ~ A
    if (A.length < 2 || B.length < 2) return null;
    function sample(P) { if (P.length <= 160) return P; var s = [], st = P.length / 160; for (var i = 0; i < 160; i++) s.push(P[Math.floor(i * st)]); return s; }
    A = sample(A); B = sample(B);
    var votes = {}, best = null, bestN = 0, i, j;
    for (i = 0; i < A.length; i++) {
      for (j = 0; j < B.length; j++) {
        var dx = A[i][0] - B[j][0], dy = A[i][1] - B[j][1], key = Math.round(dx / tol) + ',' + Math.round(dy / tol);
        var v = votes[key] = (votes[key] || 0) + 1;
        if (v > bestN) { bestN = v; best = [dx, dy]; }
      }
    }
    // tinh chỉnh: trung bình các cặp khớp
    var sx = 0, sy = 0, n = 0;
    for (j = 0; j < B.length; j++) {
      var bx = B[j][0] + best[0], by = B[j][1] + best[1], md = Infinity, mk = -1;
      for (i = 0; i < A.length; i++) { var d = Math.hypot(A[i][0] - bx, A[i][1] - by); if (d < md) { md = d; mk = i; } }
      if (md <= tol * 1.5) { sx += A[mk][0] - B[j][0]; sy += A[mk][1] - B[j][1]; n++; }
    }
    if (!n) return null;
    return { dx: sx / n, dy: sy / n, score: n, of: Math.min(A.length, B.length) };
  }

  function centersOf(boxes) { return boxes.map(function (b) { return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; }); }
  function rectEnds(rects) {
    var out = [];
    rects.forEach(function (r) { if (!r.inferred) { out.push([r.x, r.y]); out.push([r.x + r.ux * r.len, r.y + r.uy * r.len]); } });
    return out;
  }

  function alignLevels(ref, L) {
    var c = null, method = '';
    if (!L.rects.length && !L.colBoxes.length && ref.bubbles && L.bubbles && ref.bubbles.length >= 4 && L.bubbles.length >= 4) {
      c = voteOffset(ref.bubbles, L.bubbles, 0.08);
      if (c && c.score >= Math.max(4, 0.5 * c.of)) method = 'vòng tròn trục'; else c = null;
    }
    if (!c && ref.colBoxes.length >= 3 && L.colBoxes.length >= 3) {
      c = voteOffset(centersOf(ref.colBoxes), centersOf(L.colBoxes), 0.06);
      if (c && c.score >= Math.max(3, 0.4 * c.of)) method = 'cột'; else c = null;
    }
    if (!c) {
      c = voteOffset(rectEnds(ref.rects), rectEnds(L.rects), 0.05);
      if (c && c.score >= Math.max(3, 0.2 * c.of)) method = 'tường'; else c = null;
    }
    if (!c && ref.bubbles && L.bubbles && ref.bubbles.length >= 4 && L.bubbles.length >= 4) {
      c = voteOffset(ref.bubbles, L.bubbles, 0.08);
      if (c && c.score >= Math.max(4, 0.5 * c.of)) method = 'vòng tròn trục'; else c = null;
    }
    if (!c) return { dx: 0, dy: 0, method: 'không căn được' };
    return { dx: c.dx, dy: c.dy, method: method };
  }

  /* ------------------------------------------------------------------ */
  /* Lắp ráp mô hình                                                     */
  /* ------------------------------------------------------------------ */
  function expandHull(h, d) {
    var cx = 0, cy = 0;
    h.forEach(function (p) { cx += p[0]; cy += p[1]; });
    cx /= h.length; cy /= h.length;
    return h.map(function (p) {
      var dx = p[0] - cx, dy = p[1] - cy, L = Math.hypot(dx, dy) || 1;
      return [p[0] + dx / L * d, p[1] + dy / L * d];
    });
  }

  function newGroups() { var G = {}; GROUP_ORDER.forEach(function (k) { G[k] = newGroup(); }); return G; }

  function assemble(cfg, hullPts, slabPolys, colPolys, emitWalls) { // dùng cho chế độ ảnh
    var G = newGroups();
    var H = cfg.wallH, F = Math.max(1, cfg.floors | 0);
    var hull = hullPts.length >= 3 ? convexHull(hullPts) : null;
    for (var f = 0; f < F; f++) {
      var z0 = f * H;
      emitWalls(G, z0, z0 + H);
      colPolys.forEach(function (c) { addPrism(G.column, c, z0, z0 + H); });
      if (slabPolys.length) slabPolys.forEach(function (p) { addPrism(G.slab, p, z0 - cfg.slabT, z0); });
      else if (hull && (f > 0 || cfg.autoSlab)) addPrism(G.slab, hull, z0 - cfg.slabT, z0);
    }
    if (cfg.roof && hull) addPrism(G.roof, expandHull(hull, cfg.overhang), F * H, F * H + cfg.roofT);
    return G;
  }

  function finalize(G, extra) {
    var groups = [], mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], tris = 0;
    GROUP_ORDER.forEach(function (k) {
      var g = G[k];
      if (!g.idx.length) return;
      groups.push({ key: k, name: MATERIALS[k].name, color: MATERIALS[k].color, pos: g.pos, nor: g.nor, idx: g.idx });
      tris += g.idx.length / 3;
      if (k === 'frame' || k === 'door' || k === 'rail' || k === 'glass') return; // chi tiết cửa không tính vào kích thước phủ bì
      for (var i = 0; i < g.pos.length; i += 3) {
        for (var a = 0; a < 3; a++) { if (g.pos[i + a] < mn[a]) mn[a] = g.pos[i + a]; if (g.pos[i + a] > mx[a]) mx[a] = g.pos[i + a]; }
      }
    });
    if (!groups.length) { mn = [0, 0, 0]; mx = [1, 1, 1]; }
    var out = { groups: groups, bbox: mn.concat(mx), tris: tris };
    for (var k in extra) out[k] = extra[k];
    return out;
  }

  function rectPoly(r, s0, s1, p0, p1) {
    var nx = -r.uy, ny = r.ux;
    function pt(s, p) { return [r.x + r.ux * s + nx * p, r.y + r.uy * s + ny * p]; }
    return [pt(s0, p0), pt(s1, p0), pt(s1, p1), pt(s0, p1)];
  }

  // Khung và cánh cửa đi: 1 cánh (khe <= 1,3 m), 2 cánh, hoặc 4 cánh kính (khe > 2,6 m)
  function emitDoorDetail(G, r, s0, s1, za, zb, cfg) {
    var w = s1 - s0, fw = Math.min(0.05, w / 6), fd = Math.min(r.t + 0.02, 0.14) / 2, lt = 0.02;
    if (w < 0.4 || zb - za < 0.6) return;
    addPrism(G.frame, rectPoly(r, s0, s0 + fw, -fd, fd), za, zb);
    addPrism(G.frame, rectPoly(r, s1 - fw, s1, -fd, fd), za, zb);
    addPrism(G.frame, rectPoly(r, s0 + fw, s1 - fw, -fd, fd), zb - fw, zb);
    var n = w <= 1.3 ? 1 : w <= 2.6 ? 2 : 4, a = s0 + fw, b = s1 - fw, lw = (b - a) / n, glassDoor = n === 4 && cfg.glass;
    for (var i = 0; i < n; i++) {
      var l0 = a + i * lw + 0.004, l1 = a + (i + 1) * lw - 0.004;
      if (glassDoor) { // cánh khung nhôm kính
        var st = 0.06;
        addPrism(G.frame, rectPoly(r, l0, l0 + st, -lt, lt), za, zb - fw);
        addPrism(G.frame, rectPoly(r, l1 - st, l1, -lt, lt), za, zb - fw);
        addPrism(G.frame, rectPoly(r, l0 + st, l1 - st, -lt, lt), za, za + 0.1);
        addPrism(G.frame, rectPoly(r, l0 + st, l1 - st, -lt, lt), zb - fw - st, zb - fw);
        addPrism(G.glass, rectPoly(r, l0 + st, l1 - st, -0.006, 0.006), za + 0.1, zb - fw - st);
      } else {
        addPrism(G.door, rectPoly(r, l0, l1, -lt, lt), za + 0.01, zb - fw - 0.004);
        // tay nắm
        var hs = (n === 1 || i % 2 === 0) ? l1 - 0.09 : l0 + 0.05;
        if (n === 1) hs = l1 - 0.09;
        addPrism(G.frame, rectPoly(r, hs, hs + 0.04, -lt - 0.03, lt + 0.03), za + 1.0, za + 1.04);
      }
    }
  }
  // Khung, đố và kính cửa sổ
  function emitWindowDetail(G, r, s0, s1, za, zb, cfg) {
    var w = s1 - s0, h = zb - za, fw = Math.min(0.05, w / 6, h / 6), fd = Math.min(r.t, 0.1) / 2;
    if (w < 0.25 || h < 0.25) return false;
    addPrism(G.frame, rectPoly(r, s0, s0 + fw, -fd, fd), za, zb);
    addPrism(G.frame, rectPoly(r, s1 - fw, s1, -fd, fd), za, zb);
    addPrism(G.frame, rectPoly(r, s0 + fw, s1 - fw, -fd, fd), za, za + fw);
    addPrism(G.frame, rectPoly(r, s0 + fw, s1 - fw, -fd, fd), zb - fw, zb);
    var n = Math.max(1, Math.round(w / 0.75)), a = s0 + fw, b = s1 - fw, pw = (b - a) / n, mw = 0.02;
    for (var i = 1; i < n; i++) addPrism(G.frame, rectPoly(r, a + i * pw - mw, a + i * pw + mw, -fd * 0.7, fd * 0.7), za + fw, zb - fw);
    var zt = zb - fw;
    if (h > 1.9) { zt = za + h * 0.72; addPrism(G.frame, rectPoly(r, a, b, -fd * 0.7, fd * 0.7), zt - mw, zt + mw); } // đố ngang cho cửa cao
    if (cfg.glass) addPrism(G.glass, rectPoly(r, a, b, -0.006, 0.006), za + fw, zb - fw);
    // bệ cửa sổ nhô ra hai mặt tường
    if (za > 0.15) addPrism(G.frame, rectPoly(r, s0 - 0.03, s1 + 0.03, -r.t / 2 - 0.03, r.t / 2 + 0.03), za - 0.03, za);
    return true;
  }

  // info (không bắt buộc): { items: [], solids: [], li: số thứ tự tầng } để ghi danh mục cấu kiện cho việc xem kích thước và đi bộ
  function emitRect(G, r, z0, z1, cfg, info) {
    if (r.fence) z1 = Math.min(z1, z0 + cfg.fenceH);
    var H = z1 - z0, ops = (r.ops || []).slice().sort(function (a, b) { return a.s0 - b.s0; });
    var cursor = 0, h = r.t / 2, detail = cfg.detail !== false && !r.fence;
    function solid(s0, s1, za, zb) {
      if (s1 - s0 > 0.005 && zb - za > 0.005) {
        addPrism(G.wall, rectPoly(r, s0, s1, -h, h), z0 + za, z0 + zb);
        if (info && za < 1.0 && zb > 0.4) info.solids.push([r.x, r.y, r.ux, r.uy, s0, s1, r.t]);
      }
    }
    if (info && !r.inferred) info.items.push({ type: r.fence ? 'fence' : 'wall', li: info.li, x: r.x, y: r.y, ux: r.ux, uy: r.uy, len: r.len, t: r.t, z0: z0, z1: z1 });
    ops.forEach(function (o) {
      var s0 = Math.max(o.s0, cursor), s1 = o.s1;
      if (s1 - s0 < 0.05) return;
      solid(cursor, s0, 0, H);
      var bottom = o.sill !== undefined ? o.sill : (o.kind === 'door' ? 0 : cfg.winSill);
      var top = o.top !== undefined ? o.top : (o.kind === 'door' ? cfg.doorH : cfg.winSill + cfg.winH);
      bottom = Math.max(0, Math.min(bottom, H)); top = Math.max(bottom, Math.min(top, H));
      solid(s0, s1, 0, bottom);
      solid(s0, s1, top, H);
      if (top - bottom > 0.02) {
        var done = false;
        if (detail && o.kind === 'window') done = emitWindowDetail(G, r, s0, s1, z0 + bottom, z0 + top, cfg);
        if (detail && o.kind === 'door') emitDoorDetail(G, r, s0, s1, z0 + bottom, z0 + top, cfg);
        if (!done && o.kind === 'window' && cfg.glass) {
          var gt = Math.min(r.t, 0.05) / 2;
          addPrism(G.glass, rectPoly(r, s0, s1, -gt, gt), z0 + bottom, z0 + top);
        }
        if (info) {
          var sm = (s0 + s1) / 2;
          info.items.push({ type: o.kind, li: info.li, x: r.x + r.ux * sm, y: r.y + r.uy * sm, ux: r.ux, uy: r.uy, w: s1 - s0, t: r.t,
            z0: z0 + bottom, z1: z0 + top, sill: bottom, h: top - bottom, floorZ: z0, tag: o.tag || '', fence: !!r.fence,
            hSrc: o.top !== undefined ? 'tag' : 'default', wSrc: 'plan' });
        }
      }
      cursor = s1;
    });
    solid(cursor, r.len, 0, H);
  }

  /* ------------------------------------------------------------------ */
  /* Ký hiệu cửa: D1, S4... kèm kích thước 3550x2600 và cao độ +0.800     */
  /* ------------------------------------------------------------------ */
  var TAG_RE = /^(D|S|C|CS|CD|CĐ|DD|ĐĐ|W|DW)\s?-?\d{1,2}[A-Za-z]?$/i;
  var SIZE_RE = /^(\d{3,4})\s*[xX×*]\s*(\d{3,4})$/;
  var COTE_RE = /^[±+\-]\s?(\d+)[.,](\d{3})$/;
  function coteVal(s) {
    var m = COTE_RE.exec(String(s).trim()); if (!m) return null;
    var v = parseInt(m[1], 10) + parseInt(m[2], 10) / 1000;
    return /^\s*-/.test(s) ? -v : v;
  }
  // texts: [{text,x,y}] theo mét. Trả về danh sách ký hiệu {name,x,y,kind,w,h,sill,top}
  function readTags(texts) {
    var tags = [], sizes = [], cotes = [];
    texts.forEach(function (t) {
      var s = String(t.text).trim(), m;
      if (TAG_RE.test(s)) tags.push({ name: s.toUpperCase().replace(/\s|-/g, ''), x: t.x, y: t.y });
      else if ((m = SIZE_RE.exec(s))) sizes.push({ w: +m[1] / 1000, h: +m[2] / 1000, x: t.x, y: t.y });
      else { var v = coteVal(s); if (v !== null && v >= -0.1 && v <= 4) cotes.push({ v: v, x: t.x, y: t.y }); }
    });
    var table = {};
    tags.forEach(function (tg) {
      var near = function (list, r) { return list.map(function (q) { return { q: q, d: Math.hypot(q.x - tg.x, q.y - tg.y) }; }).filter(function (o) { return o.d <= r; }).sort(function (a, b) { return a.d - b.d; }); };
      var sz = near(sizes, 1.6)[0], cs = near(cotes, 2.0).slice(0, 2).map(function (o) { return o.q.v; });
      tg.kind = /^(D|DD|ĐĐ|CD|CĐ|DW)/.test(tg.name) ? 'door' : 'window';
      if (sz) { tg.w = sz.q.w; tg.h = sz.q.h; }
      if (cs.length === 2) { tg.sill = Math.min(cs[0], cs[1]); tg.top = Math.max(cs[0], cs[1]); }
      else if (cs.length === 1 && tg.h) { tg.top = cs[0]; tg.sill = Math.max(0, cs[0] - tg.h); }
      var e = table[tg.name] || (table[tg.name] = {});
      ['w', 'h', 'sill', 'top'].forEach(function (k) { if (tg[k] !== undefined && e[k] === undefined) e[k] = tg[k]; });
    });
    // ký hiệu lặp lại không ghi kích thước: lấy theo bảng cùng tên
    tags.forEach(function (tg) {
      var e = table[tg.name];
      ['w', 'h', 'sill', 'top'].forEach(function (k) { if (tg[k] === undefined && e[k] !== undefined) tg[k] = e[k]; });
      if (tg.kind === 'door') { if (tg.sill === undefined) tg.sill = 0; if (tg.top === undefined && tg.h) tg.top = tg.sill + tg.h; }
      if (tg.kind === 'window' && tg.top === undefined && tg.sill !== undefined && tg.h) tg.top = tg.sill + tg.h;
    });
    return tags;
  }
  // Tên phòng ghi trên mặt bằng: "PHÒNG KHÁCH 33m2", "P. NGỦ CON 14.8m2", "WC 1", "THỀM", "BẾP"...
  var ROOM_AREA_RE = /^(.{2,32}?)\s*[-:]?\s*(\d+(?:[.,]\d+)?)\s*m\s?[2²]$/i;
  var ROOM_NAME_RE = /^(PH[ÒO]NG|P\.|WC|B[ẾE]P|TH[ỀE]M|S[ẢA]NH|KHO|GARA|GA RA|BAN C[ÔO]NG|S[ÂA]N |S[ÂA]N$|LOGIA|L[ÔO] GIA|H[ÀA]NH LANG|GI[ẢA]I TR[ÍI]|TI[ỀE]N S[ẢA]NH|V[ỆE] SINH|T[ẮA]M|TH[ỜO])/i;
  function readRooms(texts) {
    var out = [];
    texts.forEach(function (t) {
      var s = String(t.text).replace(/\s+/g, ' ').trim(), m;
      if (s.length < 2 || s.length > 40 || /M[ẶA]T B[ẰA]NG|CHI TI[ẾE]T|M[ẶA]T C[ẮA]T|M[ẶA]T [ĐD][ỨU]NG|GHI CH[ÚU]|K[ÝY] HI[ỆE]U|C[ỬU]A/i.test(s)) return;
      if ((m = ROOM_AREA_RE.exec(s))) out.push({ name: m[1].trim(), area: parseFloat(m[2].replace(',', '.')), x: t.x, y: t.y });
      else if (ROOM_NAME_RE.test(s) && !/\d{3,}/.test(s)) out.push({ name: s, x: t.x, y: t.y });
    });
    // bỏ nhãn trùng (cùng tên, cách nhau < 1 m)
    return out.filter(function (a, i) { return !out.some(function (b, j) { return j < i && b.name === a.name && Math.hypot(a.x - b.x, a.y - b.y) < 1; }); });
  }
  function nearestTag(tags, x, y, r, used) {
    var best = null, bd = r;
    tags.forEach(function (t, i) { var d = Math.hypot(t.x - x, t.y - y); if (d < bd && !(used && used[i])) { bd = d; best = i; } });
    return best;
  }
  // gắn ký hiệu cho mọi ô cửa của tầng (ops trên các tấm tường)
  function applyTags(rects, tags) {
    if (!tags.length) return 0;
    var ops = [];
    rects.forEach(function (r) { (r.ops || []).forEach(function (o) { var sm = (o.s0 + o.s1) / 2; ops.push({ o: o, x: r.x + r.ux * sm, y: r.y + r.uy * sm }); }); });
    // ghép cặp gần nhất trước
    var pairs = [];
    ops.forEach(function (op, oi) { tags.forEach(function (t, ti) { var d = Math.hypot(t.x - op.x, t.y - op.y); if (d <= 2.5) pairs.push([d, oi, ti]); }); });
    pairs.sort(function (a, b) { return a[0] - b[0]; });
    var uo = {}, ut = {}, n = 0;
    pairs.forEach(function (p) {
      if (uo[p[1]] || ut[p[2]]) return;
      uo[p[1]] = ut[p[2]] = 1; n++;
      var o = ops[p[1]].o, t = tags[p[2]];
      o.tag = t.name; o.kind = t.kind;
      if (t.sill !== undefined) o.sill = t.sill;
      if (t.top !== undefined) o.top = t.top;
    });
    return n;
  }

  /* ------------------------------------------------------------------ */
  /* Cầu thang: nhóm >= 5 nét bậc song song, cùng chiều dài, cách đều    */
  /* ------------------------------------------------------------------ */
  function detectFlights(segs) {
    var groups = {};
    segs.forEach(function (s) {
      var dx = s.x1 - s.x0, dy = s.y1 - s.y0, L = Math.hypot(dx, dy);
      if (L < 0.6 || L > 2.2) return;
      var u = canonDir(dx / L, dy / L), nx = -u[1], ny = u[0];
      var mx = (s.x0 + s.x1) / 2, my = (s.y0 + s.y1) / 2, o = mx * nx + my * ny, sc = mx * u[0] + my * u[1];
      var key = Math.round(Math.atan2(u[1], u[0]) / 0.02) + ':' + Math.round(L / 0.05) + ':' + Math.round(sc / 0.15);
      (groups[key] || (groups[key] = [])).push({ o: o, sc: sc, L: L, ux: u[0], uy: u[1] });
    });
    var flights = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k].sort(function (a, b) { return a.o - b.o; });
      var u = g.filter(function (x, i) { return i === 0 || x.o - g[i - 1].o > 0.02; });
      var run = [u[0]];
      function flush() {
        if (run.length < 5) return;
        var f = run[0], l = run[run.length - 1], sc = 0, L = 0;
        run.forEach(function (r) { sc += r.sc; L += r.L; });
        flights.push({ ux: f.ux, uy: f.uy, nx: -f.uy, ny: f.ux, o0: f.o, o1: l.o, sc: sc / run.length, L: L / run.length, n: run.length, step: (l.o - f.o) / (run.length - 1) });
      }
      for (var i = 1; i < u.length; i++) {
        var d = u[i].o - run[run.length - 1].o, d0 = run.length > 1 ? run[1].o - run[0].o : d;
        if (d >= 0.2 && d <= 0.36 && Math.abs(d - d0) < 0.03) run.push(u[i]); else { flush(); run = [u[i]]; }
      }
      flush();
    });
    return flights;
  }
  function flightPt(f, o, s) { return [f.nx * o + f.ux * s, f.ny * o + f.uy * s]; }
  function flightPoly(f) { var a = f.sc - f.L / 2, b = f.sc + f.L / 2; return [flightPt(f, f.o0, a), flightPt(f, f.o1, a), flightPt(f, f.o1, b), flightPt(f, f.o0, b)]; }
  // Gom vế thành cầu thang và xếp thứ tự thành đường đi liên tục
  function stairsFrom(flights, prevEnd) {
    var n = flights.length, par = [], i, j;
    for (i = 0; i < n; i++) par.push(i);
    function find(a) { while (par[a] !== a) a = par[a]; return a; }
    var boxes = flights.map(function (f) { return bboxOf(flightPoly(f)); });
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
      var a = boxes[i], b = boxes[j];
      if (a[0] - 1.6 <= b[2] && b[0] - 1.6 <= a[2] && a[1] - 1.6 <= b[3] && b[1] - 1.6 <= a[3]) par[find(i)] = find(j);
    }
    var gs = {};
    for (i = 0; i < n; i++) (gs[find(i)] || (gs[find(i)] = [])).push(flights[i]);
    return Object.keys(gs).map(function (k) {
      var fl = gs[k].slice(0, 4), best = null, bestC = Infinity;
      function ends(f, rev) { var a = flightPt(f, f.o0, f.sc), b = flightPt(f, f.o1, f.sc); return rev ? [b, a] : [a, b]; }
      (function perm(arr, used, cur) {
        if (cur.length === arr.length) {
          for (var mask = 0; mask < (1 << arr.length); mask++) {
            var c = 0;
            for (var q = 0; q + 1 < cur.length; q++) {
              var e1 = ends(arr[cur[q]], mask >> q & 1)[1], s2 = ends(arr[cur[q + 1]], mask >> (q + 1) & 1)[0];
              c += Math.hypot(e1[0] - s2[0], e1[1] - s2[1]);
            }
            if (c < bestC - 1e-9) { bestC = c; best = cur.map(function (fi, q) { return { f: arr[fi], rev: !!(mask >> q & 1) }; }); }
          }
          return;
        }
        for (var t = 0; t < arr.length; t++) if (!used[t]) { used[t] = 1; cur.push(t); perm(arr, used, cur); cur.pop(); used[t] = 0; }
      })(fl, {}, []);
      // hướng đi lên: nối tiếp điểm cuối của thang tầng dưới; nếu không có thì bắt đầu ở đầu có y nhỏ
      var s0 = ends(best[0].f, best[0].rev)[0], e0 = ends(best[best.length - 1].f, best[best.length - 1].rev)[1];
      var flip = prevEnd ? Math.hypot(e0[0] - prevEnd[0], e0[1] - prevEnd[1]) < Math.hypot(s0[0] - prevEnd[0], s0[1] - prevEnd[1])
                         : (e0[1] + 0.01 * e0[0] < s0[1] + 0.01 * s0[0]);
      if (flip) best = best.reverse().map(function (x) { return { f: x.f, rev: !x.rev }; });
      var poly = [];
      best.forEach(function (x) { poly = poly.concat(flightPoly(x.f)); });
      var endPt = ends(best[best.length - 1].f, best[best.length - 1].rev)[1];
      return { path: best, box: bboxOf(poly), end: endPt };
    });
  }
  // Dựng bậc thang và chiếu nghỉ từ z0 lên z1
  function emitStair(G, st, z0, z1) {
    var R = 0;
    st.path.forEach(function (x) { R += x.f.n; });
    var h = (z1 - z0) / R, cum = 0, landings = [];
    st.path.forEach(function (x, k) {
      var f = x.f, a = f.sc - f.L / 2, b = f.sc + f.L / 2;
      for (var j = 0; j < f.n - 1; j++) {
        var oa = x.rev ? f.o1 - j * f.step : f.o0 + j * f.step, ob = x.rev ? oa - f.step : oa + f.step;
        var top = z0 + (cum + j + 1) * h;
        addPrism(G.stair, [flightPt(f, oa, a), flightPt(f, ob, a), flightPt(f, ob, b), flightPt(f, oa, b)], Math.max(z0, top - h - 0.18), top);
      }
      cum += f.n;
      if (k + 1 < st.path.length) { // chiếu nghỉ giữa vế này và vế sau
        var g = st.path[k + 1].f, oe = x.rev ? f.o0 : f.o1, og = st.path[k + 1].rev ? g.o1 : g.o0;
        var pts = [flightPt(f, oe, a), flightPt(f, oe, b), flightPt(g, og, g.sc - g.L / 2), flightPt(g, og, g.sc + g.L / 2)];
        var bb = bboxOf(pts), zt = z0 + cum * h;
        addPrism(G.stair, [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]], zt - 0.15, zt);
      }
    });
    return { steps: R, rise: h, going: st.path[0].f.step, width: st.path[0].f.L };
  }

  /* ------------------------------------------------------------------ */
  /* Sàn có lỗ (ô thang): nối lỗ vào biên ngoài bằng một đường cắt        */
  /* ------------------------------------------------------------------ */
  function addSlab(g, outer, holes, z0, z1) {
    var P = cleanPoly(outer);
    if (P.length < 3) return;
    if (polyArea(P) < 0) P.reverse();
    var hs = (holes || []).map(function (h) { h = cleanPoly(h); if (polyArea(h) > 0) h.reverse(); return h; })
      .filter(function (h) { return h.length >= 3 && h.every(function (p) { return inConvex(P, p[0], p[1], -0.02); }); });
    if (!hs.length) { addPrism(g, P, z0, z1); return; }
    hs.sort(function (a, b) { return Math.max.apply(null, b.map(function (p) { return p[0]; })) - Math.max.apply(null, a.map(function (p) { return p[0]; })); });
    var merged = P.slice();
    hs.forEach(function (h) {
      var mi = 0; h.forEach(function (p, i) { if (p[0] > h[mi][0]) mi = i; });
      var M = h[mi], best = -1, bx = Infinity;
      for (var i = 0; i < merged.length; i++) {
        var a = merged[i], b = merged[(i + 1) % merged.length];
        if ((a[1] - M[1]) * (b[1] - M[1]) > 0 || a[1] === b[1]) continue;
        var x = a[0] + (M[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
        if (x >= M[0] && x < bx) { bx = x; best = a[0] > b[0] ? i : (i + 1) % merged.length; }
      }
      if (best < 0) return;
      var ring = h.slice(mi).concat(h.slice(0, mi + 1));
      merged = merged.slice(0, best + 1).concat(ring, [merged[best]], merged.slice(best + 1));
    });
    var tri = triangulate(merged), base, i2;
    base = g.pos.length / 3;
    for (i2 = 0; i2 < merged.length; i2++) { g.pos.push(merged[i2][0], merged[i2][1], z1); g.nor.push(0, 0, 1); }
    for (i2 = 0; i2 < tri.length; i2 += 3) g.idx.push(base + tri[i2], base + tri[i2 + 1], base + tri[i2 + 2]);
    base = g.pos.length / 3;
    for (i2 = 0; i2 < merged.length; i2++) { g.pos.push(merged[i2][0], merged[i2][1], z0); g.nor.push(0, 0, -1); }
    for (i2 = 0; i2 < tri.length; i2 += 3) g.idx.push(base + tri[i2], base + tri[i2 + 2], base + tri[i2 + 1]);
    [P].concat(hs).forEach(function (ring) {
      for (var k = 0; k < ring.length; k++) {
        var a = ring[k], b = ring[(k + 1) % ring.length], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
        if (L < 1e-9) continue;
        var nx = dy / L, ny = -dx / L, bs = g.pos.length / 3;
        g.pos.push(a[0], a[1], z0, b[0], b[1], z0, b[0], b[1], z1, a[0], a[1], z1);
        for (var q = 0; q < 4; q++) g.nor.push(nx, ny, 0);
        g.idx.push(bs, bs + 1, bs + 2, bs, bs + 2, bs + 3);
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Mái dốc từ các mặt mái (vùng tô lớp Mái)                              */
  /* ------------------------------------------------------------------ */
  // Hình chữ nhật bao có diện tích nhỏ nhất (xoay theo một cạnh của bao lồi)
  function minAreaRect(pts) {
    var h = convexHull(pts), best = null, bestA = Infinity;
    for (var i = 0; i < h.length; i++) {
      var a = h[i], b = h[(i + 1) % h.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-9) continue;
      var ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
      h.forEach(function (p) { var s = p[0] * ux + p[1] * uy, t = -p[0] * uy + p[1] * ux; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); });
      var A = (s1 - s0) * (t1 - t0);
      if (A < bestA - 1e-9) {
        bestA = A;
        var P = function (s, t) { return [s * ux - t * uy, s * uy + t * ux]; };
        best = [P(s0, t0), P(s1, t0), P(s1, t1), P(s0, t1)];
      }
    }
    return best;
  }

  // Mái nhiều mặt dốc đều trên đường bao lồi: mỗi cạnh mép mái là một mặt phẳng nghiêng,
  // mặt mái tại mỗi điểm là mặt phẳng thấp nhất (đúng với mái 4 mái, mái chéo trên bao lồi).
  // faces: vùng tô lớp Mái (có thể chỉ tô một phần), topHull: bao tường tầng trên cùng.
  function roofModel(faces, eaveZ, ridgeZ, topHull, overhang) {
    var main = faces.filter(function (f) { var b = bboxOf(f); return Math.min(b[2] - b[0], b[3] - b[1]) >= 2.5; });
    var pts = [];
    main.forEach(function (f) { pts = pts.concat(f); });
    if (topHull) pts = pts.concat(main.length ? topHull : expandHull(topHull, overhang || 0.5));
    if (pts.length < 3) return null;
    var P = minAreaRect(pts);
    if (!P) return null;
    if (polyArea(P) < 0) P.reverse();
    var n = P.length;
    // khoảng cách vào trong tới đường thẳng cạnh i: d_i(p) = a*x + b*y + c
    var lines = P.map(function (a, i) {
      var b = P[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
      return [nx, ny, -(nx * a[0] + ny * a[1])];
    });
    function d(i, p) { return lines[i][0] * p[0] + lines[i][1] * p[1] + lines[i][2]; }
    var dmax = 0;
    // điểm xa biên nhất của hình chữ nhật: nửa cạnh ngắn
    var e0 = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]), e1 = Math.hypot(P[2][0] - P[1][0], P[2][1] - P[1][1]);
    dmax = Math.min(e0, e1) / 2;
    if (!(ridgeZ > eaveZ)) ridgeZ = eaveZ + dmax * 0.6; // khoảng 31 độ khi không có cao độ đỉnh
    var k = (ridgeZ - eaveZ) / dmax;
    function clip(poly, i, j) { // giữ phần d_i <= d_j
      var out = [];
      for (var q = 0; q < poly.length; q++) {
        var A = poly[q], B = poly[(q + 1) % poly.length], fa = d(i, A) - d(j, A), fb = d(i, B) - d(j, B);
        if (fa <= 1e-9) out.push(A);
        if ((fa < -1e-9 && fb > 1e-9) || (fa > 1e-9 && fb < -1e-9)) { var t = fa / (fa - fb); out.push([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])]); }
      }
      return out;
    }
    var faces3 = [];
    for (var i = 0; i < n; i++) {
      var poly = P.slice();
      for (var j = 0; j < n && poly.length >= 3; j++) if (j !== i) poly = clip(poly, i, j);
      poly = cleanPoly(poly);
      if (poly.length >= 3 && Math.abs(polyArea(poly)) > 1e-4) faces3.push(poly.map(function (p) { return [p[0], p[1], eaveZ + k * Math.max(0, d(i, p))]; }));
    }
    return { faces: faces3, hull: P, eaveZ: eaveZ, ridgeZ: ridgeZ, lines: lines, k: k, partial: faces.length > 0 && main.length < faces.length };
  }
  function roofZAt(rm, x, y) {
    if (!rm || !inConvex(rm.hull, x, y, 0)) return Infinity;
    var m = Infinity;
    rm.lines.forEach(function (l) { m = Math.min(m, l[0] * x + l[1] * y + l[2]); });
    return rm.eaveZ + rm.k * Math.max(0, m);
  }
  function pointInPoly(p, x, y) {
    var c = false;
    for (var i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
    }
    return c;
  }
  function emitRoof(g, rm, thick) {
    rm.faces.forEach(function (f) {
      var f2 = f.map(function (p) { return [p[0], p[1]]; }), F = f;
      if (polyArea(f2) < 0) { F = f.slice().reverse(); f2 = f2.reverse(); }
      var tri = triangulate(f2);
      [0, 1].forEach(function (side) {
        var dz = side ? -thick : 0;
        for (var t = 0; t < tri.length; t += 3) {
          var A = F[tri[t]], B = F[tri[t + 1]], C = F[tri[t + 2]];
          if (side) { var tmp = B; B = C; C = tmp; }
          var ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
          var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.hypot(nx, ny, nz) || 1;
          var bs = g.pos.length / 3;
          [A, B, C].forEach(function (P) { g.pos.push(P[0], P[1], P[2] + dz); g.nor.push(nx / L, ny / L, nz / L); });
          g.idx.push(bs, bs + 1, bs + 2);
        }
      });
      for (var k = 0; k < F.length; k++) { // mép mái
        var A = F[k], B = F[(k + 1) % F.length], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
        if (L < 1e-6) continue;
        var bs2 = g.pos.length / 3, nx2 = dy / L, ny2 = -dx / L;
        g.pos.push(A[0], A[1], A[2] - thick, B[0], B[1], B[2] - thick, B[0], B[1], B[2], A[0], A[1], A[2]);
        for (var q = 0; q < 4; q++) g.nor.push(nx2, ny2, 0);
        g.idx.push(bs2, bs2 + 1, bs2 + 2, bs2, bs2 + 2, bs2 + 3);
      }
    });
  }

  /* Vòng tròn ký hiệu trục: tâm các đường tròn bán kính 0,15 - 0,7 m (dùng để căn các tờ) */
  function bubbleCenters(ents, f) {
    var out = [];
    ents.forEach(function (e) {
      if (!e.closed || e.pts.length < 16) return;
      var b = bboxOf(e.pts), w = (b[2] - b[0]) * f, h = (b[3] - b[1]) * f;
      if (w < 0.3 || w > 1.4 || Math.abs(w - h) > 0.05 * w) return;
      var cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, r = (b[2] - b[0]) / 2, ok = true;
      for (var i = 0; i < e.pts.length; i += 3) if (Math.abs(Math.hypot(e.pts[i][0] - cx, e.pts[i][1] - cy) - r) > 0.06 * r) { ok = false; break; }
      if (ok && !out.some(function (q) { return Math.hypot(q[0] - cx * f, q[1] - cy * f) < 0.05; })) out.push([cx * f, cy * f]);
    });
    return out;
  }

  // Xử lý một mặt bằng (một tầng): trả về tường, cột, sàn... theo mét, chưa căn tâm
  function prepLevel(ents, cfg, texts) {
    var roles = cfg.roles || {}, f = cfg.unitFactor, items = [], i, j, warn = [], isRoof = cfg.levelKind === 'roof';
    for (i = 0; i < ents.length; i++) {
      var e = ents[i], role = roles[e.layer];
      if (!role || role === 'ignore' || e.pts.length < 2) continue;
      if (isRoof && role !== 'roof') continue;
      var pts = new Array(e.pts.length);
      for (j = 0; j < e.pts.length; j++) pts[j] = [e.pts[j][0] * f, e.pts[j][1] * f];
      items.push({ role: role, pts: pts, closed: e.closed, grp: e.grp });
    }
    var wallSegs = [], dEnts = [], wEnts = [], cols = [], slabs = [], evid = [], overlay = [], roofFaces = [];
    items.forEach(function (it) {
      overlay.push({ role: it.role, pts: it.pts, closed: it.closed });
      if (it.role === 'roof') { if (it.closed && it.pts.length >= 3) roofFaces.push(it.pts.map(function (p) { return [p[0], p[1]]; })); return; }
      if (it.role === 'wall') edgesOf(it.pts, it.closed, wallSegs);
      else if (it.role === 'door') { dEnts.push(it); evid.push(it); }
      else if (it.role === 'window') { wEnts.push(it); evid.push(it); }
      else if (it.role === 'opening') evid.push(it);
      else if (it.role === 'column') { if (it.closed && it.pts.length >= 3) cols.push(it); }
      else if (it.role === 'slab') { if (it.closed) slabs.push(it.pts); }
    });

    var rects = cfg.mode === 'center' ? segsToRects(wallSegs, cfg.centerT) : pairWalls(wallSegs, cfg.tMin, cfg.tMax);
    rects = mergeRects(rects, Math.min(cfg.tMax + 0.05, cfg.gapMin - 0.01));
    if (!rects.length && !isRoof) {
      warn.push(wallSegs.length
        ? 'Không ghép được cặp nét song song nào. Kiểm tra lớp tường, tỉ lệ, bề dày tối thiểu/tối đa hoặc đổi sang chế độ một nét tim tường.'
        : 'Chưa có lớp nào được gán vai trò Tường.');
    }
    var colBoxes = clusterBoxes(cols, 0.01).filter(function (b) { var mx = Math.max(b[2] - b[0], b[3] - b[1]); return mx >= 0.1 && mx <= 2.5; });

    var door = 0, win = 0, lostBoxes = [];
    clusterOpenings(dEnts).forEach(function (bb) { if (assignOpening(rects, bb, 'door')) door++; else lostBoxes.push(bb); });
    clusterOpenings(wEnts).forEach(function (bb) { if (assignOpening(rects, bb, 'window')) win++; else lostBoxes.push(bb); });
    var textsM = (texts || []).map(function (t) { return { text: t.text, x: t.x * f, y: t.y * f }; });
    var tags = readTags(textsM), rooms = isRoof ? [] : readRooms(textsM);
    var inf = { door: 0, window: 0, open: 0, list: [] };
    if (cfg.inferOpenings && cfg.mode !== 'center') inf = inferOpenings(rects, evid, colBoxes, cfg, tags);
    var tagged = applyTags(rects, tags);
    // Cầu thang: nét bậc ở mọi lớp trừ tường, cột, mái
    var flights = [];
    if (cfg.stairs !== false && !isRoof) {
      var allSegs = [];
      ents.forEach(function (e) {
        var r = roles[e.layer];
        if (r === 'wall' || r === 'column' || r === 'roof' || e.kind === 'F' || e.pts.length > 6) return;
        edgesOf(e.pts.map(function (p) { return [p[0] * f, p[1] * f]; }), e.closed, allSegs);
      });
      flights = detectFlights(allSegs);
    }
    var bubbles = bubbleCenters(ents, f);
    var lost = lostBoxes.filter(function (bb) {
      var cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
      return !inf.list.some(function (o) { return Math.abs((cx - o.x) * o.ux + (cy - o.y) * o.uy) <= o.len / 2 + 0.3 && Math.abs(-(cx - o.x) * o.uy + (cy - o.y) * o.ux) <= 1.2; });
    }).length;

    // Khối nhà = khối tường lớn nhất cùng các khối nằm trong bao lồi của nó (vách ngăn bị khe cửa cắt rời).
    // Khối nằm ngoài bao lồi: tường rào (tầng 1) và không tính vào sàn.
    var hullPts = [], comps = wallComponents(rects), main = [], fenceN = 0;
    if (comps.length) {
      var mh = [];
      comps[0].rects.forEach(function (r) { rectPoly(r, 0, r.len, -r.t / 2, r.t / 2).forEach(function (p) { mh.push(p); }); });
      mh = convexHull(mh);
      comps.forEach(function (c, ci) {
        var inside = ci === 0 || c.rects.filter(function (r) {
          var mx = r.x + r.ux * r.len / 2, my = r.y + r.uy * r.len / 2;
          return inConvex(mh, mx, my, 0.3);
        }).length >= 0.5 * c.rects.length;
        if (inside) main = main.concat(c.rects);
        else if (cfg.fence && cfg.isGround) { fenceN++; c.rects.forEach(function (r) { r.fence = true; }); }
      });
    }
    main.forEach(function (r) { rectPoly(r, 0, r.len, -r.t / 2, r.t / 2).forEach(function (p) { hullPts.push(p); }); });
    return {
      rects: rects, colBoxes: colBoxes, overlay: overlay, hullPts: hullPts, openings: inf.list, rooms: rooms,
      roofFaces: roofFaces, flights: flights, bubbles: bubbles,
      // chỉ giữ đa giác cột nằm trong một khối cột đủ lớn (bỏ các mẩu tô vụn)
      cols: cols.filter(function (c) {
        var b = bboxOf(c.pts), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        if (Math.max(b[2] - b[0], b[3] - b[1]) > 2.5) return false;
        return colBoxes.some(function (q) { return cx >= q[0] - 1e-6 && cx <= q[2] + 1e-6 && cy >= q[1] - 1e-6 && cy <= q[3] + 1e-6; });
      }).map(function (c) { return c.pts.map(function (p) { return [p[0], p[1]]; }); }),
      slabs: slabs.map(function (sl) { return sl.map(function (p) { return [p[0], p[1]]; }); }),
      stats: { tagged: tagged, flights: flights.length, fences: fenceN, fenceWalls: rects.filter(function (r) { return r.fence && !r.inferred; }).length, walls: rects.filter(function (r) { return !r.inferred; }).length, doors: door + inf.door, windows: win + inf.window,
        openGaps: inf.open, openingsUnmatched: lost, columns: colBoxes.length, slabs: slabs.length },
      warnings: warn
    };
  }


  // Gom tấm tường thành các khối liền nhau; khối có tổng chiều dài lớn nhất là ngôi nhà
  function segDist(a, b) {
    function ptSeg(px, py, x0, y0, x1, y1) {
      var dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L)) : 0;
      return Math.hypot(px - x0 - t * dx, py - y0 - t * dy);
    }
    var a0 = [a.x, a.y], a1 = [a.x + a.ux * a.len, a.y + a.uy * a.len], b0 = [b.x, b.y], b1 = [b.x + b.ux * b.len, b.y + b.uy * b.len];
    return Math.min(ptSeg(a0[0], a0[1], b0[0], b0[1], b1[0], b1[1]), ptSeg(a1[0], a1[1], b0[0], b0[1], b1[0], b1[1]),
      ptSeg(b0[0], b0[1], a0[0], a0[1], a1[0], a1[1]), ptSeg(b1[0], b1[1], a0[0], a0[1], a1[0], a1[1]));
  }
  function inConvex(h, x, y, m) { // h ngược chiều kim đồng hồ (convexHull); m: dung sai
    if (!h || h.length < 3) return false;
    for (var i = 0; i < h.length; i++) {
      var a = h[i], b = h[(i + 1) % h.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      if (((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / L < -m) return false;
    }
    return true;
  }
  function wallComponents(rects) {
    var n = rects.length, par = [], i, j;
    for (i = 0; i < n; i++) par.push(i);
    function find(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
      if (find(i) === find(j)) continue;
      if (segDist(rects[i], rects[j]) <= (rects[i].t + rects[j].t) / 2 + 0.3) par[find(i)] = find(j);
    }
    var comp = {}, len = {};
    for (i = 0; i < n; i++) { var r = find(i); (comp[r] || (comp[r] = [])).push(rects[i]); len[r] = (len[r] || 0) + rects[i].len; }
    var keys = Object.keys(comp).sort(function (a, b) { return len[b] - len[a]; });
    return keys.map(function (k) { return { rects: comp[k], len: len[k] }; });
  }

  function shiftLevel(L, dx, dy) {
    function sp(p) { p[0] += dx; p[1] += dy; }
    L.rects.forEach(function (r) { r.x += dx; r.y += dy; });
    L.cols.forEach(function (c) { c.forEach(sp); });
    L.colBoxes.forEach(function (b) { b[0] += dx; b[2] += dx; b[1] += dy; b[3] += dy; });
    L.slabs.forEach(function (s) { s.forEach(sp); });
    L.overlay.forEach(function (o) { o.pts.forEach(sp); });
    L.hullPts.forEach(sp);
    L.openings.forEach(function (o) { o.x += dx; o.y += dy; });
    (L.rooms || []).forEach(function (o) { o.x += dx; o.y += dy; });
    (L.roofFaces || []).forEach(function (fc) { fc.forEach(sp); });
    (L.bubbles || []).forEach(sp);
    (L.flights || []).forEach(function (fl) { fl.o0 += dx * fl.nx + dy * fl.ny; fl.o1 += dx * fl.nx + dy * fl.ny; fl.sc += dx * fl.ux + dy * fl.uy; });
  }

  // Dựng nhiều tầng. levels = [{ ents, texts?, z?, kind?: 'floor'|'roof', dx?, dy? }], mỗi tầng một mặt bằng.
  //   z: cao độ sàn (m). Tầng kind 'roof' là mặt bằng mái: z là cao độ đỉnh mái, mép mái đặt ở sàn tầng ngay dưới.
  function buildLevels(levels, cfgIn) {
    var cfg = Object.assign({}, DEFAULTS, cfgIn), i;
    var preps = levels.map(function (lv, li) {
      return prepLevel(lv.ents, Object.assign({}, cfg, { isGround: li === 0, levelKind: lv.kind || 'floor' }), lv.texts);
    });
    var warn = [];
    // Một mặt bằng nhưng nhiều tầng: lặp lại
    if (preps.length === 1 && cfg.floors > 1) {
      for (i = 1; i < cfg.floors; i++) { preps.push(prepLevel(levels[0].ents, cfg, levels[0].texts)); levels = levels.concat([{ ents: levels[0].ents, texts: levels[0].texts, repeat: true }]); }
    }
    var kinds = levels.map(function (lv) { return lv.kind === 'roof' ? 'roof' : 'floor'; });
    var align = [{ dx: 0, dy: 0, method: 'gốc' }];
    for (i = 1; i < preps.length; i++) {
      var lv = levels[i], a;
      if (lv.repeat) a = { dx: 0, dy: 0, method: 'lặp tầng 1' };
      else if (typeof lv.dx === 'number' && typeof lv.dy === 'number') a = { dx: lv.dx, dy: lv.dy, method: 'nhập tay' };
      else if (cfg.autoAlign !== false) a = alignLevels(preps[0], preps[i]);
      else a = { dx: 0, dy: 0, method: 'không căn' };
      if (a.method === 'không căn được') warn.push('Tầng ' + (i + 1) + ': không tìm được cột, tường hay vòng tròn trục trùng với tầng 1 để căn. Nhập độ lệch bằng tay nếu tầng bị lệch.');
      if (a.dx || a.dy) shiftLevel(preps[i], a.dx, a.dy);
      align.push(a);
    }
    // Căn tâm theo tường tầng 1
    var xs = [], ys = [];
    (preps[0].hullPts.length ? preps[0].hullPts : [].concat.apply([], preps[0].overlay.map(function (o) { return o.pts; })))
      .forEach(function (p) { xs.push(p[0]); ys.push(p[1]); });
    var rx = robustRange(xs), ry = robustRange(ys), cx = (rx[0] + rx[1]) / 2, cy = (ry[0] + ry[1]) / 2;
    if (!isFinite(cx) || !isFinite(cy)) { cx = 0; cy = 0; }
    preps.forEach(function (L) { shiftLevel(L, -cx, -cy); });

    // Cao độ: dùng cao độ ghi trên bản vẽ nếu mọi tầng đều có, nếu không thì xếp chồng theo cao tầng
    var n = preps.length, H = cfg.wallH;
    var given = levels.every(function (lv, li) { return lv.repeat ? false : (typeof lv.z === 'number' && isFinite(lv.z)); });
    var z0 = [], ridgeZ = NaN;
    for (i = 0; i < n; i++) {
      if (kinds[i] === 'roof') {
        if (given) ridgeZ = levels[i].z;
        z0.push((i > 0 ? z0[i - 1] + (given ? 0 : H) : 0) + cfg.eaveRise);
      } else z0.push(given ? levels[i].z : i * H);
    }
    if (given) { var b0 = z0[0]; for (i = 0; i < n; i++) z0[i] -= b0; ridgeZ -= b0; }
    var heights = z0.map(function (z, li) {
      if (kinds[li] === 'roof') return 0;
      if (li + 1 < n && kinds[li + 1] !== 'roof' && z0[li + 1] - z > 0.5) return z0[li + 1] - z;
      if (li + 1 < n && kinds[li + 1] === 'roof' && ridgeZ - z > 0.5) return ridgeZ - z;
      return H;
    });
    // Mái từ mặt bằng mái
    var rm = null, roofIdx = kinds.indexOf('roof');
    if (roofIdx >= 0) {
      var topHullPts = [];
      for (i = roofIdx - 1; i >= 0 && !topHullPts.length; i--) topHullPts = preps[i].hullPts;
      rm = roofModel(preps[roofIdx].roofFaces, z0[roofIdx], ridgeZ, topHullPts.length >= 3 ? convexHull(topHullPts) : null, cfg.overhang);
      if (!preps[roofIdx].roofFaces.length) warn.push('Mặt bằng mái không có vùng tô lớp Mái; mái được dựng theo bao tường tầng trên cùng, chìa ra ' + cfg.overhang + ' m.');
    }

    var G = newGroups(), overlay = [], items = [], solids = preps.map(function () { return []; });
    var hulls = preps.map(function (L) { return L.hullPts.length >= 3 ? convexHull(L.hullPts) : null; });
    var stats = { tagged: 0, flights: 0, stairs: 0, fences: 0, fenceWalls: 0, walls: 0, doors: 0, windows: 0, openGaps: 0, openingsUnmatched: 0, columns: 0, slabs: 0 };
    var prevEnd = null, holes = [];
    preps.forEach(function (L, li) {
      var zb = z0[li], zt = zb + heights[li];
      L.overlay.forEach(function (o) { overlay.push({ role: o.role, pts: o.pts, closed: o.closed, z: zb }); });
      for (var k in L.stats) if (typeof L.stats[k] === 'number') stats[k] = (stats[k] || 0) + L.stats[k];
      L.warnings.forEach(function (w) { warn.push((preps.length > 1 ? 'Tầng ' + (li + 1) + ': ' : '') + w); });
      if (kinds[li] === 'roof') return;
      var underRoof = rm && li + 1 < n && kinds[li + 1] === 'roof';
      function clipTop(pts) { // tầng ngay dưới mái: tường, cột không vượt mặt mái
        if (!underRoof) return zt;
        var m = zt;
        pts.forEach(function (p) {
          var rz = roofZAt(rm, p[0], p[1]);
          m = Math.min(m, isFinite(rz) ? rz - 0.05 : zb + 1.1); // ngoài vùng mái: cao bằng lan can
        });
        return m;
      }
      L.rects.forEach(function (r) {
        var top = zt;
        if (underRoof) top = clipTop([[r.x, r.y], [r.x + r.ux * r.len, r.y + r.uy * r.len], [r.x + r.ux * r.len / 2, r.y + r.uy * r.len / 2]]);
        if (top - zb < 0.3) return;
        emitRect(G, r, zb, top, cfg, { items: items, solids: solids[li], li: li });
      });
      L.cols.forEach(function (c) {
        var top = clipTop(c);
        if (li === 0 && cfg.fence && hulls[0]) { // cột trụ cổng, trụ rào ngoài khối nhà
          var b = bboxOf(c);
          if (!inConvex(hulls[0], (b[0] + b[2]) / 2, (b[1] + b[3]) / 2, 0.3)) top = Math.min(top, zb + cfg.fenceH);
        }
        if (top - zb >= 0.3) {
          addPrism(G.column, c, zb, top);
          items.push({ type: 'column', li: li, box: bboxOf(c), z0: zb, z1: top });
        }
      });
      // Cầu thang lên tầng trên
      var levelHoles = [];
      if (li + 1 < n && kinds[li + 1] !== 'roof' && L.flights.length) {
        stairsFrom(L.flights, prevEnd).forEach(function (st) {
          var si = emitStair(G, st, zb, z0[li + 1]);
          items.push({ type: 'stair', li: li, box: st.box, z0: zb, z1: z0[li + 1], steps: si.steps, rise: si.rise, going: si.going, width: si.width });
          stats.stairs++;
          prevEnd = st.end;
          var bb = st.box;
          levelHoles.push([[bb[0] - 0.05, bb[1] - 0.05], [bb[2] + 0.05, bb[1] - 0.05], [bb[2] + 0.05, bb[3] + 0.05], [bb[0] - 0.05, bb[3] + 0.05]]);
        });
      }
      if (L.slabs.length) L.slabs.forEach(function (p) { addPrism(G.slab, p, zb - cfg.slabT, zb); });
      else if (li === 0 && cfg.autoSlab && hulls[0]) addPrism(G.slab, hulls[0], zb - cfg.slabT, zb);
      // Sàn giữa tầng này và tầng trên (khoét lỗ ô thang)
      if (li + 1 < n && kinds[li + 1] !== 'roof' && !preps[li + 1].slabs.length) {
        var pts = (hulls[li] || []).concat(hulls[li + 1] || []);
        if (pts.length >= 3) addSlab(G.slab, convexHull(pts), levelHoles, z0[li + 1] - cfg.slabT, z0[li + 1]);
      }
    });
    if (rm) emitRoof(G.roof, rm, cfg.roofT);
    else {
      var lastFloor = kinds.lastIndexOf('floor'), top = hulls[lastFloor], Ht = z0[lastFloor] + heights[lastFloor];
      if (cfg.roof && top) addPrism(G.roof, expandHull(top, cfg.overhang), Ht, Ht + cfg.roofT);
    }
    var uniqWarn = warn.filter(function (w, idx) { return warn.indexOf(w) === idx; });
    return finalize(G, {
      overlay: overlay, shift: [cx, cy], rects: preps[0].rects,
      levels: preps.map(function (L, li) {
        return { stats: L.stats, align: align[li], z0: z0[li], height: heights[li], kind: kinds[li], openings: L.openings,
          rooms: L.rooms || [], solids: solids[li], hull: hulls[li], given: given };
      }),
      items: items, slabT: cfg.slabT, defaults: { doorH: cfg.doorH, winSill: cfg.winSill, winH: cfg.winH },
      roof: rm ? { eaveZ: rm.eaveZ, ridgeZ: rm.ridgeZ, faces: rm.faces.length } : null,
      stats: stats, warnings: uniqWarn
    });
  }

  function build(ents, cfgIn) { return buildLevels([{ ents: ents }], cfgIn); }

  /* ------------------------------------------------------------------ */
  /* Ảnh scan: ngưỡng, lọc nét mảnh, dựng khối từ mặt nạ                 */
  /* ------------------------------------------------------------------ */
  function otsu(gray) {
    var hist = new Array(256).fill(0), i;
    for (i = 0; i < gray.length; i++) hist[gray[i]]++;
    var total = gray.length, sum = 0;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, best = 0, th = 127;
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      var wF = total - wB; if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; th = i; }
    }
    return th;
  }

  function boxCount(mask, w, h) {
    var W = w + 1, S = new Int32Array(W * (h + 1));
    for (var y = 0; y < h; y++) {
      var row = 0;
      for (var x = 0; x < w; x++) { row += mask[y * w + x]; S[(y + 1) * W + x + 1] = S[y * W + x + 1] + row; }
    }
    return function (x0, y0, x1, y1) { return S[(y1 + 1) * W + x1 + 1] - S[y0 * W + x1 + 1] - S[(y1 + 1) * W + x0] + S[y0 * W + x0]; };
  }

  function openMask(mask, w, h, k) {
    var cnt = boxCount(mask, w, h), er = new Uint8Array(w * h), out = new Uint8Array(w * h), x, y;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - k), x1 = Math.min(w - 1, x + k), y0 = Math.max(0, y - k), y1 = Math.min(h - 1, y + k);
        er[y * w + x] = cnt(x0, y0, x1, y1) === (x1 - x0 + 1) * (y1 - y0 + 1) ? 1 : 0;
      }
    }
    var cnt2 = boxCount(er, w, h);
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        var a0 = Math.max(0, x - k), a1 = Math.min(w - 1, x + k), b0 = Math.max(0, y - k), b1 = Math.min(h - 1, y + k);
        out[y * w + x] = cnt2(a0, b0, a1, b1) > 0 ? 1 : 0;
      }
    }
    return out;
  }

  function analyzeRaster(gray, w, h, opts) {
    opts = opts || {};
    var th = opts.threshold == null ? otsu(gray) : opts.threshold;
    var mask = new Uint8Array(w * h);
    for (var i = 0; i < gray.length; i++) mask[i] = (opts.invert ? gray[i] > th : gray[i] <= th) ? 1 : 0;
    var k = opts.openRadius | 0;
    return { mask: k > 0 ? openMask(mask, w, h, k) : mask, threshold: th };
  }

  function maskToRects(mask, w, h) {
    var rects = [], active = {}, y, x;
    for (y = 0; y < h; y++) {
      var next = {};
      x = 0;
      while (x < w) {
        if (!mask[y * w + x]) { x++; continue; }
        var x0 = x;
        while (x < w && mask[y * w + x]) x++;
        var key = x0 + ',' + x, r = active[key];
        if (r) { r.y1 = y + 1; next[key] = r; }
        else { r = { x0: x0, x1: x, y0: y, y1: y + 1 }; rects.push(r); next[key] = r; }
      }
      active = next;
    }
    return rects;
  }

  function buildFromMask(mask, w, h, cfgIn) {
    var cfg = Object.assign({}, DEFAULTS, cfgIn), cell = cfg.cell || 0.02;
    var rr = maskToRects(mask, w, h), warn = [];
    if (rr.length > 30000) warn.push('Có ' + rr.length + ' khối nhỏ, mô hình sẽ nặng. Tăng độ dày tối thiểu của nét để lọc bớt.');
    if (!rr.length) warn.push('Không tìm thấy vùng tường. Thử đổi ngưỡng, bật đảo màu hoặc giảm độ dày tối thiểu.');
    var cx = w * cell / 2, cy = h * cell / 2, hullPts = [];
    var polys = rr.map(function (r) {
      var x0 = r.x0 * cell - cx, x1 = r.x1 * cell - cx, y0 = (h - r.y1) * cell - cy, y1 = (h - r.y0) * cell - cy;
      return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    });
    polys.forEach(function (p) { p.forEach(function (q) { hullPts.push(q); }); });
    var G = assemble(cfg, hullPts, [], [], function (G, z0, z1) {
      polys.forEach(function (p) { addPrism(G.wall, p, z0, z1); });
    });
    return finalize(G, { overlay: [], shift: [cx, cy], rects: [], stats: { walls: rr.length, doors: 0, windows: 0, openingsUnmatched: 0, columns: 0, slabs: 0 }, warnings: warn });
  }

  /* ------------------------------------------------------------------ */
  /* Xuất file                                                           */
  /* ------------------------------------------------------------------ */
  function toOBJ(model, scale, mtlName) {
    scale = scale || 1;
    var o = ['# Xuat tu cong cu Dung 3D (truc Z huong len)', 'mtllib ' + (mtlName || 'house3d.mtl')], mtl = [], off = 1;
    model.groups.forEach(function (g) {
      var i, n = g.pos.length / 3;
      o.push('o ' + g.name, 'usemtl ' + g.name);
      for (i = 0; i < n; i++) o.push('v ' + (g.pos[i * 3] * scale).toFixed(5) + ' ' + (g.pos[i * 3 + 1] * scale).toFixed(5) + ' ' + (g.pos[i * 3 + 2] * scale).toFixed(5));
      for (i = 0; i < n; i++) o.push('vn ' + g.nor[i * 3] + ' ' + g.nor[i * 3 + 1] + ' ' + g.nor[i * 3 + 2]);
      for (i = 0; i < g.idx.length; i += 3) {
        var a = g.idx[i] + off, b = g.idx[i + 1] + off, c = g.idx[i + 2] + off;
        o.push('f ' + a + '//' + a + ' ' + b + '//' + b + ' ' + c + '//' + c);
      }
      off += n;
      mtl.push('newmtl ' + g.name, 'Kd ' + g.color[0] + ' ' + g.color[1] + ' ' + g.color[2], 'd ' + g.color[3], '');
    });
    return { obj: o.join('\n') + '\n', mtl: mtl.join('\n') };
  }

  function toSTL(model, scale) {
    scale = scale || 1;
    var tris = 0;
    model.groups.forEach(function (g) { tris += g.idx.length / 3; });
    var buf = new ArrayBuffer(84 + tris * 50), dv = new DataView(buf), p = 84;
    dv.setUint32(80, tris, true);
    model.groups.forEach(function (g) {
      for (var i = 0; i < g.idx.length; i += 3) {
        var v = [g.idx[i], g.idx[i + 1], g.idx[i + 2]].map(function (k) {
          return [g.pos[k * 3] * scale, g.pos[k * 3 + 1] * scale, g.pos[k * 3 + 2] * scale];
        });
        var ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2];
        var wx = v[2][0] - v[0][0], wy = v[2][1] - v[0][1], wz = v[2][2] - v[0][2];
        var nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, L = Math.hypot(nx, ny, nz) || 1;
        dv.setFloat32(p, nx / L, true); dv.setFloat32(p + 4, ny / L, true); dv.setFloat32(p + 8, nz / L, true); p += 12;
        for (var q = 0; q < 3; q++) { dv.setFloat32(p, v[q][0], true); dv.setFloat32(p + 4, v[q][1], true); dv.setFloat32(p + 8, v[q][2], true); p += 12; }
        dv.setUint16(p, 0, true); p += 2;
      }
    });
    return buf;
  }

  function toDXF3D(model, scale, unitsCode) {
    scale = scale || 1;
    var o = [];
    function w(c, v) { o.push(String(c), String(v)); }
    w(0, 'SECTION'); w(2, 'HEADER'); w(9, '$ACADVER'); w(1, 'AC1015'); w(9, '$INSUNITS'); w(70, unitsCode || 6); w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'ENTITIES');
    model.groups.forEach(function (g) {
      var m = MATERIALS[g.key];
      for (var i = 0; i < g.idx.length; i += 3) {
        var v = [g.idx[i], g.idx[i + 1], g.idx[i + 2]];
        w(0, '3DFACE'); w(8, m.dxfLayer); w(62, m.aci);
        for (var q = 0; q < 4; q++) {
          var k = v[Math.min(q, 2)];
          w(10 + q, (g.pos[k * 3] * scale).toFixed(4)); w(20 + q, (g.pos[k * 3 + 1] * scale).toFixed(4)); w(30 + q, (g.pos[k * 3 + 2] * scale).toFixed(4));
        }
      }
    });
    w(0, 'ENDSEC'); w(0, 'EOF');
    return o.join('\n') + '\n';
  }

  function toGLB(model) { // glTF nhị phân, trục Y hướng lên, đơn vị mét
    var chunks = [], views = [], accessors = [], meshes = [], nodes = [], mats = [], off = 0;
    function pad4(n) { return (4 - (n % 4)) % 4; }
    function push(buf, target) {
      var u8 = new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
      views.push({ buffer: 0, byteOffset: off, byteLength: u8.length, target: target });
      chunks.push(u8);
      var p = pad4(u8.length);
      if (p) chunks.push(new Uint8Array(p));
      off += u8.length + p;
      return views.length - 1;
    }
    model.groups.forEach(function (g, gi) {
      var n = g.pos.length / 3, P = new Float32Array(n * 3), N = new Float32Array(n * 3), i;
      var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (i = 0; i < n; i++) {
        P[i * 3] = g.pos[i * 3]; P[i * 3 + 1] = g.pos[i * 3 + 2]; P[i * 3 + 2] = -g.pos[i * 3 + 1];
        N[i * 3] = g.nor[i * 3]; N[i * 3 + 1] = g.nor[i * 3 + 2]; N[i * 3 + 2] = -g.nor[i * 3 + 1];
        for (var a = 0; a < 3; a++) { if (P[i * 3 + a] < mn[a]) mn[a] = P[i * 3 + a]; if (P[i * 3 + a] > mx[a]) mx[a] = P[i * 3 + a]; }
      }
      var I = new Uint32Array(g.idx);
      var vp = push(P, 34962), vn = push(N, 34962), vi = push(I, 34963);
      accessors.push({ bufferView: vp, componentType: 5126, count: n, type: 'VEC3', min: mn, max: mx });
      accessors.push({ bufferView: vn, componentType: 5126, count: n, type: 'VEC3' });
      accessors.push({ bufferView: vi, componentType: 5125, count: I.length, type: 'SCALAR' });
      var base = gi * 3;
      mats.push({ name: g.name, pbrMetallicRoughness: { baseColorFactor: g.color, metallicFactor: 0, roughnessFactor: 0.9 },
        alphaMode: g.color[3] < 1 ? 'BLEND' : 'OPAQUE', doubleSided: g.color[3] < 1 });
      meshes.push({ name: g.name, primitives: [{ attributes: { POSITION: base, NORMAL: base + 1 }, indices: base + 2, material: gi }] });
      nodes.push({ mesh: gi, name: g.name });
    });
    var json = {
      asset: { version: '2.0', generator: 'Dung 3D' }, scene: 0,
      scenes: [{ nodes: nodes.map(function (_, i) { return i; }) }],
      nodes: nodes, meshes: meshes, materials: mats, accessors: accessors, bufferViews: views,
      buffers: [{ byteLength: off }]
    };
    var js = new TextEncoder().encode(JSON.stringify(json));
    var jp = pad4(js.length), jlen = js.length + jp;
    var total = 12 + 8 + jlen + 8 + off;
    var out = new Uint8Array(total), dv = new DataView(out.buffer), p = 0;
    dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jlen, true); dv.setUint32(16, 0x4E4F534A, true);
    out.set(js, 20); for (var q = 0; q < jp; q++) out[20 + js.length + q] = 0x20;
    p = 20 + jlen;
    dv.setUint32(p, off, true); dv.setUint32(p + 4, 0x004E4942, true);
    p += 8;
    chunks.forEach(function (c) { out.set(c, p); p += c.length; });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Bản vẽ mẫu (DXF, đơn vị mm) để thử công cụ                          */
  /* ------------------------------------------------------------------ */
  function sampleDXF() {
    var o = [];
    function w(c, v) { o.push(String(c), String(v)); }
    function line(layer, x0, y0, x1, y1) { w(0, 'LINE'); w(8, layer); w(10, x0); w(20, y0); w(11, x1); w(21, y1); }
    function rect(layer, x0, y0, x1, y1) {
      w(0, 'LWPOLYLINE'); w(8, layer); w(90, 4); w(70, 1);
      w(10, x0); w(20, y0); w(10, x1); w(20, y0); w(10, x1); w(20, y1); w(10, x0); w(20, y1);
    }
    w(0, 'SECTION'); w(2, 'HEADER'); w(9, '$INSUNITS'); w(70, 4); w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'BLOCKS');
    w(0, 'BLOCK'); w(8, '0'); w(2, 'CUA_D900'); w(70, 0); w(10, 0); w(20, 0);
    line('0', 0, 0, 0, 900);
    w(0, 'ARC'); w(8, '0'); w(10, 0); w(20, 0); w(40, 900); w(50, 0); w(51, 90);
    w(0, 'ENDBLK'); w(8, '0');
    w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'ENTITIES');
    rect('TUONG', 0, 0, 10000, 8000);
    rect('TUONG', 200, 200, 9800, 7800);
    line('TUONG', 4900, 200, 4900, 3000); line('TUONG', 4900, 3900, 4900, 7800);
    line('TUONG', 5100, 200, 5100, 3000); line('TUONG', 5100, 3900, 5100, 7800);
    w(0, 'INSERT'); w(8, 'CUA DI'); w(2, 'CUA_D900'); w(10, 2000); w(20, 100); w(41, 1); w(42, 1); w(50, 0);
    w(0, 'INSERT'); w(8, 'CUA DI'); w(2, 'CUA_D900'); w(10, 7300); w(20, 100); w(41, 1); w(42, 1); w(50, 0);
    rect('CUA SO', 6000, 0, 7000, 200); line('CUA SO', 6000, 100, 7000, 100);
    rect('CUA SO', 9800, 3000, 10000, 4200); line('CUA SO', 9800, 3600, 10000, 3600);
    rect('CUA SO', 1500, 0, 2000, 200);
    rect('COT', 1400, 4000, 1800, 4400);
    line('KICH THUOC', 0, -600, 10000, -600);
    line('TRUC', -500, 4000, 10500, 4000);
    w(0, 'ENDSEC'); w(0, 'EOF');
    return o.join('\n') + '\n';
  }

  return {
    DEFAULTS: DEFAULTS, MATERIALS: MATERIALS,
    parseDXF: parseDXF, guessRole: guessRole, autoUnit: autoUnit,
    build: build, buildLevels: buildLevels, buildFromMask: buildFromMask,
    wallThickness: wallThickness, guessPdfRoles: guessPdfRoles, suggestColumns: suggestColumns, analyzeRaster: analyzeRaster,
    toOBJ: toOBJ, toSTL: toSTL, toDXF3D: toDXF3D, toGLB: toGLB, sampleDXF: sampleDXF,
    _t: { wallComponents: wallComponents, triangulate: triangulate, addPrism: addPrism, newGroup: newGroup, pairWalls: pairWalls, mergeRects: mergeRects, convexHull: convexHull, edgesOf: edgesOf, mmul: mmul, voteOffset: voteOffset, clusterBoxes: clusterBoxes }
  };
});
