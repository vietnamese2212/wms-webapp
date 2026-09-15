/**
 * TỰ RA LỆNH FILL HÀNG NHẶT LẺ — user chốt 15/09 ("fill hàng phục vụ nhặt lẻ, ra lệnh tự động được
 * không?" · "tự động hoặc bằng tay thì cần có setting cho Kho và loại kho nha").
 *
 * VÌ SAO: đo staging 15/09 — module Fill ra 05/08 mà tới nay **0 lệnh fill** nào được tạo, trong khi
 * đường tự động sẵn có (việc `LOOSE_FEED` bộ lập kế hoạch đặt lúc Bắt đầu chuyến) đã chạy thật. Nút
 * "Ra lệnh fill" là một nhát bấm nằm giữa "máy đã biết phải hạ gì" và "người đi hạ" — sáu tuần cho
 * thấy không ai đi qua nó, và hệ quả là bảng "Theo vị trí" đòi fill mà trang Fill thì 0 lệnh.
 *
 * RANH GIỚI (user chốt): máy quyết **ĐỂ LÀM GÌ**, người quyết **AI LÀM và LÚC NÀO** ⇒ lệnh tạo ra
 * KHÔNG gán ai. Nhánh "lệnh fill chưa ai nhận" của `work_inbox` đã có sẵn nên nó tự hiện ở Hộp việc
 * → "Việc chung của kho"; không cần màn hình mới, không đổ chuông cho ai (chưa có ai để gọi).
 *
 * CHỈ NGÀY XUẤT HÔM NAY (user chốt): ô nhặt lẻ có sức chứa — đo 15/09 cả hệ thống chỉ có 28 ô. Fill
 * trước cho nhiều ngày là chiếm chỗ bằng hàng chưa ai cần, và đơn ngày mai còn đổi/huỷ được.
 *
 * MỌI phép tính nhu cầu đi qua `fillDemandOf` — đúng con số mà trang Đề xuất đang hiện. Viết lại ở
 * đây là đẻ bản luật thứ hai: máy hạ một đằng, màn hình nói một nẻo.
 */
import { randomUUID } from 'crypto'
import { db } from '../lib/supabase'
import {
  fillDemandOf, buildPickFaceIdx, takePickFace, fillOrderRollup,
  type FillDemandRow,
} from '../controllers/wms/fillController'
import { resolveAutoFill, type WhTypeConfigRow } from '../utils/putaway'

const now = () => new Date().toISOString()
// Ngày NGHIỆP VỤ theo giờ VN (luật timezone CLAUDE.md) — "hôm nay" của kho, không phải của máy chủ
export const vnToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

export interface AutoFillResult {
  created: number            // số DÒNG lệnh vừa đặt
  recalled: number           // số dòng máy từng đặt, nay thu hồi vì hết nhu cầu
  order_code: string | null
  unset: string[]            // mã bỏ qua vì còn dòng CHƯA CHỐT %Date
  no_dest: string[]          // mã bỏ qua vì không còn ô nhặt lẻ trống nhận Loại kho đó
}
const EMPTY: AutoFillResult = { created: 0, recalled: 0, order_code: null, unset: [], no_dest: [] }

/**
 * Nhịp chạy: KHÔNG có pg_cron trên hạ tầng này nên quét LƯỜI theo traffic, throttle trong tiến trình
 * y như `alertScanner` / `cleanupOldPhotos`. Chạy trùng giữa hai instance không sinh lệnh đôi: nhu cầu
 * đã trừ phần đang treo, và unique `uq_filltask_pending_matdate` gác nốt (máy gặp 23505 thì BỎ QUA,
 * KHÔNG cộng dồn như đường bấm tay — người bấm hai lần là chủ ý, máy chạy hai lần thì không).
 */
const THROTTLE_MS = 10 * 60_000
const _lastRun = new Map<string, number>()

