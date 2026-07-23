# KẾ HOẠCH TEST — Đồng bộ SAP↔WMS (Đợt 0/1/2 + v2.7 + v2.2)

> Mục tiêu: **không sót khu vực / tình huống nào.** Ma trận dưới đây liệt kê MỌI đường đi.
> Ký hiệu trạng thái: **✅ auto** = đã verify bằng script API sống trên STAGING (đợt này) · **✅ UI** = đã verify Playwright · **☐ Preview** = bạn cần bấm tay nghiệm thu trên Preview trước khi merge main.
> Nguồn dữ liệu test: mã `510000306` (entry CAR, upc=48, cpp=108 → 1 pallet=5184 base). Mọi bản ghi test gắn tiền tố `SIM…`/`ZZ…` để DỌN SẠCH.

---

## 0. BẤT BIẾN TỐI CAO (mỗi test phải giữ — sai 1 cái là hỏng)
1. **KHÔNG bao giờ tự sửa/xóa dòng ĐÃ QUÉT** (cartons_scanned>0). ✅ auto (Đợt 2 F, v2.2 C2/D2)
2. **Không mất dữ liệu quét** — mọi giảm < đã quét bị BLOCK. ✅ auto (Đợt 2 F, resolve 422)
3. **Raw bất biến** — up lại giữ id (không churn), dòng vắng = OBSOLETE không hard-delete. ✅ auto (Đợt 1 A2/A3, I)
4. **Reconcile là AUGMENT** — lỗi engine KHÔNG làm hỏng upload/CRUD cốt lõi (try/catch). ✅ code review + auto
5. **Thứ tự nghiệp vụ 3-2-1**: đổi tầng trên (DO/KHVC) khi tầng dưới đã quét → phải qua người. ✅ auto

---

## 1. KHU VỰC: Upload VL06O (nạp raw có so sánh) — `uploadVl06o`
| # | Tình huống | Kỳ vọng | TT |
|---|---|---|---|
| 1.1 | File mới hoàn toàn | INSERT hết, `inserted=N` | ✅ auto |
| 1.2 | Up lại y hệt | NO-OP hết (`noop=N`), id + updated_at KHÔNG đổi | ✅ auto |
| 1.3 | Sửa 1 dòng (đổi qty/thuộc tính) | UPDATE dòng đó (`updated=1`), GIỮ id + created_at | ✅ auto |
| 1.4 | Thiếu cột Delivery/Item | Chặn 400 "thiếu cột bắt buộc" | ✅ auto |
| 1.5 | Đơn vị lệch Material master | Chặn 400 UNIT_MISMATCH + bảng lỗi | ☐ Preview (logic cũ, giữ nguyên) |
| 1.6 | Dòng thiếu Delivery/Item (ô rỗng) | Bỏ dòng đó (`skipped_no_key`), không chặn | ☐ Preview |
| 1.7 | DO có mặt, THIẾU 1 dòng của DO đó | Dòng thiếu → `sync_status=OBSOLETE` (không hard-delete) + reconcile | ✅ auto (Đợt 2 I) |
| 1.8 | Cả 1 DO vắng khỏi file | ĐỂ NGUYÊN (mơ hồ, post-back gác) — KHÔNG obsolete | ☐ Preview |
| 1.9 | File chứa DO đã lên chuyến (preflight) | Cảnh báo trước: dos_on_trips + scanned_items; KHÔNG ghi | ✅ auto (v2.7 A) |
| 1.10 | File > 4.5MB | 413 (Vercel) — text thô [[upload-excel-payload-limit]] | ☐ Preview production |

