// TRUNG TÂM CẢNH BÁO (Đợt 2 roadmap 06/08) — quét điều kiện SỐNG, đồng bộ vòng đời vào
// bảng alert_events, bắn Web Push cho cảnh báo MỚI.
//
// Nguyên tắc:
//   · Điều kiện tính SỐNG mỗi lượt quét — hết điều kiện là cảnh báo TỰ ĐÓNG (resolved_at),
//     không bắt user "resolve" tay. Ack chỉ là "tôi biết rồi" (ẩn khỏi list mặc định).
//   · %Date dùng DUY NHẤT computePctDate (luật CLAUDE.md) — RPC chỉ prefilter SIÊU TẬP.
//   · Không pg_cron → quét LƯỜI kiểu cleanupOldPhotos: gọi khi có traffic, throttle 10'/instance.
//   · Rule nào quét LỖI thì bỏ qua vòng đó (không resolve oan cảnh báo của rule đó).
//   · Ngưỡng HARDCODE có chủ đích (CLAUDE.md #2 — chưa ai yêu cầu cấu hình): sửa ở THRESHOLDS.
import { randomUUID } from 'crypto'
import { supabase } from '../lib/supabase'
import { computePctDate, type SupplierOverride } from '../utils/shelfLife'
import { sendPushToPerm } from './pushService'

export const THRESHOLDS = {
  PCT_WARN: 20,          // %Date ≤ 20 → WARNING (khớp ngưỡng đỏ các màn tồn kho)
  PCT_CRIT: 10,          // %Date ≤ 10 → CRITICAL
  GATE_WARN_MIN: 90,     // xe trong cổng chưa ra ≥ 90 phút (khớp mốc đỏ Control Tower)
  GATE_CRIT_MIN: 180,
  TRIP_LATE_DAYS: 14,    // chỉ soi chuyến trễ trong 14 ngày gần (đừng quét cả lịch sử)
  TRIP_STUCK_HOURS: 6,   // chuyến bắt đầu > 6h chưa hoàn thành
  WEIGH_WARN_PCT: 5,     // |cân − KL tính| > 5% (khớp cột đỏ trang Phiếu cân)
  WEIGH_CRIT_PCT: 15,
  EXPIRY_WINDOW_DAYS: 120, // cửa sổ prefilter RPC (siêu tập — quyết định thật ở computePctDate)
}

export type AlertRule = 'EXPIRY' | 'GATE_DWELL' | 'TRIP_LATE' | 'WEIGH_DIFF' | 'BE_ERRORS'
export interface AlertCandidate {
  rule: AlertRule
  dedup_key: string
  severity: 'CRITICAL' | 'WARNING'
  warehouse_id: string | null
  category: string | null
  title: string
  detail: string
  object_url: string | null
}

const now = () => new Date().toISOString()
const vnToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const nf = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 })
const fmtDMY = (d: string | null | undefined) => {
  if (!d) return '?'
  const [y, m, day] = d.slice(0, 10).split('-')
  return `${day}/${m}/${y}`
}

