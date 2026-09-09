// SỔ KPI KHO — MỘT NGUỒN cho tab KPI của Dashboard (user đưa "Warehouse KPI Master List" 40 KPI, 08/09/2026).
//
// File này là nơi DUY NHẤT khai: KPI nào đo được, tên/đơn vị/công thức, chiều tốt, mục tiêu mặc định
// (cột Target + RAG của file), cách suy giá trị từ cặp {num, den} do RPC `warehouse_kpi` trả, và
// validator cho mục tiêu người dùng cấu hình (cờ SystemSetting `kpi_targets`). FE KHÔNG có bản chép —
// GET /wms/kpi trả luôn `defs` để màn hình vẽ và form cấu hình đọc nhãn từ đây.
//
// 40 KPI = 27 đo được (đủ nguồn hoặc đo được với ghi chú `note`: phụ thuộc kỷ luật nhập liệu / tạm theo tấn,
// pallet, tổng giờ công) + 13 CHƯA CÓ NGUỒN (`KPI_UNAVAILABLE`, mỗi dòng nói rõ cần bổ sung gì — memory
// `kpi-master-list-gaps`). Đợt 08/09 user chốt: KPI có nguồn lên tab, còn lại hiện ô trống kèm "cần bổ sung gì".

export type KpiGroup = 'delivery' | 'inbound' | 'accuracy' | 'risk' | 'capacity' | 'labor'
export const KPI_GROUPS: Array<{ key: KpiGroup; label: string }> = [
  { key: 'delivery', label: 'Giao hàng' },
  { key: 'inbound',  label: 'Nhập kho' },
  { key: 'accuracy', label: 'Tồn chính xác' },
  { key: 'risk',     label: 'Vòng quay & rủi ro' },
  { key: 'capacity', label: 'Sức chứa' },
  { key: 'labor',    label: 'Nhân lực & chi phí' },
]

/** up = cao hơn tốt · down = thấp hơn tốt · band = nằm trong dải [lo, hi] tốt, tới ymax vàng, hơn là đỏ */
export type KpiDir = 'up' | 'down' | 'band'
/** pct = 100·num/den · ratio = num/den · doh = tồn ÷ (xuất/ngày) · turnover = 365 ÷ doh */
export type KpiKind = 'pct' | 'ratio' | 'doh' | 'turnover'

export interface KpiDef {
  id: string
  no: number                 // số thứ tự trong file Master List (để đối chiếu với tài liệu)
  name: string
  short: string              // nhãn cột trong bảng theo kho
  group: KpiGroup
  unit: string
  dir: KpiDir
  kind: KpiKind
  decimals: number
  /** Mục tiêu MẶC ĐỊNH theo cột Target/RAG của file; null = file ghi "theo policy/baseline/budget" → người dùng phải đặt */
  defaults: number[] | null
  formula: string
  /** Ghi chú ĐO MỘT PHẦN — phải hiện trên màn hình để người đọc không tưởng kho kém */
  note?: string
  /** Ảnh chụp tồn HIỆN TẠI (không theo kỳ) — không so kỳ trước, không vẽ xu hướng */
  snapshot?: boolean
  /** Có TIỀN — cắt khỏi payload nếu thiếu `warehouse_cost.view` */
  cost?: boolean
  /** Nhãn "n" dưới ô số: hàm dựng câu từ num/den */
  subOf?: (num: number, den: number) => string
}

const n0 = (v: number) => Math.round(v).toLocaleString('vi-VN')

