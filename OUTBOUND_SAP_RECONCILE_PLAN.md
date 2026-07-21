# Kế hoạch đồng bộ SAP ↔ WMS cho XUẤT KHO (reconciliation) — tỉ mỉ, xuyên 3 giai đoạn

> Soạn 20/07/2026. Mở rộng & làm chặt §7 của `SAP_INTEGRATION_PLAN.md` (ma trận OD SỬA/HỦY).
> Vấn đề gốc: **SAP đổi mà đơn WMS đang làm không đổi theo → lệch dữ liệu.** Cần cơ chế chuẩn, an toàn,
> và **thiết kế 1 lần dùng được cho cả 3 giai đoạn** (tay → API SAP → API + plan trên app).

---

## 0. Nguyên tắc kiến trúc: 1 ENGINE, nhiều TRIGGER (bất biến xuyên 3 GĐ)

Điều KHÔNG đổi qua mọi giai đoạn = **bộ máy đối chiếu (reconcile engine)**. Điều đổi = **cách kích hoạt (trigger)**.

```
TRIGGER (đổi theo GĐ)                    ENGINE (BẤT BIẾN)                 WORKING DATA
──────────────────────                  ─────────────────                 ────────────
GĐ1: Up VL06O tay ─────────┐
GĐ2: SAP API (pull/push) ──┼──► reconcileFromSap(rawMới) ──────► chuyến (GDO / DO / OutboundItem)
GĐ3: SAP API ──────────────┘         │  so sánh raw cũ↔mới (delta)
                                     │  áp MA TRẬN theo TRẠNG THÁI dòng
KHVC (cách gom OD → xe):             │  ghi audit erp_od_changes
GĐ1-2: Up KHVC tay ────────┐         │  xung đột → hàng chờ "Cần xử lý"
GĐ3: Plan kéo-thả trên app ┴──► replanOutbound(gánMới) ────────► restructure chuyến (giữ dữ liệu quét)
```

**Vì sao đây là chìa khoá tương lai:** GĐ1 xây engine + audit + hàng chờ xử lý (chạy với upload tay). GĐ2 chỉ **thêm 1 adapter** (connector SAP) đổ vào ĐÚNG engine đó. GĐ3 chỉ **thay trigger KHVC** từ upload sang thao tác app. **Không đập lại lõi.**

---

## 1. Hai TRỤC thay đổi (phải phân biệt rõ)

Mỗi dòng đơn xuất = hàm của **(dòng OD của SAP)** × **(cách điều vận gom OD vào xe)**. Đổi 1 trong 2 trục đều cần reconcile.

| Trục | Nội dung đổi | Nguồn trigger | Engine xử |
|---|---|---|---|
| **SAP OD** (XUẤT CÁI GÌ) | SL, mã hàng, thêm/bớt dòng, batch, %date, ship-to, hủy OD | VL06O tay (GĐ1) → API (GĐ2-3) | `reconcileFromSap` |
| **Điều vận / KHVC** (XUẤT THẾ NÀO) | gán OD↔xe, ngày, loại xe, ĐVVT, ưu tiên, tách/gộp chuyến | KHVC tay (GĐ1-2) → plan app (GĐ3) | `replanOutbound` |

Cả 2 engine dùng CHUNG: thang trạng thái dòng, audit log, hàng chờ xử lý.

---

## 2. Thang trạng thái theo DÒNG (line-level) — tinh chỉnh cốt lõi

> Hiện `processVehicleGroups` gác ở mức **CHUYẾN** (GDO): IN_PROGRESS/COMPLETED → bỏ qua CẢ chuyến.
> Thô: 1 chuyến đang xuất nhưng nhiều dòng chưa ai đụng — dòng đó vẫn nên nhận đổi từ SAP.
> ⇒ Nâng lên gác theo **TỪNG DÒNG (OutboundItem)**. 5 vùng:

| # | Vùng | Điều kiện | Chính sách reconcile |
|---|---|---|---|
| Z0 | **UNPLANNED** (pool) | OD có trong raw, CHƯA gán chuyến nào | Tự do: đổi raw chỉ cập nhật raw + pool; chưa có chuyến để đụng |
| Z1 | **PLANNED-IDLE** | Gán chuyến, chuyến **PENDING**, dòng chưa quét | Tự áp mọi đổi SAP; re-derive sạch |
| Z2 | **ACTIVE-UNTOUCHED** | Chuyến ĐANG chạy (IN_PROGRESS/PAUSED) nhưng **dòng này scanned=0** | Tự áp + badge "Đổi từ SAP"; **xóa dòng → cần duyệt** |
| Z3 | **PARTIAL** | dòng **0 < scanned < ordered** | Tăng: áp + log · Giảm ≥ scanned: áp · Giảm < scanned / xóa: **XUNG ĐỘT** → hàng chờ (hoàn quét phần vượt rồi mới áp) |
| Z4 | **CLOSED** | dòng COMPLETED, hoặc **GI đã confirm về SAP** | Khoá: **RECONCILE_ONLY** (chỉ đối soát; xử bằng trả hàng/điều chỉnh, không sửa đơn) |

---

## 3. Sáu BẤT BIẾN (mọi nhánh engine phải giữ)

