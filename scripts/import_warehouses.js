/**
 * Import / cập nhật Kho từ templates/1_Kho.xlsx
 * Run: cd backend && node ../scripts/import_warehouses.js ../templates/1_Kho.xlsx
 *
 * UPSERT THEO TÊN: kho trùng tên (đã có) → CẬP NHẬT mã + thông tin (giữ id → nhân viên/vị trí
 * vẫn liên kết). Kho mới → THÊM. Mặc định warehouse_type=CENTRAL, inventory_mode=QR.
 * Chặn nếu mã mới đã thuộc về kho KHÁC (tránh trùng mã).
 */
const { supabase, S, readRows } = require('./_upload_util')
const { randomUUID } = require('crypto')

const KEYS = ['code', 'name', 'warehouse_type', 'inventory_mode', 'nmsx_code', 'address']

async function main() {
  const rows = readRows(process.argv[2] || '../templates/1_Kho.xlsx', KEYS)
  const { data: ex } = await supabase.from('Warehouse').select('id, code, name')
  const byName = new Map((ex ?? []).map(w => [String(w.name).trim().toLowerCase(), w]))
  const codeOwner = new Map((ex ?? []).map(w => [String(w.code).trim().toLowerCase(), w.id])) // code → id sở hữu
  const now = new Date().toISOString()
  let add = 0, upd = 0, skip = 0, err = 0

  for (const r of rows) {
    const code = S(r.code), name = S(r.name)
    if (!code || !name) { console.log('  SKIP (thiếu mã/tên)'); skip++; continue }
    const fields = {
      warehouse_type: (S(r.warehouse_type) || 'CENTRAL').toUpperCase(),
      inventory_mode: (S(r.inventory_mode) || 'QR').toUpperCase(),
      nmsx_code: S(r.nmsx_code), address: S(r.address), updated_at: now,
    }
    const existing = byName.get(name.toLowerCase())
    const owner = codeOwner.get(code.toLowerCase())
    if (owner && (!existing || owner !== existing.id)) {
      console.error(`  ERR ${code} (${name}) — mã đã thuộc kho khác`); err++; continue
    }
    if (existing) {
      const { error } = await supabase.from('Warehouse').update({ code, name, ...fields }).eq('id', existing.id)
      if (error) { console.error('  ERR', name, '—', error.message); err++; continue }
      console.log('  CẬP NHẬT', name, '→ mã', code)
      codeOwner.delete(String(existing.code).trim().toLowerCase()); codeOwner.set(code.toLowerCase(), existing.id)
      existing.code = code
      upd++
    } else {
      const id = randomUUID()
      const { error } = await supabase.from('Warehouse').insert({ id, code, name, is_active: true, created_at: now, ...fields })
      if (error) { console.error('  ERR', name, '—', error.message); err++; continue }
      console.log('  THÊM', code, '—', name)
      byName.set(name.toLowerCase(), { id, code, name }); codeOwner.set(code.toLowerCase(), id)
      add++
    }
  }
  console.log(`\nKho: ${add} thêm · ${upd} cập nhật · ${skip} bỏ qua · ${err} lỗi`)
}
main().catch(e => { console.error(e); process.exit(1) })
