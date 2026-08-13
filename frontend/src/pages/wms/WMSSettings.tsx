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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/components/ui/use-toast'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { FormSheet } from '@/components/shared/FormSheet'
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

function apiMsg(err: unknown) {
  return (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? String(err)
}

// â”€â”€â”€ Tab Há»‡ thá»‘ng (SystemSetting â€” cá» hÃ nh vi per-DB, multi-tenant silo) â”€â”€â”€â”€â”€
// Cá» theo KHÃC BIá»†T giá»¯a cÃ¡c Ä‘Æ¡n vá»‹, khÃ´ng theo tÃªn Ä‘Æ¡n vá»‹. Sá»• cá»: backend systemSettingController.

const LABEL_FORMAT_OPTS = [
  { value: 'underscore', label: 'Tem gáº¡ch dÆ°á»›i ( _ )', sub: 'ddmmyy_MÃ£_ChuKá»³_MÃ¡y_STT_NMSX â€” vd 070526_510000127_C05_M1_001_B' },
  { value: 'semicolon',  label: 'Tem cháº¥m pháº©y ( ; )', sub: 'MÃ£ hÃ ng;QA;MÃ£ lÃ´;NSX;HSD;Máº»;Giá»:PhÃºt â€” vd 50033;1;TA260705A045;05/07/2026;05/03/2027;1;05:26' },
]

const DEC_SEP_OPTS = [
  { value: 'dot',   label: 'Dáº¥u cháº¥m ( . )',  sub: 'vd 1.5 kg Â· 0.00005' },
  { value: 'comma', label: 'Dáº¥u pháº©y ( , )',  sub: 'vd 1,5 kg Â· 0,00005 (chuáº©n VN, khá»›p file Excel)' },
]

// Cá» xÃ¡c nháº­n giao hÃ ng â€” quyáº¿t Ä‘á»‹nh xuáº¥t kho cÃ³ táº¡o booking TMS (Chuyá»ƒn kho) khÃ´ng + theo hÃ¬nh thá»©c kho nháº­n nÃ o.
const DC_ENABLED_OPTS = [
  { value: 'on',  label: 'CÃ³ xÃ¡c nháº­n giao hÃ ng',    sub: 'táº¡o booking Chuyá»ƒn kho' },
  { value: 'off', label: 'KhÃ´ng xÃ¡c nháº­n giao hÃ ng', sub: 'khÃ´ng táº¡o booking' },
]
const DC_MODE_OPTS = [
  { value: 'QR',    label: 'Kho QR (tá»“n kho QR)' },
  { value: 'QTY',   label: 'Kho QTY / QTY theo date (tá»“n sá»‘ lÆ°á»£ng)' },
  { value: 'NONE',  label: 'Kho NONE (tÃ i xáº¿ tá»± hoÃ n thÃ nh)' },
  { value: 'OTHER', label: 'KhÃ¡ch ngoÃ i (tÃ i xáº¿ tá»± hoÃ n thÃ nh)' },
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
  return { enabled: true, modes: ['QR', 'QTY'] }   // máº·c Ä‘á»‹nh = hÃ nh vi Ä‘Æ¡n vá»‹ 1
}

function SystemTab({ canManage }: { canManage: boolean }) {
  const { data: settings = [], isLoading } = useSystemSettings()
  const { mutateAsync: save, isPending } = useUpdateSystemSetting()
  const [err, setErr] = useState('')

  const labelRow = settings.find(s => s.key === 'label_format')
  const dcRow    = settings.find(s => s.key === 'delivery_confirmation')
  const decRow   = settings.find(s => s.key === 'decimal_separator')
  const srvLabel = typeof labelRow?.value === 'string' ? labelRow.value : 'underscore'
  const srvDc    = parseDc(dcRow?.value)
  const srvDec   = decRow?.value === 'comma' ? 'comma' : 'dot'

  // Draft (nhÃ¡p) â€” thay Ä‘á»•i Ä‘Æ°á»£c STAGE táº¡i chá»—, chá»‰ báº¥m "LÆ°u thay Ä‘á»•i" má»›i Ã¡p dá»¥ng.
  const [draftLabel, setDraftLabel] = useState(srvLabel)
  const [draftDc,    setDraftDc]    = useState<DeliveryConf>(srvDc)
  const [draftDec,   setDraftDec]   = useState(srvDec)
  const srvKey = JSON.stringify([srvLabel, srvDc, srvDec])
  const [baseKey, setBaseKey] = useState(srvKey)
  useEffect(() => {
    if (srvKey !== baseKey) { setDraftLabel(srvLabel); setDraftDc(srvDc); setDraftDec(srvDec); setBaseKey(srvKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srvKey])

  const labelDirty = draftLabel !== srvLabel
  const dcDirty    = JSON.stringify(draftDc) !== JSON.stringify(srvDc)
  const decDirty   = draftDec !== srvDec
  const dirty      = labelDirty || dcDirty || decDirty

  async function applyChanges() {
    setErr('')
    try {
      if (labelDirty) await save({ key: 'label_format', value: draftLabel })
      if (dcDirty)    await save({ key: 'delivery_confirmation', value: draftDc })
      if (decDirty)   await save({ key: 'decimal_separator', value: draftDec })
      toast({ title: 'ÄÃ£ lÆ°u cáº¥u hÃ¬nh há»‡ thá»‘ng' })
    } catch (e) { setErr(apiMsg(e)) }
  }
  const resetDraft = () => { setDraftLabel(srvLabel); setDraftDc(srvDc); setDraftDec(srvDec); setErr('') }
  const roClass = canManage ? '' : 'pointer-events-none opacity-60'   // non-manager: xem, khÃ´ng sá»­a

  if (isLoading) return <div className="p-8 text-center text-sm text-slate-400">Äang táº£iâ€¦</div>
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-auto p-4">
        {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{err}</p>}

        <div className="divide-y divide-slate-100 border-y border-slate-100">
          {/* 1. Äá»‹nh dáº¡ng tem pallet */}
          <div className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">1. Äá»‹nh dáº¡ng tem pallet</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Chá»‰ Ã¡p cho chiá»u IN tem tá»« app. Chiá»u quÃ©t nháº­n theo Ä‘á»‹nh dáº¡ng cá»§a Ä‘Æ¡n vá»‹.</p>
              {labelRow?.updated_by && <p className="text-[10px] text-slate-400 mt-0.5">Cáº­p nháº­t: {labelRow.updated_by} Â· {formatDateTime(labelRow.updated_at)}</p>}
            </div>
            <div className={`shrink-0 ${roClass}`}>
              <SingleSelect options={LABEL_FORMAT_OPTS} value={draftLabel}
                onChange={setDraftLabel} searchable={false} triggerClassName="w-56" />
            </div>
          </div>

          {/* 2. XÃ¡c nháº­n giao hÃ ng */}
          <div className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">2. XÃ¡c nháº­n giao hÃ ng</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Khi xuáº¥t kho: "KhÃ´ng" â†’ khÃ´ng táº¡o booking Chuyá»ƒn kho. "CÃ³" â†’ táº¡o booking theo hÃ¬nh thá»©c kho nháº­n chá»n bÃªn.</p>
              {dcRow?.updated_by && <p className="text-[10px] text-slate-400 mt-0.5">Cáº­p nháº­t: {dcRow.updated_by} Â· {formatDateTime(dcRow.updated_at)}</p>}
            </div>
            <div className={`shrink-0 flex flex-col items-end gap-1.5 ${roClass}`}>
              <SingleSelect options={DC_ENABLED_OPTS} value={draftDc.enabled ? 'on' : 'off'}
                onChange={v => setDraftDc(d => ({ ...d, enabled: v === 'on' }))} searchable={false} triggerClassName="w-56" />
              {draftDc.enabled && (
                <>
                  <MultiSelectFilter label="HÃ¬nh thá»©c kho nháº­n" options={DC_MODE_OPTS}
                    selected={draftDc.modes} onChange={m => setDraftDc(() => ({ enabled: true, modes: m }))}
                    searchable={false} width="w-56" />
                  <p className="text-[10px] text-right max-w-[14rem] break-words">
                    {draftDc.modes.length
                      ? <span className="text-slate-500">ÄÃ£ chá»n: {draftDc.modes.join(', ')}</span>
                      : <span className="text-amber-600">ChÆ°a chá»n â†’ khÃ´ng táº¡o booking</span>}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* 3. Dáº¥u tháº­p phÃ¢n â€” Ã´ nháº­p sá»‘ (KG/decimal) á»Ÿ cÃ¡c form; app cháº·n dáº¥u cÃ²n láº¡i */}
          <div className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">3. Dáº¥u tháº­p phÃ¢n</p>
              <p className="text-[11px] text-slate-500 mt-0.5">DÃ¹ng cho Ã´ nháº­p sá»‘ láº» (KG, Pallet/EA, kÃ­ch thÆ°á»›câ€¦) á»Ÿ form MÃ£ hÃ ng. Chá»n dáº¥u nÃ o thÃ¬ app CHáº¶N dáº¥u cÃ²n láº¡i khi nháº­p.</p>
              {decRow?.updated_by && <p className="text-[10px] text-slate-400 mt-0.5">Cáº­p nháº­t: {decRow.updated_by} Â· {formatDateTime(decRow.updated_at)}</p>}
            </div>
            <div className={`shrink-0 ${roClass}`}>
              <SingleSelect options={DEC_SEP_OPTS} value={draftDec}
                onChange={setDraftDec} searchable={false} triggerClassName="w-56" />
            </div>
          </div>
        </div>
      </div>

      {/* Thanh LÆ°u dÃ­nh Ä‘Ã¡y â€” stage rá»“i má»›i Ã¡p dá»¥ng */}
      {canManage && (
        <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-2.5 flex items-center gap-3">
          <span className={`text-[11px] ${dirty ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>
            {dirty ? 'â— CÃ³ thay Ä‘á»•i chÆ°a lÆ°u' : 'ÄÃ£ lÆ°u'}
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" disabled={!dirty || isPending} onClick={resetDraft}>HoÃ n tÃ¡c</Button>
            <Button size="sm" disabled={!dirty || isPending} onClick={applyChanges}>
              {isPending ? 'Äang lÆ°uâ€¦' : 'LÆ°u thay Ä‘á»•i'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// â”€â”€â”€ Warehouse Dialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface WhRow { id: string; code: string; name: string; address: string | null; is_active: boolean; warehouse_type: string; inventory_mode: string; shipto_codes?: string[] | null; nmsx_code?: string | null; parent_warehouse_id?: string | null; carton_scan_override?: boolean | null; carton_scan_categories?: string[] | null; carton_scan_require_full?: boolean | null; sap_plant?: string | null; sap_storage_locations?: string[] | null; require_weigh_on_start?: boolean | null; require_gate_on_start?: boolean | null; created_at?: string; updated_at?: string; created_by?: string | null; updated_by?: string | null }

// Báº¯t buá»™c quÃ©t Ä‘á»§ tem thÃ¹ng â€” chá»‰ cÃ³ nghÄ©a khi báº­t "QuÃ©t tá»›i THÃ™NG khi xuáº¥t" (user chá»‘t 15/07)
const CARTON_REQUIRE_OPTS = [
  { value: 'optional', label: 'KhÃ´ng báº¯t buá»™c quÃ©t Ä‘á»§', sub: 'quÃ©t Ä‘Æ°á»£c bao nhiÃªu lÆ°u báº¥y nhiÃªu â€” truy váº¿t má»m' },
  { value: 'required', label: 'Báº¯t buá»™c quÃ©t Ä‘á»§ thÃ¹ng',  sub: 'pallet thiáº¿u tem thÃ¹ng â†’ CHáº¶N HoÃ n thÃ nh chuyáº¿n' },
]

// Cháº¿ Ä‘á»™ quáº£n tá»“n â€” Ä‘á»™c láº­p vá»›i warehouse_type (CENTRAL/NPP). Xem migration 20260626_warehouse_inventory_mode.sql
type InvMode = 'QR' | 'QTY' | 'QTY_DATE' | 'NONE'
const INV_MODE_META: Record<InvMode, { label: string; desc: string; badge: string }> = {
  QR:       { label: 'Tá»“n kho QR',     desc: 'Theo dÃµi tá»“n Ä‘áº§y Ä‘á»§ qua QR (pallet/vá»‹ trÃ­/quÃ©t)', badge: 'border-green-400 text-green-700 bg-green-50' },
  QTY:      { label: 'Tá»“n kho sá»‘ lÆ°á»£ng', desc: 'Theo dÃµi tá»“n dáº¡ng sá»‘ lÆ°á»£ng, khÃ´ng pallet/QR',     badge: 'border-sky-400 text-sky-700 bg-sky-50' },
  QTY_DATE: { label: 'Tá»“n sá»‘ lÆ°á»£ng theo date', desc: 'Tá»“n sá»‘ lÆ°á»£ng tÃ¡ch theo NSX â€” nháº­p tay pháº£i cÃ³ NSX, xuáº¥t trá»« FEFO (date cÅ© trÆ°á»›c, chá»n Ä‘Æ°á»£c khi cáº§n)', badge: 'border-indigo-400 text-indigo-700 bg-indigo-50' },
  NONE:     { label: 'KhÃ´ng quáº£n tá»“n',  desc: 'KhÃ´ng theo dÃµi tá»“n (Ä‘iá»ƒm trung chuyá»ƒn/giao nháº­n)', badge: 'border-slate-300 text-slate-500 bg-slate-50' },
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
  // 2 RULE khi Báº¯t Ä‘áº§u chuyáº¿n xuáº¥t (user chá»‘t 01/08): rule 1 Ä‘Äƒng kÃ½ cá»•ng Â· rule 2 cÃ¢n â€” Ä‘á»™c láº­p,
  // báº­t rule nÃ o cháº¥p hÃ nh rule Ä‘Ã³, báº­t cáº£ 2 pháº£i Ä‘á»§ cáº£ 2. Miá»…n trá»« = quyá»n outbound.weigh_waive.
  const [requireGate,   setRequireGate]   = useState(wh?.require_gate_on_start === true)
  const [requireWeigh,  setRequireWeigh]  = useState(wh?.require_weigh_on_start === true)
  const [parentId,      setParentId]      = useState(wh?.parent_warehouse_id ?? '__none__')
  const [isActive,      setIsActive]      = useState(wh?.is_active ?? true)
  // QuÃ©t tá»›i thÃ¹ng khi xuáº¥t â€” setup Táº I KHO: cÃ´ng táº¯c (máº·c Ä‘á»‹nh Táº®T) + CHá»ŒN cÃ¡c Loáº¡i kho pháº£i quÃ©t á»Ÿ kho nÃ y
  const [cartonScan,    setCartonScan]    = useState(wh?.carton_scan_override === true)
  const [cartonCats,    setCartonCats]    = useState<string[]>(wh?.carton_scan_categories ?? [])
  const [cartonRequire, setCartonRequire] = useState(wh?.carton_scan_require_full === true ? 'required' : 'optional')
  const { data: whTypesForCarton = [] } = useWarehouseTypes()   // taxonomy Ä‘áº§y Ä‘á»§ (trang quáº£n trá»‹)
  const [err, setErr] = useState('')

  // Danh sÃ¡ch kho lÃ m parent: kho thÆ°á»ng (khÃ´ng pháº£i kho phá»¥), trá»« chÃ­nh mÃ¬nh
  const { data: allWhForParent = [] } = useWarehouses(false)
  const parentOpts = [
    { value: '__none__', label: 'â€” Kho thÆ°á»ng (khÃ´ng trá»±c thuá»™c) â€”' },
    ...(allWhForParent as WhRow[])
      .filter(w => !w.parent_warehouse_id && w.id !== wh?.id)
      .map(w => ({ value: w.id, label: w.name, sub: w.code })),
  ]

  const { mutate: create, isPending: creating } = useCreateWarehouse()
  const { mutate: update, isPending: updating } = useUpdateWarehouse()
  const isPending = creating || updating

  function handleSubmit() {
    setErr('')
    if (!code.trim() || !name.trim()) { setErr('MÃ£ vÃ  tÃªn kho lÃ  báº¯t buá»™c'); return }
    const parent_warehouse_id = parentId === '__none__' ? null : parentId
    if (cartonScan && cartonCats.length === 0) { setErr('Báº­t quÃ©t tá»›i thÃ¹ng thÃ¬ chá»n Ã­t nháº¥t 1 Loáº¡i kho pháº£i quÃ©t'); return }
    const carton_scan_override = cartonScan
    const carton_scan_categories = cartonScan ? cartonCats : null
    const carton_scan_require_full = cartonScan && cartonRequire === 'required'
    if (isEdit) {
      update(
        { id: wh.id, name: name.trim(), address: address.trim() || undefined, is_active: isActive, warehouse_type: warehouseType, inventory_mode: invMode, shipto_codes: shiptoCodes, nmsx_code: nmsxCode, parent_warehouse_id, carton_scan_override, carton_scan_categories, carton_scan_require_full, sap_plant: sapPlant, sap_storage_locations: sapSlocs, require_weigh_on_start: requireWeigh, require_gate_on_start: requireGate },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) }
      )
    } else {
      create(
        { code: code.trim(), name: name.trim(), address: address.trim() || undefined, warehouse_type: warehouseType, inventory_mode: invMode, shipto_codes: shiptoCodes, nmsx_code: nmsxCode, parent_warehouse_id, carton_scan_override, carton_scan_categories, carton_scan_require_full, sap_plant: sapPlant, sap_storage_locations: sapSlocs, require_weigh_on_start: requireWeigh, require_gate_on_start: requireGate },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) }
      )
    }
  }

  return (
    <FormSheet open={open} onClose={onClose} title={isEdit ? 'Sá»­a kho' : 'ThÃªm kho'} widthClass="sm:max-w-lg" footer={<>
          <Button variant="outline" size="sm" onClick={onClose}>Huá»·</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !code.trim() || !name.trim()}>
            {isPending ? 'Äang lÆ°uâ€¦' : isEdit ? 'LÆ°u' : 'Táº¡o'}
          </Button>
        </>}>
        <div className="space-y-3">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          <div className="space-y-1">
            <Label className="text-xs">MÃ£ kho *</Label>
            <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="BV, BB, HNâ€¦" disabled={isEdit} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">TÃªn kho *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Kho Ba VÃ¬, Kho BÃ u BÃ ngâ€¦" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Äá»‹a chá»‰</Label>
            <Input value={address} onChange={e => setAddress(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Chá»©c nÄƒng kho *</Label>
            <Select value={warehouseType} onValueChange={v => setWarehouseType(v as 'CENTRAL' | 'NPP')}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CENTRAL">Kho tá»•ng</SelectItem>
                <SelectItem value="NPP">Kho NPP</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cháº¿ Ä‘á»™ quáº£n tá»“n *</Label>
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
            <Label className="text-xs">Trá»±c thuá»™c kho (kho phá»¥ ná»™i bá»™)</Label>
            <SingleSelect options={parentOpts} value={parentId} onChange={setParentId}
              placeholder="â€” Kho thÆ°á»ng (khÃ´ng trá»±c thuá»™c) â€”" searchPlaceholder="TÃ¬m khoâ€¦" triggerClassName="h-8 w-full text-sm" />
            <p className="text-[10px] text-slate-400">Kho phá»¥ (tá»• sáº£n xuáº¥t táº¡i site) chá»‰ giao dá»‹ch vá»›i kho parent: nháº­n chuyá»ƒn kho tá»« parent, xuáº¥t tráº£ parent, xuáº¥t tiÃªu hao. Chuyá»ƒn ná»™i bá»™ khÃ´ng cáº§n biá»ƒn sá»‘/booking ÄVVT.</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">MÃ£ ship-to phá»¥</Label>
            <Input value={shiptoCodes} onChange={e => setShiptoCodes(e.target.value.toUpperCase())} placeholder="vd: 20000018, 20000019" />
            <p className="text-[10px] text-slate-400">NgoÃ i mÃ£ kho chÃ­nh. Nhiá»u mÃ£ cÃ¡ch nhau dáº¥u pháº©y. Chuyá»ƒn kho vá» cÃ¡c mÃ£ nÃ y Ä‘á»u tá»± nháº­n vá» kho nÃ y.</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">MÃ£ NMSX (kho tá»•ng)</Label>
            <Input value={nmsxCode} onChange={e => setNmsxCode(e.target.value.toUpperCase())} placeholder="vd: B, Dâ€¦" maxLength={8} />
            <p className="text-[10px] text-slate-400">Äoáº¡n thá»© 6 cá»§a QR pallet + tiá»n tá»‘ mÃ£ vá»‹ trÃ­. Äá»ƒ trá»‘ng náº¿u kho khÃ´ng cÃ³ NMSX (vá»‹ trÃ­ sáº½ dÃ¹ng mÃ£ kho). KhÃ´ng trÃ¹ng giá»¯a cÃ¡c kho.</p>
          </div>
          {/* Map SAP â†’ kho: Ä‘á»ƒ CHáº¶N upload VL06O cá»§a kho khÃ¡c (user chá»‘t 26/07). File VL06O mang mÃ£ SAP
              Plant/Storage Location, khÃ´ng pháº£i mÃ£ kho app â†’ pháº£i khai á»Ÿ Ä‘Ã¢y má»›i siáº¿t Ä‘Æ°á»£c theo kho. */}
          <div className="space-y-1 rounded-md border border-slate-200 px-2.5 py-2">
            <Label className="text-xs">MÃ£ SAP cá»§a kho (Ä‘á»ƒ cháº·n upload VL06O cá»§a kho khÃ¡c)</Label>
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
            <p className="text-[10px] text-slate-400">Láº¥y Ä‘Ãºng giÃ¡ trá»‹ 2 cá»™t <b>Plant</b> + <b>Storage Location</b> trong file VL06O. Nhiá»u Storage Location cÃ¡ch nhau dáº¥u pháº©y; Ä‘á»ƒ trá»‘ng = má»i Storage Location cá»§a Plant Ä‘Ã³ thuá»™c kho nÃ y. ChÆ°a khai â†’ dÃ²ng SAP Ä‘Ã³ KHÃ”NG bá»‹ cháº·n (app chá»‰ cáº£nh bÃ¡o sau khi upload).</p>
          </div>
          {/* 2 RULE khi Báº¯t Ä‘áº§u chuyáº¿n xuáº¥t (user chá»‘t 01/08) â€” Ä‘á»™c láº­p, báº­t rule nÃ o cháº¥p hÃ nh
              rule Ä‘Ã³, báº­t cáº£ 2 pháº£i Ä‘á»§ cáº£ 2. Miá»…n trá»« duy nháº¥t = duyá»‡t trÃªn chuyáº¿n (outbound.weigh_waive). */}
          <div className="space-y-1 rounded-md border border-slate-200 px-2.5 py-2">
            <Label className="text-xs">Rule khi Báº¯t Ä‘áº§u chuyáº¿n xuáº¥t</Label>
            <label htmlFor="wh-requiregate" className="flex items-start gap-2 cursor-pointer rounded-md px-1 py-1.5 hover:bg-slate-50">
              <input id="wh-requiregate" type="checkbox" checked={requireGate} onChange={e => setRequireGate(e.target.checked)} className="h-4 w-4 mt-0.5 rounded accent-blue-600 shrink-0" />
              <span className="text-xs">
                <span className="font-medium">Rule 1 â€” Xe pháº£i cÃ³ ÄÄ‚NG KÃ Cá»”NG</span>
                <span className="block text-[10px] text-slate-400 font-normal">Báº¯t Ä‘áº§u pháº£i chá»n chuyáº¿n xe tá»« ÄÄƒng kÃ½ cá»•ng (Ä‘Ãºng kho, chiá»u xuáº¥t, Ä‘Ã£ vÃ o cá»•ng, biá»ƒn khá»›p) â€” khÃ³a Ä‘Æ°á»ng nháº­p biá»ƒn tay. Xe khÃ´ng Ä‘Äƒng kÃ½ (giao láº», xe mÃ¡y, nhÃ¢n viÃªn nháº­nâ€¦) â†’ ngÆ°á»i cÃ³ quyá»n <b>Bá» qua cá»•ng/cÃ¢n</b> duyá»‡t trÃªn chuyáº¿n.</span>
              </span>
            </label>
            <label htmlFor="wh-requireweigh" className="flex items-start gap-2 cursor-pointer rounded-md px-1 py-1.5 hover:bg-slate-50">
              <input id="wh-requireweigh" type="checkbox" checked={requireWeigh} onChange={e => setRequireWeigh(e.target.checked)} className="h-4 w-4 mt-0.5 rounded accent-blue-600 shrink-0" />
              <span className="text-xs">
                <span className="font-medium">Rule 2 â€” Xe pháº£i CÃ‚N BÃŒ (kho cÃ³ tráº¡m cÃ¢n)</span>
                <span className="block text-[10px] text-slate-400 font-normal">Biá»ƒn sá»‘ xe pháº£i khá»›p 1 phiáº¿u cÃ¢n <b>chÆ°a hoÃ n thÃ nh</b> cá»§a hÃ´m nay má»›i báº¥m Ä‘Æ°á»£c Báº¯t Ä‘áº§u â€” phiáº¿u cÃ¢n tá»± gáº¯n vÃ o chuyáº¿n Ä‘á»ƒ Ä‘á»‘i chiáº¿u KL. Xe khÃ´ng cÃ¢n Ä‘Æ°á»£c (há»ng cÃ¢nâ€¦) â†’ duyá»‡t trÃªn chuyáº¿n nhÆ° rule 1.</span>
              </span>
            </label>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wh-cartonscan" className="flex items-start gap-2 cursor-pointer rounded-md border border-slate-200 px-2.5 py-2 hover:bg-slate-50">
              <input id="wh-cartonscan" type="checkbox" checked={cartonScan} onChange={e => setCartonScan(e.target.checked)} className="h-4 w-4 mt-0.5 rounded accent-blue-600 shrink-0" />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-slate-700">QuÃ©t tá»›i THÃ™NG khi xuáº¥t</span>
                <span className="block text-[11px] text-slate-400 leading-snug">Máº·c Ä‘á»‹nh Táº®T. Báº­t thÃ¬ chá»n cÃ¡c Loáº¡i kho pháº£i quÃ©t tem thÃ¹ng Táº I KHO NÃ€Y (Ä‘Ã­nh kÃ¨m truy váº¿t, khÃ´ng tÃ­nh tá»“n theo thÃ¹ng). Má»—i kho chá»n Ä‘á»™c láº­p.</span>
              </span>
            </label>
            {cartonScan && (
              <div className="pl-6 space-y-1">
                <Label className="text-xs">Loáº¡i kho pháº£i quÃ©t thÃ¹ng á»Ÿ kho nÃ y *</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {whTypesForCarton.map(t => (
                    <label key={t.id} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-[12px] cursor-pointer ${cartonCats.includes(t.value) ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}>
                      <input type="checkbox" className="h-3.5 w-3.5 accent-blue-600" checked={cartonCats.includes(t.value)}
                        onChange={() => setCartonCats(p => p.includes(t.value) ? p.filter(x => x !== t.value) : [...p, t.value])} />
                      {t.value}
                    </label>
                  ))}
                </div>
                <Label className="text-xs pt-1 block">QuÃ©t Ä‘á»§ thÃ¹ng</Label>
                <SingleSelect options={CARTON_REQUIRE_OPTS} value={cartonRequire} onChange={setCartonRequire}
                  triggerClassName="h-8 w-full text-sm" />
                <p className="text-[10px] text-slate-400">Báº¯t buá»™c: khi HoÃ n thÃ nh chuyáº¿n, má»—i pallet Ä‘Ã£ quÃ©t pháº£i Ä‘Ã­nh Ä‘á»§ tem thÃ¹ng khá»›p mÃ£ (báº±ng sá»‘ thÃ¹ng cá»§a pallet) â€” thiáº¿u sáº½ bá»‹ cháº·n kÃ¨m danh sÃ¡ch pallet.</p>
              </div>
            )}
          </div>
          {isEdit && (
            <div className="flex items-center gap-2">
              <input id="wh-active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
              <Label htmlFor="wh-active" className="text-sm cursor-pointer">Äang hoáº¡t Ä‘á»™ng</Label>
            </div>
          )}
        </div>
    </FormSheet>
  )
}

// â”€â”€â”€ Zone Dialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ZoneDialog({ zone, warehouseId, warehouses, warehouseTypes, open, onClose }: {
  zone: WarehouseZone | null; warehouseId: string; warehouses: WhRow[]
  warehouseTypes: { id: string; value: string }[]; open: boolean; onClose: () => void
}) {
  const isEdit = !!zone
  const [selectedWhId, setSelectedWhId] = useState(zone?.warehouse_id ?? warehouseId)
  const [code,     setCode]     = useState(zone?.code ?? '')
  const [name,     setName]     = useState(zone?.name ?? '')
  // Multi loáº¡i kho (27/07): khu chá»©a Ä‘Æ°á»£c NHIá»€U loáº¡i, Báº®T BUá»˜C chá»n â‰¥1
  const [categories, setCategories] = useState<string[]>(zone?.categories ?? [])
  const [maxPallets, setMaxPallets] = useState(zone?.max_pallets != null ? String(zone.max_pallets) : '')
  const [isActive, setIsActive] = useState(zone?.is_active ?? true)
  const [err, setErr] = useState('')

  const { mutate: create, isPending: creating } = useCreateWarehouseZone()
  const { mutate: update, isPending: updating } = useUpdateWarehouseZone()
  const isPending = creating || updating

  function handleSubmit() {
    setErr('')
    if (!isEdit && !selectedWhId) { setErr('Chá»n kho lÃ  báº¯t buá»™c'); return }
    if (!name.trim()) { setErr('TÃªn khu vá»±c lÃ  báº¯t buá»™c'); return }
    if (categories.length === 0) { setErr('Chá»n Ã­t nháº¥t 1 Loáº¡i kho cho khu vá»±c'); return }
    const mpRaw = maxPallets.trim()
    if (mpRaw && (!Number.isFinite(Number(mpRaw)) || Number(mpRaw) < 0)) { setErr('Pallet tá»‘i Ä‘a pháº£i lÃ  sá»‘ â‰¥ 0'); return }
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
    <FormSheet open={open} onClose={onClose} title={isEdit ? 'Sá»­a khu vá»±c' : 'ThÃªm khu vá»±c kho'} widthClass="sm:max-w-lg" footer={<>
          <Button variant="outline" size="sm" onClick={onClose}>Huá»·</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !name.trim() || (!isEdit && !selectedWhId)}>
            {isPending ? 'Äang lÆ°uâ€¦' : isEdit ? 'LÆ°u' : 'Táº¡o'}
          </Button>
        </>}>
        <div className="space-y-3">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}

          {/* Kho */}
          {isEdit ? (
            <div className="space-y-1">
              <Label className="text-xs">Kho</Label>
              <p className="text-sm font-medium text-slate-700">
                {warehouses.find(w => w.id === zone.warehouse_id)?.name ?? 'â€”'}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <Label className="text-xs">Kho *</Label>
              <Select value={selectedWhId || '__none__'} onValueChange={v => setSelectedWhId(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Chá»n kho" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">â€” Chá»n kho</SelectItem>
                  {warehouses.map(w => (
                    <SelectItem key={w.id} value={w.id}>{w.name} ({w.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Loáº¡i kho â€” chá»n NHIá»€U, báº¯t buá»™c â‰¥1 (khu chá»©a cáº£ RM01 + PK01â€¦) â€” dropdown chuáº©n form */}
          <div className="space-y-1">
            <Label className="text-xs">Loáº¡i kho <span className="text-red-500">*</span> <span className="text-slate-400 font-normal">(chá»n Ä‘Æ°á»£c nhiá»u)</span></Label>
            <WarehouseMultiSelect
              warehouses={warehouseTypes.map(t => ({ id: t.value, name: t.value }))}
              selected={categories}
              onChange={setCategories}
              placeholder="Chá»n loáº¡i khoâ€¦"
              unitLabel="loáº¡i kho"
              searchPlaceholder="TÃ¬m loáº¡i khoâ€¦"
            />
            <p className="text-[10px] text-slate-400">Khu chá»‰ nháº­n hÃ ng Ä‘Ãºng cÃ¡c loáº¡i Ä‘Ã£ chá»n; vá»‹ trÃ­ trong khu tá»± káº¿ thá»«a</p>
          </div>

          {/* MÃ£ khu vá»±c */}
          <div className="space-y-1">
            <Label className="text-xs">MÃ£ khu vá»±c{!isEdit && <span className="text-slate-400"> (tÃ¹y chá»n)</span>}</Label>
            {isEdit ? (
              <p className="text-sm font-mono font-semibold text-slate-700">{zone.code}</p>
            ) : (
              <>
                <Input value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/\s+/g, ''))} placeholder="vd: TP1, K4RAWâ€¦" />
                <p className="text-[10px] text-slate-400">LÃ  pháº§n giá»¯a mÃ£ vá»‹ trÃ­ (B_<b>TP1</b>_1_T1). Äá»ƒ trá»‘ng = tá»± táº¡o Z01, Z02â€¦ KhÃ´ng trÃ¹ng trong cÃ¹ng kho (khÃ¡c kho trÃ¹ng nhau OK).</p>
              </>
            )}
          </div>

          {/* TÃªn */}
          <div className="space-y-1">
            <Label className="text-xs">TÃªn khu vá»±c *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Khu ThÃ nh pháº©m, Khu NVLâ€¦" />
          </div>

          {/* Pallet tá»‘i Ä‘a (sá»©c chá»©a khai tay â€” Dashboard so tá»“n vs tá»‘i Ä‘a) */}
          <div className="space-y-1">
            <Label className="text-xs">Pallet tá»‘i Ä‘a <span className="text-slate-400">(tÃ¹y chá»n)</span></Label>
            <Input type="number" min={0} value={maxPallets} onChange={e => setMaxPallets(e.target.value)} placeholder="vd: 5000" />
            <p className="text-[10px] text-slate-400">Sá»©c chá»©a pallet cá»§a khu â€” Dashboard so sÃ¡nh pallet tá»“n vá»›i sá»‘ nÃ y. Äá»ƒ trá»‘ng = chÆ°a khai.</p>
          </div>

          {isEdit && (
            <div className="flex items-center gap-2">
              <input id="zone-active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
              <Label htmlFor="zone-active" className="text-sm cursor-pointer">Äang hoáº¡t Ä‘á»™ng</Label>
            </div>
          )}
          {/* Háº¡ng nháº·t / Luá»“ng cá»­a (slotting) chá»‰nh á»Ÿ trang Tá»‘i Æ°u vá»‹ trÃ­ â†’ tab CÃ i Ä‘áº·t (user chá»‘t) */}
        </div>
    </FormSheet>
  )
}

// â”€â”€â”€ Type Dialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// NhÃ£n báº£ng Ä‘á»•i tÃªn cascade â†’ tiáº¿ng Viá»‡t (hiá»‡n trong toast káº¿t quáº£)
const RENAMED_LABELS: Record<string, string> = {
  Material: 'MÃ£ hÃ ng', Location: 'Vá»‹ trÃ­', WarehouseZone: 'Khu vá»±c', Employee: 'NhÃ¢n viÃªn',
  SlotTemplate: 'Khung giá» máº«u', DeliverySlot: 'Khung giá»', TmsOrder: 'ÄÆ¡n TMS',
  GroupDeliveryOrder: 'Chuyáº¿n xuáº¥t', gate_registrations: 'ÄÄƒng kÃ½ cá»•ng',
  inbound_plan_lines: 'KH nháº­p', ProductionImport: 'Phiáº¿u nháº­p',
}

function TypeDialog({ type, open, onClose }: {
  type: { id: string; value: string; meta?: WhTypeMeta | null } | null; open: boolean; onClose: () => void
}) {
  const isEdit = !!type
  const m = type?.meta ?? {}
  const [value, setValue] = useState(type?.value ?? '')
  // Cá» hÃ nh vi per-loáº¡i (LookupValue.meta) â€” thay cÃ¡c hardcode tÃªn loáº¡i cÅ©
  const [isNcc,      setIsNcc]      = useState(m.is_ncc_goods ?? false)
  const [reqShelf,   setReqShelf]   = useState(m.requires_shelf_life ?? true)          // default = hÃ nh vi ThÃ nh pháº©m
  const [reqPalletEa,setReqPalletEa]= useState(m.requires_pallet_per_ea ?? false)
  const [reqNcc,     setReqNcc]     = useState(m.requires_ncc ?? false)
  const [useBatchChar, setUseBatchChar] = useState(!!(m.batch_char ?? '').trim())      // tick = loáº¡i dÃ¹ng kÃ½ tá»± cá»‘ Ä‘á»‹nh
  const [batchChar,  setBatchChar]  = useState(m.batch_char ?? '')
  const [badge,      setBadge]      = useState(m.badge_color ?? '')
  const [err, setErr] = useState('')

  const { mutate: add,    isPending: adding    } = useAddWarehouseType()
  const { mutate: update, isPending: updating  } = useUpdateWarehouseType()
  const isPending = adding || updating

  function handleSubmit() {
    setErr('')
    const name = value.trim()
    if (!name) { setErr('TÃªn loáº¡i kho lÃ  báº¯t buá»™c'); return }
    if (useBatchChar && !batchChar.trim()) { setErr('ÄÃ£ tick dÃ¹ng kÃ½ tá»± mÃ£ lÃ´ â€” nháº­p 1 kÃ½ tá»± (vd K)'); return }
    const meta: WhTypeMeta = {
      is_ncc_goods: isNcc, requires_shelf_life: reqShelf, requires_pallet_per_ea: reqPalletEa,
      requires_ncc: reqNcc,
      batch_char: useBatchChar ? batchChar.trim().toUpperCase().slice(0, 1) : '', badge_color: badge,
    }
    if (isEdit) {
      // Äá»•i TÃŠN = cascade toÃ n DB (Material/Vá»‹ trÃ­/Khu vá»±c/quyá»n NV/khung giá»/Ä‘Æ¡n hÃ ngâ€¦) â€” xÃ¡c nháº­n trÆ°á»›c
      if (name !== type.value && !confirm(
        `Äá»•i tÃªn loáº¡i kho "${type.value}" â†’ "${name}"?\n\nMá»i dá»¯ liá»‡u Ä‘ang dÃ¹ng tÃªn cÅ© (mÃ£ hÃ ng, vá»‹ trÃ­, khu vá»±c, quyá»n nhÃ¢n viÃªn, khung giá» TMS, Ä‘Æ¡n hÃ ng, phiáº¿u nháº­pâ€¦) sáº½ Ä‘Æ°á»£c cáº­p nháº­t Ä‘á»“ng bá»™ theo tÃªn má»›i.`
      )) return
      update({ id: type.id, value: name, meta }, {
        onSuccess: data => {
          if (data?.renamed) {
            const parts = Object.entries(data.renamed).filter(([, n]) => n > 0)
              .map(([t, n]) => `${RENAMED_LABELS[t] ?? t}: ${n}`)
            toast({ title: `ÄÃ£ Ä‘á»•i tÃªn "${type.value}" â†’ "${name}"`,
              description: parts.length ? `Cáº­p nháº­t Ä‘á»“ng bá»™ â€” ${parts.join(' Â· ')}` : 'ChÆ°a cÃ³ dá»¯ liá»‡u nÃ o dÃ¹ng tÃªn cÅ©' })
          } else {
            toast({ title: `ÄÃ£ lÆ°u loáº¡i kho "${name}"` })
          }
          onClose()
        },
        onError: e => setErr(apiMsg(e)),
      })
    } else {
      add({ value: name, meta }, {
        onSuccess: () => { toast({ title: `ÄÃ£ táº¡o loáº¡i kho "${name}"` }); onClose() },
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
    <FormSheet open={open} onClose={onClose} title={isEdit ? 'Sá»­a loáº¡i kho' : 'ThÃªm loáº¡i kho'} widthClass="sm:max-w-lg" footer={<>
          <Button variant="outline" size="sm" onClick={onClose}>Huá»·</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !value.trim()}>
            {isPending ? 'Äang lÆ°uâ€¦' : isEdit ? 'LÆ°u' : 'Táº¡o'}
          </Button>
        </>}>
        <div className="space-y-3">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          <div className="space-y-1">
            <Label className="text-xs">TÃªn loáº¡i kho *</Label>
            <Input value={value} onChange={e => setValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
              placeholder="ThÃ nh pháº©m, NguyÃªn liá»‡u, Váº­t tÆ°â€¦" />
            {isEdit && value.trim() !== type.value && (
              <p className="text-[11px] text-amber-600">Äá»•i tÃªn sáº½ cáº­p nháº­t Ä‘á»“ng bá»™ TOÃ€N Bá»˜ dá»¯ liá»‡u Ä‘ang dÃ¹ng tÃªn cÅ©.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">HÃ nh vi</Label>
            {flagRow('wt-ncc', isNcc, setIsNcc, 'HÃ ng NCC',
              'QuÃ©t nháº­p tem gáº¡ch dÆ°á»›i ( _ ): Ä‘oáº¡n 4 cá»§a QR lÃ  MÃƒ NCC (tá»± nháº­n NCC) thay vÃ¬ MÃ¡y sáº£n xuáº¥t')}
            {flagRow('wt-shelf', reqShelf, setReqShelf, 'Báº¯t buá»™c HSD',
              'MÃ£ hÃ ng thuá»™c loáº¡i nÃ y pháº£i khai HSD (ngÃ y) â€” dÃ¹ng tÃ­nh %Date')}
            {flagRow('wt-palletea', reqPalletEa, setReqPalletEa, 'Báº¯t buá»™c Pallet/EA',
              'MÃ£ hÃ ng thuá»™c loáº¡i nÃ y pháº£i khai Pallet/EA Ä‘á»ƒ quy Ä‘á»•i tá»“n EA â†’ pallet')}
            {flagRow('wt-reqncc', reqNcc, setReqNcc, 'Báº¯t buá»™c cÃ³ NCC khi nháº­p kho',
              'Cháº·n lÆ°u pallet thiáº¿u NCC á»Ÿ quÃ©t nháº­p, nháº­p tay vÃ  upload tá»“n kho. Chuyá»ƒn kho káº¿ thá»«a NCC tá»« pallet gá»‘c, khÃ´ng cháº·n.')}
          </div>

          <div className="space-y-1.5">
            {flagRow('wt-batchchar', useBatchChar, v => { setUseBatchChar(v); if (!v) setBatchChar('') },
              'KÃ½ tá»± mÃ£ lÃ´ cá»‘ Ä‘á»‹nh (tem cháº¥m pháº©y ; )',
              'Sinh tem V2: dÃ¹ng 1 kÃ½ tá»± cá»‘ Ä‘á»‹nh cá»§a Loáº¡i kho tháº¿ chá»— MÃ¡y trong mÃ£ lÃ´ â€” vd Ä‘iá»n K thÃ¬ mÃ£ lÃ´ ra SI260311K021. Bá» tick = chá»n MÃ¡y tay khi sinh tem (ThÃ nh pháº©m).')}
            {useBatchChar && (
              <div className="flex items-center gap-2 pl-6">
                <Label className="text-xs shrink-0">KÃ½ tá»± cá»§a loáº¡i nÃ y *</Label>
                <Input value={batchChar} maxLength={1} className="w-14 uppercase text-center"
                  autoFocus={!batchChar}
                  onChange={e => setBatchChar(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">MÃ u hiá»ƒn thá»‹</Label>
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

// â”€â”€â”€ Ca nháº­p / TÃ¬nh tráº¡ng QA (cÃ¹ng shape: code/name/display_order/is_active) â”€â”€â”€â”€

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
  const noun = kind === 'shift' ? 'ca nháº­p' : 'tráº¡ng thÃ¡i QA'
  const isPending = kind === 'shift'
    ? createShift.isPending || updateShift.isPending
    : createQA.isPending || updateQA.isPending

  function handleSubmit() {
    setErr('')
    if (!code.trim() || !name.trim()) { setErr('MÃ£ vÃ  tÃªn lÃ  báº¯t buá»™c'); return }
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
    <FormSheet open={open} onClose={onClose} title={isEdit ? `Sá»­a ${noun}` : `ThÃªm ${noun}`} widthClass="sm:max-w-lg" footer={<>
          <Button variant="outline" size="sm" onClick={onClose}>Huá»·</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !code.trim() || !name.trim()}>
            {isPending ? 'Äang lÆ°uâ€¦' : isEdit ? 'LÆ°u' : 'Táº¡o'}
          </Button>
        </>}>
        <div className="space-y-3">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">MÃ£ *</Label>
              <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder={kind === 'shift' ? 'C1' : 'OK'} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">TÃªn *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder={kind === 'shift' ? 'Ca 1, Ca hÃ nh chÃ­nhâ€¦' : 'Äáº¡t, Chá» kiá»ƒmâ€¦'} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Thá»© tá»± hiá»ƒn thá»‹</Label>
            <Input type="number" value={order} onChange={e => setOrder(e.target.value)} className="w-24" />
          </div>
          {isEdit && (
            <div className="flex items-center gap-2">
              <input id="meta-active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
              <Label htmlFor="meta-active" className="text-sm cursor-pointer">Äang sá»­ dá»¥ng</Label>
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
            key: 'add', icon: Plus, label: `ThÃªm ${noun}`, tip: `ThÃªm ${noun} má»›i`,
            primary: true, variant: 'default',
            onClick: onAdd,
          } satisfies ActionItem]} />
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {loading ? <div className="p-8 text-center text-sm text-slate-400">Äang táº£iâ€¦</div> :
          rows.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">ChÆ°a cÃ³ {noun} nÃ o</div>
          ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">MÃ£</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">TÃªn</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Thá»© tá»±</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tráº¡ng thÃ¡i</TableHead>
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
                          {r.is_active ? 'Hoáº¡t Ä‘á»™ng' : 'Táº¡m dá»«ng'}
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

// â”€â”€â”€ ÄÆ¡n vá»‹ tÃ­nh (unit_of_measure) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Danh má»¥c Base/Entry Unit â€” thay trÆ°á»ng ÄVT cÅ©. role quyáº¿t Ä‘á»‹nh ÄVT hiá»‡n á»Ÿ selector nÃ o cá»§a MÃ£ hÃ ng.
const UNIT_ROLE_OPTS = [
  { value: 'base',  label: 'Base (Ä‘Æ¡n vá»‹ gá»‘c)',        sub: 'ÄÆ¡n vá»‹ nhá» nháº¥t Ä‘á»ƒ tÃ­nh toÃ¡n â€” há»™p/chai/kg/cÃ¡i' },
  { value: 'entry', label: 'Entry (Ä‘Æ¡n vá»‹ nháº­p/thÃ¹ng)', sub: 'ÄÆ¡n vá»‹ Ä‘Ã³ng gÃ³i lá»›n â€” 1 Entry = N Base' },
  { value: 'both',  label: 'Cáº£ 2 (base hoáº·c entry)',    sub: 'DÃ¹ng Ä‘Æ°á»£c cho cáº£ hai vai' },
]
const UNIT_ROLE_LABEL: Record<UnitRole, string> = { base: 'Base', entry: 'Entry', both: 'Cáº£ 2' }
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
    if (!code) { setErr('MÃ£ ÄVT lÃ  báº¯t buá»™c (vd HOP, CAR, KG)'); return }
    const meta = { role, label: label.trim() || undefined }
    const opts = { onSuccess: onClose, onError: (e: unknown) => setErr(apiMsg(e)) }
    if (isEdit) update({ id: unit.id, value: code, meta }, opts)
    else        add({ value: code, meta }, opts)
  }

  return (
    <FormSheet open={open} onClose={onClose} title={isEdit ? 'Sá»­a Ä‘Æ¡n vá»‹ tÃ­nh' : 'ThÃªm Ä‘Æ¡n vá»‹ tÃ­nh'} widthClass="sm:max-w-lg" footer={<>
          <Button variant="outline" size="sm" onClick={onClose}>Huá»·</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !value.trim()}>
            {isPending ? 'Äang lÆ°uâ€¦' : isEdit ? 'LÆ°u' : 'Táº¡o'}
          </Button>
        </>}>
        <div className="space-y-3">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          <div className="space-y-1">
            <Label className="text-xs">MÃ£ ÄVT *</Label>
            <Input value={value} onChange={e => setValue(e.target.value.toUpperCase())} placeholder="HOP, CAR, KG, BT, BAG, EAâ€¦" disabled={isEdit}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }} />
            <p className="text-[10px] text-slate-400">MÃ£ dÃ¹ng trong tÃ­nh toÃ¡n (Base/Entry Unit cá»§a mÃ£ hÃ ng). {isEdit && 'KhÃ´ng Ä‘á»•i mÃ£ sau khi táº¡o (Ä‘ang Ä‘Æ°á»£c mÃ£ hÃ ng dÃ¹ng).'}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">TÃªn Ä‘áº§y Ä‘á»§</Label>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Há»™p, ThÃ¹ng, Kilogramâ€¦ (tÃ¹y chá»n)" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Loáº¡i ÄVT *</Label>
            <SingleSelect options={UNIT_ROLE_OPTS} value={role} onChange={v => setRole(v as UnitRole)}
              searchable={false} triggerClassName="w-full h-8 text-sm" />
            <p className="text-[10px] text-slate-400">Base = hiá»‡n á»Ÿ Ã´ Base Unit; Entry = hiá»‡n á»Ÿ Ã´ Entry Unit; Cáº£ 2 = cáº£ hai. Má»™t mÃ£ hÃ ng KHÃ”NG Ä‘Æ°á»£c Ä‘áº·t Base trÃ¹ng Entry.</p>
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
    if (!confirm(`XÃ³a Ä‘Æ¡n vá»‹ tÃ­nh "${u.value}"?`)) return
    del(u.id, { onError: e => toast({ variant: 'destructive', title: 'KhÃ´ng xÃ³a Ä‘Æ°á»£c ÄVT', description: apiMsg(e) }) })
  }

  return (
    <>
      <div className="border-b px-3 py-1.5 shrink-0 flex items-center gap-2 flex-wrap">
        <p className="text-xs text-slate-500 flex-1 min-w-[160px] truncate">{units.length} Ä‘Æ¡n vá»‹ tÃ­nh Â· Base/Entry Unit cá»§a mÃ£ hÃ ng</p>
        {canManage && (
          <ActionCluster className="shrink-0" items={[{
            key: 'add', icon: Plus, label: 'ThÃªm ÄVT', tip: 'ThÃªm Ä‘Æ¡n vá»‹ tÃ­nh má»›i',
            primary: true, variant: 'default', onClick: () => { setEditing(null); setShowDlg(true) },
          } satisfies ActionItem]} />
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {isLoading ? <div className="p-8 text-center text-sm text-slate-400">Äang táº£iâ€¦</div> :
          units.length === 0 ? (
            <div className="p-12 text-center text-slate-400 space-y-2">
              <Ruler className="h-10 w-10 mx-auto opacity-30" />
              <p className="text-sm">ChÆ°a cÃ³ Ä‘Æ¡n vá»‹ tÃ­nh nÃ o</p>
              {canManage && <p className="text-xs">Nháº¥n "ThÃªm ÄVT" Ä‘á»ƒ táº¡o (vd HOP=Base, CAR=Entry)</p>}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">MÃ£</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">TÃªn</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Loáº¡i</TableHead>
                  {canManage && <TableHead className="px-2 py-1.5 w-16" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {units.map(u => (
                  <TableRow key={u.id}>
                    <TableCell className="px-2 py-1 font-mono font-semibold text-[10px] text-slate-700 whitespace-nowrap">{u.value}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-slate-600 whitespace-nowrap">{u.meta?.label || <span className="text-slate-300">â€”</span>}</TableCell>
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

// â”€â”€â”€ Main page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function WMSSettings() {
  const user = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const admin = isAdmin(user)
  // Má»—i tab = 1 quyá»n riÃªng (áº©n tab náº¿u khÃ´ng cÃ³ quyá»n). Admin tháº¥y háº¿t.
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

  // Loáº¡i kho
  const { data: warehouseTypes = [], isLoading: loadingTypes } = useWarehouseTypes()
  const { mutate: deleteType, isPending: deletingType }  = useDeleteWarehouseType()
  const [editingType, setEditingType] = useState<{ id: string; value: string; meta?: WhTypeMeta | null } | null>(null)
  const [showTypeDlg, setShowTypeDlg] = useState(false)

  // KÃ©o-tháº£ sáº¯p thá»© tá»± loáº¡i kho (kiá»ƒu AppSheet: grip + chá»‰ bÃ¡o trÃªn/dÆ°á»›i theo ná»­a dÃ²ng)
  type TypeRow = { id: string; value: string; meta?: WhTypeMeta | null; created_at?: string; updated_at?: string; created_by?: string | null; updated_by?: string | null }
  const reorderTypes = useReorderWarehouseTypes()
  const [orderedTypes, setOrderedTypes] = useState<TypeRow[]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overType, setOverType] = useState<{ idx: number; below: boolean } | null>(null)
  // Äá»“ng bá»™ tá»« server khi KHÃ”NG Ä‘ang kÃ©o (sau reorder, refetch sáº½ cáº­p nháº­t Ä‘Ãºng thá»© tá»±).
  // Dep = chuá»—i Ná»˜I DUNG á»•n Ä‘á»‹nh (KHÃ”NG dÃ¹ng ref máº£ng â€” fallback [] Ä‘á»•i ref má»—i render â†’ loop vÃ´ háº¡n).
  // Pháº£i gá»“m cáº£ value + meta: Ä‘á»•i tÃªn/cá» giá»¯ nguyÃªn id â€” chá»‰ key theo id thÃ¬ báº£ng káº¹t báº£n cÅ© tá»›i khi F5.
  const typesKey = (warehouseTypes as TypeRow[]).map(t => `${t.id}|${t.value}|${JSON.stringify(t.meta ?? {})}`).join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (dragIdx !== null) return
    setOrderedTypes(warehouseTypes as TypeRow[])
    // Pane detail Ä‘ang má»Ÿ cÅ©ng nháº­n báº£n má»›i (giá»¯ theo id)
    setDetailType(prev => prev ? ((warehouseTypes as TypeRow[]).find(t => t.id === prev.id) ?? null) : null)
  }, [typesKey, dragIdx])
  function dropType() {
    const from = dragIdx, ov = overType
    setDragIdx(null); setOverType(null)
    if (from === null || !ov) return
    let toIdx = ov.below ? ov.idx + 1 : ov.idx
    if (from < toIdx) toIdx--               // bÃ¹ láº¡i do Ä‘Ã£ splice pháº§n tá»­ kÃ©o
    if (toIdx === from) return
    const next = [...orderedTypes]
    const [moved] = next.splice(from, 1)
    next.splice(toIdx, 0, moved)
    setOrderedTypes(next)
    reorderTypes.mutate(next.map(t => t.id), {
      onError: e => { toast({ variant: 'destructive', title: 'KhÃ´ng lÆ°u Ä‘Æ°á»£c thá»© tá»±', description: apiMsg(e) }); setOrderedTypes(warehouseTypes as TypeRow[]) },
    })
  }

  // Detail panel state
  const [detailWh,   setDetailWh]   = useState<WhRow | null>(null)
  const [detailType, setDetailType] = useState<{ id: string; value: string; meta?: WhTypeMeta | null; created_at?: string; updated_at?: string; created_by?: string | null; updated_by?: string | null } | null>(null)
  const [detailZone, setDetailZone] = useState<WarehouseZone | null>(null)

  // Khu vá»±c kho â€” lá»c theo warehouse_scope cá»§a user
  // Loáº¡i kho trong form/filter Khu vá»±c cáº¯t theo allowed_categories (tab Loáº¡i kho váº«n full â€” quáº£n trá»‹ taxonomy)
  const { data: scopedWhTypes = [] } = useScopedWhTypes()
  const activeWh = (allWh as WhRow[]).filter(w => w.is_active)
  // Scope kho cho tab Khu vá»±c: ASSIGNED â†’ chá»‰ kho Ä‘Æ°á»£c gÃ¡n (khá»›p gÃ¡c BE zoneController); cÃ²n láº¡i â†’ táº¥t cáº£.
  const zoneAccessWh = (admin || user?.warehouse_scope !== 'ASSIGNED')
    ? activeWh
    : activeWh.filter(w => (user?.warehouse_ids ?? []).includes(w.id))
  const [selectedWhId, setSelectedWhId] = useState('')
  const effectiveWhId = selectedWhId || zoneAccessWh[0]?.id || ''
  const { data: zones = [], isLoading: loadingZones } = useWarehouseZones(effectiveWhId || undefined)
  const { mutate: deleteZone, isPending: deletingZone } = useDeleteWarehouseZone()
  const [editingZone, setEditingZone] = useState<WarehouseZone | null>(null)
  const [showZoneDlg, setShowZoneDlg] = useState(false)

  // Ca nháº­p
  const { data: shifts = [], isLoading: loadingShifts } = useImportShifts()
  const [editShift, setEditShift] = useState<MetaRow | null>(null)
  const [showShiftDlg, setShowShiftDlg] = useState(false)

  // TÃ¬nh tráº¡ng QA
  const { data: qaStatuses = [], isLoading: loadingQA } = useQAStatuses()
  const [editQA, setEditQA] = useState<MetaRow | null>(null)
  const [showQADlg, setShowQADlg] = useState(false)

  // â”€â”€ Filter: Kho â”€â”€
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
    // Kho tá»•ng (CENTRAL) trÆ°á»›c, rá»“i NPP; trong cÃ¹ng nhÃ³m sáº¯p theo Ä‘á»‹a chá»‰
    if (whRank(a.warehouse_type) !== whRank(b.warehouse_type)) return whRank(a.warehouse_type) - whRank(b.warehouse_type)
    return (a.address ?? '').localeCompare(b.address ?? '', 'vi')
  })
  const whFilterDefs: FilterDef[] = [
    { key: 'func', label: 'Chá»©c nÄƒng', type: 'single', value: whFunc, onChange: setWhFunc, allLabel: 'Táº¥t cáº£',
      options: [{ value: 'CENTRAL', label: 'Kho tá»•ng' }, { value: 'NPP', label: 'Kho NPP' }] },
    { key: 'inv', label: 'Quáº£n tá»“n', type: 'single', value: whInv, onChange: setWhInv, allLabel: 'Táº¥t cáº£',
      options: (Object.keys(INV_MODE_META) as InvMode[]).map(m => ({ value: m, label: INV_MODE_META[m].label })) },
    { key: 'wst', label: 'Tráº¡ng thÃ¡i', type: 'single', value: whStatus, onChange: setWhStatus, allLabel: 'Táº¥t cáº£',
      options: [{ value: 'active', label: 'Hoáº¡t Ä‘á»™ng' }, { value: 'inactive', label: 'Táº¡m dá»«ng' }] },
  ]

  // â”€â”€ Filter: Khu vá»±c kho â”€â”€
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
    { key: 'zcat', label: 'Loáº¡i kho', type: 'single', value: zoneCat, onChange: setZoneCat, allLabel: 'Táº¥t cáº£',
      options: (scopedWhTypes as { id: string; value: string }[]).map(t => ({ value: t.value, label: t.value })) },
    { key: 'zst', label: 'Tráº¡ng thÃ¡i', type: 'single', value: zoneStatus, onChange: setZoneStatus, allLabel: 'Táº¥t cáº£',
      options: [{ value: 'active', label: 'Hoáº¡t Ä‘á»™ng' }, { value: 'inactive', label: 'Táº¡m dá»«ng' }] },
  ]

  function handleDeleteWh(wh: WhRow) {
    if (!confirm(`XÃ³a kho "${wh.name}"?\nChá»‰ xÃ³a Ä‘Æ°á»£c kho chÆ°a cÃ³ vá»‹ trÃ­ nÃ o.`)) return
    deleteWh(wh.id, { onError: e => toast({ variant: 'destructive', title: 'KhÃ´ng xÃ³a Ä‘Æ°á»£c kho', description: apiMsg(e) }) })
  }

  function handleDeleteZone(z: WarehouseZone) {
    if (!confirm(`XÃ³a khu vá»±c "${z.code} â€“ ${z.name}"?`)) return
    deleteZone(z.id, { onError: e => toast({ variant: 'destructive', title: 'KhÃ´ng xÃ³a Ä‘Æ°á»£c khu vá»±c', description: apiMsg(e) }) })
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {!defaultTab ? (
        <div className="p-12 text-center text-slate-400 text-sm">
          Báº¡n chÆ°a Ä‘Æ°á»£c cáº¥p quyá»n quáº£n lÃ½ má»¥c nÃ o trong CÃ i Ä‘áº·t WMS.
        </div>
      ) : (
      <Tabs defaultValue={defaultTab} className="flex flex-col flex-1 min-h-0">
        {/* Pháº§n trÃªn gá»n 1 hÃ ng (tiÃªu Ä‘á» + tab) â€” báº£ng chiáº¿m toÃ n bá»™ pháº§n cÃ²n láº¡i */}
        <div className="border-b bg-white px-3 py-2 shrink-0 flex items-center gap-2 flex-wrap sm:rounded-t-xl">
          <span className="text-sm font-semibold text-slate-700 shrink-0 flex items-center gap-1.5">
            <Settings2 className="h-4 w-4 text-slate-500" /> CÃ i Ä‘áº·t WMS
          </span>
          <TabsList className="h-8 max-w-full overflow-x-auto">
            {canManageWarehouse && <TabsTrigger value="warehouses" className="gap-1.5 text-xs"><Warehouse className="h-3.5 w-3.5" /> Kho</TabsTrigger>}
            {canManageType      && <TabsTrigger value="types"      className="gap-1.5 text-xs"><Tag      className="h-3.5 w-3.5" /> Loáº¡i kho</TabsTrigger>}
            {canManageUnit      && <TabsTrigger value="units"      className="gap-1.5 text-xs"><Ruler    className="h-3.5 w-3.5" /> ÄÆ¡n vá»‹ tÃ­nh</TabsTrigger>}
            {canManageZone      && <TabsTrigger value="zones"      className="gap-1.5 text-xs"><MapPin     className="h-3.5 w-3.5" /> Khu vá»±c</TabsTrigger>}
            {canManageShift     && <TabsTrigger value="shifts"     className="gap-1.5 text-xs"><Clock      className="h-3.5 w-3.5" /> Ca nháº­p</TabsTrigger>}
            {canManageQA        && <TabsTrigger value="qa"         className="gap-1.5 text-xs"><ShieldCheck className="h-3.5 w-3.5" /> QA</TabsTrigger>}
            {canManageMachine   && <TabsTrigger value="machines"   className="gap-1.5 text-xs"><Cog className="h-3.5 w-3.5" /> MÃ¡y</TabsTrigger>}
            {canManageSystem    && <TabsTrigger value="system"     className="gap-1.5 text-xs"><SlidersHorizontal className="h-3.5 w-3.5" /> Há»‡ thá»‘ng</TabsTrigger>}
          </TabsList>
        </div>

        {/* â”€â”€ Tab: Kho â”€â”€ */}
        <TabsContent value="warehouses" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <div className="border-b px-3 py-1.5 shrink-0 flex items-center gap-2 flex-wrap">
            <SearchInput value={whSearch} onChange={setWhSearch} placeholder="TÃ¬m mÃ£, tÃªn, Ä‘á»‹a chá»‰ khoâ€¦" className="flex-1 min-w-[160px]" />
            <FilterBar defs={whFilterDefs} />
            {canManageWarehouse && (
              <ActionCluster className="shrink-0" items={[{
                key: 'add', icon: Plus, label: 'ThÃªm kho', tip: 'ThÃªm kho má»›i',
                primary: true, variant: 'default',
                onClick: () => { setEditingWh(null); setShowWhDlg(true) },
              } satisfies ActionItem]} />
            )}
          </div>
          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 overflow-auto pb-20 lg:pb-4">
              {loadingWh ? <div className="p-8 text-center text-sm text-slate-400">Äang táº£iâ€¦</div> :
                filteredWh.length === 0 ? (
                  <div className="p-12 text-center text-slate-400 text-sm">KhÃ´ng cÃ³ kho khá»›p bá»™ lá»c</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">MÃ£</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">NMSX</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Ship-to phá»¥</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">TÃªn kho</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Chá»©c nÄƒng</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Quáº£n tá»“n</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Äá»‹a chá»‰</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tráº¡ng thÃ¡i</TableHead>
                        {canManageWarehouse && <TableHead className="px-2 py-1.5 w-16" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredWh.map(wh => (
                        <TableRow key={wh.id}
                          className={`cursor-pointer ${!wh.is_active ? 'opacity-50' : ''} ${detailWh?.id === wh.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                          onClick={() => setDetailWh(prev => prev?.id === wh.id ? null : wh)}>
                          <TableCell className="px-2 py-1 font-mono font-semibold text-[10px] text-slate-600 whitespace-nowrap">{wh.code}</TableCell>
                          <TableCell className="px-2 py-1 font-mono font-semibold text-[10px] text-slate-600 whitespace-nowrap">{wh.nmsx_code || <span className="text-slate-300 font-sans font-normal">â€”</span>}</TableCell>
                          <TableCell className="px-2 py-1 font-mono text-[10px] text-slate-500 whitespace-nowrap">{wh.shipto_codes?.length ? wh.shipto_codes.join(', ') : <span className="text-slate-300">â€”</span>}</TableCell>
                          <TableCell className="px-2 py-1 text-[10px] font-medium text-slate-800 whitespace-nowrap">
                            {wh.name}
                            {wh.parent_warehouse_id && (
                              <Badge variant="outline" className="ml-1.5 text-[9px] border-violet-400 text-violet-700 bg-violet-50">
                                Ná»™i bá»™ Â· {(allWh as WhRow[]).find(p => p.id === wh.parent_warehouse_id)?.code ?? '?'}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="px-2 py-1 whitespace-nowrap">
                            <Badge variant="outline" className={`text-[10px] ${wh.warehouse_type === 'NPP' ? 'border-amber-400 text-amber-700 bg-amber-50' : 'border-blue-400 text-blue-700 bg-blue-50'}`}>
                              {wh.warehouse_type === 'NPP' ? 'Kho NPP' : 'Kho tá»•ng'}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-2 py-1 whitespace-nowrap">
                            <Badge variant="outline" className={`text-[10px] ${invModeMeta(wh.inventory_mode).badge}`}>
                              {invModeMeta(wh.inventory_mode).label}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{wh.address ?? 'â€”'}</TableCell>
                          <TableCell className="px-2 py-1 whitespace-nowrap">
                            <Badge variant={wh.is_active ? 'default' : 'secondary'} className="text-xs">
                              {wh.is_active ? 'Hoáº¡t Ä‘á»™ng' : 'Táº¡m dá»«ng'}
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
                  <span className="font-semibold text-slate-700">{detailWh.code} â€” {detailWh.name}</span>
                  <button onClick={() => setDetailWh(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                </div>
                <div><span className="text-slate-400">Chá»©c nÄƒng:</span> <span className="font-medium">{detailWh.warehouse_type === 'NPP' ? 'Kho NPP' : 'Kho tá»•ng'}</span></div>
                <div><span className="text-slate-400">Quáº£n tá»“n:</span> <span className="font-medium">{invModeMeta(detailWh.inventory_mode).label}</span></div>
                <div><span className="text-slate-400">Trá»±c thuá»™c:</span> <span className="font-medium">{detailWh.parent_warehouse_id ? ((allWh as WhRow[]).find(p => p.id === detailWh.parent_warehouse_id)?.name ?? '?') : 'â€” (kho thÆ°á»ng)'}</span></div>
                <div><span className="text-slate-400">NMSX:</span> <span className="font-mono font-medium">{detailWh.nmsx_code || 'â€”'}</span></div>
                <div><span className="text-slate-400">Ship-to phá»¥:</span> <span className="font-mono font-medium">{detailWh.shipto_codes?.length ? detailWh.shipto_codes.join(', ') : 'â€”'}</span></div>
                <div><span className="text-slate-400">Äá»‹a chá»‰:</span> <span className="font-medium">{detailWh.address ?? 'â€”'}</span></div>
                <div><span className="text-slate-400">Tráº¡ng thÃ¡i:</span> <span className="font-medium">{detailWh.is_active ? 'Hoáº¡t Ä‘á»™ng' : 'Táº¡m dá»«ng'}</span></div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Táº¡o / Sá»­a</p>
                  <div><span className="text-slate-400">NgÆ°á»i táº¡o:</span> <span className="font-medium">{detailWh.created_by ?? 'â€”'}</span></div>
                  <div><span className="text-slate-400">NgÃ y giá» táº¡o:</span> <span className="font-medium">{detailWh.created_at ? formatDateTime(detailWh.created_at) : 'â€”'}</span></div>
                  <div><span className="text-slate-400">NgÆ°á»i sá»­a:</span> <span className="font-medium">{detailWh.updated_by ?? 'â€”'}</span></div>
                  <div><span className="text-slate-400">NgÃ y giá» sá»­a:</span> <span className="font-medium">{detailWh.updated_at ? formatDateTime(detailWh.updated_at) : 'â€”'}</span></div>
                </div>
              </aside>
            )}
          </div>
          <div className="border-t px-3 py-1 text-[10px] text-slate-500 shrink-0">1â€“{filteredWh.length} / {(allWh as WhRow[]).length} kho</div>
        </TabsContent>

        {/* â”€â”€ Tab: Loáº¡i kho â”€â”€ */}
        <TabsContent value="types" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <div className="border-b px-3 py-1.5 shrink-0 flex items-center gap-2 flex-wrap">
            <p className="text-xs text-slate-500 flex-1 min-w-[160px] truncate">
              {canManageType ? <>KÃ©o <GripVertical className="inline h-3 w-3 -mt-0.5" /> Ä‘á»ƒ Ä‘á»•i thá»© tá»± (Ã¡p cho cÃ¢y ÄÄƒng kÃ½ cá»•ng)</> : 'Danh má»¥c loáº¡i kho'}
            </p>
            {canManageType && (
              <ActionCluster className="shrink-0" items={[{
                key: 'add', icon: Plus, label: 'ThÃªm loáº¡i kho', tip: 'ThÃªm loáº¡i kho má»›i',
                primary: true, variant: 'default',
                onClick: () => { setEditingType(null); setShowTypeDlg(true) },
              } satisfies ActionItem]} />
            )}
          </div>

          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 overflow-auto pb-20 lg:pb-4">
              {loadingTypes ? <div className="p-8 text-center text-sm text-slate-400">Äang táº£iâ€¦</div> :
                warehouseTypes.length === 0 ? (
                  <div className="p-12 text-center text-slate-400 space-y-2">
                    <Tag className="h-10 w-10 mx-auto opacity-30" />
                    <p className="text-sm">ChÆ°a cÃ³ loáº¡i kho nÃ o</p>
                    {canManageType && <p className="text-xs">Nháº¥n "ThÃªm loáº¡i kho" Ä‘á»ƒ táº¡o loáº¡i kho Ä‘áº§u tiÃªn</p>}
                  </div>
                ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {canManageType && <TableHead className="px-2 py-1.5 w-8" />}
                          <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">TÃªn loáº¡i kho</TableHead>
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
                              <TableCell className="px-2 py-1 w-8 text-slate-300 cursor-grab active:cursor-grabbing" onClick={e => e.stopPropagation()} title="KÃ©o Ä‘á»ƒ Ä‘á»•i thá»© tá»±">
                                <GripVertical className="h-4 w-4" />
                              </TableCell>
                            )}
                            <TableCell className="px-2 py-1 whitespace-nowrap">
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${whTypeBadgeCls(t.value, new Map([[t.value, t.meta ?? {}]]))}`}>{t.value}</span>
                              <span className="ml-1.5 text-[9px] text-slate-400">
                                {[t.meta?.is_ncc_goods && 'NCC', t.meta?.requires_shelf_life && 'HSD', t.meta?.requires_pallet_per_ea && 'Pallet/EA',
                                  t.meta?.requires_ncc && 'NCC báº¯t buá»™c', t.meta?.batch_char && `MÃ£ lÃ´: ${t.meta.batch_char}`].filter(Boolean).join(' Â· ')}
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
                                    onClick={e => { e.stopPropagation(); if (confirm(`XÃ³a loáº¡i kho "${t.value}"?`)) deleteType(t.id, { onSuccess: () => setDetailType(prev => prev?.id === t.id ? null : prev), onError: e2 => toast({ variant: 'destructive', title: 'KhÃ´ng xÃ³a Ä‘Æ°á»£c loáº¡i kho', description: apiMsg(e2) }) }) }}>
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
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">HÃ nh vi</p>
                  <div><span className="text-slate-400">HÃ ng NCC:</span> <span className="font-medium">{detailType.meta?.is_ncc_goods ? 'CÃ³ (QR Ä‘oáº¡n 4 = mÃ£ NCC)' : 'KhÃ´ng (Ä‘oáº¡n 4 = MÃ¡y)'}</span></div>
                  <div><span className="text-slate-400">Báº¯t buá»™c HSD:</span> <span className="font-medium">{detailType.meta?.requires_shelf_life ? 'CÃ³' : 'KhÃ´ng'}</span></div>
                  <div><span className="text-slate-400">Báº¯t buá»™c Pallet/EA:</span> <span className="font-medium">{detailType.meta?.requires_pallet_per_ea ? 'CÃ³' : 'KhÃ´ng'}</span></div>
                  <div><span className="text-slate-400">Báº¯t buá»™c NCC khi nháº­p:</span> <span className="font-medium">{detailType.meta?.requires_ncc ? 'CÃ³ (cháº·n lÆ°u thiáº¿u NCC)' : 'KhÃ´ng'}</span></div>
                  <div><span className="text-slate-400">KÃ½ tá»± mÃ£ lÃ´:</span> <span className="font-medium">{detailType.meta?.batch_char || 'â€” (chá»n MÃ¡y tay)'}</span></div>
                </div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Táº¡o / Sá»­a</p>
                  <div><span className="text-slate-400">NgÆ°á»i táº¡o:</span> <span className="font-medium">{detailType.created_by ?? 'â€”'}</span></div>
                  <div><span className="text-slate-400">NgÃ y giá» táº¡o:</span> <span className="font-medium">{detailType.created_at ? formatDateTime(detailType.created_at) : 'â€”'}</span></div>
                  <div><span className="text-slate-400">NgÆ°á»i sá»­a:</span> <span className="font-medium">{detailType.updated_by ?? 'â€”'}</span></div>
                  <div><span className="text-slate-400">NgÃ y giá» sá»­a:</span> <span className="font-medium">{detailType.updated_at ? formatDateTime(detailType.updated_at) : 'â€”'}</span></div>
                </div>
              </aside>
            )}
          </div>
          <div className="border-t px-3 py-1 text-[10px] text-slate-500 shrink-0">1â€“{orderedTypes.length} / {orderedTypes.length} loáº¡i kho</div>
        </TabsContent>

        {/* â”€â”€ Tab: ÄÆ¡n vá»‹ tÃ­nh â”€â”€ */}
        <TabsContent value="units" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <UnitTab canManage={canManageUnit} />
        </TabsContent>

        {/* â”€â”€ Tab: Khu vá»±c kho â”€â”€ */}
        <TabsContent value="zones" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <div className="border-b px-3 py-1.5 shrink-0 flex items-center gap-2 flex-wrap">
            <SingleSelect
              options={zoneAccessWh.map(w => ({ value: w.id, label: w.name, sub: w.code }))}
              value={effectiveWhId}
              onChange={setSelectedWhId}
              placeholder="Chá»n kho"
              searchPlaceholder="TÃ¬m khoâ€¦"
              triggerClassName="h-8 w-44 text-xs shrink-0"
            />
            {effectiveWhId && (
              <>
                <SearchInput value={zoneSearch} onChange={setZoneSearch} placeholder="TÃ¬m mÃ£, tÃªn khu vá»±câ€¦" className="flex-1 min-w-[140px]" />
                <FilterBar defs={zoneFilterDefs} />
              </>
            )}
            {canManageZone && (
              <ActionCluster className="ml-auto shrink-0" items={[{
                key: 'add', icon: Plus, label: 'ThÃªm khu vá»±c', tip: 'ThÃªm khu vá»±c kho má»›i',
                primary: true, variant: 'default',
                onClick: () => { setEditingZone(null); setShowZoneDlg(true) },
              } satisfies ActionItem]} />
            )}
          </div>

          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 overflow-auto pb-20 lg:pb-4">
              {!effectiveWhId ? (
                <div className="p-8 text-center text-sm text-slate-400">Chá»n kho Ä‘á»ƒ xem khu vá»±c</div>
              ) : loadingZones ? (
                <div className="p-8 text-center text-sm text-slate-400">Äang táº£iâ€¦</div>
              ) : zones.length === 0 ? (
                <div className="p-12 text-center text-slate-400 space-y-2">
                  <MapPin className="h-10 w-10 mx-auto opacity-30" />
                  <p className="text-sm">Kho nÃ y chÆ°a cÃ³ khu vá»±c nÃ o</p>
                  {canManageZone && <p className="text-xs">Nháº¥n "ThÃªm khu vá»±c" Ä‘á»ƒ táº¡o khu vá»±c Ä‘áº§u tiÃªn</p>}
                </div>
              ) : filteredZones.length === 0 ? (
                <div className="p-12 text-center text-slate-400 text-sm">KhÃ´ng cÃ³ khu vá»±c khá»›p bá»™ lá»c</div>
              ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">MÃ£ khu vá»±c</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">TÃªn khu vá»±c</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Loáº¡i kho</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap text-right">Pallet tá»‘i Ä‘a</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tráº¡ng thÃ¡i</TableHead>
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
                          <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{z.categories?.length ? z.categories.join(', ') : <span className="text-slate-300">â€”</span>}</TableCell>
                          <TableCell className="px-2 py-1 text-[10px] text-right font-semibold tabular-nums whitespace-nowrap">{z.max_pallets != null ? z.max_pallets.toLocaleString('vi-VN') : <span className="text-slate-300 font-normal">â€”</span>}</TableCell>
                          <TableCell className="px-2 py-1 whitespace-nowrap">
                            <Badge variant={z.is_active ? 'default' : 'secondary'} className="text-xs">
                              {z.is_active ? 'Hoáº¡t Ä‘á»™ng' : 'Táº¡m dá»«ng'}
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
                  <span className="font-semibold text-slate-700">{detailZone.code} â€” {detailZone.name}</span>
                  <button onClick={() => setDetailZone(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                </div>
                <div><span className="text-slate-400">Loáº¡i kho:</span> <span className="font-medium">{detailZone.categories?.length ? detailZone.categories.join(', ') : 'â€”'}</span></div>
                <div><span className="text-slate-400">Pallet tá»‘i Ä‘a:</span> <span className="font-medium tabular-nums">{detailZone.max_pallets != null ? detailZone.max_pallets.toLocaleString('vi-VN') : 'ChÆ°a khai'}</span></div>
                <div><span className="text-slate-400">Tráº¡ng thÃ¡i:</span> <span className="font-medium">{detailZone.is_active ? 'Hoáº¡t Ä‘á»™ng' : 'Táº¡m dá»«ng'}</span></div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Táº¡o / Sá»­a</p>
                  <div><span className="text-slate-400">NgÆ°á»i táº¡o:</span> <span className="font-medium">{detailZone.created_by ?? 'â€”'}</span></div>
                  <div><span className="text-slate-400">NgÃ y giá» táº¡o:</span> <span className="font-medium">{detailZone.created_at ? formatDateTime(detailZone.created_at) : 'â€”'}</span></div>
                  <div><span className="text-slate-400">NgÆ°á»i sá»­a:</span> <span className="font-medium">{detailZone.updated_by ?? 'â€”'}</span></div>
                  <div><span className="text-slate-400">NgÃ y giá» sá»­a:</span> <span className="font-medium">{detailZone.updated_at ? formatDateTime(detailZone.updated_at) : 'â€”'}</span></div>
                </div>
              </aside>
            )}
          </div>
          <div className="border-t px-3 py-1 text-[10px] text-slate-500 shrink-0">1â€“{filteredZones.length} / {(zones as WarehouseZone[]).length} khu vá»±c</div>
        </TabsContent>

        {/* â”€â”€ Tab: Ca nháº­p â”€â”€ */}
        <TabsContent value="shifts" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <MetaTab noun="ca nháº­p" rows={shifts} loading={loadingShifts} canManage={canManageShift}
            onAdd={() => { setEditShift(null); setShowShiftDlg(true) }}
            onEdit={r => { setEditShift(r); setShowShiftDlg(true) }} />
        </TabsContent>

        {/* â”€â”€ Tab: TÃ¬nh tráº¡ng QA â”€â”€ */}
        <TabsContent value="qa" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <MetaTab noun="tráº¡ng thÃ¡i QA" rows={qaStatuses} loading={loadingQA} canManage={canManageQA}
            onAdd={() => { setEditQA(null); setShowQADlg(true) }}
            onEdit={r => { setEditQA(r); setShowQADlg(true) }} />
        </TabsContent>

        {/* â”€â”€ Tab: MÃ¡y theo Kho (user 13/08 â€” Sá»• Ä‘Ã³ng gÃ³i + Sinh tem validate mÃ¡y á»Ÿ Ä‘Ã¢y) â”€â”€ */}
        <TabsContent value="machines" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <MachineTab canManage={canManageMachine} warehouses={allWh as { id: string; name: string }[]} />
        </TabsContent>

        {/* â”€â”€ Tab: Há»‡ thá»‘ng (cá» SystemSetting) â”€â”€ */}
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

// â”€â”€â”€ Tab MÃ¡y theo Kho (user 13/08; Ä‘á»“ng bá»™ khuÃ´n tab KHU Vá»°C theo yÃªu cáº§u cÃ¹ng ngÃ y) â”€â”€
// MÃ¡y THUá»˜C Kho â€” má»—i kho danh má»¥c riÃªng. Kho cÃ³ mÃ¡y â†’ Sá»• Ä‘Ã³ng gÃ³i (má»Ÿ/sá»­a trang) + Sinh tem
// (theo NMSX) PHáº¢I chá»n trong danh má»¥c (BE 422 MACHINE_INVALID); kho chÆ°a khai â†’ Ä‘iá»n tá»± do.
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
    if (!confirm(`XÃ³a mÃ¡y "${m.code}" (${whName.get(m.warehouse_id) ?? ''})?`)) return
    deleteM(m.id, { onError: e => toast({ variant: 'destructive', title: 'KhÃ´ng xÃ³a Ä‘Æ°á»£c mÃ¡y', description: apiMsg(e) }) })
  }

  return (
    <>
      <div className="border-b px-3 py-1.5 shrink-0 flex items-center gap-2 flex-wrap">
        <SingleSelect
          options={warehouses.map(w => ({ value: w.id, label: w.name, sub: w.code }))}
          value={whId} onChange={setWhId}
          placeholder="Táº¥t cáº£ kho" searchPlaceholder="TÃ¬m khoâ€¦"
          triggerClassName="h-8 w-44 text-xs shrink-0"
        />
        <SearchInput value={search} onChange={setSearch} placeholder="TÃ¬m tÃªn mÃ¡y, ghi chÃºâ€¦" className="flex-1 min-w-[140px]" />
        {canManage && (
          <ActionCluster className="ml-auto shrink-0" items={[{
            key: 'add', icon: Plus, label: 'ThÃªm mÃ¡y', tip: 'ThÃªm mÃ¡y vÃ o danh má»¥c cá»§a 1 kho',
            primary: true, variant: 'default',
            onClick: () => { setEditing(null); setShowDlg(true) },
          } satisfies ActionItem]} />
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Äang táº£iâ€¦</div>
        ) : machines.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <Cog className="h-10 w-10 mx-auto opacity-30" />
            <p className="text-sm">{whId ? 'Kho nÃ y chÆ°a khai mÃ¡y â€” Sá»• Ä‘Ã³ng gÃ³i / Sinh tem Ä‘ang cho Ä‘iá»n mÃ¡y tá»± do' : 'ChÆ°a cÃ³ mÃ¡y nÃ o'}</p>
            {canManage && <p className="text-xs">Nháº¥n "ThÃªm mÃ¡y" Ä‘á»ƒ khai mÃ¡y Ä‘áº§u tiÃªn â€” kho cÃ³ danh má»¥c mÃ¡y thÃ¬ cÃ¡c form PHáº¢I chá»n trong danh má»¥c</p>}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">KhÃ´ng cÃ³ mÃ¡y khá»›p tÃ¬m kiáº¿m</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Kho</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">TÃªn mÃ¡y</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Ghi chÃº</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tráº¡ng thÃ¡i</TableHead>
                {canManage && <TableHead className="px-2 py-1.5 w-16" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(m => (
                <TableRow key={m.id} className={!m.is_active ? 'opacity-50' : 'hover:bg-slate-50'}>
                  <TableCell className="px-2 py-1 text-[10px] text-slate-600 whitespace-nowrap">{whName.get(m.warehouse_id) ?? m.warehouse_id}</TableCell>
                  <TableCell className="px-2 py-1 font-mono font-semibold text-[10px] text-slate-800 whitespace-nowrap">{m.code}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{m.note || <span className="text-slate-300">â€”</span>}</TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap">
                    <Badge variant={m.is_active ? 'default' : 'secondary'} className="text-xs">
                      {m.is_active ? 'Hoáº¡t Ä‘á»™ng' : 'Táº¡m dá»«ng'}
                    </Badge>
                  </TableCell>
                  {canManage && (
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <div className="flex justify-end gap-0.5">
                        <button className="text-slate-400 hover:text-blue-500 p-1 transition-colors" title="Sá»­a"
                          onClick={e => { e.stopPropagation(); setEditing(m); setShowDlg(true) }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button className="text-slate-400 hover:text-red-500 p-1 transition-colors" title="XÃ³a" disabled={deleting}
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
        1â€“{filtered.length} / {machines.length} mÃ¡y{whId ? ` Â· ${whName.get(whId) ?? ''}` : ''} â€” kho cÃ³ danh má»¥c mÃ¡y thÃ¬ Sá»• Ä‘Ã³ng gÃ³i + Sinh tem pháº£i chá»n trong danh má»¥c; kho chÆ°a khai thÃ¬ Ä‘iá»n tá»± do
      </div>
      {showDlg && (
        <MachineDialog machine={editing} warehouseId={whId} warehouses={warehouses} open={showDlg} onClose={() => setShowDlg(false)} />
      )}
    </>
  )
}

// Form ThÃªm/Sá»­a mÃ¡y â€” FormSheet nhÆ° ZoneDialog (user 13/08 "ThÃªm mÃ¡y má»Ÿ ra form, Ä‘á»“ng bá»™ nhÆ° Khu vá»±c")
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
    if (!isEdit && !selectedWhId) { setErr('Chá»n kho lÃ  báº¯t buá»™c'); return }
    if (!code.trim()) { setErr('TÃªn mÃ¡y lÃ  báº¯t buá»™c'); return }
    if (isEdit) {
      update({ id: machine.id, code: code.trim(), note: note.trim(), is_active: isActive },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
    } else {
      create({ warehouse_id: selectedWhId, code: code.trim(), note: note.trim() || undefined },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
    }
  }

  return (
    <FormSheet open={open} onClose={onClose} title={isEdit ? 'Sá»­a mÃ¡y' : 'ThÃªm mÃ¡y'} widthClass="sm:max-w-lg" footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Huá»·</Button>
        <Button size="sm" onClick={handleSubmit} disabled={isPending || !code.trim() || (!isEdit && !selectedWhId)}>
          {isPending ? 'Äang lÆ°uâ€¦' : isEdit ? 'LÆ°u' : 'Táº¡o'}
        </Button>
      </>}>
      <div className="space-y-3">
        {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}

        {/* Kho â€” khÃ³a khi sá»­a (mÃ¡y thuá»™c kho, Ä‘á»•i kho = xÃ³a rá»“i thÃªm á»Ÿ kho kia) */}
        {isEdit ? (
          <div className="space-y-1">
            <Label className="text-xs">Kho</Label>
            <p className="text-sm font-medium text-slate-700">{warehouses.find(w => w.id === machine.warehouse_id)?.name ?? 'â€”'}</p>
          </div>
        ) : (
          <div className="space-y-1">
            <Label className="text-xs">Kho <span className="text-red-500">*</span></Label>
            <Select value={selectedWhId || '__none__'} onValueChange={v => setSelectedWhId(v === '__none__' ? '' : v)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Chá»n kho" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">â€” Chá»n kho</SelectItem>
                {warehouses.map(w => (
                  <SelectItem key={w.id} value={w.id}>{w.name}{w.code ? ` (${w.code})` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs">TÃªn mÃ¡y <span className="text-red-500">*</span></Label>
          <Input value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/\s+/g, ''))} placeholder="VD: A, M1" maxLength={10} />
          <p className="text-[10px] text-slate-400">In trÃªn tem pallet (Ä‘oáº¡n MÃ¡y) â€” tá»± viáº¿t HOA, tá»‘i Ä‘a 10 kÃ½ tá»±, khÃ´ng trÃ¹ng trong cÃ¹ng kho</p>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Ghi chÃº</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} placeholder="VD: dÃ¢y chuyá»n 180mlâ€¦" />
        </div>

        {isEdit && (
          <div className="space-y-1">
            <Label className="text-xs">Tráº¡ng thÃ¡i</Label>
            <Select value={isActive ? '1' : '0'} onValueChange={v => setIsActive(v === '1')}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Hoáº¡t Ä‘á»™ng</SelectItem>
                <SelectItem value="0">Táº¡m dá»«ng (khá»i hiá»‡n trong danh sÃ¡ch chá»n â€” trang sá»• cÅ© giá»¯ nguyÃªn)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </FormSheet>
  )
}
