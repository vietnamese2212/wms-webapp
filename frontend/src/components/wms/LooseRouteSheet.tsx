// THEO VỊ TRÍ CÔNG VIỆC — Nhặt lẻ (user chốt 14/09/2026: "mở 1 nút và hiện lên con đường đi lấy, và quét
// được luôn ở đó"). Một màn toàn màn hình cho người nhặt lẻ trên PDA:
//   • dải ĐIỂM GHÉ (cuộn ngang, điểm đang đứng tô đậm, bấm để nhảy) — thứ tự = BFS từ cửa của chuyến
//     (`GET /wms/directed/loose-route`, cùng phép đo với vòng đi xe nâng, KHÔNG tính lại ở FE);
//   • thẻ ĐIỂM HIỆN TẠI: mã vị trí to, quãng đường từ điểm trước (ô × cell_m → mét), từng mã phải lấy ở
//     đây kèm CÒN LẤY (thùng + lẻ), %Date pallet gợi ý, nút tra tồn;
//   • vùng QUÉT ngay dưới = `GdoScanPanel` mode 'loose' — CÙNG thân quét của nút "Quét QR", không viết
//     luồng thứ hai (luân chuyển / phần dư / cất đều giữ một nguồn).
// Hướng dẫn là chỉ đường, không phải rào: quét tem của điểm khác vẫn lưu được, chỉ nhắc vàng.
// Lưu xong → react-query làm mới route + gdo; điểm đang đứng hết mã ⇒ TỰ sang điểm kế + beep.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, MapPin, Search, X } from 'lucide-react'
import { GdoScanPanel } from '@/components/wms/GdoScanSheet'
import { MaterialStockDialog } from '@/components/wms/MaterialStockDialog'
import { tripName } from '@/components/wms/TaskDetailSheet'
import { useLooseRoute, usePctBands, type LooseRouteMaterial, type LooseRouteStop } from '@/api/hooks'
import { pctDateCls } from '@/utils/pctDateBands'
import { qtyLabel } from '@/utils/qtyUnits'
import { playBeep } from '@/utils/audio'
import type { GDO } from '@/types'

function metres(cells: number | null | undefined, cellM: number | null | undefined): string | null {
  if (cells == null || cells < 0 || !cellM) return null
  const m = cells * cellM
  return m >= 10 ? `~${Math.round(m)} m` : `~${m.toFixed(1).replace('.', ',')} m`
}

