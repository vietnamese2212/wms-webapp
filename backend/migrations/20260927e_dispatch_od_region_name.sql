-- Điều vận: tên VÙNG trên dòng OD của kế hoạch (27/09 tối, user hỏi "100 và 114 là gì" — bàn in mã Vùng SAP trần).
-- Tên lấy từ danh mục Khách hàng (ZSD02 nạp Customer.region_name) lúc chụp OD vào kế hoạch; NULL = hiện mã như cũ.
alter table dispatch_trip_od add column if not exists region_name text;

update dispatch_trip_od o
   set region_name = c.region_name
  from "Customer" c
 where c.ship_to_code = o.ship_to_code
   and o.region_name is null
   and c.region_name is not null;