1. **Không bao giờ tự xóa dữ liệu đã quét** (Z3/Z4 xóa = phải qua người).
2. **Auto chỉ khi chưa ai đụng** (Z0/Z1/Z2-untouched); đã đụng = người quyết.
3. **Tăng dễ hơn giảm** (tăng SL auto; giảm dưới mức đã quét = chặn).
4. **Raw là ảnh chụp bất biến** — luôn đối chiếu ngược được; convert/reconcile KHÔNG sửa raw.
5. **Idempotent** — cùng 1 snapshot chạy 2 lần = no-op (so sánh nội dung, không đè vô nghĩa).
6. **Mọi thay đổi có audit** (`erp_od_changes`: old→new, vùng, hành động, actor, thời điểm).

---

## 4. MA TRẬN ĐẦY ĐỦ TÌNH HUỐNG (change × vùng)

Ký hiệu hành động: **AUTO** = tự áp + log · **AUTO+badge** = tự áp + gắn cờ "Đổi SAP" + thông báo · **REVIEW** = đẩy hàng chờ "Cần xử lý" · **BLOCK→hoàn** = chặn banner đỏ, phải hoàn quét phần vượt rồi mới áp · **RECON** = chỉ ghi đối soát, không đụng đơn.

| Loại đổi từ SAP | Z0 pool | Z1 idle | Z2 active-untouched | Z3 partial | Z4 closed |
|---|---|---|---|---|---|
| **A. Thêm dòng OD mới** | vào pool | AUTO (thêm dòng) | AUTO+badge | AUTO+badge | (dòng mới → luôn thêm được; gắn chuyến hiện tại nếu OD đã có chuyến) |
| **B. Tăng SL** | AUTO (raw) | AUTO | AUTO+badge | AUTO+log | REVIEW (mở lại?/đơn bù) |
| **C. Giảm SL, ≥ đã quét** | AUTO | AUTO | AUTO+badge | AUTO+log | RECON |
| **D. Giảm SL, < đã quét** | AUTO | AUTO | AUTO+badge | **BLOCK→hoàn** | RECON (đã xuất dư → trả/điều chỉnh) |
| **E. Xóa dòng / Hủy OD** | gỡ khỏi pool | AUTO (xóa dòng); chuyến rỗng → gợi ý hủy | **REVIEW** ("Gỡ OD" điều vận xác nhận) | **BLOCK→hoàn** rồi mới gỡ | RECON |
| **F. Đổi mã hàng** | AUTO | AUTO (xóa dòng cũ + thêm mới) | REVIEW | **BLOCK→hoàn** (mã khác = quét lại) | RECON |
| **G. Đổi ship-to (đổi NPP/chuyến)** | AUTO | AUTO (re-group NPP) | REVIEW (đổi NPP giữa chuyến) | REVIEW | RECON |
| **H. Đổi batch/%date/header (thuộc tính)** | AUTO | AUTO | AUTO (cập nhật yêu cầu hiển thị) | AUTO (chỉ đổi yêu cầu, không đụng số quét) | RECON |
| **I. Đổi ngày giao** | AUTO | AUTO (đổi delivery_date chuyến) | AUTO+badge | AUTO+badge | RECON |

> Ghi chú G (ship-to): đây là ca phức tạp nhất vì đổi NPP có thể chuyển OD sang **chuyến khác**. Z1 tự re-group trong cùng chuyến; nếu đổi sang kho nội bộ (chuyển kho) → re-đánh giá luồng TmsOrder. Từ Z2 trở đi = REVIEW (người điều vận quyết).

**Trục KHVC / điều vận (replan):**
| Thao tác điều vận | Chính sách |
|---|---|
| Gán OD (pool) → xe | tạo/thêm dòng vào chuyến (Z0→Z1) |
| Chuyển OD sang xe khác, chưa quét | di chuyển dòng (giữ yêu cầu) |
| Chuyển OD sang xe khác, ĐÃ quét | REVIEW (không di chuyển ngầm dữ liệu quét) |
| Bỏ OD khỏi xe | OD quay về pool (Z1→Z0); đã quét → BLOCK→hoàn |
| Hủy chuyến còn OD sống | các OD quay về pool; đã quét → theo Z3/Z4 |

---

## 5. Hạ tầng dữ liệu (bổ sung, per-silo)

- **`erp_outbound_orders`** (đã có): thêm dùng `sync_status` ACTIVE/OBSOLETE (migration `20260720_erp_sync_status.sql` đã apply staging) — OD biến mất khỏi SAP → OBSOLETE, KHÔNG xóa raw.
- **`erp_od_changes`** (MỚI): log đối chiếu. Cột: `id, od_number, od_item, change_type(A..I), zone(Z0..Z4), action(AUTO_APPLIED|NEEDS_REVIEW|RECONCILE_ONLY|BLOCKED|RESOLVED), old_value jsonb, new_value jsonb, gdo_id, item_id, actor(SAP-API|<user>), note, resolved_by, resolved_at, created_at, updated_at`. Realtime cho tab "Cần xử lý".
- **Liên kết dòng ↔ OD:** `OutboundItem` cần khoá về OD để reconcile chính xác. Hiện `OutboundDelivery.delivery_code` gộp nhiều OD dạng chuỗi → **KHÔNG đủ để reconcile per-OD-line.** Cần: `OutboundItem.od_number` + `od_item` (hoặc DO 1-1 OD như §7 chốt "OD↔DO 1-1"). ⚠️ Đây là điểm cần quyết (xem §8).
- **`ErpSyncState`** (GĐ2): cursor/delta token per stream (từ `SAP_INTEGRATION_PLAN` §3).
- **Cờ hành vi** trong `SystemSetting` (per-silo, không if-tenant): `sap_reconcile_mode` (`manual` GĐ1 · `auto_open` GĐ2-3) — điều khiển engine tự chạy hay chờ upload.

