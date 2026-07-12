// Sơ đồ xếp xe 3D — hướng dẫn xếp thùng carton lên thùng xe cho chuyến xuất.
// Thuật toán ở utils/loadPlan.ts (cột chồng cùng mã + xếp dải từ cabin ra cửa).
// Three.js nạp LAZY (dynamic import) — không phình bundle chính.
// Thanh trượt "bước" = thứ tự xếp từng cột để user làm theo.
import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Boxes, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useVehicleTypes } from '@/api/hooks'
import { computeLoadPlan, ASSUMED_CARTON, GROUP_COLORS, type LoadGroup, type LoadPlan } from '@/utils/loadPlan'
import type { GDO } from '@/types'

type ThreeCtx = {
  THREE: typeof import('three')
  scene: import('three').Scene
  camera: import('three').PerspectiveCamera
  renderer: import('three').WebGLRenderer
  controls: import('three/examples/jsm/controls/OrbitControls.js').OrbitControls
  boxGroup: import('three').Group
}

function disposeChildren(THREE: typeof import('three'), group: import('three').Group) {
  for (const child of [...group.children]) {
    group.remove(child)
    const mesh = child as import('three').Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material as import('three').Material | import('three').Material[] | undefined
    if (Array.isArray(mat)) mat.forEach(m => m.dispose())
    else mat?.dispose()
  }
}

