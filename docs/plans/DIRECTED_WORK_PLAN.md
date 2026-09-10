# Directed Work trên nền Sơ đồ kho — kế hoạch thực thi đợt 1 (chốt 09/09/2026)

Kho thí điểm: **Kho Ba Vì** (QR theo pallet). Bản vẽ đã đủ: 74/74 chân kệ · 2 cửa nhập · 5 cửa xuất · 4 điểm đặt dãy.
Nền tảng đã có: memory `directed-work-task-engine`, module `warehouse_map`, `utils/warehouseGrid.ts` (BFS), `rotation.ts`, `move_pallets_to_location`.

## Giả định đang áp (user chưa phản đối thì giữ)
1. Điểm đặt dãy (DROP) mặc định **không giới hạn** sức chứa (null); kho muốn khống chế thì khai số.
2. Cặp kho nội bộ (Ba Vì → Chế biến) **miễn chọn cửa**, không chiếm suất. Điểm "Giao Chế biến" là tuỳ chọn trên bản vẽ; chưa vẽ → kế hoạch chỉ đường tới điểm đặt dãy gần nhất.
3. Hai đường **Xuất luôn không bắt cửa** (chuyến xong trong cùng request).
4. Thứ tự ưu tiên sắp việc: **FEFO/luật luân chuyển → giờ xe (booking) → đường đi từ cửa → tầng cao trước**.
5. Kho **có ≥1 cửa xuất trên bản vẽ** ⇒ Bắt đầu bắt buộc chọn cửa; kho chưa vẽ giữ hành vi cũ. Không thêm cờ riêng.

---

> **Tiến độ 09/09 (tối):** Đợt 1a ✅ (dev `a2c1956c` → `b9a419db`, QA 56 = 40/40, migration 20260910 + 20260910b áp staging) · Đợt 1b ✅ (dev `e1d4919e`) · Đợt 1c ⏳ chưa bắt đầu — lập plan chi tiết trước khi code.
> Đổi so với plan: (i) cột Cửa ở Chuẩn bị hàng / Giám sát vận hành CHƯA làm (thẻ chuyến + ô cửa trên bản vẽ đã có); (ii) ratchet lấy tên `gdo_in_progress_written_directly` (baseline 8, đếm rộng cả dòng hàng); (iii) phát hiện + vá bug đua ngay trong đợt (RPC khoá đúng mà đếm sai tập).

## Đợt 1a — Cửa xuất có sức chứa xe (≈ 1 ngày)

| # | Bước | Kiểm tra |
|---|---|---|
| 1 | Migration `20260910_dock_capacity.sql`: `Location.dock_capacity int` (null = không giới hạn, DROP/DOCK; CHECK 1..50), `GroupDeliveryOrder.dock_location_id text` + `dock_assigned_at timestamptz`; index `(dock_location_id) WHERE status='IN_PROGRESS'`. RPC `gdo_assign_dock(p_gdo, p_dock, p_actor)` khoá dòng cửa, đếm **XE** (distinct biển đang IN_PROGRESS tại cửa, chuyến không biển = 1), cùng biển đang ở cửa → gắn không tốn suất, đầy → RAISE `DOCK_FULL` kèm danh sách cửa còn trống. Áp staging qua `apply_mig_map.mjs`. | `SELECT` sau apply thấy đủ cột; gọi RPC 2 lần cùng cửa capacity 1 → lần 2 lỗi DOCK_FULL |
| 2 | BE `startGDO`: kho có cửa xuất (kind DOCK_OUT, is_active) và không phải cặp nội bộ (`isInternalPair`) → thiếu `dock_location_id` = 422 `DOCK_REQUIRED` (kèm danh sách cửa + số xe đang chiếm); có → gọi RPC. Nhả ở complete / cancel / unstart (`dock_location_id = null`). `PATCH /outbound/:id/dock` đổi cửa cùng luật (quyền `outbound.edit`). Xuất luôn 2 đường không đụng. | QA gói 56 mục [1]: 422 khi thiếu · 200 khi có · cặp nội bộ không cần · đầy → 422 · complete nhả · đua 5 người 1 suất = 1×200 + 4×422 |
| 3 | Pane cửa trên Sơ đồ kho: ô "Số xe tối đa" (DOCK) / "Sức chứa pallet chờ" (DROP). Route PATCH objects nhận `dock_capacity`. | Playwright: khai 2 cho Cửa Cont 1, reload còn 2 |
| 4 | FE Bắt đầu chuyến (dialog StartDialog): ô chọn Cửa (SingleSelect, hiện `Cửa · n/m xe`), chỉ hiện khi kho có cửa và không nội bộ; lỗi DOCK_FULL = banner đỏ liệt kê cửa trống. | 1280 + 390 + 360 không tràn |
| 5 | Thể hiện: lớp phủ **Cửa** trên bản vẽ (xe nào ở cửa nào, bao lâu) qua RPC `warehouse_map_docks(wh)` 1 round-trip; cột Cửa ở Chuẩn bị hàng + Giám sát vận hành (`TABLE_QUERY_MAP` GroupDeliveryOrder đã có → thêm key map). | Bắt đầu 1 chuyến → ô cửa trên bản vẽ đổi màu không F5 |
| 6 | Luật "bug chết hai lần": ratchet `gdo_start_without_dock_guard` (mọi đường đặt `status='IN_PROGRESS'` phải qua `startGDO`/RPC). Cập nhật CLAUDE.md (hàng outbound + warehouse_map), SCHEMA_REVIEW.md, bump rebuild-token, push dev. | `09-static-gate` xanh; `run-all` gói 11/12/54/56 xanh |

