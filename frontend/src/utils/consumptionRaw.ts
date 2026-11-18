// DỮ LIỆU THÔ TIÊU HAO NVL (MES 18/11 g — user: "tiêu hao NVL phải làm dạng raw data, có đầy đủ thông tin hết — để còn làm việc với ERP SAP").
// MỘT khuôn cột cho cả bảng trên màn "Dữ liệu thô", file xuất của nó và sheet thô trong báo cáo chu kỳ (hai cửa cùng một khuôn).
// Luật của dữ liệu thô: mỗi dòng MỘT phát sinh như chứng từ kho của SAP — Cấp (+SL, lúc cấp) · Huỷ cấp (−SL, lúc huỷ); dòng 1 của sheet là
// tên cột (không dòng tiêu đề) để lọc / pivot / nạp thẳng; ngày dạng YYYY-MM-DD và giờ HH:mm:ss theo giờ Việt Nam; số là số, ĐVT là mã của
// app (KG / L / BAG… trùng mã SAP). Test: backend/tests/unit/consumptionRaw.test.ts.
import { unitCode } from './unitCode'

export interface RawEvent {
  line_id: string; event: 'ISSUE' | 'REVERSAL'; at: string; qty: number; signed_qty: number; by_name: string | null; by_code: string | null
  wh_code: string; wh_name: string; factory_code: string | null; factory_name: string | null; sap_plant: string | null; sap_sloc: string | null; nmsx: string | null
  batch_id: string; batch_code: string; cycle: string | null; batch_no: number | null; shift: string | null; prod_date: string | null
  batch_status: string; batch_qa: string; tank_code: string | null; machine_code: string | null
  btp_code: string; btp_name: string | null; btp_unit: string | null
  mat_code: string; mat_name: string | null; mat_desc: string | null; mat_category: string | null; unit: string | null; entry_unit: string | null; units_per_carton: number | null
  source: 'SCAN' | 'LOT'; pallet_code: string | null; batch_lot: string | null; production_date: string | null; expiry_date: string | null; import_date: string | null
  ncc_code: string | null; ncc_name: string | null; manufacturer: string | null
  rotation_violation: boolean; rotation_principle: string | null; rotation_best_date: string | null; rotation_reason: string | null
  exp_approved: boolean; exp_by: string | null; exp_at: string | null; exp_note: string | null
  issued_at: string; issued_by: string | null; reversed_at: string | null; reversed_by: string | null; reverse_reason: string | null
}
export interface RawSummary {
  events: number; issues: number; reversals: number; batches: number; materials: number; rotation: number; expiry: number
  by_unit: { unit: string; issued: number; reversed: number; net: number }[]
}
export interface RawReq {
  batch_id: string; batch_code: string; cycle: string | null; batch_no: number | null; shift: string | null; prod_date: string | null
  batch_status: string; batch_qa: string; tank_code: string | null; btp_code: string; btp_name: string | null; planned_qty: number | null; btp_unit: string | null
  wh_code: string; sap_plant: string | null; sap_sloc: string | null
  mat_code: string; mat_name: string | null; mat_desc: string | null; unit: string | null
  in_sheet: boolean; req: number | null; std: number | null; tol_pct: number | null; iss: number; diff: number | null
  lines: number; reversed_lines: number; reversed_qty: number; rotation_lines: number; first_at: string | null; last_at: string | null
}
export interface RawFill {
  move_id: string; at: string; qty: number; by_name: string | null; warning: string | null; tank_code: string | null
  batch_id: string; batch_code: string; cycle: string | null; batch_no: number | null; shift: string | null; prod_date: string | null
  batch_status: string; batch_qa: string; btp_code: string; btp_name: string | null; btp_desc: string | null; unit: string | null; planned_qty: number | null
  wh_code: string; sap_plant: string | null; sap_sloc: string | null
}

