import { parseVnNumber } from './vnNumber'

/**
 * DÁN TỪ EXCEL vào bảng dòng hàng — khối ô → lưới dòng × cột (cột cách bằng TAB, dòng cách bằng xuống dòng, bỏ dòng trống).
 * Trả `null` khi chỉ là MỘT ô đơn (không tab, không xuống dòng) — để trình duyệt tự dán như gõ tay.
 * Excel chép một ô vẫn kèm "\r\n" ở cuối ⇒ xét xuống dòng trên chuỗi đã trim.
 */
export function pasteGrid(text: string): string[][] | null {
  const t = text.replace(/\r/g, '')
  if (!t.includes('\t') && !t.trim().includes('\n')) return null
  return t.split('\n').filter(l => l.trim() !== '').map(l => l.split('\t').map(c => c.trim()))
}

/** Ô số dán từ Excel → số ≥ 0, đọc kiểu Việt Nam (`1.234` = 1234 · `12,5` = 12,5). Ô trống / chữ / âm → 0. */
export function pasteNum(s: string | undefined): number {
  const n = parseVnNumber(s ?? '')
  return n != null && n > 0 ? n : 0
}
