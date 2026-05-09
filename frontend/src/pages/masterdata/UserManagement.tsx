import { useState, useEffect } from 'react'
import type { AxiosError } from 'axios'
import { Plus, Search, Pencil, ShieldCheck, Building2, User2 } from 'lucide-react'
import { Button }   from '@/components/ui/button'
import { Input }    from '@/components/ui/input'
import { Label }    from '@/components/ui/label'
import { Card }     from '@/components/ui/card'
import { Badge }    from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  useDepartments, useJobTitles, useEmployeeRecords,
  useCreateEmployee, useUpdateEmployee, useWarehouses,
} from '@/api/hooks'
import type { EmployeeRecord, ActionLevel, Category } from '@/types'

// ─── Config ───────────────────────────────────────────────────────────────────

const ACTION_LEVEL_LABEL: Record<ActionLevel, string> = {
  NATIONAL_MANAGER: 'QL toàn quốc',
  SITE_MANAGER:     'QL site',
  SUPERVISOR:       'Giám sát',
  OPERATOR:         'Thủ kho',
  STAFF:            'Nhân viên',
  VIEWER:           'Xem',
}
const ACTION_LEVEL_COLOR: Record<ActionLevel, string> = {
  NATIONAL_MANAGER: 'bg-blue-100 text-blue-800',
  SITE_MANAGER:     'bg-indigo-100 text-indigo-800',
  SUPERVISOR:       'bg-amber-100 text-amber-800',
  OPERATOR:         'bg-green-100 text-green-800',
  STAFF:            'bg-slate-100 text-slate-700',
  VIEWER:           'bg-slate-50 text-slate-500',
}
const CATEGORY_COLOR: Record<Category, string> = {
  TP:     'bg-emerald-100 text-emerald-700',
  NVL:    'bg-blue-100 text-blue-700',
  POSM:   'bg-orange-100 text-orange-700',
  BAO_BI: 'bg-slate-100 text-slate-600',
}
const ALL_CATEGORIES: Category[] = ['TP', 'NVL', 'POSM', 'BAO_BI']

// ─── Employee form dialog ─────────────────────────────────────────────────────

interface EmpFormProps {
  emp: EmployeeRecord | null   // null = create
  open: boolean
  onClose: () => void
}

