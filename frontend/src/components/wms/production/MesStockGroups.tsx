// TỒN THEO DATE của MỘT nguyên liệu trong kho chế biến — CÙNG khuôn "Tồn kho theo %Date" của Xuất kho (InventoryModal ở
// OutboundDetail): mỗi dòng một NHÓM (có tem: ngày · vị trí; không tem: lô), %Date tô màu, khả dụng + số tem; bấm ▸ mở từng tem /
// dòng tồn (user 17/11: "1 mã có 200 pallet thì có 200 dòng ư? … có nút expand để nhìn kỹ lưỡng hơn").
// Server gom + xếp + chấm (GET /production/batches/:id/pick-list): hạng 1 ★ = nên lấy trước · Hết hạn = chờ QA duyệt · QA giữ cuối.
// Ở đây CHỈ vẽ — không tự so ngày, không tự xếp.
import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { PalletDetailDialog } from '@/components/shared/PalletDetailDialog'
import { usePctBands } from '@/api/hooks'
import { usePickList, type PickGroup, type PickItem, type PickList, type ExpiryApproval } from '@/api/productionHooks'
import { pctDateCls, type PctBands } from '@/utils/pctDateBands'
import { formatDate } from '@/utils/formatters'
import { qtyNum, matUnitCode } from '@/utils/unitCode'
import { hasEntry, type MatUnits } from '@/utils/qtyUnits'

const pctText = (p: number | null) => (p == null ? '—' : `${Math.floor(p)}%`)
/** ngày dd-mm-yyyy; điện thoại dd-mm-yy để bảng vừa 360 px không cuộn ngang */
function Day({ d }: { d: string | null }) {
  if (!d) return <>—</>
  return <><span className="sm:hidden">{`${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(2, 4)}`}</span><span className="hidden sm:inline">{formatDate(d)}</span></>
}
const TH = 'px-1.5 py-1 font-medium whitespace-nowrap'
const TD = 'px-1.5 py-1.5 whitespace-nowrap'
/** chữ ngắn cho dòng QA duyệt hàng hết hạn */
export function approvalShort(a: ExpiryApproval | null | undefined): { text: string; tone: 'green' | 'amber' | 'red' } | null {
  if (!a) return null
  return a.status === 'APPROVED' ? { text: 'QA đã duyệt', tone: 'green' } : a.status === 'PENDING' ? { text: 'chờ QA duyệt', tone: 'amber' } : { text: 'QA từ chối', tone: 'red' }
}
/** tóm tắt danh sách: "Tồn theo %Date · FEFO · 12 tem · 3 nhóm" */
export function pickSummary(list: PickList, groups: PickGroup[], noun: string): string {
  const n = groups.reduce((t, g) => t + g.count, 0)
  return `${list.principle}${list.required ? ' bắt buộc' : ''} · ${n} ${noun} · ${groups.length} nhóm`
}
/** tóm tắt danh sách GỘP có tem + không tem (18/11): "FEFO · 3 tem · 1 lô · 4 nhóm" — phần bằng 0 bỏ đi */
export function pickSummaryAll(list: PickList, groups: PickGroup[]): string {
  const tems = groups.filter(g => g.kind === 'TEM').reduce((t, g) => t + g.count, 0)
  const lots = new Set(groups.filter(g => g.kind === 'LOT').map(g => `${g.production_date ?? ''}|${g.batch_lot ?? ''}`)).size
  return [`${list.principle}${list.required ? ' bắt buộc' : ''}`, tems ? `${tems} tem` : '', lots ? `${lots} lô` : '', `${groups.length} nhóm`]
    .filter(Boolean).join(' · ')
}
/** mã lô in trên các tem của một nhóm có tem: "lô A" · "lô A, B" · "3 lô" (tem không ghi lô thì bỏ qua) */
function temLotsText(g: PickGroup): string | null {
  if (g.kind !== 'TEM') return null
  const lots = [...new Set(g.items.map(i => String(i.batch ?? '').trim()).filter(Boolean))]
  return !lots.length ? null : lots.length <= 2 ? `lô ${lots.join(', ')}` : `${lots.length} lô`
}

