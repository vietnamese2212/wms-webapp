import { Routes, Route, Navigate } from 'react-router-dom'
import { Shell } from '@/components/layout/Shell'
import { useAuthStore } from '@/stores/authStore'

import Dashboard from '@/pages/Dashboard'
import Inventory from '@/pages/wms/Inventory'
import Inbound       from '@/pages/wms/Inbound'
import InboundDetail from '@/pages/wms/InboundDetail'
import Outbound from '@/pages/wms/Outbound'
import Locations from '@/pages/wms/Locations'
import Vehicles from '@/pages/tms/Vehicles'
import Deliveries from '@/pages/tms/Deliveries'
import Employees from '@/pages/hr/Employees'
import Schedule from '@/pages/hr/Schedule'
import UserManagement from '@/pages/masterdata/UserManagement'
import Settings from '@/pages/Settings'
import Login from '@/pages/Login'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
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
        <Route path="/wms/inventory" element={<Inventory />} />
        <Route path="/wms/inbound" element={<Inbound />} />
        <Route path="/wms/inbound/:id" element={<InboundDetail />} />
        <Route path="/wms/outbound" element={<Outbound />} />
        <Route path="/wms/locations" element={<Locations />} />
        <Route path="/tms/vehicles" element={<Vehicles />} />
        <Route path="/tms/deliveries" element={<Deliveries />} />
        <Route path="/hr/employees" element={<Employees />} />
        <Route path="/hr/schedule" element={<Schedule />} />
        <Route path="/masterdata/users" element={<UserManagement />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
