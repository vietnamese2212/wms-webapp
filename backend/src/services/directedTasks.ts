/**
 * DIRECTED WORK — SINH VÀ ĐÓNG VIỆC LẤY HÀNG (đợt 1c, user chốt 10/09/2026).
 *
 * ĐÂY LÀ ĐƯỜNG DUY NHẤT ghi `wms_tasks`. Ratchet `task_status_written_outside_service` (cổng tĩnh 09)
 * gác: controller nào tự `.from('wms_tasks').update(...)` là đỏ. Lý do: trạng thái việc bị đổi từ 6 chỗ
 * (Bắt đầu, quét, bỏ Bắt đầu, huỷ, hoàn thành, nút ✓ Xong) — mỗi chỗ một bản luật là đúng khuôn lỗi
 * "4 bản chép tay" của luật luân chuyển hồi 14/08.
 *
 * LUẬT KHÔNG ĐƯỢC CHÉP LẠI Ở ĐÂY:
 *   • thứ tự pallet  → `utils/rotation.ts` (rotationSortKey / isPickEligible / PICKABLE_STATUSES)
 *   • %Date          → `utils/shelfLife.ts` (computePctDate)
 *   • khoảng cách    → `utils/warehouseGrid.ts` (BFS trên lưới Sơ đồ kho)
 *   • cờ 2 tầng      → `utils/putaway.ts` (resolveWorkMode / resolveRotation)
 *
 * GIỮ CHỖ MỀM (user chốt qua 0.2-A của plan): pallet "đã có chủ" = đang là việc PENDING của chuyến
 * khác — KHÔNG đụng `cartons_reserved`. Cột đó là của NHẶT LẺ và `availableOf()` trừ nó ở MỌI cửa
 * quét, nên giữ chỗ cứng cho chuyến A sẽ làm chính thủ kho chuyến A quét pallet đó bị "đã xuất hết"
 * oan. Tranh chấp thật giải quyết lúc quét: việc của người thua → SKIPPED PALLET_TAKEN + sắp bù.
 */
import { randomUUID } from 'crypto'
import { supabase } from '../lib/supabase'
import { recordServerError } from '../utils/response'
import { computePctDate, type MaterialShelfInfo } from '../utils/shelfLife'
import {
  PICKABLE_STATUSES, isPickEligible, availableOf, rotationSortKey,
  type RotationEntry, type RotationPrinciple,
} from '../utils/rotation'
import { resolveRotation, resolveWorkMode, type WhTypeConfigRow } from '../utils/putaway'
import { fetchAllRowsParallel, fetchAllByIdChunks } from '../utils/pagination'
import {
  buildBlockedMask, bfsFrom, distanceToCells, footprintCells, orderByNearest, naturalCompare,
  type GridFrame, type GridLoc, type GridCell,
} from '../utils/warehouseGrid'

const now = () => new Date().toISOString()

// ─── Quy tắc date của DÒNG ĐƠN (user chốt vòng 4) ──────────────────────────────────────────────
// NULL = CHƯA CHỐT ⇒ dòng KHÔNG sinh việc. FEFO phải BẤM XÁC NHẬN, không phải mặc định ngầm —
// nếu không, người trong kho "tưởng mặc định rồi đi làm, sau mới update thì đã làm sai".
export type DateRuleKind = 'FEFO' | 'MIN_PCT' | 'EXACT'
export interface DateRule { kind: DateRuleKind; value?: string | number | null; set_by?: string | null; set_at?: string | null }

/** Đọc quy tắc của một dòng đơn. `date_required` cũ > 0 = đã có người quyết % ⇒ coi như MIN_PCT. */
export function dateRuleOf(item: { date_rule?: unknown; date_required?: number | null }): DateRule | null {
  const r = item.date_rule as DateRule | null | undefined
  if (r && (r.kind === 'FEFO' || r.kind === 'MIN_PCT' || r.kind === 'EXACT')) return r
  const pct = Number(item.date_required ?? 0)
  return pct > 0 ? { kind: 'MIN_PCT', value: pct } : null
}

export function describeDateRule(r: DateRule | null): string {
  if (!r) return 'chưa chốt'
  if (r.kind === 'FEFO') return 'FEFO (hạn ngắn nhất trước)'
  if (r.kind === 'MIN_PCT') return `≥ ${Number(r.value ?? 0)} %`
  return `đúng ${String(r.value ?? '')}`
}

// ─── Kiểu nội bộ ───────────────────────────────────────────────────────────────────────────────
type Cand = RotationEntry & {
  id: string; pallet_code: string; material_id: string | null
  location_id: string | null
  production_date?: string | null
  batch?: string | null
}
type LocRow = {
  id: string; location_code: string; kind: string; is_rack: boolean | null; level_no: number | null
  grid_x: number | null; grid_y: number | null; grid_w: number | null; grid_h: number | null
  max_pallets: number | null; is_pick_face: boolean | null; serve_categories: string[] | null
}
export interface PlanResult { created: number; cancelled: number; unset_items: number; warning: string | null }

