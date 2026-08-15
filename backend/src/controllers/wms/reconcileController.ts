// ĐỢT 2 — Hàng chờ "Cần xử lý" (đối chiếu SAP↔WMS). Quyền outbound.reconcile.
// Engine (services/outboundReconcile) ghi reconcile_tasks; controller này = LIST + RESOLVE (người xử).
import { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { safeFilterValue } from '../../utils/search'
import { loosePalletRemainder, type MatPalletUnits } from './outboundController'

const now = () => new Date().toISOString()

// GET /wms/outbound/reconcile-tasks — list (mặc định status=OPEN = "cần xử lý")
export async function listReconcileTasks(req: Request, res: Response) {
  try {
    const { q, status, gdo_id, action, date_from, date_to } = req.query as Record<string, string>
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 50))

    let query = supabase.from('reconcile_tasks').select('*', { count: 'exact' })
    query = query.eq('status', status || 'OPEN')
    if (gdo_id) query = query.eq('gdo_id', gdo_id)
    if (action) query = query.eq('action', action)
    if (date_from) query = query.gte('created_at', new Date(`${date_from}T00:00:00+07:00`).toISOString())
    if (date_to)   query = query.lte('created_at', new Date(`${date_to}T23:59:59.999+07:00`).toISOString())
    if (q && q.trim()) {
      const s = safeFilterValue(q.trim())
      query = query.or(`group_code.ilike.%${s}%,material_code.ilike.%${s}%,od_number.ilike.%${s}%`)
    }
    query = query.order('created_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1)

    const { data, count, error } = await query
    if (error) throw new Error(error.message)
    const items = (data ?? []) as Record<string, unknown>[]
    // Enrich tên hàng (bounded theo trang)
    const codes = [...new Set(items.map(i => String(i.material_code ?? '')).filter(Boolean))]
    if (codes.length) {
      const { data: mats } = await supabase.from('Material').select('material_code, short_name').in('material_code', codes)
      const nameByCode = new Map((mats ?? []).map((m: { material_code: string; short_name: string | null }) => [String(m.material_code).trim(), m.short_name]))
      for (const i of items) i.material_name = nameByCode.get(String(i.material_code ?? '').trim()) ?? i.material_name ?? null
    }
    return ok(res, { items, total: count ?? 0, page, page_size: pageSize })
  } catch (e) { return fail(res, String(e)) }
}

// GET /wms/outbound/:id/events — LỊCH SỬ 1 chuyến cho nút "Thông tin" (user chốt 03/08:
// "thay đổi như thế nào, bởi ai, lúc nào, nguồn nào"). Gộp 2 nguồn để thành MỘT dòng thời gian:
//   outbound_events  = nhật ký kế hoạch/chuyến (ghi tại nơi biết được thay đổi)
//   reconcile_tasks  = thay đổi đến từ SAP (số cũ → số mới, đã quét bao nhiêu, xử lý ra sao)
// Chuyến bị xóa-tạo-lại khi replan (id đổi) nên tra theo group_code MỚI là chính, gdo_id chỉ phụ.
export async function listOutboundEvents(req: Request, res: Response) {
  try {
    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select('id, group_code').eq('id', req.params.id).maybeSingle()
    if (!gdo) return fail(res, 'Không tìm thấy chuyến', 404)
    const gc = (gdo as { group_code: string }).group_code

    const [evRes, rcRes] = await Promise.all([
      supabase.from('outbound_events').select('*').eq('group_code', gc).order('created_at', { ascending: false }).limit(300),
      supabase.from('reconcile_tasks').select('*').eq('group_code', gc).order('created_at', { ascending: false }).limit(300),
    ])
    const ACTION_LABEL: Record<string, string> = {
      AUTO_APPLIED: 'SAP_AUTO_APPLIED', NEEDS_REVIEW: 'SAP_NEEDS_REVIEW',
      BLOCKED: 'SAP_BLOCKED', RECONCILE_ONLY: 'SAP_RECONCILE_ONLY',
    }
    type Ev = { id: string; event_type: string; source: string; actor: string | null; do_number: string | null
      material_code: string | null; old_value: string | null; new_value: string | null; detail: string; created_at: string }
    const items: Ev[] = [
      ...((evRes.data ?? []) as Ev[]),
      ...((rcRes.data ?? []) as unknown as { id: string; action: string; actor: string | null; od_number: string | null
        material_code: string | null; old_ordered: number | null; new_ordered: number | null; detail: string | null
        change_type: string; created_at: string }[]).map(t => ({
        id: t.id,
        event_type: ACTION_LABEL[t.action] ?? 'SAP_CHANGE',
        source: 'SAP',
        actor: t.actor,
        do_number: t.od_number,
        material_code: t.material_code,
        old_value: t.old_ordered == null ? null : String(t.old_ordered),
        new_value: t.new_ordered == null ? null : String(t.new_ordered),
        detail: t.detail ?? t.change_type,
        created_at: t.created_at,
      })),
    ].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    return ok(res, { items, group_code: gc })
  } catch (e) { return fail(res, String(e)) }
}

