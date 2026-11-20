// NẠP ĐỊNH MỨC TỪ EXCEL (19/11 — user: "cho tôi việc thêm định mức từ excel").
// Hàm THUẦN (không DB): dòng Excel đã map theo tên cột + danh mục đã tra ⇒ danh sách công thức sẽ ghi + lỗi + cảnh báo.
// Controller (`productionController.importRecipes`) tra danh mục, gọi hàm này, rồi preflight hoặc ghi qua `mes_recipe_import`
// (mỗi công thức đi qua CHÍNH hàm `mes_recipe_save` của form Định mức). Test: backend/tests/unit/recipeImport.test.ts.
//
// Luật (bảng tình huống ở docs/modules/production.md mục "Nạp định mức từ Excel"):
//   • MỖI DÒNG = MỘT nguyên liệu; các dòng cùng Mã BTP + Tên công thức (không phân biệt hoa thường) gom thành MỘT công thức.
//   • Công thức đã có (cùng mã + tên) ⇒ THAY TRỌN danh sách nguyên liệu (như bấm Lưu ở form); chưa có ⇒ tạo mới.
//   • TẤT CẢ HOẶC KHÔNG GÌ: còn một lỗi là không ghi gì (danh mục — file nửa vời thì phải dọn tay).
//   • Cột Mặc định: "Có" ⇒ đặt mặc định (mỗi mã tối đa một công thức "Có"); trống ⇒ giữ như cũ (công thức mới: mã chưa
//     có mặc định thì hàm DB tự đặt). Ghi chú trống ⇒ giữ ghi chú cũ. Trạng thái Đang dùng / Ngừng giữ như cũ.
import type { FieldDef } from './excelHeader'
import { btpUseError } from './semiFinished'
import { parseVnNumber } from './vnNumber'
import { normSapText, normSalesUnit } from './sapUnits'

// Nhãn phải còn chữ sau khi chuẩn hoá (normHeader bỏ ký hiệu): "± %" một mình thành rỗng ⇒ nhãn là "Mức lệch ± %".
export const RECIPE_IMPORT_FIELDS: FieldDef[] = [
  { key: 'btp_code', label: 'Mã BTP', aliases: ['ma ban thanh pham', 'ma btp', 'ma dich', 'material'], required: true },
  { key: 'recipe_name', label: 'Tên công thức', aliases: ['cong thuc', 'ten cong thuc', 'alternative bom', 'alt bom'], required: true },
  { key: 'base_qty', label: 'Cỡ mẻ chuẩn', aliases: ['co me chuan', 'co me', 'base quantity', 'base qty'], required: true },
  { key: 'nvl_code', label: 'Mã NVL', aliases: ['ma nguyen lieu', 'ma nvl', 'ma vat tu', 'component'], required: true },
  { key: 'qty', label: 'Số lượng', aliases: ['so luong', 'dinh muc', 'component quantity', 'quantity'], required: true },
  { key: 'unit', label: 'ĐVT', aliases: ['dvt', 'don vi tinh', 'don vi', 'unit', 'un'] },
  { key: 'tol_pct', label: 'Mức lệch ± %', aliases: ['muc lech', 'muc lech cho phep', 'lech', 'tolerance'] },
  { key: 'is_default', label: 'Mặc định', aliases: ['mac dinh', 'default'] },
  { key: 'note', label: 'Ghi chú', aliases: ['ghi chu', 'ghi chu cong thuc', 'note'] },
]

export const RECIPE_IMPORT_MAX_ROWS = 20_000
export const RECIPE_IMPORT_MAX_RECIPES = 500
const MAX_LINES = 300          // = zRecipeLines.max của form
const MAX_QTY = 10_000_000     // = zod của form

export interface ImpMaterial {
  id: string; material_code: string; short_name?: string | null; base_unit: string | null; category: string | null
  is_semi_finished: boolean | null; is_active: boolean | null
}
export interface ImpExisting { id: string; material_id: string; name: string; note: string | null; is_active: boolean; is_default: boolean; line_count: number }
// type (không phải interface): truyền thẳng vào RPC kiểu Json
export type ImpRecipePayload = {
  id?: string; material_id: string; name: string; base_qty: number; note: string | null; is_active: boolean; is_default: boolean
  lines: { material_id: string; qty: number; tol_pct: number | null }[]
}
export interface RecipeImportPlan {
  recipes: ImpRecipePayload[]; errors: string[]; warnings: string[]
  toInsert: number; toUpdate: number; lineCount: number; btpCount: number
}

const r3 = (n: number) => Math.round(n * 1000) / 1000
const str = (v: unknown) => String(v ?? '').trim()
/** mã hàng trong danh mục luôn viết HOA, không khoảng trắng đầu / cuối (đo staging 19/11: 2.758 / 2.758 mã) */
export const codeKey = (v: unknown) => str(v).toUpperCase()
const fmt = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 3 })
const num = (v: unknown): number | null => (str(v) === '' ? null : parseVnNumber(v))