const EMPTY: PlanResult = { created: 0, cancelled: 0, unset_items: 0, warning: null }

// ─── Sổ sự kiện ────────────────────────────────────────────────────────────────────────────────
async function logEvents(rows: { task_id: string; event: string; actor: string | null; note?: string | null }[]) {
  if (!rows.length) return
  const t = now()
  await supabase.from('wms_task_events').insert(
    rows.map(r => ({ id: randomUUID(), task_id: r.task_id, event: r.event, actor: r.actor ?? null, at: t, note: r.note ?? null })),
  )
}

/**
 * LẬP KẾ HOẠCH LẤY HÀNG cho một chuyến. Gọi lại được (idempotent): việc còn treo được TÍNH VÀO
 * nhu cầu nên chạy lần hai không đẻ thêm; chỉ bù đúng phần còn thiếu.
 * KHÔNG BAO GIỜ ném ra ngoài — Bắt đầu chuyến không được hỏng vì lập kế hoạch hỏng.
 */
export async function planGdoTasks(gdoId: string, actor: string | null): Promise<PlanResult> {
  try {
    return await planInner(gdoId, actor)
  } catch (e) {
    recordServerError('be', String((e as Error)?.message ?? e), 500, 'PLAN_FAILED', `directedTasks.planGdoTasks/${gdoId}`)
    return { ...EMPTY, warning: 'Không lập được kế hoạch lấy hàng cho chuyến này — chuyến vẫn xuất bình thường như chế độ Thủ công.' }
  }
}

