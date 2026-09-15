/**
 * TỰ RA LỆNH FILL HÀNG NHẶT LẺ — user chốt 15/09 ("fill hàng phục vụ nhặt lẻ, ra lệnh tự động được
 * không?" · "tự động hoặc bằng tay thì cần có setting cho Kho và loại kho nha").
 *
 * VÌ SAO: đo staging 15/09 — module Fill ra 05/08 mà tới nay **0 lệnh fill** nào được tạo, trong khi
 * đường tự động sẵn có (việc `LOOSE_FEED` bộ lập kế hoạch đặt lúc Bắt đầu chuyến) đã chạy thật. Nút
 * "Ra lệnh fill" là một nhát bấm nằm giữa "máy đã biết phải hạ gì" và "người đi hạ" — sáu tuần cho
 * thấy không ai đi qua nó.
 *
 * ĐƠN VỊ CÔNG VIỆC = MỘT NGÀY, KHÔNG PHẢI MỘT MẺ (user chốt 15/09 vòng 2): "1 ngày, 1 kho, 1 loại
 * kho chỉ có 1 lệnh fill — chi tiết trong đó thay đổi, cuối ngày Hoàn thành". Bản đầu của tôi bọc
 * lấy THÓI QUEN BẤM TAY (mỗi lần bấm = một lệnh mới) nên máy sinh từng mẻ; nhưng máy không quyết
 * từng mẻ, nó liên tục trả lời MỘT câu hỏi "hôm nay kho này còn thiếu gì ở ô lẻ". Vì thế file này
 * nay là bộ ĐỐI CHIẾU: đọc nhu cầu → kéo các dòng của ngày về đúng con số đó (thêm · cộng · hạ ·
 * thu hồi), chứ không phải bộ TẠO.
 *
 * RANH GIỚI: máy quyết **ĐỂ LÀM GÌ**, người quyết **AI LÀM**. Máy không tự chọn người; nhưng lệnh
 * của ngày gán được cho một người ("nhận kế hoạch cả ngày" — user chốt), và dòng máy thêm lúc 11h
 * KẾ THỪA người đã nhận từ 7h, không thì lời hứa đó rỗng.
 *
 * CHỈ NGÀY XUẤT HÔM NAY ở đường tự động: ô nhặt lẻ có sức chứa (cả hệ thống 28 ô). Ngày khác thì
 * chọn tay trên trang Fill (user chốt 15/09: "chọn tay nếu không đúng ngày thì hay hơn").
 *
 * MỌI phép tính nhu cầu đi qua `fillDemandOf` — đúng con số trang Đề xuất đang hiện. Viết lại ở đây
 * là đẻ bản luật thứ hai: máy hạ một đằng, màn hình nói một nẻo.
 */
import { randomUUID } from 'crypto'
import { db } from '../lib/supabase'
import {
  fillDemandOf, buildPickFaceIdx, takePickFace, ensureDayOrder,
  type FillDemandRow, type DayOrder,
} from '../controllers/wms/fillController'
import { resolveAutoFill, type WhTypeConfigRow } from '../utils/putaway'

const now = () => new Date().toISOString()
// Ngày NGHIỆP VỤ theo giờ VN (luật timezone CLAUDE.md) — "hôm nay" của kho, không phải của máy chủ
export const vnToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

export const AUTO_ACTOR = 'Hệ thống'

export interface AutoFillResult {
  created: number            // số DÒNG mới mở trong lệnh của ngày
  added: number              // số dòng ĐÃ CÓ được cộng thêm (đơn phát sinh)
  reduced: number            // số dòng bị hạ bớt / thu hồi vì nhu cầu giảm
  recalled: number           // số dòng thu hồi hẳn (tập con của `reduced`) — giữ tên cũ cho FE
  closed: number             // số lệnh ngày trước được chốt lười trong lượt này
  order_code: string | null
  unset: string[]            // mã bỏ qua vì còn dòng CHƯA CHỐT %Date
  no_dest: string[]          // mã bỏ qua vì không còn ô nhặt lẻ trống nhận Loại kho đó
}
const emptyResult = (): AutoFillResult => ({
  created: 0, added: 0, reduced: 0, recalled: 0, closed: 0, order_code: null, unset: [], no_dest: [],
})

/**
 * Nhịp chạy: KHÔNG có pg_cron trên hạ tầng này nên quét LƯỜI theo traffic, throttle trong tiến trình
 * y như `alertScanner` / `cleanupOldPhotos`. Chạy trùng giữa hai instance không sinh lệnh đôi: khoá
 * `uq_fillorder_open` giữ MỘT lệnh mở cho mỗi (kho, ngày, loại), và mọi thay đổi dòng đi qua RPC có
 * khoá dòng chứ không còn là cuộc đua INSERT.
 */