function EmployeeFormDialog({ emp, open, onClose }: EmpFormProps) {
  const isEdit = !!emp

  const { data: departments = [] } = useDepartments()
  const [deptId, setDeptId]   = useState(emp?.department_id ?? '')
  const { data: jobTitles = [] } = useJobTitles(deptId || undefined)
  const { data: warehouses = [] } = useWarehouses()

  const [name,          setName]          = useState(emp?.name          ?? '')
  const [empCode,       setEmpCode]       = useState(emp?.employee_code ?? '')
  const [email,         setEmail]         = useState(emp?.email         ?? '')
  const [phone,         setPhone]         = useState(emp?.phone         ?? '')
  const [jobTitleId,    setJobTitleId]    = useState(emp?.job_title_id  ?? '')
  const [actionLevel,   setActionLevel]   = useState<ActionLevel>(emp?.action_level ?? 'STAFF')
  const [categories,    setCategories]    = useState<Category[]>(emp?.allowed_categories ?? [])
  const [scope,         setScope]         = useState<'NATIONAL'|'ASSIGNED'>(emp?.warehouse_scope ?? 'ASSIGNED')
  const [warehouseIds,  setWarehouseIds]  = useState<string[]>(
    emp?.warehouse_access?.map(w => w.warehouse_id) ?? []
  )
  const [isActive, setIsActive] = useState(emp?.is_active ?? true)

  // Khi chọn JobTitle → auto-fill các trường permission
  useEffect(() => {
    if (!jobTitleId) return
    const jt = jobTitles.find(j => j.id === jobTitleId)
    if (jt) {
      setActionLevel(jt.action_level)
      setCategories(jt.allowed_categories)
      setScope(jt.warehouse_scope)
    }
  }, [jobTitleId, jobTitles])

  // Reset khi đổi department
  useEffect(() => { setJobTitleId('') }, [deptId])

  const { mutate: create, isPending: creating, error: createErr } = useCreateEmployee()
  const { mutate: update, isPending: updating, error: updateErr } = useUpdateEmployee()
  const isPending = creating || updating

  const apiError = ((createErr ?? updateErr) as AxiosError<{ error: { message: string } }>)
    ?.response?.data?.error?.message

  function toggleCategory(cat: Category) {
    setCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat])
  }

  function toggleWarehouse(wid: string) {
    setWarehouseIds(prev => prev.includes(wid) ? prev.filter(w => w !== wid) : [...prev, wid])
  }

  function handleSubmit() {
    const payload = {
      name, employee_code: empCode,
      email: email || undefined, phone: phone || undefined,
      department_id: deptId || undefined,
      job_title_id: jobTitleId || undefined,
      action_level: actionLevel,
      allowed_categories: categories,
      warehouse_scope: scope,
      warehouse_ids: scope === 'ASSIGNED' ? warehouseIds : [],
    }
    if (isEdit) {
      update({ id: emp.id, ...payload, is_active: isActive }, { onSuccess: onClose })
    } else {
      create(payload, { onSuccess: onClose })
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Sửa nhân viên' : 'Thêm nhân viên'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {apiError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {apiError}
            </div>
          )}

          {/* Thông tin cơ bản */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Họ tên *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Nguyễn Văn A" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Mã nhân viên *</Label>
              <Input value={empCode} onChange={e => setEmpCode(e.target.value)} placeholder="NV001" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Email</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">SĐT</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
          </div>

          {/* Phòng ban + Chức danh */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Phòng ban</Label>
              <Select value={deptId} onValueChange={setDeptId}>
                <SelectTrigger><SelectValue placeholder="Chọn phòng ban" /></SelectTrigger>
                <SelectContent>
                  {departments.map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Chức danh (template)</Label>
              <Select value={jobTitleId} onValueChange={setJobTitleId} disabled={!deptId}>
                <SelectTrigger><SelectValue placeholder="Chọn chức danh" /></SelectTrigger>
                <SelectContent>
                  {jobTitles.map(jt => (
                    <SelectItem key={jt.id} value={jt.id}>{jt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Permission */}
          <div className="rounded-lg border border-slate-200 p-3 space-y-3 bg-slate-50">
            <p className="text-xs font-medium text-slate-600 flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5" /> Phân quyền
              <span className="font-normal text-slate-400">(tự điền từ chức danh, override được)</span>
            </p>

            {/* Action level */}
            <div className="space-y-1">
              <Label className="text-xs">Cấp quyền</Label>
              <Select value={actionLevel} onValueChange={v => setActionLevel(v as ActionLevel)}>
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ACTION_LEVEL_LABEL) as ActionLevel[]).map(lvl => (
                    <SelectItem key={lvl} value={lvl}>{ACTION_LEVEL_LABEL[lvl]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Categories */}
            <div className="space-y-1">
              <Label className="text-xs">Loại hàng được phép</Label>
              <div className="flex gap-2 flex-wrap">
                {ALL_CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-all
                      ${categories.includes(cat)
                        ? CATEGORY_COLOR[cat] + ' border-transparent'
                        : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                      }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Scope */}
            <div className="space-y-1">
              <Label className="text-xs">Phạm vi kho</Label>
              <Select value={scope} onValueChange={v => setScope(v as 'NATIONAL'|'ASSIGNED')}>
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NATIONAL">Toàn quốc (tất cả kho)</SelectItem>
                  <SelectItem value="ASSIGNED">Kho được chỉ định</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Warehouse list — chỉ khi scope = ASSIGNED */}
            {scope === 'ASSIGNED' && (
              <div className="space-y-1">
                <Label className="text-xs">Kho được phép</Label>
                <div className="flex gap-2 flex-wrap">
                  {warehouses.map((w: { id: string; code: string; name: string }) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => toggleWarehouse(w.id)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-all
                        ${warehouseIds.includes(w.id)
                          ? 'bg-blue-100 text-blue-800 border-transparent'
                          : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                        }`}
                    >
                      {w.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Trạng thái — chỉ khi edit */}
          {isEdit && (
            <div className="flex items-center gap-2">
              <input
                id="is-active"
                type="checkbox"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded accent-blue-600"
              />
              <Label htmlFor="is-active" className="text-sm cursor-pointer">Tài khoản đang hoạt động</Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button onClick={handleSubmit} disabled={isPending || !name || !empCode}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo nhân viên'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function UserManagement() {
  const [search,      setSearch]      = useState('')
  const [filterDept,  setFilterDept]  = useState('__all__')
  const [editingEmp,  setEditingEmp]  = useState<EmployeeRecord | null | 'new'>('new' as never)
  const [showDialog,  setShowDialog]  = useState(false)

  const { data: departments = [] } = useDepartments()
  const { data: employees = [], isLoading, isError, error } = useEmployeeRecords({
    department_id: filterDept === '__all__' ? undefined : filterDept,
    search: search || undefined,
  })

  function openCreate() { setEditingEmp(null); setShowDialog(true) }
  function openEdit(emp: EmployeeRecord) { setEditingEmp(emp); setShowDialog(true) }

  return (
    <div className="p-4 space-y-4 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
            <User2 className="h-5 w-5 text-slate-500" />
            Quản lý nhân viên &amp; phân quyền
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">{employees.length} nhân viên</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" /> Thêm nhân viên
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Tìm tên, mã, email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={filterDept} onValueChange={setFilterDept}>
          <SelectTrigger className="h-8 text-sm w-[180px]">
            <Building2 className="h-3.5 w-3.5 mr-1.5 text-slate-400 shrink-0" />
            <SelectValue placeholder="Tất cả phòng ban" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Tất cả phòng ban</SelectItem>
            {departments.map(d => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* API error */}
      {isError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          Lỗi tải dữ liệu: {(error as { message?: string })?.message ?? 'Không kết nối được backend'}
        </div>
      )}

      {/* Table */}
      <Card>
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div>
        ) : employees.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <User2 className="h-10 w-10 mx-auto opacity-30" />
            <p className="text-sm">Chưa có nhân viên nào</p>
            <Button size="sm" variant="outline" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" /> Thêm nhân viên đầu tiên
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-3 py-2 text-xs">Nhân viên</TableHead>
                  <TableHead className="px-3 py-2 text-xs">Phòng ban / Chức danh</TableHead>
                  <TableHead className="px-3 py-2 text-xs">Cấp quyền</TableHead>
                  <TableHead className="px-3 py-2 text-xs">Loại hàng</TableHead>
                  <TableHead className="px-3 py-2 text-xs">Kho</TableHead>
                  <TableHead className="px-3 py-2 text-xs">Trạng thái</TableHead>
                  <TableHead className="px-3 py-2 w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map(emp => (
                  <TableRow key={emp.id} className="text-sm">
                    <TableCell className="px-3 py-2">
                      <p className="font-medium text-slate-800">{emp.name}</p>
                      <p className="text-xs text-slate-400">{emp.employee_code} · {emp.email ?? '—'}</p>
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <p className="text-slate-700">{emp.dept?.name ?? emp.department ?? '—'}</p>
                      <p className="text-xs text-slate-400">{emp.job_title?.name ?? '—'}</p>
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      {emp.action_level ? (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium
                          ${ACTION_LEVEL_COLOR[emp.action_level]}`}>
                          {ACTION_LEVEL_LABEL[emp.action_level]}
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <div className="flex gap-1 flex-wrap">
                        {(emp.allowed_categories ?? []).map(cat => (
                          <span key={cat} className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium
                            ${CATEGORY_COLOR[cat as Category] ?? 'bg-slate-100 text-slate-600'}`}>
                            {cat}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      {emp.warehouse_scope === 'NATIONAL' ? (
                        <span className="text-xs text-blue-600 font-medium">Toàn quốc</span>
                      ) : (
                        <div className="flex gap-1 flex-wrap">
                          {(emp.warehouse_access ?? []).map(wa => (
                            <span key={wa.warehouse_id} className="text-xs text-slate-600 bg-slate-100 rounded px-1.5 py-0.5">
                              {wa.warehouse?.name ?? wa.warehouse_id}
                            </span>
                          ))}
                          {(emp.warehouse_access ?? []).length === 0 && (
                            <span className="text-xs text-amber-600">Chưa gán kho</span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <Badge variant={emp.is_active ? 'default' : 'secondary'} className="text-xs">
                        {emp.is_active ? 'Hoạt động' : 'Tạm dừng'}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-2 py-2">
                      <button
                        className="text-slate-400 hover:text-blue-500 transition-colors p-1"
                        onClick={() => openEdit(emp)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {showDialog && (
        <EmployeeFormDialog
          emp={editingEmp as EmployeeRecord | null}
          open={showDialog}
          onClose={() => setShowDialog(false)}
        />
      )}
    </div>
  )
}