async function planInner(gdoId: string, actor: string | null): Promise<PlanResult> {
  const { data: gdoRow } = await supabase.from('GroupDeliveryOrder')
    .select('id, warehouse_id, status, started_at, dock_location_id, warehouse:Warehouse(id,inventory_mode,work_mode,lower_from_level,rotation_principle,rotation_required)')
    .eq('id', gdoId).maybeSingle()
  if (!gdoRow) return EMPTY
  const gdo = gdoRow as unknown as {
    id: string; warehouse_id: string | null; status: string; started_at: string | null; dock_location_id: string | null
    warehouse: Record<string, unknown> | null
  }
  const whId = gdo.warehouse_id
  if (!whId) return EMPTY
  // Chuyến chưa chạy / đã kết thúc: không có việc gì để lập (huỷ việc treo là đường riêng)
  if (!gdo.started_at || !['IN_PROGRESS', 'PAUSED'].includes(gdo.status)) return EMPTY

  const { data: typeCfgs } = await supabase.from('warehouse_type_configs')
    .select('type_code, work_mode, lower_from_level, rotation_principle, rotation_required')
    .eq('warehouse_id', whId)
  const typeRows = (typeCfgs ?? []) as WhTypeConfigRow[]

  // ── Dòng hàng còn phải lấy ───────────────────────────────────────────────────────────────────
  const dos = await fetchAllRowsParallel(() => supabase.from('OutboundDelivery').select('id').eq('gdo_id', gdoId).order('id'))
  const doIds = (dos ?? []).map((d: { id: string }) => d.id)
  if (!doIds.length) return EMPTY
  const items = await fetchAllByIdChunks(doIds, chunk => supabase.from('OutboundItem')
    .select('id, material_id, material_code_raw, cartons_ordered, cartons_scanned, loose_picking, date_required, date_rule, pinned_pallets, batch_required, material:Material!material_id(category, short_name, shelf_life_days, supplier_shelf_life_overrides, no_qr_tracking)')
    .in('do_id', chunk).order('id')) as unknown as Array<{
      id: string; material_id: string | null; material_code_raw: string | null
      cartons_ordered: number | null; cartons_scanned: number | null; loose_picking: number | null
      date_required: number | null; date_rule: unknown; pinned_pallets: string[] | null; batch_required: string | null
      material: (MaterialShelfInfo & { category?: string | null; short_name?: string | null; no_qr_tracking?: boolean | null }) | null
    }>

  // Việc còn treo của CHÍNH chuyến này = phần đã lập trước đó (tính vào nhu cầu ⇒ idempotent)
  const { data: mineRaw } = await supabase.from('wms_tasks')
    .select('id, item_id, entry_id, qty_base, seq').eq('gdo_id', gdoId).eq('status', 'PENDING')
  const mine = (mineRaw ?? []) as { id: string; item_id: string; entry_id: string | null; qty_base: number; seq: number }[]
  const openByItem = new Map<string, { qty: number; rows: typeof mine }>()
  for (const t of mine) {
    const cur = openByItem.get(t.item_id) ?? { qty: 0, rows: [] as typeof mine }
    cur.qty += Number(t.qty_base); cur.rows.push(t)
    openByItem.set(t.item_id, cur)
  }

  // Nhu cầu từng dòng + phân loại theo cờ 2 tầng
  type Need = { item: (typeof items)[number]; rule: DateRule; qty: number; loose: number; lowerFrom: number }
  const needs: Need[] = []
  let unset = 0
  const cancelIds: string[] = []
  for (const it of items) {
    const cfg = resolveWorkMode(gdo.warehouse, typeRows, it.material?.category ?? null)
    const ordered = Number(it.cartons_ordered ?? 0), scanned = Number(it.cartons_scanned ?? 0)
    const open = openByItem.get(it.id)
    const remain = Math.max(0, ordered - scanned)
    if (cfg.mode !== 'GUIDED') {
      // Loại kho này chạy Thủ công: việc cũ (nếu có, do đổi cờ giữa chừng) phải dọn, không để rác
      for (const r of open?.rows ?? []) cancelIds.push(r.id)
      continue
    }
    // Đơn bị hạ SL (SAP dội xuống / sửa tay) ⇒ huỷ việc ĐUÔI cho khớp nhu cầu mới
    if ((open?.qty ?? 0) > remain) {
      let over = (open?.qty ?? 0) - remain
      for (const r of [...(open?.rows ?? [])].sort((a, b) => b.seq - a.seq)) {
        if (over <= 0) break
        cancelIds.push(r.id); over -= Number(r.qty_base)
      }
    }
    if (it.material?.no_qr_tracking) continue          // mã không theo tem: không có pallet để chỉ đường
    const rule = dateRuleOf(it)
    const need = remain - (open?.qty ?? 0)
    if (need <= 0) continue
    if (!rule) { unset++; continue }                   // CHƯA CHỐT date ⇒ không sinh việc (user chốt)
    needs.push({
      item: it, rule, qty: need,
      loose: Math.max(0, Number(it.loose_picking ?? 0) - scanned),
      lowerFrom: cfg.lowerFromLevel,
    })
  }

  let cancelled = 0
  if (cancelIds.length) cancelled = await cancelTasks(cancelIds, actor, 'PLAN_CHANGED')
  if (!needs.length) return { created: 0, cancelled, unset_items: unset, warning: null }

  // ── Bản vẽ kho: lưới + vị trí (BFS từ cửa của chuyến) ────────────────────────────────────────
  const [{ data: mapRow }, locsRaw] = await Promise.all([
    supabase.from('warehouse_maps').select('width, height, cell_m, blocked').eq('warehouse_id', whId).maybeSingle(),
    fetchAllRowsParallel(() => supabase.from('Location')
      .select('id, location_code, kind, is_rack, level_no, grid_x, grid_y, grid_w, grid_h, max_pallets, is_pick_face, serve_categories')
      .eq('warehouse_id', whId).eq('is_active', true).order('id')),
  ])
  const locs = (locsRaw ?? []) as LocRow[]
  const locById = new Map(locs.map(l => [l.id, l]))
  const map = mapRow as { width: number; height: number; cell_m: number; blocked: [number, number][] | null } | null
  let frame: GridFrame | null = null
  let dist: Int32Array | null = null
  let mask: Uint8Array | null = null
  let warning: string | null = null
  if (!map) {
    warning = 'Kho chưa có Sơ đồ kho — việc vẫn được lập nhưng KHÔNG có thứ tự đường đi. Vẽ Sơ đồ kho để có thứ tự.'
  } else {
    frame = { width: map.width, height: map.height }
    mask = buildBlockedMask(frame, map.blocked ?? [], locs as unknown as GridLoc[])
    // Xuất phát = cửa của chuyến; chuyến nội bộ / kho chưa vẽ cửa → điểm đầu dãy đầu tiên
    const startLoc = (gdo.dock_location_id ? locById.get(gdo.dock_location_id) : null)
      ?? locs.find(l => l.kind === 'DROP' && l.grid_x != null) ?? null
    const startCell: GridCell | null = startLoc && startLoc.grid_x != null && startLoc.grid_y != null
      ? { x: startLoc.grid_x, y: startLoc.grid_y } : null
    if (startCell) dist = bfsFrom(frame, mask, startCell).dist
    else warning = 'Chuyến chưa gắn cửa và kho chưa có điểm đầu dãy trên bản vẽ — việc không có thứ tự đường đi.'
  }
  const distOf = (l: LocRow | null | undefined): number | null => {
    if (!l || !frame || !dist || !mask) return null
    const cells = footprintCells(l as unknown as GridLoc)
    if (!cells.length) return null
    const d = distanceToCells(frame, mask, dist, cells)
    return d < 0 ? null : d
  }

  // ── Ứng viên pallet theo mã (một câu cho cả chuyến) ──────────────────────────────────────────
  const matIds = [...new Set(needs.map(n => n.item.material_id).filter((x): x is string => !!x))]
  if (!matIds.length) return { created: 0, cancelled, unset_items: unset, warning }
  const candRaw = await fetchAllByIdChunks(matIds, chunk => supabase.from('InventoryEntry')
    .select('id, pallet_code, material_id, location_id, batch, qa_status_id, cartons_remaining, cartons_imported, cartons_reserved, production_date, expiry_date, ncc_id, shelf_life_days')
    .in('material_id', chunk)
    .eq('warehouse_id', whId)
    .in('status', [...PICKABLE_STATUSES])
    .is('qa_status_id', null)          // pallet bị QA giữ thì lúc quét bị chặn — chỉ đường tới đó là đẩy người đi vô ích
    .gt('cartons_remaining', 0)
    .order('id')) as unknown as Cand[]

  // Pallet ĐÃ CÓ CHỦ: đang là việc treo của chuyến KHÁC trong kho này (giữ chỗ mềm)
  const { data: takenRaw } = await supabase.from('wms_tasks')
    .select('entry_id, gdo_id').eq('warehouse_id', whId).eq('status', 'PENDING')
  const taken = new Set((takenRaw ?? [])
    .filter((t: { gdo_id: string }) => t.gdo_id !== gdoId)
    .map((t: { entry_id: string | null }) => t.entry_id)
    .filter((x: string | null): x is string => !!x))
  // Pallet chính chuyến này đã lập việc rồi → không lập lần hai (unique riêng phần cũng gác ở DB)
  for (const t of mine) if (t.entry_id) taken.add(t.entry_id)

  const byMat = new Map<string, Cand[]>()
  for (const c of (candRaw ?? [])) {
    if (!c.material_id || taken.has(c.id)) continue
    if (!isPickEligible(c)) continue
    const arr = byMat.get(c.material_id) ?? []
    arr.push(c); byMat.set(c.material_id, arr)
  }

  // ── Vị trí NHẶT LẺ đủ điều kiện (đích của việc LOOSE_FEED) ───────────────────────────────────
  const pickFaces = locs.filter(l => l.kind === 'STORAGE' && l.is_pick_face === true)

  // ── Chia việc ────────────────────────────────────────────────────────────────────────────────
  const nowT = now()
  type NewTask = Record<string, unknown> & { from_location_id: string | null }
  const built: NewTask[] = []

  for (const n of needs) {
    const it = n.item
    const mat = it.material ?? null
    const principle: RotationPrinciple = resolveRotation(gdo.warehouse, typeRows, mat?.category ?? null).principle
    let pool = (byMat.get(it.material_id ?? '') ?? []).filter(c => matchesRule(c, mat, n.rule))
    if (!pool.length) continue

    // Thứ tự: LUẬT LUÂN CHUYỂN trước (không bao giờ vì gần cửa mà lấy sai thứ tự), rồi gần cửa,
    // rồi tầng thấp (đỡ phải hạ), rồi ô ít hàng nhất (dọn hàng lẻ), rồi mã ô.
    const keyOf = new Map<string, number | null>()
    const dOf = new Map<string, number | null>()
    for (const c of pool) {
      keyOf.set(c.id, rotationSortKey(c, mat, principle))
      dOf.set(c.id, distOf(c.location_id ? locById.get(c.location_id) : null))
    }
    pool = pool.sort((a, b) => {
      const ka = keyOf.get(a.id) ?? Infinity, kb = keyOf.get(b.id) ?? Infinity
      if (ka !== kb) return ka - kb
      const da = dOf.get(a.id) ?? Infinity, db = dOf.get(b.id) ?? Infinity
      if (da !== db) return da - db
      const la = locById.get(a.location_id ?? '')?.level_no ?? 0, lb = locById.get(b.location_id ?? '')?.level_no ?? 0
      if (la !== lb) return la - lb
      const va = availableOf(a), vb = availableOf(b)
      if (va !== vb) return va - vb
      return naturalCompare(locById.get(a.location_id ?? '')?.location_code ?? '', locById.get(b.location_id ?? '')?.location_code ?? '')
    })

    // Phần NHẶT LẺ đã có sẵn ở vị trí nhặt lẻ thì không phải hạ thêm (user chốt 0.9)
    const looseOnHand = n.loose > 0
      ? pool.filter(c => locById.get(c.location_id ?? '')?.is_pick_face === true)
          .reduce((s, c) => s + availableOf(c), 0)
      : 0
    let looseLeft = Math.max(0, n.loose - looseOnHand)

    let left = n.qty
    for (const c of pool) {
      if (left <= 0) break
      const loc = c.location_id ? locById.get(c.location_id) : null
      // Pallet đang nằm sẵn ở vị trí nhặt lẻ: thủ kho lấy tại chỗ, không cần xe nâng
      if (loc?.is_pick_face === true && looseOnHand > 0) { left -= Math.min(left, availableOf(c)); continue }
      const take = Math.min(left, availableOf(c))
      if (take <= 0) continue
      const isLoose = looseLeft > 0
      const dest = isLoose ? pickFaceFor(pickFaces, mat?.category ?? null, loc, locById, distOf) : null
      if (isLoose && !dest) {
        // Kho chưa khai vị trí nhặt lẻ → nói ra, không im lặng biến phần lẻ thành việc ra cửa
        warning = warning ?? 'Kho chưa khai VỊ TRÍ NHẶT LẺ — phần hàng lẻ chưa có chỗ hạ xuống (khai ở trang Vị trí kho).'
      }
      const kind = isLoose && dest ? 'LOOSE_FEED' : 'PICK'
      const lvl = loc?.level_no ?? null
      // Cần XE NÂNG HẠ: việc ra cửa theo ngưỡng tầng của kho; việc về nhặt lẻ thì MỌI ô KỆ đều cần
      // (user 10/09: "cần hạ thì cũng phải lấy xuống chứ xe nâng chuyển không tự lấy").
      const needsLower = kind === 'LOOSE_FEED'
        ? loc?.is_rack === true
        : (lvl != null && lvl >= n.lowerFrom)
      const drop = kind === 'PICK' && needsLower ? dropFor(locs, mat?.category ?? null, loc, distOf) : null
      built.push({
        id: randomUUID(), warehouse_id: whId, gdo_id: gdoId, item_id: it.id,
        entry_id: c.id, pallet_code: c.pallet_code,
        material_id: it.material_id ?? null, material_code: it.material_code_raw ?? null,
        qty_base: take, is_partial: take < availableOf(c),
        kind,
        from_location_id: loc?.id ?? null, from_location_code: loc?.location_code ?? null,
        level_no: lvl, needs_lower: needsLower,
        drop_location_id: drop?.id ?? null,
        to_location_id: kind === 'LOOSE_FEED' ? dest?.id ?? null : gdo.dock_location_id,
        to_kind: kind === 'LOOSE_FEED' ? 'PICK_FACE' : (gdo.dock_location_id ? 'DOCK' : null),
        dist_cells: dOf.get(c.id) ?? null,
        seq: 0, status: 'PENDING', plan_version: 1,
        created_at: nowT, updated_at: nowT,
      })
      left -= take
      if (isLoose) looseLeft -= Math.min(looseLeft, take)
    }
  }

  // ── Thứ tự đi: vòng ngắn nhất từ cửa qua các VỊ TRÍ (cùng vị trí thì tầng cao trước) ─────────
  // Đánh số trên CẢ việc cũ còn treo lẫn việc mới: đổi cửa giữa chuyến thì đường đi đổi, mà kế hoạch
  // cũ vẫn trỏ cửa cũ ⇒ xe nâng đi sai chỗ. Việc cũ được cập nhật đích + thứ tự cho khớp cửa hiện tại
  // (mốc "đã hạ / đã đưa ra" của chúng giữ nguyên — người ta đã làm rồi).
  const { data: openNowRaw } = await supabase.from('wms_tasks')
    .select('id, from_location_id, level_no, seq, kind, to_location_id, to_kind, dist_cells')
    .eq('gdo_id', gdoId).eq('status', 'PENDING')
  const openNow = ((openNowRaw ?? []) as Array<Record<string, unknown> & { id: string; from_location_id: string | null }>)
    .filter(r => !cancelIds.includes(r.id as string))
  const all = [...openNow, ...built]
  if (!all.length) return { created: 0, cancelled, unset_items: unset, warning }
  // Chụp lại giá trị CŨ trước khi đánh số — assignSeq ghi đè `seq` tại chỗ, so sau đó là so với chính nó
  const before = new Map(openNow.map(r => [r.id, { seq: r.seq as number, to: r.to_location_id as string | null, kind: r.to_kind as string | null, dist: r.dist_cells as number | null }]))
  assignSeq(all, locById, frame, mask, dist, gdo.dock_location_id, locById.get(gdo.dock_location_id ?? '') ?? null)

  // Chèn theo lô; đụng unique (chuyến, pallet) = pallet vừa bị lập ở lượt khác → bỏ dòng đó, không hỏng cả mẻ
  let created = 0
  const inserted: string[] = []
  if (built.length) {
    const { error } = await supabase.from('wms_tasks').insert(built)
    if (error) {
      if (error.code !== '23505') throw error
      for (const row of built) {
        const { error: e1 } = await supabase.from('wms_tasks').insert(row)
        if (!e1) { created++; inserted.push(row.id as string) }
      }
    } else { created = built.length; inserted.push(...built.map(b => b.id as string)) }
    await logEvents(inserted.map(id => ({ task_id: id, event: 'PLANNED', actor })))
  }

  // Cập nhật việc CŨ nếu đích hoặc thứ tự đổi (đổi cửa / vẽ lại bản đồ / có thêm việc chen vào)
  for (const r of openNow) {
    const wantTo = r.kind === 'LOOSE_FEED' ? (r.to_location_id as string | null) : gdo.dock_location_id
    const wantKind = r.kind === 'LOOSE_FEED' ? 'PICK_FACE' : (gdo.dock_location_id ? 'DOCK' : null)
    const wantDist = distOf(locById.get((r.from_location_id ?? '') as string))
    const old = before.get(r.id)
    if (old && old.seq === r.seq && old.to === wantTo && old.kind === wantKind && old.dist === wantDist) continue
    await supabase.from('wms_tasks').update({
      seq: r.seq, to_location_id: wantTo, to_kind: wantKind, dist_cells: wantDist, updated_at: nowT,
    }).eq('id', r.id).eq('status', 'PENDING')
  }

  return { created, cancelled, unset_items: unset, warning }
}

