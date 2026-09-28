// Kênh SAP (cột Distribution Channel của ZSD02) → kênh khách hàng của app (28/09, user: "kênh là nơi khai riêng — khai thêm kênh
// không có trên SAP như BHX; khách chưa có kênh thì tự điền từ SAP"). Kênh app nào khai `meta.sap_dist_channel` thì khách mang
// kênh SAP đó được điền vào; kênh không khai mã (BHX) chỉ gán tay. Hàm thuần — test tests/unit/sapChannel.test.ts.

/** "10-General Trade" → "10"; "10" → "10"; không có số đầu ⇒ null. */
export const sapChannelCode = (v: unknown): string | null => {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''
  return s.match(/^(\d+)/)?.[1] ?? null
}

/** Mã SAP → kênh app. Hai kênh khai CÙNG mã ⇒ bỏ mã đó (không đoán — cửa ghi kênh đã chặn trùng, đây là lưới cuối). */
export function sapChannelMap(chans: { value: string; meta: unknown }[]): Map<string, string> {
  const by = new Map<string, string[]>()
  for (const c of chans) {
    const code = sapChannelCode((c.meta as { sap_dist_channel?: unknown } | null)?.sap_dist_channel)
    if (code) by.set(code, [...(by.get(code) ?? []), c.value])
  }
  return new Map([...by].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]))
}

/** Kênh cần ĐIỀN cho một khách: đã có kênh (người gán tay) ⇒ null (giữ); chưa có ⇒ theo kênh SAP nếu danh mục có mã đó. */
export const channelToFill = (current: string | null | undefined, distChannel: unknown, map: Map<string, string>): string | null =>
  current ? null : map.get(sapChannelCode(distChannel) ?? '') ?? null
