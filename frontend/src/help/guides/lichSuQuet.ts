// BÀI HƯỚNG DẪN: Lịch sử quét (xuất kho) (19/11). Ảnh chụp trên Preview bằng tài khoản chức danh "Phó phòng QA", kho Chế biến
// Ba Vì (kho chế biến không xuất theo chuyến nên trang trống — bài nói rõ điều đó). Ảnh ở public/guide/lich-su-quet/.
import type { Guide, GuideImage } from '../types'

const d = (file: string, alt: string): GuideImage => ({ src: `/guide/lich-su-quet/${file}.jpg`, alt })
const m = (file: string, alt: string): GuideImage => ({ src: `/guide/lich-su-quet/${file}.jpg`, alt, phone: true })

export const LICH_SU_QUET_GUIDE: Guide = {
  id: 'lich-su-quet',
  title: 'Lịch sử quét xuất kho',
  category: 'Báo cáo',
  module: 'scanlog',
  updated: '19-11-2026',
  summary: 'Tra từng lượt quét tem khi xuất hàng lên xe: pallet nào, lên xe nào, ai quét, có lấy đúng thứ tự date không.',
  sections: [
    {
      id: 'xem',
      title: 'Xem lịch sử quét',
      intro: 'Trang này chỉ ghi các lượt quét khi **xuất hàng theo chuyến** (Xuất kho). Lượt quét khi nhập kho xem ở phiếu nhập; kiểm kê ở Kiểm kê → Lịch sử kiểm; cấp nguyên liệu vào mẻ ở Truy xuất lô → Sản xuất hoặc Báo cáo NVL. Kho chế biến không xuất theo chuyến nên trang thường trống.',
      steps: [
        {
          title: 'Mở trang, chọn Kho và Loại hàng',
          text: [
            'Menu **Báo cáo → Lịch sử quét**. Phải chọn đủ **Kho** và **Loại hàng** (+ Thêm lọc → Loại hàng) thì bảng mới tải. Ngày mặc định là hôm nay.',
            'Lọc thêm: Số xe · NPP · Số DO · **Mã pallet** · **Người quét** · Thứ tự lấy (đúng / sai thứ tự date).',
          ],
          images: [d('01-trang', 'Trang Lịch sử quét khi chưa chọn Loại hàng'), d('02-chon-loai', 'Đã chọn Kho + Loại hàng RM01: không có lượt quét')],
        },
        {
          title: 'Tra nhanh một tem / số xe / DO',
          text: [
            'Gõ hoặc quét vào ô **Truy cứu…** (từ 2 ký tự) — app tìm ngay trong mọi kho được giao, không cần chọn Kho / Loại hàng.',
            'Cột đáng xem: **Thứ tự lấy** ("⚠ Sai" = lấy không đúng thứ tự date), **% Date**, **Người quét**, **TG quét**. Máy tính: nút **Excel** xuất kết quả đang lọc.',
          ],
          images: [m('03-m-truy-cuu', 'Ô Truy cứu trên điện thoại')],
        },
        {
          title: 'Lỗi hay gặp',
          text: [
            '- "Vui lòng chọn Kho và Loại hàng…": thêm bộ lọc Loại hàng, hoặc gõ vào ô Truy cứu.',
            '- "Khoảng lọc quá rộng…": thu hẹp khoảng ngày hoặc chọn một kho.',
            '- "Quá nhiều dòng … Hãy lọc hẹp lại rồi xuất": file Excel tối đa 50.000 dòng.',
          ],
        },
      ],
    },
  ],
}
