# TMS — Tự phân tuyến · Ghép chuyến · Điều động · Tính cước (kế hoạch tổng, chờ duyệt)

> Soạn 22/09/2026 từ brainstorm với user (4 vòng) + đo file thật `Du lieu mau/Du lieu sap zsd02.xlsx` (sheet Data, 8.051 dòng, 79 cột, 01–25/09/2026) + soi code nạp VL06O / dội chuyến hiện có. **Chưa code.** Thứ tự: Đợt 0 (ZSD02 thay VL06O + master) → Đợt 1 (cước + tải) → Đợt 2 (gợi ý ghép) → Đợt 3 (đối soát) → Đợt 4 (bản đồ, tuỳ chọn).
> Tài liệu cha về SAP: [SAP_INTEGRATION_PLAN.md](SAP_INTEGRATION_PLAN.md) (mục 7 chốt OD = khoá, base unit = sự thật). Kế hoạch này KHÔNG đổi các chốt đó — nó mở rộng nguồn nạp và thêm lớp điều vận phía trên.

---

## 0. Bốn quyết định user đã chốt + hai điểm tôi đề nghị chốt nốt

| # | Chốt | Nguồn |
|---|---|---|
| 1 | Cước = **Dòng xe (có Mã xe SAP) × ĐVVT × Kho xuất × Điểm đến (khoá = "Phường/Xã mới" = cột `Tên Phường` ZSD02) + phí rớt điểm + phụ phí**; giá NPP khai **theo tuyến SAP** | user 21/09 |
| 2 | Luật ghép cấu hình **theo dòng xe**; xe pallet tính **pallet**, xe xá tính **tấn** | user 21/09 |
| 3 | Chưa đẩy ngược SAP | user 21/09 |
| 4 | **Thay VL06O bằng ZSD02 làm nguồn DO duy nhất**, không chạy song song lâu dài | user 21/09 ("thay thế trước") |
| 5 (đề nghị) | Xe pallet: **đơn giá theo pallet** (153.000 × 16 = 2,45 tr/chuyến); xe tải: **giá trọn chuyến** | tôi đọc từ bảng cước — chờ xác nhận |
| 6 (đề nghị) | Khi nhiều dòng xe cùng đủ chỗ: **rẻ nhất theo cước** làm mặc định, có cấu hình "ĐVVT ưu tiên theo tuyến" | chờ xác nhận |

---

## 1. ZSD02 — những gì đã ĐO (không suy diễn)

| Đo | Kết quả | Hệ quả thiết kế |
|---|---|---|
| Dòng **có OD** / **chưa có OD** | 6.916 / 1.135 | Hai tập KHÁC bản chất (mục 3) |
| Khoá (OD, Item) trùng | **0** | dùng lại khoá `(od_number, od_item)` của `erp_outbound_orders` |
| Khoá (SO, Item) trùng | 3 (SO item tách 2 OD) | sổ SO cần khoá riêng, KHÔNG nhét vào sổ OD |
| (SO, Item) xuất hiện ở CẢ hai tập | **0** | một SO item hoặc đã có OD hoặc chưa — không lẫn |
| Dòng chưa OD: `OD Qty` · `OD Qty (Base Unit)` · biển số · ĐVVT | **tất cả = 0 / trống** | **số base của dòng chưa OD KHÔNG có trong file** — phải tự quy đổi từ SO Qty (mục 2.3) |
| `Trạng thái điều phối xe` | có OD: 5.938 Đã · 978 Chưa; chưa OD: 1.135 Chưa | "điều phối" = **gắn xe**, không phải "tạo OD" |
| `Số lượng còn lại chưa điều phối` | = SOq (chưa OD) · = ODq (OD chưa gắn xe) · = 0 (đã gắn xe) — khớp 8.051/8.051 | cột này là **pool điều vận của SAP**; app dùng để đối soát |
| `Sales unit` × `Base Unit` | Thùng→HOP 4.887 · Cái→EA 1.840 · Thùng→BT 687 · Thùng→BAG 561 · **Hộp→HOP 41** · Thùng→EA 28 · kg→KG 7 | nhãn tiếng Việt, khác VL06O (`CAR/HOP/EA`) → cần bảng quy nhãn (mục 2.1) |
| Hệ số `OD Qty (Base)` ÷ `OD Qty` theo mã | **0 mã có >1 hệ số**; khớp `Material.units_per_carton` ở 9/9 mã thử | tin được, nhưng vẫn kiểm chéo như VL06O |
| `Sales unit = Thùng`: `OD Qty` = `OD Qty CAR` | 100 % | `OD Qty CAR` = thùng; `Hộp` rows: ODq 3.456 hộp = 72 thùng ×48 |
| `Gross Weight` | **gram** (298.199 g / 60 thùng = 4,97 kg/thùng; master ghi 4,965) | chia 1.000 khi lưu; `Material.weight_kg` là **kg/thùng** với mã có entry, kg/EA với mã không entry |
| `SL PALLET` | phân số (0,316 pallet); **61/147 mã có nhiều tỉ số thùng/pallet** (190 vs 189 = làm tròn; 216 vs 200 = khác thật) | app tính pallet từ master của mình (`cartons_per_pallet` + override kho), SAP pallet/m3 chỉ **tham chiếu** + báo lệch |
| Item Category | ZTA1 bán 5.214 · **ZTA2 Pallet Loscam 669** · F-PO (STO) 644 · ZKMS/ZF01 hàng tặng 686 · ZNB1 nội bộ 259 · **ZRE3 Pallet Return 226** · **ZCKT chiết khấu 152 (mã 910000060 `is_non_stock`, sloc trống)** · ZRE1 trả hàng 9 · XK 71 | phải gắn **`flow`** cho từng dòng (mục 4.3) — dòng trả về / chiết khấu không được lên xe |
| SO type STO (`UB`/`ZUB`/`NB-PO`) | ship-to = **20000011 · 20000013 · 20000016 · 20000017 = đúng `Warehouse.code`** | luật chuyển kho nội bộ hiện có (`warehouseByShipto`) bắt được ngay |
| Huỷ (`Trạng thái hủy đơn`) | 16 dòng, **đều chưa OD** | sổ SO phải mang status CANCELLED, loại khỏi dự báo |
| OD nhiều `Sloc` | 505/1.676 | chuyến chở lẫn FG01+PM01 — derive hiện có đã ghép `'+'` |
| `Route` = `<kho>-<Tên Phường>` | 3.743/6.933 (còn lại lệch chính tả "HồChíMinh", "H.Noi") | **khoá tuyến = `Tên Phường`** (ship-to → phường duy nhất 286/286); `Mã Route` 1-1 với tên (231), lưu tham chiếu |
| ĐVVT | 15 cách viết cho ~9 đơn vị (`Đông Á`/`ĐÔNG Á`/`DA`; `HAI AN`/`Hải An`/`HẢI AN`/`HA`) | chuẩn hoá + `TransportCompany.alias_codes` (đang rỗng) |
| Biển số | 5.777 chuẩn · ~270 lạ (`29E-43469`, `29h94459`, `98C 06739`) | `normalizePlate` khi so khớp; **cột raw giữ nguyên văn** (luật ngoại lệ `erp_outbound_orders.license_plate`) |
| Chuyến SAP (biển × ngày × plant) | 627; 344 chuyến 1 OD; **128 chuyến < 2 pallet, 112 chuyến < 1 tấn** | dư địa ghép là thật; báo cáo Non tải là KPI đợt 1 |
| Lead time `Delivery date` − `Thời gian tạo OD` | 0 ngày 3.201 · −1 ngày 1.394 · +1 ngày 916 · −2…−5: 1.230 | OD của ngày mai phần lớn đã có từ chiều hôm trước → điều vận chạy ~15h là hợp |
| Pool đang chờ xe trong file | 436 OD · 1.063 pallet · 954 tấn · 342 OD < 0,5 pallet | đúng bài ghép hàng lẻ |
| Ghi chú có chữ "date" | 1.984 dòng, 617 câu khác nhau | máy KHÔNG đọc (luật 10/09) — giữ vào `note_delivery` như cũ |
| `Date (%)` · `Date (Ngày)` | 0 ở 100 % dòng | y như VL06O — nguồn %Date vẫn là master Quy định date |
| Cỡ file | 3,5 MB cho 25 ngày | 1 ngày ≈ 150–400 KB; trần Vercel 4,5 MB → FE chặn > 4 MB kèm hướng dẫn "lọc theo ngày trước khi xuất" |

