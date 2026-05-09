import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

const now = () => new Date().toISOString()

// ─── Fetch helpers ────────────────────────────────────────────

async function fetchGDOFull(id: string) {
  const { data: gdo, error } = await (supabase.from('GroupDeliveryOrder') as any)
    .select('*').eq('id', id).single()
  if (error || !gdo) return null

  const { data: dos } = await (supabase.from('OutboundDelivery') as any)
    .select('*').eq('gdo_id', id).order('delivery_code')

  const doIds = (dos ?? []).map((d: any) => d.id)

  const { data: items } = doIds.length
    ? await (supabase.from('OutboundItem') as any)
        .select('*, material:Material(id,material_code,short_name,custom_short_name,cartons_per_pallet,weight_kg)')
        .in('do_id', doIds)
        .order('id')
    : { data: [] }

  const itemIds = (items ?? []).map((i: any) => i.id)
  const { data: scans } = itemIds.length
    ? await (supabase.from('OutboundScanEntry') as any)
        .select('*').in('item_id', itemIds)
    : { data: [] }

  const scansByItem = new Map<string, any[]>()
  for (const s of (scans ?? [])) {
    const list = scansByItem.get(s.item_id) ?? []
    list.push(s)
    scansByItem.set(s.item_id, list)
  }

  const itemsByDO = new Map<string, any[]>()
  for (const item of (items ?? [])) {
    const list = itemsByDO.get(item.do_id) ?? []
    list.push({ ...item, scan_entries: scansByItem.get(item.id) ?? [] })
    itemsByDO.set(item.do_id, list)
  }

  return {
    ...gdo,
    delivery_orders: (dos ?? []).map((d: any) => ({
      ...d,
      items: itemsByDO.get(d.id) ?? [],
    })),
  }
}

// ─── List GDOs ────────────────────────────────────────────────

export async function listGDOs(req: Request, res: Response) {
  try {
    const { warehouse_id, status, date, search } = req.query as Record<string, string>
    let q = (supabase.from('GroupDeliveryOrder') as any)
      .select('id, group_code, planned_date, delivery_date, warehouse_id, dvvt, status, created_at')
      .order('delivery_date', { ascending: false })
    if (warehouse_id) q = q.eq('warehouse_id', warehouse_id)
    if (status)       q = q.eq('status', status)
    if (date)         q = q.eq('delivery_date', date)
    if (search)       q = q.ilike('group_code', `%${search}%`)
    const { data, error } = await q
    if (error) return fail(res, error.message)

    // Aggregate item counts per GDO
    const gdoIds = (data ?? []).map((g: any) => g.id)
    let doCountMap = new Map<string, number>()
    if (gdoIds.length) {
      const { data: dos } = await (supabase.from('OutboundDelivery') as any)
        .select('id, gdo_id').in('gdo_id', gdoIds)
      for (const d of (dos ?? [])) {
        doCountMap.set(d.gdo_id, (doCountMap.get(d.gdo_id) ?? 0) + 1)
      }
    }

    return ok(res, (data ?? []).map((g: any) => ({
      ...g,
      do_count: doCountMap.get(g.id) ?? 0,
    })))
  } catch (e) { return fail(res, String(e)) }
}

// ─── Get GDO detail ───────────────────────────────────────────

