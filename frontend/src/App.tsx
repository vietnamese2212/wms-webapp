import { Routes, Route, Navigate } from 'react-router-dom'
import { Shell } from '@/components/layout/Shell'
import { useAuthStore } from '@/stores/authStore'
import { canAccess, type ModuleKey, type ModulePermissions } from '@/config/permissions'

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
import Vehicles from '@/pages/tms/Vehicles'
import Deliveries from '@/pages/tms/Deliveries'
import Schedule from '@/pages/hr/Schedule'
import UserManagement from '@/pages/masterdata/UserManagement'
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
  module: ModuleKey
  children: React.ReactNode
}) {
  const perms = useAuthStore((s) => s.user?.module_permissions as ModulePermissions | null ?? null)
  if (!canAccess(perms, module)) return <Navigate to="/" replace />
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

        {/* WMS — inventory (VIEWER+) */}
        <Route path="/wms/inventory" element={<Inventory />} />

        {/* WMS — inbound */}
        <Route path="/wms/inbound" element={<Inbound />} />
        <Route path="/wms/inbound/:id" element={<InboundDetail />} />

        {/* WMS — outbound */}
        <Route path="/wms/outbound" element={<Outbound />} />
        <Route path="/wms/outbound/scan-log" element={<OutboundScanLog />} />
        <Route path="/wms/outbound/:id" element={<OutboundDetail />} />
        <Route path="/wms/outbound/:gdoId/items/:itemId" element={<OutboundItemDetail />} />

        {/* WMS — loose picking */}
        <Route path="/wms/loosepicking" element={<LoosePicking />} />
        <Route path="/wms/loosepicking/:id" element={<LoosePickingDetail />} />
        <Route path="/wms/loosepicking/:gdoId/items/:itemId" element={<LoosePickingItemDetail />} />

        {/* WMS — locations */}
        <Route path="/wms/locations" element={<Locations />} />

        {/* WMS — stocktake */}
        <Route path="/wms/stocktake"         element={<Stocktake />} />
        <Route path="/wms/stocktake/summary" element={<StocktakeDashboard />} />

        {/* TMS */}
        <Route path="/tms/vehicles"   element={<Vehicles />} />
        <Route path="/tms/deliveries" element={<Deliveries />} />

        {/* HR */}
        <Route path="/hr/schedule" element={<Schedule />} />

        {/* Masterdata — chỉ có quyền employees */}
        <Route
          path="/masterdata/users"
          element={
            <PermissionRoute module="employees">
              <UserManagement />
            </PermissionRoute>
          }
        />

        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