---

## 2. SỐ LƯỢNG & ĐƠN VỊ — luật cốt tử (user nhấn mạnh)

Nguyên tắc không đổi: **app tính bằng BASE** (`Material.base_unit`), thùng chỉ là thể hiện (`qtySplit`). ZSD02 có tới **13 cột số lượng** — mỗi cột phải được gán đúng một vai, cột nào không có vai thì chỉ nằm trong `raw`.

### 2.1 Quy nhãn đơn vị (MỘT nguồn, có test mirror)
`backend/src/utils/sapUnits.ts` + FE mirror + `tests/mirror/sapUnits.mirror.test.ts`:

| ZSD02 `Sales unit` | Chuẩn app | Ý nghĩa |
|---|---|---|
| `Thùng` | `CAR` | đơn vị entry — phải có `units_per_carton` |
| `Hộp` | `HOP` | bán thẳng base (41 dòng) |
| `Cái` | `EA` | base |
| `kg` | `KG` | base thập phân |
| khác | **CHẶN** file kèm bảng (mở rộng bảng này khi SAP thêm) | |

`Base Unit` (`HOP/BAG/BT/EA/KG`) đã trùng mã app → so thẳng với `Material.base_unit` (CHẶN 1 của VL06O, giữ nguyên). CHẶN 2 (Sales unit ∉ {entry, base}) chạy **sau** khi quy nhãn.

### 2.2 Dòng CÓ OD — số base lấy THẲNG từ SAP
| Cột ZSD02 | Vào | Vai |
|---|---|---|
| `OD Qty (Base Unit)` | `qty_base` | **số DUY NHẤT dùng để tính** (= `Actual delivery qty` của VL06O) |
| `OD Qty` + `Sales unit` (quy nhãn) | `qty_sales`, `sales_unit` | kiểm chéo `qty_sales × (Thùng ? upc : 1) = qty_base` — lệch = **cảnh báo theo mã** (đúng luật VL06O hiện tại) |
| `OD Qty CAR` | `raw` | trùng thông tin; không cột riêng |
| `Số lượng đã xuất / nhập` (sales unit) | `qty_issued_base` = × cùng hệ số `qty_base/qty_sales` | PGI đã post — dùng cho đối soát "SAP đã xuất mà app chưa hoàn thành" và ngược lại |
| `Số lượng còn lại chưa xuất / nhập` | `raw` | = ODq − đã xuất, suy được |
| `Số lượng còn lại chưa điều phối` | `raw` (+ cờ `sap_dispatch_status`) | = ODq khi chưa gắn xe → cột trạng thái đủ |
| `SO Qty`, `SO Qty CAR` | `qty_so_sales` | tham chiếu: SO 100 mà OD 80 = SAP giao thiếu 20 **từ trước khi tới kho** — hiện ở tab DO SAP, không đụng `cartons_ordered` |
| `SL PALLET đã điều phối` · `SL M3 đã điều phối` · `Gross Weight` | `sap_pallets`, `sap_m3`, `gross_weight_kg` (= g ÷ 1.000) | **tham chiếu tải** — app tính pallet/tấn từ master (mục 2.4); lệch > 5 % → cột ⚠ để sửa master |

Hàng `qty_base` từ ZSD02 có **cùng nghĩa, cùng đơn vị** với VL06O ⇒ `reconcileFromSap`, `buildKhvcByVehicle`, `od_refs`, Chốt %Date, Xuất kho… **không đổi một dòng**.

