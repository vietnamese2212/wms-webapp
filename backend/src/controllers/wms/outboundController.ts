import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { effectiveNoQr, markItemsNoQrIfQty } from '../../lib/inventoryMode'
import { effCartonsPerPallet } from '../../utils/palletCalc'
import { resolveShelfLife } from '../../utils/shelfLife'
import { fetchAllRowsParallel } from '../../utils/pagination'
import { categoryAllowed, scopeCategoriesOf, CATEGORY_FORBIDDEN_MSG } from '../../utils/categoryScope'

const now = () => new Date().toISOString()

// ─── Warehouse-scope cho route GHI (mirror guardGateScope/guardInboundScope) ────
// NATIONAL → null (toàn quyền). Khác → danh sách kho được gán cho user.
function scopeWhIds(req: Request): string[] | null {
  return req.user?.warehouse_scope === 'NATIONAL' ? null : (req.user?.warehouse_ids ?? [])
}
// Kiểm 1 kho có thuộc phạm vi user không (KHÔNG truy DB). NATIONAL → luôn true.
function inScope(req: Request, whId: string | null | undefined): boolean {
  const scope = scopeWhIds(req)
  if (scope === null) return true
  return !!whId && scope.includes(whId)
}
// Chặn 403 nếu chuyến (GDO) không thuộc kho trong phạm vi user (fetch warehouse_id của GDO).
async function guardGdoScope(req: Request, res: Response, gdoId: string): Promise<boolean> {
  if (scopeWhIds(req) === null) return true
  const { data } = await supabase.from('GroupDeliveryOrder')
    .select('warehouse_id').eq('id', gdoId).maybeSingle()
  if (!inScope(req, (data as { warehouse_id: string | null } | null)?.warehouse_id)) {
    fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403); return false
  }
  return true
}
// Chặn 403 nếu tạo/chuyển dữ liệu sang kho ngoài phạm vi user.
function guardWhCreate(req: Request, res: Response, whId: string | null | undefined): boolean {
  if (!inScope(req, whId)) {
    fail(res, 'Không thể thao tác với kho ngoài phạm vi của bạn', 403); return false
  }
  return true
}

// ─── Helpers ──────────────────────────────────────────────────

// Điều chỉnh remaining/reserved của 1 InventoryEntry AN TOÀN ĐUA (optimistic-lock + retry + JITTER).
// delta âm = trừ, dương = cộng. Chỉ ghi khi remaining&reserved CHƯA đổi so với lúc đọc → chặn
// lost-update khi nhiều thao tác (quét / xóa-scan / xác nhận nhặt lẻ) chạm cùng pallet đồng thời.
// Trả về true nếu áp dụng được trong 15 lần thử, false nếu entry biến mất hoặc đua liên tục.
// (Trước: 5 lần KHÔNG jitter → 3+ lượt confirm/xóa cùng pallet gây thundering herd → false âm thầm →
// reserved không giảm = lệch tồn. Nay 15 lần + jitter, khớp consumeInventoryExact/addItemScanned.)
async function adjustInventoryAtomic(
  invId: string, deltaRemaining: number, deltaReserved: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < 15; attempt++) {
    const { data: inv } = await supabase.from('InventoryEntry')
      .select('cartons_remaining, cartons_imported, cartons_reserved').eq('id', invId).single()
    if (!inv) return false
    const curRemaining = Number(inv.cartons_remaining ?? 0)
    const curReserved  = Number(inv.cartons_reserved ?? 0)
    const newRemaining = Math.max(0, curRemaining + deltaRemaining)
    const newReserved  = Math.max(0, curReserved + deltaReserved)
    const maxImport    = Number(inv.cartons_imported)
    const newStatus    = newReserved > 0 ? 'LOOSE_PICKING'
      : newRemaining === 0 ? 'EXPORTED'
      : newRemaining < maxImport ? 'PARTIAL'
      : 'IN_STOCK'
    const { data: applied } = await supabase.from('InventoryEntry')
      .update({ cartons_remaining: newRemaining, cartons_reserved: newReserved, status: newStatus, updated_at: now() })
      .eq('id', invId).eq('cartons_remaining', curRemaining).eq('cartons_reserved', curReserved)
      .select('id')
    if (applied?.length) return true
    // CAS trượt → jitter tăng dần phá thundering herd rồi đọc lại (như consumeInventoryExact).
    await new Promise(r => setTimeout(r, 10 + Math.floor(Math.random() * (30 + attempt * 20))))
  }
  return false
}

// XUẤT (trừ remaining) NGUYÊN TỬ: chỉ trừ ĐÚNG `amount` nếu tồn còn đủ, dưới optimistic-lock.
// Trả: true=trừ xong · false=KHÔNG đủ tồn (đã bị thao tác khác lấy) · null=tranh chấp sau 5 lần.
// Chống đua + chống xuất-quá-tồn khi nhiều nhân viên quét cùng 1 pallet (giống book_vehicle_slot).
async function consumeInventoryExact(invId: string, amount: number): Promise<boolean | null> {
  for (let attempt = 0; attempt < 15; attempt++) {
    const { data: inv } = await supabase.from('InventoryEntry')
      .select('cartons_remaining, cartons_imported, cartons_reserved').eq('id', invId).single()
    if (!inv) return null
    const curRemaining = Number(inv.cartons_remaining ?? inv.cartons_imported ?? 0)
    const curReserved  = Number(inv.cartons_reserved ?? 0)
    if (curRemaining < amount) return false   // không đủ tồn để xuất từng ấy nữa
    const newRemaining = curRemaining - amount
    const maxImport    = Number(inv.cartons_imported)
    const newStatus    = newRemaining === 0 ? 'EXPORTED' : newRemaining < maxImport ? 'PARTIAL' : 'IN_STOCK'
    const { data: applied } = await supabase.from('InventoryEntry')
      .update({ cartons_remaining: newRemaining, status: newStatus, updated_at: now() })
      .eq('id', invId).eq('cartons_remaining', curRemaining).eq('cartons_reserved', curReserved)
      .select('id')
    if (applied?.length) return true
    // CAS trượt (người khác vừa đổi tồn): chờ jitter tăng dần phá thundering herd rồi đọc lại.
    await new Promise(r => setTimeout(r, 10 + Math.floor(Math.random() * (30 + attempt * 20))))
  }
  return null
}

// CỘNG DỒN cartons_scanned của item NGUYÊN TỬ (optimistic-CAS) + set status theo TỔNG mới.
// Trước đây ghi mù cartons_scanned = (số đọc cũ + delta) → nhiều người quét CÙNG item làm MẤT cộng dồn
// (item kẹt IN_PROGRESS dù đã quét đủ, đơn không tự hoàn thành). CAS bảo đảm mỗi lượt cộng đúng 1 lần.
// Trả tổng mới, hoặc null nếu tranh chấp sau 15 lần (hiếm — caller giữ giá trị ước tính).
async function addItemScanned(itemId: string, delta: number, statusOf: (total: number) => string): Promise<number | null> {
  for (let attempt = 0; attempt < 15; attempt++) {
    const { data: it } = await supabase.from('OutboundItem')
      .select('cartons_scanned').eq('id', itemId).single()
    if (!it) return null
    const cur = Number(it.cartons_scanned ?? 0)
    const next = cur + delta
    const { data: applied } = await supabase.from('OutboundItem')
      .update({ cartons_scanned: next, status: statusOf(next), updated_at: now() })
      .eq('id', itemId).eq('cartons_scanned', cur).select('id')
    if (applied?.length) return next
    await new Promise(r => setTimeout(r, 10 + Math.floor(Math.random() * (30 + attempt * 20))))
  }
  return null
}

