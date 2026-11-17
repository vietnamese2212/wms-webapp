// ĐVT IN BẰNG MÃ CỦA DANH MỤC ĐƠN VỊ TÍNH (KG · L · BAG …) cho các màn Sản xuất (MES).
// User 17/11 (ảnh màn mẻ trên điện thoại): "hạn chế dùng văn viết, và dùng đơn vị tính của app". Mã ĐVT là thứ người dùng thấy ở
// Mã hàng (Base Unit), ở SAP và ở màn Bồn; nhãn dài của danh mục ("kilogram") lặp sau MỖI con số biến một dòng nguyên liệu thành câu văn.
// Quy ước cho màn MES:
//   • bảng / lưới số: CON SỐ TRẦN (`qtyNum`) + ĐVT in MỘT lần — cột ĐVT (`matUnitCode`) hoặc nhãn ô tổng "Kế hoạch (KG)" (`unitCode`);
//   • chỗ buộc phải in liền (câu báo sau khi cấp, gợi ý trong ô chọn, hộp xác nhận): `qtyCode` → "50 KG".
//   • Mã có quy cách thùng vẫn in "N thùng + M hộp" (chuẩn hiển thị chung của app — qtyLabel), cột ĐVT ghi "HOP/CAR" như trang Mã hàng.
import { hasEntry, qtyLabel, type MatUnits } from './qtyUnits'

const nf = (n: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(n)

/** Mã ĐVT để in (KG, L, BAG) — trống ⇒ "" */
export const unitCode = (code?: string | null): string => (code ?? '').trim().toUpperCase()

/** Cột ĐVT của một mã hàng: "KG" · mã có quy cách thùng "HOP/CAR" (giống cột ĐVT ở trang Mã hàng) */
export function matUnitCode(m?: MatUnits | null): string {
  const b = unitCode(m?.base_unit)
  return hasEntry(m) ? `${b}/${unitCode(m!.entry_unit)}` : b
}

/** Số cho ô đã có ĐVT in riêng: mã không quy cách thùng ⇒ con số trần "374,167"; mã có thùng ⇒ "N thùng + M hộp" */
export function qtyNum(qty: number, m?: MatUnits | null): string {
  const q = Number(qty)
  if (!isFinite(q)) return '—'
  return hasEntry(m) ? qtyLabel(q, m) : nf(q)
}

/** Số kèm mã ĐVT cho chỗ in liền trong câu: "50 KG" (mã có thùng ⇒ "N thùng + M hộp") */
export function qtyCode(qty: number, m?: MatUnits | null): string {
  const q = Number(qty)
  if (!isFinite(q)) return '—'
  if (hasEntry(m)) return qtyLabel(q, m)
  const u = unitCode(m?.base_unit)
  return u ? `${nf(q)} ${u}` : nf(q)
}
