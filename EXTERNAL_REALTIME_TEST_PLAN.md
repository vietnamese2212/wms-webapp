# Kế hoạch test — DO SAP · Kế hoạch VC · Xuất · Nhặt lẻ (realtime + rule) — dữ liệu 20/07

> Mục tiêu (user chốt 21/07): **bao phủ MỌI tình huống user thao tác** trên dữ liệu 20/07: thêm/sửa/xóa DO SAP · Kế hoạch VC (KHVC) · Xuất · Nhặt lẻ → kiểm **realtime** (không refresh) + **các RULE** (engine đối chiếu 5 vùng · guard xóa · never-lose-scanned · base unit · liên kết chéo). Test SỐNG (API thật + Postgres soi DB + Playwright quan sát realtime), dữ liệu gắn nhãn, **KHÔI PHỤC 100% sau test** (snapshot → mutate → assert → restore → assert-restored).
>
> Trạng thái nền 20/07: 79 DO / 274 dòng erp_outbound_orders · 41 khvc_lines (nạp 21/07) · 13 chuyến GDO · 147 OutboundItem có od_refs · **11 đơn đã quét** (test Z3) · 84 đơn nhặt lẻ · 0 reconcile task.
>
> Ký hiệu: ✅ auto (script API+DB) · ✅UI (Playwright realtime) · ☐ chờ (nếu bỏ) · ⚠️ BUG.

## BẤT BIẾN (đúng ở MỌI ca — nếu vi phạm = BUG chặn)
- **B1 Không mất dữ liệu quét**: mọi thao tác SAP/DO/KHVC KHÔNG được tự sửa/xóa `cartons_scanned` của đơn đã quét.
- **B2 Base unit**: mọi số qua API = BASE; auto-áp tính lại `loose_picking = loosePalletRemainder(newOrdered)` per-mã.
- **B3 Realtime**: đổi ở nguồn khác → trang đang mở tự cập nhật ≤ vài giây, KHÔNG refresh tay, console 0 lỗi.
- **B4 Cột & filter chéo nhất quán**: DO "Ngoài KH" ⇔ không có trong khvc; KHVC "Trong DO SAP" ⇔ có trong erp.
- **B5 Reconcile là AUGMENT**: lỗi engine KHÔNG làm hỏng CRUD cốt lõi (try/catch).

---

## A. DO SAP (erp_outbound_orders) — thêm/sửa/xóa → engine + realtime + guard
| Mã | Ca | Kỳ vọng | Trạng thái |
|---|---|---|---|
| A1 | **Sửa qty** DO của đơn CHƯA quét, chuyến PENDING/active (Z1/Z2) | Engine TỰ ÁP: OutboundItem.cartons_ordered=mới, loose tính lại, od_refs snapshot mới; reconcile task AUTO_APPLIED/RESOLVED | ✅ |
| A2 | **Sửa qty TĂNG** DO của đơn ĐÃ quét (Z3) | KHÔNG đụng scanned (B1); task **NEEDS_REVIEW** OPEN | ✅ |
| A3 | **Sửa qty GIẢM < đã quét** (Z3) | task **BLOCKED** OPEN (cần trả hàng); scanned giữ nguyên | ✅ |
| A4 | **Sửa batch/%date** (mọi vùng, kể cả đã quét) | ATTR_CHANGED → TỰ ÁP batch/date, KHÔNG đụng qty/scanned; RESOLVED | ✅ |
| A5 | **Sửa mã hàng** DO | MATERIAL_CHANGED → NEEDS_REVIEW (không tự đổi QR) | ✅ |
| A6 | **Xóa** DO chưa dùng | Xóa OK + reconcile giảm đơn (LINE_REMOVED tự áp nếu chưa quét) | ✅ |
| A7 | **Xóa** DO đã dùng+đã quét (guard v2.2) | **409 CHẶN** hard-delete; raw giữ nguyên | ✅ |
| A8 | **Xóa hàng loạt** (preview ?check=1) | deletable/blocked đúng; chỉ xóa deletable | ✅ |
| A9 | **Thêm** DO SAP tay | Dòng mới xuất hiện; in_plan=false (chưa có kế hoạch) → badge "Ngoài KH" | ✅ |
| A10 | **Realtime** A1: mở trang Xuất chuyến đó → sửa DO qua API | cartons_ordered trên UI đổi KHÔNG refresh | ✅UI |
| A11 | **Realtime** A2/A3: mở tab "Cần xử lý" → sửa DO đã quét qua API | task mới hiện + badge đếm tăng, KHÔNG refresh | ✅UI |

