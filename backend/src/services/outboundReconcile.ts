// ĐỢT 2 — Engine đối chiếu SAP↔WMS (line-level, bất biến xuyên 3 GĐ).
// Nhiệm vụ: khi DO SAP đổi (up VL06O lại / sửa DO SAP), tìm các OutboundItem bị ảnh hưởng (qua od_refs),
// PHÂN VÙNG theo trạng thái QUÉT, rồi:
//   • Z1/Z2 (chưa quét)  → TỰ ÁP số/thuộc tính mới (an toàn, không mất dữ liệu vì chưa ai quét)
//   • Z3 (đã quét)       → KHÔNG tự áp → đẩy "Cần xử lý" (giảm < đã quét = BLOCKED cần trả hàng; còn lại NEEDS_REVIEW)
//   • Z4 (đã đóng: scan_completed_at) → RECONCILE_ONLY (chỉ ghi đối soát)
//   • Đổi mã hàng        → NEEDS_REVIEW (QR khác, không tự đổi)
//   • Đổi thuộc tính hiển thị (batch/%date) → TỰ ÁP mọi vùng (không đụng số quét/tồn — an toàn)
// BẤT BIẾN: KHÔNG bao giờ tự sửa/xóa dòng đã quét; auto chỉ khi cartons_scanned=0 mức DÒNG (v2.1).
// Reconcile là AUGMENT — caller phải bọc try/catch để lỗi engine KHÔNG làm hỏng upload cốt lõi.
import { randomUUID } from 'crypto'
import { supabase } from '../lib/supabase'
import { fetchAllByIdChunks } from '../utils/pagination'
import { loosePalletRemainder, looseConfigOf, type MatPalletUnits } from '../controllers/wms/outboundController'
import { sendPushToPerm } from './pushService'

const now = () => new Date().toISOString()

export type OdKey = { od_number: string; od_item: string }
export type ReconcileSummary = { auto: number; review: number; blocked: number; recon: number; skipped: number }

type RawLine = { od_number: string; od_item: string; material_code: string | null; qty_base: number | null
  batch: string | null; pct_date_req: number | null; note_delivery: string | null; note_invoice: string | null
  ship_to_code: string | null; ship_to_name: string | null; sync_status: string | null }
const normShipTo = (s: string | null | undefined) => String(s ?? '').trim().toUpperCase()
type ItemRow = { id: string; do_id: string; material_id: string | null; material_code_raw: string | null
  cartons_ordered: number; cartons_scanned: number; loose_picking: number
  batch_required: string | null; date_required: number | null; header_text: string | null
  od_refs: { od_number: string; od_item: string; qty_base: number }[] | null }
type GdoInfo = { id: string; status: string; scan_completed_at: string | null; group_code: string; warehouse_id: string | null }

const keyOf = (od: string, item: string) => `${od}__${item}`
const joinDistinct = (vals: (string | null | undefined)[]) =>
  [...new Set(vals.map(v => String(v ?? '').trim()).filter(Boolean))].join(' | ') || null

