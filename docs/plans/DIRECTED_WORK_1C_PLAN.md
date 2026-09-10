# Directed Work đợt 1c — Kế hoạch lấy hàng theo vị trí + 3 bảng theo vai

> Lập 10/09/2026 (Fable brainstorm → Opus code). Kho thí điểm **Ba Vì** (QR, bản vẽ đủ: 74 chân kệ · 5 cửa xuất · 2 cửa nhập · 4 điểm đặt dãy).
> Nền đã có: `warehouse_map` (đợt 0/0.5), cửa xuất có sức chứa xe (đợt 1a, RULE 3 `startGDO`), 3D chỉ xem (1b).
> Đọc trước: `docs/plans/DIRECTED_WORK_PLAN.md` (giả định đang áp) · memory `directed-work-task-engine` (mọi câu đã chốt 08–09/09).
> **KHÔNG code trước khi user duyệt mục 0.** Sau duyệt, Opus code theo mục 2–6 đúng thứ tự, mỗi bước có "kiểm tra" riêng.

---

## 0. Brainstorm — quyết định, đổi so plan cũ, câu hỏi còn mở

### 0.1 Số liệu thật của Ba Vì (staging, đo 10/09) — vì sao đợt này có giá trị

| | Số |
|---|---|
| Pallet đang tồn | **5.973** trong 216 ô |
| Pallet ở tầng ≥ 2 (cần xe hạ nếu ngưỡng = 2) | **3.674 = 62 %** |
| Mã lớn nhất `510000084` | 582 pallet rải **33 dãy · 3 khu · 10 NSX** |
| Mã `510000364` | 350 pallet · 21 dãy · 4 NSX |
| Cửa xuất | 5 (Cửa cont 1/2 · Cửa pallet 1/2 · **Cửa sca**) — cửa nhập tên **Cửa FG01 / FG02** |
| Điểm đặt dãy | 4, cùng hàng y=52, sức chứa 0 = không giới hạn |
| `cartons_reserved` > 0 hiện tại | 0 dòng |

Một mã nằm ở 33 dãy/3 khu với 10 NSX ⇒ **thủ kho hiện phải tự nhớ FEFO + tự chọn dãy gần cửa**; 62 % pallet cần xe hạ ⇒ xe hạ không có thứ tự là nút thắt thật. Đúng chỗ Directed Work có lợi.

### 0.2 Ba quyết định ĐỔI so với plan 09/09 (cần user gật)

| # | Plan 09/09 nói | Đề xuất 1c | Vì sao |
|---|---|---|---|
| A | Giữ chỗ pallet bằng **`cartons_reserved`** | **Giữ chỗ MỀM qua chính bảng việc** (`wms_tasks` PENDING/LOWERED = pallet "đã có chủ", bộ sinh việc của chuyến khác bỏ qua). KHÔNG đụng `cartons_reserved`. | `cartons_reserved` đang là cột của **nhặt lẻ** (`adjustInventoryAtomic(inv, 0, +n)` ở `scanItem` loose) và `availableOf()` trừ nó ở **mọi** cửa quét. Giữ chỗ cứng cho chính chuyến A rồi thủ kho chuyến A quét pallet đó ⇒ `available = remaining − reserved` **tự trừ chính mình → 400 "đã xuất hết" oan**; phải sửa 3 cửa (scanItem / checkScanItem / manualComplete) để nhận diện "giữ của mình" — đúng lớp lỗi "hai đường vào cùng một số". Chế độ **HƯỚNG DẪN** vốn không chặn (user chốt: quét pallet khác → việc cũ SKIPPED) nên giữ chỗ cứng không mua thêm gì. Tranh chấp thật (2 chuyến cùng cần 1 pallet) giải quyết lúc quét: việc SKIPPED `PALLET_TAKEN` + tự sắp bù. |
| B | `level_seconds` jsonb (phụ phí giây theo tầng) | **Bỏ khỏi 1c** | Chỉ dùng để ước thời gian; 1c chưa hiện ước thời gian ở đâu. CLAUDE.md #2: chưa cần thì chưa thêm. Thứ tự "tầng cao trước" không cần số giây. |
| C | Quyền `reassign` + assignee trên từng việc | **Bỏ assignee per-việc** trong 1c | User chốt vòng 5: xe hạ **không được chọn**, có tab toàn kho; xe chuyển = `GroupDeliveryOrder.forklift_driver_id` chọn lúc Bắt đầu (cột đã có). Bảng "của tôi" lọc theo cột đó là đủ. Assignee per-việc = đợt điều phối/xen việc (đợt 4 lộ trình). |

### 0.3 Câu hỏi user nêu 10/09: "cửa nhập, cửa xuất, đầu dãy có cần phân theo LOẠI KHO không?"

**Có — nhưng ở mức nhẹ, tuỳ chọn, và nên làm ngay trong 1c** vì bộ sinh việc cần nó để chọn điểm đặt dãy. Bằng chứng từ chính dữ liệu Ba Vì: cửa nhập tên **"Cửa FG01 / Cửa FG02"** (mã Loại kho SAP), cửa xuất có **"Cửa sca"** (khu lạnh SCA — memory: "khu đặc thù SCA = Loại kho riêng"). Kho thật đang phân cửa theo loại hàng bằng **tên**, app chưa biết.

