// Khung 3D sơ đồ xếp xe (chép từ cảnh 3D của MalCargo): xe dựng theo đúng lòng thùng, trời + sân bãi, nắng đổ bóng, che khuất
// môi trường khi đứng yên. Dựng một lần, thay xe / hàng / bước / góc nhìn theo props mà không dựng lại cảnh.
// CHỈ nạp qua `lazy()` ở LoadPlan3DDialog — three nặng, không kéo vào gói chính.
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import type { LoadPlan } from '@/utils/loadPlan'
import { buildTruck, type TruckHandle } from './truckModel'
import { buildCargo, type CargoHandle, type CartonPrint, type SceneGroup } from './cargo'
import { buildMarks, type MarksHandle, type SceneMarks } from './marks'
import { concreteTexture } from './textures'

export type ViewPreset = 'overview' | 'rear' | 'top' | 'side'
export type { CartonPrint, SceneGroup, SceneMarks }

export interface TruckSceneProps {
  truck: { l: number; w: number; h: number; container?: boolean; plate?: string } | null
  plan?: LoadPlan | null
  meta?: SceneGroup[]
  colors?: Map<string, string>
  prints?: Map<string, CartonPrint>   // chữ in trên thùng từng mã (tên, mã) + cỡ thùng gốc
  step?: number | null
  focus?: Set<number> | null
  marks?: SceneMarks | null   // nhãn tên mảng hàng + số lớp theo vùng
  view?: { preset: ViewPreset; n: number }
  walls?: 'glass' | 'open'
  className?: string
}

interface Ctx {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  sun: THREE.DirectionalLight
  blob: THREE.Mesh
  ao: GTAOPass | null
  truck: TruckHandle | null
  cargo: CargoHandle | null
  marks: MarksHandle | null
  walls: 'glass' | 'open'
  dirty: boolean
  moved: boolean
  tween: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t0: number; dur: number } | null
}

// Trời ngoài bãi: xanh nhạt trên đỉnh, chân trời mờ sáng (trùng màu sương xa của nền), dưới chân trời màu sân
const SKY = { zenith: '#7ea4d2', horizon: '#dfe5ec', ground: '#9ca1a7' }
const SUN_DIR = new THREE.Vector3(-0.32, 0.82, 0.48).normalize()

function skyMaterial(glow: number) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      zenith: { value: new THREE.Color(SKY.zenith) }, horizon: { value: new THREE.Color(SKY.horizon) }, ground: { value: new THREE.Color(SKY.ground) },
      sunDir: { value: SUN_DIR }, glow: { value: glow },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; uniform float glow;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = d.y > 0.0 ? mix(horizon, zenith, pow(d.y, 0.6)) : mix(horizon, ground, pow(min(-d.y * 5.0, 1.0), 0.7));
        float s = max(dot(d, sunDir), 0.0);
        c += glow * (0.12 * pow(s, 6.0) + 0.5 * pow(s, 90.0) + 6.0 * pow(s, 1800.0)) * vec3(1.0, 0.95, 0.86);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
}

