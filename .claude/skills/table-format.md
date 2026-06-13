# Skill: Table Format (WMS Standard)

> **Chuẩn tổng thể UI (card, toolbar, FilterBar, SavedViews, SummaryBand, header tối, Pane…) ở `CLAUDE.md` mục "UI Style — Manhattan" + "Checklist chuyển 1 module".** File này = chi tiết riêng cho TABLE. Module mẫu: `Inbound.tsx` / `InboundDetail.tsx`.

## Cấu trúc layout bắt buộc (Manhattan)

```tsx
{/* List page = card trắng trên canvas xám */}
<div className="flex flex-col h-full sm:p-3">
 <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
  <div className="border-b bg-white px-3 py-2 shrink-0 sm:rounded-t-xl">{/* toolbar + FilterBar */}</div>
  <SummaryBand tiles={[...]} />
  <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">   {/* MỘT overflow duy nhất */}
    <Table className="...">...</Table>
  </div>
  {/* footer đếm bản ghi: 1–N / N */}
 </div>
</div>
```

> **Sticky header**: KHÔNG bọc `<Table>` trong `<div className="overflow-x-auto">` riêng (overflow-x ngầm set overflow-y → tạo scroll container mới → `sticky top-0` hỏng). Dùng **một** `overflow-auto` duy nhất ở container ngoài (lo cả dọc + ngang).
- `TableHead` base có sẵn `sticky top-0 z-10 bg-slate-50` — không thêm thủ công.

**2 kiểu bảng:**
- **Đơn giản** (masterdata ít cột): `<Table className="min-w-full">`.
- **Manhattan list (kéo giãn cột)** — mặc định cho list nghiệp vụ: `table-fixed` + `useColumnResize('<module>_col_widths', defaults)` (`@/components/shared/useColumnResize`) + `<colgroup>{widths.map(w=><col style={{width:w}}/>)}` + `style={{ width: totalWidth, minWidth: '100%' }}` (fill màn khi dư, scroll khi thiếu). Kẻ cột rõ: `[&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden`. Tay kéo = `<span onPointerDown={e=>startResize(i,e)} className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70">` trong mỗi `<TableHead className="relative">`. Cột định danh đầu: header `sticky left-0 z-20 bg-slate-50`, cell `sticky left-0 z-10` + nền đặc theo trạng thái chọn/nhóm.

## Typography chuẩn

| Vị trí | Class |
|---|---|
| Header cột | `text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap` |
| Cell dữ liệu | `px-2 py-1 text-[10px] whitespace-nowrap` |
| Mã / ID | thêm `font-mono font-semibold` |
| Số lượng | thêm `font-semibold tabular-nums` |
| Đơn vị phụ | thêm `text-slate-400` |
| Empty | `<span className="text-slate-300">—</span>` |

## Không wrap text — bắt buộc

**Mọi `<TableHead>` và `<TableCell>` đều phải có `whitespace-nowrap`** — không có ngoại lệ.

- Thiếu `whitespace-nowrap` → text xuống dòng → row cao bất thường → layout vỡ
- Nội dung dài cần rút ngắn → dùng `truncate` (bao gồm `whitespace-nowrap` + `overflow-hidden`) kết hợp `max-w-[Npx]`
- Không dùng `max-w` để giới hạn cột nếu không có `truncate` — text sẽ vẫn wrap

## Cột Tạo / Sửa (audit columns — bắt buộc với mọi masterdata table)

```tsx
// Hiển thị stacked: người + ngày, compact
<TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Tạo</TableHead>
<TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Sửa</TableHead>

// Cell:
<TableCell className="px-2 py-1 whitespace-nowrap">
  {item.created_at ? (
    <div className="leading-tight">
      <div className="text-[10px] text-slate-600">{item.created_by ?? <span className="text-slate-300">—</span>}</div>
      <div className="text-[9px] text-slate-400">{formatTimestampDate(item.created_at, true)}</div>
    </div>
  ) : <span className="text-slate-300">—</span>}
</TableCell>
<TableCell className="px-2 py-1 whitespace-nowrap">
  {item.updated_at ? (
    <div className="leading-tight">
      <div className="text-[10px] text-slate-600">{item.updated_by ?? <span className="text-slate-300">—</span>}</div>
      <div className="text-[9px] text-slate-400">{formatTimestampDate(item.updated_at, true)}</div>
    </div>
  ) : <span className="text-slate-300">—</span>}
</TableCell>
```

- `formatTimestampDate(ts, true)` → `dd-MM-yy` (compact), import từ `@/utils/formatters`
- `formatTimestampTime(ts)` → `HH:mm:ss` — dùng trong sheet detail (không phải table)
- Detail sheet hiển thị đầy đủ: `formatTimestampDate(ts) + ' ' + formatTimestampTime(ts)`

## Màu row theo trạng thái — dùng helper chung `@/lib/rowStatus`

