# Dựng 3D từ bản vẽ

Công cụ chạy trên trình duyệt: nạp bản vẽ mặt bằng (DWG, DXF, PDF vector hoặc ảnh), tự dựng tường, cửa, cột, sàn thành mô hình 3D nhiều tầng, rồi xuất ra DXF 3D, OBJ, STL, GLB để mở tiếp trong AutoCAD, SketchUp, Blender.

Không cần mạng, không cần cài đặt: mở `index.html` bằng Chrome hoặc Edge là dùng được. Three.js (bản r187 từ thư mục `three.js-master`) đã được đóng gói sẵn ở `lib\three.bundle.js`. PDF được đọc bằng bộ đọc riêng (`pdfvec.js`), không cần PDF.js.

## Cách dùng với bản vẽ CAD (DWG, DXF)

1. Mở `index.html`, kéo tệp `.dwg` (hoặc `.dxf`) vào ô bên trái. DWG được đọc ngay trên trình duyệt bằng thư viện LibreDWG (lần đầu mất khoảng 5 đến 10 giây).
2. Bản vẽ thường đặt nhiều tờ trong Model. Công cụ tìm các mặt bằng theo tiêu đề "MẶT BẰNG TẦNG ..." và tên tờ trong khung tên, rồi tự chọn:
   - tầng 1, 2, 3...: ưu tiên tờ **Bố trí cửa** (có ký hiệu cửa), sau đó tờ Tường xây;
   - **áp mái** và **tầng mái** nếu có.
3. Ở mục 2, mỗi tầng có một ô **cao độ sàn**, tự điền từ ghi chú ±0.000, +3.750... (đối chiếu với mặt cắt, mặt đứng). Với mái, ô này là cao độ đỉnh mái. Sửa tay được; để trống thì xếp chồng theo cao tầng.
4. Vai trò lớp được đoán theo tên lớp kiểu Việt Nam: `Net cat` là tường, `Net cat-Betong` hoặc hatch ô vuông là cột, `Cua` là ký hiệu cửa, `Hatch-Mai` là mái; các lớp trục, kích thước, ký hiệu, nội thất bị bỏ qua.
5. Các tờ nằm cách nhau nên các tầng được tự căn theo cột, tường hoặc vòng tròn ký hiệu trục.
6. Dùng ô **Xem cắt** trên khung 3D để bỏ phần phía trên một tầng hoặc cắt ngang ở cao 1,2 m, xem bên trong (cầu thang, vách ngăn).

### Những gì được dựng

| Thứ | Cách làm |
|---|---|
| Cao độ, cao tầng | Theo ghi chú cao độ trên bản vẽ (ví dụ 0, 3,75, 7,15, áp mái 10,55, đỉnh mái 14,15) |
| Cửa đi, cửa sổ | Khe hở tường; kích thước, bệ và đỉnh lấy theo ký hiệu D1, S4... (`3550x2600`, `+0.800`, `+2.410`) ghi cạnh cửa |
| Cầu thang | Nhóm từ 5 nét bậc song song cách đều 0,2–0,36 m; các vế nối thành đường đi, có chiếu nghỉ; sàn tầng trên được khoét lỗ |
| Mái | Mái dốc đều nhiều mặt (mái 4 mái) trên hình chữ nhật bao các mặt mái tô trong mặt bằng mái và tường tầng trên cùng; mép mái ở sàn tầng dưới mái, đỉnh theo cao độ mặt bằng mái |
| Tầng áp mái | Tường, cột được cắt theo mặt mái; phần nằm ngoài mái cao 1,1 m như lan can |
| Tường rào, trụ cổng | Khối tường tầng 1 nằm ngoài nhà, cao 1,8 m |

Với tệp `ANH_LUYỆN.dwg` (DWG 2007): 18 bản vẽ; dựng tầng 1–3 từ tờ Bố trí cửa, áp mái và mái từ tờ Tường xây; nhà khoảng 11,4 × 16,7 m, mái 4 mái từ +10,55 lên +14,15; 34 ô cửa lấy kích thước theo ký hiệu; 3 cầu thang chữ U quanh thang máy.

## Cách dùng với PDF hồ sơ thiết kế

1. Mở `index.html`, kéo tệp PDF vào ô bên trái. Công cụ tự tìm trang giống mặt bằng đầu tiên và liệt kê các trang giống mặt bằng khác (dòng "Trang giống mặt bằng").
2. Ở ô **Trang mặt bằng của từng tầng**, nhập các trang theo thứ tự từ tầng 1 lên, ví dụ `13, 14, 15`. Nên dùng các trang **mặt bằng xây tường** vì ít nét thừa nhất. Có thể lật trang ở khung xem trước rồi bấm **Thêm làm tầng**.
3. Kiểm tra khung xem trước: tường màu đen đậm, cột màu nâu, ký hiệu cửa màu cam. Sai thì đổi vai trò ở mục 3 (PDF không có tên lớp nên các nét được nhóm theo màu và độ dày).
4. Tỉ lệ: mặc định tính **theo bề dày tường chính** (220 mm). Bản PDF thường được in thu nhỏ cho vừa khổ giấy nên tỉ lệ "1/100" ghi trên khung tên không còn đúng. Dòng ghi chú cho biết tỉ lệ thực tương đương, ví dụ 1:70.
5. Các tầng được tự căn theo vị trí cột (hoặc tường nếu không có cột), vì mỗi trang PDF thường lệch nhau vài milimét.
6. Chỉnh cao tầng, cao cửa, bệ cửa sổ nếu cần, rồi xuất file ở mục cuối (chọn mm khi đưa vào SketchUp hoặc AutoCAD).

