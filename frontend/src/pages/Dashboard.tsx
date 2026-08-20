// Dashboard Tổng quan — 20/08: đổi da theo CONSOLE TỐI kiểu Manhattan Facility Console
// (đồng bộ trang Giám sát vận hành — user yêu cầu "dashboard theo phong cách đó").
// LOGIC SỐ LIỆU GIỮ NGUYÊN 100% (RPC dashboard_stats, gộp kho×loại, sức chứa xếp % cao nhất
// lên đầu, cap 12 kho, co cỡ chữ số dài) — chỉ thay lớp trình bày.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Package, PackagePlus, PackageMinus, Boxes, Layers, Warehouse, Clock, Truck, Grid3X3, LayoutDashboard,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useDashboardStats, type DashboardStats } from '@/api/hooks'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { QTY_CONVERTED_LABEL, QTY_CONVERTED_TIP, unitLabel } from '@/utils/qtyUnits'

type ZoneCap = NonNullable<DashboardStats['zones']>[number]

const nf = (n: number) => Number(n ?? 0).toLocaleString('vi-VN')
// KPI tile: bỏ thập phân cho gọn (card hẹp trên phone) — chi tiết đủ số lẻ nằm ở bảng dưới
const nf0 = (n: number) => Math.round(Number(n ?? 0)).toLocaleString('vi-VN')

const MODE_BADGE: Record<string, string> = {
  QR:       'bg-green-500/20 text-green-400',
  QTY:      'bg-blue-500/20 text-blue-400',
  QTY_DATE: 'bg-indigo-500/20 text-indigo-400',
  NONE:     'bg-slate-700 text-slate-400',
}

// Khối card console (khớp Block bên Giám sát vận hành)
function Panel({ title, icon: Icon, extra, children, className = '' }: {
  title: string; icon: typeof Package; extra?: React.ReactNode; children: React.ReactNode; className?: string
}) {
  return (
    <div className={`rounded-lg border border-slate-700 bg-slate-800/60 flex flex-col min-h-0 ${className}`}>
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-slate-700 shrink-0">
        <span className="w-1 h-3.5 rounded bg-sky-500 shrink-0" />
        <Icon className="h-3.5 w-3.5 text-slate-300" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-200">{title}</span>
        {extra}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  )
}

