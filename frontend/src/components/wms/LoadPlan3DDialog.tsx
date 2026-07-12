// Sơ đồ xếp xe 3D — hướng dẫn xếp thùng carton lên thùng xe cho chuyến xuất.
// Thuật toán ở utils/loadPlan.ts (4 luật: theo đơn · chân đều · dãy 1 kích thước · hàng nhẹ lên nóc).
// Three.js nạp LAZY (dynamic import) — không phình bundle chính.
// 2 CHẾ ĐỘ (user chốt 12/07):
//  - "Dự toán": toàn bộ kế hoạch + thanh trượt thứ tự xếp; phần ĐÃ XUẤT thật mờ đi theo tiến độ quét.
//  - "Tiến độ": chỉ hiện thùng ĐÃ XUẤT thật (quét QR / lưu thủ công; nhặt lẻ CHỈ tính khi đã xác nhận cuối).
//  gdo đến từ useGDO (realtime invalidate) → quét tới đâu sơ đồ tự cập nhật tới đó.
// Mỗi MẢNG hàng có nhãn tên + mũi tên chỉ xuống khối (sprite + cone).
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

type PlanGroup = LoadGroup & { done: number }   // done = thùng ĐÃ XUẤT thật (nhặt lẻ chưa xác nhận KHÔNG tính)

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

// Sprite nhãn tên mảng hàng (canvas → texture)
function makeLabelSprite(THREE: typeof import('three'), text: string, color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 512; canvas.height = 96
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.strokeStyle = color; ctx.lineWidth = 6
  const r = 18
  ctx.beginPath()
  ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, r)
  ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#0f172a'
  ctx.font = 'bold 34px system-ui, sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
  const tex = new THREE.CanvasTexture(canvas)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }))
  return sprite
}

