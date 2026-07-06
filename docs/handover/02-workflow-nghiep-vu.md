# 2. Workflow nghiệp vụ (sơ đồ Mermaid)

> Đọc kèm [01-tong-quan.md](01-tong-quan.md) (thuật ngữ) và [03-sop-van-hanh.md](03-sop-van-hanh.md) (thao tác từng bước).

## 2.1. Bức tranh tổng — hàng hóa chảy qua hệ thống

```mermaid
flowchart LR
    subgraph SX["SẢN XUẤT / NCC"]
        A1[In tem QR pallet]
    end
    subgraph KT["KHO TỔNG"]
        B1[Nhập kho\nquét QR vào vị trí]
        B2[(Tồn kho\ntheo pallet + vị trí)]
        B3[Xuất kho\nquét QR ra khỏi kho]
    end
    subgraph VC["ĐIỀU VẬN"]
        C1[Đăng ký cổng\nxe vào/ra]
        C2[Kế hoạch VC\nđặt khung giờ]
    end
    subgraph NPP["KHO NPP (nhận)"]
        D1[Lệnh chuyển kho\nTMS tự sinh]
        D2[Nhận hàng\nquét QR nhập lại]
        D3[(Tồn kho NPP)]
    end
    A1 --> B1 --> B2 --> B3
    C2 --> C1
    C1 -.xe vào.-> B1
    C1 -.xe vào.-> B3
    B3 -- "Ship-to = mã kho NPP\n(khi Hoàn thành chuyến)" --> D1 --> D2 --> D3
    B3 -- "Xuất bán thường" --> KH2((Khách hàng/NPP\nngoài hệ thống))
```

## 2.2. Nhập kho từ NCC (qua cổng)

```mermaid
flowchart TD
    A[Điều vận/NV kho: tạo Đăng ký cổng\nhướng NHẬP - kho, loại xe, NCC, biển số] --> B[Gọi xe vào]
    B --> C[Bảo vệ: Xác nhận xe VÀO\ntrạng thái Đang trong]
    C --> D[NV kho: Nhập kho → Tạo phiếu → tab Nhập NCC\nchọn Xe đang vào cổng + NCC]
    D --> E{Có kế hoạch nhập?}
    E -- Có --> F["Nạp từ kế hoạch (gộp SL cùng mã)"]
    E -- Không --> G[Nhập tay danh sách mã hàng + SL dự kiến]
    F --> H[Tạo N phiếu nhập\n1 phiếu / 1 mã hàng, nhóm theo chuyến xe]
    G --> H
    H --> I[Mở từng phiếu → Chọn vị trí]
    I --> J[Quét QR từng pallet\nkiểm tra định dạng + đúng mã + chưa nhập]
    J --> K{Đủ số KH?}
    K -- Chưa --> J
    K -- Đủ/kết thúc --> L[Hoàn thành phiếu\nđối chiếu KH vs thực: Đúng/Thiếu/Thừa]
    L --> M[Bảo vệ: Xác nhận xe RA\n+ tải trọng tấn]
    M --> N[Số liệu vào Tồn kho + Báo cáo nhập]
```

**Ràng buộc chính:** 1 lượt xe = 1 nhóm phiếu cho MỖI NCC (xe ghép nhiều NCC → nhiều nhóm; trùng NCC phải dùng "Sửa nhóm"). Pallet đã quét ở phiếu khác sẽ bị từ chối.

## 2.3. Nhập kho sản xuất (SX) & hàng không QR

```mermaid
flowchart TD
    A[Tạo phiếu → tab Nhập SX\nKho + Loại kho + Mã hàng + Ca + Ngày] --> B{Mã có theo dõi QR?\nvà kho chế độ QR?}
    B -- "Có QR" --> C[Chọn vị trí nhập\n(gợi ý ★ vị trí còn chỗ, đang để dở cùng loại)]
    C --> D[Quét QR pallet\nsố thùng tự điền theo quy cách]
    D --> E{Tiếp?}
    E -- Còn --> D
    E -- Xong --> F[Hoàn thành phiếu]
    B -- "No-QR / kho QTY" --> G[Không cần vị trí\n→ mở phiếu → Lưu thủ công TỔNG số thùng 1 lần]
    G --> F
```