/** "Có" / x / 1 / yes ⇒ true · trống / Không / 0 / no ⇒ false · khác ⇒ null (lỗi) */
export function parseYes(v: unknown): boolean | null {
  const k = normSapText(v)
  if (['', 'KHONG', 'K', '0', 'NO', 'N', 'FALSE'].includes(k)) return false
  if (['CO', 'C', 'X', '1', 'YES', 'Y', 'TRUE', 'MAC DINH'].includes(k)) return true
  return null
}

/** ĐVT trong file khớp đơn vị gốc của mã? (trống = không kiểm). "kg" / "Kg" / "Bao" / "Túi"… quy qua cùng bảng nhãn của ZSD02. */
const UNIT_WORDS: Record<string, string> = { LIT: 'L', LITRE: 'L', LITER: 'L', KILOGRAM: 'KG', KILOGAM: 'KG', GRAM: 'G', GAM: 'G' }
export function unitMatches(fileUnit: unknown, baseUnit: string | null): boolean {
  const raw = str(fileUnit)
  if (!raw) return true
  const k = normSapText(raw)
  const u = UNIT_WORDS[k] ?? normSalesUnit(raw) ?? k
  return u === normSapText(baseUnit ?? '')
}

/** Mã này làm "Mã BTP" trong file nạp định mức được không — DÙNG CHUNG cho lần nạp (planRecipeImport) và danh sách mã của
 *  file mẫu (GET /production/recipes/import-catalog, 20/11) ⇒ danh sách trong file mẫu không lệch luật kiểm lúc nạp.
 *  Như form (saveRecipe): không xét "đang dùng" — công thức của mã đã ngừng vẫn sửa được. */
export function btpImportError(btp: ImpMaterial, categoryOk: (category: string | null) => boolean): string | null {
  const be = btpUseError({ ...btp, is_active: null })
  if (be) return be.message
  if (!categoryOk(btp.category)) return `mã ${btp.material_code} thuộc loại hàng bạn không được giao`
  return null
}

