-- 20260915 — FILL HÀNG TỰ RA LỆNH (user chốt 15/09: "fill hàng phục vụ nhặt lẻ — ra lệnh tự động được không?")
--
-- Vì sao: đo staging 15/09 — module Fill ra 05/08 mà tới nay có **0 lệnh fill** nào được tạo, trong khi
-- đường TỰ ĐỘNG (việc LOOSE_FEED do bộ lập kế hoạch đặt lúc Bắt đầu chuyến) đã chạy thật (9 việc, 3 xong).
-- Nút "Ra lệnh fill" là một nhát bấm nằm giữa "máy đã biết phải hạ gì" và "người đi hạ", và sáu tuần cho
-- thấy không ai đi qua nó. Nay máy tự ra lệnh; người vẫn quyết AI LÀM và LÚC NÀO (lệnh không gán ai, hiện
-- ở Hộp việc → "Việc chung của kho" — nhánh đó `work_inbox` đã có sẵn).
--
-- MẶC ĐỊNH TẮT cho cả 153 kho: tự ra lệnh là đổi hành vi, không tự bật hộ ai (cùng khuôn `date_rule_policy`).

-- CÔNG TẮC 2 TẦNG như mọi chiến thuật khác (user chốt 15/09: "tự động hoặc bằng tay thì cần có
-- setting cho Kho và loại kho nha"): mặc định của KHO + ghi đè theo LOẠI KHO. Ở tầng loại, NULL =
-- "kế thừa kho" — nên `false` của loại vẫn TẮT được cái mà kho đang bật (vd kho bật auto, riêng
-- POSM thì thôi vì hàng POSM không đo được date, hạ xuống ô lẻ cũng chẳng theo lô nào).
alter table "Warehouse"              add column if not exists auto_fill    boolean not null default false;
alter table "warehouse_type_configs" add column if not exists auto_fill    boolean;
alter table "FillOrder"              add column if not exists auto_created boolean not null default false;

comment on column "Warehouse".auto_fill is
  'Tự ra lệnh fill hàng nhặt lẻ cho NGÀY XUẤT HÔM NAY (không gán ai). Mặc định TẮT.';
comment on column "warehouse_type_configs".auto_fill is
  'Ghi đè công tắc tự ra lệnh fill theo LOẠI KHO. NULL = theo cấu hình của kho.';
comment on column "FillOrder".auto_created is
  'Lệnh do hệ thống tự đặt (không phải người bấm) — để còn phân biệt khi soi lại.';

-- Dòng do máy đặt mà nhu cầu đã hết (đơn huỷ / đổi ngày / hàng đã có đủ ở ô lẻ) thì phải TỰ THU HỒI,
-- nếu không sẽ có người đi hạ một pallet không ai cần và chiếm mất ô nhặt lẻ. Chỉ thu hồi dòng CHƯA AI
-- ĐỤNG — cùng luật với "sắp lại kế hoạch" của Việc cần làm. Index riêng phần cho câu quét đó.
create index if not exists idx_filltask_auto_pending
  on "FillTask" (warehouse_id, target_date)
  where status = 'PENDING' and assignee_id is null and coalesce(scanned_pallets, 0) = 0;
