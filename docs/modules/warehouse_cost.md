# Chi phí kho (`warehouse_cost`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Chi phí kho

**Quyền (BE `ALL_PERMISSIONS`):** view · edit · lock · manage_item

## Giao thoa với
<!-- giao-thoa:start -->
- [`dashboard`](dashboard.md) — Dashboard (Tổng quan) (hai chiều)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

**Chi phí kho** (menu Tổng quan) — SỔ KÊ KHAI: 1 dòng = (Kho · Kỳ THÁNG · Khoản mục · Số tiền · Ghi chú), vd "Thuê xe nâng · Kho Ba Vì · tháng 8". Nuôi 4 ô tiền + cột Chi phí/tấn của tab Năng suất. **Bản LƯỚI 154 kho × 7 cột cứng đã BỎ (user bác 27/08: "phải theo dạng kê khai/upload excel")** — nay list page chuẩn + Upload Excel DÒNG (Tháng|Kho|Khoản mục|Số tiền|Ghi chú, 2 pha) + danh mục khoản mục tự thêm. **CỬA VÀO = PHIẾU (user chốt 27/08 vòng 2): 1 phiếu = 1 KHO × 1 KỲ THÁNG**, trang `/wms/warehouse-costs/:whKey/:period` (`whKey` = id kho hoặc `chung`) sửa CẢ CỤM tại chỗ rồi **Lưu một lần** (`PUT /wms/warehouse-costs/voucher` — xoá/thêm/sửa theo lô, XOÁ TRƯỚC rồi mới upsert vì đổi khoản mục dòng A thành khoản mục dòng B đang bị xoá sẽ đụng unique), **dán thẳng từ Excel** (Khoản mục ⇥ Số tiền ⇥ Ghi chú; tên đã có thì ĐÈ số, tên lạ bị bỏ qua + liệt kê — không tự đẻ khoản mục). Phiếu KHÔNG có bảng riêng: là NHÓM dẫn xuất của các dòng cùng (kho, kỳ), trạng thái chốt lấy từ `warehouse_cost_locks` đúng cặp đó ⇒ không có 2 nguồn sự thật. Danh sách phiếu đếm/cộng bằng **RPC `warehouse_cost_vouchers`** (migration `20260827f`) — 1 round-trip, KHÔNG kéo dòng thô về Node để tự cộng. Màn hình có 2 góc nhìn trên cùng dữ liệu: **Phiếu** (kho × kỳ) và **Dòng chi phí** (lọc Khoản mục trên KHOẢNG kỳ ≤ 24 tháng — "xem 1 loại chi phí qua tất cả các tháng"). Khoá nghiệp vụ `(kho, tháng, khoản mục)` unique ⇒ **mỗi khoản mục 1 dòng/tháng/kho**, khai lại là ĐÈ, upload lại không nhân đôi (dòng trùng TRONG FILE thì CỘNG DỒN + báo ở bước xem trước). Kỳ CHỐT theo từng kho = mọi đường ghi 409. Chi phí `warehouse_id = null` = CHUNG toàn công ty (chỉ user không giới hạn kho); **dòng từng kho chỉ mang tiền RIÊNG, ô tổng mới cộng phần chung** (migration `20260827c`). **TIỀN bị BE cắt khỏi payload năng suất nếu thiếu `warehouse_cost.view`** (`stripCost` — ẩn ở FE là chưa đủ)

## Actions

view, **edit**=thêm/sửa/xoá dòng + chép tháng trước + upload, **lock**=chốt/mở lại kỳ, **manage_item**=danh mục khoản mục ("Thuê pallet", "Thuê xe nâng"…) 
