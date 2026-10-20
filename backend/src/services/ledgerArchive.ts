// LƯU TRỮ SỔ VẾT `outbound_events` ra Storage theo THÁNG (20/10/2026, user: "dữ liệu của nó sẽ là rất nhiều ngày, vài năm —
// 1,5–2 triệu dòng mà tới 1 GB là quá lớn, xử lý luôn"). Đo staging: 305 B/dòng + ~250 B chỉ mục ⇒ ~0,5 triệu vết/năm ≈ 280 MB/năm.
// Cách: cờ `retention_days.ledger` (số NGÀY giữ trong DB; 0 = giữ mãi — mặc định, người bật ở Cài đặt WMS › Hệ thống). Mỗi lượt xử
// MỘT THÁNG cũ nhất đã quá hạn: đọc đủ dòng (phân trang 1.000, không cap), ghi CSV nén gzip lên bucket riêng tư `ledger-archive`
// (`outbound_events/<YYYY-MM>.csv.gz`, upsert — chạy lại không đẻ đôi), rồi mới XOÁ các dòng đó khỏi DB (lỗi ghi tệp ⇒ không xoá).
// GIỮ LẠI trong DB các vết `QTY_REDUCED*` (RPC `service_level` dựng nhu cầu gốc từ chúng, rất ít dòng). Tệp tải về qua vé ký ở
// tab Lịch sử. Kích hoạt: FE tab Lịch sử gọi `POST /tms/dispatch/history/archive` sau khi trang đã hiện (không ké vào GET).
import { gzipSync } from 'zlib'
import { db } from '../lib/supabase'
import { getRetentionDays } from '../utils/settings'
import { fetchAllRowsParallel } from '../utils/pagination'
import { vnDayOf } from '../utils/dates'

export const LEDGER_BUCKET = 'ledger-archive'
const PREFIX = 'outbound_events'
const KEEP_TYPES = ['QTY_REDUCED', 'QTY_REDUCED_TO_ACTUAL']
const KEEP_FILTER = `(${KEEP_TYPES.join(',')})`
const COLS = ['id', 'created_at', 'group_code', 'gdo_id', 'event_type', 'source', 'actor', 'do_number', 'material_code', 'old_value', 'new_value', 'detail'] as const
type Row = Record<(typeof COLS)[number], string | null>
const csvCell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const nextMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}` }
const monthStartIso = (ym: string) => new Date(`${ym}-01T00:00:00+07:00`).toISOString()   // tháng theo lịch VN

export type ArchiveResult =
  | { status: 'off' }
  | { status: 'nothing'; cutoff: string }
  | { status: 'archived'; month: string; rows: number; deleted: number; path: string; cutoff: string }

/** Lưu trữ MỘT tháng cũ nhất đã quá hạn giữ. Gọi lặp cho tới khi `nothing`. */
export async function archiveOldestMonth(): Promise<ArchiveResult> {
  const days = (await getRetentionDays()).ledger
  if (!days) return { status: 'off' }
  const cutoff = vnDayOf(new Date(Date.now() - days * 86_400_000))!
  const cutoffMonth = cutoff.slice(0, 7)
  // dòng cũ nhất còn trong DB (trừ loại giữ lại) — một câu, index (event_type, created_at) không lãnh được ORDER BY created_at nên
  // là quét; chạy một lần mỗi lượt mở tab, chấp nhận
  const { data: oldest, error: oErr } = await db.from('outbound_events').select('created_at').not('event_type', 'in', KEEP_FILTER).order('created_at', { ascending: true }).limit(1)
  if (oErr) throw oErr
  if (!oldest?.length) return { status: 'nothing', cutoff }
  const month = vnDayOf(oldest[0].created_at)!.slice(0, 7)
  if (month >= cutoffMonth) return { status: 'nothing', cutoff }   // chỉ tháng TRƯỚC tháng của mốc — trọn tháng mới lưu trữ
  const start = monthStartIso(month), end = monthStartIso(nextMonth(month))
  const rows = (await fetchAllRowsParallel(() => db.from('outbound_events').select(COLS.join(', '))
    .gte('created_at', start).lt('created_at', end).not('event_type', 'in', KEEP_FILTER).order('created_at').order('id'), 1000, 4)) as Row[]
  const csv = [COLS.join(','), ...rows.map(r => COLS.map(c => csvCell(r[c])).join(','))].join('\n')
  const path = `${PREFIX}/${month}.csv.gz`
  const { error: upErr } = await db.storage.from(LEDGER_BUCKET).upload(path, gzipSync(Buffer.from(csv, 'utf8')), { contentType: 'application/gzip', upsert: true })
  if (upErr) throw new Error(`Không ghi được tệp lưu trữ ${path}: ${upErr.message}`)
  const { error: delErr, count } = await db.from('outbound_events').delete({ count: 'exact' })
    .gte('created_at', start).lt('created_at', end).not('event_type', 'in', KEEP_FILTER)
  if (delErr) throw delErr
  return { status: 'archived', month, rows: rows.length, deleted: count ?? 0, path, cutoff }
}

export type ArchiveFile = { month: string; name: string; size: number | null; updated_at: string | null; url: string | null }
/** Danh sách tệp đã lưu trữ + vé tải 1 giờ (service role — anon/authenticated không có policy storage). */
export async function listArchiveFiles(): Promise<ArchiveFile[]> {
  const { data, error } = await db.storage.from(LEDGER_BUCKET).list(PREFIX, { limit: 240, sortBy: { column: 'name', order: 'desc' } })
  if (error) throw new Error(`Storage: ${error.message}`)
  const files = (data ?? []).filter(f => /^\d{4}-\d{2}\.csv\.gz$/.test(f.name))
  if (!files.length) return []
  const paths = files.map(f => `${PREFIX}/${f.name}`)
  const { data: signed } = await db.storage.from(LEDGER_BUCKET).createSignedUrls(paths, 3600)
  const urlOf = new Map((signed ?? []).map(s => [s.path, s.signedUrl]))
  return files.map(f => ({
    month: f.name.slice(0, 7), name: f.name,
    size: typeof (f.metadata as { size?: unknown } | null)?.size === 'number' ? (f.metadata as { size: number }).size : null,
    updated_at: f.updated_at ?? null, url: urlOf.get(`${PREFIX}/${f.name}`) ?? null,
  }))
}