---

## 6. Hàng chờ "CẦN XỬ LÝ" (exception queue)

Tab trong màn "Đồng bộ SAP" (hoặc trong Xuất kho). Liệt kê `erp_od_changes` status `NEEDS_REVIEW`/`BLOCKED`. Mỗi dòng:
- Hiện: OD, mã, chuyến, vùng, đổi gì (old→new), vì sao cần người.
- Nút hành động (gate quyền mới `outbound.reconcile`):
  - **Áp SAP** (nếu cần hoàn quét phần vượt → xác nhận hoàn, ghi audit).
  - **Giữ WMS + báo SAP** (đánh dấu đã xem, chờ SAP sửa lại).
  - **Gỡ OD / Hủy dòng** (xác nhận).
- Sau xử → status RESOLVED + audit người xử.

---

## 7. Lộ trình 3 GIAI ĐOẠN (engine build 1 lần, thêm adapter)

### GĐ 1 — HIỆN TẠI: VL06O tay + KHVC tay  *(buildable NGAY)*
- Trigger: up lại VL06O → `reconcileFromSap` so sánh raw cũ↔mới → áp ma trận §4 (line-level).
- Build: engine reconcile line-level + `erp_od_changes` + tab "Cần xử lý" cơ bản + pool = DO SAP chưa dùng.
- Nâng `processVehicleGroups` từ GDO-level → line-level gating + phát log.
- **Verify:** up VL06O đổi SL/xóa dòng ở từng vùng Z0–Z4 → đúng AUTO/REVIEW/BLOCK; đơn đã quét không mất số.

### GĐ 2 — GẦN: SAP API + KHVC tay
- Thêm adapter connector SAP (`sapClient` + `ErpSyncState` + Vercel cron) từ `SAP_INTEGRATION_PLAN` §3 → đổ vào **cùng** `reconcileFromSap`.
- Cờ `sap_reconcile_mode=auto_open`: mỗi lần pull tự reconcile Z0/Z1/Z2-untouched, phần còn lại → hàng chờ.
- KHVC vẫn upload tay → `replanOutbound`.
- **Verify:** QAS SAP đổi OD → cron kéo → đơn PENDING tự đổi, đơn đang xuất vào hàng chờ; không lệch tồn.

### GĐ 3 — XA: SAP API + plan trên app
- KHVC thành **bảng kế hoạch kéo-thả**: pool OD (từ Z0) → gán vào xe; thao tác app gọi `replanOutbound` thay upload.
- Cả 2 trục event-driven; engine + audit + hàng chờ **y nguyên**.
- **Verify:** kéo OD vào xe → chuyến sinh; SAP đổi OD đang trên xe → hàng chờ; kéo OD đã quét sang xe khác → chặn/review.

---

## 8. QUYẾT ĐỊNH CẦN CHỐT trước khi code (STOP — hỏi user)

1. **Độ mịn reconcile:** line-level (Z0–Z5, chuẩn tương lai) hay giữ GDO-level (thô, nhanh)? → *đề xuất: line-level.*
2. **Khoá OD trên dòng:** thêm `OutboundItem.od_number+od_item`, hay ép **DO(WMS) 1-1 OD(SAP)** (§7 đã nghiêng hướng này)? Quyết định này đổi cấu trúc `OutboundDelivery`/`delivery_code`.
3. **Phạm vi GĐ1 build ngay:** (A) engine + audit + tab "Cần xử lý" đầy đủ · hay (B) gọn: auto-apply Z0/Z1 + cờ "Đổi SAP", hàng chờ để GĐ2.
4. **Hành vi hiện tại (chưa có engine):** trong lúc chờ build, giữ nguyên "up KHVC lại = re-derive PENDING, bỏ qua đang/đã xuất" (đã chạy) — OK chứ?

> Sau khi bạn chốt 4 điểm này, tôi lên checklist thi công chi tiết (migration + controller + FE + verify từng bước) rồi mới code.

---

## 9. QUYẾT ĐỊNH ĐÃ CHỐT (user 20/07) + tinh chỉnh kỹ thuật

