// Control Tower — Giám sát vận hành trong ngày. 20/08: trình bày lại theo phong cách
// Manhattan "Unified Distribution Control / Facility Console" (user đưa mẫu).
// 25/08 (chiến dịch UI đợt 3): màn THƯỜNG theo tông SÁNG như phần còn lại của app, màn TV treo
// tường GIỮ TỐI (overlay bọc class `dark` — xem cuối file). Mọi khối viết class sáng làm mặc định
// + biến thể `dark:`, nên cũng tự chạy đúng khi user bật chế độ tối toàn app (uiStore.theme).
// Bố cục:
//   · dải KPI chu trình (dwell xe, đăng ký→vào, vào→ra, tồn sạch %, tiến độ xuất)
//   · rail RESOURCES trái (nhân sự theo khâu + top người quét + xe nâng + tồn bị giữ)
//   · 2 panel INBOUND / OUTBOUND (số to + thanh trạng thái xếp chồng)
//   · hàng DEPARTMENTS: card từng khâu với donut % (Cổng / Xuất / Nhặt lẻ / Nhập / Cân)
//   · các khối chi tiết giữ nguyên (hàng theo mã, chuyến đang soạn, xe trong cổng, nhịp giờ)
// Realtime + refetch 60s. Chế độ TV = fullscreen chính console này (đồng hồ to).
// Dữ liệu: RPC control_tower_stats + control_tower_resources (BE gộp 1 request).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Tv, X, Truck, PackageMinus, PackagePlus, Scale, Users, Forklift, ShieldAlert } from 'lucide-react'
import type { AxiosError } from 'axios'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { useControlTower, useMaterials, useGateDwellThresholds, type ControlTowerData, type ControlTowerGateRow, type ControlTowerTrip, type ControlTowerResources } from '@/api/hooks'
import { useScopedWarehouses, useScopedWhTypes } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { formatDate, formatTimestampTime } from '@/utils/formatters'
import { QTY_CONVERTED_LABEL, QTY_CONVERTED_TIP } from '@/utils/qtyUnits'

const nf = new Intl.NumberFormat('vi-VN')

// ─── helpers ──────────────────────────────────────────────────────────────────
function dwellMinutes(entryAt: string | null, now: Date): number | null {
  if (!entryAt) return null
  const t = new Date(entryAt).getTime()
  if (isNaN(t)) return null
  return Math.max(0, Math.floor((now.getTime() - t) / 60000))
}
function dwellClass(mins: number | null, warn: number, crit: number): string {
  if (mins == null) return 'text-slate-500 dark:text-slate-400'
  if (mins > crit) return 'text-red-500 font-semibold'
  if (mins > warn) return 'text-amber-500 font-semibold'
  return 'text-slate-500 dark:text-slate-400'
}
function fmtDwell(mins: number | null): string {
  if (mins == null) return '—'
  if (mins < 60) return `${mins}p`
  return `${Math.floor(mins / 60)}g${String(mins % 60).padStart(2, '0')}`
}
// KPI chu trình kiểu Manhattan: "hh:mm" + chú thích "giờ:phút"
function fmtHM(mins: number | null | undefined): string {
  if (mins == null) return '—'
  return `${Math.floor(mins / 60)}:${String(Math.round(mins) % 60).padStart(2, '0')}`
}
const pctOf = (num: number, den: number): number | null =>
  den > 0 ? Math.min(100, Math.round((num / den) * 100)) : null

// ─── khối kiểu console (nền tối) ──────────────────────────────────────────────
function Block({ title, icon: Icon, count, extra, children }: {
  title: string; icon: typeof Truck; count?: number; extra?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border flex flex-col min-h-0 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b shrink-0 border-slate-200 dark:border-slate-700">
        <span className="w-1 h-3.5 rounded bg-sky-500 shrink-0" />
        <Icon className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">{title}</span>
        {count != null && <span className="text-[10px] font-semibold text-sky-700 dark:text-sky-300">({nf.format(count)})</span>}
        {extra}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  )
}

// Donut % kiểu Manhattan (conic-gradient, không thư viện)
function Donut({ pct, color = '#22c55e', size = 56 }: { pct: number | null; color?: string; size?: number }) {
  const p = pct ?? 0
  // Vành khuyết (phần chưa đạt) phải đổi theo tông — hex cứng thì trên nền SÁNG nhìn như lỗi hiển
  // thị. conic-gradient không nhận class Tailwind nên đi qua CSS variable.
  return (
    <div className="rounded-full grid place-items-center shrink-0 [--dn-track:#e2e8f0] dark:[--dn-track:#334155]"
      style={{ width: size, height: size, background: `conic-gradient(${color} ${p * 3.6}deg, var(--dn-track) 0deg)` }}>
      <div className="rounded-full bg-white dark:bg-slate-800 grid place-items-center"
        style={{ width: size - 12, height: size - 12 }}>
        <span className="text-[13px] font-semibold tabular-nums text-slate-900 dark:text-white">{pct == null ? '—' : `${p}%`}</span>
      </div>
    </div>
  )
}

// Ô KPI chu trình (dải trên cùng)
function KpiTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'ok' | 'warn' | 'crit' }) {
  const vCls = accent === 'crit' ? 'text-red-600 dark:text-red-400' : accent === 'warn' ? 'text-amber-600 dark:text-amber-400' : accent === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-slate-900 dark:text-white'
  return (
    <div className="rounded-lg bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 px-3 py-2 min-w-0">
      <div className="text-[9px] uppercase tracking-wide text-slate-500 dark:text-slate-400 truncate" title={label}>{label}</div>
      <div className={`text-2xl font-semibold tabular-nums leading-tight ${vCls}`}>{value}</div>
      {sub && <div className="text-[9px] text-slate-500 truncate" title={sub}>{sub}</div>}
    </div>
  )
}