## 2. KHU VỰC: Upload Kế hoạch xuất / KHVC (sinh chuyến + persist raw) — `uploadKhvc`
| # | Tình huống | Kỳ vọng | TT |
|---|---|---|---|
| 2.1 | KHVC 1 xe 1 DO | Tạo chuyến + item; khvc_lines persist ACTIVE | ✅ auto (Đợt 1 B) |
| 2.2 | 1 xe NHIỀU DO cùng NPP+mã | GỘP 1 item, od_refs nhiều phần tử, loose tính trên TỔNG (không thổi) | ✅ auto (Đợt 1 C) |
| 2.3 | Up lại KHVC (chuyến PENDING) | Xóa+tạo lại, nhả reserved nhặt lẻ (Đợt 0) | ✅ auto (Đợt 0) |
| 2.4 | Up lại (chuyến PAUSED) | mergePausedGDO giữ số quét, chặn hạ < đã xuất | ☐ Preview (legacy hiếm) |
| 2.5 | Up lại (chuyến ĐANG XUẤT/HT) | Bỏ qua chuyến đó, up phần còn lại | ☐ Preview |
| 2.6 | KHVC trỏ DO chưa có trong VL06O | DO chưa sẵn sàng → không sinh item cho DO đó | ✅ auto (list do_ready=false) |
| 2.7 | KHVC re-upload → khvc_lines | id GIỮ NGUYÊN (churn-safe) | ✅ auto (Đợt 1 B) |
| 2.8 | Preflight: ngày đã có chuyến / DO thiếu | Cảnh báo trips.total + missing_dos + vl06o_last_synced; KHÔNG ghi | ✅ auto (v2.7 B/B2) |
| 2.9 | Mã phi hàng hóa trong KHVC | LOẠI khỏi chuyến (giữ ở raw) | ☐ Preview [[material-non-stock]] |

## 3. KHU VỰC: Tab "DO SAP" (CRUD raw) — ExternalData
| # | Tình huống | Kỳ vọng | TT |
|---|---|---|---|
| 3.1 | Chọn Ngày nạp → list | Hiển thị + cột Tình trạng/Lệch ĐV | ☐ Preview |
| 3.2 | Thêm dòng tay | 201, source MANUAL | ☐ Preview |
| 3.3 | Sửa đổi khóa trùng | 409 | ☐ Preview |
| 3.4 | Sửa dòng → reconcile | Item liên quan tự đối chiếu (Đợt 2 trigger) | ✅ auto (Đợt 2 E qua updateDoSap) |
| 3.5 | Xóa dòng CHƯA dùng | Xóa được 200 | ✅ auto (v2.2 C1) |
| 3.6 | Xóa dòng đã dùng + ĐÃ QUÉT | CHẶN 409, raw còn nguyên | ✅ auto (v2.2 C2) |
| 3.7 | Xóa dòng đã dùng CHƯA quét | Xóa được + reconcile giảm đơn | ✅ auto (v2.2 C3) |
| 3.8 | Bulk delete có dòng bị chặn | Preview "N xóa được, M không"; xóa phần được | ✅ auto (check) · ☐ Preview (UI dialog) |
| 3.9 | Filter/search/phân trang | Đúng, giữ theo user | ☐ Preview |

## 4. KHU VỰC: Tab "Kế hoạch xuất" (CRUD khvc_lines) — ExternalData
| # | Tình huống | Kỳ vọng | TT |
|---|---|---|---|
| 4.1 | Chọn Ngày nạp → list | Hiển thị + cột DO sẵn sàng / Chuyến (materialized) | ✅ UI (Đợt 1) |
| 4.2 | Thêm/Sửa/Xóa tay | CRUD OK, warehouse_code auto-tách, dup 409 | ✅ auto (Đợt 1 D) + ✅ UI |
| 4.3 | Xóa dòng KHÔNG có chuyến | Xóa được 200 | ✅ auto (v2.2 D1) |
| 4.4 | Xóa dòng chuyến ĐÃ QUÉT | CHẶN 409 | ✅ auto (v2.2 D2) |
| 4.5 | Bulk delete preview | "N xóa được, M không (chuyến đã quét)" | ✅ auto (check) · ☐ Preview (UI) |

