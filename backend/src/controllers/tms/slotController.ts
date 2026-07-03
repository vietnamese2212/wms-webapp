import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { fetchAllRowsParallel } from '../../utils/pagination'

interface SlotTemplateRow {
  id: string; vehicle_type_id: string; cargo_type: string
  day_of_week: number; time_from: string; time_to: string; max_vehicles: number
}

// GET /api/tms/slots?date=YYYY-MM-DD&warehouse_id=...&direction=...
export async function listSlots(req: Request, res: Response) {
  try {
    const { date, warehouse_id, direction } = req.query as Record<string, string>
    if (!date || !warehouse_id) return fail(res, 'date và warehouse_id là bắt buộc', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = supabase.from('DeliverySlot')
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

    // Scope-write: user ASSIGNED chỉ sinh slot cho kho mình. NATIONAL/ĐVVT → bỏ qua.
    const scope = req.user?.warehouse_scope === 'NATIONAL' || req.user?.ncc_id ? null : (req.user?.warehouse_ids ?? [])
    if (scope !== null && !scope.includes(warehouse_id))
      return fail(res, 'Ngoài phạm vi kho — không thể sinh khung giờ cho kho này', 403)

    // Validate định dạng ngày
    const validDates = dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    if (!validDates.length) return fail(res, 'Không có ngày hợp lệ (cần định dạng YYYY-MM-DD)', 400)

    // Lấy template đang hoạt động của kho này — phân trang (SlotTemplate đã >1000 dòng toàn hệ thống)
    let templates: SlotTemplateRow[]
    try {
      templates = await fetchAllRowsParallel(() => supabase.from('SlotTemplate')
        .select('id, vehicle_type_id, cargo_type, day_of_week, time_from, time_to, max_vehicles')
        .eq('is_active', true)
        .eq('warehouse_id', warehouse_id)
        .order('id')) as SlotTemplateRow[]
    } catch (e) { return fail(res, e instanceof Error ? e.message : String(e)) }
    if (!templates?.length) return ok(res, { created: 0, message: 'Chưa có template nào được tạo' })

    // Tìm slot đã tồn tại để tránh duplicate — LỌC THEO KHO (trước đây quét mọi kho: vừa thừa
    // vừa dễ vượt cap 1000 → existingSet thiếu → sinh TRÙNG slot) + phân trang
    const existing = await fetchAllRowsParallel(() => supabase.from('DeliverySlot')
      .select('template_id, date')
      .eq('warehouse_id', warehouse_id)
      .in('date', validDates)
      .not('template_id', 'is', null)
      .order('id'))
    const existingSet = new Set(
      ((existing ?? []) as { template_id: string; date: string }[])
        .map(e => `${e.template_id}:${e.date}`)
    )

    const now = new Date().toISOString()
    const rows: object[] = []

    for (const dateStr of validDates) {
      // Parse dateStr (YYYY-MM-DD) as UTC midnight để getUTCDay() trả đúng thứ.
      // getDay() sai trên Vercel (UTC): '2026-06-01T00:00:00+07:00' → UTC May 31 → getDay()=0 (CN).
      const [y, m, d] = dateStr.split('-').map(Number)
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=CN,1=T2…6=T7 (khớp SlotTemplate.day_of_week; CN chỉ sinh nếu có template CN)

      for (const tmpl of (templates as SlotTemplateRow[])) {
        if (tmpl.day_of_week !== dow) continue
        if (existingSet.has(`${tmpl.id}:${dateStr}`)) continue
        rows.push({
          id: randomUUID(), template_id: tmpl.id,
          warehouse_id,
          vehicle_type_id: tmpl.vehicle_type_id, cargo_type: tmpl.cargo_type,
          date: dateStr, time_from: tmpl.time_from, time_to: tmpl.time_to,
          max_vehicles: tmpl.max_vehicles, booked_count: 0, status: 'OPEN',
          created_at: now, updated_at: now,
        })
      }
    }

    if (!rows.length) return ok(res, { created: 0, message: 'Slot đã tồn tại cho tất cả ngày được yêu cầu' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insErr } = await supabase.from('DeliverySlot').insert(rows)
    if (insErr) return fail(res, insErr.message)

    return ok(res, { created: rows.length, dates: validDates })
  } catch (e) { return fail(res, String(e)) }
}
