// sapUnits — quy NHÃN đơn vị / mã / ĐVVT của báo cáo SAP ZSD02 về mã chuẩn của app.
// MIRROR: frontend/src/utils/sapUnits.ts — 2 bản PHẢI KHỚP (tests/mirror/sapUnits.mirror.test.ts).
//
// Vì sao cần: VL06O ghi đơn vị bán bằng MÃ (CAR/HOP/EA), ZSD02 ghi bằng CHỮ tiếng Việt (Thùng/Hộp/Cái/kg)
// — đo file mẫu 22/09: Thùng→HOP 4.887 · Cái→EA 1.840 · Thùng→BT 687 · Thùng→BAG 561 · Hộp→HOP 41 · kg→KG 7.
// Cửa nạp chỉ được so đơn vị với Material master SAU khi quy nhãn ở đây; nhãn lạ → CHẶN file kèm bảng
// (không đoán). Thêm nhãn mới = thêm dòng vào SALES_UNIT_ALIAS, KHÔNG viết `if` rải ở controller.

/** trim + upper + bỏ dấu tiếng Việt + gộp khoảng trắng — dùng chung cho nhãn đơn vị và tên ĐVVT. */
export function normSapText(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/Đ/g, 'D')
    .replace(/\s+/g, ' ')
}

/** Nhãn đơn vị bán trong ZSD02 (đã normSapText) → mã đơn vị của app. */
export const SALES_UNIT_ALIAS: Record<string, string> = {
  THUNG: 'CAR', CARTON: 'CAR', CAR: 'CAR', CS: 'CAR',
  HOP: 'HOP',
  CAI: 'EA', EA: 'EA', PC: 'EA', PCE: 'EA',
  KG: 'KG',
  BT: 'BT', CHAI: 'BT',
  BAG: 'BAG', BAO: 'BAG', TUI: 'BAG',
  SET: 'SET', BO: 'SET',
  ROL: 'ROL', CUON: 'ROL',
  M2: 'M2', G: 'G', L: 'L',
}

/** 'Thùng' → 'CAR', 'Hộp' → 'HOP', 'Cái' → 'EA', 'kg' → 'KG'; mã đã chuẩn đi qua nguyên; lạ → null (CHẶN ở cửa nạp). */
export function normSalesUnit(raw: unknown): string | null {
  const k = normSapText(raw)
  if (!k) return null
  return SALES_UNIT_ALIAS[k] ?? null
}

/** Đơn vị GỐC (Base Unit) của SAP đã là mã (HOP/BAG/BT/EA/KG) — chỉ chuẩn hoá chữ; rỗng → null. */
export function normBaseUnit(raw: unknown): string | null {
  const k = normSapText(raw)
  return k || null
}

/** "ZOR1-SO Standard" → "ZOR1" · "F-Purchase Order" → "F" · "ZTA2-IC Pallet" → "ZTA2". Rỗng → null. */
export function sapCodeOf(field: unknown): string | null {
  const s = String(field ?? '').trim()
  if (!s) return null
  const head = s.split('-')[0].trim().toUpperCase()
  return head || null
}

/** Tên/mã ĐVVT trong ZSD02 về khoá so khớp với TransportCompany.code / alias_codes (15 cách viết cho ~9 đơn vị). */
export function normDvvt(raw: unknown): string | null {
  const k = normSapText(raw)
  return k || null
}

/** Gross Weight của ZSD02 là GRAM (đo: 298.199,52 g / 60 thùng = 4,97 kg/thùng, master 4,965). */
export function gramsToKg(g: unknown): number | null {
  const n = typeof g === 'number' ? g : Number(String(g ?? '').replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  return Math.round((n / 1000) * 1000) / 1000
}

/** "Đã điều phối" / "Chưa điều phối" (cột Trạng thái điều phối xe = đã GẮN XE hay chưa, KHÔNG phải đã tạo OD). */
export function normDispatchStatus(raw: unknown): 'ASSIGNED' | 'UNASSIGNED' | null {
  const k = normSapText(raw)
  if (!k) return null
  if (k.startsWith('DA DIEU')) return 'ASSIGNED'
  if (k.startsWith('CHUA DIEU')) return 'UNASSIGNED'
  return null
}
