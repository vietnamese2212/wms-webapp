/**
 * Sửa tồn đầu kỳ: pallet QA "OK" → qa_status_id NULL (quy ước app: NULL = tốt; chỉ pallet GIỮ mới có qa_status).
 * Nguyên nhân: import gán nhầm id "OK" cho dòng QA trống → FE tô đỏ cả kho. Run 1 lần.
 * cd backend && node ../scripts/fix_qa_ok_null.js
 */
const { supabase } = require('./_upload_util')

async function main() {
  const { data: qas } = await supabase.from('QAStatus').select('id, name, code')
  const okIds = (qas ?? []).filter(q => q.name === 'OK' || q.code === 'OK').map(q => q.id)
  if (!okIds.length) { console.error('Không tìm thấy QAStatus "OK".'); process.exit(1) }

  let total = 0
  for (let i = 0; i < 100; i++) {   // lặp theo lô tới khi hết (mỗi update select trả tối đa 1000)
    const { data, error } = await supabase.from('InventoryEntry')
      .update({ qa_status_id: null, updated_at: new Date().toISOString() })
      .in('qa_status_id', okIds).select('id')
    if (error) { console.error('Lỗi:', error.message); process.exit(1) }
    const n = (data ?? []).length
    total += n
    if (n < 1000) break
  }
  console.log(`✅ Đưa ${total} pallet QA "OK" về NULL (hết tô đỏ).`)
}
main().catch(e => { console.error(e); process.exit(1) })