const VN = 'Asia/Ho_Chi_Minh'
const asDate = (iso: string | null | undefined): Date | null => {
  if (!iso) return null
  const s = !iso.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(iso) && iso.includes('T') ? `${iso}Z` : iso
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}
/** mốc giờ (ISO) → ngày Việt Nam YYYY-MM-DD ('' khi trống / hỏng) */
export function vnYmd(iso: string | null | undefined): string {
  const d = asDate(iso)
  return d ? d.toLocaleDateString('en-CA', { timeZone: VN }) : ''
}
/** mốc giờ (ISO) → giờ Việt Nam HH:mm:ss */
export function vnHms(iso: string | null | undefined): string {
  const d = asDate(iso)
  return d ? d.toLocaleTimeString('en-GB', { timeZone: VN, hour12: false }) : ''
}
/** mốc giờ → "YYYY-MM-DD HH:mm:ss" giờ Việt Nam */
export const vnStamp = (iso: string | null | undefined) => (asDate(iso) ? `${vnYmd(iso)} ${vnHms(iso)}` : '')

export const EVENT_VI: Record<RawEvent['event'], string> = { ISSUE: 'Cấp', REVERSAL: 'Huỷ cấp' }
const STATUS_VI: Record<string, string> = { OPEN: 'Đang mở', CLOSED: 'Đã đóng', CANCELLED: 'Đã huỷ' }
const QA_VI: Record<string, string> = { HOLD: 'Chờ QA', RELEASED: 'QA đạt', REJECTED: 'QA không đạt' }
const yes = (b: boolean) => (b ? 'Có' : '')
const s = (v: string | null | undefined) => v ?? ''

type Cell = string | number
export interface RawCol<T> { key: string; label: string; w: number; num?: boolean; value: (r: T) => Cell; tip?: string }

