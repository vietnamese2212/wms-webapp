// sapUnits — quy NHÃN đơn vị / mã / ĐVVT của báo cáo SAP ZSD02 về mã chuẩn của app.
// MIRROR của backend/src/utils/sapUnits.ts — 2 bản PHẢI KHỚP (backend/tests/mirror/sapUnits.mirror.test.ts).

export function normSapText(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/Đ/g, 'D')
    .replace(/\s+/g, ' ')
}

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

export function normSalesUnit(raw: unknown): string | null {
  const k = normSapText(raw)
  if (!k) return null
  return SALES_UNIT_ALIAS[k] ?? null
}

export function normBaseUnit(raw: unknown): string | null {
  const k = normSapText(raw)
  return k || null
}

export function sapCodeOf(field: unknown): string | null {
  const s = String(field ?? '').trim()
  if (!s) return null
  const head = s.split('-')[0].trim().toUpperCase()
  return head || null
}

export function normDvvt(raw: unknown): string | null {
  const k = normSapText(raw)
  return k || null
}

export function gramsToKg(g: unknown): number | null {
  const n = typeof g === 'number' ? g : Number(String(g ?? '').replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  return Math.round((n / 1000) * 1000) / 1000
}

export function normDispatchStatus(raw: unknown): 'ASSIGNED' | 'UNASSIGNED' | null {
  const k = normSapText(raw)
  if (!k) return null
  if (k.startsWith('DA DIEU')) return 'ASSIGNED'
  if (k.startsWith('CHUA DIEU')) return 'UNASSIGNED'
  return null
}
