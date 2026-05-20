-- Soft delete cho Employee: giữ row trong DB (lịch sử còn FK), ẩn khỏi UI.
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
