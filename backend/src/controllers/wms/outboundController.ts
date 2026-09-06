import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { effectiveNoQr, markItemsNoQrIfQty, isQtyLike } from '../../lib/inventoryMode'
import { effCartonsPerPallet } from '../../utils/palletCalc'
import { normalizeQR } from '../../utils/qrParser'
import { wrongFormatHint, getDeliveryConfirmation } from './systemSettingController'
import { computePctDate, type MaterialShelfInfo } from '../../utils/shelfLife'
import {
  PICKABLE_STATUSES, asRotationPrinciple, isPickEligible, isRotationViolation, isRotationReason,
  rotationDateOf, rotationSortKey, ROTATION_DATE_LABEL, ROTATION_LABEL,
  type RotationCheck, type RotationEntry, type RotationPrinciple,
} from '../../utils/rotation'
import { resolveRotation, resolveLoosePolicy, type RotationConfig, type WhTypeConfigRow, type LoosePolicy } from '../../utils/putaway'
import { fetchAllRowsParallel, fetchAllByIdChunks, fetchUpTo, LIST_TOO_LARGE_MSG, rowCapForBytes, isQueryTimeout, QUERY_TIMEOUT_MSG } from '../../utils/pagination'
import { categoryAllowed, scopeCategoriesOf, CATEGORY_FORBIDDEN_MSG } from '../../utils/categoryScope'
import { safeFilterValue, safeSearch } from '../../utils/search'
import { warehouseRequiresCartonScan, warehouseCartonScanPolicy } from '../../utils/cartonScan'
import { reconcileFromSap, type OdKey } from '../../services/outboundReconcile'
import { logOutboundEvents, actorOf, type OutboundEventInput } from '../../services/outboundEvents'
import { syncTmsPlanFromKhvc } from '../../services/tmsPlanSync'
import { hasEntry, qtyIntegerError, qtyLabel, qtyEntryDecimal, qtySplit, unitLabel, type MatUnits as MatUnitsQ } from '../../utils/qtyUnits'
import { requireBaseQty } from '../../utils/qtySemantics'
import { parseListParam } from '../../utils/httpQuery'
import { normalizePlate } from '../../utils/plate'
import { isPreflight, buildPreflight, type PreflightExtra } from '../../utils/uploadPreflight'
import { expandMergedCells, readWorkbookSafe, BAD_EXCEL_MSG } from '../../utils/excelHeader'
import { heldSlotsByVehicle, slotHeldBlockingCategory, slotHeldBlockingDate, deleteVehicleSlotsAndRecount } from '../../utils/bookingGuards'
import { guardPutaway } from '../../services/putawayContext'

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
// Chống IDOR (kiểm định 02/09): dòng hàng trên URL phải THUỘC chuyến trên URL. Scope kho chỉ kiểm trên GDO, nên
// itemId của kho khác ghép với gdoId hợp lệ của mình là ghi số / hoàn tồn vào kho khác. Ràng ngay trong câu SELECT
// bằng embed `!inner()` (chỉ lọc, KHÔNG trả cột — đo PostgREST 02/09: select=* vẫn 20 cột, không có key `do`)
// ⇒ dòng hàng lệch chuyến = 404 "Không tìm thấy mặt hàng" như dòng không tồn tại, 0 request thêm. QA gói 41 gác 8 route.
const ITEM_IN_GDO = 'do:OutboundDelivery!do_id!inner()'
function itemOfGdo(itemId: string, gdoId: string, cols = '*') {
  // Kiểu: parser select của supabase-js không đọc được chuỗi GHÉP ĐỘNG (ParserError) → khai kiểu như `select('*')`
  // mà 8 chỗ gọi vốn dùng (client chưa có generic Database nên '*' = dòng lỏng, không đổi hành vi kiểu cũ).
  const sel: string = `${cols}, ${ITEM_IN_GDO}`
  return supabase.from('OutboundItem').select(sel as '*').eq('id', itemId).eq('do.gdo_id', gdoId).single()
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
// NGOẠI LỆ DUY NHẤT (user chốt 02/08): chuyến gắn đăng ký cổng của xe ĐÃ RA / đang bốc nhiều đơn
// thì phiếu ĐÃ cân xong vẫn tính — xem `weighRelaxAllowed` ngay dưới.
// Xe không cân được (hỏng cân…) → duyệt bỏ qua: quyền `outbound.weigh_waive` (route riêng hoặc
// body weigh_waive=true ngay lúc bấm). Áp cả 3 đường set started_at: startGDO + 2 đường Xuất luôn.

const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const hhmmVN = (ts: string | null | undefined) =>
  ts ? new Date(ts).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }) : '—'

// CHẶN XUẤT SỚM (user chốt 02/08): hôm nay KHÔNG được quét/xuất cho đơn có Ngày xuất ở TƯƠNG LAI
// (ngày VN). Áp mọi đường THỰC THI: Bắt đầu + 2 đường Xuất luôn + quét/Lưu thủ công (phòng chuyến
// đổi ngày sau khi start). NGOẠI LỆ: nhặt lẻ (loose_picking_mode) = SOẠN HÀNG TRƯỚC, chủ đích cho
// làm sớm (chỉ giữ hàng, chưa trừ xuất). Ngày quá khứ vẫn xuất được (xuất trễ là thực tế).
function futureDateError(deliveryDate?: string | null): string | null {
  const d = String(deliveryDate ?? '').slice(0, 10)
  if (!d || d <= todayVN()) return null
  const [y, m, dd] = d.split('-')
  return `Đơn có Ngày xuất ${dd}/${m}/${y} (tương lai) — hôm nay chưa được quét/xuất. Cần đi sớm: đổi Ngày xuất về hôm nay ở nguồn (chuyến SAP: tab Kế hoạch xuất · chuyến thường: Sửa đơn/Chuyển ngày).`
}

// CHUYẾN BẤT ĐỘNG (user chốt 03/08) — 2 lý do, cùng 1 hệ quả: chuyến hiện trên màn nhưng KHÔNG
// thao tác được (chỉ xem + xem lịch sử). Chặn ở ĐÚNG các cửa THỰC THI như luật chặn xuất sớm,
// KHÔNG chặn Hủy/Xóa/xem (phải cho dọn) và không chặn sửa ở NGUỒN (Kế hoạch xuất).
//   awaiting_sap  → còn DO chưa có dữ liệu VL06O: không biết phải xuất hàng gì, số bao nhiêu
//   plan_dropped  → Kế hoạch xuất đã bỏ Số xe này: chuyến giữ lại để tra cứu, không còn hiệu lực
type GdoInertState = { awaiting_sap?: boolean | null; awaiting_dos?: string[] | null; plan_dropped?: boolean | null }
function inertError(gdo: GdoInertState | null | undefined): string | null {
  if (gdo?.plan_dropped)
    return 'Chuyến đã NGỪNG HOẠT ĐỘNG vì Kế hoạch xuất không còn Số xe này — chỉ xem được thông tin và lịch sử. Muốn chạy lại thì thêm lại dòng kế hoạch ở tab "Kế hoạch xuất".'
  if (gdo?.awaiting_sap) {
    const dos = (gdo.awaiting_dos ?? []).filter(Boolean)
    return `Chuyến đang CHỜ DỮ LIỆU SAP${dos.length ? ` (DO: ${dos.join(', ')})` : ''} — chưa có dòng hàng nên chưa xuất được. Up VL06O có các DO này là chuyến tự hoạt động trở lại.`
  }
  return null
}
const INERT_COLS = 'awaiting_sap, awaiting_dos, plan_dropped'

// Chuyến ĐÃ BẮT ĐẦU thì KHÔNG được đẩy Ngày xuất sang TƯƠNG LAI: hàng đã ghi nhận/trừ tồn mà ngày
// nhảy lên tương lai là mâu thuẫn (xuất trước ngày xuất), và trước khi có luật này nó tạo ra NGÕ CỤT —
// mọi đường ghi đều 422 nên tồn đã trừ không trả lại được (probe 02/08 B2). Kéo ngày về hôm nay/quá
// khứ vẫn cho (sửa nhầm ngày là nhu cầu thật).
type GdoDateShift = { started_at?: string | null; delivery_date?: string | null }
function futureShiftError(cur: GdoDateShift | null, newDate?: string | null): string | null {
  if (!cur?.started_at || !newDate) return null
  const d = String(newDate).slice(0, 10)
  if (d === String(cur.delivery_date ?? '').slice(0, 10) || d <= todayVN()) return null
  const [y, m, dd] = d.split('-')
  return `Chuyến đã Bắt đầu xuất hàng — không dời Ngày xuất sang ${dd}/${m}/${y} (tương lai). Xuất nhầm ngày thì sửa về hôm nay/ngày đã xuất; muốn hoãn sang ngày khác hãy Bỏ bắt đầu (hoàn số đã ghi) trước.`
}

type WeighGate = { ok: true; ticketId: string | null } | { ok: false; message: string }

// NỚI rule CÂN đúng MỘT tình huống (user chốt 02/08): chuyến gắn ĐĂNG KÝ CỔNG của xe **ĐÃ RA**
// (`exit_at`) — hoặc đăng ký đang dùng chung với chuyến khác (**bốc nhiều đơn**). Đúng 2 nghĩa của
// tick "Trường hợp đặc biệt" ở picker chuyến xe.
// Vì sao cần: xe ra khỏi kho thì phiếu cân ĐÃ HOÀN THÀNH (cân bì + cân ra xong — đo staging
// 7.779/7.964 phiếu, cuối ngày gần 100%), nên bộ lọc "chưa cân xong" chặn oan chuyến ghi nhận
// muộn, mà rule cân KHÔNG có đường nào làm đúng ngoài đi duyệt bỏ qua ⇒ rule thành ngõ cụt.
// Tín hiệu nới lấy TỪ DB (exit_at / gate đã gắn chuyến), KHÔNG tin cờ client gửi lên.
async function weighRelaxAllowed(gateRegId: string | null | undefined, currentGdoId?: string): Promise<boolean> {
  if (!gateRegId) return false
  const { data: g } = await supabase.from('gate_registrations')
    .select('exit_at').eq('id', gateRegId).maybeSingle()
  if ((g as { exit_at?: string | null } | null)?.exit_at) return true
  let q = supabase.from('GroupDeliveryOrder').select('id').eq('gate_registration_id', gateRegId).limit(1)
  if (currentGdoId) q = q.neq('id', currentGdoId)
  const { data: shared } = await q
  return ((shared ?? []) as { id: string }[]).length > 0
}

