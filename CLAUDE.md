# WMS Supply Chain Webapp

## Quy tắc làm việc
Ngôn ngữ trao đổi: tiếng việt
- **Push GitHub sau mỗi lần sửa code** — Vercel tự deploy.
- Remote: `https://github.com/vietnamese2212/wms-webapp.git` (branch `main`)
- **Thay đổi DB schema**: viết SQL → `backend/migrations/YYYYMMDD_<desc>.sql` → apply qua Supabase Dashboard → SQL Editor → push GitHub → cập nhật `SCHEMA_REVIEW.md`.

# CLAUDE.md

Các nguyên tắc hành vi khi xây dựng app

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

**Realtime & test bắt buộc cho mọi tính năng cập nhật số liệu:**
- Mọi tính năng mới liên quan đến cập nhật số liệu (tồn kho, số lượng, trạng thái…) **phải được cập nhật realtime** — không để user phải refresh thủ công.
- Sau khi implement, bắt buộc test đủ 4 tình huống:
  1. **Bắt đầu làm** — tạo mới / thao tác lần đầu → số liệu cập nhật đúng ngay lập tức
  2. **Sửa** — chỉnh sửa giá trị → số liệu phản ánh giá trị mới
  3. **Xóa** — xóa record → số liệu được hoàn lại / cập nhật đúng
  4. **Làm lại** — thao tác lại sau khi xóa → số liệu tích lũy chính xác, không bị stale cache
- Checklist kỹ thuật khi thêm tính năng mới có mutation:
  - `onSettled`/`onSuccess` của mutation phải `invalidateQueries` cho **tất cả** query key liên quan (không chỉ query chính)
  - `TABLE_QUERY_MAP` trong `realtimeEvents.ts` phải thêm query key mới vào bảng DB tương ứng
  - Nếu dùng optimistic update, phải rollback đúng khi lỗi

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
- Format hiển thị cho user: `dd-MM-yyyy` (ngày) · `dd-MM-yyyy HH:mm:ss` (ngày giờ) — dùng `formatDate()` / `formatDateTime()` từ `utils/formatters.ts`
- **Timestamp (`created_at`, `updated_at`, `started_at`, `scanned_at`…)**: dùng `formatDateTime()` / `formatTimestampDate()` / `formatTimestampTime()` — các hàm này dùng `Intl` API với `timeZone: 'Asia/Ho_Chi_Minh'`, không phụ thuộc timezone OS/browser
- **Date-only (`import_date`, `delivery_date`…)**: dùng `formatDate()` (date-fns) — timezone-safe vì không có component giờ
- Table cell không gian hẹp: `formatTimestampDate(str, true)` → `dd-MM-yy` · `formatTimestampTime(str)` → `HH:mm:ss`

**QR parsing:**
- Sau parse ngày: `isNaN(date.getTime())` trước khi dùng

**Filter persistence — bắt buộc mọi list page:**
- Mọi filter state trên list page (search, date, dropdown…) phải được lưu vào `useWmsFilterStore` (`frontend/src/stores/wmsFilterStore.ts`) — không dùng `useState` thuần cho filter (mất state khi navigate).
- Thêm interface mới vào store + setter tương ứng. Tên key theo module: `inbound`, `outbound`, `inventory`, `loosePicking`, `gateRegistration`, `deliveries`, `materials`…
- TMSBookings là ngoại lệ — đang dùng `localStorage` trực tiếp với `useEffect` save (chấp nhận vì đã hoạt động).

**Date input — bắt buộc:**
- **Form tạo mới**: `min={TODAY}` (hoặc `TODAY_VN` / `TODAY_STR` tùy file) — không cho chọn ngày cũ hơn hôm nay.
- **Form sửa**: `min={TODAY}` — cho phép **lưu** giá trị cũ đang có (pre-fill từ record), nhưng **không cho chọn** ngày mới cũ hơn hôm nay. React controlled input: giá trị cũ vẫn hiển thị bình thường dù < min.

