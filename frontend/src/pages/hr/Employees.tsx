import { useState } from 'react'
import { Plus, Users, Phone, Mail } from 'lucide-react'
import { SearchInput } from '@/components/shared/SearchInput'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmployeeStatusBadge } from '@/components/shared/StatusBadge'
import { CardsSkeleton } from '@/components/shared/TableSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useEmployees } from '@/api/hooks'
import { roleLabel, formatDate } from '@/utils/formatters'

export default function Employees() {
  const { data: employees, isLoading } = useEmployees()
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('ALL')

  const departments = [...new Set(employees?.map((e) => e.department) ?? [])]

  const filtered = employees?.filter((e) => {
    const matchSearch =
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.employeeCode.toLowerCase().includes(search.toLowerCase()) ||
      e.phone.includes(search)
    const matchDept = deptFilter === 'ALL' || e.department === deptFilter
    return matchSearch && matchDept
  }) ?? []

  const counts = {
    total: employees?.length ?? 0,
    active: employees?.filter((e) => e.status === 'ACTIVE').length ?? 0,
    onLeave: employees?.filter((e) => e.status === 'ON_LEAVE').length ?? 0,
    inactive: employees?.filter((e) => e.status === 'INACTIVE').length ?? 0,
  }

  return (
    <div>
      <PageHeader
        title="Nhân viên"
        description="Quản lý danh sách nhân viên và thông tin cá nhân"
        actions={
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Thêm nhân viên
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-6 pb-0">
        {[
          { label: 'Tổng nhân viên', value: counts.total },
          { label: 'Đang làm việc', value: counts.active, color: 'text-green-600' },
          { label: 'Đang nghỉ phép', value: counts.onLeave, color: 'text-amber-600' },
          { label: 'Nghỉ việc', value: counts.inactive, color: 'text-slate-500' },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color ?? ''}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="p-6 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Tìm tên, mã NV, SĐT..." className="flex-1 max-w-sm" />
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Phòng ban" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tất cả phòng ban</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <CardsSkeleton count={6} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Users} title="Không tìm thấy nhân viên" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((emp) => {
              const initials = emp.name.split(' ').slice(-2).map((n) => n[0]).join('').toUpperCase()
              return (
                <Card key={emp.id} className="overflow-hidden">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3">
                      <Avatar className="h-12 w-12">
                        <AvatarFallback className="text-sm">{initials}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-semibold text-sm">{emp.name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{emp.employeeCode}</p>
                          </div>
                          <EmployeeStatusBadge status={emp.status} />
                        </div>
                        <p className="text-xs text-primary mt-1">{roleLabel[emp.role]}</p>
                        <p className="text-xs text-muted-foreground">{emp.department}</p>
                      </div>
                    </div>

                    <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        <span>{emp.phone}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{emp.email}</span>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        Vào làm: {formatDate(emp.joinDate)}
                      </span>
                      <Button variant="ghost" size="sm" className="h-7 text-xs">Xem hồ sơ</Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
