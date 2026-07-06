# Sinh PDF tài liệu bàn giao

Render các file Markdown trong `docs/handover/*.md` thành PDF (kèm ảnh + sơ đồ Mermaid) bằng Chromium của Playwright.

## Cách chạy

```bash
cd scripts/handover-pdf
npm i playwright marked          # lần đầu
npx playwright install chromium  # lần đầu
node md2pdf.js                   # render TẤT CẢ file .md
node md2pdf.js 04-user-guide.md  # render 1 file
```

PDF xuất ra `docs/handover/pdf/`. Footer tự đánh số trang. Sơ đồ Mermaid cần mạng (tải mermaid.js từ CDN jsdelivr lúc render).

## Quy trình cập nhật tài liệu
1. Sửa nội dung trong `docs/handover/*.md`.
2. Ảnh màn hình đặt trong `docs/handover/images/` (đường dẫn tương đối `images/xxx.png`).
3. Chạy lại `node md2pdf.js` → PDF mới trong `docs/handover/pdf/`.
