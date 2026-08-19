import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Package, PackagePlus, PackageMinus, Boxes, Layers, Warehouse, Clock, Truck, Grid3X3,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatsCard } from '@/components/shared/StatsCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
  QR:       'bg-green-100 text-green-700',
  QTY:      'bg-blue-100 text-blue-700',
  QTY_DATE: 'bg-indigo-100 text-indigo-700',
  NONE:     'bg-slate-100 text-slate-500',
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
  // (chọn "Tất cả kho" với hàng trăm kho NPP thì kho căng chỗ phải nổi lên trước).
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

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Tổng quan hệ thống"
        description={today}
        actions={
          <div className="flex items-center gap-2.5">
            <WarehouseSingleSelect
              warehouses={scopedWhs as { id: string; code?: string; name: string }[]}
              value={effWhId}
              onChange={id => setDashboard({ warehouseId: id })}
              allLabel="Tất cả kho"
              triggerClassName="w-40 sm:w-48"
            />
            <div className="hidden sm:flex items-center gap-1.5">
              <div className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-muted-foreground">Dữ liệu thời gian thực</span>
            </div>
          </div>
        }
      />

      {/* Cuộn BÊN TRONG (fit màn hình như các module chuẩn) — header trang đứng yên */}
      <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-6 space-y-5">
        {isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            Không tải được số liệu dashboard — thử tải lại trang.
          </div>
        )}

        {/* KPI tồn kho (data thật) — 1 cột trên phone hẹp để số dài không bị cắt */}
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)
          ) : (
            <>
              {/* PALLET = số CHỦ ĐẠO (user chốt 30/07): đơn vị vật lý duy nhất so được giữa mọi
                  loại hàng (thùng TP / cái POSM / kg NVL). Số theo đơn vị riêng nằm ở card bên. */}
              <StatsCard title="Pallet tồn" value={nf0(totals.pallets)} icon={Layers} iconColor="text-indigo-600" />
              {/* Tồn TÁCH THEO ĐƠN VỊ — thay ô "Tồn (quy đổi)" trộn 6 đơn vị làm một (133tr mà
                  131tr là CÁI). RPC cũ chưa có by_unit → fallback ô quy đổi như trước. */}
              {(stats?.by_unit?.length ?? 0) > 0 ? (
                <Card>
                  <CardContent className="p-4 sm:p-5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                      <Boxes className="h-3.5 w-3.5 text-sky-600" />Tồn theo đơn vị
                    </p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                      {stats!.by_unit!.map(u => (
                        <div key={u.unit} className="flex items-baseline justify-between gap-1.5 min-w-0" title={`${nf(u.qty)} ${unitLabel(u.unit)} · ${nf(u.pallets)} pallet · ${nf(u.materials)} mã`}>
                          <span className="text-[10px] text-muted-foreground truncate">{unitLabel(u.unit)}</span>
                          <span className="text-[11px] font-bold tabular-nums">{nf0(u.qty)}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <StatsCard title="Tồn (quy đổi)" value={nf0(totals.cartons)} icon={Boxes} iconColor="text-sky-600" />
              )}
              <StatsCard title="Kho có tồn" value={totals.warehouses} icon={Warehouse} iconColor="text-amber-600" />
              <StatsCard title="Xuất hôm nay" value={nf0(t?.outbound_scanned ?? 0)} unit={t?.outbound_planned ? `/ ${nf0(t.outbound_planned)} KH` : 'SL quy đổi'} icon={PackageMinus} iconColor="text-blue-600" />
            </>
          )}
        </div>

        {/* Hoạt động hôm nay */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[
            { icon: PackagePlus, color: 'text-green-600 bg-green-100', value: t?.inbound_orders, label: 'Phiếu nhập hôm nay' },
            { icon: Package, color: 'text-emerald-600 bg-emerald-100', value: t?.inbound_cartons, label: 'SL nhập (quy đổi)' },
            { icon: Truck, color: 'text-blue-600 bg-blue-100', value: t?.outbound_gdos, label: 'Chuyến xuất hôm nay' },
            { icon: PackageMinus, color: 'text-sky-600 bg-sky-100', value: t?.outbound_planned, label: 'SL KH xuất (quy đổi)' },
          ].map(({ icon: Icon, color, value, label }) => (
            <Card key={label}>
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${color.split(' ')[1]}`}>
                    <Icon className={`h-5 w-5 ${color.split(' ')[0]}`} />
                  </div>
                  <div className="min-w-0">
                    {/* Số 8+ chữ số (vd 15.385.846 sau bê tồn) bị truncate thành "15.385.8…" → đọc SAI
                        cấp nghìn/triệu. Co cỡ chữ theo độ dài thay vì cắt cụt; tooltip = số đầy đủ. */}
                    {isLoading
                      ? <Skeleton className="h-7 w-16 mb-1" />
                      : (() => { const s = nf(Number(value ?? 0)); return (
                          <p className={`${s.length >= 10 ? 'text-base' : s.length >= 8 ? 'text-xl' : 'text-2xl'} font-bold tabular-nums`} title={s}>{s}</p>
                        ) })()}
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Sức chứa khu vực kho: pallet đang chiếm chỗ / pallet tối đa (Σ max_pallets vị trí) */}
        {(isLoading || zonesByWh.length > 0) && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Grid3X3 className="h-4 w-4 text-muted-foreground" />
                Sức chứa khu vực kho
                <span className="text-[10px] font-normal text-slate-400">pallet tồn / pallet tối đa</span>
              </CardTitle>
            </CardHeader>
            {/* Dạng DÒNG dày đặc kiểu bảng (user 19/08 chê card-per-khu rối + bar dài + trống):
                kho = header nhóm kèm TỔNG, mỗi khu = 1 dòng mảnh [tên · bar ngắn · số/max · %];
                "còn N chỗ" chuyển vào tooltip. 2 cột kho song song trên màn rộng. */}
            <CardContent className="pt-0">
              {isLoading ? (
                <div className="space-y-1.5">
                  {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-6 rounded" />)}
                </div>
              ) : (
                /* Cột auto-fill theo bề rộng THẬT (380-500px/cột) — cột không giãn hết card
                   tạo khoảng chết giữa tên và bar (user 19/08); trăm kho tự dàn lưới nhiều cột */
                <div className="grid grid-cols-1 lg:grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-x-8 gap-y-3">
                  {visibleWhGroups.map(g => {
                    const tUsed = g.used, tCap = g.cap
                    return (
                      <div key={g.warehouse_name} className="self-start">
                        <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 pb-1">
                          <p className="text-[11px] font-semibold text-slate-700 truncate">{g.warehouse_name}</p>
                          <p className="shrink-0 text-[10px] tabular-nums text-slate-400">
                            {nf(tUsed)} / {tCap > 0 ? nf(tCap) : '—'}
                          </p>
                        </div>
                        {g.zones.map(z => {
                          const pct = z.capacity > 0 ? (z.used / z.capacity) * 100 : null
                          const barColor = pct == null ? 'bg-slate-300'
                            : pct >= 100 ? 'bg-red-500'
                            : pct >= 80 ? 'bg-amber-500'
                            : 'bg-sky-500'
                          // chưa đầy thật thì không làm tròn lên "100%" (99.6% → 99%)
                          const pctTxt = pct == null ? null
                            : pct >= 100 ? Math.round(pct) : pct >= 10 ? Math.min(99, Math.round(pct)) : Math.round(pct * 10) / 10
                          return (
                            <div key={z.zone_id} className="flex items-center gap-2 py-[3px] border-b border-slate-100 last:border-0"
                              title={`${z.name} (${z.code})${z.category ? ` · ${z.category}` : ''} — ${pct == null
                                ? 'chưa khai pallet tối đa'
                                : `${pctTxt}% đã dùng · còn ${nf(Math.max(0, z.capacity - z.used))} chỗ`}`}>
                              <p className="flex-1 min-w-0 truncate text-[11px] text-slate-700">
                                {z.name}<span className="ml-1 text-[9px] text-slate-400">{z.code}</span>
                              </p>
                              {/* Mobile ẩn bar — nhường chỗ cho TÊN khu (360px tên bị cắt thành "Kho …") */}
                              <div className="hidden sm:block w-24 shrink-0 h-1.5 overflow-hidden rounded-full bg-slate-100">
                                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct == null ? 0 : Math.min(100, pct)}%` }} />
                              </div>
                              <p className="w-[84px] sm:w-[92px] shrink-0 text-right text-[10px] font-medium tabular-nums text-slate-600">
                                {nf(z.used)}<span className="font-normal text-slate-400"> / {z.capacity > 0 ? nf(z.capacity) : '—'}</span>
                              </p>
                              <p className={`w-10 shrink-0 text-right text-[10px] font-semibold tabular-nums ${pct == null ? 'text-slate-300'
                                : pct >= 100 ? 'text-red-600' : pct >= 80 ? 'text-amber-600' : 'text-slate-500'}`}>
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
                  className="mt-2 w-full rounded-md border border-slate-200 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-50">
                  {showAllWh ? 'Thu gọn' : `Hiện tất cả ${zonesByWh.length} kho (đang hiện ${WH_SHOW_CAP} kho căng chỗ nhất)`}
                </button>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Bảng tồn theo kho */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="flex items-center gap-2">
                  <Warehouse className="h-4 w-4 text-muted-foreground" />
                  Tồn kho theo kho
                </CardTitle>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/wms/inventory" className="text-xs">Xem chi tiết →</Link>
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="p-4 space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9" />)}
                  </div>
                ) : byWarehouse.length === 0 ? (
                  <p className="px-4 pb-4 text-sm text-slate-400">Chưa có tồn kho trong phạm vi của bạn</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px]">
                      <thead>
                        <tr className="border-y bg-slate-50">
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
                            <tr key={`${w.warehouse_id}-${c.category}`} className={`border-b border-slate-100 hover:bg-slate-50 ${ci === 0 ? '[&_td]:border-t [&_td]:border-t-slate-200' : ''}`}>
                              <td className="px-3 py-1.5 whitespace-nowrap">
                                {ci === 0 && (
                                  <span className="flex items-center gap-1.5">
                                    <span className="text-[11px] font-semibold text-slate-700">{w.warehouse_name}</span>
                                    {w.inventory_mode && (
                                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${MODE_BADGE[w.inventory_mode] ?? 'bg-slate-100 text-slate-500'}`}>{w.inventory_mode}</span>
                                    )}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-[10px] text-slate-600 whitespace-nowrap">{c.category}</td>
                              <td className="px-3 py-1.5 text-[10px] text-right font-semibold tabular-nums whitespace-nowrap">{nf(c.pallets)}</td>
                              <td className="px-3 py-1.5 text-[10px] text-right font-semibold tabular-nums whitespace-nowrap">{nf(c.cartons)}</td>
                              <td className="px-3 py-1.5 text-[10px] text-right tabular-nums text-slate-500 whitespace-nowrap">{nf(c.materials)}</td>
                            </tr>
                          ))
                        ))}
                        <tr className="bg-slate-50 font-semibold">
                          <td className="px-3 py-2 text-[11px] text-slate-700" colSpan={2}>Tổng ({totals.warehouses} kho)</td>
                          <td className="px-3 py-2 text-[11px] text-right tabular-nums">{nf(totals.pallets)}</td>
                          <td className="px-3 py-2 text-[11px] text-right tabular-nums">{nf(totals.cartons)}</td>
                          <td className="px-3 py-2" />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Thao tác nhanh */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  Thao tác nhanh
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="w-full justify-start gap-2 h-9" asChild>
                  <Link to="/wms/inbound">
                    <PackagePlus className="h-4 w-4 text-green-600" />
                    Nhập kho
                  </Link>
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2 h-9" asChild>
                  <Link to="/wms/outbound">
                    <PackageMinus className="h-4 w-4 text-blue-600" />
                    Xuất kho
                  </Link>
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2 h-9" asChild>
                  <Link to="/wms/inventory">
                    <Package className="h-4 w-4 text-slate-600" />
                    Xem tồn kho
                  </Link>
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2 h-9" asChild>
                  <Link to="/tms/bookings">
                    <Truck className="h-4 w-4 text-amber-600" />
                    Kế hoạch vận chuyển
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