- **(1) Độ mịn = LINE-LEVEL** (Z0–Z4). ✅
- **(2) Khoá OD trên dòng.** ⚠️ **Tinh chỉnh bắt buộc theo dữ liệu:** 30 cặp (ship-to, mã) trải trên **nhiều OD** (tối đa 4). Mô hình phải GIỮ GỘP dòng cùng mã/NPP (nếu tách theo OD → nhặt lẻ bị thổi, tái phát bug pallet-remainder). ⇒ Không dùng cột `od_number`+`od_item` đơn, mà dùng **`OutboundItem.od_refs jsonb`** = `[{od_number, od_item, qty_base}]`. Reconcile tính lại `cartons_ordered` = Σ qty_base raw hiện tại của các od_refs.
- **(3) Phạm vi GĐ1 = TRỌN engine + audit + hàng chờ.** ✅
- **(4) Hành vi tạm hiện tại** (up KHVC lại = re-derive PENDING, bỏ qua đang/đã xuất) giữ tới khi engine thay.

## 10. CHECKLIST THI CÔNG GĐ1 (mỗi bước có tiêu chí verify)

1. **Schema** → migration `20260720_erp_od_changes.sql` (bảng audit+hàng chờ, RLS, publication realtime) + `20260720_outbound_item_od_refs.sql` (`OutboundItem.od_refs jsonb DEFAULT '[]'`) + cập nhật `SCHEMA_REVIEW.md`. **Verify:** cột/bảng tồn tại; publication có `erp_od_changes`.
2. **Derivation ghi od_refs** → `uploadKhvc` thread `od_number/od_item` vào row-shape; `mergeNppRows` gom thành `od_refs`; `collectDOsAndItems`+`mergePausedGDO` ghi cột. **Verify:** up KHVC → od_refs khớp raw; loose vẫn đúng trên tổng gộp.
3. **Engine** → `backend/src/services/outboundReconcile.ts` `reconcileFromSap(odKeys, actor)`: nạp raw+item (qua od_refs) → tính lại ordered/loose → xác định vùng → áp ma trận §4 → ghi `erp_od_changes`. **Verify:** dựng kịch bản từng vùng qua API → đúng AUTO/REVIEW/BLOCK/RECON, không mất số quét.
4. **Trigger VL06O** → `uploadVl06o` sau upsert raw tính (od,item) đổi → gọi engine. **Verify:** up v1→chuyến; sửa 1 dòng; up v2→áp/gắn cờ đúng.
5. **API hàng chờ + quyền** → `GET /outbound/reconcile-queue`, `POST /outbound/reconcile/:id/resolve`; quyền MỚI `outbound.reconcile` đủ 5 nơi. **Verify:** BE 403 khi thiếu quyền; resolve áp + audit.
6. **FE tab "Cần xử lý"** → table-format + realtime (`TABLE_QUERY_MAP['erp_od_changes']`) + nút xử lý gate `can()` + badge "Đổi SAP". **Verify:** Playwright desktop+mobile; realtime 4 case.
7. **DO SAP edit → reconcile** → `updateDoSap`/`deleteDoSap` gọi engine cho OD đó (giải trực tiếp lo ngại "sửa raw không đồng bộ"). **Verify:** sửa DO SAP của OD đã dùng → PENDING đổi, đang xuất → vào hàng chờ.
8. **verify-feature trọn** → compile + Postgres + realtime + Playwright + tải đồng thời + dọn sạch.

**Bump rebuild-token · migration apply STAGING trước · không đụng upload cũ (chạy song song).**

---

# PHẦN II — SPEC CHI TIẾT input/upsert + reconcile (workflow 20/07, 3 ma trận + 23 kẽ hở đã vá)

> Tổng hợp từ workflow đọc code thật + 4 người phản biện adversarial. Dùng tên bảng/cột/hàm THẬT. Đây là spec để code theo.

## 0. Mô hình 3 tầng + 7 bất biến
- **Tầng 1 — DO SAP:** raw `erp_outbound_orders`, key `(od_number, od_item)`.
- **Tầng 2 — KHVC:** hiện transient → nâng thành raw `khvc_lines` + tab riêng.
- **Tầng 3 — Thực xuất:** `GroupDeliveryOrder → OutboundDelivery → OutboundItem → OutboundScanEntry`.

7 bất biến: (1) không tự xóa dữ liệu ĐÃ QUÉT · (2) auto chỉ khi `cartons_scanned=0` mức DÒNG · (3) tăng dễ hơn giảm · (4) raw bất biến (OBSOLETE thay hard-delete) · (5) idempotent · (6) mọi đổi có audit + hàng chờ · (7) 3-2-1: không đổi tầng trên khi tầng dưới `scanned>0`.

## 1. KEY + phát hiện xóa
- Tầng 1 key `(od_number, od_item)` — GIỮ NGUYÊN, đủ cho cả upsert lẫn API delta.
- Tầng 2 key `(group_code, do_no)`.
- Tầng 3 linkage ngược = cột MỚI `OutboundItem.od_refs jsonb` `[{od_number,od_item,qty_base}]`. Bất biến: mỗi `(od,item)` chỉ trong od_refs của DUY NHẤT 1 item (chống double-attach).
- **Phát hiện xóa:** KHÔNG hard-delete từ upload; dòng vắng → `sync_status='OBSOLETE'`. Mặc định cộng-thêm; snapshot-mode opt-in + scope + preview + confirm. API tương lai: SAP trả cờ trạng thái (event tường minh).
- **Vá churn PK:** `uploadVl06o` hiện gán `randomUUID()` cho MỌI record → đổi PK mỗi lần up. Phải pre-fetch map `(od,item)→id`, giữ id cũ, randomUUID chỉ khi INSERT.

