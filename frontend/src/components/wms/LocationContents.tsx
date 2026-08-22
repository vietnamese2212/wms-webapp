// "Ô đang chứa GÌ" — hiện dưới ô chọn vị trí sau khi CHỌN (user yêu cầu 17/08: "chọn vị trí thì
// có thể view được vị trí đó đang chứa gì"). Trước đó người cất chỉ thấy `12/20` và dấu ★, phải
// đoán: cùng mã hay khác mã? hàng trong ô cũ hay mới hơn pallet đang cầm? có pallet QA giữ không?
//
// Chỉ gọi API khi ĐÃ CHỌN 1 vị trí (1 request), KHÔNG kèm vào danh sách 300 dòng của ô tìm kiếm —
// ô nặng nhất staging có 69 mã, nhân 300 dòng là vài trăm KB mỗi lần gõ phím.
import { AlertTriangle, PackageCheck } from 'lucide-react'
import { useLocationContents } from '@/api/hooks'
import { qtyLabel } from '@/utils/qtyUnits'
import { formatDate } from '@/utils/formatters'

export function LocationContents({ locationId, highlightMaterialId }: {
  locationId?: string | null
  /** Mã đang nhập — dòng của mã này tô xanh + ghim đầu (chính là lý do ★ "gom cùng mã") */
  highlightMaterialId?: string | null
}) {
  const { data, isLoading } = useLocationContents(locationId)
  if (!locationId) return null
  if (isLoading) return <p className="mt-1 text-[10px] text-slate-400">Đang xem vị trí…</p>
  if (!data) return null

  const rows = [...data.materials].sort((a, b) =>
    (b.material_id === highlightMaterialId ? 1 : 0) - (a.material_id === highlightMaterialId ? 1 : 0) || b.pallets - a.pallets)
  const full = data.max_pallets > 0 && data.pallets >= data.max_pallets

  return (
    <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
      <div className="flex items-center gap-1.5 text-[10px]">
        <span className="font-medium text-slate-600">Đang chứa</span>
        <span className={`font-semibold tabular-nums ${full ? 'text-blue-700' : 'text-slate-700'}`}>
          {data.pallets}/{data.max_pallets || '—'} pallet
        </span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-500">{data.materials.length} mã</span>
        {data.qa_hold > 0 && (
          <span className="ml-auto inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">
            <AlertTriangle className="h-2.5 w-2.5" />{data.qa_hold} pallet QA giữ
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="mt-1 text-[10px] text-slate-400">Ô đang TRỐNG.</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {rows.slice(0, 6).map(m => {
            const same = m.material_id === highlightMaterialId
            return (
              // Điện thoại: nhồi mã + tên + 3 con số vào MỘT dòng thì tên hàng cụt còn ngày SX bị
              // đẩy khỏi màn (user báo 22/08 "nhìn không đủ để xem được"). Cho cụm số xuống dòng
              // riêng ở mobile (`basis-full`), desktop vẫn 1 dòng ghim phải như cũ.
              <li key={m.material_id} className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] ${same ? 'text-emerald-700' : 'text-slate-600'}`}>
                {same && <PackageCheck className="h-3 w-3 shrink-0" />}
                <span className="font-mono font-semibold shrink-0">{m.material_code ?? '—'}</span>
                <span className="min-w-0 flex-1 text-slate-400 break-words sm:truncate">{m.short_name ?? ''}</span>
                <span className="flex basis-full items-center gap-1.5 sm:ml-auto sm:basis-auto sm:shrink-0">
                  <span className="tabular-nums">{m.pallets} pl</span>
                  <span className="tabular-nums text-slate-400">
                    {qtyLabel(m.qty_base, { base_unit: m.base_unit, entry_unit: m.entry_unit, units_per_carton: m.units_per_carton })}
                  </span>
                  {m.date_min && (
                    <span className="text-slate-400">
                      {m.date_kind ?? ''} {formatDate(m.date_min)}{m.date_max && m.date_max !== m.date_min ? `→${formatDate(m.date_max)}` : ''}
                    </span>
                  )}
                </span>
              </li>
            )
          })}
          {rows.length > 6 && <li className="text-[10px] text-slate-400">… và {rows.length - 6} mã khác</li>}
        </ul>
      )}
    </div>
  )
}
