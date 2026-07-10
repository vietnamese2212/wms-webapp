# WMS Supply Chain Webapp

## Quy tắc làm việc
- Ngôn ngữ trao đổi: **tiếng Việt**.
- **Quy trình 2 môi trường (từ 07/07/2026)** — remote `https://github.com/vietnamese2212/wms-webapp.git`:
  - **Làm việc mặc định trên branch `dev`** — push `dev` sau mỗi lần sửa → Vercel Preview (URL riêng) + **DB STAGING** (Supabase cũ `bxxryrmpfabvjitqbdnw`, data test). Dev/test/load-test/seed thoải mái ở đây.
  - **User nghiệm thu trên Preview → mới merge `dev` vào `main`** → Vercel Production (`wms-webapp.vercel.app`) + **DB LOF production** (`svicyfquresxaigfxsdb`). KHÔNG push thẳng main trừ hotfix khẩn (lỗi chặn vận hành) — hotfix phải verify kỹ hơn vì không qua staging.
  - **Migration schema: apply STAGING trước → test → mới apply DB production** (cả 2 qua Supabase Dashboard từng project). `.env` local + `.mcp.json` trỏ STAGING; key production chỉ nằm trong Vercel env — Postgres MCP soi staging, muốn soi production phải nói rõ.
  - Kiến trúc multi-tenant (1 code — mỗi đơn vị 1 DB+deploy, cờ theo khác biệt không theo tenant): memory `multi-tenant-silo-architecture`.
- **Đổi DB schema**: SQL → `backend/migrations/YYYYMMDD_<desc>.sql` → apply qua Supabase Dashboard → push → cập nhật `SCHEMA_REVIEW.md`. (Chi tiết: skill `mutation-realtime`.)
- **`Template upload.xlsx` (thư mục gốc) = DỮ LIỆU UPLOAD GỐC của user — TUYỆT ĐỐI KHÔNG sửa/ghi đè, KHÔNG `git add`** (OneDrive hay tự lưu lại đổi byte; luôn `git add` từng file cụ thể, đừng `git add -A`/`git add .`). Chỉ ĐỌC để soi cấu trúc/debug upload.

---
## Nguyên tắc hành vi khi xây dựng app

### 1. Suy nghĩ trước khi code
> **Đừng tự suy diễn. Đừng che giấu sự không chắc chắn. Hãy nêu rõ các đánh đổi.**

Trước khi triển khai:
- Nêu rõ các giả định của bạn. Nếu không chắc, hãy hỏi.
- Nếu có nhiều cách hiểu khác nhau, hãy trình bày chúng — đừng tự âm thầm chọn một.
- Nếu có cách đơn giản hơn, hãy nói ra. Sẵn sàng phản biện khi cần.
- Nếu có điều gì chưa rõ, hãy dừng lại. Chỉ rõ điểm gây mơ hồ. Hỏi lại.

### 2. Ưu tiên sự đơn giản
> **Chỉ viết lượng code tối thiểu để giải quyết vấn đề. Không thêm thứ chưa cần.**

- Không thêm tính năng ngoài yêu cầu.
- Không tạo abstraction cho thứ chỉ dùng một lần.
- Không thêm “tính linh hoạt” hay “khả năng cấu hình” nếu chưa được yêu cầu.
- Không viết xử lý lỗi cho các trường hợp gần như không thể xảy ra.
- Nếu bạn viết 200 dòng nhưng thực tế có thể giải bằng 50 dòng, hãy viết lại.

Tự hỏi:
> “Một senior engineer có thấy đoạn này bị over-engineering không?”

Nếu có, hãy đơn giản hóa.

### 3. Thay đổi có chủ đích, phạm vi nhỏ
> **Chỉ chạm vào thứ cần thiết. Chỉ dọn dẹp phần bạn gây ảnh hưởng.**

Khi chỉnh sửa code hiện có:
- Đừng “tiện tay cải thiện” code, comment hay format ở vùng liên quan.
- Đừng refactor thứ chưa hỏng.
- Hãy theo style hiện có, kể cả khi bạn thích cách khác hơn.
- Nếu thấy dead code không liên quan, hãy ghi chú — đừng tự xóa.

Khi thay đổi của bạn tạo ra phần thừa:
- Xóa import/variable/function mà CHÍNH thay đổi của bạn làm thành không dùng nữa.
- Đừng xóa dead code có sẵn từ trước nếu chưa được yêu cầu.

Nguyên tắc kiểm tra:
> Mỗi dòng thay đổi đều phải truy ngược được tới yêu cầu của người dùng.

### 4. Thực thi theo mục tiêu rõ ràng
> **Định nghĩa tiêu chí thành công. Lặp lại cho tới khi xác minh được.**

Biến task thành các mục tiêu có thể kiểm chứng:
- “Thêm validation” → “Viết test cho input không hợp lệ, sau đó làm cho test pass”
- “Fix bug” → “Viết test tái hiện bug, sau đó sửa để test pass”
- “Refactor X” → “Đảm bảo test pass cả trước và sau refactor”

Với task nhiều bước, hãy nêu kế hoạch ngắn gọn:
```txt
1. [Bước] → kiểm tra: [điều cần verify]
2. [Bước] → kiểm tra: [điều cần verify]
3. [Bước] → kiểm tra: [điều cần verify]
```