/** Pallet có khớp quy tắc date của dòng đơn không. Đây là chỗ DUY NHẤT diễn giải DateRule. */
function matchesRule(c: Cand, mat: MaterialShelfInfo | null, rule: DateRule): boolean {
  if (rule.kind === 'FEFO') return true
  if (rule.kind === 'MIN_PCT') {
    const pct = computePctDate(c, mat)
    return pct != null && pct >= Number(rule.value ?? 0)
  }
  // EXACT: khớp NSX (yyyy-mm-dd) · HSD · mã lô · hoặc tem pallet
  const v = String(rule.value ?? '').trim()
  if (!v) return false
  const d = (x: string | Date | null | undefined) => (x ? new Date(x).toISOString().slice(0, 10) : '')
  return d(c.production_date) === v || d(c.expiry_date) === v || (c.batch ?? '') === v || c.pallet_code === v
}

/** Vị trí nhặt lẻ đích: đúng Loại kho phục vụ, còn chỗ, gần pallet nhất. */
function pickFaceFor(
  faces: LocRow[], category: string | null, from: LocRow | null | undefined,
  _byId: Map<string, LocRow>, distOf: (l: LocRow | null | undefined) => number | null,
): LocRow | null {
  const ok = faces.filter(f => servesCategory(f, category))
  if (!ok.length) return null
  return ok.slice().sort((a, b) => (distOf(a) ?? Infinity) - (distOf(b) ?? Infinity)
    || naturalCompare(a.location_code, b.location_code))[0] ?? null
}

