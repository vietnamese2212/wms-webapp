-- SystemSetting: cờ hành vi per-DB (multi-tenant silo — mỗi đơn vị 1 DB, cờ theo KHÁC BIỆT không theo đơn vị)
-- + Nền cho QR pallet v2 (tem `;` của đơn vị 2): batch (mã lô) + HSD tường minh trên pallet.
-- Apply: STAGING trước → test → production LOF (từng project qua Supabase Dashboard / psql).

create table if not exists "SystemSetting" (
  key        text primary key,
  value      jsonb not null,
  updated_by text,
  updated_at timestamp not null
);

-- Cờ đầu tiên: định dạng tem pallet khi IN từ app ('underscore' | 'semicolon').
-- Chiều QUÉT không cần cờ — parser tự nhận theo delimiter.
insert into "SystemSetting" (key, value, updated_at)
values ('label_format', '"underscore"'::jsonb, now())
on conflict (key) do nothing;

-- QR v2: 50033;1;TA260705A045;05/07/2026;05/03/2027;1;05:26
-- batch = mã lô (đoạn 3), expiry_date = HSD (đoạn 5) — NULL với tem `_` cũ (fallback shelf-life như hiện tại)
alter table "InventoryEntry" add column if not exists batch text;
alter table "InventoryEntry" add column if not exists expiry_date date;
create index if not exists idx_inventory_entry_batch on "InventoryEntry"(batch) where batch is not null;

-- Realtime cho SystemSetting (đổi cờ → client tự cập nhật, idempotent)
do $$ begin
  alter publication supabase_realtime add table "SystemSetting";
exception when duplicate_object then null; end $$;
