// TAB KPI của Dashboard (08/09/2026) — 24 KPI đo được từ "Warehouse KPI Master List" + mục tiêu cấu hình.
//
// Đường đi: RPC `warehouse_kpi_cached` trả {num, den} theo kho → file này suy GIÁ TRỊ + ĐÈN G/Y/R theo
// sổ `utils/kpiDefs.ts` và mục tiêu người dùng đặt (cờ `kpi_targets`). So sánh kỳ (kỳ trước / cùng kỳ
// năm trước) = gọi RPC lần 2 với khoảng ngày dịch — KPI ảnh chụp tồn (snapshot) không so vì mọi kỳ
// đều là số hiện tại. Xu hướng theo tháng = RPC `warehouse_kpi_trend` (1 request, DB tự lặp tháng).
//
// TIỀN: KPI có cờ `cost` bị CẮT khỏi payload nếu người gọi thiếu `warehouse_cost.view` — ẩn ở FE là
// chưa đủ (cùng luật với tab Năng suất, `stripCost`).
import type { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { scopeCategoriesOf } from '../../utils/categoryScope'
import { logAdmin } from '../../services/adminAudit'
import {
  getDashboardCacheSeconds, getStandardWorkHours, getPctDateBands, getKpiTargets, invalidateSettingsCache,
} from '../../utils/settings'
import {
  KPI_DEFS, KPI_GROUPS, KPI_UNAVAILABLE, KPI_TARGETS_DEFAULT, KPI_EMPTY_HINT, kpiValue, evalRag, effectiveTarget,
  targetMapError, paramsError, parseKpiTargets,
  type KpiDef, type KpiTargets, type KpiTargetMap, type Rag, type TargetSource,
} from '../../utils/kpiDefs'

function scopeWhIds(req: Request): string[] | null {
  if (req.user?.is_superadmin === true || req.user?.warehouse_scope === 'NATIONAL') return null
  const ids = req.user?.warehouse_ids ?? []
  return ids.length ? ids : null
}
function canSeeCost(req: Request): boolean {
  const perms = req.user?.module_permissions as Record<string, string[]> | null | undefined
  return req.user?.is_superadmin === true || !!perms?.warehouse_cost?.includes('view')
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
const dayCount = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1
/** Cộng/trừ ngày trên chuỗi YYYY-MM-DD (UTC thuần, không dính DST). */
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
/** Cùng ngày/tháng của năm trước (29/02 → 28/02). */
function shiftYear(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const last = new Date(Date.UTC(y + n, m, 0)).getUTCDate()
  return new Date(Date.UTC(y + n, m - 1, Math.min(d, last))).toISOString().slice(0, 10)
}

type CompareMode = 'none' | 'prev' | 'yoy'
function compareRange(mode: CompareMode, from: string, to: string): { from: string; to: string } | null {
  if (mode === 'prev') { const n = dayCount(from, to); return { from: addDays(from, -n), to: addDays(from, -1) } }
  if (mode === 'yoy') return { from: shiftYear(from, -1), to: shiftYear(to, -1) }
  return null
}

type NumDen = { num: number | null; den: number | null }
type RpcOut = {
  from: string; to: string; days: number; pct_low: number; slow_days: number; dead_days: number
  by_warehouse: Array<{ warehouse_id: string; warehouse_name: string; m: Record<string, NumDen> }>
  totals: Record<string, NumDen>
  cost_shared: number; lines_no_weight: number; loc_uncapped: number
  warehouses_no_labor: number; categories_filtered: boolean; cached?: boolean
}

/** Tham số chung cho cả 3 lời gọi RPC (ngưỡng %Date + chậm/không luân chuyển lấy từ cấu hình). */
async function rpcArgs(whIds: string[] | null, cats: string[] | null) {
  const [std, ttl, bands, targets] = await Promise.all([getStandardWorkHours(), getDashboardCacheSeconds(), getPctDateBands(), getKpiTargets()])
  return {
    targets,
    args: {
      p_warehouse_ids: whIds, p_categories: cats, p_std_hours: std,
      p_pct_low: bands.low, p_slow_days: targets.params.slow_days, p_dead_days: targets.params.dead_days,
    },
    ttl,
  }
}

async function callKpi(args: Record<string, unknown>, ttl: number, from: string, to: string): Promise<RpcOut> {
  const a = { ...args, p_from: from, p_to: to }
  const { data, error } = await supabase.rpc('warehouse_kpi_cached', { ...a, p_ttl_seconds: ttl })
  if (!error && data) return data as RpcOut
  // Nhánh dự phòng cửa sổ triển khai (bản _cached chưa apply) — số liệu như nhau, không cache
  const { data: raw, error: rawErr } = await supabase.rpc('warehouse_kpi', a)
  if (rawErr) throw rawErr
  return raw as RpcOut
}

/** Chi phí CHUNG (chưa gán kho) cộng vào tử số TỔNG của KPI chi phí — không vào kho nào. */
function totalsWithShared(out: RpcOut): Record<string, NumDen> {
  const t = { ...out.totals }
  const c = t.cost_case
  if (c && Number(out.cost_shared) > 0) t.cost_case = { num: Number(c.num ?? 0) + Number(out.cost_shared), den: c.den }
  return t
}

type KpiOut = {
  id: string; value: number | null; num: number | null; den: number | null
  rag: Rag | null; t: number[] | null; t_source: TargetSource; sub: string | null
  prev: number | null; delta: number | null
}
function buildKpis(defs: KpiDef[], m: Record<string, NumDen>, days: number, targets: KpiTargets, whId: string | null,
  prev?: { m: Record<string, NumDen>; days: number }): KpiOut[] {
  return defs.map(def => {
    const nd = m[def.id] ?? { num: null, den: null }
    const value = kpiValue(def, nd.num, nd.den, days)
    const { t, source } = effectiveTarget(def, targets, whId)
    let prevV: number | null = null
    if (prev && !def.snapshot) {
      const p = prev.m[def.id] ?? { num: null, den: null }
      prevV = kpiValue(def, p.num, p.den, prev.days)
    }
    const sub = nd.num != null && nd.den != null && def.subOf ? def.subOf(Number(nd.num), Number(nd.den)) : null
    return {
      id: def.id, value, num: nd.num, den: nd.den, rag: evalRag(def, value, t), t, t_source: source, sub,
      prev: prevV, delta: value != null && prevV != null ? value - prevV : null,
    }
  })
}
const publicDef = (d: KpiDef) => ({ id: d.id, no: d.no, name: d.name, short: d.short, group: d.group, unit: d.unit, dir: d.dir,
  kind: d.kind, decimals: d.decimals, defaults: d.defaults, formula: d.formula, note: d.note ?? null, snapshot: !!d.snapshot, cost: !!d.cost,
  empty_hint: KPI_EMPTY_HINT[d.id] ?? '' })

/** Kiểm tham số chung của GET: kho trong phạm vi + tồn tại, khoảng ngày hợp lệ. Trả lỗi đã gửi (true) hoặc dữ liệu. */
async function parseScope(req: Request, res: Response): Promise<{ whIds: string[] | null; sel: string; cats: string[] | null } | null> {
  const scope = scopeWhIds(req)
  const sel = String((req.query as { warehouse_id?: string }).warehouse_id ?? '').trim()
  if (sel) {
    if (sel.length > 64) { fail(res, 'Mã kho không hợp lệ', 400, 'BAD_WAREHOUSE'); return null }
    if (scope && !scope.includes(sel)) { fail(res, 'Kho ngoài phạm vi được gán', 403, 'WAREHOUSE_OUT_OF_SCOPE'); return null }
    const { data: w } = await supabase.from('Warehouse').select('id').eq('id', sel).maybeSingle()
    if (!w) { fail(res, 'Kho không tồn tại', 400, 'BAD_WAREHOUSE'); return null }
  }
  return { whIds: sel ? [sel] : scope, sel, cats: scopeCategoriesOf(req) }
}

// GET /wms/kpi?warehouse_id&date_from&date_to&compare=none|prev|yoy
export async function getKpi(req: Request, res: Response) {
  try {
    const q = req.query as { date_from?: string; date_to?: string; compare?: string }
    const from = String(q.date_from ?? '').trim(), to = String(q.date_to ?? '').trim()
    if (!isDate(from) || !isDate(to)) return fail(res, 'date_from, date_to (YYYY-MM-DD) là bắt buộc', 400, 'BAD_DATE')
    if (from > to) return fail(res, 'Khoảng ngày không hợp lệ: "Từ ngày" lớn hơn "Đến ngày"', 400, 'BAD_RANGE')
    const days = dayCount(from, to)
    if (days > 400) return fail(res, `Khoảng ngày tối đa 400 ngày (đang chọn ${days} ngày) — thu hẹp lại rồi thử lại`, 400, 'BAD_RANGE')
    const cmpRaw = String(q.compare ?? 'none').trim()
    if (!['none', 'prev', 'yoy'].includes(cmpRaw)) return fail(res, 'compare phải là none | prev | yoy', 400, 'BAD_COMPARE')
    const compare = cmpRaw as CompareMode

    const sc = await parseScope(req, res)
    if (!sc) return
    const { targets, args, ttl } = await rpcArgs(sc.whIds, sc.cats)
    const cmp = compareRange(compare, from, to)
    const [cur, prev] = await Promise.all([
      callKpi(args, ttl, from, to),
      cmp ? callKpi(args, ttl, cmp.from, cmp.to) : Promise.resolve(null),
    ])

    const showCost = canSeeCost(req)
    const defs = KPI_DEFS.filter(d => showCost || !d.cost)
    const whForTarget = sc.sel || null
    const prevTot = prev ? { m: totalsWithShared(prev), days: Number(prev.days) } : undefined
    const kpis = buildKpis(defs, totalsWithShared(cur), Number(cur.days), targets, whForTarget, prevTot)
    const prevByWh = new Map((prev?.by_warehouse ?? []).map(w => [w.warehouse_id, w.m]))
    const by_warehouse = (cur.by_warehouse ?? [])
      .map(w => {
        const p = prevByWh.get(w.warehouse_id)
        const rows = buildKpis(defs, w.m, Number(cur.days), targets, w.warehouse_id,
          p && prev ? { m: p, days: Number(prev.days) } : undefined)
        return { warehouse_id: w.warehouse_id, warehouse_name: w.warehouse_name, kpis: rows,
          has_data: rows.some(r => r.value != null) }
      })
      .filter(w => w.has_data)   // trăm kho NPP không phát sinh: không hiện dòng rỗng

    return ok(res, {
      from, to, days, compare: cmp ? { mode: compare, ...cmp, days: Number(prev?.days ?? 0) } : null,
      pct_low: cur.pct_low, slow_days: cur.slow_days, dead_days: cur.dead_days,
      groups: KPI_GROUPS, defs: defs.map(publicDef),
      unavailable: KPI_UNAVAILABLE,
      target_scope: whForTarget,
      kpis, by_warehouse,
      notes: {
        lines_no_weight: Number(cur.lines_no_weight ?? 0), loc_uncapped: Number(cur.loc_uncapped ?? 0),
        warehouses_no_labor: Number(cur.warehouses_no_labor ?? 0), categories_filtered: !!cur.categories_filtered,
        cost_shared: showCost ? Number(cur.cost_shared ?? 0) : 0, cost_hidden: !showCost, cached: !!cur.cached,
      },
    })
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e)) }
}

