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
 * từng mẻ, nó liên tục trả lời MỘT câu hỏi "ngày này kho này còn thiếu gì ở ô lẻ". Vì thế file này
 * là bộ ĐỐI CHIẾU: đọc nhu cầu → kéo các dòng của ngày về đúng con số đó (thêm · cộng · hạ ·
 * thu hồi), chứ không phải bộ TẠO.
 *
 * NHỊP CHẠY = HÀNG ĐỢI THEO (kho, NGÀY XUẤT) (user chốt 15/09 vòng 3: "đơn nhặt lẻ của ngày nào đổi
 * thì máy ra lệnh cho ngày đó"). Trigger DB (migration 20260915d) ghi (kho, ngày) khi đơn / chuyến /
 * tồn ở ô lẻ / việc LOOSE_FEED đổi; lần đọc kế tiếp `drainFillQueue` lấy ra bằng MỘT RPC vừa lấy
 * dòng vừa THUÊ kho (`fill_reconcile_take`) rồi đối chiếu đúng những ngày đó — hôm nay và ngày mai
 * (ca 22h chuẩn bị cho chuyến NGÀY MAI là lúc kho cần lệnh fill nhất). Không có pg_cron nên còn một
 * lượt QUÉT AN TOÀN mỗi 30 phút cho thứ trigger bỏ sót, mốc nằm Ở DB chứ không trong RAM lambda.
 * Bản trước "throttle 10 phút trong tiến trình" có hai lỗ: mỗi instance mới chạy lại một lượt, và
 * hai instance cùng thấy "thiếu 100" thì `fill_task_topup` cộng delta HAI lần — dòng máy đặt tự hạ
 * lại ở lượt sau, dòng NGƯỜI đặt thì thừa vĩnh viễn. Lease theo kho đóng cả hai.
 *
 * RANH GIỚI: máy quyết **ĐỂ LÀM GÌ**, người quyết **AI LÀM**. Máy không tự chọn người; nhưng lệnh
 * của ngày gán được cho một người ("nhận kế hoạch cả ngày" — user chốt), và dòng máy thêm lúc 11h
 * KẾ THỪA người đã nhận từ 7h, không thì lời hứa đó rỗng. Máy đổi dòng của người đang giữ kế hoạch
 * thì phải NÓI với người đó (thông báo đích danh), không chỉ hiện dải xanh ở Việc cần làm.
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
import { notifyEmployees } from './pushService'

const now = () => new Date().toISOString()
// Ngày NGHIỆP VỤ theo giờ VN (luật timezone CLAUDE.md) — "hôm nay" của kho, không phải của máy chủ
export const vnToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const fmtDMY = (d: string) => { const [y, m, day] = d.slice(0, 10).split('-'); return `${day}/${m}/${y}` }

export const AUTO_ACTOR = 'Hệ thống'
/** Quét an toàn mỗi 30 phút (thứ trigger bỏ sót) · lease 90 giây (một lượt đối chiếu đo ~1–3 s) */
const SWEEP_S = 30 * 60
const LEASE_S = 90

export interface AutoFillResult {
  created: number            // số DÒNG mới mở trong lệnh của ngày
  added: number              // số dòng ĐÃ CÓ được cộng thêm (đơn phát sinh)
  reduced: number            // số dòng bị hạ bớt / thu hồi vì nhu cầu giảm
  recalled: number           // số dòng thu hồi hẳn (tập con của `reduced`) — giữ tên cũ cho FE
  closed: number             // số lệnh ngày trước được chốt lười trong lượt này
  order_code: string | null
  unset: string[]            // mã bỏ qua vì còn dòng CHƯA CHỐT %Date
  no_dest: string[]          // mã bỏ qua vì không còn ô nhặt lẻ trống nhận Loại kho đó
  days?: string[]            // các ngày đã đối chiếu trong lượt này (đường hàng đợi)
}
const emptyResult = (): AutoFillResult => ({
  created: 0, added: 0, reduced: 0, recalled: 0, closed: 0, order_code: null, unset: [], no_dest: [],
})

interface OpenTask {
  id: string; material_id: string | null; required_date: string | null
  qty_base: number; qty_done_base: number | null; required_pallets: number | null
  scanned_pallets: number | null; fill_order_id: string | null; created_by: string | null
  created_at: string | null; assignee_id: string | null
}

/** Sổ "máy đã đụng dòng của ai" — gom theo (người, lệnh) để cuối lượt báo MỘT lần, không báo từng dòng */
type Touched = Map<string, { assignee: string; orderId: string; added: number; reduced: number; recalled: number }>
const touch = (t: Touched, assignee: string | null, orderId: string | null, k: 'added' | 'reduced' | 'recalled') => {
  if (!assignee || !orderId) return
  const key = `${assignee}|${orderId}`
  const cur = t.get(key) ?? { assignee, orderId, added: 0, reduced: 0, recalled: 0 }
  cur[k]++
  t.set(key, cur)
}

/**
 * Đối chiếu MỘT (kho, ngày). Không tự thuê kho — caller (`drainFillQueue` / cửa bấm tay) đã thuê.
 * Chốt lười luôn dựa vào NGÀY HÔM NAY theo giờ VN, KHÔNG dựa vào `day` — bản trước lấy `day` làm
 * mốc nên chạy tay cho NGÀY MAI là chốt luôn lệnh HÔM NAY (đo thật 15/09: gói QA gọi ngày 21/12
 * làm hai lệnh F260915-01/-02 của Ba Vì bị "Hệ thống" chốt lúc 15:17 và 15:23).
 */
export async function autoFillDay(warehouseId: string, day: string): Promise<AutoFillResult> {
  const result = emptyResult()
  // CHỐT NGÀY LƯỜI — không có cron nên lượt chạy đầu của hôm sau là chỗ duy nhất "tự" đóng sổ hôm
  // trước. Chạy TRƯỚC cổng công tắc: kho tắt tự động vẫn có lệnh người đặt tay cần được đóng.
  result.closed = await closeStaleOrders(warehouseId)

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
    .select('id, material_id, required_date, qty_base, qty_done_base, required_pallets, scanned_pallets, fill_order_id, created_by, created_at, assignee_id')
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

  const touched: Touched = new Map()
  await reconcileDown(rows, openByMat, onFor, result, touched)
  await reconcileUp(warehouseId, day, rows, openByMat, mats, onFor, result, touched)
  await notifyTouched(touched, day)
  return result
}

/**
 * ĐƯỜNG CHÍNH cho các trang đọc (Việc cần làm · Nhặt lẻ · Fill hàng): một RPC lấy các ngày cần soát
 * của kho + thuê kho; có gì mới đối chiếu. Hàng đợi thường rỗng và chưa tới hạn quét ⇒ đúng MỘT
 * round-trip rồi về, trang không phải trả giá 2 s của `fill_demand` ở mỗi lần mở.
 * Việc nền hỏng thì trang vẫn phải mở được — người đang vào ca không có gì để làm với lỗi của bộ đặt
 * lệnh. `await` chứ không `void fn()`: trên serverless, response trả xong là lambda có thể bị đóng
 * băng giữa việc (luật CLAUDE.md).
 */
export async function drainFillQueue(warehouseId: string | null | undefined): Promise<AutoFillResult> {
  const agg = emptyResult()
  if (!warehouseId) return agg
  const today = vnToday()
  let leased = false
  try {
    const { data } = await db.rpc('fill_reconcile_take', {
      p_wh: warehouseId, p_today: today, p_sweep_s: SWEEP_S, p_lease_s: LEASE_S,
    } as never)
    const take = (data ?? {}) as { leased?: boolean; days?: string[] }
    if (!take.leased || !take.days?.length) return agg
    leased = true
    agg.days = []
    for (const day of take.days) {
      try {
        const r = await autoFillDay(warehouseId, day)
        agg.created += r.created; agg.added += r.added; agg.reduced += r.reduced
        agg.recalled += r.recalled; agg.closed += r.closed
        agg.order_code = agg.order_code ?? r.order_code
        agg.unset.push(...r.unset); agg.no_dest.push(...r.no_dest)
        agg.days.push(day)
      } catch (e) {
        // Lỗi một ngày (thường là DB quá tải) ⇒ trả dòng về hàng đợi để lượt sau soát lại, không nuốt
        console.error('autoFill:', day, e instanceof Error ? e.message : String(e))
        await db.from('fill_reconcile_queue').upsert(
          { warehouse_id: warehouseId, target_date: day, queued_at: now() } as never,
          { onConflict: 'warehouse_id,target_date' },
        )
      }
    }
  } catch (e) {
    console.error('autoFill:', e instanceof Error ? e.message : String(e))
  } finally {
    if (leased) await db.rpc('fill_reconcile_release', { p_wh: warehouseId } as never)
  }
  return agg
}

/** Tên cũ — các đường đọc đang gọi; nay là đường hàng đợi */
export const autoFillSafe = drainFillQueue

/** Thuê kho cho đường BẤM TAY (cùng ổ khoá với đường tự động). false = kho đang có lượt khác chạy */
export async function leaseWarehouse(warehouseId: string): Promise<boolean> {
  const { data } = await db.rpc('fill_reconcile_lease', { p_wh: warehouseId, p_lease_s: LEASE_S } as never)
  return data === true
}
export async function releaseWarehouse(warehouseId: string): Promise<void> {
  await db.rpc('fill_reconcile_release', { p_wh: warehouseId } as never)
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
  onFor: (id: string) => boolean, result: AutoFillResult, touched: Touched,
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
      touch(touched, l.assignee_id, l.fill_order_id, out.code === 'CANCELLED' ? 'recalled' : 'reduced')
      if (out.code === 'CANCELLED') result.recalled++
      l.qty_base = Math.max(0, Number(l.qty_base) - Number(out.freed ?? cut))
    }
  }
}

