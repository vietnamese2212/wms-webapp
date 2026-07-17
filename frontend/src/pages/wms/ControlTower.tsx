// Control Tower — Giám sát vận hành trong ngày (A1 roadmap 16/07): xe trong cổng + dwell,
// tiến độ chuyến xuất, nhịp độ nhập/xuất theo giờ, trạm cân. Realtime + refetch 60s.
// Chế độ TV: overlay tối full-screen treo màn hình kho (requestFullscreen, thoát = Esc/nút).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Tv, X, Truck, PackageMinus, PackagePlus, Scale } from 'lucide-react'
import type { AxiosError } from 'axios'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useControlTower, useMaterials, type ControlTowerData, type ControlTowerGateRow, type ControlTowerTrip } from '@/api/hooks'
import { useScopedWarehouses, useScopedWhTypes } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { formatDate, formatTimestampTime } from '@/utils/formatters'

const nf = new Intl.NumberFormat('vi-VN')

// ─── helpers ──────────────────────────────────────────────────────────────────
function dwellMinutes(entryAt: string | null, now: Date): number | null {
  if (!entryAt) return null
  const t = new Date(entryAt).getTime()
  if (isNaN(t)) return null
  return Math.max(0, Math.floor((now.getTime() - t) / 60000))
}
function dwellClass(mins: number | null): string {
  if (mins == null) return 'text-slate-400'
  if (mins > 90) return 'text-red-600 font-semibold'
  if (mins > 45) return 'text-amber-600 font-semibold'
  return 'text-slate-500'
}
function fmtDwell(mins: number | null): string {
  if (mins == null) return '—'
  if (mins < 60) return `${mins}p`
  return `${Math.floor(mins / 60)}g${String(mins % 60).padStart(2, '0')}`
}