Cách làm nhẹ nhất, khớp khái niệm sẵn có:
- Thêm `Location.serve_categories text[]` cho `kind ∈ (DOCK_IN, DOCK_OUT, DROP)`; **NULL/rỗng = phục vụ mọi loại** (mặc định ⇒ hành vi hiện tại không đổi). Khai ở pane đối tượng trên Sơ đồ kho (chip nhiều chọn từ `useScopedWhTypes`, giống form Khu vực).
- Ba nơi tiêu thụ: **(1)** ô chọn cửa lúc Bắt đầu + `PATCH /outbound/:id/dock`: cửa có khai loại mà **∅ giao với loại hàng chuyến** (`splitCategories(gdo.warehouse_type)`, giao ≥ 1 — cùng luật chuyến chở lẫn) ⇒ 422 `DOCK_CATEGORY_MISMATCH` nêu cửa hợp lệ còn trống — cùng khuôn `BOOKING_CATEGORY_MISMATCH` đã có; FE mờ cửa lệch loại như đang mờ cửa đầy. **(2)** bộ sinh việc chọn **điểm đặt dãy gần nhất trong số điểm phục vụ loại của pallet**. **(3)** Không cắt scope xem: người thiếu loại vẫn thấy cửa trên bản vẽ (hạ tầng chung).
- Cửa **nhập** khai loại thì đợt directed putaway (đợt 3) mới tiêu thụ; 1c chỉ lưu + hiện.
- **Không** đưa cửa vào `WarehouseZone` (khu có `pick_rank`, màu, luật cất — cửa nằm mép kho, ghép vào khu là méo cả hai).

Ước tính +0,5 ngày. Nếu user muốn hoãn thì bỏ bước 2.3 và 3.4 dưới; generator lấy DROP gần nhất bất kể loại.

### 0.4 Giả định đang áp (user không phản đối thì giữ)
1. Chỉ bật HƯỚNG DẪN được cho kho **`inventory_mode = 'QR'` có bản vẽ đã lưu** (validator 422 nêu lý do). Kho QTY/QTY_DATE vẫn THỦ CÔNG (đợt 0b phương án A/B chưa quyết).
2. Bộ sinh việc chạy **lúc Bắt đầu** (sau CAS thành công) và **không bao giờ làm Bắt đầu thất bại** — lỗi lập kế hoạch = `plan_warning` trong response + `error_logs`, chuyến vẫn chạy như THỦ CÔNG.
3. Chuyến nội bộ Ba Vì → Chế biến (miễn cửa): đích = **điểm đặt dãy gần nhất**; điểm "Giao Chế biến" riêng chưa vẽ thì chưa có.
4. Xuất luôn (2 đường) không sinh việc (chuyến xong trong cùng request).
5. Phần **nhặt lẻ** của đơn nằm CHUNG kế hoạch dưới dạng việc `is_partial` (lấy N thùng từ pallet X) — "nhặt lẻ cũng phải được chỉ đường" (chốt 08/09). Quét ở chế độ nhặt lẻ hay xuất đều đóng việc.
6. "Giờ xe" để sắp bảng Cần hạ = **`started_at` của chuyến** (xe đã ở cửa) trong 1c; nối `booking_sequence` (khung giờ) là v2 — RPC hiện trả theo `order_code`/biển, chưa có cầu nối chắc tới `gdo_id`.
7. Ngưỡng tầng cần hạ mặc định **2** (T2 trở lên xe hạ; T1 và sàn xe chuyển lấy trực tiếp).

### 0.6 LUẬT DATE HAI VÙNG (user nêu 10/09: "date dưới 60 % thì theo chỉ định, chưa làm rõ được — nên mới phải chọn tay")
Kho KHÔNG chạy FEFO toàn bộ: pallet %Date thấp chỉ xuất khi được CHỈ ĐỊNH (CS/thủ kho quyết theo khách). Máy không được tự chia phần luật chưa rõ, nhưng phần đó vẫn phải nằm TRONG bảng.
- **Ngưỡng tự chia** `auto_pick_min_pct int` (2 tầng Kho + Loại kho, mặc định **60**, 0 = tắt ranh giới = FEFO toàn bộ). Pallet `computePctDate ≥ ngưỡng` = **vùng tự động** → generator chia FEFO. Pallet dưới ngưỡng = **vùng chỉ định** → generator **KHÔNG BAO GIỜ** tự chọn.
- **Chỉ định trên dòng đơn** — dùng ô `OutboundItem.batch_required` sẵn có (NSX / mã lô) + cột mới `pinned_pallets text[]` (tem ghim tay). Dòng có chỉ định → generator chia ĐÚNG pallet/NSX đó **kể cả dưới ngưỡng**, vẫn lọc `date_required` và QA giữ.
- **Nút "Chỉ định cho dòng này"** ngay trong ô search tồn kho của Chuẩn bị hàng / trang chuyến (thao tác tay hiện tại, thêm một nút để hệ thống ghi lại): chọn NSX (mặc định) hoặc tem cụ thể → ghi `batch_required` / `pinned_pallets` → tự `planGdoTasks` lại. Quyền `outbound.edit` (sửa đơn) — không thêm quyền mới.
- Dòng vùng tự động **không đủ** → bảng hiện dòng đặc biệt **"Thiếu N thùng — chờ chỉ định"** (không phải việc, `kind='SHORTAGE'` tính lúc đọc), có nút mở ô chỉ định. Tuyệt đối không tự lấy hàng date thấp.
- Sau này luật rõ hơn (vd "khách X nhận tới 40 %") → thêm vào MỘT chỗ chia trong `directedTasks.ts`, không đổi cách làm việc.