export async function autoFillDay(
  warehouseId: string, day: string, opts: { force?: boolean } = {},
): Promise<AutoFillResult> {
  const key = `${warehouseId}|${day}`
  if (!opts.force && Date.now() - (_lastRun.get(key) ?? 0) < THROTTLE_MS) return EMPTY
  _lastRun.set(key, Date.now())

  // ── Công tắc 2 TẦNG: mặc định của kho + ghi đè theo LOẠI KHO (`resolveAutoFill`, một luật ghép
  // tầng dùng chung với luân chuyển/cách làm việc). Kho tắt mà KHÔNG loại nào bật ⇒ về ngay, hai
  // câu nhẹ — đây là đường chạy của 153/153 kho hôm nay nên nó phải rẻ.
  const [{ data: wh }, { data: cfgRaw }] = await Promise.all([
    db.from('Warehouse').select('id, auto_fill').eq('id', warehouseId).maybeSingle(),
    db.from('warehouse_type_configs').select('type_code, auto_fill').eq('warehouse_id', warehouseId),
  ])
  if (!wh) return EMPTY
  const typeRows = (cfgRaw ?? []) as unknown as WhTypeConfigRow[]
  if (wh.auto_fill !== true && !typeRows.some(t => t.auto_fill === true)) return EMPTY

  const payload = await fillDemandOf(warehouseId, day)
  // Kho chưa khai ô nhặt lẻ nào ⇒ không có luật này (cùng khuôn "kho có vẽ cửa thì mới bắt chọn cửa")
  if (!Number(payload?.pick_face_locations ?? 0)) return EMPTY
  const rows = (payload?.rows ?? []) as FillDemandRow[]

  const matIds = [...new Set(rows.map(r => r.material_id).filter(Boolean))]
  const mats = new Map<string, { code: string; name: string | null; category: string | null }>()
  for (let i = 0; i < matIds.length; i += 300) {
    const { data } = await db.from('Material')
      .select('id, material_code, short_name, category').in('id', matIds.slice(i, i + 300))
    for (const m of data ?? []) mats.set(m.id, { code: m.material_code, name: m.short_name, category: m.category })
  }
  const onFor = (materialId: string) =>
    resolveAutoFill(wh as unknown as Record<string, unknown>, typeRows, mats.get(materialId)?.category ?? null).enabled

  const result: AutoFillResult = { created: 0, recalled: 0, order_code: null, unset: [], no_dest: [] }
  result.recalled = await recallStale(warehouseId, day, rows, onFor)

  // ── Dựng dòng lệnh ───────────────────────────────────────────────────────────────────────────
  const pfIdx = await buildPickFaceIdx(warehouseId, matIds)
  const lines: Record<string, unknown>[] = []
  const t = now()
  for (const r of rows) {
    if (!r.material_id || !onFor(r.material_id)) continue
    const mat = mats.get(r.material_id)
    if (!mat) continue
    // CHƯA CHỐT %DATE ⇒ máy KHÔNG tự chọn lô hộ (luật 10/09 "chưa chốt thì chưa được lấy"). Người
    // chốt xong thì lượt sau tự có lệnh — nói ra ở đây để màn hình còn giục đúng việc.
    if (r.rule_unset) { result.unset.push(mat.code); continue }
    if (Number(r.short_base ?? 0) <= 0) continue
    const sug = r.suggestions ?? []
    if (!sug.length) continue                     // thiếu nhưng không còn pallet nào để hạ — lệnh rỗng vô nghĩa

    // MỘT DÒNG LỆNH = MỘT NSX: cửa quét khớp `required_date` với `production_date` của tem, và khoá
    // unique của bảng cũng là (kho, ngày, mã, date). Gợi ý tham lam có thể trải qua hai NSX khi một
    // pallet không đủ ⇒ tách theo NSX, đừng gộp rồi ghi bừa một ngày.
    const byDate = new Map<string | null, typeof sug>()
    for (const s of sug) {
      const d = s.production_date ? String(s.production_date).slice(0, 10) : null
      byDate.set(d, [...(byDate.get(d) ?? []), s])
    }
    let left = Number(r.short_base)
    for (const [reqDate, group] of byDate) {
      if (left <= 0) break
      const qty = Math.min(left, group.reduce((s, x) => s + Number(x.avail ?? 0), 0))
      if (qty <= 0) continue
      const dest = takePickFace(pfIdx, r.material_id, mat.category, group.length)
      if (!dest) { result.no_dest.push(mat.code); break }
      lines.push({
        id: randomUUID(), warehouse_id: warehouseId, target_date: day,
        material_id: r.material_id, material_code: mat.code, material_name: mat.name,
        required_date: reqDate, required_expiry: group[0]?.expiry_date ?? null,
        required_pallets: group.length, qty_base: qty,
        from_location_code: group[0]?.from_location_code ?? null,
        to_location_id: dest.id, to_location_code: dest.code,
        status: 'PENDING',
        assignee_id: null, assignee_name: null,      // KHÔNG gán ai — người tự nhận ở Hộp việc
        created_by: AUTO_ACTOR, created_at: t, updated_at: t,
      })
      left -= qty
    }
  }
  if (!lines.length) return result

  // ── Một lệnh gom mọi dòng vừa dựng ───────────────────────────────────────────────────────────
  const order = await newOrder(warehouseId, day, t)
  if (!order) return result
  for (const l of lines) l.fill_order_id = order.id
  // 23505 = (kho, ngày, mã, date) ĐANG có dòng treo ⇒ BỎ QUA dòng đó, không cộng dồn. Ghi cả lô
  // trước; đụng thì rơi xuống từng dòng để một mã trùng không làm hỏng cả mẻ.
  const { error } = await db.from('FillTask').insert(lines as never)
  if (!error) result.created = lines.length
  else {
    for (const l of lines) {
      const { error: e1 } = await db.from('FillTask').insert(l as never)
      if (!e1) result.created++
      else if ((e1 as { code?: string }).code !== '23505') throw e1
    }
  }
  if (!result.created) {                    // lệnh rỗng thì đừng để lại vỏ
    await db.from('FillOrder').delete().eq('id', order.id)
    return result
  }
  result.order_code = order.order_code
  return result
}

