# Kế hoạch: Kho ↔ Khách — MỘT mối nối, không tự ép (28/09/2026)

> Trạng thái: **chờ user duyệt**. Staging đang treo (522 từ ~19:35 28/09) — phần code không cần DB làm trước, phần migration · dọn dữ liệu · QA làm khi staging hồi.

## 0. Vì sao (số đo staging 28/09, trước lúc treo)
- `Warehouse` có 5 CENTRAL + **149 NPP** (seed một lần 29/06, `code` = mã ship-to cũ). Chỉ **7/149** mã còn khớp `Customer.ship_to_code`, 64 trùng tên, **1 lệch nghĩa** (10000099: Kho "Mỹ Phát" ↔ Khách "Đại lý Minh Châu"). **147/149** không có vị trí · tồn · người dùng · chuyến — chỉ là tên. Hai kho NPP có vận hành: **Bluestar** (10010499: 1 tồn · 2 chuyến · 2 người), **An Sơn** (10000274: 1 chuyến).
- `Customer` 213 dòng, SAP nuôi (ZSD02/VL06O), **0** dòng trỏ `warehouse_id`; `Warehouse.shipto_codes` **0/154** kho khai.
- Hoàn thành chuyến tra kho đích theo thứ tự `Customer.warehouse_id` → `Warehouse.code`/`shipto_codes` → **dò TÊN khách trùng tên kho**. 62 lệnh chuyển kho đã sinh đều SELF (61 tìm được kho NPP mode NONE) ⇒ bỏ kho NPP giả **không đổi hành vi** (OTHER ≡ NONE = tài xế tự xác nhận). Cờ Xác nhận giao hàng đang bật cả QR · QTY · NONE · OTHER.
- Ba bản chép tay đích chuyến ở FE (`Outbound.tsx` · `OutboundDetail.tsx` · `TMSBookings.tsx`) tự so `code`/`shipto_codes` — cùng lớp C2/C20.
- Engine Điều vận: khách có `warehouse_id` ⇒ `classKey = INT:<kho>` (đi xe riêng) + `scan_mode` ⇒ nhóm SCAN tách khỏi EXT + `isTransferOd` true. User 28/09: **"không tự ép gì cả, config hết"**.

## 1. Cách hiểu đã chốt với user (28/09)
1. **Kho WMS = plant.** Có kho đích ⇒ luồng chạy tiếp (kế hoạch nhập, nhận theo chế độ tồn QR/QTY/NONE của kho đó); không có ⇒ dừng ở Hoàn thành (OTHER). **Không thêm company code.**
2. **Một mối nối duy nhất: `Customer.warehouse_id`** (N ship-to → 1 kho). Khai ở form Kho (ô chọn ship-to), form Khách (ô Kho nhận, đã có), thao tác hàng loạt (đã có).
3. Gỡ hai đường dò ngầm: `Warehouse.code`/`shipto_codes` và dò TÊN.
4. Ship-to chưa khai mà đã xuất: **không mất dữ liệu** (lệnh chuyển kho OTHER vẫn sinh đủ dòng) — khi khách được trỏ kho thì **nối lại** lệnh chưa ai nhận. Mức nhắc = cấu hình theo kho xuất (không / nhắc / chặn).
5. Điều vận: "đi xe riêng" = ô cấu hình trên Khách, mặc định tắt. Trỏ kho chỉ quyết việc NHẬN.

Giả định còn mở (mặc định tôi chọn, user sửa được ở bảng công tắc): mức nhắc mặc định **NONE** (giữ hành vi cũ, khuyên bật WARN ở Ba Vì · Bàu Bàng); điều kiện "đáng nhắc" = ship-to chưa trỏ kho **và** tên khách trùng tên một kho đang hoạt động (chính phép dò tên cũ, nay chỉ gợi ý không tự nối).