## Đợt 1b — 3D chỉ xem, dựng từ 2D (≈ 1 ngày)

| # | Bước | Kiểm tra |
|---|---|---|
| 1 | `components/wms/WarehouseMap3D.tsx` lazy (Three.js đã có ở Xếp xe 3D): sàn = khung × cell_m; khối STORAGE đùn cao theo số tầng (`level_no` max của chân kệ, sàn = 1); pallet tô theo tầng + viền màu khu từ cùng payload occupancy; tường = khối thấp; cửa = tấm màu, có xe (đợt 1a) → khối xe kèm biển; DROP = cột nhỏ. Orbit/zoom, bấm khối → cột tầng dùng chung với 2D. **Không sửa trong 3D.** | Ba Vì dựng < 2s, 60 fps desktop; số pallet từng ô = 2D |
| 2 | Nút **3D** cạnh nhóm lớp phủ (ẩn < 1024px); góc nhìn 3D cho chế độ TV Giám sát vận hành (chỉ xem, tự xoay chậm). | Playwright desktop; 390 không hiện nút |
| 3 | Guide (`WarehouseMapGuide`) thêm mục 3D; gói 54 thêm mục shape payload không đổi. | 54 xanh |

## Đợt 1c — Kế hoạch lấy hàng + 3 bảng theo vai (≈ 3–4 ngày)

> **Plan chi tiết đã lập 10/09 → `docs/plans/DIRECTED_WORK_1C_PLAN.md`** (mục 0 = 3 điểm ĐỔI so bảng dưới cần user gật: giữ chỗ MỀM qua bảng việc thay `cartons_reserved` · bỏ `level_seconds` · bỏ assignee per-việc; + Loại kho phục vụ cho cửa/đầu dãy theo câu hỏi user 10/09). Bảng dưới là phác thảo 09/09, giữ để đối chiếu; **code theo file chi tiết**.

| # | Bước | Kiểm tra |
|---|---|---|
| 1 | Cờ 2 tầng Kho + Loại kho: `work_mode` THỦ CÔNG / HƯỚNG DẪN (mặc định THỦ CÔNG), `lower_from_level` (tầng ≥ n → xe hạ, mặc định 2), `level_seconds` jsonb phụ phí giây theo tầng. Setting form Kho + tab Loại kho. | QA 56 [2] round-trip |
| 2 | Bảng `wms_tasks` (LẤY/HẠ/ĐƯA RA; gdo_id, item_id, pallet_id hoặc mã+date, từ ô → tới ô, seq, level, assignee, status PENDING/DONE/SKIPPED, mốc giờ) + `wms_task_events`. Generator ở `startGDO` khi kho HƯỚNG DẪN: phân rã đơn → pallet theo `rotation.ts`, giữ chỗ `cartons_reserved`, seq = FEFO → giờ xe → BFS từ **cửa đã chọn** (nội bộ: điểm Giao Chế biến / DROP gần nhất) → tầng cao trước. Huỷ/unstart → xoá việc + nhả giữ chỗ. | Oracle: Σ thùng việc = Σ thùng đơn; không dòng nào vi phạm FEFO; unstart → reserved về 0 |
| 3 | Ba view sống trên `wms_tasks` (1 RPC `directed_board(wh, role)`): **Cần hạ** (tab toàn kho, xe nâng hạ, tầng ≥ n, sắp theo xe thiếu hàng ở bãi → giờ xe → đường đi; nút "Đã hạ" tuỳ chọn, đặt pallet vào DROP qua `move_pallets_to_location`), **Cần đưa ra bãi** (xe chuyển được chọn lúc Bắt đầu, việc → cửa của chuyến), **Sắp quét** (thủ kho, PDA, dòng kế tiếp nổi bật). Việc tự DONE khi `scanItem` quét đúng pallet; quét pallet khác cùng mã → việc cũ SKIPPED có lý do, không chặn (HƯỚNG DẪN). | Quét đủ → 3 bảng rỗng không F5; realtime `TABLE_QUERY_MAP` wms_tasks |
| 4 | Quyền: module `directed_work` (view, lower, move, reassign) đủ 4 nơi; scope kho. | QA 08 perm-coverage |
| 5 | Gói QA 56 đầy đủ + ratchet `task_status_written_outside_rpc`; CLAUDE.md, memory. | run-all xanh |

## Nợ song song (không chặn đợt 1)
- Production **chưa áp** 8 migration: 20260908, 20260908b, 20260908c, 20260909, 20260909b, 20260909c (+ 20260910 sau đợt 1a) — cần user duyệt.
- Bàu Bàng 0/1.517 vị trí chưa vẽ → cân nhắc upload toạ độ Excel + cột Lưới ở trang Vị trí kho.
- `doh`/`turnover` rỗng trên biểu đồ KPI (gác lại theo user 09/09).
