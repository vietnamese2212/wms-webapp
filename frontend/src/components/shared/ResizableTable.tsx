// Bảng chuẩn Manhattan RÚT GỌN dùng chung (skill table-format mục 7): table-fixed + colgroup
// + kéo giãn cột (useColumnResize, lưu localStorage) + sticky header (TableHead base) + cột ĐẦU
// sticky-left + kẻ cột. Cột ĐỘNG (hiện/ẩn theo dữ liệu) → caller đặt key={signature} để remount
// khi bộ cột đổi (useColumnResize chỉ init widths 1 lần theo mount).
// Lưu ý bẫy: KHÔNG thêm 'relative' vào TableHead — base đã sticky (sticky tự làm mốc cho
// tay kéo absolute); thêm relative sẽ đè sticky (memory sticky-header-relative-trap).
import type { ReactNode } from 'react'
import { Table, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useColumnResize } from '@/components/shared/useColumnResize'

export interface RtColDef {
  id: string
  label: string
  w: number                       // độ rộng mặc định (px) — user kéo chỉnh, lưu theo storageKey
  align?: 'right' | 'center'
}

export function ResizableTable({ storageKey, cols, children }: {
  storageKey: string              // key localStorage lưu độ rộng (nên gắn signature bộ cột)
  cols: RtColDef[]
  children: ReactNode             // <TableBody> — cell tự theo colgroup (table-fixed)
}) {
  const { widths, startResize, totalWidth } = useColumnResize(storageKey, cols.map(c => c.w))
  return (
    <Table
      className="table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden"
      style={{ width: totalWidth, minWidth: '100%' }}
    >
      <colgroup>{widths.map((w, i) => <col key={cols[i]?.id ?? i} style={{ width: w }} />)}</colgroup>
      <TableHeader>
        <TableRow className="bg-slate-50">
          {cols.map((c, i) => (
            <TableHead
              key={c.id}
              className={`text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${
                c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center px-1' : ''
              } ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}
            >
              {c.label}
              {i > 0 && (
                <span
                  onPointerDown={e => startResize(i, e)}
                  onClick={e => e.stopPropagation()}
                  className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70"
                  title="Kéo để chỉnh độ rộng cột"
                />
              )}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      {children}
    </Table>
  )
}