### 2.3 Dòng CHƯA OD — số base là số DẪN XUẤT, phải đánh dấu
SAP để `OD Qty (Base Unit) = 0` ở 1.135/1.135 dòng này. Ghi 0 vào `qty_base` là **sai chết người**: engine reconcile đọc "SAP nói 0" → hạ `cartons_ordered`. Vì vậy:
- Dòng chưa OD **không bao giờ vào `erp_outbound_orders`** (bảng đó là sổ OD). Chúng vào sổ riêng `erp_so_lines` (mục 3).
- `qty_so_base` suy theo **thứ tự 3 bậc** (đo 22/09 trên file mẫu: 874 dòng Thùng thì 865 có hệ số quan sát trong file, chỉ 9 dòng rơi về master; Cái/Hộp/kg = base thẳng; master có `upc` ở 447/447 mã Thùng):
  1. Sales unit = `Hộp`/`Cái`/`kg` → SO Qty **đã là base**, hệ số 1.
  2. Sales unit = `Thùng` → hệ số = `OD Qty (Base Unit) ÷ OD Qty` quan sát từ **dòng có OD cùng mã trong chính file** (0 mã có 2 hệ số).
  3. Không quan sát được → `Material.units_per_carton`.
  Hết 3 bậc vẫn không có → `qty_so_base = NULL` + cờ `qty_unresolved` + đếm trong kiểm-trước ("n dòng SO không quy đổi được đơn vị — khai quy cách mã X"). **Không đoán.**
- Cờ `qty_base_derived = true` + `derive_source` (`FILE|MASTER`) trên mọi dòng SO để màn hình in nhãn "quy đổi" — khác hẳn số SAP chốt.
- **Tải của dòng SO không cần base:** tấn = `Gross Weight ÷ 1.000` (có ở 1.070/1.135 dòng, kg/thùng khớp dòng có OD cùng mã 867/867); pallet = `SO Qty CAR ÷ cpp master` (SAP đã tự quy đổi cả dòng bán theo Hộp: 160 hộp → 3,333 thùng); `SL SO PALLET`/`SL SO M3` SAP lưu tham chiếu.
- Đơn vị lẫn Thùng/Cái trên cùng OD là bình thường (sữa theo Thùng + POSM theo Cái) — app **không cộng đơn vị bán**, mỗi dòng về base rồi mới ra pallet/tấn.
- Chữa tận gốc: đề nghị đội SAP thêm cột **"SO Qty (Base Unit)"** vào ZSD02 (báo cáo đã có "OD Qty (Base Unit)", sửa ABAP nhỏ). Khi cột đó xuất hiện, parser ưu tiên nó và cờ `qty_base_derived = false`.

### 2.4 Tải chuyến — helper MỘT nguồn `utils/loadCalc.ts` (BE + FE mirror + test)
```
cartons(line)  = hasEntry(mat) ? qty_base / upc : null            // thùng thập phân — chỉ để tính tải, KHÔNG hiển thị cạnh nhãn "thùng"
pallets(line)  = cartons / cppEffective(mat, warehouse)           // cppEffective = warehouse_pallet_overrides ?? cartons_per_pallet (đúng helper palletCalc đang có)
kg(line)       = hasEntry(mat) ? cartons × weight_kg : qty_base × weight_kg   // weight_kg là kg/thùng với mã entry, kg/EA với mã không entry — ĐO trên 9 mã khớp SAP
m3(line)       = cartons × (L×W×H mm của thùng) / 1e9  (thiếu kích thước → null)
```
- Thiếu `weight_kg`/`cpp` → **rơi về số SAP** (`gross_weight_kg`, `sap_pallets`) kèm cờ `load_from_sap`; cả hai thiếu → dòng "không đo được tải", chuyến chứa nó hiện ⚠ và engine không tự ghép dòng đó.
- Pallet Loscam (`is_pallet_carrier`) không tính pallet hàng; chiết khấu (`is_non_stock`) tải = 0 và không lên xe.
- Cùng công thức với RPC `gdo_weight_estimates` đang dùng cho phiếu cân → viết TS rồi **so kết quả với RPC trên 50 chuyến thật** trong test QA (oracle hai đường).

### 2.5 Ba ranh giới hiển thị (ratchet hiện có gác)
- Số của MỘT mã cạnh nhãn đơn vị = `qtyLabel` "N thùng + M hộp" (`entry_decimal_beside_unit_label`).
- Tổng cross-mã = "SL (quy đổi)" / pallet / tấn — **không** in tổng base thô.
- Cước xe pallet in "16 pallet × 153.000" — pallet ở đây là **pallet LÀM TRÒN LÊN theo dòng xe** (sức chứa), khác pallet phân số của tải (mục 6.3).

---

## 3. CÓ OD ↔ CHƯA OD — hai sổ, hai vai, không lẫn

| | Sổ OD `erp_outbound_orders` (đã có) | Sổ SO `erp_so_lines` (mới) |
|---|---|---|
| Hạt | dòng OD (`od_number, od_item`) | dòng SO (`so_number, so_item`) — **mọi** dòng ZSD02 kể cả đã có OD (`od_number` điền khi có) |
| Số lượng | `qty_base` = SAP chốt | `qty_so_base` = dẫn xuất, có cờ |
| Ai đọc | Kế hoạch xuất · derive chuyến · reconcile · Chốt %Date · Xuất kho · **engine ghép** | **chỉ** tab "Chưa có OD" (dự báo tải ngày mai theo kho/tuyến) + ô band "SO chờ tạo OD" |
| Được lên xe? | **CÓ** — khoá `khvc_lines.do_no` là số OD | **KHÔNG** — không có khoá OD thì không có dòng hàng, không có tem để quét |
| Vòng đời | v2.3: DO có mặt trong file → dòng cũ không có = OBSOLETE | SO có mặt trong file → dòng cũ không có = OBSOLETE; dòng chuyển từ chưa OD → có OD chỉ là cập nhật `od_number` |
| Huỷ | (SAP xoá dòng khỏi OD → OBSOLETE → reconcile) | `status = CANCELLED` + `cancel_reason` từ cột `Trạng thái hủy đơn` |

Vì sao không gộp một bảng: hai hạt khác nhau (3 SO item tách 2 OD), hai nghĩa số lượng khác nhau (chốt vs dẫn xuất), và **mọi cửa đọc hiện có** đều giả định "một dòng `erp_outbound_orders` = một OD line có thật". Nhét dòng chưa OD vào đó là mở lại lớp lỗi "hai cửa cùng một sổ mà khác luật".

Giá trị của sổ SO: điều vận nhìn **trước một ngày** tải sẽ đổ về theo kho × tuyến (1.135 dòng ≈ 121 nghìn đơn vị bán, 830 pallet trong file mẫu) để **đặt xe trước với ĐVVT** — không phải để ghép.

