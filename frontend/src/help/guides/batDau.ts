// BÀI HƯỚNG DẪN SỐ 1 — Bắt đầu: việc đầu tiên của người mới (19/11, user: "Với 1 người mới hoàn toàn - cần làm việc gì đầu
// tiên với app chứ?"). Không gắn module ⇒ ai đăng nhập cũng thấy. Ảnh chụp trên Preview bằng tài khoản "Người dùng mẫu"
// (chức danh Phó phòng QA, kho Chế biến Ba Vì), tài khoản đã xoá sau khi chụp. Ảnh ở public/guide/bat-dau/.
// Đổi trang đăng nhập / thanh trên / menu / Cài đặt tài khoản ⇒ chụp lại + sửa chữ ở đây.
import type { Guide, GuideImage } from '../types'

const d = (file: string, alt: string): GuideImage => ({ src: `/guide/bat-dau/${file}.jpg`, alt })
const m = (file: string, alt: string): GuideImage => ({ src: `/guide/bat-dau/${file}.jpg`, alt, phone: true })

export const BAT_DAU_GUIDE: Guide = {
  id: 'bat-dau',
  title: 'Bắt đầu: đăng nhập, đổi mật khẩu, làm quen màn hình',
  category: 'Bắt đầu',
  updated: '19-11-2026',
  summary: 'Việc đầu tiên của người mới: đăng nhập trên máy tính và điện thoại, đổi mật khẩu được cấp, chọn kho làm việc, tìm menu, cài app lên điện thoại, bật thông báo.',
  sections: [
    {
      id: 'dang-nhap',
      title: 'Đăng nhập',
      steps: [
        {
          title: 'Mở app và đăng nhập',
          text: [
            'Mở đường dẫn app do quản trị gửi: máy tính dùng **Chrome**, điện thoại dùng **Chrome** (Android) hoặc **Safari** (iPhone).',
            'Gõ **Tên đăng nhập** (email hoặc tên đăng nhập được cấp) và **Mật khẩu** → bấm **Đăng nhập**.',
            'App giữ đăng nhập trên máy đó. Không mở app quá một ngày thì phải đăng nhập lại.',
          ],
          note: 'Gõ sai mật khẩu 10 lần trong 15 phút thì tài khoản tạm khoá 15 phút. Quên mật khẩu: nhờ quản trị đặt lại — app không tự gửi mật khẩu.',
          images: [d('01-dang-nhap', 'Trang đăng nhập trên máy tính'), m('02-m-dang-nhap', 'Trang đăng nhập trên điện thoại')],
        },
      ],
    },
    {
      id: 'doi-mat-khau',
      title: 'Đổi mật khẩu được cấp',
      intro: 'Làm ngay lần đầu đăng nhập: mật khẩu quản trị cấp chỉ để vào lần đầu.',
      steps: [
        {
          title: 'Mở Cài đặt tài khoản',
          text: [
            'Bấm **tên mình** ở góc phải trên → **Cài đặt tài khoản**.',
            'Điện thoại: bấm ô tròn có chữ viết tắt tên ở góc phải trên → **Cài đặt tài khoản**, hoặc mở ☰ → **Cài đặt** (cuối menu).',
          ],
          images: [d('05-menu-ten', 'Bấm tên mình → Cài đặt tài khoản')],
        },
        {
          title: 'Điền mật khẩu mới',
          text: [
            'Ở khung **Đổi mật khẩu**:',
            '- **Mật khẩu hiện tại**: mật khẩu đang dùng (lần đầu = mật khẩu được cấp).',
            '- **Mật khẩu mới**: tối thiểu 10 ký tự, có cả chữ và số, không trùng tên đăng nhập.',
            '- **Xác nhận mật khẩu mới**: gõ lại mật khẩu mới.',
            'Bấm **Đổi mật khẩu** → app báo "Đổi mật khẩu thành công!". Máy đang dùng vẫn đăng nhập; các máy khác đang mở tài khoản này tự về trang đăng nhập.',
          ],
          images: [d('06-doi-mat-khau', 'Khung Đổi mật khẩu trên máy tính'), m('11-m-doi-mat-khau', 'Đổi mật khẩu trên điện thoại')],
        },
      ],
    },
    {
      id: 'man-hinh',
      title: 'Làm quen màn hình',
      steps: [
        {
          title: 'Màn hình trên máy tính',
          text: [
            '- **Menu bên trái**: các trang gom theo nhóm (Sản xuất (MES), Kho (WMS), Báo cáo, Cấu hình, Hỗ trợ). Mỗi người chỉ thấy trang mình được giao.',
            '- **Ô kho** ở góc trái thanh trên (vd "Chế biến Ba Vì"): kho đang làm việc.',
            '- Bên phải thanh trên: nút **⟳** cập nhật app · **chuông** thông báo · nút sáng / tối · **tên mình** (Cài đặt tài khoản, Đăng xuất).',
          ],
          images: [d('03-man-hinh', 'Menu trái, ô kho, chuông, tên mình')],
        },
        {
          title: 'Chọn kho và loại hàng đang làm',
          text: [
            'Bấm **ô kho** → tick kho và loại kho (vd **RM01** nguyên liệu, **PK01** bao bì; **Tất cả loại** = mọi loại mình được giao).',
            'Lựa chọn này áp cho bộ lọc và giá trị điền sẵn trong form ở mọi trang; từng trang vẫn chỉnh riêng được. Chỉ hiện kho và loại kho mình được giao.',
          ],
          images: [d('04-chon-kho', 'Ô kho mở ra: chọn kho và loại kho')],
        },
        {
          title: 'Màn hình trên điện thoại',
          text: [
            '- **☰** ở góc trái trên: mở menu đầy đủ. Menu dài thì **cuộn xuống** để thấy các nhóm dưới (Báo cáo, Cấu hình, Hỗ trợ).',
            '- Dải ngay dưới thanh trên: **ô kho** đang chọn, bấm để đổi.',
            '- **Thanh dưới cùng**: lối tắt tới trang hay dùng (vd Nhập kho).',
          ],
          images: [m('09-m-man-hinh', 'Điện thoại: ☰, ô kho, thanh dưới'), m('10-m-menu', 'Menu ☰ cuộn xuống: Hỗ trợ → Hướng dẫn sử dụng')],
        },
        {
          title: 'Cập nhật app khi có bản mới',
          text: [
            'Khi có bản mới, nút **⟳** sáng xanh kèm chấm vàng và dưới màn hiện dải **"Đã có bản mới của ứng dụng"** → bấm **Cập nhật ngay**.',
            'Nên cập nhật lúc không dở tay (đang quét, đang điền form). Thấy số liệu khác người bên cạnh thì cũng bấm ⟳ trước khi báo lỗi.',
          ],
        },
      ],
    },
    {
      id: 'dien-thoai',
      title: 'Cài app lên điện thoại, camera, thông báo',
      steps: [
        {
          title: 'Thêm app vào màn hình chính',
          text: [
            '- **Android (Chrome)**: mở app → nút **⋮** góc phải trên → **Thêm vào màn hình chính** (hoặc **Cài đặt ứng dụng**).',
            '- **iPhone (Safari)**: mở app → nút **Chia sẻ** (ô vuông mũi tên lên) → **Thêm vào MH chính**.',
            'Từ đó mở app bằng biểu tượng trên màn hình chính, toàn màn hình như một ứng dụng.',
          ],
        },
        {
          title: 'Cho phép camera để quét tem',
          text: [
            'Lần đầu bấm nút quét, điện thoại hỏi quyền camera → bấm **Cho phép**.',
            'Lỡ bấm Chặn: Chrome — bấm biểu tượng ổ khoá cạnh địa chỉ → **Quyền** → **Camera** → Cho phép. iPhone — **Cài đặt → Safari → Camera** → Cho phép. Rồi mở lại trang quét.',
          ],
        },
        {
          title: 'Bật thông báo đẩy',
          text: [
            '**Cài đặt tài khoản** → khung **Thông báo đẩy** → bật **Bật trên thiết bị này** → trình duyệt hỏi quyền → **Cho phép**.',
            'Thông báo hiện cả khi không mở app. Bật trên từng máy muốn nhận.',
            'iPhone / iPad: phải **Thêm vào MH chính** (iOS 16.4 trở lên) và mở app từ biểu tượng đó mới bật được.',
          ],
          images: [d('07-thong-bao-day', 'Khung Thông báo đẩy trong Cài đặt tài khoản')],
        },
      ],
    },
    {
      id: 'hoc-tiep',
      title: 'Học tiếp',
      steps: [
        {
          title: 'Mở các bài hướng dẫn',
          text: [
            'Menu **Hỗ trợ → Hướng dẫn sử dụng**. Các bài đánh số theo thứ tự công việc: người mới đọc lần lượt từ bài 1, cuối mỗi bài có nút sang bài tiếp.',
            'Mỗi người chỉ thấy bài của trang mình được giao. Ô **Tìm trong hướng dẫn** tìm trong mọi bước, gõ không dấu cũng ra (vd "doi mat khau").',
          ],
          images: [d('08-ho-tro', 'Menu Hỗ trợ → Hướng dẫn sử dụng')],
        },
      ],
    },
    {
      id: 'loi',
      title: 'Lỗi hay gặp',
      steps: [
        { title: '"Tên đăng nhập hoặc mật khẩu không đúng"', text: ['Kiểm tra phím Caps Lock và bộ gõ tiếng Việt (Unikey đang bật Telex làm đổi chữ, vd "aa" thành "â"). Tắt bộ gõ rồi gõ lại.'] },
        { title: '"Quá nhiều lần đăng nhập sai — tài khoản/địa chỉ đang tạm khoá…"', text: ['Chờ đủ số phút app báo rồi thử lại, hoặc nhờ quản trị mở khoá.'] },
        { title: '"Tài khoản đã bị vô hiệu hóa"', text: ['Tài khoản đã bị tắt. Liên hệ quản trị.'] },
        { title: 'Đang dùng thì bị đưa về trang đăng nhập', text: ['Mật khẩu vừa được đổi (ở máy khác, hoặc quản trị đặt lại), hoặc lâu không mở app. Đăng nhập lại bằng mật khẩu mới nhất.'] },
        { title: 'Không thấy trang / bài hướng dẫn cần dùng', text: ['Chức danh chưa được giao trang đó, hoặc chưa được giao kho / loại kho. Nhờ quản trị cấp; cấp xong tải lại trang là thấy.'] },
      ],
    },
  ],
}