// ── R1: Tồn cận %Date ────────────────────────────────────────────────────────
async function ruleExpiry(): Promise<AlertCandidate[]> {
  const { data, error } = await supabase.rpc('alerts_expiry_candidates', { p_days: THRESHOLDS.EXPIRY_WINDOW_DAYS })
  if (error) throw new Error(error.message)
  type Cand = {
    warehouse_id: string | null; warehouse_name: string | null
    material_id: string; material_code: string | null; short_name: string | null; category: string | null
    production_date: string | null; expiry_date: string | null; shelf_life_days: number | null; ncc_id: string | null
    mat_shelf_life_days: number | null
    supplier_shelf_life_overrides: SupplierOverride[] | null
    qty_base: number; pallets: number
  }
  // Gộp per (kho, mã): mỗi mã 1 cảnh báo/kho — lô nào dưới ngưỡng mới tính (tránh trăm alert/lô)
  const byKey = new Map<string, { c: Cand; worst: number; lots: number; qty: number; pallets: number }>()
  for (const c of ((data ?? []) as Cand[])) {
    const pct = computePctDate(
      { production_date: c.production_date, expiry_date: c.expiry_date, shelf_life_days: c.shelf_life_days, ncc_id: c.ncc_id },
      { shelf_life_days: c.mat_shelf_life_days, supplier_shelf_life_overrides: c.supplier_shelf_life_overrides },
    )
    if (pct == null || pct > THRESHOLDS.PCT_WARN) continue
    const key = `EXPIRY|${c.warehouse_id ?? ''}|${c.material_id}`
    const cur = byKey.get(key)
    if (cur) {
      cur.worst = Math.min(cur.worst, pct); cur.lots++
      cur.qty += Number(c.qty_base); cur.pallets += Number(c.pallets)
    } else byKey.set(key, { c, worst: pct, lots: 1, qty: Number(c.qty_base), pallets: Number(c.pallets) })
  }
  return [...byKey.entries()].map(([key, g]) => ({
    rule: 'EXPIRY' as const, dedup_key: key,
    severity: g.worst <= THRESHOLDS.PCT_CRIT ? 'CRITICAL' as const : 'WARNING' as const,
    warehouse_id: g.c.warehouse_id, category: g.c.category,
    title: `Tồn cận date: ${g.c.material_code ?? '?'} — %Date thấp nhất ${nf(g.worst)}%`,
    detail: `${g.c.short_name ?? g.c.material_code ?? ''} tại ${g.c.warehouse_name ?? 'kho ?'}: ${g.lots} lô ≤ ${THRESHOLDS.PCT_WARN}%Date, ${nf(g.qty)} (base) / ${g.pallets} pallet`,
    object_url: '/wms/inventory',
  }))
}

// ── R2: Xe nằm trong cổng quá lâu ────────────────────────────────────────────
async function ruleGateDwell(): Promise<AlertCandidate[]> {
  const cutWarn = new Date(Date.now() - THRESHOLDS.GATE_WARN_MIN * 60_000).toISOString()
  const floor48 = new Date(Date.now() - 48 * 3600_000).toISOString()
  const { data, error } = await supabase.from('gate_registrations')
    .select('id, license_plate, warehouse_id, warehouse_type, direction, content, entry_at, company_name_raw')
    .not('entry_at', 'is', null).is('exit_at', null)
    .gte('entry_at', floor48).lte('entry_at', cutWarn)
    .order('entry_at').limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []).map((g) => {
    const mins = Math.round((Date.now() - new Date(g.entry_at as string).getTime()) / 60_000)
    return {
      rule: 'GATE_DWELL' as const, dedup_key: `GATE|${g.id}`,
      severity: mins >= THRESHOLDS.GATE_CRIT_MIN ? 'CRITICAL' as const : 'WARNING' as const,
      warehouse_id: (g.warehouse_id as string | null) ?? null,
      category: (g.warehouse_type as string | null) ?? null,
      title: `Xe ${g.license_plate ?? '?'} trong cổng ${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}p chưa ra`,
      detail: `${g.direction === 'OUTBOUND' ? 'Chiều xuất' : 'Chiều nhập'} · vào ${new Date(g.entry_at as string).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })}${g.company_name_raw ? ` · ${g.company_name_raw}` : ''}${g.content ? ` · ${g.content}` : ''}`,
      object_url: '/tms/gate',
    }
  })
}

