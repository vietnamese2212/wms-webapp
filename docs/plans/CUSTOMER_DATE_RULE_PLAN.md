# %Date theo KHÁCH HÀNG / KÊNH — master data thay cho chốt tay 1.000 dòng/ngày

> ## ✅ ĐÃ THỰC THI XONG 11/09/2026 (dev `b75b35ac` → `619269bb`)
> Bước 2 (dữ liệu) · 3 (backend) · 4 (giao diện) · 5 (lưới gác) · 6 (tài liệu) — tất cả đã lên `dev`, áp staging.
> **Đo:** QA 58 = **44/44** · 57 = 91/91 · 12 = 35/35 · 13 = 41 · 14 = 35 · 08 = 13/13 · 07 = 96/96 · 00 = 30/30 ·
> cổng tĩnh XANH · tsc BE/FE + build xanh · Playwright 1280 + 360 không tràn ngang.
>
> **Ba chỗ plan nói khác code thật (code thật thắng):**
> (a) `dateRuleSourceLabel` của mục 3.1 KHÔNG dùng — nhãn nguồn hiện ở FE qua `dateRuleLabel(...).source`,
>     và quy tắc MASTER có hàm riêng `masterRuleLabel` (ratchet `daterule_label_without_sap_level` bắt việc
>     dùng lại `dateRuleLabel` cho master: master không có mức kế thừa SAP, cũng không có trạng thái "chưa chốt").
> (b) Ratchet đổi tên cho đúng thứ nó gác: `date_rule_hand_rolled` (baseline 4) + `record_resolved_by_name_ilike`
>     (baseline 2) — bản trong plan (`date_rule_written_outside_policy`) đếm cả dòng KHAI KIỂU nên vô nghĩa.
> (c) `flagNoStock` gọi thẳng `checkDateRuleStock` và gom theo (kho, mã, quy tắc) lấy ĐẠI DIỆN — "còn pallet nào
>     đạt không" không phụ thuộc số lượng dòng, nên 800 dòng/ngày chỉ còn vài chục nhóm phải hỏi.
>
> **Ba điều lộ ra lúc thi hành:** kho QTY tra tồn theo `pallet_code` = CHÍNH MÃ HÀNG (fixture đặt tên khác là
> "còn 0" oan) · bộ đếm "giữ nguyên vì chốt tay" ban đầu luôn ra 0 vì tập ứng viên đã lọc bỏ MANUAL từ RPC ·
> thư mục làm việc có thể có nhiều phiên cùng chạy nên `git add` phải liệt kê TỪNG FILE.
>
> **Còn để mở:** khách hàng tự sinh từ các gói QA khác (QAAWSHIP/QATMS/QADRVSHIP) nằm lại trong danh mục staging —
> đúng theo thiết kế (danh mục tự nuôi), chỉ là nhiễu ở môi trường test; nếu phiền thì cleaner của gói 12/13/14
> xoá thêm `Customer` theo tiền tố tag.

> Lập 11/09/2026 (Fable brainstorm → Opus code). User chốt 3 điểm cùng ngày: **(1)** tách danh mục Khách hàng khỏi bảng Kho · **(2)** "Kênh khách hàng" là danh mục MỚI tạo trong việc này (trước đó không tồn tại) · **(3)** dòng có ghi chú CS thì ĐỂ TAY.
> Đọc trước: CLAUDE.md hàng `outbound` mục **RULE 4** (date_rule · Chốt %Date · DATE_RULE_REQUIRED) · `docs/plans/DIRECTED_WORK_1C_PLAN.md` mục 0.6b · memory `directed-work-task-engine`.
> **Opus code theo mục 2–7 đúng thứ tự, mỗi bước có "kiểm tra" riêng. Không mở rộng ngoài plan; chỗ nào plan mâu thuẫn với code thật thì code thật thắng, ghi lại ở đầu file này như 1c đã làm.**

---

## 0. Brainstorm — vì sao, quyết định, giả định

### 0.1 Số liệu thật (staging, đo 11/09) — vấn đề đang giải

| Đo | Kết quả | Hệ quả |
|---|---|---|
| `OutboundItem.date_required` > 0 (kế thừa VL06O) | **0 / 26.675** dòng 60 ngày | VL06O cột `pct_date_req` trống 100 % ⇒ **không có nguồn %Date nào ngoài tay người** |
| `date_rule` đã chốt tay | 3 dòng | Ở mức 1.000 dòng/ngày production, chốt tay từng dòng = việc ghép nối dễ sai |
| Dòng có `header_text` (ghi chú CS) | **1,8 %** (136 / 7.612, 30 ngày); ~40 % số đó nói về date, còn lại "Trả pallet", tên người, "Kho Thạch Hà" | Ghi chú là chỗ NGƯỜI phải đọc (chốt 10/09: không parser); 1,8 % ≈ 18 dòng/ngày, đọc được |
| Chuyến có `shipto_party` (mã ship-to SAP) | **99,7 %** (3.462 / 3.473), 87 mã khác nhau | **Khoá để tự động hoá đã có sẵn trên dữ liệu** |
| `Warehouse.shipto_codes` có khai | **0 / 153** kho | Rule Chuyển kho hiện dò theo TÊN kho (`ilike name`) — chưa ai khai khoá |
| Tên NPP trên chuyến khớp tên Kho danh mục | 0 / 91 | Khách hàng KHÔNG nằm trong bảng Kho hôm nay |
| Tiền tố ship-to | `1xxxxxxx` 20 mã · `2xxxxxxx` 4 mã · `3xxxxxxx` 69 mã · `T…` 1 | Có thể là nhóm tài khoản SAP — user chốt 11/09 **KHÔNG gợi ý kênh theo tiền tố**; phân kênh bằng thao tác hàng loạt (4.1b) |

