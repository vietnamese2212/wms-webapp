# WMS Supply Chain Webapp

## Quy tắc làm việc

- **Push GitHub sau mỗi lần sửa code** — Vercel tự deploy.
- Remote: `https://github.com/vietnamese2212/wms-webapp.git` (branch `main`)
- **Thay đổi DB schema**: viết SQL → `backend/migrations/YYYYMMDD_<desc>.sql` → apply qua Supabase Dashboard → SQL Editor → push GitHub → cập nhật `SCHEMA_REVIEW.md`.
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