export const KPI_DEFS: KpiDef[] = [
  // ── Giao hàng ─────────────────────────────────────────────────────────────────
  { id: 'otif', no: 1, name: 'OTIF — đúng hạn & đủ hàng', short: 'OTIF', group: 'delivery', unit: '%', dir: 'up', kind: 'pct', decimals: 1,
    defaults: [98, 96], formula: 'Chuyến hoàn thành đúng ngày kế hoạch VÀ đủ số yêu cầu gốc ÷ tổng chuyến hoàn thành',
    subOf: (n, d) => `${n0(n)}/${n0(d)} chuyến` },
  { id: 'fill', no: 2, name: 'Fill rate — giao đủ', short: 'Fill', group: 'delivery', unit: '%', dir: 'up', kind: 'pct', decimals: 1,
    defaults: [98, 95], formula: 'Số lượng đã xuất ÷ số lượng yêu cầu gốc (gồm mức đã bị hạ)',
    subOf: (n, d) => `${n0(n)}/${n0(d)} đơn vị` },
  { id: 'gate_dwell', no: 7, name: 'Thời gian xe ở kho', short: 'Xe ở kho', group: 'delivery', unit: 'phút', dir: 'down', kind: 'ratio', decimals: 0,
    defaults: [60, 90], formula: 'Trung bình (giờ ra cổng − giờ vào cổng) của xe có Đăng ký cổng',
    note: 'chỉ xe có Đăng ký cổng ghi đủ giờ vào và ra', subOf: (_n, d) => `${n0(d)} xe` },
  { id: 'loading', no: 8, name: 'Thời gian xếp hàng', short: 'Xếp hàng', group: 'delivery', unit: 'phút', dir: 'down', kind: 'ratio', decimals: 0,
    defaults: [60, 90], formula: 'Trung bình (Hoàn thành − Bắt đầu) của chuyến hoàn thành', subOf: (_n, d) => `${n0(d)} chuyến` },
  // ── Nhập kho ──────────────────────────────────────────────────────────────────
  { id: 'dock_to_stock', no: 9, name: 'Dock-to-stock', short: 'Dock→stock', group: 'inbound', unit: 'giờ', dir: 'down', kind: 'ratio', decimals: 1,
    defaults: [4, 5], formula: 'Trung bình (phiếu nhập hoàn thành − xe vào cổng)',
    note: 'chỉ phiếu nhập có gắn Đăng ký cổng', subOf: (_n, d) => `${n0(d)} phiếu` },
  { id: 'recv_acc', no: 10, name: 'Nhận đúng số lượng', short: 'Nhận đúng', group: 'inbound', unit: '%', dir: 'up', kind: 'pct', decimals: 1,
    defaults: [99, 98], formula: 'Phiếu nhập có số thực = số kế hoạch ÷ phiếu có kế hoạch',
    note: 'chỉ phiếu NCC / chuyển kho có số kế hoạch; phiếu nhà máy không có PO', subOf: (n, d) => `${n0(n)}/${n0(d)} phiếu` },
  { id: 'unload_prod', no: 11, name: 'Pallet nhập / giờ công', short: 'Pallet/giờ', group: 'inbound', unit: 'pallet/giờ', dir: 'up', kind: 'ratio', decimals: 2,
    defaults: [18, 16.2], formula: 'Pallet nhập kho ÷ tổng giờ công',
    note: 'mẫu số là TỔNG giờ công kho — chấm công chưa tách theo việc (bốc / cất / nhặt)', subOf: (n, d) => `${n0(n)} pallet · ${n0(d)} giờ` },
  { id: 'putaway_acc', no: 12, name: 'Cất hàng đúng vị trí', short: 'Cất đúng', group: 'inbound', unit: '%', dir: 'up', kind: 'pct', decimals: 1,
    defaults: [99.5, 99], formula: 'Pallet cất không vi phạm quy tắc ÷ pallet được kiểm quy tắc cất hàng',
    note: 'chỉ kho bật kiểm quy tắc cất hàng', subOf: (n, d) => `${n0(n)}/${n0(d)} pallet` },
  // ── Tồn chính xác ─────────────────────────────────────────────────────────────
  { id: 'inv_acc', no: 15, name: 'Độ chính xác tồn kho', short: 'Tồn đúng', group: 'accuracy', unit: '%', dir: 'up', kind: 'pct', decimals: 2,
    defaults: [99.5, 98], formula: '1 − Σ|lệch kiểm kê| ÷ Σ số sổ (dòng kiểm kê trong kỳ)', subOf: (_n, d) => `số sổ ${n0(d)}` },
  { id: 'loc_acc', no: 16, name: 'Đúng vị trí hệ thống', short: 'Vị trí đúng', group: 'accuracy', unit: '%', dir: 'up', kind: 'pct', decimals: 1,
    defaults: [99.5, 99], formula: 'Dòng kiểm kê không phải đổi vị trí ÷ dòng kiểm kê', subOf: (n, d) => `${n0(n)}/${n0(d)} dòng` },
  { id: 'cc_compl', no: 17, name: 'Hoàn thành kiểm kê luân phiên', short: 'Kiểm luân phiên', group: 'accuracy', unit: '%', dir: 'up', kind: 'pct', decimals: 0,
    defaults: [100, 95], formula: 'Vị trí "cần kiểm kê" đã kiểm trong kỳ ÷ vị trí cần kiểm kê',
    note: 'chỉ vị trí gắn cờ "cần kiểm kê" (trang Vị trí kho)', subOf: (n, d) => `${n0(n)}/${n0(d)} vị trí` },
  { id: 'fefo', no: 24, name: 'Tuân thủ FEFO', short: 'FEFO', group: 'accuracy', unit: '%', dir: 'up', kind: 'pct', decimals: 1,
    defaults: [98, 95], formula: 'Lượt quét lấy đúng thứ tự ÷ lượt quét được đo',
    note: 'chỉ kho khai nguyên tắc luân chuyển (form Kho)', subOf: (n, d) => `${n0(n)}/${n0(d)} lượt quét` },
  { id: 'blocked', no: 25, name: 'Tồn bị khoá / QA giữ', short: 'Bị khoá', group: 'accuracy', unit: '%', dir: 'down', kind: 'pct', decimals: 2, snapshot: true,
    defaults: [1, 2], formula: 'Pallet QUARANTINE hoặc trạng thái QA ≠ OK ÷ pallet đang tồn', subOf: (n, d) => `${n0(n)}/${n0(d)} pallet` },
  // ── Vòng quay & rủi ro ────────────────────────────────────────────────────────
  { id: 'expiry_risk', no: 23, name: 'Tồn cận date', short: 'Cận date', group: 'risk', unit: '%', dir: 'down', kind: 'pct', decimals: 2, snapshot: true,
    defaults: [0.5, 1], formula: 'Pallet có %Date dưới ngưỡng đỏ toàn app ÷ pallet đang tồn', subOf: (n, d) => `${n0(n)}/${n0(d)} pallet` },
  { id: 'slow', no: 21, name: 'Hàng chậm luân chuyển', short: 'Chậm', group: 'risk', unit: '%', dir: 'down', kind: 'pct', decimals: 2, snapshot: true,
    defaults: [2, 4], formula: 'Pallet nhập quá N ngày mà mã không xuất khỏi kho quá N ngày ÷ pallet đang tồn (N = ngưỡng chậm)', subOf: (n, d) => `${n0(n)}/${n0(d)} pallet` },
  { id: 'dead', no: 22, name: 'Hàng không luân chuyển', short: 'Không LC', group: 'risk', unit: '%', dir: 'down', kind: 'pct', decimals: 2, snapshot: true,
    defaults: [1, 2], formula: 'Như hàng chậm với ngưỡng dài hơn (N = ngưỡng không luân chuyển)', subOf: (n, d) => `${n0(n)}/${n0(d)} pallet` },
  { id: 'doh', no: 19, name: 'Số ngày tồn kho (DOH)', short: 'DOH', group: 'risk', unit: 'ngày', dir: 'band', kind: 'doh', decimals: 1,
    defaults: null, formula: 'Tấn đang tồn ÷ (tấn xuất trong kỳ ÷ số ngày kỳ)',
    note: 'tính theo TẤN (app chưa có giá vốn); chỉ mã có khối lượng thùng', subOf: (n, d) => `tồn ${n0(n)} t · xuất ${n0(d)} t` },
  { id: 'turnover', no: 20, name: 'Vòng quay tồn kho (năm)', short: 'Vòng quay', group: 'risk', unit: 'vòng/năm', dir: 'up', kind: 'turnover', decimals: 1,
    defaults: null, formula: '365 ÷ DOH', note: 'tính theo TẤN (app chưa có giá vốn)' },
  // ── Sức chứa ──────────────────────────────────────────────────────────────────
  { id: 'util_zone', no: 26, name: 'Sử dụng sức chứa khu', short: 'SD khu', group: 'capacity', unit: '%', dir: 'band', kind: 'pct', decimals: 1, snapshot: true,
    defaults: [75, 85, 90], formula: 'Pallet quy đổi đang dùng ÷ sức chứa khai của khu (khu có khai)',
    note: 'chỉ khu đã khai sức chứa (tab Khu vực)', subOf: (n, d) => `${n0(n)}/${n0(d)} pallet` },
  { id: 'util_pos', no: 27, name: 'Sử dụng chỗ pallet', short: 'SD chỗ', group: 'capacity', unit: '%', dir: 'band', kind: 'pct', decimals: 1, snapshot: true,
    defaults: [80, 90, 95], formula: 'Pallet đang chiếm ÷ Σ sức chứa vị trí (1–1.000 pallet)', subOf: (n, d) => `${n0(n)}/${n0(d)} chỗ` },
  { id: 'empty_loc', no: 29, name: 'Vị trí trống', short: 'Trống', group: 'capacity', unit: '%', dir: 'up', kind: 'pct', decimals: 1, snapshot: true,
    defaults: [10, 5], formula: 'Vị trí không có pallet ÷ vị trí đang hoạt động', subOf: (n, d) => `${n0(n)}/${n0(d)} vị trí` },
  { id: 'overflow', no: 30, name: 'Tồn vượt sức chứa vị trí', short: 'Tràn', group: 'capacity', unit: '%', dir: 'down', kind: 'pct', decimals: 2, snapshot: true,
    defaults: [1, 3], formula: 'Σ pallet vượt sức chứa vị trí ÷ pallet ở vị trí có sức chứa', subOf: (n, d) => `${n0(n)}/${n0(d)} pallet` },
  // ── Nhân lực & chi phí ────────────────────────────────────────────────────────
  { id: 'pick_prod', no: 31, name: 'Thùng xuất / giờ công', short: 'Thùng/giờ', group: 'labor', unit: 'thùng/giờ', dir: 'up', kind: 'ratio', decimals: 1,
    defaults: [120, 108], formula: 'Thùng (quy đổi) đã xuất ÷ tổng giờ công',
    note: 'mẫu số là TỔNG giờ công kho — chấm công chưa tách riêng tổ nhặt hàng', subOf: (n, d) => `${n0(n)} thùng · ${n0(d)} giờ` },
  { id: 'pick_lines', no: 32, name: 'Dòng hàng xuất / giờ công', short: 'Dòng/giờ', group: 'labor', unit: 'dòng/giờ', dir: 'up', kind: 'ratio', decimals: 2,
    defaults: null, formula: 'Dòng hàng có xuất ÷ tổng giờ công', note: 'mẫu số là TỔNG giờ công kho', subOf: (n, d) => `${n0(n)} dòng · ${n0(d)} giờ` },
  { id: 'labor_prod', no: 33, name: 'Tấn / giờ công', short: 'Tấn/giờ', group: 'labor', unit: 'tấn/giờ', dir: 'up', kind: 'ratio', decimals: 3,
    defaults: null, formula: 'Tấn nhập + xuất ÷ tổng giờ công (như tab Năng suất)', subOf: (n, d) => `${n0(n)} tấn · ${n0(d)} giờ` },
  { id: 'ot_rate', no: 35, name: 'Tỷ lệ tăng ca', short: '% OT', group: 'labor', unit: '%', dir: 'down', kind: 'pct', decimals: 1,
    defaults: [5, 10], formula: 'Giờ tăng ca ÷ tổng giờ công', subOf: (n, d) => `${n0(n)}/${n0(d)} giờ` },
  { id: 'cost_case', no: 38, name: 'Chi phí kho / thùng', short: 'Chi phí/thùng', group: 'labor', unit: 'đ/thùng', dir: 'down', kind: 'ratio', decimals: 0, cost: true,
    defaults: null, formula: 'Chi phí kho trong kỳ ÷ thùng (quy đổi) nhập + xuất',
    note: 'kỳ không tròn tháng thì chi phí là số phân bổ theo ngày', subOf: (n, d) => `${n0(n)} đ · ${n0(d)} thùng` },
]