---

## 4. THAY VL06O BẰNG ZSD02 — phần làm kỹ

### 4.1 Cửa nạp mới `POST /wms/outbound/upload-zsd02` (cùng quyền `outbound.import` | `external_do_sap.create`)
1. `readWorkbookSafe` → sheet đầu → `expandMergedCells` → **`parseSheetByHeader`** với `ZSD02_FIELDS` (79 alias, map theo TÊN, chịu đảo cột/đổi nhãn). Bắt buộc: `SO/ PO SAP`, `Item`, `Material`, `Plant`, `Sales unit`, `SO Qty/ SL SO`, `Base Unit`, `Delivery date`. `Outbound Delivery` **không** bắt buộc (dòng chưa OD).
2. Quy nhãn đơn vị (2.1) → CHẶN 1/CHẶN 2 như VL06O → kiểm chéo hệ số (cảnh báo).
3. Tách hai tập: có OD → records OD; chưa OD → records SO (2.3). Dòng có OD **cũng** sinh một record SO (để sổ SO đủ).
4. Gắn `flow` (4.3), `sap_dispatch_status`, chuẩn hoá ĐVVT (`normDvvt` → `TransportCompany` qua `code`/`alias_codes`, không khớp → giữ raw + cảnh báo "ĐVVT lạ: …").
5. Scope kho: resolve `plant`(+`sloc`) → `Warehouse.sap_plant` như VL06O (all-or-nothing ngoài phạm vi; không map được → đếm cảnh báo). **Việc dữ liệu:** khai `sap_plant = 2101` cho Kho Bàu Bàng (hiện NULL — chỉ Ba Vì có 1102).
6. Preflight 2 pha (`?preflight=1`) — báo cáo `buildPreflight` gồm: dòng OD / dòng SO / OD trên chuyến đang chạy / dòng đã quét / **dòng SO không quy đổi được** / **ĐVVT lạ** / **dòng flow RETURN/DISCOUNT (không lên xe)** / lệch hệ số / lệch khối lượng > 5 % (đếm mã).
7. Ghi: nạp-có-so-sánh y hệt VL06O (hash BIZ, giữ id, NO-OP, OBSOLETE theo v2.3) cho sổ OD; sổ SO cùng khuôn theo khoá (so, item). Chunk 500. Reconcile `changedKeys` + kích hoạt chuyến chờ — **gọi lại đúng hai hàm đang có**.
8. `source = 'ZSD02'`. Nhãn hiển thị `EXCEL` → "VL06O", `ZSD02` → "ZSD02".

### 4.2 Cột mới trên `erp_outbound_orders` (đều nullable, VL06O không đụng)
`so_number` · `so_type` · `item_category` · `flow` · `delivery_date date` · `sales_org` · `dist_channel` · `sold_to_code` · `ward_code` (Tên Phường) · `region_code` · `sales_district` · `route_code` · `route_name` · `dvvt_code` (đã chuẩn) · `dvvt_raw` · `driver_name` · `sap_dispatch_status` (`ASSIGNED|UNASSIGNED`) · `qty_so_sales` · `qty_issued_base` · `gross_weight_kg` · `sap_pallets` · `sap_m3` · `mat_doc` · `billing_no` · `so_created_at` · `od_created_at` · `approval_status` · `customer_ref`. Còn lại nằm trong `raw` (đã có cột jsonb). Index: `(delivery_date)`, `(flow, delivery_date)`, `(ward_code)`.

**Luật đè khi hai nguồn cùng khoá:** mọi cột BIZ cũ: bản nạp sau thắng (như nay). Cột ZSD02-only: VL06O **không có trong payload** nên PostgREST giữ nguyên — không cần code thêm, nhưng QA phải gác (`upload VL06O sau ZSD02 → route_code còn nguyên`).

### 4.3 `flow` — phân loại dòng, quyết "được lên xe hay không"
| `flow` | Điều kiện (so_type / item_category) | Lên xe? |
|---|---|---|
| `SALE` | ZOR1/ZOR2/ZKG1/ZTA*/ZXBT/ZXSD, ZKMS/ZF01/ZFCR (hàng tặng đi cùng) | có |
| `STO` | `UB` / `ZUB` / `NB-PO`, F-Purchase Order | có — chuyến **chuyển kho** (ship-to = mã kho) |
| `INTERNAL` | ZTD1 / ZNB1 (nội bộ, marketing) | có |
| `RETURN` | ZRE1 / ZRE3 (trả hàng, **trả pallet**) | **không** — chiều về; giữ để đối soát pallet Loscam |
| `DISCOUNT` | ZCKT, mã `is_non_stock` | **không** — tải 0 |
| `PALLET` | ZTA2 (Pallet Loscam đi cùng hàng) | có, nhưng không tính pallet hàng (đã có `is_pallet_carrier`) |

Bảng ánh xạ là **dữ liệu** (`LookupValue type=sap_flow_map`, seed từ bảng trên; giá trị lạ → `UNKNOWN` + cảnh báo), không `if` chuỗi rải trong code.

Kế hoạch xuất / engine chỉ nhận OD có `flow ∈ {SALE, STO, INTERNAL, PALLET}`. Upload Kế hoạch xuất gặp DO `RETURN`/`DISCOUNT` → **từ chối dòng đó** kèm lý do (trước nay VL06O không có cột này nên không phân biệt được).

### 4.4 Cắt chuyển — 3 bước, có công tắc
| Bước | Việc | Điều kiện sang bước sau |
|---|---|---|
| A | Deploy nút **"Up ZSD02"** cạnh "Up VL06O" trên tab DO SAP; cờ `SystemSetting.sap_do_source = 'BOTH'` (mặc định = hành vi cũ) | tsc/build/QA xanh |
| B | **Tab "Đối chiếu VL06O ↔ ZSD02"** (tạm, quyền `external_do_sap.view`): nạp cả hai file cùng ngày → so theo `(od, item)`: khoá chỉ có một bên · `qty_base` lệch · `ship_to` lệch · số OD từng bên. Chạy **≥ 5 ngày làm việc liên tiếp 0 lệch** | user nghiệm thu |
| C | `sap_do_source = 'ZSD02'` → nút VL06O ẩn, route VL06O trả 409 `SOURCE_DISABLED` kèm hướng dẫn; code giữ làm đường lui (`'VL06O'` bật lại được) | — |

