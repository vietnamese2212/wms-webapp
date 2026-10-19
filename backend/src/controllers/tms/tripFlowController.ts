// Chuỗi tình trạng xe (18/10/2026) — GET /tms/trip-flow?codes=a,b,c · POST /tms/vehicle-slots/:id/delivered ("Đã giao" do tài xế)
import { Request, Response } from 'express'
import { db } from '../../lib/supabase'
import { ok, fail, failAny } from '../../utils/response'
import { z, zIdParam, zText } from '../../middlewares/validate'
import { parseListParam } from '../../utils/httpQuery'
import { tripFlowOf, type TripFlow } from '../../services/tripFlow'
import { logOutboundEvents, actorOf } from '../../services/outboundEvents'

// events=1 (19/10, user: "ghi nhận ai làm gì, giờ nào"): kèm lịch sử thao tác (outbound_events) của Số xe — chỉ khi hỏi MỘT mã (popup)
export const zFlowQuery = z.object({ codes: z.string().trim().min(1).max(12_000), events: z.enum(['1']).optional() })
export type TripFlowEvent = { id: string; created_at: string; actor: string | null; event_type: string; source: string | null; do_number: string | null; detail: string | null; old_value: string | null; new_value: string | null }
export const zDeliveredBody = z.object({ note: zText(1, 500).optional(), undo: z.boolean().optional() })

/** Phạm vi: người theo KHO chỉ thấy xe của kho mình (null-inclusive); tài khoản ĐVVT / tài xế chỉ thấy xe của ĐVVT mình. */
function visible(req: Request, f: TripFlow): boolean {
  if (req.user?.is_superadmin) return true
  if (req.user?.ncc_id) return !f.ncc_id || f.ncc_id === req.user.ncc_id
  if (req.user?.warehouse_scope === 'NATIONAL') return true
  const whs = req.user?.warehouse_ids ?? []
  return !f.warehouse_id || whs.includes(f.warehouse_id)
}

// GET /tms/trip-flow?codes=… (≤ 200 Số xe, phẩy) — một câu cho cả lô, các màn gom mã đang hiện rồi hỏi một lần
export async function getTripFlow(req: Request, res: Response) {
  try {
    const codes = [...new Set(parseListParam(req.query.codes) ?? [])]
    if (!codes.length) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu Số xe (codes)')
    if (codes.length > 200) return fail(res, 400, 'TOO_MANY', 'Tối đa 200 Số xe mỗi lần hỏi')
    if (codes.some(c => c.length > 60)) return fail(res, 400, 'BAD_ID', 'Số xe không hợp lệ')
    const flows = (await tripFlowOf(codes)).filter(f => visible(req, f))
    if (req.query.events === '1' && flows.length === 1) {
      const { data, error } = await db.from('outbound_events').select('id, created_at, actor, event_type, source, do_number, detail, old_value, new_value')
        .eq('group_code', flows[0].group_code).order('created_at', { ascending: false }).limit(200)   // limit khai rõ — popup một xe, vết mới nhất trước
      if (error) throw error
      return ok(res, { flows: [{ ...flows[0], events: (data ?? []) as TripFlowEvent[] }] })
    }
    return ok(res, { flows })
  } catch (e) { return failAny(res, e) }
}