Tiêu chí thành công rõ ràng giúp bạn làm việc độc lập tốt hơn.
Tiêu chí mơ hồ kiểu “làm cho nó chạy được” sẽ khiến phải hỏi lại liên tục.

### Các nguyên tắc này đang hiệu quả nếu:
- Diff có ít thay đổi thừa hơn
- Ít phải viết lại do over-engineering
- Các câu hỏi làm rõ xuất hiện trước khi implement thay vì sau khi gây lỗi

---
## Chuẩn code bắt buộc (luật cốt tử — chi tiết nằm trong skill)

**QUY MÔ — app phục vụ VÀI NGHÌN người dùng, dữ liệu VÀI TRIỆU dòng/năm:**
- Mọi thiết kế/query phải giả định bảng nghiệp vụ (InventoryEntry, OutboundScanEntry, TmsOrder, Attendance, gate_registrations…) sẽ có **hàng triệu dòng** — "hiện tại mới vài trăm dòng" KHÔNG phải lý do bỏ qua.
- **PostgREST cap ~1000 dòng/response** — query không phân trang bị cắt ÂM THẦM (data thiếu, báo oan, dedup hỏng); `.limit(N>1000)` cũng KHÔNG vượt được cap. Mọi query trả list phải: `fetchAllRowsParallel` (`utils/pagination`) / range-loop; `.in('col', ids)` với ids lớn phải **chunk 300–500**; kiểm quyền/scope trên list phải kiểm **ĐỦ MỌI dòng** (cắt 1000 đầu = lỗ hổng). Chiến dịch quét: memory `cap-1000-campaign`.
- Gặp vấn đề cùng họ scale (query kéo cả bảng, N+1 roundtrip, đếm/tổng client-side trên list cắt cụt, ghi tuần tự từng dòng…) → **tìm giải pháp và xử lý NGAY trong lượt làm việc đó**, không hoãn, không chỉ fix chỗ đang đụng — quét luôn các chỗ cùng pattern.

**Mutation & realtime** (skill `mutation-realtime` + `verify-feature`):
- Mọi INSERT phải có `id: randomUUID()` + `updated_at: new Date().toISOString()` — DB không có DEFAULT, thiếu → **lỗi 23502**. `import { randomUUID } from 'crypto'`. DB client: `import { supabase } from '../../lib/supabase'`.
- **Upload/ghi hàng loạt (Excel, bulk) KHÔNG ghi tuần tự từng dòng trong `for...await`** — file lớn (vài trăm–nghìn dòng) → hàng nghìn roundtrip nối tiếp → **quá `maxDuration=60s` của Vercel** → user thấy trang "An error occurred with your deployment" (crash hạ tầng, không phải JSON lỗi app). Cách đúng = **ghi theo LÔ MẢNG chunk ~500** (nhanh như upload Tồn kho `inventoryController.uploadExcel`): mã mới → `insert(chunk)`; mã đã có → **`upsert(chunk, { onConflict: 'id' })`** (KHÔNG update lẻ từng dòng, kể cả song song vẫn chậm). Muốn giữ ngữ nghĩa "ô trống giữ giá trị cũ" thì **merge trong JS** (nạp record cũ đủ cột → đắp ô có giá trị → upsert full record; cột không đưa vào payload sẽ giữ nguyên, vd `created_at`/`is_active`). Lỗi lô → fallback từng dòng để chỉ đúng mã hỏng. Mẫu: `materialController.uploadExcel`.
- Tính năng cập nhật số liệu phải **realtime** (không refresh tay) + test đủ **4 case: tạo / sửa / xóa / làm lại**. `invalidateQueries` đủ MỌI key liên quan; thêm key vào `TABLE_QUERY_MAP` (`realtimeEvents.ts`); optimistic phải rollback khi lỗi.

**Đồng thời — VÀI TRĂM nhân sự cùng thao tác** (skill `verify-feature` Cổng 5 + `concurrency-hardening`):
- **Luôn đặt app vào tình huống hàng trăm người cùng xuất/nhập/booking** khi làm/test tính năng ghi số liệu. Hai điều TỐI KỴ: (1) app treo / đá user ra `/login`; (2) dữ liệu sai khi nhiều người cùng làm.
- Mọi cập nhật trên **bộ đếm/tổng/tồn/sức chứa DÙNG CHUNG** phải nguyên tử: đếm sống dưới row-lock (RPC, vd `book_vehicle_slot`) hoặc **optimistic-CAS** (`update … WHERE col=giá_trị_đọc`) — KHÔNG ghi mù `col = đọc + delta` (mất cập nhật khi đua). Mẫu: `consumeInventoryExact`, `addItemScanned`, `adjustInventoryAtomic`.
- **Optimistic-CAS / retry-on-conflict PHẢI có jitter+backoff** giữa các lần thử (không thì thundering herd → nửa số request 409 oan).
- Test tải: gọi **API thật**, dữ liệu **bám DB thật**, **rải + tranh chấp + đa-module đồng thời**, ~25–30 in-flight (đừng bão hoà `max_connections=60`, đừng bắn lúc user thật đang dùng), Playwright **refresh giữa tải** (không văng) + kiểm bất biến (tồn không âm/không xuất quá, không overbooking, cache khớp), rồi **dọn sạch**.

**Phân quyền** (skill `add-permission`):
- Mọi nút/route gọi API write phải gate `can(perms, module, action)` (FE) + `requirePerm` (BE). Mỗi action = 1 permission riêng (không gộp `manage`). Thêm action = đủ **4 nơi**: FE config, **BE config** (thiếu → admin mất quyền), gate nút, route BE.

