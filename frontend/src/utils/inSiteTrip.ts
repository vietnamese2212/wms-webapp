// CHUYẾN TRONG KHUÔN VIÊN — cùng luật với `isInSiteTrip` ở backend (outboundController): biển số tuỳ chọn, không cần
// ĐVVT / Loại xe, miễn đăng ký cổng / cân / cửa xuất (hàng đi xe nâng / đẩy tay, không lên xe tải). Hai trường hợp:
//   • cặp kho cha ↔ kho phụ (cùng site), hai chiều — kho đích = KHÁCH TRỎ KHO của ship-to (28/09);
//   • kho phụ XUẤT TIÊU HAO (không ship-to) — 26/11 user: "bản chất kho chế biến đâu có yêu cầu biển số xe".
// Trước 26/11 luật cặp nội bộ chép tay ở 2 trang (Outbound · OutboundDetail) — gom về đây; sửa luật thì sửa cả BE.
export interface InSiteWh { id: string; parent_warehouse_id?: string | null }

export function isInSiteTrip(
  whs: readonly InSiteWh[],
  sourceWhId: string | null | undefined,
  destWhId: string | null | undefined,
  shipto: string | null | undefined,
): boolean {
  if (!sourceWhId) return false
  const src = whs.find(w => w.id === sourceWhId)
  if (!String(shipto ?? '').trim()) return !!src?.parent_warehouse_id
  if (!destWhId) return false
  const dest = whs.find(w => w.id === destWhId)
  if (!dest) return false
  return dest.parent_warehouse_id === sourceWhId || (src?.parent_warehouse_id ?? null) === dest.id
}