export function LooseRouteSheet({ gdo, onClose, canScan }: { gdo: GDO; onClose: () => void; canScan: boolean }) {
  const { data: route, isLoading } = useLooseRoute(gdo.id)
  const pctBands = usePctBands()
  const stops: LooseRouteStop[] = route?.stops ?? []
  // Điểm đang đứng = theo location_id (không theo index — BE bỏ điểm đã lấy đủ nên index trôi)
  const [curLocId, setCurLocId] = useState<string | null>(null)
  const [pendingAdvance, setPendingAdvance] = useState(false)
  const [scannedItemId, setScannedItemId] = useState<string | null>(null)
  const [stockFor, setStockFor] = useState<LooseRouteMaterial | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  const curIdx = Math.max(0, stops.findIndex(s => s.location_id === curLocId))
  const cur = stops[curIdx] ?? null

  // Điểm đang đứng biến mất khỏi route (đã lấy đủ) ⇒ sang điểm kế; lần đầu ⇒ điểm 1
  useEffect(() => {
    if (!stops.length) return
    if (!curLocId || !stops.some(s => s.location_id === curLocId)) {
      // Hết mã tại điểm cũ SAU một lượt lưu ⇒ beep hai nhịp báo "sang ô kế"
      if (curLocId && pendingAdvance) { playBeep(660, 0.08); setTimeout(() => playBeep(990, 0.12), 120) }
      setCurLocId(stops[0].location_id)
      setPendingAdvance(false)
    }
  }, [stops, curLocId, pendingAdvance])

  // Kéo điểm đang đứng vào tầm nhìn trên dải (chỉ cuộn dải, không cuộn trang)
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-loc="${cur?.location_id ?? ''}"]`)
    if (el && stripRef.current) {
      const strip = stripRef.current
      const left = el.offsetLeft - strip.clientWidth / 2 + el.clientWidth / 2
      strip.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
    }
  }, [cur?.location_id])

  // Mã vừa quét thuộc điểm nào? (khác điểm đang đứng ⇒ nhắc vàng, KHÔNG chặn)
  const scannedStop = useMemo(() => scannedItemId
    ? stops.find(s => s.materials.some(m => m.item_id === scannedItemId)) ?? null : null, [scannedItemId, stops])
  const offRoute = !!scannedStop && !!cur && scannedStop.location_id !== cur.location_id

  const totalMats = stops.reduce((n, s) => n + s.materials.length, 0)
  const go = (i: number) => { const s = stops[i]; if (s) { setCurLocId(s.location_id); setScannedItemId(null) } }

  return createPortal(
    /* z-50 (không phải 60 như GdoScanSheet) để Dialog tra tồn (Radix z-50, portal SAU trong DOM) nổi LÊN TRÊN màn này */
    <div className="fixed inset-0 z-50 flex flex-col bg-white pointer-events-auto">
      {/* Header */}
      <div className="shrink-0 border-b bg-slate-900 text-white px-3 py-2 flex items-center gap-2">
        <MapPin className="h-4 w-4 text-sky-400 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">Theo vị trí công việc</p>
          <p className="text-[11px] text-slate-300 leading-tight truncate">
            <span className="font-mono">{tripName(gdo)}</span>
            {stops.length > 0 && <> · điểm ghé <b className="text-white">{curIdx + 1}/{stops.length}</b> · còn <b className="text-white">{totalMats}</b> mã</>}
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-white/10" title="Đóng"><X className="h-5 w-5" /></button>
      </div>

      {/* Dải điểm ghé — hàng nowrap trong khung co PHẢI cuộn ngang (luật 12/09) */}
      {stops.length > 0 && (
        <div ref={stripRef} className="shrink-0 border-b bg-sky-50/70 px-2 py-1.5 flex items-center gap-1 overflow-x-auto whitespace-nowrap">
          {route?.start_code && <span className="text-[10px] text-slate-500 shrink-0 mr-1">{route.start_code}</span>}
          {stops.map((s, i) => {
            const active = i === curIdx
            return (
              <button key={s.location_id} data-loc={s.location_id} onClick={() => go(i)}
                className={`shrink-0 flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition-colors ${
                  active ? 'bg-sky-600 border-sky-600 text-white shadow' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                <span className={`inline-flex items-center justify-center h-4 min-w-4 rounded-full text-[10px] font-semibold px-1 ${active ? 'bg-white text-sky-700' : 'bg-sky-600 text-white'}`}>{s.seq}</span>
                <span className="font-mono font-semibold">{s.location_code}</span>
                <span className={active ? 'text-sky-100' : 'text-slate-400'}>{s.materials.length} mã</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Thẻ điểm hiện tại */}
      <div className="shrink-0 border-b px-3 py-2">
        {isLoading && <p className="text-sm text-slate-400">Đang tính đường đi…</p>}
        {!isLoading && !cur && (
          <div className="text-sm text-slate-600">
            <p className="font-medium text-green-700">Không còn mã nào phải nhặt lẻ trên chuyến này.</p>
            {(route?.unlocated.length ?? 0) > 0 && (
              <p className="text-xs text-amber-700 mt-1">{route!.unlocated.length} mã chưa có tồn để chỉ chỗ: {route!.unlocated.map(u => u.material_code ?? '?').join(', ')}</p>
            )}
          </div>
        )}
        {cur && (
          <div className="space-y-1.5">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="inline-flex items-center justify-center h-6 min-w-6 rounded-full bg-sky-600 text-white text-xs font-bold px-1.5">{cur.seq}</span>
              <span className="font-mono text-xl font-bold text-slate-900 break-all leading-tight">{cur.location_code}</span>
              {cur.is_pick_face && <span className="text-[10px] rounded-full bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-0.5">vị trí nhặt lẻ</span>}
              {metres(cur.dist_from_prev_cells, route?.cell_m) && (
                <span className="text-xs text-slate-500">{curIdx === 0 && route?.start_code ? `từ ${route.start_code}` : 'từ điểm trước'} {metres(cur.dist_from_prev_cells, route?.cell_m)}</span>
              )}
              {!route?.routed && <span className="text-[10px] text-amber-700">chưa có bản vẽ / chuyến chưa gắn cửa — thứ tự chưa theo đường</span>}
            </div>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50">
              {cur.materials.map(m => (
                <li key={m.item_id} className={`flex items-center gap-2 px-2 py-1.5 text-xs ${scannedItemId === m.item_id ? 'bg-green-50' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <span className="font-mono font-semibold text-slate-800">{m.material_code ?? '—'}</span>
                      <span className="text-slate-600 truncate">{m.material_name ?? ''}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span>còn lấy <b className="text-slate-900">{qtyLabel(m.remaining_base, m.units)}</b></span>
                      {m.pct_date != null && <span className={`px-1 rounded ${pctDateCls(m.pct_date, pctBands)}`}>{m.pct_date}%</span>}
                      <span className="text-slate-400">tồn ở ô {qtyLabel(m.available, m.units)}</span>
                    </div>
                  </div>
                  <button onClick={() => setStockFor(m)} className="p-1.5 rounded hover:bg-white text-slate-500 shrink-0" title="Tra tồn kho theo vị trí">
                    <Search className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
            {offRoute && scannedStop && (
              <p className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                Tem vừa quét thuộc điểm ghé <b>số {scannedStop.seq} · {scannedStop.location_code}</b>, không phải ô đang đứng — vẫn lưu được.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Vùng quét — nhúng thân quét cấp đơn, mode nhặt lẻ */}
      {canScan && gdo.status !== 'COMPLETED' && gdo.status !== 'CANCELLED' ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <GdoScanPanel gdo={gdo} mode="loose" embedded onClose={onClose}
            onActiveItemChange={setScannedItemId}
            onSaved={() => setPendingAdvance(true)} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-slate-400 px-4 text-center">
          {canScan ? 'Chuyến đã kết thúc — chỉ xem đường đi.' : 'Bạn không có quyền quét nhặt lẻ — chỉ xem đường đi.'}
        </div>
      )}

      {/* Footer: điểm trước / điểm sau */}
      {stops.length > 1 && (
        <div className="shrink-0 border-t px-3 py-2 flex items-center gap-2 bg-white">
          <button onClick={() => go(curIdx - 1)} disabled={curIdx <= 0}
            className="flex-1 h-10 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 disabled:opacity-40 flex items-center justify-center gap-1">
            <ChevronLeft className="h-4 w-4" /> Điểm trước
          </button>
          <button onClick={() => go(curIdx + 1)} disabled={curIdx >= stops.length - 1}
            className="flex-1 h-10 rounded-lg bg-sky-600 text-white text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-1">
            Điểm sau <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {stockFor && (
        <MaterialStockDialog materialId={stockFor.material_id} materialCode={stockFor.material_code ?? '—'}
          materialName={stockFor.material_name ?? ''} mat={stockFor.units} warehouseId={gdo.warehouse_id ?? undefined}
          onClose={() => setStockFor(null)} />
      )}
    </div>,
    document.body
  )
}