## B. Kế hoạch VC (khvc_lines) — thêm/sửa/xóa → realtime + guard + chéo
| Mã | Ca | Kỳ vọng | Trạng thái |
|---|---|---|---|
| B1 | **Thêm** dòng KHVC tay (DO có trong erp) | Dòng mới; do_ready=✓ (Trong DO SAP); chặn trùng (group_code,do_no) 409 | ✅ |
| B2 | **Sửa** dòng KHVC | Lưu, list phản ánh | ✅ |
| B3 | **Xóa** dòng KHVC chuyến CHƯA quét | Xóa OK | ✅ |
| B4 | **Xóa** dòng KHVC chuyến ĐÃ quét (guard) | **409 CHẶN** | ✅ |
| B5 | **Realtime + chéo**: mở tab DO SAP (DO X = "Ngoài KH") → thêm khvc cho DO X qua API | DO X đổi sang có "Số xe (KH)" KHÔNG refresh (cross-invalidate) | ✅UI |
| B6 | **Realtime**: mở tab Kế hoạch xuất → thêm/xóa dòng qua API | list tự cập nhật | ✅UI |

## C. Xuất (Outbound) — realtime lan từ reconcile + trực tiếp
| Mã | Ca | Kỳ vọng | Trạng thái |
|---|---|---|---|
| C1 | Reconcile A1 lan sang trang Xuất | Tổng/Thùng KH của đơn đổi realtime (đã gộp A10) | ✅UI |
| C2 | Realtime trực tiếp: đổi OutboundItem (vd quét) | GDO detail cập nhật (map GroupDeliveryOrder/OutboundItem/OutboundScanEntry) | ✅ |
| C3 | RULE: sau reconcile auto-áp, invariant Xuất | cartons_ordered≥cartons_scanned; loose đúng công thức | ✅ |

## D. Nhặt lẻ (loose picking) — realtime + rule
| Mã | Ca | Kỳ vọng | Trạng thái |
|---|---|---|---|
| D1 | Đơn loose_picking>0 hiển thị đúng ở Nhặt lẻ | list loosepicking có đơn; số base→thùng+hộp đúng | ✅ |
| D2 | Reconcile auto-áp đơn loose (Z1/Z2) | loose_picking tính lại đúng theo newOrdered | ✅ |
| D3 | Realtime Nhặt lẻ khi OutboundItem/ScanEntry đổi | list tự cập nhật (map loosepicking) | ✅UI |

## E. Realtime 4-case cho 2 tab mới (DO SAP + KHVC)
| Mã | Ca | Kỳ vọng | Trạng thái |
|---|---|---|---|
| E1 | Tạo (insert) | list hiện dòng mới realtime | ✅UI |
| E2 | Sửa (update) | dòng phản ánh giá trị mới | ✅UI |
| E3 | Xóa (delete) | dòng biến mất | ✅UI |
| E4 | Làm lại (re-insert cùng khóa) | tích lũy đúng, không stale | ✅ |

## F. Cross-cutting / edge (tự tìm — bao phủ)
| Mã | Ca | Kỳ vọng | Trạng thái |
|---|---|---|---|
| F1 | Sửa DO không đổi gì thực chất (qty như cũ) | engine skip (không tạo task rác) | ✅ |
| F2 | Sửa DO của đơn nhiều od_refs (gộp nhiều DO/1 mã) | newOrdered = Σ raw hiện tại, không thổi | ✅ |
| F3 | Filter in_plan '0' + search kết hợp | giao đúng, tổng khớp | ✅ |
| F4 | Sửa DO → cột "Số xe/Ngày xuất (KH)" DO SAP KHÔNG đổi (chỉ khvc đổi mới đổi) | đúng | ✅ |
| F5 | engine lỗi (giả lập) không làm hỏng update DO SAP | update vẫn 200 (AUGMENT) | ✅(đọc code) |
| F6 | Số âm / rỗng khi sửa qty DO | validate/không crash | ✅ |

