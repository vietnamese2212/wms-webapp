// BÀI HƯỚNG DẪN: Nhập kho — đưa hàng vào kho chế biến (tự tạo phiếu hoặc nhận chuyển kho): chọn vị trí, quét tem, hoàn thành (19/11).
// 19/11 tối: kho phụ được tự tạo phiếu nhập (user chốt "cứ cho nhập đi thôi") ⇒ thêm mục "Tạo phiếu nhập" (ảnh 17–18: phiếu SX mẫu
// CBBV_N_191126_01 của tài khoản mẫu, đã xoá cùng pallet quét thử).
// Ảnh chụp trên Preview bằng tài khoản chức danh "Phó phòng QA", kho Chế biến Ba Vì; phiếu mẫu CBBV_N_191126_01 (Đường trắng,
// 3 tem L2611) đã xoá sau khi chụp. Ảnh quét = camera giả nhìn vào tem thật in từ app (app đọc mã thật).
// Ảnh ở public/guide/nhap-kho/. Đổi giao diện Nhập kho ⇒ chụp lại + sửa chữ ở đây.
import type { Guide, GuideImage } from '../types'

const d = (file: string, alt: string): GuideImage => ({ src: `/guide/nhap-kho/${file}.jpg`, alt })
const m = (file: string, alt: string): GuideImage => ({ src: `/guide/nhap-kho/${file}.jpg`, alt, phone: true })

