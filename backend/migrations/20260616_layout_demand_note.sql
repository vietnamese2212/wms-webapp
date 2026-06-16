-- Ghi chú cho từng vị trí (skill) trong layout và trong phiếu phân công
ALTER TABLE "WorkLayoutSkill"        ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE "WorkAssignmentDemand"   ADD COLUMN IF NOT EXISTS note TEXT;
