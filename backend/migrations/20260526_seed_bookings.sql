-- ─────────────────────────────────────────────────────────────────────────────
-- Seed ~100 đơn vận chuyển ngày 26/05/2026 (đóng vai điều vận upload)
-- Tạo TmsOrder (CONFIRMED) + TmsVehicleSlot (PENDING — chưa booking khung giờ)
-- Không tạo DeliverySlot, không cập nhật booked_count
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  target_date DATE        := '2026-05-26';
  now_ts      TIMESTAMPTZ := NOW();

  npp_arr TEXT[] := ARRAY[
    'BigC Hà Nội','Coop Mart Cầu Giấy','Winmart Đống Đa','MM Mega Market',
    'Lotte Mart Hà Đông','AEON Mall Long Biên','VinMart Mỹ Đình','Bách hoá Xanh',
    'NPP Hà Nội 1','NPP Hải Phòng','Đại lý Nam Định','Đại lý Thái Bình',
    'Đại lý Vĩnh Phúc','Đại lý Hưng Yên','Đại lý Bắc Ninh','Đại lý Quảng Ninh',
    'NPP Thanh Hóa','NPP Nghệ An','Đại lý Ninh Bình','NPP Hà Nam',
    'Siêu thị Intimex','NPP Lào Cai','Đại lý Sơn La','NPP Điện Biên','Đại lý Yên Bái'
  ];

  notes_arr TEXT[] := ARRAY[
    'Giao hàng theo kế hoạch tuần',
    'Đơn định kỳ — ưu tiên khung giờ sáng',
    'Khách hàng VIP — đảm bảo đúng giờ',
    'Hàng mau hỏng — cần xuất trước 10h',
    'Kết hợp với chuyến hàng Bắc–Nam',
    'Đơn thường lệ',
    'Giao theo lịch cố định hàng tuần',
    'Ưu tiên bốc trước — hàng ít còn lại',
    'Đơn bổ sung theo yêu cầu NPP',
    'Chuyến hàng tổng hợp nhiều điểm giao'
  ];

  v_wh        RECORD;
  v_wh_short  TEXT;
  v_seq       INT;
  v_order_id  UUID;
  v_ncc_id    UUID;
  v_vtype     TEXT;
  v_npp       TEXT;
  v_gdo       TEXT;
  v_note      TEXT;
  v_dir       TEXT;
  v_boxes     INT;
  v_pallets   INT;
  v_tons      NUMERIC;
  v_inserted  INT;
  v_ncc_arr   UUID[];
  v_vtype_arr TEXT[];
  n_ncc       INT;
  n_vtype     INT;
  n_npp       INT := array_length(npp_arr, 1);
  n_notes     INT := array_length(notes_arr, 1);
  i           INT;

BEGIN
  -- Lấy danh sách ĐVVT và Loại xe từ cài đặt TMS
  SELECT ARRAY_AGG(id ORDER BY code) INTO v_ncc_arr
  FROM "TransportCompany" WHERE is_active = TRUE;

  SELECT ARRAY_AGG(name ORDER BY code) INTO v_vtype_arr
  FROM "VehicleType" WHERE is_active = TRUE;

  IF v_ncc_arr IS NULL OR array_length(v_ncc_arr, 1) = 0 THEN
    RAISE EXCEPTION 'Không có ĐVVT nào active trong TransportCompany';
  END IF;
  IF v_vtype_arr IS NULL OR array_length(v_vtype_arr, 1) = 0 THEN
    RAISE EXCEPTION 'Không có Loại xe nào active trong VehicleType';
  END IF;

  n_ncc   := array_length(v_ncc_arr, 1);
  n_vtype := array_length(v_vtype_arr, 1);

  -- ── Lặp qua từng kho đang hoạt động ────────────────────────────────────────
  FOR v_wh IN
    SELECT id, code, name FROM "Warehouse" WHERE is_active = TRUE ORDER BY code
  LOOP
    -- Rút ngắn code kho để dùng trong order_code
    v_wh_short := UPPER(REGEXP_REPLACE(v_wh.code, '[^A-Za-z0-9]', '', 'g'));
    v_wh_short := SUBSTRING(v_wh_short, 1, 4);

    -- Tìm seq bắt đầu (tránh trùng nếu chạy lại)
    SELECT COALESCE(
      MAX((REGEXP_MATCH(order_code, '_(\d+)$'))[1]::INT), 0
    ) + 1 INTO v_seq
    FROM "TmsOrder"
    WHERE date = target_date
      AND warehouse_id = v_wh.id
      AND order_code LIKE '260526_' || v_wh_short || '_%';

    -- ── Tạo 100 đơn vận chuyển ────────────────────────────────────────────────
    FOR i IN 1..100 LOOP
      v_order_id := gen_random_uuid();

      -- Xoay vòng ĐVVT, Loại xe, NPP
      v_ncc_id := v_ncc_arr[((v_seq + i - 2) % n_ncc)   + 1];
      v_vtype  := v_vtype_arr[((v_seq + i - 2) % n_vtype) + 1];
      v_npp    := npp_arr[((v_seq + i - 2) % n_npp)   + 1];
      v_note   := notes_arr[((i - 1) % n_notes) + 1];

      -- Mã GDO: GDO-YYMMDD-NNNNN
      v_gdo := 'GDO-260526-' || LPAD(((v_seq + i - 1 + 10000) % 90000 + 10000)::TEXT, 5, '0');

      -- Hướng: chủ yếu OUTBOUND, ~25% INBOUND
      v_dir := CASE WHEN (v_seq + i) % 4 = 0 THEN 'INBOUND' ELSE 'OUTBOUND' END;

      -- Khối lượng hàng hoá
      v_boxes   := 50  + ((v_seq + i) * 17 % 350);
      v_pallets :=  2  + ((v_seq + i) *  3 %  12);
      v_tons    := ROUND((v_boxes * 0.012 + v_pallets * 0.8)::NUMERIC, 3);

      INSERT INTO "TmsOrder" (
        id, order_code, date, warehouse_id, ncc_id, npp_name,
        direction, warehouse_type, vehicle_type,
        planned_boxes, planned_pallets, planned_tons,
        gdo_refs, notes, status, created_at, updated_at
      ) VALUES (
        v_order_id,
        '260526_' || v_wh_short || '_' || (v_seq + i - 1),
        target_date, v_wh.id, v_ncc_id, v_npp,
        v_dir, 'Thành phẩm', v_vtype,
        v_boxes, v_pallets, v_tons,
        v_gdo, v_note,
        'CONFIRMED', now_ts, now_ts
      ) ON CONFLICT (order_code) DO NOTHING;

      GET DIAGNOSTICS v_inserted = ROW_COUNT;

      -- Chỉ tạo VehicleSlot cho đơn vừa INSERT thành công
      IF v_inserted > 0 THEN
        INSERT INTO "TmsVehicleSlot" (
          id, order_id, slot_id, license_plate, status,
          created_at, updated_at
        ) VALUES (
          gen_random_uuid(), v_order_id, NULL, NULL, 'PENDING',
          now_ts, now_ts
        );
      END IF;

    END LOOP; -- i

    RAISE NOTICE 'Kho [%] %: tạo 100 đơn CONFIRMED — chờ ĐVVT đặt khung giờ',
      v_wh.code, v_wh.name;

  END LOOP; -- warehouse

  RAISE NOTICE '✓ Seed hoàn thành cho ngày 26/05/2026.';
END;
$$;