### 0.2 Ba quyết định thiết kế (user đã gật 11/09)

| # | Ý tưởng ban đầu (user) | Chốt | Vì sao |
|---|---|---|---|
| A | Đưa khách hàng (NPP, BHX, KA, MT…) vào **bảng Kho**, thêm cột %Date | **Bảng RIÊNG `Customer`** (Khách hàng / Nơi nhận), khoá `ship_to_code`. Customer **có thể trỏ** `warehouse_id` = "nơi nhận này là kho của mình" | Bảng Kho có 40 cột vận hành (chế độ tồn, cất hàng, luân chuyển, cửa, cân, cổng…); 94 khách vào đó mỗi khách mang 40 ô vô nghĩa và **lọt vào mọi chỗ liệt kê kho**: GlobalScopePicker ở Header, phạm vi kho khi phân quyền, KPI/cảnh báo/chi phí theo kho, Sơ đồ kho. Rule Chuyển kho hỏng (điểm 3 user nêu) chỉ là nạn nhân đầu tiên |
| B | "Tab khai báo chức năng": Kho tổng · Kho NPP · BHX · KA · MT… mang %Date mặc định | **Danh mục MỚI `LookupValue.type = 'customer_channel'`** ("Kênh khách hàng"), `meta.date_rule` = quy tắc mặc định. Customer chọn 1 kênh, có thể ghi đè bằng `Customer.date_rule` riêng | Dùng đúng cơ chế đang có cho Loại kho (`LookupValue.meta` — memory `warehouse-type-custom-flags`), không thêm bảng. Nơi khai = tab **Kênh** trong trang Khách hàng |
| C | Cờ ở setting Kho: "Áp toàn bộ theo KH (bỏ qua dòng đã có)" hoặc "Áp với trường hợp header text trống" | `Warehouse.date_rule_policy` ∈ **OFF · ALL · NO_NOTE**, mặc định **OFF** cho kho đang chạy (bật tay); khuyên dùng **NO_NOTE** | Áp tự động là thay đổi hành vi ⇒ không tự bật cho 153 kho. NO_NOTE giữ đúng nguyên tắc 10/09: máy không đọc ghi chú, ghi chú là chỗ người nhìn |

### 0.3 Thang ưu tiên — MỘT hàm, MỌI đường ghi dòng hàng đi qua

Khi một dòng hàng ra đời hoặc được "Áp lại", quy tắc %Date lấy theo thứ tự, **dừng ở bậc đầu tiên có kết quả**:

1. **Chốt tay đã có** (`date_rule.source` ∈ {`MANUAL`, thiếu}) → **giữ nguyên, không bao giờ đè** (kể cả ALL).
2. Dòng **có `header_text`** và kho `policy = NO_NOTE` → **để trống** (chưa chốt, người xử).
3. `policy = OFF` → để trống.
4. **`Customer.date_rule`** (riêng khách) → áp, `source = 'CUSTOMER'`.
5. **`LookupValue(customer_channel).meta.date_rule`** của kênh khách → áp, `source = 'CHANNEL'`.
6. Khách **chưa phân kênh** / chuyến **không có ship-to** / ship-to **chưa có trong danh mục** → để trống. **Không đoán.**

Bậc 4–5 sau khi áp chạy **kiểm tồn** (`matchesRule` — cùng luật với sinh việc, KHÔNG chép lại): không còn pallet nào đạt ⇒ vẫn áp nhưng gắn `review: 'NO_STOCK'` để trang Chốt %Date đưa lên đầu. **Không chặn upload** vì đó là lỗi tồn kho, không phải lỗi file.

### 0.4 Nguồn gốc quy tắc nằm TRONG jsonb, không thêm cột

`date_rule` hiện đã là `{kind, value?, parts?, set_by, set_at}`. Thêm 2 khoá tuỳ chọn:
- `source`: `'MANUAL' | 'CUSTOMER' | 'CHANNEL'` — thiếu = MANUAL (3 dòng đang có không cần backfill).
- `review`: `'NO_STOCK'` | vắng — cờ "cần xem".

Vì sao không thêm cột: `keptItemRules` trong `processVehicleGroups` mang nguyên object `date_rule` theo khoá (Số xe, NPP, mã) ⇒ nguồn gốc **tự sống sót** qua lần dội dữ liệu ngoài mà không phải sửa chỗ mang theo; `date_rule_valid()` chỉ kiểm `kind`/`parts` nên không đổi; SPLIT vẫn hợp lệ. RPC lọc bằng `date_rule->>'source'`.

### 0.5 Đổi master data KHÔNG lan ngược âm thầm

Sửa %Date của kênh/khách chỉ có hiệu lực cho dòng **sinh sau đó**. Muốn áp cho đơn đang mở → nút **"Áp lại theo master"** trên trang Chốt %Date (khoảng ngày + kho đang lọc), chỉ đụng dòng `source ∈ {CUSTOMER, CHANNEL}` hoặc chưa chốt; MANUAL không đụng. Mỗi dòng đổi ghi `outbound_events` (`DATE_RULE_SET`, `source: 'SYSTEM'`). Tránh cảnh sửa một ô cấu hình làm 1.000 dòng đổi mà không ai biết.

### 0.6 Rule Chuyển kho (điểm 3 user) — khai tường minh, không dò tên

Hiện `maybeAutoCreateTransferOrder` (outboundController ~1861) tìm kho đích bằng `Warehouse.code = shipto` hoặc `shipto_codes @> {shipto}` rồi **fallback `ilike name`**; không khớp ⇒ `OTHER` ⇒ `delivery_mode = 'SELF'` (tài xế tự xác nhận). `orbitWhByShipto` (~1174) và `isInternalPair` cũng dò `shipto_codes`.

