// Mảnh dùng chung của module Fill hàng (trang danh sách + trang chi tiết lệnh + màn quét):
// ô chọn người nhận, ô chọn vị trí nhặt lẻ đích, nhãn/màu trạng thái, ô "Date yêu cầu (%Date)".
import { SingleSelect } from '@/components/shared/SingleSelect'
import { useFillEmployees, usePickFaceLocations, type FillTaskRow } from '@/api/hooks'
import { computePctDate } from '@/utils/shelfLife'
import { formatTimestampDate } from '@/utils/formatters'

export const FILL_STATUS_LABEL: Record<string, string> = { PENDING: 'Chờ làm', DONE: 'Đã hạ', CANCELLED: 'Đã hủy' }
export const FILL_STATUS_BADGE: Record<string, string> = {
  PENDING:   'bg-amber-100 text-amber-700',
  DONE:      'bg-blue-100 text-blue-700',
  CANCELLED: 'bg-slate-200 text-slate-500',
}
export const fillRowText = (status: string) =>
  status === 'DONE' ? 'text-[#4A90D9] line-through' : status === 'CANCELLED' ? 'text-slate-400' : ''

export function AssigneePicker({ warehouseId, value, onChange }: {
  warehouseId: string; value: string; onChange: (v: string) => void
}) {
  const { data: emps = [] } = useFillEmployees(warehouseId)
  return (
    <div>
      <label className="text-[11px] text-slate-500">Giao cho</label>
      <SingleSelect
        value={value}
        onChange={onChange}
        options={[
          { value: '', label: '— Chưa giao ai (ai quét thì người đó nhận) —' },
          ...emps.map(e => ({ value: e.id, label: `${e.name}${e.job_title ? ` · ${e.job_title}` : ''}` })),
        ]}
        placeholder="Chọn nhân sự…"
      />
      {/* Kho chưa gán nhân sự nào thì ô chọn chỉ có 1 dòng — nói rõ VÌ SAO, đừng để người dùng
          tưởng tính năng hỏng */}
      {emps.length === 0 && (
        <p className="text-[10px] text-amber-700 mt-1">
          Kho này chưa có nhân sự nào được gán — lệnh sẽ để trống, ai quét thì người đó nhận.
        </p>
      )}
    </div>
  )
}

export function DestPicker({ warehouseId, materialId, value, onChange, label = 'Vị trí nhặt lẻ đích' }: {
  warehouseId: string; materialId?: string; value: string; onChange: (v: string) => void; label?: string
}) {
  // materialId → BE chỉ trả vị trí NHẬN Loại kho của mã (đích khác loại lưu sẽ bị 400)
  const { data: locs = [] } = usePickFaceLocations(warehouseId, materialId)
  return (
    <div>
      <label className="text-[11px] text-slate-500">{label}</label>
      <SingleSelect
        value={value}
        onChange={onChange}
        options={locs.map(l => ({ value: l.id, label: `${l.location_code} (${l.max_pallets} pl)` }))}
        placeholder="Chọn vị trí nhặt lẻ…"
      />
    </div>
  )
}

/** Ô "Date yêu cầu (%Date)" của một dòng lệnh — dùng chung bảng chi tiết + màn quét. */
export function RequiredDateBadge({ line }: { line: Pick<FillTaskRow, 'required_date' | 'required_expiry'> }) {
  if (!line.required_date) return <span className="text-[10px] text-slate-400">Tự do (FEFO)</span>
  const pct = computePctDate({ production_date: line.required_date, expiry_date: line.required_expiry }, null)
  return (
    <>
      <span className="text-[10px] font-semibold tabular-nums">{formatTimestampDate(line.required_date, true)}</span>
      {pct !== null && (
        <span className={`ml-1 text-[9px] px-1 py-0.5 rounded ${pct < 50 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
          {pct}%
        </span>
      )}
    </>
  )
}
