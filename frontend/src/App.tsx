import { Routes, Route, Navigate } from 'react-router-dom'
import { Shell } from '@/components/layout/Shell'
import { useAuthStore } from '@/stores/authStore'
import { canAccess, canAccessAny, isAdmin, type ModuleKey, type ModulePermissions } from '@/config/permissions'

import Dashboard from '@/pages/Dashboard'
import Inventory from '@/pages/wms/Inventory'
import Inbound       from '@/pages/wms/Inbound'
import InboundDetail from '@/pages/wms/InboundDetail'
import Outbound           from '@/pages/wms/Outbound'
import OutboundDetail     from '@/pages/wms/OutboundDetail'
import OutboundItemDetail from '@/pages/wms/OutboundItemDetail'
import OutboundScanLog    from '@/pages/wms/OutboundScanLog'
import LoosePicking           from '@/pages/wms/LoosePicking'
import LoosePickingDetail     from '@/pages/wms/LoosePickingDetail'
import LoosePickingItemDetail from '@/pages/wms/LoosePickingItemDetail'
import Locations         from '@/pages/wms/Locations'
import Stocktake         from '@/pages/wms/Stocktake'
import StocktakeDashboard from '@/pages/wms/StocktakeDashboard'
import PalletLabels      from '@/pages/wms/PalletLabels'
import PalletOps         from '@/pages/wms/PalletOps'
import Deliveries from '@/pages/tms/Deliveries'
import WMSSettings from '@/pages/wms/WMSSettings'
import TMSSettings from '@/pages/tms/TMSSettings'
import TMSBookings from '@/pages/tms/TMSBookings'
import TMSReport   from '@/pages/tms/TMSReport'
import GateRegistration from '@/pages/tms/GateRegistration'
import Schedule from '@/pages/hr/Schedule'
import UserManagement from '@/pages/masterdata/UserManagement'
import Materials       from '@/pages/masterdata/Materials'
import Settings from '@/pages/Settings'
import Login from '@/pages/Login'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

function PermissionRoute({
  module,
  children,
}: {
  module: ModuleKey | ModuleKey[]
  children: React.ReactNode
}) {
  const user = useAuthStore((s) => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const allowed = isAdmin(user?.name) || (
    Array.isArray(module)
      ? canAccessAny(perms, ...module)
      : canAccess(perms, module)
  )
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
        <Route path="/wms/inbound-plan"    element={<Navigate to="/tms/bookings" replace />} />

        {/* WMS — outbound */}
        <Route path="/wms/outbound"                         element={<PermissionRoute module="outbound"><Outbound /></PermissionRoute>} />
        <Route path="/wms/outbound/scan-log"                element={<PermissionRoute module="scanlog"><OutboundScanLog /></PermissionRoute>} />
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

        {/* WMS — settings */}
        <Route path="/wms/settings" element={<PermissionRoute module="wms_settings"><WMSSettings /></PermissionRoute>} />

        <Route path="/wms/pallet-labels" element={<PermissionRoute module="pallet_print"><PalletLabels /></PermissionRoute>} />
        <Route path="/wms/pallet-ops" element={<PermissionRoute module="pallet_ops"><PalletOps /></PermissionRoute>} />

        {/* TMS */}
        <Route path="/tms/bookings"   element={<PermissionRoute module="tms_plan"><TMSBookings /></PermissionRoute>} />
        <Route path="/tms/reports"    element={<PermissionRoute module="tms_plan"><TMSReport /></PermissionRoute>} />
        <Route path="/tms/deliveries" element={<PermissionRoute module="deliveries"><Deliveries /></PermissionRoute>} />
        <Route path="/tms/settings"   element={<PermissionRoute module={['tms_vehicle_types', 'tms_slots', 'tms_companies', 'tms_vehicles']}><TMSSettings /></PermissionRoute>} />
        <Route path="/tms/gate"       element={<PermissionRoute module="gate_registration"><GateRegistration /></PermissionRoute>} />

        {/* HR */}
        <Route path="/hr/schedule" element={<PermissionRoute module="schedule"><Schedule /></PermissionRoute>} />

        {/* Masterdata */}
        <Route
          path="/masterdata/users"
          element={<PermissionRoute module="employees"><UserManagement /></PermissionRoute>}
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