Với hồ sơ nhà A Phước (tệp `KTTC_NHA_A_PHUOC`), nhập trang `13, 14, 15` (mặt bằng xây tường tầng 1, 2, 3) sẽ ra nhà 3 tầng khoảng 16,9 × 8,7 m.

## Công cụ tự nhận những gì

| Thứ | Cách nhận |
|---|---|
| Tường | Ghép từng cặp nét song song gần nhau nhất trên lớp Tường |
| Cửa sổ | Khe hở giữa hai đoạn tường thẳng hàng, bên trong có từ 2 nét mảnh song song (kính) |
| Cửa đi | Khe hở có cung cánh cửa (kể cả cửa xếp nhiều cánh), hoặc khe hẹp hơn 1,6 m không có ký hiệu |
| Lối thông | Khe rộng hơn 1,6 m không có ký hiệu: để trống, không có lanh tô |
| Cột | Vùng tô kín gần vuông, cỡ 0,6 đến 5 lần bề dày tường |
| Tỉ lệ | Bề dày tường xuất hiện nhiều nhất = bề dày tường chính bạn nhập |

Bật **Hiện nét bản vẽ 2D** để đối chiếu: các ô cửa tự nhận được đánh dấu trên sàn (cam là cửa đi, xanh là cửa sổ, xám là lối thông).

## Ảnh
- **Ảnh scan, PDF scan**: chỉ dựng khối tường thô theo vùng đen đậm, không có cửa. Nhập chiều rộng thật của ảnh để đúng tỉ lệ.

## Giới hạn

- Mái chỉ dựng đúng cho mái dốc đều trên đường bao chữ nhật (mái 4 mái). Mái chữ L, mái có nhiều cao độ, mái sảnh thấp chưa được dựng.
- Hướng đi lên của cầu thang được đoán (nối tiếp điểm cuối thang tầng dưới); thang dựng đặc, chưa có lan can tay vịn.
- Sàn mỗi tầng lấy theo bao lồi của tường, nên sân thượng, ban công lõm vẫn bị phủ sàn.
- Khe rộng hơn 1,6 m không có ký hiệu được để trống (lối thông), không có lanh tô.
- Ảnh scan, PDF scan chỉ dựng khối tường thô theo vùng đen đậm, không có cửa.

## Các tệp

| Tệp | Việc |
|---|---|
| `index.html`, `style.css`, `app.js` | Giao diện và khung xem 3D |
| `core.js` | Lõi: đọc DXF, ghép tường, nhận cửa và cột, hiệu chỉnh tỉ lệ, căn và chồng tầng, xuất file |
| `pdfvec.js` | Bộ đọc nét vector PDF viết thuần JavaScript |
| `dwgadapter.js` | Chuyển dữ liệu DWG thành nét (bung block, cung, hatch, chữ), tìm mặt bằng và chọn tầng |
| `lib\libredwg.bundle.js`, `lib\libredwg.wasm.js` | Thư viện đọc DWG @mlightcad/libredwg-web 0.8.3 (LibreDWG, giấy phép GPL-3.0), đóng gói để chạy từ file:// |
| `vendor\package` | Mã gốc của thư viện đọc DWG, dùng khi cần đóng gói lại |
| `tools\bundle_libredwg.js` | Đóng gói lại thư viện đọc DWG: `node tools\bundle_libredwg.js vendor\package lib` |
| `lib\three.bundle.js` | Three.js r187 kèm OrbitControls, đóng gói thành script thường |
| `tai_thu_vien.bat` | Đóng gói lại `lib\three.bundle.js` sau khi cập nhật `three.js-master` (cần Node.js) |
| `tools\bundle_three.js` | Script đóng gói Three.js |
| `tools\make_test_pdf.py` | Tạo PDF mặt bằng mẫu `mau\nha-mau.pdf` |
| `mau\nha-mau.dxf`, `mau\nha-mau.pdf` | Bản vẽ mẫu để thử |
| `test\` | Kiểm thử: `node test\test_core.js`, `node test\test_pdf.js [tệp.pdf 13,14,15]`, `python test\ui_smoke.py`, `python test\real_dwg.py tệp.dwg ảnh.png` |

Lưu ý giấy phép: thư viện đọc DWG dùng giấy phép GPL-3.0. Dùng nội bộ thì không sao; nếu phân phối công cụ ra ngoài kèm thư viện này thì phải công bố mã nguồn theo GPL.
