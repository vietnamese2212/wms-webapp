import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { relinkAfterDelete } from './gateRegistrationController'
import { normalizePlate } from '../../utils/plate'

// ── Scope-write: user ASSIGNED chỉ thao tác xe của lệnh thuộc kho mình (nguồn hoặc đích).
// NATIONAL → null (toàn quyền). ĐVVT (ncc_id) → null vì scope theo CÔNG TY (book xe liên kho là hợp lệ).
function scopeWhIds(req: Request): string[] | null {
  if (req.user?.warehouse_scope === 'NATIONAL') return null
  if (req.user?.ncc_id) return null
  return req.user?.warehouse_ids ?? []
}
function whInScope(scope: string[], ...whs: (string | null | undefined)[]): boolean {
  return (whs.filter(Boolean) as string[]).some(w => scope.includes(w))
}
// Gác theo order: lệnh phải dính kho trong phạm vi.
async function guardOrderWh(req: Request, res: Response, orderId: string): Promise<boolean> {
  const scope = scopeWhIds(req)
  if (scope === null) return true
  const { data } = await supabase.from('TmsOrder')
    .select('warehouse_id, destination_warehouse_id').eq('id', orderId).maybeSingle()
  if (!data) { fail(res, 'Không tìm thấy đơn hàng', 404); return false }
  const o = data as { warehouse_id: string | null; destination_warehouse_id: string | null }
  if (!whInScope(scope, o.warehouse_id, o.destination_warehouse_id)) {
    fail(res, 'Ngoài phạm vi kho được giao — không thể thao tác xe của lệnh kho này', 403); return false
  }
  return true
}
// Gác theo vehicle-slot id (suy ra order rồi gác kho).
async function guardSlotWh(req: Request, res: Response, slotId: string): Promise<boolean> {
  const scope = scopeWhIds(req)
  if (scope === null) return true
  const { data } = await supabase.from('TmsVehicleSlot')
    .select('order:TmsOrder!order_id(warehouse_id, destination_warehouse_id)').eq('id', slotId).maybeSingle()
  const o = (data as { order: { warehouse_id: string | null; destination_warehouse_id: string | null } | null } | null)?.order ?? null
  if (!o) { fail(res, 'Không tìm thấy vehicle slot', 404); return false }
  if (!whInScope(scope, o.warehouse_id, o.destination_warehouse_id)) {
    fail(res, 'Ngoài phạm vi kho được giao — không thể thao tác xe của lệnh kho này', 403); return false
  }
  return true
}

// Kế toán slot (booked_count + sức chứa) được xử lý NGUYÊN TỬ trong Postgres:
//   • book_vehicle_slot(vslot, new_slot, plate, status, actor) — gán/đổi/nhả slot,
//     kiểm sức chứa bằng ĐẾM SỐNG biển-số-distinct dưới row-lock (không tin booked_count),
//     rồi recount cache. Trả 'OK' | 'FULL' | 'NOT_FOUND' | 'SLOT_NOT_FOUND'.
//   • recount_slot(slot) — tính lại booked_count từ dữ liệu thực (dùng sau khi xóa dòng).
// Xem migration 20260623_atomic_slot_booking.sql. Nhờ vậy hàng trăm user đặt cùng lúc
// KHÔNG thể overbooking và booked_count không lệch (chỉ là cache, capacity dựa đếm sống).

// Helper: tìm gate_regs theo plate+date+warehouse, gom nhóm theo criteria của gate_reg rồi relink
async function relinkGatesByPlate(plate: string, orderId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ord } = await supabase.from('TmsOrder')
    .select('date, warehouse_id')
    .eq('id', orderId)
    .single()
  if (!ord) return
  const o = ord as { date: string; warehouse_id: string }

  const { data: gateGroups } = await supabase
    .from('gate_registrations')
    .select('direction, warehouse_type, vehicle_type, company_id')
    .eq('license_plate', plate)
    .eq('date', o.date)
    .eq('warehouse_id', o.warehouse_id)

  const seen = new Set<string>()
  for (const g of (gateGroups ?? []) as { direction: string | null; warehouse_type: string | null; vehicle_type: string | null; company_id: string | null }[]) {
    const key = `${g.direction ?? '\x00'}|${g.warehouse_type ?? '\x00'}|${g.vehicle_type ?? '\x00'}|${g.company_id ?? '\x00'}`
    if (!seen.has(key)) {
      seen.add(key)
      await relinkAfterDelete(plate, o.date, o.warehouse_id, g.direction, g.warehouse_type, g.vehicle_type, g.company_id)
    }
  }
}

