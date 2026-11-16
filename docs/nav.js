/* nav.js - Tương tác trên khung 3D: bấm chọn để xem kích thước, đo khoảng cách, nhãn kích thước cửa,
 * tên phòng, và chế độ đi bộ trong nhà (sơ đồ nhỏ, nhảy tới phòng, đổi tầng). */
var Nav = (function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var T, V, M = null, names = [];
  var EYE = 1.6, RADIUS = 0.22;
  var st = {
    walk: false, tool: 'pick', li: 0, ground: 0, yaw: 0, pitch: 0, pos: null, keys: {}, glide: null,
    saved: null, sel: null, measure: [], labels: [], hl: null, mline: null, lamp: null, mapCache: null, mapLi: -1, lastT: 0
  };

  /* ---------------- Định dạng ---------------- */
  function mm(v) { return Math.round(v * 1000) + ' mm'; }
  function m2(v) { return v.toFixed(2).replace('.', ',') + ' m'; }
  function both(v) { return mm(v) + ' (' + m2(v) + ')'; }
  function cote(z) { return (Math.abs(z) < 0.0005 ? '±' : z > 0 ? '+' : '-') + Math.abs(z).toFixed(3); }
  function levelName(li) { return names[li] || ('Tầng ' + (li + 1)); }
  function floorLevels() { var out = []; (M && M.levels || []).forEach(function (L, i) { if (L.kind !== 'roof') out.push(i); }); return out; }
  function cutZ() { return V.cut.constant; }

  /* ---------------- Nhãn chữ đặt theo điểm 3D ---------------- */
  function addLabel(grp, pos, text, cls, extra) {
    var el = document.createElement('div');
    el.className = 'lbl ' + (cls || '');
    el.textContent = text;
    $('labels').appendChild(el);
    var o = { grp: grp, pos: new T.Vector3(pos[0], pos[1], pos[2]), el: el };
    if (extra) for (var k in extra) o[k] = extra[k];
    st.labels.push(o);
    return o;
  }
  function clearLabels(grp) {
    st.labels = st.labels.filter(function (o) { if (o.grp !== grp) return true; o.el.remove(); return false; });
  }
  var tmpV = null;
  function updateLabels() {
    var w = $('stage').clientWidth, h = $('stage').clientHeight, cam = V.camera, cz = cutZ();
    var showDims = $('in-dims').checked, showRooms = $('in-rooms').checked;
    st.labels.forEach(function (o) {
      var vis = true;
      if (o.grp === 'dim') {
        vis = showDims && o.zmin <= cz;
        if (vis && st.walk) vis = o.li === st.li && o.pos.distanceTo(cam.position) < 9;
        else if (vis) vis = o.pos.distanceTo(cam.position) < 45;
      } else if (o.grp === 'room') {
        if (!showRooms) vis = false;
        else if (st.walk) vis = o.li === st.li && o.pos.distanceTo(cam.position) < 14;
        else vis = cz < 1e5 && o.pos.z <= cz && o.top >= cz - 0.05; // chỉ hiện ở tầng đang được cắt mở
      }
      if (vis) {
        tmpV.copy(o.pos).project(cam);
        if (tmpV.z > 1 || tmpV.z < -1 || Math.abs(tmpV.x) > 1.05 || Math.abs(tmpV.y) > 1.05) vis = false;
        else o.el.style.transform = 'translate(-50%,-50%) translate(' + ((tmpV.x * 0.5 + 0.5) * w).toFixed(1) + 'px,' + ((-tmpV.y * 0.5 + 0.5) * h).toFixed(1) + 'px)';
      }
      o.el.style.display = vis ? '' : 'none';
      o.vis = vis;
    });
    // Khi đi bộ: nhãn bị tường che thì làm mờ (kiểm tra 4 lần mỗi giây)
    var now = performance.now();
    if (now - (st.occT || 0) > 250) {
      st.occT = now;
      var meshes = null, rc = null, dir = null;
      st.labels.forEach(function (o) {
        var occ = false;
        if (st.walk && o.vis && (o.grp === 'room' || o.grp === 'dim')) {
          if (!meshes) { meshes = []; V.model.traverse(function (n) { if (n.isMesh && n.visible && n.userData.key !== 'glass') meshes.push(n); }); rc = new T.Raycaster(); dir = new T.Vector3(); }
          var d = o.pos.distanceTo(cam.position);
          dir.copy(o.pos).sub(cam.position).normalize();
          rc.set(cam.position, dir); rc.far = Math.max(0, d - 0.35);
          occ = rc.intersectObjects(meshes, false).length > 0;
        }
        if (occ !== !!o.occ) { o.occ = occ; o.el.classList.toggle('occ', occ); }
      });
    }
  }

  /* ---------------- Bấm chọn ---------------- */
  function ray(ev) {
    var r = V.renderer.domElement.getBoundingClientRect();
    var p = new T.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    var rc = new T.Raycaster();
    rc.setFromCamera(p, V.camera);
    if (!V.model) return null;
    var meshes = [];
    V.model.traverse(function (n) { if (n.isMesh && n.visible) meshes.push(n); });
    var hits = rc.intersectObjects(meshes, false), cz = cutZ();
    for (var i = 0; i < hits.length; i++) if (hits[i].point.z <= cz + 1e-4) return hits[i];
    return null;
  }
  function local(it, p) { // toạ độ dọc (s) và ngang (q) so với gốc của cấu kiện
    var dx = p.x - it.x, dy = p.y - it.y;
    return [dx * it.ux + dy * it.uy, -dx * it.uy + dy * it.ux];
  }
  function identify(hit) {
    var p = hit.point, key = hit.object.userData.key, items = M.items || [], best = null, bd = Infinity, i, it, lq;
    function inBox(it, tol) { return p.x >= it.box[0] - tol && p.x <= it.box[2] + tol && p.y >= it.box[1] - tol && p.y <= it.box[3] + tol && p.z >= it.z0 - tol && p.z <= it.z1 + tol; }
    if (key === 'frame' || key === 'door' || key === 'glass') {
      for (i = 0; i < items.length; i++) {
        it = items[i]; if (it.type !== 'door' && it.type !== 'window') continue;
        lq = local(it, p);
        if (Math.abs(lq[0]) <= it.w / 2 + 0.08 && Math.abs(lq[1]) <= it.t / 2 + 0.12 && p.z >= it.z0 - 0.08 && p.z <= it.z1 + 0.08) {
          var d = Math.abs(lq[0]) + Math.abs(lq[1]); if (d < bd) { bd = d; best = it; }
        }
      }
      if (best) return best;
    }
    if (key === 'column') { for (i = 0; i < items.length; i++) if (items[i].type === 'column' && inBox(items[i], 0.03)) return items[i]; }
    if (key === 'stair') { for (i = 0; i < items.length; i++) if (items[i].type === 'stair' && inBox(items[i], 0.1)) return items[i]; }
    if (key === 'wall') {
      for (i = 0; i < items.length; i++) {
        it = items[i]; if (it.type !== 'wall' && it.type !== 'fence') continue;
        lq = local(it, p);
        if (lq[0] >= -0.03 && lq[0] <= it.len + 0.03 && Math.abs(lq[1]) <= it.t / 2 + 0.03 && p.z >= it.z0 - 0.02 && p.z <= it.z1 + 0.02) {
          if (Math.abs(lq[1]) < bd) { bd = Math.abs(lq[1]); best = it; }
        }
      }
      if (best) return best;
    }
    if (key === 'roof') return { type: 'roof', p: p };
    if (key === 'slab') {
      var li = levelAt(p.z + 0.02), L = M.levels[li], under = Math.abs(p.z - L.z0) > 0.03 && hit.face && hit.face.normal.z < -0.5;
      return { type: 'slab', li: li, p: p, under: under };
    }
    return { type: 'other', key: key, p: p };
  }
  function levelAt(z) { // tầng có sàn ngay dưới cao độ z
    var fl = floorLevels(), li = fl.length ? fl[0] : 0;
    fl.forEach(function (i) { if (M.levels[i].z0 <= z + 0.3) li = i; });
    return li;
  }
  function nearRoom(li, x, y) {
    var best = null, bd = 4;
    (M.levels[li].rooms || []).forEach(function (r) { var d = Math.hypot(r.x - x, r.y - y); if (d < bd) { bd = d; best = r; } });
    return best;
  }

  function boxCorners(it) { // 8 đỉnh hộp bao của cấu kiện có hướng
    var a, b, c, d;
    if (it.box) { a = [it.box[0], it.box[1]]; b = [it.box[2], it.box[1]]; c = [it.box[2], it.box[3]]; d = [it.box[0], it.box[3]]; }
    else {
      var nx = -it.uy, ny = it.ux, h = it.t / 2 + 0.01, s0 = it.len !== undefined ? 0 : -it.w / 2, s1 = it.len !== undefined ? it.len : it.w / 2;
      var pt = function (s, q) { return [it.x + it.ux * s + nx * q, it.y + it.uy * s + ny * q]; };
      a = pt(s0, -h); b = pt(s1, -h); c = pt(s1, h); d = pt(s0, h);
    }
    return [a, b, c, d];
  }
  function highlight(it) {
    if (st.hl) { V.scene.remove(st.hl); st.hl.geometry.dispose(); st.hl.material.dispose(); st.hl = null; }
    clearLabels('sel');
    if (!it || (!it.box && it.ux === undefined)) return;
    var c = boxCorners(it), z0 = it.z0, z1 = it.z1, pos = [], i;
    for (i = 0; i < 4; i++) {
      var a = c[i], b = c[(i + 1) % 4];
      pos.push(a[0], a[1], z0, b[0], b[1], z0, a[0], a[1], z1, b[0], b[1], z1, a[0], a[1], z0, a[0], a[1], z1);
    }
    var mid = function (p, q, z) { return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, z]; };
    // chọn mặt gần máy quay hơn để đặt nhãn
    var cam = V.camera.position, f0 = mid(c[0], c[1], z1), f1 = mid(c[3], c[2], z1);
    var front = Math.hypot(f0[0] - cam.x, f0[1] - cam.y) <= Math.hypot(f1[0] - cam.x, f1[1] - cam.y);
    var A = front ? c[0] : c[3], B = front ? c[1] : c[2];
    var wLen = Math.hypot(B[0] - A[0], B[1] - A[1]);
    addLabel('sel', [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, z1 + 0.08], (it.type === 'wall' || it.type === 'fence' ? 'dài ' : 'rộng ') + mm(wLen), 'sel');
    addLabel('sel', [A[0], A[1], (z0 + z1) / 2], 'cao ' + mm(z1 - z0), 'sel');
    if (it.type === 'window' && it.sill > 0.02) {
      pos.push(B[0], B[1], it.floorZ, B[0], B[1], z0);
      addLabel('sel', [B[0], B[1], (it.floorZ + z0) / 2], 'bệ ' + mm(it.sill), 'sel');
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3));
    st.hl = new T.LineSegments(g, new T.LineBasicMaterial({ color: 0xff3d00, depthTest: false, transparent: true }));
    st.hl.renderOrder = 10;
    V.scene.add(st.hl);
  }

  function showInfo(title, rows, note) {
    var el = $('info');
    el.innerHTML = '';
    var h = document.createElement('div'); h.className = 'info-title';
    var s = document.createElement('strong'); s.textContent = title; h.appendChild(s);
    var x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Đóng');
    x.addEventListener('click', function () { select(null); });
    h.appendChild(x); el.appendChild(h);
    var dl = document.createElement('dl');
    rows.forEach(function (r) {
      var dt = document.createElement('dt'); dt.textContent = r[0];
      var dd = document.createElement('dd'); dd.textContent = r[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
    el.appendChild(dl);
    if (note) { var p = document.createElement('p'); p.className = 'info-note'; p.textContent = note; el.appendChild(p); }
    el.hidden = false;
  }
  function select(it) {
    st.sel = it;
    highlight(it);
    if (!it) { $('info').hidden = true; return; }
    var L = it.li !== undefined ? M.levels[it.li] : null, lv = L ? levelName(it.li) + ' (sàn ' + cote(L.z0) + ')' : '', D = M.defaults || {}, note = '';
    if (it.type === 'door' || it.type === 'window') {
      var isDoor = it.type === 'door', rows = [['Rộng', both(it.w)], ['Cao', both(it.h)]];
      if (!isDoor || it.sill > 0.02) rows.push([isDoor ? 'Ngưỡng cửa' : 'Bệ cửa sổ', both(it.sill) + ' so với sàn']);
      rows.push(['Cao độ đỉnh cửa', cote(it.z1)], ['Tường dày', mm(it.t)], ['Vị trí', it.fence ? 'Tường rào, cổng' : lv]);
      if (it.hSrc === 'tag') note = 'Chiều cao lấy theo ký hiệu ' + it.tag + ' ghi trên bản vẽ. Chiều rộng đo trên mặt bằng.';
      else note = 'Bản vẽ không ghi chiều cao cho ô cửa này nên đang dùng giá trị mặc định (' + (isDoor ? 'Cao cửa đi ' + mm(D.doorH) : 'Bệ ' + mm(D.winSill) + ', cao ' + mm(D.winH)) + ') ở mục 4. Chiều rộng đo trên mặt bằng.';
      showInfo((isDoor ? 'Cửa đi' : 'Cửa sổ') + (it.tag ? ' ' + it.tag : ''), rows, note);
    } else if (it.type === 'wall' || it.type === 'fence') {
      showInfo(it.type === 'fence' ? 'Tường rào' : 'Tường', [['Dài', both(it.len)], ['Dày', mm(it.t)], ['Cao', both(it.z1 - it.z0)],
        ['Chân → đỉnh', cote(it.z0) + ' → ' + cote(it.z1)], ['Vị trí', lv]], 'Chiều dài là cả tấm tường, tính cả đoạn có ô cửa.');
    } else if (it.type === 'column') {
      showInfo('Cột', [['Tiết diện', mm(it.box[2] - it.box[0]) + ' × ' + mm(it.box[3] - it.box[1])], ['Cao', both(it.z1 - it.z0)], ['Chân → đỉnh', cote(it.z0) + ' → ' + cote(it.z1)], ['Vị trí', lv]]);
    } else if (it.type === 'stair') {
      showInfo('Cầu thang', [['Số bậc', String(it.steps)], ['Cao bậc', mm(it.rise)], ['Rộng mặt bậc', mm(it.going)], ['Bề rộng vế', mm(it.width)],
        ['Từ → đến', cote(it.z0) + ' → ' + cote(it.z1)]], 'Số bậc đếm theo nét bậc trên mặt bằng; cao bậc = chênh cao hai tầng chia số bậc.');
    } else if (it.type === 'slab') {
      var rm = nearRoom(it.li, it.p.x, it.p.y), rr = [['Cao độ mặt sàn', cote(L.z0)], ['Dày sàn', mm(M.slabT)]];
      if (L.height) rr.push(['Cao tầng', both(L.height)], ['Thông thủy', both(L.height - M.slabT)]);
      if (rm) rr.push(['Phòng (nhãn gần nhất)', rm.name + (rm.area ? ' · ' + String(rm.area).replace('.', ',') + ' m² ghi trên bản vẽ' : '')]);
      showInfo(it.under ? 'Trần / đáy sàn ' + levelName(it.li) : 'Sàn ' + levelName(it.li), rr,
        L.given ? 'Cao độ đọc từ ghi chú trên bản vẽ.' : 'Bản vẽ không có cao độ cho đủ các tầng nên các tầng đang xếp chồng theo ô "Cao tầng".');
    } else if (it.type === 'roof') {
      showInfo('Mái', M.roof ? [['Mép mái', cote(M.roof.eaveZ)], ['Đỉnh mái', cote(M.roof.ridgeZ)], ['Chênh cao', both(M.roof.ridgeZ - M.roof.eaveZ)], ['Điểm bấm', cote(it.p.z)]] : [['Điểm bấm', cote(it.p.z)]]);
    } else showInfo('Điểm trên mô hình', [['Cao độ', cote(it.p.z)]]);
  }

  /* ---------------- Đo khoảng cách ---------------- */
  function snap(hit) {
    var p = hit.point.clone(), g = hit.object.geometry, f = hit.face;
    if (!g || !f) return p;
    var pa = g.getAttribute('position'), best = null, bd = 0.12, v = new T.Vector3();
    [f.a, f.b, f.c].forEach(function (i) { v.fromBufferAttribute(pa, i); var d = v.distanceTo(p); if (d < bd) { bd = d; best = v.clone(); } });
    return best || p;
  }
  function drawMeasure() {
    if (st.mline) { V.scene.remove(st.mline); st.mline.traverse(function (n) { if (n.geometry) n.geometry.dispose(); if (n.material) n.material.dispose(); }); st.mline = null; }
    clearLabels('measure');
    if (!st.measure.length) return;
    var grp = new T.Group(), pos = [];
    st.measure.forEach(function (p) { pos.push(p.x, p.y, p.z); });
    var pg = new T.BufferGeometry(); pg.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3));
    var pts = new T.Points(pg, new T.PointsMaterial({ color: 0x00a152, size: 9, sizeAttenuation: false, depthTest: false, transparent: true }));
    pts.renderOrder = 11; grp.add(pts);
    if (st.measure.length === 2) {
      var a = st.measure[0], b = st.measure[1];
      var ln = new T.Line(pg, new T.LineBasicMaterial({ color: 0x00a152, depthTest: false, transparent: true })); ln.renderOrder = 11; grp.add(ln);
      var d = a.distanceTo(b), hz = Math.hypot(b.x - a.x, b.y - a.y), dz = Math.abs(b.z - a.z);
      var txt = mm(d);
      if (dz > 0.01 && hz > 0.01) txt += '  (ngang ' + mm(hz) + ', cao ' + mm(dz) + ')';
      addLabel('measure', [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2], txt, 'measure');
    }
    V.scene.add(grp); st.mline = grp;
  }
  function setTool(t) {
    st.tool = t;
    $('btn-measure').setAttribute('aria-pressed', t === 'measure' ? 'true' : 'false');
    if (t !== 'measure') { st.measure = []; drawMeasure(); }
    hint();
  }

  /* ---------------- Đi bộ ---------------- */
  function solidsOf(li) { return (M.levels[li] && M.levels[li].solids) || []; }
  function collide(p) {
    if (Math.abs(st.ground - M.levels[st.li].z0) > 0.3) return; // đang đứng trên cầu thang
    var S = solidsOf(st.li);
    for (var it = 0; it < 3; it++) {
      for (var i = 0; i < S.length; i++) {
        var s = S[i], dx = p.x - s[0], dy = p.y - s[1], a = dx * s[2] + dy * s[3], q = -dx * s[3] + dy * s[2], h = s[6] / 2;
        var ca = Math.max(s[4], Math.min(s[5], a)), cq = Math.max(-h, Math.min(h, q)), ex = a - ca, ey = q - cq, d = Math.hypot(ex, ey);
        if (d >= RADIUS) continue;
        if (d < 1e-6) { // tâm nằm trong tường: đẩy ra mặt gần nhất
          var toFace = h - Math.abs(q), toEnd = Math.min(a - s[4], s[5] - a);
          if (toFace <= toEnd) { ex = 0; ey = q >= 0 ? 1 : -1; d = 1; cq = q >= 0 ? h : -h; ca = a; }
          else { ex = (a - s[4] < s[5] - a) ? -1 : 1; ey = 0; d = 1; ca = ex < 0 ? s[4] : s[5]; cq = q; }
        }
        var na = ca + ex / d * RADIUS, nq = cq + ey / d * RADIUS;
        p.x = s[0] + s[2] * na - s[3] * nq; p.y = s[1] + s[3] * na + s[2] * nq;
      }
    }
  }
  function applyCam() {
    var c = V.camera, cp = Math.cos(st.pitch);
    c.position.set(st.pos.x, st.pos.y, st.ground + EYE);
    c.lookAt(st.pos.x + Math.cos(st.yaw) * cp, st.pos.y + Math.sin(st.yaw) * cp, st.ground + EYE + Math.sin(st.pitch));
  }
  function startPoint(li) {
    var L = M.levels[li], rooms = L.rooms || [], r = null;
    rooms.forEach(function (q) { if (!r && /KH[ÁA]CH|SHC|SINH HO/i.test(q.name)) r = q; });
    if (!r && rooms.length) r = rooms[0];
    if (r) return [r.x, r.y];
    var h = L.hull || [], x = 0, y = 0;
    if (!h.length) return [(M.bbox[0] + M.bbox[3]) / 2, (M.bbox[1] + M.bbox[4]) / 2];
    h.forEach(function (p) { x += p[0]; y += p[1]; });
    return [x / h.length, y / h.length];
  }
  function setDoorLeaves(vis) { if (V.model) V.model.traverse(function (n) { if (n.userData.key === 'door') n.visible = vis; }); }
  function enterWalk(li, x, y, yaw) {
    if (!M) return;
    var fl = floorLevels(); if (!fl.length) return;
    if (li === undefined || fl.indexOf(li) < 0) li = fl[0];
    if (!st.walk) {
      st.saved = { pos: V.camera.position.clone(), target: V.controls.target.clone(), fov: V.camera.fov, near: V.camera.near, cut: $('sel-cut').value };
      V.controls.enabled = false;
      V.camera.fov = 72; V.camera.near = 0.05; V.camera.updateProjectionMatrix();
      $('sel-cut').value = 'all'; V.cut.constant = 1e6;
      st.lamp = new T.AmbientLight(0xfff4e0, 0.35 * (parseInt(T.REVISION, 10) >= 155 ? Math.PI : 1)); // thêm sáng trong nhà
      V.scene.add(st.lamp);
      st.walk = true;
      setDoorLeaves(false);
      document.querySelector('.viewer').classList.add('walking');
      $('btn-walk').setAttribute('aria-pressed', 'true');
      $('btn-walk').textContent = 'Thoát đi bộ';
      if (st.tool === 'measure') setTool('pick');
    }
    var sp = (x === undefined) ? startPoint(li) : [x, y];
    st.li = li; st.ground = M.levels[li].z0; st.pos = new T.Vector3(sp[0], sp[1], 0); st.glide = null; st.pitch = -0.05;
    if (yaw !== undefined) st.yaw = yaw;
    else { // nhìn về phía xa nhất của tầng
      var far = 0;
      (M.levels[li].hull || []).forEach(function (p) { var d = Math.hypot(p[0] - sp[0], p[1] - sp[1]); if (d > far) { far = d; st.yaw = Math.atan2(p[1] - sp[1], p[0] - sp[0]); } });
    }
    collide(st.pos);
    applyCam(); syncWalkUI(); hint();
  }
  function exitWalk() {
    if (!st.walk) return;
    st.walk = false; st.glide = null; st.keys = {};
    if (st.lamp) { V.scene.remove(st.lamp); st.lamp = null; }
    setDoorLeaves($('in-leaves').checked);
    var s = st.saved;
    V.camera.fov = s.fov; V.camera.near = s.near; V.camera.updateProjectionMatrix();
    V.camera.position.copy(s.pos); V.controls.target.copy(s.target); V.controls.enabled = true; V.controls.update();
    var sel = $('sel-cut');
    if (Array.prototype.some.call(sel.options, function (o) { return o.value === s.cut; })) sel.value = s.cut;
    V.cut.constant = sel.value === 'all' ? 1e6 : parseFloat(sel.value);
    document.querySelector('.viewer').classList.remove('walking');
    $('btn-walk').setAttribute('aria-pressed', 'false');
    $('btn-walk').textContent = 'Đi bộ trong nhà';
    hint();
  }
  function changeLevel(d) {
    var fl = floorLevels(), k = fl.indexOf(st.li) + d;
    if (k < 0 || k >= fl.length) return;
    st.li = fl[k]; st.ground = M.levels[st.li].z0; st.glide = null;
    collide(st.pos); applyCam(); syncWalkUI();
  }
  function glideTo(x, y, ground) {
    st.glide = { x0: st.pos.x, y0: st.pos.y, g0: st.ground, x1: x, y1: y, g1: ground, t: 0, dur: Math.min(1.4, 0.35 + Math.hypot(x - st.pos.x, y - st.pos.y) * 0.09) };
    var li = levelAt(ground);
    if (li !== st.li) { st.li = li; syncWalkUI(); }
  }
  function syncWalkUI() {
    var sel = $('sel-floor');
    if (sel.value !== String(st.li)) sel.value = String(st.li);
    st.mapLi = -1;
  }
  function step(dt) {
    if (!st.walk) return;
    var k = st.keys, sp = (k.shift ? 4.5 : 2.2) * dt, f = 0, s = 0, moved = false;
    if (k.w || k.arrowup) f += 1; if (k.s || k.arrowdown) f -= 1;
    if (k.a) s += 1; if (k.d) s -= 1;
    if (k.arrowleft || k.q) { st.yaw += 1.6 * dt; moved = true; }
    if (k.arrowright || k.e) { st.yaw -= 1.6 * dt; moved = true; }
    if (st.glide) {
      var g = st.glide; g.t += dt / g.dur;
      var u = Math.min(1, g.t), e = u * u * (3 - 2 * u);
      st.pos.x = g.x0 + (g.x1 - g.x0) * e; st.pos.y = g.y0 + (g.y1 - g.y0) * e; st.ground = g.g0 + (g.g1 - g.g0) * e;
      if (u >= 1) { st.glide = null; collide(st.pos); }
      if (f || s) st.glide = null;
      moved = true;
    }
    if (f || s) {
      var n = Math.hypot(f, s), cx = Math.cos(st.yaw), sy = Math.sin(st.yaw);
      st.pos.x += (cx * f - sy * s) / n * sp; st.pos.y += (sy * f + cx * s) / n * sp;
      // rời cầu thang: trở về cao độ sàn của tầng
      if (Math.abs(st.ground - M.levels[st.li].z0) > 0.3) st.ground += (M.levels[st.li].z0 - st.ground) * Math.min(1, dt * 4);
      collide(st.pos); moved = true;
    }
    if (moved || st.dirty) { st.dirty = false; applyCam(); }
    drawMap();
  }

  /* ---------------- Sơ đồ nhỏ ---------------- */
  function mapXf(li, size) {
    var S = solidsOf(li), b = [Infinity, Infinity, -Infinity, -Infinity];
    function add(x, y) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
    S.forEach(function (s) { add(s[0] + s[2] * s[4], s[1] + s[3] * s[4]); add(s[0] + s[2] * s[5], s[1] + s[3] * s[5]); });
    if (!isFinite(b[0])) b = [M.bbox[0], M.bbox[1], M.bbox[3], M.bbox[4]];
    var pad = 10, k = Math.min((size - 2 * pad) / Math.max(1, b[2] - b[0]), (size - 2 * pad) / Math.max(1, b[3] - b[1]));
    var ox = (size - (b[2] - b[0]) * k) / 2, oy = (size - (b[3] - b[1]) * k) / 2;
    return { k: k, x: function (x) { return ox + (x - b[0]) * k; }, y: function (y) { return size - oy - (y - b[1]) * k; },
      ix: function (px) { return b[0] + (px - ox) / k; }, iy: function (py) { return b[1] + (size - oy - py) / k; } };
  }
  function drawMap() {
    var cv = $('minimap'), size = cv.clientWidth; if (!size) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2), px = Math.round(size * dpr);
    if (cv.width !== px) { cv.width = cv.height = px; st.mapLi = -1; }
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (st.mapLi !== st.li) {
      var off = document.createElement('canvas'); off.width = off.height = px;
      var c = off.getContext('2d'), xf = mapXf(st.li, size), L = M.levels[st.li];
      c.scale(dpr, dpr);
      c.fillStyle = dark ? '#1b222a' : '#ffffff'; c.fillRect(0, 0, size, size);
      c.fillStyle = dark ? '#d5dbe2' : '#2b333c';
      solidsOf(st.li).forEach(function (s) {
        var h = Math.max(s[6] / 2, 0.6 / xf.k), nx = -s[3], ny = s[2];
        var P = [[s[4], -h], [s[5], -h], [s[5], h], [s[4], h]];
        c.beginPath();
        P.forEach(function (p, i) { var X = s[0] + s[2] * p[0] + nx * p[1], Y = s[1] + s[3] * p[0] + ny * p[1]; if (i) c.lineTo(xf.x(X), xf.y(Y)); else c.moveTo(xf.x(X), xf.y(Y)); });
        c.closePath(); c.fill();
      });
      (M.items || []).forEach(function (it) {
        if (it.li !== st.li) return;
        if (it.type === 'door' || it.type === 'window') {
          c.strokeStyle = it.type === 'door' ? '#e07a1f' : '#1e88e5'; c.lineWidth = 2;
          c.beginPath(); c.moveTo(xf.x(it.x - it.ux * it.w / 2), xf.y(it.y - it.uy * it.w / 2)); c.lineTo(xf.x(it.x + it.ux * it.w / 2), xf.y(it.y + it.uy * it.w / 2)); c.stroke();
        } else if (it.type === 'stair') {
          c.strokeStyle = '#8a96a4'; c.lineWidth = 1;
          var x0 = xf.x(it.box[0]), y0 = xf.y(it.box[3]), w = (it.box[2] - it.box[0]) * xf.k, hh = (it.box[3] - it.box[1]) * xf.k;
          c.strokeRect(x0, y0, w, hh);
          for (var q = 4; q < Math.max(w, hh); q += 4) { c.beginPath(); if (w > hh) { c.moveTo(x0 + q, y0); c.lineTo(x0 + q, y0 + hh); } else { c.moveTo(x0, y0 + q); c.lineTo(x0 + w, y0 + q); } c.stroke(); }
        }
      });
      c.fillStyle = dark ? '#9fb3c8' : '#51606f'; c.font = '9px system-ui, sans-serif'; c.textAlign = 'center';
      (L.rooms || []).forEach(function (r) { c.fillText(r.name.length > 14 ? r.name.slice(0, 13) + '…' : r.name, xf.x(r.x), xf.y(r.y) + 3); });
      st.mapCache = { cv: off, xf: xf }; st.mapLi = st.li;
    }
    var ctx = cv.getContext('2d'), X = st.mapCache.xf;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(st.mapCache.cv, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var mx = X.x(st.pos.x), my = X.y(st.pos.y), a = -st.yaw, R = 26, fov = 0.62;
    ctx.fillStyle = 'rgba(255,61,0,0.22)';
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.arc(mx, my, R, a - fov, a + fov); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff3d00'; ctx.beginPath(); ctx.arc(mx, my, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  /* ---------------- Danh sách tầng, phòng ---------------- */
  function fillSelects() {
    var sf = $('sel-floor'), sr = $('sel-room');
    sf.innerHTML = ''; sr.innerHTML = '';
    var o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Vào phòng…'; sr.appendChild(o0);
    var nRooms = 0;
    floorLevels().forEach(function (li) {
      var o = document.createElement('option'); o.value = String(li); o.textContent = levelName(li) + ' (' + cote(M.levels[li].z0) + ')'; sf.appendChild(o);
      var rooms = (M.levels[li].rooms || []);
      if (!rooms.length) return;
      var og = document.createElement('optgroup'); og.label = levelName(li);
      rooms.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'vi'); }).forEach(function (r) {
        var e = document.createElement('option'); e.value = li + '|' + r.x + '|' + r.y;
        e.textContent = r.name + (r.area ? ' · ' + String(r.area).replace('.', ',') + ' m²' : ''); og.appendChild(e); nRooms++;
      });
      sr.appendChild(og);
    });
    sr.hidden = nRooms === 0;
    $('lb-rooms').hidden = nRooms === 0;
  }
  function buildStaticLabels() {
    clearLabels('dim'); clearLabels('room');
    (M.items || []).forEach(function (it) {
      if ((it.type !== 'door' && it.type !== 'window') || it.fence) return;
      addLabel('dim', [it.x, it.y, it.z1 + 0.1], (it.tag ? it.tag + '  ' : '') + Math.round(it.w * 1000) + '×' + Math.round(it.h * 1000) + (it.hSrc === 'tag' ? '' : '*'),
        'dim ' + it.type, { li: it.li, zmin: it.z0 });
    });
    (M.levels || []).forEach(function (L, li) {
      (L.rooms || []).forEach(function (r) {
        addLabel('room', [r.x, r.y, L.z0 + 1.0], r.name + (r.area ? '\n' + String(r.area).replace('.', ',') + ' m²' : ''), 'room', { li: li, top: L.z0 + (L.height || 3) });
      });
    });
  }

  function hint() {
    var el = $('navhint'), t = '';
    if (!M) { el.hidden = true; return; }
    if (st.walk) t = 'Kéo chuột để nhìn quanh · W A S D hoặc phím mũi tên để đi (giữ Shift đi nhanh) · nhấp đúp vào sàn hay bậc thang để tới đó · bấm vào sơ đồ để nhảy tới · PgUp / PgDn đổi tầng · Esc thoát';
    else if (st.tool === 'measure') t = st.measure.length === 1 ? 'Bấm điểm thứ hai. Esc để thôi đo.' : 'Bấm hai điểm trên mô hình để đo. Điểm bắt vào góc gần nhất.';
    else t = 'Bấm vào cửa, tường, cột, sàn để xem kích thước · nhấp đúp vào sàn để đứng vào đó';
    el.textContent = t; el.hidden = false;
  }

  /* ---------------- Sự kiện ---------------- */
  function wire() {
    var cv = V.renderer.domElement, down = null;
    cv.addEventListener('pointerdown', function (e) {
      down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, btn: e.button };
      if (st.walk) { try { cv.setPointerCapture(e.pointerId); } catch (er) { /* bỏ qua */ } }
    });
    cv.addEventListener('pointermove', function (e) {
      if (!down) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) down.moved = true;
      if (st.walk && down.moved) {
        st.yaw += (e.clientX - down.lx) * 0.0045; st.pitch += (e.clientY - down.ly) * 0.0045;
        st.pitch = Math.max(-1.35, Math.min(1.35, st.pitch)); st.dirty = true;
      }
      down.lx = e.clientX; down.ly = e.clientY;
    });
    function up(e) {
      var d = down; down = null;
      if (!d || d.moved || d.btn !== 0 || !M) return;
      var hit = ray(e);
      if (st.tool === 'measure') {
        if (!hit) return;
        if (st.measure.length >= 2) st.measure = [];
        st.measure.push(snap(hit)); drawMeasure(); hint();
        return;
      }
      select(hit ? identify(hit) : null);
    }
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', function () { down = null; });
    cv.addEventListener('dblclick', function (e) {
      if (!M || st.tool === 'measure') return;
      var hit = ray(e); if (!hit) return;
      var n = hit.face ? hit.face.normal : null, p = hit.point, key = hit.object.userData.key;
      if (n && n.z > 0.7 && key !== 'roof') {
        var li = levelAt(p.z), g = (key === 'stair') ? p.z : M.levels[li].z0;
        if (!st.walk) { enterWalk(li, p.x, p.y, Math.atan2(V.controls.target.y - V.camera.position.y, V.controls.target.x - V.camera.position.x)); st.ground = g; applyCam(); }
        else glideTo(p.x, p.y, g);
      } else if (st.walk && n) { // nhấp đúp vào tường: lại gần, dừng cách 0,6 m
        var dx = p.x - st.pos.x, dy = p.y - st.pos.y, L = Math.hypot(dx, dy);
        if (L > 0.9) glideTo(p.x - dx / L * 0.6, p.y - dy / L * 0.6, st.ground);
      }
    });
    cv.addEventListener('wheel', function (e) {
      if (!st.walk) return;
      e.preventDefault();
      var d = (e.deltaY < 0 ? 1 : -1) * 0.5;
      st.pos.x += Math.cos(st.yaw) * d; st.pos.y += Math.sin(st.yaw) * d; st.glide = null;
      collide(st.pos); st.dirty = true;
    }, { passive: false });

    window.addEventListener('keydown', function (e) {
      var tg = e.target && e.target.tagName;
      if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') return;
      var k = e.key.toLowerCase();
      if (k === 'escape') { if (st.tool === 'measure') setTool('pick'); else if (st.walk) exitWalk(); else select(null); return; }
      if (!st.walk) return;
      if (k === 'pageup') { changeLevel(1); e.preventDefault(); return; }
      if (k === 'pagedown') { changeLevel(-1); e.preventDefault(); return; }
      if (k === 'shift') st.keys.shift = true;
      if (/^(w|a|s|d|q|e|arrowup|arrowdown|arrowleft|arrowright)$/.test(k)) { st.keys[k] = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', function (e) { var k = e.key.toLowerCase(); if (k === 'shift') st.keys.shift = false; else delete st.keys[k]; });
    window.addEventListener('blur', function () { st.keys = {}; });

    $('btn-walk').addEventListener('click', function () { if (st.walk) exitWalk(); else enterWalk(); });
    $('btn-measure').addEventListener('click', function () { if (st.walk) return; setTool(st.tool === 'measure' ? 'pick' : 'measure'); });
    $('in-leaves').addEventListener('change', function () { if (!st.walk) setDoorLeaves($('in-leaves').checked); });
    $('sel-floor').addEventListener('change', function () { var li = parseInt($('sel-floor').value, 10); if (st.walk && li !== st.li) changeLevel(floorLevels().indexOf(li) - floorLevels().indexOf(st.li)); });
    $('btn-up').addEventListener('click', function () { changeLevel(1); });
    $('btn-down').addEventListener('click', function () { changeLevel(-1); });
    $('sel-room').addEventListener('change', function () {
      var v = $('sel-room').value; if (!v) return;
      var a = v.split('|'); $('sel-room').value = '';
      enterWalk(parseInt(a[0], 10), parseFloat(a[1]), parseFloat(a[2]));
      $('sel-room').blur();
    });
    // bàn phím trên màn hình (cảm ứng)
    document.querySelectorAll('#pad [data-k]').forEach(function (b) {
      var k = b.getAttribute('data-k');
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); st.keys[k] = true; });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { b.addEventListener(ev, function () { delete st.keys[k]; }); });
    });
    var mp = $('minimap'), mdown = false;
    function mapGo(e) {
      if (!st.mapCache) return;
      var r = mp.getBoundingClientRect(), X = st.mapCache.xf;
      st.pos.x = X.ix(e.clientX - r.left); st.pos.y = X.iy(e.clientY - r.top); st.ground = M.levels[st.li].z0; st.glide = null;
      collide(st.pos); st.dirty = true;
    }
    mp.addEventListener('pointerdown', function (e) { mdown = true; try { mp.setPointerCapture(e.pointerId); } catch (er) { /* bỏ qua */ } mapGo(e); });
    mp.addEventListener('pointermove', function (e) { if (mdown) mapGo(e); });
    mp.addEventListener('pointerup', function () { mdown = false; });
  }

  /* ---------------- Giao tiếp với app.js ---------------- */
  function init(three, viewer) { T = three; V = viewer; tmpV = new T.Vector3(); wire(); }
  function setModel(model, levelNames) {
    var keep = st.walk ? { li: st.li, x: st.pos.x, y: st.pos.y, yaw: st.yaw, pitch: st.pitch } : null;
    M = model; names = levelNames || [];
    st.sel = null; highlight(null); $('info').hidden = true; st.measure = []; drawMeasure(); st.mapLi = -1;
    var has = !!(M && M.items && floorLevels().length);
    $('navbar').hidden = !has;
    if (!has) { if (st.walk) exitWalk(); clearLabels('dim'); clearLabels('room'); hint(); return; }
    fillSelects(); buildStaticLabels();
    if (st.walk) {
      setDoorLeaves(false);
      if (keep && M.levels[keep.li] && M.levels[keep.li].kind !== 'roof') { st.li = keep.li; st.ground = M.levels[keep.li].z0; st.pitch = keep.pitch; applyCam(); syncWalkUI(); }
      else exitWalk();
    } else setDoorLeaves($('in-leaves').checked);
    hint();
  }
  function frame(now) {
    var dt = Math.min(0.1, (now - (st.lastT || now)) / 1000); st.lastT = now;
    if (M) { step(dt); updateLabels(); }
  }
  return { init: init, setModel: setModel, frame: frame, isWalking: function () { return st.walk; },
    _dbg: function () { return { st: st, enterWalk: enterWalk, exitWalk: exitWalk, select: select, identify: identify, model: function () { return M; } }; } };
})();
