# Mã hàng (`materials`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Mã hàng (+ Nhà sản xuất)

**Quyền (BE `ALL_PERMISSIONS`):** view · create · edit · import · delete

## Khoá đổi đơn vị gốc khi mã đang dùng (25/11 — rà soát MES, user chốt)

Đổi `base_unit` (form sửa mã hoặc nạp Excel) bị chặn 409 `BASE_UNIT_IN_USE` / lỗi dòng khi mã còn tồn > 0, có mẻ đang mở chưa nạp, nằm trong phiếu của mẻ đang mở, hoặc bồn còn hàng — MỘT hàm DB `material_base_unit_in_use`. Mã đã hết dùng vẫn đổi được.

## Giao thoa với
<!-- giao-thoa:start -->
- [`production`](production.md) — Sản xuất (tank_hold_hours hạn lưu bồn — từ 14/11 tối SỬA ở Cài đặt MES, form Mã hàng chỉ hiển thị; batch_prefix làm tiền tố mã lô — 14/11)
- [`help`](help.md) — Hỗ trợ (bài hướng dẫn `frontend/src/help/guides/maHang.ts` + ảnh `public/guide/ma-hang/` — đổi giao diện / tên nút thì chụp lại ảnh + sửa chữ bài)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Mã hàng (+ Nhà sản xuất)

**Quy cách xếp xe 3D (30/10):** `max_stack_layers` (Số lớp tối đa — xe pallet), `loose_stack_layers` (Chồng khi xếp xá — xe thùng rời; trống = như Số lớp tối đa, sữa 110ml: pallet 14 / xá 28), `stack_on_top` (hàng nhẹ). Form, chi tiết mã và file Excel (cột "Chồng xá (lớp)") cùng một luật; sơ đồ đọc qua chi tiết chuyến xuất (`outboundController` chọn cột).

**Cờ "Bán thành phẩm" (16/11, C117):** `is_semi_finished` — dịch trộn từ NVL theo định mức, vào bồn (MES). Form (ô tím dưới "pallet mang hàng"; ẩn khi phi hàng hoá / pallet), file Excel (cột "Bán thành phẩm (1/0)"), API cùng luật `utils/semiFinished.ts` `semiFinishedFlagError`: base L / KG, không phi hàng hoá, không pallet; DB CHECK `material_semi_finished_chk` làm lưới cuối. Mã BTP không bắt buộc Loại hàng / Thùng-pallet / HSD / Pallet-EA (không nằm ở vị trí kho). Hạn lưu bồn (`tank_hold_hours`) chỉ KHAI được cho mã BTP. Trang Mã hàng: nhãn "BTP" ở cột Cờ, bộ lọc Cờ = Bán thành phẩm. Tìm mã `GET /masterdata/materials?semi_finished=1`.

**Nạp Excel — mã MỚI đủ ô như form (19/11, C125):** mã chưa có phải có Loại hàng · Base Unit · Thùng/Pallet (+ HSD, Pallet/EA nếu Loại kho bắt), trừ phi hàng hoá / bán thành phẩm / pallet mang hàng — một helper `materialMissingFields` (utils/materialRequired); mã đã có vẫn sửa từng ô. File mẫu: sheet "MaHang" chỉ 2 dòng tên cột, ví dụ + giải thích ở sheet "Hướng dẫn". Cửa API tạo mã (POST) giữ luật cũ (gói QA / tích hợp tạo mã tối giản) — form tự kiểm phía trình duyệt.

## Actions

view, create, edit, delete 
