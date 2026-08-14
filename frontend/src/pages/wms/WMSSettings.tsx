import { useState, useEffect } from 'react'
import type { AxiosError } from 'axios'
import { Plus, Pencil, Trash2, Warehouse, Tag, Settings2, MapPin, X, Clock, ShieldCheck, GripVertical, SlidersHorizontal, Ruler, Cog } from 'lucide-react'
import { formatDateTime } from '@/utils/formatters'
import { Button }   from '@/components/ui/button'
import { Input }    from '@/components/ui/input'
import { Label }    from '@/components/ui/label'
import { Badge }    from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/components/ui/use-toast'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { FormSheet } from '@/components/shared/FormSheet'
import { SETTINGS_GRID, SettingGroup, SettingLabel, SettingField, SettingNum, SettingSaveBar } from '@/components/shared/SettingsForm'
import { FilterBar, type FilterDef } from '@/components/shared/FilterBar'
import { SearchInput } from '@/components/shared/SearchInput'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import { WarehouseMultiSelect } from '@/components/shared/WarehouseMultiSelect'
import {
  useWarehouses, useCreateWarehouse, useUpdateWarehouse, useDeleteWarehouse,
  useWarehouseTypes, useAddWarehouseType, useUpdateWarehouseType, useDeleteWarehouseType, useReorderWarehouseTypes,
  useWarehouseZones, useCreateWarehouseZone, useUpdateWarehouseZone, useDeleteWarehouseZone,
  useImportShifts, useCreateImportShift, useUpdateImportShift,
  useQAStatuses, useCreateQAStatus, useUpdateQAStatus,
  useSystemSettings, useUpdateSystemSetting,
  useMachines, useCreateMachine, useUpdateMachine, useDeleteMachine, type WarehouseMachine,
  useUnits, useAddUnit, useUpdateUnit, useDeleteUnit,
  type WarehouseZone, type UnitRow, type UnitRole,
} from '@/api/hooks'
import { can, isAdmin, type ModulePermissions } from '@/config/permissions'
import { useAuthStore } from '@/stores/authStore'
import { useScopedWhTypes } from '@/hooks/useUserScope'
import { WH_BADGE_COLORS, whTypeBadgeCls, type WhTypeMeta } from '@/utils/cargoCategory'
import { computedHolidaysOf } from '@/utils/vnHolidays'

function apiMsg(err: unknown) {
  return (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? String(err)
}

// ─── Tab Hệ thống (SystemSetting — cờ hành vi per-DB, multi-tenant silo) ─────
// Cờ theo KHÁC BIỆT giữa các đơn vị, không theo tên đơn vị. Sổ cờ: backend systemSettingController.

// `sub` để NGẮN — trong lưới 3 cột menu chỉ rộng ~450px, chuỗi dài sẽ nuốt chỗ của nhãn chính.
// Ví dụ đầy đủ nằm ở tooltip ⓘ của nhãn (chuẩn form cấu hình: diễn giải vào tooltip).
const LABEL_FORMAT_OPTS = [
  { value: 'underscore', label: 'Tem gạch dưới ( _ )', sub: 'ddmmyy_Mã_ChuKỳ_…' },
  { value: 'semicolon',  label: 'Tem chấm phẩy ( ; )', sub: 'Mã;QA;Lô;NSX;HSD…' },
]

const DEC_SEP_OPTS = [
  { value: 'dot',   label: 'Dấu chấm ( . )',  sub: '1.5 kg' },
  { value: 'comma', label: 'Dấu phẩy ( , )',  sub: '1,5 kg' },
]

// Cờ xác nhận giao hàng — quyết định xuất kho có tạo booking TMS (Chuyển kho) không + theo hình thức kho nhận nào.
const DC_ENABLED_OPTS = [
  { value: 'on',  label: 'Có xác nhận giao hàng',    sub: 'tạo booking Chuyển kho' },
  { value: 'off', label: 'Không xác nhận giao hàng', sub: 'không tạo booking' },
]
const DC_MODE_OPTS = [
  { value: 'QR',    label: 'Kho QR (tồn kho QR)' },
  { value: 'QTY',   label: 'Kho QTY / QTY theo date (tồn số lượng)' },
  { value: 'NONE',  label: 'Kho NONE (tài xế tự hoàn thành)' },
  { value: 'OTHER', label: 'Khách ngoài (tài xế tự hoàn thành)' },
]
type DeliveryConf = { enabled: boolean; modes: string[] }
function parseDc(v: unknown): DeliveryConf {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as { enabled?: unknown; modes?: unknown }
    return {
      enabled: o.enabled === true,
      modes: Array.isArray(o.modes) ? o.modes.filter((m): m is string => typeof m === 'string') : [],
    }
  }
  return { enabled: true, modes: ['QR', 'QTY'] }   // mặc định = hành vi đơn vị 1
}

// ── Tham số vận hành (đợt 2 chống hardcode 13/08) — MIRROR mặc định BE utils/settings.ts ──
const RET_DEFAULT = { photos: 60, feed: 3, error_logs: 30 }
const CYC_DEFAULT = { A: 7, B: 30, C: 90, window_days: 30 }
const INB_WINDOW_DEFAULT = 2
const PACK_MAX_DEFAULT = 10
function numRec<T extends Record<string, number>>(v: unknown, def: T): T {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...def }
  const o = v as Record<string, unknown>
  const out = { ...def }
  for (const k of Object.keys(def) as (keyof T)[]) {
    const n = Number(o[k as string])
    if (Number.isFinite(n) && n > 0) out[k] = n as T[keyof T]
  }
  return out
}
const recToStr = (o: Record<string, number>): Record<string, string> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]))
// Ô nhập phải ra SỐ NGUYÊN trong khoảng — trả null để chặn trước khi gửi (BE vẫn là chốt cuối)
const intIn = (s: string, min: number, max: number): number | null => {
  const n = Number(s)
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

// ── org_profile (đợt 3 chống hardcode 14/08) — nhận diện & tham số RIÊNG của đơn vị.
// MIRROR mặc định BE ORG_PROFILE_DEFAULT: chưa cấu hình = đúng giá trị đang chạy của đơn vị 1.
interface OrgProfileDraft { contact_email: string; nmsx_alias: string; l: string; w: string; h: string }
interface OrgProfileValue {
  contact_email: string
  nmsx_alias: Record<string, string>
  assumed_carton_mm: { l: number; w: number; h: number }
}
const ORG_DEFAULT: OrgProfileValue = { contact_email: 'wms@lof.vn', nmsx_alias: { A: 'O' }, assumed_carton_mm: { l: 422, w: 233, h: 100 } }
// alias hiện dạng "CŨ=MỚI, CŨ=MỚI" cho dễ gõ (ánh xạ vài mã, không đáng dựng bảng riêng)
const aliasToStr = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(', ')
function aliasFromStr(s: string): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const part of s.split(',').map(x => x.trim()).filter(Boolean)) {
    const [k, v] = part.split('=').map(x => (x ?? '').trim())
    if (!k || !v || k.length > 10 || v.length > 10) return null
    out[k] = v
  }
  return out
}
// ── vn_holidays — lịch nghỉ lễ KHAI theo năm. KHÔNG gõ văn bản tự do (bản đầu 14/08 dùng textarea
// "YYYY-MM-DD Tên": gõ sai một ký tự là hỏng cả cụm, user bắt ngay) — mỗi ngày là MỘT DÒNG có ô
// chọn ngày + ô tên, nạp sẵn được lịch app tự tính rồi sửa theo công bố của Chính phủ.
type HolidayItem = { date: string; name: string }
type HolidayMap = Record<string, HolidayItem[]>
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const isRealDate = (ds: string) => {
  if (!DATE_RE.test(ds)) return false
  const [y, mo, d] = ds.split('-').map(Number)
  const chk = new Date(Date.UTC(y, mo - 1, d))
  return chk.getUTCFullYear() === y && chk.getUTCMonth() === mo - 1 && chk.getUTCDate() === d
}
/** Lỗi đầu tiên tìm thấy (câu tiếng Việt để hiện thẳng), hoặc null nếu khai hợp lệ. */
function holidayError(h: HolidayMap): string | null {
  for (const year of Object.keys(h).sort()) {
    const list = h[year]
    if (list.length > 60) return `Lịch nghỉ lễ ${year}: khai quá 60 ngày.`
    const seen = new Set<string>()
    for (const it of list) {
      if (!it.date) return `Lịch nghỉ lễ ${year}: có dòng chưa chọn ngày.`
      if (!isRealDate(it.date)) return `Lịch nghỉ lễ ${year}: ngày "${it.date}" không có thật.`
      if (it.date.slice(0, 4) !== year) return `Lịch nghỉ lễ ${year}: ngày ${it.date} không thuộc năm ${year}.`
      if (seen.has(it.date)) return `Lịch nghỉ lễ ${year}: ngày ${it.date} bị khai 2 lần.`
      seen.add(it.date)
      if (!it.name.trim()) return `Lịch nghỉ lễ ${year}: ngày ${it.date} chưa có tên.`
    }
  }
  return null
}
/** Chuẩn hóa trước khi gửi: bỏ khoảng trắng thừa, cắt 80 ký tự, sắp theo ngày. */
const holidaysNormalize = (h: HolidayMap): HolidayMap => Object.fromEntries(
  Object.keys(h).sort().map(y => [y, [...h[y]]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map(i => ({ date: i.date, name: i.name.trim().slice(0, 80) }))]))

function parseHolidays(v: unknown): HolidayMap {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: HolidayMap = {}
  for (const [year, list] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue
    out[year] = list
      .filter((it): it is { date: string; name: string } =>
        !!it && typeof (it as { date?: unknown }).date === 'string' && typeof (it as { name?: unknown }).name === 'string')
      .map(it => ({ date: it.date, name: it.name }))
  }
  return out
}

function parseOrg(v: unknown): OrgProfileValue {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return ORG_DEFAULT
  const o = v as Record<string, unknown>
  const c = (o.assumed_carton_mm ?? {}) as Record<string, unknown>
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : d)
  const alias = (o.nmsx_alias && typeof o.nmsx_alias === 'object' && !Array.isArray(o.nmsx_alias))
    ? Object.fromEntries(Object.entries(o.nmsx_alias as Record<string, unknown>)
        .filter(([, val]) => typeof val === 'string').map(([k, val]) => [k, String(val)]))
    : ORG_DEFAULT.nmsx_alias
  return {
    contact_email: typeof o.contact_email === 'string' && o.contact_email.trim() ? o.contact_email.trim() : ORG_DEFAULT.contact_email,
    nmsx_alias: alias,
    assumed_carton_mm: { l: num(c.l, 422), w: num(c.w, 233), h: num(c.h, 100) },
  }
}

/**
 * Soạn lịch nghỉ lễ theo NĂM. Mỗi ngày một dòng (ô chọn ngày + tên) — không gõ văn bản tự do.
 * "Nạp lịch tự tính" đổ ra danh sách app đang tự suy (Tết âm lịch + 4 lễ dương) để sửa cho khớp
 * công bố hằng năm; "Bỏ khai" xóa hẳn năm đó → app quay lại tự tính.
 * ⚠️ Phải nằm ở CẤP MODULE (khai trong component khác = ô nhập mất focus sau 1 ký tự).
 */