## 2. Ma trận UP LẠI VL06O (B3) — nâng "upsert cộng thêm" → "ingest CÓ SO SÁNH" (INSERT/UPDATE+audit/NO-OP/OBSOLETE)

Bước trước ingest: advisory lock theo scope · guard HEADER (thiếu cột KEY/chuẩn → CHẶN, phân biệt cột vắng vs ô rỗng) · nạp prior-state phân trang (chunk 300-500, chống cap-1000) · hash CỘT NGHIỆP VỤ đã chuẩn hóa (KHÔNG hash `raw` jsonb).

| # | Tình huống | Hành động |
|---|---|---|
| U1 | Thêm dòng mới | INSERT (id mới, ACTIVE, audit) |
| U2 | Up trùng y hệt | NO-OP (chỉ refresh last_synced_at, không audit/không bump updated_at) |
| U3 | Sửa — chưa dùng | UPDATE in-place (giữ id/created_at), audit, auto-reconcile |
| U4 | Sửa — đã dùng | UPDATE raw + audit; KHÔNG tự lan tier3 → đẩy 'Cần xử lý' |
| U5 | Blank-wipe | đủ cột → ô rỗng = SAP xóa giá trị; thiếu HEADER → CHẶN |
| U6 | Thiếu dòng — chưa dùng | OBSOLETE (snapshot-mode+scope+confirm), không hard-delete |
| U7 | Thiếu dòng — đã dùng | OBSOLETE + 'Cần xử lý' mức CAO, giữ số quét |
| U8 | Xóa oan (export lọc) | KHÔNG suy vắng=xóa toàn bảng; chỉ trong scope khai báo |
| U9 | Trùng (od,item) trong file | phân biệt split batch (cộng qty) vs trùng thật; đếm + warning |
| U11 | UNIT_MISMATCH | EXCEL: chặn all-or-nothing; SAP live: quarantine từng dòng |
| U13 | source precedence | SAP>EXCEL>MANUAL, audit "ghi đè bản sửa tay" |
| U14 | File CŨ đè MỚI | monotonic guard + preview confirm khi GIẢM/revert |
| U15 | Concurrency | reconcile chỉ chạy sau khi batch commit; khóa user+scope |

**Bật `sync_status`/`last_synced_at` NGAY ở luồng upload (đang chết) — đóng kẽ hở 'up để xóa' + badge 'SAP đã bỏ' đã có sẵn FE.**

## 3. Tầng KHVC-raw (B2/B4a)
- Bảng mới `khvc_lines` (id, group_code, do_no, warehouse_code, npp/veh_type/dvvt/priority/cs/note, export_date, source, sync_status ACTIVE/REMOVED/REMOVED_BLOCKED, materialized_status, gdo_id, upload_batch_id, raw, created_at, updated_at). `UNIQUE(group_code, do_no)`, RLS, upsert chunk 500.
- Tab "KHVC" trong "Dữ liệu bên ngoài" (mirror tab DO SAP); controller `khvcController.ts`; route `/external/khvc/*` gate module MỚI `external_khvc` (đủ 5 nơi).
- `uploadKhvc` → 4 pha: parse+validate → UPSERT khvc_lines → check B4a vs raw (JOIN raw PHẢI select thêm `sync_status`) → derive tier3 CHỈ DO phù hợp, ghi ngược `gdo_id`.
- **B4a = per-trip** (`BLOCKED_MISSING_DO`, chặn derive chuyến thiếu DO, KHÔNG chặn cả file); ship-to/kho lệch = cảnh báo.
- Ma trận K-A1..K-C5 (thêm/trùng/xóa/sửa/1-DO-2-xe/DO chưa sẵn sàng…) — chi tiết trong bản workflow.

## 4. Ma trận ĐỐI CHIẾU (CRUX B4b) — engine `reconcileFromSap`, gác LINE-LEVEL 5 vùng
Thay gác mức-chuyến bằng engine gác từng `OutboundItem`, dùng `cartons_scanned` (BASE) làm bất biến.

**Vùng (key trên ITEM, KHÔNG trên GDO.status):** Z0 pool · Z1 PENDING & scanned=0 & không scan entry/reserved · Z2 chuyến chạy nhưng item scanned=0 · Z3 `0<scanned` chưa thực đóng · Z4 CLOSED (mốc = `scan_completed_at`/GI thật, KHÔNG dùng `OutboundItem.status`).

| Thay đổi | Z0 | Z1 | Z2 | Z3 | Z4 |
|---|---|---|---|---|---|
| Thêm OD | AUTO(pool) | AUTO | AUTO+badge | AUTO | RECON |
| Tăng SL | AUTO | AUTO | AUTO+badge | AUTO | REVIEW |
| Giảm ≥ scanned | AUTO | AUTO | AUTO+badge | AUTO | RECON |
| **Giảm < scanned** | AUTO | AUTO | AUTO | **BLOCK→hoàn** | RECON |
| **Xóa/Hủy OD** | AUTO | AUTO(guard §3.5) | REVIEW | **BLOCK→hoàn** | RECON |
| Đổi mã | AUTO | AUTO | REVIEW | **BLOCK→hoàn** | RECON |
| Đổi ship-to | AUTO | AUTO(re-group) | REVIEW | REVIEW | RECON |
| Đổi batch/%date/header | AUTO | AUTO | AUTO+badge | AUTO | RECON |
| Đổi ngày giao | AUTO | AUTO | AUTO+badge | AUTO+badge | RECON |

