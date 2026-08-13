// THANG MÀU %Date TOÀN APP — MỘT NGUỒN (audit hardcode 13/08).
// Trước đó có 3 thang mâu thuẫn rải 12 chỗ: Tồn kho/Nhật ký quét 70/40 · họ Xuất/Nhặt lẻ 60/30 ·
// band lọc 80/60/30 — cùng 1 pallet mỗi trang một màu. Nay: ngưỡng đọc từ SystemSetting
// `pct_date_bands` (hook usePctBands trong api/hooks.ts), mặc định 60/30 (thang họ Xuất cũ).
// Chỗ hiển thị %Date MỚI bắt buộc dùng pctDateCls(pct, bands) — KHÔNG tự viết ternary ngưỡng.
// (Ngưỡng CẢNH BÁO tồn cận date 20/10 là chuyện khác — alert_thresholds, tab Cài đặt ngưỡng.)

export interface PctBands { good: number; low: number }
export const PCT_BANDS_DEFAULT: PctBands = { good: 60, low: 30 }

export function parsePctBands(v: unknown): PctBands {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    const good = Number(o.good), low = Number(o.low)
    if (Number.isFinite(good) && Number.isFinite(low) && low > 0 && low <= good && good <= 100)
      return { good, low }
  }
  return PCT_BANDS_DEFAULT
}

// Trả CHỈ class màu chữ — font-weight/size do chỗ gọi tự thêm.
export function pctDateCls(pct: number | null | undefined, bands: PctBands = PCT_BANDS_DEFAULT): string {
  if (pct == null || !Number.isFinite(pct)) return 'text-slate-400'
  if (pct > bands.good) return 'text-green-700'
  if (pct > bands.low) return 'text-amber-600'
  return 'text-red-600'
}