**Timezone — Asia/Ho_Chi_Minh (UTC+7):**
- Business date (`import_date`…): lưu ngày VN `new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })`. System timestamp (`created_at`…): UTC `toISOString()`. Query khoảng ngày VN: `new Date(\`${vnDate}T00:00:00+07:00\`).toISOString()`.
- Hiển thị: date-only → `formatDate()`; timestamp → `formatDateTime()`/`formatTimestampDate()`/`formatTimestampTime()` (dùng `Intl` + timezone VN, không phụ thuộc OS). Cell hẹp: `formatTimestampDate(s, true)` → `dd-MM-yy`. Tất cả từ `utils/formatters.ts`.

**TypeScript:** không `as any`/`as any[]` — type rõ ràng. Axios error: `import type { AxiosError } from 'axios'`.
- **Nợ `as any` (đang dọn dần):** code cũ còn ~341 chỗ `as any`/`: any` (Stage A đã gỡ 66% an toàn: `(supabase.from(...) as any)` + `(req as any).user`→`req.user`, BE 588→138). **Code MỚI tuyệt đối không `as any`**; đuôi dài chỉ dọn **khi đụng vào từng file**, KHÔNG mass-rewrite (rủi ro churn, lợi ích 0-runtime). Gốc rễ: `backend/src/lib/supabase.ts` thiếu generic `Database` → cách triệt để là `supabase gen types typescript` + `createClient<Database>()` (mini-project, chưa làm). Chi tiết: memory `as-any-cleanup`.

**Frontend:**
- Lỗi API: banner đỏ inline trong component (không chỉ `console.error`).
- Bulk action **song song** `Promise.all(ids.map(...))` (không `for...of await`). Button gọi API: `disabled={saving}` + text chờ.
- Date input form tạo & sửa: `min={TODAY}` (sửa vẫn pre-fill & lưu được giá trị cũ).
- Filter state mọi list page → `useWmsFilterStore` (không `useState` thuần). **Nhớ filter theo từng user là TỰ ĐỘNG** qua `scopedPersist.ts` (key persist gắn `user.id`) — field mới chỉ cần khai trong slice + có default trong `initialFilters()`; KHÔNG tự gắn `localStorage`/`useState` cho filter (sẽ dùng chung giữa các user). QR: sau parse ngày kiểm `isNaN(date.getTime())`.

---
## UI — Manhattan Active WMS

**Mọi list page / table / trang detail: theo skill `table-format`** (card trên canvas xám, toolbar + FilterBar + SavedViews + density, SummaryBand, kéo giãn cột, sticky header/cột đầu, typography 2 cỡ, màu row theo trạng thái, responsive PC/tablet/phone, detail section-band). Module mẫu: `Inbound.tsx` / `InboundDetail.tsx`.
**Quét QR: theo skill `qr-scan-flow`** (flow confirm/instant, camera keep-alive, auto-resume).

**Mọi form Thêm/Sửa: dùng `FormSheet`** (`components/shared/FormSheet.tsx`) — panel trượt từ **lề PHẢI**, cao full màn hình, chia 3 vùng **header cố định · thân cuộn · footer dính đáy** (nút Lưu/Huỷ luôn thấy trên cả PC & mobile; mobile full-width). KHÔNG dùng `Dialog` giữa màn cho form thêm/sửa (Dialog giữa chỉ để **xác nhận/thông báo nhỏ**: xóa, đặt mật khẩu, kết quả). Nút thao tác đặt ở prop `footer`. Mẫu: form trong `UserManagement.tsx`.
- **Dropdown trong form panel phải render qua PORTAL VÀO NODE DIALOG** (`usePopoverAnchor` → `anchor.target` + `anchor.style`), KHÔNG portal ra `document.body`. Vì Radix Sheet/Dialog (modal) dùng `react-remove-scroll` + `pointer-events:none` trên body + bẫy focus → menu portal ra body sẽ **không cuộn / không gõ tìm / khó bấm**. Các dropdown tự chế đã theo chuẩn: `SingleSelect`, `WarehouseSingleSelect`, `WarehouseMultiSelect`, `PlateCombobox`/`NppCombobox`. Radix `Select`/`Popover` portal sẵn nên OK. Dropdown chọn-1 trong form ưu tiên `SingleSelect` (có ô tìm), không dùng `<Select>` Radix thô.
- **Action của mỗi dòng list nên có cả trong pane detail** (khỏi kéo ngang bảng mới thấy cột action) — gate đúng quyền như nút trong bảng. Mẫu: pane detail nhân viên `UserManagement.tsx`.

- **Màu thương hiệu:** accent điều hướng `sky-400/500`; CTA `blue-600`; OK `green-500`; cảnh báo `amber-500`; lỗi `red-500`. Canvas `bg-slate-100`, app bar/sidebar `bg-slate-900`.
- **Responsive bắt buộc** — đẹp ở PC + Tablet + Phone (≤360px không tràn); test cả 3 trước khi push.
- **Thứ tự rollout còn lại:** Outbound (hoàn thiện) → Inventory → Nhặt lẻ → ScanLog → Deliveries → Đăng ký cổng → Materials → TMS Bookings/Report/Settings → Locations → Stocktake → HR.