/** Sheet / bảng "Tiêu hao NVL": mỗi dòng một phát sinh. Thứ tự cột: phát sinh → SAP (Plant / SLoc) → NVL + số lượng → lô → mẻ → người → cờ → mã dòng. */
export const RAW_EVENT_COLS: RawCol<RawEvent>[] = [
  { key: 'event', label: 'Phát sinh', w: 74, value: r => EVENT_VI[r.event] ?? r.event, tip: 'Cấp (+SL) · Huỷ cấp (−SL, ghi vào ngày huỷ — để hạch toán đảo)' },
  { key: 'date', label: 'Ngày', w: 84, value: r => vnYmd(r.at), tip: 'Ngày phát sinh (giờ Việt Nam)' },
  { key: 'time', label: 'Giờ', w: 66, value: r => vnHms(r.at) },
  { key: 'plant', label: 'Plant (SAP)', w: 76, value: r => s(r.sap_plant), tip: 'Mã Plant SAP của kho chế biến — không khai thì của nhà máy cha' },
  { key: 'sloc', label: 'SLoc (SAP)', w: 74, value: r => s(r.sap_sloc), tip: 'Kho SAP (storage location) khai ở Cài đặt WMS → Kho' },
  { key: 'wh', label: 'Kho chế biến', w: 90, value: r => r.wh_code },
  { key: 'mat', label: 'Mã NVL', w: 100, value: r => r.mat_code },
  { key: 'mat_name', label: 'Tên NVL', w: 180, value: r => s(r.mat_name) },
  { key: 'mat_desc', label: 'Mô tả NVL', w: 180, value: r => s(r.mat_desc) },
  { key: 'qty', label: 'SL (+cấp / −huỷ)', w: 104, num: true, value: r => Number(r.signed_qty), tip: 'Số lượng theo đơn vị gốc; dòng Huỷ cấp mang dấu trừ' },
  { key: 'unit', label: 'ĐVT', w: 52, value: r => unitCode(r.unit) },
  { key: 'lot', label: 'Lô NCC', w: 100, value: r => s(r.batch_lot) },
  { key: 'nsx', label: 'NSX', w: 84, value: r => s(r.production_date) },
  { key: 'hsd', label: 'HSD', w: 84, value: r => s(r.expiry_date) },
  { key: 'ncc', label: 'Mã NCC', w: 84, value: r => s(r.ncc_code), tip: 'Mã nhà cung cấp (trùng mã SAP)' },
  { key: 'ncc_name', label: 'Tên NCC', w: 130, value: r => s(r.ncc_name) },
  { key: 'mf', label: 'Nhà sản xuất', w: 120, value: r => s(r.manufacturer) },
  { key: 'pallet', label: 'Tem / pallet', w: 190, value: r => s(r.pallet_code) },
  { key: 'source', label: 'Cách cấp', w: 74, value: r => (r.source === 'SCAN' ? 'Quét tem' : 'Chọn lô') },
  { key: 'import', label: 'Ngày nhập kho', w: 92, value: r => s(r.import_date) },
  { key: 'cycle', label: 'Chu kỳ', w: 60, value: r => s(r.cycle) },
  { key: 'batch_no', label: 'Mẻ', w: 44, num: true, value: r => (r.batch_no ?? '') },
  { key: 'batch', label: 'Mã lô BTP', w: 110, value: r => r.batch_code, tip: 'Mã lô của mẻ (bán thành phẩm)' },
  { key: 'shift', label: 'Ca', w: 60, value: r => s(r.shift) },
  { key: 'prod_date', label: 'Ngày SX', w: 84, value: r => s(r.prod_date) },
  { key: 'btp', label: 'Mã BTP', w: 100, value: r => r.btp_code },
  { key: 'btp_name', label: 'Tên BTP', w: 160, value: r => s(r.btp_name) },
  { key: 'tank', label: 'Bồn', w: 60, value: r => s(r.tank_code) },
  { key: 'machine', label: 'Máy', w: 50, value: r => s(r.machine_code) },
  { key: 'bstatus', label: 'Tình trạng mẻ', w: 88, value: r => STATUS_VI[r.batch_status] ?? r.batch_status },
  { key: 'bqa', label: 'QA mẻ', w: 84, value: r => QA_VI[r.batch_qa] ?? r.batch_qa },
  { key: 'by', label: 'Người làm', w: 120, value: r => s(r.by_name), tip: 'Người cấp (dòng Cấp) · người huỷ (dòng Huỷ cấp)' },
  { key: 'by_code', label: 'Mã NV', w: 70, value: r => s(r.by_code) },
  { key: 'rot', label: 'Sai thứ tự', w: 70, value: r => yes(r.rotation_violation), tip: 'Lấy khác thứ tự FEFO / FIFO / LIFO của kho' },
  { key: 'rot_rule', label: 'Nguyên tắc', w: 72, value: r => s(r.rotation_principle) },
  { key: 'rot_best', label: 'Date nên lấy', w: 88, value: r => s(r.rotation_best_date) },
  { key: 'rot_reason', label: 'Lý do lấy khác thứ tự', w: 160, value: r => s(r.rotation_reason) },
  { key: 'exp', label: 'Hết hạn — QA duyệt', w: 110, value: r => yes(r.exp_approved) },
  { key: 'exp_by', label: 'QA duyệt', w: 110, value: r => s(r.exp_by) },
  { key: 'exp_at', label: 'QA duyệt lúc', w: 130, value: r => vnStamp(r.exp_at) },
  { key: 'exp_note', label: 'Ghi chú QA', w: 140, value: r => s(r.exp_note) },
  { key: 'issued_at', label: 'Lần cấp lúc', w: 130, value: r => vnStamp(r.issued_at), tip: 'Thời điểm của lần cấp gốc (dòng Huỷ cấp trỏ về lần cấp nào)' },
  { key: 'issued_by', label: 'Người cấp', w: 110, value: r => s(r.issued_by) },
  { key: 'rev_at', label: 'Đã huỷ lúc', w: 130, value: r => vnStamp(r.reversed_at), tip: 'Lần cấp này đã bị huỷ lúc nào (trống = còn hiệu lực)' },
  { key: 'rev_by', label: 'Người huỷ', w: 110, value: r => s(r.reversed_by) },
  { key: 'rev_reason', label: 'Lý do huỷ', w: 160, value: r => s(r.reverse_reason) },
  { key: 'entry_unit', label: 'ĐVT nhập', w: 64, value: r => unitCode(r.entry_unit) },
  { key: 'upc', label: 'Quy cách (ĐV gốc / ĐVT nhập)', w: 120, num: true, value: r => (r.units_per_carton ?? '') },
  { key: 'mat_cat', label: 'Nhóm NVL', w: 74, value: r => s(r.mat_category) },
  { key: 'factory', label: 'Nhà máy', w: 90, value: r => s(r.factory_code) },
  { key: 'factory_name', label: 'Tên nhà máy', w: 120, value: r => s(r.factory_name) },
  { key: 'nmsx', label: 'Mã NMSX', w: 64, value: r => s(r.nmsx) },
  { key: 'line_id', label: 'Mã dòng cấp', w: 270, value: r => r.line_id, tip: 'Mã duy nhất của lần cấp — dùng đối chiếu / chống nạp trùng sang SAP' },
]

