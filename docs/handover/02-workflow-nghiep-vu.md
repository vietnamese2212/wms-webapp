# 2. Workflow nghiệp vụ (Process Flowchart)

> Đọc kèm [01-tong-quan.md](01-tong-quan.md) (thuật ngữ) và [03-sop-van-hanh.md](03-sop-van-hanh.md) (thao tác từng bước).

## 2.0. Quy ước ký hiệu

Toàn bộ sơ đồ trong tài liệu dùng ký hiệu chuẩn của lưu đồ quy trình (process flowchart):

```mermaid
flowchart LR
    S(["Bắt đầu / Kết thúc"]):::startend --> A["Hành động / Nhiệm vụ"]:::action
    A --> D{"Quyết định?"}:::decision
    D -->|Có| E["Nhánh Có"]:::action
    D -->|Không| F["Nhánh Không"]:::action
    classDef startend fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d
    classDef action fill:#e0f2fe,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e
    classDef decision fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
```

| Ký hiệu | Ý nghĩa |
|---|---|
| Hình chữ nhật **bo tròn góc** (xanh lá) | Điểm **Bắt đầu / Kết thúc** quy trình |
| Hình **chữ nhật** (xanh dương) | Một **Hành động / Nhiệm vụ** cụ thể |
| Hình **thoi** (vàng) | Điểm **Quyết định** — phân nhánh Có/Không |
| **Mũi tên →** | **Luồng** đi và hướng của quy trình |

---

## 2.1. Bức tranh tổng — hàng hóa chảy qua hệ thống

```mermaid
flowchart TD
    A(["Sản xuất / NCC"]):::startend --> B["In tem QR pallet"]:::action
    B --> C["Nhập kho: quét QR vào vị trí"]:::action
    C --> D["Tồn kho theo pallet + vị trí"]:::action
    D --> E["Xuất kho: quét QR ra khỏi kho"]:::action
    E --> F{"Ship-to là kho NPP\ncó quản tồn?"}:::decision
    F -->|Không| G(["Xuất bán — khách/NPP ngoài hệ thống"]):::startend
    F -->|Có| H["TMS tự sinh lệnh chuyển kho"]:::action
    H --> I["Kho NPP: nhận hàng, quét QR nhập lại"]:::action
    I --> J(["Tồn kho tại kho NPP"]):::startend
    classDef startend fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d
    classDef action fill:#e0f2fe,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e
    classDef decision fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
```

---

## 2.2. Nhập kho từ NCC (qua cổng)

```mermaid
flowchart TD
    S(["Bắt đầu"]):::startend --> A["Tạo Đăng ký cổng hướng NHẬP\n(kho, loại xe, NCC, biển số)"]:::action
    A --> B["Gọi xe vào"]:::action
    B --> C["Bảo vệ: xác nhận xe VÀO"]:::action
    C --> D["Tạo phiếu nhập → tab Nhập NCC\n(chọn xe cổng + NCC)"]:::action
    D --> E{"Có kế hoạch nhập?"}:::decision
    E -->|Có| F["Nạp từ kế hoạch\n(gộp SL cùng mã)"]:::action
    E -->|Không| G["Nhập tay danh sách mã + SL dự kiến"]:::action
    F --> H["Tạo N phiếu nhập\n(1 phiếu / 1 mã, nhóm theo chuyến)"]:::action
    G --> H
    H --> I["Mở phiếu → Chọn vị trí"]:::action
    I --> J["Quét QR từng pallet\n(đúng định dạng, đúng mã, chưa nhập)"]:::action
    J --> K{"Đủ số kế hoạch?"}:::decision
    K -->|Chưa| J
    K -->|Đủ| L["Hoàn thành phiếu\n(đối chiếu KH vs thực)"]:::action
    L --> M["Bảo vệ: xác nhận xe RA + tải trọng"]:::action
    M --> N(["Số liệu vào Tồn kho + Báo cáo nhập"]):::startend
    classDef startend fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d
    classDef action fill:#e0f2fe,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e
    classDef decision fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
```

> **Ràng buộc:** 1 lượt xe = 1 nhóm phiếu cho MỖI NCC (xe ghép nhiều NCC → nhiều nhóm; trùng NCC dùng "Sửa nhóm"). Pallet đã quét ở phiếu khác sẽ bị từ chối.

---

## 2.3. Nhập kho sản xuất (SX) & hàng không QR

