# WMS Supply Chain Webapp

## Quy tắc làm việc
Ngôn ngữ trao đổi: tiếng việt
- **Push GitHub sau mỗi lần sửa code** — Vercel tự deploy.
- Remote: `https://github.com/vietnamese2212/wms-webapp.git` (branch `main`)
- **Thay đổi DB schema**: viết SQL → `backend/migrations/YYYYMMDD_<desc>.sql` → apply qua Supabase Dashboard → SQL Editor → push GitHub → cập nhật `SCHEMA_REVIEW.md`.

# CLAUDE.md

Các nguyên tắc hành vi nhằm giảm những lỗi lập trình phổ biến của LLM. Có thể kết hợp với các hướng dẫn riêng của project khi cần.

> **Đánh đổi:** Các nguyên tắc này ưu tiên sự cẩn trọng hơn tốc độ. Với các tác vụ đơn giản, hãy tự cân nhắc linh hoạt.

# 1. Suy nghĩ trước khi code
> **Đừng tự suy diễn. Đừng che giấu sự không chắc chắn. Hãy nêu rõ các đánh đổi.**
Trước khi triển khai:
- Nêu rõ các giả định của bạn. Nếu không chắc, hãy hỏi.
- Nếu có nhiều cách hiểu khác nhau, hãy trình bày chúng — đừng tự âm thầm chọn một.
- Nếu có cách đơn giản hơn, hãy nói ra. Sẵn sàng phản biện khi cần.
- Nếu có điều gì chưa rõ, hãy dừng lại. Chỉ rõ điểm gây mơ hồ. Hỏi lại.

# 2. Ưu tiên sự đơn giản

> **Chỉ viết lượng code tối thiểu để giải quyết vấn đề. Không thêm thứ chưa cần.**

- Không thêm tính năng ngoài yêu cầu.
- Không tạo abstraction cho thứ chỉ dùng một lần.
- Không thêm “tính linh hoạt” hay “khả năng cấu hình” nếu chưa được yêu cầu.
- Không viết xử lý lỗi cho các trường hợp gần như không thể xảy ra.
- Nếu bạn viết 200 dòng nhưng thực tế có thể giải bằng 50 dòng, hãy viết lại.
Tự hỏi:
> “Một senior engineer có thấy đoạn này bị over-engineering không?”
Nếu có, hãy đơn giản hóa.
# 3. Thay đổi có chủ đích, phạm vi nhỏ
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

---

# 4. Thực thi theo mục tiêu rõ ràng

> **Định nghĩa tiêu chí thành công. Lặp lại cho tới khi xác minh được.**

Biến task thành các mục tiêu có thể kiểm chứng:

- “Thêm validation”  
  → “Viết test cho input không hợp lệ, sau đó làm cho test pass”

- “Fix bug”  
  → “Viết test tái hiện bug, sau đó sửa để test pass”

- “Refactor X”  
  → “Đảm bảo test pass cả trước và sau refactor”

Với task nhiều bước, hãy nêu kế hoạch ngắn gọn:

```txt
1. [Bước] → kiểm tra: [điều cần verify]
2. [Bước] → kiểm tra: [điều cần verify]
3. [Bước] → kiểm tra: [điều cần verify]
```

Tiêu chí thành công rõ ràng giúp bạn làm việc độc lập tốt hơn.  
Tiêu chí mơ hồ kiểu “làm cho nó chạy được” sẽ khiến phải hỏi lại liên tục.

---

# Các nguyên tắc này đang hiệu quả nếu:

- Diff có ít thay đổi thừa hơn
- Ít phải viết lại do over-engineering
- Các câu hỏi làm rõ xuất hiện trước khi implement thay vì sau khi gây lỗi11
---

## Chuẩn code bắt buộc

**Database INSERT/UPDATE:**
- Mọi INSERT phải có `id: randomUUID()` và `updated_at: new Date().toISOString()` — DB không có DEFAULT cho 2 cột này, thiếu → lỗi 23502
- `import { randomUUID } from 'crypto'` ở đầu mọi controller có INSERT
- DB client: `import { supabase } from '../../lib/supabase'`

**TypeScript:**
- Không dùng `as any`, `as any[]` — định nghĩa type rõ ràng
- Axios error: `import type { AxiosError } from 'axios'`

**Timezone — bắt buộc:**
- Múi giờ: **Asia/Ho_Chi_Minh (UTC+7 / Hà Nội)**
- Business date (`import_date`, `update_date`…): lưu chỉ ngày `YYYY-MM-DD` theo giờ VN:  
  `new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })` → `'2026-05-11'`
- System timestamp (`created_at`, `updated_at`): UTC `new Date().toISOString()` là OK
- Khi tính khoảng ngày theo giờ VN để query DB: `new Date(\`${vnDate}T00:00:00+07:00\`).toISOString()`
- Format hiển thị cho user: `dd/mm/yyyy` (ngày) · `dd/mm/yyyy HH:mm` (ngày giờ)

