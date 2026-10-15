-- 15/10/2026 — KÊNH KHÁCH CHỤP LÚC LẬP trên dòng OD của kế hoạch điều vận (user chốt 15/10 "ok làm theo bạn đề xuất"): luật "không trộn kênh
-- khách trên một xe" trước đây đọc SỐNG `Customer.channel` ở cửa làm tay + cửa Xác nhận, trong khi đi xe riêng · số khách · dòng xe được vào
-- đều là bản chụp lúc lập ⇒ đổi kênh một khách sau khi lập làm Xác nhận chặn xe máy vừa xếp đúng, và chip "Sai quy định" không cảnh báo
-- trước được. Nay kênh cũng là bản chụp (`odRow` ghi lúc lập / Tối ưu lại / nạp OD / thay OD / cập nhật theo SAP — mọi cửa ghi dòng);
-- muốn áp kênh mới cho nháp đang mở ⇒ "Tối ưu lại" (nạp lại cấu hình khách).
-- Dòng đã có: điền kênh hiện tại của khách (khách ngừng hoạt động = không kênh, cùng luật `loadCandidates`). Lên production: áp bất kỳ lúc
-- nào TRƯỚC khi code mới chạy (code mới đọc cột này; thiếu cột ⇒ select '*' vẫn chạy nhưng kênh rỗng = luật kênh không chặn gì).
ALTER TABLE public.dispatch_trip_od ADD COLUMN IF NOT EXISTS channel text;
COMMENT ON COLUMN public.dispatch_trip_od.channel IS 'Kênh khách (Customer.channel) CHỤP lúc lập / Tối ưu lại — luật không trộn kênh trên một xe đọc cột này (15/10/2026)';

UPDATE public.dispatch_trip_od o
   SET channel = c.channel
  FROM public."Customer" c
 WHERE c.ship_to_code = o.ship_to_code
   AND o.channel IS NULL
   AND c.channel IS NOT NULL
   AND c.is_active IS DISTINCT FROM false;