// ─── CHIỀU TĂNG — còn thiếu (đơn mới · hàng ở ô lẻ đã vơi) ───────────────────────────────────────
async function reconcileUp(
  warehouseId: string, day: string, rows: FillDemandRow[], openByMat: Map<string, OpenTask[]>,
  mats: Map<string, { code: string; name: string | null; category: string | null }>,
  onFor: (id: string) => boolean, result: AutoFillResult, touched: Touched,
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
      // Cộng delta chỉ an toàn vì caller đang giữ LEASE của kho — hai instance không cùng cộng.
      const { data: topped } = await db.rpc('fill_task_topup', {
        p_warehouse_id: warehouseId, p_target_date: day, p_material_id: r.material_id,
        p_required_date: reqDate, p_add_qty: qty, p_add_pallets: group.length, p_now: t,
      } as never)
      if (topped) {
        const tl = topped as { assignee_id?: string | null; fill_order_id?: string | null }
        result.added++; left -= qty
        touch(touched, tl.assignee_id ?? null, tl.fill_order_id ?? null, 'added')
        continue
      }

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
        // Chỉ còn một ca tới được đây: người bấm tay vừa mở dòng cùng (mã, NSX) giữa lời gọi topup
        // và lời gọi insert. Lượt sau đối chiếu lại là xong — KHÔNG cộng dồn mù ở đây.
        if ((error as { code?: string }).code !== '23505') throw error
        continue
      }
      result.created++
      result.order_code = order.order_code
      touch(touched, order.assignee_id, order.id, 'added')
      left -= qty
      openByMat.set(r.material_id, [...(openByMat.get(r.material_id) ?? [])])
    }
  }
}

