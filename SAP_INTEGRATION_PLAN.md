# Kế hoạch tích hợp SAP S/4HANA ↔ WMS

> Soạn 19/07/2026. Đi kèm file **"Câu hỏi tích hợp SAP - WMS.docx"** (bộ câu hỏi A–G gửi đội IT/SAP).
> Nguyên tắc chốt: **mỗi bên chỉ PULL từ bên kia** — không bên nào giữ credential GHI của bên kia; delta + phân trang ở cả 2 chiều; sai thì chạy lại không hỏng dữ liệu (idempotent).

---

## 1. Bức tranh tổng — 2 chiều, 1 chiều ĐÃ XONG

```
┌────────────────┐   Chiều 1 (ĐÃ CHẠY PRODUCTION)      ┌────────────────┐
│                │ ◄── SAP/CPI gọi API key ──────────── │                │
│   SAP S/4HANA  │     /api/integration/v1/*            │   WMS (app này)│
│                │                                      │                │
│                │ ──── Chiều 2 (CHƯA XÂY) ──────────►  │                │
│  OData/CPI     │      WMS kéo OData delta             │  Connector SAP │
└────────────────┘                                      └────────────────┘
```

### Chiều 1 — SAP lấy số liệu từ WMS (ĐÃ XONG, production 16/07)
- Cổng `/api/integration/v1` — xác thực **API key** (tạo ở trang Quản trị → Khóa tích hợp, superadmin), scope theo nhóm.
- 5 endpoint read-only: `materials` · `inventory` · `inbound-receipts` · `outbound-orders` · `scan-entries` (+ `weigh:write` cho trạm cân).
- **Delta + phân trang sẵn**: `?updated_since=<ISO>` lần đầu → lặp `next_cursor` tới null. Mặc định 500 dòng/trang.
- `inventory` trả kèm **`batch` (mã lô) + `expiry_date`** — đúng khóa đối chiếu kế toán (tem V2: kế toán chỉ giữ mã lô dạng `TA260705A018`).
- Tài liệu cho IT: nút **"Hướng dẫn API"** ngay trên trang quản key.
- Multi-tenant SILO: **mỗi đơn vị 1 URL + 1 bộ key riêng** — SAP muốn gộp thì gọi từng URL rồi tự gộp.

### Chiều 2 — WMS kéo dữ liệu từ SAP (CHƯA XÂY — mục tiêu kế hoạch này)
WMS chủ động gọi OData của S/4HANA theo lịch, kéo **delta** rồi upsert vào bảng của mình. Thay thế dần việc upload Excel tay.

---

## 2. Mapping nghiệp vụ WMS ↔ SAP (thứ tự rollout đề xuất)

| Ưu tiên | Dữ liệu | SAP object / OData chuẩn (gợi ý — IT xác nhận ở mục F của docx) | Đích trong WMS | Thay thế |
|---|---|---|---|---|
| **1** | Mã hàng | Material Master — `API_PRODUCT_SRV` | bảng `Material` (upsert theo `material_code`, ô trống giữ giá trị cũ — đúng semantics upload Excel hiện tại) | Upload Excel Mã hàng |
| **2** | NCC / ĐVVT / Khách | Business Partner — `API_BUSINESS_PARTNER` | `TransportCompany` (khớp `code` HOẶC `alias_codes` — 1 đối tác nhiều mã ERP đã hỗ trợ sẵn) | Upload Excel NCC/ĐVVT |
| **3** | Kế hoạch XUẤT (SO / Outbound Delivery) | `API_SALES_ORDER_SRV` hoặc `API_OUTBOUND_DELIVERY_SRV` | luồng tạo KH xuất (như upload Excel KH xuất: NPP là khóa tách dòng, shipto verbatim) | Upload Excel KH xuất hằng ngày |
| **4** | Kế hoạch NHẬP (PO / Inbound Delivery) | `API_PURCHASEORDER_PROCESS_SRV` / `API_INBOUND_DELIVERY_SRV` | KH nhập / nhóm phiếu NCC | Upload KH nhập |
| **5** | Ghi ngược THỰC XUẤT/NHẬP vào SAP (post GR/GI) | `API_MATERIAL_DOCUMENT_SRV` / BAPI_GOODSMVT_CREATE | **KHÔNG làm từ WMS** (khuyến nghị) — SAP tự kéo `scan-entries`/`inbound-receipts` qua Chiều 1 rồi post nội bộ (job CPI/ABAP) | Nhập tay số liệu vào SAP |

