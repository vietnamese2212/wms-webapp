---
name: check-app
description: SKILL DUY NHẤT để "kiểm tra app / rà lỗi / test / tìm chỗ sai / cải tiến" ở phạm vi rộng — thay việc user ngồi test từng case. Bao TRỌN mọi lớp: (1) chức năng + đúng nghiệp vụ (tự tính lại độc lập làm chuẩn, cross-check output API/UI/DB), (2) UI/hiển thị (Playwright desktop+mobile, định dạng số/đơn vị, responsive, console), (3) phân quyền (per-role thật), (4) đồng thời/tải/toàn vẹn (SIM harness API thật, bất biến, phân loại vi phạm ảo/thật), (5) hiệu năng (đọc-dưới-tải-ghi, EXPLAIN, index/RPC), (6) edge-case + realtime 4-case, (7) PHÁN ĐOÁN nghiệp vụ & UX (đọc output phản biện theo luật domain, chỉ ra chỗ "trông sai/khó dùng"), (8) fix tối thiểu + đo lại trước/sau + (nếu cần) cutover production. KHÔNG đụng dữ liệu thật (tự seed SIM có tag, dọn 0 sót). Chọn phần theo quy mô yêu cầu: rà nhanh 1 màn → vài phần; "test kỹ toàn app" → chạy đủ. CHẠY TỰ CHỦ (AFK): user không ngồi click — KHÔNG hỏi/không bắt user click giữa chừng, tự làm mọi thao tác (kể cả Playwright), lựa chọn nhỏ chọn default + ghi lại, việc cần duyệt (production) dồn vào đề xuất; kết thúc = báo cáo + đề xuất ĐẦY ĐỦ, dứt điểm.
---

# Check App — kiểm tra toàn diện, tìm lỗi, cải tiến (1 skill duy nhất)

> Mục tiêu: **thay tối đa việc user ngồi bấm từng case tìm lỗi.** Phủ MỌI lớp lỗi WMS: chức năng/nghiệp vụ · UI/hiển thị · phân quyền · đồng thời/tải · hiệu năng · edge/realtime · phán đoán nghiệp vụ+UX. Chọn phần phù hợp quy mô (đừng chạy đủ 8 phần cho 1 màn nhỏ; chạy đủ khi user nói "test kỹ/toàn app").
> Gồm luôn tinh thần các skill khác — khi đụng đúng việc, mở kèm: [[verify-feature]] (gate compile/realtime), [[table-format]] (chuẩn list/table), [[add-permission]] (4 nơi), [[mutation-realtime]] (INSERT/realtime), [[debug-systematic]] (khoanh 1 bug), [[review-module]] (bề mặt module), [[concurrency-hardening]]/[[cap-1000-campaign]] (họ lỗi đã biết).

## Bài học gốc (vì sao có skill này)
- **23/07/2026:** tải đa-module lộ 2 lỗi per-feature test bỏ sót — `adjust` ghi tồn+log KHÔNG nguyên tử (dưới 504 mất log) + list nặng chậm 3–10× dưới tải ghi (thiếu index). Con người **không click-test** được lớp này.
- Nhưng automation cấu trúc **không tự thấy** lỗi HIỂN THỊ (bug "3.083 đọc nhầm nghìn" = format sai) hay lỗi NGHIỆP VỤ (FEFO sai thứ tự, %Date sai, tách NPP sai) hay lỗi QUYỀN (vai thiếu quyền). ⇒ Skill này ép kiểm **cả 6 lớp + phán đoán**, không chỉ tải.

## Nguyên tắc cốt tử (đọc trước)
1. **KHÔNG đụng dữ liệu thật.** Tự seed SIM có TAG (`SIMWMS`), thao tác + dọn trên chính nó; cần tồn thì tự tạo pallet SIM. Mặc định **STAGING** (`.mcp.json`/`.env` staging, branch `dev`). Production chỉ khi user nói RÕ.
2. **ORACLE = TỰ TÍNH LẠI ĐỘC LẬP.** Muốn biết "kết quả đúng chưa" mà không cần user: **tính lại giá trị kỳ vọng từ dữ liệu thô/luật domain rồi diff với cái app trả/hiện** (vd tự tính `qtySplit`, `%Date` theo `computePctDate`, thứ tự FEFO, tổng cross-mã chia hệ số, tồn=imported−Σscan). Lệch = lỗi. Đây là cách "test từng case" không cần người ngồi so.
3. **PHÁN ĐOÁN chủ động, không chỉ pass/fail máy móc.** Đọc output bằng con mắt phản biện + luật trong CLAUDE.md/memory: "số này có vô lý không? đơn vị đúng không? luồng này có khó dùng không?". Nghi ngờ dù test "xanh" → đào tiếp. Đây là phần nghiệp vụ+UX.
4. **Không lộ mật khẩu trong tool call** (đọc creds trong tiến trình). **Dọn 0 sót + verify độc lập.** Quy mô khớp yêu cầu; in-flight ~15–25, đừng bắn tải lớn lúc user thật đang dùng.

