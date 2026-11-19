// BÀI HƯỚNG DẪN: Mã hàng — tìm, thêm, sửa, ẩn, nạp Excel (19/11).
// Ảnh chụp trên Preview bằng tài khoản chức danh "Phó phòng QA" (loại hàng RM01 + PK01); mã mẫu 210000416 "Bột cacao kiềm hoá"
// đã xoá sau khi chụp. Ảnh ở public/guide/ma-hang/. Đổi giao diện trang Mã hàng ⇒ chụp lại ảnh + sửa chữ ở đây.
import type { Guide, GuideImage } from '../types'

const d = (file: string, alt: string): GuideImage => ({ src: `/guide/ma-hang/${file}.jpg`, alt })
const m = (file: string, alt: string): GuideImage => ({ src: `/guide/ma-hang/${file}.jpg`, alt, phone: true })

export const MA_HANG_GUIDE: Guide = {
  id: 'ma-hang',
  title: 'Mã hàng: tìm, thêm, sửa, nạp Excel',
  category: 'Danh mục',
  module: 'materials',
  updated: '19-11-2026',
  summary: 'Khai mã nguyên liệu (RM01) và bao bì (PK01) đúng quy cách: đơn vị, số lượng một pallet, hạn dùng, hạn dùng theo NCC. Sửa, ẩn mã, nạp nhiều mã bằng Excel.',
  sections: [
    {
      id: 'bat-dau',
      title: 'Bắt đầu',
      intro: 'Mã hàng là danh mục gốc: nhập kho, tồn kho, in tem, định mức, mẻ chế biến đều đọc từ đây. Khai sai quy cách thì số pallet, hạn dùng (HSD) và %Date tính sai theo.',
      steps: [
        {
          title: 'Mở trang Mã hàng',
          text: [
            'Máy tính: menu trái **Cấu hình → Mã hàng**.',
            'Điện thoại: bấm ☰ ở góc trái trên → **Mã hàng** (cuối menu).',
            'Mỗi người chỉ thấy mã của loại hàng mình được giao (vd RM01 nguyên liệu, PK01 bao bì).',
          ],
          images: [d('01-menu', 'Menu Cấu hình → Mã hàng trên máy tính'), m('02-m-menu', 'Menu trên điện thoại')],
        },
        {
          title: 'Đọc danh sách',
          text: [
            '- Ô **Tìm mã, tên…**: gõ một phần mã hoặc tên, gõ không dấu cũng được.',
            '- Dải số trên bảng: **Tổng mã · Đang dùng · Đã ẩn · Không QR · Thiếu DL · Trùng tên · Chưa KT thùng**.',
            '- Dòng **chữ đỏ** = mã còn thiếu thông tin bắt buộc (rê chuột vào dòng để xem thiếu ô nào). Dòng **chữ cam** = tên trùng với mã khác.',
            'Mặc định chỉ hiện mã **Đang dùng**; mã đã ẩn xem bằng bộ lọc Trạng thái.',
          ],
          images: [d('05-danh-sach', 'Danh sách mã hàng: ô tìm và dải số Thiếu DL'), m('03-m-danh-sach', 'Danh sách trên điện thoại')],
        },
      ],
    },
    {
      id: 'tim-xem',
      title: 'Tìm và xem một mã',
      steps: [
        {
          title: 'Lọc mã còn thiếu thông tin',
          text: [
            'Bấm **+ Thêm lọc → Dữ liệu → Thiếu thông tin** để ra đúng các mã cần bổ sung. Các bộ lọc khác: Loại hàng · Trạng thái · QR · KT thùng · Cờ.',
            'Bỏ một bộ lọc: bấm **×** trên ô lọc đó, hoặc **Xóa tất cả**.',
          ],
          images: [d('06-loc-thieu', 'Thêm lọc Dữ liệu = Thiếu thông tin')],
        },
        {
          title: 'Lọc trên điện thoại',
          text: ['Bấm nút **Lọc** → chọn từng mục → **Xem kết quả**. Số trên nút Lọc là số bộ lọc đang bật.'],
          images: [m('04-m-loc', 'Bảng Bộ lọc trên điện thoại')],
        },
        {
          title: 'Xem chi tiết một mã',
          text: [
            'Bấm vào dòng để mở khung chi tiết bên phải (bấm lại dòng đó để đóng).',
            '- **Phân loại**: loại hàng, loại SP, **Quản tồn** (theo QR từng pallet hay theo số lượng).',
            '- **Quy cách**: Thùng/pallet, Base Unit, Pallet/EA, HSD, kích thước thùng.',
            '- **Lịch sử**: ai tạo, ai sửa, lúc nào.',
          ],
          images: [d('07-chi-tiet', 'Khung chi tiết mã 210000262 Đường trắng')],
        },
      ],
    },
    {
      id: 'them-ma',
      title: 'Thêm mã nguyên liệu (RM01)',
      intro: 'Ví dụ: thêm mã 210000416 "Bột cacao kiềm hoá 10-12%", bao 25 kg, một pallet 40 bao = 1.000 kg, HSD 720 ngày, riêng NCC Đại Tân Việt HSD 540 ngày.',
      steps: [
        {
          title: 'Bấm Thêm mã hàng',
          text: ['Bấm nút xanh **+ Thêm mã hàng** ở góc phải trên. Form mở bên phải.'],
          images: [d('08-nut-them', 'Nút Thêm mã hàng')],
        },
        {
          title: 'Mã, mô tả, loại hàng',
          text: [
            '- **Mã hàng***: đúng mã SAP (vd 210000416). Lưu rồi không sửa được mã.',
            '- **Mô tả***: tên đầy đủ. **Tên rút gọn** để trống thì app tự tạo "tên [3 số cuối mã]" — tên này in trên tem pallet.',
            '- **Loại hàng***: chọn **RM01** (nguyên liệu) hoặc **PK01** (bao bì). Loại hàng quyết định ai được thấy mã và ô nào bắt buộc.',
            '- **Thùng/pallet***: số đơn vị gốc trên một pallet đầy. Mã tính theo KG thì ghi số kg một pallet (vd **1000**).',
            'Ba ô tick đầu form (phi hàng hóa · pallet mang hàng · bán thành phẩm) để trống với nguyên liệu thường.',
          ],
          images: [d('09-form-tren', 'Điền Mã hàng, Mô tả, Loại hàng RM01')],
        },
        {
          title: 'Đơn vị, Pallet/EA, HSD, HSD theo NCC',
          text: [
            '- **Base Unit***: đơn vị gốc mọi số lượng trong app đều tính theo nó — nguyên liệu thường là **KG**, **L** hoặc **BAG**; bao bì thường là **EA**.',
            '- **Entry Unit**: chỉ chọn khi hàng nhập theo thùng chứa nhiều đơn vị gốc (rồi khai **EA/thùng**). Nguyên liệu tính kg thì để "— Không có —".',
            '- **Pallet/EA***: một đơn vị gốc chiếm bao nhiêu pallet = 1 ÷ số trên một pallet. 1.000 kg/pallet ⇒ **0,001** (dùng dấu phẩy).',
            '- **HSD (ngày)***: hạn dùng mặc định tính từ ngày sản xuất.',
            '- **HSD theo NCC**: bấm **Thêm Ngoại lệ NCC**, chọn NCC và số ngày khi NCC đó cho hạn khác mặc định. Lúc nhập hàng, NCC trên tem quyết định HSD và %Date của pallet.',
            '- **Quản tồn**: để **Quản theo QR từng pallet** — mỗi pallet có tem và phải quét khi nhập, cấp NVL.',
          ],
          images: [d('11-form-don-vi-hsd', 'Base Unit KG, Pallet/EA 0,001, HSD 720 ngày, HSD theo NCC Đại Tân Việt 540 ngày')],
        },
        {
          title: 'Bấm Lưu — ô nào thiếu, app báo đỏ',
          text: [
            'Bấm **Lưu** ở cuối form. Còn thiếu ô bắt buộc thì app báo hộp đỏ ngay trên nút (vd "Base Unit là bắt buộc"), điền thêm rồi bấm Lưu lại.',
            'Lưu xong form tự đóng, mã mới hiện trong danh sách.',
          ],
          images: [d('10-form-loi', 'Hộp đỏ Base Unit là bắt buộc'), d('12-da-them', 'Mã 210000416 đã có trong danh sách')],
        },
        {
          title: 'Thêm mã trên điện thoại',
          text: ['Làm được như máy tính: bấm **Thêm mã hàng**, form mở toàn màn hình, nút **Lưu** ở cuối. Mã nhiều ô nên làm trên máy tính cho nhanh.'],
          images: [m('15-m-form', 'Form Thêm mã hàng trên điện thoại')],
        },
      ],
    },
    {
      id: 'sua-an',
      title: 'Sửa, ẩn mã',
      steps: [
        {
          title: 'Sửa một mã',
          text: [
            'Bấm biểu tượng **bút chì** ở cuối dòng (hoặc mở chi tiết → **Sửa**). Form "Sửa: <mã>" mở ra, ô Mã hàng bị khoá. Sửa xong bấm **Lưu**.',
            'Đổi HSD hay HSD theo NCC chỉ áp cho pallet nhập **sau** khi sửa; pallet đã nhập giữ hạn cũ (sửa từng pallet ở Tồn kho).',
          ],
          images: [d('13-sua', 'Form sửa mã 210000416')],
        },
        {
          title: 'Ẩn mã không dùng nữa',
          text: [
            'Bấm biểu tượng **thùng rác** ở cuối dòng → hộp "Xác nhận ẩn mã hàng" → **Ẩn**. Mã ẩn không bị xoá khỏi hệ thống, chỉ không hiện ở các ô chọn mã.',
            'Dùng lại mã đã ẩn: lọc **Trạng thái = Đã ẩn** → bấm bút chì → tick lại ô **Trạng thái** (bấm vào ô vuông nhỏ) → **Lưu**.',
          ],
          images: [d('14-an', 'Hộp Xác nhận ẩn mã hàng')],
        },
      ],
    },
    {
      id: 'nap-excel',
      title: 'Nạp nhiều mã bằng Excel (máy tính)',
      intro: 'Dùng khi thêm hoặc sửa hàng chục mã một lúc. Chỉ làm được trên máy tính.',
      steps: [
        {
          title: 'Mở Upload Excel, tải file mẫu',
          text: [
            'Bấm biểu tượng **mũi tên lên** cạnh nút Thêm mã hàng → hộp "Upload Mã hàng từ Excel" → **Tải mẫu**.',
            'Hộp chọn chỗ lưu hiện ra: chọn thư mục rồi bấm **Lưu** — app báo "Đã lưu mau_ma_hang.xlsx". Không ghi được vào thư mục đó thì app báo đỏ và tải file về thư mục **Tải xuống**.',
            'File mẫu có 2 sheet: **MaHang** chỉ có 2 dòng tên cột (giữ nguyên, điền mỗi mã một dòng từ dòng 3) và **Hướng dẫn** (giải thích từng cột + một dòng ví dụ).',
            '- Mã **chưa có** ⇒ thêm mới: phải đủ ô như form — Tên hàng, Loại hàng, Base Unit, Thùng/Pallet, và HSD / Pallet/EA nếu loại hàng bắt.',
            '- Mã **đã có** ⇒ chỉ cập nhật ô có giá trị; ô để trống giữ nguyên.',
          ],
          images: [d('16-nut-upload', 'Nút Upload Excel'), d('17-upload', 'Hộp Upload Mã hàng từ Excel, nút Tải mẫu')],
        },
        {
          title: 'Chọn file — app kiểm trước, chưa ghi gì',
          text: [
            'Bấm **Chọn file Excel**. App đọc file và hiện bảng kiểm: Tổng mã · Sẽ thêm · Sẽ cập nhật · Lỗi, kèm từng dòng lỗi (vd "210000418 — thiếu Tên hàng (mã mới)").',
            '**Tất cả hoặc không gì**: còn một dòng lỗi là không ghi mã nào. Sửa file, chọn lại file.',
            'Hết lỗi thì bấm **Xác nhận nhập N mã hàng** để ghi. Muốn thôi thì bấm **Huỷ**.',
          ],
          images: [d('18-kiem-file', 'Bảng kiểm file: 1 lỗi thiếu Tên hàng, không ghi gì')],
        },
      ],
    },
    {
      id: 'hoi-dap',
      title: 'Lỗi hay gặp',
      steps: [
        { title: '"HSD (ngày) là bắt buộc cho loại RM01" / "Pallet/EA là bắt buộc"', text: ['Nguyên liệu và bao bì phải có HSD và Pallet/EA. Pallet/EA = 1 ÷ số đơn vị gốc trên một pallet (1.000 kg/pallet ⇒ 0,001).'] },
        { title: '"Mã hàng đã tồn tại"', text: ['Mã đã có (có thể đang ẩn). Bỏ lọc Trạng thái để tìm, rồi sửa mã đó thay vì thêm mới.'] },
        { title: '"Loại hàng … ngoài phạm vi của bạn"', text: ['Tài khoản chỉ được khai mã của loại hàng được giao. Trong file Excel, kiểm tra cột Loại hàng.'] },
        { title: '"… mã mới thiếu Loại hàng, Base Unit, Thùng/Pallet…"', text: ['Mã chưa có trong danh mục phải đủ ô bắt buộc như khi thêm ở form. Điền các ô app nêu tên rồi chọn lại file.'] },
        { title: 'Bấm Tải mẫu / Xuất Excel mà không thấy file', text: ['File lưu vào thư mục bạn chọn trong hộp chọn chỗ lưu (lần đầu mở ở Documents) và app báo "Đã lưu …". App báo đỏ "Không ghi được vào thư mục đã chọn" thì file đã được tải về thư mục Tải xuống; đóng file cùng tên đang mở trong Excel hoặc chọn thư mục khác rồi tải lại.'] },
        { title: 'Vừa ẩn mã thì mã biến mất', text: ['Danh sách mặc định lọc "Đang dùng". Đổi bộ lọc Trạng thái sang "Đã ẩn" để thấy lại.'] },
        { title: 'Nạp Excel báo lỗi nên không ghi gì', text: ['Đúng như thiết kế: một dòng lỗi là cả file không ghi, để không bị nhập dở dang. Bấm "Tải danh sách lỗi", sửa file rồi nạp lại.'] },
      ],
    },
  ],
}
