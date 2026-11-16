# Đa đơn vị · định dạng tem QR



> Bản ĐẦY ĐỦ (lý do · số đo · lịch sử) của các luật chung, chép NGUYÊN VĂN từ CLAUDE.md ngày 28/09/2026. CLAUDE.md giữ bản rút gọn (luật phải làm) và trỏ về đây.

> Sửa luật: sửa CẢ bản rút gọn ở CLAUDE.md lẫn bản đầy đủ ở đây.



- Bảng `SystemSetting` + cờ `label_format` (`'underscore'`/`'semicolon'`) — điều khiển chiều IN tem **VÀ gate chiều QUÉT inbound** (`getLabelFormat` cache 30s; cờ `;` chỉ nhận tem `;`, `_` chỉ nhận tem `_` — quét nhầm format đơn vị khác → 422 `QR_FORMAT_MISMATCH`, ở cả preview + scan thật). Controller `systemSettingController.ts` (sổ cờ `KNOWN_SETTINGS`) + route `GET /wms/settings` (hở đọc) / `PUT /wms/settings/:key` (`wms_settings.manage_system`). FE: tab **"Hệ thống"** trong Cài đặt WMS (`useSystemSettings`/`useUpdateSystemSetting`, `SingleSelect`). Sinh tem MỚI từ app cho V2: ĐÃ LÀM (đợt 4 `95446d8`) — tab Sinh tem đọc cờ semicolon → form V2 (`buildQRv2`/`buildBatchV2` trong `palletLabel.tsx`): mã lô = `Material.batch_prefix` (2 ký tự, field MỚI) + yymmdd + Máy + STT; HSD auto = NSX+`shelf_life_days` (sửa được); **QR sinh ĐỦ 7 đoạn GIỮ FORMAT NHÀ MÁY `MãHàng;QA;Mã lô;NSX;HSD;Mẻ;Giờ:Phút`, QA+Giờ đệm space width 7 (tem in KHÔNG trim, chỉ trim khi bóc tách/so khớp qua `normalizeQR`)**; Mẻ = dropdown 1..10, Giờ:Phút input (mặc định 00:00); trong mã lô yymmdd = NGÀY NHẬP KHO (ô riêng, default hôm nay — KHÔNG phải NSX); chống trùng = cảnh báo như V1 (KHÔNG ràng dải Máy riêng). Ô "Mã tắt (mã lô)" form Mã hàng + cột 13 mẫu upload (`downloadMaterialTemplate`) chỉ hiện khi cờ=semicolon.

- **ĐỊNH HƯỚNG QR-tới-THÙNG (CHỐT 07/07, CHƯA build — chi tiết memory `qr-format-v2-semicolon`):** 1 pallet có thể có QR tới từng thùng (154 thùng→154 tem; hiện giống hệt nhau, tương lai có thể mỗi thùng 1 STT). **Quản thùng = HƯỚNG LAI**: tồn VẪN theo pallet (KHÔNG mỗi thùng 1 dòng — nổ quy mô), tem thùng chỉ để quét-đếm + (khi có STT) bảng log chống-trùng/truy-vết. **STT thùng (tương lai) = ĐOẠN `;` MỚI Ở CUỐI (đoạn 8)** — quy tắc: 7 đoạn=không STT, 8 đoạn=đoạn cuối là STT; `pallet_code` = mọi đoạn TRƯỚC STT. **Đuôi TÁCH pallet `.N` = ĐẶT Ở ĐUÔI MÃ LÔ (đoạn 3)** `TA260705A018.1` (KHÔNG cuối chuỗi), cột `batch` DB vẫn lưu mã lô gốc để khớp kế toán. ⚠️ NỢ: `splitPallet` V2 hiện gắn `.N` cuối chuỗi → đổi sang đuôi mã lô khi build phần thùng.

## Chuyển từ CLAUDE.md cũ (16/11/2026)

> Luật còn hiệu lực mà bản CLAUDE.md rút gọn ngày 16/11 không nhắc lại. Chép nguyên văn từ `docs/rules/claude-md-full-2026-11-16.md`.

**1 codebase phục vụ NHIỀU đơn vị độc lập** — mỗi đơn vị 1 Supabase + 1 Vercel + 1 link riêng (cách ly dữ liệu tuyệt đối). **TUYỆT ĐỐI KHÔNG `if (tenant === 'X')`, không fork/copy project.** Khác biệt giữa đơn vị xử bằng **cờ theo KHÁC BIỆT** (không theo tên đơn vị) trong bảng `SystemSetting` (key-value jsonb, per-DB). Kiến trúc + thang xử lý khác biệt 5 bậc: memory `multi-tenant-silo-architecture`. Khác biệt ĐÃ CÓ THẬT hiện nay = **định dạng tem/QR pallet** (memory `qr-format-v2-semicolon`).

**2 định dạng QR sống chung VÔ THỜI HẠN** (tồn cũ toàn V1; đơn vị mỗi bên 1 format cố định):