## 5. ⚠️ LỖI MẤT DỮ LIỆU CÓ THẬT trong code HIỆN TẠI (workflow phát hiện — nên vá sớm, độc lập tính năng SAP)
1. **Cascade xóa scan + leak reserved:** mọi delete/remove/cancel gác trên `GDO.status==PENDING`, nhưng **nhặt lẻ pre-start tăng `cartons_scanned` + reserve tồn mà KHÔNG đẩy GDO khỏi PENDING** → `OutboundScanEntry ON DELETE CASCADE` xóa sạch scan + reserved leak vĩnh viễn. VÁ: gác trên "có OutboundScanEntry không", giải phóng tồn per-entry trước khi xóa.
2. **`mergePausedGDO` max-scanned dedup** drop dòng khi >1 item cùng (NPP,material) → mất `cartons_scanned`. VÁ: re-point + merge scanned, không discard.
3. **`mergeNppRows` va chạm thuộc tính:** first-non-empty cho batch/%date/header → mất yêu cầu NGHIÊM hơn → giao sai. VÁ: không gộp khác batch/%date, enforce mức nghiêm nhất.
4. **id churn PK** mỗi lần up VL06O (§1).

## 6. Quyết định user cần chốt (rút gọn — có khuyến nghị)
- **Xóa = OBSOLETE, không hard-delete** (Q2/Q3).
- **Bảng tier2 = `khvc_lines`, key (group_code,do_no), quyền `external_khvc`** (Q4-6).
- **B4a per-trip** (Q7). **Hàng chờ dùng bảng chung `reconcile_tasks`** (Q9).
- **D/Z3 "Áp SAP" TỰ hoàn tồn per-entry + idempotent** (Q11).
- **Z4 mốc = scan_completed_at/GI** (Q12). **AUTO Z0/Z1/Z2-untouched, hàng chờ chỉ Z3-xung-đột/Z4** (Q13).
- **Bật trigger reconcile SAU khi backfill `od_refs`** (Q16/Q18).

---

# PHẦN III — CHỐT v2 (refinement user 20/07) — ĐÈ LÊN các mục xung đột ở PHẦN I/II

> Các quyết định dưới là MỚI NHẤT, đè lên PHẦN I/II ở chỗ mâu thuẫn (nhất là: BỎ snapshot-deletion + auto-OBSOLETE cho luồng tay).

## v2.1 — "Tự động vợt = mất dấu": áp cho MỌI hàng đã quét/đã lên xe (không riêng nhặt lẻ)
- Bất kỳ dòng `cartons_scanned>0` (xuất thường HAY nhặt lẻ) → **KHÔNG auto-apply**; vào "Cần xử lý"; user xử tay + **xác nhận TRẢ HÀNG VẬT LÝ** (bê khỏi xe / trả về pallet) TRƯỚC khi hệ thống áp (đường trả chỗ đặt per-tem như `deleteScanEntry`).
- Chuyến đã **Bắt đầu** (có biển số, đang lên xe): auto chỉ được **thêm dòng mới chưa quét**; thay đổi lên dòng đã có → cờ + báo, không tự vợt.
- Auto-apply CHỈ còn: Z0 pool + Z1 (chưa bắt đầu & chưa quét) + thêm dòng mới chưa quét ở Z2. ⇒ ma trận §4: mọi ô "AUTO" cho dòng có `scanned>0` chuyển thành thao tác TAY.

## v2.2 — Xóa "rác" ở preview: luật dòng nào xóa được
| Dòng raw | Xóa cứng? |
|---|---|
| Chưa dùng (không od_refs nào trỏ tới) + không tem quét | ✅ xóa được (rác: test, SL=0, mã phi hàng hóa, nhập nhầm) |
| Đã sinh chuyến nhưng chuyến chưa quét gì | ⚠️ xóa được + gỡ chuyến rỗng (cảnh báo + confirm) |
| Đã dùng + đã quét/đã xuất | ❌ KHÔNG xóa cứng (cần post ngược SAP + đối chiếu); chỉ đánh dấu "bỏ" |

Luồng preview: chọn dòng → kiểm từng dòng → hiện "N xóa được, M không (đã xuất — vd DO X)" → xóa phần xóa được, giữ phần kia + lý do.