export function planRecipeImport(
  rows: Record<string, unknown>[], rowNums: number[],
  ctx: { matByCode: Map<string, ImpMaterial>; existing: ImpExisting[]; categoryOk: (category: string | null) => boolean },
): RecipeImportPlan {
  const errors: string[] = []
  const warnings: string[] = []
  type G = {
    key: string; btp: ImpMaterial; name: string; firstRow: number; base: number | null; baseRow: number
    note: string; isDefault: boolean; lines: { material_id: string; code: string; qty: number; tol_pct: number | null; row: number }[]
  }
  const groups = new Map<string, G>()
  const warnedInactive = new Set<string>()
  rows.forEach((r, i) => {
    const at = `Dòng ${rowNums[i] ?? i + 2}`
    const btpCode = codeKey(r.btp_code), nvlCode = codeKey(r.nvl_code), name = str(r.recipe_name)
    const missing = [!btpCode && 'Mã BTP', !name && 'Tên công thức', !nvlCode && 'Mã NVL', str(r.qty) === '' && 'Số lượng'].filter(Boolean)
    if (missing.length) { errors.push(`${at} — thiếu ${missing.join(', ')}`); return }
    const btp = ctx.matByCode.get(btpCode)
    if (!btp) { errors.push(`${at} — không có mã BTP "${btpCode}" trong danh mục Mã hàng`); return }
    const be = btpImportError(btp, ctx.categoryOk)
    if (be) { errors.push(`${at} — ${be}`); return }
    if (name.length > 80) { errors.push(`${at} — Tên công thức tối đa 80 ký tự`); return }
    const key = `${btp.id}|${name.toLowerCase()}`
    let g = groups.get(key)
    if (!g) {
      g = { key, btp, name, firstRow: rowNums[i] ?? i + 2, base: null, baseRow: 0, note: '', isDefault: false, lines: [] }
      groups.set(key, g)
    }
    // cỡ mẻ chuẩn: ghi ở mọi dòng hoặc chỉ dòng đầu của công thức đều được; các dòng có ghi phải bằng nhau
    if (str(r.base_qty) !== '') {
      const b = num(r.base_qty)
      if (b == null || r3(b) <= 0 || b > MAX_QTY) errors.push(`${at} — Cỡ mẻ chuẩn "${str(r.base_qty)}" phải là số lớn hơn 0`)
      else if (g.base == null) { g.base = r3(b); g.baseRow = rowNums[i] ?? i + 2 }
      else if (g.base !== r3(b)) errors.push(`${at} — Cỡ mẻ chuẩn ${fmt(r3(b))} khác dòng ${g.baseRow} (${fmt(g.base)}) của cùng công thức "${g.name}"`)
    }
    const yes = parseYes(r.is_default)
    if (yes == null) errors.push(`${at} — cột Mặc định chỉ ghi "Có" hoặc để trống`)
    else if (yes) g.isDefault = true
    const note = str(r.note)
    if (note.length > 500) errors.push(`${at} — Ghi chú tối đa 500 ký tự`)
    else if (note && !g.note) g.note = note
    const m = ctx.matByCode.get(nvlCode)
    if (!m) { errors.push(`${at} — không có mã NVL "${nvlCode}" trong danh mục Mã hàng`); return }
    if (m.id === btp.id) { errors.push(`${at} — công thức không được chứa chính mã bán thành phẩm ${btpCode}`); return }
    const q = num(r.qty)
    if (q == null || q <= 0 || q > MAX_QTY) { errors.push(`${at} — Số lượng "${str(r.qty)}" phải là số lớn hơn 0`); return }
    if (r3(q) <= 0) { errors.push(`${at} — Số lượng ${q} quá nhỏ (làm tròn 3 số lẻ thành 0)`); return }
    if (!unitMatches(r.unit, m.base_unit)) { errors.push(`${at} — ĐVT "${str(r.unit)}" khác đơn vị gốc ${m.base_unit ?? '(trống)'} của mã ${nvlCode}: số lượng phải theo đơn vị gốc`); return }
    let tol: number | null = null
    if (str(r.tol_pct) !== '') {
      tol = num(r.tol_pct)
      if (tol == null || tol < 0 || tol > 100) { errors.push(`${at} — Mức lệch "${str(r.tol_pct)}" phải từ 0 tới 100`); return }
      tol = r3(tol)
    }
    const dup = g.lines.find(l => l.material_id === m.id)
    if (dup) { errors.push(`${at} — mã NVL ${nvlCode} khai hai lần trong công thức "${g.name}" (dòng ${dup.row})`); return }
    if (m.is_active === false && !warnedInactive.has(m.id)) { warnedInactive.add(m.id); warnings.push(`Mã NVL ${nvlCode} — đang ngừng dùng ở Mã hàng (vẫn nạp vào công thức)`) }
    g.lines.push({ material_id: m.id, code: nvlCode, qty: r3(q), tol_pct: tol, row: rowNums[i] ?? i + 2 })
  })

  const exByKey = new Map(ctx.existing.map(e => [`${e.material_id}|${e.name.trim().toLowerCase()}`, e]))
  const recipes: ImpRecipePayload[] = []
  const defaultsByBtp = new Map<string, G[]>()
  for (const g of groups.values()) if (g.isDefault) defaultsByBtp.set(g.btp.id, [...(defaultsByBtp.get(g.btp.id) ?? []), g])
  for (const [, gs] of defaultsByBtp) if (gs.length > 1)
    errors.push(`Mã ${gs[0].btp.material_code} — ${gs.length} công thức cùng ghi "Có" ở cột Mặc định (${gs.map(x => `"${x.name}"`).join(', ')}), mỗi mã chỉ một mặc định`)
  let toInsert = 0, toUpdate = 0, lineCount = 0
  for (const g of groups.values()) {
    const label = `Mã ${g.btp.material_code} · "${g.name}"`
    if (g.base == null) { errors.push(`${label} (từ dòng ${g.firstRow}) — thiếu Cỡ mẻ chuẩn`); continue }
    if (!g.lines.length) continue   // mọi dòng của công thức đều lỗi — lỗi đã báo theo dòng
    if (g.lines.length > MAX_LINES) { errors.push(`${label} — ${g.lines.length} nguyên liệu, tối đa ${MAX_LINES}`); continue }
    const ex = exByKey.get(`${g.btp.id}|${g.name.toLowerCase()}`)
    const otherDefault = defaultsByBtp.has(g.btp.id) && !g.isDefault
    if (ex) {
      if (g.isDefault && !ex.is_active) { errors.push(`${label} — đang Ngừng dùng nên không làm mặc định được: bật "Đang dùng" ở trang Định mức hoặc bỏ "Có" ở cột Mặc định`); continue }
      toUpdate++
      warnings.push(`${label} — đã có (${ex.line_count} nguyên liệu), sẽ thay bằng ${g.lines.length} nguyên liệu trong file${ex.is_active ? '' : ' · công thức đang Ngừng dùng, giữ Ngừng'}`)
    } else toInsert++
    if (g.isDefault) {
      const cur = ctx.existing.find(e => e.material_id === g.btp.id && e.is_default)
      if (cur && cur.id !== ex?.id) warnings.push(`${label} — thành công thức MẶC ĐỊNH, thay cho "${cur.name}"`)
    }
    lineCount += g.lines.length
    recipes.push({
      ...(ex ? { id: ex.id } : {}), material_id: g.btp.id, name: g.name, base_qty: g.base,
      note: g.note || ex?.note || null, is_active: ex?.is_active ?? true,
      // mã có công thức khác ghi "Có" ⇒ các công thức còn lại của mã trong file thôi mặc định (kẻo lưu sau đè lại)
      is_default: g.isDefault ? true : otherDefault ? false : (ex?.is_default ?? false),
      lines: g.lines.map(l => ({ material_id: l.material_id, qty: l.qty, tol_pct: l.tol_pct })),
    })
  }
  // khoá theo cùng thứ tự mã ở mọi lượt nạp (hàm DB khoá công thức của từng mã) — hai lượt cùng lúc không kẹt chéo
  recipes.sort((a, b) => a.material_id.localeCompare(b.material_id) || a.name.localeCompare(b.name))
  return { recipes, errors, warnings, toInsert, toUpdate, lineCount, btpCount: new Set(recipes.map(r => r.material_id)).size }
}
