// Tab KPI của Dashboard (08/09/2026) — 40 KPI của "Warehouse KPI Master List": 24 đo được hiện đèn
// G/Y/R theo mục tiêu cấu hình, 16 chưa có nguồn hiện ô trống kèm "cần bổ sung gì".
//
// Mọi định nghĩa (tên, đơn vị, chiều tốt, công thức, ghi chú đo một phần) và đèn đều do BE trả —
// file này CHỈ VẼ. Ba góc nhìn trên cùng một lần lấy số liệu: ô theo nhóm (kèm ▲▼ so kỳ trước /
// cùng kỳ năm trước), bảng theo kho (lọc theo nhóm để không phải kéo 26 cột), xu hướng 12 tháng
// (1 request, DB tự lặp tháng — chỉ tải khi người dùng bấm).
import { useEffect, useMemo, useState } from 'react'
import { Target, TrendingUp, Warehouse, AlertTriangle, Info, CircleDashed, Settings2 } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DashPanel, DASH_SK } from '@/components/wms/DashboardPanel'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { FormSheet } from '@/components/shared/FormSheet'
import { StatusBadge, type BadgeTone } from '@/components/shared/StatusBadge'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import {
  useWarehouseKpi, useWarehouseKpiTrend, useKpiTargets, useSaveKpiTargets,
  type KpiDefPublic, type KpiValue, type KpiTargetMap,
} from '@/api/hooks'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { can, isAdmin, type ModulePermissions } from '@/config/permissions'
import { formatDate } from '@/utils/formatters'
import { fmtNum } from '@/utils/productivity'

// "Hôm nay" phải là HÀM (ratchet today_frozen_at_import)
const TODAY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
function monthStart(back: number): string {
  const [y, m] = TODAY().split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 10)
}
function monthEnd(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}
const yearStart = () => `${TODAY().slice(0, 4)}-01-01`

type Rag = 'G' | 'Y' | 'R' | null
const RAG_STRIPE: Record<string, string> = { G: 'bg-emerald-500', Y: 'bg-amber-500', R: 'bg-red-500', none: 'bg-slate-300 dark:bg-slate-600' }
const RAG_TEXT: Record<string, string> = { G: 'text-emerald-600 dark:text-emerald-400', Y: 'text-amber-600 dark:text-amber-400', R: 'text-red-600 dark:text-red-400', none: 'text-slate-500' }
const RAG_TONE: Record<string, BadgeTone> = { G: 'green', Y: 'amber', R: 'red', none: 'slate' }
const RAG_LABEL: Record<string, string> = { G: 'Đạt', Y: 'Cần chú ý', R: 'Không đạt', none: '—' }
const ragKey = (r: Rag) => r ?? 'none'

function fmtValue(def: KpiDefPublic, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const s = fmtNum(v, def.decimals)
  return def.unit === '%' ? `${s}%` : s
}
function fmtThreshold(def: KpiDefPublic, x: number): string { return def.unit === '%' ? `${fmtNum(x, 2)}%` : `${fmtNum(x, 3)} ${def.unit}` }
function targetText(def: KpiDefPublic, t: number[] | null): string {
  if (!t) return 'chưa đặt mục tiêu'
  if (def.dir === 'up')   return `≥ ${fmtThreshold(def, t[0])} đạt · ≥ ${fmtThreshold(def, t[1])} chú ý`
  if (def.dir === 'down') return `≤ ${fmtThreshold(def, t[0])} đạt · ≤ ${fmtThreshold(def, t[1])} chú ý`
  return `${fmtNum(t[0], 2)}–${fmtThreshold(def, t[1])} đạt · ≤ ${fmtThreshold(def, t[2])} chú ý`
}
const DIR_HINT: Record<string, string> = { up: 'cao hơn là tốt', down: 'thấp hơn là tốt', band: 'nằm trong dải là tốt' }

