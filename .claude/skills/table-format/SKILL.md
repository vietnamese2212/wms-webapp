---
name: table-format
description: BẮT BUỘC áp dụng khi tạo/sửa BẤT KỲ list page, table, hay trang chi tiết nghiệp vụ nào theo chuẩn Manhattan Active WMS. Gộp đủ chuẩn từ CLAUDE.md (UI Style/Table Standards/Filter Standards/Layout/Design System): card trên canvas xám, toolbar (Search+FilterBar+SavedViews+density+action), SummaryBand, kéo giãn cột (useColumnResize), sticky header + cột đầu, typography 2 cỡ + whitespace-nowrap, màu row theo trạng thái (KHÔNG override màu cell), Status badge, cột audit Tạo/Sửa, Pane phải + Live Tiles, density toggle, filter persistence, responsive PC/tablet/phone, detail section-band 20/80. Đọc TRƯỚC khi viết JSX list/table để không bỏ sót chuẩn.
---

# Manhattan List Page & Table (WMS Standard)

> Đây là chuẩn **bắt buộc** mọi list page. Module mẫu tham chiếu: `frontend/src/pages/wms/Inbound.tsx` + `InboundDetail.tsx`. Skill này gộp các mục CLAUDE.md: "UI Style — Manhattan", "Table Standards", "Filter Standards", "Layout", "Design System".

## 0. App shell & màu (Design System)
- **Accent điều hướng = sky** (`sky-400/500`); CTA trong nội dung vẫn `blue-600`. OK `green-500` · cảnh báo `amber-500` · lỗi `red-500`.
- Canvas vùng nội dung `bg-slate-100` (panel/bảng trắng nổi lên). Header trang `bg-white border-b`. App bar global tông tối `bg-slate-900`.
- Sidebar/drawer dark rail `bg-slate-900 text-slate-200`; mục active `bg-white/10 text-white` + accent trái `bg-sky-400`.

## 1. Cấu trúc list page = CARD trên canvas xám
```tsx
<div className="flex flex-col h-full sm:p-3">                                   {/* mobile full-bleed, desktop có padding */}
 <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
  <div className="border-b bg-white px-3 py-2 shrink-0 sm:rounded-t-xl">       {/* toolbar (hàng 1) + FilterBar (hàng 2) */}</div>
  <SummaryBand tiles={[...]} />                                                 {/* dải xanh sky-800 ngay trên bảng */}
  <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">                  {/* MỘT overflow duy nhất */}
    <Table className="...">...</Table>
  </div>
  {/* footer đếm bản ghi: 1–N / N */}
 </div>
</div>
```
> **KHÔNG để `overflow-hidden` trên card** (clip popover FilterBar + dropdown trong cell). Dùng `border rounded-xl`, bỏ `overflow-hidden`.

## 2. Toolbar (1 hàng trên) + FilterBar (hàng 2)
Thứ tự hàng 1: `Tiêu đề · SearchInput (flex-1) · [FilterSheetButton sm:hidden] · SavedViews · nút density (hidden sm:inline-flex) · [primary action]`.
Hàng 2: `<FilterBar defs={...} />` bọc `hidden sm:flex`. Mobile: FilterBar tự gom thành nút "Lọc (n)" → sheet full-screen (không trải chip ngang); density ẩn.

## 3. FilterBar (`@/components/shared/FilterBar`) — declarative
- Khai báo `defs: FilterDef[]`, 4 loại: `multi` | `single` | `daterange` | `text`. **KHÔNG** tự code dropdown filter rời, không dùng `MultiSelectFilter`/Select rời cho filter list.
- **Filter ngày luôn `daterange`** (Từ–Đến), không dùng ngày đơn. Backend filter `date_from`/`date_to` → `gte`/`lte`.
- Desktop ≥sm: filter đang áp = chip có ✕; filter trống nằm trong menu "+ Thêm lọc"; có "Xóa tất cả". Mobile <sm: tự gom thành sheet accordion (built-in).
- `multi`/`single`: search-contains + "Tất cả"; `multi` có checkbox vuông + dấu tích.
- **Sentinel `'__all__'`** cho "tất cả" (KHÔNG dùng `''` — Radix crash với `value=""`).
- **Server-side** filter: `warehouse_id`, `material_category` (Inventory paginated + Inbound). **Client-side**: phần còn lại.

