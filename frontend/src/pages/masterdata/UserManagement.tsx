import { useState, useEffect, useRef } from 'react'
import type { AxiosError } from 'axios'
import { Plus, Pencil, ShieldCheck, Building2, User2, KeyRound, Check, Briefcase, Copy, CheckCheck, Trash2, RotateCcw, X, Warehouse, Rows3, AlignJustify } from 'lucide-react'
import { WarehouseMultiSelect } from '@/components/shared/WarehouseMultiSelect'
import { formatDateTime, normalizePhone } from '@/utils/formatters'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SavedViews } from '@/components/shared/SavedViews'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useSavedViewsStore } from '@/stores/savedViewsStore'
import { Button }   from '@/components/ui/button'
import { Input }    from '@/components/ui/input'
import { Label }    from '@/components/ui/label'
import { Card }     from '@/components/ui/card'
import { Badge }    from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { FormSheet } from '@/components/shared/FormSheet'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import {
  useDepartments, useJobTitles, useEmployeeRecords,
  useCreateEmployee, useUpdateEmployee, useDeleteEmployee, useRestoreEmployee, useWarehouses, useWarehouseTypes,
  useCreateDepartment, useUpdateDepartment,
  useCreateJobTitle, useUpdateJobTitle,
  useTransportCompanies, useTmsVehicles,
} from '@/api/hooks'
import { apiClient } from '@/api/client'
import { MODULES, can, isAdmin, type ModuleKey, type ModulePermissions } from '@/config/permissions'
import { PERMISSION_PAGES } from '@/config/navigation'
import { useAuthStore } from '@/stores/authStore'
import type { EmployeeRecord, Department, JobTitle, TmsVehicle } from '@/types'
import { JobTitleSkillSection, EmployeeSkillSection } from './hrSkillSections'
import { useWhTypeMetaMap } from '@/hooks/useWhTypeMeta'
import { whTypeBadgeCls } from '@/utils/cargoCategory'

// Màu badge Loại kho theo cờ per-loại (LookupValue.meta) — whTypeBadgeCls từ utils/cargoCategory

// ─── Set password dialog ──────────────────────────────────────────────────────