const THROTTLE_MS = 10 * 60_000
const _lastRun = new Map<string, number>()

interface OpenTask {
  id: string; material_id: string | null; required_date: string | null
  qty_base: number; qty_done_base: number | null; required_pallets: number | null
  scanned_pallets: number | null; fill_order_id: string | null; created_by: string | null
  created_at: string | null
}

export async function autoFillDay(
  warehouseId: string, day: string, opts: { force?: boolean } = {},
): Promise<AutoFillResult> {
  const key = `${warehouseId}|${day}`
  if (!opts.force && Date.now() - (_lastRun.get(key) ?? 0) < THROTTLE_MS) return emptyResult()
  _lastRun.set(key, Date.now())

  const result = emptyResult()
  // CHỐT NGÀY LƯỜI — không có cron nên lượt chạy đầu của hôm sau là chỗ duy nhất "tự" đóng sổ hôm
  // trước. Chạy TRƯỚC cổng công tắc: kho tắt tự động vẫn có lệnh người đặt tay cần được đóng.
  result.closed = await closeStaleOrders(warehouseId, day)

  // ── Công tắc 2 TẦNG: mặc định của kho + ghi đè theo LOẠI KHO (`resolveAutoFill`, một luật ghép
  // tầng dùng chung với luân chuyển/cách làm việc). Kho tắt mà KHÔNG loại nào bật ⇒ về ngay — đây
  // là đường chạy của 152/153 kho hôm nay nên nó phải rẻ.
  const [{ data: wh }, { data: cfgRaw }] = await Promise.all([
    db.from('Warehouse').select('id, auto_fill').eq('id', warehouseId).maybeSingle(),
    db.from('warehouse_type_configs').select('type_code, auto_fill').eq('warehouse_id', warehouseId),
  ])
  if (!wh) return result
  const typeRows = (cfgRaw ?? []) as unknown as WhTypeConfigRow[]
  if (wh.auto_fill !== true && !typeRows.some(t => t.auto_fill === true)) return result

  const payload = await fillDemandOf(warehouseId, day)
  // Kho chưa khai ô nhặt lẻ nào ⇒ không có luật này (cùng khuôn "kho có vẽ cửa thì mới bắt chọn cửa")
  if (!Number(payload?.pick_face_locations ?? 0)) return result
  const rows = (payload?.rows ?? []) as FillDemandRow[]

  // Dòng đang mở của NGÀY này — dùng cho cả hai chiều (hạ bớt / cộng thêm)
  const { data: openRaw } = await db.from('FillTask')
    .select('id, material_id, required_date, qty_base, qty_done_base, required_pallets, scanned_pallets, fill_order_id, created_by, created_at')
    .eq('warehouse_id', warehouseId).eq('target_date', day).eq('status', 'PENDING')
  const open = (openRaw ?? []) as unknown as OpenTask[]
  const openByMat = new Map<string, OpenTask[]>()
  for (const l of open) {
    if (!l.material_id) continue
    openByMat.set(l.material_id, [...(openByMat.get(l.material_id) ?? []), l])
  }

  // ⚠️ HỢP của hai tập, không chỉ tập nhu cầu: mã HẾT nhu cầu BIẾN MẤT khỏi `rows` (RPC chỉ trả mã
  // còn cần), nên duyệt theo `rows` là đúng những dòng đáng thu hồi nhất lại không bao giờ tới lượt.
  const matIds = [...new Set([...rows.map(r => r.material_id), ...openByMat.keys()].filter(Boolean))]
  const mats = new Map<string, { code: string; name: string | null; category: string | null }>()
  for (let i = 0; i < matIds.length; i += 300) {
    const { data } = await db.from('Material')
      .select('id, material_code, short_name, category').in('id', matIds.slice(i, i + 300))
    for (const m of data ?? []) mats.set(m.id, { code: m.material_code, name: m.short_name, category: m.category })
  }
  const onFor = (materialId: string) =>
    resolveAutoFill(wh as unknown as Record<string, unknown>, typeRows, mats.get(materialId)?.category ?? null).enabled

  await reconcileDown(rows, openByMat, onFor, result)
  await reconcileUp(warehouseId, day, rows, openByMat, mats, onFor, result)
  return result
}

/**
 * Bọc cho các ĐƯỜNG ĐỌC gọi kèm (trang Việc cần làm, trang Nhặt lẻ, trang Fill): việc nền hỏng thì
 * trang vẫn phải mở được — người đang vào ca không có gì để làm với lỗi của bộ đặt lệnh. Vẫn ghi log
 * để còn thấy. `await` chứ không `void fn()`: trên serverless, response trả xong là lambda có thể bị
 * đóng băng giữa việc (luật CLAUDE.md).
 */