export const KPI_BY_ID: Record<string, KpiDef> = Object.fromEntries(KPI_DEFS.map(d => [d.id, d]))

/**
 * Ý NGHĨA của KPI — hiện trong nút ⓘ trên từng thẻ cùng cách tính (user 09/09 "thêm tooltip cách tính,
 * diễn giải để người xem hiểu"). Viết cho quản lý kho đọc: KPI này nói điều gì, cao/thấp thì hiểu sao.
 * Mỗi KPI đo được BẮT BUỘC có một dòng — gói QA 55 [1j] kiểm cùng lúc với empty_hint.
 */
export const KPI_MEANING: Record<string, string> = {
  otif: 'Chỉ số số 1 của dịch vụ: khách nhận đúng ngày hẹn VÀ đủ hàng. Thấp thì hoặc trễ, hoặc thiếu — xem Fill rate và Thời gian xếp hàng để biết vì đâu.',
  fill: 'Kho giao được bao nhiêu phần trăm số khách đặt. Nhu cầu gốc dựng lại từ vết hạ số lượng, nên dữ liệu trước 28/08 luôn 100%.',
  gate_dwell: 'Xe đứng trong kho bao lâu từ lúc vào tới lúc ra cổng — đo độ thông thoáng của bãi và tốc độ xếp dỡ.',
  loading: 'Từ lúc bấm Bắt đầu tới Hoàn thành chuyến — thời gian kho thực sự xếp hàng lên xe.',
  dock_to_stock: 'Hàng về tới cổng bao lâu thì thành tồn xuất được. Dài là hàng nằm bãi chờ nhập.',
  recv_acc: 'Bao nhiêu phần trăm phiếu nhận đúng số kế hoạch — lệch là nhà cung cấp giao sai hoặc kho đếm sai.',
  unload_prod: 'Mỗi giờ công của cả kho xử lý được bao nhiêu pallet nhập — năng suất khâu nhập.',
  putaway_acc: 'Cất pallet đúng chỗ theo quy tắc kho đặt ra (khu, loại hàng, trần mã). Sai chỗ là tìm hàng lâu và nhặt sai.',
  inv_acc: 'Số trên hệ thống khớp số đếm thật tới đâu. Nền của mọi kế hoạch xuất — tồn sai thì hứa khách sai.',
  loc_acc: 'Pallet nằm đúng vị trí hệ thống ghi. Sai vị trí là tìm hàng lâu, kiểm kê phải đổi chỗ.',
  cc_compl: 'Kiểm kê luân phiên có làm đúng lịch không — vị trí gắn cờ cần kiểm đã được kiểm trong kỳ.',
  fefo: 'Xuất hàng có lấy đúng thứ tự (hết date trước) không. Sai thứ tự để lại hàng cận date trong kho.',
  blocked: 'Phần tồn không xuất được vì QA giữ hoặc cách ly — vốn nằm chết.',
  expiry_risk: 'Phần tồn sắp hết date (dưới ngưỡng đỏ %Date của app) — cần xử lý trước khi thành hàng huỷ.',
  slow: 'Pallet nằm lâu mà mã không có lượt xuất — hàng đang đọng. Ngưỡng ngày đặt trong form Mục tiêu.',
  dead: 'Như hàng chậm nhưng ngưỡng dài hơn — gần như không còn bán được theo cách thường.',
  doh: 'Tồn hiện tại đủ bán bao nhiêu ngày theo tốc độ xuất trong kỳ. Thấp quá là rủi ro hết hàng, cao quá là đọng vốn.',
  turnover: 'Một năm tồn kho quay được bao nhiêu vòng — đảo ngược của DOH.',
  util_zone: 'Khu đang dùng bao nhiêu phần trăm sức chứa đã khai. Quá đầy khó xếp, quá trống lãng phí.',
  util_pos: 'Chỗ pallet thực có đang bị chiếm bao nhiêu phần trăm — đo theo từng vị trí có khai sức chứa.',
  empty_loc: 'Còn bao nhiêu phần trăm vị trí trống để đón hàng mới.',
  overflow: 'Pallet xếp vượt sức chứa vị trí — dấu hiệu chèn hàng, dữ liệu vị trí không còn tin được.',
  pick_prod: 'Mỗi giờ công của cả kho xuất được bao nhiêu thùng quy đổi — năng suất khâu xuất.',
  pick_lines: 'Mỗi giờ công xử lý được bao nhiêu dòng hàng — đo độ lẻ của đơn, khác với thùng/giờ.',
  labor_prod: 'Mỗi giờ công luân chuyển được bao nhiêu tấn hàng, tính cả nhập và xuất.',
  ot_rate: 'Giờ tăng ca chiếm bao nhiêu phần trăm giờ công — cao kéo dài là thiếu người hoặc kế hoạch lệch.',
  cost_case: 'Một thùng đi qua kho tốn bao nhiêu tiền — chi phí kê khai ở Chi phí kho chia cho thùng nhập + xuất.',
}

