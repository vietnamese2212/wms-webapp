// BÀI HƯỚNG DẪN: Dồn / Tách pallet (19/11). Ảnh chụp trên Preview bằng tài khoản chức danh "Phó phòng QA", kho Chế biến Ba Vì;
// pallet mẫu Đường trắng L2611 (tách 200 kg, dồn 2 tem) đã xoá sau khi chụp. Ảnh ở public/guide/don-tach/.
import type { Guide, GuideImage } from '../types'

const d = (file: string, alt: string): GuideImage => ({ src: `/guide/don-tach/${file}.jpg`, alt })
const m = (file: string, alt: string): GuideImage => ({ src: `/guide/don-tach/${file}.jpg`, alt, phone: true })

export const DON_TACH_GUIDE: Guide = {
  id: 'don-tach',
  title: 'Dồn / Tách pallet',
  category: 'Kho (WMS)',
  module: 'pallet_ops',
  updated: '19-11-2026',
  summary: 'Tách một phần hàng của pallet ra pallet con có tem mới; dồn nhiều tem lên một pallet vật lý; xem lịch sử, in tem, hoàn tác.',
  sections: [
    {
      id: 'bat-dau',
      title: 'Bắt đầu',
      steps: [
        {
          title: 'Dồn khác Tách thế nào',
          text: [
            '- **Tách**: chia số lượng thật. Pallet gốc giảm tồn, sinh **pallet con** có tem mới (mã tem gốc thêm ".1", ".2"…), giữ nguyên NSX, Lot, NCC, hạn dùng, QA của gốc.',
            '- **Dồn**: xếp nhiều tem lên **một pallet vật lý** (gom nhóm). Không đổi số lượng, không in tem mới — mỗi tem giữ truy vết riêng.',
          ],
        },
        {
          title: 'Mở trang, chọn Kho và Loại kho',
          text: [
            'Menu **Kho (WMS) → Hàng trong kho → Dồn / Tách pallet**. Ba tab: **Dồn (gom nhóm)** · **Tách số lượng** · **Lịch sử**.',
            'Chọn **Kho** và **Loại kho** (vd RM01) trước — chưa chọn Loại kho thì các nút bị khoá.',
          ],
          images: [d('01-menu', 'Trang Dồn / Tách pallet, ô Loại kho')],
        },
      ],
    },
    {
      id: 'tach',
      title: 'Tách pallet',
      steps: [
        {
          title: 'Quét pallet gốc, nhập số tách',
          text: [
            'Tab **Tách số lượng**. Ô **Pallet gốc cần tách**: quét (**Quét QR**) hoặc gõ mã tem rồi Enter — app hiện tên hàng và tồn.',
            '**Số lượng mỗi pallet con tách ra**: nhập số cho **Con 1** (vd 200 kg; hàng tính kg gõ được số lẻ như 12,5). Cần nhiều pallet con thì bấm **+ Thêm pallet con**.',
            '**Vị trí pallet con**: mặc định cùng ô với pallet gốc, đổi được.',
          ],
          images: [d('02-tach', 'Tách 200 kg từ pallet 995 kg')],
        },
        {
          title: 'Bấm Tách pallet, in tem con',
          text: [
            'Bấm **Tách pallet**. App báo "Đã tách 1 pallet con (gốc còn …)" và liệt kê tem con.',
            'Máy tính: bấm **In tem ngay** để in tem con, hoặc **Để in sau** (in ở tab Lịch sử). Dán tem con lên phần hàng vừa tách.',
          ],
          images: [d('03-da-tach', 'Đã tách: tem con …_1.1_B, nút In tem ngay / Để in sau')],
        },
      ],
    },
    {
      id: 'don',
      title: 'Dồn pallet (trên điện thoại)',
      steps: [
        {
          title: 'Quét pallet đích và pallet con',
          text: [
            'Tab **Dồn (gom nhóm)**. **Pallet đích** (giữ lại làm đại diện): quét hoặc gõ mã tem.',
            '**Pallet con** (xếp chung lên đích): quét từng tem (mỗi lần bấm **Quét QR** một tem) hoặc gõ mã rồi Enter.',
            'Bấm **Dồn N pallet**. Pallet con chuyển về cùng ô với pallet đích.',
          ],
          images: [m('04-m-don', 'Pallet đích …_2_B, pallet con …_3_B, nút Dồn 1 pallet'), m('05-m-da-don', 'Đã dồn 1 pallet')],
        },
        {
          title: 'Gỡ nhóm',
          text: ['Muốn tách các tem đã dồn ra lại: nhập pallet trong nhóm → **Gỡ nhóm** (điện thoại: trong nút ⋮).'],
        },
      ],
    },
    {
      id: 'lich-su',
      title: 'Lịch sử, in tem, hoàn tác',
      steps: [
        {
          title: 'Tab Lịch sử',
          text: [
            'Mỗi dòng một thao tác: thời gian · Dồn / Tách · pallet nguồn → đích · số lượng · người làm · Hiệu lực / Đã hoàn tác.',
            '- **In tem**: in (lại) tem con của lần tách.',
            '- **Hoàn tác**: trả lại như trước thao tác (tách: xoá pallet con, cộng lại vào gốc). App hỏi lại kèm hệ quả, bấm **Hoàn tác** để chạy. Pallet con đã bị xuất / cấp vào mẻ thì không hoàn tác được.',
          ],
          images: [d('06-lich-su', 'Lịch sử: một lần Dồn, một lần Tách')],
        },
        {
          title: 'Nhận biết trên Tồn kho',
          text: ['Ở trang Tồn kho, cột Mã pallet có nhãn **dồn** (tem đã xếp lên pallet khác) và **tách** (pallet con sinh ra từ tách). Từ Tồn kho cũng mở được Tách / Dồn: tích pallet → thanh thao tác → **Tách** (1 pallet) hoặc **Dồn** (từ 2 pallet).'],
          images: [d('07-ton-kho-nhan', 'Nhãn dồn và tách trên Tồn kho')],
        },
      ],
    },
    {
      id: 'hoi-dap',
      title: 'Lỗi hay gặp',
      steps: [
        { title: 'Các nút bị khoá', text: ['Chưa chọn Loại kho (đang "Tất cả loại"). Chọn RM01 / PK01.'] },
        { title: '"Không tìm thấy pallet này đang tồn kho."', text: ['Sai kho / loại kho đang chọn, hoặc pallet đã hết hàng. Kiểm lại ở Tồn kho.'] },
        { title: '"Mã pallet gốc không đúng định dạng QR"', text: ['Tem cũ thiếu đoạn (tem chuẩn có 6 đoạn ngăn bởi dấu _). In lại tem đúng mẫu ở In tem pallet rồi tách.'] },
        { title: '"Tách … vượt số khả dụng"', text: ['Một phần hàng trên pallet đang được giữ chỗ cho việc khác. Tách ít hơn hoặc chờ việc kia xong.'] },
        { title: '"Pallet đích đang là pallet con của nhóm khác"', text: ['Chọn pallet đầu nhóm làm đích, hoặc Gỡ nhóm trước.'] },
        { title: 'Không thấy nút "In tem ngay" trên điện thoại', text: ['In tem chỉ làm trên máy tính: vào tab Lịch sử → In tem.'] },
      ],
    },
  ],
}
