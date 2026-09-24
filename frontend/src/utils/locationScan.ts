// Bản MIRROR của BE `backend/src/utils/locationScan.ts` — sửa luật phải sửa CẢ HAI.
// Xem lý do đầy đủ ở file BE: mã vị trí có dấu cách + dấu tiếng Việt nên việc chuẩn hoá mã quét
// phải nằm MỘT chỗ, không tự `.trim()` rải rác trong từng màn quét.
const CONTROL_RE = /[\u0000-\u001F\u007F]/g
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g

export function normalizeLocScan(input: unknown): string {
  return String(input ?? '')
    .replace(CONTROL_RE, ' ')
    .replace(ZERO_WIDTH_RE, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
}