// Đối chiếu 1 loạt (od,item) đã đổi → xử các item bị ảnh hưởng. Trả tổng kết theo action.
export async function reconcileFromSap(changedKeys: OdKey[], opts: { actor: string | null }): Promise<ReconcileSummary> {
  const sum: ReconcileSummary = { auto: 0, review: 0, blocked: 0, recon: 0, skipped: 0 }
  const odNumbers = [...new Set(changedKeys.map(k => k.od_number).filter(Boolean))]
  if (!odNumbers.length) return sum

  // 1) Tìm item bị ảnh hưởng: od_refs chứa BẤT KỲ od_number đã đổi (recompute idempotent — thừa item vô hại)
  const affected = new Map<string, ItemRow>()
  for (const od of odNumbers) {
    // jsonb containment: item có od_refs chứa phần tử có od_number=od. supabase-js .contains serialize SAI
    // array-of-object (invalid json) → dùng .filter('cs', JSON.stringify) (đã verify khớp).
    const { data } = await supabase.from('OutboundItem')
      .select('id, do_id, material_id, material_code_raw, cartons_ordered, cartons_scanned, loose_picking, batch_required, date_required, header_text, od_refs')
      .filter('od_refs', 'cs', JSON.stringify([{ od_number: od }]))
    for (const it of ((data ?? []) as ItemRow[])) affected.set(it.id, it)
  }
  const items = [...affected.values()]
  if (!items.length) return sum

  // Dòng đang SOẠN NHẶT LẺ (giữ chỗ — hàng VẬT LÝ đã rời pallet xuống vị trí chờ, user chốt 05/08):
  // KHÔNG được coi là "chưa quét, an toàn" — soạn không tăng cartons_scanned nên phải soi thẳng
  // OutboundScanEntry. Tự áp đổi số ở đây là đổi loose_picking dưới chân người đang soạn.
  const looseByItem = new Map<string, number>()
  {
    const ses = await fetchAllByIdChunks(items.map(i => i.id), chunk => supabase.from('OutboundScanEntry')
      .select('item_id, cartons_scanned').eq('is_loose_picking', true).gt('cartons_scanned', 0)
      .in('item_id', chunk).order('id')) as { item_id: string; cartons_scanned: number }[]
    for (const s of (ses ?? [])) looseByItem.set(s.item_id, (looseByItem.get(s.item_id) ?? 0) + Number(s.cartons_scanned))
  }

  // 2) Nạp GDO (trạng thái/scan_completed_at/kho) qua OutboundDelivery
  const doIds = [...new Set(items.map(i => i.do_id))]
  const { data: dosData } = await supabase.from('OutboundDelivery').select('id, gdo_id, ship_to_code, distributor_name').in('id', doIds)
  type DoRow = { id: string; gdo_id: string; ship_to_code: string | null; distributor_name: string | null }
  const gdoIdByDo = new Map(((dosData ?? []) as DoRow[]).map(d => [d.id, d.gdo_id]))
  const gdoIds = [...new Set([...gdoIdByDo.values()])]
  const { data: gdosData } = await supabase.from('GroupDeliveryOrder')
    .select('id, status, scan_completed_at, group_code, warehouse_id').in('id', gdoIds)
  const gdoById = new Map((gdosData ?? []).map((g: GdoInfo) => [g.id, g]))

  // 3) Nạp raw HIỆN TẠI (ACTIVE) cho mọi (od,item) mà các item tham chiếu → tính lại
  const allRefKeys = new Set<string>()
  const refOds = new Set<string>()
  for (const it of items) for (const r of (it.od_refs ?? [])) { allRefKeys.add(keyOf(r.od_number, r.od_item)); refOds.add(r.od_number) }
  const rawRows = await fetchAllByIdChunks([...refOds], chunk => supabase.from('erp_outbound_orders')
    .select('od_number, od_item, material_code, qty_base, batch, pct_date_req, note_delivery, note_invoice, ship_to_code, ship_to_name, sync_status')
    .in('od_number', chunk).order('od_number')) as RawLine[]
  const rawByKey = new Map<string, RawLine>()
  for (const r of (rawRows ?? [])) if (r.sync_status !== 'OBSOLETE') rawByKey.set(keyOf(r.od_number, r.od_item), r)

  // 4) Material units (recompute loose)
  const matIds = [...new Set(items.map(i => i.material_id).filter(Boolean) as string[])]
  const matById = new Map<string, MatPalletUnits & { id: string }>()
  if (matIds.length) {
    const { data: mats } = await supabase.from('Material')
      .select('id, units_per_carton, entry_unit, base_unit, cartons_per_pallet, warehouse_pallet_overrides, category').in('id', matIds)
    for (const m of ((mats ?? []) as (MatPalletUnits & { id: string })[])) matById.set(m.id, m)
  }
  // Policy nhặt lẻ 2 tầng (24/08) — engine dội SAP phải tính CÙNG luật với upload/tạo đơn
  const loosePol = await looseConfigOf(null)

  const tasks: Record<string, unknown>[] = []
  const t = now()

  for (const it of items) {
    const refs = it.od_refs ?? []
    if (!refs.length) { sum.skipped++; continue }
    const gdoId = gdoIdByDo.get(it.do_id)
    const gdo = gdoId ? gdoById.get(gdoId) : undefined

    // Recompute từ raw HIỆN TẠI
    let newOrdered = 0, anyRemoved = false, materialChanged = false
    const pcts: number[] = [], batches: (string | null)[] = []
    for (const r of refs) {
      const raw = rawByKey.get(keyOf(r.od_number, r.od_item))
      if (!raw) { anyRemoved = true; continue }        // dòng OD biến mất / OBSOLETE
      newOrdered += Number(raw.qty_base ?? 0)
      if (raw.material_code && it.material_code_raw && String(raw.material_code).trim() !== String(it.material_code_raw).trim()) materialChanged = true
      if (raw.pct_date_req != null) pcts.push(Number(raw.pct_date_req))
      batches.push(raw.batch)
    }
    const newDate = pcts.length ? Math.max(...pcts) : null
    const newBatch = joinDistinct(batches)

    const oldOrdered = Number(it.cartons_ordered)
    const scanned = Number(it.cartons_scanned)
    const qtyChanged = Math.round(newOrdered) !== Math.round(oldOrdered)
    const attrChanged = (newDate ?? null) !== (it.date_required ?? null) || (newBatch ?? null) !== (it.batch_required ?? null)
    if (!qtyChanged && !attrChanged && !materialChanged) { sum.skipped++; continue }

    // Vùng theo trạng thái QUÉT (mốc đóng = scan_completed_at, KHÔNG dùng item.status)
    const closed = !!gdo?.scan_completed_at
    const zone = closed ? 'Z4' : scanned > 0 ? 'Z3' : (gdo?.status === 'PENDING' ? 'Z1' : 'Z2')

    const changeType = materialChanged ? 'MATERIAL_CHANGED'
      : (anyRemoved && newOrdered < oldOrdered) ? 'LINE_REMOVED'
      : qtyChanged ? (newOrdered > oldOrdered ? 'QTY_INCREASE' : 'QTY_DECREASE')
      : 'ATTR_CHANGED'

    const mu = it.material_id ? matById.get(it.material_id) ?? null : null
    const baseTask = {
      id: randomUUID(), item_id: it.id, gdo_id: gdoId ?? null, group_code: gdo?.group_code ?? null,
      material_code: it.material_code_raw, material_name: null,
      od_number: refs[0]?.od_number ?? null, od_item: refs[0]?.od_item ?? null,
      change_type: changeType, zone,
      old_ordered: oldOrdered, new_ordered: newOrdered, scanned,
      actor: opts.actor, created_at: t, updated_at: t,
    }

    // ── Áp / xếp hàng chờ ──
    async function autoApply(withQty: boolean) {
      const patch: Record<string, unknown> = { batch_required: newBatch, date_required: newDate, updated_at: t }
      if (withQty) {
        patch.cartons_ordered = newOrdered
        patch.loose_picking = loosePalletRemainder(newOrdered, mu, gdo?.warehouse_id ?? null,
          loosePol.of(gdo?.warehouse_id ?? null, mu?.category ?? null))
        // refresh snapshot od_refs.qty_base = raw hiện tại (nguồn so sánh lần sau)
        patch.od_refs = refs.map(r => ({ od_number: r.od_number, od_item: r.od_item, qty_base: Number(rawByKey.get(keyOf(r.od_number, r.od_item))?.qty_base ?? 0) }))
      }
      await supabase.from('OutboundItem').update(patch).eq('id', it.id)
    }

    if (changeType === 'ATTR_CHANGED') {
      // Thuộc tính hiển thị (batch/%date) — an toàn mọi vùng (không đụng số quét/tồn)
      await autoApply(false)
      tasks.push({ ...baseTask, action: 'AUTO_APPLIED', status: 'RESOLVED', detail: `Cập nhật yêu cầu: batch/%Date theo SAP (không đổi số lượng)` })
      sum.auto++
      continue
    }
    if (closed) {
      tasks.push({ ...baseTask, action: 'RECONCILE_ONLY', status: 'RESOLVED', detail: `Chuyến đã đóng (đã hoàn thành/GI) — chỉ đối soát; xử bằng trả hàng/điều chỉnh + báo SAP` })
      sum.recon++
      continue
    }
    if (materialChanged) {
      tasks.push({ ...baseTask, action: 'NEEDS_REVIEW', status: 'OPEN', detail: `SAP đổi MÃ HÀNG dòng OD — QR khác, không tự đổi. Kiểm tra & xử tay.` })
      sum.review++
      continue
    }
    // Soạn nhặt lẻ CÓ cộng vào item.cartons_scanned (addItemScanned) nên item đang soạn vốn đã rơi
    // Z3 (không tự áp) — nhưng message "đã quét, chuyến đang xuất" sai bản chất. Tách: chỉ-soạn
    // (chưa quét xuất thật) → message GỠ TRẢ nhặt lẻ (hàng ở vị trí chờ, user chốt 05/08).
    const loosePrepped = looseByItem.get(it.id) ?? 0
    if (loosePrepped > 0 && scanned - loosePrepped <= 0) {
      if (newOrdered < loosePrepped) {
        tasks.push({ ...baseTask, action: 'BLOCKED', status: 'OPEN',
          detail: `SAP giảm còn ${newOrdered} nhưng ĐÃ SOẠN NHẶT LẺ ${loosePrepped} (base, hàng đang ở vị trí chờ) → gỡ trả nhặt lẻ trên chuyến rồi "Áp SAP", hoặc Giữ WMS + báo SAP.` })
        sum.blocked++
      } else {
        tasks.push({ ...baseTask, action: 'NEEDS_REVIEW', status: 'OPEN',
          detail: `SAP đổi ${oldOrdered}→${newOrdered} nhưng chuyến ĐANG SOẠN NHẶT LẺ ${loosePrepped} (base, hàng ở vị trí chờ) → gỡ trả/kiểm hàng rồi "Áp SAP", hoặc Giữ WMS.` })
        sum.review++
      }
      continue
    }
    if (scanned > 0) {
      // Z3 — đã quét → KHÔNG tự áp (v2.1). Giảm < đã quét = BLOCKED (cần trả hàng vật lý).
      if (newOrdered < scanned) {
        tasks.push({ ...baseTask, action: 'BLOCKED', status: 'OPEN',
          detail: `SAP giảm còn ${newOrdered} nhưng ĐÃ QUÉT ${scanned} → cần TRẢ HÀNG ${scanned - newOrdered} (base) rồi sửa ở Xuất kho, hoặc Giữ WMS + báo SAP.` })
        sum.blocked++
      } else {
        tasks.push({ ...baseTask, action: 'NEEDS_REVIEW', status: 'OPEN',
          detail: `SAP đổi ${oldOrdered}→${newOrdered} nhưng đã quét ${scanned} (chuyến đang xuất) → xác nhận rồi "Áp SAP", hoặc Giữ WMS.` })
        sum.review++
      }
      continue
    }
    // Z1/Z2 chưa quét (và không soạn nhặt lẻ) → TỰ ÁP số + loose + thuộc tính
    await autoApply(true)
    tasks.push({ ...baseTask, action: 'AUTO_APPLIED', status: 'RESOLVED',
      detail: `Tự áp: ${oldOrdered}→${newOrdered} (base)${anyRemoved ? ' [SAP bỏ dòng OD]' : ''} — chưa quét, an toàn.` })
    sum.auto++
  }

  // 5) SAP ĐỔI KHÁCH GIAO của DO đã lên chuyến (08/10, user chốt "cờ Cần xử lý + chặn kho"). Trước đó nạp ZSD02 THẤY ship-to đổi
  // (nằm trong bizHash) và gọi engine này, nhưng engine chỉ so SL / mã / %Date-lô ⇒ bỏ qua im lặng: chuyến vẫn mang khách cũ —
  // %Date tra theo khách của ĐƠN (C71), phiếu xuất, điểm giao đều sai. KHÔNG tự áp ở vùng nào: đổi khách là quyết định điều vận
  // (xe · tuyến · điểm giao). Việc OPEN ⇒ cổng SAP ở kho (`sapIssueError`) chặn Bắt đầu / quét / Hoàn thành tới khi người quyết.
  // Chỉ kết luận khi SAP mang ĐÚNG MỘT ship-to cho các OD của đơn (nhiều giá trị = dữ liệu lẫn, không đoán); đơn chưa có ship-to
  // (chuyến tạo trước 08/10, không điền được) thì không có mốc để so.
  {
    const odsByDo = new Map<string, Set<string>>()
    const scannedByDo = new Map<string, number>()
    for (const it of items) {
      const s = odsByDo.get(it.do_id) ?? new Set<string>()
      for (const r of it.od_refs ?? []) s.add(r.od_number)
      odsByDo.set(it.do_id, s)
      scannedByDo.set(it.do_id, (scannedByDo.get(it.do_id) ?? 0) + Number(it.cartons_scanned ?? 0))
    }
    const changedDo: { d: DoRow; od: string; to: string; toName: string | null }[] = []
    for (const d of (dosData ?? []) as DoRow[]) {
      const was = normShipTo(d.ship_to_code)
      if (!was) continue
      const ods = [...(odsByDo.get(d.id) ?? [])]
      const live = ((rawRows ?? []) as RawLine[]).filter(r => r.sync_status !== 'OBSOLETE' && ods.includes(r.od_number))
      const cur = [...new Set(live.map(r => normShipTo(r.ship_to_code)).filter(Boolean))]
      if (cur.length !== 1 || cur[0] === was) continue
      changedDo.push({ d, od: ods.find(o => live.some(r => r.od_number === o)) ?? ods[0],
        to: cur[0], toName: live.find(r => normShipTo(r.ship_to_code) === cur[0])?.ship_to_name ?? null })
    }
    // Đã có việc cùng (chuyến, OD, khách MỚI) — đang mở HOẶC người đã quyết "Giữ WMS" — thì không đẻ thêm: nạp lại mà OD đó đổi thứ
    // khác cũng gọi lại engine, báo lại đúng chuyện người vừa quyết là cãi người. SAP đổi sang khách khác NỮA thì mới là việc mới.
    const seen = new Set<string>()
    const gIds = [...new Set(changedDo.map(c => c.d.gdo_id))]
    if (gIds.length) {
      const { data } = await supabase.from('reconcile_tasks').select('gdo_id, od_number, detail')
        .eq('change_type', 'SHIPTO_CHANGED').in('gdo_id', gIds).limit(1000)   // ≤ số DO có ship-to đổi của lượt nạp × số lần đổi — vài chục
      for (const r of (data ?? []) as { gdo_id: string | null; od_number: string | null; detail: string | null }[]) {
        const to = /→ (\S+)/.exec(r.detail ?? '')?.[1]   // khách mới nằm ngay sau "→" trong câu engine tự ghi (khuôn `what` bên dưới)
        if (to) seen.add(`${r.gdo_id}|${r.od_number}|${to}`)
      }
    }
    for (const c of changedDo) {
      if (seen.has(`${c.d.gdo_id}|${c.od}|${c.to}`)) continue
      const gdo = gdoById.get(c.d.gdo_id)
      const closed = !!gdo?.scan_completed_at
      const scanned = scannedByDo.get(c.d.id) ?? 0
      const base = {
        id: randomUUID(), item_id: null, gdo_id: c.d.gdo_id, group_code: gdo?.group_code ?? null,
        material_code: null, material_name: null, od_number: c.od, od_item: null,
        change_type: 'SHIPTO_CHANGED', zone: closed ? 'Z4' : scanned > 0 ? 'Z3' : (gdo?.status === 'PENDING' ? 'Z1' : 'Z2'),
        old_ordered: null, new_ordered: null, scanned, actor: opts.actor, created_at: t, updated_at: t,
      }
      const what = `SAP đổi khách giao DO ${c.od}: ${normShipTo(c.d.ship_to_code)}${c.d.distributor_name ? ` ${c.d.distributor_name}` : ''} → ${c.to}${c.toName ? ` ${c.toName}` : ''}`
      if (closed) {
        tasks.push({ ...base, action: 'RECONCILE_ONLY', status: 'RESOLVED', detail: `${what} — chuyến đã đóng, chỉ đối soát; báo SAP.` })
        sum.recon++
      } else {
        tasks.push({ ...base, action: 'NEEDS_REVIEW', status: 'OPEN',
          detail: `${what} — chuyến vẫn ghi khách cũ. Sửa NPP của DO ở Kế hoạch xuất (hoặc gỡ DO rồi điều lại) rồi bấm "Đã xử lý tay"; giữ khách cũ thì "Giữ WMS" + báo SAP.` })
        sum.review++
      }
    }
  }

  if (tasks.length) {
    for (let i = 0; i < tasks.length; i += 500) {
      const { error } = await supabase.from('reconcile_tasks').insert(tasks.slice(i, i + 500))
      if (error) throw new Error(error.message)
    }
    // Web Push (Đợt 1 06/08): task OPEN = việc NGƯỜI phải xử → báo người có quyền
    // outbound.reconcile của từng kho. Push là phụ trợ — lỗi không được đụng reconcile.
    try {
      const openByWh = new Map<string | null, number>()
      for (const tk of tasks) {
        if (tk.status !== 'OPEN') continue
        const g = tk.gdo_id ? gdoById.get(tk.gdo_id as string) : undefined
        const wh = g?.warehouse_id ?? null
        openByWh.set(wh, (openByWh.get(wh) ?? 0) + 1)
      }
      for (const [wh, n] of openByWh) {
        await sendPushToPerm('outbound', 'reconcile', wh, {
          title: 'SAP đổi dữ liệu — cần xử lý',
          body: `${n} việc mới trong tab "Cần xử lý" (chuyến đã quét/đang soạn bị SAP đổi số lượng)`,
          url: '/external?tab=reconcile',
          tag: `reconcile-${wh ?? 'all'}`,
        }, 'reconcile')   // tôn trọng cài đặt chuông per user (nút chuông > Cài đặt)
      }
    } catch (e) { console.error('[push] reconcile notify:', e) }
  }
  return sum
}