---
## Tech Stack
- **Frontend:** React 18 + TS + Vite · Tailwind v3 + shadcn/ui · React Router v6 · TanStack Query · html5-qrcode · date-fns · Lucide. Supabase Realtime (`frontend/src/lib/supabase.ts`, anon key).
- **Backend:** Node + Express + TS · `@supabase/supabase-js` service role (`backend/src/lib/supabase.ts`). JWT auth **đã implement** (`authController.ts`: bcrypt + `jwt.sign`; route bảo vệ bằng `requirePerm`/`requireAnyPerm`).
- **Infra:** Supabase (PostgreSQL + Realtime) ×2: staging `bxxryrmpfabvjitqbdnw` (branch `dev` → Vercel Preview) + production LOF `svicyfquresxaigfxsdb` (branch `main` → Vercel Production) · backend serverless qua `api/index.ts`.

**API format:**
```json
{ "success": true, "data": {} }
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." } }
```

**Bối cảnh:** App dùng giữa Kho tổng và Kho NPP. Kho nhận có trong danh sách NPP → có inbound tại kho nhận, dùng nhập hàng / tồn kho bình thường.

---
## Đa đơn vị (multi-tenant SILO) — ĐANG XÂY cho 2 đơn vị, khác nhau ở ĐỊNH DẠNG QR PALLET

**1 codebase phục vụ NHIỀU đơn vị độc lập** — mỗi đơn vị 1 Supabase + 1 Vercel + 1 link riêng (cách ly dữ liệu tuyệt đối). **TUYỆT ĐỐI KHÔNG `if (tenant === 'X')`, không fork/copy project.** Khác biệt giữa đơn vị xử bằng **cờ theo KHÁC BIỆT** (không theo tên đơn vị) trong bảng `SystemSetting` (key-value jsonb, per-DB). Kiến trúc + thang xử lý khác biệt 5 bậc: memory `multi-tenant-silo-architecture`. Khác biệt ĐÃ CÓ THẬT hiện nay = **định dạng tem/QR pallet** (memory `qr-format-v2-semicolon`).

**2 định dạng QR sống chung VÔ THỜI HẠN** (tồn cũ toàn V1; đơn vị mỗi bên 1 format cố định):

| | **V1 — Đơn vị 1 (LOF), delimiter `_`** | **V2 — Đơn vị 2, delimiter `;`** |
|---|---|---|
| Ví dụ | `070526_510000127_C05_M1_001_B` | `50033;      1;TA260705A018;05/07/2026;05/03/2027;      1;05:26` |
| Cấu trúc | `ddmmyy_MãHàng_ChuKỳ_<Máy\|MãNCC>_STT_NMSX` | `MãHàng;QA;MãLô;NSX;HSD;Mẻ;Giờ:Phút` (7 đoạn, **có đệm SPACE → phải trim**) |
| Đoạn ý nghĩa | 1=ngày SX ddmmyy · 2=mã hàng · 3=chu kỳ · **4=Máy (thành phẩm) HOẶC mã NCC (hàng NCC: POSM/Raw/Thùng/Giấy)** · 5=STT pallet · 6=NMSX (hàng NCC: nơi nhận đầu) | 1=mã hàng · **2=QA (1=OK, 0/khác=X)** · **3=Mã lô** (`2 ký tự tắt hàng`+`yymmdd`+`Máy 1 ký tự`+`SEQ 3 số`, vd TA+260705+A+018) · 4=NSX dd/mm/yyyy · 5=HSD dd/mm/yyyy · 6+7=giờ:phút:giây SX |
| HSD / %Date | suy từ NSX + shelf-life (mã/NCC) | **HSD tường minh trên tem** → %Date dùng thẳng HSD (không cần khai shelf-life mã) |
| Mã lô (batch) | không có (cột `batch`=null) | **= khóa liên kết KẾ TOÁN/ERP** (kế toán chỉ giữ mã lô `TA260705A018`); khớp qua import/API sau khi có kết nối |
| NCC | đoạn 4 (hàng NCC) → tự resolve khi quét | tem KHÔNG mang NCC → chọn tay nếu cần |

**PARSE PHẢI TẬP TRUNG — KHÔNG tự `split('_')`/`split(';')` rải rác (nếu không, sửa 1 chỗ sẽ đè/lệch chỗ khác):**
- **BE:** `backend/src/utils/qrParser.ts` — `parseInboundQR(raw)` tự nhận nhánh theo delimiter, trả `ParsedQR` (có `format:'v1'|'v2'`, `qa_ok`, `batch`, `expiry_date`, `machine_code`, `pallet_sequence_no`…) + `normalizeQR(raw)` = **CHỈ trim NGOÀI, GIỮ đệm space bên trong** (pallet_code lưu ĐÚNG như QR quét ra — user chốt "QR quét sao lưu vậy"; trim từng đoạn CHỈ khi bóc tách field trong `parseV2`, KHÔNG khi lưu/khớp). MỌI điểm quét gọi `normalizeQR` trước khi khớp `pallet_code`: inbound scan, outbound scan (`checkScanItem`/`scanItem`), inventory `stocktakeCheck`, pallet-ops `merge`/`ungroup`/`split`.
- **FE:** `frontend/src/utils/qr.ts` — `normalizeQR` / `materialCodeOf(code)` (V2=đoạn 0, V1=đoạn 1) / `isValidDMY`; `frontend/src/components/shared/palletLabel.tsx` — `parseCodeFields(code)` (bóc trường hiển thị 2 format, QR luôn mã hóa NGUYÊN VĂN `pallet_code` nên scan không phụ thuộc). `InboundScanSheet` validate cả 2; `PalletLabels` (entryToLabel/logRowToLabel/auditSummary) + render tem V2 (Mã lô + HSD, đáy 2 ô Máy/Số pallet).
- **%Date TẬP TRUNG:** `computePctDate(entry, material, now)` ở `shelfLife.ts` (BE + FE KHỚP NHAU) — ưu tiên `expiry_date` tường minh (mẫu số HSD−NSX) → fallback NSX+shelflife (V1 kết quả không đổi). Áp mọi nơi tính %Date (inventory list/facets/summary, outbound check/scan/prepare, FE Inventory/PalletDetailDialog/StocktakeDashboard). **Sửa công thức %Date = sửa 1 hàm này**, đừng viết lại rời.

