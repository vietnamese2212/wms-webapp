import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { fetchAllRowsParallel, isRangeNotSatisfiable } from '../../utils/pagination'

// ─── Phiếu cân trạm cân 100T (PM Cân Kinh Bắc) ────────────────────────────────
// Agent LAN đọc Access TVTDB.mdb (bảng WeightForm) → POST lô phiếu lên đây (ApiKey
// scope weigh:write). Upsert theo (station_code, source_id) — agent gửi lại vô hại.
// Auto-khớp chuyến XUẤT theo biển số chuẩn hóa + ngày (duy nhất mới gắn, mơ hồ để tay).

const now = () => new Date().toISOString()

function ok(res: Response, data: unknown, status = 200) {
  return res.status(status).json({ success: true, data })
}
function fail(res: Response, message: string, status = 500, code = 'ERROR') {
  return res.status(status).json({ success: false, error: { code, message } })
}

// Biển số về dạng khớp: bỏ mọi ký tự không phải chữ/số + upper ("29K-06037" → "29K06037")
export function normPlate(s: string | null | undefined): string | null {
  const n = String(s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return n || null
}

// PM cân lưu giờ dạng "HH:mm:ss-dd/MM/yyyy" (WChar) → ISO UTC (giờ VN +07:00)
function parseKbTime(s: string | null | undefined): string | null {
  const m = String(s ?? '').trim().match(/^(\d{2}):(\d{2}):(\d{2})-(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  return new Date(`${m[6]}-${m[5]}-${m[4]}T${m[1]}:${m[2]}:${m[3]}+07:00`).toISOString()
}
// GDate "dd/MM/yyyy" → "yyyy-MM-dd"
function parseKbDate(s: string | null | undefined): string | null {
  const m = String(s ?? '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}
function numOrNull(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Payload agent gửi = cột GỐC của WeightForm (agent không map gì — BE là nơi hiểu schema cân)
interface KbTicket {
  id?: number; OrderNum?: string; GDate?: string
  TruckNum?: string; TransCompany?: string; GoodsName?: string
  GrossWeight?: number; TareWeight?: number; NetWeight?: number
  GrossTime?: string; TareTime?: string; GInTime?: string; GOutTime?: string
  ImExType?: string; InOut?: number
}

// POST /api/integration/v1/weigh/tickets  { station_code?, warehouse_id?, tickets: KbTicket[] }
export async function ingestWeighTickets(req: Request, res: Response) {
  try {
    const { station_code, warehouse_id, tickets } =
      req.body as { station_code?: string; warehouse_id?: string; tickets?: KbTicket[] }
    const station = String(station_code ?? 'KB01').trim() || 'KB01'
    if (!Array.isArray(tickets)) return fail(res, 'tickets phải là mảng', 400, 'VALIDATION_ERROR')
    if (tickets.length === 0) return ok(res, { upserted: 0, matched: 0 })
    if (tickets.length > 500) return fail(res, 'Tối đa 500 phiếu/lần', 400, 'VALIDATION_ERROR')

    // Kho của trạm cân (config agent) — validate để bắt lỗi cấu hình ngay, không lưu id rác
    const whId = String(warehouse_id ?? '').trim() || null
    if (whId) {
      const { data: wh } = await supabase.from('Warehouse').select('id').eq('id', whId).maybeSingle()
      if (!wh) return fail(res, `warehouse_id không tồn tại: ${whId}`, 400, 'VALIDATION_ERROR')
    }

    const t = now()
    const rows = tickets
      .filter(k => Number.isFinite(Number(k?.id)))
      .map(k => {
        const net = numOrNull(k.NetWeight)
        const tareAt = parseKbTime(k.TareTime), grossAt = parseKbTime(k.GrossTime)
        // giờ cân LẦN 1 = GInTime; thiếu thì lấy mốc cân sớm nhất (bì hoặc tổng) — dùng để sort list
        const firstWeigh = [tareAt, grossAt].filter((v): v is string => !!v).sort()[0] ?? null
        return {
          id: randomUUID() as string,   // chỉ dùng khi INSERT — dòng đã có sẽ được đắp id cũ bên dưới
          station_code: station,
          source_id: Number(k.id),
          ticket_no: String(k.OrderNum ?? '').trim() || null,
          weigh_date: parseKbDate(k.GDate),
          license_plate: String(k.TruckNum ?? '').trim() || null,
          license_plate_norm: normPlate(k.TruckNum),
          direction: String(k.ImExType ?? '').trim() || null,
          goods_name: String(k.GoodsName ?? '').trim() || null,
          trans_company: String(k.TransCompany ?? '').trim() || null,
          tare_kg: numOrNull(k.TareWeight),
          tare_at: tareAt,
          gross_kg: numOrNull(k.GrossWeight),
          gross_at: grossAt,
          net_kg: net,
          in_time: parseKbTime(k.GInTime) ?? firstWeigh,
          out_time: parseKbTime(k.GOutTime),
          is_complete: (net ?? 0) > 0,
          raw: k as unknown,
          updated_at: t,
          // chỉ đưa key khi agent có khai kho — chưa apply migration warehouse_id vẫn ingest được
          ...(whId ? { warehouse_id: whId } : {}),
        }
      })
    if (rows.length === 0) return fail(res, 'Không có phiếu hợp lệ (thiếu id)', 400, 'VALIDATION_ERROR')

    // Upsert giữ id + gdo_id cũ: lấy các dòng đã có trước, đắp id cũ vào payload
    const srcIds = rows.map(r => r.source_id)
    const existing: { id: string; source_id: number; gdo_id: string | null; matched_by: string | null }[] = []
    for (let i = 0; i < srcIds.length; i += 300) {
      const { data } = await supabase.from('WeighTicket')
        .select('id, source_id, gdo_id, matched_by')
        .eq('station_code', station).in('source_id', srcIds.slice(i, i + 300))
      existing.push(...((data ?? []) as typeof existing))
    }
    const oldMap = new Map(existing.map(e => [e.source_id, e]))
    for (const r of rows) {
      const old = oldMap.get(r.source_id)
      if (old) r.id = old.id
    }

    const { error } = await supabase.from('WeighTicket')
      .upsert(rows, { onConflict: 'station_code,source_id' })
    if (error) {
      if (/relation .*WeighTicket.* does not exist/i.test(error.message))
        return fail(res, 'Chưa apply migration 20260716_weigh_tickets', 503, 'NOT_READY')
      return fail(res, `Lỗi lưu phiếu cân: ${error.message}`, 500, 'DB_ERROR')
    }

    // Auto-khớp chuyến XUẤT: phiếu hoàn tất + chưa gắn + có biển số → GDO cùng ngày,
    // biển số chuẩn hóa khớp, DUY NHẤT 1 chuyến mới gắn (mơ hồ để khớp tay trên UI).
    let matched = 0
    const candidates = rows.filter(r => r.is_complete && r.license_plate_norm && r.weigh_date
      && !(oldMap.get(r.source_id)?.gdo_id))
    const dates = [...new Set(candidates.map(r => r.weigh_date))] as string[]
    for (const d of dates) {
      // Phân trang đủ MỌI chuyến trong ngày (cap-1000): cắt cụt → khớp NHẦM khi biển trùng
      const gdos = await fetchAllRowsParallel(() => supabase.from('GroupDeliveryOrder')
        .select('id, license_plate').eq('delivery_date', d)
        .not('license_plate', 'is', null).neq('status', 'CANCELLED').order('id'))
      const byPlate = new Map<string, string[]>()
      for (const g of gdos as { id: string; license_plate: string | null }[]) {
        const p = normPlate(g.license_plate)
        if (!p) continue
        byPlate.set(p, [...(byPlate.get(p) ?? []), g.id])
      }
      for (const r of candidates.filter(c => c.weigh_date === d)) {
        const hits = byPlate.get(r.license_plate_norm as string) ?? []
        if (hits.length === 1) {
          const { error: mErr } = await supabase.from('WeighTicket')
            .update({ gdo_id: hits[0], matched_at: t, matched_by: 'auto', updated_at: t })
            .eq('station_code', station).eq('source_id', r.source_id).is('gdo_id', null)
          if (!mErr) matched++
        }
      }
    }
    return ok(res, { upserted: rows.length, matched })
  } catch (e) { return fail(res, String(e)) }
}

// ─── API cho trang Phiếu cân (WMS UI) ─────────────────────────────────────────

// GET /wms/weigh-tickets?from_date&to_date&q&direction&match_state&warehouse_ids&page&limit
export async function listWeighTickets(req: Request, res: Response) {
  try {
    const { from_date, to_date, q, direction, match_state, warehouse_ids, page = '1', limit = '500' } = req.query
    const pageNum = Math.max(1, parseInt(String(page)))
    const limitNum = Math.min(1000, Math.max(1, parseInt(String(limit))))
    // 2 ô SummaryBand ("Đã cân xong" / "Đã gắn chuyến") phải đếm trên TOÀN BỘ bộ lọc — đếm ở FE
    // trên `rows` là đếm trang đang xem, đứng cạnh ô "Tổng" (toàn bộ) thành hai con số đá nhau.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const countQ = (): any => supabase.from('WeighTicket').select('id', { count: 'exact', head: true })
    let query = supabase.from('WeighTicket')
      .select('*', { count: 'exact' })
      // sort theo GIỜ CÂN LẦN 1 (in_time = GInTime, fallback mốc cân sớm nhất) — user chốt 16/07
      .order('in_time', { ascending: false, nullsFirst: false })
      .order('source_id', { ascending: false })
      .range((pageNum - 1) * limitNum, pageNum * limitNum - 1)
    let qDone = countQ().eq('is_complete', true)
    let qMatch = countQ().not('gdo_id', 'is', null)
    // Scope kho từ JWT (null-inclusive: phiếu chưa gắn kho vẫn hiện) + filter Kho user chọn
    const scopeWhIds = req.user?.warehouse_scope !== 'NATIONAL' ? (req.user?.warehouse_ids ?? []) : []
    const requested = warehouse_ids ? String(warehouse_ids).split(',').filter(Boolean) : []
    const effective = scopeWhIds.length > 0
      ? (requested.length > 0 ? requested.filter(id => scopeWhIds.includes(id)) : scopeWhIds)
      : requested
    if (requested.length > 0 && effective.length === 0)
      return ok(res, { rows: [], total: 0, done: 0, matched: 0, page: pageNum, limit: limitNum })  // chọn kho ngoài scope
    // Cùng 1 mệnh đề lọc cho trang và 2 ô đếm — lệch nhau là số trong band không khớp bảng
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applyFilters = (qq: any): any => {
      if (requested.length > 0) qq = qq.in('warehouse_id', effective)
      else if (effective.length > 0)
        qq = qq.or(`warehouse_id.in.(${effective.join(',')}),warehouse_id.is.null`)
      if (from_date) qq = qq.gte('weigh_date', String(from_date))
      if (to_date)   qq = qq.lte('weigh_date', String(to_date))
      if (direction) qq = qq.eq('direction', String(direction))
      if (match_state === 'matched')   qq = qq.not('gdo_id', 'is', null)
      if (match_state === 'unmatched') qq = qq.is('gdo_id', null)
      if (match_state === 'pending')   qq = qq.eq('is_complete', false)
      if (q) {
        const nq = String(q).trim().replace(/[%_,()]/g, ' ').trim()
        if (nq) {
          const pl = normPlate(nq) ?? nq
          qq = qq.or(`license_plate_norm.ilike.%${pl}%,ticket_no.ilike.%${nq}%,goods_name.ilike.%${nq}%`)
        }
      }
      return qq
    }
    query = applyFilters(query); qDone = applyFilters(qDone); qMatch = applyFilters(qMatch)
    const [{ data, count, error }, doneRes, matchRes] = await Promise.all([query, qDone, qMatch])
    if (error) {
      if (/relation .*WeighTicket.* does not exist/i.test(error.message))
        return fail(res, 'Chưa apply migration 20260716_weigh_tickets', 503, 'NOT_READY')
      if (/warehouse_id/.test(error.message))
        return fail(res, 'Chưa apply migration 20260716_weigh_ticket_warehouse', 503, 'NOT_READY')
      // Trang vượt phạm vi = TRANG RỖNG, không phải lỗi hệ thống (PostgREST trả 416 khi offset ≥
      // tổng dòng). Rất dễ gặp: đang ở trang cuối rồi gõ tìm cho kết quả co lại, hoặc số trang đã
      // được nhớ theo user từ lần trước. Xem `isRangeNotSatisfiable`.
      // Đếm tổng CHỈ chạy ở nhánh này (query chính đã mang `count:'exact'`) — thêm 1 câu đếm
      // luôn chạy là tự làm nặng đường nóng dưới tải ghi.
      if (isRangeNotSatisfiable(error)) {
        const { count: totCount } = await applyFilters(countQ())
        return ok(res, {
          rows: [], total: totCount ?? 0,
          done: doneRes.count ?? 0, matched: matchRes.count ?? 0,
          page: pageNum, limit: limitNum,
        })
      }
      return fail(res, error.message, 500, 'DB_ERROR')
    }
    // Đính group_code của chuyến đã gắn + tên kho (soft link — join tay, ids ít)
    const rows = (data ?? []) as { gdo_id: string | null; warehouse_id?: string | null }[]
    const whIds = [...new Set(rows.map(r => r.warehouse_id).filter((v): v is string => !!v))]
    const whMap = new Map<string, string>()
    if (whIds.length > 0) {
      const { data: whs } = await supabase.from('Warehouse').select('id, name').in('id', whIds.slice(0, 300))
      for (const w of (whs ?? []) as { id: string; name: string }[]) whMap.set(w.id, w.name)
    }
    const gdoIds = [...new Set(rows.map(r => r.gdo_id).filter((v): v is string => !!v))]
    const gdoMap = new Map<string, { group_code: string | null; status: string | null }>()
    for (let i = 0; i < gdoIds.length; i += 300) {
      const { data: gs } = await supabase.from('GroupDeliveryOrder')
        .select('id, group_code, status').in('id', gdoIds.slice(i, i + 300))
      for (const g of (gs ?? []) as { id: string; group_code: string | null; status: string | null }[])
        gdoMap.set(g.id, { group_code: g.group_code, status: g.status })
    }
    const out = rows.map(r => ({
      ...r,
      warehouse_name: r.warehouse_id ? (whMap.get(r.warehouse_id) ?? null) : null,
      gdo_group_code: r.gdo_id ? (gdoMap.get(r.gdo_id)?.group_code ?? null) : null,
      gdo_status:     r.gdo_id ? (gdoMap.get(r.gdo_id)?.status ?? null) : null,
    }))
    return ok(res, {
      rows: out, total: count ?? 0,
      done: doneRes?.count ?? 0, matched: matchRes?.count ?? 0,
      page: pageNum, limit: limitNum,
    })
  } catch (e) { return fail(res, String(e)) }
}

// GET /wms/weigh-tickets/warehouses — chỉ các kho THỰC CÓ phiếu cân (option filter Kho trên FE),
// vẫn cắt scope kho JWT. Check tồn tại từng kho (limit 1, index warehouse_id) — chính xác ở mọi quy mô,
// không dựa DISTINCT trên trang bị cap 1000.
export async function listWeighWarehouses(req: Request, res: Response) {
  try {
    const scoped = req.user?.warehouse_scope !== 'NATIONAL' ? (req.user?.warehouse_ids ?? []) : null
    if (scoped && scoped.length === 0) return ok(res, [])
    let q = supabase.from('Warehouse').select('id, name').order('name')
    if (scoped) q = q.in('id', scoped)
    const { data: whs, error } = await q
    if (error) return fail(res, error.message, 500, 'DB_ERROR')
    const checks = await Promise.all(((whs ?? []) as { id: string; name: string }[]).map(async w => {
      const { data } = await supabase.from('WeighTicket').select('id').eq('warehouse_id', w.id).limit(1)
      return (data ?? []).length > 0 ? w : null
    }))
    return ok(res, checks.filter(Boolean))
  } catch (e) { return fail(res, String(e)) }
}

// PATCH /wms/weigh-tickets/:id/match  { gdo_id: string | null } — gắn/gỡ chuyến tay
export async function matchWeighTicket(req: Request, res: Response) {
  try {
    const { gdo_id } = req.body as { gdo_id?: string | null }
    const t = now()
    if (gdo_id) {
      const { data: g } = await supabase.from('GroupDeliveryOrder')
        .select('id, group_code').eq('id', gdo_id).maybeSingle()
      if (!g) return fail(res, 'Không tìm thấy chuyến xe', 404, 'NOT_FOUND')
    }
    const { data, error } = await supabase.from('WeighTicket')
      .update({
        gdo_id: gdo_id ?? null,
        matched_at: gdo_id ? t : null,
        matched_by: gdo_id ? (req.user?.name ?? null) : null,
        updated_at: t,
      })
      .eq('id', req.params.id).select('id').maybeSingle()
    if (error) return fail(res, error.message, 500, 'DB_ERROR')
    if (!data) return fail(res, 'Không tìm thấy phiếu cân', 404, 'NOT_FOUND')
    return ok(res, { id: req.params.id, gdo_id: gdo_id ?? null })
  } catch (e) { return fail(res, String(e)) }
}
