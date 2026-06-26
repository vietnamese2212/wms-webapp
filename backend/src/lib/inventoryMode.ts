// Chế độ quản tồn của kho (Warehouse.inventory_mode) — xem migration 20260626_warehouse_inventory_mode.sql.
//   'QR'   = theo dõi tồn đầy đủ qua QR (pallet/vị trí/quét).
//   'QTY'  = theo dõi tồn dạng số lượng, KHÔNG QR → mọi mã hàng trong kho hành xử như mã no_qr_tracking.
//   'NONE' = không theo dõi tồn (chưa wire hành vi).
//
// "no-QR HIỆU LỰC" = OR một chiều: kho QTY ép mọi mã thành thủ công, HOẶC mã tự bật no_qr_tracking.
// Chiều ngược (kho QTY biến mã no_qr thành QR) không xảy ra. Kho QR ('QR') → giữ nguyên theo flag mã.

export function effectiveNoQr(
  materialNoQr: boolean | null | undefined,
  inventoryMode: string | null | undefined,
): boolean {
  return materialNoQr === true || inventoryMode === 'QTY'
}

// Kho QTY → đánh dấu mọi item đã load là no-QR (mutate in-memory) để toàn bộ logic/hiển thị
// downstream (vốn đọc material.no_qr_tracking) tự xử như mã không theo dõi QR — không phải sửa từng nhánh.
export function markItemsNoQrIfQty(
  items: Array<{ material?: { no_qr_tracking?: boolean | null } | null } | null | undefined>,
  inventoryMode: string | null | undefined,
): void {
  if (inventoryMode !== 'QTY') return
  for (const it of items) {
    if (it && it.material) it.material.no_qr_tracking = true
  }
}