// ── R3: Chuyến xuất trễ ngày / bắt đầu lâu chưa xong ─────────────────────────
async function ruleTripLate(): Promise<AlertCandidate[]> {
  const today = vnToday()
  const floor = new Date(Date.now() - THRESHOLDS.TRIP_LATE_DAYS * 86400_000)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const out: AlertCandidate[] = []

  const { data: late, error: e1 } = await supabase.from('GroupDeliveryOrder')
    .select('id, group_code, warehouse_id, warehouse_type, delivery_date, status, awaiting_sap, plan_dropped')
    .in('status', ['PENDING', 'IN_PROGRESS', 'PAUSED'])
    .gte('delivery_date', floor).lt('delivery_date', today)
    .order('delivery_date').limit(500)
  if (e1) throw new Error(e1.message)
  for (const g of (late ?? [])) {
    if (g.awaiting_sap === true || g.plan_dropped === true) continue  // chuyến bất động/ngừng — có màn riêng
    out.push({
      rule: 'TRIP_LATE', dedup_key: `TRIP|${g.id}|LATE`, severity: 'WARNING',
      warehouse_id: (g.warehouse_id as string | null) ?? null,
      category: (g.warehouse_type as string | null) ?? null,
      title: `Chuyến ${g.group_code} trễ ngày xuất (${fmtDMY(g.delivery_date as string)})`,
      detail: `Trạng thái ${g.status} — ngày xuất đã qua mà chưa hoàn thành. Xuất tiếp / đổi ngày ở Kế hoạch xuất / hủy.`,
      object_url: `/wms/outbound/${g.id}`,
    })
  }

  const cutStuck = new Date(Date.now() - THRESHOLDS.TRIP_STUCK_HOURS * 3600_000).toISOString()
  const { data: stuck, error: e2 } = await supabase.from('GroupDeliveryOrder')
    .select('id, group_code, warehouse_id, warehouse_type, started_at, delivery_date')
    .eq('status', 'IN_PROGRESS').is('scan_completed_at', null)
    .lte('started_at', cutStuck).gte('delivery_date', floor)
    .order('started_at').limit(500)
  if (e2) throw new Error(e2.message)
  for (const g of (stuck ?? [])) {
    const hrs = Math.floor((Date.now() - new Date(g.started_at as string).getTime()) / 3600_000)
    out.push({
      rule: 'TRIP_LATE', dedup_key: `TRIP|${g.id}|STUCK`, severity: 'WARNING',
      warehouse_id: (g.warehouse_id as string | null) ?? null,
      category: (g.warehouse_type as string | null) ?? null,
      title: `Chuyến ${g.group_code} bắt đầu ${hrs}h chưa hoàn thành`,
      detail: `Bắt đầu xuất từ ${new Date(g.started_at as string).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })} — kiểm tra vướng gì (thiếu hàng / quên bấm Hoàn thành).`,
      object_url: `/wms/outbound/${g.id}`,
    })
  }
  return out
}

// ── R4: Lệch cân vs KL tính từ chuyến ────────────────────────────────────────
async function ruleWeighDiff(): Promise<AlertCandidate[]> {
  const { data, error } = await supabase.from('WeighTicket')
    .select('id, ticket_no, license_plate, net_kg, gdo_id, weigh_date')
    .eq('weigh_date', vnToday()).eq('is_complete', true).not('gdo_id', 'is', null)
    .gt('net_kg', 0).order('id').limit(500)
  if (error) throw new Error(error.message)
  const tickets = (data ?? []) as { id: string; ticket_no: string | null; license_plate: string | null; net_kg: number; gdo_id: string }[]
  if (!tickets.length) return []

  const gdoIds = [...new Set(tickets.map(tk => tk.gdo_id))]
  type Est = { gdo_id: string; kg_planned: number | null; kg_actual: number | null; items_total: number; items_missing: number }
  const estById = new Map<string, Est>()
  for (let i = 0; i < gdoIds.length; i += 300) {
    const { data: ests } = await supabase.rpc('gdo_weight_estimates', { p_gdo_ids: gdoIds.slice(i, i + 300) })
    for (const e of ((ests ?? []) as Est[])) estById.set(e.gdo_id, e)
  }
  const { data: gdos } = await supabase.from('GroupDeliveryOrder')
    .select('id, group_code, warehouse_id, warehouse_type').in('id', gdoIds.slice(0, 300))
  const gdoById = new Map((gdos ?? []).map(g => [g.id as string, g]))

  const out: AlertCandidate[] = []
  for (const tk of tickets) {
    const est = estById.get(tk.gdo_id)
    // Có mã thiếu KL khai báo (dấu *) → KL tính không đáng tin, đừng báo oan
    if (!est || est.items_missing > 0) continue
    const kg = est.kg_actual ?? est.kg_planned
    if (!kg || kg <= 0) continue
    const diffPct = Math.abs(Number(tk.net_kg) - kg) / kg * 100
    if (diffPct <= THRESHOLDS.WEIGH_WARN_PCT) continue
    const g = gdoById.get(tk.gdo_id)
    out.push({
      rule: 'WEIGH_DIFF', dedup_key: `WEIGH|${tk.id}`,
      severity: diffPct > THRESHOLDS.WEIGH_CRIT_PCT ? 'CRITICAL' : 'WARNING',
      warehouse_id: (g?.warehouse_id as string | null) ?? null,
      category: (g?.warehouse_type as string | null) ?? null,
      title: `Lệch cân ${nf(diffPct)}%: xe ${tk.license_plate ?? '?'} (phiếu ${tk.ticket_no ?? tk.id})`,
      detail: `Cân ${nf(Number(tk.net_kg))} kg vs KL tính ${nf(kg)} kg — chuyến ${g?.group_code ?? tk.gdo_id}. Kiểm tra thiếu/thừa hàng hoặc KL khai báo mã.`,
      object_url: '/wms/weigh-tickets',
    })
  }
  return out
}