export async function autoFillSafe(warehouseId: string | null | undefined, day = vnToday()): Promise<AutoFillResult> {
  if (!warehouseId) return emptyResult()
  try { return await autoFillDay(warehouseId, day) } catch (e) {
    console.error('autoFill:', e instanceof Error ? e.message : String(e))
    return emptyResult()
  }
}

// ─── CHIỀU GIẢM — nhu cầu tụt (đơn huỷ · đổi ngày · hàng đã có đủ đúng lô ở ô lẻ) ────────────────
/**
 * Mô hình cũ chỉ HUỶ TRỌN DÒNG khi phần thừa đủ nuốt cả dòng, nên thừa 30 mà dòng 100 thì không rút
 * gì — vẫn đi hạ đủ 100. Nay hạ được TỪNG PHẦN, sàn là phần ĐÃ QUÉT (user chốt): ai đã hạ 60/100 thì
 * dòng thành 60 và đóng, không thành 40.
 *
 * ⚠️ HÀNG RÀO KHÔNG CÒN LÀ "ĐÃ GÁN NGƯỜI". Gán nay là chuyện của CẢ NGÀY (lệnh gán cho một người,
 * mọi dòng kế thừa) nên "đã gán" không còn nghĩa "đang làm dở" — lấy nó làm rào thì mọi dòng trong
 * lệnh đã gán thành bất khả xâm phạm và cơ chế thu hồi chết lặng. Rào thật nằm ở RPC: chỉ đụng dòng
 * do MÁY đặt, và không bao giờ xuống dưới phần đã quét.
 */
async function reconcileDown(
  rows: FillDemandRow[], openByMat: Map<string, OpenTask[]>,
  onFor: (id: string) => boolean, result: AutoFillResult,
): Promise<void> {
  const t = now()
  // Nhu cầu THẬT còn phải phủ bằng lệnh fill = cần − đã có đúng lô ở ô lẻ − việc LOOSE_FEED treo.
  // KHÔNG trừ chính các dòng lệnh đang xét: chúng là thứ đang được đem ra cân xem có thừa không.
  const needOf = new Map<string, number>()
  for (const r of rows) {
    if (!r.material_id) continue
    needOf.set(r.material_id, Math.max(0, Number(r.demand_base ?? 0)
      - Number(r.pick_face_ok_base ?? 0) - Number(r.feed_pending_base ?? 0)))
  }
  // DUYỆT THEO DÒNG ĐANG MỞ, không theo danh sách nhu cầu: mã hết nhu cầu BIẾN MẤT khỏi danh sách
  // đó (RPC chỉ trả mã còn cần) nên duyệt kiểu kia là bỏ sót đúng những dòng đáng thu hồi nhất —
  // đơn huỷ sạch một mã thì lệnh của mã đó đứng nguyên. Vắng mặt = nhu cầu 0.
  for (const [matId, list] of openByMat) {
    if (!onFor(matId) || !list.length) continue
    const need = needOf.get(matId) ?? 0
    const remainOf = (l: OpenTask) => Math.max(0, Number(l.qty_base) - Number(l.qty_done_base ?? 0))
    let excess = list.reduce((s, l) => s + remainOf(l), 0) - need
    if (excess <= 0) continue

    // Mới nhất hạ trước — dòng cũ có thể đã được ai đó nhìn thấy và tính vào đầu việc trong ca
    const cand = [...list]
      .filter(l => (l.created_by ?? '') === AUTO_ACTOR)
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    for (const l of cand) {
      if (excess <= 0) break
      const cut = Math.min(excess, remainOf(l))
      if (cut <= 0) continue
      const { data } = await db.rpc('fill_task_reduce', {
        p_task_id: l.id, p_target_qty: Number(l.qty_base) - cut,
        p_reason: 'Hệ thống thu hồi — nhu cầu nhặt lẻ không còn', p_now: t,
      } as never)
      const out = data as { code?: string; freed?: number } | null
      if (!out || (out.code !== 'REDUCED' && out.code !== 'CANCELLED')) continue
      excess -= Number(out.freed ?? cut)
      result.reduced++
      if (out.code === 'CANCELLED') result.recalled++
      l.qty_base = Math.max(0, Number(l.qty_base) - Number(out.freed ?? cut))
    }
  }
}