**Cờ & hạ tầng:**
- Cột: `InventoryEntry.batch` (mã lô V2, null với V1) + `InventoryEntry.expiry_date` (HSD V2) — migration `20260707_systemsetting_qr_v2.sql`.
- Bảng `SystemSetting` + cờ `label_format` (`'underscore'`/`'semicolon'`) — điều khiển chiều IN tem **VÀ gate chiều QUÉT inbound** (`getLabelFormat` cache 30s; cờ `;` chỉ nhận tem `;`, `_` chỉ nhận tem `_` — quét nhầm format đơn vị khác → 422 `QR_FORMAT_MISMATCH`, ở cả preview + scan thật). Controller `systemSettingController.ts` (sổ cờ `KNOWN_SETTINGS`) + route `GET /wms/settings` (hở đọc) / `PUT /wms/settings/:key` (`wms_settings.manage_system`). FE: tab **"Hệ thống"** trong Cài đặt WMS (`useSystemSettings`/`useUpdateSystemSetting`, `SingleSelect`). Sinh tem MỚI từ app cho V2: ĐÃ LÀM (đợt 4 `95446d8`) — tab Sinh tem đọc cờ semicolon → form V2 (`buildQRv2`/`buildBatchV2` trong `palletLabel.tsx`): mã lô = `Material.batch_prefix` (2 ký tự, field MỚI) + yymmdd + Máy + STT; HSD auto = NSX+`shelf_life_days` (sửa được); **QR sinh ĐỦ 7 đoạn GIỮ FORMAT NHÀ MÁY `MãHàng;QA;Mã lô;NSX;HSD;Mẻ;Giờ:Phút`, QA+Giờ đệm space width 7 (tem in KHÔNG trim, chỉ trim khi bóc tách/so khớp qua `normalizeQR`)**; Mẻ = dropdown 1..10, Giờ:Phút input (mặc định 00:00); trong mã lô yymmdd = NGÀY NHẬP KHO (ô riêng, default hôm nay — KHÔNG phải NSX); chống trùng = cảnh báo như V1 (KHÔNG ràng dải Máy riêng). Ô "Mã tắt (mã lô)" form Mã hàng + cột 13 mẫu upload (`downloadMaterialTemplate`) chỉ hiện khi cờ=semicolon.
- **Luật vàng chống đè:** mọi thay đổi liên quan format QR phải đi qua các helper tập trung trên (BE↔FE giữ KHỚP NHAU); thêm điểm quét mới → BẮT BUỘC `normalizeQR`; thêm cờ khác biệt mới → thêm vào `KNOWN_SETTINGS` (sổ cờ) + default = hành vi V1 cũ (đơn vị 1 không đổi).

**ĐỊNH HƯỚNG QR-tới-THÙNG (CHỐT 07/07, CHƯA build — chi tiết memory `qr-format-v2-semicolon`):** 1 pallet có thể có QR tới từng thùng (154 thùng→154 tem; hiện giống hệt nhau, tương lai có thể mỗi thùng 1 STT). **Quản thùng = HƯỚNG LAI**: tồn VẪN theo pallet (KHÔNG mỗi thùng 1 dòng — nổ quy mô), tem thùng chỉ để quét-đếm + (khi có STT) bảng log chống-trùng/truy-vết. **STT thùng (tương lai) = ĐOẠN `;` MỚI Ở CUỐI (đoạn 8)** — quy tắc: 7 đoạn=không STT, 8 đoạn=đoạn cuối là STT; `pallet_code` = mọi đoạn TRƯỚC STT. **Đuôi TÁCH pallet `.N` = ĐẶT Ở ĐUÔI MÃ LÔ (đoạn 3)** `TA260705A018.1` (KHÔNG cuối chuỗi), cột `batch` DB vẫn lưu mã lô gốc để khớp kế toán. ⚠️ NỢ: `splitPallet` V2 hiện gắn `.N` cuối chuỗi → đổi sang đuôi mã lô khi build phần thùng.

---
## Phân quyền (RBAC) — chi tiết skill `add-permission`