// ── kpi_meanings — DIỄN GIẢI SỬA ĐƯỢC TRONG APP (user chốt 09/09: "phần diễn giải info này cần được
// sửa trên app khi cần"). Cờ `kpi_meanings` ghi đè câu trong KPI_MEANING; bỏ dòng = về lại câu gốc.
// Chỉ đụng phần Ý NGHĨA — "Cách tính" vẫn do code sinh vì nó mô tả đúng phép tính RPC đang chạy,
// cho sửa tay là mở đường cho tài liệu nói một đằng máy tính một nẻo.
export type KpiMeanings = Record<string, string>
export const KPI_MEANINGS_DEFAULT: KpiMeanings = {}
export const KPI_MEANING_MAX = 600

export function meaningsError(m: unknown): string | null {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return 'diễn giải phải là object {kpi: "câu"}'
  const o = m as Record<string, unknown>
  if (Object.keys(o).length > KPI_DEFS.length) return 'quá nhiều dòng diễn giải'
  for (const [id, v] of Object.entries(o)) {
    const def = KPI_BY_ID[id]
    if (!def) return `KPI "${id}" không có trong sổ`
    if (typeof v !== 'string') return `${def.name}: diễn giải phải là chữ`
    if (!v.trim()) return `${def.name}: để trống thì bỏ hẳn dòng đó (quay về câu mặc định), không lưu chuỗi rỗng`
    if (v.length > KPI_MEANING_MAX) return `${def.name}: diễn giải tối đa ${KPI_MEANING_MAX} ký tự`
  }
  return null
}
/** Validator MỘT NGUỒN cho cả PUT lẫn getter (giá trị bậy trong DB → mặc định, không ném). */
export function parseKpiMeanings(raw: unknown): KpiMeanings | null {
  return meaningsError(raw) ? null : (raw as KpiMeanings)
}
/** Câu diễn giải CÓ HIỆU LỰC: bản sửa trong app → câu gốc trong sổ. */
export const meaningOf = (id: string, m: KpiMeanings): string => m[id] ?? KPI_MEANING[id] ?? ''

