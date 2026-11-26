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
- [`help`](help.md) — Hỗ trợ (bài hướng dẫn `frontend/src/help/guides/nhapKho.ts` + ảnh `public/guide/nhap-kho/` — đổi giao diện / tên nút thì chụp lại ảnh + sửa chữ bài)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Nhập kho

## 26/11 — NHẬP NHIỀU MÃ (tab thứ 3 của Tạo phiếu nhập — mọi kho)
User 26/11: nhập nội bộ ở kho chế biến = một chứng từ vài chục mã của nhiều NCC; Nhập SX từng mã một lâu, Nhập NCC bắt chọn từng NCC + xe cổng. Chốt: **khai trước mã + số lượng** (dán Excel được), quét **ở từng phiếu hoặc quét cả nhóm**, **vị trí mặc định cho cả phiếu — đổi được từng tem lúc quét**, dùng ở **mọi kho**, giữ khuôn hiện tại.
- Form: tab **Nhập nhiều mã** dùng CHUNG bảng dòng hàng của tab NCC (`isTableMode`); ô "Xe đang vào cổng" thay bằng **Vị trí mặc định** (bắt buộc trừ kho QTY/QTY_DATE); **NCC tuỳ chọn** cho cả nhóm — để trống thì quét tem đọc mã NCC trên tem như Nhập SX.
- `POST /wms/inbound-orders/group` (`inbound.create`, `zCreateGroup`): kiểm HẾT rồi mới ghi (trùng mã · mã khác loại kho · mã phi hàng hoá · số nguyên theo quy cách · thiếu vị trí khi có mã theo tem ⇒ 422, không ghi gì); quy tắc cất hàng chấm CẢ LÔ vào vị trí mặc định một lần (`guardPutawayBatch`); cấp số phiếu cả lô + ghi MỘT lô, đua ⇒ 23505 ⇒ đếm lại. Mỗi mã một `ProductionImport` **FACTORY** (nhãn SX — quét / lưu thủ công / hoàn thành dùng nguyên màn chi tiết), chung cột `receipt_group` (uuid). Mã không tem: không vị trí, lưu thủ công ở trang phiếu.
- Danh sách: nhóm nối ngoặc như nhóm NCC theo lượt cổng (`inboundGroupKey` `grp:` = nhánh mới trong RPC `inbound_orders_page`). **Sửa nhóm** (bút trên dòng): sửa SL / huỷ dòng chưa quét như nhóm NCC + thêm mã mới vào CÙNG nhóm (cửa nhóm với `receipt_group`; mã đã có ⇒ 422; nhóm kho khác ⇒ 422).
- Trang phiếu: **Quét cả nhóm (N mã)** — `InboundGroupScanSheet` giữ danh sách phiếu mở của mã có tem; quét tem mã nào thì mở lại màn quét của đúng phiếu mã đó (khởi tạo NCC / quy cách / số mặc định như mở phiếu đó), mang theo tem vừa quét + vị trí đang chọn + kiểu quét (camera / súng). Tem mã không có trong nhóm ⇒ báo "dùng Sửa nhóm để thêm mã". Ghi vẫn đi cửa quét của từng phiếu (máy chủ kiểm mã tem = mã phiếu).
- **Lượt 2 (26/11 chiều, user chốt):** (1) **Upload Excel chỉ TẠO nhóm mới** — nút "Nạp Excel" cạnh "Danh sách hàng" (khoá tới khi chọn Kho · Ngày · Ca); đầu phiếu lấy từ form, file: Mã hàng * · Số thùng · Số lẻ (ĐVT gốc) · Ghi chú; `POST /wms/inbound-orders/group/upload` (`?preflight=1` kiểm trước, một lỗi là không ghi; mã trùng cộng gộp + cảnh báo; lỗi báo theo dòng Excel). (2) **Loại kho THEO TỪNG MÃ khi upload** — một nhóm trộn được RM01 + PK01 (form tay vẫn chọn một loại). (3) **Hoàn thành cả nhóm** (phiếu đã nhận hàng; xem trước nêu phiếu nhận thiếu + phiếu giữ mở) · **Huỷ cả nhóm** (phiếu chưa có hàng — cùng điều kiện Huỷ từng phiếu): `POST /group/:group/complete|cancel[?preview=1]`, nút ở trang phiếu. (4) **Sửa nhóm đổi NCC / vị trí mặc định ⇒ mọi phiếu chưa quét** (`PATCH /group/:group`; vị trí chỉ cho mã có tem, ghi lịch sử vị trí từng phiếu).
- Vị trí mặc định (tạo / upload / Sửa nhóm) kiểm như cửa đổi vị trí phiếu: có thật · đang hoạt động · đúng kho · hợp loại hàng (`groupLocationError`) + quy tắc cất hàng cả lô.
- **Dán từ Excel** (bảng dòng hàng tab NCC + Nhập nhiều mã, 26/11): dán khối **Mã hàng | Số thùng | Số lẻ** vào ô Mã (2 cột Mã | SL cũng được — mã KG/L/cái thì SL là đơn vị gốc); dán cột số vào ô Thùng hoặc ô Lẻ thì điền xuống từ dòng đang dán, chỉ thay phần của cột đó. Thùng quy đổi qua hệ số của mã (tra mã trên server trước khi điền). Helper `frontend/src/utils/excelPaste.ts`; test `backend/tests/unit/excelPaste.test.ts`.
- `ProductionImport.planned_cartons` là **numeric** (migration 20261126c, C140): kế hoạch mã KG / L nhận số lẻ.
- Form Tạo phiếu nhập chỉ khởi tạo lại khi MỞ form (C139 — trước đây /me làm mới 5' một lần đặt lại form về tab đầu, mất dòng đang khai).
- Gói 63 [23a–i].

## 26/11 — Hàng không tem theo NSX ở kho QR (user: "bắt nhập nếu có config như vậy ở kho cb")
- Cờ 2 tầng `Warehouse.noqr_date_tracking` + `warehouse_type_configs.noqr_date_tracking` (null = theo kho) — Cài đặt WMS → Kho → nhóm NHẬP "Hàng không tem" (chỉ hiện khi kho quản lý theo tem). Mặc định TẮT = hành vi cũ.
- Bật ⇒ hàng KHÔNG TEM của kho QR chạy luật tồn gộp của kho QTY_DATE: Lưu thủ công bắt NSX (thiếu ⇒ 422 `NSX_REQUIRED`, NSX tương lai ⇒ 422 `NSX_FUTURE`), mỗi NSX một dòng tồn (unique `uq_inventory_active_wh_pallet` đã có NSX trong khoá), cùng NSX cộng dồn.
- MỘT câu trả lời cho mọi cửa: `services/noQrPool.ts` → `noQrPoolPolicy(kho, loại)` (`byDate`, `poolMode`). Không so `inventory_mode === 'QTY_DATE'` rải rác nữa. Trang phiếu nhận kết luận qua `noqr_pool_by_date` của GET phiếu.
- Hộp Lưu thủ công: ô NSX để TRỐNG (trước tự điền hôm nay — bấm Lưu là thành NSX sai), không chọn được ngày tương lai.
- Đang bật cho Chế biến Ba Vì trên staging. Cấp NVL vào mẻ không tem vốn đã đi theo lô (NSX + số lô) — không đổi. Gói 63 [21].

## 19/11 — Kho phụ nội bộ tạo phiếu nhập trực tiếp được

Trước đó (10/07 → 19/11) `createOrder` chặn kho phụ (`Warehouse.parent_warehouse_id`) tạo phiếu không phải TRANSFER — 400 "Kho phụ nội bộ chỉ nhận hàng qua chuyển kho từ kho parent" (mà form vẫn mở, điền xong mới báo). User chốt 19/11 (kho chế biến chạy app trước, Kho Ba Vì chưa chạy): "cứ cho nhập đi thôi, không sao" — bỏ hẳn chặn cho MỌI kho phụ. Rủi ro đã nói với user: khi kho cha cũng chạy app, một lô có thể bị nhập hai lần (kho cha nhập NCC + kho phụ nhập lại thay vì nhận chuyển kho). Chiều XUẤT của kho phụ giữ luật cũ (chỉ xuất trả kho cha hoặc xuất tiêu hao). Gói 63 [0a] gác.

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
  - **Hàng NPP chuyển về:** phiếu TF có chuyến nguồn ở kho loại `NPP` (NPP dùng app tạo đơn xuất về kho chính) = hàng trả về; khối "Hàng NPP chuyển về" trên màn chi tiết phiếu VÀ panel tab Chuyển kho (Kế hoạch VC) gắn lý do / ghi chú / đợt cho cả chuyến — **BẮT BUỘC trước khi Hoàn thành** (user 26/10 "bắt buộc luôn": `completeOrder` 422 `NPP_RETURN_REASON_REQUIRED` — cửa duy nhất đặt COMPLETED) (`PATCH /wms/inbound-returns/npp/:gdoId`, `requireAnyPerm(inbound.create, tms_plan.confirm_receipt)` vì người nhận ở tab Chuyển kho phải tự gỡ được chặn; cột `ProductionImport.return_reason_code / return_note / recall_id`; phiếu thêm sau khi gắn — `create-one-inbound` — KẾ THỪA lý do, khối đếm `missing` phiếu chưa mang lý do, C107). NPP không dùng app ⇒ kho lập phiếu RT như cũ.
  - **Trang "Hàng trả về"** (`/wms/inbound-returns`, menu Nhập hàng, quyền `inbound.view`): mỗi dòng một phiếu (RT / NPP chuyển về), lọc ngày · kho · dạng · lý do · đợt; dải tổng bằng SQL (RPC `inbound_return_report`, thực nhận RT = sổ nhận trả, TF = dòng tồn); lọc một đợt ⇒ dải "đã thu cả đợt" theo mã; Xuất Excel quyền `inbound.export`. Đợt sau (user hoãn): MỤC TIÊU thu hồi từ truy xuất lô (đã xuất cho ai bao nhiêu ⇒ còn phải thu).
- **Để sau:** đối chiếu dòng trả ZRE1 của SAP (user: không quan tâm) · pallet Loscam (ZRE3 — đi được qua phiếu trả theo chuyến hoặc Nhập SX nhập tay). Gói QA 62.

## Actions

view, create, edit, scan, edit_pallet, force_edit_pallet, delete_pallet, force_delete_pallet, cancel, complete, uncomplete 
