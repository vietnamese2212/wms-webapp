-- Điều chỉnh tồn NGUYÊN TỬ: gộp cập-nhật-tồn + ghi-AdjustmentLog vào 1 transaction dưới row-lock.
-- Lý do (test tải 23/07): adjustInventory cũ làm CAS update tồn RỒI insert log ở 2 bước riêng.
-- Khi request bị 504 Gateway Timeout xen giữa → tồn đã đổi nhưng THIẾU dòng log
--   → audit trail hụt + client tưởng lỗi mà thực đã áp → retry trừ 2 lần (không idempotent).
-- RPC này khóa dòng (FOR UPDATE) → đọc-tính-ghi-log trong 1 transaction: hoặc cả 2 cùng commit,
--   hoặc không gì cả. Cũng bỏ được vòng optimistic-CAS 15 lần (giảm bão 409 khi đông người chỉnh).
-- Mẫu cùng họ: scan_insert_pallet, move_pallets_to_location, book_vehicle_slot.

create or replace function adjust_inventory_atomic(
  p_entry_id     text,
  p_delta        numeric,
  p_note         text,
  p_actor_name   text,
  p_actor_id     text,
  p_stocktake_by text,
  p_now          text,   -- ISO UTC (lưu vào cột timestamp-without-tz giữ đúng thành phần UTC như code cũ)
  p_vn_date      text,   -- 'YYYY-MM-DD' theo giờ VN
  p_updated_by   text
) returns text
language plpgsql
as $$
declare
  v_before    numeric;
  v_imported  numeric;
  v_adj       numeric;
  v_status    text;
  v_new       numeric;
  v_newstatus text;
begin
  -- Khóa dòng: mọi lượt chỉnh cùng pallet xếp hàng, không mất cập nhật, không cần CAS client.
  select cartons_remaining, cartons_imported, adjustment_qty, status
    into v_before, v_imported, v_adj, v_status
  from "InventoryEntry" where id = p_entry_id
  for update;

  if not found then return 'NOT_FOUND'; end if;

  v_before := coalesce(v_before, 0);
  v_new    := v_before + p_delta;
  if v_new < 0 then return 'NEGATIVE'; end if;

  v_newstatus := v_status;
  if v_status in ('IN_STOCK', 'PARTIAL', 'EXPORTED') then
    if v_new <= 0 then v_newstatus := 'EXPORTED';
    elsif v_new >= coalesce(v_imported, 0) then v_newstatus := 'IN_STOCK';
    else v_newstatus := 'PARTIAL';
    end if;
  end if;

  update "InventoryEntry" set
    cartons_remaining = v_new,
    adjustment_qty    = coalesce(v_adj, 0) + p_delta,
    status            = v_newstatus,
    updated_at        = p_now::timestamp,
    update_date       = p_vn_date::timestamp,
    updated_by        = coalesce(p_updated_by, updated_by),
    stocktake_by      = case when p_stocktake_by is not null then p_stocktake_by else stocktake_by end,
    stocktake_at      = case when p_stocktake_by is not null then p_now::timestamptz else stocktake_at end
  where id = p_entry_id;

  insert into "InventoryAdjustmentLog"(id, entry_id, delta, cartons_before, cartons_after, note, actor_name, actor_id, adjusted_at)
    values (gen_random_uuid()::text, p_entry_id, p_delta, v_before, v_new,
            p_note, p_actor_name, p_actor_id, p_now::timestamptz);

  return 'OK';
end
$$;
