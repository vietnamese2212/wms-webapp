// SƠ ĐỒ KHO 3D — góc nhìn PHỤ, CHỈ XEM, dựng TỰ ĐỘNG từ đúng dữ liệu của bản vẽ 2D (user chốt 09/09: "dựa vào
// 2D để lên 3D luôn"). Không sửa gì trong 3D: camera che khuất, nhãn khó đọc, PDA Zebra yếu WebGL ⇒ mọi thao
// tác vẽ vẫn ở 2D. Dùng ở trang Sơ đồ kho (nút 3D, desktop) và màn TV Giám sát vận hành (tự xoay).
//
// Quy ước dựng (đơn vị MÉT, 1 ô = cell_m):
//   • Ô chứa hàng = khối theo w×h ô; CAO theo số TẦNG (mỗi tầng 1,5 m, ô sàn = 1 tầng). Mỗi tầng một lát:
//     màu khu khi trống · sky khi có pallet · sky đậm khi đầy · viền cam khi có pallet QA giữ.
//   • Cửa xuất/nhập = tấm mỏng màu cửa; có xe đang đậu (09/09) → khối xe + nhãn biển số, đủ xe → tấm đỏ.
//   • Điểm đầu dãy = cột thấp màu cam. Tường = khối cao 3 m màu xám.
//   • Nhãn tên dãy = sprite trên đỉnh khối (bỏ khi bản vẽ > 400 chân kệ để không nghẽn — Bàu Bàng 813).
// Three.js nạp LAZY như Xếp xe 3D (LoadPlan3DDialog) — không phình bundle chính.
import { useEffect, useRef, useState } from 'react'
import type { MapOccupancy } from '@/api/warehouseMap'
import type { DockStatus } from '@/types'
import type { GridFrame } from '@/utils/warehouseGrid'
import { KIND_COLOR, type Footprint } from '@/utils/warehouseFootprint'

export interface WarehouseMap3DProps {
  frame: GridFrame; cellM: number; blocked: [number, number][]
  footprints: Footprint[]                     // chỉ những chân kệ ĐÃ đặt (anchor ≠ null)
  zoneColor: Map<string, string>
  occByLoc: Map<string, MapOccupancy>
  dockByLoc: Map<string, DockStatus>
  selectedKey?: string | null
  onPick?: (f: Footprint | null) => void      // bấm khối → cột tầng ở pane (2D dùng chung)
  autoRotate?: boolean                        // màn TV
  className?: string
}

type ThreeCtx = {
  THREE: typeof import('three')
  scene: import('three').Scene
  camera: import('three').PerspectiveCamera
  renderer: import('three').WebGLRenderer
  controls: import('three/examples/jsm/controls/OrbitControls.js').OrbitControls
  world: import('three').Group
  raycaster: import('three').Raycaster
}

const LEVEL_H = 1.5        // m / tầng
const WALL_H = 3
const LABEL_CAP = 400      // trên số này bỏ nhãn (mỗi nhãn = 1 texture)

function disposeChildren(THREE: typeof import('three'), group: import('three').Group) {
  for (const child of [...group.children]) {
    group.remove(child)
    child.traverse(o => {
      const m = o as import('three').Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = m.material as (import('three').Material & { map?: import('three').Texture | null }) | import('three').Material[] | undefined
      if (Array.isArray(mat)) mat.forEach(x => x.dispose())
      else if (mat) { mat.map?.dispose?.(); mat.dispose() }
    })
  }
}

// Sprite chữ (canvas → texture), canvas giãn theo độ dài chữ
function makeLabel(THREE: typeof import('three'), text: string, fg: string, bg: string, scaleM: number) {
  const font = 'bold 40px ui-sans-serif, system-ui, sans-serif'
  const meas = document.createElement('canvas').getContext('2d')!
  meas.font = font
  const tw = meas.measureText(text).width
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(96, Math.ceil(tw) + 40); canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 12); ctx.fill()
  ctx.font = font; ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.anisotropy = 4
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
  sp.scale.set(scaleM * canvas.width / canvas.height, scaleM, 1)
  sp.renderOrder = 10
  return sp
}