function HolidayEditor({ value, onChange, readOnly }: {
  value: HolidayMap
  onChange: (v: HolidayMap) => void
  readOnly?: boolean
}) {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(String(thisYear))
  const yearOpts = [...new Set([...[-1, 0, 1, 2].map(d => String(thisYear + d)), ...Object.keys(value)])]
    .sort().map(y => ({ value: y, label: `Năm ${y}` }))

  const rows = value[year]                       // undefined = CHƯA khai năm này (app tự tính)
  const computed = computedHolidaysOf(Number(year))
  const dupes = new Set((rows ?? []).filter((r, i) => r.date && (rows ?? []).findIndex(x => x.date === r.date) !== i).map(r => r.date))
  const setRows = (next: HolidayItem[]) => onChange({ ...value, [year]: next })
  const dropYear = () => { const next = { ...value }; delete next[year]; onChange(next) }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <div className="w-28"><SingleSelect options={yearOpts} value={year} onChange={setYear} searchable={false} triggerClassName="w-full" /></div>
        <span className={`text-[9px] ${rows ? 'text-sky-700' : 'text-slate-400'}`}>
          {rows ? `đã khai ${rows.length} ngày` : `đang tự tính (${computed.length} ngày)`}
        </span>
      </div>

      {rows && (
        <div className="space-y-1 max-h-52 overflow-auto pr-0.5">
          {rows.length === 0 && (
            <p className="text-[9px] text-amber-600">Khai 0 ngày = năm {year} KHÔNG có ngày nghỉ lễ nào. Muốn quay lại lịch tự tính thì bấm "Bỏ khai".</p>
          )}
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-1">
              <input type="date" value={r.date} disabled={readOnly}
                min={`${year}-01-01`} max={`${year}-12-31`}
                onChange={e => setRows(rows.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))}
                className={`h-7 w-[118px] shrink-0 rounded-md border px-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-sky-400
                  ${dupes.has(r.date) || (r.date && r.date.slice(0, 4) !== year) ? 'border-red-400 bg-red-50' : 'border-slate-200'}`} />
              <Input value={r.name} disabled={readOnly} placeholder="Tên ngày nghỉ"
                onChange={e => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                className={`h-7 flex-1 min-w-0 text-[11px] px-1.5 ${r.name.trim() ? '' : 'border-red-400 bg-red-50'}`} />
              {!readOnly && (
                <button type="button" title="Bỏ ngày này" onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  className="h-7 w-6 shrink-0 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1">
          <Button type="button" variant="outline" className="h-7 px-2 text-[10px]"
            onClick={() => setRows([...(rows ?? []), { date: '', name: '' }])}>
            <Plus className="h-3 w-3 mr-1" /> Thêm ngày
          </Button>
          <Button type="button" variant="outline" className="h-7 px-2 text-[10px]"
            onClick={() => setRows(computed.map(c => ({ ...c })))}>
            {rows?.length ? 'Nạp lại lịch tự tính' : `Nạp lịch tự tính (${computed.length} ngày)`}
          </Button>
          {rows && (
            <Button type="button" variant="outline" className="h-7 px-2 text-[10px] text-red-600 border-red-200" onClick={dropYear}>
              Bỏ khai năm {year}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function SystemTab({ canManage }: { canManage: boolean }) {
  const { data: settings = [], isLoading } = useSystemSettings()
  const { mutateAsync: save, isPending } = useUpdateSystemSetting()
  const [err, setErr] = useState('')

  const labelRow = settings.find(s => s.key === 'label_format')
  const dcRow    = settings.find(s => s.key === 'delivery_confirmation')
  const decRow   = settings.find(s => s.key === 'decimal_separator')
  const retRow   = settings.find(s => s.key === 'retention_days')
  const cycRow   = settings.find(s => s.key === 'cycle_count')
  const inbRow   = settings.find(s => s.key === 'inbound_edit_window_days')
  const packRow  = settings.find(s => s.key === 'packing_max_materials_per_run')
  const orgRow   = settings.find(s => s.key === 'org_profile')
  const holRow   = settings.find(s => s.key === 'vn_holidays')
  const stdRow   = settings.find(s => s.key === 'standard_work_hours')
  const srvLabel = typeof labelRow?.value === 'string' ? labelRow.value : 'underscore'
  const srvDc    = parseDc(dcRow?.value)
  const srvDec   = decRow?.value === 'comma' ? 'comma' : 'dot'
  const srvRet   = numRec(retRow?.value, RET_DEFAULT)
  const srvCyc   = numRec(cycRow?.value, CYC_DEFAULT)
  const srvInb   = Number(inbRow?.value) > 0 ? Number(inbRow?.value) : INB_WINDOW_DEFAULT
  const srvPack  = Number(packRow?.value) > 0 ? Number(packRow?.value) : PACK_MAX_DEFAULT
  const srvOrg   = parseOrg(orgRow?.value)
  const srvHol   = parseHolidays(holRow?.value)
  // giờ công chuẩn: mặc định 8 = mirror STANDARD_WORK_HOURS_DEFAULT của BE
  const srvStd   = typeof stdRow?.value === 'number' && stdRow.value >= 1 && stdRow.value <= 24 ? stdRow.value : 8

  // Draft (nháp) — thay đổi được STAGE tại chỗ, chỉ bấm "Lưu thay đổi" mới áp dụng.
  const [draftLabel, setDraftLabel] = useState(srvLabel)
  const [draftDc,    setDraftDc]    = useState<DeliveryConf>(srvDc)
  const [draftDec,   setDraftDec]   = useState(srvDec)
  const [draftRet,   setDraftRet]   = useState<Record<string, string>>(recToStr(srvRet))
  const [draftCyc,   setDraftCyc]   = useState<Record<string, string>>(recToStr(srvCyc))
  const [draftInb,   setDraftInb]   = useState(String(srvInb))
  const [draftPack,  setDraftPack]  = useState(String(srvPack))
  const orgToDraft = (o: OrgProfileValue): OrgProfileDraft => ({
    contact_email: o.contact_email, nmsx_alias: aliasToStr(o.nmsx_alias),
    l: String(o.assumed_carton_mm.l), w: String(o.assumed_carton_mm.w), h: String(o.assumed_carton_mm.h),
  })
  const [draftOrg, setDraftOrg] = useState<OrgProfileDraft>(orgToDraft(srvOrg))
  const [draftHol, setDraftHol] = useState<HolidayMap>(srvHol)
  const [draftStd, setDraftStd] = useState(String(srvStd))
  const srvKey = JSON.stringify([srvLabel, srvDc, srvDec, srvRet, srvCyc, srvInb, srvPack, srvOrg, srvHol, srvStd])
  const [baseKey, setBaseKey] = useState(srvKey)
  const syncDrafts = () => {
    setDraftLabel(srvLabel); setDraftDc(srvDc); setDraftDec(srvDec)
    setDraftRet(recToStr(srvRet)); setDraftCyc(recToStr(srvCyc))
    setDraftInb(String(srvInb)); setDraftPack(String(srvPack)); setDraftOrg(orgToDraft(srvOrg)); setDraftHol(srvHol)
    setDraftStd(String(srvStd))
  }
  useEffect(() => {
    if (srvKey !== baseKey) { syncDrafts(); setBaseKey(srvKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srvKey])

  const labelDirty = draftLabel !== srvLabel
  const dcDirty    = JSON.stringify(draftDc) !== JSON.stringify(srvDc)
  const decDirty   = draftDec !== srvDec
  const retDirty   = JSON.stringify(draftRet) !== JSON.stringify(recToStr(srvRet))
  const cycDirty   = JSON.stringify(draftCyc) !== JSON.stringify(recToStr(srvCyc))
  const inbDirty   = draftInb !== String(srvInb)
  const packDirty  = draftPack !== String(srvPack)
  const orgDirty   = JSON.stringify(draftOrg) !== JSON.stringify(orgToDraft(srvOrg))
  const holDirty   = JSON.stringify(holidaysNormalize(draftHol)) !== JSON.stringify(holidaysNormalize(srvHol))
  const stdDirty   = draftStd !== String(srvStd)
  const dirty      = labelDirty || dcDirty || decDirty || retDirty || cycDirty || inbDirty || packDirty || orgDirty || holDirty || stdDirty

  async function applyChanges() {
    setErr('')
    // Kiểm nhanh phía FE (khoảng hợp lệ MIRROR validator BE) — chặn sớm cho thông báo rõ; BE vẫn là chốt cuối
    let ret: { photos: number; feed: number; error_logs: number } | null = null
    let cyc: { A: number; B: number; C: number; window_days: number } | null = null
    let inb: number | null = null, pack: number | null = null
    if (retDirty) {
      const photos = intIn(draftRet.photos, 7, 730), feed = intIn(draftRet.feed, 1, 90), error_logs = intIn(draftRet.error_logs, 7, 365)
      if (!photos || !feed || !error_logs) return setErr('Thời gian lưu: Ảnh 7–730 · Thông báo 1–90 · Log lỗi 7–365 (ngày, số nguyên).')
      ret = { photos, feed, error_logs }
    }
    if (cycDirty) {
      const A = intIn(draftCyc.A, 1, 365), B = intIn(draftCyc.B, 1, 365), C = intIn(draftCyc.C, 1, 365), window_days = intIn(draftCyc.window_days, 7, 365)
      if (!A || !B || !C || !window_days) return setErr('Kiểm kê luân phiên: chu kỳ 1–365 ngày, cửa sổ phân hạng 7–365 ngày (số nguyên).')
      if (!(A <= B && B <= C)) return setErr('Kiểm kê luân phiên: hạng A phải kiểm DÀY nhất — cần A ≤ B ≤ C.')
      cyc = { A, B, C, window_days }
    }
    if (inbDirty) {
      inb = intIn(draftInb, 1, 90)
      if (!inb) return setErr('Cửa sổ sửa/xóa phiếu nhập: 1–90 ngày (số nguyên).')
    }
    if (packDirty) {
      pack = intIn(draftPack, 1, 50)
      if (!pack) return setErr('Sổ đóng gói: tối đa mã / trang sổ trong khoảng 1–50 (số nguyên).')
    }
    let org: OrgProfileValue | null = null
    if (orgDirty) {
      const email = draftOrg.contact_email.trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setErr('Đơn vị: email kỹ thuật không hợp lệ (dùng cho thông báo đẩy).')
      const alias = aliasFromStr(draftOrg.nmsx_alias)
      if (!alias) return setErr('Đơn vị: mã nhà máy cũ→mới phải viết dạng "A=O", nhiều cặp ngăn bằng dấu phẩy.')
      const l = intIn(draftOrg.l, 1, 5000), w = intIn(draftOrg.w, 1, 5000), h = intIn(draftOrg.h, 1, 5000)
      if (!l || !w || !h) return setErr('Đơn vị: cỡ thùng giả định phải là số nguyên 1–5000 mm cho cả D, R, C.')
      org = { contact_email: email, nmsx_alias: alias, assumed_carton_mm: { l, w, h } }
    }
    let std: number | null = null
    if (stdDirty) {
      const n = Number(draftStd)
      // bước 0,5 giờ — 7,5h là ca thật, nhưng 7,37h thì là gõ nhầm
      if (!Number.isFinite(n) || n < 1 || n > 24 || !Number.isInteger(n * 2))
        return setErr('Chấm công: giờ công chuẩn phải trong khoảng 1–24 giờ và là bội của 0,5 (vd 8 hoặc 7.5).')
      std = n
    }
    let hol: HolidayMap | null = null
    if (holDirty) {
      const e = holidayError(draftHol)
      if (e) return setErr(e)
      hol = holidaysNormalize(draftHol)
    }
    try {
      if (labelDirty) await save({ key: 'label_format', value: draftLabel })
      if (dcDirty)    await save({ key: 'delivery_confirmation', value: draftDc })
      if (decDirty)   await save({ key: 'decimal_separator', value: draftDec })
      if (ret)        await save({ key: 'retention_days', value: ret })
      if (cyc)        await save({ key: 'cycle_count', value: cyc })
      if (inb)        await save({ key: 'inbound_edit_window_days', value: inb })
      if (pack)       await save({ key: 'packing_max_materials_per_run', value: pack })
      if (std)        await save({ key: 'standard_work_hours', value: std })
      if (org)        await save({ key: 'org_profile', value: org })
      if (hol)        await save({ key: 'vn_holidays', value: hol })
      toast({ title: 'Đã lưu cấu hình hệ thống' })
    } catch (e) { setErr(apiMsg(e)) }
  }
  const resetDraft = () => { syncDrafts(); setErr('') }

  if (isLoading) return <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div>

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-auto p-3">
        {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{err}</p>}

        <div className={SETTINGS_GRID}>
          <SettingGroup readOnly={!canManage} title="Định dạng & nhập liệu" meta={labelRow}>
            <SettingField label="Định dạng tem pallet"
              tip={<>Chỉ áp cho chiều IN tem từ app. Chiều quét nhận vẫn theo định dạng của đơn vị.<br />
                <b>Gạch dưới:</b> ddmmyy_Mã_ChuKỳ_Máy_STT_NMSX — vd 070526_510000127_C05_M1_001_B<br />
                <b>Chấm phẩy:</b> Mã hàng;QA;Mã lô;NSX;HSD;Mẻ;Giờ:Phút — vd 50033;1;TA260705A045;05/07/2026;05/03/2027;1;05:26</>}>
              <SingleSelect options={LABEL_FORMAT_OPTS} value={draftLabel}
                onChange={setDraftLabel} searchable={false} triggerClassName="w-full" />
            </SettingField>
            <SettingField label="Dấu thập phân"
              tip={<>Dùng cho ô nhập số lẻ (KG, Pallet/EA, kích thước…) ở form Mã hàng. Chọn dấu nào thì app CHẶN dấu còn lại khi nhập.<br />
                Dấu phẩy là chuẩn VN, khớp file Excel (vd 1,5 kg · 0,00005).</>}>
              <SingleSelect options={DEC_SEP_OPTS} value={draftDec}
                onChange={setDraftDec} searchable={false} triggerClassName="w-full" />
            </SettingField>
          </SettingGroup>

          <SettingGroup readOnly={!canManage} title="Xác nhận giao hàng" meta={dcRow}>
            <SettingField label="Tạo booking Chuyển kho khi xuất" tip={'"Không" → xuất kho KHÔNG tạo booking Chuyển kho. "Có" → tạo booking theo hình thức kho nhận chọn bên dưới.'}>
              <SingleSelect options={DC_ENABLED_OPTS} value={draftDc.enabled ? 'on' : 'off'}
                onChange={v => setDraftDc(d => ({ ...d, enabled: v === 'on' }))} searchable={false} triggerClassName="w-full" />
            </SettingField>
            {draftDc.enabled && (
              <SettingField label="Hình thức kho nhận"
                tip={draftDc.modes.length
                  ? `Đang tạo booking cho kho nhận dạng: ${draftDc.modes.join(', ')}`
                  : 'Chưa chọn hình thức nào → sẽ KHÔNG tạo booking cho chuyến nào cả.'}>
                <MultiSelectFilter label="Hình thức kho nhận" options={DC_MODE_OPTS}
                  selected={draftDc.modes} onChange={m => setDraftDc(() => ({ enabled: true, modes: m }))}
                  searchable={false} width="w-full" />
                {!draftDc.modes.length && <span className="text-[9px] text-amber-600">Chưa chọn → không tạo booking</span>}
              </SettingField>
            )}
          </SettingGroup>

          <SettingGroup readOnly={!canManage} title="Kiểm kê luân phiên ABC" meta={cycRow}>
            <div>
              <SettingLabel text="Chu kỳ kiểm theo hạng" tip="Hạng A nhặt nhiều nhất nên kiểm dày nhất. Bắt buộc A ≤ B ≤ C. Áp cho tab Luân phiên ABC của Kiểm kho." />
              <div className="grid grid-cols-3 gap-1.5">
                <SettingNum label="Hạng A" unit="ngày" value={draftCyc.A} onChange={v => setDraftCyc(d => ({ ...d, A: v }))} />
                <SettingNum label="Hạng B" unit="ngày" value={draftCyc.B} onChange={v => setDraftCyc(d => ({ ...d, B: v }))} />
                <SettingNum label="Hạng C" unit="ngày" value={draftCyc.C} onChange={v => setDraftCyc(d => ({ ...d, C: v }))} />
              </div>
            </div>
            <SettingField label="Cửa sổ lượt nhặt để phân hạng" tip="Số ngày lấy lượt nhặt gần đây làm căn cứ xếp hạng ABC.">
              <div className="w-20"><SettingNum unit="ngày" value={draftCyc.window_days} onChange={v => setDraftCyc(d => ({ ...d, window_days: v }))} /></div>
            </SettingField>
          </SettingGroup>

          <SettingGroup readOnly={!canManage} title="Thời gian lưu dữ liệu" meta={retRow}>
            <div>
              <SettingLabel text="Số ngày giữ" tip="Ảnh = ảnh check xe nâng + ảnh chữ in phun Sổ đóng gói (số liệu và người check GIỮ NGUYÊN, chỉ gỡ ảnh) · Thông báo = feed Cá nhân ở nút chuông · Log lỗi = bảng error_logs phục vụ digest hằng ngày." />
              <div className="grid grid-cols-3 gap-1.5">
                <SettingNum label="Ảnh" unit="ngày" value={draftRet.photos} onChange={v => setDraftRet(d => ({ ...d, photos: v }))} />
                <SettingNum label="Thông báo" unit="ngày" value={draftRet.feed} onChange={v => setDraftRet(d => ({ ...d, feed: v }))} />
                <SettingNum label="Log lỗi" unit="ngày" value={draftRet.error_logs} onChange={v => setDraftRet(d => ({ ...d, error_logs: v }))} />
              </div>
            </div>
          </SettingGroup>

          <SettingGroup readOnly={!canManage} title="Nhập kho" meta={inbRow}>
            <SettingField label="Cửa sổ tự sửa/xóa pallet" tip="Người NHẬP tự sửa/xóa pallet của mình trong bấy nhiêu ngày kể từ ngày nhập. Quá hạn phải nhờ người có quyền force (chứng từ đã chốt).">
              <div className="w-20"><SettingNum unit="ngày" value={draftInb} onChange={setDraftInb} /></div>
            </SettingField>
          </SettingGroup>

          <SettingGroup readOnly={!canManage} title="Chấm công" meta={stdRow}>
            <SettingField label="Giờ công chuẩn / ngày"
              tip="Bảng công quy ngày công ra giờ: tổng giờ = số ngày công × giờ chuẩn + tăng ca − về sớm. Nhận số lẻ 0,5 (vd 7.5). Đổi ở đây là đổi CẢ số trên màn lẫn số trong báo cáo (backend đọc cùng cờ).">
              <div className="w-20"><SettingNum unit="giờ" value={draftStd} onChange={setDraftStd} step={0.5} /></div>
            </SettingField>
          </SettingGroup>

          <SettingGroup readOnly={!canManage} title="Sổ đóng gói" meta={packRow}>
            <SettingField label="Số mã tối đa / trang sổ" tip="Một trang sổ ghi được nhiều mã SX chung chu kỳ + máy; trần này chặn chọn quá tay khi mở trang.">
              <div className="w-20"><SettingNum unit="mã" value={draftPack} onChange={setDraftPack} /></div>
            </SettingField>
          </SettingGroup>

          {/* Lịch nghỉ lễ — công bố đổi hàng năm, trước 14/08 phải sửa code mới đúng */}
          <SettingGroup readOnly={!canManage} title="Lịch nghỉ lễ" meta={holRow}>
            <SettingField label="Ngày nghỉ theo năm"
              tip='NĂM NÀO CÓ KHAI thì bảng công dùng ĐÚNG danh sách khai (kể cả nghỉ bù, Tết dài ngắn theo công bố của Chính phủ); năm không khai vẫn tự tính bằng lịch âm + 4 lễ dương như trước. Bấm "Nạp lịch tự tính" để lấy bản nháp rồi sửa. Ngày lễ = không tính là ngày cần chấm công.'>
              <HolidayEditor value={draftHol} onChange={setDraftHol} readOnly={!canManage} />
            </SettingField>
          </SettingGroup>

          {/* Nhận diện & tham số riêng của ĐƠN VỊ — trước 14/08 là hằng số của LOF nằm rải trong code */}
          <SettingGroup readOnly={!canManage} title="Đơn vị" meta={orgRow}>
            <SettingField label="Email kỹ thuật (thông báo đẩy)"
              tip="Chuẩn Web Push bắt buộc khai MỘT địa chỉ liên hệ kỹ thuật để dịch vụ push của trình duyệt (Google/Apple) báo về khi máy chủ gửi thông báo có vấn đề. KHÔNG gửi/nhận thư ở đây, người dùng không nhìn thấy — nên điền hòm thư quản trị CÓ THẬT của đơn vị. Lưu là áp ngay cho khóa push đang dùng.">
              <Input value={draftOrg.contact_email} onChange={e => setDraftOrg(d => ({ ...d, contact_email: e.target.value }))}
                className="h-7 w-full text-[11px] px-1.5" placeholder="quantri@congty.vn" />
            </SettingField>
            <SettingField label="Mã nhà máy cũ → mới" tip='Khi đọc đoạn NMSX trên tem pallet, mã cũ được quy về mã mới. Viết dạng "A=O", nhiều cặp ngăn bằng dấu phẩy. Để trống nếu đơn vị không có mã cũ.'>
              <Input value={draftOrg.nmsx_alias} onChange={e => setDraftOrg(d => ({ ...d, nmsx_alias: e.target.value.toUpperCase() }))}
                className="h-7 w-full text-[11px] px-1.5 font-mono" placeholder="A=O" />
            </SettingField>
            <div>
              <SettingLabel text="Cỡ thùng giả định" tip="Dùng cho sơ đồ xếp xe 3D khi mã hàng CHƯA khai kích thước thùng. Khai kích thước thật ở Mã hàng thì sơ đồ dùng số thật, ô này không ảnh hưởng." />
              <div className="grid grid-cols-3 gap-1.5">
                <SettingNum label="Dài" unit="mm" value={draftOrg.l} onChange={v => setDraftOrg(d => ({ ...d, l: v }))} />
                <SettingNum label="Rộng" unit="mm" value={draftOrg.w} onChange={v => setDraftOrg(d => ({ ...d, w: v }))} />
                <SettingNum label="Cao" unit="mm" value={draftOrg.h} onChange={v => setDraftOrg(d => ({ ...d, h: v }))} />
              </div>
            </div>
          </SettingGroup>
        </div>
      </div>

      {/* Thanh Lưu dính đáy — stage rồi mới áp dụng */}
      {canManage && <SettingSaveBar dirty={dirty} saving={isPending} onReset={resetDraft} onSave={applyChanges} />}
    </div>
  )
}

// ─── Warehouse Dialog ─────────────────────────────────────────────────────────

interface WhRow { id: string; code: string; name: string; address: string | null; is_active: boolean; warehouse_type: string; inventory_mode: string; shipto_codes?: string[] | null; nmsx_code?: string | null; parent_warehouse_id?: string | null; carton_scan_override?: boolean | null; carton_scan_categories?: string[] | null; carton_scan_require_full?: boolean | null; sap_plant?: string | null; sap_storage_locations?: string[] | null; require_weigh_on_start?: boolean | null; require_gate_on_start?: boolean | null; rotation_principle?: string | null; rotation_required?: boolean | null; created_at?: string; updated_at?: string; created_by?: string | null; updated_by?: string | null }

// Bắt buộc quét đủ tem thùng — chỉ có nghĩa khi bật "Quét tới THÙNG khi xuất" (user chốt 15/07)
const CARTON_REQUIRE_OPTS = [
  { value: 'optional', label: 'Không bắt buộc quét đủ', sub: 'quét được bao nhiêu lưu bấy nhiêu — truy vết mềm' },
  { value: 'required', label: 'Bắt buộc quét đủ thùng',  sub: 'pallet thiếu tem thùng → CHẶN Hoàn thành chuyến' },
]

// Chế độ quản tồn — độc lập với warehouse_type (CENTRAL/NPP). Xem migration 20260626_warehouse_inventory_mode.sql
type InvMode = 'QR' | 'QTY' | 'QTY_DATE' | 'NONE'
const INV_MODE_META: Record<InvMode, { label: string; desc: string; badge: string }> = {
  QR:       { label: 'Tồn kho QR',     desc: 'Theo dõi tồn đầy đủ qua QR (pallet/vị trí/quét)', badge: 'border-green-400 text-green-700 bg-green-50' },
  QTY:      { label: 'Tồn kho số lượng', desc: 'Theo dõi tồn dạng số lượng, không pallet/QR',     badge: 'border-sky-400 text-sky-700 bg-sky-50' },
  QTY_DATE: { label: 'Tồn số lượng theo date', desc: 'Tồn số lượng tách theo NSX — nhập tay phải có NSX, xuất trừ FEFO (date cũ trước, chọn được khi cần)', badge: 'border-indigo-400 text-indigo-700 bg-indigo-50' },
  NONE:     { label: 'Không quản tồn',  desc: 'Không theo dõi tồn (điểm trung chuyển/giao nhận)', badge: 'border-slate-300 text-slate-500 bg-slate-50' },
}
const invModeMeta = (m: string) => INV_MODE_META[(m as InvMode)] ?? INV_MODE_META.QR

function WarehouseDialog({ wh, open, onClose }: { wh: WhRow | null; open: boolean; onClose: () => void }) {
  const isEdit = !!wh
  const [code,          setCode]          = useState(wh?.code ?? '')
  const [name,          setName]          = useState(wh?.name ?? '')
  const [address,       setAddress]       = useState(wh?.address ?? '')
  const [warehouseType, setWarehouseType] = useState<'CENTRAL' | 'NPP'>((wh?.warehouse_type as 'CENTRAL' | 'NPP') ?? 'CENTRAL')
  const [invMode,       setInvMode]       = useState<InvMode>((wh?.inventory_mode as InvMode) ?? 'QR')
  const [shiptoCodes,   setShiptoCodes]   = useState((wh?.shipto_codes ?? []).join(', '))
  const [nmsxCode,      setNmsxCode]      = useState(wh?.nmsx_code ?? '')
  const [sapPlant,      setSapPlant]      = useState(wh?.sap_plant ?? '')
  const [sapSlocs,      setSapSlocs]      = useState((wh?.sap_storage_locations ?? []).join(', '))
  // 2 RULE khi Bắt đầu chuyến xuất (user chốt 01/08): rule 1 đăng ký cổng · rule 2 cân — độc lập,
  // bật rule nào chấp hành rule đó, bật cả 2 phải đủ cả 2. Miễn trừ = quyền outbound.weigh_waive.
  const [requireGate,   setRequireGate]   = useState(wh?.require_gate_on_start === true)
  const [requireWeigh,  setRequireWeigh]  = useState(wh?.require_weigh_on_start === true)
  // Nguyên tắc luân chuyển (14/08): thứ tự lấy hàng + có BẮT BUỘC hay chỉ cảnh báo.
  // Mặc định FEFO + không bắt buộc = đúng hành vi trước đây, kho không tick thì không đổi gì.
  const [rotPrinciple,  setRotPrinciple]  = useState<string>(wh?.rotation_principle ?? 'FEFO')
  const [rotRequired,   setRotRequired]   = useState(wh?.rotation_required === true)
  const [parentId,      setParentId]      = useState(wh?.parent_warehouse_id ?? '__none__')
  const [isActive,      setIsActive]      = useState(wh?.is_active ?? true)
  // Quét tới thùng khi xuất — setup TẠI KHO: công tắc (mặc định TẮT) + CHỌN các Loại kho phải quét ở kho này
  const [cartonScan,    setCartonScan]    = useState(wh?.carton_scan_override === true)
  const [cartonCats,    setCartonCats]    = useState<string[]>(wh?.carton_scan_categories ?? [])
  const [cartonRequire, setCartonRequire] = useState(wh?.carton_scan_require_full === true ? 'required' : 'optional')
  const { data: whTypesForCarton = [] } = useWarehouseTypes()   // taxonomy đầy đủ (trang quản trị)
  const [err, setErr] = useState('')

  // Danh sách kho làm parent: kho thường (không phải kho phụ), trừ chính mình
  const { data: allWhForParent = [] } = useWarehouses(false)
  const parentOpts = [
    { value: '__none__', label: '— Kho thường (không trực thuộc) —' },
    ...(allWhForParent as WhRow[])
      .filter(w => !w.parent_warehouse_id && w.id !== wh?.id)
      .map(w => ({ value: w.id, label: w.name, sub: w.code })),
  ]

  const { mutate: create, isPending: creating } = useCreateWarehouse()
  const { mutate: update, isPending: updating } = useUpdateWarehouse()
  const isPending = creating || updating

  function handleSubmit() {
    setErr('')
    if (!code.trim() || !name.trim()) { setErr('Mã và tên kho là bắt buộc'); return }
    const parent_warehouse_id = parentId === '__none__' ? null : parentId
    if (cartonScan && cartonCats.length === 0) { setErr('Bật quét tới thùng thì chọn ít nhất 1 Loại kho phải quét'); return }
    const carton_scan_override = cartonScan
    const carton_scan_categories = cartonScan ? cartonCats : null
    const carton_scan_require_full = cartonScan && cartonRequire === 'required'
    if (isEdit) {
      update(
        { id: wh.id, name: name.trim(), address: address.trim() || undefined, is_active: isActive, warehouse_type: warehouseType, inventory_mode: invMode, shipto_codes: shiptoCodes, nmsx_code: nmsxCode, parent_warehouse_id, carton_scan_override, carton_scan_categories, carton_scan_require_full, sap_plant: sapPlant, sap_storage_locations: sapSlocs, require_weigh_on_start: requireWeigh, require_gate_on_start: requireGate, rotation_principle: rotPrinciple, rotation_required: rotRequired },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) }
      )
    } else {
      create(
        { code: code.trim(), name: name.trim(), address: address.trim() || undefined, warehouse_type: warehouseType, inventory_mode: invMode, shipto_codes: shiptoCodes, nmsx_code: nmsxCode, parent_warehouse_id, carton_scan_override, carton_scan_categories, carton_scan_require_full, sap_plant: sapPlant, sap_storage_locations: sapSlocs, require_weigh_on_start: requireWeigh, require_gate_on_start: requireGate, rotation_principle: rotPrinciple, rotation_required: rotRequired },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) }
      )
    }
  }

  return (
    <FormSheet open={open} onClose={onClose} title={isEdit ? 'Sửa kho' : 'Thêm kho'} widthClass="sm:max-w-lg" footer={<>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !code.trim() || !name.trim()}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </>}>
        <div className="space-y-3">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          <div className="space-y-1">
            <Label className="text-xs">Mã kho *</Label>
            <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="BV, BB, HN…" disabled={isEdit} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tên kho *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Kho Ba Vì, Kho Bàu Bàng…" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Địa chỉ</Label>
            <Input value={address} onChange={e => setAddress(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Chức năng kho *</Label>
            <Select value={warehouseType} onValueChange={v => setWarehouseType(v as 'CENTRAL' | 'NPP')}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CENTRAL">Kho tổng</SelectItem>
                <SelectItem value="NPP">Kho NPP</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Chế độ quản tồn *</Label>
            <Select value={invMode} onValueChange={v => setInvMode(v as InvMode)}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(INV_MODE_META) as InvMode[]).map(m => (
                  <SelectItem key={m} value={m}>{INV_MODE_META[m].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-slate-400">{INV_MODE_META[invMode].desc}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Trực thuộc kho (kho phụ nội bộ)</Label>
            <SingleSelect options={parentOpts} value={parentId} onChange={setParentId}
              placeholder="— Kho thường (không trực thuộc) —" searchPlaceholder="Tìm kho…" triggerClassName="h-8 w-full text-sm" />
            <p className="text-[10px] text-slate-400">Kho phụ (tổ sản xuất tại site) chỉ giao dịch với kho parent: nhận chuyển kho từ parent, xuất trả parent, xuất tiêu hao. Chuyển nội bộ không cần biển số/booking ĐVVT.</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mã ship-to phụ</Label>
            <Input value={shiptoCodes} onChange={e => setShiptoCodes(e.target.value.toUpperCase())} placeholder="vd: 20000018, 20000019" />
            <p className="text-[10px] text-slate-400">Ngoài mã kho chính. Nhiều mã cách nhau dấu phẩy. Chuyển kho về các mã này đều tự nhận về kho này.</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mã NMSX (kho tổng)</Label>
            <Input value={nmsxCode} onChange={e => setNmsxCode(e.target.value.toUpperCase())} placeholder="vd: B, D…" maxLength={8} />
            <p className="text-[10px] text-slate-400">Đoạn thứ 6 của QR pallet + tiền tố mã vị trí. Để trống nếu kho không có NMSX (vị trí sẽ dùng mã kho). Không trùng giữa các kho.</p>
          </div>
          {/* Map SAP → kho: để CHẶN upload VL06O của kho khác (user chốt 26/07). File VL06O mang mã SAP
              Plant/Storage Location, không phải mã kho app → phải khai ở đây mới siết được theo kho. */}
          <div className="space-y-1 rounded-md border border-slate-200 px-2.5 py-2">
            <Label className="text-xs">Mã SAP của kho (để chặn upload VL06O của kho khác)</Label>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] text-slate-500">Plant SAP</Label>
                <Input value={sapPlant} onChange={e => setSapPlant(e.target.value.toUpperCase())} placeholder="vd: 1102" maxLength={12} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-slate-500">Storage Location</Label>
                <Input value={sapSlocs} onChange={e => setSapSlocs(e.target.value.toUpperCase())} placeholder="vd: FG01, FG02" className="h-8 text-sm" />
              </div>
            </div>
            <p className="text-[10px] text-slate-400">Lấy đúng giá trị 2 cột <b>Plant</b> + <b>Storage Location</b> trong file VL06O. Nhiều Storage Location cách nhau dấu phẩy; để trống = mọi Storage Location của Plant đó thuộc kho này. Chưa khai → dòng SAP đó KHÔNG bị chặn (app chỉ cảnh báo sau khi upload).</p>
          </div>
          {/* 2 RULE khi Bắt đầu chuyến xuất (user chốt 01/08) — độc lập, bật rule nào chấp hành
              rule đó, bật cả 2 phải đủ cả 2. Miễn trừ duy nhất = duyệt trên chuyến (outbound.weigh_waive). */}
          <div className="space-y-1 rounded-md border border-slate-200 px-2.5 py-2">
            <Label className="text-xs">Rule khi Bắt đầu chuyến xuất</Label>
            <label htmlFor="wh-requiregate" className="flex items-start gap-2 cursor-pointer rounded-md px-1 py-1.5 hover:bg-slate-50">
              <input id="wh-requiregate" type="checkbox" checked={requireGate} onChange={e => setRequireGate(e.target.checked)} className="h-4 w-4 mt-0.5 rounded accent-blue-600 shrink-0" />
              <span className="text-xs">
                <span className="font-medium">Rule 1 — Xe phải có ĐĂNG KÝ CỔNG</span>
                <span className="block text-[10px] text-slate-400 font-normal">Bắt đầu phải chọn chuyến xe từ Đăng ký cổng (đúng kho, chiều xuất, đã vào cổng, biển khớp) — khóa đường nhập biển tay. Xe không đăng ký (giao lẻ, xe máy, nhân viên nhận…) → người có quyền <b>Bỏ qua cổng/cân</b> duyệt trên chuyến.</span>
              </span>
            </label>
            <label htmlFor="wh-requireweigh" className="flex items-start gap-2 cursor-pointer rounded-md px-1 py-1.5 hover:bg-slate-50">
              <input id="wh-requireweigh" type="checkbox" checked={requireWeigh} onChange={e => setRequireWeigh(e.target.checked)} className="h-4 w-4 mt-0.5 rounded accent-blue-600 shrink-0" />
              <span className="text-xs">
                <span className="font-medium">Rule 2 — Xe phải CÂN BÌ (kho có trạm cân)</span>
                <span className="block text-[10px] text-slate-400 font-normal">Biển số xe phải khớp 1 phiếu cân <b>chưa hoàn thành</b> của hôm nay mới bấm được Bắt đầu — phiếu cân tự gắn vào chuyến để đối chiếu KL. Xe không cân được (hỏng cân…) → duyệt trên chuyến như rule 1.</span>
              </span>
            </label>
          </div>
          {/* Nguyên tắc luân chuyển (14/08) — thứ tự lấy hàng của kho + có siết hay không.
              Mặc định FEFO + chỉ cảnh báo = hành vi cũ, không kho nào bị đổi khi lên bản này. */}
          <div className="space-y-1.5 rounded-md border border-slate-200 px-2.5 py-2">
            <Label className="text-xs">Nguyên tắc luân chuyển (thứ tự lấy hàng)</Label>
            <SingleSelect
              value={rotPrinciple} onChange={setRotPrinciple}
              options={[
                { value: 'FEFO', label: 'FEFO — hạn dùng ngắn nhất đi trước', sub: 'mặc định, hợp hàng có HSD' },
                { value: 'FIFO', label: 'FIFO — hàng vào trước đi trước',      sub: 'hợp bao bì/vật tư không HSD' },
                { value: 'LIFO', label: 'LIFO — hàng vào sau đi trước',        sub: 'ít dùng, chỉ khi nghiệp vụ yêu cầu' },
              ]}
            />
            <label htmlFor="wh-rotrequired" className="flex items-start gap-2 cursor-pointer rounded-md px-1 py-1.5 hover:bg-slate-50">
              <input id="wh-rotrequired" type="checkbox" checked={rotRequired} onChange={e => setRotRequired(e.target.checked)} className="h-4 w-4 mt-0.5 rounded accent-blue-600 shrink-0" />
              <span className="text-xs">
                <span className="font-medium">Bắt buộc lấy đúng thứ tự</span>
                <span className="block text-[10px] text-slate-400 font-normal">Không tick = chỉ <b>cảnh báo</b> khi quét sai thứ tự (như hiện nay). Tick = <b>CHẶN</b> — người có quyền <b>Duyệt lấy khác thứ tự</b> vẫn qua được nhưng phải chọn lý do, và lý do được thống kê ở trang Lịch sử quét.</span>
              </span>
            </label>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wh-cartonscan" className="flex items-start gap-2 cursor-pointer rounded-md border border-slate-200 px-2.5 py-2 hover:bg-slate-50">
              <input id="wh-cartonscan" type="checkbox" checked={cartonScan} onChange={e => setCartonScan(e.target.checked)} className="h-4 w-4 mt-0.5 rounded accent-blue-600 shrink-0" />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-slate-700">Quét tới THÙNG khi xuất</span>
                <span className="block text-[11px] text-slate-400 leading-snug">Mặc định TẮT. Bật thì chọn các Loại kho phải quét tem thùng TẠI KHO NÀY (đính kèm truy vết, không tính tồn theo thùng). Mỗi kho chọn độc lập.</span>
              </span>
            </label>
            {cartonScan && (
              <div className="pl-6 space-y-1">
                <Label className="text-xs">Loại kho phải quét thùng ở kho này *</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {whTypesForCarton.map(t => (
                    <label key={t.id} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-[12px] cursor-pointer ${cartonCats.includes(t.value) ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}>
                      <input type="checkbox" className="h-3.5 w-3.5 accent-blue-600" checked={cartonCats.includes(t.value)}
                        onChange={() => setCartonCats(p => p.includes(t.value) ? p.filter(x => x !== t.value) : [...p, t.value])} />
                      {t.value}
                    </label>
                  ))}
                </div>
                <Label className="text-xs pt-1 block">Quét đủ thùng</Label>
                <SingleSelect options={CARTON_REQUIRE_OPTS} value={cartonRequire} onChange={setCartonRequire}
                  triggerClassName="h-8 w-full text-sm" />
                <p className="text-[10px] text-slate-400">Bắt buộc: khi Hoàn thành chuyến, mỗi pallet đã quét phải đính đủ tem thùng khớp mã (bằng số thùng của pallet) — thiếu sẽ bị chặn kèm danh sách pallet.</p>
              </div>
            )}
          </div>
          {isEdit && (
            <div className="flex items-center gap-2">
              <input id="wh-active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
              <Label htmlFor="wh-active" className="text-sm cursor-pointer">Đang hoạt động</Label>
            </div>
          )}
        </div>
    </FormSheet>
  )
}

// ─── Zone Dialog ──────────────────────────────────────────────────────────────

function ZoneDialog({ zone, warehouseId, warehouses, warehouseTypes, open, onClose }: {
  zone: WarehouseZone | null; warehouseId: string; warehouses: WhRow[]
  warehouseTypes: { id: string; value: string }[]; open: boolean; onClose: () => void
}) {
  const isEdit = !!zone
  const [selectedWhId, setSelectedWhId] = useState(zone?.warehouse_id ?? warehouseId)
  const [code,     setCode]     = useState(zone?.code ?? '')
  const [name,     setName]     = useState(zone?.name ?? '')
  // Multi loại kho (27/07): khu chứa được NHIỀU loại, BẮT BUỘC chọn ≥1
  const [categories, setCategories] = useState<string[]>(zone?.categories ?? [])
  const [maxPallets, setMaxPallets] = useState(zone?.max_pallets != null ? String(zone.max_pallets) : '')
  const [isActive, setIsActive] = useState(zone?.is_active ?? true)
  const [err, setErr] = useState('')

  const { mutate: create, isPending: creating } = useCreateWarehouseZone()
  const { mutate: update, isPending: updating } = useUpdateWarehouseZone()
  const isPending = creating || updating

  function handleSubmit() {
    setErr('')
    if (!isEdit && !selectedWhId) { setErr('Chọn kho là bắt buộc'); return }
    if (!name.trim()) { setErr('Tên khu vực là bắt buộc'); return }
    if (categories.length === 0) { setErr('Chọn ít nhất 1 Loại kho cho khu vực'); return }
    const mpRaw = maxPallets.trim()
    if (mpRaw && (!Number.isFinite(Number(mpRaw)) || Number(mpRaw) < 0)) { setErr('Pallet tối đa phải là số ≥ 0'); return }
    const mp = mpRaw ? Math.round(Number(mpRaw)) : null
    if (isEdit) {
      update(
        { id: zone.id, name: name.trim(), categories, is_active: isActive, max_pallets: mp },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) }
      )
    } else {
      create(
        { warehouse_id: selectedWhId, name: name.trim(), categories, code: code.trim() || undefined, max_pallets: mp },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) }
      )
    }
  }

  return (
    <FormSheet open={open} onClose={onClose} title={isEdit ? 'Sửa khu vực' : 'Thêm khu vực kho'} widthClass="sm:max-w-lg" footer={<>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !name.trim() || (!isEdit && !selectedWhId)}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </>}>
        <div className="space-y-3">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}

          {/* Kho */}
          {isEdit ? (
            <div className="space-y-1">
              <Label className="text-xs">Kho</Label>
              <p className="text-sm font-medium text-slate-700">
                {warehouses.find(w => w.id === zone.warehouse_id)?.name ?? '—'}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <Label className="text-xs">Kho *</Label>
              <Select value={selectedWhId || '__none__'} onValueChange={v => setSelectedWhId(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Chọn kho" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Chọn kho</SelectItem>
                  {warehouses.map(w => (
                    <SelectItem key={w.id} value={w.id}>{w.name} ({w.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Loại kho — chọn NHIỀU, bắt buộc ≥1 (khu chứa cả RM01 + PK01…) — dropdown chuẩn form */}
          <div className="space-y-1">
            <Label className="text-xs">Loại kho <span className="text-red-500">*</span> <span className="text-slate-400 font-normal">(chọn được nhiều)</span></Label>
            <WarehouseMultiSelect
              warehouses={warehouseTypes.map(t => ({ id: t.value, name: t.value }))}
              selected={categories}
              onChange={setCategories}
              placeholder="Chọn loại kho…"
              unitLabel="loại kho"
              searchPlaceholder="Tìm loại kho…"
            />
            <p className="text-[10px] text-slate-400">Khu chỉ nhận hàng đúng các loại đã chọn; vị trí trong khu tự kế thừa</p>
          </div>

          {/* Mã khu vực */}
          <div className="space-y-1">
            <Label className="text-xs">Mã khu vực{!isEdit && <span className="text-slate-400"> (tùy chọn)</span>}</Label>
            {isEdit ? (
              <p className="text-sm font-mono font-semibold text-slate-700">{zone.code}</p>
            ) : (
              <>
                <Input value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/\s+/g, ''))} placeholder="vd: TP1, K4RAW…" />
                <p className="text-[10px] text-slate-400">Là phần giữa mã vị trí (B_<b>TP1</b>_1_T1). Để trống = tự tạo Z01, Z02… Không trùng trong cùng kho (khác kho trùng nhau OK).</p>
              </>
            )}
          </div>

          {/* Tên */}
          <div className="space-y-1">
            <Label className="text-xs">Tên khu vực *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Khu Thành phẩm, Khu NVL…" />
          </div>

          {/* Pallet tối đa (sức chứa khai tay — Dashboard so tồn vs tối đa) */}
          <div className="space-y-1">
            <Label className="text-xs">Pallet tối đa <span className="text-slate-400">(tùy chọn)</span></Label>
            <Input type="number" min={0} value={maxPallets} onChange={e => setMaxPallets(e.target.value)} placeholder="vd: 5000" />
            <p className="text-[10px] text-slate-400">Sức chứa pallet của khu — Dashboard so sánh pallet tồn với số này. Để trống = chưa khai.</p>
          </div>

          {isEdit && (
            <div className="flex items-center gap-2">
              <input id="zone-active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
              <Label htmlFor="zone-active" className="text-sm cursor-pointer">Đang hoạt động</Label>
            </div>
          )}
          {/* Hạng nhặt / Luồng cửa (slotting) chỉnh ở trang Tối ưu vị trí → tab Cài đặt (user chốt) */}
        </div>
    </FormSheet>
  )
}

// ─── Type Dialog ─────────────────────────────────────────────────────────────

// Nhãn bảng đổi tên cascade → tiếng Việt (hiện trong toast kết quả)
const RENAMED_LABELS: Record<string, string> = {
  Material: 'Mã hàng', Location: 'Vị trí', WarehouseZone: 'Khu vực', Employee: 'Nhân viên',
  SlotTemplate: 'Khung giờ mẫu', DeliverySlot: 'Khung giờ', TmsOrder: 'Đơn TMS',
  GroupDeliveryOrder: 'Chuyến xuất', gate_registrations: 'Đăng ký cổng',
  inbound_plan_lines: 'KH nhập', ProductionImport: 'Phiếu nhập',
}

function TypeDialog({ type, open, onClose }: {
  type: { id: string; value: string; meta?: WhTypeMeta | null } | null; open: boolean; onClose: () => void
}) {
  const isEdit = !!type
  const m = type?.meta ?? {}
  const [value, setValue] = useState(type?.value ?? '')
  // Cờ hành vi per-loại (LookupValue.meta) — thay các hardcode tên loại cũ
  const [isNcc,      setIsNcc]      = useState(m.is_ncc_goods ?? false)
  const [reqShelf,   setReqShelf]   = useState(m.requires_shelf_life ?? true)          // default = hành vi Thành phẩm
  const [reqPalletEa,setReqPalletEa]= useState(m.requires_pallet_per_ea ?? false)
  const [reqNcc,     setReqNcc]     = useState(m.requires_ncc ?? false)
  const [useBatchChar, setUseBatchChar] = useState(!!(m.batch_char ?? '').trim())      // tick = loại dùng ký tự cố định
  const [batchChar,  setBatchChar]  = useState(m.batch_char ?? '')
  const [badge,      setBadge]      = useState(m.badge_color ?? '')
  const [err, setErr] = useState('')

  const { mutate: add,    isPending: adding    } = useAddWarehouseType()
  const { mutate: update, isPending: updating  } = useUpdateWarehouseType()
  const isPending = adding || updating

  function handleSubmit() {
    setErr('')
    const name = value.trim()
    if (!name) { setErr('Tên loại kho là bắt buộc'); return }
    if (useBatchChar && !batchChar.trim()) { setErr('Đã tick dùng ký tự mã lô — nhập 1 ký tự (vd K)'); return }
    const meta: WhTypeMeta = {
      is_ncc_goods: isNcc, requires_shelf_life: reqShelf, requires_pallet_per_ea: reqPalletEa,
      requires_ncc: reqNcc,
      batch_char: useBatchChar ? batchChar.trim().toUpperCase().slice(0, 1) : '', badge_color: badge,
    }
    if (isEdit) {
      // Đổi TÊN = cascade toàn DB (Material/Vị trí/Khu vực/quyền NV/khung giờ/đơn hàng…) — xác nhận trước
      if (name !== type.value && !confirm(
        `Đổi tên loại kho "${type.value}" → "${name}"?\n\nMọi dữ liệu đang dùng tên cũ (mã hàng, vị trí, khu vực, quyền nhân viên, khung giờ TMS, đơn hàng, phiếu nhập…) sẽ được cập nhật đồng bộ theo tên mới.`
      )) return
      update({ id: type.id, value: name, meta }, {
        onSuccess: data => {
          if (data?.renamed) {
            const parts = Object.entries(data.renamed).filter(([, n]) => n > 0)
              .map(([t, n]) => `${RENAMED_LABELS[t] ?? t}: ${n}`)
            toast({ title: `Đã đổi tên "${type.value}" → "${name}"`,
              description: parts.length ? `Cập nhật đồng bộ — ${parts.join(' · ')}` : 'Chưa có dữ liệu nào dùng tên cũ' })
          } else {
            toast({ title: `Đã lưu loại kho "${name}"` })
          }
          onClose()
        },
        onError: e => setErr(apiMsg(e)),
      })
    } else {
      add({ value: name, meta }, {
        onSuccess: () => { toast({ title: `Đã tạo loại kho "${name}"` }); onClose() },
        onError: e => setErr(apiMsg(e)),
      })
    }
  }

  const flagRow = (id: string, checked: boolean, onChange: (v: boolean) => void, label: string, hint: string) => (
    <label htmlFor={id} className="flex items-start gap-2 cursor-pointer rounded-md border border-slate-200 px-2.5 py-2 hover:bg-slate-50">
      <input id={id} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-4 w-4 mt-0.5 rounded accent-blue-600 shrink-0" />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-slate-700">{label}</span>
        <span className="block text-[11px] text-slate-400 leading-snug">{hint}</span>
      </span>
    </label>
  )

  return (
    <FormSheet open={open} onClose={onClose} title={isEdit ? 'Sửa loại kho' : 'Thêm loại kho'} widthClass="sm:max-w-lg" footer={<>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !value.trim()}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </>}>
        <div className="space-y-3">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          <div className="space-y-1">
            <Label className="text-xs">Tên loại kho *</Label>
            <Input value={value} onChange={e => setValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
              placeholder="Thành phẩm, Nguyên liệu, Vật tư…" />
            {isEdit && value.trim() !== type.value && (
              <p className="text-[11px] text-amber-600">Đổi tên sẽ cập nhật đồng bộ TOÀN BỘ dữ liệu đang dùng tên cũ.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Hành vi</Label>
            {flagRow('wt-ncc', isNcc, setIsNcc, 'Hàng NCC',
              'Quét nhập tem gạch dưới ( _ ): đoạn 4 của QR là MÃ NCC (tự nhận NCC) thay vì Máy sản xuất')}
            {flagRow('wt-shelf', reqShelf, setReqShelf, 'Bắt buộc HSD',
              'Mã hàng thuộc loại này phải khai HSD (ngày) — dùng tính %Date')}
            {flagRow('wt-palletea', reqPalletEa, setReqPalletEa, 'Bắt buộc Pallet/EA',
              'Mã hàng thuộc loại này phải khai Pallet/EA để quy đổi tồn EA → pallet')}
            {flagRow('wt-reqncc', reqNcc, setReqNcc, 'Bắt buộc có NCC khi nhập kho',
              'Chặn lưu pallet thiếu NCC ở quét nhập, nhập tay và upload tồn kho. Chuyển kho kế thừa NCC từ pallet gốc, không chặn.')}
          </div>

          <div className="space-y-1.5">
            {flagRow('wt-batchchar', useBatchChar, v => { setUseBatchChar(v); if (!v) setBatchChar('') },
              'Ký tự mã lô cố định (tem chấm phẩy ; )',
              'Sinh tem V2: dùng 1 ký tự cố định của Loại kho thế chỗ Máy trong mã lô — vd điền K thì mã lô ra SI260311K021. Bỏ tick = chọn Máy tay khi sinh tem (Thành phẩm).')}
            {useBatchChar && (
              <div className="flex items-center gap-2 pl-6">
                <Label className="text-xs shrink-0">Ký tự của loại này *</Label>
                <Input value={batchChar} maxLength={1} className="w-14 uppercase text-center"
                  autoFocus={!batchChar}
                  onChange={e => setBatchChar(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Màu hiển thị</Label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {Object.keys(WH_BADGE_COLORS).map(c => (
                <button key={c} type="button" onClick={() => setBadge(badge === c ? '' : c)}
                  title={c}
                  className={`h-6 px-2 rounded-full text-[10px] font-medium border transition-all ${WH_BADGE_COLORS[c]} ${badge === c ? 'ring-2 ring-offset-1 ring-blue-500 border-transparent' : 'border-transparent opacity-70 hover:opacity-100'}`}>
                  {value.trim() || 'Aa'}
                </button>
              ))}
            </div>
          </div>
        </div>
    </FormSheet>
  )
}

// ─── Ca nhập / Tình trạng QA (cùng shape: code/name/display_order/is_active) ────

interface MetaRow { id: string; code: string; name: string; display_order: number; is_active: boolean }

function MetaDialog({ kind, row, open, onClose }: {
  kind: 'shift' | 'qa'; row: MetaRow | null; open: boolean; onClose: () => void
}) {
  const isEdit = !!row
  const [code,     setCode]     = useState(row?.code ?? '')
  const [name,     setName]     = useState(row?.name ?? '')
  const [order,    setOrder]    = useState(String(row?.display_order ?? 0))
  const [isActive, setIsActive] = useState(row?.is_active ?? true)
  const [err, setErr] = useState('')

  const createShift = useCreateImportShift()
  const updateShift = useUpdateImportShift()
  const createQA    = useCreateQAStatus()
  const updateQA    = useUpdateQAStatus()
  const noun = kind === 'shift' ? 'ca nhập' : 'trạng thái QA'
  const isPending = kind === 'shift'
    ? createShift.isPending || updateShift.isPending
    : createQA.isPending || updateQA.isPending

  function handleSubmit() {
    setErr('')
    if (!code.trim() || !name.trim()) { setErr('Mã và tên là bắt buộc'); return }
    const display_order = Number(order) || 0
    const opts = { onSuccess: onClose, onError: (e: unknown) => setErr(apiMsg(e)) }
    if (isEdit) {
      const body = { id: row.id, code: code.trim(), name: name.trim(), display_order, is_active: isActive }
      if (kind === 'shift') updateShift.mutate(body, opts); else updateQA.mutate(body, opts)
    } else {
      const body = { code: code.trim(), name: name.trim(), display_order }
      if (kind === 'shift') createShift.mutate(body, opts); else createQA.mutate(body, opts)
    }
  }

  return (
    <FormSheet open={open} onClose={onClose} title={isEdit ? `Sửa ${noun}` : `Thêm ${noun}`} widthClass="sm:max-w-lg" footer={<>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !code.trim() || !name.trim()}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </>}>
        <div className="space-y-3">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Mã *</Label>
              <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder={kind === 'shift' ? 'C1' : 'OK'} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Tên *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder={kind === 'shift' ? 'Ca 1, Ca hành chính…' : 'Đạt, Chờ kiểm…'} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Thứ tự hiển thị</Label>
            <Input type="number" value={order} onChange={e => setOrder(e.target.value)} className="w-24" />
          </div>
          {isEdit && (
            <div className="flex items-center gap-2">
              <input id="meta-active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
              <Label htmlFor="meta-active" className="text-sm cursor-pointer">Đang sử dụng</Label>
            </div>
          )}
        </div>
    </FormSheet>
  )
}

function MetaTab({ noun, rows, loading, canManage, onAdd, onEdit }: {
  noun: string; rows: MetaRow[]; loading: boolean; canManage: boolean
  onAdd: () => void; onEdit: (r: MetaRow) => void
}) {
  return (
    <>
      <div className="border-b px-3 py-1.5 shrink-0 flex items-center gap-2 flex-wrap">
        <p className="text-xs text-slate-500 flex-1">{rows.length} {noun}</p>
        {canManage && (
          <ActionCluster className="shrink-0" items={[{
            key: 'add', icon: Plus, label: `Thêm ${noun}`, tip: `Thêm ${noun} mới`,
            primary: true, variant: 'default',
            onClick: onAdd,
          } satisfies ActionItem]} />
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {loading ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> :
          rows.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">Chưa có {noun} nào</div>
          ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Mã</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tên</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Thứ tự</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Trạng thái</TableHead>
                    {canManage && <TableHead className="px-2 py-1.5 w-12" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.id} className={`${!r.is_active ? 'opacity-50' : ''}`}>
                      <TableCell className="px-2 py-1 font-mono font-semibold text-[10px] text-slate-600 whitespace-nowrap">{r.code}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] font-medium text-slate-800 whitespace-nowrap">{r.name}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] text-slate-500 tabular-nums whitespace-nowrap">{r.display_order}</TableCell>
                      <TableCell className="px-2 py-1 whitespace-nowrap">
                        <Badge variant={r.is_active ? 'default' : 'secondary'} className="text-xs">
                          {r.is_active ? 'Hoạt động' : 'Tạm dừng'}
                        </Badge>
                      </TableCell>
                      {canManage && (
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          <button className="text-slate-400 hover:text-blue-500 p-1 transition-colors" onClick={() => onEdit(r)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
          )
        }
      </div>
    </>
  )
}

// ─── Đơn vị tính (unit_of_measure) ─────────────────────────────────────────────
// Danh mục Base/Entry Unit — thay trường ĐVT cũ. role quyết định ĐVT hiện ở selector nào của Mã hàng.
const UNIT_ROLE_OPTS = [
  { value: 'base',  label: 'Base (đơn vị gốc)',        sub: 'Đơn vị nhỏ nhất để tính toán — hộp/chai/kg/cái' },
  { value: 'entry', label: 'Entry (đơn vị nhập/thùng)', sub: 'Đơn vị đóng gói lớn — 1 Entry = N Base' },
  { value: 'both',  label: 'Cả 2 (base hoặc entry)',    sub: 'Dùng được cho cả hai vai' },
]
const UNIT_ROLE_LABEL: Record<UnitRole, string> = { base: 'Base', entry: 'Entry', both: 'Cả 2' }
const UNIT_ROLE_BADGE: Record<UnitRole, string> = {
  base:  'border-emerald-400 text-emerald-700 bg-emerald-50',
  entry: 'border-sky-400 text-sky-700 bg-sky-50',
  both:  'border-violet-400 text-violet-700 bg-violet-50',
}
const unitRoleOf = (u: UnitRow): UnitRole => (u.meta?.role ?? 'both')

function UnitDialog({ unit, open, onClose }: { unit: UnitRow | null; open: boolean; onClose: () => void }) {
  const isEdit = !!unit
  const [value, setValue] = useState(unit?.value ?? '')
  const [label, setLabel] = useState(unit?.meta?.label ?? '')
  const [role,  setRole]  = useState<UnitRole>(unit?.meta?.role ?? 'both')
  const [err, setErr] = useState('')

  const { mutate: add,    isPending: adding   } = useAddUnit()
  const { mutate: update, isPending: updating } = useUpdateUnit()
  const isPending = adding || updating

  function handleSubmit() {
    setErr('')
    const code = value.trim().toUpperCase()
    if (!code) { setErr('Mã ĐVT là bắt buộc (vd HOP, CAR, KG)'); return }
    const meta = { role, label: label.trim() || undefined }
    const opts = { onSuccess: onClose, onError: (e: unknown) => setErr(apiMsg(e)) }
    if (isEdit) update({ id: unit.id, value: code, meta }, opts)
    else        add({ value: code, meta }, opts)
  }

  return (
    <FormSheet open={open} onClose={onClose} title={isEdit ? 'Sửa đơn vị tính' : 'Thêm đơn vị tính'} widthClass="sm:max-w-lg" footer={<>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !value.trim()}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </>}>
        <div className="space-y-3">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          <div className="space-y-1">
            <Label className="text-xs">Mã ĐVT *</Label>
            <Input value={value} onChange={e => setValue(e.target.value.toUpperCase())} placeholder="HOP, CAR, KG, BT, BAG, EA…" disabled={isEdit}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }} />
            <p className="text-[10px] text-slate-400">Mã dùng trong tính toán (Base/Entry Unit của mã hàng). {isEdit && 'Không đổi mã sau khi tạo (đang được mã hàng dùng).'}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tên đầy đủ</Label>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Hộp, Thùng, Kilogram… (tùy chọn)" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Loại ĐVT *</Label>
            <SingleSelect options={UNIT_ROLE_OPTS} value={role} onChange={v => setRole(v as UnitRole)}
              searchable={false} triggerClassName="w-full h-8 text-sm" />
            <p className="text-[10px] text-slate-400">Base = hiện ở ô Base Unit; Entry = hiện ở ô Entry Unit; Cả 2 = cả hai. Một mã hàng KHÔNG được đặt Base trùng Entry.</p>
          </div>
        </div>
    </FormSheet>
  )
}

function UnitTab({ canManage }: { canManage: boolean }) {
  const { data: units = [], isLoading } = useUnits()
  const { mutate: del, isPending: deleting } = useDeleteUnit()
  const [editing, setEditing] = useState<UnitRow | null>(null)
  const [showDlg, setShowDlg] = useState(false)

  function handleDelete(u: UnitRow) {
    if (!confirm(`Xóa đơn vị tính "${u.value}"?`)) return
    del(u.id, { onError: e => toast({ variant: 'destructive', title: 'Không xóa được ĐVT', description: apiMsg(e) }) })
  }

  return (
    <>
      <div className="border-b px-3 py-1.5 shrink-0 flex items-center gap-2 flex-wrap">
        <p className="text-xs text-slate-500 flex-1 min-w-[160px] truncate">{units.length} đơn vị tính · Base/Entry Unit của mã hàng</p>
        {canManage && (
          <ActionCluster className="shrink-0" items={[{
            key: 'add', icon: Plus, label: 'Thêm ĐVT', tip: 'Thêm đơn vị tính mới',
            primary: true, variant: 'default', onClick: () => { setEditing(null); setShowDlg(true) },
          } satisfies ActionItem]} />
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {isLoading ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> :
          units.length === 0 ? (
            <div className="p-12 text-center text-slate-400 space-y-2">
              <Ruler className="h-10 w-10 mx-auto opacity-30" />
              <p className="text-sm">Chưa có đơn vị tính nào</p>
              {canManage && <p className="text-xs">Nhấn "Thêm ĐVT" để tạo (vd HOP=Base, CAR=Entry)</p>}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Mã</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tên</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Loại</TableHead>
                  {canManage && <TableHead className="px-2 py-1.5 w-16" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {units.map(u => (
                  <TableRow key={u.id}>
                    <TableCell className="px-2 py-1 font-mono font-semibold text-[10px] text-slate-700 whitespace-nowrap">{u.value}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-slate-600 whitespace-nowrap">{u.meta?.label || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <Badge variant="outline" className={`text-[10px] ${UNIT_ROLE_BADGE[unitRoleOf(u)]}`}>{UNIT_ROLE_LABEL[unitRoleOf(u)]}</Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell className="px-2 py-1 whitespace-nowrap">
                        <div className="flex items-center gap-0.5">
                          <button className="text-slate-400 hover:text-blue-500 p-1 transition-colors" onClick={() => { setEditing(u); setShowDlg(true) }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button className="text-slate-400 hover:text-red-500 p-1 transition-colors" disabled={deleting} onClick={() => handleDelete(u)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        }
      </div>
      {showDlg && <UnitDialog unit={editing} open={showDlg} onClose={() => setShowDlg(false)} />}
    </>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function WMSSettings() {
  const user = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const admin = isAdmin(user)
  // Mỗi tab = 1 quyền riêng (ẩn tab nếu không có quyền). Admin thấy hết.
  const canManageWarehouse = admin || can(perms, 'wms_settings', 'manage_warehouse')
  const canManageType      = admin || can(perms, 'wms_settings', 'manage_type')
  const canManageUnit      = admin || can(perms, 'wms_settings', 'manage_unit')
  const canManageZone      = admin || can(perms, 'wms_settings', 'manage_zone')
  const canManageShift     = admin || can(perms, 'wms_settings', 'manage_shift')
  const canManageQA        = admin || can(perms, 'wms_settings', 'manage_qa')
  const canManageMachine   = admin || can(perms, 'wms_settings', 'manage_machine')
  const canManageSystem    = admin || can(perms, 'wms_settings', 'manage_system')
  const visibleTabs = [
    canManageWarehouse && 'warehouses',
    canManageType      && 'types',
    canManageUnit      && 'units',
    canManageZone      && 'zones',
    canManageShift     && 'shifts',
    canManageQA        && 'qa',
    canManageMachine   && 'machines',
    canManageSystem    && 'system',
  ].filter(Boolean) as string[]
  const defaultTab = visibleTabs[0]

  // Kho
  const { data: allWh = [], isLoading: loadingWh } = useWarehouses(false)
  const { mutate: deleteWh, isPending: deletingWh } = useDeleteWarehouse()
  const [editingWh, setEditingWh] = useState<WhRow | null>(null)
  const [showWhDlg, setShowWhDlg] = useState(false)

  // Loại kho
  const { data: warehouseTypes = [], isLoading: loadingTypes } = useWarehouseTypes()
  const { mutate: deleteType, isPending: deletingType }  = useDeleteWarehouseType()
  const [editingType, setEditingType] = useState<{ id: string; value: string; meta?: WhTypeMeta | null } | null>(null)
  const [showTypeDlg, setShowTypeDlg] = useState(false)

  // Kéo-thả sắp thứ tự loại kho (kiểu AppSheet: grip + chỉ báo trên/dưới theo nửa dòng)
  type TypeRow = { id: string; value: string; meta?: WhTypeMeta | null; created_at?: string; updated_at?: string; created_by?: string | null; updated_by?: string | null }
  const reorderTypes = useReorderWarehouseTypes()
  const [orderedTypes, setOrderedTypes] = useState<TypeRow[]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overType, setOverType] = useState<{ idx: number; below: boolean } | null>(null)
  // Đồng bộ từ server khi KHÔNG đang kéo (sau reorder, refetch sẽ cập nhật đúng thứ tự).
  // Dep = chuỗi NỘI DUNG ổn định (KHÔNG dùng ref mảng — fallback [] đổi ref mỗi render → loop vô hạn).
  // Phải gồm cả value + meta: đổi tên/cờ giữ nguyên id — chỉ key theo id thì bảng kẹt bản cũ tới khi F5.
  const typesKey = (warehouseTypes as TypeRow[]).map(t => `${t.id}|${t.value}|${JSON.stringify(t.meta ?? {})}`).join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (dragIdx !== null) return
    setOrderedTypes(warehouseTypes as TypeRow[])
    // Pane detail đang mở cũng nhận bản mới (giữ theo id)
    setDetailType(prev => prev ? ((warehouseTypes as TypeRow[]).find(t => t.id === prev.id) ?? null) : null)
  }, [typesKey, dragIdx])
  function dropType() {
    const from = dragIdx, ov = overType
    setDragIdx(null); setOverType(null)
    if (from === null || !ov) return
    let toIdx = ov.below ? ov.idx + 1 : ov.idx
    if (from < toIdx) toIdx--               // bù lại do đã splice phần tử kéo
    if (toIdx === from) return
    const next = [...orderedTypes]
    const [moved] = next.splice(from, 1)
    next.splice(toIdx, 0, moved)
    setOrderedTypes(next)
    reorderTypes.mutate(next.map(t => t.id), {
      onError: e => { toast({ variant: 'destructive', title: 'Không lưu được thứ tự', description: apiMsg(e) }); setOrderedTypes(warehouseTypes as TypeRow[]) },
    })
  }

  // Detail panel state
  const [detailWh,   setDetailWh]   = useState<WhRow | null>(null)
  const [detailType, setDetailType] = useState<{ id: string; value: string; meta?: WhTypeMeta | null; created_at?: string; updated_at?: string; created_by?: string | null; updated_by?: string | null } | null>(null)
  const [detailZone, setDetailZone] = useState<WarehouseZone | null>(null)

  // Khu vực kho — lọc theo warehouse_scope của user
  // Loại kho trong form/filter Khu vực cắt theo allowed_categories (tab Loại kho vẫn full — quản trị taxonomy)
  const { data: scopedWhTypes = [] } = useScopedWhTypes()
  const activeWh = (allWh as WhRow[]).filter(w => w.is_active)
  // Scope kho cho tab Khu vực: ASSIGNED → chỉ kho được gán (khớp gác BE zoneController); còn lại → tất cả.
  const zoneAccessWh = (admin || user?.warehouse_scope !== 'ASSIGNED')
    ? activeWh
    : activeWh.filter(w => (user?.warehouse_ids ?? []).includes(w.id))
  const [selectedWhId, setSelectedWhId] = useState('')
  const effectiveWhId = selectedWhId || zoneAccessWh[0]?.id || ''
  const { data: zones = [], isLoading: loadingZones } = useWarehouseZones(effectiveWhId || undefined)
  const { mutate: deleteZone, isPending: deletingZone } = useDeleteWarehouseZone()
  const [editingZone, setEditingZone] = useState<WarehouseZone | null>(null)
  const [showZoneDlg, setShowZoneDlg] = useState(false)

  // Ca nhập
  const { data: shifts = [], isLoading: loadingShifts } = useImportShifts()
  const [editShift, setEditShift] = useState<MetaRow | null>(null)
  const [showShiftDlg, setShowShiftDlg] = useState(false)

  // Tình trạng QA
  const { data: qaStatuses = [], isLoading: loadingQA } = useQAStatuses()
  const [editQA, setEditQA] = useState<MetaRow | null>(null)
  const [showQADlg, setShowQADlg] = useState(false)

  // ── Filter: Kho ──
  const [whSearch, setWhSearch] = useState('')
  const [whFunc,   setWhFunc]   = useState('')   // '' | CENTRAL | NPP
  const [whInv,    setWhInv]    = useState('')   // '' | QR | QTY | NONE
  const [whStatus, setWhStatus] = useState('')   // '' | active | inactive
  const whRank = (t: string) => (t === 'CENTRAL' ? 0 : t === 'NPP' ? 1 : 2)
  const filteredWh = (allWh as WhRow[]).filter(w => {
    if (whFunc && w.warehouse_type !== whFunc) return false
    if (whInv && w.inventory_mode !== whInv) return false
    if (whStatus && (whStatus === 'active') !== w.is_active) return false
    const q = whSearch.trim().toLowerCase()
    if (q && !`${w.code} ${w.name} ${w.address ?? ''}`.toLowerCase().includes(q)) return false
    return true
  }).sort((a, b) => {
    // Kho tổng (CENTRAL) trước, rồi NPP; trong cùng nhóm sắp theo địa chỉ
    if (whRank(a.warehouse_type) !== whRank(b.warehouse_type)) return whRank(a.warehouse_type) - whRank(b.warehouse_type)
    return (a.address ?? '').localeCompare(b.address ?? '', 'vi')
  })
  const whFilterDefs: FilterDef[] = [
    { key: 'func', label: 'Chức năng', type: 'single', value: whFunc, onChange: setWhFunc, allLabel: 'Tất cả',
      options: [{ value: 'CENTRAL', label: 'Kho tổng' }, { value: 'NPP', label: 'Kho NPP' }] },
    { key: 'inv', label: 'Quản tồn', type: 'single', value: whInv, onChange: setWhInv, allLabel: 'Tất cả',
      options: (Object.keys(INV_MODE_META) as InvMode[]).map(m => ({ value: m, label: INV_MODE_META[m].label })) },
    { key: 'wst', label: 'Trạng thái', type: 'single', value: whStatus, onChange: setWhStatus, allLabel: 'Tất cả',
      options: [{ value: 'active', label: 'Hoạt động' }, { value: 'inactive', label: 'Tạm dừng' }] },
  ]

  // ── Filter: Khu vực kho ──
  const [zoneSearch, setZoneSearch] = useState('')
  const [zoneCat,    setZoneCat]    = useState('')
  const [zoneStatus, setZoneStatus] = useState('')
  const filteredZones = (zones as WarehouseZone[]).filter(z => {
    if (zoneCat && !(z.categories ?? []).includes(zoneCat)) return false
    if (zoneStatus && (zoneStatus === 'active') !== z.is_active) return false
    const q = zoneSearch.trim().toLowerCase()
    if (q && !`${z.code} ${z.name}`.toLowerCase().includes(q)) return false
    return true
  })
  const zoneFilterDefs: FilterDef[] = [
    { key: 'zcat', label: 'Loại kho', type: 'single', value: zoneCat, onChange: setZoneCat, allLabel: 'Tất cả',
      options: (scopedWhTypes as { id: string; value: string }[]).map(t => ({ value: t.value, label: t.value })) },
    { key: 'zst', label: 'Trạng thái', type: 'single', value: zoneStatus, onChange: setZoneStatus, allLabel: 'Tất cả',
      options: [{ value: 'active', label: 'Hoạt động' }, { value: 'inactive', label: 'Tạm dừng' }] },
  ]

  function handleDeleteWh(wh: WhRow) {
    if (!confirm(`Xóa kho "${wh.name}"?\nChỉ xóa được kho chưa có vị trí nào.`)) return
    deleteWh(wh.id, { onError: e => toast({ variant: 'destructive', title: 'Không xóa được kho', description: apiMsg(e) }) })
  }

  function handleDeleteZone(z: WarehouseZone) {
    if (!confirm(`Xóa khu vực "${z.code} – ${z.name}"?`)) return
    deleteZone(z.id, { onError: e => toast({ variant: 'destructive', title: 'Không xóa được khu vực', description: apiMsg(e) }) })
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {!defaultTab ? (
        <div className="p-12 text-center text-slate-400 text-sm">
          Bạn chưa được cấp quyền quản lý mục nào trong Cài đặt WMS.
        </div>
      ) : (
      <Tabs defaultValue={defaultTab} className="flex flex-col flex-1 min-h-0">
        {/* Phần trên gọn 1 hàng (tiêu đề + tab) — bảng chiếm toàn bộ phần còn lại */}
        <div className="border-b bg-white px-3 py-2 shrink-0 flex items-center gap-2 flex-wrap sm:rounded-t-xl">
          <span className="text-sm font-semibold text-slate-700 shrink-0 flex items-center gap-1.5">
            <Settings2 className="h-4 w-4 text-slate-500" /> Cài đặt WMS
          </span>
          <TabsList className="h-8 max-w-full overflow-x-auto">
            {canManageWarehouse && <TabsTrigger value="warehouses" className="gap-1.5 text-xs"><Warehouse className="h-3.5 w-3.5" /> Kho</TabsTrigger>}
            {canManageType      && <TabsTrigger value="types"      className="gap-1.5 text-xs"><Tag      className="h-3.5 w-3.5" /> Loại kho</TabsTrigger>}
            {canManageUnit      && <TabsTrigger value="units"      className="gap-1.5 text-xs"><Ruler    className="h-3.5 w-3.5" /> Đơn vị tính</TabsTrigger>}
            {canManageZone      && <TabsTrigger value="zones"      className="gap-1.5 text-xs"><MapPin     className="h-3.5 w-3.5" /> Khu vực</TabsTrigger>}
            {canManageShift     && <TabsTrigger value="shifts"     className="gap-1.5 text-xs"><Clock      className="h-3.5 w-3.5" /> Ca nhập</TabsTrigger>}
            {canManageQA        && <TabsTrigger value="qa"         className="gap-1.5 text-xs"><ShieldCheck className="h-3.5 w-3.5" /> QA</TabsTrigger>}
            {canManageMachine   && <TabsTrigger value="machines"   className="gap-1.5 text-xs"><Cog className="h-3.5 w-3.5" /> Máy</TabsTrigger>}
            {canManageSystem    && <TabsTrigger value="system"     className="gap-1.5 text-xs"><SlidersHorizontal className="h-3.5 w-3.5" /> Hệ thống</TabsTrigger>}
          </TabsList>
        </div>

        {/* ── Tab: Kho ── */}
        <TabsContent value="warehouses" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <div className="border-b px-3 py-1.5 shrink-0 flex items-center gap-2 flex-wrap">
            <SearchInput value={whSearch} onChange={setWhSearch} placeholder="Tìm mã, tên, địa chỉ kho…" className="flex-1 min-w-[160px]" />
            <FilterBar defs={whFilterDefs} />
            {canManageWarehouse && (
              <ActionCluster className="shrink-0" items={[{
                key: 'add', icon: Plus, label: 'Thêm kho', tip: 'Thêm kho mới',
                primary: true, variant: 'default',
                onClick: () => { setEditingWh(null); setShowWhDlg(true) },
              } satisfies ActionItem]} />
            )}
          </div>
          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 overflow-auto pb-20 lg:pb-4">
              {loadingWh ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> :
                filteredWh.length === 0 ? (
                  <div className="p-12 text-center text-slate-400 text-sm">Không có kho khớp bộ lọc</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Mã</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">NMSX</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Ship-to phụ</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tên kho</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Chức năng</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Quản tồn</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Địa chỉ</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Trạng thái</TableHead>
                        {canManageWarehouse && <TableHead className="px-2 py-1.5 w-16" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredWh.map(wh => (
                        <TableRow key={wh.id}
                          className={`cursor-pointer ${!wh.is_active ? 'opacity-50' : ''} ${detailWh?.id === wh.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                          onClick={() => setDetailWh(prev => prev?.id === wh.id ? null : wh)}>
                          <TableCell className="px-2 py-1 font-mono font-semibold text-[10px] text-slate-600 whitespace-nowrap">{wh.code}</TableCell>
                          <TableCell className="px-2 py-1 font-mono font-semibold text-[10px] text-slate-600 whitespace-nowrap">{wh.nmsx_code || <span className="text-slate-300 font-sans font-normal">—</span>}</TableCell>
                          <TableCell className="px-2 py-1 font-mono text-[10px] text-slate-500 whitespace-nowrap">{wh.shipto_codes?.length ? wh.shipto_codes.join(', ') : <span className="text-slate-300">—</span>}</TableCell>
                          <TableCell className="px-2 py-1 text-[10px] font-medium text-slate-800 whitespace-nowrap">
                            {wh.name}
                            {wh.parent_warehouse_id && (
                              <Badge variant="outline" className="ml-1.5 text-[9px] border-violet-400 text-violet-700 bg-violet-50">
                                Nội bộ · {(allWh as WhRow[]).find(p => p.id === wh.parent_warehouse_id)?.code ?? '?'}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="px-2 py-1 whitespace-nowrap">
                            <Badge variant="outline" className={`text-[10px] ${wh.warehouse_type === 'NPP' ? 'border-amber-400 text-amber-700 bg-amber-50' : 'border-blue-400 text-blue-700 bg-blue-50'}`}>
                              {wh.warehouse_type === 'NPP' ? 'Kho NPP' : 'Kho tổng'}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-2 py-1 whitespace-nowrap">
                            <Badge variant="outline" className={`text-[10px] ${invModeMeta(wh.inventory_mode).badge}`}>
                              {invModeMeta(wh.inventory_mode).label}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{wh.address ?? '—'}</TableCell>
                          <TableCell className="px-2 py-1 whitespace-nowrap">
                            <Badge variant={wh.is_active ? 'default' : 'secondary'} className="text-xs">
                              {wh.is_active ? 'Hoạt động' : 'Tạm dừng'}
                            </Badge>
                          </TableCell>
                          {canManageWarehouse && (
                            <TableCell className="px-2 py-1 whitespace-nowrap">
                              <div className="flex items-center gap-0.5">
                                <button className="text-slate-400 hover:text-blue-500 p-1 transition-colors"
                                  onClick={e => { e.stopPropagation(); setEditingWh(wh); setShowWhDlg(true) }}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button className="text-slate-400 hover:text-red-500 p-1 transition-colors"
                                  disabled={deletingWh}
                                  onClick={e => { e.stopPropagation(); handleDeleteWh(wh) }}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
              )}
            </div>
            {detailWh && (
              <aside className="hidden lg:block w-60 shrink-0 border-l p-3 space-y-2 text-xs overflow-y-auto">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">{detailWh.code} — {detailWh.name}</span>
                  <button onClick={() => setDetailWh(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                </div>
                <div><span className="text-slate-400">Chức năng:</span> <span className="font-medium">{detailWh.warehouse_type === 'NPP' ? 'Kho NPP' : 'Kho tổng'}</span></div>
                <div><span className="text-slate-400">Quản tồn:</span> <span className="font-medium">{invModeMeta(detailWh.inventory_mode).label}</span></div>
                <div><span className="text-slate-400">Trực thuộc:</span> <span className="font-medium">{detailWh.parent_warehouse_id ? ((allWh as WhRow[]).find(p => p.id === detailWh.parent_warehouse_id)?.name ?? '?') : '— (kho thường)'}</span></div>
                <div><span className="text-slate-400">NMSX:</span> <span className="font-mono font-medium">{detailWh.nmsx_code || '—'}</span></div>
                <div><span className="text-slate-400">Ship-to phụ:</span> <span className="font-mono font-medium">{detailWh.shipto_codes?.length ? detailWh.shipto_codes.join(', ') : '—'}</span></div>
                <div><span className="text-slate-400">Địa chỉ:</span> <span className="font-medium">{detailWh.address ?? '—'}</span></div>
                <div><span className="text-slate-400">Trạng thái:</span> <span className="font-medium">{detailWh.is_active ? 'Hoạt động' : 'Tạm dừng'}</span></div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Tạo / Sửa</p>
                  <div><span className="text-slate-400">Người tạo:</span> <span className="font-medium">{detailWh.created_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ tạo:</span> <span className="font-medium">{detailWh.created_at ? formatDateTime(detailWh.created_at) : '—'}</span></div>
                  <div><span className="text-slate-400">Người sửa:</span> <span className="font-medium">{detailWh.updated_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ sửa:</span> <span className="font-medium">{detailWh.updated_at ? formatDateTime(detailWh.updated_at) : '—'}</span></div>
                </div>
              </aside>
            )}
          </div>
          <div className="border-t px-3 py-1 text-[10px] text-slate-500 shrink-0">1–{filteredWh.length} / {(allWh as WhRow[]).length} kho</div>
        </TabsContent>

        {/* ── Tab: Loại kho ── */}
        <TabsContent value="types" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <div className="border-b px-3 py-1.5 shrink-0 flex items-center gap-2 flex-wrap">
            <p className="text-xs text-slate-500 flex-1 min-w-[160px] truncate">
              {canManageType ? <>Kéo <GripVertical className="inline h-3 w-3 -mt-0.5" /> để đổi thứ tự (áp cho cây Đăng ký cổng)</> : 'Danh mục loại kho'}
            </p>
            {canManageType && (
              <ActionCluster className="shrink-0" items={[{
                key: 'add', icon: Plus, label: 'Thêm loại kho', tip: 'Thêm loại kho mới',
                primary: true, variant: 'default',
                onClick: () => { setEditingType(null); setShowTypeDlg(true) },
              } satisfies ActionItem]} />
            )}
          </div>

          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 overflow-auto pb-20 lg:pb-4">
              {loadingTypes ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> :
                warehouseTypes.length === 0 ? (
                  <div className="p-12 text-center text-slate-400 space-y-2">
                    <Tag className="h-10 w-10 mx-auto opacity-30" />
                    <p className="text-sm">Chưa có loại kho nào</p>
                    {canManageType && <p className="text-xs">Nhấn "Thêm loại kho" để tạo loại kho đầu tiên</p>}
                  </div>
                ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {canManageType && <TableHead className="px-2 py-1.5 w-8" />}
                          <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tên loại kho</TableHead>
                          {canManageType && <TableHead className="px-2 py-1.5 w-16" />}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orderedTypes.map((t, idx) => {
                          const isOver = overType?.idx === idx && dragIdx !== null && dragIdx !== idx
                          return (
                          <TableRow key={t.id}
                            draggable={canManageType}
                            onDragStart={() => setDragIdx(idx)}
                            onDragOver={canManageType ? (e => {
                              e.preventDefault()
                              const r = e.currentTarget.getBoundingClientRect()
                              const below = (e.clientY - r.top) > r.height / 2
                              if (overType?.idx !== idx || overType?.below !== below) setOverType({ idx, below })
                            }) : undefined}
                            onDrop={canManageType ? (e => { e.preventDefault(); dropType() }) : undefined}
                            onDragEnd={() => { setDragIdx(null); setOverType(null) }}
                            className={`cursor-pointer ${detailType?.id === t.id ? 'bg-slate-100' : 'hover:bg-slate-50'} ${dragIdx === idx ? 'opacity-40' : ''} ${isOver && !overType?.below ? '[&>td]:border-t-2 [&>td]:border-t-sky-500' : ''} ${isOver && overType?.below ? '[&>td]:border-b-2 [&>td]:border-b-sky-500' : ''}`}
                            onClick={() => setDetailType(prev => prev?.id === t.id ? null : t)}>
                            {canManageType && (
                              <TableCell className="px-2 py-1 w-8 text-slate-300 cursor-grab active:cursor-grabbing" onClick={e => e.stopPropagation()} title="Kéo để đổi thứ tự">
                                <GripVertical className="h-4 w-4" />
                              </TableCell>
                            )}
                            <TableCell className="px-2 py-1 whitespace-nowrap">
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${whTypeBadgeCls(t.value, new Map([[t.value, t.meta ?? {}]]))}`}>{t.value}</span>
                              <span className="ml-1.5 text-[9px] text-slate-400">
                                {[t.meta?.is_ncc_goods && 'NCC', t.meta?.requires_shelf_life && 'HSD', t.meta?.requires_pallet_per_ea && 'Pallet/EA',
                                  t.meta?.requires_ncc && 'NCC bắt buộc', t.meta?.batch_char && `Mã lô: ${t.meta.batch_char}`].filter(Boolean).join(' · ')}
                              </span>
                            </TableCell>
                            {canManageType && (
                              <TableCell className="px-2 py-1 whitespace-nowrap">
                                <div className="flex items-center gap-0.5">
                                  <button className="text-slate-400 hover:text-blue-500 p-1 transition-colors"
                                    onClick={e => { e.stopPropagation(); setEditingType({ id: t.id, value: t.value, meta: t.meta }); setShowTypeDlg(true) }}>
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button className="text-slate-400 hover:text-red-500 p-1 transition-colors"
                                    disabled={deletingType}
                                    onClick={e => { e.stopPropagation(); if (confirm(`Xóa loại kho "${t.value}"?`)) deleteType(t.id, { onSuccess: () => setDetailType(prev => prev?.id === t.id ? null : prev), onError: e2 => toast({ variant: 'destructive', title: 'Không xóa được loại kho', description: apiMsg(e2) }) }) }}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                )
              }
            </div>
            {detailType && (
              <aside className="hidden lg:block w-60 shrink-0 border-l p-3 space-y-2 text-xs overflow-y-auto">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">{detailType.value}</span>
                  <button onClick={() => setDetailType(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                </div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Hành vi</p>
                  <div><span className="text-slate-400">Hàng NCC:</span> <span className="font-medium">{detailType.meta?.is_ncc_goods ? 'Có (QR đoạn 4 = mã NCC)' : 'Không (đoạn 4 = Máy)'}</span></div>
                  <div><span className="text-slate-400">Bắt buộc HSD:</span> <span className="font-medium">{detailType.meta?.requires_shelf_life ? 'Có' : 'Không'}</span></div>
                  <div><span className="text-slate-400">Bắt buộc Pallet/EA:</span> <span className="font-medium">{detailType.meta?.requires_pallet_per_ea ? 'Có' : 'Không'}</span></div>
                  <div><span className="text-slate-400">Bắt buộc NCC khi nhập:</span> <span className="font-medium">{detailType.meta?.requires_ncc ? 'Có (chặn lưu thiếu NCC)' : 'Không'}</span></div>
                  <div><span className="text-slate-400">Ký tự mã lô:</span> <span className="font-medium">{detailType.meta?.batch_char || '— (chọn Máy tay)'}</span></div>
                </div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Tạo / Sửa</p>
                  <div><span className="text-slate-400">Người tạo:</span> <span className="font-medium">{detailType.created_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ tạo:</span> <span className="font-medium">{detailType.created_at ? formatDateTime(detailType.created_at) : '—'}</span></div>
                  <div><span className="text-slate-400">Người sửa:</span> <span className="font-medium">{detailType.updated_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ sửa:</span> <span className="font-medium">{detailType.updated_at ? formatDateTime(detailType.updated_at) : '—'}</span></div>
                </div>
              </aside>
            )}
          </div>
          <div className="border-t px-3 py-1 text-[10px] text-slate-500 shrink-0">1–{orderedTypes.length} / {orderedTypes.length} loại kho</div>
        </TabsContent>

        {/* ── Tab: Đơn vị tính ── */}
        <TabsContent value="units" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <UnitTab canManage={canManageUnit} />
        </TabsContent>

        {/* ── Tab: Khu vực kho ── */}
        <TabsContent value="zones" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <div className="border-b px-3 py-1.5 shrink-0 flex items-center gap-2 flex-wrap">
            <SingleSelect
              options={zoneAccessWh.map(w => ({ value: w.id, label: w.name, sub: w.code }))}
              value={effectiveWhId}
              onChange={setSelectedWhId}
              placeholder="Chọn kho"
              searchPlaceholder="Tìm kho…"
              triggerClassName="h-8 w-44 text-xs shrink-0"
            />
            {effectiveWhId && (
              <>
                <SearchInput value={zoneSearch} onChange={setZoneSearch} placeholder="Tìm mã, tên khu vực…" className="flex-1 min-w-[140px]" />
                <FilterBar defs={zoneFilterDefs} />
              </>
            )}
            {canManageZone && (
              <ActionCluster className="ml-auto shrink-0" items={[{
                key: 'add', icon: Plus, label: 'Thêm khu vực', tip: 'Thêm khu vực kho mới',
                primary: true, variant: 'default',
                onClick: () => { setEditingZone(null); setShowZoneDlg(true) },
              } satisfies ActionItem]} />
            )}
          </div>

          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 overflow-auto pb-20 lg:pb-4">
              {!effectiveWhId ? (
                <div className="p-8 text-center text-sm text-slate-400">Chọn kho để xem khu vực</div>
              ) : loadingZones ? (
                <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div>
              ) : zones.length === 0 ? (
                <div className="p-12 text-center text-slate-400 space-y-2">
                  <MapPin className="h-10 w-10 mx-auto opacity-30" />
                  <p className="text-sm">Kho này chưa có khu vực nào</p>
                  {canManageZone && <p className="text-xs">Nhấn "Thêm khu vực" để tạo khu vực đầu tiên</p>}
                </div>
              ) : filteredZones.length === 0 ? (
                <div className="p-12 text-center text-slate-400 text-sm">Không có khu vực khớp bộ lọc</div>
              ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Mã khu vực</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tên khu vực</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Loại kho</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap text-right">Pallet tối đa</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Trạng thái</TableHead>
                        {canManageZone && <TableHead className="px-2 py-1.5 w-16" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredZones.map(z => (
                        <TableRow key={z.id}
                          className={`cursor-pointer ${!z.is_active ? 'opacity-50' : ''} ${detailZone?.id === z.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                          onClick={() => setDetailZone(prev => prev?.id === z.id ? null : z)}>
                          <TableCell className="px-2 py-1 font-mono font-semibold text-[10px] text-slate-600 whitespace-nowrap">{z.code}</TableCell>
                          <TableCell className="px-2 py-1 text-[10px] font-medium text-slate-800 whitespace-nowrap">{z.name}</TableCell>
                          <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{z.categories?.length ? z.categories.join(', ') : <span className="text-slate-300">—</span>}</TableCell>
                          <TableCell className="px-2 py-1 text-[10px] text-right font-semibold tabular-nums whitespace-nowrap">{z.max_pallets != null ? z.max_pallets.toLocaleString('vi-VN') : <span className="text-slate-300 font-normal">—</span>}</TableCell>
                          <TableCell className="px-2 py-1 whitespace-nowrap">
                            <Badge variant={z.is_active ? 'default' : 'secondary'} className="text-xs">
                              {z.is_active ? 'Hoạt động' : 'Tạm dừng'}
                            </Badge>
                          </TableCell>
                          {canManageZone && (
                            <TableCell className="px-2 py-1 whitespace-nowrap">
                              <div className="flex items-center gap-0.5">
                                <button className="text-slate-400 hover:text-blue-500 p-1 transition-colors"
                                  onClick={e => { e.stopPropagation(); setEditingZone(z); setShowZoneDlg(true) }}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button className="text-slate-400 hover:text-red-500 p-1 transition-colors"
                                  disabled={deletingZone}
                                  onClick={e => { e.stopPropagation(); handleDeleteZone(z) }}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
              )}
            </div>
            {detailZone && (
              <aside className="hidden lg:block w-60 shrink-0 border-l p-3 space-y-2 text-xs overflow-y-auto">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">{detailZone.code} — {detailZone.name}</span>
                  <button onClick={() => setDetailZone(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                </div>
                <div><span className="text-slate-400">Loại kho:</span> <span className="font-medium">{detailZone.categories?.length ? detailZone.categories.join(', ') : '—'}</span></div>
                <div><span className="text-slate-400">Pallet tối đa:</span> <span className="font-medium tabular-nums">{detailZone.max_pallets != null ? detailZone.max_pallets.toLocaleString('vi-VN') : 'Chưa khai'}</span></div>
                <div><span className="text-slate-400">Trạng thái:</span> <span className="font-medium">{detailZone.is_active ? 'Hoạt động' : 'Tạm dừng'}</span></div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Tạo / Sửa</p>
                  <div><span className="text-slate-400">Người tạo:</span> <span className="font-medium">{detailZone.created_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ tạo:</span> <span className="font-medium">{detailZone.created_at ? formatDateTime(detailZone.created_at) : '—'}</span></div>
                  <div><span className="text-slate-400">Người sửa:</span> <span className="font-medium">{detailZone.updated_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ sửa:</span> <span className="font-medium">{detailZone.updated_at ? formatDateTime(detailZone.updated_at) : '—'}</span></div>
                </div>
              </aside>
            )}
          </div>
          <div className="border-t px-3 py-1 text-[10px] text-slate-500 shrink-0">1–{filteredZones.length} / {(zones as WarehouseZone[]).length} khu vực</div>
        </TabsContent>

        {/* ── Tab: Ca nhập ── */}
        <TabsContent value="shifts" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <MetaTab noun="ca nhập" rows={shifts} loading={loadingShifts} canManage={canManageShift}
            onAdd={() => { setEditShift(null); setShowShiftDlg(true) }}
            onEdit={r => { setEditShift(r); setShowShiftDlg(true) }} />
        </TabsContent>

        {/* ── Tab: Tình trạng QA ── */}
        <TabsContent value="qa" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <MetaTab noun="trạng thái QA" rows={qaStatuses} loading={loadingQA} canManage={canManageQA}
            onAdd={() => { setEditQA(null); setShowQADlg(true) }}
            onEdit={r => { setEditQA(r); setShowQADlg(true) }} />
        </TabsContent>

        {/* ── Tab: Máy theo Kho (user 13/08 — Sổ đóng gói + Sinh tem validate máy ở đây) ── */}
        <TabsContent value="machines" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <MachineTab canManage={canManageMachine} warehouses={allWh as { id: string; name: string }[]} />
        </TabsContent>

        {/* ── Tab: Hệ thống (cờ SystemSetting) ── */}
        <TabsContent value="system" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <SystemTab canManage={canManageSystem} />
        </TabsContent>
      </Tabs>
      )}

      {showWhDlg && (
        <WarehouseDialog wh={editingWh} open={showWhDlg} onClose={() => setShowWhDlg(false)} />
      )}
      {showTypeDlg && (
        <TypeDialog type={editingType} open={showTypeDlg} onClose={() => setShowTypeDlg(false)} />
      )}
      {showZoneDlg && (
        <ZoneDialog zone={editingZone} warehouseId={effectiveWhId} warehouses={zoneAccessWh} warehouseTypes={scopedWhTypes} open={showZoneDlg} onClose={() => setShowZoneDlg(false)} />
      )}
      {showShiftDlg && (
        <MetaDialog kind="shift" row={editShift} open={showShiftDlg} onClose={() => setShowShiftDlg(false)} />
      )}
      {showQADlg && (
        <MetaDialog kind="qa" row={editQA} open={showQADlg} onClose={() => setShowQADlg(false)} />
      )}
     </div>
    </div>
  )
}

// ─── Tab Máy theo Kho (user 13/08; đồng bộ khuôn tab KHU VỰC theo yêu cầu cùng ngày) ──
// Máy THUỘC Kho — mỗi kho danh mục riêng. Kho có máy → Sổ đóng gói (mở/sửa trang) + Sinh tem
// (theo NMSX) PHẢI chọn trong danh mục (BE 422 MACHINE_INVALID); kho chưa khai → điền tự do.
function MachineTab({ canManage, warehouses }: { canManage: boolean; warehouses: { id: string; name: string; code?: string }[] }) {
  const [whId, setWhId] = useState('')
  const [search, setSearch] = useState('')
  const { data: machines = [], isLoading } = useMachines(whId || undefined)
  const { mutate: deleteM, isPending: deleting } = useDeleteMachine()
  const [showDlg, setShowDlg] = useState(false)
  const [editing, setEditing] = useState<WarehouseMachine | null>(null)
  const whName = new Map(warehouses.map(w => [w.id, w.name]))
  const term = search.trim().toLowerCase()
  const filtered = term
    ? machines.filter(m => m.code.toLowerCase().includes(term) || (m.note ?? '').toLowerCase().includes(term))
    : machines

  function handleDelete(m: WarehouseMachine) {
    if (!confirm(`Xóa máy "${m.code}" (${whName.get(m.warehouse_id) ?? ''})?`)) return
    deleteM(m.id, { onError: e => toast({ variant: 'destructive', title: 'Không xóa được máy', description: apiMsg(e) }) })
  }

  return (
    <>
      <div className="border-b px-3 py-1.5 shrink-0 flex items-center gap-2 flex-wrap">
        <SingleSelect
          options={warehouses.map(w => ({ value: w.id, label: w.name, sub: w.code }))}
          value={whId} onChange={setWhId}
          placeholder="Tất cả kho" searchPlaceholder="Tìm kho…"
          triggerClassName="h-8 w-44 text-xs shrink-0"
        />
        <SearchInput value={search} onChange={setSearch} placeholder="Tìm tên máy, ghi chú…" className="flex-1 min-w-[140px]" />
        {canManage && (
          <ActionCluster className="ml-auto shrink-0" items={[{
            key: 'add', icon: Plus, label: 'Thêm máy', tip: 'Thêm máy vào danh mục của 1 kho',
            primary: true, variant: 'default',
            onClick: () => { setEditing(null); setShowDlg(true) },
          } satisfies ActionItem]} />
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div>
        ) : machines.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <Cog className="h-10 w-10 mx-auto opacity-30" />
            <p className="text-sm">{whId ? 'Kho này chưa khai máy — Sổ đóng gói / Sinh tem đang cho điền máy tự do' : 'Chưa có máy nào'}</p>
            {canManage && <p className="text-xs">Nhấn "Thêm máy" để khai máy đầu tiên — kho có danh mục máy thì các form PHẢI chọn trong danh mục</p>}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">Không có máy khớp tìm kiếm</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Kho</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tên máy</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Ghi chú</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Trạng thái</TableHead>
                {canManage && <TableHead className="px-2 py-1.5 w-16" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(m => (
                <TableRow key={m.id} className={!m.is_active ? 'opacity-50' : 'hover:bg-slate-50'}>
                  <TableCell className="px-2 py-1 text-[10px] text-slate-600 whitespace-nowrap">{whName.get(m.warehouse_id) ?? m.warehouse_id}</TableCell>
                  <TableCell className="px-2 py-1 font-mono font-semibold text-[10px] text-slate-800 whitespace-nowrap">{m.code}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{m.note || <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap">
                    <Badge variant={m.is_active ? 'default' : 'secondary'} className="text-xs">
                      {m.is_active ? 'Hoạt động' : 'Tạm dừng'}
                    </Badge>
                  </TableCell>
                  {canManage && (
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <div className="flex justify-end gap-0.5">
                        <button className="text-slate-400 hover:text-blue-500 p-1 transition-colors" title="Sửa"
                          onClick={e => { e.stopPropagation(); setEditing(m); setShowDlg(true) }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button className="text-slate-400 hover:text-red-500 p-1 transition-colors" title="Xóa" disabled={deleting}
                          onClick={e => { e.stopPropagation(); handleDelete(m) }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <div className="border-t px-3 py-1 text-[10px] text-slate-500 shrink-0">
        1–{filtered.length} / {machines.length} máy{whId ? ` · ${whName.get(whId) ?? ''}` : ''} — kho có danh mục máy thì Sổ đóng gói + Sinh tem phải chọn trong danh mục; kho chưa khai thì điền tự do
      </div>
      {showDlg && (
        <MachineDialog machine={editing} warehouseId={whId} warehouses={warehouses} open={showDlg} onClose={() => setShowDlg(false)} />
      )}
    </>
  )
}

// Form Thêm/Sửa máy — FormSheet như ZoneDialog (user 13/08 "Thêm máy mở ra form, đồng bộ như Khu vực")
function MachineDialog({ machine, warehouseId, warehouses, open, onClose }: {
  machine: WarehouseMachine | null; warehouseId: string
  warehouses: { id: string; name: string; code?: string }[]; open: boolean; onClose: () => void
}) {
  const isEdit = !!machine
  const [selectedWhId, setSelectedWhId] = useState(machine?.warehouse_id ?? warehouseId)
  const [code, setCode] = useState(machine?.code ?? '')
  const [note, setNote] = useState(machine?.note ?? '')
  const [isActive, setIsActive] = useState(machine?.is_active ?? true)
  const [err, setErr] = useState('')
  const { mutate: create, isPending: creating } = useCreateMachine()
  const { mutate: update, isPending: updating } = useUpdateMachine()
  const isPending = creating || updating

  function handleSubmit() {
    setErr('')
    if (!isEdit && !selectedWhId) { setErr('Chọn kho là bắt buộc'); return }
    if (!code.trim()) { setErr('Tên máy là bắt buộc'); return }
    if (isEdit) {
      update({ id: machine.id, code: code.trim(), note: note.trim(), is_active: isActive },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
    } else {
      create({ warehouse_id: selectedWhId, code: code.trim(), note: note.trim() || undefined },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
    }
  }

  return (
    <FormSheet open={open} onClose={onClose} title={isEdit ? 'Sửa máy' : 'Thêm máy'} widthClass="sm:max-w-lg" footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
        <Button size="sm" onClick={handleSubmit} disabled={isPending || !code.trim() || (!isEdit && !selectedWhId)}>
          {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
        </Button>
      </>}>
      <div className="space-y-3">
        {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}

        {/* Kho — khóa khi sửa (máy thuộc kho, đổi kho = xóa rồi thêm ở kho kia) */}
        {isEdit ? (
          <div className="space-y-1">
            <Label className="text-xs">Kho</Label>
            <p className="text-sm font-medium text-slate-700">{warehouses.find(w => w.id === machine.warehouse_id)?.name ?? '—'}</p>
          </div>
        ) : (
          <div className="space-y-1">
            <Label className="text-xs">Kho <span className="text-red-500">*</span></Label>
            <Select value={selectedWhId || '__none__'} onValueChange={v => setSelectedWhId(v === '__none__' ? '' : v)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Chọn kho" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Chọn kho</SelectItem>
                {warehouses.map(w => (
                  <SelectItem key={w.id} value={w.id}>{w.name}{w.code ? ` (${w.code})` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs">Tên máy <span className="text-red-500">*</span></Label>
          <Input value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/\s+/g, ''))} placeholder="VD: A, M1" maxLength={10} />
          <p className="text-[10px] text-slate-400">In trên tem pallet (đoạn Máy) — tự viết HOA, tối đa 10 ký tự, không trùng trong cùng kho</p>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Ghi chú</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} placeholder="VD: dây chuyền 180ml…" />
        </div>

        {isEdit && (
          <div className="space-y-1">
            <Label className="text-xs">Trạng thái</Label>
            <Select value={isActive ? '1' : '0'} onValueChange={v => setIsActive(v === '1')}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Hoạt động</SelectItem>
                <SelectItem value="0">Tạm dừng (khỏi hiện trong danh sách chọn — trang sổ cũ giữ nguyên)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </FormSheet>
  )
}
