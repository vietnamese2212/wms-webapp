# Nhập kho (`inbound`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Nhập kho

**Quyền (BE `ALL_PERMISSIONS`):** view · create · edit · scan · edit_pallet · force_edit_pallet · delete_pallet · force_delete_pallet · cancel · complete · uncomplete · putaway_override

## Giao thoa với
<!-- giao-thoa:start -->
- [`inventory`](inventory.md) — Tồn kho (hai chiều)
- [`packing`](packing.md) — Sổ đóng gói (hai chiều)
- [`outbound`](outbound.md) — Xuất kho (nhập hàng trả về đọc chuyến xuất gốc · tem đã quét đi)
- [`traceability`](traceability.md) — Truy xuất lô (phần trả về trừ khỏi "đã giao khách")
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Nhập kho

## 26/10 — NHẬP HÀNG TRẢ VỀ (user chốt 25–26/10)

- **Ai / ở đâu:** THỦ KHO, nút **"Nhập trả về"** ở toolbar Nhập kho (quyền `inbound.create`). Form trượt phải `components/wms/InboundReturnSheet.tsx`:
  - **Theo chuyến xuất gốc:** tìm chuyến ĐÃ HOÀN THÀNH (Số xe · DO · khách · biển số, 90 ngày) ⇒ app điền (DO × mã) · số ĐÃ XUẤT (`OutboundItem.cartons_scanned`) · đã khai trả trước. Số trả ≤ đã xuất − đã khai trả (BE 422 `RETURN_INVALID`). "Cả xe quay về" điền hết phần còn trả được.
  - **Lập tay** khi không tìm được chuyến: khách + mã + số + lý do.
  - **Công tắc QA THEO PHIẾU, mặc định KHÔNG giữ** (user chọn (a) 26/10 — mọi phiếu trả). Bật ⇒ pallet quét nhận gắn QA `X` (`services/qaStatus`: mọi mã khác `OK` là giữ). Mã không theo QR nhận vào tồn chung nên không gắn giữ.
  - **Giao lại hàng trả = ĐƠN RIÊNG** (SAP tạo DO mới — user 26/10); phiếu trả không mang lựa chọn giao lại.
- **Dữ liệu:** `inbound_return` (đầu phiếu, số `<kho>_TV_ddmmyy_NN`) · `inbound_return_line` (khai theo DO × mã) · `inbound_return_scan` (SỔ NHẬN TRẢ: tem gốc nào, bao nhiêu, cộng dồn hay dòng mới). Mỗi MÃ một `ProductionImport` `source_type = 'RETURN'` + `return_id` (nhãn "TV" trên danh sách) ⇒ quét / lưu thủ công / hoàn thành dùng nguyên màn chi tiết. **KHÔNG gắn `from_gdo_id`** — cửa nhận chuyển kho đếm phiếu theo cột đó (409 "đã tạo phiếu").
- **Nhận hàng:** tem pallet quét như nhập thường, đi đúng nhánh chuyển kho — tem còn tồn ⇒ CỘNG DỒN (sổ điều chỉnh ghi "Nhập trả về …"), tem đã xuất hết ⇒ dòng tồn mới cùng mã tem (NSX / lô từ QR). **Hàng lẻ** (không tem riêng) ⇒ khối "Hàng trả về" trên màn chi tiết → "Nhận hàng lẻ" theo TEM GỐC ⇒ tem con `.N` mang lô / NSX / HSD gốc (`POST /wms/inbound-orders/:id/return-loose`, quyền `inbound.scan`, luật đặt tên `utils/palletChild` dùng chung Tách pallet). In tem: In tem pallet → In lại.
- **Ghi nhận ở module khác:** truy xuất lô (`lot_trace`: cột / ô "Trả về" theo (tem, chuyến) — gán dòng đầu của cặp, không cộng hai lần) · sổ pallet (`pallet_ledger`: dòng "Trả về" + dòng "vào tem con" trên tem gốc) · chuỗi tình trạng xe (bước Đã giao: "Giao một phần · có trả về" + số phiếu). Mức phục vụ (tab Dịch vụ) KHÔNG trừ: chỉ số đó đo kho XUẤT đủ hay thiếu, không đo khách trả.
- **Để sau:** đối chiếu dòng trả ZRE1 của SAP · pallet Loscam (ZRE3). Gói QA 62.

## Actions

view, create, edit, scan, edit_pallet, force_edit_pallet, delete_pallet, force_delete_pallet, cancel, complete, uncomplete 
