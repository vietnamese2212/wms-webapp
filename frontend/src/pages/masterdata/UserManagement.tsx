import { useState, useEffect, useRef } from 'react'
import type { AxiosError } from 'axios'
import { Plus, Pencil, ShieldCheck, Building2, User2, KeyRound, Check, Briefcase, Copy, CheckCheck } from 'lucide-react'
import { SearchInput } from '@/components/shared/SearchInput'
import { Button }   from '@/components/ui/button'
import { Input }    from '@/components/ui/input'
import { Label }    from '@/components/ui/label'
import { Card }     from '@/components/ui/card'
import { Badge }    from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  useDepartments, useJobTitles, useEmployeeRecords,
  useCreateEmployee, useUpdateEmployee, useWarehouses,
  useCreateDepartment, useUpdateDepartment,
  useCreateJobTitle, useUpdateJobTitle,
} from '@/api/hooks'
import { apiClient } from '@/api/client'
import { MODULES, type ModuleKey } from '@/config/permissions'
import type { EmployeeRecord, Department, JobTitle, ModulePermissions } from '@/types'

// ─── Config ───────────────────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<string, string> = {
  'Thành phẩm': 'bg-emerald-100 text-emerald-700',
  'Nguyên vật liệu': 'bg-blue-100 text-blue-700',
  'POSM':       'bg-orange-100 text-orange-700',
  'Bao bì':     'bg-slate-100 text-slate-600',
}

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

// ─── Employee form dialog ─────────────────────────────────────────────────────