export function LoadPlan3DDialog({ open, onClose, gdo }: { open: boolean; onClose: () => void; gdo: GDO }) {
  const { data: vehicleTypes = [] } = useVehicleTypes(true)

  const [vtId, setVtId] = useState('')
  const [boxL, setBoxL] = useState('')
  const [boxW, setBoxW] = useState('')
  const [boxH, setBoxH] = useState('')
  const [maxStep, setMaxStep] = useState(0)

  // Chọn loại xe → prefill kích thước lòng thùng đã khai (sửa được cho chuyến này)
  function pickVehicleType(id: string) {
    setVtId(id)
    const vt = vehicleTypes.find(v => v.id === id)
    setBoxL(vt?.box_length_cm != null ? String(vt.box_length_cm) : '')
    setBoxW(vt?.box_width_cm  != null ? String(vt.box_width_cm)  : '')
    setBoxH(vt?.box_height_cm != null ? String(vt.box_height_cm) : '')
  }

  // Gom nhóm thùng theo (ĐƠN × mã hàng) — thứ tự đơn giữ nguyên (xếp hết đơn 1 mới tới đơn 2)
  const groups: LoadGroup[] = useMemo(() => {
    const map = new Map<string, LoadGroup>()
    for (const d of gdo.delivery_orders ?? []) {
      for (const it of d.items) {
        if (it.cartons_ordered <= 0) continue
        const code = it.material?.material_code ?? it.material_code_raw ?? '?'
        const key = `${d.delivery_code}|${code}`
        const hasDims = it.material?.carton_length_cm && it.material?.carton_width_cm && it.material?.carton_height_cm
        const cur = map.get(key)
        if (cur) { cur.count += it.cartons_ordered; continue }
        map.set(key, {
          key,
          label: it.material?.short_name ?? it.material_code_raw ?? code,
          doKey: d.delivery_code,
          doLabel: d.distributor_name ? `${d.delivery_code} · ${d.distributor_name}` : d.delivery_code,
          count: it.cartons_ordered,
          l: hasDims ? Number(it.material!.carton_length_cm) : ASSUMED_CARTON.l,
          w: hasDims ? Number(it.material!.carton_width_cm)  : ASSUMED_CARTON.w,
          h: hasDims ? Number(it.material!.carton_height_cm) : ASSUMED_CARTON.h,
          weightKg: it.material?.weight_kg ?? null,
          assumed: !hasDims,
          maxLayers: it.material?.max_stack_layers ?? null,
          onTop: it.material?.stack_on_top ?? false,
        })
      }
    }
    return [...map.values()]
  }, [gdo])

  const truckL = Number(boxL), truckW = Number(boxW), truckH = Number(boxH)
  const truckOk = truckL > 0 && truckW > 0 && truckH > 0

  const plan: LoadPlan | null = useMemo(() => {
    if (!truckOk || !groups.length) return null
    return computeLoadPlan({ length: truckL, width: truckW, height: truckH }, groups)
  }, [truckOk, truckL, truckW, truckH, groups])

  // Plan đổi → nhảy về xếp đủ (xem toàn cảnh trước, rồi kéo lùi để xem từng bước)
  useEffect(() => { setMaxStep(plan?.stepCount ?? 0) }, [plan?.stepCount])

  const assumedCount = groups.filter(g => g.assumed).length

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

  // Vẽ lại khung xe + thùng khi plan / bước đổi (KHÔNG tạo lại renderer)
  useEffect(() => {
    const c = ctxRef.current
    if (!ready || !c) return
    const { THREE, boxGroup } = c
    disposeChildren(THREE, boxGroup)
    if (!plan) return
    const { length: L, width: W, height: H } = plan.truck
    // Map tọa độ: x(three)=dọc thân xe, y(three)=cao, z(three)=ngang. Tâm sàn xe = gốc.
    const toX = (x: number, l: number) => x + l / 2 - L / 2
    const toY = (z: number, h: number) => z + h / 2
    const toZ = (y: number, w: number) => y + w / 2 - W / 2

    // Khung lòng thùng xe (wireframe) + sàn
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(L, H, W)),
      new THREE.LineBasicMaterial({ color: 0x475569 }),
    )
    frame.position.set(0, H / 2, 0)
    boxGroup.add(frame)
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(L, 2, W),
      new THREE.MeshLambertMaterial({ color: 0xcbd5e1 }),
    )
    floor.position.set(0, -1, 0)
    boxGroup.add(floor)
    // Vạch đánh dấu đầu cabin (xếp từ phía này)
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(4, H, W),
      new THREE.MeshLambertMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.35 }),
    )
    cab.position.set(-L / 2 - 2, H / 2, 0)
    boxGroup.add(cab)

    // Thùng theo bước — InstancedMesh mỗi nhóm; cột ĐANG xếp (step = maxStep) tô sáng hơn
    const visible = plan.placed.filter(b => b.step <= maxStep)
    for (let gi = 0; gi < plan.groups.length; gi++) {
      for (const current of [false, true]) {
        const boxes = visible.filter(b => b.group === gi && (b.step === maxStep) === current)
        if (!boxes.length) continue
        const color = new THREE.Color(GROUP_COLORS[gi % GROUP_COLORS.length])
        const mat = new THREE.MeshLambertMaterial({
          color, emissive: current ? color : new THREE.Color(0x000000), emissiveIntensity: current ? 0.45 : 0,
        })
        const geo = new THREE.BoxGeometry(1, 1, 1)
        const inst = new THREE.InstancedMesh(geo, mat, boxes.length)
        const m = new THREE.Matrix4()
        boxes.forEach((b, i) => {
          // hở 1cm mỗi chiều để nhìn rõ từng thùng
          m.makeScale(Math.max(1, b.l - 1), Math.max(1, b.h - 1), Math.max(1, b.w - 1))
          m.setPosition(toX(b.x, b.l), toY(b.z, b.h), toZ(b.y, b.w))
          inst.setMatrixAt(i, m)
        })
        inst.instanceMatrix.needsUpdate = true
        boxGroup.add(inst)
      }
    }

    // Đặt camera lần đầu / khi đổi cỡ xe
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
  }, [ready, plan, maxStep])

  if (!open) return null

  const currentGroup = plan && maxStep > 0
    ? plan.groups[plan.placed.find(b => b.step === maxStep)?.group ?? -1]
    : null
  const currentColCount = plan ? plan.placed.filter(b => b.step === maxStep).length : 0
  const doLabels = [...new Set(groups.map(g => g.doLabel))]
  const hasManyDos = doLabels.length > 1

  return (
    <div className="fixed inset-0 z-[120] bg-white flex flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 border-b bg-slate-900 text-white px-3 py-2">
        <Boxes className="h-4 w-4 text-sky-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">Sơ đồ xếp xe 3D — {gdo.group_code}</p>
          <p className="text-[10px] text-slate-400 truncate">Xếp từ trong cabin ra cửa · thùng cùng mã chồng thành cột · kéo để xoay, lăn chuột để zoom</p>
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
                {groups.length === 0 ? 'Chuyến chưa có mã hàng nào có số lượng thùng.' : 'Chọn loại xe và nhập kích thước lòng thùng (cm) để dựng sơ đồ.'}
              </p>
            </div>
          )}
          {/* Thanh bước — nổi dưới canvas */}
          {plan && plan.stepCount > 0 && (
            <div className="absolute left-1/2 -translate-x-1/2 bottom-2 w-[min(560px,92%)] bg-white/95 border border-slate-200 rounded-xl shadow-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 w-7 p-0 shrink-0" disabled={maxStep <= 0} onClick={() => setMaxStep(s => Math.max(0, s - 1))}><ChevronLeft className="h-4 w-4" /></Button>
                <input type="range" min={0} max={plan.stepCount} value={maxStep} onChange={e => setMaxStep(Number(e.target.value))} className="flex-1 accent-sky-600" />
                <Button size="sm" variant="outline" className="h-7 w-7 p-0 shrink-0" disabled={maxStep >= plan.stepCount} onClick={() => setMaxStep(s => Math.min(plan.stepCount, s + 1))}><ChevronRight className="h-4 w-4" /></Button>
              </div>
              <p className="text-[11px] text-center text-slate-600 mt-0.5">
                {maxStep === 0
                  ? 'Xe trống — bấm ▶ để xem thứ tự xếp từng cột'
                  : <>Bước <b className="tabular-nums">{maxStep}/{plan.stepCount}</b>{currentGroup && <> — xếp <b>{currentColCount} thùng</b> · <span className="font-medium">{currentGroup.label}</span>{hasManyDos && <span className="text-slate-400"> · {currentGroup.doLabel}</span>} (chân sáng)</>}</>}
              </p>
            </div>
          )}
        </div>

        {/* Panel điều khiển */}
        <div className="shrink-0 lg:w-80 max-h-[45%] lg:max-h-none border-t lg:border-t-0 lg:border-l bg-white overflow-y-auto p-3 space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Loại xe</Label>
            <select value={vtId} onChange={e => pickVehicleType(e.target.value)}
              className="w-full h-8 text-xs border border-input rounded-md px-2 bg-white">
              <option value="">— Chọn loại xe —</option>
              {vehicleTypes.map(vt => (
                <option key={vt.id} value={vt.id}>
                  {vt.name}{vt.box_length_cm ? ` (${vt.box_length_cm}×${vt.box_width_cm}×${vt.box_height_cm})` : ' (chưa khai lòng thùng)'}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Lòng thùng xe D×R×C (cm)</Label>
            <div className="flex items-center gap-1.5">
              <Input type="number" min={0} className="h-8 text-xs" value={boxL} onChange={e => setBoxL(e.target.value)} placeholder="Dài" />
              <span className="text-slate-400 text-xs">×</span>
              <Input type="number" min={0} className="h-8 text-xs" value={boxW} onChange={e => setBoxW(e.target.value)} placeholder="Rộng" />
              <span className="text-slate-400 text-xs">×</span>
              <Input type="number" min={0} className="h-8 text-xs" value={boxH} onChange={e => setBoxH(e.target.value)} placeholder="Cao" />
            </div>
            <p className="text-[10px] text-slate-400">Khai sẵn cho từng loại xe ở Cài đặt TMS → Loại xe để khỏi nhập lại.</p>
          </div>

          {plan && (
            <div className="grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded-lg bg-sky-800 text-white py-1.5">
                <p className="text-[9px] uppercase text-sky-200">Đã xếp</p>
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
            </div>
          )}

          {plan && plan.leftover.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-700 space-y-0.5">
              <p className="font-semibold">Không vừa xe ({plan.leftover.reduce((s, x) => s + x.count, 0)} thùng):</p>
              {plan.leftover.map((x, i) => (
                <p key={i}>• {plan.groups[x.group].label}: <b className="tabular-nums">{x.count}</b> thùng</p>
              ))}
              <p className="text-red-500">→ cần xe lớn hơn hoặc tách chuyến.</p>
            </div>
          )}
          {assumedCount > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700">
              <b>{assumedCount} mã chưa khai kích thước thùng</b> — đang dùng cỡ giả định {ASSUMED_CARTON.l}×{ASSUMED_CARTON.w}×{ASSUMED_CARTON.h} cm. Khai ở Mã hàng → Thùng D×R×C để sơ đồ đúng thật.
            </div>
          )}

          {/* Chú giải theo ĐƠN → mã hàng (thứ tự xếp: hết đơn trên mới tới đơn dưới) */}
          <div className="space-y-1.5">
            <p className="text-[9px] uppercase font-medium text-slate-500">Thứ tự xếp ({groups.length} mã{hasManyDos ? ` · ${doLabels.length} đơn` : ''})</p>
            {doLabels.map(dl => (
              <div key={dl} className="space-y-1">
                {hasManyDos && <p className="text-[10px] font-semibold text-slate-600 border-b border-slate-100 pb-0.5">{dl}</p>}
                {groups.map((g, i) => g.doLabel === dl && (
                  <div key={g.key} className="flex items-center gap-2 text-[11px]">
                    <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: GROUP_COLORS[i % GROUP_COLORS.length] }} />
                    <span className="truncate flex-1" title={`${g.key} — ${g.label}`}>{g.label}</span>
                    {g.onTop && <span className="text-[9px] px-1 rounded bg-sky-100 text-sky-700 shrink-0" title="Hàng nhẹ — xếp trên nóc mã hàng khác">nhẹ↑</span>}
                    {g.maxLayers != null && <span className="text-[9px] px-1 rounded bg-slate-100 text-slate-600 shrink-0" title="Số lớp xếp tối đa">≤{g.maxLayers} lớp</span>}
                    {g.assumed && <span className="text-[9px] px-1 rounded bg-amber-100 text-amber-700 shrink-0">cỡ giả định</span>}
                    <span className="tabular-nums font-semibold shrink-0">{g.count}</span>
                    <span className="text-slate-400 shrink-0">{g.l}×{g.w}×{g.h}</span>
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