Chốt: **một helper `warehouseByShipto(shipto)`** dùng cho cả 3 chỗ, thứ tự: `Customer.warehouse_id` (khách trỏ kho) → `Warehouse.code`/`shipto_codes` (giữ tương thích) → dò tên (giữ, đánh dấu deprecated trong comment). Khách vào danh mục **không kéo theo** nghĩa vụ xác nhận: chỉ khách có `warehouse_id` và kho đó `inventory_mode ≠ NONE` mới là `SCAN`. Form Kho: ô `shipto_codes` giữ nguyên nhưng thêm hint "nên khai ở Khách hàng → trỏ kho".

### 0.7 Danh mục tự nuôi — không ai phải nhớ đi khai

- Nút **"Nạp từ dữ liệu SAP"** trên trang Khách hàng: RPC `customer_seed_candidates()` trả DISTINCT `ship_to_code` + tên gần nhất + số DO (từ `erp_outbound_orders` ∪ `GroupDeliveryOrder.shipto_party`/`OutboundDelivery.distributor_name`), **2 pha xem-trước → xác nhận** (chuẩn upload). Kênh để trống.
- **Derive gặp ship-to lạ ⇒ tự tạo Customer** (`auto_created = true`, kênh trống, tên = "Tên NPP" của file). Upsert lô theo `ship_to_code`, `ignoreDuplicates`. Chỉ khi có `resolvedShipto`.
- Trang Chốt %Date có ô band **"Khách chưa kênh: n"** (dòng chưa chốt thuộc khách chưa phân kênh) → bấm nhảy sang trang Khách hàng lọc "chưa kênh".
- Gợi ý kênh theo tiền tố ship-to: **KHÔNG làm** (user chốt 11/09: "không cần gợi ý"). Thay bằng **thao tác hàng loạt** trên trang Khách hàng (mục 4.1b): tick nhiều khách → Phân kênh / Đặt %Date riêng / Trỏ kho một lần.

### 0.8 Giả định đang áp (user không phản đối thì giữ)
1. Kênh seed: `KHO_TONG` Kho tổng · `NPP` Nhà phân phối · `BHX` Bách hoá xanh · `KA` Key Account · `MT` Modern Trade · `NOI_BO` Nội bộ · `KHAC` Khác. **Chỉ `NPP` seed `meta.date_rule = {kind:'MIN_PCT', value:60}`** (user nói 10/09: "NPP đi ≥ 60 % nếu CS không ghi chú"); kênh khác `date_rule = null` = chưa khai ⇒ không áp. Sửa trong app.
2. `Customer` là danh mục **toàn công ty**, không cắt theo phạm vi kho (khách của kho A cũng là khách của kho B). Quyền riêng module `customers`.
3. Không có `Customer.date_rule` dạng SPLIT (chia phần theo SL là việc từng dòng, không phải luật khách). Validator chỉ nhận FEFO / MIN_PCT / EXACT(kind EXACT chỉ hợp lý theo dòng ⇒ **cũng loại**): master chỉ **FEFO | MIN_PCT**.
4. Chuyến `origin='MANUAL'/'EXCEL'` (tạo tay / Excel gộp) cũng đi qua thang (mục 0.3) tại `createGDO` / `updateGDO` thêm dòng / `mergePausedGDO` — cùng hàm.
5. `uploadVl06o` reconcile (`outboundReconcile.ts`) vẫn chỉ ghi `date_required` từ `pct_date_req` như cũ; không đụng.
6. Bật `policy` cho kho đang có đơn mở KHÔNG tự áp; muốn áp thì bấm "Áp lại theo master".

### 0.9 Còn mở (không chặn)
- Bỏ hẳn `Warehouse.shipto_codes` + dò tên sau khi Customer đã khai đủ (đo: 0 kho đang khai nên chưa vội).
- Kho `policy = ALL` với dòng có ghi chú: máy áp rồi, ghi chú CS vẫn hiện nguyên văn trên trang Chốt; có nên gắn `review: 'HAS_NOTE'` không — để user quyết sau khi dùng.

---

## 1. Kiểm tra trước khi code
- `git log -1` trên `dev` ≥ `6e26e6f8`; staging đã áp tới `20260910j`.
- Chạy `node scratchpad/qa_run.mjs 57-directed-work.mjs` xanh (91/91) làm mốc.

---

## 2. Dữ liệu — migration `backend/migrations/20260911_customer_date_rule.sql` (áp staging qua `apply_mig_map.mjs`)