function SetPasswordDialog({ emp, open, onClose }: { emp: EmployeeRecord; open: boolean; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState(false)

  function reset() { setPassword(''); setConfirm(''); setError(''); setSuccess(false) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('Mật khẩu phải có ít nhất 6 ký tự'); return }
    if (password !== confirm) { setError('Xác nhận mật khẩu không khớp'); return }
    setSaving(true)
    try {
      await apiClient.patch(`/masterdata/employees/${emp.id}/set-password`, { password })
      setSuccess(true)
    } catch (err) {
      const msg = (err as AxiosError<{ error: { message: string } }>)
        ?.response?.data?.error?.message ?? 'Lỗi đặt mật khẩu'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-slate-500" />
            Đặt mật khẩu — {emp.name}
          </DialogTitle>
        </DialogHeader>
        {success ? (
          <div className="py-4 text-center space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 mx-auto">
              <Check className="h-6 w-6 text-green-600" />
            </div>
            <p className="text-sm text-slate-700">Đặt mật khẩu thành công!</p>
            <p className="text-xs text-slate-500">Nhân viên có thể đăng nhập bằng tên đăng nhập và mật khẩu mới.</p>
            <Button size="sm" onClick={() => { reset(); onClose() }}>Đóng</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 py-1">
            <div className="space-y-1">
              <Label className="text-xs">Mật khẩu mới</Label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Tối thiểu 6 ký tự" autoComplete="new-password" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Xác nhận mật khẩu</Label>
              <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="Nhập lại mật khẩu" autoComplete="new-password" />
            </div>
            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{error}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => { reset(); onClose() }}>Huỷ</Button>
              <Button type="submit" size="sm" disabled={saving || !password || !confirm}>
                {saving ? 'Đang lưu…' : 'Đặt mật khẩu'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Confirm delete dialog ────────────────────────────────────────────────────

function ConfirmDeleteDialog({ emp, open, onClose }: { emp: EmployeeRecord; open: boolean; onClose: () => void }) {
  const { mutate: del, isPending } = useDeleteEmployee()
  const [error, setError] = useState<string | null>(null)
  const [softDeleted, setSoftDeleted] = useState(false)

  function handleDelete() {
    setError(null)
    del(emp.id, {
      onSuccess: (res) => {
        if (res?.deleted === 'soft') { setSoftDeleted(true) } else { onClose() }
      },
      onError: (err) => {
        const msg = (err as AxiosError<{ error: { message: string } }>)
          ?.response?.data?.error?.message ?? 'Lỗi xóa nhân viên'
        setError(msg)
      },
    })
  }

  if (softDeleted) {
    return (
      <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <Trash2 className="h-4 w-4" /> Đã ẩn nhân viên
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 py-2">
            <span className="font-semibold">{emp.name}</span> có lịch sử hoạt động trong hệ thống nên được ẩn khỏi danh sách thay vì xóa hẳn. Dữ liệu lịch sử vẫn được giữ lại.
          </p>
          <DialogFooter>
            <Button size="sm" onClick={onClose}>Đóng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <Trash2 className="h-4 w-4" /> Xóa nhân viên
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <p className="text-sm text-slate-700">
            Bạn có chắc muốn xóa <span className="font-semibold">{emp.name}</span> ({emp.employee_code})?
            Hành động này không thể hoàn tác.
          </p>
          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>Hủy</Button>
          <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isPending}>
            {isPending ? 'Đang xóa…' : 'Xóa'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Employee form dialog ─────────────────────────────────────────────────────

function EmployeeFormDialog({ emp, open, onClose }: { emp: EmployeeRecord | null; open: boolean; onClose: () => void }) {
  const isEdit = !!emp
  const me = useAuthStore(s => s.user)
  const fullEdit = isAdmin(me?.name)          // chỉ Admin được sửa toàn bộ hồ sơ
  const skillOnly = isEdit && !fullEdit        // non-admin: chỉ chỉnh Kỹ năng / Vị trí

  const { data: departments = [] } = useDepartments()
  const [deptId, setDeptId]   = useState(emp?.department_id ?? '')
  const { data: jobTitles = [] } = useJobTitles(deptId || undefined)
  const { data: warehouses = [] }     = useWarehouses()
  const { data: whTypes = [] }        = useWarehouseTypes()
  const categoryOptions                = whTypes.map(t => t.value)
  const whTypeMeta                     = useWhTypeMetaMap()
  const { data: transportCompanies = [] } = useTransportCompanies(true)

  const [name,         setName]         = useState(emp?.name          ?? '')
  const [empCode,      setEmpCode]      = useState(emp?.employee_code ?? '')
  const [email,        setEmail]        = useState(emp?.email         ?? '')
  const [phone,        setPhone]        = useState(emp?.phone         ?? '')
  const [jobTitleId,   setJobTitleId]   = useState(emp?.job_title_id  ?? '')
  const [categories,   setCategories]   = useState<string[]>(emp?.allowed_categories ?? [])
  const [scope,        setScope]        = useState<'NATIONAL'|'ASSIGNED'>(emp?.warehouse_scope ?? 'ASSIGNED')
  const [warehouseIds, setWarehouseIds] = useState<string[]>(
    emp?.warehouse_access?.map(w => w.warehouse_id) ?? []
  )
  const [isActive, setIsActive] = useState(emp?.is_active ?? true)
  const [nccId,    setNccId]    = useState(emp?.ncc_id ?? '')
  const [driverVehicleId, setDriverVehicleId] = useState<string>('')

  const selectedDeptName = departments.find(d => d.id === deptId)?.name ?? ''
  const selectedJtName   = jobTitles.find(jt => jt.id === jobTitleId)?.name ?? ''
  const isDriverRole     = selectedDeptName === 'Đơn vị vận tải' && selectedJtName === 'Lái xe'
  const isDispatcherRole = selectedDeptName === 'Đơn vị vận tải' && !!jobTitleId && !isDriverRole

  const { data: allVehicles = [] } = useTmsVehicles(
    isDriverRole && nccId && !isEdit ? { ncc_id: nccId, is_active: 'true', unassigned: 'true' } : undefined
  )
  const selectedVehicle = isDriverRole && !isEdit ? (allVehicles as TmsVehicle[]).find(v => v.id === driverVehicleId) ?? null : null

  const deptIdMounted      = useRef(false)
  const defaultCatApplied  = useRef(false)

  useEffect(() => {
    if (!deptIdMounted.current) { deptIdMounted.current = true; return }
    setJobTitleId('')
  }, [deptId])

  // Khi tạo mới (không có emp), mặc định chọn tất cả loại kho
  useEffect(() => {
    if (!isEdit && !defaultCatApplied.current && categoryOptions.length > 0) {
      defaultCatApplied.current = true
      setCategories(categoryOptions)
    }
  }, [categoryOptions, isEdit])

  const { mutate: create, isPending: creating, error: createErr } = useCreateEmployee()
  const { mutate: update, isPending: updating, error: updateErr } = useUpdateEmployee()
  const isPending = creating || updating

  const apiError = ((createErr ?? updateErr) as AxiosError<{ error: { message: string } }>)
    ?.response?.data?.error?.message

  const [createdInfo, setCreatedInfo] = useState<{ name: string; login: string; password: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const lockIdentity    = isEdit
  const lockDriverPlate = isEdit && isDriverRole
  const showRestOfForm  = isEdit || (!!deptId && !!jobTitleId)

  function copyPassword(pwd: string) {
    navigator.clipboard.writeText(pwd)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function toggleCategory(cat: string) {
    setCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat])
  }

  function handleSubmit() {
    const payload: Record<string, unknown> = {
      name,
      email: email || undefined,
      phone: phone || undefined,
      department_id: deptId || null,
      job_title_id: jobTitleId || null,
      // Dọn giá trị ngoài danh mục hiện hành (taxonomy cũ NVL/Bao bì còn sót trong DB)
      allowed_categories: categoryOptions.length > 0
        ? categories.filter(c => categoryOptions.includes(c))
        : categories,
      warehouse_scope: scope,
      warehouse_ids: scope === 'ASSIGNED' ? warehouseIds : [],
      ncc_id: (isDriverRole || isDispatcherRole) ? (nccId || null) : null,
      is_driver: isDriverRole,
    }
    // Biển số khóa khi edit driver — không gửi employee_code (đổi qua TMS Settings)
    if (!lockDriverPlate) {
      payload.employee_code = isDriverRole ? (selectedVehicle?.license_plate ?? empCode) : empCode
    }
    if (isEdit) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update({ id: emp.id, ...(payload as any), is_active: isActive }, { onSuccess: onClose })
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create(payload as any, {
        onSuccess: (result: EmployeeRecord & { temp_password?: string }) => {
          setCreatedInfo({
            name: result.name,
            login: result.email ?? result.employee_code,
            password: result.temp_password ?? '',
          })
        },
      })
    }
  }

  if (createdInfo) {
    return (
      <FormSheet
        open={open} onClose={onClose}
        title={<span className="flex items-center gap-2 text-green-700"><Check className="h-5 w-5" /> Tạo tài khoản thành công</span>}
        footer={<Button onClick={onClose}>Đóng</Button>}
      >
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Tài khoản <span className="font-semibold text-slate-800">{createdInfo.name}</span> đã được tạo.
              Cấp thông tin đăng nhập dưới đây cho nhân viên:
            </p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 divide-y divide-slate-200">
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-xs text-slate-500">Tên đăng nhập</span>
                <span className="text-sm font-mono font-semibold text-slate-800">{createdInfo.login}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-xs text-slate-500">Mật khẩu tạm</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-semibold text-slate-800 tracking-widest">
                    {createdInfo.password}
                  </span>
                  <button
                    onClick={() => copyPassword(createdInfo.password)}
                    className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
                  >
                    {copied ? <CheckCheck className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              Nhân viên nên đổi mật khẩu sau lần đăng nhập đầu tiên.
            </p>
          </div>
      </FormSheet>
    )
  }

  // Non-admin: chỉ cho chỉnh Kỹ năng / Vị trí, không sửa hồ sơ
  if (skillOnly && emp) {
    return (
      <FormSheet
        open={open} onClose={onClose}
        title={`Kỹ năng / Vị trí — ${emp.name}`}
        footer={<Button variant="outline" onClick={onClose}>Đóng</Button>}
      >
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <p className="font-medium text-slate-800">{emp.name}</p>
              <p className="text-xs text-slate-500">{emp.employee_code} · {emp.dept?.name ?? '—'} · {emp.job_title?.name ?? '—'}</p>
            </div>
            {emp.job_title_id
              ? <EmployeeSkillSection employeeId={emp.id} />
              : <p className="text-xs text-amber-600">Nhân viên chưa có chức danh — không thể gán kỹ năng.</p>}
            <p className="text-[11px] text-slate-400">Chỉ Admin mới sửa được hồ sơ. Bạn chỉ chỉnh Kỹ năng / Vị trí.</p>
          </div>
      </FormSheet>
    )
  }

  return (
    <FormSheet
      open={open} onClose={onClose}
      title={isEdit ? 'Sửa nhân viên' : 'Thêm nhân viên'}
      footer={<>
        <Button variant="outline" onClick={onClose}>Huỷ</Button>
        <Button onClick={handleSubmit} disabled={isPending || !showRestOfForm || !name || (isDriverRole ? (!isEdit && !driverVehicleId) : !empCode)}>
          {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo nhân viên'}
        </Button>
      </>}
    >
        <div className="space-y-4">
          {apiError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{apiError}</div>
          )}

          {/* Phòng ban + Chức danh — luôn hiển thị đầu tiên */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Phòng ban</Label>
              <SingleSelect
                value={deptId || '__none__'}
                onChange={v => setDeptId(v === '__none__' ? '' : v)}
                placeholder="Chọn phòng ban"
                searchPlaceholder="Tìm phòng ban…"
                options={[{ value: '__none__', label: '— Không chọn —' }, ...departments.map(d => ({ value: d.id, label: d.name }))]}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Chức danh (template)</Label>
              <SingleSelect
                value={jobTitleId || '__none__'}
                onChange={v => setJobTitleId(v === '__none__' ? '' : v)}
                disabled={!deptId && !jobTitleId}
                placeholder="Chọn chức danh"
                searchPlaceholder="Tìm chức danh…"
                options={[{ value: '__none__', label: '— Không chọn —' }, ...jobTitles.map(jt => ({ value: jt.id, label: jt.name }))]}
              />
            </div>
          </div>

          {!isEdit && !showRestOfForm && (
            <p className="text-xs text-center text-slate-400 py-2">Chọn phòng ban và chức danh để tiếp tục</p>
          )}

          {showRestOfForm && (
            <>
              {(isDriverRole || isDispatcherRole) && (
                <div className="space-y-1">
                  <Label className="text-xs">Công ty vận tải (ĐVVT) *</Label>
                  <SingleSelect
                    value={nccId || '__none__'}
                    onChange={v => {
                      const next = v === '__none__' ? '' : v
                      setNccId(next)
                      if (isDriverRole) setDriverVehicleId('')
                    }}
                    disabled={lockDriverPlate}
                    placeholder="— Chọn công ty —"
                    searchPlaceholder="Tìm ĐVVT…"
                    options={[{ value: '__none__', label: '— Chọn công ty —' }, ...(transportCompanies as { id: string; name: string }[]).map(tc => ({ value: tc.id, label: tc.name }))]}
                  />
                  {lockDriverPlate && (
                    <p className="text-[10px] text-slate-400">Đổi biển số qua Cài đặt TMS → thông tin sẽ tự cập nhật</p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Họ tên *</Label>
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder="Nguyễn Văn A" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{isDriverRole ? 'Biển số xe *' : 'Mã NV *'}</Label>
                  {isDriverRole && lockDriverPlate ? (
                    <Input value={emp?.employee_code ?? ''} disabled className="bg-slate-50 cursor-not-allowed" />
                  ) : isDriverRole ? (
                    <SingleSelect
                      value={driverVehicleId || '__none__'}
                      onChange={v => setDriverVehicleId(v === '__none__' ? '' : v)}
                      disabled={!nccId}
                      placeholder={nccId ? 'Chọn biển số xe' : 'Chọn ĐVVT trước'}
                      searchPlaceholder="Tìm biển số…"
                      options={[{ value: '__none__', label: '— Chọn biển số xe —' }, ...(allVehicles as TmsVehicle[]).map(v => ({ value: v.id, label: v.license_plate }))]}
                    />
                  ) : (
                    <Input value={empCode} onChange={e => setEmpCode(e.target.value)} placeholder="NV001" />
                  )}
                  {lockDriverPlate && (
                    <p className="text-[10px] text-slate-400">Đổi qua Cài đặt TMS</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Tên đăng nhập</Label>
                  <Input type="text" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="Email hoặc tên bất kỳ"
                    disabled={lockIdentity} className={lockIdentity ? 'bg-slate-50 cursor-not-allowed' : ''} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">SĐT</Label>
                  <Input value={phone} onChange={e => setPhone(normalizePhone(e.target.value))} inputMode="numeric" placeholder="09xxxxxxxx" />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 p-3 space-y-3 bg-slate-50">
                <div className="space-y-1">
                  <Label className="text-xs">Loại hàng được phép</Label>
                  <div className="flex gap-2 flex-wrap">
                    {categoryOptions.map(cat => (
                      <button key={cat} type="button" onClick={() => toggleCategory(cat)}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-all
                          ${categories.includes(cat)
                            ? whTypeBadgeCls(cat, whTypeMeta) + ' border-transparent'
                            : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'}`}>
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Phạm vi kho</Label>
                  <SingleSelect
                    value={scope}
                    onChange={v => setScope(v as 'NATIONAL'|'ASSIGNED')}
                    searchable={false}
                    options={[
                      { value: 'NATIONAL', label: 'Toàn quốc (tất cả kho)' },
                      { value: 'ASSIGNED', label: 'Kho được chỉ định' },
                    ]}
                  />
                </div>

                {scope === 'ASSIGNED' && (
                  <div className="space-y-1">
                    <Label className="text-xs">Kho được phép</Label>
                    <WarehouseMultiSelect
                      warehouses={warehouses as { id: string; code: string; name: string }[]}
                      selected={warehouseIds}
                      onChange={setWarehouseIds}
                      dropUp
                      showTags
                    />
                  </div>
                )}
              </div>

              {isEdit && jobTitleId && (
                <div className="border-t border-slate-200 pt-3">
                  <EmployeeSkillSection employeeId={emp.id} />
                </div>
              )}

              {isEdit && (
                <div className="flex items-center gap-2">
                  <input id="is-active" type="checkbox" checked={isActive}
                    onChange={e => setIsActive(e.target.checked)}
                    className="h-4 w-4 rounded accent-blue-600" />
                  <Label htmlFor="is-active" className="text-sm cursor-pointer">Tài khoản đang hoạt động</Label>
                </div>
              )}
            </>
          )}
        </div>
    </FormSheet>
  )
}

// ─── Department form dialog ───────────────────────────────────────────────────

function DepartmentFormDialog({ dept, open, onClose }: { dept: Department | null; open: boolean; onClose: () => void }) {
  const isEdit = !!dept
  const [name, setName] = useState(dept?.name ?? '')
  const [code, setCode] = useState(dept?.code ?? '')
  const [isActive, setIsActive] = useState(dept?.is_active ?? true)

  const { mutate: create, isPending: creating, error: createErr } = useCreateDepartment()
  const { mutate: update, isPending: updating, error: updateErr } = useUpdateDepartment()
  const isPending = creating || updating

  const apiError = ((createErr ?? updateErr) as AxiosError<{ error: { message: string } }>)
    ?.response?.data?.error?.message

  function handleSubmit() {
    if (isEdit) {
      update({ id: dept.id, name, code, is_active: isActive }, { onSuccess: onClose })
    } else {
      create({ name, code }, { onSuccess: onClose })
    }
  }

  return (
    <FormSheet
      open={open} onClose={onClose}
      title={isEdit ? 'Sửa phòng ban' : 'Thêm phòng ban'}
      footer={<>
        <Button variant="outline" onClick={onClose}>Huỷ</Button>
        <Button onClick={handleSubmit} disabled={isPending || !name || !code}>
          {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
        </Button>
      </>}
    >
        <div className="space-y-3">
          {apiError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{apiError}</div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Tên phòng ban *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Kho, Bảo vệ, QA…" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mã *</Label>
            <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="KHO, BV, QA…" />
          </div>
          {isEdit && (
            <div className="flex items-center gap-2">
              <input id="dept-active" type="checkbox" checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded accent-blue-600" />
              <Label htmlFor="dept-active" className="text-sm cursor-pointer">Đang hoạt động</Label>
            </div>
          )}
        </div>
    </FormSheet>
  )
}

// ─── Job title form dialog ────────────────────────────────────────────────────

function JobTitleFormDialog({ jt, open, onClose }: { jt: JobTitle | null; open: boolean; onClose: () => void }) {
  const isEdit = !!jt
  const me = useAuthStore(s => s.user)
  const fullEdit = isAdmin(me?.name)            // chỉ Admin sửa tên/phòng ban/phân quyền
  const skillOnly = isEdit && !fullEdit          // non-admin: chỉ Danh mục Vị trí/Skill (chức danh cấp dưới)
  const { data: departments = [] } = useDepartments()

  const [name,       setName]       = useState(jt?.name          ?? '')
  const [deptId,     setDeptId]     = useState(jt?.department_id ?? '')
  const [isActive,   setIsActive]   = useState(jt?.is_active     ?? true)
  const [modulePerms, setModulePerms] = useState<ModulePermissions>(jt?.module_permissions ?? {})

  const { mutate: create, isPending: creating, error: createErr } = useCreateJobTitle()
  const { mutate: update, isPending: updating, error: updateErr } = useUpdateJobTitle()
  const isPending = creating || updating

  const apiError = ((createErr ?? updateErr) as AxiosError<{ error: { message: string } }>)
    ?.response?.data?.error?.message

  function toggleAction(mod: ModuleKey, action: string) {
    setModulePerms(prev => {
      const current = (prev[mod] ?? []) as string[]
      const next = current.includes(action)
        ? current.filter(a => a !== action)
        : [...current, action]
      if (next.length === 0) {
        const { [mod]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [mod]: next }
    })
  }

  function handleSubmit() {
    const cleanPerms = Object.fromEntries(
      Object.entries(modulePerms).filter((e): e is [string, string[]] => e[1] !== undefined)
    )
    const payload = { name, department_id: deptId, module_permissions: cleanPerms }
    if (isEdit) {
      update({ id: jt.id, ...payload, is_active: isActive }, { onSuccess: onClose })
    } else {
      create(payload, { onSuccess: onClose })
    }
  }

  // Non-admin: chỉ cho sửa Danh mục Vị trí/Skill (BE đã chặn chỉ chức danh cấp dưới)
  if (skillOnly && jt) {
    return (
      <FormSheet
        open={open} onClose={onClose}
        title={`Vị trí / Skill — ${jt.name}`}
        footer={<Button variant="outline" onClick={onClose}>Đóng</Button>}
      >
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <p className="font-medium text-slate-800">{jt.name}</p>
              <p className="text-xs text-slate-500">{jt.department?.name ?? '—'}</p>
            </div>
            <JobTitleSkillSection jobTitleId={jt.id} />
            <p className="text-[11px] text-slate-400">Chỉ Admin mới sửa tên/phòng ban/phân quyền. Bạn chỉ chỉnh Danh mục Vị trí/Skill của chức danh cấp dưới.</p>
          </div>
      </FormSheet>
    )
  }

  return (
    <FormSheet
      open={open} onClose={onClose}
      title={isEdit ? 'Sửa chức danh' : 'Thêm chức danh'}
      footer={<>
        <Button variant="outline" onClick={onClose}>Huỷ</Button>
        <Button onClick={handleSubmit} disabled={isPending || !name || !deptId}>
          {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
        </Button>
      </>}
    >
        <div className="space-y-4">
          {apiError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{apiError}</div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Tên chức danh *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Thủ kho, Lái xe nâng…" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Phòng ban *</Label>
            <SingleSelect
              value={deptId || '__none__'}
              onChange={v => setDeptId(v === '__none__' ? '' : v)}
              placeholder="Chọn phòng ban"
              searchPlaceholder="Tìm phòng ban…"
              options={[{ value: '__none__', label: '— Chọn phòng ban —' }, ...departments.map(d => ({ value: d.id, label: d.name }))]}
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-600 flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5" /> Phân quyền module
            </p>
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {PERMISSION_PAGES.map(({ page, modules }) => {
                const mods = modules.map(k => [k, MODULES[k]] as [ModuleKey, typeof MODULES[ModuleKey]])
                const multi = mods.length > 1                                            // trang nhiều tab
                const pageHasAny = mods.some(([k]) => (modulePerms[k]?.length ?? 0) > 0)
                const isAll = mods.every(([k, d]) => Object.keys(d.actions).every(a => (modulePerms[k] ?? []).includes(a)))
                return (
                  <div key={page} className={`rounded-lg border p-3 ${pageHasAny ? 'border-blue-200 bg-blue-50/50' : 'border-slate-200'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <p className={`text-xs font-semibold ${pageHasAny ? 'text-blue-700' : 'text-slate-500'}`}>
                        {page}
                      </p>
                      <button
                        type="button"
                        onClick={() => setModulePerms(prev => {
                          const next = { ...prev }
                          for (const [k, d] of mods) next[k] = isAll ? undefined : Object.keys(d.actions)
                          return next
                        })}
                        className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${
                          isAll
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        Tất cả
                      </button>
                    </div>
                    <div className={multi ? 'space-y-2' : ''}>
                      {mods.map(([modKey, modDef]) => {
                        const grantedActions = (modulePerms[modKey] ?? []) as string[]
                        const tab = (modDef as { tab?: string }).tab
                        const tabActions = Object.keys(modDef.actions)
                        const tabAll = tabActions.every(a => grantedActions.includes(a))
                        const actionsGrid = (
                          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                            {(Object.entries(modDef.actions) as [string, string][]).map(([actionKey, actionLabel]) => {
                              const checked = grantedActions.includes(actionKey)
                              return (
                                <label key={actionKey} className="flex items-center gap-1.5 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleAction(modKey, actionKey)}
                                    className="h-3.5 w-3.5 rounded accent-blue-600"
                                  />
                                  <span className={`text-xs ${checked ? 'text-slate-700 font-medium' : 'text-slate-400'}`}>
                                    {actionLabel}
                                  </span>
                                </label>
                              )
                            })}
                          </div>
                        )
                        // Trang đơn (1 module): hiện thẳng lưới action.
                        if (!multi) return <div key={modKey}>{actionsGrid}</div>
                        // Trang nhiều tab: mỗi tab = card riêng có băng tiêu đề (accent sky) để tách bạch.
                        return (
                          <div key={modKey} className="rounded-md border border-slate-200 bg-white overflow-hidden">
                            <div className="flex items-center justify-between border-l-[3px] border-sky-500 bg-slate-100 px-2 py-1">
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">{tab}</span>
                              <button
                                type="button"
                                onClick={() => setModulePerms(prev => ({ ...prev, [modKey]: tabAll ? undefined : tabActions }))}
                                className={`text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors ${
                                  tabAll ? 'bg-sky-600 text-white hover:bg-sky-700' : 'bg-white text-slate-400 border border-slate-200 hover:bg-slate-50'
                                }`}
                              >
                                Tất cả
                              </button>
                            </div>
                            <div className="px-2.5 py-2">{actionsGrid}</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {isEdit && (
            <div className="border-t border-slate-200 pt-3">
              <JobTitleSkillSection jobTitleId={jt.id} />
            </div>
          )}

          {isEdit && (
            <div className="flex items-center gap-2">
              <input id="jt-active" type="checkbox" checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded accent-blue-600" />
              <Label htmlFor="jt-active" className="text-sm cursor-pointer">Đang hoạt động</Label>
            </div>
          )}
        </div>
    </FormSheet>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function UserManagement() {
  const user = useAuthStore(s => s.user)
  const whTypeMeta = useWhTypeMetaMap()
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canCreateEmp = can(perms, 'user_admin', 'create')
  const canEditEmp   = can(perms, 'user_admin', 'edit')
  const canSetPwd    = can(perms, 'user_admin', 'set_password')
  const canDeleteEmp = can(perms, 'user_admin', 'delete')
  // Cấu trúc phòng ban/chức danh & phân quyền: chỉ Admin. Danh mục Vị trí/Skill: Admin hoặc người có
  // work_skill.manage cho chức danh CẤP DƯỚI mình (theo sơ đồ chức danh).
  const isAdminUser    = isAdmin(user?.name)
  // "Quản lý skill" = có bất kỳ quyền ghi danh mục Vị trí/Skill (create/edit/delete)
  const canManageSkill = can(perms, 'work_skill', 'create') || can(perms, 'work_skill', 'edit') || can(perms, 'work_skill', 'delete')
  const { data: allJts = [] } = useJobTitles()
  const subordinateJtIds = (() => {
    const set = new Set<string>()
    const myJt = user?.job_title_id
    if (!myJt) return set
    const childrenOf = new Map<string, string[]>()
    for (const j of allJts) if (j.parent_id) { const a = childrenOf.get(j.parent_id) ?? []; a.push(j.id); childrenOf.set(j.parent_id, a) }
    const stack = [...(childrenOf.get(myJt) ?? [])]
    while (stack.length) { const c = stack.pop() as string; if (!set.has(c)) { set.add(c); for (const k of childrenOf.get(c) ?? []) stack.push(k) } }
    return set
  })()
  const canEditJt = (jtId: string) => isAdminUser || (canManageSkill && subordinateJtIds.has(jtId))

  const ua = useWmsFilterStore(s => s.userAdmin)
  const setUserAdmin = useWmsFilterStore(s => s.setUserAdmin)
  const { search, deptId: filterDept, jtId: filterJt, warehouseId: filterWh, status: statusFilter, jtDept: filterDeptJt } = ua
  const setSearch       = (v: string) => setUserAdmin({ search: v })
  const setFilterDept   = (v: string) => setUserAdmin({ deptId: v })
  const setFilterJt     = (v: string) => setUserAdmin({ jtId: v })
  const setFilterWh     = (v: string) => setUserAdmin({ warehouseId: v })
  const setStatusFilter = (v: 'active' | 'hidden' | 'all') => setUserAdmin({ status: v })
  const setFilterDeptJt = (v: string) => setUserAdmin({ jtDept: v })
  const [dense, setDense] = useState(() => localStorage.getItem('user_admin_density') === '1')
  const toggleDense = () => setDense(d => { localStorage.setItem('user_admin_density', d ? '0' : '1'); return !d })
  // Cột tab Nhân viên: mỗi giá trị 1 cột (không xếp chồng 2 dòng) — gọn, không wrap
  const EMP_COL_DEFAULTS = [170, 110, 150, 110, 130, 140, 150, 180, 95, 90]
  const { widths: empColW, startResize: empStartResize, totalWidth: empTotalWidth } = useColumnResize('user_admin_col_widths', EMP_COL_DEFAULTS)
  const empViewSnapshot = { search, deptId: filterDept, jtId: filterJt, warehouseId: filterWh, status: statusFilter }
  const empSavedViews = useSavedViewsStore(s => s.views['user_admin'] ?? [])
  const empActiveViewId = empSavedViews.find(v => JSON.stringify(v.filters) === JSON.stringify(empViewSnapshot))?.id ?? null
  const [editingEmp,   setEditingEmp]   = useState<EmployeeRecord | null>(null)
  const [showEmpDlg,   setShowEmpDlg]   = useState(false)
  const [pwdEmp,       setPwdEmp]       = useState<EmployeeRecord | null>(null)
  const [confirmDeleteEmp, setConfirmDeleteEmp] = useState<EmployeeRecord | null>(null)
  const { mutate: restore, isPending: restoring } = useRestoreEmployee()

  const [editingDept, setEditingDept] = useState<Department | null>(null)
  const [showDeptDlg, setShowDeptDlg] = useState(false)

  const [editingJt,  setEditingJt]  = useState<JobTitle | null>(null)
  const [showJtDlg,  setShowJtDlg]  = useState(false)

  const [selectedEmp,  setSelectedEmp]  = useState<EmployeeRecord | null>(null)
  const [selectedDept, setSelectedDept] = useState<Department | null>(null)
  const [selectedJt,   setSelectedJt]   = useState<JobTitle | null>(null)

  const { data: departments = [] } = useDepartments()
  const { data: jobTitles = [] }   = useJobTitles(filterDeptJt === '__all__' ? undefined : filterDeptJt)
  // Tab Chức danh: chỉ hiện chức danh được phép sửa (Admin: tất cả · non-admin: chỉ cấp dưới mình)
  const visibleJobTitles = jobTitles.filter(jt => canEditJt(jt.id))
  const { data: rawEmployees = [], isLoading, isError, error } = useEmployeeRecords({
    department_id: filterDept === '__all__' ? undefined : filterDept,
    search: search || undefined,
    include_deleted: statusFilter !== 'active' ? true : undefined,
  })
  // Options 2 filter dẫn xuất từ DS nhân viên đang tải (đã lọc Phòng ban + phạm vi) → tự liên kết
  const jtOptions = (() => {
    const m = new Map<string, { id: string; label: string; sub?: string }>()
    for (const e of rawEmployees) if (e.job_title_id) m.set(e.job_title_id, { id: e.job_title_id, label: e.job_title?.name ?? '—', sub: e.dept?.name })
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label))
  })()
  const whOptions = (() => {
    const m = new Map<string, { id: string; label: string; sub?: string }>()
    for (const e of rawEmployees) for (const wa of (e.warehouse_access ?? [])) m.set(wa.warehouse_id, { id: wa.warehouse_id, label: wa.warehouse?.name ?? wa.warehouse_id, sub: wa.warehouse?.code })
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label))
  })()
  // Lọc thêm theo Chức danh + Kho (multi-select, client-side)
  const matchExtra = (e: EmployeeRecord) =>
    (filterJt === '__all__' || e.job_title_id === filterJt) &&
    (filterWh === '__all__' || (e.warehouse_access ?? []).some(wa => wa.warehouse_id === filterWh))
  const scopedRaw = rawEmployees.filter(matchExtra)
  const employees = statusFilter === 'hidden'
    ? scopedRaw.filter(e => !!e.deleted_at)
    : scopedRaw

  // Filter danh sách nhân viên — FilterBar chuẩn (Kho · Phòng ban · Chức danh · Tình trạng)
  const empFilterDefs: FilterDef[] = [
    { key: 'warehouse', label: 'Kho', type: 'single', allLabel: 'Tất cả kho',
      value: filterWh === '__all__' ? '' : filterWh, onChange: v => setFilterWh(v || '__all__'),
      options: whOptions.map(o => ({ value: o.id, label: o.label })) },
    { key: 'dept', label: 'Phòng ban', type: 'single', allLabel: 'Tất cả phòng ban',
      value: filterDept === '__all__' ? '' : filterDept,
      onChange: v => { setFilterDept(v || '__all__'); setFilterJt('__all__'); setFilterWh('__all__') },
      options: departments.map(d => ({ value: d.id, label: d.name })) },
    { key: 'jt', label: 'Chức danh', type: 'single', allLabel: 'Tất cả chức danh',
      value: filterJt === '__all__' ? '' : filterJt, onChange: v => setFilterJt(v || '__all__'),
      options: jtOptions.map(o => ({ value: o.id, label: o.label })) },
    { key: 'status', label: 'Tình trạng', type: 'single', allLabel: 'Đang hoạt động',
      value: statusFilter === 'active' ? '' : statusFilter,
      onChange: v => setStatusFilter((v || 'active') as 'active' | 'hidden' | 'all'),
      options: [{ value: 'hidden', label: 'Đang ẩn' }, { value: 'all', label: 'Toàn bộ' }] },
  ]

  // Filter tab Chức danh — FilterBar chuẩn (Phòng ban), state lưu store thay cho useState
  const jtFilterDefs: FilterDef[] = [
    { key: 'jtDept', label: 'Phòng ban', type: 'single', allLabel: 'Tất cả phòng ban',
      value: filterDeptJt === '__all__' ? '' : filterDeptJt, onChange: v => setFilterDeptJt(v || '__all__'),
      options: departments.map(d => ({ value: d.id, label: d.name })) },
  ]

  return (
    <div className="flex flex-col h-full p-2 gap-1.5 max-w-7xl mx-auto w-full">
      <Tabs defaultValue="employees" className="flex flex-col flex-1 min-h-0">
        {/* Tiêu đề + tab trên CÙNG 1 hàng để tối ưu chiều cao, dành đất cho bảng */}
        <div className="shrink-0 flex items-center gap-3 mb-1.5">
          <h1 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 shrink-0">
            <User2 className="h-4 w-4 text-slate-500" />
            <span className="hidden md:inline">Quản lý nhân sự &amp; phân quyền</span>
          </h1>
          <TabsList className="shrink-0">
            <TabsTrigger value="employees" className="gap-1.5">
              <User2 className="h-3.5 w-3.5" /> Nhân viên
            </TabsTrigger>
            <TabsTrigger value="departments" className="gap-1.5">
              <Building2 className="h-3.5 w-3.5" /> Phòng ban
            </TabsTrigger>
            <TabsTrigger value="job-titles" className="gap-1.5">
              <Briefcase className="h-3.5 w-3.5" /> Chức danh
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ── Tab: Nhân viên ── */}
        <TabsContent value="employees" className="flex-1 min-h-0 data-[state=active]:flex flex-col space-y-2">
          <div className="shrink-0 flex gap-2 flex-wrap items-center">
            <SearchInput value={search} onChange={setSearch} placeholder="Tìm tên, mã, đăng nhập…" className="flex-1 min-w-[200px]" />
            <FilterSheetButton defs={empFilterDefs} className="sm:hidden" />
            {/* Mobile: SavedViews + action GOM 1 hàng (PDA); desktop sm:contents → như cũ */}
            <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
            <SavedViews module="user_admin" currentFilters={empViewSnapshot} activeId={empActiveViewId}
              onApply={(fl) => setUserAdmin(fl as Partial<typeof ua>)} />
            <button type="button" onClick={toggleDense}
              className="hidden sm:inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 shrink-0"
              title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
              {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
            </button>
            <ActionCluster className="shrink-0" mobileInline items={[
              ...(canCreateEmp ? [{
                key: 'create', icon: Plus, label: 'Thêm nhân viên', tip: 'Tạo tài khoản nhân viên mới',
                primary: true, variant: 'default',
                onClick: () => { setEditingEmp(null); setShowEmpDlg(true) },
              } satisfies ActionItem] : []),
            ]} />
            </div>
          </div>
          <FilterBar defs={empFilterDefs} className="shrink-0 hidden sm:flex" />

          <SummaryBand compact className="shrink-0 rounded-lg" tiles={[
            { label: 'Đang hoạt động', value: scopedRaw.filter(e => !e.deleted_at && e.is_active).length, accent: true },
            { label: 'Tạm dừng', value: scopedRaw.filter(e => !e.deleted_at && !e.is_active).length },
            { label: 'Đã ẩn', value: scopedRaw.filter(e => !!e.deleted_at).length },
          ]} />

          {isError && (
            <div className="shrink-0 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              Lỗi tải dữ liệu: {(error as { message?: string })?.message ?? 'Không kết nối được backend'}
            </div>
          )}

          <div className="flex gap-3 items-stretch flex-1 min-h-0">
            <Card className="flex-1 min-w-0 flex flex-col">
              {isLoading ? (
                <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div>
              ) : employees.length === 0 ? (
                <div className="p-12 text-center text-slate-400 space-y-2">
                  <User2 className="h-10 w-10 mx-auto opacity-30" />
                  <p className="text-sm">Chưa có nhân viên nào</p>
                  {canCreateEmp && (
                    <Button size="sm" variant="outline" onClick={() => { setEditingEmp(null); setShowEmpDlg(true) }}>
                      <Plus className="h-4 w-4 mr-1" /> Thêm nhân viên đầu tiên
                    </Button>
                  )}
                </div>
              ) : (
                <div className="overflow-auto flex-1 min-h-0">
                  <Table className={`table-fixed [&_td]:overflow-hidden [&_th]:overflow-hidden [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap [&_td]:text-[10px] [&_td]:border-r [&_td]:border-slate-100 [&_th]:border-r [&_th]:border-slate-200 ${dense ? '[&_td]:!py-1' : '[&_td]:!py-2'}`} style={{ width: empTotalWidth, minWidth: '100%' }}>
                    <colgroup>{empColW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                    <TableHeader>
                      <TableRow>
                        {['Họ tên', 'Mã NV', 'Đăng nhập', 'SĐT', 'Phòng ban', 'Chức danh', 'Loại hàng', 'Kho', 'Trạng thái', ''].map((lbl, i) => (
                          <TableHead key={i} className={`px-2 py-1.5 text-[9px] font-medium text-slate-500 ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                            {lbl}
                            {i < 9 && (
                              <span onPointerDown={e => empStartResize(i, e)} onClick={e => e.stopPropagation()}
                                className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70" title="Kéo để chỉnh độ rộng cột" />
                            )}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {employees.map(emp => {
                        const isDeleted = !!emp.deleted_at
                        const cats = emp.allowed_categories ?? []
                        const whList = emp.warehouse_access ?? []
                        return (
                        <TableRow key={emp.id}
                          className={`cursor-pointer ${isDeleted ? 'opacity-50 bg-slate-50' : ''} ${selectedEmp?.id === emp.id ? 'bg-slate-100' : isDeleted ? '' : 'hover:bg-slate-50'}`}
                          onClick={() => setSelectedEmp(prev => prev?.id === emp.id ? null : emp)}>
                          <TableCell className={`px-2 sticky left-0 z-10 ${selectedEmp?.id === emp.id ? 'bg-slate-100' : isDeleted ? 'bg-slate-50' : 'bg-white'}`}>
                            <span className={`font-medium block truncate ${isDeleted ? 'line-through text-slate-400' : 'text-slate-800'}`} title={emp.name}>{emp.name}</span>
                          </TableCell>
                          <TableCell className="px-2 font-mono font-semibold text-slate-600 truncate" title={emp.employee_code}>{emp.employee_code}</TableCell>
                          <TableCell className="px-2 text-slate-600 truncate" title={emp.email ?? '—'}>{emp.email ?? <span className="text-slate-300">—</span>}</TableCell>
                          <TableCell className="px-2 text-slate-600 truncate" title={emp.phone ?? '—'}>{emp.phone ?? <span className="text-slate-300">—</span>}</TableCell>
                          <TableCell className="px-2 text-slate-700 truncate" title={emp.dept?.name ?? '—'}>{emp.dept?.name ?? <span className="text-slate-300">—</span>}</TableCell>
                          <TableCell className="px-2 text-slate-600 truncate" title={emp.job_title?.name ?? '—'}>{emp.job_title?.name ?? <span className="text-slate-300">—</span>}</TableCell>
                          <TableCell className="px-2" title={cats.join(', ')}>
                            <div className="flex gap-1 overflow-hidden">
                              {cats.length === 0 ? <span className="text-slate-300">—</span> : cats.map(cat => (
                                <span key={cat} className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium
                                  ${whTypeBadgeCls(cat, whTypeMeta)}`}>{cat}</span>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="px-2"
                            title={emp.warehouse_scope === 'NATIONAL' ? 'Toàn quốc' : whList.map(wa => wa.warehouse?.name ?? wa.warehouse_id).join(', ')}>
                            {emp.warehouse_scope === 'NATIONAL' ? (
                              <span className="text-blue-600 font-medium">Toàn quốc</span>
                            ) : whList.length === 0 ? (
                              <span className="text-amber-600">Chưa gán kho</span>
                            ) : (
                              <div className="flex gap-1 overflow-hidden">
                                {whList.map(wa => (
                                  <span key={wa.warehouse_id} className="shrink-0 text-slate-600 bg-slate-100 rounded px-1.5 py-0.5">
                                    {wa.warehouse?.name ?? wa.warehouse_id}
                                  </span>
                                ))}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="px-2">
                            {isDeleted ? (
                              <Badge variant="secondary" className="text-[9px] text-amber-700 bg-amber-50">Đã ẩn</Badge>
                            ) : (
                              <Badge variant={emp.is_active ? 'default' : 'secondary'} className="text-[9px]">
                                {emp.is_active ? 'Hoạt động' : 'Tạm dừng'}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="px-2 py-2">
                            {isDeleted ? (
                              canDeleteEmp && (
                                <button title="Khôi phục"
                                  disabled={restoring}
                                  className="text-slate-400 hover:text-green-600 transition-colors p-1 disabled:opacity-50"
                                  onClick={e => { e.stopPropagation(); restore(emp.id) }}>
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                              )
                            ) : (
                              <div className="flex items-center gap-1">
                                {canSetPwd && (
                                  <button title="Đặt mật khẩu"
                                    className="text-slate-400 hover:text-amber-500 transition-colors p-1"
                                    onClick={e => { e.stopPropagation(); setPwdEmp(emp) }}>
                                    <KeyRound className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {canEditEmp && (
                                  <button title="Sửa thông tin"
                                    className="text-slate-400 hover:text-blue-500 transition-colors p-1"
                                    onClick={e => { e.stopPropagation(); setEditingEmp(emp); setShowEmpDlg(true) }}>
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {canDeleteEmp && emp.id !== user?.id && (
                                  <button title="Xóa nhân viên"
                                    className="text-slate-400 hover:text-red-500 transition-colors p-1"
                                    onClick={e => { e.stopPropagation(); setConfirmDeleteEmp(emp) }}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
            {selectedEmp && (
              <Card className="w-56 shrink-0 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">{selectedEmp.name}</span>
                  <button onClick={() => setSelectedEmp(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                </div>
                {/* Thao tác nhanh — khỏi phải kéo ngang bảng để thấy cột action */}
                {(selectedEmp.deleted_at
                  ? canDeleteEmp
                  : (canSetPwd || canEditEmp || (canDeleteEmp && selectedEmp.id !== user?.id))) && (
                  <div className="border-b pb-2">
                    <ActionCluster className="justify-start" items={selectedEmp.deleted_at
                      ? (canDeleteEmp ? [{
                          key: 'restore', icon: RotateCcw, label: 'Khôi phục', tip: 'Khôi phục nhân viên đã ẩn về danh sách',
                          primary: true, busy: restoring,
                          className: 'border-green-300 text-green-700 hover:bg-green-50',
                          onClick: () => restore(selectedEmp.id),
                        } satisfies ActionItem] : [])
                      : [
                          ...(canEditEmp ? [{
                            key: 'edit', icon: Pencil, label: 'Sửa', tip: 'Sửa thông tin nhân viên',
                            primary: true, variant: 'default',
                            onClick: () => { setEditingEmp(selectedEmp); setShowEmpDlg(true) },
                          } satisfies ActionItem] : []),
                          ...(canSetPwd ? [{
                            key: 'password', icon: KeyRound, label: 'Mật khẩu', tip: 'Đặt mật khẩu đăng nhập mới',
                            onClick: () => setPwdEmp(selectedEmp),
                          } satisfies ActionItem] : []),
                          ...(canDeleteEmp && selectedEmp.id !== user?.id ? [{
                            key: 'delete', icon: Trash2, label: 'Xóa', tip: 'Xóa nhân viên (không hoàn tác được)',
                            danger: true, className: 'border-red-200 text-red-600 hover:bg-red-50',
                            onClick: () => setConfirmDeleteEmp(selectedEmp),
                          } satisfies ActionItem] : []),
                        ]
                    } />
                  </div>
                )}
                <div><span className="text-slate-400">Mã NV:</span> <span className="font-mono font-medium">{selectedEmp.employee_code}</span></div>
                <div><span className="text-slate-400">Đăng nhập:</span> <span className="font-medium">{selectedEmp.email ?? '—'}</span></div>
                <div><span className="text-slate-400">SĐT:</span> <span className="font-medium">{selectedEmp.phone ?? '—'}</span></div>
                <div><span className="text-slate-400">Phòng ban:</span> <span className="font-medium">{selectedEmp.dept?.name ?? '—'}</span></div>
                <div><span className="text-slate-400">Chức danh:</span> <span className="font-medium">{selectedEmp.job_title?.name ?? '—'}</span></div>
                <div><span className="text-slate-400">Trạng thái:</span> <span className="font-medium">{selectedEmp.is_active ? 'Hoạt động' : 'Tạm dừng'}</span></div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Tạo / Sửa</p>
                  <div><span className="text-slate-400">Người tạo:</span> <span className="font-medium">{selectedEmp.created_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ tạo:</span> <span className="font-medium">{selectedEmp.created_at ? formatDateTime(selectedEmp.created_at) : '—'}</span></div>
                  <div><span className="text-slate-400">Người sửa:</span> <span className="font-medium">{selectedEmp.updated_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ sửa:</span> <span className="font-medium">{selectedEmp.updated_at ? formatDateTime(selectedEmp.updated_at) : '—'}</span></div>
                </div>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ── Tab: Phòng ban ── */}
        <TabsContent value="departments" className="flex-1 min-h-0 data-[state=active]:flex flex-col space-y-2">
          <div className="shrink-0 flex items-center justify-between flex-wrap gap-1.5">
            <p className="text-xs text-slate-500">{departments.length} phòng ban</p>
            <ActionCluster className="shrink-0 justify-end" items={[
              ...(isAdminUser ? [{
                key: 'create', icon: Plus, label: 'Thêm phòng ban', tip: 'Tạo phòng ban mới',
                primary: true, variant: 'default',
                onClick: () => { setEditingDept(null); setShowDeptDlg(true) },
              } satisfies ActionItem] : []),
            ]} />
          </div>
          <div className="flex gap-3 items-stretch flex-1 min-h-0">
            <Card className="flex-1 min-w-0 flex flex-col">
              {departments.length === 0 ? (
                <div className="p-12 text-center text-slate-400 space-y-2">
                  <Building2 className="h-10 w-10 mx-auto opacity-30" />
                  <p className="text-sm">Chưa có phòng ban nào</p>
                  {isAdminUser && (
                    <Button size="sm" variant="outline" onClick={() => { setEditingDept(null); setShowDeptDlg(true) }}>
                      <Plus className="h-4 w-4 mr-1" /> Thêm phòng ban đầu tiên
                    </Button>
                  )}
                </div>
              ) : (
                <div className="overflow-auto flex-1 min-h-0">
                  <Table className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap [&_td]:text-[10px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Mã</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Tên phòng ban</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Trạng thái</TableHead>
                        <TableHead className="px-2 py-1.5 w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {departments.map(d => (
                        <TableRow key={d.id}
                          className={`cursor-pointer ${selectedDept?.id === d.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                          onClick={() => setSelectedDept(prev => prev?.id === d.id ? null : d)}>
                          <TableCell className="px-2 py-1.5 font-mono font-semibold text-slate-600">{d.code}</TableCell>
                          <TableCell className="px-2 py-1.5 font-medium text-slate-800 truncate" title={d.name}>{d.name}</TableCell>
                          <TableCell className="px-2 py-1.5">
                            <Badge variant={d.is_active ? 'default' : 'secondary'} className="text-[9px]">
                              {d.is_active ? 'Hoạt động' : 'Tạm dừng'}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-2 py-1.5">
                            {isAdminUser && (
                              <button title="Sửa" className="text-slate-400 hover:text-blue-500 transition-colors p-1"
                                onClick={e => { e.stopPropagation(); setEditingDept(d); setShowDeptDlg(true) }}>
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
            {selectedDept && (
              <Card className="w-56 shrink-0 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">{selectedDept.code} — {selectedDept.name}</span>
                  <button onClick={() => setSelectedDept(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                </div>
                <div><span className="text-slate-400">Trạng thái:</span> <span className="font-medium">{selectedDept.is_active ? 'Hoạt động' : 'Tạm dừng'}</span></div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Tạo / Sửa</p>
                  <div><span className="text-slate-400">Người tạo:</span> <span className="font-medium">{selectedDept.created_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ tạo:</span> <span className="font-medium">{selectedDept.created_at ? formatDateTime(selectedDept.created_at) : '—'}</span></div>
                  <div><span className="text-slate-400">Người sửa:</span> <span className="font-medium">{selectedDept.updated_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ sửa:</span> <span className="font-medium">{selectedDept.updated_at ? formatDateTime(selectedDept.updated_at) : '—'}</span></div>
                </div>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ── Tab: Chức danh ── */}
        <TabsContent value="job-titles" className="flex-1 min-h-0 data-[state=active]:flex flex-col space-y-2">
          <div className="shrink-0 flex gap-2 flex-wrap items-center">
            <FilterSheetButton defs={jtFilterDefs} className="sm:hidden" />
            <span className="text-xs text-slate-500 mr-auto">{visibleJobTitles.length} chức danh</span>
            {/* Mobile: cluster chia sẻ hàng với nút Lọc (PDA) — mobileInline */}
            <ActionCluster className="shrink-0 justify-end" mobileInline items={[
              ...(isAdminUser ? [{
                key: 'create', icon: Plus, label: 'Thêm chức danh', tip: 'Tạo chức danh mới',
                primary: true, variant: 'default',
                onClick: () => { setEditingJt(null); setShowJtDlg(true) },
              } satisfies ActionItem] : []),
            ]} />
          </div>
          <FilterBar defs={jtFilterDefs} className="shrink-0 hidden sm:flex" />
          <div className="flex gap-3 items-stretch flex-1 min-h-0">
            <Card className="flex-1 min-w-0 flex flex-col">
              {visibleJobTitles.length === 0 ? (
                <div className="p-12 text-center text-slate-400 space-y-2">
                  <Briefcase className="h-10 w-10 mx-auto opacity-30" />
                  <p className="text-sm">Chưa có chức danh nào</p>
                  {isAdminUser && (
                    <Button size="sm" variant="outline" onClick={() => { setEditingJt(null); setShowJtDlg(true) }}>
                      <Plus className="h-4 w-4 mr-1" /> Thêm chức danh đầu tiên
                    </Button>
                  )}
                </div>
              ) : (
                <div className="overflow-auto flex-1 min-h-0">
                  <Table className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap [&_td]:text-[10px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Chức danh</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Phòng ban</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Trạng thái</TableHead>
                        <TableHead className="px-2 py-1.5 w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleJobTitles.map(jt => (
                        <TableRow key={jt.id}
                          className={`cursor-pointer ${selectedJt?.id === jt.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                          onClick={() => setSelectedJt(prev => prev?.id === jt.id ? null : jt)}>
                          <TableCell className="px-2 py-1.5 font-medium text-slate-800 truncate" title={jt.name}>{jt.name}</TableCell>
                          <TableCell className="px-2 py-1.5 text-slate-600 truncate" title={jt.department?.name ?? '—'}>{jt.department?.name ?? '—'}</TableCell>
                          <TableCell className="px-2 py-1.5">
                            <Badge variant={jt.is_active ? 'default' : 'secondary'} className="text-[9px]">
                              {jt.is_active ? 'Hoạt động' : 'Tạm dừng'}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-2 py-1.5">
                            {canEditJt(jt.id) && (
                              <button title="Sửa" className="text-slate-400 hover:text-blue-500 transition-colors p-1"
                                onClick={e => { e.stopPropagation(); setEditingJt(jt); setShowJtDlg(true) }}>
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
            {selectedJt && (
              <Card className="w-56 shrink-0 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">{selectedJt.name}</span>
                  <button onClick={() => setSelectedJt(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                </div>
                <div><span className="text-slate-400">Phòng ban:</span> <span className="font-medium">{selectedJt.department?.name ?? '—'}</span></div>
                <div><span className="text-slate-400">Trạng thái:</span> <span className="font-medium">{selectedJt.is_active ? 'Hoạt động' : 'Tạm dừng'}</span></div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Tạo / Sửa</p>
                  <div><span className="text-slate-400">Người tạo:</span> <span className="font-medium">{selectedJt.created_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ tạo:</span> <span className="font-medium">{selectedJt.created_at ? formatDateTime(selectedJt.created_at) : '—'}</span></div>
                  <div><span className="text-slate-400">Người sửa:</span> <span className="font-medium">{selectedJt.updated_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ sửa:</span> <span className="font-medium">{selectedJt.updated_at ? formatDateTime(selectedJt.updated_at) : '—'}</span></div>
                </div>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {showEmpDlg && (
        <EmployeeFormDialog emp={editingEmp} open={showEmpDlg} onClose={() => setShowEmpDlg(false)} />
      )}
      {pwdEmp && (
        <SetPasswordDialog emp={pwdEmp} open={!!pwdEmp} onClose={() => setPwdEmp(null)} />
      )}
      {showDeptDlg && (
        <DepartmentFormDialog dept={editingDept} open={showDeptDlg} onClose={() => setShowDeptDlg(false)} />
      )}
      {showJtDlg && (
        <JobTitleFormDialog jt={editingJt} open={showJtDlg} onClose={() => setShowJtDlg(false)} />
      )}
      {confirmDeleteEmp && (
        <ConfirmDeleteDialog emp={confirmDeleteEmp} open={!!confirmDeleteEmp} onClose={() => setConfirmDeleteEmp(null)} />
      )}
    </div>
  )
}
