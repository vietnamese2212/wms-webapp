// Panel CHI TIẾT MỘT OD của bảng Xem đơn (27/09 khuya, user: "cần xem được detail"). Trượt từ lề phải: thông tin đơn (SO ·
// người tạo · ship-to · tuyến · ngày) · MỌI ghi chú (giao hàng · hoá đơn · tham chiếu khách · lần Không điều trước · OD bị thay)
// · từng dòng hàng theo THÙNG + lẻ. Bấm một dòng hàng = mở đủ 79 cột ZSD02 (dùng chung panel của tab DO SAP).
// 22/10 (user: "detail DO không thấy Pallet, tấn, ngày tạo SO, người tạo DO, ngày tạo DO… thông tin đã lấy về thì thể hiện lên detail"):
// thêm khối Số lượng (pallet · tấn của KẾ HOẠCH + số SAP) · Vận chuyển SAP · Kho / chứng từ; ngày tạo SO đỏ khi SAU ngày đi hàng.
// Thông tin SAP đang tải thì NÓI RA — bản cũ ẩn dòng trống nên lúc chờ trông như "không có".
import { useState, type ReactNode } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { SapLineDetailSheet } from '@/pages/external/SapLineDetailSheet'
import { useDispatchPlanOd, type DispatchReviewInfo, type DoSapRow } from '@/api/hooks'
import { useWhTypeMetaMap } from '@/hooks/useWhTypeMeta'
import { whTypeBadgeCls } from '@/utils/cargoCategory'
import { qtyLabel, QTY_CONVERTED_LABEL } from '@/utils/qtyUnits'
import { formatDate, formatDateTime } from '@/utils/formatters'

export type OdSummary = {
  od: string; where: string; tone: 'green' | 'amber' | 'slate' | 'red' | 'blue' | 'purple'; cust: string; ward: string; region: string; date: string; flag: string; reason: string
  // số của KẾ HOẠCH (máy ghép đọc) + ngày đi hàng để so ngày tạo SO
  pallets?: number | null; tons?: number | null; planDate?: string | null
}

function DRow({ label, value, cls }: { label: string; value: ReactNode; cls?: string }) {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return null
  return (
    <div className="flex gap-2 text-xs py-1 border-b border-slate-100 last:border-0">
      <span className="w-28 shrink-0 text-slate-400">{label}</span>
      <span className={`font-medium break-words min-w-0 whitespace-pre-wrap ${cls ?? 'text-slate-700'}`}>{value}</span>
    </div>
  )
}
const Title = ({ children }: { children: ReactNode }) => <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1 mt-3 first:mt-0">{children}</p>
const nf = (n: number, d = 0) => n.toLocaleString('vi-VN', { maximumFractionDigits: d })
const numOrNull = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const GDO_STATUS_VI: Record<string, string> = { PENDING: 'chưa bắt đầu', IN_PROGRESS: 'đang xuất', PAUSED: 'tạm dừng', COMPLETED: 'đã hoàn thành', CANCELLED: 'đã huỷ' }