// POST /api/tms/orders/:orderId/vehicle-slots  — thêm xe cho đơn (split delivery)
export async function addVehicleSlot(req: Request, res: Response) {
  try {
    const { orderId } = req.params
    const now = new Date().toISOString()
    if (!(await guardOrderWh(req, res, orderId))) return

    // Kiểm tra order tồn tại
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: order, error: ordErr } = await supabase.from('TmsOrder')
      .select('id').eq('id', orderId).single()
    if (ordErr || !order) return fail(res, 'Không tìm thấy đơn hàng', 404)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.from('TmsVehicleSlot')
      .insert({ id: randomUUID(), order_id: orderId, status: 'PENDING', created_at: now, updated_at: now })
      .select('*, slot:DeliverySlot!slot_id(id, date, time_from, time_to, direction, cargo_type, max_vehicles, booked_count)')
      .single()
    if (error) return fail(res, error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

// PATCH /api/tms/vehicle-slots/:id  — ĐVVT book slot, điền biển số, SĐT
export async function updateVehicleSlot(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { slot_id, license_plate, driver_name, driver_phone, status, consolidation_order_ids, gate_registration_id } = req.body
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = req.user
    const now = new Date().toISOString()
    if (!(await guardSlotWh(req, res, id))) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing, error: fetchErr } = await supabase.from('TmsVehicleSlot')
      .select('id, slot_id, status, order_id, license_plate, consolidation_group_id, is_consolidation_primary').eq('id', id).single()
    if (fetchErr) return fail(res, fetchErr.message)
    if (!existing) return fail(res, 'Không tìm thấy vehicle slot', 404)

    // Không cho thay đổi slot sau ARRIVED/DONE
    if (['ARRIVED', 'DONE'].includes(existing.status as string) && slot_id !== undefined) {
      return fail(res, 'Không thể thay đổi khung giờ sau khi xe đã đến hoặc hoàn thành', 400)
    }

    const newSlotId = slot_id !== undefined ? slot_id : existing.slot_id
    const isChangingSlot = newSlotId !== existing.slot_id
    // Biển số về dạng chuẩn NGAY tại rìa (chỉ chữ+số, in hoa) — DB có CHECK chặn dạng khác
    const newPlate = license_plate !== undefined ? normalizePlate(license_plate) : ((existing.license_plate as string | null) ?? null)
    const isChangingPlate = license_plate !== undefined && newPlate !== ((existing.license_plate as string | null) ?? null)

    // Gác giờ (chỉ đọc) khi đổi khung giờ — làm TRƯỚC khi đụng kế toán
    if (isChangingSlot) {
      const nowMs = Date.now()
      if (existing.slot_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: oldSlot } = await supabase.from('DeliverySlot')
          .select('date, time_from').eq('id', existing.slot_id).single()
        if (oldSlot) {
          const slotStart = new Date(`${oldSlot.date}T${oldSlot.time_from}+07:00`).getTime()
          if (nowMs >= slotStart) {
            return fail(res, `Đã qua giờ ${String(oldSlot.time_from).slice(0, 5)}, không thể thay đổi khung giờ`, 400)
          }
        }
      }
      if (newSlotId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: newSlot } = await supabase.from('DeliverySlot')
          .select('date, time_from, cargo_type').eq('id', newSlotId).single()
        if (!newSlot) return fail(res, 'Slot không tồn tại', 404)
        // ── GÁC CỬA ĐẶT LỊCH (user chốt 03/08 "làm khóa cứng") ──
        // 1 xe chở lẫn nhiều loại nhưng chỉ đậu MỘT cửa, cửa đó KHAI ở Kế hoạch xuất
        // (khvc_lines.booking_category → TmsOrder.booking_category). Lọc ở picker chỉ là GỢI Ý:
        // gọi thẳng API vẫn đặt được khung của cửa khác nếu không gác tại đây. Lệnh chưa chốt cửa
        // (dữ liệu nạp trước khi có cột này) → không gác, giữ hành vi cũ.
        {
          const { data: ord } = await supabase.from('TmsOrder')
            .select('booking_category').eq('id', existing.order_id as string).maybeSingle()
          const cua = (ord as { booking_category?: string | null } | null)?.booking_category ?? null
          const slotCargo = (newSlot as { cargo_type?: string | null }).cargo_type ?? null
          if (cua && slotCargo && slotCargo !== 'ALL' && slotCargo !== cua)
            return fail(res, 422, 'BOOKING_CATEGORY_MISMATCH',
              `Xe đặt lịch tại cửa ${cua} — không đặt được khung giờ của cửa ${slotCargo}. ` +
              'Đổi "Loại kho booking" ở tab Kế hoạch xuất nếu cần.')
        }
        const newSlotStart = new Date(`${newSlot.date}T${newSlot.time_from}+07:00`).getTime()
        if (nowMs >= newSlotStart) {
          return fail(res, `Khung giờ ${String(newSlot.time_from).slice(0, 5)} đã qua, không thể đặt`, 400)
        }
      }
    }

    // Kế toán NGUYÊN TỬ qua RPC khi đổi slot HOẶC đổi biển số
    if (isChangingSlot || isChangingPlate) {
      const finalStatus = status !== undefined
        ? status
        : isChangingSlot
          ? (newSlotId ? (license_plate !== undefined && !license_plate ? 'PENDING' : 'BOOKED') : 'PENDING')
          : (existing.status as string)   // chỉ đổi biển: giữ nguyên trạng thái (ARRIVED/DONE…)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rpcRes, error: rpcErr } = await (supabase.rpc as any)('book_vehicle_slot', {
        p_vslot_id: id, p_new_slot_id: newSlotId, p_plate: newPlate,
        p_status: finalStatus, p_actor: user?.name || null,
      })
      if (rpcErr) return fail(res, rpcErr.message)
      if (rpcRes === 'FULL')           return fail(res, 'Slot đã hết chỗ', 409)
      if (rpcRes === 'SLOT_NOT_FOUND') return fail(res, 'Slot không tồn tại', 404)
      if (rpcRes === 'NOT_FOUND')      return fail(res, 'Không tìm thấy vehicle slot', 404)
    }

    // Validate gate_registration_id: cảnh báo nếu link sai thứ tự lần (nhưng vẫn cho phép)
    let sequenceWarning: string | null = null
    if (gate_registration_id !== undefined && gate_registration_id) {
      const { data: gateReg } = await supabase
        .from('gate_registrations')
        .select('id, license_plate, date, registration_number, warehouse_id')
        .eq('id', gate_registration_id)
        .single()

      if (gateReg) {
        const g = gateReg as { license_plate: string | null; date: string; registration_number: number; warehouse_id: string }
        if (g.license_plate) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: sameOrder } = await supabase.from('TmsOrder')
            .select('id').eq('id', existing.order_id).single()
          if (sameOrder) {
            const { count: gatesBefore } = await supabase
              .from('gate_registrations')
              .select('*', { count: 'exact', head: true })
              .eq('license_plate', g.license_plate)
              .eq('date', g.date)
              .eq('warehouse_id', g.warehouse_id)
              .lt('registration_number', g.registration_number)

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: samePlateSlotsData } = await supabase.from('TmsVehicleSlot')
              .select('id, order_id, gate_registration_id, created_at')
              .eq('license_plate', g.license_plate)
              .neq('id', id)
              .not('gate_registration_id', 'is', null)
              .order('created_at')

            const linkedBefore = ((samePlateSlotsData ?? []) as { gate_registration_id: string }[]).length
            const expectedGateIndex = linkedBefore
            if ((gatesBefore ?? 0) !== expectedGateIndex) {
              sequenceWarning = `Cảnh báo: Xe ${g.license_plate} đã có ${gatesBefore ?? 0} lần đăng ký trước đó — bạn đang link lần ${g.registration_number} vào slot không đúng thứ tự (nên là lần ${expectedGateIndex + 1})`
            }
          }
        }
      }
    }

    // Cập nhật các trường KHÔNG liên quan kế toán (slot_id/license_plate/status do RPC xử lý)
    const updates: Record<string, unknown> = { booked_by: user?.name || null, updated_at: now }
    if (driver_name          !== undefined) updates.driver_name          = driver_name || null
    if (driver_phone         !== undefined) updates.driver_phone         = driver_phone || null
    if (gate_registration_id !== undefined) updates.gate_registration_id = gate_registration_id || null
    // status chỉ set qua plain update khi RPC KHÔNG được gọi (không đổi slot/biển)
    if (status !== undefined && !(isChangingSlot || isChangingPlate)) updates.status = status

    // Consolidation: tạo group mới (lần đầu) hoặc thêm đơn vào group hiện có (BOOKED)
    let newGroupId: string | null = null
    const orderIds = Array.isArray(consolidation_order_ids) ? consolidation_order_ids as string[] : []
    if (orderIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: primaryOrder } = await supabase.from('TmsOrder')
        .select('direction, warehouse_type').eq('id', existing.order_id).single()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: secondaryOrders } = await supabase.from('TmsOrder')
        .select('direction, warehouse_type').in('id', orderIds)
      if (primaryOrder?.direction) {
        const hasWrongDir = (secondaryOrders ?? []).some(
          (o: { direction: string }) => o.direction !== primaryOrder.direction
        )
        if (hasWrongDir) {
          const dirLabel = primaryOrder.direction === 'OUTBOUND' ? 'Xuất' : 'Nhập'
          return fail(res, `Không thể gom đơn khác hướng: ${dirLabel} chỉ đi với ${dirLabel}`, 400)
        }
      }
      if (primaryOrder?.warehouse_type) {
        const hasWrongType = (secondaryOrders ?? []).some(
          (o: { warehouse_type: string | null }) => o.warehouse_type && o.warehouse_type !== primaryOrder.warehouse_type
        )
        if (hasWrongType) {
          return fail(res, `Không thể gom đơn khác loại kho: chỉ gom được các đơn cùng loại kho "${primaryOrder.warehouse_type}"`, 400)
        }
      }
      if (existing.status === 'PENDING') {
        newGroupId = randomUUID()
        updates.consolidation_group_id = newGroupId
        updates.is_consolidation_primary = true
      } else if (['BOOKED', 'ARRIVED'].includes(existing.status as string)) {
        newGroupId = (existing.consolidation_group_id as string | null) ?? randomUUID()
        if (!existing.consolidation_group_id) {
          updates.consolidation_group_id = newGroupId
          updates.is_consolidation_primary = true
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.from('TmsVehicleSlot')
      .update(updates).eq('id', id)
      .select('*, slot:DeliverySlot!slot_id(id, date, time_from, time_to, direction, cargo_type, max_vehicles, booked_count)')
      .single()
    if (error) return fail(res, error.message)

    // Áp cùng slot+plate cho xe chính của các đơn chạy chung (cùng biển → recount không tăng số chỗ)
    if (newGroupId && orderIds.length > 0) {
      const finalSlotId = newSlotId
      const finalPlate  = newPlate

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: candidateSlots } = await supabase.from('TmsVehicleSlot')
        .select('id, order_id, status, consolidation_group_id')
        .in('order_id', orderIds)
        .eq('status', 'PENDING')
        .is('consolidation_group_id', null)
        .order('created_at', { ascending: true })

      const seen = new Set<string>()
      const eligible = ((candidateSlots ?? []) as { id: string; order_id: string; status: string; consolidation_group_id: string | null }[])
        .filter(s => { if (seen.has(s.order_id)) return false; seen.add(s.order_id); return true })

      if (eligible.length > 0) {
        await Promise.all(eligible.map(s =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          supabase.from('TmsVehicleSlot').update({
            slot_id: finalSlotId, license_plate: finalPlate, status: 'BOOKED',
            consolidation_group_id: newGroupId, is_consolidation_primary: false, updated_at: now,
          }).eq('id', s.id)
        ))
        // Recount slot đích sau khi thêm các xe gom (cùng biển → số chỗ không đổi, nhưng đảm bảo cache đúng)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (finalSlotId) await (supabase.rpc as any)('recount_slot', { p_slot_id: finalSlotId })
      }
    }

    // Cascade + re-sort position khi slot hoặc biển số thay đổi
    const relinkPlate = newPlate as string | null
    const isChangingPlateForRelink = isChangingPlate

    if (isChangingSlot) {
      const newSlot = (data as { slot?: { time_from?: string; time_to?: string } | null }).slot
      await supabase
        .from('gate_registrations')
        .update({
          booking_slot_from: newSlot?.time_from ?? null,
          booking_slot_to:   newSlot?.time_to ?? null,
          updated_at: now,
        })
        .eq('tms_vehicle_slot_id', id)
    }

    if ((isChangingSlot || isChangingPlateForRelink) && relinkPlate) {
      await relinkGatesByPlate(relinkPlate, existing.order_id as string)
    }
    if (isChangingPlateForRelink && (existing.license_plate as string | null)) {
      await relinkGatesByPlate(existing.license_plate as string, existing.order_id as string)
    }

    const result = sequenceWarning ? { ...data, _warning: sequenceWarning } : data
    return ok(res, result)
  } catch (e) { return fail(res, String(e)) }
}