export function WarehouseMap3D(p: WarehouseMap3DProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const ctxRef = useRef<ThreeCtx | null>(null)
  const [ready, setReady] = useState(false)
  const [webglError, setWebglError] = useState<string | null>(null)
  const pickRef = useRef(p.onPick); pickRef.current = p.onPick
  const fpRef = useRef(p.footprints); fpRef.current = p.footprints
  const framedRef = useRef('')   // khung đã đặt camera cho kho này chưa (đổi kho mới đặt lại)

  // ── Dựng renderer một lần ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false
    let raf = 0
    const mount = mountRef.current
    if (!mount) return
    ;(async () => {
      try {
        const THREE = await import('three')
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
        if (disposed || !mountRef.current) return
        const scene = new THREE.Scene()
        scene.background = new THREE.Color(0xf1f5f9)
        const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / Math.max(1, mount.clientHeight), 0.5, 5000)
        const renderer = new THREE.WebGLRenderer({ antialias: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setSize(mount.clientWidth, mount.clientHeight)
        mount.appendChild(renderer.domElement)
        const controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.zoomToCursor = true
        controls.screenSpacePanning = false
        controls.maxPolarAngle = Math.PI / 2 - 0.04   // không chui xuống dưới sàn
        controls.autoRotate = !!p.autoRotate
        controls.autoRotateSpeed = 0.6
        scene.add(new THREE.AmbientLight(0xffffff, 0.8))
        const dir = new THREE.DirectionalLight(0xffffff, 0.9)
        dir.position.set(1, 2.2, 1.4)
        scene.add(dir)
        const world = new THREE.Group()
        scene.add(world)
        ctxRef.current = { THREE, scene, camera, renderer, controls, world, raycaster: new THREE.Raycaster() }
        framedRef.current = ''
        setReady(true)
        const loop = () => { if (disposed) return; controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop) }
        loop()
      } catch (e) {
        setWebglError(e instanceof Error ? e.message : String(e))
      }
    })()
    const onResize = () => {
      const c = ctxRef.current
      if (!c || !mountRef.current) return
      const { clientWidth: w, clientHeight: h } = mountRef.current
      c.camera.aspect = w / Math.max(1, h); c.camera.updateProjectionMatrix(); c.renderer.setSize(w, h)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(mount)
    // Bấm (không kéo) → chọn khối
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY } }
    const onUp = (e: PointerEvent) => {
      const c = ctxRef.current
      if (!c || !down || !pickRef.current) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5
      down = null
      if (moved || e.button !== 0) return
      const r = c.renderer.domElement.getBoundingClientRect()
      const ndc = new c.THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      c.raycaster.setFromCamera(ndc, c.camera)
      const hits = c.raycaster.intersectObjects(c.world.children, true)
      const hit = hits.find(h => { let o: import('three').Object3D | null = h.object; while (o) { if (o.userData?.fpKey) return true; o = o.parent } return false })
      let key: string | null = null
      if (hit) { let o: import('three').Object3D | null = hit.object; while (o) { if (o.userData?.fpKey) { key = o.userData.fpKey as string; break } o = o.parent } }
      pickRef.current(key ? fpRef.current.find(f => f.key === key) ?? null : null)
    }
    mount.addEventListener('pointerdown', onDown)
    mount.addEventListener('pointerup', onUp)
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      mount.removeEventListener('pointerdown', onDown)
      mount.removeEventListener('pointerup', onUp)
      const c = ctxRef.current
      if (c) { disposeChildren(c.THREE, c.world); c.controls.dispose(); c.renderer.dispose(); c.renderer.domElement.remove() }
      ctxRef.current = null
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { const c = ctxRef.current; if (c) c.controls.autoRotate = !!p.autoRotate }, [p.autoRotate, ready])

  // ── Dựng lại nội dung khi dữ liệu đổi (không tạo lại renderer) ───────────────────────────────
  useEffect(() => {
    const c = ctxRef.current
    if (!ready || !c) return
    const { THREE, world } = c
    disposeChildren(THREE, world)
    const cm = p.cellM
    const W = p.frame.width * cm, D = p.frame.height * cm
    // toạ độ ô → mét (tâm ô): x sang phải, z xuống dưới (như 2D nhìn từ trên)
    const cx = (gx: number, w = 1) => gx * cm + (w * cm) / 2
    const cz = (gy: number, h = 1) => gy * cm + (h * cm) / 2

    // Sàn + lưới mờ
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ color: 0xe2e8f0 }))
    floor.rotation.x = -Math.PI / 2; floor.position.set(W / 2, -0.01, D / 2)
    world.add(floor)
    const grid = new THREE.GridHelper(Math.max(W, D), Math.max(p.frame.width, p.frame.height), 0xcbd5e1, 0xdde3ea)
    grid.position.set(Math.max(W, D) / 2, 0, Math.max(W, D) / 2)
    ;(grid.material as import('three').Material).transparent = true; (grid.material as import('three').Material).opacity = 0.5
    world.add(grid)

    // Tường: gom chung 1 geometry cho nhẹ (408 ô Ba Vì)
    if (p.blocked.length) {
      const wallGeo = new THREE.BoxGeometry(cm, WALL_H, cm)
      const wallMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8 })
      const inst = new THREE.InstancedMesh(wallGeo, wallMat, p.blocked.length)
      const m4 = new THREE.Matrix4()
      p.blocked.forEach(([x, y], i) => { m4.makeTranslation(cx(x), WALL_H / 2, cz(y)); inst.setMatrixAt(i, m4) })
      inst.instanceMatrix.needsUpdate = true
      world.add(inst)
    }

    const showLabels = p.footprints.length <= LABEL_CAP
    const boxGeoCache = new Map<string, import('three').BoxGeometry>()
    const boxGeo = (w: number, h: number, d: number) => {
      const k = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`
      let g = boxGeoCache.get(k); if (!g) { g = new THREE.BoxGeometry(w, h, d); boxGeoCache.set(k, g) }
      return g
    }

    for (const f of p.footprints) {
      if (!f.anchor) continue
      const g = new THREE.Group()
      g.userData.fpKey = f.key
      const bw = f.w * cm, bd = f.h * cm
      const x = cx(f.anchor.x, f.w), z = cz(f.anchor.y, f.h)
      const selected = p.selectedKey === f.key

      if (f.kind === 'STORAGE') {
        const zc = new THREE.Color(p.zoneColor.get(f.sub_code) ?? '#e2e8f0')
        const levels = f.locs.length || 1
        f.locs.forEach((l, i) => {
          const o = p.occByLoc.get(l.id)
          const cap = l.max_pallets > 0 ? l.max_pallets : 1
          const used = o?.pallets ?? 0
          const ratio = used / cap
          const color = used > 0 ? new THREE.Color(ratio >= 1 ? '#0284c7' : '#38bdf8') : zc
          const mat = new THREE.MeshLambertMaterial({ color })
          if ((o?.quarantine ?? 0) > 0) mat.emissive = new THREE.Color('#f59e0b'), mat.emissiveIntensity = 0.35
          if (selected) mat.emissive = new THREE.Color('#0284c7'), mat.emissiveIntensity = 0.45
          const mesh = new THREE.Mesh(boxGeo(bw - 0.08, LEVEL_H - 0.12, bd - 0.08), mat)
          mesh.position.set(x, i * LEVEL_H + LEVEL_H / 2, z)
          g.add(mesh)
        })
        if (f.is_rack && levels > 1) {
          // 4 chân kệ mảnh để đọc ra "kệ" (không phải khối sàn)
          const postGeo = boxGeo(0.12, levels * LEVEL_H, 0.12)
          const postMat = new THREE.MeshLambertMaterial({ color: 0x475569 })
          for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
            const post = new THREE.Mesh(postGeo, postMat)
            post.position.set(x + dx * (bw / 2 - 0.1), (levels * LEVEL_H) / 2, z + dz * (bd / 2 - 0.1))
            g.add(post)
          }
        }
        if (showLabels || selected) {
          const lab = makeLabel(THREE, f.label, '#0f172a', 'rgba(255,255,255,0.92)', Math.max(0.9, Math.min(2.2, Math.min(bw, bd) * 0.6)))
          lab.position.set(x, levels * LEVEL_H + 1.0, z)
          g.add(lab)
        }
      } else {
        const dk = p.dockByLoc.get(f.locs[0].id)
        const full = !!dk && dk.capacity != null && dk.occupied >= dk.capacity
        const baseColor = f.kind === 'DROP' ? KIND_COLOR.DROP : (full ? '#ef4444' : (dk && dk.occupied > 0 ? (f.kind === 'DOCK_OUT' ? '#15803d' : '#1d4ed8') : KIND_COLOR[f.kind]))
        const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(baseColor) })
        if (selected) mat.emissive = new THREE.Color('#0284c7'), mat.emissiveIntensity = 0.45
        if (f.kind === 'DROP') {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.2, 12), mat)
          post.position.set(x, 0.6, z)
          g.add(post)
        } else {
          const plate = new THREE.Mesh(boxGeo(bw, 0.16, bd), mat)
          plate.position.set(x, 0.08, z)
          g.add(plate)
          // Xe đang đậu (09/09): mỗi xe một khối, xếp cạnh nhau theo chiều hẹp của cửa
          const vehicles = dk?.vehicles ?? []
          const plates = [...new Set(vehicles.map(v => v.license_plate ?? `(${v.group_code})`))]
          if (plates.length) {
            const along = bw >= bd ? 'x' : 'z'          // xe nằm dọc theo chiều dài cửa
            const len = Math.min(12, (along === 'x' ? bw : bd) * 0.9), wid = 2.4, hgt = 2.8
            const lane = (along === 'x' ? bd : bw) / plates.length
            plates.forEach((pl, i) => {
              const truck = new THREE.Mesh(boxGeo(along === 'x' ? len : wid, hgt, along === 'x' ? wid : len), new THREE.MeshLambertMaterial({ color: 0x334155 }))
              const off = -((along === 'x' ? bd : bw) / 2) + lane * (i + 0.5)
              truck.position.set(along === 'x' ? x : x + off, hgt / 2 + 0.16, along === 'x' ? z + off : z)
              g.add(truck)
              const cab = new THREE.Mesh(boxGeo(along === 'x' ? Math.min(2, len * 0.2) : wid, hgt * 0.75, along === 'x' ? wid : Math.min(2, len * 0.2)), new THREE.MeshLambertMaterial({ color: 0x0ea5e9 }))
              cab.position.set(along === 'x' ? x - len / 2 - Math.min(1, len * 0.1) : x + off, hgt * 0.375 + 0.16, along === 'x' ? z + off : z - len / 2 - Math.min(1, len * 0.1))
              g.add(cab)
              const lab = makeLabel(THREE, pl, '#ffffff', 'rgba(15,23,42,0.85)', 1.3)
              lab.position.set(truck.position.x, hgt + 1.2, truck.position.z)
              g.add(lab)
            })
          }
          if (showLabels || selected) {
            const lab = makeLabel(THREE, `${f.label}${dk ? ` · ${dk.occupied}/${dk.capacity ?? '∞'} xe` : ''}`, '#ffffff', full ? 'rgba(220,38,38,0.9)' : 'rgba(21,128,61,0.85)', 1.2)
            lab.position.set(x, plates.length ? 5.4 : 1.4, z)
            g.add(lab)
          }
        }
      }
      world.add(g)
    }

    // Đặt camera lần đầu cho kho này (đổi kho → đặt lại; đổi dữ liệu → giữ góc người dùng đang xem)
    const frameKey = `${p.frame.width}x${p.frame.height}@${cm}`
    if (framedRef.current !== frameKey) {
      framedRef.current = frameKey
      const span = Math.max(W, D)
      c.controls.target.set(W / 2, 0, D / 2)
      c.camera.position.set(W / 2 + span * 0.55, span * 0.7, D / 2 + span * 0.85)
      c.camera.near = 0.5; c.camera.far = span * 20; c.camera.updateProjectionMatrix()
      c.controls.update()
    }
  }, [ready, p.frame.width, p.frame.height, p.cellM, p.blocked, p.footprints, p.zoneColor, p.occByLoc, p.dockByLoc, p.selectedKey])

  return (
    <div className={`relative ${p.className ?? ''}`}>
      <div ref={mountRef} className="absolute inset-0" />
      {webglError && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-xs text-red-600">Không dựng được 3D trên thiết bị này ({webglError}). Dùng bản vẽ 2D.</div>
      )}
      {!ready && !webglError && <div className="absolute inset-0 grid place-items-center text-xs text-slate-400">Đang dựng 3D…</div>}
      <div className="absolute left-2 bottom-2 rounded bg-white/85 px-2 py-1 text-[10px] text-slate-600 shadow-sm pointer-events-none">
        Kéo: xoay · Lăn: phóng · Chuột phải: rê · Bấm khối: cột tầng · Cao = số tầng · Xanh = có pallet · Đỏ = cửa đủ xe
      </div>
    </div>
  )
}