export const NHAP_KHO_GUIDE: Guide = {
  id: 'nhap-kho',
  title: 'Nhập kho: nhận hàng vào kho chế biến',
  category: 'Kho (WMS)',
  module: 'inbound',
  updated: '19-11-2026',
  summary: 'Tự tạo phiếu nhập hoặc nhận phiếu chuyển kho từ kho tổng; chọn vị trí, quét tem từng pallet bằng điện thoại, sửa pallet quét nhầm, hoàn thành phiếu.',
  sections: [
    {
      id: 'bat-dau',
      title: 'Bắt đầu',
      steps: [
        {
          title: 'Hàng vào kho chế biến đi đường nào',
          text: [
            'Kho chế biến (vd **Chế biến Ba Vì**) là kho phụ của kho tổng (Kho Ba Vì). Hàng vào kho chế biến theo một trong hai đường:',
            '- **Tự tạo phiếu nhập**: Nhập kho → **Tạo phiếu** → tab **Nhập SX** (mục "Tạo phiếu nhập" ngay dưới).',
            '- **Nhận chuyển kho** (khi kho tổng xuất chuyển kho trên app): người nhận ở **Kế hoạch VC → tab Chuyển kho** bấm **Nhận hàng** ⇒ app tự tạo **phiếu nhập TF** (mỗi mã hàng một phiếu).',
            'Từ đó hai đường làm giống nhau: mở phiếu → chọn vị trí → quét tem từng pallet → **Hoàn thành**.',
          ],
          note: 'Một lô chỉ nhập một lần: hàng kho tổng đã xuất chuyển kho trên app thì nhận phiếu TF, đừng tạo thêm phiếu cho cùng lô đó.',
        },
        {
          title: 'Mở trang Nhập kho',
          text: [
            'Máy tính: menu trái **Kho (WMS) → Nhập hàng → Nhập kho**. Điện thoại: ô **Nhập kho** ở thanh dưới, hoặc ☰ → Nhập hàng → Nhập kho.',
            'Mặc định danh sách lọc **Ngày = hôm nay**. Phiếu ngày khác: bấm vào ô Ngày để đổi khoảng ngày.',
          ],
          images: [d('01-menu', 'Menu Nhập hàng → Nhập kho')],
        },
        {
          title: 'Đọc danh sách phiếu',
          text: [
            '- Nhãn cạnh ngày: **TF** (chuyển kho, tím) · NCC · SX · RT (hàng trả về); **HN** = hôm nay.',
            '- **Thực nhập / Thùng KH**: đã nhận bao nhiêu so với kế hoạch.',
            '- **Trạng thái**: Chưa nhập · Đang nhập · Đầy vị trí · Hoàn thành.',
            'Máy tính: bấm vào dòng → khung phải → **Mở chi tiết**. Điện thoại: chạm vào dòng là mở phiếu.',
          ],
          images: [d('02-danh-sach', 'Phiếu TF CBBV_N_191126_01 và nút Mở chi tiết'), m('06-m-danh-sach', 'Danh sách phiếu trên điện thoại')],
        },
      ],
    },
    {
      id: 'tao-phieu',
      title: 'Tạo phiếu nhập',
      intro: 'Pallet chưa có tem thì in tem trước (bài "In tem pallet"), rồi mới tạo phiếu và quét.',
      steps: [
        {
          title: 'Mở form Tạo phiếu, chọn tab Nhập SX',
          text: [
            'Trang Nhập kho → nút **Tạo phiếu** (góc phải trên) → tab **Nhập SX**.',
            'Không dùng tab **Nhập NCC** ở kho chế biến: tab đó bắt chọn xe đã đăng ký vào cổng.',
          ],
        },
        {
          title: 'Điền và tạo phiếu',
          text: [
            '- **Kho***: kho chế biến (vd Chế biến Ba Vì) · **Loại kho***: RM01 nguyên liệu / PK01 bao bì.',
            '- **Material***: mã hàng của lô · **Vị trí nhập***: ô sẽ cất (★ = ô nên cất).',
            '- **Ca nhập*** · **Ngày nhập*** (mặc định hôm nay).',
            '- **+ Thêm NCC (tùy chọn)**: chọn NCC của lô. Bỏ trống thì khi quét app đọc mã NCC trên tem.',
            'Bấm **Tạo phiếu** ⇒ phiếu mới hiện ở danh sách, nhãn **SX**. Mở phiếu, quét tem từng pallet như mục "Nhận hàng" bên dưới, xong bấm **Hoàn thành**.',
          ],
          images: [d('17-tao-phieu', 'Nhập SX: Đường trắng, ô CBBV_X1_TEST1, Ca 1, NCC Thành Thành Công'), d('18-phieu-sx', 'Phiếu mới nhãn SX trong danh sách')],
        },
      ],
    },
    {
      id: 'nhan-hang',
      title: 'Nhận hàng: vị trí và quét tem',
      steps: [
        {
          title: 'Chọn vị trí cất hàng',
          text: [
            'Phiếu mới chưa có vị trí: đầu phiếu ghi **Chưa chọn vị trí**, nút Thêm pallet bị khoá ("Chọn vị trí trước").',
            'Bấm **Chọn vị trí** → chọn ô. Dấu **★** = ô nên cất theo quy tắc kho (vd "đang để dở cùng mã"); số bên phải = số pallet đang có / sức chứa. Đứng ở ô có tem vị trí thì bấm **Quét** để quét tem ô.',
            'Đổi ô sau này: **Đổi vị trí**; xem các lần đổi: **Lịch sử**.',
          ],
          images: [d('03-chua-vi-tri', 'Phiếu chưa chọn vị trí'), d('04-chon-vi-tri', 'Chọn ô CBBV_X1_TEST1 (★)')],
        },
        {
          title: 'Bấm Thêm pallet',
          text: ['Có vị trí rồi thì bấm **Thêm pallet** (điện thoại: nút xanh ở giữa phiếu). Màn quét mở ra, camera bật.'],
          images: [d('05-da-co-vi-tri', 'Phiếu đã có vị trí, nút Thêm pallet'), m('07-m-phieu', 'Phiếu trên điện thoại, nút Thêm pallet')],
        },
        {
          title: 'Quét tem pallet → Lưu',
          text: [
            'Đưa camera vào tem QR trên pallet. Đọc được mã, khung xanh hiện quanh mã và nút **Lưu 1.000 kilogram** hiện giữa màn.',
            '- **Số lượng nhập**: app điền sẵn theo tem / phiếu; pallet không đầy thì sửa trước khi bấm Lưu (hàng tính kg gõ được số lẻ, vd 995,5).',
            '- **Tầng chồng**: pallet đặt trên sàn = Tầng 1; chồng lên pallet khác = Tầng 2, 3.',
            '- **NCC**: phiếu chuyển kho tự lấy NCC của pallet gốc; phiếu tự tạo lấy NCC chọn ở phiếu, không chọn thì đọc mã NCC trên tem.',
            'Bấm **Lưu**. Pallet vào tồn kho ngay lúc này.',
          ],
          images: [m('08-m-quet', 'Camera đọc tem Đường trắng, nút Lưu 1.000 kilogram')],
        },
        {
          title: 'Đã lưu — quét tem tiếp theo',
          text: [
            'Băng xanh ✓ ghi mã tem · số lượng · vị trí. Sau 1–2 giây camera tự quét tiếp, đưa sang tem pallet kế.',
            'Quét lại tem đã lưu thì app báo đỏ "đã được quét trong phiếu nhập này" — bấm **Quét tiếp** rồi chuyển sang tem khác.',
            'Xong hết pallet thì bấm **Huỷ** để đóng màn quét.',
          ],
          images: [m('09-m-da-luu', 'Băng xanh đã lưu pallet'), m('10-m-tem-trung', 'Báo đỏ tem đã quét, nút Quét tiếp')],
        },
        {
          title: 'Dùng súng quét PDA',
          text: [
            'Máy PDA có súng quét: đứng ở trang phiếu, bóp cò vào tem — màn quét mở ở **chế độ súng** (camera tắt). Bắn lại đúng tem đang chờ = Lưu.',
            'Camera không đọc được (tem mờ, rách): bật đèn pin / phóng to ở góc camera; vẫn không được thì in lại tem ở **In tem pallet → In lại từ tồn kho**.',
          ],
        },
        {
          title: 'Hàng không tem: Lưu thủ công + NSX',
          text: [
            'Mã hàng không theo dõi tem thì phiếu không có bước quét: mở phiếu → nút **Lưu thủ công** → gõ **Số lượng thực nhập**.',
            'Kho bật **Hàng không tem theo NSX** (Cài đặt WMS → Kho → nhóm NHẬP; kho chế biến đang bật) thì phải chọn thêm **NSX** in trên bao bì — ô để trống, không chọn được ngày tương lai. Mỗi NSX thành một dòng tồn riêng nên app tính được hạn dùng và lấy hàng NSX cũ trước.',
          ],
        },
        {
          title: 'Sửa / xoá pallet quét nhầm',
          text: [
            'Ở bảng **Pallet đã quét** (máy tính), cuối mỗi dòng có **bút chì** (Sửa số lượng, tầng) và **thùng rác** (Xóa pallet).',
            'Chỉ sửa / xoá được khi phiếu chưa hoàn thành và pallet chưa bị xuất, cấp vào mẻ hay điều chỉnh.',
          ],
          images: [d('11-pallet-da-quet', 'Bảng Pallet đã quét, nút Sửa và Xóa'), d('12-sua-pallet', 'Form Sửa pallet')],
        },
      ],
    },
    {
      id: 'hoan-thanh',
      title: 'Hoàn thành phiếu',
      steps: [
        {
          title: 'Đối chiếu và hoàn thành',
          text: [
            'Quét hết pallet thì bấm **Hoàn thành** (nút xanh lá đầu phiếu). Hộp xác nhận so **Kế hoạch** với **Thực nhập**: Đúng kế hoạch / Thiếu / Thừa. Thiếu hay thừa vẫn hoàn thành được — ghi nhận đúng số thực nhận.',
            'Bấm **Hoàn thành** trong hộp. Dòng phiếu ở danh sách chuyển sang **Hoàn thành** (chữ gạch ngang).',
          ],
          images: [d('13-hoan-thanh', 'Hộp xác nhận: thiếu 1.000 kg so với kế hoạch'), d('15-xong', 'Phiếu đã Hoàn thành')],
        },
        {
          title: 'Gỡ hoàn thành / huỷ phiếu',
          text: [
            'Hoàn thành nhầm (còn pallet chưa quét): bấm **⋮ → Gỡ hoàn thành**, phiếu về Đang nhập.',
            '**⋮ → Hủy phiếu** chỉ hiện khi phiếu chưa có pallet nào; huỷ là xoá hẳn phiếu.',
          ],
          images: [d('14-go-hoan-thanh', 'Menu ⋮ → Gỡ hoàn thành')],
        },
        {
          title: 'Hàng trả về',
          text: ['Menu **Nhập hàng → Hàng trả về** liệt kê các phiếu nhập trả (khách trả, thu hồi), cột **Giữ QA** cho biết phiếu nào đang giữ hàng chờ QA.'],
          images: [d('16-hang-tra-ve', 'Trang Hàng trả về')],
        },
      ],
    },
    {
      id: 'hoi-dap',
      title: 'Lỗi hay gặp',
      steps: [
        { title: 'Nút "Chọn vị trí trước" bị khoá', text: ['Phiếu chưa có vị trí. Bấm Chọn vị trí ở đầu phiếu.'] },
        { title: '"Sai mã hàng — QR: …, phiếu: …"', text: ['Tem thuộc mã hàng khác. Mỗi phiếu chỉ nhận một mã — mở đúng phiếu của mã trên tem (hoặc tạo phiếu cho mã đó).'] },
        { title: '"Vị trí … đã đầy"', text: ['Chọn Tầng chồng 2 / 3 nếu chồng được, hoặc Đổi vị trí sang ô khác.'] },
        { title: '"Mất kết nối mạng — phiếu CHUYỂN KHO cần mạng…"', text: ['Phiếu chuyển kho phải đối chiếu số xuất với kho tổng. Ra chỗ có mạng rồi quét lại.'] },
        { title: '"Không xoá được pallet" / "Không sửa được pallet"', text: ['App ghi rõ lý do ngay dưới đầu phiếu (hoặc trong form Sửa): pallet đã được cấp vào mẻ, đã xuất, đang được giữ chỗ hay đã điều chỉnh tồn thì không xoá / sửa ở phiếu nữa. Hỏi người phụ trách kho trước khi xử lý.'] },
        { title: '"Không thể mở camera"', text: ['Cho trình duyệt dùng camera (bấm biểu tượng ổ khoá cạnh đường dẫn → Camera → Cho phép), rồi tải lại trang.'] },
      ],
    },
  ],
}