// GET /wms/kpi/series?warehouse_id&grain=day|week|month|year&date_from&date_to&compare=none|prev|yoy
// CHUỖI theo chu kỳ cho biểu đồ đường (thực tế ↔ mục tiêu) — chỉ KPI theo kỳ (không snapshot). Một request:
// RPC tự lặp từng kỳ (trần 60 kỳ, quá → 400 kèm hướng dẫn). `compare` = chuỗi kỳ so, dịch cùng cách với GET /kpi.
type Grain = 'day' | 'week' | 'month' | 'year'
type SeriesRow = { key: string; from: string; to: string; days: number; totals: Record<string, NumDen>; cost_shared: number }
async function callSeries(args: Record<string, unknown>, ttl: number, grain: Grain, from: string, to: string): Promise<SeriesRow[]> {
  const { data, error } = await supabase.rpc('warehouse_kpi_series', { ...args, p_grain: grain, p_from: from, p_to: to, p_ttl_seconds: ttl })
  if (error) throw error
  return (data ?? []) as SeriesRow[]
}
export async function getKpiSeries(req: Request, res: Response) {
  try {
    const q = req.query as { grain?: string; date_from?: string; date_to?: string; compare?: string }
    const grain = String(q.grain ?? 'month').trim() as Grain
    if (!['day', 'week', 'month', 'year'].includes(grain)) return fail(res, 'grain phải là day | week | month | year', 400, 'BAD_GRAIN')
    const from = String(q.date_from ?? '').trim(), to = String(q.date_to ?? '').trim()
    if (!isDate(from) || !isDate(to)) return fail(res, 'date_from, date_to (YYYY-MM-DD) là bắt buộc', 400, 'BAD_DATE')
    if (from > to) return fail(res, 'Khoảng ngày không hợp lệ: "Từ" lớn hơn "Đến"', 400, 'BAD_RANGE')
    const cmpRaw = String(q.compare ?? 'none').trim()
    if (!['none', 'prev', 'yoy'].includes(cmpRaw)) return fail(res, 'compare phải là none | prev | yoy', 400, 'BAD_COMPARE')
    // Trần kỳ kiểm TRƯỚC khi gọi DB — không để người dùng chờ tới timeout rồi mới biết
    const days = dayCount(from, to)
    const approxBuckets = grain === 'day' ? days : grain === 'week' ? Math.ceil(days / 7) + 1 : grain === 'month' ? Math.ceil(days / 28) + 1 : Math.ceil(days / 365) + 1
    if (approxBuckets > 61) {
      const unit = grain === 'day' ? 'ngày' : grain === 'week' ? 'tuần' : grain === 'month' ? 'tháng' : 'năm'
      return fail(res, `Tối đa 60 ${unit} trên một biểu đồ (đang chọn ~${approxBuckets}) — thu hẹp khoảng hoặc đổi chu kỳ lớn hơn`, 400, 'TOO_MANY_BUCKETS')
    }
    const sc = await parseScope(req, res)
    if (!sc) return
    const { targets, args, ttl } = await rpcArgs(sc.whIds, sc.cats)
    const cmp = compareRange(cmpRaw as CompareMode, from, to)
    let cur: SeriesRow[], prev: SeriesRow[] | null
    try {
      ;[cur, prev] = await Promise.all([callSeries(args, ttl, grain, from, to), cmp ? callSeries(args, ttl, grain, cmp.from, cmp.to) : Promise.resolve(null)])
    } catch (e) {
      const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)
      if (/TOO_MANY_BUCKETS/.test(msg)) return fail(res, 'Quá 60 kỳ trên một biểu đồ — thu hẹp khoảng hoặc đổi chu kỳ lớn hơn', 400, 'TOO_MANY_BUCKETS')
      throw e
    }
    const showCost = canSeeCost(req)
    const defs = KPI_DEFS.filter(d => !d.snapshot && (showCost || !d.cost))
    const toBuckets = (rows: SeriesRow[]) => rows.map(r => {
      const tot = totalsWithShared({ totals: r.totals ?? {}, cost_shared: Number(r.cost_shared ?? 0) } as RpcOut)
      const values: Record<string, number | null> = {}
      for (const d of defs) { const nd = tot[d.id] ?? { num: null, den: null }; values[d.id] = kpiValue(d, nd.num, nd.den, Number(r.days)) }
      return { key: r.key, from: r.from, to: r.to, days: Number(r.days), values }
    })
    const whForTarget = sc.sel || null
    const targetsOut: Record<string, number[] | null> = {}
    for (const d of defs) targetsOut[d.id] = effectiveTarget(d, targets, whForTarget).t
    return ok(res, {
      grain, from, to, defs: defs.map(publicDef), targets: targetsOut,
      buckets: toBuckets(cur),
      compare: prev && cmp ? { mode: cmpRaw, from: cmp.from, to: cmp.to, buckets: toBuckets(prev) } : null,
    })
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e)) }
}

