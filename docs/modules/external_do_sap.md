# Dữ liệu bên ngoài → DO SAP (`external_do_sap`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Dữ liệu bên ngoài → DO SAP · Chưa có OD (ZSD02 / VL06O)

**Quyền (BE `ALL_PERMISSIONS`):** view · create · edit · delete · export

## Giao thoa với
<!-- giao-thoa:start -->
- [`dashboard`](dashboard.md) — Dashboard (Tổng quan) (được nhắc tới từ đó)
- [`directed_work`](directed_work.md) — Việc cần làm (được nhắc tới từ đó)
- [`dispatch`](dispatch.md) — Điều vận (được nhắc tới từ đó)
- [`external_khvc`](external_khvc.md) — Dữ liệu bên ngoài → Kế hoạch xuất (file này nhắc tới)
- [`freight`](freight.md) — Cước vận chuyển (được nhắc tới từ đó)
- [`outbound`](outbound.md) — Xuất kho (hai chiều)
- [`tms_companies`](tms_companies.md) — TMS — ĐVVT / NCC (file này nhắc tới)
- [`wms_settings`](wms_settings.md) — Cài đặt WMS (file này nhắc tới)
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

**Dữ liệu bên ngoài** (menu Báo cáo) — sổ DO raw `erp_outbound_orders` + tab **Chưa có OD** (sổ SO `erp_so_lines`, 22/09). **ZSD02 THAY VL06O (đợt 0 plan `docs/plans/TMS_DISPATCH_PLAN.md`, user chốt 21/09 "thay thế trước, không song song"):** báo cáo SAP ZSD02 (79 cột, mức dòng SO/OD) nạp qua `POST /external/do-sap/upload-zsd02` — cùng khuôn VL06O (preflight 2 pha · nạp có so sánh giữ id · NO-OP · OBSOLETE · reconcile · kích hoạt chuyến chờ; hai khối dùng chung `sapScopeCheck`/`activateAwaitingForDos` tách từ `uploadVl06o`). **SỐ LƯỢNG — hai tập KHÁC bản chất:** dòng **CÓ OD** → sổ OD, `qty_base` = "OD Qty (Base Unit)" (y hệt Actual của VL06O, mọi cửa đọc phía sau không đổi); dòng **CHƯA OD** → **KHÔNG BAO GIỜ vào sổ OD** (SAP để base = 0 ở 100 % dòng đó — ghi 0 là reconcile hiểu "SAP nói 0" và hạ `cartons_ordered`), chỉ sống ở sổ SO với `qty_so_base` **DẪN XUẤT 3 bậc** (đơn vị bán = base → chính số SO · Thùng → hệ số quan sát từ dòng có OD cùng mã trong file · → `units_per_carton` master · hết → NULL + `qty_unresolved`, KHÔNG đoán) kèm cờ `qty_base_derived/derive_source`; tab "Chưa có OD" chỉ để nhìn trước tải, không lên xe (không có khoá OD thì không có dòng hàng/tem). Đơn vị bán ghi CHỮ (Thùng/Hộp/Cái/kg) → quy nhãn ở `utils/sapUnits.ts` (BE+FE mirror) TRƯỚC khi so master; nhãn lạ → 400 UNIT_MISMATCH kèm bảng. `Gross Weight` = GRAM → kg; pallet/m3 SAP chỉ tham chiếu, tải thật = `utils/loadCalc.ts` (mirror) từ master, thiếu master rơi về SAP có cờ nguồn. **`flow`** phân loại dòng từ `LookupValue sap_flow_map` (mã SAP → SALE/STO/INTERNAL/PALLET lên xe · RETURN/DISCOUNT/UNKNOWN **không lên xe**): Kế hoạch xuất (upload + thêm dòng) từ chối DO đó kèm lý do (`notLoadableDos`). ZSD02 còn nuôi `sap_route` (231 tuyến) + địa lý `Customer` (`ward_code` = "Tên Phường" = KHOÁ CƯỚC, chỉ điền ô trống) + `dvvt_code` qua `TransportCompany.code/alias/tên` bỏ dấu. **Công tắc `SystemSetting.sap_do_source`** (Cài đặt WMS → Hệ thống): BOTH (mặc định, đối chiếu) · ZSD02 (cửa VL06O 409 `SOURCE_DISABLED`) · VL06O (đường lui); hai nguồn ghi cùng sổ theo khoá (od, item), VL06O nạp sau không xoá cột ZSD02-only. ⚠ Rủi ro chưa đo: cột `Item` ZSD02 là item SO, VL06O là item OD — cần cặp file cùng ngày trước khi cắt hẳn. Bộ đọc thuần `services/zsd02Parse.ts` có test chạy trên file mẫu thật; gói QA 59 gác. **BẢNG GIỮ CỘT QUAN TRỌNG, PHẦN CÒN LẠI Ở PANEL CHI TIẾT (user chốt 24/09 "SO, PO SAP, sold-to ship-to, tên tuyến, ghi chú… còn lại đưa vào detail"):** tab DO SAP + Chưa có OD có cột SO/PO SAP · Sold-to · Tuyến (tên + mã route) · Ghi chú; **bấm dòng mở `SapLineDetailSheet`** in đủ 79 cột theo 6 khu (nhãn SAP dùng chung ở `pages/external/sapLabels.ts`). ⚠️ **Cột file KHÔNG khai trong `ZSD02_FIELDS` là RƠI HẲN, không vào `raw`** — `parseSheetByHeader` chỉ dựng object từ cột đã map (đo 24/09: 54/79 header được khai trong khi plan viết "còn lại nằm trong raw"; cột Batch đọc `batch` của VL06O nên dòng ZSD02 luôn "—" dù có SO-Batch). Nay khai đủ 79/79 (test kiểm header file mẫu = số key dòng), `raw._v = 2` + ô ngày về YYYY-MM-DD; **dòng NO-OP mà `raw` hình dạng cũ thì cửa nạp ghi lại RIÊNG raw, giữ `updated_at`, không tính cập nhật, không kích reconcile** (`raw_v:raw->>_v` trong select so sánh). Thêm cột vào file SAP → khai vào `ZSD02_FIELDS` (có cột riêng hay không), tăng `RAW_VERSION` nếu đổi cách dựng raw

## Actions

view, create (= Up VL06O/ZSD02 tại trang này, hoặc `outbound.import`), edit, delete, export 
