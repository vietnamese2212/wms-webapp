-- 02/10/2026 — Tab Bản đồ, cách xem "THEO KHÁCH HÀNG" (user: "ghim là vị trí của khách, không phải của chuyến xe; icon theo kênh;
-- số thứ tự = xếp hạng pallet quy đổi đã xuất trong kênh, để thấy top khách ở đâu").
-- Một RPC trả DÒNG (jsonb) — không kéo 20.000 dòng ZSD02 về backend để cộng (luật PostgREST cap 1000 + pool ~10 khe).
-- Pallet = sap_pallets của SAP (cùng thước với tab Xem đơn / OD bị bỏ ra), theo NGÀY GIAO trong [p_from, p_to], chỉ dòng chảy lên xe
-- được (SALE/STO/INTERNAL/PALLET — hàng trả / chiết khấu không tính), plant = Warehouse.sap_plant. Hạng tính trong KÊNH (khách không
-- kênh gộp vào nhóm '—'). Khách ngừng hoạt động vẫn trả (có ghim thì vẫn hiện, cờ is_active để FE làm mờ).
create or replace function dispatch_customer_rank(p_plant text, p_from date, p_to date)
returns jsonb language sql stable as $$
with agg as (
  select o.ship_to_code,
         max(o.ship_to_name)                 as sap_name,
         coalesce(sum(o.sap_pallets), 0)     as pallets,
         coalesce(sum(o.gross_weight_kg), 0) / 1000.0 as tons,
         count(distinct o.od_number)         as ods,
         max(o.delivery_date)                as last_date
  from erp_outbound_orders o
  where o.plant = p_plant
    and o.delivery_date between p_from and p_to
    and o.flow in ('SALE', 'STO', 'INTERNAL', 'PALLET')
    and o.ship_to_code is not null
    and coalesce(o.sync_status, '') <> 'OBSOLETE'
  group by o.ship_to_code
),
rows_ as (
  select a.ship_to_code, coalesce(c.name, a.sap_name) as name, c.channel, c.is_active,
         c.geo_lat, c.geo_lng, c.geo_source, c.region_name, c.ward_code,
         round(a.pallets::numeric, 1) as pallets, round(a.tons::numeric, 2) as tons, a.ods, a.last_date,
         rank() over (partition by coalesce(c.channel, '—') order by a.pallets desc, a.ods desc, a.ship_to_code) as rank_in_channel,
         rank() over (order by a.pallets desc, a.ods desc, a.ship_to_code) as rank_all
  from agg a
  left join "Customer" c on c.ship_to_code = a.ship_to_code
)
select coalesce(jsonb_agg(to_jsonb(r) order by r.pallets desc, r.ship_to_code), '[]'::jsonb) from rows_ r;
$$;
