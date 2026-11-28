# Mã hàng (`materials`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Mã hàng (+ Nhà sản xuất)

**Quyền (BE `ALL_PERMISSIONS`):** view · create · edit · import · delete

## Khoá đổi đơn vị gốc khi mã đang dùng (25/11 — rà soát MES, user chốt)

Đổi `base_unit` (form sửa mã hoặc nạp Excel) bị chặn 409 `BASE_UNIT_IN_USE` / lỗi dòng khi mã còn tồn > 0, có mẻ đang mở chưa nạp, nằm trong phiếu của mẻ đang mở, hoặc bồn còn hàng — MỘT hàm DB `material_base_unit_in_use`. Mã đã hết dùng vẫn đổi được.

## Mã cân / đong có quy cách GỢI Ý — bao đường (27/11, user chốt)

- Đơn vị `BAO` ("Bao", vai trò Entry) là đơn vị RIÊNG của app cho bao đường / bột; `BAG` là đơn vị SAP (túi nhỏ của bao bì), tên tiếng Việt "Túi". Hai mã khác nhau, không dùng chung.
- **App phân biệt bằng ĐƠN VỊ GỐC** (user 27/11: "thành phẩm 1 thùng = 48 hộp: key 60 hộp thì thành 1 thùng 12 hộp; đường trắng: key 1000 kg giữ 1000 kg, chỉ gợi ý 50 bao, kg vẫn là đơn vị chính"):
  - đơn vị đếm (HOP, BT, EA…) + Entry Unit ⇒ **entry unit thật**: "N thùng + M hộp", số theo hộp phải nguyên, số / pallet theo thùng;
  - đơn vị đo (đơn vị bật cờ **"Đơn vị đo"** ở Cài đặt WMS → Đơn vị tính — staging: KG, G, L, M2) + Entry Unit ⇒ **quy cách GỢI Ý**: lưu ở `pack_unit` / `pack_size`, `entry_unit` để trống. Mọi phép quy đổi, ô tổng "SL (quy đổi)", tổng chuyến, cột Thùng của Excel, số / pallet, MES… thấy mã y như chưa khai bao (kg). Chỉ dòng gợi ý đọc hai cột này.
- **Đơn vị đo là CẤU HÌNH, không phải danh sách trong code (28/11 — user: "Cho tự cấu hình đơn vị đo đi. Bởi ko thể phụ thuộc vào hard code đc nhé").** Nguồn duy nhất: cờ `meta.measure` của từng đơn vị (`LookupValue` type `unit_of_measure`), bật / tắt ở Cài đặt WMS → Đơn vị tính (quyền `wms_settings.manage_unit`), cột "Cách tính" Đo / Đếm. Server đọc tươi mỗi lần ghi Mã hàng (`services/unitCatalog.ts` `loadMeasureUnitCodes`), form Mã hàng đọc từ danh mục đã nạp (`measureUnitCodes`), DB `qty_is_measure_unit` đọc cùng cờ. Helper số lượng (`qtyUnits`) không cần cờ: dữ liệu đã tách sẵn. Test `measureUnitsSql.test.ts` đỏ nếu ai thêm lại danh sách cứng.
- **Đổi cờ của một đơn vị đang dùng** ⇒ trigger DB `trg_lookup_unit_measure_sync` gọi `material_units_reclassify` ngay trong cùng giao dịch, cho MỌI mã dùng đơn vị đó làm đơn vị gốc: bật (đếm → đo) — thùng thật thành quy cách gợi ý, số / pallet × hệ số; tắt (đo → đếm) — gợi ý thành thùng thật, số / pallet ÷ hệ số, **chặn** (409 `UNIT_RECLASSIFY_BLOCKED`, cờ và mã giữ nguyên) khi có mã không chuyển trọn: hệ số lẻ, số / pallet không chia hết, tồn kho có số lẻ. Form Đơn vị tính chạy thử trước (`GET /wms/lookup-unit/:id/measure-impact`, cùng hàm với `p_apply = false`), liệt kê mã sẽ chuyển / mã chặn; nút lưu ghi "Lưu và chuyển N mã". Sửa đơn vị mà không gửi cờ (màn cũ) thì cờ giữ nguyên. Đơn vị vai trò Entry thì cờ vô nghĩa (luôn tắt).
- Form và file Excel vẫn khai như cũ ("Entry Unit = BAO, 1 BAO = 20 KG"); server tách bằng MỘT hàm `splitEntryPack` (`utils/materialUnits.ts`) cho tạo mã, sửa mã, nạp Excel. DB chặn cửa quên tách: trigger `trg_material_unit_kind` (thay hai CHECK cũ của 20261127d — CHECK không gọi được hàm đọc bảng): mã đơn vị đo không có entry unit; gợi ý chỉ cho mã đơn vị đo, hệ số > 0 (lỗi `UNIT_MEASURE_NO_ENTRY` / `UNIT_PACK_HINT` ⇒ 409 kèm câu). Xoá / đổi mã đơn vị đang làm quy cách gợi ý (BAO) cũng bị chặn như base / entry. Form đọc lại gợi ý vào cùng ô Entry Unit (`declaredEntry`) nên lưu lại không mất bao; dòng dưới ô ghi "chỉ gợi ý; số lượng, số / pallet vẫn theo KG".
- Đường trắng 210000262: Base KG, gợi ý BAO 20 kg, số / pallet **1.000 kg** (gợi ý "50 bao").
- Hiển thị: `qtyLabel` ⇒ "1.000 kg (50 bao)", "110 kg (5 bao + 10 kg)", dưới 1 bao chỉ "12,345 kg"; ô hẹp dùng `qtyMainUnits` (bỏ gợi ý) + dòng gợi ý riêng `QtyText` / `QtyPackHintLine`; ô nhập `QtyInput` là MỘT ô kg + "= 5 bao + 10 kg". Object số lượng ở các màn chỉ mang id / mã hàng ⇒ FE tra gợi ý đã nạp lúc khởi động (`GET /masterdata/materials/pack-hints`, ai đăng nhập cũng đọc; Shell `setPackHints`, query `material-pack-hints` theo realtime bảng Material). Thiếu thì chỉ mất dòng gợi ý, không sai số.
- Ô TỔNG nhiều mã có đơn vị khác nhau (chuyến xuất: dòng dưới mã chuyến, dải "Đã xuất · Kế hoạch", nhóm NPP, cột số lượng ở danh sách Xuất kho) cộng theo TỪNG đơn vị: "10 thùng · 1.000 kg", tiến độ "4/10 thùng · 400/1.000 kg", thanh tiến độ = trung bình % của từng đơn vị (`qtyTotalsByUnit` / `qtyTotalsPairText` / `qtyTotalsProgress`, mirror BE ⇄ FE; BE gửi `qty_by_unit` / `qty_by_unit_noqr` trên mỗi chuyến). Ô "SL (quy đổi)" của Tồn kho / Dashboard giữ một số (nhãn đã nói rõ là quy đổi) — đường góp số kg.
- Số / pallet: theo entry unit THẬT nếu có, không thì theo đơn vị gốc. Thêm / bỏ thùng (form hoặc Excel) mà không gõ số mới ⇒ app tự đổi (`palletQtyOnUnitChange` + `palletUnitFix`); khai / bỏ quy cách gợi ý không đổi số / pallet.