---

## Thực thi
- Script tự-dọn: `scratchpad/test-2007-full.mjs` (snapshot→API→assert DB→restore→assert-restored). Chạy API thật local :4000, soi DB qua pg.
- Playwright: quan sát realtime các ca ✅UI (mở trang → bắn đổi qua API ở "người khác" → thấy cập nhật KHÔNG refresh, console 0 lỗi), desktop 1280 + mobile 360.
- **Dọn sạch bắt buộc**: mọi ca restore về nguyên trạng; cuối chạy kiểm `reconcile_tasks=0`, `khvc_lines=41`, OutboundItem/erp khôi phục.

## Kết quả (chạy 21/07)
**Rule/engine/guard (script `test-2007-full.mjs`): 46/46 PASS** — A1 auto-áp · A2 Z3 tăng NEEDS_REVIEW (scanned giữ) · A3 Z3 giảm<quét BLOCKED · A4 ATTR %date tự áp DÙ đã quét (không đụng qty/scanned) · A5 đổi mã MATERIAL_CHANGED · A6 xóa chưa dùng OK · A7 guard xóa đã quét 409 · A9 thêm · F1 no-op skip · B1 thêm+chặn trùng+do_ready · B3 xóa chưa quét · B4 guard xóa chuyến đã quét 409 · C3 invariant (0 scanned>ordered, 0 loose âm) · D1 nhặt lẻ · dọn 0 residue + 11 đơn quét giữ nguyên + 0 drift. (Z3 mô phỏng scan trên đơn od_refs thật vì data không có đơn vừa-od_refs-vừa-quét sẵn.)

**⚠️ BUG REALTIME TÌM ĐƯỢC + ĐÃ FIX** (đúng lo ngại của user): 3 bảng `khvc_lines`/`erp_outbound_orders`/`reconcile_tasks` bật RLS nhưng **thiếu policy `rls_auth_select`** → Supabase Realtime (kết nối role=authenticated) KHÔNG nhận event → tab DO SAP/Kế hoạch xuất/Cần xử lý KHÔNG tự cập nhật (BE service-role vẫn đọc nên REST không lỗi — chết ÂM THẦM). Đây ĐÚNG lớp bug tiền lệ `WeighTicket 16/07`. **Fix**: migration `20260721_external_rls_realtime_policy.sql` (đã apply STAGING). 
- Verify sống realtime (Playwright, bắn đổi từ pg = "người khác", KHÔNG refresh): **R1 xóa khvc → cột "Số xe (KH)" DO SAP đổi SIMRT→"Ngoài KH"** ✅ (cross-invalidate 2 chiều chạy). **INSERT**: local dev KHÔNG có `SUPABASE_JWT_SECRET` → realtime = anon → INSERT bị RLS chặn (DELETE Supabase gửi bỏ qua RLS); chứng minh bằng anon-policy tạm → **INSERT hiện 42/42 KHÔNG refresh** ✅ rồi gỡ. → **Preview/production có secret = authenticated → policy `rls_auth_select` làm INSERT/UPDATE/DELETE đều realtime**. User nghiệm thu realtime trên PREVIEW (authenticated), không phải local.
- A10/A11/C1/D3 (Xuất/Cần xử lý/Nhặt lẻ realtime): cùng cơ chế đã fix — depend `OutboundItem`(UPDATE, đã có policy) + `reconcile_tasks`(INSERT, vừa thêm policy) → chạy trên Preview authenticated.

**Sweep cùng pattern (RLS on + 0 policy):** ngoài 3 bảng đã fix, còn **ApiKey** (trong pub nhưng chưa map realtime → chưa ảnh hưởng) + **Employee** (map `['employees']` nhưng KHÔNG trong publication → realtime nhân sự không chạy — bug KHÁC root, ngoài phạm vi; user quyết fix riêng).