/** Sheet "Định mức – thực cấp": mỗi dòng một (mẻ × NVL) */
export const RAW_REQ_COLS: RawCol<RawReq>[] = [
  { key: 'plant', label: 'Plant (SAP)', w: 76, value: r => s(r.sap_plant) },
  { key: 'sloc', label: 'SLoc (SAP)', w: 74, value: r => s(r.sap_sloc) },
  { key: 'wh', label: 'Kho chế biến', w: 90, value: r => r.wh_code },
  { key: 'prod_date', label: 'Ngày SX', w: 84, value: r => s(r.prod_date) },
  { key: 'cycle', label: 'Chu kỳ', w: 60, value: r => s(r.cycle) },
  { key: 'batch_no', label: 'Mẻ', w: 44, num: true, value: r => (r.batch_no ?? '') },
  { key: 'batch', label: 'Mã lô BTP', w: 110, value: r => r.batch_code },
  { key: 'shift', label: 'Ca', w: 60, value: r => s(r.shift) },
  { key: 'btp', label: 'Mã BTP', w: 100, value: r => r.btp_code },
  { key: 'btp_name', label: 'Tên BTP', w: 160, value: r => s(r.btp_name) },
  { key: 'planned', label: 'Kế hoạch mẻ', w: 90, num: true, value: r => (r.planned_qty ?? '') },
  { key: 'btp_unit', label: 'ĐVT BTP', w: 64, value: r => unitCode(r.btp_unit) },
  { key: 'tank', label: 'Bồn', w: 60, value: r => s(r.tank_code) },
  { key: 'bstatus', label: 'Tình trạng mẻ', w: 88, value: r => STATUS_VI[r.batch_status] ?? r.batch_status },
  { key: 'bqa', label: 'QA mẻ', w: 84, value: r => QA_VI[r.batch_qa] ?? r.batch_qa },
  { key: 'mat', label: 'Mã NVL', w: 100, value: r => r.mat_code },
  { key: 'mat_name', label: 'Tên NVL', w: 180, value: r => s(r.mat_name) },
  { key: 'mat_desc', label: 'Mô tả NVL', w: 180, value: r => s(r.mat_desc) },
  { key: 'unit', label: 'ĐVT', w: 52, value: r => unitCode(r.unit) },
  { key: 'in_sheet', label: 'Trong phiếu', w: 74, value: r => (r.in_sheet ? 'Có' : 'Ngoài phiếu') },
  { key: 'std', label: 'Định mức chuẩn', w: 96, num: true, value: r => (r.std ?? '') },
  { key: 'req', label: 'Định mức của mẻ', w: 100, num: true, value: r => (r.req ?? '') },
  { key: 'tol', label: 'Mức lệch cho phép (%)', w: 110, num: true, value: r => (r.tol_pct ?? '') },
  { key: 'iss', label: 'Thực cấp', w: 90, num: true, value: r => Number(r.iss) },
  { key: 'diff', label: 'Lệch (thực cấp − định mức)', w: 130, num: true, value: r => (r.diff ?? '') },
  { key: 'lines', label: 'Số lần cấp', w: 80, num: true, value: r => r.lines },
  { key: 'rev_lines', label: 'Lần cấp đã huỷ', w: 96, num: true, value: r => r.reversed_lines },
  { key: 'rev_qty', label: 'SL đã huỷ', w: 80, num: true, value: r => Number(r.reversed_qty) },
  { key: 'rot_lines', label: 'Lần sai thứ tự', w: 92, num: true, value: r => r.rotation_lines },
  { key: 'first', label: 'Cấp đầu lúc', w: 130, value: r => vnStamp(r.first_at) },
  { key: 'last', label: 'Cấp cuối lúc', w: 130, value: r => vnStamp(r.last_at) },
]