/** ▲▼ so kỳ: tô theo CHIỀU TỐT của KPI, không theo dấu. Dải (band) không có chiều → trung tính. */
function Delta({ def, k }: { def: KpiDefPublic; k: KpiValue }) {
  if (k.delta == null || k.prev == null) return null
  if (Math.abs(k.delta) < Math.pow(10, -def.decimals) / 2) return <span className="text-[10px] text-slate-400">≈ kỳ so</span>
  const up = k.delta > 0
  const good = def.dir === 'band' ? null : (up === (def.dir === 'up'))
  const cls = good == null ? 'text-slate-500' : good ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'
  const unit = def.unit === '%' ? ' điểm' : ''
  return (
    <span className={`text-[10px] tabular-nums font-medium ${cls}`} title={`Kỳ so: ${fmtValue(def, k.prev)}`}>
      {up ? '▲' : '▼'} {fmtNum(Math.abs(k.delta), def.decimals)}{unit}
    </span>
  )
}

/**
 * THANH MỤC TIÊU — giá trị so thẳng với ngưỡng trên một trục, không phải đọc chữ rồi tự so (user 08/09
 * "gắn target vào để xem được luôn"). Trục 0..max (KPI % thì 0..100); vùng ĐẠT tô xanh nhạt, vùng chú ý
 * vàng nhạt, phần còn lại đỏ nhạt; vạch đen = giá trị hiện tại; ▽ = kỳ so (nếu có).
 *   up   : |░░ đỏ ░░|░ vàng ░|▓▓▓ xanh ▓▓▓→
 *   down : |▓▓▓ xanh ▓▓▓|░ vàng ░|░░ đỏ ░░→
 *   band : |░ vàng ░|▓ xanh ▓|░ vàng ░|░ đỏ→
 */
function TargetBar({ def, k }: { def: KpiDefPublic; k: KpiValue }) {
  const t = k.t
  if (!t) return null
  const cands = [k.value ?? 0, k.prev ?? 0, ...t]
  const max = def.unit === '%' ? 100 : Math.max(1e-9, ...cands) * 1.15
  const pct = (x: number) => `${Math.max(0, Math.min(100, (x / max) * 100))}%`
  // Các đoạn [from, to, màu] theo chiều tốt
  const G = 'bg-emerald-500/25', Y = 'bg-amber-500/25', R = 'bg-red-500/20'
  const segs: Array<[number, number, string]> = def.dir === 'up'
    ? [[0, t[1], R], [t[1], t[0], Y], [t[0], max, G]]
    : def.dir === 'down'
      ? [[0, t[0], G], [t[0], t[1], Y], [t[1], max, R]]
      : [[0, t[0], Y], [t[0], t[1], G], [t[1], t[2], Y], [t[2], max, R]]
  return (
    <div className="relative h-2 mt-1.5 mb-0.5 rounded-sm overflow-hidden bg-slate-100 dark:bg-slate-700/60" title={targetText(def, t)}>
      {segs.map(([a, b, c], i) => b > a && (
        <span key={i} className={`absolute top-0 bottom-0 ${c}`} style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }} />
      ))}
      {k.prev != null && (
        <span className="absolute -top-px h-full w-px bg-slate-400/80 border-l border-dotted border-slate-500" style={{ left: pct(k.prev) }} title={`Kỳ so: ${fmtValue(def, k.prev)}`} />
      )}
      {k.value != null && (
        <span className="absolute top-0 bottom-0 w-[3px] -ml-px rounded-sm bg-slate-900 dark:bg-white shadow" style={{ left: pct(k.value) }} />
      )}
    </div>
  )
}