**Frontend:**
- Lỗi API hiển thị inline (banner đỏ trong component), không chỉ `console.error`
- **Bulk action phải chạy song song** — dùng `Promise.all(ids.map(...))`, không dùng `for...of await` (sequential = N round-trips, chậm tuyến tính)
- **Loading state bắt buộc** — mọi button gọi API phải có `disabled={saving}` và text phản hồi trong khi chờ
- **Dropdown trong table cell bị che:** wrapper ngoài table **không được có `overflow-hidden`** — CSS clips tất cả `position: absolute` descendants kể cả `z-50`. Dùng `border rounded-lg` (bỏ `overflow-hidden`).
- **Table trong dialog bị cắt chữ/số:** wrapper table dùng `overflow-x-auto border rounded-lg` + table dùng `min-w-max` để scroll ngang thay vì ép cột hẹp.
- **Dropdown mở trong dialog có `overflow-y-auto`:** mở hướng lên (`bottom-full mb-1`) thay vì xuống (`top-full`) để tránh bị clip bởi boundary dialog.

**Phân quyền — bắt buộc mọi nút action:**
- Mọi `<Button>` hay element có `onClick` gọi API write (tạo/sửa/xóa/quét/giao/hoàn thành…) **phải** được bọc bởi `can(perms, module, action)`.
- Pattern chuẩn:
  ```tsx
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  // ...
  {can(perms, 'module_key', 'action_key') && <Button onClick={...}>...</Button>}
  ```
- `perms` lấy từ `useAuthStore(s => s.user)` — import `can, type ModulePermissions` từ `@/config/permissions`.
- **Mỗi nút action = 1 permission riêng — không gộp.** Không dùng permission `manage` duy nhất để gate nhiều loại action khác nhau. Ví dụ: nút "Thêm", "Sửa", "Xóa" trong cùng module là 3 permission `create`, `edit`, `delete` riêng biệt — không gộp thành 1 `manage`.
- Khi thêm action mới: (1) thêm key vào `MODULES` trong `frontend/src/config/permissions.ts`; (2) thêm vào `backend/src/config/permissions.ts` — **bắt buộc**, đây là nguồn `ALL_PERMISSIONS` admin nhận lúc login, thiếu thì admin không có quyền dù là superadmin; (3) gate nút frontend; (4) thêm `requirePerm('module', 'action')` trên route backend.
- Backend enforce qua `requirePerm` middleware — frontend chỉ ẩn nút, không phải điểm bảo mật duy nhất.
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
---

## QR Scanning

**Inbound** — Scan → preview xanh → chỉnh số thùng / tầng chồng → **"Lưu pallet"** → API.
**Outbound** — Scan → ô nhập số thùng (mặc định = còn cần xuất) + floating "Quét tiếp"/"Lưu" → API.
Cả hai: thành công → feedback xanh + auto-resume 1.5s · lỗi → feedback đỏ + "Quét tiếp" thủ công.
`QRScanner` export `forwardRef<QRScannerHandle>` với method `resume()`.
---
## Design System

**App shell (Manhattan Active WMS):**
- **Sidebar / mobile drawer = dark rail** `bg-slate-900 text-slate-200`; mục active = `bg-white/10 text-white` + thanh accent trái `bg-sky-400` + icon `text-sky-300`; mục thường `text-slate-400 hover:bg-white/5`. Group label `text-slate-500`. Logo tile `bg-sky-500`. (`Sidebar.tsx`, `MobileNav.tsx`)
- **Canvas vùng nội dung = `bg-slate-100`** (xám nhạt) để panel/bảng trắng nổi lên (`Shell.tsx` `<main>`). Header trang giữ `bg-white border-b`.
- **Accent điều hướng: sky** (`sky-400/500`). CTA trong nội dung vẫn `blue-600`.

**Brand colors:** `blue-600` CTA · `green-500` OK · `amber-500` cảnh báo · `red-500` lỗi