/** Điểm đầu dãy để xe hạ đặt pallet xuống: đúng Loại kho phục vụ, gần ô nguồn nhất. */
function dropFor(
  locs: LocRow[], category: string | null, _from: LocRow | null | undefined,
  distOf: (l: LocRow | null | undefined) => number | null,
): LocRow | null {
  const drops = locs.filter(l => l.kind === 'DROP' && servesCategory(l, category))
  if (!drops.length) return null
  return drops.slice().sort((a, b) => (distOf(a) ?? Infinity) - (distOf(b) ?? Infinity)
    || naturalCompare(a.location_code, b.location_code))[0] ?? null
}

/**
 * Cửa / điểm đầu dãy có phục vụ Loại kho này không — GIAO ≥ 1 như luật chuyến chở lẫn.
 * Rỗng/NULL = phục vụ MỌI loại (mặc định, bản vẽ cũ không đổi hành vi).
 */
export function servesCategory(loc: { serve_categories?: string[] | null } | null | undefined, category: string | null | undefined): boolean {
  const list = (loc?.serve_categories ?? []).filter(Boolean)
  if (!list.length) return true
  if (!category) return true          // hàng không khai loại: không kết luận, cho qua (null-inclusive)
  return category.split('+').map(s => s.trim()).filter(Boolean).some(c => list.includes(c))
}