### 0.6b QUY TẮC DATE CÓ CẤU TRÚC — thay cho "ngưỡng + chỉ định" ở 0.6 (user làm rõ 10/09 vòng 2)
Hiện trạng user mô tả: NPP đi ≥ 60 % nếu CS không ghi chú; CS ghi chú bằng CHỮ (khi %, khi ngày, thấp hơn hay cao hơn đều có); trung chuyển đòi "date mới nhất" — nhưng là mới nhất **theo SAP** (hàng vừa nhập chưa có trên SAP). **Không code parser cho ghi chú CS** — chữ không có logic bền.
- Mỗi dòng đơn mang **một quy tắc date có cấu trúc** (cột jsonb `OutboundItem.date_rule` `{kind, value, source, note}`), 4 dạng: `MIN_PCT` (≥ n %) · `EXACT` (NSX hoặc HSD hoặc lô — dùng `batch_required` sẵn có làm value) · `NEWEST` (LIFO cho dòng này) · `UNSET` ("chưa chốt" — máy KHÔNG chia, RPC trả dòng vàng "chờ chốt date" kèm ghi chú CS nguyên văn). `date_required` sẵn có = `MIN_PCT` cũ, migrate sang rule khi đọc (không đổi cột cũ để bundle cũ vẫn chạy).
- **Nguồn (ưu tiên giảm dần), ghi vào `source`:** `DEFAULT` (theo LOẠI ĐƠN — khai ở Cài đặt kho: NPP → MIN_PCT 60; trung chuyển → NEWEST; không code cứng) · `SAP` (VL06O có lô/NSX → EXACT, không ai gõ — **chờ user xác nhận VL06O trung chuyển có cột này không**) · `CS_NOTE` (dòng có ghi chú CS ⇒ tự về `UNSET`, hiện ghi chú; người chuẩn bị bấm chốt % hoặc ngày; **tuỳ chọn**: gợi ý cách hiểu bằng AI Vision config sẵn có (Gemini/GPT) — chỉ gợi ý, người xác nhận) · `MANUAL` (sửa tay bất kỳ lúc nào → `planGdoTasks` lại).
- **Trung chuyển "mới nhất theo SAP"** — 3 mức, chọn theo trả lời của user: (a) VL06O có lô/NSX → SAP là nguồn, hết vấn đề; (b) đánh dấu `InventoryEntry.sap_synced_at` khi ERP kéo qua cổng `/api/integration/v1` → NEWEST = mới nhất **trong số đã lên SAP** (việc riêng nhỏ, cùng đợt nếu user gật); (c) tạm: trung chuyển mặc định `UNSET`, người nhìn SAP rồi chốt NSX một cái.
- Bộ sinh việc chỉ chia dòng có rule ≠ UNSET; QA 57 thêm oracle theo từng dạng rule + ca "ghi chú CS ⇒ không chia". Ngưỡng `auto_pick_min_pct` ở 0.6 trở thành **giá trị DEFAULT của MIN_PCT cho đơn NPP** (không còn là ranh giới toàn kho).

### 0.7 HIỂN THỊ CHỈ DẪN (user chốt 10/09: "không văn xuôi, đưa vào table; xong thì gạch; có nút đánh dấu phòng quên")
- Chỉ dẫn cho xe nâng gom **theo Ô**: một dòng = *Ô A12 · tầng 3 · hạ **4 pallet** → Điểm đặt dãy 2* (việc vẫn lưu từng pallet trong `wms_tasks`, RPC gom `GROUP BY from_location, level, drop` cho mode LOWER/MOVE; mode SCAN của thủ kho vẫn từng pallet vì quét theo tem). Không ghim tem lên bảng xe nâng — khớp chốt 08/09 "xe hạ không quét".
- Dòng xong = **gạch ngang + xám, VẪN Ở LẠI** bảng tới khi chuyến Hoàn thành (không biến mất), ghi "✓ quét đủ hh:mm" / "✓ đã hạ hh:mm · Tên". Chip **"Ẩn việc đã xong"** (mặc định hiện) lưu theo user trong filter store.
- Nút tick tay: **☐ Đã hạ** (xe hạ, → `LOWERED`) và **☐ Đã đưa ra** (xe chuyển, → `MOVED`, trạng thái mới). Thủ kho quét đủ → `DONE`, và nếu chưa ai tick thì hệ thống gạch thay. Tick nhầm → bấm lại bỏ tick (về `PENDING`, có event).
- Đầu mỗi chuyến: ô tổng **"n/m việc xong"** + thanh tiến độ; band trang: việc treo · chờ hạ · đã hạ chờ chuyển · chờ chỉ định.
- Trạng thái đầy đủ: `PENDING → LOWERED → MOVED → DONE`, nhánh `SKIPPED` / `CANCELLED`. Sửa 2.2 CHECK + 2.5 sort (MOVE mode: MOVED xếp cuối gạch).

### 0.5 Câu hỏi còn mở cho user (trả lời rồi Opus mới code)
0. **Ngưỡng tự chia ở Ba Vì đúng 60 %?** Chỉ định mặc định theo **NSX** hay theo **tem pallet**? (đề xuất NSX là chính, tem là tuỳ chọn — ô sàn xếp khối không ghim được tem, cùng bài học Fill 05/08)
1. **A/B/C ở 0.2** — đồng ý cả ba?
2. **0.3** — làm Loại kho cho cửa/đầu dãy ngay trong 1c (đề xuất CÓ)?
3. **Tên menu** cho trang 3 bảng: đề xuất **"Lệnh việc"** (module `directed_work`, menu Kho WMS). Phương án khác: "Điều phối kho".
4. Việc **"Đã hạ"** có tự **chuyển vị trí pallet vào điểm đặt dãy** không (đề xuất CÓ, qua `move_pallets_to_location` — tồn phản ánh đúng chỗ pallet đang nằm, thủ kho quét ở bãi thấy đúng ô)? Nếu KHÔNG thì "Đã hạ" chỉ đổi trạng thái việc.