/**
 * Máy đổi kế hoạch của người đang giữ thì NÓI với người đó — một thông báo mỗi (người, lệnh) mỗi
 * lượt, gộp số dòng cộng / hạ / thu hồi. Dòng chưa ai giữ thì không báo ai (nó nằm ở Hộp việc chung).
 * Dùng chung công tắc chuông `assign` (giao việc) — đây là kế hoạch ĐÃ giao cho họ vừa đổi.
 */
async function notifyTouched(touched: Touched, day: string): Promise<void> {
  for (const t of touched.values()) {
    const parts: string[] = []
    if (t.added)    parts.push(`thêm/cộng ${t.added} dòng`)
    if (t.reduced)  parts.push(`hạ ${t.reduced} dòng`)
    if (t.recalled) parts.push(`thu hồi ${t.recalled} dòng`)
    if (!parts.length) continue
    const { data: o } = await db.from('FillOrder').select('order_code').eq('id', t.orderId).maybeSingle()
    await notifyEmployees([t.assignee], 'FILL_CHANGED', 'assign', {
      title: `Kế hoạch fill ${o?.order_code ?? ''} vừa đổi`,
      body: `Hệ thống ${parts.join(' · ')} theo đơn nhặt lẻ ngày ${fmtDMY(day)}`,
      url: `/wms/fill/orders/${t.orderId}`,
      tag: `fill-${t.orderId}`,
    })
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
 * Chốt lười lệnh của những NGÀY ĐÃ QUA — mốc là 0h HÔM NAY theo giờ VN, không phải ngày caller đang
 * đối chiếu. User chốt 15/09: "0h, lệnh nào chưa xong thì khoá lại" — ca 22h chuẩn bị là cho chuyến
 * NGÀY MAI nên lệnh họ đang làm mang ngày mai, qua 0h vẫn là lệnh của hôm nay, không bị đụng.
 * Dòng còn treo bị huỷ kèm lý do trong RPC — xe đã đi rồi, để lại dòng PENDING trong một lệnh đã đóng
 * là đẻ ra việc mồ côi không ai nhìn; lý do đó cũng là mẫu số của báo cáo Kết quả.
 */
async function closeStaleOrders(warehouseId: string): Promise<number> {
  const today = vnToday()
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