/** Đánh số thứ tự đi: vòng ngắn nhất từ cửa qua các VỊ TRÍ khác nhau; cùng vị trí thì tầng cao trước. */
function assignSeq(
  rows: Array<Record<string, unknown> & { from_location_id: string | null }>,
  locById: Map<string, LocRow>,
  frame: GridFrame | null, mask: Uint8Array | null, dist: Int32Array | null,
  dockId: string | null, dockLoc: LocRow | null,
) {
  const groups = new Map<string, typeof rows>()
  for (const r of rows) {
    const k = r.from_location_id ?? '(chưa đặt)'
    const arr = groups.get(k) ?? []
    arr.push(r); groups.set(k, arr)
  }
  const keys = [...groups.keys()]
  let order = keys
  if (frame && mask && dist && dockLoc && dockLoc.grid_x != null && dockLoc.grid_y != null) {
    const targets = keys.map(k => {
      const l = locById.get(k)
      return l ? footprintCells(l as unknown as GridLoc) : []
    })
    const idx = orderByNearest(frame, mask, { x: dockLoc.grid_x, y: dockLoc.grid_y }, targets)
    order = idx.map(i => keys[i])
  } else {
    // Không có bản vẽ / chưa gắn cửa: ít nhất đi theo mã vị trí cho khỏi nhảy loạn xạ
    order = keys.slice().sort((a, b) => naturalCompare(locById.get(a)?.location_code ?? a, locById.get(b)?.location_code ?? b))
  }
  let seq = 1
  for (const k of order) {
    const arr = (groups.get(k) ?? []).slice()
      .sort((a, b) => Number(b.level_no ?? 0) - Number(a.level_no ?? 0))   // tầng cao trước (hạ từ trên xuống)
    for (const r of arr) r.seq = seq++
  }
  void dockId
}

