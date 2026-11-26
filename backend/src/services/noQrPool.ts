// 26/11 — TỒN GỘP CỦA HÀNG KHÔNG TEM CÓ TÁCH THEO NSX KHÔNG: MỘT câu trả lời cho mọi cửa
// (Lưu thủ công của phiếu nhập · trang phiếu nhập · hộp "Lưu số lượng" của chuyến xuất · ghi nhận xuất).
// Trước 26/11 câu này là `inventory_mode === 'QTY_DATE'` chép ở từng cửa; nay thêm kho QR bật "Hàng không tem theo NSX"
// (cờ 2 tầng Kho + Loại kho — user 26/11 cho Chế biến Ba Vì) nên gom về đây. Đừng so `'QTY_DATE'` trực tiếp ở controller.
// Lỗi đọc ⇒ NÉM (route trả 503 / 500), không đoán "không theo NSX": đoán sai là nhập tồn không NSX vào kho đã bật luật.
import { db } from '../lib/supabase'
import { poolTracksDate } from '../lib/inventoryMode'
import { resolveNoQrDateTracking, type WhTypeConfigRow } from '../utils/putaway'

export interface NoQrPoolPolicy {
  /** tồn gộp tách 1 dòng / (mã, NSX): lưu thủ công bắt NSX, xuất chọn được NSX */
  byDate: boolean
  /** chế độ truyền cho RPC tồn gộp (`outbound_pool_apply.p_mode`): 'QTY_DATE' khi byDate, còn lại = chế độ kho */
  poolMode: string | null
  inventoryMode: string | null
  /** byDate đến từ cờ của kho QR (không phải chế độ kho QTY_DATE) — để câu báo nói đúng chỗ bật */
  viaFlag: boolean
}

/** `category` = `Material.category` của mã (giá trị đơn) — chuỗi ghép của chuyến sẽ rơi về mặc định kho. */
export async function noQrPoolPolicy(warehouseId: string | null | undefined, category: string | null | undefined): Promise<NoQrPoolPolicy> {
  if (!warehouseId) return { byDate: false, poolMode: null, inventoryMode: null, viaFlag: false }
  const { data: wh, error: wErr } = await db.from('Warehouse').select('inventory_mode, noqr_date_tracking').eq('id', warehouseId).maybeSingle()
  if (wErr) throw wErr
  const mode = wh?.inventory_mode ?? null
  let flag = false
  if (mode === 'QR') {   // cờ chỉ có nghĩa ở kho QR — kho khác khỏi tốn lượt đọc tầng loại
    const { data: typeRows, error: tErr } = await db.from('warehouse_type_configs').select('type_code, noqr_date_tracking').eq('warehouse_id', warehouseId)
    if (tErr) throw tErr
    flag = resolveNoQrDateTracking(wh as Record<string, unknown> | null, (typeRows ?? []) as WhTypeConfigRow[], category).enabled
  }
  const byDate = poolTracksDate(mode, flag)
  return { byDate, poolMode: byDate ? 'QTY_DATE' : mode, inventoryMode: mode, viaFlag: byDate && mode === 'QR' }
}

/** Câu báo khi lưu thủ công thiếu NSX — nói đúng luật đang áp (chế độ kho hay cờ của kho QR). */
export function nsxRequiredMessage(p: NoQrPoolPolicy): string {
  return p.viaFlag
    ? 'Kho này theo dõi hàng không tem theo NSX — phải nhập NSX (ngày sản xuất) khi lưu thủ công'
    : 'Kho theo dõi tồn theo date — phải nhập NSX (ngày sản xuất) khi lưu thủ công'
}