```sql
-- 2.1 Danh mục Khách hàng / Nơi nhận
CREATE TABLE public."Customer" (
  id            text PRIMARY KEY,
  ship_to_code  text NOT NULL UNIQUE,          -- khoá SAP, đã có trên 99,7 % chuyến (GroupDeliveryOrder.shipto_party)
  name          text NOT NULL,
  channel       text,                          -- LookupValue(type='customer_channel').value; NULL = chưa phân kênh
  date_rule     jsonb CHECK (date_rule_valid(date_rule) AND (date_rule IS NULL OR (date_rule->>'kind') IN ('FEFO','MIN_PCT'))),
  warehouse_id  text REFERENCES public."Warehouse"(id) ON DELETE SET NULL,   -- "nơi nhận này là kho của mình"
  is_active     boolean NOT NULL DEFAULT true,
  auto_created  boolean NOT NULL DEFAULT false, -- sinh tự động từ derive (ship-to lạ)
  note          text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text, updated_by text
);
CREATE INDEX ix_customer_warehouse ON public."Customer"(warehouse_id) WHERE warehouse_id IS NOT NULL;
CREATE INDEX ix_customer_channel   ON public."Customer"(channel);
ALTER TABLE public."Customer" ENABLE ROW LEVEL SECURITY;   -- KHÔNG policy (backend service_role)
-- realtime: trigger event tự gắn trg_wms_notify lúc CREATE TABLE (20260902b) — chỉ cần thêm TABLE_QUERY_MAP

-- 2.2 Kênh khách hàng — danh mục MỚI
INSERT INTO public."LookupValue"(id, type, value, sort_order, meta, created_at, updated_at) VALUES
 (gen_random_uuid(),'customer_channel','KHO_TONG',1,'{"label":"Kho tổng"}',now(),now()),
 (gen_random_uuid(),'customer_channel','NPP',     2,'{"label":"Nhà phân phối","date_rule":{"kind":"MIN_PCT","value":60}}',now(),now()),
 (gen_random_uuid(),'customer_channel','BHX',     3,'{"label":"Bách hoá xanh"}',now(),now()),
 (gen_random_uuid(),'customer_channel','KA',      4,'{"label":"Key Account"}',now(),now()),
 (gen_random_uuid(),'customer_channel','MT',      5,'{"label":"Modern Trade"}',now(),now()),
 (gen_random_uuid(),'customer_channel','NOI_BO',  6,'{"label":"Nội bộ"}',now(),now()),
 (gen_random_uuid(),'customer_channel','KHAC',    7,'{"label":"Khác"}',now(),now())
ON CONFLICT (type, value) DO NOTHING;   -- UNIQUE "LookupValue_type_value_key" (type, value) đã có thật trên staging

-- 2.3 Chính sách áp tự động theo kho XUẤT
ALTER TABLE public."Warehouse" ADD COLUMN date_rule_policy text NOT NULL DEFAULT 'OFF'
  CHECK (date_rule_policy IN ('OFF','ALL','NO_NOTE'));

-- 2.4 RPC gợi ý nạp danh mục (DISTINCT trong SQL — không kéo dòng về Node)
CREATE FUNCTION public.customer_seed_candidates() RETURNS jsonb ...
  -- UNION: erp_outbound_orders(ship_to_code, ship_to_name, count, max(created_at))
  --      ∪ GroupDeliveryOrder.shipto_party + tên = OutboundDelivery.distributor_name của DO đầu
  -- LEFT JOIN Customer để đánh dấu exists; ORDER BY count desc. REVOKE PUBLIC/anon/authenticated (mặc định đã đóng — vẫn ghi rõ).

-- 2.5 RPC màn chốt — bản mới 20260911b_date_rule_lines_v2.sql (giữ tên hàm, đổi chữ ký ⇒ DROP bản cũ trước)
--   THÊM tham số p_source text[] (MANUAL|CUSTOMER|CHANNEL|SAP|UNSET|REVIEW) và trả thêm mỗi dòng:
--   source (coalesce(date_rule->>'source', CASE WHEN date_rule IS NOT NULL THEN 'MANUAL' WHEN date_required>0 THEN 'SAP' END)),
--   review (date_rule->>'review'), customer_name, channel, customer_has_channel
--   Band thêm: 'review' (count review='NO_STOCK'), 'no_channel' (chưa chốt AND khách không kênh/không có).
--   JOIN: g.shipto_party = c.ship_to_code (LEFT). Khoảng ngày ≤ 62 ngày kiểm ở BE như cũ.
```
Cập nhật `SCHEMA_REVIEW.md` (bảng mới + cột mới + 2 RPC).

**Kiểm tra:** `select date_rule_valid('{"kind":"EXACT"}')` true nhưng INSERT Customer với EXACT → 23514; 7 kênh có mặt; `Warehouse.date_rule_policy` = OFF cho 153 kho; RPC mới trả `source`/`review` cho 3 dòng đã chốt = MANUAL.

---

## 3. Backend

### 3.1 `services/dateRulePolicy.ts` — ĐƯỜNG DUY NHẤT máy tự đặt date_rule
```ts
export type RuleSource = 'MANUAL' | 'CUSTOMER' | 'CHANNEL'
export type PolicyCtx = { policyByWh: Map<string, 'OFF'|'ALL'|'NO_NOTE'>; customerByShipto: Map<string, {date_rule: DateRule|null; channel: string|null}>; channelRule: Map<string, DateRule|null> }
export async function loadPolicyCtx(whIds: string[], shiptos: string[]): Promise<PolicyCtx>   // 3 truy vấn, chunk 300, KHÔNG N+1
export function resolveDateRule(ctx, whId, shipto, headerText, existing: unknown): { rule: DateRule | null; changed: boolean }
  // thang 0.3; existing có source MANUAL/thiếu ⇒ giữ; trả về object có set_by:'HỆ THỐNG', set_at, source
export async function flagNoStock(items: {id, warehouse_id, material_id, rule}[]): Promise<void>
  // nhóm theo (kho, mã, rule) → gọi matchesRule của directedTasks (export thêm helper theo mã nếu chưa có)
  // → UPDATE date_rule = date_rule || '{"review":"NO_STOCK"}' cho id bị thiếu. Lỗi ⇒ log, KHÔNG ném.
export async function ensureCustomers(rows: {ship_to_code, name}[], actor): Promise<void>   // upsert lô, ignoreDuplicates, auto_created=true
```
`describeDateRule` (directedTasks.ts) thêm hậu tố nguồn: "≥ 60 % · theo kênh NPP" / "· theo khách" / "· chốt tay".

