// LƯU TRỮ CHUNG các sổ lớn lên theo năm (20/10/2026, user "ok làm đi" sau khi đo cả DB staging: 502 MB chạm trần 500 MB gói Free; thứ
// lớn theo năm là dòng ZSD02 / VL06O — 76 % byte của dòng là `raw` chép nguyên dòng SAP — rồi pallet, sổ vết, quét). Thay bản một-bảng
// `ledgerArchive` của sáng cùng ngày (bản đó đọc theo OFFSET rồi xoá cả tháng — hai lượt chạy chồng thì tệp thiếu dòng / ghi đè = MẤT DỮ LIỆU).
//
// • Cờ `retention_days` (Cài đặt WMS › Hệ thống), 0 = giữ mãi (mặc định, hành vi cũ):
//     ledger (outbound_events) · logs (admin_audit_events + alert_events đã đóng) · sap_lines (erp_outbound_orders + erp_so_lines)
//     ⇒ tháng quá hạn, MỖI PHẦN ≤ 20.000 dòng: đọc keyset (thời điểm, id) → CSV nén gzip lên bucket riêng tư
//     `ledger-archive/<bảng>/<YYYY-MM>[.pN].csv.gz` (KHÔNG ghi đè tệp có sẵn) → xoá ĐÚNG khoảng khoá vừa ghi (RPC archive_delete ném nếu
//     xoá nhiều hơn số đã ghi). · sap_raw ⇒ dòng SAP quá hạn chỉ giữ cột đã tách (RPC purge_sap_raw, giữ created_by).
// • Bảng nào được lưu trữ + cột thời gian + điều kiện nằm ở RPC `archive_spec` (danh sách trắng, migration 20261020d) — thêm bảng mới:
//   thêm ở đó + ARCHIVE_SPECS dưới đây. KHÔNG đưa vào chuỗi TRUY XUẤT LÔ (pallet · nhập · quét · đơn xuất · kiểm kê · điều chỉnh · in tem
//   · sổ đóng gói · wms_task_events): Truy xuất lô / Sổ pallet chỉ tra dữ liệu còn trong DB, hạn dùng dài nhất đo 20/10 = 2.160 ngày.
// • MỘT lượt tại một thời điểm: ổ khoá thuê có token (RPC data_archive_take / release), máy chủ giãn tối thiểu giữa hai lượt tự động.
// • Kích hoạt: FE gọi POST /wms/maintenance/archive sau khi app đã hiện (≤ 1 lần/giờ mỗi trình duyệt) — việc nền, không ké GET.
import { gzipSync } from 'zlib'
import { randomUUID } from 'crypto'
import { db } from '../lib/supabase'
import { getRetentionDaysFresh } from '../utils/settings'
import { vnDayOf } from '../utils/dates'
import type { Json } from '../types/database'

export const ARCHIVE_BUCKET = 'ledger-archive'
export type ArchiveGroup = 'ledger' | 'logs' | 'sap_lines'
export type ArchiveTask = ArchiveGroup | 'sap_raw'
export type ArchiveTable = 'outbound_events' | 'admin_audit_events' | 'alert_events' | 'erp_outbound_orders' | 'erp_so_lines'
type Spec = { table: ArchiveTable; group: ArchiveGroup; time: string; label: string }
export const ARCHIVE_SPECS: readonly Spec[] = [
  { table: 'outbound_events',     group: 'ledger',    time: 'created_at',  label: 'Sổ vết điều vận' },
  { table: 'admin_audit_events',  group: 'logs',      time: 'created_at',  label: 'Nhật ký quản trị' },
  { table: 'alert_events',        group: 'logs',      time: 'resolved_at', label: 'Cảnh báo đã đóng' },
  { table: 'erp_outbound_orders', group: 'sap_lines', time: 'created_at',  label: 'Dòng DO SAP (ZSD02 / VL06O)' },
  { table: 'erp_so_lines',        group: 'sap_lines', time: 'created_at',  label: 'Dòng SO chưa có OD (ZSD02)' },
]
const PART_ROWS = 20_000, PAGE_ROWS = 5_000, RAW_BATCH = 2_000, LEASE_S = 180
const PART_RE = /^(\d{4}-\d{2})(?:\.p(\d+))?\.csv\.gz$/

