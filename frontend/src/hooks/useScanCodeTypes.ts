// Loại mã camera được giải, THEO TỪNG KHO (`Warehouse.scan_code_types`, migration 20260821e).
// User chốt 21/08: "kho nào chỉ bắt QR, kho nào chỉ bắt barcode, kho nào bắt cả 2".
//
// Tra theo KHO CỦA NGHIỆP VỤ đang làm (kho của phiếu/chuyến/trang sổ), KHÔNG theo kho của người
// đang đăng nhập — một người có thể quét phiếu của kho khác. Màn nào không có kho nghiệp vụ (ô tìm
// kiếm ở Header) thì lấy bối cảnh Kho toàn cục; vẫn không có thì 'BOTH'.
//
// Không tìm thấy kho ⇒ 'BOTH' (nới), TUYỆT ĐỐI không siết: tra cấu hình trượt mà lại chặn giải mã
// thì người quét đứng trước camera "không ăn" mà không có gì để hiểu vì sao. Nới thì tệ nhất cũng
// chỉ về đúng hành vi trước 21/08.
import { useMemo } from 'react'
import { useWarehouses } from '@/api/hooks'
import { useGlobalScopeStore } from '@/stores/globalScopeStore'
import type { ScanCodeTypes } from '@/utils/scanEngine'

const VALUES: ScanCodeTypes[] = ['QR', 'BARCODE', 'BOTH']

export function useScanCodeTypes(warehouseId?: string | null): ScanCodeTypes {
  const { data: warehouses } = useWarehouses(true)
  const globalWhId = useGlobalScopeStore(s => s.warehouseId)
  return useMemo(() => {
    const id = warehouseId || globalWhId || null
    if (!id) return 'BOTH'
    const rows = (warehouses ?? []) as { id: string; scan_code_types?: string | null }[]
    const raw = rows.find(w => w.id === id)?.scan_code_types
    const v = String(raw ?? '').toUpperCase() as ScanCodeTypes
    return VALUES.includes(v) ? v : 'BOTH'
  }, [warehouses, warehouseId, globalWhId])
}
