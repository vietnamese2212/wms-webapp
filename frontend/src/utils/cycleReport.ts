// BÁO CÁO NVL THEO CHU KỲ (MES 18/11 f — user: "theo chu kỳ, chu kỳ là lớn hơn ca, mẻ" · "cuối chu kỳ, nhưng tách ra ca, mẻ — từ đó ra
// được các chỉ số của nhân sự, số liệu"). Số gốc do DB tính (mes_cycle_report); file này chỉ GOM cho màn hình + Excel. Một chỗ cho
// dashboard, bảng, dải số và Excel ⇒ các nơi không lệch nhau. Test: backend/tests/unit/cycleReport.test.ts.
//
// 21/11 — user: "cái người ta quan tâm là định mức và sự chênh lệch của từng ca, từng mẻ". User chốt:
//   • ĐỊNH MỨC = định mức GỐC theo công thức × kế hoạch (ô `std`), KHÔNG phải phiếu đã sửa. Lệch = thực cấp − định mức, tách HAI phần:
//     SỬA PHIẾU (phiếu − định mức: trưởng ca sửa / thêm / bỏ dòng, có lý do) và CẤP LỆCH (thực cấp − phiếu). Trước 21/11 báo cáo so với
//     phiếu đã sửa ⇒ sửa phiếu 90 → 150 rồi cấp 150 thì "lệch 0".
//   • Lệch của MẺ / CA = KG cộng dồn (chỉ NVL tính KG — không cộng KG với BAG) + SỐ NVL LỆCH (mọi đơn vị, kể cả mã nhỏ như hương, PSB).
//   • CA = khung giờ của MỘT ngày: "Ca 1 · 17/11" ≠ "Ca 1 · 18/11" (trước 21/11 gom theo tên ⇒ Ca 1 của hai ngày dồn một cột).
//   • Chỉ tính dòng ĐÃ CẤP XONG (đủ theo phiếu, vượt, phiếu không đòi cấp, hoặc mẻ đã nạp bồn) — dòng đang cấp dở chưa có số lệch.
// Phiếu của mẻ (trang mẻ, lệnh cho người cấp) vẫn so với PHIẾU qua reqLineState — chỉ báo cáo đổi mốc so.
// 27/11 — MẺ KHÔNG ĐỊNH MỨC (ô có nn = true): chỉ có THỰC CẤP; trạng thái 'nonorm'; không vào số dòng / lệch / KG lệch / NVL lệch;
//   tổng một dòng NVL vẫn cộng thực cấp của chúng, còn định mức / lệch chỉ tính trên ô có định mức (norm = false ⇒ màn in "—").
import { reqLineState, type ReqLineState } from './reqTolerance'

export const NO_SHIFT = 'Chưa ghi ca'
/** hai mẻ CÙNG TÊN ca cách nhau quá chừng này giờ = hai ca khác nhau (Ca 1 hôm nay ≠ Ca 1 hôm qua: cách ≥ 12 giờ ở mọi chế độ 2 / 3 ca);
 *  ca đêm qua nửa đêm (mẻ 23:00 và 01:00) vẫn là MỘT ca. App chưa có giờ bắt đầu / kết thúc của ca nên không chia theo đồng hồ được. */
export const SHIFT_GAP_HOURS = 10

export interface CycleBatchLike {
  id: string; shift: string | null; created_at: string; batch_no: number | null; status: string; stage: string
  planned_qty: number | null; filled_qty: number; filled_at: string | null; base_unit: string | null; prod_date?: string | null
}
/** một ô NVL × mẻ: req = phiếu đang hiệu lực (null = dòng đã bỏ / mã ngoài phiếu) · std = định mức gốc (null = dòng thêm tay / ngoài phiếu;
 *  vắng = API cũ trước 21/11 ⇒ coi như phiếu) · rm = dòng đã bỏ khỏi phiếu · why = lý do sửa · tol = mức lệch % · iss = thực cấp */
export interface CycleCellLike { req: number | null; std?: number | null; rm?: boolean; why?: string | null; tol: number | null; iss: number; n: number
  /** ô của mẻ KHÔNG định mức (27/11) — chỉ có thực cấp */
  nn?: boolean }
