// SƠ ĐỒ KHO 3D — góc nhìn PHỤ, CHỈ XEM, dựng TỰ ĐỘNG từ đúng dữ liệu của bản vẽ 2D (user chốt 09/09: "dựa vào
// 2D để lên 3D luôn"). Không sửa gì trong 3D: camera che khuất, nhãn khó đọc, PDA Zebra yếu WebGL ⇒ mọi thao
// tác vẽ vẫn ở 2D. Dùng ở trang Sơ đồ kho (nút 3D, desktop) và màn TV Giám sát vận hành (tự xoay).
//
// Quy ước dựng (đơn vị MÉT, 1 ô lưới = cell_m = 1 CHÂN PALLET):
//   • VỊ TRÍ TRỐNG KHÔNG DỰNG KHỐI (user chốt 10/09) — chỉ còn tấm nền mỏng màu khu để biết "có vị trí ở đây".
//     Bản đầu dựng khối đặc cho mọi tầng nên kho vơi hàng trông y hệt kho đầy: nhìn 3D không biết gì thêm 2D.
//   • GIÁ KỆ vẽ THẬT: trụ + thanh đỡ từng tầng, MÀU CAM như kệ ngoài kho thật. Kệ luôn hiện, kể cả tầng trống.
//   • PALLET = một khối trên mỗi CHÂN pallet có hàng: đế màu pallet (Material.pallet_color của mã pallet —
//     Loscam xanh, khai ở Mã hàng) + kiện hàng phía trên; QA giữ thì kiện hàng màu hổ phách.
//   • Cửa xuất/nhập = tấm mỏng màu cửa; có xe đang đậu → dựng XE THẬT (đầu kéo + thùng cont, hoặc cabin + thùng
//     xe tải, đủ bánh) theo `vehicle_type` RPC trả về; đủ xe → tấm đỏ.
//   • Điểm đầu dãy = cột thấp màu cam. Tường = khối cao 3,5 m màu xám.
// Khối lặp (trụ · thanh kệ · pallet) đi bằng InstancedMesh: Bàu Bàng 813 chân kệ × 4 tầng thì dựng mesh rời
// là hàng vạn draw call. Three.js nạp LAZY như Xếp xe 3D (LoadPlan3DDialog) — không phình bundle chính.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MapOccupancy } from '@/api/warehouseMap'
import type { DockStatus } from '@/types'
import type { GridFrame } from '@/utils/warehouseGrid'
import { KIND_COLOR, type Footprint } from '@/utils/warehouseFootprint'
import { usePalletCarrierMaterials } from '@/api/hooks'

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
const WALL_H = 3.5         // user chốt 10/09
const PAD_H = 0.05         // tấm nền đánh dấu vị trí (cũng là mặt bấm chọn)
const BEAM_H = 0.12        // thanh đỡ kệ
const POST_W = 0.09        // trụ kệ
const POST_EVERY = 2       // 1 trụ mỗi 2 chân pallet (~2,4 m — bước kệ thật)
const PALLET_BASE_H = 0.15
const PALLET_LOAD_H = 1.05
const RACK_COLOR = '#f97316'          // cam — kệ ngoài kho thật
const DEFAULT_PALLET_COLOR = '#1d4ed8' // xanh Loscam (khớp DEFAULT_PALLET.baseColor của Xếp xe 3D)
const LOAD_COLOR = '#d8c39a'          // kiện hàng trên pallet
const LOAD_QA_COLOR = '#f59e0b'       // pallet bị QA giữ
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

/** Loại xe (tên trong danh mục Loại xe) có phải xe đầu kéo kéo container không. */
function isContainerVehicle(vt: string | null | undefined, containerNo: string | null | undefined): boolean {
  if (containerNo && containerNo.trim()) return true
  return /CONT/i.test(vt ?? '')
}

/**
 * Dựng một chiếc xe, thân nằm dọc trục X, cabin ở phía −X, bánh chạm y = 0.
 * Container = đầu kéo + rơ-moóc + thùng cont (có gân sóng); còn lại = xe tải thùng kín.
 * Không dùng texture: bánh + cabin + gân sóng là hình khối, đọc ra kiểu xe ngay ở góc nhìn xa.
 */
