// BÀI HƯỚNG DẪN: In tem pallet — sinh tem mới cho NVL / bao bì, in lại, lịch sử in, truy cứu (19/11).
// Ảnh chụp trên Preview bằng tài khoản chức danh "Phó phòng QA"; 4 tem mẫu Đường trắng Lot L2611 (NCC Thành Thành Công)
// và lịch sử in của chúng đã xoá sau khi chụp. Ảnh ở public/guide/in-tem/. Đổi giao diện In tem ⇒ chụp lại + sửa chữ.
import type { Guide, GuideImage } from '../types'

const d = (file: string, alt: string): GuideImage => ({ src: `/guide/in-tem/${file}.jpg`, alt })
const m = (file: string, alt: string): GuideImage => ({ src: `/guide/in-tem/${file}.jpg`, alt, phone: true })

export const IN_TEM_GUIDE: Guide = {
  id: 'in-tem',
  title: 'In tem pallet nguyên liệu, bao bì',
  category: 'Kho (WMS)',
  module: 'pallet_print',
  updated: '19-11-2026',
  summary: 'Sinh tem QR cho pallet hàng NCC (Lot · NCC · nơi nhận), in lại tem bị rách / mất, xem ai đã in tem nào, lúc nào.',
  sections: [
    {
      id: 'bat-dau',
      title: 'Bắt đầu',
      intro: 'Mỗi pallet nguyên liệu / bao bì cần một tem QR để quét khi nhập kho, cấp NVL vào mẻ, kiểm kê. In tem chỉ tạo tem — pallet chỉ vào tồn khi được quét nhập kho.',
      steps: [
        {
          title: 'Mở trang In tem pallet',
          text: [
            'Menu trái **Kho (WMS) → Hàng trong kho → In tem pallet**. Điện thoại: ☰ → Hàng trong kho → In tem pallet.',
            'Trang có 4 tab: **Sinh tem mới** · **Lịch sử in** · **In lại từ tồn kho** · **Truy cứu**.',
            'Nút **In** chỉ có trên **máy tính** (in ra máy in A4). Điện thoại dùng để tra cứu.',
          ],
          images: [d('01-menu', 'Trang In tem pallet và 4 tab'), m('02-m-menu', 'Menu In tem pallet trên điện thoại')],
        },
      ],
    },
    {
      id: 'sinh-tem',
      title: 'Sinh tem mới',
      intro: 'Ví dụ: 4 pallet Đường trắng nhận từ NCC Thành Thành Công, Lot L2611, mỗi pallet 1.000 kg.',
      steps: [
        {
          title: 'Chọn loại hàng, ngày SX, mã hàng',
          text: [
            '- **Loại hàng**: chọn **RM01** (nguyên liệu) hoặc **PK01** (bao bì). Hai loại này là hàng NCC nên form hỏi **Lot** và **NCC** (thay cho Chu kỳ · Máy của thành phẩm).',
            '- **Ngày SX***: ngày sản xuất in trên bao / chứng từ NCC.',
            '- **Mã hàng***: gõ mã hoặc tên rồi chọn. Dưới ô hiện tên tắt và số trên một pallet.',
          ],
          images: [d('03-chon-ma', 'Chọn Loại hàng RM01 và mã 210000262 Đường trắng')],
        },
        {
          title: 'Lot, NCC, nơi nhận, số tem',
          text: [
            '- **Lot***: số lô của NCC (in trên bao).',
            '- **NCC***: nhà cung cấp. Tem in tên NCC; mã QR mang mã NCC — lúc nhập kho app tự gắn NCC và hạn dùng theo NCC cho pallet.',
            '- **Nơi nhận (NMSX)***: kho nhận hàng (vd **B — Kho Ba Vì**).',
            '- **Seq đầu**: số pallet đầu tiên (thường 1). **Số pallet**: số tem cần in. **SL/pallet**: app tự điền theo Mã hàng, sửa nếu pallet không đầy.',
            'Bên phải hiện trước 4 tem một trang A4. Trùng số pallet đã có trong kho thì app báo vàng — đổi **Seq đầu**.',
          ],
          images: [d('04-lot-ncc-nmsx', 'Lot L2611, NCC Thành Thành Công, Nơi nhận B — Kho Ba Vì')],
        },
        {
          title: 'Kiểm tra tem rồi bấm In',
          text: [
            'Xem lại trên tem: Ngày · Mã · Số lượng · Tên gói tắt, ô cuối **Lot | NCC | Số pallet**.',
            'Bấm **In (4)** ở góc phải trên. Hộp in của trình duyệt mở ra: chọn khổ **A4**, lề **Không (None)**, tỷ lệ **100%**.',
            'Dán mỗi tem lên đúng pallet có số pallet đó.',
          ],
          images: [d('05-xem-truoc', 'Xem trước 4 tem, nút In (4)'), d('11-da-in-chua', 'Hộp in đóng: Tem đã in ra giấy chưa? — Đã in / Chưa in')],
          note: 'Bấm In là app ghi Lịch sử in. Hộp in đóng lại, app hỏi "Tem đã in ra giấy chưa?" — đã bấm Huỷ hoặc máy in không ra tem thì chọn "Chưa in" để lần này không tính vào lịch sử.',
        },
        {
          title: 'Trên điện thoại',
          text: ['Điện thoại xem được form và bản xem trước nhưng không có nút In. Chưa chọn Loại hàng thì form hỏi Chu kỳ · Máy; chọn RM01 / PK01 thì đổi thành Lot · NCC.'],
          images: [m('06-m-sinh-tem', 'Form sinh tem trên điện thoại')],
        },
      ],
    },
    {
      id: 'in-lai',
      title: 'In lại, lịch sử in, truy cứu',
      steps: [
        {
          title: 'In lại tem pallet đang có trong kho',
          text: [
            'Tab **In lại từ tồn kho** (tem rách, mất). Gõ mã pallet vào ô **Quét / nhập mã pallet** rồi Enter, hoặc bấm **Quét QR**. Chọn được nhiều pallet.',
            'Pallet đã từng in hiện nhãn "đã in N" — in lại là có hai tem cùng mã, nhớ bỏ tem cũ.',
            'Bấm **In lại (N)**.',
          ],
          images: [d('09-in-lai', 'In lại tem một pallet Đường trắng')],
        },
        {
          title: 'Lịch sử in',
          text: [
            'Tab **Lịch sử in** → **+ Thêm lọc → Khoảng ngày** → chọn ngày (hoặc **Hôm nay**). Mỗi dòng là một lần bấm In: lúc nào, mấy tem, mã hàng, Lot, NCC, ai in.',
            'Bấm vào dòng để xem từng tem; tích dòng hoặc từng tem rồi bấm **In lại (N)** để in lại đúng các tem đó.',
          ],
          images: [d('07-lich-su', 'Chọn Khoảng ngày ở Lịch sử in'), d('08-lich-su-chi-tiet', 'Chi tiết 4 tem của lần in')],
        },
        {
          title: 'Truy cứu một pallet: ai in, lúc nào',
          text: ['Tab **Truy cứu**: gõ hoặc quét mã pallet → bấm vào dòng để xem thông tin pallet trong kho và **lịch sử in** của tem đó (số lần in, người in).'],
          images: [d('10-truy-cuu', 'Truy cứu pallet: thông tin tồn kho và lịch sử in')],
        },
      ],
    },
    {
      id: 'hoi-dap',
      title: 'Lỗi hay gặp',
      steps: [
        { title: 'Không thấy nút In', text: ['Nút In chỉ có trên máy tính. Trên máy tính mà nút mờ: còn thiếu ô bắt buộc — app ghi "Chọn đủ Mã hàng, Lot, NCC, NMSX để sinh tem."'] },
        { title: 'Tem in lệch, bị cắt', text: ['Trong hộp in chọn khổ A4, lề "Không" (None), tỷ lệ 100%, bỏ đầu trang / chân trang.'] },
        { title: 'Báo tem trùng pallet đã có trong kho', text: ['Cùng ngày SX · mã · Lot · NCC đã có pallet số đó. Đổi Seq đầu sang số tiếp theo để không có hai tem cùng mã.'] },
        { title: 'Truy cứu không ra kết quả khi lọc', text: ['Hàng NCC nên tra bằng mã pallet (gõ hoặc quét) thay vì lọc theo Chu kỳ / Máy.'] },
      ],
    },
  ],
}
