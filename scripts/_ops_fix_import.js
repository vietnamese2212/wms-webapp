/** Dọn phần KH Nhập seed sai (mã hàng random) của Ba Vì ngày 01/07 để bơm lại đúng loại kho. */
const { supabase } = require('./_upload_util')
const WH = '56cf7a64-d3aa-4fd2-948d-490ec487acb9'
const DATE = '2026-07-01'

;(async () => {
  const { count: c1, error: e1 } = await supabase.from('inbound_plan_lines')
    .delete({ count: 'exact' }).eq('warehouse_id', WH).eq('date', DATE)
  if (e1) { console.error('xóa lines:', e1.message); process.exit(1) }

  const { data: inOrders } = await supabase.from('TmsOrder')
    .select('id').eq('warehouse_id', WH).eq('date', DATE).eq('direction', 'INBOUND')
  const ids = (inOrders ?? []).map(o => o.id)
  if (ids.length) {
    await supabase.from('TmsVehicleSlot').delete().in('order_id', ids)
    const { error: e3 } = await supabase.from('TmsOrder').delete().in('id', ids)
    if (e3) { console.error('xóa orders:', e3.message); process.exit(1) }
  }
  console.log(`Đã xóa ${c1} dòng nhập + ${ids.length} lệnh INBOUND (Ba Vì 01/07). Giờ bơm lại đúng loại kho.`)
})()