## 2.4. Xuất kho — vòng đời 1 chuyến (GDO)

```mermaid
stateDiagram-v2
    [*] --> PENDING : Upload Excel KH xuất / Tạo đơn tay
    PENDING --> PENDING : Giao đơn (assign)\n— gắn người phụ trách
    PENDING --> IN_PROGRESS : Bắt đầu (start)\nchọn xe từ cổng + biển số + người xuất
    IN_PROGRESS --> IN_PROGRESS : Quét QR pallet / Lưu thủ công no-QR\n/ Nhặt lẻ + Check nhặt lẻ
    IN_PROGRESS --> PAUSED : Tạm dừng
    PAUSED --> IN_PROGRESS : Tiếp tục
    IN_PROGRESS --> COMPLETED : Hoàn thành\n(chỉ khi thực quét ĐỦ kế hoạch từng mã)
    COMPLETED --> IN_PROGRESS : Bỏ hoàn thành\n(chặn nếu kho nhận đã/đang nhận hàng)
    PENDING --> [*] : Xóa (chỉ khi chưa bắt đầu)
```

```mermaid
flowchart TD
    A[Upload Excel KH xuất\nmỗi Số xe = 1 chuyến, gom nhiều NPP] --> B[Giao đơn]
    B --> C[Bắt đầu: chọn chuyến xe từ Đăng ký cổng XUẤT\n+ người xuất, lái xe nâng, bốc xếp]
    C --> D[Chuẩn bị hàng: board gợi ý vị trí FEFO\npallet cần soạn theo xe đã chọn]
    D --> E[Quét QR từng pallet theo mã hàng\nFEFO cảnh báo nếu bỏ qua pallet cũ hơn]
    E --> F{Hàng lẻ?}
    F -- Có --> G[Quét/nhập phần lẻ → Check nhặt lẻ\nmới trừ tồn phần lẻ]
    F -- Không --> H
    G --> H{Mọi mã đủ số?}
    H -- "Thiếu (không về đủ)" --> I[Sửa đơn: hạ SL kế hoạch = thực xuất]
    I --> H
    H -- Đủ --> J[Hoàn thành chuyến]
    J --> K{Ship-to là kho\ncó quản tồn?}
    K -- Có --> L[Tự sinh LỆNH CHUYỂN KHO TMS\n+ KH nhập kho đích + slot xe]
    K -- Không --> M[Kết thúc — xuất bán thường]
```

**Bất biến:** không xuất quá tồn (trừ tồn nguyên tử); không hoàn thành khi thực < kế hoạch; xuất thiếu phải hạ kế hoạch xuống bằng thực xuất.

## 2.5. Chuyển kho — từ kho xuất đến kho nhận (cross-module)

```mermaid
sequenceDiagram
    participant OB as Xuất kho (kho tổng)
    participant TMS as TMS Chuyển kho
    participant GATE as Cổng kho nhận
    participant IB as Nhập kho (kho nhận)
    participant INV as Tồn kho NPP

    OB->>OB: Hoàn thành GDO (ship-to = mã kho NPP)
    OB->>TMS: Tự tạo TmsOrder TRANSFER + KH nhập + slot xe
    Note over TMS: transfer_status = Đang giao (IN_TRANSIT)
    TMS->>TMS: Kho nhận điền ĐVVT booking:\nBiển số + SĐT + Giờ dự kiến tới (đủ 3 mới được nhận)
    TMS->>IB: "Bắt đầu nhận hàng" → sinh phiếu nhập TRANSFER\n(1 phiếu / mã hàng) — GDO → Đang nhận (RECEIVING)
    GATE-->>IB: (xe qua cổng kho nhận nếu có đăng ký)
    IB->>IB: Quét QR pallet (kế thừa NCC theo tem gốc)\nhoặc nhập tay mã no-QR
    IB->>IB: Hoàn thành từng phiếu (đối chiếu KH vs thực)
    IB->>INV: Ghi tồn kho tại KHO NHẬN
    IB->>TMS: Đủ phiếu hoàn thành → Đã giao (DELIVERED)
    Note over OB: "Bỏ hoàn thành" ở kho xuất bị CHẶN khi\nkho nhận đang nhận / đã nhận
```

