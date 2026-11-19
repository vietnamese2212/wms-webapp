# Hỗ trợ — Hướng dẫn sử dụng (`help`)

> Tạo 19/11/2026 (user: "làm hướng dẫn sử dụng app, có hình ảnh, thao tác ở điện thoại, browser… đưa vào 1 module trên app" → "tạo module hỗ trợ, hướng dẫn MES chỉ là 1 hạng mục của nó, sau này tôi sẽ thêm hướng dẫn các công việc, module khác").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** menu **Hỗ trợ → Hướng dẫn sử dụng** (`/help`) · đọc một bài `/help/:id` (neo `#mục` / `#mục-số bước`).

**Quyền (BE `ALL_PERMISSIONS`):** _(không có trong config — ai đăng nhập cũng vào trang; từng BÀI chỉ hiện cho người có quyền xem module của bài, superadmin thấy hết — cùng luật menu)_

## Giao thoa với
<!-- giao-thoa:start -->
- [`production`](production.md) — bài "Sản xuất (MES): cài đặt và vận hành mẻ" (đổi giao diện / tên nút MES ⇒ chụp lại ảnh + sửa chữ bài)
- [`materials`](materials.md) — bài "Mã hàng"
- [`inbound`](inbound.md) — bài "Nhập kho"
- [`pallet_print`](pallet_print.md) — bài "In tem pallet"
- [`inventory`](inventory.md) — bài "Tồn kho"
- [`pallet_ops`](pallet_ops.md) — bài "Dồn / Tách pallet"
- [`stocktake`](stocktake.md) — bài "Kiểm kê"
- [`traceability`](traceability.md) — bài "Truy xuất lô"
- [`scanlog`](scanlog.md) — bài "Lịch sử quét"
<!-- giao-thoa:end -->

## Cấu trúc

- Bài = DỮ LIỆU thuần (`frontend/src/help/types.ts`: Guide → sections → steps {title, text[], images[], note, who}), không JSX. Chữ hỗ trợ `**đậm**` và dòng bắt đầu `- ` = gạch đầu dòng.
- Danh sách bài: `frontend/src/help/guides/index.ts` (`ALL_GUIDES` — thứ tự công việc; không import gì của app để test backend đọc được) → `help/registry.ts` (`GUIDES`, `visibleGuides`, tìm trong từng bước không dấu `searchSteps`).
- Trang: `pages/help/HelpCenter.tsx` (bài gom theo nhóm + ô tìm trong mọi bước) · `pages/help/HelpGuide.tsx` (mục lục dính trái trên máy tính / gập trên điện thoại; ảnh máy tính trải bề rộng, ảnh điện thoại khung hẹp xếp cạnh nhau; bấm ảnh phóng to).
- Ảnh: `frontend/public/guide/<id bài>/*.jpg` — đuôi **.jpg** cố ý: PWA chỉ lưu offline `js,css,html,svg,png,woff2,wasm` (vite.config) nên ảnh hướng dẫn không làm nặng bộ nhớ app; ảnh `loading="lazy"`.

## Thêm một bài hướng dẫn

1. Viết `frontend/src/help/guides/<id>.ts` theo kiểu `Guide` (gắn `module` để chỉ người có quyền mới thấy).
2. Thêm vào `ALL_GUIDES` ở `help/guides/index.ts` (quên là test `helpGuides.test.ts` đỏ). Ảnh đặt ở `public/guide/<id bài>/`, khổ chuẩn 1280×800 / điện thoại 780×1688 (khác thì khai w / h).
3. Chụp ảnh bằng tài khoản mang ĐÚNG chức danh người sẽ dùng (không phải superadmin), máy tính 1280 + điện thoại 390, khoanh đỏ nút cần bấm; dữ liệu trông như thật, dọn sau khi chụp. Ô bắt buộc viết `**Tên ô***` (đừng thêm gạch chéo trước dấu sao — `rich()` chỉ hiểu cặp `**`, gạch chéo hiện ra nguyên văn). Bộ chụp mẫu của bài MES: dựng tài khoản mẫu + bồn mẫu, chạy một mẻ thật trên Preview, rồi xoá mẻ / bồn / ca và trả tồn về đúng số đã chụp. Đợt 2 (8 bài kho): tài khoản mẫu + chụp lại tồn kho chế biến → chạy luồng thật (in tem → nhập TF → tồn / QA / chuyển / điều chỉnh → tách / dồn → kiểm kê) → xoá mọi dòng tài khoản mẫu ghi + trả tồn. Ảnh quét trên điện thoại dùng **camera giả** của Chromium (`--use-file-for-fake-video-capture` với video y4m dựng từ ảnh tem thật bằng ffmpeg) — app đọc mã thật, ảnh giống quét thật.
4. Thêm module mới vào mục "Giao thoa với" của cả hai file module.

## Bài hiện có

| Bài | Module | Ảnh | Ghi chú |
|---|---|---|---|
| `ma-hang` — Mã hàng: tìm, thêm, sửa, nạp Excel | `materials` | `public/guide/ma-hang/` (18 ảnh) | mã mẫu 210000416 đã xoá |
| `nhap-kho` — Nhập kho: nhận hàng vào kho chế biến | `inbound` | `public/guide/nhap-kho/` (16 ảnh) | phiếu TF mẫu CBBV_N_191126_01 đã xoá; kho chế biến chỉ nhận qua chuyển kho |
| `in-tem` — In tem pallet nguyên liệu, bao bì | `pallet_print` | `public/guide/in-tem/` (10 ảnh) | 4 tem mẫu + lịch sử in đã xoá |
| `ton-kho` — Tồn kho | `inventory` | `public/guide/ton-kho/` (21 ảnh) | |
| `don-tach` — Dồn / Tách pallet | `pallet_ops` | `public/guide/don-tach/` (7 ảnh) | |
| `kiem-ke` — Kiểm kê | `stocktake` | `public/guide/kiem-ke/` (14 ảnh) | |
| `truy-xuat` — Truy xuất lô | `traceability` | `public/guide/truy-xuat/` (8 ảnh) | mẻ thật B260001BD62 (chỉ đọc) |
| `lich-su-quet` — Lịch sử quét xuất kho | `scanlog` | `public/guide/lich-su-quet/` (3 ảnh) | kho chế biến không xuất theo chuyến ⇒ trang trống, bài nói rõ |
| `mes` — Sản xuất (MES): cài đặt và vận hành mẻ | `production` | `public/guide/mes/` (48 ảnh, ~3,5 MB) | Chụp 19/11 trên Preview (chức danh Phó phòng QA, Chế biến Ba Vì, mẻ mẫu B260003BD66 + bồn BD66 đã xoá) |