/**
 * Khi KPI KHÔNG có dữ liệu: nói rõ thiếu gì và phải cài đặt / thao tác ở đâu để có số (user 08/09
 * "biểu đồ nào thiếu dữ liệu thì ghi rõ hơn — ví dụ cần setting kho như thế nào"). Mỗi KPI đo được
 * BẮT BUỘC có một dòng ở đây — gói QA 55 [1j] kiểm mọi def đều có empty_hint không rỗng.
 */
export const KPI_EMPTY_HINT: Record<string, string> = {
  otif: 'Chưa có chuyến HOÀN THÀNH có ngày xuất trong kỳ — chuyến phải được bấm Hoàn thành ở trang Xuất kho.',
  fill: 'Chưa có chuyến hoàn thành trong kỳ. Fill rate đọc số yêu cầu gốc của chuyến (vết hạ SL ghi từ 28/08).',
  gate_dwell: 'Không xe nào ghi đủ giờ VÀO và RA cổng trong kỳ. Dùng Đăng ký cổng (menu Điều vận): bấm Vào khi xe tới, Ra khi xe rời; bật "Bắt buộc đăng ký cổng khi Bắt đầu" trong form Kho để mọi chuyến đều gắn cổng.',
  loading: 'Chưa có chuyến vừa có Bắt đầu vừa có Hoàn thành trong kỳ (trang Xuất kho).',
  dock_to_stock: 'Không có phiếu nhập gắn Đăng ký cổng trong kỳ. Khi tạo phiếu nhập hãy chọn đăng ký cổng của xe (Đăng ký cổng → chiều Nhập) để phiếu có mốc giờ xe đến.',
  recv_acc: 'Không có phiếu nhập NCC / chuyển kho có số kế hoạch trong kỳ. Nạp Kế hoạch nhập (TMS Bookings › Kế hoạch) để phiếu có số kế hoạch so với thực nhận.',
  unload_prod: 'Kỳ này chưa có chấm công (mẫu số) hoặc chưa có pallet nhập. Ghi công hằng ngày ở màn Chấm công.',
  putaway_acc: 'Kho chưa bật kiểm quy tắc cất hàng: Cài đặt WMS › Kho › "Bắt buộc quy tắc cất hàng" + khai quy tắc; sau đó mỗi pallet nhập sẽ được kiểm.',
  inv_acc: 'Chưa có dòng kiểm kê trong kỳ. Kiểm kê ở trang Kiểm kho (Check vị trí / Tổng hợp KK) thì mới có số sổ ↔ số thực.',
  loc_acc: 'Chưa có dòng kiểm kê trong kỳ (trang Kiểm kho).',
  cc_compl: 'Chưa có vị trí gắn cờ "Cần kiểm kê": trang Vị trí kho → chọn vị trí → cờ hàng loạt "Cần kiểm kê"; hoặc dùng tab Luân phiên ABC.',
  fefo: 'Kho chưa khai Nguyên tắc luân chuyển: Cài đặt WMS › Kho › "Thứ tự lấy hàng" (FEFO/FIFO/LIFO). Khai xong, mỗi lượt quét xuất sẽ được đo.',
  blocked: 'Không có pallet đang tồn trong phạm vi (hoặc bạn bị cắt Loại hàng).',
  expiry_risk: 'Không có pallet đang tồn có NSX/HSD + shelf life. Khai shelf life ở Mã hàng để tính %Date.',
  slow: 'Không có pallet đang tồn trong phạm vi.',
  dead: 'Không có pallet đang tồn trong phạm vi.',
  doh: 'Cần tấn xuất trong kỳ > 0 và mã hàng có khối lượng thùng (Mã hàng › KL/thùng).',
  turnover: 'Cần tấn tồn > 0 và tấn xuất trong kỳ; mã hàng phải khai khối lượng thùng.',
  util_zone: 'Chưa khu vực nào khai sức chứa: Cài đặt WMS › Khu vực › "Sức chứa (pallet)" cho từng khu.',
  util_pos: 'Vị trí chưa khai sức chứa 1–1.000 pallet (trang Vị trí kho › sức chứa). Vị trí khai quá 1.000 coi là không giới hạn, bị loại.',
  empty_loc: 'Kho chưa có vị trí đang hoạt động (trang Vị trí kho).',
  overflow: 'Vị trí chưa khai sức chứa hoặc chưa có pallet ở vị trí có sức chứa.',
  pick_prod: 'Kỳ này chưa có chấm công (mẫu số) — ghi công ở màn Chấm công; hoặc chưa có chuyến xuất.',
  pick_lines: 'Kỳ này chưa có chấm công (mẫu số) — ghi công ở màn Chấm công.',
  labor_prod: 'Kỳ này chưa có chấm công (mẫu số) hoặc mã hàng chưa khai khối lượng thùng (tử số).',
  ot_rate: 'Kỳ này chưa có chấm công. Ghi công (ca + giờ tăng ca) ở màn Chấm công.',
  cost_case: 'Kỳ này chưa khai chi phí kho (Tổng quan › Chi phí kho) hoặc không có thùng nhập/xuất.',
}

