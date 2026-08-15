-- Gỡ khóa `weigh_station_code` khỏi cấu hình đơn vị (SystemSetting.org_profile) — 14/08/2026.
--
-- Lý do (user bắt): đơn vị lấy dữ liệu từ NHIỀU trạm cân ở NHIỀU kho, nên "mã trạm cân mặc định"
-- dùng chung cho cả hệ thống là sai bản chất — và nguy hiểm: `source_id` của phần mềm cân là
-- autonumber đếm từ 1 ở MỖI trạm, nên hai trạm mang cùng mã sẽ ĐÈ phiếu của nhau qua khóa upsert
-- (station_code, source_id). Mã trạm giờ do agent của TỪNG trạm khai và là BẮT BUỘC.
--
-- Phải dọn giá trị đang lưu: validator mới coi `weigh_station_code` là khóa lạ ⇒ để nguyên thì cả
-- cụm cấu hình đơn vị bị từ chối khi đọc và app âm thầm rơi về mặc định.
UPDATE "SystemSetting"
   SET value = value - 'weigh_station_code',
       updated_at = now()
 WHERE key = 'org_profile'
   AND value ? 'weigh_station_code';