### 3.2 Nối vào các đường sinh dòng hàng (mỗi chỗ 3–5 dòng, gọi hàm 3.1)
- `processVehicleGroups` (outboundController ~3879 `collectDOsAndItems`): trước vòng byVehicle → `ensureCustomers` (mọi `resolvedShipto` + tên NPP) rồi `loadPolicyCtx`; trong `itemInserts.push` sau `...keptItemRules` → `date_rule: resolveDateRule(...).rule`. **`keptItemRules` phải thắng** (đã là MANUAL hoặc CUSTOMER/CHANNEL cũ — cả hai giữ; nếu cũ là CHANNEL mà master đã đổi thì vẫn giữ theo 0.5). Sau khi INSERT items xong (không ở preflight) → `flagNoStock` cho các dòng vừa áp tự động.
- `mergePausedGDO`: dòng MỚI thêm vào chuyến tạm dừng đi qua cùng hàm.
- `createGDO` (~1444 items insert) và `updateGDO` thêm dòng tay: cùng hàm; `shipto = shipto_party` body.
- **Ratchet** (09-static-gate): `date_rule_written_outside_policy` — đếm `date_rule:` / `.update({ date_rule` trong `backend/src` ngoài `dateRulePolicy.ts` và `setItemsDateRule`; baseline = số hiện có, không tăng.

### 3.3 API Khách hàng — `controllers/masterdata/customerController.ts` + routes `masterdata.ts`
| Route | Quyền | Ghi chú |
|---|---|---|
| `GET /masterdata/customers?search&channel&has_channel&warehouse_id&page&pageSize` | `customers.view` | phân trang server (RPC hoặc range + count), ≤ 200/trang |
| `GET /masterdata/customers/seed-candidates` | `customers.import` | RPC 2.4 |
| `POST /masterdata/customers/seed { codes: string[] }` | `customers.import` | pha xác nhận; upsert lô ≤ 500, ignoreDuplicates; trả created/skipped |
| `POST /masterdata/customers` | `customers.edit` | validate ship_to_code `^[A-Z0-9]+$` upper/trim, channel ∈ lookup, date_rule FEFO/MIN_PCT (1–100), warehouse_id tồn tại; 23505 → 409 |
| `PUT /masterdata/customers/:id` | `customers.edit` | `.select()` 0 dòng = 404 (id TEXT); `logAdmin('CUSTOMER_UPDATE', diffFields)` |
| `DELETE /masterdata/customers/:id` | `customers.edit` | mềm `is_active=false` |
| `PATCH /masterdata/customers/bulk` | `customers.edit` | **Thao tác hàng loạt** (đặt TRƯỚC `/:id` trong router kẻo "bulk" bị nuốt làm id). Body `{ ids?: string[]; filter?: {search, channel[], has_channel, warehouse_id, is_active}; patch: { channel?: string\|null; date_rule?: DateRule\|null; warehouse_id?: string\|null; is_active?: boolean } }` — **`ids` HOẶC `filter`, không cả hai**: "chọn tất cả theo bộ lọc" gửi `filter` để BE tự resolve (luật 2 trần id trên URL — KHÔNG nhồi 1.000 id vào body rồi `.in()` không chunk; BE resolve id theo filter → UPDATE chunk 300). `patch` chỉ nhận đúng 4 khoá, khoá lạ → 400. `ids` ≤ 500. Trả `{updated}`; `logAdmin('CUSTOMER_BULK', {count, patch})`. Mẫu tham chiếu: `locationController.bulkFlagLocations` (áp theo bộ lọc) |
| `GET /wms/lookup?type=customer_channel` | (đã có, hở đọc) | |
| `PUT /wms/lookup/:id` với meta.date_rule | **quyền MỚI `customers.manage_channel`** | lookupController: nếu `type='customer_channel'` thì đòi quyền này thay `wms_settings.manage_type` (route hiện gate manage_type — thêm nhánh `requireAnyPerm` hoặc route riêng `PUT /masterdata/customer-channels/:id`; **chọn route riêng**, gọn hơn, không nới quyền cũ). Validate meta.date_rule FEFO/MIN_PCT. `logAdmin('CHANNEL_UPDATE')` |
Thêm `CUSTOMER_UPDATE`, `CUSTOMER_BULK`, `CHANNEL_UPDATE` vào `ADMIN_AUDIT_ACTIONS` + nhãn FE `AUDIT_ACTION_LABEL`; `AdminAuditTarget` thêm `'Customer' | 'LookupValue'`.

### 3.4 Áp lại theo master — `POST /outbound/items/date-rule/apply-master`
Body `{ from, to, warehouse_ids? }` (≤ 62 ngày, cắt scope kho như `getDateRuleLines`), quyền `outbound.set_date`. Nạp dòng của chuyến PENDING/IN_PROGRESS/PAUSED trong khoảng (chunk), lọc `source ∈ {CUSTOMER,CHANNEL}` ∪ chưa chốt, chạy `resolveDateRule` với `existing` bị coi là "đè được" (chỉ MANUAL giữ), UPDATE chunk 300, `flagNoStock`, `logOutboundEvents` source `'SYSTEM'`, `resetUntouchedTasksOfItems` + `planGdoTasks` cho chuyến IN_PROGRESS (như `setItemsDateRule`). Trần 5.000 dòng → 400 nêu thu hẹp khoảng. Trả `{applied, cleared, kept_manual, no_stock}`.

### 3.5 Rule Chuyển kho — helper chung `warehouseByShipto`
Tạo `async function warehouseByShipto(shipto): Promise<DestWh|null>` trong outboundController (hoặc `services/shiptoResolve.ts`): Customer.warehouse_id → Warehouse(code | shipto_codes) → null. Ba chỗ dùng: `maybeAutoCreateTransferOrder` (giữ fallback dò tên SAU helper), `orbitWhByShipto`, `isInternalPair`. `warehouseController` PUT/POST nhận `date_rule_policy` vào whitelist (2 chỗ ~152/~243) + validate.

