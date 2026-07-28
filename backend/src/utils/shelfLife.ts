// HSD (shelf-life) hiệu lực theo NCC — ngoại lệ NCC đè định mức chung.
// Nếu material có supplier_shelf_life_overrides cho NCC đang xét → dùng giá trị đó;
// không có NCC (SX/chuyển kho/pallet cũ) hoặc không khai override → dùng shelf_life_days mặc định.

export interface SupplierOverride {
  transport_company_id: string
  shelf_life_days: number
}

export interface MaterialShelfInfo {
  shelf_life_days?: number | null
  supplier_shelf_life_overrides?: SupplierOverride[] | null
}

// Lưu ý: 1 NCC có thể khai NHIỀU shelflife (vd 100 & 200 ngày). Khi đó KHÔNG tự quyết được
// từ (material, ncc) → trả base; giá trị thật phải lấy từ InventoryEntry.shelf_life_days (chọn lúc nhận).
// Chỉ khi NCC có ĐÚNG 1 shelflife mới suy ra tự động.
export function effShelfLife(
  material: MaterialShelfInfo | null | undefined,
  nccId: string | null | undefined,
): number {
  const base = Number(material?.shelf_life_days ?? 0)
  if (!material || !nccId) return base
  const matches = (material.supplier_shelf_life_overrides ?? [])
    .filter(o => o.transport_company_id === nccId && o.shelf_life_days != null && Number(o.shelf_life_days) > 0)
  return matches.length === 1 ? Number(matches[0].shelf_life_days) : base
}

// %Date dùng shelflife hiệu lực của 1 pallet: ưu tiên giá trị chọn theo lô (entry) → suy theo NCC → mặc định.
export function resolveShelfLife(
  entryShelfLife: number | null | undefined,
  material: MaterialShelfInfo | null | undefined,
  nccId: string | null | undefined,
): number {
  if (entryShelfLife != null && Number(entryShelfLife) > 0) return Number(entryShelfLife)
  return effShelfLife(material, nccId)
}

export interface PctDateEntry {
  production_date?: string | Date | null
  expiry_date?:     string | Date | null   // HSD tường minh trên tem V2 (`;`) — nếu có thì ưu tiên tuyệt đối
  shelf_life_days?: number | null
  ncc_id?:          string | null
}

// %Date CÒN LẠI của 1 pallet (0..100+, CHƯA làm tròn). Trả null nếu không đủ dữ liệu.
// - Tem V2 có expiry_date TƯỜNG MINH → dùng thẳng HSD (mẫu số = HSD − NSX; thiếu NSX thì lấy shelflife).
//   ⇒ ĐV2 không cần khai shelf_life cho từng mã vẫn tính được %Date.
// - Tem V1 (không expiry_date) → NSX + shelflife như cũ (kết quả TRÙNG KHỚP công thức cũ, không đổi hành vi).
export function computePctDate(
  entry: PctDateEntry,
  material: MaterialShelfInfo | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  const prodMs = entry.production_date ? new Date(entry.production_date).getTime() : NaN

  if (entry.expiry_date) {
    const expMs = new Date(entry.expiry_date).getTime()
    if (!isNaN(expMs)) {
      const shelfDays = resolveShelfLife(entry.shelf_life_days, material, entry.ncc_id)
      const totalMs = (!isNaN(prodMs) && expMs > prodMs)
        ? expMs - prodMs
        : (shelfDays > 0 ? shelfDays * 86_400_000 : NaN)
      if (isNaN(totalMs) || totalMs <= 0) return null
      return Math.max(0, ((expMs - nowMs) / totalMs) * 100)
    }
  }

  const shelfDays = resolveShelfLife(entry.shelf_life_days, material, entry.ncc_id)
  if (isNaN(prodMs) || shelfDays <= 0) return null
  const totalMs = shelfDays * 86_400_000
  return Math.max(0, ((prodMs + totalMs - nowMs) / totalMs) * 100)
}