// GET /wms/outbound/reconcile-tasks/count — số việc đang OPEN (badge)
export async function reconcileOpenCount(_req: Request, res: Response) {
  try {
    const { count, error } = await supabase.from('reconcile_tasks').select('id', { count: 'exact', head: true }).eq('status', 'OPEN')
    if (error) throw new Error(error.message)
    return ok(res, { open: count ?? 0 })
  } catch (e) { return fail(res, String(e)) }
}

// POST /wms/outbound/reconcile-tasks/:id/resolve  body {resolution: 'apply'|'keep'|'manual_done'}
export async function resolveReconcileTask(req: Request, res: Response) {
  try {
    const resolution = String((req.body as { resolution?: string })?.resolution ?? '')
    if (!['apply', 'keep', 'manual_done'].includes(resolution)) return fail(res, 'resolution phải là apply | keep | manual_done', 400)

    const { data: task } = await supabase.from('reconcile_tasks').select('*').eq('id', req.params.id).maybeSingle()
    if (!task) return fail(res, 'Không tìm thấy việc cần xử lý', 404)
    if (task.status === 'RESOLVED') return fail(res, 'Việc này đã được xử lý', 409)

    if (resolution === 'apply') {
      // Áp SAP vào đơn WMS — CHỈ khi an toàn (không mất dữ liệu đã quét)
      if (task.change_type === 'MATERIAL_CHANGED')
        return fail(res, 'Đổi mã hàng phải xử tay ở Xuất kho (QR khác) — dùng "Đã xử lý tay" sau khi sửa.', 422)
      const newOrdered = Number(task.new_ordered)
      const scanned = Number(task.scanned)
      if (newOrdered < scanned)
        return fail(res, `SAP (${newOrdered}) ít hơn ĐÃ QUÉT (${scanned}) — cần TRẢ HÀNG ${scanned - newOrdered} rồi sửa ở Xuất kho, sau đó "Đã xử lý tay".`, 422)
      if (!task.item_id) return fail(res, 'Việc này không gắn dòng đơn để áp', 422)

      const { data: item } = await supabase.from('OutboundItem')
        .select('id, do_id, material_id, od_refs, cartons_scanned').eq('id', task.item_id).maybeSingle()
      if (!item) return fail(res, 'Dòng đơn đã không còn tồn tại', 404)

      // Kho (loose theo cpp override kho) + material units
      let whId: string | null = null
      const { data: dlv } = await supabase.from('OutboundDelivery').select('gdo_id').eq('id', item.do_id).maybeSingle()
      if (dlv?.gdo_id) { const { data: g } = await supabase.from('GroupDeliveryOrder').select('warehouse_id').eq('id', dlv.gdo_id).maybeSingle(); whId = g?.warehouse_id ?? null }
      let mu: MatPalletUnits | null = null
      if (item.material_id) {
        const { data: m } = await supabase.from('Material')
          .select('units_per_carton, entry_unit, base_unit, cartons_per_pallet, warehouse_pallet_overrides').eq('id', item.material_id).maybeSingle()
        mu = (m as MatPalletUnits) ?? null
      }
      // Refresh snapshot od_refs.qty_base từ raw HIỆN TẠI (ACTIVE) — nguồn so sánh lần sau
      const refs = (item.od_refs ?? []) as { od_number: string; od_item: string; qty_base: number }[]
      const refOds = [...new Set(refs.map(r => r.od_number))]
      const rawByKey = new Map<string, number>()
      if (refOds.length) {
        const { data: raws } = await supabase.from('erp_outbound_orders')
          .select('od_number, od_item, qty_base, sync_status').in('od_number', refOds)
        for (const r of ((raws ?? []) as { od_number: string; od_item: string; qty_base: number | null; sync_status: string | null }[]))
          if (r.sync_status !== 'OBSOLETE') rawByKey.set(`${r.od_number}__${r.od_item}`, Number(r.qty_base ?? 0))
      }
      const newRefs = refs.map(r => ({ od_number: r.od_number, od_item: r.od_item, qty_base: rawByKey.get(`${r.od_number}__${r.od_item}`) ?? 0 }))

      await supabase.from('OutboundItem').update({
        cartons_ordered: newOrdered,
        loose_picking: loosePalletRemainder(newOrdered, mu, whId),
        od_refs: newRefs,
        updated_at: now(),
      }).eq('id', item.id)
    }

    const { data, error } = await supabase.from('reconcile_tasks').update({
      status: 'RESOLVED', resolution, resolved_by: req.user?.name ?? null, resolved_at: now(), updated_at: now(),
    }).eq('id', req.params.id).select().maybeSingle()
    if (error) throw new Error(error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}
