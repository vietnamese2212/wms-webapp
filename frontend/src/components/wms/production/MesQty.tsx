// Số lượng của MỘT mã trên màn MES: CON SỐ TRẦN (qtyNum — ĐVT in một lần ở cột / nhãn ô tổng) + DÒNG GỢI Ý quy cách bên dưới với mã
// cân / đong có quy cách gợi ý (đường trắng 1 bao = 20 kg ⇒ "45" và dòng nhỏ "2 bao + 5 kg"). User 27/11 (màn mẻ): "tôi chưa thấy mấy
// bao được hiển thị ở đây — phải nhìn được nó để còn đối chiếu với định mức". Mã khác: chỉ con số như cũ.
// Ô có NÚT bọc con số (Tồn kho bấm xem tồn): in qtyNum trong nút, đặt <QtyPackHintLine> NGOÀI nút (div trong nút inline-flex sẽ nằm ngang).
import { qtyNum } from '@/utils/unitCode'
import { QtyPackHintLine } from '@/components/shared/QtyText'
import type { MatUnits } from '@/utils/qtyUnits'

export function MesQty({ qty, mat }: { qty: number; mat?: MatUnits | null }) {
  return <>{qtyNum(qty, mat)}<QtyPackHintLine qty={qty} mat={mat} /></>
}
