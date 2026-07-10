import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Package, PackagePlus, PackageMinus, Boxes, Layers, Warehouse, Clock, Truck,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatsCard } from '@/components/shared/StatsCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useDashboardStats } from '@/api/hooks'

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
  const { data: stats, isLoading, isError } = useDashboardStats()
  const today = new Date().toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

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
    const list = [...map.values()].sort((a, b) => b.cartons - a.cartons)
    return { byWarehouse: list, totals: { pallets, cartons, warehouses: list.length } }
  }, [stats])

  const t = stats?.today

  return (
    <div className="space-y-0">
      <PageHeader
        title="Tổng quan hệ thống"
        description={today}
        actions={
          <div className="flex items-center gap-1.5">
            <div className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-muted-foreground">Dữ liệu thời gian thực</span>
          </div>
        }
      />

      <div className="p-4 sm:p-6 space-y-5">
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
              <StatsCard title="Tồn (thùng)" value={nf0(totals.cartons)} icon={Boxes} iconColor="text-sky-600" />
              <StatsCard title="Pallet tồn" value={nf0(totals.pallets)} icon={Layers} iconColor="text-indigo-600" />
              <StatsCard title="Kho có tồn" value={totals.warehouses} icon={Warehouse} iconColor="text-amber-600" />
              <StatsCard title="Xuất hôm nay" value={nf0(t?.outbound_scanned ?? 0)} unit={t?.outbound_planned ? `/ ${nf0(t.outbound_planned)} KH` : 'thùng'} icon={PackageMinus} iconColor="text-blue-600" />
            </>
          )}
        </div>

        {/* Hoạt động hôm nay */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[
            { icon: PackagePlus, color: 'text-green-600 bg-green-100', value: t?.inbound_orders, label: 'Phiếu nhập hôm nay' },
            { icon: Package, color: 'text-emerald-600 bg-emerald-100', value: t?.inbound_cartons, label: 'Thùng nhập hôm nay' },
            { icon: Truck, color: 'text-blue-600 bg-blue-100', value: t?.outbound_gdos, label: 'Chuyến xuất hôm nay' },
            { icon: PackageMinus, color: 'text-sky-600 bg-sky-100', value: t?.outbound_planned, label: 'Thùng KH xuất hôm nay' },
          ].map(({ icon: Icon, color, value, label }) => (
            <Card key={label}>
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${color.split(' ')[1]}`}>
                    <Icon className={`h-5 w-5 ${color.split(' ')[0]}`} />
                  </div>
                  <div className="min-w-0">
                    {isLoading
                      ? <Skeleton className="h-7 w-16 mb-1" />
                      : <p className="text-2xl font-bold tabular-nums truncate">{nf(Number(value ?? 0))}</p>}
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

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
                          <th className="px-3 py-1.5 text-right text-[9px] font-medium text-slate-500 uppercase whitespace-nowrap">Thùng</th>
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
