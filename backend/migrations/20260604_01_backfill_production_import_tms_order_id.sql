-- Backfill tms_order_id vào ProductionImport từ gate_registrations
-- Vấn đề: khi tạo phiếu nhập NCC, backend không propagate tms_order_id từ gate registration
-- → ProductionImport.tms_order_id = NULL → báo cáo nhập không đếm được thực tế

UPDATE "ProductionImport" pi
SET
  tms_order_id = gr.tms_order_id,
  updated_at   = now()
FROM gate_registrations gr
WHERE pi.gate_registration_id = gr.id
  AND pi.tms_order_id IS NULL
  AND pi.source_type = 'NCC'
  AND gr.tms_order_id IS NOT NULL;
