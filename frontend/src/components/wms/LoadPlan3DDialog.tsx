// Sơ đồ xếp xe 3D — hướng dẫn xếp thùng carton lên thùng xe cho chuyến xuất.
// Thuật toán ở utils/loadPlan.ts (4 luật: theo đơn · chân đều · dãy 1 kích thước · hàng nhẹ lên nóc).
// Three.js nạp LAZY (dynamic import) — không phình bundle chính.
// 2 CHẾ ĐỘ (user chốt 12/07):
//  - "Dự toán": toàn bộ kế hoạch + thanh trượt thứ tự xếp; phần ĐÃ XUẤT thật mờ đi theo tiến độ quét.
//  - "Tiến độ": chỉ hiện thùng ĐÃ XUẤT thật (quét QR / lưu thủ công; nhặt lẻ CHỈ tính khi đã xác nhận cuối).
//  gdo đến từ useGDO (realtime invalidate) → quét tới đâu sơ đồ tự cập nhật tới đó.
// Mỗi MẢNG hàng có nhãn tên + mũi tên chỉ xuống khối (sprite + cone).
import { useEffect, useMemo, useRef, useState } from 'react'
import { qtyEntryDecimal, unitLabel, hasEntry } from '@/utils/qtyUnits'
import { X, Boxes, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSystemSettings, useUpdateSystemSetting, useAssumedCarton, useTmsVehiclesPaged, useTmsVehiclesWithBox, useVehicleTypes, usePalletCarrierMaterials } from '@/api/hooks'
import { SingleSelect, type SingleSelectOption } from '@/components/shared/SingleSelect'
import { InfoTip } from '@/components/shared/InfoTip'
import { useLoadPlanPrefsStore, type LoadPlacement } from '@/stores/loadPlanPrefsStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import {
  computeLoadPlan, GROUP_COLORS, palletizeGroups, palletFitError, palletFloorSlots, palletsTooTall,
  spreadOnTopOfPallets, DEFAULT_PALLET, cartonBoxOf, type LoadGroup, type LoadPlan, type PalletSpec, type PalletizeInput,
} from '@/utils/loadPlan'
import type { GDO } from '@/types'

// Dòng xe ghi nhớ lòng thùng (mm) — SystemSetting 'truck_models'. ĐỘC LẬP với Loại xe TMS
// (user chốt 13/07: 1 loại xe booking có nhiều dòng xe thực tế, dims không treo trên Loại xe).
type TruckModel = { name: string; l: number; w: number; h: number }

type ThreeCtx = {
  THREE: typeof import('three')
  scene: import('three').Scene
  camera: import('three').PerspectiveCamera
  renderer: import('three').WebGLRenderer
  controls: import('three/examples/jsm/controls/OrbitControls.js').OrbitControls
  boxGroup: import('three').Group
}

// done = thùng ĐÃ XUẤT thật (nhặt lẻ chưa xác nhận KHÔNG tính).
// cpp/isPallet đi kèm để chế độ XE PALLET gom được hàng lên pallet mà không phải duyệt lại gdo.
// category = Loại hàng của mã — quyết định CÁCH LÊN XE (gộp chung / pallet riêng / lên nóc);
// topCarton = khối này là THÙNG rời nằm nóc ở chế độ xe pallet (không đếm vào số pallet).
type PlanGroup = LoadGroup & {
  done: number; cpp: number | null; isPallet: boolean
  category: string | null; topCarton?: boolean
  // Số lượng NGHIỆP VỤ + đơn vị tính của MÃ (user chốt 26/08: danh sách hiện "290 thùng" /
  // "200 cái" theo danh mục ĐVT, không hiện "2 pallet"). Không có (pallet gộp/Loscam) → đếm pallet.
  qty?: number; qtyDone?: number; qtyUnit?: string
  // mã KHÔNG có đơn vị "thùng" (base cái/kg) — pallet hoá phải tính theo tỷ lệ pallet, xem
  // `PalletizeInput.unitless` trong loadPlan.ts
  unitless?: boolean
  // Mốc quét ĐẦU TIÊN của mã (scanned_at) — tab Tiến độ xếp lại sơ đồ theo TRÌNH TỰ QUÉT THẬT
  // (user chốt 26/08: "dự toán là dự kiến, tiến độ là lên thực tế — có thể khác nhau")
  firstScanAt?: string | null
}

function disposeChildren(THREE: typeof import('three'), group: import('three').Group) {
  for (const child of [...group.children]) {
    group.remove(child)
    const mesh = child as import('three').Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material as (import('three').Material & { map?: import('three').Texture | null }) | import('three').Material[] | undefined
    if (Array.isArray(mat)) mat.forEach(m => m.dispose())
    else if (mat) { mat.map?.dispose?.(); mat.dispose() }
  }
}

// Sprite nhãn tên mảng hàng (canvas → texture) — canvas TỰ GIÃN theo độ dài chữ (hiện ĐỦ tên, không cắt)
function makeLabelSprite(THREE: typeof import('three'), text: string, color: string) {
  const font = 'bold 34px system-ui, sans-serif'
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = font
  const textW = measure.measureText(text).width
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(220, Math.ceil(textW) + 60)
  canvas.height = 96
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.strokeStyle = color; ctx.lineWidth = 6
  ctx.beginPath()
  ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 18)
  ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#0f172a'
  ctx.font = font
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
  const tex = new THREE.CanvasTexture(canvas)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }))
  return { sprite, aspect: canvas.width / canvas.height }
}

// Badge nhỏ tối màu — ký hiệu SỐ LỚP của 1 vùng chân (1 badge cho cả vùng cùng số lớp)
function makeBadgeSprite(THREE: typeof import('three'), text: string) {
  const font = 'bold 40px system-ui, sans-serif'
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = font
  const textW = measure.measureText(text).width
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(140, Math.ceil(textW) + 56)
  canvas.height = 88
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(15,23,42,0.88)'
  ctx.beginPath()
  ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 40)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = font
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
  const tex = new THREE.CanvasTexture(canvas)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }))
  return { sprite, aspect: canvas.width / canvas.height }
}

