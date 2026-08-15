import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { qtyEntryDecimal, qtyIntegerError, type MatUnits } from '../../utils/qtyUnits'
import { requireBaseQty } from '../../utils/qtySemantics'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { fetchAllRowsParallel, fetchAllByIdChunks } from '../../utils/pagination'
import { isUuid } from '../../utils/ids'
import { categoryAllowed, CATEGORY_FORBIDDEN_MSG } from '../../utils/categoryScope'
import { deleteVehicleSlotsAndRecount } from '../../utils/bookingGuards'

// ─── Scope kho+loại (mirror TMS orderController) — KH nhập chuyển kho gắn 1 kho đích ──
// NATIONAL → null (toàn quyền). Khác → chỉ các kho được gán cho user.
function scopeWhIds(req: Request): string[] | null {
  return req.user?.warehouse_scope === 'NATIONAL' ? null : (req.user?.warehouse_ids ?? [])
}
function whInScope(req: Request, whId: string | null | undefined): boolean {
  const s = scopeWhIds(req)
  return s === null || (!!whId && s.includes(whId))
}
// Gác GHI theo (kho, loại): kho phải trong phạm vi + loại phải được phép. Trả false + đã gửi 403 nếu chặn.
function guardPlanWrite(req: Request, res: Response, whId: string | null | undefined, whType: string | null | undefined): boolean {
  if (!whInScope(req, whId)) { fail(res, 'Ngoài phạm vi kho được giao — không thể thao tác kế hoạch của kho này', 403); return false }
  if (!categoryAllowed(req, whType)) { fail(res, CATEGORY_FORBIDDEN_MSG, 403); return false }
  return true
}

const LINE_SELECT = `
  *,
  ncc:TransportCompany!ncc_id(id, code, name),
  material:Material!material_id(id, material_code, short_name, base_unit, entry_unit, units_per_carton),
  tms_order:TmsOrder!tms_order_id(id, order_code, status, planned_boxes, planned_pallets)
`

// ─── Helper: tìm hoặc tạo TmsOrder INBOUND cho nhóm ─────────────────────────
async function findOrCreateTmsOrder(
  group: { date: string; warehouse_id: string; warehouse_type: string | null; vehicle_type: string | null; ncc_id: string | null },
  user: { name?: string } | null | undefined,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = supabase.from('TmsOrder')
    .select('id')
    .eq('date', group.date)
    .eq('warehouse_id', group.warehouse_id)
    .eq('direction', 'INBOUND')

  if (group.warehouse_type) q = q.eq('warehouse_type', group.warehouse_type)
  else q = q.is('warehouse_type', null)

  if (group.vehicle_type) q = q.eq('vehicle_type', group.vehicle_type)
  else q = q.is('vehicle_type', null)

  if (group.ncc_id) q = q.eq('ncc_id', group.ncc_id)
  else q = q.is('ncc_id', null)

  const { data: existing } = await q.maybeSingle()
  if (existing) return existing.id

  // Tạo mới TmsOrder
  const now = new Date().toISOString()
  const orderId = randomUUID()

  let nccCode = 'NCC'
  if (group.ncc_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ncc } = await supabase.from('TransportCompany')
      .select('code').eq('id', group.ncc_id).single()
    if (ncc) nccCode = String(ncc.code).slice(0, 6).toUpperCase()
  }

  const datePart = group.date.replace(/-/g, '').slice(2) // YYMMDD
  const vtPart   = group.vehicle_type ? `_${group.vehicle_type.slice(0, 3)}` : ''
  // Thêm suffix ngẫu nhiên để tránh trùng khi tạo đồng thời
  const suffix   = randomUUID().slice(0, 4)
  const orderCode = `INB${datePart}_${nccCode}${vtPart}_${suffix}`

  // plan_group_key: khóa chống đua RIÊNG của luồng gộp KH nhập (khớp makeKey ở bulkCreatePlanLines).
  // Đua tạo cùng nhóm → 23505 trên uq_tms_order_plan_group → tìm lại lệnh người thắng (dưới).
  const groupKey = `${group.date.slice(0, 10)}||${group.warehouse_id}||${group.warehouse_type ?? ''}||${group.vehicle_type ?? ''}||${group.ncc_id ?? ''}`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insErr } = await supabase.from('TmsOrder').insert({
    id: orderId, order_code: orderCode,
    date: group.date, warehouse_id: group.warehouse_id,
    direction: 'INBOUND',
    warehouse_type: group.warehouse_type || null,
    vehicle_type:   group.vehicle_type   || null,
    ncc_id:         group.ncc_id         || null,
    plan_group_key: groupKey,
    planned_boxes: 0, planned_pallets: 0,
    status: 'PENDING',
    created_by: user?.name || null, updated_by: user?.name || null,
    created_at: now, updated_at: now,
  })
  if (insErr) {
    if (insErr.code !== '23505') throw new Error(insErr.message)
    // Thua đua: người khác vừa tạo lệnh cho đúng nhóm này → dùng lệnh của họ (gộp như thiết kế)
    await new Promise(r => setTimeout(r, 100 + Math.random() * 300))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: winner } = await supabase.from('TmsOrder')
      .select('id').eq('plan_group_key', groupKey).neq('status', 'CANCELLED').order('created_at').limit(1)
    const winnerId = (winner as { id: string }[] | null)?.[0]?.id
    if (!winnerId) throw new Error('Đụng độ khi tạo lệnh nhập — vui lòng thử lại')
    return winnerId
  }

  // Tạo 1 TmsVehicleSlot mặc định
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('TmsVehicleSlot').insert({
    id: randomUUID(), order_id: orderId,
    status: 'PENDING', created_at: now, updated_at: now,
  })

  return orderId
}