function parsePlannedDate(group_code: string): string | null {
  const parts = group_code.split('_')
  // New format: warehouseCode_X|N_ddmmyy_stt  (parts[1] is 'X' or 'N')
  // Old format: ddmmyy_Kho_stt                (parts[0] is 6-digit date)
  const rawDate = (parts.length >= 4 && (parts[1] === 'X' || parts[1] === 'N'))
    ? parts[2]
    : parts[0]
  if (!rawDate || rawDate.length !== 6) return null
  const dd = rawDate.slice(0, 2)
  const mm = rawDate.slice(2, 4)
  const yy = rawDate.slice(4, 6)
  const d = new Date(Date.UTC(2000 + parseInt(yy), parseInt(mm) - 1, parseInt(dd)))
  if (isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function parseDecimal(val: any): number {
  if (!val && val !== 0) return 0
  if (typeof val === 'number') return isNaN(val) ? 0 : val
  // Chuẩn số VN: dấu CHẤM = ngăn nghìn, dấu PHẨY = thập phân (1.234,56).
  let s = String(val).trim().replace(/\s/g, '')
  const commas = (s.match(/,/g) ?? []).length
  const dots   = (s.match(/\./g) ?? []).length
  if (commas && dots)       s = s.replace(/\./g, '').replace(',', '.') // 1.234,56 → 1234.56
  else if (commas > 1)      s = s.replace(/,/g, '')                    // 1,234,567 (kiểu US) → 1234567
  else if (commas === 1)    s = s.replace(',', '.')                    // 15,462 → 15.462
  else if (dots > 1)        s = s.replace(/\./g, '')                   // 1.234.567 (nghìn VN) → 1234567
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

function validateGroupCode(gc: string): string | null {
  const parts = gc.split('_')
  // Bắt buộc format mới: Mãkho_X_ddmmyy_stt (vd: 88888888_X_060626_01)
  if (parts.length < 4 || (parts[1] !== 'X' && parts[1] !== 'N'))
    return 'Số xe phải có định dạng Mãkho_X_ddmmyy_stt (vd: 88888888_X_060626_01)'
  if (!/^\d{6}$/.test(parts[2]))              return 'Phần ngày trong Số xe phải là 6 chữ số ddmmyy'
  if (!/^\d+$/.test(parts[parts.length - 1])) return 'Phần cuối Số xe phải là số thứ tự (01, 02…)'
  if (!parsePlannedDate(gc))                  return 'Ngày trong Số xe không hợp lệ'
  return null
}

function parseExcelDate(val: any): string | null {
  if (!val) return null
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val)
    if (!d) return null
    const date = new Date(Date.UTC(d.y, d.m - 1, d.d))
    return isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
  }
  const s = String(val).trim()
  if (!s) return null
  // dd/mm/yyyy (Vietnamese default — JS Date() would misread as mm/dd)
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmy) {
    const date = new Date(Date.UTC(parseInt(dmy[3]), parseInt(dmy[2]) - 1, parseInt(dmy[1])))
    return isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function isExcludedFromCount(item: any): boolean {
  return item.material?.no_qr_tracking === true
}

// ─── Fetch full GDO ───────────────────────────────────────────

async function fetchGDOFull(id: string) {
  const { data: gdo, error } = await supabase.from('GroupDeliveryOrder')
    .select('*, warehouse:Warehouse(id,code,name,inventory_mode), gate_registration:gate_registrations!gate_registration_id(id,registration_number,date,license_plate,company_name_raw,driver_name,status,direction,registered_at,entry_at,exit_at,called_at)')
    .eq('id', id).single()
  if (error || !gdo) return null

  const { data: dos } = await supabase.from('OutboundDelivery')
    .select('*').eq('gdo_id', id).order('delivery_code')

  const doIds = (dos ?? []).map((d: any) => d.id)

  const { data: items } = doIds.length
    ? await supabase.from('OutboundItem')
        .select('*, material:Material(id,material_code,short_name,custom_short_name,unit,cartons_per_pallet,weight_kg,shelf_life_days,no_qr_tracking)')
        .in('do_id', doIds)
        .order('id')
    : { data: [] }

  // Kho QTY → ép mọi item thành no-QR hiệu lực (hiển thị + logic manual downstream)
  markItemsNoQrIfQty(
    (items ?? []) as unknown as Parameters<typeof markItemsNoQrIfQty>[0],
    (gdo as unknown as { warehouse?: { inventory_mode?: string | null } | null }).warehouse?.inventory_mode,
  )

  const itemIds = (items ?? []).map((i: any) => i.id)
  const { data: scans } = itemIds.length
    ? await supabase.from('OutboundScanEntry')
        .select('*, scanned_by_emp:Employee!scanned_by(id, name)').in('item_id', itemIds)
    : { data: [] }

  // Map item_id → shelf_life_days để tính pct_date cho từng scan entry
  const itemShelfMap = new Map<string, number>()
  for (const item of (items ?? [])) {
    itemShelfMap.set(item.id, item.material?.shelf_life_days ? Number(item.material.shelf_life_days) : 0)
  }
  const nowMs = Date.now()

  const scansByItem = new Map<string, any[]>()
  for (const s of (scans ?? [])) {
    // Ưu tiên pct_date đã lưu (cứng tại thời điểm quét); fallback tính động cho entries cũ chưa có
    let pct_date: number | null
    if (s.pct_date !== null && s.pct_date !== undefined) {
      pct_date = s.pct_date
    } else {
      const shelfDays = itemShelfMap.get(s.item_id) ?? 0
      pct_date = null
      if (shelfDays > 0 && s.production_date) {
        const totalMs = shelfDays * 86_400_000
        const remaining = new Date(s.production_date).getTime() + totalMs - nowMs
        pct_date = Math.max(0, Math.round((remaining / totalMs) * 100))
      }
    }
    const list = scansByItem.get(s.item_id) ?? []
    list.push({ ...s, pct_date })
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
    const { warehouse_id, status, date, date_from, date_to, search, transfer_status } = req.query as Record<string, string>
    const scopeWarehouseIds = req.user?.warehouse_scope !== 'NATIONAL'
      ? (req.user?.warehouse_ids ?? [])
      : []
    const scopeCats = scopeCategoriesOf(req)

    // Rebuild query mỗi trang (builder PostgREST dùng 1 lần) — phân trang vượt cap ~1000 dòng/response
    // (kho nhiều chuyến/khoảng ngày rộng → trước đây mất chuyến từ dòng 1001).
    const buildQuery = (): any | null => {
      let q = supabase.from('GroupDeliveryOrder')
        .select('*, warehouse:Warehouse(id,code,name,inventory_mode), forklift_driver:Employee!forklift_driver_id(id,name)')
        .order('delivery_date', { ascending: false })
      // Cắt theo Loại hàng được phép (chuyến không khai loại vẫn hiện)
      if (scopeCats) q = q.or(`warehouse_type.is.null,warehouse_type.in.(${scopeCats.map(c => `"${c}"`).join(',')})`)
      if (scopeWarehouseIds.length > 0) {
        const effective = warehouse_id ? scopeWarehouseIds.filter(id => id === warehouse_id) : scopeWarehouseIds
        if (effective.length === 0) return null
        q = effective.length === 1 ? q.eq('warehouse_id', effective[0]) : q.in('warehouse_id', effective)
      } else if (warehouse_id) {
        q = q.eq('warehouse_id', warehouse_id)
      }
      if (status)          q = q.eq('status', status)
      if (transfer_status) q = q.eq('transfer_status', transfer_status)
      if (date)            q = q.eq('delivery_date', date)
      if (date_from)       q = q.gte('delivery_date', date_from)
      if (date_to)         q = q.lte('delivery_date', date_to)
      if (search)          q = q.ilike('group_code', `%${search}%`)
      return q
    }
    if (buildQuery() === null) return ok(res, [])   // scope kho rỗng
    const PAGE = 1000
    const data: any[] = []
    for (let page = 0; ; page++) {
      const { data: batch, error } = await buildQuery().range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) return fail(res, error.message)
      const arr = batch ?? []
      data.push(...arr)
      if (arr.length < PAGE) break
    }

    const gdoIds = (data ?? []).map((g: any) => g.id)
    if (!gdoIds.length) return ok(res, [])

    // Bulk fetch DOs and items for aggregation — PHÂN TRANG (cap ~1000/response): khoảng ngày rộng
    // → items gộp qua mọi GDO dễ vượt 1000, bị cắt âm thầm = tổng thùng/pallet mỗi GDO tính THIẾU.
    const dos = await fetchAllRowsParallel(() => supabase.from('OutboundDelivery')
      .select('id, gdo_id, distributor_name, delivery_code')
      .in('gdo_id', gdoIds).order('id'))

    const doIds = (dos ?? []).map((d: any) => d.id)

    const items = doIds.length
      ? await fetchAllRowsParallel(() => supabase.from('OutboundItem')
          .select('id, do_id, cartons_ordered, cartons_scanned, pallets_estimated, loose_picking, material_type, export_type, material_code_raw, material_id, material:Material!material_id(no_qr_tracking, short_name)')
          .in('do_id', doIds).order('id'), 1000, 4)
      : []

    // Kho QTY → ép no-QR hiệu lực cho item của các GDO QTY (do_id → gdo → inventory_mode)
    const gdoModeById = new Map<string, string | null>((data ?? []).map((g: any) => [g.id, g.warehouse?.inventory_mode ?? null]))
    const doToGdo = new Map<string, string>((dos ?? []).map((d: any) => [d.id, d.gdo_id]))
    const qtyItems = (items ?? []).filter((i: any) => {
      const gid = doToGdo.get(i.do_id)
      return gid != null && gdoModeById.get(gid) === 'QTY'
    })
    markItemsNoQrIfQty(qtyItems as unknown as Parameters<typeof markItemsNoQrIfQty>[0], 'QTY')

    // Build lookup maps
    const dosByGdo = new Map<string, any[]>()
    const distributorByDo = new Map<string, string | null>()
    for (const d of (dos ?? [])) {
      const list = dosByGdo.get(d.gdo_id) ?? []
      list.push(d)
      dosByGdo.set(d.gdo_id, list)
      distributorByDo.set(d.id, d.distributor_name ?? null)
    }

    const itemsByDo = new Map<string, any[]>()
    for (const i of (items ?? [])) {
      const list = itemsByDo.get(i.do_id) ?? []
      list.push(i)
      itemsByDo.set(i.do_id, list)
    }

    return ok(res, (data ?? []).map((g: any) => {
      const gdoDOs   = dosByGdo.get(g.id) ?? []
      const gdoItems = gdoDOs.flatMap((d: any) => itemsByDo.get(d.id) ?? [])
      const noqrItems = gdoItems.filter((i: any) => isExcludedFromCount(i))

      const distributorNames = [...new Set(
        gdoDOs.map((d: any) => d.distributor_name).filter(Boolean)
      )]
      const deliveryCodes = [...new Set(
        gdoDOs.map((d: any) => d.delivery_code).filter(Boolean)
      )]
      const firstExportType = gdoItems.find((i: any) => i.export_type)?.export_type ?? null

      // Phân bổ theo (mã hàng × NPP) — gộp để FE lọc theo mã hàng + tổng theo NPP (expand kiểu Inbound).
      // Tính MỌI item (kể cả no_qr_tracking) để khớp tile Tổng thùng (= tất cả).
      const breakdownMap = new Map<string, { material_code: string; material_name: string | null; distributor_name: string | null; cartons: number; cartons_scanned: number; pallets: number }>()
      for (const i of gdoItems) {
        const material_code = i.material_code_raw ?? '(?)'
        const distributor_name = distributorByDo.get(i.do_id) ?? null
        const key = `${material_code}__${distributor_name ?? ''}`
        const cur = breakdownMap.get(key) ?? { material_code, material_name: i.material?.short_name ?? null, distributor_name, cartons: 0, cartons_scanned: 0, pallets: 0 }
        cur.cartons         += Number(i.cartons_ordered ?? 0)
        cur.cartons_scanned += Number(i.cartons_scanned ?? 0)
        cur.pallets         += Number(i.pallets_estimated ?? 0)
        breakdownMap.set(key, cur)
      }

      return {
        ...g,
        do_count:          gdoDOs.length,
        distributor_names: distributorNames as string[],
        delivery_codes:    deliveryCodes as string[],
        export_type:       firstExportType,
        // Tổng thùng = TẤT CẢ item (gồm hàng no_qr); thêm total_cartons_noqr = riêng hàng không QR.
        total_cartons:      gdoItems.reduce((s: number, i: any) => s + Number(i.cartons_ordered),   0),
        total_cartons_noqr: noqrItems.reduce((s: number, i: any) => s + Number(i.cartons_ordered),  0),
        total_pallets:      gdoItems.reduce((s: number, i: any) => s + Number(i.pallets_estimated), 0),
        total_loose:        gdoItems.reduce((s: number, i: any) => s + Number(i.loose_picking ?? 0), 0),
        item_breakdown:    [...breakdownMap.values()],
      }
    }))
  } catch (e) { return fail(res, String(e)) }
}

// ─── Tra cứu chuyến xuất theo tem pallet ──────────────────────
// Cho ô tìm kiếm ở danh sách Xuất: quét/gõ mã tem pallet → ra chuyến đã xuất pallet đó.
// Chỉ chạy khi user gõ search (FE gọi enabled q≥2) → không phình payload endpoint list nóng.
// pallet_code (OutboundScanEntry) → item_id → OutboundItem.do_id → OutboundDelivery.gdo_id
export async function lookupPalletGdos(req: Request, res: Response) {
  try {
    const q = String(req.query.q ?? '').trim()
    if (q.length < 2) return ok(res, [])
    // Phân trang đủ (cap ~1000/response — .limit(2000) KHÔNG vượt được cap)
    const scans = await fetchAllRowsParallel(() => supabase.from('OutboundScanEntry')
      .select('item_id').ilike('pallet_code', `%${q}%`).order('id'))
    const itemIds = [...new Set((scans as { item_id: string | null }[])
      .map(s => s.item_id).filter((v): v is string => !!v))]
    if (!itemIds.length) return ok(res, [])
    // Chunk ids 300/lượt (tránh URL dài + cap 1000)
    const items: { do_id: string | null }[] = []
    for (let i = 0; i < itemIds.length; i += 300) {
      const { data, error } = await supabase.from('OutboundItem').select('do_id').in('id', itemIds.slice(i, i + 300))
      if (error) throw new Error(error.message)
      items.push(...((data ?? []) as { do_id: string | null }[]))
    }
    const doIds = [...new Set(items.map(i => i.do_id).filter((v): v is string => !!v))]
    if (!doIds.length) return ok(res, [])
    const dos: { gdo_id: string | null }[] = []
    for (let i = 0; i < doIds.length; i += 300) {
      const { data, error } = await supabase.from('OutboundDelivery').select('gdo_id').in('id', doIds.slice(i, i + 300))
      if (error) throw new Error(error.message)
      dos.push(...((data ?? []) as { gdo_id: string | null }[]))
    }
    const gdoIds = [...new Set(dos.map(d => d.gdo_id).filter((v): v is string => !!v))]
    return ok(res, gdoIds)
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

// ─── DVVT trên phiếu xuất khớp 1 ĐVVT hoặc NCC (code/alias/tên) → chuẩn hoá về TÊN chính tắc ──
// NCC cũng có lúc TỰ CHỞ hàng của họ → nhận cả type NCC làm đơn vị vận tải, không chỉ ĐVVT.
// Trả { ok, name }: trống → ok(null); khớp → ok(tên chính tắc); không khớp → !ok (chặn, báo lỗi).
async function buildDvvtResolver() {
  const { data } = await supabase.from('TransportCompany').select('code, name, alias_codes').in('type', ['ĐVVT', 'NCC'])
  const byKey = new Map<string, string>()
  for (const c of (data ?? []) as { code: string; name: string; alias_codes: string[] | null }[]) {
    const nm = String(c.name).trim()
    if (c.code) byKey.set(String(c.code).trim().toLowerCase(), nm)
    byKey.set(nm.toLowerCase(), nm)
    for (const a of (c.alias_codes ?? [])) { const k = String(a).trim().toLowerCase(); if (k) byKey.set(k, nm) }
  }
  return (raw: string | null | undefined): { ok: boolean; name: string | null } => {
    const k = String(raw ?? '').trim().toLowerCase()
    if (!k) return { ok: true, name: null }
    const nm = byKey.get(k)
    return nm ? { ok: true, name: nm } : { ok: false, name: null }
  }
}

// ─── Create GDO manually ──────────────────────────────────────

export async function createGDO(req: Request, res: Response) {
  try {
    const { delivery_date, warehouse_id, dvvt, customer_name, delivery_code, export_type, warehouse_type, shipto_party, items } = req.body as {
      delivery_date: string; warehouse_id?: string; dvvt?: string
      customer_name?: string; delivery_code?: string; export_type?: string; warehouse_type?: string; shipto_party?: string
      items?: Array<{ material_code: string; cartons_ordered: number; loose_picking?: number; header_text?: string; batch_required?: string; date_required?: number; cs_responsible?: string }>
    }
    if (!delivery_date) return fail(res, 'delivery_date là bắt buộc', 400)
    if (!delivery_code?.trim()) return fail(res, 'Số DO là bắt buộc', 400)
    if (!items?.length) return fail(res, 'Phải có ít nhất 1 mặt hàng', 400)
    if (!guardWhCreate(req, res, warehouse_id)) return
    if (!categoryAllowed(req, warehouse_type)) return fail(res, CATEGORY_FORBIDDEN_MSG, 403)

    const dvvtRes = (await buildDvvtResolver())(dvvt)
    if (!dvvtRes.ok) return fail(res, `ĐVVT "${dvvt}" không khớp danh mục — kiểm tra lại mã/tên ĐVVT`, 400)

    // Auto-generate group_code: warehouseCode_X_ddmmyy_stt
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    const [yr, mo, dy] = today.split('-')
    const ddmmyy = `${dy}${mo}${yr.slice(2)}`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const whData = warehouse_id ? (await supabase.from('Warehouse').select('code').eq('id', warehouse_id).single()).data : null
    const whCode = whData?.code ? String(whData.code) : 'XX'
    const prefix = `${whCode}_X_${ddmmyy}_`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await supabase.from('GroupDeliveryOrder')
      .select('group_code').ilike('group_code', `${prefix}%`)
    const maxNum = Math.max(0, ...(existing ?? []).map((r: any) => parseInt(r.group_code.split('_').at(-1) ?? '') || 0))
    const group_code = `${prefix}${String(maxNum + 1).padStart(2, '0')}`

    const gdoId = randomUUID()
    const actor = req.user?.name || null
    const { error } = await supabase.from('GroupDeliveryOrder').insert({
      id: gdoId, group_code, planned_date: delivery_date, delivery_date,
      warehouse_id: warehouse_id ?? null, dvvt: dvvtRes.name,
      warehouse_type: warehouse_type ?? null, shipto_party: shipto_party ?? null, status: 'PENDING',
      created_by: actor, updated_by: actor, updated_at: now(),
    })
    if (error) return fail(res, error.message)

    // Load material info (id + category → material_type)
    const allCodes = [...new Set(items.map(i => i.material_code))]
    const { data: mats } = await supabase.from('Material')
      .select('id, material_code, category').in('material_code', allCodes)
    const matMap = new Map<string, { id: string; category: string | null }>(
      (mats ?? []).map((m: any) => [m.material_code, { id: m.id, category: m.category }])
    )

    // Single DO for manual orders
    const doId = randomUUID()
    const { error: doErr } = await supabase.from('OutboundDelivery').insert({
      id: doId, gdo_id: gdoId, delivery_code: delivery_code?.trim() || null,
      distributor_name: customer_name ?? null, status: 'PENDING', updated_at: now(),
    })
    if (doErr) return fail(res, doErr.message)

    const itemsToInsert = items.map(item => {
      const matInfo = matMap.get(item.material_code)
      const material_type = matInfo?.category ?? null
      return {
        id: randomUUID(), do_id: doId,
        material_id: matInfo?.id ?? null,
        material_code_raw: item.material_code,
        cartons_ordered: item.cartons_ordered,
        boxes_display: 0, weight: null, pallets_estimated: 0,
        loose_picking: item.loose_picking ?? 0,
        header_text: item.header_text?.trim() || null,
        batch_required: item.batch_required?.trim() || null,
        date_required: item.date_required || null,
        cs_responsible: item.cs_responsible?.trim() || null,
        material_type, export_type: export_type ?? null, cartons_scanned: 0,
        status: 'PENDING', updated_at: now(),
      }
    })
    const { error: itemErr } = await supabase.from('OutboundItem').insert(itemsToInsert)
    if (itemErr) return fail(res, itemErr.message)

    const result = await fetchGDOFull(gdoId)
    return ok(res, result, 201)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Auto-create TmsOrder khi GDO COMPLETED + shipto_party là kho hệ thống ───

async function maybeAutoCreateTransferOrder(gdoId: string, nowTs: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: gdo } = await supabase.from('GroupDeliveryOrder')
    .select('id, group_code, shipto_party, transfer_status, license_plate')
    .eq('id', gdoId).single()
  // Chỉ tạo chuyển kho khi có shipto_party (gốc từ upload) khớp KHO NHẬN theo dõi tồn (QR/QTY).
  // shipto trỏ kho NONE / khách hàng / không có trong DB → xuất bán thường, KHÔNG tạo chuyển kho.
  // (đổi kho NONE→QR/QTY rồi Hoàn thành: shipto đã lưu sẵn → tra lại thấy QR/QTY → tạo chuyển kho.)
  if (!gdo?.shipto_party || gdo.transfer_status) return

  type DestWh = { id: string; code: string; name: string; inventory_mode?: string | null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: destWhData } = await supabase.from('Warehouse')
    .select('id, code, name, inventory_mode')
    .or(`code.eq.${gdo.shipto_party},shipto_codes.cs.{${gdo.shipto_party}}`)
    .eq('is_active', true).maybeSingle()
  const destWh = (destWhData as DestWh) ?? null
  if (!destWh || destWh.inventory_mode === 'NONE') return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: dos } = await supabase.from('OutboundDelivery')
    .select('id').eq('gdo_id', gdoId)
  const doIds = (dos ?? []).map((d: { id: string }) => d.id)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: items } = doIds.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await supabase.from('OutboundItem')
        .select('material_id, cartons_ordered, material_type, material:Material(category)')
        .in('do_id', doIds)
    : { data: [] as any[] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matMap = new Map<string, { material_id: string; planned_boxes: number; category: string | null }>()
  for (const item of (items ?? []) as any[]) {
    if (!item.material_id) continue
    if (!matMap.has(item.material_id))
      matMap.set(item.material_id, { material_id: item.material_id, planned_boxes: 0, category: item.material?.category ?? null })
    matMap.get(item.material_id)!.planned_boxes += item.cartons_ordered || 0
  }
  if (!matMap.size) return

  const orderId = randomUUID()
  const orderCode = `TRF_${destWh.code}_${gdo.group_code}`
  const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('TmsOrder').insert({
    id: orderId, order_code: orderCode,
    date: vnDate, warehouse_id: destWh.id,
    destination_warehouse_id: destWh.id,
    direction: 'INBOUND', source_type: 'TRANSFER',
    transfer_gdo_id: gdoId,
    planned_boxes: 0, planned_pallets: 0,
    status: 'PENDING',
    created_at: nowTs, updated_at: nowTs,
  })

  const lineRows = [...matMap.values()].map(m => ({
    id: randomUUID(), tms_order_id: orderId, date: vnDate,
    warehouse_id: destWh.id, warehouse_type: m.category || null,
    material_id: m.material_id, planned_boxes: m.planned_boxes,
    planned_pallets: null, status: 'ACTIVE',
    created_at: nowTs, updated_at: nowTs,
  }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('inbound_plan_lines').insert(lineRows)

  const totalBoxes = lineRows.reduce((s, r) => s + r.planned_boxes, 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('TmsOrder').update({ planned_boxes: totalBoxes, updated_at: nowTs }).eq('id', orderId)

  const plate: string | null = gdo.license_plate || null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('TmsVehicleSlot').insert({
    id: randomUUID(), order_id: orderId,
    license_plate: plate,
    status: plate ? 'BOOKED' : 'PENDING',
    created_at: nowTs, updated_at: nowTs,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('GroupDeliveryOrder')
    .update({ transfer_status: 'IN_TRANSIT', updated_at: nowTs }).eq('id', gdoId)
}

// ─── Delete GDO ───────────────────────────────────────────────

export async function deleteGDO(req: Request, res: Response) {
  try {
    if (!(await guardGdoScope(req, res, req.params.id))) return
    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select('status').eq('id', req.params.id).single()
    if (!gdo) return fail(res, 'Không tìm thấy chuyến xe', 404)
    if (gdo.status !== 'PENDING') return fail(res, 'Chỉ có thể xóa đơn ở trạng thái chờ (PENDING)', 400)

    const { data: dos } = await supabase.from('OutboundDelivery')
      .select('id').eq('gdo_id', req.params.id)
    const doIds = (dos ?? []).map((d: any) => d.id as string)
    if (doIds.length) {
      await supabase.from('OutboundItem').delete().in('do_id', doIds)
      await supabase.from('OutboundDelivery').delete().in('id', doIds)
    }
    await supabase.from('GroupDeliveryOrder').delete().eq('id', req.params.id)
    return ok(res, { success: true })
  } catch (e) { return fail(res, String(e)) }
}

// ─── Update GDO (header + items, chỉ PENDING) ─────────────────

export async function updateGDO(req: Request, res: Response) {
  try {
    const { delivery_date, warehouse_id, dvvt, customer_name, delivery_code, export_type, warehouse_type, items, gate_registration_id, shipto_party } = req.body as {
      delivery_date?: string; warehouse_id?: string; dvvt?: string
      customer_name?: string; delivery_code?: string; export_type?: string; warehouse_type?: string; gate_registration_id?: string | null; shipto_party?: string | null
      items?: Array<{ db_id?: string; material_code: string; cartons_ordered: number; loose_picking?: number; header_text?: string; batch_required?: string; date_required?: number; cs_responsible?: string; npp?: string }>
    }

    if (!(await guardGdoScope(req, res, req.params.id))) return
    if (warehouse_id && !guardWhCreate(req, res, warehouse_id)) return
    if ('warehouse_type' in req.body && !categoryAllowed(req, warehouse_type)) return fail(res, CATEGORY_FORBIDDEN_MSG, 403)

    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select('status').eq('id', req.params.id).single()
    if (!gdo) return fail(res, 'Không tìm thấy chuyến xe', 404)
    if (!['PENDING', 'PAUSED'].includes(gdo.status)) return fail(res, 'Chỉ sửa được đơn ở trạng thái PENDING hoặc PAUSED', 400)

    const dvvtRes = (await buildDvvtResolver())(dvvt)
    if (!dvvtRes.ok) return fail(res, `ĐVVT "${dvvt}" không khớp danh mục — kiểm tra lại mã/tên ĐVVT`, 400)

    const t = now()
    const gdoUpdates: Record<string, unknown> = {
      delivery_date, warehouse_id: warehouse_id ?? null, dvvt: dvvtRes.name, updated_at: t,
    }
    if ('gate_registration_id' in req.body) gdoUpdates.gate_registration_id = gate_registration_id ?? null
    if ('shipto_party' in req.body) gdoUpdates.shipto_party = shipto_party ?? null
    if ('warehouse_type' in req.body) gdoUpdates.warehouse_type = warehouse_type ?? null

    await supabase.from('GroupDeliveryOrder')
      .update(gdoUpdates)
      .eq('id', req.params.id)

    const { data: dos } = await supabase.from('OutboundDelivery')
      .select('id, distributor_name').eq('gdo_id', req.params.id)
    const doList = dos ?? []
    const isMultiDO = doList.length > 1

    // Update customer_name / delivery_code chỉ cho single-DO (multi-DO có distributor_name riêng mỗi OD)
    if (!isMultiDO && doList.length === 1) {
      const singleDOPatch: Record<string, unknown> = { distributor_name: customer_name ?? null, updated_at: t }
      if ('delivery_code' in req.body && delivery_code !== undefined)
        singleDOPatch.delivery_code = delivery_code.trim() || null
      await supabase.from('OutboundDelivery')
        .update(singleDOPatch).eq('id', doList[0].id)
    }

    if (!items) return ok(res, await fetchGDOFull(req.params.id))

    // Lấy tất cả items của GDO (across all DOs)
    const doIds = doList.map((d: any) => d.id as string)
    const { data: existingItems } = doIds.length
      ? await supabase.from('OutboundItem')
          .select('id, do_id, material_code_raw, cartons_ordered, cartons_scanned').in('do_id', doIds)
      : { data: [] }

    if (isMultiDO) {
      // Multi-DO: match bằng db_id, cho phép xóa item chưa xuất
      const existingById = new Map<string, any>(
        (existingItems ?? []).map((i: any) => [i.id as string, i])
      )
      const requestedDbIds = new Set(items.filter(i => i.db_id).map(i => i.db_id as string))

      // Kiểm tra: không xóa item đã xuất
      for (const [id, ex] of existingById) {
        if (!requestedDbIds.has(id) && Number(ex.cartons_scanned) > 0) {
          return fail(res, `Không thể xóa mã hàng "${ex.material_code_raw}" đã xuất ${ex.cartons_scanned} thùng`, 400)
        }
      }

      // Kiểm tra số thùng < đã xuất
      for (const item of items) {
        if (!item.db_id) continue
        const ex = existingById.get(item.db_id)
        if (ex && item.cartons_ordered < Number(ex.cartons_scanned)) {
          return fail(res, `Số thùng "${ex.material_code_raw}" (${item.cartons_ordered}) nhỏ hơn đã xuất (${ex.cartons_scanned})`, 400)
        }
      }

      // Xóa items bị loại bỏ (chưa xuất)
      const toDeleteIds = [...existingById.keys()].filter(id => !requestedDbIds.has(id))
      if (toDeleteIds.length) {
        await supabase.from('OutboundItem').delete().in('id', toDeleteIds)
      }

      // Load material cho các item chưa xuất mà đổi mã hàng
      const changedMatCodes = items
        .filter(item => item.db_id && existingById.has(item.db_id))
        .filter(item => {
          const ex = existingById.get(item.db_id!)!
          return Number(ex.cartons_scanned) === 0 && ex.material_code_raw !== item.material_code
        })
        .map(item => item.material_code)
      let changedMatMap = new Map<string, { id: string; category: string | null }>()
      if (changedMatCodes.length) {
        const { data: mats } = await supabase.from('Material')
          .select('id, material_code, category').in('material_code', changedMatCodes)
        changedMatMap = new Map((mats ?? []).map((m: any) => [m.material_code as string, { id: m.id, category: m.category }]))
      }

      // Cập nhật song song
      await Promise.all(
        items
          .filter(item => item.db_id && existingById.has(item.db_id))
          .map(item => {
            const ex = existingById.get(item.db_id!)!
            const scanned = Number(ex.cartons_scanned)
            const newStatus = scanned >= item.cartons_ordered ? 'COMPLETED' : scanned > 0 ? 'IN_PROGRESS' : 'PENDING'
            const fields: Record<string, unknown> = { cartons_ordered: item.cartons_ordered, loose_picking: item.loose_picking ?? 0, header_text: item.header_text?.trim() || null, batch_required: item.batch_required?.trim() || null, date_required: item.date_required || null, cs_responsible: item.cs_responsible?.trim() || null, export_type: export_type ?? null, status: newStatus, updated_at: t }
            if (scanned === 0 && ex.material_code_raw !== item.material_code) {
              const matInfo = changedMatMap.get(item.material_code)
              fields.material_code_raw = item.material_code
              fields.material_id       = matInfo?.id ?? null
              fields.material_type     = matInfo?.category ?? null
            }
            return supabase.from('OutboundItem').update(fields).eq('id', item.db_id!)
          })
      )

      // Dòng THÊM MỚI (không db_id) ở đơn đa-NPP: gắn vào DO của NPP dòng đó chỉ định
      const newRows = items.filter(item => !item.db_id && item.material_code)
      if (newRows.length) {
        const doByNpp = new Map<string, string>(
          doList.map((d: any) => [String(d.distributor_name ?? '').trim(), d.id as string])
        )
        for (const item of newRows) {
          if (!doByNpp.has(String(item.npp ?? '').trim()))
            return fail(res, `Dòng "${item.material_code}": chưa chọn NPP hợp lệ cho dòng thêm mới`, 400)
        }
        const { data: newMats } = await supabase.from('Material')
          .select('id, material_code, category').in('material_code', newRows.map(i => i.material_code))
        const newMatMap = new Map((newMats ?? []).map((m: any) => [m.material_code as string, { id: m.id as string, category: m.category as string | null }]))
        const inserts = newRows.map(item => {
          const matInfo = newMatMap.get(item.material_code)
          return {
            id: randomUUID(), do_id: doByNpp.get(String(item.npp ?? '').trim())!,
            material_id: matInfo?.id ?? null, material_code_raw: item.material_code,
            cartons_ordered: item.cartons_ordered, boxes_display: 0, weight: null, pallets_estimated: 0,
            loose_picking: item.loose_picking ?? 0,
            header_text: item.header_text?.trim() || null,
            batch_required: item.batch_required?.trim() || null,
            date_required: item.date_required || null,
            cs_responsible: item.cs_responsible?.trim() || null,
            material_type: matInfo?.category ?? null, export_type: export_type ?? null,
            cartons_scanned: 0, status: 'PENDING', updated_at: t,
          }
        })
        const { error: insErr } = await supabase.from('OutboundItem').insert(inserts)
        if (insErr) return fail(res, insErr.message)
      }
    } else {
      // Single-DO: CRUD đầy đủ, match bằng material_code
      const doId = doList[0]?.id
      if (!doId) return ok(res, await fetchGDOFull(req.params.id))

      const existingByCode = new Map<string, any>(
        (existingItems ?? []).map((i: any) => [i.material_code_raw as string, i])
      )
      const newCodes = new Set(items.map(i => i.material_code))

      // Kiểm tra xóa item có scan
      for (const [code, ex] of existingByCode) {
        if (!newCodes.has(code) && Number(ex.cartons_scanned) > 0) {
          return fail(res, `Không thể xóa mã hàng "${code}" đã xuất ${ex.cartons_scanned} thùng`, 400)
        }
      }

      // Kiểm tra số thùng < đã xuất
      for (const item of items) {
        const ex = existingByCode.get(item.material_code)
        if (ex && item.cartons_ordered < Number(ex.cartons_scanned)) {
          return fail(res, `Số thùng "${item.material_code}" (${item.cartons_ordered}) nhỏ hơn đã xuất (${ex.cartons_scanned})`, 400)
        }
      }

      // Xóa items bị loại bỏ
      const toDeleteIds = (existingItems ?? [])
        .filter((i: any) => !newCodes.has(i.material_code_raw as string))
        .map((i: any) => i.id as string)
      if (toDeleteIds.length) {
        await supabase.from('OutboundItem').delete().in('id', toDeleteIds)
      }

      // Load material cho items mới
      const newCodes2 = items.filter(i => !existingByCode.has(i.material_code)).map(i => i.material_code)
      let matMap = new Map<string, { id: string; category: string | null }>()
      if (newCodes2.length) {
        const { data: mats } = await supabase.from('Material')
          .select('id, material_code, category').in('material_code', newCodes2)
        matMap = new Map((mats ?? []).map((m: any) => [m.material_code as string, { id: m.id, category: m.category }]))
      }

      // Phân loại update / insert, thực thi song song
      const toUpdate: { id: string; fields: Record<string, unknown> }[] = []
      const toInsert: Record<string, unknown>[] = []
      for (const item of items) {
        const ex = existingByCode.get(item.material_code)
        if (ex) {
          const scanned = Number(ex.cartons_scanned)
          const newStatus = scanned >= item.cartons_ordered ? 'COMPLETED' : scanned > 0 ? 'IN_PROGRESS' : 'PENDING'
          toUpdate.push({ id: ex.id, fields: { cartons_ordered: item.cartons_ordered, loose_picking: item.loose_picking ?? 0, header_text: item.header_text?.trim() || null, batch_required: item.batch_required?.trim() || null, date_required: item.date_required || null, cs_responsible: item.cs_responsible?.trim() || null, export_type: export_type ?? null, status: newStatus, updated_at: t } })
        } else {
          const matInfo = matMap.get(item.material_code)
          const material_type = matInfo?.category ?? null
          toInsert.push({ id: randomUUID(), do_id: doId, material_id: matInfo?.id ?? null, material_code_raw: item.material_code, cartons_ordered: item.cartons_ordered, boxes_display: 0, weight: null, pallets_estimated: 0, loose_picking: item.loose_picking ?? 0, header_text: item.header_text?.trim() || null, batch_required: item.batch_required?.trim() || null, date_required: item.date_required || null, cs_responsible: item.cs_responsible?.trim() || null, material_type, export_type: export_type ?? null, cartons_scanned: 0, status: 'PENDING', updated_at: t })
        }
      }
      await Promise.all([
        ...toUpdate.map(({ id, fields }) => supabase.from('OutboundItem').update(fields).eq('id', id)),
        ...(toInsert.length ? [supabase.from('OutboundItem').insert(toInsert)] : []),
      ])
    }

    return ok(res, await fetchGDOFull(req.params.id))
  } catch (e) { return fail(res, String(e)) }
}

// ─── Patch GDO (delivery_date / status / misc fields) ────────

export async function patchGDO(req: Request, res: Response) {
  try {
    if (!(await guardGdoScope(req, res, req.params.id))) return
    const { delivery_date, status } = req.body as { delivery_date?: string; status?: string }

    // Bóc tách quyền theo NỘI DUNG thay đổi (route nhận anyOf(edit, complete)):
    // - status=COMPLETED (nút "Hoàn thành chuyến") → outbound.complete — trước đây đi ké `edit`
    //   khiến người có edit hoàn thành được chuyến dù không được cấp quyền Hoàn thành.
    // - Thay đổi khác (đổi ngày giao, PAUSED/IN_PROGRESS) → outbound.edit.
    if (req.user?.name !== 'Admin') {
      const p = req.user?.module_permissions ?? {}
      const wantsComplete = status === 'COMPLETED'
      const changesOther = delivery_date !== undefined || (status !== undefined && status !== 'COMPLETED')
      if (wantsComplete && !p['outbound']?.includes('complete'))
        return fail(res, 'Bạn không có quyền Hoàn thành chuyến', 403)
      if (changesOther && !p['outbound']?.includes('edit'))
        return fail(res, 'Bạn không có quyền Sửa đơn', 403)
    }

    // PAUSED: chỉ cho đổi status (ví dụ resume → IN_PROGRESS), không sửa dữ liệu khác
    if (delivery_date) {
      const { data: current } = await supabase.from('GroupDeliveryOrder')
        .select('status').eq('id', req.params.id).single()
      if (current?.status === 'PAUSED')
        return fail(res, 'Chuyến đang tạm dừng — chỉ được đổi trạng thái, không sửa dữ liệu', 400)
    }

    // Gác hoàn thành: thực quét phải KHỚP kế hoạch — mọi item cartons_scanned >= cartons_ordered.
    // Xuất thiếu (hết tồn/NPP giao thiếu) → sửa SL đơn xuống = thực xuất rồi mới hoàn thành.
    if (status === 'COMPLETED') {
      const { data: dos } = await supabase.from('OutboundDelivery')
        .select('id').eq('gdo_id', req.params.id)
      const doIds = ((dos ?? []) as { id: string }[]).map(d => d.id)
      if (doIds.length) {
        const { data: items } = await supabase.from('OutboundItem')
          .select('material_code_raw, cartons_ordered, cartons_scanned').in('do_id', doIds)
        const short = ((items ?? []) as { material_code_raw: string | null; cartons_ordered: number; cartons_scanned: number }[])
          .filter(i => Number(i.cartons_scanned) < Number(i.cartons_ordered))
        if (short.length) {
          const e = short[0]
          return fail(res, `Chưa thể hoàn thành — còn ${short.length} mã chưa xuất đủ kế hoạch (vd ${e.material_code_raw ?? '?'}: ${Number(e.cartons_scanned)}/${Number(e.cartons_ordered)}). Sửa số lượng đơn xuống bằng thực xuất rồi hoàn thành.`, 400)
        }
      }
    }

    const t = now()
    const patch: Record<string, unknown> = { updated_at: t }
    if (delivery_date !== undefined) patch.delivery_date = delivery_date
    if (status !== undefined) {
      patch.status = status
      if (status === 'COMPLETED') patch.completed_at = t
    }

    // CAS khi hoàn thành: chỉ winner đầu (status chưa COMPLETED) mới đổi → cascade
    // maybeAutoCreateTransferOrder (tạo TmsOrder chuyển kho) chạy ĐÚNG 1 lần, không tạo trùng.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let upd = supabase.from('GroupDeliveryOrder').update(patch).eq('id', req.params.id)
    if (status === 'COMPLETED') upd = upd.neq('status', 'COMPLETED')
    const { data: updRows, error } = await upd.select('id')
    if (error) return fail(res, error.message)

    if (status === 'COMPLETED' && (updRows?.length ?? 0) > 0) await maybeAutoCreateTransferOrder(req.params.id, t)

    const result = await fetchGDOFull(req.params.id)
    return ok(res, result)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Assign GDO (Giao đơn) ────────────────────────────────────

export async function assignGDO(req: Request, res: Response) {
  try {
    if (!(await guardGdoScope(req, res, req.params.id))) return
    const { assigned_by } = req.body as { assigned_by?: string }
    const { error } = await supabase.from('GroupDeliveryOrder')
      .update({ assigned_at: now(), assigned_by: assigned_by ?? null, updated_at: now() })
      .eq('id', req.params.id)
    if (error) return fail(res, error.message)
    const result = await fetchGDOFull(req.params.id)
    return ok(res, result)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Unassign GDO (Gỡ giao đơn) ──────────────────────────────

export async function unassignGDO(req: Request, res: Response) {
  try {
    if (!(await guardGdoScope(req, res, req.params.id))) return
    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select('assigned_at, started_at').eq('id', req.params.id).single()
    if (!gdo?.assigned_at) return fail(res, 'Đơn chưa được giao đơn', 400)
    if (gdo?.started_at)   return fail(res, 'Cần gỡ bắt đầu trước khi gỡ giao đơn', 400)
    const { error } = await supabase.from('GroupDeliveryOrder')
      .update({ assigned_at: null, assigned_by: null, status: 'PENDING', updated_at: now() })
      .eq('id', req.params.id)
    if (error) return fail(res, error.message)
    return ok(res, await fetchGDOFull(req.params.id))
  } catch (e) { return fail(res, String(e)) }
}

// ─── Start GDO (Bắt đầu xuất kho) ────────────────────────────

export async function startGDO(req: Request, res: Response) {
  try {
    const {
      license_plate, container_number, exporter_name,
      loader_name, forklift_driver_id, forklift_driver_names,
      gate_registration_id, allow_shared_gate,
    } = req.body as {
      license_plate?: string; container_number?: string; exporter_name?: string
      loader_name?: string; forklift_driver_id?: string; forklift_driver_names?: string
      gate_registration_id?: string | null; allow_shared_gate?: boolean
    }
    if (!license_plate) return fail(res, 'Biển số xe là bắt buộc', 400)
    if (!(await guardGdoScope(req, res, req.params.id))) return

    // Khóa cứng 1 chuyến = 1 phiếu: nếu chuyến cổng đã gắn GDO khác → chặn, trừ khi user xác nhận đặc biệt (bốc thêm đơn cùng chuyến)
    if (gate_registration_id && !allow_shared_gate) {
      const { data: taken } = await supabase.from('GroupDeliveryOrder')
        .select('id, group_code')
        .eq('gate_registration_id', gate_registration_id)
        .neq('id', req.params.id)
        .limit(1)
      if (taken && taken.length > 0) {
        return fail(res, `Chuyến này đã gắn phiếu ${taken[0].group_code ?? ''} — tích "Trường hợp đặc biệt" nếu xe bốc thêm đơn cùng chuyến`, 409)
      }
    }

    const { error } = await supabase.from('GroupDeliveryOrder')
      .update({
        started_at: now(),
        license_plate,
        container_number:       container_number       ?? null,
        exporter_name:          exporter_name          ?? null,
        loader_name:            loader_name            ?? null,
        forklift_driver_id:     forklift_driver_id     ?? null,
        forklift_driver_names:  forklift_driver_names  ?? null,
        gate_registration_id:   gate_registration_id   ?? null,
        status:     'IN_PROGRESS',
        updated_at: now(),
      })
      .eq('id', req.params.id)
    if (error) return fail(res, error.message)
    const result = await fetchGDOFull(req.params.id)
    return ok(res, result)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Update transport info (Sửa thông tin xe) ────────────────

export async function updateTransport(req: Request, res: Response) {
  try {
    const {
      license_plate, container_number, exporter_name,
      loader_name, forklift_driver_id, forklift_driver_names,
      gate_registration_id, allow_shared_gate,
    } = req.body as {
      license_plate?: string; container_number?: string; exporter_name?: string
      loader_name?: string; forklift_driver_id?: string; forklift_driver_names?: string
      gate_registration_id?: string | null; allow_shared_gate?: boolean
    }
    if (!license_plate?.trim()) return fail(res, 'Biển số xe là bắt buộc', 400)
    if (!(await guardGdoScope(req, res, req.params.id))) return

    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select('started_at').eq('id', req.params.id).single()
    if (!gdo?.started_at) return fail(res, 'Chuyến chưa được bắt đầu', 400)

    // Khóa cứng 1 chuyến = 1 phiếu (như startGDO): chuyến đã gắn GDO khác → chặn, trừ khi xác nhận đặc biệt
    if (gate_registration_id && !allow_shared_gate) {
      const { data: taken } = await supabase.from('GroupDeliveryOrder')
        .select('id, group_code')
        .eq('gate_registration_id', gate_registration_id)
        .neq('id', req.params.id)
        .limit(1)
      if (taken && taken.length > 0) {
        return fail(res, `Chuyến này đã gắn phiếu ${taken[0].group_code ?? ''} — tích "Trường hợp đặc biệt" nếu xe bốc thêm đơn cùng chuyến`, 409)
      }
    }

    const { error } = await supabase.from('GroupDeliveryOrder')
      .update({
        license_plate:         license_plate.trim(),
        container_number:      container_number?.trim()      || null,
        exporter_name:         exporter_name?.trim()         || null,
        loader_name:           loader_name?.trim()           || null,
        forklift_driver_id:    forklift_driver_id            || null,
        forklift_driver_names: forklift_driver_names?.trim() || null,
        gate_registration_id:  gate_registration_id          ?? null,
        updated_at: now(),
      })
      .eq('id', req.params.id)
    if (error) return fail(res, error.message)
    return ok(res, await fetchGDOFull(req.params.id))
  } catch (e) { return fail(res, String(e)) }
}

// ─── Unstart GDO (Gỡ bắt đầu) ────────────────────────────────

export async function unstartGDO(req: Request, res: Response) {
  try {
    if (!(await guardGdoScope(req, res, req.params.id))) return
    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select('started_at, warehouse:Warehouse(inventory_mode)').eq('id', req.params.id).single()
    if (!gdo?.started_at) return fail(res, 'Đơn chưa được bắt đầu', 400)
    const gdoMode = (gdo as unknown as { warehouse?: { inventory_mode?: string | null } | null }).warehouse?.inventory_mode

    // Kiểm tra chưa có QR nào được quét (bỏ qua POSM/Pallet Loscam và nhặt lẻ chưa confirm)
    const { data: doList } = await supabase.from('OutboundDelivery')
      .select('id').eq('gdo_id', req.params.id)
    const doIds = (doList ?? []).map((d: any) => d.id)
    if (doIds.length) {
      const { data: items } = await supabase.from('OutboundItem')
        .select('id, material_type, material_code_raw, material_id, material:Material!material_id(no_qr_tracking)').in('do_id', doIds)
      markItemsNoQrIfQty((items ?? []) as unknown as Parameters<typeof markItemsNoQrIfQty>[0], gdoMode)  // kho QTY → mọi item no-QR, không có QR để chặn gỡ bắt đầu
      // Chỉ kiểm tra item có thể scan thực sự (bỏ POSM, Pallet Loscam, 810000)
      const blockableIds = (items ?? [])
        .filter((i: any) => !isExcludedFromCount(i))
        .map((i: any) => i.id as string)
      if (blockableIds.length) {
        // Chỉ đếm scan entries thực sự (không phải nhặt lẻ chưa confirm)
        const { count } = await supabase.from('OutboundScanEntry')
          .select('id', { count: 'exact', head: true })
          .in('item_id', blockableIds)
          .or('is_loose_picking.eq.false,is_loose_picking.is.null,loose_confirmed.eq.true')
        if ((count ?? 0) > 0)
          return fail(res, 'Cần xóa hết QR đã quét trước khi gỡ bắt đầu', 400)
      }
    }

    const t = now()
    const { error } = await supabase.from('GroupDeliveryOrder')
      .update({
        started_at: null, license_plate: null, container_number: null,
        exporter_name: null, loader_name: null,
        forklift_driver_id: null, forklift_driver_names: null,
        status: 'PENDING', updated_at: t,
      })
      .eq('id', req.params.id)
    if (error) return fail(res, error.message)
    return ok(res, await fetchGDOFull(req.params.id))
  } catch (e) { return fail(res, String(e)) }
}

// ─── Uncomplete GDO (Bỏ hoàn thành) ──────────────────────────

export async function uncompleteGDO(req: Request, res: Response) {
  try {
    if (!(await guardGdoScope(req, res, req.params.id))) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select('status, transfer_status').eq('id', req.params.id).single()
    if (gdo?.status !== 'COMPLETED') return fail(res, 'Đơn chưa hoàn thành', 400)

    const ts = gdo.transfer_status as string | null

    if (ts === 'DELIVERED')
      return fail(res, 400, 'TRANSFER_DELIVERED', 'Kho NPP đã hoàn thành nhận hàng — không thể bỏ hoàn thành')

    if (ts === 'RECEIVING') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: openImports } = await supabase.from('ProductionImport')
        .select('import_code').eq('from_gdo_id', req.params.id).neq('status', 'CANCELLED')
      const codes = (openImports ?? []).map((r: { import_code: string }) => r.import_code).join(', ')
      return fail(res, 400, 'INBOUND_OPEN', `Kho NPP đã tạo phiếu nhập (${codes}) — hủy phiếu trước khi bỏ hoàn thành`)
    }

    if (ts === 'IN_TRANSIT') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: tmsOrder } = await supabase.from('TmsOrder')
        .select('id').eq('transfer_gdo_id', req.params.id).maybeSingle()
      if (tmsOrder) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('inbound_plan_lines').delete().eq('tms_order_id', tmsOrder.id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('TmsVehicleSlot').delete().eq('order_id', tmsOrder.id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('TmsOrder').delete().eq('id', tmsOrder.id)
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('GroupDeliveryOrder')
      .update({ status: 'IN_PROGRESS', completed_at: null, scan_completed_at: null, transfer_status: null, updated_at: now() })
      .eq('id', req.params.id)
    if (error) return fail(res, error.message)
    return ok(res, await fetchGDOFull(req.params.id))
  } catch (e) { return fail(res, String(e)) }
}

// ─── Get warehouse employees (for forklift driver dropdown) ──

export async function getWarehouseEmployees(req: Request, res: Response) {
  try {
    const { warehouse_id } = req.query as Record<string, string>
    // Phân trang đủ (cap ~1000/response — nhân sự có thể >1000)
    const data = await fetchAllRowsParallel(() => {
      let q = supabase.from('Employee')
        .select('id, name, employee_code, job_title_id')
        .eq('is_active', true)
        .order('name').order('id')
      if (warehouse_id) q = q.eq('warehouse_id', warehouse_id)
      return q
    })
    const emps = data as { id: string; name: string; employee_code: string; job_title_id: string | null }[]
    // Kèm tên chức danh (để FE lọc "lái xe nâng" theo chức danh)
    const jtIds = [...new Set(emps.map(e => e.job_title_id).filter(Boolean))] as string[]
    const { data: jts } = jtIds.length
      ? await supabase.from('JobTitle').select('id, name').in('id', jtIds)
      : { data: [] as { id: string; name: string }[] }
    const jtMap = new Map((jts ?? []).map((j: { id: string; name: string }) => [j.id, j.name]))
    const result = emps.map(e => ({
      id: e.id, name: e.name, employee_code: e.employee_code,
      job_title: e.job_title_id ? jtMap.get(e.job_title_id) ?? null : null,
    }))
    return ok(res, result)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Merge upload for PAUSED GDO ─────────────────────────────

// Gộp các dòng CÙNG MÃ HÀNG trong 1 NPP (file SAP tách theo DO): cộng dồn số lượng,
// field chữ lấy giá trị đầu tiên không rỗng. Sau gộp: 1 mã hàng chỉ còn 1 dòng / NPP.
function mergeNppRows(rows: Record<string, any>[]): Record<string, any>[] {
  const byMat = new Map<string, Record<string, any>>()
  for (const row of rows) {
    const code = String(row['Material'] ?? '').trim()
    const cur = byMat.get(code)
    if (!cur) { byMat.set(code, { ...row }); continue }
    for (const f of ['Thùng', 'Hộp', 'Tải', 'Nhặt lẻ']) cur[f] = parseDecimal(cur[f]) + parseDecimal(row[f])
    cur['Pallet'] = parseDecimal(String(cur['Pallet'] ?? '').replace(',', '.')) + parseDecimal(String(row['Pallet'] ?? '').replace(',', '.'))
    for (const f of ['Material_type', 'Loại xuất', 'HEADER TEXT', 'Batch_Yêu cầu', '%Date_Yêu cầu', 'CS phụ trách'])
      if (!String(cur[f] ?? '').trim()) cur[f] = row[f]
  }
  return [...byMat.values()]
}

// Khớp theo NPP + mã hàng (chuẩn nghiệp vụ 04/07) — DO chỉ là tham khảo.
// Giả định sau script gộp: mỗi GDO có đúng 1 DO / NPP (legacy nhiều DO cùng NPP → DO đầu là canonical, item được re-point).
async function mergePausedGDO(
  gdoId: string,
  group_code: string,
  delivery_date: string,
  planned_date: string,
  warehouse_id: string | null,
  dvvt: string | null,
  warehouse_type: string | null,
  byNpp: Map<string, Record<string, any>[]>,
  matMap: Map<string, string>
): Promise<{ group_code: string; id?: string; merged?: boolean; skipped?: boolean; reason?: string }> {
  const t = now()

  const { data: existingDOs } = await supabase.from('OutboundDelivery')
    .select('id, delivery_code, distributor_name').eq('gdo_id', gdoId)

  const existingDoIds = (existingDOs ?? []).map((d: any) => d.id as string)
  const { data: existingItems } = existingDoIds.length
    ? await supabase.from('OutboundItem')
        .select('id, do_id, material_code_raw, cartons_scanned').in('do_id', existingDoIds)
    : { data: [] }

  const nppOf = (d: any) => String(d.distributor_name ?? '').trim()
  const existingDOByNpp = new Map<string, any>()
  for (const d of (existingDOs ?? [])) if (!existingDOByNpp.has(nppOf(d))) existingDOByNpp.set(nppOf(d), d)
  const doIdToNpp = new Map<string, string>((existingDOs ?? []).map((d: any) => [d.id as string, nppOf(d)]))

  // item cũ theo (npp, mã hàng) — có scan ưu tiên giữ
  const existingItemByNppMat = new Map<string, any>()
  for (const i of (existingItems ?? [])) {
    const k = `${doIdToNpp.get(i.do_id) ?? ''}::${i.material_code_raw ?? ''}`
    const cur = existingItemByNppMat.get(k)
    if (!cur || Number(i.cartons_scanned) > Number(cur.cartons_scanned)) existingItemByNppMat.set(k, i)
  }

  // File mới: gộp dòng cùng mã trong NPP rồi build set npp::mã
  const mergedByNpp = new Map<string, Record<string, any>[]>()
  const newFileItemKeys = new Set<string>()
  for (const [npp, rows] of byNpp) {
    const merged = mergeNppRows(rows)
    mergedByNpp.set(npp, merged)
    for (const row of merged) newFileItemKeys.add(`${npp}::${String(row['Material'] ?? '').trim()}`)
  }
  const newNpps = new Set([...byNpp.keys()])

  // Validation 1: hàng ĐÃ XUẤT phải còn trong file mới (không được bỏ hàng đã xuất)
  const scannedItems = (existingItems ?? []).filter((i: any) => Number(i.cartons_scanned) > 0)
  const missingScanned: string[] = []
  for (const item of scannedItems) {
    const npp = doIdToNpp.get(item.do_id) ?? ''
    if (!newFileItemKeys.has(`${npp}::${item.material_code_raw ?? ''}`)) {
      missingScanned.push(`${item.material_code_raw} (NPP ${npp || '—'}, đã xuất ${item.cartons_scanned} thùng)`)
    }
  }
  if (missingScanned.length) {
    return {
      group_code, skipped: true,
      reason: `Mã hàng đã xuất không có trong file mới: ${missingScanned.join('; ')}`,
    }
  }

  // Validation 2: số thùng mới >= đã xuất — gom đủ lỗi trước khi chặn
  const cartonErrors: string[] = []
  for (const [npp, mergedRows] of mergedByNpp) {
    for (const row of mergedRows) {
      const mat_code   = String(row['Material'] ?? '').trim()
      const newCartons = parseDecimal(row['Thùng'])
      const existing   = existingItemByNppMat.get(`${npp}::${mat_code}`)
      if (existing && newCartons < Number(existing.cartons_scanned)) {
        cartonErrors.push(`${mat_code} (mới ${newCartons} < đã xuất ${existing.cartons_scanned})`)
      }
    }
  }
  if (cartonErrors.length) {
    return {
      group_code, skipped: true,
      reason: `Số thùng mới nhỏ hơn đã xuất: ${cartonErrors.join(', ')}`,
    }
  }

  // Cleanup: xóa item cũ không còn trong file (đều chưa xuất — đã chặn ở Validation 1)
  const staleItemIds = (existingItems ?? [])
    .filter((i: any) => !newFileItemKeys.has(`${doIdToNpp.get(i.do_id) ?? ''}::${i.material_code_raw ?? ''}`))
    .map((i: any) => i.id as string)
  if (staleItemIds.length) {
    await supabase.from('OutboundItem').delete().in('id', staleItemIds)
  }

  // Update GDO header — preserve workflow fields (started_at, assigned_at, status, license_plate, etc.)
  await supabase.from('GroupDeliveryOrder')
    .update({ delivery_date, planned_date, warehouse_id, dvvt, warehouse_type, updated_at: t })
    .eq('id', gdoId)

  // Upsert DO (1/NPP) + items — item cũ được re-point về DO canonical (do_id trong fields)
  for (const [npp, mergedRows] of mergedByNpp) {
    const deliveryRefs = [...new Set((byNpp.get(npp) ?? []).map(r => String(r['Delivery'] ?? '').trim()).filter(Boolean))].join(', ') || null
    const existingDO = existingDOByNpp.get(npp)
    let doId: string

    if (existingDO) {
      doId = existingDO.id as string
      await supabase.from('OutboundDelivery').update({ distributor_name: npp || null, delivery_code: deliveryRefs, updated_at: t }).eq('id', doId)
    } else {
      doId = randomUUID()
      await supabase.from('OutboundDelivery').insert({
        id: doId, gdo_id: gdoId, delivery_code: deliveryRefs, distributor_name: npp || null, status: 'PENDING', updated_at: t,
      })
    }

    for (const row of mergedRows) {
      const mat_code      = String(row['Material'] ?? '').trim()
      const material_type = String(row['Material_type'] ?? '').trim() || null
      const newCartons    = parseDecimal(row['Thùng'])
      const fields = {
        do_id:             doId,
        material_id:       matMap.get(mat_code) ?? null,
        material_code_raw: mat_code,
        cartons_ordered:   newCartons,
        boxes_display:     parseDecimal(row['Hộp']),
        weight:            parseDecimal(row['Tải']),
        loose_picking:     parseDecimal(row['Nhặt lẻ']),
        pallets_estimated: parseDecimal(String(row['Pallet'] ?? '').replace(',', '.')),
        material_type,
        export_type:    String(row['Loại xuất']     ?? '').trim() || null,
        header_text:    String(row['HEADER TEXT']   ?? '').trim() || null,
        batch_required: String(row['Batch_Yêu cầu'] ?? '').trim() || null,
        date_required:  parseDecimal(row['%Date_Yêu cầu']) || null,
        cs_responsible: String(row['CS phụ trách']  ?? '').trim() || null,
        updated_at: t,
      }

      const existing = existingItemByNppMat.get(`${npp}::${mat_code}`)
      if (existing) {
        const scanned   = Number(existing.cartons_scanned)
        const newStatus = scanned >= newCartons ? 'COMPLETED'
          : scanned > 0 ? 'IN_PROGRESS'
          : 'PENDING'
        await supabase.from('OutboundItem').update({ ...fields, status: newStatus }).eq('id', existing.id)
      } else {
        await supabase.from('OutboundItem').insert({
          id: randomUUID(), ...fields,
          cartons_scanned: 0,
          status: 'PENDING',
        })
      }
    }
  }

  // Cleanup DO thừa SAU khi item đã re-point: NPP không còn trong file, hoặc DO dư cùng NPP (legacy)
  const staleDOIds = (existingDOs ?? [])
    .filter((d: any) => {
      const npp = nppOf(d)
      return !newNpps.has(npp) || existingDOByNpp.get(npp)?.id !== d.id
    })
    .map((d: any) => d.id as string)
  if (staleDOIds.length) {
    await supabase.from('OutboundDelivery').delete().in('id', staleDOIds)
  }

  return { group_code, id: gdoId, merged: true }
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

    // Pre-load warehouses, materials, warehouse types, and existing GDOs in parallel
    const allGroupCodes = [...byVehicle.keys()]
    const [warehousesRes, whTypesRes, vehicleTypesRes, existingRes, allMaterials] = await Promise.all([
      supabase.from('Warehouse').select('id, code, name').eq('is_active', true),
      // LookupValue KHÔNG có cột is_active — lọc theo nó làm query lỗi → validWhTypes rỗng → chặn oan mọi file
      supabase.from('LookupValue').select('value').eq('type', 'warehouse_type'),
      supabase.from('VehicleType').select('code, name').eq('is_active', true),
      supabase.from('GroupDeliveryOrder')
        .select('id, group_code, status, assigned_at, assigned_by, shipto_party')
        .in('group_code', allGroupCodes),
      // PHÂN TRANG: >1000 mã → nếu không phân trang bị cap 1000 → mã ngoài 1000 bị báo oan "chưa có trong hệ thống"
      fetchAllRowsParallel(() => supabase.from('Material').select('id, material_code')) as Promise<{ id: string; material_code: string }[]>,
    ])

    const warehouseByKey = new Map<string, string>()
    for (const w of (warehousesRes.data ?? []) as { id: string; code: string; name: string }[]) {
      warehouseByKey.set(w.code.trim().toLowerCase(), w.id)
      warehouseByKey.set(w.name.trim().toLowerCase(), w.id)
    }
    const matMap = new Map<string, string>(
      allMaterials.map(m => [String(m.material_code).trim(), m.id])
    )
    const validWhTypes = new Set<string>(
      (whTypesRes.data ?? []).map((t: any) => String(t.value).trim())
    )
    // Resolver Loại xuất theo danh mục Loại xe TMS: khớp tên HOẶC mã, bỏ dấu + hoa/thường (như FE)
    const normVt = (s: string) => s.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().trim()
    const vtByKey = new Map<string, string>()   // key chuẩn hoá → TÊN chính tắc
    for (const v of ((vehicleTypesRes.data ?? []) as { code: string | null; name: string }[])) {
      const nm = String(v.name).trim()
      vtByKey.set(normVt(nm), nm)
      if (v.code) vtByKey.set(normVt(String(v.code)), nm)
    }
    const resolveVehicleType = (raw: string): string | null => vtByKey.get(normVt(raw)) ?? null

    // Classify existing GDOs
    // pendingSimpleMap   : PENDING, no assignment → delete+recreate GDO
    // pendingPreserveMap : PENDING, has assignment → keep GDO row, replace DOs/Items
    // pausedGDOMap       : PAUSED → merge (strict validation)
    // blockedMap         : IN_PROGRESS / COMPLETED → skip
    const pendingSimpleMap   = new Map<string, string>()
    const pendingPreserveMap = new Map<string, string>() // group_code → id
    const pausedGDOMap       = new Map<string, string>()
    const blockedMap         = new Map<string, string>() // group_code → status
    // Ship-to đã gán tay trên đơn PENDING — mang theo khi upload đè (xóa+tạo lại), không để mất âm thầm
    const shiptoByGroupCode  = new Map<string, string>()

    for (const g of (existingRes.data ?? [])) {
      if (g.shipto_party) shiptoByGroupCode.set(g.group_code as string, g.shipto_party as string)
      if (g.status === 'PENDING') {
        if (g.assigned_at) pendingPreserveMap.set(g.group_code as string, g.id)
        else               pendingSimpleMap.set(g.group_code as string, g.id)
      } else if (g.status === 'PAUSED') {
        pausedGDOMap.set(g.group_code as string, g.id)
      } else {
        blockedMap.set(g.group_code as string, g.status)
      }
    }

    // ── Phase 1: pre-validate ALL vehicles, block entire upload on any error ──

    const resolveDvvt = await buildDvvtResolver()
    const validationErrors: { group_code: string; errors: string[] }[] = []

    for (const [group_code, groupRows] of byVehicle) {
      const errs: string[] = []

      const fmtErr = validateGroupCode(group_code)
      if (fmtErr) errs.push(fmtErr)

      if (!parseExcelDate(groupRows[0]['Ngày xuất']))
        errs.push(`Ngày xuất không hợp lệ: "${groupRows[0]['Ngày xuất'] ?? ''}"`)

      const kho_xuat_v = String(groupRows[0]['Kho xuất'] ?? groupRows[0]['Kho xuat'] ?? '').trim()
      if (kho_xuat_v && !warehouseByKey.has(kho_xuat_v.toLowerCase()))
        errs.push(`Kho xuất "${kho_xuat_v}" không có trong hệ thống`)
      else if (!kho_xuat_v && !warehouse_id)
        errs.push('Thiếu cột Kho xuất')
      else {
        // Scope: chặn upload tạo chuyến cho kho ngoài phạm vi user
        const resolvedWh = kho_xuat_v ? warehouseByKey.get(kho_xuat_v.toLowerCase()) ?? null : (warehouse_id ?? null)
        if (!inScope(req, resolvedWh)) errs.push(`Kho xuất "${kho_xuat_v || ''}" ngoài phạm vi của bạn`)
      }

      const loaiKhoVals = [...new Set(
        groupRows.map(r => String(r['Loại kho'] ?? r['Loai kho'] ?? '').trim()).filter(Boolean)
      )]
      const invalidWhTypes = loaiKhoVals.filter(v => !validWhTypes.has(v))
      if (loaiKhoVals.length === 0)
        errs.push('Thiếu cột Loại kho')
      else if (invalidWhTypes.length)
        errs.push(`Loại kho "${invalidWhTypes.join(', ')}" không có trong hệ thống`)

      const unknownMatsV = [...new Set(
        groupRows.filter(r => String(r['Material'] ?? '').trim()).map(r => String(r['Material']).trim())
      )].filter(c => !matMap.has(c))
      if (unknownMatsV.length) errs.push(`Mã hàng chưa có trong hệ thống: ${unknownMatsV.join(', ')}`)

      const dvvt_v = String(groupRows[0]['DVVT'] ?? groupRows[0]['Đơn vị'] ?? '').trim()
      if (dvvt_v && !resolveDvvt(dvvt_v).ok) errs.push(`ĐVVT "${dvvt_v}" không khớp danh mục (mã/alias/tên)`)

      if (groupRows.some(r => !String(r['Material'] ?? '').trim()))
        errs.push('Có dòng trống cột Material')

      // Loại xuất bắt buộc (Material_type KHÔNG bắt buộc — vd dòng Pallet Loscam để trống hợp lý)
      const dataRows = groupRows.filter(r => String(r['Material'] ?? '').trim())
      const missExport = dataRows.filter(r => !String(r['Loại xuất'] ?? '').trim()).length
      if (missExport) errs.push(`Thiếu Loại xuất ở ${missExport} dòng`)
      // Loại xuất PHẢI khớp danh mục Loại xe TMS (Material_type thì không khóa)
      const badExport = [...new Set(dataRows.map(r => String(r['Loại xuất'] ?? '').trim()).filter(Boolean))]
        .filter(v => !resolveVehicleType(v))
      if (badExport.length) errs.push(`Loại xuất "${badExport.join(', ')}" không khớp danh mục Loại xe TMS`)

      // Chuyến Đang xuất / Đã hoàn thành: KHÔNG chặn cả file (user chốt 04/07) — bỏ qua chuyến đó
      // ở Phase 2 + báo rõ trong kết quả; chỉ lỗi DỮ LIỆU thật mới chặn toàn file.

      if (errs.length) validationErrors.push({ group_code, errors: errs })
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_FAILED', message: `File có ${validationErrors.length} chuyến xe lỗi — không upload` },
        validation_errors: validationErrors,
      })
    }

    // Chuẩn hoá Loại xuất về TÊN chính tắc (vd "xe container" → "XE CONTAINER") — mọi giá trị đã validate khớp
    for (const [, groupRows] of byVehicle) {
      for (const r of groupRows) {
        const ev = String(r['Loại xuất'] ?? '').trim()
        if (ev) r['Loại xuất'] = resolveVehicleType(ev) ?? ev
      }
    }

    // ── Phase 2: build insert lists (all vehicles already validated) ──

    const created:  any[] = []
    const gdoInserts:  any[] = []
    const doInserts:   any[] = []
    const itemInserts: any[] = []
    const toReplaceIds:   string[] = []
    const toPreserveIds:  string[] = []
    const preserveGDOUpdates: { id: string; fields: Record<string, unknown> }[] = []

    for (const [group_code, groupRows] of byVehicle) {
      // Chuyến Đang xuất / Đã hoàn thành → bỏ qua (không ghi đè), up các chuyến còn lại
      if (blockedMap.has(group_code)) {
        created.push({
          group_code, skipped: true,
          reason: blockedMap.get(group_code) === 'COMPLETED'
            ? 'Đã hoàn thành — bỏ qua, không ghi đè'
            : 'Đang xuất — bỏ qua, không ghi đè',
        })
        continue
      }

      const delivery_date = parseExcelDate(groupRows[0]['Ngày xuất'])!
      const planned_date  = parsePlannedDate(group_code)!

      const dvvt     = resolveDvvt(String(groupRows[0]['DVVT'] ?? groupRows[0]['Đơn vị'] ?? '')).name
      const kho_xuat = String(groupRows[0]['Kho xuất'] ?? groupRows[0]['Kho xuat'] ?? '').trim()
      const loaiKhoSet = [...new Set(groupRows.map(r => String(r['Loại kho'] ?? r['Loai kho'] ?? '').trim()).filter(Boolean))]
      const loai_kho = loaiKhoSet.length ? loaiKhoSet.join('+') : null

      const resolved_warehouse_id = kho_xuat
        ? warehouseByKey.get(kho_xuat.toLowerCase())!
        : (warehouse_id ?? null)

      // Gom theo TÊN NPP (chuẩn nghiệp vụ chốt 04/07): NPP mới là chìa khóa tách dòng trong 1 chuyến;
      // DO/Delivery chỉ là THAM KHẢO từ SAP — lưu nối chuỗi vào delivery_code, không có vai trò khác.
      const byNpp = new Map<string, Record<string, any>[]>()
      for (const row of groupRows) {
        const npp = String(row['Tên NPP'] ?? '').trim()
        const list = byNpp.get(npp) ?? []
        list.push(row)
        byNpp.set(npp, list)
      }

      // Ship-to = giá trị GỐC từ cột "Shipto party" của file (verbatim) — KHÔNG suy từ Tên NPP,
      // KHÔNG chặn/lọc theo kho (SAP điền mã ship-to mọi khách hàng; lưu nguyên để hiển thị).
      // Chuyển kho (Kế hoạch VC) tự lọc kho QR/QTY khi Hoàn thành. File không có → giữ ship-to đã gán tay.
      const shiptoColVals = [...new Set(groupRows.map(r => String(r['Shipto party'] ?? r['Shipto_party'] ?? '').trim()).filter(Boolean))]
      const resolvedShipto = shiptoColVals[0] ?? shiptoByGroupCode.get(group_code) ?? null

      // PAUSED → merge (strict: scanned items must all exist in new file)
      if (pausedGDOMap.has(group_code)) {
        const mergeResult = await mergePausedGDO(
          pausedGDOMap.get(group_code)!,
          group_code, delivery_date, planned_date,
          resolved_warehouse_id, dvvt, loai_kho,
          byNpp, matMap
        )
        if (resolvedShipto) {
          await supabase.from('GroupDeliveryOrder')
            .update({ shipto_party: resolvedShipto, updated_at: now() })
            .eq('id', pausedGDOMap.get(group_code)!)
        }
        created.push(mergeResult)
        continue
      }

      // Helper: build DO + Item rows for a given gdoId — 1 DO / NPP; delivery_code = các mã Delivery nối ', ' (tham khảo)
      const collectDOsAndItems = (gdoId: string) => {
        for (const [npp, nppRows] of byNpp) {
          const doId = randomUUID()
          const deliveryRefs = [...new Set(nppRows.map(r => String(r['Delivery'] ?? '').trim()).filter(Boolean))].join(', ') || null
          doInserts.push({ id: doId, gdo_id: gdoId, delivery_code: deliveryRefs, distributor_name: npp || null, status: 'PENDING', updated_at: now() })
          for (const row of mergeNppRows(nppRows)) {
            const mat_code      = String(row['Material'] ?? '').trim()
            const material_type = String(row['Material_type'] ?? '').trim() || null
            itemInserts.push({
              id: randomUUID(), do_id: doId,
              material_id:       matMap.get(mat_code) ?? null,
              material_code_raw: mat_code,
              cartons_ordered:   parseDecimal(row['Thùng']),
              boxes_display:     parseDecimal(row['Hộp']),
              weight:            parseDecimal(row['Tải']),
              loose_picking:     parseDecimal(row['Nhặt lẻ']),
              pallets_estimated: parseDecimal(String(row['Pallet'] ?? '').replace(',', '.')),
              material_type,
              export_type:    String(row['Loại xuất']     ?? '').trim() || null,
              header_text:    String(row['HEADER TEXT']   ?? '').trim() || null,
              batch_required: String(row['Batch_Yêu cầu'] ?? '').trim() || null,
              date_required:  parseDecimal(row['%Date_Yêu cầu']) || null,
              cs_responsible: String(row['CS phụ trách']  ?? '').trim() || null,
              cartons_scanned: 0,
              status: 'PENDING',
              updated_at: now(),
            })
          }
        }
      }

      // PENDING with assignment → keep GDO row + assigned_at, replace DOs/Items
      if (pendingPreserveMap.has(group_code)) {
        const gdoId = pendingPreserveMap.get(group_code)!
        toPreserveIds.push(gdoId)
        preserveGDOUpdates.push({
          id: gdoId,
          fields: { delivery_date, planned_date, warehouse_id: resolved_warehouse_id, dvvt, warehouse_type: loai_kho, shipto_party: resolvedShipto, updated_at: now() },
        })
        collectDOsAndItems(gdoId)
        created.push({ group_code, id: gdoId, created: true, preserved_assignment: true })
        continue
      }

      // PENDING (no assignment) or new → create fresh GDO
      if (pendingSimpleMap.has(group_code)) {
        toReplaceIds.push(pendingSimpleMap.get(group_code)!)
      }
      const gdoId = randomUUID()
      const actor = req.user?.name || null
      gdoInserts.push({
        id: gdoId, group_code, planned_date, delivery_date,
        warehouse_id: resolved_warehouse_id, dvvt, warehouse_type: loai_kho,
        shipto_party: resolvedShipto,   // cột > khớp Tên NPP > ship-to đã gán tay (upload đè không làm mất)
        status: 'PENDING', created_by: actor, updated_by: actor, updated_at: now(),
      })
      collectDOsAndItems(gdoId)
      created.push({ group_code, id: gdoId, created: true })
    }

    // ── Delete validated PENDING GDOs ──

    // Simple PENDING → cascade delete entire GDO
    if (toReplaceIds.length) {
      const { data: dosToDelete } = await supabase.from('OutboundDelivery')
        .select('id').in('gdo_id', toReplaceIds)
      const doIdsToDelete = (dosToDelete ?? []).map((d: any) => d.id as string)
      if (doIdsToDelete.length) {
        await supabase.from('OutboundItem').delete().in('do_id', doIdsToDelete)
        await supabase.from('OutboundDelivery').delete().in('id', doIdsToDelete)
      }
      await supabase.from('GroupDeliveryOrder').delete().in('id', toReplaceIds)
    }

    // Preserve PENDING → delete DOs/Items only, update GDO header
    if (toPreserveIds.length) {
      const { data: dosToDelete } = await supabase.from('OutboundDelivery')
        .select('id').in('gdo_id', toPreserveIds)
      const doIdsToDelete = (dosToDelete ?? []).map((d: any) => d.id as string)
      if (doIdsToDelete.length) {
        await supabase.from('OutboundItem').delete().in('do_id', doIdsToDelete)
        await supabase.from('OutboundDelivery').delete().in('id', doIdsToDelete)
      }
      for (const { id, fields } of preserveGDOUpdates) {
        await supabase.from('GroupDeliveryOrder').update(fields).eq('id', id)
      }
    }

    // ── Batch inserts ──
    const CHUNK = 500
    async function batchInsert(table: string, rows: any[]) {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await supabase.from(table).insert(rows.slice(i, i + CHUNK))
        if (error) throw new Error(`${table}: ${error.message}`)
      }
    }

    if (gdoInserts.length)  await batchInsert('GroupDeliveryOrder', gdoInserts)
    if (doInserts.length)   await batchInsert('OutboundDelivery',   doInserts)
    if (itemInserts.length) await batchInsert('OutboundItem',       itemInserts)

    return ok(res, { created }, 201)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Get available inventory for an item ─────────────────────

// Tồn khả dụng của 1 mã hàng trong 1 kho (FEFO list) — dùng chung cho getItemInventory
// và getInventoryByMaterial (nút search tồn kho ở bảng chuẩn bị). Trả [] nếu kho không có vị trí.
async function fetchMaterialInventory(materialId: string, warehouseId: string | null) {
  let locIds: string[] | null = null
  if (warehouseId) {
    const { data: locs } = await supabase.from('Location')
      .select('id').eq('warehouse_id', warehouseId)
    locIds = ((locs ?? []) as any[]).map((l: any) => l.id as string)
    if (!locIds.length) return []
  }

  // Phân trang đủ (cap ~1000/response) — .order('id') phụ để phân trang ổn định
  const data = await fetchAllRowsParallel(() => {
    let q = supabase.from('InventoryEntry')
      .select('id, pallet_code, cartons_imported, cartons_remaining, cartons_reserved, production_date, import_date, qa_status_id, ncc_id, shelf_life_days, qa_status:QAStatus(id,code,name), location:Location(location_code), material:Material!material_id(shelf_life_days, supplier_shelf_life_overrides)')
      .eq('material_id', materialId)
      .in('status', ['IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING'])
      .gt('cartons_remaining', 0) // tồn=0 hợp lệ trong DB (upload snapshot) nhưng không phải tồn khả dụng
    if (locIds) q = q.in('location_id', locIds)
    return q.order('created_at').order('id')
  })

  const now = Date.now()
  return (data ?? []).map((e: any) => {
    const shelfDays = resolveShelfLife(e.shelf_life_days, e.material, e.ncc_id)
    let pct_date: number | null = null
    if (shelfDays > 0 && e.production_date) {
      const totalMs   = shelfDays * 86_400_000
      const remaining = new Date(e.production_date).getTime() + totalMs - now
      pct_date = Math.max(0, Math.round((remaining / totalMs) * 100))
    }
    const reserved = Number(e.cartons_reserved ?? 0)
    return {
      id:                e.id,
      pallet_code:       e.pallet_code,
      cartons_remaining: e.cartons_remaining,
      cartons_imported:  e.cartons_imported,
      cartons_reserved:  reserved,
      location_code:     e.location?.location_code ?? null,
      production_date:   e.production_date ?? null,
      import_date:       e.import_date ?? null,
      pct_date,
      available:         Math.max(0, (e.cartons_remaining ?? e.cartons_imported) - reserved),
      qa_status:         e.qa_status_id ? (e.qa_status ?? null) : null,
    }
  })
}

export async function getItemInventory(req: Request, res: Response) {
  try {
    const { gdoId, itemId } = req.params
    const [itemRes, gdoRes] = await Promise.all([
      supabase.from('OutboundItem').select('material_id').eq('id', itemId).single(),
      supabase.from('GroupDeliveryOrder').select('warehouse_id').eq('id', gdoId).single(),
    ])
    if (!itemRes.data) return fail(res, 'Không tìm thấy mặt hàng', 404)
    return ok(res, await fetchMaterialInventory(itemRes.data.material_id, gdoRes.data?.warehouse_id ?? null))
  } catch (e) { return fail(res, String(e)) }
}

// ─── Cảnh báo thiếu tồn theo (kho, ngày giao) ─────────────────
// RPC outbound_shortage_stats (migration 20260705) tính trong DB: demand = còn phải xuất
// của MỌI đơn chưa hủy trong ngày; available = tồn loại QA giữ + QUARANTINE; planned = KH
// nhập (hôm nay → ngày giao) TRỪ lượng thực đã nhập từng chuyến. Level: 1 = tồn thiếu nhưng
// tồn + KH đủ (push hàng về đúng KH); 2 = tồn + KH vẫn thiếu.
export async function getOutboundShortages(req: Request, res: Response) {
  try {
    const { warehouse_id, date } = req.query as Record<string, string>
    if (!warehouse_id || !date) return fail(res, 'warehouse_id và date là bắt buộc', 400)
    const { data, error } = await supabase.rpc('outbound_shortage_stats', { p_warehouse_id: warehouse_id, p_date: date })
    if (error) {
      // Migration chưa apply → trả rỗng để trang không vỡ (chỉ mất cảnh báo)
      console.error('outbound_shortage_stats:', error.message)
      return ok(res, [])
    }
    const rows = ((data ?? []) as Array<{ material_id: string; demand: number; available: number; planned_remaining: number }>)
      .map(r => {
        const demand = Number(r.demand), available = Number(r.available), planned = Number(r.planned_remaining)
        const level = available >= demand ? 0 : available + planned >= demand ? 1 : 2
        return { material_id: r.material_id, demand, available, planned, level }
      })
      .filter(r => r.level > 0)
    return ok(res, rows)
  } catch (e) { return fail(res, String(e)) }
}

// Tồn theo mã hàng + kho (nút search tồn kho ở bảng chuẩn bị, không gắn item cụ thể)
export async function getInventoryByMaterial(req: Request, res: Response) {
  try {
    const { material_id, warehouse_id } = req.query as Record<string, string>
    if (!material_id) return fail(res, 'material_id là bắt buộc', 400)
    return ok(res, await fetchMaterialInventory(material_id, warehouse_id || null))
  } catch (e) { return fail(res, String(e)) }
}

// ─── Bảng chuẩn bị hàng — gom ≥1 GDO, tính pallet CÒN PHẢI chuẩn bị + gợi ý vị trí FEFO ──
// Realtime: FE dùng queryKey ['gdo','prepare',…] → OutboundItem/OutboundScanEntry đổi sẽ tự
// invalidate (prefix 'gdo'), pallet cần chuẩn bị giảm dần khi quét. KHÔNG giữ chỗ (reserve).
export async function getPrepareBoard(req: Request, res: Response) {
  try {
    const gdoIds = String(req.query.gdo_ids ?? '').split(',').map(s => s.trim()).filter(Boolean)
    if (!gdoIds.length) return ok(res, { rows: [], total_cartons: 0, total_pallets: 0 })

    const { data: gdos } = await supabase.from('GroupDeliveryOrder')
      .select('id, warehouse_id, warehouse:Warehouse(inventory_mode)').in('id', gdoIds)
    const warehouseIds = [...new Set((gdos ?? []).map((g: any) => g.warehouse_id).filter(Boolean))] as string[]
    // Scope kho: board chỉ xem được chuyến thuộc kho được giao
    const boardScope = req.user?.warehouse_scope !== 'NATIONAL' ? (req.user?.warehouse_ids ?? []) : null
    if (boardScope && warehouseIds.some(id => !boardScope.includes(id))) {
      return fail(res, 'Ngoài phạm vi kho được giao — không thể xem board chuẩn bị của kho này', 403)
    }
    // Ngoại lệ Thùng/Pallet theo kho — chỉ áp khi board gom đúng 1 kho (trường hợp thường);
    // gom nhiều kho khác override → fallback định mức chung (hiếm).
    const prepareWarehouseId = warehouseIds.length === 1 ? warehouseIds[0] : null
    // do_id → kho QTY? (kho QTY → mã hành xử như no_qr_tracking)
    const qtyGdoIds = new Set((gdos ?? []).filter((g: any) => g.warehouse?.inventory_mode === 'QTY').map((g: any) => g.id as string))

    const { data: dos } = await supabase.from('OutboundDelivery')
      .select('id, gdo_id').in('gdo_id', gdoIds)
    const doIds = (dos ?? []).map((d: any) => d.id)
    if (!doIds.length) return ok(res, { rows: [], total_cartons: 0, total_pallets: 0 })
    const qtyDoIds = new Set((dos ?? []).filter((d: any) => qtyGdoIds.has(d.gdo_id)).map((d: any) => d.id as string))

    const { data: items } = await supabase.from('OutboundItem')
      .select('do_id, material_id, material_code_raw, cartons_ordered, cartons_scanned, loose_picking, material:Material!material_id(short_name, cartons_per_pallet, warehouse_pallet_overrides, no_qr_tracking)')
      .in('do_id', doIds) as { data: Array<{
        do_id: string; material_id: string | null; material_code_raw: string | null
        cartons_ordered: number | null; cartons_scanned: number | null; loose_picking: number | null
        material: { short_name: string | null; cartons_per_pallet: number | null; warehouse_pallet_overrides: { warehouse_id: string; cartons_per_pallet: number }[] | null; no_qr_tracking: boolean | null } | null
      }> | null }

    // Gom theo mã hàng (material_id, fallback material_code_raw)
    type Row = {
      material_id: string | null; material_code: string; material_name: string | null
      cartons_ordered: number; cartons_scanned: number; cartons_remaining: number
      cartons_per_pallet: number; pallets_remaining: number; no_qr_tracking: boolean
      suggestions: { location_code: string | null; pct_date: number | null; available: number }[]
    }
    const rowMap = new Map<string, Row>()
    for (const i of (items ?? [])) {
      const key = i.material_id ?? `raw:${i.material_code_raw ?? ''}`
      const itemNoQr = effectiveNoQr(i.material?.no_qr_tracking, qtyDoIds.has(i.do_id) ? 'QTY' : 'QR')
      const cur = rowMap.get(key) ?? {
        material_id: i.material_id ?? null,
        material_code: i.material_code_raw ?? '(?)',
        material_name: i.material?.short_name ?? null,
        cartons_ordered: 0, cartons_scanned: 0, cartons_remaining: 0,
        cartons_per_pallet: effCartonsPerPallet(i.material, prepareWarehouseId),
        pallets_remaining: 0, no_qr_tracking: itemNoQr,
        suggestions: [],
      }
      cur.no_qr_tracking = cur.no_qr_tracking || itemNoQr
      cur.cartons_ordered += Number(i.cartons_ordered ?? 0)
      cur.cartons_scanned += Number(i.cartons_scanned ?? 0)
      rowMap.set(key, cur)
    }

    // FEFO suggestions cho các mã hàng — chunk matIds (URL dài) + phân trang (cap ~1000, tồn 1 mã có thể >1000 pallet);
    // lọc kho bằng INNER JOIN Location (không nhồi nghìn location_id vào .in())
    const matIds = [...new Set([...rowMap.values()].map(r => r.material_id).filter(Boolean))] as string[]
    const useWhFilter = warehouseIds.length > 0
    if (matIds.length) {
      const entryChunks = await Promise.all(
        Array.from({ length: Math.ceil(matIds.length / 200) }, (_, ci) => matIds.slice(ci * 200, ci * 200 + 200)).map(chunk =>
          fetchAllRowsParallel(() => {
            let q = supabase.from('InventoryEntry')
              .select(`material_id, cartons_remaining, cartons_imported, cartons_reserved, production_date, ncc_id, shelf_life_days, location:Location${useWhFilter ? '!inner' : ''}(location_code, warehouse_id), material:Material!material_id(shelf_life_days, supplier_shelf_life_overrides)`)
              .in('material_id', chunk)
              .in('status', ['IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING'])
              .gt('cartons_remaining', 0) // bỏ pallet tồn=0 từ DB (JS bên dưới cũng skip, filter sớm đỡ kéo hàng chục nghìn dòng chết)
              .order('id')
            if (useWhFilter) q = q.in('location.warehouse_id', warehouseIds)
            return q
          })
        )
      )
      const entries = entryChunks.flat() as Array<{
        material_id: string; cartons_remaining: number | null; cartons_imported: number | null
        cartons_reserved: number | null; production_date: string | null; ncc_id: string | null; shelf_life_days: number | null
        location: { location_code: string | null } | null
        material: { shelf_life_days: number | null; supplier_shelf_life_overrides: { transport_company_id: string; shelf_life_days: number }[] | null } | null
      }>
      const nowMs = Date.now()
      const byMat = new Map<string, Map<string, { location_code: string | null; pct_date: number | null; available: number }>>()
      for (const e of (entries ?? [])) {
        const reserved  = Number(e.cartons_reserved ?? 0)
        const available = Math.max(0, (e.cartons_remaining ?? e.cartons_imported ?? 0) - reserved)
        if (available <= 0) continue
        const shelfDays = resolveShelfLife(e.shelf_life_days, e.material, e.ncc_id)
        let pct_date: number | null = null
        if (shelfDays > 0 && e.production_date) {
          const totalMs   = shelfDays * 86_400_000
          const remaining = new Date(e.production_date).getTime() + totalMs - nowMs
          pct_date = Math.max(0, Math.round((remaining / totalMs) * 100))
        }
        const loc = e.location?.location_code ?? '(chưa xác định)'
        const k = `${pct_date ?? 'n'}|${loc}`
        const locMap = byMat.get(e.material_id) ?? new Map()
        const cur = locMap.get(k) ?? { location_code: loc, pct_date, available: 0 }
        cur.available += available
        locMap.set(k, cur)
        byMat.set(e.material_id, locMap)
      }
      for (const r of rowMap.values()) {
        if (!r.material_id) continue
        const locMap = byMat.get(r.material_id)
        if (!locMap) continue
        // Hòa %Date → ưu tiên vị trí ÍT hàng nhất (dọn hàng lẻ trước) → tên vị trí; đồng bộ luật với panel tồn kho FE
        r.suggestions = [...locMap.values()].sort((a, b) => {
          const pa = a.pct_date ?? Infinity, pb = b.pct_date ?? Infinity
          if (pa !== pb) return pa - pb
          if (a.available !== b.available) return a.available - b.available
          return (a.location_code ?? '').localeCompare(b.location_code ?? '')
        }).slice(0, 2)
      }
    }

    // Tính còn lại + pallet cần; chỉ giữ mã còn phải chuẩn bị
    const rows = [...rowMap.values()].map(r => {
      r.cartons_remaining = Math.max(0, r.cartons_ordered - r.cartons_scanned)
      r.pallets_remaining = r.cartons_per_pallet > 0 ? Math.ceil(r.cartons_remaining / r.cartons_per_pallet) : 0
      return r
    }).filter(r => r.cartons_remaining > 0)

    // Sắp theo vị trí FEFO (đi 1 vòng theo vị trí), rồi mã hàng
    rows.sort((a, b) => {
      const la = a.suggestions[0]?.location_code ?? '￿'
      const lb = b.suggestions[0]?.location_code ?? '￿'
      if (la !== lb) return la < lb ? -1 : 1
      return a.material_code.localeCompare(b.material_code)
    })

    return ok(res, {
      rows,
      total_cartons: rows.reduce((s, r) => s + r.cartons_remaining, 0),
      total_pallets: rows.reduce((s, r) => s + r.pallets_remaining, 0),
    })
  } catch (e) { return fail(res, String(e)) }
}

// ─── Check scan validity (no save) ───────────────────────────

export async function checkScanItem(req: Request, res: Response) {
  try {
    const { gdoId, itemId } = req.params
    const { qr_code } = req.body as { qr_code: string }
    const qr = (qr_code ?? '').trim()
    if (!qr) return fail(res, 'qr_code là bắt buộc', 400)

    const [
      { data: gdo },
      { data: item, error: itemErr },
      { data: invList },
      { data: dupCheck },
    ] = await Promise.all([
      supabase.from('GroupDeliveryOrder').select('status, warehouse_id').eq('id', gdoId).single(),
      supabase.from('OutboundItem').select('*').eq('id', itemId).single(),
      supabase.from('InventoryEntry').select('*, qa_status:QAStatus(code,name), location:Location!location_id(warehouse_id)').eq('pallet_code', qr).in('status', ['IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING']),
      supabase.from('OutboundScanEntry').select('id').eq('item_id', itemId).eq('pallet_code', qr).maybeSingle(),
    ])
    if (!inScope(req, gdo?.warehouse_id)) return fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403)
    const inv = ((invList ?? []) as any[]).find((e: any) => e.location?.warehouse_id === gdo?.warehouse_id) ?? null

    if (gdo?.status === 'PAUSED') return fail(res, 'Chuyến xe đang tạm dừng — không thể quét', 400)
    if (itemErr || !item) return fail(res, 'Không tìm thấy mặt hàng', 404)
    if (item.status === 'COMPLETED') return fail(res, 'Mặt hàng này đã xuất đủ số lượng', 400)
    if (!inv) return fail(res, `Pallet "${qr}" chưa được nhập kho — kiểm tra lại phiếu nhập inbound`, 404)
    if (inv.qa_status_id && inv.qa_status?.code !== 'OK') {
      return fail(res, `Pallet bị giữ QA: ${inv.qa_status?.name ?? inv.qa_status_id} — không được xuất`, 400)
    }
    if (dupCheck) return fail(res, `Pallet "${qr}" đã được quét trong phiếu này`, 400)

    const available = Number(inv.cartons_remaining ?? inv.cartons_imported) - Number(inv.cartons_reserved ?? 0)
    if (available <= 0) return fail(res, `Pallet "${qr}" đã xuất hết số thùng`, 400)

    const remaining_on_item = Number(item.cartons_ordered) - Number(item.cartons_scanned)
    if (remaining_on_item <= 0) return fail(res, 'Mặt hàng đã đủ số lượng', 400)

    if (item.material_id && inv.material_id !== item.material_id) {
      return fail(res, `Sai mã hàng — pallet không khớp với phiếu`, 400)
    }

    const dateReqPct = Number(item.date_required ?? 0)
    if (dateReqPct > 0) {
      const matId = item.material_id ?? inv.material_id
      const { data: mat } = matId
        ? await supabase.from('Material').select('shelf_life_days, supplier_shelf_life_overrides').eq('id', matId).single()
        : { data: null }
      const shelfLifeDays = resolveShelfLife(inv.shelf_life_days, mat, inv.ncc_id)
      if (!shelfLifeDays) return fail(res, `Mặt hàng chưa có Shelf Life — không thể kiểm tra %Date`, 400)
      const prodDate = inv.production_date ? new Date(inv.production_date) : null
      if (!prodDate || isNaN(prodDate.getTime())) return fail(res, `Pallet "${qr}" không có NSX — không thể kiểm tra %Date`, 400)
      const today = new Date()
      const expiryMs = prodDate.getTime() + shelfLifeDays * 86_400_000
      const remainDays = (expiryMs - today.getTime()) / 86_400_000
      const remainPct = (remainDays / shelfLifeDays) * 100
      if (remainPct < dateReqPct) {
        return fail(res, `%Date còn lại: ${Math.floor(remainPct)}% < yêu cầu ${dateReqPct}% (NSX ${inv.production_date}, HSD ${shelfLifeDays} ngày)`, 400)
      }
    }

    let best_available_date: string | null = null
    if (inv.material_id && gdo?.warehouse_id) {
      // MIN(production_date) = order + limit(1) — không kéo cả list (mã >1000 pallet bị cap cắt → min SAI);
      // lọc kho bằng INNER JOIN Location thay vì nhồi location_id vào .in()
      const { data: bestRow } = await supabase.from('InventoryEntry')
        .select('production_date, location:Location!inner(warehouse_id)')
        .eq('material_id', inv.material_id)
        .eq('location.warehouse_id', gdo.warehouse_id)
        .in('status', ['IN_STOCK', 'PARTIAL'])
        .is('qa_status_id', null)
        .not('production_date', 'is', null)
        .or('cartons_remaining.gt.0,cartons_remaining.is.null')
        .order('production_date', { ascending: true })
        .limit(1).maybeSingle()
      best_available_date = (bestRow as { production_date: string | null } | null)?.production_date ?? null
    }

    return res.json({
      success: true,
      data: {
        pallet_code:       qr,
        production_date:   inv.production_date ?? null,
        best_available_date,
        available_cartons: available,
        suggested_cartons: Math.min(available, remaining_on_item),
      },
    })
  } catch (e) { return fail(res, String(e)) }
}

// ─── Scan QR for an item ──────────────────────────────────────

export async function scanItem(req: Request, res: Response) {
  try {
    const { gdoId, itemId } = req.params
    const { qr_code, employee_id, cartons_override, loose_picking_mode } = req.body as { qr_code: string; employee_id?: string; cartons_override?: number; loose_picking_mode?: boolean }
    const qr = (qr_code ?? '').trim()
    if (!qr) return fail(res, 'qr_code là bắt buộc', 400)

    const [
      { data: gdo },
      { data: item, error: itemErr },
      { data: invList },
      { data: dupCheck },
      { data: empCheck },
    ] = await Promise.all([
      supabase.from('GroupDeliveryOrder').select('status, started_at, warehouse_id').eq('id', gdoId).single(),
      supabase.from('OutboundItem').select('*').eq('id', itemId).single(),
      supabase.from('InventoryEntry').select('*, qa_status:QAStatus(code,name), location:Location!location_id(warehouse_id)').eq('pallet_code', qr).in('status', ['IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING']),
      supabase.from('OutboundScanEntry').select('id').eq('item_id', itemId).eq('pallet_code', qr).maybeSingle(),
      employee_id
        ? supabase.from('Employee').select('id').eq('id', employee_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    if (!inScope(req, gdo?.warehouse_id)) return fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403)
    const inv = ((invList ?? []) as any[]).find((e: any) => e.location?.warehouse_id === gdo?.warehouse_id) ?? null
    const resolved_employee_id = empCheck ? employee_id : null
    if (gdo?.status === 'PAUSED') return fail(res, 'Chuyến xe đang tạm dừng — không thể quét', 400)
    if (itemErr || !item) return fail(res, 'Không tìm thấy mặt hàng', 404)
    if (item.status === 'COMPLETED') return fail(res, 'Mặt hàng này đã xuất đủ số lượng', 400)
    if (!inv) return fail(res, `Pallet "${qr}" chưa được nhập kho — kiểm tra lại phiếu nhập inbound`, 404)
    if (inv.qa_status_id && inv.qa_status?.code !== 'OK') {
      return fail(res, `Pallet bị giữ QA: ${inv.qa_status?.name ?? inv.qa_status_id} — không được xuất`, 400)
    }

    // Fetch shelf_life_days và best_available_date song song (cả hai chỉ cần dữ liệu từ bước trên)
    const matId = item.material_id ?? inv.material_id
    const [{ data: shelfMat }, best_available_date] = await Promise.all([
      matId
        ? supabase.from('Material').select('shelf_life_days, supplier_shelf_life_overrides').eq('id', matId).single()
        : Promise.resolve({ data: null }),
      (async (): Promise<string | null> => {
        if (!inv.material_id || !gdo?.warehouse_id) return null
        // MIN(production_date) = order + limit(1) — không kéo cả list (cap 1000 làm min SAI); lọc kho bằng INNER JOIN
        const { data: bestRow } = await supabase.from('InventoryEntry')
          .select('production_date, location:Location!inner(warehouse_id)')
          .eq('material_id', inv.material_id)
          .eq('location.warehouse_id', gdo.warehouse_id)
          .in('status', ['IN_STOCK', 'PARTIAL'])
          .is('qa_status_id', null)
          .not('production_date', 'is', null)
          .or('cartons_remaining.gt.0,cartons_remaining.is.null')
          .order('production_date', { ascending: true })
          .limit(1).maybeSingle()
        return (bestRow as { production_date: string | null } | null)?.production_date ?? null
      })(),
    ])
    const shelfLifeDays = resolveShelfLife(inv.shelf_life_days, shelfMat, inv.ncc_id)

    // Kiểm tra % shelf life còn lại nếu item có yêu cầu
    const dateReqPct = Number(item.date_required ?? 0)
    if (dateReqPct > 0) {
      if (!shelfLifeDays) {
        return fail(res, `Mặt hàng chưa có Shelf Life — không thể kiểm tra %Date`, 400)
      }
      const prodDate = inv.production_date ? new Date(inv.production_date) : null
      if (!prodDate || isNaN(prodDate.getTime())) {
        return fail(res, `Pallet "${qr}" không có NSX — không thể kiểm tra %Date`, 400)
      }
      const today      = new Date()
      const expiryMs   = prodDate.getTime() + shelfLifeDays * 86_400_000
      const remainDays = (expiryMs - today.getTime()) / 86_400_000
      const remainPct  = (remainDays / shelfLifeDays) * 100
      if (remainPct < dateReqPct) {
        return fail(res,
          `%Date còn lại: ${Math.floor(remainPct)}% < yêu cầu ${dateReqPct}% (NSX ${inv.production_date}, HSD ${shelfLifeDays} ngày)`,
          400
        )
      }
    }

    if (item.material_id && inv.material_id !== item.material_id) {
      return fail(res, `Sai mã hàng — pallet "${inv.material_id}" không khớp với phiếu "${item.material_id}"`, 400)
    }

    if (dupCheck) return fail(res, `Pallet "${qr}" đã được quét trong phiếu này`, 400)

    const available = Number(inv.cartons_remaining ?? inv.cartons_imported) - Number(inv.cartons_reserved ?? 0)
    if (available <= 0) return fail(res, `Pallet "${qr}" đã xuất hết số thùng`, 400)
    const remaining_on_item = Number(item.cartons_ordered) - Number(item.cartons_scanned)
    if (remaining_on_item <= 0) return fail(res, 'Mặt hàng đã đủ số lượng', 400)

    let cap = Math.min(available, remaining_on_item)

    if (loose_picking_mode) {
      const { data: looseEntries } = await supabase.from('OutboundScanEntry')
        .select('cartons_scanned').eq('item_id', itemId).eq('is_loose_picking', true)
      const loose_scanned = (looseEntries ?? []).reduce((s: number, e: any) => s + Number(e.cartons_scanned), 0)
      const outbound_scanned = Number(item.cartons_scanned) - loose_scanned
      const regular_quota    = Number(item.cartons_ordered) - Number(item.loose_picking)
      const overshoot        = Math.max(0, outbound_scanned - regular_quota)
      const effective_loose  = Math.max(0, Number(item.loose_picking) - overshoot)
      const loose_remaining  = Math.max(0, effective_loose - loose_scanned)
      if (loose_remaining <= 0) return fail(res, 'Mặt hàng đã đủ số lượng nhặt lẻ', 400)
      cap = Math.min(cap, loose_remaining)
    }

    const to_take = cartons_override ? Math.min(Math.max(1, Number(cartons_override)), cap) : cap

    // Tính pct_date tại thời điểm quét — khóa cứng, không thay đổi theo thời gian
    let pct_date: number | null = null
    if (shelfLifeDays > 0 && inv.production_date) {
      const totalMs = shelfLifeDays * 86_400_000
      const remaining = new Date(inv.production_date).getTime() + totalMs - Date.now()
      pct_date = Math.max(0, Math.round((remaining / totalMs) * 100))
    }

    const t = now()

    // Insert scan entry TRƯỚC khi thay đổi inventory — nếu lỗi thì không có gì bị ảnh hưởng
    const scanId = randomUUID()
    const { error: insertErr } = await supabase.from('OutboundScanEntry').insert({
      id: scanId, item_id: itemId, inventory_entry_id: inv.id,
      pallet_code: qr, cartons_scanned: to_take,
      nmsx: inv.nmsx ?? null,   // NMSX (đoạn 6 QR) kế thừa từ pallet tồn
      production_date: inv.production_date ?? null,
      best_available_date,
      pct_date,
      is_loose_picking: !!loose_picking_mode,
      scanned_by: resolved_employee_id, scanned_at: t,
      created_at: t, updated_at: t,
    })
    if (insertErr) return fail(res, `Lỗi lưu scan entry: ${insertErr.message}`, 500)

    let new_scanned = Number(item.cartons_scanned) + to_take

    // Loose picking: giữ hàng (reserve) thay vì xuất ngay; item không tự COMPLETE
    let new_item_status: string
    if (loose_picking_mode) {
      new_item_status = 'IN_PROGRESS'
      // Giữ hàng (reserve) an toàn đua: chỉ +reserved, KHÔNG đụng remaining.
      // Nếu tồn vừa bị thao tác khác đổi liên tục → rollback scan entry đã insert để không lệch.
      const reserved_ok = await adjustInventoryAtomic(inv.id, 0, to_take)
      if (!reserved_ok) {
        await supabase.from('OutboundScanEntry').delete().eq('id', scanId)
        return fail(res, 'Tồn kho mã này vừa thay đổi (thao tác khác) — thử lại', 409)
      }
      const cum = await addItemScanned(itemId, to_take, () => 'IN_PROGRESS')
      if (cum != null) new_scanned = cum
    } else {
      // Trừ tồn NGUYÊN TỬ chống đua + chống xuất-quá-tồn (trước đây ghi mù remaining=available-to_take
      // → 2 người quét cùng pallet làm mất cập nhật / xuất quá số). Lỗi → rollback scan entry đã insert.
      const consumed = await consumeInventoryExact(inv.id, to_take)
      if (consumed !== true) {
        await supabase.from('OutboundScanEntry').delete().eq('id', scanId)
        return fail(res, consumed === false
          ? `Pallet "${qr}" vừa được người khác xuất bớt — tồn không đủ, quét lại`
          : 'Tồn kho mã này đang bận (nhiều người thao tác) — thử lại', 409)
      }
      // Nhặt lẻ chưa xác nhận → KHÔNG cho complete dù đủ số
      const { data: unconfirmedLoose } = await supabase.from('OutboundScanEntry')
        .select('id').eq('item_id', itemId).eq('is_loose_picking', true).eq('loose_confirmed', false)
      const blockComplete = (unconfirmedLoose ?? []).length > 0
      const ordered = Number(item.cartons_ordered)
      // Cộng dồn cartons_scanned NGUYÊN TỬ + set status theo TỔNG thật (chống mất cộng dồn khi nhiều
      // người quét cùng item → item kẹt IN_PROGRESS / đơn không tự hoàn thành dù đã quét đủ).
      const cum = await addItemScanned(itemId, to_take, n => (n >= ordered && !blockComplete) ? 'COMPLETED' : 'IN_PROGRESS')
      if (cum != null) new_scanned = cum
      new_item_status = (new_scanned >= ordered && !blockComplete) ? 'COMPLETED' : 'IN_PROGRESS'
    }

    // Nhặt lẻ mode: skip DO/GDO cascade khi chưa bắt đầu (xe chưa tới)
    const skipCascade = !!loose_picking_mode && !gdo?.started_at

    if (!skipCascade) {
      // Parallel: count pending items in DO + count pending DOs in GDO (gdoId đã biết từ params)
      // Item đã được UPDATE ở bước trên nên count phản ánh trạng thái mới
      const [{ count: pendingItems }, { count: pendingDOs }] = await Promise.all([
        supabase.from('OutboundItem')
          .select('id', { count: 'exact', head: true })
          .eq('do_id', item.do_id).neq('status', 'COMPLETED'),
        supabase.from('OutboundDelivery')
          .select('id', { count: 'exact', head: true })
          .eq('gdo_id', gdoId).neq('status', 'COMPLETED').neq('id', item.do_id),
      ])
      const doCompleted = pendingItems === 0
      const gdoCompleted = doCompleted && pendingDOs === 0
      await Promise.all([
        supabase.from('OutboundDelivery')
          .update({ status: doCompleted ? 'COMPLETED' : 'IN_PROGRESS', updated_at: t })
          .eq('id', item.do_id),
        supabase.from('GroupDeliveryOrder')
          .update({
            status:          'IN_PROGRESS',
            last_scanned_at: t,
            ...(gdoCompleted ? { scan_completed_at: t } : {}),
            updated_at:      t,
          })
          .eq('id', gdoId),
      ])
    }

    return ok(res, {
      scan_entry: { id: scanId, pallet_code: qr, cartons_scanned: to_take },
      item: { ...item, cartons_scanned: new_scanned, status: new_item_status },
    })
  } catch (e) { return fail(res, String(e)) }
}

// ─── Delete scan entry (hủy QR đã quét) ─────────────────────

export async function deleteScanEntry(req: Request, res: Response) {
  try {
    const { gdoId, itemId, scanId } = req.params

    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select('status, warehouse_id').eq('id', gdoId).single()
    if (!inScope(req, gdo?.warehouse_id)) return fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403)
    if (gdo?.status === 'PAUSED') return fail(res, 'Chuyến xe đang tạm dừng — không thể xóa QR', 400)

    const { data: scan } = await supabase.from('OutboundScanEntry')
      .select('*').eq('id', scanId).eq('item_id', itemId).single()
    if (!scan) return fail(res, 'Không tìm thấy bản ghi quét', 404)

    const t = now()

    // Restore inventory an toàn đua (optimistic-lock + retry) — khác nhau cho nhặt lẻ chưa/đã xác nhận vs thường
    if (scan.inventory_entry_id) {
      const sc = Number(scan.cartons_scanned)
      if (scan.is_loose_picking && !scan.loose_confirmed) {
        // Chưa xác nhận: chỉ nhả reserved (remaining chưa từng bị trừ)
        await adjustInventoryAtomic(scan.inventory_entry_id, 0, -sc)
      } else if (scan.is_loose_picking && scan.loose_confirmed) {
        // Đã xác nhận: hoàn remaining + nhả reserved
        await adjustInventoryAtomic(scan.inventory_entry_id, sc, -sc)
      } else {
        // Scan thường: hoàn remaining
        await adjustInventoryAtomic(scan.inventory_entry_id, sc, 0)
      }
    }

    await supabase.from('OutboundScanEntry').delete().eq('id', scanId)

    // Recalculate item
    const { data: item } = await supabase.from('OutboundItem')
      .select('*').eq('id', itemId).single()
    if (item) {
      const { data: remainingScans } = await supabase.from('OutboundScanEntry')
        .select('cartons_scanned').eq('item_id', itemId)
      const newCartons  = (remainingScans ?? []).reduce((s: number, e: any) => s + Number(e.cartons_scanned), 0)
      const newItemStatus = newCartons === 0 ? 'PENDING'
        : newCartons >= Number(item.cartons_ordered) ? 'COMPLETED'
        : 'IN_PROGRESS'
      await supabase.from('OutboundItem')
        .update({ cartons_scanned: newCartons, status: newItemStatus, updated_at: t }).eq('id', itemId)

      // Recalculate DO
      const { data: siblingItems } = await supabase.from('OutboundItem')
        .select('id, status').eq('do_id', item.do_id)
      const allStatuses = (siblingItems ?? []).map((i: any) =>
        i.id === itemId ? newItemStatus : i.status
      )
      const doCompleted   = allStatuses.every((s: string) => s === 'COMPLETED')
      const doAnyProgress = allStatuses.some((s: string) => s !== 'PENDING')
      const doStatus      = doCompleted ? 'COMPLETED' : doAnyProgress ? 'IN_PROGRESS' : 'PENDING'
      const { data: doRow } = await supabase.from('OutboundDelivery')
        .update({ status: doStatus, updated_at: t })
        .eq('id', item.do_id).select('gdo_id').single()

      // Recalculate GDO (respect started_at — once started, minimum IN_PROGRESS)
      if (doRow?.gdo_id) {
        const { data: gdo } = await supabase.from('GroupDeliveryOrder')
          .select('started_at').eq('id', gdoId).single()
        const { data: siblingDOs } = await supabase.from('OutboundDelivery')
          .select('id, status').eq('gdo_id', doRow.gdo_id)
        const doStatuses = (siblingDOs ?? []).map((d: any) =>
          d.id === item.do_id ? doStatus : d.status
        )
        const gdoCompleted   = doStatuses.every((s: string) => s === 'COMPLETED')
        const gdoAnyProgress = doStatuses.some((s: string) => s !== 'PENDING')
        let gdoStatus = gdoAnyProgress ? 'IN_PROGRESS' : 'PENDING'
        if (gdo?.started_at && gdoStatus === 'PENDING') gdoStatus = 'IN_PROGRESS'
        await supabase.from('GroupDeliveryOrder')
          .update({
            status: gdoStatus,
            ...(!gdoCompleted ? { scan_completed_at: null } : {}),
            updated_at: t,
          }).eq('id', doRow.gdo_id)
      }
    }

    return ok(res, { success: true })
  } catch (e) { return fail(res, String(e)) }
}

// ─── Confirm loose picking entries for an item ────────────────

export async function confirmLoosePickingItem(req: Request, res: Response) {
  try {
    const { gdoId, itemId } = req.params
    const { employee_id } = req.body as { employee_id?: string }

    const [{ data: gdo }, { data: item }, { data: empCheck }] =
      await Promise.all([
        supabase.from('GroupDeliveryOrder').select('status, started_at, warehouse_id').eq('id', gdoId).single(),
        supabase.from('OutboundItem').select('*').eq('id', itemId).single(),
        employee_id
          ? supabase.from('Employee').select('id').eq('id', employee_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
    const confirmed_by = empCheck ? employee_id : null

    if (!inScope(req, gdo?.warehouse_id)) return fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403)
    if (gdo?.status === 'PAUSED') return fail(res, 'Chuyến xe đang tạm dừng', 400)
    if (!item) return fail(res, 'Không tìm thấy mặt hàng', 404)

    const t = now()

    // ── CHIẾM NGUYÊN TỬ (atomic claim) ────────────────────────────
    // Chiếm các loose entry CHƯA xác nhận bằng MỘT câu UPDATE...RETURNING (1 statement = atomic + row-lock).
    // Hai lượt confirm đồng thời: lượt đầu set loose_confirmed=true & nhận rows; lượt sau khớp 0 dòng (vì
    // loose_confirmed đã = true) → nhận [] → KHÔNG trừ tồn lần nữa. Đây là CHỐT chống "2 người xác nhận cùng lúc".
    const { data: claimed, error: claimErr } = await supabase.from('OutboundScanEntry')
      .update({ loose_confirmed: true, loose_confirmed_at: t, loose_confirmed_by: confirmed_by, updated_at: t })
      .eq('item_id', itemId).eq('is_loose_picking', true).eq('loose_confirmed', false)
      .select('id, inventory_entry_id, cartons_scanned')
    if (claimErr) return fail(res, `Lỗi DB: ${claimErr.message}`, 500)
    if (!claimed?.length) return fail(res, 'Không có nhặt lẻ chờ xác nhận', 400)

    // Gộp số thùng cần trừ theo inventory_entry_id (CHỈ trên các entry vừa chiếm được — của riêng request này)
    const invDeduct = new Map<string, number>()
    for (const entry of (claimed as any[])) {
      if (entry.inventory_entry_id) {
        invDeduct.set(entry.inventory_entry_id, (invDeduct.get(entry.inventory_entry_id) ?? 0) + Number(entry.cartons_scanned))
      }
    }

    // Trừ remaining + reserved từng InventoryEntry an toàn đua (optimistic-lock + retry)
    for (const [invId, amount] of invDeduct) {
      await adjustInventoryAtomic(invId, -amount, -amount)
    }

    // Re-check item completion
    const newCartons = Number(item.cartons_scanned)
    const newItemStatus = newCartons >= Number(item.cartons_ordered) ? 'COMPLETED' : 'IN_PROGRESS'
    await supabase.from('OutboundItem')
      .update({ status: newItemStatus, updated_at: t }).eq('id', itemId)

    // Cascade DO → GDO (chỉ khi xe đã bắt đầu)
    if (gdo?.started_at) {
      const { data: siblingItems } = await supabase.from('OutboundItem')
        .select('id, status').eq('do_id', item.do_id)
      const doCompleted = (siblingItems ?? []).every((i: any) =>
        i.id === itemId ? newItemStatus === 'COMPLETED' : i.status === 'COMPLETED'
      )
      const { data: doRow } = await supabase.from('OutboundDelivery')
        .update({ status: doCompleted ? 'COMPLETED' : 'IN_PROGRESS', updated_at: t })
        .eq('id', item.do_id).select('gdo_id').single()

      if (doRow?.gdo_id) {
        const { data: siblingDOs } = await supabase.from('OutboundDelivery')
          .select('status').eq('gdo_id', doRow.gdo_id)
        const gdoCompleted = (siblingDOs ?? []).every((d: any) =>
          d.id === item.do_id ? doCompleted : d.status === 'COMPLETED'
        )
        await supabase.from('GroupDeliveryOrder')
          .update({
            status:          'IN_PROGRESS',
            last_scanned_at: t,
            ...(gdoCompleted ? { scan_completed_at: t } : {}),
            updated_at:      t,
          })
          .eq('id', doRow.gdo_id)
      }
    }

    return ok(res, { confirmed: (claimed as any[]).length })
  } catch (e) { return fail(res, String(e)) }
}

// ─── Lưu thủ công nhặt lẻ (hàng no-QR: POSM/Loscam) ───────────
// Ghi số thùng nhặt lẻ THỦ CÔNG (không quét camera) cho mã không-QR. Upsert 1 loose scan entry
// (is_loose_picking=true, CHƯA xác nhận) + RESERVE tồn theo delta — trừ tồn thật khi "Check nhặt lẻ".
// Entry POSM chung có location_id=null → tra theo cột warehouse_id trực tiếp (KHÔNG join Location như scanItem).
export async function manualLooseItem(req: Request, res: Response) {
  try {
    const { gdoId, itemId } = req.params
    const { cartons } = req.body as { cartons?: number }
    if (cartons == null || Number(cartons) < 0) return fail(res, 'Số thùng không hợp lệ', 400)

    const [{ data: gdo }, { data: item }] = await Promise.all([
      supabase.from('GroupDeliveryOrder').select('status, warehouse_id, warehouse:Warehouse(inventory_mode)').eq('id', gdoId).single(),
      supabase.from('OutboundItem')
        .select('id, do_id, material_id, material_code_raw, cartons_ordered, cartons_scanned, loose_picking, material:Material!material_id(material_code, no_qr_tracking)')
        .eq('id', itemId).single(),
    ])
    if (!inScope(req, gdo?.warehouse_id)) return fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403)
    if (gdo?.status === 'PAUSED') return fail(res, 'Chuyến xe đang tạm dừng — không thể cập nhật', 400)
    if (!item) return fail(res, 'Không tìm thấy mặt hàng', 404)

    const gdoMode = (gdo as { warehouse?: { inventory_mode?: string | null } | null } | null)?.warehouse?.inventory_mode
    if (!effectiveNoQr((item.material as any)?.no_qr_tracking, gdoMode)) return fail(res, 'Chỉ áp dụng cho hàng không theo dõi QR', 400)
    const matCode: string | null = (item.material as any)?.material_code ?? item.material_code_raw ?? null
    if (!matCode || !gdo?.warehouse_id) return fail(res, 'Thiếu mã hàng hoặc kho', 400)

    // Loose entries hiện có → tính effective loose + tìm bản ghi thủ công đang sửa
    const { data: looseEntries } = await supabase.from('OutboundScanEntry')
      .select('id, cartons_scanned, loose_confirmed, inventory_entry_id, pallet_code')
      .eq('item_id', itemId).eq('is_loose_picking', true)
    const existing = (looseEntries ?? []).find((e: any) => !e.loose_confirmed && e.pallet_code === matCode) as
      { id: string; cartons_scanned: number } | undefined
    const oldQty          = Number(existing?.cartons_scanned ?? 0)
    const looseScannedTot = (looseEntries ?? []).reduce((s: number, e: any) => s + Number(e.cartons_scanned), 0)
    const outboundScanned = Number(item.cartons_scanned) - looseScannedTot
    const regularQuota    = Number(item.cartons_ordered) - Number(item.loose_picking)
    const overshoot       = Math.max(0, outboundScanned - regularQuota)
    const effectiveLoose  = Math.max(0, Number(item.loose_picking) - overshoot)
    const otherLoose      = looseScannedTot - oldQty
    const looseCap        = Math.max(0, effectiveLoose - otherLoose)

    // Tồn chung theo warehouse_id trực tiếp (entry POSM location_id=null)
    const { data: invEntry } = await supabase.from('InventoryEntry')
      .select('id, cartons_remaining, cartons_imported, cartons_reserved')
      .eq('pallet_code', matCode).eq('warehouse_id', gdo.warehouse_id).maybeSingle()
    if (!invEntry) return fail(res, `Mã "${matCode}" chưa có tồn trong kho — kiểm tra phiếu nhập`, 404)

    let newQty = Math.min(Math.round(Number(cartons)), looseCap)
    // Cap theo tồn khả dụng (remaining - reserved) + phần đang giữ của chính bản ghi này (oldQty)
    const availForThis = Number(invEntry.cartons_remaining ?? invEntry.cartons_imported ?? 0) - Number(invEntry.cartons_reserved ?? 0) + oldQty
    if (newQty > availForThis) newQty = Math.max(0, availForThis)
    const delta = newQty - oldQty

    // RESERVE delta nguyên tử (không trừ remaining — trừ khi confirm). delta<0 = nhả bớt.
    if (delta !== 0) {
      const ok2 = await adjustInventoryAtomic(invEntry.id, 0, delta)
      if (!ok2) return fail(res, 'Tồn kho mã này đang bận (nhiều người thao tác) — thử lại', 409)
    }

    const t = now()
    // Upsert bản ghi lẻ thủ công
    if (existing) {
      if (newQty === 0) await supabase.from('OutboundScanEntry').delete().eq('id', existing.id)
      else await supabase.from('OutboundScanEntry').update({ cartons_scanned: newQty, updated_at: t }).eq('id', existing.id)
    } else if (newQty > 0) {
      await supabase.from('OutboundScanEntry').insert({
        id: randomUUID(), item_id: itemId, inventory_entry_id: invEntry.id,
        pallet_code: matCode, cartons_scanned: newQty,
        is_loose_picking: true, loose_confirmed: false,
        scanned_at: t, created_at: t, updated_at: t,
      })
    }

    // Cập nhật cartons_scanned của item theo delta (chưa complete — loose chưa xác nhận)
    if (delta !== 0) await addItemScanned(itemId, delta, n => n === 0 ? 'PENDING' : 'IN_PROGRESS')

    return ok(res, { scan_entry: { pallet_code: matCode, cartons_scanned: newQty } })
  } catch (e) { return fail(res, String(e)) }
}

// ─── List loose picking items (nhặt lẻ) ──────────────────────

export async function listLoosePickingItems(req: Request, res: Response) {
  try {
    const { warehouse_id, date, date_from, date_to } = req.query as { warehouse_id?: string; date?: string; date_from?: string; date_to?: string }

    const scopeWhIds = req.user?.warehouse_scope !== 'NATIONAL'
      ? (req.user?.warehouse_ids ?? [])
      : []

    // Cắt theo Loại hàng được phép (đồng bộ listGDOs)
    const looseCats = scopeCategoriesOf(req)

    let effectiveWh: string[] | null = null
    if (scopeWhIds.length > 0) {
      const effective = warehouse_id
        ? scopeWhIds.filter(id => id === warehouse_id)
        : scopeWhIds
      if (effective.length === 0) return ok(res, [])
      effectiveWh = effective
    } else if (warehouse_id) {
      effectiveWh = [warehouse_id]
    }

    // Phân trang né cap-1000 (khoảng ngày rộng có thể >1000 GDO/DO/item → trước đây cụt danh sách nhặt lẻ).
    // makeQuery PHẢI build query MỚI mỗi lần (fetchAllRowsParallel gọi nhiều lần/lô) — tái dùng 1 builder
    // sẽ khiến .range() các trang đè lên nhau ⇒ chỉ còn trang cuối (offset lớn) ⇒ trả RỖNG.
    const makeGdoQ = () => {
      let q = supabase.from('GroupDeliveryOrder')
        .select('id, group_code, delivery_date, planned_date, status, started_at, dvvt, warehouse_type, warehouse:Warehouse(id,code,name)')
        .neq('status', 'CANCELLED')
      if (looseCats) q = q.or(`warehouse_type.is.null,warehouse_type.in.(${looseCats.map(c => `"${c}"`).join(',')})`)
      if (effectiveWh) q = effectiveWh.length === 1 ? q.eq('warehouse_id', effectiveWh[0]) : q.in('warehouse_id', effectiveWh)
      if (date) q = q.eq('delivery_date', date)
      if (date_from) q = q.gte('delivery_date', date_from)
      if (date_to)   q = q.lte('delivery_date', date_to)
      return q.order('id')
    }
    const gdos = await fetchAllRowsParallel(makeGdoQ, 1000, 4)

    if (!gdos?.length) return ok(res, [])

    const gdoIds = (gdos as any[]).map((g: any) => g.id as string)
    const dos = await fetchAllRowsParallel(() => supabase.from('OutboundDelivery')
      .select('id, gdo_id, distributor_name').in('gdo_id', gdoIds).order('id'), 1000, 4)

    const doIds = (dos ?? []).map((d: any) => d.id as string)
    if (!doIds.length) return ok(res, [])

    const items = await fetchAllRowsParallel(() => supabase.from('OutboundItem')
      .select('*, material:Material(id,material_code,short_name)')
      .in('do_id', doIds)
      .gt('loose_picking', 0)
      .neq('status', 'CANCELLED')
      .order('id'), 1000, 4)

    if (!items?.length) return ok(res, [])

    const doToGdoId: Record<string, string> = {}
    for (const d of (dos ?? [])) doToGdoId[d.id] = d.gdo_id
    const gdoById: Record<string, any> = {}
    for (const g of (gdos as any[])) gdoById[g.id] = g

    const nppByGdo: Record<string, string[]> = {}
    for (const d of (dos ?? [])) {
      if (!nppByGdo[d.gdo_id]) nppByGdo[d.gdo_id] = []
      if (d.distributor_name && !nppByGdo[d.gdo_id].includes(d.distributor_name))
        nppByGdo[d.gdo_id].push(d.distributor_name)
    }

    // Tính loose_scanned (thùng thực sự quét qua chế độ nhặt lẻ) per item — phân trang né cap-1000.
    const itemIds = (items as any[]).map((i: any) => i.id as string)
    const looseScans = await fetchAllRowsParallel(() => supabase.from('OutboundScanEntry')
      .select('item_id, cartons_scanned').in('item_id', itemIds).eq('is_loose_picking', true).order('id'), 1000, 4)
    const looseScannedByItem: Record<string, number> = {}
    for (const scan of (looseScans ?? [])) {
      looseScannedByItem[scan.item_id] = (looseScannedByItem[scan.item_id] ?? 0) + Number(scan.cartons_scanned)
    }

    const exportTypeByGdo: Record<string, string | null> = {}
    for (const item of (items as any[])) {
      const gId = doToGdoId[item.do_id]
      if (gId && !exportTypeByGdo[gId] && item.export_type) exportTypeByGdo[gId] = item.export_type
    }

    const result = (items as any[]).map((item: any) => {
      const gdoId  = doToGdoId[item.do_id as string]
      const gdoRaw = gdoId ? gdoById[gdoId] : null
      const gdo    = gdoRaw ? { ...gdoRaw, distributor_names: nppByGdo[gdoId] ?? [], export_type: exportTypeByGdo[gdoId] ?? null } : null
      return { ...item, gdo, loose_scanned: looseScannedByItem[item.id] ?? 0 }
    })

    return ok(res, result)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Get stock for manual-complete dialog ─────────────────────

export async function getManualItemStock(req: Request, res: Response) {
  try {
    const { gdoId, itemId } = req.params
    const [{ data: gdo }, { data: item }] = await Promise.all([
      supabase.from('GroupDeliveryOrder').select('warehouse_id').eq('id', gdoId).single(),
      supabase.from('OutboundItem')
        .select('material_code_raw, cartons_ordered, cartons_scanned, material:Material!material_id(material_code)')
        .eq('id', itemId).single(),
    ])
    if (!gdo || !item) return fail(res, 'Không tìm thấy', 404)
    const materialCode = (item.material as any)?.material_code ?? item.material_code_raw
    const { data: inv } = await supabase
      .from('InventoryEntry')
      .select('cartons_imported, cartons_remaining')
      .eq('pallet_code', materialCode)
      .eq('warehouse_id', gdo.warehouse_id)
      .maybeSingle()
    return ok(res, {
      cartons_imported:  inv?.cartons_imported  ?? 0,
      cartons_remaining: inv?.cartons_remaining ?? 0,
      cartons_ordered:   item.cartons_ordered,
      cartons_scanned:   item.cartons_scanned ?? 0,
    })
  } catch (e) { return fail(res, String(e)) }
}

// ─── Manual complete item ─────────────────────────────────────

export async function manualCompleteItem(req: Request, res: Response) {
  try {
    const { gdoId, itemId } = req.params

    const { cartons } = req.body as { cartons?: number }

    const [{ data: gdo }, { data: item }] = await Promise.all([
      supabase.from('GroupDeliveryOrder').select('status, warehouse_id, warehouse:Warehouse(inventory_mode)').eq('id', gdoId).single(),
      supabase.from('OutboundItem')
        .select('id, do_id, material_id, material_type, material_code_raw, cartons_ordered, cartons_scanned, material:Material!material_id(material_code, no_qr_tracking)')
        .eq('id', itemId).single(),
    ])
    if (!inScope(req, gdo?.warehouse_id)) return fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403)
    if (gdo?.status === 'PAUSED') return fail(res, 'Chuyến xe đang tạm dừng — không thể cập nhật', 400)
    if (!item) return fail(res, 'Không tìm thấy mặt hàng', 404)

    const ctn = (cartons != null && Number(cartons) >= 0) ? Math.round(Number(cartons)) : Number(item.cartons_ordered)

    if (ctn > Number(item.cartons_ordered)) {
      return fail(res, 400, 'EXCEEDS_PLAN', `Số thùng (${ctn}) vượt kế hoạch (${item.cartons_ordered})`)
    }

    // Kho QTY → ép no-QR hiệu lực (xuất tay qua pool dùng chung như mã no_qr_tracking)
    const gdoMode = (gdo as { warehouse?: { inventory_mode?: string | null } | null } | null)?.warehouse?.inventory_mode
    const isSpecial = effectiveNoQr((item.material as any)?.no_qr_tracking, gdoMode)
    const specialMatCode: string | null = isSpecial ? ((item.material as any)?.material_code ?? item.material_code_raw ?? null) : null
    let specialInvEntryId: string | null = null

    if (isSpecial && item.material_id && gdo?.warehouse_id) {
      const materialCode = specialMatCode
      const oldCartons = Number(item.cartons_scanned) || 0
      const delta = ctn - oldCartons   // >0: xuất thêm (trừ tồn) · <0: giảm (cộng lại) · =0: không đổi

      // Áp delta vào tồn POSM dùng chung — optimistic-CAS + jitter, đọc lại remaining MỖI lần thử.
      // Nhiều đơn cùng quét POSM chung 1 mã → thundering herd; không retry thì ~nửa bị 409 oan.
      // INSUFFICIENT (thiếu tồn thật) thì KHÔNG retry; chỉ retry khi CAS trượt (người khác vừa đổi tồn).
      let outcome: 'OK' | 'INSUFFICIENT' | 'BUSY' = 'OK'
      for (let attempt = 0; attempt < 15; attempt++) {
        const { data: invEntry } = await supabase
          .from('InventoryEntry').select('id, cartons_remaining, cartons_imported')
          .eq('pallet_code', materialCode).eq('warehouse_id', gdo.warehouse_id).maybeSingle()
        specialInvEntryId = (invEntry as { id?: string } | null)?.id ?? null
        if (!invEntry || delta === 0) { outcome = 'OK'; break }
        const current  = Number((invEntry as { cartons_remaining: number }).cartons_remaining)
        const imported = Number((invEntry as { cartons_imported: number }).cartons_imported)
        if (delta > 0 && current < delta) { outcome = 'INSUFFICIENT'; break }   // thiếu tồn thật
        const newRemaining = current - delta   // delta<0 → cộng lại
        const { data: applied } = await supabase.from('InventoryEntry').update({
          cartons_remaining: newRemaining,
          status: newRemaining === 0 ? 'EXPORTED' : newRemaining < imported ? 'PARTIAL' : 'IN_STOCK',
          updated_at: now(),
        }).eq('id', (invEntry as { id: string }).id).eq('cartons_remaining', current).select('id')
        if (applied?.length) { outcome = 'OK'; break }
        outcome = 'BUSY'
        await new Promise(r => setTimeout(r, 10 + Math.floor(Math.random() * (30 + attempt * 20))))
      }
      if (outcome === 'INSUFFICIENT') {
        const { data: inv2 } = await supabase.from('InventoryEntry').select('cartons_remaining').eq('pallet_code', materialCode).eq('warehouse_id', gdo.warehouse_id).maybeSingle()
        const available = Number((inv2 as { cartons_remaining?: number } | null)?.cartons_remaining ?? 0)
        return fail(res, 400, 'INSUFFICIENT_STOCK',
          `Không đủ tồn kho — còn ${available} thùng${oldCartons > 0 ? `, cần thêm ${delta} thùng` : ''}`)
      }
      if (outcome === 'BUSY') return fail(res, 409, 'STOCK_CHANGED', 'Tồn kho mã này đang bận (nhiều người thao tác) — thử lại')
    }

    // Chỉ COMPLETED khi nhập đủ kế hoạch — thiếu thì IN_PROGRESS (giống hàng QR).
    // Muốn chốt đơn thiếu: sửa cartons_ordered xuống = thực xuất rồi mới hoàn thành.
    const newItemStatus = ctn >= Number(item.cartons_ordered) ? 'COMPLETED' : 'IN_PROGRESS'
    const t = now()
    await supabase.from('OutboundItem')
      .update({ status: newItemStatus, cartons_scanned: ctn, updated_at: t }).eq('id', itemId)

    // Upsert OutboundScanEntry cho no_qr items (1 dòng per item, pallet_code = material_code)
    if (isSpecial && specialMatCode) {
      const { data: existingScan } = await supabase.from('OutboundScanEntry')
        .select('id').eq('item_id', itemId).maybeSingle()
      if (existingScan) {
        await supabase.from('OutboundScanEntry')
          .update({ cartons_scanned: ctn, updated_at: t }).eq('id', existingScan.id)
      } else {
        await supabase.from('OutboundScanEntry').insert({
          id: randomUUID(), item_id: itemId,
          inventory_entry_id: specialInvEntryId,
          pallet_code: specialMatCode, cartons_scanned: ctn,
          is_loose_picking: false, scanned_at: t, created_at: t, updated_at: t,
        })
      }
    }

    // Parallel: count pending items in DO + count pending DOs in GDO (gdoId đã biết từ params)
    const [{ count: pendingItems }, { count: pendingDOs }] = await Promise.all([
      supabase.from('OutboundItem')
        .select('id', { count: 'exact', head: true })
        .eq('do_id', item.do_id).neq('status', 'COMPLETED').neq('id', itemId),
      supabase.from('OutboundDelivery')
        .select('id', { count: 'exact', head: true })
        .eq('gdo_id', gdoId).neq('status', 'COMPLETED').neq('id', item.do_id),
    ])
    const doCompleted = pendingItems === 0 && newItemStatus === 'COMPLETED'
    const gdoCompleted = doCompleted && pendingDOs === 0
    await Promise.all([
      supabase.from('OutboundDelivery')
        .update({ status: doCompleted ? 'COMPLETED' : 'IN_PROGRESS', updated_at: t })
        .eq('id', item.do_id),
      supabase.from('GroupDeliveryOrder')
        .update({
          status:     'IN_PROGRESS',
          ...(gdoCompleted ? { scan_completed_at: t } : {}),
          updated_at: t,
        })
        .eq('id', gdoId),
    ])

    return ok(res, { success: true })
  } catch (e) { return fail(res, String(e)) }
}

// ─── Scan log (lịch sử quét xuất kho) ───────────────────────────────────────
export async function getScanLog(req: Request, res: Response) {
  const {
    from_date, to_date, warehouse_ids, material_category,
    group_code, distributor, delivery_code,
    pallet_code, material, machine_codes, cycles, scanner_name, nmsx,
    page = '1', limit = '500',
  } = req.query

  const pageNum  = Math.max(1, parseInt(String(page)))
  const limitNum = Math.min(1000, Math.max(1, parseInt(String(limit))))
  const offset   = (pageNum - 1) * limitNum

  // Enforce warehouse scope from JWT
  const scopeWhIds = req.user?.warehouse_scope !== 'NATIONAL'
    ? (req.user?.warehouse_ids ?? [])
    : []
  let effectiveWarehouseIds: string | null = null
  if (scopeWhIds.length > 0) {
    const requested = warehouse_ids ? String(warehouse_ids).split(',').filter(Boolean) : []
    const effective = requested.length > 0
      ? requested.filter(id => scopeWhIds.includes(id))
      : scopeWhIds
    if (effective.length === 0) return ok(res, { rows: [], total: 0, page: pageNum, limit: limitNum })
    effectiveWarehouseIds = effective.join(',')
  } else {
    effectiveWarehouseIds = warehouse_ids ? String(warehouse_ids) : null
  }

  // Scope Loại hàng: chọn loại ngoài phạm vi → rỗng; không chọn → cắt theo scope (RPC p_allowed_categories)
  const scanCats = scopeCategoriesOf(req)
  if (scanCats && material_category && !scanCats.includes(String(material_category))) {
    return ok(res, { rows: [], total: 0, page: pageNum, limit: limitNum })
  }
  const rpcParams: Record<string, unknown> = {
    p_from_date:         from_date         ? String(from_date)         : null,
    p_to_date:           to_date           ? String(to_date)           : null,
    p_warehouse_ids:     effectiveWarehouseIds,
    p_material_category: material_category ? String(material_category) : null,
    p_group_code:        group_code        ? String(group_code)        : null,
    p_distributor:       distributor       ? String(distributor)       : null,
    p_delivery_code:     delivery_code     ? String(delivery_code)     : null,
    p_pallet_code:       pallet_code       ? String(pallet_code)       : null,
    p_material:          material          ? String(material)          : null,
    p_machine_codes:     machine_codes     ? String(machine_codes)     : null,
    p_cycles:            cycles            ? String(cycles)            : null,
    p_scanner_name:      scanner_name      ? String(scanner_name)      : null,
    p_nmsx:              nmsx              ? String(nmsx)              : null,
    p_limit:  limitNum,
    p_offset: offset,
  }
  if (scanCats) rpcParams.p_allowed_categories = scanCats.join(',')
  let { data, error } = await supabase.rpc('get_outbound_scan_log', rpcParams)
  // Fallback trước khi apply migration 20260702_scanlog_category_scope (RPC chưa có param mới)
  if (error && scanCats && /p_allowed_categories|function|schema cache/i.test(error.message)) {
    delete rpcParams.p_allowed_categories
    ;({ data, error } = await supabase.rpc('get_outbound_scan_log', rpcParams))
  }

  if (error) return fail(res, 500, 'DB_ERROR', error.message)

  const total = (data as any[])?.[0]?.total_count ?? 0
  return ok(res, { rows: data ?? [], total, page: pageNum, limit: limitNum })
}

export async function getScanLogFacets(req: Request, res: Response) {
  const { material_category, warehouse_ids } = req.query

  // Enforce warehouse scope từ JWT (giống getScanLog) → facets KHÔNG rò mã máy/chu kỳ kho khác
  const scopeWhIds = req.user?.warehouse_scope !== 'NATIONAL'
    ? (req.user?.warehouse_ids ?? [])
    : []
  let effectiveWarehouseIds: string | null = null
  if (scopeWhIds.length > 0) {
    const requested = warehouse_ids ? String(warehouse_ids).split(',').filter(Boolean) : []
    const effective = requested.length > 0
      ? requested.filter(id => scopeWhIds.includes(id))
      : scopeWhIds
    if (effective.length === 0) return ok(res, { machines: [], cycles: [] })
    effectiveWarehouseIds = effective.join(',')
  } else {
    effectiveWarehouseIds = warehouse_ids ? String(warehouse_ids) : null
  }

  const { data, error } = await supabase.rpc('get_scan_log_facets', {
    p_material_category: material_category ? String(material_category) : null,
    p_warehouse_ids:     effectiveWarehouseIds,
  })
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  const row = (data as any[])?.[0] ?? {}
  return ok(res, { machines: row.machines ?? [], cycles: row.cycles ?? [] })
}
