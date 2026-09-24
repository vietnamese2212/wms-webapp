// MỘT symbol QUÉT cho TOÀN APP (user chốt 21/08: "mỗi chỗ 1 icon là k đc").
//
// Trước đó hành động quét đang mang 3 icon khác nhau — `QrCode` (~25 chỗ), `ScanLine` (Sổ đóng gói),
// `ScanBarcode` (tem thùng) — nên cùng một việc mà mỗi màn nhìn một kiểu, người dùng phải học lại
// nút ở từng trang.
//
// Vì sao `ScanLine` chứ không `QrCode`: app quét CẢ tem QR, mã vạch 1D (từ 21/08) và tem vị trí ⇒
// icon hình QR nói sai việc ở phần lớn trường hợp.
//
// Ranh giới — ĐỪNG gộp 3 thứ này làm một:
//   · HÀNH ĐỘNG QUÉT            → `ScanIcon` (file này)
//   · nói về TEM QR (vật phẩm)  → `QrCode` (trang In tem pallet, cờ "không theo dõi QR")
//   · CHỤP ẢNH                  → `Camera` (check list xe nâng, ảnh chữ in phun Sổ đóng gói)
export { ScanLine as ScanIcon } from 'lucide-react'
