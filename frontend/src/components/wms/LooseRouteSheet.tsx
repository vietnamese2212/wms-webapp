// THEO VỊ TRÍ CÔNG VIỆC — Nhặt lẻ (user chốt 14/09/2026, lần 2: *"hiện ra 1 lộ trình nhặt lẻ được tối ưu theo
// thứ tự từ trên xuống dưới … giao diện dạng TABLE — mỗi vị trí × mã hàng là 1 dòng … có nút quét QR như
// giao diện chi tiết Nhặt lẻ … link với nhặt lẻ / xuất nên có gì thay đổi thì được cập nhật"*).
//   • BẢNG lộ trình: thứ tự = BFS từ cửa của chuyến (`GET /wms/directed/loose-route`, cùng phép đo với vòng đi
//     xe nâng — KHÔNG tính lại ở FE); dòng cùng một ô đứng liền nhau, ô in một lần; dòng KẾ TIẾP tô đậm.
//   • Dòng đã lấy đủ → GẠCH NGANG, tụt xuống cuối, vẫn ở lại bảng (luật Việc cần làm "phòng bị quên").
//   • Nút "Quét QR" (header) + "Quét" từng dòng = CÙNG `GdoScanSheet` mode `loose` của trang Nhặt lẻ; hàng
//     không tem → "Lưu SL" đi đường của trang mã hàng. Bóp cò súng ngay trên bảng cũng mở màn quét (chế độ súng).
//   • Bám realtime: `useLooseRoute` nằm dưới khoá `['gdo', …]` — quét ở đâu (màn này, trang chuyến, Xuất kho)
//     bảng cũng đổi; xe nâng hạ pallet khác về ô nhặt lẻ ⇒ gợi ý ô đổi ⇒ bảng đổi.
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { MapPin, PenSquare, Search, X } from 'lucide-react'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { ScanIcon } from '@/components/shared/ScanIcon'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { GdoScanSheet } from '@/components/wms/GdoScanSheet'
import { MaterialStockDialog } from '@/components/wms/MaterialStockDialog'
import { tripName } from '@/components/wms/TaskDetailSheet'
import { useLooseRoute, usePctBands, type LooseRouteMaterial } from '@/api/hooks'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'
import { unlockAudio } from '@/utils/audio'
import { pctDateCls } from '@/utils/pctDateBands'
import { qtyLabel, qtyEntryDecimal, qtyUnitLabel, type MatUnits } from '@/utils/qtyUnits'
import type { GDO } from '@/types'

function metres(cells: number | null | undefined, cellM: number | null | undefined): string | null {
  if (cells == null || cells < 0 || !cellM) return null
  const m = cells * cellM
  return m >= 10 ? `~${Math.round(m)} m` : `~${m.toFixed(1).replace('.', ',')} m`
}

type Row = {
  key: string; item_id: string; material_id: string | null
  // stop_no = thứ tự ghé ĐÁNH LẠI trên FE theo vị trí trong mảng stops (1..N liền mạch) — không in seq thô của BE
  stop_no: number | null; location_code: string | null; is_pick_face: boolean; first_of_stop: boolean; n_in_stop: number
  dist: string | null; material_code: string | null; material_name: string | null; units: MatUnits | null
  remaining: number; effective: number; scanned: number; pct_date: number | null; available: number | null
  done: boolean
}

// Thứ tự cột theo câu hỏi của người đi nhặt (user 14/09 "mã hàng rồi tới tên hàng chứ, bố trí khoa học vào"):
// ĐI ĐÂU (Vị trí · Quãng) → LẤY GÌ (Mã · Tên) → BAO NHIÊU (Còn lấy · Đã/cần) → PALLET NÀO (%Date · Tồn ở ô) → THAO TÁC (ghim mép phải)
const COLS: RtColDef[] = [
  { id: 'seq',  label: 'Vị trí', w: 168 },   // đủ chỗ cho "① B_TP1_10_T1 ×2 kế tiếp" ở 360 px (đo: 118 cắt mất chip)
  { id: 'dist', label: 'Quãng', w: 64, align: 'right' },
  { id: 'mat',  label: 'Mã hàng', w: 92 },
  { id: 'name', label: 'Tên hàng', w: 200 },
  { id: 'rem',  label: 'Còn lấy', w: 110, align: 'right' },
  { id: 'prog', label: 'Đã / cần', w: 120, align: 'right' },
  { id: 'pct',  label: '%Date pallet', w: 82, align: 'right' },
  { id: 'avail', label: 'Tồn ở ô', w: 96, align: 'right' },
  { id: 'act',  label: 'Thao tác', w: 104, align: 'center' },
]