**Kiến trúc:**
- Quyền lưu trên **`JobTitle.module_permissions`** (KHÔNG phải Employee). Resolve khi login/`/me` (`authController`): superadmin → `ALL_PERMISSIONS`; còn lại → quyền của chức danh. Cột `Employee.module_permissions` không dùng (dead).
- **Hiệu lực khi ĐỔI quyền** (verify E2E 02/07): quyền nhúng trong **JWT (7 ngày)** — BE `requirePerm` đọc từ token, KHÔNG query DB. `/me` re-resolve từ DB và trả **token mới**; FE gọi `refreshUser` khi tải app + **định kỳ 5 phút** (Shell.tsx) và thay cả user + token → cấp/gỡ quyền có hiệu lực **≤5 phút hoặc ngay khi reload**, không cần re-login. Login khớp cột **`email`** (ilike), không phải employee_code.
- **Hở đọc có chủ đích (chưa siết)**: `GET /inventory*`, `GET /inbound-orders*`, `/lookup`, `/zones`, `/tms/transport-companies`, `/tms/vehicles` (2 route TMS bỏ gate 10/07 — danh mục NCC/ĐVVT + biển số đọc chéo khắp WMS, gate TMS làm vai kho thuần 403 âm thầm: panel Sửa NCC rỗng) KHÔNG gate `view` ở BE (Header omni-search + nhiều trang cross-module cần) — user đăng nhập nào cũng đọc được, nhưng dữ liệu **vẫn bị cắt theo scope kho** trong controller. Muốn siết phải liệt kê đủ consumers rồi `requireAnyPerm`.
- **Superadmin** = `name === 'Admin'` (hoặc `employee_code === 'ADMIN'`). Bỏ qua mọi `requirePerm`. *(Nợ kỹ thuật: nên đổi sang cột `is_superadmin`.)*
- **Định nghĩa quyền** ở 2 file PHẢI khớp: FE `frontend/src/config/permissions.ts` (`MODULES` — có label/actions, hiển thị trong trình phân quyền) · BE `backend/src/config/permissions.ts` (`ALL_PERMISSIONS` — thiếu → **superadmin mất quyền** đó). Helper FE: `can(perms, module, action)` / `canAccess` / `isAdmin`. BE: `requirePerm` / `requireAnyPerm`.
- **Scope dữ liệu nhân sự** (`employeeController.visibleEmployeeIds`): non-admin chỉ thấy (kho được gán nếu `warehouse_scope==='ASSIGNED'`) ∩ (cấp dưới theo **`JobTitle.parent_id`** đệ quy + chính mình). Sơ đồ ở JobTitle, KHÔNG ở `Employee.manager_id`.
- **Scope Kho + Loại hàng (`Employee.warehouse_ids` + `Employee.allowed_categories`, 02/07) — RULE user chốt: "đã phân quyền Kho + Loại kho nào thì CHỈ thấy dữ liệu của Kho + Loại đó".** Taxonomy Loại hàng = LookupValue `warehouse_type` (Thành phẩm/POSM/Raw/Giấy/Thùng — giá trị cũ NVL/Bao bì đã dọn bằng migration `20260702_normalize_allowed_categories`, NVL→Raw+Giấy+Thùng, Bao bì→Giấy+Thùng). **FE**: mọi filter/form nghiệp vụ lấy option Loại kho qua `useScopedWhTypes()` và Kho qua `useScopedWarehouses()` (`frontend/src/hooks/useUserScope.ts`) — chỉ UserManagement + tab Kho/Loại kho của WMSSettings (quản trị taxonomy) cố ý dùng hook gốc đầy đủ; tab Khung giờ TMSSettings + tab Khu vực WMSSettings (form + filter Loại kho) ĐÃ dùng hook scoped. **BE**: util `backend/src/utils/categoryScope.ts` (`scopeCategoriesOf`/`categoryAllowed`) — (a) guard write 403: inbound `createOrder`, outbound `createGDO`/`updateGDO`, tms `createOrder`/`updateOrder`, gate create/update, pallet-prints `logPrints` (kèm kho từng tem), zone create/update/delete + slot-template create/batch/update/delete (khung giờ cargo `ALL` = chỉ user full loại được viết); (b) cắt LIST theo kho+loại: `listGDOs`, `listPrints`, loose-picking, gate list, tms orders (2 nhánh + chặn `warehouse_id` ngoài scope), `getInboundReport` (Báo cáo nhập — fix 07/07: bỏ trống filter từng xem được TOÀN BỘ), `listLocations` (kể cả không truyền warehouse_id) + `listSubGroups` + `listZones`, `listSlotTemplates` (giữ cargo `ALL` hiển thị), `stocktakeEntries` (validate `location_ids` từ client), inventory `listFacets` (intersect JWT), `listMaterials`, scan-log (RPC `p_allowed_categories` — migration `20260702_scanlog_category_scope`, controller có fallback khi chưa apply); pallet-ops guard theo **kho thật của entry** (`guardEntryWh`), không tin warehouse_id từ body. Quy ước: mọi cắt đều **null-inclusive** (bản ghi không khai loại vẫn hiện). Khi thêm form/filter/list mới có Kho/Loại kho → BẮT BUỘC dùng 2 hook scoped + guard/cắt BE tương ứng.
- **Bảo vệ Admin**: chỉ superadmin sửa hồ sơ/đặt-MK/xóa/đổi-kho tài khoản Admin (`blockIfTargetSuperadmin`, `isSuperadmin`). Sửa **hồ sơ** nhân viên = superadmin; non-admin chỉ chỉnh **Kỹ năng/Vị trí**. **Chống leo thang**: non-admin không cấp cho chức danh quyền vượt quyền mình (`escalationError`).
- **Sửa chức danh / phòng ban**: tên / phân quyền / cấu trúc (`createJobTitle`/`updateJobTitle`/`setJobTitleParent`/`create|updateDepartment`) = **chỉ superadmin**. Non-admin chỉ sửa **Danh mục Vị trí/Skill** của chức danh **CẤP DƯỚI mình** — `skillController` scope create/update/delete skill theo `JobTitle.parent_id` (cấp dưới của job_title người gọi, qua `writableJobTitleIds`); FE `JobTitleFormDialog` chỉ hiện phần Vị trí/Skill cho non-admin + ẩn nút Sửa nếu không phải chức danh cấp dưới.