function buildVehicle(THREE: typeof import('three'), container: boolean, len: number): import('three').Group {
  const g = new THREE.Group()
  const W = 2.5, wr = 0.52, wt = 0.34
  const mat = (c: string) => new THREE.MeshLambertMaterial({ color: new THREE.Color(c) })
  const add = (w: number, h: number, d: number, c: string, px: number, py: number, pz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c))
    m.position.set(px, py, pz)
    g.add(m)
    return m
  }
  const axle = (px: number, dual = false) => {
    const geo = new THREE.CylinderGeometry(wr, wr, wt, 14)
    const wm = mat('#111827')
    for (const s of [-1, 1]) for (const k of dual ? [0, 1] : [0]) {
      const t = new THREE.Mesh(geo, wm)
      t.rotation.x = Math.PI / 2
      t.position.set(px, wr, s * (W / 2 - 0.14 - k * (wt + 0.04)))
      g.add(t)
    }
  }
  const x0 = -len / 2
  if (container) {
    // Đầu kéo: cabin cao, 2 cầu; rơ-moóc: sàn dài + thùng cont + 3 cầu sau
    const cabL = 2.3
    add(cabL, 2.5, W, '#334155', x0 + cabL / 2, 1.05 + 1.25)              // cabin
    add(0.12, 1.0, W * 0.86, '#0f172a', x0 + 0.06, 2.55)                  // kính trước
    add(len - cabL - 0.2, 0.9, W * 0.7, '#1f2937', x0 + cabL + (len - cabL) / 2 - 0.1, 0.9)  // khung gầm + rơ-moóc
    const contL = Math.max(4, len - cabL - 1.4)
    const cont = add(contL, 2.6, W, '#b45309', x0 + cabL + 0.6 + contL / 2, 1.35 + 1.3)
    // gân sóng 2 bên + cửa sau (đọc ra "container" chứ không phải hộp trơn)
    const ribs = Math.max(4, Math.min(14, Math.round(contL / 1.1)))
    for (let i = 1; i < ribs; i++) {
      const rx = cont.position.x - contL / 2 + (contL * i) / ribs
      for (const s of [-1, 1]) add(0.06, 2.3, 0.06, '#92400e', rx, cont.position.y, s * (W / 2 + 0.02))
    }
    add(0.1, 2.4, W * 0.96, '#7c2d12', cont.position.x + contL / 2 + 0.03, cont.position.y)   // cánh cửa sau
    axle(x0 + 1.1); axle(x0 + cabL + 0.4)
    for (let i = 0; i < 3; i++) axle(len / 2 - 1.0 - i * 1.35)
  } else {
    // Xe tải thùng kín: cabin thấp hơn thùng, 1 cầu trước + 2 cầu sau
    const cabL = Math.min(2.2, len * 0.26)
    add(len - 0.3, 0.22, W * 0.8, '#1f2937', 0, 0.95)                     // khung gầm
    add(cabL, 1.95, W, '#e2e8f0', x0 + cabL / 2, 1.06 + 0.98)             // cabin
    add(0.12, 0.85, W * 0.88, '#0f172a', x0 + 0.04, 2.45)                 // kính trước
    const bodyL = len - cabL - 0.35
    const body = add(bodyL, 2.35, W, '#f8fafc', x0 + cabL + 0.35 + bodyL / 2, 1.06 + 1.18)
    add(bodyL * 0.98, 0.14, W * 1.01, '#0ea5e9', body.position.x, 1.2)    // viền hông xanh cho ra dáng xe tải
    add(0.09, 2.2, W * 0.96, '#cbd5e1', body.position.x + bodyL / 2 + 0.03, body.position.y)  // cửa sau
    axle(x0 + cabL * 0.55)
    axle(len / 2 - 1.1, true)
  }
  return g
}

