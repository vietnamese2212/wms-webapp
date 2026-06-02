# Skill: Table Format (WMS Standard)

## Cấu trúc layout bắt buộc

```tsx
{/* Container ngoài — list page */}
<div className="flex flex-col h-full">
  <div className="border-b bg-white px-3 py-2 shrink-0">{/* filter bar */}</div>
  <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
    <Table className="min-w-full">
```

> **QUAN TRỌNG — sticky header**: KHÔNG bọc `<Table>` trong `<div className="overflow-x-auto">`.
> CSS quirk: `overflow-x: auto` ngầm set `overflow-y: auto`, tạo ra scroll container mới → `sticky top-0` bám vào container đó (không scroll dọc) thay vì bám vào ngoài cùng → header KHÔNG freeze.
> Dùng **một** `overflow-auto` duy nhất trên container ngoài — nó xử lý cả scroll dọc lẫn ngang. `min-w-full` đảm bảo bảng rộng hơn container sẽ tự scroll ngang.

- `TableHead` base component tự có `sticky top-0 z-10 bg-slate-50` — không thêm thủ công

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

## Màu row theo trạng thái — TEXT color, không dùng background

```tsx
const ROW_TEXT: Record<Status, string> = {
  PENDING:   'hover:bg-slate-50',
  CALLED:    'text-[#E85AA0] hover:bg-slate-50',   // hồng
  IN:        'text-[#D8891C] hover:bg-slate-50',   // cam
  COMPLETED: 'text-[#4A90D9] line-through hover:bg-slate-50', // xanh + gạch
}
// Áp dụng vào TableRow:
<TableRow className={`cursor-pointer ${ROW_TEXT[item.status]} ${selected?.id === item.id ? 'ring-1 ring-inset ring-blue-400' : ''}`}>
```

**Quy tắc override màu cell:**
- Cell cần giữ màu riêng (không bị nhuộm theo row): thêm `text-slate-600` / `text-slate-700` vào cell
- Cell muốn theo màu row: không thêm gì (kế thừa)
- Cell có màu cố định (link, badge): dùng inline style hoặc class explicit

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

- **Multi-select checkbox**: `MultiSelectFilter` từ `@/components/shared/MultiSelectFilter` — dùng khi có ≥2 option cùng loại
- **Single select**: `<Select>` shadcn — sentinel `'__all__'` thay vì `''` (Radix crash với `value=""`)
- **Date range bug**: khi có cả `dateFrom` và `dateTo`, gửi `date_from` + `date_to` (không gửi `date`); backend dùng `gte/lte`. Nếu chỉ có `date`, gửi `date` → backend `eq`.

## Checklist khi tạo table mới

- [ ] Container: `overflow-auto` duy nhất — KHÔNG bọc thêm `overflow-x-auto` (vỡ sticky)
- [ ] Header: `text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap`
- [ ] Cell: `px-2 py-1 text-[10px] whitespace-nowrap`
- [ ] Row status dùng text color (ROW_TEXT), không dùng background
- [ ] Cell cần màu riêng → thêm `text-slate-600/700` explicit
- [ ] Cột action cuối cùng, `onClick={e => e.stopPropagation()}`
- [ ] Cột Tạo + Sửa (created_by/updated_by + date) — bắt buộc với masterdata
- [ ] Empty state: `<span className="text-slate-300">—</span>`
- [ ] Stats bar dùng `displayItems` (đã filter), không dùng raw `items`