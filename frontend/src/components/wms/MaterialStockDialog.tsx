// TRA TỒN KHO CỦA MỘT MÃ — gom theo %Date + VỊ TRÍ, mở ra từng tem pallet.
//
// Tách khỏi `pages/wms/OutboundPrepare.tsx` ngày 12/09 (user: "cần có nút kiểm tra được tồn kho,
// vị trí tương tự như bên Chuẩn bị hàng" ở trang Việc cần làm). Chép bản thứ hai thì hai màn sẽ
// TRẢ LỜI KHÁC NHAU cho cùng câu hỏi "mã này còn ở đâu" ngay lần sửa thứ nhất — đúng khuôn lỗi
// "4 bản chép tay" của luật luân chuyển hồi 14/08. Nội dung giữ NGUYÊN bản Chuẩn bị hàng.
//
// Thứ tự dòng = đúng thứ tự NÊN LẤY: %Date thấp trước → hàng thường trước pallet QA giữ → ô ÍT
// hàng nhất trước (dọn hàng lẻ) → mã ô. Cùng luật với gợi ý FEFO của bảng chuẩn bị hàng.
import { useMemo, useState, Fragment } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useInventoryByMaterial, usePctBands, type ItemInventoryEntry } from '@/api/hooks'
import { pctDateCls } from '@/utils/pctDateBands'
import { qtyEntryText, qtyUnitLabel, type MatUnits } from '@/utils/qtyUnits'

export function MaterialStockDialog({ materialId, materialCode, materialName, mat, warehouseId, onClose }: {
  materialId: string; materialCode: string; materialName: string
  mat?: MatUnits | null; warehouseId: string | undefined; onClose: () => void
}) {
  const { data: inv = [], isLoading } = useInventoryByMaterial(materialId, warehouseId)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const pctBands = usePctBands()

  type Agg = { key: string; pct_date: number | null; location_code: string | null; is_qa: boolean; cartons: number; entries: ItemInventoryEntry[] }
  const rows: Agg[] = useMemo(() => {
    const map = new Map<string, Agg>()
    for (const e of inv) {
      const q = !!e.qa_status
      const k = `${e.pct_date ?? 'n'}|${e.location_code ?? ''}|${q}`
      const r = map.get(k)
      if (r) { r.cartons += e.available; r.entries.push(e) }
      else map.set(k, { key: k, pct_date: e.pct_date, location_code: e.location_code, is_qa: q, cartons: e.available, entries: [e] })
    }
    return [...map.values()].sort((a, b) => {
      const pa = a.pct_date ?? Infinity, pb = b.pct_date ?? Infinity
      if (pa !== pb) return pa - pb
      if (a.is_qa !== b.is_qa) return a.is_qa ? 1 : -1
      if (a.cartons !== b.cartons) return a.cartons - b.cartons
      return (a.location_code ?? '').localeCompare(b.location_code ?? '')
    })
  }, [inv])
  const total = useMemo(() => inv.reduce((s, e) => s + e.available, 0), [inv])

  function toggle(k: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm sm:max-w-md p-0">
        <DialogHeader className="px-4 pt-4 pb-2 border-b">
          <DialogTitle className="text-sm font-semibold">
            <span className="font-mono">{materialCode}</span> · {materialName}
          </DialogTitle>
          <p className="text-xs text-slate-500 mt-0.5">Tồn kho theo %Date · lấy thấp trước · {inv.length} pallet · {qtyEntryText(total, mat)} {qtyUnitLabel(mat)}</p>
        </DialogHeader>
        <div className="overflow-auto" style={{ maxHeight: '60vh' }}>
          {isLoading ? (
            <div className="p-4 space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />)}</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-slate-400 text-sm">Không còn tồn kho trong kho này</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-[9px] font-medium text-slate-500 px-3 py-1.5">%Date</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-3 py-1.5">Vị trí</TableHead>
                  <TableHead className="text-[9px] font-medium text-blue-500 px-3 py-1.5 text-right">Khả dụng</TableHead>
                  <TableHead className="w-6 px-2 py-1.5" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const open = expanded.has(row.key)
                  return (
                    <Fragment key={row.key}>
                      <TableRow className={`cursor-pointer ${row.is_qa ? 'bg-purple-50 hover:bg-purple-100' : 'hover:bg-slate-50'}`} onClick={() => toggle(row.key)}>
                        <TableCell className="px-3 py-1.5">
                          <div className="flex items-center gap-1.5">
                            {row.pct_date !== null
                              ? <span className={`text-xs font-bold tabular-nums ${pctDateCls(row.pct_date, pctBands)}`}>{row.pct_date}%</span>
                              : <span className="text-[10px] text-slate-400">Chưa có</span>}
                            {row.is_qa && <span className="text-[9px] font-medium text-purple-700 bg-purple-100 rounded px-1.5 py-0.5">QA giữ</span>}
                          </div>
                        </TableCell>
                        <TableCell className="px-3 py-1.5"><span className="text-[10px] font-mono text-slate-600">{row.location_code ?? '—'}</span></TableCell>
                        <TableCell className="px-3 py-1.5 text-right whitespace-nowrap">
                          <span className={`text-[10px] font-semibold tabular-nums ${row.is_qa ? 'text-purple-700' : ''}`}>{qtyEntryText(row.cartons, mat)}</span>
                          <span className="text-[9px] text-slate-400 ml-0.5">{qtyUnitLabel(mat)}</span>
                          <div className="text-[9px] text-slate-400">{row.entries.length} pl</div>
                        </TableCell>
                        <TableCell className="px-2 py-1.5 text-slate-400">{open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</TableCell>
                      </TableRow>
                      {open && row.entries.map(e => (
                        <TableRow key={e.id} className={row.is_qa ? 'bg-purple-50/60' : 'bg-slate-50'}>
                          <TableCell className="px-3 py-1 pl-7" colSpan={2}><span className="font-mono text-[10px] font-semibold text-slate-600">{e.pallet_code}</span></TableCell>
                          <TableCell className="px-3 py-1 text-right whitespace-nowrap"><span className="text-[10px] font-semibold tabular-nums text-blue-700">{qtyEntryText(e.available, mat)}</span><span className="text-[9px] text-slate-400 ml-0.5">{qtyUnitLabel(mat)}</span></TableCell>
                          <TableCell className="px-2 py-1" />
                        </TableRow>
                      ))}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