export function WarehouseMap3D(p: WarehouseMap3DProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const ctxRef = useRef<ThreeCtx | null>(null)
  const [ready, setReady] = useState(false)
  const [webglError, setWebglError] = useState<string | null>(null)
  const pickRef = useRef(p.onPick); pickRef.current = p.onPick
  const fpRef = useRef(p.footprints); fpRef.current = p.footprints
  const framedRef = useRef('')   // khung đã đặt camera cho kho này chưa (đổi kho mới đặt lại)

  // MÀU PALLET khai ở danh mục Mã hàng (mã có cờ "Pallet mang hàng") — cùng nguồn với Xếp xe 3D, không tự
  // đặt màu riêng cho màn này. Danh mục vài dòng, cache 5 phút.
  const { data: palletMats = [] } = usePalletCarrierMaterials(true)
  const palletColor = useMemo(
    () => palletMats.find(m => m.pallet_color)?.pallet_color ?? DEFAULT_PALLET_COLOR,
    [palletMats])

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
      let key: string | null = null
      for (const h of hits) {
        // Khối lặp đi bằng InstancedMesh nên không có group cha mang fpKey — tra theo instanceId
        const keys = h.object.userData?.instKeys as string[] | undefined
        if (keys && h.instanceId != null) { key = keys[h.instanceId] ?? null; if (key) break; continue }
        let o: import('three').Object3D | null = h.object
        while (o) { if (o.userData?.fpKey) { key = o.userData.fpKey as string; break } o = o.parent }
        if (key) break
      }
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

    // Gom khối LẶP để đẩy một lượt: trụ kệ · thanh đỡ · đế pallet · kiện hàng
    type Piece = { x: number; y: number; z: number; sx: number; sy: number; sz: number; color?: string; key?: string }
    const posts: Piece[] = [], beams: Piece[] = [], palletBases: Piece[] = [], palletLoads: Piece[] = []

    for (const f of p.footprints) {
      if (!f.anchor) continue
      const g = new THREE.Group()
      g.userData.fpKey = f.key
      const bw = f.w * cm, bd = f.h * cm
      const x = cx(f.anchor.x, f.w), z = cz(f.anchor.y, f.h)
      const selected = p.selectedKey === f.key

      if (f.kind === 'STORAGE') {
        const zc = p.zoneColor.get(f.sub_code) ?? '#e2e8f0'
        const levels = f.locs.length || 1
        const cellsN = Math.max(1, f.w * f.h)

        // TẤM NỀN: vị trí trống thì đây là TẤT CẢ những gì hiện ra (user chốt 10/09) — và luôn là mặt bấm chọn
        const padMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(selected ? '#0284c7' : zc) })
        const pad = new THREE.Mesh(boxGeo(bw - 0.06, PAD_H, bd - 0.06), padMat)
        pad.position.set(x, PAD_H / 2, z)
        g.add(pad)

        // PALLET theo TỪNG CHÂN có hàng — tô từ góc neo theo hàng, khớp lớp phủ Tồn của bản vẽ 2D
        f.locs.forEach((l, i) => {
          const o = p.occByLoc.get(l.id)
          const used = o?.pallets ?? 0
          if (used <= 0) return
          const cap = l.max_pallets > 0 ? l.max_pallets : cellsN
          const filled = Math.max(1, Math.min(cellsN, Math.round((cellsN * used) / cap)))
          const qa = (o?.quarantine ?? 0) > 0
          const yBase = i * LEVEL_H + (f.is_rack && i > 0 ? BEAM_H : PAD_H)
          let k = 0
          for (let cyi = 0; cyi < f.h && k < filled; cyi++) {
            for (let cxi = 0; cxi < f.w && k < filled; cxi++, k++) {
              const px = cx(f.anchor!.x + cxi), pz = cz(f.anchor!.y + cyi)
              palletBases.push({ x: px, y: yBase + PALLET_BASE_H / 2, z: pz, sx: cm - 0.14, sy: PALLET_BASE_H, sz: cm - 0.14, key: f.key })
              palletLoads.push({
                x: px, y: yBase + PALLET_BASE_H + PALLET_LOAD_H / 2, z: pz,
                sx: cm - 0.22, sy: PALLET_LOAD_H, sz: cm - 0.22,
                color: qa ? LOAD_QA_COLOR : (selected ? '#38bdf8' : LOAD_COLOR), key: f.key,
              })
            }
          }
        })

        // GIÁ KỆ: trụ + thanh đỡ, luôn hiện (tầng trống vẫn thấy chỗ để hàng)
        if (f.is_rack) {
          const H = levels * LEVEL_H
          const alongX = f.w >= f.h
          const nAlong = alongX ? f.w : f.h
          const cuts: number[] = []
          for (let j = 0; j <= nAlong; j += POST_EVERY) cuts.push(j)
          if (cuts[cuts.length - 1] !== nAlong) cuts.push(nAlong)
          const ax0 = (alongX ? f.anchor.x : f.anchor.y) * cm
          const across0 = (alongX ? f.anchor.y : f.anchor.x) * cm
          const acrossLen = (alongX ? f.h : f.w) * cm
          for (const j of cuts) {
            const a = ax0 + j * cm
            for (const s of [0, 1]) {
              const b = across0 + s * acrossLen + (s === 0 ? POST_W / 2 : -POST_W / 2)
              posts.push({ x: alongX ? a : b, y: H / 2, z: alongX ? b : a, sx: POST_W, sy: H, sz: POST_W, key: f.key })
            }
          }
          for (let i = 1; i <= levels; i++) {
            const y = i * LEVEL_H - BEAM_H / 2
            for (const s of [0, 1]) {
              const b = across0 + s * acrossLen + (s === 0 ? POST_W : -POST_W)
              beams.push({
                x: alongX ? ax0 + (nAlong * cm) / 2 : b, y, z: alongX ? b : ax0 + (nAlong * cm) / 2,
                sx: alongX ? nAlong * cm : POST_W * 1.4, sy: BEAM_H, sz: alongX ? POST_W * 1.4 : nAlong * cm,
                key: f.key,
              })
            }
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
          // XE ĐANG ĐẬU: mỗi biển một xe, xếp cạnh nhau theo chiều hẹp của cửa, thân dọc chiều dài cửa.
          // Kiểu xe theo `vehicle_type` (RPC 20260910i trả) — cont dài 16,5 m, xe tải 9,5 m, cắt vừa cửa.
          const byPlate = new Map<string, DockStatus['vehicles'][number]>()
          for (const v of dk?.vehicles ?? []) {
            const k = v.license_plate ?? `(${v.group_code})`
            if (!byPlate.has(k)) byPlate.set(k, v)
          }
          const list = [...byPlate.entries()]
          if (list.length) {
            const alongX = bw >= bd
            const longM = alongX ? bw : bd, shortM = alongX ? bd : bw
            const lane = shortM / list.length
            list.forEach(([pl, v], i) => {
              const cont = isContainerVehicle(v.vehicle_type, v.container_number)
              const len = Math.max(6, Math.min(cont ? 16.5 : 9.5, longM))
              const veh = buildVehicle(THREE, cont, len)
              const off = -shortM / 2 + lane * (i + 0.5)
              veh.position.set(alongX ? x : x + off, 0.16, alongX ? z + off : z)
              if (!alongX) veh.rotation.y = Math.PI / 2
              veh.userData.fpKey = f.key
              g.add(veh)
              const lab = makeLabel(THREE, cont && v.container_number ? `${pl} · ${v.container_number}` : pl, '#ffffff', 'rgba(15,23,42,0.85)', 1.3)
              lab.position.set(veh.position.x, (cont ? 4.1 : 3.6) + 0.9, veh.position.z)
              g.add(lab)
            })
          }
          if (showLabels || selected) {
            const lab = makeLabel(THREE, `${f.label}${dk ? ` · ${dk.occupied}/${dk.capacity ?? '∞'} xe` : ''}`, '#ffffff', full ? 'rgba(220,38,38,0.9)' : 'rgba(21,128,61,0.85)', 1.2)
            lab.position.set(x, list.length ? 6.6 : 1.4, z)
            g.add(lab)
          }
        }
      }
      world.add(g)
    }

    // Đẩy các khối lặp: 1 draw call mỗi loại thay vì mỗi khối một mesh
    const pushInstanced = (pieces: Piece[], color: string, perInstanceColor: boolean) => {
      if (!pieces.length) return
      // Có màu theo từng khối thì màu VẬT LIỆU phải là TRẮNG — three nhân material.color × instanceColor,
      // để nguyên màu nền sẽ ra một màu tối thứ ba không ai đặt.
      const m = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshLambertMaterial({ color: new THREE.Color(perInstanceColor ? '#ffffff' : color) }),
        pieces.length)
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3()
      const col = new THREE.Color()
      pieces.forEach((pc, i) => {
        v.set(pc.x, pc.y, pc.z); s.set(pc.sx, pc.sy, pc.sz)
        m4.compose(v, q, s)
        m.setMatrixAt(i, m4)
        if (perInstanceColor) m.setColorAt(i, col.set(pc.color ?? color))
      })
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
      m.userData.instKeys = pieces.map(x => x.key ?? '')
      world.add(m)
    }
    pushInstanced(posts, RACK_COLOR, false)
    pushInstanced(beams, RACK_COLOR, false)
    pushInstanced(palletBases, palletColor, false)
    pushInstanced(palletLoads, LOAD_COLOR, true)

    // Đặt camera lần đầu cho kho này (đổi kho → đặt lại; đổi dữ liệu → giữ góc người dùng đang xem).
    // Ngắm vào HỘP BAO của những gì đã vẽ (chân kệ + cửa + tường), không phải cả khung: Ba Vì khung 200×200 ô
    // nhưng chỉ dùng ~100×110 → ngắm cả khung thì mô hình bé bằng bàn tay (chụp 09/09).
    const frameKey = `${p.frame.width}x${p.frame.height}@${cm}`
    if (framedRef.current !== frameKey) {
      framedRef.current = frameKey
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const f of p.footprints) if (f.anchor) { x0 = Math.min(x0, f.anchor.x); y0 = Math.min(y0, f.anchor.y); x1 = Math.max(x1, f.anchor.x + f.w); y1 = Math.max(y1, f.anchor.y + f.h) }
      for (const [bx, by] of p.blocked) { x0 = Math.min(x0, bx); y0 = Math.min(y0, by); x1 = Math.max(x1, bx + 1); y1 = Math.max(y1, by + 1) }
      if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = p.frame.width; y1 = p.frame.height }
      const bw = (x1 - x0) * cm, bd = (y1 - y0) * cm
      const tx = x0 * cm + bw / 2, tz = y0 * cm + bd / 2
      const span = Math.max(bw, bd, 10)
      c.controls.target.set(tx, 0, tz)
      c.camera.position.set(tx + span * 0.5, span * 0.65, tz + span * 0.8)
      c.camera.near = 0.5; c.camera.far = Math.max(W, D) * 20; c.camera.updateProjectionMatrix()
      c.controls.update()
    }
  }, [ready, p.frame.width, p.frame.height, p.cellM, p.blocked, p.footprints, p.zoneColor, p.occByLoc, p.dockByLoc, p.selectedKey, palletColor])

  // Khung gốc PHẢI là hộp có kích thước và đã định vị (caller truyền `absolute inset-0` hoặc `relative flex-1 min-h-0`).
  // Bẫy đã dính 09/09: tự thêm `relative` vào className `absolute inset-0` → Tailwind cho `relative` thắng ⇒ hộp cao 0,
  // canvas 0×0, 3D "trống" mà không lỗi nào.
  return (
    <div className={p.className ?? 'relative h-full w-full'}>
      <div ref={mountRef} className="absolute inset-0" />
      {webglError && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-xs text-red-600">Không dựng được 3D trên thiết bị này ({webglError}). Dùng bản vẽ 2D.</div>
      )}
      {!ready && !webglError && <div className="absolute inset-0 grid place-items-center text-xs text-slate-400">Đang dựng 3D…</div>}
      <div className="absolute left-2 bottom-2 rounded bg-white/85 px-2 py-1 text-[10px] text-slate-600 shadow-sm pointer-events-none">
        Kéo: xoay · Lăn: phóng · Chuột phải: rê · Bấm khối: cột tầng · Kệ cam · Mỗi khối = 1 pallet đang có hàng · Nền màu khu = chỗ trống · Cam = QA giữ · Đỏ = cửa đủ xe
      </div>
    </div>
  )
}