## Chế độ TỰ CHỦ (AFK) — MẶC ĐỊNH khi user gọi test/check app
User **AFK, không ngồi click**. Chạy TRỌN VẸN từ đầu tới cuối KHÔNG dừng hỏi, KHÔNG bắt user click:
- **Tôi tự làm MỌI thao tác** (setup · seed SIM · click/điền/quét qua Playwright · gọi API · verify · dọn). Người dùng không phải chạm gì.
- **KHÔNG dùng AskUserQuestion / không hỏi giữa chừng.** Gặp lựa chọn nhỏ (tham số/thứ tự/phạm vi) → chọn **default hợp lý + GHI vào báo cáo**, không chặn.
- Gặp việc **KHÔNG được tự làm** (ghi production · thao tác phá hủy · ngoài phạm vi an toàn staging/SIM) → **KHÔNG làm âm thầm**; dồn thành **ĐỀ XUẤT** cuối báo cáo để user duyệt sau. (Chế độ tự chủ KHÔNG nới quyền production — vẫn "chỉ khi user nói RÕ".)
- Chạy dài thì dùng background task/subagent, **tự chờ tự tiếp**, không nhờ user thúc.
- **Chỉ dừng sớm** nếu: nguy cơ đụng data thật/production ngoài ý muốn, hoặc bế tắc kỹ thuật không tự qua — và nêu NGAY ĐẦU báo cáo lý do. (An toàn > tự chủ.)
- **Kết thúc = BÁO CÁO ĐẦY ĐỦ + ĐỀ XUẤT** (bắt buộc, xem Phần 8), dứt điểm, không hỏi lại: đã kiểm gì (phần chạy/skip + quy mô + bằng chứng số/ảnh) · lỗi THẬT (phân loại ảo/thật + mức độ + cách tái hiện) · nghi ngờ nghiệp vụ/UX · đã fix + đo trước/sau + dọn 0 sót · **đề xuất**: fix chưa làm (ưu tiên), việc cần user duyệt (production/quyết định nghiệp vụ), follow-up.

## Công cụ
pg trực tiếp (`scratchpad/node_modules/pg`) cho seed/cleanup/EXPLAIN/tính-lại; Postgres MCP đọc staging; **Vercel Preview dev** làm API tải; Playwright cho UI thật (login creds `frontend/.env`). `qty_semantics:'base'` trong BODY mọi write; prefix WMS `/api/wms`, TMS `/api/tms`.

---

## Phần 0 — Phạm vi + chuẩn bị
- Chốt phạm vi theo yêu cầu (1 màn / vài module / toàn app) → chọn phần nào chạy.
- **Trích hợp đồng API TỪ CODE** (routes+controller): method/path/quyền/body(field+kiểu, số lượng có BASE?)/shape/điều kiện chặn/cơ chế đồng thời. Rộng → cử subagent song song. **Đừng đoán payload** (phát hiện giả).
- Introspect **tên bảng/cột thật** (`information_schema`) — đừng tin tên nhớ (vd `OutboundItem.do_id`, `inbound_plan_lines.tms_order_id`).
- Neo DB thật (kho/mã/vị trí/loại xe/NPP) để dựng case GIỐNG THẬT.