⚠ **Rủi ro phải kiểm ở bước B, không đoán được từ một file:** cột `Item` của ZSD02 là **item của SO**; VL06O `Item` là item của **OD**. Với LOF hai số này thường trùng (10/20/30…), nhưng OD tách/đổi item là có thể. Nếu lệch, luật v2.3 (DO có mặt trong file → dòng cũ không khớp khoá = OBSOLETE) sẽ **thay trọn bộ dòng của OD** và `od_refs` của dòng hàng trỏ vào khoá cũ ⇒ reconcile tính lại từ 0 dòng → hạ `cartons_ordered`. Tab đối chiếu phải in **"OD có item lệch giữa hai nguồn"** riêng; > 0 thì trước khi bước C phải thêm bước "khớp lại `od_refs` theo (od, material, qty)" — chỉ làm khi đo thấy cần.

### 4.5 Tương lai nối API SAP
ZSD02 là Z-report, không phải object chuẩn. Ba đường (đã trình bày 21/09): API chuẩn (`API_OUTBOUND_DELIVERY_SRV` — thiếu biển số/ĐVVT/pallet/m3 là trường Z), bọc ZSD02 thành RFC/OData (việc phía SAP), hoặc SAP xuất file theo lịch ra SFTP/email và app tự nạp. Kế hoạch này thiết kế **một hình dạng dòng chuẩn** = chính bộ cột 4.2; `upload-zsd02` chỉ là bộ chuyển đổi đầu tiên vào hình dạng đó. Đổi nguồn = thêm bộ chuyển đổi, engine và cước không đổi. Trường chỉ có ở Z (pallet, m3, kg) app đã tự tính từ master (2.4) nên không phụ thuộc.

### 4.6 Sổ SO `erp_so_lines` (mới)
`id` · `so_number` · `so_item` · **unique (so_number, so_item)** · `od_number` (null = chưa có OD) · `material_code` · `qty_so_sales` · `sales_unit` · `qty_so_base` · `qty_base_derived bool` · `qty_unresolved bool` · `base_unit` · `ship_to_code/name` · `sold_to_code` · `plant` · `storage_location` · `delivery_date` · `flow` · `so_type` · `status` (`OPEN|HAS_OD|CANCELLED`) · `cancel_reason` · `approval_status` · `ward_code` · `route_code` · `sap_pallets` · `gross_weight_kg` · `note_delivery` · `sync_status` · `raw` · `source` · `uploaded_by` · `created_at` · `updated_at`. Realtime: dòng `TABLE_QUERY_MAP` → `['so-lines']`. Không trigger nghiệp vụ nào đọc bảng này ngoài tab dự báo.

---

## 5. MASTER DATA nuôi điều vận & cước

### 5.1 `Customer` (khoá `ship_to_code`) — thêm cột địa lý, nạp tự động từ ZSD02
`ward_code` (Tên Phường — **khoá cước**) · `region_code` · `region_name` · `sales_district` · `sales_office` · `address` · `sold_to_code` · `search_term`. Upload ZSD02 gọi `ensureCustomers` (đang có) mở rộng: khách mới → tạo kèm địa lý; khách cũ → **điền ô TRỐNG, không đè ô đã có** (người có thể đã sửa tay). Ship-to → phường là 1-1 trên dữ liệu (286/286) nên an toàn; lệch với giá trị đã có → cảnh báo, không đè.

### 5.2 `sap_route` (mới, tham chiếu) — `route_code` PK · `route_name` · `plant` · `ward_code`. Nạp từ ZSD02 (231 dòng), chỉ để hiển thị/gom nhóm; cước **không** khoá theo đây (5 cặp (plant, phường) có 2 route → khoá theo phường ổn hơn).

### 5.3 `VehicleType` — mở rộng theo bảng cước thật
| Cột mới | Nghĩa | Mặc định (= hành vi cũ) |
|---|---|---|
| `sap_vehicle_code` | "Mã xe SAP" 9100000xx | null |
| `capacity_mode` | `PALLET` \| `TON` (quyết định tải đo bằng gì) | `is_pallet_truck ? PALLET : TON` |
| `max_pallets` · `max_tons` · `max_m3` | sức chứa | null = không giới hạn (engine không tự ghép vào dòng xe null) |
| `max_drops` | số điểm giao tối đa | null |
| `allow_mix_channels` | cho trộn kênh (BHX + NPP) | true |
| `tariff_unit` | `PER_PALLET` \| `PER_TRIP` | `PER_TRIP` |
| `underload_pct` | dưới % này = Non tải | 70 |
Danh mục cần bổ sung dòng theo bảng cước (Xe 4/16/17 pallet · tải 1,25/2,5/3,5/5/8/15 tấn lạnh/nóng) — **dữ liệu**, upload cùng file cước (mã SAP là khoá tạo/khớp).

### 5.4 `TransportCompany.alias_codes` — điền theo đo: `DA ← {Đông Á, ĐÔNG Á}` · `HA ← {HAI AN, Hải An, HẢI AN}` · `VÃNG LAI ← {Vãng Lai}` · `RATRACO`, `KGT`, `BMT`, `PAQ`, `ALCA`, `HN` khớp `code`. `normDvvt` = trim + upper + bỏ dấu.

### 5.5 `Warehouse.sap_plant` — khai 2101 cho Bàu Bàng (dữ liệu).

---

## 6. CƯỚC VẬN CHUYỂN (Đợt 1)

### 6.1 Bảng
- `freight_tariff`: `id` · `transport_company_id` · `vehicle_type_id` · `from_warehouse_id` · `ward_code` · `price numeric` · `distance_km` · `province_old` · `district_old` · `province_new` (4 cột địa danh giữ nguyên văn file) · `effective_from date` · `effective_to date null` · `is_active` · audit. **Unique (company, vehicle_type, from_warehouse, ward_code, effective_from)**. Không xoá cứng — hết hiệu lực bằng `effective_to`.
- `freight_surcharge`: `id` · `kind` (`DROP_POINT` \| `WAITING` \| `OTHER`, LookupValue) · `transport_company_id null` · `vehicle_type_id null` · `amount` · `per` (`PER_DROP|PER_TRIP|PER_HOUR`) · hiệu lực. Phí rớt điểm: **chưa thấy trong bảng cước** — khai riêng ở đây.

