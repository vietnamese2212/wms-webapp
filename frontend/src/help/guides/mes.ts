// BÀI HƯỚNG DẪN: Sản xuất (MES) — từ cài đặt danh mục tới vận hành một mẻ, báo cáo, truy xuất (19/11).
// Ảnh chụp trên Preview bằng tài khoản mang chức danh "Phó phòng QA" (không phải superadmin), dữ liệu Chế biến Ba Vì;
// mẻ mẫu B260003BD66 + bồn BD66 đã xoá sau khi chụp. Ảnh ở public/guide/mes/.
// Khi đổi giao diện MES: chụp lại ảnh liên quan + sửa chữ ở đây (tên nút trong bài phải khớp tên nút trên app).
import type { Guide, GuideImage } from '../types'

const d = (file: string, alt: string): GuideImage => ({ src: `/guide/mes/${file}.jpg`, alt })
const m = (file: string, alt: string): GuideImage => ({ src: `/guide/mes/${file}.jpg`, alt, phone: true })
// ảnh chụp khác khổ chuẩn 1280×800 thì khai kích thước thật (giữ chỗ đúng tỷ lệ khi ảnh chưa tải)
const dSize = (file: string, alt: string, w: number, h: number): GuideImage => ({ ...d(file, alt), w, h })

export const MES_GUIDE: Guide = {
  id: 'mes',
  title: 'Sản xuất (MES): cài đặt và vận hành mẻ',
  category: 'Sản xuất (MES)',
  module: 'production',
  updated: '19-11-2026',
  summary: 'Từ khai mã bán thành phẩm, bồn, định mức tới mở mẻ, duyệt, quét cấp nguyên liệu, phiếu theo dõi, in tem, đổ bồn, QA ở bồn, báo cáo NVL và truy xuất lô.',
  sections: [
    {
      id: 'bat-dau',
      title: 'Bắt đầu',
      intro: 'Một mẻ đi qua 8 bước, mỗi bước do một người có quyền làm. App luôn cho biết mẻ đang ở bước nào và đang chờ ai.',
      steps: [
        {
          title: 'Luồng của một mẻ',
          text: [
            '- **1. Trưởng ca duyệt** phiếu nguyên liệu của mẻ.',
            '- **2. QA duyệt** phiếu. Đủ hai duyệt mới được cấp nguyên liệu.',
            '- **3. Cấp nguyên liệu**: công nhân trộn quét tem từng bao / pallet nguyên liệu.',
            '- **4. Ghi phiếu theo dõi** (phối trộn, dịch thạch…): bấm từng ô, ô giờ tự lấy giờ hiện tại.',
            '- **5. In tem pallet của mẻ**: mỗi pallet nguyên liệu đã cấp dán một tem.',
            '- **6. Check trước khi đổ bồn**: đứng ở bồn quét từng tem — đúng mẻ, đúng bồn mới đổ.',
            '- **7. Nạp BTP vào bồn**.',
            '- **8. QA ở bồn**: QA kết luận Đạt / Không đạt cho cả bồn.',
            'Phần cài đặt (mã bán thành phẩm, bồn, định mức, mẫu phiếu) chỉ làm một lần, sửa khi có thay đổi.',
          ],
        },
        {
          title: 'Đăng nhập, đổi mật khẩu, chọn kho',
          text: ['Người mới: đọc bài **1. Bắt đầu** trước (đăng nhập trên máy tính và điện thoại, đổi mật khẩu được cấp, chọn kho làm việc, cài app lên điện thoại).'],
        },
        {
          title: 'Menu Sản xuất (MES)',
          text: [
            'Nhóm menu **Sản xuất (MES)** gồm: Mẻ chế biến · Bồn · Báo cáo NVL · Định mức · Cài đặt MES.',
            'Trên điện thoại bấm ☰ ở góc trái trên để mở menu. Mỗi người chỉ thấy các mục mình có quyền.',
            'Ô **kho** ở thanh trên cùng (vd "Chế biến Ba Vì") chọn kho đang làm việc.',
          ],
          images: [d('03-menu-mes', 'Menu Sản xuất (MES) trên máy tính'), m('04-m-menu', 'Menu trên điện thoại')],
        },
      ],
    },
    {
      id: 'cai-dat',
      title: 'A. Cài đặt danh mục (làm một lần)',
      intro: 'Làm theo thứ tự: mã bán thành phẩm → Cài đặt MES → bồn → định mức.',
      steps: [
        {
          title: 'A1. Đánh dấu mã bán thành phẩm (BTP)',
          who: ['Quản lý danh mục'],
          text: [
            'Bán thành phẩm là dịch trộn từ nhiều nguyên liệu theo định mức, vào bồn chờ chiết rót. Chỉ mã đã đánh dấu mới chọn được khi Mở mẻ, khai Định mức, Hạn lưu bồn.',
            '- Vào **Cấu hình → Mã hàng**, gõ mã vào ô tìm, bấm vào dòng để mở chi tiết, bấm **Sửa** (chi tiết: bài "Mã hàng").',
            '- Tick **"Mã là BÁN THÀNH PHẨM (dịch trộn, vào bồn)"**. Base Unit phải là **L** hoặc **KG**.',
            '- Bấm **Lưu**.',
          ],
          images: [d('10-ma-hang-btp', 'Chi tiết mã BTP-SCCDLT: Loại mã = Bán thành phẩm'), d('11-ma-hang-form', 'Form sửa mã: ô tick Mã là bán thành phẩm')],
        },
        {
          title: 'A2. Cài đặt MES',
          who: ['Quản lý xưởng', 'QA'],
          text: [
            'Vào **Cài đặt MES**, chọn kho chế biến ở thanh trên. Cả trang chỉ có **một nút Lưu** ở góc phải.',
            '- **Đóng gói rút bán thành phẩm khỏi bồn**: bồn còn lô chờ QA thì *Cảnh báo* (vẫn cho rút, báo người đóng trang) hoặc *Chặn* (không rút được tới khi QA thả). Bồn có lô QA loại thì luôn chặn.',
            '- **Luồng làm việc của mẻ → Chặn theo từng bước**: bật thì chưa đủ hai duyệt chưa cấp được nguyên liệu, và chưa nạp bồn được khi còn thiếu nguyên liệu, ô bắt buộc của phiếu chưa ghi, chưa quét đủ tem tại đúng bồn.',
            '- **Hạn lưu bồn theo mã bán thành phẩm**: số giờ BTP được nằm trong bồn; quá hạn bồn tô đỏ.',
            'Tab **Mẫu phiếu theo dõi**: sửa danh sách ô của từng phiếu (Phối trộn, Dịch thạch…), ô nào bắt buộc ghi trước khi nạp bồn, ngưỡng tô đỏ. Bấm **Xem thử** để thấy đúng phiếu người ghi sẽ thấy.',
          ],
          images: [d('12-cai-dat-mes', 'Cài đặt MES — tab Chung'), d('13-mau-phieu', 'Cài đặt MES — tab Mẫu phiếu theo dõi')],
        },
        {
          title: 'A3. Khai bồn',
          who: ['Quản lý xưởng'],
          text: [
            'Vào **Bồn** → **Khai bồn**: chọn kho chế biến, nhập **Mã bồn** (vd BD70), tên, **Sức chứa**, **Đơn vị** (Lít hoặc Kg — phải trùng đơn vị gốc của mã BTP sẽ nạp vào) → **Lưu**.',
            'Trang Bồn hiện **sơ đồ 2D**: lăn chuột / chụm hai ngón để phóng to thu nhỏ, kéo để di chuyển, nút ⤢ để xem vừa màn. Nút ✥ (Sắp xếp) cho kéo thả bồn đúng vị trí thực tế trong xưởng.',
            'Màu thân bồn: xanh dương = chờ QA bồn · xanh lá = QA đạt · đỏ = QA loại / quá hạn lưu · gạch chéo = mẻ đã đặt bồn mà chưa nạp.',
          ],
          images: [d('14-bon-so-do', 'Trang Bồn — sơ đồ 2D, nút Khai bồn'), d('15-khai-bon', 'Form Khai bồn')],
        },
        {
          title: 'A4. Định mức (công thức) của mã BTP',
          who: ['QA', 'Quản lý xưởng'],
          text: [
            'Vào **Định mức** → **Thêm công thức**. Một mã BTP có thể có nhiều công thức (vd "Chuẩn", "Mùa hè"), đúng một công thức **Mặc định** — form Mở mẻ chọn sẵn công thức này.',
            '- **Cỡ mẻ chuẩn**: số lượng BTP của một mẻ chuẩn (vd 6.000 KG). Mẻ có kế hoạch khác thì app tự nhân theo tỷ lệ.',
            '- Bảng nguyên liệu: mã, **Số lượng** cho một mẻ cỡ chuẩn (theo đơn vị gốc của mã), cột **± %** = mức lệch cho phép (cấp ngoài mức này dòng tô đỏ, vẫn cho cấp; để trống = không kiểm).',
            '- Muốn làm công thức gần giống: mở công thức cũ → **Chép thành công thức mới** → sửa vài dòng → Lưu.',
          ],
          images: [d('16-dinh-muc', 'Danh sách định mức'), d('17-cong-thuc', 'Form công thức: cỡ mẻ chuẩn, nguyên liệu, ± %')],
        },
        {
          title: 'A5. Nạp định mức từ Excel',
          who: ['QA', 'Quản lý xưởng'],
          text: [
            'Trang **Định mức** → **Nạp Excel** (chỉ trên máy tính) → **Tải mẫu**. Sheet "Hướng dẫn" trong file mẫu giải thích từng cột và có ví dụ.',
            '- **Mỗi dòng một nguyên liệu.** Các dòng cùng Mã BTP + Tên công thức gộp thành một công thức. Cỡ mẻ chuẩn ghi ở dòng đầu là đủ.',
            '- File mẫu có sẵn **danh sách mã**: cột Mã BTP và Mã NVL chỉ nhận mã có trong Mã hàng (gõ mã sai là Excel chặn); cột Tên và ĐVT tự hiện theo mã. Dán bằng Ctrl+V thì Excel không chặn: cột Tên hiện "⚠ Không có mã này" là mã sai.',
            '- Công thức **đã có** (cùng mã + tên) sẽ được **thay toàn bộ** danh sách nguyên liệu; chưa có thì thêm mới.',
            '- Chọn file → app **kiểm trước** và hiện lỗi theo **số dòng Excel** (vd "Dòng 4 — ĐVT L khác đơn vị gốc KG"). Sửa file rồi chọn lại.',
            '- File còn một lỗi thì **không ghi gì**. Hết lỗi thì bấm **Xác nhận nhập**.',
          ],
          images: [d('18-nap-excel', 'Hộp Nạp định mức từ Excel'), d('18b-kiem-file', 'Kiểm file: lỗi báo theo số dòng, chưa ghi gì')],
          note: 'Số lượng luôn theo đơn vị gốc của mã nguyên liệu (cột ĐVT tự điền theo mã). Ghi tay sai đơn vị là báo lỗi, tránh nhầm kg với g.',
        },
      ],
    },
    {
      id: 'van-hanh',
      title: 'B. Vận hành một mẻ',
      intro: 'Ví dụ trong ảnh: mẻ B260003BD66 — SC CĐ Long Thành, công thức Chuẩn (SMP-MH), kế hoạch 3.000 kg, chu kỳ 26, bồn BD66.',
      steps: [
        {
          title: 'B1. Danh sách mẻ',
          text: [
            'Trang **Mẻ chế biến**: mỗi dòng một mẻ. Cột **Tình trạng** cho biết mẻ đang ở bước nào: Chờ duyệt (xám) · Chờ QA duyệt (tím) · đang làm, ghi đúng bước đang tới (cam) · Chờ QA bồn (xanh dương) · QA đạt (xanh lá) · QA loại (đỏ).',
            'Dải số xanh ở trên đếm mẻ theo tình trạng. Bấm 🔖 cạnh mã lô để ghim mẻ thành tab "Đang làm" — làm nhiều mẻ cùng lúc thì bấm tab để chuyển.',
          ],
          images: [d('19-ds-me-tinh-trang', 'Danh sách mẻ với tình trạng từng mẻ')],
        },
        {
          title: 'B2. Mở mẻ',
          who: ['Trưởng ca'],
          text: [
            'Bấm **Mở mẻ**, điền:',
            '- **Mã bán thành phẩm** (gõ mã hoặc tên dịch để tìm) → **Công thức** (chọn sẵn công thức mặc định).',
            '- **Chu kỳ** · **Số mẻ** (app gợi ý số kế tiếp) · **Bồn** (danh sách ghi chỗ trống của từng bồn).',
            '- **Lượng kế hoạch**, **Ngày sản xuất**, **Ca*** (bắt buộc — báo cáo NVL chia lệch định mức theo ca), máy trộn (tuỳ chọn), phiếu theo dõi bổ sung nếu có.',
            '**Mã lô tự ghép**, không gõ tay: chữ nhà máy + chu kỳ + số mẻ 4 số + mã bồn (vd **B260003BD66**). Bấm **Mở mẻ** — app vào thẳng trang của mẻ.',
          ],
          images: [d('20-ds-me', 'Nút Mở mẻ'), d('21-form-mo-me', 'Form Mở mẻ — mã lô tự ghép')],
          note: 'Kế hoạch vượt chỗ trống của bồn, hoặc bồn đang chứa mã BTP khác, app báo đỏ ngay tại ô.',
        },
        {
          title: 'B3. Trang của mẻ',
          text: [
            'Đầu trang: mã lô, tình trạng, thông tin mẻ và **dải 8 bước** — bước xanh đã xong, bước đậm là bước đang tới. Bước chờ người khác hiện "Chờ …".',
            '**Nút chính ở góc phải là việc tiếp theo** của mẻ (Duyệt phiếu → QA duyệt → Quét cấp NVL → …). Việc quản trị (Sửa / đổi bồn, Sửa định mức, Bỏ duyệt, Mở mẻ giống, Huỷ mẻ) nằm trong nút **⋮**.',
            'Bảng **Nguyên liệu của mẻ**: Cần · Đã cấp · Thiếu · Tồn kho của từng nguyên liệu (tính từ định mức × kế hoạch).',
          ],
          images: [d('22-trang-me', 'Trang mẻ vừa mở: chờ trưởng ca duyệt')],
        },
        {
          title: 'B4. Sửa định mức của riêng mẻ (khi cần)',
          who: ['Trưởng ca', 'QA'],
          text: [
            'Bấm **⋮ → Sửa định mức**: sửa số lượng, thêm nguyên liệu, bỏ dòng (✕), đổi mã (⇄). Phải ghi **Lý do sửa**. Định mức gốc vẫn được giữ để đối chiếu.',
            'Ví dụ: bỏ dòng BTP sữa nền vì rút thẳng từ bồn. Dòng bỏ vẫn hiện trên bảng, gạch ngang, ghi "Đã bỏ".',
            'Chỉ áp cho mẻ này, không đổi công thức.',
          ],
          images: [d('23-menu-quan-tri', 'Nút ⋮ → Sửa định mức'), d('25-sua-dinh-muc-ly-do', 'Bỏ một dòng và ghi lý do')],
          note: 'Sửa định mức phải làm TRƯỚC khi QA duyệt. QA đã duyệt thì phải "Bỏ duyệt QA" (trong ⋮) mới sửa được.',
        },
        {
          title: 'B5. Hai bước duyệt',
          who: ['Trưởng ca', 'QA'],
          text: [
            '- Trưởng ca bấm **Duyệt phiếu** (duyệt 1).',
            '- QA bấm **QA duyệt** (duyệt 2). Duyệt xong phiếu khoá, mẻ chuyển sang bước **Cấp nguyên liệu**; nút chính đổi thành **Quét cấp NVL**.',
            'Muốn sửa lại: QA **Bỏ duyệt QA**, trưởng ca **Bỏ duyệt** (trong ⋮).',
          ],
          images: [d('26-duyet-truong-ca', 'Trưởng ca bấm Duyệt phiếu'), d('27-qa-duyet', 'QA bấm QA duyệt'), d('28-da-duyet', 'Đủ hai duyệt: nút chính là Quét cấp NVL')],
        },
        {
          title: 'B6. Quét cấp nguyên liệu (điện thoại / súng PDA)',
          who: ['Công nhân trộn'],
          text: [
            'Mở mẻ trên điện thoại → **Quét cấp NVL** (hoặc nút **Cấp** ở từng dòng).',
            '- Bắn súng PDA, bấm biểu tượng quét để dùng camera, hoặc gõ mã tem rồi Enter.',
            '- App hiện tem: mã, nguyên liệu, NSX · HSD · ngày nhập · vị trí · %Date, **đúng thứ tự FIFO hay không**, trên tem còn bao nhiêu, mẻ còn thiếu bao nhiêu.',
            '- **Lượng cấp** điền sẵn phần mẻ còn thiếu (không vượt lượng trên tem). Sửa nếu cấp ít hơn, hoặc bấm **Lấy hết**.',
            '- Bấm **Xác nhận cấp**. Form để mở để quét tem tiếp; xong bấm **Xong**.',
            '**Lấy ở đâu** (cuối form, bấm để mở): danh sách tem / lô gom theo date, đúng thứ tự luân chuyển — lấy hàng theo thứ tự này.',
            'Hàng không có tem QR (tồn gộp): chuyển sang tab **Không có tem** → chọn lô → nhập lượng.',
          ],
          images: [m('30-m-trang-me', 'Trang mẻ trên điện thoại: nút Quét cấp NVL'), m('32-m-tem-da-quet', 'Đã quét tem: kiểm thông tin, lượng cấp, Xác nhận cấp')],
          note: 'Tem QA đang giữ hoặc tem ở kho khác (chưa chuyển sang kho chế biến) không cấp được — app báo rõ lý do.',
        },
        {
          title: 'B7. Nguyên liệu hết hạn — QA duyệt',
          who: ['Công nhân trộn', 'QA'],
          text: [
            'Quét phải tem đã quá HSD, app báo **Hết hạn** và khoá nút cấp. Bấm **Gửi QA duyệt**.',
            'QA mở trang mẻ, khung đỏ **"NVL hết hạn — QA duyệt cho mẻ này"**: ghi căn cứ, bấm **Duyệt cho dùng** hoặc **Từ chối** (QA cũng duyệt được ngay trong form cấp).',
            'Duyệt rồi thì quét lại tem đó để cấp. Duyệt chỉ có hiệu lực cho đúng mẻ này.',
          ],
          images: [m('35-m-tem-het-han', 'Tem hết hạn: nút Gửi QA duyệt'), d('37-qa-tu-choi', 'QA duyệt / từ chối trên trang mẻ')],
        },
        {
          title: 'B8. Kiểm tra nguyên liệu đã cấp',
          text: [
            'Đủ mọi nguyên liệu thì ô **NVL đã đủ** = 10/10, cột Tình trạng ghi **Đủ**.',
            'Bấm **Xem tem đã cấp** để mở mọi dòng: mỗi tem đã cấp một dòng (lượng, %Date, NSX, HSD). Bấm **Thu gọn** để đóng.',
            'Cấp nhầm: dòng cấp có nút huỷ (cần quyền huỷ dòng cấp, bắt buộc ghi lý do) — hàng trả về đúng tem. Mẻ đã nạp bồn thì sổ nguyên liệu khoá.',
          ],
          images: [d('34-da-cap-du', 'Đã cấp đủ: mở xem tem đã cấp')],
        },
        {
          title: 'B9. Phiếu theo dõi (phối trộn…)',
          who: ['Công nhân trộn', 'QA'],
          text: [
            'Bấm **Bắt đầu phiếu**: app tạo phiếu, điền sẵn số lượng mẻ và ghi **giờ bắt đầu**.',
            '- Mỗi ô là một nút: **ô giờ** bấm là ghi giờ hiện tại; ô khác bấm để hiện khung nhập → gõ → **Lưu**. Ghi tới đâu lưu tới đó, không có nút "Lưu phiếu".',
            '- Số vượt ngưỡng tiêu chuẩn tô đỏ nhưng vẫn lưu — phiếu ghi đúng thực tế.',
            '- Cần thêm lần / thêm ô cho riêng mẻ này: **+ Thêm ô cho mẻ này**.',
            'QA kiểm phiếu rồi bấm **QA xác nhận** — phiếu khoá. Bỏ xác nhận mới sửa lại được.',
          ],
          images: [m('41-m-phieu', 'Phiếu phối trộn vừa bắt đầu'), m('42-m-nhap-o', 'Bấm ô để nhập'), m('43-m-phieu-da-ghi', 'Phiếu đã ghi, QA xác nhận')],
        },
        {
          title: 'B10. In tem pallet của mẻ',
          who: ['QA'],
          text: [
            'Bấm **In tem pallet** → nhập **mẻ để trên mấy pallet** → **In tem**. Mỗi pallet nguyên liệu đã cấp dán một tem (1/3, 2/3, 3/3).',
            'Tem khổ 1/4 A4: QR, mã lô, BTP, ngày SX, ô lớn Chu kỳ · Mẻ · Bồn · Pallet.',
            'Đổi số pallet = bộ tem mới, tem cũ hết hiệu lực. In lại cùng số pallet thì tem cũ vẫn dùng được.',
          ],
          images: [d('47-tem-da-in', 'Bộ tem đang hiệu lực'), dSize('48-mau-tem', 'Mẫu tem khi in', 795, 562)],
        },
        {
          title: 'B11. Check trước khi đổ bồn (điện thoại / súng PDA)',
          who: ['Công nhân đổ bồn'],
          text: [
            'Mang pallet tới **đúng bồn của mẻ** (vd BD66). Trên trang mẻ bấm **Check trước khi đổ bồn** — hoặc ở trang Bồn bấm **Check** trên thẻ bồn.',
            '- **Chỉ quét**, không gõ: bắn súng vào từng tem pallet, hoặc bấm **Camera**.',
            '- Tem đúng mẻ, đúng bồn: ô tem chuyển xanh ✓. Tem của mẻ khác / bồn khác / tem cũ: báo đỏ, nói đúng bồn phải đổ.',
            '- Quét đủ n/n tem thì hiện ô **Lượng nạp** và mở khoá nút **Nạp BTP vào bồn**.',
          ],
          images: [m('50-m-nut-check-bon', 'Nút Check trước khi đổ bồn'), m('52-m-quet-tem-1', 'Đã quét 1/3 tem'), m('53-m-quet-du', 'Đủ 3/3 tem: nạp vào bồn')],
        },
        {
          title: 'B12. Nạp BTP vào bồn',
          who: ['Công nhân đổ bồn'],
          text: [
            'Kiểm **Lượng nạp** (điền sẵn = kế hoạch − đã nạp) → **Nạp BTP vào bồn**. Mẻ chuyển sang **Chờ QA bồn**.',
            'Nút bị khoá thì mở ⋮ để xem lý do còn thiếu (chưa đủ duyệt, nguyên liệu thiếu, ô bắt buộc của phiếu, chưa quét đủ tem).',
            'Đã nạp thì không đổi bồn của mẻ được nữa; muốn đưa sang bồn khác dùng **Chuyển** ở trang Bồn.',
          ],
          images: [m('54-m-nap-bon', 'Nạp BTP vào bồn'), d('55-me-cho-qa-bon', 'Mẻ đã nạp: chờ QA bồn, nút Tới bồn')],
        },
        {
          title: 'B13. QA kết luận ở bồn',
          who: ['QA'],
          text: [
            'Trang **Bồn** → bấm **QA bồn** trên thẻ bồn (hoặc **Tới bồn** từ trang mẻ).',
            '- Ghi chú (bắt buộc khi Không đạt) → bấm **Đạt**, **Không đạt** hoặc **Chờ QA**. Bấm là ghi ngay.',
            '- Kết luận áp cho **mọi mẻ đang có trong bồn**. Nạp thêm mẻ mới thì bồn về "Chờ QA".',
            'Bồn QA đạt hiện xanh lá; đóng gói rút BTP từ bồn ở Sổ đóng gói.',
          ],
          images: [d('58-nut-qa-bon', 'Nút QA bồn trên thẻ bồn'), d('59-qa-bon-form', 'QA bồn: ghi chú rồi bấm Đạt'), d('60-bon-qa-dat', 'Bồn QA đạt')],
        },
      ],
    },
    {
      id: 'bao-cao',
      title: 'C. Báo cáo và truy xuất',
      steps: [
        {
          title: 'C1. Báo cáo NVL theo chu kỳ',
          text: [
            'Vào **Báo cáo NVL**. Tab **Tổng quan** (mở sẵn) là dashboard theo thời gian: chọn kỳ **1 ngày · 7 ngày · 1 tháng · 3 tháng · 1 năm · 3 năm · Tự chọn**. Có thẻ số (mẻ hoàn thành, % mẻ đạt định mức, lệch NVL, thời gian mẻ, QA bồn), xu hướng lệch, bản đồ nhiệt theo ca, NVL gây lệch nhiều nhất, biểu đồ kiểm soát từng mẻ. **Bấm vào bất kỳ con số / ô / cột nào** để xem dữ liệu đứng sau; bấm một ngày trên xu hướng để đi sâu vào ngày đó.',
            'Mục tiêu (lệch cho phép ± %, % mẻ đạt) đặt ở **Cài đặt MES → Mục tiêu Báo cáo NVL**.',
            'Tab **Theo chu kỳ** → chọn chu kỳ: báo cáo cuối của một chu kỳ. Báo cáo chạy trực tiếp, tự cập nhật.',
            'Mọi con số so với **định mức gốc** (công thức × kế hoạch), không phải phiếu đã sửa. Lệch tách hai phần: **Sửa phiếu** (trưởng ca sửa định mức của mẻ, có lý do) và **Cấp lệch** (cấp khác phiếu). Chỉ dòng đã cấp xong mới có số lệch.',
            '- **Lệch ca · mẻ**: biểu đồ lệch của từng mẻ trong chu kỳ xếp theo ca (đỏ = có nguyên liệu lệch), danh sách **NVL lệch nhiều nhất**, bảng **Theo ca · mẻ** (định mức, thực cấp, lệch theo KG và số NVL lệch). Bấm một mẻ để xem từng nguyên liệu và lý do sửa.',
            '- **NVL × ca**: mỗi nguyên liệu một dòng — định mức, phiếu, thực cấp, lệch của cả chu kỳ, mỗi ca một cột, cột **Mẻ lệch**. Bấm dòng nguyên liệu ▸ để xem từng mẻ xếp dọc; bấm một mẻ để mở mẻ đó.',
            '- **Ca · Mẻ**: từng mẻ thuộc ca nào, đã nạp bồn chưa. **Nhân sự**: mỗi người đã làm bao nhiêu việc trong chu kỳ.',
            'Ca là ca của một ngày: chu kỳ kéo qua nhiều ngày thì ghi "Ca 1 · 17/11", "Ca 1 · 18/11".',
            '**Xuất Excel** = báo cáo cuối chu kỳ: Lệch theo ca · mẻ / NVL theo ca / NVL từng mẻ / Ca – Mẻ / Nhân sự / Tiêu hao NVL (thô).',
          ],
          images: [d('70b-dashboard', 'Tổng quan — chọn kỳ xem, thẻ số, xu hướng lệch, lệch đến từ đâu'), d('70c-bam-xem-du-lieu', 'Bấm một con số ⇒ bảng dữ liệu đứng sau; bấm một dòng để mở mẻ'), d('70a-tong-quan', 'Theo chu kỳ → Lệch ca · mẻ, một mẻ mở từng nguyên liệu'), d('70-bao-cao-chu-ky', 'NVL × ca, một dòng mở ▸ từng mẻ'), d('72-bao-cao-nhan-su', 'Tab Nhân sự')],
        },
        {
          title: 'C2. Dữ liệu thô tiêu hao NVL (cho SAP)',
          text: [
            'Tab **Dữ liệu thô**: mỗi dòng **một lần cấp** (+ số lượng) hoặc **một lần huỷ cấp** (− số lượng, ghi ngày huỷ), đủ cột Plant / SLoc / mã NVL / lô / mẻ / người làm.',
            'Lọc theo ngày phát sinh, tìm theo mã NVL / mã lô / tem. **Xuất Excel** để làm việc với SAP.',
          ],
          images: [d('73-du-lieu-tho', 'Dữ liệu thô tiêu hao NVL')],
        },
        {
          title: 'C3. Đếm tồn theo ca',
          who: ['Trưởng ca'],
          text: [
            'Tab **Đếm tồn theo ca** → **Mở ca** (ngày, ca). Mỗi kho chỉ một ca đang mở.',
            '- Bảng tự tính: Tồn đầu (số đếm ca trước) · Nhập · Dùng theo từng mẻ · Tồn cuối sổ sách.',
            '- Cuối ca nhập **Tồn cuối thực tế** vào ô "đếm" → **Lưu số đếm** (lưu nháp lúc nào cũng được).',
            '- **Chốt ca**: chụp mọi con số, không sửa được nữa. Ca sau lấy số đếm ca này làm tồn đầu.',
            'Báo cáo không tự sửa tồn — chênh lệch chỉ để thấy; muốn khớp sổ thì kiểm kê / điều chỉnh tồn.',
          ],
          images: [d('75-mo-ca', 'Mở báo cáo ca'), d('75b-bao-cao-ca', 'Báo cáo ca đang mở: nhập số đếm')],
        },
        {
          title: 'C4. Truy xuất lô sản xuất',
          text: [
            'Vào **Báo cáo → Truy xuất lô** → nút **Sản xuất**. Tra theo **Tem thành phẩm**, **Tem nguyên liệu** hoặc **Mã lô bán thành phẩm**.',
            'Kết quả: mẻ, QA, mọi tem nguyên liệu đã vào mẻ (NSX, nhà cung cấp, lượng), bồn và các trang Sổ đóng gói đã rút BTP. Bấm tem thành phẩm để truy tiếp tới khách / xe.',
          ],
          images: [d('76-truy-xuat', 'Trang Truy xuất lô — nút Sản xuất'), d('77-gia-pha-san-xuat', 'Gia phả của mẻ B260003BD66')],
        },
      ],
    },
    {
      id: 'hoi-dap',
      title: 'D. Lỗi hay gặp',
      steps: [
        {
          title: '"Phiếu chưa đủ hai bước duyệt — chưa cấp nguyên liệu được"',
          text: ['Kho đang bật "Chặn theo từng bước". Nhờ trưởng ca bấm **Duyệt phiếu**, rồi QA bấm **QA duyệt**.'],
        },
        {
          title: '"Tem đang ở kho …, không ở kho của mẻ"',
          text: ['Pallet chưa chuyển sang kho chế biến. Chuyển hàng sang kho chế biến trước (phiếu chuyển kho / nhập kho), rồi quét lại.'],
        },
        {
          title: 'Quét tem bị báo "sai thứ tự FIFO"',
          text: ['Có tem nhập kho sớm hơn phải lấy trước. Mở **Lấy ở đâu** trong form cấp để biết tem / vị trí đúng.'],
        },
        {
          title: 'Nút "Nạp BTP vào bồn" bị khoá',
          text: ['Mở **⋮** trên trang mẻ, nút khoá ghi rõ còn thiếu gì: duyệt, nguyên liệu dưới mức lệch, ô bắt buộc của phiếu, chưa in tem, chưa quét đủ tem tại đúng bồn.'],
        },
        {
          title: 'Muốn đổi bồn của mẻ',
          text: ['Chưa nạp: **⋮ → Sửa / đổi bồn** (mã lô đổi theo, phải in lại tem). Đã nạp: dùng **Chuyển** ở trang Bồn.'],
        },
        {
          title: 'App tự về trang đăng nhập, báo "Mật khẩu tài khoản đã được đổi"',
          text: ['Mật khẩu tài khoản vừa được đổi (bởi quản trị hoặc chính bạn trên máy khác). Đăng nhập lại bằng mật khẩu mới.'],
        },
      ],
    },
  ],
}