**Bản đồ module → trang (để biết nút nào dùng quyền nào):**

| Module key | Nhãn (bảng quyền) | Trang / Menu | Actions |
|---|---|---|---|
| `inventory` | Tồn kho | Tồn kho | view, adjust, move_location, recode, qa_update, **update_ncc**=Sửa NCC hàng loạt (gán NCC cho pallet → áp HSD ngoại lệ theo NCC), update_prod_date, export |
| `inbound` | Nhập kho | Nhập kho | view, create, edit, scan, edit_pallet, force_edit_pallet, delete_pallet, force_delete_pallet, cancel, complete, uncomplete |
| `outbound` | Xuất kho | Xuất kho | view, **prepare**=Chuẩn bị hàng (board soạn hàng, read-only — tách khỏi view, không phải ai xem Xuất kho cũng vào được), create, **quick_export**=Tạo & Xuất luôn (đơn tạo tay TOÀN hàng không tem — mã no-QR/kho QTY: 1 request tạo+Bắt đầu(biển số bắt buộc)+ghi nhận SL+Hoàn thành+trừ tồn; `POST /outbound/quick-export`), **import**=Upload Excel KH xuất, **edit**=sửa đơn/xe/đổi ngày/tạm dừng-tiếp tục, assign, unassign, start (kho QTY/NONE không cần assign trước — BE tự gán người bấm Bắt đầu), unstart, **scan**=quét QR + Lưu thủ công no-QR (+ nút "Lưu tất cả theo KH" bulk trên trang chuyến), **complete**=Hoàn thành chuyến (patchGDO status=COMPLETED, controller kiểm riêng — KHÔNG đi ké edit) + xác nhận nhặt lẻ, uncomplete, cancel |
| `scanlog` | Lịch sử quét | Lịch sử quét | view |
| `loosepicking` | Nhặt lẻ | Nhặt lẻ | view, scan, complete (create/start/cancel ĐÃ BỎ 27/06 — nhặt lẻ tạo/bắt đầu/hủy đều qua Outbound, không route riêng) |
| `stocktake` | Kiểm kho | Kiểm kho | view, create, scan, complete |
| `locations` | Vị trí kho | Vị trí kho | view, create, edit, delete |
| `materials` | Mã hàng | Mã hàng (+ Nhà sản xuất) | view, create, edit, delete |
| `pallet_print` | In tem pallet | In tem pallet | view, **mỗi tab 1 quyền (02/07)**: generate=tab Sinh tem mới, reprint=tab In lại từ tồn kho + nút In lại trong Lịch sử, history=tab Lịch sử in, audit=tab Truy cứu |
| `pallet_ops` | Dồn / Tách pallet | Dồn / Tách pallet | view, merge, ungroup, split |
| `wms_settings` | Cài đặt WMS | Cài đặt WMS (kho, loại kho, khu vực, ca nhập, QA, **Hệ thống**) | view, manage_warehouse, manage_type, manage_zone, manage_shift, manage_qa, **manage_system**=tab Hệ thống (cờ `label_format` định dạng tem in — multi-tenant) |
| `employees` | Sơ đồ tổ chức (xem) | Sơ đồ tổ chức + xem DS nhân sự | view |
| `user_admin` | Quản lý người dùng | Quản lý người dùng | view, create, edit, set_password, delete, manage_roles |
| `work_skill` | Vị trí & Skill | trong Quản lý người dùng (gán skill) | view, manage, assign |
| `schedule` | Lịch làm việc | Lịch làm việc | view, create, approve |
| `work_assignment` | Phân công lịch làm việc | Phân công | view, create, edit, publish, delete, **manage_layout**=tab Layout, **manage_shift_rules**=tab Quy tắc ca (3 tab = 3 quyền: Phân công/view · Layout/manage_layout · Quy tắc ca/manage_shift_rules) |
| `attendance` | Chấm công | Chấm công | view, self_log, edit, report |
| `leave` | Nghỉ phép | Chấm công (tab Nghỉ phép) | view, request, approve, delete |
| `tms_plan` | Vận chuyển: Đặt lịch & Chuyển kho | TMS Bookings (tab Đặt lịch + Chuyển kho) | view, create, edit, delete, add_vehicle, release, change_date, book, revoke, upload_outbound, upload_inbound, **confirm_receipt**=nhận hàng chuyển kho (xác nhận/quét/hoàn thành) |
| `tms_vehicle_types` | TMS — Loại xe | Cài đặt TMS | view, create, edit, delete (sửa chỉ đổi Tên + trạng thái; Mã khóa cố định) |
| `tms_slots` | TMS — Khung giờ | Cài đặt TMS | view, create (gồm "Sửa cả cụm" — endpoint batch), edit (sửa lẻ 1 dòng), delete (xóa lẻ + cả cụm) |
| `tms_companies` | TMS — ĐVVT / NCC | Cài đặt TMS | view, manage |
| `tms_vehicles` | TMS — Xe | Cài đặt TMS | view, manage |
| `gate_registration` | Đăng ký cổng | Đăng ký cổng | view, create, edit, delete, call, entry, exit |
| `inbound_plan` | Kế hoạch nhập chuyển kho | trong TMS Bookings (tab Kế hoạch) — KH nhập kho đích của chuyển kho, auto-tạo từ Outbound + upload. **KHÔNG còn khái niệm "KH nhập từ ngoài" / trang KH nhập đứng riêng** | view, edit (create/delete/cancel ĐÃ BỎ 02/07 — mồ côi; tạo/sửa/xóa dòng KH đi theo `tms_plan.upload_inbound` hoặc `tms_plan.edit`) |