## 5. KHU VỰC: Engine đối chiếu — `reconcileFromSap` (5 vùng × loại đổi)
> Mốc vùng = `cartons_scanned` + `GDO.scan_completed_at` (KHÔNG dùng item.status).

| Vùng \ Đổi | Tăng SL | Giảm ≥ đã quét | Giảm < đã quét | Xóa dòng | Đổi mã | Batch/%Date |
|---|---|---|---|---|---|---|
| **Z1** PENDING, chưa quét | AUTO ✅ | AUTO | AUTO | AUTO (I) ✅ | AUTO(re-derive) | AUTO |
| **Z2** đang xuất, item chưa quét | AUTO | AUTO | AUTO | AUTO | REVIEW | AUTO |
| **Z3** đã quét | REVIEW ✅ | REVIEW | **BLOCKED** ✅ | **BLOCKED** | REVIEW | AUTO |
| **Z4** đã đóng (scan_completed_at) | RECON ✅ | RECON | RECON | RECON | RECON | RECON |

- ✅ auto đã chạy: Z1 tăng (E), Z3 tăng→REVIEW + Z3 giảm<quét→BLOCKED (F), Z4→RECON (G), Z1 line-removed (I).
- ☐ Preview còn nên soi tay: Z2 (chuyến đã Bắt đầu nhưng dòng chưa quét — thêm dòng auto, đổi dòng đã có → cờ), đổi mã→REVIEW, đổi batch/%date→AUTO mọi vùng.
- **Nguồn kích hoạt** (đều đã có trigger): up VL06O lại ✅, sửa DO SAP ✅, xóa DO SAP ✅, bulk-delete DO SAP ✅.

## 6. KHU VỰC: Tab "Cần xử lý" (resolve) — quyền `outbound.reconcile`
| # | Tình huống | Kỳ vọng | TT |
|---|---|---|---|
| 6.1 | List status=OPEN | Hiện task đủ cột + tên hàng enrich | ✅ UI (Đợt 2) |
| 6.2 | Resolve "Áp SAP" (new ≥ đã quét) | Item.cartons_ordered = new, task RESOLVED/apply | ✅ auto + ✅ UI |
| 6.3 | Resolve "Áp SAP" (new < đã quét) | **422** (cấm — phải trả hàng tay) | ✅ auto (F) |
| 6.4 | Resolve "Giữ WMS" | WMS không đổi, task RESOLVED/keep | ☐ Preview |
| 6.5 | Resolve "Đã xử lý tay" (BLOCKED/đổi mã) | task RESOLVED/manual_done | ✅ auto (F) |
| 6.6 | Realtime: engine tạo task | Tab tự cập nhật (không refresh) | ✅ UI (hàng chờ về 0 sau resolve) |
| 6.7 | Resolve task đã RESOLVED | 409 | ☐ Preview |

## 7. KHU VỰC: v2.7 Cảnh báo thứ tự upload
| # | Tình huống | Kỳ vọng | TT |
|---|---|---|---|
| 7.1 | Up KHVC ngày đã có chuyến | Banner amber: N chuyến (đang xuất/xong/tạm dừng) + [Tiếp tục]/[Huỷ] | ✅ auto (data) · ☐ Preview (banner) |
| 7.2 | Up KHVC, DO chưa có trong VL06O | Banner đỏ "N DO chưa có → up VL06O trước" | ✅ auto · ☐ Preview |
| 7.3 | Mốc "VL06O cập nhật lần cuối" | Hiện timestamp / "chưa có DO nào" | ✅ auto · ☐ Preview |
| 7.4 | Up VL06O file có DO đã lên chuyến | Banner: N DO đã lên chuyến, M dòng đã quét → Cần xử lý | ✅ auto · ☐ Preview |
| 7.5 | Ngày sạch (không chuyến) | KHÔNG banner, up thẳng | ✅ auto (A2 dos_on_trips=0) |
| 7.6 | Preflight lỗi | Fallback up thẳng (không chặn user) | ✅ code |