## 1b. Bổ sung user chốt 28/09 (lượt 2)
- **Tự nối theo MÃ:** ship-to trùng `Warehouse.code` (kho đang hoạt động) ⇒ tự ghi `Customer.warehouse_id` — ở CẢ hai cửa: khi ZSD02/VL06O tự sinh khách mới, và khi tạo/đổi mã Kho (nối khách đã có cùng mã). Đây là khớp định danh, không phải suy đoán ⇒ được tự làm; vẫn hiện trong ô chọn của form Kho và bỏ được. Hàm tra kho đích chỉ đọc `Customer.warehouse_id` (một chỗ lưu). Kho tổng có mã không phải số ship-to SAP ⇒ người thêm ship-to vào ô chọn (multi).
- **Ô chọn ship-to trên form Kho = chọn nhiều** (tìm trên server, giá trị đã chọn luôn có nhãn).
- **Số khách tối đa trên một xe:** khai ở KÊNH (`LookupValue.meta.max_customers_per_trip`) và KHÁCH (`Customer.max_customers_per_trip`), giá trị 1 · 2 · 3 · 4 … hoặc **không giới hạn (mặc định)**. Mỗi OD lấy khách → kênh → không giới hạn; giới hạn của một chuyến = nhỏ nhất trong các OD trên xe; trần Kho (`dispatch_max_drops`, hiện mặc định 3) và trần Mã dòng xe (`max_drops`) vẫn là cấu hình ngoài — muốn "mặc định không giới hạn" ở mọi tầng thì đặt trần Kho = không giới hạn (cho phép null).

## 2. Bảng công tắc (C5)
| Cột | Ô UI | Quyền sửa | Mặc định = hành vi cũ? |
|---|---|---|---|
| `Customer.warehouse_id` (có sẵn) | Form Kho → "Ship-to nhận vào kho này" (MỚI) · Form Khách → "Kho nhận" · Hàng loạt "Trỏ kho" | `wms_settings.manage_warehouse` (form Kho, ghi Customer qua route riêng) · `customers.edit` | có — null = OTHER |
| `Customer.dispatch_separate` bool (MỚI) | Form Khách → "Đi xe riêng khi điều vận" + hàng loạt | `customers.edit` (bàn ghép xe KHÔNG sửa) | **false** = không ép; **KHÁC hành vi cũ** với khách đã trỏ kho (hiện 0 khách ⇒ không đổi gì trên staging) |
| `Warehouse.unlinked_shipto_policy` text NONE/WARN/BLOCK (MỚI) | Form Kho → khu XUẤT → "Ship-to có vẻ là kho WMS mà chưa trỏ" | `wms_settings.manage_warehouse` | **NONE** = như cũ |
| `SystemSetting.delivery_confirmation` (có sẵn) | Cài đặt hệ thống | `wms_settings.manage_system` | giữ OTHER bật để không mất dữ liệu |
| `Customer.max_customers_per_trip` int null (MỚI) | Form Khách + hàng loạt → "Số khách tối đa cùng xe" (1…, hoặc Không giới hạn) | `customers.edit` | **null = không giới hạn** |
| `LookupValue(customer_channel).meta.max_customers_per_trip` (MỚI) | Tab Kênh → form kênh | `customers.manage_channel` | **null = không giới hạn** |
| quyền `outbound.push_transfer` (MỚI) | Nút "Đẩy lại cho kho nhận" trên chuyến đã hoàn thành | cấp cho chức danh đang có `outbound.complete` | không có = không đẩy lại được (như cũ) |
| `Warehouse.dispatch_max_drops` (có sẵn, default 3) | Form Kho → Điều vận | `wms_settings.manage_warehouse` | cho phép NULL = không giới hạn (hiện bắt buộc số) |

