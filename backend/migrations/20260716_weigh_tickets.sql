-- Tích hợp TRẠM CÂN 100T (PM Cân Kinh Bắc — Access TVTDB.mdb, bảng WeightForm).
-- Agent tại LAN đọc DB cân → POST /api/integration/v1/weigh/tickets (ApiKey scope weigh:write)
-- → upsert vào bảng này theo (station_code, source_id). KHÔNG FK cứng sang GDO (soft link —
-- để xóa đơn SIM/test không vướng); khớp chuyến theo biển số chuẩn hóa + ngày.
CREATE TABLE IF NOT EXISTS public."WeighTicket" (
  id                 text PRIMARY KEY,
  station_code       text NOT NULL DEFAULT 'KB01',   -- mã trạm cân (nhiều trạm sau này)
  source_id          integer NOT NULL,               -- WeightForm.id bên PM cân
  ticket_no          text,                           -- WeightForm.OrderNum (số phiếu PM cân)
  weigh_date         date,                           -- GDate
  license_plate      text,                           -- TruckNum nguyên văn (có gạch)
  license_plate_norm text,                           -- bỏ gạch/space + upper → khớp WMS
  direction          text,                           -- ImExType nguyên văn ('Cân Xuất'/'Cân Nhập')
  goods_name         text,                           -- GoodsName ('TP'…)
  trans_company      text,
  tare_kg            numeric,                        -- cân bì
  tare_at            timestamptz,
  gross_kg           numeric,                        -- cân tổng
  gross_at           timestamptz,
  net_kg             numeric,                        -- KL hàng = tổng − bì
  in_time            timestamptz,                    -- GInTime
  out_time           timestamptz,                    -- GOutTime (rỗng = chưa xong)
  is_complete        boolean NOT NULL DEFAULT false, -- net > 0 (đã cân đủ 2 lần)
  gdo_id             text,                           -- soft link GroupDeliveryOrder (chuyến xuất)
  matched_at         timestamptz,
  matched_by         text,                           -- 'auto' hoặc tên user gắn tay
  raw                jsonb,                          -- payload gốc từ agent (truy vết)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL,
  UNIQUE (station_code, source_id)
);
CREATE INDEX IF NOT EXISTS idx_weigh_plate_date ON public."WeighTicket" (license_plate_norm, weigh_date);
CREATE INDEX IF NOT EXISTS idx_weigh_date       ON public."WeighTicket" (weigh_date DESC);
CREATE INDEX IF NOT EXISTS idx_weigh_gdo        ON public."WeighTicket" (gdo_id);

ALTER TABLE public."WeighTicket" ENABLE ROW LEVEL SECURITY;  -- chặn anon (service role bypass)
ALTER PUBLICATION supabase_realtime ADD TABLE public."WeighTicket";