export default function TruckScene(p: TruckSceneProps) {
  const host = useRef<HTMLDivElement>(null)
  const ctx = useRef<Ctx | null>(null)
  const fitted = useRef('')   // cỡ xe camera đang căn theo
  const [noGL, setNoGL] = useState(false)

  // ── dựng cảnh một lần ────────────────────────────────────────────────────
  useEffect(() => {
    const el = host.current!
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true })
    } catch { setNoGL(true); return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = 1.0
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    el.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.touchAction = 'none'

    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(new THREE.Color(SKY.horizon), 30, 90)
    // trời: vòm theo camera (luôn ở xa nhất) + bản mờ của chính nó làm ánh sáng môi trường / phản chiếu sơn, kính
    const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial(0.35))
    dome.frustumCulled = false; dome.renderOrder = -1; dome.userData.noAO = true
    scene.add(dome)
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envScene = new THREE.Scene()
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial(1)))
    const envTex = pmrem.fromScene(envScene, 0.02).texture
    envScene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose() } })
    scene.environment = envTex
    scene.environmentIntensity = 0.9

    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 220)
    camera.position.set(12, 6, 9)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.495
    controls.minDistance = 1.5
    controls.maxDistance = 45
    controls.zoomToCursor = true
    controls.screenSpacePanning = true

    const sun = new THREE.DirectionalLight('#fff4e4', 2.7)
    sun.castShadow = true
    const coarse = window.matchMedia?.('(pointer: coarse)').matches
    sun.shadow.mapSize.set(coarse ? 2048 : 4096, coarse ? 2048 : 4096)
    sun.shadow.bias = -0.0002
    sun.shadow.normalBias = 0.02
    sun.shadow.radius = 3
    scene.add(sun, sun.target)
    scene.add(new THREE.HemisphereLight('#eaf1ff', '#8d8a84', 0.25))

    const groundTex = concreteTexture(); groundTex.repeat.set(75, 75)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      new THREE.MeshStandardMaterial({ map: groundTex, color: '#c3c7cc', roughness: 0.93 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)
    // bóng mờ sát gầm — xe "đứng" trên nền chứ không lơ lửng
    const blobCanvas = document.createElement('canvas'); blobCanvas.width = blobCanvas.height = 128
    const bc = blobCanvas.getContext('2d')!
    const rg = bc.createRadialGradient(64, 64, 8, 64, 64, 64)
    rg.addColorStop(0, 'rgba(0,0,0,0.45)'); rg.addColorStop(0.55, 'rgba(0,0,0,0.18)'); rg.addColorStop(1, 'rgba(0,0,0,0)')
    bc.fillStyle = rg; bc.fillRect(0, 0, 128, 128)
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(blobCanvas), transparent: true, depthWrite: false }))
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.003; blob.userData.noAO = true
    scene.add(blob)

    // Che khuất môi trường (GTAO): khe giữa các thùng, gầm xe, chân pallet tối đi như thật. Chỉ vẽ khi khung
    // ĐỨNG YÊN (đang xoay / kéo thì vẽ thường cho mượt), hiện dần qua vài khung hình. Máy không chạy được ⇒ bỏ qua.
    let composer: EffectComposer | null = null, ao: GTAOPass | null = null
    try {
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
      composer = new EffectComposer(renderer, rt)
      composer.addPass(new RenderPass(scene, camera))
      ao = new GTAOPass(scene, camera, 1, 1)
      ao.updateGtaoMaterial({ radius: 0.32, distanceExponent: 1.4, thickness: 1, scale: 1, samples: 16 })
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 16 })
      // vật trong suốt (vách kính, khối đang làm mờ, viền bước, vạch sơn) + trời không được "che" vật phía sau.
      // Móc vào hàm nội bộ của GTAOPass (three r185); bản sau đổi tên ⇒ ném lỗi ⇒ chạy không có che khuất.
      const inner = ao as unknown as { _overrideVisibility: () => void; _visibilityCache: THREE.Object3D[] }
      const orig = inner._overrideVisibility.bind(ao)
      inner._overrideVisibility = () => {
        orig()
        scene.traverse(o => {
          const m = o as THREE.Mesh
          if (!(m.isMesh || (o as THREE.Sprite).isSprite) || !m.visible) return
          const mat = Array.isArray(m.material) ? m.material[0] : m.material
          if (m.userData.noAO || mat?.transparent) { m.visible = false; inner._visibilityCache.push(m) }
        })
      }
      composer.addPass(ao)
      composer.addPass(new OutputPass())
    } catch { composer = null; ao = null }

    const c: Ctx = { renderer, scene, camera, controls, sun, blob, ao, truck: null, cargo: null, marks: null, walls: 'open', dirty: true, moved: false, tween: null }
    ctx.current = c
    controls.addEventListener('change', () => { c.dirty = true; c.moved = true })

    // Khung đổi cỡ (toàn màn hình, xoay máy): lùi / tiến camera theo góc nhìn hẹp nhất để xe vẫn lọt khung như
    // trước — giữ nguyên góc người dùng đang xoay, không nhảy về góc mặc định
    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1
      renderer.setSize(w, h, false)
      renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'
      if (composer) {
        composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h)
        // màn mật độ cao: tính che khuất ở nửa độ phân giải (mắt không phân biệt, đỡ nặng máy)
        if (ao && renderer.getPixelRatio() > 1.5) ao.setSize(w * renderer.getPixelRatio() / 2, h * renderer.getPixelRatio() / 2)
      }
      const before = fitFov(camera)
      camera.aspect = w / h; camera.updateProjectionMatrix(); c.dirty = true
      const k = Math.sin(before / 2) / Math.sin(fitFov(camera) / 2)
      if (!c.truck || Math.abs(k - 1) < 0.01) return
      const back = (pos: THREE.Vector3, tgt: THREE.Vector3) => pos.sub(tgt).multiplyScalar(k).add(tgt)
      back(camera.position, controls.target)
      if (c.tween) back(c.tween.to, c.tween.tTo)
    }
    const ro = new ResizeObserver(resize); ro.observe(el); resize()

    let raf = 0, settle = 0, aoStep = 3
    const FADE = [0.4, 0.75, 1]
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (c.tween) {
        const k = Math.min(1, (now - c.tween.t0) / c.tween.dur)
        const e = 1 - Math.pow(1 - k, 3)
        camera.position.lerpVectors(c.tween.from, c.tween.to, e)
        controls.target.lerpVectors(c.tween.tFrom, c.tween.tTo, e)
        if (k >= 1) c.tween = null
        c.dirty = true; c.moved = true
      }
      if (controls.update()) { c.dirty = true; c.moved = true }
      dome.position.copy(camera.position)
      if (c.truck?.setView(c.walls, camera.position.z)) c.dirty = true
      if (c.moved) {
        c.moved = false; c.dirty = false; settle = now + 160; aoStep = 0
        renderer.render(scene, camera)
        return
      }
      if (!composer || !ao) { if (c.dirty) { c.dirty = false; renderer.render(scene, camera) } return }
      if (now < settle) return
      if (c.dirty || aoStep < FADE.length) {
        ao.blendIntensity = FADE[Math.min(aoStep, FADE.length - 1)]
        aoStep = Math.min(FADE.length, aoStep + 1)
        c.dirty = false
        composer.render()
      }
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose()
      c.cargo?.dispose(); c.marks?.dispose(); c.truck?.dispose()
      composer?.dispose(); ao?.dispose()
      envTex.dispose(); pmrem.dispose(); groundTex.dispose()
      scene.traverse(o => {
        const m = o as THREE.Mesh
        if (m.isMesh) { m.geometry?.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x?.dispose()) }
      })
      renderer.dispose(); renderer.domElement.remove(); ctx.current = null
    }
  }, [])

  // ── xe ───────────────────────────────────────────────────────────────────
  // Đổi Xe thường ↔ Xe pallet không đụng tới xe: thân xe giống hệt, chỉ hàng đổi
  const fk = p.truck ? `${p.truck.l}|${p.truck.w}|${p.truck.h}|${p.truck.container ? 1 : 0}` : ''
  const tk = p.truck ? `${fk}|${p.truck.plate ?? ''}` : ''
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    if (c.truck) { c.scene.remove(c.truck.group); c.truck.dispose(); c.truck = null }
    if (!p.truck) { c.dirty = true; return }
    const t = buildTruck({ L: p.truck.l / 1000, W: p.truck.w / 1000, H: p.truck.h / 1000, container: p.truck.container, plate: p.truck.plate })
    c.truck = t
    c.scene.add(t.group)
    const b = t.bounds
    const cx = (b.minX + b.maxX) / 2, len = b.maxX - b.minX
    c.blob.scale.set(len + 1.6, b.halfW * 2 + 1.2, 1); c.blob.position.x = cx
    const span = Math.max(len, 4)
    const d = span * 1.6 + 6
    c.sun.position.set(cx + SUN_DIR.x * d, SUN_DIR.y * d, SUN_DIR.z * d)
    c.sun.target.position.set(cx, 0, 0)
    const sc = c.sun.shadow.camera
    const ext = span * 0.62 + 1
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext
    sc.near = 0.5; sc.far = d * 2; sc.updateProjectionMatrix()
    // vùng tính che khuất bám quanh xe — số đo sâu chính xác hơn
    c.ao?.setSceneClipBox(new THREE.Box3(new THREE.Vector3(b.minX - 3, -0.5, -b.halfW - 3), new THREE.Vector3(b.maxX + 3, b.topY + 1, b.halfW + 3)))
    t.setView(c.walls, c.camera.position.z)
    // xe khác cỡ mới căn lại camera; cùng cỡ (đổi biển số) giữ góc người dùng đang xem
    if (fitted.current !== fk) { fitted.current = fk; goTo(c, 'overview', false) }
    c.dirty = true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tk])

  // ── hàng ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    if (c.cargo) { c.scene.remove(c.cargo.group); c.cargo.dispose(); c.cargo = null }
    if (p.plan && c.truck && p.meta && p.colors && p.plan.placed.length) {
      const cg = buildCargo(p.plan, p.meta, p.colors, c.truck.floorY, p.prints)
      c.cargo = cg
      c.scene.add(cg.group)
      cg.setStep(p.step ?? null)
      cg.setFocus(p.focus ?? null)
    }
    c.dirty = true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.plan, p.meta, p.colors, p.prints, tk])

  // ── nhãn ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    if (c.marks) { c.scene.remove(c.marks.group); c.marks.dispose(); c.marks = null }
    if (p.marks && p.truck && c.truck) {
      c.marks = buildMarks(p.marks, { length: p.truck.l, width: p.truck.w, height: p.truck.h }, c.truck.floorY)
      c.scene.add(c.marks.group)
    }
    c.dirty = true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.marks, tk])

  useEffect(() => { const c = ctx.current; if (c?.cargo) { c.cargo.setStep(p.step ?? null); c.dirty = true } }, [p.step])
  useEffect(() => { const c = ctx.current; if (c?.cargo) { c.cargo.setFocus(p.focus ?? null); c.dirty = true } }, [p.focus])
  useEffect(() => { const c = ctx.current; if (c) { c.walls = p.walls ?? 'open'; c.dirty = true } }, [p.walls])
  useEffect(() => { const c = ctx.current; if (c && p.view) goTo(c, p.view.preset, true) }, [p.view?.n])

  return (
    <div ref={host} className={`overflow-hidden ${p.className ?? 'relative'}`}>
      {noGL && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-500">
          Trình duyệt này không hiển thị được 3D. Số liệu bên cạnh vẫn dùng bình thường.
        </div>
      )}
    </div>
  )
}