## 4. SummaryBand (`@/components/shared/SummaryBand`)
Dải `bg-sky-800` full-width ngay TRÊN bảng; mỗi tile = nhãn nhỏ in hoa + số lớn. List và detail **dùng chung** để đồng bộ. Số liệu tổng chuyển hết vào đây thay cho dòng text. Stats tính trên `displayItems` (đã filter).

## 5. SavedViews + Density
- `SavedViews` (`useSavedViewsStore`): lưu/áp tổ hợp filter đặt tên (localStorage theo module). Truyền `module`, `currentFilters`, `onApply`, `activeId`.
- Density toggle: đổi dòng thoáng/dày, lưu `localStorage['<module>_density']`; row dày = `[&_td]:py-2.5`.

## 6. Pane phải + Live Tiles (tùy chọn — khi có ảnh/thao tác nhanh)
Desktop (lg+, `useIsDesktop()`): **click 1 dòng = chọn** → hiện pane phải (ảnh/mã/vị trí + ô số liệu `bg-sky-600/700` bấm được); **double-click = mở detail**. Mobile (không pane): click = mở detail.

## 7. Bảng — 2 kiểu
- **Đơn giản** (masterdata ít cột): `<Table className="min-w-full">`.
- **Manhattan list (kéo giãn cột)** — mặc định list nghiệp vụ: `table-fixed` + `useColumnResize('<module>_col_widths', defaults)` (`@/components/shared/useColumnResize`) + `<colgroup>{widths.map(w=><col style={{width:w}}/>)}` + `style={{ width: totalWidth, minWidth: '100%' }}` (fill khi dư, scroll khi thiếu). Kẻ cột: `[&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden`. Tay kéo = `<span onPointerDown={e=>startResize(i,e)} className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70">` trong `<TableHead className="relative">`.
- **Sticky header**: `TableHead` base có sẵn `sticky top-0 z-10 bg-slate-50` — KHÔNG bọc `<Table>` trong `overflow-x-auto` riêng (overflow-x ngầm set overflow-y → tạo scroll container mới → sticky hỏng). Dùng **một** `overflow-auto` ở container ngoài.
- **Cột đầu sticky-left**: header `sticky left-0 z-20 bg-slate-50`; cell `sticky left-0 z-10` + **nền đặc** (theo trạng thái chọn/nhóm, vd `bg-blue-50`/`bg-white`) — giữ context khi scroll ngang trên phone.
- **Scroll ngang**: container `flex-1 min-h-0 overflow-auto` → thanh cuộn ngang ở đáy màn hình.

## 8. Typography (2 cỡ)
| Vị trí | Class |
|---|---|
| Header cột | `text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap` · nền `bg-slate-50` |
| Cell dữ liệu | `px-2 py-1 text-[10px] whitespace-nowrap` |
| Mã / ID | thêm `font-mono font-semibold` |
| Số lượng | thêm `font-semibold tabular-nums` |
| Đơn vị phụ (thùng, pl…) | thêm `text-slate-400` |
| Empty | `<span className="text-slate-300">—</span>` |

## 9. Không wrap text — bắt buộc
**Mọi `<TableHead>` và `<TableCell>` phải có `whitespace-nowrap`** — không ngoại lệ. Thiếu → text xuống dòng → row cao bất thường → vỡ layout. Nội dung dài → `truncate` + `max-w-[Npx]`. **Không ẩn cột trên mobile** (`hidden sm:table-cell` bị CẤM) — scroll ngang thay vì vỡ. Không hiển thị thiếu thông tin (kể cả dữ liệu dài).

