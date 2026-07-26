import * as XLSX from 'xlsx'

// ── Parse Excel theo TÊN CỘT (đồng bộ với VL06O/KHVC) — chịu ĐẢO thứ tự cột + đổi tên nhãn ──
// Mỗi field khai alias = {key snake_case + nhãn tiếng Việt}. Chuẩn hóa trim + lowercase + BỎ DẤU
// nên "Số thùng", "so thung", "SO THUNG", "cartons" đều khớp về cùng field. Tự dò dòng tiêu đề trong
// vài dòng đầu (template có 2 dòng đầu = nhãn + key → tự bỏ), map theo tên, guard cột bắt buộc thiếu.

export type FieldDef = { key: string; label: string; aliases: string[]; required?: boolean }

// trim + lowercase + bỏ dấu tiếng Việt + gộp mọi ký tự không phải chữ/số thành 1 space
// (loại '*', '()', '/', '-', '_'…) → "Thùng/Pallet *" và "cartons_per_pallet" cùng chuẩn hóa gọn.
export const normHeader = (s: unknown): string =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

export type ParsedSheet = {
  rows: Record<string, unknown>[]
  missingRequired: string[]   // NHÃN của field required không tìm thấy cột
}

const HEADER_SCAN_ROWS = 8

export function parseSheetByHeader(ws: XLSX.WorkSheet, fields: FieldDef[]): ParsedSheet {
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { defval: '', header: 1 }) as unknown[][]

  // Alias (đã chuẩn hóa) → field key. Alias mơ hồ (khớp >1 field) → bỏ để không map nhầm.
  const aliasToKey = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const f of fields) {
    // NHÃN cũng là alias: nếu ai sửa nhãn mẫu tải về về đúng `label` khai trong code mà label không
    // nằm trong aliases thì cột đó mất âm thầm (vd INV_FIELDS.boxes_base label 'Hộp (lẻ)' → 'hop le'
    // không khớp alias nào ⇒ mất phần HỘP LẺ của BASE UNIT). Phát hiện qua fuzz 26/07.
    for (const a of [f.key, f.label, ...f.aliases]) {
      const n = normHeader(a)
      if (!n) continue
      const owner = aliasToKey.get(n)
      if (owner && owner !== f.key) ambiguous.add(n)
      else aliasToKey.set(n, f.key)
    }
  }
  for (const n of ambiguous) aliasToKey.delete(n)

  // Dò dòng tiêu đề: trong vài dòng đầu, chọn dòng khớp NHIỀU field nhất. HÒA → giữ dòng ĐẦU TIÊN.
  // (Trước dùng `>=` = ưu tiên dòng SAU cho template 2 dòng nhãn+key; nhưng nếu tiêu đề LẶP LẠI trong
  // 8 dòng đầu — hoặc 1 dòng dữ liệu trùng tên cột — thì headerIdx nhảy xuống và MẤT ÂM THẦM các dòng
  // phía trên: `[H, dòng1, H, dòng2]` → chỉ còn dòng2, không báo lỗi gì. Fuzz 26/07 bắt được.
  // Template 2 dòng vẫn đúng: dòng "key" ở dưới bị `isHeaderLike` bỏ qua, và nếu dòng key khớp NHIỀU
  // field hơn dòng nhãn thì score cao hơn nên vẫn được chọn.)
  let headerIdx = -1
  let headerCols = new Map<number, string>()
  let bestScore = 0
  const scan = Math.min(raw.length, HEADER_SCAN_ROWS)
  for (let i = 0; i < scan; i++) {
    const row = raw[i] || []
    const cols = new Map<number, string>()
    const taken = new Set<string>()
    for (let c = 0; c < row.length; c++) {
      const key = aliasToKey.get(normHeader(row[c]))
      if (key && !taken.has(key)) { cols.set(c, key); taken.add(key) }  // cột ĐẦU khớp field thì giữ
    }
    if (cols.size > 0 && cols.size > bestScore) { bestScore = cols.size; headerIdx = i; headerCols = cols }
  }

  if (headerIdx < 0) return { rows: [], missingRequired: fields.filter(f => f.required).map(f => f.label) }

  const found = new Set(headerCols.values())
  const missingRequired = fields.filter(f => f.required && !found.has(f.key)).map(f => f.label)

  // Dòng cũng là "tiêu đề" (vd dòng key ngay dưới dòng nhãn) → bỏ, không coi là dữ liệu.
  const isHeaderLike = (row: unknown[]): boolean => {
    let hit = 0
    for (const [c, key] of headerCols) if (aliasToKey.get(normHeader(row?.[c])) === key) hit++
    return hit >= Math.max(2, Math.ceil(headerCols.size / 2))
  }

  const rows: Record<string, unknown>[] = []
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i] || []
    if (isHeaderLike(row)) continue
    const obj: Record<string, unknown> = {}
    for (const [c, key] of headerCols) obj[key] = row[c]
    if (Object.values(obj).some(v => String(v ?? '').trim())) rows.push(obj)
  }
  return { rows, missingRequired }
}
