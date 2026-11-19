# Hỗ trợ — Hướng dẫn sử dụng (`help`)

> Tạo 19/11/2026 (user: "làm hướng dẫn sử dụng app, có hình ảnh, thao tác ở điện thoại, browser… đưa vào 1 module trên app" → "tạo module hỗ trợ, hướng dẫn MES chỉ là 1 hạng mục của nó, sau này tôi sẽ thêm hướng dẫn các công việc, module khác").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** menu **Hỗ trợ → Hướng dẫn sử dụng** (`/help`) · đọc một bài `/help/:id` (neo `#mục` / `#mục-số bước`).

**Quyền (BE `ALL_PERMISSIONS`):** _(không có trong config — ai đăng nhập cũng vào trang; từng BÀI chỉ hiện cho người có quyền xem module của bài, superadmin thấy hết — cùng luật menu)_

## Giao thoa với
<!-- giao-thoa:start -->
- [`production`](production.md) — bài "Sản xuất (MES): cài đặt và vận hành mẻ" (đổi giao diện / tên nút MES ⇒ chụp lại ảnh + sửa chữ bài)
<!-- giao-thoa:end -->

## Cấu trúc

- Bài = DỮ LIỆU thuần (`frontend/src/help/types.ts`: Guide → sections → steps {title, text[], images[], note, who}), không JSX. Chữ hỗ trợ `**đậm**` và dòng bắt đầu `- ` = gạch đầu dòng.
- Danh sách bài: `frontend/src/help/registry.ts` (`GUIDES`, `visibleGuides`, tìm trong từng bước không dấu `searchSteps`).
- Trang: `pages/help/HelpCenter.tsx` (bài gom theo nhóm + ô tìm trong mọi bước) · `pages/help/HelpGuide.tsx` (mục lục dính trái trên máy tính / gập trên điện thoại; ảnh máy tính trải bề rộng, ảnh điện thoại khung hẹp xếp cạnh nhau; bấm ảnh phóng to).
- Ảnh: `frontend/public/guide/<id bài>/*.jpg` — đuôi **.jpg** cố ý: PWA chỉ lưu offline `js,css,html,svg,png,woff2,wasm` (vite.config) nên ảnh hướng dẫn không làm nặng bộ nhớ app; ảnh `loading="lazy"`.

## Thêm một bài hướng dẫn

1. Viết `frontend/src/help/guides/<id>.ts` theo kiểu `Guide` (gắn `module` để chỉ người có quyền mới thấy).
2. Thêm vào `GUIDES` ở `help/registry.ts`.
3. Chụp ảnh bằng tài khoản mang ĐÚNG chức danh người sẽ dùng (không phải superadmin), máy tính 1280 + điện thoại 390, khoanh đỏ nút cần bấm; dữ liệu trông như thật, dọn sau khi chụp. Bộ chụp mẫu của bài MES: dựng tài khoản mẫu + bồn mẫu, chạy một mẻ thật trên Preview, rồi xoá mẻ / bồn / ca và trả tồn về đúng số đã chụp.
4. Thêm module mới vào mục "Giao thoa với" của cả hai file module.

## Bài hiện có

| Bài | Module | Ảnh | Ghi chú |
|---|---|---|---|
| `mes` — Sản xuất (MES): cài đặt và vận hành mẻ | `production` | `public/guide/mes/` (48 ảnh, ~3,5 MB) | Chụp 19/11 trên Preview (chức danh Phó phòng QA, Chế biến Ba Vì, mẻ mẫu B260003BD66 + bồn BD66 đã xoá) |