### 6.2 Upload cước = đúng cột file thật
`Tỉnh/TP(Cũ) · Quận/Huyện(Cũ) · Tỉnh/TP(Mới) · Phường/Xã(Mới) · Cự ly(Km) · DVVT · Loại xe · Cước (VND) · Mã xe SAP` (+ cột **Kho xuất** thêm vào mẫu — file bạn gửi là bảng của một kho; thiếu thì chọn kho lúc upload). Parse theo tên; DVVT qua `normDvvt`; Loại xe khớp `sap_vehicle_code` trước, tên sau; phường khớp `ward_code` đã thấy trong ZSD02 (chưa thấy → cảnh báo, vẫn nhận). Preflight 2 pha; ghi lô 500; dòng trùng khoá = đè giá (idempotent).

### 6.3 Tra cước một chuyến — `services/freight.ts` (thuần TS, có test)
```
tariff = tìm (dvvt, dòng xe, kho xuất, ward của điểm đến XA NHẤT theo km) hiệu lực tại ngày giao
PER_PALLET: pallet_billed = ceil(Σ pallets(line))  (làm tròn LÊN, tối thiểu = max_pallets nếu ĐVVT tính trọn xe — cấu hình `min_billed_pallets` trên tariff, mặc định = làm tròn lên)
PER_TRIP  : price
+ drop_fee × (số ship-to − 1) + phụ phí khác
```
Kết quả gắn lên `GroupDeliveryOrder` (cột `freight_estimated`, `freight_tariff_id`, `freight_detail jsonb`) — tính lúc **Xác nhận kế hoạch** và tính lại lúc **Hoàn thành** (chuyến thật). Chuyến không có cước khớp → `freight_estimated = null` + lý do (thiếu giá tuyến/dòng xe) hiện ở cột.

---

## 7. ENGINE GHÉP CHUYẾN (Đợt 2) — `services/dispatchEngine.ts`, thuần TS, test đơn vị

**Đầu vào** (một lời gọi, một kho, một ngày giao): OD trong pool = `erp_outbound_orders` `flow` được lên xe · `delivery_date` = ngày · plant → kho · **chưa có `khvc_lines` ACTIVE** (khoá do_no) · không OBSOLETE; kèm `Customer` (ward, kênh, `warehouse_id` nội bộ), tải từng OD (2.4), danh mục dòng xe (5.3), cước (6), tham số kho.

**Luật (theo thứ tự, mỗi luật một hàm có test):**
1. Nhóm bắt buộc: STO tới cùng kho nội bộ = một nhóm; khách có `Customer.delivery_mode = SCAN` không trộn với khách ngoài.
2. Cụm địa lý: theo `ward_code` → cùng `region_code` → (Đợt 4) theo km. Cụm không vượt `max_drops`.
3. Chọn dòng xe: bin-pack **first-fit-decreasing** theo `capacity_mode` (pallet cho xe pallet, tấn cho xe xá; xe pallet cũng gác `max_tons` nếu khai), thử từ dòng xe rẻ nhất theo cước tuyến; OD lớn hơn xe lớn nhất → tách theo **dòng hàng nguyên** (không tách một dòng OD), phần dư sang xe kế.
4. Trộn kênh chỉ khi `allow_mix_channels`; hàng SCA/lạnh (loại kho FG02) chỉ vào dòng xe khai `serve_categories` chứa FG02 (cùng khuôn cửa xuất).
5. Chuyến dưới `underload_pct` → nhãn **Non tải** + gợi ý "gộp với chuyến X cùng cụm" hoặc "hạ dòng xe".
6. Tie-break: cước thấp nhất → ít điểm giao → ĐVVT ưu tiên tuyến (cấu hình) → ổn định (cùng input ra cùng output).

**Đầu ra:** `dispatch_plan` (kho, ngày, trạng thái DRAFT/CONFIRMED, tổng cước, số chuyến, Non tải) → `dispatch_trip` (số xe dự kiến `<Kho>_X_<ddmmyy>_<stt>` — **giữ đúng quy ước `group_code` hiện tại** vì `buildKhvcByVehicle` lấy `split('_')[0]` làm mã kho; dòng xe; ĐVVT; cước; pallet/tấn; % tải) → `dispatch_trip_od`. Màn hình: bảng chuyến + kéo OD giữa chuyến + đổi dòng xe/ĐVVT (cước tính lại sống) → **Xác nhận** = ghi `khvc_lines` (đúng cột đang có: group_code, do_no, npp, veh_type, dvvt, export_date, booking_category) → `replanKhvcGroups` → GDO + TmsOrder tự sinh như hôm nay. **Máy đề xuất, người xác nhận**; sau xác nhận mọi thứ đi đường cũ.

Đo trước khi tin: chạy engine trên chính file mẫu (627 chuyến SAP đã xếp) → so **số chuyến / pallet trung bình / cước tổng** máy vs người; mục tiêu đợt 2 = không tệ hơn người ở cả ba số, in bảng so sánh trong plan.

---

## 8. ĐỐI SOÁT & BÁO CÁO (Đợt 3)
- **App ↔ SAP điều phối**: cùng OD, biển số/ĐVVT app vs `license_plate`/`dvvt_code` SAP (khi SAP có) → lệch hiện tab "Lệch điều phối".
- **PGI**: `qty_issued_base` > 0 mà chuyến app chưa COMPLETED (hoặc ngược lại) → cảnh báo.
- **Cước tháng theo ĐVVT** (chuyến COMPLETED × cước thực): bảng + Excel, quyền `freight.export`.
- **Non tải**: % chuyến dưới ngưỡng theo kho/ĐVVT/dòng xe — KPI mới vào tab KPI (`kpiDefs` một nguồn).

---