export default function Dashboard() {
  const { data: scopedWhs = [] } = useScopedWarehouses(true)
  const whId = useWmsFilterStore(s => s.dashboard.warehouseId)
  const setDashboard = useWmsFilterStore(s => s.setDashboard)
  // Kho đã chọn không còn trong scope (đổi phân quyền) → coi như "Tất cả kho"
  const effWhId = scopedWhs.length > 0 && whId && !scopedWhs.some(w => w.id === whId) ? '' : whId
  const { data: stats, isLoading, isError } = useDashboardStats(effWhId)
  const today = new Date().toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' })

  // Gộp theo kho (RPC trả dòng kho×loại) + tổng toàn scope
  const { byWarehouse, totals } = useMemo(() => {
    const rows = stats?.inventory ?? []
    const map = new Map<string, {
      warehouse_id: string; warehouse_name: string; inventory_mode: string | null
      pallets: number; cartons: number
      cats: { category: string; pallets: number; cartons: number; materials: number }[]
    }>()
    let pallets = 0, cartons = 0
    for (const r of rows) {
      let w = map.get(r.warehouse_id)
      if (!w) {
        w = { warehouse_id: r.warehouse_id, warehouse_name: r.warehouse_name, inventory_mode: r.inventory_mode, pallets: 0, cartons: 0, cats: [] }
        map.set(r.warehouse_id, w)
      }
      w.pallets += Number(r.pallets); w.cartons += Number(r.cartons)
      w.cats.push({ category: r.category, pallets: Number(r.pallets), cartons: Number(r.cartons), materials: Number(r.materials) })
      pallets += Number(r.pallets); cartons += Number(r.cartons)
    }
    // Pallet chủ đạo (30/07) → bảng kho xếp theo pallet, không theo số quy đổi trộn đơn vị
    const list = [...map.values()].sort((a, b) => b.pallets - a.pallets)
    return { byWarehouse: list, totals: { pallets, cartons, warehouses: list.length } }
  }, [stats])

  const t = stats?.today

  // Sức chứa khu vực: gom theo kho, kèm TỔNG kho + xếp % dùng CAO NHẤT lên đầu
  const zonesByWh = useMemo(() => {
    const map = new Map<string, { warehouse_name: string; zones: ZoneCap[]; used: number; cap: number }>()
    for (const z of stats?.zones ?? []) {
      let g = map.get(z.warehouse_id)
      if (!g) { g = { warehouse_name: z.warehouse_name, zones: [], used: 0, cap: 0 }; map.set(z.warehouse_id, g) }
      g.zones.push(z); g.used += z.used; g.cap += z.capacity
    }
    const pctOf = (g: { used: number; cap: number }) => (g.cap > 0 ? g.used / g.cap : g.used > 0 ? -1 : -2)
    return [...map.values()].sort((a, b) => pctOf(b) - pctOf(a))
  }, [stats])
  // Nhiều kho (trăm kho NPP): mặc định chỉ hiện 12 kho căng nhất, còn lại sau nút "Hiện tất cả"
  const [showAllWh, setShowAllWh] = useState(false)
  const WH_SHOW_CAP = 12
  const visibleWhGroups = showAllWh ? zonesByWh : zonesByWh.slice(0, WH_SHOW_CAP)

  const sk = 'bg-slate-700/50'
  const outPct = t && t.outbound_planned > 0 ? Math.min(100, Math.round((t.outbound_scanned / t.outbound_planned) * 100)) : null

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Header console */}
      <div className="border-b border-slate-700 bg-slate-900 px-3 py-2 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-white flex items-center gap-1.5 shrink-0 uppercase tracking-wide">
            <LayoutDashboard className="h-4 w-4 text-sky-400" /> Tổng quan hệ thống
          </span>
          <span className="hidden sm:inline text-[10px] uppercase tracking-wider text-slate-500 border-l border-slate-700 pl-2">Facility Overview</span>
          <span className="text-[11px] text-slate-400">{today}</span>
          <span className="flex-1" />
          <WarehouseSingleSelect
            warehouses={scopedWhs as { id: string; code?: string; name: string }[]}
            value={effWhId}
            onChange={id => setDashboard({ warehouseId: id })}
            allLabel="Tất cả kho"
            triggerClassName="w-40 sm:w-48 h-8"
          />
          <div className="hidden sm:flex items-center gap-1.5">
            <div className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-slate-400">Dữ liệu thời gian thực</span>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3 pb-20 lg:pb-4 space-y-3">
        {isError && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
            Không tải được số liệu dashboard — thử tải lại trang.
          </div>
        )}

        {/* KPI tồn kho (data thật) — tile console */}
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-2">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className={`h-[84px] rounded-lg ${sk}`} />)
          ) : (
            <>
              {/* PALLET = số CHỦ ĐẠO (user chốt 30/07): đơn vị vật lý duy nhất so được giữa mọi loại hàng */}
              <div className="rounded-lg bg-slate-800/80 border border-slate-700 px-3 py-2">
                <div className="text-[9px] uppercase tracking-wide text-slate-400 flex items-center gap-1"><Layers className="h-3 w-3 text-indigo-400" /> Pallet tồn</div>
                <div className="text-2xl font-semibold tabular-nums text-white leading-tight">{nf0(totals.pallets)}</div>
                <div className="text-[9px] text-slate-500">{totals.warehouses} kho có tồn</div>
              </div>
              {/* Tồn TÁCH THEO ĐƠN VỊ — RPC cũ chưa có by_unit → fallback ô quy đổi */}
              {(stats?.by_unit?.length ?? 0) > 0 ? (
                <div className="rounded-lg bg-slate-800/80 border border-slate-700 px-3 py-2">
                  <div className="text-[9px] uppercase tracking-wide text-slate-400 flex items-center gap-1 mb-1"><Boxes className="h-3 w-3 text-sky-400" /> Tồn theo đơn vị</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                    {stats!.by_unit!.map(u => (
                      <div key={u.unit} className="flex items-baseline justify-between gap-1.5 min-w-0" title={`${nf(u.qty)} ${unitLabel(u.unit)} · ${nf(u.pallets)} pallet · ${nf(u.materials)} mã`}>
                        <span className="text-[10px] text-slate-400 truncate">{unitLabel(u.unit)}</span>
                        <span className="text-[11px] font-bold tabular-nums text-slate-100">{nf0(u.qty)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg bg-slate-800/80 border border-slate-700 px-3 py-2">
                  <div className="text-[9px] uppercase tracking-wide text-slate-400 flex items-center gap-1"><Boxes className="h-3 w-3 text-sky-400" /> Tồn (quy đổi)</div>
                  <div className="text-2xl font-semibold tabular-nums text-white leading-tight">{nf0(totals.cartons)}</div>
                </div>
              )}
              <div className="rounded-lg bg-slate-800/80 border border-slate-700 px-3 py-2">
                <div className="text-[9px] uppercase tracking-wide text-slate-400 flex items-center gap-1"><Warehouse className="h-3 w-3 text-amber-400" /> Kho có tồn</div>
                <div className="text-2xl font-semibold tabular-nums text-white leading-tight">{totals.warehouses}</div>
              </div>
              <div className="rounded-lg bg-slate-800/80 border border-slate-700 px-3 py-2">
                <div className="text-[9px] uppercase tracking-wide text-slate-400 flex items-center gap-1"><PackageMinus className="h-3 w-3 text-sky-400" /> Xuất hôm nay</div>
                <div className={`text-2xl font-semibold tabular-nums leading-tight ${outPct != null && outPct >= 100 ? 'text-green-400' : 'text-white'}`}>
                  {nf0(t?.outbound_scanned ?? 0)}
                  <span className="text-xs font-normal text-slate-500"> {t?.outbound_planned ? `/ ${nf0(t.outbound_planned)} KH` : 'SL quy đổi'}</span>
                </div>
                {outPct != null && (
                  <div className="mt-1 h-1.5 rounded bg-slate-700">
                    <div className={`h-1.5 rounded ${outPct >= 100 ? 'bg-green-500' : 'bg-sky-500'}`} style={{ width: `${outPct}%` }} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Hoạt động hôm nay */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {[
            { icon: PackagePlus, ic: 'text-green-400 bg-green-500/15', value: t?.inbound_orders, label: 'Phiếu nhập hôm nay' },
            { icon: Package, ic: 'text-emerald-400 bg-emerald-500/15', value: t?.inbound_cartons, label: 'SL nhập (quy đổi)' },
            { icon: Truck, ic: 'text-blue-400 bg-blue-500/15', value: t?.outbound_gdos, label: 'Chuyến xuất hôm nay' },
            { icon: PackageMinus, ic: 'text-sky-400 bg-sky-500/15', value: t?.outbound_planned, label: 'SL KH xuất (quy đổi)' },
          ].map(({ icon: Icon, ic, value, label }) => (
            <div key={label} className="rounded-lg bg-slate-800/60 border border-slate-700 px-3 py-2.5">
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${ic.split(' ')[1]}`}>
                  <Icon className={`h-4.5 w-4.5 ${ic.split(' ')[0]}`} />
                </div>
                <div className="min-w-0">
                  {/* Số 8+ chữ số bị truncate đọc SAI cấp nghìn/triệu → co cỡ chữ, tooltip số đầy đủ */}
                  {isLoading
                    ? <Skeleton className={`h-7 w-16 mb-1 ${sk}`} />
                    : (() => { const s = nf(Number(value ?? 0)); return (
                        <p className={`${s.length >= 10 ? 'text-base' : s.length >= 8 ? 'text-xl' : 'text-2xl'} font-bold tabular-nums text-white leading-tight`} title={s}>{s}</p>
                      ) })()}
                  <p className="text-[10px] text-slate-400">{label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Sức chứa khu vực kho: pallet đang chiếm chỗ / pallet tối đa (Σ max_pallets vị trí) */}
        {(isLoading || zonesByWh.length > 0) && (
          <Panel title="Sức chứa khu vực kho" icon={Grid3X3}
            extra={<span className="text-[9px] font-normal text-slate-500">pallet tồn / pallet tối đa</span>}>
            <div className="p-3">
              {isLoading ? (
                <div className="space-y-1.5">
                  {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className={`h-6 rounded ${sk}`} />)}
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-x-8 gap-y-3">
                  {visibleWhGroups.map(g => {
                    const tUsed = g.used, tCap = g.cap
                    return (
                      <div key={g.warehouse_name} className="self-start">
                        <div className="flex items-baseline justify-between gap-2 border-b border-slate-600 pb-1">
                          <p className="text-[11px] font-semibold text-slate-200 truncate">{g.warehouse_name}</p>
                          <p className="shrink-0 text-[10px] tabular-nums text-slate-500">
                            {nf(tUsed)} / {tCap > 0 ? nf(tCap) : '—'}
                          </p>
                        </div>
                        {g.zones.map(z => {
                          const pct = z.capacity > 0 ? (z.used / z.capacity) * 100 : null
                          const barColor = pct == null ? 'bg-slate-600'
                            : pct >= 100 ? 'bg-red-500'
                            : pct >= 80 ? 'bg-amber-500'
                            : 'bg-sky-500'
                          // chưa đầy thật thì không làm tròn lên "100%" (99.6% → 99%)
                          const pctTxt = pct == null ? null
                            : pct >= 100 ? Math.round(pct) : pct >= 10 ? Math.min(99, Math.round(pct)) : Math.round(pct * 10) / 10
                          return (
                            <div key={z.zone_id} className="flex items-center gap-2 py-[3px] border-b border-slate-700/60 last:border-0"
                              title={`${z.name} (${z.code})${z.category ? ` · ${z.category}` : ''} — ${pct == null
                                ? 'chưa khai pallet tối đa'
                                : `${pctTxt}% đã dùng · còn ${nf(Math.max(0, z.capacity - z.used))} chỗ`}`}>
                              <p className="flex-1 min-w-0 truncate text-[11px] text-slate-300">
                                {z.name}<span className="ml-1 text-[9px] text-slate-500">{z.code}</span>
                              </p>
                              {/* Mobile ẩn bar — nhường chỗ cho TÊN khu (360px tên bị cắt) */}
                              <div className="hidden sm:block w-24 shrink-0 h-1.5 overflow-hidden rounded-full bg-slate-700">
                                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct == null ? 0 : Math.min(100, pct)}%` }} />
                              </div>
                              <p className="w-[84px] sm:w-[92px] shrink-0 text-right text-[10px] font-medium tabular-nums text-slate-300">
                                {nf(z.used)}<span className="font-normal text-slate-500"> / {z.capacity > 0 ? nf(z.capacity) : '—'}</span>
                              </p>
                              <p className={`w-10 shrink-0 text-right text-[10px] font-semibold tabular-nums ${pct == null ? 'text-slate-600'
                                : pct >= 100 ? 'text-red-400' : pct >= 80 ? 'text-amber-400' : 'text-slate-400'}`}>
                                {pct == null ? '—' : `${pctTxt}%`}
                              </p>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )}
              {!isLoading && zonesByWh.length > WH_SHOW_CAP && (
                <button type="button" onClick={() => setShowAllWh(v => !v)}
                  className="mt-2 w-full rounded-md border border-slate-600 py-1 text-[11px] font-medium text-slate-400 hover:bg-white/5">
                  {showAllWh ? 'Thu gọn' : `Hiện tất cả ${zonesByWh.length} kho (đang hiện ${WH_SHOW_CAP} kho căng chỗ nhất)`}
                </button>
              )}
            </div>
          </Panel>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Bảng tồn theo kho */}
          <div className="lg:col-span-2">
            <Panel title="Tồn kho theo kho" icon={Warehouse}
              extra={<Link to="/wms/inventory" className="ml-auto text-[10px] text-sky-400 hover:underline">Xem chi tiết →</Link>}>
              {isLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className={`h-9 ${sk}`} />)}
                </div>
              ) : byWarehouse.length === 0 ? (
                <p className="px-4 py-4 text-sm text-slate-500">Chưa có tồn kho trong phạm vi của bạn</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px]">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="px-3 py-1.5 text-left text-[9px] font-medium text-slate-500 uppercase whitespace-nowrap">Kho</th>
                        <th className="px-3 py-1.5 text-left text-[9px] font-medium text-slate-500 uppercase whitespace-nowrap">Loại hàng</th>
                        <th className="px-3 py-1.5 text-right text-[9px] font-medium text-slate-500 uppercase whitespace-nowrap">Pallet</th>
                        <th className="px-3 py-1.5 text-right text-[9px] font-medium text-slate-500 uppercase whitespace-nowrap" title={QTY_CONVERTED_TIP}>{QTY_CONVERTED_LABEL}</th>
                        <th className="px-3 py-1.5 text-right text-[9px] font-medium text-slate-500 uppercase whitespace-nowrap">Mã hàng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byWarehouse.map(w => (
                        w.cats.map((c, ci) => (
                          <tr key={`${w.warehouse_id}-${c.category}`} className={`border-b border-slate-700/60 hover:bg-white/5 ${ci === 0 ? '[&_td]:border-t [&_td]:border-t-slate-600' : ''}`}>
                            <td className="px-3 py-1.5 whitespace-nowrap">
                              {ci === 0 && (
                                <span className="flex items-center gap-1.5">
                                  <span className="text-[11px] font-semibold text-slate-100">{w.warehouse_name}</span>
                                  {w.inventory_mode && (
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${MODE_BADGE[w.inventory_mode] ?? 'bg-slate-700 text-slate-400'}`}>{w.inventory_mode}</span>
                                  )}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-[10px] text-slate-400 whitespace-nowrap">{c.category}</td>
                            <td className="px-3 py-1.5 text-[10px] text-right font-semibold tabular-nums whitespace-nowrap text-slate-100">{nf(c.pallets)}</td>
                            <td className="px-3 py-1.5 text-[10px] text-right font-semibold tabular-nums whitespace-nowrap text-slate-100">{nf(c.cartons)}</td>
                            <td className="px-3 py-1.5 text-[10px] text-right tabular-nums text-slate-500 whitespace-nowrap">{nf(c.materials)}</td>
                          </tr>
                        ))
                      ))}
                      <tr className="bg-slate-700/30 font-semibold">
                        <td className="px-3 py-2 text-[11px] text-slate-200" colSpan={2}>Tổng ({totals.warehouses} kho)</td>
                        <td className="px-3 py-2 text-[11px] text-right tabular-nums text-white">{nf(totals.pallets)}</td>
                        <td className="px-3 py-2 text-[11px] text-right tabular-nums text-white">{nf(totals.cartons)}</td>
                        <td className="px-3 py-2" />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          {/* Thao tác nhanh */}
          <div className="space-y-3">
            <Panel title="Thao tác nhanh" icon={Clock}>
              <div className="p-3 space-y-2">
                {[
                  { to: '/wms/inbound', icon: PackagePlus, cls: 'text-green-400', label: 'Nhập kho' },
                  { to: '/wms/outbound', icon: PackageMinus, cls: 'text-blue-400', label: 'Xuất kho' },
                  { to: '/wms/inventory', icon: Package, cls: 'text-slate-300', label: 'Xem tồn kho' },
                  { to: '/tms/bookings', icon: Truck, cls: 'text-amber-400', label: 'Kế hoạch vận chuyển' },
                ].map(({ to, icon: Icon, cls, label }) => (
                  <Link key={to} to={to}
                    className="flex items-center gap-2 w-full h-9 px-3 rounded-md border border-slate-600 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors">
                    <Icon className={`h-4 w-4 ${cls}`} />
                    {label}
                  </Link>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  )
}