/** 16 KPI trong file CHƯA CÓ NGUỒN trong app — hiện ô trống trên tab kèm "cần bổ sung gì". */
export const KPI_UNAVAILABLE: Array<{ no: number; name: string; group: KpiGroup; need: string }> = [
  { no: 3,  name: 'Order accuracy — đơn đúng SKU/SL/lô', group: 'delivery', need: 'Sổ sự cố sau xuất: ghi đơn bị báo sai mã / thiếu / sai lô (khách hoặc kho nhận báo)' },
  { no: 4,  name: 'Perfect order rate', group: 'delivery', need: 'Sổ sự cố có loại lỗi hư hỏng + chứng từ (cùng sổ với #3)' },
  { no: 5,  name: 'Order cycle time', group: 'delivery', need: 'Chốt mốc "release" = giờ giao việc trên chuyến (kế hoạch SAP nạp trước cả ngày)' },
  { no: 6,  name: 'Dispatch accuracy', group: 'delivery', need: 'Chốt định nghĩa "đúng kế hoạch" (đúng ngày, đúng xe, đủ DO) — trùng phần lớn OTIF' },
  { no: 13, name: 'Put-away productivity', group: 'inbound', need: 'Giờ công theo công việc (chấm công thêm chiều: bốc / cất / nhặt / xuất)' },
  { no: 14, name: 'Supplier delivery compliance', group: 'inbound', need: 'Kế hoạch nhập NCC được nạp đều (đã có chỗ ở tab Kế hoạch nhập) — chốt luật "đúng lịch"' },
  { no: 18, name: 'Inventory variance value', group: 'accuracy', need: 'Đơn giá / giá vốn trên Mã hàng (nhập tay, upload hoặc từ SAP)' },
  { no: 37, name: 'Shrinkage rate', group: 'accuracy', need: 'Mã lý do trên dòng kiểm kê lệch và điều chỉnh tồn (tách "không giải thích được")' },
  { no: 28, name: 'Cubic utilization', group: 'capacity', need: 'Thể tích / chiều cao từng vị trí (thùng đã có kích thước)' },
  { no: 34, name: 'Labor utilization', group: 'labor', need: 'Giờ có việc (giờ productive) để so với giờ công' },
  { no: 36, name: 'Damage rate', group: 'labor', need: 'Sổ hàng hư hỏng: mã, SL, khâu, lý do (điều chỉnh tồn hiện chỉ có ghi chú tự do)' },
  { no: 39, name: 'Warehouse cost / sales', group: 'labor', need: 'Doanh thu theo kho theo tháng (sổ kê khai như Chi phí kho, hoặc import SAP)' },
  { no: 40, name: 'Write-off / sales', group: 'labor', need: 'Giá vốn + lý do write-off + doanh thu' },
]
// Lưu ý đếm: 27 KPI đo được (trong đó DOH/Turnover tạm theo TẤN, Slow/Non-moving theo PALLET, 3 KPI năng suất theo
// TỔNG giờ công — ghi chú nằm ngay trên def) + 13 chưa có nguồn = 40 dòng của file. Bản "theo giá trị" của các KPI
// tạm tính KHÔNG liệt kê riêng ở đây (sẽ thành 43 > 40, người đọc tưởng file có thêm KPI) — mở khoá bằng mảnh
// "giá vốn mã hàng" (memory kpi-master-list-gaps).