KHÔNG fill nền — chỉ tô **màu chữ** + gạch ngang khi hoàn thành. Mỗi module export `<module>Key(record): RowStatusKey` (map trạng thái → key: `completed`/`full`/`scanDone`/`inProgress`/`assigned`/`paused`/`pending`).

```tsx
import { rowText, statusText } from '@/lib/rowStatus'
<TableRow className={`cursor-pointer ${rowText(xxxKey(item))} ${selected ? 'bg-sky-50' : ''}`}>
```

**ĐỒNG BỘ MÀU CẢ ROW (bắt buộc — đừng phá):**
- Cell **KHÔNG override màu** value → để kế thừa màu row. **Đừng** thêm `text-slate-700` / `text-blue-600` / `text-green-600`… vào giá trị (đây là lỗi cũ làm cả dòng lệch màu).
- Chỉ tô màu khi là **cảnh báo semantic**, vd Thùng KH **đỏ** (`text-red-600`) khi thực nhập `<` kế hoạch.
- Đơn vị phụ (thùng/pl) `text-slate-400`, dash `text-slate-300`, mã phụ làm mờ bằng `opacity-80` (vẫn kế thừa màu) — chấp nhận là secondary.
- **Header trang detail (mọi cấp) kế thừa cùng màu**: `className={statusText(xxxKey(record))}`.

**Nhóm dòng (vd theo lệnh TMS) — đóng khung như card:** cả cụm nền `bg-slate-50`; **dòng đầu** `[&_td]:border-t [&_td]:!border-t-slate-300`, **dòng cuối** `[&_td]:!border-b-slate-300`; chèn **hàng trống 10px** giữa các cụm (`<tr><td colSpan={N} className="p-0 border-0"><div className="h-2.5"/></td></tr>`). Dòng lẻ giữ nguyên.

## Cột trạng thái (TT / Status badge)

```tsx
// Badge không bị ảnh hưởng bởi màu row:
<TableCell className="px-2 py-1 whitespace-nowrap">
  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_BADGE[item.status]}`}>
    {STATUS_LABEL[item.status]}
  </span>
</TableCell>
```
Filter cần gộp vào 1 nút để tránh làm rối
## Booking icon (Gate Registration)

```tsx
function bookingIcon(reg: GateRegistration) {
  if (!reg.booking_slot_from || ['IN', 'COMPLETED'].includes(reg.status)) return null
  const now = Date.now()
  const slotFrom = new Date(`${reg.date}T${reg.booking_slot_from}+07:00`).getTime()
  const slotTo   = reg.booking_slot_to
    ? new Date(`${reg.date}T${reg.booking_slot_to}+07:00`).getTime()
    : slotFrom + 3600_000
  if (now > slotTo)    return <XCircle   className="h-3 w-3 text-red-500 shrink-0 inline-block" />
  if (now >= slotFrom) return <HelpCircle className="h-3 w-3 text-red-500 shrink-0 inline-block" />
  return null
}
```

## Sort client-side (Gate pattern)

```ts
const displayItems = (() => {
  const filtered = fTypes.length > 0
    ? items.filter(r => fTypes.includes(r.type ?? ''))
    : items
  return [...filtered].sort((a, b) => {
    if (a.date !== b.date) return a.date > b.date ? -1 : 1      // date DESC
    const vta = a.vehicle_type ?? '￿'; const vtb = b.vehicle_type ?? '￿'
    if (vta !== vtb) return vta < vtb ? -1 : 1                  // type ASC
    const bfa = a.booking_slot_from ?? '￿'; const bfb = b.booking_slot_from ?? '￿'
    if (bfa !== bfb) return bfa < bfb ? -1 : 1                  // booking ASC
    return a.registration_number - b.registration_number        // number ASC
  })
})()
```

## Filter chuẩn

- **List page → `FilterBar`** (`@/components/shared/FilterBar`) declarative `defs` (multi/single/daterange/text). KHÔNG dùng MultiSelectFilter/Select rời cho filter list nữa. Mobile tự gom thành nút "Lọc" + sheet (`FilterSheetButton`). Ngày luôn `daterange`. Xem CLAUDE.md "UI Style".
- **Dialog/form** (không phải filter của list): vẫn dùng `MultiSelectFilter` / `<Select>` shadcn — sentinel `'__all__'` thay vì `''` (Radix crash với `value=""`).
- **Backend date range**: gửi `date_from` + `date_to` → `gte`/`lte`.
- Filter state lưu `useWmsFilterStore`; bộ lọc đặt tên qua `SavedViews` + `useSavedViewsStore`.

## Detail Sheet (right slide-in) — cho MASTERDATA xem nhanh

> Detail **nghiệp vụ** (Inbound/Outbound…) dùng **trang carded đầy đủ** (section-band + SummaryBand + header kế thừa màu trạng thái), KHÔNG dùng Sheet này. Sheet dưới đây dành cho masterdata xem nhanh tại chỗ.

Pattern: click row → Sheet trượt từ phải, hiển thị chi tiết đầy đủ. Click lại row đã chọn → đóng.

**Import:**
```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
```

**DRow helper** — render label + value (khai báo ở module level):
```tsx
function DRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-xs py-1 border-b border-slate-100 last:border-0">
      <span className="w-28 shrink-0 text-slate-400">{label}</span>
      <span className="font-medium text-slate-700 break-words min-w-0">
        {value ?? <span className="text-slate-300">—</span>}
      </span>
    </div>
  )
}
```

**State + TableRow:**
```tsx
const [detailItem, setDetailItem] = useState<ItemType | null>(null)