---

## 1. Kiến trúc tóm tắt

```
Bắt đầu chuyến (startGDO, kho GUIDED)
   └─ planGdoTasks(gdoId)  [services/directedTasks.ts — idempotent, gọi lại được]
        ├─ nhu cầu từng dòng hàng = ordered − scanned − Σ việc PENDING/LOWERED
        ├─ ứng viên pallet theo mã: cùng query/luật với rotationSuggestionsByMaterial
        │    (PICKABLE_STATUSES · isPickEligible · rotationSortKey · date_required · loại trừ
        │     pallet đang là việc PENDING/LOWERED của chuyến khác)
        ├─ chọn tham lam theo FEFO → hoà: gần cửa (BFS) → tầng thấp → ít hàng → mã ô
        ├─ needs_lower = level_no ≥ lower_from_level ; drop = DROP gần nhất (đúng loại)
        ├─ seq = orderByNearest(cửa → các ô) ; cùng ô: tầng cao trước
        └─ INSERT lô wms_tasks (+ events PLANNED)
Quét (scanItem) ── việc (gdo, entry) → DONE ; pallet khác cùng mã → việc cũ SKIPPED + planGdoTasks(bù)
                └─ việc của CHUYẾN KHÁC trên pallet này → SKIPPED PALLET_TAKEN + bù cho chuyến đó
Bỏ Bắt đầu / Huỷ / Hoàn thành ── việc còn treo → CANCELLED
RPC directed_board(wh, mode, gdo?, driver?) ── 1 round-trip jsonb nuôi 3 bảng + dải "Sắp quét" trên trang chuyến
Realtime: wms_tasks trong TABLE_QUERY_MAP → ['directed-board', 'gdo', 'outbound-detail']
```

**Một nguồn luật:** thứ tự pallet CHỈ qua `utils/rotation.ts` (ratchet `rotation_rule_hand_rolled` đang gác); khoảng cách CHỈ qua `utils/warehouseGrid.ts`; mọi đổi `status` của việc CHỈ qua `services/directedTasks.ts` (ratchet mới `task_status_written_outside_service`).

---

## 2. Bước 2 — Dữ liệu (migration `backend/migrations/20260910c_directed_work.sql`, áp staging qua `apply_mig_map.mjs`)

