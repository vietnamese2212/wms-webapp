-- 29/09/2026 — Bucket riêng tư `excel-uploads`: trạm trung chuyển cho file Excel > 4 MB (Vercel chặn thân request > 4,5 MB;
-- ZSD02 79 cột của SAP thường 8–10 MB). FE đẩy thẳng lên bucket bằng vé ký (POST /wms/uploads/sign), backend tải về
-- (service role), dựng req.file như multer rồi XOÁ file (middleware excelFromStorage). anon/authenticated KHÔNG có policy
-- nào trên storage.objects (giữ luật "0 quyền"): đẩy lên đi qua vé ký, đọc/xoá chỉ service role.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('excel-uploads', 'excel-uploads', false, 31457280,
  ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
        'application/vnd.ms-excel.sheet.macroEnabled.12', 'application/octet-stream'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;