// TableRow — clickable, highlight khi chọn:
<TableRow
  className={`cursor-pointer hover:bg-slate-50 ${detailItem?.id === item.id ? 'bg-blue-50 hover:bg-blue-50' : ''}`}
  onClick={() => setDetailItem(prev => prev?.id === item.id ? null : item)}
>

// Cell action (delete/edit) — PHẢI có stopPropagation:
<TableCell className="px-2 py-1" onClick={e => e.stopPropagation()}>
```

**Sheet JSX** (đặt cuối return, sau Dialogs):
```tsx
<Sheet open={!!detailItem} onOpenChange={open => !open && setDetailItem(null)}>
  <SheetContent side="right" className="w-80 sm:w-96 p-0 flex flex-col">
    {detailItem && (
      <>
        <SheetHeader className="px-4 py-3 border-b bg-slate-50 shrink-0">
          <div className="flex items-start gap-2 pr-6">
            <div className="min-w-0">
              <SheetTitle className="text-sm font-mono">{detailItem.code}</SheetTitle>
              <p className="text-xs text-slate-500 mt-0.5 truncate">{detailItem.name}</p>
            </div>
          </div>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          <div>
            <p className="text-[10px] font-medium text-slate-500 mb-1.5">Section title</p>
            <div className="space-y-0">
              <DRow label="Field" value={detailItem.field} />
            </div>
          </div>
          {/* Audit section */}
          <div>
            <p className="text-[10px] font-medium text-slate-500 mb-1.5">Lịch sử</p>
            <div className="space-y-0">
              <DRow label="Tạo lúc" value={detailItem.created_at
                ? `${formatTimestampDate(detailItem.created_at)} ${formatTimestampTime(detailItem.created_at)}`
                : null} />
              <DRow label="Sửa lúc" value={detailItem.updated_at
                ? `${formatTimestampDate(detailItem.updated_at)} ${formatTimestampTime(detailItem.updated_at)}`
                : null} />
            </div>
          </div>
        </div>
      </>
    )}
  </SheetContent>
</Sheet>
```

**Quy tắc section:**
- Header Sheet: `font-mono` cho code/ID, `text-xs text-slate-500` cho mô tả phụ
- Mỗi nhóm field = 1 `<div>` với `<p text-[10px]>` tiêu đề + `<div space-y-0>` chứa DRow
- `DRow label` width cố định `w-28` — đảm bảo alignment nhất quán
- Timestamp dùng `formatTimestampDate` + `formatTimestampTime` từ `@/utils/formatters`

## Checklist khi tạo/sửa table (Manhattan)

- [ ] List page bọc **card** trên canvas xám (`sm:p-3` + panel trắng bo góc)
- [ ] Toolbar (Search + FilterSheetButton + SavedViews + density + action) + `FilterBar` (hàng 2) + `SummaryBand`
- [ ] Container: `overflow-auto` duy nhất — KHÔNG bọc thêm `overflow-x-auto` (vỡ sticky)
- [ ] Bảng nghiệp vụ: `table-fixed` + `useColumnResize` + colgroup + kẻ cột (`border-r`) + tay kéo header + cột đầu sticky-left
- [ ] Header: `text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap`; Cell: `px-2 py-1 text-[10px] whitespace-nowrap`
- [ ] Row màu = `rowText(xxxKey(item))` (chữ, không fill). **Cell KHÔNG override màu** (kế thừa); chỉ tô khi cảnh báo semantic (vd đỏ khi thiếu KH)
- [ ] Nhóm dòng (nếu có): nền `bg-slate-50` + viền trên/dưới đóng khung + hàng trống 10px ngăn cách
- [ ] Footer đếm bản ghi `1–N / N`
- [ ] Cột action cuối, `onClick={e => e.stopPropagation()}`
- [ ] Cột Tạo + Sửa (created_by/updated_by + date) — bắt buộc với masterdata
- [ ] Empty: `<span className="text-slate-300">—</span>`; Stats/SummaryBand dùng `displayItems` (đã filter)
- [ ] Detail: trang nghiệp vụ = **card + section-band + SummaryBand + header kế thừa màu trạng thái**; masterdata xem nhanh có thể dùng right Sheet (mục dưới)