## 9. BẢNG CÔNG TẮC (bắt buộc — lớp C5)
| Cột / cờ | UI ở đâu | Quyền sửa | Mặc định = hành vi cũ? |
|---|---|---|---|
| `SystemSetting.sap_do_source` (`BOTH|ZSD02|VL06O`) | Cài đặt WMS → Hệ thống | `wms_settings.manage_system` | `BOTH` ✔ |
| `LookupValue sap_flow_map` | Cài đặt WMS → Hệ thống (bảng nhỏ) | `manage_system` | seed theo 4.3 ✔ |
| `Warehouse.sap_plant` (khai 2101) | Cài đặt WMS → Kho (ô đã có) | `manage_warehouse` | dữ liệu, không code |
| `VehicleType.*` 8 cột (5.3) | Cài đặt TMS → Loại xe (form) | `tms_vehicle_types.edit` | null/PER_TRIP/70 ✔ |
| `TransportCompany.alias_codes` | Cài đặt TMS → ĐVVT (ô chip đã có) | `tms_companies.edit` | rỗng ✔ |
| `Customer` 8 cột địa lý | Khách hàng → form + cột | `customers.edit` (upload tự điền ô trống) | null ✔ |
| `freight_tariff` / `freight_surcharge` | trang **Cước vận chuyển** (menu TMS) | `freight.manage` | không có = chuyến không cước, không chặn ✔ |
| `Warehouse.dispatch_*` (Đợt 2: ngưỡng Non tải kho, ĐVVT ưu tiên) | Cài đặt WMS → Kho, nhóm "XUẤT — Điều vận" | `manage_warehouse` | null = dùng dòng xe ✔ |

## 10. QUYỀN (đủ 5 việc mỗi action)
- `external_do_sap`: dùng lại `create` cho Up ZSD02; thêm **`compare`** (tab đối chiếu, tạm) — hoặc dùng `view`. Tab "Chưa có OD" dùng `view`.
- Module mới **`freight`**: `view` · `manage` (CRUD + upload cước) · `export`.
- Module mới **`dispatch`** (Đợt 2): `view` (pool + kế hoạch) · `plan` (chạy engine, sửa nháp) · `confirm` (ghi Kế hoạch xuất — cũng cần `external_khvc.create` ở BE qua `requireAnyPerm`) · `export`.

---

## 11. LỘ TRÌNH — checklist verify được

