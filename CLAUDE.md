# WMS Supply Chain Webapp

## Quy tắc làm việc
Ngôn ngữ trao đổi: tiếng việt
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

### Outbound — Scan → Chỉnh số thùng → Lưu
Camera bắt QR → camera dừng → hiện ô nhập số thùng (mặc định = số thùng còn cần xuất) → **"Lưu"** → API commit.
- Floating "Quét tiếp" + "Lưu" overlay trên camera khi có `pendingQR`
- Thành công: feedback xanh, camera resume sau 1.5s
- Lỗi: feedback đỏ, bấm "Quét tiếp" để resume thủ công
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

**Row colors — trạng thái:**
```
COMPLETED / đầy vị trí  →  bg-blue-50  hover:bg-blue-100
IN_PROGRESS / đang xử lý →  bg-amber-50 hover:bg-amber-100
Đã giao đơn (assigned)   →  bg-green-50 hover:bg-green-100
PENDING / chưa xử lý     →  hover:bg-slate-50   (nền trắng)
```
Áp dụng nhất quán ở cả list page và detail page cho mọi module.

**Typography:**
- Page title: `text-xl font-semibold` · Section: `text-base font-medium`
- Body: `text-sm text-slate-700` · Caption/label: `text-xs text-slate-500`

---

## Table Format Standards (bắt buộc cho mọi module)

### Font size trong table
| Loại dữ liệu | Class |
|---|---|
| Header cột | `text-[9px] font-medium text-slate-500` |
| Mã hàng / mã pallet / ID | `text-[10px] font-mono font-semibold` |
| Tên hàng / tên người / text chính | `text-[10px] font-medium` |
| Số lượng / số đếm | `text-[10px] font-semibold tabular-nums` |
| Sub-label / đơn vị (thùng, pl, kg…) | `text-[9px] text-slate-400` |
| Metadata (ngày, giờ, trạng thái phụ) | `text-[10px] text-slate-500` |

### Padding row
- Compact (≥ 15 rows): `px-2 py-1`
- Header row: `px-2 py-1.5`
- Header row background: `bg-slate-50`

### Responsive / mobile
- **Không ẩn cột trên mobile** — giảm font thay vì `hidden sm:table-cell`
- Wrap table trong `<div className="overflow-x-auto">` để scroll ngang thay vì vỡ layout
- Page wrapper cho list: `flex flex-col h-full`
- Table area: `flex-1 overflow-auto pb-20 lg:pb-4`

### Định dạng ngày trong table
- Compact (cell): `dd/MM/yy` — không thêm nhãn "Hôm nay" vào ô
- Header / tiêu đề trang: `EEEE, dd/MM/yyyy` với locale `vi`

### Tên hàng (Material name)
Luôn dùng: `material?.short_name ?? material_code_raw ?? '—'`
Không dùng `custom_short_name`.

### Filter dropdown
- Sentinel cho "tất cả": dùng `'__all__'` không dùng `''` — Radix UI crash khi `value=""`
- Convert trong `onValueChange`: `v === '__all__' ? '' : v`
- Trigger size: `h-7 text-xs`
- Filter row: `<div className="flex gap-2 flex-wrap">`

---

## Detail Page Layout — 20/80

Trang detail có phần header info + phần bảng dữ liệu:

```tsx
<div className="flex flex-col h-full min-h-0">
  {/* Header ~20% */}
  <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5 overflow-y-auto"
       style={{ maxHeight: '22vh' }}>
    {/* tất cả text dùng text-xs */}
  </div>

  {/* Table ~80% */}
  <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
    <div className="overflow-x-auto">
      <Table className="min-w-full">...</Table>
    </div>
  </div>
</div>
```

- Header: tất cả text dùng `text-xs`, padding `px-3 py-2`, spacing `space-y-1.5`
- `shrink-0` + `max-h: 22vh` + `overflow-y-auto` → header không đẩy bảng ra ngoài màn hình
- `flex-1 min-h-0` trên table container là bắt buộc để overflow hoạt động đúng trong flex

---

## Layout chung

- Desktop: sidebar 240px cố định + content area
- Mobile: bottom nav bar + header back button
- Cards: `rounded-xl shadow-sm border border-slate-200 p-4`
- Material selector: combobox Input + dropdown inline, server-side search

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
| **Outbound** | Đã implement đầy đủ (list + detail + QR scan) ✅ | `frontend/src/pages/wms/Outbound.tsx` |
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
