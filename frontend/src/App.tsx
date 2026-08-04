import { Routes, Route, Navigate } from 'react-router-dom'
import { Shell } from '@/components/layout/Shell'
import { useAuthStore } from '@/stores/authStore'
import { can, canAccess, canAccessAny, isAdmin, type ModuleKey, type ModulePermissions } from '@/config/permissions'
import { Pages } from '@/routes/lazyPages'

// Login giữ eager (màn đầu khi chưa đăng nhập). Mọi trang còn lại tách chunk
// theo route (code-splitting, xem routes/lazyPages.ts) → bundle đầu nhỏ.
import Login from '@/pages/Login'

const {
  Dashboard, Inventory, Inbound, InboundDetail,
  Outbound, OutboundDetail, OutboundItemDetail, OutboundScanLog, OutboundPrepare, WeighTickets, ControlTower,
  Slotting, SlottingPlanDetail, Forklift, FillPicking,
  LoosePicking, LoosePickingDetail, LoosePickingItemDetail,
  Locations, Stocktake, StocktakeDashboard, StocktakeHistory, PalletLabels, PalletOps, MultiScanTest,
  WMSSettings, TMSSettings, TMSBookings, TMSReport, GateRegistration,
  LeaveManagement, Assignments, Attendance, OrgChart,
  UserManagement, IntegrationKeys, Materials, ExternalData, Settings,
} = Pages

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

function PermissionRoute({
  module,
  action,
  adminOnly,
  children,
}: {
  module?: ModuleKey | ModuleKey[]
  action?: string   // nếu có: gate theo đúng action (vd outbound.prepare), không chỉ "có quyền nào trong module"
  adminOnly?: boolean   // chỉ superadmin (không mở theo module) — vd API key tích hợp
  children: React.ReactNode
}) {
  const user = useAuthStore((s) => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const admin = isAdmin(user?.name)
  const allowed = adminOnly
    ? admin
    : admin || (
      Array.isArray(module)
        ? canAccessAny(perms, ...module)
        : module
          ? (action ? can(perms, module, action) : canAccess(perms, module))
          : false
    )
  if (!allowed) return <Navigate to="/" replace />
  return <>{children}</>
}

// Trang "Dữ liệu bên ngoài" có 3 tab, tab "Cần xử lý" gate bằng outbound.reconcile —
// route phải nhận CẢ quyền đó (user chỉ có reconcile vẫn vào xử hàng chờ được).
function ExternalRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const allowed = isAdmin(user?.name)
    || canAccessAny(perms, 'external_do_sap', 'external_khvc')
    || can(perms, 'outbound', 'reconcile')
  if (!allowed) return <Navigate to="/" replace />
  return <>{children}</>
}


