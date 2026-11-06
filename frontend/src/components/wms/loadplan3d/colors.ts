// Màu từng MÃ hàng — dùng chung cho sơ đồ 3D và danh sách mã, để ô màu ở danh sách khớp đúng thùng trên xe.
// KHÔNG import three ở đây: file này nằm trong gói của màn chuyến, three chỉ tải khi sơ đồ mở.

const PALETTE = [
  '#2f6fe0', '#d9622b', '#2a9d8f', '#8e5bd0', '#d43f52', '#c99a1a',
  '#1f9fc4', '#c2508e', '#4b5fd1', '#6d9c2f', '#a8642c', '#3a8c6e',
]
const KRAFT = [0xc9, 0xa7, 0x7c]
const MIXED = '#7d8794'   // pallet gộp nhiều mã

/** Màu mã pha với màu giấy carton — nhìn như thùng thật mà vẫn phân biệt được mã. */
export function tint(hex: string, kraft = 0.32): string {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v + (KRAFT[i] - v) * kraft))
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')
}

const hash = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }

/**
 * Mã hàng → màu gốc, CỐ ĐỊNH theo MÃ (không theo thứ tự xếp): đổi xe, đổi kiểu xếp hay kéo bước thì hàng của mã vẫn
 * giữ màu. Hai mã cùng chuyến trùng màu ⇒ mã sau lấy màu trống kế tiếp.
 */
export function itemColors(codes: string[]): Map<string, string> {
  const m = new Map<string, string>(), used = new Set<number>()
  for (const code of [...new Set(codes)]) {
    let k = hash(code) % PALETTE.length
    for (let n = 0; n < PALETTE.length && used.has(k); n++) k = (k + 1) % PALETTE.length
    used.add(k); m.set(code, PALETTE[k])
  }
  return m
}

/** Màu hiển thị (đã pha giấy) của một khối; `colorKey` không có trong bảng ⇒ xám = pallet gộp nhiều mã. */
export const shownColor = (colorKey: string, colors: Map<string, string>) => tint(colors.get(colorKey) ?? MIXED)