## Giao thoa với
<!-- giao-thoa:start -->
- [`production`](production.md) — Sản xuất (tank_hold_hours hạn lưu bồn — từ 14/11 tối SỬA ở Cài đặt MES, form Mã hàng chỉ hiển thị; batch_prefix làm tiền tố mã lô — 14/11)
- [`wms_settings`](wms_settings.md) — Cài đặt WMS (tab Đơn vị tính: cờ "Đơn vị đo" quyết định mã nào có bao / thùng chỉ là gợi ý; đổi cờ ⇒ DB chuyển các mã dùng đơn vị đó — 28/11)
- [`help`](help.md) — Hỗ trợ (bài hướng dẫn `frontend/src/help/guides/maHang.ts` + ảnh `public/guide/ma-hang/` — đổi giao diện / tên nút thì chụp lại ảnh + sửa chữ bài)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Mã hàng (+ Nhà sản xuất)

**Quy cách xếp xe 3D (30/10):** `max_stack_layers` (Số lớp tối đa — xe pallet), `loose_stack_layers` (Chồng khi xếp xá — xe thùng rời; trống = như Số lớp tối đa, sữa 110ml: pallet 14 / xá 28), `stack_on_top` (hàng nhẹ). Form, chi tiết mã và file Excel (cột "Chồng xá (lớp)") cùng một luật; sơ đồ đọc qua chi tiết chuyến xuất (`outboundController` chọn cột).

**Cờ "Bán thành phẩm" (16/11, C117):** `is_semi_finished` — dịch trộn từ NVL theo định mức, vào bồn (MES). Form (ô tím dưới "pallet mang hàng"; ẩn khi phi hàng hoá / pallet), file Excel (cột "Bán thành phẩm (1/0)"), API cùng luật `utils/semiFinished.ts` `semiFinishedFlagError`: base L / KG, không phi hàng hoá, không pallet; DB CHECK `material_semi_finished_chk` làm lưới cuối. Mã BTP không bắt buộc Loại hàng / Thùng-pallet / HSD / Pallet-EA (không nằm ở vị trí kho). Hạn lưu bồn (`tank_hold_hours`) chỉ KHAI được cho mã BTP. Trang Mã hàng: nhãn "BTP" ở cột Cờ, bộ lọc Cờ = Bán thành phẩm. Tìm mã `GET /masterdata/materials?semi_finished=1`.

**Nạp Excel — mã MỚI đủ ô như form (19/11, C125):** mã chưa có phải có Loại hàng · Base Unit · Thùng/Pallet (+ HSD, Pallet/EA nếu Loại kho bắt), trừ phi hàng hoá / bán thành phẩm / pallet mang hàng — một helper `materialMissingFields` (utils/materialRequired); mã đã có vẫn sửa từng ô. File mẫu: sheet "MaHang" chỉ 2 dòng tên cột, ví dụ + giải thích ở sheet "Hướng dẫn". Cửa API tạo mã (POST) giữ luật cũ (gói QA / tích hợp tạo mã tối giản) — form tự kiểm phía trình duyệt.

## Actions

view, create, edit, delete 
