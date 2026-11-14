-- MES 14/11 (khuya) — MẪU PHIẾU THEO DÕI thành DỮ LIỆU CẤU HÌNH (user: "những cái khác bạn cho nó là số liệu config được đi").
-- Trước: danh sách ô của hai phiếu (phối trộn · dịch thạch) viết cứng ở FE config/processForms.ts.
-- Nay: mỗi mẫu phiếu là MỘT dòng production_process_form — tên ô · kiểu · đơn vị · ngưỡng tiêu chuẩn · số lần đổ · bảng theo dõi
-- (số lần × cột × ô) đều sửa ở Cài đặt MES → tab "Mẫu phiếu theo dõi" (quyền production.configure); thêm được mẫu phiếu mới.
-- blocks = mảng khối theo thứ tự hiện trên form:
--   { type:'fields', title, hint?, fields:[{ key, label, kind:'num'|'time'|'text', unit?, min?, max?, wide?, prefill?:'machine_code'|'planned_qty' }] }
--   { type:'grid', key, title, hint?, rows, cols:[{key,label}], cells:[{key,label,kind}] }   — mã ô của bảng = <key>_<lần>_<cột>_<ô>
-- Phiếu đã ghi (batch_process_log.data) KHÔNG đổi: mã ô giữ nguyên; ô bị gỡ khỏi mẫu thì giá trị cũ vẫn nằm trong phiếu
-- (màn hình hiện ở khối "Ô không còn trong mẫu"). Mẫu đã có phiếu thì không xoá — tắt "Đang dùng".
BEGIN;

CREATE TABLE IF NOT EXISTS public.production_process_form (
  code             text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  title            text NOT NULL,
  short            text NOT NULL,
  blocks           jsonb NOT NULL CHECK (jsonb_typeof(blocks) = 'array'),
  sort_order       int NOT NULL DEFAULT 0,
  is_active        boolean NOT NULL DEFAULT true,
  updated_by_name  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL
);
ALTER TABLE public.production_process_form ENABLE ROW LEVEL SECURITY;

