// XẾP BAND KHU THEO HẠNG NHẶT — NGUỒN DUY NHẤT.
//
// Trước 15/08 luật này chỉ có một người dùng (`slottingController`) nên nằm luôn trong đó. Đợt C
// thêm người dùng thứ hai: chiến thuật cất hàng "Theo ABC" phải chỉ vào ĐÚNG những khu mà Slotting
// coi là band của hạng đó — nếu không, Slotting kéo hàng A ra gần cửa rồi luồng nhập lại cất hàng A
// vào khu Slotting coi là band C, hai module tiếp tục đánh nhau y như trước.
// (Luật "mã nào hạng A/B/C" nằm trong SQL `material_abc` — migration 20260815h.)

export type Band = 'A' | 'B' | 'C'

export interface BandZone {
  code:       string
  categories: string[] | null
  pick_rank:  number | null
}

// Khu có Loại → CHỈ nhận mã có loại ∈ MẢNG loại của khu (mã chưa khai loại KHÔNG vào được).
// Khu chưa gắn Loại (di sản null/rỗng) → nhận mọi mã (khu đa dụng).
export function zoneAccepts(zone: { categories: string[] | null }, mat: { category: string | null }): boolean {
  if (!zone.categories?.length) return true
  return mat.category != null && zone.categories.includes(mat.category)
}

// 2 khu "cùng nhóm loại" nếu giao nhau ≥1 loại (dùng để xếp band trong nhóm khu tương đương)
export function zonesOverlap(a: string[] | null, b: string[] | null): boolean {
  if (!a?.length || !b?.length) return (!a?.length && !b?.length)
  return a.some(x => b.includes(x))
}

// Khu ứng viên của MỘT mã, xếp theo hạng nhặt (1 = gần cửa xuất nhất)
export function eligibleRankedZones<T extends BandZone>(zones: T[], mat: { category: string | null }): T[] {
  return zones
    .filter(z => z.pick_rank != null && zoneAccepts(z, mat))
    .sort((a, b) => (a.pick_rank! - b.pick_rank!) || a.code.localeCompare(b.code))
}

export function bandOfIndex(idx: number, n: number): Band {
  if (n <= 1) return 'A'
  const f = idx / n
  return f < 1 / 3 ? 'A' : f < 2 / 3 ? 'B' : 'C'
}

// MÃ khu nên cất mã hạng `abc` này. Rỗng = kho chưa xếp hạng khu nào hợp loại hàng đó
// ⇒ caller phải XUỐNG THANG THẤY ĐƯỢC, không im lặng chạy như chưa từng chọn ABC.
export function targetZoneCodes(
  zones: BandZone[], mat: { category: string | null }, abc: Band,
): string[] {
  const ranked = eligibleRankedZones(zones, mat)
  return ranked.filter((_, i) => bandOfIndex(i, ranked.length) === abc).map(z => z.code)
}