const AUTO_ACTOR = 'Hệ thống'

/**
 * Bọc cho các ĐƯỜNG ĐỌC gọi kèm (trang Việc cần làm, trang Nhặt lẻ): việc nền hỏng thì trang vẫn
 * phải mở được — người đang vào ca không có gì để làm với lỗi của bộ đặt lệnh. Vẫn ghi log để còn
 * thấy. `await` chứ không `void fn()`: trên serverless, response trả xong là lambda có thể bị đóng
 * băng giữa việc (luật CLAUDE.md).
 */
export async function autoFillSafe(warehouseId: string | null | undefined, day = vnToday()): Promise<AutoFillResult> {
  if (!warehouseId) return EMPTY
  try { return await autoFillDay(warehouseId, day) } catch (e) {
    console.error('autoFill:', e instanceof Error ? e.message : String(e))
    return EMPTY
  }
}

async function newOrder(warehouseId: string, day: string, t: string): Promise<{ id: string; order_code: string } | null> {
  const prefix = 'F' + day.slice(2).replace(/-/g, '') + '-'
  for (let attempt = 0; attempt < 5; attempt++) {
    const { count } = await db.from('FillOrder')
      .select('id', { count: 'exact', head: true }).like('order_code', `${prefix}%`)
    const { data, error } = await db.from('FillOrder').insert({
      id: randomUUID(), order_code: prefix + String((count ?? 0) + 1 + attempt).padStart(2, '0'),
      warehouse_id: warehouseId, target_date: day, status: 'PENDING',
      auto_created: true, created_by: AUTO_ACTOR, created_at: t, updated_at: t,
    }).select('id, order_code').single()
    if (!error && data) return data
    if ((error as { code?: string } | null)?.code !== '23505') throw error
    await new Promise(r => setTimeout(r, 100 + Math.random() * 300))
  }
  return null
}

