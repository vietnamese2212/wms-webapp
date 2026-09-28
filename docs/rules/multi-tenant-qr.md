# Đa đơn vị · định dạng tem QR



> Bản ĐẦY ĐỦ (lý do · số đo · lịch sử) của các luật chung, chép NGUYÊN VĂN từ CLAUDE.md ngày 28/09/2026. CLAUDE.md giữ bản rút gọn (luật phải làm) và trỏ về đây.

> Sửa luật: sửa CẢ bản rút gọn ở CLAUDE.md lẫn bản đầy đủ ở đây.



- Bảng `SystemSetting` + cờ `label_format` (`'underscore'`/`'semicolon'`) — điều khiển chiều IN tem **VÀ gate chiều QUÉT inbound** (`getLabelFormat` cache 30s; cờ `;` chỉ nhận tem `;`, `_` chỉ nhận tem `_` — quét nhầm format đơn vị khác → 422 `QR_FORMAT_MISMATCH`, ở cả preview + scan thật). Controller `systemSettingController.ts` (sổ cờ `KNOWN_SETTINGS`) + route `GET /wms/settings` (hở đọc) / `PUT /wms/settings/:key` (`wms_settings.manage_system`). FE: tab **"Hệ thống"** trong Cài đặt WMS (`useSystemSettings`/`useUpdateSystemSetting`, `SingleSelect`). Sinh tem MỚI từ app cho V2: ĐÃ LÀM (đợt 4 `95446d8`) — tab Sinh tem đọc cờ semicolon → form V2 (`buildQRv2`/`buildBatchV2` trong `palletLabel.tsx`): mã lô = `Material.batch_prefix` (2 ký tự, field MỚI) + yymmdd + Máy + STT; HSD auto = NSX+`shelf_life_days` (sửa được); **QR sinh ĐỦ 7 đoạn GIỮ FORMAT NHÀ MÁY `MãHàng;QA;Mã lô;NSX;HSD;Mẻ;Giờ:Phút`, QA+Giờ đệm space width 7 (tem in KHÔNG trim, chỉ trim khi bóc tách/so khớp qua `normalizeQR`)**; Mẻ = dropdown 1..10, Giờ:Phút input (mặc định 00:00); trong mã lô yymmdd = NGÀY NHẬP KHO (ô riêng, default hôm nay — KHÔNG phải NSX); chống trùng = cảnh báo như V1 (KHÔNG ràng dải Máy riêng). Ô "Mã tắt (mã lô)" form Mã hàng + cột 13 mẫu upload (`downloadMaterialTemplate`) chỉ hiện khi cờ=semicolon.

- **ĐỊNH HƯỚNG QR-tới-THÙNG (CHỐT 07/07, CHƯA build — chi tiết memory `qr-format-v2-semicolon`):** 1 pallet có thể có QR tới từng thùng (154 thùng→154 tem; hiện giống hệt nhau, tương lai có thể mỗi thùng 1 STT). **Quản thùng = HƯỚNG LAI**: tồn VẪN theo pallet (KHÔNG mỗi thùng 1 dòng — nổ quy mô), tem thùng chỉ để quét-đếm + (khi có STT) bảng log chống-trùng/truy-vết. **STT thùng (tương lai) = ĐOẠN `;` MỚI Ở CUỐI (đoạn 8)** — quy tắc: 7 đoạn=không STT, 8 đoạn=đoạn cuối là STT; `pallet_code` = mọi đoạn TRƯỚC STT. **Đuôi TÁCH pallet `.N` = ĐẶT Ở ĐUÔI MÃ LÔ (đoạn 3)** `TA260705A018.1` (KHÔNG cuối chuỗi), cột `batch` DB vẫn lưu mã lô gốc để khớp kế toán. ⚠️ NỢ: `splitPallet` V2 hiện gắn `.N` cuối chuỗi → đổi sang đuôi mã lô khi build phần thùng.

