# WMS Supply Chain Webapp

## Quy tắc làm việc
- Ngôn ngữ trao đổi: **tiếng Việt**.
- **Push GitHub sau mỗi lần sửa code** — Vercel tự deploy. Remote: `https://github.com/vietnamese2212/wms-webapp.git` (branch `main`).
- **Đổi DB schema**: SQL → `backend/migrations/YYYYMMDD_<desc>.sql` → apply qua Supabase Dashboard → push → cập nhật `SCHEMA_REVIEW.md`. (Chi tiết: skill `mutation-realtime`.)

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

**Mutation & realtime** (skill `mutation-realtime` + `verify-feature`):
- Mọi INSERT phải có `id: randomUUID()` + `updated_at: new Date().toISOString()` — DB không có DEFAULT, thiếu → **lỗi 23502**. `import { randomUUID } from 'crypto'`. DB client: `import { supabase } from '../../lib/supabase'`.
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

- **Màu thương hiệu:** accent điều hướng `sky-400/500`; CTA `blue-600`; OK `green-500`; cảnh báo `amber-500`; lỗi `red-500`. Canvas `bg-slate-100`, app bar/sidebar `bg-slate-900`.
- **Responsive bắt buộc** — đẹp ở PC + Tablet + Phone (≤360px không tràn); test cả 3 trước khi push.
- **Thứ tự rollout còn lại:** Outbound (hoàn thiện) → Inventory → Nhặt lẻ → ScanLog → Deliveries → Đăng ký cổng → Materials → TMS Bookings/Report/Settings → Locations → Stocktake → HR.

---
## Tech Stack
- **Frontend:** React 18 + TS + Vite · Tailwind v3 + shadcn/ui · React Router v6 · TanStack Query · html5-qrcode · date-fns · Lucide. Supabase Realtime (`frontend/src/lib/supabase.ts`, anon key).
- **Backend:** Node + Express + TS · `@supabase/supabase-js` service role (`backend/src/lib/supabase.ts`). JWT auth **đã implement** (`authController.ts`: bcrypt + `jwt.sign`; route bảo vệ bằng `requirePerm`/`requireAnyPerm`).
- **Infra:** Supabase (PostgreSQL + Realtime) · Vercel (auto-deploy từ GitHub `main`, backend serverless qua `api/index.ts`).

**API format:**
```json
{ "success": true, "data": {} }
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." } }
```

**Bối cảnh:** App dùng giữa Kho tổng và Kho NPP. Kho nhận có trong danh sách NPP → có inbound tại kho nhận, dùng nhập hàng / tồn kho bình thường.

---
## Phân quyền (RBAC) — chi tiết skill `add-permission`

**Kiến trúc:**
- Quyền lưu trên **`JobTitle.module_permissions`** (KHÔNG phải Employee). Resolve khi login/`/me` (`authController`): superadmin → `ALL_PERMISSIONS`; còn lại → quyền của chức danh. Cột `Employee.module_permissions` không dùng (dead).
- **Superadmin** = `name === 'Admin'` (hoặc `employee_code === 'ADMIN'`). Bỏ qua mọi `requirePerm`. *(Nợ kỹ thuật: nên đổi sang cột `is_superadmin`.)*
- **Định nghĩa quyền** ở 2 file PHẢI khớp: FE `frontend/src/config/permissions.ts` (`MODULES` — có label/actions, hiển thị trong trình phân quyền) · BE `backend/src/config/permissions.ts` (`ALL_PERMISSIONS` — thiếu → **superadmin mất quyền** đó). Helper FE: `can(perms, module, action)` / `canAccess` / `isAdmin`. BE: `requirePerm` / `requireAnyPerm`.
- **Scope dữ liệu nhân sự** (`employeeController.visibleEmployeeIds`): non-admin chỉ thấy (kho được gán nếu `warehouse_scope==='ASSIGNED'`) ∩ (cấp dưới theo **`JobTitle.parent_id`** đệ quy + chính mình). Sơ đồ ở JobTitle, KHÔNG ở `Employee.manager_id`.
- **Bảo vệ Admin**: chỉ superadmin sửa hồ sơ/đặt-MK/xóa/đổi-kho tài khoản Admin (`blockIfTargetSuperadmin`, `isSuperadmin`). Sửa **hồ sơ** nhân viên = superadmin; non-admin chỉ chỉnh **Kỹ năng/Vị trí**. **Chống leo thang**: non-admin không cấp cho chức danh quyền vượt quyền mình (`escalationError`).
- **Sửa chức danh / phòng ban**: tên / phân quyền / cấu trúc (`createJobTitle`/`updateJobTitle`/`setJobTitleParent`/`create|updateDepartment`) = **chỉ superadmin**. Non-admin chỉ sửa **Danh mục Vị trí/Skill** của chức danh **CẤP DƯỚI mình** — `skillController` scope create/update/delete skill theo `JobTitle.parent_id` (cấp dưới của job_title người gọi, qua `writableJobTitleIds`); FE `JobTitleFormDialog` chỉ hiện phần Vị trí/Skill cho non-admin + ẩn nút Sửa nếu không phải chức danh cấp dưới.

