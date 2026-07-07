import { lazy, type ComponentType } from 'react'

// Nguồn DUY NHẤT cho code-splitting (React.lazy) + prefetch-on-hover.
// Mỗi dynamic import khai báo 1 lần, dùng cho cả 2 việc → không trùng/drift.
// Vite tách mỗi import thành 1 chunk riêng → bundle đầu nhỏ, chỉ tải trang đang vào.

// Sau mỗi lần deploy, hash chunk đổi — tab đang mở giữ index.html cũ, click module
// → tải chunk cũ đã bị xóa → 404 → lazy throw → MÀN HÌNH TRẮNG. Fix: reload 1 lần
// lấy index.html mới (sessionStorage + mốc thời gian chống vòng lặp reload).
function lazyRetry<T extends ComponentType<unknown>>(importer: () => Promise<{ default: T }>) {
  return lazy(() =>
    importer().catch((e: unknown) => {
      const KEY = 'chunk_reload_at'
      let last = 0
      try { last = Number(sessionStorage.getItem(KEY) ?? 0) } catch {}
      if (Date.now() - last > 30_000) {
        try { sessionStorage.setItem(KEY, String(Date.now())) } catch {}
        window.location.reload()
        return new Promise<{ default: T }>(() => {})   // treo tới khi trang reload
      }
      throw e   // reload rồi vẫn lỗi (mất mạng…) → để ErrorBoundary hiện nút Tải lại
    })
  )
}
const dashboard          = () => import('@/pages/Dashboard')
const inventory          = () => import('@/pages/wms/Inventory')
const inbound            = () => import('@/pages/wms/Inbound')
const inboundDetail      = () => import('@/pages/wms/InboundDetail')
const outbound           = () => import('@/pages/wms/Outbound')
const outboundDetail     = () => import('@/pages/wms/OutboundDetail')
const outboundItemDetail = () => import('@/pages/wms/OutboundItemDetail')
const outboundScanLog    = () => import('@/pages/wms/OutboundScanLog')
const outboundPrepare    = () => import('@/pages/wms/OutboundPrepare')
const loosePicking           = () => import('@/pages/wms/LoosePicking')
const loosePickingDetail     = () => import('@/pages/wms/LoosePickingDetail')
const loosePickingItemDetail = () => import('@/pages/wms/LoosePickingItemDetail')
const locations          = () => import('@/pages/wms/Locations')
const stocktake          = () => import('@/pages/wms/Stocktake')
const stocktakeDashboard = () => import('@/pages/wms/StocktakeDashboard')
const palletLabels       = () => import('@/pages/wms/PalletLabels')
const palletOps          = () => import('@/pages/wms/PalletOps')
const multiScanTest      = () => import('@/pages/wms/MultiScanTest')
const wmsSettings = () => import('@/pages/wms/WMSSettings')
const tmsSettings = () => import('@/pages/tms/TMSSettings')
const tmsBookings = () => import('@/pages/tms/TMSBookings')
const tmsReport   = () => import('@/pages/tms/TMSReport')
const gateRegistration = () => import('@/pages/tms/GateRegistration')
const leaveManagement = () => import('@/pages/hr/LeaveManagement')
const assignments = () => import('@/pages/hr/Assignments')
const attendance = () => import('@/pages/hr/Attendance')
const orgChart = () => import('@/pages/hr/OrgChart')
const userManagement = () => import('@/pages/masterdata/UserManagement')
const materials      = () => import('@/pages/masterdata/Materials')
const settings = () => import('@/pages/Settings')

export const Pages = {
  Dashboard: lazyRetry(dashboard),
  Inventory: lazyRetry(inventory),
  Inbound: lazyRetry(inbound),
  InboundDetail: lazyRetry(inboundDetail),
  Outbound: lazyRetry(outbound),
  OutboundDetail: lazyRetry(outboundDetail),
  OutboundItemDetail: lazyRetry(outboundItemDetail),
  OutboundScanLog: lazyRetry(outboundScanLog),
  OutboundPrepare: lazyRetry(outboundPrepare),
  LoosePicking: lazyRetry(loosePicking),
  LoosePickingDetail: lazyRetry(loosePickingDetail),
  LoosePickingItemDetail: lazyRetry(loosePickingItemDetail),
  Locations: lazyRetry(locations),
  Stocktake: lazyRetry(stocktake),
  StocktakeDashboard: lazyRetry(stocktakeDashboard),
  PalletLabels: lazyRetry(palletLabels),
  PalletOps: lazyRetry(palletOps),
  MultiScanTest: lazyRetry(multiScanTest),
  WMSSettings: lazyRetry(wmsSettings),
  TMSSettings: lazyRetry(tmsSettings),
  TMSBookings: lazyRetry(tmsBookings),
  TMSReport: lazyRetry(tmsReport),
  GateRegistration: lazyRetry(gateRegistration),
  LeaveManagement: lazyRetry(leaveManagement),
  Assignments: lazyRetry(assignments),
  Attendance: lazyRetry(attendance),
  OrgChart: lazyRetry(orgChart),
  UserManagement: lazyRetry(userManagement),
  Materials: lazyRetry(materials),
  Settings: lazyRetry(settings),
}

// path menu → importer (chỉ các trang có trong sidebar). Rê chuột vào menu →
// nạp sẵn chunk → bấm vào hiện tức thì (cảm giác Fiori). Trang detail không cần.
const prefetchMap: Record<string, () => Promise<unknown>> = {
  '/': dashboard,
  '/wms/inventory': inventory,
  '/wms/inbound': inbound,
  '/wms/pallet-labels': palletLabels,
  '/wms/pallet-ops': palletOps,
  '/wms/multi-scan': multiScanTest,
  '/wms/outbound': outbound,
  '/wms/outbound/scan-log': outboundScanLog,
  '/wms/loosepicking': loosePicking,
  '/wms/locations': locations,
  '/wms/stocktake': stocktake,
  '/wms/stocktake/summary': stocktakeDashboard,
  '/wms/settings': wmsSettings,
  '/tms/bookings': tmsBookings,
  '/tms/reports': tmsReport,
  '/tms/gate': gateRegistration,
  '/tms/settings': tmsSettings,
  '/hr/assignments': assignments,
  '/hr/attendance': attendance,
  '/hr/org': orgChart,
  '/masterdata/materials': materials,
  '/masterdata/users': userManagement,
  '/settings': settings,
}

const prefetched = new Set<string>()

export function prefetchPage(to: string) {
  if (prefetched.has(to)) return
  const importer = prefetchMap[to]
  if (!importer) return
  prefetched.add(to)
  importer().catch(() => prefetched.delete(to)) // lỗi mạng: cho thử lại lần sau
}