// ── Giá trị & đèn ─────────────────────────────────────────────────────────────
export type Rag = 'G' | 'Y' | 'R'

export function kpiValue(def: KpiDef, num: number | null | undefined, den: number | null | undefined, days: number): number | null {
  const n = Number(num), d = Number(den)
  if (num == null || den == null || !Number.isFinite(n) || !Number.isFinite(d)) return null
  // KPI tiền: kỳ CHƯA KHAI chi phí trả cost = 0 chứ không null → "0 đ/thùng" rồi ▲ so kỳ đọc như chi phí tăng vọt.
  // Chưa khai = chưa có dữ liệu, không phải miễn phí.
  if (def.cost && n <= 0) return null
  switch (def.kind) {
    case 'pct':      return d > 0 ? (100 * n) / d : null
    case 'ratio':    return d > 0 ? n / d : null
    case 'doh': {    // tồn tấn ÷ (tấn xuất / ngày)
      if (!(days > 0) || d <= 0) return null
      return n / (d / days)
    }
    case 'turnover': {
      if (!(days > 0) || n <= 0) return null
      return 365 / (n / (d / days))
    }
  }
}

export function evalRag(def: KpiDef, value: number | null, t: number[] | null | undefined): Rag | null {
  if (value == null || !t) return null
  if (def.dir === 'up')   return value >= t[0] ? 'G' : value >= t[1] ? 'Y' : 'R'
  if (def.dir === 'down') return value <= t[0] ? 'G' : value <= t[1] ? 'Y' : 'R'
  // band: [lo, hi, ymax] — dưới lo cũng chỉ VÀNG (kho vắng không phải sự cố), quá ymax mới đỏ
  return value >= t[0] && value <= t[1] ? 'G' : value <= t[2] ? 'Y' : 'R'
}

