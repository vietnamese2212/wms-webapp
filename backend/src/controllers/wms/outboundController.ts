import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { effectiveNoQr, markItemsNoQrIfQty, isQtyLike } from '../../lib/inventoryMode'
import { effCartonsPerPallet } from '../../utils/palletCalc'
import { normalizeQR } from '../../utils/qrParser'
import { wrongFormatHint, getDeliveryConfirmation } from './systemSettingController'
import { computePctDate } from '../../utils/shelfLife'
import { fetchAllRowsParallel, fetchAllByIdChunks, fetchUpTo, LIST_TOO_LARGE_MSG, LIST_ROW_CAP, isQueryTimeout, QUERY_TIMEOUT_MSG } from '../../utils/pagination'
import { categoryAllowed, scopeCategoriesOf, CATEGORY_FORBIDDEN_MSG } from '../../utils/categoryScope'
import { safeFilterValue, safeSearch } from '../../utils/search'
import { warehouseRequiresCartonScan, warehouseCartonScanPolicy } from '../../utils/cartonScan'
import { reconcileFromSap, type OdKey } from '../../services/outboundReconcile'
import { hasEntry, qtyIntegerError, qtyLabel, qtyEntryDecimal, qtySplit, unitLabel, type MatUnits as MatUnitsQ } from '../../utils/qtyUnits'
import { requireBaseQty } from '../../utils/qtySemantics'
import { parseListParam } from '../../utils/httpQuery'
import { normalizePlate } from '../../utils/plate'
import { isPreflight, buildPreflight, type PreflightExtra } from '../../utils/uploadPreflight'

const now = () => new Date().toISOString()

// XÓA theo tập id: filter `.in()` nằm trên URL nên phải CHUNK 300 (đo 27/07 trên PostgREST staging:
// 300 id = URL 11KB OK · 400 id đứt kết nối · 700 id → 400 Bad Request). Chuyến nhiều NPP / upload
// lại file lớn dễ vượt ngưỡng này.
async function deleteByIdsChunked(table: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 300) {
    const { error } = await supabase.from(table).delete().in('id', ids.slice(i, i + 300))
    if (error) throw new Error(error.message)
  }
}

// Chuẩn hóa ô Excel: chuỗi trim (rỗng → null) · số (rỗng/NaN → null). Dùng cho parse VL06O raw.
const cellStr = (v: any): string | null => { const s = String(v ?? '').trim(); return s || null }
const cellNum = (v: any): number | null => {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

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
  const scope = scopeWhIds(req)
  const cats = scopeCategoriesOf(req)
  if (scope === null && cats === null) return true
  const { data } = await supabase.from('GroupDeliveryOrder')
    .select('warehouse_id, warehouse_type').eq('id', gdoId).maybeSingle()
  const row = data as { warehouse_id: string | null; warehouse_type: string | null } | null
  if (scope !== null && !inScope(req, row?.warehouse_id)) {
    fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403); return false
  }
  // Scope Loại: chặn thao tác chuyến có loại HIỆN TẠI ngoài phạm vi (chuyến chưa gán loại → cho qua)
  if (!categoryAllowed(req, row?.warehouse_type)) { fail(res, CATEGORY_FORBIDDEN_MSG, 403); return false }
  return true
}
// Chặn 403 nếu tạo/chuyển dữ liệu sang kho ngoài phạm vi user.
function guardWhCreate(req: Request, res: Response, whId: string | null | undefined): boolean {
  if (!inScope(req, whId)) {
    fail(res, 'Không thể thao tác với kho ngoài phạm vi của bạn', 403); return false
  }
  return true
}

// ─── GATE CÂN XE khi Bắt đầu chuyến xuất (user chốt 01/08 — migration 20260801_weigh_gate) ───
// Kho bật `Warehouse.require_weigh_on_start` → biển số xe phải khớp 1 phiếu cân CHƯA hoàn thành
// (is_complete=false: xe đã cân bì, chưa cân ra) của HÔM NAY (giờ VN) mới được Bắt đầu — chống
// quên cân trước khi làm hàng. Qua cổng thì tự GẮN phiếu ↔ chuyến (đối chiếu KL sau khi cân ra).
// Xe không cân được (hỏng cân…) → duyệt bỏ qua: quyền `outbound.weigh_waive` (route riêng hoặc
// body weigh_waive=true ngay lúc bấm). Áp cả 3 đường set started_at: startGDO + 2 đường Xuất luôn.

const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

// Kiểm quyền TRONG controller (mirror requirePerm: superadmin bypass) — cho cờ body weigh_waive,
// vì route đã gate bằng quyền khác (start/quick_export) nên không chặn thêm bằng middleware được.
function userHasPerm(req: Request, module: string, action: string): boolean {
  if (req.user?.is_superadmin === true || req.user?.name === 'Admin') return true
  return !!req.user?.module_permissions?.[module]?.includes(action)
}

type WeighGate = { ok: true; ticketId: string | null } | { ok: false; message: string }

async function checkWeighGate(
  warehouseId: string | null | undefined, licensePlate: string | null | undefined, currentGdoId?: string,
): Promise<WeighGate> {
  if (!warehouseId) return { ok: true, ticketId: null }
  const { data: wh, error: whErr } = await supabase.from('Warehouse')
    .select('require_weigh_on_start').eq('id', warehouseId).maybeSingle()
  // Cột chưa có (cửa sổ deploy trước khi apply migration) → coi như cờ tắt, không chặn vận hành
  if (whErr || !(wh as { require_weigh_on_start?: boolean } | null)?.require_weigh_on_start)
    return { ok: true, ticketId: null }
  const plate = normalizePlate(licensePlate)
  if (!plate) return { ok: true, ticketId: null }   // chuyển nội bộ không biển số — đã có guard biển số riêng
  const { data: tks, error } = await supabase.from('WeighTicket')
    .select('id, gdo_id, warehouse_id')
    .eq('weigh_date', todayVN()).eq('license_plate_norm', plate).eq('is_complete', false)
    .order('in_time', { ascending: false, nullsFirst: false }).limit(10)
  if (error) return { ok: true, ticketId: null }    // bảng chưa có → như trên, fail-open cửa sổ deploy
  // Phiếu thuộc kho này (phiếu chưa gắn kho vẫn tính — null-inclusive) + chưa gắn CHUYẾN KHÁC
  const usable = ((tks ?? []) as { id: string; gdo_id: string | null; warehouse_id: string | null }[])
    .filter(t => (!t.warehouse_id || t.warehouse_id === warehouseId) && (!t.gdo_id || t.gdo_id === currentGdoId))
  if (!usable.length) return {
    ok: false,
    message: `Xe ${plate} chưa có phiếu cân hôm nay (xe phải CÂN BÌ trước khi bắt đầu làm hàng). Cho xe lên cân rồi thử lại — trường hợp không cân được (hỏng cân…) cần người có quyền "Duyệt bỏ qua cân".`,
  }
  // Ưu tiên gắn phiếu CHƯA gắn chuyến, mới nhất trước (phiếu đã gắn đúng chuyến này thì khỏi gắn lại)
  return { ok: true, ticketId: usable.find(t => !t.gdo_id)?.id ?? null }
}

// GATE CỔNG (bổ sung theo user 01/08 — "điều kiện là phải có xe đăng ký cổng VÀ xe cân"):
// kho bật cờ cân = kho quy trình chặt → chuyến phải gắn ĐĂNG KÝ CỔNG thật (đúng kho, chiều XUẤT,
// đã VÀO cổng, biển khớp) — khóa đường nhập biển VÃNG LAI không có đăng ký. Xe ĐÃ RA vẫn hợp lệ
// (user chốt: có đăng ký cổng thật, chỉ là nhập liệu muộn / bốc thêm đơn cùng chuyến).
// Xe vãng lai thật → bảo vệ tạo Đăng ký cổng rồi đi luồng thường; không làm được → Duyệt bỏ qua.
// Trả null = qua cổng; chuỗi = lý do chặn (422 GATE_REQUIRED). Chỉ áp ở startGDO — 2 đường
// "Xuất luôn" (kho QTY/NONE, không có UI chọn cổng) giữ nguyên chỉ gate CÂN.
async function gateRegError(
  gateRegId: string | null | undefined, warehouseId: string | null | undefined, licensePlate: string | null | undefined,
): Promise<string | null> {
  const plate = normalizePlate(licensePlate)
  const MSG = `Xe ${plate ?? ''} chưa gắn Đăng ký cổng — kho này yêu cầu xe phải ĐĂNG KÝ CỔNG (đã vào) và CÂN BÌ trước khi bắt đầu làm hàng. Xe vãng lai: báo bảo vệ tạo Đăng ký cổng rồi chọn lại; trường hợp đặc biệt cần người có quyền "Duyệt bỏ qua cổng/cân".`
  if (!gateRegId) return MSG
  const { data: g, error } = await supabase.from('gate_registrations')
    .select('id, warehouse_id, direction, entry_at, license_plate').eq('id', gateRegId).maybeSingle()
  if (error) return null   // bảng lỗi bất thường — fail-open như checkWeighGate (không chặn vận hành)
  if (!g) return MSG
  const gg = g as { warehouse_id: string | null; direction: string | null; entry_at: string | null; license_plate: string | null }
  if (gg.warehouse_id && warehouseId && gg.warehouse_id !== warehouseId)
    return 'Đăng ký cổng đã chọn thuộc KHO KHÁC — chọn đúng chuyến xe của kho này'
  if ((gg.direction ?? 'OUTBOUND') !== 'OUTBOUND')
    return 'Đăng ký cổng đã chọn không phải chiều XUẤT'
  if (!gg.entry_at)
    return 'Xe chưa VÀO cổng (bảo vệ chưa xác nhận vào) — cho xe vào cổng rồi bấm lại'
  const gPlate = normalizePlate(gg.license_plate)
  if (plate && gPlate && gPlate !== plate)
    return 'Biển số không khớp với Đăng ký cổng đã chọn'
  return null
}

// Gắn phiếu cân ↔ chuyến sau khi Bắt đầu thành công (chỉ phiếu chưa gắn — không đè match tay)
async function linkWeighTicket(ticketId: string | null, gdoId: string) {
  if (!ticketId) return
  await supabase.from('WeighTicket')
    .update({ gdo_id: gdoId, matched_at: now(), matched_by: 'auto-start', updated_at: now() })
    .eq('id', ticketId).is('gdo_id', null)
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

// VỊ TRÍ CHO PHẦN CÒN LẠI CỦA PALLET (user chốt 30/07) ─────────────────────────────────────────
// Pallet xuất KHÔNG hết thì hàng dư phải được khai đang nằm ở đâu. Trước đây luồng xuất KHÔNG bao
// giờ đụng `location_id` → pallet bị "mổ" vẫn ghi ở vị trí cũ dù thực tế công nhân để khu tạm /
// đầu kệ ⇒ lần sau tới vị trí đó không thấy hàng.
// Dùng lại RPC `move_pallets_to_location` của Tồn kho (khóa dòng Location → đếm sức chứa DƯỚI LOCK
// → move trong cùng transaction) để không đẻ đường ghi location thứ hai, và để 2 người cùng dồn vào
// một vị trí không vượt sức chứa. Trả null = OK, chuỗi = lý do người dùng đọc được.
const KEEP_LOCATION = 'KEEP'   // sentinel FE gửi khi user chọn "giữ chỗ cũ" (phân biệt với BỎ TRỐNG)

async function moveLeftoverPallet(
  invId: string, locationId: string, updatedBy: string | null, t: string,
): Promise<string | null> {
  const vnDate = new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const { data: result, error } = await supabase.rpc('move_pallets_to_location', {
    p_ids: [invId], p_location_id: locationId, p_updated_by: updatedBy, p_update_date: vnDate, p_now: t,
  })
  if (error) return `Không chuyển được vị trí phần còn lại: ${error.message}`
  const parts = String(result ?? '').split('|')
  switch (parts[0]) {
    case 'NO_IDS':    return 'Không xác định được pallet để chuyển vị trí'
    case 'NOT_FOUND': return 'Không tìm thấy vị trí đã chọn'
    case 'INACTIVE':  return 'Vị trí đã chọn đang ngưng sử dụng'
    case 'FULL':      return `Vị trí ${parts[2] ?? ''} vừa hết chỗ (còn ${parts[1] ?? 0} slot) — chọn vị trí khác`
    default:          return null
  }
}

// Trả tồn cho MỌI scan entry của tập ITEM trước khi XÓA item — FK OutboundScanEntry ON DELETE CASCADE
// xóa mất scan entry, nếu không nhả TRƯỚC thì cartons_reserved/remaining KẸT vĩnh viễn (bug nhặt lẻ
// pre-start khi xóa/ghi đè chuyến PENDING). 3 công thức KHỚP deleteScanEntry: loose chưa xác nhận → nhả
// reserved; loose đã xác nhận → hoàn remaining + nhả reserved; thường → hoàn remaining.
async function releaseScansForItems(itemIds: string[]): Promise<void> {
  if (!itemIds.length) return
  const scans = await fetchAllByIdChunks(itemIds, chunk => supabase.from('OutboundScanEntry')
    .select('id, inventory_entry_id, cartons_scanned, is_loose_picking, loose_confirmed')
    .in('item_id', chunk).order('id')) as {
      id: string; inventory_entry_id: string | null; cartons_scanned: number
      is_loose_picking: boolean | null; loose_confirmed: boolean | null
    }[]
  for (const s of (scans ?? [])) {
    if (!s.inventory_entry_id) continue
    const sc = Number(s.cartons_scanned)
    if (s.is_loose_picking && !s.loose_confirmed)     await adjustInventoryAtomic(s.inventory_entry_id, 0, -sc)
    else if (s.is_loose_picking && s.loose_confirmed) await adjustInventoryAtomic(s.inventory_entry_id, sc, -sc)
    else                                              await adjustInventoryAtomic(s.inventory_entry_id, sc, 0)
  }
}

// Trả tồn theo tập DO (resolve item → releaseScansForItems) — cho đường xóa theo do_id.
async function releaseScansForDOs(doIds: string[]): Promise<void> {
  if (!doIds.length) return
  const items = await fetchAllByIdChunks(doIds, chunk => supabase.from('OutboundItem')
    .select('id').in('do_id', chunk).order('id')) as { id: string }[]
  await releaseScansForItems((items ?? []).map(i => i.id))
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
  // Số lượng/khối lượng xuất — luôn KHÔNG âm & hữu hạn. Âm/Infinity/NaN → 0 (chống
  // giá trị rác từ Excel/paste như "1e999", "-50" làm sai tồn/xuất).
  const clamp = (n: number): number => (Number.isFinite(n) && n >= 0) ? n : 0
  if (!val && val !== 0) return 0
  if (typeof val === 'number') return clamp(val)
  // Chuẩn số VN: dấu CHẤM = ngăn nghìn, dấu PHẨY = thập phân (1.234,56).
  let s = String(val).trim().replace(/\s/g, '')
  const commas = (s.match(/,/g) ?? []).length
  const dots   = (s.match(/\./g) ?? []).length
  if (commas && dots)       s = s.replace(/\./g, '').replace(',', '.') // 1.234,56 → 1234.56
  else if (commas > 1)      s = s.replace(/,/g, '')                    // 1,234,567 (kiểu US) → 1234567
  else if (commas === 1)    s = s.replace(',', '.')                    // 15,462 → 15.462
  else if (dots > 1)        s = s.replace(/\./g, '')                   // 1.234.567 (nghìn VN) → 1234567
  const n = parseFloat(s)
  return clamp(n)
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
    const [dd, mm, yy] = [parseInt(dmy[1]), parseInt(dmy[2]), parseInt(dmy[3])]
    const date = new Date(Date.UTC(yy, mm - 1, dd))
    if (isNaN(date.getTime())) return null
    // Date.UTC TRÀN ÂM THẦM: 32/13/2026 → 01/02/2027 (ngày SAI mà không báo lỗi). Ngày không tồn
    // tại trên lịch phải trả null để controller báo "ngày không hợp lệ" thay vì ghi ngày lệch.
    if (date.getUTCFullYear() !== yy || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) return null
    return date.toISOString().slice(0, 10)
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
    .select('*, warehouse:Warehouse(id,code,name,inventory_mode,require_weigh_on_start), gate_registration:gate_registrations!gate_registration_id(id,registration_number,date,license_plate,company_name_raw,driver_name,status,direction,registered_at,entry_at,exit_at,called_at)')
    .eq('id', id).single()
  if (error || !gdo) return null

  // Phiếu cân gắn chuyến + ước tính KL hàng (kg) — đối chiếu KL cân thực với KL tính từ
  // Material.weight_kg (migration 20260801_weigh_gate). 2 truy vấn nhẹ chạy song song.
  const [wtRes, westRes] = await Promise.all([
    supabase.from('WeighTicket')
      .select('id, ticket_no, weigh_date, license_plate, tare_kg, gross_kg, net_kg, is_complete, in_time, out_time')
      .eq('gdo_id', id).order('in_time', { ascending: true, nullsFirst: false }),
    supabase.rpc('gdo_weight_estimates', { p_gdo_ids: [id] }),
  ])
  const weightEstimate = (Array.isArray(westRes.data) ? westRes.data : [])[0] ?? null

  const dos = await fetchAllRowsParallel(() => supabase.from('OutboundDelivery')
    .select('*').eq('gdo_id', id).order('delivery_code').order('id'))

  const doIds = (dos ?? []).map((d: any) => d.id)

  // Detail chuyến phải ĐỦ item/scan (chuyến >1000 scan: cap-1000 làm "đã quét" hiển thị thiếu)
  const items = doIds.length
    ? await fetchAllByIdChunks(doIds, chunk => supabase.from('OutboundItem')
        .select('*, material:Material(id,material_code,short_name,custom_short_name,cartons_per_pallet,warehouse_pallet_overrides,weight_kg,shelf_life_days,no_qr_tracking,carton_length_mm,carton_width_mm,carton_height_mm,max_stack_layers,stack_on_top,base_unit,entry_unit,units_per_carton)')
        .in('do_id', chunk)
        .order('id'))
    : []

  // Kho QTY → ép mọi item thành no-QR hiệu lực (hiển thị + logic manual downstream)
  markItemsNoQrIfQty(
    (items ?? []) as unknown as Parameters<typeof markItemsNoQrIfQty>[0],
    (gdo as unknown as { warehouse?: { inventory_mode?: string | null } | null }).warehouse?.inventory_mode,
  )

  const itemIds = (items ?? []).map((i: any) => i.id)
  const scans = itemIds.length
    ? await fetchAllByIdChunks(itemIds, chunk => supabase.from('OutboundScanEntry')
        .select('*, scanned_by_emp:Employee!scanned_by(id, name)').in('item_id', chunk).order('id'))
    : []

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
    weigh_tickets: wtRes.data ?? [],
    weight_estimate: weightEstimate,
    delivery_orders: (dos ?? []).map((d: any) => ({
      ...d,
      items: itemsByDO.get(d.id) ?? [],
    })),
  }
}

// ─── List GDOs ────────────────────────────────────────────────

// Ngữ cảnh lọc CHUNG cho list Xuất (2 mode) + summary + facets — parse 1 chỗ để 3 endpoint
// không lệch nhau. Các filter trước đây lọc CLIENT (loại xe/ĐVVT/NPP/mã hàng/loại kho/tình
// trạng) nay nhận qua query CSV và đẩy xuống RPC.
async function getGdoListCtx(req: Request) {
  const q = req.query as Record<string, string>
  const csv = (s?: string) => parseListParam(s) ?? []
  const scopeWarehouseIds = req.user?.warehouse_scope !== 'NATIONAL' ? (req.user?.warehouse_ids ?? []) : []
  const scopeCats = scopeCategoriesOf(req)

  let whIds: string[] | null = null
  let emptyScope = false
  if (scopeWarehouseIds.length > 0) {
    const effective = q.warehouse_id ? scopeWarehouseIds.filter(id => id === q.warehouse_id) : scopeWarehouseIds
    if (effective.length === 0) emptyScope = true
    whIds = effective
  } else if (q.warehouse_id) {
    whIds = [q.warehouse_id]
  }

  // Tìm kiếm: mã chuyến khớp thẳng trong SQL; mã/tên hàng + NPP + tem pallet resolve Ở ĐÂY
  // thành TẬP ID (khuôn listOrders của Nhập kho) — KHÔNG ghép chuỗi trong SQL vì phải quét
  // toàn bảng, không index nào đỡ (ghi chú đầu file migration 20260728).
  const search = (q.search ?? '').trim() || null
  let searchGdoIds: string[] = []
  let tooBroad: string | null = null
  if (search) {
    const term = safeSearch(search)
    const [matRes, dlvRes, scanRes] = await Promise.all([
      supabase.from('Material').select('id')
        .or(`material_code.ilike.%${term}%,short_name.ilike.%${term}%`).limit(300),
      supabase.from('OutboundDelivery').select('gdo_id').ilike('distributor_name', `%${term}%`).limit(500),
      supabase.from('OutboundScanEntry').select('item_id').ilike('pallet_code', `%${term}%`).limit(500),
    ])
    const ids = new Set<string>()
    for (const d of ((dlvRes.data ?? []) as { gdo_id: string | null }[])) if (d.gdo_id) ids.add(d.gdo_id)
    // mã hàng khớp → item → DO → GDO (chunk 300 theo luật id-list-url-limits)
    const matIds = ((matRes.data ?? []) as { id: string }[]).map(m => m.id)
    const itemIds = [...new Set(((scanRes.data ?? []) as { item_id: string | null }[])
      .map(s => s.item_id).filter((v): v is string => !!v))]
    const doIds = new Set<string>()
    if (matIds.length) {
      const rows = await fetchAllByIdChunks(matIds, chunk =>
        supabase.from('OutboundItem').select('do_id').in('material_id', chunk).order('id'))
      for (const r of (rows as { do_id: string | null }[])) if (r.do_id) doIds.add(r.do_id)
    }
    if (itemIds.length) {
      const rows = await fetchAllByIdChunks(itemIds, chunk =>
        supabase.from('OutboundItem').select('do_id').in('id', chunk).order('id'))
      for (const r of (rows as { do_id: string | null }[])) if (r.do_id) doIds.add(r.do_id)
    }
    if (doIds.size > 5000) {
      tooBroad = `Từ khóa "${search}" quá chung (khớp ${doIds.size} đơn giao). Gõ thêm ký tự để thu hẹp.`
    } else if (doIds.size) {
      const rows = await fetchAllByIdChunks([...doIds], chunk =>
        supabase.from('OutboundDelivery').select('gdo_id').in('id', chunk).order('id'))
      for (const r of (rows as { gdo_id: string | null }[])) if (r.gdo_id) ids.add(r.gdo_id)
    }
    searchGdoIds = [...ids]
  }

  return {
    emptyScope, whIds, scopeCats, tooBroad,
    status: q.status || null, transfer_status: q.transfer_status || null,
    date: q.date || null, date_from: q.date_from || null, date_to: q.date_to || null,
    warehouse_types: csv(q.warehouse_types), export_types: csv(q.export_types),
    dvvts: csv(q.dvvts), npps: csv(q.npps), material_codes: csv(q.material_codes),
    status_labels: csv(q.status_labels),
    search, searchGdoIds,
  }
}
type GdoListCtx = Awaited<ReturnType<typeof getGdoListCtx>>

// Tham số RPC outbound_gdos_page / _summary (PHẢI khớp chữ ký migration 20260728)
function gdoRpcParams(ctx: GdoListCtx): Record<string, unknown> {
  const arr = (a: string[]) => (a.length ? a : null)
  return {
    p_warehouse_ids:    ctx.whIds,
    p_scope_categories: ctx.scopeCats && ctx.scopeCats.length ? ctx.scopeCats : null,
    p_warehouse_types:  arr(ctx.warehouse_types),
    p_status:           ctx.status,
    p_transfer_status:  ctx.transfer_status,
    p_date_from:        ctx.date_from || ctx.date || null,
    p_date_to:          ctx.date_to   || ctx.date || null,
    p_export_types:     arr(ctx.export_types),
    p_dvvts:            arr(ctx.dvvts),
    p_npps:             arr(ctx.npps),
    p_material_codes:   arr(ctx.material_codes),
    p_status_labels:    arr(ctx.status_labels),
    p_search:           ctx.search,
    p_search_gdo_ids:   ctx.search ? ctx.searchGdoIds : null,
  }
}