INSERT INTO public.production_process_form (code, title, short, blocks, sort_order, is_active, updated_at) VALUES
  ('MIX', 'Phiếu theo dõi quá trình phối trộn', 'Phối trộn', '[{"type":"fields","title":"Bồn trộn","fields":[{"key":"mix_tank","label":"Bồn trộn (Mixing)","kind":"text","prefill":"machine_code"},{"key":"mix_qty","label":"Số lượng mẻ","kind":"num","prefill":"planned_qty"},{"key":"start_time","label":"Giờ bắt đầu","kind":"time"},{"key":"end_time","label":"Giờ kết thúc","kind":"time"}]},{"type":"fields","title":"Nước cấp và hoàn nguyên","fields":[{"key":"water_l","label":"Nước cấp","kind":"num","unit":"L"},{"key":"mix_temp","label":"Nhiệt độ trộn","kind":"num","unit":"°C"},{"key":"recon_water_l","label":"Nước hoàn nguyên","kind":"num","unit":"L"},{"key":"recon_temp","label":"Nhiệt độ sau hoàn nguyên","kind":"num","unit":"°C"}]},{"type":"fields","title":"Đổ nguyên liệu","fields":[{"key":"pour1_time","label":"Đổ xong lần 1 — giờ","kind":"time"},{"key":"pour1_check","label":"Đổ xong lần 1 — kiểm tra","kind":"text"},{"key":"pour2_time","label":"Đổ xong lần 2 — giờ","kind":"time"},{"key":"pour2_check","label":"Đổ xong lần 2 — kiểm tra","kind":"text"},{"key":"pour3_time","label":"Đổ xong lần 3 — giờ","kind":"time"},{"key":"pour3_check","label":"Đổ xong lần 3 — kiểm tra","kind":"text"}]},{"type":"fields","title":"Giám sát và cacao","fields":[{"key":"supervise_by","label":"Giám sát CNV trộn ổn định, nguyên liệu — người","kind":"text"},{"key":"supervise_time","label":"Giám sát — giờ","kind":"time"},{"key":"cacao_water_l","label":"Nước cấp trộn cacao","kind":"num","unit":"L"},{"key":"cacao_temp","label":"Nấu cacao — nhiệt độ","kind":"num","unit":"°C"},{"key":"cacao_time","label":"Nấu cacao — thời gian","kind":"text"}]},{"type":"fields","title":"Chỉ tiêu","hint":"pH nước trộn: tiêu chuẩn ≤ 7,20","fields":[{"key":"ph_water","label":"pH nước trộn","kind":"num","max":7.2},{"key":"ph_dac","label":"pH DAC","kind":"num"},{"key":"brix","label":"Brix","kind":"num"}]},{"type":"fields","title":"Giao ca","fields":[{"key":"handover_done","label":"Nguyên liệu đã phối trộn","kind":"text","wide":true},{"key":"handover_todo","label":"Nguyên liệu chưa phối trộn","kind":"text","wide":true},{"key":"note","label":"Ghi chú","kind":"text","wide":true}]}]'::jsonb, 10, true, now()),
  ('JELLY', 'Phiếu theo dõi bán thành phẩm dịch thạch', 'Dịch thạch', '[{"type":"fields","title":"Bồn khoáng","fields":[{"key":"mineral_water_l","label":"Nước cấp","kind":"num","unit":"L"},{"key":"mineral_temp","label":"Nhiệt độ","kind":"num","unit":"°C"},{"key":"mineral_ph","label":"pH","kind":"num"}]},{"type":"fields","title":"Bổ sung đường","fields":[{"key":"sugar_kg","label":"Số lượng","kind":"num","unit":"kg"},{"key":"sugar_check_time","label":"Thời gian kiểm tra","kind":"time"},{"key":"sugar_ph","label":"pH dịch đường","kind":"num"}]},{"type":"fields","title":"Đổ / rửa thạch","fields":[{"key":"jelly_kg","label":"Số lượng thạch","kind":"num","unit":"kg"},{"key":"jelly_start","label":"Bắt đầu","kind":"time"},{"key":"jelly_end","label":"Kết thúc","kind":"time"}]},{"type":"grid","key":"wash","title":"Theo dõi nước rửa thạch","hint":"giờ / nhiệt độ / pH mỗi lần kiểm","rows":8,"cols":[{"key":"s1","label":"Bồn sục 1"},{"key":"s2","label":"Bồn sục 2"},{"key":"s3","label":"Bồn sục 3"}],"cells":[{"key":"t","label":"Giờ","kind":"time"},{"key":"temp","label":"°C","kind":"num"},{"key":"ph","label":"pH","kind":"num"}]},{"type":"fields","title":"Hoàn thiện","fields":[{"key":"finish_time","label":"Giờ hoàn thiện","kind":"time"},{"key":"finish_level","label":"Mức bồn","kind":"num"},{"key":"sample_time","label":"Giờ lấy mẫu","kind":"time"},{"key":"finish_temp","label":"Nhiệt độ","kind":"num","unit":"°C"},{"key":"sensory","label":"Màu sắc, mùi vị","kind":"text"},{"key":"state","label":"Trạng thái","kind":"text"},{"key":"finish_brix","label":"Brix","kind":"num"},{"key":"finish_ph","label":"pH","kind":"num"},{"key":"uht_time","label":"Giờ UHT","kind":"time"},{"key":"note","label":"Ghi chú / theo dõi","kind":"text","wide":true}]}]'::jsonb, 20, true, now())
ON CONFLICT (code) DO NOTHING;

-- loại phiếu không còn là danh sách cứng MIX / JELLY ⇒ thay CHECK bằng khoá ngoại tới mẫu phiếu
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.batch_process_log'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%''MIX''%' LOOP
    EXECUTE format('ALTER TABLE public.batch_process_log DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE public.batch_process_log DROP CONSTRAINT IF EXISTS batch_process_log_form_fkey;
ALTER TABLE public.batch_process_log ADD CONSTRAINT batch_process_log_form_fkey FOREIGN KEY (form) REFERENCES public.production_process_form(code);

COMMIT;
