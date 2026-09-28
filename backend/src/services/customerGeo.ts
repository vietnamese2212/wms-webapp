// customerGeo — nuôi cột địa lý của danh mục Khách hàng từ ZSD02 (ward_code = KHOÁ CƯỚC, vùng, khu vực bán, địa chỉ).
// Luật: khách LẠ → tạo (qua ensureCustomers); khách ĐÃ CÓ → chỉ điền ô TRỐNG (kể cả KÊNH từ kênh SAP, 28/09),
// KHÔNG đè ô đã có (người có thể đã sửa tay). Ship-to → phường là 1-1 trên dữ liệu (286/286) nên an toàn; lệch với
// giá trị đang có thì đếm để báo, không đè.
import { db } from '../lib/supabase'
import { fetchAllByIdChunks } from '../utils/pagination'
import { ensureCustomers, normShipto } from './dateRulePolicy'
import { sapChannelMap, channelToFill } from '../utils/sapChannel'
import type { CustomerGeo } from './zsd02Parse'
import type { Database } from '../types/database'

type CustomerRow = Database['public']['Tables']['Customer']['Row']
const GEO_COLS = ['ward_code', 'region_code', 'region_name', 'sales_district', 'sales_office', 'address', 'sold_to_code', 'search_term'] as const

export interface CustomerGeoResult { created: number; filled: number; conflicts: number; channel_filled: number }

export async function upsertCustomerGeo(rows: CustomerGeo[], actor: string | null): Promise<CustomerGeoResult> {
  const byCode = new Map<string, CustomerGeo>()
  for (const r of rows) { const c = normShipto(r.ship_to_code); if (c && !byCode.has(c)) byCode.set(c, { ...r, ship_to_code: c }) }
  if (!byCode.size) return { created: 0, filled: 0, conflicts: 0, channel_filled: 0 }

  const created = await ensureCustomers([...byCode.values()].map(r => ({ ship_to_code: r.ship_to_code, name: r.name })), actor)
  // KÊNH (28/09, user: "tự điền từ SAP; kênh là nơi khai riêng — khai thêm kênh không có trên SAP như BHX"): khách CHƯA có kênh
  // ⇒ lấy theo kênh SAP của dòng ZSD02 nếu danh mục có kênh khai mã đó; khách đã có kênh (người gán tay, vd BHX) ⇒ giữ nguyên
  const { data: chans, error: chErr } = await db.from('LookupValue').select('value, meta').eq('type', 'customer_channel')
  if (chErr) throw chErr
  const sapMap = sapChannelMap((chans ?? []) as { value: string; meta: unknown }[])

  // Nạp TRỌN dòng (select *) rồi đắp ô trống → upsert full record chunk 500 (luật upload: cột thiếu trong lô sẽ bị NULL đè).
  const existing = await fetchAllByIdChunks([...byCode.keys()], chunk =>
    db.from('Customer').select('*').in('ship_to_code', chunk).order('id')) as CustomerRow[]
  const t = new Date().toISOString()
  const toWrite: CustomerRow[] = []
  let filled = 0, conflicts = 0, channel_filled = 0
  for (const ex of existing) {
    const geo = byCode.get(ex.ship_to_code)
    if (!geo) continue
    let changed = false
    const next: CustomerRow = { ...ex }
    for (const col of GEO_COLS) {
      const v = geo[col]
      if (v == null || v === '') continue
      const cur = ex[col]
      if (cur == null || cur === '') { (next as Record<string, unknown>)[col] = v; changed = true }
      else if (String(cur).trim() !== String(v).trim()) conflicts++
    }
    const ch = channelToFill(ex.channel, geo.dist_channel, sapMap)
    if (ch) { next.channel = ch; changed = true; channel_filled++ }
    if (changed) { next.updated_at = t; next.updated_by = actor; toWrite.push(next); filled++ }
  }
  for (let i = 0; i < toWrite.length; i += 500) {
    const { error } = await db.from('Customer').upsert(toWrite.slice(i, i + 500), { onConflict: 'ship_to_code' })
    if (error) { console.error('[customerGeo] upsert:', error.message); break }
  }
  return { created, filled, conflicts, channel_filled }
}