**Row = HIGHLIGHT MÀU CHỮ theo trạng thái (KHÔNG fill nền)** — chuẩn Manhattan, dùng helper `@/lib/rowStatus`:
- `rowText(key)` cho `<TableRow>` (màu chữ + `hover:bg-slate-50`, không fill); `statusText(key)` cho header detail/cell.
- Key: `completed` (xanh + **gạch ngang**) · `full` (xanh, không gạch) · `scanDone` (hồng) · `inProgress` (cam) · `assigned` (xanh lá) · `paused` (đỏ) · `pending` (xám).
- **Đồng màu cả dòng** — không tô màu riêng từng cell (vd cột giờ). Mỗi module viết hàm `xxxKey(record): RowStatusKey` và export để trang detail tái dùng.
- **Header trang detail (mọi cấp) PHẢI kế thừa cùng màu**: `className={statusText(xxxKey(record))}` trên mã/tiêu đề.
- Vẫn có thể kèm cột **Status badge** (pill) song song để rõ nhãn.
- **Scroll ngang**: bảng trong container `flex-1 min-h-0 overflow-auto` (KHÔNG bọc thêm `overflow-x-auto`) → thanh cuộn ngang ở đáy màn hình.
- **Cột kéo giãn được (`useColumnResize`)**: `table-fixed` + `<colgroup>` width từ hook + `style={{ width: totalWidth, minWidth: '100%' }}` (fill màn khi dư, scroll khi thiếu). Kẻ cột rõ: `[&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100` + `[&_td]:overflow-hidden`. Tay kéo = `<span onPointerDown={e=>startResize(i,e)}>` ở mép phải mỗi `<TableHead>` (relative).
- **Nhóm dòng (vd nhóm theo lệnh TMS)**: cả cụm nền `bg-slate-50`; **dòng đầu** `[&_td]:border-t [&_td]:!border-t-slate-300`, **dòng cuối** `[&_td]:!border-b-slate-300` (đóng khung); chèn hàng trống 10px (`<td colSpan><div className="h-2.5"/></td>`) giữa các cụm. Dòng lẻ giữ nguyên.
- **Số semantic chỉ tô khi cảnh báo** (vd Thùng KH **đỏ** khi thực nhập < kế hoạch); còn lại kế thừa màu row.
**Typography:** Page title `text-xl font-semibold` · Section `text-base font-medium` · Body `text-sm` · Label `text-xs text-slate-500`
---
## UI Style — Manhattan Active WMS (chuẩn mới, bắt buộc mọi list page)

Toàn app theo phong cách **Manhattan Active WMS**. Mọi list page mới/được sửa phải dùng bộ component dùng chung dưới đây thay cho panel lọc ẩn / dropdown rời rạc cũ. Module mẫu (tham chiếu): `frontend/src/pages/wms/Inbound.tsx`.

**Trang = panel trắng bo góc trên canvas xám (card):** root `flex flex-col h-full sm:p-3`, bọc nội dung trong `flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm` (header thêm `sm:rounded-t-xl`). Mobile bỏ padding/card (full-bleed cho gọn). KHÔNG để `overflow-hidden` trên card (clip popover filter).

**Toolbar (1 hàng trên cùng):** `Tiêu đề · SearchInput (flex-1) · [FilterSheetButton sm:hidden] · SavedViews · nút density (hidden sm:inline-flex) · [primary action]`. Hàng 2 = `<FilterBar>` bọc `hidden sm:flex`. Mobile: nút **Lọc** nằm cùng hàng action (qua `FilterSheetButton`), không chiếm hàng riêng; density ẩn trên mobile.

**Filter ngày: luôn dùng `daterange` (Từ ngày – Đến ngày)**, không dùng 1 ngày đơn. Backend list filter theo `date_from`/`date_to` (`gte`/`lte`).

