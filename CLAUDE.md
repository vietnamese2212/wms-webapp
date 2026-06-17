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

**Phân quyền** (skill `add-permission`):
- Mọi nút/route gọi API write phải gate `can(perms, module, action)` (FE) + `requirePerm` (BE). Mỗi action = 1 permission riêng (không gộp `manage`). Thêm action = đủ **4 nơi**: FE config, **BE config** (thiếu → admin mất quyền), gate nút, route BE.

**Timezone — Asia/Ho_Chi_Minh (UTC+7):**
- Business date (`import_date`…): lưu ngày VN `new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })`. System timestamp (`created_at`…): UTC `toISOString()`. Query khoảng ngày VN: `new Date(\`${vnDate}T00:00:00+07:00\`).toISOString()`.
- Hiển thị: date-only → `formatDate()`; timestamp → `formatDateTime()`/`formatTimestampDate()`/`formatTimestampTime()` (dùng `Intl` + timezone VN, không phụ thuộc OS). Cell hẹp: `formatTimestampDate(s, true)` → `dd-MM-yy`. Tất cả từ `utils/formatters.ts`.

**TypeScript:** không `as any`/`as any[]` — type rõ ràng. Axios error: `import type { AxiosError } from 'axios'`.

**Frontend:**
- Lỗi API: banner đỏ inline trong component (không chỉ `console.error`).
- Bulk action **song song** `Promise.all(ids.map(...))` (không `for...of await`). Button gọi API: `disabled={saving}` + text chờ.
- Date input form tạo & sửa: `min={TODAY}` (sửa vẫn pre-fill & lưu được giá trị cũ).
- Filter state mọi list page → `useWmsFilterStore` (không `useState` thuần). QR: sau parse ngày kiểm `isNaN(date.getTime())`.

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
## Công cụ (skill · MCP · hook)

**Skill** (`.claude/skills/<tên>/SKILL.md` — tự kích hoạt theo ngữ cảnh, hoặc gọi tay `/<tên>`):
`brainstorm-plan` (plan việc lớn) · `table-format` (list/table/detail) · `qr-scan-flow` (quét QR) · `add-permission` (thêm quyền 4 nơi) · `mutation-realtime` (INSERT/realtime/migration) · `verify-feature` (kiểm chứng trước khi báo xong) · `debug-systematic` (tìm nguyên nhân gốc).

**MCP:** Postgres (query DB read-only — `mcp__postgres__query`) · Playwright (test UI thật, login đọc từ `frontend/.env`) · Vercel (trạng thái deploy/log). Cấu hình ở `.mcp.json` — **gitignored** (chứa DATABASE_URL, không commit).

**Backend deploy:** sửa `backend/src` → **bump `// rebuild-token`** trong `api/index.ts` để Vercel rebuild function (có hook nhắc).

---
## Development
```bash
cd backend && npm run dev    # port 4000
cd frontend && npm run dev   # port 5173
```
Vercel env: `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` (BE) · `VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY` (FE).
