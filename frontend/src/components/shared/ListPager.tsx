// Phân trang list page — CHUẨN DÙNG CHUNG cho MỌI trang (user chốt 28/07: "tránh mỗi trang
// một kiểu"). Trước đó có 3 biến thể rời: Tồn kho/Nhập kho (nút chữ giữa bảng), Dữ liệu bên
// ngoài (mũi tên nhỏ ghim mép phải, nhãn "Mỗi trang"), TMS Kế hoạch ("‹ Trước · Trang x/y").
//
// Trang mới BẮT BUỘC dùng 2 mảnh dưới đây, KHÔNG tự viết nút phân trang:
//   <PagerNav>    — điều hướng, đặt NGAY DƯỚI BẢNG, bên trong vùng cuộn
//   <ListFooter>  — đếm bản ghi + chọn dòng/trang, đặt NGOÀI vùng cuộn (dính đáy card)
// Thêm ô "Trang x/y" vào SummaryBand khi có nhiều trang (xem skill table-format).

/** Lựa chọn dòng/trang — GIỐNG NHAU ở mọi trang. Mặc định thì tuỳ trang (dòng thưa 100, dòng dày 500). */
export const PAGE_SIZE_OPTIONS = [50, 100, 200, 500, 1000] as const

export function PagerNav({ page, totalPages, onPage }: {
  page: number
  totalPages: number
  onPage: (p: number) => void
}) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-3 py-3 border-t bg-white">
      <button
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="px-3 py-1 text-xs rounded border disabled:opacity-40 hover:bg-slate-50">
        ← Trước
      </button>
      <span className="text-xs text-slate-500 tabular-nums">{page} / {totalPages}</span>
      <button
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        className="px-3 py-1 text-xs rounded border disabled:opacity-40 hover:bg-slate-50">
        Sau →
      </button>
    </div>
  )
}

/**
 * Footer đếm bản ghi + chọn dòng/trang.
 * @param unit  danh từ đếm của trang: 'phiếu' | 'pallet' | 'chuyến' | 'dòng'…
 * @param right nội dung phụ căn PHẢI (vd tổng pallet · thùng)
 * @param children chèn ngay sau phần đếm (vd "· 1 đang xem")
 */
export function ListFooter({ page, pageSize, total, unit, onPageSize, right, children }: {
  page: number
  pageSize: number
  total: number
  unit: string
  onPageSize: (n: number) => void
  right?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 flex items-center justify-between gap-3 sm:rounded-b-xl">
      <span className="min-w-0">
        {total > 0
          ? `${((page - 1) * pageSize + 1).toLocaleString('vi-VN')}–${Math.min(page * pageSize, total).toLocaleString('vi-VN')} / ${total.toLocaleString('vi-VN')} ${unit}`
          : `0 ${unit}`}
        {children}
        <label className="ml-3 inline-flex items-center gap-1 text-slate-400">
          <span className="hidden sm:inline">·</span> Dòng/trang:
          <select
            value={pageSize}
            onChange={e => onPageSize(Number(e.target.value))}
            className="h-5 rounded border border-slate-200 bg-white px-1 text-[11px] text-slate-600 tabular-nums cursor-pointer">
            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </span>
      {right && <span className="text-slate-400 shrink-0 text-right">{right}</span>}
    </div>
  )
}