## 2.6. Đăng ký cổng — trạng thái lượt xe

```mermaid
stateDiagram-v2
    [*] --> REGISTERED : Thêm đăng ký\n(kho, hướng, loại xe, ĐVVT/NCC, biển số)
    REGISTERED --> CALLED : Gọi xe (chọn giờ gọi)
    CALLED --> REGISTERED : Hủy gọi
    REGISTERED --> IN : Xác nhận VÀO
    CALLED --> IN : Xác nhận VÀO
    IN --> CALLED : Hủy xác nhận vào
    IN --> COMPLETED : Xác nhận RA (+ tải trọng)
    COMPLETED --> IN : Hủy xác nhận ra
```

**Xe kết hợp (Nhập + Xuất cùng lượt):** 2 bản ghi chung nhóm; chân **Xuất chỉ được Gọi/Vào sau khi chân Nhập đã RA**; muốn gỡ "Đã ra" của chân Nhập phải hoàn tác chân Xuất trước.

## 2.7. Đặt khung giờ xe (TMS) — chống trùng suất

```mermaid
flowchart TD
    A[Lệnh vận chuyển có 1 slot xe PENDING] --> B[ĐVVT/điều vận mở Đặt giờ]
    B --> C[Chọn khung giờ còn chỗ\n(lọc đúng loại kho + loại xe, khóa slot đầy/quá giờ)]
    C --> D[Nhập biển số + SĐT lái xe]
    D --> E{Chở thêm đơn khác?\n(cùng ĐVVT + ngày + hướng)}
    E -- Có --> F[Tick gom đơn — cùng xe cùng khung giờ]
    E -- Không --> G
    F --> G[Lưu → RPC book_vehicle_slot NGUYÊN TỬ\nđếm sống dưới khóa dòng]
    G --> H{Slot còn chỗ?}
    H -- Còn --> I[BOOKED — đồng bộ sang Đăng ký cổng theo biển số]
    H -- Hết --> J[Báo FULL — chọn khung khác]
    I --> K[Trả lại (trước giờ) / Thu hồi (sau giờ)\n→ nhả suất, tách nhóm gom]
```

## 2.8. Nhặt lẻ

```mermaid
flowchart LR
    A[Đơn xuất có cột Nhặt lẻ > 0\n(tự sinh, không tạo tay)] --> B[Màn Nhặt lẻ: danh sách chuyến còn phần lẻ]
    B --> C[Quét QR pallet nguồn / nhập tay mã no-QR\n→ ghi nhận CHƯA trừ tồn (giữ chỗ)]
    C --> D["Check nhặt lẻ (N thùng)"\nxác nhận đã soạn đủ]
    D --> E[Trừ tồn thật + tính vào tiến độ chuyến]
```

## 2.9. Kiểm kho (Check vị trí) & xử lý chênh lệch

```mermaid
flowchart TD
    A[Chọn Kho → Loại kho → Vị trí\n(có cờ 🚩 vị trí phải check hằng ngày)] --> B[Quét mã pallet tại vị trí]
    B --> C{So với dữ liệu app}
    C -- "Đúng chỗ, đúng số" --> D[Lưu — ghi người + giờ kiểm]
    C -- "Pallet nằm khác vị trí" --> E[Tick 'Cập nhật vị trí' → Lưu\n(dời pallet về vị trí đang check)]
    C -- "Số thực tế lệch" --> F[Bấm 'Không khớp' → nhập số đếm thật → Lưu\n→ pallet bị GẮN CỜ chênh lệch]
    D & E & F --> G[Tổng hợp KK: 4 thẻ Tổng/Đã kiểm/Chưa kiểm/Chênh lệch]
    G --> H[Trưởng kho đối chiếu → Điều chỉnh tồn nếu cần\n→ bấm 'Bỏ cờ' đóng chênh lệch]
```