// ─── ĐÓNG VIỆC ─────────────────────────────────────────────────────────────────────────────────

/** Thủ kho quét đúng pallet đang có việc → việc XONG (điền nốt mốc chặng còn trống). */
export async function markTaskDoneByScan(
  gdoId: string, entryId: string | null, scanEntryId: string | null, actor: string | null,
): Promise<boolean> {
  if (!entryId) return false
  const { data } = await supabase.from('wms_tasks')
    .select('id, lowered_at, moved_at, needs_lower').eq('gdo_id', gdoId).eq('entry_id', entryId).eq('status', 'PENDING').limit(1)
  const t = (data ?? [])[0] as { id: string; lowered_at: string | null; moved_at: string | null; needs_lower: boolean } | undefined
  if (!t) return false
  const at = now()
  await supabase.from('wms_tasks').update({
    status: 'DONE', done_at: at, done_by: actor, scan_entry_id: scanEntryId,
    confirm_source: 'SCAN',
    ...(t.needs_lower && !t.lowered_at ? { lowered_at: at, lowered_by: actor } : {}),
    ...(t.moved_at ? {} : { moved_at: at, moved_by: actor }),
    updated_at: at,
  }).eq('id', t.id)
  await logEvents([{ task_id: t.id, event: 'DONE', actor, note: 'quét đủ' }])
  return true
}

/** Quét pallet KHÁC cùng dòng hàng → bỏ một việc treo của dòng đó (kế hoạch tự lành sau khi sắp bù). */
export async function skipOnePendingOfItem(gdoId: string, itemId: string, reason: string, actor: string | null): Promise<boolean> {
  const { data } = await supabase.from('wms_tasks')
    .select('id').eq('gdo_id', gdoId).eq('item_id', itemId).eq('status', 'PENDING')
    .order('seq', { ascending: false }).limit(1)
  const id = (data ?? [])[0]?.id as string | undefined
  if (!id) return false
  await supabase.from('wms_tasks').update({ status: 'SKIPPED', skip_reason: reason, updated_at: now() }).eq('id', id)
  await logEvents([{ task_id: id, event: 'SKIPPED', actor, note: reason }])
  return true
}

/** Chuyến khác vừa lấy mất pallet đang là việc của mình → bỏ việc đó + sắp bù cho chuyến bị mất. */
export async function skipTasksOnForeignScan(entryId: string | null, exceptGdoId: string, actor: string | null): Promise<void> {
  if (!entryId) return
  const { data } = await supabase.from('wms_tasks')
    .select('id, gdo_id').eq('entry_id', entryId).eq('status', 'PENDING').neq('gdo_id', exceptGdoId)
  const rows = (data ?? []) as { id: string; gdo_id: string }[]
  if (!rows.length) return
  await supabase.from('wms_tasks')
    .update({ status: 'SKIPPED', skip_reason: 'PALLET_TAKEN', updated_at: now() })
    .in('id', rows.map(r => r.id))
  await logEvents(rows.map(r => ({ task_id: r.id, event: 'SKIPPED', actor, note: 'PALLET_TAKEN' })))
  for (const g of [...new Set(rows.map(r => r.gdo_id))]) await planGdoTasks(g, actor)
}

async function cancelTasks(ids: string[], actor: string | null, reason: string): Promise<number> {
  if (!ids.length) return 0
  const { data } = await supabase.from('wms_tasks')
    .update({ status: 'CANCELLED', skip_reason: reason, updated_at: now() })
    .in('id', ids).eq('status', 'PENDING').select('id')
  const done = (data ?? []) as { id: string }[]
  await logEvents(done.map(r => ({ task_id: r.id, event: 'CANCELLED', actor, note: reason })))
  return done.length
}