// ── Mục tiêu người dùng cấu hình — cờ SystemSetting `kpi_targets` ─────────────
// { default: {id: number[]|null}, by_warehouse: {whId: {id: number[]|null}}, params: {slow_days, dead_days} }
// Trong `by_warehouse`: KHÔNG có khoá = kế thừa mặc định; khoá = null = kho này cố ý không đặt mục tiêu.
export type KpiTargetMap = Record<string, number[] | null>
export interface KpiTargets {
  default: KpiTargetMap
  by_warehouse: Record<string, KpiTargetMap>
  params: { slow_days: number; dead_days: number }
}
export const KPI_TARGETS_DEFAULT: KpiTargets = { default: {}, by_warehouse: {}, params: { slow_days: 90, dead_days: 180 } }

/** Ngưỡng hợp lệ cho MỘT KPI — trả câu lỗi tiếng Việt, hoặc null nếu ok. */
export function thresholdError(def: KpiDef, t: unknown): string | null {
  if (t === null) return null
  if (!Array.isArray(t) || t.some(x => typeof x !== 'number' || !Number.isFinite(x))) return `${def.name}: ngưỡng phải là mảng số`
  const need = def.dir === 'band' ? 3 : 2
  if (t.length !== need) return `${def.name}: cần ${need} ngưỡng`
  const arr = t as number[]
  if (arr.some(x => x < 0)) return `${def.name}: ngưỡng không được âm`
  if (def.unit === '%' && arr.some(x => x > 100)) return `${def.name}: ngưỡng % không quá 100`
  if (def.dir === 'up'   && !(arr[0] >= arr[1])) return `${def.name}: ngưỡng xanh phải ≥ ngưỡng vàng (cao hơn là tốt)`
  if (def.dir === 'down' && !(arr[0] <= arr[1])) return `${def.name}: ngưỡng xanh phải ≤ ngưỡng vàng (thấp hơn là tốt)`
  if (def.dir === 'band' && !(arr[0] <= arr[1] && arr[1] <= arr[2])) return `${def.name}: dải phải theo thứ tự thấp ≤ cao ≤ ngưỡng đỏ`
  return null
}

export function targetMapError(m: unknown): string | null {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return 'mục tiêu phải là object {kpi: [ngưỡng]}'
  for (const [id, t] of Object.entries(m as Record<string, unknown>)) {
    const def = KPI_BY_ID[id]
    if (!def) return `KPI "${id}" không có trong sổ`
    const e = thresholdError(def, t)
    if (e) return e
  }
  return null
}

const intIn = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi

export function paramsError(p: unknown): string | null {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'params phải là object'
  const o = p as Record<string, unknown>
  if (Object.keys(o).some(k => k !== 'slow_days' && k !== 'dead_days')) return 'params chỉ có slow_days, dead_days'
  if (!intIn(o.slow_days, 7, 730) || !intIn(o.dead_days, 7, 1460)) return 'slow_days 7–730, dead_days 7–1460 (ngày, nguyên)'
  if ((o.slow_days as number) > (o.dead_days as number)) return 'ngưỡng chậm phải ≤ ngưỡng không luân chuyển'
  return null
}

/** Validator MỘT NGUỒN cho cả PUT lẫn getter (giá trị bậy trong DB → mặc định, không ném). */
export function parseKpiTargets(raw: unknown): KpiTargets | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (Object.keys(o).some(k => !(k in KPI_TARGETS_DEFAULT))) return null
  const def = o.default ?? {}
  if (targetMapError(def)) return null
  const bw = (o.by_warehouse ?? {}) as Record<string, unknown>
  if (!bw || typeof bw !== 'object' || Array.isArray(bw) || Object.keys(bw).length > 500) return null
  for (const [wh, m] of Object.entries(bw)) {
    if (!wh.trim() || wh.length > 64 || targetMapError(m)) return null
  }
  const params = o.params ?? KPI_TARGETS_DEFAULT.params
  if (paramsError(params)) return null
  return { default: def as KpiTargetMap, by_warehouse: bw as Record<string, KpiTargetMap>, params: params as KpiTargets['params'] }
}

export type TargetSource = 'default' | 'global' | 'warehouse'
/** Ngưỡng có hiệu lực cho KPI ở phạm vi (kho hoặc toàn công ty) + nó đến từ đâu. */
export function effectiveTarget(def: KpiDef, targets: KpiTargets, warehouseId: string | null): { t: number[] | null; source: TargetSource } {
  if (warehouseId) {
    const m = targets.by_warehouse[warehouseId]
    if (m && def.id in m) return { t: m[def.id], source: 'warehouse' }
  }
  if (def.id in targets.default) return { t: targets.default[def.id], source: 'global' }
  return { t: def.defaults, source: 'default' }
}