> **Vì sao mục 5 khuyến nghị để SAP tự post:** WMS không phải giữ technical user có quyền GHI vào SAP (rủi ro + quy trình phê duyệt lâu); mọi số thực quét đã sẵn qua cổng pull (kèm mã lô); logic posting (movement type, plant, storage location, kỳ kế toán đóng/mở) nằm trọn bên SAP — nơi hiểu nó nhất. Nếu sau này SAP nhất quyết yêu cầu WMS đẩy, mới mở scope write chiều 2.

**Tồn kho & mã lô:** WMS là **nguồn sự thật tồn vật lý theo pallet**; SAP là nguồn sự thật **kế toán**. Đối chiếu qua `batch` (mã lô) + `material_code` — không đồng bộ tồn 2 chiều (chỉ đối chiếu, lệch thì điều tra).

---

## 3. Kiến trúc phần WMS sẽ xây (Chiều 2) — khi IT trả lời đủ

Thành phần mới (per-silo, cờ trong `SystemSetting` — KHÔNG if-tenant):
1. **Bảng `ErpSyncState`** — 1 dòng/stream (`material`, `partner`, `so`, `po`): cursor/delta token, `last_sync_at`, `last_error`, đếm bản ghi. Migration mới.
2. **Connector `backend/src/services/sapClient.ts`** — OData client: auth (Basic/OAuth2 theo câu D1), `$filter=LastChangeDateTime gt <since>`, `$skiptoken`/phân trang, retry + backoff. Credentials để trong **Vercel env** (per-silo), không hardcode.
3. **Job đồng bộ** — endpoint `POST /api/integration/sync/:stream` (bảo vệ bằng secret nội bộ) + **Vercel Cron** gọi theo lịch (vercel.json — hiện chưa có cron nào; tần suất tùy plan Vercel, tối thiểu 1 lần/ngày cho master data, 15–30' cho đơn hàng). Mỗi lần chạy: kéo delta → **upsert theo LÔ chunk ~500** (luật bulk hiện hành) → cập nhật `ErpSyncState`.
4. **Màn hình "Đồng bộ SAP"** — tab trong Cài đặt WMS (quyền mới `wms_settings.manage_erp_sync`): trạng thái từng stream, lần chạy cuối, lỗi gần nhất, nút "Chạy ngay". Đủ 5 việc phân quyền như luật.
5. **Test QAS trước**: đấu S/4 QAS ↔ WMS staging (branch dev) → user nghiệm thu → mới trỏ production ↔ production. Khớp quy trình 2 môi trường sẵn có.

Điều kiện hạ tầng phải chốt trước khi code (từ câu trả lời của IT):
- **C1**: endpoint SAP gọi được từ internet? (WMS chạy Vercel cloud — KHÔNG có IP tĩnh mặc định; nếu SAP đòi IP allowlist thì cần proxy có IP tĩnh hoặc SAP Cloud Connector/API Gateway phía họ. Đây là câu sống còn.)
- **D1**: Basic hay OAuth2 (client credentials) — quyết cách viết sapClient.
- **E1**: có lọc delta không — không có thì master data nhỏ vẫn kéo full được, nhưng đơn hàng bắt buộc phải có delta.

---

## 4. Phân công WMS ↔ đội IT/SAP

| Việc | WMS (bên mình) | IT/SAP |
|---|---|---|
| Trả lời bộ câu hỏi A–G (docx) | gửi file, giải thích | ✅ điền |
| Mở network + cấp endpoint QAS/PROD | — | ✅ (C1–C3) |
| Cấp technical user + quyền đọc theo mục F | liệt kê nhóm dữ liệu (đã có trong docx) | ✅ |
| Gửi $metadata / tài liệu field từng service | — | ✅ (F1) |
| Mapping field SAP → field WMS từng nhóm | ✅ dựng bảng mapping, IT review | ✅ review |
| Connector + job + màn hình Đồng bộ (Chiều 2) | ✅ code | — |
| Kéo số liệu WMS (Chiều 1) + post GR/GI vào SAP | cấp API key + Hướng dẫn API (đã sẵn) | ✅ dựng job CPI/ABAP |
| Test đối chiếu trên QAS (đơn mẫu chạy xuyên suốt) | ✅ | ✅ |

---

## 5. Kịch bản buổi làm việc với IT (30–45 phút)

1. **Mở đầu (5')** — bối cảnh: WMS cloud quản kho vật lý theo pallet/tem QR; cần 2 chiều: WMS kéo master data + đơn hàng từ SAP; SAP kéo số thực xuất/nhập/tồn (kèm mã lô) từ WMS qua API đã có sẵn.
2. **Chốt 3 câu quyết định (15')** — C1 (gọi từ internet được không / cách nào), D1 (xác thực gì), F+E1 (tên OData service từng nhóm + có delta không). *Có 3 câu này là đủ chốt kiến trúc.*
3. **Demo Chiều 1 (10')** — mở trang Khóa tích hợp, tạo key demo, gọi thử `GET /api/integration/v1/inventory?limit=5` cho IT xem cấu trúc JSON + mã lô; đưa nút "Hướng dẫn API".
4. **Thống nhất cách post GR/GI (10')** — đề xuất SAP tự kéo rồi post (mục 2.5); hỏi họ có ràng buộc gì (kỳ đóng sổ, movement type, batch bắt buộc khớp…).
5. **Chốt đầu mối + hẹn deliverable** — IT gửi lại docx đã điền + $metadata + tài khoản QAS; hẹn ngày test kết nối đầu tiên.

**Câu nói mở đầu gợi ý:** *"Bên kho đã có sẵn cổng API cho SAP kéo số liệu thực xuất/nhập kèm mã lô — phía anh chỉ cần dựng job gọi vào. Ngược lại, để kho hết nhập Excel tay, bên em cần kéo mã hàng và đơn hàng từ S/4 qua OData — em gửi 1 trang câu hỏi, anh tick giúp 3 mục quan trọng nhất là mạng, xác thực và tên service."*

---

## 6. Lộ trình & điều kiện bắt đầu code

| Giai đoạn | Nội dung | Bắt đầu khi |
|---|---|---|
| G0 (xong) | Cổng pull Chiều 1 + key + tài liệu | ✅ production 16/07 |
| G1 | Gửi docx → nhận trả lời + QAS + technical user | ngay bây giờ |
| G2 | Connector Material (mã hàng) trên staging + màn hình Đồng bộ | có C1/D1/F + QAS |
| G3 | Business Partner + KH xuất + KH nhập | G2 nghiệm thu |
| G4 | SAP dựng job post GR/GI từ dữ liệu Chiều 1; test đối chiếu QAS | song song G2–G3 (phía SAP) |
| G5 | Trỏ production, cắt dần upload Excel | 2 tuần chạy song song không lệch |

---

## 7. Mô hình dữ liệu XUẤT/NHẬP theo OD & STO (chốt hướng 19/07)

Phía SAP xác nhận: **OD (Outbound Delivery) = khóa giao dịch mua bán; PO loại STO (Stock Transport Order) = khóa trung chuyển giữa kho.** Hiện WMS upload Excel theo "Group OD" (gom nhiều OD thành 1 chuyến).

### Nguyên tắc khớp mô hình
- **OD (SAP) ↔ DO (WMS) 1-1** — `OutboundDelivery.do_code` = số OD. Số thực quét trả về SAP cũng theo OD để họ post PGI từng OD.
- **GDO (chuyến xe) = khái niệm RIÊNG của WMS** (điều vận gom OD nào đi chung xe) — SAP không quản chuyến, KHÔNG bắt SAP thêm trường "group". *(Ngoại lệ: nếu SAP có dùng Shipment/Freight Order (SAP TM) để gom sẵn — hỏi IT, có thì kéo luôn nhóm, đỡ gom tay.)*
- **Trung chuyển**: STO number = khóa liên kết; STO thường sinh OD riêng (movement 641/643) → WMS xuất theo OD đó, luồng chuyển kho nội bộ hiện có (auto TmsOrder + KH nhập kho đích khi ship-to = kho nội bộ) giữ nguyên; kho đích nhận xong → SAP post GR đối ứng STO. Cần lưu thêm **tham chiếu STO** trên đơn WMS.
- **NPP vẫn là khóa tách dòng** (luật 04/07): ship-to party của OD → resolve NPP (đã có sẵn shipto verbatim + `Warehouse.shipto_codes`).

### Cấu trúc dữ liệu WMS cần từ mỗi OD (mức dòng hàng)
| Trường | Từ SAP | Ghi chú |
|---|---|---|
| `od_number` + `od_item_no` | OD | khóa chính dòng |
| `so_number` / `sto_number` | SO gốc / STO | phân loại mua bán vs trung chuyển + khóa đối chiếu |
| `ship_to_code`, `ship_to_name` | Ship-to party | resolve NPP / kho nội bộ |
| `material_code` | Material | khớp `Material.material_code` |
| `qty` + `uom` | số lượng + đơn vị | ⚠️ BẪY UoM: WMS quản THÙNG + lẻ; SAP có thể là EA/CS — phải chốt đơn vị trong OD & hệ số quy đổi (WMS có `units_per_carton`) |
| `batch` | nếu SAP chỉ định lô | map cột Batch yêu cầu hiện có |
| `delivery_date` | ngày giao kế hoạch | ngày chuyến |
| `plant` + `storage_location` | | map → kho WMS (bảng map cần IT cấp danh sách plant/SLoc) |

### Lộ trình chuyển đổi cách nhập KH xuất (đề xuất — ít rủi ro nhất)
1. **GĐ A — Đối chiếu (không đổi thao tác):** giữ nguyên upload Excel Group OD như hiện nay; WMS kéo OD từ SAP về bảng staging `erp_outbound_orders` (pool) và **đối chiếu**: OD trong Excel không có trên SAP / lệch số lượng / lệch mã → cảnh báo đỏ ngay lúc upload. Chạy 2–4 tuần để tin dữ liệu.
2. **GĐ B — Excel rút gọn:** file upload chỉ còn cột **OD + chuyến/biển số** (gom chuyến); toàn bộ chi tiết dòng hàng (mã, SL, NPP, batch) lấy từ OD đã kéo về — hết sai chính tả/copy nhầm.
3. **GĐ C — Gom chuyến trên màn hình:** bỏ Excel; trang "Đơn chờ xếp chuyến" (pool OD theo ngày giao/NPP/tuyến) → tick chọn → tạo GDO. Điều vận làm trực tiếp trên WMS.

### UoM — quy tắc quy đổi (chốt brainstorm 19/07, user xác nhận thực tế SAP)
SAP nhiều đơn vị theo loại hàng: **thành phẩm = THUNG + HOP** (THUNG ↔ Thùng/CAR của WMS; phần lẻ SAP tính bằng HOP và **WMS phải xuất theo hộp**); **NVL = EA/KG/BAG…** tùy mã.
- OD line **THUNG** → thùng nguyên WMS; OD line **HOP** → **số nhặt lẻ** (luồng Nhặt lẻ, đơn vị hộp); NVL → kho QTY/QTY_DATE nhận số thẳng theo `Material.unit`.
- ⇒ Kéo từ SAP sẽ **hết thập phân** (515.5 thùng hiện nay là hệ quả cách upload Excel tự quy đổi, không phải bản chất). Chiều trả về SAP: post PGI đúng 2 đơn vị (thùng thực quét = THUNG, lẻ thực soạn = HOP).
- **Bắt buộc:** hệ số `1 THUNG = N HOP` (Alternative UoM trong Material master SAP) phải khớp `units_per_carton` WMS — khi kéo Mã hàng, kéo luôn conversion để **ĐỐI CHIẾU, lệch = cảnh báo, KHÔNG tự sửa**. Đưa vào checklist GĐ A.

### Batch — khớp MỀM date + chu kỳ (chốt brainstorm 19/07)
SAP batch xác định theo **Date + chu kỳ**; date SAP vs date tem WMS **chênh được 1–3 ngày, chu kỳ thì khớp**.
- Quy tắc: **chu kỳ = khớp CỨNG** (bằng tuyệt đối) · **date = khớp MỀM** (cửa sổ ≤3 ngày, nhiều ứng viên → chọn gần ngày nhất).
- Logic khớp đặt ở **phía SAP/CPI** (đúng hướng SAP-tự-post); WMS trả nguyên liệu: scan entry kèm `production_date` + `cycle` (hiện parse được từ `pallet_code`; **nợ nhỏ**: thêm 2 cột phẳng vào export scan-entries cho SAP đỡ parse).
- Áp cho đơn vị 1 (tem `_` V1). Đơn vị 2 (tem `;` V2) có mã lô tường minh → khớp thẳng, không cần cửa sổ.

### Câu hỏi bổ sung cho IT (ngoài docx)
1. STO có sinh Outbound Delivery không, hay xuất thẳng theo PO? (quyết luồng trung chuyển)
2. UoM: xin **bảng Alternative UoM per material** ($metadata + conversion THUNG↔HOP, và base UoM từng mã NVL) để đối chiếu `units_per_carton`.
3. OD có batch split (1 dòng nhiều lô) không? WMS quét tem thực tế sẽ trả lô THẬT — SAP chấp nhận lô khác đề xuất không?
4. **Batch:** trong cùng 1 chu kỳ, có bao giờ 2 batch cách nhau ≤3 ngày không? (nếu có, cửa sổ khớp mềm ±3 ngày sẽ mơ hồ — cần tie-break)
5. Có dùng Shipment / Freight Order (SAP TM) gom chuyến sẵn không?
6. Trạng thái OD nào thì WMS được phép kéo về soạn hàng (created / picked / released)? Và OD bị SỬA/HỦY sau khi WMS đã kéo → báo qua delta thế nào?
7. Chiều nhập MUA từ NCC: khóa là PO + Inbound Delivery hay chỉ PO? (để dựng KH nhập)