```mermaid
flowchart TD
    S(["Bắt đầu"]):::startend --> A["Tạo phiếu → tab Nhập SX\n(Kho, Loại kho, Mã hàng, Ca, Ngày)"]:::action
    A --> B{"Mã có QR\nvà kho chế độ QR?"}:::decision
    B -->|Có QR| C["Chọn vị trí nhập (★ gợi ý)"]:::action
    C --> D["Quét QR pallet\n(số thùng tự điền theo quy cách)"]:::action
    D --> E{"Còn pallet?"}:::decision
    E -->|Còn| D
    E -->|Hết| F["Hoàn thành phiếu"]:::action
    B -->|"No-QR / kho QTY"| G["Không cần vị trí →\nLưu thủ công TỔNG số thùng (1 lần)"]:::action
    G --> F
    F --> T(["Kết thúc"]):::startend
    classDef startend fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d
    classDef action fill:#e0f2fe,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e
    classDef decision fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
```

---

## 2.4. Xuất kho — vòng đời một chuyến (GDO)

```mermaid
flowchart TD
    S(["Bắt đầu"]):::startend --> A["Upload Excel KH xuất / Tạo đơn tay\n(mỗi Số xe = 1 chuyến)"]:::action
    A --> B["Giao đơn (assign)"]:::action
    B --> C["Bắt đầu: chọn xe từ Đăng ký cổng XUẤT\n+ người xuất, lái xe nâng, bốc xếp"]:::action
    C --> D["Chuẩn bị hàng: board gợi ý vị trí FEFO"]:::action
    D --> E["Quét QR từng pallet theo mã hàng"]:::action
    E --> F{"Có hàng lẻ?"}:::decision
    F -->|Có| G["Quét/nhập phần lẻ → Check nhặt lẻ\n(mới trừ tồn phần lẻ)"]:::action
    F -->|Không| H
    G --> H{"Mọi mã đủ số?"}:::decision
    H -->|"Thiếu"| I["Sửa đơn: hạ SL kế hoạch = thực xuất"]:::action
    I --> H
    H -->|Đủ| J["Hoàn thành chuyến"]:::action
    J --> K{"Ship-to là kho\ncó quản tồn?"}:::decision
    K -->|Có| L["Tự sinh LỆNH CHUYỂN KHO TMS\n+ KH nhập kho đích + slot xe"]:::action
    K -->|Không| M(["Kết thúc — xuất bán thường"]):::startend
    L --> N(["Chuyển sang luồng nhận (mục 2.5)"]):::startend
    classDef startend fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d
    classDef action fill:#e0f2fe,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e
    classDef decision fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
```

> **Bất biến:** không xuất quá tồn; không hoàn thành khi thực < kế hoạch; xuất thiếu phải hạ kế hoạch xuống bằng thực xuất. Trạng thái chuyến: Chờ (PENDING) → Giao đơn → Đang xuất (IN_PROGRESS) ↔ Tạm dừng (PAUSED) → Hoàn thành (COMPLETED).

---

## 2.5. Chuyển kho — từ kho xuất đến kho nhận

```mermaid
flowchart TD
    S(["Kho tổng: Hoàn thành chuyến chuyển kho"]):::startend --> A["TMS tự tạo lệnh TRANSFER\n+ KH nhập + slot xe (trạng thái: Đang giao)"]:::action
    A --> B["Kho nhận: điền ĐVVT booking\n(Biển số + SĐT + Giờ dự kiến tới)"]:::action
    B --> C{"Đủ 3 thông tin\nbooking?"}:::decision
    C -->|Chưa| B
    C -->|Đủ| D["Bắt đầu nhận hàng →\nsinh phiếu nhập (1 phiếu / mã) — Đang nhận"]:::action
    D --> E["Quét QR pallet (kế thừa NCC theo tem gốc)\n/ nhập tay mã no-QR"]:::action
    E --> F{"Thiếu phiếu\ncho mã nào?"}:::decision
    F -->|Có| G["Tạo phiếu lại"]:::action
    G --> E
    F -->|Không| H["Hoàn thành từng phiếu\n(đối chiếu KH vs thực nhận)"]:::action
    H --> I["Ghi tồn kho tại KHO NHẬN"]:::action
    I --> J(["Lệnh chuyển kho: Đã giao"]):::startend
    classDef startend fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d
    classDef action fill:#e0f2fe,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e
    classDef decision fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
```

> Ở kho xuất, **"Bỏ hoàn thành" bị CHẶN** khi kho nhận đang nhận / đã nhận (bảo toàn số liệu hai đầu).

---

