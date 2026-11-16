# Giấy phép

Mã của công cụ này phát hành theo giấy phép GNU GPL phiên bản 3 (https://www.gnu.org/licenses/gpl-3.0.txt),
vì trang có kèm thư viện đọc DWG theo giấy phép GPL-3.0.

## Thư viện bên thứ ba

| Tệp | Thư viện | Giấy phép | Mã nguồn |
|---|---|---|---|
| `docs/lib/three.bundle.js` | Three.js (kèm OrbitControls) | MIT | https://github.com/mrdoob/three.js |
| `docs/lib/libredwg.bundle.js`, `docs/lib/libredwg.wasm.js` | @mlightcad/libredwg-web 0.8.3 (LibreDWG) | GPL-3.0 | https://github.com/mlightcad/libredwg-web , https://www.gnu.org/software/libredwg/ |

Hai thư viện được đóng gói lại thành script thường bằng `tools/bundle_three.js` và `tools/bundle_libredwg.js`, không sửa mã gốc.
