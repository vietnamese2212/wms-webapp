// BÀI HƯỚNG DẪN: Tồn kho — tìm, lọc, xem chi tiết pallet, giữ / mở QA, NCC, chuyển vị trí, điều chỉnh tồn, Excel (19/11).
// Ảnh chụp trên Preview bằng tài khoản chức danh "Phó phòng QA", kho Chế biến Ba Vì; 3 pallet mẫu Đường trắng L2611 và mọi
// thao tác trên chúng đã xoá / trả về sau khi chụp. Ảnh ở public/guide/ton-kho/. Đổi giao diện Tồn kho ⇒ chụp lại + sửa chữ.
import type { Guide, GuideImage } from '../types'

const d = (file: string, alt: string): GuideImage => ({ src: `/guide/ton-kho/${file}.jpg`, alt })
const m = (file: string, alt: string): GuideImage => ({ src: `/guide/ton-kho/${file}.jpg`, alt, phone: true })

export const TON_KHO_GUIDE: Guide = {
  id: 'ton-kho',
  title: 'Tồn kho: kiểm tra tồn, giữ QA, chuyển vị trí, điều chỉnh',
  category: 'Kho (WMS)',
  module: 'inventory',
  updated: '19-11-2026',
  summary: 'Xem tồn từng pallet hoặc tổng theo mã, đọc hạn dùng / %Date, giữ và mở QA, gán NCC, chuyển vị trí (máy tính và điện thoại), điều chỉnh số lượng, lịch sử pallet, xuất Excel.',
  sections: [
    {
      id: 'bat-dau',
      title: 'Bắt đầu',
      steps: [
        {
          title: 'Mở trang Tồn kho',
          text: [
            'Máy tính: menu trái **Báo cáo → Tồn kho**. Điện thoại: ☰ → Báo cáo → Tồn kho.',
            'Mặc định trang lọc sẵn kho và loại hàng của bạn, chỉ hiện pallet **còn tồn**.',
          ],
          images: [d('01-menu', 'Menu Báo cáo → Tồn kho')],
        },
        {
          title: 'Đọc danh sách',
          text: [
            '- Mỗi dòng là **một pallet** (một tem). Dải số trên cùng: **Pallet** (số pallet còn hàng) · **SL (quy đổi)** · **Đang chọn**.',
            '- **Tồn** = còn trên pallet; **Khả dụng** = tồn trừ phần đang giữ chỗ cho việc khác.',
            '- Hàng tính theo kg ghi "kilogram"; hàng có thùng ghi "N thùng + M hộp".',
            '- **Dòng chữ đỏ** = pallet đang bị QA giữ. **Chữ cam** = %Date dưới 80%, **chữ tím** = dưới 60% (hàng đã cũ, ưu tiên dùng trước).',
          ],
          images: [d('02-danh-sach', 'Danh sách tồn kho: dải số và cột Khả dụng'), m('08-m-danh-sach', 'Danh sách trên điện thoại, nút Lọc')],
        },
      ],
    },
    {
      id: 'tim-loc',
      title: 'Tìm và lọc',
      steps: [
        {
          title: 'Tìm theo mã hàng, tem, vị trí',
          text: [
            'Gõ vào ô **Tìm pallet, mã/tên hàng, vị trí…** (vd 210000262, hoặc một phần mã tem). Biểu tượng quét trong ô dùng camera đọc tem; biểu tượng quét bên cạnh đọc **tem vị trí** để lọc theo ô.',
          ],
          images: [d('03-tim', 'Tìm 210000262')],
        },
        {
          title: 'Thêm lọc',
          text: [
            'Bấm **+ Thêm lọc**: Tình trạng · Tên hàng · Vị trí · **QA Status** · Lot · NMSX · **% Date** · NCC · Ngày nhập. Điện thoại: nút **Lọc** → chọn → **Xem kết quả**.',
            'Bộ lọc hay dùng nhiều lần thì lưu lại ở **Views → Lưu bộ lọc hiện tại**.',
          ],
          images: [d('04-them-loc', 'Menu Thêm lọc, mục QA Status')],
        },
        {
          title: 'Xem tổng theo mã hàng',
          text: ['Bấm **Tổng hợp**: mỗi dòng là một mã × kho × ngày sản xuất, cộng tồn và số pallet. Bấm một dòng để quay về từng pallet của mã đó; bấm Tổng hợp lần nữa để tắt.'],
          images: [d('05-tong-hop', 'Chế độ Tổng hợp theo mã')],
        },
      ],
    },
    {
      id: 'chi-tiet',
      title: 'Chi tiết một pallet',
      steps: [
        {
          title: 'Mở chi tiết pallet',
          text: [
            'Bấm vào dòng: khung bên phải (điện thoại: toàn màn hình) ghi đủ thông tin.',
            '- **Ngày / Hạn dùng**: Ngày SX · HSD (ngày) · NCC · **% Date còn**.',
            '- **Thông số tem**: Kho SX · **Lot** · **NCC** · Số pallet — đọc từ tem.',
            '- **Nhập kho · Cập nhật · Kiểm kê**: ai làm, lúc nào.',
          ],
          images: [d('06-chi-tiet', 'Khung chi tiết pallet: Ngày / Hạn dùng, Thông số tem'), m('09-m-chi-tiet', 'Chi tiết pallet trên điện thoại')],
        },
        {
          title: 'Lịch sử pallet',
          text: ['Trong khung chi tiết bấm **Lịch sử pallet**: mọi tác động lên tem này theo thời gian — vào sổ tồn, chuyển vị trí, kiểm kê, điều chỉnh, dồn / tách, cấp vào mẻ, xuất hàng — kèm người làm.'],
          images: [d('07-lich-su-pallet', 'Lịch sử pallet: Vào sổ tồn')],
        },
      ],
    },
    {
      id: 'qa',
      title: 'Giữ / mở QA',
      intro: 'Pallet bị giữ QA (mã khác OK) không được cấp vào mẻ, không được xuất, không được chỉ đường lấy hàng cho tới khi QA mở.',
      steps: [
        {
          title: 'Chọn pallet',
          text: ['Tích ô vuông đầu dòng (chọn được nhiều pallet). Thanh thao tác hiện ở cuối màn: **QA Status** · NCC · Vị trí · Mã hàng · Ngày SX · Tách / Dồn.'],
          images: [d('10-chon-pallet', 'Tích pallet, thanh thao tác, nút QA Status')],
        },
        {
          title: 'Giữ QA',
          text: [
            'Bấm **QA Status** → chọn mã giữ (**X – X**, **XCQ – X cảm quan**, **X7 – X 7 ngày**) → **Cập nhật**.',
            'Pallet chuyển **chữ đỏ** trên danh sách.',
          ],
          images: [d('11-giu-qa', 'Khung Cập nhật QA Status: chọn X – X'), d('12-da-giu', 'Pallet đang giữ QA hiện chữ đỏ')],
        },
        {
          title: 'Mở QA (trên điện thoại)',
          text: [
            'Tích pallet → thanh thao tác → **⋮** → **QA Status** → chọn **OK** → **Cập nhật**.',
            'Máy tính làm giống như giữ QA, chỉ chọn OK.',
          ],
          images: [m('17-m-thao-tac', 'Điện thoại: ⋮ → QA Status'), m('18-m-mo-qa', 'Chọn OK → Cập nhật')],
        },
        {
          title: 'Gán NCC (hạn dùng theo NCC)',
          text: ['Pallet thiếu NCC hoặc sai NCC: tích pallet → **NCC** → chọn NCC (số ngày trong ngoặc là HSD riêng của NCC đó) → **Cập nhật**. HSD và %Date của pallet tính lại theo NCC.'],
          images: [d('13-ncc', 'Khung Sửa NCC hàng loạt')],
        },
      ],
    },
    {
      id: 'vi-tri',
      title: 'Chuyển vị trí',
      steps: [
        {
          title: 'Trên máy tính',
          text: ['Tích pallet → **Vị trí** → chọn ô mới trong danh sách (★ = ô nên cất; ô đầy bị mờ) → **Chuyển**.'],
          images: [d('14-chuyen-vi-tri', 'Chọn ô CBBV_X1_LANH1 → Chuyển')],
        },
        {
          title: 'Bằng điện thoại khi đang đứng ở kho',
          text: [
            'Menu **Hàng trong kho → Chuyển vị trí**. Quét (hoặc gõ) tem pallet → thẻ pallet hiện tồn và **Vị trí hiện tại**.',
            '**Vị trí mới***: chọn ô hoặc bấm biểu tượng quét để quét tem ô → **Chuyển vị trí**.',
            'Chuyển bằng cách quét tại chỗ được tính luôn là một lượt kiểm kê pallet đó.',
          ],
          images: [m('19-m-chuyen-vi-tri', 'Chuyển vị trí trên điện thoại'), m('20-m-da-chuyen', 'Đã chuyển LANH1 → TEST1')],
        },
      ],
    },
    {
      id: 'dieu-chinh',
      title: 'Điều chỉnh số lượng',
      steps: [
        {
          title: 'Điều chỉnh tồn một pallet',
          text: [
            'Mở chi tiết pallet → **Điều chỉnh tồn** → nhập số **thêm (+) hoặc bớt (−)**, vd **-5** khi rách bao hao hụt 5 kg → ghi lý do → **Xác nhận**.',
            'App hiện "Tồn mới" trước khi xác nhận. Không điều chỉnh âm quá số đang có.',
            'Xem lại các lần điều chỉnh: **Xem lịch sử điều chỉnh** trong khung chi tiết (ai, lúc nào, trước → sau, lý do).',
          ],
          images: [d('15-dieu-chinh', 'Ô điều chỉnh -5 và nút Xác nhận'), d('16-da-dieu-chinh', 'Lịch sử điều chỉnh của pallet')],
          note: 'Kiểm kê thấy lệch thì điều chỉnh ở đây — lưu số kiểm kê không tự sửa tồn.',
        },
      ],
    },
    {
      id: 'excel',
      title: 'Xuất / nạp Excel (máy tính)',
      steps: [
        {
          title: 'Xuất Excel, nạp tồn đầu kỳ',
          text: [
            'Biểu tượng **mũi tên xuống** = **Excel**: xuất chi tiết pallet đúng theo bộ lọc đang áp.',
            'Biểu tượng **mũi tên lên** = **Upload**: nạp tồn đầu kỳ từ file mẫu. App kiểm file trước, chỉ ghi khi bạn bấm Xác nhận; nguyên liệu (RM01) bắt buộc có cột NCC.',
          ],
          images: [d('21-excel', 'Nút Excel và Upload')],
        },
      ],
    },
    {
      id: 'hoi-dap',
      title: 'Lỗi hay gặp',
      steps: [
        { title: 'Bảng trống "Không tìm thấy pallet nào"', text: ['Bộ lọc đang hẹp quá (sai kho, loại, vị trí). Bấm "Xóa bộ lọc" rồi tìm lại. Có băng đỏ phía trên bảng (vd từ khoá quá chung) thì làm theo câu báo — gõ cụ thể hơn.'] },
        { title: '"Tồn kho không thể âm"', text: ['Số bớt lớn hơn số đang có trên pallet. Kiểm lại số thực tế.'] },
        { title: '"Pallet không thuộc kho trong phạm vi của bạn"', text: ['Pallet ở kho bạn không được giao. Nhờ người phụ trách kho đó.'] },
        { title: '"Vị trí đích thuộc KHO KHÁC…" / "Vị trí … không đủ chỗ"', text: ['Chỉ chuyển được trong cùng kho; ô đầy thì chọn ô khác.'] },
        { title: '"Ứng dụng phiên bản cũ… tải lại trang"', text: ['App vừa cập nhật. Tải lại trang (máy tính Ctrl+R, điện thoại kéo xuống) rồi làm lại.'] },
      ],
    },
  ],
}