export function LooseRouteSheet({ gdo, onClose, canScan }: { gdo: GDO; onClose: () => void; canScan: boolean }) {
  const navigate = useNavigate()
  const { data: route, isLoading } = useLooseRoute(gdo.id)
  const pctBands = usePctBands()
  const [scan, setScan] = useState<{ open: boolean; pda: string | null }>({ open: false, pda: null })
  const [stockFor, setStockFor] = useState<{ material_id: string; code: string; name: string; units: MatUnits | null } | null>(null)
  const tripOpen = gdo.status !== 'COMPLETED' && gdo.status !== 'CANCELLED'
  const scanAllowed = canScan && tripOpen

  // Hàng không tem (POSM/Loscam) đi đường "Lưu SL" của trang mã hàng — tra cờ từ chính dòng đơn
  const noQr = useMemo(() => {
    const s = new Set<string>()
    for (const d of gdo.delivery_orders ?? []) for (const i of d.items) if (i.material?.no_qr_tracking === true) s.add(i.id)
    return s
  }, [gdo])

  const rows: Row[] = useMemo(() => {
    const out: Row[] = []
    ;(route?.stops ?? []).forEach((s, si) => {
      s.materials.forEach((m: LooseRouteMaterial, i) => out.push({
        key: m.item_id, item_id: m.item_id, material_id: m.material_id,
        stop_no: si + 1, location_code: s.location_code, is_pick_face: s.is_pick_face, first_of_stop: i === 0, n_in_stop: s.materials.length,
        dist: i === 0 ? metres(s.dist_from_prev_cells, route?.cell_m) : null,
        material_code: m.material_code, material_name: m.material_name, units: m.units,
        remaining: m.remaining_base, effective: m.effective_base, scanned: m.scanned_base, pct_date: m.pct_date, available: m.available,
        done: false,
      }))
    })
    for (const u of route?.unlocated ?? []) out.push({
      key: u.item_id, item_id: u.item_id, material_id: null, stop_no: null, location_code: null, is_pick_face: false, first_of_stop: true, n_in_stop: 1,
      dist: null, material_code: u.material_code, material_name: u.material_name, units: null,
      remaining: u.remaining_base, effective: u.remaining_base, scanned: 0, pct_date: null, available: null, done: false,
    })
    for (const d of route?.done ?? []) out.push({
      key: d.item_id, item_id: d.item_id, material_id: d.material_id, stop_no: null, location_code: d.location_code, is_pick_face: false,
      first_of_stop: true, n_in_stop: 1, dist: null, material_code: d.material_code, material_name: d.material_name, units: d.units,
      remaining: 0, effective: d.effective_base, scanned: d.scanned_base, pct_date: null, available: null, done: true,
    })
    return out
  }, [route])

  const openRows = rows.filter(r => !r.done)
  const nextKey = openRows[0]?.key ?? null
  const nStops = route?.stops.length ?? 0
  // Tổng cross-mã: quy đổi THÙNG per mã trước khi cộng (luật base-unit); trộn đơn vị ⇒ "SL quy đổi"
  const unitSet = new Set(rows.map(r => qtyUnitLabel(r.units)))
  const unitLbl = unitSet.size === 1 ? ([...unitSet][0] || 'thùng') : 'SL quy đổi'
  const sumRem  = rows.reduce((s, r) => s + qtyEntryDecimal(r.remaining, r.units), 0)
  const sumDone = rows.reduce((s, r) => s + qtyEntryDecimal(r.scanned, r.units), 0)
  const fmt = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 })

  const openScan = (pda: string | null = null) => { if (!scanAllowed) return; unlockAudio(); setScan({ open: true, pda }) }
  // Bóp cò ngay trên bảng lộ trình → mở màn quét chế độ SÚNG với tem vừa bắn (như trang Nhặt lẻ).
  // Điều kiện nằm ở THAM SỐ enabled (không return sớm) — màn quét đang mở thì máy đọc súng của nó nghe, đây tắt.
  const wedgeArmed = !scan.open && scanAllowed && openRows.some(r => !noQr.has(r.item_id))
  useWedgeScanner(code => openScan(code), wedgeArmed)

  const tiles = [
    { label: 'Điểm ghé', value: nStops },
    { label: 'Mã còn lấy', value: `${openRows.length}/${rows.length}` },
    { label: 'Còn lấy', value: `${fmt(sumRem)} ${unitLbl}` },
    { label: 'Đã lấy', value: `${fmt(sumDone)} ${unitLbl}`, accent: sumDone > 0 },
  ]

  return createPortal(
    /* z-50 (không phải 60 như GdoScanSheet) để màn quét + Dialog tra tồn (portal SAU trong DOM) nổi LÊN TRÊN bảng này */
    <div className="fixed inset-0 z-50 flex flex-col bg-white pointer-events-auto">
      {/* Header */}
      <div className="shrink-0 bg-slate-900 text-white px-3 py-2 flex items-center gap-2">
        <MapPin className="h-4 w-4 text-sky-400 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">Theo vị trí công việc</p>
          <p className="text-[11px] text-slate-300 leading-tight break-words">
            <span className="font-mono">{tripName(gdo)}</span>
            {route?.start_code && <> · xuất phát <b className="text-white">{route.start_code}</b></>}
            {route && !route.routed && <span className="text-amber-300"> · chưa có bản vẽ / chưa gắn cửa — thứ tự chưa theo đường</span>}
          </p>
        </div>
        {scanAllowed && openRows.some(r => !noQr.has(r.item_id)) && (
          <button onClick={() => openScan()}
            className="h-9 px-3 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0">
            <ScanIcon className="h-4 w-4" /> Quét QR
          </button>
        )}
        <button onClick={onClose} className="p-1.5 rounded hover:bg-white/10 shrink-0" title="Đóng"><X className="h-5 w-5" /></button>
      </div>

      <div className="shrink-0"><SummaryBand tiles={tiles} /></div>

      {/* Bảng lộ trình — MỘT vùng cuộn, sticky header + cột đầu (chuẩn table-format) */}
      <div className="flex-1 min-h-0 overflow-auto pb-16">
        {isLoading && <p className="p-4 text-sm text-slate-400">Đang tính đường đi…</p>}
        {!isLoading && rows.length === 0 && <p className="p-4 text-sm text-slate-500">Chuyến này không có dòng nhặt lẻ.</p>}
        {rows.length > 0 && (
          <ResizableTable storageKey="loose_route_w" cols={COLS}>
            <TableBody>
              {rows.map(r => {
                const isNext = r.key === nextKey
                const rowCls = r.done ? 'text-slate-400 line-through' : isNext ? 'bg-sky-50 text-slate-900' : r.scanned > 0 ? 'text-amber-700' : 'text-slate-700'
                const stickyBg = r.done ? 'bg-white' : isNext ? 'bg-sky-50' : 'bg-white'
                const short = r.available != null && r.available < r.remaining
                const groupTop = r.first_of_stop ? '[&_td]:border-t [&_td]:!border-t-slate-300' : ''
                return (
                  <TableRow key={r.key} className={`${rowCls} ${groupTop}`}>
                    {/* Vị trí — ô in MỘT lần ở dòng đầu nhóm, dòng sau ↳ (nhiều mã cùng ghé một ô) */}
                    <TableCell className={`px-2 py-1 whitespace-nowrap align-top sticky left-0 z-10 ${stickyBg}`}>
                      {r.done ? (
                        <span className="text-[10px]">{r.location_code ?? '—'} <span className="no-underline text-[9px]">đã lấy</span></span>
                      ) : r.location_code == null ? (
                        <span className="text-[10px] text-amber-700">chưa có tồn để chỉ chỗ</span>
                      ) : r.first_of_stop ? (
                        <div className="flex items-center gap-1">
                          <span className={`inline-flex items-center justify-center h-4 min-w-4 rounded-full text-[9px] font-semibold px-1 shrink-0 ${isNext ? 'bg-sky-600 text-white' : 'bg-slate-200 text-slate-700'}`}>{r.stop_no}</span>
                          <span className="font-mono font-semibold text-[11px]">{r.location_code}</span>
                          {r.n_in_stop > 1 && <span className="text-[9px] text-slate-400">×{r.n_in_stop}</span>}
                          {isNext && <span className="text-[9px] rounded-full bg-sky-600 text-white px-1.5">kế tiếp</span>}
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400 pl-5">↳ cùng ô</span>
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap text-right text-[10px] text-slate-500">{r.dist ?? ''}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap font-mono font-semibold text-[10px]">{r.material_code ?? '—'}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] truncate" title={r.material_name ?? undefined}>{r.material_name ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap text-right text-[10px] font-semibold tabular-nums">
                      {r.done ? <span className="text-green-700 no-underline">✓ đủ</span> : qtyLabel(r.remaining, r.units)}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap text-right text-[10px] tabular-nums">
                      {qtyLabel(r.scanned, r.units)} <span className="text-slate-400">/ {qtyLabel(r.effective, r.units)}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap text-right text-[10px] tabular-nums">
                      {r.pct_date != null ? <span className={pctDateCls(r.pct_date, pctBands)}>{r.pct_date}%</span> : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className={`px-2 py-1 whitespace-nowrap text-right text-[10px] tabular-nums ${short ? 'text-amber-700 font-semibold' : ''}`}
                      title={short ? 'Ô này không đủ — lấy hết rồi bảng sẽ chỉ ô kế tiếp có hàng' : undefined}>
                      {r.available != null ? <>{qtyLabel(r.available, r.units)}{short && ' ⚠'}</> : <span className="text-slate-300">—</span>}
                    </TableCell>
                    {/* Thao tác GHIM MÉP PHẢI — bảng 9 cột tràn khung 360/1280, nút bấm không được là thứ bị đẩy ra ngoài */}
                    <TableCell className={`px-1 py-1 whitespace-nowrap text-center sticky right-0 z-10 ${stickyBg}`}>
                      {!r.done && scanAllowed && (
                        noQr.has(r.item_id) ? (
                          <button onClick={() => navigate(`/wms/loosepicking/${gdo.id}/items/${r.item_id}?scan=1`)}
                            className="inline-flex items-center gap-0.5 text-[9px] font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded px-1.5 py-0.5">
                            <PenSquare className="h-2.5 w-2.5" /> Lưu SL
                          </button>
                        ) : (
                          <button onClick={() => openScan()}
                            className="inline-flex items-center gap-0.5 text-[9px] font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded px-1.5 py-0.5">
                            <ScanIcon className="h-2.5 w-2.5" /> Quét
                          </button>
                        )
                      )}
                      {r.material_id && (
                        <button onClick={() => setStockFor({ material_id: r.material_id!, code: r.material_code ?? '—', name: r.material_name ?? '', units: r.units })}
                          className="ml-1 p-1 rounded hover:bg-slate-100 text-slate-500 align-middle" title="Tra tồn kho theo vị trí">
                          <Search className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </ResizableTable>
        )}
      </div>

      {scan.open && (
        <GdoScanSheet gdo={gdo} mode="loose" pdaMode={!!scan.pda} initialScan={scan.pda ?? undefined}
          onClose={() => setScan({ open: false, pda: null })} />
      )}
      {stockFor && (
        <MaterialStockDialog materialId={stockFor.material_id} materialCode={stockFor.code} materialName={stockFor.name}
          mat={stockFor.units} warehouseId={gdo.warehouse_id ?? undefined} onClose={() => setStockFor(null)} />
      )}
    </div>,
    document.body
  )
}
