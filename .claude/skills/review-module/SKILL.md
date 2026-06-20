# Rà soát 1 module đầy đủ (review-module)

> Mục đích: review/audit 1 module mà **KHÔNG bỏ sót tính năng** — đặc biệt **kết nối CHÉO module**.
> Dùng khi: đi chiến dịch rà soát từng module (xem [[module-review-campaign]]), hoặc audit lại 1 module bất kỳ.

## Bài học gốc (vì sao có skill này)
**20/06/2026:** suýt báo "Outbound đã review xong" nhưng **bỏ quên luồng Outbound→TMS** (`maybeAutoCreateTransferOrder`: GDO hoàn thành → tự tạo `TmsOrder` + `inbound_plan_lines` + `TmsVehicleSlot`; teardown khi bỏ-hoàn-thành). Người dùng phải nhắc mới nhớ ra.
**Nguyên nhân:** review dựa **trí nhớ** (lossy) thay vì **liệt kê bề mặt TỪ CODE** (đầy đủ). Cross-module connection KHÔNG nằm trong "tên module" — nó ẩn trong controller dưới dạng ghi vào **bảng của module khác**.

## Nguyên tắc cốt tử
1. **Bề mặt module phải liệt kê TỪ CODE** (routes + controller + FE + realtime map + permissions config), KHÔNG từ trí nhớ.
2. **Module chỉ được đánh "review xong" khi MỌI mục bề mặt được tick** — kể cả từng điểm nối cross-module. Còn 1 mục ⏳ → CHƯA xong, không báo xong.
3. **Mỗi điểm nối cross-module phải test 2 CHIỀU** (trigger tạo + hủy/undo teardown) và **kiểm bất biến số liệu** (tổng nhập, tồn, planned vs actual).

## Bước 1 — Liệt kê bề mặt module TỪ CODE (bắt buộc, làm đủ 6 ý)
1. **Routes**: grep `backend/src/routes/*.ts` theo prefix module → liệt kê MỌI `GET/POST/PATCH/DELETE` + quyền gate (`requirePerm`/`requireAnyPerm`).
2. **Controller**: đọc tất cả hàm `export` trong controller của module.
3. ⭐ **CROSS-MODULE WRITES (HAY SÓT NHẤT)**: grep controller tìm **tên BẢNG KHÁC module** trong `.insert/.update/.delete`. Mỗi bảng "lạ" = 1 điểm nối phải review + test 2 chiều.
   - VD Outbound: `grep -E "TmsOrder|inbound_plan_lines|ProductionImport|TmsVehicleSlot"` trong `outboundController.ts`.
   - Cách tổng quát: grep `from\('([A-Z]\w+)'` rồi loại bỏ các bảng thuộc chính module → còn lại là cross-module.
4. **FE page**: mọi nút gọi API write + gate `can(perms, module, action)`; mọi nút điều hướng/gọi API của module khác.
5. **Realtime**: bảng nào của module có trong `TABLE_QUERY_MAP` (`frontend/src/api/realtimeEvents.ts`) + map đủ key liên quan chưa.
6. **Permissions**: actions ở FE `MODULES` + BE `ALL_PERMISSIONS` khớp nhau; mỗi route gate đúng.

## Bước 2 — Ghi checklist bề mặt vào memory `module-review-campaign`
Mỗi module 1 đoạn, liệt kê các mục bề mặt + trạng thái ✅/⏳. **Bắt buộc có dòng "Cross-module:"** liệt kê từng điểm nối (vd `Outbound→TMS (auto TmsOrder/inbound_plan_lines)`, `Outbound→Inbound (ProductionImport khi nhận)`). Đây là bằng chứng đã liệt kê đủ — không có dòng này = chưa làm Bước 1.

## Bước 3 — Review từng mục
Với mỗi nhóm gọi skill tương ứng + verify sống:
- List/table/detail → [[table-format]]
- Nút/route write → [[add-permission]]
- INSERT/UPDATE/mutation số liệu → [[mutation-realtime]]
- Quét QR → [[qr-scan-flow]]
- Bug chưa rõ → [[debug-systematic]]
- Trước khi báo xong → [[verify-feature]] (Postgres + Playwright + tsc/build).

## Bước 4 — Cross-module: test 2 chiều + bất biến số liệu
Với MỖI điểm nối ở Bước 1.3:
- **Chiều tạo**: trigger → bảng module khác sinh đúng (số lượng/khóa ngoại/trạng thái).
- **Chiều gỡ**: hủy/undo/uncomplete → teardown đúng VÀ có **gác an toàn** (vd không xóa kế hoạch nhập khi kho nhận đã nhận hàng).
- **Bất biến số liệu** trên DB thật (Postgres MCP): tổng nhập (`SUM cartons_imported` theo `import_order_id`) không đổi; tồn khớp; planned vs actual khớp.

## Checklist
- [ ] Đã grep routes + đọc controller → liệt kê HẾT endpoint + quyền
- [ ] **Đã grep controller tìm bảng KHÁC module (cross-module writes)** — không bỏ bước này
- [ ] Mỗi điểm nối cross-module: review + test 2 chiều + kiểm bất biến số liệu trên DB thật
- [ ] Realtime: bảng module trong `TABLE_QUERY_MAP`, map đủ key
- [ ] Quyền đủ 4 nơi (FE/BE config + gate nút + route)
- [ ] Đã ghi bề mặt + dòng "Cross-module:" + trạng thái vào memory campaign
- [ ] KHÔNG báo "review xong" khi còn mục ⏳