| # | Việc | Kiểm tra |
|---|---|---|
| 2.1 | **Cờ 2 tầng** — `Warehouse.work_mode text NOT NULL DEFAULT 'MANUAL' CHECK IN ('MANUAL','GUIDED')`, `Warehouse.lower_from_level int NOT NULL DEFAULT 2 CHECK 1..50`, **`Warehouse.auto_pick_min_pct int NOT NULL DEFAULT 60 CHECK 0..100`** (0.6); `warehouse_type_configs.work_mode text NULL`, `.lower_from_level int NULL`, `.auto_pick_min_pct int NULL` (NULL = theo kho). **`OutboundItem.pinned_pallets text[] NULL`** (tem ghim tay; NSX chỉ định dùng `batch_required` sẵn có). Resolver: mở rộng `resolveRotation`/`RotationConfig` trong `utils/putaway.ts` thành trả thêm `work_mode`, `lower_from_level` (hoặc hàm chị em `resolveWorkMode` cùng file — **không** viết resolver thứ hai ở controller). | `SELECT` sau apply; `resolveRotation(wh,[type FG01: GUIDED],'FG01').work_mode='GUIDED'`, loại khác vẫn 'MANUAL' |
| 2.2 | **Bảng `wms_tasks`** — cột: `id text PK` · `warehouse_id text NOT NULL REF Warehouse` · `gdo_id text NOT NULL REF GroupDeliveryOrder ON DELETE CASCADE` · `item_id text NOT NULL REF OutboundItem ON DELETE CASCADE` · `entry_id text REF InventoryEntry ON DELETE SET NULL` · `pallet_code text NOT NULL` · `material_id text` · `material_code text` · `qty_base numeric NOT NULL CHECK > 0` · `is_partial boolean NOT NULL DEFAULT false` · `from_location_id text REF Location` · `from_location_code text` · `level_no int` · `needs_lower boolean NOT NULL DEFAULT false` · `drop_location_id text REF Location ON DELETE SET NULL` · `dock_location_id text REF Location ON DELETE SET NULL` · `dist_cells int` (NULL = không tới được) · `seq int NOT NULL` · `status text NOT NULL CHECK IN ('PENDING','LOWERED','MOVED','DONE','SKIPPED','CANCELLED')` · `lowered_at timestamptz` `lowered_by text` · `moved_at timestamptz` `moved_by text` · `done_at timestamptz` `done_by text` `scan_entry_id text` · `skip_reason text` · `plan_version int NOT NULL DEFAULT 1` · `created_at/updated_at timestamptz NOT NULL`. Index: `(warehouse_id, status) WHERE status IN ('PENDING','LOWERED')` · `(gdo_id, status)` · `(entry_id) WHERE status IN ('PENDING','LOWERED')`. **Unique** `(gdo_id, entry_id) WHERE status IN ('PENDING','LOWERED')` (một chuyến không lập 2 việc trên 1 pallet; bộ sinh bắt 23505 → bỏ pallet đó, thử tiếp). Realtime: **chỉ** thêm dòng `TABLE_QUERY_MAP` (event trigger tự gắn `trg_wms_notify`). | INSERT thiếu `seq` → 23502; 2 INSERT cùng (gdo, entry) PENDING → 23505; `realtime_readiness` thấy `has_trigger` |
| 2.3 | **Loại kho cho cửa/đầu dãy** (0.3) — `Location.serve_categories text[] NULL` (ý nghĩa chỉ với `kind <> 'STORAGE'`; NULL/rỗng = mọi loại). | cột có; bản vẽ cũ không đổi hành vi |
| 2.4 | **Bảng `wms_task_events`** — `id text PK` · `task_id text NOT NULL REF wms_tasks ON DELETE CASCADE` · `event text NOT NULL` (PLANNED · LOWERED · DONE · SKIPPED · CANCELLED · REPLANNED) · `actor text` · `at timestamptz NOT NULL` · `note text`. **`DROP TRIGGER trg_wms_notify`** trên bảng này (log nội bộ, không bắn tín hiệu — skill security-hardening). Đây là nguồn "giờ công theo việc" cho KPI sau (memory `kpi-master-list-gaps` mảnh 4). | QA 00 mục 10 không đỏ (bảng không khai trong TABLE_QUERY_MAP) |
| 2.5 | **RPC `directed_board(p_warehouse_id text, p_mode text, p_gdo_id text DEFAULT NULL, p_driver_id text DEFAULT NULL) RETURNS jsonb`** — 1 round-trip, trả `{rows:[…], totals:{…}}`. Mỗi row = việc + `group_code, license_plate, gdo_status, started_at, forklift_driver_id, dock_name, drop_name, material_name, level_no, dist_cells, seq, status`. **Sắp trong SQL:** `LOWER` (needs_lower AND status='PENDING', toàn kho): `xe_dang_cho DESC` (chuyến không còn việc PENDING nào KHÔNG cần hạ = xe đứng bãi chỉ chờ hạ) → `started_at ASC` → `dist_cells ASC NULLS LAST` → `level_no DESC` → `seq`; `MOVE` (status IN ('PENDING','LOWERED') AND (NOT needs_lower OR status='LOWERED'), lọc `p_gdo_id`/`p_driver_id` = `forklift_driver_id`): `started_at, seq`; `SCAN` (status IN ('PENDING','LOWERED'), `p_gdo_id` bắt buộc): `seq`; cờ `is_next` = dòng đầu. Không GRANT gì (mặc định đóng, backend đi service_role). | 3 mode trả đúng tập; sort kiểm bằng oracle QA (mục 6) |
| 2.6 | `SCHEMA_REVIEW.md` thêm dòng 2026-09-10c; comment cột đầy đủ. | file có dòng |

---

## 3. Bước 3 — Backend