## v2.3 — BỎ auto-OBSOLETE ở mức CẢ-DO. SAP post-back = chốt chặn DO ma. NHƯNG phát hiện xóa TIN CẬY ở mức DÒNG-trong-DO
**Luật nền (user chốt): VL06O LUÔN xuất TRỌN các dòng của mỗi Delivery.** ⇒ 2 mức "biến mất" khác nhau:
- **Cả một DO vắng khỏi file** (không dòng nào) → MƠ HỒ (có thể up thiếu/lọc) → **ĐỂ NGUYÊN**, không OBSOLETE, không xóa. SAP post-back gác cuối (DO xóa khỏi SAP → post ngược bị từ chối).
- **DO CÓ trong file nhưng THIẾU 1 dòng** (vd DO có 10,20 → file mới 20,30: thiếu 10) → TIN CẬY (SAP đã bỏ dòng 10, vì file trọn dòng DO). Xử: dòng thiếu **chưa dùng** → `sync_status=OBSOLETE` (derive BỎ QUA dòng OBSOLETE, không kéo hàng ma vào chuyến); dòng thiếu **đã dùng/đã quét** → KHÔNG tự bỏ → 'Cần xử lý' + post-back. Dòng 20 đổi SL → UPDATE (đã quét → cờ/tay v2.1); dòng 30 mới → INSERT.
- AN TOÀN kể cả export lọc dở: dòng chưa-dùng bị bỏ nhầm → up đầy đủ sau tự INSERT lại (vô hại); dòng đã-dùng KHÔNG bao giờ tự bỏ.
- `sync_status=OBSOLETE` DÙNG NGAY ở mức dòng-trong-DO (tin cậy); auto-detect mức cả-DO = để dành GĐ2 API.
- **Up VL06O tay = cộng-thêm/sửa + OBSOLETE dòng-thiếu-trong-DO-có-mặt** (INSERT mới / UPDATE đổi / NO-OP trùng / OBSOLETE dòng vắng của DO có mặt & chưa dùng).
- **Xóa dòng cũ/rác = TAY ở tab preview** theo v2.2.
- **DO bị SAP xóa mà WMS lỡ xuất → post ngược lên SAP bị TỪ CHỐI** (SAP không post vào DO không tồn tại) → CS thấy, xử. Đây là chốt chặn tự nhiên hiện có — WMS KHÔNG cần tự dò xóa.
- `sync_status`/OBSOLETE + auto-detection = **ĐỂ DÀNH cho GĐ2** (SAP API gửi sự kiện xóa). Chưa build bây giờ.
- (Tùy chọn tương lai) lưới lúc Hoàn thành: chặn DO OBSOLETE — chỉ có nghĩa khi đã nối API.

## v2.4 — Tab tên "Kế hoạch xuất" (không "KHVC"); dùng TẠM DỪNG làm cơ chế reconcile an toàn
- Tab tầng 2 tên **"Kế hoạch xuất"**.
- Chuyến đã có hàng quét mà SAP/kế hoạch đổi → **Tạm dừng (PAUSED) → merge (giữ số, chặn hạ dưới mức đã xuất) → Tiếp tục**; KHÔNG đi đường xóa-tạo-lại. `mergePausedGDO` đã làm 80% (vá bug §5.2/§5.3).

## v2.5 — Tình huống trạng thái (đã soi code)
- **Gỡ bắt đầu** (`unstartGDO`, IN_PROGRESS→PENDING): code chặn nếu còn QR đã quét. Sau gỡ = Z1 → auto. OK.
- **Bỏ hoàn thành** (`uncompleteGDO`, COMPLETED→IN_PROGRESS): gác transfer DELIVERED/RECEIVING; xóa `scan_completed_at`. ⇒ Z4 PHẢI tính theo `scan_completed_at`/GI, không theo status (nếu không sẽ kẹt sau bỏ-hoàn-thành).
- **Offline** (`scanQueue.ts`): quét offline replay qua endpoint online, server trọng tài, idempotent (DUP_RE). Reconcile chạy server KHÔNG thấy scan offline chưa sync → **cấm hard-delete** (để replay còn tìm thấy dòng + server trả lý do rõ "SAP đã bỏ/giảm — trả hàng"); dòng đỏ → "Cần xử lý" + trả hàng vật lý (v2.1). Giới hạn bản chất, chỉ giảm thiểu bằng thông báo rõ + không mất dữ liệu.

## v2.7 — THỨ TỰ upload + CẢNH BÁO tại nút (chống làm ngược + đè nhầm)
**Thứ tự bắt buộc: ① Up VL06O (làm mới DO) → ② Up Kế hoạch xuất → ③ Kho xuất.** Kế hoạch phụ thuộc DO (B4a), làm ngược = xếp theo DO cũ.
- **Nút Up Kế hoạch xuất:** đọc ngày trong file (Ngày xuất / `ddmmyy` trong group_code) → nếu ngày đó ĐÃ có chuyến → cảnh báo kèm số chuyến + trạng thái ("8 chuyến, 2 đang xuất, 1 xong") + hỏi "đã Up VL06O mới nhất chưa?" + nút [tiếp tục]/[up VL06O trước]. Chuyến đang/đã xuất được bảo vệ (v2.1).
- **Nút Up VL06O:** nếu file chứa DO đã lên chuyến → cảnh báo "N DO đã lên chuyến (M đang xuất); dòng đã quét → Cần xử lý, không tự đè".
- **Panel gộp:** đánh số ① VL06O → ② Kế hoạch xuất; ghi mốc "VL06O cập nhật lần cuối hh:mm"; bấm ② mà ① chưa làm mới hôm nay cho ngày đó → NHẮC (không chặn cứng).

