// Dòng nhắc dưới ô "Mã bán thành phẩm" khi danh mục CHƯA có mã BTP nào (C117, 16/11): người mở mẻ thấy ngay vì sao ô trống
// và đi đâu để khai, thay vì tưởng app hỏng. Lối tắt sang Mã hàng chỉ hiện khi người xem mở được trang đó (useCanSeePath).
import { Link } from 'react-router-dom'
import { useCanSeePath } from '@/hooks/useCanSeePath'

export function NoSemiFinishedHint() {
  const canSee = useCanSeePath()
  return (
    <p className="text-[11px] text-amber-700 mt-1 leading-snug">
      Chưa có mã bán thành phẩm nào. Mỗi loại dịch trộn (vd Dịch sữa chua uống dâu) cần một mã ở{' '}
      {canSee('/masterdata/materials')
        ? <Link to="/masterdata/materials" className="underline font-medium">Mã hàng</Link>
        : <b>Mã hàng</b>}
      {' '}có tích ô "Bán thành phẩm", đơn vị L hoặc KG.
    </p>
  )
}