export async function getGDO(req: Request, res: Response) {
  try {
    const result = await fetchGDOFull(req.params.id)
    if (!result) return fail(res, 'Không tìm thấy chuyến xe', 404)
    return ok(res, result)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Create GDO manually ──────────────────────────────────────

export async function createGDO(req: Request, res: Response) {
  try {
    const { group_code, delivery_date, warehouse_id, dvvt } = req.body as {
      group_code: string; delivery_date: string; warehouse_id?: string; dvvt?: string
    }
    if (!group_code || !delivery_date) return fail(res, 'group_code và delivery_date là bắt buộc', 400)

    const planned_date = parsePlannedDate(group_code) ?? delivery_date
    const id = randomUUID()
    const { error } = await (supabase.from('GroupDeliveryOrder') as any).insert({
      id, group_code, planned_date, delivery_date,
      warehouse_id: warehouse_id ?? null, dvvt: dvvt ?? null,
      status: 'PENDING', updated_at: now(),
    })
    if (error) return fail(res, error.message)
    const result = await fetchGDOFull(id)
    return ok(res, result, 201)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Update GDO (delivery_date / status) ─────────────────────

export async function patchGDO(req: Request, res: Response) {
  try {
    const { delivery_date, status } = req.body as { delivery_date?: string; status?: string }
    const { error } = await (supabase.from('GroupDeliveryOrder') as any)
      .update({ delivery_date, status, updated_at: now() })
      .eq('id', req.params.id)
    if (error) return fail(res, error.message)
    const result = await fetchGDOFull(req.params.id)
    return ok(res, result)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Upload Excel ─────────────────────────────────────────────

export async function uploadExcel(req: Request, res: Response) {
  try {
    if (!req.file) return fail(res, 'Không có file upload', 400)
    const { warehouse_id } = req.body as { warehouse_id?: string }

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' })

    if (!rows.length) return fail(res, 'File Excel trống hoặc không đúng định dạng', 400)

    // Group rows by Số xe
    const byVehicle = new Map<string, Record<string, any>[]>()
    for (const row of rows) {
      const code = String(row['Số xe'] ?? row['So xe'] ?? '').trim()
      if (!code) continue
      const list = byVehicle.get(code) ?? []
      list.push(row)
      byVehicle.set(code, list)
    }
    if (!byVehicle.size) return fail(res, 'Không tìm thấy cột "Số xe" hoặc dữ liệu trống', 400)

    // Pre-load materials for lookup
    const { data: materials } = await (supabase.from('Material') as any).select('id, material_code')
    const matMap = new Map<string, string>(
      (materials ?? []).map((m: any) => [m.material_code.trim(), m.id])
    )

    const created: any[] = []

    for (const [group_code, groupRows] of byVehicle) {
      // Check duplicate
      const { data: existing } = await (supabase.from('GroupDeliveryOrder') as any)
        .select('id').eq('group_code', group_code).single()
      if (existing) {
        created.push({ group_code, skipped: true, reason: 'Đã tồn tại' })
        continue
      }

      const planned_date = parsePlannedDate(group_code) ?? new Date().toISOString().slice(0, 10)
      const dvvt = String(groupRows[0]['DVVT'] ?? groupRows[0]['Đơn vị'] ?? '').trim() || null

      const gdoId = randomUUID()
      const { error: gdoErr } = await (supabase.from('GroupDeliveryOrder') as any).insert({
        id: gdoId, group_code, planned_date, delivery_date: planned_date,
        warehouse_id: warehouse_id ?? null, dvvt, status: 'PENDING', updated_at: now(),
      })
      if (gdoErr) { created.push({ group_code, skipped: true, reason: gdoErr.message }); continue }

      // Group rows by Delivery
      const byDelivery = new Map<string, Record<string, any>[]>()
      for (const row of groupRows) {
        const code = String(row['Delivery'] ?? '').trim()
        if (!code) continue
        const list = byDelivery.get(code) ?? []
        list.push(row)
        byDelivery.set(code, list)
      }

      for (const [delivery_code, doRows] of byDelivery) {
        const doId = randomUUID()
        const distributor_name = String(doRows[0]['Tên NPP'] ?? '').trim() || null
        await (supabase.from('OutboundDelivery') as any).insert({
          id: doId, gdo_id: gdoId, delivery_code, distributor_name, status: 'PENDING', updated_at: now(),
        })

        const itemsToInsert = doRows.map(row => {
          const mat_code = String(row['Material'] ?? '').trim()
          const cartons = parseDecimal(row['Thùng'])
          const material_type = String(row['Material_type'] ?? '').trim() || null
          return {
            id: randomUUID(),
            do_id: doId,
            material_id: matMap.get(mat_code) ?? null,
            material_code_raw: mat_code,
            cartons_ordered: cartons,
            boxes_display: parseDecimal(row['Hộp']),
            weight: parseDecimal(row['Tải']),
            loose_picking: parseDecimal(row['Nhặt lẻ']),
            pallets_estimated: parseDecimal(String(row['Pallet'] ?? '').replace(',', '.')),
            material_type,
            export_type: String(row['Loại xuất'] ?? '').trim() || null,
            header_text: String(row['HEADER TEXT'] ?? '').trim() || null,
            batch_required: String(row['Batch_Yêu cầu'] ?? '').trim() || null,
            date_required: parseExcelDate(row['%Date_Yêu cầu']) ?? null,
            cs_responsible: String(row['CS phụ trách'] ?? '').trim() || null,
            cartons_scanned: 0,
            // POSM auto-bypass
            status: material_type === 'POSM' ? 'COMPLETED' : 'PENDING',
            updated_at: now(),
          }
        })
        if (itemsToInsert.length) {
          await (supabase.from('OutboundItem') as any).insert(itemsToInsert)
        }
      }

      created.push({ group_code, id: gdoId, created: true })
    }

    return ok(res, { created }, 201)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Get available inventory for an item ─────────────────────

export async function getItemInventory(req: Request, res: Response) {
  try {
    const { itemId } = req.params
    const { data: item } = await (supabase.from('OutboundItem') as any)
      .select('material_id').eq('id', itemId).single()
    if (!item) return fail(res, 'Không tìm thấy mặt hàng', 404)

    const { data: gdo } = await (supabase.from('GroupDeliveryOrder') as any)
      .select('warehouse_id')
      .eq('id',
        (await (supabase.from('OutboundDelivery') as any)
          .select('gdo_id').eq('id', req.params.gdoId ?? '').single()
        ).data?.gdo_id ?? ''
      ).single()

    let q = (supabase.from('InventoryEntry') as any)
      .select('id, pallet_code, cartons_imported, cartons_remaining, status, qa_status_id, location:Location(location_code), qa_status:QAStatus(code,label)')
      .eq('material_id', item.material_id)
      .in('status', ['IN_STOCK', 'PARTIAL'])
      .order('created_at')
    if (gdo?.warehouse_id) {
      // Filter by warehouse via location
    }
    const { data, error } = await q
    if (error) return fail(res, error.message)

    return ok(res, (data ?? []).map((e: any) => ({
      ...e,
      available: e.cartons_remaining ?? e.cartons_imported,
    })))
  } catch (e) { return fail(res, String(e)) }
}

// ─── Scan QR for an item ──────────────────────────────────────

export async function scanItem(req: Request, res: Response) {
  try {
    const { itemId } = req.params
    const { qr_code, employee_id } = req.body as { qr_code: string; employee_id?: string }
    if (!qr_code) return fail(res, 'qr_code là bắt buộc', 400)

    // 1. Get item
    const { data: item, error: itemErr } = await (supabase.from('OutboundItem') as any)
      .select('*').eq('id', itemId).single()
    if (itemErr || !item) return fail(res, 'Không tìm thấy mặt hàng', 404)
    if (item.status === 'COMPLETED') return fail(res, 'Mặt hàng này đã xuất đủ số lượng', 400)

    // 2. Find inventory entry
    const { data: inv, error: invErr } = await (supabase.from('InventoryEntry') as any)
      .select('*, qa_status:QAStatus(code,label)')
      .eq('pallet_code', qr_code)
      .in('status', ['IN_STOCK', 'PARTIAL'])
      .single()
    if (invErr || !inv) return fail(res, `Không tìm thấy pallet "${qr_code}" trong tồn kho`, 404)

    // 3. QA check — block nếu có QA status khác OK
    if (inv.qa_status_id && inv.qa_status?.code !== 'OK') {
      return fail(res, `Pallet bị giữ QA: ${inv.qa_status?.label ?? inv.qa_status_id} — không được xuất`, 400)
    }

    // 4. Material check
    if (item.material_id && inv.material_id !== item.material_id) {
      return fail(res, `Sai mã hàng — pallet "${inv.material_id}" không khớp với phiếu "${item.material_id}"`, 400)
    }

    // 5. Duplicate check
    const { data: dupCheck } = await (supabase.from('OutboundScanEntry') as any)
      .select('id').eq('item_id', itemId).eq('pallet_code', qr_code).maybeSingle()
    if (dupCheck) return fail(res, `Pallet "${qr_code}" đã được quét trong phiếu này`, 400)

    // 6. Calculate cartons to take (tịnh tiến)
    const available = Number(inv.cartons_remaining ?? inv.cartons_imported)
    const remaining_on_item = Number(item.cartons_ordered) - Number(item.cartons_scanned)
    if (remaining_on_item <= 0) return fail(res, 'Mặt hàng đã đủ số lượng', 400)
    const to_take = Math.min(available, remaining_on_item)

    const t = now()

    // 7. Update InventoryEntry
    if (to_take >= available) {
      await (supabase.from('InventoryEntry') as any)
        .update({ status: 'EXPORTED', cartons_remaining: 0, updated_at: t }).eq('id', inv.id)
    } else {
      await (supabase.from('InventoryEntry') as any)
        .update({ status: 'PARTIAL', cartons_remaining: available - to_take, updated_at: t }).eq('id', inv.id)
    }

    // 8. Create OutboundScanEntry
    const scanId = randomUUID()
    await (supabase.from('OutboundScanEntry') as any).insert({
      id: scanId, item_id: itemId, inventory_entry_id: inv.id,
      pallet_code: qr_code, cartons_scanned: to_take,
      scanned_by: employee_id ?? null, scanned_at: t,
      created_at: t, updated_at: t,
    })

    // 9. Update item
    const new_scanned = Number(item.cartons_scanned) + to_take
    const new_item_status = new_scanned >= Number(item.cartons_ordered) ? 'COMPLETED' : 'IN_PROGRESS'
    await (supabase.from('OutboundItem') as any)
      .update({ cartons_scanned: new_scanned, status: new_item_status, updated_at: t }).eq('id', itemId)

    // 10. Cascade: check DO status
    const { data: siblingItems } = await (supabase.from('OutboundItem') as any)
      .select('status').eq('do_id', item.do_id)
    const doCompleted = (siblingItems ?? []).every((i: any) =>
      i.id === itemId ? new_item_status === 'COMPLETED' : i.status === 'COMPLETED'
    )
    const new_do_status = doCompleted ? 'COMPLETED' : 'IN_PROGRESS'
    const { data: doRow } = await (supabase.from('OutboundDelivery') as any)
      .update({ status: new_do_status, updated_at: t }).eq('id', item.do_id).select('gdo_id').single()

    // 11. Cascade: check GDO status
    if (doRow?.gdo_id) {
      const { data: siblingDOs } = await (supabase.from('OutboundDelivery') as any)
        .select('status').eq('gdo_id', doRow.gdo_id)
      const gdoCompleted = (siblingDOs ?? []).every((d: any) =>
        d.id === item.do_id ? doCompleted : d.status === 'COMPLETED'
      )
      const new_gdo_status = gdoCompleted ? 'COMPLETED' : 'IN_PROGRESS'
      await (supabase.from('GroupDeliveryOrder') as any)
        .update({ status: new_gdo_status, updated_at: t }).eq('id', doRow.gdo_id)
    }

    return ok(res, {
      scan_entry: { id: scanId, pallet_code: qr_code, cartons_scanned: to_take },
      item: { ...item, cartons_scanned: new_scanned, status: new_item_status },
    })
  } catch (e) { return fail(res, String(e)) }
}

// ─── Manual complete item (Pallet Loscam) ────────────────────

export async function manualCompleteItem(req: Request, res: Response) {
  try {
    const { itemId } = req.params
    const { data: item } = await (supabase.from('OutboundItem') as any)
      .select('*').eq('id', itemId).single()
    if (!item) return fail(res, 'Không tìm thấy mặt hàng', 404)

    const t = now()
    await (supabase.from('OutboundItem') as any)
      .update({ status: 'COMPLETED', cartons_scanned: item.cartons_ordered, updated_at: t }).eq('id', itemId)

    // Cascade DO
    const { data: siblingItems } = await (supabase.from('OutboundItem') as any)
      .select('status').eq('do_id', item.do_id)
    const doCompleted = (siblingItems ?? []).every((i: any) =>
      i.id === itemId ? true : i.status === 'COMPLETED'
    )
    const { data: doRow } = await (supabase.from('OutboundDelivery') as any)
      .update({ status: doCompleted ? 'COMPLETED' : 'IN_PROGRESS', updated_at: t })
      .eq('id', item.do_id).select('gdo_id').single()

    // Cascade GDO
    if (doRow?.gdo_id) {
      const { data: siblingDOs } = await (supabase.from('OutboundDelivery') as any)
        .select('status').eq('gdo_id', doRow.gdo_id)
      const gdoCompleted = (siblingDOs ?? []).every((d: any) =>
        d.id === item.do_id ? doCompleted : d.status === 'COMPLETED'
      )
      await (supabase.from('GroupDeliveryOrder') as any)
        .update({ status: gdoCompleted ? 'COMPLETED' : 'IN_PROGRESS', updated_at: t })
        .eq('id', doRow.gdo_id)
    }

    return ok(res, { success: true })
  } catch (e) { return fail(res, String(e)) }
}

// ─── Helpers ──────────────────────────────────────────────────

function parsePlannedDate(group_code: string): string | null {
  // "090526_19" → "2026-05-09"
  const prefix = group_code.split('_')[0]
  if (!prefix || prefix.length !== 6) return null
  const dd = prefix.slice(0, 2)
  const mm = prefix.slice(2, 4)
  const yy = prefix.slice(4, 6)
  const d = new Date(Date.UTC(2000 + parseInt(yy), parseInt(mm) - 1, parseInt(dd)))
  if (isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function parseDecimal(val: any): number {
  if (!val && val !== 0) return 0
  const n = parseFloat(String(val).replace(',', '.'))
  return isNaN(n) ? 0 : n
}

function parseExcelDate(val: any): string | null {
  if (!val) return null
  if (typeof val === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(val)
    if (!d) return null
    const date = new Date(Date.UTC(d.y, d.m - 1, d.d))
    return isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
  }
  const s = String(val).trim()
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