## v2.6 — CHECKLIST THỰC THI (sẵn sàng code)
**Đợt 0 — Vá 3 lỗi mất dữ liệu HIỆN CÓ (độc lập SAP, ưu tiên):**
1. `deleteGDO` + re-derive PENDING (`toReplaceIds`) → chặn khi có scan entry; trả chỗ đặt per-tem trước khi xóa. Verify sống: chuyến có nhặt lẻ pre-start → xóa → reserved trả đúng, tồn khớp.
2. `mergePausedGDO` gộp scanned thay vì drop khi 1 NPP 2 dòng cùng mã.
3. `mergeNppRows` không gộp khác batch/%date → giữ mức nghiêm nhất.

**Đợt 1 — Tầng raw + tab Kế hoạch xuất:**
4. Migration bảng kế hoạch xuất (raw) + index; `OutboundItem.od_refs jsonb`; `OutboundDelivery.delivery_code` DROP NOT NULL. Vá churn PK ở `uploadVl06o`.
5. `uploadVl06o` → nạp CÓ SO SÁNH (INSERT/UPDATE/NO-OP; **KHÔNG auto-OBSOLETE**; giữ id; guard header; advisory lock).
6. Tab "Kế hoạch xuất" + `uploadKhvc` lưu raw + B4a per-trip (JOIN raw select thêm sync_status) + xóa-preview theo v2.2. Quyền module mới.

**Đợt 2 — Engine đối chiếu + hàng chờ (SAU backfill `od_refs`):**
7. `reconcileFromSap` line-level; hàng đã quét → Tạm dừng+merge / trả-hàng-vật-lý (v2.1); Z4 theo scan_completed_at; cấm hard-delete (offline-safe).
8. Bảng + tab "Cần xử lý" (realtime) + quyền `outbound.reconcile`; verify PC+mobile + realtime + tải đồng thời + 0 mất dữ liệu.

**Bump rebuild-token · migration STAGING trước · không đụng upload cũ.**

---

# ✅ ĐỢT 1 XONG (dev, 21/07/2026) — verify sống staging 12/12 PASS

**Đã làm (mục 4-5-6 của v2.6):**
1. **3 migration** (ĐÃ apply STAGING qua pg, verify cột/bảng/publication): `20260721_khvc_lines.sql` (tầng 2 raw + 4 index + RLS + realtime) · `20260721_outbound_item_od_refs.sql` (`OutboundItem.od_refs jsonb NOT NULL DEFAULT '[]'`) · `20260721_outbound_delivery_code_nullable.sql` (DROP NOT NULL).
2. **`uploadVl06o` nạp CÓ SO SÁNH** (thay upsert mù): pre-fetch `(od,item)→id` → phân loại INSERT (id mới) / UPDATE (GIỮ id cũ + created_at, chỉ khi hash cột nghiệp vụ đổi) / NO-OP (hash trùng → không ghi, không bump updated_at). **Vá churn PK** + idempotent. Guard HEADER (thiếu cột Delivery/Item → 400). **KHÔNG auto-OBSOLETE** (v2.3 — up tay chỉ cộng-thêm/sửa). Trả `inserted/updated/noop`.
3. **od_refs derivation**: `uploadKhvc` reshape gắn `__od_refs:[{od_number,od_item,qty_base}]` mỗi dòng raw → `mergeNppRows` concat (clone tránh share-ref) → ghi cột `od_refs` ở CẢ `collectDOsAndItems` (insert) + `mergePausedGDO` (insert/update, recompute khi up lại). File gộp trực tiếp (uploadExcel) → `[]`.
4. **Tầng raw "Kế hoạch xuất"**: `uploadKhvc` upsert song song vào `khvc_lines` (churn-safe id theo (group_code,do_no), giữ raw). Controller `khvcController.ts` (list phân trang + facets + CRUD + bulk-delete, enrich `materialized`/`gdo_status`/`do_ready`) + routes `/external/khvc/*` gate `external_khvc` + quyền 2 config (FE+BE). FE: tab "Kế hoạch xuất" (shell 2 tab theo quyền), hooks `useKhvc*`, filter slice `khvc`, route+nav gate `[external_do_sap, external_khvc]`.

**Verify E2E sống (API thật staging, dọn sạch 0 sót):** A1 INSERT(2) · A2 NO-OP(2)+id giữ+không bump updated_at · A3 UPDATE(1) id+created_at giữ qty=250 · A4 header guard 400 · B od_refs mọi item đủ field + Σqty_base=cartons_ordered · B khvc_lines persist ACTIVE + re-upload id giữ · B list API materialized/do_ready. tsc BE+FE + FE build pass.

**Chưa làm (để dành):** advisory lock upload (GĐ2 API cần hơn — upload tay ngày ít tranh chấp; honest note) · xóa-preview v2.2 (guard "đã dùng/đã quét không xóa cứng" — deleteDoSap/deleteKhvc hiện xóa thẳng như cũ, để Đợt 2 cùng engine). **ĐỢT 2** (engine `reconcileFromSap` + hàng chờ "Cần xử lý" + quyền `outbound.reconcile`) = bước sau, CHỜ user nghiệm thu Đợt 1 trên Preview.