**QR parsing:**
- Sau parse ngày: `isNaN(date.getTime())` trước khi dùng

**Frontend:**
- Lỗi API hiển thị inline (banner đỏ trong component), không chỉ `console.error`

---

## Tech Stack

**Frontend:** React 18 + TypeScript + Vite · Tailwind CSS v3 + shadcn/ui · React Router v6 · TanStack Query · html5-qrcode · date-fns · Lucide React
**Supabase Realtime** (`frontend/src/lib/supabase.ts`, anon key) — invalidate React Query khi DB thay đổi, không cần polling

**Backend:** Node.js + Express + TypeScript · `@supabase/supabase-js` service role (`backend/src/lib/supabase.ts`) · JWT auth chưa implement

**Infra:** Supabase (PostgreSQL + Realtime, tất cả bảng `public` đã bật) · Vercel (auto-deploy từ GitHub `main`)

---

## API & Auth

```json
{ "success": true, "data": { ... } }
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." } }
```

Roles: `OWN` (chọn kho tự do) · `WAREHOUSE_MANAGER` / `WAREHOUSE_STAFF` (kho cố định).
Mock user: `frontend/src/stores/authStore.ts` — `warehouse_name: 'Kho Ba Vì'` khi dev.

---

## QR Scanning

**Inbound** — Scan → preview xanh → chỉnh số thùng / tầng chồng → **"Lưu pallet"** → API.
**Outbound** — Scan → ô nhập số thùng (mặc định = còn cần xuất) + floating "Quét tiếp"/"Lưu" → API.
Cả hai: thành công → feedback xanh + auto-resume 1.5s · lỗi → feedback đỏ + "Quét tiếp" thủ công.
`QRScanner` export `forwardRef<QRScannerHandle>` với method `resume()`.

---

## Design System

**Brand colors:** `blue-600` CTA · `green-500` OK · `amber-500` cảnh báo · `red-500` lỗi

**Row colors theo trạng thái** (áp dụng nhất quán mọi module):
```
COMPLETED / đầy vị trí   →  bg-blue-50  hover:bg-blue-100
IN_PROGRESS / đang xử lý →  bg-amber-50 hover:bg-amber-100
Đã giao đơn (assigned)   →  bg-green-50 hover:bg-green-100
PENDING / chưa xử lý     →  hover:bg-slate-50  (nền trắng)
```

**Typography:** Page title `text-xl font-semibold` · Section `text-base font-medium` · Body `text-sm` · Label `text-xs text-slate-500`

---

## Table Standards (bắt buộc mọi module)

**2 cỡ font:**
- **Header cột:** `text-[9px] font-medium text-slate-500` · padding `px-2 py-1.5` · nền `bg-slate-50`
- **Dữ liệu:** `text-[10px]` · thêm `font-mono font-semibold` cho mã/ID, `font-semibold tabular-nums` cho số, `text-slate-400` cho đơn vị phụ (thùng, pl…)

**Padding data row:** `px-2 py-1`

**Responsive:** Không ẩn cột trên mobile (`hidden sm:table-cell` bị cấm) — wrap `overflow-x-auto`, scroll ngang thay vì vỡ layout.

**Ngày:** cell dùng `dd/MM/yy` · tiêu đề trang dùng `EEEE, dd/MM/yyyy` (locale `vi`).

**Tên hàng:** `material?.short_name ?? material_code_raw ?? '—'` — không dùng `custom_short_name`.

**Filter "tất cả":** sentinel `'__all__'`, không dùng `''` — Radix UI crash với `value=""`.

---

## Layout

**List page:** `<div className="flex flex-col h-full">` · table area `flex-1 overflow-auto pb-20 lg:pb-4`

**Detail page (20/80):**
```tsx
<div className="flex flex-col h-full min-h-0">
  {/* Header 20% — text-xs, px-3 py-2, space-y-1.5 */}
  <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5 overflow-y-auto"
       style={{ maxHeight: '22vh' }} />

  {/* Table 80% — flex-1 min-h-0 bắt buộc */}
  <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
    <div className="overflow-x-auto"><Table className="min-w-full" /></div>
  </div>
</div>
```

**Chung:** Desktop sidebar 240px · Mobile bottom nav · Cards `rounded-xl shadow-sm border border-slate-200 p-4`

---

## Tính năng chưa hoàn thiện

| Module | Trạng thái |
|---|---|
| **Auth** | JWT middleware chưa implement — `backend/src/middlewares/` |
| **TMS / HR** | Routes comment out, chưa có controller — `backend/src/app.ts` dòng 28–30 |
| **Services layer** | Business logic trong controllers, `services/` trống |

---

## Development

```bash
cd backend && npm run dev    # port 4000
cd frontend && npm run dev   # port 5173
```

Vercel env: `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` (backend) · `VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY` (frontend)

Local `frontend/.env`: `VITE_API_URL=` · `VITE_SUPABASE_URL=https://bxxryrmpfabvjitqbdnw.supabase.co`