## 2.6. Đăng ký cổng — trạng thái lượt xe

```mermaid
flowchart TD
    S(["Bắt đầu"]):::startend --> A["Thêm đăng ký\n(kho, hướng, loại xe, ĐVVT/NCC, biển số)"]:::action
    A --> B(["Đã đăng ký"]):::startend
    B --> C["Gọi xe (chọn giờ gọi)"]:::action
    C --> D(["Đã gọi xe"]):::startend
    D --> E["Xác nhận VÀO"]:::action
    B --> E
    E --> F(["Đang trong"]):::startend
    F --> G["Xác nhận RA (+ tải trọng)"]:::action
    G --> H(["Đã ra"]):::startend
    classDef startend fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d
    classDef action fill:#e0f2fe,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e
    classDef decision fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
```

> Mỗi bước đều có nút **hoàn tác** (↺). **Xe kết hợp Nhập + Xuất:** chân Xuất chỉ được Gọi/Vào **sau khi** chân Nhập đã RA; muốn gỡ "Đã ra" chân Nhập phải hoàn tác chân Xuất trước.

---

## 2.7. Đặt khung giờ xe (TMS) — chống trùng suất

```mermaid
flowchart TD
    S(["Lệnh vận chuyển có 1 slot xe (Chờ book)"]):::startend --> A["Mở Đặt giờ"]:::action
    A --> B["Chọn khung giờ còn chỗ\n(đúng loại kho + loại xe)"]:::action
    B --> C["Nhập biển số + SĐT lái xe"]:::action
    C --> D{"Xe chở thêm\nđơn khác?"}:::decision
    D -->|Có| E["Tick gom đơn cùng ĐVVT + ngày + hướng"]:::action
    D -->|Không| F
    E --> F["Lưu → hệ thống đặt suất NGUYÊN TỬ\n(đếm sống dưới khóa dòng)"]:::action
    F --> G{"Slot còn chỗ?"}:::decision
    G -->|Còn| H(["Đã đặt giờ — đồng bộ sang cổng theo biển số"]):::startend
    G -->|Hết| I["Báo FULL"]:::action
    I --> B
    classDef startend fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d
    classDef action fill:#e0f2fe,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e
    classDef decision fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
```

> Hủy suất: **Trả lại** (trước giờ) / **Thu hồi** (sau giờ) → nhả suất, tách nhóm gom.

---

## 2.8. Nhặt lẻ

```mermaid
flowchart TD
    S(["Đơn xuất có cột Nhặt lẻ > 0 (tự sinh)"]):::startend --> A["Màn Nhặt lẻ: danh sách chuyến còn phần lẻ"]:::action
    A --> B["Quét QR pallet nguồn / nhập tay mã no-QR"]:::action
    B --> C["Ghi nhận — CHƯA trừ tồn (giữ chỗ)"]:::action
    C --> D{"Đã soạn đủ?"}:::decision
    D -->|Chưa| B
    D -->|Đủ| E["Check nhặt lẻ (N thùng)"]:::action
    E --> F(["Trừ tồn thật + tính vào tiến độ chuyến"]):::startend
    classDef startend fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d
    classDef action fill:#e0f2fe,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e
    classDef decision fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
```

---

## 2.9. Kiểm kho (Check vị trí) & xử lý chênh lệch

```mermaid
flowchart TD
    S(["Bắt đầu"]):::startend --> A["Chọn Kho → Loại kho → Vị trí"]:::action
    A --> B["Quét mã pallet tại vị trí"]:::action
    B --> C{"So với dữ liệu app?"}:::decision
    C -->|"Đúng chỗ, đúng số"| D["Lưu — ghi người + giờ kiểm"]:::action
    C -->|"Nằm khác vị trí"| E["Tick 'Cập nhật vị trí' → Lưu"]:::action
    C -->|"Số thực tế lệch"| F["Nhập số đếm thật → Lưu\n(pallet bị GẮN CỜ chênh lệch)"]:::action
    D --> G["Tổng hợp KK: 4 thẻ\nTổng / Đã kiểm / Chưa kiểm / Chênh lệch"]:::action
    E --> G
    F --> G
    G --> H{"Có chênh lệch?"}:::decision
    H -->|Có| I["Điều chỉnh tồn (có lý do) → Bỏ cờ"]:::action
    H -->|Không| J(["Kết thúc"]):::startend
    I --> J
    classDef startend fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d
    classDef action fill:#e0f2fe,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e
    classDef decision fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
```

---

## 2.10. In tem / Dồn / Tách pallet