// Thanh trạng thái xếp chồng (INBOUND/OUTBOUND panel)
function StackBar({ segs }: { segs: { v: number; cls: string; label: string }[] }) {
  const total = segs.reduce((s, x) => s + x.v, 0)
  return (
    <div className="h-3 rounded bg-slate-200 dark:bg-slate-700 flex overflow-hidden">
      {total > 0 && segs.filter(s => s.v > 0).map((s, i) => (
        <div key={i} className={`${s.cls} h-3`} style={{ width: `${(s.v / total) * 100}%` }}
          title={`${s.label}: ${nf.format(s.v)}`} />
      ))}
    </div>
  )
}
function LegendNum({ dot, label, value, to }: { dot: string; label: string; value: number | string; to?: string }) {
  const inner = (
    <span className="flex items-center gap-1.5 min-w-0">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
      <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{label}</span>
      <span className="text-base italic font-semibold tabular-nums text-slate-800 dark:text-slate-100">{typeof value === 'number' ? nf.format(value) : value}</span>
    </span>
  )
  return to ? <Link to={to} className="hover:opacity-80">{inner}</Link> : inner
}

// Card từng KHÂU (hàng DEPARTMENTS) — donut % + vài dòng số + link mở trang
function DeptCard({ title, pct, color, big, rows, to }: {
  title: string; pct: number | null; color?: string; big?: string
  rows: { label: string; value: string; cls?: string }[]; to: string
}) {
  return (
    <Link to={to} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 hover:border-slate-300 dark:hover:border-slate-500 transition-colors flex flex-col min-w-0">
      <div className="px-2.5 py-1.5 border-b border-slate-200 dark:border-slate-700 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 text-center">{title}</div>
      <div className="flex items-center gap-2.5 px-2.5 py-2 flex-1">
        {big != null
          ? <div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white shrink-0">{big}</div>
          : <Donut pct={pct} color={color} size={48} />}
        <div className="min-w-0 flex-1 space-y-0.5">
          {rows.map(r => (
            <div key={r.label} className="flex items-baseline justify-between gap-1.5 text-[9px]">
              <span className="text-slate-500 dark:text-slate-400 truncate" title={r.label}>{r.label}</span>
              <span className={`tabular-nums font-semibold text-[10px] shrink-0 ${r.cls ?? 'text-slate-800 dark:text-slate-100'}`}>{r.value}</span>
            </div>
          ))}
        </div>
      </div>
    </Link>
  )
}

