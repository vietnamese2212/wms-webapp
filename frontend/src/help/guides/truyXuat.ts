// BÀI HƯỚNG DẪN: Truy xuất lô — tem pallet ⇄ khách, tem nguyên liệu ⇄ mẻ ⇄ thành phẩm, truy xuất theo thùng (19/11).
// Ảnh chụp trên Preview bằng tài khoản chức danh "Phó phòng QA" (chỉ đọc; hồ sơ truy xuất theo thùng KHÔNG lưu). Mẻ trong ảnh
// là mẻ thật B260001BD62 của Chế biến Ba Vì. Ảnh ở public/guide/truy-xuat/. Đổi giao diện ⇒ chụp lại + sửa chữ ở đây.
import type { Guide, GuideImage } from '../types'

const d = (file: string, alt: string): GuideImage => ({ src: `/guide/truy-xuat/${file}.jpg`, alt })
const m = (file: string, alt: string): GuideImage => ({ src: `/guide/truy-xuat/${file}.jpg`, alt, phone: true })

export const TRUY_XUAT_GUIDE: Guide = {
  id: 'truy-xuat',
  title: 'Truy xuất lô: nguyên liệu ⇄ mẻ ⇄ thành phẩm ⇄ khách',
  category: 'Báo cáo',
  module: 'traceability',
  updated: '19-11-2026',
  summary: 'Tra một tem / lô đang ở đâu, đã giao cho ai; từ tem nguyên liệu tìm mẻ đã dùng nó và ngược lại; truy xuất từ thùng thực tế khi có khiếu nại.',
  sections: [
    {
      id: 'lo',
      title: 'Tra một tem / lô hàng',
      steps: [
        {
          title: 'Mở trang, chọn chiều',
          text: [
            'Menu **Báo cáo → Truy xuất lô**. Hai chiều:',
            '- **Xuôi: lô hàng → khách**: từ tem / mã hàng / ngày SX tìm hàng đã giao đi đâu và còn ở đâu.',
            '- **Ngược: khách → lô hàng**: từ khách / số xe / ngày giao tìm lô đã giao.',
            'Chưa chọn gì thì trang hiện bảng hướng dẫn từng ô lọc và cách đọc tem.',
          ],
          images: [d('01-menu', 'Trang Truy xuất lô, chiều Xuôi')],
        },
        {
          title: 'Tra theo tem pallet',
          text: [
            'Chiều Xuôi → ô **Tem pallet** → gõ cả mã tem, hoặc phần đầu mã (ít nhất 4 ký tự, vd "191126_210000262_L2611" = mọi pallet Đường trắng Lot L2611 sản xuất 19/11/26) → chọn dòng **Tiền tố …**.',
            'Kết quả: **Đã giao đi đâu** (khách, xe, số DO) và **Còn trong kho** (kho, vị trí, còn lại). Nguyên liệu ở kho chế biến không giao khách nên chỉ có phần Còn trong kho; nguyên liệu đã vào mẻ nào thì xem mục dưới.',
          ],
          images: [d('02-xuoi-tem', 'Tra tiền tố tem: 4 pallet còn trong kho')],
        },
      ],
    },
    {
      id: 'san-xuat',
      title: 'Nguyên liệu ⇄ mẻ ⇄ thành phẩm',
      steps: [
        {
          title: 'Từ tem nguyên liệu tìm mẻ',
          text: [
            'Bấm biểu tượng **Sản xuất** (hình nhà máy, góc phải trên) → hộp **Truy xuất sản xuất** → chọn **Tem nguyên liệu** → gõ / dán / quét mã tem → **Tra**.',
            'Mỗi mẻ đã dùng tem này hiện một thẻ: mã lô mẻ (bấm để mở mẻ), BTP, ngày SX, QA của mẻ; bảng **Nguyên liệu vào mẻ** (dòng tô vàng = tem đang tra) và **Đã đóng gói** (các tem thành phẩm đi ra từ mẻ).',
            'Phải nhập **đúng mã tem** (không phải số lô của NCC).',
          ],
          images: [d('03-nvl-vao-me', 'Tem dầu cọ đã vào mẻ B260001BD62')],
        },
        {
          title: 'Từ mã lô mẻ / tem thành phẩm',
          text: [
            '- **Mã lô bán thành phẩm** (vd B260001BD62): ra đủ nguyên liệu đã cấp vào mẻ.',
            '- **Tem thành phẩm**: ra mẻ (hoặc các mẻ cùng bồn) làm ra tem đó và nguyên liệu của chúng. Bấm một tem thành phẩm trong thẻ để tra tiếp tới khách / xe.',
          ],
          images: [d('04-ma-lo-btp', 'Tra mã lô B260001BD62')],
        },
        {
          title: 'Trên điện thoại',
          text: ['Nút **Sản xuất** nằm trong nút **⋮** ở góc phải trên.'],
          images: [m('05-m-san-xuat', 'Điện thoại: ⋮ → Sản xuất')],
        },
      ],
    },
    {
      id: 'theo-thung',
      title: 'Truy xuất theo thùng (khi có khiếu nại)',
      steps: [
        {
          title: 'Bắt đầu một lượt truy xuất',
          text: ['Tab **Truy xuất theo thùng** liệt kê các lượt đã làm (ai, lúc nào, kết luận). Bấm **Truy xuất mới**.'],
          images: [d('06-theo-thung', 'Danh sách truy xuất theo thùng, nút Truy xuất mới')],
        },
        {
          title: 'Nhập thông số in phun trên thùng',
          text: [
            'Điền **Ngày SX**, **Giờ SX**, **Máy sản xuất**, **Chu kỳ** in phun trên thùng (Kho SX, Mã hàng không bắt buộc). Có thể **Thêm ảnh** thùng.',
            'App liệt kê các trang **Sổ đóng gói** khớp (cùng máy, chu kỳ, lệch ±3 ngày). Chọn đúng trang sổ.',
          ],
          images: [d('07-thung-form', 'Ngày 20/09/2026, máy 101, chu kỳ N20: 2 trang sổ khớp')],
        },
        {
          title: 'Xem hành trình, lưu hồ sơ',
          text: [
            'Bấm **Truy xuất hành trình**: từng pallet của trang sổ đi qua những bước nào (đóng gói → nhập kho → giao khách / còn tồn), ★ = pallet chứa giờ in phun.',
            'Ghi **Bối cảnh** (ai khiếu nại, khiếu nại gì) và **Kết luận** rồi bấm **Lưu hồ sơ truy xuất**.',
          ],
          images: [d('08-hanh-trinh', 'Hành trình 27 pallet của trang sổ, nút Lưu hồ sơ truy xuất')],
        },
      ],
    },
    {
      id: 'hoi-dap',
      title: 'Lỗi hay gặp',
      steps: [
        { title: '"Tiền tố tem pallet cần ít nhất 4 ký tự"', text: ['Gõ dài hơn, vd 6 số ngày SX + "_" + mã hàng.'] },
        { title: '"Không tìm thấy mẻ chế biến nào gắn với …"', text: ['Tem nguyên liệu chưa được cấp vào mẻ nào, hoặc gõ số lô NCC thay vì mã tem. Gõ đúng mã tem in trên pallet.'] },
        { title: '"Không có sổ đóng gói nào của máy …"', text: ['Kiểm lại máy và chu kỳ đọc trên thùng (in phun hay bị mờ), thử ngày lân cận.'] },
        { title: 'Chỉ thấy hàng của kho mình', text: ['Tra tem / lô chỉ trong kho được giao (và kho chế biến trực thuộc). Hành trình theo thùng thì đi qua mọi kho.'] },
      ],
    },
  ],
}
