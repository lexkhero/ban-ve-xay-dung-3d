# Máy chủ thống kê, lưu bản vẽ, báo lỗi (Google Apps Script)

Trang trên GitHub Pages là trang tĩnh, không tự lưu được dữ liệu. Phần lưu nằm ở một Web app Google Apps Script
chạy bằng tài khoản Google của bạn, miễn phí:

- **Trang tính** "Dựng 3D - thống kê và bản vẽ" gồm 4 tờ:
  - `ThongKe`: tổng lượt truy cập, số khách, lượt theo ngày, số bản vẽ, số bản vẽ bị báo lỗi.
  - `TruyCap`: từng lượt vào trang.
  - `BanVe`: mỗi bản vẽ một dòng, gồm số lần mở, kết quả tự động, trạng thái `LỖI`, liên kết tệp.
  - `BaoLoi`: từng lần báo lỗi, gồm loại lỗi, mô tả, liên hệ, ảnh chụp.
- **Thư mục Drive** "Dựng 3D - bản vẽ người dùng": tệp bản vẽ (mỗi tệp chỉ lưu một lần, nhận diện bằng mã SHA-256) và thư mục con "Ảnh báo lỗi".

## Cài đặt (làm một lần, khoảng 10 phút)

1. Vào https://script.google.com, bấm **Dự án mới** (New project). Đặt tên, ví dụ "Dung 3D may chu".
2. Xoá nội dung có sẵn trong `Code.gs`, dán toàn bộ tệp `server/Code.gs` vào, bấm Lưu.
3. Ở thanh trên, chọn hàm **setup** rồi bấm **Chạy** (Run).
   - Google hỏi quyền (xem, tạo trang tính và tệp Drive). Chọn tài khoản, bấm **Nâng cao** (Advanced), rồi **Đi tới … (không an toàn)**, rồi **Cho phép**.
     Cảnh báo này xuất hiện vì script là của bạn, chưa qua Google duyệt.
   - Xem **Nhật ký thực thi** (Execution log). Có 3 dòng: địa chỉ trang tính, địa chỉ thư mục, và **khoá quản trị ADMIN_KEY**. Chép khoá lại.
4. Bấm **Triển khai** (Deploy), chọn **Tùy chọn triển khai mới** (New deployment), loại **Ứng dụng web** (Web app):
   - Thực thi dưới dạng (Execute as): **Tôi** (Me).
   - Người có quyền truy cập (Who has access): **Bất kỳ ai** (Anyone). Không chọn "Anyone with Google account", vì người dùng trang không đăng nhập.
   - Bấm Triển khai, chép **URL ứng dụng web** (dạng `https://script.google.com/macros/s/…/exec`).
5. Mở `E:\3D\config.js`, dán URL vào `apiUrl`:
   ```js
   window.APP_CONFIG = window.APP_CONFIG || {
     apiUrl: 'https://script.google.com/macros/s/…/exec'
   };
   ```
6. Chạy `PUBLISH_GITHUB.bat` để đăng lại trang.

Kiểm tra: mở trang, mở một bản vẽ. Trang tính `TruyCap` có thêm một dòng, `BanVe` có dòng bản vẽ, thư mục Drive có tệp.
Mở thẳng `URL?a=ping` trên trình duyệt phải thấy `{"ok":true,…}`.

## Sửa Code.gs về sau

Sửa trong trình soạn Apps Script, rồi vào **Triển khai**, **Quản lý tùy chọn triển khai** (Manage deployments), bấm biểu tượng bút,
**Phiên bản: Phiên bản mới** (New version), rồi Triển khai. Làm vậy thì URL giữ nguyên.
Nếu chỉ bấm Lưu, URL vẫn chạy mã cũ. Không chạy lại `setup()`, trừ khi muốn tạo lại tờ ThongKe.

## Lấy bản vẽ bị báo lỗi về để kiểm thử

1. Chạy `TAI_BAN_VE_LOI.bat` lần đầu: script tạo `E:\3D\admin.json`. Điền vào đó:
   ```json
   { "apiUrl": "https://script.google.com/macros/s/…/exec", "adminKey": "khoá ADMIN_KEY", "out": "test/ban_ve_loi" }
   ```
2. Chạy lại `TAI_BAN_VE_LOI.bat`. Các bản vẽ đang có trạng thái `LỖI` được tải vào `E:\3D\test\ban_ve_loi\`,
   kèm `danh_sach.json` ghi nội dung báo lỗi, các tầng công cụ đã chọn, thống kê lúc người dùng xem.
   - `TAI_BAN_VE_LOI.bat --all`: tải mọi bản vẽ đã lưu.
   - `TAI_BAN_VE_LOI.bat --mark <SHA-256> OK`: đánh dấu bản vẽ đã sửa xong (trạng thái `ĐÃ SỬA`).
     Cũng có thể sửa thẳng cột "Trạng thái" trong trang tính.

`admin.json` chứa khoá quản trị: không gửi cho ai, không đưa lên GitHub (`PUBLISH_GITHUB.bat` không chép tệp này).
Nếu lộ khoá: trong Apps Script vào **Cài đặt dự án**, mục **Thuộc tính tập lệnh** (Script properties), đổi giá trị `ADMIN_KEY`.

## Giới hạn

- Tệp lớn hơn 30 MB chỉ được ghi thông tin (tên, mã, kết quả), không lưu nội dung. Giới hạn đến từ Apps Script (khoảng 50 MB mỗi lần gửi).
- Google Drive miễn phí có 15 GB. Với bản vẽ 1–6 MB, dung lượng đó chứa được vài nghìn bản vẽ.
- Mỗi người dùng nhận diện bằng một mã ngẫu nhiên lưu trong trình duyệt. Xoá dữ liệu trình duyệt hay dùng trình duyệt khác thì tính là khách mới.
- `config.js` để trống `apiUrl` thì trang không gửi gì, không có nút Báo lỗi.
