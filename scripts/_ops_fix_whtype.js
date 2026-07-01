/** Sửa loại kho (warehouse_type) seed nhầm 'CENTRAL' → đúng loại hàng. Ops-test dọn dẹp. */
const { supabase } = require('./_upload_util')
const WH = '56cf7a64-d3aa-4fd2-948d-490ec487acb9'
async function main() {
  const g = await supabase.from('GroupDeliveryOrder').update({ warehouse_type: 'Thành phẩm' })
    .eq('warehouse_id', WH).eq('warehouse_type', 'CENTRAL').select('id')
  const gr = await supabase.from('gate_registrations').update({ warehouse_type: 'Thành phẩm' })
    .eq('warehouse_id', WH).eq('date', '2026-07-01').eq('warehouse_type', 'CENTRAL').select('id')
  console.log('GDO sửa:', g.data?.length ?? g.error?.message, '| gate sửa:', gr.data?.length ?? gr.error?.message)
}
main().catch(e => { console.error(e); process.exit(1) })