## 10. Màu row theo trạng thái — helper `@/lib/rowStatus`
KHÔNG fill nền — chỉ tô **màu chữ** + gạch ngang khi hoàn thành. Mỗi module export `<module>Key(record): RowStatusKey` (`completed` xanh+gạch · `full` xanh · `scanDone` hồng · `inProgress` cam · `assigned` xanh lá · `paused` đỏ · `pending` xám).
```tsx
import { rowText, statusText } from '@/lib/rowStatus'
<TableRow className={`cursor-pointer ${rowText(xxxKey(item))} ${selected ? 'bg-sky-50' : ''}`}>
```
**ĐỒNG BỘ MÀU CẢ ROW (đừng phá):**
- Cell **KHÔNG override màu** value → kế thừa màu row. Đừng thêm `text-slate-700`/`text-blue-600`/`text-green-600`… (lỗi cũ làm lệch màu dòng).
- Chỉ tô khi **cảnh báo semantic** (vd Thùng KH **đỏ** `text-red-600` khi thực nhập `<` kế hoạch). Đơn vị phụ `text-slate-400`, dash `text-slate-300`, mã phụ `opacity-80`.
- **Header trang detail (mọi cấp) kế thừa cùng màu**: `className={statusText(xxxKey(record))}`.

**Nhóm dòng (vd theo lệnh TMS) — đóng khung như card:** cả cụm nền `bg-slate-50`; dòng đầu `[&_td]:border-t [&_td]:!border-t-slate-300`, dòng cuối `[&_td]:!border-b-slate-300`; chèn hàng trống 10px giữa các cụm (`<tr><td colSpan={N} className="p-0 border-0"><div className="h-2.5"/></td></tr>`).

## 11. Cột trạng thái = Status badge (Manhattan)
Trạng thái workflow hiển thị bằng `<Badge>` pill thành **cột riêng** (không chỉ tô màu dòng), song song với row-color:
```tsx
<TableCell className="px-2 py-1 whitespace-nowrap">
  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_BADGE[item.status]}`}>{STATUS_LABEL[item.status]}</span>
</TableCell>
```

## 12. Cột Tạo / Sửa (audit — bắt buộc với masterdata)
```tsx
<TableCell className="px-2 py-1 whitespace-nowrap">
  {item.created_at ? (
    <div className="leading-tight">
      <div className="text-[10px] text-slate-600">{item.created_by ?? <span className="text-slate-300">—</span>}</div>
      <div className="text-[9px] text-slate-400">{formatTimestampDate(item.created_at, true)}</div>
    </div>
  ) : <span className="text-slate-300">—</span>}