export function MesStockGroups({ groups, dateLabel, mat, bands, selectedId, idOf, onSelect, highlightEntryId, onOpenPallet, limit = 6, testId }: {
  groups: PickGroup[]; dateLabel: string
  /** mã đang xem — ĐVT in MỘT lần ở nhãn cột "Khả dụng", dòng chỉ ghi số (mã có thùng / bao: "N thùng + M") */
  mat: MatUnits | null; bands: PctBands
  /** cửa "Không có tem" chọn LÔ: `idOf` = khoá lô ổn định qua đổi tình trạng; nhóm QA giữ không chọn được */
  selectedId?: string | null; idOf?: (g: PickGroup) => string; onSelect?: (g: PickGroup) => void
  /** tem vừa quét — tô nền trong danh sách mở rộng */
  highlightEntryId?: string | null; onOpenPallet?: (entryId: string) => void
  limit?: number; testId?: string
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [all, setAll] = useState(false)
  const shown = all ? groups : groups.slice(0, limit)
  const toggle = (k: string) => setOpen(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const selectable = !!onSelect
  const cols = selectable ? 6 : 5
  const unit = (n: number) => qtyNum(n, mat)
  const uHead = mat && !hasEntry(mat) && mat.base_unit ? ` (${matUnitCode(mat)})` : ''
  return (
    <div data-testid={testId}>
      <div className="overflow-auto border rounded-lg">
        <table className="w-full">
          <thead><tr className="bg-slate-50 text-[9px] text-slate-500">
            {selectable && <th className="w-6 px-1.5 py-1" />}
            <th className={`${TH} text-left`} title="Hạng lấy (1★ = lấy trước) · ngày theo nguyên tắc luân chuyển"># · {dateLabel}</th>
            <th className={`${TH} text-right`}>%Date</th>
            <th className={`${TH} text-left`}>Vị trí</th>
            <th className={`${TH} text-right text-blue-500`} title="Khả dụng = còn trên tem / lô trừ phần đã giữ chỗ">Còn{uHead}</th>
            <th className="w-6 px-0.5 py-1" />
          </tr></thead>
          <tbody>
            {shown.map(g => {
              const expanded = open.has(g.key)
              const sel = selectable && !!idOf && selectedId === idOf(g) && g.state !== 'QA'
              const canPick = selectable && g.state !== 'QA'
              const a = approvalShort(g.approval)
              const temLots = temLotsText(g)
              const rowCls =g.state === 'QA' ? 'bg-purple-50' : g.state === 'EXPIRED' ? 'bg-red-50/70' : sel ? 'bg-sky-50' : 'hover:bg-slate-50'
              return (
                <Fragment key={g.key}>
                  <tr data-group={g.key} data-state={g.state} data-rank={g.rank ?? ''} aria-selected={sel || undefined}
                    className={`border-t border-slate-100 text-[11px] ${rowCls} ${canPick || !selectable ? 'cursor-pointer' : ''}`}
                    onClick={() => { if (selectable) { if (canPick) onSelect?.(g) } else toggle(g.key) }}>
                    {selectable && (
                      <td className="px-1.5 py-1.5"><input type="radio" readOnly disabled={!canPick} checked={sel} className="h-3.5 w-3.5" aria-label="Chọn lô" /></td>
                    )}
                    <td className={`${TD} tabular-nums`}>
                      {/* hạng gộp vào ô ngày (không cột riêng) — bảng vừa 360 px */}
                      {g.state === 'QA' ? <span className="mr-1"><StatusBadge tone="purple" title={g.qa_name ?? undefined}>QA giữ</StatusBadge></span>
                        : g.state === 'EXPIRED' ? <span className="mr-1"><StatusBadge tone="red">Hết hạn</StatusBadge></span>
                        : g.rank === 1 ? <b className="mr-1 text-green-700">1★</b> : <span className="mr-1 inline-block min-w-[1.1rem] text-slate-500">{g.rank}</span>}
                      <Day d={g.rot_date} />
                      {g.kind === 'LOT' && (
                        <div className="text-[9px] text-slate-500 font-mono leading-tight">{g.batch_lot ? `lô ${g.batch_lot}` : 'không mã lô'}
                          {dateLabel !== 'NSX' && g.production_date && <span className="block">NSX <Day d={g.production_date} /></span>}</div>
                      )}
                      {/* có tem: mã lô in trên tem (18/11 — "thể hiện cả tem lô") — cùng chỗ với lô của hàng không tem */}
                      {temLots && <div className="text-[9px] text-slate-500 font-mono leading-tight truncate max-w-[9rem]" title={temLots}>{temLots}</div>}
                      {g.expired && g.state === 'OK' && <div className="text-[9px] text-green-700">hết hạn · QA đã duyệt</div>}
                      {a && g.kind === 'LOT' && g.state === 'EXPIRED' && <div className={`text-[9px] ${a.tone === 'red' ? 'text-red-600' : 'text-amber-700'}`}>{a.text}</div>}
                    </td>
                    <td className={`${TD} text-right tabular-nums font-bold ${pctDateCls(g.pct_date, bands)}`}>{pctText(g.pct_date)}</td>
                    <td className={`${TD} font-mono text-[9px] sm:text-[10px] text-slate-600`}>
                      {g.kind === 'TEM' ? (g.location_code ?? <span className="text-slate-300">—</span>)
                        : g.locations.length ? <span title={g.locations.join(', ')}>{g.locations.slice(0, 2).join(', ')}{g.locations.length > 2 ? ` +${g.locations.length - 2}` : ''}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className={`${TD} text-right`}>
                      <span className={`font-semibold tabular-nums ${g.state === 'QA' ? 'text-purple-700' : ''}`}>{unit(g.available)}</span>
                      <div className="text-[9px] text-slate-400">{g.count} {g.kind === 'TEM' ? 'tem' : 'dòng'}</div>
                    </td>
                    <td className="px-0.5 py-1.5 text-slate-400">
                      {/* không dùng touch-target (ép 44 px rộng trên màn cảm ứng ⇒ bảng lô tràn 360 px): dòng đã cao ~40 px, nút 28 × 36 */}
                      <button type="button" className="inline-flex min-h-[2.25rem] min-w-[1.75rem] items-center justify-center rounded hover:bg-slate-100" aria-label={expanded ? 'Thu gọn' : 'Xem từng tem'} aria-expanded={expanded}
                        onClick={e => { e.stopPropagation(); toggle(g.key) }}>
                        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                  </tr>
                  {expanded && g.items.map(it => <ItemRow key={it.entry_id} g={g} it={it} selectable={selectable} unit={unit}
                    highlight={it.entry_id === highlightEntryId} onOpenPallet={onOpenPallet} />)}
                  {expanded && g.items.length < g.count && (
                    <tr><td colSpan={cols} className="px-3 py-1 text-[10px] text-slate-400 whitespace-nowrap">… còn {g.count - g.items.length} dòng nữa</td></tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {!all && groups.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="mt-0.5 text-[11px] text-blue-600 hover:underline touch-target">Xem cả {groups.length} nhóm</button>
      )}
    </div>
  )
}

function ItemRow({ g, it, selectable, unit, highlight, onOpenPallet }: {
  g: PickGroup; it: PickItem; selectable: boolean; unit: (n: number) => string; highlight: boolean; onOpenPallet?: (id: string) => void
}) {
  const a = it.expired ? approvalShort(it.approval) : null
  return (
    <tr className={`text-[10px] ${highlight ? 'bg-sky-100' : g.state === 'QA' ? 'bg-purple-50/60' : 'bg-slate-50'}`} data-item={it.entry_id}>
      {selectable && <td />}
      <td colSpan={3} className="pl-5 pr-1.5 py-1 whitespace-nowrap">
        {g.kind === 'TEM' ? (<>
          {onOpenPallet
            ? <button type="button" className="font-mono font-semibold text-blue-600 hover:underline text-left" onClick={e => { e.stopPropagation(); onOpenPallet(it.entry_id) }}>{it.pallet_code}</button>
            : <span className="font-mono font-semibold">{it.pallet_code}</span>}
          {/* mã lô in trên tem — dòng riêng để mã tem dài không đẩy bảng tràn 360 px */}
          {it.batch && <span className="block text-[9px] text-slate-500 font-mono leading-tight">lô {it.batch}</span>}
        </>) : (
          <span className="text-slate-600"><span className="font-mono">{it.location_code ?? '—'}</span>{it.import_date ? ` · nhập ${formatDate(it.import_date)}` : ''}</span>
        )}
        {a && <span className={`ml-1.5 ${a.tone === 'green' ? 'text-green-700' : a.tone === 'red' ? 'text-red-600' : 'text-amber-700'}`}>· {a.text}</span>}
      </td>
      <td className="px-1.5 py-1 whitespace-nowrap text-right font-semibold tabular-nums text-blue-700">{unit(it.available)}</td>
      <td />
    </tr>
  )
}

/** Nút kính lúp trên bàn của mẻ (như cột Kho của Xuất kho): tồn của MỘT mã trong kho chế biến, gom theo date, có tem lẫn không tem */
export function MesStockDialog({ batchId, materialId, title, mat, onClose }: {
  batchId: string; materialId: string; title: string; mat: (MatUnits & { material_code?: string }) | null; onClose: () => void
}) {
  const { data, isLoading, error } = usePickList(batchId, materialId)
  const bands = usePctBands()
  const [detailId, setDetailId] = useState<string | null>(null)
  const tem = data?.tem_groups ?? [], lot = data?.lot_groups ?? []
  return (
    <>
      {detailId && <PalletDetailDialog entryId={detailId} onClose={() => setDetailId(null)} />}
      <Dialog open onOpenChange={v => { if (!v) onClose() }}>
        <DialogContent className="max-w-sm sm:max-w-lg p-0" data-testid="mes-stock-dialog">
          <DialogHeader className="px-4 pt-4 pb-2 border-b">
            <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
            {data && <p className="text-xs text-slate-500 mt-0.5">Tồn kho chế biến theo %Date · {data.principle}{data.required ? ' bắt buộc' : ''} — lấy hạng 1 ★ trước</p>}
          </DialogHeader>
          <div className="overflow-auto px-3 py-2 space-y-3" style={{ maxHeight: '65vh' }}>
            {isLoading ? <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />)}</div>
              : error ? <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">Không tải được tồn kho — thử lại</div>
              : !tem.length && !lot.length ? <div className="py-8 text-center text-slate-400 text-sm">Kho chế biến không còn mã này</div>
              : <>
                {tem.length > 0 && data && (
                  <div>
                    <p className="text-[11px] font-semibold text-slate-600 mb-0.5">Có tem <span className="font-normal text-slate-500">· {pickSummary(data, tem, 'tem')}</span></p>
                    <MesStockGroups groups={tem} dateLabel={data.date_label} mat={mat} bands={bands} onOpenPallet={setDetailId} limit={20} testId="stock-tem-groups" />
                  </div>
                )}
                {lot.length > 0 && data && (
                  <div>
                    <p className="text-[11px] font-semibold text-slate-600 mb-0.5">Không có tem <span className="font-normal text-slate-500">· {pickSummary(data, lot, 'dòng')}</span></p>
                    <MesStockGroups groups={lot} dateLabel={data.date_label} mat={mat} bands={bands} limit={20} testId="stock-lot-groups" />
                  </div>
                )}
              </>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
