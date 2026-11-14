// PHIẾU THEO DÕI của mẻ (MES 14/11/2026) — danh sách Ô của hai biểu mẫu giấy trong file NB-QA-BM-CB.01:
//   MIX   = "Phiếu theo dõi quá trình phối trộn"            JELLY = "Phiếu theo dõi bán thành phẩm dịch thạch"
// Nội dung lưu ở batch_process_log.data dạng { mã_ô: 'giá trị' } — BE không diễn giải từng ô, nên THÊM / BỚT / ĐỔI NHÃN ô chỉ sửa file
// này, không cần đổi bảng. ĐỪNG đổi `key` của ô đã dùng (phiếu cũ sẽ mất giá trị ô đó trên màn hình).
export type ProcessForm = 'MIX' | 'JELLY'
export type FieldKind = 'num' | 'time' | 'text'
export interface ProcessField {
  key: string; label: string; kind: FieldKind
  unit?: string
  /** ngưỡng tiêu chuẩn: giá trị vượt ⇒ tô đỏ (không chặn lưu — phiếu ghi đúng thực tế) */
  max?: number; min?: number
  /** ô rộng cả hàng (ghi chú dài) */
  wide?: boolean
}
export interface ProcessSection { title: string; hint?: string; fields: ProcessField[] }
export interface ProcessGrid { title: string; rows: number; cols: { key: string; label: string }[]; cells: { key: string; label: string; kind: FieldKind }[] }
export interface ProcessFormDef { form: ProcessForm; title: string; short: string; sections: ProcessSection[]; grid?: ProcessGrid; tail?: ProcessSection[] }

const pour = (n: number): ProcessField[] => [
  { key: `pour${n}_time`, label: `Đổ xong lần ${n} — giờ`, kind: 'time' },
  { key: `pour${n}_check`, label: `Đổ xong lần ${n} — kiểm tra`, kind: 'text' },
]