function KpiCard({ def, k }: { def: KpiDefPublic; k: KpiValue }) {
  const r = ragKey(k.rag)
  const srcLabel = k.t_source === 'warehouse' ? 'riêng kho' : k.t_source === 'global' ? 'công ty' : 'mặc định'
  return (
    <div className="relative rounded-lg bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 pl-3.5 pr-3 py-2 overflow-hidden">
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${RAG_STRIPE[r]}`} />
      <div className="flex items-start gap-1">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 leading-tight flex-1 min-w-0"
          title={`#${def.no} · ${def.formula}`}>
          {def.name}
          {def.snapshot && <span className="ml-1 normal-case tracking-normal text-slate-400">· hiện tại</span>}
        </div>
        {def.note && <Info className="h-3 w-3 text-amber-500 shrink-0 mt-px" aria-label={def.note} />}
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={`text-2xl font-semibold tabular-nums leading-tight ${k.value == null ? 'text-slate-400' : 'text-slate-900 dark:text-white'}`}>
          {fmtValue(def, k.value)}
        </span>
        {k.value != null && def.unit !== '%' && <span className="text-[10px] text-slate-500">{def.unit}</span>}
        <Delta def={def} k={k} />
        <span className="flex-1" />
        {k.value != null && (
          <StatusBadge tone={RAG_TONE[r]} title={`Mục tiêu ${srcLabel}`} className="!text-[9px] !px-1.5 shrink-0">{RAG_LABEL[r]}</StatusBadge>
        )}
      </div>
      <TargetBar def={def} k={k} />
      <div className="flex items-center justify-between gap-2 text-[9px] leading-tight">
        <span className="text-slate-500 truncate">{k.value == null ? 'chưa có dữ liệu trong kỳ' : (k.sub ?? '')}</span>
        <span className={`shrink-0 tabular-nums ${k.t ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400 italic'}`} title={`Mục tiêu ${srcLabel} · ${DIR_HINT[def.dir]}`}>
          {k.t ? `Mục tiêu ${def.dir === 'up' ? '≥' : def.dir === 'down' ? '≤' : ''} ${def.dir === 'band' ? `${fmtNum(k.t[0], 2)}–${fmtThreshold(def, k.t[1])}` : fmtThreshold(def, k.t[0])}` : 'chưa đặt mục tiêu'}
        </span>
      </div>
      {def.note && <div className="text-[9px] text-amber-600 dark:text-amber-400 mt-0.5 leading-tight">{def.note}</div>}
    </div>
  )
}

function UnavailableCard({ u }: { u: { no: number; name: string; need: string } }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50/60 dark:bg-slate-800/30">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 flex items-center gap-1">
        <CircleDashed className="h-3 w-3" /> {u.name}
      </div>
      <div className="text-lg font-semibold text-slate-300 dark:text-slate-600 leading-tight">—</div>
      <div className="text-[9px] text-slate-500 leading-tight"><b>Cần:</b> {u.need}</div>
    </div>
  )
}

