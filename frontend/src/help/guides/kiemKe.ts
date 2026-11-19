// BÀI HƯỚNG DẪN: Kiểm kê — kiểm từng vị trí bằng điện thoại, theo dõi tiến độ, xử lý chênh lệch, lịch sử, luân phiên ABC (19/11).
// Ảnh chụp trên Preview bằng tài khoản chức danh "Phó phòng QA", kho Chế biến Ba Vì; các lượt kiểm mẫu đã xoá và pallet trả về
// như cũ sau khi chụp. Ảnh ở public/guide/kiem-ke/. Đổi giao diện Kiểm kê ⇒ chụp lại + sửa chữ ở đây.
import type { Guide, GuideImage } from '../types'

const d = (file: string, alt: string): GuideImage => ({ src: `/guide/kiem-ke/${file}.jpg`, alt })
const m = (file: string, alt: string): GuideImage => ({ src: `/guide/kiem-ke/${file}.jpg`, alt, phone: true })

export const KIEM_KE_GUIDE: Guide = {
  id: 'kiem-ke',
  title: 'Kiểm kê: kiểm từng vị trí bằng điện thoại',
  category: 'Kho (WMS)',
  module: 'stocktake',
  updated: '19-11-2026',
  summary: 'Đứng ở từng ô quét tem pallet, xác nhận khớp hoặc nhập số thực tế; theo dõi tiến độ ở Tổng hợp KK, xử lý chênh lệch, xem lịch sử, chọn mã đến hạn kiểm.',
  sections: [
    {
      id: 'bat-dau',
      title: 'Bắt đầu',
      steps: [
        {
          title: 'Mở trang Kiểm kê',
          text: [
            'Menu **Kho (WMS) → Hàng trong kho → Kiểm kê**. Điện thoại: ☰ → Hàng trong kho → Kiểm kê.',
            'Bốn tab: **Check vị trí** (kiểm, làm trên điện thoại) · **Tổng hợp KK** (tiến độ hôm nay) · **Lịch sử kiểm** · **Luân phiên ABC** (mã đến hạn kiểm).',
          ],
          images: [d('01-menu', 'Trang Kiểm kê trên máy tính'), m('02-m-menu', 'Menu Kiểm kê trên điện thoại')],
        },
        {
          title: 'Lưu số kiểm không tự sửa tồn',
          text: [
            'Kiểm kê chỉ **ghi lại** đã kiểm pallet nào, ai kiểm, số thực tế bao nhiêu. Tồn kho **không tự đổi**.',
            'Thấy lệch thì kiểm lại; đúng là lệch thì sửa ở **Tồn kho → Điều chỉnh tồn**, rồi bấm **Bỏ cờ** ở Tổng hợp KK.',
          ],
        },
      ],
    },
    {
      id: 'kiem-o',
      title: 'Kiểm một vị trí (điện thoại)',
      steps: [
        {
          title: 'Chọn vị trí',
          text: [
            'Tab **Check vị trí**: kho đã chọn sẵn. Bấm ô **Chọn vị trí…** → gõ tìm → chọn ô; hoặc bấm biểu tượng **quét** bên dưới để quét tem vị trí.',
            'Ô **Chỉ vị trí cần check** chỉ hiện các ô đã được đánh dấu phải kiểm.',
          ],
          images: [m('03-m-check', 'Check vị trí: Chọn vị trí… và nút quét'), m('04-m-chon-o', 'Tìm và chọn ô CBBV_X1_TEST1')],
        },
        {
          title: 'Quét từng tem pallet trong ô',
          text: [
            'Bấm nút **quét** cạnh ô **Nhập mã pallet…**, đưa camera vào tem. Không quét được thì gõ mã tem rồi Enter; máy PDA thì bóp cò súng.',
            'Thẻ pallet hiện: tên hàng · **Tồn app** · **Vị trí app** / **Vị trí check**.',
          ],
          images: [m('05-m-o-da-chon', 'Ô nhập mã pallet và nút quét'), m('09-m-quet-camera', 'Quét tem bằng camera: thẻ pallet Đường trắng 795 kg')],
        },
        {
          title: 'Đúng số → Lưu',
          text: [
            'Đếm thực tế khớp **Tồn app** thì bấm **Lưu**. Băng xanh "Đã lưu — quét pallet tiếp theo…", rồi quét tem kế tiếp.',
          ],
          images: [m('06-m-the-pallet', 'Thẻ pallet Dầu cọ 100 kg, nút Lưu'), m('07-m-da-luu', 'Đã lưu')],
        },
        {
          title: 'Sai số → Không khớp → Lưu & Đánh dấu',
          text: [
            'Bấm **Không khớp** → nhập **Số lượng thực tế** (app hiện "Chênh: …") → **Lưu & Đánh dấu**. Pallet được gắn cờ **Chênh lệch**.',
            'Bấm Không khớp mà không nhập số thì chỉ lưu là "Đã kiểm", không gắn cờ.',
          ],
          images: [m('08-m-khong-khop', 'Thực tế 58 kg / app 60 kg, nút Lưu & Đánh dấu')],
        },
        {
          title: 'Pallet nằm sai ô',
          text: [
            'Vị trí app khác ô đang kiểm thì thẻ hiện ⚠ và ô tick **Cập nhật vị trí → <ô đang kiểm>** (tick sẵn). Lưu khi đang tick = chuyển pallet về ô đang kiểm.',
            'Pallet chỉ để tạm, sẽ đưa về chỗ cũ thì **bỏ tick** trước khi Lưu.',
          ],
        },
        {
          title: 'Kiểm xong một ô',
          text: ['Không có nút "hoàn thành ô": quét hết tem trong ô là xong. Xem ô đó còn pallet nào chưa quét ở tab **Tổng hợp KK**.'],
        },
      ],
    },
    {
      id: 'theo-doi',
      title: 'Theo dõi tiến độ, xử lý chênh lệch',
      steps: [
        {
          title: 'Tổng hợp KK',
          text: [
            'Tab **Tổng hợp KK** (nên xem trên máy tính) → **+ Thêm lọc → Vị trí** → chọn các ô đang kiểm.',
            'Bốn ô đếm: **Tổng Pallet · Đã kiểm · Chưa kiểm · Chênh lệch** (bấm ô nào thì bảng lọc theo ô đó). Dòng dưới: **Bao phủ** (đã kiểm / tổng) và **Chính xác** (khớp / đã đếm). Trang này tính **trong ngày hôm nay**.',
          ],
          images: [d('10-tong-hop', 'Tổng hợp KK ô CBBV_X1_TEST1: Bao phủ 21%')],
        },
        {
          title: 'Xử lý pallet chênh lệch',
          text: [
            'Bấm ô **Chênh lệch** để ra các pallet lệch, bấm vào dòng để xem chi tiết (Tồn thực tế · Tồn app · Chênh lệch, ai kiểm, lúc nào).',
            '- Đếm lại thấy khớp: quét lại pallet ở Check vị trí, nhập đúng số → cờ tự gỡ.',
            '- Đúng là lệch: sửa tồn ở **Tồn kho → Điều chỉnh tồn**, rồi bấm **Bỏ cờ** ở dòng này.',
            'Bỏ cờ chỉ gỡ cờ, không sửa tồn.',
          ],
          images: [d('11-chenh-lech', 'Pallet chênh lệch, nút Bỏ cờ'), d('12-chi-tiet', 'Chi tiết pallet chênh lệch')],
        },
      ],
    },
    {
      id: 'lich-su',
      title: 'Lịch sử kiểm, luân phiên ABC',
      steps: [
        {
          title: 'Lịch sử kiểm',
          text: [
            'Mỗi dòng một lượt kiểm: thời gian · pallet · vị trí · tồn app · thực tế · chênh · người kiểm · kết quả (**Khớp / Chênh lệch / Đã kiểm**).',
            'Đổi khoảng ngày ở ô **Ngày kiểm** (mặc định 7 ngày gần nhất). Máy tính: nút **Excel** xuất cả danh sách theo bộ lọc.',
          ],
          images: [d('13-lich-su', 'Lịch sử kiểm: ô Ngày kiểm và nút Excel')],
        },
        {
          title: 'Luân phiên ABC: mã nào đến hạn kiểm',
          text: [
            'Thay vì kiểm cả kho, app chia mã theo hạng: **A** kiểm 7 ngày / lần, **B** 30 ngày, **C** 90 ngày (theo số lượt lấy hàng 30 ngày gần nhất). Danh sách mặc định chỉ hiện mã **đến hạn**.',
            'Tích các mã cần kiểm → **Kiểm N mã** ⇒ app mở Tổng hợp KK lọc sẵn các ô đang chứa mã đó, rồi kiểm như mục trên.',
          ],
          images: [d('14-abc', 'Luân phiên ABC: 8 mã đến hạn kiểm')],
        },
      ],
    },
    {
      id: 'hoi-dap',
      title: 'Lỗi hay gặp',
      steps: [
        { title: '"Không tìm thấy pallet … trong tồn kho"', text: ['Sai mã (gõ nhầm) hoặc pallet đã hết hàng. Pallet có thật mà app không có thì báo người phụ trách kho kiểm phiếu nhập.'] },
        { title: '"Pallet không thuộc kho trong phạm vi của bạn"', text: ['Pallet thuộc kho khác. Đổi kho ở ô kho đầu trang, hoặc nhờ người của kho đó.'] },
        { title: 'Lỡ Lưu khi đang tick "Cập nhật vị trí"', text: ['Pallet đã chuyển sang ô đang kiểm. Đưa về lại bằng Chuyển vị trí, hoặc để nguyên nếu hàng thật sự nằm ở ô này.'] },
        { title: 'Bỏ cờ rồi mà tồn vẫn sai', text: ['Bỏ cờ không sửa tồn. Sửa ở Tồn kho → Điều chỉnh tồn.'] },
        { title: '"Không thể mở camera"', text: ['Cho trình duyệt dùng camera (ổ khoá cạnh đường dẫn → Camera → Cho phép), rồi tải lại trang. Hoặc gõ mã tem vào ô.'] },
      ],
    },
  ],
}
