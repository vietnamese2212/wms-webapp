/**
 * Copy khung giờ (SlotTemplate) từ 1 loại kho nguồn sang các loại kho đích — cho 1 kho.
 * Run: cd backend && node ../scripts/copy_slot_cargo.js
 * Idempotent: bỏ qua nếu đã có template trùng (kho, loại xe, loại kho đích, thứ, giờ từ/đến).
 * KHÔNG đụng slot đã sinh — ngày tương lai sẽ lazy-sinh loại kho mới khi mở lịch booking.
 */
const { supabase } = require('./_upload_util')
const { randomUUID } = require('crypto')

const WH = '56cf7a64-d3aa-4fd2-948d-490ec487acb9'   // Kho Ba Vì
const SRC = 'Thành phẩm'
const TARGETS = ['POSM', 'Raw', 'Giấy', 'Thùng']

;(async () => {
  const { data: src, error } = await supabase.from('SlotTemplate')
    .select('vehicle_type_id, day_of_week, time_from, time_to, max_vehicles, is_active, direction, created_by')
    .eq('warehouse_id', WH).eq('cargo_type', SRC)
  if (error) { console.error('Lỗi nạp nguồn:', error.message); process.exit(1) }
  if (!src?.length) { console.error('Không có template', SRC, 'cho kho này.'); process.exit(1) }
  console.log(`Nguồn: ${src.length} dòng "${SRC}".`)

  // Đã có gì ở các loại kho đích (để bỏ qua trùng)
  const { data: existing } = await supabase.from('SlotTemplate')
    .select('cargo_type, vehicle_type_id, day_of_week, time_from, time_to')
    .eq('warehouse_id', WH).in('cargo_type', TARGETS)
  const key = r => `${r.cargo_type}|${r.vehicle_type_id}|${r.day_of_week}|${String(r.time_from).slice(0,5)}|${String(r.time_to).slice(0,5)}`
  const have = new Set((existing ?? []).map(key))

  const now = new Date().toISOString()
  const rows = []
  const perCargo = {}
  for (const cargo of TARGETS) {
    perCargo[cargo] = 0
    for (const s of src) {
      const k = `${cargo}|${s.vehicle_type_id}|${s.day_of_week}|${String(s.time_from).slice(0,5)}|${String(s.time_to).slice(0,5)}`
      if (have.has(k)) continue
      perCargo[cargo]++
      rows.push({
        id: randomUUID(), warehouse_id: WH, vehicle_type_id: s.vehicle_type_id,
        cargo_type: cargo, day_of_week: s.day_of_week, time_from: s.time_from, time_to: s.time_to,
        max_vehicles: s.max_vehicles, is_active: s.is_active, direction: s.direction ?? null,
        created_at: now, updated_at: now, created_by: s.created_by ?? 'Admin', updated_by: 'Admin (copy Thành phẩm)',
      })
    }
  }

  if (!rows.length) { console.log('Không có gì để copy (đã đủ / trùng hết).'); process.exit(0) }
  console.log('Sẽ tạo:', Object.entries(perCargo).map(([c, n]) => `${c}=${n}`).join(', '), `(tổng ${rows.length})`)

  for (let i = 0; i < rows.length; i += 500) {
    const { error: insErr } = await supabase.from('SlotTemplate').insert(rows.slice(i, i + 500))
    if (insErr) { console.error('Lỗi insert:', insErr.message); process.exit(1) }
  }
  console.log(`✓ Đã copy ${rows.length} dòng khung giờ sang ${TARGETS.join(', ')}.`)

  // Tổng kết
  const { data: after } = await supabase.from('SlotTemplate')
    .select('cargo_type').eq('warehouse_id', WH)
  const cnt = {}
  for (const r of after ?? []) cnt[r.cargo_type] = (cnt[r.cargo_type] ?? 0) + 1
  console.log('Tổng theo loại kho:', JSON.stringify(cnt))
})()