// ─── rail RESOURCES (trái) — nhân sự + xe nâng + tồn bị giữ ───────────────────
function ResourceRail({ r }: { r: ControlTowerResources }) {
  const maxScans = Math.max(1, ...r.top_out.map(t => t.scans))
  const row = (label: string, n: number, sub: string) => (
    <div className="flex items-baseline justify-between gap-2 px-2.5 py-1 text-[10px]">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="tabular-nums text-slate-800 dark:text-slate-100"><b className="text-sm">{nf.format(n)}</b> người · {sub}</span>
    </div>
  )
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 flex flex-col min-h-0">
      <div className="px-2.5 py-1.5 border-b border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
        <Users className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">Nguồn lực hôm nay</span>
      </div>

      <div className="py-1 border-b border-slate-200 dark:border-slate-700/60">
        <div className="px-2.5 pt-1 text-[9px] uppercase text-slate-500">Nhân sự theo khâu</div>
        {row('Quét xuất', r.staff_out.n, `${nf.format(r.staff_out.scans)} lượt`)}
        {row('Nhập kho', r.staff_in.n, `${nf.format(r.staff_in.pallets)} pallet`)}
        {row('Kiểm / chuyển vị trí', r.stocktake.n, `${nf.format(r.stocktake.checks)} lượt`)}
        {r.stocktake.moves > 0 && (
          <div className="px-2.5 pb-1 text-[9px] text-slate-500">trong đó {nf.format(r.stocktake.moves)} lượt chuyển vị trí</div>
        )}
      </div>

      {r.top_out.length > 0 && (
        <div className="py-1 border-b border-slate-200 dark:border-slate-700/60">
          <div className="px-2.5 pt-1 pb-0.5 text-[9px] uppercase text-slate-500">Top người quét xuất</div>
          {r.top_out.map(t => (
            <div key={t.name} className="px-2.5 py-0.5">
              <div className="flex items-baseline justify-between gap-2 text-[10px]">
                <span className="text-slate-600 dark:text-slate-300 truncate" title={t.name}>{t.name}</span>
                <span className="tabular-nums text-slate-800 dark:text-slate-100 font-semibold">{nf.format(t.scans)}</span>
              </div>
              <div className="h-1 rounded bg-slate-200 dark:bg-slate-700 mt-0.5">
                <div className="h-1 rounded bg-sky-500" style={{ width: `${(t.scans / maxScans) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="py-1 border-b border-slate-200 dark:border-slate-700/60">
        <div className="px-2.5 pt-1 pb-0.5 text-[9px] uppercase text-slate-500 flex items-center gap-1">
          <Forklift className="h-3 w-3" /> Xe nâng (check list ngày)
        </div>
        <div className="px-2.5 pb-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
          <span className="text-slate-500 dark:text-slate-400">Hoạt động</span>
          <span className="text-right tabular-nums font-semibold text-green-600 dark:text-green-400">{nf.format(r.forklift.active)}</span>
          <span className="text-slate-500 dark:text-slate-400">Xe nghỉ</span>
          <span className="text-right tabular-nums font-semibold text-slate-700 dark:text-slate-200">{nf.format(r.forklift.idle)}</span>
          <span className="text-slate-500 dark:text-slate-400">Chưa check</span>
          <span className={`text-right tabular-nums font-semibold ${r.forklift.unchecked > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'}`}>{nf.format(r.forklift.unchecked)}</span>
          <span className="text-slate-500 dark:text-slate-400">Hạng mục lỗi</span>
          <span className={`text-right tabular-nums font-semibold ${r.forklift.issues > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`}>{nf.format(r.forklift.issues)}</span>
        </div>
        <Link to="/wms/forklift" className="block px-2.5 pb-1 text-[9px] text-sky-600 dark:text-sky-400 hover:underline">Mở trang Xe nâng →</Link>
      </div>

      <div className="py-1.5 px-2.5">
        <div className="text-[9px] uppercase text-slate-500 flex items-center gap-1"><ShieldAlert className="h-3 w-3" /> Tồn bị giữ (QA / cách ly)</div>
        <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
          <b className={`text-sm tabular-nums ${r.inventory.locked > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>{nf.format(r.inventory.locked)}</b>
          {' '}/ {nf.format(r.inventory.total)} pallet đang tồn
        </div>
      </div>
    </div>
  )
}

// ─── dải tiến độ xuất (giữ từ bản cũ — user chốt 16/07) ───────────────────────
function OutProgressStrip({ data }: { data: ControlTowerData }) {
  const o = data.outbound
  const remaining = Math.max(0, o.planned - o.scanned)
  const pct = pctOf(o.scanned, o.planned) ?? 0
  const full = o.planned > 0 && o.scanned >= o.planned
  return (
    <div className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60">
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">Tiến độ xuất hôm nay</span>
        <span className="text-[9px] uppercase text-slate-500 dark:text-slate-400">Kế hoạch <span className="font-semibold tabular-nums text-slate-900 dark:text-white text-sm">{nf.format(o.planned)}</span></span>
        <span className="text-[9px] uppercase text-slate-500 dark:text-slate-400">Đã xuất <span className={`font-semibold tabular-nums text-sm ${full ? 'text-green-600 dark:text-green-400' : 'text-sky-600 dark:text-sky-400'}`}>{nf.format(o.scanned)}</span></span>
        <span className="text-[9px] uppercase text-slate-500 dark:text-slate-400">Còn lại <span className={`font-semibold tabular-nums text-sm ${remaining > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>{nf.format(remaining)}</span></span>
        <span className={`ml-auto text-lg font-semibold tabular-nums ${full ? 'text-green-600 dark:text-green-400' : 'text-sky-700 dark:text-sky-300'}`}>{pct}%</span>
      </div>
      <div className="mt-1.5 h-2.5 rounded bg-slate-200 dark:bg-slate-700">
        <div className={`h-2.5 rounded ${full ? 'bg-green-500' : 'bg-sky-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ─── 2 panel INBOUND / OUTBOUND (legend số to + thanh xếp chồng) ──────────────
function OutboundPanel({ data }: { data: ControlTowerData }) {
  const o = data.outbound
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60">
      <div className="px-2.5 py-1.5 border-b border-slate-200 dark:border-slate-700 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 text-center">Outbound — chuyến xuất</div>
      <div className="px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-4 flex-wrap">
          <LegendNum dot="bg-slate-400" label="Chờ soạn" value={o.pending} to="/wms/outbound" />
          <LegendNum dot="bg-sky-500" label="Đang soạn" value={o.in_progress} to="/wms/outbound" />
          {o.paused > 0 && <LegendNum dot="bg-red-500" label="Tạm dừng" value={o.paused} to="/wms/outbound" />}
          <LegendNum dot="bg-green-500" label="Hoàn thành" value={o.completed} to="/wms/outbound" />
          <span className="ml-auto text-[10px] text-slate-500">{nf.format(o.total)} chuyến</span>
        </div>
        <StackBar segs={[
          { v: o.pending, cls: 'bg-slate-400', label: 'Chờ soạn' },
          { v: o.in_progress, cls: 'bg-sky-500', label: 'Đang soạn' },
          { v: o.paused, cls: 'bg-red-500', label: 'Tạm dừng' },
          { v: o.completed, cls: 'bg-green-500', label: 'Hoàn thành' },
        ]} />
      </div>
    </div>
  )
}
function InboundPanel({ data }: { data: ControlTowerData }) {
  const i = data.inbound
  const hours = data.hourly ?? []
  const maxIn = Math.max(1, ...hours.map(h => h.in_pallets))
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60">
      <div className="px-2.5 py-1.5 border-b border-slate-200 dark:border-slate-700 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 text-center">Inbound — nhận hàng</div>
      <div className="px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-4 flex-wrap">
          <LegendNum dot="bg-violet-500" label="Phiếu nhập" value={i.orders} to="/wms/inbound" />
          <LegendNum dot="bg-green-500" label="Pallet đã nhận" value={i.pallets} to="/wms/inbound" />
          <span className="text-[10px] text-slate-500 dark:text-slate-400" title={QTY_CONVERTED_TIP}>{QTY_CONVERTED_LABEL}
            <span className="ml-1 text-base italic font-semibold tabular-nums text-slate-800 dark:text-slate-100">{nf.format(i.cartons)}</span>
          </span>
        </div>
        {/* nhịp pallet nhận theo giờ — thu nhỏ trong panel */}
        <div className="flex items-end gap-px h-6">
          {hours.map(h => (
            <div key={h.h} className="flex-1 rounded-t bg-green-500/80"
              style={{ height: `${Math.round((h.in_pallets / maxIn) * 100)}%`, minHeight: h.in_pallets ? 2 : 0 }}
              title={`${h.h}h — ${nf.format(h.in_pallets)} pallet`} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── các khối chi tiết (giữ từ bản cũ, cố định nền tối) ───────────────────────
function OutMatBlock({ data }: { data: ControlTowerData }) {
  const list = data.out_by_material?.list ?? []
  const total = data.out_by_material?.n_materials ?? 0
  const nDone = data.out_by_material?.n_done ?? 0
  const nShort = data.out_by_material?.n_short ?? 0
  return (
    <Block title="Hàng xuất hôm nay theo mã" icon={PackageMinus} count={total}
      extra={total > 0 ? (
        <span className="ml-auto flex items-center gap-1.5 text-[9px] font-medium">
          <span className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400">{nf.format(nDone)} đủ</span>
          <span className={`px-1.5 py-0.5 rounded-full ${nShort > 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400' : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>{nf.format(nShort)} còn thiếu</span>
        </span>
      ) : undefined}>
      {list.length === 0 ? (
        <p className="px-3 py-4 text-[11px] text-slate-500 dark:text-slate-400">Chưa có kế hoạch xuất hôm nay.</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-[8px] uppercase text-slate-500">
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
              const pct = pctOf(m.scanned, m.ordered) ?? 0
              const full = m.ordered > 0 && m.scanned >= m.ordered
              return (
                <tr key={m.code} className="border-b last:border-0 border-slate-200 dark:border-slate-700/60">
                  <td className="px-2.5 py-1 whitespace-nowrap">
                    <div className="text-[10px] font-medium truncate max-w-[180px] text-slate-900 dark:text-white" title={`${m.code} — ${m.name}`}>{m.name}</div>
                    <div className="text-[8px] text-slate-500">{m.code} · {m.category}{m.loose > 0 ? ` · lẻ ${nf.format(m.loose)}` : ''}</div>
                  </td>
                  <td className="px-1 py-1 text-right text-[10px] tabular-nums whitespace-nowrap text-slate-600 dark:text-slate-300">{nf.format(m.ordered)}</td>
                  <td className={`px-1 py-1 text-right text-[10px] tabular-nums font-semibold whitespace-nowrap ${full ? 'text-green-500' : 'text-sky-700 dark:text-sky-300'}`}>{nf.format(m.scanned)}</td>
                  <td className={`px-1 py-1 text-right text-[10px] tabular-nums whitespace-nowrap ${remaining > 0 ? 'text-amber-500' : 'text-slate-500'}`}>{nf.format(remaining)}</td>
                  <td className="px-2.5 py-1 w-24">
                    <div className="flex items-center gap-1">
                      <div className="flex-1 h-1.5 rounded bg-slate-200 dark:bg-slate-700">
                        <div className={`h-1.5 rounded ${full ? 'bg-green-500' : 'bg-sky-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[9px] tabular-nums w-7 text-right text-slate-500 dark:text-slate-400">{pct}%</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {total > list.length && (
        <p className="px-2.5 py-1 text-[9px] border-t text-slate-500 border-slate-200 dark:border-slate-700/60">
          Hiện 30 mã cần chú ý nhất (còn thiếu nhiều nhất) trong {nf.format(total)} mã — lọc Kho / Loại kho / Mã hàng để soi phần còn lại.
        </p>
      )}
    </Block>
  )
}

function InMatBlock({ data }: { data: ControlTowerData }) {
  const list = data.in_by_material?.list ?? []
  const total = data.in_by_material?.n_materials ?? 0
  const orders = data.inbound.orders
  return (
    <Block title="Hàng nhập hôm nay theo mã" icon={PackagePlus} count={total}
      extra={
        <span className={`ml-auto text-[9px] font-medium px-1.5 py-0.5 rounded-full ${orders > 0 ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400' : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}
          title="Số phiếu nhập (lệnh nhập) trong ngày. Pallet không đi kèm phiếu = tạo từ upload Tồn kho.">
          {nf.format(orders)} phiếu nhập
        </span>
      }>
      {list.length === 0 ? (
        <p className="px-3 py-4 text-[11px] text-slate-500 dark:text-slate-400">Chưa có hàng nhập hôm nay.</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-[8px] uppercase text-slate-500">
              <th className="px-2.5 py-1 text-left font-medium">Mã hàng</th>
              <th className="px-1 py-1 text-right font-medium">Pallet</th>
              <th className="px-2.5 py-1 text-right font-medium" title={QTY_CONVERTED_TIP}>{QTY_CONVERTED_LABEL}</th>
            </tr>
          </thead>
          <tbody>
            {list.map(m => (
              <tr key={m.code} className="border-b last:border-0 border-slate-200 dark:border-slate-700/60">
                <td className="px-2.5 py-1 whitespace-nowrap">
                  <div className="text-[10px] font-medium truncate max-w-[200px] text-slate-900 dark:text-white" title={`${m.code} — ${m.name}`}>{m.name}</div>
                  <div className="text-[8px] text-slate-500">{m.code} · {m.category}</div>
                </td>
                <td className="px-1 py-1 text-right text-[10px] tabular-nums whitespace-nowrap text-slate-600 dark:text-slate-300">{nf.format(m.pallets)}</td>
                <td className="px-2.5 py-1 text-right text-[10px] tabular-nums font-semibold whitespace-nowrap text-green-600 dark:text-green-400">
                  {nf.format(m.cartons)}
                  {m.unit && <span className="ml-1 font-normal text-slate-500">{m.unit}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Block>
  )
}

function GateBlock({ data, now }: { data: ControlTowerData; now: Date }) {
  const dwellTh = useGateDwellThresholds()   // cùng ngưỡng với cảnh báo GATE_DWELL
  const list = data.gate.inside_list ?? []
  return (
    <Block title="Xe trong cổng" icon={Truck} count={data.gate.inside}>
      {list.length === 0 ? (
        <p className="px-3 py-4 text-[11px] text-slate-500 dark:text-slate-400">Không có xe nào trong cổng.</p>
      ) : (
        <table className="w-full">
          <tbody>
            {list.map((g: ControlTowerGateRow, i) => {
              const mins = dwellMinutes(g.entry_at, now)
              return (
                <tr key={i} className="border-b last:border-0 border-slate-200 dark:border-slate-700/60">
                  <td className="px-2.5 py-1 text-[11px] font-mono font-semibold whitespace-nowrap text-slate-900 dark:text-white">{g.plate ?? '—'}</td>
                  <td className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-600 dark:text-slate-300">
                    <span className={`px-1 rounded border text-[9px] font-medium mr-1 ${g.direction === 'INBOUND' ? 'text-green-500 border-green-400/60' : 'text-sky-500 border-sky-400/60'}`}>
                      {g.direction === 'INBOUND' ? 'Nhập' : 'Xuất'}
                    </span>
                    <span className="truncate">{g.company ?? '—'}</span>
                  </td>
                  <td className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-500 dark:text-slate-400">{g.warehouse_name ?? '—'}</td>
                  <td className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-500 dark:text-slate-400">{g.warehouse_type ?? <span className="text-slate-500 dark:text-slate-600">—</span>}</td>
                  <td className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-500 dark:text-slate-400">{g.vehicle_type ?? <span className="text-slate-500 dark:text-slate-600">—</span>}</td>
                  <td className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-500 dark:text-slate-400">
                    {g.content ? <span className="block truncate max-w-[140px]" title={g.content}>{g.content}</span> : <span className="text-slate-500 dark:text-slate-600">—</span>}
                  </td>
                  <td className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-500 dark:text-slate-400">{g.entry_at ? formatTimestampTime(g.entry_at).slice(0, 5) : '—'}</td>
                  <td className={`px-2.5 py-1 text-[10px] text-right whitespace-nowrap tabular-nums ${dwellClass(mins, dwellTh.warn, dwellTh.crit)}`}>{fmtDwell(mins)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Block>
  )
}

function TripsBlock({ data }: { data: ControlTowerData }) {
  const list = data.outbound.active ?? []
  return (
    <Block title="Chuyến đang soạn hàng" icon={PackageMinus} count={list.length}>
      {list.length === 0 ? (
        <p className="px-3 py-4 text-[11px] text-slate-500 dark:text-slate-400">Chưa có chuyến nào đang chạy.</p>
      ) : (
        <div className="divide-y divide-slate-700/60">
          {list.map((t: ControlTowerTrip) => {
            const pct = pctOf(t.scanned, t.planned) ?? 0
            const full = t.planned > 0 && t.scanned >= t.planned
            return (
              <div key={t.id} className="px-2.5 py-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-mono font-semibold text-slate-900 dark:text-white">{t.group_code}</span>
                  <span className="text-[9px] px-1 rounded border font-medium text-sky-600 dark:text-sky-400 border-sky-500/60">Xuất</span>
                  {t.status === 'PAUSED' && <span className="text-[9px] px-1.5 rounded-full bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400 font-medium">Tạm dừng</span>}
                  {t.npp && <span className="text-[10px] font-medium truncate max-w-[160px] text-slate-700 dark:text-slate-200" title={t.npp}>{t.npp}</span>}
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">{t.plate ?? ''}</span>
                  {t.warehouse_type && <span className="text-[9px] px-1 rounded border text-sky-700 dark:text-sky-300 border-sky-500/50">{t.warehouse_type}</span>}
                  {t.export_type && <span className="text-[9px] text-slate-500" title="Loại xe">{t.export_type}</span>}
                  {t.n_materials > 0 && <span className="text-[9px] text-slate-500">{t.n_materials} mã</span>}
                  <span className={`ml-auto text-[10px] tabular-nums font-semibold ${full ? 'text-green-500' : 'text-sky-700 dark:text-sky-300'}`}>
                    {nf.format(t.scanned)}/{nf.format(t.planned)} · {pct}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded bg-slate-200 dark:bg-slate-700">
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

function HourlyBlock({ data }: { data: ControlTowerData }) {
  const rows = data.hourly ?? []
  const byH = new Map(rows.map(r => [r.h, r]))
  const dataHours = rows.map(r => r.h)
  const from = Math.min(6, ...(dataHours.length ? dataHours : [6]))
  const to   = Math.max(18, ...(dataHours.length ? dataHours : [18]))
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i)
  const maxV = Math.max(1, ...rows.map(r => Math.max(r.out_cartons, r.in_pallets)))
  return (
    <Block title="Nhịp độ theo giờ (SL xuất quy đổi / pallet nhập)" icon={Activity}>
      <div className="px-2.5 py-2">
        <div className="flex items-end gap-1 h-28">
          {hours.map(h => {
            const r = byH.get(h)
            const outH = r ? Math.round((r.out_cartons / maxV) * 100) : 0
            const inH  = r ? Math.round((r.in_pallets / maxV) * 100) : 0
            return (
              <div key={h} className="flex-1 flex items-end justify-center gap-px h-full"
                title={`${h}h — xuất ${nf.format(r?.out_cartons ?? 0)} (SL quy đổi) · nhập ${nf.format(r?.in_pallets ?? 0)} pallet`}>
                <div className="w-1/2 max-w-[14px] rounded-t bg-sky-500" style={{ height: `${outH}%`, minHeight: r?.out_cartons ? 2 : 0 }} />
                <div className="w-1/2 max-w-[14px] rounded-t bg-green-500" style={{ height: `${inH}%`, minHeight: r?.in_pallets ? 2 : 0 }} />
              </div>
            )
          })}
        </div>
        <div className="flex gap-1 mt-0.5">
          {hours.map(h => (
            <div key={h} className="flex-1 text-center text-[8px] text-slate-500">{h}</div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-1.5 text-[9px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1" title={QTY_CONVERTED_TIP}><span className="w-2 h-2 rounded-sm bg-sky-500 inline-block" /> SL xuất (quy đổi)</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-500 inline-block" /> Pallet nhập</span>
        </div>
      </div>
    </Block>
  )
}

function WeighBlock({ data }: { data: ControlTowerData }) {
  const w = data.weigh
  const cell = 'flex-1 rounded-md px-3 py-2 bg-slate-200 dark:bg-slate-700/50'
  const label = 'text-[9px] uppercase text-slate-500 dark:text-slate-400'
  const num = 'text-xl font-semibold tabular-nums text-slate-900 dark:text-white'
  return (
    <Block title="Trạm cân hôm nay" icon={Scale}>
      <div className="p-2.5 flex gap-2">
        <div className={cell}><div className={label}>Lượt cân</div><div className={num}>{nf.format(w.tickets)}</div></div>
        <div className={cell}><div className={label}>Chờ cân lần 2</div><div className={`${num} ${w.pending2 > 0 ? '!text-amber-600 dark:text-amber-400' : ''}`}>{nf.format(w.pending2)}</div></div>
        <div className={cell}><div className={label}>KL hàng (tấn)</div><div className={num}>{nf.format(Math.round(w.net_kg / 100) / 10)}</div></div>
      </div>
      <p className="px-2.5 pb-2 text-[10px]">
        <Link to="/wms/weigh-tickets" className="text-sky-600 dark:text-sky-400 hover:underline">Mở trang Phiếu cân →</Link>
      </p>
    </Block>
  )
}

// ─── thân console (dùng chung màn thường + TV) ────────────────────────────────
// `tv` = đang chiếu lên màn treo tường: xem từ 3–5m nên (a) phóng to toàn bộ theo bề rộng màn,
// (b) BỎ HẲN khối rỗng — trên bàn làm việc câu "Chưa có hàng nhập hôm nay" là thông tin, trên TV
// nó chỉ là ô trống chiếm nửa màn hình mà không nói gì (user 25/08: "tivi xấu quá").
function ConsoleBody({ data, now, tv = false }: { data: ControlTowerData; now: Date; tv?: boolean }) {
  const dwellTh = useGateDwellThresholds()
  const r = data.resources ?? null

  // KPI chu trình — dwell TB xe ĐANG trong cổng tính sống từ danh sách
  const insideMins = (data.gate.inside_list ?? [])
    .map(g => dwellMinutes(g.entry_at, now)).filter((m): m is number => m != null)
  const dwellAvg = insideMins.length ? Math.round(insideMins.reduce((s, m) => s + m, 0) / insideMins.length) : null
  const cleanPct = r && r.inventory.total > 0 ? Math.round(((r.inventory.total - r.inventory.locked) / r.inventory.total) * 100) : null
  const outPct = pctOf(data.outbound.scanned, data.outbound.planned)
  const loosePct = pctOf(data.outbound.loose_scanned ?? 0, data.outbound.loose_planned ?? 0)
  const gateTotal = data.gate.registered + data.gate.called + data.gate.inside + data.gate.completed
  const weighDonePct = pctOf(data.weigh.tickets - data.weigh.pending2, data.weigh.tickets)

  return (
    <div className="space-y-3">
      {/* Dải KPI chu trình (kiểu Manhattan hh:mm) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
        <KpiTile label="Dwell xe trong cổng" value={fmtHM(dwellAvg)}
          sub={`giờ:phút · ${nf.format(data.gate.inside)} xe đang trong cổng`}
          accent={dwellAvg == null ? undefined : dwellAvg > dwellTh.crit ? 'crit' : dwellAvg > dwellTh.warn ? 'warn' : 'ok'} />
        <KpiTile label="Đăng ký → vào cổng TB" value={fmtHM(r?.gate_cycle.wait_mins)} sub="giờ:phút · hôm nay" />
        <KpiTile label="Vào → ra cổng TB" value={fmtHM(r?.gate_cycle.inout_mins)}
          sub={`giờ:phút · ${nf.format(r?.gate_cycle.done_n ?? 0)} xe đã ra`} />
        <KpiTile label="Tồn sạch / QA giữ" value={cleanPct == null ? '—' : `${cleanPct}%`}
          sub={r ? `${nf.format(r.inventory.locked)} pallet đang bị giữ` : ''}
          accent={cleanPct == null ? undefined : cleanPct >= 97 ? 'ok' : cleanPct >= 90 ? 'warn' : 'crit'} />
        <KpiTile label="Tiến độ xuất hôm nay" value={outPct == null ? '—' : `${outPct}%`}
          sub={`${nf.format(data.outbound.scanned)} / ${nf.format(data.outbound.planned)} (quy đổi)`}
          accent={outPct != null && outPct >= 100 ? 'ok' : undefined} />
        <KpiTile label="Xe nâng hoạt động" value={r ? `${r.forklift.active}/${r.forklift.total}` : '—'}
          sub={r && r.forklift.unchecked > 0 ? `${r.forklift.unchecked} xe chưa check` : 'đã check đủ'}
          accent={r && r.forklift.unchecked > 0 ? 'warn' : undefined} />
      </div>

      {/* Rail RESOURCES + panel chính */}
      <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-3">
        {r
          ? <ResourceRail r={r} />
          : <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-3 text-[11px] text-slate-500">Khối nguồn lực chưa sẵn sàng (chưa apply RPC control_tower_resources).</div>}
        <div className="space-y-3 min-w-0">
          <OutProgressStrip data={data} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <OutboundPanel data={data} />
            <InboundPanel data={data} />
          </div>
          {/* Hàng DEPARTMENTS — mỗi khâu một card, bấm là mở trang khâu đó.
              5 cột chỉ từ 2xl — ở 1280 (trừ sidebar + rail) 5 cột làm nhãn cắt cụt */}
          <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-2">
            <DeptCard title="Cổng" to="/tms/gate" color="#38bdf8"
              pct={pctOf(data.gate.completed, gateTotal)}
              rows={[
                { label: 'Trong cổng', value: nf.format(data.gate.inside), cls: data.gate.inside > 0 ? 'text-amber-600 dark:text-amber-400' : undefined },
                { label: 'Chờ gọi', value: nf.format(data.gate.registered + data.gate.called) },
                { label: 'Đã xong', value: `${nf.format(data.gate.completed)}/${nf.format(gateTotal)}` },
              ]} />
            <DeptCard title="Xuất kho" to="/wms/outbound" color="#38bdf8"
              pct={outPct}
              rows={[
                { label: 'Đang soạn', value: nf.format(data.outbound.in_progress), cls: 'text-sky-700 dark:text-sky-300' },
                { label: 'Tạm dừng', value: nf.format(data.outbound.paused), cls: data.outbound.paused > 0 ? 'text-red-600 dark:text-red-400' : undefined },
                { label: 'Chuyến xong', value: `${nf.format(data.outbound.completed)}/${nf.format(data.outbound.total)}` },
              ]} />
            <DeptCard title="Nhặt lẻ" to="/wms/loosepicking" color="#a78bfa"
              pct={loosePct}
              rows={[
                { label: 'KH lẻ (quy đổi)', value: nf.format(data.outbound.loose_planned ?? 0) },
                { label: 'Đã nhặt', value: nf.format(data.outbound.loose_scanned ?? 0), cls: 'text-violet-300' },
              ]} />
            <DeptCard title="Nhập kho" to="/wms/inbound"
              pct={null} big={nf.format(data.inbound.pallets)}
              rows={[
                { label: 'Pallet đã nhận', value: nf.format(data.inbound.pallets), cls: 'text-green-600 dark:text-green-400' },
                { label: 'Phiếu nhập', value: nf.format(data.inbound.orders) },
              ]} />
            <DeptCard title="Trạm cân" to="/wms/weigh-tickets" color="#22c55e"
              pct={weighDonePct}
              rows={[
                { label: 'Lượt cân', value: nf.format(data.weigh.tickets) },
                { label: 'Chờ lần 2', value: nf.format(data.weigh.pending2), cls: data.weigh.pending2 > 0 ? 'text-amber-600 dark:text-amber-400' : undefined },
                { label: 'KL (tấn)', value: nf.format(Math.round(data.weigh.net_kg / 100) / 10) },
              ]} />
          </div>
        </div>
      </div>

      {/* Khối chi tiết — trên TV chỉ giữ khối CÓ dữ liệu (ô trống không đáng chiếm chỗ trên tường) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {(!tv || (data.out_by_material?.list?.length ?? 0) > 0) && <OutMatBlock data={data} />}
        {(!tv || (data.outbound.active?.length ?? 0) > 0) && <TripsBlock data={data} />}
        {(!tv || (data.in_by_material?.list?.length ?? 0) > 0) && <InMatBlock data={data} />}
        {(!tv || (data.gate.inside_list?.length ?? 0) > 0) && <GateBlock data={data} now={now} />}
        {(!tv || data.weigh.tickets > 0) && <WeighBlock data={data} />}
        {(!tv || (data.hourly?.length ?? 0) > 0) && <HourlyBlock data={data} />}
      </div>
    </div>
  )
}

// ─── trang chính ──────────────────────────────────────────────────────────────
export default function ControlTower() {
  const filters = useWmsFilterStore(s => s.controlTower)
  const setF    = useWmsFilterStore(s => s.setControlTower)
  const { data: warehouses = [] } = useScopedWarehouses(true)
  const { data: whTypes = [] } = useScopedWhTypes()
  // Filter Mã hàng: TÌM TRÊN SERVER (50 dòng/lượt) — trước đây mở dashboard là kéo cả danh mục
  const [matTerm, setMatTerm] = useState('')
  const { data: allMaterials = [], isFetching: matFetching } =
    useMaterials({ search: matTerm || undefined, limit: 50 }, !!matTerm)
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
  // Hệ số phóng của màn TV: bám BỀ RỘNG thật (TV 1920 → 1,4× · màn 2560 → trần 1,7× · laptop 1280
  // → 1× như cũ). Tính theo state để đổi ngay khi cắm sang màn khác / xoay màn, không cần F5.
  const [tvZoom, setTvZoom] = useState(1)
  useEffect(() => {
    if (!tv) return
    const calc = () => setTvZoom(Math.min(1.7, Math.max(1, window.innerWidth / 1366)))
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [tv])

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
      serverSearch: true, onSearchChange: setMatTerm, loading: matFetching,
      options: allMaterials.map(m => ({ value: m.material_code, label: `${m.material_code} — ${m.short_name ?? ''}` })),
      selectedOpts: filters.material_codes.map(c => ({ value: c, label: c })),   // value = mã nghiệp vụ, tự đọc được
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
  // LUÔN hiện phạm vi đang xem (user chốt) — không lọc gì thì ghi rõ là toàn bộ
  if (tvFilterChips.length === 0) tvFilterChips.push('Đang xem: Toàn bộ kho')

  return (
    <div className="flex flex-col h-full bg-slate-100 dark:bg-slate-900">
      {/* Header console */}
      <div className="border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-3 py-2 shrink-0 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5 shrink-0 uppercase tracking-wide">
            <Activity className="h-4 w-4 text-sky-600 dark:text-sky-400" /> Giám sát vận hành
          </span>
          <span className="hidden sm:inline text-[10px] uppercase tracking-wider text-slate-500 border-l border-slate-200 dark:border-slate-700 pl-2">Facility Console</span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">{data ? formatDate(data.date) : ''}</span>
          <span className="text-[11px] font-mono text-sky-700 dark:text-sky-300 tabular-nums">{clock}</span>
          {/* Hệ thống đang nghẽn → BE đưa số đã tính lần trước thay vì báo lỗi. Phải NÓI THẲNG là
              số cũ kèm giờ chốt, giấu đi là để người xem tin nhầm số đang chạy thời gian thực. */}
          {data?.stale && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 whitespace-nowrap">
              Số liệu lúc {data.computed_at ? formatTimestampTime(data.computed_at) : '—'} · hệ thống đang bận
            </span>
          )}
          <span className="flex-1" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
          <button onClick={enterTv}
            className="h-7 px-2.5 rounded-md border border-slate-300 dark:border-slate-600 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 flex items-center gap-1.5">
            <Tv className="h-3.5 w-3.5" /> Chế độ TV
          </button>
        </div>
        <FilterBar defs={filterDefs} className="hidden sm:flex" />
      </div>

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4 p-3">
        {isLoading ? (
          <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">Đang tải số liệu…</p>
        ) : isError ? (
          <div className="p-6 text-center text-sm text-red-600 dark:text-red-400">
            {(error as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi tải số liệu giám sát.'}
          </div>
        ) : data ? (
          <ConsoleBody data={data} now={now} />
        ) : null}
      </div>

      {tv && data && (
        // z-[45]: TRÊN app chrome (header z-40) nhưng DƯỚI Dialog z-50 — để sheet bộ lọc mở đè lên TV được.
        // `dark` trên WRAPPER: màn thường theo tông SÁNG của app (25/08), riêng màn TV treo tường
        // GIỮ TỐI như cũ — chữ sáng trên nền tối nhìn xa rõ hơn và không chói cả xưởng. Tailwind
        // darkMode:'class' áp theo ancestor nên mọi khối con tự lấy biến thể `dark:` sẵn có.
        // ⚠️ Nền/chữ của CHÍNH lớp này phải là class TỐI trực tiếp, KHÔNG dùng `dark:` — Tailwind
        // sinh selector `.dark <phần tử>` nên phần tử MANG class `dark` không tự áp biến thể cho
        // mình, chỉ con cháu mới nhận (đo thật: nền ra slate-100 dù đã có class `dark`).
        <div className="dark fixed inset-0 z-[45] bg-slate-900 text-slate-100 flex flex-col px-5 py-4 gap-4 overflow-auto">
          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            <Activity className="h-8 w-8 text-sky-400" />
            <span className="text-3xl font-bold uppercase tracking-wide">Giám sát vận hành</span>
            <span className="text-lg text-slate-300">{formatDate(data.date)}</span>
            {tvFilterChips.map(c => (
              <span key={c} className="text-sm px-2.5 py-1 rounded-full bg-sky-500/20 text-sky-200 border border-sky-500/40 max-w-[360px] truncate" title={c}>{c}</span>
            ))}
            <FilterSheetButton defs={filterDefs} />
            <span className="ml-auto text-5xl font-mono font-bold tabular-nums text-sky-300 leading-none">{clock}</span>
            <button onClick={exitTv} className="p-2 rounded-md hover:bg-white/10" title="Thoát chế độ TV">
              <X className="h-6 w-6" />
            </button>
          </div>
          {/* Xem từ 3–5m: phóng nội dung theo BỀ RỘNG màn (TV 1920 → ~1,4×; laptop 1280 → 1×).
              `zoom` giữ nguyên bố cục lưới, khác `transform: scale` là không phá luồng cuộn. */}
          <div style={{ zoom: tvZoom }} className="flex-1">
            <ConsoleBody data={data} now={now} tv />
          </div>
        </div>
      )}
    </div>
  )
}