// ─── CHIỀU TĂNG — còn thiếu (đơn mới · hàng ở ô lẻ đã vơi) ───────────────────────────────────────
async function reconcileUp(
  warehouseId: string, day: string, rows: FillDemandRow[], openByMat: Map<string, OpenTask[]>,
  mats: Map<string, { code: string; name: string | null; category: string | null }>,
  onFor: (id: string) => boolean, result: AutoFillResult,
): Promise<void> {
  const pending = rows.filter(r => r.material_id && onFor(r.material_id) && Number(r.short_base ?? 0) > 0)
  if (!pending.length && !rows.some(r => r.material_id && onFor(r.material_id) && r.rule_unset)) return

  const pfIdx = await buildPickFaceIdx(warehouseId, [...new Set(pending.map(r => r.material_id))])
  const orders = new OrderCache(warehouseId, day)
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
    if (!sug.length) continue                     // thiếu nhưng không còn pallet nào để hạ

    // MỘT DÒNG = MỘT NSX: cửa quét khớp `required_date` với `production_date` của tem, và khoá
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

      // CỘNG DỒN trước, TẠO sau. Đây chính là ca "đơn phát sinh" mà mô hình cũ đánh rơi: dòng cùng
      // (mã, NSX) đang treo ⇒ INSERT đụng khoá ⇒ bản cũ nuốt 23505 và phần tăng không bao giờ thành
      // lệnh, trong khi đường bấm tay thì cộng dồn. Máy CỘNG được cả vào dòng người đặt (nội dung
      // dòng là "cần hạ bao nhiêu", không phải "người đó quyết bao nhiêu") nhưng không HẠ dòng đó.
      const { data: topped } = await db.rpc('fill_task_topup', {
        p_warehouse_id: warehouseId, p_target_date: day, p_material_id: r.material_id,
        p_required_date: reqDate, p_add_qty: qty, p_add_pallets: group.length, p_now: t,
      } as never)
      if (topped) { result.added++; left -= qty; continue }

      const dest = takePickFace(pfIdx, r.material_id, mat.category, group.length)
      if (!dest) { result.no_dest.push(mat.code); break }
      const order = await orders.get(mat.category ?? null)
      if (!order) break
      const { error } = await db.from('FillTask').insert({
        id: randomUUID(), warehouse_id: warehouseId, target_date: day,
        fill_order_id: order.id,
        material_id: r.material_id, material_code: mat.code, material_name: mat.name,
        required_date: reqDate, required_expiry: group[0]?.expiry_date ?? null,
        required_pallets: group.length, qty_base: qty,
        from_location_code: group[0]?.from_location_code ?? null,
        to_location_id: dest.id, to_location_code: dest.code,
        status: 'PENDING',
        // KẾ THỪA người đang giữ kế hoạch của ngày — máy không CHỌN người, chỉ không bỏ rơi
        // người đã nhận (user chốt: "gán người, người đó nhận kế hoạch cả ngày").
        assignee_id: order.assignee_id, assignee_name: order.assignee_name,
        assigned_by: order.assignee_id ? order.assigned_by : null,
        assigned_at: order.assignee_id ? t : null,
        created_by: AUTO_ACTOR, created_at: t, updated_at: t,
      } as never)
      if (error) {
        // Chỉ còn một ca tới được đây: instance khác vừa mở dòng cùng (mã, NSX) giữa lời gọi topup
        // và lời gọi insert. Lượt sau đối chiếu lại là xong — KHÔNG cộng dồn mù ở đây.
        if ((error as { code?: string }).code !== '23505') throw error
        continue
      }
      result.created++
      result.order_code = order.order_code
      left -= qty
      openByMat.set(r.material_id, [...(openByMat.get(r.material_id) ?? [])])
    }
  }
}

// ─── Lệnh CỦA NGÀY: lấy-hoặc-tạo theo (kho, ngày, loại kho), nhớ trong phạm vi một lượt chạy ──────
class OrderCache {
  private cache = new Map<string, DayOrder | null>()
  constructor(private warehouseId: string, private day: string) {}
  async get(type: string | null): Promise<DayOrder | null> {
    const k = type ?? ''
    if (!this.cache.has(k)) this.cache.set(k, await ensureDayOrder(this.warehouseId, this.day, type, true, AUTO_ACTOR))
    return this.cache.get(k) ?? null
  }
}

/**
 * Chốt lười lệnh của những NGÀY ĐÃ QUA. Không có cron ⇒ lượt chạy đầu tiên của hôm sau là chỗ duy
 * nhất "tự" đóng sổ mà không cần ai nhớ. Dòng còn treo bị huỷ kèm lý do trong RPC — xe đã đi rồi,
 * để lại dòng PENDING trong một lệnh đã đóng là đẻ ra việc mồ côi không ai nhìn.
 */
async function closeStaleOrders(warehouseId: string, today: string): Promise<number> {
  const { data } = await db.from('FillOrder')
    .select('id').eq('warehouse_id', warehouseId).eq('status', 'PENDING').lt('target_date', today).limit(50)
  const ids = (data ?? []).map(o => o.id as string)
  if (!ids.length) return 0
  const t = now()
  let n = 0
  for (const id of ids) {
    const { data: out } = await db.rpc('fill_order_close', { p_order_id: id, p_actor: AUTO_ACTOR, p_now: t } as never)
    if ((out as { code?: string } | null)?.code === 'CLOSED') n++
  }
  return n
}
