import { Routes, Route, Navigate } from 'react-router-dom'
import { Shell } from '@/components/layout/Shell'
import { useAuthStore } from '@/stores/authStore'
import { canAccess, isAdmin, type ModuleKey, type ModulePermissions } from '@/config/permissions'

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
  const user = useAuthStore((s) => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  if (!isAdmin(user?.name) && !canAccess(perms, module)) return <Navigate to="/" replace />
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
        <Route path="/wms/inbound"    element={<PermissionRoute module="inbound"><Inbound /></PermissionRoute>} />
        <Route path="/wms/inbound/:id" element={<PermissionRoute module="inbound"><InboundDetail /></PermissionRoute>} />

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

        {/* TMS */}
        <Route path="/tms/vehicles"   element={<PermissionRoute module="vehicles"><Vehicles /></PermissionRoute>} />
        <Route path="/tms/deliveries" element={<PermissionRoute module="deliveries"><Deliveries /></PermissionRoute>} />

        {/* HR */}
        <Route path="/hr/schedule" element={<PermissionRoute module="schedule"><Schedule /></PermissionRoute>} />

        {/* Masterdata — chỉ chức danh có quyền employees mới được vào */}
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