async function checkWeighGate(
  warehouseId: string | null | undefined, licensePlate: string | null | undefined, currentGdoId?: string,
  gateRegId?: string | null,
): Promise<WeighGate> {
  // Caller đã kiểm cờ require_weigh_on_start của kho (đọc kèm query GDO/Warehouse sẵn có) — hàm này
  // chỉ lo phần khớp phiếu cân, không tự fetch cờ nữa (đỡ 1 roundtrip mỗi lượt Bắt đầu).
  if (!warehouseId) return { ok: true, ticketId: null }
  const plate = normalizePlate(licensePlate)
  if (!plate) return { ok: true, ticketId: null }   // chuyển nội bộ không biển số — đã có guard biển số riêng
  const { data: tks, error } = await supabase.from('WeighTicket')
    .select('id, gdo_id, warehouse_id, is_complete, ticket_no, out_time')
    .eq('weigh_date', todayVN()).eq('license_plate_norm', plate)
    .order('in_time', { ascending: false, nullsFirst: false }).limit(20)
  if (error) return { ok: true, ticketId: null }    // bảng chưa có → như trên, fail-open cửa sổ deploy
  type Tk = { id: string; gdo_id: string | null; warehouse_id: string | null; is_complete: boolean | null; ticket_no: string | null; out_time: string | null }
  // Phiếu thuộc kho này (phiếu chưa gắn kho vẫn tính — null-inclusive)
  const ofWh = ((tks ?? []) as Tk[]).filter(t => !t.warehouse_id || t.warehouse_id === warehouseId)
  // Ưu tiên gắn phiếu CHƯA gắn chuyến, mới nhất trước (phiếu đã gắn đúng chuyến này thì khỏi gắn lại)
  const pick = (list: Tk[]) => list.find(t => !t.gdo_id)?.id ?? null
  // Luồng THƯỜNG (xe đang trong kho) qua rule khi:
  // - phiếu CHƯA cân xong và chưa gắn chuyến khác (xe vừa cân bì, chờ bốc hàng), HOẶC
  // - phiếu ĐÃ gắn ĐÚNG chuyến này — kể cả đã cân xong (unstart → start lại không bị chặn oan)
  const strict = ofWh.filter(t => (t.gdo_id ? t.gdo_id === currentGdoId : !t.is_complete))
  if (strict.length) return { ok: true, ticketId: pick(strict) }
  if (!ofWh.length) return {
    ok: false,
    message: `Xe ${plate} chưa có phiếu cân hôm nay (xe phải CÂN BÌ trước khi bắt đầu làm hàng). Cho xe lên cân rồi thử lại — trường hợp không cân được (hỏng cân…) cần người có quyền "Duyệt bỏ qua cân".`,
  }
  // CÓ phiếu nhưng đã cân xong / đang thuộc chuyến khác → chỉ qua khi đúng ca "xe đã ra / bốc nhiều đơn"
  if (await weighRelaxAllowed(gateRegId, currentGdoId)) return { ok: true, ticketId: pick(ofWh) }
  const t0 = ofWh[0]
  return {
    ok: false,
    message: `Xe ${plate} có phiếu cân hôm nay (${t0.ticket_no ?? 'không số'}) nhưng ${t0.is_complete ? `đã cân xong lúc ${hhmmVN(t0.out_time)}` : 'đang gắn chuyến khác'} — chuyến này chưa dùng được phiếu đó. Nếu đúng là xe ĐÃ RA hoặc BỐC NHIỀU ĐƠN cùng chuyến: tick "Trường hợp đặc biệt" ở ô Chuyến xe rồi chọn đúng Đăng ký cổng của xe. Xe không có đăng ký cổng → cần người có quyền "Duyệt bỏ qua cân".`,
  }
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
  const MSG = `Xe ${plate ?? ''} chưa gắn Đăng ký cổng — kho này yêu cầu xe phải có ĐĂNG KÝ CỔNG (đã vào) trước khi bắt đầu làm hàng. Xe chưa đăng ký: báo bảo vệ tạo Đăng ký cổng rồi chọn lại; trường hợp đặc biệt (giao lẻ, xe máy, nhân viên nhận…) cần người có quyền "Duyệt bỏ qua cổng/cân" duyệt trên chuyến.`
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
  // Đường NHANH: khoá dòng trong DB (migration 20260906) — 1 lượt gọi, không thử lại, không ngủ.
  // RPC chưa apply → rơi về vòng CAS bên dưới NGUYÊN VẸN (cửa sổ triển khai).
  {
    const { data, error } = await supabase.rpc('outbound_adjust_entry', {
      p_entry_id: invId, p_delta_remaining: deltaRemaining, p_delta_reserved: deltaReserved, p_now: now(),
    })
    if (!error && data) return (data as { ok?: boolean }).ok === true
  }
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

// Chuyến đang GIỮ HÀNG NHẶT LẺ (đã soạn — user chốt 05/08: hàng VẬT LÝ đã rời pallet xuống vị trí
// chờ, "nhả trên giấy" là lệch hiện trường). Kế hoạch xuất KHÔNG được tự xóa/ghi đè/ngừng các
// chuyến này — user phải GỠ TRẢ hàng nhặt lẻ trên chuyến trước (trả hàng về chỗ cũ) rồi mới sửa.
// Đếm CẢ loose đã xác nhận lẫn chưa (cùng một thực tế: hàng đang nằm ở khu chờ).
export async function looseHeldGdoIds(gdoIds: string[]): Promise<Set<string>> {
  const held = new Set<string>()
  if (!gdoIds.length) return held
  const dvs = await fetchAllByIdChunks(gdoIds, chunk => supabase.from('OutboundDelivery')
    .select('id, gdo_id').in('gdo_id', chunk).order('id')) as { id: string; gdo_id: string }[]
  if (!dvs.length) return held
  const gdoByDo = new Map(dvs.map(d => [d.id, d.gdo_id]))
  const items = await fetchAllByIdChunks(dvs.map(d => d.id), chunk => supabase.from('OutboundItem')
    .select('id, do_id').in('do_id', chunk).order('id')) as { id: string; do_id: string }[]
  if (!items.length) return held
  const gdoByItem = new Map(items.map(i => [i.id, gdoByDo.get(i.do_id)]))
  const scans = await fetchAllByIdChunks(items.map(i => i.id), chunk => supabase.from('OutboundScanEntry')
    .select('item_id').eq('is_loose_picking', true).gt('cartons_scanned', 0)
    .in('item_id', chunk).order('id')) as { item_id: string }[]
  for (const s of (scans ?? [])) { const g = gdoByItem.get(s.item_id); if (g) held.add(g) }
  return held
}

// XUẤT (trừ remaining) NGUYÊN TỬ: chỉ trừ ĐÚNG `amount` nếu tồn còn đủ, dưới optimistic-lock.
// Trả: true=trừ xong · false=KHÔNG đủ tồn (đã bị thao tác khác lấy) · null=tranh chấp sau 5 lần.
// Chống đua + chống xuất-quá-tồn khi nhiều nhân viên quét cùng 1 pallet (giống book_vehicle_slot).
async function consumeInventoryExact(invId: string, amount: number): Promise<boolean | null> {
  // Đường NHANH: khoá dòng trong DB (migration 20260906). Ngữ nghĩa y hệt vòng CAS bên dưới:
  // true = đã trừ · false = KHÔNG ĐỦ tồn · null = không tìm thấy dòng.
  {
    const { data, error } = await supabase.rpc('outbound_consume_exact', {
      p_entry_id: invId, p_amount: amount, p_now: now(),
    })
    if (!error && data) {
      const r = data as { ok?: boolean; missing?: boolean }
      if (r.missing) return null
      return r.ok === true ? true : false
    }
  }
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

/**
 * ĐẶT GẠCH hạn mức của dòng hàng NGUYÊN TỬ — trả SỐ THỰC ĐƯỢC CẤP (có thể nhỏ hơn số muốn).
 *
 * VÌ SAO (bug thật, tái hiện 100% ngày 29/08): trần "còn được quét bao nhiêu" được tính từ bản
 * chụp `item` đọc ở ĐẦU hàm, còn việc cộng dồn thì mãi cuối hàm mới làm ⇒ check-then-act. Ba người
 * cùng quét MỘT dòng hàng đặt 240: cả ba đều thấy "còn 240", cả ba đều được cấp ⇒ dòng hàng ghi
 * **720/240** và tồn bị trừ 720 — tức là **xuất thừa 3 lần lên xe**. Chạy tuần tự thì hai lượt sau
 * bị chặn đúng, nên lỗi chỉ hiện khi đông người — đúng cảnh ca cao điểm.
 * `addItemScanned` (CAS trên TỔNG) không cứu được: nó bảo đảm không MẤT cộng dồn, nhưng không hề
 * kiểm trần ⇒ vẫn cộng vượt.
 *
 * ⇒ Hạn mức phải được ĐẶT GẠCH TRƯỚC mọi thao tác khác. Đặt gạch trước được vì hạn mức là bộ đếm
 * thuần — nhả lại luôn thành công; còn tồn kho và vị trí thì nhả lại có thể HỎNG (ô đã bị người
 * khác lấp đầy), nên không được phép làm chúng trước rồi mới biết mình không có quyền.
 *
 * Trả: số được cấp (>0) · 'FULL' nếu dòng hàng đã đủ · null nếu tranh chấp quá 15 lượt.
 */
async function claimItemQuota(
  itemId: string, want: number, ceiling: number, statusOf: (total: number) => string,
  completeWhenFull?: boolean,
): Promise<{ grant: number; total: number | null } | 'FULL' | null> {
  // Đường NHANH: khoá dòng trong DB (migration 20260906) — 1 lượt gọi thay cho đọc+CAS, và
  // KHÔNG thử lại (người đến sau chờ trên khoá vài ms rồi đọc số mới nhất). Trả luôn TỔNG mới
  // nên caller khỏi đọc lại lần nữa.
  if (completeWhenFull != null) {
    const { data, error } = await supabase.rpc('outbound_claim_quota', {
      p_item_id: itemId, p_want: want, p_ceiling: ceiling,
      p_complete_when_full: completeWhenFull, p_now: now(),
    })
    if (!error && data) {
      const r = data as { grant?: number; total?: number; missing?: boolean }
      if (r.missing) return null
      if (Number(r.grant ?? 0) <= 0) return 'FULL'
      return { grant: Number(r.grant), total: Number(r.total) }
    }
  }
  for (let attempt = 0; attempt < 15; attempt++) {
    const { data: it } = await supabase.from('OutboundItem')
      .select('cartons_scanned').eq('id', itemId).single()
    if (!it) return null
    const cur = Number(it.cartons_scanned ?? 0)
    const grant = Math.min(want, ceiling - cur)
    if (grant <= 0) return 'FULL'
    const next = cur + grant
    const { data: applied } = await supabase.from('OutboundItem')
      .update({ cartons_scanned: next, status: statusOf(next), updated_at: now() })
      .eq('id', itemId).eq('cartons_scanned', cur).select('id')
    if (applied?.length) return { grant, total: next }
    await new Promise(r => setTimeout(r, 10 + Math.floor(Math.random() * (30 + attempt * 20))))
  }
  return null
}

/** Đọc lại TỔNG đã quét của dòng hàng (sau khi hạn mức đã đặt gạch) — chỉ để trả về màn quét. */
async function currentItemScanned(itemId: string): Promise<number | null> {
  const { data } = await supabase.from('OutboundItem').select('cartons_scanned').eq('id', itemId).maybeSingle()
  return data ? Number(data.cartons_scanned ?? 0) : null
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
    .select('*, warehouse:Warehouse(id,code,name,inventory_mode,require_weigh_on_start,require_gate_on_start), gate_registration:gate_registrations!gate_registration_id(id,registration_number,date,license_plate,company_name_raw,driver_name,status,direction,registered_at,entry_at,exit_at,called_at)')
    .eq('id', id).single()
  if (error || !gdo) return null

  // Phiếu cân gắn chuyến + ước tính KL hàng (kg) — đối chiếu KL cân thực với KL tính từ
  // Material.weight_kg (migration 20260801_weigh_gate). RPC quét cả chuyến (DO⋈Item⋈Material) mà
  // fetchGDOFull nằm trên đường nóng (mọi mutation + refetch sau mỗi lần quét) → CHỈ chạy khi kho
  // bật rule cân; kho khác chạy bù nếu chuyến CÓ phiếu gắn tay (hiếm).
  const requireWeighFlag = (gdo as unknown as { warehouse?: { require_weigh_on_start?: boolean | null } | null }).warehouse?.require_weigh_on_start === true
  const [wtRes, westRes0] = await Promise.all([
    supabase.from('WeighTicket')
      .select('id, ticket_no, weigh_date, license_plate, tare_kg, gross_kg, net_kg, is_complete, in_time, out_time')
      .eq('gdo_id', id).order('in_time', { ascending: true, nullsFirst: false }),
    requireWeighFlag
      ? supabase.rpc('gdo_weight_estimates', { p_gdo_ids: [id] })
      : Promise.resolve({ data: null as unknown }),
  ])
  let westData = westRes0.data
  if (!requireWeighFlag && (wtRes.data ?? []).length > 0)
    westData = (await supabase.rpc('gdo_weight_estimates', { p_gdo_ids: [id] })).data
  const weightEstimate = (Array.isArray(westData) ? westData : [])[0] ?? null

  // LOẠI XE DỰ KIẾN từ lệnh vận chuyển (KHVC, order_code = Số xe): chuyến CHƯA gắn biển số thì đây
  // là nguồn DUY NHẤT để sơ đồ xếp xe biết vẽ theo XE PALLET hay xe thường — trước 26/08 màn 3D chỉ
  // suy từ biển số nên mọi chuyến đang lên kế hoạch đều mặc định "Xe thường" (đo đơn thật 15/08:
  // 55/95 chuyến chưa gắn xe có kế hoạch khai XE PALLET, 14 chuyến khai CONTAINER — vẽ sai hẳn kiểu).
  // CHỈ hỏi khi chưa có biển: chuyến đang xuất luôn có biển ⇒ không thêm round-trip vào đường nóng.
  const plateNow = (gdo as unknown as { license_plate?: string | null }).license_plate
  let plannedVehicleType: string | null = null
  if (!plateNow) {
    const { data: tord } = await supabase.from('TmsOrder')
      .select('vehicle_type')
      .eq('order_code', (gdo as unknown as { group_code: string }).group_code)
      .limit(1).maybeSingle()
    plannedVehicleType = (tord as { vehicle_type?: string | null } | null)?.vehicle_type ?? null
  }

  const dos = await fetchAllRowsParallel(() => supabase.from('OutboundDelivery')
    .select('*').eq('gdo_id', id).order('delivery_code').order('id'))

  const doIds = (dos ?? []).map((d: any) => d.id)

  // Detail chuyến phải ĐỦ item/scan (chuyến >1000 scan: cap-1000 làm "đã quét" hiển thị thiếu)
  const items = doIds.length
    ? await fetchAllByIdChunks(doIds, chunk => supabase.from('OutboundItem')
        .select('*, material:Material(id,material_code,short_name,custom_short_name,category,cartons_per_pallet,warehouse_pallet_overrides,weight_kg,shelf_life_days,no_qr_tracking,carton_length_mm,carton_width_mm,carton_height_mm,max_stack_layers,stack_on_top,is_pallet_carrier,pallet_color,base_unit,entry_unit,units_per_carton)')
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
    planned_vehicle_type: plannedVehicleType,
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
    // Trần theo BYTE, không theo dòng (đo 10/08 với 3 tháng dữ liệu: chuyến enrich ≈ 3.300 B/dòng
    // — trần dòng cũ 10.000 tương đương ~33MB, và 1.450 chuyến/29 ngày đã 4,59MB vượt trần Vercel
    // 4,5MB mà hàng rào KHÔNG chặn). Vượt → BÁO RÕ để user thu hẹp, KHÔNG cắt âm thầm.
    const cap = rowCapForBytes(3300)
    const { rows: data, truncated } = await fetchUpTo(buildQuery, cap)
    if (truncated) return fail(res, 400, 'RANGE_TOO_WIDE', LIST_TOO_LARGE_MSG(cap))
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

// Thông tin pallet để tính nhặt lẻ (định mức chung + ngoại lệ theo kho + loại kho để tra policy).
export type MatPalletUnits = MatUnitsQ & {
  cartons_per_pallet?: number | null
  warehouse_pallet_overrides?: { warehouse_id: string; cartons_per_pallet: number }[] | null
  category?: string | null
}

// ĐỢT 3 — NHẶT LẺ THEO PALLET (user chốt 20/07) + SETTING 2 TẦNG (user chốt 24/08).
// policy.mode: REMAINDER = phần base KHÔNG đủ xếp 1 pallet nguyên (hành vi gốc — thùng lẻ < 1 pallet
// phải nhặt từng thùng); ALL = TOÀN BỘ SL vào nhặt lẻ (POSM soạn full trước); OFF = không nhặt lẻ.
// Trần policy.max_cartons (THÙNG) chỉ áp REMAINDER: phần lẻ vượt trần → 0 (bốc nguyên pallet + khai
// chỗ đặt phần dư nhanh hơn nhặt tay). Tính trên qty base ĐÃ GỘP (nhiều dòng cùng mã/NPP đã cộng lại)
// — KHÔNG tính per-dòng rồi cộng (sẽ thổi loose). REMAINDER với mã không entry / thiếu
// cartons_per_pallet → 0 (không ép nhặt lẻ). Policy lấy từ looseConfigOf(...).of(kho, loại của MÃ).
export function loosePalletRemainder(
  orderedBase: number, mu: MatPalletUnits | null | undefined,
  warehouseId: string | null | undefined, policy: LoosePolicy,
): number {
  if (policy.mode === 'OFF') return 0
  if (policy.mode === 'ALL') return Math.max(0, Number(orderedBase) || 0)
  if (!hasEntry(mu)) return 0
  const cpp = effCartonsPerPallet(mu, warehouseId ?? null)
  const palletBase = cpp > 0 ? cpp * Number(mu!.units_per_carton) : 0
  if (palletBase <= 0) return 0
  const rem = Number(orderedBase) % palletBase
  // Trần thùng: so trên PHẦN LẺ quy thùng của chính mã đó
  if (policy.max_cartons != null && rem > policy.max_cartons * Number(mu!.units_per_carton)) return 0
  return rem
}

// Resolver policy nhặt lẻ 2 tầng — mirror rotationConfigOf (2 câu cho CẢ danh sách kho; null = mọi
// kho, cho upload nhiều kho). Trả HÀM tra theo (kho, loại kho của MÃ HÀNG) — caller tự ghép 2 map
// là đường đẻ bản luật chép tay thứ hai.
export interface LooseResolver {
  of: (warehouseId: string | null | undefined, category: string | null | undefined) => LoosePolicy
}
export async function looseConfigOf(warehouseIds: string[] | null): Promise<LooseResolver> {
  const FALLBACK: LoosePolicy = { mode: 'REMAINDER', max_cartons: null }
  const ids = warehouseIds ? [...new Set(warehouseIds.filter(Boolean))] : null
  if (ids && !ids.length) return { of: () => FALLBACK }
  const whQ = () => supabase.from('Warehouse').select('id, loose_mode, loose_max_cartons')
  const cfgQ = () => supabase.from('warehouse_type_configs').select('warehouse_id, type_code, loose_mode, loose_max_cartons')
  const [whs, cfgs] = await Promise.all(ids
    ? [fetchAllByIdChunks(ids, chunk => whQ().in('id', chunk).order('id')),
       fetchAllByIdChunks(ids, chunk => cfgQ().in('warehouse_id', chunk).order('warehouse_id'))]
    : [fetchAllRowsParallel(() => whQ()), fetchAllRowsParallel(() => cfgQ())])
  const whById = new Map<string, Record<string, unknown>>()
  const typesByWh = new Map<string, WhTypeConfigRow[]>()
  for (const w of ((whs ?? []) as ({ id: string } & Record<string, unknown>)[])) whById.set(w.id, w)
  for (const c of ((cfgs ?? []) as ({ warehouse_id: string } & WhTypeConfigRow)[])) {
    const arr = typesByWh.get(c.warehouse_id) ?? []
    arr.push(c)
    typesByWh.set(c.warehouse_id, arr)
  }
  return {
    of: (warehouseId, category) => {
      const wh = warehouseId ? whById.get(warehouseId) : null
      if (!wh) return FALLBACK
      return resolveLoosePolicy(wh, typesByWh.get(warehouseId ?? '') ?? [], category ?? null)
    },
  }
}

// Form Tạo/Sửa bên Xuất KHÔNG sửa nhặt lẻ tay (user chốt 22/07): loose LUÔN TỰ TÍNH từ TỔNG
// theo pallet-remainder (cùng luật với upload KHVC) — BE bỏ qua loose_picking client gửi.
async function loosePalletMats(codes: string[]): Promise<Map<string, MatPalletUnits>> {
  if (!codes.length) return new Map()
  const { data } = await supabase.from('Material')
    .select('material_code, base_unit, entry_unit, units_per_carton, cartons_per_pallet, warehouse_pallet_overrides, category')
    .in('material_code', codes)   // form tay ≤ vài chục mã/đơn — không cần chunk
  return new Map(((data ?? []) as (MatPalletUnits & { material_code: string })[]).map(m => [String(m.material_code), m]))
}

// SỐ DO TRÙNG khi tạo TAY (user chốt 31/08 "Cảnh báo + xác nhận"): bấm đúp / 2 người cùng nhập
// từng sinh 2 chuyến y hệt (đo dsub 31/08: 201/201) → nguy cơ soạn hàng + trừ tồn ĐÔI cho một đơn.
// Đã có chuyến CHƯA HỦY cùng (Số DO, ngày xuất, kho) → 409 DUPLICATE_DO; tách xe CHỦ ĐÍCH
// ("1 DO đi 2 xe") thì client gửi allow_duplicate_do=true để vượt có chủ ý. Chỉ áp cửa tạo TAY
// (createGDO + quick-export) — upload có luật gộp theo key riêng, KHÔNG đi qua đây.
async function duplicateDoError(
  deliveryCode: string | undefined, deliveryDate: string | undefined,
  warehouseId: string | null | undefined, excludeGdoId?: string,
): Promise<string | null> {
  const dc = String(deliveryCode ?? '').trim()
  if (!dc || !deliveryDate) return null
  const { data } = await supabase.from('OutboundDelivery')
    .select('gdo_id, gdo:GroupDeliveryOrder!gdo_id(id, group_code, status, delivery_date, warehouse_id)')
    .eq('delivery_code', dc).limit(50)
  type DupRow = { gdo_id: string; gdo: { id: string; group_code: string | null; status: string; delivery_date: string | null; warehouse_id: string | null } | null }
  for (const row of ((data ?? []) as unknown as DupRow[])) {
    const g = row.gdo
    if (!g || g.status === 'CANCELLED') continue
    if (excludeGdoId && g.id === excludeGdoId) continue
    if (String(g.delivery_date ?? '') !== String(deliveryDate)) continue
    if (String(g.warehouse_id ?? '') !== String(warehouseId ?? '')) continue
    return `Số DO "${dc}" đã có chuyến ${g.group_code ?? ''} cùng ngày ở kho này. Nếu đúng là tách 1 DO lên 2 xe, tick ô xác nhận rồi lưu lại.`
  }
  return null
}

export async function createGDO(req: Request, res: Response) {
  try {
    if (!requireBaseQty(req, res)) return   // BASE UNIT: chặn payload bundle cũ (thùng thập phân)
    const { delivery_date, warehouse_id, dvvt, customer_name, delivery_code, export_type, warehouse_type, shipto_party, items, allow_duplicate_do } = req.body as {
      delivery_date: string; warehouse_id?: string; dvvt?: string
      customer_name?: string; delivery_code?: string; export_type?: string; warehouse_type?: string; shipto_party?: string; allow_duplicate_do?: boolean
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

    // Số DO trùng (chưa hủy, cùng ngày+kho) → 409 chờ xác nhận; cờ allow_duplicate_do = tách xe chủ đích
    if (!allow_duplicate_do) {
      const dupErr = await duplicateDoError(delivery_code, delivery_date, warehouse_id ?? null)
      if (dupErr) return fail(res, 409, 'DUPLICATE_DO', dupErr)
    }

    const gdoId = randomUUID()
    const actor = req.user?.name || null
    const ins = await insertGdoNextCode(prefix, {
      id: gdoId, planned_date: delivery_date, delivery_date,
      warehouse_id: warehouse_id ?? null, dvvt: dvvtName,
      warehouse_type: warehouse_type ?? null, shipto_party: shipto_party ?? null, status: 'PENDING',
      origin: 'MANUAL',   // tạo tay — không có nguồn raw, sửa đơn như cũ
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

    // ĐÓNG CỬA SỔ ĐUA của check trên (2 lệnh Lưu bay lên CÙNG mili-giây đều qua pre-check —
    // đo dsub 31/08): sau khi ghi DO, soi lại — vẫn còn chuyến khác trùng thì RÚT bản của mình
    // (DO + GDO, items chưa ghi) và trả 409. Hai bên cùng rút → cả hai 409, user lưu lại là xong;
    // không bao giờ còn chuyến đôi âm thầm.
    if (!allow_duplicate_do) {
      const raceErr = await duplicateDoError(delivery_code, delivery_date, warehouse_id ?? null, gdoId)
      if (raceErr) {
        await supabase.from('OutboundDelivery').delete().eq('id', doId)
        await supabase.from('GroupDeliveryOrder').delete().eq('id', gdoId)
        return fail(res, 409, 'DUPLICATE_DO', raceErr)
      }
    }

    const looseMats = await loosePalletMats(allCodes)
    const loosePol = await looseConfigOf(warehouse_id ? [warehouse_id] : null)
    const itemsToInsert = items.map(item => {
      const matInfo = matMap.get(item.material_code)
      const material_type = matInfo?.category ?? null
      return {
        id: randomUUID(), do_id: doId,
        material_id: matInfo?.id ?? null,
        material_code_raw: item.material_code,
        cartons_ordered: item.cartons_ordered,
        boxes_display: 0, weight: null, pallets_estimated: 0,
        loose_picking: loosePalletRemainder(item.cartons_ordered, looseMats.get(item.material_code), warehouse_id ?? null,
          loosePol.of(warehouse_id ?? null, looseMats.get(item.material_code)?.category ?? matInfo?.category ?? null)),
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
    const { delivery_date, warehouse_id, dvvt, customer_name, delivery_code, export_type, warehouse_type, shipto_party, license_plate, gate_registration_id, items, allow_duplicate_do } = req.body as {
      delivery_date: string; warehouse_id?: string; dvvt?: string
      customer_name?: string; delivery_code?: string; export_type?: string; warehouse_type?: string; shipto_party?: string; license_plate?: string
      gate_registration_id?: string | null; allow_duplicate_do?: boolean
      items?: Array<{ material_code: string; cartons_ordered: number; loose_picking?: number; header_text?: string; batch_required?: string; date_required?: number; cs_responsible?: string }>
    }
    if (!delivery_date)             return fail(res, 'delivery_date là bắt buộc', 400)
    const qxFutErr = futureDateError(delivery_date)   // Xuất luôn = xuất NGAY hôm nay — không nhận ngày tương lai
    if (qxFutErr)                   return fail(res, 422, 'FUTURE_DATE', qxFutErr)
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
    const qxInternal = !license_plate?.trim() && (await isInternalPair(warehouse_id, shipto_party))
    if (!license_plate?.trim() && !qxInternal)
      return fail(res, 'Biển số xe là bắt buộc', 400)

    // ĐVVT: khớp danh mục → tên chính tắc; không khớp → giữ tên gõ tay (ĐVVT vãng lai)
    const dvvtRes = (await buildDvvtResolver())(dvvt)
    const dvvtName = dvvtRes.ok ? dvvtRes.name : (String(dvvt ?? '').trim() || null)

    const { data: wh } = await supabase.from('Warehouse').select('code, inventory_mode, require_weigh_on_start, require_gate_on_start').eq('id', warehouse_id).maybeSingle()
    if (!wh) return fail(res, 'Không tìm thấy kho xuất', 404)
    const whMode = (wh as { inventory_mode?: string | null }).inventory_mode ?? null

    // "Tạo & Xuất luôn" CHỈ áp cho kho QTY (tồn theo số lượng) hoặc NONE (không theo dõi tồn).
    // Kho QR phải đi luồng quét tem — không dùng được xuất luôn.
    if (!isQtyLike(whMode) && whMode !== 'NONE') {
      return fail(res, 422, 'NOT_QTY_NONE', 'Chỉ kho quản lý theo số lượng (QTY) hoặc không theo dõi tồn (NONE) mới dùng được "Tạo & Xuất luôn". Kho QR hãy dùng luồng quét tem.')
    }

    // 2 RULE như startGDO (user chốt 01/08 vòng 2: "Xuất luôn cũng chấp hành như Bắt đầu").
    // GDO chưa tồn tại nên KHÔNG có đường duyệt trước — kho bật rule mà xe không đáp ứng được
    // thì tạo đơn thường (Lưu) → nhờ duyệt trên chuyến → Xuất luôn (không còn lựa chọn lúc bấm).
    if (!qxInternal && (wh as { require_gate_on_start?: boolean }).require_gate_on_start === true) {
      const qxGateErr = await gateRegError(gate_registration_id, warehouse_id, license_plate)
      if (qxGateErr) return fail(res, 422, 'GATE_REQUIRED',
        `${qxGateErr} Với "Tạo & Xuất luôn": Lưu đơn thường → gắn Đăng ký cổng khi Bắt đầu hoặc nhờ duyệt "Bỏ qua cổng" trên chuyến → bấm Xuất luôn.`)
    }
    let qxWeighTicketId: string | null = null
    if (!qxInternal && (wh as { require_weigh_on_start?: boolean }).require_weigh_on_start === true) {
      const qxGate = await checkWeighGate(warehouse_id, license_plate, undefined, gate_registration_id)
      if (!qxGate.ok) return fail(res, 422, 'WEIGH_REQUIRED', `${qxGate.message} Với "Tạo & Xuất luôn": Lưu đơn thường rồi nhờ duyệt trên chuyến, sau đó bấm Xuất luôn.`)
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

    // Số DO trùng (chưa hủy, cùng ngày+kho) → 409 chờ xác nhận — Xuất luôn trừ tồn NGAY nên chuyến
    // đôi ở cửa này nặng hơn cả cửa Lưu thường (user chốt 31/08 "Cảnh báo + xác nhận")
    if (!allow_duplicate_do) {
      const dupErr = await duplicateDoError(delivery_code, delivery_date, warehouse_id ?? null)
      if (dupErr) return fail(res, 409, 'DUPLICATE_DO', dupErr)
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
      origin: 'MANUAL',   // Tạo & Xuất luôn — không có nguồn raw
      status: 'IN_PROGRESS',
      assigned_at: t, assigned_by: actor,               // tự gán người tạo phụ trách
      started_at: t, license_plate: normalizePlate(license_plate),
      gate_registration_id: gate_registration_id ?? null,   // vết "đã qua cổng" nếu client gửi
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
    const qxLoosePol = await looseConfigOf([warehouse_id])
    const itemRows = items.map(item => ({
      id: randomUUID(), do_id: doId,
      material_id: matMap.get(item.material_code)!.id,
      material_code_raw: item.material_code,
      cartons_ordered: item.cartons_ordered,
      boxes_display: 0, weight: null, pallets_estimated: 0,
      loose_picking: loosePalletRemainder(item.cartons_ordered, qxLooseMats.get(item.material_code), warehouse_id,
        qxLoosePol.of(warehouse_id, qxLooseMats.get(item.material_code)?.category ?? matMap.get(item.material_code)?.category ?? null)),
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
      if (isSpecial) {
        // MỘT RPC nguyên tử pool + item + vết quét (bug #6 10/08 — chiều xuôi kill giữa chừng
        // là MẤT tồn âm thầm: đã trừ mà không có vết để hoàn)
        const r = await applyPoolAtomic({
          itemId: row.id, materialCode: row.material_code_raw, warehouseId: warehouse_id,
          mode: whMode, newQty: ctn, itemStatus: 'COMPLETED',
        })
        if (r.outcome !== 'OK') {
          failed.push({
            material_code: row.material_code_raw,
            message: r.outcome === 'INSUFFICIENT' ? `còn ${qtyLabel(r.available ?? 0, matMap.get(row.material_code_raw))}` : 'tồn đang bận (nhiều người thao tác)',
          })
          continue
        }
      } else {
        await supabase.from('OutboundItem').update({ status: 'COMPLETED', cartons_scanned: ctn, updated_at: now() }).eq('id', row.id)
      }
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
    // gate_registration_id: kho bật rule cổng thì dialog "Xuất luôn" cho chọn chuyến xe ngay tại đó
    // (không thì chuyến PENDING không có đường nào gắn cổng — Sửa thông tin xe đòi đã Bắt đầu).
    const { license_plate, gate_registration_id } = req.body as { license_plate?: string; gate_registration_id?: string | null }
    if (!(await guardGdoScope(req, res, gdoId))) return

    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select(`id, status, warehouse_id, shipto_party, assigned_at, assigned_by, started_at, delivery_date, weigh_waived_at, gate_waived_at, gate_registration_id, ${INERT_COLS}, warehouse:Warehouse(inventory_mode,require_weigh_on_start,require_gate_on_start)`)
      .eq('id', gdoId).single()
    if (!gdo)                        return fail(res, 'Không tìm thấy chuyến', 404)
    if (gdo.status === 'COMPLETED')  return fail(res, 'Chuyến đã hoàn thành', 400)
    if (gdo.status === 'CANCELLED')  return fail(res, 'Chuyến đã hủy', 400)
    { const inertErr = inertError(gdo as GdoInertState)
      if (inertErr) return fail(res, 422, 'TRIP_INERT', inertErr) }
    const qxeFutErr = futureDateError((gdo as { delivery_date?: string | null }).delivery_date)
    if (qxeFutErr)                   return fail(res, 422, 'FUTURE_DATE', qxeFutErr)
    // PAUSED vẫn cho: user tạm dừng để sửa kế hoạch → "Xuất luôn" = ngầm Tiếp tục + chốt chuyến.
    const whMode = (gdo as { warehouse?: { inventory_mode?: string | null } | null })?.warehouse?.inventory_mode ?? null
    if (!isQtyLike(whMode) && whMode !== 'NONE')
      return fail(res, 422, 'NOT_QTY_NONE', 'Chỉ kho quản lý theo số lượng (QTY) hoặc không theo dõi tồn (NONE) mới dùng "Xuất luôn". Kho QR hãy dùng luồng quét tem.')
    // Biển số bắt buộc, TRỪ chuyển nội bộ parent↔kho phụ và chuyến đã duyệt bỏ qua CỔNG
    // (giao lẻ xe máy/nhân viên nhận không có xe đăng ký)
    const qxeGateWaived  = !!(gdo as { gate_waived_at?: string | null }).gate_waived_at
    const qxeWeighWaived = !!(gdo as { weigh_waived_at?: string | null }).weigh_waived_at
    const qxeInternal = !license_plate?.trim() &&
      (await isInternalPair(gdo.warehouse_id as string, (gdo as { shipto_party?: string | null }).shipto_party))
    if (!license_plate?.trim() && !qxeGateWaived && !qxeInternal)
      return fail(res, 'Biển số xe là bắt buộc', 400)

    // RULE 1 CỔNG (user chốt 01/08 vòng 2: "Xuất luôn" cũng chấp hành như nút Bắt đầu — không còn
    // cửa lách). Chỉ khi lượt này chính là lượt Bắt đầu; miễn = gate_waived_at / chuyển nội bộ.
    const qxeGateId = gate_registration_id !== undefined
      ? gate_registration_id                                             // client chọn ngay ở dialog Xuất luôn
      : (gdo as { gate_registration_id?: string | null }).gate_registration_id
    if (!gdo.started_at && !qxeGateWaived && !qxeInternal &&
        (gdo as { warehouse?: { require_gate_on_start?: boolean } | null }).warehouse?.require_gate_on_start === true) {
      const qxeGateErr = await gateRegError(qxeGateId, gdo.warehouse_id as string, license_plate)
      if (qxeGateErr) return fail(res, 422, 'GATE_REQUIRED',
        `${qxeGateErr} Với "Xuất luôn": chọn đúng chuyến xe đã vào cổng ở ô "Chuyến xe / Biển số", hoặc nhờ người có quyền duyệt "Bỏ qua cổng" trên chuyến rồi bấm lại.`)
    }

    // GATE CÂN XE (rule 2) — chỉ khi chuyến CHƯA bắt đầu ("Xuất luôn" lần này chính là lượt Bắt đầu).
    // Miễn = weigh_waived_at (duyệt riêng rule cân — duyệt cổng KHÔNG thoát rule cân).
    let qxeWeighTicketId: string | null = null
    if (!gdo.started_at && !qxeWeighWaived && !qxeInternal &&
        (gdo as { warehouse?: { require_weigh_on_start?: boolean } | null }).warehouse?.require_weigh_on_start === true) {
      if (!license_plate?.trim())
        return fail(res, 422, 'WEIGH_REQUIRED', 'Chuyến không có biển số nhưng kho yêu cầu CÂN XE — cần người có quyền duyệt "Bỏ qua cân" trên chuyến.')
      const qxeGate = await checkWeighGate(gdo.warehouse_id as string, license_plate, gdoId, qxeGateId)
      if (!qxeGate.ok) return fail(res, 422, 'WEIGH_REQUIRED', qxeGate.message)
      qxeWeighTicketId = qxeGate.ticketId
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
      if (hasPool) {
        // MỘT RPC nguyên tử: khóa item TRƯỚC khi đụng pool nên claim thua đua = CLAIM_LOST và
        // KHÔNG trừ tồn — thay hẳn cú CAS-claim + "hoàn bù" cũ (hoàn bù bị kill giữa chừng là
        // nguồn hoàn đôi, bug #6 10/08).
        const r = await applyPoolAtomic({
          itemId: item.id, materialCode: matCode!, warehouseId: gdo.warehouse_id as string,
          mode: whMode, newQty: ctn, itemStatus: 'COMPLETED', claimOnlyPending: true,
        })
        if (r.outcome === 'INSUFFICIENT') { failed.push({ material_code: matCode!, message: `còn ${qtyLabel(r.available ?? 0, item.material ?? null)}` }); continue }
        if (r.outcome === 'CLAIM_LOST' || r.outcome === 'NOT_FOUND') continue   // thua đua — request kia đã xử, không đụng tồn
        successCount++
      } else {
        const t2 = now()
        // CAS claim cho mã thường (không pool): 2 người cùng bấm → chỉ 1 request xử được item
        const { data: claimed } = await supabase.from('OutboundItem')
          .update({ status: 'COMPLETED', cartons_scanned: ctn, updated_at: t2 })
          .eq('id', item.id).neq('status', 'COMPLETED').select('id')
        if (!claimed?.length) continue
        successCount++
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
      ...(gate_registration_id !== undefined && !gdo.started_at ? { gate_registration_id: gate_registration_id ?? null } : {}),   // giữ vết đã qua cổng
      ...(gdo.assigned_at ? {} : { assigned_at: t, assigned_by: actor }),
      ...(gdo.started_at  ? {} : { started_at: t }),
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
  const orderIds = ((orders ?? []) as { id: string }[]).map(o => o.id)
  for (const id of orderIds) await supabase.from('inbound_plan_lines').delete().eq('tms_order_id', id)
  // Dòng xe của lệnh có thể ĐANG GIỮ khung giờ — xoá mà không đếm lại thì khung kẹt "Đầy" vĩnh viễn
  // (xem chú thích trong deleteVehicleSlotsAndRecount). Phải xoá TRƯỚC khi xoá lệnh: FK là CASCADE,
  // xoá lệnh trước thì dòng xe biến mất và không còn gì để lần ra khung bị ảnh hưởng.
  await deleteVehicleSlotsAndRecount(orderIds)
  for (const id of orderIds) await supabase.from('TmsOrder').delete().eq('id', id)
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
    // Chỉ đếm dòng còn SỐNG (fix 02/08): dòng toàn OBSOLETE = kế hoạch đã bỏ, derive cũng bỏ qua —
    // đếm cả chúng thì chuyến kẹt VĨNH VIỄN không đường xóa (kế hoạch không hiển thị gì để mà xóa tiếp).
    const { count: khvcCount } = await supabase.from('khvc_lines')
      .select('id', { count: 'exact', head: true }).eq('group_code', gdo.group_code)
      .neq('sync_status', 'OBSOLETE')
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
    // Gỡ phiếu cân còn trỏ vào chuyến (soft link không FK) — không thì phiếu kẹt "đã gắn chuyến"
    // vĩnh viễn với chuyến không còn tồn tại (mồ côi, không auto-match lại được)
    await supabase.from('WeighTicket')
      .update({ gdo_id: null, matched_at: null, matched_by: null, updated_at: now() })
      .eq('gdo_id', req.params.id)
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
      .select(`status, shipto_party, warehouse_id, origin, delivery_date, dvvt, warehouse_type, started_at, ${INERT_COLS}`).eq('id', req.params.id).single()
    if (!gdo) return fail(res, 'Không tìm thấy chuyến xe', 404)
    if (!['PENDING', 'PAUSED'].includes(gdo.status)) return fail(res, 'Chỉ sửa được đơn ở trạng thái PENDING hoặc PAUSED', 400)
    // Chuyến bất động: không sửa đơn (thêm dòng hàng tay vào chuyến chưa có kế hoạch = lệch đối soát)
    { const inertErr = inertError(gdo as GdoInertState)
      if (inertErr) return fail(res, 422, 'TRIP_INERT', inertErr) }
    // Chuyến PAUSED có thể đã Bắt đầu + đã ghi nhận số → cấm dời ngày sang tương lai (xem futureShiftError)
    {
      const pushErr = futureShiftError(gdo as GdoDateShift, delivery_date)
      if (pushErr) return fail(res, 422, 'FUTURE_DATE', pushErr)
    }

    // ── CHUYẾN SINH TỪ SAP (origin='SAP', user chốt 02/08): Xuất là KẾT QUẢ DẪN XUẤT của
    // VL06O + Kế hoạch xuất — phần KẾ HOẠCH khóa trên đơn, sửa Ở NGUỒN rồi hệ thống tự dội xuống:
    //   SL/dòng hàng → tab DO SAP (VL06O) · ngày/kho/NPP/ĐVVT/loại xe → tab Kế hoạch xuất.
    // Chỉ so GIÁ TRỊ ĐỔI (FE gửi kèm giá trị hiện tại là bình thường, không chặn oan).
    // Chuyến EXCEL/MANUAL/LEGACY (kho không làm SAP) giữ nguyên sửa tự do.
    const gdoCur = gdo as { status: string; shipto_party?: string | null; warehouse_id?: string | null; origin?: string | null; delivery_date?: string | null; dvvt?: string | null; warehouse_type?: string | null }
    if (gdoCur.origin === 'SAP') {
      const KHVC_HINT = 'sửa ở tab "Kế hoạch xuất" (Dữ liệu bên ngoài) — chuyến tự cập nhật theo'
      const sapTripLock = (label: string) =>
        fail(res, 422, 'SAP_PLAN_LOCKED', `Chuyến sinh từ SAP — không đổi ${label} tại đây, ${KHVC_HINT}.`)
      const norm = (v: unknown) => String(v ?? '').trim()
      if (delivery_date !== undefined && norm(delivery_date) !== norm(gdoCur.delivery_date)) return sapTripLock('Ngày xuất')
      if (warehouse_id !== undefined && norm(warehouse_id) !== norm(gdoCur.warehouse_id)) return sapTripLock('Kho')
      if ('shipto_party' in req.body && norm(shipto_party) !== norm(gdoCur.shipto_party)) return sapTripLock('Ship-to')
      if ('warehouse_type' in req.body && norm(warehouse_type) !== norm(gdoCur.warehouse_type)) return sapTripLock('Loại kho')
      if (dvvt !== undefined && norm(dvvt) !== norm(gdoCur.dvvt)) return sapTripLock('Đơn vị vận tải')
      // Dòng hàng THÊM TAY (không db_id) = xuất ngoài SAP → lệch đối soát. Thêm ở nguồn:
      // DO mới → up VL06O + Kế hoạch xuất; item của DO đã có → tự hiện khi up lại VL06O.
      if (items?.some(i => !i.db_id))
        return fail(res, 422, 'SAP_PLAN_LOCKED', 'Chuyến sinh từ SAP — không thêm dòng hàng tay tại đây (xuất ngoài SAP sẽ lệch đối soát). Thêm DO/dòng ở tab DO SAP rồi cập nhật Kế hoạch xuất.')
    }

    // Luật quỹ đạo kho phụ — kiểm theo shipto HIỆU LỰC sau update (body có gửi thì lấy body, không thì giữ cũ)
    const effShipto = 'shipto_party' in req.body ? (shipto_party ?? null) : ((gdo as { shipto_party?: string | null }).shipto_party ?? null)
    const orbitErr = await internalOrbitError(warehouse_id ?? null, effShipto)
    if (orbitErr) return fail(res, orbitErr, 400)

    // ĐVVT: khớp danh mục → tên chính tắc; không khớp → giữ tên gõ tay (ĐVVT vãng lai)
    const dvvtRes = (await buildDvvtResolver())(dvvt)
    const dvvtName = dvvtRes.ok ? dvvtRes.name : (String(dvvt ?? '').trim() || null)

    const t = now()

    // ══ VALIDATE HẾT trước — GHI sau (bug 31/08, DAYFLOW): bản cũ update header GDO/DO TRƯỚC rồi
    // mới validate items, nên PUT bị TỪ CHỐI (400/422) vẫn đã ghi một nửa — đo thật: hạ SL dưới mức
    // đã xuất trả 400 nhưng chuyến ĐANG XUẤT đã mất warehouse_id + dvvt (thành chuyến "ma" không
    // thuộc kho nào trong khi tồn ĐÃ TRỪ). Mọi return fail từ đây tới mốc GHI phải đứng TRƯỚC mọi write.
    const { data: dos } = await supabase.from('OutboundDelivery')
      .select('id, distributor_name, delivery_code').eq('gdo_id', req.params.id)
    const doList = dos ?? []
    const isMultiDO = doList.length > 1

    // Chuyến SAP: NPP/Số DO cũng là dữ liệu nguồn — đổi thì 422 chỉ đường, không ghi đè âm thầm
    if (!isMultiDO && doList.length === 1 && gdoCur.origin === 'SAP') {
      const d0 = doList[0] as { distributor_name?: string | null; delivery_code?: string | null }
      const norm = (v: unknown) => String(v ?? '').trim()
      if (customer_name !== undefined && norm(customer_name) !== norm(d0.distributor_name))
        return fail(res, 422, 'SAP_PLAN_LOCKED', 'Chuyến sinh từ SAP — không đổi tên NPP tại đây, sửa ở tab "Kế hoạch xuất" (Dữ liệu bên ngoài).')
      if ('delivery_code' in req.body && delivery_code !== undefined && norm(delivery_code) !== norm(d0.delivery_code))
        return fail(res, 422, 'SAP_PLAN_LOCKED', 'Chuyến sinh từ SAP — không đổi Số DO tại đây, sửa ở tab DO SAP (Dữ liệu bên ngoài).')
    }

    // Dòng item hiện có — nạp TRƯỚC để validate; phần GHI phía dưới dùng lại, không nạp lần 2.
    type ExItemRow = { id: string; do_id: string; material_code_raw: string | null; cartons_ordered: number; cartons_scanned: number; od_refs?: unknown[] | null; export_type?: string | null; material?: MatUnitsQ | null }
    let existingItems: ExItemRow[] = []
    const sapLinked = (ex: { od_refs?: unknown[] | null } | undefined | null) => ((ex?.od_refs as unknown[] | null)?.length ?? 0) > 0
    const sapQtyLockError = (ex: { material_code_raw?: string | null }) =>
      `Mã "${ex.material_code_raw}" thuộc đơn upload từ SAP — không sửa số lượng tại đây. Sửa Số lượng ở tab DO SAP (Dữ liệu bên ngoài) để đơn và dữ liệu SAP cùng khớp.`
    const sapDeleteLockError = (ex: { material_code_raw?: string | null }) =>
      `Mã "${ex.material_code_raw}" thuộc đơn upload từ SAP — không xóa dòng tại đây. Xóa dòng ở tab DO SAP (Dữ liệu bên ngoài) để đơn và dữ liệu SAP cùng khớp.`
    const sapMaterialLockError = (ex: { material_code_raw?: string | null }) =>
      `Mã "${ex.material_code_raw}" thuộc đơn upload từ SAP — không đổi mã hàng tại đây. Sửa ở tab DO SAP (Dữ liệu bên ngoài) để đơn và dữ liệu SAP cùng khớp.`

    if (items) {
      // BASE UNIT: số item = SỐ BASE — mã có entry phải nguyên (validate trước khi đụng items)
      const codes = [...new Set(items.map(i => i.material_code).filter(Boolean))]
      const { data: umats } = codes.length
        ? await supabase.from('Material').select('material_code, base_unit, entry_unit, units_per_carton').in('material_code', codes)
        : { data: [] }
      const uMap = new Map<string, MatUnitsQ>(((umats ?? []) as any[]).map(m => [m.material_code, m]))
      const bErr = invalidItemQtyBase(items as any[], uMap)
      if (bErr) return fail(res, bErr, 422)

      const doIds = doList.map((d: any) => d.id as string)
      const { data: exData } = doIds.length
        ? await supabase.from('OutboundItem')
            .select('id, do_id, material_code_raw, cartons_ordered, cartons_scanned, od_refs, export_type, material:Material!material_id(base_unit, entry_unit, units_per_carton)').in('do_id', doIds)
        : { data: [] }
      existingItems = (exData ?? []) as unknown as ExItemRow[]

      // Chuyến SAP: Loại xe (export_type) cũng từ Kế hoạch xuất — update ghi đè per-item nên phải chặn ở đây.
      // So khớp BỎ DẤU + hoa/thường: FE canonical hóa ("xe container"→"Xe Container") nên so thô sẽ chặn oan.
      if (gdoCur.origin === 'SAP' && export_type !== undefined) {
        const laxEt = (s: unknown) => String(s ?? '').normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().trim()
        const curEt = existingItems.find(i => i.export_type)?.export_type ?? ''
        if (laxEt(export_type) !== laxEt(curEt))
          return fail(res, 422, 'SAP_PLAN_LOCKED', 'Chuyến sinh từ SAP — không đổi Loại xe tại đây, sửa ở tab "Kế hoạch xuất" (Dữ liệu bên ngoài).')
      }

      if (isMultiDO) {
        const existingById = new Map<string, ExItemRow>(existingItems.map(i => [i.id, i]))
        const requestedDbIds = new Set(items.filter(i => i.db_id).map(i => i.db_id as string))
        // Không xóa item đã xuất + không xóa dòng đơn gốc SAP (xóa = sửa SL về 0)
        for (const [id, ex] of existingById) {
          if (!requestedDbIds.has(id) && Number(ex.cartons_scanned) > 0) {
            return fail(res, `Không thể xóa mã hàng "${ex.material_code_raw}" đã xuất ${qtyLabel(Number(ex.cartons_scanned), ex.material ?? null)}`, 400)
          }
          if (!requestedDbIds.has(id) && sapLinked(ex)) {
            return fail(res, sapDeleteLockError(ex), 422)
          }
        }
        // Số thùng < đã xuất + KHÓA sửa SL / đổi mã đơn gốc SAP
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
        // Dòng thêm mới phải chỉ định NPP hợp lệ — validate TRƯỚC (bản cũ kiểm giữa lúc ghi:
        // fail ở đây là các update item khác ĐÃ chạy xong)
        const doByNpp = new Set(doList.map((d: any) => String(d.distributor_name ?? '').trim()))
        for (const item of items.filter(i => !i.db_id && i.material_code)) {
          if (!doByNpp.has(String(item.npp ?? '').trim()))
            return fail(res, `Dòng "${item.material_code}": chưa chọn NPP hợp lệ cho dòng thêm mới`, 400)
        }
      } else if (doList.length === 1) {
        const existingByCode = new Map<string, ExItemRow>(existingItems.map(i => [String(i.material_code_raw), i]))
        const newCodes = new Set(items.map(i => i.material_code))
        // Không xóa item có scan + không xóa dòng đơn gốc SAP (xóa = sửa SL về 0)
        for (const [code, ex] of existingByCode) {
          if (!newCodes.has(code) && Number(ex.cartons_scanned) > 0) {
            return fail(res, `Không thể xóa mã hàng "${code}" đã xuất ${qtyLabel(Number(ex.cartons_scanned), ex.material ?? null)}`, 400)
          }
          if (!newCodes.has(code) && sapLinked(ex)) {
            return fail(res, sapDeleteLockError(ex), 422)
          }
        }
        // Số thùng < đã xuất + KHÓA sửa SL đơn gốc SAP
        for (const item of items) {
          const ex = existingByCode.get(item.material_code)
          if (ex && item.cartons_ordered < Number(ex.cartons_scanned)) {
            return fail(res, `Số lượng "${item.material_code}" (${qtyLabel(Number(item.cartons_ordered), ex.material ?? null)}) nhỏ hơn đã xuất (${qtyLabel(Number(ex.cartons_scanned), ex.material ?? null)})`, 400)
          }
          if (ex && sapLinked(ex) && Number(item.cartons_ordered) !== Number(ex.cartons_ordered)) {
            return fail(res, sapQtyLockError(ex), 422)
          }
        }
      }
    }

    // ══ HẾT VALIDATE — từ đây mới GHI ═══════════════════════════════════════════
    // Header GDO: CHỈ ghi field CÓ MẶT trong body (bug 31/08: bản cũ ghi vô điều kiện
    // `warehouse_id ?? null` + `dvvt: dvvtName` nên PUT chỉ-sửa-items xoá trắng Kho + ĐVVT).
    const gdoUpdates: Record<string, unknown> = { updated_at: t }
    if (delivery_date !== undefined) gdoUpdates.delivery_date = delivery_date
    if ('warehouse_id' in req.body) gdoUpdates.warehouse_id = warehouse_id ?? null
    if ('dvvt' in req.body) gdoUpdates.dvvt = dvvtName
    if ('gate_registration_id' in req.body) gdoUpdates.gate_registration_id = gate_registration_id ?? null
    if ('shipto_party' in req.body) gdoUpdates.shipto_party = shipto_party ?? null
    if ('warehouse_type' in req.body) gdoUpdates.warehouse_type = warehouse_type ?? null

    await supabase.from('GroupDeliveryOrder')
      .update(gdoUpdates)
      .eq('id', req.params.id)

    // Update customer_name / delivery_code chỉ cho single-DO (multi-DO có distributor_name riêng mỗi OD)
    // — cũng chỉ ghi field có mặt trong body (cùng lớp bug xoá trắng ở trên)
    if (!isMultiDO && doList.length === 1 && gdoCur.origin !== 'SAP') {
      const singleDOPatch: Record<string, unknown> = { updated_at: t }
      if (customer_name !== undefined) singleDOPatch.distributor_name = customer_name ?? null
      if ('delivery_code' in req.body && delivery_code !== undefined)
        singleDOPatch.delivery_code = delivery_code.trim() || null
      if (Object.keys(singleDOPatch).length > 1) {
        await supabase.from('OutboundDelivery')
          .update(singleDOPatch).eq('id', doList[0].id)
      }
    }

    if (!items) return ok(res, await fetchGDOFull(req.params.id))

    // Nhặt lẻ TỰ TÍNH từ Tổng (pallet-remainder) — bỏ qua loose_picking client gửi (user chốt 22/07)
    const effWh = warehouse_id !== undefined ? (warehouse_id ?? null) : ((gdo as { warehouse_id?: string | null }).warehouse_id ?? null)
    const looseMats = await loosePalletMats([...new Set(items.map(i => i.material_code).filter(Boolean))])
    const upLoosePol = await looseConfigOf(effWh ? [effWh] : null)
    const looseOf = (i: { material_code: string; cartons_ordered: number }) =>
      loosePalletRemainder(i.cartons_ordered, looseMats.get(i.material_code), effWh,
        upLoosePol.of(effWh, looseMats.get(i.material_code)?.category ?? null))

    // export_type là field CẤP BODY áp per-item: chỉ đè khi body có gửi (không thì PUT chỉ-sửa-items
    // xoá trắng Loại xe của mọi dòng — cùng lớp bug 31/08)
    const exportTypePatch = 'export_type' in req.body ? { export_type: export_type ?? null } : {}

    if (isMultiDO) {
      // Multi-DO: match bằng db_id, cho phép xóa item chưa xuất (đã validate ở trên)
      const existingById = new Map<string, ExItemRow>(existingItems.map(i => [i.id, i]))
      const requestedDbIds = new Set(items.filter(i => i.db_id).map(i => i.db_id as string))

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
            const fields: Record<string, unknown> = { cartons_ordered: item.cartons_ordered, loose_picking: looseOf(item), header_text: item.header_text?.trim() || null, batch_required: item.batch_required?.trim() || null, date_required: item.date_required || null, cs_responsible: item.cs_responsible?.trim() || null, ...exportTypePatch, status: newStatus, updated_at: t }
            if (scanned === 0 && ex.material_code_raw !== item.material_code) {
              const matInfo = changedMatMap.get(item.material_code)
              fields.material_code_raw = item.material_code
              fields.material_id       = matInfo?.id ?? null
              fields.material_type     = matInfo?.category ?? null
            }
            return supabase.from('OutboundItem').update(fields).eq('id', item.db_id!)
          })
      )

      // Dòng THÊM MỚI (không db_id) ở đơn đa-NPP: gắn vào DO của NPP dòng đó chỉ định (NPP đã validate)
      const newRows = items.filter(item => !item.db_id && item.material_code)
      if (newRows.length) {
        const doByNpp = new Map<string, string>(
          doList.map((d: any) => [String(d.distributor_name ?? '').trim(), d.id as string])
        )
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
      // Single-DO: CRUD đầy đủ, match bằng material_code (đã validate ở trên)
      const doId = doList[0]?.id
      if (!doId) return ok(res, await fetchGDOFull(req.params.id))

      const existingByCode = new Map<string, ExItemRow>(existingItems.map(i => [String(i.material_code_raw), i]))
      const newCodes = new Set(items.map(i => i.material_code))

      // Xóa items bị loại bỏ
      const toDeleteIds = existingItems
        .filter(i => !newCodes.has(String(i.material_code_raw)))
        .map(i => i.id)
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
          toUpdate.push({ id: ex.id, fields: { cartons_ordered: item.cartons_ordered, loose_picking: looseOf(item), header_text: item.header_text?.trim() || null, batch_required: item.batch_required?.trim() || null, date_required: item.date_required || null, cs_responsible: item.cs_responsible?.trim() || null, ...exportTypePatch, status: newStatus, updated_at: t } })
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
    if (req.user?.is_superadmin !== true) {
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
        .select('status, origin, delivery_date, started_at').eq('id', req.params.id).single()
      if (current?.status === 'PAUSED')
        return fail(res, 'Chuyến đang tạm dừng — chỉ được đổi trạng thái, không sửa dữ liệu', 400)
      const pushErr = futureShiftError(current as GdoDateShift | null, delivery_date)
      if (pushErr) return fail(res, 422, 'FUTURE_DATE', pushErr)
      // XUẤT LÀ DỮ LIỆU BỊ ĐỘNG với chuyến SAP (user chốt 02/08): đường "Đổi ngày" nhanh này từng
      // là lỗ sót — updateGDO đã khóa ngày mà PATCH thì không, chuyến SAP vẫn đổi ngày lệch khỏi
      // Kế hoạch xuất. Ngày = thuộc tính kế hoạch → sửa Ngày xuất ở tab Kế hoạch xuất (tự đồng bộ
      // mọi dòng của xe + dội xuống chuyến).
      if ((current as { origin?: string | null } | null)?.origin === 'SAP'
          && String(delivery_date) !== String((current as { delivery_date?: string | null } | null)?.delivery_date ?? ''))
        return fail(res, 422, 'SAP_PLAN_LOCKED', 'Chuyến sinh từ SAP — không đổi Ngày xuất tại đây. Sửa Ngày xuất ở tab "Kế hoạch xuất" (Dữ liệu bên ngoài) — mọi dòng của xe tự đồng bộ và chuyến cập nhật theo.')
    }

    // MÁY TRẠNG THÁI (bug 01/08 — PATCH status tự do lách startGDO): PATCH chỉ được 3 bước
    // Tạm dừng / Tiếp tục / Hoàn thành. Bắt đầu = POST /start (qua rule cổng/cân), Hủy = DELETE.
    // Không có whitelist thì user có quyền edit PATCH {status:'IN_PROGRESS'} trên chuyến PENDING
    // → chuyến "Đang xuất" không biển số, không qua rule nào, started_at vẫn null.
    if (status !== undefined) {
      const { data: curG } = await supabase.from('GroupDeliveryOrder')
        .select(`status, started_at, ${INERT_COLS}`).eq('id', req.params.id).single()
      // Chuyến bất động: không đổi trạng thái (kể cả Hoàn thành) — nhưng vẫn cho HỦY để dọn.
      if (status !== 'CANCELLED') {
        const inertErr = inertError(curG as GdoInertState | null)
        if (inertErr) return fail(res, 422, 'TRIP_INERT', inertErr)
      }
      const cs = curG?.status
      const okTransition =
        (status === 'PAUSED'      && cs === 'IN_PROGRESS') ||
        (status === 'IN_PROGRESS' && cs === 'PAUSED') ||
        (status === 'COMPLETED'   && !!curG?.started_at && (cs === 'IN_PROGRESS' || cs === 'PAUSED'))
      if (!okTransition)
        return fail(res, `Không thể chuyển trạng thái ${cs ?? '?'} → ${status}. Bắt đầu chuyến dùng nút "Bắt đầu" (có kiểm tra cổng/cân), hủy chuyến dùng nút "Hủy".`, 400)
    }

    // Gác hoàn thành: thực quét phải KHỚP kế hoạch — mọi item cartons_scanned >= cartons_ordered.
    // Xuất thiếu (hết tồn/NPP giao thiếu): chuyến tay → sửa SL đơn xuống = thực xuất; chuyến SAP
    // (user chốt 02/08 "bắt buộc SAP và thực xuất khớp nhau, muốn sửa thì sửa ở nguồn trước") →
    // SL khóa trên đơn, sửa DO ở tab DO SAP → engine reconcile dội xuống (đã quét thì qua hàng chờ
    // "Cần xử lý" bấm Áp SAP) → khớp → hoàn thành.
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
          const { data: og } = await supabase.from('GroupDeliveryOrder').select('origin').eq('id', req.params.id).maybeSingle()
          const fixHint = (og as { origin?: string | null } | null)?.origin === 'SAP'
            ? 'Chuyến sinh từ SAP: sửa Số lượng DO ở tab DO SAP (Dữ liệu bên ngoài) → hệ thống dội xuống đơn (dòng đã quét sẽ vào "Cần xử lý" — bấm Áp SAP) → khớp rồi hoàn thành.'
            // Câu này phải nói ĐỦ BA BƯỚC: đơn ĐANG XUẤT không sửa được (updateGDO chỉ nhận
            // PENDING/PAUSED), nên bỏ bước "Tạm dừng" là đẩy người vận hành vào ngõ cụt —
            // họ làm đúng lời hướng dẫn rồi nhận tiếp lỗi thứ hai (đo thật 06/09).
            : 'Bấm "Tạm dừng" chuyến → sửa số lượng đơn xuống bằng thực xuất → "Tiếp tục" → Hoàn thành.'
          return fail(res, `Chưa thể hoàn thành — còn ${short.length} mã chưa xuất đủ kế hoạch (vd ${e.material_code_raw ?? '?'}: ${qtyLabel(Number(e.cartons_scanned), e.material ?? null)}/${qtyLabel(Number(e.cartons_ordered), e.material ?? null)}). ${fixHint}`, 400)
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
    // Chuyến bất động: giao đơn cho người soạn hàng là vô nghĩa (chưa/không còn dòng hàng nào)
    {
      const { data: cur } = await supabase.from('GroupDeliveryOrder').select(INERT_COLS).eq('id', req.params.id).maybeSingle()
      const inertErr = inertError(cur as GdoInertState | null)
      if (inertErr) return fail(res, 422, 'TRIP_INERT', inertErr)
    }
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
      gate_registration_id, allow_shared_gate,
    } = req.body as {
      license_plate?: string; container_number?: string; exporter_name?: string
      loader_name?: string; forklift_driver_id?: string; forklift_driver_names?: string
      gate_registration_id?: string | null; allow_shared_gate?: boolean
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
      .select(`assigned_at, started_at, status, warehouse_id, shipto_party, delivery_date, weigh_waived_at, gate_waived_at, ${INERT_COLS}, warehouse:Warehouse(inventory_mode,require_weigh_on_start,require_gate_on_start)`).eq('id', req.params.id).maybeSingle()
    // Chặn start đúp/start ngược trạng thái: 2 người cùng bấm → người sau đè biển số người trước;
    // tệ hơn, start trên chuyến ĐÃ hoàn thành kéo status về IN_PROGRESS (lách quyền uncomplete).
    const curStatus = (cur as { status?: string } | null)?.status
    if ((cur as { started_at?: string | null } | null)?.started_at || curStatus === 'COMPLETED' || curStatus === 'CANCELLED') {
      return fail(res, 'Chuyến đã bắt đầu hoặc đã kết thúc — dùng "Sửa thông tin xe" nếu cần đổi biển số', 400)
    }
    const startFutErr = futureDateError((cur as { delivery_date?: string | null } | null)?.delivery_date)
    if (startFutErr) return fail(res, 422, 'FUTURE_DATE', startFutErr)
    { const inertErr = inertError(cur as GdoInertState | null)
      if (inertErr) return fail(res, 422, 'TRIP_INERT', inertErr) }
    const curMode = (cur as { warehouse?: { inventory_mode?: string | null } | null } | null)?.warehouse?.inventory_mode ?? null
    const autoAssign = !(cur as { assigned_at?: string | null } | null)?.assigned_at && curMode !== 'QR'

    // 2 RULE ĐỘC LẬP per kho + 2 VẾT DUYỆT RIÊNG (user chốt 01/08: "phân thành 2 tình huống và 2
    // action riêng — có khi đăng ký cổng nhưng không cân hoặc ngược lại"):
    //   Rule 1 require_gate_on_start  → đăng ký cổng hợp lệ  · miễn = gate_waived_at  (outbound.gate_waive)
    //   Rule 2 require_weigh_on_start → phiếu cân hôm nay    · miễn = weigh_waived_at (outbound.weigh_waive)
    // Duyệt rule nào thoát rule đó; kho bật cả 2 mà chỉ duyệt 1 → rule kia vẫn chặn. Không còn lựa
    // chọn nào lúc bấm Bắt đầu ("bắt đầu và chọn là rủi ro").
    const gateWaived  = !!(cur as { gate_waived_at?: string | null } | null)?.gate_waived_at
    const weighWaived = !!(cur as { weigh_waived_at?: string | null } | null)?.weigh_waived_at
    const isInternal = !license_plate?.trim() &&
      (await isInternalPair((cur as { warehouse_id?: string | null } | null)?.warehouse_id, (cur as { shipto_party?: string | null } | null)?.shipto_party))
    // Biển số bắt buộc, TRỪ nội bộ parent↔kho phụ và chuyến đã duyệt bỏ qua CỔNG (giao lẻ NV nhận không xe)
    if (!license_plate?.trim() && !gateWaived && !isInternal)
      return fail(res, 'Biển số xe là bắt buộc', 400)
    const whFlags = (cur as { warehouse?: { require_weigh_on_start?: boolean; require_gate_on_start?: boolean } | null } | null)?.warehouse
    let weighTicketId: string | null = null
    if (!isInternal) {
      if (whFlags?.require_gate_on_start === true && !gateWaived) {
        const gErr = await gateRegError(gate_registration_id, (cur as { warehouse_id?: string | null } | null)?.warehouse_id, license_plate)
        if (gErr) return fail(res, 422, 'GATE_REQUIRED', gErr)
      }
      if (whFlags?.require_weigh_on_start === true && !weighWaived) {
        // Chuyến không biển số (đã duyệt cổng — giao lẻ) vẫn phải được duyệt CÂN riêng nếu kho bật rule 2
        if (!license_plate?.trim())
          return fail(res, 422, 'WEIGH_REQUIRED', 'Chuyến không có biển số nhưng kho yêu cầu CÂN XE — cần người có quyền duyệt "Bỏ qua cân" trên chuyến (giao lẻ/xe máy/nhân viên nhận không cân được).')
        const gate = await checkWeighGate((cur as { warehouse_id?: string | null } | null)?.warehouse_id, license_plate, req.params.id, gate_registration_id)
        if (!gate.ok) return fail(res, 422, 'WEIGH_REQUIRED', gate.message)
        weighTicketId = gate.ticketId
      }
    }

    // CAS trên started_at: 2 người bấm Bắt đầu đồng thời → chỉ 1 người thắng, người sau 409
    // (không thì người sau đè biển số/phiếu cổng và có thể gắn 2 phiếu cân vào cùng chuyến)
    const { data: startedRows, error } = await supabase.from('GroupDeliveryOrder')
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
        status:     'IN_PROGRESS',
        updated_at: now(),
      })
      .eq('id', req.params.id).is('started_at', null).select('id')
    if (error) return fail(res, error.message)
    if (!startedRows || startedRows.length === 0)
      return fail(res, 'Chuyến vừa được người khác Bắt đầu — tải lại trang để xem trạng thái mới', 409)
    await linkWeighTicket(weighTicketId, req.params.id)   // gắn phiếu cân ↔ chuyến (đối chiếu KL)
    const result = await fetchGDOFull(req.params.id)
    return ok(res, result)
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── Duyệt bỏ qua TỪNG RULE — 2 tình huống, 2 action, 2 quyền riêng (user chốt 01/08:
// "có khi đăng ký cổng nhưng không cân hoặc ngược lại"). Người duyệt có thể KHÁC người bấm
// Bắt đầu: duyệt trước trên chuyến → công nhân start bình thường. Duyệt rule nào thoát rule đó.

// POST /outbound/:gdoId/weigh-waive  { reason? } — CHỈ rule CÂN (outbound.weigh_waive)
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

// POST /outbound/:gdoId/gate-waive  { reason? } — CHỈ rule ĐĂNG KÝ CỔNG (outbound.gate_waive).
// Duyệt cổng ⇒ biển số thành tùy chọn (giao lẻ/xe máy/nhân viên nhận không có xe đăng ký).
export async function waiveGateGDO(req: Request, res: Response) {
  try {
    const { reason } = req.body as { reason?: string }
    if (!(await guardGdoScope(req, res, req.params.gdoId))) return
    const { data, error } = await supabase.from('GroupDeliveryOrder')
      .update({
        gate_waived_at: now(), gate_waived_by: req.user?.name ?? null,
        gate_waive_reason: String(reason ?? '').trim() || null, updated_at: now(),
      })
      .eq('id', req.params.gdoId).select('id').maybeSingle()
    if (error) return fail(res, error.message)
    if (!data) return fail(res, 'Không tìm thấy chuyến', 404)
    return ok(res, await fetchGDOFull(req.params.gdoId))
  } catch (e) { return fail(res, String(e)) }
}

// DELETE /outbound/:gdoId/gate-waive — hủy duyệt bỏ qua cổng
export async function unwaiveGateGDO(req: Request, res: Response) {
  try {
    if (!(await guardGdoScope(req, res, req.params.gdoId))) return
    const { data, error } = await supabase.from('GroupDeliveryOrder')
      .update({ gate_waived_at: null, gate_waived_by: null, gate_waive_reason: null, updated_at: now() })
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
    if (!(await guardGdoScope(req, res, req.params.id))) return

    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select('started_at, warehouse_id, license_plate, gate_waived_at, weigh_waived_at, warehouse:Warehouse(require_gate_on_start,require_weigh_on_start)')
      .eq('id', req.params.id).single()
    if (!gdo?.started_at) return fail(res, 'Chuyến chưa được bắt đầu', 400)
    const utGateWaived  = !!(gdo as { gate_waived_at?: string | null }).gate_waived_at
    const utWeighWaived = !!(gdo as { weigh_waived_at?: string | null }).weigh_waived_at
    // Biển số bắt buộc TRỪ chuyến đã duyệt bỏ qua cổng (giao lẻ/xe máy/NV nhận không có xe) —
    // mirror startGDO, không thì chuyến giao lẻ không sửa được người xuất/bốc xếp (400 oan)
    if (!license_plate?.trim() && !utGateWaived) return fail(res, 'Biển số xe là bắt buộc', 400)

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

    // SỬA XE cũng phải chấp hành 2 rule như Bắt đầu (bug 01/08: start bằng xe hợp lệ rồi
    // "Sửa thông tin xe" đổi sang biển bất kỳ = lách rule; phiếu cân cũ vẫn gắn → đối chiếu KL sai xe)
    const utFlags = (gdo as { warehouse?: { require_gate_on_start?: boolean; require_weigh_on_start?: boolean } | null }).warehouse
    if (utFlags?.require_gate_on_start === true && !utGateWaived) {
      const gErr = await gateRegError(gate_registration_id, (gdo as { warehouse_id?: string | null }).warehouse_id, license_plate)
      if (gErr) return fail(res, 422, 'GATE_REQUIRED', gErr)
    }
    const utNewPlate = normalizePlate(license_plate)
    const utPlateChanged = utNewPlate !== normalizePlate((gdo as { license_plate?: string | null }).license_plate)
    let utTicketId: string | null = null
    if (utFlags?.require_weigh_on_start === true && !utWeighWaived && utPlateChanged && utNewPlate) {
      const gate = await checkWeighGate((gdo as { warehouse_id?: string | null }).warehouse_id, license_plate, req.params.id, gate_registration_id)
      if (!gate.ok) return fail(res, 422, 'WEIGH_REQUIRED', gate.message)
      utTicketId = gate.ticketId
    }

    const { error } = await supabase.from('GroupDeliveryOrder')
      .update({
        license_plate:         utNewPlate ?? null,
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
    if (utPlateChanged) {
      // Biển đổi → phiếu cân auto của biển CŨ không còn thuộc chuyến này (match tay giữ nguyên)
      await supabase.from('WeighTicket')
        .update({ gdo_id: null, matched_at: null, matched_by: null, updated_at: now() })
        .eq('gdo_id', req.params.id).eq('matched_by', 'auto-start')
        .neq('license_plate_norm', utNewPlate ?? '')
      await linkWeighTicket(utTicketId, req.params.id)
    }
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
        gate_registration_id: null,   // trả phiếu cổng — không thì chuyến đã gỡ vẫn "chiếm" phiếu (409 oan chuyến khác)
        status: 'PENDING', updated_at: t,
      })
      .eq('id', req.params.id)
    if (error) return fail(res, error.message)
    // Gỡ phiếu cân đã gắn TỰ ĐỘNG lúc Bắt đầu (bug 01/08: phiếu kẹt với chuyến đã gỡ → xe bị chặn
    // OAN 422 khi start chuyến khác). Match TAY (người trạm cân chủ động gắn) giữ nguyên.
    await supabase.from('WeighTicket')
      .update({ gdo_id: null, matched_at: null, matched_by: null, updated_at: t })
      .eq('gdo_id', req.params.id).eq('matched_by', 'auto-start')
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
  autoLoosePallet = false,   // true (KHVC/SAP): loose theo policy nhặt lẻ của (kho, loại) — mặc định phần thùng lẻ < 1 pallet
  loosePol: LooseResolver,   // policy 2 tầng (24/08) — OFF ép 0 cả cột "Nhặt lẻ" ghi tay
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
        loose_picking:     autoLoosePallet
          ? loosePalletRemainder(newCartons, mu, warehouse_id, loosePol.of(warehouse_id, mu?.category ?? null))
          // Kho OFF ép 0 cả số ghi tay (user chốt 24/08) — file cũ không lách được setting
          : (loosePol.of(warehouse_id, mu?.category ?? null).mode === 'OFF' ? 0 : parseDecimal(row['Nhặt lẻ'])),
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

    const wb = readWorkbookSafe(req.file.buffer)
    if (!wb) return fail(res, BAD_EXCEL_MSG, 400)
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

// ─── CHUYẾN BẤT ĐỘNG: chờ dữ liệu SAP / kế hoạch đã bỏ (user chốt 03/08) ───────
// Hai tình huống, cùng một hệ quả (chuyến hiện nhưng không thao tác được), khác lý do:
//   awaiting_sap  = còn DO chưa có dữ liệu VL06O  → chờ kho up VL06O (hoặc API SAP) là tự sống
//   plan_dropped  = Kế hoạch xuất không còn dòng nào cho Số xe này → chờ kế hoạch có lại
// KHÔNG xóa chuyến trong cả hai (user: "chỉ có thể xem được info của nó — từ đó xem được lịch sử").
type PrevGdoState = { id: string; status: string; awaiting: boolean; dropped: boolean }

// Dọn dòng hàng của chuyến vừa chuyển sang CHỜ dữ liệu. An toàn tuyệt đối: có BẤT KỲ thùng nào
// đã quét thì KHÔNG đụng (giữ dữ liệu vận hành + ghi sổ để người xử), và nhả tồn giữ chỗ trước khi xóa.
async function clearItemsForAwaiting(gdoId: string, gc: string, actor: string, events: OutboundEventInput[]): Promise<void> {
  const { data: dvs } = await supabase.from('OutboundDelivery').select('id').eq('gdo_id', gdoId)
  const doIds = ((dvs ?? []) as { id: string }[]).map(d => d.id)
  if (!doIds.length) return
  const its = await fetchAllByIdChunks(doIds, c => supabase.from('OutboundItem')
    .select('id, cartons_scanned').in('do_id', c).order('id')) as { id: string; cartons_scanned: number }[]
  if (!its.length) return
  if (its.some(i => Number(i.cartons_scanned) > 0)) {
    events.push({ group_code: gc, gdo_id: gdoId, event_type: 'AWAITING_KEEP_SCANNED', source: 'SAP', actor,
      detail: 'Chuyến quay lại chờ dữ liệu SAP nhưng ĐÃ CÓ HÀNG QUÉT — giữ nguyên dòng hàng, cần người đối chiếu' })
    return
  }
  await releaseScansForDOs(doIds)   // nhả tồn nhặt lẻ đã giữ chỗ (nếu có) trước khi xóa
  for (let i = 0; i < doIds.length; i += 300) {
    const c = doIds.slice(i, i + 300)
    await supabase.from('OutboundItem').delete().in('do_id', c)
    await supabase.from('OutboundDelivery').delete().in('id', c)
  }
}

async function applyAwaitingState(
  req: Request,
  awaitingByGc: Map<string, AwaitingGroup>,
  processedGcs: string[],
  prev: Map<string, PrevGdoState>,
): Promise<{ awaiting: number; shells: number; cleared: number; reopened: number }> {
  const out = { awaiting: 0, shells: 0, cleared: 0, reopened: 0 }
  const gcs = [...new Set([...processedGcs, ...awaitingByGc.keys()])]
  if (!gcs.length) return out
  const t = now()
  const actor = actorOf(req)
  const events: OutboundEventInput[] = []

  // Chuyến HIỆN TẠI (sau khi derive đã ghi xong) — id có thể MỚI so với prev (nhánh xóa+tạo lại)
  const cur = await fetchAllByIdChunks(gcs, chunk => supabase.from('GroupDeliveryOrder')
    .select('id, group_code, status, awaiting_sap, awaiting_dos, plan_dropped').in('group_code', chunk).order('id')) as
    { id: string; group_code: string; status: string; awaiting_sap: boolean; awaiting_dos: string[] | null; plan_dropped: boolean }[]
  const byGc = new Map(cur.map(g => [g.group_code, g]))

  // Kho theo mã (Số xe = Mãkho_X_ddmmyy_stt) — chỉ cho nhánh dựng chuyến vỏ
  const shellGcs = [...awaitingByGc.keys()].filter(gc => !byGc.has(gc))
  const whByCode = new Map<string, string>()
  if (shellGcs.length) {
    const codes = [...new Set(shellGcs.map(gc => gc.split('_')[0]).filter(Boolean))]
    const { data: whs } = await supabase.from('Warehouse').select('id, code').in('code', codes)
    for (const w of ((whs ?? []) as { id: string; code: string }[])) whByCode.set(w.code, w.id)
  }
  const resolveDvvt = shellGcs.length ? await buildDvvtResolver() : null

  // (1) Xe còn DO chờ dữ liệu
  for (const [gc, a] of awaitingByGc) {
    const g = byGc.get(gc)
    if (g) {
      // Chuyến đang chạy/đã xong thì KHÔNG tự khóa (replan đã đẩy "Cần xử lý" cho người quyết)
      if (g.status === 'IN_PROGRESS' || g.status === 'COMPLETED') continue
      const sameDos = JSON.stringify([...(g.awaiting_dos ?? [])].sort()) === JSON.stringify([...a.dos].sort())
      if (g.awaiting_sap && sameDos && !g.plan_dropped) { out.awaiting++; continue }
      // Chuyến ĐANG ĐỦ dữ liệu nay quay lại CHỜ (SAP bỏ dòng / điều vận thêm DO chưa có raw):
      // dọn dòng hàng cũ để chuyến chờ luôn là VỎ — nếu giữ, đó là kế hoạch CŨ đứng im, không bao
      // giờ được cập nhật cho tới khi dữ liệu về, mà nhìn trên màn lại như kế hoạch thật.
      // CHỈ dọn khi CHƯA quét gì (đã quét = dữ liệu vận hành, không tự xóa — giữ nguyên + ghi sổ).
      await clearItemsForAwaiting(g.id, gc, actor, events)
      await supabase.from('GroupDeliveryOrder')
        .update({ awaiting_sap: true, awaiting_dos: a.dos, plan_dropped: false, plan_dropped_at: null, updated_at: t })
        .eq('id', g.id)
      // Chuyến ĐANG NGỪNG mà kế hoạch có lại NHƯNG vẫn thiếu dữ liệu SAP: vẫn phải ghi vết "hết
      // ngừng" — nếu không, sổ chỉ có "NGỪNG HOẠT ĐỘNG" rồi im, người đọc không biết kế hoạch đã
      // quay lại lúc nào (nhánh (2) bên dưới bỏ qua xe còn chờ nên không ghi hộ được).
      if (prev.get(gc)?.dropped) {
        events.push({ group_code: gc, gdo_id: g.id, event_type: 'PLAN_VEHICLE_REOPENED', source: 'PLAN', actor,
          detail: 'Kế hoạch xuất có lại dòng cho Số xe này — chuyến hết NGỪNG HOẠT ĐỘNG (vẫn chờ dữ liệu SAP)' })
        out.reopened++
      }
      if (!prev.get(gc)?.awaiting)
        events.push({ group_code: gc, gdo_id: g.id, event_type: 'AWAITING_SET', source: 'PLAN', actor,
          new_value: a.dos.join(', '), detail: `Chuyến chờ dữ liệu SAP — thiếu DO: ${a.dos.join(', ')}` })
      out.awaiting++
      continue
    }
    // Chưa có chuyến nào → dựng CHUYẾN VỎ (chưa có dòng hàng vì dòng hàng nằm ở VL06O)
    // Định dạng Số xe phải kiểm Y HỆT derive thường: nếu không, Số xe sai định dạng sẽ đẻ ra chuyến vỏ
    // KHÔNG BAO GIỜ derive được (dữ liệu về vẫn 400) — chuyến ma nằm lại trên màn (bắt được khi dựng QA 13).
    if (validateGroupCode(gc)) continue
    const whId = whByCode.get(gc.split('_')[0]) ?? null
    const delivery_date = parseExcelDate(a.plan.export_date)
    const planned_date = parsePlannedDate(gc)
    if (!whId || !delivery_date || !planned_date) continue      // kho/ngày không hợp lệ → derive thường đã báo lỗi
    if (!inScope(req, whId)) continue                            // không dựng chuyến cho kho ngoài phạm vi
    const gdoId = randomUUID()
    const { error } = await supabase.from('GroupDeliveryOrder').insert({
      id: gdoId, group_code: gc, planned_date, delivery_date, warehouse_id: whId,
      dvvt: a.plan.dvvt ? resolveDvvt!(a.plan.dvvt).name : null,
      warehouse_type: null,                 // chưa biết Loại kho (suy từ mã hàng — mà mã hàng nằm ở VL06O)
      origin: 'SAP', status: 'PENDING',
      awaiting_sap: true, awaiting_dos: a.dos,
      created_by: actor, updated_by: actor, updated_at: t,
    })
    if (error) { console.error('[applyAwaitingState] tạo chuyến vỏ:', error.message); continue }
    events.push({ group_code: gc, gdo_id: gdoId, event_type: 'AWAITING_SET', source: 'PLAN', actor,
      new_value: a.dos.join(', '),
      detail: `Tạo chuyến từ Kế hoạch xuất khi CHƯA có dữ liệu VL06O — chờ DO: ${a.dos.join(', ')}` })
    out.shells++; out.awaiting++
  }

  // (2) Xe đã đủ dữ liệu → gỡ cờ chờ. Chuyến CHỜ/NGỪNG được GIỮ NGUYÊN bản ghi (nhánh preserve)
  //     nên cờ vẫn còn true ở đây và phải gỡ thật; vết sổ vẫn ghi theo trạng thái TRƯỚC derive.
  for (const gc of processedGcs) {
    if (awaitingByGc.has(gc)) continue
    const g = byGc.get(gc)
    const was = prev.get(gc)
    if (g && (g.awaiting_sap || g.plan_dropped)) {
      await supabase.from('GroupDeliveryOrder')
        .update({ awaiting_sap: false, awaiting_dos: null, plan_dropped: false, plan_dropped_at: null, updated_at: t })
        .eq('id', g.id)
    }
    if (was?.awaiting) {
      events.push({ group_code: gc, gdo_id: g?.id ?? null, event_type: 'AWAITING_CLEARED', source: 'SAP', actor,
        detail: 'Đã có dữ liệu VL06O cho mọi DO — chuyến hoạt động trở lại' })
      out.cleared++
    }
    if (was?.dropped) {
      events.push({ group_code: gc, gdo_id: g?.id ?? null, event_type: 'PLAN_VEHICLE_REOPENED', source: 'PLAN', actor,
        detail: 'Kế hoạch xuất có lại dòng cho Số xe này — chuyến hoạt động trở lại' })
      out.reopened++
    }
  }

  await logOutboundEvents(events)
  return out
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
  awaitingByGc?: Map<string, AwaitingGroup>,   // xe còn DO chưa có VL06O → chuyến CHỜ (không chặn file nữa)
  beforeWrite?: () => Promise<void>,           // ghi tầng raw CHỈ khi đã qua validate (kiểm trước khi ghi)
  planFp?: Map<string, string>,                // vân tay kế hoạch lúc BẮT ĐẦU dội (chống đua — xem planFingerprints)
  healDepth = 0,                               // chặn đệ quy khi tự dội lại
): Promise<Response> {
    // NGUỒN chuyến (user chốt 02/08): KHVC (autoLoosePallet=true) = 'SAP' → khóa sửa phần kế hoạch
    // trên đơn, mọi đổi đi qua VL06O/Kế hoạch xuất; upload kiểu cũ = 'EXCEL' → sửa như cũ (kho không SAP).
    // Re-upload cũng ĐÓNG DẤU LẠI: chuyến LEGACY được up lại qua KHVC sẽ thành SAP (và ngược lại không xảy ra
    // vì 2 luồng upload khác file — cùng group_code up kiểu khác là chủ đích của user).
    const gdoOrigin = autoLoosePallet ? 'SAP' : 'EXCEL'
    // Pre-load warehouses, materials, warehouse types, and existing GDOs in parallel
    // Gồm CẢ xe đang chờ dữ liệu (không có dòng hàng nào) — cần trạng thái TRƯỚC derive để ghi sổ
    // "đã kích hoạt trở lại"; các map phân loại bên dưới chỉ tra theo xe CÓ dòng nên không ảnh hưởng.
    const allGroupCodes = [...new Set([...byVehicle.keys(), ...(awaitingByGc?.keys() ?? [])])]
    const [warehousesRes, whTypesRes, vehicleTypesRes, existingGdos, allMaterials] = await Promise.all([
      supabase.from('Warehouse').select('id, code, name').eq('is_active', true),
      // LookupValue KHÔNG có cột is_active — lọc theo nó làm query lỗi → validWhTypes rỗng → chặn oan mọi file
      supabase.from('LookupValue').select('value').eq('type', 'warehouse_type'),
      supabase.from('VehicleType').select('code, name').eq('is_active', true),
      // Chunk + phân trang: file nhiều nghìn Số xe → .in() 1 phát vừa vượt URL vừa bị cap-1000
      // (GDO thứ 1001+ bị coi là "mới" → tạo trùng)
      fetchAllByIdChunks(allGroupCodes, chunk => supabase.from('GroupDeliveryOrder')
        .select('id, group_code, status, assigned_at, assigned_by, shipto_party, awaiting_sap, plan_dropped')
        .in('group_code', chunk).order('id')),
      // PHÂN TRANG: >1000 mã → nếu không phân trang bị cap 1000 → mã ngoài 1000 bị báo oan "chưa có trong hệ thống"
      fetchAllRowsParallel(() => supabase.from('Material').select('id, material_code, base_unit, entry_unit, units_per_carton, cartons_per_pallet, warehouse_pallet_overrides, is_non_stock, category')) as Promise<({ id: string; material_code: string; is_non_stock?: boolean } & MatPalletUnits)[]>,
    ])
    // Policy nhặt lẻ 2 tầng — file trải nhiều kho nên nạp MỌI kho 1 lượt (2 câu, không per-group)
    const uploadLoosePol = await looseConfigOf(null)

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
    // Giữ nguyên bản ghi vì NHIỀU lý do (phân công / đang chờ SAP / đang ngừng) — riêng ô đếm
    // "giữ phân công đã gán" ở bản kiểm trước chỉ được tính xe THẬT SỰ có phân công.
    const assignedGcs = new Set<string>()
    const pausedGDOMap       = new Map<string, string>()
    const blockedMap         = new Map<string, string>() // group_code → status
    // Ship-to đã gán tay trên đơn PENDING — mang theo khi upload đè (xóa+tạo lại), không để mất âm thầm
    const shiptoByGroupCode  = new Map<string, string>()

    // Trạng thái TRƯỚC derive (derive có thể xóa+tạo lại chuyến PENDING → mất dấu vết cũ)
    const prevGdoState = new Map<string, PrevGdoState>()
    for (const g of (existingGdos ?? [])) {
      prevGdoState.set(g.group_code as string, {
        id: g.id as string, status: g.status as string,
        awaiting: g.awaiting_sap === true, dropped: g.plan_dropped === true,
      })
      if (g.shipto_party) shiptoByGroupCode.set(g.group_code as string, g.shipto_party as string)
      if (g.status === 'PENDING') {
        // GIỮ NGUYÊN bản ghi (không xóa+tạo lại) khi chuyến đã có "danh tính" người dùng đang cầm:
        //  · assigned_at   → giữ phân công
        //  · awaiting_sap  → người đang mở trang chuyến CHỜ; VL06O về mà đổi id thì trang họ 404
        //  · plan_dropped  → user chốt 03/08: "chuyến KHÔNG bị xóa… kế hoạch có lại thì hoạt động
        //                    trở lại VỚI LỊCH SỬ ĐƯỢC BỔ SUNG" — đổi id là mất chính cái lịch sử đó
        // (đo 03/08: id đổi ⇒ trang đang mở 404 + vết sổ trỏ vào bản ghi đã chết)
        if (g.assigned_at || g.awaiting_sap || g.plan_dropped) {
          pendingPreserveMap.set(g.group_code as string, g.id)
          if (g.assigned_at) assignedGcs.add(g.group_code as string)
        } else {
          pendingSimpleMap.set(g.group_code as string, g.id)
        }
      } else if (g.status === 'PAUSED') {
        pausedGDOMap.set(g.group_code as string, g.id)
      } else {
        blockedMap.set(g.group_code as string, g.status)
      }
    }

    // Chuyến PENDING/PAUSED đang GIỮ HÀNG NHẶT LẺ → KHÔNG ghi đè/merge (user chốt 05/08): ghi đè
    // là xóa-tạo-lại item nên tự nhả phần giữ TRÊN GIẤY, trong khi hàng VẬT LÝ đã rời pallet nằm ở
    // vị trí chờ — user phải gỡ trả hàng nhặt lẻ trên chuyến trước rồi mới sửa/dội kế hoạch.
    const looseHeldGcs = new Set<string>()
    {
      const openIds = (existingGdos ?? [])
        .filter(g => g.status === 'PENDING' || g.status === 'PAUSED')
        .map(g => g.id as string)
      const held = await looseHeldGdoIds(openIds)
      for (const g of (existingGdos ?? []))
        if (held.has(g.id as string)) looseHeldGcs.add(g.group_code as string)
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
      if (looseHeldGcs.has(group_code)) {
        created.push({
          group_code, skipped: true,
          reason: 'Đang GIỮ HÀNG NHẶT LẺ ở vị trí chờ — gỡ trả hàng nhặt lẻ trên chuyến rồi mới sửa/ghi đè kế hoạch',
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
          byNpp, matMap, autoLoosePallet, uploadLoosePol
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
              loose_picking:     autoLoosePallet
                ? loosePalletRemainder(orderedBase, mu, resolved_warehouse_id, uploadLoosePol.of(resolved_warehouse_id, mu?.category ?? null))
                : (uploadLoosePol.of(resolved_warehouse_id, mu?.category ?? null).mode === 'OFF' ? 0 : parseDecimal(row['Nhặt lẻ'])),
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
          fields: { delivery_date, planned_date, warehouse_id: resolved_warehouse_id, dvvt, warehouse_type: loai_kho, shipto_party: resolvedShipto, priority, transport_note, origin: gdoOrigin, updated_at: now() },
        })
        collectDOsAndItems(gdoId)
        created.push({ group_code, id: gdoId, created: true, preserved_assignment: assignedGcs.has(group_code) })
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
        origin: gdoOrigin,              // 'SAP' (KHVC) khóa sửa kế hoạch trên đơn · 'EXCEL' như cũ
        status: 'PENDING', created_by: actor, updated_by: actor, updated_at: now(),
      })
      collectDOsAndItems(gdoId)
      created.push({ group_code, id: gdoId, created: true })
    }

    // ── KIỂM TRƯỚC (preflight): đã build xong mọi thứ, CHƯA ghi 1 dòng nào → trả báo cáo rồi dừng.
    // Đếm lấy từ chính các mảng sắp ghi: chuyến mới = gdoInserts, ghi đè kế hoạch cũ = toReplace +
    // toPreserve (chuyến PENDING đã gán người thì giữ phân công), bỏ qua = chuyến đang xuất/đã HT.
    if (isPreflight(req)) {
      const looseSkipped = created.filter((c: any) => c.skipped && /NHẶT LẺ/.test(String(c.reason ?? ''))).length
      const skippedTrips = created.filter((c: any) => c.skipped).length
      const overwrite = toReplaceIds.length + toPreserveIds.length
      const preservedAssigned = created.filter((c: any) => c.preserved_assignment).length
      const awaitingCount = awaitingByGc?.size ?? 0
      return ok(res, buildPreflight({
        unit: 'chuyến', total: byVehicle.size + awaitingCount,
        toInsert: gdoInserts.length + awaitingCount, toUpdate: overwrite + pausedMerges, skipped: skippedTrips,
        extra: [
          ...(preflightExtra ?? []),
          { label: 'Dòng hàng sẽ ghi', value: itemInserts.length },
          ...(awaitingCount ? [{ label: 'Chuyến CHỜ dữ liệu SAP (tạo trước, chưa xuất được)', value: awaitingCount, warn: true }] : []),
          ...(pausedMerges ? [{ label: 'Chuyến TẠM DỪNG sẽ merge thêm hàng', value: pausedMerges, warn: true }] : []),
          ...(overwrite ? [{ label: 'Chuyến GHI ĐÈ kế hoạch cũ', value: overwrite, warn: true }] : []),
          ...(preservedAssigned ? [{ label: 'Trong đó giữ phân công đã gán', value: preservedAssigned }] : []),
          ...(skippedTrips - looseSkipped ? [{ label: 'Bỏ qua (đang xuất / đã hoàn thành)', value: skippedTrips - looseSkipped, warn: true }] : []),
          ...(looseSkipped ? [{ label: 'Bỏ qua (đang GIỮ HÀNG NHẶT LẺ — gỡ trả trên chuyến rồi up lại)', value: looseSkipped, warn: true }] : []),
        ],
      }))
    }

    // ĐÃ QUA VALIDATE → giờ mới được ghi tầng raw của luồng gọi (uploadKhvc: khvc_lines).
    // Trước 03/08 uploadKhvc upsert raw NGAY khi vào hàm: file lỗi validate vẫn ghi đè kế hoạch cũ
    // rồi mới trả 400 — "kiểm trước khi ghi" chỉ đúng ở pha preflight, pha Xác nhận thì không.
    if (beforeWrite) await beforeWrite()

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
      // ⚠️ TỪNG LÀ 1 REQUEST/CHUYẾN, TUẦN TỰ. Vô hại khi nhánh này chỉ ôm vài chuyến "đã gán người",
      // nhưng bản vá 03/08 (giữ nguyên id cho chuyến CHỜ/NGỪNG) đẩy 100% xe trên đường KÍCH HOẠT vào
      // đây ⇒ file 300 xe = 300 round-trip nối tiếp, mỗi request 1 khe pool + 3 câu SQL → chạm trần
      // 60s của Vercel và chết GIỮA CHỪNG (đúng lớp lỗi đã đo ở nhánh "bỏ kế hoạch hàng loạt").
      // Gom theo BỘ GIÁ TRỊ: 1 lượt nạp thường cùng ngày/kho/ĐVVT nên vài nhóm là hết, mỗi nhóm 1 câu.
      // updated_at để NGOÀI khoá gom (mỗi push gọi now() lệch mili-giây thì không nhóm được gì).
      {
        const t = now()
        const byFields = new Map<string, { fields: Record<string, unknown>; ids: string[] }>()
        for (const { id, fields } of preserveGDOUpdates) {
          const { updated_at: _skip, ...rest } = fields as Record<string, unknown>
          const k = JSON.stringify(rest)
          const g = byFields.get(k) ?? { fields: { ...rest, updated_at: t }, ids: [] }
          g.ids.push(id); byFields.set(k, g)
        }
        const tasks = [...byFields.values()].flatMap(({ fields, ids }) =>
          idChunks(ids).map(c => async () => { await supabase.from('GroupDeliveryOrder').update(fields).in('id', c) }))
        for (let i = 0; i < tasks.length; i += 8)   // trần 8: pool PostgREST ~10 khe, bắn hết là tự chặn mình
          await Promise.all(tasks.slice(i, i + 8).map(f => f()))
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

    // Cờ CHỜ DỮ LIỆU: đặt cho xe còn DO thiếu, gỡ cho xe vừa đủ dữ liệu (+ ghi sổ sự kiện)
    const awaitingResult = await applyAwaitingState(req, awaitingByGc ?? new Map(), [...byVehicle.keys()], prevGdoState)

    // KẾ HOẠCH VC tự sinh theo Số xe (chỉ luồng KHVC/SAP — kho không làm SAP vẫn up tay bên TMS như cũ)
    let tmsSync: Awaited<ReturnType<typeof syncTmsPlanFromKhvc>> | null = null
    if (autoLoosePallet) {
      try { tmsSync = await syncTmsPlanFromKhvc(req, allGroupCodes) }
      catch (e) { console.error('[processVehicleGroups] đồng bộ Kế hoạch VC:', e) }
    }

    // TỰ CHỮA khi kế hoạch đổi GIỮA CHỪNG (2 người cùng sửa 1 xe / upload đè lúc người kia thêm DO):
    // so vân tay kế hoạch trước-sau; xe nào đổi thì dội lại đúng xe đó. Không có bước này, chuyến giữ
    // bản kế hoạch cũ vĩnh viễn cho tới lần sửa kế tiếp (đo T2 trước khi vá: 2/24 xe lệch số lượng).
    let healed: Record<string, unknown> | null = null
    if (autoLoosePallet && planFp && planFp.size && healDepth < 2) {
      try {
        const fresh = await fetchAllByIdChunks([...planFp.keys()], chunk => supabase.from('khvc_lines')
          .select('group_code, do_no, export_date, npp, veh_type, dvvt')
          .in('group_code', chunk).neq('sync_status', 'OBSOLETE').order('group_code')) as PlanFpRow[]
        const nowFp = planFingerprints(fresh ?? [])
        const drifted = [...planFp.keys()].filter(gc => (nowFp.get(gc) ?? '') !== (planFp.get(gc) ?? ''))
        if (drifted.length) {
          // jitter: 2 lượt cùng phát hiện lệch thì không lao vào dội lại cùng lúc (thundering herd)
          await new Promise(r => setTimeout(r, 60 + Math.floor(Math.random() * 140)))
          healed = await replanKhvcGroups(req, drifted, healDepth + 1)
        }
      } catch (e) { console.error('[processVehicleGroups] tự chữa lệch kế hoạch:', e) }
    }

    return ok(res, {
      created,
      ...(awaitingResult.awaiting || awaitingResult.cleared || awaitingResult.reopened ? { awaiting: awaitingResult } : {}),
      ...(tmsSync && (tmsSync.created || tmsSync.updated || tmsSync.dropped) ? { tms_plan: tmsSync } : {}),
      ...(healed ? { healed_drift: healed } : {}),
      ...(extraResult ?? {}),
    }, 201)
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
    const wb = readWorkbookSafe(req.file.buffer)
    if (!wb) return fail(res, BAD_EXCEL_MSG, 400)
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

    // ── KÍCH HOẠT chuyến đang CHỜ DỮ LIỆU (user chốt 03/08: "realtime kích hoạt trở lại khi đủ dữ liệu") ──
    // Dữ liệu vừa về → xe nào trong Kế hoạch xuất trỏ tới DO đó mà đang chờ thì derive lại NGAY.
    // Chỉ replan xe THẬT SỰ đang chờ (không quét cả kế hoạch): 1 file VL06O có thể chạm hàng trăm DO.
    let activated: Record<string, unknown> | null = null
    try {
      const khLines = await fetchAllByIdChunks([...fileDos], chunk => supabase.from('khvc_lines')
        .select('group_code').in('do_no', chunk).neq('sync_status', 'OBSOLETE').order('group_code')) as { group_code: string }[]
      const gcs = [...new Set((khLines ?? []).map(l => l.group_code).filter(Boolean))]
      const waiting: string[] = []
      for (let i = 0; i < gcs.length; i += 300) {
        const { data } = await supabase.from('GroupDeliveryOrder').select('group_code')
          .in('group_code', gcs.slice(i, i + 300)).eq('awaiting_sap', true)
        for (const g of ((data ?? []) as { group_code: string }[])) waiting.push(g.group_code)
      }
      // Xe có dòng kế hoạch mà CHƯA hề có chuyến (up KH lúc chưa có VL06O, chuyến vỏ dựng hụt) — cũng derive
      const known = new Set<string>()
      for (let i = 0; i < gcs.length; i += 300) {
        const { data } = await supabase.from('GroupDeliveryOrder').select('group_code').in('group_code', gcs.slice(i, i + 300))
        for (const g of ((data ?? []) as { group_code: string }[])) known.add(g.group_code)
      }
      const target = [...new Set([...waiting, ...gcs.filter(gc => !known.has(gc))])]
      if (target.length) activated = await replanKhvcGroups(req, target)
    } catch (e) { console.error('[uploadVl06o] kích hoạt chuyến chờ:', e) }

    const deliveries = new Set(records.map(r => r.od_number)).size
    // Nhắc khai map SAP→kho: còn dòng chưa map được thì phần đó CHƯA được siết theo kho
    if (sapUnmapped > 0) warnings.push(
      `${sapUnmapped} dòng không xác định được kho từ Plant/Storage Location SAP — khai "Plant SAP" + "Storage Location" cho kho ở Cài đặt WMS → tab Kho để chặn được file của kho khác.`)
    return ok(res, {
      rows: records.length, inserted, updated, noop, obsoleted: removedKeys.length, deliveries, skipped_no_key: skippedNoKey,
      sap_unmapped: sapUnmapped,
      reconcile, reconcile_error, ...(activated ? { activated } : {}),
      warning_count: warnings.length, warnings: warnings.slice(0, 50),
    })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ── Reshape dòng Kế hoạch xuất → byVehicle (row-shape file gộp) — DÙNG CHUNG 2 đường:
// uploadKhvc (upload file) + replanKhvcGroups (CRUD tab Kế hoạch xuất tự dội xuống chuyến, 02/08).
// Số BASE từ VL06O.Actual, tách Thùng+Hộp qua qtySplit. Dòng raw OBSOLETE bị BỎ (luật v2.3 —
// trước 02/08 uploadKhvc quên lọc: DO line SAP đã bỏ vẫn bị cộng lại vào chuyến khi re-up KHVC).
type KhvcPlanRow = {
  group_code: string; do_no: string; npp: string; export_date: unknown
  veh_type: string; dvvt: string; priority: string; cs: string; note: string
}
// DẤU VÂN TAY KẾ HOẠCH của 1 Số xe — dùng để phát hiện "kế hoạch đã đổi TRONG LÚC đang dội xuống".
// Hai người cùng sửa 1 xe (hoặc upload đè trong lúc người kia thêm DO): lượt chạy sau đọc kế hoạch
// TRƯỚC khi lượt kia ghi xong ⇒ chuyến dựng theo bản kế hoạch CŨ và đứng im như vậy (đo T2: 2/24 xe
// lệch số lượng). Kế hoạch trong DB vẫn đúng — chỉ bản dẫn xuất bị cũ, và không có gì tự sửa.
// Chốt: so vân tay TRƯỚC/SAU khi dội; khác nhau ⇒ dội lại đúng những xe đó (có chặn độ sâu).
type PlanFpRow = { group_code: string; do_no: string; export_date?: unknown; npp?: string | null; veh_type?: string | null; dvvt?: string | null }
function planFingerprints(rows: PlanFpRow[]): Map<string, string> {
  const byGc = new Map<string, string[]>()
  for (const r of rows) {
    const gc = String(r.group_code ?? ''); if (!gc) continue
    const a = byGc.get(gc) ?? []
    a.push([String(r.do_no ?? ''), String(parseExcelDate(r.export_date) ?? ''),
            String(r.npp ?? '').trim(), String(r.veh_type ?? '').trim(), String(r.dvvt ?? '').trim()].join('|'))
    byGc.set(gc, a)
  }
  const out = new Map<string, string>()
  for (const [gc, a] of byGc) out.set(gc, a.sort().join('#'))
  return out
}

// Xe còn DO chưa có dữ liệu VL06O → chuyến vẫn được sinh nhưng ở dạng CHỜ (user chốt 03/08).
// Giữ luôn 1 dòng kế hoạch mẫu của xe để dựng được chuyến vỏ khi CHƯA có DO nào có dữ liệu.
export type AwaitingGroup = { dos: string[]; plan: KhvcPlanRow }
async function buildKhvcByVehicle(khvcRows: KhvcPlanRow[]): Promise<{ byVehicle: Map<string, Record<string, any>[]>; missingDos: Set<string>; awaitingByGc: Map<string, AwaitingGroup> }> {
  const allDos = [...new Set(khvcRows.map(k => k.do_no))]
  // Nạp raw VL06O theo DO (.in chunk + phân trang) + Material (category + đơn vị)
  const raws = (await fetchAllByIdChunks(allDos, chunk => supabase.from('erp_outbound_orders')
    .select('od_number, od_item, material_code, qty_base, ship_to_code, ship_to_name, batch, pct_date_req, note_delivery, note_invoice, sync_status')
    .in('od_number', chunk).order('od_number')) as (ErpRawLine & { sync_status?: string | null })[])
    .filter(r => r.sync_status !== 'OBSOLETE')
  const rawByDo = new Map<string, ErpRawLine[]>()
  for (const r of raws) { const l = rawByDo.get(r.od_number) ?? []; l.push(r); rawByDo.set(r.od_number, l) }

  // Tra Material theo ĐÚNG mã có mặt trong raw (luật catalogue-payload) — CRUD 1 dòng kế hoạch
  // không phải kéo cả danh mục 2.7k mã mỗi lần replan; upload lớn cũng chỉ tra mã của file.
  const matCodes = [...new Set(raws.map(r => String(r.material_code ?? '').trim()).filter(Boolean))]
  const allMats = matCodes.length
    ? await fetchAllByIdChunks(matCodes, chunk => supabase.from('Material')
        .select('id, material_code, category, base_unit, entry_unit, units_per_carton')
        .in('material_code', chunk).order('id')) as ({ id: string; material_code: string; category: string | null } & MatUnitsQ)[]
    : []
  const matByCode = new Map(allMats.map(m => [String(m.material_code).trim(), m]))

  const byVehicle = new Map<string, Record<string, any>[]>()
  const missingDos = new Set<string>()
  const awaitingByGc = new Map<string, AwaitingGroup>()
  for (const k of khvcRows) {
    const lines = rawByDo.get(k.do_no)
    if (!lines || !lines.length) {
      missingDos.add(k.do_no)
      const a = awaitingByGc.get(k.group_code) ?? { dos: [], plan: k }
      if (!a.dos.includes(k.do_no)) a.dos.push(k.do_no)
      awaitingByGc.set(k.group_code, a)
      continue
    }
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
  return { byVehicle, missingDos, awaitingByGc }
}

// ── REPLAN từ tab Kế hoạch xuất (user chốt 02/08): Xuất là KẾT QUẢ DẪN XUẤT — sửa/xóa/thêm dòng
// khvc_lines phải TỰ DỘI xuống chuyến, không bắt user up lại file. Gọi từ khvcController sau khi ghi raw.
// Tái dùng NGUYÊN derivation processVehicleGroups (res-facade bắt kết quả thay vì trả HTTP) — không
// chép lại luật gộp NPP/loose/merge-PAUSED. Hành xử per trạng thái chuyến (khớp 5 vùng):
//   PENDING/PAUSED chưa quét → ghi đè/merge như re-upload · ĐANG XUẤT/ĐÃ HT → skip + reconcile_task
//   (không tự đụng chuyến đang chạy — luật "auto chỉ khi chưa đụng") · group hết dòng → xóa chuyến
//   PENDING chưa quét, còn lại → task. Lỗi replan KHÔNG làm hỏng thao tác CRUD gốc (caller bọc try/catch).
export async function replanKhvcGroups(req: Request, groupCodes: string[], healDepth = 0): Promise<Record<string, unknown>> {
  const gcs = [...new Set(groupCodes.map(g => String(g ?? '').trim()).filter(Boolean))]
  if (!gcs.length) return { replanned: 0 }
  const actor = req.user?.name || 'KHVC-EDIT'
  const t = now()

  type KLine = { group_code: string; do_no: string; npp: string | null; veh_type: string | null; dvvt: string | null; priority: string | null; cs: string | null; note: string | null; export_date: string | null; sync_status: string | null }
  const lines = (await fetchAllByIdChunks(gcs, chunk => supabase.from('khvc_lines')
    .select('group_code, do_no, npp, veh_type, dvvt, priority, cs, note, export_date, sync_status')
    .in('group_code', chunk).order('id')) as KLine[])
    .filter(l => (l.sync_status ?? 'ACTIVE') !== 'OBSOLETE')
  const gcWithLines = new Set(lines.map(l => l.group_code))

  const report: Record<string, unknown>[] = []
  const tasks: Record<string, unknown>[] = []
  const mkTask = (gdo: { id: string; group_code: string }, detail: string) => tasks.push({
    id: randomUUID(), gdo_id: gdo.id, group_code: gdo.group_code,
    change_type: 'KHVC_CHANGED', zone: 'Z3', action: 'NEEDS_REVIEW', status: 'OPEN',
    detail, actor, created_at: t, updated_at: t,
  })

  // (a) Group HẾT dòng kế hoạch → chuyến NGỪNG HOẠT ĐỘNG, KHÔNG xóa (user chốt 03/08:
  //     "chuyến hàng đó bên Xuất sẽ không bị xóa mà vào trạng thái không hoạt động, chỉ xem được
  //     info của nó — từ đó xem được lịch sử"). Kế hoạch có lại → applyAwaitingState mở lại.
  //     Tồn giữ chỗ (nhặt lẻ đã soạn) phải NHẢ ngay, không thì kẹt tồn trên một chuyến bất động.
  const events: OutboundEventInput[] = []
  const emptyGcs = gcs.filter(gc => !gcWithLines.has(gc))
  if (emptyGcs.length) {
    const gdos = await fetchAllByIdChunks(emptyGcs, c => supabase.from('GroupDeliveryOrder')
      .select('id, group_code, status, started_at, plan_dropped').in('group_code', c).order('id')) as { id: string; group_code: string; status: string; started_at: string | null; plan_dropped: boolean }[]
    // GOM TRUY VẤN theo LÔ, không lặp từng xe: điều vận bỏ cả ngày là chuyện thật (đo 03/08 —
    // bản lặp từng xe tốn ~0,23s/xe ⇒ 250 xe là chạm trần 60s của Vercel, chết giữa chừng).
    const openOnes = gdos.filter(g => (g.status === 'PENDING' || g.status === 'PAUSED') && !g.plan_dropped)
    for (const g of gdos) {
      if (g.status !== 'PENDING' && g.status !== 'PAUSED') {
        mkTask(g, `Kế hoạch xuất đã XÓA HẾT dòng của chuyến nhưng chuyến đang ${g.status === 'COMPLETED' ? 'ĐÃ HOÀN THÀNH' : 'ĐANG XUẤT'} — chỉ đối soát/xử tay.`)
        report.push({ group_code: g.group_code, action: 'task', reason: g.status })
      } else if (g.plan_dropped) report.push({ group_code: g.group_code, action: 'already_dropped' })
    }
    if (openOnes.length) {
      const allDos = await fetchAllByIdChunks(openOnes.map(g => g.id), c => supabase.from('OutboundDelivery')
        .select('id, gdo_id').in('gdo_id', c).order('id')) as { id: string; gdo_id: string }[]
      const gdoByDo = new Map((allDos ?? []).map(d => [d.id, d.gdo_id]))
      const allItems = allDos.length
        ? await fetchAllByIdChunks(allDos.map(d => d.id), c => supabase.from('OutboundItem')
            .select('do_id, cartons_scanned').in('do_id', c).order('id')) as { do_id: string; cartons_scanned: number }[]
        : []
      const scannedGdos = new Set<string>()
      for (const it of (allItems ?? [])) if (Number(it.cartons_scanned) > 0) {
        const gid = gdoByDo.get(it.do_id); if (gid) scannedGdos.add(gid)
      }
      // Đang GIỮ HÀNG NHẶT LẺ (soạn chưa xác nhận — cartons_scanned chưa tăng nên lọt lưới trên):
      // hàng vật lý đã ở vị trí chờ, KHÔNG tự ngừng + tự nhả (user chốt 05/08) — task để gỡ trả tay.
      const looseHeld = await looseHeldGdoIds(openOnes.map(g => g.id))
      const toDrop = openOnes.filter(g => !scannedGdos.has(g.id) && !looseHeld.has(g.id))
      for (const g of openOnes.filter(g => scannedGdos.has(g.id))) {
        mkTask(g, 'Kế hoạch xuất đã XÓA HẾT dòng của chuyến nhưng chuyến ĐÃ CÓ HÀNG QUÉT — xác nhận trả hàng rồi xử tay (chuyến không tự xóa).')
        report.push({ group_code: g.group_code, action: 'task', reason: 'đã quét' })
      }
      for (const g of openOnes.filter(g => looseHeld.has(g.id) && !scannedGdos.has(g.id))) {
        mkTask(g, 'Kế hoạch xuất đã XÓA HẾT dòng của chuyến nhưng chuyến ĐANG GIỮ HÀNG NHẶT LẺ ở vị trí chờ — gỡ trả hàng nhặt lẻ trên chuyến rồi xử tay (chuyến không tự ngừng).')
        report.push({ group_code: g.group_code, action: 'task', reason: 'đang giữ nhặt lẻ' })
      }
      if (toDrop.length) {
        const dropIds = new Set(toDrop.map(g => g.id))
        const doIds = (allDos ?? []).filter(d => dropIds.has(d.gdo_id)).map(d => d.id)
        await releaseScansForDOs(doIds)   // nhả tồn nhặt lẻ đã giữ chỗ (chuyến bất động không được ôm tồn)
        for (let i = 0; i < toDrop.length; i += 300) {
          await supabase.from('GroupDeliveryOrder')
            .update({ plan_dropped: true, plan_dropped_at: t, awaiting_sap: false, awaiting_dos: null, updated_by: actor, updated_at: t })
            .in('id', toDrop.slice(i, i + 300).map(g => g.id))
        }
        for (const g of toDrop) {
          events.push({ group_code: g.group_code, gdo_id: g.id, event_type: 'PLAN_VEHICLE_DROPPED', source: 'PLAN', actor,
            detail: 'Kế hoạch xuất không còn dòng nào cho Số xe này — chuyến ngừng hoạt động (giữ lại để tra cứu, không xóa)' })
          report.push({ group_code: g.group_code, action: 'plan_dropped', reason: 'kế hoạch không còn dòng nào' })
        }
      }
    }
  }

  // (b) Group còn dòng → re-derive nguyên bộ luật upload (ghi đè PENDING, merge PAUSED, skip đang chạy)
  let derive: Record<string, unknown> | null = null
  const replanGcs = gcs.filter(gc => gcWithLines.has(gc))
  if (replanGcs.length) {
    const khvcRows: KhvcPlanRow[] = lines.filter(l => replanGcs.includes(l.group_code)).map(l => ({
      group_code: l.group_code, do_no: l.do_no, npp: l.npp ?? '', export_date: l.export_date,
      veh_type: l.veh_type ?? '', dvvt: l.dvvt ?? '', priority: l.priority ?? '', cs: l.cs ?? '', note: l.note ?? '',
    }))
    const { byVehicle, missingDos, awaitingByGc } = await buildKhvcByVehicle(khvcRows)
    if (missingDos.size) {
      // DO chưa có trong VL06O: xe dính DO đó KHÔNG dựng dòng hàng (all-or-nothing per chuyến),
      // nhưng vẫn giữ/tạo chuyến ở dạng CHỜ — applyAwaitingState lo phần đó bên trong derive.
      for (const gc of awaitingByGc.keys()) byVehicle.delete(gc)
      report.push({ action: 'awaiting_missing_do', groups: [...awaitingByGc.keys()], missing_dos: [...missingDos] })
    }
    if (byVehicle.size || awaitingByGc.size) {
      // res-facade: bắt status+payload của processVehicleGroups thay vì trả thẳng HTTP.
      // req truyền NGUYÊN (cần req.user cho scope guard); các route CRUD không có ?preflight nên chạy thật.
      const facade = { statusCode: 200, payload: null as unknown, status(c: number) { this.statusCode = c; return this }, json(p: unknown) { this.payload = p; return this } }
      await processVehicleGroups(req, facade as unknown as Response, byVehicle, undefined, undefined, true, undefined, awaitingByGc, undefined, planFingerprints(lines), healDepth)
      derive = { status: facade.statusCode, ...(typeof facade.payload === 'object' && facade.payload ? facade.payload as Record<string, unknown> : { raw: facade.payload }) }
      // Chuyến bị skip (đang xuất/đã hoàn thành) → kế hoạch đổi mà chuyến không nhận được → task.
      // ok() bọc payload {success,data} → created nằm ở data.created
      const pl = facade.payload as { created?: unknown; data?: { created?: unknown } } | null
      const createdArr = ((pl?.data?.created ?? pl?.created ?? []) as { group_code: string; id?: string; skipped?: boolean; reason?: string }[])
      for (const c of createdArr) {
        if (!c.skipped || !c.reason || /phi hàng hóa/.test(c.reason)) continue
        const { data: g } = await supabase.from('GroupDeliveryOrder').select('id, group_code').eq('group_code', c.group_code).maybeSingle()
        if (g) mkTask(g as { id: string; group_code: string }, `Kế hoạch xuất đổi nhưng chuyến ${c.reason} — không tự áp; đối chiếu rồi xử tay (Tạm dừng chuyến rồi sửa lại kế hoạch nếu cần áp).`)
      }
    }
  }

  if (tasks.length) {
    const { error } = await supabase.from('reconcile_tasks').insert(tasks)
    if (error) console.error('[replanKhvcGroups] ghi reconcile_tasks:', error.message)
  }
  await logOutboundEvents(events)
  // Xe bị bỏ khỏi kế hoạch KHÔNG đi qua derive (không có dòng nào) → phải gọi đồng bộ riêng để
  // lệnh vận chuyển ngừng hiệu lực + NHẢ khung giờ cho xe khác (user chốt 03/08).
  let tmsDrop: Awaited<ReturnType<typeof syncTmsPlanFromKhvc>> | null = null
  if (emptyGcs.length) {
    try { tmsDrop = await syncTmsPlanFromKhvc(req, emptyGcs) }
    catch (e) { console.error('[replanKhvcGroups] nhả khung giờ xe bị bỏ:', e) }
  }
  const swept = await sweepOrphanDeliveries([...new Set(lines.map(l => l.do_no).filter(Boolean))])
  return { replanned: replanGcs.length, deleted_or_tasked: report, derive, tasks: tasks.length, ...(tmsDrop ? { tms_plan_drop: tmsDrop } : {}), ...(swept ? { orphan_dos_cleaned: swept } : {}) }
}

// DỌN DO MỒ CÔI (probe 02/08 C5b): replan/upload trên chuyến PENDING = XÓA chuyến cũ rồi TẠO lại.
// Hai lượt chạy song song trên cùng Số xe (2 người bấm "Đổi ngày", hoặc đổi ngày + upload cùng lúc)
// thì lượt B có thể ghi DO gắn vào chuyến mà lượt A vừa xóa → OutboundDelivery trỏ GDO không còn.
// Rác này không hiện ở màn nào (list đi từ chuyến) nhưng vẫn giữ OutboundItem/od_refs → nhiễu đối chiếu SAP.
// Tự chữa: chỉ xóa DO mà GDO của nó KHÔNG CÒN TỒN TẠI (an toàn tuyệt đối — không đụng dữ liệu sống).
async function sweepOrphanDeliveries(doNos: string[]): Promise<number> {
  if (!doNos.length) return 0
  const dos = await fetchAllByIdChunks(doNos, c => supabase.from('OutboundDelivery')
    .select('id, gdo_id').in('delivery_code', c).order('id')) as { id: string; gdo_id: string | null }[]
  if (!dos.length) return 0
  const gdoIds = [...new Set(dos.map(d => d.gdo_id).filter(Boolean) as string[])]
  const alive = new Set<string>()
  for (let i = 0; i < gdoIds.length; i += 300) {
    const { data } = await supabase.from('GroupDeliveryOrder').select('id').in('id', gdoIds.slice(i, i + 300))
    for (const g of ((data ?? []) as { id: string }[])) alive.add(g.id)
  }
  const orphanIds = dos.filter(d => !d.gdo_id || !alive.has(d.gdo_id)).map(d => d.id)
  if (!orphanIds.length) return 0
  console.warn(`[sweepOrphanDeliveries] dọn ${orphanIds.length} DO mồ côi (chuyến đã bị xóa khi replan đua)`)
  const items = await fetchAllByIdChunks(orphanIds, c => supabase.from('OutboundItem')
    .select('id').in('do_id', c).order('id')) as { id: string }[]
  const itemIds = items.map(i => i.id)
  for (let i = 0; i < itemIds.length; i += 300)
    await supabase.from('OutboundScanEntry').delete().in('item_id', itemIds.slice(i, i + 300))
  for (let i = 0; i < orphanIds.length; i += 300) {
    const c = orphanIds.slice(i, i + 300)
    await supabase.from('OutboundItem').delete().in('do_id', c)
    await supabase.from('OutboundDelivery').delete().in('id', c)
  }
  return orphanIds.length
}

// Upload KHVC (kế hoạch điều vận, tự soạn) → JOIN raw VL06O theo DO → reshape về row-shape file gộp
// → processVehicleGroups (tái dùng nguyên logic re-upload). Số lượng = BASE từ VL06O.Actual.
export async function uploadKhvc(req: Request, res: Response) {
  try {
    if (!req.file) return fail(res, 'Không có file upload', 400)
    const wb = readWorkbookSafe(req.file.buffer)
    if (!wb) return fail(res, BAD_EXCEL_MSG, 400)
    const ws = wb.Sheets[wb.SheetNames[0]]   // SHEET ĐẦU TIÊN (chốt user)
    // Trải ô GỘP trước khi đọc: file điều vận hay gộp ô "Số xe" cho nhiều DO của cùng một xe, mà ô
    // gộp chỉ mang giá trị ở dòng đầu ⇒ các DO còn lại mất Số xe và bị bỏ ÂM THẦM ở vòng dưới.
    const mergedFilled = expandMergedCells(ws)
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' })
    if (!rows.length) return fail(res, 'File KHVC trống hoặc không đúng định dạng', 400)

    type KRow = { group_code: string; do_no: string; npp: string; export_date: any; veh_type: string; dvvt: string; priority: string; cs: string; note: string; booking_category: string; raw: Record<string, any> }
    const khvcRows: KRow[] = []
    const allDos = new Set<string>()
    // Dòng BỊ BỎ (thiếu Số xe hoặc DO) phải ĐẾM ĐƯỢC và báo ra, không bỏ im lặng: người nạp đang
    // tin cả file đã vào. Số dòng Excel = index + 2 (1 dòng tiêu đề, đếm từ 1) để chỉ đúng chỗ sửa.
    const droppedRows: string[] = []
    // Trùng (Số xe, DO) NGAY TRONG FILE: upsert 2 dòng cùng khóa trong MỘT câu → Postgres 21000
    // ("ON CONFLICT ... cannot affect row a second time") ⇒ kiểm-trước XANH rồi bấm Xác nhận ăn 500.
    // Và kể cả không nổ thì dòng lặp cũng bị cộng số lượng HAI LẦN vào chuyến. Theo chuẩn upload của
    // dự án: tự GỘP (dòng sau thắng) + cảnh báo, chứ không chặn cả file.
    const byKey = new Map<string, KRow>()       // `${gc}__${do}` → dòng (lần sau ĐÈ lần trước)
    const dupKeys: string[] = []
    for (const [idx, r] of rows.entries()) {
      const gc = String(r['Số xe'] ?? r['So xe'] ?? '').trim()
      const doNo = String(r['DO'] ?? r['Delivery'] ?? '').trim()
      if (!gc || !doNo) {
        // dòng trống hoàn toàn (Excel hay để dòng thừa cuối bảng) thì bỏ qua im lặng, không báo oan
        if (Object.values(r).some(v => String(v ?? '').trim())) droppedRows.push(
          `dòng ${idx + 2}${gc ? ` (Số xe ${gc}, thiếu DO)` : doNo ? ` (DO ${doNo}, thiếu Số xe)` : ''}`)
        continue
      }
      allDos.add(doNo)
      const key = `${gc}__${doNo}`
      if (byKey.has(key)) dupKeys.push(`${gc}/${doNo}`)
      byKey.set(key, {
        group_code: gc, do_no: doNo,
        npp: String(r['Tên NPP'] ?? '').trim(),
        export_date: r['Ngày xuất'],
        veh_type: String(r['Loại xe'] ?? '').trim(),
        dvvt: String(r['DVVT'] ?? '').trim(),
        priority: String(r['Ưu tiên'] ?? r['Uu tien'] ?? '').trim(),
        cs: String(r['CS phụ trách'] ?? r['CS phu trach'] ?? '').trim(),
        note: String(r['Note'] ?? r['Ghi chú'] ?? '').trim(),
        // CỬA đặt lịch (user chốt 03/08) — 1 Số xe chỉ 1 giá trị, validate ngay dưới.
        // Nhận cả biến thể tiêu đề hay gặp: có dấu * (đánh dấu bắt buộc), không dấu tiếng Việt.
        booking_category: String(r['Loại kho booking'] ?? r['Loại kho booking *'] ?? r['Loai kho booking']
          ?? r['Loai kho booking *'] ?? r['Cửa booking'] ?? r['Cua booking'] ?? '').trim(),
        raw: r,
      })
    }
    khvcRows.push(...byKey.values())
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
      // VL06O đồng bộ lần cuối lúc nào (DO thiếu tính ở dưới, theo ĐÚNG luật derive — lọc dòng OBSOLETE)
      const rawDos = await fetchAllByIdChunks([...allDos], chunk => supabase.from('erp_outbound_orders')
        .select('od_number, updated_at').in('od_number', chunk).order('od_number')) as { od_number: string; updated_at: string }[]
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
        // 3 ô dưới là các thứ TRƯỚC ĐÂY XẢY RA ÂM THẦM — người nạp không có cách nào biết
        ...(mergedFilled ? [{ label: 'Ô GỘP đã trải ra', value: `${mergedFilled} ô (giữ nguyên file gốc)` }] : []),
        ...(droppedRows.length ? [{ label: 'Dòng BỊ BỎ (thiếu Số xe/DO)',
          value: `${droppedRows.length}: ${droppedRows.slice(0, 3).join(' · ')}${droppedRows.length > 3 ? '…' : ''}`, warn: true }] : []),
        ...(dupKeys.length ? [{ label: 'Dòng TRÙNG (Số xe + DO) đã gộp',
          value: `${dupKeys.length}: ${dupKeys.slice(0, 3).join(' · ')}${dupKeys.length > 3 ? '…' : ''}`, warn: true }] : []),
        { label: 'VL06O đồng bộ lúc', value: lastSynced
            ? new Date(lastSynced).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false })
            : 'CHƯA có dữ liệu raw', warn: !lastSynced },
        ...(trips.total ? [{ label: 'Số xe trong file ĐÃ có chuyến', value: trips.total, warn: true }] : []),
        ...(trips.in_progress ? [{ label: 'Trong đó ĐANG XUẤT (sẽ bỏ qua)', value: trips.in_progress, warn: true }] : []),
        ...(trips.completed ? [{ label: 'Trong đó ĐÃ HOÀN THÀNH (sẽ bỏ qua)', value: trips.completed, warn: true }] : []),
        // (DO chưa có trong VL06O tính Ở DƯỚI theo đúng luật derive — lọc dòng OBSOLETE)
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

    // ── LOẠI KHO BOOKING: bắt buộc + 1 Số xe CHỈ 1 loại (user chốt 03/08 "làm khóa cứng") ──
    // Xe chở lẫn FG01+PM01+FG02 chỉ đậu MỘT cửa; để picker gộp khung của mọi loại xe chở = nguy cơ
    // đặt SAI CỬA. Cửa KHÔNG suy diễn được (không phải cứ loại hạng cao nhất — có xe giữ nốt FG02),
    // nên kế hoạch phải KHAI. Gác ALL-OR-NOTHING và gác TRƯỚC khi ghi raw: file sai thì không được
    // để lại nửa vời (cùng lý do khối scope kho ở trên).
    //
    // BÁO LỖI THEO TỪNG SỐ XE, đi qua ĐÚNG khuôn báo cáo "kiểm trước khi ghi" (user 03/08: một dòng
    // chữ dài gộp hết vấn đề thì không đọc được) → dialog hiện BẢNG "Ở đâu · Vấn đề" + chip lọc +
    // tải lỗi ra Excel như mọi upload khác. Trả `fail()` chuỗi ở đây là ĐI TẮT qua khuôn đó.
    // Dòng ĐANG CÓ của các Số xe trong file — nạp SỚM (trước khối gác) để dùng cho CẢ 2 việc:
    // (a) gác "file khai cửa khác dòng cũ còn lại" ngay ở pha kiểm-trước, (b) giữ id cũ khi upsert.
    // Nạp 1 lần dùng 2 chỗ — đừng hỏi DB hai lượt cho cùng một tập dòng.
    const khActor = req.user?.name || null
    const khGcs = [...new Set(khvcRows.map(k => k.group_code))]
    const priorKh = await fetchAllByIdChunks(khGcs, chunk => supabase.from('khvc_lines')
      .select('id, group_code, do_no, booking_category, sync_status').in('group_code', chunk)
      .order('id')) as { id: string; group_code: string; do_no: string; booking_category: string | null; sync_status: string | null }[]
    const khIdByKey = new Map((priorKh ?? []).map(k => [`${k.group_code}__${k.do_no}`, k.id]))

    {
      const { data: whTypeRows } = await supabase.from('LookupValue').select('value').eq('type', 'warehouse_type')
      const validByUpper = new Map(((whTypeRows ?? []) as { value: string }[])
        .map(v => [String(v.value).trim().toUpperCase(), String(v.value).trim()]))
      const hopLe = [...validByUpper.values()].join(' · ')
      const allGcs = new Set(khvcRows.map(k => k.group_code))
      const byGc = new Map<string, Set<string>>()
      const blankGcs = new Set<string>()
      for (const k of khvcRows) {
        if (!k.booking_category) { blankGcs.add(k.group_code); continue }
        const set = byGc.get(k.group_code) ?? new Set<string>()
        set.add(k.booking_category.toUpperCase())
        byGc.set(k.group_code, set)
      }
      // 1 dòng lỗi = 1 (Số xe · vấn đề) để lên bảng; giữ đúng quy ước "<ở đâu> — <vấn đề>"
      const perGc = new Map<string, string[]>()
      const addErr = (gc: string, msg: string) => perGc.set(gc, [...(perGc.get(gc) ?? []), msg])
      for (const gc of blankGcs)
        if (!byGc.has(gc)) addErr(gc, `thiếu "Loại kho booking" (bắt buộc) — hợp lệ: ${hopLe}`)
        else addErr(gc, `có dòng bỏ trống "Loại kho booking" — mọi dòng của 1 Số xe phải cùng 1 loại`)
      for (const [gc, s] of byGc) {
        if (s.size > 1) addErr(gc, `khai ${s.size} loại kho booking khác nhau (${[...s].join(' + ')}) — 1 Số xe chỉ được 1 loại (xe chỉ đậu 1 cửa)`)
        for (const v of s) {
          if (!validByUpper.has(v)) addErr(gc, `Loại kho booking "${v}" không có trong danh mục — hợp lệ: ${hopLe}`)
          else if (!categoryAllowed(req, validByUpper.get(v)!)) addErr(gc, `Loại kho booking "${validByUpper.get(v)}" ngoài phạm vi loại kho của bạn`)
        }
      }
      // ⭐ File chỉ chứa MỘT PHẦN số DO của xe: dòng cũ KHÔNG có trong file vẫn ở lại với cửa cũ,
      // nên "trong file thống nhất" CHƯA đủ — trạng thái SAU KHI GHI mới là thứ phải hợp lệ.
      // Thiếu phép gác này thì kiểm-trước báo xanh, user bấm Xác nhận rồi ăn 500 từ trigger DB
      // (đo thật 04/08: preflight will_write=2 → ghi thật HTTP 500 "Lỗi hệ thống") — vừa mất niềm
      // tin vào pha kiểm-trước, vừa đẩy 5xx vào telemetry mà không ai biết vì sao.
      const fileKeys = new Set(khvcRows.map(k => `${k.group_code}__${k.do_no}`))
      const survivorCat = new Map<string, { cat: string; do_no: string }>()
      for (const p of (priorKh ?? [])) {
        if (p.sync_status === 'OBSOLETE' || !p.booking_category) continue
        if (fileKeys.has(`${p.group_code}__${p.do_no}`)) continue          // dòng này sẽ bị file ghi đè
        if (!survivorCat.has(p.group_code)) survivorCat.set(p.group_code, { cat: p.booking_category, do_no: p.do_no })
      }
      for (const [gc, s] of byGc) {
        const old = survivorCat.get(gc)
        if (!old || s.size !== 1) continue                                 // sai kiểu khác đã báo ở trên
        const fileCat = validByUpper.get([...s][0]) ?? [...s][0]
        if (fileCat !== old.cat)
          addErr(gc, `file khai cửa "${fileCat}" nhưng xe đang có DO ${old.do_no} ở cửa "${old.cat}" (không nằm trong file) `
            + `— 1 Số xe chỉ 1 cửa: đưa đủ DO của xe vào file, hoặc đổi cửa ở tab "Kế hoạch xuất" trước`)
      }

      // ⭐ UPLOAD LÀ CỬA GHI THỨ 6 — 5 cửa kia (thêm dòng / sửa dòng / đổi ngày lẻ / đổi ngày hàng
      // loạt / đặt lịch) đều đã chặn "xe đang GIỮ khung giờ mà đổi cửa hoặc đổi ngày", riêng file thì
      // không ⇒ nạp lại file là dựng đúng cái trạng thái vừa cấm: xe đậu khung của cửa/ngày khác.
      // Cùng ngữ nghĩa: CHẶN + bắt nhả khung trước, KHÔNG tự nhả hộ.
      {
        const heldByGc = await heldSlotsByVehicle([...allGcs])
        const dateByGc = new Map<string, string>()
        for (const k of khvcRows) {
          const d = parseExcelDate(k.export_date)
          if (d && !dateByGc.has(k.group_code)) dateByGc.set(k.group_code, d)
        }
        for (const gc of allGcs) {
          const held = heldByGc.get(gc); if (!held?.length) continue
          const s = byGc.get(gc)
          if (s?.size === 1) {
            const fileCat = validByUpper.get([...s][0]) ?? [...s][0]
            const msg = slotHeldBlockingCategory(held, fileCat)
            if (msg) addErr(gc, `file khai cửa "${fileCat}" nhưng ${msg}`)
          }
          const fileDate = dateByGc.get(gc)
          if (fileDate) {
            const msg = slotHeldBlockingDate(held, fileDate)
            if (msg) addErr(gc, msg)
          }
        }
      }
      if (perGc.size) {
        // Cả file trống cột → 1 dòng chẩn đoán thay vì N dòng giống nhau (file trăm xe đọc không nổi)
        const thieuHet = blankGcs.size === allGcs.size
        const errors = thieuHet
          ? [`Toàn bộ file — không có cột "Loại kho booking" (hoặc để trống hết). Tải lại mẫu ở nút "Up KH điều vận"; hợp lệ: ${hopLe}`]
          : [...perGc].flatMap(([gc, msgs]) => msgs.map(m => `Số xe ${gc} — ${m}`))
        if (isPreflight(req)) return ok(res, buildPreflight({
          unit: 'chuyến', total: allGcs.size, errors, extra: preflightExtra,
        }))
        return res.status(400).json({
          success: false,
          error: { code: 'BOOKING_CATEGORY_INVALID',
            message: thieuHet
              ? `File thiếu cột "Loại kho booking" — không upload`
              : `File có ${perGc.size} Số xe khai sai "Loại kho booking" — không upload` },
          validation_errors: [...perGc].map(([group_code, errs]) => ({ group_code, errors: errs })),
        })
      }
      // Chuẩn hoá về đúng chữ trong danh mục (file gõ 'fg01' vẫn nhận, lưu 'FG01')
      for (const k of khvcRows) k.booking_category = validByUpper.get(k.booking_category.toUpperCase()) ?? k.booking_category
    }

    // ── Lưu TẦNG RAW "Kế hoạch xuất" (khvc_lines) — giữ lại kế hoạch để xem/đối chiếu/up lại ──
    // Churn-safe: (group_code, do_no)→id nạp Ở TRÊN (cùng lượt với gác cửa), GIỮ id cũ khi up lại
    // (không đổi PK). Upsert chunk 500.
    const khNow = now()
    const khvcRecords = khvcRows.map(k => ({
      id: khIdByKey.get(`${k.group_code}__${k.do_no}`) ?? randomUUID(),
      group_code: k.group_code, do_no: k.do_no,
      warehouse_code: k.group_code.split('_')[0] || null,
      npp: k.npp || null, veh_type: k.veh_type || null, dvvt: k.dvvt || null,
      priority: k.priority || null, cs: k.cs || null, note: k.note || null,
      booking_category: k.booking_category || null,
      export_date: parseExcelDate(k.export_date), source: 'EXCEL', sync_status: 'ACTIVE',
      raw: k.raw, uploaded_by: khActor, updated_at: khNow, manual_edited_at: null,   // upload đè lại → gỡ cờ sửa tay
    }))
    // Ghi tầng raw để processVehicleGroups gọi SAU khi validate xong (kiểm trước khi ghi).
    // PREFLIGHT thì không ghi gì cả → toàn nhánh kiểm-trước sạch 100%, phần dưới chỉ ĐỌC.
    const writeKhvcRaw = async () => {
      if (isPreflight(req)) return
      for (let i = 0; i < khvcRecords.length; i += 500) {
        const { error } = await supabase.from('khvc_lines').upsert(khvcRecords.slice(i, i + 500), { onConflict: 'group_code,do_no' })
        if (error) throw new Error(error.message)
      }
    }

    const { byVehicle, missingDos, awaitingByGc } = await buildKhvcByVehicle(khvcRows)

    // DO chưa có trong VL06O KHÔNG còn chặn file (user chốt 03/08): điều vận nạp kế hoạch TRƯỚC,
    // kho up VL06O sau. Xe thiếu dữ liệu vẫn sinh chuyến nhưng ở dạng CHỜ — không xuất được cho tới
    // khi dữ liệu về (rồi tự kích hoạt). Trước đây chặn cả file nên điều vận không nạp được gì.
    if (!byVehicle.size && !awaitingByGc.size) return fail(res, 'Không có dữ liệu hợp lệ trong KHVC', 400)
    // ALL-OR-NOTHING PER XE: xe còn DO thiếu dữ liệu thì KHÔNG dựng dòng hàng phần đã biết —
    // chuyến chờ là VỎ. Thiếu dòng này, cùng một file upload lại cho ra trạng thái KHÁC đường sửa
    // kế hoạch (replan đã lọc): chuyến chờ có hàng một nửa, trông như kế hoạch đủ (đo T1 case 2e).
    for (const gc of awaitingByGc.keys()) byVehicle.delete(gc)
    if (missingDos.size) preflightExtra.push({ label: 'DO chưa có trong VL06O (chuyến sẽ CHỜ dữ liệu)',
      value: `${missingDos.size}: ${[...missingDos].slice(0, 5).join(', ')}${missingDos.size > 5 ? '…' : ''}`, warn: true })

    // KHVC/SAP → nhặt lẻ auto theo pallet; preflightExtra = số liệu rủi ro tính ở trên (nếu đang kiểm trước)
    return await processVehicleGroups(req, res, byVehicle, undefined, undefined, true, preflightExtra, awaitingByGc, writeKhvcRaw, planFingerprints(khvcRows))
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
      itemOfGdo(itemId, gdoId, 'material_id'),
      supabase.from('GroupDeliveryOrder').select('warehouse_id').eq('id', gdoId).single(),
    ])
    if (!inScope(req, gdoRes.data?.warehouse_id)) return fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403)
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
type FefoSuggestion = { location_code: string | null; pct_date: number | null; available: number; rot_date: string | null }
// Hạng nhặt của từng khu, khoá `${warehouse_id}|${sub_code}` — 1 câu cho cả danh sách kho.
// Cùng nguồn với trang Tối ưu vị trí và với chiến thuật cất hàng ABC (WarehouseZone.pick_rank),
// nên "gần cửa" ở hai luồng nhập/xuất là CÙNG một định nghĩa, không phải hai bản chép tay.
async function pickRankByZone(warehouseIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (!warehouseIds.length) return map
  const rows = await fetchAllByIdChunks(warehouseIds, chunk => supabase.from('WarehouseZone')
    .select('warehouse_id, code, pick_rank').in('warehouse_id', chunk).eq('is_active', true)) as unknown as
    { warehouse_id: string; code: string; pick_rank: number | null }[]
  for (const z of rows) if (z.pick_rank != null) map.set(`${z.warehouse_id}|${z.code}`, Number(z.pick_rank))
  return map
}

async function rotationSuggestionsByMaterial(
  matIds: string[], warehouseIds: string[], rotCfg: RotationResolver,
): Promise<Map<string, FefoSuggestion[]>> {
  const out = new Map<string, FefoSuggestion[]>()
  if (!matIds.length) return out
  const useWhFilter = warehouseIds.length > 0
  const entryChunks = await Promise.all(
    Array.from({ length: Math.ceil(matIds.length / 200) }, (_, ci) => matIds.slice(ci * 200, ci * 200 + 200)).map(chunk =>
      fetchAllRowsParallel(() => {
        let q = supabase.from('InventoryEntry')
          // `category` = khóa chọn chiến thuật tầng 2 (mỗi loại kho có thể chạy nguyên tắc riêng)
          .select(`material_id, qa_status_id, cartons_remaining, cartons_imported, cartons_reserved, production_date, expiry_date, ncc_id, shelf_life_days, location:Location${useWhFilter ? '!inner' : ''}(location_code, warehouse_id, sub_code), material:Material!material_id(category, shelf_life_days, supplier_shelf_life_overrides)`)
          .in('material_id', chunk)
          .in('status', [...PICKABLE_STATUSES])
          // Pallet bị QA GIỮ thì lúc quét bị chặn thẳng ⇒ gợi ý mà còn liệt kê là đẩy người ta đi tới
          // nơi rồi mới biết không lấy được (lỗi thật, vá 14/08). Lọc ở DB cho nhẹ, JS kiểm lại bằng
          // isPickEligible để luật chỉ có MỘT bản.
          .is('qa_status_id', null)
          .gt('cartons_remaining', 0) // bỏ pallet tồn=0 từ DB (JS bên dưới cũng skip, filter sớm đỡ kéo hàng chục nghìn dòng chết)
          .order('id')
        if (useWhFilter) q = q.in('location.warehouse_id', warehouseIds)
        return q
      })
    )
  )
  const entries = entryChunks.flat() as Array<RotationEntry & {
    material_id: string
    location: { location_code: string | null; warehouse_id: string | null; sub_code: string | null } | null
    material: (MaterialShelfInfo & { category?: string | null }) | null
  }>
  // HẠNG NHẶT của khu = khu đó gần cửa xuất tới đâu (1 = gần nhất). Kho đã xếp hạng ở trang Tối ưu
  // vị trí và luồng CẤT hàng đã dùng (chiến thuật ABC), nhưng luồng LẤY hàng thì chưa đọc dòng nào:
  // hoà ngày là xếp theo TÊN vị trí (alphabet) — người nhặt bị đẩy sang khu xa trong khi khu gần
  // cũng có đúng ngày đó. Chỉ dùng làm TIE-BREAK: nguyên tắc luân chuyển (FEFO/FIFO/LIFO) vẫn
  // đứng trước, không bao giờ vì gần cửa mà lấy sai thứ tự.
  const rankByZone = await pickRankByZone([...new Set(entries.map(e => e.location?.warehouse_id).filter((x): x is string => !!x))])
  const nowMs = Date.now()
  type Agg = FefoSuggestion & { rot_key: number | null; pick_rank: number }
  const byMat = new Map<string, Map<string, Agg>>()
  for (const e of (entries ?? [])) {
    if (!isPickEligible(e)) continue
    const principle = rotCfg.of(e.location?.warehouse_id, e.material?.category).principle
    const pctRaw = computePctDate(e, e.material, nowMs)   // ưu tiên HSD tường minh (tem V2)
    const pct_date: number | null = pctRaw == null ? null : Math.round(pctRaw)
    const rot_key  = rotationSortKey(e, e.material, principle)
    const rot_date = rotationDateOf(e, e.material, principle)
    const loc = e.location?.location_code ?? '(chưa xác định)'
    // Khu chưa xếp hạng → đẩy xuống cuối nhóm cùng ngày (không có thông tin thì không ưu ái)
    const pick_rank = rankByZone.get(`${e.location?.warehouse_id ?? ''}|${e.location?.sub_code ?? ''}`) ?? Number.MAX_SAFE_INTEGER
    const k = `${rot_key ?? 'n'}|${loc}`
    const locMap = byMat.get(e.material_id) ?? new Map<string, Agg>()
    const cur = locMap.get(k) ?? { location_code: loc, pct_date, available: 0, rot_date, rot_key, pick_rank }
    cur.available += Number(e.cartons_remaining ?? e.cartons_imported ?? 0) - Number(e.cartons_reserved ?? 0)
    locMap.set(k, cur)
    byMat.set(e.material_id, locMap)
  }
  for (const [matId, locMap] of byMat) {
    // Thứ tự = ĐÚNG nguyên tắc luân chuyển của kho (không còn cứng %Date). Hòa ngày → KHU GẦN CỬA
    // XUẤT trước (hạng nhặt, 17/08) → vị trí ÍT hàng nhất (dọn hàng lẻ trước) → tên vị trí.
    // Hạng nhặt đứng SAU rot_key: đi ít bước là để nhanh, không bao giờ đổi được thứ tự lấy hàng.
    out.set(matId, [...locMap.values()].sort((a, b) => {
      const ka = a.rot_key ?? Infinity, kb = b.rot_key ?? Infinity
      if (ka !== kb) return ka - kb
      if (a.pick_rank !== b.pick_rank) return a.pick_rank - b.pick_rank
      if (a.available !== b.available) return a.available - b.available
      return (a.location_code ?? '').localeCompare(b.location_code ?? '')
    }).map(({ rot_key: _k, pick_rank: _r, ...rest }) => rest))
  }
  return out
}

// Cấu hình luân chuyển 2 TẦNG của các kho — mặc định kho + override theo LOẠI KHO (21/08).
// Trả về HÀM tra thay vì Map thô: nguyên tắc bây giờ phụ thuộc (kho, loại kho của MÃ HÀNG), caller
// mà tự ghép lại từ hai map là đúng đường đẻ ra bản luật chép tay thứ hai.
// 2 câu cho CẢ danh sách kho (không phải mỗi kho một câu).
interface RotationResolver {
  of: (warehouseId: string | null | undefined, category: string | null | undefined) => RotationConfig
}
async function rotationConfigOf(warehouseIds: string[]): Promise<RotationResolver> {
  const whById = new Map<string, Record<string, unknown>>()
  const typesByWh = new Map<string, WhTypeConfigRow[]>()
  const ids = [...new Set(warehouseIds.filter(Boolean))]
  const FALLBACK: RotationConfig = { principle: asRotationPrinciple(null), required: false, source: 'WAREHOUSE' }
  if (!ids.length) return { of: () => FALLBACK }

  const [whs, cfgs] = await Promise.all([
    fetchAllByIdChunks(ids, chunk => supabase.from('Warehouse')
      .select('id, rotation_principle, rotation_required').in('id', chunk).order('id')),
    fetchAllByIdChunks(ids, chunk => supabase.from('warehouse_type_configs')
      .select('warehouse_id, type_code, rotation_principle, rotation_required')
      .in('warehouse_id', chunk).order('warehouse_id')),
  ])
  for (const w of ((whs ?? []) as ({ id: string } & Record<string, unknown>)[])) whById.set(w.id, w)
  for (const c of ((cfgs ?? []) as ({ warehouse_id: string } & WhTypeConfigRow)[])) {
    const arr = typesByWh.get(c.warehouse_id) ?? []
    arr.push(c)
    typesByWh.set(c.warehouse_id, arr)
  }
  return {
    of: (warehouseId, category) => {
      const wh = warehouseId ? whById.get(warehouseId) : null
      if (!wh) return FALLBACK
      return resolveRotation(wh, typesByWh.get(warehouseId ?? '') ?? [], category ?? null)
    },
  }
}

// KIỂM LUÂN CHUYỂN của 1 lượt quét — dùng CHUNG cho preview (checkScanItem) và ghi (scanItem),
// nên hai màn không bao giờ nói hai chuyện khác nhau như trước 14/08.
// Kéo pallet cùng mã trong CÙNG kho rồi so bằng helper: đo trên staging (material, kho) trung bình
// 27 pallet, p95 135 ⇒ thường 1 request. KHÔNG dùng order+limit(1) của SQL được vì HSD hiệu lực
// phải suy từ shelf-life theo LÔ/NCC — DB không biết luật đó (và chép luật xuống SQL = đẻ bản thứ 2).
async function rotationCheckOf(args: {
  entry: RotationEntry; material: MaterialShelfInfo | null; materialId: string | null
  warehouseId: string | null; principle: RotationPrinciple; required: boolean
  source?: 'WAREHOUSE' | 'TYPE'
  // %Date tối thiểu ĐƠN yêu cầu (item.date_required): pallet dưới ngưỡng KHÔNG xuất được cho đơn
  // này (bị chặn 400 ở check %Date) nên không được đề cử làm "pallet phải lấy trước" — nếu không,
  // đơn đòi date cao ở kho bật "bắt buộc" sẽ KẸT: mọi pallet đạt yêu cầu đều "sai thứ tự" so với
  // pallet không đạt (cùng lớp lỗi "gợi ý chỉ vào pallet không lấy được" ở đầu utils/rotation.ts,
  // đã fix cho QA-giữ, sót ca này — user hỏi trúng 25/08).
  minPctDate?: number
}): Promise<RotationCheck> {
  const { entry, material, materialId, warehouseId, principle, required } = args
  const minPct = Number(args.minPctDate ?? 0)
  const base: RotationCheck = {
    principle, required, source: args.source ?? 'WAREHOUSE',
    violation: false, date_label: ROTATION_DATE_LABEL[principle],
    scanned_date: rotationDateOf(entry, material, principle),
    best_date: null, best_pallet_code: null, best_location_code: null,
  }
  if (!materialId || !warehouseId) return base

  const rows = await fetchAllRowsParallel(() => supabase.from('InventoryEntry')
    .select('pallet_code, qa_status_id, cartons_remaining, cartons_imported, cartons_reserved, production_date, expiry_date, ncc_id, shelf_life_days, location:Location!inner(location_code, warehouse_id)')
    .eq('material_id', materialId)
    .eq('location.warehouse_id', warehouseId)
    .in('status', [...PICKABLE_STATUSES])
    .is('qa_status_id', null)
    .gt('cartons_remaining', 0)
    .order('id')) as Array<RotationEntry & { pallet_code: string | null; location: { location_code: string | null } | null }>

  let best: (typeof rows)[number] | null = null
  let bestKey: number | null = null
  for (const r of rows) {
    if (!isPickEligible(r)) continue
    // Đơn có yêu cầu %Date: pallet dưới ngưỡng (hoặc không tính được %Date) sẽ bị chặn lúc quét
    // cho đơn này → loại khỏi tập so sánh, "pallet tốt nhất" = tốt nhất TRONG SỐ lấy được.
    if (minPct > 0) {
      const pct = computePctDate(r, material)
      if (pct == null || pct < minPct) continue
    }
    const k = rotationSortKey(r, material, principle)
    if (k == null) continue
    if (bestKey == null || k < bestKey) { bestKey = k; best = r }
  }
  if (!best) return base

  const scannedKey = rotationSortKey(entry, material, principle)
  return {
    ...base,
    violation: isRotationViolation(scannedKey, bestKey),
    best_date: rotationDateOf(best, material, principle),
    best_pallet_code: best.pallet_code ?? null,
    best_location_code: best.location?.location_code ?? null,
  }
}

// Quyền duyệt lấy khác thứ tự — kiểm TRONG controller vì route /scan gate bằng outbound.scan
// (người quét bình thường vẫn phải vào được), quyền này chỉ mở thêm cửa vượt rào.
const canRotationOverride = (req: Request): boolean =>
  req.user?.is_superadmin === true ||
  (req.user?.module_permissions ?? {})['outbound']?.includes('rotation_override') === true

// Quyền duyệt CẤT khác quy tắc — dùng chung một quyền cho cả app (`inbound.putaway_override`,
// xem inventoryController): nó là một NĂNG LỰC ("được cất lệch luật"), không phải một cái nút.
const canPutawayOverride = (req: Request): boolean =>
  req.user?.is_superadmin === true ||
  (req.user?.module_permissions ?? {})['inbound']?.includes('putaway_override') === true

// Thông báo chặn khi kho bật "bắt buộc" — nói rõ pallet nào nên lấy + lấy ở đâu, để người quét
// còn đi lấy được, thay vì chỉ bị từ chối.
function rotationBlockMessage(r: RotationCheck): string {
  const where = r.best_location_code ? ` tại ${r.best_location_code}` : ''
  const what  = r.best_pallet_code ? ` (pallet ${r.best_pallet_code})` : ''
  return `Kho yêu cầu lấy đúng ${ROTATION_LABEL[r.principle]}. Còn hàng ${r.date_label} ${r.best_date ?? '—'}${what}${where} phải đi trước.`
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
    const whIds = gdo.warehouse_id ? [gdo.warehouse_id] : []
    const sugByMat = await rotationSuggestionsByMaterial(matIds, whIds, await rotationConfigOf(whIds))
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
      suggestions: FefoSuggestion[]
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

    // Gợi ý vị trí lấy — helper dùng chung với cột "Vị trí lấy" trang chi tiết đơn, sắp theo
    // nguyên tắc luân chuyển của TỪNG kho (board có thể gom nhiều kho).
    const matIds = [...new Set([...rowMap.values()].map(r => r.material_id).filter(Boolean))] as string[]
    const sugByMat = await rotationSuggestionsByMaterial(matIds, warehouseIds, await rotationConfigOf(warehouseIds))
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

// ─── STT chuẩn bị theo booking khung giờ (user chốt 24/08) ───
// Số DẪN XUẤT (không lưu cột): RPC booking_sequence đánh ROW_NUMBER theo
// (kho, ngày, chiều) sort (khung giờ, giờ đặt) — đổi/hủy booking là số tự cập nhật.
// Read-only, gate outbound view|prepare; kho cắt theo scope như getPrepareBoard.
export async function getBookingSequence(req: Request, res: Response) {
  try {
    const dateFrom = typeof req.query.date_from === 'string' ? req.query.date_from : ''
    const dateTo   = typeof req.query.date_to === 'string' && req.query.date_to ? req.query.date_to : dateFrom
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      return fail(res, 'Thiếu hoặc sai khoảng ngày (date_from/date_to dạng YYYY-MM-DD)', 400)
    }
    // Chặn khoảng vô lý (fuzz 1900→9999) — list Xuất kho lấy range từ trang hiện tại nên ≤ vài tháng
    const spanDays = (new Date(`${dateTo}T00:00:00Z`).getTime() - new Date(`${dateFrom}T00:00:00Z`).getTime()) / 86_400_000
    if (spanDays < 0 || spanDays > 190) return fail(res, 'Khoảng ngày tối đa 190 ngày', 400)
    const scope = req.user?.warehouse_scope !== 'NATIONAL' ? (req.user?.warehouse_ids ?? []) : null
    const whParam = typeof req.query.warehouse_id === 'string' && req.query.warehouse_id ? req.query.warehouse_id : null
    if (whParam && scope && !scope.includes(whParam)) {
      return fail(res, 'Ngoài phạm vi kho được giao — không thể xem thứ tự booking của kho này', 403)
    }
    const whIds = whParam ? [whParam] : scope   // null = NATIONAL không lọc kho
    if (whIds && whIds.length === 0) return ok(res, [])
    const { data, error } = await supabase.rpc('booking_sequence', {
      p_warehouse_ids: whIds, p_from: dateFrom, p_to: dateTo,
    })
    if (error) throw error
    return ok(res, data ?? [])
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

/**
 * QUÉT NHẦM MÃ — thông báo phải nói MÃ HÀNG + TÊN, KHÔNG in id nội bộ.
 *
 * Bug thật (đo 06/09): hai nhánh quét xuất trả `pallet "904ac939-fbd6-…" không khớp với phiếu
 * "a431693b-b5b0-…"` — người quét cầm máy PDA đọc hai dãy uuid thì không biết mình vừa lấy hàng
 * gì và dòng hàng đang cần gì, trong khi màn NHẬP kho từ lâu đã nói tử tế
 * (`QR có "510000084" (KUN STC Hương Cam …) nhưng phiếu nhập yêu cầu "510000364"`).
 * Tra tên chỉ chạy trên ĐƯỜNG LỖI (hiếm) nên không thêm chi phí cho lượt quét bình thường.
 */
async function materialMismatchFail(
  res: Response, qr: string, palletMatId: string | null, itemMatId: string | null,
) {
  const ids = [palletMatId, itemMatId].filter(Boolean) as string[]
  const { data } = ids.length
    ? await supabase.from('Material').select('id, material_code, short_name').in('id', ids)
    : { data: [] as { id: string; material_code: string; short_name: string | null }[] }
  const by = new Map(((data ?? []) as { id: string; material_code: string; short_name: string | null }[])
    .map(m => [m.id, m]))
  const label = (id: string | null): string => {
    const m = id ? by.get(id) : null
    if (!m) return 'mã không xác định'
    return `"${m.material_code}"${m.short_name ? ` (${m.short_name})` : ''}`
  }
  return fail(res, `Quét nhầm mã hàng — tem "${qr}" là ${label(palletMatId)} nhưng dòng hàng đang cần ${label(itemMatId)}`, 400)
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
      supabase.from('GroupDeliveryOrder').select(`status, started_at, warehouse_id, delivery_date, ${INERT_COLS}`).eq('id', gdoId).single(),
      itemOfGdo(itemId, gdoId),
      supabase.from('InventoryEntry').select('*, qa_status:QAStatus(code,name), location:Location!location_id(id, location_code, warehouse_id)').eq('pallet_code', qr).in('status', ['IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING']),
      dupScanQuery(itemId, qr, !!loose_picking_mode),
    ])
    if (!inScope(req, gdo?.warehouse_id)) return fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403)
    const inv = ((invList ?? []) as any[]).find((e: any) => e.location?.warehouse_id === gdo?.warehouse_id) ?? null

    if (gdo?.status === 'PAUSED') return fail(res, 'Chuyến xe đang tạm dừng — không thể quét', 400)
    // Chuyến bất động (chờ dữ liệu SAP / kế hoạch đã bỏ): chặn CẢ nhặt lẻ — khác luật ngày tương lai,
    // vì ở đây chuyến chưa/không còn dòng hàng để soạn, không phải chuyện sớm hay muộn.
    { const inertErr = inertError(gdo as GdoInertState | null)
      if (inertErr) return fail(res, 422, 'TRIP_INERT', inertErr) }
    // Mirror guard của scanItem: preview cũng chặn sớm để người quét biết ngay lý do
    if (!loose_picking_mode && !(gdo as { started_at?: string | null } | null)?.started_at)
      return fail(res, 'Chuyến chưa Bắt đầu — bấm "Bắt đầu" chuyến (qua kiểm tra cổng/cân nếu kho yêu cầu) rồi mới quét xuất', 400)
    {
      // Chặn xuất sớm (đơn ngày tương lai) — nhặt lẻ được miễn (soạn hàng trước là chủ đích)
      const futErr = loose_picking_mode ? null : futureDateError((gdo as { delivery_date?: string | null } | null)?.delivery_date)
      if (futErr) return fail(res, 422, 'FUTURE_DATE', futErr)
    }
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
      return await materialMismatchFail(res, qr, inv.material_id ?? null, item.material_id)
    }

    // Shelf-life của mã: cần cho CẢ kiểm %Date lẫn kiểm luân chuyển → nạp MỘT lần.
    const matId = item.material_id ?? inv.material_id
    const { data: mat } = matId
      ? await supabase.from('Material').select('category, shelf_life_days, supplier_shelf_life_overrides').eq('id', matId).single()
      : { data: null }

    const dateReqPct = Number(item.date_required ?? 0)
    if (dateReqPct > 0) {
      // Ưu tiên HSD tường minh trên tem (V2) → không cần khai Shelf Life mã vẫn kiểm %Date được; fallback NSX+shelflife (V1).
      const pct = computePctDate(inv, mat)
      if (pct == null) return fail(res, `Pallet "${qr}" thiếu HSD hoặc NSX+Shelf Life — không thể kiểm tra %Date`, 400)
      if (pct < dateReqPct) {
        return fail(res, `%Date còn lại: ${Math.floor(pct)}% < yêu cầu ${dateReqPct}%`, 400)
      }
    }

    // Kiểm luân chuyển (FEFO/FIFO/LIFO theo cấu hình kho) — ở đây CHỈ báo cáo, không chặn: đây là
    // bước xem trước để FE hiện cảnh báo / hỏi lý do. Cửa chặn thật nằm ở scanItem (gọi thẳng API
    // vẫn phải qua đó — luật "lọc ở picker chỉ là gợi ý, gác ở BE").
    const rotCfg = (await rotationConfigOf(gdo?.warehouse_id ? [gdo.warehouse_id] : []))
      .of(gdo?.warehouse_id, (mat as { category?: string | null } | null)?.category)
    const rotation = await rotationCheckOf({
      entry: inv as RotationEntry, material: mat as MaterialShelfInfo | null,
      materialId: inv.material_id ?? null, warehouseId: gdo?.warehouse_id ?? null,
      principle: rotCfg.principle, required: rotCfg.required, source: rotCfg.source,
      minPctDate: dateReqPct,
    })

    return res.json({
      success: true,
      data: {
        pallet_code:       qr,
        production_date:   inv.production_date ?? null,
        rotation,
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
    const { qr_code, employee_id, cartons_override, loose_picking_mode, leftover_location_id, leftover_ui, rotation_override_reason } = req.body as { qr_code: string; employee_id?: string; cartons_override?: number; loose_picking_mode?: boolean; leftover_location_id?: string; leftover_ui?: boolean; rotation_override_reason?: string }
    const qr = normalizeQR(qr_code ?? '')   // tem V2 (`;`) đệm space từng đoạn → chuẩn hóa để khớp pallet_code đã lưu
    if (!qr) return fail(res, 'qr_code là bắt buộc', 400)

    const [
      { data: gdo },
      { data: item, error: itemErr },
      { data: invList },
      { data: dupCheck },
      { data: empCheck },
    ] = await Promise.all([
      supabase.from('GroupDeliveryOrder').select(`status, started_at, warehouse_id, delivery_date, ${INERT_COLS}`).eq('id', gdoId).single(),
      itemOfGdo(itemId, gdoId),
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
    // Chuyến bất động (chờ dữ liệu SAP / kế hoạch đã bỏ): chặn CẢ nhặt lẻ — khác luật ngày tương lai,
    // vì ở đây chuyến chưa/không còn dòng hàng để soạn, không phải chuyện sớm hay muộn.
    { const inertErr = inertError(gdo as GdoInertState | null)
      if (inertErr) return fail(res, 422, 'TRIP_INERT', inertErr) }
    // Chưa Bắt đầu → không quét (bug 01/08: quét lật IN_PROGRESS + trừ tồn, lách rule cổng/cân).
    // Nhặt lẻ pre-start (xe chưa tới) là chủ đích → miễn.
    if (!loose_picking_mode && !gdo?.started_at)
      return fail(res, 'Chuyến chưa Bắt đầu — bấm "Bắt đầu" chuyến (qua kiểm tra cổng/cân nếu kho yêu cầu) rồi mới quét xuất', 400)
    {
      // Chặn xuất sớm (đơn ngày tương lai — chuyến có thể bị đổi ngày SAU khi start) — nhặt lẻ miễn
      const futErr = loose_picking_mode ? null : futureDateError((gdo as { delivery_date?: string | null } | null)?.delivery_date)
      if (futErr) return fail(res, 422, 'FUTURE_DATE', futErr)
    }
    if (itemErr || !item) return fail(res, 'Không tìm thấy mặt hàng', 404)
    if (item.status === 'COMPLETED') return fail(res, 'Mặt hàng này đã xuất đủ số lượng', 400)
    if (!inv) return palletUnavailableFail(res, qr, gdo?.warehouse_id)
    if (inv.qa_status_id && inv.qa_status?.code !== 'OK') {
      return fail(res, `Pallet bị giữ QA: ${inv.qa_status?.name ?? inv.qa_status_id} — không được xuất`, 400)
    }

    // Fetch shelf_life_days + cấu hình luân chuyển của kho song song (cả hai chỉ cần dữ liệu bước trên)
    const matId = item.material_id ?? inv.material_id
    const [{ data: shelfMat }, rotResolver] = await Promise.all([
      matId
        ? supabase.from('Material').select('category, shelf_life_days, supplier_shelf_life_overrides, base_unit, entry_unit, units_per_carton').eq('id', matId).single()
        : Promise.resolve({ data: null }),
      rotationConfigOf(gdo?.warehouse_id ? [gdo.warehouse_id] : []),
    ])
    const rotCfg = rotResolver.of(gdo?.warehouse_id, (shelfMat as { category?: string | null } | null)?.category)
    const rotation = await rotationCheckOf({
      entry: inv as RotationEntry, material: shelfMat as MaterialShelfInfo | null,
      materialId: inv.material_id ?? null, warehouseId: gdo?.warehouse_id ?? null,
      principle: rotCfg.principle, required: rotCfg.required, source: rotCfg.source,
      minPctDate: Number(item.date_required ?? 0),
    })

    // ── CHẶN khi kho bật "bắt buộc lấy đúng thứ tự" ──────────────────────────
    // Van xả PHẢI có: pallet đúng thứ tự có thể đang nằm dưới chồng / bị chắn / rách. Không có
    // đường ra hợp lệ thì người quét kẹt giữa ca và sẽ tự tìm cách lách (quét pallet khác rồi sửa
    // số, hoặc bỏ không quét) — tệ hơn hẳn so với cho qua kèm LÝ DO có vết.
    let rotationOverride: string | null = null
    if (rotation.required && rotation.violation) {
      const raw  = String(rotation_override_reason ?? '').trim()
      const code = raw.split(':')[0].trim()
      if (!canRotationOverride(req))
        return fail(res, 422, 'ROTATION_VIOLATION', `${rotationBlockMessage(rotation)} Cần người có quyền duyệt lấy khác thứ tự.`)
      if (!isRotationReason(code))
        return fail(res, 422, 'ROTATION_REASON_REQUIRED', `${rotationBlockMessage(rotation)} Chọn lý do để tiếp tục.`)
      rotationOverride = raw.slice(0, 200)
    }
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
      return await materialMismatchFail(res, qr, inv.material_id ?? null, item.material_id)
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
    const wanted = cartons_override ? Math.min(Math.max(1, Number(cartons_override)), cap) : cap

    // ── ĐẶT GẠCH HẠN MỨC DÒNG HÀNG (nguyên tử) TRƯỚC KHI GHI BẤT CỨ THỨ GÌ ──────────
    // Nhặt lẻ chưa xác nhận thì dòng hàng KHÔNG được tự COMPLETE dù đủ số — hỏi trước vì trạng thái
    // mới được chốt ngay trong lượt đặt gạch này.
    const { data: unconfirmedLoose } = await supabase.from('OutboundScanEntry')
      .select('id').eq('item_id', itemId).eq('is_loose_picking', true).eq('loose_confirmed', false)
    const blockComplete = (unconfirmedLoose ?? []).length > 0
    const ordered = Number(item.cartons_ordered)
    const claimed = await claimItemQuota(itemId, wanted, ordered,
      loose_picking_mode ? () => 'IN_PROGRESS' : n => (n >= ordered && !blockComplete) ? 'COMPLETED' : 'IN_PROGRESS',
      !loose_picking_mode && !blockComplete)
    if (claimed === 'FULL') return fail(res, 'Mặt hàng đã đủ số lượng — người khác vừa quét xong', 400)
    if (claimed === null)   return fail(res, 'Dòng hàng này đang có nhiều người cùng quét — thử lại', 409)
    const to_take = claimed.grant
    // TỔNG mới do chính lượt đặt gạch chốt ra — khớp đúng con số vừa ghi vào DB, khỏi đọc lại.
    const claimedTotal = claimed.total
    // Từ đây trở đi hạn mức đã là CỦA MÌNH: mọi đường thoát lỗi phải NHẢ lại, nếu không dòng hàng
    // sẽ kẹt "đã quét" số hàng chưa hề rời kệ.
    const releaseQuota = () => addItemScanned(itemId, -to_take, n => n >= ordered ? 'COMPLETED' : n > 0 ? 'IN_PROGRESS' : 'PENDING')

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
        await releaseQuota()
        return fail(res, `Pallet còn ${qtyLabel(leftoverQty, (shelfMat ?? null) as MatUnitsQ | null)} chưa xuất — phải chọn vị trí để phần còn lại (giữ chỗ cũ hoặc chọn vị trí khác)`, 422)
      } else if (pick !== KEEP_LOCATION && pick !== inv.location_id) {
        const { data: loc } = await supabase.from('Location')
          .select('id, location_code, is_active, warehouse_id').eq('id', pick).maybeSingle()
        if (!loc || !loc.is_active || loc.warehouse_id !== gdo?.warehouse_id) await releaseQuota()
        if (!loc)           return fail(res, 'Vị trí đã chọn không tồn tại', 422)
        if (!loc.is_active) return fail(res, `Vị trí ${loc.location_code} đang ngưng sử dụng — chọn vị trí khác`, 422)
        if (loc.warehouse_id !== gdo?.warehouse_id)
          return fail(res, `Vị trí ${loc.location_code} không thuộc kho của chuyến xe này`, 422)
        moveLeftoverTo = pick
      }
    }

    // ── HÀNG DƯ ĐẶT SANG Ô KHÁC = MỘT LẦN CẤT HÀNG (user chốt 18/08) ────────────────────
    // Bốc xong còn dư mà mang sang ô mới thì đó đúng nghĩa "đưa hàng vào ô đó" ⇒ phải theo cùng
    // quy tắc cất của kho: mức CẢNH BÁO thì cho qua + nói ra, mức BẮT BUỘC thì không cho.
    // "Giữ chỗ cũ" KHÔNG chấm: pallet đã nằm sẵn ở đó, chặn chỉ tạo ngõ cụt (không cho giữ mà cũng
    // chẳng dời được hàng đi đâu) — luật là "không ĐƯA hàng vào", không phải "không được ở lại".
    let putLeftoverWarn: string | null = null
    if (moveLeftoverTo) {
      const put = await guardPutaway({
        warehouseId: gdo?.warehouse_id ?? null,
        locationId:  moveLeftoverTo,
        incoming: {
          material_id:     inv.material_id,
          ncc_id:          inv.ncc_id ?? null,
          production_date: inv.production_date ?? null,
          expiry_date:     inv.expiry_date ?? null,
          shelf_life_days: inv.shelf_life_days ?? null,
        },
        overrideReason: (req.body as { putaway_override_reason?: unknown }).putaway_override_reason,
        canOverride:    canPutawayOverride(req),
        material:       shelfMat as MaterialShelfInfo | null,
      })
      if (put.error) {
        await releaseQuota()
        return fail(res, put.error.code === 'FORBIDDEN' ? 403 : 422, put.error.code, put.error.message)
      }
      putLeftoverWarn = put.warning
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
      // Vết luân chuyển — chốt cứng tại thời điểm quét (kho đổi cấu hình sau không làm đổi nghĩa
      // dòng cũ). best_available_date CŨ không ghi nữa: nghĩa của nó là MIN(NSX) chỉ đếm
      // IN_STOCK/PARTIAL, lệch với luật quét thật.
      rotation_principle:       rotation.principle,
      rotation_violation:       rotation.violation,
      rotation_best_date:       rotation.best_date,
      rotation_override_reason: rotationOverride,
      pct_date,
      is_loose_picking: !!loose_picking_mode,
      scanned_by: resolved_employee_id, scanned_at: t,
      created_at: t, updated_at: t,
    })
    if (insertErr) {
      await releaseQuota()
      return fail(res, `Lỗi lưu scan entry: ${insertErr.message}`, 500, req.originalUrl)
    }

    // Hạn mức đã đặt gạch ở trên ⇒ tổng mới là con số CHÍNH THỨC, không đọc lại bản chụp cũ.
    let new_scanned = to_take

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
        await releaseQuota()
        return fail(res, 'Tồn kho mã này vừa thay đổi (thao tác khác) — thử lại', 409)
      }
      const moveErr = await applyLeftoverMove(() => adjustInventoryAtomic(inv.id, 0, -to_take))
      if (moveErr) { await releaseQuota(); return fail(res, moveErr, 409) }
      const cum = claimedTotal ?? await currentItemScanned(itemId)
      if (cum != null) new_scanned = cum
    } else {
      // Trừ tồn NGUYÊN TỬ chống đua + chống xuất-quá-tồn (trước đây ghi mù remaining=available-to_take
      // → 2 người quét cùng pallet làm mất cập nhật / xuất quá số). Lỗi → rollback scan entry đã insert.
      const consumed = await consumeInventoryExact(inv.id, to_take)
      if (consumed !== true) {
        await supabase.from('OutboundScanEntry').delete().eq('id', scanId)
        await releaseQuota()
        return fail(res, consumed === false
          ? `Pallet "${qr}" vừa được người khác xuất bớt — tồn không đủ, quét lại`
          : 'Tồn kho mã này đang bận (nhiều người thao tác) — thử lại', 409)
      }
      const moveErr = await applyLeftoverMove(() => adjustInventoryAtomic(inv.id, to_take, 0))
      if (moveErr) { await releaseQuota(); return fail(res, moveErr, 409) }
      // Tổng + trạng thái đã được chốt NGUYÊN TỬ lúc đặt gạch hạn mức; ở đây chỉ đọc lại con số
      // thật để trả về cho màn quét (người khác có thể vừa quét thêm dòng này).
      const cum = claimedTotal ?? await currentItemScanned(itemId)
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
      // Kho chưa bật "bắt buộc" → đã chuyển rồi nhưng NÓI RA (hook FE bật toast). Khác màn quét
      // NHẬP (im lặng): ở đây vị trí vừa được chọn ngay lượt này, chưa qua cửa duyệt nào.
      ...(putLeftoverWarn ? { putaway_warning: putLeftoverWarn } : {}),
    })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, QUERY_TIMEOUT_MSG, 400); return fail(res, String(e)) }
}

// ─── Delete scan entry (hủy QR đã quét) ─────────────────────

export async function deleteScanEntry(req: Request, res: Response) {
  try {
    const { gdoId, itemId, scanId } = req.params

    const [{ data: gdo }, { data: itemRef }] = await Promise.all([
      supabase.from('GroupDeliveryOrder').select('status, warehouse_id').eq('id', gdoId).single(),
      itemOfGdo(itemId, gdoId, 'id'),
    ])
    if (!inScope(req, gdo?.warehouse_id)) return fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403)
    if (gdo?.status === 'PAUSED') return fail(res, 'Chuyến xe đang tạm dừng — không thể xóa QR', 400)
    if (!itemRef) return fail(res, 'Không tìm thấy mặt hàng', 404)

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
        supabase.from('GroupDeliveryOrder').select(`status, started_at, warehouse_id, delivery_date, ${INERT_COLS}`).eq('id', gdoId).single(),
        itemOfGdo(itemId, gdoId),
        employee_id
          ? supabase.from('Employee').select('id').eq('id', employee_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
    const confirmed_by = empCheck ? employee_id : null

    if (!inScope(req, gdo?.warehouse_id)) return fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403)
    if (gdo?.status === 'PAUSED') return fail(res, 'Chuyến xe đang tạm dừng', 400)
    { const inertErr = inertError(gdo as GdoInertState | null)
      if (inertErr) return fail(res, 422, 'TRIP_INERT', inertErr) }
    if (!item) return fail(res, 'Không tìm thấy mặt hàng', 404)
    // SOẠN nhặt lẻ trước ngày = OK (chỉ giữ hàng/reserved), nhưng XÁC NHẬN = TRỪ TỒN THẬT = hàng rời kho
    // ⇒ phải đúng ngày xuất (probe 02/08: đây là đường lách FUTURE_DATE duy nhất còn trừ được tồn).
    const clFutErr = futureDateError((gdo as { delivery_date?: string | null } | null)?.delivery_date)
    if (clFutErr) return fail(res, 422, 'FUTURE_DATE',
      `${clFutErr} (Hàng đã soạn vẫn được giữ — chỉ chờ đến ngày xuất mới xác nhận.)`)

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
      supabase.from('GroupDeliveryOrder').select(`status, warehouse_id, ${INERT_COLS}, warehouse:Warehouse(inventory_mode)`).eq('id', gdoId).single(),
      itemOfGdo(itemId, gdoId, 'id, do_id, material_id, material_code_raw, cartons_ordered, cartons_scanned, loose_picking, material:Material!material_id(material_code, no_qr_tracking, base_unit, entry_unit, units_per_carton)'),
    ])
    if (!inScope(req, gdo?.warehouse_id)) return fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403)
    if (gdo?.status === 'PAUSED') return fail(res, 'Chuyến xe đang tạm dừng — không thể cập nhật', 400)
    { const inertErr = inertError(gdo as GdoInertState | null)
      if (inertErr) return fail(res, 422, 'TRIP_INERT', inertErr) }
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

    // Tồn chung theo warehouse_id trực tiếp (entry POSM location_id=null).
    // KHÔNG maybeSingle: pool no-QR có thể 2+ dòng cùng pallet_code sau nhập lại (bài học
    // ed92e2a — maybeSingle gặp 2 dòng trả error → 404 "chưa có tồn" OAN dù tồn dư; POSM
    // mode ALL 24/08 đi qua đây hằng ngày). Bản ghi soạn cũ giữ ĐÚNG dòng đã reserve;
    // bản ghi mới chọn dòng khả dụng cao nhất.
    const { data: invRows } = await supabase.from('InventoryEntry')
      .select('id, cartons_remaining, cartons_imported, cartons_reserved')
      .eq('pallet_code', matCode).eq('warehouse_id', gdo.warehouse_id)
      .gt('cartons_remaining', -1).limit(50)
    type PoolRow = { id: string; cartons_remaining: number | null; cartons_imported: number | null; cartons_reserved: number | null }
    const pool = ((invRows ?? []) as PoolRow[])
    const availOf = (r: PoolRow) => Number(r.cartons_remaining ?? r.cartons_imported ?? 0) - Number(r.cartons_reserved ?? 0)
    const existingEntryId = (looseEntries ?? []).find((e: any) => !e.loose_confirmed && e.pallet_code === matCode)?.inventory_entry_id as string | undefined
    const invEntry = (existingEntryId ? pool.find(r => r.id === existingEntryId) : null)
      ?? pool.sort((a, b) => availOf(b) - availOf(a))[0]
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

// NÚT "TÍNH LẠI NHẶT LẺ" (user chốt 24/08 — sau khi đổi setting nhặt lẻ giữa chừng):
// setting KHÔNG hồi tố đơn đã tạo (chủ đích — số tự nhảy khi đang soạn là loạn hiện trường);
// đây là đường ÁP LẠI có kiểm soát, phạm vi hẹp:
// - Chỉ chuyến CHƯA BẮT ĐẦU (PENDING, không CHỜ SAP / NGỪNG) của MỘT kho (+ khoảng ngày nếu lọc).
// - Dòng đã soạn/giữ hoặc đã xác nhận: chỉ cập nhật khi số MỚI ≥ số ĐÃ SOẠN (nới rule 20→50 vẫn
//   lên 50 được, phần đã soạn giữ nguyên); số mới < số đã soạn → GIỮ NGUYÊN + đếm báo lại
//   (không tự cắt dưới số người ta đã soạn — muốn hạ thì gỡ soạn trước).
// - Số "Nhặt lẻ" nhập tay từ file cũ (chuyến origin EXCEL/LEGACY): giữ nguyên — trừ setting OFF
//   (OFF ép 0 mọi đường, vẫn qua gác "đã soạn" ở trên).
export async function recalcLoosePicking(req: Request, res: Response) {
  try {
    const { warehouse_id, date_from, date_to } = req.body as { warehouse_id?: string; date_from?: string; date_to?: string }
    if (!warehouse_id) return fail(res, 'Chọn Kho xuất trước khi tính lại — setting nhặt lẻ đặt theo kho', 422)
    if (req.user?.warehouse_scope !== 'NATIONAL' && !(req.user?.warehouse_ids ?? []).includes(warehouse_id))
      return fail(res, 'Kho ngoài phạm vi được gán', 403)

    const gdosAll = await fetchAllRowsParallel(() => {
      let q = supabase.from('GroupDeliveryOrder')
        .select('id, group_code, warehouse_type, origin, awaiting_sap, plan_dropped')
        .eq('warehouse_id', warehouse_id).eq('status', 'PENDING')
      if (date_from) q = q.gte('delivery_date', date_from)
      if (date_to)   q = q.lte('delivery_date', date_to)
      return q
    }) as { id: string; group_code: string; warehouse_type: string | null; origin: string | null; awaiting_sap?: boolean | null; plan_dropped?: boolean | null }[]
    // Chuyến bất động (chờ SAP / ngừng) không có gì để tính; scope Loại hàng = giao ≥1 như mọi cửa ghi GDO
    const gdos = gdosAll.filter(g => !g.awaiting_sap && !g.plan_dropped && categoryAllowed(req, g.warehouse_type))
    const originByGdo = new Map(gdos.map(g => [g.id, g.origin ?? null]))

    const dels = await fetchAllByIdChunks(gdos.map(g => g.id), chunk =>
      supabase.from('OutboundDelivery').select('id, gdo_id').in('gdo_id', chunk)) as { id: string; gdo_id: string }[]
    const gdoByDo = new Map(dels.map(d => [d.id, d.gdo_id]))
    const items = await fetchAllByIdChunks(dels.map(d => d.id), chunk =>
      supabase.from('OutboundItem').select('*').in('do_id', chunk).neq('status', 'CANCELLED')) as Record<string, any>[]

    // Số ĐÃ SOẠN/GIỮ/XÁC NHẬN per dòng (base) — gác "không cắt dưới số đã soạn"
    const looseScans = await fetchAllByIdChunks(items.map(i => String(i.id)), chunk =>
      supabase.from('OutboundScanEntry').select('item_id, cartons_scanned')
        .eq('is_loose_picking', true).in('item_id', chunk)) as { item_id: string; cartons_scanned: number }[]
    const scannedByItem = new Map<string, number>()
    for (const s of looseScans)
      scannedByItem.set(s.item_id, (scannedByItem.get(s.item_id) ?? 0) + Number(s.cartons_scanned || 0))

    const codes = [...new Set(items.map(i => String(i.material_code_raw ?? '').trim()).filter(Boolean))]
    const mats = await fetchAllByIdChunks(codes, chunk =>
      supabase.from('Material')
        .select('material_code, base_unit, entry_unit, units_per_carton, cartons_per_pallet, warehouse_pallet_overrides, category')
        .in('material_code', chunk)) as (MatPalletUnits & { material_code: string })[]
    const matByCode = new Map(mats.map(m => [String(m.material_code), m]))
    const loosePol = await looseConfigOf([warehouse_id])

    const t = new Date().toISOString()
    const changed: Record<string, any>[] = []
    let keptScanned = 0, keptManual = 0
    for (const it of items) {
      const gdoId = gdoByDo.get(String(it.do_id))
      if (!gdoId) continue
      const cur = Number(it.loose_picking ?? 0)
      const mu = matByCode.get(String(it.material_code_raw ?? '').trim()) ?? null
      const policy = loosePol.of(warehouse_id, mu?.category ?? null)
      const origin = originByGdo.get(gdoId)
      let next: number
      if (origin === 'EXCEL' || origin === 'LEGACY') {
        // Số nhặt lẻ nhập tay từ file — công thức không đè, chỉ OFF mới ép 0
        if (policy.mode !== 'OFF') { if (cur > 0) keptManual++; continue }
        next = 0
      } else {
        next = loosePalletRemainder(Number(it.cartons_ordered ?? 0), mu, warehouse_id, policy)
      }
      if (next === cur) continue
      const done = scannedByItem.get(String(it.id)) ?? 0
      if (next < done) { keptScanned++; continue }   // đã soạn nhiều hơn số mới → giữ, báo lại
      changed.push({ ...it, loose_picking: next, updated_at: t })
    }

    // UPDATE nhiều dòng giá trị khác nhau = upsert LÔ full-record (chuẩn upload) — không update lẻ
    for (let i = 0; i < changed.length; i += 500) {
      const { error } = await supabase.from('OutboundItem').upsert(changed.slice(i, i + 500), { onConflict: 'id' })
      if (error) return fail(res, `Lỗi cập nhật: ${error.message}`)
    }
    return ok(res, {
      gdos: gdos.length, items_checked: items.length, updated: changed.length,
      kept_scanned: keptScanned, kept_manual: keptManual,
    })
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Lỗi tính lại nhặt lẻ')
  }
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
      itemOfGdo(itemId, gdoId, 'material_code_raw, cartons_ordered, cartons_scanned, material:Material!material_id(material_code)'),
    ])
    if (!inScope(req, gdo?.warehouse_id)) return fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403)
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

// ── GHI NHẬN/HOÀN pool no-QR NGUYÊN TỬ (bug #6 10/08 — hoàn tồn khống dưới bão 504) ──
// RPC outbound_pool_apply (migration 20260810d) gói TRỌN: khóa item → delta tính từ chính
// cartons_scanned trong transaction → trừ/hoàn pool có khóa dòng → update item + vết quét.
// Số truyền vào là TUYỆT ĐỐI (newQty) nên gọi lại lần 2 delta=0 — hoàn đôi bất khả thi;
// Vercel kill giữa chừng = rollback trọn, pool và scanned không bao giờ lệch nhau.
// Semantics pool GIỮ NGUYÊN applySharedPoolDelta cũ (đã gỡ 10/08): QTY/QTY_DATE thiếu →
// INSUFFICIENT; NONE/không dòng → OK không đụng tồn; QTY_DATE trừ FEFO + lọc NSX chọn tay;
// gộp đa-dòng cùng pallet_code (dòng EXPORTED nhập lại). claimOnlyPending=true thay cú
// CAS-claim + hoàn-bù của "Xuất luôn" (thua đua = CLAIM_LOST, KHÔNG đụng tồn).
type PoolApplyOutcome = { outcome: 'OK' | 'INSUFFICIENT' | 'CLAIM_LOST' | 'NOT_FOUND'; inv_entry_id?: string | null; available?: number }
async function applyPoolAtomic(args: {
  itemId: string; materialCode: string; warehouseId: string; mode?: string | null
  newQty: number; itemStatus: string; chosenDate?: string | null; claimOnlyPending?: boolean
}): Promise<PoolApplyOutcome> {
  const { data, error } = await supabase.rpc('outbound_pool_apply', {
    p_item_id: args.itemId, p_material_code: args.materialCode, p_warehouse_id: args.warehouseId,
    p_mode: args.mode ?? null, p_new_qty: args.newQty, p_item_status: args.itemStatus,
    p_chosen_date: args.chosenDate ?? null, p_claim_only_pending: args.claimOnlyPending ?? false,
    p_touch_pool: true,
  })
  if (error) throw new Error(error.message)
  return (data ?? { outcome: 'NOT_FOUND' }) as PoolApplyOutcome
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
      supabase.from('GroupDeliveryOrder').select(`status, started_at, warehouse_id, delivery_date, ${INERT_COLS}, warehouse:Warehouse(inventory_mode)`).eq('id', gdoId).single(),
      itemOfGdo(itemId, gdoId, 'id, do_id, material_id, material_type, material_code_raw, cartons_ordered, cartons_scanned, material:Material!material_id(material_code, no_qr_tracking, base_unit, entry_unit, units_per_carton)'),
    ])
    if (!inScope(req, gdo?.warehouse_id)) return fail(res, 'Chuyến xe không thuộc kho trong phạm vi của bạn', 403)
    if (gdo?.status === 'PAUSED') return fail(res, 'Chuyến xe đang tạm dừng — không thể cập nhật', 400)
    { const inertErr = inertError(gdo as GdoInertState | null)
      if (inertErr) return fail(res, 422, 'TRIP_INERT', inertErr) }
    // Chưa Bắt đầu → không "Lưu thủ công" (bug 01/08: đường này lật IN_PROGRESS + trừ pool tồn,
    // lách rule cổng/cân — kho QTY/NONE dùng đường này là chính nên lỗ càng rộng)
    if (!(gdo as { started_at?: string | null } | null)?.started_at)
      return fail(res, 'Chuyến chưa Bắt đầu — bấm "Bắt đầu" chuyến (qua kiểm tra cổng/cân nếu kho yêu cầu) rồi mới ghi nhận số lượng', 400)
    if (!item) return fail(res, 'Không tìm thấy mặt hàng', 404)
    // Chặn xuất sớm CHỈ khi GHI THÊM. Sửa GIẢM / hoàn về 0 luôn cho phép — nếu không, chuyến lỡ bị
    // đẩy sang ngày tương lai sau khi đã ghi nhận sẽ KẸT: tồn đã trừ mà không đường nào trả lại
    // (probe 02/08 B2). Luật là "không xuất sớm", không phải "không sửa sai".
    const mcFutErr = (cartons == null || Number(cartons) > Number(item.cartons_scanned))
      ? futureDateError((gdo as { delivery_date?: string | null } | null)?.delivery_date)
      : null
    if (mcFutErr) return fail(res, 422, 'FUTURE_DATE', mcFutErr)

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

    // ── CỬA NÀY CHỈ DÀNH CHO HÀNG KHÔNG TEM ────────────────────────────────────
    // Với hàng CÓ tem, đường ghi nhận xuất là QUÉT. Nhánh dưới của hàm này ghi thẳng
    // `cartons_scanned = ctn` mà KHÔNG đụng tồn và KHÔNG đụng vết quét ⇒ gọi trên hàng có tem sẽ
    // làm bộ đếm của dòng hàng lệch khỏi vết quét thật VÀ lệch khỏi tồn đã trừ — đúng thứ bất biến
    // "bộ đếm = Σ vết quét" mà bộ QA đang gác. FE vốn chỉ hiện nút này cho hàng không tem
    // (`no_qr_tracking === true`), nên chặn ở đây là khớp FE, không cắt việc của ai.
    // Phát hiện 29/08 khi diễn tập 100 người: BE không hề gác, gọi thẳng API là desync được.
    if (!isSpecial) {
      return fail(res, 400, 'QR_ITEM_MANUAL_FORBIDDEN',
        'Mặt hàng này theo dõi bằng tem QR — ghi nhận xuất bằng cách QUÉT. Muốn sửa số đã ghi thì xóa lượt quét tương ứng.')
    }
    const specialMatCode: string | null = isSpecial ? ((item.material as any)?.material_code ?? item.material_code_raw ?? null) : null

    // Chỉ COMPLETED khi nhập đủ kế hoạch — thiếu thì IN_PROGRESS (giống hàng QR).
    // Muốn chốt đơn thiếu: sửa cartons_ordered xuống = thực xuất rồi mới hoàn thành.
    const newItemStatus = ctn >= Number(item.cartons_ordered) ? 'COMPLETED' : 'IN_PROGRESS'
    const t = now()

    if (isSpecial && item.material_id && gdo?.warehouse_id && specialMatCode) {
      // MỘT RPC nguyên tử: pool + item.cartons_scanned + vết quét cùng transaction (bug #6 10/08 —
      // trước đây 3 request rời, Vercel kill giữa chừng → lượt hoàn sau hoàn ĐÔI tồn khống)
      const chosenDate = gdoMode === 'QTY_DATE' && production_date ? String(production_date).slice(0, 10) : null
      const r = await applyPoolAtomic({
        itemId, materialCode: specialMatCode, warehouseId: gdo.warehouse_id as string,
        mode: gdoMode, newQty: ctn, itemStatus: newItemStatus, chosenDate,
      })
      if (r.outcome === 'INSUFFICIENT') {
        const mu = (item.material ?? null) as MatUnitsQ | null
        const oldCartons = Number(item.cartons_scanned) || 0
        return fail(res, 400, 'INSUFFICIENT_STOCK',
          `Không đủ tồn kho${chosenDate ? ` NSX ${chosenDate}` : ''} — còn ${qtyLabel(r.available ?? 0, mu)}${oldCartons > 0 ? `, cần thêm ${qtyLabel(ctn - oldCartons, mu)}` : ''}`)
      }
      if (r.outcome === 'NOT_FOUND') return fail(res, 'Không tìm thấy mặt hàng', 404)
    } else {
      await supabase.from('OutboundItem')
        .update({ status: newItemStatus, cartons_scanned: ctn, updated_at: t }).eq('id', itemId)
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
    rotation,           // '' | 'BAD' (chỉ lượt sai thứ tự) | 'OK'
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
  const rotFilter = rotation === 'BAD' || rotation === 'OK' ? String(rotation) : null
  if (rotFilter) rpcParams.p_rotation = rotFilter
  let { data, error } = await supabase.rpc('get_outbound_scan_log', rpcParams)
  // Fallback khi RPC chưa lên bản mới (20260814d chưa apply): bỏ param lạ rồi gọi lại — trang
  // vẫn chạy, chỉ mất cột/bộ lọc luân chuyển.
  if (error && rotFilter && /p_rotation|function|schema cache/i.test(error.message)) {
    delete rpcParams.p_rotation
    ;({ data, error } = await supabase.rpc('get_outbound_scan_log', rpcParams))
  }
  // Fallback trước khi apply migration 20260702_scanlog_category_scope (RPC chưa có param mới)
  if (error && scanCats && /p_allowed_categories|function|schema cache/i.test(error.message)) {
    delete rpcParams.p_allowed_categories
    ;({ data, error } = await supabase.rpc('get_outbound_scan_log', rpcParams))
  }

  // Quá hạn tính khi đông người cùng truy vấn KHÔNG phải lỗi app: 503 kèm câu người dùng LÀM ĐƯỢC
  // gì đó (thu hẹp khoảng ngày / chọn 1 kho), thay vì 500 "Lỗi hệ thống" — mà 500 rác còn làm rule
  // cảnh báo "lỗi BE 24h" kêu oan (đo 29/08: 35 dòng error_logs của riêng màn này trong 3 giờ).
  if (error && isQueryTimeout(error)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
  if (error) return fail(res, 500, 'DB_ERROR', error.message)

  const first = (data as any[])?.[0]
  const total = first?.total_count ?? 0
  // Tuân thủ luân chuyển của CẢ DẢI đang xem (không đổi theo bộ lọc rotation — xem ghi chú trong
  // migration 20260814d). measured = số lượt ĐO ĐƯỢC; dòng cũ/thiếu NSX-HSD không vào mẫu số.
  return ok(res, {
    rows: data ?? [], total, page: pageNum, limit: limitNum,
    rotation_violations: Number(first?.viol_count ?? 0),
    rotation_measured:   Number(first?.measured_count ?? 0),
  })
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