| # | Việc | Kiểm tra |
|---|---|---|
| 3.1 | **`backend/src/services/directedTasks.ts`** (file MỚI, mọi ghi `wms_tasks` đi qua đây): `planGdoTasks(gdoId, actor): Promise<{created, cancelled, warning?}>` **idempotent** — (a) nạp chuyến (`warehouse_id, status, started_at, dock_location_id, warehouse_type, shipto`), cờ `resolveWorkMode` theo (kho, loại của MÃ) — không GUIDED → `{created:0}`; kho không QR / không bản vẽ → warning; (b) nhu cầu từng dòng = `cartons_ordered − cartons_scanned − Σ qty_base việc PENDING/LOWERED của dòng` (≤ 0 → nếu Σ việc > nhu cầu thì CANCELLED các việc **cuối seq** cho khớp — đơn bị SAP hạ SL); (c0) **hai vùng date (0.6)**: dòng có chỉ định (`pinned_pallets` hoặc `batch_required` khớp NSX/lô) → ứng viên = ĐÚNG pallet/NSX đó, bỏ ngưỡng; dòng không chỉ định → chỉ pallet `computePctDate ≥ auto_pick_min_pct` (ngưỡng theo (kho, loại của mã); 0 = không ranh giới); (c) ứng viên: **tái dùng đúng query của `rotationSuggestionsByMaterial`** nhưng giữ **từng pallet** (thêm `id, pallet_code, location.id, grid_x, grid_y, grid_w, grid_h, level_no, sub_code, material.category`) — tách phần query thành hàm chung `fetchPickCandidates(matIds, warehouseIds)` để 2 nơi không lệch; loại trừ pallet đang là việc PENDING/LOWERED của chuyến khác (1 query `wms_tasks` theo kho); lọc `computePctDate ≥ item.date_required`; (d) sort `rotationSortKey` ASC (null cuối) → hoà: `dist_cells` ASC → `level_no` ASC → `available` ASC → `location_code` (naturalCompare); (e) tham lam lấy tới đủ nhu cầu; pallet cuối lấy phần → `is_partial=true`; **không đủ → KHÔNG lấy vùng chỉ định**, phần thiếu để RPC báo dòng "Thiếu N thùng — chờ chỉ định"; (f) `needs_lower = level_no ≥ lower_from_level`; `drop_location_id` = DROP active gần nhất (BFS từ từng DROP, cache theo `warehouse_id + warehouse_maps.updated_at`) trong số DROP có `serve_categories` rỗng hoặc chứa `material.category`; (g) `seq`: `orderByNearest(frame, mask, dockCell, [cells của từng ô đích])` từ **cửa của chuyến** (`dock_location_id`; nội bộ/không cửa → DROP gần tâm kho… → nếu không có gì thì `naturalCompare` mã ô), cùng ô: `level_no` DESC; (h) INSERT lô (`id: randomUUID()`, `updated_at`), bắt 23505 → bỏ pallet, lặp tối đa 3 vòng có jitter; ghi events PLANNED. Cũng export: `markTaskDoneByScan(gdoId, entryId, scanEntryId, actor)`, `skipTasksOnForeignScan(entryId, exceptGdoId, actor)` (việc của chuyến khác → SKIPPED `PALLET_TAKEN` + `planGdoTasks` bù cho từng chuyến đó), `skipOnePendingOfItem(gdoId, itemId, reason)`, `cancelGdoTasks(gdoId, reason)`, `lowerTask(taskId, actor, moveToDrop: boolean)`. | Unit-ish qua QA 57 oracle: Σ qty việc = Σ nhu cầu · không việc nào có `rotationSortKey` > khoá của pallet đủ điều kiện chưa chọn cùng mã (cho phép bằng) · `needs_lower` ⇔ `level_no ≥ ngưỡng` · seq duy nhất 1..n · gọi `planGdoTasks` lần 2 → `created=0` |
| 3.2 | **Móc vào `startGDO`**: sau CAS thành công (nơi đang ghi `dock_location_id`), gọi `planGdoTasks`; lỗi → `recordServerError` + trả `plan_warning` trong payload, **không** 5xx. `unstartGDO`, `patchGDO status=CANCELLED`, `patchGDO status=COMPLETED` (+ đường `manualComplete`/complete khác đặt COMPLETED) → `cancelGdoTasks` (reason theo đường). | QA 57: start kho GUIDED → n việc; unstart → 0 PENDING, có CANCELLED; kho MANUAL → 0 việc; start vẫn 200 khi bản vẽ bị xoá tạm (warning) |
| 3.3 | **Móc vào `scanItem`** (cả 2 chế độ) và `manualComplete`/ghi tay no-QR nếu áp cho kho QR: sau INSERT scan entry thành công → `markTaskDoneByScan`; không có việc khớp (gdo, entry) mà dòng hàng còn việc PENDING/LOWERED → `skipOnePendingOfItem(gdo, item, 'OTHER_PALLET')` rồi `planGdoTasks` bù; luôn `skipTasksOnForeignScan(entry, gdo)`. **Không** đổi kết quả quét (HƯỚNG DẪN không chặn). Chi phí thêm cho lượt quét bình thường: 1 SELECT + 1 UPDATE. | QA 57: quét đúng pallet → DONE + `scan_entry_id`; quét pallet khác cùng mã → việc cũ SKIPPED `OTHER_PALLET` + việc mới; chuyến B quét pallet đang là việc của A → việc A SKIPPED `PALLET_TAKEN` + A có việc bù |
| 3.4 | **Cửa theo loại (0.3)**: `startGDO` + `changeDockGDO` — cửa có `serve_categories` khai và `∅` giao `splitCategories(gdo.warehouse_type)` ⇒ 422 `DOCK_CATEGORY_MISMATCH` + `dockFreeHint` chỉ liệt kê cửa hợp loại; `warehouse_docks_status` trả thêm `serve_categories`; `renameMapObject` (PATCH objects/:id) nhận `serve_categories` (validate ∈ danh mục `warehouse_type`, chỉ `kind <> STORAGE`). | QA 57: cửa khai PM01, chuyến FG01 → 422; chuyến `FG01+PM01` → 200 (giao ≥1); cửa rỗng → 200 |
| 3.5 | **Route + controller `directedWorkController.ts`**: `GET /wms/directed/board?warehouse_id&mode&gdo_id&driver_id` (`requirePerm('directed_work','view')`, `guardWarehouseScope`, id rác → 400 qua `searchLooksLikeInjection`) → RPC 2.5; `POST /wms/directed/tasks/:id/lower {move_to_drop?}` (`directed_work.lower`; việc phải PENDING & needs_lower; `move_to_drop` → `move_pallets_to_location([entry], drop, actor, vnDate, now)` — RPC coi `max_pallets=0` là không giới hạn, đã đọc `20260815k` dòng 119; FULL → 409 nêu điểm khác); `POST /wms/directed/tasks/:id/moved` + `DELETE …/lower` `DELETE …/moved` (tick / bỏ tick, `directed_work.lower`; nhận `location_ids[]` để tick **cả nhóm theo ô** một lần vì bảng xe nâng gom theo ô); `POST /wms/directed/gdos/:id/replan` (`directed_work.replan`) → `planGdoTasks`; **`PATCH /outbound/:gdoId/items/:itemId/pin`** `{ batch_required?, pinned_pallets? }` (`outbound.edit`, `itemOfGdo` ràng con thuộc cha) → ghi chỉ định + `planGdoTasks`. Mount qua `catchAsyncErrors` như 7 router hiện có. `fail(res, error)` truyền cả đối tượng lỗi. | QA 07 params-fuzz tự quét route mới (GET/POST) → 4xx sạch; QA 08 perm |
| 3.6 | **Quyền 4 nơi** — module `directed_work` nhãn "Lệnh việc": `view` (3 bảng + dải Sắp quét), `lower` (nút Đã hạ), `replan` (nút Sắp lại). FE `MODULES` + BE `ALL_PERMISSIONS` + gate nút + `requirePerm`; bảng bản đồ module trong CLAUDE.md. | QA 08: FE ⇄ BE khớp |
| 3.7 | `fetchGDOFull` trả thêm `tasks_summary {pending, lowered, done, skipped}` (1 câu đếm) để trang chuyến hiện dải. Bump **rebuild-token** `api/index.ts`. | GET /outbound/:id có `tasks_summary` |