export function LoadPlan3DDialog({ open, onClose, gdo }: { open: boolean; onClose: () => void; gdo: GDO }) {
  const { data: sysSettings = [] } = useSystemSettings()
  const { mutateAsync: saveSetting, isPending: savingModels } = useUpdateSystemSetting()
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canManageModels = can(perms, 'wms_settings', 'manage_system')
  const truckModels: TruckModel[] = useMemo(() => {
    const v = sysSettings.find(s => s.key === 'truck_models')?.value
    return Array.isArray(v) ? (v as TruckModel[]) : []
  }, [sysSettings])

  // Cỡ thùng giả định cho mã chưa khai kích thước — cấu hình của ĐƠN VỊ (org_profile), không hardcode
  const assumedCarton = useAssumedCarton()

  const [tmName, setTmName] = useState('')       // tên dòng xe đang chọn / sẽ lưu
  const [tmError, setTmError] = useState('')
  const [boxL, setBoxL] = useState('')
  const [boxW, setBoxW] = useState('')
  const [boxH, setBoxH] = useState('')

  // ── XE PALLET (26/08) ─────────────────────────────────────────────────────
  // Phân vai user chốt: LOẠI XE giữ cờ pallet (cách vẽ) · BIỂN SỐ giữ kích thước (lòng thùng).
  // Chuyến đã có biển số ⇒ tra ĐÚNG biển đó trên server rồi tự điền — KHÔNG nạp cả đội xe về
  // trình duyệt (đo 26/08: 952 xe; luật danh mục lớn của CLAUDE.md).
  const plate = gdo.license_plate?.trim() || ''
  const { data: plateHit } = useTmsVehiclesPaged(
    { search: plate, page: 1, page_size: 5 }, open && plate.length > 0)
  const tripVehicle = useMemo(
    () => (plateHit?.items ?? []).find(v => v.license_plate === plate) ?? null,
    [plateHit, plate])
  const { data: vehicleTypes = [] } = useVehicleTypes(true)
  // Ô chọn ở đây CHỈ CÓ 2 MỤC: Xe thường / Xe pallet (user chốt 26/08 vòng 2 — liệt kê cả 7 loại
  // xe là thừa: chọn giữa XE SCA với CONTAINER không đổi gì cách vẽ, chỉ CỜ pallet mới đổi).
  // Danh mục Loại xe vẫn là NGUỒN của cờ — chuyến có biển số thì tự suy từ loại của xe đó;
  // `override` null = theo chuyến, true/false = người dùng đã tự chọn (xe vãng lai, ca đặc biệt).
  const [palletOverride, setPalletOverride] = useState<boolean | null>(null)
  // Chuyến CHƯA gắn biển số (đang lên kế hoạch — đúng lúc cần sơ đồ nhất) thì suy loại xe từ KẾ
  // HOẠCH VẬN CHUYỂN (`planned_vehicle_type`, khớp TÊN loại trong danh mục). Trước 26/08 chỉ suy
  // từ biển số nên mọi chuyến chưa gắn xe đều rơi về "Xe thường" — đo đơn thật 15/08: 55/95 chuyến
  // như vậy có kế hoạch khai XE PALLET, tức vẽ sai hẳn kiểu xe mà không ai biết.
  const planVtName = gdo.planned_vehicle_type?.trim().toUpperCase() ?? ''
  const planVt = planVtName ? vehicleTypes.find(t => t.name.trim().toUpperCase() === planVtName) ?? null : null
  const tripVt = vehicleTypes.find(t => t.id === tripVehicle?.vehicle_type_id) ?? planVt
  const vtSource: 'plate' | 'plan' | null = tripVehicle && tripVt ? 'plate' : tripVt ? 'plan' : null
  const isPalletTruck = palletOverride ?? (tripVt?.is_pallet_truck === true)

  // Kích thước pallet ĐÃ XẾP HÀNG. Lấy từ mã PALLET của đơn nếu đã khai (user chốt "kích thước
  // pallet cần phải khai nếu nó là pallet"); chưa khai thì để trống và nói rõ, KHÔNG bịa số.
  const [palL, setPalL] = useState(String(DEFAULT_PALLET.l))
  const [palW, setPalW] = useState(String(DEFAULT_PALLET.w))
  const [palH, setPalH] = useState(String(DEFAULT_PALLET.h))   // cao pallet khi đã xếp hàng
  const [maxStep, setMaxStep] = useState(0)
  const [mode, setMode] = useState<'plan' | 'progress'>('plan')   // Dự toán · Tiến độ
  // Nhãn: mặc định KHÔNG phủ hết (26 nhãn + dây dẫn = rối) — bấm mã ở panel để SOI từng khối;
  // nhãn luôn hiện cho khối đang xếp (bước hiện tại); checkbox bật hết khi cần.
  const [showLabels, setShowLabels] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const toggleSelect = (key: string) => setSelectedKeys(s => {
    const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n
  })
  const selKey = [...selectedKeys].sort().join('|')

  function pickTruckModel(name: string) {
    setTmName(name)
    setTmError('')
    const m = truckModels.find(x => x.name === name)
    setBoxL(m ? String(m.l) : '')
    setBoxW(m ? String(m.w) : '')
    setBoxH(m ? String(m.h) : '')
  }

  // Lưu dòng xe: trùng tên → ghi đè dims; tên mới → thêm vào sổ
  async function saveTruckModel() {
    const name = tmName.trim()
    const l = Number(boxL), w = Number(boxW), h = Number(boxH)
    if (!name) { setTmError('Nhập tên dòng xe trước khi lưu'); return }
    if (!(l > 0 && w > 0 && h > 0)) { setTmError('Nhập đủ D×R×C (mm) trước khi lưu'); return }
    const next = [...truckModels.filter(x => x.name !== name), { name, l, w, h }]
    try {
      await saveSetting({ key: 'truck_models', value: next })
      setTmError('')
    } catch { setTmError('Lưu dòng xe thất bại — thử lại') }
  }

  async function deleteTruckModel() {
    const name = tmName.trim()
    if (!truckModels.some(x => x.name === name)) return
    try {
      await saveSetting({ key: 'truck_models', value: truckModels.filter(x => x.name !== name) })
      setTmName(''); setTmError('')
    } catch { setTmError('Xóa dòng xe thất bại — thử lại') }
  }

  // Tự nhận xe của chuyến (26/08 vòng 3 — user: "biển số đã khai kích thước nhưng chưa được chọn"):
  // dialog GIỮ STATE qua các lần đóng/mở (không unmount, chỉ return null) nên phải áp lại MỖI LẦN
  // MỞ, không chỉ khi ô trống — vừa khai lòng thùng cho xe xong mở lại là phải thấy số mới.
  const appliedRef = useRef(false)
  useEffect(() => {
    if (!open) { appliedRef.current = false; return }
    setPalletOverride(null)   // mở lại = về theo loại của xe; đổi tay chỉ sống trong 1 lần mở
  }, [open])
  const tripHasDims = !!(tripVehicle?.box_length_mm && tripVehicle?.box_width_mm && tripVehicle?.box_height_mm)
  function applyTripDims() {
    if (!tripVehicle || !tripHasDims) return
    setBoxL(String(tripVehicle.box_length_mm))
    setBoxW(String(tripVehicle.box_width_mm))
    setBoxH(String(tripVehicle.box_height_mm))
    setTmName(`Xe ${tripVehicle.license_plate}`)
  }
  useEffect(() => {
    if (!open || !tripVehicle || appliedRef.current) return
    appliedRef.current = true   // đánh dấu cả khi xe chưa khai dims — không đè số gõ tay về sau
    if (tripVehicle.box_length_mm && tripVehicle.box_width_mm && tripVehicle.box_height_mm) {
      setBoxL(String(tripVehicle.box_length_mm))
      setBoxW(String(tripVehicle.box_width_mm))
      setBoxH(String(tripVehicle.box_height_mm))
      setTmName(`Xe ${tripVehicle.license_plate}`)
      setPicked({ key: '__trip__', label: `Xe của chuyến ${tripVehicle.license_plate}` })
    }
  }, [open, tripVehicle])

  // ── Ô CHỌN XE / DÒNG XE chuẩn (26/08 vòng 6 — user: "cần checkbox, search đúng chuẩn và
  // biển số xe hiện lên ở Chọn dòng xe"): SingleSelect server-search — gõ BIỂN SỐ tra danh mục
  // Vehicle (lấy lòng thùng đã khai ở Cài đặt TMS), dòng xe generic (truck_models) vẫn nằm chung
  // danh sách cho xe vãng lai/cont. Chọn = điền kích thước. ──
  const [picked, setPicked] = useState<{ key: string; label: string } | null>(null)
  const [pickSearch, setPickSearch] = useState('')
  const pickTerm = pickSearch.trim()
  // Nạp SẴN xe hệ thống đã khai lòng thùng (has_box=1 — vài chục xe, không dội cả đội ~950
  // chiếc; user chốt vòng 7: "chưa gõ đã phải thấy"); gõ biển thì tra thêm toàn đội.
  const { data: boxVehicles = [] } = useTmsVehiclesWithBox(open)
  const { data: pickHits, isFetching: pickLoading } = useTmsVehiclesPaged(
    { search: pickTerm, page: 1, page_size: 20 }, open && pickTerm.length > 0)
  const pickVehicles = useMemo(
    () => (pickTerm ? (pickHits?.items ?? []) : boxVehicles), [pickTerm, pickHits, boxVehicles])
  // Thứ tự user chốt: xe VÃNG LAI (dòng xe tự lưu) Ở TRÊN · xe HỆ THỐNG (biển số) Ở DƯỚI.
  const pickOptions: SingleSelectOption[] = useMemo(() => {
    const opts: SingleSelectOption[] = []
    if (tripHasDims && tripVehicle) opts.push({
      value: '__trip__', label: `Xe của chuyến ${tripVehicle.license_plate}`,
      sub: `${tripVehicle.box_length_mm}×${tripVehicle.box_width_mm}×${tripVehicle.box_height_mm}`,
    })
    const s = pickTerm.toLowerCase()
    for (const m of truckModels)
      if (!s || m.name.toLowerCase().includes(s))
        opts.push({ value: `tm:${m.name}`, label: m.name, sub: `${m.l}×${m.w}×${m.h}` })
    for (const v of pickVehicles) {
      if (tripHasDims && v.license_plate === plate) continue   // đã có mục "Xe của chuyến"
      const has = v.box_length_mm && v.box_width_mm && v.box_height_mm
      opts.push({
        value: `veh:${v.id}`, label: v.license_plate,
        sub: has ? `${v.box_length_mm}×${v.box_width_mm}×${v.box_height_mm}` : 'chưa khai lòng thùng',
        disabled: !has,   // xe chưa khai thì thấy được (biết đường đi khai) nhưng không chọn được
      })
    }
    return opts
  }, [tripHasDims, tripVehicle, pickVehicles, truckModels, pickTerm, plate])
  function onPick(val: string) {
    if (val === '__trip__') {
      applyTripDims()
      setPicked({ key: val, label: `Xe của chuyến ${plate}` })
      return
    }
    if (val.startsWith('veh:')) {
      const v = [...pickVehicles, ...boxVehicles].find(x => `veh:${x.id}` === val)
      if (!v?.box_length_mm || !v.box_width_mm || !v.box_height_mm) return
      setBoxL(String(v.box_length_mm)); setBoxW(String(v.box_width_mm)); setBoxH(String(v.box_height_mm))
      setTmName(`Xe ${v.license_plate}`)
      setPicked({ key: val, label: v.license_plate })
      return
    }
    const name = val.slice(3)
    pickTruckModel(name)
    setPicked({ key: val, label: name })
  }
  // Xe HỆ THỐNG (của chuyến / theo biển số): kích thước là DANH MỤC — không sửa tại đây
  // (sửa ở Cài đặt TMS → Số xe); muốn nhập tay thì bỏ chọn xe.
  const dimsLocked = picked != null && (picked.key === '__trip__' || picked.key.startsWith('veh:'))

  // Quy cách + màu pallet lấy từ DANH MỤC mã pallet (26/08 vòng 3): trước đây chỉ tra mã pallet
  // NẰM TRONG ĐƠN — đơn thường không có dòng Loscam nên màu user khai ở Mã hàng không bao giờ
  // được dùng. Nay: ưu tiên mã pallet trong đơn, không có thì lấy từ danh mục (chọn được khi
  // đơn vị có nhiều dạng pallet).
  const { data: palletMats = [] } = usePalletCarrierMaterials(open)
  const orderPalletMat = useMemo(() => {
    for (const d of gdo.delivery_orders ?? [])
      for (const it of d.items)
        if (it.material?.is_pallet_carrier) return it.material
    return null
  }, [gdo])
  const [palletMatId, setPalletMatId] = useState('')
  const activePalletMat = useMemo(() => {
    if (palletMatId) {
      const hit = palletMats.find(m => m.id === palletMatId)
      if (hit) return hit
    }
    if (orderPalletMat) return palletMats.find(m => m.id === orderPalletMat.id) ?? orderPalletMat
    return palletMats[0] ?? null
  }, [palletMatId, palletMats, orderPalletMat])

  const palSpec: PalletSpec | null = useMemo(() => {
    const h = Number(palH)
    if (!(h > 0)) return null
    // CHÂN pallet: từ quy cách của mã pallet (Material.carton_l/w) — mã chưa khai mới rơi về ô
    // nhập tay. Đế = carton_height_mm của mã pallet (Loscam khai 150); màu = Material.pallet_color.
    const mL = Number(activePalletMat?.carton_length_mm), mW = Number(activePalletMat?.carton_width_mm)
    const l = mL > 0 ? mL : Number(palL), w = mW > 0 ? mW : Number(palW)
    if (!(l > 0 && w > 0)) return null
    const baseH = Number(activePalletMat?.carton_height_mm) > 0 ? Number(activePalletMat!.carton_height_mm) : DEFAULT_PALLET.baseH
    return {
      l, w, h, baseH,
      baseColor: activePalletMat?.pallet_color ?? DEFAULT_PALLET.baseColor,
      // KL 1 pallet rỗng — cộng vào từng khối vì dòng Loscam trong đơn không còn vẽ thành khối riêng
      weightKg: Number(activePalletMat?.weight_kg) > 0 ? Number(activePalletMat!.weight_kg) : null,
    }
  }, [palL, palW, palH, activePalletMat])

  // Gom nhóm theo (ĐƠN × mã hàng) — kèm tiến độ đã xuất thật (realtime theo gdo).
  // Đây là NGUYÊN LIỆU: xe thường xếp thẳng mảng này, xe pallet gom nó lên pallet trước.
  const cartonGroups: PlanGroup[] = useMemo(() => {
    const map = new Map<string, PlanGroup>()
    for (const d of gdo.delivery_orders ?? []) {
      for (const it of d.items) {
        if (it.cartons_ordered <= 0) continue
        const code = it.material?.material_code ?? it.material_code_raw ?? '?'
        const key = `${d.delivery_code}|${code}`
        const hasDims = it.material?.carton_length_mm && it.material?.carton_width_mm && it.material?.carton_height_mm
        // BASE UNIT: 3D xếp THÙNG VẬT LÝ → quy đổi base ÷ hệ_số (làm tròn lên — thùng mở vẫn chiếm chỗ)
        const ordPhys = Math.ceil(qtyEntryDecimal(it.cartons_ordered, it.material))
        // Đã xuất thật = đã quét/ghi nhận − nhặt lẻ CHƯA xác nhận cuối
        const looseUnconfirmed = (it.scan_entries ?? [])
          .filter(s => s.is_loose_picking && !s.loose_confirmed)
          .reduce((sum, s) => sum + s.cartons_scanned, 0)
        const done = Math.max(0, Math.min(ordPhys, Math.floor(qtyEntryDecimal(it.cartons_scanned - looseUnconfirmed, it.material))))
        // Mốc quét đầu của mã — chỉ tính lượt ĐÃ ăn vào tiến độ (bỏ nhặt lẻ chưa xác nhận)
        const firstScanAt = (it.scan_entries ?? [])
          .filter(s => !(s.is_loose_picking && !s.loose_confirmed))
          .reduce<string | null>((min, s) => (min === null || s.scanned_at < min ? s.scanned_at : min), null)
        // Cỡ khối để VẼ — cửa duy nhất là `cartonBoxOf`: khai rồi thì dùng đúng khai; mã bán theo
        // cái chưa khai thì suy từ quy cách cái/pallet; hết đường mới rơi về cỡ thùng giả định.
        const unitless = !hasEntry(it.material)
        const cppNow = it.material?.cartons_per_pallet ?? null
        const box = cartonBoxOf(
          hasDims ? { l: Number(it.material!.carton_length_mm), w: Number(it.material!.carton_width_mm), h: Number(it.material!.carton_height_mm) } : null,
          cppNow, assumedCarton, palSpec ?? DEFAULT_PALLET, unitless)
        const cur = map.get(key)
        if (cur) {
          cur.count += ordPhys; cur.done += done
          if (firstScanAt && (!cur.firstScanAt || firstScanAt < cur.firstScanAt)) cur.firstScanAt = firstScanAt
          continue
        }
        map.set(key, {
          key,
          label: it.material?.short_name ?? it.material_code_raw ?? code,
          doKey: d.delivery_code,
          doLabel: d.distributor_name ? `${d.delivery_code} · ${d.distributor_name}` : d.delivery_code,
          count: ordPhys,
          done,
          l: box.l, w: box.w, h: box.h,
          weightKg: it.material?.weight_kg ?? null,
          assumed: !hasDims,
          maxLayers: it.material?.max_stack_layers ?? null,
          onTop: it.material?.stack_on_top ?? false,
          cpp: cppNow,
          isPallet: it.material?.is_pallet_carrier ?? false,
          category: it.material?.category ?? null,
          // SL nghiệp vụ + ĐVT theo DANH MỤC (unitLabel): mã có entry → thùng; không entry
          // (POSM quạt/bóng… đơn vị cái/EA) → nhãn của base_unit — KHÔNG gọi bừa "thùng"
          qty: ordPhys, qtyDone: done,
          qtyUnit: hasEntry(it.material) ? unitLabel(it.material?.entry_unit) : unitLabel(it.material?.base_unit),
          unitless,
          firstScanAt,
        })
      }
    }
    return [...map.values()]
  }, [gdo, assumedCarton, palSpec])

  const truckL = Number(boxL), truckW = Number(boxW), truckH = Number(boxH)
  const truckOk = truckL > 0 && truckW > 0 && truckH > 0

  // ── XE PALLET vs XE THƯỜNG (26/08) ────────────────────────────────────────
  // Xe pallet: gom hàng lên pallet rồi xếp PALLET (sức chứa nói bằng "16-17 pallet").
  // Xe thường: xếp từng thùng như cũ, và KHÔNG xếp khối pallet lên xe — nhưng nói ra là đã bỏ,
  // không im lặng nuốt mất một dòng hàng của đơn.
  // ── CÁCH LÊN XE theo (KHO × Loại hàng) — nhớ theo USER (user chốt 26/08 "lưu setting kho
  // rồi lưu theo user"): chọn 1 lần trong màn này, mọi chuyến sau của kho đó tự áp. ──
  const placements = useLoadPlanPrefsStore(s => s.placements)
  const setPlacement = useLoadPlanPrefsStore(s => s.setPlacement)
  const whId = gdo.warehouse_id
  const placeOf = (cat: string | null): LoadPlacement =>
    (cat && whId ? placements[`${whId}|${cat}`] ?? 'MIX' : 'MIX')
  const catList = useMemo(
    () => [...new Set(cartonGroups.filter(g => !g.isPallet && g.category).map(g => g.category as string))].sort(),
    [cartonGroups])
  // "Lên nóc" chỉ có nghĩa khi CÓ hàng khác làm nền. Chuyến toàn hàng khai "Lên nóc" mà vẫn ép
  // lên nóc thì không có mặt nào để đặt → sơ đồ TRỐNG TRƠN, ô "Xếp được" hiện 0/0 mà không một
  // dòng cảnh báo (bắt được trên đơn THẬT 15/08: 4 chuyến toàn FG02). Không có nền thì hàng đó
  // phải tự đứng pallet của nó — đúng thực tế xe chở toàn POSM.
  const hasBaseIn = (list: PlanGroup[]) =>
    list.some(g => !g.isPallet && g.count > 0 && placeOf(g.category) !== 'ON_TOP')
  const onTopActive = (g: PlanGroup, list: PlanGroup[]) =>
    !g.isPallet && placeOf(g.category) === 'ON_TOP' && hasBaseIn(list)
  const topNoBase = useMemo(
    () => isPalletTruck && !hasBaseIn(cartonGroups)
      && cartonGroups.some(g => !g.isPallet && g.count > 0 && placeOf(g.category) === 'ON_TOP'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isPalletTruck, cartonGroups, placements, whId])

  const palletized = useMemo(() => {
    if (!isPalletTruck || !palSpec) return null
    const items: PalletizeInput[] = cartonGroups
      // Loại hàng khai "Lên nóc" KHÔNG palletize — đi thẳng làm thùng rời nằm nóc (bên dưới).
      // Trừ khi chuyến KHÔNG có hàng nền: lúc đó chính nó phải lên pallet (xem `hasBaseIn`).
      .filter(g => !onTopActive(g, cartonGroups))
      .map(g => ({
        key: g.key, label: g.label, doKey: g.doKey, doLabel: g.doLabel,
        cartons: g.count, cartonsPerPallet: g.cpp, isPalletCarrier: g.isPallet,
        weightKg: g.weightKg,
        // Cao pallet tính từ thùng × quy cách — mã chưa khai thì dùng CỠ GIẢ ĐỊNH kèm nhãn
        // (user chốt vòng 7: quy cách 140 vs 216 thùng/pallet phải ra chiều cao KHÁC NHAU,
        // đồng cao 1650 hết là sai; nhãn "cỡ giả định" vẫn giữ để biết số là ước lượng).
        carton: { l: g.l, w: g.w, h: g.h },
        assumed: g.assumed, unitless: g.unitless,
        // "Pallet riêng": phần dư của loại này gom bể riêng, không trộn pallet lẻ chung
        remPool: !g.isPallet && g.category && placeOf(g.category) === 'OWN_PALLET'
          ? { key: g.category, label: g.category } : undefined,
      }))
    const res = palletizeGroups(items, palSpec)
    // Tiến độ theo TỶ LỆ đã xuất của chính mã đó (pallet gộp không quy được về 1 mã → 0)
    const srcByKey = new Map(cartonGroups.map(g => [g.key, g]))
    const withDone: PlanGroup[] = res.groups.map(g => {
      const src = srcByKey.get(g.key.replace(/\|(full|plt)$/, ''))
      const r = src && src.count > 0 ? src.done / src.count : 0
      return {
        ...g, done: Math.floor(g.count * r), cpp: null, isPallet: false, category: null,
        // Dòng pallet NGUYÊN của 1 mã: danh sách hiện SL + ĐVT của mã đó (pallet gộp không quy
        // được về 1 mã → để trống, hiện số pallet)
        qty: src?.qty, qtyDone: src?.qtyDone, qtyUnit: src?.qtyUnit,
      }
    })
    return { ...res, groups: withDone }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPalletTruck, palSpec, cartonGroups, placements, whId])

  // Nhóm THỰC SỰ đưa vào thuật toán xếp: xe pallet = khối pallet + THÙNG RỜI của loại "Lên nóc"
  // (onTop — thuật toán tự đặt lên nóc các khối, không chiếm chỗ pallet trên sàn)
  const groups: PlanGroup[] = useMemo(() => {
    if (isPalletTruck) {
      const top = cartonGroups
        .filter(g => onTopActive(g, cartonGroups))
        .map(g => ({ ...g, onTop: true, topCarton: true }))
      return [...(palletized?.groups ?? []), ...top]
    }
    return cartonGroups.filter(g => !g.isPallet)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPalletTruck, palletized, cartonGroups, placements, whId])

  const droppedPallets = useMemo(
    () => (isPalletTruck ? [] : cartonGroups.filter(g => g.isPallet)), [isPalletTruck, cartonGroups])

  // Pallet có vừa lòng xe không — báo NGAY, đừng để thuật toán im lặng xếp được 0 cái
  const palFitErr = useMemo(
    () => (isPalletTruck && palSpec && truckOk
      ? palletFitError(palSpec, { length: truckL, width: truckW, height: truckH }) : null),
    [isPalletTruck, palSpec, truckOk, truckL, truckW, truckH])
  // Pallet đầy cao TÍNH TỪ THÙNG (mỗi mã một khác) — khối nào vượt lòng xe phải báo TÊN ngay,
  // không để thuật toán im lặng bỏ lại rồi hiện "xếp được N/M" khó hiểu.
  const tooTall = useMemo(
    () => (isPalletTruck && palletized && truckOk
      ? palletsTooTall(palletized.groups, { length: truckL, width: truckW, height: truckH }) : []),
    [isPalletTruck, palletized, truckOk, truckL, truckW, truckH])
  const floorSlots = useMemo(
    () => (isPalletTruck && palSpec && truckOk && !palFitErr
      ? palletFloorSlots(palSpec, { length: truckL, width: truckW, height: truckH }) : 0),
    [isPalletTruck, palSpec, truckOk, truckL, truckW, truckH, palFitErr])

  const plan: LoadPlan | null = useMemo(() => {
    if (!truckOk || !groups.length || palFitErr) return null
    const truck = { length: truckL, width: truckW, height: truckH }
    // Thùng "Lên nóc" (topCarton) KHÔNG đi qua thuật toán thùng-sàn (nó dựng tháp lẻ loi khi
    // trộn với pallet): xếp pallet trước (count 0 giữ nguyên CHỈ SỐ nhóm cho nhãn/màu), rồi
    // rải thùng lên MẶT các pallet bằng spreadOnTopOfPallets.
    const topIdx = groups.map((g, i) => (g.topCarton ? i : -1)).filter(i => i >= 0)
    if (!topIdx.length) return computeLoadPlan(truck, groups)
    const base = computeLoadPlan(truck, groups.map(g => (g.topCarton ? { ...g, count: 0 } : g)))
    return spreadOnTopOfPallets(base, topIdx, groups)
  }, [truckOk, truckL, truckW, truckH, groups, palFitErr])

  // ── TAB TIẾN ĐỘ = xếp lại theo TRÌNH TỰ QUÉT THẬT (user chốt 26/08): mã quét trước nằm
  // sâu phía cabin; số lượng = phần ĐÃ quét. Khác hẳn Dự toán — không tô lại vị trí dự kiến. ──
  const progressPlan = useMemo(() => {
    if (mode !== 'progress' || !truckOk || palFitErr) return null
    const scanned: PlanGroup[] = cartonGroups
      .filter(g => !g.isPallet && g.done > 0)
      .map(g => ({ ...g, count: g.done }))
      .sort((a, b) => ((a.firstScanAt ?? '9999') < (b.firstScanAt ?? '9999') ? -1 : 1))
    if (!scanned.length) return null
    let effGroups: PlanGroup[] = scanned
    if (isPalletTruck && palSpec) {
      const items: PalletizeInput[] = scanned
        .filter(g => !onTopActive(g, scanned))
        .map(g => ({
          key: g.key, label: g.label, doKey: g.doKey, doLabel: g.doLabel,
          cartons: g.count, cartonsPerPallet: g.cpp, isPalletCarrier: false,
          weightKg: g.weightKg, carton: { l: g.l, w: g.w, h: g.h }, assumed: g.assumed,
          unitless: g.unitless,
          remPool: g.category && placeOf(g.category) === 'OWN_PALLET'
            ? { key: g.category, label: g.category } : undefined,
        }))
      const res = palletizeGroups(items, palSpec)
      const srcByKey = new Map(scanned.map(g => [g.key, g]))
      const pal: PlanGroup[] = res.groups.map(g => {
        const src = srcByKey.get(g.key.replace(/\|(full|plt)$/, ''))
        return { ...g, done: g.count, cpp: null, isPallet: false, category: null,
          qty: src?.qty, qtyDone: src?.qtyDone, qtyUnit: src?.qtyUnit }
      })
      const top = scanned
        .filter(g => onTopActive(g, scanned))
        .map(g => ({ ...g, onTop: true, topCarton: true }))
      effGroups = [...pal, ...top]
    }
    // computeLoadPlan sắp lại nhóm theo (đơn → diện tích → cỡ) — sẽ ĐẢO mất trình tự quét.
    // Gắn doKey TUẦN TỰ theo thứ tự quét để trình xếp tôn trọng đúng thứ tự đó (doLabel giữ
    // nguyên cho nhãn; pooling pallet lẻ đã chạy TRƯỚC bằng doKey thật nên không ảnh hưởng).
    effGroups = effGroups.map((g, i) => ({ ...g, doKey: `${String(i).padStart(3, '0')}|${g.doKey}` }))
    const truck = { length: truckL, width: truckW, height: truckH }
    const topIdx = effGroups.map((g, i) => (g.topCarton ? i : -1)).filter(i => i >= 0)
    const base = computeLoadPlan(truck, topIdx.length
      ? effGroups.map(g => (g.topCarton ? { ...g, count: 0 } : g)) : effGroups)
    const p = topIdx.length ? spreadOnTopOfPallets(base, topIdx, effGroups) : base
    return { plan: p, groups: effGroups }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, truckOk, truckL, truckW, truckH, palFitErr, cartonGroups, isPalletTruck, palSpec, placements, whId])

  // Sơ đồ đang VẼ: Tiến độ có hàng đã quét → plan xếp-theo-quét; còn lại → plan Dự toán
  const progressActive = mode === 'progress' && progressPlan != null
  const viewPlan = progressActive ? progressPlan.plan : plan
  const viewGroups: PlanGroup[] = progressActive ? progressPlan.groups : groups

  useEffect(() => { setMaxStep(plan?.stepCount ?? 0) }, [plan?.stepCount])

  const assumedCount = groups.filter(g => g.assumed).length
  const sumDone = groups.reduce((s, g) => s + g.done, 0)
  // Chế độ xe pallet: mỗi KHỐI trên sơ đồ là 1 PALLET — trừ loại "Lên nóc" là THÙNG rời;
  // có lẫn cả hai thì chữ chung dùng "khối", nhãn từng nhóm vẫn nói đúng pallet/thùng.
  const topGroups = isPalletTruck ? groups.filter(g => g.topCarton) : []
  const topCount = topGroups.reduce((s, g) => s + g.count, 0)
  // ĐVT của hàng lên nóc lấy theo DANH MỤC (POSM đếm "cái") — cùng một ĐVT thì nói đúng tên,
  // lẫn nhiều ĐVT mới nói chung là "khối"
  const topUnit = [...new Set(topGroups.map(g => g.qtyUnit ?? 'thùng'))].length === 1
    ? topGroups[0].qtyUnit ?? 'thùng' : 'khối'
  const unitWord = isPalletTruck ? (topCount > 0 ? 'khối' : 'pallet') : 'thùng'

  // Tiến độ hiển thị: thứ tự "đã xuất" đi theo đúng thứ tự xếp của kế hoạch (ordinal trong nhóm)
  const ordinals = useMemo(() => {
    if (!plan) return []
    const counters = new Map<number, number>()
    return plan.placed.map(b => {
      const n = counters.get(b.group) ?? 0
      counters.set(b.group, n + 1)
      return n
    })
  }, [plan])

  // ── Three.js ────────────────────────────────────────────────────────────────
  const mountRef = useRef<HTMLDivElement>(null)
  const ctxRef = useRef<ThreeCtx | null>(null)
  const [ready, setReady] = useState(false)
  const camKeyRef = useRef('')

  useEffect(() => {
    if (!open) return
    let disposed = false
    let raf = 0
    const mount = mountRef.current
    if (!mount) return
    ;(async () => {
      const THREE = await import('three')
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
      if (disposed || !mountRef.current) return
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0xf1f5f9)
      const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / Math.max(1, mount.clientHeight), 1, 100000)
      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      mount.appendChild(renderer.domElement)
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.zoomToCursor = true            // zoom TỰ DO về vị trí con trỏ (không chỉ zoom vào tâm)
      controls.screenSpacePanning = true      // kéo pan theo mặt phẳng màn hình → soi mọi góc xe
      scene.add(new THREE.AmbientLight(0xffffff, 0.75))
      const dir = new THREE.DirectionalLight(0xffffff, 0.9)
      dir.position.set(1, 2, 1.2)
      scene.add(dir)
      const boxGroup = new THREE.Group()
      scene.add(boxGroup)
      ctxRef.current = { THREE, scene, camera, renderer, controls, boxGroup }
      camKeyRef.current = ''
      setReady(true)
      const loop = () => { if (disposed) return; controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop) }
      loop()
    })()
    const onResize = () => {
      const c = ctxRef.current
      if (!c || !mountRef.current) return
      const { clientWidth: w, clientHeight: h } = mountRef.current
      c.camera.aspect = w / Math.max(1, h)
      c.camera.updateProjectionMatrix()
      c.renderer.setSize(w, h)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(mount)
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      const c = ctxRef.current
      if (c) {
        disposeChildren(c.THREE, c.boxGroup)
        c.controls.dispose()
        c.renderer.dispose()
        c.renderer.domElement.remove()
      }
      ctxRef.current = null
      setReady(false)
    }
  }, [open])

  // Vẽ lại khung xe + thùng khi plan / bước / chế độ đổi (KHÔNG tạo lại renderer)
  useEffect(() => {
    const c = ctxRef.current
    if (!ready || !c) return
    const { THREE, boxGroup } = c
    disposeChildren(THREE, boxGroup)
    const dPlan = viewPlan          // Tiến độ có hàng quét → plan xếp-theo-trình-tự-quét
    const dGroups = viewGroups
    if (!dPlan) return
    const { length: L, width: W, height: H } = dPlan.truck
    const toX = (x: number, l: number) => x + l / 2 - L / 2
    const toY = (z: number, h: number) => z + h / 2
    const toZ = (y: number, w: number) => y + w / 2 - W / 2

    // Khung lòng thùng xe + sàn + khối cabin
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(L, H, W)),
      new THREE.LineBasicMaterial({ color: 0x475569 }),
    )
    frame.position.set(0, H / 2, 0)
    boxGroup.add(frame)
    const floor = new THREE.Mesh(new THREE.BoxGeometry(L, 20, W), new THREE.MeshLambertMaterial({ color: 0xcbd5e1 }))
    floor.position.set(0, -10, 0)
    boxGroup.add(floor)

    // ĐẦU XE TẢI (stylized) — chỉ để nhận hướng đầu xe: TÁCH XA thùng + tông XÁM NHẠT trong suốt
    // (không màu sắc — thùng hàng phải nổi rõ nhất)
    const ghostMat = new THREE.MeshLambertMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.4 })
    const ghostMat2 = new THREE.MeshLambertMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.35 })
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x94a3b8 })
    const cabLen = Math.min(1600, L * 0.25), cabW = W * 0.94, cabH = H * 0.62
    const cabX = -L / 2 - 550 - cabLen / 2   // tách hẳn khỏi thùng hàng
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(cabLen, cabH, cabW), ghostMat)
    cabin.position.set(cabX, cabH / 2, 0)
    boxGroup.add(cabin)
    const cabEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(cabLen, cabH, cabW)), edgeMat)
    cabEdge.position.copy(cabin.position)
    boxGroup.add(cabEdge)
    // Kính lái (mặt trước cabin)
    const glass = new THREE.Mesh(new THREE.BoxGeometry(30, cabH * 0.38, cabW * 0.85), ghostMat2)
    glass.position.set(cabX - cabLen / 2 - 15, cabH * 0.68, 0)
    boxGroup.add(glass)
    // Mũi xe (hood) thấp phía trước
    const noseLen = cabLen * 0.45
    const nose = new THREE.Mesh(new THREE.BoxGeometry(noseLen, cabH * 0.42, cabW), ghostMat)
    nose.position.set(cabX - cabLen / 2 - noseLen / 2, cabH * 0.21, 0)
    boxGroup.add(nose)
    const noseEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(noseLen, cabH * 0.42, cabW)), edgeMat)
    noseEdge.position.copy(nose.position)
    boxGroup.add(noseEdge)
    // Bánh xe — xám mờ, 1 cặp dưới cabin + 2 cặp cuối thùng
    const wheelR = Math.min(500, H * 0.22)
    const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, 300, 18)
    const wheelXs = [cabX, L / 2 - 900, L / 2 - 900 - wheelR * 2.4]
    for (const wx of wheelXs) for (const side of [-1, 1]) {
      const wheel = new THREE.Mesh(wheelGeo, ghostMat2)
      wheel.rotation.x = Math.PI / 2
      wheel.position.set(wx, -wheelR * 0.4, side * (W / 2 - 160))
      boxGroup.add(wheel)
    }

    // Chọn thùng hiển thị theo chế độ:
    //  - Dự toán: theo thanh trượt (step ≤ maxStep); phần đã xuất thật → MỜ; chân đang xếp (step=maxStep) → SÁNG.
    //  - Tiến độ: CHỈ thùng đã xuất thật (ordinal trong nhóm < done), theo đúng thứ tự xếp.
    type Kind = 'normal' | 'done' | 'current'
    const buckets = new Map<string, { boxes: { b: (typeof dPlan.placed)[number] }[]; gi: number; kind: Kind }>()
    dPlan.placed.forEach((b, i) => {
      const g = dGroups[b.group]
      let show = false, kind: Kind = 'normal'
      if (mode === 'progress') {
        // Plan tiến độ CHỈ chứa hàng đã quét → hiện hết; fallback (chưa quét gì) giữ lọc cũ
        show = progressActive ? true : ordinals[i] < g.done
      } else {
        show = b.step <= maxStep
        if (ordinals[i] < g.done) kind = 'done'
        if (b.step === maxStep) kind = 'current'
      }
      if (!show) return
      const bk = `${b.group}|${kind}`
      if (!buckets.has(bk)) buckets.set(bk, { boxes: [], gi: b.group, kind })
      buckets.get(bk)!.boxes.push({ b })
    })

    // Spotlight: có mã đang CHỌN từ panel → khối khác chìm mờ, khối chọn nổi
    const spotlight = selectedKeys.size > 0
    const visibleByGroup = new Map<number, { cx: number; cy: number; top: number; n: number }>()
    for (const { boxes, gi, kind } of buckets.values()) {
      const color = new THREE.Color(GROUP_COLORS[gi % GROUP_COLORS.length])
      const dimmed = spotlight && !selectedKeys.has(dGroups[gi].key)
      const mat = new THREE.MeshLambertMaterial({
        color,
        transparent: dimmed || kind === 'done',
        opacity: dimmed ? 0.07 : kind === 'done' ? 0.28 : 1,
        emissive: !dimmed && (kind === 'current' || (spotlight && selectedKeys.has(dGroups[gi].key))) ? color : new THREE.Color(0x000000),
        emissiveIntensity: kind === 'current' ? 0.45 : spotlight && !dimmed ? 0.2 : 0,
      })
      // ĐẾ PALLET (26/08): khối pallet vẽ 2 phần — đế MÀU RIÊNG đồng nhất (phân biệt rõ, user
      // chốt) + hàng phía trên mang màu nhóm. Loscam rỗng: cả khối là đế. Khối thường: 1 phần.
      const base = dGroups[gi].base
      const baseH = base ? Math.min(base.h, ...boxes.map(({ b }) => b.h)) : 0
      const goods = boxes.filter(({ b }) => b.h - baseH > 1)
      const mkInst = (mesh: import('three').InstancedMesh, list: typeof boxes,
                      zOff: number, hOf: (bh: number) => number) => {
        const m = new THREE.Matrix4()
        list.forEach(({ b }, i) => {
          const hh = hOf(b.h)
          m.makeScale(Math.max(1, b.l - 10), Math.max(1, hh - 8), Math.max(1, b.w - 10))   // hở nhìn rõ từng khối
          m.setPosition(toX(b.x, b.l), toY(b.z + zOff, hh), toZ(b.y, b.w))
          mesh.setMatrixAt(i, m)
        })
        mesh.instanceMatrix.needsUpdate = true
        boxGroup.add(mesh)
      }
      if (base && baseH > 0) {
        // Đế: cùng chế độ chìm/mờ với khối (spotlight/done) nhưng KHÔNG phát sáng — đế là mốc
        // nhìn, không phải thứ đang thao tác.
        const baseMat = new THREE.MeshLambertMaterial({
          color: new THREE.Color(base.color),
          transparent: dimmed || kind === 'done',
          opacity: dimmed ? 0.07 : kind === 'done' ? 0.28 : 1,
        })
        // PALLET 4 CỔNG (user chốt 26/08): đế vẽ 2 tầng — MẶT pallet (ván trên) + 9 CHÂN xếp
        // lưới 3×3, để HỞ LỖ càng xe nâng ở CẢ 4 PHÍA cho trực quan, thay cho khối đặc cũ.
        const deckH = Math.max(20, baseH * 0.35)
        const blockH = baseH - deckH
        mkInst(new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), baseMat, boxes.length),
          boxes, blockH, () => deckH)
        if (blockH > 4) {
          const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), baseMat, boxes.length * 9)
          const lm = new THREE.Matrix4()
          let li = 0
          for (const { b } of boxes) {
            const bl = Math.max(40, b.l * 0.16), bw = Math.max(40, b.w * 0.19)   // cỡ chân ~ Loscam 3×3
            const xs = [b.x + bl / 2 + 5, b.x + b.l / 2, b.x + b.l - bl / 2 - 5]
            const ys = [b.y + bw / 2 + 5, b.y + b.w / 2, b.y + b.w - bw / 2 - 5]
            for (const cx of xs) for (const cy of ys) {
              lm.makeScale(bl, Math.max(1, blockH - 2), bw)
              lm.setPosition(toX(cx, 0), toY(b.z, blockH), toZ(cy, 0))
              legs.setMatrixAt(li++, lm)
            }
          }
          legs.instanceMatrix.needsUpdate = true
          boxGroup.add(legs)
        }
        if (goods.length)
          mkInst(new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, goods.length),
            goods, baseH, bh => bh - baseH)
      } else {
        mkInst(new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, boxes.length),
          boxes, 0, bh => bh)
      }
      boxes.forEach(({ b }) => {
        const agg = visibleByGroup.get(gi) ?? { cx: 0, cy: 0, top: 0, n: 0 }
        agg.cx += b.x + b.l / 2; agg.cy += b.y + b.w / 2
        agg.top = Math.max(agg.top, b.z + b.h); agg.n++
        visibleByGroup.set(gi, agg)
      })
    }

    // Nhãn tên MẢNG hàng — GOM VÀO 1 MẶT PHẲNG (băng nhãn trên nóc xe, z=0), dàn không đè nhau.
    // Chỉ vẽ nhãn cho: mã đang CHỌN (spotlight) + khối của BƯỚC hiện tại; bật "tất cả nhãn" mới vẽ hết.
    const curStepGi = mode === 'plan' && maxStep > 0 ? dPlan.placed.find(b => b.step === maxStep)?.group ?? -1 : -1
    const labelGis = [...visibleByGroup.keys()].filter(gi =>
      showLabels || selectedKeys.has(dGroups[gi].key) || gi === curStepGi)
    if (labelGis.length) {
      const labelH = 240
      const entries = labelGis
        .map(gi => [gi, visibleByGroup.get(gi)!] as const)
        .map(([gi, agg]) => {
          const g = dGroups[gi]
          const gUnit = isPalletTruck && !g.topCarton ? 'pallet' : (g.qtyUnit ?? 'thùng')
          const countTxt = mode === 'progress' ? `${g.done} ${gUnit}` : (g.done > 0 ? `${g.done}/${g.count} ${gUnit}` : `${g.count} ${gUnit}`)
          const { sprite, aspect } = makeLabelSprite(THREE, `${g.label} · ${countTxt}`, GROUP_COLORS[gi % GROUP_COLORS.length])
          return {
            gi, sprite, w: labelH * aspect,
            bx: toX(agg.cx / agg.n, 0), bz: toZ(agg.cy / agg.n, 0), btop: agg.top,
          }
        })
        .sort((a, b) => a.bx - b.bx)   // theo vị trí khối dọc thân xe
      const GAP = 150
      const rowY = [H + 380, H + 380 + labelH + 60, H + 380 + (labelH + 60) * 2]
      const rowCursor = rowY.map(() => -Infinity)
      for (const e of entries) {
        // Chọn hàng đặt được gần vị trí khối nhất (không chồng nhãn trước đó trong hàng)
        let best = 0, bestX = 0, bestDist = Infinity
        for (let r = 0; r < rowY.length; r++) {
          const x = Math.max(e.bx, rowCursor[r] + GAP + e.w / 2)
          const dist = Math.abs(x - e.bx) + r * 50   // ưu tiên hàng thấp khi ngang nhau
          if (dist < bestDist) { bestDist = dist; best = r; bestX = x }
        }
        rowCursor[best] = bestX + e.w / 2
        const y = rowY[best]
        e.sprite.position.set(bestX, y, 0)
        e.sprite.scale.set(e.w, labelH, 1)
        boxGroup.add(e.sprite)
        // Đường dẫn từ đáy nhãn → nóc khối + mũi tên cone
        const color = GROUP_COLORS[e.gi % GROUP_COLORS.length]
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(bestX, y - labelH / 2, 0), new THREE.Vector3(e.bx, e.btop + 140, e.bz),
        ])
        boxGroup.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color })))
        const cone = new THREE.Mesh(new THREE.ConeGeometry(50, 120, 10), new THREE.MeshLambertMaterial({ color }))
        cone.position.set(e.bx, e.btop + 80, e.bz)
        cone.rotation.x = Math.PI
        boxGroup.add(cone)
      }
    }

    // KÝ HIỆU SỐ LỚP theo VÙNG: gom chân theo số lớp — vùng liền nhau cùng số lớp = 1 badge;
    // khu vực có số lớp KHÁC → badge riêng (không ghi từng chân).
    {
      const colInfo = new Map<string, { cx: number; cy: number; count: number; top: number }>()
      for (const bk of buckets.values()) for (const { b } of bk.boxes) {
        const k = `${b.x}|${b.y}`
        const c = colInfo.get(k) ?? { cx: b.x + b.l / 2, cy: b.y + b.w / 2, count: 0, top: 0 }
        c.count++
        c.top = Math.max(c.top, b.z + b.h)
        colInfo.set(k, c)
      }
      const byCount = new Map<number, { cx: number; cy: number; top: number }[]>()
      for (const c of colInfo.values()) {
        if (!byCount.has(c.count)) byCount.set(c.count, [])
        byCount.get(c.count)!.push(c)
      }
      for (const [count, colsOfCount] of byCount) {
        // cụm theo x liền kề (hở > 1200mm = vùng mới)
        const sorted = [...colsOfCount].sort((a, b) => a.cx - b.cx)
        const clusters: typeof sorted[] = []
        for (const c of sorted) {
          const last = clusters[clusters.length - 1]
          if (last && c.cx - last[last.length - 1].cx <= 1200) last.push(c)
          else clusters.push([c])
        }
        for (const cl of clusters) {
          const mx = cl.reduce((s, c) => s + c.cx, 0) / cl.length
          const my = cl.reduce((s, c) => s + c.cy, 0) / cl.length
          const mtop = Math.max(...cl.map(c => c.top))
          const { sprite, aspect } = makeBadgeSprite(THREE, `${count} lớp`)
          sprite.position.set(toX(mx, 0), mtop + 130, toZ(my, 0))
          const bh = 170
          sprite.scale.set(bh * aspect, bh, 1)
          boxGroup.add(sprite)
        }
      }
    }

    // Camera lần đầu / khi đổi cỡ xe
    const camKey = `${L}x${W}x${H}`
    if (camKeyRef.current !== camKey) {
      camKeyRef.current = camKey
      c.camera.position.set(L * 0.75, H * 2.1, W * 2.6)
      c.camera.near = Math.max(1, L / 500)
      c.camera.far = L * 30
      c.camera.updateProjectionMatrix()
      c.controls.target.set(0, H / 3, 0)
      c.controls.update()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, viewPlan, viewGroups, progressActive, maxStep, mode, showLabels, ordinals, selKey])

  if (!open) return null

  const currentGroup = plan && maxStep > 0
    ? plan.groups[plan.placed.find(b => b.step === maxStep)?.group ?? -1]
    : null
  const currentColCount = plan ? plan.placed.filter(b => b.step === maxStep).length : 0
  const doLabels = [...new Set(groups.map(g => g.doLabel))]
  const hasManyDos = doLabels.length > 1
  // Thống kê theo chế độ: Tiến độ = chỉ phần đã xuất
  const doneVol = groups.reduce((s, g) => s + g.done * g.l * g.w * g.h, 0)
  const truckVol = truckOk ? truckL * truckW * truckH : 0
  const doneVolPct = truckVol > 0 ? Math.round((doneVol / truckVol) * 1000) / 10 : 0
  const doneWeight = Math.round(groups.reduce((s, g) => s + g.done * (g.weightKg ?? 0), 0))

  return (
    <div className="fixed inset-0 z-[120] bg-white flex flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 border-b bg-slate-900 text-white px-3 py-2">
        <Boxes className="h-4 w-4 text-sky-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">Sơ đồ xếp xe 3D — {gdo.group_code}</p>
          <p className="text-[10px] text-slate-400 truncate">Xếp từ trong cabin ra cửa · thùng cùng mã chồng thành cột · kéo để xoay, lăn chuột để zoom</p>
        </div>
        {/* Switch chế độ Dự toán / Tiến độ */}
        <div className="flex rounded-lg overflow-hidden border border-white/20 text-[11px] shrink-0">
          <button onClick={() => setMode('plan')}
            className={`px-2.5 py-1 ${mode === 'plan' ? 'bg-sky-500 text-white' : 'text-slate-300 hover:bg-white/10'}`}>Dự toán</button>
          <button onClick={() => setMode('progress')}
            className={`px-2.5 py-1 ${mode === 'progress' ? 'bg-green-600 text-white' : 'text-slate-300 hover:bg-white/10'}`}>Tiến độ</button>
        </div>
        <Button size="sm" variant="ghost" className="text-slate-300 hover:text-white hover:bg-white/10" onClick={onClose}>
          <X className="h-4 w-4" /><span className="hidden sm:inline ml-1">Đóng</span>
        </Button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Canvas 3D */}
        <div className="flex-1 min-h-0 relative">
          <div ref={mountRef} className="absolute inset-0" />
          {!plan && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
              <p className="text-sm text-slate-500 px-6 text-center">
                {cartonGroups.length === 0 ? 'Chuyến chưa có mã hàng nào có số lượng thùng.' : 'Chọn loại xe và nhập kích thước lòng thùng (mm) để dựng sơ đồ.'}
              </p>
            </div>
          )}
          {plan && mode === 'progress' && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-green-600/95 text-white text-[11px] rounded-full px-3 py-1 shadow">
              Tiến độ thực tế: đã xuất <b className="tabular-nums">{sumDone}/{plan.totalCount}</b> {unitWord}
              {sumDone === 0 && ' — chưa quét thùng nào'}
            </div>
          )}
          {/* Thanh bước — chỉ chế độ Dự toán */}
          {plan && plan.stepCount > 0 && mode === 'plan' && (
            <div className="absolute left-1/2 -translate-x-1/2 bottom-2 w-[min(560px,92%)] bg-white/95 border border-slate-200 rounded-xl shadow-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 w-7 p-0 shrink-0" disabled={maxStep <= 0} onClick={() => setMaxStep(s => Math.max(0, s - 1))}><ChevronLeft className="h-4 w-4" /></Button>
                <input type="range" min={0} max={plan.stepCount} value={maxStep} onChange={e => setMaxStep(Number(e.target.value))} className="flex-1 accent-sky-600" />
                <Button size="sm" variant="outline" className="h-7 w-7 p-0 shrink-0" disabled={maxStep >= plan.stepCount} onClick={() => setMaxStep(s => Math.min(plan.stepCount, s + 1))}><ChevronRight className="h-4 w-4" /></Button>
              </div>
              <p className="text-[11px] text-center text-slate-600 mt-0.5">
                {maxStep === 0
                  ? 'Xe trống — bấm ▶ để xem thứ tự xếp từng cột'
                  : <>Bước <b className="tabular-nums">{maxStep}/{plan.stepCount}</b>{currentGroup && <> — xếp <b>{currentColCount} {unitWord}</b> · <span className="font-medium">{currentGroup.label}</span>{hasManyDos && <span className="text-slate-400"> · {currentGroup.doLabel}</span>} (chân sáng)</>}</>}
              </p>
            </div>
          )}
        </div>

        {/* Panel điều khiển */}
        <div className="shrink-0 lg:w-80 max-h-[45%] lg:max-h-none border-t lg:border-t-0 lg:border-l bg-white overflow-y-auto p-3 space-y-3">
          {/* ── KIỂU XẾP XE — CHỈ 2 MỤC (user chốt 26/08 vòng 2): liệt kê cả 7 loại xe là thừa,
              chọn giữa XE SCA với CONTAINER không đổi gì cách vẽ, chỉ CỜ pallet mới đổi. Chuyến
              có biển số → tự suy từ loại của xe; 2 nút để đổi tay (xe vãng lai / ca đặc biệt). ── */}
          <div className="space-y-1">
            <Label className="text-xs">Kiểu xếp xe</Label>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" onClick={() => setPalletOverride(false)}
                className={`h-9 rounded-md border text-xs font-medium transition-colors ${!isPalletTruck
                  ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>
                Xe thường
                <span className="block text-[9px] font-normal opacity-70">xếp từng thùng</span>
              </button>
              <button type="button" onClick={() => setPalletOverride(true)}
                className={`h-9 rounded-md border text-xs font-medium transition-colors ${isPalletTruck
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>
                Xe pallet
                <span className="block text-[9px] font-normal opacity-70">gom hàng lên pallet</span>
              </button>
            </div>
            {tripVt && vtSource && (
              <p className="text-[10px] text-slate-400">
                {palletOverride === null || palletOverride === (tripVt.is_pallet_truck === true)
                  ? (vtSource === 'plate'
                      ? <>Tự nhận từ biển số <b>{tripVehicle!.license_plate}</b> — loại {tripVt.name}.</>
                      : <>Chuyến chưa gắn xe — tự nhận theo <b>kế hoạch vận chuyển</b>: loại {tripVt.name}.</>)
                  : <>Đang chọn KHÁC với loại {tripVt.name} {vtSource === 'plate'
                        ? <>của xe <b>{tripVehicle!.license_plate}</b></> : <>theo kế hoạch</>}{' '}
                      <button type="button" className="underline hover:text-slate-600"
                        onClick={() => setPalletOverride(null)}>— về theo xe</button></>}
              </p>
            )}
          </div>

          {/* ── Quy cách pallet: lấy từ MÃ PALLET trong danh mục (chân + đế + màu) — chỉ hỏi tay
              khi danh mục chưa khai (26/08 vòng 3: user hỏi "ô này để làm gì vì pallet có quy
              cách rồi" — đúng, nên quy cách đọc thẳng từ Mã hàng, không bắt gõ lại). ── */}
          {isPalletTruck && (
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <Label className="text-xs">Loại pallet</Label>
                <InfoTip tip="Quy cách (chân D×R, cao đế) + màu vẽ lấy từ Mã hàng tick “Mã là pallet”. Đơn vị có nhiều dạng pallet thì chọn dạng ở đây." />
              </div>
              {activePalletMat && Number(activePalletMat.carton_length_mm) > 0 && Number(activePalletMat.carton_width_mm) > 0 ? (
                <>
                  {palletMats.length > 1 && (
                    <select value={activePalletMat.id} onChange={e => setPalletMatId(e.target.value)}
                      className="w-full h-8 text-xs border border-input rounded-md px-2 bg-white">
                      {palletMats.map(m => (
                        <option key={m.id} value={m.id}>{m.short_name} ({m.carton_length_mm}×{m.carton_width_mm})</option>
                      ))}
                    </select>
                  )}
                  <p className="text-[10px] text-slate-500 flex items-start gap-1.5">
                    <span className="inline-block h-3 w-3 mt-0.5 rounded-sm border border-slate-300 shrink-0"
                      style={{ background: activePalletMat.pallet_color ?? DEFAULT_PALLET.baseColor }} />
                    <span>
                      <b>{activePalletMat.short_name}</b> — chân {activePalletMat.carton_length_mm}×{activePalletMat.carton_width_mm}mm,
                      đế cao {Number(activePalletMat.carton_height_mm) > 0 ? activePalletMat.carton_height_mm : DEFAULT_PALLET.baseH}mm.
                    </span>
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1.5">
                    <Input type="number" min={0} className="h-8 text-xs" value={palL} onChange={e => setPalL(e.target.value)} placeholder="Chân dài" />
                    <span className="text-slate-400 text-xs">×</span>
                    <Input type="number" min={0} className="h-8 text-xs" value={palW} onChange={e => setPalW(e.target.value)} placeholder="Chân rộng" />
                  </div>
                  <p className="text-[10px] text-amber-700">
                    Danh mục chưa có mã pallet khai kích thước — đang dùng chân nhập tay. Khai ở Mã hàng
                    (tick “Mã là pallet” + Thùng D×R×C) để tự lấy quy cách và màu.
                  </p>
                </>
              )}
              <div className="flex items-center gap-1.5 pt-0.5">
                <Label className="text-xs whitespace-nowrap">Cao TỐI ĐA pallet lẻ (mm)</Label>
                <InfoTip tip="TRẦN chiều cao chất xếp của pallet LẺ (gộp nhiều mã): hàng lẻ vẫn xếp thật theo kích thước thùng từng lớp, chồng vượt trần thì tự SAN sang pallet lẻ khác. Pallet CHẴN không bị khống chế — cao tự tính theo quy cách: đế + số lớp × cao thùng của từng mã (mã chưa khai kích thước thùng thì tính bằng cỡ giả định, có gắn nhãn)." />
                <Input type="number" min={0} className="h-8 text-xs w-24" value={palH} onChange={e => setPalH(e.target.value)} />
              </div>
              {floorSlots > 0 && (
                <p className="text-[10px] text-slate-500">
                  Sàn xe chứa được <b className="tabular-nums">{floorSlots}</b> chỗ pallet
                  {palletized ? <> · đơn cần <b className="tabular-nums">{palletized.palletCount}</b> pallet</> : null}
                  {topCount > 0 && <> + <b className="tabular-nums">{topCount}</b> {topUnit} lên nóc</>}
                </p>
              )}
              {/* Cách lên xe của TỪNG Loại hàng — nhớ theo (kho × user), áp mọi chuyến sau của kho */}
              {whId && catList.length > 0 && (
                <div className="space-y-1 pt-1">
                  <div className="flex items-center gap-1">
                    <Label className="text-xs">Cách lên xe theo Loại hàng</Label>
                    <InfoTip tip={<span>
                      Hàng của Loại này nằm đâu trên xe:<br />
                      • <b>Gộp chung pallet</b> — lên pallet như hàng thường: đủ quy cách thành pallet nguyên, phần dư TRỘN CHUNG pallet lẻ với các loại khác cùng đơn.<br />
                      • <b>Pallet lẻ riêng</b> — vẫn lên pallet, nhưng phần dư nằm pallet lẻ RIÊNG của loại đó (kho nhận dễ tách, không moi giữa pallet hàng khác).<br />
                      • <b>Lên nóc hàng khác</b> — không chiếm pallet nào: thùng chất lên nóc các khối pallet, tận dụng khoảng trống tới trần xe; xếp HẾT mã này mới tới mã khác, mỗi chỗ một mã.<br />
                      Lựa chọn được GHI NHỚ theo tài khoản của bạn cho TỪNG KHO — mọi chuyến sau của kho này tự áp.
                    </span>} />
                  </div>
                  {catList.map(cat => (
                    <div key={cat} className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-600 flex-1 truncate">{cat}</span>
                      <select value={placeOf(cat)} onChange={e => setPlacement(whId, cat, e.target.value as LoadPlacement)}
                        className="h-7 text-[11px] border border-input rounded-md px-1.5 bg-white">
                        <option value="MIX">Gộp chung pallet</option>
                        <option value="OWN_PALLET">Pallet lẻ riêng</option>
                        <option value="ON_TOP">Lên nóc hàng khác</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tooTall.length > 0 && (
            <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              <b>Pallet cao quá lòng xe {(truckH / 1000).toFixed(2)}m:</b> {tooTall.join(', ')} —
              giảm quy cách thùng/pallet của mã đó hoặc chọn xe cao hơn.
            </p>
          )}

          {/* Pallet không vừa xe — báo NGAY, không vẽ ra một sơ đồ vô nghĩa (user chốt 26/08) */}
          {palFitErr && (
            <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              <b>Pallet không vừa xe.</b> {palFitErr}
            </p>
          )}

          {/* Xe thường mà đơn có mã pallet → đã bỏ ra, nhưng phải NÓI, không nuốt im lặng */}
          {droppedPallets.length > 0 && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              Xe thường nên <b>dòng pallet không vẽ</b> lên sơ đồ:{' '}
              {droppedPallets.map(g => `${g.label} (${g.count})`).join(', ')}. Ở chế độ Xe pallet, chúng là pallet LÓT dưới các khối hàng.
            </p>
          )}

          {topNoBase && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              Chuyến này <b>chỉ có loại hàng đang để "Lên nóc"</b> — không có khối nào để đặt lên,
              nên sơ đồ xếp chúng thành pallet riêng.
            </p>
          )}

          {palletized?.warnings.map((w, i) => (
            <p key={i} className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">{w}</p>
          ))}

          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Label className="text-xs">Chọn xe / dòng xe</Label>
              <InfoTip tip="Gõ BIỂN SỐ để lấy lòng thùng đã khai ở Cài đặt TMS → Số xe (xe chưa khai sẽ mờ — khai ở đó rồi quay lại), hoặc chọn dòng xe đã lưu. Xe của chuyến có biển số thì tự chọn sẵn. Xe vãng lai: nhập tay kích thước bên dưới, muốn dùng lại thì đặt tên rồi bấm Lưu dòng xe." />
            </div>
            <SingleSelect
              options={pickOptions}
              value={picked?.key ?? ''}
              onChange={onPick}
              placeholder="— Chọn biển số / dòng xe —"
              searchPlaceholder="Gõ biển số hoặc tên dòng xe…"
              serverSearch
              onSearchChange={setPickSearch}
              loading={pickLoading}
              selectedLabel={picked?.label}
              triggerClassName="w-full h-8"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Label className="text-xs">Lòng thùng xe D×R×C (mm)</Label>
              <InfoTip tip="Sửa tay được cho riêng chuyến này (chọn xe/dòng xe ở trên là tự điền). Muốn ghi nhớ kích thước đang nhập cho xe vãng lai/cont: đặt tên rồi bấm Lưu dòng xe — dùng chung toàn đơn vị." />
            </div>
            <div className="flex items-center gap-1.5">
              <Input type="number" min={0} className="h-8 text-xs" disabled={dimsLocked} value={boxL} onChange={e => { setBoxL(e.target.value); setPicked(null) }} placeholder="Dài" />
              <span className="text-slate-400 text-xs">×</span>
              <Input type="number" min={0} className="h-8 text-xs" disabled={dimsLocked} value={boxW} onChange={e => { setBoxW(e.target.value); setPicked(null) }} placeholder="Rộng" />
              <span className="text-slate-400 text-xs">×</span>
              <Input type="number" min={0} className="h-8 text-xs" disabled={dimsLocked} value={boxH} onChange={e => { setBoxH(e.target.value); setPicked(null) }} placeholder="Cao" />
            </div>
            {dimsLocked && (
              <p className="text-[10px] text-slate-400">
                Kích thước theo danh mục xe <b>{picked!.label}</b> — sửa ở Cài đặt TMS → Số xe, hoặc{' '}
                <button type="button" className="underline hover:text-slate-600" onClick={() => setPicked(null)}>nhập tay (bỏ chọn xe)</button>.
              </p>
            )}
            {canManageModels && (
              <>
                <div className="flex items-center gap-1.5 pt-0.5">
                  <Input className="h-8 text-xs flex-1" value={tmName} onChange={e => { setTmName(e.target.value); setTmError('') }}
                    placeholder="Tên dòng xe (vd Container 40ft)" />
                  <Button size="sm" variant="outline" className="h-8 text-xs px-2 shrink-0" disabled={savingModels} onClick={saveTruckModel}>
                    {savingModels ? 'Đang lưu…' : 'Lưu dòng xe'}
                  </Button>
                </div>
                {truckModels.some(x => x.name === tmName.trim()) && (
                  <button type="button" className="text-[10px] text-red-500 hover:underline" disabled={savingModels} onClick={deleteTruckModel}>
                    Xóa dòng xe "{tmName.trim()}" khỏi sổ
                  </button>
                )}
                {tmError && <p className="text-[10px] text-red-600">{tmError}</p>}
              </>
            )}
          </div>

          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} className="h-3.5 w-3.5 rounded accent-blue-600" />
            Hiện TẤT CẢ nhãn tên trên sơ đồ
          </label>

          {plan && (
            <div className="grid grid-cols-3 gap-1.5 text-center">
              {mode === 'plan' ? (
                <>
                  <div className="rounded-lg bg-sky-800 text-white py-1.5">
                    <p className="text-[9px] uppercase text-sky-200">Xếp được</p>
                    <p className="text-sm font-semibold tabular-nums">{plan.placedCount}/{plan.totalCount}</p>
                  </div>
                  <div className="rounded-lg bg-sky-800 text-white py-1.5">
                    <p className="text-[9px] uppercase text-sky-200">Thể tích</p>
                    <p className="text-sm font-semibold tabular-nums">{plan.volumePct}%</p>
                  </div>
                  <div className="rounded-lg bg-sky-800 text-white py-1.5">
                    <p className="text-[9px] uppercase text-sky-200">Khối lượng</p>
                    <p className="text-sm font-semibold tabular-nums">{plan.weightKg > 0 ? `${Math.round(plan.weightKg)} kg` : '—'}</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-lg bg-green-700 text-white py-1.5">
                    <p className="text-[9px] uppercase text-green-200">Đã xuất</p>
                    <p className="text-sm font-semibold tabular-nums">{sumDone}/{plan.totalCount}</p>
                  </div>
                  <div className="rounded-lg bg-green-700 text-white py-1.5">
                    <p className="text-[9px] uppercase text-green-200">Thể tích</p>
                    <p className="text-sm font-semibold tabular-nums">{doneVolPct}%</p>
                  </div>
                  <div className="rounded-lg bg-green-700 text-white py-1.5">
                    <p className="text-[9px] uppercase text-green-200">Khối lượng</p>
                    <p className="text-sm font-semibold tabular-nums">{doneWeight > 0 ? `${doneWeight} kg` : '—'}</p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Không vừa xe — phải hiện Ở CẢ Tiến độ: chuyến thật 15/08 cần 28 pallet mà sàn chỉ 14 chỗ,
              tab Tiến độ nói "đã xuất 28/28" nhưng hình chỉ vẽ 14 và KHÔNG giải thích gì (số ≠ hình). */}
          {viewPlan && viewPlan.leftover.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-700 space-y-0.5">
              <p className="font-semibold">
                {progressActive ? 'Đã xuất nhưng KHÔNG vẽ vừa xe' : 'Không vừa xe'}
                {' '}({viewPlan.leftover.reduce((s, x) => s + x.count, 0)} {unitWord}):
              </p>
              {viewPlan.leftover.map((x, i) => (
                <p key={i}>• {viewGroups[x.group]?.label ?? '—'}: <b className="tabular-nums">{x.count}</b> {unitWord}</p>
              ))}
              <p className="text-red-500">
                {progressActive
                  ? '→ hàng đã xuất thật, nhưng lòng xe khai chỉ chứa được ngần này — kiểm lại kích thước lòng thùng.'
                  : '→ cần xe lớn hơn hoặc tách chuyến.'}
              </p>
            </div>
          )}
          {assumedCount > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700">
              <b>{assumedCount} mã chưa khai kích thước thùng</b> — đang ƯỚC LƯỢNG cỡ: mã bán theo cái có khai quy cách <i>cái/pallet</i> thì suy cỡ 1 cái từ quy cách đó, còn lại dùng cỡ giả định {assumedCarton.l}×{assumedCarton.w}×{assumedCarton.h} mm. Khai ở Mã hàng → Thùng D×R×C để sơ đồ đúng thật.
            </div>
          )}

          {/* Chú giải theo ĐƠN → mã hàng; hiện tiến độ đã xuất/kế hoạch */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[9px] uppercase font-medium text-slate-500">Thứ tự xếp ({groups.length} mã{hasManyDos ? ` · ${doLabels.length} đơn` : ''})</p>
              {selectedKeys.size > 0 && (
                <button onClick={() => setSelectedKeys(new Set())} className="text-[10px] text-sky-600 hover:underline">Bỏ soi ({selectedKeys.size})</button>
              )}
            </div>
            <p className="text-[10px] text-slate-400">Bấm vào mã để SOI khối đó trên sơ đồ (khối khác mờ đi).</p>
            {doLabels.map(dl => (
              <div key={dl} className="space-y-1">
                {hasManyDos && <p className="text-[10px] font-semibold text-slate-600 border-b border-slate-100 pb-0.5">{dl}</p>}
                {/* Dòng GỌN (user chốt 26/08): tên hiện ĐỦ (wrap, không cắt) · số lượng KÈM ĐƠN VỊ ·
                    bỏ cột kích thước · thiếu kích thước/đang dùng cỡ mặc định = dấu * ĐỎ (thay chip) */}
                {groups.map((g, i) => g.doLabel === dl && (
                  <div key={g.key} onClick={() => toggleSelect(g.key)}
                    className={`flex items-start gap-2 text-[11px] cursor-pointer rounded px-1 -mx-1 py-0.5 ${selectedKeys.has(g.key) ? 'bg-sky-100 ring-1 ring-sky-300' : 'hover:bg-slate-50'}`}>
                    <span className="h-3 w-3 mt-0.5 rounded-sm shrink-0" style={{ background: GROUP_COLORS[i % GROUP_COLORS.length] }} />
                    <span className="flex-1 min-w-0 break-words leading-tight">
                      {g.label}
                      {g.assumed && <span className="text-red-500 font-bold ml-0.5" title="Chưa khai kích thước thùng — đang tính bằng cỡ mặc định. Khai ở Mã hàng → Thùng D×R×C.">*</span>}
                      {g.onTop && <span className="text-[9px] px-1 ml-1 rounded bg-sky-100 text-sky-700 whitespace-nowrap" title="Xếp trên nóc hàng khác">nhẹ↑</span>}
                      {!isPalletTruck && g.maxLayers != null && <span className="text-[9px] px-1 ml-1 rounded bg-slate-100 text-slate-600 whitespace-nowrap" title="Số lớp xếp tối đa">≤{g.maxLayers} lớp</span>}
                    </span>
                    {(() => {
                      // SL nghiệp vụ + ĐVT danh mục khi quy về được 1 mã; pallet gộp → đếm pallet
                      const tot = g.qtyUnit ? (g.qty ?? 0) : g.count
                      const dn  = g.qtyUnit ? (g.qtyDone ?? 0) : g.done
                      return (
                        <span className={`tabular-nums font-semibold shrink-0 ${dn >= tot && tot > 0 ? 'text-green-600' : dn > 0 ? 'text-amber-600' : ''}`}>
                          {dn > 0 ? `${dn}/${tot}` : tot}
                          <span className="font-normal text-slate-400"> {g.qtyUnit ?? 'pallet'}</span>
                        </span>
                      )
                    })()}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