// ─── Helper: tính lại tổng TmsOrder từ plan lines (chỉ tính ACTIVE) ─────────
async function recalcTmsOrder(tmsOrderId: string): Promise<void> {
  // Chỉ đếm ACTIVE lines — CANCELLED lines không tính vào kế hoạch
  const { data: activeLines } = await supabase
    .from('inbound_plan_lines')
    .select('planned_boxes, planned_pallets, material:Material!material_id(base_unit, entry_unit, units_per_carton)')
    .eq('tms_order_id', tmsOrderId)
    .neq('status', 'CANCELLED')

  // BASE UNIT: line = base per mã → cache cấp LỆNH (cross-mã) = thùng quy đổi
  const totalBoxes   = (activeLines ?? []).reduce((s, l) => s + qtyEntryDecimal(((l as { planned_boxes: number | null }).planned_boxes ?? 0), ((l as { material?: MatUnits | null }).material ?? null)), 0)
  const totalPallets = (activeLines ?? []).reduce((s, l) => s + ((l as { planned_pallets: number | null }).planned_pallets ?? 0), 0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('TmsOrder').update({
    planned_boxes:   totalBoxes   || null,
    planned_pallets: totalPallets || null,
    updated_at: new Date().toISOString(),
  }).eq('id', tmsOrderId)

  // Nếu không còn ACTIVE lines → tự động hủy TmsOrder PENDING
  if ((activeLines ?? []).length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: order } = await supabase.from('TmsOrder')
      .select('status').eq('id', tmsOrderId).single()
    if (order?.status === 'PENDING') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase.from('TmsOrder')
        .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
        .eq('id', tmsOrderId)
    }
  }
}

// GET /api/wms/inbound-plan?date_from=&date_to=&warehouse_id=[&tms_order_id=]
// (cũng nhận date= để backward-compat với UploadDialog)
export async function listPlanLines(req: Request, res: Response) {
  try {
    const { date, date_from, date_to, warehouse_id, tms_order_id } = req.query as Record<string, string>
    const from = date_from ?? date
    const to   = date_to   ?? date
    if (!tms_order_id && (!from || !warehouse_id)) return fail(res, 'date_from và warehouse_id là bắt buộc', 400)
    // tms_order_id là cột uuid: giá trị rác → Postgres lỗi cast 22P02 → 500 thô (fuzz 26/07)
    if (tms_order_id && !isUuid(tms_order_id)) return fail(res, 'tms_order_id không hợp lệ', 400)
    // Scope: kho truyền vào ngoài phạm vi user → trả rỗng (không lộ kế hoạch kho khác)
    if (warehouse_id && !whInScope(req, warehouse_id)) return ok(res, [])

    // Phân trang né cap ~1000 (khoảng ngày rộng × nhiều NCC → KH nhập dễ vượt)
    const data = await fetchAllRowsParallel(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = supabase.from('inbound_plan_lines').select(LINE_SELECT)
      if (tms_order_id && !from) {
        q = q.eq('tms_order_id', tms_order_id)
      } else {
        q = q.gte('date', from).lte('date', to).eq('warehouse_id', warehouse_id)
        if (tms_order_id) q = q.eq('tms_order_id', tms_order_id)
      }
      return q.order('date').order('created_at').order('id')
    })
    // Cắt kho+loại đủ MỌI nhánh (kể cả nhánh chỉ có tms_order_id, không có warehouse_id param)
    const scoped = (data ?? []).filter((r) => {
      const row = r as { warehouse_id: string | null; warehouse_type: string | null }
      return whInScope(req, row.warehouse_id) && categoryAllowed(req, row.warehouse_type)
    })
    return ok(res, scoped)
  } catch (e) { return fail(res, String(e)) }
}

