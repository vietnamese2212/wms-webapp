// QtyText — số lượng của MỘT mã trong ô bảng. Mã thường: y hệt qtyLabel ("89 thùng + 24 hộp", "7.004,875 kg").
// Mã cân / đong có quy cách (đường trắng: 1 bao = 20 kg — 27/11, user: "110 kg có GỢI Ý là 5 bao 10 kg"):
// dòng trên là kg (số chính), dòng dưới nhỏ là gợi ý "5 bao + 10 kg" — hai dòng để ô hẹp không cắt chữ.
import { qtyLabel, qtyMainUnits, qtyPackHint, type MatUnits } from '@/utils/qtyUnits'

export function QtyText({ qty, mat, className = '' }: { qty: number; mat?: MatUnits | null; className?: string }) {
  const hint = qtyPackHint(qty, mat)
  if (!hint) return <span className={className}>{qtyLabel(qty, mat)}</span>
  return (
    <span className={`inline-flex flex-col items-end leading-tight ${className}`}>
      <span>{qtyLabel(qty, qtyMainUnits(mat))}</span>
      <span className="text-[9px] font-normal text-slate-400" data-testid="qty-pack-hint">{hint}</span>
    </span>
  )
}

/** Dòng gợi ý quy cách dưới một ô số (ô đang tự in số + đơn vị) — null với mã không phải mã cân / đong có quy cách. */
export function QtyPackHintLine({ qty, mat, className = '' }: { qty: number; mat?: MatUnits | null; className?: string }) {
  const hint = qtyPackHint(qty, mat)
  return hint ? <div className={`text-[9px] font-normal text-slate-400 leading-tight ${className}`} data-testid="qty-pack-hint">{hint}</div> : null
}
