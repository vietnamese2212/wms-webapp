# WMS Supply Chain Webapp

## Quy tắc làm việc

- **Push GitHub sau mỗi lần sửa code** — Vercel tự deploy.
- Remote: `https://github.com/vietnamese2212/wms-webapp.git` (branch `main`)
- **Thay đổi DB schema**: viết SQL → `backend/migrations/YYYYMMDD_<desc>.sql` → apply qua Supabase Dashboard → SQL Editor → push GitHub → cập nhật `SCHEMA_REVIEW.md`.

# CLAUDE.md

Các nguyên tắc hành vi nhằm giảm những lỗi lập trình phổ biến của LLM. Có thể kết hợp với các hướng dẫn riêng của project khi cần.

> **Đánh đổi:** Các nguyên tắc này ưu tiên sự cẩn trọng hơn tốc độ. Với các tác vụ đơn giản, hãy tự cân nhắc linh hoạt.

---

# 1. Suy nghĩ trước khi code

> **Đừng tự suy diễn. Đừng che giấu sự không chắc chắn. Hãy nêu rõ các đánh đổi.**

Trước khi triển khai:

- Nêu rõ các giả định của bạn. Nếu không chắc, hãy hỏi.
- Nếu có nhiều cách hiểu khác nhau, hãy trình bày chúng — đừng tự âm thầm chọn một.
- Nếu có cách đơn giản hơn, hãy nói ra. Sẵn sàng phản biện khi cần.
- Nếu có điều gì chưa rõ, hãy dừng lại. Chỉ rõ điểm gây mơ hồ. Hỏi lại.

---

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

---

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
- Các câu hỏi làm rõ xuất hiện trước khi implement thay vì sau khi gây lỗi
---

## Chuẩn code bắt buộc

**Database INSERT/UPDATE:**
- Mọi INSERT phải có `id: randomUUID()` và `updated_at: new Date().toISOString()` — DB không có DEFAULT cho 2 cột này, thiếu → lỗi 23502
- `import { randomUUID } from 'crypto'` ở đầu mọi controller có INSERT
- DB client: `import { supabase } from '../../lib/supabase'`

**TypeScript:**
- Không dùng `as any`, `as any[]` — định nghĩa type rõ ràng
- Axios error: `import type { AxiosError } from 'axios'`

**QR parsing:**
- Sau parse ngày: `isNaN(date.getTime())` trước khi dùng

**Frontend:**
- Lỗi API hiển thị inline (banner đỏ trong component), không chỉ `console.error`

---

## Tech Stack

### Frontend
- React 18 + TypeScript + Vite
- Tailwind CSS v3 + shadcn/ui (Radix UI primitives)
- React Router v6 · TanStack Query · React Hook Form + Zod
- html5-qrcode · date-fns · Lucide React
- **Supabase Realtime** (`frontend/src/lib/supabase.ts`, anon key) — invalidate React Query khi DB thay đổi, không cần polling

### Backend
- Node.js + Express + TypeScript
- `@supabase/supabase-js` — DB client (service role key, `backend/src/lib/supabase.ts`)
- JWT auth — chưa implement middleware

### Infrastructure
- Supabase — PostgreSQL + Realtime (tất cả bảng `public` đã bật)
- Vercel — frontend + backend serverless, auto-deploy từ GitHub `main`

---

## QR Scanning

### Inbound — Scan → Xác nhận → Lưu
Camera bắt QR → camera dừng → preview xanh → operator chỉnh số thùng / tầng chồng → **"Lưu pallet"** → API commit.
- Thành công: feedback xanh, camera resume sau 1.5s
- Lỗi: feedback đỏ, bấm "Quét tiếp" để resume thủ công
- "Huỷ": xoá pending QR, resume ngay

### Các flow khác (Xuất kho, Kiểm kho, Chấm công) — Instant scan
Camera bắt QR → gọi API ngay, không có bước confirm. Auto-resume 1.5s sau thành công, dừng khi lỗi.
`QRScanner` export `forwardRef<QRScannerHandle>` với method `resume()`.

---

## Design System

**Colors:**
```
Primary:  blue-600    CTA, active states
Success:  green-500   hoàn thành, OK
Warning:  amber-500   cảnh báo, pending
Danger:   red-500     lỗi, từ chối
```
Capacity fill: Full → `text-blue-700 font-semibold` · Partial → `text-amber-600` · Empty → default slate

**Typography:**
- Page title: `text-xl font-semibold` · Section: `text-base font-medium`
- Body: `text-sm text-slate-700` · Caption/label: `text-xs text-slate-500`

**Table standards:**
- Dữ liệu chính (mã pallet, tên hàng, số lượng): `text-lg`
- Metadata (ngày, người, NMSX, máy): `text-xs` / `text-[11px]`
- Compact rows (≥ 20 rows): `py-1 px-2`
- Material selector: combobox Input + dropdown inline, server-side search

**Layout:**
- Desktop: sidebar 240px cố định + content area
- Mobile: bottom nav bar + header back button
- Cards: `rounded-xl shadow-sm border border-slate-200 p-4`

---

## API Conventions

```json
{ "success": true, "data": { ... } }
{ "success": false, "error": { "code": "NOT_FOUND", "message": "Không tìm thấy..." } }
```

Auth roles: `OWN` (chọn kho tự do) · `WAREHOUSE_MANAGER` / `WAREHOUSE_STAFF` (kho cố định, read-only).
Mock user trong `frontend/src/stores/authStore.ts` dùng `warehouse_name: 'Kho Ba Vì'` khi dev.

---

## Tính năng chưa hoàn thiện

| Module | Vấn đề | File |
|---|---|---|
| **Auth** | JWT middleware chưa implement, routes chưa bảo vệ | `backend/src/middlewares/` |
| **Outbound** | Mock data, chưa kết nối API | `frontend/src/pages/wms/Outbound.tsx` |
| **TMS / HR** | Routes comment out, chưa có controller | `backend/src/app.ts` dòng 28–30 |
| **Services layer** | Business logic trong controllers, `services/` trống | `backend/src/services/` |

---

## Development

```bash
cd backend && npm run dev    # port 4000
cd frontend && npm run dev   # port 5173
```

**Env vars (Vercel):**
- Backend: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

**Env vars (local frontend/.env):**
```
VITE_API_URL=
VITE_SUPABASE_URL=https://bxxryrmpfabvjitqbdnw.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```