**Bản đồ module → trang (để biết nút nào dùng quyền nào):**

| Module key | Nhãn (bảng quyền) | Trang / Menu | Actions |
|---|---|---|---|
| `inventory` | Tồn kho | Tồn kho | view, adjust, move_location, recode, qa_update, **update_ncc**=Sửa NCC hàng loạt (gán NCC cho pallet → áp HSD ngoại lệ theo NCC), update_prod_date, export |
| `inbound` | Nhập kho | Nhập kho | view, create, edit, scan, edit_pallet, force_edit_pallet, delete_pallet, force_delete_pallet, cancel, complete, uncomplete |
| `outbound` | Xuất kho | Xuất kho | view, **prepare**=Chuẩn bị hàng (board soạn hàng, read-only — tách khỏi view, không phải ai xem Xuất kho cũng vào được), create, edit, assign, unassign, start, unstart, scan, complete, uncomplete, cancel |
| `scanlog` | Lịch sử quét | Lịch sử quét | view |
| `loosepicking` | Nhặt lẻ | Nhặt lẻ | view, scan, complete (create/start/cancel ĐÃ BỎ 27/06 — nhặt lẻ tạo/bắt đầu/hủy đều qua Outbound, không route riêng) |
| `stocktake` | Kiểm kho | Kiểm kho | view, create, scan, complete |
| `locations` | Vị trí kho | Vị trí kho | view, create, edit, delete |
| `materials` | Mã hàng | Mã hàng (+ Nhà sản xuất) | view, create, edit, delete |
| `pallet_print` | In tem pallet | In tem pallet | view, generate, reprint |
| `pallet_ops` | Dồn / Tách pallet | Dồn / Tách pallet | view, merge, ungroup, split |
| `wms_settings` | Cài đặt WMS | Cài đặt WMS (kho, ca nhập, QA) | view, manage_zone, manage_global |
| `employees` | Sơ đồ tổ chức (xem) | Sơ đồ tổ chức + xem DS nhân sự | view |
| `user_admin` | Quản lý người dùng | Quản lý người dùng | view, create, edit, set_password, delete, manage_roles |
| `work_skill` | Vị trí & Skill | trong Quản lý người dùng (gán skill) | view, manage, assign |
| `schedule` | Lịch làm việc | Lịch làm việc | view, create, approve |
| `work_assignment` | Phân công lịch làm việc | Phân công | view, create, edit, publish, delete, **manage_layout**=tab Layout, **manage_shift_rules**=tab Quy tắc ca (3 tab = 3 quyền: Phân công/view · Layout/manage_layout · Quy tắc ca/manage_shift_rules) |
| `attendance` | Chấm công | Chấm công | view, self_log, edit, report |
| `leave` | Nghỉ phép | Chấm công (tab Nghỉ phép) | view, request, approve, delete |
| `tms_plan` | Vận chuyển: Đặt lịch & Chuyển kho | TMS Bookings (tab Đặt lịch + Chuyển kho) | view, create, edit, delete, add_vehicle, release, change_date, book, revoke, upload_outbound, upload_inbound, **confirm_receipt**=nhận hàng chuyển kho (xác nhận/quét/hoàn thành) |
| `tms_vehicle_types` | TMS — Loại xe | Cài đặt TMS | view, create, edit, delete (sửa chỉ đổi Tên + trạng thái; Mã khóa cố định) |
| `tms_slots` | TMS — Khung giờ | Cài đặt TMS | view, manage |
| `tms_companies` | TMS — ĐVVT / NCC | Cài đặt TMS | view, manage |
| `tms_vehicles` | TMS — Xe | Cài đặt TMS | view, manage |
| `gate_registration` | Đăng ký cổng | Đăng ký cổng | view, create, edit, delete, call, entry, exit |
| `inbound_plan` | Kế hoạch nhập chuyển kho | trong TMS Bookings (tab Kế hoạch) — KH nhập kho đích của chuyển kho, auto-tạo từ Outbound + upload. **KHÔNG còn khái niệm "KH nhập từ ngoài" / trang KH nhập đứng riêng** | view, create, edit, delete, cancel |

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