/** Sheet "Nạp bồn (BTP)": mỗi dòng một lần nạp bồn của mẻ (sản lượng bán thành phẩm) */
export const RAW_FILL_COLS: RawCol<RawFill>[] = [
  { key: 'date', label: 'Ngày', w: 84, value: r => vnYmd(r.at) },
  { key: 'time', label: 'Giờ', w: 66, value: r => vnHms(r.at) },
  { key: 'plant', label: 'Plant (SAP)', w: 76, value: r => s(r.sap_plant) },
  { key: 'sloc', label: 'SLoc (SAP)', w: 74, value: r => s(r.sap_sloc) },
  { key: 'wh', label: 'Kho chế biến', w: 90, value: r => r.wh_code },
  { key: 'btp', label: 'Mã BTP', w: 100, value: r => r.btp_code },
  { key: 'btp_name', label: 'Tên BTP', w: 160, value: r => s(r.btp_name) },
  { key: 'btp_desc', label: 'Mô tả BTP', w: 160, value: r => s(r.btp_desc) },
  { key: 'qty', label: 'SL nạp', w: 90, num: true, value: r => Number(r.qty) },
  { key: 'unit', label: 'ĐVT', w: 52, value: r => unitCode(r.unit) },
  { key: 'batch', label: 'Mã lô BTP', w: 110, value: r => r.batch_code },
  { key: 'cycle', label: 'Chu kỳ', w: 60, value: r => s(r.cycle) },
  { key: 'batch_no', label: 'Mẻ', w: 44, num: true, value: r => (r.batch_no ?? '') },
  { key: 'shift', label: 'Ca', w: 60, value: r => s(r.shift) },
  { key: 'prod_date', label: 'Ngày SX', w: 84, value: r => s(r.prod_date) },
  { key: 'planned', label: 'Kế hoạch mẻ', w: 90, num: true, value: r => (r.planned_qty ?? '') },
  { key: 'tank', label: 'Bồn', w: 60, value: r => s(r.tank_code) },
  { key: 'bstatus', label: 'Tình trạng mẻ', w: 88, value: r => STATUS_VI[r.batch_status] ?? r.batch_status },
  { key: 'bqa', label: 'QA mẻ', w: 84, value: r => QA_VI[r.batch_qa] ?? r.batch_qa },
  { key: 'by', label: 'Người nạp', w: 120, value: r => s(r.by_name) },
  { key: 'warn', label: 'Cảnh báo lúc nạp', w: 180, value: r => s(r.warning) },
  { key: 'move_id', label: 'Mã dòng nạp', w: 270, value: r => r.move_id },
]

/** dòng 1 = tên cột, sau đó mỗi bản ghi một dòng (dạng thô: không dòng tiêu đề, không gộp ô) */
export function rawAoa<T>(cols: RawCol<T>[], rows: T[]): Cell[][] {
  return [cols.map(c => c.label), ...rows.map(r => cols.map(c => c.value(r)))]
}
/** độ rộng cột Excel theo độ rộng cột trên màn (px → ký tự) */
export const rawColWidths = <T,>(cols: RawCol<T>[]) => cols.map(c => ({ wch: Math.max(6, Math.round(c.w / 7)) }))
