/* app.js - Giao diện: nạp tệp, chọn lớp/trang, xem 3D (Three.js), xuất file. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  // Thứ tự nạp thư viện 3D: bản đóng gói từ three.js-master, bản r128 tải bằng tai_thu_vien.bat, cuối cùng là CDN.
  var THREE_SOURCES = [
    ['lib/three.bundle.js'],
    ['lib/three.min.js', 'lib/OrbitControls.js'],
    ['https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js']
  ];
  var ROLE_LABELS = [['ignore', 'Bỏ qua'], ['wall', 'Tường'], ['door', 'Cửa đi'], ['window', 'Cửa sổ'], ['opening', 'Ký hiệu cửa'], ['column', 'Cột'], ['slab', 'Sàn'], ['roof', 'Mái']];
  var ROLE_COLORS = { wall: 0x5b6b7c, door: 0xd9822b, window: 0x2f8fd1, opening: 0xb8a58c, column: 0x8a5a3c, slab: 0x4c9a6a, roof: 0xa0523d };
  var OPEN_COLORS = { door: 0xe07a1f, window: 0x1e88e5, open: 0x9aa4ae };
  var PT_TO_M = 25.4 / 72 / 1000; // 1 điểm PDF trên giấy, tính bằng mét

  var S = {
    kind: null, name: 'ban-ve', model: null,
    ents: [], layers: {}, roles: {}, insunits: 0,      // DXF
    pdf: null, pdfPages: {}, pdfThick: null,          // PDF
    img: null                                         // ảnh
  };
  var T = null; // THREE
  var V = null; // khung xem 3D

  /* ---------------- Thông báo ---------------- */
  function setMsg(lines, cls) {
    var el = $('msg');
    el.className = 'msg ' + (cls || '');
    el.innerHTML = '';
    (Array.isArray(lines) ? lines : [lines]).forEach(function (t) {
      if (!t) return;
      var d = document.createElement('div'); d.textContent = t; el.appendChild(d);
    });
  }

  /* ---------------- Nạp thư viện ---------------- */
  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.onload = function () { resolve(url); };
      s.onerror = function () { s.remove(); reject(new Error(url)); };
      document.head.appendChild(s);
    });
  }
  async function loadThree() {
    for (var i = 0; i < THREE_SOURCES.length; i++) {
      try {
        for (var k = 0; k < THREE_SOURCES[i].length; k++) await loadScript(THREE_SOURCES[i][k]);
        if (window.THREE && window.THREE.OrbitControls) return THREE_SOURCES[i][0];
      } catch (e) { /* thử nguồn tiếp theo */ }
    }
    throw new Error('Không nạp được Three.js');
  }

  /* ---------------- Khung xem 3D ---------------- */
  function srgb(c) { // màu [r,g,b] 0..1 theo sRGB
    var col = new T.Color();
    if (T.ColorManagement && T.SRGBColorSpace) col.setRGB(c[0], c[1], c[2], T.SRGBColorSpace); else col.setRGB(c[0], c[1], c[2]);
    return col;
  }

  function initViewer() {
    var stage = $('stage');
    var renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.localClippingEnabled = true;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    stage.appendChild(renderer.domElement);
    var scene = new T.Scene();
    var camera = new T.PerspectiveCamera(45, 1, 0.1, 5000);
    camera.up.set(0, 0, 1);
    camera.position.set(14, -18, 12);
    var controls = new T.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;

    // Từ r155 cường độ đèn tính theo đơn vị vật lý: nhân π để giữ độ sáng như bản cũ
    var k = parseInt(T.REVISION, 10) >= 155 ? Math.PI : 1;
    var hemi = new T.HemisphereLight(0xffffff, 0x9aa3ad, 0.85 * k); hemi.position.set(0, 0, 1); scene.add(hemi);
    var sun = new T.DirectionalLight(0xfff6e8, 0.8 * k); sun.position.set(-12, -18, 26);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
    scene.add(sun); scene.add(sun.target);
    // Mặt đất nhận bóng đổ
    var ground = new T.Mesh(new T.CircleGeometry(400, 48), new T.MeshStandardMaterial({ color: 0xaeb8a8, roughness: 1 }));
    ground.receiveShadow = true; ground.position.z = -0.22; scene.add(ground);
    var grid = new T.GridHelper(120, 120, 0x8a96a4, 0xb9c2cc);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.2;
    grid.material.transparent = true; grid.material.opacity = 0.3;
    scene.add(grid);

    V = { renderer: renderer, scene: scene, camera: camera, controls: controls, grid: grid, sun: sun, ground: ground, model: null, overlay: null, bbox: [-5, -5, 0, 5, 5, 3],
      cut: new T.Plane(new T.Vector3(0, 0, -1), 1e6) };

    function theme() {
      var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      renderer.setClearColor(dark ? 0x10161c : 0xdfe7ef, 1);
      ground.material.color.set(dark ? 0x2a3138 : 0xaeb8a8);
    }
    theme();
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', theme);

    function resize() {
      var w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(stage); else window.addEventListener('resize', resize);
    resize();

    Nav.init(T, V);
    (function loop(now) { requestAnimationFrame(loop); if (!Nav.isWalking()) controls.update(); Nav.frame(now || 0); renderer.render(scene, camera); })();

    document.querySelectorAll('[data-view]').forEach(function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
    });
  }

  function setView(kind) {
    if (!V) return;
    var b = V.bbox, cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2;
    var d = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2], 4);
    V.controls.target.set(cx, cy, cz);
    if (Nav.isWalking()) return;
    if (kind === 'top') V.camera.position.set(cx, cy - d * 0.02, cz + d * 1.9);
    else if (kind === 'front') V.camera.position.set(cx, cy - d * 2.0, cz + d * 0.15);
    else V.camera.position.set(cx + d * 0.9, cy - d * 1.25, cz + d * 0.95);
    V.camera.near = Math.max(0.05, d / 500); V.camera.far = d * 60; V.camera.updateProjectionMatrix();
    V.controls.update();
  }

  function clearModel() {
    if (!V) return;
    [V.model, V.overlay].forEach(function (o) {
      if (!o) return;
      V.scene.remove(o);
      o.traverse(function (n) { if (n.geometry) n.geometry.dispose(); if (n.material) n.material.dispose(); });
    });
    V.model = V.overlay = null;
  }

  function showModel(model, keepView) {
    if (!V) return;
    clearModel();
    var group = new T.Group();
    model.groups.forEach(function (g) {
      var geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(new Float32Array(g.pos), 3));
      geo.setAttribute('normal', new T.BufferAttribute(new Float32Array(g.nor), 3));
      geo.setIndex(new T.BufferAttribute(new Uint32Array(g.idx), 1));
      var glass = g.color[3] < 1;
      var rough = { frame: 0.45, door: 0.6, glass: 0.08, slab: 0.8, stair: 0.75, roof: 0.85 }[g.key] || 0.92;
      var mat = new T.MeshStandardMaterial({
        color: srgb(g.color), roughness: rough, metalness: g.key === 'frame' ? 0.3 : 0,
        transparent: glass, opacity: glass ? g.color[3] : 1, side: glass ? T.DoubleSide : T.FrontSide, depthWrite: !glass,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, clippingPlanes: [V.cut], clipShadows: true
      });
      if (g.key === 'roof') mat.side = T.DoubleSide;
      var mesh = new T.Mesh(geo, mat);
      mesh.userData.key = g.key;
      mesh.castShadow = !glass; mesh.receiveShadow = !glass;
      if (glass) mesh.renderOrder = 2;
      group.add(mesh);
      if (!glass && g.key !== 'frame' && g.key !== 'door' && g.idx.length < 400000) {
        group.add(new T.LineSegments(new T.EdgesGeometry(geo, 25), new T.LineBasicMaterial({ color: 0x27313c, transparent: true, opacity: 0.4, clippingPlanes: [V.cut] })));
      }
    });
    V.scene.add(group);
    V.model = group;

    // Nét 2D và ô cửa tự nhận, đặt ngay trên mặt sàn từng tầng để đối chiếu
    var pos = [], col = [];
    function seg(a, b, z, c) { pos.push(a[0], a[1], z, b[0], b[1], z); col.push(c.r, c.g, c.b, c.r, c.g, c.b); }
    (model.overlay || []).forEach(function (o) {
      var c = new T.Color(ROLE_COLORS[o.role] || 0x888888), n = o.pts.length, last = o.closed ? n : n - 1, z = (o.z || 0) + 0.03;
      for (var i = 0; i < last; i++) seg(o.pts[i], o.pts[(i + 1) % n], z, c);
    });
    (model.levels || []).forEach(function (L) {
      (L.openings || []).forEach(function (op) {
        var c = new T.Color(OPEN_COLORS[op.kind] || 0x888888), h = op.len / 2, z = L.z0 + 0.05, w = op.t / 2 + 0.12;
        var a = [op.x - op.ux * h, op.y - op.uy * h], b = [op.x + op.ux * h, op.y + op.uy * h];
        var nx = -op.uy * w, ny = op.ux * w;
        seg([a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], z, c);
        seg([a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], z, c);
      });
    });
    if (pos.length) {
      var og = new T.BufferGeometry();
      og.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3));
      og.setAttribute('color', new T.BufferAttribute(new Float32Array(col), 3));
      V.overlay = new T.LineSegments(og, new T.LineBasicMaterial({ vertexColors: true, clippingPlanes: [V.cut] }));
      V.overlay.visible = $('in-overlay').checked;
      V.scene.add(V.overlay);
    }
    V.bbox = model.bbox;
    // Đèn mặt trời và vùng đổ bóng bao vừa công trình
    var bb = model.bbox, bcx = (bb[0] + bb[3]) / 2, bcy = (bb[1] + bb[4]) / 2, rad = Math.max(6, Math.hypot(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]) * 0.6);
    V.sun.target.position.set(bcx, bcy, (bb[2] + bb[5]) / 2);
    V.sun.position.set(bcx - rad * 0.55, bcy - rad * 0.8, bb[5] + rad * 1.3);
    var sc = V.sun.shadow.camera; sc.left = -rad; sc.right = rad; sc.top = rad; sc.bottom = -rad; sc.near = 0.5; sc.far = rad * 4 + bb[5]; sc.updateProjectionMatrix();
    V.ground.position.set(bcx, bcy, Math.min(-0.22, bb[2] - 0.02));
    renderCutOptions(model);
    Nav.setModel(model, levelNames());
    if (!keepView) setView('persp');
  }

  // Tên tầng lấy theo tiêu đề mặt bằng trong tệp CAD ("MẶT BẰNG TẦNG 2" -> "Tầng 2")
  function levelNames() {
    var c = S.cad;
    if (!c || !c.floors.length) return [];
    return c.floors.map(function (pi) {
      var t = String((c.plans[pi] || {}).title || '').replace(/^\s*M[ẶA]T B[ẰA]NG\s*/i, '').trim();
      if (!/T[ẦA]NG|[ÁA]P M[ÁA]I|L[ỬU]NG|H[ẦA]M/i.test(t) || t.length > 24) return '';
      return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    });
  }

  /* ---------------- Xem cắt theo tầng ---------------- */
  function renderCutOptions(model) {
    var sel = $('sel-cut'), keep = sel.value, opts = [['all', 'Toàn bộ']];
    (model.levels || []).forEach(function (L, i) {
      if (L.kind === 'roof') return;
      opts.push([String(L.z0 + L.height - 0.02), 'Đến ' + (i === 0 ? 'tầng 1' : 'cấp ' + (i + 1)) + ' (bỏ phần trên +' + (L.z0 + L.height).toFixed(2) + ')']);
      opts.push([String(L.z0 + 1.2), 'Cắt ngang tầng ' + (i + 1) + ' ở cao 1,2 m']);
    });
    sel.innerHTML = '';
    opts.forEach(function (o) { var e = document.createElement('option'); e.value = o[0]; e.textContent = o[1]; sel.appendChild(e); });
    sel.value = opts.some(function (o) { return o[0] === keep; }) ? keep : 'all';
    sel.parentNode.hidden = opts.length <= 1;
    applyCut();
  }
  function applyCut() {
    if (!V || Nav.isWalking()) return;
    var v = $('sel-cut').value;
    V.cut.constant = v === 'all' ? 1e6 : parseFloat(v);
  }

  /* ---------------- Đọc cấu hình ---------------- */
  function num(id, def, min, max) {
    var v = parseFloat($(id).value);
    if (!isFinite(v)) return def;
    return Math.min(max, Math.max(min, v));
  }

  function unitLabel(f) {
    return f === 0.001 ? 'mm' : f === 0.01 ? 'cm' : f === 1 ? 'm' : f === 0.0254 ? 'inch' : f === 0.3048 ? 'feet' : f === 0.1 ? 'dm' : String(f);
  }

  function dxfUnit() {
    var v = $('sel-unit').value;
    if (v !== 'auto') return { factor: parseFloat(v), note: '' };
    var a = Core.autoUnit(S.ents, S.insunits, S.roles);
    if (S.cad) S.cad.factor = a.factor;
    return { factor: a.factor, note: 'Đã nhận: ' + unitLabel(a.factor) + (a.source === 'header' ? ' (theo khai báo trong tệp)' : ' (đoán theo kích thước bản vẽ)') + '. Sai thì chọn lại ở trên.' };
  }

  function readCfg() {
    var cfg = {
      wallH: num('in-wallH', 3, 1, 20), floors: Math.round(num('in-floors', 1, 1, 30)), slabT: num('in-slabT', 0.15, 0.05, 0.6),
      mode: $('in-mode').value, centerT: num('in-centerT', 0.2, 0.05, 1),
      tMin: num('in-tMin', 0.07, 0.02, 1), tMax: num('in-tMax', 0.45, 0.1, 2),
      doorH: num('in-doorH', 2.1, 1, 4), winSill: num('in-winSill', 0.9, 0, 3), winH: num('in-winH', 1.2, 0.2, 3),
      autoSlab: $('in-autoSlab').checked, roof: $('in-roof').checked, glass: $('in-glass').checked,
      inferOpenings: $('in-infer').checked, autoAlign: $('in-align').checked, fence: $('in-fence').checked, stairs: $('in-stairs').checked, eaveRise: num('in-eave', 0, -2, 5)
    };
    if (cfg.tMax <= cfg.tMin) cfg.tMax = cfg.tMin + 0.05;
    return cfg;
  }

  /* ---------------- PDF: trang, tỉ lệ ---------------- */
  function parsePages(text, max) {
    var out = [];
    String(text).split(/[,;\s]+/).forEach(function (part) {
      if (!part) return;
      var m = /^(\d+)\s*-\s*(\d+)$/.exec(part);
      if (m) { for (var k = +m[1]; k <= +m[2] && out.length < 40; k++) out.push(k); }
      else if (/^\d+$/.test(part)) out.push(+part);
    });
    return out.filter(function (p) { return p >= 1 && p <= max; });
  }

  // Bộ nhớ đệm trang có giới hạn: giữ các trang đang làm tầng và vài trang xem gần nhất
  var pageLRU = [];
  async function getPdfPage(n, noCache) {
    if (S.pdfPages[n]) {
      pageLRU = pageLRU.filter(function (k) { return k !== n; }); pageLRU.push(n);
      return S.pdfPages[n];
    }
    var pg = await S.pdf.extract(n);
    if (noCache) return pg;
    S.pdfPages[n] = pg; pageLRU.push(n);
    var keep = S.pdfPageList || [];
    while (pageLRU.length > 6 + keep.length) {
      var victim = pageLRU.find(function (k) { return keep.indexOf(k) < 0 && k !== n; });
      if (victim === undefined) break;
      pageLRU = pageLRU.filter(function (k) { return k !== victim; });
      delete S.pdfPages[victim];
    }
    return pg;
  }

  function looksLikePlan(pg) {
    if (!pg.ents.length) return false;
    var gr = Core.guessPdfRoles(pg.ents), wallName = Object.keys(gr.roles).filter(function (k) { return gr.roles[k] === 'wall'; })[0];
    return !!(gr.thickness && gr.thickness.share >= 0.45 && wallName && pg.groups[wallName].n >= 30 &&
      Object.keys(gr.roles).some(function (k) { return gr.roles[k] === 'column' || gr.roles[k] === 'opening'; }));
  }

  function fmtPages(list) {
    var out = [], i = 0;
    while (i < list.length) {
      var j = i;
      while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
      out.push(j > i ? list[i] + '–' + list[j] : String(list[i]));
      i = j + 1;
    }
    return out.join(', ');
  }

  // Dò nền các trang giống mặt bằng để gợi ý
  var scanToken = 0;
  async function scanPlans(from, doc) {
    var tok = ++scanToken, lim = Math.min(doc.numPages, 80);
    for (var n = from; n <= lim; n++) {
      if (tok !== scanToken || S.pdf !== doc) return;
      try { if (looksLikePlan(await getPdfPage(n, true))) S.planPages.push(n); } catch (e) { /* bỏ qua trang lỗi */ }
      $('plans-note').textContent = 'Trang giống mặt bằng: ' + (S.planPages.length ? fmtPages(S.planPages) : 'chưa thấy') + (n < lim ? ' (đang dò tới trang ' + n + ')' : '');
      await new Promise(function (r) { setTimeout(r, 15); });
    }
  }

  function pdfFactor() {
    if ($('sel-pdfScaleMode').value === 'paper') {
      var N = num('in-pdfScale', 100, 1, 100000);
      return { factor: PT_TO_M * N, note: 'Tỉ lệ 1:' + N + ' trên giấy.' };
    }
    var th = S.pdfThick;
    if (!th) return { factor: PT_TO_M * 100, note: 'Chưa đo được bề dày tường (chưa có lớp Tường). Tạm dùng tỉ lệ 1:100.' };
    var ref = num('in-wallRef', 220, 50, 1000) / 1000, f = ref / th.tRaw;
    return { factor: f, note: 'Tường dày nhất phổ biến: ' + th.tRaw.toFixed(2) + ' pt trên giấy (' + Math.round(th.share * 100) + '% chiều dài tường) → tương đương tỉ lệ 1:' + Math.round(f / PT_TO_M) + '.' };
  }

  // Đo bề dày tường trên trang của tầng 1. Không gộp nhiều trang: các trang lệch nhau vài pt
  // sẽ tạo ra những cặp nét sát nhau, cho bề dày giả.
  function measurePdfThickness(pages) {
    S.pdfThick = pages.length ? Core.wallThickness(pages[0].ents, S.roles) : null;
  }

  function pdfLayersOf(pages) {
    var L = {};
    pages.forEach(function (p) {
      Object.keys(p.groups).forEach(function (k) {
        var g = L[k] || (L[k] = { n: 0, kind: p.groups[k].kind });
        g.n += p.groups[k].n;
      });
    });
    return L;
  }

  async function refreshPdf(keepView, rolesFromScratch) {
    var pages = parsePages($('in-pdfPages').value, S.pdf.numPages);
    if (!pages.length) { setMsg('Nhập số trang mặt bằng, ví dụ 13, 14, 15.', 'warn'); return; }
    setMsg('Đang đọc nét vẽ trang ' + pages.join(', ') + '...', '');
    var data = [];
    for (var i = 0; i < pages.length; i++) {
      try { data.push(await getPdfPage(pages[i])); }
      catch (e) { setMsg('Không đọc được trang ' + pages[i] + ': ' + e.message, 'err'); return; }
    }
    var first = data[0];
    if (!first.ents.length) { setMsg('Trang ' + pages[0] + ' không có nét vector. Đây có thể là trang ảnh scan: hãy chụp trang đó thành ảnh PNG rồi nạp bằng chế độ ảnh.', 'err'); return; }
    var newLayers = pdfLayersOf(data), guess = null;
    if (!S.rolesTouched || pages[0] !== S.rolesFromPage) rolesFromScratch = rolesFromScratch || !S.rolesTouched;
    if (rolesFromScratch) { S.roles = {}; S.rolesFromPage = pages[0]; }
    if (rolesFromScratch || Object.keys(newLayers).some(function (k) { return !(k in S.roles); })) {
      guess = Core.guessPdfRoles(first.ents).roles;
      Object.keys(newLayers).forEach(function (k) {
        if (rolesFromScratch || !(k in S.roles)) S.roles[k] = guess[k] || 'ignore';
      });
    }
    S.layers = newLayers;
    S.pdfData = data; S.pdfPageList = pages;
    measurePdfThickness(data);
    renderLayers();
    var nf = pages.length;
    $('in-floors').disabled = nf > 1;
    $('pdfpages-note').textContent = nf > 1
      ? nf + ' trang → ' + nf + ' tầng (tầng 1 là trang ' + pages[0] + '). Tệp có ' + S.pdf.numPages + ' trang.'
      : 'Một trang: có thể lặp thành nhiều tầng bằng ô "Số tầng". Nhập nhiều trang (13, 14, 15) để mỗi trang là một tầng. Tệp có ' + S.pdf.numPages + ' trang.';
    rebuild(keepView);
    drawPdfPreview();
  }

  /* ---------------- Xem trước trang PDF ---------------- */
  var previewToken = 0;
  async function drawPdfPreview() {
    if (!S.pdf) return;
    var n = Math.min(S.pdf.numPages, Math.max(1, parseInt($('in-viewPage').value, 10) || 1));
    $('in-viewPage').value = n;
    $('viewpage-total').textContent = '/ ' + S.pdf.numPages;
    var tok = ++previewToken, p;
    try { p = await getPdfPage(n); } catch (e) { return; }
    if (tok !== previewToken) return;
    var c = $('pdfPrev'), wCss = c.clientWidth || 340, ratio = p.height / p.width, dpr = Math.min(2, window.devicePixelRatio || 1);
    c.style.aspectRatio = (1 / ratio).toFixed(4);
    c.width = Math.round(wCss * dpr); c.height = Math.round(wCss * ratio * dpr);
    var ctx = c.getContext('2d'), k = c.width / p.width;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    if (!p.ents.length) {
      ctx.fillStyle = '#566474'; ctx.font = (13 * dpr) + 'px sans-serif';
      ctx.fillText('Trang ' + n + ' không có nét vector (trang ảnh hoặc trống)', 12 * dpr, 24 * dpr);
      return;
    }
    var order = ['ignore', 'opening', 'door', 'window', 'slab', 'column', 'wall'];
    var style = {
      ignore: ['#c9cfd6', 0.6], opening: ['#e07a1f', 0.8], door: ['#e07a1f', 1.2], window: ['#1e88e5', 1.2],
      slab: ['#4c9a6a', 1], column: ['#9a5b2e', 1], wall: ['#20262d', 1.6]
    };
    order.forEach(function (role) {
      var st = style[role];
      ctx.strokeStyle = st[0]; ctx.fillStyle = st[0]; ctx.lineWidth = st[1] * dpr;
      ctx.beginPath();
      p.ents.forEach(function (e) {
        var r = S.roles[e.layer] || 'ignore';
        if (r !== role) return;
        if (role === 'column' && e.kind === 'F') return;
        var pts = e.pts;
        ctx.moveTo(pts[0][0] * k, c.height - pts[0][1] * k);
        for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * k, c.height - pts[i][1] * k);
        if (e.closed) ctx.closePath();
      });
      ctx.stroke();
      if (role === 'column') {
        ctx.beginPath();
        p.ents.forEach(function (e) {
          if ((S.roles[e.layer] || 'ignore') !== 'column' || e.kind !== 'F') return;
          var pts = e.pts;
          ctx.moveTo(pts[0][0] * k, c.height - pts[0][1] * k);
          for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * k, c.height - pts[i][1] * k);
          ctx.closePath();
        });
        ctx.fill();
      }
    });
    var floors = S.pdfPageList || [], fi = floors.indexOf(n);
    $('btn-addpage').textContent = fi >= 0 ? 'Đang là tầng ' + (fi + 1) : 'Thêm làm tầng ' + (floors.length + 1);
    $('btn-addpage').disabled = fi >= 0;
  }

  /* ---------------- Dựng lại ---------------- */
  var timer = null;
  function scheduleRebuild(keepView) {
    clearTimeout(timer);
    timer = setTimeout(function () { rebuild(keepView); }, 180);
  }

  function rebuild(keepView) {
    if (!S.kind || !V) return;
    var t0 = performance.now(), cfg = readCfg(), model, msgs = [];
    try {
      if (S.kind === 'img') {
        var auto = $('in-imgAuto').checked;
        var an = Core.analyzeRaster(S.img.gray, S.img.w, S.img.h, {
          threshold: auto ? null : parseInt($('in-imgThresh').value, 10),
          invert: $('in-imgInvert').checked, openRadius: parseInt($('in-imgOpen').value, 10)
        });
        $('out-imgThresh').textContent = auto ? an.threshold : '';
        $('out-imgOpen').textContent = $('in-imgOpen').value;
        drawMask(an.mask, S.img.w, S.img.h);
        cfg.cell = num('in-imgWidth', 12, 0.5, 1000) / S.img.w;
        model = Core.buildFromMask(an.mask, S.img.w, S.img.h, cfg);
      } else if (S.kind === 'pdf') {
        if (!S.pdfData) return;
        var pf = pdfFactor();
        $('pdfscale-note').textContent = pf.note;
        cfg.unitFactor = pf.factor; cfg.roles = S.roles;
        model = Core.buildLevels(S.pdfData.map(function (p) { return { ents: p.ents }; }), cfg);
      } else {
        var u = dxfUnit();
        $('unit-note').textContent = u.note;
        cfg.unitFactor = u.factor; cfg.roles = S.roles;
        model = Core.buildLevels(cadLevels(), cfg);
      }
      if (model.stats.openingsUnmatched) msgs.push(model.stats.openingsUnmatched + ' ô cửa (lớp cửa) không nằm trên tấm tường nào.');
    } catch (e) {
      console.error(e);
      setMsg('Lỗi khi dựng mô hình: ' + e.message, 'err');
      return;
    }
    S.model = model;
    showModel(model, keepView);
    $('empty').hidden = true;
    $('s-export').hidden = false;
    renderStats(model, Math.round(performance.now() - t0));
    var all = (model.warnings || []).concat(msgs);
    if (model.levels && model.levels.length > 1 && S.cad && S.cad.floors.length > 1) {
      all.push('Cao độ: ' + model.levels.map(function (L, i) {
        return (L.kind === 'roof' ? 'mái ' + (model.roof ? '+' + model.roof.eaveZ.toFixed(2) + ' → +' + model.roof.ridgeZ.toFixed(2) : '') : 'cấp ' + (i + 1) + ' +' + L.z0.toFixed(2) + ' (cao ' + L.height.toFixed(2) + ')');
      }).join(', ') + '.');
    }
    if (model.levels && model.levels.length > 1 && (S.kind === 'pdf' || (S.cad && S.cad.floors.length > 1))) {
      all.push('Căn tầng: ' + model.levels.slice(1).map(function (L, i) {
        return 'tầng ' + (i + 2) + ' theo ' + L.align.method + ' (' + L.align.dx.toFixed(2) + '; ' + L.align.dy.toFixed(2) + ' m)';
      }).join(', ') + '.');
    }
    setMsg(all, (model.warnings || []).length || msgs.length ? 'warn' : 'ok');
  }

  function renderStats(m, ms) {
    var b = m.bbox, st = m.stats, el = $('stats');
    el.innerHTML = '';
    function chip(label, val, title) {
      var c = document.createElement('span'); c.className = 'chip';
      c.innerHTML = label + ' <b></b>'; c.querySelector('b').textContent = val;
      if (title) c.title = title;
      el.appendChild(c);
    }
    if (m.levels && m.levels.length > 1) chip('Tầng', m.levels.filter(function (L) { return L.kind !== 'roof'; }).length);
    chip('Tường', st.walls - (st.fenceWalls || 0));
    if (st.fences) chip('Rào, trụ cổng', st.fences, 'Khối tường tầng 1 nằm ngoài nhà, dựng cao 1,8 m');
    if (S.kind !== 'img') {
      chip('Cửa đi', st.doors); chip('Cửa sổ', st.windows);
      if (st.openGaps) chip('Lối thông', st.openGaps, 'Khe rộng không có ký hiệu cửa, để trống');
      if (st.tagged) chip('Cửa theo ký hiệu', st.tagged, 'Ô cửa lấy kích thước, cao độ bệ và đỉnh từ ký hiệu D1, S1... trên bản vẽ');
      if (st.stairs) chip('Cầu thang', st.stairs);
      if (m.roof) chip('Mái', '+' + m.roof.eaveZ.toFixed(2) + ' → +' + m.roof.ridgeZ.toFixed(2) + ' m');
      chip('Cột', st.columns);
    }
    chip('Kích thước', (b[3] - b[0]).toFixed(1) + ' × ' + (b[4] - b[1]).toFixed(1) + ' × ' + b[5].toFixed(1) + ' m');
    chip('Tam giác', m.tris.toLocaleString('vi-VN'));
    chip('Thời gian', ms + ' ms');
  }

  function drawMask(mask, w, h) {
    var c = $('maskPrev'); c.width = w; c.height = h;
    var ctx = c.getContext('2d'), im = ctx.createImageData(w, h);
    for (var i = 0; i < mask.length; i++) {
      var v = mask[i] ? 30 : 255;
      im.data[i * 4] = v; im.data[i * 4 + 1] = v; im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
  }

  /* ---------------- Giao diện theo loại tệp ---------------- */
  function setKind(kind) {
    S.kind = kind;
    document.querySelectorAll('[data-for]').forEach(function (el) {
      el.hidden = el.getAttribute('data-for').split(' ').indexOf(kind) < 0;
    });
    $('s-scale').hidden = false;
    $('s-layers').hidden = !(kind === 'dxf' || kind === 'pdf');
    $('s-params').hidden = false;
    $('in-floors').disabled = false;
    $('layers-hint').hidden = false;
    updateModeFields();
  }

  function updateModeFields() {
    var center = $('in-mode').value === 'center' && S.kind !== 'img';
    $('f-tmin').hidden = center || S.kind === 'img'; $('f-tmax').hidden = center || S.kind === 'img';
    $('f-ct').hidden = !center;
    if (S.kind === 'pdf') {
      var paper = $('sel-pdfScaleMode').value === 'paper';
      $('f-wallRef').hidden = paper; $('f-pdfScale').hidden = !paper;
    }
  }

  function renderLayers() {
    var tb = $('layers').querySelector('tbody');
    tb.innerHTML = '';
    Object.keys(S.layers).sort(function (a, b) {
      var ra = S.roles[a] === 'ignore' ? 1 : 0, rb = S.roles[b] === 'ignore' ? 1 : 0;
      return ra - rb || S.layers[b].n - S.layers[a].n;
    }).forEach(function (name) {
      var tr = document.createElement('tr');
      var td1 = document.createElement('td'); td1.className = 'name'; td1.textContent = name; td1.title = name;
      var td2 = document.createElement('td'); td2.className = 'n'; td2.textContent = S.layers[name].n.toLocaleString('vi-VN');
      var td3 = document.createElement('td'), sel = document.createElement('select');
      sel.setAttribute('aria-label', 'Vai trò của lớp ' + name);
      ROLE_LABELS.forEach(function (r) {
        var o = document.createElement('option'); o.value = r[0]; o.textContent = r[1]; sel.appendChild(o);
      });
      sel.value = S.roles[name] || 'ignore';
      sel.addEventListener('change', function () {
        S.roles[name] = sel.value; S.rolesTouched = true;
        if (S.kind === 'pdf') { measurePdfThickness(S.pdfData || []); drawPdfPreview(); }
        if (S.cad) drawCadPreview();
        scheduleRebuild(true);
      });
      td3.appendChild(sel);
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tb.appendChild(tr);
    });
  }

  /* ---------------- Nạp tệp ---------------- */
  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder('windows-1258').decode(buf); }
  }

  function resetSource() { S.cad = null; scanToken++; S.planPages = []; pageLRU = []; S.rolesTouched = false; S.rolesFromPage = 0; S.pdf = null; S.pdfPages = {}; S.pdfData = null; S.pdfPageList = []; S.pdfThick = null; S.img = null; S.ents = []; S.layers = {}; S.roles = {}; }

  function loadDXFText(text) {
    var p;
    try { p = Core.parseDXF(text); }
    catch (e) { setMsg(e.message, 'err'); return; }
    loadCad(p, 'DXF');
  }

  /* ---------------- DWG: thư viện LibreDWG (WebAssembly) ---------------- */
  var dwgLib = null;
  async function getDwgLib() {
    if (dwgLib) return dwgLib;
    if (!window['libredwg-web']) await loadScript('lib/libredwg.bundle.js');
    if (!window.LIBREDWG_WASM_GZ_B64) await loadScript('lib/libredwg.wasm.js');
    var bin = atob(window.LIBREDWG_WASM_GZ_B64), gz = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
    var wasm = new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    var mod = await window.createModule({ wasmBinary: wasm, locateFile: function (f) { return f; } });
    dwgLib = window['libredwg-web'].LibreDwg.createByWasmInstance(mod);
    return dwgLib;
  }

  async function loadDWG(file) {
    var buf = await file.arrayBuffer(), head = new TextDecoder('ascii').decode(new Uint8Array(buf, 0, 6));
    var ver = { AC1012: 'R13', AC1014: 'R14', AC1015: '2000', AC1018: '2004', AC1021: '2007', AC1024: '2010', AC1027: '2013', AC1032: '2018' }[head] || head;
    setMsg('Đang nạp thư viện đọc DWG (lần đầu mất vài giây)...', '');
    await new Promise(function (r) { setTimeout(r, 30); });
    var lib;
    try { lib = await getDwgLib(); }
    catch (e) {
      console.error(e);
      setMsg(['Không nạp được thư viện đọc DWG: ' + e.message, 'Cần hai tệp lib\\libredwg.bundle.js và lib\\libredwg.wasm.js. Hoặc lưu bản vẽ thành DXF rồi nạp lại.'], 'err');
      return;
    }
    setMsg('Đang đọc bản vẽ DWG ' + ver + '...', '');
    await new Promise(function (r) { setTimeout(r, 30); });
    var db;
    try {
      var types = window['libredwg-web'].Dwg_File_Type;
      var ptr = lib.dwg_read_data(buf, types.DWG);
      if (!ptr) throw new Error('thư viện không đọc được tệp');
      db = lib.convert(ptr);
      lib.dwg_free(ptr);
    } catch (e) {
      console.error(e);
      setMsg(['Không đọc được DWG ' + ver + ': ' + (e && e.message || e), 'Thử lưu bản vẽ thành DXF (Save As) rồi nạp lại.'], 'err');
      return;
    }
    var conv = DwgAdapter.convert(db);
    if (!conv.ents.length) {
      setMsg(['Không đọc được nét vẽ nào trong tệp DWG ' + ver + '. Tệp có thể bị hỏng, được mã hoá, hoặc là phiên bản thư viện chưa hỗ trợ.',
        'Thử mở bằng phần mềm CAD rồi lưu thành DXF và nạp lại.'], 'err');
      return;
    }
    loadCad(conv, 'DWG ' + ver);
  }

  /* ---------------- DXF/DWG: chọn mặt bằng cho từng tầng ---------------- */
  function cadLevels() {
    var c = S.cad;
    if (!c) return [];
    if (!c.floors.length) return [{ ents: S.ents }];
    var m = 1 / c.factor; // nới khung 1 m
    return c.floors.map(function (pi, fi) {
      var p = c.plans[pi], b = p.box;
      return {
        ents: S.ents.filter(function (e) { return DwgAdapter.inBox(e, b, m); }),
        texts: c.texts.filter(function (t) { return t.x >= b[0] - m && t.x <= b[2] + m && t.y >= b[1] - m && t.y <= b[3] + m; }),
        z: typeof c.z[fi] === 'number' && isFinite(c.z[fi]) ? c.z[fi] : undefined,
        kind: DwgAdapter.planKind(p)
      };
    });
  }

  function planLabel(p, i) {
    return (p.title || 'Bản vẽ không tên ' + (i + 1)) + (p.sheet ? ' · ' + p.sheet : '');
  }

  // Lập lại danh sách lớp và vai trò theo các mặt bằng đang chọn
  function refreshCadLayers() {
    var lv = cadLevels(), L = {};
    lv.forEach(function (l) { l.ents.forEach(function (e) { (L[e.layer] || (L[e.layer] = { n: 0 })).n++; }); });
    S.layers = L;
    Object.keys(L).forEach(function (k) { if (!(k in S.roles)) S.roles[k] = Core.guessRole(k); });
    if (!S.rolesTouched) {
      var all = [].concat.apply([], lv.map(function (l) { return l.ents; }));
      var sug = Core.suggestColumns(all, S.roles, S.cad.factor);
      Object.keys(sug).forEach(function (k) { S.roles[k] = sug[k]; });
    }
    renderLayers();
    $('in-floors').disabled = S.cad.floors.length > 1;
  }

  function renderFloorList() {
    var c = S.cad, box = $('floorlist');
    box.innerHTML = '';
    $('cadplans').hidden = !c.plans.length;
    var nFloor = 0;
    c.floors.forEach(function (pi, fi) {
      var row = document.createElement('div'); row.className = 'floorrow';
      var kind = DwgAdapter.planKind(c.plans[pi]), attic = /[áa]p\s*m[áa]i/i.test(c.plans[pi].title || '');
      var lab = document.createElement('label'); lab.htmlFor = 'floor-' + fi;
      lab.textContent = kind === 'roof' ? 'Mái' : attic ? 'Áp mái' : 'Tầng ' + (++nFloor);
      var sel = document.createElement('select'); sel.id = 'floor-' + fi;
      c.plans.forEach(function (p, i) { var o = document.createElement('option'); o.value = i; o.textContent = planLabel(p, i); sel.appendChild(o); });
      sel.value = pi;
      sel.addEventListener('change', function () { c.floors[fi] = +sel.value; c.z[fi] = undefined; afterFloorsChanged(); });
      var zi = document.createElement('input'); zi.type = 'number'; zi.step = '0.05'; zi.className = 'zin';
      zi.id = 'floorz-' + fi; zi.placeholder = 'tự động';
      zi.title = kind === 'roof' ? 'Cao độ đỉnh mái (m)' : 'Cao độ sàn (m)';
      zi.setAttribute('aria-label', (kind === 'roof' ? 'Cao độ đỉnh mái ' : 'Cao độ sàn ') + lab.textContent);
      if (typeof c.z[fi] === 'number' && isFinite(c.z[fi])) zi.value = c.z[fi].toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
      zi.addEventListener('input', function () { var v = parseFloat(zi.value); c.z[fi] = isFinite(v) ? v : null; scheduleRebuild(true); });
      var del = document.createElement('button'); del.type = 'button'; del.className = 'ghost'; del.textContent = 'Bỏ';
      del.setAttribute('aria-label', 'Bỏ tầng ' + (fi + 1));
      del.addEventListener('click', function () { c.floors.splice(fi, 1); c.z.splice(fi, 1); afterFloorsChanged(); });
      row.appendChild(lab); row.appendChild(sel); row.appendChild(zi); row.appendChild(del); box.appendChild(row);
    });
    $('btn-addfloor').hidden = !c.plans.length;
    $('btn-wholecad').hidden = !c.floors.length;
  }

  function fillLevels() {
    var c = S.cad, auto = DwgAdapter.planLevels(c.plans, c.floors.map(function (i) { return c.plans[i]; }), c.texts, c.factor);
    c.floors.forEach(function (pi, fi) { if (c.z[fi] === undefined) c.z[fi] = auto[fi]; });
  }

  function afterFloorsChanged() {
    fillLevels();
    renderFloorList(); refreshCadLayers(); drawCadPreview(); rebuild(false);
  }

  function drawCadPreview() {
    var c = S.cad, cv = $('cadPrev');
    if (!c) return;
    // vùng hiển thị: các mặt bằng tìm được (hoặc cả bản vẽ)
    var bb = [Infinity, Infinity, -Infinity, -Infinity];
    (c.plans.length ? c.plans.map(function (p) { return p.box; }) : [c.extent]).forEach(function (b) {
      bb[0] = Math.min(bb[0], b[0]); bb[1] = Math.min(bb[1], b[1]); bb[2] = Math.max(bb[2], b[2]); bb[3] = Math.max(bb[3], b[3]);
    });
    var pad = 0.04 * Math.max(bb[2] - bb[0], bb[3] - bb[1]); bb = [bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad];
    var dpr = Math.min(2, window.devicePixelRatio || 1), wCss = cv.clientWidth || 340, ratio = Math.min(1.4, Math.max(0.3, (bb[3] - bb[1]) / (bb[2] - bb[0])));
    cv.width = Math.round(wCss * dpr); cv.height = Math.round(wCss * ratio * dpr); cv.style.aspectRatio = (1 / ratio).toFixed(4);
    var k = Math.min(cv.width / (bb[2] - bb[0]), cv.height / (bb[3] - bb[1]));
    var ox = (cv.width - (bb[2] - bb[0]) * k) / 2, oy = (cv.height - (bb[3] - bb[1]) * k) / 2;
    function X(x) { return ox + (x - bb[0]) * k; } function Y(y) { return cv.height - oy - (y - bb[1]) * k; }
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    var st = { wall: ['#20262d', 1.2], column: ['#9a5b2e', 1], opening: ['#e07a1f', 0.7], door: ['#e07a1f', 0.7], window: ['#1e88e5', 0.7] };
    ['other', 'opening', 'door', 'window', 'column', 'wall'].forEach(function (role) {
      ctx.strokeStyle = st[role] ? st[role][0] : '#d3d8de'; ctx.lineWidth = (st[role] ? st[role][1] : 0.5) * dpr;
      ctx.beginPath();
      S.ents.forEach(function (e) {
        var r = S.roles[e.layer] || 'ignore'; if (!st[r]) r = 'other';
        if (r !== role) return;
        var p = e.pts, x0 = p[0][0], y0 = p[0][1];
        if (x0 < bb[0] || x0 > bb[2] || y0 < bb[1] || y0 > bb[3]) return;
        ctx.moveTo(X(x0), Y(y0));
        for (var i = 1; i < p.length; i++) ctx.lineTo(X(p[i][0]), Y(p[i][1]));
        if (e.closed) ctx.closePath();
      });
      ctx.stroke();
    });
    ctx.font = (11 * dpr) + 'px system-ui, sans-serif'; ctx.textBaseline = 'top';
    c.plans.forEach(function (p, i) {
      var fi = c.floors.indexOf(i), b = p.box;
      ctx.lineWidth = (fi >= 0 ? 2 : 1) * dpr;
      ctx.strokeStyle = fi >= 0 ? '#1d5fd1' : 'rgba(86,100,116,0.45)';
      ctx.strokeRect(X(b[0]), Y(b[3]), (b[2] - b[0]) * k, (b[3] - b[1]) * k);
      if (fi >= 0) {
        var tag = 'T' + (fi + 1), tw = ctx.measureText(tag).width + 8 * dpr;
        ctx.fillStyle = '#1d5fd1'; ctx.fillRect(X(b[0]), Y(b[3]), tw, 15 * dpr);
        ctx.fillStyle = '#fff'; ctx.fillText(tag, X(b[0]) + 4 * dpr, Y(b[3]) + 2 * dpr);
      }
    });
  }

  function loadCad(p, label) {
    if (!p.ents.length) { setMsg('Bản vẽ không có đối tượng vẽ nào được hỗ trợ (LINE, POLYLINE, ARC, CIRCLE, INSERT, HATCH).', 'err'); return; }
    resetSource();
    S.ents = p.ents; S.insunits = p.insunits;
    Object.keys(p.layers).forEach(function (n) { S.roles[n] = Core.guessRole(n); });
    var u = Core.autoUnit(S.ents, S.insunits, S.roles);
    var ext = [Infinity, Infinity, -Infinity, -Infinity];
    S.ents.forEach(function (e) { e.pts.forEach(function (q) { if (q[0] < ext[0]) ext[0] = q[0]; if (q[0] > ext[2]) ext[2] = q[0]; if (q[1] < ext[1]) ext[1] = q[1]; if (q[1] > ext[3]) ext[3] = q[1]; }); });
    var factor = $('sel-unit').value !== 'auto' ? parseFloat($('sel-unit').value) : u.factor;
    var plans = DwgAdapter.findPlans(S.ents, p.texts || [], S.roles, factor);
    // Chỉ dùng chế độ chọn mặt bằng khi bản vẽ có nhiều bản vẽ đặt cạnh nhau
    var multi = plans.length >= 2 || (plans.length === 1 && Math.max(ext[2] - ext[0], ext[3] - ext[1]) > 3 * Math.max(plans[0].box[2] - plans[0].box[0], plans[0].box[3] - plans[0].box[1]));
    if (!multi) plans = [];
    var floors = plans.length ? DwgAdapter.pickFloors(plans).map(function (pl) { return plans.indexOf(pl); }) : [];
    S.cad = { plans: plans, floors: floors, z: [], factor: factor, extent: ext, texts: p.texts || [], label: label };
    fillLevels();
    setKind('dxf');
    renderFloorList();
    refreshCadLayers();
    var nWall = Object.keys(S.layers).filter(function (k) { return S.roles[k] === 'wall'; }).length, note = [];
    if (!nWall) {
      var top = Object.keys(S.layers).sort(function (a, b) { return S.layers[b].n - S.layers[a].n; })[0];
      S.roles[top] = 'wall'; renderLayers();
      note.push('Không có tên lớp nào giống "tường", tạm chọn lớp "' + top + '" (nhiều nét nhất). Hãy chỉnh lại vai trò các lớp ở mục 3.');
    }
    $('fileinfo').textContent = label + ': ' + p.ents.length.toLocaleString('vi-VN') + ' nét, ' + Object.keys(p.layers).length + ' lớp' + (plans.length ? ', ' + plans.length + ' bản vẽ' : '');
    drawCadPreview();
    rebuild(false);
    if (plans.length) note.unshift('Tìm thấy ' + plans.length + ' bản vẽ trong tệp. Đã chọn ' + floors.length + ' mặt bằng làm ' + floors.length + ' tầng' +
      (floors.length ? ' (' + floors.map(function (i) { return planLabel(plans[i], i); }).join('; ') + ')' : '') + '. Đổi ở mục 2 nếu chưa đúng.');
    if (note.length) setMsg(note.concat(S.model && S.model.warnings || []), 'warn');
  }

  async function loadPDF(file) {
    setMsg('Đang mở PDF...', '');
    try {
      var doc = await PdfVec.open(new Uint8Array(await file.arrayBuffer()));
      resetSource();
      S.pdf = doc;
      $('in-viewPage').max = doc.numPages;
      setKind('pdf');
      $('fileinfo').textContent = doc.numPages + ' trang';
      // Dò trang mặt bằng đầu tiên: trang có lớp tường ghép được thành nhiều tấm cùng bề dày
      var start = 0, firstVec = 0, lim = Math.min(doc.numPages, 40), n;
      S.planPages = [];
      for (n = 1; n <= lim && !start; n++) {
        setMsg('Đang tìm trang mặt bằng... trang ' + n + '/' + doc.numPages, '');
        var pg = await getPdfPage(n, true);
        if (!pg.ents.length) continue;
        if (!firstVec) firstVec = n;
        if (looksLikePlan(pg)) { start = n; S.planPages.push(n); }
        await new Promise(function (r) { setTimeout(r, 0); });
      }
      var scanFrom = n;
      start = start || firstVec || 1;
      $('in-pdfPages').value = String(start);
      $('in-viewPage').value = start;
      await refreshPdf(false, true);
      scanPlans(scanFrom, doc);
    } catch (e) {
      console.error(e);
      setMsg('Không đọc được PDF: ' + e.message, 'err');
    }
  }

  async function loadImage(file) {
    var url = URL.createObjectURL(file), img = new Image();
    try {
      await new Promise(function (res, rej) { img.onload = res; img.onerror = function () { rej(new Error('Ảnh không đọc được')); }; img.src = url; });
    } catch (e) { setMsg(e.message, 'err'); URL.revokeObjectURL(url); return; }
    var maxS = 900, k = Math.min(1, maxS / Math.max(img.naturalWidth, img.naturalHeight));
    var w = Math.max(8, Math.round(img.naturalWidth * k)), h = Math.max(8, Math.round(img.naturalHeight * k));
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    var d = ctx.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h);
    for (var i = 0; i < gray.length; i++) gray[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
    resetSource();
    S.img = { gray: gray, w: w, h: h };
    setKind('img');
    $('fileinfo').textContent = img.naturalWidth + ' × ' + img.naturalHeight + ' px';
    rebuild(false);
    var base = S.model && S.model.warnings || [];
    setMsg(['Ảnh chỉ cho ra khối tường thô. Nhập chiều rộng thật của ảnh để đúng tỉ lệ, rồi chỉnh độ dày nét và ngưỡng cho đến khi vùng tường ở ô xem trước là các mảng đen liền.'].concat(base), 'warn');
  }

  async function handleFile(file) {
    if (!file) return;
    if (!V) { setMsg('Thư viện 3D chưa nạp được. Kiểm tra thư mục lib (cần lib\\three.bundle.js).', 'err'); return; }
    var ext = file.name.split('.').pop().toLowerCase();
    S.name = file.name.replace(/\.[^.]+$/, '');
    if (ext === 'dxf') loadDXFText(decodeText(await file.arrayBuffer()));
    else if (ext === 'dwg') await loadDWG(file);
    else if (ext === 'pdf') await loadPDF(file);
    else if (/^(png|jpe?g|webp|bmp|gif)$/.test(ext)) await loadImage(file);
    else setMsg('Định dạng .' + ext + ' chưa được hỗ trợ.', 'err');
  }

  /* ---------------- Xuất file ---------------- */
  function download(name, data, mime) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  function exportScale() { return parseFloat($('sel-exunit').value) || 1; }
  function unitsCode() { var s = exportScale(); return s === 1000 ? 4 : s === 100 ? 5 : 6; }

  function wireExport() {
    $('btn-dxf').addEventListener('click', function () {
      if (!S.model) return;
      download(S.name + '-3d.dxf', Core.toDXF3D(S.model, exportScale(), unitsCode()), 'application/dxf');
    });
    $('btn-obj').addEventListener('click', function () {
      if (!S.model) return;
      var r = Core.toOBJ(S.model, exportScale(), S.name + '-3d.mtl');
      download(S.name + '-3d.obj', r.obj, 'text/plain');
      setTimeout(function () { download(S.name + '-3d.mtl', r.mtl, 'text/plain'); }, 400);
      setMsg('Đã xuất 2 tệp: .obj và .mtl. Để hai tệp cùng thư mục khi nhập vào phần mềm 3D.', 'ok');
    });
    $('btn-stl').addEventListener('click', function () {
      if (!S.model) return;
      download(S.name + '-3d.stl', new Blob([Core.toSTL(S.model, exportScale())], { type: 'model/stl' }));
    });
    $('btn-glb').addEventListener('click', function () {
      if (!S.model) return;
      download(S.name + '-3d.glb', new Blob([Core.toGLB(S.model)], { type: 'model/gltf-binary' }));
    });
  }

  /* ---------------- Khởi động ---------------- */
  function wireUI() {
    var drop = $('drop');
    $('file').addEventListener('change', function (e) { handleFile(e.target.files[0]); e.target.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { handleFile(e.dataTransfer.files[0]); });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); if (e.target !== drop && !drop.contains(e.target)) handleFile(e.dataTransfer.files[0]); });

    $('btn-sample').addEventListener('click', function () {
      if (!V) { setMsg('Thư viện 3D chưa nạp được.', 'err'); return; }
      S.name = 'ban-ve-mau'; loadDXFText(Core.sampleDXF());
    });

    ['in-wallH', 'in-floors', 'in-slabT', 'in-tMin', 'in-tMax', 'in-centerT', 'in-doorH', 'in-winSill', 'in-winH',
     'in-autoSlab', 'in-roof', 'in-glass', 'in-infer', 'in-align', 'in-fence', 'in-stairs', 'in-eave', 'sel-unit', 'in-pdfScale', 'in-wallRef',
     'in-imgWidth', 'in-imgOpen', 'in-imgThresh', 'in-imgAuto', 'in-imgInvert']
      .forEach(function (id) { $(id).addEventListener('input', function () { scheduleRebuild(true); }); });
    $('in-mode').addEventListener('change', function () { updateModeFields(); scheduleRebuild(true); });
    $('sel-pdfScaleMode').addEventListener('change', function () { updateModeFields(); scheduleRebuild(true); });
    $('sel-cut').addEventListener('change', applyCut);
    $('in-overlay').addEventListener('change', function () { if (V && V.overlay) V.overlay.visible = $('in-overlay').checked; });
    $('in-imgThresh').addEventListener('input', function () { $('in-imgAuto').checked = false; });

    var pagesTimer = null;
    $('in-pdfPages').addEventListener('input', function () {
      clearTimeout(pagesTimer);
      pagesTimer = setTimeout(function () { if (S.pdf) refreshPdf(false, false); }, 500);
    });
    $('in-viewPage').addEventListener('input', drawPdfPreview);
    $('btn-prev').addEventListener('click', function () { $('in-viewPage').value = Math.max(1, (+$('in-viewPage').value || 1) - 1); drawPdfPreview(); });
    $('btn-next').addEventListener('click', function () { $('in-viewPage').value = Math.min(S.pdf ? S.pdf.numPages : 1, (+$('in-viewPage').value || 1) + 1); drawPdfPreview(); });
    $('btn-addpage').addEventListener('click', function () {
      if (!S.pdf) return;
      var cur = parsePages($('in-pdfPages').value, S.pdf.numPages), n = +$('in-viewPage').value;
      if (cur.indexOf(n) >= 0) return;
      cur.push(n);
      $('in-pdfPages').value = cur.join(', ');
      refreshPdf(false, false);
    });
    $('btn-addfloor').addEventListener('click', function () {
      var c = S.cad; if (!c || !c.plans.length) return;
      var last = c.floors.length ? c.floors[c.floors.length - 1] : -1;
      // gợi ý: mặt bằng kế tiếp cùng hàng (bên phải tầng cuối)
      var lb = last >= 0 ? c.plans[last].box : null, next = -1, best = Infinity;
      c.plans.forEach(function (p, i) {
        if (c.floors.indexOf(i) >= 0) return;
        var d = lb ? (Math.abs(p.box[3] - lb[3]) * 3 + Math.max(0, p.box[0] - lb[0]) + (p.box[0] < lb[0] ? 1e12 : 0)) : i;
        if (d < best) { best = d; next = i; }
      });
      if (next < 0) next = 0;
      c.floors.push(next); c.z.push(undefined); afterFloorsChanged();
    });
    $('btn-wholecad').addEventListener('click', function () { if (S.cad) { S.cad.floors = []; S.cad.z = []; afterFloorsChanged(); } });
    wireExport();
  }

  async function boot() {
    wireUI();
    var st = $('libstatus');
    try {
      st.textContent = 'Đang nạp thư viện 3D...';
      var src = await loadThree();
      T = window.THREE;
      initViewer();
      st.textContent = 'Three.js r' + T.REVISION + (/^https?:/.test(src) ? ' (từ mạng)' : '');
    } catch (e) {
      st.className = 'libstatus err';
      st.textContent = 'Chưa nạp được Three.js. Cần tệp lib\\three.bundle.js (hoặc chạy tai_thu_vien.bat khi có mạng).';
    }
  }

  boot();
})();