> **Cross-module**:
> - Nút "Quét/Hoàn thành" trong tab **Chuyển kho** gọi API Inbound nhưng được điều khiển bằng `tms_plan.confirm_receipt` (FE + BE `requireAnyPerm(['inbound',...],['tms_plan','confirm_receipt'])`). Khi nút ở trang A nhưng thao tác chạm module B → dùng `requireAnyPerm` + ghi nhãn cho rõ, đừng bắt user đoán.
> - Trang **Tồn kho** có nút tắt **Tách/Dồn** (thanh thao tác khi chọn pallet) dùng quyền `pallet_ops.split` / `pallet_ops.merge`: nút chỉ **điều hướng** sang trang Dồn/Tách (KHÔNG gọi API chéo) nên chỉ cần gate nút bằng `pallet_ops` (không cần `requireAnyPerm` ở route Inventory); API thực thi nằm ở route `/pallet-ops/*` đã gate `pallet_ops`.
> - **ĐỔI VỊ TRÍ phiếu nhập** (Inbound detail, nút bút chì + select "Chưa chọn vị trí") dùng quyền **`inbound.edit_pallet` / `force_edit_pallet`** (sửa pallet của mình / bất kỳ) — **KHÔNG** dùng `inbound.edit` (vốn là "Sửa nhóm phiếu NCC"). Route riêng `PATCH /inbound-orders/:id/location` (`requireAnyPerm(edit_pallet, force_edit_pallet)`) chỉ đổi `location_id` — KHÔNG gộp vào `updateOrder` (để không nới quyền sửa field khác). **Bài học: một capability riêng (đổi vị trí) phải map đúng quyền sở hữu nó, đừng gộp ké vào quyền không liên quan** — nếu cần tách thì tạo route/permission riêng, đừng dùng chung gây "gộp quyền".

**LUẬT khi thêm/sửa tính năng có nút/route write — BẮT BUỘC đủ 5 việc:**
1. Thêm action vào **FE `MODULES`** (label phải mô tả đúng TRANG nó điều khiển — để admin biết link tới đâu).
2. Thêm action vào **BE `ALL_PERMISSIONS`** (thiếu → superadmin mất quyền).
3. Gate nút FE: `can(perms, module, action)`.
4. Gate route BE: `requirePerm` / `requireAnyPerm`.
5. Cập nhật bảng bản đồ ở trên. Nếu nút nằm khác module với quyền nó cần → dùng `requireAnyPerm` + nhãn rõ.

---
## Công cụ (skill · MCP · hook)

**Skill — BẮT BUỘC gọi đúng skill TRƯỚC khi làm** (đừng dựa vào trí nhớ, đừng tự suy luận lại chuẩn). Gọi qua công cụ Skill hoặc `/<tên>`; file ở `.claude/skills/<tên>/SKILL.md`:

| Khi… | BẮT BUỘC gọi skill |
|---|---|
| Bắt đầu việc lớn (module mới, đổi schema, refactor nhiều file, yêu cầu mơ hồ) | `brainstorm-plan` |
| Rà soát / audit toàn bộ 1 module (chiến dịch review từng module) | `review-module` |
| Tạo/sửa list page · table · trang detail | `table-format` |
| Làm/sửa tính năng quét QR | `qr-scan-flow` |
| Thêm/sửa nút hay route gọi API write (tạo/sửa/xóa/quét/duyệt/phát hành…) | `add-permission` |
| Thêm/sửa INSERT/UPDATE · mutation số liệu · đổi DB schema | `mutation-realtime` |
| Trước khi báo “đã xong” bất kỳ tính năng/sửa lỗi nào | `verify-feature` |
| Gặp bug / hành vi sai chưa rõ nguyên nhân | `debug-systematic` |

**Một việc thường chạm NHIỀU skill — gọi đủ.** Vd thêm nút Xóa trong table = `table-format` + `add-permission` + `mutation-realtime`, xong `verify-feature`.

**MCP:** Postgres (query DB read-only — `mcp__postgres__query`) · Playwright (test UI thật, login đọc từ `frontend/.env`) · Vercel (trạng thái deploy/log). Cấu hình ở `.mcp.json` — **gitignored** (chứa DATABASE_URL, không commit).

**Backend deploy:** sửa `backend/src` → **bump `// rebuild-token`** trong `api/index.ts` để Vercel rebuild function (có hook nhắc).

---
## Development
```bash
cd backend && npm run dev    # port 4000
cd frontend && npm run dev   # port 5173
```
Vercel env: `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` (BE) · `VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY` (FE).