## Phần 1 — Chức năng + ĐÚNG NGHIỆP VỤ (oracle = tự tính lại)
Với mỗi luồng/màn trọng yếu: chạy qua API/UI thật rồi **so kết quả với giá trị tự tính lại độc lập**:
- Số lượng/đơn vị: tự `qtySplit`/`qtyEntryDecimal` từ base + `units_per_carton` → khớp "N thùng + M hộp" app hiện? Tổng cross-mã = Σ chia hệ số (không cộng base thô)?
- %Date/HSD: tự `computePctDate(entry, material)` (ưu tiên HSD tường minh) → khớp app?
- FEFO/FIFO/LIFO: tự sắp thứ tự → khớp gợi ý lấy hàng?
- Tồn/xuất: `remaining==imported−Σscan`; "không xuất quá KH"; hoàn thành phải khớp thực quét.
- Tách/gộp: NPP là khóa tách dòng; dồn/tách pallet số lượng bảo toàn.
- **Realtime 4 case** (tạo/sửa/xóa/làm lại → số cập nhật ngay, không stale) — theo [[mutation-realtime]].
- **Edge**: rỗng/biên/âm/NaN/0/số cực lớn/ngày quá khứ/mã không entry (thập phân) vs có entry (nguyên).

## Phần 2 — UI / HIỂN THỊ (Playwright)
- Chạy **desktop 1280 + mobile 390 + 360** (mốc tràn) [+768 nếu có pane]. Đọc lại ảnh từng cỡ, không chỉ chụp.
- Bắt lỗi lớp hiển thị (automation cấu trúc bỏ sót): **định dạng số vi-VN + đúng đơn vị** (bug "146.063/3.083 đọc nhầm nghìn"), cột sai đơn vị (base vs thùng), **không tràn ngang** ≤360, nút/dropdown không bị che, filter gom "Lọc(n)" mobile, màu row theo trạng thái, badge status, sticky header/cột đầu, **console 0 lỗi** (`ERR_INSUFFICIENT_RESOURCES`…). Chuẩn: [[table-format]].
- **Refresh giữa lúc tải nặng** (nếu chạy Phần 4 song song) → KHÔNG bị đá `/login`.

## Phần 3 — PHÂN QUYỀN (per-role thật)
Không chỉ login admin. Với action write: **ẩn nút đúng khi thiếu `can()`** + **route FE bị chặn** + **BE trả 403** (vai thật, không phải admin). Kiểm đủ 4 nơi (FE `MODULES`/BE `ALL_PERMISSIONS`/gate nút/route). Chuẩn E2E 3 lớp: [[perm-test-standard-e2e]] · [[add-permission]]. Soi scope dữ liệu (kho ∩ loại hàng, cấp dưới) cắt đúng.

## Phần 4 — ĐỒNG THỜI / TẢI / TOÀN VẸN (SIM harness)
- Seed SIM tự chứa (pallet_code `SIMWMS_…`, +id/updated_at/reserved 0/origin), vài location (1 cap nhỏ để ép tràn), slot+order+vslot (tag ngày đặc biệt). **Phân tách pallet theo mục đích** để bất biến CHÍNH XÁC (nhóm A chỉ consume; nhóm B chỉ adjust/move).
- **SMOKE 1-mỗi-flow trước khi scale** (validate payload live).
- Waves đa-module + đa-kho đồng thời (~15–25 in-flight, rải + tranh chấp): outbound scan cùng pallet nhiều GDO · adjust hot-subset · move vào cap nhỏ · booking burst cap nhỏ · gate lifecycle · inbound · upload.
- **Bất biến mỗi wave**: tồn/reserved không âm · consume==Σscan · adjust `remaining==imported+Σdelta` & `Σdelta==adjustment_qty` · occupancy≤max · `booked_count≤max & ==biển phân biệt` · **0×500 · 0×401** (4xx tranh chấp là kỳ vọng).
- ⭐ **PHÂN LOẠI vi phạm**: re-check SAU khi in-flight lắng → khớp lại = **ẢO** (đo lúc 504/đang chạy dở); còn lệch = **THẬT**, đào tiếp. (Chính chỗ này lộ bug adjust.)

## Phần 5 — HIỆU NĂNG
- **Đọc-dưới-tải-ghi**: N reader bắn GET list nặng (Tồn/Xuất/Nhập/Dashboard) trong khi M writer hammer; đo **p50/p95/max + status** baseline vs dưới tải. p95 phình nhiều = nghẽn.
- `EXPLAIN (ANALYZE,BUFFERS)` query nghi → Seq Scan bảng lớn/thiếu index khớp shape → **index composite** (`(warehouse_id, import_date desc nulls last, id)`; `INCLUDE(cartons_remaining)` cho SUM/COUNT).