**Filter chip bar (`FilterBar` — `@/components/shared/FilterBar`):**
- Filter khai báo **declarative** qua `defs: FilterDef[]`, 4 loại: `multi` | `single` | `daterange` | `text`. Không tự code dropdown filter rời nữa.
- **Desktop/tablet (≥sm):** filter đang áp hiện thành **chip có nút ✕** (luôn nhìn thấy đang lọc gì); filter trống nằm trong menu **"+ Thêm lọc"**; có nút "Xóa tất cả".
- **Mobile (<sm):** FilterBar **tự** gom thành 1 nút **"Lọc (n)"** mở sheet full-screen dạng accordion — KHÔNG trải chip ngang (tránh chiếm chỗ). Đây là hành vi built-in, không cần code thêm.
- `multi`/`single` có search-contains + "Tất cả"; `multi` có checkbox vuông + dấu tích.

**App bar (global Header) tông tối** `bg-slate-900` đồng bộ dark rail; nội dung dưới sáng. **Footer đếm bản ghi** ở đáy bảng (`1–N / N`). **Detail = section-band**: mỗi khối có bar `bg-slate-100 border-b` + accent `bg-sky-500` + tiêu đề in hoa + Action menu riêng.

**Pane phải + Live Tiles (`InboundPane` mẫu):** desktop (lg+) **click 1 dòng = chọn** → hiện pane phải (ảnh/mã/vị trí + ô số liệu `bg-sky-600/700` bấm được) ; **double-click = mở detail**. Mobile (không pane) click = mở detail. Dùng `useIsDesktop()` để phân nhánh.

**Dải tile tổng hợp (`SummaryBand` — `@/components/shared/SummaryBand`):** chữ ký Manhattan SCALE Insight — dải xanh `bg-sky-800` full-width ngay TRÊN bảng, mỗi tile = nhãn nhỏ in hoa + số lớn (vd `Phiếu nhập | Pallet | Thực nhập | Hoàn thành`). Đặt giữa header và vùng bảng; **list và detail dùng chung** để đồng bộ. Số liệu tổng chuyển hết vào đây thay cho dòng text.

### ✅ Checklist chuyển 1 module sang Manhattan (mẫu tham chiếu: `Inbound.tsx` + `InboundDetail.tsx`)
**List page:**
1. Root card: `flex flex-col h-full sm:p-3` → bọc `flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:shadow-sm`.
2. Toolbar: `SearchInput` + `<FilterSheetButton sm:hidden>` + `<SavedViews module="<key>">` + nút density + primary action. Hàng 2: `<FilterBar defs>` bọc `hidden sm:flex`.
3. Filter: chuyển hết sang `FilterBar` `defs` (ngày = `daterange`). Bỏ `MultiSelectFilter`/Select rời.
4. `<SummaryBand>` giữa header và bảng.
5. Bảng: `table-fixed` + `useColumnResize` + colgroup + kẻ cột + sticky cột đầu. Row màu chữ qua `rowText(<module>Key(r))` (export `<module>Key`). Footer đếm bản ghi.
6. (Tùy chọn) Pane phải + Live Tiles nếu có ảnh/thao tác nhanh.
7. Filter state → `useWmsFilterStore`; density `localStorage['<module>_density']`; cột `'<module>_col_widths'`.

**Detail (mọi cấp):** đóng khung card như list; header **kế thừa màu** `statusText(<module>Key(r))`; mỗi bảng = section-band; `<SummaryBand>` tổng.

**Sau mỗi module:** `tsc --noEmit` + `npm run build` + push. Test realtime 4 case (tạo/sửa/xóa/làm lại).

**Thứ tự rollout còn lại:** Outbound (hoàn thiện nốt) → Inventory → Nhặt lẻ → ScanLog → Deliveries → Đăng ký cổng → Materials → TMS Bookings/Report/Settings → Locations → Stocktake → HR.

**Saved Views (`SavedViews` + `useSavedViewsStore`):** lưu/áp tổ hợp filter đặt tên (localStorage, keyed theo module). Truyền `module`, `currentFilters` (snapshot), `onApply`, `activeId`.

**Density toggle:** nút đổi dòng thoáng/dày, lưu `localStorage['<module>_density']`; row dày dùng `[&_td]:py-2.5`.