// PATCH /api/tms/vehicle-slots/:id/revoke — thu hồi booking, bỏ qua kiểm tra giờ (quyền đặc biệt)
export async function revokeVehicleSlot(req: Request, res: Response) {
  return releaseInternal(req, res, { skipTimeCheck: true })
}

// PATCH /api/tms/vehicle-slots/:id/release — trả lại: tách khỏi nhóm (nếu có), xoá slot+biển số+sdt
export async function releaseVehicleSlot(req: Request, res: Response) {
  return releaseInternal(req, res, { skipTimeCheck: false })
}

// Dùng chung cho release/revoke: nhả slot NGUYÊN TỬ qua book_vehicle_slot(new_slot=NULL),
// xử lý nhóm gom, xoá thông tin tài xế/cổng. revoke bỏ qua kiểm tra giờ.
async function releaseInternal(req: Request, res: Response, opts: { skipTimeCheck: boolean }) {
  try {
    const { id } = req.params
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = req.user
    const now = new Date().toISOString()
    if (!(await guardSlotWh(req, res, id))) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing, error: fetchErr } = await supabase.from('TmsVehicleSlot')
      .select('id, slot_id, status, order_id, license_plate, consolidation_group_id, is_consolidation_primary').eq('id', id).single()
    if (fetchErr) return fail(res, fetchErr.message)
    if (!existing) return fail(res, 'Không tìm thấy vehicle slot', 404)

    if (!opts.skipTimeCheck && existing.slot_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: oldSlot } = await supabase.from('DeliverySlot')
        .select('date, time_from').eq('id', existing.slot_id).single()
      if (oldSlot) {
        const slotStart = new Date(`${oldSlot.date}T${oldSlot.time_from}+07:00`).getTime()
        if (Date.now() >= slotStart) {
          return fail(res, 'Đã qua giờ, không thể trả lại khung giờ', 400)
        }
      }
    }

    // Nhả slot NGUYÊN TỬ (set slot_id=null, plate=null, status PENDING, recount slot cũ)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: rpcErr } = await (supabase.rpc as any)('book_vehicle_slot', {
      p_vslot_id: id, p_new_slot_id: null, p_plate: null, p_status: 'PENDING', p_actor: user?.name || null,
    })
    if (rpcErr) return fail(res, rpcErr.message)

    // Xử lý group consolidation: dòng này tách ra, các dòng còn lại giữ nguyên
    const groupId = existing.consolidation_group_id as string | null
    if (groupId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: mates } = await supabase.from('TmsVehicleSlot')
        .select('id, is_consolidation_primary')
        .eq('consolidation_group_id', groupId)
        .neq('id', id)
      const mateList = (mates ?? []) as { id: string; is_consolidation_primary: boolean }[]
      if (mateList.length === 1) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('TmsVehicleSlot').update({
          consolidation_group_id: null, is_consolidation_primary: false, updated_at: now,
        }).eq('id', mateList[0].id)
      } else if (mateList.length >= 2 && (existing.is_consolidation_primary as boolean)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('TmsVehicleSlot').update({
          is_consolidation_primary: true, updated_at: now,
        }).eq('id', mateList[0].id)
      }
    }

    // Xoá thông tin tài xế/cổng + cờ nhóm (slot/biển/status đã do RPC xử lý)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.from('TmsVehicleSlot')
      .update({
        driver_phone: null,
        consolidation_group_id: null, is_consolidation_primary: false,
        gate_export_status: null, gate_registered_at: null, gate_entry_at: null, gate_exit_at: null,
        updated_at: now,
      })
      .eq('id', id)
      .select('*, slot:DeliverySlot!slot_id(id, date, time_from, time_to, direction, cargo_type, max_vehicles, booked_count)')
      .single()
    if (error) return fail(res, error.message)
    const oldPlate = existing.license_plate as string | null
    if (oldPlate) await relinkGatesByPlate(oldPlate, existing.order_id as string)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// DELETE /api/tms/vehicle-slots/:id  — xoá xe phụ (PENDING hoặc BOOKED)