// GET /wms/kpi/targets — cấu hình thô (form đọc để sửa)
export async function getKpiTargets_(req: Request, res: Response) {
  try {
    const t = await getKpiTargets()
    const scope = scopeWhIds(req)
    // Người bị giới hạn kho chỉ thấy ghi đè của kho mình
    const by_warehouse = scope ? Object.fromEntries(Object.entries(t.by_warehouse).filter(([k]) => scope.includes(k))) : t.by_warehouse
    return ok(res, { ...t, by_warehouse, defs: KPI_DEFS.map(publicDef), groups: KPI_GROUPS })
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e)) }
}

// PUT /wms/kpi/targets — requirePerm dashboard.kpi_target
// body { warehouse_id: string|null, targets: {kpi: number[]|null}, params?: {slow_days, dead_days} }
// Thay TRỌN bộ mục tiêu của phạm vi đó (mặc định hoặc 1 kho). params chỉ nhận khi warehouse_id null.
export async function putKpiTargets(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { warehouse_id?: unknown; targets?: unknown; params?: unknown }
    const whRaw = body.warehouse_id
    if (whRaw != null && (typeof whRaw !== 'string' || !whRaw.trim() || whRaw.length > 64))
      return fail(res, 'warehouse_id phải là chuỗi hoặc null', 400, 'BAD_WAREHOUSE')
    const wh = typeof whRaw === 'string' ? whRaw.trim() : null
    if (wh) {
      const scope = scopeWhIds(req)
      if (scope && !scope.includes(wh)) return fail(res, 'Kho ngoài phạm vi được gán', 403, 'WAREHOUSE_OUT_OF_SCOPE')
      const { data: w } = await supabase.from('Warehouse').select('id').eq('id', wh).maybeSingle()
      if (!w) return fail(res, 'Kho không tồn tại', 400, 'BAD_WAREHOUSE')
    } else if (scopeWhIds(req)) {
      // Mục tiêu MẶC ĐỊNH áp cho mọi kho — người bị giới hạn kho không được sửa phần chung
      return fail(res, 'Chỉ người có phạm vi toàn công ty mới sửa mục tiêu mặc định; hãy đặt riêng cho kho của bạn', 403, 'SCOPE_LIMITED')
    }
    const tErr = targetMapError(body.targets)
    if (tErr) return fail(res, tErr, 400, 'INVALID_TARGET')
    if (body.params !== undefined) {
      if (wh) return fail(res, 'Ngưỡng chậm/không luân chuyển là tham số chung, chỉ sửa ở phạm vi mặc định', 400, 'INVALID_PARAMS')
      const pErr = paramsError(body.params)
      if (pErr) return fail(res, pErr, 400, 'INVALID_PARAMS')
    }

    const { data: row } = await supabase.from('SystemSetting').select('value').eq('key', 'kpi_targets').maybeSingle()
    const before = parseKpiTargets(row?.value) ?? KPI_TARGETS_DEFAULT
    const next: KpiTargets = {
      default: wh ? before.default : (body.targets as KpiTargetMap),
      by_warehouse: wh ? { ...before.by_warehouse, [wh]: body.targets as KpiTargetMap } : before.by_warehouse,
      params: (!wh && body.params !== undefined) ? body.params as KpiTargets['params'] : before.params,
    }
    // Ghi đè kho RỖNG {} = "về mặc định" → xoá khoá cho gọn
    if (wh && Object.keys(next.by_warehouse[wh]).length === 0) delete next.by_warehouse[wh]
    if (!parseKpiTargets(next)) return fail(res, 'Cấu hình sau khi ghép không hợp lệ', 400, 'INVALID_TARGET')

    const { error } = await supabase.from('SystemSetting').upsert({
      key: 'kpi_targets', value: next, updated_by: req.user?.name ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
    if (error) return fail(res, error)
    invalidateSettingsCache()
    if (JSON.stringify(before) !== JSON.stringify(next))
      await logAdmin(req, { action: 'SETTING_UPDATE', target_type: 'SystemSetting', target_id: 'kpi_targets',
        target_label: wh ? `kpi_targets · kho ${wh}` : 'kpi_targets · mặc định', before: { value: before }, after: { value: next } })
    return ok(res, next)
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e)) }
}