export function LoadPlan3DDialog({ open, onClose, gdo }: { open: boolean; onClose: () => void; gdo: GDO }) {
  const { data: vehicleTypes = [] } = useVehicleTypes(true)

  const [vtId, setVtId] = useState('')
  const [boxL, setBoxL] = useState('')
  const [boxW, setBoxW] = useState('')
  const [boxH, setBoxH] = useState('')
  const [maxStep, setMaxStep] = useState(0)
  const [mode, setMode] = useState<'plan' | 'progress'>('plan')   // Dự toán · Tiến độ
  const [showLabels, setShowLabels] = useState(true)

  function pickVehicleType(id: string) {
    setVtId(id)
    const vt = vehicleTypes.find(v => v.id === id)
    setBoxL(vt?.box_length_mm != null ? String(vt.box_length_mm) : '')
    setBoxW(vt?.box_width_mm  != null ? String(vt.box_width_mm)  : '')
    setBoxH(vt?.box_height_mm != null ? String(vt.box_height_mm) : '')
  }

  // Gom nhóm theo (ĐƠN × mã hàng) — kèm tiến độ đã xuất thật (realtime theo gdo)
  const groups: PlanGroup[] = useMemo(() => {
    const map = new Map<string, PlanGroup>()
    for (const d of gdo.delivery_orders ?? []) {
      for (const it of d.items) {
        if (it.cartons_ordered <= 0) continue
        const code = it.material?.material_code ?? it.material_code_raw ?? '?'
        const key = `${d.delivery_code}|${code}`
        const hasDims = it.material?.carton_length_mm && it.material?.carton_width_mm && it.material?.carton_height_mm
        // Đã xuất thật = đã quét/ghi nhận − nhặt lẻ CHƯA xác nhận cuối
        const looseUnconfirmed = (it.scan_entries ?? [])
          .filter(s => s.is_loose_picking && !s.loose_confirmed)
          .reduce((sum, s) => sum + s.cartons_scanned, 0)
        const done = Math.max(0, Math.min(it.cartons_ordered, it.cartons_scanned - looseUnconfirmed))
        const cur = map.get(key)
        if (cur) { cur.count += it.cartons_ordered; cur.done += done; continue }
        map.set(key, {
          key,
          label: it.material?.short_name ?? it.material_code_raw ?? code,
          doKey: d.delivery_code,
          doLabel: d.distributor_name ? `${d.delivery_code} · ${d.distributor_name}` : d.delivery_code,
          count: it.cartons_ordered,
          done,
          l: hasDims ? Number(it.material!.carton_length_mm) : ASSUMED_CARTON.l,
          w: hasDims ? Number(it.material!.carton_width_mm)  : ASSUMED_CARTON.w,
          h: hasDims ? Number(it.material!.carton_height_mm) : ASSUMED_CARTON.h,
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

  useEffect(() => { setMaxStep(plan?.stepCount ?? 0) }, [plan?.stepCount])

  const assumedCount = groups.filter(g => g.assumed).length
  const sumDone = groups.reduce((s, g) => s + g.done, 0)

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
    if (!plan) return
    const { length: L, width: W, height: H } = plan.truck
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
    const cab = new THREE.Mesh(new THREE.BoxGeometry(40, H, W), new THREE.MeshLambertMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.35 }))
    cab.position.set(-L / 2 - 20, H / 2, 0)
    boxGroup.add(cab)

    // Chọn thùng hiển thị theo chế độ:
    //  - Dự toán: theo thanh trượt (step ≤ maxStep); phần đã xuất thật → MỜ; chân đang xếp (step=maxStep) → SÁNG.
    //  - Tiến độ: CHỈ thùng đã xuất thật (ordinal trong nhóm < done), theo đúng thứ tự xếp.
    type Kind = 'normal' | 'done' | 'current'
    const buckets = new Map<string, { boxes: { b: (typeof plan.placed)[number] }[]; gi: number; kind: Kind }>()
    plan.placed.forEach((b, i) => {
      const g = groups[b.group]
      let show = false, kind: Kind = 'normal'
      if (mode === 'progress') {
        show = ordinals[i] < g.done
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

    const visibleByGroup = new Map<number, { cx: number; cy: number; top: number; n: number }>()
    for (const { boxes, gi, kind } of buckets.values()) {
      const color = new THREE.Color(GROUP_COLORS[gi % GROUP_COLORS.length])
      const mat = new THREE.MeshLambertMaterial({
        color,
        transparent: kind === 'done', opacity: kind === 'done' ? 0.28 : 1,
        emissive: kind === 'current' ? color : new THREE.Color(0x000000),
        emissiveIntensity: kind === 'current' ? 0.45 : 0,
      })
      const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, boxes.length)
      const m = new THREE.Matrix4()
      boxes.forEach(({ b }, i) => {
        m.makeScale(Math.max(1, b.l - 10), Math.max(1, b.h - 10), Math.max(1, b.w - 10))   // hở 10mm nhìn rõ từng thùng
        m.setPosition(toX(b.x, b.l), toY(b.z, b.h), toZ(b.y, b.w))
        inst.setMatrixAt(i, m)
        const agg = visibleByGroup.get(gi) ?? { cx: 0, cy: 0, top: 0, n: 0 }
        agg.cx += b.x + b.l / 2; agg.cy += b.y + b.w / 2
        agg.top = Math.max(agg.top, b.z + b.h); agg.n++
        visibleByGroup.set(gi, agg)
      })
      inst.instanceMatrix.needsUpdate = true
      boxGroup.add(inst)
    }

    // Nhãn tên MẢNG hàng + mũi tên chỉ xuống khối
    if (showLabels) {
      for (const [gi, agg] of visibleByGroup) {
        const g = groups[gi]
        const color = GROUP_COLORS[gi % GROUP_COLORS.length]
        const cx = toX(agg.cx / agg.n, 0), cy = toZ(agg.cy / agg.n, 0)
        const short = g.label.length > 22 ? g.label.slice(0, 21) + '…' : g.label
        const countTxt = mode === 'progress' ? `${g.done}` : (g.done > 0 ? `${g.done}/${g.count}` : `${g.count}`)
        const sprite = makeLabelSprite(THREE, `${short} · ${countTxt}`, color)
        const labelY = agg.top + 420
        sprite.position.set(cx, labelY, cy)
        sprite.scale.set(1500, 280, 1)
        boxGroup.add(sprite)
        // Mũi tên: thân line + đầu cone chỉ xuống nóc khối
        const lineMat = new THREE.LineBasicMaterial({ color })
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(cx, labelY - 120, cy), new THREE.Vector3(cx, agg.top + 120, cy),
        ])
        boxGroup.add(new THREE.Line(lineGeo, lineMat))
        const cone = new THREE.Mesh(new THREE.ConeGeometry(50, 120, 10), new THREE.MeshLambertMaterial({ color }))
        cone.position.set(cx, agg.top + 80, cy)
        cone.rotation.x = Math.PI
        boxGroup.add(cone)
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
  }, [ready, plan, maxStep, mode, showLabels, groups, ordinals])

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
                {groups.length === 0 ? 'Chuyến chưa có mã hàng nào có số lượng thùng.' : 'Chọn loại xe và nhập kích thước lòng thùng (mm) để dựng sơ đồ.'}
              </p>
            </div>
          )}
          {plan && mode === 'progress' && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-green-600/95 text-white text-[11px] rounded-full px-3 py-1 shadow">
              Tiến độ thực tế: đã xuất <b className="tabular-nums">{sumDone}/{plan.totalCount}</b> thùng
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
                  {vt.name}{vt.box_length_mm ? ` (${vt.box_length_mm}×${vt.box_width_mm}×${vt.box_height_mm})` : ' (chưa khai lòng thùng)'}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Lòng thùng xe D×R×C (mm)</Label>
            <div className="flex items-center gap-1.5">
              <Input type="number" min={0} className="h-8 text-xs" value={boxL} onChange={e => setBoxL(e.target.value)} placeholder="Dài" />
              <span className="text-slate-400 text-xs">×</span>
              <Input type="number" min={0} className="h-8 text-xs" value={boxW} onChange={e => setBoxW(e.target.value)} placeholder="Rộng" />
              <span className="text-slate-400 text-xs">×</span>
              <Input type="number" min={0} className="h-8 text-xs" value={boxH} onChange={e => setBoxH(e.target.value)} placeholder="Cao" />
            </div>
            <p className="text-[10px] text-slate-400">Khai sẵn cho từng loại xe ở Cài đặt TMS → Loại xe để khỏi nhập lại.</p>
          </div>

          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} className="h-3.5 w-3.5 rounded accent-blue-600" />
            Hiện nhãn tên mảng hàng trên sơ đồ
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

          {plan && plan.leftover.length > 0 && mode === 'plan' && (
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
              <b>{assumedCount} mã chưa khai kích thước thùng</b> — đang dùng cỡ giả định {ASSUMED_CARTON.l}×{ASSUMED_CARTON.w}×{ASSUMED_CARTON.h} mm. Khai ở Mã hàng → Thùng D×R×C để sơ đồ đúng thật.
            </div>
          )}

          {/* Chú giải theo ĐƠN → mã hàng; hiện tiến độ đã xuất/kế hoạch */}
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
                    <span className={`tabular-nums font-semibold shrink-0 ${g.done >= g.count ? 'text-green-600' : g.done > 0 ? 'text-amber-600' : ''}`}>
                      {g.done > 0 ? `${g.done}/${g.count}` : g.count}
                    </span>
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
