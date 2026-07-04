/**
 * Gộp OutboundDelivery theo NPP trong từng chuyến (GDO) — chuẩn nghiệp vụ chốt 04/07/2026:
 * NPP là chìa khóa tách dòng; DO/Delivery chỉ là THAM KHẢO (nối chuỗi vào delivery_code).
 * Run: cd backend && node ../scripts/merge_do_by_npp.js
 * An toàn: đã kiểm DB 04/07 — 0 cặp (gdo,npp,mã hàng) trùng, 0 scan → chỉ chuyển item về DO
 * canonical + nối mã Delivery + xóa DO rỗng, KHÔNG phải cộng dồn item.
 */
const { supabase, fetchAll } = require('./_upload_util')

;(async () => {
  const dos = await fetchAll('OutboundDelivery', 'id, gdo_id, delivery_code, distributor_name')
  console.log(`Tổng DO hiện có: ${dos.length}`)

  // Gom theo (gdo, NPP)
  const groups = new Map()
  for (const d of dos) {
    const key = `${d.gdo_id}|${String(d.distributor_name ?? '').trim()}`
    const list = groups.get(key) ?? []
    list.push(d)
    groups.set(key, list)
  }

  const before = await supabase.from('OutboundItem').select('id', { count: 'exact', head: true })
  console.log(`Tổng item trước gộp: ${before.count}`)

  let merged = 0, removedDos = 0
  for (const [key, list] of groups) {
    if (list.length < 2) continue
    list.sort((a, b) => String(a.delivery_code ?? '').localeCompare(String(b.delivery_code ?? '')))
    const canonical = list[0]
    const others = list.slice(1)
    const refs = [...new Set(list.map(d => String(d.delivery_code ?? '').trim()).filter(Boolean))].join(', ') || null

    // Chuyển item của các DO thừa về DO canonical
    const otherIds = others.map(d => d.id)
    const { error: mvErr } = await supabase.from('OutboundItem')
      .update({ do_id: canonical.id }).in('do_id', otherIds)
    if (mvErr) { console.error(`  ERR move items ${key}:`, mvErr.message); process.exit(1) }

    // Cập nhật delivery_code tham khảo + xóa DO rỗng
    const { error: upErr } = await supabase.from('OutboundDelivery')
      .update({ delivery_code: refs, updated_at: new Date().toISOString() }).eq('id', canonical.id)
    if (upErr) { console.error(`  ERR update canonical ${key}:`, upErr.message); process.exit(1) }
    const { error: delErr } = await supabase.from('OutboundDelivery').delete().in('id', otherIds)
    if (delErr) { console.error(`  ERR delete DOs ${key}:`, delErr.message); process.exit(1) }

    merged++
    removedDos += others.length
    console.log(`  OK ${key} — gộp ${list.length} DO → 1 (refs: ${refs})`)
  }

  const after = await supabase.from('OutboundItem').select('id', { count: 'exact', head: true })
  const dosAfter = await supabase.from('OutboundDelivery').select('id', { count: 'exact', head: true })
  console.log(`\nĐã gộp ${merged} nhóm (xóa ${removedDos} DO thừa).`)
  console.log(`Item sau gộp: ${after.count} (trước ${before.count}) — PHẢI BẰNG NHAU`)
  console.log(`DO còn lại: ${dosAfter.count}`)
  if (after.count !== before.count) { console.error('❌ LỆCH SỐ ITEM — kiểm tra ngay!'); process.exit(1) }
  console.log('✓ Toàn vẹn item OK.')
})()