/** trạng thái một ô so định mức gốc — thêm 'nonorm' (mẻ không định mức) */
export type CellState = ReqLineState | 'nonorm'
export interface CycleRowLike { cells: Record<string, CycleCellLike>; base_unit?: string | null }
export interface ShiftGroup<B> {
  /** nhãn hiển thị, duy nhất trong chu kỳ — "Ca 1" (chu kỳ một ngày) / "Ca 1 · 17/11" (nhiều ngày); dùng làm khoá */
  shift: string
  /** tên ca như khai ở mẻ ("Chưa ghi ca" khi trống) */
  name: string
  /** ngày của ca (YYYY-MM-DD) — Ngày SX của mẻ đầu tiên trong ca */
  day: string
  batches: B[]
}

const r3 = (n: number) => Math.round(n * 1000) / 1000
const r1 = (n: number) => Math.round(n * 10) / 10
const t = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN)
const vnDay = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }) : '' }
const ddmm = (day: string) => (/^\d{4}-\d{2}-\d{2}/.test(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}` : day)

/** mẻ đã huỷ không vào bảng NVL × mẻ */
export const liveBatches = <B extends CycleBatchLike>(bs: B[]): B[] => bs.filter(b => b.status !== 'CANCELLED')
/** mẻ đã nạp bồn (đã xong phần sản xuất) — phiếu coi như đóng: thiếu dưới mức lệch là thiếu thật */
// 26/11: 'closing' (QA bồn đạt, chờ đóng phiếu) cũng là mẻ đã nạp
export const isFilled = (b: Pick<CycleBatchLike, 'stage'>) => b.stage === 'filled' || b.stage === 'closing' || b.stage === 'released' || b.stage === 'rejected'
/** NVL tính KG (cộng dồn được với nhau) */
export const isKgRow = (r: Pick<CycleRowLike, 'base_unit'>) => (r.base_unit ?? '').trim().toUpperCase() === 'KG'

/** Nhóm theo CA CỦA MỘT NGÀY, thứ tự thời gian (ca có mẻ mở sớm nhất đứng trước); trong ca: theo giờ mở rồi số mẻ. Mẻ chưa khai ca ⇒
 *  nhóm "Chưa ghi ca". Cùng tên ca mà mẻ sau cách mẻ trước quá SHIFT_GAP_HOURS ⇒ ca mới. Chu kỳ trải nhiều ngày ⇒ nhãn kèm ngày. */
export function shiftGroups<B extends CycleBatchLike>(batches: B[]): ShiftGroup<B>[] {
  const sorted = [...batches].sort((a, b) => (t(a.created_at) - t(b.created_at)) || ((a.batch_no ?? 0) - (b.batch_no ?? 0)))
  const open = new Map<string, { g: ShiftGroup<B>; last: number }>()   // tên ca → ca đang mở (mẻ cuối lúc nào)
  const out: ShiftGroup<B>[] = []
  for (const b of sorted) {
    const name = b.shift?.trim() || NO_SHIFT
    const at = t(b.created_at)
    const cur = open.get(name)
    if (cur && (!Number.isFinite(at) || !Number.isFinite(cur.last) || at - cur.last <= SHIFT_GAP_HOURS * 3_600_000)) {
      cur.g.batches.push(b)
      if (Number.isFinite(at)) cur.last = at
      continue
    }
    const g: ShiftGroup<B> = { shift: name, name, day: (b.prod_date ?? '').slice(0, 10) || vnDay(b.created_at), batches: [b] }
    out.push(g)
    open.set(name, { g, last: at })
  }
  const multiDay = new Set(out.map(g => g.day)).size > 1
  const seen = new Map<string, number>()
  for (const g of out) {
    const base = multiDay && g.day ? `${g.name} · ${ddmm(g.day)}` : g.name
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    g.shift = n > 1 ? `${base} (${n})` : base
  }
  return out
}

/** định mức gốc của ô (API cũ chưa có `std` ⇒ coi như phiếu) */
const stdOf = (c: CycleCellLike): number | null => (c.std === undefined ? (c.rm ? null : c.req) : c.std)
/** số trên phiếu đang hiệu lực (dòng đã bỏ / mã ngoài phiếu = 0) */
const sheetOf = (c: CycleCellLike): number => (c.rm || c.req == null ? 0 : Number(c.req))

/** dòng ĐÃ CẤP XONG — số lệch của nó đã chốt: mẻ đã nạp bồn · cấp tới mức của phiếu hoặc vượt · phiếu không đòi cấp (dòng đã bỏ / ngoài phiếu) */
export function cellSettled(c: CycleCellLike, closed: boolean): boolean {
  if (closed) return true
  const st = reqLineState({ required: c.rm ? null : c.req, consumed: c.iss, tol_pct: c.tol }).state
  return st === 'ok' || st === 'over' || st === 'extra'
}

/** trạng thái một ô NVL × mẻ SO VỚI ĐỊNH MỨC GỐC (null = mẻ không dùng mã này). Dòng chưa cấp xong ⇒ progress / none (chưa có số lệch);
 *  đã xong ⇒ ok (trong mức lệch của công thức) · over · under · extra (không có trong định mức: thêm tay / cấp ngoài phiếu). */
export function cellState(c: CycleCellLike | undefined, closed: boolean): CellState | null {
  if (!c) return null
  if (c.nn) return 'nonorm'
  if (!cellSettled(c, closed)) return Number(c.iss) > 0 ? 'progress' : 'none'
  const std = stdOf(c)
  if (std == null) return 'extra'
  return reqLineState({ required: std, consumed: c.iss, tol_pct: c.tol }, true).state
}

export interface Dev { std: number; sheet: number; iss: number; edit: number; exec: number; total: number }
/** lệch của một ô: tổng = thực cấp − định mức = SỬA PHIẾU (phiếu − định mức) + CẤP LỆCH (thực cấp − phiếu) */
export function cellDev(c: CycleCellLike): Dev {
  if (c.nn) { const iss = r3(Number(c.iss) || 0); return { std: 0, sheet: 0, iss, edit: 0, exec: 0, total: 0 } }
  const std = Number(stdOf(c) ?? 0), sheet = sheetOf(c), iss = Number(c.iss) || 0
  return { std: r3(std), sheet: r3(sheet), iss: r3(iss), edit: r3(sheet - std), exec: r3(iss - sheet), total: r3(iss - std) }
}
/** % lệch so định mức (1 số lẻ) — null khi định mức 0 */
export const devPctOf = (total: number, std: number): number | null => (std > 0 ? r1((total / std) * 100) : null)

/** tổng một dòng NVL trên một nhóm mẻ (một mã ⇒ cùng đơn vị) — mọi ô, kể cả dòng đang cấp dở (bảng NVL × ca tô cam phần đó).
 *  std = định mức gốc · sheet = phiếu · diff = thực cấp − định mức. */
export function rowSum(row: CycleRowLike, batchIds: readonly string[]): { std: number; sheet: number; iss: number; diff: number; devPct: number | null; used: boolean; norm: boolean } {
  // norm = có ít nhất một ô CÓ định mức; iss cộng mọi ô (kể cả mẻ không định mức), lệch chỉ trên ô có định mức
  let std = 0, sheet = 0, iss = 0, normIss = 0, used = false, norm = false
  for (const id of batchIds) {
    const c = row.cells[id]
    if (!c) continue
    used = true
    const d = cellDev(c)
    std += d.std; sheet += d.sheet; iss += d.iss
    if (!c.nn) { norm = true; normIss += d.iss }
  }
  std = r3(std); sheet = r3(sheet); iss = r3(iss)
  const diff = r3(normIss - std)
  return { std, sheet, iss, diff, devPct: devPctOf(diff, std), used, norm }
}

/** NVL × CA (20/11 — user: "1 ngày có tới 36 mẻ thì số cột sẽ là nhiều lắm"): bảng chính mỗi CA một cột; ▸ ở dòng NVL mở các MẺ
 *  xếp dọc. Từng mẻ có dùng mã này, theo thứ tự ca → mẻ. Excel "NVL từng mẻ" đọc cùng hàm. */
export function rowBatchLines<B extends CycleBatchLike>(row: CycleRowLike, groups: { shift: string; batches: B[] }[]):
  { shift: string; batch: B; cell: CycleCellLike; state: CellState | null; dev: Dev }[] {
  return groups.flatMap(g => g.batches.filter(b => row.cells[b.id]).map(b => {
    const cell = row.cells[b.id]
    return { shift: g.shift, batch: b, cell, state: cellState(cell, isFilled(b)), dev: cellDev(cell) }
  }))
}
/** dòng LỆCH so định mức gốc: vượt / dưới mức cho phép, hoặc ngoài định mức (thêm tay vào phiếu, cấp ngoài phiếu) */
export const isDevState = (s: CellState | null | undefined) => s === 'over' || s === 'under' || s === 'extra'
/** số mẻ của dòng NVL lệch khỏi định mức — cột "Mẻ lệch" */
export const rowDeviations = (lines: { state: CellState | null }[]) => lines.filter(l => isDevState(l.state)).length
/** chữ trạng thái một dòng NVL của một mẻ, so với định mức gốc (Excel + dòng mở rộng) */
export const LINE_STATE_LABEL: Record<CellState, string> = {
  ok: 'Trong mức', over: 'Vượt định mức', under: 'Dưới định mức', progress: 'Đang cấp', extra: 'Ngoài định mức', none: 'Chưa cấp', removed: 'Bỏ khỏi phiếu',
  nonorm: 'Không định mức',
}

export interface LineStats { lines: number; ok: number; short: number; over: number; extra: number }
/** đếm dòng NVL của một nhóm mẻ: đủ (trong mức) · thiếu (dưới định mức, hoặc đang cấp dở) · vượt · ngoài định mức */
export function lineStats(rows: CycleRowLike[], batches: Pick<CycleBatchLike, 'id' | 'stage'>[]): LineStats {
  const s: LineStats = { lines: 0, ok: 0, short: 0, over: 0, extra: 0 }
  for (const b of batches) {
    for (const r of rows) {
      const st = cellState(r.cells[b.id], isFilled(b))
      if (st == null || st === 'removed' || st === 'nonorm') continue
      s.lines++
      if (st === 'ok') s.ok++
      else if (st === 'over') s.over++
      else if (st === 'extra') s.extra++
      else s.short++
    }
  }
  return s
}

export interface DevAgg {
  batches: number; filled: number
  /** KG cộng dồn — chỉ dòng ĐÃ CẤP XONG của NVL tính KG */
  kg: Dev & { pct: number | null }
  /** số dòng (mẻ × NVL): có mặt · đã cấp xong · đang cấp dở / chưa cấp */
  lines: number; settled: number; pending: number
  /** dòng đã xong: trong mức · vượt định mức · dưới định mức · ngoài định mức · phiếu khác định mức (sửa / thêm / bỏ) */
  ok: number; over: number; under: number; extra: number; edited: number
  /** 27/11: số ô của mẻ KHÔNG định mức (không vào mọi số trên) */
  nonorm: number
}
/** LỆCH SO ĐỊNH MỨC của một nhóm mẻ (một mẻ · một ca · cả chu kỳ) — dashboard, dải số, Excel "Lệch theo ca · mẻ" đọc cùng hàm */
export function devAgg(rows: CycleRowLike[], batches: Pick<CycleBatchLike, 'id' | 'stage'>[]): DevAgg {
  const a: DevAgg = { batches: batches.length, filled: 0, kg: { std: 0, sheet: 0, iss: 0, edit: 0, exec: 0, total: 0, pct: null },
    lines: 0, settled: 0, pending: 0, ok: 0, over: 0, under: 0, extra: 0, edited: 0, nonorm: 0 }
  for (const b of batches) {
    const closed = isFilled(b)
    if (closed) a.filled++
    for (const r of rows) {
      const c = r.cells[b.id]
      if (!c) continue
      if (c.nn) { a.nonorm++; continue }
      a.lines++
      const st = cellState(c, closed)
      if (st === 'progress' || st === 'none') { a.pending++; continue }
      a.settled++
      if (st === 'ok') a.ok++
      else if (st === 'over') a.over++
      else if (st === 'under') a.under++
      else if (st === 'extra') a.extra++
      const d = cellDev(c)
      if (d.edit !== 0) a.edited++
      if (isKgRow(r)) { a.kg.std += d.std; a.kg.sheet += d.sheet; a.kg.iss += d.iss; a.kg.edit += d.edit; a.kg.exec += d.exec; a.kg.total += d.total }
    }
  }
  const k = a.kg
  k.std = r3(k.std); k.sheet = r3(k.sheet); k.iss = r3(k.iss); k.edit = r3(k.edit); k.exec = r3(k.exec); k.total = r3(k.total)
  k.pct = devPctOf(k.total, k.std)
  return a
}
/** số dòng NVL lệch (vượt + dưới định mức + ngoài định mức) — chỉ số chính cạnh KG */
export const devLines = (a: Pick<DevAgg, 'over' | 'under' | 'extra'>) => a.over + a.under + a.extra

export interface MatDev { row: number; std: number; iss: number; total: number; pct: number | null; devBatches: number; batches: number }
/** NVL LỆCH NHIỀU NHẤT của chu kỳ: mỗi mã cộng các dòng ĐÃ CẤP XONG (đơn vị của mã); xếp theo số mẻ lệch rồi |lệch %|. Chỉ mã có lệch. */
export function materialDevs(rows: CycleRowLike[], batches: Pick<CycleBatchLike, 'id' | 'stage'>[]): MatDev[] {
  const out: MatDev[] = []
  rows.forEach((r, i) => {
    let std = 0, iss = 0, devBatches = 0, n = 0
    for (const b of batches) {
      const c = r.cells[b.id]
      if (!c) continue
      const st = cellState(c, isFilled(b))
      if (st === 'progress' || st === 'none' || st === 'nonorm' || st == null) continue
      n++
      if (isDevState(st)) devBatches++
      const d = cellDev(c)
      std += d.std; iss += d.iss
    }
    const total = r3(iss - std)
    if (devBatches > 0) out.push({ row: i, std: r3(std), iss: r3(iss), total, pct: devPctOf(total, std), devBatches, batches: n })
  })
  return out.sort((a, b) => (b.devBatches - a.devBatches) || (Math.abs(b.pct ?? Infinity) - Math.abs(a.pct ?? Infinity)))
}

/** phút giữa hai mốc (null khi thiếu mốc / ngược) */
export function minutesBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  const x = t(a), y = t(b)
  if (!Number.isFinite(x) || !Number.isFinite(y) || y < x) return null
  return Math.round((y - x) / 60000)
}
/** "2 giờ 05" / "45 phút" */
export function durLabel(min: number | null): string {
  if (min == null) return ''
  if (min < 60) return `${min} phút`
  const h = Math.floor(min / 60), m = min % 60
  return `${h} giờ${m ? ` ${String(m).padStart(2, '0')}` : ''}`
}

/** cộng số lượng theo ĐƠN VỊ (không cộng KG với L) — dùng cho kế hoạch / nạp bồn của nhiều mã BTP */
export function sumByUnit<B>(items: B[], qty: (b: B) => number | null | undefined, unit: (b: B) => string | null | undefined): { unit: string; qty: number }[] {
  const m = new Map<string, number>()
  for (const it of items) {
    const q = Number(qty(it) ?? 0)
    if (!q) continue
    const u = (unit(it) || '').toUpperCase() || '?'
    m.set(u, r3((m.get(u) ?? 0) + q))
  }
  return [...m.entries()].map(([u, q]) => ({ unit: u, qty: q }))
}

export interface ShiftKpi {
  shift: string; batches: number; filled: number
  planned: { unit: string; qty: number }[]; filledQty: { unit: string; qty: number }[]
  stats: LineStats
  /** thời gian trung bình từ mở mẻ tới nạp bồn (phút) — chỉ mẻ đã nạp */
  avgMin: number | null
}
/** chỉ số của từng ca + cả chu kỳ (dòng cuối, shift = 'Cả chu kỳ') */
export function shiftKpis<B extends CycleBatchLike>(rows: CycleRowLike[], batches: B[]): ShiftKpi[] {
  const live = liveBatches(batches)
  const one = (shift: string, bs: B[]): ShiftKpi => {
    const durs = bs.filter(isFilled).map(b => minutesBetween(b.created_at, b.filled_at)).filter((m): m is number => m != null)
    return {
      shift, batches: bs.length, filled: bs.filter(isFilled).length,
      planned: sumByUnit(bs, b => b.planned_qty, b => b.base_unit), filledQty: sumByUnit(bs, b => b.filled_qty, b => b.base_unit),
      stats: lineStats(rows, bs), avgMin: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null,
    }
  }
  return [...shiftGroups(live).map(g => one(g.shift, g.batches)), one('Cả chu kỳ', live)]
}