## 3. Các bước (checklist verify)
**A. Phần không cần DB (làm trước khi staging hồi)**
1. `services/transferDest.ts` (BE, `db` có kiểu): `destWarehouseOfShipto(shipto)` = CHỈ `Customer.warehouse_id` (khách đang hoạt động, kho đang hoạt động); `destWarehousesOfShiptos(list)` chunk 300 cho list. Gỡ nhánh `code`/`shipto_codes` và dò tên trong `warehouseByShipto` + `maybeAutoCreateTransferOrder`; hai hàm đó gọi service. → kiểm: unit test `tests/unit/transferDest.test.ts` (khách trỏ kho ⇒ kho; khách ngừng / kho ngừng / không trỏ ⇒ null; KHÔNG bao giờ tra theo tên).
2. Tách `maybeAutoCreateTransferOrder` sang `services/transferOrderSync.ts` (`syncTransferOrderForGdo(gdoId, now)`), giữ nguyên nhánh SYNC. → kiểm: tsc; gói 13/28 vẫn xanh (bước B).
3. **Đẩy lại thủ công từ kho xuất (user chốt 28/09 lượt 3: "không cần nối tự động — kho xuất vào đẩy lại một lượt là chủ động nhất; cái nào đã có thì không đẩy được")**: KHÔNG có nối lại tự động, KHÔNG cửa sổ ngày. Nút "Đẩy lại cho kho nhận" trên chuyến ĐÃ HOÀN THÀNH (`OutboundDetail`, cả pane detail của list) ⇒ `POST /outbound/:id/push-transfer` (`validate` body rỗng, quyền MỚI `outbound.push_transfer` — cấp theo migration cho chức danh đang có `outbound.complete`, lớp C37) ⇒ tra kho đích HIỆN TẠI của ship-to rồi `syncTransferOrderForGdo`. Chặn: ship-to chưa trỏ kho ⇒ 422 `SHIPTO_UNLINKED`; lệnh chuyển kho đã có kho nhận (đã đẩy rồi) hoặc đã có người nhận ⇒ **409 `TRANSFER_ALREADY_PUSHED`** nêu mã lệnh; chưa có lệnh nào (cờ OTHER tắt lúc hoàn thành) ⇒ tạo mới. Trả `{ order_code, delivery_mode, lines }` để toast nói ra. Gói 58 [14a] (OTHER → trỏ kho → đẩy lại ⇒ SCAN + dest + inbound_plan_lines), [14a2] (đẩy lần 2 ⇒ 409), [14a3] (chưa trỏ ⇒ 422), [14a4] (thiếu quyền ⇒ 403). → kiểm: gói 58 phép mới [14a] (hoàn thành chuyến OTHER → trỏ kho → lệnh chuyển thành SCAN + dest + inbound_plan_lines), [14b] (lệnh đã nhận không bị đụng).
4. Route mới `PUT /masterdata/warehouses/:id/shiptos` `validate({ body: { ship_to_codes: string[] ≤ 500 } })`, `requireAnyPerm([wms_settings.manage_warehouse],[customers.edit])`: set `warehouse_id` cho codes, gỡ cho khách đang trỏ kho này mà không còn trong danh sách; audit `WAREHOUSE_SHIPTOS`; gọi bước 3. → kiểm: gói 23 phép mới (thêm/bớt/khách lạ 404/quyền 403).
5. Form Kho (`WMSSettings.tsx`): ô "Mã ship-to phụ" → `MultiSelect` khách tìm trên server (`search` + `limit 50`, giá trị đã chọn luôn có nhãn — luật danh mục lớn), lưu qua route bước 4; cột "Ship-to phụ" trong bảng Kho → "Ship-to nhận" đếm từ Customer. Thêm ô `unlinked_shipto_policy` vào khu XUẤT (`SettingsGroup area="XUẤT"`). → kiểm: tsc/build; chụp 1280 + 390; ratchet `settings_area_interleaved`, `catalogue_full_load`.
6. Nhắc/chặn: BE `GET /outbound/:id` + list trả `dest_warehouse {id,name,inventory_mode} | null` và `unlinked_hint: {warehouse_name} | null` (khách chưa trỏ và tên trùng kho hoạt động); Hoàn thành: policy BLOCK ⇒ 422 `SHIPTO_UNLINKED` nêu tên; WARN ⇒ chỉ cờ. FE: chip vàng ở header chuyến + trang danh sách (`InfoTip` diễn giải + link "Trỏ kho ›" tới form Khách). Gỡ 3 bản so `code`/`shipto_codes` ở FE, đọc `dest_warehouse` từ API. → kiểm: gói 58 [14c] WARN không chặn, [14d] BLOCK 422, [14e] NONE im; ratchet `hook_after_early_return`.
6b. Tự nối theo mã: `services/customerGeo.ts` (khách tự sinh) + `ensureCustomers` (dateRulePolicy) + `warehouseController` create/update mã ⇒ `linkCustomersByWarehouseCode(codes)`; unit test `tests/unit/transferDest.test.ts` thêm ca "trùng mã ⇒ trỏ, không trùng ⇒ null, khách đã trỏ kho khác ⇒ giữ". Gói 59 phép [2h3] (ship-to = mã kho fixture ⇒ khách tự sinh đã trỏ kho).
6c. Số khách tối đa cùng xe: `stopsLimit` của engine nhận `perOd: (od) => number | null` (khách → kênh → null); giới hạn chuyến = min(kho, dòng xe, min OD); `Warehouse.dispatch_max_drops` cho phép null. Form Khách/Kênh/hàng loạt thêm ô. `dispatchEngine.test.ts` ca: hai OD kênh KA (max 1) không chung xe; OD GT không giới hạn ghép bình thường; hỗn hợp lấy min. Gói 61 [13j].
7. Điều vận: `Customer.dispatch_separate` → `EngineOd.separate` ; `classKey` = `separate ? SEP:<ship_to> : 'ALL'` (bỏ `INT:` và `SCAN/EXT`); `isTransferOd` = chỉ `flow STO/INTERNAL` (cờ SAP, để hiển thị + cước); bàn ghép xe KHÔNG có ô này (luật 27/09: bàn chỉ sửa dòng xe). Form Khách + hàng loạt thêm ô. → kiểm: `dispatchEngine.test.ts` viết lại ca luật 1 (khách trỏ kho, cờ tắt ⇒ ghép chung; cờ bật ⇒ riêng); gói 61 [13h][13i].
8. Tài liệu: `docs/modules/customers.md` · `outbound.md` · `wms_settings.md` · `dispatch.md` · `tms_plan.md` (mục Giao thoa hai chiều), CLAUDE.md dòng "Khách hàng nuôi … luật chuyển kho" + bảng quyền. `node scripts/docs/check-modules.mjs`.
9. `SCHEMA_REVIEW.md`: 2 cột mới + ghi `Warehouse.shipto_codes` CHƯA DROP (dọn sau một đợt), `npm run db:types`.