## 2.10. In tem / Dồn / Tách pallet

```mermaid
flowchart TD
    subgraph IN TEM
        A[Sinh tem mới: khai Ngày SX + Mã + Chu kỳ\n+ Máy (TP) hoặc NCC + NMSX + Seq] --> B{QR trùng pallet\nđang tồn?}
        B -- Có --> C[Cảnh báo — đổi Seq bắt đầu]
        B -- Không --> D[In 4 tem/trang A4 — ghi log Sinh mới]
        E[In lại: chọn pallet từ tồn kho/lịch sử] --> F[In — ghi log In lại\n(cảnh báo pallet đã in trước đó)]
    end
    subgraph DỒN/TÁCH
        G[Dồn: quét pallet đích + các pallet con\n→ gom nhóm, GIỮ tem gốc, không đổi số lượng]
        H[Tách: pallet gốc → chia X thùng ra pallet con\nSTT con = gốc.1, gốc.2 … → in tem con]
        G & H --> I[Lịch sử thao tác — Hoàn tác được\n(chặn nếu pallet con đã xuất/giữ chỗ)]
    end
```

## 2.11. HR — Phân công & Nghỉ phép & Chấm công

```mermaid
flowchart TD
    A[Layout: kho + chức danh + danh sách vị trí\n+ số người mặc định] --> B[Quy tắc ca: cấm ca X hôm trước → ca Y hôm sau]
    B --> C[Tạo phiếu phân công: Kho + Layout + Ngày\n(1 layout/ngày = 1 phiếu)]
    C --> D[Bước 1: chỉnh Số lượng yêu cầu từng vị trí]
    D --> E[Tự xếp người — thuật toán:\nquyền kho ∩ skill ∩ chức danh, né người nghỉ phép,\ntôn trọng quy tắc ca, cân bằng công tháng]
    E --> F[Bước 2: sửa tay thêm/bớt vị trí từng người]
    F --> G[Phát hành — khóa phiếu\n→ Xem/Chia sẻ ảnh lịch (Zalo)]
    G -.Hoàn tác.-> F
```

```mermaid
flowchart LR
    A[NV Gửi đơn nghỉ phép\n(chặn trùng ngày; cảnh báo trùng người cùng bộ phận)] --> B{Cấp trên duyệt\n(theo sơ đồ chức danh + chung kho)}
    B -- Duyệt --> C[Tự ghi chấm công 'Nghỉ phép'\ncho mọi ngày trong đơn]
    B -- Từ chối --> D[Không ghi công]
    C -.Xóa/đổi đơn.-> E[Tự gỡ/ghi lại công tương ứng]
    F[NV tự chấm công hằng ngày\n(ca + OT hoặc về sớm)] --> G[Bảng công ma trận\nô đỏ = ngày làm việc chưa chấm]
```

## 2.12. Tài khoản & quyền — từ cấp đến hiệu lực

```mermaid
flowchart LR
    A[Admin tạo Chức danh\n+ tích quyền theo Trang/Tab/Action] --> B[Tạo Nhân viên: gán Phòng ban + Chức danh\n+ Phạm vi kho + Loại hàng]
    B --> C[Cấp tên đăng nhập + mật khẩu tạm]
    C --> D[NV đăng nhập — JWT 7 ngày]
    D --> E[App tự làm mới quyền mỗi 5 phút\n→ đổi quyền có hiệu lực ≤5 phút]
    E --> F[Giao diện ẩn nút không có quyền\n+ server chặn 403]
```
