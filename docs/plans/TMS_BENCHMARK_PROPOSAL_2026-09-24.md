# TMS điều vận — đối chiếu phần mềm tiên tiến và đề xuất phương án (24/09/2026)

> User yêu cầu 24/09: *"Phần TMS này tôi cần bạn học hỏi từ các phần mềm tiên tiến để đề xuất phương án."*
> Tài liệu này đứng cạnh `TMS_DISPATCH_PLAN.md` (plan 4 đợt đang chạy). Nó trả lời: các TMS lớn LÀM GÌ, app đang ở đâu,
> và nên đi tiếp thế nào cho đúng bối cảnh LOF (FMCG, 2 kho xuất, ĐVVT hợp đồng theo phường, đơn hàng từ SAP ZSD02,
> điều vận đang ghép tay trên Excel ~1 giờ/ngày). Chưa code gì theo tài liệu này — chờ user chốt.

## 1. Các hệ tham chiếu và bài học rút ra

| Hệ | Điểm đáng học cho LOF | Nguồn |
|---|---|---|
| **SAP TM (S/4HANA)** | Mô hình dữ liệu chuẩn nhất: **Freight Unit** (đơn vị vận chuyển gom từ dòng đơn theo đặc tính tương đồng, gác *incompatibility* — vd hàng lạnh không đi cùng hàng nóng) → **Freight Order** (chuyến) → **Carrier Selection** (chọn ĐVVT theo *chi phí thấp nhất dưới ràng buộc*: giá, tuyến, hạn giao) với **Allocation** (sức chứa/hạn ngạch ĐVVT theo *trade lane × kỳ*, có MIN/MAX) và **Business Share** (tỷ trọng kinh doanh theo ĐVVT). Cả ba là đối tượng riêng, có hiệu lực theo kỳ. | [Freight Unit](https://help.sap.com/docs/r/54cf405c9d9e4c96bf091967ea29d6a7/9.6.2/en-US/84ae04461f244220a2d4ad17d548ae4b.html) · [Carrier Selection](https://help.sap.com/docs/r/54cf405c9d9e4c96bf091967ea29d6a7/9.6.2/en-US/e935629cd7684a2e8769002fe2bf9ebd.html) · [Load Consolidation](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/e3dc5400c1cc41d1bc0ae0e7fd9aa5a2/8800a957487fb576e10000000a4450e5.html) · [LeverX — carrier selection](https://leverx.com/newsroom/sap-subcontracting-and-carrier-selection) |
| **Oracle OTM** | **Bulk Plan**: gom *order release* thành chuyến nhiều điểm bằng thuật toán cấu hình được (không phải một luật cứng); pooling / cross-dock; vòng đời trọn gói tới **freight audit & settlement** (đối soát hoá đơn ĐVVT với cước đã tính). | [Oracle TM](https://www.oracle.com/scm/logistics/transportation-management/) · [ERP Research review](https://www.erpresearch.com/erp-add-ons/tms/oracle-otm) · [SelectHub](https://www.selecthub.com/p/tms-software/oracle-transportation-management/) |
| **Manhattan Active TM** | Quản **mọi ĐVVT, giá, tuyến, tải** trong một nơi; **tendering** (chào chuyến cho ĐVVT nhận/từ chối, tự chuyển ĐVVT kế); **appointment scheduling** (hẹn giờ cửa/khung giờ); **freight bill auditing**; **procurement** (đấu giá/đàm phán hợp đồng cước). Gartner Leader 2026 về TMS. | [Manhattan TM](https://www.manh.com/solutions/supply-chain-management-software/transportation-management) · [ActiveTransportation](https://www.manh.com/solutions/supply-chain-management-software/activetransportation) · [Loadsmart tích hợp](https://loadsmart.com/integrations/manhattan/) |
| **Blue Yonder / Descartes** | Tối ưu tuyến nối với **kế hoạch cung** và **dữ liệu giao thông thật/lịch sử** để dự báo *rủi ro trễ* trước nhiều giờ và tái điều tuyến; Descartes: nạp đơn → tối ưu tuyến theo *yêu cầu giao của khách* → phát tuyến → theo dõi thời gian thực. | [Blue Yonder TM FAQ](https://info.blueyonder.com/transportation-management) · [Route optimization](https://info.blueyonder.com/transportation-management/what-is-route-optimization) · [BY vs Descartes](https://www.gartner.com/reviews/market/supply-chain-management/compare/blue-yonder-vs-descartes) |
| **Abivin vRoute (Việt Nam, FMCG)** | Cùng thị trường LOF: tối ưu tuyến thoả **20+ ràng buộc** (sức chứa, *nhiều khung giờ nhận*, cross-dock, xe tải + xe máy), FTL/LTL tự gán xe, **xếp hàng 3D theo D×R×C**, xe lạnh theo ràng buộc nhiệt độ + telematics; báo cáo tiết kiệm ~40 % chi phí. | [Abivin vRoute](https://www.abivin.com/vroute) · [vRoute 3.0](https://www.abivin.com/blog/transportation-logistics-5/introducing-abivin-vroute-3-0-logistics-optimization-software-1548) · [TMS Việt Nam 2025](https://logitrackvn.com/en/top-transportation-management-software-in-vietnam-worth-using-in-2025) |
| **KPI ngành FMCG** | Thước đo chuẩn của load planning: **% tải xe (pallet/tấn/m³)**, **chi phí/pallet**, **chi phí/tấn·km**, **số điểm giao/tuyến**, **OTIF từng điểm**, tuân thủ tuyến, thời gian bốc/dỡ. | [Fleetx — 7 KPI](https://blog.fleetx.ai/7-critical-kpis-for-load-planning-performance-in-the-fmcg-sector/) · [Fretron — KPI](https://www.fretron.com/blog/key-performance-indicators-for-load-planning-in-fmcg) |

**Bốn bài học chung**, cái nào cũng khớp với thứ app còn thiếu:
1. **Kế hoạch là ĐỐI TƯỢNG có vòng đời** (nháp → chào ĐVVT → chấp nhận → thực thi → đối soát), không phải một lần bấm rồi ghi thẳng.
2. **Ràng buộc là DỮ LIỆU cấu hình**, không phải luật cứng trong code: incompatibility, khung giờ nhận, hạn ngạch ĐVVT theo tuyến×kỳ.
3. **Chọn ĐVVT = tối ưu chi phí DƯỚI ràng buộc hợp đồng** (allocation min/max + business share), rồi **tender** để ĐVVT xác nhận.
4. **Vòng khép kín**: cước dự tính → cước thực → hoá đơn ĐVVT → chênh lệch, và KPI tải/chi phí đưa lên dashboard.

## 2. App đang ở đâu (24/09)

| Năng lực TMS chuẩn | Trạng thái app | Ghi chú |
|---|---|---|
| Nguồn đơn (order release) | ✅ ZSD02 (sổ OD + sổ SO), phân loại `flow` lên xe / không | đợt 0 |
| Master địa lý khách (phường/vùng/kênh) | ✅ `Customer` 8 cột địa lý tự nuôi từ ZSD02 | đợt 0 |
| Danh mục xe hai tầng, sức chứa, nhiệt | ✅ `vehicle_model` 60 mã SAP, cha–con | đợt 1 |
| Bảng cước theo tuyến × ĐVVT × dòng xe, phụ phí | ✅ upload 2 pha, hiệu lực theo ngày | đợt 1 (staging đang là cước SƠ BỘ) |
| Allocation / business share | ✅ ưu tiên khu vực + tỷ trọng %/tháng — **chưa có MIN/MAX sức chứa ĐVVT theo tuyến** | đợt 1 |
| Cước + % tải lên chuyến, tính lại | ✅ | đợt 1 mục 15 |
| **Bulk plan / load consolidation** | 🟡 engine `dispatchEngine.ts` viết xong, biên dịch xanh, **chưa test, chưa lên dev** | đợt 2 — đang dở (mục 4) |
| Incompatibility (lạnh/nóng, kênh) | 🟡 kênh: theo cờ kho; nhiệt: **chưa** (có `temp_mode` trên dòng xe nhưng mã hàng chưa khai nhiệt) | |
| Khung giờ nhận của khách (time window) | ❌ chưa có trên `Customer`; app chỉ có khung giờ CỬA KHO (booking) | |
| Tender / ĐVVT chấp nhận chuyến | ❌ hiện điều vận gọi điện; app không ghi lại chào/nhận | |
| Theo dõi thực thi (GPS/ETA/POD) | 🟡 có Đăng ký cổng, phiếu cân, tài xế tự xác nhận (SELF), kho nhận xác nhận (SCAN) + chấm sao; **không có GPS** | |
| Freight audit & settlement | ❌ đợt 3 (kế hoạch) | |
| KPI tải / chi phí / OTIF theo ĐVVT | 🟡 có OTIF & Dịch vụ; **chưa có % tải, chi phí/pallet, Non tải theo ĐVVT** | |
| Tối ưu tuyến theo km thật (VRP) | ❌ đợt 4; hiện cụm theo PHƯỜNG (cước cũng khoá theo phường nên đủ cho tính tiền) | |
| Xếp hàng 3D | ✅ có sẵn "Xếp xe 3D" bên WMS (theo D×R×C thùng) — chưa nối vào engine | |

## 3. Đề xuất phương án — 3 tầng, chọn theo giá trị/chi phí

### Tầng A — HOÀN THIỆN ĐỢT 2 THEO CHUẨN "BULK PLAN + CARRIER SELECTION" (2 tuần, đang làm)
Giữ engine hiện có (xếp lớn-trước, hạ xe rẻ nhất, gộp Non tải nếu không đắt hơn, chọn ĐVVT theo phân tuyến → tỷ trọng → rẻ nhất), **bổ sung theo SAP TM**:
- **A1. Incompatibility là dữ liệu**: `Material.temp_class` (KHÔ/LẠNH/NÓNG) ↔ `vehicle_model.temp_mode`; bảng nhỏ `dispatch_incompatibility` (loại hàng × loại hàng không đi chung, vd hoá chất × thực phẩm). Engine đọc, không hard-code.
- **A2. Allocation MIN/MAX**: thêm `min_trips/max_trips` (hoặc pallet) theo (kho × ĐVVT × vùng × tháng) cạnh `share_pct` — hợp đồng ĐVVT ở VN hay ghi "tối thiểu N chuyến/tháng". Engine: ĐVVT chưa đủ MIN lên trước ĐVVT dưới tỷ trọng; ĐVVT chạm MAX bị loại.
- **A3. Kế hoạch có VÒNG ĐỜI**: `DRAFT → TENDERED → CONFIRMED` (thêm trạng thái TENDERED, mục B1 dùng); mọi sửa tay ghi vết (đã có `manual_edited`, thêm sổ sự kiện).
- **A4. Xác nhận = ghi Kế hoạch xuất** (như plan), **OD tách theo dòng hàng chỉ được xác nhận khi gom về một xe** — app chưa tách một DO ra hai xe (giới hạn nói thẳng trên màn).
- **A5. Đo trước khi tin**: chạy engine trên file mẫu ZSD02 (627 chuyến SAP đã xếp) → bảng máy vs người: số chuyến · pallet TB/chuyến · % Non tải · Σ cước; test đơn vị từng luật.

### Tầng B — VÒNG KHÉP KÍN VỚI ĐVVT (đợt 3 mở rộng, ~2 tuần)
- **B1. Tender nhẹ kiểu Manhattan**: sau Xác nhận, mỗi chuyến sinh **link chào chuyến** (không cần tài khoản) gửi Zalo/email cho ĐVVT: xem OD · điểm giao · dòng xe · cước → **Nhận / Từ chối (lý do)**; từ chối ⇒ app đề xuất ĐVVT kế theo đúng thứ tự phân tuyến; hết hạn N giờ chưa trả lời ⇒ nhắc. Điều vận không còn phải gọi điện từng xe và có VẾT ai nhận lúc nào.
- **B2. Biển số + tài xế do ĐVVT khai** trên chính link đó → đổ vào Đăng ký cổng (bảo vệ đỡ nhập tay) và Kế hoạch VC.
- **B3. Freight audit & settlement**: ĐVVT gửi bảng kê tháng (Excel) → upload 2 pha → khớp từng chuyến với cước THỰC (tính lại lúc Hoàn thành) → bảng chênh lệch (thiếu chuyến · sai đơn giá · phụ phí lạ) → chốt kỳ → xuất bảng đối soát. Đây là nơi bảng cước "sơ bộ" phải được thay bằng cước hợp đồng.
- **B4. KPI ĐVVT & tải** vào tab KPI (một nguồn `kpiDefs`): % tải TB theo dòng xe, % chuyến Non tải, chi phí/pallet, chi phí/tấn·km (khi có km), OTIF theo ĐVVT, tỷ lệ nhận chuyến, sao kho nhận chấm (đã có). Scorecard ĐVVT hằng tháng.

### Tầng C — TỐI ƯU THEO KM THẬT VÀ KHUNG GIỜ (đợt 4, khi có geocode; ~3 tuần)
- **C1. Geocode phường** (tâm phường từ OpenStreetMap/Nominatim — miễn phí, 1 lần cho ~300 phường) → ma trận km giữa phường (OSRM tự host hoặc Google Distance Matrix có phí) → gộp cụm theo **khoảng cách thật**, không chỉ "cùng phường / cùng vùng".
- **C2. Khung giờ nhận** trên `Customer` (BHX/KA thường có giờ nhận cố định) + thời gian dỡ hàng ước tính → sắp thứ tự điểm giao trong chuyến, cảnh báo chuyến không kịp.
- **C3. VRP đúng nghĩa** (như Abivin/Blue Yonder): tối thiểu tổng cước + số xe dưới ràng buộc sức chứa · khung giờ · nhiệt · điểm giao — dùng OR-Tools chạy nền (Node gọi service Python hoặc WASM), engine hiện tại làm lời giải khởi tạo.
- **C4. Xếp hàng 3D nối engine**: kiểm chuyến có xếp vừa thùng theo D×R×C trước khi khoá dòng xe (đã có mô-đun 3D bên WMS).
- **C5. Theo dõi thực thi**: ETA/GPS chỉ khi ĐVVT có telematics; trước đó dùng mốc app đã có (vào cổng · cân · hoàn thành · kho nhận xác nhận) để vẽ dòng thời gian từng chuyến.

### Điều CỐ Ý KHÔNG đề xuất
- Không mua/nhúng TMS ngoài: cước, khách, xe, đơn đều đã nằm trong app và khoá theo phường — mọi TMS ngoài sẽ đòi tích hợp hai chiều với chính dữ liệu này.
- Không làm portal ĐVVT có tài khoản ở tầng B — link chào chuyến ký số đủ dùng, rẻ hơn nhiều lần.
- Không chạy VRP trước khi có km thật: cụm theo phường đang khớp đúng cách cước được tính, VRP trên "phường bằng nhau" không thêm gì.

## 4. Trạng thái code đợt 2 (24/09 chiều — user chốt "thực hiện theo đề xuất" + config phản hồi ĐVVT)
- **User chốt 24/09 chiều:** đi A → B → C theo đề xuất; **thêm config: ĐVVT cần phản hồi hoặc không** ("không phản hồi nghĩa là nếu muốn đổi thì điều vận tự manual đổi"). Đã làm thành `TransportCompany.tender_required` (form ĐVVT, Cài đặt TMS; mặc định KHÔNG = hành vi cũ) — chính là A3 (vòng đời) làm ngay ở tầng A với đợt A "điều vận ghi thay câu trả lời", đợt B đổi thành link cho ĐVVT tự trả lời.
- Migration `20260924_dispatch_plan.sql` + `20260924b_dispatch_tender.sql` **đã áp staging**; `database.ts` sinh lại.
- `services/dispatchEngine.ts` (thuần, **32 test** `tests/unit/dispatchEngine.test.ts` — mỗi luật một phép kiểm, đã thử ngược 1 luật thành đỏ) · `controllers/tms/dispatchController.ts` (plan · list · get · patch trip · move-od · confirm · **settle** · **respond** · discard) · 9 route + quyền `dispatch` · trang `pages/tms/Dispatch.tsx` (cột Trạng thái xe, khối phản hồi ĐVVT trong panel xe) · nhóm "XUẤT — Điều vận" form Kho · công tắc ở form ĐVVT. **Gói QA 61 (42 phép) xanh** trên backend cục bộ + DB staging.
- **Lỗi thật gói 61 bắt ngay lượt đầu (đã vá):** engine xếp lớn-trước vào xe LỚN NHẤT của danh mục (60 dòng thật, cont 30 pallet) dù không ĐVVT nào chào giá cho xe đó ⇒ chuyến "không ĐVVT, không cước" trong khi xe 9 pallet có cước chở được. Nay xe lớn nhất = trong số dòng xe CÓ CƯỚC cho phường của cụm; không có cước nào mới rơi về xe lớn nhất chung.
- **Chưa (chờ user chốt câu 2–3 mục 5):** A1 hàng không đi chung theo nhiệt (Material chưa có temp class) · A2 MIN/MAX theo ĐVVT × vùng × tháng · A5 đo máy vs người trên 627 chuyến SAP · soi UI Playwright trên Preview.

## 5. Câu hỏi để chốt
1. Đi theo **A → B → C** đúng thứ tự trên? Hay ưu tiên B3 (đối soát hoá đơn ĐVVT) trước B1 (tender)?
2. A2: hợp đồng ĐVVT của LOF có ghi **tối thiểu/tối đa chuyến hoặc pallet theo tháng** không? Có thì khai theo vùng hay theo kho?
3. C2: khách nào đang có **khung giờ nhận cố định** (BHX/KA)? Nếu nhiều thì C2 nên lên trước C1.
4. Ba điểm còn mở của đợt 2 (đã hỏi 24/09 sáng): tách một OD ra hai xe · tỷ trọng đo theo chuyến/pallet/tấn · số điểm giao tối đa và trộn kênh theo kho — hiện lấy mặc định: không tách (trừ OD lớn hơn xe lớn nhất, và phải gom lại trước khi xác nhận) · theo `basis` từng dòng mục tiêu (mặc định số chuyến) · 3 điểm, không trộn kênh, chỉnh ở form Kho.