**Kiểm tra 3:** tsc BE xanh; bump rebuild-token; curl 5 route Khách hàng đúng 400/404/409; upload KH xuất thử ở kho staging `policy=NO_NOTE` với khách kênh NPP ⇒ dòng không ghi chú có `date_rule.source='CHANNEL'`, dòng có ghi chú `NULL`; dòng đã MANUAL trước đó vẫn MANUAL sau upload đè.

---

## 4. Giao diện

### 4.1 Trang **Khách hàng** `/masterdata/customers` (menu **Cấu hình**, module `customers`, icon `Users`/`Store`)
- List page chuẩn `table-format`: cột Mã ship-to (mono) · Tên · Kênh (StatusBadge purple) · %Date riêng (badge `dateRuleLabel` hoặc "— theo kênh") · Kho nhận (tên kho hoặc "Khách ngoài") · Nguồn (Tự tạo / Nhập tay) · Hoạt động · Tạo/Sửa. FilterBar: Kênh (multi, có giá trị "Chưa kênh") · Kho nhận · Hoạt động. Search server. SummaryBand: Tổng · Chưa kênh · Trỏ kho · Tự tạo. Filter store slice `customers`.
- Toolbar ActionCluster: **Thêm** (`edit`) · **Nạp từ dữ liệu SAP** (`import`, `mobileHidden`) → dialog 2 pha (bảng ứng viên + chip Đã có/Mới, tick, Xác nhận).
- FormSheet Thêm/Sửa: Mã ship-to (khoá, chỉ sửa lúc tạo) · Tên · Kênh (`SingleSelect` từ lookup) · %Date riêng (radio "Theo kênh" | FEFO | ≥ n %) · Kho nhận (`WarehouseSingleSelect`, có "Khách ngoài") · Hoạt động · Ghi chú. Dòng chú thích dưới ô Kho nhận: *"Trỏ kho = kho nhận xác nhận hàng trong app khi chuyển kho; khách ngoài = tài xế tự xác nhận."*
- **4.1b CHỌN NHIỀU + THAO TÁC HÀNG LOẠT (user chốt 11/09: "Khách hàng phải cho chọn multi, có action để setup nhanh kênh; làm đồng bộ như các module khác đang làm action").** Cột đầu = checkbox từng dòng + **MỘT ô chọn-tất-cả** (desktop ở đầu bảng; điện thoại ở thanh thao tác vì thẻ không có hàng tiêu đề — cùng luật trang Chốt %Date). Chọn-tất-cả có 2 mức như `Locations.tsx`: tick trang đang xem → hiện dòng *"Đã chọn 100 dòng trên trang — Chọn cả N dòng theo bộ lọc"* (`allFiltered`); khi `allFiltered` thì gửi `filter`, không gửi `ids`. Khi `picked.size > 0` thanh toolbar hiện thêm cụm **`ActionCluster`** (cùng component, cùng cỡ `h-9 sm:h-7`, mobile gom ⋮ ghim mép phải — KHÔNG tự viết `<Button>` rời):
  - **Phân kênh (n)** — `SingleSelect` kênh trong Dialog xác nhận nhỏ → `PATCH …/bulk { patch: { channel } }`.
  - **Đặt %Date riêng (n)** — radio Theo kênh (= `date_rule: null`) | FEFO | ≥ n % → `patch.date_rule`.
  - **Trỏ kho (n)** — `WarehouseSingleSelect` (có "Khách ngoài" = null) → `patch.warehouse_id`.
  - **Ngừng / Kích hoạt (n)** — `patch.is_active`, `danger` cho Ngừng.
  Mọi nút gate `can(perms,'customers','edit')`, `disabled={saving}` + nhãn chờ, lỗi = banner đỏ inline; `ListFooter right` hiện "n đang chọn" (mẫu `DateRules.tsx`). Sau khi lưu: bỏ chọn, `invalidateQueries(['customers'])`, toast số dòng đổi. **Phạm vi của thao tác hàng loạt hiện rõ trong Dialog xác nhận** ("Áp kênh NPP cho **312 khách theo bộ lọc hiện tại**") — áp mù cả bảng là lỗi đã bị bác ở màn Chốt %Date.
- Tab **Kênh** (cùng trang, tab thứ 2, gate `manage_channel`): bảng kênh (Mã · Tên · %Date mặc định · Số khách) + sửa inline qua FormSheet nhỏ (Tên, quy tắc FEFO/≥ n %/Chưa khai). Hint: *"Đổi mặc định chỉ áp cho đơn sinh sau; đơn đang mở dùng 'Áp lại theo master' ở trang Chốt %Date."*
- Điện thoại: thẻ, không tràn 360.

### 4.2 Cài đặt WMS → tab Kho → `StrategyFields` nhóm **"XUẤT — %Date theo khách hàng"**
Một ô chọn `date_rule_policy`: Tắt · Áp toàn bộ (bỏ qua dòng đã chốt) · Chỉ dòng KHÔNG có ghi chú CS (khuyên dùng). Tooltip ⓘ nêu thang 0.3. Chỉ tầng Kho (không per Loại kho — luật theo khách, không theo hàng).