// ─── khối dùng chung (sáng / TV tối) ──────────────────────────────────────────
function Block({ title, icon: Icon, count, dark, extra, children }: {
  title: string; icon: typeof Truck; count?: number; dark?: boolean; extra?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className={`rounded-lg border flex flex-col min-h-0 ${dark ? 'border-slate-700 bg-slate-800/60' : 'border-slate-200 bg-white'}`}>
      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 border-b shrink-0 ${dark ? 'border-slate-700' : 'bg-slate-100 border-slate-200'}`}>
        <span className="w-1 h-3.5 rounded bg-sky-500 shrink-0" />
        <Icon className={`h-3.5 w-3.5 ${dark ? 'text-slate-300' : 'text-slate-500'}`} />
        <span className={`text-[10px] font-semibold uppercase tracking-wide ${dark ? 'text-slate-200' : 'text-slate-600'}`}>{title}</span>
        {count != null && <span className={`text-[10px] font-semibold ${dark ? 'text-sky-300' : 'text-sky-600'}`}>({nf.format(count)})</span>}
        {extra}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  )
}

// Dải tiến độ xuất hôm nay: KH / đã xuất / còn lại / % (user chốt 16/07)
function OutProgressStrip({ data, dark }: { data: ControlTowerData; dark?: boolean }) {
  const o = data.outbound
  const remaining = Math.max(0, o.planned - o.scanned)
  const pct = o.planned > 0 ? Math.min(100, Math.round((o.scanned / o.planned) * 100)) : 0
  const full = o.planned > 0 && o.scanned >= o.planned
  const lbl = `text-[9px] uppercase ${dark ? 'text-slate-400' : 'text-slate-500'}`
  const num = `font-semibold tabular-nums ${dark ? 'text-white' : 'text-slate-800'}`
  return (
    <div className={`px-3 py-2 border-b ${dark ? 'border-slate-700 bg-slate-800/60 rounded-lg border' : 'bg-white border-slate-200'}`}>
      <div className="flex items-center gap-4 flex-wrap">
        <span className={`text-[10px] font-semibold uppercase tracking-wide ${dark ? 'text-slate-200' : 'text-slate-600'}`}>Tiến độ xuất hôm nay</span>
        <span className={lbl}>Kế hoạch <span className={`${num} text-sm`}>{nf.format(o.planned)}</span></span>
        <span className={lbl}>Đã xuất <span className={`${num} text-sm ${full ? '!text-green-500' : '!text-sky-500'}`}>{nf.format(o.scanned)}</span></span>
        <span className={lbl}>Còn lại <span className={`${num} text-sm ${remaining > 0 ? '!text-amber-500' : ''}`}>{nf.format(remaining)}</span></span>
        <span className={`ml-auto text-lg font-semibold tabular-nums ${full ? 'text-green-500' : dark ? 'text-sky-300' : 'text-sky-600'}`}>{pct}%</span>
      </div>
      <div className={`mt-1.5 h-2.5 rounded ${dark ? 'bg-slate-700' : 'bg-slate-200'}`}>
        <div className={`h-2.5 rounded ${full ? 'bg-green-500' : 'bg-sky-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// Hàng XUẤT hôm nay theo mã — KIỂU ĐIỀU HÀNH cho ngày cả trăm/nghìn mã (user 17/07):
// server sort mã CÒN THIẾU nhiều nhất lên đầu (top 30), mã đã đủ gộp thành số đếm ở header.
function OutMatBlock({ data, dark }: { data: ControlTowerData; dark?: boolean }) {
  const list = data.out_by_material?.list ?? []
  const total = data.out_by_material?.n_materials ?? 0
  const nDone = data.out_by_material?.n_done ?? 0
  const nShort = data.out_by_material?.n_short ?? 0
  return (
    <Block title="Hàng xuất hôm nay theo mã" icon={PackageMinus} count={total} dark={dark}
      extra={total > 0 ? (
        <span className="ml-auto flex items-center gap-1.5 text-[9px] font-medium">
          <span className={`px-1.5 py-0.5 rounded-full ${dark ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-700'}`}>{nf.format(nDone)} đủ</span>
          <span className={`px-1.5 py-0.5 rounded-full ${nShort > 0 ? (dark ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-700') : (dark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-500')}`}>{nf.format(nShort)} còn thiếu</span>
        </span>
      ) : undefined}>
      {list.length === 0 ? (
        <p className="px-3 py-4 text-[11px] text-slate-400">Chưa có kế hoạch xuất hôm nay.</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className={`text-[8px] uppercase ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
              <th className="px-2.5 py-1 text-left font-medium">Mã hàng</th>
              <th className="px-1 py-1 text-right font-medium">KH</th>
              <th className="px-1 py-1 text-right font-medium">Đã xuất</th>
              <th className="px-1 py-1 text-right font-medium">Còn</th>
              <th className="px-2.5 py-1 text-left font-medium w-24">%</th>
            </tr>
          </thead>
          <tbody>
            {list.map(m => {
              const remaining = Math.max(0, m.ordered - m.scanned)
              const pct = m.ordered > 0 ? Math.min(100, Math.round((m.scanned / m.ordered) * 100)) : 0
              const full = m.ordered > 0 && m.scanned >= m.ordered
              return (
                <tr key={m.code} className={`border-b last:border-0 ${dark ? 'border-slate-700/60' : 'border-slate-100'}`}>
                  <td className="px-2.5 py-1 whitespace-nowrap">
                    <div className={`text-[10px] font-medium truncate max-w-[180px] ${dark ? 'text-white' : 'text-slate-700'}`} title={`${m.code} — ${m.name}`}>{m.name}</div>
                    <div className={`text-[8px] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{m.code} · {m.category}{m.loose > 0 ? ` · lẻ ${nf.format(m.loose)}` : ''}</div>
                  </td>
                  <td className={`px-1 py-1 text-right text-[10px] tabular-nums whitespace-nowrap ${dark ? 'text-slate-300' : 'text-slate-600'}`}>{nf.format(m.ordered)}</td>
                  <td className={`px-1 py-1 text-right text-[10px] tabular-nums font-semibold whitespace-nowrap ${full ? 'text-green-500' : dark ? 'text-sky-300' : 'text-sky-600'}`}>{nf.format(m.scanned)}</td>
                  <td className={`px-1 py-1 text-right text-[10px] tabular-nums whitespace-nowrap ${remaining > 0 ? 'text-amber-600' : dark ? 'text-slate-500' : 'text-slate-400'}`}>{nf.format(remaining)}</td>
                  <td className="px-2.5 py-1 w-24">
                    <div className="flex items-center gap-1">
                      <div className={`flex-1 h-1.5 rounded ${dark ? 'bg-slate-700' : 'bg-slate-200'}`}>
                        <div className={`h-1.5 rounded ${full ? 'bg-green-500' : 'bg-sky-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={`text-[9px] tabular-nums w-7 text-right ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{pct}%</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {total > list.length && (
        <p className={`px-2.5 py-1 text-[9px] border-t ${dark ? 'text-slate-500 border-slate-700/60' : 'text-slate-400 border-slate-100'}`}>
          Hiện 30 mã cần chú ý nhất (còn thiếu nhiều nhất) trong {nf.format(total)} mã — lọc Kho / Loại kho / Mã hàng để soi phần còn lại.
        </p>
      )}
    </Block>
  )
}

// Hàng NHẬP hôm nay theo mã
function InMatBlock({ data, dark }: { data: ControlTowerData; dark?: boolean }) {
  const list = data.in_by_material?.list ?? []
  const total = data.in_by_material?.n_materials ?? 0
  return (
    <Block title="Hàng nhập hôm nay theo mã" icon={PackagePlus} count={total} dark={dark}>
      {list.length === 0 ? (
        <p className="px-3 py-4 text-[11px] text-slate-400">Chưa có hàng nhập hôm nay.</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className={`text-[8px] uppercase ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
              <th className="px-2.5 py-1 text-left font-medium">Mã hàng</th>
              <th className="px-1 py-1 text-right font-medium">Pallet</th>
              <th className="px-2.5 py-1 text-right font-medium">Thùng</th>
            </tr>
          </thead>
          <tbody>
            {list.map(m => (
              <tr key={m.code} className={`border-b last:border-0 ${dark ? 'border-slate-700/60' : 'border-slate-100'}`}>
                <td className="px-2.5 py-1 whitespace-nowrap">
                  <div className={`text-[10px] font-medium truncate max-w-[200px] ${dark ? 'text-white' : 'text-slate-700'}`} title={`${m.code} — ${m.name}`}>{m.name}</div>
                  <div className={`text-[8px] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{m.code} · {m.category}</div>
                </td>
                <td className={`px-1 py-1 text-right text-[10px] tabular-nums whitespace-nowrap ${dark ? 'text-slate-300' : 'text-slate-600'}`}>{nf.format(m.pallets)}</td>
                <td className={`px-2.5 py-1 text-right text-[10px] tabular-nums font-semibold whitespace-nowrap ${dark ? 'text-green-400' : 'text-green-600'}`}>{nf.format(m.cartons)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Block>
  )
}

function GateBlock({ data, now, dark }: { data: ControlTowerData; now: Date; dark?: boolean }) {
  const list = data.gate.inside_list ?? []
  return (
    <Block title="Xe trong cổng" icon={Truck} count={data.gate.inside} dark={dark}>
      {list.length === 0 ? (
        <p className={`px-3 py-4 text-[11px] ${dark ? 'text-slate-400' : 'text-slate-400'}`}>Không có xe nào trong cổng.</p>
      ) : (
        <table className="w-full">
          <tbody>
            {list.map((g: ControlTowerGateRow, i) => {
              const mins = dwellMinutes(g.entry_at, now)
              return (
                <tr key={i} className={`border-b last:border-0 ${dark ? 'border-slate-700/60' : 'border-slate-100'}`}>
                  <td className={`px-2.5 py-1 text-[11px] font-mono font-semibold whitespace-nowrap ${dark ? 'text-white' : ''}`}>{g.plate ?? '—'}</td>
                  <td className={`px-2 py-1 text-[10px] whitespace-nowrap ${dark ? 'text-slate-300' : 'text-slate-600'}`}>
                    <span className={`px-1 rounded border text-[9px] font-medium mr-1 ${g.direction === 'INBOUND' ? 'text-green-500 border-green-400/60' : 'text-sky-500 border-sky-400/60'}`}>
                      {g.direction === 'INBOUND' ? 'Nhập' : 'Xuất'}
                    </span>
                    <span className="truncate">{g.company ?? '—'}</span>
                  </td>
                  <td className={`px-2 py-1 text-[10px] whitespace-nowrap ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{g.warehouse_name ?? '—'}</td>
                  <td className={`px-2 py-1 text-[10px] whitespace-nowrap ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{g.warehouse_type ?? <span className="text-slate-300">—</span>}</td>
                  <td className={`px-2 py-1 text-[10px] whitespace-nowrap ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{g.vehicle_type ?? <span className="text-slate-300">—</span>}</td>
                  <td className={`px-2 py-1 text-[10px] whitespace-nowrap ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {g.content ? <span className="block truncate max-w-[140px]" title={g.content}>{g.content}</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className={`px-2 py-1 text-[10px] whitespace-nowrap ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{g.entry_at ? formatTimestampTime(g.entry_at).slice(0, 5) : '—'}</td>
                  <td className={`px-2.5 py-1 text-[10px] text-right whitespace-nowrap tabular-nums ${dwellClass(mins)}`}>{fmtDwell(mins)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Block>
  )
}

function TripsBlock({ data, dark }: { data: ControlTowerData; dark?: boolean }) {
  const list = data.outbound.active ?? []
  return (
    <Block title="Chuyến đang soạn hàng" icon={PackageMinus} count={list.length} dark={dark}>
      {list.length === 0 ? (
        <p className="px-3 py-4 text-[11px] text-slate-400">Chưa có chuyến nào đang chạy.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {list.map((t: ControlTowerTrip) => {
            const pct = t.planned > 0 ? Math.min(100, Math.round((t.scanned / t.planned) * 100)) : 0
            const full = t.planned > 0 && t.scanned >= t.planned
            return (
              <div key={t.id} className={`px-2.5 py-1.5 ${dark ? 'border-slate-700/60' : ''}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[11px] font-mono font-semibold ${dark ? 'text-white' : ''}`}>{t.group_code}</span>
                  <span className={`text-[9px] px-1 rounded border font-medium ${dark ? 'text-sky-400 border-sky-500/60' : 'text-sky-500 border-sky-400/60'}`}>Xuất</span>
                  {t.status === 'PAUSED' && <span className="text-[9px] px-1.5 rounded-full bg-red-100 text-red-600 font-medium">Tạm dừng</span>}
                  {t.npp && <span className={`text-[10px] font-medium truncate max-w-[160px] ${dark ? 'text-slate-200' : 'text-slate-600'}`} title={t.npp}>{t.npp}</span>}
                  <span className={`text-[10px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{t.plate ?? ''}</span>
                  {t.warehouse_type && <span className={`text-[9px] px-1 rounded border ${dark ? 'text-sky-300 border-sky-500/50' : 'text-sky-600 border-sky-300'}`}>{t.warehouse_type}</span>}
                  {t.export_type && <span className={`text-[9px] ${dark ? 'text-slate-500' : 'text-slate-400'}`} title="Loại xe">{t.export_type}</span>}
                  {t.n_materials > 0 && <span className={`text-[9px] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{t.n_materials} mã</span>}
                  <span className={`ml-auto text-[10px] tabular-nums font-semibold ${full ? 'text-green-500' : dark ? 'text-sky-300' : 'text-sky-600'}`}>
                    {nf.format(t.scanned)}/{nf.format(t.planned)} · {pct}%
                  </span>
                </div>
                <div className={`mt-1 h-1.5 rounded ${dark ? 'bg-slate-700' : 'bg-slate-200'}`}>
                  <div className={`h-1.5 rounded ${full ? 'bg-green-500' : 'bg-sky-500'}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Block>
  )
}

function HourlyBlock({ data, dark }: { data: ControlTowerData; dark?: boolean }) {
  const rows = data.hourly ?? []
  const byH = new Map(rows.map(r => [r.h, r]))
  const dataHours = rows.map(r => r.h)
  const from = Math.min(6, ...(dataHours.length ? dataHours : [6]))
  const to   = Math.max(18, ...(dataHours.length ? dataHours : [18]))
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i)
  const maxV = Math.max(1, ...rows.map(r => Math.max(r.out_cartons, r.in_pallets)))
  return (
    <Block title="Nhịp độ theo giờ (thùng xuất / pallet nhập)" icon={Activity} dark={dark}>
      <div className="px-2.5 py-2">
        <div className="flex items-end gap-1 h-28">
          {hours.map(h => {
            const r = byH.get(h)
            const outH = r ? Math.round((r.out_cartons / maxV) * 100) : 0
            const inH  = r ? Math.round((r.in_pallets / maxV) * 100) : 0
            return (
              <div key={h} className="flex-1 flex items-end justify-center gap-px h-full"
                title={`${h}h — xuất ${nf.format(r?.out_cartons ?? 0)} thùng · nhập ${nf.format(r?.in_pallets ?? 0)} pallet`}>
                <div className="w-1/2 max-w-[14px] rounded-t bg-sky-500" style={{ height: `${outH}%`, minHeight: r?.out_cartons ? 2 : 0 }} />
                <div className="w-1/2 max-w-[14px] rounded-t bg-green-500" style={{ height: `${inH}%`, minHeight: r?.in_pallets ? 2 : 0 }} />
              </div>
            )
          })}
        </div>
        <div className="flex gap-1 mt-0.5">
          {hours.map(h => (
            <div key={h} className={`flex-1 text-center text-[8px] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{h}</div>
          ))}
        </div>
        <div className={`flex items-center gap-3 mt-1.5 text-[9px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-sky-500 inline-block" /> Thùng xuất</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-500 inline-block" /> Pallet nhập</span>
        </div>
      </div>
    </Block>
  )
}

function WeighBlock({ data, dark }: { data: ControlTowerData; dark?: boolean }) {
  const w = data.weigh
  const cell = `flex-1 rounded-md px-3 py-2 ${dark ? 'bg-slate-700/50' : 'bg-slate-50'}`
  const label = `text-[9px] uppercase ${dark ? 'text-slate-400' : 'text-slate-500'}`
  const num = `text-xl font-semibold tabular-nums ${dark ? 'text-white' : 'text-slate-800'}`
  return (
    <Block title="Trạm cân hôm nay" icon={Scale} dark={dark}>
      <div className="p-2.5 flex gap-2">
        <div className={cell}><div className={label}>Lượt cân</div><div className={num}>{nf.format(w.tickets)}</div></div>
        <div className={cell}><div className={label}>Chờ cân lần 2</div><div className={`${num} ${w.pending2 > 0 ? '!text-amber-500' : ''}`}>{nf.format(w.pending2)}</div></div>
        <div className={cell}><div className={label}>KL hàng (tấn)</div><div className={num}>{nf.format(Math.round(w.net_kg / 100) / 10)}</div></div>
      </div>
      {!dark && (
        <p className="px-2.5 pb-2 text-[10px]">
          <Link to="/wms/weigh-tickets" className="text-sky-600 hover:underline">Mở trang Phiếu cân →</Link>
        </p>
      )}
    </Block>
  )
}

// ─── trang chính ──────────────────────────────────────────────────────────────
export default function ControlTower() {
  const filters = useWmsFilterStore(s => s.controlTower)
  const setF    = useWmsFilterStore(s => s.setControlTower)
  const { data: warehouses = [] } = useScopedWarehouses(true)
  const { data: whTypes = [] } = useScopedWhTypes()
  const { data: allMaterials = [] } = useMaterials()   // danh mục mã (cache 5') — options filter Mã hàng
  const { data, isLoading, isError, error } = useControlTower(filters.warehouse_ids, filters.categories, filters.material_codes)

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const [tv, setTv] = useState(false)
  function enterTv() {
    setTv(true)
    document.documentElement.requestFullscreen?.().catch(() => {})   // không fullscreen được (iframe) vẫn vào TV
  }
  function exitTv() {
    setTv(false)
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  }
  useEffect(() => {   // user bấm Esc thoát fullscreen → thoát TV luôn
    const onFs = () => { if (!document.fullscreenElement) setTv(false) }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const filterDefs: FilterDef[] = [
    { key: 'warehouse', label: 'Kho', type: 'multi', searchable: true,
      options: (warehouses as { id: string; name: string }[]).map(w => ({ value: w.id, label: w.name })),
      selected: filters.warehouse_ids,
      onChange: v => setF({ warehouse_ids: v }) },
    { key: 'category', label: 'Loại kho', type: 'multi',
      options: (whTypes as { value: string }[]).map(t => ({ value: t.value, label: t.value })),
      selected: filters.categories,
      onChange: v => setF({ categories: v }) },
    // Soi đích danh mã (kể cả mã ngoài top 30) — chỉ ảnh hưởng 2 khối hàng-theo-mã
    { key: 'material', label: 'Mã hàng', type: 'multi', searchable: true,
      options: allMaterials.map(m => ({ value: m.material_code, label: `${m.material_code} — ${m.short_name ?? ''}` })),
      selected: filters.material_codes,
      onChange: v => setF({ material_codes: v }) },
  ]

  const clock = now.toLocaleTimeString('vi-VN', { hour12: false })
  // Chips tóm tắt filter đang áp — hiện trên header TV (màn thường đã có FilterBar)
  const whNameById = new Map((warehouses as { id: string; name: string }[]).map(w => [w.id, w.name]))
  const tvFilterChips: string[] = []
  if (filters.warehouse_ids.length > 0) tvFilterChips.push('Kho: ' + filters.warehouse_ids.map(id => whNameById.get(id) ?? id).join(', '))
  if (filters.categories.length > 0) tvFilterChips.push('Loại: ' + filters.categories.join(', '))
  if (filters.material_codes.length > 0) tvFilterChips.push(`Mã hàng: ${filters.material_codes.length} mã`)
  const loosePlanned = data?.outbound.loose_planned ?? 0
  const loosePct = data && data.outbound.planned > 0
    ? Math.round((loosePlanned / data.outbound.planned) * 100) : 0
  const tiles = data ? [
    { label: 'Xe trong cổng', value: data.gate.inside, accent: data.gate.inside > 0 },
    { label: 'Xe chờ gọi', value: data.gate.registered + data.gate.called },
    { label: 'Chuyến hôm nay', value: data.outbound.total },
    { label: 'Đang soạn', value: data.outbound.in_progress, accent: data.outbound.in_progress > 0 },
    { label: 'Chuyến xong', value: data.outbound.completed },
    { label: 'Mã hàng xuất', value: data.out_by_material?.n_materials ?? 0 },
    { label: 'Nhặt lẻ (thùng)', value: nf.format(loosePlanned) },
    { label: 'Tỷ lệ nhặt lẻ', value: `${loosePct}%` },
    { label: 'Pallet nhập', value: nf.format(data.inbound.pallets) },
    { label: 'Lượt cân', value: data.weigh.tickets },
  ] : []

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-2 sm:rounded-t-xl">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 shrink-0">
            <Activity className="h-4 w-4 text-sky-600" /> Giám sát vận hành
          </span>
          <span className="text-[11px] text-slate-500">{data ? formatDate(data.date) : ''}</span>
          <span className="text-[11px] font-mono text-slate-600 tabular-nums">{clock}</span>
          <span className="flex-1" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
          <button onClick={enterTv}
            className="h-7 px-2.5 rounded-md border border-slate-300 text-[11px] font-medium text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
            <Tv className="h-3.5 w-3.5" /> Chế độ TV
          </button>
        </div>
        <FilterBar defs={filterDefs} />
      </div>

      <SummaryBand tiles={tiles} />

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {isLoading ? (
          <p className="p-6 text-center text-sm text-slate-400">Đang tải số liệu…</p>
        ) : isError ? (
          <div className="p-6 text-center text-sm text-red-500">
            {(error as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi tải số liệu giám sát.'}
          </div>
        ) : data ? (
          <>
            <OutProgressStrip data={data} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-3">
              <OutMatBlock data={data} />
              <TripsBlock data={data} />
              <InMatBlock data={data} />
              <GateBlock data={data} now={now} />
              <WeighBlock data={data} />
              <HourlyBlock data={data} />
            </div>
          </>
        ) : null}
      </div>
     </div>

      {tv && data && (
        // z-[45]: TRÊN app chrome (header z-40) nhưng DƯỚI Dialog z-50 — để sheet bộ lọc mở đè lên TV được
        <div className="fixed inset-0 z-[45] bg-slate-900 text-slate-100 flex flex-col p-4 gap-3 overflow-auto">
          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            <Activity className="h-6 w-6 text-sky-400" />
            <span className="text-xl font-semibold">Giám sát vận hành</span>
            <span className="text-sm text-slate-400">{formatDate(data.date)}</span>
            {/* Filter trên TV (user chốt): chips đang-lọc-gì + nút mở sheet chỉnh lọc */}
            {tvFilterChips.map(c => (
              <span key={c} className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/40 max-w-[300px] truncate" title={c}>{c}</span>
            ))}
            <FilterSheetButton defs={filterDefs} />
            <span className="ml-auto text-3xl font-mono font-semibold tabular-nums text-sky-300">{clock}</span>
            <button onClick={exitTv} className="p-2 rounded-md hover:bg-white/10" title="Thoát chế độ TV">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-2 shrink-0">
            {tiles.map(t => (
              <div key={t.label} className={`rounded-lg px-3 py-2 ${t.accent ? 'bg-sky-600' : 'bg-slate-800'}`}>
                <div className="text-[10px] uppercase text-slate-300">{t.label}</div>
                <div className="text-2xl lg:text-3xl font-semibold tabular-nums">{t.value}</div>
              </div>
            ))}
          </div>
          <OutProgressStrip data={data} dark />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-0">
            <OutMatBlock data={data} dark />
            <TripsBlock data={data} dark />
            <InMatBlock data={data} dark />
            <GateBlock data={data} now={now} dark />
          </div>
        </div>
      )}
    </div>
  )
}
