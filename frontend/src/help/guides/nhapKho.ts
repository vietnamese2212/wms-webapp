// BÀI HƯỚNG DẪN: Nhập kho — nhận hàng chuyển kho vào kho chế biến: chọn vị trí, quét tem, hoàn thành (19/11).
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
  summary: 'Nhận phiếu chuyển kho từ kho tổng: chọn vị trí, quét tem từng pallet bằng điện thoại, sửa pallet quét nhầm, hoàn thành phiếu.',
  sections: [
    {
      id: 'bat-dau',
      title: 'Bắt đầu',
      steps: [
        {
          title: 'Hàng vào kho chế biến đi đường nào',
          text: [
            'Kho chế biến (vd **Chế biến Ba Vì**) là kho phụ của kho tổng (Kho Ba Vì). Nguyên liệu chỉ vào kho chế biến bằng **chuyển kho**, pallet giữ nguyên tem gốc:',
            '- Kho tổng xuất chuyển kho cho kho chế biến.',
            '- Người nhận ở **Kế hoạch VC → tab Chuyển kho** bấm **Nhận hàng** ⇒ app tự tạo **phiếu nhập TF** (mỗi mã hàng một phiếu) ở Nhập kho của kho chế biến.',
            '- Người ở kho chế biến mở phiếu TF: chọn vị trí → quét tem từng pallet → **Hoàn thành**.',
            'Ở kho chế biến không dùng nút **Tạo phiếu** — app báo "Kho phụ nội bộ chỉ nhận hàng qua chuyển kho từ kho parent".',
          ],
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
            '- **Số lượng nhập**: app điền sẵn theo tem / phiếu; pallet không đầy thì sửa trước khi bấm Lưu.',
            '- **Tầng chồng**: pallet đặt trên sàn = Tầng 1; chồng lên pallet khác = Tầng 2, 3.',
            '- **NCC**: phiếu chuyển kho tự lấy NCC của pallet gốc, không cần chọn.',
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
        { title: '"Kho phụ nội bộ chỉ nhận hàng qua chuyển kho…"', text: ['Kho chế biến không tạo phiếu nhập trực tiếp. Chờ phiếu TF sinh ra khi kho tổng chuyển hàng và người ở Kế hoạch VC bấm Nhận hàng.'] },
        { title: '"Cần đánh giá chuyến giao (chấm sao) trước khi hoàn thành phiếu nhận"', text: ['Phiếu chuyển kho phải được chấm sao chuyến giao trước khi hoàn thành. Nhờ người nhận hàng ở Kế hoạch VC → tab Chuyển kho chấm sao, rồi bấm Hoàn thành lại.'] },
        { title: 'Nút "Chọn vị trí trước" bị khoá', text: ['Phiếu chưa có vị trí. Bấm Chọn vị trí ở đầu phiếu.'] },
        { title: '"Sai mã hàng — QR: …, phiếu: …"', text: ['Tem thuộc mã hàng khác. Mỗi phiếu TF chỉ nhận một mã — mở đúng phiếu của mã trên tem.'] },
        { title: '"Vị trí … đã đầy"', text: ['Chọn Tầng chồng 2 / 3 nếu chồng được, hoặc Đổi vị trí sang ô khác.'] },
        { title: '"Mất kết nối mạng — phiếu CHUYỂN KHO cần mạng…"', text: ['Phiếu chuyển kho phải đối chiếu số xuất với kho tổng. Ra chỗ có mạng rồi quét lại.'] },
        { title: 'Bấm xoá pallet nhưng dòng hiện lại', text: ['Pallet không xoá được (đã được cấp vào mẻ, xuất hoặc điều chỉnh tồn). Hỏi người phụ trách kho trước khi xử lý.'] },
        { title: '"Không thể mở camera"', text: ['Cho trình duyệt dùng camera (bấm biểu tượng ổ khoá cạnh đường dẫn → Camera → Cho phép), rồi tải lại trang.'] },
      ],
    },
  ],
}