### 4.3 Trang **Chốt %Date** (`DateRuleLines`/tương đương)
- FilterBar thêm **Nguồn** (multi: Chốt tay · Theo khách · Theo kênh · SAP · Chưa chốt · **Cần xem**).
- SummaryBand thêm 2 ô: **Cần xem (hết tồn)** · **Khách chưa kênh** (bấm → lọc). Ô "Khách chưa kênh" có link "Phân kênh →" sang `/masterdata/customers?has_channel=0`.
- Cột "%Date lấy hàng": badge giữ nguyên + hậu tố nhỏ nguồn (`· kênh NPP` / `· khách` / `· tay`), dòng `review=NO_STOCK` viền đỏ + tooltip "Kho không còn pallet đạt mức này — đổi mức hoặc để chưa chốt".
- Cột mới **Khách / Kênh** (tên khách · badge kênh; "chưa kênh" đỏ nhạt).
- ActionCluster: **Áp lại theo master** (`set_date`) → confirm dialog nêu khoảng ngày + kho + "chỉ đụng dòng máy áp / chưa chốt, không đụng chốt tay" → gọi 3.4 → toast `{applied, no_stock}`.
- Trang chuyến + Nhặt lẻ: `dateRuleLabel` nhận thêm `source` để in hậu tố (một hàm, 3 màn).

### 4.4 Quyền (skill `add-permission`, đủ 4 nơi)
Module mới FE `MODULES.customers` = {page:'Khách hàng', actions: view · edit · import · manage_channel} + BE `ALL_PERMISSIONS`; `navigation.ts` nhóm Cấu hình thêm `{ to:'/masterdata/customers', label:'Khách hàng', module:'customers' }` (đứng sau Mã hàng); route FE `PermissionRoute`; `TABLE_QUERY_MAP.Customer = [['customers'], ['date-rule-lines']]`, `LookupValue` đã map `['lookup']`. Hook: `useCustomers(filters)`, `useCustomerSeedCandidates`, `useSaveCustomer`, `useApplyDateRuleMaster` (onSettled invalidate `['date-rule-lines']`, `['gdo']`, `['customers']`).

### 4.5 Chuẩn BẮT BUỘC tuân theo (user nhắc 11/09: "tuân thủ CLAUDE.md, skill, font, filter…") — Opus mở từng skill TRƯỚC khi code phần tương ứng
| Phần | Skill / luật | Điểm dễ sót |
|---|---|---|
| Trang Khách hàng, tab Kênh, cột mới trang Chốt | `table-format` | card trên canvas xám · toolbar 1 hàng + `FilterBar` declarative (KHÔNG Select rời) · `SavedViews` + density · `SummaryBand` (tổng bằng SQL trên TOÀN bộ lọc, không cộng trang đang xem) · `ListPager`/`ListFooter` 50/100/200/500/1000 · typography 2 cỡ `text-[9px]` header / `text-[10px]` cell, mã `font-mono font-semibold`, số `tabular-nums` · `whitespace-nowrap` mọi th/td, KHÔNG `hidden sm:table-cell` · `StatusBadge` theo ngữ nghĩa (kênh = purple, hoạt động = green, ngừng = slate) · filter state trong `useWmsFilterStore` slice `customers` (tự nhớ per-user), mọi onChange filter kèm `page: 1` · nút inline cell `h-3.5 w-3.5` + `stopPropagation` · mobile toolbar ≤ 2 hàng, dòng dữ liệu đầu ≤ ~300px ở 390 |
| Nút thao tác | `actionbtn-cluster-standard` (memory) | `ActionCluster` cho toolbar + thanh bulk + header detail; primary ≤ 2; `mobileHidden` cho Nạp từ SAP; `danger` cho Ngừng |
| Form Thêm/Sửa khách, sửa kênh, dialog hàng loạt | CLAUDE.md "Mọi form Thêm/Sửa dùng `FormSheet`" | panel trượt phải, footer dính; dropdown trong sheet dùng `SingleSelect`/`WarehouseSingleSelect` (portal vào node dialog qua `usePopoverAnchor`, KHÔNG portal body); Dialog giữa CHỈ cho xác nhận hàng loạt |
| Ô Kho nhận | scope | `useScopedWarehouses()` (không hook gốc); ô policy trong `StrategyFields` theo `settings-form-standard` (component KHÔNG khai trong component — mất focus sau 1 ký tự) |
| 4 quyền mới + 7 route | `add-permission` | FE `MODULES` + BE `ALL_PERMISSIONS` + `can()` + `requirePerm`; bảng module→trang CLAUDE.md; route `bulk`/`seed*` đứng TRƯỚC `/:id` |
| INSERT/UPDATE, bảng mới | `mutation-realtime` | `id: randomUUID()` + `updated_at` mọi INSERT; `TABLE_QUERY_MAP.Customer`; invalidate đủ `['customers']`, `['date-rule-lines']`, `['gdo']`; migration + `SCHEMA_REVIEW.md`; bump rebuild-token |
| Bảng/RPC/route mới, upload seed | `security-hardening` | KHÔNG `CREATE POLICY … TO authenticated`; RPC không GRANT (mặc định đóng); id TEXT → `.select()` 0 dòng = 404; `fail(res, error)` truyền cả object (23505 → 409); `logAdmin` cho mọi thao tác quản trị; input `searchLooksLikeInjection` |
| Nạp từ SAP (2 pha), Áp lại theo master | `upload-download-standard` | preflight xem-trước → xác nhận mới ghi; ghi LÔ chunk 500; idempotent theo `ship_to_code` |
| Trước khi báo xong | `verify-feature` | tsc BE/FE + build · Postgres soi row · realtime 4 case · Playwright **1280 + 390 + 360** · QA 58 + chạy lại 57/12/14/07/08 · báo pass/fail kèm bằng chứng |
| Số, ngày, đơn vị | CLAUDE.md | `formatDate`/`formatTimestampDate(ts,true)`; % hiện `≥ 60 %` kiểu VN; nhãn ĐVT từ danh mục; "hôm nay" là hàm |

