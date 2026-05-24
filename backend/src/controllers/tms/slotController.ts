import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

interface SlotTemplateRow {
  id: string; vehicle_type_id: string; direction: string; cargo_type: string
  day_of_week: number; time_from: string; time_to: string; max_vehicles: number
}

// GET /api/tms/slots?date=YYYY-MM-DD&warehouse_id=...&direction=...
export async function listSlots(req: Request, res: Response) {
  try {
    const { date, warehouse_id, direction } = req.query as Record<string, string>
    if (!date || !warehouse_id) return fail(res, 'date và warehouse_id là bắt buộc', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('DeliverySlot') as any)
      .select('id, template_id, warehouse_id, vehicle_type_id, vehicle_type:VehicleType(id, code, name), direction, cargo_type, date, time_from, time_to, max_vehicles, booked_count, status')
      .eq('date', date)
      .eq('warehouse_id', warehouse_id)
      .order('time_from')

    if (direction) q = q.eq('direction', direction)

    const { data, error } = await q
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// POST /api/tms/slots/generate
// Body: { warehouse_id: string, dates: string[] }  — VD: ["2026-05-20", "2026-05-21"]
// Idempotent: chỉ INSERT slot chưa có, bỏ qua slot đã tồn tại cho (template_id, date)
export async function generateSlotsForDates(req: Request, res: Response) {
  try {
    const { warehouse_id, dates } = req.body as { warehouse_id?: string; dates?: string[] }
    if (!warehouse_id) return fail(res, 'warehouse_id là bắt buộc', 400)
    if (!dates?.length) return fail(res, 'dates là bắt buộc (mảng YYYY-MM-DD)', 400)

    // Validate định dạng ngày
    const validDates = dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    if (!validDates.length) return fail(res, 'Không có ngày hợp lệ (cần định dạng YYYY-MM-DD)', 400)

    // Lấy template đang hoạt động của kho này
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: templates, error: tmplErr } = await (supabase.from('SlotTemplate') as any)
      .select('id, vehicle_type_id, direction, cargo_type, day_of_week, time_from, time_to, max_vehicles')
      .eq('is_active', true)
      .eq('warehouse_id', warehouse_id)
    if (tmplErr) return fail(res, tmplErr.message)
    if (!templates?.length) return ok(res, { created: 0, message: 'Chưa có template nào được tạo' })

    // Tìm slot đã tồn tại để tránh duplicate
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase.from('DeliverySlot') as any)
      .select('template_id, date')
      .in('date', validDates)
      .not('template_id', 'is', null)
    const existingSet = new Set(
      ((existing ?? []) as { template_id: string; date: string }[])
        .map(e => `${e.template_id}:${e.date}`)
    )

    const now = new Date().toISOString()
    const rows: object[] = []

    for (const dateStr of validDates) {
      // JS getDay(): 0=Sun, 1=Mon…6=Sat → ISODOW: 1=T2…6=T7
      const jsDay = new Date(dateStr + 'T00:00:00').getDay()
      if (jsDay === 0) continue // bỏ Chủ nhật
      const dow = jsDay // 1=T2…6=T7 (khớp với SlotTemplate.day_of_week)

      for (const tmpl of (templates as SlotTemplateRow[])) {
        if (tmpl.day_of_week !== dow) continue
        if (existingSet.has(`${tmpl.id}:${dateStr}`)) continue
        rows.push({
          id: randomUUID(), template_id: tmpl.id,
          warehouse_id,
          vehicle_type_id: tmpl.vehicle_type_id, direction: tmpl.direction, cargo_type: tmpl.cargo_type,
          date: dateStr, time_from: tmpl.time_from, time_to: tmpl.time_to,
          max_vehicles: tmpl.max_vehicles, booked_count: 0, status: 'OPEN',
          created_at: now, updated_at: now,
        })
      }
    }

    if (!rows.length) return ok(res, { created: 0, message: 'Slot đã tồn tại cho tất cả ngày được yêu cầu' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insErr } = await (supabase.from('DeliverySlot') as any).insert(rows)
    if (insErr) return fail(res, insErr.message)

    return ok(res, { created: rows.length, dates: validDates })
  } catch (e) { return fail(res, String(e)) }
}
