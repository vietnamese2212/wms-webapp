/**
 * Sửa lệch QA: đổi tên QAStatus "X 7" → "X 7 ngày" và gán 20 pallet (file ghi "X 7 ngày") vào trạng thái đó.
 * Nguyên nhân: file dùng "X 7 ngày" còn DB tên "X 7" → 20 pallet vào kho bị qa_status_id NULL (mất cờ QA giữ).
 * Run 1 lần: cd backend && node ../scripts/fix_qa_x7.js ../templates/6_TonKho.xlsx
 * Idempotent: chạy lại không hỏng (đã đổi tên thì dùng luôn id của "X 7 ngày").
 */
const { supabase, S, readRows } = require('./_upload_util')

const KEYS = ['pallet_code', 'material_code', 'warehouse', 'location_code', 'cartons', 'production_date', 'ncc', 'qa_status', 'shelf_life_days']

async function main() {
  const now = new Date().toISOString()

  // 1) Đổi tên QAStatus "X 7" → "X 7 ngày" (nếu chưa đổi).
  const { data: qas } = await supabase.from('QAStatus').select('id, name')
  let target = (qas ?? []).find(q => q.name === 'X 7 ngày')
  if (!target) {
    const old = (qas ?? []).find(q => q.name === 'X 7')
    if (!old) { console.error('Không tìm thấy QAStatus "X 7" lẫn "X 7 ngày" — dừng.'); process.exit(1) }
    const { error } = await supabase.from('QAStatus').update({ name: 'X 7 ngày', updated_at: now }).eq('id', old.id)
    if (error) { console.error('Lỗi đổi tên QAStatus:', error.message); process.exit(1) }
    target = { id: old.id, name: 'X 7 ngày' }
    console.log('✅ Đổi tên QAStatus "X 7" → "X 7 ngày"')
  } else {
    console.log('• QAStatus "X 7 ngày" đã có sẵn (không đổi tên).')
  }

  // 2) Lấy danh sách pallet trong file có QA = "X 7 ngày" → gán qa_status_id (chỉ những dòng đang NULL).
  const rows = readRows(process.argv[2] || '../templates/6_TonKho.xlsx', KEYS)
  const pallets = rows.filter(r => S(r.qa_status) === 'X 7 ngày').map(r => S(r.pallet_code)).filter(Boolean)
  console.log(`File có ${pallets.length} pallet ghi "X 7 ngày".`)
  if (!pallets.length) { console.log('Không có pallet nào để gán.'); return }

  let fixed = 0
  for (let i = 0; i < pallets.length; i += 100) {
    const batch = pallets.slice(i, i + 100)
    const { data, error } = await supabase.from('InventoryEntry')
      .update({ qa_status_id: target.id, updated_at: now })
      .in('pallet_code', batch).is('qa_status_id', null).select('id')
    if (error) { console.error('Lỗi gán QA:', error.message); process.exit(1) }
    fixed += (data ?? []).length
  }
  console.log(`✅ Gán "X 7 ngày" cho ${fixed} pallet (đang NULL).`)
}
main().catch(e => { console.error(e); process.exit(1) })