---

## 4. Bước 4 — Frontend

| # | Việc | Kiểm tra |
|---|---|---|
| 4.1 | **Cài đặt**: `StrategyFields.tsx` thêm nhóm "Cách làm việc" — `work_mode` (SingleSelect THỦ CÔNG / HƯỚNG DẪN, tầng loại có "— Theo kho —") + `lower_from_level` (Input 1..50). `StrategyValue`/`STRATEGY_EMPTY`/`STRATEGY_WAREHOUSE_DEFAULT`/`resolveStrategy` cập nhật (mirror BE). Hint khi chọn HƯỚNG DẪN: "Cần kho QR + bản vẽ Sơ đồ kho đã lưu". | Playwright: đặt Ba Vì GUIDED, reload còn; kho không bản vẽ → banner 422 từ BE |
| 4.2 | **Trang mới `pages/wms/DirectedWork.tsx`** route `/wms/directed` (PermissionRoute `directed_work.view`), menu Kho WMS "Lệnh việc", filter Kho qua `useScopedWarehouses` + slice filter mới (`useWmsFilterStore` — **BẮT BUỘC thêm dòng `sweepGlobalScope`**). 3 tab, **bảng gom theo Ô (0.7)**: **Cần hạ** (toàn kho; cột: STT · Chuyến/Biển · Cửa · Ô · Tầng · **Hạ n pallet** (mã + số) · Khoảng cách (ô × cell_m → m) · Đặt xuống · ☐ Đã hạ [gate `lower`]; dòng đầu nổi bật; badge "xe đang chờ"), **Cần đưa ra bãi** (chip "Của tôi" = `forklift_driver_id === user.id` / theo chuyến; cột: STT · Chuyến · Từ (ô hoặc điểm đặt dãy nếu đã hạ; chưa hạ = mờ "chờ hạ") · **Đưa n pallet** · Tới cửa · ☐ Đã đưa ra), **Sắp quét** (theo chuyến, TỪNG pallet vì quét theo tem; dòng kế tiếp nổi bật; "đã hạ ✓ / đã ra bãi ✓ / chờ ⏳"). **Dòng xong = gạch ngang + xám, ở lại tới khi chuyến Hoàn thành**, ghi "✓ … hh:mm · Tên"; chip **"Ẩn việc đã xong"** (mặc định hiện, nhớ theo user). Dòng **"Thiếu N thùng — chờ chỉ định"** màu vàng, nút mở ô chỉ định. Ô tổng mỗi chuyến **n/m việc xong** + thanh tiến độ. Hook `useDirectedBoard(wh, mode, gdo?, driver?)` key `['directed-board', …]`; `useLowerTask`, `useReplanGdo` invalidate `['directed-board']`, `['gdo', id]`. Theo skill `table-format` (SummaryBand: việc treo · cần hạ · đã hạ chờ chuyển · chuyến đang chạy). | Playwright 1280/390/360 không tràn; dòng đầu nổi; bấm Đã hạ → dòng đổi trạng thái không F5 |
| 4.3b | **Nút "Chỉ định cho dòng này"** trong ô search tồn kho sẵn có của Chuẩn bị hàng + trang chuyến (`getInventoryByMaterial`): chọn NSX (mặc định, gom theo NSX) hoặc tick tem → `PATCH …/pin` → kế hoạch tự sắp lại; dòng đơn hiện badge "Chỉ định: NSX 05/03/2026". Gate `outbound.edit`. | QA 57 [21]–[23] |
| 4.3 | **Trang chuyến (`OutboundDetail.tsx`)**: dải "Sắp quét — tiếp theo: pallet … ở ô … (tầng n, đã hạ ✓)" từ `tasks_summary` + `useDirectedBoard(SCAN)`, link tới trang Lệnh việc; nút **Sắp lại** [gate `replan`]; hiện `plan_warning` sau Bắt đầu nếu có (banner vàng, không chặn). Chỉ hiện khi chuyến có việc (kho GUIDED). Không đụng luồng quét. | Playwright: sau Bắt đầu thấy dải; quét → dải chuyển dòng kế |
| 4.4 | **Sơ đồ kho**: pane đối tượng cửa/đầu dãy thêm chip **Loại kho phục vụ** (`useScopedWhTypes`, rỗng = mọi loại) → `useRenameMapObject` body `serve_categories`. Ô cửa trên bản vẽ ghi tắt loại. Lớp phủ **"Việc"** (tuỳ chọn, làm cuối nếu còn giờ): tô ô có việc PENDING, nhãn số việc. | Playwright: khai `["FG01"]`, reload còn |
| 4.5 | `realtimeEvents.ts`: `wms_tasks: ['directed-board', 'gdo', 'outbound-detail']`; `GroupDeliveryOrder` thêm `'directed-board'`. Guide `WarehouseMapGuide` thêm mục "Loại kho phục vụ". | 4 case realtime: sinh việc / Đã hạ / quét đóng / unstart huỷ → bảng đổi không F5 |

---

## 5. Bước 5 — Lưới gác ("bug chết hai lần")

