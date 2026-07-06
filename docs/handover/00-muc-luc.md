# Bộ tài liệu bàn giao — Hệ thống WMS/TMS/HR

> Phiên bản: 1.0 · Ngày lập: 06/07/2026 · Ngôn ngữ: Tiếng Việt

Bộ tài liệu gồm 6 quyển, đọc theo thứ tự:

| # | Tài liệu | Dành cho | Nội dung |
|---|----------|----------|----------|
| 1 | [Tổng quan hệ thống](01-tong-quan.md) | Quản lý, IT, người mới | Mục đích, kiến trúc, danh sách module, mô hình phân quyền, thuật ngữ |
| 2 | [Workflow nghiệp vụ](02-workflow-nghiep-vu.md) | Quản lý vận hành, key-user | Sơ đồ Mermaid các luồng: nhập, xuất, chuyển kho, cổng, kiểm kho, HR |
| 3 | [SOP vận hành theo vai trò](03-sop-van-hanh.md) | Từng vị trí vận hành | Quy trình chuẩn từng bước cho 8 vai trò |
| 4 | [User Guide từng màn hình](04-user-guide.md) | Mọi người dùng | Hướng dẫn chi tiết từng trang, từng nút, kèm ảnh chụp màn hình |
| 5 | [FAQ — Câu hỏi thường gặp](05-faq.md) | Mọi người dùng | Giải đáp các thắc mắc phổ biến |
| 6 | [Troubleshooting — Xử lý sự cố](06-troubleshooting.md) | Key-user, IT hỗ trợ | Triệu chứng → nguyên nhân → cách xử lý |

**Ảnh chụp màn hình** nằm trong thư mục `images/` — chụp từ hệ thống thật (dữ liệu minh họa là dữ liệu vận hành thực tế tại thời điểm lập tài liệu).

**Chuyển thành PDF:** dùng Typora / Obsidian (in từng file) hoặc pandoc:

```bash
pandoc 01-tong-quan.md -o 01-tong-quan.pdf --pdf-engine=xelatex -V mainfont="Times New Roman"
```

Sơ đồ Mermaid cần trình render hỗ trợ (Typora hỗ trợ sẵn; pandoc cần `mermaid-filter`).