**B. Phần cần DB (khi staging hồi — tuần tự, một việc một lúc)**
10. Migration `20260929_customer_wh_link.sql`: (a) thêm `Customer.dispatch_separate boolean not null default false`, `Warehouse.unlinked_shipto_policy text not null default 'NONE' check in (NONE,WARN,BLOCK)`; (b) trỏ 10010499 → Bluestar, 10000274 → An Sơn; (c) kho NPP không vận hành (không Location · InventoryEntry · UserWarehouseAccess · GDO nguồn) ⇒ `is_active=false`; (d) lệnh chuyển kho PENDING/SELF đang nằm dưới kho vừa tắt ⇒ `warehouse_id` = kho xuất của GDO, `destination_warehouse_id = null` (đúng nghĩa OTHER), `order_code` giữ. Apply qua `scratchpad/apply_mig.mjs` (kiểm đúng project staging). → kiểm: đếm trước/sau bằng SQL; gói 00 bất biến.
11. QA: `npm test` → `--tier fast` → gói 58 · 23 · 61 · 13 · 28 · 14 · 12 + chạy lại 8 gói đỏ tối 28/09 (00 · 08 · 12 · 14 · 58 · 59 · 60 · 61). Phép mới phải ĐỎ trên bản cũ (`git stash`). Ratchet độ phủ cho route mới.
12. Chụp Playwright: form Kho (ô ship-to + ô nhắc), form Khách (ô đi xe riêng), chuyến có chip nhắc — 1280 + 390, cạnh màn chuẩn.
13. Push dev → CI → memory + BUG_CLASSES (LẶP C2/C20: 3 bản FE so `shipto_codes`; lưới = xoá bản chép, FE đọc `dest_warehouse` từ API).

## 4. Ngoài phạm vi (đợt sau, ghi để không quên)
- Chữ tự do NPP ở upload Kế hoạch xuất / lệnh VC → tra ra ship-to lúc nạp (đo: 11 tên, 6 khớp kho, 9 khớp khách).
- DROP `Warehouse.shipto_codes` + gỡ ô/cột cũ khỏi seed dialog (`match_by = 'SHIPTO'`).
- Kênh theo ĐƠN cho NPP mua qua kênh MT/KA (câu hỏi 28/09, chờ chốt).
