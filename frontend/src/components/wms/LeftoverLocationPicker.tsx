import { useState } from 'react'
import { MapPin, Search, Check } from 'lucide-react'
import { useLocationsReal } from '@/api/hooks'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { qtyLabel, type MatUnits } from '@/utils/qtyUnits'
import { PutawayOption, type PutawayLocRow } from '@/components/wms/PutawayOption'
import type { PutawayHint } from '@/utils/putaway'

/** Sentinel "giữ chỗ cũ" — BE phân biệt với BỎ TRỐNG (bỏ trống = chưa chọn → 422). */
export const KEEP_LOCATION = 'KEEP'

/**
 * Lỗi thuộc về VỊ TRÍ hàng dư → màn quét giữ nguyên tem để chọn lại, KHÔNG bắt quét lại pallet.
 * Ưu tiên MÃ LỖI, câu chữ chỉ là lưới sau: 4/7 câu chặn của quy tắc cất (ô nhặt lẻ · vượt số mã ·
 * khác NCC · lệch date) KHÔNG chứa chữ "chọn vị trí" ⇒ chỉ dò câu chữ là người quét mất tem đang
 * chờ và phải quét lại pallet, dù lỗi hoàn toàn nằm ở ô họ vừa chọn.
 */
export function isLeftoverLocError(msg: string, code?: string): boolean {
  // PUTAWAY_VIOLATION ở luồng XUẤT chỉ có thể đến từ ô đặt phần dư (cửa guardPutaway duy nhất).
  if (code === 'PUTAWAY_VIOLATION' || code === 'PUTAWAY_REASON_REQUIRED') return true
  return /chọn vị trí|vị trí .*(hết chỗ|ngưng sử dụng|không tồn tại|không thuộc kho)/i.test(msg ?? '')
}

interface Props {
  /** Số BASE còn lại trên pallet sau lượt xuất này (đã > 0 mới render component) */
  leftoverQty: number
  mat?: MatUnits | null
  /** Vị trí pallet đang đứng — nút "giữ chỗ cũ" */
  currentLocationCode: string | null
  warehouseId: string | null
  /** Mã hàng của pallet đang quét — để BE chấm quy tắc CẤT cho từng ô (khối `putaway`) */
  materialId?: string | null
  /** null = CHƯA chọn (chặn Lưu) · KEEP_LOCATION · id vị trí mới */
  value: string | null
  onChange: (v: string) => void
  /**
   * Kết luận quy tắc cất của ô VỪA CHỌN (null = giữ chỗ cũ / ô sạch). Phát tại thời điểm bấm chọn
   * chứ không suy lại từ danh sách: danh sách chỉ sống khi panel tìm đang mở, đóng lại là mất.
   */
  onHintChange?: (h: PutawayHint | null) => void
}

/**
 * Pallet xuất KHÔNG hết → bắt khai hàng dư nằm ở đâu trước khi cho Lưu (user chốt 30/07).
 * Vì sao bắt buộc: luồng xuất trước đây không đụng `location_id`, pallet bị "mổ" vẫn ghi ở vị trí
 * cũ dù thực tế công nhân để khu tạm → lần sau tới đúng vị trí đó không có hàng.
 * Giữ 1 CHẠM cho trường hợp phổ biến (trả về chỗ cũ), tìm-trên-server khi cần chỗ khác
 * (danh mục vị trí vài nghìn dòng — không nạp hết vào máy quét).
 */
export function LeftoverLocationPicker({
  leftoverQty, mat, currentLocationCode, warehouseId, materialId, value, onChange, onHintChange,
}: Props) {
  const [picking, setPicking] = useState(false)
  const [term, setTerm] = useState('')
  const search = useDebouncedValue(term, 250)
  const { data: locs = [], isFetching } = useLocationsReal(
    { warehouse_id: warehouseId ?? undefined, search: search || undefined, limit: 30,
      // BE trả khối `putaway` từng dòng: ô "không đưa hàng vào" hiện nhãn ngay ở đây thay vì để
      // người quét chọn xong, bấm Lưu rồi mới ăn 422.
      // `putaway: 1` là bắt buộc chứ không thừa: dòng đơn xuất có thể CHƯA map được mã hàng
      // (`material_id` null) — chỉ dựa vào material_id thì đúng ca đó picker không hiện gì cả.
      // Thiếu mã thì luật phụ thuộc mã tự im, luật của Ô ("không đưa hàng vào", đầy…) vẫn chấm.
      material_id: materialId ?? undefined, putaway: 1 },
    picking && !!warehouseId,
  )
  const pick = (id: string, hint: PutawayHint | null) => { onChange(id); onHintChange?.(hint); setPicking(false) }
  const chosen = (locs as { id: string; location_code: string }[]).find(l => l.id === value)

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${value ? 'bg-slate-50 border-slate-200' : 'bg-amber-50 border-amber-300'}`}>
      {/* 1 dòng gọn: màn 360px trước đây vỡ thành 3 khúc ("Còn" tách khỏi số, "trên pallet" rớt dòng) */}
      <p className={`text-sm font-medium leading-snug flex items-baseline gap-1.5 ${value ? 'text-slate-700' : 'text-amber-800'}`}>
        <MapPin className="h-4 w-4 shrink-0 translate-y-0.5" />
        <span>Còn <strong className="whitespace-nowrap">{qtyLabel(leftoverQty, mat)}</strong> — để ở đâu?</span>
      </p>

      <div className="mt-2 grid grid-cols-2 gap-2">
        {/* Giữ chỗ cũ = không cất đi đâu ⇒ KHÔNG chấm luật cất (chặn ở đây là ngõ cụt) */}
        <button
          type="button"
          onClick={() => pick(KEEP_LOCATION, null)}
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
            {(locs as PutawayLocRow[]).map(l => {
              // Vị trí đã đầy vẫn HIỆN nhưng chặn chọn — BE (RPC khóa dòng) mới là trọng tài cuối.
              // Ô vi phạm luật cất KHÁC "đầy": vẫn chọn được (kho có thể chỉ cảnh báo), chỉ gắn
              // nhãn — dùng chung `PutawayOption` với 3 picker cất hàng bên Nhập, không vẽ lại.
              const full = (l.max_pallets ?? 0) > 0 && (l.used_slots ?? 0) >= (l.max_pallets ?? 0)
              return (
                <button
                  key={l.id}
                  type="button"
                  disabled={full}
                  onClick={() => pick(l.id, l.putaway ?? null)}
                  className={`w-full text-left px-2 py-2 flex items-center gap-2 ${
                    full ? 'text-slate-300 cursor-not-allowed' : 'hover:bg-sky-50'}`}
                >
                  <PutawayOption loc={l} />
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