export async function listGDOs(req: Request, res: Response) {
  try {
    const { warehouse_id, status, date, date_from, date_to, search, transfer_status, page, limit } = req.query as Record<string, string>

    // ── MODE PHÂN TRANG (?page=) — RPC chọn trang id + đếm dưới DB, chỉ enrich 1 trang ──
    if (page) {
      const ctx = await getGdoListCtx(req)
      if (ctx.tooBroad) return fail(res, ctx.tooBroad, 400)
      const pageNum  = Math.max(1, parseInt(page) || 1)
      const limitNum = Math.min(1000, Math.max(1, parseInt(limit) || 200))
      if (ctx.emptyScope) { ok(res, { items: [], total: 0, page: pageNum, limit: limitNum }); return }
      const { data: pg, error: pgErr } = await supabase.rpc('outbound_gdos_page', {
        p_offset: (pageNum - 1) * limitNum, p_limit: limitNum, ...gdoRpcParams(ctx),
      })
      if (pgErr) throw new Error(pgErr.message)
      const ids   = ((pg as { ids?: string[] } | null)?.ids ?? [])
      const total = Number((pg as { total?: number } | null)?.total ?? 0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let rows: any[] = []
      if (ids.length) {
        rows = await fetchAllByIdChunks(ids, chunk => supabase.from('GroupDeliveryOrder')
          .select('*, warehouse:Warehouse(id,code,name,inventory_mode), forklift_driver:Employee!forklift_driver_id(id,name)')
          .in('id', chunk).order('id'))
        const pos = new Map(ids.map((v, i) => [v, i]))   // `.in()` không giữ thứ tự RPC đã sắp
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rows.sort((a: any, b: any) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0))
      }
      ok(res, { items: await enrichGdos(rows), total, page: pageNum, limit: limitNum })
      return
    }

    // ── MODE CŨ (trả MẢNG — back-compat cho consumer khác) ──
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
      // Cắt theo Loại hàng được phép: KHÔNG lọc ở SQL nữa — chuyến chở lẫn lưu chuỗi ghép
      // 'FG01+PM01' nên `in.()` (so khớp nguyên chuỗi) ẨN MẤT chuyến (bug 30/07). Lọc bằng
      // categoryAllowed() ngay dưới đây (giao ≥1 loại) — dữ liệu vẫn không rời server.
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
    // Trần dòng: FE render TOÀN BỘ chuyến ở client (bảng + SummaryBand cộng tổng) → vượt trần
    // thì BÁO RÕ để user thu hẹp, KHÔNG cắt âm thầm (luật CLAUDE.md).
    const { rows: data, truncated } = await fetchUpTo(buildQuery, LIST_ROW_CAP)
    if (truncated) return fail(res, 400, 'RANGE_TOO_WIDE', LIST_TOO_LARGE_MSG(LIST_ROW_CAP))
    const scoped = scopeCats
      ? (data ?? []).filter((g: { warehouse_type?: string | null }) => categoryAllowed(req, g.warehouse_type))
      : (data ?? [])
    return ok(res, await enrichGdos(scoped))
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ── Enrich list chuyến (dùng chung mode cũ trả mảng + mode phân trang): bulk DO/item +
// breakdown theo (mã × NPP) + tổng thùng/pallet + qty_unit. Logic GIỮ NGUYÊN. ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function enrichGdos(data: any[]): Promise<any[]> {
  {
    const gdoIds = (data ?? []).map((g: any) => g.id)
    if (!gdoIds.length) return []

    // Bulk fetch DOs and items for aggregation — CHUNK id 300/lô (khoảng ngày rộng → hàng nghìn
    // gdo/do id nhồi 1 `.in()` = URL quá dài → PostgREST Bad Request) + phân trang trong lô (cap ~1000).
    const dos = await fetchAllByIdChunks(gdoIds, chunk => supabase.from('OutboundDelivery')
      .select('id, gdo_id, distributor_name, delivery_code')
      .in('gdo_id', chunk).order('id'))

    const doIds = (dos ?? []).map((d: any) => d.id)

    const items = await fetchAllByIdChunks(doIds, chunk => supabase.from('OutboundItem')
      .select('id, do_id, cartons_ordered, cartons_scanned, pallets_estimated, loose_picking, material_type, export_type, material_code_raw, material_id, material:Material!material_id(no_qr_tracking, short_name, base_unit, entry_unit, units_per_carton, cartons_per_pallet, warehouse_pallet_overrides, is_pallet_carrier)')
      .in('do_id', chunk).order('id'))

    // Kho QTY → ép no-QR hiệu lực cho item của các GDO QTY (do_id → gdo → inventory_mode)
    const gdoModeById = new Map<string, string | null>((data ?? []).map((g: any) => [g.id, g.warehouse?.inventory_mode ?? null]))
    const doToGdo = new Map<string, string>((dos ?? []).map((d: any) => [d.id, d.gdo_id]))
    const qtyItems = (items ?? []).filter((i: any) => {
      const gid = doToGdo.get(i.do_id)
      return gid != null && isQtyLike(gdoModeById.get(gid))
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

    return (data ?? []).map((g: any) => {
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
      // BASE UNIT: tổng/breakdown cross-mã = THÙNG QUY ĐỔI (base ÷ hệ_số per mã; mã không entry giữ số)
      const qEntry = (i: any, v: unknown) => qtyEntryDecimal(Number(v ?? 0), (i.material ?? null) as MatUnitsQ | null)
      // Pallet: cột pallets_estimated chỉ có ở luồng cũ — đơn sinh từ KHVC/SAP lưu 0 → tile "Pallet 0" SAI
      // (user 22/07). Fallback tính sống = thùng quy đổi ÷ Thùng/Pallet hiệu lực theo kho (chỉ hiển thị).
      const palletsOf = (i: any) => {
        // Mã PALLET MANG HÀNG (Loscam, cờ is_pallet_carrier — user 22/07): chính là pallet chứa hàng
        // bên trên → cộng vào đếm Pallet là DOUBLE. Loại khỏi đếm; vẫn nằm ở Tổng (k QR) để giao nhận đếm tấm.
        if (i.material?.is_pallet_carrier) return 0
        const stored = Number(i.pallets_estimated ?? 0)
        if (stored > 0) return stored
        const cpp = effCartonsPerPallet((i.material ?? null) as MatPalletUnits | null, g.warehouse_id ?? null)
        return cpp > 0 ? qEntry(i, i.cartons_ordered) / cpp : 0
      }
      for (const i of gdoItems) {
        const material_code = i.material_code_raw ?? '(?)'
        const distributor_name = distributorByDo.get(i.do_id) ?? null
        const key = `${material_code}__${distributor_name ?? ''}`
        const cur = breakdownMap.get(key) ?? { material_code, material_name: i.material?.short_name ?? null, distributor_name, cartons: 0, cartons_scanned: 0, pallets: 0 }
        cur.cartons         += qEntry(i, i.cartons_ordered)
        cur.cartons_scanned += qEntry(i, i.cartons_scanned)
        cur.pallets         += palletsOf(i)
        breakdownMap.set(key, cur)
      }

      // BASE UNIT hiển thị (user 22/07): FE cần hiện "thùng + base" (vd 146 thùng + 4 chai) theo đơn vị
      // KHAI BÁO, không chỉ decimal thùng ("146.083" bị đọc nhầm 146k ở VN). Nếu MỌI item cùng
      // (base_unit,entry_unit,units_per_carton) → gửi tổng BASE thô + qty_unit để FE qtySplit ra thùng+base;
      // nhiều mã khác đơn vị (chai+hộp+kg) → qty_unit=null, FE giữ decimal thùng quy đổi (format vi-VN).
      const unitKeys = new Set(gdoItems.map((i: any) => {
        const m = i.material
        return m ? `${m.base_unit ?? ''}|${m.entry_unit ?? ''}|${m.units_per_carton ?? ''}` : 'null'
      }))
      const uniformMat = (unitKeys.size === 1 && !unitKeys.has('null'))
        ? (gdoItems.find((i: any) => i.material)?.material ?? null) : null
      const qty_unit = uniformMat
        ? { base_unit: uniformMat.base_unit ?? null, entry_unit: uniformMat.entry_unit ?? null, units_per_carton: uniformMat.units_per_carton ?? null }
        : null

      return {
        ...g,
        do_count:          gdoDOs.length,
        distributor_names: distributorNames as string[],
        delivery_codes:    deliveryCodes as string[],
        export_type:       firstExportType,
        // Tổng thùng = TẤT CẢ item (gồm hàng no_qr); thêm total_cartons_noqr = riêng hàng không QR.
        total_cartons:      gdoItems.reduce((s: number, i: any) => s + qEntry(i, i.cartons_ordered),   0),
        total_cartons_noqr: noqrItems.reduce((s: number, i: any) => s + qEntry(i, i.cartons_ordered),  0),
        total_pallets:      gdoItems.reduce((s: number, i: any) => s + palletsOf(i), 0),
        total_loose:        gdoItems.reduce((s: number, i: any) => s + qEntry(i, i.loose_picking), 0),
        // Tổng BASE thô (chỉ ý nghĩa khi qty_unit != null) → FE tách "thùng + base" theo đơn vị khai báo.
        total_cartons_base: gdoItems.reduce((s: number, i: any) => s + Number(i.cartons_ordered ?? 0), 0),
        total_noqr_base:    noqrItems.reduce((s: number, i: any) => s + Number(i.cartons_ordered ?? 0), 0),
        total_loose_base:   gdoItems.reduce((s: number, i: any) => s + Number(i.loose_picking ?? 0), 0),
        qty_unit,
        item_breakdown:    [...breakdownMap.values()],
      }
    })
  }
}

// ── Tổng SummaryBand + bảng "Phân bổ theo NPP" — SQL trên TOÀN BỘ kết quả lọc ──
export async function listGDOsSummary(req: Request, res: Response) {
  try {
    const ctx = await getGdoListCtx(req)
    if (ctx.tooBroad) return fail(res, ctx.tooBroad, 400)
    if (ctx.emptyScope) {
      return ok(res, { count: 0, completed: 0, cartons: 0, cartons_qr: 0, cartons_noqr: 0, pallets: 0, npp_breakdown: [] })
    }
    const { data, error } = await supabase.rpc('outbound_gdos_summary', gdoRpcParams(ctx))
    if (error) throw new Error(error.message)
    return ok(res, data)
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ── Option filter (Loại xe / ĐVVT / NPP / Mã hàng / Loại kho / Tình trạng) — DISTINCT dưới DB ──
export async function listGDOsFacets(req: Request, res: Response) {
  try {
    const ctx = await getGdoListCtx(req)
    if (ctx.emptyScope) {
      return ok(res, { export_types: [], dvvts: [], warehouse_types: [], npps: [], status_labels: [], materials: [] })
    }
    const { data, error } = await supabase.rpc('outbound_gdos_facets', {
      p_warehouse_ids:    ctx.whIds,
      p_scope_categories: ctx.scopeCats && ctx.scopeCats.length ? ctx.scopeCats : null,
      p_date_from:        ctx.date_from || ctx.date || null,
      p_date_to:          ctx.date_to   || ctx.date || null,
    })
    if (error) throw new Error(error.message)
    return ok(res, data)
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
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
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── Get GDO detail ───────────────────────────────────────────

export async function getGDO(req: Request, res: Response) {
  try {
    const result = await fetchGDOFull(req.params.id)
    if (!result) return fail(res, 'Không tìm thấy chuyến xe', 404)
    // Chống IDOR: chỉ đọc chuyến thuộc kho + loại trong phạm vi user (mirror listGDOs)
    if (!(await guardGdoScope(req, res, req.params.id))) return
    if (!categoryAllowed(req, (result as { warehouse_type?: string | null }).warehouse_type)) {
      return fail(res, CATEGORY_FORBIDDEN_MSG, 403)
    }
    // Cờ quét-tới-thùng: KHO bật VÀ Loại hàng của chuyến bật → FE mở panel multiscan thùng sau khi quét pallet
    const r = result as { warehouse_id?: string | null; warehouse_type?: string | null }
    const cartonPolicy = await warehouseCartonScanPolicy(r.warehouse_id, r.warehouse_type)
    return ok(res, { ...result, carton_scan_enabled: cartonPolicy.enabled, carton_scan_require_full: cartonPolicy.requireFull })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// PATCH /wms/outbound/scan-entries/:scanId/cartons — đính danh sách mã THÙNG vào 1 dòng scan pallet
// (truy vết, KHÔNG đụng tồn/cartons_scanned). Lưu CẢ thùng lạ mã hàng (match=false) để giữ vết.
// FE gửi FULL danh sách hiện tại mỗi lần lưu (replace, idempotent).
export async function attachCartonScans(req: Request, res: Response) {
  try {
    const { scanId } = req.params
    const { cartons } = req.body as { cartons?: { code?: string; match?: boolean; at?: string }[] }
    if (!Array.isArray(cartons)) return fail(res, 'cartons phải là mảng', 400)

    const { data: scan } = await supabase.from('OutboundScanEntry').select('id, item_id').eq('id', scanId).maybeSingle()
    if (!scan) return fail(res, 'Không tìm thấy dòng quét', 404)
    // Chuỗi scan → item → DO → GDO để kiểm phạm vi kho (chống IDOR)
    const { data: item } = await supabase.from('OutboundItem').select('do_id').eq('id', (scan as { item_id: string }).item_id).maybeSingle()
    const { data: doRow } = item ? await supabase.from('OutboundDelivery').select('gdo_id').eq('id', (item as { do_id: string }).do_id).maybeSingle() : { data: null }
    const { data: gdo } = doRow ? await supabase.from('GroupDeliveryOrder').select('status, warehouse_id').eq('id', (doRow as { gdo_id: string }).gdo_id).maybeSingle() : { data: null }
    const g = gdo as { status?: string; warehouse_id?: string | null } | null
    if (!inScope(req, g?.warehouse_id)) return fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403)
    if (g?.status === 'PAUSED') return fail(res, 'Chuyến xe đang tạm dừng — không thể lưu', 400)

    // Chuẩn hóa + loại trùng theo mã (giữ lần quét đầu)
    const seen = new Set<string>()
    const clean: { code: string; match: boolean; at: string }[] = []
    for (const c of cartons) {
      const code = normalizeQR(String(c?.code ?? ''))
      if (!code || seen.has(code)) continue
      seen.add(code)
      clean.push({ code, match: c?.match !== false, at: typeof c?.at === 'string' ? c.at : now() })
    }
    const { error } = await supabase.from('OutboundScanEntry')
      .update({ carton_scans: clean, updated_at: now() }).eq('id', scanId)
    if (error) return fail(res, `Lỗi lưu mã thùng: ${error.message}`, 500)
    return ok(res, { id: scanId, carton_count: clean.length })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
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

// Sinh group_code kế tiếp theo prefix + insert GDO — retry+jitter khi đụng unique index group_code
// (nhiều người tạo đơn cùng kho/ngày ĐỒNG THỜI sẽ tính ra cùng số thứ tự; thua race thì tính lại số mới,
// không nhả 500 "duplicate key" cho user). Dùng chung createGDO + quickExportGDO.
async function insertGdoNextCode(prefix: string, row: Record<string, unknown>): Promise<{ group_code: string; error?: undefined; conflict?: undefined } | { error: string; conflict?: boolean; group_code?: undefined }> {
  // Sinh số chuyến tuần tự dưới tranh chấp: đọc max + insert; đụng unique → retry + jitter/backoff.
  // Cạn retry (nhiều người tạo CÙNG kho+ngày cùng lúc) → conflict=true để caller trả 409 RETRYABLE (không 500 che message).
  for (let attempt = 0; attempt < 16; attempt++) {
    const { data: existing } = await supabase.from('GroupDeliveryOrder')
      .select('group_code').ilike('group_code', `${prefix}%`)
    const maxNum = Math.max(0, ...((existing ?? []) as { group_code: string }[]).map(r => parseInt(r.group_code.split('_').at(-1) ?? '') || 0))
    const group_code = `${prefix}${String(maxNum + 1).padStart(2, '0')}`
    const { error } = await supabase.from('GroupDeliveryOrder').insert({ ...row, group_code })
    if (!error) return { group_code }
    if (!/duplicate|unique/i.test(error.message)) return { error: error.message }
    await new Promise(r => setTimeout(r, 20 + Math.floor(Math.random() * (60 + attempt * 40))))
  }
  return { error: 'Số chuyến đang bị nhiều người tạo cùng lúc — vui lòng bấm Lưu lại.', conflict: true }
}

// ─── Kho phụ nội bộ (Warehouse.parent_warehouse_id) — luật quỹ đạo ───────────
// Kho phụ CHỈ giao dịch với kho parent của nó: nhận chuyển kho từ parent, xuất trả parent,
// hoặc xuất tiêu hao (không gắn ship-to). Cặp parent↔con được nới biển số khi Bắt đầu/Xuất luôn.
type OrbitWh = { id: string; name: string; parent_warehouse_id: string | null }

async function orbitWhByShipto(shipto: string | null | undefined): Promise<OrbitWh | null> {
  const st = String(shipto ?? '').trim()
  if (!st) return null
  const stSafe = safeFilterValue(st)
  const { data } = await supabase.from('Warehouse')
    .select('id, name, parent_warehouse_id')
    .or(`code.eq.${stSafe},shipto_codes.cs.{${stSafe}}`)
    .eq('is_active', true).maybeSingle()
  return (data as OrbitWh | null) ?? null
}

async function parentOfWh(whId: string | null | undefined): Promise<string | null> {
  if (!whId) return null
  const { data } = await supabase.from('Warehouse')
    .select('parent_warehouse_id').eq('id', whId).maybeSingle()
  return (data as { parent_warehouse_id: string | null } | null)?.parent_warehouse_id ?? null
}

// Trả message lỗi khi đơn xuất vi phạm quỹ đạo kho phụ, null nếu hợp lệ.
async function internalOrbitError(sourceWhId: string | null | undefined, shipto: string | null | undefined): Promise<string | null> {
  const dest = await orbitWhByShipto(shipto)
  if (dest?.parent_warehouse_id && dest.parent_warehouse_id !== (sourceWhId ?? null))
    return `"${dest.name}" là kho phụ nội bộ — chỉ kho parent của nó mới được xuất tới`
  const srcParent = await parentOfWh(sourceWhId)
  if (srcParent && String(shipto ?? '').trim() && dest?.id !== srcParent)
    return 'Kho phụ nội bộ chỉ xuất trả về kho parent hoặc xuất tiêu hao (không gắn ship-to kho khác)'
  return null
}

// Cặp parent↔con (cùng site) → biển số tùy chọn (chuyển nội bộ bằng xe nâng/đẩy tay).
async function isInternalPair(sourceWhId: string | null | undefined, shipto: string | null | undefined): Promise<boolean> {
  if (!sourceWhId) return false
  const dest = await orbitWhByShipto(shipto)
  if (!dest) return false
  if (dest.parent_warehouse_id === sourceWhId) return true
  return (await parentOfWh(sourceWhId)) === dest.id
}

// Số thùng/nhặt lẻ từ client phải là số hữu hạn ≥ 0 — số âm/NaN lọt vào phá tổng, shortage, pool (NaN còn 500 lúc insert)
function invalidItemQty(items: Array<{ material_code: string; cartons_ordered: unknown; loose_picking?: unknown }>): string | null {
  for (const i of items) {
    const c = Number(i.cartons_ordered)
    if (!Number.isFinite(c) || c < 0) return `Số thùng không hợp lệ cho mã "${i.material_code}" — phải là số ≥ 0`
    if (i.loose_picking != null) {
      const l = Number(i.loose_picking)
      if (!Number.isFinite(l) || l < 0) return `Số nhặt lẻ không hợp lệ cho mã "${i.material_code}" — phải là số ≥ 0`
    }
  }
  return null
}

// BASE UNIT (đợt 2): số lượng item = SỐ BASE — mã có entry unit phải là SỐ NGUYÊN (luật user 19/07).
// Gọi SAU khi đã resolve material (cần hệ số); mã không resolve được → bỏ qua (không có hệ số để ràng).
function invalidItemQtyBase(
  items: Array<{ material_code: string; cartons_ordered: unknown; loose_picking?: unknown }>,
  matMap: Map<string, MatUnitsQ | null | undefined>,
): string | null {
  for (const i of items) {
    const m = matMap.get(i.material_code) ?? null
    const e1 = qtyIntegerError(Number(i.cartons_ordered), m)
    if (e1) return `Mã "${i.material_code}": ${e1}`
    if (i.loose_picking != null) {
      const e2 = qtyIntegerError(Number(i.loose_picking), m)
      if (e2) return `Mã "${i.material_code}" (nhặt lẻ): ${e2}`
    }
  }
  return null
}

// Upload KH xuất — BASE UNIT: mã có entry → cột Thùng/Hộp/Nhặt lẻ phải SỐ NGUYÊN
// (Hộp + Nhặt lẻ tính theo ĐƠN VỊ GỐC); qty base = Thùng × hệ_số + Hộp. Lỗi kèm GỢI Ý quy đổi.
function uploadRowQtyError(row: Record<string, any>, mu: MatUnitsQ | null | undefined): string | null {
  if (!hasEntry(mu)) return null
  const f = Number(mu!.units_per_carton)
  const bl = unitLabel(mu!.base_unit)
  const thung = parseDecimal(row['Thùng'])
  const hop   = parseDecimal(row['Hộp'])
  const loose = parseDecimal(row['Nhặt lẻ'])
  if (!Number.isInteger(thung)) {
    const goiY = Math.round((thung - Math.floor(thung)) * f)
    return `cột Thùng "${row['Thùng']}" phải là SỐ NGUYÊN (mã ${f} ${bl}/thùng — ${thung} thùng ≈ ${Math.floor(thung)} thùng + ${goiY} ${bl}: ghi ${goiY} vào cột Hộp)`
  }
  if (!Number.isInteger(hop))   return `cột Hộp "${row['Hộp']}" phải là SỐ NGUYÊN (đơn vị ${bl})`
  if (!Number.isInteger(loose)) return `cột Nhặt lẻ "${row['Nhặt lẻ']}" phải là SỐ NGUYÊN (đơn vị ${bl})`
  return null
}
function uploadRowQtyBase(row: Record<string, any>, mu: MatUnitsQ | null | undefined): number {
  const thung = parseDecimal(row['Thùng'])
  if (!hasEntry(mu)) return thung
  return thung * Number(mu!.units_per_carton) + parseDecimal(row['Hộp'])
}

// Thông tin pallet để tính nhặt lẻ (định mức chung + ngoại lệ theo kho).
export type MatPalletUnits = MatUnitsQ & {
  cartons_per_pallet?: number | null
  warehouse_pallet_overrides?: { warehouse_id: string; cartons_per_pallet: number }[] | null
}

// ĐỢT 3 — NHẶT LẺ THEO PALLET (user chốt 20/07): loose = phần base KHÔNG đủ xếp 1 pallet nguyên
// (thùng lẻ < 1 pallet → phải nhặt từng thùng, không quét được nguyên pallet). SAP luôn key thùng chẵn
// nên nhặt lẻ theo hộp-lẻ-dưới-thùng gần như không phát sinh → dùng ngưỡng PALLET. Tính trên qty base ĐÃ GỘP
// (nhiều dòng cùng mã/NPP đã cộng lại) — KHÔNG tính per-dòng rồi cộng (sẽ thổi loose). Mã không entry /
// thiếu cartons_per_pallet → 0 (không ép nhặt lẻ).
export function loosePalletRemainder(orderedBase: number, mu: MatPalletUnits | null | undefined, warehouseId: string | null | undefined): number {
  if (!hasEntry(mu)) return 0
  const cpp = effCartonsPerPallet(mu, warehouseId ?? null)
  const palletBase = cpp > 0 ? cpp * Number(mu!.units_per_carton) : 0
  if (palletBase <= 0) return 0
  return Number(orderedBase) % palletBase
}

// Form Tạo/Sửa bên Xuất KHÔNG sửa nhặt lẻ tay (user chốt 22/07): loose LUÔN TỰ TÍNH từ TỔNG
// theo pallet-remainder (cùng luật với upload KHVC) — BE bỏ qua loose_picking client gửi.
async function loosePalletMats(codes: string[]): Promise<Map<string, MatPalletUnits>> {
  if (!codes.length) return new Map()
  const { data } = await supabase.from('Material')
    .select('material_code, base_unit, entry_unit, units_per_carton, cartons_per_pallet, warehouse_pallet_overrides')
    .in('material_code', codes)   // form tay ≤ vài chục mã/đơn — không cần chunk
  return new Map(((data ?? []) as (MatPalletUnits & { material_code: string })[]).map(m => [String(m.material_code), m]))
}

export async function createGDO(req: Request, res: Response) {
  try {
    if (!requireBaseQty(req, res)) return   // BASE UNIT: chặn payload bundle cũ (thùng thập phân)
    const { delivery_date, warehouse_id, dvvt, customer_name, delivery_code, export_type, warehouse_type, shipto_party, items } = req.body as {
      delivery_date: string; warehouse_id?: string; dvvt?: string
      customer_name?: string; delivery_code?: string; export_type?: string; warehouse_type?: string; shipto_party?: string
      items?: Array<{ material_code: string; cartons_ordered: number; loose_picking?: number; header_text?: string; batch_required?: string; date_required?: number; cs_responsible?: string }>
    }
    if (!delivery_date) return fail(res, 'delivery_date là bắt buộc', 400)
    if (!delivery_code?.trim()) return fail(res, 'Số DO là bắt buộc', 400)
    if (!items?.length) return fail(res, 'Phải có ít nhất 1 mặt hàng', 400)
    const qtyErr = invalidItemQty(items)
    if (qtyErr) return fail(res, qtyErr, 400)
    if (!guardWhCreate(req, res, warehouse_id)) return
    if (!categoryAllowed(req, warehouse_type)) return fail(res, CATEGORY_FORBIDDEN_MSG, 403)
    const orbitErr = await internalOrbitError(warehouse_id ?? null, shipto_party)
    if (orbitErr) return fail(res, orbitErr, 400)

    // Load material info TRƯỚC khi insert GDO (id + category → material_type; units → validate base
    // nguyên — fail ở đây thì chưa ghi gì, không để lại GDO mồ côi)
    const allCodes = [...new Set(items.map(i => i.material_code))]
    const { data: mats } = await supabase.from('Material')
      .select('id, material_code, category, base_unit, entry_unit, units_per_carton').in('material_code', allCodes)
    const matMap = new Map<string, { id: string; category: string | null } & MatUnitsQ>(
      (mats ?? []).map((m: any) => [m.material_code, { id: m.id, category: m.category, base_unit: m.base_unit, entry_unit: m.entry_unit, units_per_carton: m.units_per_carton }])
    )
    const baseErr = invalidItemQtyBase(items, matMap)
    if (baseErr) return fail(res, baseErr, 422)

    // ĐVVT: khớp danh mục → dùng tên chính tắc; không khớp → giữ tên gõ tay (ĐVVT vãng lai)
    const dvvtRes = (await buildDvvtResolver())(dvvt)
    const dvvtName = dvvtRes.ok ? dvvtRes.name : (String(dvvt ?? '').trim() || null)

    // Auto-generate group_code: warehouseCode_X_ddmmyy_stt (retry+jitter trong insertGdoNextCode)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    const [yr, mo, dy] = today.split('-')
    const ddmmyy = `${dy}${mo}${yr.slice(2)}`
    const whData = warehouse_id ? (await supabase.from('Warehouse').select('code').eq('id', warehouse_id).single()).data : null
    const whCode = (whData as { code?: string } | null)?.code ? String((whData as { code: string }).code) : 'XX'
    const prefix = `${whCode}_X_${ddmmyy}_`

    const gdoId = randomUUID()
    const actor = req.user?.name || null
    const ins = await insertGdoNextCode(prefix, {
      id: gdoId, planned_date: delivery_date, delivery_date,
      warehouse_id: warehouse_id ?? null, dvvt: dvvtName,
      warehouse_type: warehouse_type ?? null, shipto_party: shipto_party ?? null, status: 'PENDING',
      created_by: actor, updated_by: actor, updated_at: now(),
    })
    if (ins.error) return fail(res, ins.conflict ? 409 : 500, ins.conflict ? 'CREATE_CONFLICT' : 'ERROR', ins.error)

    // Single DO for manual orders
    const doId = randomUUID()
    const { error: doErr } = await supabase.from('OutboundDelivery').insert({
      id: doId, gdo_id: gdoId, delivery_code: delivery_code?.trim() || null,
      distributor_name: customer_name ?? null, status: 'PENDING', updated_at: now(),
    })
    if (doErr) return fail(res, doErr.message)

    const looseMats = await loosePalletMats(allCodes)
    const itemsToInsert = items.map(item => {
      const matInfo = matMap.get(item.material_code)
      const material_type = matInfo?.category ?? null
      return {
        id: randomUUID(), do_id: doId,
        material_id: matInfo?.id ?? null,
        material_code_raw: item.material_code,
        cartons_ordered: item.cartons_ordered,
        boxes_display: 0, weight: null, pallets_estimated: 0,
        loose_picking: loosePalletRemainder(item.cartons_ordered, looseMats.get(item.material_code), warehouse_id ?? null),
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
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── Tạo & Xuất luôn (quick-export — hàng không tem: mã no-QR / kho QTY) ──────
// 1 request làm trọn cho đơn tạo tay: tạo đơn → tự gán người tạo phụ trách → Bắt đầu
// (biển số BẮT BUỘC) → ghi nhận SL từng mã (CAS pool tồn dùng chung, như Lưu thủ công)
// → Hoàn thành + maybeAutoCreateTransferOrder. Kho NONE hành xử như Lưu thủ công hiện tại:
// không có dòng tồn → ghi nhận không trừ (kho không theo dõi tồn).
// Mã hụt tồn do tranh chấp GIỮA CHỪNG → đơn dừng IN_PROGRESS + 409 kèm danh sách mã (xử tiếp trên trang chuyến).
export async function quickExportGDO(req: Request, res: Response) {
  try {
    if (!requireBaseQty(req, res)) return   // BASE UNIT: chặn payload bundle cũ (thùng thập phân)
    const { delivery_date, warehouse_id, dvvt, customer_name, delivery_code, export_type, warehouse_type, shipto_party, license_plate, items, weigh_waive, weigh_waive_reason } = req.body as {
      delivery_date: string; warehouse_id?: string; dvvt?: string
      customer_name?: string; delivery_code?: string; export_type?: string; warehouse_type?: string; shipto_party?: string; license_plate?: string
      items?: Array<{ material_code: string; cartons_ordered: number; loose_picking?: number; header_text?: string; batch_required?: string; date_required?: number; cs_responsible?: string }>
      weigh_waive?: boolean; weigh_waive_reason?: string
    }
    if (!delivery_date)             return fail(res, 'delivery_date là bắt buộc', 400)
    if (!delivery_code?.trim())     return fail(res, 'Số DO là bắt buộc', 400)
    if (!items?.length)             return fail(res, 'Phải có ít nhất 1 mặt hàng', 400)
    const qxQtyErr = invalidItemQty(items)
    if (qxQtyErr)                   return fail(res, qxQtyErr, 400)
    if (!warehouse_id)              return fail(res, 'Chọn kho xuất', 400)
    if (!guardWhCreate(req, res, warehouse_id)) return
    if (!categoryAllowed(req, warehouse_type)) return fail(res, CATEGORY_FORBIDDEN_MSG, 403)
    const orbitErr = await internalOrbitError(warehouse_id, shipto_party)
    if (orbitErr) return fail(res, orbitErr, 400)
    // Biển số bắt buộc, TRỪ chuyển nội bộ parent↔kho phụ (xe nâng/đẩy tay trong site)
    if (!license_plate?.trim() && !(await isInternalPair(warehouse_id, shipto_party)))
      return fail(res, 'Biển số xe là bắt buộc', 400)

    // ĐVVT: khớp danh mục → tên chính tắc; không khớp → giữ tên gõ tay (ĐVVT vãng lai)
    const dvvtRes = (await buildDvvtResolver())(dvvt)
    const dvvtName = dvvtRes.ok ? dvvtRes.name : (String(dvvt ?? '').trim() || null)

    const { data: wh } = await supabase.from('Warehouse').select('code, inventory_mode').eq('id', warehouse_id).maybeSingle()
    if (!wh) return fail(res, 'Không tìm thấy kho xuất', 404)
    const whMode = (wh as { inventory_mode?: string | null }).inventory_mode ?? null

    // "Tạo & Xuất luôn" CHỈ áp cho kho QTY (tồn theo số lượng) hoặc NONE (không theo dõi tồn).
    // Kho QR phải đi luồng quét tem — không dùng được xuất luôn.
    if (!isQtyLike(whMode) && whMode !== 'NONE') {
      return fail(res, 422, 'NOT_QTY_NONE', 'Chỉ kho quản lý theo số lượng (QTY) hoặc không theo dõi tồn (NONE) mới dùng được "Tạo & Xuất luôn". Kho QR hãy dùng luồng quét tem.')
    }

    // GATE CÂN XE (như startGDO — đây cũng là 1 đường Bắt đầu). GDO chưa tồn tại nên duyệt bỏ qua
    // chỉ có đường body flag; vết duyệt ghi ngay vào record tạo mới bên dưới.
    let qxWeighTicketId: string | null = null
    if (weigh_waive === true) {
      if (!userHasPerm(req, 'outbound', 'weigh_waive'))
        return fail(res, 403, 'FORBIDDEN', 'Bạn không có quyền Duyệt bỏ qua cân — nhờ người được phân quyền duyệt')
    } else {
      const qxGate = await checkWeighGate(warehouse_id, license_plate)
      if (!qxGate.ok) return fail(res, 422, 'WEIGH_REQUIRED', qxGate.message)
      qxWeighTicketId = qxGate.ticketId
    }

    const allCodes = [...new Set(items.map(i => i.material_code))]
    const { data: mats } = await supabase.from('Material')
      .select('id, material_code, category, no_qr_tracking, base_unit, entry_unit, units_per_carton').in('material_code', allCodes)
    const matMap = new Map<string, { id: string; category: string | null; no_qr: boolean | null } & MatUnitsQ>(
      ((mats ?? []) as { id: string; material_code: string; category: string | null; no_qr_tracking: boolean | null; base_unit: string | null; entry_unit: string | null; units_per_carton: number | null }[])
        .map(m => [m.material_code, { id: m.id, category: m.category, no_qr: m.no_qr_tracking, base_unit: m.base_unit, entry_unit: m.entry_unit, units_per_carton: m.units_per_carton }])
    )
    const missing = allCodes.filter(c => !matMap.has(c))
    if (missing.length) return fail(res, `Mã hàng chưa có trong hệ thống: ${missing.join(', ')}`, 400)
    const qxBaseErr = invalidItemQtyBase(items, matMap)
    if (qxBaseErr) return fail(res, qxBaseErr, 422)

    // Pre-check tồn pool TRƯỚC khi ghi (chỉ mã có dòng tồn; không có dòng → như Lưu thủ công: cho qua, không trừ).
    // GỘP TỔNG mọi dòng cùng mã (pool đa dòng sau nhập lại / QTY_DATE 1 dòng mỗi NSX — Map thô lấy dòng CUỐI
    // làm khả dụng SAI, báo thiếu oan) + chunk mã & phân trang (nhiều mã × nhiều NSX vượt cap 1000 dòng/response).
    const poolMap = new Map<string, number>()
    for (let i = 0; i < allCodes.length; i += 300) {
      const chunk = allCodes.slice(i, i + 300)
      const rows = await fetchAllRowsParallel(() => supabase.from('InventoryEntry')
        .select('id, pallet_code, cartons_remaining').eq('warehouse_id', warehouse_id).in('pallet_code', chunk).order('id'))
      for (const p of rows as { pallet_code: string; cartons_remaining: number }[])
        poolMap.set(p.pallet_code, (poolMap.get(p.pallet_code) ?? 0) + Number(p.cartons_remaining))
    }
    // QTY: mã không có dòng tồn = tồn 0 → tính là thiếu. NONE: không theo dõi tồn → bỏ qua (have=null).
    const availOf = (code: string): number | null =>
      poolMap.has(code) ? poolMap.get(code)! : (isQtyLike(whMode) ? 0 : null)
    const short = items.filter(i => { const h = availOf(i.material_code); return h != null && h < Number(i.cartons_ordered) })
    if (short.length) {
      return fail(res, 400, 'INSUFFICIENT_STOCK',
        `Không đủ tồn: ${short.map(i => `${i.material_code} cần ${qtyLabel(Number(i.cartons_ordered), matMap.get(i.material_code))}, còn ${qtyLabel(availOf(i.material_code) ?? 0, matMap.get(i.material_code))}`).join(' · ')}`)
    }

    // Group code: warehouseCode_X_ddmmyy_stt (cùng quy tắc createGDO, retry+jitter chống đụng số khi tạo đồng thời)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    const [yr, mo, dy] = today.split('-')
    const prefix = `${String((wh as { code?: string }).code ?? 'XX')}_X_${dy}${mo}${yr.slice(2)}_`

    const t = now()
    const gdoId = randomUUID()
    const actor = req.user?.name || null
    const ins = await insertGdoNextCode(prefix, {
      id: gdoId, planned_date: delivery_date, delivery_date,
      warehouse_id, dvvt: dvvtName,
      warehouse_type: warehouse_type ?? null, shipto_party: shipto_party ?? null,
      status: 'IN_PROGRESS',
      assigned_at: t, assigned_by: actor,               // tự gán người tạo phụ trách
      started_at: t, license_plate: normalizePlate(license_plate),
      ...(weigh_waive === true
        ? { weigh_waived_at: t, weigh_waived_by: actor, weigh_waive_reason: String(weigh_waive_reason ?? '').trim() || null }
        : {}),
      created_by: actor, updated_by: actor, updated_at: t,
    })
    if (ins.error) return fail(res, ins.conflict ? 409 : 500, ins.conflict ? 'CREATE_CONFLICT' : 'ERROR', ins.error)
    const group_code = ins.group_code
    await linkWeighTicket(qxWeighTicketId, gdoId)   // gắn phiếu cân ↔ chuyến (đối chiếu KL)

    const doId = randomUUID()
    const { error: doErr } = await supabase.from('OutboundDelivery').insert({
      id: doId, gdo_id: gdoId, delivery_code: delivery_code.trim(),
      distributor_name: customer_name ?? null, status: 'PENDING', updated_at: t,
    })
    if (doErr) return fail(res, doErr.message)

    const qxLooseMats = await loosePalletMats(allCodes)
    const itemRows = items.map(item => ({
      id: randomUUID(), do_id: doId,
      material_id: matMap.get(item.material_code)!.id,
      material_code_raw: item.material_code,
      cartons_ordered: item.cartons_ordered,
      boxes_display: 0, weight: null, pallets_estimated: 0,
      loose_picking: loosePalletRemainder(item.cartons_ordered, qxLooseMats.get(item.material_code), warehouse_id),
      header_text: item.header_text?.trim() || null,
      batch_required: item.batch_required?.trim() || null,
      date_required: item.date_required || null,
      cs_responsible: item.cs_responsible?.trim() || null,
      material_type: matMap.get(item.material_code)!.category,
      export_type: export_type ?? null, cartons_scanned: 0,
      status: 'PENDING', updated_at: t,
    }))
    const { error: itemErr } = await supabase.from('OutboundItem').insert(itemRows)
    if (itemErr) return fail(res, itemErr.message)

    // Ghi nhận từng mã: pool (CAS) + entry CHỈ cho mã no-QR hiệu lực — khớp quickExportExistingGDO/manualCompleteItem.
    // Kho NONE + mã thường: không theo dõi tồn → chỉ đánh item COMPLETED (không pool, không entry — trước đây
    // sinh entry cho MỌI mã làm kho NONE kẹt "Cần xóa hết QR" khi Gỡ bắt đầu).
    const failed: { material_code: string; message: string }[] = []
    for (const row of itemRows) {
      const ctn = Number(row.cartons_ordered)
      const isSpecial = effectiveNoQr(matMap.get(row.material_code_raw)?.no_qr, whMode)
      let invEntryId: string | null = null
      if (isSpecial) {
        const r = await applySharedPoolDelta(row.material_code_raw, warehouse_id, ctn, whMode)
        if (r.outcome !== 'OK') {
          failed.push({
            material_code: row.material_code_raw,
            message: r.outcome === 'INSUFFICIENT' ? `còn ${qtyLabel(r.available, matMap.get(row.material_code_raw))}` : 'tồn đang bận (nhiều người thao tác)',
          })
          continue
        }
        invEntryId = r.invEntryId
      }
      const t2 = now()
      await Promise.all([
        supabase.from('OutboundItem').update({ status: 'COMPLETED', cartons_scanned: ctn, updated_at: t2 }).eq('id', row.id),
        ...(isSpecial ? [supabase.from('OutboundScanEntry').insert({
          id: randomUUID(), item_id: row.id,
          inventory_entry_id: invEntryId,
          pallet_code: row.material_code_raw, cartons_scanned: ctn,
          is_loose_picking: false, scanned_at: t2, created_at: t2, updated_at: t2,
        })] : []),
      ])
    }

    if (failed.length) {
      // Đơn giữ IN_PROGRESS — user xử các mã lỗi trên trang chuyến (Lưu thủ công lẻ) rồi Hoàn thành tay
      await supabase.from('OutboundDelivery').update({ status: 'IN_PROGRESS', updated_at: now() }).eq('id', doId)
      const result = await fetchGDOFull(gdoId)
      return res.status(409).json({
        success: false,
        error: {
          code: 'PARTIAL_EXPORT',
          message: `Đơn ${group_code} đã tạo nhưng ${failed.length} mã chưa ghi nhận được — xử tiếp trên trang chuyến: ${failed.map(f => `${f.material_code} (${f.message})`).join(' · ')}`,
        },
        data: result,
      })
    }

    const tEnd = now()
    await Promise.all([
      supabase.from('OutboundDelivery').update({ status: 'COMPLETED', updated_at: tEnd }).eq('id', doId),
      supabase.from('GroupDeliveryOrder')
        .update({ status: 'COMPLETED', completed_at: tEnd, scan_completed_at: tEnd, updated_by: actor, updated_at: tEnd })
        .eq('id', gdoId).neq('status', 'COMPLETED'),
    ])
    await maybeAutoCreateTransferOrder(gdoId, tEnd)

    const result = await fetchGDOFull(gdoId)
    return ok(res, result, 201)
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── "Xuất luôn" trên GDO ĐÃ LƯU (kho QTY/NONE) — 1 bước: nhập biển số → tự Bắt đầu + ghi nhận mọi mã + Hoàn thành ──
// Bỏ nghi thức Giao đơn/Bắt đầu/quét cho kho QTY/NONE. Trừ tồn nguyên tử (chặn xuất quá). Kho QR KHÔNG dùng được.
export async function quickExportExistingGDO(req: Request, res: Response) {
  try {
    if (!requireBaseQty(req, res)) return   // BASE UNIT: chặn payload bundle cũ (thùng thập phân)
    const { gdoId } = req.params
    const { license_plate, weigh_waive, weigh_waive_reason } = req.body as {
      license_plate?: string; weigh_waive?: boolean; weigh_waive_reason?: string
    }
    if (!(await guardGdoScope(req, res, gdoId))) return

    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select('id, status, warehouse_id, shipto_party, assigned_at, assigned_by, started_at, weigh_waived_at, warehouse:Warehouse(inventory_mode)')
      .eq('id', gdoId).single()
    if (!gdo)                        return fail(res, 'Không tìm thấy chuyến', 404)
    if (gdo.status === 'COMPLETED')  return fail(res, 'Chuyến đã hoàn thành', 400)
    if (gdo.status === 'CANCELLED')  return fail(res, 'Chuyến đã hủy', 400)
    // PAUSED vẫn cho: user tạm dừng để sửa kế hoạch → "Xuất luôn" = ngầm Tiếp tục + chốt chuyến.
    const whMode = (gdo as { warehouse?: { inventory_mode?: string | null } | null })?.warehouse?.inventory_mode ?? null
    if (!isQtyLike(whMode) && whMode !== 'NONE')
      return fail(res, 422, 'NOT_QTY_NONE', 'Chỉ kho quản lý theo số lượng (QTY) hoặc không theo dõi tồn (NONE) mới dùng "Xuất luôn". Kho QR hãy dùng luồng quét tem.')
    // Biển số bắt buộc, TRỪ chuyển nội bộ parent↔kho phụ
    if (!license_plate?.trim() &&
        !(await isInternalPair(gdo.warehouse_id as string, (gdo as { shipto_party?: string | null }).shipto_party)))
      return fail(res, 'Biển số xe là bắt buộc', 400)

    // GATE CÂN XE — chỉ khi chuyến CHƯA bắt đầu ("Xuất luôn" lần này chính là lượt Bắt đầu).
    // Chuyến đã started (xuất dở, bấm lại) thì đã qua cổng từ lượt trước, không chặn giữa chừng.
    const qxeWaived = !!(gdo as { weigh_waived_at?: string | null }).weigh_waived_at
    let qxeWeighTicketId: string | null = null
    const qxeWaiveNow = weigh_waive === true && !qxeWaived && !gdo.started_at
    if (!gdo.started_at && !qxeWaived) {
      if (weigh_waive === true) {
        if (!userHasPerm(req, 'outbound', 'weigh_waive'))
          return fail(res, 403, 'FORBIDDEN', 'Bạn không có quyền Duyệt bỏ qua cân — nhờ người được phân quyền duyệt trên chuyến')
      } else {
        const qxeGate = await checkWeighGate(gdo.warehouse_id as string, license_plate, gdoId)
        if (!qxeGate.ok) return fail(res, 422, 'WEIGH_REQUIRED', qxeGate.message)
        qxeWeighTicketId = qxeGate.ticketId
      }
    }

    const { data: dos } = await supabase.from('OutboundDelivery').select('id').eq('gdo_id', gdoId)
    const doIds = ((dos ?? []) as { id: string }[]).map(d => d.id)
    if (!doIds.length) return fail(res, 'Chuyến chưa có đơn/mặt hàng', 400)
    const { data: items } = await supabase.from('OutboundItem')
      .select('id, do_id, material_id, material_code_raw, cartons_ordered, cartons_scanned, status, material:Material!material_id(material_code, no_qr_tracking, base_unit, entry_unit, units_per_carton)')
      .in('do_id', doIds)
    const pending = ((items ?? []) as Array<{
      id: string; material_id: string | null; material_code_raw: string | null
      cartons_ordered: number; cartons_scanned: number | null; status: string
      material?: ({ material_code?: string | null; no_qr_tracking?: boolean | null } & MatUnitsQ) | null
    }>).filter(i => i.status !== 'COMPLETED')

    const actor = req.user?.name || null
    // Ghi nhận từng mã TRƯỚC (trừ tồn). CHƯA đụng trạng thái GDO — nếu TẤT CẢ fail thì giữ nguyên PENDING
    // để đơn vẫn xóa/sửa được (không kẹt "đã bắt đầu" khi chưa xuất được gì).
    const failed: { material_code: string; message: string }[] = []
    let successCount = 0
    for (const item of pending) {
      const ctn = Number(item.cartons_ordered)
      const isSpecial = effectiveNoQr(item.material?.no_qr_tracking, whMode)
      const matCode: string | null = isSpecial ? (item.material?.material_code ?? item.material_code_raw ?? null) : null
      const hasPool = isSpecial && !!item.material_id && !!matCode
      const delta = ctn - (Number(item.cartons_scanned) || 0)
      let invEntryId: string | null = null
      if (hasPool) {
        const r = await applySharedPoolDelta(matCode!, gdo.warehouse_id as string, delta, whMode)
        if (r.outcome === 'INSUFFICIENT') { failed.push({ material_code: matCode!, message: `còn ${qtyLabel(r.available, item.material ?? null)}` }); continue }
        if (r.outcome === 'BUSY')         { failed.push({ material_code: matCode!, message: 'tồn đang bận (nhiều người thao tác)' }); continue }
        invEntryId = r.invEntryId
      }
      const t2 = now()
      // CAS claim: 2 người cùng bấm "Xuất luôn" → chỉ 1 request xử được item (chống trừ tồn ĐÔI).
      const { data: claimed } = await supabase.from('OutboundItem')
        .update({ status: 'COMPLETED', cartons_scanned: ctn, updated_at: t2 })
        .eq('id', item.id).neq('status', 'COMPLETED').select('id')
      if (!claimed?.length) {
        // Thua đua (request kia vừa ghi nhận xong) → HOÀN lại phần tồn mình vừa trừ, không tính lỗi.
        if (hasPool && delta !== 0) await applySharedPoolDelta(matCode!, gdo.warehouse_id as string, -delta, whMode)
        continue
      }
      successCount++
      if (isSpecial && matCode) {
        const { data: existingScan } = await supabase.from('OutboundScanEntry').select('id').eq('item_id', item.id).maybeSingle()
        if (existingScan) {
          await supabase.from('OutboundScanEntry').update({ cartons_scanned: ctn, inventory_entry_id: invEntryId, updated_at: t2 }).eq('id', existingScan.id)
        } else {
          await supabase.from('OutboundScanEntry').insert({
            id: randomUUID(), item_id: item.id, inventory_entry_id: invEntryId,
            pallet_code: matCode, cartons_scanned: ctn, is_loose_picking: false,
            scanned_at: t2, created_at: t2, updated_at: t2,
          })
        }
      }
    }

    // Không xuất được mã nào VÌ LỖI THẬT (thiếu tồn/bận) → giữ GDO nguyên trạng để user sửa rồi thử lại.
    // pending rỗng = mọi mã ĐÃ ghi nhận đủ; successCount=0 mà failed rỗng = thua đua toàn bộ (request kia
    // đã xử xong) → cả 2 trường hợp đi tiếp tới chốt chuyến (CAS phía dưới đảm bảo chỉ 1 người thắng).
    if (pending.length > 0 && successCount === 0 && failed.length > 0) {
      return res.status(409).json({
        success: false,
        error: { code: 'INSUFFICIENT_STOCK', message: `Không xuất được — ${failed.map(f => `${f.material_code} (${f.message})`).join(' · ')}` },
        data: await fetchGDOFull(gdoId),
      })
    }

    // Có xuất được → tự Bắt đầu + Giao (nếu chưa) + gắn biển số.
    // neq COMPLETED: request thua đua đến sau KHÔNG được lật chuyến đã hoàn thành về IN_PROGRESS.
    const t = now()
    await supabase.from('GroupDeliveryOrder').update({
      status: 'IN_PROGRESS',
      ...(normalizePlate(license_plate) ? { license_plate: normalizePlate(license_plate) } : {}),
      ...(gdo.assigned_at ? {} : { assigned_at: t, assigned_by: actor }),
      ...(gdo.started_at  ? {} : { started_at: t }),
      ...(qxeWaiveNow
        ? { weigh_waived_at: t, weigh_waived_by: actor, weigh_waive_reason: String(weigh_waive_reason ?? '').trim() || null }
        : {}),
      updated_by: actor, updated_at: t,
    }).eq('id', gdoId).neq('status', 'COMPLETED')
    await linkWeighTicket(qxeWeighTicketId, gdoId)   // gắn phiếu cân ↔ chuyến (đối chiếu KL)

    // Còn mã thiếu tồn → đơn IN_PROGRESS (đã xuất một phần), user xử tiếp trên trang chuyến.
    if (failed.length) {
      return res.status(409).json({
        success: false,
        error: { code: 'PARTIAL_EXPORT', message: `Đã xuất ${successCount} mã; ${failed.length} mã chưa xuất được — xử tiếp trên trang chuyến: ${failed.map(f => `${f.material_code} (${f.message})`).join(' · ')}` },
        data: await fetchGDOFull(gdoId),
      })
    }

    const tEnd = now()
    // CAS: chỉ winner (người thật sự chuyển GDO sang COMPLETED) mới tạo/đồng bộ lệnh chuyển kho —
    // khớp patchGDO; không thì 2 request đua cùng insert TmsOrder → lệnh TRÙNG.
    const [, { data: winRows }] = await Promise.all([
      supabase.from('OutboundDelivery').update({ status: 'COMPLETED', updated_at: tEnd }).in('id', doIds),
      supabase.from('GroupDeliveryOrder')
        .update({ status: 'COMPLETED', completed_at: tEnd, scan_completed_at: tEnd, updated_by: actor, updated_at: tEnd })
        .eq('id', gdoId).neq('status', 'COMPLETED').select('id'),
    ])
    if ((winRows?.length ?? 0) > 0) await maybeAutoCreateTransferOrder(gdoId, tEnd)
    return ok(res, await fetchGDOFull(gdoId))
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── Auto-create/SYNC TmsOrder khi GDO COMPLETED — theo cờ Xác nhận giao hàng ───
// shipto khớp kho DB → QR/QTY/NONE; shipto lạ HOẶC KHÔNG có shipto (khách ngoài danh mục) → OTHER.
// Mục đích user (09/07): loại nào được tick trong cờ là lên TMS Chuyển kho để theo dõi vận chuyển.
// Gỡ hoàn thành GIỮ lệnh + booking (không xóa) → hoàn thành lại rơi vào nhánh SYNC:
// đồng bộ số liệu/đích vào CHÍNH lệnh cũ, tracking không đứt (user chốt 09/07).

async function maybeAutoCreateTransferOrder(gdoId: string, nowTs: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: gdo } = await supabase.from('GroupDeliveryOrder')
    .select('id, group_code, shipto_party, transfer_status, license_plate, warehouse_id')
    .eq('id', gdoId).single()
  if (!gdo) return

  // Lệnh cũ còn sống (sau Bỏ hoàn thành) → SYNC thay vì tạo mới
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingRows } = await supabase.from('TmsOrder')
    .select('id').eq('transfer_gdo_id', gdoId).limit(1)
  const existing = ((existingRows ?? []) as { id: string }[])[0] ?? null
  if (!existing && gdo.transfer_status) return   // trạng thái mồ côi (lệnh đã bị xóa tay) — giữ hành vi cũ

  // Cờ Xác nhận giao hàng (Cài đặt hệ thống): tắt → không tạo booking MỚI; bật → chỉ tạo cho hình thức được chọn.
  // Lệnh ĐÃ tồn tại thì vẫn sync bất kể cờ (đổi cờ giữa chừng không được làm đứt tracking).
  const dc = await getDeliveryConfirmation()
  if (!existing && !dc.enabled) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: dos } = await supabase.from('OutboundDelivery')
    .select('id, distributor_name').eq('gdo_id', gdoId)
  const doIds = (dos ?? []).map((d: { id: string }) => d.id)
  // Nhãn đích khi KHÔNG nhận diện được kho: tên KH của DO đầu
  const custLabel = ((dos ?? [])[0] as { distributor_name?: string | null } | undefined)?.distributor_name?.trim() || 'KH'

  type DestWh = { id: string; code: string; name: string; inventory_mode?: string | null; parent_warehouse_id?: string | null }
  let destWh: DestWh | null = null
  if (gdo.shipto_party) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stSafe = safeFilterValue(gdo.shipto_party)
    const { data: destWhData } = await supabase.from('Warehouse')
      .select('id, code, name, inventory_mode, parent_warehouse_id')
      .or(`code.eq.${stSafe},shipto_codes.cs.{${stSafe}}`)
      .eq('is_active', true).maybeSingle()
    destWh = (destWhData as DestWh) ?? null
  }
  // Fallback: KHÔNG có/không khớp shipto → dò TÊN khách khớp TÊN kho danh mục (gõ tay không bấm gợi ý,
  // đơn cũ chưa gắn shipto…). Khớp ĐÚNG 1 kho mới nhận (trùng tên nhiều kho → giữ OTHER cho an toàn).
  if (!destWh && custLabel !== 'KH') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: byName } = await supabase.from('Warehouse')
      .select('id, code, name, inventory_mode, parent_warehouse_id')
      .ilike('name', custLabel.replace(/[%_\\]/g, '\\$&'))   // ilike không wildcard = so bằng không phân hoa/thường
      .eq('is_active', true).limit(2)
    if ((byName ?? []).length === 1) destWh = byName![0] as DestWh
  }
  // Kho phụ nội bộ của site KHÁC (tên/shipto trùng lọt qua) → không auto-transfer, coi như khách ngoài (OTHER).
  if (destWh?.parent_warehouse_id && destWh.parent_warehouse_id !== gdo.warehouse_id) destWh = null
  // Hình thức kho nhận: kho khớp DB → QR/QTY/NONE; không khớp (khách ngoài) → OTHER.
  const modeKey = destWh ? (destWh.inventory_mode === 'NONE' ? 'NONE' : isQtyLike(destWh.inventory_mode) ? 'QTY' : 'QR') : 'OTHER'
  if (!existing && !dc.modes.includes(modeKey)) return   // loại này không được chọn → ngắt (không tạo booking mới)
  // NONE / OTHER: tài xế TỰ HOÀN THÀNH (không nhận-quét, không tạo tồn). QR/QTY: nhận-quét như cũ.
  const isSelf = modeKey === 'NONE' || modeKey === 'OTHER'

  // Kế hoạch nhập của chuyến dựng từ list này — phải ĐỦ MỌI item (cap-1000/URL dài: chunk + phân trang)
  const items = doIds.length
    ? await fetchAllByIdChunks(doIds, chunk => supabase.from('OutboundItem')
        .select('material_id, cartons_ordered, material_type, material:Material(category, base_unit, entry_unit, units_per_carton)')
        .in('do_id', chunk).order('id'))
    : ([] as any[])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matMap = new Map<string, { material_id: string; planned_boxes: number; category: string | null; units: MatUnitsQ | null }>()
  for (const item of (items ?? []) as any[]) {
    if (!item.material_id) continue
    if (!matMap.has(item.material_id))
      matMap.set(item.material_id, { material_id: item.material_id, planned_boxes: 0, category: item.material?.category ?? null, units: (item.material ?? null) as MatUnitsQ | null })
    matMap.get(item.material_id)!.planned_boxes += item.cartons_ordered || 0
  }
  if (!matMap.size) return

  // OTHER (khách ngoài, không có kho đích): scope + hiển thị theo KHO XUẤT (gdo.warehouse_id); nhãn = shipto/tên KH.
  const orderWarehouseId = destWh ? destWh.id : (gdo.warehouse_id as string)
  const orderCode = `TRF_${destWh ? destWh.code : (gdo.shipto_party || custLabel)}_${gdo.group_code}`
  const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

  const orderId = existing ? existing.id : randomUUID()
  if (existing) {
    // SYNC: đích/mã/hình thức có thể đổi sau khi sửa đơn — cập nhật TẠI CHỖ, giữ booking + lịch sử
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('TmsOrder').update({
      order_code: orderCode, warehouse_id: orderWarehouseId,
      destination_warehouse_id: destWh ? destWh.id : null,
      delivery_mode: isSelf ? 'SELF' : 'SCAN',
      updated_at: nowTs,
    }).eq('id', orderId)
    // Kế hoạch nhập làm lại theo số MỚI (chưa ai nhận — Bỏ HT bị chặn từ RECEIVING trở đi)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('inbound_plan_lines').delete().eq('tms_order_id', orderId)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('TmsOrder').insert({
      id: orderId, order_code: orderCode,
      date: vnDate, warehouse_id: orderWarehouseId,
      destination_warehouse_id: destWh ? destWh.id : null,
      direction: 'INBOUND', source_type: 'TRANSFER',
      transfer_gdo_id: gdoId,
      delivery_mode: isSelf ? 'SELF' : 'SCAN',
      planned_boxes: 0, planned_pallets: 0,
      status: 'PENDING',
      created_at: nowTs, updated_at: nowTs,
    })
  }

  const lineRows = [...matMap.values()].map(m => ({
    id: randomUUID(), tms_order_id: orderId, date: vnDate,
    warehouse_id: orderWarehouseId, warehouse_type: m.category || null,
    material_id: m.material_id, planned_boxes: m.planned_boxes,
    planned_pallets: null, status: 'ACTIVE',
    created_at: nowTs, updated_at: nowTs,
  }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('inbound_plan_lines').insert(lineRows)

  // BASE UNIT: line = base per mã; cache cấp LỆNH (cross-mã) = THÙNG QUY ĐỔI (Σ base ÷ hệ_số)
  const totalBoxes = [...matMap.values()].reduce((s, m) => s + qtyEntryDecimal(m.planned_boxes, m.units), 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('TmsOrder').update({ planned_boxes: totalBoxes, updated_at: nowTs }).eq('id', orderId)

  const plate: string | null = gdo.license_plate || null
  if (existing) {
    // Biển số đổi khi sửa đơn → cập nhật slot NẾU TMS chưa book chi tiết (chưa có SĐT lái xe)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: slots } = await supabase.from('TmsVehicleSlot')
      .select('id, driver_phone').eq('order_id', orderId).limit(1)
    const slot = ((slots ?? []) as { id: string; driver_phone: string | null }[])[0]
    if (slot && !slot.driver_phone && plate) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase.from('TmsVehicleSlot')
        .update({ license_plate: plate, status: 'BOOKED', updated_at: nowTs }).eq('id', slot.id)
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('TmsVehicleSlot').insert({
      id: randomUUID(), order_id: orderId,
      license_plate: plate,
      status: plate ? 'BOOKED' : 'PENDING',
      created_at: nowTs, updated_at: nowTs,
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('GroupDeliveryOrder')
    .update({ transfer_status: 'IN_TRANSIT', updated_at: nowTs }).eq('id', gdoId)
}

// ─── Delete GDO ───────────────────────────────────────────────

// Xóa lệnh chuyển kho gắn với các GDO — PHẢI gọi TRƯỚC khi xóa GDO
// (FK TmsOrder.transfer_gdo_id NO ACTION: còn lệnh tham chiếu thì xóa GDO nổ lỗi).
async function deleteTransferOrdersOf(gdoIds: string[]) {
  if (!gdoIds.length) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orders } = await supabase.from('TmsOrder')
    .select('id').in('transfer_gdo_id', gdoIds)
  for (const o of (orders ?? []) as { id: string }[]) {
    await supabase.from('inbound_plan_lines').delete().eq('tms_order_id', o.id)
    await supabase.from('TmsVehicleSlot').delete().eq('order_id', o.id)
    await supabase.from('TmsOrder').delete().eq('id', o.id)
  }
}

export async function deleteGDO(req: Request, res: Response) {
  try {
    if (!(await guardGdoScope(req, res, req.params.id))) return
    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select('status, group_code').eq('id', req.params.id).single()
    if (!gdo) return fail(res, 'Không tìm thấy chuyến xe', 404)
    if (gdo.status !== 'PENDING') return fail(res, 'Chỉ có thể xóa đơn ở trạng thái chờ (PENDING)', 400)

    // Chuyến sinh từ upload SAP (Kế hoạch xuất còn raw) → không xóa tại đây (đồng bộ với khóa sửa SL/xóa dòng).
    // Raw đã bị xóa ở tab Kế hoạch xuất → CHO xóa (đường dọn chuyến mồ côi — xóa KHVC không cascade).
    const { count: khvcCount } = await supabase.from('khvc_lines')
      .select('id', { count: 'exact', head: true }).eq('group_code', gdo.group_code)
    if ((khvcCount ?? 0) > 0) {
      return fail(res, `Chuyến "${gdo.group_code}" thuộc Kế hoạch xuất upload từ SAP — không xóa tại đây. Xóa Số xe ở tab Kế hoạch xuất (Dữ liệu bên ngoài) trước, rồi quay lại xóa chuyến.`, 422)
    }

    // Đơn từng hoàn thành rồi gỡ → lệnh chuyển kho vẫn còn (giữ tracking) — xóa cả chuyến thì xóa lệnh theo
    await deleteTransferOrdersOf([req.params.id])

    const { data: dos } = await supabase.from('OutboundDelivery')
      .select('id').eq('gdo_id', req.params.id)
    const doIds = (dos ?? []).map((d: any) => d.id as string)
    if (doIds.length) {
      await releaseScansForDOs(doIds)   // nhả reserved/hoàn remaining trước khi CASCADE xóa scan (chống kẹt tồn)
      await supabase.from('OutboundItem').delete().in('do_id', doIds)
      await supabase.from('OutboundDelivery').delete().in('id', doIds)
    }
    await supabase.from('GroupDeliveryOrder').delete().eq('id', req.params.id)
    return ok(res, { success: true })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── Update GDO (header + items, chỉ PENDING) ─────────────────

export async function updateGDO(req: Request, res: Response) {
  try {
    if (!requireBaseQty(req, res)) return   // BASE UNIT: chặn payload bundle cũ (thùng thập phân)
    const { delivery_date, warehouse_id, dvvt, customer_name, delivery_code, export_type, warehouse_type, items, gate_registration_id, shipto_party } = req.body as {
      delivery_date?: string; warehouse_id?: string; dvvt?: string
      customer_name?: string; delivery_code?: string; export_type?: string; warehouse_type?: string; gate_registration_id?: string | null; shipto_party?: string | null
      items?: Array<{ db_id?: string; material_code: string; cartons_ordered: number; loose_picking?: number; header_text?: string; batch_required?: string; date_required?: number; cs_responsible?: string; npp?: string }>
    }

    if (!(await guardGdoScope(req, res, req.params.id))) return
    if (items?.length) {
      const updQtyErr = invalidItemQty(items)
      if (updQtyErr) return fail(res, updQtyErr, 400)
    }
    if (warehouse_id && !guardWhCreate(req, res, warehouse_id)) return
    if ('warehouse_type' in req.body && !categoryAllowed(req, warehouse_type)) return fail(res, CATEGORY_FORBIDDEN_MSG, 403)

    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select('status, shipto_party, warehouse_id').eq('id', req.params.id).single()
    if (!gdo) return fail(res, 'Không tìm thấy chuyến xe', 404)
    if (!['PENDING', 'PAUSED'].includes(gdo.status)) return fail(res, 'Chỉ sửa được đơn ở trạng thái PENDING hoặc PAUSED', 400)

    // Luật quỹ đạo kho phụ — kiểm theo shipto HIỆU LỰC sau update (body có gửi thì lấy body, không thì giữ cũ)
    const effShipto = 'shipto_party' in req.body ? (shipto_party ?? null) : ((gdo as { shipto_party?: string | null }).shipto_party ?? null)
    const orbitErr = await internalOrbitError(warehouse_id ?? null, effShipto)
    if (orbitErr) return fail(res, orbitErr, 400)

    // ĐVVT: khớp danh mục → tên chính tắc; không khớp → giữ tên gõ tay (ĐVVT vãng lai)
    const dvvtRes = (await buildDvvtResolver())(dvvt)
    const dvvtName = dvvtRes.ok ? dvvtRes.name : (String(dvvt ?? '').trim() || null)

    const t = now()
    const gdoUpdates: Record<string, unknown> = {
      delivery_date, warehouse_id: warehouse_id ?? null, dvvt: dvvtName, updated_at: t,
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

    // BASE UNIT: số item = SỐ BASE — mã có entry phải nguyên (validate trước khi đụng items)
    {
      const codes = [...new Set(items.map(i => i.material_code).filter(Boolean))]
      const { data: umats } = codes.length
        ? await supabase.from('Material').select('material_code, base_unit, entry_unit, units_per_carton').in('material_code', codes)
        : { data: [] }
      const uMap = new Map<string, MatUnitsQ>(((umats ?? []) as any[]).map(m => [m.material_code, m]))
      const bErr = invalidItemQtyBase(items as any[], uMap)
      if (bErr) return fail(res, bErr, 422)
    }

    // Nhặt lẻ TỰ TÍNH từ Tổng (pallet-remainder) — bỏ qua loose_picking client gửi (user chốt 22/07)
    const effWh = warehouse_id !== undefined ? (warehouse_id ?? null) : ((gdo as { warehouse_id?: string | null }).warehouse_id ?? null)
    const looseMats = await loosePalletMats([...new Set(items.map(i => i.material_code).filter(Boolean))])
    const looseOf = (i: { material_code: string; cartons_ordered: number }) =>
      loosePalletRemainder(i.cartons_ordered, looseMats.get(i.material_code), effWh)

    // Lấy tất cả items của GDO (across all DOs)
    const doIds = doList.map((d: any) => d.id as string)
    const { data: existingItems } = doIds.length
      ? await supabase.from('OutboundItem')
          .select('id, do_id, material_code_raw, cartons_ordered, cartons_scanned, od_refs, material:Material!material_id(base_unit, entry_unit, units_per_carton)').in('do_id', doIds)
      : { data: [] }

    // Đơn UPLOAD từ SAP (item có od_refs liên kết DO SAP) → KHÓA sửa số lượng ở form Xuất (user chốt 22/07):
    // raw là nguồn sự thật — sửa ở đây sẽ lệch raw và bị engine đè lại khi SAP đổi. Sửa SL ở tab DO SAP.
    // Đơn TAY (od_refs rỗng) sửa tự do như cũ. Các field khác (Batch/%Date/CS/ghi chú) vẫn sửa được.
    const sapLinked = (ex: { od_refs?: unknown[] | null } | undefined | null) => ((ex?.od_refs as unknown[] | null)?.length ?? 0) > 0
    const sapQtyLockError = (ex: { material_code_raw?: string | null }) =>
      `Mã "${ex.material_code_raw}" thuộc đơn upload từ SAP — không sửa số lượng tại đây. Sửa Số lượng ở tab DO SAP (Dữ liệu bên ngoài) để đơn và dữ liệu SAP cùng khớp.`
    const sapDeleteLockError = (ex: { material_code_raw?: string | null }) =>
      `Mã "${ex.material_code_raw}" thuộc đơn upload từ SAP — không xóa dòng tại đây. Xóa dòng ở tab DO SAP (Dữ liệu bên ngoài) để đơn và dữ liệu SAP cùng khớp.`
    const sapMaterialLockError = (ex: { material_code_raw?: string | null }) =>
      `Mã "${ex.material_code_raw}" thuộc đơn upload từ SAP — không đổi mã hàng tại đây. Sửa ở tab DO SAP (Dữ liệu bên ngoài) để đơn và dữ liệu SAP cùng khớp.`

    if (isMultiDO) {
      // Multi-DO: match bằng db_id, cho phép xóa item chưa xuất
      const existingById = new Map<string, any>(
        (existingItems ?? []).map((i: any) => [i.id as string, i])
      )
      const requestedDbIds = new Set(items.filter(i => i.db_id).map(i => i.db_id as string))

      // Kiểm tra: không xóa item đã xuất + không xóa dòng đơn gốc SAP (xóa = sửa SL về 0)
      for (const [id, ex] of existingById) {
        if (!requestedDbIds.has(id) && Number(ex.cartons_scanned) > 0) {
          return fail(res, `Không thể xóa mã hàng "${ex.material_code_raw}" đã xuất ${qtyLabel(Number(ex.cartons_scanned), ex.material ?? null)}`, 400)
        }
        if (!requestedDbIds.has(id) && sapLinked(ex)) {
          return fail(res, sapDeleteLockError(ex), 422)
        }
      }

      // Kiểm tra số thùng < đã xuất + KHÓA sửa SL đơn gốc SAP
      for (const item of items) {
        if (!item.db_id) continue
        const ex = existingById.get(item.db_id)
        if (ex && item.cartons_ordered < Number(ex.cartons_scanned)) {
          return fail(res, `Số lượng "${ex.material_code_raw}" (${qtyLabel(Number(item.cartons_ordered), ex.material ?? null)}) nhỏ hơn đã xuất (${qtyLabel(Number(ex.cartons_scanned), ex.material ?? null)})`, 400)
        }
        if (ex && sapLinked(ex) && Number(item.cartons_ordered) !== Number(ex.cartons_ordered)) {
          return fail(res, sapQtyLockError(ex), 422)
        }
        // Khóa ĐỔI MÃ HÀNG dòng gốc SAP (kể cả chưa quét) — giữ liên kết SAP↔WMS, tránh reconcile báo "đổi mã" oan
        if (ex && sapLinked(ex) && ex.material_code_raw !== item.material_code) {
          return fail(res, sapMaterialLockError(ex), 422)
        }
      }

      // Xóa items bị loại bỏ (chưa xuất)
      const toDeleteIds = [...existingById.keys()].filter(id => !requestedDbIds.has(id))
      if (toDeleteIds.length) {
        await deleteByIdsChunked('OutboundItem', toDeleteIds)
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
            const fields: Record<string, unknown> = { cartons_ordered: item.cartons_ordered, loose_picking: looseOf(item), header_text: item.header_text?.trim() || null, batch_required: item.batch_required?.trim() || null, date_required: item.date_required || null, cs_responsible: item.cs_responsible?.trim() || null, export_type: export_type ?? null, status: newStatus, updated_at: t }
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
            loose_picking: looseOf(item),
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

      // Kiểm tra xóa item có scan + không xóa dòng đơn gốc SAP (xóa = sửa SL về 0)
      for (const [code, ex] of existingByCode) {
        if (!newCodes.has(code) && Number(ex.cartons_scanned) > 0) {
          return fail(res, `Không thể xóa mã hàng "${code}" đã xuất ${qtyLabel(Number(ex.cartons_scanned), ex.material ?? null)}`, 400)
        }
        if (!newCodes.has(code) && sapLinked(ex)) {
          return fail(res, sapDeleteLockError(ex), 422)
        }
      }

      // Kiểm tra số thùng < đã xuất + KHÓA sửa SL đơn gốc SAP
      for (const item of items) {
        const ex = existingByCode.get(item.material_code)
        if (ex && item.cartons_ordered < Number(ex.cartons_scanned)) {
          return fail(res, `Số lượng "${item.material_code}" (${qtyLabel(Number(item.cartons_ordered), ex.material ?? null)}) nhỏ hơn đã xuất (${qtyLabel(Number(ex.cartons_scanned), ex.material ?? null)})`, 400)
        }
        if (ex && sapLinked(ex) && Number(item.cartons_ordered) !== Number(ex.cartons_ordered)) {
          return fail(res, sapQtyLockError(ex), 422)
        }
      }

      // Xóa items bị loại bỏ
      const toDeleteIds = (existingItems ?? [])
        .filter((i: any) => !newCodes.has(i.material_code_raw as string))
        .map((i: any) => i.id as string)
      if (toDeleteIds.length) {
        await deleteByIdsChunked('OutboundItem', toDeleteIds)
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
          toUpdate.push({ id: ex.id, fields: { cartons_ordered: item.cartons_ordered, loose_picking: looseOf(item), header_text: item.header_text?.trim() || null, batch_required: item.batch_required?.trim() || null, date_required: item.date_required || null, cs_responsible: item.cs_responsible?.trim() || null, export_type: export_type ?? null, status: newStatus, updated_at: t } })
        } else {
          const matInfo = matMap.get(item.material_code)
          const material_type = matInfo?.category ?? null
          toInsert.push({ id: randomUUID(), do_id: doId, material_id: matInfo?.id ?? null, material_code_raw: item.material_code, cartons_ordered: item.cartons_ordered, boxes_display: 0, weight: null, pallets_estimated: 0, loose_picking: looseOf(item), header_text: item.header_text?.trim() || null, batch_required: item.batch_required?.trim() || null, date_required: item.date_required || null, cs_responsible: item.cs_responsible?.trim() || null, material_type, export_type: export_type ?? null, cartons_scanned: 0, status: 'PENDING', updated_at: t })
        }
      }
      await Promise.all([
        ...toUpdate.map(({ id, fields }) => supabase.from('OutboundItem').update(fields).eq('id', id)),
        ...(toInsert.length ? [supabase.from('OutboundItem').insert(toInsert)] : []),
      ])
    }

    return ok(res, await fetchGDOFull(req.params.id))
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
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
          .select('id, material_id, material_code_raw, cartons_ordered, cartons_scanned, material:Material!material_id(base_unit, entry_unit, units_per_carton)').in('do_id', doIds)
        const itemRows = (items ?? []) as { id: string; material_id: string | null; material_code_raw: string | null; cartons_ordered: number; cartons_scanned: number; material?: MatUnitsQ | null }[]
        const short = itemRows.filter(i => Number(i.cartons_scanned) < Number(i.cartons_ordered))
        if (short.length) {
          const e = short[0]
          return fail(res, `Chưa thể hoàn thành — còn ${short.length} mã chưa xuất đủ kế hoạch (vd ${e.material_code_raw ?? '?'}: ${qtyLabel(Number(e.cartons_scanned), e.material ?? null)}/${qtyLabel(Number(e.cartons_ordered), e.material ?? null)}). Sửa số lượng đơn xuống bằng thực xuất rồi hoàn thành.`, 400)
        }

        // Gác QUÉT ĐỦ TEM THÙNG (kho chọn "Bắt buộc" trong Cài đặt Kho, user chốt 15/07):
        // mỗi pallet đã quét phải có số tem thùng KHỚP mã >= số thùng của pallet.
        // Loại khỏi gác: dòng nhặt lẻ (chưa có UI quét thùng) + item no-QR (hàng không tem).
        const { data: gRow } = await supabase.from('GroupDeliveryOrder')
          .select('warehouse_id, warehouse_type').eq('id', req.params.id).maybeSingle()
        const gr = gRow as { warehouse_id?: string | null; warehouse_type?: string | null } | null
        const cartonPolicy = await warehouseCartonScanPolicy(gr?.warehouse_id, gr?.warehouse_type)
        if (cartonPolicy.requireFull) {
          const matIds = [...new Set(itemRows.map(i => i.material_id).filter(Boolean))] as string[]
          const { data: mats } = matIds.length
            ? await supabase.from('Material').select('id, no_qr_tracking').in('id', matIds)
            : { data: [] }
          const noQrSet = new Set(((mats ?? []) as { id: string; no_qr_tracking?: boolean | null }[])
            .filter(m => m.no_qr_tracking === true).map(m => m.id))
          const qrItemIds = itemRows.filter(i => !i.material_id || !noQrSet.has(i.material_id)).map(i => i.id)
          if (qrItemIds.length) {
            const { data: scans } = await supabase.from('OutboundScanEntry')
              .select('pallet_code, cartons_scanned, carton_scans, is_loose_picking, item:OutboundItem!item_id(material:Material!material_id(base_unit, entry_unit, units_per_carton))').in('item_id', qrItemIds)
            // BASE UNIT: cartons_scanned = base → số TEM THÙNG vật lý cần = ceil(base ÷ hệ_số)
            const missing = ((scans ?? []) as { pallet_code: string; cartons_scanned: number; carton_scans?: { match?: boolean }[] | null; is_loose_picking?: boolean | null; item?: { material?: MatUnitsQ | null } | null }[])
              .filter(s => !s.is_loose_picking && Number(s.cartons_scanned) > 0)
              .map(s => ({ pallet: s.pallet_code, need: Math.ceil(qtyEntryDecimal(Number(s.cartons_scanned), s.item?.material ?? null)), got: (s.carton_scans ?? []).filter(c => c?.match !== false).length }))
              .filter(s => s.got < s.need)
            if (missing.length) {
              const e = missing[0]
              return fail(res, `Kho yêu cầu QUÉT ĐỦ tem thùng — còn ${missing.length} pallet thiếu (vd ${e.pallet}: ${e.got}/${e.need} thùng). Bấm nút quét thùng trên dòng pallet để quét bổ sung rồi hoàn thành.`, 400)
            }
          }
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
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
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
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
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
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── Start GDO (Bắt đầu xuất kho) ────────────────────────────

export async function startGDO(req: Request, res: Response) {
  try {
    const {
      license_plate, container_number, exporter_name,
      loader_name, forklift_driver_id, forklift_driver_names,
      gate_registration_id, allow_shared_gate, weigh_waive, weigh_waive_reason, small_delivery,
    } = req.body as {
      license_plate?: string; container_number?: string; exporter_name?: string
      loader_name?: string; forklift_driver_id?: string; forklift_driver_names?: string
      gate_registration_id?: string | null; allow_shared_gate?: boolean
      weigh_waive?: boolean; weigh_waive_reason?: string
      small_delivery?: boolean   // GIAO LẺ (xe máy/nhân viên nhận) — tự khai, miễn gate cổng/cân, ghi vết
    }
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

    // Kho QTY/NONE: không bắt buộc Phân công — ai bấm Bắt đầu tự thành người phụ trách (kho QR giữ nghi thức Phân công)
    const { data: cur } = await supabase.from('GroupDeliveryOrder')
      .select('assigned_at, started_at, status, warehouse_id, shipto_party, weigh_waived_at, warehouse:Warehouse(inventory_mode,require_weigh_on_start)').eq('id', req.params.id).maybeSingle()
    // Chặn start đúp/start ngược trạng thái: 2 người cùng bấm → người sau đè biển số người trước;
    // tệ hơn, start trên chuyến ĐÃ hoàn thành kéo status về IN_PROGRESS (lách quyền uncomplete).
    const curStatus = (cur as { status?: string } | null)?.status
    if ((cur as { started_at?: string | null } | null)?.started_at || curStatus === 'COMPLETED' || curStatus === 'CANCELLED') {
      return fail(res, 'Chuyến đã bắt đầu hoặc đã kết thúc — dùng "Sửa thông tin xe" nếu cần đổi biển số', 400)
    }
    const curMode = (cur as { warehouse?: { inventory_mode?: string | null } | null } | null)?.warehouse?.inventory_mode ?? null
    const autoAssign = !(cur as { assigned_at?: string | null } | null)?.assigned_at && curMode !== 'QR'

    // Biển số bắt buộc, TRỪ chuyển nội bộ parent↔kho phụ (xe nâng/đẩy tay trong site)
    // và GIAO LẺ (nhân viên tự nhận không có xe — biển số tùy chọn)
    if (!license_plate?.trim() && small_delivery !== true &&
        !(await isInternalPair((cur as { warehouse_id?: string | null } | null)?.warehouse_id, (cur as { shipto_party?: string | null } | null)?.shipto_party)))
      return fail(res, 'Biển số xe là bắt buộc', 400)

    // GATE CỔNG + CÂN (kho bật cờ = quy trình chặt: đăng ký cổng → vào cổng → cân bì → bốc hàng):
    // (1) chuyến phải gắn ĐĂNG KÝ CỔNG hợp lệ (khóa đường biển vãng lai không đăng ký);
    // (2) biển số phải khớp phiếu cân CHƯA hoàn thành hôm nay.
    // Miễn khi: chuyến ĐÃ duyệt bỏ qua · người có quyền weigh_waive duyệt ngay lúc bấm (body flag)
    // · hoặc TỰ KHAI GIAO LẺ (small_delivery — xe máy/nhân viên nhận, không qua cổng-cân; không cần
    //   quyền nhưng ghi vết ai khai, user chốt 01/08).
    const alreadyWaived = !!(cur as { weigh_waived_at?: string | null } | null)?.weigh_waived_at
    const strictWeigh = ((cur as { warehouse?: { require_weigh_on_start?: boolean } | null } | null)?.warehouse)?.require_weigh_on_start === true
    let weighTicketId: string | null = null
    if (!alreadyWaived && small_delivery !== true) {
      if (weigh_waive === true) {
        if (!userHasPerm(req, 'outbound', 'weigh_waive'))
          return fail(res, 403, 'FORBIDDEN', 'Bạn không có quyền Duyệt bỏ qua cổng/cân — nhờ người được phân quyền duyệt trên chuyến')
      } else {
        if (strictWeigh && license_plate?.trim()) {   // nội bộ không biển số đã miễn ở guard trên
          const gErr = await gateRegError(gate_registration_id, (cur as { warehouse_id?: string | null } | null)?.warehouse_id, license_plate)
          if (gErr) return fail(res, 422, 'GATE_REQUIRED', gErr)
        }
        const gate = await checkWeighGate((cur as { warehouse_id?: string | null } | null)?.warehouse_id, license_plate, req.params.id)
        if (!gate.ok) return fail(res, 422, 'WEIGH_REQUIRED', gate.message)
        weighTicketId = gate.ticketId
      }
    }

    const { error } = await supabase.from('GroupDeliveryOrder')
      .update({
        started_at: now(),
        license_plate: normalizePlate(license_plate),
        container_number:       container_number       ?? null,
        exporter_name:          exporter_name          ?? null,
        loader_name:            loader_name            ?? null,
        forklift_driver_id:     forklift_driver_id     ?? null,
        forklift_driver_names:  forklift_driver_names  ?? null,
        gate_registration_id:   gate_registration_id   ?? null,
        ...(autoAssign ? { assigned_at: now(), assigned_by: req.user?.name ?? null } : {}),
        // Duyệt bỏ qua cân ngay lúc bấm (đã kiểm quyền ở trên) → ghi vết ai duyệt
        ...(weigh_waive === true && !alreadyWaived && small_delivery !== true
          ? { weigh_waived_at: now(), weigh_waived_by: req.user?.name ?? null, weigh_waive_reason: String(weigh_waive_reason ?? '').trim() || null }
          : {}),
        // Giao lẻ tự khai (xe máy/nhân viên nhận) → ghi vết ai khai — badge trên chuyến để quản lý soi
        ...(small_delivery === true
          ? { small_delivery_at: now(), small_delivery_by: req.user?.name ?? null }
          : {}),
        status:     'IN_PROGRESS',
        updated_at: now(),
      })
      .eq('id', req.params.id)
    if (error) return fail(res, error.message)
    await linkWeighTicket(weighTicketId, req.params.id)   // gắn phiếu cân ↔ chuyến (đối chiếu KL)
    const result = await fetchGDOFull(req.params.id)
    return ok(res, result)
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── Duyệt bỏ qua cân (xe không cân được: hỏng cân…) — quyền outbound.weigh_waive ───
// Người duyệt có thể KHÁC người bấm Bắt đầu: duyệt trước trên chuyến → công nhân start bình thường.

// POST /outbound/:gdoId/weigh-waive  { reason? }
export async function waiveWeighGDO(req: Request, res: Response) {
  try {
    const { reason } = req.body as { reason?: string }
    if (!(await guardGdoScope(req, res, req.params.gdoId))) return
    const { data, error } = await supabase.from('GroupDeliveryOrder')
      .update({
        weigh_waived_at: now(), weigh_waived_by: req.user?.name ?? null,
        weigh_waive_reason: String(reason ?? '').trim() || null, updated_at: now(),
      })
      .eq('id', req.params.gdoId).select('id').maybeSingle()
    if (error) return fail(res, error.message)
    if (!data) return fail(res, 'Không tìm thấy chuyến', 404)
    return ok(res, await fetchGDOFull(req.params.gdoId))
  } catch (e) { return fail(res, String(e)) }
}

// DELETE /outbound/:gdoId/weigh-waive — hủy duyệt (bấm nhầm; chuyến chưa bắt đầu mới có ý nghĩa)
export async function unwaiveWeighGDO(req: Request, res: Response) {
  try {
    if (!(await guardGdoScope(req, res, req.params.gdoId))) return
    const { data, error } = await supabase.from('GroupDeliveryOrder')
      .update({ weigh_waived_at: null, weigh_waived_by: null, weigh_waive_reason: null, updated_at: now() })
      .eq('id', req.params.gdoId).select('id').maybeSingle()
    if (error) return fail(res, error.message)
    if (!data) return fail(res, 'Không tìm thấy chuyến', 404)
    return ok(res, await fetchGDOFull(req.params.gdoId))
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
        license_plate:         normalizePlate(license_plate),
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
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── Unstart GDO (Gỡ bắt đầu) ────────────────────────────────

export async function unstartGDO(req: Request, res: Response) {
  try {
    if (!(await guardGdoScope(req, res, req.params.id))) return
    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select('started_at, warehouse:Warehouse(inventory_mode)').eq('id', req.params.id).single()
    if (!gdo?.started_at) return fail(res, 'Đơn chưa được bắt đầu', 400)
    const gdoMode = (gdo as unknown as { warehouse?: { inventory_mode?: string | null } | null }).warehouse?.inventory_mode

    // Kiểm tra chưa có QR nào được quét (bỏ qua POSM/Pallet Loscam và nhặt lẻ chưa confirm).
    // Kho NONE: không theo dõi tồn → không bao giờ quét QR pallet; entry (nếu có — dữ liệu "Xuất luôn" cũ)
    // chỉ là ghi tay, KHÔNG được chặn gỡ bắt đầu (trước đây kho NONE kẹt "Cần xóa hết QR" vô lý).
    const { data: doList } = await supabase.from('OutboundDelivery')
      .select('id').eq('gdo_id', req.params.id)
    const doIds = (doList ?? []).map((d: any) => d.id)
    if (doIds.length && gdoMode !== 'NONE') {
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
        small_delivery_at: null, small_delivery_by: null,   // giao lẻ khai theo LƯỢT bắt đầu — gỡ là khai lại
        status: 'PENDING', updated_at: t,
      })
      .eq('id', req.params.id)
    if (error) return fail(res, error.message)
    return ok(res, await fetchGDOFull(req.params.id))
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
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

    // Phương án A (user chốt 09/07): GIỮ lệnh chuyển kho + booking khi gỡ (tracking không đứt).
    // Hoàn thành lại → maybeAutoCreateTransferOrder nhánh SYNC đồng bộ số liệu vào chính lệnh cũ.
    // transfer_status giữ IN_TRANSIT để kho nhận thấy lệnh (nhưng BỊ CHẶN nhận khi gdo.status != COMPLETED).
    let keepTransfer = false
    if (ts === 'IN_TRANSIT') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: tmsOrders } = await supabase.from('TmsOrder')
        .select('id').eq('transfer_gdo_id', req.params.id).limit(1)
      keepTransfer = ((tmsOrders ?? []) as { id: string }[]).length > 0
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('GroupDeliveryOrder')
      .update({ status: 'IN_PROGRESS', completed_at: null, scan_completed_at: null, transfer_status: keepTransfer ? 'IN_TRANSIT' : null, updated_at: now() })
      .eq('id', req.params.id)
    if (error) return fail(res, error.message)
    return ok(res, await fetchGDOFull(req.params.id))
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
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
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── Merge upload for PAUSED GDO ─────────────────────────────

// Gộp các dòng CÙNG MÃ HÀNG trong 1 NPP (file SAP tách theo DO): cộng dồn số lượng.
// YÊU CẦU GIAO gộp theo mức NGHIÊM NHẤT, KHÔNG nuốt của dòng khác (bug cũ first-non-empty làm giao sai lô):
//   %Date → MAX (hạn cao nhất) · Batch + HEADER TEXT → nối DISTINCT (' | '). Field xe (loại/CS) → đầu tiên.
// (Xung đột batch-cụ-thể khác nhau trên cùng mã = nợ Đợt 2 với od_refs — hiện data batch rỗng, nối để không mất.)
function mergeNppRows(rows: Record<string, any>[]): Record<string, any>[] {
  const byMat = new Map<string, Record<string, any>>()
  const joinDistinct = (a: unknown, b: unknown): string =>
    [...new Set([String(a ?? '').trim(), String(b ?? '').trim()].filter(Boolean))].join(' | ')
  for (const row of rows) {
    const code = String(row['Material'] ?? '').trim()
    const cur = byMat.get(code)
    // clone __od_refs sang mảng MỚI để lần gộp sau không mutate mảng của dòng gốc (share-ref)
    if (!cur) { byMat.set(code, { ...row, __od_refs: [...(Array.isArray(row['__od_refs']) ? row['__od_refs'] : [])] }); continue }
    cur['__od_refs'] = [...(cur['__od_refs'] ?? []), ...(Array.isArray(row['__od_refs']) ? row['__od_refs'] : [])]
    for (const f of ['Thùng', 'Hộp', 'Tải', 'Nhặt lẻ']) cur[f] = parseDecimal(cur[f]) + parseDecimal(row[f])
    cur['Pallet'] = parseDecimal(String(cur['Pallet'] ?? '').replace(',', '.')) + parseDecimal(String(row['Pallet'] ?? '').replace(',', '.'))
    const pd = Math.max(parseDecimal(cur['%Date_Yêu cầu']), parseDecimal(row['%Date_Yêu cầu']))
    cur['%Date_Yêu cầu'] = pd > 0 ? pd : (String(cur['%Date_Yêu cầu'] ?? '').trim() || row['%Date_Yêu cầu'])
    cur['Batch_Yêu cầu'] = joinDistinct(cur['Batch_Yêu cầu'], row['Batch_Yêu cầu'])
    cur['HEADER TEXT']   = joinDistinct(cur['HEADER TEXT'], row['HEADER TEXT'])
    for (const f of ['Material_type', 'Loại xuất', 'CS phụ trách'])
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
  matMap: Map<string, { id: string } & MatPalletUnits>,
  autoLoosePallet = false,   // true (KHVC/SAP): loose = phần thùng lẻ < 1 pallet, tính trên qty base đã gộp
): Promise<{ group_code: string; id?: string; merged?: boolean; skipped?: boolean; reason?: string }> {
  const t = now()

  const { data: existingDOs } = await supabase.from('OutboundDelivery')
    .select('id, delivery_code, distributor_name').eq('gdo_id', gdoId)

  const existingDoIds = (existingDOs ?? []).map((d: any) => d.id as string)
  // Chunk 300 (chuyến nhiều NPP → nhiều DO): `.in()` quá ~300 id là vỡ URL PostgREST
  const existingItems = existingDoIds.length
    ? await fetchAllByIdChunks(existingDoIds, chunk => supabase.from('OutboundItem')
        .select('id, do_id, material_code_raw, cartons_scanned').in('do_id', chunk).order('id'))
    : []

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
      missingScanned.push(`${item.material_code_raw} (NPP ${npp || '—'}, đã xuất ${qtyLabel(Number(item.cartons_scanned), matMap.get(item.material_code_raw ?? '') ?? null)})`)
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
      const mu         = matMap.get(mat_code) ?? null
      const newCartons = uploadRowQtyBase(row, mu)   // BASE — so cùng đơn vị với cartons_scanned
      const existing   = existingItemByNppMat.get(`${npp}::${mat_code}`)
      if (existing && newCartons < Number(existing.cartons_scanned)) {
        cartonErrors.push(`${mat_code} (mới ${qtyLabel(newCartons, mu)} < đã xuất ${qtyLabel(Number(existing.cartons_scanned), mu)})`)
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
    await deleteByIdsChunked('OutboundItem', staleItemIds)
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
      const mu            = matMap.get(mat_code) ?? null
      const newCartons    = uploadRowQtyBase(row, mu)
      const fields = {
        do_id:             doId,
        material_id:       mu?.id ?? null,
        material_code_raw: mat_code,
        cartons_ordered:   newCartons,
        boxes_display:     parseDecimal(row['Hộp']),
        weight:            parseDecimal(row['Tải']),
        loose_picking:     autoLoosePallet ? loosePalletRemainder(newCartons, mu, warehouse_id) : parseDecimal(row['Nhặt lẻ']),
        pallets_estimated: parseDecimal(String(row['Pallet'] ?? '').replace(',', '.')),
        material_type,
        export_type:    String(row['Loại xuất']     ?? '').trim() || null,
        header_text:    String(row['HEADER TEXT']   ?? '').trim() || null,
        batch_required: String(row['Batch_Yêu cầu'] ?? '').trim() || null,
        date_required:  parseDecimal(row['%Date_Yêu cầu']) || null,
        cs_responsible: String(row['CS phụ trách']  ?? '').trim() || null,
        od_refs:        Array.isArray(row['__od_refs']) ? row['__od_refs'] : [],   // recompute liên kết OD khi up lại (KHVC); file gộp trực tiếp → []
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
    // GIỮ DO thừa còn item scanned>0 (dữ liệu đã xuất — mất là hỏng; legacy hiếm) — chỉ xóa DO RỖNG.
    const { data: staleItemsChk } = await supabase.from('OutboundItem')
      .select('do_id, cartons_scanned').in('do_id', staleDOIds)
    const doWithScanned = new Set(((staleItemsChk ?? []) as { do_id: string; cartons_scanned: number }[])
      .filter(i => Number(i.cartons_scanned) > 0).map(i => i.do_id))
    const safeToDelete = staleDOIds.filter(id => !doWithScanned.has(id))
    if (safeToDelete.length) {
      await releaseScansForDOs(safeToDelete)   // nhả tồn trước cascade (an toàn — DO rỗng thường no-op)
      await deleteByIdsChunked('OutboundDelivery', safeToDelete)
    }
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

    return await processVehicleGroups(req, res, byVehicle, warehouse_id)
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// Xử lý CHUNG cho mọi nguồn upload kế hoạch xuất — nhận map (Số xe → các dòng theo row-shape file gộp):
//  - uploadExcel : file gộp 1 sheet (Số xe + mọi cột trong 1 hàng)
//  - uploadKhvc  : join VL06O(raw) + KHVC → reshape về CÙNG row-shape rồi gọi hàm này
// Tách ra để TÁI DÙNG nguyên vẹn logic re-upload (ghi đè PENDING / giữ đã-gán / merge PAUSED / bỏ ĐANG XUẤT).
async function processVehicleGroups(
  req: Request, res: Response,
  byVehicle: Map<string, Record<string, any>[]>,
  warehouse_id: string | undefined,
  extraResult?: Record<string, unknown>,
  autoLoosePallet = false,   // true (KHVC/SAP): nhặt lẻ = thùng lẻ < 1 pallet, auto theo cartons_per_pallet
  preflightExtra?: PreflightExtra[],   // số liệu rủi ro riêng của luồng (KHVC: DO thiếu, chuyến đã có…)
): Promise<Response> {
    // Pre-load warehouses, materials, warehouse types, and existing GDOs in parallel
    const allGroupCodes = [...byVehicle.keys()]
    const [warehousesRes, whTypesRes, vehicleTypesRes, existingGdos, allMaterials] = await Promise.all([
      supabase.from('Warehouse').select('id, code, name').eq('is_active', true),
      // LookupValue KHÔNG có cột is_active — lọc theo nó làm query lỗi → validWhTypes rỗng → chặn oan mọi file
      supabase.from('LookupValue').select('value').eq('type', 'warehouse_type'),
      supabase.from('VehicleType').select('code, name').eq('is_active', true),
      // Chunk + phân trang: file nhiều nghìn Số xe → .in() 1 phát vừa vượt URL vừa bị cap-1000
      // (GDO thứ 1001+ bị coi là "mới" → tạo trùng)
      fetchAllByIdChunks(allGroupCodes, chunk => supabase.from('GroupDeliveryOrder')
        .select('id, group_code, status, assigned_at, assigned_by, shipto_party')
        .in('group_code', chunk).order('id')),
      // PHÂN TRANG: >1000 mã → nếu không phân trang bị cap 1000 → mã ngoài 1000 bị báo oan "chưa có trong hệ thống"
      fetchAllRowsParallel(() => supabase.from('Material').select('id, material_code, base_unit, entry_unit, units_per_carton, cartons_per_pallet, warehouse_pallet_overrides, is_non_stock')) as Promise<({ id: string; material_code: string; is_non_stock?: boolean } & MatPalletUnits)[]>,
    ])

    const warehouseByKey = new Map<string, string>()
    for (const w of (warehousesRes.data ?? []) as { id: string; code: string; name: string }[]) {
      warehouseByKey.set(w.code.trim().toLowerCase(), w.id)
      warehouseByKey.set(w.name.trim().toLowerCase(), w.id)
    }
    const matMap = new Map<string, { id: string; is_non_stock?: boolean } & MatPalletUnits>(
      allMaterials.map(m => [String(m.material_code).trim(), m])
    )
    // Mã PHI HÀNG HÓA (chiết khấu/dịch vụ) — LOẠI khỏi chuyến (không sinh dòng cần quét); vẫn giữ ở raw erp_outbound_orders.
    const isNonStock = (code: string) => matMap.get(String(code).trim())?.is_non_stock === true
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

    for (const g of (existingGdos ?? [])) {
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
      // Scope Loại hàng: chặn upload tạo chuyến loại ngoài phạm vi user
      const outScopeTypes = loaiKhoVals.filter(v => !categoryAllowed(req, v))
      if (outScopeTypes.length) errs.push(`Loại kho "${outScopeTypes.join(', ')}" ngoài phạm vi của bạn`)

      const unknownMatsV = [...new Set(
        groupRows.filter(r => String(r['Material'] ?? '').trim()).map(r => String(r['Material']).trim())
      )].filter(c => !matMap.has(c))
      if (unknownMatsV.length) errs.push(`Mã hàng chưa có trong hệ thống: ${unknownMatsV.join(', ')}`)

      const dvvt_v = String(groupRows[0]['DVVT'] ?? groupRows[0]['Đơn vị'] ?? '').trim()
      if (dvvt_v && !resolveDvvt(dvvt_v).ok) errs.push(`ĐVVT "${dvvt_v}" không khớp danh mục (mã/alias/tên)`)

      if (groupRows.some(r => !String(r['Material'] ?? '').trim()))
        errs.push('Có dòng trống cột Material')

      // Loại xuất bắt buộc (Material_type KHÔNG bắt buộc — vd dòng Pallet Loscam để trống hợp lý)
      // Mã phi hàng hóa (chiết khấu/dịch vụ) LOẠI khỏi validate dòng (không bắt Loại xuất/số nguyên) — sẽ bỏ khỏi chuyến
      const dataRows = groupRows.filter(r => { const c = String(r['Material'] ?? '').trim(); return c && !isNonStock(c) })
      const missExport = dataRows.filter(r => !String(r['Loại xuất'] ?? '').trim()).length
      if (missExport) errs.push(`Thiếu Loại xuất ở ${missExport} dòng`)
      // Loại xuất PHẢI khớp danh mục Loại xe TMS (Material_type thì không khóa)
      const badExport = [...new Set(dataRows.map(r => String(r['Loại xuất'] ?? '').trim()).filter(Boolean))]
        .filter(v => !resolveVehicleType(v))
      if (badExport.length) errs.push(`Loại xuất "${badExport.join(', ')}" không khớp danh mục Loại xe TMS`)

      // BASE UNIT (luật user 19/07): mã có entry → Thùng/Hộp/Nhặt lẻ SỐ NGUYÊN — lỗi theo dòng kèm gợi ý quy đổi
      for (const r of dataRows) {
        const mc = String(r['Material']).trim()
        const qe = uploadRowQtyError(r, matMap.get(mc) ?? null)
        if (qe) errs.push(`Mã ${mc}: ${qe}`)
      }

      // Chuyến Đang xuất / Đã hoàn thành: KHÔNG chặn cả file (user chốt 04/07) — bỏ qua chuyến đó
      // ở Phase 2 + báo rõ trong kết quả; chỉ lỗi DỮ LIỆU thật mới chặn toàn file.

      if (errs.length) validationErrors.push({ group_code, errors: errs })
    }

    if (validationErrors.length > 0) {
      // KIỂM TRƯỚC: trả 200 + báo cáo chuẩn (dialog hiện bảng vấn đề) thay vì 400 — chưa ghi gì cả.
      if (isPreflight(req)) return ok(res, buildPreflight({
        unit: 'chuyến', total: byVehicle.size,
        errors: validationErrors.flatMap(v => v.errors.map(e => `Số xe ${v.group_code} — ${e}`)),
        extra: preflightExtra,
      }))
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
    let pausedMerges = 0          // chỉ dùng ở nhánh preflight (đếm chuyến TẠM DỪNG sẽ được merge)
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
      const priority = String(groupRows[0]['Ưu tiên'] ?? groupRows[0]['Uu tien'] ?? '').trim() || null   // ĐỢT 3: ưu tiên chuyến (KHVC)
      const transport_note = String(groupRows[0]['Note'] ?? groupRows[0]['Ghi chú'] ?? '').trim() || null // ĐỢT 3: ghi chú điều vận (KHVC, cấp chuyến)
      const loaiKhoSet = [...new Set(groupRows.map(r => String(r['Loại kho'] ?? r['Loai kho'] ?? '').trim()).filter(Boolean))]
      const loai_kho = loaiKhoSet.length ? loaiKhoSet.join('+') : null

      const resolved_warehouse_id = kho_xuat
        ? warehouseByKey.get(kho_xuat.toLowerCase())!
        : (warehouse_id ?? null)

      // Gom theo TÊN NPP (chuẩn nghiệp vụ chốt 04/07): NPP mới là chìa khóa tách dòng trong 1 chuyến;
      // DO/Delivery chỉ là THAM KHẢO từ SAP — lưu nối chuỗi vào delivery_code, không có vai trò khác.
      const byNpp = new Map<string, Record<string, any>[]>()
      for (const row of groupRows) {
        if (isNonStock(String(row['Material'] ?? '').trim())) continue   // bỏ mã phi hàng hóa khỏi chuyến (giữ ở raw)
        const npp = String(row['Tên NPP'] ?? '').trim()
        const list = byNpp.get(npp) ?? []
        list.push(row)
        byNpp.set(npp, list)
      }
      // Cả chuyến chỉ toàn mã phi hàng hóa → không tạo chuyến rỗng
      if (byNpp.size === 0) {
        created.push({ group_code, skipped: true, reason: 'Chỉ có mã phi hàng hóa (chiết khấu/dịch vụ) — không tạo chuyến' })
        continue
      }

      // Ship-to = giá trị GỐC từ cột "Shipto party" của file (verbatim) — KHÔNG suy từ Tên NPP,
      // KHÔNG chặn/lọc theo kho (SAP điền mã ship-to mọi khách hàng; lưu nguyên để hiển thị).
      // Chuyển kho (Kế hoạch VC) tự lọc kho QR/QTY khi Hoàn thành. File không có → giữ ship-to đã gán tay.
      const shiptoColVals = [...new Set(groupRows.map(r => String(r['Shipto party'] ?? r['Shipto_party'] ?? '').trim()).filter(Boolean))]
      const resolvedShipto = shiptoColVals[0] ?? shiptoByGroupCode.get(group_code) ?? null

      // PAUSED → merge (strict: scanned items must all exist in new file)
      if (pausedGDOMap.has(group_code)) {
        // KIỂM TRƯỚC: mergePausedGDO GHI ngay (merge vào chuyến cũ) → nhánh preflight phải nhảy qua,
        // chỉ đếm để báo "sẽ merge N chuyến tạm dừng". Không có dòng này thì "kiểm trước" lại ghi thật.
        if (isPreflight(req)) { pausedMerges++; continue }
        const mergeResult = await mergePausedGDO(
          pausedGDOMap.get(group_code)!,
          group_code, delivery_date, planned_date,
          resolved_warehouse_id, dvvt, loai_kho,
          byNpp, matMap, autoLoosePallet
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
            const mu            = matMap.get(mat_code) ?? null
            const orderedBase   = uploadRowQtyBase(row, mu)
            itemInserts.push({
              id: randomUUID(), do_id: doId,
              material_id:       mu?.id ?? null,
              material_code_raw: mat_code,
              cartons_ordered:   orderedBase,
              boxes_display:     parseDecimal(row['Hộp']),
              weight:            parseDecimal(row['Tải']),
              loose_picking:     autoLoosePallet ? loosePalletRemainder(orderedBase, mu, resolved_warehouse_id) : parseDecimal(row['Nhặt lẻ']),
              pallets_estimated: parseDecimal(String(row['Pallet'] ?? '').replace(',', '.')),
              material_type,
              export_type:    String(row['Loại xuất']     ?? '').trim() || null,
              header_text:    String(row['HEADER TEXT']   ?? '').trim() || null,
              batch_required: String(row['Batch_Yêu cầu'] ?? '').trim() || null,
              date_required:  parseDecimal(row['%Date_Yêu cầu']) || null,
              cs_responsible: String(row['CS phụ trách']  ?? '').trim() || null,
              od_refs:        Array.isArray(row['__od_refs']) ? row['__od_refs'] : [],   // liên kết ngược dòng OD (KHVC); file gộp trực tiếp → []
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
          fields: { delivery_date, planned_date, warehouse_id: resolved_warehouse_id, dvvt, warehouse_type: loai_kho, shipto_party: resolvedShipto, priority, transport_note, updated_at: now() },
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
        priority,                       // ĐỢT 3: ưu tiên chuyến (null = không đặt)
        transport_note,                 // ĐỢT 3: ghi chú điều vận (null = không có)
        status: 'PENDING', created_by: actor, updated_by: actor, updated_at: now(),
      })
      collectDOsAndItems(gdoId)
      created.push({ group_code, id: gdoId, created: true })
    }

    // ── KIỂM TRƯỚC (preflight): đã build xong mọi thứ, CHƯA ghi 1 dòng nào → trả báo cáo rồi dừng.
    // Đếm lấy từ chính các mảng sắp ghi: chuyến mới = gdoInserts, ghi đè kế hoạch cũ = toReplace +
    // toPreserve (chuyến PENDING đã gán người thì giữ phân công), bỏ qua = chuyến đang xuất/đã HT.
    if (isPreflight(req)) {
      const skippedTrips = created.filter((c: any) => c.skipped).length
      const overwrite = toReplaceIds.length + toPreserveIds.length
      return ok(res, buildPreflight({
        unit: 'chuyến', total: byVehicle.size,
        toInsert: gdoInserts.length, toUpdate: overwrite + pausedMerges, skipped: skippedTrips,
        extra: [
          ...(preflightExtra ?? []),
          { label: 'Dòng hàng sẽ ghi', value: itemInserts.length },
          ...(pausedMerges ? [{ label: 'Chuyến TẠM DỪNG sẽ merge thêm hàng', value: pausedMerges, warn: true }] : []),
          ...(overwrite ? [{ label: 'Chuyến GHI ĐÈ kế hoạch cũ', value: overwrite, warn: true }] : []),
          ...(toPreserveIds.length ? [{ label: 'Trong đó giữ phân công đã gán', value: toPreserveIds.length }] : []),
          ...(skippedTrips ? [{ label: 'Bỏ qua (đang xuất / đã hoàn thành)', value: skippedTrips, warn: true }] : []),
        ],
      }))
    }

    // ── Delete validated PENDING GDOs ──
    // .in() với danh sách id lớn phải chia lô 300 — file nhiều nghìn xe → URL quá dài (414/Bad Request)
    const idChunks = (arr: string[], n = 300): string[][] =>
      Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

    // Simple PENDING → cascade delete entire GDO
    if (toReplaceIds.length) {
      // GDO PENDING vẫn có thể còn lệnh chuyển kho (Bỏ HT → Gỡ BĐ giữ lệnh) — xóa lệnh trước, không thì FK chặn xóa GDO
      await deleteTransferOrdersOf(toReplaceIds)
      const dosToDelete = await fetchAllByIdChunks(toReplaceIds, c => supabase.from('OutboundDelivery')
        .select('id').in('gdo_id', c).order('id'))
      const doIdsToDelete = (dosToDelete ?? []).map((d: any) => d.id as string)
      await releaseScansForDOs(doIdsToDelete)   // nhả tồn trước CASCADE (chống kẹt tồn nhặt lẻ pre-start)
      for (const c of idChunks(doIdsToDelete)) {
        await supabase.from('OutboundItem').delete().in('do_id', c)
        await supabase.from('OutboundDelivery').delete().in('id', c)
      }
      for (const c of idChunks(toReplaceIds)) {
        await supabase.from('GroupDeliveryOrder').delete().in('id', c)
      }
    }

    // Preserve PENDING → delete DOs/Items only, update GDO header
    if (toPreserveIds.length) {
      const dosToDelete = await fetchAllByIdChunks(toPreserveIds, c => supabase.from('OutboundDelivery')
        .select('id').in('gdo_id', c).order('id'))
      const doIdsToDelete = (dosToDelete ?? []).map((d: any) => d.id as string)
      await releaseScansForDOs(doIdsToDelete)   // nhả tồn trước CASCADE (chống kẹt tồn nhặt lẻ pre-start)
      for (const c of idChunks(doIdsToDelete)) {
        await supabase.from('OutboundItem').delete().in('do_id', c)
        await supabase.from('OutboundDelivery').delete().in('id', c)
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
        if (error) {
          const err = new Error(`${table}: ${error.message}`) as Error & { pgCode?: string }
          err.pgCode = error.code
          throw err
        }
      }
    }

    try {
      if (gdoInserts.length)  await batchInsert('GroupDeliveryOrder', gdoInserts)
      if (doInserts.length)   await batchInsert('OutboundDelivery',   doInserts)
      if (itemInserts.length) await batchInsert('OutboundItem',       itemInserts)
    } catch (e) {
      // Thua đua với upload khác cùng group_code (unique GroupDeliveryOrder_group_code_key) —
      // chuyến của người kia đã ghi xong; upload lại là idempotent (thấy PENDING → ghi đè chuẩn).
      if ((e as { pgCode?: string }).pgCode === '23505')
        return fail(res, 'Có người khác vừa upload trùng chuyến đúng cùng lúc — dữ liệu của họ đã được ghi. Bấm Upload lại file để ghi đè/kiểm tra.', 409)
      throw e
    }

    return ok(res, { created, ...(extraResult ?? {}) }, 201)
}

// ─── ĐỢT 3 (BASE UNIT): "Up kế hoạch VC" — 2 tầng raw SAP → derived ──────────────
// Tầng 1: uploadVl06o → BẢN SAO NGUYÊN VĂN dòng VL06O vào erp_outbound_orders (raw không mất).
// Tầng 2: uploadKhvc  → JOIN raw theo DO → sinh GDO/DO/Item (số = BASE từ Actual delivery qty).

type ErpRawLine = {
  od_number: string; od_item: string; material_code: string | null; qty_base: number | null
  ship_to_code: string | null; ship_to_name: string | null; batch: string | null
  pct_date_req: number | null; note_delivery: string | null; note_invoice: string | null
}

// Upload VL06O (SAP) → tầng RAW. Giữ NGUYÊN tên cột SAP (map theo header) — endpoint SAP tương lai
// dump ra là ingest được ngay; cột `raw` jsonb ôm TOÀN BỘ dòng gốc (an toàn cột thêm sau).
export async function uploadVl06o(req: Request, res: Response) {
  try {
    if (!req.file) return fail(res, 'Không có file upload', 400)
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]   // SHEET ĐẦU TIÊN (chốt user)
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' })
    if (!rows.length) return fail(res, 'File VL06O trống hoặc không đúng định dạng', 400)

    // Guard HEADER (U5): phân biệt CỘT thiếu (chặn, báo rõ) vs Ô rỗng (bỏ dòng đó). sheet_to_json giữ mọi cột có trong sheet làm key.
    const headerKeys = new Set(Object.keys(rows[0] ?? {}))
    const missingCols = ['Delivery', 'Item'].filter(c => !headerKeys.has(c))
    if (missingCols.length) return fail(res, `File thiếu cột bắt buộc: ${missingCols.join(', ')} — kiểm tra đúng file VL06O (sheet đầu tiên)`, 400)

    // Materials để CHẶN đơn vị lệch (base/sales unit) + cross-check số lượng (cảnh báo)
    const mats = await fetchAllRowsParallel(() => supabase.from('Material')
      .select('material_code, base_unit, entry_unit, units_per_carton, short_name')) as { material_code: string; base_unit: string | null; entry_unit: string | null; units_per_carton: number | null; short_name: string | null }[]
    const matByCode = new Map(mats.map(m => [String(m.material_code).trim(), m]))

    const actor = req.user?.name || null
    const t = now()
    const records: Record<string, unknown>[] = []
    const seen = new Set<string>()
    const warnings: string[] = []
    // CHẶN: đơn vị trong file không khớp Material master (base_unit / sales unit) — gom theo mã để hiện BẢNG
    type UnitErr = { material_code: string; material_name: string; kind: string; file_value: string; system_value: string }
    const unitErrs = new Map<string, UnitErr>()
    let skippedNoKey = 0

    for (const r of rows) {
      const od = cellStr(r['Delivery']); const item = cellStr(r['Item'])
      if (!od || !item) { skippedNoKey++; continue }
      const key = `${od}__${item}`
      if (seen.has(key)) continue      // trùng od+item trong cùng file → giữ dòng đầu
      seen.add(key)

      const mc = cellStr(r['Material'])
      const qtyBase  = cellNum(r['Actual delivery qty'])
      const qtySales = cellNum(r['Delivery Quantity'])
      const baseUnit = cellStr(r['Base Unit of Measure'])
      const salesUnit = cellStr(r['Sales Unit'])
      const mat = mc ? matByCode.get(mc) : null
      // CHẶN 1 — Đơn vị GỐC file ≠ khai báo hệ thống (sửa base_unit ở Mã hàng rồi up lại)
      if (mat && baseUnit && mat.base_unit && baseUnit.toUpperCase() !== String(mat.base_unit).toUpperCase())
        unitErrs.set(`${mc}|base`, { material_code: mc!, material_name: mat.short_name ?? (cellStr(r['Item Description']) ?? ''), kind: 'Đơn vị gốc', file_value: baseUnit, system_value: String(mat.base_unit) })
      // CHẶN 2 — Đơn vị BÁN (Sales Unit) không thuộc đơn vị hệ thống biết (thùng entry_unit HOẶC gốc base_unit)
      if (mat && salesUnit) {
        const allowed = [mat.entry_unit, mat.base_unit].filter(Boolean).map(x => String(x).toUpperCase())
        if (allowed.length && !allowed.includes(salesUnit.toUpperCase()))
          unitErrs.set(`${mc}|sales`, { material_code: mc!, material_name: mat.short_name ?? (cellStr(r['Item Description']) ?? ''), kind: 'Đơn vị bán', file_value: salesUnit, system_value: [mat.entry_unit, mat.base_unit].filter(Boolean).join(' / ') })
      }
      // Kiểm chéo SL: Actual delivery qty phải khớp Delivery Quantity theo ĐÚNG Sales Unit —
      // bán theo GỐC (Sales Unit = Base Unit) → Actual == Delivery Qty; bán theo THÙNG → × hệ_số.
      // (Trước: luôn ×hệ_số → báo nhầm hàng loạt khi SAP bán thẳng đơn vị gốc HOP/EA.)
      if (mat && qtySales != null && qtyBase != null && salesUnit && baseUnit) {
        const su = salesUnit.toUpperCase(), bu = baseUnit.toUpperCase()
        const upc = Number(mat.units_per_carton) || 0
        if (su === bu) {
          if (Math.round(qtySales) !== Math.round(qtyBase))
            warnings.push(`DO ${od}/${item} mã ${mc}: bán theo ${salesUnit} nhưng Actual ${qtyBase} ≠ SL ${qtySales}`)
        } else if (upc > 0 && Math.round(qtySales * upc) !== Math.round(qtyBase)) {
          warnings.push(`DO ${od}/${item} mã ${mc}: ${qtySales} ${salesUnit} × ${upc} ≠ ${qtyBase} ${baseUnit} (Actual)`)
        }
      }

      records.push({
        od_number: od, od_item: item,      // id gán ở bước classify (giữ id cũ nếu UPDATE — chống churn PK)
        material_code: mc, material_name: cellStr(r['Item Description']),
        qty_sales: qtySales, sales_unit: cellStr(r['Sales Unit']),
        qty_base: qtyBase, base_unit: baseUnit,
        ship_to_code: cellStr(r['Ship-to Party']), ship_to_name: cellStr(r['Name ship-to party']),
        plant: cellStr(r['Plant']), storage_location: cellStr(r['Storage Location']),
        batch: cellStr(r['Batch']), batch_so: cellStr(r['Batch SO']),
        date_req: cellNum(r['Date (Ngày)']), pct_date_req: cellNum(r['Date (%)']),
        note_delivery: cellStr(r['Ghi chú giao hàng']), note_invoice: cellStr(r['Ghi chú hoá đơn']),
        shipping_point: cellStr(r['Shipping Point/Receiving Pt']), license_plate: cellStr(r['Biển số xe']),
        source: 'EXCEL', raw: r, uploaded_by: actor, sync_status: 'ACTIVE', last_synced_at: t, updated_at: t,
      })
    }
    if (!records.length) return fail(res, 'Không có dòng hợp lệ (thiếu Delivery/Item)', 400)

    // ── SCOPE KHO cho file SAP (user chốt 26/07: "siết theo kho") ──
    // Dòng VL06O mang mã SAP `plant` + `storage_location` (KHÔNG phải Warehouse.code) → map qua 2 cột
    // khai per kho `Warehouse.sap_plant` / `sap_storage_locations` (migration 20260726_warehouse_sap_mapping).
    // Khớp (plant, sloc) trước, không thấy thì khớp theo plant. Dòng map ĐƯỢC mà kho ngoài phạm vi → CHẶN
    // (all-or-nothing: chưa ghi gì). Dòng KHÔNG map được kho nào → cho qua + đếm cảnh báo (fail-open có
    // chủ đích: fail-closed sẽ chặn upload tới khi khai đủ map = chặn vận hành).
    let sapUnmapped = 0
    {
      const scope = scopeWhIds(req)
      if (scope !== null) {
        const { data: whMapRows } = await supabase.from('Warehouse')
          .select('id, code, name, sap_plant, sap_storage_locations').not('sap_plant', 'is', null)
        const whMap = (whMapRows ?? []) as { id: string; code: string; name: string; sap_plant: string | null; sap_storage_locations: string[] | null }[]
        const norm = (v: unknown) => String(v ?? '').trim().toUpperCase()
        const resolveWh = (plant: unknown, sloc: unknown) => {
          const p = norm(plant), s = norm(sloc)
          if (!p) return null
          const byPair = whMap.find(w => norm(w.sap_plant) === p && (w.sap_storage_locations ?? []).some(x => norm(x) === s))
          if (byPair) return byPair
          return whMap.find(w => norm(w.sap_plant) === p && (w.sap_storage_locations ?? []).length === 0) ?? null
        }
        const outside = new Map<string, string>()   // kho ngoài phạm vi → nhãn
        for (const r of records) {
          const wh = resolveWh(r.plant, r.storage_location)
          if (!wh) { sapUnmapped++; continue }
          if (!scope.includes(wh.id)) outside.set(wh.id, `${wh.name} (plant ${norm(r.plant)}${norm(r.storage_location) ? `/${norm(r.storage_location)}` : ''})`)
        }
        if (outside.size) return fail(res,
          `Ngoài phạm vi kho — file VL06O chứa dòng của: ${[...outside.values()].join(', ')}. Chỉ upload file của kho được giao.`, 403)
      }
    }

    // ── PREFLIGHT: kiểm + cảnh báo TRƯỚC khi ghi — file chứa DO đã lên chuyến? (KHÔNG ghi gì) ──
    if (isPreflight(req)) {
      const dos = [...new Set(records.map(r => String(r.od_number)))]
      const found: { gdo_id: string; delivery_code: string | null }[] = []
      for (let i = 0; i < dos.length; i += 40) {
        const orExpr = dos.slice(i, i + 40).map(d => `delivery_code.ilike.%${safeFilterValue(d)}%`).join(',')
        const { data } = await supabase.from('OutboundDelivery').select('gdo_id, delivery_code').or(orExpr)
        for (const d of ((data ?? []) as { gdo_id: string; delivery_code: string | null }[])) found.push(d)
      }
      const dosSet = new Set(dos)
      const dosOnTrips = new Set<string>()
      const relevantGdos = new Set<string>()
      for (const d of found) {
        const toks = String(d.delivery_code ?? '').split(/,\s*/).map(x => x.trim()).filter(t => dosSet.has(t))
        if (toks.length) { toks.forEach(t => dosOnTrips.add(t)); relevantGdos.add(d.gdo_id) }
      }
      let tripsInProgress = 0, scannedItems = 0
      const gdoIds = [...relevantGdos]
      if (gdoIds.length) {
        const { data: gs } = await supabase.from('GroupDeliveryOrder').select('id, status').in('id', gdoIds)
        tripsInProgress = ((gs ?? []) as { status: string }[]).filter(g => g.status === 'IN_PROGRESS' || g.status === 'PAUSED').length
        const dvs = await fetchAllByIdChunks(gdoIds, c => supabase.from('OutboundDelivery').select('id').in('gdo_id', c).order('id')) as { id: string }[]
        const dvIds = (dvs ?? []).map(x => x.id)
        const its = await fetchAllByIdChunks(dvIds, c => supabase.from('OutboundItem').select('cartons_scanned').in('do_id', c).order('id')) as { cartons_scanned: number }[]
        scannedItems = (its ?? []).filter(i => Number(i.cartons_scanned) > 0).length
      }
      // Báo cáo CHUẨN (utils/uploadPreflight) — cùng khuôn với mọi upload khác. Lỗi đơn vị lệch hệ
      // thống là lỗi CHẶN (all-or-nothing) nên đưa vào errors → nút Xác nhận tự tắt.
      return ok(res, buildPreflight({
        unit: 'dòng', total: rows.length, toInsert: records.length, skipped: skippedNoKey,
        errors: [...unitErrs.values()].map(u =>
          `Mã ${u.material_code} (${u.material_name}) — ${u.kind} trong file "${u.file_value}" ≠ hệ thống "${u.system_value}"`),
        warnings,
        extra: [
          { label: 'Số DO trong file', value: dos.length },
          ...(sapUnmapped ? [{ label: 'Dòng không map được kho SAP', value: sapUnmapped, warn: true }] : []),
          ...(dosOnTrips.size ? [{ label: 'DO đã lên chuyến', value: dosOnTrips.size, warn: true }] : []),
          ...(tripsInProgress ? [{ label: 'Chuyến ĐANG XUẤT bị ảnh hưởng', value: tripsInProgress, warn: true }] : []),
          ...(scannedItems ? [{ label: 'Dòng đã quét thực tế', value: scannedItems, warn: true }] : []),
        ],
      }))
    }

    // CHẶN TOÀN BỘ nếu có đơn vị lệch hệ thống — KHÔNG ghi raw, trả bảng để user sửa Mã hàng rồi up lại
    if (unitErrs.size) {
      return res.status(400).json({
        success: false,
        error: { code: 'UNIT_MISMATCH', message: `${unitErrs.size} mã có đơn vị không khớp hệ thống — sửa Đơn vị ở trang Mã hàng rồi up lại.` },
        unit_errors: [...unitErrs.values()],
      })
    }

    // ── Nạp CÓ SO SÁNH (ingest-with-comparison) — thay "upsert mù" ──
    // (1) Vá churn PK: pre-fetch (od,item)→id, GIỮ id cũ khi UPDATE, randomUUID CHỈ khi INSERT.
    // (2) Idempotent: dòng y hệt (hash cột nghiệp vụ đã chuẩn hóa) = NO-OP → không ghi, không đổi id/updated_at.
    // (3) KHÔNG auto-OBSOLETE (v2.3): dòng vắng khỏi file để NGUYÊN — up tay chỉ cộng thêm/sửa.
    const BIZ = ['material_code', 'material_name', 'qty_sales', 'sales_unit', 'qty_base', 'base_unit',
      'ship_to_code', 'ship_to_name', 'plant', 'storage_location', 'batch', 'batch_so',
      'date_req', 'pct_date_req', 'note_delivery', 'note_invoice', 'shipping_point', 'license_plate'] as const
    const NUMF = new Set(['qty_sales', 'qty_base', 'date_req', 'pct_date_req'])
    const bizHash = (r: Record<string, unknown>) => JSON.stringify(BIZ.map(f => {
      const v = r[f]
      if (v == null || v === '') return null
      return NUMF.has(f) ? Number(v) : String(v)
    }))

    const odNumbers = [...new Set(records.map(r => String(r.od_number)))]
    const priorRows = await fetchAllByIdChunks(odNumbers, chunk => supabase.from('erp_outbound_orders')
      .select('id, od_number, od_item, sync_status, ' + BIZ.join(', '))
      .in('od_number', chunk).order('id')) as (Record<string, unknown> & { id: string; od_number: string; od_item: string; sync_status: string | null })[]
    const priorByKey = new Map<string, { id: string; hash: string }>()
    for (const p of (priorRows ?? [])) priorByKey.set(`${p.od_number}__${p.od_item}`, { id: p.id, hash: bizHash(p) })

    let inserted = 0, updated = 0, noop = 0
    const toWrite: Record<string, unknown>[] = []
    const updatedKeys: OdKey[] = []   // dòng SỬA (đổi cột nghiệp vụ) → reconcile
    for (const rec of records) {
      const key = `${rec.od_number}__${rec.od_item}`
      const prior = priorByKey.get(key)
      if (!prior) { toWrite.push({ id: randomUUID(), ...rec }); inserted++; continue }
      if (prior.hash === bizHash(rec)) { noop++; continue }   // NO-OP: giữ id/created_at/updated_at cũ (không ghi)
      // UPDATE: GIỮ id cũ (không churn), created_at DB giữ (không đưa vào payload); SAP/Excel đè lại → gỡ cờ sửa tay
      toWrite.push({ id: prior.id, ...rec, manual_edited_at: null }); updated++
      updatedKeys.push({ od_number: String(rec.od_number), od_item: String(rec.od_item) })
    }

    // Upsert theo (od_number, od_item) — CHỈ dòng INSERT/UPDATE; chunk 500 (KHÔNG ghi tuần tự)
    const CHUNK = 500
    for (let i = 0; i < toWrite.length; i += CHUNK) {
      const { error } = await supabase.from('erp_outbound_orders')
        .upsert(toWrite.slice(i, i + CHUNK), { onConflict: 'od_number,od_item' })
      if (error) throw new Error(error.message)
    }

    // ── Phát hiện dòng THIẾU trong DO CÓ MẶT (v2.3: VL06O luôn xuất trọn dòng của DO) ──
    // DO có trong file → dòng ACTIVE cũ của DO đó KHÔNG có trong file = SAP đã bỏ dòng → OBSOLETE (KHÔNG hard-delete,
    // giữ raw cho post-back; derive/engine bỏ qua OBSOLETE). DO cả-DO-vắng = mơ hồ → ĐỂ NGUYÊN (post-back gác).
    const fileKeys = new Set(records.map(r => `${r.od_number}__${r.od_item}`))
    const fileDos = new Set(records.map(r => String(r.od_number)))
    const removedKeys: OdKey[] = []
    for (const p of (priorRows ?? [])) {
      const k = `${p.od_number}__${p.od_item}`
      if (fileDos.has(String(p.od_number)) && !fileKeys.has(k) && p.sync_status !== 'OBSOLETE')
        removedKeys.push({ od_number: String(p.od_number), od_item: String(p.od_item) })
    }
    if (removedKeys.length) {
      await Promise.all(removedKeys.map(k => supabase.from('erp_outbound_orders')
        .update({ sync_status: 'OBSOLETE', updated_at: t }).eq('od_number', k.od_number).eq('od_item', k.od_item)))
    }

    // ── Engine đối chiếu (AUGMENT — lỗi engine KHÔNG được làm hỏng upload cốt lõi) ──
    let reconcile: Awaited<ReturnType<typeof reconcileFromSap>> | null = null
    let reconcile_error: string | null = null
    const changedKeys = [...updatedKeys, ...removedKeys]
    if (changedKeys.length) {
      try { reconcile = await reconcileFromSap(changedKeys, { actor: req.user?.name || 'SAP-UPLOAD' }) }
      catch (e) { reconcile_error = String(e); console.error('[reconcileFromSap] uploadVl06o:', e) }
    }

    const deliveries = new Set(records.map(r => r.od_number)).size
    // Nhắc khai map SAP→kho: còn dòng chưa map được thì phần đó CHƯA được siết theo kho
    if (sapUnmapped > 0) warnings.push(
      `${sapUnmapped} dòng không xác định được kho từ Plant/Storage Location SAP — khai "Plant SAP" + "Storage Location" cho kho ở Cài đặt WMS → tab Kho để chặn được file của kho khác.`)
    return ok(res, {
      rows: records.length, inserted, updated, noop, obsoleted: removedKeys.length, deliveries, skipped_no_key: skippedNoKey,
      sap_unmapped: sapUnmapped,
      reconcile, reconcile_error,
      warning_count: warnings.length, warnings: warnings.slice(0, 50),
    })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// Upload KHVC (kế hoạch điều vận, tự soạn) → JOIN raw VL06O theo DO → reshape về row-shape file gộp
// → processVehicleGroups (tái dùng nguyên logic re-upload). Số lượng = BASE từ VL06O.Actual.
export async function uploadKhvc(req: Request, res: Response) {
  try {
    if (!req.file) return fail(res, 'Không có file upload', 400)
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]   // SHEET ĐẦU TIÊN (chốt user)
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' })
    if (!rows.length) return fail(res, 'File KHVC trống hoặc không đúng định dạng', 400)

    type KRow = { group_code: string; do_no: string; npp: string; export_date: any; veh_type: string; dvvt: string; priority: string; cs: string; note: string; raw: Record<string, any> }
    const khvcRows: KRow[] = []
    const allDos = new Set<string>()
    for (const r of rows) {
      const gc = String(r['Số xe'] ?? r['So xe'] ?? '').trim()
      const doNo = String(r['DO'] ?? r['Delivery'] ?? '').trim()
      if (!gc || !doNo) continue
      allDos.add(doNo)
      khvcRows.push({
        group_code: gc, do_no: doNo,
        npp: String(r['Tên NPP'] ?? '').trim(),
        export_date: r['Ngày xuất'],
        veh_type: String(r['Loại xe'] ?? '').trim(),
        dvvt: String(r['DVVT'] ?? '').trim(),
        priority: String(r['Ưu tiên'] ?? r['Uu tien'] ?? '').trim(),
        cs: String(r['CS phụ trách'] ?? r['CS phu trach'] ?? '').trim(),
        note: String(r['Note'] ?? r['Ghi chú'] ?? '').trim(),
        raw: r,
      })
    }
    if (!khvcRows.length) return fail(res, 'Không tìm thấy cột "Số xe"/"DO" hoặc dữ liệu trống', 400)

    // ── PREFLIGHT: cảnh báo TRƯỚC khi sinh chuyến — ngày/Số xe này đã có chuyến? VL06O đã mới chưa?
    // KHÔNG return ở đây nữa (29/07): tính số liệu rủi ro rồi CHẠY TIẾP để kiểm luôn từng chuyến/dòng
    // (processVehicleGroups sẽ trả báo cáo chuẩn). Toàn bộ nhánh preflight KHÔNG ghi gì: tầng raw
    // khvc_lines bị bỏ qua bên dưới, reshape chỉ ĐỌC erp_outbound_orders + Material.
    const preflightExtra: PreflightExtra[] = []
    if (isPreflight(req)) {
      const gcs = [...new Set(khvcRows.map(k => k.group_code))]
      const existGdos = await fetchAllByIdChunks(gcs, chunk => supabase.from('GroupDeliveryOrder')
        .select('status').in('group_code', chunk).order('id')) as { status: string }[]
      const trips = { total: (existGdos ?? []).length, in_progress: 0, completed: 0, pending: 0, paused: 0 }
      for (const g of (existGdos ?? [])) {
        if (g.status === 'IN_PROGRESS') trips.in_progress++
        else if (g.status === 'COMPLETED') trips.completed++
        else if (g.status === 'PAUSED') trips.paused++
        else trips.pending++
      }
      // VL06O freshness + DO thiếu (KHVC trỏ DO chưa có trong raw)
      const rawDos = await fetchAllByIdChunks([...allDos], chunk => supabase.from('erp_outbound_orders')
        .select('od_number, updated_at').in('od_number', chunk).order('od_number')) as { od_number: string; updated_at: string }[]
      const presentDos = new Set((rawDos ?? []).map(r => r.od_number))
      const missingDos = [...allDos].filter(d => !presentDos.has(d))
      const lastSynced = (rawDos ?? []).reduce<string | null>((mx, r) => (!mx || r.updated_at > mx ? r.updated_at : mx), null)

      // DO trong file đã nằm trong CHUYẾN SỐNG mang Số xe KHÁC (quy ước đơn rớt 22/07: kho chuyển ngày,
      // KHÔNG gửi lại KH — gửi lại dưới Số xe MỚI sẽ sinh chuyến TRÙNG DO → kế hoạch double). Cảnh báo, chưa chặn.
      const fileGcByDo = new Map<string, Set<string>>()
      for (const k of khvcRows) { const s = fileGcByDo.get(k.do_no) ?? new Set<string>(); s.add(k.group_code); fileGcByDo.set(k.do_no, s) }
      const dosArr = [...allDos]
      const crossTrip = new Set<string>()
      for (const [d, s] of fileGcByDo) if (s.size > 1) crossTrip.add(`${d} → ${s.size} Số xe ngay trong file`)
      for (let i = 0; i < dosArr.length; i += 40) {
        const chunk = dosArr.slice(i, i + 40)
        const { data: dvs } = await supabase.from('OutboundDelivery')
          .select('delivery_code, gdo:GroupDeliveryOrder!gdo_id(group_code, status)')
          .or(chunk.map(d => `delivery_code.ilike.%${safeFilterValue(d)}%`).join(','))
        for (const o of ((dvs ?? []) as unknown as { delivery_code: string | null; gdo: { group_code: string; status: string } | null }[])) {
          const g = o.gdo
          if (!g || g.status === 'COMPLETED') continue   // chuyến sống = PENDING / IN_PROGRESS / PAUSED
          for (const tok of String(o.delivery_code ?? '').split(/,\s*/)) {
            const d = tok.trim()
            if (d && fileGcByDo.has(d) && !fileGcByDo.get(d)!.has(g.group_code))
              crossTrip.add(`${d} → đang ở xe ${g.group_code}`)
          }
        }
      }
      const crossArr = [...crossTrip]

      preflightExtra.push(
        { label: 'Số DO trong file', value: allDos.size },
        { label: 'VL06O đồng bộ lúc', value: lastSynced
            ? new Date(lastSynced).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false })
            : 'CHƯA có dữ liệu raw', warn: !lastSynced },
        ...(trips.total ? [{ label: 'Số xe trong file ĐÃ có chuyến', value: trips.total, warn: true }] : []),
        ...(trips.in_progress ? [{ label: 'Trong đó ĐANG XUẤT (sẽ bỏ qua)', value: trips.in_progress, warn: true }] : []),
        ...(trips.completed ? [{ label: 'Trong đó ĐÃ HOÀN THÀNH (sẽ bỏ qua)', value: trips.completed, warn: true }] : []),
        ...(missingDos.length ? [{ label: 'DO chưa có trong VL06O (bỏ)', value: `${missingDos.length}: ${missingDos.slice(0, 5).join(', ')}${missingDos.length > 5 ? '…' : ''}`, warn: true }] : []),
        ...(crossArr.length ? [{ label: 'DO đang ở Số xe khác', value: `${crossArr.length}: ${crossArr.slice(0, 3).join(' · ')}${crossArr.length > 3 ? '…' : ''}`, warn: true }] : []),
      )
      // CHẠY TIẾP (không return) → kiểm tiếp từng chuyến ở processVehicleGroups
    }

    // ── SCOPE KHO phải gác TRƯỚC khi ghi tầng raw ──
    // Guard kho/loại vốn nằm trong processVehicleGroups (gọi ở CUỐI hàm) nhưng khvc_lines đã upsert
    // NGAY dưới đây ⇒ verify 26/07: user kho A up file mang Số xe của kho B → chuyến bị 400 nhưng
    // kế hoạch raw kho B ĐÃ bị đè + mất cờ manual_edited_at. Chặn ngay từ đầu (all-or-nothing).
    {
      const scope = scopeWhIds(req)
      if (scope !== null) {
        const whCodes = [...new Set(khvcRows.map(k => k.group_code.split('_')[0]).filter(Boolean))]
        const { data: whRows } = await supabase.from('Warehouse').select('id, code').in('code', whCodes)
        const idByCode = new Map(((whRows ?? []) as { id: string; code: string }[]).map(w => [w.code, w.id]))
        const outside = whCodes.filter(c => { const id = idByCode.get(c); return id && !scope.includes(id) })
        if (outside.length)
          return fail(res, `Ngoài phạm vi kho — file chứa Số xe của kho: ${outside.join(', ')}`, 403)
      }
    }

    // ── Lưu TẦNG RAW "Kế hoạch xuất" (khvc_lines) — giữ lại kế hoạch để xem/đối chiếu/up lại ──
    // Churn-safe: pre-fetch (group_code, do_no)→id, GIỮ id cũ khi up lại (không đổi PK). Upsert chunk 500.
    const khActor = req.user?.name || null
    const khGcs = [...new Set(khvcRows.map(k => k.group_code))]
    const priorKh = await fetchAllByIdChunks(khGcs, chunk => supabase.from('khvc_lines')
      .select('id, group_code, do_no').in('group_code', chunk).order('id')) as { id: string; group_code: string; do_no: string }[]
    const khIdByKey = new Map((priorKh ?? []).map(k => [`${k.group_code}__${k.do_no}`, k.id]))
    const khNow = now()
    const khvcRecords = khvcRows.map(k => ({
      id: khIdByKey.get(`${k.group_code}__${k.do_no}`) ?? randomUUID(),
      group_code: k.group_code, do_no: k.do_no,
      warehouse_code: k.group_code.split('_')[0] || null,
      npp: k.npp || null, veh_type: k.veh_type || null, dvvt: k.dvvt || null,
      priority: k.priority || null, cs: k.cs || null, note: k.note || null,
      export_date: parseExcelDate(k.export_date), source: 'EXCEL', sync_status: 'ACTIVE',
      raw: k.raw, uploaded_by: khActor, updated_at: khNow, manual_edited_at: null,   // upload đè lại → gỡ cờ sửa tay
    }))
    // PREFLIGHT không ghi tầng raw (đây là ghi DUY NHẤT trước processVehicleGroups — bỏ nó là
    // toàn nhánh kiểm-trước sạch 100%, phần dưới chỉ ĐỌC).
    if (!isPreflight(req)) {
      for (let i = 0; i < khvcRecords.length; i += 500) {
        const { error } = await supabase.from('khvc_lines').upsert(khvcRecords.slice(i, i + 500), { onConflict: 'group_code,do_no' })
        if (error) throw new Error(error.message)
      }
    }

    // Nạp raw VL06O theo DO (.in chunk + phân trang) + Material (category + đơn vị)
    const raws = await fetchAllByIdChunks([...allDos], chunk => supabase.from('erp_outbound_orders')
      .select('od_number, od_item, material_code, qty_base, ship_to_code, ship_to_name, batch, pct_date_req, note_delivery, note_invoice')
      .in('od_number', chunk).order('od_number')) as ErpRawLine[]
    const rawByDo = new Map<string, ErpRawLine[]>()
    for (const r of raws) { const l = rawByDo.get(r.od_number) ?? []; l.push(r); rawByDo.set(r.od_number, l) }

    const allMats = await fetchAllRowsParallel(() => supabase.from('Material')
      .select('id, material_code, category, base_unit, entry_unit, units_per_carton')) as ({ id: string; material_code: string; category: string | null } & MatUnitsQ)[]
    const matByCode = new Map(allMats.map(m => [String(m.material_code).trim(), m]))

    // Reshape → byVehicle (row-shape file gộp): số BASE từ Actual, tách Thùng+Hộp qua qtySplit
    const byVehicle = new Map<string, Record<string, any>[]>()
    const missingDos = new Set<string>()
    for (const k of khvcRows) {
      const lines = rawByDo.get(k.do_no)
      if (!lines || !lines.length) { missingDos.add(k.do_no); continue }
      const list = byVehicle.get(k.group_code) ?? []
      const whCode = k.group_code.split('_')[0]     // Mãkho = đoạn đầu Số xe (Mãkho_X_ddmmyy_stt)
      for (const ln of lines) {
        const mc = String(ln.material_code ?? '').trim()
        if (!mc) continue                            // dòng raw không có mã → bỏ (không thể thành item)
        const mat = mc ? matByCode.get(mc) : undefined
        const qtyBase = Number(ln.qty_base ?? 0)
        const sp = qtySplit(qtyBase, mat)            // base → thùng + hộp lẻ
        const header = [ln.note_delivery, ln.note_invoice].map(x => String(x ?? '').trim()).filter(Boolean).join(' | ')
        list.push({
          'Số xe': k.group_code,
          'Ngày xuất': k.export_date,
          'Kho xuất': whCode,
          'Loại kho': mat?.category ?? '',
          'DVVT': k.dvvt,
          'Delivery': k.do_no,
          'Tên NPP': k.npp || ln.ship_to_name || ln.ship_to_code || '',
          'Material': mc,
          // cartons_ordered = qty_base: mã có entry → Thùng×hệ_số + Hộp; mã không entry → chỉ Thùng
          'Thùng':   hasEntry(mat) ? sp.entry : qtyBase,
          'Hộp':     hasEntry(mat) ? sp.base  : 0,
          'Nhặt lẻ': 0,   // loose TÍNH AUTO theo pallet ở processVehicleGroups (trên qty base ĐÃ GỘP, chống thổi khi 1 mã nhiều dòng)
          'Loại xuất': k.veh_type,
          'Ưu tiên': k.priority,
          'CS phụ trách': k.cs,
          'Note': k.note,
          'Shipto party': ln.ship_to_code ?? '',
          'HEADER TEXT': header,
          'Batch_Yêu cầu': ln.batch ?? '',
          '%Date_Yêu cầu': ln.pct_date_req ?? '',
          // Liên kết ngược dòng OD (Đợt 1): mỗi dòng raw = 1 od_ref; mergeNppRows gộp thành mảng cho od_refs của item
          __od_refs: [{ od_number: k.do_no, od_item: ln.od_item, qty_base: qtyBase }],
        })
      }
      byVehicle.set(k.group_code, list)
    }
    // Bỏ chuyến rỗng (mọi DO của nó đều thiếu material trong raw)
    for (const [gc, l] of byVehicle) if (!l.length) byVehicle.delete(gc)

    // DO LUÔN bắt buộc: thiếu DO trong VL06O → CHẶN TOÀN BỘ, bắt sửa (thêm DO vào VL06O hoặc bỏ khỏi KHVC).
    // Xuất tay/không DO: dùng nút "Tạo đơn" thủ công (user chốt — không làm switch bỏ qua DO).
    if (missingDos.size) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_DO', message: `${missingDos.size} DO trong KHVC chưa có trong VL06O — hãy Up VL06O đầy đủ trước (xuất tay không DO thì dùng "Tạo đơn").` },
        missing_dos: [...missingDos],
      })
    }

    if (!byVehicle.size) return fail(res, 'Không có dữ liệu hợp lệ trong KHVC', 400)

    // KHVC/SAP → nhặt lẻ auto theo pallet; preflightExtra = số liệu rủi ro tính ở trên (nếu đang kiểm trước)
    return await processVehicleGroups(req, res, byVehicle, undefined, undefined, true, preflightExtra)
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── Get available inventory for an item ─────────────────────

// Tồn khả dụng của 1 mã hàng trong 1 kho (FEFO list) — dùng chung cho getItemInventory
// và getInventoryByMaterial (nút search tồn kho ở bảng chuẩn bị). Trả [] nếu kho không có vị trí.
async function fetchMaterialInventory(materialId: string, warehouseId: string | null) {
  // Lọc kho bằng INNER JOIN Location — KHÔNG kéo danh sách location id về trước
  // (kho lớn >1000 vị trí: locIds bị cap-1000 cắt → tồn ở vị trí thứ 1001+ "biến mất" âm thầm).
  // Phân trang đủ (cap ~1000/response) — .order('id') phụ để phân trang ổn định
  const data = await fetchAllRowsParallel(() => {
    let q = supabase.from('InventoryEntry')
      .select(`id, pallet_code, cartons_imported, cartons_remaining, cartons_reserved, production_date, expiry_date, import_date, qa_status_id, ncc_id, shelf_life_days, qa_status:QAStatus(id,code,name), location:Location${warehouseId ? '!inner' : ''}(location_code, warehouse_id), material:Material!material_id(shelf_life_days, supplier_shelf_life_overrides)`)
      .eq('material_id', materialId)
      .in('status', ['IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING'])
      .gt('cartons_remaining', 0) // tồn=0 hợp lệ trong DB (upload snapshot) nhưng không phải tồn khả dụng
    if (warehouseId) q = q.eq('location.warehouse_id', warehouseId)
    return q.order('created_at').order('id')
  })

  const now = Date.now()
  return (data ?? []).map((e: any) => {
    const pctRaw = computePctDate(e, e.material, now)   // ưu tiên HSD tường minh (tem V2)
    const pct_date: number | null = pctRaw == null ? null : Math.round(pctRaw)
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
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
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
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// Tồn theo mã hàng + kho (nút search tồn kho ở bảng chuẩn bị, không gắn item cụ thể)
export async function getInventoryByMaterial(req: Request, res: Response) {
  try {
    const { material_id, warehouse_id } = req.query as Record<string, string>
    if (!material_id) return fail(res, 'material_id là bắt buộc', 400)
    return ok(res, await fetchMaterialInventory(material_id, warehouse_id || null))
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── Gợi ý vị trí lấy FEFO theo mã hàng (dùng chung: board Chuẩn bị hàng + cột "Vị trí lấy") ──
// Chunk matIds (URL dài) + phân trang (cap ~1000, tồn 1 mã có thể >1000 pallet);
// lọc kho bằng INNER JOIN Location (không nhồi nghìn location_id vào .in()).
// Trả map material_id → danh sách vị trí ĐÃ SORT (hòa %Date → ít hàng nhất trước → tên) — caller tự slice.
type FefoSuggestion = { location_code: string | null; pct_date: number | null; available: number }
async function fefoSuggestionsByMaterial(matIds: string[], warehouseIds: string[]): Promise<Map<string, FefoSuggestion[]>> {
  const out = new Map<string, FefoSuggestion[]>()
  if (!matIds.length) return out
  const useWhFilter = warehouseIds.length > 0
  const entryChunks = await Promise.all(
    Array.from({ length: Math.ceil(matIds.length / 200) }, (_, ci) => matIds.slice(ci * 200, ci * 200 + 200)).map(chunk =>
      fetchAllRowsParallel(() => {
        let q = supabase.from('InventoryEntry')
          .select(`material_id, cartons_remaining, cartons_imported, cartons_reserved, production_date, expiry_date, ncc_id, shelf_life_days, location:Location${useWhFilter ? '!inner' : ''}(location_code, warehouse_id), material:Material!material_id(shelf_life_days, supplier_shelf_life_overrides)`)
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
    cartons_reserved: number | null; production_date: string | null; expiry_date: string | null; ncc_id: string | null; shelf_life_days: number | null
    location: { location_code: string | null } | null
    material: { shelf_life_days: number | null; supplier_shelf_life_overrides: { transport_company_id: string; shelf_life_days: number }[] | null } | null
  }>
  const nowMs = Date.now()
  const byMat = new Map<string, Map<string, FefoSuggestion>>()
  for (const e of (entries ?? [])) {
    const reserved  = Number(e.cartons_reserved ?? 0)
    const available = Math.max(0, (e.cartons_remaining ?? e.cartons_imported ?? 0) - reserved)
    if (available <= 0) continue
    const pctRaw = computePctDate(e, e.material, nowMs)   // ưu tiên HSD tường minh (tem V2)
    const pct_date: number | null = pctRaw == null ? null : Math.round(pctRaw)
    const loc = e.location?.location_code ?? '(chưa xác định)'
    const k = `${pct_date ?? 'n'}|${loc}`
    const locMap = byMat.get(e.material_id) ?? new Map<string, FefoSuggestion>()
    const cur = locMap.get(k) ?? { location_code: loc, pct_date, available: 0 }
    cur.available += available
    locMap.set(k, cur)
    byMat.set(e.material_id, locMap)
  }
  for (const [matId, locMap] of byMat) {
    // Hòa %Date → ưu tiên vị trí ÍT hàng nhất (dọn hàng lẻ trước) → tên vị trí; đồng bộ luật với panel tồn kho FE
    out.set(matId, [...locMap.values()].sort((a, b) => {
      const pa = a.pct_date ?? Infinity, pb = b.pct_date ?? Infinity
      if (pa !== pb) return pa - pb
      if (a.available !== b.available) return a.available - b.available
      return (a.location_code ?? '').localeCompare(b.location_code ?? '')
    }))
  }
  return out
}

// Gợi ý vị trí lấy cho MỌI mã của 1 chuyến — cột "Vị trí lấy" trang chi tiết Xuất/Nhặt lẻ
// (thủ kho xem trên MÀN thay vì in giấy — user 19/07; chi tiết đầy đủ vẫn ở kính lúp tồn kho)
export async function getGdoPickSuggestions(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { data: gdo } = await supabase.from('GroupDeliveryOrder').select('warehouse_id').eq('id', id).single()
    if (!gdo) return fail(res, 'Không tìm thấy chuyến xe', 404)
    if (!inScope(req, gdo.warehouse_id)) return fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403)
    const dos = await fetchAllByIdChunks([id], chunk => supabase.from('OutboundDelivery')
      .select('id').in('gdo_id', chunk).order('id'))
    const doIds = (dos ?? []).map((d: { id: string }) => d.id)
    if (!doIds.length) return ok(res, {})
    const items = await fetchAllByIdChunks(doIds, chunk => supabase.from('OutboundItem')
      .select('material_id').in('do_id', chunk).order('id')) as Array<{ material_id: string | null }>
    const matIds = [...new Set(items.map(i => i.material_id).filter(Boolean))] as string[]
    const sugByMat = await fefoSuggestionsByMaterial(matIds, gdo.warehouse_id ? [gdo.warehouse_id] : [])
    return ok(res, Object.fromEntries([...sugByMat.entries()].map(([k, v]) => [k, v.slice(0, 2)])))
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── Bảng chuẩn bị hàng — gom ≥1 GDO, tính pallet CÒN PHẢI chuẩn bị + gợi ý vị trí FEFO ──
// Realtime: FE dùng queryKey ['gdo','prepare',…] → OutboundItem/OutboundScanEntry đổi sẽ tự
// invalidate (prefix 'gdo'), pallet cần chuẩn bị giảm dần khi quét. KHÔNG giữ chỗ (reserve).
export async function getPrepareBoard(req: Request, res: Response) {
  try {
    const gdoIds = parseListParam(req.query.gdo_ids) ?? []
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
    const qtyGdoIds = new Set((gdos ?? []).filter((g: any) => isQtyLike(g.warehouse?.inventory_mode)).map((g: any) => g.id as string))

    const dos = await fetchAllByIdChunks(gdoIds, chunk => supabase.from('OutboundDelivery')
      .select('id, gdo_id').in('gdo_id', chunk).order('id'))
    const doIds = (dos ?? []).map((d: any) => d.id)
    if (!doIds.length) return ok(res, { rows: [], total_cartons: 0, total_pallets: 0 })
    const qtyDoIds = new Set((dos ?? []).filter((d: any) => qtyGdoIds.has(d.gdo_id)).map((d: any) => d.id as string))

    // Board gom nhiều chuyến — thiếu item (cap-1000) = thiếu dòng cần chuẩn bị → chunk + phân trang
    const items = await fetchAllByIdChunks(doIds, chunk => supabase.from('OutboundItem')
      .select('do_id, material_id, material_code_raw, cartons_ordered, cartons_scanned, loose_picking, material:Material!material_id(short_name, cartons_per_pallet, warehouse_pallet_overrides, no_qr_tracking, base_unit, entry_unit, units_per_carton)')
      .in('do_id', chunk).order('id')) as Array<{
        do_id: string; material_id: string | null; material_code_raw: string | null
        cartons_ordered: number | null; cartons_scanned: number | null; loose_picking: number | null
        material: { short_name: string | null; cartons_per_pallet: number | null; warehouse_pallet_overrides: { warehouse_id: string; cartons_per_pallet: number }[] | null; no_qr_tracking: boolean | null; base_unit: string | null; entry_unit: string | null; units_per_carton: number | null } | null
      }>

    // Gom theo mã hàng (material_id, fallback material_code_raw)
    type Row = {
      material_id: string | null; material_code: string; material_name: string | null
      cartons_ordered: number; cartons_scanned: number; cartons_remaining: number
      cartons_per_pallet: number; pallets_remaining: number; no_qr_tracking: boolean
      base_unit: string | null; entry_unit: string | null; units_per_carton: number | null
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
        base_unit: i.material?.base_unit ?? null,
        entry_unit: i.material?.entry_unit ?? null,
        units_per_carton: i.material?.units_per_carton ?? null,
        suggestions: [],
      }
      cur.no_qr_tracking = cur.no_qr_tracking || itemNoQr
      cur.cartons_ordered += Number(i.cartons_ordered ?? 0)
      cur.cartons_scanned += Number(i.cartons_scanned ?? 0)
      rowMap.set(key, cur)
    }

    // FEFO suggestions cho các mã hàng — helper dùng chung với cột "Vị trí lấy" trang chi tiết đơn
    const matIds = [...new Set([...rowMap.values()].map(r => r.material_id).filter(Boolean))] as string[]
    const sugByMat = await fefoSuggestionsByMaterial(matIds, warehouseIds)
    for (const r of rowMap.values()) {
      if (!r.material_id) continue
      r.suggestions = (sugByMat.get(r.material_id) ?? []).slice(0, 2)
    }

    // Tính còn lại + pallet cần; chỉ giữ mã còn phải chuẩn bị
    // BASE UNIT: cartons_remaining = base; pallet cần = ceil(thùng quy đổi ÷ thùng/pallet vật lý)
    const rows = [...rowMap.values()].map(r => {
      r.cartons_remaining = Math.max(0, r.cartons_ordered - r.cartons_scanned)
      r.pallets_remaining = r.cartons_per_pallet > 0 ? Math.ceil(qtyEntryDecimal(r.cartons_remaining, r) / r.cartons_per_pallet) : 0
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
      // BASE UNIT: tổng cross-mã = thùng quy đổi
      total_cartons: rows.reduce((s, r) => s + qtyEntryDecimal(r.cartons_remaining, r), 0),
      total_pallets: rows.reduce((s, r) => s + r.pallets_remaining, 0),
    })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── Check scan validity (no save) ───────────────────────────

// Pallet KHÔNG nằm trong tồn khả dụng của kho này → phân biệt 3 trường hợp cho THÔNG BÁO ĐÚNG:
//  (a) sai định dạng tem đơn vị khác  (b) ĐÃ HẾT TỒN / ĐÃ XUẤT (+ truy vết chuyến + số xe đã chở)
//  (c) thật sự chưa nhập kho. Trace pallet→chuyến theo từng bước (OutboundScanEntry→Item.do_id→Delivery.gdo_id→GDO),
//  giống lookupPalletGdos (nested embed 3 bảng dễ vỡ) — chỉ 1 pallet nên vài query nhỏ là chấp nhận được.
async function palletUnavailableFail(res: Response, qr: string, warehouseId: string | null | undefined) {
  const hint = await wrongFormatHint(qr)
  if (hint) return fail(res, hint, 404)
  const { data: past } = await supabase.from('InventoryEntry')
    .select('id, location:Location!location_id(warehouse_id)').eq('pallet_code', qr)
  const rows = (past ?? []) as { location?: { warehouse_id?: string | null } | null }[]
  const existed = warehouseId ? rows.some(r => r.location?.warehouse_id === warehouseId) : rows.length > 0
  if (!existed) return fail(res, `Pallet "${qr}" chưa được nhập kho — kiểm tra lại phiếu nhập inbound`, 404)
  // Truy vết chuyến đã xuất pallet này (lần xuất gần nhất)
  let where = ''
  const { data: sc } = await supabase.from('OutboundScanEntry')
    .select('item_id').eq('pallet_code', qr).order('scanned_at', { ascending: false }).limit(1).maybeSingle()
  const itemId = (sc as { item_id: string | null } | null)?.item_id
  if (itemId) {
    const { data: it } = await supabase.from('OutboundItem').select('do_id').eq('id', itemId).maybeSingle()
    const doId = (it as { do_id: string | null } | null)?.do_id
    if (doId) {
      const { data: dv } = await supabase.from('OutboundDelivery').select('gdo_id').eq('id', doId).maybeSingle()
      const gdoId2 = (dv as { gdo_id: string | null } | null)?.gdo_id
      if (gdoId2) {
        const { data: g } = await supabase.from('GroupDeliveryOrder').select('group_code, license_plate').eq('id', gdoId2).maybeSingle()
        const gg = g as { group_code?: string | null; license_plate?: string | null } | null
        if (gg?.group_code) where = ` — đã xuất ở chuyến ${gg.group_code}${gg.license_plate ? ` (xe ${gg.license_plate})` : ''}`
      }
    }
  }
  return fail(res, `Pallet "${qr}" đã hết tồn (đã xuất hết)${where}`, 400)
}

// Chặn quét TRÙNG pallet CHỈ trong CÙNG chế độ (user chốt 22/07): người NHẶT LẺ và người XUẤT
// được quét CÙNG 1 pallet trên cùng mã (2 người 2 việc — số lượng đã có tồn khả dụng + reserve gác,
// không lấy quá được). Cùng chế độ vẫn chặn: chống quét đúp vô tình + offline replay dedup
// (scanQueue DUP_RE dựa vào lỗi "đã được quét" để xác nhận bản ghi đã lên từ lần gửi trước).
function dupScanQuery(itemId: string, qr: string, loose: boolean) {
  let q = supabase.from('OutboundScanEntry').select('id').eq('item_id', itemId).eq('pallet_code', qr)
  q = loose ? q.eq('is_loose_picking', true) : q.or('is_loose_picking.eq.false,is_loose_picking.is.null')
  return q.limit(1).maybeSingle()
}

export async function checkScanItem(req: Request, res: Response) {
  try {
    const { gdoId, itemId } = req.params
    const { qr_code, loose_picking_mode } = req.body as { qr_code: string; loose_picking_mode?: boolean }
    const qr = normalizeQR(qr_code ?? '')   // tem V2 (`;`) đệm space từng đoạn → chuẩn hóa để khớp pallet_code đã lưu
    if (!qr) return fail(res, 'qr_code là bắt buộc', 400)

    const [
      { data: gdo },
      { data: item, error: itemErr },
      { data: invList },
      { data: dupCheck },
    ] = await Promise.all([
      supabase.from('GroupDeliveryOrder').select('status, warehouse_id').eq('id', gdoId).single(),
      supabase.from('OutboundItem').select('*').eq('id', itemId).single(),
      supabase.from('InventoryEntry').select('*, qa_status:QAStatus(code,name), location:Location!location_id(id, location_code, warehouse_id)').eq('pallet_code', qr).in('status', ['IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING']),
      dupScanQuery(itemId, qr, !!loose_picking_mode),
    ])
    if (!inScope(req, gdo?.warehouse_id)) return fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403)
    const inv = ((invList ?? []) as any[]).find((e: any) => e.location?.warehouse_id === gdo?.warehouse_id) ?? null

    if (gdo?.status === 'PAUSED') return fail(res, 'Chuyến xe đang tạm dừng — không thể quét', 400)
    if (itemErr || !item) return fail(res, 'Không tìm thấy mặt hàng', 404)
    if (item.status === 'COMPLETED') return fail(res, 'Mặt hàng này đã xuất đủ số lượng', 400)
    if (!inv) return palletUnavailableFail(res, qr, gdo?.warehouse_id)
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
      // Ưu tiên HSD tường minh trên tem (V2) → không cần khai Shelf Life mã vẫn kiểm %Date được; fallback NSX+shelflife (V1).
      const pct = computePctDate(inv, mat)
      if (pct == null) return fail(res, `Pallet "${qr}" thiếu HSD hoặc NSX+Shelf Life — không thể kiểm tra %Date`, 400)
      if (pct < dateReqPct) {
        return fail(res, `%Date còn lại: ${Math.floor(pct)}% < yêu cầu ${dateReqPct}%`, 400)
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
        // Vị trí phần còn lại: FE cần biết pallet đang ở đâu + còn bao nhiêu để hỏi "để hàng dư ở đâu"
        // (dư = pallet_remaining − số sắp xuất; nhặt lẻ thì luôn còn vì chỉ giữ hàng, không trừ).
        inventory_entry_id: inv.id,
        pallet_remaining:   Number(inv.cartons_remaining ?? inv.cartons_imported),
        location_id:        inv.location_id ?? null,
        location_code:      inv.location?.location_code ?? null,
        warehouse_id:       gdo?.warehouse_id ?? null,
      },
    })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── Scan QR for an item ──────────────────────────────────────

export async function scanItem(req: Request, res: Response) {
  try {
    if (!requireBaseQty(req, res)) return   // BASE UNIT: chặn payload bundle cũ (thùng thập phân)
    const { gdoId, itemId } = req.params
    const { qr_code, employee_id, cartons_override, loose_picking_mode, leftover_location_id, leftover_ui } = req.body as { qr_code: string; employee_id?: string; cartons_override?: number; loose_picking_mode?: boolean; leftover_location_id?: string; leftover_ui?: boolean }
    const qr = normalizeQR(qr_code ?? '')   // tem V2 (`;`) đệm space từng đoạn → chuẩn hóa để khớp pallet_code đã lưu
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
      dupScanQuery(itemId, qr, !!loose_picking_mode),
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
    if (!inv) return palletUnavailableFail(res, qr, gdo?.warehouse_id)
    if (inv.qa_status_id && inv.qa_status?.code !== 'OK') {
      return fail(res, `Pallet bị giữ QA: ${inv.qa_status?.name ?? inv.qa_status_id} — không được xuất`, 400)
    }

    // Fetch shelf_life_days và best_available_date song song (cả hai chỉ cần dữ liệu từ bước trên)
    const matId = item.material_id ?? inv.material_id
    const [{ data: shelfMat }, best_available_date] = await Promise.all([
      matId
        ? supabase.from('Material').select('shelf_life_days, supplier_shelf_life_overrides, base_unit, entry_unit, units_per_carton').eq('id', matId).single()
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
    // %Date pallet: ưu tiên HSD tường minh trên tem (V2) → fallback NSX+shelflife (V1). Tính 1 lần, tái dùng cho check + lưu.
    const pctRaw = computePctDate(inv, shelfMat)

    // Kiểm tra % shelf life còn lại nếu item có yêu cầu
    const dateReqPct = Number(item.date_required ?? 0)
    if (dateReqPct > 0) {
      if (pctRaw == null) {
        return fail(res, `Pallet "${qr}" thiếu HSD hoặc NSX+Shelf Life — không thể kiểm tra %Date`, 400)
      }
      if (pctRaw < dateReqPct) {
        return fail(res, `%Date còn lại: ${Math.floor(pctRaw)}% < yêu cầu ${dateReqPct}%`, 400)
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

    // BASE UNIT: cartons_override từ FE = SỐ BASE — mã có entry phải nguyên (0,5 hộp không tồn tại)
    if (cartons_override != null) {
      const ie = qtyIntegerError(Number(cartons_override), (shelfMat ?? null) as MatUnitsQ | null)
      if (ie) return fail(res, ie, 422)
    }
    const to_take = cartons_override ? Math.min(Math.max(1, Number(cartons_override)), cap) : cap

    // ── PALLET ĐI KHÔNG HẾT → BẮT KHAI VỊ TRÍ CHO PHẦN CÒN LẠI (user chốt 30/07) ──
    // Nhặt lẻ chỉ GIỮ hàng (reserve), remaining không đổi ⇒ pallet luôn còn hàng trên đó.
    // Kiểm vị trí TRƯỚC khi ghi bất cứ thứ gì: sai vị trí thì không được để lại scan entry mồ côi.
    const palletRemaining = Number(inv.cartons_remaining ?? inv.cartons_imported)
    const leftoverQty = loose_picking_mode ? palletRemaining : palletRemaining - to_take
    let moveLeftoverTo: string | null = null
    if (leftoverQty > 0) {
      const pick = String(leftover_location_id ?? '').trim()
      // ⚠️ KHÔNG chặn bundle CŨ (PWA còn cache bản trước 30/07): giao diện cũ không có ô chọn vị trí
      // nên người quét KHÔNG CÓ CÁCH NÀO tuân thủ — chặn ở đây là khoá luôn việc quét của họ
      // (đúng lỗi user gặp 30/07: "không thấy nút chọn vị trí mà lưu thì báo chưa chọn").
      // `leftover_ui` = cờ FE bản mới TỰ KHAI có ô chọn ⇒ chỉ bản mới mới bị siết; bản cũ giữ
      // hành vi cũ (pallet dư ở nguyên chỗ). App tự cập nhật nên cửa sổ này rất ngắn.
      if (!pick && !leftover_ui) {
        // bản cũ (không khai cờ, không gửi vị trí) → GIỮ CHỖ CŨ y như trước, KHÔNG lỗi.
        // Phải thoát hẳn khối này: pick rỗng mà chạy tiếp sẽ tra Location id='' → 422 "không tồn tại".
      } else if (!pick) {
        return fail(res, `Pallet còn ${qtyLabel(leftoverQty, (shelfMat ?? null) as MatUnitsQ | null)} chưa xuất — phải chọn vị trí để phần còn lại (giữ chỗ cũ hoặc chọn vị trí khác)`, 422)
      } else if (pick !== KEEP_LOCATION && pick !== inv.location_id) {
        const { data: loc } = await supabase.from('Location')
          .select('id, location_code, is_active, warehouse_id').eq('id', pick).maybeSingle()
        if (!loc)           return fail(res, 'Vị trí đã chọn không tồn tại', 422)
        if (!loc.is_active) return fail(res, `Vị trí ${loc.location_code} đang ngưng sử dụng — chọn vị trí khác`, 422)
        if (loc.warehouse_id !== gdo?.warehouse_id)
          return fail(res, `Vị trí ${loc.location_code} không thuộc kho của chuyến xe này`, 422)
        moveLeftoverTo = pick
      }
    }

    // pct_date tại thời điểm quét — khóa cứng, không thay đổi theo thời gian (dùng lại pctRaw đã tính trên)
    const pct_date: number | null = pctRaw == null ? null : Math.round(pctRaw)

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

    // Chuyển vị trí phần dư NGAY SAU khi trừ/giữ tồn, TRƯỚC khi cộng dồn item: hỏng (vị trí vừa
    // bị người khác lấp đầy) thì hoàn nguyên đúng thao tác vừa làm + xóa scan entry rồi báo 409 —
    // không bao giờ để lại trạng thái "đã trừ tồn mà không biết hàng dư nằm đâu".
    const applyLeftoverMove = async (revert: () => Promise<unknown>): Promise<string | null> => {
      if (!moveLeftoverTo) return null
      const err = await moveLeftoverPallet(inv.id, moveLeftoverTo, resolved_employee_id ?? null, t)
      if (!err) return null
      await revert()
      await supabase.from('OutboundScanEntry').delete().eq('id', scanId)
      return err
    }

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
      const moveErr = await applyLeftoverMove(() => adjustInventoryAtomic(inv.id, 0, -to_take))
      if (moveErr) return fail(res, moveErr, 409)
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
      const moveErr = await applyLeftoverMove(() => adjustInventoryAtomic(inv.id, to_take, 0))
      if (moveErr) return fail(res, moveErr, 409)
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
      leftover: leftoverQty > 0 ? { qty: leftoverQty, moved: !!moveLeftoverTo } : null,
    })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
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
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
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
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── Lưu thủ công nhặt lẻ (hàng no-QR: POSM/Loscam) ───────────
// Ghi số thùng nhặt lẻ THỦ CÔNG (không quét camera) cho mã không-QR. Upsert 1 loose scan entry
// (is_loose_picking=true, CHƯA xác nhận) + RESERVE tồn theo delta — trừ tồn thật khi "Check nhặt lẻ".
// Entry POSM chung có location_id=null → tra theo cột warehouse_id trực tiếp (KHÔNG join Location như scanItem).
export async function manualLooseItem(req: Request, res: Response) {
  try {
    if (!requireBaseQty(req, res)) return   // BASE UNIT: chặn payload bundle cũ (thùng thập phân)
    const { gdoId, itemId } = req.params
    const { cartons } = req.body as { cartons?: number }
    if (cartons == null || !Number.isFinite(Number(cartons)) || Number(cartons) < 0) return fail(res, 'Số thùng không hợp lệ', 400)

    const [{ data: gdo }, { data: item }] = await Promise.all([
      supabase.from('GroupDeliveryOrder').select('status, warehouse_id, warehouse:Warehouse(inventory_mode)').eq('id', gdoId).single(),
      supabase.from('OutboundItem')
        .select('id, do_id, material_id, material_code_raw, cartons_ordered, cartons_scanned, loose_picking, material:Material!material_id(material_code, no_qr_tracking, base_unit, entry_unit, units_per_carton)')
        .eq('id', itemId).single(),
    ])
    if (!inScope(req, gdo?.warehouse_id)) return fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403)
    if (gdo?.status === 'PAUSED') return fail(res, 'Chuyến xe đang tạm dừng — không thể cập nhật', 400)
    if (!item) return fail(res, 'Không tìm thấy mặt hàng', 404)

    // BASE UNIT: cartons = SỐ BASE (nhặt lẻ đếm hộp nguyên) — mã có entry phải nguyên
    {
      const ie = qtyIntegerError(Number(cartons), (item.material ?? null) as MatUnitsQ | null)
      if (ie) return fail(res, ie, 422)
    }

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
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── List loose picking items (nhặt lẻ) ──────────────────────

const looseCsv = (v?: string | string[]) => {
  const out = parseListParam(v) ?? []
  return out.length ? out : null
}

// Ô chọn bộ lọc trang Nhặt lẻ — tính trên phạm vi NGÀY + KHO trong DB (đường cũ dựng option từ
// tập đã tải về trình duyệt, phân trang xong sẽ chỉ còn giá trị của trang đang xem).
export async function getLoosePickingFacets(req: Request, res: Response) {
  const { warehouse_id, date, date_from, date_to } = req.query as Record<string, string | undefined>
  const scope = req.user?.warehouse_scope !== 'NATIONAL' ? (req.user?.warehouse_ids ?? []) : null
  if (scope && warehouse_id && !scope.includes(warehouse_id)) return ok(res, {})
  const { data, error } = await supabase.rpc('loose_picking_facets', {
    p_wh_scope:     scope,
    p_cat_scope:    scopeCategoriesOf(req),
    p_warehouse_id: warehouse_id || null,
    p_from:         date || date_from || null,
    p_to:           date || date_to || null,
  })
  if (error) return fail(res, error.message)
  return ok(res, data ?? {})
}

export async function listLoosePickingItems(req: Request, res: Response) {
  try {
    const { warehouse_id, date, date_from, date_to } = req.query as { warehouse_id?: string; date?: string; date_from?: string; date_to?: string }
    const q = req.query as Record<string, string | undefined>

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
      if (effective.length === 0) return ok(res, { items: [], total: 0, page: 1, page_size: 0, items_n: 0, pending_n: 0, loose_total: 0, loose_done: 0 })
      effectiveWh = effective
    } else if (warehouse_id) {
      effectiveWh = [warehouse_id]
    }

    // TRANG = CHUYẾN XE, chọn trong RPC `loose_picking_page` (migration 20260728_loose_picking_paged_rpc.sql).
    // Đường cũ nạp HẾT chuyến trong khoảng ngày rồi mới lọc `loose_picking > 0` ở tầng thứ ba —
    // vừa không có trần, vừa ngược chiều (điều kiện chọn-lọc-nhất áp cuối cùng).
    const pageNum  = Math.max(1, parseInt(String(q.page ?? '1'), 10) || 1)
    const pageSize = Math.min(500, Math.max(1, parseInt(String(q.page_size ?? '100'), 10) || 100))
    const { data: pageData, error: pageErr } = await supabase.rpc('loose_picking_page', {
      p_wh_scope:     effectiveWh,
      p_cat_scope:    looseCats,
      p_warehouse_id: null,          // đã gộp vào p_wh_scope ở trên
      p_from:         date || date_from || null,
      p_to:           date || date_to || null,
      p_wh_types:     looseCsv(q.wh_types),
      p_export_types: looseCsv(q.export_types),
      p_dvvts:        looseCsv(q.dvvts),
      p_npps:         looseCsv(q.npps),
      p_search:       q.search || null,
      p_offset:       (pageNum - 1) * pageSize,
      p_limit:        pageSize,
    })
    if (pageErr) return fail(res, pageErr.message)
    const pd = (pageData ?? {}) as {
      gdo_ids?: string[]; items?: unknown[]; total?: number; items_n?: number; pending_n?: number
      loose_total?: number; loose_done?: number
    }
    const meta = {
      total: pd.total ?? 0, page: pageNum, page_size: pageSize,
      items_n: pd.items_n ?? 0, pending_n: pd.pending_n ?? 0,
      loose_total: Number(pd.loose_total ?? 0), loose_done: Number(pd.loose_done ?? 0),
    }
    const gdoIdsPage = pd.gdo_ids ?? []
    if (!gdoIdsPage.length) return ok(res, { items: [], ...meta })

    // RPC trả THẲNG items đầy đủ (material + gdo + loose_scanned — migration 20260729)
    // ⇒ 1 request thay vì 5 (trước: nạp GDO + OutboundDelivery + OutboundItem + OutboundScanEntry).
    if (pd.items) return ok(res, { items: pd.items, ...meta })

    // Nhánh dự phòng cửa sổ triển khai (code mới chạy trước khi migration được apply)
    const gdos = await fetchAllByIdChunks(gdoIdsPage, chunk => supabase.from('GroupDeliveryOrder')
      .select('id, group_code, delivery_date, planned_date, status, started_at, dvvt, warehouse_type, warehouse:Warehouse(id,code,name)')
      .in('id', chunk).order('id'))

    if (!gdos?.length) return ok(res, { items: [], ...meta })

    const gdoIds = (gdos as any[]).map((g: any) => g.id as string)
    // CHUNK id 300/lô — hàng nghìn id trong 1 `.in()` = URL quá dài → PostgREST Bad Request (đồng bộ listGDOs)
    const dos = await fetchAllByIdChunks(gdoIds, chunk => supabase.from('OutboundDelivery')
      .select('id, gdo_id, distributor_name').in('gdo_id', chunk).order('id'))

    const doIds = (dos ?? []).map((d: any) => d.id as string)
    if (!doIds.length) return ok(res, { items: [], ...meta })

    const items = await fetchAllByIdChunks(doIds, chunk => supabase.from('OutboundItem')
      .select('*, material:Material(id,material_code,short_name,base_unit,entry_unit,units_per_carton)')
      .in('do_id', chunk)
      .gt('loose_picking', 0)
      .neq('status', 'CANCELLED')
      .order('id'))

    if (!items?.length) return ok(res, { items: [], ...meta })

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

    // Tính loose_scanned (thùng thực sự quét qua chế độ nhặt lẻ) per item — chunk id + phân trang.
    const itemIds = (items as any[]).map((i: any) => i.id as string)
    const looseScans = await fetchAllByIdChunks(itemIds, chunk => supabase.from('OutboundScanEntry')
      .select('item_id, cartons_scanned').in('item_id', chunk).eq('is_loose_picking', true).order('id'))
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

    return ok(res, { items: result, ...meta })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── Get stock for manual-complete dialog ─────────────────────

export async function getManualItemStock(req: Request, res: Response) {
  try {
    const { gdoId, itemId } = req.params
    const [{ data: gdo }, { data: item }] = await Promise.all([
      supabase.from('GroupDeliveryOrder').select('warehouse_id, warehouse:Warehouse(inventory_mode)').eq('id', gdoId).single(),
      supabase.from('OutboundItem')
        .select('material_code_raw, cartons_ordered, cartons_scanned, material:Material!material_id(material_code)')
        .eq('id', itemId).single(),
    ])
    if (!gdo || !item) return fail(res, 'Không tìm thấy', 404)
    const materialCode = (item.material as any)?.material_code ?? item.material_code_raw
    // GỘP qua mọi dòng cùng pallet_code (mã pool có thể có nhiều dòng sau khi xuất hết rồi nhập lại) — KHÔNG maybeSingle.
    const { data: invRows } = await supabase
      .from('InventoryEntry')
      .select('cartons_imported, cartons_remaining, production_date')
      .eq('pallet_code', materialCode)
      .eq('warehouse_id', gdo.warehouse_id)
    const rows = (invRows ?? []) as { cartons_imported: number; cartons_remaining: number; production_date?: string | null }[]
    const sumRemaining = rows.reduce((s, r) => s + Number(r.cartons_remaining), 0)
    const sumImported  = rows.reduce((s, r) => s + Number(r.cartons_imported), 0)
    // Kho QTY_DATE: liệt kê pool theo NSX (FEFO — cũ nhất trước) để FE cho chọn dòng date khi cần
    const invMode = (gdo as any)?.warehouse?.inventory_mode ?? null
    const date_pools = invMode === 'QTY_DATE'
      ? rows.filter(r => Number(r.cartons_remaining) > 0)
          .map(r => ({ production_date: String(r.production_date ?? '').slice(0, 10) || null, cartons_remaining: Number(r.cartons_remaining) }))
          .sort((a, b) => ((a.production_date ?? '9999-99-99') < (b.production_date ?? '9999-99-99') ? -1 : 1))
      : undefined
    return ok(res, {
      cartons_imported:  sumImported,
      cartons_remaining: sumRemaining,
      cartons_ordered:   item.cartons_ordered,
      cartons_scanned:   item.cartons_scanned ?? 0,
      inventory_mode:    invMode,                                           // NONE → không có trần tồn (FE)
      ...(date_pools ? { date_pools } : {}),
      has_pool:          rows.length > 0,                                   // có dòng tồn = được theo dõi
    })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── Manual complete item ─────────────────────────────────────

// Áp delta vào tồn pool dùng chung (hàng no-QR/kho QTY: 1 dòng InventoryEntry pallet_code = mã hàng) —
// optimistic-CAS + jitter, đọc lại remaining MỖI lần thử (nhiều đơn cùng xuất 1 mã → không retry thì ~nửa 409 oan).
// INSUFFICIENT (thiếu tồn thật) KHÔNG retry; BUSY = CAS trượt hết 15 lần.
// AN TOÀN ĐA-DÒNG: một mã pool có thể có NHIỀU dòng InventoryEntry cùng pallet_code trong 1 kho
// (xuất hết → dòng cũ EXPORTED=0, rồi NHẬP LẠI → sinh dòng mới). maybeSingle sẽ lỗi với 2+ dòng → trả 0
// → user "mất khả dụng". Nay GỘP qua mọi dòng: đọc tổng, trừ lần lượt các dòng còn tồn, hoàn vào 1 dòng.
// Không có dòng nào: kho QTY (theo dõi số lượng) → tồn 0 → CHẶN xuất (delta>0); NONE/khác → OK (không theo dõi mã này).
type PoolRow = { id: string; cartons_remaining: number; cartons_imported: number; status: string; production_date?: string | null }
async function applyToPoolRow(row: PoolRow, take: number): Promise<boolean> {
  // take>0: trừ · take<0: cộng lại. CAS theo cartons_remaining cũ (chống mất cập nhật khi đua).
  const cur = Number(row.cartons_remaining)
  const imported = Number(row.cartons_imported)
  const next = cur - take
  if (next < 0) return false
  const { data: applied } = await supabase.from('InventoryEntry').update({
    cartons_remaining: next,
    status: next === 0 ? 'EXPORTED' : next < imported ? 'PARTIAL' : 'IN_STOCK',
    updated_at: now(),
  }).eq('id', row.id).eq('cartons_remaining', cur).select('id')
  return !!applied?.length
}
async function applySharedPoolDelta(materialCode: string, warehouseId: string, delta: number, mode?: string | null,
  productionDate?: string | null):
  Promise<{ outcome: 'OK' | 'INSUFFICIENT' | 'BUSY'; invEntryId: string | null; available: number }> {
  const isQtyDate = mode === 'QTY_DATE'
  const dateOf = (r: PoolRow) => String(r.production_date ?? '').slice(0, 10)
  const loadRows = async (): Promise<PoolRow[]> => {
    // order NSX cũ trước ngay từ DB: kho QTY_DATE tích lũy 1 dòng/NSX — nếu vượt cap 1000 dòng/response
    // thì phần bị cắt là NSX MỚI nhất (an toàn cho FEFO tiêu trước dòng cũ, không mất dòng cũ).
    const { data } = await supabase.from('InventoryEntry')
      .select('id, cartons_remaining, cartons_imported, status, production_date')
      .eq('pallet_code', materialCode).eq('warehouse_id', warehouseId)
      .order('production_date', { ascending: true })
    let list = ((data ?? []) as PoolRow[])
    // QTY_DATE + người xuất CHỌN NSX cụ thể → chỉ thao tác trên pool đúng NSX đó
    if (isQtyDate && productionDate) list = list.filter(r => dateOf(r) === productionDate)
    // QTY_DATE: FEFO — NSX cũ nhất trước (thiếu NSX xuống cuối); mode khác giữ thứ tự còn-nhiều-trước
    if (isQtyDate) list.sort((a, b) => (dateOf(a) || '9999-99-99') < (dateOf(b) || '9999-99-99') ? -1 : 1)
    return list
  }
  for (let attempt = 0; attempt < 15; attempt++) {
    const rows = await loadRows()
    const totalRemaining = rows.reduce((s, r) => s + Number(r.cartons_remaining), 0)
    const primaryId = rows[0]?.id ?? null

    if (delta === 0) return { outcome: 'OK', invEntryId: primaryId, available: totalRemaining }

    if (delta < 0) {
      // Hoàn tồn |delta|: cộng vào 1 dòng (ưu tiên dòng còn tồn, else dòng bất kỳ để hồi sinh).
      // QTY_DATE: rows đã sort FEFO → hoàn vào NSX cũ nhất (đối xứng với chiều trừ).
      if (rows.length === 0) return { outcome: 'OK', invEntryId: null, available: 0 }   // không có dòng để hoàn (untracked)
      const target = rows.find(r => Number(r.cartons_remaining) > 0) ?? rows[0]
      if (await applyToPoolRow(target, delta)) return { outcome: 'OK', invEntryId: target.id, available: totalRemaining - delta }
      await new Promise(r => setTimeout(r, 10 + Math.floor(Math.random() * (30 + attempt * 20))))
      continue
    }

    // delta > 0: trừ tồn
    if (rows.length === 0) {
      if (isQtyLike(mode)) return { outcome: 'INSUFFICIENT', invEntryId: null, available: 0 }   // QTY/QTY_DATE: chưa có tồn = 0 → chặn
      return { outcome: 'OK', invEntryId: null, available: 0 }                                  // NONE/khác: không theo dõi
    }
    if (totalRemaining < delta) return { outcome: 'INSUFFICIENT', invEntryId: primaryId, available: totalRemaining }

    // Trừ lần lượt từ các dòng còn tồn. QTY_DATE: theo FEFO (NSX cũ trước, đã sort ở loadRows);
    // mode khác: còn-nhiều-trước như cũ. Nếu 1 dòng bị đua → hoàn lại phần đã trừ rồi retry cả lượt.
    const withStock = rows.filter(r => Number(r.cartons_remaining) > 0)
    if (!isQtyDate) withStock.sort((a, b) => Number(b.cartons_remaining) - Number(a.cartons_remaining))
    let need = delta
    let firstConsumed: string | null = null
    let raced = false
    for (const row of withStock) {
      if (need <= 0) break
      const take = Math.min(need, Number(row.cartons_remaining))
      if (!(await applyToPoolRow(row, take))) { raced = true; break }
      need -= take
      if (!firstConsumed) firstConsumed = row.id
    }
    if (!raced && need <= 0) return { outcome: 'OK', invEntryId: firstConsumed ?? primaryId, available: totalRemaining - delta }
    // Đua giữa chừng: hoàn trả phần đã trừ (retry đến khi trả xong để KHÔNG mất tồn) rồi thử lại cả lượt.
    const consumed = delta - need
    if (consumed > 0) {
      for (let back = 0; back < 20; back++) {
        const cur = await loadRows()
        const t = cur.find(r => r.id === firstConsumed) ?? cur[0]
        if (t && await applyToPoolRow(t, -consumed)) break
        await new Promise(r => setTimeout(r, 10 + Math.floor(Math.random() * 40)))
      }
    }
    await new Promise(r => setTimeout(r, 10 + Math.floor(Math.random() * (30 + attempt * 20))))
  }
  return { outcome: 'BUSY', invEntryId: null, available: 0 }
}

export async function manualCompleteItem(req: Request, res: Response) {
  try {
    if (!requireBaseQty(req, res)) return   // BASE UNIT: chặn payload bundle cũ (thùng thập phân)
    const { gdoId, itemId } = req.params

    const { cartons, production_date } = req.body as { cartons?: number; production_date?: string | null }
    // Số gửi lên phải hợp lệ — TUYỆT ĐỐI không fallback sang KH (số âm/NaN mà thành "xuất đủ" là mất hàng oan)
    if (cartons != null && (!Number.isFinite(Number(cartons)) || Number(cartons) < 0)) {
      return fail(res, 'Số thùng không hợp lệ — phải là số ≥ 0', 400)
    }

    const [{ data: gdo }, { data: item }] = await Promise.all([
      supabase.from('GroupDeliveryOrder').select('status, warehouse_id, warehouse:Warehouse(inventory_mode)').eq('id', gdoId).single(),
      supabase.from('OutboundItem')
        .select('id, do_id, material_id, material_type, material_code_raw, cartons_ordered, cartons_scanned, material:Material!material_id(material_code, no_qr_tracking, base_unit, entry_unit, units_per_carton)')
        .eq('id', itemId).single(),
    ])
    if (!inScope(req, gdo?.warehouse_id)) return fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403)
    if (gdo?.status === 'PAUSED') return fail(res, 'Chuyến xe đang tạm dừng — không thể cập nhật', 400)
    if (!item) return fail(res, 'Không tìm thấy mặt hàng', 404)

    // BASE UNIT: cartons từ FE = SỐ BASE — mã có entry phải là số nguyên
    if (cartons != null) {
      const ie = qtyIntegerError(Number(cartons), (item.material ?? null) as MatUnitsQ | null)
      if (ie) return fail(res, ie, 422)
    }
    const ctn = (cartons != null && Number(cartons) >= 0) ? Math.round(Number(cartons)) : Number(item.cartons_ordered)

    if (ctn > Number(item.cartons_ordered)) {
      return fail(res, 400, 'EXCEEDS_PLAN', `Số lượng (${qtyLabel(ctn, (item.material ?? null) as MatUnitsQ)}) vượt kế hoạch (${qtyLabel(Number(item.cartons_ordered), (item.material ?? null) as MatUnitsQ)})`)
    }

    // Kho QTY → ép no-QR hiệu lực (xuất tay qua pool dùng chung như mã no_qr_tracking)
    const gdoMode = (gdo as { warehouse?: { inventory_mode?: string | null } | null } | null)?.warehouse?.inventory_mode
    const isSpecial = effectiveNoQr((item.material as any)?.no_qr_tracking, gdoMode)
    const specialMatCode: string | null = isSpecial ? ((item.material as any)?.material_code ?? item.material_code_raw ?? null) : null
    let specialInvEntryId: string | null = null

    if (isSpecial && item.material_id && gdo?.warehouse_id && specialMatCode) {
      const oldCartons = Number(item.cartons_scanned) || 0
      const delta = ctn - oldCartons   // >0: xuất thêm (trừ tồn) · <0: giảm (cộng lại) · =0: không đổi
      // QTY_DATE: mặc định FEFO (NSX cũ nhất trước); người xuất CHỌN NSX → chỉ trừ pool NSX đó
      const chosenDate = gdoMode === 'QTY_DATE' && production_date ? String(production_date).slice(0, 10) : null
      const r = await applySharedPoolDelta(specialMatCode, gdo.warehouse_id as string, delta, gdoMode, chosenDate)
      specialInvEntryId = r.invEntryId
      if (r.outcome === 'INSUFFICIENT') {
        const mu = (item.material ?? null) as MatUnitsQ | null
        return fail(res, 400, 'INSUFFICIENT_STOCK',
          `Không đủ tồn kho${chosenDate ? ` NSX ${chosenDate}` : ''} — còn ${qtyLabel(r.available, mu)}${oldCartons > 0 ? `, cần thêm ${qtyLabel(delta, mu)}` : ''}`)
      }
      if (r.outcome === 'BUSY') return fail(res, 409, 'STOCK_CHANGED', 'Tồn kho mã này đang bận (nhiều người thao tác) — thử lại')
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
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
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
    const requested = parseListParam(warehouse_ids) ?? []
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

// SEARCH TỔNG lịch sử quét (user chốt 15/07): 1 ô tìm mọi thứ (QR pallet/tem thùng/NPP/tên
// hàng/mã hàng/DO/số xe/biển số/vị trí/người quét) — BYPASS chọn Kho+Loại kho ở FE nhưng
// VẪN cắt theo scope kho + loại hàng của user (JWT). RPC search_outbound_scan_log
// (migration 20260715_scanlog_search) — shape giống get_outbound_scan_log để FE tái dùng bảng.
export async function searchScanLog(req: Request, res: Response) {
  const { q, page = '1', limit = '500' } = req.query
  const query = normalizeQR(String(q ?? ''))   // tem V2 đệm space → chuẩn hóa như mọi điểm quét
  const pageNum  = Math.max(1, parseInt(String(page)))
  const limitNum = Math.min(1000, Math.max(1, parseInt(String(limit))))
  if (query.length < 2) return ok(res, { rows: [], total: 0, page: pageNum, limit: limitNum })

  // Scope kho từ JWT (không nhận warehouse_ids từ FE — search toàn phạm vi user được thấy)
  const whScope = req.user?.warehouse_scope !== 'NATIONAL' ? (req.user?.warehouse_ids ?? []) : []
  const scanCats = scopeCategoriesOf(req)
  const rpcParams: Record<string, unknown> = {
    p_q: query,
    p_warehouse_ids: whScope.length > 0 ? whScope.join(',') : null,
    p_allowed_categories: scanCats ? scanCats.join(',') : null,
    p_limit: limitNum,
    p_offset: (pageNum - 1) * limitNum,
  }
  const { data, error } = await supabase.rpc('search_outbound_scan_log', rpcParams)
  if (error) {
    // RPC chưa apply migration → báo rõ thay vì lỗi mù
    if (/search_outbound_scan_log|schema cache/i.test(error.message))
      return fail(res, 'Chức năng search chưa sẵn sàng — cần apply migration 20260715_scanlog_search', 503)
    return fail(res, error.message, 500)
  }
  const rows = (data ?? []) as { total_count?: number }[]
  const total = rows[0]?.total_count ?? 0
  return ok(res, { rows, total: Number(total), page: pageNum, limit: limitNum })
}

export async function getScanLogFacets(req: Request, res: Response) {
  const { material_category, warehouse_ids } = req.query

  // Enforce warehouse scope từ JWT (giống getScanLog) → facets KHÔNG rò mã máy/chu kỳ kho khác
  const scopeWhIds = req.user?.warehouse_scope !== 'NATIONAL'
    ? (req.user?.warehouse_ids ?? [])
    : []
  let effectiveWarehouseIds: string | null = null
  if (scopeWhIds.length > 0) {
    const requested = parseListParam(warehouse_ids) ?? []
    const effective = requested.length > 0
      ? requested.filter(id => scopeWhIds.includes(id))
      : scopeWhIds
    if (effective.length === 0) return ok(res, { machines: [], cycles: [] })
    effectiveWarehouseIds = effective.join(',')
  } else {
    effectiveWarehouseIds = warehouse_ids ? String(warehouse_ids) : null
  }

  // Scope Loại hàng (giống getScanLog): chọn loại ngoài phạm vi → rỗng; truyền allowed cho RPC (có fallback)
  const scanCats = scopeCategoriesOf(req)
  if (scanCats && material_category && !scanCats.includes(String(material_category))) {
    return ok(res, { machines: [], cycles: [] })
  }
  const facetParams: Record<string, unknown> = {
    p_material_category: material_category ? String(material_category) : null,
    p_warehouse_ids:     effectiveWarehouseIds,
  }
  if (scanCats) facetParams.p_allowed_categories = scanCats.join(',')
  let { data, error } = await supabase.rpc('get_scan_log_facets', facetParams)
  // Fallback nếu RPC chưa có param p_allowed_categories (chưa apply migration) → giữ hành vi cũ (cắt kho)
  if (error && scanCats && /p_allowed_categories|function|schema cache/i.test(error.message)) {
    delete facetParams.p_allowed_categories
    ;({ data, error } = await supabase.rpc('get_scan_log_facets', facetParams))
  }
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  const row = (data as any[])?.[0] ?? {}
  return ok(res, { machines: row.machines ?? [], cycles: row.cycles ?? [] })
}
