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
- **Dữ liệu:** `inbound_return` (đầu phiếu, số `<kho>_RT_ddmmyy_NN`) · `inbound_return_line` (khai theo DO × mã) · `inbound_return_scan` (SỔ NHẬN TRẢ: tem gốc nào, bao nhiêu, cộng dồn hay dòng mới). Mỗi MÃ một `ProductionImport` `source_type = 'RETURN'` + `return_id` (nhãn "RT" trên danh sách, ô "RT" trên dải tổng — RPC `inbound_orders_summary` trả `rt`, `sx` không còn đếm phiếu trả) ⇒ quét / lưu thủ công / hoàn thành dùng nguyên màn chi tiết. **KHÔNG gắn `from_gdo_id`** — cửa nhận chuyển kho đếm phiếu theo cột đó (409 "đã tạo phiếu").
- **Nhận hàng:** tem pallet quét như nhập thường, đi đúng nhánh chuyển kho (màn quét coi RETURN như TRANSFER: luôn kiểm server, NCC kế thừa) — tem còn tồn ⇒ CỘNG DỒN (sổ điều chỉnh ghi "Nhập trả về …"), tem đã xuất hết ⇒ dòng tồn mới cùng mã tem (NSX / lô từ QR). **Phiếu GIỮ QA + tem còn tồn ⇒ KHÔNG cộng dồn, tách tem con `.N` mang QA giữ** (user 26/10 — cộng vào pallet OK là hàng trả lọt ra không bị giữ). **Phiếu theo chuyến chỉ nhận tem ĐÃ ĐI trên chuyến đó** (422 `RETURN_FOREIGN_PALLET` ở kiểm trước · quét · hàng lẻ; lập tay không ràng; user 26/10). Số gợi ý khi quét = số tem đó đã xuất trên chuyến. Lập phiếu nguyên tử (RPC `inbound_return_create`, C104); huỷ phiếu nhập trả rút phần đã khai (C105). **Hàng lẻ** (không tem riêng) ⇒ khối "Hàng trả về" trên màn chi tiết → "Nhận hàng lẻ" theo TEM GỐC ⇒ tem con `.N` mang lô / NSX / HSD gốc (`POST /wms/inbound-orders/:id/return-loose`, quyền `inbound.scan`, luật đặt tên `utils/palletChild` dùng chung Tách pallet). In tem: In tem pallet → In lại.
- **Ghi nhận ở module khác:** truy xuất lô (`lot_trace`: cột / ô "Trả về" theo (tem, chuyến) — gán dòng đầu của cặp, không cộng hai lần) · sổ pallet (`pallet_ledger`: dòng "Trả về" + dòng "vào tem con" trên tem gốc) · chuỗi tình trạng xe (bước Đã giao: "Giao một phần · có trả về" + số phiếu). Mức phục vụ (tab Dịch vụ) KHÔNG trừ: chỉ số đó đo kho XUẤT đủ hay thiếu, không đo khách trả.
- **Đợt 2 (26/10 tối, user chốt):**
  - **Lý do trả = DANH MỤC** (LookupValue `return_reason`, tab "Lý do trả hàng" ở Cài đặt WMS, quyền `wms_settings.manage_type`): mã · tên · công tắc "Bắt chọn đợt thu hồi" (`meta.requires_recall`). Ô `inbound_return.reason` thành ghi chú. Mặc định: Khách từ chối · Hàng hư hỏng · Date thấp · Giao nhầm · Thừa / không rõ đơn · Thu hồi (bắt đợt).
  - **Đợt thu hồi** `recall_campaign`: duyệt NGOÀI app, người có `inbound.recall_manage` tạo MÃ ĐỢT dạng chữ / đóng / mở lại (nút "Đợt thu hồi" ở trang Hàng trả về). Lý do bắt đợt ⇒ phải chọn đợt ĐANG MỞ (422 `RETURN_REASON_INVALID`).
  - **Hàng THỪA:** phiếu theo chuyến — mỗi tem chỉ "trả về" tới số tem đó đã xuất trên chuyến − đã nhận về; phần VƯỢT vẫn nhận, tự tách TEM CON (NSX / lô theo tem gốc, hoặc NSX gõ tay ở "Nhận hàng lẻ") và ghi `inbound_return_scan.surplus` ⇒ truy xuất lô KHÔNG trừ phần thừa (`lot_trace` 20261026f). Mã không theo QR: thừa = vượt số đã xuất của MÃ trên chuyến.
  - **Hàng NPP chuyển về:** phiếu TF có chuyến nguồn ở kho loại `NPP` (NPP dùng app tạo đơn xuất về kho chính) = hàng trả về; khối "Hàng NPP chuyển về" trên màn chi tiết gắn lý do / ghi chú / đợt cho cả chuyến (`PATCH /wms/inbound-returns/npp/:gdoId`, quyền `inbound.create`; cột `ProductionImport.return_reason_code / return_note / recall_id`). NPP không dùng app ⇒ kho lập phiếu RT như cũ.
  - **Trang "Hàng trả về"** (`/wms/inbound-returns`, menu Nhập hàng, quyền `inbound.view`): mỗi dòng một phiếu (RT / NPP chuyển về), lọc ngày · kho · dạng · lý do · đợt; dải tổng bằng SQL (RPC `inbound_return_report`, thực nhận RT = sổ nhận trả, TF = dòng tồn); lọc một đợt ⇒ dải "đã thu cả đợt" theo mã; Xuất Excel quyền `inbound.export`. Đợt sau (user hoãn): MỤC TIÊU thu hồi từ truy xuất lô (đã xuất cho ai bao nhiêu ⇒ còn phải thu).
- **Để sau:** đối chiếu dòng trả ZRE1 của SAP (user: không quan tâm) · pallet Loscam (ZRE3 — đi được qua phiếu trả theo chuyến hoặc Nhập SX nhập tay). Gói QA 62.

## Actions

view, create, edit, scan, edit_pallet, force_edit_pallet, delete_pallet, force_delete_pallet, cancel, complete, uncomplete 
