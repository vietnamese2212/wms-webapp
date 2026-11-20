// Upload Excel Vị trí kho — luật "ô trống" cho các cột KHÔNG bắt buộc (20/11).
// Lỗi gốc: dòng cho vị trí ĐÃ CÓ mà ô Sức chứa trống ⇒ ghi max_pallets = 1 (mặc định của dòng MỚI), ô Số mã tối đa /
// Kiểu trống ⇒ ghi NULL đè. Một file chỉ để THÊM vài ô vào khu có sẵn đã hạ sức chứa mọi ô cũ trong khu về 1.
// Luật (chuẩn upload-download-standard): dòng MỚI ⇒ ô trống lấy mặc định; dòng ĐÃ CÓ ⇒ ô trống GIỮ giá trị đang lưu.
// Một hàm cho cả nhánh cập nhật thường và nhánh thua đua (23505 → cập nhật bản người thắng).

export interface LocationUploadCells {
  max_pallets: number | null     // null = ô trống
  max_materials: number | null   // null = ô trống (trên dòng MỚI nghĩa là "không giới hạn")
  sub_type: string | null        // null = ô trống
}

export type LocationUploadFields = { max_pallets: number; max_materials: number | null; sub_type: string | null }

/** Giá trị ghi cho 3 cột tuỳ chọn: `existing` = bản đang lưu (null ⇒ dòng mới). */
export function locationUploadFields(cells: LocationUploadCells, existing: Record<string, unknown> | null): LocationUploadFields {
  if (!existing) return { max_pallets: cells.max_pallets ?? 1, max_materials: cells.max_materials, sub_type: cells.sub_type }
  const keepNum = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))
  return {
    max_pallets: cells.max_pallets ?? keepNum(existing.max_pallets) ?? 1,
    max_materials: cells.max_materials ?? keepNum(existing.max_materials),
    sub_type: cells.sub_type ?? ((existing.sub_type as string | null | undefined) ?? null),
  }
}