## Phần 6 — PHÁN ĐOÁN NGHIỆP VỤ & UX (bắt buộc, dù các phần trên "xanh")
Đây là phần thay "con mắt người":
- **Nghiệp vụ**: giá trị nào "trông sai/vô lý" so luật domain? (tồn 1 mã > năng lực kho? %Date âm? mã có entry mà tồn lẻ hộp? tổng "thùng" nhưng thực là base thô?). Đối chiếu luật cốt tử trong CLAUDE.md (BASE UNIT, timezone VN, cap-1000, số nguyên mã entry) + memory. Nghi → tự tính lại xác minh.
- **UX**: luồng có nhiều bước thừa? trạng thái rỗng/loading/lỗi có rõ? nút chờ (`disabled` + text)? lỗi hiện banner đỏ inline hay chỉ console? mobile bấm có dễ (touch target)? thông báo tiếng Việt rõ nghĩa?
- Ghi lại **mọi nghi ngờ** kèm lý do — kể cả chưa chắc là bug (để user quyết). Đừng im vì "test máy đã pass".

## Phần 7 — FIX tối thiểu + ĐO LẠI + (lên production)
- Sửa đúng nguyên nhân gốc, phạm vi nhỏ ([[debug-systematic]]). Toàn vẹn: gộp ghi-nhiều-bước vào **1 RPC row-lock** + fallback. Perf: index/RPC. Mutation: [[mutation-realtime]] + migration `backend/migrations/*` + apply staging + `SCHEMA_REVIEW.md` + bump rebuild-token.
- **ĐO LẠI cùng tham số → so trước/sau** (bằng chứng số). tsc/build xanh.
- **CHỐNG HỒI QUY (sau MỌI fix):** chạy lại bộ regression chuẩn `node scripts/qa/run-all.mjs` (invariant/smoke sau sửa nhỏ; **FULL 4 gói XANH BẮT BUỘC trước khi merge `dev`→`main`** — luật CLAUDE.md + [[verify-feature]] Cổng 5b + memory `qa-regression-suite`). Regression là cổng LẶP LẠI, không do check-app sở hữu — check-app chỉ GỌI nó để chắc fix không làm vỡ luồng đang chạy.
- **⚠️ Verify FE fix qua trình duyệt PHẢI dùng fresh context/incognito** — app là PWA, service worker precache trả bundle CŨ cho context đang mở → tưởng fix không ăn (đã bị lừa 1 lần 23/07).
- **Lên production (chỉ khi user nói RÕ)**: KHÔNG merge ẩu. preflight read-only → migration additive trước (thứ tự phụ thuộc) → cutover/data cùng cửa sổ deploy (freeze+backup+transaction verify+rollback nếu đổi nghĩa dữ liệu) → DROP sau khi code live → **verify 4 tầng** (DB·RPC·code probe route 401/404·app-smoke live 200). Chi tiết: [[production-golive-2026-07-23]] + `BASE_UNIT_EXECUTION_PLAN.md` 2.4.

## Phần 8 — DỌN 0 SÓT + báo cáo + memory
- Cleaner theo TAG **`LIKE '%TAG%'`** (tag có thể GIỮA chuỗi). Nhận diện SIM CHÍNH XÁC (GDO qua join delivery `delivery_code`/`distributor_name`; thu id vào JS trước khi xóa; order phụ qua `transfer_gdo_id`), xóa theo thứ tự FK. **verifyClean có điểm mù → quét phòng thủ orphan** + cửa sổ thời gian. Residue = 0 mọi bảng.
  - ⚠️ **Điểm mù ĐÃ GẶP (23/07): cleaner GDO chỉ join `OutboundDelivery.delivery_code/distributor_name` → BỎ SÓT `GroupDeliveryOrder.license_plate`.** Nếu tem/biển SIM chỉ nằm ở `license_plate` (không ở delivery_code/npp), GDO cha sống sót sau khi con bị xóa → 10 GDO `SIMWMS-*` treo, thổi "Xuất hôm nay". ⇒ Cleaner GDO PHẢI quét THÊM `GroupDeliveryOrder.license_plate ILIKE '%TAG%'` (và mọi cột mang tem/biển ở CHÍNH bảng cha, không chỉ bảng con join). Đặt biển SIM có TAG (`SIMxxx-...`) để quét được. Xóa script scratchpad (nhất là file chứa creds) + ảnh Playwright; `git status` sạch (đừng add `Template upload.xlsx`).
