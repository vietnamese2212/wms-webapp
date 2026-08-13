import { useState, useEffect, useRef } from 'react'
import type { AxiosError } from 'axios'
import { Plus, Pencil, ShieldCheck, Building2, User2, KeyRound, Check, Briefcase, Copy, CheckCheck, Trash2, RotateCcw, X, Warehouse, Rows3, AlignJustify } from 'lucide-react'
import { WarehouseMultiSelect } from '@/components/shared/WarehouseMultiSelect'
import { formatDateTime, normalizePhone } from '@/utils/formatters'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SavedViews } from '@/components/shared/SavedViews'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { PagerNav, ListFooter } from '@/components/shared/ListPager'
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
  useDepartments, useJobTitles, useEmployeesPaged,
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

// MÃ u badge Loáº¡i kho theo cá» per-loáº¡i (LookupValue.meta) â€” whTypeBadgeCls tá»« utils/cargoCategory

// â”€â”€â”€ Set password dialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    if (password.length < 6) { setError('Máº­t kháº©u pháº£i cÃ³ Ã­t nháº¥t 6 kÃ½ tá»±'); return }
    if (password !== confirm) { setError('XÃ¡c nháº­n máº­t kháº©u khÃ´ng khá»›p'); return }
    setSaving(true)
    try {
      await apiClient.patch(`/masterdata/employees/${emp.id}/set-password`, { password })
      setSuccess(true)
    } catch (err) {
      const msg = (err as AxiosError<{ error: { message: string } }>)
        ?.response?.data?.error?.message ?? 'Lá»—i Ä‘áº·t máº­t kháº©u'
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
            Äáº·t máº­t kháº©u â€” {emp.name}
          </DialogTitle>
        </DialogHeader>
        {success ? (
          <div className="py-4 text-center space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 mx-auto">
              <Check className="h-6 w-6 text-green-600" />
            </div>
            <p className="text-sm text-slate-700">Äáº·t máº­t kháº©u thÃ nh cÃ´ng!</p>
            <p className="text-xs text-slate-500">NhÃ¢n viÃªn cÃ³ thá»ƒ Ä‘Äƒng nháº­p báº±ng tÃªn Ä‘Äƒng nháº­p vÃ  máº­t kháº©u má»›i.</p>
            <Button size="sm" onClick={() => { reset(); onClose() }}>ÄÃ³ng</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 py-1">
            <div className="space-y-1">
              <Label className="text-xs">Máº­t kháº©u má»›i</Label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Tá»‘i thiá»ƒu 6 kÃ½ tá»±" autoComplete="new-password" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">XÃ¡c nháº­n máº­t kháº©u</Label>
              <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="Nháº­p láº¡i máº­t kháº©u" autoComplete="new-password" />
            </div>
            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{error}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => { reset(); onClose() }}>Huá»·</Button>
              <Button type="submit" size="sm" disabled={saving || !password || !confirm}>
                {saving ? 'Äang lÆ°uâ€¦' : 'Äáº·t máº­t kháº©u'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// â”€â”€â”€ Confirm delete dialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
          ?.response?.data?.error?.message ?? 'Lá»—i xÃ³a nhÃ¢n viÃªn'
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
              <Trash2 className="h-4 w-4" /> ÄÃ£ áº©n nhÃ¢n viÃªn
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 py-2">
            <span className="font-semibold">{emp.name}</span> cÃ³ lá»‹ch sá»­ hoáº¡t Ä‘á»™ng trong há»‡ thá»‘ng nÃªn Ä‘Æ°á»£c áº©n khá»i danh sÃ¡ch thay vÃ¬ xÃ³a háº³n. Dá»¯ liá»‡u lá»‹ch sá»­ váº«n Ä‘Æ°á»£c giá»¯ láº¡i.
          </p>
          <DialogFooter>
            <Button size="sm" onClick={onClose}>ÄÃ³ng</Button>
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
            <Trash2 className="h-4 w-4" /> XÃ³a nhÃ¢n viÃªn
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <p className="text-sm text-slate-700">
            Báº¡n cÃ³ cháº¯c muá»‘n xÃ³a <span className="font-semibold">{emp.name}</span> ({emp.employee_code})?
            HÃ nh Ä‘á»™ng nÃ y khÃ´ng thá»ƒ hoÃ n tÃ¡c.
          </p>
          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>Há»§y</Button>
          <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isPending}>
            {isPending ? 'Äang xÃ³aâ€¦' : 'XÃ³a'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// â”€â”€â”€ Employee form dialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function EmployeeFormDialog({ emp, open, onClose }: { emp: EmployeeRecord | null; open: boolean; onClose: () => void }) {
  const isEdit = !!emp
  const me = useAuthStore(s => s.user)
  const fullEdit = isAdmin(me)          // chá»‰ Admin Ä‘Æ°á»£c sá»­a toÃ n bá»™ há»“ sÆ¡
  const skillOnly = isEdit && !fullEdit        // non-admin: chá»‰ chá»‰nh Ká»¹ nÄƒng / Vá»‹ trÃ­

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
  const isDriverRole     = selectedDeptName === 'ÄÆ¡n vá»‹ váº­n táº£i' && selectedJtName === 'LÃ¡i xe'
  const isDispatcherRole = selectedDeptName === 'ÄÆ¡n vá»‹ váº­n táº£i' && !!jobTitleId && !isDriverRole

  // Chá»‰ gá»i khi thá»±c sá»± cáº§n gÃ¡n xe cho tÃ i khoáº£n LÃ¡i xe â€” trÆ°á»›c Ä‘Ã¢y cÃ¡c trÆ°á»ng há»£p cÃ²n láº¡i
  // truyá»n params `undefined` nÃªn váº«n táº£i TOÃ€N Bá»˜ Ä‘á»™i xe (953 xe â‰ˆ 439KB) mÃ  khÃ´ng dÃ¹ng Ä‘áº¿n.
  const { data: allVehicles = [] } = useTmsVehicles(
    isDriverRole && nccId && !isEdit ? { ncc_id: nccId, is_active: 'true', unassigned: 'true' } : undefined,
    !!(isDriverRole && nccId && !isEdit),
  )
  const selectedVehicle = isDriverRole && !isEdit ? (allVehicles as TmsVehicle[]).find(v => v.id === driverVehicleId) ?? null : null

  const deptIdMounted      = useRef(false)
  const defaultCatApplied  = useRef(false)

  useEffect(() => {
    if (!deptIdMounted.current) { deptIdMounted.current = true; return }
    setJobTitleId('')
  }, [deptId])

  // Khi táº¡o má»›i (khÃ´ng cÃ³ emp), máº·c Ä‘á»‹nh chá»n táº¥t cáº£ loáº¡i kho
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
      // Dá»n giÃ¡ trá»‹ ngoÃ i danh má»¥c hiá»‡n hÃ nh (taxonomy cÅ© NVL/Bao bÃ¬ cÃ²n sÃ³t trong DB)
      allowed_categories: categoryOptions.length > 0
        ? categories.filter(c => categoryOptions.includes(c))
        : categories,
      warehouse_scope: scope,
      warehouse_ids: scope === 'ASSIGNED' ? warehouseIds : [],
      ncc_id: (isDriverRole || isDispatcherRole) ? (nccId || null) : null,
      is_driver: isDriverRole,
    }
    // Biá»ƒn sá»‘ khÃ³a khi edit driver â€” khÃ´ng gá»­i employee_code (Ä‘á»•i qua TMS Settings)
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
        title={<span className="flex items-center gap-2 text-green-700"><Check className="h-5 w-5" /> Táº¡o tÃ i khoáº£n thÃ nh cÃ´ng</span>}
        footer={<Button onClick={onClose}>ÄÃ³ng</Button>}
      >
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              TÃ i khoáº£n <span className="font-semibold text-slate-800">{createdInfo.name}</span> Ä‘Ã£ Ä‘Æ°á»£c táº¡o.
              Cáº¥p thÃ´ng tin Ä‘Äƒng nháº­p dÆ°á»›i Ä‘Ã¢y cho nhÃ¢n viÃªn:
            </p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 divide-y divide-slate-200">
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-xs text-slate-500">TÃªn Ä‘Äƒng nháº­p</span>
                <span className="text-sm font-mono font-semibold text-slate-800">{createdInfo.login}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-xs text-slate-500">Máº­t kháº©u táº¡m</span>
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
              NhÃ¢n viÃªn nÃªn Ä‘á»•i máº­t kháº©u sau láº§n Ä‘Äƒng nháº­p Ä‘áº§u tiÃªn.
            </p>
          </div>
      </FormSheet>
    )
  }

  // Non-admin: chá»‰ cho chá»‰nh Ká»¹ nÄƒng / Vá»‹ trÃ­, khÃ´ng sá»­a há»“ sÆ¡
  if (skillOnly && emp) {
    return (
      <FormSheet
        open={open} onClose={onClose}
        title={`Ká»¹ nÄƒng / Vá»‹ trÃ­ â€” ${emp.name}`}
        footer={<Button variant="outline" onClick={onClose}>ÄÃ³ng</Button>}
      >
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <p className="font-medium text-slate-800">{emp.name}</p>
              <p className="text-xs text-slate-500">{emp.employee_code} Â· {emp.dept?.name ?? 'â€”'} Â· {emp.job_title?.name ?? 'â€”'}</p>
            </div>
            {emp.job_title_id
              ? <EmployeeSkillSection employeeId={emp.id} />
              : <p className="text-xs text-amber-600">NhÃ¢n viÃªn chÆ°a cÃ³ chá»©c danh â€” khÃ´ng thá»ƒ gÃ¡n ká»¹ nÄƒng.</p>}
            <p className="text-[11px] text-slate-400">Chá»‰ Admin má»›i sá»­a Ä‘Æ°á»£c há»“ sÆ¡. Báº¡n chá»‰ chá»‰nh Ká»¹ nÄƒng / Vá»‹ trÃ­.</p>
          </div>
      </FormSheet>
    )
  }

  return (
    <FormSheet
      open={open} onClose={onClose}
      title={isEdit ? 'Sá»­a nhÃ¢n viÃªn' : 'ThÃªm nhÃ¢n viÃªn'}
      footer={<>
        <Button variant="outline" onClick={onClose}>Huá»·</Button>
        <Button onClick={handleSubmit} disabled={isPending || !showRestOfForm || !name || (isDriverRole ? (!isEdit && !driverVehicleId) : !empCode)}>
          {isPending ? 'Äang lÆ°uâ€¦' : isEdit ? 'LÆ°u' : 'Táº¡o nhÃ¢n viÃªn'}
        </Button>
      </>}
    >
        <div className="space-y-4">
          {apiError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{apiError}</div>
          )}

          {/* PhÃ²ng ban + Chá»©c danh â€” luÃ´n hiá»ƒn thá»‹ Ä‘áº§u tiÃªn */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">PhÃ²ng ban</Label>
              <SingleSelect
                value={deptId || '__none__'}
                onChange={v => setDeptId(v === '__none__' ? '' : v)}
                placeholder="Chá»n phÃ²ng ban"
                searchPlaceholder="TÃ¬m phÃ²ng banâ€¦"
                options={[{ value: '__none__', label: 'â€” KhÃ´ng chá»n â€”' }, ...departments.map(d => ({ value: d.id, label: d.name }))]}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Chá»©c danh (template)</Label>
              <SingleSelect
                value={jobTitleId || '__none__'}
                onChange={v => setJobTitleId(v === '__none__' ? '' : v)}
                disabled={!deptId && !jobTitleId}
                placeholder="Chá»n chá»©c danh"
                searchPlaceholder="TÃ¬m chá»©c danhâ€¦"
                options={[{ value: '__none__', label: 'â€” KhÃ´ng chá»n â€”' }, ...jobTitles.map(jt => ({ value: jt.id, label: jt.name }))]}
              />
            </div>
          </div>

          {!isEdit && !showRestOfForm && (
            <p className="text-xs text-center text-slate-400 py-2">Chá»n phÃ²ng ban vÃ  chá»©c danh Ä‘á»ƒ tiáº¿p tá»¥c</p>
          )}

          {showRestOfForm && (
            <>
              {(isDriverRole || isDispatcherRole) && (
                <div className="space-y-1">
                  <Label className="text-xs">CÃ´ng ty váº­n táº£i (ÄVVT) *</Label>
                  <SingleSelect
                    value={nccId || '__none__'}
                    onChange={v => {
                      const next = v === '__none__' ? '' : v
                      setNccId(next)
                      if (isDriverRole) setDriverVehicleId('')
                    }}
                    disabled={lockDriverPlate}
                    placeholder="â€” Chá»n cÃ´ng ty â€”"
                    searchPlaceholder="TÃ¬m ÄVVTâ€¦"
                    options={[{ value: '__none__', label: 'â€” Chá»n cÃ´ng ty â€”' }, ...(transportCompanies as { id: string; name: string }[]).map(tc => ({ value: tc.id, label: tc.name }))]}
                  />
                  {lockDriverPlate && (
                    <p className="text-[10px] text-slate-400">Äá»•i biá»ƒn sá»‘ qua CÃ i Ä‘áº·t TMS â†’ thÃ´ng tin sáº½ tá»± cáº­p nháº­t</p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Há» tÃªn *</Label>
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder="Nguyá»…n VÄƒn A" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{isDriverRole ? 'Biá»ƒn sá»‘ xe *' : 'MÃ£ NV *'}</Label>
                  {isDriverRole && lockDriverPlate ? (
                    <Input value={emp?.employee_code ?? ''} disabled className="bg-slate-50 cursor-not-allowed" />
                  ) : isDriverRole ? (
                    <SingleSelect
                      value={driverVehicleId || '__none__'}
                      onChange={v => setDriverVehicleId(v === '__none__' ? '' : v)}
                      disabled={!nccId}
                      placeholder={nccId ? 'Chá»n biá»ƒn sá»‘ xe' : 'Chá»n ÄVVT trÆ°á»›c'}
                      searchPlaceholder="TÃ¬m biá»ƒn sá»‘â€¦"
                      options={[{ value: '__none__', label: 'â€” Chá»n biá»ƒn sá»‘ xe â€”' }, ...(allVehicles as TmsVehicle[]).map(v => ({ value: v.id, label: v.license_plate }))]}
                    />
                  ) : (
                    <Input value={empCode} onChange={e => setEmpCode(e.target.value)} placeholder="NV001" />
                  )}
                  {lockDriverPlate && (
                    <p className="text-[10px] text-slate-400">Äá»•i qua CÃ i Ä‘áº·t TMS</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">TÃªn Ä‘Äƒng nháº­p</Label>
                  <Input type="text" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="Email hoáº·c tÃªn báº¥t ká»³"
                    disabled={lockIdentity} className={lockIdentity ? 'bg-slate-50 cursor-not-allowed' : ''} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">SÄT</Label>
                  <Input value={phone} onChange={e => setPhone(normalizePhone(e.target.value))} inputMode="numeric" placeholder="09xxxxxxxx" />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 p-3 space-y-3 bg-slate-50">
                <div className="space-y-1">
                  <Label className="text-xs">Loáº¡i hÃ ng Ä‘Æ°á»£c phÃ©p</Label>
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
                  <Label className="text-xs">Pháº¡m vi kho</Label>
                  <SingleSelect
                    value={scope}
                    onChange={v => setScope(v as 'NATIONAL'|'ASSIGNED')}
                    searchable={false}
                    options={[
                      { value: 'NATIONAL', label: 'ToÃ n quá»‘c (táº¥t cáº£ kho)' },
                      { value: 'ASSIGNED', label: 'Kho Ä‘Æ°á»£c chá»‰ Ä‘á»‹nh' },
                    ]}
                  />
                </div>

                {scope === 'ASSIGNED' && (
                  <div className="space-y-1">
                    <Label className="text-xs">Kho Ä‘Æ°á»£c phÃ©p</Label>
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
                  <Label htmlFor="is-active" className="text-sm cursor-pointer">TÃ i khoáº£n Ä‘ang hoáº¡t Ä‘á»™ng</Label>
                </div>
              )}
            </>
          )}
        </div>
    </FormSheet>
  )
}

// â”€â”€â”€ Department form dialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
      title={isEdit ? 'Sá»­a phÃ²ng ban' : 'ThÃªm phÃ²ng ban'}
      footer={<>
        <Button variant="outline" onClick={onClose}>Huá»·</Button>
        <Button onClick={handleSubmit} disabled={isPending || !name || !code}>
          {isPending ? 'Äang lÆ°uâ€¦' : isEdit ? 'LÆ°u' : 'Táº¡o'}
        </Button>
      </>}
    >
        <div className="space-y-3">
          {apiError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{apiError}</div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">TÃªn phÃ²ng ban *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Kho, Báº£o vá»‡, QAâ€¦" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">MÃ£ *</Label>
            <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="KHO, BV, QAâ€¦" />
          </div>
          {isEdit && (
            <div className="flex items-center gap-2">
              <input id="dept-active" type="checkbox" checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded accent-blue-600" />
              <Label htmlFor="dept-active" className="text-sm cursor-pointer">Äang hoáº¡t Ä‘á»™ng</Label>
            </div>
          )}
        </div>
    </FormSheet>
  )
}

// â”€â”€â”€ Job title form dialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function JobTitleFormDialog({ jt, open, onClose }: { jt: JobTitle | null; open: boolean; onClose: () => void }) {
  const isEdit = !!jt
  const me = useAuthStore(s => s.user)
  const fullEdit = isAdmin(me)            // chá»‰ Admin sá»­a tÃªn/phÃ²ng ban/phÃ¢n quyá»n
  const skillOnly = isEdit && !fullEdit          // non-admin: chá»‰ Danh má»¥c Vá»‹ trÃ­/Skill (chá»©c danh cáº¥p dÆ°á»›i)
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

  // Non-admin: chá»‰ cho sá»­a Danh má»¥c Vá»‹ trÃ­/Skill (BE Ä‘Ã£ cháº·n chá»‰ chá»©c danh cáº¥p dÆ°á»›i)
  if (skillOnly && jt) {
    return (
      <FormSheet
        open={open} onClose={onClose}
        title={`Vá»‹ trÃ­ / Skill â€” ${jt.name}`}
        footer={<Button variant="outline" onClick={onClose}>ÄÃ³ng</Button>}
      >
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <p className="font-medium text-slate-800">{jt.name}</p>
              <p className="text-xs text-slate-500">{jt.department?.name ?? 'â€”'}</p>
            </div>
            <JobTitleSkillSection jobTitleId={jt.id} />
            <p className="text-[11px] text-slate-400">Chá»‰ Admin má»›i sá»­a tÃªn/phÃ²ng ban/phÃ¢n quyá»n. Báº¡n chá»‰ chá»‰nh Danh má»¥c Vá»‹ trÃ­/Skill cá»§a chá»©c danh cáº¥p dÆ°á»›i.</p>
          </div>
      </FormSheet>
    )
  }

  return (
    <FormSheet
      open={open} onClose={onClose}
      title={isEdit ? 'Sá»­a chá»©c danh' : 'ThÃªm chá»©c danh'}
      footer={<>
        <Button variant="outline" onClick={onClose}>Huá»·</Button>
        <Button onClick={handleSubmit} disabled={isPending || !name || !deptId}>
          {isPending ? 'Äang lÆ°uâ€¦' : isEdit ? 'LÆ°u' : 'Táº¡o'}
        </Button>
      </>}
    >
        <div className="space-y-4">
          {apiError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{apiError}</div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">TÃªn chá»©c danh *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Thá»§ kho, LÃ¡i xe nÃ¢ngâ€¦" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">PhÃ²ng ban *</Label>
            <SingleSelect
              value={deptId || '__none__'}
              onChange={v => setDeptId(v === '__none__' ? '' : v)}
              placeholder="Chá»n phÃ²ng ban"
              searchPlaceholder="TÃ¬m phÃ²ng banâ€¦"
              options={[{ value: '__none__', label: 'â€” Chá»n phÃ²ng ban â€”' }, ...departments.map(d => ({ value: d.id, label: d.name }))]}
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-600 flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5" /> PhÃ¢n quyá»n module
            </p>
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {PERMISSION_PAGES.map(({ page, modules }) => {
                const mods = modules.map(k => [k, MODULES[k]] as [ModuleKey, typeof MODULES[ModuleKey]])
                const multi = mods.length > 1                                            // trang nhiá»u tab
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
                        Táº¥t cáº£
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
                        // Trang Ä‘Æ¡n (1 module): hiá»‡n tháº³ng lÆ°á»›i action.
                        if (!multi) return <div key={modKey}>{actionsGrid}</div>
                        // Trang nhiá»u tab: má»—i tab = card riÃªng cÃ³ bÄƒng tiÃªu Ä‘á» (accent sky) Ä‘á»ƒ tÃ¡ch báº¡ch.
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
                                Táº¥t cáº£
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
              <Label htmlFor="jt-active" className="text-sm cursor-pointer">Äang hoáº¡t Ä‘á»™ng</Label>
            </div>
          )}
        </div>
    </FormSheet>
  )
}

// â”€â”€â”€ Main page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function UserManagement() {
  const user = useAuthStore(s => s.user)
  const whTypeMeta = useWhTypeMetaMap()
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canCreateEmp = can(perms, 'user_admin', 'create')
  const canEditEmp   = can(perms, 'user_admin', 'edit')
  const canSetPwd    = can(perms, 'user_admin', 'set_password')
  const canDeleteEmp = can(perms, 'user_admin', 'delete')
  // Cáº¥u trÃºc phÃ²ng ban/chá»©c danh & phÃ¢n quyá»n: chá»‰ Admin. Danh má»¥c Vá»‹ trÃ­/Skill: Admin hoáº·c ngÆ°á»i cÃ³
  // work_skill.manage cho chá»©c danh Cáº¤P DÆ¯á»šI mÃ¬nh (theo sÆ¡ Ä‘á»“ chá»©c danh).
  const isAdminUser    = isAdmin(user)
  // "Quáº£n lÃ½ skill" = cÃ³ báº¥t ká»³ quyá»n ghi danh má»¥c Vá»‹ trÃ­/Skill (create/edit/delete)
  const canManageSkill = can(perms, 'work_skill', 'create') || can(perms, 'work_skill', 'edit') || can(perms, 'work_skill', 'delete')
  const { data: allJts = [] } = useJobTitles()
  const { data: allWarehouses = [] } = useWarehouses()   // Ã´ chá»n Kho láº¥y tá»« danh má»¥c gá»‘c
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
  const setSearch       = (v: string) => setUserAdmin({ search: v, page: 1 })
  const setFilterDept   = (v: string) => setUserAdmin({ deptId: v })
  const setFilterJt     = (v: string) => setUserAdmin({ jtId: v })
  const setFilterWh     = (v: string) => setUserAdmin({ warehouseId: v })
  const setStatusFilter = (v: 'active' | 'hidden' | 'all') => setUserAdmin({ status: v })
  const setFilterDeptJt = (v: string) => setUserAdmin({ jtDept: v })
  const [dense, setDense] = useState(() => localStorage.getItem('user_admin_density') === '1')
  const toggleDense = () => setDense(d => { localStorage.setItem('user_admin_density', d ? '0' : '1'); return !d })
  // Cá»™t tab NhÃ¢n viÃªn: má»—i giÃ¡ trá»‹ 1 cá»™t (khÃ´ng xáº¿p chá»“ng 2 dÃ²ng) â€” gá»n, khÃ´ng wrap
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
  // Tab Chá»©c danh: chá»‰ hiá»‡n chá»©c danh Ä‘Æ°á»£c phÃ©p sá»­a (Admin: táº¥t cáº£ Â· non-admin: chá»‰ cáº¥p dÆ°á»›i mÃ¬nh)
  const visibleJobTitles = jobTitles.filter(jt => canEditJt(jt.id))
  // PhÃ¢n trang SERVER + Má»ŒI bá»™ lá»c xuá»‘ng server. Äo tháº­t 28/07: tráº£ cáº£ báº£ng thÃ¬ 3.000 nhÃ¢n sá»±
  // = 2.495KB/láº§n gá»i, vÃ  lá»c trÃªn táº­p Ä‘Ã£ táº£i sau phÃ¢n trang = lá»c trong 1 trang (ra thiáº¿u).
  const { data: empPage, isLoading, isError, error } = useEmployeesPaged({
    department_id:   filterDept === '__all__' ? undefined : filterDept,
    job_title_id:    filterJt   === '__all__' ? undefined : filterJt,
    warehouse_id:    filterWh   === '__all__' ? undefined : filterWh,
    search:          search || undefined,
    include_deleted: statusFilter !== 'active' ? true : undefined,
    status:          statusFilter,
    page:            ua.page,
    page_size:       ua.pageSize,
  })
  const employees   = empPage?.rows ?? []
  const empTotal    = empPage?.total ?? 0
  const empPages    = Math.max(1, Math.ceil(empTotal / ua.pageSize))
  // Ã” chá»n láº¥y tá»« DANH Má»¤C gá»‘c (chá»©c danh / kho), KHÃ”NG dáº«n xuáº¥t tá»« trang Ä‘ang xem â€” sau khi
  // phÃ¢n trang thÃ¬ táº­p Ä‘ang táº£i chá»‰ cÃ²n 100 dÃ²ng, dáº«n xuáº¥t ra lÃ  máº¥t pháº§n lá»›n lá»±a chá»n.
  const jtOptions = allJts.map(j => ({ id: j.id, label: j.name }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const whOptions = (allWarehouses as { id: string; name: string; code?: string }[])
    .map(w => ({ id: w.id, label: w.name, sub: w.code }))
    .sort((a, b) => a.label.localeCompare(b.label))

  // Filter danh sÃ¡ch nhÃ¢n viÃªn â€” FilterBar chuáº©n (Kho Â· PhÃ²ng ban Â· Chá»©c danh Â· TÃ¬nh tráº¡ng)
  const empFilterDefs: FilterDef[] = [
    { key: 'warehouse', label: 'Kho', type: 'single', allLabel: 'Táº¥t cáº£ kho',
      value: filterWh === '__all__' ? '' : filterWh, onChange: v => { setFilterWh(v || '__all__'); setUserAdmin({ page: 1 }) },
      options: whOptions.map(o => ({ value: o.id, label: o.label })) },
    { key: 'dept', label: 'PhÃ²ng ban', type: 'single', allLabel: 'Táº¥t cáº£ phÃ²ng ban',
      value: filterDept === '__all__' ? '' : filterDept,
      onChange: v => { setFilterDept(v || '__all__'); setFilterJt('__all__'); setFilterWh('__all__'); setUserAdmin({ page: 1 }) },
      options: departments.map(d => ({ value: d.id, label: d.name })) },
    { key: 'jt', label: 'Chá»©c danh', type: 'single', allLabel: 'Táº¥t cáº£ chá»©c danh',
      value: filterJt === '__all__' ? '' : filterJt, onChange: v => { setFilterJt(v || '__all__'); setUserAdmin({ page: 1 }) },
      options: jtOptions.map(o => ({ value: o.id, label: o.label })) },
    { key: 'status', label: 'TÃ¬nh tráº¡ng', type: 'single', allLabel: 'Äang hoáº¡t Ä‘á»™ng',
      value: statusFilter === 'active' ? '' : statusFilter,
      onChange: v => { setStatusFilter((v || 'active') as 'active' | 'hidden' | 'all'); setUserAdmin({ page: 1 }) },
      options: [{ value: 'hidden', label: 'Äang áº©n' }, { value: 'all', label: 'ToÃ n bá»™' }] },
  ]

  // Filter tab Chá»©c danh â€” FilterBar chuáº©n (PhÃ²ng ban), state lÆ°u store thay cho useState
  const jtFilterDefs: FilterDef[] = [
    { key: 'jtDept', label: 'PhÃ²ng ban', type: 'single', allLabel: 'Táº¥t cáº£ phÃ²ng ban',
      value: filterDeptJt === '__all__' ? '' : filterDeptJt, onChange: v => setFilterDeptJt(v || '__all__'),
      options: departments.map(d => ({ value: d.id, label: d.name })) },
  ]

  return (
    <div className="flex flex-col h-full p-2 gap-1.5 max-w-7xl mx-auto w-full">
      <Tabs defaultValue="employees" className="flex flex-col flex-1 min-h-0">
        {/* TiÃªu Ä‘á» + tab trÃªn CÃ™NG 1 hÃ ng Ä‘á»ƒ tá»‘i Æ°u chiá»u cao, dÃ nh Ä‘áº¥t cho báº£ng */}
        <div className="shrink-0 flex items-center gap-3 mb-1.5">
          <h1 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 shrink-0">
            <User2 className="h-4 w-4 text-slate-500" />
            <span className="hidden md:inline">Quáº£n lÃ½ nhÃ¢n sá»± &amp; phÃ¢n quyá»n</span>
          </h1>
          <TabsList className="shrink-0">
            <TabsTrigger value="employees" className="gap-1.5">
              <User2 className="h-3.5 w-3.5" /> NhÃ¢n viÃªn
            </TabsTrigger>
            <TabsTrigger value="departments" className="gap-1.5">
              <Building2 className="h-3.5 w-3.5" /> PhÃ²ng ban
            </TabsTrigger>
            <TabsTrigger value="job-titles" className="gap-1.5">
              <Briefcase className="h-3.5 w-3.5" /> Chá»©c danh
            </TabsTrigger>
          </TabsList>
        </div>

        {/* â”€â”€ Tab: NhÃ¢n viÃªn â”€â”€ */}
        <TabsContent value="employees" className="flex-1 min-h-0 data-[state=active]:flex flex-col space-y-2">
          <div className="shrink-0 flex gap-2 flex-wrap items-center">
            <SearchInput value={search} onChange={setSearch} placeholder="TÃ¬m tÃªn, mÃ£, Ä‘Äƒng nháº­pâ€¦" className="flex-1 min-w-[200px]" />
            <FilterSheetButton defs={empFilterDefs} className="sm:hidden" />
            {/* Mobile: SavedViews + action GOM 1 hÃ ng (PDA); desktop sm:contents â†’ nhÆ° cÅ© */}
            <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
            <SavedViews module="user_admin" currentFilters={empViewSnapshot} activeId={empActiveViewId}
              onApply={(fl) => setUserAdmin(fl as Partial<typeof ua>)} />
            <button type="button" onClick={toggleDense}
              className="hidden sm:inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 shrink-0"
              title={dense ? 'Äang: dÃ y Â· báº¥m Ä‘á»ƒ thoÃ¡ng' : 'Äang: thoÃ¡ng Â· báº¥m Ä‘á»ƒ dÃ y'}>
              {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
            </button>
            <ActionCluster className="shrink-0" mobileInline items={[
              ...(canCreateEmp ? [{
                key: 'create', icon: Plus, label: 'ThÃªm nhÃ¢n viÃªn', tip: 'Táº¡o tÃ i khoáº£n nhÃ¢n viÃªn má»›i',
                primary: true, variant: 'default',
                onClick: () => { setEditingEmp(null); setShowEmpDlg(true) },
              } satisfies ActionItem] : []),
            ]} />
            </div>
          </div>
          <FilterBar defs={empFilterDefs} className="shrink-0 hidden sm:flex" />

          {/* 3 Ã´ Ä‘áº¿m trÃªn TOÃ€N Bá»˜ bá»™ lá»c (BE tráº£) â€” Ä‘áº¿m á»Ÿ FE lÃ  Ä‘áº¿m trang Ä‘ang xem */}
          <SummaryBand compact className="shrink-0 rounded-lg" tiles={[
            { label: 'Äang hoáº¡t Ä‘á»™ng', value: empPage?.active ?? 0, accent: true },
            { label: 'Táº¡m dá»«ng', value: empPage?.paused ?? 0 },
            { label: 'ÄÃ£ áº©n', value: empPage?.hidden ?? 0 },
          ]} />

          {isError && (
            <div className="shrink-0 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              Lá»—i táº£i dá»¯ liá»‡u: {(error as { message?: string })?.message ?? 'KhÃ´ng káº¿t ná»‘i Ä‘Æ°á»£c backend'}
            </div>
          )}

          <div className="flex gap-3 items-stretch flex-1 min-h-0">
            <Card className="flex-1 min-w-0 flex flex-col">
              {isLoading ? (
                <div className="p-8 text-center text-sm text-slate-400">Äang táº£iâ€¦</div>
              ) : employees.length === 0 ? (
                <div className="p-12 text-center text-slate-400 space-y-2">
                  <User2 className="h-10 w-10 mx-auto opacity-30" />
                  <p className="text-sm">ChÆ°a cÃ³ nhÃ¢n viÃªn nÃ o</p>
                  {canCreateEmp && (
                    <Button size="sm" variant="outline" onClick={() => { setEditingEmp(null); setShowEmpDlg(true) }}>
                      <Plus className="h-4 w-4 mr-1" /> ThÃªm nhÃ¢n viÃªn Ä‘áº§u tiÃªn
                    </Button>
                  )}
                </div>
              ) : (
                <div className="overflow-auto flex-1 min-h-0">
                  <Table className={`table-fixed [&_td]:overflow-hidden [&_th]:overflow-hidden [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap [&_td]:text-[10px] [&_td]:border-r [&_td]:border-slate-100 [&_th]:border-r [&_th]:border-slate-200 ${dense ? '[&_td]:!py-1' : '[&_td]:!py-2'}`} style={{ width: empTotalWidth, minWidth: '100%' }}>
                    <colgroup>{empColW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                    <TableHeader>
                      <TableRow>
                        {['Há» tÃªn', 'MÃ£ NV', 'ÄÄƒng nháº­p', 'SÄT', 'PhÃ²ng ban', 'Chá»©c danh', 'Loáº¡i hÃ ng', 'Kho', 'Tráº¡ng thÃ¡i', ''].map((lbl, i) => (
                          <TableHead key={i} className={`px-2 py-1.5 text-[9px] font-medium text-slate-500 ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                            {lbl}
                            {i < 9 && (
                              <span onPointerDown={e => empStartResize(i, e)} onClick={e => e.stopPropagation()}
                                className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70" title="KÃ©o Ä‘á»ƒ chá»‰nh Ä‘á»™ rá»™ng cá»™t" />
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
                          <TableCell className="px-2 text-slate-600 truncate" title={emp.email ?? 'â€”'}>{emp.email ?? <span className="text-slate-300">â€”</span>}</TableCell>
                          <TableCell className="px-2 text-slate-600 truncate" title={emp.phone ?? 'â€”'}>{emp.phone ?? <span className="text-slate-300">â€”</span>}</TableCell>
                          <TableCell className="px-2 text-slate-700 truncate" title={emp.dept?.name ?? 'â€”'}>{emp.dept?.name ?? <span className="text-slate-300">â€”</span>}</TableCell>
                          <TableCell className="px-2 text-slate-600 truncate" title={emp.job_title?.name ?? 'â€”'}>{emp.job_title?.name ?? <span className="text-slate-300">â€”</span>}</TableCell>
                          <TableCell className="px-2" title={cats.join(', ')}>
                            <div className="flex gap-1 overflow-hidden">
                              {cats.length === 0 ? <span className="text-slate-300">â€”</span> : cats.map(cat => (
                                <span key={cat} className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium
                                  ${whTypeBadgeCls(cat, whTypeMeta)}`}>{cat}</span>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="px-2"
                            title={emp.warehouse_scope === 'NATIONAL' ? 'ToÃ n quá»‘c' : whList.map(wa => wa.warehouse?.name ?? wa.warehouse_id).join(', ')}>
                            {emp.warehouse_scope === 'NATIONAL' ? (
                              <span className="text-blue-600 font-medium">ToÃ n quá»‘c</span>
                            ) : whList.length === 0 ? (
                              <span className="text-amber-600">ChÆ°a gÃ¡n kho</span>
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
                              <Badge variant="secondary" className="text-[9px] text-amber-700 bg-amber-50">ÄÃ£ áº©n</Badge>
                            ) : (
                              <Badge variant={emp.is_active ? 'default' : 'secondary'} className="text-[9px]">
                                {emp.is_active ? 'Hoáº¡t Ä‘á»™ng' : 'Táº¡m dá»«ng'}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="px-2 py-2">
                            {isDeleted ? (
                              canDeleteEmp && (
                                <button title="KhÃ´i phá»¥c"
                                  disabled={restoring}
                                  className="text-slate-400 hover:text-green-600 transition-colors p-1 disabled:opacity-50"
                                  onClick={e => { e.stopPropagation(); restore(emp.id) }}>
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                              )
                            ) : (
                              <div className="flex items-center gap-1">
                                {canSetPwd && (
                                  <button title="Äáº·t máº­t kháº©u"
                                    className="text-slate-400 hover:text-amber-500 transition-colors p-1"
                                    onClick={e => { e.stopPropagation(); setPwdEmp(emp) }}>
                                    <KeyRound className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {canEditEmp && (
                                  <button title="Sá»­a thÃ´ng tin"
                                    className="text-slate-400 hover:text-blue-500 transition-colors p-1"
                                    onClick={e => { e.stopPropagation(); setEditingEmp(emp); setShowEmpDlg(true) }}>
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {canDeleteEmp && emp.id !== user?.id && (
                                  <button title="XÃ³a nhÃ¢n viÃªn"
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
                  <PagerNav page={ua.page} totalPages={empPages} onPage={p => { setUserAdmin({ page: p }); setSelectedEmp(null) }} />
                </div>
              )}
              <ListFooter page={ua.page} pageSize={ua.pageSize} total={empTotal} unit="nhÃ¢n viÃªn"
                onPageSize={n => setUserAdmin({ pageSize: n, page: 1 })} />
            </Card>
            {selectedEmp && (
              <Card className="w-56 shrink-0 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">{selectedEmp.name}</span>
                  <button onClick={() => setSelectedEmp(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                </div>
                {/* Thao tÃ¡c nhanh â€” khá»i pháº£i kÃ©o ngang báº£ng Ä‘á»ƒ tháº¥y cá»™t action */}
                {(selectedEmp.deleted_at
                  ? canDeleteEmp
                  : (canSetPwd || canEditEmp || (canDeleteEmp && selectedEmp.id !== user?.id))) && (
                  <div className="border-b pb-2">
                    <ActionCluster className="justify-start" items={selectedEmp.deleted_at
                      ? (canDeleteEmp ? [{
                          key: 'restore', icon: RotateCcw, label: 'KhÃ´i phá»¥c', tip: 'KhÃ´i phá»¥c nhÃ¢n viÃªn Ä‘Ã£ áº©n vá» danh sÃ¡ch',
                          primary: true, busy: restoring,
                          className: 'border-green-300 text-green-700 hover:bg-green-50',
                          onClick: () => restore(selectedEmp.id),
                        } satisfies ActionItem] : [])
                      : [
                          ...(canEditEmp ? [{
                            key: 'edit', icon: Pencil, label: 'Sá»­a', tip: 'Sá»­a thÃ´ng tin nhÃ¢n viÃªn',
                            primary: true, variant: 'default',
                            onClick: () => { setEditingEmp(selectedEmp); setShowEmpDlg(true) },
                          } satisfies ActionItem] : []),
                          ...(canSetPwd ? [{
                            key: 'password', icon: KeyRound, label: 'Máº­t kháº©u', tip: 'Äáº·t máº­t kháº©u Ä‘Äƒng nháº­p má»›i',
                            onClick: () => setPwdEmp(selectedEmp),
                          } satisfies ActionItem] : []),
                          ...(canDeleteEmp && selectedEmp.id !== user?.id ? [{
                            key: 'delete', icon: Trash2, label: 'XÃ³a', tip: 'XÃ³a nhÃ¢n viÃªn (khÃ´ng hoÃ n tÃ¡c Ä‘Æ°á»£c)',
                            danger: true, className: 'border-red-200 text-red-600 hover:bg-red-50',
                            onClick: () => setConfirmDeleteEmp(selectedEmp),
                          } satisfies ActionItem] : []),
                        ]
                    } />
                  </div>
                )}
                <div><span className="text-slate-400">MÃ£ NV:</span> <span className="font-mono font-medium">{selectedEmp.employee_code}</span></div>
                <div><span className="text-slate-400">ÄÄƒng nháº­p:</span> <span className="font-medium">{selectedEmp.email ?? 'â€”'}</span></div>
                <div><span className="text-slate-400">SÄT:</span> <span className="font-medium">{selectedEmp.phone ?? 'â€”'}</span></div>
                <div><span className="text-slate-400">PhÃ²ng ban:</span> <span className="font-medium">{selectedEmp.dept?.name ?? 'â€”'}</span></div>
                <div><span className="text-slate-400">Chá»©c danh:</span> <span className="font-medium">{selectedEmp.job_title?.name ?? 'â€”'}</span></div>
                <div><span className="text-slate-400">Tráº¡ng thÃ¡i:</span> <span className="font-medium">{selectedEmp.is_active ? 'Hoáº¡t Ä‘á»™ng' : 'Táº¡m dá»«ng'}</span></div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Táº¡o / Sá»­a</p>
                  <div><span className="text-slate-400">NgÆ°á»i táº¡o:</span> <span className="font-medium">{selectedEmp.created_by ?? 'â€”'}</span></div>
                  <div><span className="text-slate-400">NgÃ y giá» táº¡o:</span> <span className="font-medium">{selectedEmp.created_at ? formatDateTime(selectedEmp.created_at) : 'â€”'}</span></div>
                  <div><span className="text-slate-400">NgÆ°á»i sá»­a:</span> <span className="font-medium">{selectedEmp.updated_by ?? 'â€”'}</span></div>
                  <div><span className="text-slate-400">NgÃ y giá» sá»­a:</span> <span className="font-medium">{selectedEmp.updated_at ? formatDateTime(selectedEmp.updated_at) : 'â€”'}</span></div>
                </div>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* â”€â”€ Tab: PhÃ²ng ban â”€â”€ */}
        <TabsContent value="departments" className="flex-1 min-h-0 data-[state=active]:flex flex-col space-y-2">
          <div className="shrink-0 flex items-center justify-between flex-wrap gap-1.5">
            <p className="text-xs text-slate-500">{departments.length} phÃ²ng ban</p>
            <ActionCluster className="shrink-0 justify-end" items={[
              ...(isAdminUser ? [{
                key: 'create', icon: Plus, label: 'ThÃªm phÃ²ng ban', tip: 'Táº¡o phÃ²ng ban má»›i',
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
                  <p className="text-sm">ChÆ°a cÃ³ phÃ²ng ban nÃ o</p>
                  {isAdminUser && (
                    <Button size="sm" variant="outline" onClick={() => { setEditingDept(null); setShowDeptDlg(true) }}>
                      <Plus className="h-4 w-4 mr-1" /> ThÃªm phÃ²ng ban Ä‘áº§u tiÃªn
                    </Button>
                  )}
                </div>
              ) : (
                <div className="overflow-auto flex-1 min-h-0">
                  <Table className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap [&_td]:text-[10px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">MÃ£</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">TÃªn phÃ²ng ban</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Tráº¡ng thÃ¡i</TableHead>
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
                              {d.is_active ? 'Hoáº¡t Ä‘á»™ng' : 'Táº¡m dá»«ng'}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-2 py-1.5">
                            {isAdminUser && (
                              <button title="Sá»­a" className="text-slate-400 hover:text-blue-500 transition-colors p-1"
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
                  <span className="font-semibold text-slate-700">{selectedDept.code} â€” {selectedDept.name}</span>
                  <button onClick={() => setSelectedDept(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                </div>
                <div><span className="text-slate-400">Tráº¡ng thÃ¡i:</span> <span className="font-medium">{selectedDept.is_active ? 'Hoáº¡t Ä‘á»™ng' : 'Táº¡m dá»«ng'}</span></div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Táº¡o / Sá»­a</p>
                  <div><span className="text-slate-400">NgÆ°á»i táº¡o:</span> <span className="font-medium">{selectedDept.created_by ?? 'â€”'}</span></div>
                  <div><span className="text-slate-400">NgÃ y giá» táº¡o:</span> <span className="font-medium">{selectedDept.created_at ? formatDateTime(selectedDept.created_at) : 'â€”'}</span></div>
                  <div><span className="text-slate-400">NgÆ°á»i sá»­a:</span> <span className="font-medium">{selectedDept.updated_by ?? 'â€”'}</span></div>
                  <div><span className="text-slate-400">NgÃ y giá» sá»­a:</span> <span className="font-medium">{selectedDept.updated_at ? formatDateTime(selectedDept.updated_at) : 'â€”'}</span></div>
                </div>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* â”€â”€ Tab: Chá»©c danh â”€â”€ */}
        <TabsContent value="job-titles" className="flex-1 min-h-0 data-[state=active]:flex flex-col space-y-2">
          <div className="shrink-0 flex gap-2 flex-wrap items-center">
            <FilterSheetButton defs={jtFilterDefs} className="sm:hidden" />
            <span className="text-xs text-slate-500 mr-auto">{visibleJobTitles.length} chá»©c danh</span>
            {/* Mobile: cluster chia sáº» hÃ ng vá»›i nÃºt Lá»c (PDA) â€” mobileInline */}
            <ActionCluster className="shrink-0 justify-end" mobileInline items={[
              ...(isAdminUser ? [{
                key: 'create', icon: Plus, label: 'ThÃªm chá»©c danh', tip: 'Táº¡o chá»©c danh má»›i',
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
                  <p className="text-sm">ChÆ°a cÃ³ chá»©c danh nÃ o</p>
                  {isAdminUser && (
                    <Button size="sm" variant="outline" onClick={() => { setEditingJt(null); setShowJtDlg(true) }}>
                      <Plus className="h-4 w-4 mr-1" /> ThÃªm chá»©c danh Ä‘áº§u tiÃªn
                    </Button>
                  )}
                </div>
              ) : (
                <div className="overflow-auto flex-1 min-h-0">
                  <Table className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap [&_td]:text-[10px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Chá»©c danh</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">PhÃ²ng ban</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Tráº¡ng thÃ¡i</TableHead>
                        <TableHead className="px-2 py-1.5 w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleJobTitles.map(jt => (
                        <TableRow key={jt.id}
                          className={`cursor-pointer ${selectedJt?.id === jt.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                          onClick={() => setSelectedJt(prev => prev?.id === jt.id ? null : jt)}>
                          <TableCell className="px-2 py-1.5 font-medium text-slate-800 truncate" title={jt.name}>{jt.name}</TableCell>
                          <TableCell className="px-2 py-1.5 text-slate-600 truncate" title={jt.department?.name ?? 'â€”'}>{jt.department?.name ?? 'â€”'}</TableCell>
                          <TableCell className="px-2 py-1.5">
                            <Badge variant={jt.is_active ? 'default' : 'secondary'} className="text-[9px]">
                              {jt.is_active ? 'Hoáº¡t Ä‘á»™ng' : 'Táº¡m dá»«ng'}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-2 py-1.5">
                            {canEditJt(jt.id) && (
                              <button title="Sá»­a" className="text-slate-400 hover:text-blue-500 transition-colors p-1"
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
                <div><span className="text-slate-400">PhÃ²ng ban:</span> <span className="font-medium">{selectedJt.department?.name ?? 'â€”'}</span></div>
                <div><span className="text-slate-400">Tráº¡ng thÃ¡i:</span> <span className="font-medium">{selectedJt.is_active ? 'Hoáº¡t Ä‘á»™ng' : 'Táº¡m dá»«ng'}</span></div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Táº¡o / Sá»­a</p>
                  <div><span className="text-slate-400">NgÆ°á»i táº¡o:</span> <span className="font-medium">{selectedJt.created_by ?? 'â€”'}</span></div>
                  <div><span className="text-slate-400">NgÃ y giá» táº¡o:</span> <span className="font-medium">{selectedJt.created_at ? formatDateTime(selectedJt.created_at) : 'â€”'}</span></div>
                  <div><span className="text-slate-400">NgÆ°á»i sá»­a:</span> <span className="font-medium">{selectedJt.updated_by ?? 'â€”'}</span></div>
                  <div><span className="text-slate-400">NgÃ y giá» sá»­a:</span> <span className="font-medium">{selectedJt.updated_at ? formatDateTime(selectedJt.updated_at) : 'â€”'}</span></div>
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
