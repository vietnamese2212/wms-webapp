// MODULE HỖ TRỢ (19/11 — user: "tạo module hỗ trợ, hướng dẫn MES chỉ là 1 hạng mục, sau này thêm hướng dẫn các công việc, module khác").
// Một BÀI hướng dẫn = dữ liệu thuần (không JSX) ⇒ thêm bài mới chỉ cần thêm một file trong `help/guides/` + một dòng ở `help/registry.ts`.
// Ảnh chụp màn hình đặt ở `public/guide/<id bài>/` (đuôi .jpg — không lọt vào bộ nhớ offline của PWA, xem vite.config globPatterns).
import type { ModuleKey } from '@/config/permissions'

/** Ảnh của một bước. phone = ảnh chụp điện thoại (hiển thị khổ hẹp, đặt cạnh nhau).
 *  w / h = kích thước điểm ảnh thật — trang GIỮ CHỖ đúng tỷ lệ trước khi ảnh tải xong, kẻo ảnh tải sau đẩy nội dung và
 *  cuộn tới một bước (#neo) dừng sai chỗ. Bỏ trống = khổ chụp chuẩn: máy tính 1280×800, điện thoại 780×1688 (390×844 @2x). */
export interface GuideImage { src: string; alt: string; phone?: boolean; w?: number; h?: number }

/** Một bước thao tác. text: mỗi phần tử một đoạn; đoạn bắt đầu bằng "- " là gạch đầu dòng; **đậm** được hỗ trợ. */
export interface GuideStep {
  title: string
  text: string[]
  images?: GuideImage[]
  /** ghi chú màu vàng (lưu ý / lỗi hay gặp) */
  note?: string
  /** ai làm bước này (vd "Trưởng ca", "QA") — hiện thành nhãn nhỏ */
  who?: string[]
}

export interface GuideSection {
  id: string           // neo trên URL (#id) — chữ thường, gạch nối
  title: string
  intro?: string
  steps: GuideStep[]
}

export interface Guide {
  id: string           // đường dẫn /help/<id>
  title: string
  category: string     // nhóm trên trang Hỗ trợ (vd "Sản xuất (MES)")
  summary: string
  /** bài chỉ hiện cho người có quyền xem module này (bỏ trống = ai cũng thấy) */
  module?: ModuleKey
  updated: string      // dd-mm-yyyy
  sections: GuideSection[]
}
