import { useState } from 'react'
import { MapPin, Search, Check } from 'lucide-react'
import { useLocationsReal } from '@/api/hooks'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { qtyLabel, type MatUnits } from '@/utils/qtyUnits'

/** Sentinel "giữ chỗ cũ" — BE phân biệt với BỎ TRỐNG (bỏ trống = chưa chọn → 422). */
export const KEEP_LOCATION = 'KEEP'

interface Props {
  /** Số BASE còn lại trên pallet sau lượt xuất này (đã > 0 mới render component) */
  leftoverQty: number
  mat?: MatUnits | null
  /** Vị trí pallet đang đứng — nút "giữ chỗ cũ" */
  currentLocationCode: string | null
  warehouseId: string | null
  /** null = CHƯA chọn (chặn Lưu) · KEEP_LOCATION · id vị trí mới */
  value: string | null
  onChange: (v: string) => void
}

/**
 * Pallet xuất KHÔNG hết → bắt khai hàng dư nằm ở đâu trước khi cho Lưu (user chốt 30/07).
 * Vì sao bắt buộc: luồng xuất trước đây không đụng `location_id`, pallet bị "mổ" vẫn ghi ở vị trí
 * cũ dù thực tế công nhân để khu tạm → lần sau tới đúng vị trí đó không có hàng.
 * Giữ 1 CHẠM cho trường hợp phổ biến (trả về chỗ cũ), tìm-trên-server khi cần chỗ khác
 * (danh mục vị trí vài nghìn dòng — không nạp hết vào máy quét).
 */
export function LeftoverLocationPicker({
  leftoverQty, mat, currentLocationCode, warehouseId, value, onChange,
}: Props) {
  const [picking, setPicking] = useState(false)
  const [term, setTerm] = useState('')
  const search = useDebouncedValue(term, 250)
  const { data: locs = [], isFetching } = useLocationsReal(
    { warehouse_id: warehouseId ?? undefined, search: search || undefined, limit: 30 },
    picking && !!warehouseId,
  )
  const chosen = (locs as { id: string; location_code: string }[]).find(l => l.id === value)

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${value ? 'bg-slate-50 border-slate-200' : 'bg-amber-50 border-amber-300'}`}>
      {/* 1 dòng gọn: màn 360px trước đây vỡ thành 3 khúc ("Còn" tách khỏi số, "trên pallet" rớt dòng) */}
      <p className={`text-sm font-medium leading-snug flex items-baseline gap-1.5 ${value ? 'text-slate-700' : 'text-amber-800'}`}>
        <MapPin className="h-4 w-4 shrink-0 translate-y-0.5" />
        <span>Còn <strong className="whitespace-nowrap">{qtyLabel(leftoverQty, mat)}</strong> — để ở đâu?</span>
      </p>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => { onChange(KEEP_LOCATION); setPicking(false) }}
          className={`rounded-lg border px-2 py-2 text-left transition-colors ${
            value === KEEP_LOCATION ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white hover:border-slate-400'}`}
        >
          <span className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
            {value === KEEP_LOCATION && <Check className="h-3 w-3 text-blue-600" />}Giữ chỗ cũ
          </span>
          <span className="block font-mono text-sm font-semibold text-slate-800 truncate">
            {currentLocationCode ?? '—'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setPicking(p => !p)}
          className={`rounded-lg border px-2 py-2 text-left transition-colors ${
            value && value !== KEEP_LOCATION ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white hover:border-slate-400'}`}
        >
          <span className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
            {value && value !== KEEP_LOCATION && <Check className="h-3 w-3 text-blue-600" />}Vị trí khác
          </span>
          <span className="block font-mono text-sm font-semibold text-slate-800 truncate">
            {value && value !== KEEP_LOCATION ? (chosen?.location_code ?? 'đã chọn') : 'Chọn…'}
          </span>
        </button>
      </div>

      {picking && (
        <div className="mt-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              autoFocus
              value={term}
              onChange={e => setTerm(e.target.value)}
              placeholder="Tìm mã vị trí…"
              className="w-full h-9 pl-7 pr-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div className="mt-1.5 max-h-40 overflow-auto rounded-md border border-slate-200 divide-y divide-slate-100">
            {isFetching && <p className="px-2 py-2 text-xs text-slate-400">Đang tìm…</p>}
            {!isFetching && locs.length === 0 && (
              <p className="px-2 py-2 text-xs text-slate-400">Không có vị trí khớp</p>
            )}
            {(locs as { id: string; location_code: string; max_pallets?: number; used_slots?: number }[]).map(l => {
              // Vị trí đã đầy vẫn HIỆN nhưng chặn chọn — BE (RPC khóa dòng) mới là trọng tài cuối
              const full = (l.max_pallets ?? 0) > 0 && (l.used_slots ?? 0) >= (l.max_pallets ?? 0)
              return (
                <button
                  key={l.id}
                  type="button"
                  disabled={full}
                  onClick={() => { onChange(l.id); setPicking(false) }}
                  className={`w-full text-left px-2 py-2 text-sm font-mono flex items-center justify-between gap-2 ${
                    full ? 'text-slate-300 cursor-not-allowed' : 'hover:bg-sky-50'}`}
                >
                  <span className="truncate">{l.location_code}</span>
                  {(l.max_pallets ?? 0) > 0 && (
                    <span className={`text-[10px] font-sans shrink-0 ${full ? 'text-red-400' : 'text-slate-400'}`}>
                      {full ? 'đầy' : `còn ${(l.max_pallets ?? 0) - (l.used_slots ?? 0)}`}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
