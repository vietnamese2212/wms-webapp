-- 19/11 — ĐỔI PHÒNG BAN CỦA CHỨC DANH (user: "chức năng đổi phòng ban không làm được").
-- Lỗi: form Sửa chức danh gửi department_id nhưng updateJobTitle không đọc trường đó ⇒ trả 200, phòng ban giữ nguyên (lớp C5: 200 im lặng).
-- Sửa: một hàm ghi trong MỘT giao dịch — đổi phòng ban của chức danh + chuyển theo các nhân viên đang mang chức danh đó và đang ở phòng ban
-- CŨ (form Nhân viên lọc chức danh theo phòng ban; để nhân viên ở lại phòng cũ thì ô Chức danh của họ không còn trong danh sách).
-- Nhân viên đang ở phòng ban khác / chưa có phòng ban: giữ nguyên (đã lệch từ trước, không tự đoán).
BEGIN;

CREATE OR REPLACE FUNCTION public.jobtitle_set_department(p_id text, p_dept text, p_actor text) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_old text; v_n int := 0;
BEGIN
  SELECT department_id INTO v_old FROM "JobTitle" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_old IS NOT DISTINCT FROM p_dept THEN
    RETURN jsonb_build_object('changed', false, 'employees', 0, 'from', v_old);
  END IF;
  UPDATE "JobTitle" SET department_id = p_dept, updated_at = now(), updated_by = p_actor WHERE id = p_id;
  UPDATE "Employee" SET department_id = p_dept, updated_at = now(), updated_by = p_actor
   WHERE job_title_id = p_id AND department_id IS NOT DISTINCT FROM v_old;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('changed', true, 'employees', v_n, 'from', v_old);
END $$;

REVOKE ALL ON FUNCTION public.jobtitle_set_department(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jobtitle_set_department(text, text, text) TO service_role;

COMMIT;