// POST /api/wms/inbound-plan  (single line)
export async function createPlanLine(req: Request, res: Response) {
  try {
    if (!requireBaseQty(req, res)) return   // BASE UNIT: chặn payload bundle cũ (thùng thập phân)
    const {
      date, warehouse_id, warehouse_type, vehicle_type,
      ncc_id, material_id, po_number, planned_boxes, planned_pallets,
    } = req.body
    if (!date || !warehouse_id) return fail(res, 'date và warehouse_id là bắt buộc', 400)
    if (planned_boxes != null && material_id) {
      const { data: m } = await supabase.from('Material').select('base_unit, entry_unit, units_per_carton').eq('id', material_id).maybeSingle()
      const ie = qtyIntegerError(Number(planned_boxes), (m ?? null) as MatUnits | null)
      if (ie) return fail(res, ie, 422)
    }
    if (!guardPlanWrite(req, res, warehouse_id, warehouse_type || null)) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = req.user
    const now  = new Date().toISOString()
    const id   = randomUUID()

    const tmsOrderId = await findOrCreateTmsOrder(
      { date, warehouse_id, warehouse_type: warehouse_type || null, vehicle_type: vehicle_type || null, ncc_id: ncc_id || null },
      user,
    )

    const { error } = await supabase.from('inbound_plan_lines').insert({
      id, date, warehouse_id,
      warehouse_type:  warehouse_type  || null,
      vehicle_type:    vehicle_type    || null,
      ncc_id:          ncc_id          || null,
      material_id:     material_id     || null,
      po_number:       po_number       || null,
      planned_boxes:   planned_boxes   ?? null,
      planned_pallets: planned_pallets ?? null,
      tms_order_id: tmsOrderId,
      created_by: user?.name || null, updated_by: user?.name || null,
      created_at: now, updated_at: now,
    })
    if (error) return fail(res, error.message)

    await recalcTmsOrder(tmsOrderId)

    const { data, error: fe } = await supabase
      .from('inbound_plan_lines').select(LINE_SELECT).eq('id', id).single()
    if (fe) return fail(res, fe.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

// POST /api/wms/inbound-plan/bulk
export async function bulkCreatePlanLines(req: Request, res: Response) {
  try {
    const { lines } = req.body as { lines: Record<string, unknown>[] }
    if (!Array.isArray(lines) || !lines.length) return fail(res, 'lines phải là array không rỗng', 400)

    // BASE UNIT: chốt planned_boxes SỐ NGUYÊN cho mã có entry (upload không lọt thùng lẻ → base lẻ).
    // Nạp units theo lô (chunk 300, né cap URL) rồi validate từng dòng, báo lỗi kèm số dòng.
    const matIds = [...new Set(lines.map(l => l.material_id).filter(Boolean) as string[])]
    if (matIds.length) {
      const matMap = new Map<string, MatUnits>()
      for (let i = 0; i < matIds.length; i += 300) {
        const { data } = await supabase.from('Material')
          .select('id, base_unit, entry_unit, units_per_carton').in('id', matIds.slice(i, i + 300))
        for (const m of (data ?? []) as (MatUnits & { id: string })[]) matMap.set(m.id, m)
      }
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]
        if (l.planned_boxes != null && l.material_id) {
          const ie = qtyIntegerError(Number(l.planned_boxes), matMap.get(String(l.material_id)) ?? null)
          if (ie) return fail(res, `Dòng ${i + 1}: ${ie}`, 422)
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = req.user
    const now  = new Date().toISOString()

    // Thu thập các nhóm unique → find/create TmsOrder
    type GroupKey = string
    const groupMap = new Map<GroupKey, string>() // key → tmsOrderId

    const dOf = (v: unknown) => String(v ?? '').slice(0, 10)   // date chuẩn hóa YYYY-MM-DD
    const makeKey = (date: string, wh: string, whType: string | null, vt: string | null, ncc: string | null) =>
      `${dOf(date)}||${wh}||${whType ?? ''}||${vt ?? ''}||${ncc ?? ''}`

    // Xác định TmsOrder cho từng nhóm trước
    const uniqueGroups = new Map<GroupKey, { date: string; warehouse_id: string; warehouse_type: string | null; vehicle_type: string | null; ncc_id: string | null }>()
    for (const line of lines) {
      const key = makeKey(
        String(line.date ?? ''), String(line.warehouse_id ?? ''),
        (line.warehouse_type as string | null) ?? null,
        (line.vehicle_type  as string | null) ?? null,
        (line.ncc_id        as string | null) ?? null,
      )
      if (!uniqueGroups.has(key)) {
        uniqueGroups.set(key, {
          date:          String(line.date ?? ''),
          warehouse_id:  String(line.warehouse_id ?? ''),
          warehouse_type: (line.warehouse_type as string | null) ?? null,
          vehicle_type:   (line.vehicle_type  as string | null) ?? null,
          ncc_id:         (line.ncc_id        as string | null) ?? null,
        })
      }
    }

    // Scope: chặn nếu BẤT KỲ nhóm nào ngoài phạm vi kho/loại (all-or-nothing — chưa tạo TmsOrder nào)
    for (const g of uniqueGroups.values()) {
      if (!guardPlanWrite(req, res, g.warehouse_id, g.warehouse_type)) return
    }

    // BATCH tìm/tạo lệnh — file thật 8.6k dòng có ~3.7k nhóm (Ngày×Kho×NCC×Loại xe); gọi
    // findOrCreateTmsOrder TUẦN TỰ từng nhóm = ~7.400 roundtrip nối tiếp → quá maxDuration 60s
    // Vercel (user dính 25/07: "hết timeout mà dữ liệu chưa đẩy vào xong"). Thay bằng:
    // fetch lệnh INBOUND theo (date, warehouse) 1 lượt → khớp key trong JS → INSERT LÔ nhóm thiếu.
    {
      const gList  = [...uniqueGroups.values()]
      const gDates = [...new Set(gList.map(g => dOf(g.date)))]
      const gWhs   = [...new Set(gList.map(g => g.warehouse_id))]
      type ExOrder = { id: string; date: string; warehouse_id: string; warehouse_type: string | null; vehicle_type: string | null; ncc_id: string | null }
      const fetchGroupOrders = async () => {
        const exOrders: ExOrder[] = []
        for (let i = 0; i < gDates.length; i += 100) {
          exOrders.push(...(await fetchAllRowsParallel(() => supabase.from('TmsOrder')
            .select('id, date, warehouse_id, warehouse_type, vehicle_type, ncc_id')
            .eq('direction', 'INBOUND').neq('status', 'CANCELLED')   // khớp phạm vi unique index; không gắn KH vào lệnh đã hủy
            .in('date', gDates.slice(i, i + 100)).in('warehouse_id', gWhs)
            .order('id'))) as ExOrder[])
        }
        for (const o of exOrders) {
          const k = makeKey(o.date, o.warehouse_id, o.warehouse_type ?? null, o.vehicle_type ?? null, o.ncc_id ?? null)
          if (!groupMap.has(k)) groupMap.set(k, o.id)
        }
      }
      await fetchGroupOrders()

      // Mã NCC cho order_code — nạp 1 lượt cho MỌI nhóm (dùng lại được qua các vòng retry)
      const nccIds = [...new Set(gList.map(g => g.ncc_id).filter(Boolean))] as string[]
      const nccCodeById = new Map<string, string>()
      for (let i = 0; i < nccIds.length; i += 300) {
        const { data } = await supabase.from('TransportCompany').select('id, code').in('id', nccIds.slice(i, i + 300))
        for (const c of (data ?? []) as { id: string; code: string | null }[])
          nccCodeById.set(c.id, String(c.code ?? 'NCC').slice(0, 6).toUpperCase())
      }

      // INSERT LÔ nhóm thiếu — đua đa-user: unique index uq_tms_order_plan_group (trên cột plan_group_key,
      // CHỈ luồng upload KH nhập set) bắn 23505 khi 2 người cùng tạo 1 nhóm → jitter + re-fetch nhặt lệnh
      // người kia, thử lại (chuẩn concurrency-hardening). Lệnh tạo TAY / KH vận chuyển để key NULL nên
      // KHÔNG bị chặn oan — 1 NCC giao 2 xe cùng ngày/loại xe là hợp lệ (hồi quy đã sửa 26/07).
      const slotsToInsert: Record<string, unknown>[] = []
      for (let attempt = 0; attempt < 3; attempt++) {
        const missing = [...uniqueGroups.entries()].filter(([k]) => !groupMap.has(k))
        if (!missing.length) break
        if (attempt > 0) await new Promise(r => setTimeout(r, 100 + Math.random() * 300))
        const pending: { key: string; order: Record<string, unknown>; slot: Record<string, unknown> }[] = missing.map(([k, g]) => {
          const orderId  = randomUUID()
          const datePart = dOf(g.date).replace(/-/g, '').slice(2)   // YYMMDD
          const vtPart   = g.vehicle_type ? `_${g.vehicle_type.slice(0, 3)}` : ''
          const orderCode = `INB${datePart}_${g.ncc_id ? (nccCodeById.get(g.ncc_id) ?? 'NCC') : 'NCC'}${vtPart}_${randomUUID().slice(0, 4)}`
          return {
            key: k,
            order: {
              id: orderId, order_code: orderCode,
              date: g.date, warehouse_id: g.warehouse_id, direction: 'INBOUND',
              warehouse_type: g.warehouse_type || null, vehicle_type: g.vehicle_type || null, ncc_id: g.ncc_id || null,
              plan_group_key: k,   // khóa chống đua CHỈ của luồng gộp KH nhập (unique khi status≠CANCELLED)
              planned_boxes: 0, planned_pallets: 0, status: 'PENDING',
              created_by: user?.name || null, updated_by: user?.name || null, created_at: now, updated_at: now,
            },
            slot: { id: randomUUID(), order_id: orderId, status: 'PENDING', created_at: now, updated_at: now },
          }
        })
        let hadConflict = false
        for (let i = 0; i < pending.length; i += 500) {
          const chunk = pending.slice(i, i + 500)
          const { error } = await supabase.from('TmsOrder').insert(chunk.map(p => p.order))
          if (!error) {
            for (const p of chunk) { groupMap.set(p.key, String(p.order.id)); slotsToInsert.push(p.slot) }
          } else if (error.code === '23505') {
            hadConflict = true   // nhóm trong chunk này để vòng sau re-fetch/tạo lại
          } else return fail(res, error.message)
        }
        if (hadConflict) await fetchGroupOrders()
      }
      const unresolved = [...uniqueGroups.keys()].filter(k => !groupMap.has(k))
      if (unresolved.length) return fail(res, 'Đụng độ khi tạo lệnh (nhiều người cùng upload) — vui lòng bấm upload lại', 409)
      for (let i = 0; i < slotsToInsert.length; i += 500) {
        const { error } = await supabase.from('TmsVehicleSlot').insert(slotsToInsert.slice(i, i + 500))
        if (error) return fail(res, error.message)
      }
    }

    // UPSERT theo KEY = (Ngày + Kho + NCC + Mã hàng) — user chốt 25/07: trùng key → UPDATE số lượng,
    // key mới → INSERT. Chống double khi upload lại cùng file. Key KHÔNG gồm PO/Loại xe:
    // trùng key trong file → tự GỘP SL (như "Nạp từ KH" gộp per mã); PO gộp các giá trị khác nhau.
    const poOf = (v: unknown) => String(v ?? '').trim()
    const rows = lines.map(line => {
      const key = makeKey(
        String(line.date ?? ''), String(line.warehouse_id ?? ''),
        (line.warehouse_type as string | null) ?? null,
        (line.vehicle_type  as string | null) ?? null,
        (line.ncc_id        as string | null) ?? null,
      )
      return {
        id: randomUUID(),
        date:            String(line.date ?? ''),
        warehouse_id:    String(line.warehouse_id ?? ''),
        warehouse_type:  (line.warehouse_type  as string | null) ?? null,
        vehicle_type:    (line.vehicle_type    as string | null) ?? null,
        ncc_id:          (line.ncc_id          as string | null) ?? null,
        material_id:     (line.material_id     as string | null) ?? null,
        po_number:       poOf(line.po_number) || null,
        planned_boxes:   (line.planned_boxes   as number | null) ?? null,
        planned_pallets: (line.planned_pallets as number | null) ?? null,
        tms_order_id:    groupMap.get(key) ?? null,
        created_by: user?.name || null, updated_by: user?.name || null,
        created_at: now, updated_at: now,
      }
    })

    const ukeyOf = (r: { date: string; warehouse_id: string; ncc_id: string | null; material_id: string | null }) =>
      `${dOf(r.date)}||${r.warehouse_id}||${r.ncc_id ?? ''}||${r.material_id ?? ''}`
    const warnings: string[] = []

    // 1) Gộp trùng key NGAY TRONG FILE (cộng SL; PO nối các giá trị khác nhau)
    const mergedMap = new Map<string, typeof rows[number]>()
    const noKey: typeof rows = []   // dòng thiếu mã → giữ nguyên (không upsert được)
    for (const r of rows) {
      if (!r.material_id) { noKey.push(r); continue }
      const k = ukeyOf(r)
      const prev = mergedMap.get(k)
      if (!prev) { mergedMap.set(k, r); continue }
      prev.planned_boxes   = (prev.planned_boxes   ?? 0) + (r.planned_boxes   ?? 0) || null
      prev.planned_pallets = (prev.planned_pallets ?? 0) + (r.planned_pallets ?? 0) || null
      if (r.po_number && r.po_number !== prev.po_number)
        prev.po_number = prev.po_number ? `${prev.po_number}, ${r.po_number}` : r.po_number
      warnings.push(`Gộp dòng trùng key trong file (Ngày ${dOf(r.date)} · mã ${r.material_id})`)
    }
    const merged = [...mergedMap.values(), ...noKey]

    // 2) Nạp dòng KH ĐANG CÓ khớp (Ngày, Kho) trong file → so key đủ 4 thành phần ở JS
    //    (khớp CROSS-lệnh: key không gồm Loại xe nên dòng cũ nằm ở lệnh khác loại xe vẫn được update)
    //    PHÂN TRANG bắt buộc — 1 ngày×kho có thể >1000 dòng KH, cắt cụt = dedup hỏng → double.
    //    select('*') để UPDATE bằng upsert FULL RECORD (merge JS — upsert thiếu cột NOT NULL sẽ 23502:
    //    Postgres kiểm NOT NULL trên tuple insert TRƯỚC khi xét conflict).
    type ExLine = { id: string; tms_order_id: string | null; date: string; warehouse_id: string; ncc_id: string | null; material_id: string | null; created_at: string } & Record<string, unknown>
    const fDates = [...new Set(merged.map(r => dOf(r.date)))]
    const fWhs   = [...new Set(merged.map(r => r.warehouse_id))]
    const existing: ExLine[] = []
    for (let i = 0; i < fDates.length; i += 100) {
      existing.push(...(await fetchAllRowsParallel(() => supabase.from('inbound_plan_lines')
        .select('*')
        .in('date', fDates.slice(i, i + 100)).in('warehouse_id', fWhs).neq('status', 'CANCELLED')
        .order('id'))) as ExLine[])
    }
    const exByKey = new Map<string, ExLine[]>()
    for (const e of existing) {
      if (!e.material_id) continue
      const arr = exByKey.get(ukeyOf(e)) ?? []
      arr.push(e); exByKey.set(ukeyOf(e), arr)
    }

    // 3) Chia UPDATE (key trùng → dòng CŨ NHẤT; sẵn nhiều dòng trùng = double cũ → cảnh báo dọn) / INSERT
    const toInsert: typeof rows = []
    const toUpdate: { row: ExLine; planned_boxes: number | null; planned_pallets: number | null; po_number: string | null }[] = []
    for (const r of merged) {
      const matches = r.material_id ? (exByKey.get(ukeyOf(r)) ?? []).sort((a, b) => a.created_at < b.created_at ? -1 : 1) : []
      if (matches.length) {
        toUpdate.push({ row: matches[0], planned_boxes: r.planned_boxes, planned_pallets: r.planned_pallets, po_number: r.po_number })
        if (matches.length > 1) warnings.push(`Key (Ngày ${dOf(r.date)} · mã ${r.material_id}) đang có ${matches.length} dòng KH trùng sẵn — chỉ cập nhật dòng cũ nhất, nên dọn dòng thừa`)
      } else toInsert.push(r)
    }

    // UPDATE theo LÔ upsert(onConflict id) 500 FULL RECORD (đắp field mới lên row cũ trong JS —
    // mẫu materialController; re-upload 8.6k dòng mà update lẻ từng dòng = hàng nghìn roundtrip)
    for (let i = 0; i < toUpdate.length; i += 500) {
      const payload = toUpdate.slice(i, i + 500).map(u => ({
        ...u.row,
        planned_boxes: u.planned_boxes, planned_pallets: u.planned_pallets,
        ...(u.po_number ? { po_number: u.po_number } : {}),
        updated_by: user?.name || null, updated_at: now,
      }))
      const { error } = await supabase.from('inbound_plan_lines').upsert(payload, { onConflict: 'id' })
      if (error) return fail(res, error.message)
    }
    // INSERT theo LÔ 500 — file KH vài nghìn dòng insert 1 phát dễ quá payload/timeout serverless.
    // Đua đa-user: unique index uq_inbound_plan_line_active_key bắn 23505 khi người khác vừa chèn
    // cùng key → fallback từng dòng: dòng đụng thì UPDATE đè lên dòng thắng cuộc (last-write-wins).
    let raceUpdated = 0
    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500)
      const { error } = await supabase.from('inbound_plan_lines').insert(chunk)
      if (!error) continue
      if (error.code !== '23505') return fail(res, error.message)
      for (const r of chunk) {
        const { error: e1 } = await supabase.from('inbound_plan_lines').insert(r)
        if (!e1) continue
        if (e1.code !== '23505') return fail(res, e1.message)
        let wq = supabase.from('inbound_plan_lines').select('id')
          .eq('date', dOf(r.date)).eq('warehouse_id', r.warehouse_id)
          .eq('material_id', r.material_id as string).neq('status', 'CANCELLED')
        wq = r.ncc_id ? wq.eq('ncc_id', r.ncc_id) : wq.is('ncc_id', null)
        const { data: winner } = await wq.limit(1).maybeSingle()
        if (!winner) return fail(res, 'Đụng độ khi ghi kế hoạch — vui lòng bấm upload lại', 409)
        const { error: e2 } = await supabase.from('inbound_plan_lines')
          .update({ planned_boxes: r.planned_boxes, planned_pallets: r.planned_pallets, ...(r.po_number ? { po_number: r.po_number } : {}), updated_by: user?.name || null, updated_at: now })
          .eq('id', winner.id)
        if (e2) return fail(res, e2.message)
        raceUpdated++
      }
    }

    // Recalc theo LÔ (thay recalcTmsOrder per-order: 3.7k lệnh × 2-4 roundtrip vừa chậm vừa dội DB):
    // fetch dòng ACTIVE của mọi lệnh ảnh hưởng → tính tổng trong JS → upsert lô cache lệnh.
    // Lệnh 0 dòng ACTIVE (vd lệnh mới tạo mà mọi dòng thành update ở lệnh cũ) → hủy nếu PENDING.
    const affectedOrderIds = [...new Set([
      ...groupMap.values(), ...toInsert.map(r => r.tms_order_id), ...toUpdate.map(u => u.row.tms_order_id),
    ].filter(Boolean))] as string[]
    type RLine = { tms_order_id: string; planned_boxes: number | null; planned_pallets: number | null; material?: MatUnits | null }
    const rLines = await fetchAllByIdChunks(affectedOrderIds, chunk => supabase.from('inbound_plan_lines')
      .select('tms_order_id, planned_boxes, planned_pallets, material:Material!material_id(base_unit, entry_unit, units_per_carton)')
      .in('tms_order_id', chunk).neq('status', 'CANCELLED').order('id')) as RLine[]
    const sums = new Map<string, { boxes: number; pallets: number }>()
    for (const l of rLines) {
      const s = sums.get(l.tms_order_id) ?? { boxes: 0, pallets: 0 }
      s.boxes   += qtyEntryDecimal(l.planned_boxes ?? 0, l.material ?? null)   // thùng quy đổi per-mã
      s.pallets += l.planned_pallets ?? 0
      sums.set(l.tms_order_id, s)
    }
    // Upsert cache lệnh = FULL RECORD (đắp tổng mới lên row cũ — upsert thiếu cột NOT NULL sẽ 23502)
    const fullOrders = await fetchAllByIdChunks(affectedOrderIds, chunk => supabase.from('TmsOrder')
      .select('*').in('id', chunk).order('id')) as ({ id: string } & Record<string, unknown>)[]
    const orderPatch = fullOrders.map(o => {
      const s = sums.get(o.id)
      return { ...o, planned_boxes: s?.boxes || null, planned_pallets: s?.pallets || null, updated_at: now }
    })
    for (let i = 0; i < orderPatch.length; i += 500) {
      const { error } = await supabase.from('TmsOrder').upsert(orderPatch.slice(i, i + 500), { onConflict: 'id' })
      if (error) return fail(res, error.message)
    }
    const emptyIds = affectedOrderIds.filter(id => !sums.has(id))
    for (let i = 0; i < emptyIds.length; i += 300) {
      await supabase.from('TmsOrder').update({ status: 'CANCELLED', updated_at: now })
        .in('id', emptyIds.slice(i, i + 300)).eq('status', 'PENDING')
    }

    return ok(res, { inserted: toInsert.length - raceUpdated, updated: toUpdate.length + raceUpdated, warnings }, 201)
  } catch (e) { return fail(res, String(e)) }
}

// PATCH /api/wms/inbound-plan/:id
export async function updatePlanLine(req: Request, res: Response) {
  try {
    const { id } = req.params
    const {
      material_id, po_number, planned_boxes, planned_pallets,
      date, warehouse_type, vehicle_type, ncc_id,
    } = req.body
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = req.user
    const now  = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await supabase.from('inbound_plan_lines')
      .select('id, date, warehouse_id, warehouse_type, vehicle_type, ncc_id, tms_order_id')
      .eq('id', id).single()
    if (!existing) return fail(res, 'Không tìm thấy dòng kế hoạch', 404)
    // Scope: chỉ sửa dòng thuộc kho+loại trong phạm vi user
    if (!guardPlanWrite(req, res, existing.warehouse_id, existing.warehouse_type)) return

    const updates: Record<string, unknown> = { updated_by: user?.name || null, updated_at: now }
    if (material_id     !== undefined) updates.material_id     = material_id     || null
    if (po_number       !== undefined) updates.po_number       = po_number       || null
    if (planned_boxes   !== undefined) updates.planned_boxes   = planned_boxes   ?? null
    if (planned_pallets !== undefined) updates.planned_pallets = planned_pallets ?? null

    // Grouping fields — chỉ cho phép khi TmsOrder còn PENDING
    const groupingChanged = date !== undefined || warehouse_type !== undefined ||
                            vehicle_type !== undefined || ncc_id !== undefined
    let newTmsOrderId = existing.tms_order_id

    if (groupingChanged) {
      if (existing.tms_order_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: order } = await supabase.from('TmsOrder')
          .select('status').eq('id', existing.tms_order_id).single()
        if (order && order.status !== 'PENDING') {
          return fail(res, 'Lệnh TMS đã được xử lý, không thể sửa nhóm vận chuyển', 400)
        }
      }

      const newGroup = {
        date:           date           ?? existing.date,
        warehouse_id:   existing.warehouse_id,
        warehouse_type: warehouse_type !== undefined ? (warehouse_type || null) : existing.warehouse_type,
        vehicle_type:   vehicle_type   !== undefined ? (vehicle_type   || null) : existing.vehicle_type,
        ncc_id:         ncc_id         !== undefined ? (ncc_id         || null) : existing.ncc_id,
      }
      // Scope: loại mới (nếu đổi warehouse_type) cũng phải trong phạm vi user
      if (!categoryAllowed(req, newGroup.warehouse_type)) return fail(res, CATEGORY_FORBIDDEN_MSG, 403)

      newTmsOrderId = await findOrCreateTmsOrder(newGroup, user)

      updates.tms_order_id   = newTmsOrderId
      if (date           !== undefined) updates.date           = date
      if (warehouse_type !== undefined) updates.warehouse_type = warehouse_type || null
      if (vehicle_type   !== undefined) updates.vehicle_type   = vehicle_type   || null
      if (ncc_id         !== undefined) updates.ncc_id         = ncc_id         || null
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('inbound_plan_lines').update(updates).eq('id', id)
    if (error) return fail(res, error.message)

    // Recalc cả 2 TmsOrder nếu có thay đổi nhóm
    if (existing.tms_order_id && existing.tms_order_id !== newTmsOrderId) {
      await recalcTmsOrder(existing.tms_order_id)
    }
    if (newTmsOrderId) await recalcTmsOrder(newTmsOrderId)

    const { data, error: fe } = await supabase
      .from('inbound_plan_lines').select(LINE_SELECT).eq('id', id).single()
    if (fe) return fail(res, fe.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// DELETE /api/wms/inbound-plan/:id  — chỉ dùng khi nhập nhầm, TmsOrder phải PENDING
export async function deletePlanLine(req: Request, res: Response) {
  try {
    const { id } = req.params

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await supabase.from('inbound_plan_lines')
      .select('id, tms_order_id, warehouse_id, warehouse_type').eq('id', id).single()
    if (!existing) return fail(res, 'Không tìm thấy dòng kế hoạch', 404)
    // Scope: chỉ xóa dòng thuộc kho+loại trong phạm vi user
    if (!guardPlanWrite(req, res, existing.warehouse_id, existing.warehouse_type)) return

    // Chặn xóa nếu TmsOrder đã được xử lý (chỉ cho phép khi còn PENDING)
    if (existing.tms_order_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: order } = await supabase.from('TmsOrder')
        .select('status').eq('id', existing.tms_order_id).single()
      if (order && order.status !== 'PENDING' && order.status !== 'CANCELLED') {
        return fail(res, 'Kế hoạch đã được xử lý — dùng "Hủy kế hoạch" thay vì Xóa', 400)
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('inbound_plan_lines').delete().eq('id', id)
    if (error) return fail(res, error.message)

    if (existing.tms_order_id) {
      await recalcTmsOrder(existing.tms_order_id)

      // Nếu TmsOrder không còn line nào (kể cả cancelled) → xóa hẳn (nhập nhầm, dọn sạch)
      const { count } = await supabase
        .from('inbound_plan_lines')
        .select('*', { count: 'exact', head: true })
        .eq('tms_order_id', existing.tms_order_id)

      if (!count) {
        // Dòng xe có thể ĐANG GIỮ khung giờ — xoá mà không đếm lại thì khung kẹt "Đầy" vĩnh viễn
        // (DB không có trigger; recount_slot chỉ chạy khi code gọi tay). Xem bookingGuards.
        await deleteVehicleSlotsAndRecount([existing.tms_order_id])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('TmsOrder').delete().eq('id', existing.tms_order_id)
      }
    }

    return ok(res, { id })
  } catch (e) { return fail(res, String(e)) }
}

// PATCH /api/wms/inbound-plan/:id/cancel  — soft cancel, giữ lịch sử báo cáo
export async function cancelPlanLine(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { cancel_reason } = req.body
    if (!cancel_reason?.trim()) return fail(res, 'Lý do hủy là bắt buộc', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = req.user
    const now  = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await supabase.from('inbound_plan_lines')
      .select('id, status, tms_order_id, warehouse_id, warehouse_type').eq('id', id).single()
    if (!existing) return fail(res, 'Không tìm thấy dòng kế hoạch', 404)
    // Scope: chỉ hủy dòng thuộc kho+loại trong phạm vi user
    if (!guardPlanWrite(req, res, existing.warehouse_id, existing.warehouse_type)) return
    if (existing.status === 'CANCELLED') return fail(res, 'Dòng kế hoạch đã được hủy rồi', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('inbound_plan_lines').update({
      status: 'CANCELLED',
      cancel_reason: cancel_reason.trim(),
      updated_by: user?.name || null,
      updated_at: now,
    }).eq('id', id)
    if (error) return fail(res, error.message)

    // Recalc TmsOrder (loại line vừa hủy khỏi tổng); nếu 0 ACTIVE lines → TmsOrder CANCELLED
    if (existing.tms_order_id) await recalcTmsOrder(existing.tms_order_id)

    const { data, error: fe } = await supabase
      .from('inbound_plan_lines').select(LINE_SELECT).eq('id', id).single()
    if (fe) return fail(res, fe.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// POST /api/wms/inbound-plan/bulk-for-order
// Tạo plan lines trực tiếp cho 1 TmsOrder đã có (upload từ booking detail)
export async function bulkCreateForOrder(req: Request, res: Response) {
  try {
    const { tms_order_id, lines } = req.body as {
      tms_order_id: string
      lines: { material_id: string; planned_boxes: number; planned_pallets?: number }[]
    }
    if (!tms_order_id) return fail(res, 'tms_order_id là bắt buộc', 400)
    if (!Array.isArray(lines) || !lines.length) return fail(res, 'lines phải là array không rỗng', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tmsOrder, error: orderErr } = await supabase.from('TmsOrder')
      .select('id, date, warehouse_id, warehouse_type, vehicle_type, ncc_id, direction')
      .eq('id', tms_order_id)
      .single()
    if (orderErr || !tmsOrder) return fail(res, 'Không tìm thấy TmsOrder', 404)
    if (tmsOrder.direction !== 'INBOUND') return fail(res, 'Chỉ tạo kế hoạch cho đơn hàng hướng nhập (INBOUND)', 400)
    if (!guardPlanWrite(req, res, tmsOrder.warehouse_id, tmsOrder.warehouse_type)) return

    // BASE UNIT: planned_boxes = BASE — chốt SỐ NGUYÊN cho mã có entry (mirror bulkCreatePlanLines)
    const matIds = [...new Set(lines.map(l => l.material_id).filter(Boolean))]
    if (matIds.length) {
      const matMap = new Map<string, MatUnits>()
      for (let i = 0; i < matIds.length; i += 300) {
        const { data } = await supabase.from('Material')
          .select('id, base_unit, entry_unit, units_per_carton').in('id', matIds.slice(i, i + 300))
        for (const m of (data ?? []) as (MatUnits & { id: string })[]) matMap.set(m.id, m)
      }
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]
        if (l.planned_boxes != null && l.material_id) {
          const ie = qtyIntegerError(Number(l.planned_boxes), matMap.get(String(l.material_id)) ?? null)
          if (ie) return fail(res, `Dòng ${i + 1}: ${ie}`, 422)
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = req.user
    const now = new Date().toISOString()

    // UPSERT theo KEY = Mã hàng trong lệnh (Ngày/Kho/NCC nằm trên lệnh — khớp key Ngày+Kho+NCC+Mã
    // user chốt 25/07): trùng mã trong file → GỘP SL; mã đã có dòng KH → UPDATE dòng cũ nhất; mới → INSERT.
    const mergedByMat = new Map<string, { material_id: string; planned_boxes: number; planned_pallets: number | null }>()
    const warnings: string[] = []
    for (const l of lines) {
      if (!l.material_id || !((l.planned_boxes ?? 0) > 0)) continue
      const prev = mergedByMat.get(l.material_id)
      if (!prev) { mergedByMat.set(l.material_id, { material_id: l.material_id, planned_boxes: l.planned_boxes, planned_pallets: l.planned_pallets ?? null }); continue }
      prev.planned_boxes += l.planned_boxes
      if (l.planned_pallets != null) prev.planned_pallets = (prev.planned_pallets ?? 0) + l.planned_pallets
      warnings.push(`Gộp dòng trùng mã trong file (mã hàng id ${l.material_id})`)
    }
    if (!mergedByMat.size) return fail(res, 'Không có dòng hợp lệ (material_id + planned_boxes > 0)', 400)

    // Dòng KH đang có của lệnh → map theo mã (sẵn nhiều dòng trùng mã = double cũ → cập nhật dòng cũ nhất)
    type ExLine = { id: string; material_id: string | null; created_at: string }
    const { data: exLines } = await supabase.from('inbound_plan_lines')
      .select('id, material_id, created_at')
      .eq('tms_order_id', tms_order_id).neq('status', 'CANCELLED')
    const exByMat = new Map<string, ExLine[]>()
    for (const e of (exLines ?? []) as ExLine[]) {
      if (!e.material_id) continue
      const arr = exByMat.get(e.material_id) ?? []
      arr.push(e); exByMat.set(e.material_id, arr)
    }

    const toInsert: Record<string, unknown>[] = []
    const toUpdate: { id: string; planned_boxes: number; planned_pallets: number | null }[] = []
    for (const m of mergedByMat.values()) {
      const matches = (exByMat.get(m.material_id) ?? []).sort((a, b) => a.created_at < b.created_at ? -1 : 1)
      if (matches.length) {
        toUpdate.push({ id: matches[0].id, planned_boxes: m.planned_boxes, planned_pallets: m.planned_pallets })
        if (matches.length > 1) warnings.push(`Mã hàng id ${m.material_id} đang có ${matches.length} dòng KH trong lệnh — chỉ cập nhật dòng cũ nhất, nên dọn dòng thừa`)
      } else {
        toInsert.push({
          id: randomUUID(),
          tms_order_id,
          date: tmsOrder.date,
          warehouse_id: tmsOrder.warehouse_id,
          warehouse_type: tmsOrder.warehouse_type ?? null,
          vehicle_type: tmsOrder.vehicle_type ?? null,
          ncc_id: tmsOrder.ncc_id ?? null,
          material_id: m.material_id,
          planned_boxes: m.planned_boxes,
          planned_pallets: m.planned_pallets,
          status: 'ACTIVE',
          created_by: user?.name ?? null,
          updated_by: user?.name ?? null,
          created_at: now,
          updated_at: now,
        })
      }
    }

    for (const u of toUpdate) {
      const { error: updErr } = await supabase.from('inbound_plan_lines')
        .update({ planned_boxes: u.planned_boxes, planned_pallets: u.planned_pallets, updated_by: user?.name ?? null, updated_at: now })
        .eq('id', u.id)
      if (updErr) return fail(res, updErr.message)
    }
    if (toInsert.length) {
      const { error: insErr } = await supabase.from('inbound_plan_lines').insert(toInsert)
      if (insErr && insErr.code !== '23505') return fail(res, insErr.message)
      if (insErr) {
        // Đua: người khác vừa chèn cùng key (unique index) → từng dòng, đụng thì UPDATE đè
        for (const r of toInsert as { date: string; warehouse_id: string; ncc_id: string | null; material_id: string; planned_boxes: number; planned_pallets: number | null }[]) {
          const { error: e1 } = await supabase.from('inbound_plan_lines').insert(r)
          if (!e1) continue
          if (e1.code !== '23505') return fail(res, e1.message)
          let wq = supabase.from('inbound_plan_lines').select('id')
            .eq('date', r.date).eq('warehouse_id', r.warehouse_id)
            .eq('material_id', r.material_id).neq('status', 'CANCELLED')
          wq = r.ncc_id ? wq.eq('ncc_id', r.ncc_id) : wq.is('ncc_id', null)
          const { data: winner } = await wq.limit(1).maybeSingle()
          if (!winner) return fail(res, 'Đụng độ khi ghi kế hoạch — vui lòng thử lại', 409)
          const { error: e2 } = await supabase.from('inbound_plan_lines')
            .update({ planned_boxes: r.planned_boxes, planned_pallets: r.planned_pallets, updated_by: user?.name ?? null, updated_at: now })
            .eq('id', winner.id)
          if (e2) return fail(res, e2.message)
        }
      }
    }

    await recalcTmsOrder(tms_order_id)

    return ok(res, { inserted: toInsert.length, updated: toUpdate.length, warnings }, 201)
  } catch (e) { return fail(res, String(e)) }
}