export const PROCESS_FORMS: Record<ProcessForm, ProcessFormDef> = {
  MIX: {
    form: 'MIX', title: 'Phiếu theo dõi quá trình phối trộn', short: 'Phối trộn',
    sections: [
      { title: 'Bồn trộn', fields: [
        { key: 'mix_tank', label: 'Bồn trộn (Mixing)', kind: 'text' },
        { key: 'mix_qty', label: 'Số lượng mẻ', kind: 'num' },
        { key: 'start_time', label: 'Giờ bắt đầu', kind: 'time' },
        { key: 'end_time', label: 'Giờ kết thúc', kind: 'time' },
      ] },
      { title: 'Nước cấp và hoàn nguyên', fields: [
        { key: 'water_l', label: 'Nước cấp', kind: 'num', unit: 'L' },
        { key: 'mix_temp', label: 'Nhiệt độ trộn', kind: 'num', unit: '°C' },
        { key: 'recon_water_l', label: 'Nước hoàn nguyên', kind: 'num', unit: 'L' },
        { key: 'recon_temp', label: 'Nhiệt độ sau hoàn nguyên', kind: 'num', unit: '°C' },
      ] },
      { title: 'Đổ nguyên liệu', fields: [...pour(1), ...pour(2), ...pour(3)] },
      { title: 'Giám sát và cacao', fields: [
        { key: 'supervise_by', label: 'Giám sát CNV trộn ổn định, nguyên liệu — người', kind: 'text' },
        { key: 'supervise_time', label: 'Giám sát — giờ', kind: 'time' },
        { key: 'cacao_water_l', label: 'Nước cấp trộn cacao', kind: 'num', unit: 'L' },
        { key: 'cacao_temp', label: 'Nấu cacao — nhiệt độ', kind: 'num', unit: '°C' },
        { key: 'cacao_time', label: 'Nấu cacao — thời gian', kind: 'text' },
      ] },
      { title: 'Chỉ tiêu', hint: 'pH nước trộn: tiêu chuẩn ≤ 7,20', fields: [
        { key: 'ph_water', label: 'pH nước trộn', kind: 'num', max: 7.2 },
        { key: 'ph_dac', label: 'pH DAC', kind: 'num' },
        { key: 'brix', label: 'Brix', kind: 'num' },
      ] },
      { title: 'Giao ca', fields: [
        { key: 'handover_done', label: 'Nguyên liệu đã phối trộn', kind: 'text', wide: true },
        { key: 'handover_todo', label: 'Nguyên liệu chưa phối trộn', kind: 'text', wide: true },
        { key: 'note', label: 'Ghi chú', kind: 'text', wide: true },
      ] },
    ],
  },
  JELLY: {
    form: 'JELLY', title: 'Phiếu theo dõi bán thành phẩm dịch thạch', short: 'Dịch thạch',
    sections: [
      { title: 'Bồn khoáng', fields: [
        { key: 'mineral_water_l', label: 'Nước cấp', kind: 'num', unit: 'L' },
        { key: 'mineral_temp', label: 'Nhiệt độ', kind: 'num', unit: '°C' },
        { key: 'mineral_ph', label: 'pH', kind: 'num' },
      ] },
      { title: 'Bổ sung đường', fields: [
        { key: 'sugar_kg', label: 'Số lượng', kind: 'num', unit: 'kg' },
        { key: 'sugar_check_time', label: 'Thời gian kiểm tra', kind: 'time' },
        { key: 'sugar_ph', label: 'pH dịch đường', kind: 'num' },
      ] },
      { title: 'Đổ / rửa thạch', fields: [
        { key: 'jelly_kg', label: 'Số lượng thạch', kind: 'num', unit: 'kg' },
        { key: 'jelly_start', label: 'Bắt đầu', kind: 'time' },
        { key: 'jelly_end', label: 'Kết thúc', kind: 'time' },
      ] },
    ],
    grid: {
      title: 'Theo dõi nước rửa thạch', rows: 8,
      cols: [{ key: 's1', label: 'Bồn sục 1' }, { key: 's2', label: 'Bồn sục 2' }, { key: 's3', label: 'Bồn sục 3' }],
      cells: [{ key: 't', label: 'Giờ', kind: 'time' }, { key: 'temp', label: '°C', kind: 'num' }, { key: 'ph', label: 'pH', kind: 'num' }],
    },
    tail: [
      { title: 'Hoàn thiện', fields: [
        { key: 'finish_time', label: 'Giờ hoàn thiện', kind: 'time' },
        { key: 'finish_level', label: 'Mức bồn', kind: 'num' },
        { key: 'sample_time', label: 'Giờ lấy mẫu', kind: 'time' },
        { key: 'finish_temp', label: 'Nhiệt độ', kind: 'num', unit: '°C' },
        { key: 'sensory', label: 'Màu sắc, mùi vị', kind: 'text' },
        { key: 'state', label: 'Trạng thái', kind: 'text' },
        { key: 'finish_brix', label: 'Brix', kind: 'num' },
        { key: 'finish_ph', label: 'pH', kind: 'num' },
        { key: 'uht_time', label: 'Giờ UHT', kind: 'time' },
        { key: 'note', label: 'Ghi chú / theo dõi', kind: 'text', wide: true },
      ] },
    ],
  },
}
/** Mã ô của lưới: wash_<dòng>_<cột>_<ô> — vd wash_3_s2_ph */
export const gridKey = (row: number, col: string, cell: string) => `wash_${row}_${col}_${cell}`
/** Tổng số ô của một phiếu (để báo "đã ghi n / m ô") */
export const processFieldCount = (d: ProcessFormDef) =>
  [...d.sections, ...(d.tail ?? [])].reduce((s, x) => s + x.fields.length, 0) + (d.grid ? d.grid.rows * d.grid.cols.length * d.grid.cells.length : 0)