```mermaid
flowchart TD
    S(["Bắt đầu"]):::startend --> A["Sinh tem mới: khai Ngày SX + Mã + Chu kỳ\n+ Máy (TP) hoặc NCC + NMSX + Seq"]:::action
    A --> B{"QR trùng pallet\nđang tồn?"}:::decision
    B -->|Có| C["Cảnh báo — đổi Seq bắt đầu"]:::action
    C --> A
    B -->|Không| D["In 4 tem/trang A4 — ghi log Sinh mới"]:::action
    D --> T(["Kết thúc"]):::startend

    S2(["Dồn / Tách"]):::startend --> E{"Dồn hay Tách?"}:::decision
    E -->|Dồn| F["Quét pallet đích + các pallet con →\ngom nhóm, GIỮ tem gốc, không đổi SL"]:::action
    E -->|Tách| G["Pallet gốc → chia X thùng ra pallet con\n(STT con = gốc.1, gốc.2…) → in tem con"]:::action
    F --> H(["Lịch sử thao tác — Hoàn tác được\n(chặn nếu con đã xuất/giữ chỗ)"]):::startend
    G --> H
    classDef startend fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d
    classDef action fill:#e0f2fe,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e
    classDef decision fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
```

---

## 2.11. HR — Phân công lịch làm việc

```mermaid
flowchart TD
    S(["Bắt đầu"]):::startend --> A["Layout: kho + chức danh + vị trí\n+ số người mặc định"]:::action
    A --> B["Quy tắc ca: cấm ca X hôm trước → ca Y hôm sau"]:::action
    B --> C["Tạo phiếu: Kho + Layout + Ngày\n(1 layout/ngày = 1 phiếu)"]:::action
    C --> D["Bước 1: chỉnh Số lượng yêu cầu từng vị trí"]:::action
    D --> E["Tự xếp người\n(quyền kho ∩ skill ∩ chức danh,\nné nghỉ phép, tôn trọng quy tắc ca)"]:::action
    E --> F["Bước 2: sửa tay thêm/bớt vị trí từng người"]:::action
    F --> G{"OK?"}:::decision
    G -->|Chưa| F
    G -->|Rồi| H["Phát hành — khóa phiếu"]:::action
    H --> I(["Xem / Chia sẻ ảnh lịch (Zalo)"]):::startend
    H -.Hoàn tác.-> F
    classDef startend fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d
    classDef action fill:#e0f2fe,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e
    classDef decision fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
```

---

## 2.12. HR — Nghỉ phép & Chấm công

```mermaid
flowchart TD
    S(["Bắt đầu"]):::startend --> A["NV gửi đơn nghỉ phép\n(chặn trùng ngày)"]:::action
    A --> B{"Cấp trên duyệt?\n(theo sơ đồ chức danh + chung kho)"}:::decision
    B -->|Duyệt| C["Tự ghi chấm công 'Nghỉ phép'\ncho mọi ngày trong đơn"]:::action
    B -->|Từ chối| D(["Không ghi công"]):::startend
    C --> E(["Ngày nghỉ tự tính, không cần chấm tay"]):::startend
    C -.Xóa/đổi đơn.-> F["Tự gỡ/ghi lại công tương ứng"]:::action

    S2(["Chấm công hằng ngày"]):::startend --> G["NV tự chấm công hôm nay\n(ca + OT hoặc về sớm)"]:::action
    G --> H(["Bảng công ma trận —\nô đỏ = ngày làm việc chưa chấm"]):::startend
    classDef startend fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d
    classDef action fill:#e0f2fe,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e
    classDef decision fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
```

---

## 2.13. Tài khoản & quyền — từ cấp đến hiệu lực

```mermaid
flowchart TD
    S(["Bắt đầu"]):::startend --> A["Admin tạo Chức danh\n+ tích quyền theo Trang / Tab / Action"]:::action
    A --> B["Tạo Nhân viên: gán Phòng ban + Chức danh\n+ Phạm vi kho + Loại hàng"]:::action
    B --> C["Cấp tên đăng nhập + mật khẩu tạm"]:::action
    C --> D["NV đăng nhập — phiên JWT 7 ngày"]:::action
    D --> E["App tự làm mới quyền mỗi 5 phút"]:::action
    E --> F(["Đổi quyền có hiệu lực ≤ 5 phút:\ngiao diện ẩn nút + server chặn 403"]):::startend
    classDef startend fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d
    classDef action fill:#e0f2fe,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e
    classDef decision fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
```