**Responsive bắt buộc:** mọi thay đổi UI phải đẹp ở **PC + Tablet + Phone**. Test cả 3 trước khi push. Popover/sheet không tràn màn 360px; toolbar co giãn (search `flex-1`, nhãn phụ `hidden sm:inline`).

**Building block cũ (vẫn dùng được khi KHÔNG phải filter bar):** `MultiSelectFilter` từ `@/components/shared/MultiSelectFilter` — multi-select đứng riêng trong dialog/form. Filter của list page thì dùng `FilterBar`.

---
## Filter Standards (chi tiết)

**Kiểu filter Excel** — mọi dropdown filter phải theo nguyên tắc:
1. **Search contains** — ô tìm kiếm trong dropdown, không phân biệt hoa thường
3. **Multi-select + "Tất cả"** — qua `FilterBar` (list page) hoặc `MultiSelectFilter` (dialog/form)
4. **Checkbox vuông + dấu tích** — hiển thị trạng thái chọn từng item

**Tình trạng Còn tồn (Inventory):** chỉ 2 option — `Còn tồn` (default, `status=''`) / `Tất cả` (`status='ALL'`). Không thêm per-status option.

**% Date range (Inventory):**
- `> 80%`  = `pct > 80`
- `60–80%` = `60 < pct ≤ 80`
- `30–60%` = `30 < pct ≤ 60`

**Filter phía server vs client:**
- Server-side: `warehouse_id`, `material_category` trong Inventory (paginated) + Inbound
- Client-side: Material / Chu kỳ / Máy / Người nhập / Ca trong Inbound; tất cả Outbound; %Date Inventory

---
## Table Standards (bắt buộc mọi module)
**2 cỡ font:**
- **Header cột:** `text-[9px] font-medium text-slate-500` · padding `px-2 py-1.5` · nền `bg-slate-50`
- **Dữ liệu:** `text-[10px]` · thêm `font-mono font-semibold` cho mã/ID, `font-semibold tabular-nums` cho số, `text-slate-400` cho đơn vị phụ (thùng, pl…)

Không được hiển thị thiếu thông tin trong table ( kể cả dữ liệu dài)
**Padding data row:** `px-2 py-1`

**Responsive:** Không ẩn cột trên mobile (`hidden sm:table-cell` bị cấm) — wrap `overflow-x-auto`, scroll ngang thay vì vỡ layout.

**Status = badge (Manhattan):** trạng thái workflow hiển thị bằng `<Badge>` pill (variant `success`/`info`/`warning`/`slate`) thành **cột riêng**, không chỉ tô màu dòng. Vẫn giữ row-color theo trạng thái song song.

**Cột đầu sticky-left:** cột định danh đầu tiên (Ngày / Mã) dùng `sticky left-0 z-10` + **nền đặc** (không hover, vd `bg-blue-50`/`bg-white` theo trạng thái) để giữ context khi scroll ngang trên phone. Header tương ứng: `sticky left-0 z-20 bg-slate-50`.

**Density:** truyền `dense` xuống Row; row dày = `[&_td]:py-2.5` trên `<TableRow>`.

**Ngày:** cell dùng `dd-MM-yy` · tiêu đề trang dùng `EEEE, dd-MM-yyyy` (locale `vi`).

**Sticky header (bắt buộc):** `TableHead` base component đã có `sticky top-0 z-10 bg-slate-50` — tự động áp dụng cho mọi table. Không cần thêm thủ công. Đảm bảo table nằm trong container `overflow-auto` để sticky hoạt động.

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

** App xây dựng để sử dụng giữa Kho tổng và Kho NPP, nếu kho nhận có trong danh sách NPP thì sẽ có inbound tại kho nhận, kho nhận có thể sử dụng chức năng nhập hàng, tồn kho bình thường
---

## Development

```bash
cd backend && npm run dev    # port 4000
cd frontend && npm run dev   # port 5173
```

Vercel env: `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` (backend) · `VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY` (frontend)

Local `frontend/.env`: `VITE_API_URL=` · `VITE_SUPABASE_URL=https://bxxryrmpfabvjitqbdnw.supabase.co`