| # | Việc |
|---|---|
| 5.1 | **Gói QA `57-directed-work.mjs`** (+ `run-all.mjs`): tự dựng kho QA57 (QR) + bản vẽ + 2 cửa xuất (1 khai FG01) + 2 DROP (1 khai PM01) + 6 chân kệ có T1..T3 + pallet 2 mã × 3 NSX (dựng FEFO ≠ thứ tự mã ô để bắt bản chép tay); đặt kho GUIDED, `lower_from_level=2`. Phép kiểm: [1] MANUAL → 0 việc · [2] GUIDED thiếu bản vẽ → start 200 + `plan_warning` · [3] oracle Σ qty = Σ nhu cầu · [4] oracle FEFO (không việc nào khoá > pallet đủ điều kiện chưa chọn; tính lại bằng `rotationSortKey` phía QA từ dữ liệu thô) · [5] `needs_lower` ⇔ tầng · [6] `drop_location_id` đúng loại + gần nhất (BFS riêng trong QA) · [7] seq 1..n duy nhất, việc seq=1 là ô gần cửa nhất · [8] `planGdoTasks` lần 2 = 0 việc mới · [9] quét đúng → DONE · [10] quét pallet khác → SKIPPED OTHER_PALLET + bù · [11] chuyến B quét pallet của A → PALLET_TAKEN + A bù · [12] Đã hạ + move → pallet ở DROP, việc LOWERED · [13] unstart → CANCELLED, không PENDING · [14] SAP hạ SL → việc đuôi CANCELLED · [15] cửa lệch loại → 422 DOCK_CATEGORY_MISMATCH, chuỗi ghép giao ≥1 → 200 · [16] board 3 mode shape + sort · [17] 403 tài khoản kho lẻ · [18] id rác → 400 · [19] **đua**: 2 chuyến Bắt đầu đồng thời cùng mã 1 pallet → đúng 1 việc PENDING trên pallet đó hoặc cả 2 nhưng tổng qty ≤ tồn (ghi nhận kết quả) · [20] dọn 0 sót (tag QA57) · **[21] hai vùng date**: fixture có pallet 45 % HSD ngắn hơn pallet 80 % — dòng không chỉ định → chia pallet 80 % (KHÔNG lấy 45 % dù FEFO), thiếu → RPC trả dòng SHORTAGE · **[22] chỉ định NSX** (`batch_required`) → chia đúng pallet 45 %, `rotation` oracle bỏ qua dòng có chỉ định · **[23] ghim tem** `pinned_pallets` → đúng tem; PATCH pin item của chuyến khác → 404 (IDOR cặp id) · **[24] tick/bỏ tick** Đã hạ / Đã đưa ra theo nhóm ô → status + events, RPC gom theo ô đúng số pallet, dòng DONE vẫn trả về (gạch) cho tới COMPLETED · **[25] ngưỡng 0** → FEFO toàn bộ như cũ. |
| 5.2 | Ratchet 09: `task_status_written_outside_service` — grep `from('wms_tasks')` + `.update(` ngoài `services/directedTasks.ts` (baseline 0). |
| 5.3 | QA 00 thêm bất biến: không việc PENDING/LOWERED nào trỏ chuyến COMPLETED/CANCELLED/PENDING-chưa-start; Σ `qty_base` việc treo của 1 dòng ≤ `cartons_ordered − cartons_scanned`. |
| 5.4 | Chạy lại: 56 · 54 · 11 · 12 · 13 · 25 (rotation) · 41 · 52 · 07 · 08 · 00 · 09. |

---

## 6. Bước 6 — Tài liệu + bàn giao
- CLAUDE.md: hàng `outbound` (RULE 4: kế hoạch lấy hàng GUIDED — 5 dòng), hàng `warehouse_map` (Loại kho phục vụ cửa/đầu dãy), bảng module thêm `directed_work`, `TABLE_QUERY_MAP` ghi chú.
- `docs/plans/DIRECTED_WORK_PLAN.md`: tiến độ 1c + link file này. Memory `directed-work-task-engine`: chốt 10/09 (A/B/C, cửa theo loại).
- Production: 1c thêm **1 migration** vào danh sách chưa áp (tổng 9) — cần user duyệt riêng.

## 7. Ước lượng
Bước 2: 0,5 ngày · Bước 3: 1,5 ngày · Bước 4: 1,5 ngày · Bước 5: 0,5 ngày ⇒ **≈ 4 ngày** (đúng dải 3–4 ngày plan cũ; +0,5 nếu làm lớp phủ "Việc" trên Sơ đồ kho).

## 8. Rủi ro đã thấy, cách đỡ
- **Over-allocate khi 2 chuyến lập đồng thời** (giữ chỗ mềm không có khoá DB xuyên chuyến): chấp nhận ở HƯỚNG DẪN — giải quyết lúc quét (PALLET_TAKEN + bù); QA [19] ghi nhận. Khi lên BẮT BUỘC (đợt sau) mới cần `FOR UPDATE SKIP LOCKED`.
- **Bản vẽ đổi sau khi lập** (dời chân kệ): `dist_cells/seq` cũ; "Sắp lại" dựng lại. Không tự dò.
- **Pallet ở ô chưa đặt lên bản vẽ** (`grid_x NULL`): vẫn lập việc, `dist_cells NULL` xếp cuối, bảng ghi "chưa có trên bản vẽ" — không để việc biến mất âm thầm.
- **startGDO chậm thêm** ~0,5–1 s (6 round-trip): chấp nhận; không fire-and-forget (lambda đóng băng).
