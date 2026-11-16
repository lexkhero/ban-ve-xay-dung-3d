# Tạo PDF mặt bằng mẫu (vector) để kiểm thử: nhà 10 x 8 m vẽ ở tỉ lệ 1:100 trên A4 ngang, có 2 trang (2 tầng).
# Tường 220 vẽ hai nét dày 1.4pt, cửa sổ 3 nét mảnh, cửa đi có cung, cột tô xám, chữ giả bằng nét 0.5pt.
# Chạy: python3 tools/make_test_pdf.py mau/nha-mau.pdf
import sys, zlib, math
MM = 72 / 25.4
S = 1 / 100  # tỉ lệ
def p(xm):   # mét -> pt trên giấy
    return xm * 1000 * S * MM

def page(ox, oy, floor):
    c = []
    def rect_walls(x0, y0, x1, y1, t, gaps):
        # tường dạng hai nét song song, chừa khe (gaps: [(cạnh, từ, đến)])
        pass
    c.append('q 1.4 w 0 0 0 RG')
    W, H, t = 10.0, 8.0, 0.22
    def seg(x0, y0, x1, y1):
        c.append('%.3f %.3f m %.3f %.3f l S' % (ox + p(x0), oy + p(y0), ox + p(x1), oy + p(y1)))
    def hwall(y, xa, xb, gaps):  # tường ngang từ xa tới xb, mặt dưới tại y
        xs = [xa] + [v for g in gaps for v in g] + [xb]
        for i in range(0, len(xs), 2):
            a, b = xs[i], xs[i + 1]
            seg(a, y, b, y); seg(a, y + t, b, y + t)
            seg(a, y, a, y + t); seg(b, y, b, y + t)
    def vwall(x, ya, yb, gaps):
        ys = [ya] + [v for g in gaps for v in g] + [yb]
        for i in range(0, len(ys), 2):
            a, b = ys[i], ys[i + 1]
            seg(x, a, x, b); seg(x + t, a, x + t, b)
            seg(x, a, x + t, a); seg(x, b, x + t, b)
    hwall(0, 0, W, [(1.5, 2.7), (6.0, 7.2)])          # mặt trước: 2 cửa sổ 1.2 m
    hwall(H - t, 0, W, [(4.0, 4.9)] if floor == 1 else [])  # mặt sau: cửa đi 0.9 ở tầng 1
    vwall(0, 0, H, [])
    vwall(W - t, 0, H, [(3.0, 4.5)])                  # hông phải: cửa sổ 1.5 m
    vwall(4.9, t, H - t, [(3.0, 3.9)])                # tường ngăn có cửa đi 0.9 m
    c.append('Q')
    # ký hiệu cửa sổ: 3 nét mảnh song song trong khe
    c.append('q 0.2 w 0 0 0 RG')
    for (a, b) in [(1.5, 2.7), (6.0, 7.2)]:
        for k in (0.0, 0.11, 0.22):
            seg(a, k, b, k)
    for k in (0.0, 0.11, 0.22):
        seg(W - t + k, 3.0, W - t + k, 4.5)
    # cửa đi: cánh + cung 1/4 (bezier)
    def door(hx, hy, r, a0, a1):
        kk = 0.5523 * r
        x0, y0 = hx + r * math.cos(a0), hy + r * math.sin(a0)
        x1, y1 = hx + r * math.cos(a1), hy + r * math.sin(a1)
        c.append('%.3f %.3f m %.3f %.3f l S' % (ox + p(hx), oy + p(hy), ox + p(x1), oy + p(y1)))
        c1 = (x0 - kk * math.sin(a0), y0 + kk * math.cos(a0)); c2 = (x1 + kk * math.sin(a1), y1 - kk * math.cos(a1))
        c.append('%.3f %.3f m %.3f %.3f %.3f %.3f %.3f %.3f c S' % (ox + p(x0), oy + p(y0), ox + p(c1[0]), oy + p(c1[1]), ox + p(c2[0]), oy + p(c2[1]), ox + p(x1), oy + p(y1)))
    door(4.9 + t, 3.0, 0.9, math.pi / 2, math.pi)      # cửa tường ngăn, mở sang trái
    if floor == 1:
        door(4.0, H - t, 0.9, 0, -math.pi / 2)          # cửa mặt sau mở vào trong
    c.append('Q')
    # cột tô xám ở 4 góc
    c.append('q 0.3 0.3 0.3 rg')
    for (x, y) in [(0, 0), (W - 0.3, 0), (0, H - 0.3), (W - 0.3, H - 0.3)]:
        c.append('%.3f %.3f %.3f %.3f re f' % (ox + p(x), oy + p(y), p(0.3), p(0.3)))
    c.append('Q')
    # "chữ" giả và đường kích thước
    c.append('q 0.5 w 0 0 0 RG')
    for i in range(40):
        c.append('%.3f %.3f m %.3f %.3f l S' % (ox + i * 3, oy - 30, ox + i * 3 + 2, oy - 26))
    c.append('Q')
    c.append('q 0.7 w %.3f %.3f m %.3f %.3f l S Q' % (ox, oy - 15, ox + p(W), oy - 15))
    return '\n'.join(c).encode()

def build(path):
    objs = []
    def add(b): objs.append(b); return len(objs)
    pages_id = 2
    add(b'<< /Type /Catalog /Pages 2 0 R >>')
    add(b'')  # chỗ cho Pages
    kids = []
    for floor, (ox, oy) in ((1, (120, 120)), (2, (128, 116))):   # trang 2 lệch nhẹ để thử căn tầng
        data = zlib.compress(page(ox, oy, floor))
        cid = add(b'<< /Length %d /Filter /FlateDecode >>\nstream\n' % len(data) + data + b'\nendstream')
        pid = add(b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents %d 0 R /Resources << >> >>' % cid)
        kids.append(pid)
    objs[1] = b'<< /Type /Pages /Kids [' + b' '.join(b'%d 0 R' % k for k in kids) + b'] /Count %d >>' % len(kids)
    out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'); offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out)); out += b'%d 0 obj\n' % i + o + b'\nendobj\n'
    x = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1)
    for o in offs: out += b'%010d 00000 n \n' % o
    out += b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, x)
    open(path, 'wb').write(out)

build(sys.argv[1] if len(sys.argv) > 1 else 'mau/nha-mau.pdf')