| | **V1 — Đơn vị 1 (LOF), delimiter `_`** | **V2 — Đơn vị 2, delimiter `;`** |
|---|---|---|
| Ví dụ | `070526_510000127_C05_M1_001_B` | `50033;      1;TA260705A018;05/07/2026;05/03/2027;      1;05:26` |
| Cấu trúc | `ddmmyy_MãHàng_ChuKỳ_<Máy\|MãNCC>_STT_NMSX` | `MãHàng;QA;MãLô;NSX;HSD;Mẻ;Giờ:Phút` (7 đoạn, **có đệm SPACE → phải trim**) |
| Đoạn ý nghĩa | 1=ngày SX ddmmyy · 2=mã hàng · 3=chu kỳ · **4=Máy (thành phẩm) HOẶC mã NCC (hàng NCC: POSM/Raw/Thùng/Giấy)** · 5=STT pallet · 6=NMSX (hàng NCC: nơi nhận đầu) | 1=mã hàng · **2=QA (1=OK, 0/khác=X)** · **3=Mã lô** (`2 ký tự tắt hàng`+`yymmdd`+`Máy 1 ký tự`+`SEQ 3 số`, vd TA+260705+A+018) · 4=NSX dd/mm/yyyy · 5=HSD dd/mm/yyyy · 6+7=giờ:phút:giây SX |
| HSD / %Date | suy từ NSX + shelf-life (mã/NCC) | **HSD tường minh trên tem** → %Date dùng thẳng HSD (không cần khai shelf-life mã) |
| Mã lô (batch) | không có (cột `batch`=null) | **= khóa liên kết KẾ TOÁN/ERP** (kế toán chỉ giữ mã lô `TA260705A018`); khớp qua import/API sau khi có kết nối |
| NCC | đoạn 4 (hàng NCC) → tự resolve khi quét | tem KHÔNG mang NCC → chọn tay nếu cần |

**PARSE PHẢI TẬP TRUNG — KHÔNG tự `split('_')`/`split(';')` rải rác (nếu không, sửa 1 chỗ sẽ đè/lệch chỗ khác):**
- **BE:** `backend/src/utils/qrParser.ts` — `parseInboundQR(raw)` tự nhận nhánh theo delimiter, trả `ParsedQR` (có `format:'v1'|'v2'`, `qa_ok`, `batch`, `expiry_date`, `machine_code`, `pallet_sequence_no`…) + `normalizeQR(raw)` = **CHỈ trim NGOÀI, GIỮ đệm space bên trong** (pallet_code lưu ĐÚNG như QR quét ra — user chốt "QR quét sao lưu vậy"; trim từng đoạn CHỈ khi bóc tách field trong `parseV2`, KHÔNG khi lưu/khớp). MỌI điểm quét gọi `normalizeQR` trước khi khớp `pallet_code`: inbound scan, outbound scan (`checkScanItem`/`scanItem`), inventory `stocktakeCheck`, pallet-ops `merge`/`ungroup`/`split`.
- **FE:** `frontend/src/utils/qr.ts` — `normalizeQR` / `materialCodeOf(code)` (V2=đoạn 0, V1=đoạn 1) / `isValidDMY`; `frontend/src/components/shared/palletLabel.tsx` — `parseCodeFields(code)` (bóc trường hiển thị 2 format, QR luôn mã hóa NGUYÊN VĂN `pallet_code` nên scan không phụ thuộc). `InboundScanSheet` validate cả 2; `PalletLabels` (entryToLabel/logRowToLabel/auditSummary) + render tem V2 (Mã lô + HSD, đáy 2 ô Máy/Số pallet).
- **%Date TẬP TRUNG:** `computePctDate(entry, material, now)` ở `shelfLife.ts` (BE + FE KHỚP NHAU) — ưu tiên `expiry_date` tường minh (mẫu số HSD−NSX) → fallback NSX+shelflife (V1 kết quả không đổi). Áp mọi nơi tính %Date (inventory list/facets/summary, outbound check/scan/prepare, FE Inventory/PalletDetailDialog/StocktakeDashboard). **Sửa công thức %Date = sửa 1 hàm này**, đừng viết lại rời.

**Cờ & hạ tầng:**
- Cột: `InventoryEntry.batch` (mã lô V2, null với V1) + `InventoryEntry.expiry_date` (HSD V2) — migration `20260707_systemsetting_qr_v2.sql`.
- Bảng `SystemSetting` + cờ `label_format` (`'underscore'`/`'semicolon'`) điều khiển chiều IN tem **và** gate chiều QUÉT inbound (quét nhầm format ⇒ 422 `QR_FORMAT_MISMATCH`); sổ cờ `KNOWN_SETTINGS` (`systemSettingController.ts`), route `GET/PUT /wms/settings/:key`, tab Hệ thống ở Cài đặt WMS; sinh tem V2 đủ 7 đoạn giữ format nhà máy (`buildQRv2`/`buildBatchV2`). Chi tiết: [docs/rules/multi-tenant-qr.md](docs/rules/multi-tenant-qr.md).
- **Luật vàng chống đè:** mọi thay đổi liên quan format QR phải đi qua các helper tập trung trên (BE↔FE giữ KHỚP NHAU); thêm điểm quét mới → BẮT BUỘC `normalizeQR`; thêm cờ khác biệt mới → thêm vào `KNOWN_SETTINGS` (sổ cờ) + default = hành vi V1 cũ (đơn vị 1 không đổi).