**Kiểm tra 4:** tsc FE + build xanh; Playwright 1280/390/360: trang Khách hàng (list + form + Nạp + **tick 3 dòng → Phân kênh → 3 dòng đổi, chọn-tất-cả theo bộ lọc → dialog nêu đúng N**), tab Kênh, ô policy trong form Kho, trang Chốt có filter Nguồn + 2 ô band + nút Áp lại; user chỉ `customers.view` không thấy nút Thêm/Nạp/thanh hàng loạt; mobile 360 không tràn ngang, ô chọn-tất-cả nằm ở thanh thao tác.

---

## 5. Lưới gác (luật "bug chết hai lần")

### 5.1 Gói QA `scripts/qa/58-customer-date-rule.mjs` (tag `QA-SUITE`, fixture riêng, dọn sạch)
Fixture: kho QA (GUIDED có bản vẽ — dùng Ba Vì như 57, `freeDockFor`) đặt `date_rule_policy` lần lượt; 2 Customer tag `QA58_A` (kênh NPP, không rule riêng) · `QA58_B` (rule riêng ≥ 80) · `QA58_C` (chưa kênh) · `QA58_D` (trỏ kho `CBBV` MANUAL). Upload KH xuất qua API preflight+confirm với 5 dòng: không ghi chú/khách A · có ghi chú/khách A · khách B · khách C · không ship-to.
- [1a–1e] policy NO_NOTE: A→CHANNEL 60 · A+ghi chú→NULL · B→CUSTOMER 80 · C→NULL · không ship-to→NULL.
- [2a–2b] policy ALL: A+ghi chú→CHANNEL; policy OFF: tất cả NULL.
- [3a–3c] chốt tay dòng A (MANUAL 70) → upload đè lần 2 → vẫn MANUAL 70; đổi meta kênh NPP thành 65 → dòng A cũ vẫn 60 (không lan ngược); "Áp lại theo master" → dòng A CHANNEL 65, dòng MANUAL giữ 70, response `kept_manual ≥ 1`.
- [4a] khách B rule ≥ 80 mà kho không có pallet ≥ 80 → dòng vẫn áp + `review='NO_STOCK'`; RPC band `review ≥ 1`; [4b] upload KHÔNG bị chặn (200).
- [5a] ship-to lạ `QA58_NEW` trong file → Customer tự tạo `auto_created=true`, kênh NULL, band `no_channel ≥ 1`.
- [6a–6c] Chuyển kho: hoàn thành chuyến tới khách D (trỏ kho CBBV) → `TmsOrder.delivery_mode='SCAN'`; khách C (không trỏ) → `SELF`; khách D đổi `warehouse_id=null` → chuyến mới `SELF`.
- [7a–7d] API Khách hàng: id rác → 400/404, ship-to trùng → 409, date_rule EXACT/SPLIT → 400, tài khoản thiếu `customers.edit` → 403; kênh PUT thiếu `manage_channel` → 403.
- [7e–7h] Hàng loạt: `ids` 3 khách → 3 đổi kênh; `filter {has_channel:false}` → đúng số khách chưa kênh đổi, khách đã kênh KHÔNG đổi; gửi cả `ids` lẫn `filter` → 400; `patch` có khoá lạ (`name`) → 400; `ids` 501 → 400.
- [8a] RPC lines lọc `p_source=['CHANNEL']` chỉ trả dòng CHANNEL; `['REVIEW']` chỉ trả review.
- [9a] anon key đọc `Customer` qua PostgREST → 0 dòng/401 (bảng mới đóng — cùng khuôn QA 40).
- Gói 57 [19a–19e], gói 12 mục 4b, gói 14 mục 9 chạy lại xanh.

### 5.2 Ratchet 09-static-gate
- `date_rule_written_outside_policy` (3.2).
- `shipto_resolved_by_name` — đếm `.ilike('name'` trong nhánh ship-to (baseline = 1 hiện có, không tăng).

### 5.3 QA 08 perm-coverage tự nhận 4 quyền mới; QA 07 tự quét route `:id` mới (đủ động từ GET/PUT/DELETE).

---

## 6. Tài liệu
- CLAUDE.md hàng `outbound` RULE 4: thêm đoạn **"%DATE THEO KHÁCH HÀNG / KÊNH (user chốt 11/09)"** — thang 0.3, nguồn trong jsonb, policy 3 mức mặc định OFF, không lan ngược + nút Áp lại, khách tự tạo khi ship-to lạ, rule Chuyển kho đọc `Customer.warehouse_id` trước; hàng mới `customers` trong bảng module→trang (4 action); dòng menu Cấu hình có Khách hàng.
- Memory `customer-date-rule` (project): quyết định A/B/C + số liệu 0.1 + còn mở 0.9.
- Đầu file này: khối "✅ ĐÃ THỰC THI" như 1c, ghi mâu thuẫn plan↔code đã gỡ.

---

## 7. Thứ tự thi hành & ước lượng
1. Migration + áp staging + SCHEMA_REVIEW (0,5 ngày) → kiểm 2.
2. `dateRulePolicy.ts` + nối 4 đường sinh dòng + ratchet (1 ngày) → kiểm 3 (upload thật trên staging).
3. API Khách hàng + kênh + Áp lại + rule Chuyển kho (0,5 ngày).
4. FE: trang Khách hàng · ô policy · Chốt %Date (1 ngày) → kiểm 4.
5. QA 58 + chạy lại 57/12/14/07/08 + Playwright (0,5 ngày).
6. CLAUDE.md + memory + báo cáo (0,25 ngày).

Tổng ≈ 3,5–4 ngày công Opus. Push `dev` sau mỗi bước (standing-authorized); production CHƯA áp migration nào từ 20260908 — cùng đợt với 16 migration đang chờ (user quyết cut-point).