/**
 * THU HỒI lệnh máy đặt mà nhu cầu đã hết (đơn huỷ · đổi ngày · hàng đã có đủ đúng lô ở ô lẻ).
 * Không có bước này thì có người đi hạ một pallet không ai cần VÀ chiếm mất ô nhặt lẻ — đúng lớp lỗi
 * "kế hoạch tĩnh" đã phải vá ở Việc cần làm (14/09). Chỉ đụng dòng CHƯA AI ĐỤNG: do máy đặt, còn
 * treo, chưa gán ai, chưa quét pallet nào. Và chỉ thu hồi trọn dòng khi phần THỪA còn đủ lớn để nuốt
 * nó — cắt nửa vời làm kế hoạch nhấp nháy giữa hai lượt tải.
 */
async function recallStale(
  warehouseId: string, day: string, rows: FillDemandRow[], onFor: (id: string) => boolean,
): Promise<number> {
  const { data: autoOrders } = await db.from('FillOrder')
    .select('id').eq('warehouse_id', warehouseId).eq('target_date', day).eq('auto_created', true)
  const autoIds = new Set((autoOrders ?? []).map(o => o.id))
  if (!autoIds.size) return 0

  const { data: openRaw } = await db.from('FillTask')
    .select('id, material_id, qty_base, qty_done_base, fill_order_id, assignee_id, scanned_pallets, created_at')
    .eq('warehouse_id', warehouseId).eq('target_date', day).eq('status', 'PENDING')
  const open = (openRaw ?? []) as Array<{
    id: string; material_id: string | null; qty_base: number; qty_done_base: number | null
    fill_order_id: string | null; assignee_id: string | null; scanned_pallets: number | null; created_at: string | null
  }>
  if (!open.length) return 0

  // Nhu cầu THẬT của mã = cần − đã có đúng lô ở ô lẻ (KHÔNG trừ phần đang treo: chính phần treo là
  // thứ đang được đem ra cân xem có thừa không).
  const need = new Map<string, number>()
  for (const r of rows) {
    if (!r.material_id) continue
    need.set(r.material_id, Math.max(0, Number(r.demand_base ?? 0) - Number(r.pick_face_ok_base ?? 0)))
  }

  const byMat = new Map<string, typeof open>()
  for (const l of open) {
    if (!l.material_id) continue
    byMat.set(l.material_id, [...(byMat.get(l.material_id) ?? []), l])
  }
  const kill: string[] = []
  const touchedOrders = new Set<string>()
  for (const [matId, list] of byMat) {
    if (!onFor(matId)) continue
    const remainOf = (l: (typeof list)[number]) => Math.max(0, Number(l.qty_base) - Number(l.qty_done_base ?? 0))
    let excess = list.reduce((s, l) => s + remainOf(l), 0) - (need.get(matId) ?? 0)
    if (excess <= 0) continue
    // Mới nhất bỏ trước (dòng cũ có thể đã được ai đó nhìn thấy trong ca)
    const cand = list
      .filter(l => l.fill_order_id && autoIds.has(l.fill_order_id) && !l.assignee_id && !Number(l.scanned_pallets ?? 0))
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    for (const l of cand) {
      const q = remainOf(l)
      if (q > excess) continue
      kill.push(l.id); excess -= q
      if (l.fill_order_id) touchedOrders.add(l.fill_order_id)
    }
  }
  if (!kill.length) return 0
  // Filter UPDATE cũng nằm trên URL ⇒ chia lô 300 như mọi `.in()` khác (luật 2 trần id-trên-URL)
  let n = 0
  for (let i = 0; i < kill.length; i += 300) {
    const { data: done } = await db.from('FillTask')
      .update({ status: 'CANCELLED', cancel_reason: 'Hệ thống thu hồi — nhu cầu nhặt lẻ không còn', updated_at: now() })
      .in('id', kill.slice(i, i + 300)).eq('status', 'PENDING').select('id')
    n += (done ?? []).length
  }
  for (const id of touchedOrders) await fillOrderRollup(id)
  return n
}