## 8. KHU VỰC: v2.2 Guard xóa preview (đã gộp mục 3.5-3.8, 4.3-4.5)
Bản chất = 2 luật: (a) referenced+scanned → BLOCK; (b) preview trước khi bulk. ✅ auto đủ; ☐ Preview: eyeball dialog "N xóa được, M không".

## 9. CROSS-MODULE (không sót điểm nối)
| Điểm nối | Kiểm | TT |
|---|---|---|
| Reconcile "Áp SAP" → đổi OutboundItem | Trang Xuất kho thấy SL mới (realtime `['gdos']`) | ☐ Preview |
| od_refs → nhặt lẻ (loose_picking) | Áp SAP recompute loose theo pallet | ✅ auto (E loose) |
| Xóa DO SAP referenced-unscanned → reconcile | Item giảm; nếu =0 đơn về 0 | ✅ auto (C3) |
| Chuyển kho / TmsOrder | KHÔNG bị đụng bởi reconcile (chỉ đọc GDO) | ☐ Preview |

## 10. CROSS-CUTTING (bắt buộc trước go-live)
| Hạng mục | Kiểm | TT |
|---|---|---|
| **Phân quyền** | User KHÔNG có `outbound.reconcile` → không thấy tab "Cần xử lý" + BE 403; `external_khvc` gate tab Kế hoạch xuất | ☐ Preview (3 lớp [[perm-test-standard-e2e]]) |
| **Realtime 4 case** | tạo/sửa/xóa/làm lại task + đơn → cập nhật ngay | ✅ UI (1 phần) · ☐ Preview đủ 4 |
| **Responsive** | tab Cần xử lý + upload dialog: PC 1280 / mobile 390 / 360 không tràn | ✅ UI (390) · ☐ Preview 360 + upload dialog |
| **Đồng thời** | nhiều user up VL06O/KHVC + reconcile cùng lúc → không treo, không lệch (Cổng 5 verify-feature) | ☐ Preview (tải nhẹ ~25 in-flight) |
| **Quy mô** | VL06O vài nghìn dòng: ingest so sánh + reconcile không quá 60s | ☐ Preview (file thật) |
| **Timezone** | Ngày nạp (created_at) filter đúng giờ VN | ☐ Preview |

## 11. DỌN SẠCH + GO-LIVE
- [ ] Sau mỗi test tay: xóa bản ghi `SIM…`/`ZZ…` đã tạo (script `dot2-final-clean.mjs` mẫu).
- [ ] **Chạy QA regression** `node scripts/qa/run-all.mjs` XANH trước merge main [[qa-regression-suite]].
- [ ] Merge dev→main: apply **4 migration `20260721`** production theo thứ tự: `khvc_lines` → `outbound_item_od_refs` → `outbound_delivery_code_nullable` → `reconcile_tasks` (đều additive, an toàn) + verify publication realtime khvc_lines/reconcile_tasks.
- [ ] Bump rebuild-token đã làm (.347).
- [ ] ⚠ Nhắc: dev còn NHIỀU migration khác chưa lên production (base-unit flip, slotting ×4, warehouse-parent, QTY_DATE, load-plan ×3, control-tower…) — merge = sự kiện lớn, apply TẤT CẢ theo đúng thứ tự từng file.

---

## TÓM TẮT ĐÃ AUTO-VERIFY ĐỢT NÀY (58 checks sống, staging, dọn sạch 0 sót)
- **Đợt 0** (3 lỗi mất dữ liệu): 3 ✅
- **Đợt 1** (raw + od_refs + ingest so sánh): 12 + 11 (gộp nhiều DO) ✅
- **Đợt 2** (engine + hàng chờ): 12 API + UI Playwright ✅
- **v2.7 + v2.2**: 11 ✅
- Còn lại = **☐ Preview** (UI eyeball + phân quyền 3 lớp + đồng thời + quy mô file thật + responsive 360) — bạn nghiệm thu trước khi merge main.