// ── Xu hướng 12 tháng — chỉ KPI theo kỳ; cột tô theo đèn so mục tiêu, vạch = ngưỡng đạt ──────
function KpiTrendPanel({ warehouseId, defs }: { warehouseId: string; defs: KpiDefPublic[] }) {
  const [on, setOn] = useState(false)
  const q = useWarehouseKpiTrend({ warehouseId, months: 12 }, on)
  const periodic = defs.filter(d => !d.snapshot)
  const [sel, setSel] = useState(periodic[0]?.id ?? 'otif')
  const def = periodic.find(d => d.id === sel) ?? periodic[0]
  const series = q.data?.series ?? []
  const t = q.data?.targets?.[def?.id ?? ''] ?? null
  const vals = series.map(s => s.values[def?.id ?? ''] ?? null)
  const max = Math.max(1e-9, ...vals.map(v => v ?? 0), ...(t ?? []))
  const rag = (v: number | null): Rag => {
    if (v == null || !t || !def) return null
    if (def.dir === 'up')   return v >= t[0] ? 'G' : v >= t[1] ? 'Y' : 'R'
    if (def.dir === 'down') return v <= t[0] ? 'G' : v <= t[1] ? 'Y' : 'R'
    return v >= t[0] && v <= t[1] ? 'G' : v <= t[2] ? 'Y' : 'R'
  }
  return (
    <DashPanel title="Xu hướng 12 tháng" icon={TrendingUp} extra={<>
      <span className="text-[9px] text-slate-500">chỉ KPI theo kỳ · cột tô theo đèn so mục tiêu</span>
      <span className="flex-1" />
      {!on && <button type="button" onClick={() => setOn(true)} className="text-[10px] text-sky-600 hover:text-sky-700 font-medium">Tải 12 tháng</button>}
    </>}>
      {!on ? (
        <div className="px-3 py-4 text-[11px] text-slate-500">Bấm <b>Tải 12 tháng</b> để xem xu hướng (tính từng tháng trong máy chủ, lần đầu mất vài giây).</div>
      ) : (
        <>
          <div className="px-2.5 py-1.5 flex items-center gap-1 flex-wrap border-b border-slate-100 dark:border-slate-700/60">
            {periodic.map(d => (
              <button key={d.id} type="button" onClick={() => setSel(d.id)}
                className={`h-6 px-2 rounded text-[10px] font-medium border transition-colors ${d.id === sel
                  ? 'bg-sky-600 text-white border-sky-600'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-white/5'}`}>
                {d.short}
              </button>
            ))}
          </div>
          {q.isLoading && <div className="p-3"><Skeleton className={`h-40 w-full ${DASH_SK}`} /></div>}
          {q.isError && <div className="px-3 py-2 text-[11px] text-red-600">Không tải được xu hướng — thử lại sau.</div>}
          {q.data && def && (
            <div className="p-3 overflow-x-auto">
              <div className="text-[10px] text-slate-500 mb-1">
                <b className="text-slate-700 dark:text-slate-200">{def.name}</b> · {def.unit} · {targetText(def, t)}
              </div>
              <div className="relative flex items-end gap-2 min-w-max h-40">
                {t && t[0] <= max && (
                  <div className="absolute left-0 right-0 border-t border-dashed border-emerald-500/70 pointer-events-none"
                    style={{ bottom: `${16 + (t[0] / max) * 96}px` }} title={`Ngưỡng đạt ${fmtThreshold(def, t[0])}`} />
                )}
                {series.map((s, i) => {
                  const v = vals[i]
                  const h = v == null ? 0 : Math.max(3, (v / max) * 96)
                  const r = ragKey(rag(v))
                  return (
                    <div key={s.month} className="flex flex-col items-center justify-end gap-1 w-14">
                      <span className="text-[9px] tabular-nums text-slate-600 dark:text-slate-300">{fmtValue(def, v)}</span>
                      {v == null
                        ? <div className="w-8 border-b-2 border-dashed border-slate-300 dark:border-slate-600" title="Chưa có dữ liệu" />
                        : <div className={`w-8 rounded-t ${RAG_STRIPE[r]} opacity-80 hover:opacity-100`} style={{ height: `${h}px` }}
                            title={`${s.month}: ${fmtValue(def, v)} (${s.days} ngày)`} />}
                      <span className="text-[9px] text-slate-600 dark:text-slate-300">{s.month.slice(5)}/{s.month.slice(2, 4)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </DashPanel>
  )
}

// ── Form ĐẶT MỤC TIÊU — mặc định toàn công ty hoặc riêng 1 kho ────────────────────────────────
type RowMode = 'inherit' | 'none' | 'set'
type RowState = { mode: RowMode; v: string[] }
function KpiTargetSheet({ open, onClose, warehouseId, warehouses, canGlobal }: {
  open: boolean; onClose: () => void; warehouseId: string
  warehouses: { id: string; code?: string; name: string }[]; canGlobal: boolean
}) {
  const q = useKpiTargets(open)
  const save = useSaveKpiTargets()
  // Phạm vi: '' = mặc định toàn công ty, else id kho. Người bị giới hạn kho không sửa được phần chung.
  const [scope, setScope] = useState<string>(canGlobal ? '' : warehouseId)
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [slow, setSlow] = useState('90'); const [dead, setDead] = useState('180')
  const [err, setErr] = useState<string | null>(null)
  const [group, setGroup] = useState<string>('')

  useEffect(() => { if (open) setScope(canGlobal ? (warehouseId || '') : warehouseId) }, [open, warehouseId, canGlobal])
  // Nạp state từ cấu hình đã lưu theo phạm vi đang chọn
  useEffect(() => {
    if (!q.data) return
    const m: KpiTargetMap = scope ? (q.data.by_warehouse[scope] ?? {}) : q.data.default
    const next: Record<string, RowState> = {}
    for (const d of q.data.defs) {
      if (d.id in m) next[d.id] = m[d.id] === null ? { mode: 'none', v: [] } : { mode: 'set', v: (m[d.id] as number[]).map(String) }
      else next[d.id] = { mode: 'inherit', v: [] }
    }
    setRows(next); setErr(null)
    setSlow(String(q.data.params.slow_days)); setDead(String(q.data.params.dead_days))
  }, [q.data, scope])

  const defs = q.data?.defs ?? []
  const groups = q.data?.groups ?? []
  const shown = defs.filter(d => !group || d.group === group)
  const need = (d: KpiDefPublic) => (d.dir === 'band' ? 3 : 2)
  const labels = (d: KpiDefPublic) => d.dir === 'band' ? ['Từ (đạt)', 'Đến (đạt)', 'Tối đa (chú ý)'] : ['Đạt', 'Chú ý']
  const inheritText = (d: KpiDefPublic) => {
    if (scope) {
      const g = q.data?.default?.[d.id]
      if (g === null) return 'Theo công ty: không đặt'
      if (g) return `Theo công ty: ${targetText(d, g)}`
    }
    return d.defaults ? `Mặc định: ${targetText(d, d.defaults)}` : 'Mặc định: chưa đặt (file KPI ghi "theo policy")'
  }
  const setMode = (id: string, mode: RowMode, d: KpiDefPublic) => setRows(r => ({
    ...r, [id]: { mode, v: mode === 'set' && r[id].v.length !== need(d) ? (d.defaults ?? Array(need(d)).fill(0)).map(String) : r[id].v },
  }))
  const setVal = (id: string, i: number, val: string) => setRows(r => { const v = [...r[id].v]; v[i] = val; return { ...r, [id]: { ...r[id], v } } })

  async function onSave() {
    setErr(null)
    const targets: KpiTargetMap = {}
    for (const d of defs) {
      const r = rows[d.id]; if (!r || r.mode === 'inherit') continue
      if (r.mode === 'none') { targets[d.id] = null; continue }
      const nums = r.v.map(x => Number(String(x).replace(',', '.')))
      if (nums.length !== need(d) || nums.some(n => !Number.isFinite(n))) { setErr(`${d.name}: nhập đủ ${need(d)} số`); return }
      targets[d.id] = nums
    }
    const body: { warehouse_id: string | null; targets: KpiTargetMap; params?: { slow_days: number; dead_days: number } } =
      { warehouse_id: scope || null, targets }
    if (!scope) {
      const s = Number(slow), dd = Number(dead)
      if (!Number.isInteger(s) || !Number.isInteger(dd)) { setErr('Ngưỡng chậm / không luân chuyển phải là số ngày nguyên'); return }
      body.params = { slow_days: s, dead_days: dd }
    }
    try { await save.mutateAsync(body); onClose() }
    catch (e) {
      const m = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setErr(m ?? 'Không lưu được mục tiêu — thử lại.')
    }
  }

  return (
    <FormSheet open={open} onClose={onClose} title="Mục tiêu KPI" widthClass="sm:max-w-2xl"
      description="Ngưỡng đèn xanh / vàng cho từng KPI. Kho không đặt riêng thì dùng mục tiêu công ty; công ty không đặt thì dùng mặc định của bộ KPI."
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={save.isPending}>Huỷ</Button>
        <Button onClick={onSave} disabled={save.isPending || q.isLoading}>{save.isPending ? 'Đang lưu…' : 'Lưu mục tiêu'}</Button>
      </>}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-600 shrink-0">Phạm vi</span>
          {canGlobal && (
            <button type="button" onClick={() => setScope('')}
              className={`h-8 px-3 rounded border text-xs font-medium ${!scope ? 'bg-sky-600 text-white border-sky-600' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              Mặc định toàn công ty
            </button>
          )}
          <WarehouseSingleSelect warehouses={warehouses} value={scope} onChange={id => setScope(id || (canGlobal ? '' : warehouseId))}
            placeholder="Riêng kho…" allLabel={canGlobal ? undefined : undefined} triggerClassName="h-8 w-52" />
          {scope && <span className="text-[11px] text-slate-500">Đang sửa mục tiêu RIÊNG của kho — "Theo công ty" = không ghi đè.</span>}
        </div>

        {!scope && (
          <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-700">Ngưỡng hàng CHẬM luân chuyển (ngày)
              <Input type="number" min={7} max={730} value={slow} onChange={e => setSlow(e.target.value)} className="h-8 mt-1" />
            </label>
            <label className="text-xs text-slate-700">Ngưỡng KHÔNG luân chuyển (ngày)
              <Input type="number" min={7} max={1460} value={dead} onChange={e => setDead(e.target.value)} className="h-8 mt-1" />
            </label>
            <div className="col-span-2 text-[10px] text-slate-500">Tham số chung cho mọi kho (pallet nhập quá N ngày và mã không xuất quá N ngày).</div>
          </div>
        )}

        <div className="flex items-center gap-1 flex-wrap">
          <button type="button" onClick={() => setGroup('')} className={`h-6 px-2 rounded text-[10px] font-medium border ${!group ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200'}`}>Tất cả</button>
          {groups.map(g => (
            <button key={g.key} type="button" onClick={() => setGroup(g.key)} className={`h-6 px-2 rounded text-[10px] font-medium border ${group === g.key ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200'}`}>{g.label}</button>
          ))}
        </div>

        {err && <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">{err}</div>}
        {q.isLoading && <Skeleton className="h-40 w-full bg-slate-200" />}

        <div className="divide-y divide-slate-100 border border-slate-200 rounded">
          {shown.map(d => {
            const r = rows[d.id] ?? { mode: 'inherit', v: [] }
            return (
              <div key={d.id} className="px-3 py-2 space-y-1.5">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-800">{d.name} <span className="text-slate-400 font-normal">· {d.unit} · {DIR_HINT[d.dir]}</span></div>
                    <div className="text-[10px] text-slate-500 truncate" title={d.formula}>{inheritText(d)}</div>
                  </div>
                  <select value={r.mode} onChange={e => setMode(d.id, e.target.value as RowMode, d)}
                    className="h-7 rounded border border-slate-200 bg-white text-[11px] px-1.5 shrink-0">
                    <option value="inherit">{scope ? 'Theo công ty' : 'Theo mặc định'}</option>
                    <option value="set">Đặt riêng</option>
                    <option value="none">Không đặt mục tiêu</option>
                  </select>
                </div>
                {r.mode === 'set' && (
                  <div className="flex flex-wrap gap-2">
                    {labels(d).map((lb, i) => (
                      <label key={lb} className="text-[10px] text-slate-600 flex items-center gap-1">
                        {lb}
                        <Input type="number" step="any" value={r.v[i] ?? ''} onChange={e => setVal(d.id, i, e.target.value)} className="h-7 w-24 text-xs" />
                        <span className="text-slate-400">{d.unit}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </FormSheet>
  )
}

// ── Tab chính ─────────────────────────────────────────────────────────────────────────────────
export function DashboardKpi({ warehouseId }: { warehouseId: string }) {
  const f = useWmsFilterStore(s => s.dashboard)
  const setDashboard = useWmsFilterStore(s => s.setDashboard)
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canTarget = can(perms, 'dashboard', 'kpi_target')
  const canGlobal = isAdmin(user) || user?.warehouse_scope === 'NATIONAL'
  const { data: scopedWhs = [] } = useScopedWarehouses(true)

  const from = f.kpiFrom || monthStart(0)
  const to = f.kpiTo || TODAY()
  const compare = f.kpiCompare === 'prev' || f.kpiCompare === 'yoy' ? f.kpiCompare : ''
  const q = useWarehouseKpi({ warehouseId, from, to, compare }, true)
  const d = q.data
  const [sheet, setSheet] = useState(false)

  const RANGES = [
    { value: 'this', label: 'Tháng này', from: monthStart(0), to: TODAY() },
    { value: 'prev', label: 'Tháng trước', from: monthStart(1), to: monthEnd(monthStart(1)) },
    { value: '3m', label: '3 tháng gần nhất', from: monthStart(2), to: TODAY() },
    { value: 'ytd', label: 'Năm nay', from: yearStart(), to: TODAY() },
    { value: '12m', label: '12 tháng gần nhất', from: monthStart(11), to: TODAY() },
  ]
  const rangeValue = (f.kpiFrom || f.kpiTo) ? RANGES.find(r => r.from === from && r.to === to)?.value ?? '' : ''
  function setRange(nf: string, nt: string) {
    if (!nf && !nt) { setDashboard({ kpiFrom: '', kpiTo: '' }); return }
    const f2 = nf || nt, t2 = nt || nf
    setDashboard(f2 > t2 ? (nf !== from ? { kpiFrom: f2, kpiTo: f2 } : { kpiFrom: t2, kpiTo: t2 }) : { kpiFrom: f2, kpiTo: t2 })
  }
  const filterDefs: FilterDef[] = [
    { key: 'range', label: 'Khoảng ngày', type: 'daterange', pinned: true, from, to, onChange: setRange },
    { key: 'period', label: 'Kỳ', type: 'single', pinned: true, options: RANGES, allLabel: 'Về mặc định (tháng này)', value: rangeValue,
      onChange: v => { const r = RANGES.find(x => x.value === v); setDashboard(r ? { kpiFrom: r.from, kpiTo: r.to } : { kpiFrom: '', kpiTo: '' }) } },
    { key: 'compare', label: 'So sánh', type: 'single', pinned: true, value: compare, allLabel: 'Không so sánh',
      options: [{ value: 'prev', label: 'Kỳ liền trước' }, { value: 'yoy', label: 'Cùng kỳ năm trước' }],
      onChange: v => setDashboard({ kpiCompare: v }) },
  ]

  const defById = useMemo(() => new Map((d?.defs ?? []).map(x => [x.id, x])), [d])
  const counts = useMemo(() => {
    const c = { G: 0, Y: 0, R: 0, none: 0 }
    for (const k of d?.kpis ?? []) c[ragKey(k.rag) as keyof typeof c]++
    return c
  }, [d])
  const tableGroup = f.kpiGroup || d?.groups?.[0]?.key || 'delivery'
  const tableDefs = (d?.defs ?? []).filter(x => x.group === tableGroup)
  const n = d?.notes

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 px-2.5 py-1.5 flex flex-wrap items-center gap-2">
        <FilterSheetButton defs={filterDefs} className="sm:hidden" />
        <div className="hidden sm:block"><FilterBar defs={filterDefs} /></div>
        <span className="flex-1 min-w-2" />
        <span className="text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
          {formatDate(from)} – {formatDate(to)} · {d?.days ?? ''} ngày
          {d?.compare && <> · so {formatDate(d.compare.from)} – {formatDate(d.compare.to)}</>}
        </span>
        {canTarget && (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setSheet(true)}>
            <Settings2 className="h-3.5 w-3.5" /> Mục tiêu
          </Button>
        )}
      </div>

      {q.isError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">
          Không tải được KPI
          {(() => { const m = (q.error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message; return m ? ` — ${m}` : ' — thử lại hoặc thu hẹp khoảng ngày.' })()}
        </div>
      )}

      {/* Tổng đèn */}
      {d && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <Target className="h-3.5 w-3.5 text-sky-500" />
          <span className="text-slate-600 dark:text-slate-300"><b>{d.kpis.length}</b>/{d.kpis.length + d.unavailable.length} KPI đo được</span>
          <StatusBadge tone="green">{counts.G} đạt</StatusBadge>
          <StatusBadge tone="amber">{counts.Y} cần chú ý</StatusBadge>
          <StatusBadge tone="red">{counts.R} không đạt</StatusBadge>
          <StatusBadge tone="slate">{counts.none} chưa có dữ liệu / chưa đặt mục tiêu</StatusBadge>
          {d.target_scope && <span className="text-slate-500">· mục tiêu áp cho kho đang chọn (riêng kho nếu có, không thì công ty)</span>}
        </div>
      )}

      {/* Nói thẳng chỗ dữ liệu còn thiếu */}
      {n && (n.lines_no_weight > 0 || n.loc_uncapped > 0 || n.warehouses_no_labor > 0 || n.categories_filtered) && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 space-y-1 text-[11px] text-amber-700 dark:text-amber-400">
          {n.warehouses_no_labor > 0 && <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /><span><b>{n.warehouses_no_labor} kho có hàng nhưng chưa chấm công</b> — các KPI theo giờ công của kho đó để trống.</span></div>}
          {n.lines_no_weight > 0 && <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /><span><b>{fmtNum(n.lines_no_weight, 0)} dòng hàng chưa khai khối lượng thùng</b> — không vào tấn (DOH, vòng quay, tấn/giờ thấp hơn thực).</span></div>}
          {n.loc_uncapped > 0 && <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /><span><b>{fmtNum(n.loc_uncapped, 0)} vị trí</b> chưa khai sức chứa hoặc khai quá 1.000 pallet ("không giới hạn") — bị loại khỏi % sử dụng chỗ và tràn chỗ.</span></div>}
          {n.categories_filtered && <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /><span>Bạn chỉ được xem một phần Loại hàng: KPI theo tồn/thùng đã cắt theo quyền, KPI theo giờ công thì không tách được.</span></div>}
        </div>
      )}

      {/* Ô theo nhóm */}
      {q.isLoading && !d && (
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className={`h-[84px] rounded-lg ${DASH_SK}`} />)}
        </div>
      )}
      {d && d.groups.map(g => {
        const ks = d.kpis.filter(k => defById.get(k.id)?.group === g.key)
        const un = d.unavailable.filter(u => u.group === g.key)
        if (!ks.length && !un.length) return null
        return (
          <DashPanel key={g.key} title={g.label} icon={Target} extra={
            <span className="text-[9px] text-slate-500">{ks.length} đo được{un.length ? ` · ${un.length} chưa có nguồn` : ''}</span>}>
            <div className="p-2 grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
              {ks.map(k => <KpiCard key={k.id} def={defById.get(k.id)!} k={k} />)}
              {un.map(u => <UnavailableCard key={u.no} u={u} />)}
            </div>
          </DashPanel>
        )
      })}

      {d && <KpiTrendPanel warehouseId={warehouseId} defs={d.defs} />}

      {/* Bảng theo kho — lọc theo nhóm để không phải kéo 26 cột */}
      {d && (
        <DashPanel title="KPI theo kho" icon={Warehouse} extra={<>
          <span className="text-[9px] text-slate-500">{d.by_warehouse.length} kho có số liệu · đèn theo mục tiêu riêng kho nếu có</span>
          <span className="flex-1" />
          <div className="flex items-center gap-1 flex-wrap">
            {d.groups.map(g => (
              <button key={g.key} type="button" onClick={() => setDashboard({ kpiGroup: g.key })}
                className={`h-6 px-2 rounded text-[10px] font-medium border transition-colors ${tableGroup === g.key
                  ? 'bg-sky-600 text-white border-sky-600'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'}`}>
                {g.label}
              </button>
            ))}
          </div>
        </>}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800">
                  <th className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap sticky left-0 z-10 bg-slate-50 dark:bg-slate-800">Kho</th>
                  {tableDefs.map(x => <th key={x.id} className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap text-right" title={`${x.name} (${x.unit})`}>{x.short}</th>)}
                </tr>
                {/* Dòng MỤC TIÊU (công ty / mặc định) ngay dưới tên cột — đọc bảng là thấy đích; kho có mục tiêu riêng thì đèn ô đó theo riêng */}
                <tr className="bg-slate-50 dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60">
                  <th className="text-[9px] font-normal text-slate-400 px-2 py-1 whitespace-nowrap sticky left-0 z-10 bg-slate-50 dark:bg-slate-800">Mục tiêu</th>
                  {tableDefs.map(x => {
                    const t = d.kpis.find(k => k.id === x.id)?.t ?? null
                    return <th key={x.id} className="text-[9px] font-normal text-slate-400 px-2 py-1 whitespace-nowrap text-right tabular-nums" title={targetText(x, t)}>
                      {t ? (x.dir === 'band' ? `${fmtNum(t[0], 1)}–${fmtNum(t[1], 1)}` : `${x.dir === 'up' ? '≥' : '≤'} ${fmtNum(t[0], 2)}`) : '—'}
                    </th>
                  })}
                </tr>
              </thead>
              <tbody>
                {d.by_warehouse.length === 0 && (
                  <tr><td colSpan={tableDefs.length + 1} className="px-2 py-4 text-center text-[11px] text-slate-400">Không kho nào có số liệu trong kỳ.</td></tr>
                )}
                {d.by_warehouse.map(w => {
                  const byId = new Map(w.kpis.map(k => [k.id, k]))
                  return (
                    <tr key={w.warehouse_id} className="border-t border-slate-100 dark:border-slate-700/60">
                      <td className="px-2 py-1 text-[10px] whitespace-nowrap sticky left-0 z-10 bg-white dark:bg-slate-800/60 font-medium text-slate-700 dark:text-slate-200">{w.warehouse_name}</td>
                      {tableDefs.map(x => {
                        const k = byId.get(x.id)
                        const r = ragKey(k?.rag ?? null)
                        return (
                          <td key={x.id} className={`px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums font-semibold ${RAG_TEXT[r]}`}
                            title={k ? `${x.name}: ${fmtValue(x, k.value)} · ${k.sub ?? ''} · ${targetText(x, k.t)}` : ''}>
                            {k?.value != null && <span className={`inline-block h-1.5 w-1.5 rounded-full mr-1 align-middle ${RAG_STRIPE[r]}`} />}
                            {fmtValue(x, k?.value)}
                            {k && <Delta def={x} k={k} />}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </DashPanel>
      )}

      {canTarget && (
        <KpiTargetSheet open={sheet} onClose={() => setSheet(false)} warehouseId={warehouseId}
          warehouses={scopedWhs as { id: string; code?: string; name: string }[]} canGlobal={canGlobal} />
      )}
    </div>
  )
}