export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Shell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />

        {/* WMS — inventory */}
        <Route path="/wms/inventory" element={<PermissionRoute module="inventory"><Inventory /></PermissionRoute>} />

        {/* WMS — inbound */}
        <Route path="/wms/inbound"         element={<PermissionRoute module="inbound"><Inbound /></PermissionRoute>} />
        <Route path="/wms/inbound/:id"     element={<PermissionRoute module="inbound"><InboundDetail /></PermissionRoute>} />

        {/* WMS — outbound */}
        <Route path="/wms/outbound"                         element={<PermissionRoute module="outbound"><Outbound /></PermissionRoute>} />
        <Route path="/wms/outbound/prepare"                 element={<PermissionRoute module="outbound" action="prepare"><OutboundPrepare /></PermissionRoute>} />
        <Route path="/wms/outbound/scan-log"                element={<PermissionRoute module="scanlog"><OutboundScanLog /></PermissionRoute>} />
        <Route path="/wms/weigh-tickets"                    element={<PermissionRoute module="weigh_station"><WeighTickets /></PermissionRoute>} />
        <Route path="/wms/control-tower"                    element={<PermissionRoute module="control_tower"><ControlTower /></PermissionRoute>} />
        <Route path="/external/do-sap"                      element={<ExternalRoute><ExternalData /></ExternalRoute>} />
        <Route path="/external"                             element={<ExternalRoute><ExternalData /></ExternalRoute>} />
        <Route path="/wms/outbound/:id"                     element={<PermissionRoute module="outbound"><OutboundDetail /></PermissionRoute>} />
        <Route path="/wms/outbound/:gdoId/items/:itemId"    element={<PermissionRoute module="outbound"><OutboundItemDetail /></PermissionRoute>} />

        {/* WMS — loose picking */}
        <Route path="/wms/loosepicking"                          element={<PermissionRoute module="loosepicking"><LoosePicking /></PermissionRoute>} />
        <Route path="/wms/loosepicking/:id"                      element={<PermissionRoute module="loosepicking"><LoosePickingDetail /></PermissionRoute>} />
        <Route path="/wms/loosepicking/:gdoId/items/:itemId"     element={<PermissionRoute module="loosepicking"><LoosePickingItemDetail /></PermissionRoute>} />

        {/* WMS — locations */}
        <Route path="/wms/locations" element={<PermissionRoute module="locations"><Locations /></PermissionRoute>} />

        {/* WMS — stocktake */}
        <Route path="/wms/stocktake"         element={<PermissionRoute module="stocktake"><Stocktake /></PermissionRoute>} />
        <Route path="/wms/stocktake/summary" element={<PermissionRoute module="stocktake"><StocktakeDashboard /></PermissionRoute>} />
        <Route path="/wms/stocktake/history" element={<PermissionRoute module="stocktake"><StocktakeHistory /></PermissionRoute>} />

        {/* WMS — slotting (tối ưu vị trí) */}
        <Route path="/wms/slotting"           element={<PermissionRoute module="slotting"><Slotting /></PermissionRoute>} />
        <Route path="/wms/slotting/plans/:id" element={<PermissionRoute module="slotting"><SlottingPlanDetail /></PermissionRoute>} />

        {/* WMS — fill hàng phục vụ nhặt lẻ (hạ hàng từ tầng trên xuống vị trí nhặt lẻ) */}
        <Route path="/wms/fill" element={<PermissionRoute module="fill"><FillPicking /></PermissionRoute>} />

        {/* WMS — xe nâng (check list an toàn + giờ vận hành) */}
        <Route path="/wms/forklift" element={<PermissionRoute module="forklift"><Forklift /></PermissionRoute>} />

        {/* WMS — settings */}
        <Route path="/wms/settings" element={<PermissionRoute module="wms_settings"><WMSSettings /></PermissionRoute>} />

        <Route path="/wms/pallet-labels" element={<PermissionRoute module="pallet_print"><PalletLabels /></PermissionRoute>} />
        <Route path="/wms/pallet-ops" element={<PermissionRoute module="pallet_ops"><PalletOps /></PermissionRoute>} />

        {/* Trang test quét loạt QR — không ghi dữ liệu, chỉ đo tốc độ trên thiết bị thật */}
        <Route path="/wms/multi-scan" element={<MultiScanTest />} />

        {/* TMS */}
        <Route path="/tms/bookings"   element={<PermissionRoute module="tms_plan"><TMSBookings /></PermissionRoute>} />
        <Route path="/tms/reports"    element={<PermissionRoute module="tms_plan"><TMSReport /></PermissionRoute>} />
        <Route path="/tms/settings"   element={<PermissionRoute module={['tms_vehicle_types', 'tms_slots', 'tms_companies', 'tms_vehicles']}><TMSSettings /></PermissionRoute>} />
        <Route path="/tms/gate"       element={<PermissionRoute module="gate_registration"><GateRegistration /></PermissionRoute>} />

        {/* HR */}
        <Route path="/hr/leaves"   element={<PermissionRoute module="leave"><LeaveManagement /></PermissionRoute>} />
        <Route path="/hr/assignments" element={<PermissionRoute module="work_assignment"><Assignments /></PermissionRoute>} />
        <Route path="/hr/attendance" element={<PermissionRoute module="attendance"><Attendance /></PermissionRoute>} />
        <Route path="/hr/org" element={<PermissionRoute module="employees"><OrgChart /></PermissionRoute>} />

        {/* Masterdata */}
        <Route
          path="/masterdata/users"
          element={<PermissionRoute module="user_admin"><UserManagement /></PermissionRoute>}
        />
        <Route
          path="/masterdata/integration-keys"
          element={<PermissionRoute adminOnly><IntegrationKeys /></PermissionRoute>}
        />
        <Route
          path="/masterdata/materials"
          element={<PermissionRoute module="materials"><Materials /></PermissionRoute>}
        />

        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