// ── R5: Lỗi hệ thống BE trong 24h ────────────────────────────────────────────
async function ruleBeErrors(): Promise<AlertCandidate[]> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { count, error } = await supabase.from('error_logs')
    .select('id', { count: 'exact', head: true }).eq('source', 'be').gte('created_at', since)
  if (error) throw new Error(error.message)
  if (!count) return []
  return [{
    rule: 'BE_ERRORS', dedup_key: `BEERR|${vnToday()}`, severity: 'CRITICAL',
    warehouse_id: null, category: null,
    title: `${count} lỗi hệ thống (backend) trong 24h`,
    detail: 'Soi bảng error_logs (staging/production tương ứng) — lỗi 5xx do app tự ghi lại.',
    object_url: null,
  }]
}

// ── Đồng bộ vòng đời + push cảnh báo MỚI ─────────────────────────────────────
const SCAN_INTERVAL_MS = 10 * 60_000
const FORCE_INTERVAL_MS = 20_000   // nút "Quét lại" / QA — vẫn đủ chặn spam liên hồi
let _lastScanAt = 0

export async function runAlertScan(force = false): Promise<void> {
  const min = force ? FORCE_INTERVAL_MS : SCAN_INTERVAL_MS
  if (Date.now() - _lastScanAt < min) return
  _lastScanAt = Date.now()
  try {
    const found: AlertCandidate[] = []
    const okRules: AlertRule[] = []
    const runners: [AlertRule, () => Promise<AlertCandidate[]>][] = [
      ['EXPIRY', ruleExpiry], ['GATE_DWELL', ruleGateDwell], ['TRIP_LATE', ruleTripLate],
      ['WEIGH_DIFF', ruleWeighDiff], ['BE_ERRORS', ruleBeErrors],
    ]
    for (const [rule, fn] of runners) {
      try { found.push(...await fn()); okRules.push(rule) }
      catch (e) { console.error(`[alerts] rule ${rule} lỗi (bỏ qua vòng này):`, e) }
    }
    if (!okRules.length) return
    const t = now()

    // Nạp dòng hiện có theo dedup_key (kể cả đã resolved — unique toàn cục) — chunk 300
    type ExRow = { id: string; dedup_key: string; first_seen: string; pushed_at: string | null
      ack_by: string | null; ack_at: string | null; resolved_at: string | null }
    const exByKey = new Map<string, ExRow>()
    const keys = found.map(f => f.dedup_key)
    for (let i = 0; i < keys.length; i += 300) {
      const { data } = await supabase.from('alert_events')
        .select('id, dedup_key, first_seen, pushed_at, ack_by, ack_at, resolved_at')
        .in('dedup_key', keys.slice(i, i + 300)).limit(1000)
      for (const r of ((data ?? []) as ExRow[])) exByKey.set(r.dedup_key, r)
    }

    // Upsert theo dedup_key — FULL RECORD merge trong JS (chuẩn upload): dòng cũ giữ first_seen/
    // pushed_at/ack; dòng resolved tái xuất hiện = ĐỢT MỚI (first_seen mới, push lại, xóa ack).
    const newOnes: (AlertCandidate & { id: string })[] = []
    const rows = found.map(f => {
      const ex = exByKey.get(f.dedup_key)
      const reopened = !!ex?.resolved_at
      const isNew = !ex || reopened
      const id = ex?.id ?? randomUUID()
      if (isNew) newOnes.push({ ...f, id })
      return {
        id, rule: f.rule, dedup_key: f.dedup_key, severity: f.severity,
        warehouse_id: f.warehouse_id, category: f.category,
        title: f.title, detail: f.detail, object_url: f.object_url,
        first_seen: isNew ? t : ex!.first_seen,
        last_seen: t,
        pushed_at: isNew ? null : ex!.pushed_at,
        ack_by: isNew ? null : ex!.ack_by,
        ack_at: isNew ? null : ex!.ack_at,
        resolved_at: null,
        created_at: isNew ? t : undefined,   // undefined = không đưa vào payload (giữ cũ)
        updated_at: t,
      }
    })
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500).map(r => {
        if (r.created_at === undefined) { const { created_at: _drop, ...rest } = r; return rest }
        return r
      })
      // Cùng lô lẫn dòng có/không created_at → PostgREST dựng cột theo HỢP các key (bẫy NULL-đè).
      // Tách 2 lô theo hình dạng để không đè created_at cũ thành NULL.
      const withCreated = batch.filter(r => 'created_at' in r && (r as { created_at?: string }).created_at !== undefined)
      const withoutCreated = batch.filter(r => !('created_at' in r) || (r as { created_at?: string }).created_at === undefined)
      for (const part of [withCreated, withoutCreated]) {
        if (!part.length) continue
        const { error } = await supabase.from('alert_events').upsert(part, { onConflict: 'dedup_key' })
        if (error) console.error('[alerts] upsert lỗi:', error.message)
      }
    }

    // Tự đóng: dòng OPEN của các rule ĐÃ QUÉT OK mà không còn trong kết quả
    const liveKeys = new Set(found.map(f => f.dedup_key))
    const { data: openRows } = await supabase.from('alert_events')
      .select('id, dedup_key').in('rule', okRules).is('resolved_at', null).limit(5000)
    const closeIds = ((openRows ?? []) as { id: string; dedup_key: string }[])
      .filter(r => !liveKeys.has(r.dedup_key)).map(r => r.id)
    for (let i = 0; i < closeIds.length; i += 300) {
      await supabase.from('alert_events')
        .update({ resolved_at: t, updated_at: t }).in('id', closeIds.slice(i, i + 300))
    }

    // Push cảnh báo MỚI — gộp per kho, 1 thông báo/kho/lượt quét (không dội chuông N lần)
    const byWh = new Map<string | null, (AlertCandidate & { id: string })[]>()
    for (const a of newOnes) byWh.set(a.warehouse_id, [...(byWh.get(a.warehouse_id) ?? []), a])
    for (const [wh, list] of byWh) {
      const crit = list.filter(a => a.severity === 'CRITICAL').length
      await sendPushToPerm('alerts', 'view', wh, {
        title: `${list.length} cảnh báo mới${crit ? ` (${crit} nghiêm trọng)` : ''}`,
        body: list.slice(0, 3).map(a => `· ${a.title}`).join('\n'),
        url: '/wms/alerts',
        tag: `alerts-${wh ?? 'all'}`,
      })
      const ids = list.map(a => a.id)
      for (let i = 0; i < ids.length; i += 300) {
        await supabase.from('alert_events')
          .update({ pushed_at: now(), updated_at: now() }).in('id', ids.slice(i, i + 300))
      }
    }
  } catch (e) { console.error('[alerts] scan lỗi:', e) }
}
