-- Seed 20 xe cho mỗi ĐVVT đang active (xoay vòng VehicleType)
-- Biển số tổng hợp — không trùng nhau

DO $$
DECLARE
  now_ts TIMESTAMPTZ := NOW();

  prefix_arr TEXT[] := ARRAY[
    '51C','29A','30A','43C','92A','47A','36A','34C','51A','30F',
    '61C','33A','34A','72B','47B','36B','62A','67A','51B','29B'
  ];

  v_ncc     RECORD;
  v_vt_arr  UUID[];
  n_vt      INT;
  ncc_idx   INT := 0;
  v_plate   TEXT;
  i         INT;

BEGIN
  SELECT ARRAY_AGG(id ORDER BY code) INTO v_vt_arr
  FROM "VehicleType" WHERE is_active = TRUE;

  IF v_vt_arr IS NULL OR array_length(v_vt_arr, 1) = 0 THEN
    RAISE EXCEPTION 'Không có VehicleType nào active';
  END IF;
  n_vt := array_length(v_vt_arr, 1);

  FOR v_ncc IN
    SELECT id, code, name FROM "TransportCompany" WHERE is_active = TRUE ORDER BY code
  LOOP
    ncc_idx := ncc_idx + 1;

    FOR i IN 1..20 LOOP
      -- Biển số: prefix xoay theo ĐVVT, số = 10000 + (ncc_idx-1)*20 + (i-1) → không trùng
      v_plate := prefix_arr[((ncc_idx - 1) % array_length(prefix_arr, 1)) + 1]
                 || '-' || LPAD((10000 + (ncc_idx - 1) * 20 + (i - 1))::TEXT, 5, '0');

      INSERT INTO "Vehicle" (
        id, ncc_id, license_plate, vehicle_type_id, is_active, created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        v_ncc.id,
        v_plate,
        v_vt_arr[((i - 1) % n_vt) + 1],
        TRUE,
        now_ts, now_ts
      ) ON CONFLICT DO NOTHING;
    END LOOP;

    RAISE NOTICE 'ĐVVT [%] %: 20 xe', v_ncc.code, v_ncc.name;
  END LOOP;

  RAISE NOTICE '✓ Seed xe hoàn thành.';
END;
$$;