</TableCell>
{/* cột Sửa tương tự với updated_by / updated_at */}
```
- `formatTimestampDate(ts, true)` → `dd-MM-yy` (compact); `formatTimestampTime(ts)` → `HH:mm:ss`. Import từ `@/utils/formatters`.
- Ngày date-only (`import_date`…) → `formatDate()`. Tiêu đề trang dùng `EEEE, dd-MM-yyyy` (locale `vi`).
- **Tên hàng**: `material?.short_name ?? material_code_raw ?? '—'` (KHÔNG dùng `custom_short_name`).

## 13. Sort client-side (Gate pattern) — tie-break nhiều cấp
```ts
const displayItems = [...filtered].sort((a, b) => {
  if (a.date !== b.date) return a.date > b.date ? -1 : 1        // date DESC
  const vta = a.vehicle_type ?? '￿', vtb = b.vehicle_type ?? '￿'
  if (vta !== vtb) return vta < vtb ? -1 : 1                    // ASC, null xuống cuối
  return a.registration_number - b.registration_number
})
```

## 14. Filter persistence — bắt buộc mọi list page
Mọi filter state (search, date, dropdown…) lưu `useWmsFilterStore` (`frontend/src/stores/wmsFilterStore.ts`) — KHÔNG `useState` thuần (mất khi navigate). Thêm interface + setter, key theo module (`inbound`, `outbound`, `inventory`…). Density `localStorage['<module>_density']`; cột `'<module>_col_widths'`.
- **Nhớ filter theo TỪNG USER — tự động, KHÔNG cần code thêm:** `scopedPersist.ts` (import side-effect ở `main.tsx`) gắn key persist theo `user.id` (`wms-filters-v10:<uid>` + `wms-saved-views:<uid>`); đổi user → reset default rồi nạp filter riêng của user đó. ⇒ Field mới chỉ cần khai trong slice của `wmsFilterStore` là **tự được nhớ riêng từng user**. Đừng tự gắn `localStorage`/`useState` cho filter (sẽ dùng chung giữa các user). Mỗi field thêm phải có default trong `initialFilters()` (để reset khi đổi user) — vd `inbound` dùng `INBOUND_DEFAULT`.

## 15. Trang Detail nghiệp vụ
- Đóng khung card như list. Header **kế thừa màu** `statusText(<module>Key(r))` trên mã/tiêu đề.
- Mỗi khối = **section-band**: bar `bg-slate-100 border-b` + accent `bg-sky-500` + tiêu đề IN HOA + Action menu riêng.
- Dùng chung `<SummaryBand>` với list. Mỗi bảng con áp lại skill này.
- Layout 20/80: header `maxHeight:'22vh'` overflow-y-auto; vùng bảng `flex-1 min-h-0 overflow-auto pb-20 lg:pb-4`.

## 16. Detail Sheet (right slide-in) — CHỈ cho masterdata xem nhanh
(Detail nghiệp vụ dùng trang carded ở mục 15, KHÔNG dùng Sheet này.) Click row → Sheet trượt phải; click lại → đóng. `<SheetContent side="right" className="w-80 sm:w-96 p-0 flex flex-col">`. Helper `DRow` (label `w-28 shrink-0 text-slate-400` + value). Cell action phải `onClick={e => e.stopPropagation()}`.

## 17. Dropdown / dialog — bẫy hay gặp
- Dropdown trong table cell bị che: wrapper ngoài table **không** `overflow-hidden`.
- Table trong dialog bị cắt: wrapper `overflow-x-auto border rounded-lg` + table `min-w-max`.
- **⭐ Dropdown/popover MỞ RA BỊ CHE trong Dialog (lỗi HAY GẶP — gốc rễ):** base `DialogContent` (shadcn) có sẵn **`max-h-[calc(100dvh-2rem)] overflow-y-auto` + `translate` (transform)**. `overflow` cắt mọi con `absolute`; `transform` khiến cả con `position:fixed` ĐẶT BÊN TRONG cũng bị cắt (transform tạo containing-block cho fixed). ⇒ panel `absolute`/`fixed` nằm trong DialogContent **chắc chắn bị che**, KHÔNG cứu được bằng `bottom-full`/`z-index`.
  - **CÁCH ĐÚNG (dùng mọi nơi): render panel qua `createPortal(panel, document.body)` + `position:fixed` tính theo `trigger.getBoundingClientRect()`** (thoát mọi overflow/transform). Mẫu chuẩn: `components/shared/MultiSelectFilter.tsx` (đã portal hoá). Hoặc dùng Radix Popover/Select (tự portal).
  - Khi portal trong **modal Dialog (Radix)**: panel ở body = "ngoài" content → (a) **`pointer-events-auto` trên panel BẮT BUỘC** — Radix modal set `pointer-events:none` lên `<body>` (vô hiệu mọi thứ ngoài dialog), panel portal kế thừa `none` ⇒ **HIỆN nhưng KHÔNG bấm được** (triệu chứng dễ nhầm là "bị che"); (b) `onPointerDown={e=>e.stopPropagation()}` để Radix DismissableLayer KHÔNG đóng dialog; (c) `z-[60]` (> dialog z-50) để nổi trên content; (d) outside-click tự check cả `triggerRef` lẫn `panelRef` (panel không còn là con của trigger); (e) recompute vị trí khi `scroll`(capture)/`resize`; (f) **ô search có `autoFocus` sẽ bị Radix focus-trap GIẬT** → trong dialog dùng `searchable={false}` (hoặc danh sách ít). 
  - **Bài học: KHÔNG tự cuộn (overflow) bao quanh form chứa dropdown rồi mong dropdown nổi — overflow/transform của container LUÔN cắt. Dropdown phải portal ra body.**

## 17b. Nút icon inline trong cell (chuẩn kích thước — dùng chung mọi module)
Nút thao tác nhanh trong cell (vd QR "Thêm pallet", icon nhỏ): **icon `h-3.5 w-3.5`** + nút `px-1.5 py-1 rounded` (đủ to cân đối, dễ bấm trên tablet). KHÔNG dùng `h-2.5`/`px-1 py-0.5` (quá nhỏ). Nút phải `onClick={e => e.stopPropagation()}` (hoặc handler tự stopPropagation) để không kích hoạt click-row. Nút mở luồng quét QR ngay trên list → mở **overlay/popup** (vd `InboundScanSheetById`), KHÔNG điều hướng sang trang chi tiết (giữ nguyên giao diện danh sách).

## 18. Phân quyền + loading (bắt buộc mọi nút action)
- Mọi nút gọi API write bọc `can(perms, 'module', 'action')` (mỗi action = 1 permission riêng, không gộp `manage`). `perms` từ `useAuthStore(s => s.user)`.
- Mọi button gọi API: `disabled={saving}` + text phản hồi. Bulk action chạy song song `Promise.all(ids.map(...))`. Lỗi API: banner đỏ inline (không chỉ console).

## 19. Responsive bắt buộc — test PC + Tablet + Phone
Popover/sheet không tràn màn 360px; toolbar co giãn (search `flex-1`, nhãn phụ `hidden sm:inline`).

## Checklist tạo/sửa list page (Manhattan)
- [ ] Card trên canvas xám (`sm:p-3` + panel trắng bo góc, KHÔNG `overflow-hidden`)
- [ ] Toolbar (Search + FilterSheetButton + SavedViews + density + action) + FilterBar (hàng 2, `defs`) + SummaryBand
- [ ] Filter ngày = `daterange`; sentinel `'__all__'`; state → `useWmsFilterStore`
- [ ] Container `overflow-auto` duy nhất (KHÔNG bọc thêm `overflow-x-auto`)
- [ ] Bảng nghiệp vụ: `table-fixed` + `useColumnResize` + colgroup + kẻ cột + tay kéo + cột đầu sticky-left
- [ ] Header `text-[9px]…`; Cell `text-[10px]…`; **whitespace-nowrap mọi cell**; không ẩn cột mobile
- [ ] Row màu `rowText(xxxKey(item))` (chữ, không fill); cell KHÔNG override màu; chỉ tô khi cảnh báo semantic
- [ ] Cột Status badge (pill) riêng; nhóm dòng đóng khung nếu có
- [ ] Cột Tạo/Sửa (masterdata); footer đếm `1–N / N`; cột action `stopPropagation`
- [ ] Nút action bọc `can(perms,…)` + `disabled={saving}`; lỗi banner đỏ inline
- [ ] (Tùy) Pane phải + Live Tiles nếu có ảnh/thao tác nhanh
- [ ] Detail: card + section-band + SummaryBand chung + header kế thừa màu trạng thái
- [ ] Test responsive PC/tablet/phone + (nếu có mutation) realtime 4 case
- [ ] `tsc --noEmit` + `npm run build` trước khi push