type Row = Record<string, unknown>
export type PartResult =
  | { table: ArchiveTable; status: 'off' }
  | { table: ArchiveTable; status: 'nothing'; cutoff: string }
  | { table: ArchiveTable; status: 'archived'; month: string; part: number; rows: number; deleted: number; path: string; cutoff: string }
export type RawResult = { task: 'sap_raw'; status: 'off' } | { task: 'sap_raw'; status: 'purged'; od: number; so: number; before: string }
export type RunResult = { status: 'busy' | 'recent' } | { status: 'ran'; results: (PartResult | RawResult)[]; ms: number }

const csvCell = (v: unknown) => {
  const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const nextMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}` }
const monthStartIso = (ym: string) => new Date(`${ym}-01T00:00:00+07:00`).toISOString()   // tháng theo lịch VN

/** Số phần lớn nhất đã có của tháng (0 = chưa có tệp) — phần mới lấy số kế tiếp, không bao giờ trùng tên tệp cũ. */
async function lastPart(table: ArchiveTable, month: string): Promise<number> {
  const { data, error } = await db.storage.from(ARCHIVE_BUCKET).list(table, { limit: 1000, search: month })
  if (error) throw new Error(`Storage: ${error.message}`)
  let max = 0
  for (const f of data ?? []) { const m = PART_RE.exec(f.name); if (m?.[1] === month) max = Math.max(max, m[2] ? Number(m[2]) : 1) }
  return max
}

/** Lưu trữ MỘT phần (≤ 20.000 dòng) của tháng cũ nhất đã quá hạn giữ của một bảng. */
export async function archivePart(spec: Spec, days: number): Promise<PartResult> {
  const cutoff = vnDayOf(new Date(Date.now() - days * 86_400_000))!
  const { data: oldest, error: oErr } = await db.rpc('archive_oldest', { p_table: spec.table })
  if (oErr) throw oErr
  if (!oldest) return { table: spec.table, status: 'nothing', cutoff }
  const month = vnDayOf(oldest)!.slice(0, 7)
  if (month >= cutoff.slice(0, 7)) return { table: spec.table, status: 'nothing', cutoff }   // chỉ tháng TRƯỚC tháng của mốc — trọn tháng
  const from = monthStartIso(month), to = monthStartIso(nextMonth(month))
  const rows: Row[] = []
  let after: { ts: string; id: string } | null = null
  while (rows.length < PART_ROWS) {
    const limit = Math.min(PAGE_ROWS, PART_ROWS - rows.length)
    const { data, error } = await db.rpc('archive_fetch', {
      p_table: spec.table, p_from: from, p_to: to, p_after_ts: after?.ts ?? null, p_after_id: after?.id ?? null, p_limit: limit,
    })
    if (error) throw error
    const page = (Array.isArray(data) ? data : []) as Row[]
    rows.push(...page)
    if (page.length < limit) break
    const last = page[page.length - 1]
    after = { ts: String(last[spec.time]), id: String(last.id) }
  }
  if (!rows.length) return { table: spec.table, status: 'nothing', cutoff }
  const cols = Object.keys(rows[0])
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\n')
  const part = (await lastPart(spec.table, month)) + 1
  const path = `${spec.table}/${part === 1 ? month : `${month}.p${part}`}.csv.gz`
  const { error: upErr } = await db.storage.from(ARCHIVE_BUCKET).upload(path, gzipSync(Buffer.from(csv, 'utf8')), { contentType: 'application/gzip', upsert: false })
  if (upErr) throw new Error(`Không ghi được tệp lưu trữ ${path}: ${upErr.message}`)   // lỗi ghi tệp ⇒ KHÔNG xoá
  const first = rows[0], last = rows[rows.length - 1]
  const { data: deleted, error: delErr } = await db.rpc('archive_delete', {
    p_table: spec.table, p_from: from, p_to: to, p_first_ts: String(first[spec.time]), p_first_id: String(first.id),
    p_last_ts: String(last[spec.time]), p_last_id: String(last.id), p_expected: rows.length,
  })
  if (delErr) throw delErr
  return { table: spec.table, status: 'archived', month, part, rows: rows.length, deleted: deleted ?? 0, path, cutoff }
}

/** Một lượt bảo trì: dọn `raw` quá hạn rồi lưu trữ các bảng theo cờ, trong ngân sách thời gian. `busy` = lượt khác đang chạy,
 *  `recent` = lượt trước chưa đủ giãn cách (`minGapS`, 0 = bỏ qua). */
export async function runArchive(opts: { minGapS: number; tasks?: ArchiveTask[]; budgetMs?: number }): Promise<RunResult> {
  const t0 = Date.now(), budget = opts.budgetMs ?? 30_000
  const token = randomUUID()
  const { data: take, error: tErr } = await db.rpc('data_archive_take', { p_token: token, p_lease_s: LEASE_S, p_min_gap_s: opts.minGapS })
  if (tErr) throw tErr
  if (take !== 'taken') return { status: take === 'busy' ? 'busy' : 'recent' }
  const results: (PartResult | RawResult)[] = []
  const want = (t: ArchiveTask) => !opts.tasks || opts.tasks.includes(t)
  let failed: string | null = null
  try {
    const ret = await getRetentionDaysFresh()
    if (want('sap_raw')) {
      if (!ret.sap_raw) results.push({ task: 'sap_raw', status: 'off' })
      else {
        const before = new Date(Date.now() - ret.sap_raw * 86_400_000).toISOString()
        let od = 0, so = 0
        for (;;) {
          const { data, error } = await db.rpc('purge_sap_raw', { p_before: before, p_limit: RAW_BATCH })
          if (error) throw error
          const r = (data ?? {}) as { od?: number; so?: number }
          od += r.od ?? 0; so += r.so ?? 0
          if ((r.od ?? 0) < RAW_BATCH && (r.so ?? 0) < RAW_BATCH) break
          if (Date.now() - t0 > budget) break
        }
        results.push({ task: 'sap_raw', status: 'purged', od, so, before })
      }
    }
    for (const spec of ARCHIVE_SPECS) {
      if (!want(spec.group)) continue
      const days = ret[spec.group]
      if (!days) { results.push({ table: spec.table, status: 'off' }); continue }
      while (Date.now() - t0 < budget) {
        const r = await archivePart(spec, days)
        results.push(r)
        if (r.status !== 'archived') break
      }
    }
  } catch (e) {
    failed = e instanceof Error ? e.message : String(e)
    throw e
  } finally {
    const summary = JSON.parse(JSON.stringify({ results, ms: Date.now() - t0, error: failed })) as Json
    await db.rpc('data_archive_release', { p_token: token, p_result: summary })
  }
  return { status: 'ran', results, ms: Date.now() - t0 }
}

export type ArchiveFile = { month: string; part: number; name: string; size: number | null; updated_at: string | null; url: string | null }
/** Tệp đã lưu trữ của một bảng (mới nhất trước, tối đa 240) + vé tải 1 giờ (service role — anon/authenticated không có policy storage). */
export async function listArchiveFiles(table: ArchiveTable): Promise<ArchiveFile[]> {
  const { data, error } = await db.storage.from(ARCHIVE_BUCKET).list(table, { limit: 1000, sortBy: { column: 'name', order: 'desc' } })
  if (error) throw new Error(`Storage: ${error.message}`)
  const files = (data ?? []).filter(f => PART_RE.test(f.name)).slice(0, 240)
  if (!files.length) return []
  const { data: signed } = await db.storage.from(ARCHIVE_BUCKET).createSignedUrls(files.map(f => `${table}/${f.name}`), 3600)
  const urlOf = new Map((signed ?? []).map(s => [s.path, s.signedUrl]))
  return files.map(f => {
    const m = PART_RE.exec(f.name)!
    const size = (f.metadata as { size?: unknown } | null)?.size
    return { month: m[1], part: m[2] ? Number(m[2]) : 1, name: f.name, size: typeof size === 'number' ? size : null, updated_at: f.updated_at ?? null, url: urlOf.get(`${table}/${f.name}`) ?? null }
  })
}