export function DispatchOdDetailSheet({ planId, sum, info, onClose }: { planId: string; sum: OdSummary | null; info: DispatchReviewInfo | undefined; onClose: () => void }) {
  const q = useDispatchPlanOd(planId, sum?.od ?? null)
  const whMeta = useWhTypeMetaMap()
  const [line, setLine] = useState<DoSapRow | null>(null)
  const matBy = new Map((q.data?.materials ?? []).map(m => [m.material_code, m]))
  // item SAP là CHỮ ("10", "100", "20") — xếp theo SỐ, không thì 100 đứng trước 20
  const live = (q.data?.lines ?? []).filter(l => l.sync_status !== 'OBSOLETE').sort((a, b) => (Number(a.od_item) || 0) - (Number(b.od_item) || 0) || a.od_item.localeCompare(b.od_item))
  const gone = (q.data?.lines ?? []).length - live.length
  const sapKg = live.reduce((s, l) => s + (Number(l.gross_weight_kg) || 0), 0)
  const soDate = info?.so_created_at ?? null
  const lateSo = !!soDate && !!sum?.planDate && soDate > sum.planDate
  const k = info?.khvc ?? null
  return (
    <>
      <Sheet open={!!sum} onOpenChange={o => { if (!o) onClose() }}>
        <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
          <SheetHeader className="px-4 py-3 border-b shrink-0">
            <SheetTitle className="text-sm flex items-center gap-2 flex-wrap">
              <span className="font-mono">OD {sum?.od}</span>
              {sum && <StatusBadge tone={sum.tone}>{sum.where}</StatusBadge>}
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
            {!info && <p className="mb-2 text-[11px] text-slate-400">Đang tải thông tin SAP của đơn…</p>}
            <Title>Đơn</Title>
            <DRow label="SO / PO SAP" value={info?.so.join(', ')} />
            <DRow label="Loại SO" value={info?.so_types.join(' · ')} />
            <DRow label="Ngày tạo SO" cls={lateSo ? 'text-red-600' : undefined}
              value={soDate ? `${formatDate(soDate)}${lateSo ? ` — SAU ngày đi hàng ${formatDate(sum!.planDate!)} (đơn bù: không tự vào kế hoạch)` : ''}` : null} />
            <DRow label="Người tạo DO" value={info?.created_by.join(', ')} />
            <DRow label="Ngày tạo DO" value={info?.od_created_at ? formatDate(info.od_created_at) : null} />
            <DRow label="Ngày giao" value={sum?.date ? formatDate(sum.date) : null} />
            <DRow label="Khách (ship-to)" value={sum?.cust} />
            <DRow label="Sold-to" value={info?.sold_to} />
            <DRow label="Kênh khách" value={info?.channel} />
            <DRow label="Kênh PP · Vùng BH" value={[info?.dist_channel, info?.sales_district].filter(Boolean).join(' · ')} />
            <DRow label="Phường · Vùng" value={[sum?.ward, sum?.region].filter(Boolean).join(' · ')} />
            <DRow label="Tuyến SAP" value={info?.route_name} />
            <DRow label="Loại kho" value={info?.categories.length ? <span className="inline-flex flex-wrap gap-1">{info.categories.map(c => <span key={c} className={`rounded px-1 text-[10px] font-semibold ${whTypeBadgeCls(c, whMeta)}`}>{c}</span>)}</span> : null} />

            <Title>Số lượng</Title>
            <DRow label="Pallet" value={numOrNull(sum?.pallets) != null ? `${nf(Number(sum!.pallets), 2)} pallet (kế hoạch)` : null} />
            <DRow label="Tấn" value={numOrNull(sum?.tons) != null ? `${nf(Number(sum!.tons), 3)} tấn (kế hoạch)` : null} />
            <DRow label="Pallet SAP" value={numOrNull(info?.sap_pallets) != null ? nf(Number(info!.sap_pallets), 2) : null} />
            <DRow label="Khối lượng SAP" value={sapKg > 0 ? `${nf(sapKg / 1000, 3)} tấn (${nf(sapKg, 1)} kg)` : null} />
            <DRow label="Thể tích SAP" value={numOrNull(info?.sap_m3) ? `${nf(Number(info!.sap_m3), 3)} m³` : null} />
            <DRow label="Dòng · mã" value={info ? `${nf(info.lines)} dòng · ${nf(info.materials)} mã` : null} />
            <DRow label={QTY_CONVERTED_LABEL} value={info?.qty_conv ? `${nf(info.qty_conv, 3)} ${info.units.length === 1 ? info.units[0] : ''}`.trim() : null} />

            <Title>Vận chuyển SAP</Title>
            <DRow label="ĐVVT (SAP)" value={info?.dvvt_raw} />
            <DRow label="Tài xế" value={info?.driver_name} />
            <DRow label="Biển số" value={info?.license_plate} />
            {info && !info.dvvt_raw && !info.driver_name && !info.license_plate && <p className="text-xs text-slate-400 py-1">SAP chưa gắn xe cho đơn này.</p>}

            <Title>Kho · chứng từ</Title>
            <DRow label="Kế hoạch xuất" value={k ? `Số xe ${k.group_code}${k.export_date ? ` · xuất ${formatDate(k.export_date)}` : ''}${k.gdo_status ? ` · chuyến ${GDO_STATUS_VI[k.gdo_status] ?? k.gdo_status}` : ''}${k.plan_dropped ? ' · NGỪNG (kế hoạch đã bỏ xe)' : ''}` : (info ? 'Chưa vào Kế hoạch xuất' : null)}
              cls={k?.plan_dropped ? 'text-amber-700' : undefined} />
            <DRow label="Mat doc" value={info?.mat_doc} />
            <DRow label="Hoá đơn SAP" value={info?.billing_no} />
            <DRow label="Duyệt" value={info?.approval_status} />
            <DRow label="ZSD02 cập nhật" value={info?.last_synced_at ? formatDateTime(info.last_synced_at) : null} />

            <Title>Ghi chú</Title>
            <DRow label="Giao hàng" value={info?.note_delivery} />
            <DRow label="Hoá đơn" value={info?.note_invoice} />
            <DRow label="Tham chiếu khách" value={info?.customer_ref} />
            <DRow label="Đã không điều" value={info?.held_before ? `Không điều tới ${formatDate(info.held_before.until)} — ${info.held_before.reason}${info.held_before.by ? ` (${info.held_before.by})` : ''}` : null} />
            <DRow label="Thay cho OD" value={info?.replaces.length ? info.replaces.map(r => `${r.od}${r.group_code ? ` — OD cũ ĐÃ ĐIỀU ở xe ${r.group_code}` : ''}`).join('\n') : null} />
            <DRow label={sum?.reason ? 'Lý do' : 'Tình trạng SAP'} value={sum?.reason || sum?.flag} />
            {info && !info.note_delivery && !info.note_invoice && !info.customer_ref && !info.held_before && !info.replaces.length && !sum?.reason && !sum?.flag && <p className="text-xs text-slate-400 py-1">Không có ghi chú nào.</p>}

            <Title>Dòng hàng{live.length ? ` (${live.length})` : ''}</Title>
            {q.isLoading && <p className="text-xs text-slate-400">Đang tải…</p>}
            {q.isError && <p className="text-xs text-red-600">Không tải được dòng hàng của OD này.</p>}
            {!!live.length && (
              <div className="rounded border border-slate-200 divide-y divide-slate-100">
                {live.map(l => {
                  const m = l.material_code ? matBy.get(l.material_code) : undefined
                  return (
                    <button key={l.id} type="button" onClick={() => setLine(l)} className="w-full text-left px-2 py-1.5 hover:bg-slate-50 flex items-start gap-2 text-xs"
                      title="Xem đủ các cột ZSD02 của dòng này">
                      <span className="w-10 shrink-0 font-mono text-slate-400">{l.od_item}</span>
                      <span className="min-w-0 flex-1">
                        <span className="font-mono font-semibold">{l.material_code}</span>
                        {m?.category && <span className={`ml-1 rounded px-1 text-[9px] font-semibold ${whTypeBadgeCls(m.category, whMeta)}`}>{m.category}</span>}
                        <span className="block text-slate-500 break-words">{m?.short_name ?? l.material_name ?? ''}</span>
                      </span>
                      <span className="shrink-0 text-right tabular-nums font-medium">{qtyLabel(Number(l.qty_base) || 0, m ?? null)}</span>
                    </button>
                  )
                })}
              </div>
            )}
            {gone > 0 && <p className="mt-1 text-[11px] text-slate-400">{gone} dòng SAP đã bỏ (không tính).</p>}
          </div>
        </SheetContent>
      </Sheet>
      <SapLineDetailSheet row={line} kind="od" onClose={() => setLine(null)} />
    </>
  )
}
