import { Routes, Route, Navigate } from 'react-router-dom'
import { Shell } from '@/components/layout/Shell'
import { useAuthStore } from '@/stores/authStore'
import { can, canAccess, canAccessAny, isAdmin, type ModuleKey, type ModulePermissions } from '@/config/permissions'
import { Pages } from '@/routes/lazyPages'

// Login giá»¯ eager (mÃ n Ä‘áº§u khi chÆ°a Ä‘Äƒng nháº­p). Má»i trang cÃ²n láº¡i tÃ¡ch chunk
// theo route (code-splitting, xem routes/lazyPages.ts) â†’ bundle Ä‘áº§u nhá».
import Login from '@/pages/Login'

const {
  Dashboard, Inventory, Inbound, InboundDetail,
  Outbound, OutboundDetail, OutboundItemDetail, OutboundScanLog, OutboundPrepare, WeighTickets, ControlTower, Alerts,
  Slotting, SlottingPlanDetail, Forklift, Packing, FillPicking, FillOrderDetail,
  LoosePicking, LoosePickingDetail, LoosePickingItemDetail,
  Locations, Stocktake, StocktakeDashboard, StocktakeHistory, StocktakeCycle, PalletLabels, PalletOps, MultiScanTest,
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
  action?: string   // náº¿u cÃ³: gate theo Ä‘Ãºng action (vd outbound.prepare), khÃ´ng chá»‰ "cÃ³ quyá»n nÃ o trong module"
  adminOnly?: boolean   // chá»‰ superadmin (khÃ´ng má»Ÿ theo module) â€” vd API key tÃ­ch há»£p
  children: React.ReactNode
}) {
  const user = useAuthStore((s) => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const admin = isAdmin(user)
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

// Trang "Dá»¯ liá»‡u bÃªn ngoÃ i" cÃ³ 3 tab, tab "Cáº§n xá»­ lÃ½" gate báº±ng outbound.reconcile â€”
// route pháº£i nháº­n Cáº¢ quyá»n Ä‘Ã³ (user chá»‰ cÃ³ reconcile váº«n vÃ o xá»­ hÃ ng chá» Ä‘Æ°á»£c).
function ExternalRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const allowed = isAdmin(user)
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

        {/* WMS â€” inventory */}
        <Route path="/wms/inventory" element={<PermissionRoute module="inventory"><Inventory /></PermissionRoute>} />

        {/* WMS â€” inbound */}
        <Route path="/wms/inbound"         element={<PermissionRoute module="inbound"><Inbound /></PermissionRoute>} />
        <Route path="/wms/inbound/:id"     element={<PermissionRoute module="inbound"><InboundDetail /></PermissionRoute>} />

        {/* WMS â€” outbound */}
        <Route path="/wms/outbound"                         element={<PermissionRoute module="outbound"><Outbound /></PermissionRoute>} />
        <Route path="/wms/outbound/prepare"                 element={<PermissionRoute module="outbound" action="prepare"><OutboundPrepare /></PermissionRoute>} />
        <Route path="/wms/outbound/scan-log"                element={<PermissionRoute module="scanlog"><OutboundScanLog /></PermissionRoute>} />
        <Route path="/wms/weigh-tickets"                    element={<PermissionRoute module="weigh_station"><WeighTickets /></PermissionRoute>} />
        <Route path="/wms/control-tower"                    element={<PermissionRoute module="control_tower"><ControlTower /></PermissionRoute>} />
        {/* Trang thÃ´ng bÃ¡o má»Ÿ cho Má»ŒI user (tab CÃ¡ nhÃ¢n = feed cá»§a mÃ¬nh); tab Chung tá»± áº©n khi thiáº¿u alerts.view */}
        <Route path="/wms/alerts"                           element={<Alerts />} />
        <Route path="/external/do-sap"                      element={<ExternalRoute><ExternalData /></ExternalRoute>} />
        <Route path="/external"                             element={<ExternalRoute><ExternalData /></ExternalRoute>} />
        <Route path="/wms/outbound/:id"                     element={<PermissionRoute module="outbound"><OutboundDetail /></PermissionRoute>} />
        <Route path="/wms/outbound/:gdoId/items/:itemId"    element={<PermissionRoute module="outbound"><OutboundItemDetail /></PermissionRoute>} />

        {/* WMS â€” loose picking */}
        <Route path="/wms/loosepicking"                          element={<PermissionRoute module="loosepicking"><LoosePicking /></PermissionRoute>} />
        <Route path="/wms/loosepicking/:id"                      element={<PermissionRoute module="loosepicking"><LoosePickingDetail /></PermissionRoute>} />
        <Route path="/wms/loosepicking/:gdoId/items/:itemId"     element={<PermissionRoute module="loosepicking"><LoosePickingItemDetail /></PermissionRoute>} />

        {/* WMS â€” locations */}
        <Route path="/wms/locations" element={<PermissionRoute module="locations"><Locations /></PermissionRoute>} />

        {/* WMS â€” stocktake */}
        <Route path="/wms/stocktake"         element={<PermissionRoute module="stocktake"><Stocktake /></PermissionRoute>} />
        <Route path="/wms/stocktake/summary" element={<PermissionRoute module="stocktake"><StocktakeDashboard /></PermissionRoute>} />
        <Route path="/wms/stocktake/history" element={<PermissionRoute module="stocktake"><StocktakeHistory /></PermissionRoute>} />
        <Route path="/wms/stocktake/cycle" element={<PermissionRoute module="stocktake"><StocktakeCycle /></PermissionRoute>} />

        {/* WMS â€” slotting (tá»‘i Æ°u vá»‹ trÃ­) */}
        <Route path="/wms/slotting"           element={<PermissionRoute module="slotting"><Slotting /></PermissionRoute>} />
        <Route path="/wms/slotting/plans/:id" element={<PermissionRoute module="slotting"><SlottingPlanDetail /></PermissionRoute>} />

        {/* WMS â€” fill hÃ ng phá»¥c vá»¥ nháº·t láº» (háº¡ hÃ ng tá»« táº§ng trÃªn xuá»‘ng vá»‹ trÃ­ nháº·t láº») */}
        <Route path="/wms/fill" element={<PermissionRoute module="fill"><FillPicking /></PermissionRoute>} />
        <Route path="/wms/fill/orders/:id" element={<PermissionRoute module="fill"><FillOrderDetail /></PermissionRoute>} />

        {/* WMS â€” xe nÃ¢ng (check list an toÃ n + giá» váº­n hÃ nh) */}
        <Route path="/wms/forklift" element={<PermissionRoute module="forklift"><Forklift /></PermissionRoute>} />

        {/* WMS â€” sá»• Ä‘Ã³ng gÃ³i Ä‘iá»‡n tá»­ táº¡i xÆ°á»Ÿng (quÃ©t tem + chá»¥p date thÃ¹ng) */}
        <Route path="/wms/packing" element={<PermissionRoute module="packing"><Packing /></PermissionRoute>} />

        {/* WMS â€” settings */}
        <Route path="/wms/settings" element={<PermissionRoute module="wms_settings"><WMSSettings /></PermissionRoute>} />

        <Route path="/wms/pallet-labels" element={<PermissionRoute module="pallet_print"><PalletLabels /></PermissionRoute>} />
        <Route path="/wms/pallet-ops" element={<PermissionRoute module="pallet_ops"><PalletOps /></PermissionRoute>} />

        {/* Trang test quÃ©t loáº¡t QR â€” khÃ´ng ghi dá»¯ liá»‡u, chá»‰ Ä‘o tá»‘c Ä‘á»™ trÃªn thiáº¿t bá»‹ tháº­t */}
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