function EmployeeFormDialog({ emp, open, onClose }: { emp: EmployeeRecord | null; open: boolean; onClose: () => void }) {
  const isEdit = !!emp

  const { data: departments = [] } = useDepartments()
  const [deptId, setDeptId]   = useState(emp?.department_id ?? '')
  const { data: jobTitles = [] } = useJobTitles(deptId || undefined)
  const { data: warehouses = [] } = useWarehouses()
  const categoryOptions = ['Thành phẩm', 'NVL', 'POSM', 'Bao bì']

  const [name,         setName]         = useState(emp?.name          ?? '')
  const [empCode,      setEmpCode]      = useState(emp?.employee_code ?? '')
  const [email,        setEmail]        = useState(emp?.email         ?? '')
  const [phone,        setPhone]        = useState(emp?.phone         ?? '')
  const [jobTitleId,   setJobTitleId]   = useState(emp?.job_title_id  ?? '')
  const [categories,   setCategories]   = useState<string[]>(emp?.allowed_categories ?? ['Thành phẩm', 'NVL', 'POSM', 'Bao bì'])
  const [scope,        setScope]        = useState<'NATIONAL'|'ASSIGNED'>(emp?.warehouse_scope ?? 'ASSIGNED')
  const [warehouseIds, setWarehouseIds] = useState<string[]>(
    emp?.warehouse_access?.map(w => w.warehouse_id) ?? []
  )
  const [isActive, setIsActive] = useState(emp?.is_active ?? true)

  const deptIdMounted = useRef(false)

  useEffect(() => {
    if (!deptIdMounted.current) { deptIdMounted.current = true; return }
    setJobTitleId('')
  }, [deptId])

  const { mutate: create, isPending: creating, error: createErr } = useCreateEmployee()
  const { mutate: update, isPending: updating, error: updateErr } = useUpdateEmployee()
  const isPending = creating || updating

  const apiError = ((createErr ?? updateErr) as AxiosError<{ error: { message: string } }>)
    ?.response?.data?.error?.message

  const [createdInfo, setCreatedInfo] = useState<{ name: string; login: string; password: string } | null>(null)
  const [copied, setCopied] = useState(false)

  function copyPassword(pwd: string) {
    navigator.clipboard.writeText(pwd)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function toggleCategory(cat: string) {
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
      allowed_categories: categories,
      warehouse_scope: scope,
      warehouse_ids: scope === 'ASSIGNED' ? warehouseIds : [],
    }
    if (isEdit) {
      update({ id: emp.id, ...payload, is_active: isActive }, { onSuccess: onClose })
    } else {
      create(payload, {
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
      <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              <Check className="h-5 w-5" /> Tạo tài khoản thành công
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
          <DialogFooter>
            <Button onClick={onClose}>Đóng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Sửa nhân viên' : 'Thêm nhân viên'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {apiError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{apiError}</div>
          )}

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
              <Label className="text-xs">Tên đăng nhập</Label>
              <Input type="text" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email hoặc tên bất kỳ" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">SĐT</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Phòng ban</Label>
              <Select value={deptId || '__none__'} onValueChange={v => setDeptId(v === '__none__' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Chọn phòng ban" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Không chọn —</SelectItem>
                  {departments.map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Chức danh (template)</Label>
              <Select value={jobTitleId || '__none__'} onValueChange={v => setJobTitleId(v === '__none__' ? '' : v)} disabled={!deptId}>
                <SelectTrigger><SelectValue placeholder="Chọn chức danh" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Không chọn —</SelectItem>
                  {jobTitles.map(jt => (
                    <SelectItem key={jt.id} value={jt.id}>{jt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                        ? (CATEGORY_COLOR[cat] ?? 'bg-emerald-100 text-emerald-700') + ' border-transparent'
                        : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'}`}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>

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

            {scope === 'ASSIGNED' && (
              <div className="space-y-1">
                <Label className="text-xs">Kho được phép</Label>
                <div className="flex gap-2 flex-wrap">
                  {warehouses.map((w: { id: string; code: string; name: string }) => (
                    <button key={w.id} type="button" onClick={() => toggleWarehouse(w.id)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-all
                        ${warehouseIds.includes(w.id)
                          ? 'bg-blue-100 text-blue-800 border-transparent'
                          : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'}`}>
                      {w.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {isEdit && (
            <div className="flex items-center gap-2">
              <input id="is-active" type="checkbox" checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded accent-blue-600" />
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
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Sửa phòng ban' : 'Thêm phòng ban'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
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
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button onClick={handleSubmit} disabled={isPending || !name || !code}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Job title form dialog ────────────────────────────────────────────────────

function JobTitleFormDialog({ jt, open, onClose }: { jt: JobTitle | null; open: boolean; onClose: () => void }) {
  const isEdit = !!jt
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

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Sửa chức danh' : 'Thêm chức danh'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          {apiError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{apiError}</div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Tên chức danh *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Thủ kho, Lái xe nâng…" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Phòng ban *</Label>
            <Select value={deptId || '__none__'} onValueChange={v => setDeptId(v === '__none__' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Chọn phòng ban" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Chọn phòng ban —</SelectItem>
                {departments.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-600 flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5" /> Phân quyền module
            </p>
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {(Object.entries(MODULES) as [ModuleKey, typeof MODULES[ModuleKey]][]).map(([modKey, modDef]) => {
                const grantedActions = (modulePerms[modKey] ?? []) as string[]
                const hasAny = grantedActions.length > 0
                return (
                  <div key={modKey} className={`rounded-lg border p-3 ${hasAny ? 'border-blue-200 bg-blue-50/50' : 'border-slate-200'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <p className={`text-xs font-semibold ${hasAny ? 'text-blue-700' : 'text-slate-500'}`}>
                        {modDef.label}
                      </p>
                      {(() => {
                        const allActions = Object.keys(modDef.actions)
                        const isAll = allActions.every(a => grantedActions.includes(a))
                        return (
                          <button
                            type="button"
                            onClick={() => setModulePerms(prev => ({
                              ...prev,
                              [modKey]: isAll ? undefined : allActions,
                            }))}
                            className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${
                              isAll
                                ? 'bg-blue-600 text-white hover:bg-blue-700'
                                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                            }`}
                          >
                            Tất cả
                          </button>
                        )
                      })()}
                    </div>
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
                  </div>
                )
              })}
            </div>
          </div>

          {isEdit && (
            <div className="flex items-center gap-2">
              <input id="jt-active" type="checkbox" checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded accent-blue-600" />
              <Label htmlFor="jt-active" className="text-sm cursor-pointer">Đang hoạt động</Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button onClick={handleSubmit} disabled={isPending || !name || !deptId}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function UserManagement() {
  const [search,     setSearch]     = useState('')
  const [filterDept, setFilterDept] = useState('__all__')
  const [editingEmp, setEditingEmp] = useState<EmployeeRecord | null>(null)
  const [showEmpDlg, setShowEmpDlg] = useState(false)
  const [pwdEmp,     setPwdEmp]     = useState<EmployeeRecord | null>(null)

  const [editingDept, setEditingDept] = useState<Department | null>(null)
  const [showDeptDlg, setShowDeptDlg] = useState(false)

  const [editingJt,  setEditingJt]  = useState<JobTitle | null>(null)
  const [showJtDlg,  setShowJtDlg]  = useState(false)
  const [filterDeptJt, setFilterDeptJt] = useState('__all__')

  const { data: departments = [] } = useDepartments()
  const { data: jobTitles = [] }   = useJobTitles(filterDeptJt === '__all__' ? undefined : filterDeptJt)
  const { data: employees = [], isLoading, isError, error } = useEmployeeRecords({
    department_id: filterDept === '__all__' ? undefined : filterDept,
    search: search || undefined,
  })

  return (
    <div className="p-4 space-y-4 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
          <User2 className="h-5 w-5 text-slate-500" />
          Quản lý nhân sự &amp; phân quyền
        </h1>
      </div>

      <Tabs defaultValue="employees">
        <TabsList className="mb-2">
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

        {/* ── Tab: Nhân viên ── */}
        <TabsContent value="employees" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">{employees.length} nhân viên</p>
            <Button size="sm" className="gap-1.5" onClick={() => { setEditingEmp(null); setShowEmpDlg(true) }}>
              <Plus className="h-4 w-4" /> Thêm nhân viên
            </Button>
          </div>

          <div className="flex gap-2 flex-wrap">
            <SearchInput value={search} onChange={setSearch} placeholder="Tìm tên, mã, đăng nhập…" className="flex-1 min-w-[200px]" />
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

          {isError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              Lỗi tải dữ liệu: {(error as { message?: string })?.message ?? 'Không kết nối được backend'}
            </div>
          )}

          <Card>
            {isLoading ? (
              <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div>
            ) : employees.length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <User2 className="h-10 w-10 mx-auto opacity-30" />
                <p className="text-sm">Chưa có nhân viên nào</p>
                <Button size="sm" variant="outline" onClick={() => { setEditingEmp(null); setShowEmpDlg(true) }}>
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
                      <TableHead className="px-3 py-2 text-xs">Loại hàng</TableHead>
                      <TableHead className="px-3 py-2 text-xs">Kho</TableHead>
                      <TableHead className="px-3 py-2 text-xs">Trạng thái</TableHead>
                      <TableHead className="px-3 py-2 w-16" />
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
                          <div className="flex gap-1 flex-wrap">
                            {(emp.allowed_categories ?? []).map(cat => (
                              <span key={cat} className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium
                                ${CATEGORY_COLOR[cat] ?? 'bg-slate-100 text-slate-600'}`}>{cat}</span>
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
                          <div className="flex items-center gap-1">
                            <button title="Đặt mật khẩu"
                              className="text-slate-400 hover:text-amber-500 transition-colors p-1"
                              onClick={() => setPwdEmp(emp)}>
                              <KeyRound className="h-3.5 w-3.5" />
                            </button>
                            <button title="Sửa thông tin"
                              className="text-slate-400 hover:text-blue-500 transition-colors p-1"
                              onClick={() => { setEditingEmp(emp); setShowEmpDlg(true) }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ── Tab: Phòng ban ── */}
        <TabsContent value="departments" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">{departments.length} phòng ban</p>
            <Button size="sm" className="gap-1.5" onClick={() => { setEditingDept(null); setShowDeptDlg(true) }}>
              <Plus className="h-4 w-4" /> Thêm phòng ban
            </Button>
          </div>
          <Card>
            {departments.length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <Building2 className="h-10 w-10 mx-auto opacity-30" />
                <p className="text-sm">Chưa có phòng ban nào</p>
                <Button size="sm" variant="outline" onClick={() => { setEditingDept(null); setShowDeptDlg(true) }}>
                  <Plus className="h-4 w-4 mr-1" /> Thêm phòng ban đầu tiên
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-3 py-2 text-xs">Mã</TableHead>
                      <TableHead className="px-3 py-2 text-xs">Tên phòng ban</TableHead>
                      <TableHead className="px-3 py-2 text-xs">Trạng thái</TableHead>
                      <TableHead className="px-3 py-2 w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {departments.map(d => (
                      <TableRow key={d.id} className="text-sm">
                        <TableCell className="px-3 py-2 font-mono font-semibold text-slate-600 text-[11px]">{d.code}</TableCell>
                        <TableCell className="px-3 py-2 font-medium text-slate-800">{d.name}</TableCell>
                        <TableCell className="px-3 py-2">
                          <Badge variant={d.is_active ? 'default' : 'secondary'} className="text-xs">
                            {d.is_active ? 'Hoạt động' : 'Tạm dừng'}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-2 py-2">
                          <button title="Sửa" className="text-slate-400 hover:text-blue-500 transition-colors p-1"
                            onClick={() => { setEditingDept(d); setShowDeptDlg(true) }}>
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
        </TabsContent>

        {/* ── Tab: Chức danh ── */}
        <TabsContent value="job-titles" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">{jobTitles.length} chức danh</p>
            <Button size="sm" className="gap-1.5" onClick={() => { setEditingJt(null); setShowJtDlg(true) }}>
              <Plus className="h-4 w-4" /> Thêm chức danh
            </Button>
          </div>
          <Select value={filterDeptJt} onValueChange={setFilterDeptJt}>
            <SelectTrigger className="h-8 text-sm w-[200px]">
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
          <Card>
            {jobTitles.length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-2">
                <Briefcase className="h-10 w-10 mx-auto opacity-30" />
                <p className="text-sm">Chưa có chức danh nào</p>
                <Button size="sm" variant="outline" onClick={() => { setEditingJt(null); setShowJtDlg(true) }}>
                  <Plus className="h-4 w-4 mr-1" /> Thêm chức danh đầu tiên
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-3 py-2 text-xs">Chức danh</TableHead>
                      <TableHead className="px-3 py-2 text-xs">Phòng ban</TableHead>
                      <TableHead className="px-3 py-2 text-xs">Trạng thái</TableHead>
                      <TableHead className="px-3 py-2 w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobTitles.map(jt => (
                      <TableRow key={jt.id} className="text-sm">
                        <TableCell className="px-3 py-2 font-medium text-slate-800">{jt.name}</TableCell>
                        <TableCell className="px-3 py-2 text-slate-600 text-xs">{jt.department?.name ?? '—'}</TableCell>
                        <TableCell className="px-3 py-2">
                          <Badge variant={jt.is_active ? 'default' : 'secondary'} className="text-xs">
                            {jt.is_active ? 'Hoạt động' : 'Tạm dừng'}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-2 py-2">
                          <button title="Sửa" className="text-slate-400 hover:text-blue-500 transition-colors p-1"
                            onClick={() => { setEditingJt(jt); setShowJtDlg(true) }}>
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
    </div>
  )
}