### Đợt 0 — ZSD02 thay VL06O + master (≈ 1 tuần) — **TRẠNG THÁI 22/09: lên `dev` (dbe2e76c → 96267b86), Preview đã kiểm**
> Xong: 1 · 2 · 3 · 4 · 5 · 7 · 8 · 10 (gói QA 59: 22/22) · 11. Dữ liệu: `sap_plant` Bàu Bàng ✔ (migration); ĐVVT khớp theo TÊN bỏ dấu nên chưa cần alias — còn RATRACO và "Vãng Lai" chưa có trong danh mục.
> **Chưa làm:** mục 6 (tab đối chiếu VL06O ↔ ZSD02 — cần user cấp cặp file cùng ngày) · mục 9 phần "thêm dòng xe theo bảng cước" (dời sang đợt 1 cùng `VehicleType` mở rộng).
> **Đo trên Preview:** lát 1 ngày 1.561 dòng (1,4 MB) qua UI: kiểm-trước 5,6 s, ghi 9,7 s → 1.489 OD · 1.561 SO (72 chưa OD) · 144 khách tự sinh có phường · 138 tuyến; tab Chưa có OD 71 dòng OPEN, 360 px không tràn. File TRỌN 25 ngày (3,5 MB): Node 12 s/200, nhưng **trình duyệt không nhận phản hồi** (net::ERR_FAILED) — việc mở: hạ trần FE 4 MB → ~3 MB kèm hướng dẫn "lọc theo ngày trước khi xuất", hoặc đo lại cửa Vercel với body ~3,5 MB.
> **Master lệch thật lộ khi nạp:** mã 610000036 master BAG ↔ SAP EA (0 tồn, 0 dòng đơn — kiểm-trước CHẶN đúng luật, user sửa master) · 16–20 mã lệch khối lượng > 5 %.
1. Migration `20260922_zsd02_source.sql`: cột mới `erp_outbound_orders` + index · bảng `erp_so_lines` · `sap_route` · `Customer` 8 cột · `VehicleType` 8 cột · seed `sap_flow_map` · `SystemSetting.sap_do_source` vào `KNOWN_SETTINGS` (`utils/settings.ts`) → **kiểm tra:** apply staging, `npm run db:types`, `SCHEMA_REVIEW.md`; migration RAISE nếu `erp_outbound_orders` có dòng `qty_base IS NULL` bất thường.
2. `utils/sapUnits.ts` (BE+FE) + `utils/loadCalc.ts` (BE+FE) + `normDvvt` + `flowOf()` → **kiểm tra:** `tests/mirror/sapUnits`, `tests/mirror/loadCalc` (9 mã đo thật: 510000219 → 4,965 kg/thùng, 190 thùng/pallet), `tests/unit/zsd02Parse` chạy trên **file mẫu thật**: 6.916 dòng OD · 1.135 dòng SO · Σ`qty_base` OD = 51.948.685 · 0 dòng chưa OD lọt vào sổ OD · 16 CANCELLED · flow đếm đúng bảng 4.3.
3. `uploadZsd02` (controller external hoặc outbound, `validate()` query) + route + FE nút "Up ZSD02" trong `VcUploadDialog` (mode thứ 3) → **kiểm tra:** preflight in đủ 8 ô mục 4.1; commit trên staging với file mẫu: `inserted/updated/noop` khớp; up lần 2 = 100 % NO-OP; up VL06O sau đó → cột `route_code` còn nguyên.
4. Tab DO SAP: cột `flow` · `Ngày giao` · `Phường` · `ĐVVT SAP` · `Trạng thái ĐP SAP` · `KL (kg)` · `Pallet SAP` + filter; nhãn nguồn → **kiểm tra:** Playwright 1280/390/360, không tràn.
5. Tab **"Chưa có OD"** (sổ SO) + band "SO chờ OD theo kho/ngày" → **kiểm tra:** số dòng = 1.135 file mẫu; dòng `qty_unresolved` có nhãn; CANCELLED ẩn mặc định.
6. Tab **"Đối chiếu VL06O ↔ ZSD02"** → **kiểm tra:** với file VL06O + ZSD02 cùng ngày (user cấp), in khoá lệch/qty lệch/**item lệch**; 0 lệch mới cho phép bước C.
7. Upload Kế hoạch xuất: từ chối DO `flow ∉ lên-xe` kèm lý do → **kiểm tra:** gói QA 12 thêm ca DO RETURN → 400 nêu đúng DO.
8. `ensureCustomers` mở rộng địa lý; `sap_route` nạp → **kiểm tra:** Customer 286 dòng có `ward_code`; khách sửa tay không bị đè.
9. Dữ liệu: `Warehouse.sap_plant=2101` Bàu Bàng · `alias_codes` ĐVVT · thêm dòng xe theo bảng cước → **kiểm tra:** up lại file mẫu = 0 "ĐVVT lạ", 0 "không map kho".
10. Gói QA mới **`59-zsd02-source.mjs`**: up ZSD02 fixture (QA59_*) 3 ca (có OD · chưa OD · RETURN) → sổ đúng · derive chuyến từ OD ZSD02 = cùng `cartons_ordered` như derive từ VL06O cùng số · VL06O sau ZSD02 không xoá cột · `sap_do_source='ZSD02'` → VL06O 409 · dọn sạch. Ratchet độ phủ xanh. `--tier fast` xanh.
11. CLAUDE.md: hàng `external_do_sap` + đoạn "ZSD02 thay VL06O"; docs/plans/README.md thêm dòng.

### Đợt 1 — Cước + tải (≈ 1 tuần)
12. Migration `freight_tariff` + `freight_surcharge` + cột `GroupDeliveryOrder.freight_*` → kiểm tra như trên.
13. Trang **Cước vận chuyển** (list chuẩn `table-format`, FormSheet, upload 2 pha theo cột file thật) + module quyền `freight` → **kiểm tra:** upload file cước user gửi → n dòng, dòng xe chưa có → tạo theo `sap_vehicle_code`; up lần 2 = đè giá không nhân đôi.
14. `services/freight.ts` + test đơn vị (PER_PALLET làm tròn lên, PER_TRIP, rớt điểm, hiệu lực theo ngày, thiếu giá → null có lý do) → cột "Cước dự tính" trên Xuất kho/Kế hoạch VC; tính lại lúc Hoàn thành.
15. Cột tải (pallet/tấn/% tải) trên chuyến + băng **Non tải** + báo cáo Non tải theo kho/ĐVVT/dòng xe → **kiểm tra:** oracle hai đường `loadCalc` TS ↔ RPC `gdo_weight_estimates` trên 50 chuyến thật, lệch ≤ 0,5 %.
16. Gói QA `60-freight.mjs` + `--tier fast`.

### Đợt 2 — Gợi ý ghép chuyến (≈ 2 tuần)
17. `dispatchEngine.ts` thuần + test từng luật (7) + **test hồi quy trên file mẫu**: in bảng máy vs SAP (số chuyến · pallet TB · cước · Non tải).
18. Bảng `dispatch_plan/trip/trip_od` + route `POST /tms/dispatch/plan` (`dispatch.plan`) + `POST …/confirm` (`dispatch.confirm`) → ghi `khvc_lines` → `replanKhvcGroups` → **kiểm tra:** GDO sinh ra đúng số/đúng dòng hàng như upload KH tay cùng nội dung (gói QA 12/14 làm oracle).
19. Trang **Điều vận** (menu TMS): pool "Chưa xếp xe" · nút "Gợi ý ghép" · bảng chuyến nháp kéo-thả OD · cước sống · Xác nhận · xuất Excel đúng định dạng file KH điều vận (để bộ phận khác vẫn nhận file như cũ).
20. Gói QA `61-dispatch.mjs`; ratchet: mọi ghi `khvc_lines` từ engine đi qua đúng một hàm.

### Đợt 3 — Đối soát (≈ 3 ngày) · Đợt 4 — Bản đồ/VRP (khi có geocode; tuỳ chọn)

---

## 12. LƯỚI CHỐNG LỖI (chọn tầng rẻ nhất)
| Lớp lỗi | Tầng |
|---|---|
| Nhãn đơn vị `Thùng/Hộp/Cái/kg` quy sai | test mirror `sapUnits` (BE⇄FE) |
| Dòng chưa OD ghi `qty_base = 0` vào sổ OD | test unit parse trên file thật + bất biến gói 00: `erp_outbound_orders` không có dòng `source='ZSD02'` mà `od_number` rỗng |
| Gross weight quên chia 1.000 | test unit: 510000219 60 thùng → 298,2 kg; QA 59 so `gross_weight_kg` với `loadCalc` lệch ≤ 5 % |
| Hai nguồn đè cột nhau | QA 59 ca "VL06O sau ZSD02" |
| DO trả về / chiết khấu lên xe | QA 12 ca RETURN 400 |
| Item SO ≠ item OD làm reconcile hạ SL | tab đối chiếu bước B + QA 59 ca cố ý lệch item → reconcile **không** hạ `cartons_ordered` khi Σ qty theo (od, material) không đổi (nếu đo bước B thấy cần) |
| `flow` viết `if ('ZRE'…)` rải rác | ratchet `sap_flow_hand_rolled` (baseline 0) |
| Cước tính hai chỗ hai kiểu | `services/freight.ts` là nơi DUY NHẤT; ratchet `freight_price_hand_rolled` |
| Route mới thiếu `validate()` / chưa gói QA chạm | ratchet có sẵn `write_route_without_validate` + độ phủ |

---

## 13. RỦI RO & CÂU HỎI CÒN MỞ
1. **Item SO vs item OD** (4.4) — chỉ đo được khi có VL06O + ZSD02 cùng ngày. Xin user một cặp file.
2. **Xe pallet tính theo pallet, xe tải trọn chuyến** — đúng không? Có tính "pallet tối thiểu" (ví dụ xe 16 pallet chở 10 vẫn trả 16)?
3. **Phí rớt điểm** — theo ĐVVT hay theo dòng xe, số tiền/điểm?
4. **Ưu tiên ĐVVT theo tuyến** (hợp đồng) hay thuần rẻ nhất?
5. Bàu Bàng plant 2101 — khai ngay được không (kho đã dùng luồng SAP chưa)?
6. Cột **"Kho xuất"** không có trong bảng cước bạn gửi — file đó là của một kho hay chung?
7. Hàng xuất khẩu (`ZOR2`, route `XK`, `Số Cont/Seal`) — điều vận có ghép không hay chỉ hiển thị?
