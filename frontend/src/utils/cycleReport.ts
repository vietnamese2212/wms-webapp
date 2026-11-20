// BÁO CÁO NVL THEO CHU KỲ (MES 18/11 f — user: "theo chu kỳ, chu kỳ là lớn hơn ca, mẻ" · "cuối chu kỳ, nhưng tách ra ca, mẻ — từ đó ra
// được các chỉ số của nhân sự, số liệu"). Số gốc do DB tính (mes_cycle_report); file này chỉ GOM cho màn hình + Excel: chia ca theo thứ
// tự thời gian, cộng một dòng NVL trên một nhóm mẻ, đếm trạng thái dòng bằng CÙNG luật reqLineState của phiếu mẻ. Một chỗ cho bảng,
// dải số và Excel ⇒ ba nơi không lệch nhau. Test: backend/tests/unit/cycleReport.test.ts.
import { reqLineState, type ReqLineState } from './reqTolerance'

export const NO_SHIFT = 'Chưa ghi ca'

export interface CycleBatchLike {
  id: string; shift: string | null; created_at: string; batch_no: number | null; status: string; stage: string
  planned_qty: number | null; filled_qty: number; filled_at: string | null; base_unit: string | null
}
export interface CycleCellLike { req: number | null; tol: number | null; iss: number; n: number }
export interface CycleRowLike { cells: Record<string, CycleCellLike> }

const r3 = (n: number) => Math.round(n * 1000) / 1000
const t = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN)

/** mẻ đã huỷ không vào bảng NVL × mẻ */
export const liveBatches = <B extends CycleBatchLike>(bs: B[]): B[] => bs.filter(b => b.status !== 'CANCELLED')
/** mẻ đã nạp bồn (đã xong phần sản xuất) — phiếu coi như đóng: thiếu dưới mức lệch là thiếu thật */
export const isFilled = (b: Pick<CycleBatchLike, 'stage'>) => b.stage === 'filled' || b.stage === 'released' || b.stage === 'rejected'

/** Nhóm theo CA, thứ tự thời gian (ca có mẻ mở sớm nhất đứng trước); trong ca: theo giờ mở rồi số mẻ. Mẻ chưa khai ca ⇒ nhóm "Chưa ghi ca". */
export function shiftGroups<B extends CycleBatchLike>(batches: B[]): { shift: string; batches: B[] }[] {
  const byShift = new Map<string, B[]>()
  const sorted = [...batches].sort((a, b) => (t(a.created_at) - t(b.created_at)) || ((a.batch_no ?? 0) - (b.batch_no ?? 0)))
  for (const b of sorted) {
    const k = b.shift?.trim() || NO_SHIFT
    const g = byShift.get(k)
    if (g) g.push(b); else byShift.set(k, [b])
  }
  return [...byShift.entries()].map(([shift, bs]) => ({ shift, batches: bs }))
}

/** trạng thái một ô NVL × mẻ (null = mẻ không dùng mã này) — cùng luật phiếu của mẻ; mẻ đã nạp bồn ⇒ thiếu = "under" (đỏ) */
export function cellState(c: CycleCellLike | undefined, closed: boolean): ReqLineState | null {
  if (!c) return null
  return reqLineState({ required: c.req, consumed: c.iss, tol_pct: c.tol }, closed).state
}

/** tổng một dòng NVL trên một nhóm mẻ (một mã ⇒ cùng đơn vị). Định mức chỉ cộng ô có định mức; lệch = thực cấp − định mức. */
export function rowSum(row: CycleRowLike, batchIds: readonly string[]): { req: number; iss: number; diff: number; devPct: number | null; used: boolean } {
  let req = 0, iss = 0, used = false
  for (const id of batchIds) {
    const c = row.cells[id]
    if (!c) continue
    used = true
    if (c.req != null) req += Number(c.req)
    iss += Number(c.iss) || 0
  }
  req = r3(req); iss = r3(iss)
  const diff = r3(iss - req)
  return { req, iss, diff, devPct: req > 0 ? Math.round((diff / req) * 1000) / 10 : null, used }
}

/** NVL × CA (20/11 — user: "1 ngày có tới 36 mẻ thì số cột sẽ là nhiều lắm"): bảng chính mỗi CA một cột; ▸ ở dòng NVL mở các MẺ
 *  xếp dọc. Từng mẻ có dùng mã này, theo thứ tự ca → mẻ; trạng thái = cùng luật phiếu mẻ (cellState). Excel "NVL từng mẻ" đọc cùng hàm. */
export function rowBatchLines<B extends CycleBatchLike>(row: CycleRowLike, groups: { shift: string; batches: B[] }[]):
  { shift: string; batch: B; cell: CycleCellLike; state: ReqLineState | null }[] {
  return groups.flatMap(g => g.batches.filter(b => row.cells[b.id]).map(b => ({ shift: g.shift, batch: b, cell: row.cells[b.id], state: cellState(row.cells[b.id], isFilled(b)) })))
}
/** số mẻ của dòng NVL cấp LỆCH khỏi mức cho phép (vượt, hoặc thiếu ở mẻ đã nạp bồn) — cột "Mẻ lệch" */
export const rowDeviations = (lines: { state: ReqLineState | null }[]) => lines.filter(l => l.state === 'over' || l.state === 'under').length
/** chữ trạng thái một dòng NVL của một mẻ (Excel + dòng mở rộng) */
export const LINE_STATE_LABEL: Record<ReqLineState, string> = {
  ok: 'Trong mức', over: 'Vượt mức', under: 'Thiếu (mẻ đã nạp bồn)', progress: 'Đang cấp', extra: 'Ngoài phiếu', none: 'Chưa cấp', removed: 'Bỏ khỏi phiếu',
}

export interface LineStats { lines: number; ok: number; short: number; over: number; extra: number }
/** đếm dòng NVL của một nhóm mẻ: đủ (trong mức lệch) · thiếu (chưa đủ / dưới mức) · vượt · ngoài phiếu. Ô chưa cấp của mẻ đang làm = thiếu. */
export function lineStats(rows: CycleRowLike[], batches: Pick<CycleBatchLike, 'id' | 'stage'>[]): LineStats {
  const s: LineStats = { lines: 0, ok: 0, short: 0, over: 0, extra: 0 }
  for (const b of batches) {
    for (const r of rows) {
      const st = cellState(r.cells[b.id], isFilled(b))
      if (st == null || st === 'removed') continue
      s.lines++
      if (st === 'ok') s.ok++
      else if (st === 'over') s.over++
      else if (st === 'extra') s.extra++
      else s.short++
    }
  }
  return s
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