// POST /tms/vehicle-slots/:id/delivered { note?, undo? } — tài xế / ĐVVT / điều vận xác nhận xe ĐÃ GIAO (hoặc hoàn tác)
// Luật: chuyến bên Xuất phải ĐÃ HOÀN THÀNH (hàng đã rời kho) — chưa xuất thì chưa thể giao; lệnh ngừng (kế hoạch rút xe) thì không.
export async function confirmDelivered(req: Request, res: Response) {
  try {
    const { id } = req.params as z.infer<typeof zIdParam>
    const b = (req.body ?? {}) as z.infer<typeof zDeliveredBody>
    const { data: slot, error } = await db.from('TmsVehicleSlot')
      .select('id, order_id, delivered_at, license_plate, order:TmsOrder!order_id(id, order_code, ncc_id, plan_dropped, warehouse_id, destination_warehouse_id)')
      .eq('id', id).maybeSingle()
    if (error) throw error
    const s = slot as unknown as { id: string; order_id: string; delivered_at: string | null; license_plate: string | null; order: { id: string; order_code: string; ncc_id: string | null; plan_dropped: boolean | null; warehouse_id: string | null; destination_warehouse_id: string | null } | null } | null
    if (!s?.order) return fail(res, 'Không tìm thấy dòng xe', 404)
    const o = s.order
    // phạm vi: ĐVVT / tài xế chỉ xe của ĐVVT mình; người theo kho chỉ lệnh của kho mình
    if (!req.user?.is_superadmin) {
      if (req.user?.ncc_id) { if (o.ncc_id && o.ncc_id !== req.user.ncc_id) return fail(res, 'Xe này không thuộc ĐVVT của bạn', 403) }
      else if (req.user?.warehouse_scope !== 'NATIONAL') {
        const whs = req.user?.warehouse_ids ?? []
        if (![o.warehouse_id, o.destination_warehouse_id].some(w => w && whs.includes(w))) return fail(res, 'Ngoài phạm vi kho được giao', 403)
      }
    }
    if (o.plan_dropped) return fail(res, 409, 'TMS_PLAN_DROPPED', 'Kế hoạch đã bỏ Số xe này — lệnh ngừng hiệu lực, không ghi "Đã giao"')
    const { data: gdo } = await db.from('GroupDeliveryOrder').select('id, status, plan_dropped').eq('group_code', o.order_code).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    const g = gdo as { id: string; status: string; plan_dropped: boolean | null } | null
    if (!b.undo) {
      if (!g || g.plan_dropped) return fail(res, 409, 'OUTBOUND_NOT_COMPLETED', `Xe ${o.order_code} chưa có chuyến xuất kho còn hiệu lực — không ghi "Đã giao"`)
      if (g.status !== 'COMPLETED') return fail(res, 409, 'OUTBOUND_NOT_COMPLETED', `Chuyến ${o.order_code} bên Xuất kho ${g.status === 'IN_PROGRESS' ? 'ĐANG XUẤT' : 'CHƯA XUẤT'} — hàng chưa rời kho thì chưa thể "Đã giao"`)
    }
    const t = new Date().toISOString()
    const actor = actorOf(req)
    const patch = b.undo
      ? { delivered_at: null, delivered_by: null, delivery_note: null, updated_at: t }
      : { delivered_at: t, delivered_by: actor, delivery_note: b.note ?? null, updated_at: t }
    const { data: upd, error: uErr } = await db.from('TmsVehicleSlot').update(patch).eq('id', id).select('id')
    if (uErr) throw uErr
    if (!(upd ?? []).length) return fail(res, 'Không tìm thấy dòng xe', 404)
    await logOutboundEvents([{ group_code: o.order_code, gdo_id: g?.id ?? null, event_type: b.undo ? 'DELIVERY_UNDONE' : 'DELIVERED', source: 'USER', actor,
      old_value: s.delivered_at, new_value: b.undo ? null : t,
      detail: b.undo ? `${actor} hoàn tác "Đã giao" của xe ${o.order_code} (biển ${s.license_plate ?? '—'})` : `${actor} xác nhận xe ${o.order_code} (biển ${s.license_plate ?? '—'}) ĐÃ GIAO hàng${b.note ? ` — ${b.note}` : ''}` }])
    const [flow] = await tripFlowOf([o.order_code])
    return ok(res, { slot_id: id, delivered_at: b.undo ? null : t, delivered_by: b.undo ? null : actor, flow: flow ?? null })
  } catch (e) { return failAny(res, e) }
}
