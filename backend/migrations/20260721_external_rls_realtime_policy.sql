-- FIX REALTIME cho "Dữ liệu bên ngoài" + đối chiếu:
-- 3 bảng khvc_lines / erp_outbound_orders / reconcile_tasks đã BẬT RLS nhưng THIẾU policy SELECT
-- → Supabase Realtime (kết nối role=authenticated qua setRealtimeAuth, xem frontend/src/lib/supabase.ts)
--   KHÔNG nhận được Postgres-changes event → FE các tab DO SAP / Kế hoạch xuất / Cần xử lý KHÔNG tự cập nhật
--   khi người khác/SAP đổi (BE service-role vẫn đọc được nên REST không lỗi — chỉ realtime chết âm thầm).
-- Vá: thêm policy SELECT cho authenticated (GIỐNG HỆT các bảng đang realtime OK: GroupDeliveryOrder,
--   InventoryEntry, OutboundItem… đều có rls_auth_select). Anon (khách vãng lai) VẪN bị chặn.
--   Cắt scope dữ liệu thật vẫn nằm ở controller BE (không nới lỏng gì về nghiệp vụ).
do $$
begin
  if not exists (select 1 from pg_policies where tablename='khvc_lines' and policyname='rls_auth_select') then
    create policy rls_auth_select on public.khvc_lines for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='erp_outbound_orders' and policyname='rls_auth_select') then
    create policy rls_auth_select on public.erp_outbound_orders for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='reconcile_tasks' and policyname='rls_auth_select') then
    create policy rls_auth_select on public.reconcile_tasks for select to authenticated using (true);
  end if;
end $$;