/** Bỏ Bắt đầu / Huỷ / Hoàn thành chuyến → mọi việc còn treo của chuyến đó hết hiệu lực. */
export async function cancelGdoTasks(gdoId: string, reason: string, actor: string | null): Promise<number> {
  const { data } = await supabase.from('wms_tasks').select('id').eq('gdo_id', gdoId).eq('status', 'PENDING')
  return cancelTasks((data ?? []).map((r: { id: string }) => r.id), actor, reason)
}

// ─── NÚT "✓ XONG" (xe nâng tự đánh dấu — phòng quên) ───────────────────────────────────────────
export type ConfirmStage = 'LOWER' | 'MOVE'
export interface ConfirmResult { ok: true; changed: number; moved_pallets: number }

/**
 * Đánh dấu / bỏ đánh dấu một NHÓM việc (bảng xe nâng gom theo vị trí nên FE gửi cả nhóm).
 * Việc LOOSE_FEED khi xác nhận xong chặng của nó thì CHUYỂN PALLET trong tồn về vị trí nhặt lẻ —
 * thủ kho sẽ trừ thùng tại đó nên tồn phải nằm đúng chỗ (khác PICK: pallet ra cửa rồi rời kho).
 */
export async function confirmTasks(
  taskIds: string[], stage: ConfirmStage, undo: boolean, actor: string | null,
): Promise<ConfirmResult | { ok: false; status: number; code: string; message: string }> {
  if (!taskIds.length) return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: 'Chưa chọn việc nào' }
  const { data } = await supabase.from('wms_tasks')
    .select('id, kind, status, needs_lower, entry_id, to_location_id, lowered_at, moved_at, from_location_code')
    .in('id', taskIds)
  const rows = (data ?? []) as {
    id: string; kind: string; status: string; needs_lower: boolean; entry_id: string | null
    to_location_id: string | null; lowered_at: string | null; moved_at: string | null; from_location_code: string | null
  }[]
  if (!rows.length) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Không tìm thấy việc (có thể đã bị huỷ hoặc chuyến đã kết thúc)' }
  const open = rows.filter(r => r.status === 'PENDING')
  if (!open.length) return { ok: false, status: 409, code: 'ALREADY_DONE', message: 'Việc này đã xong hoặc không còn hiệu lực' }
  if (stage === 'LOWER' && open.some(r => !r.needs_lower))
    return { ok: false, status: 400, code: 'NOT_LOWERABLE', message: 'Có việc không thuộc diện phải hạ' }

  const at = now()
  const patch = undo
    ? (stage === 'LOWER' ? { lowered_at: null, lowered_by: null } : { moved_at: null, moved_by: null })
    : (stage === 'LOWER' ? { lowered_at: at, lowered_by: actor } : { moved_at: at, moved_by: actor })

  // Hàng về vị trí nhặt lẻ: xác nhận = pallet ĐÃ NẰM ở đó ⇒ ghi tồn theo. Đích đầy thì KHÔNG đánh dấu
  // (không tạo ngõ cụt: việc vẫn treo, người bấm được báo chọn chỗ khác — cùng luật Fill).
  let movedPallets = 0
  if (!undo) {
    for (const r of open.filter(x => x.kind === 'LOOSE_FEED' && x.entry_id && x.to_location_id)) {
      const { data: mv } = await supabase.rpc('move_pallets_to_location', {
        p_ids: [r.entry_id], p_location_id: r.to_location_id,
        p_updated_by: actor, p_update_date: at.slice(0, 10), p_now: at,
      })
      const msg = String(mv ?? '')
      if (msg.startsWith('FULL')) {
        return { ok: false, status: 409, code: 'LOCATION_FULL', message: `Vị trí nhặt lẻ đã đầy — đổi vị trí đến rồi bấm lại (pallet ${r.from_location_code ?? ''}).` }
      }
      movedPallets++
    }
  }

  const { data: upd } = await supabase.from('wms_tasks')
    .update({ ...patch, confirm_source: undo ? null : 'MANUAL', updated_at: at })
    .in('id', open.map(r => r.id)).eq('status', 'PENDING').select('id')
  const changed = ((upd ?? []) as { id: string }[]).length
  await logEvents(((upd ?? []) as { id: string }[]).map(r => ({
    task_id: r.id, event: undo ? 'REPLANNED' : (stage === 'LOWER' ? 'LOWERED' : 'MOVED'), actor,
    note: undo ? `bỏ đánh dấu ${stage}` : null,
  })))
  return { ok: true, changed, moved_pallets: movedPallets }
}