export async function deleteVehicleSlot(req: Request, res: Response) {
  try {
    const { id } = req.params
    const now = new Date().toISOString()
    if (!(await guardSlotWh(req, res, id))) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing, error: fetchErr } = await supabase.from('TmsVehicleSlot')
      .select('id, slot_id, status, order_id, license_plate, consolidation_group_id, is_consolidation_primary').eq('id', id).single()
    if (fetchErr) return fail(res, fetchErr.message)
    if (!existing) return fail(res, 'Không tìm thấy vehicle slot', 404)
    if (!['PENDING', 'BOOKED'].includes(existing.status as string)) return fail(res, 'Chỉ xoá được xe chưa thực hiện', 400)

    // Không cho xoá slot duy nhất của đơn
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: siblings } = await supabase.from('TmsVehicleSlot')
      .select('id').eq('order_id', existing.order_id)
    if ((siblings ?? []).length <= 1) return fail(res, 'Không thể xoá xe duy nhất của đơn hàng', 400)

    // Xử lý consolidation group
    const groupId = existing.consolidation_group_id as string | null
    if (groupId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: mates } = await supabase.from('TmsVehicleSlot')
        .select('id, is_consolidation_primary')
        .eq('consolidation_group_id', groupId)
        .neq('id', id)
      const mateList = (mates ?? []) as { id: string; is_consolidation_primary: boolean }[]
      if (mateList.length === 1) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('TmsVehicleSlot').update({
          consolidation_group_id: null, is_consolidation_primary: false, updated_at: now,
        }).eq('id', mateList[0].id)
      } else if (mateList.length >= 2 && (existing.is_consolidation_primary as boolean)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('TmsVehicleSlot').update({
          is_consolidation_primary: true, updated_at: now,
        }).eq('id', mateList[0].id)
      }
    }

    const oldSlotId = existing.slot_id as string | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('TmsVehicleSlot').delete().eq('id', id)
    if (error) return fail(res, error.message)

    // Tính lại cache booked_count cho slot cũ sau khi xoá dòng
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (oldSlotId) await (supabase.rpc as any)('recount_slot', { p_slot_id: oldSlotId })

    const deletedPlate = existing.license_plate as string | null
    if (deletedPlate) await relinkGatesByPlate(deletedPlate, existing.order_id as string)

    return ok(res, { id })
  } catch (e) { return fail(res, String(e)) }
}