- **Báo cáo TRUNG THỰC**: đã kiểm phần nào (bằng chứng số/ảnh), lỗi THẬT (kèm phân loại), fix + đo trước/sau, **nghi ngờ nghiệp vụ/UX** để user quyết, phần skip + lý do. Fail nói fail. Ghi memory `project` + `MEMORY.md`.

## Kỹ thuật kế thừa từ công cụ chuẩn (áp bằng plain-node/SQL — KHÔNG cài dependency)
Không thêm tool/framework vào repo (giữ luật "viết tối thiểu"); **học phương pháp** rồi tự làm ad-hoc trong `scratchpad`:
- **Property-based (fast-check) → P1/P6:** với helper thuần (`qtyUnits`/`shelfLife`/`qrParser`/`loadPlan`), sinh **hàng nghìn input ngẫu nhiên** (kể cả biên 0/âm/cực lớn/thập phân/mã không-entry), assert **bất biến** đúng MỌI input (split round-trip `qtyFromEntryBase(qtySplit(x))==x`; mã entry→base nguyên; %Date đơn điệu theo NSX). Fail → **thu nhỏ về counterexample tối thiểu** + in seed để tái hiện. (Chính là "fuzz 115k case qtyUnits" đã làm.)
- **Index giả định (HypoPG/index_advisor) → P5:** phát hiện thiếu index KHÔNG cần extension — (a) `pg_stat_user_tables`: `seq_scan` ≫ `idx_scan` trên bảng lớn; (b) thử index trong transaction rồi bỏ: `BEGIN; CREATE INDEX …; EXPLAIN (ANALYZE,BUFFERS) <query>; ROLLBACK;` → so cost trước/sau mà không giữ đĩa. Chọn index thắng mới `CREATE` thật + migration.
- **API fuzz (EvoMaster) → P4:** bắn endpoint với input sinh/bậy (thiếu field, sai kiểu, âm/NaN, id lạ, vượt quyền) truy **500 / lệch shape / lọt quyền** — không chỉ happy-path.
- **Record-replay golden (Keploy) → P1:** luồng ổn định → lưu response chuẩn làm "golden", chạy lại sau sửa → diff bắt hồi quy.
- **Kỷ luật đo tải (k6) → P4/P5:** báo **p50/p95/p99 + ngưỡng pass/fail** (vd p95 đọc < 3s), tăng tải theo bậc (ramp), giữ arrival-rate ổn định — không chỉ đếm lỗi.
- **UI bằng ngôn ngữ tự nhiên (Stagehand/Midscene) → P2:** dùng Playwright MCP sẵn có + assert mô tả bằng lời ("cột Tồn hiện thùng+hộp đúng"), bám selector đổi.
> Muốn CHUẨN HOÁ chạy tự động/CI cho người khác thì mới cài tool thật (fast-check/`supabase/index_advisor`/k6) — việc RIÊNG, KHÔNG bắt buộc cho skill này.

## Ranh giới còn lại (nói thật với user)
Skill này phủ hầu hết, nhưng vẫn còn: **yêu cầu MỚI chưa mô tả** (không có "đúng" để so) + **quyết định UX mang tính thẩm mỹ/thương mại** cuối cùng thuộc user. Máy tính lại được cái CÓ luật; cái chưa có luật thì skill nêu nghi ngờ để user chốt, không tự quyết thay.

## Checklist (tick phần đã chạy, ghi rõ phần skip)
- [ ] P0 phạm vi + hợp đồng API từ code + neo DB thật
- [ ] P1 chức năng/nghiệp vụ: **tự tính lại độc lập** diff output + realtime 4-case + edge
- [ ] P2 UI: Playwright desktop 1280 + mobile 390/360, format số/đơn vị, không tràn, console 0 lỗi
- [ ] P3 phân quyền per-role thật (ẩn nút + chặn route + 403 BE, 4 nơi)
- [ ] P4 tải đa-module: SIM harness, bất biến, **phân loại ảo/thật sau lắng**
- [ ] P5 hiệu năng: đọc-dưới-tải-ghi p50/p95 + EXPLAIN + index
- [ ] P6 **phán đoán nghiệp vụ + UX** (nghi ngờ gì cũng ghi)
- [ ] P7 fix tối thiểu + đo lại trước/sau (+ cutover nếu user cho phép)
- [ ] P8 dọn 0 sót + verify độc lập + báo cáo trung thực + memory