/** Góc nhìn hẹp nhất của khung (dọc hay ngang) — khối cầu bao xe phải lọt trong góc này. */
function fitFov(camera: THREE.PerspectiveCamera) {
  const vfov = THREE.MathUtils.degToRad(camera.fov)
  return Math.min(vfov, 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect))
}

function goTo(c: Ctx, preset: ViewPreset, animate: boolean) {
  const t = c.truck
  if (!t) return
  const b = t.bounds
  const cx = (b.minX + b.maxX) / 2, len = b.maxX - b.minX
  // Căn khung theo KHỐI CẦU bao xe + góc nhìn ngang/dọc của khung — xe nào, màn nào cũng lọt trọn
  const fov = fitFov(c.camera)
  const sphere = (dx: number, dy: number, dz: number) => 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz)
  const dist = (rad: number, k: number) => (rad / Math.sin(fov / 2)) * k
  const tgt = new THREE.Vector3(cx, b.topY * 0.5, 0)
  let dir: THREE.Vector3, rad: number, k = 0.9
  switch (preset) {
    case 'rear':
      dir = new THREE.Vector3(1, 0.32, 0.22); rad = sphere(b.halfW * 2, b.topY, 2); k = 1.05
      tgt.set(b.maxX - 1.2, t.floorY + (b.topY - t.floorY) * 0.45, 0); break
    case 'top':
      dir = new THREE.Vector3(0.0001, 1, 0.0001); rad = sphere(len, 0, b.halfW * 2); k = 1.0
      tgt.set(cx, t.floorY, 0); break
    case 'side':
      dir = new THREE.Vector3(0, 0.16, 1); rad = sphere(len, b.topY, 0); k = 1.0; break
    default:
      // nhỉnh hơn khối cầu để cánh cửa mở ở đuôi không chạm mép; tâm hơi thấp để xe nằm trên thanh bước
      dir = new THREE.Vector3(0.62, 0.5, 0.78); rad = sphere(len + 0.8, b.topY, b.halfW * 2); k = 0.95
      tgt.y = b.topY * 0.36
  }
  const pos = tgt.clone().addScaledVector(dir.normalize(), Math.max(dist(rad, k), 2.5))
  if (!animate) {
    c.camera.position.copy(pos); c.controls.target.copy(tgt); c.controls.update(); c.dirty = true; return
  }
  c.tween = { from: c.camera.position.clone(), to: pos, tFrom: c.controls.target.clone(), tTo: tgt, t0: performance.now(), dur: 650 }
}
