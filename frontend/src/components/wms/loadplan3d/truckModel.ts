// Xe dựng bằng code theo ĐÚNG lòng thùng khai — cabin, bánh, gầm co giãn theo cỡ xe (xe 1,5 tấn khác xe 15 tấn),
// không dùng mô hình tải về vì mô hình cố định không khớp kích thước. Dòng container: đầu kéo + rơ-moóc sàn
// khung + vỏ container tôn sóng.
// Hệ toạ độ (mét): X dọc thân xe (0 = mặt trong vách đầu thùng, cabin ở phía X âm), Y lên trên,
// Z bề ngang (giữa xe = 0). Lòng thùng: x∈[0,L] · y∈[floorY, floorY+H] · z∈[-W/2, W/2].
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { floorTexture, glassTexture, grilleTexture, lineTexture, panelTexture, plateTexture, sidewallTexture, tapeTexture, treadTexture } from './textures'

export interface TruckDimsM { L: number; W: number; H: number; container?: boolean; plate?: string }
export type WallMode = 'open' | 'glass'

export interface TruckHandle {
  group: THREE.Group
  floorY: number
  bounds: { minX: number; maxX: number; topY: number; halfW: number }
  /** 'open' = bỏ vách phía người xem + nóc (mặt cắt, thấy hàng); 'glass' = đủ vách, trong suốt. Trả true nếu có đổi. */
  setView: (mode: WallMode, camZ: number) => boolean
  dispose: () => void
}

const clamp = THREE.MathUtils.clamp
type Mat = THREE.Material | THREE.Material[]

// ── bộ dụng cụ chung: vật liệu + hàm đặt khối, gom mọi thứ cần dispose ─────────────────────────
function makeKit() {
  const g = new THREE.Group()
  const disposables: { dispose: () => void }[] = []
  const track = <T extends { dispose: () => void }>(x: T) => { disposables.push(x); return x }
  const std = (p: THREE.MeshStandardMaterialParameters) => track(new THREE.MeshStandardMaterial(p))
  const tread = track(treadTexture())
  tread.wrapS = THREE.RepeatWrapping
  const tape = track(tapeTexture())
  tape.wrapS = THREE.RepeatWrapping
  const M = {
    paint: track(new THREE.MeshPhysicalMaterial({ color: '#f4f5f7', roughness: 0.3, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.06 })),
    alu: std({ color: '#b6bdc6', roughness: 0.32, metalness: 0.9 }),
    dark: std({ color: '#2b2f36', roughness: 0.62, metalness: 0.45 }),
    black: std({ color: '#18191c', roughness: 0.72, metalness: 0.08 }),
    blackIn: std({ color: '#141518', roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide }),   // lòng hốc bánh
    rubber: std({ color: '#1a1b1d', roughness: 0.95 }),
    chrome: std({ color: '#e6e9ee', roughness: 0.12, metalness: 1 }),
    steel: std({ color: '#c3c8ce', roughness: 0.4, metalness: 0.6 }),
    rim: std({ color: '#d4d8dd', roughness: 0.38, metalness: 0.55, side: THREE.DoubleSide }),   // mâm thép sơn
    navy: std({ color: '#0b1424', roughness: 0.45 }),
    brand: std({ color: '#1a66ff', roughness: 0.4 }),
    glass: track(new THREE.MeshPhysicalMaterial({ map: track(glassTexture()), roughness: 0.03, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.8, side: THREE.DoubleSide })),
    head: std({ color: '#f4f8ff', emissive: '#dfe9ff', emissiveIntensity: 0.25, roughness: 0.08, metalness: 0.7 }),
    amber: std({ color: '#f0a020', emissive: '#a35f00', emissiveIntensity: 0.35, roughness: 0.25 }),
    red: std({ color: '#c0182a', emissive: '#7a0010', emissiveIntensity: 0.45, roughness: 0.25 }),
    white: std({ color: '#f2f2f0', emissive: '#555555', emissiveIntensity: 0.2, roughness: 0.2 }),
    grille: std({ map: track(grilleTexture()), roughness: 0.5, metalness: 0.5 }),
    tread: std({ map: tread, bumpMap: tread, bumpScale: 2.5, roughness: 0.95 }),
    tireSide: std({ map: track(sidewallTexture()), roughness: 0.9 }),
    tape: std({ map: tape, roughness: 0.25, metalness: 0.1, emissive: '#ffffff', emissiveIntensity: 0.06 }),
    // chế độ "Hiện vách": vách + nóc trong suốt để vẫn thấy hàng
    wallGlass: track(new THREE.MeshPhysicalMaterial({ color: '#e8eef6', roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide })),
  }
  const geo = <T extends THREE.BufferGeometry>(x: T) => track(x)
  const mesh = (gm: THREE.BufferGeometry, m: Mat, x: number, y: number, z: number, cast = true, parent: THREE.Object3D = g) => {
    const o = new THREE.Mesh(gm, m)
    o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = true
    parent.add(o)
    return o
  }
  const box = (w: number, h: number, d: number, m: Mat, x: number, y: number, z: number, cast = true, parent: THREE.Object3D = g) =>
    mesh(geo(new THREE.BoxGeometry(w, h, d)), m, x, y, z, cast, parent)
  const rbox = (w: number, h: number, d: number, rad: number, m: Mat, x: number, y: number, z: number) =>
    mesh(geo(new RoundedBoxGeometry(w, h, d, 3, rad)), m, x, y, z)
  const cyl = (r: number, len: number, m: Mat, x: number, y: number, z: number, axis: 'x' | 'y' | 'z', seg = 20) => {
    const c = geo(new THREE.CylinderGeometry(r, r, len, seg))
    if (axis === 'x') c.rotateZ(Math.PI / 2); else if (axis === 'z') c.rotateX(Math.PI / 2)
    return mesh(c, m, x, y, z)
  }
  /** Decal phản quang đỏ-trắng: ô lặp 0,5 m theo chiều dài. */
  const tapeBox = (w: number, h: number, d: number, len: number, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const t = track(tape.clone()); t.repeat.set(Math.max(1, Math.round(len / 0.5)), 1)
    const m = track(M.tape.clone()); m.map = t
    return box(w, h, d, m, x, y, z, false, parent)
  }
  return { g, track, geo, mesh, box, rbox, cyl, tapeBox, M, dispose: () => disposables.forEach(x => x.dispose()) }
}
type Kit = ReturnType<typeof makeKit>

/** UV 0..1 theo khung bao — ShapeGeometry mặc định lấy toạ độ mét làm UV (vân kính bị kéo về một màu). */
function fitUV<T extends THREE.BufferGeometry>(gm: T): T {
  gm.computeBoundingBox()
  const b = gm.boundingBox!, p = gm.attributes.position, uv = gm.attributes.uv
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - b.min.x) / (b.max.x - b.min.x || 1), (p.getY(i) - b.min.y) / (b.max.y - b.min.y || 1))
  uv.needsUpdate = true
  return gm
}

/** Một tấm hai mặt: mặt ngoài (sơn vỏ) và mặt trong (lót, vật liệu BackSide) dùng chung hình. */
function skinPair(k: Kit, gm: THREE.BufferGeometry, outer: THREE.Material, inner: THREE.Material, place: (o: THREE.Object3D) => void) {
  const a = new THREE.Mesh(gm, outer), b = new THREE.Mesh(gm, inner)
  for (const o of [a, b]) { place(o); o.castShadow = true; o.receiveShadow = true; k.g.add(o) }
  return { outer: a, inner: b }
}

/** Tôn sóng hình thang: sóng chạy theo X (dài `len`), cao `hgt` theo Y, gân nhô về +Z. */
function corrugated(len: number, hgt: number, pitch: number, depth: number): THREE.BufferGeometry {
  const n = Math.max(1, Math.round(len / pitch)), p = len / n, a = p * 0.3, sl = p * 0.2
  const pts: [number, number][] = [[0, 0]]
  for (let i = 0; i < n; i++) {
    const u = i * p
    pts.push([u + a, 0], [u + a + sl, depth], [u + 2 * a + sl, depth], [u + p, 0])
  }
  const pos: number[] = [], uv: number[] = []
  for (let j = 0; j < pts.length - 1; j++) {
    const [u0, z0] = pts[j], [u1, z1] = pts[j + 1]
    for (const [x, y, z] of [[u0, 0, z0], [u1, 0, z1], [u1, hgt, z1], [u0, 0, z0], [u1, hgt, z1], [u0, hgt, z0]]) {
      pos.push(x, y, z); uv.push(x / len, y / hgt)
    }
  }
  const gm = new THREE.BufferGeometry()
  gm.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  gm.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  gm.computeVertexNormals()
  return gm
}

/** Bật / tắt vách theo chế độ + phía người xem đứng (`sides[1]` = vách phía +Z). */
function wallSwitch(sides: Record<1 | -1, THREE.Object3D[]>, roof: THREE.Object3D[], liners: THREE.Object3D[], skins: { mesh: THREE.Mesh; mat: Mat }[], glass: THREE.Material) {
  let mode: WallMode | null = null, side: 1 | -1 = 1
  return (m: WallMode, camZ: number) => {
    // vùng đệm quanh giữa xe: nhìn thẳng từ cửa sau / từ trên thì không lật qua lật lại
    const s: 1 | -1 = camZ > 0.6 ? 1 : camZ < -0.6 ? -1 : side
    if (m === mode && (s === side || m === 'glass')) return false
    mode = m; side = s
    for (const sd of [1, -1] as const) for (const o of sides[sd]) o.visible = m === 'glass' || sd !== side
    for (const o of roof) o.visible = m === 'glass'
    if (m === 'glass') for (const o of liners) o.visible = false
    for (const sk of skins) sk.mesh.material = m === 'glass' ? glass : sk.mat
    return true
  }
}

// ── BÁNH: lốp có gai, hông lốp, mâm thép sơn có lỗ + ốc, moay-ơ ──────────────────────────────────
function wheelMaker(k: Kit, r: number, tw: number) {
  const { M, geo } = k
  const tire = geo(new THREE.CylinderGeometry(r, r, tw, 56, 1, true))
  tire.rotateX(Math.PI / 2)
  const sh = tw * 0.16
  const shoulder = geo(new THREE.TorusGeometry(r - sh, sh, 10, 56))
  const rr = r * 0.6
  const wall = geo(new THREE.RingGeometry(rr * 0.98, r - sh, 48, 1))
  const back = geo(new THREE.CircleGeometry(r - sh, 32))
  // đĩa mâm lõm (tiện quanh trục Y rồi quay về trục Z, mặt ngoài hướng +Z)
  const dish = geo(new THREE.LatheGeometry([
    new THREE.Vector2(0.001, tw * 0.36), new THREE.Vector2(rr * 0.3, tw * 0.36), new THREE.Vector2(rr * 0.42, tw * 0.32),
    new THREE.Vector2(rr * 0.62, tw * 0.28), new THREE.Vector2(rr * 0.9, tw * 0.42), new THREE.Vector2(rr * 0.98, tw * 0.46),
  ], 40))
  dish.rotateX(Math.PI / 2)
  // 8 lỗ trên đĩa mâm + 10 ốc quanh moay-ơ: gộp mỗi loại thành một khối
  const holes = geo(mergeGeometries(Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2, c = new THREE.CircleGeometry(rr * 0.1, 14)
    c.scale(1, 1.5, 1); c.rotateZ(a + Math.PI / 2); c.translate(Math.cos(a) * rr * 0.66, Math.sin(a) * rr * 0.66, tw * 0.315)
    return c
  })))
  const nuts = geo(mergeGeometries(Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2, c = new THREE.CylinderGeometry(rr * 0.045, rr * 0.045, 0.04, 6)
    c.rotateX(Math.PI / 2); c.translate(Math.cos(a) * rr * 0.3, Math.sin(a) * rr * 0.3, tw * 0.37)
    return c
  })))
  const hub = geo(new THREE.CylinderGeometry(rr * 0.2, rr * 0.25, 0.1, 24))
  hub.rotateX(Math.PI / 2); hub.translate(0, 0, tw * 0.38)
  /** `face` = hướng mặt mâm (+1 ra +Z, -1 ra -Z); `inner` = bánh trong của cặp bánh đôi (chỉ thấy lốp). */
  return (x: number, z: number, face: 1 | -1, inner = false, front = false) => {
    const wg = new THREE.Group()
    const add = (gm: THREE.BufferGeometry, m: THREE.Material, cast = false) => { const o = new THREE.Mesh(gm, m); o.castShadow = cast; o.receiveShadow = true; wg.add(o); return o }
    add(tire, M.tread, true)
    for (const sz of [tw / 2 - sh, -(tw / 2 - sh)]) add(shoulder, M.rubber, true).position.z = sz
    add(wall, M.tireSide).position.z = tw / 2 - sh * 0.4
    const b = add(back, M.dark); b.position.z = -tw / 2 + sh * 0.4; b.rotation.y = Math.PI
    if (!inner) {
      add(dish, M.rim, true)
      add(holes, M.blackIn)
      add(nuts, M.chrome)
      add(hub, front ? M.chrome : M.dark)
    }
    wg.position.set(x, r, z)
    if (face < 0) wg.rotation.y = Math.PI
    k.g.add(wg)
  }
}

// ── CABIN đầu bằng: tiết diện hông đùn theo bề ngang, có hốc bánh trước, kính, gương, đèn, cản ──────
interface CabSpec { xf: number; cl: number; cw: number; cb: number; cabTop: number; r: number; frontX: number; heavy: boolean; plate?: string; boxTop: number }
function buildCab(k: Kit, c: CabSpec) {
  const { M, box, rbox, g, geo } = k
  const { xf, cl, cw, cb, cabTop, r, frontX, heavy } = c
  const cabRear = xf + cl
  const beltY = cb + (cabTop - cb) * 0.46
  const slant = 0.12 + (heavy ? 0.08 : 0.04)
  const bev = 0.08
  // hốc bánh: viền vát của khối đùn làm hốc hẹp lại đúng bằng `bev` ⇒ vẽ rộng hơn để hốc thật = Rv
  const Rv = r + 0.06, R = Rv + bev
  const yb = cb + bev
  const th0 = Math.asin(clamp((yb - r) / R, -0.99, 0.99))
  const thv = Math.asin(clamp((cb - r) / Rv, -0.99, 0.99))
  const prof = new THREE.Shape()
  prof.moveTo(cabRear - bev, yb)
  prof.lineTo(frontX + R * Math.cos(th0), yb)
  prof.absarc(frontX, r, R, th0, Math.PI - th0, false)    // vòng qua đỉnh bánh
  prof.lineTo(xf + bev + 0.04, yb)
  prof.lineTo(xf + bev, yb + 0.12)
  prof.lineTo(xf + bev, beltY)
  prof.lineTo(xf + bev + slant, cabTop - bev - 0.08)
  prof.quadraticCurveTo(xf + bev + slant + 0.03, cabTop - bev, xf + bev + slant + 0.24, cabTop - bev)
  prof.lineTo(cabRear - bev, cabTop - bev)
  prof.closePath()
  const cabGeo = geo(new THREE.ExtrudeGeometry(prof, { depth: cw - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 5, curveSegments: 14 }))
  cabGeo.translate(0, 0, -(cw - 2 * bev) / 2)
  const cab = new THREE.Mesh(cabGeo, M.paint)
  cab.castShadow = true; cab.receiveShadow = true
  g.add(cab)
  // lòng hốc bánh (nhựa đen) + viền vè nổi; khối máy giữa hai hốc — không nhìn xuyên dưới cabin
  const wd = 0.42
  const liner = geo(new THREE.CylinderGeometry(Rv, Rv, wd, 28, 1, true, Math.PI / 2 + thv, Math.PI - 2 * thv))
  liner.rotateX(Math.PI / 2)
  const trim = new THREE.Shape()
  trim.absarc(0, 0, Rv + 0.055, thv, Math.PI - thv, false)
  trim.absarc(0, 0, Rv - 0.005, Math.PI - thv, thv, true)
  const trimGeo = geo(new THREE.ExtrudeGeometry(trim, { depth: 0.03, bevelEnabled: false, curveSegments: 24 }))
  for (const sd of [1, -1]) {
    const l = new THREE.Mesh(liner, M.blackIn)
    l.position.set(frontX, r, sd * (cw / 2 - wd / 2 + 0.01)); g.add(l)
    const tm = new THREE.Mesh(trimGeo, M.black)
    tm.position.set(frontX, r, sd > 0 ? cw / 2 - 0.012 : -cw / 2 - 0.018); tm.castShadow = true
    g.add(tm)
  }
  box(2 * Rv * Math.cos(thv) - 0.02, r + Rv - cb - 0.05, cw - 2 * wd, M.dark, frontX, (cb + r + Rv - 0.05) / 2, 0, false)

  // kính chắn gió + viền cao su đen, nằm trên mặt ngả phía trước
  {
    const A = new THREE.Vector2(xf, beltY + 0.05), B = new THREE.Vector2(xf + slant, cabTop - 0.16)
    const dir = B.clone().sub(A), len = dir.length(); dir.normalize()
    const n = new THREE.Vector3(-dir.y, dir.x, 0)
    const mid = new THREE.Vector3((A.x + B.x) / 2, (A.y + B.y) / 2, 0)
    const face = (w: number, h: number, m: THREE.Material, off: number) => {
      const o = new THREE.Mesh(geo(new THREE.PlaneGeometry(w, h)), m)
      const p = mid.clone().addScaledVector(n, off)
      o.position.copy(p); o.up.set(dir.x, dir.y, 0); o.lookAt(p.clone().add(n)); g.add(o)
    }
    face(cw - 0.16, len + 0.07, M.black, 0.003)
    face(cw - 0.26, len - 0.02, M.glass, 0.006)
    for (const z of [-cw * 0.2, cw * 0.18]) {
      const wp = box(0.014, 0.014, cw * 0.34, M.black, A.x - 0.008, A.y + 0.04, z)
      wp.rotation.x = 0.22
    }
  }
  // hông: cửa (kính + khung, khe cửa, tay nắm), kính sau nhỏ, sọc thương hiệu, bậc, gương, xi nhan
  const xr = xf + cl * (heavy ? 0.84 : 0.8)                 // mép sau cửa
  const doorBot = r + Rv + 0.05                              // mép dưới cửa nằm trên hốc bánh
  for (const side of [1, -1]) {
    const z = side * (cw / 2 + 0.002)
    const y0 = beltY + 0.06, y1 = cabTop - 0.18
    const fx = (y: number) => xf + 0.13 + slant * ((y - beltY) / (cabTop - beltY))
    const winShape = (grow: number) => {
      const s = new THREE.Shape()
      s.moveTo(xr - 0.07 + grow, y0 - grow); s.lineTo(fx(y0) - grow, y0 - grow); s.lineTo(fx(y1) - grow, y1 + grow); s.lineTo(xr - 0.07 + grow, y1 + grow); s.closePath()
      return s
    }
    // phía -Z: lật gương (scale z = -1) để mặt khung quay ra ngoài, giữ nguyên toạ độ X
    const frame = new THREE.Mesh(geo(new THREE.ShapeGeometry(winShape(0.03))), M.black)
    frame.position.z = z; if (side < 0) frame.scale.z = -1
    g.add(frame)
    const win = new THREE.Mesh(geo(fitUV(new THREE.ShapeGeometry(winShape(0)))), M.glass)
    win.position.z = z + side * 0.002
    g.add(win)
    if (heavy) {
      const back = new THREE.Mesh(geo(new THREE.PlaneGeometry(Math.max(0.1, cabRear - xr - 0.14), (y1 - y0) * 0.55)), M.glass)
      back.position.set((xr + cabRear) / 2, y0 + (y1 - y0) * 0.55, z)
      g.add(back)
    }
    box(0.006, cabTop - 0.12 - doorBot, 0.004, M.black, xr, (cabTop - 0.12 + doorBot) / 2, z, false)
    box(xr - xf - 0.12, 0.006, 0.004, M.black, (xr + xf + 0.12) / 2, doorBot, z, false)
    box(0.13, 0.03, 0.025, M.chrome, xr - 0.13, beltY - 0.05, z + side * 0.012, false)
    box(cl * 0.9, 0.05, 0.004, M.navy, (xf + cabRear) / 2 + 0.04, beltY - 0.13, z, false)
    box(cl * 0.9, 0.014, 0.004, M.brand, (xf + cabRear) / 2 + 0.04, beltY - 0.095, z, false)
    // bậc lên xuống: xe nhỏ trước hốc bánh, xe lớn sau hốc bánh (2 bậc)
    const zs = side * (cw / 2 - 0.1)
    if (heavy) {
      const sw = Math.min(0.42, cabRear - 0.08 - frontX - Rv), sx = frontX + Rv + 0.03 + sw / 2
      if (sw > 0.2) {
        box(sw, 0.035, 0.24, M.dark, sx, cb - 0.06, zs)
        box(sw, 0.035, 0.18, M.dark, sx, cb + 0.26, side * (cw / 2 - 0.13))
        box(0.03, 0.4, 0.2, M.dark, sx - sw / 2, cb + 0.1, zs)
      }
    } else {
      const sw = Math.min(0.34, frontX - Rv - xf - 0.16), sx = frontX - Rv - 0.03 - sw / 2
      if (sw > 0.15) box(sw, 0.035, 0.2, M.dark, sx, cb + 0.02, zs)
    }
    // gương chiếu hậu: tay đỡ + gương to + gương cầu nhỏ
    const armY = beltY + 0.2
    const arm = box(0.03, 0.03, 0.24, M.black, xf + 0.22, armY, side * (cw / 2 + 0.12), false)
    arm.rotation.y = side * 0.25
    rbox(0.07, 0.4, 0.18, 0.025, M.black, xf + 0.2, armY - 0.07, side * (cw / 2 + 0.26))
    box(0.004, 0.34, 0.14, M.glass, xf + 0.162, armY - 0.07, side * (cw / 2 + 0.26), false)
    rbox(0.06, 0.16, 0.16, 0.03, M.black, xf + 0.2, armY - 0.38, side * (cw / 2 + 0.24))
    box(0.03, 0.07, 0.11, M.amber, xf - 0.008, cb + 0.42, side * (cw / 2 - 0.07), false)
  }
  // mặt trước (mặt cabin ở x = xf): lưới tản nhiệt, nẹp, đèn pha, cản, đèn sương mù, biển số
  const gH = beltY - cb - 0.48
  box(0.012, gH, cw * 0.6, M.grille, xf - 0.008, cb + 0.34 + gH / 2, 0, false)
  box(0.016, 0.045, cw * 0.66, M.chrome, xf - 0.01, cb + 0.34 + gH + 0.03, 0, false)
  for (const side of [1, -1]) {
    rbox(0.06, 0.16, cw * 0.18, 0.035, M.black, xf - 0.005, cb + 0.42, side * (cw / 2 - cw * 0.155))
    rbox(0.05, 0.12, cw * 0.155, 0.03, M.head, xf - 0.015, cb + 0.42, side * (cw / 2 - cw * 0.155))
  }
  const bumpY = cb + 0.1
  rbox(0.22, 0.26, cw + 0.04, 0.05, M.black, xf + 0.04, bumpY, 0)
  for (const side of [1, -1]) k.cyl(0.045, 0.03, M.head, xf - 0.075, bumpY, side * (cw / 2 - 0.22), 'x', 18).castShadow = false
  if (c.plate) plate(k, c.plate, xf - 0.075, bumpY + 0.02, 0, -1, false)
  if (heavy) {
    // tấm che nắng + đèn nóc
    const v = box(0.26, 0.03, cw - 0.2, M.black, xf + bev + slant + 0.02, cabTop - 0.02, 0)
    v.rotation.z = -0.25
    for (const z of [-0.3, 0, 0.3]) box(0.04, 0.04, 0.12, M.amber, xf + bev + slant + 0.3, cabTop + 0.02, z, false)
  }
  // tấm chắn gió nóc cabin — chỉ khi thùng cao hơn cabin rõ rệt
  if (c.boxTop - cabTop > 0.25) {
    const top = c.boxTop - 0.04
    const sp = new THREE.Shape()
    sp.moveTo(cabRear - cl * 0.72, cabTop - 0.01)
    sp.lineTo(cabRear - 0.02, cabTop - 0.01)
    sp.lineTo(cabRear - 0.02, top)
    sp.lineTo(cabRear - 0.32, top)
    sp.quadraticCurveTo(cabRear - cl * 0.45, cabTop + (top - cabTop) * 0.45, cabRear - cl * 0.72, cabTop - 0.01)
    const dw = cw * 0.9
    const spGeo = geo(new THREE.ExtrudeGeometry(sp, { depth: dw - 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.02, bevelSegments: 3 }))
    spGeo.translate(0, 0, -(dw - 0.06) / 2)
    const spoiler = new THREE.Mesh(spGeo, M.paint)
    spoiler.castShadow = true
    g.add(spoiler)
  }
}

/** Biển số (chỉ khi người dùng khai): `dir` = hướng mặt biển (-1 về đầu xe, +1 về đuôi xe). Đuôi xe: biển 2 dòng. */
function plate(k: Kit, text: string, x: number, y: number, z: number, dir: 1 | -1, twoLines: boolean) {
  const s = text.trim().toUpperCase().slice(0, 14)
  const i = s.indexOf('-')
  const lines = twoLines && i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s]
  const [w, h] = lines.length > 1 ? [0.28, 0.2] : [0.47, 0.11]
  const m = k.track(new THREE.MeshStandardMaterial({ map: k.track(plateTexture(lines, w * 1000, h * 1000)), roughness: 0.35, metalness: 0.2 }))
  // mặt +x của khối mang chữ; biển nhìn về đầu xe thì quay ngược lại
  const o = k.box(0.006, h, w, [m, k.M.dark, k.M.dark, k.M.dark, k.M.dark, k.M.dark], x, y, z, false)
  if (dir < 0) o.rotation.y = Math.PI
}

/** Gầm xe tải: dầm dọc, dầm ngang, bình dầu, hộp ắc quy, bình hơi, thanh chắn hông. */
function chassis(k: Kit, o: { x0: number; x1: number; top: number; Wout: number; frontX: number; rearAxle0: number; r: number; floorY: number; s: number }) {
  const { M, box, cyl } = k
  const railZ = Math.min(0.46, o.Wout * 0.22)
  for (const z of [railZ, -railZ]) box(o.x1 - o.x0, 0.22, 0.08, M.dark, (o.x0 + o.x1) / 2, o.top - 0.11, z)
  for (let x = o.x0 + 0.4; x < o.x1 - 0.2; x += 1.1) box(0.06, 0.16, railZ * 2, M.dark, x, o.top - 0.12, 0, false)
  const gx0 = Math.max(o.frontX + o.r + 0.22, 0.15), gx1 = o.rearAxle0 - o.r - 0.18
  if (gx1 - gx0 > 0.9) {
    const tr = 0.2 + 0.06 * o.s, tl = Math.min(0.9, (gx1 - gx0) * 0.45)
    cyl(tr, tl, M.alu, gx0 + 0.1 + tl / 2, o.top - 0.36, o.Wout / 2 - 0.38, 'x', 32)
    box(0.36, 0.3, 0.42, M.black, gx1 - 0.3, o.top - 0.34, -(o.Wout / 2 - 0.4))
    if (gx1 - gx0 > 2) cyl(0.12, 0.7, M.dark, gx1 - 0.5, o.top - 0.3, o.Wout / 2 - 0.36, 'x')
  }
  if (gx1 - gx0 > 0.6) for (const sd of [1, -1]) for (const y of [o.floorY - 0.44, o.floorY - 0.26]) {
    box(gx1 - gx0, 0.05, 0.03, M.alu, (gx0 + gx1) / 2, y, sd * (o.Wout / 2 - 0.03))
  }
}

/** Vạch sơn bãi đỗ hai bên xe. */
function bayLines(k: Kit, x0: number, x1: number, z: number) {
  const t = k.track(lineTexture()); t.wrapS = THREE.RepeatWrapping; t.repeat.set((x1 - x0) / 2, 1)
  const m = k.track(new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }))
  for (const sd of [1, -1]) {
    const o = new THREE.Mesh(k.geo(new THREE.PlaneGeometry(x1 - x0, 0.12)), m)
    o.rotation.x = -Math.PI / 2; o.position.set((x0 + x1) / 2, 0.004, sd * z); o.receiveShadow = true
    k.g.add(o)
  }
}

// ── XE TẢI THÙNG KÍN ───────────────────────────────────────────────────────────────────────────
const WALL = 0.045

function buildBoxTruck(d: TruckDimsM): TruckHandle {
  const k = makeKit()
  const { M, box, g, geo } = k
  const { L, W, H } = d
  const s = clamp((L - 3) / 6.5, 0, 1)                        // 0 = xe 1,5t · 1 = xe 15t
  const r = 0.34 + 0.19 * s
  const tw = 0.2 + 0.08 * s
  const chassisTop = 2 * r * 0.9 + 0.1
  const floorY = chassisTop + 0.14
  const Wout = W + 2 * WALL
  const heavy = s > 0.45
  const cl = 1.35 + 0.6 * s
  const cw = clamp(Wout - 0.02, 1.55, 2.48)
  const xf = -0.2 - cl
  const cb = r * 1.05
  const cabTop = cb + 1.5 + 0.8 * s
  const frontX = xf + cl * (heavy ? 0.36 : 0.64)
  const boxTop = floorY + H + 0.06
  buildCab(k, { xf, cl, cw, cb, cabTop, r, frontX, heavy, plate: d.plate, boxTop })

  // bánh: trước đơn, sau đôi; xe dài > 7 m hai trục sau
  const wheel = wheelMaker(k, r, tw)
  const outerZ = Wout / 2 - 0.06 - tw / 2
  for (const sd of [1, -1] as const) wheel(frontX, sd * outerZ, sd, false, true)
  const rearAxles = L > 7 ? [L * 0.6, L * 0.6 + 2 * r + 0.14] : [L * 0.64]
  for (const ax of rearAxles) for (const sd of [1, -1] as const) {
    wheel(ax, sd * outerZ, sd)
    wheel(ax, sd * (outerZ - tw - 0.03), sd, true)
  }
  for (const ax of [frontX, ...rearAxles]) k.cyl(0.055, Wout - 0.3, M.dark, ax, r, 0, 'z', 12)
  chassis(k, { x0: xf + 0.3, x1: L + 0.1, top: chassisTop, Wout, frontX, rearAxle0: rearAxles[0], r, floorY, s })
  const lastAxle = rearAxles[rearAxles.length - 1]
  for (const sd of [1, -1]) {
    // chắn bùn cao su sau bánh cuối + vè trên cụm bánh sau
    box(0.02, floorY - 0.16 - r * 0.3, tw * 2 + 0.08, M.rubber, lastAxle + r + 0.14, (floorY - 0.16 + r * 0.3) / 2, sd * (outerZ - tw / 2 - 0.015))
    box(rearAxles[0] - lastAxle + 2 * r + 0.24, 0.025, tw * 2 + 0.1, M.black, (rearAxles[0] + lastAxle) / 2, 2 * r + 0.06, sd * (outerZ - tw / 2 - 0.015))
  }

  // ── THÙNG: sàn ván, vỏ ngoài sơn trắng + gân nhôm, lòng ốp tấm sáng ──────────────────────────────
  const floorTex = k.track(floorTexture(Math.max(6, Math.round(W / 0.16))))
  floorTex.wrapS = THREE.RepeatWrapping; floorTex.repeat.set(Math.max(1, L / 3), 1)
  const wood = k.track(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.82 }))
  const skinTex = k.track(panelTexture('#eceff2', 0.12)); skinTex.wrapS = THREE.RepeatWrapping; skinTex.repeat.set(L / 2.4, 1)
  const linTex = k.track(panelTexture('#d5dae0', 0.18)); linTex.wrapS = THREE.RepeatWrapping; linTex.repeat.set(L / 2.4, 1)
  const skin = k.track(new THREE.MeshStandardMaterial({ map: skinTex, roughness: 0.4, metalness: 0.25 }))
  const lining = k.track(new THREE.MeshStandardMaterial({ map: linTex, roughness: 0.7, metalness: 0.1, side: THREE.BackSide }))
  const plain = k.track(new THREE.MeshStandardMaterial({ color: '#eceff2', roughness: 0.4, metalness: 0.25 }))
  const plainIn = k.track(new THREE.MeshStandardMaterial({ color: '#d5dae0', roughness: 0.7, metalness: 0.1, side: THREE.BackSide }))
  const leafIn = k.track(new THREE.MeshStandardMaterial({ color: '#d5dae0', roughness: 0.7, metalness: 0.1 }))

  box(L, 0.08, Wout, [M.dark, M.dark, wood, M.dark, M.dark, M.dark], L / 2, floorY - 0.04, 0)   // sàn (mặt trên = floorY)
  for (const sd of [1, -1]) box(L + 0.04, 0.16, 0.06, M.alu, L / 2, floorY - 0.06, sd * (Wout / 2 - 0.02))   // dầm biên
  const sides: Record<1 | -1, THREE.Object3D[]> = { 1: [], [-1]: [] }
  const roof: THREE.Object3D[] = [], liners: THREE.Object3D[] = []
  const skins: { mesh: THREE.Mesh; mat: Mat }[] = []
  const pair = (gm: THREE.BufferGeometry, outer: THREE.Material, inner: THREE.Material, place: (o: THREE.Object3D) => void, list: THREE.Object3D[]) => {
    const p = skinPair(k, gm, outer, inner, place)
    list.push(p.outer, p.inner); liners.push(p.inner); skins.push({ mesh: p.outer, mat: outer })
  }
  // vách đầu luôn kín (không đổi theo chế độ xem)
  skinPair(k, geo(new THREE.PlaneGeometry(Wout, H + 0.06)), plain, plainIn, o => { o.position.set(-WALL / 2, floorY + (H + 0.06) / 2, 0); o.rotation.y = -Math.PI / 2 })
  for (const sd of [1, -1] as const) {
    pair(geo(new THREE.PlaneGeometry(L, H)), skin, lining, o => { o.position.set(L / 2, floorY + H / 2, sd * (Wout / 2 - 0.006)); if (sd < 0) o.rotation.y = Math.PI }, sides[sd])
  }
  pair(geo(new THREE.PlaneGeometry(L, Wout)), plain, plainIn, o => { o.position.set(L / 2, floorY + H + 0.04, 0); o.rotation.x = -Math.PI / 2 }, roof)
  // khung: cột góc, gân đứng ngoài vách, ray nóc; decal phản quang + đèn hông dọc dầm biên
  const post = 0.07
  for (const x of [-WALL, L]) for (const sd of [1, -1]) box(post, H + 0.08, post, M.alu, x + (x > 0 ? post / 2 - 0.02 : -post / 2 + 0.03), floorY + (H + 0.08) / 2, sd * (Wout / 2 - post / 2 + 0.01))
  for (const sd of [1, -1] as const) {
    sides[sd].push(box(L, 0.08, 0.055, M.alu, L / 2, floorY + H + 0.03, sd * (Wout / 2 - 0.02)))
    for (let x = 0.6; x < L - 0.3; x += 0.6) sides[sd].push(box(0.04, H - 0.04, 0.022, M.alu, x, floorY + H / 2, sd * (Wout / 2 + 0.006)))
    k.tapeBox(L - 0.1, 0.05, 0.004, L - 0.1, L / 2, floorY - 0.05, sd * (Wout / 2 + 0.012))
    for (let x = 1.0; x < L - 0.5; x += 1.8) box(0.06, 0.035, 0.02, M.amber, x, floorY - 0.155, sd * (Wout / 2), false)
  }
  for (let x = 0.6; x < L - 0.3; x += 1.2) roof.push(box(0.05, 0.03, Wout - 0.08, M.alu, x, floorY + H + 0.06, 0, false))
  box(0.08, 0.12, Wout + 0.02, M.alu, L - 0.01, floorY + H + 0.02, 0)                  // khung cửa trên
  box(0.1, 0.1, Wout + 0.02, M.alu, L - 0.01, floorY - 0.02, 0)                          // ngưỡng cửa
  for (const sd of [1, -1]) box(0.012, H, 0.03, M.black, L + 0.03, floorY + H / 2, sd * (Wout / 2 - 0.05), false)   // gioăng cửa
  // cửa sau mở ~100°, mỗi cánh một nửa bề ngang; 2 thanh khoá + tay gạt mỗi cánh, decal dưới chân cánh
  const leafW = Wout / 2
  for (const sd of [1, -1]) {
    const pivot = new THREE.Group()
    pivot.position.set(L + 0.04, floorY, sd * (Wout / 2))
    pivot.rotation.y = -sd * THREE.MathUtils.degToRad(100)
    const leaf = new THREE.Mesh(geo(new THREE.BoxGeometry(0.045, H + 0.02, leafW)), [plain, leafIn, M.alu, M.alu, M.alu, M.alu])
    leaf.position.set(0, (H + 0.02) / 2, -sd * leafW / 2)
    leaf.castShadow = true; leaf.receiveShadow = true
    pivot.add(leaf)
    for (const off of [0.28, 0.74]) {
      const bar = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.014, 0.014, H - 0.06, 10)), M.chrome)
      bar.position.set(0.036, (H + 0.02) / 2, -sd * leafW * off); pivot.add(bar)
      const handle = new THREE.Mesh(geo(new THREE.BoxGeometry(0.03, 0.03, 0.2)), M.chrome)
      handle.position.set(0.05, H * 0.45, -sd * (leafW * off - 0.09)); pivot.add(handle)
    }
    for (const hy of [0.3, H * 0.5, H - 0.3]) {
      const hinge = new THREE.Mesh(geo(new THREE.BoxGeometry(0.05, 0.06, 0.16)), M.dark)
      hinge.position.set(0.03, hy, -sd * 0.08); pivot.add(hinge)
    }
    k.tapeBox(0.004, 0.05, leafW - 0.1, leafW - 0.1, 0.026, 0.12, -sd * leafW / 2, pivot)
    g.add(pivot)
  }
  // cản sau chống luồn gầm + đèn hậu (đỏ · vàng · trắng lùi) + decal + biển số
  const by = floorY - 0.5
  box(0.1, 0.12, Wout - 0.24, M.dark, L + 0.06, by, 0)
  k.tapeBox(0.004, 0.06, Wout - 0.3, Wout - 0.3, L + 0.112, by, 0)
  for (const sd of [1, -1]) {
    box(0.08, 0.42, 0.08, M.dark, L - 0.02, floorY - 0.27, sd * (Wout / 2 - 0.42))
    k.rbox(0.06, 0.14, 0.34, 0.02, M.black, L + 0.04, floorY - 0.24, sd * (Wout / 2 - 0.26))
    box(0.04, 0.1, 0.13, M.red, L + 0.072, floorY - 0.24, sd * (Wout / 2 - 0.18), false)
    box(0.04, 0.1, 0.08, M.amber, L + 0.072, floorY - 0.24, sd * (Wout / 2 - 0.29), false)
    box(0.04, 0.1, 0.06, M.white, L + 0.072, floorY - 0.24, sd * (Wout / 2 - 0.37), false)
  }
  if (d.plate) plate(k, d.plate, L + 0.04, floorY - 0.3, 0, 1, true)
  bayLines(k, xf - 0.6, L + 1.6, Wout / 2 + 0.55)

  return {
    group: g, floorY, setView: wallSwitch(sides, roof, liners, skins, M.wallGlass),
    bounds: { minX: xf - 0.1, maxX: L + 0.3, topY: Math.max(boxTop, cabTop), halfW: Wout / 2 + 0.3 },
    dispose: k.dispose,
  }
}

// ── CONTAINER: đầu kéo + rơ-moóc sàn khung + vỏ container tôn sóng ─────────────────────────────
function buildContainerRig(d: TruckDimsM): TruckHandle {
  const k = makeKit()
  const { M, box, g, geo } = k
  const { L, W, H } = d
  const Lo = L + 0.16, Wo = W + 0.086
  const r = 0.52, tw = 0.28
  const deck = 1.25                                            // mặt trên dầm rơ-moóc
  const floorY = deck + 0.155                                   // mặt sàn trong container
  const top = floorY + H + 0.045                                // đỉnh vỏ
  const x0 = -0.08, x1 = L + 0.08
  // đầu kéo: trục trước dưới cabin, cụm 2 trục sau dưới mâm kéo
  const tandem = [1.05, 2.36]
  const frontAxle = -2.25
  const cl = 2.25, cw = 2.49
  const xf = frontAxle - cl * 0.36
  const cb = r * 1.08, cabTop = 3.15
  buildCab(k, { xf, cl, cw, cb, cabTop, r, frontX: frontAxle, heavy: true, plate: d.plate, boxTop: top })
  const wheel = wheelMaker(k, r, tw)
  const outerZ = Wo / 2 - 0.08 - tw / 2
  for (const sd of [1, -1] as const) wheel(frontAxle, sd * outerZ, sd, false, true)
  for (const ax of tandem) for (const sd of [1, -1] as const) { wheel(ax, sd * outerZ, sd); wheel(ax, sd * (outerZ - tw - 0.03), sd, true) }
  // khung đầu kéo + mâm kéo + bình dầu + ống xả + vè
  const tTop = 0.8
  for (const z of [0.42, -0.42]) box(tandem[1] + 0.6 - (xf + 0.3), 0.26, 0.09, M.dark, (tandem[1] + 0.6 + xf + 0.3) / 2, tTop - 0.13, z)
  k.cyl(0.62, 0.1, M.dark, (tandem[0] + tandem[1]) / 2 - 0.25, tTop + 0.08, 0, 'y', 32)
  for (const ax of [frontAxle, ...tandem]) k.cyl(0.06, Wo - 0.3, M.dark, ax, r, 0, 'z', 12)
  for (const sd of [1, -1]) {
    box(tandem[1] - tandem[0] + 2 * r + 0.2, 0.03, tw * 2 + 0.12, M.black, (tandem[0] + tandem[1]) / 2, 2 * r + 0.1, sd * (outerZ - tw / 2 - 0.015))
    k.cyl(0.28, 1.1, M.alu, frontAxle + r + 0.85, 0.62, sd * (Wo / 2 - 0.42), 'x', 32)
  }
  k.cyl(0.11, 1.6, M.chrome, xf + cl + 0.12, cabTop - 0.6, Wo / 2 - 0.5, 'y', 16)
  // rơ-moóc: 2 dầm chính, dầm ngang, chân chống, cụm trục sau, cản sau, đèn
  const nAx = L > 9 ? 3 : 2
  const lastAx = Lo - (nAx === 3 ? 1.35 : 1.0)
  const axles = Array.from({ length: nAx }, (_, i) => lastAx - i * 1.31)
  const beamZ = 0.45
  for (const z of [beamZ, -beamZ]) box(x1 - x0 - 0.1, 0.32, 0.12, M.dark, (x0 + x1) / 2, deck - 0.16, z)
  for (let x = x0 + 0.3; x < x1 - 0.1; x += 1.5) box(0.08, 0.14, Wo - 0.1, M.dark, x, deck - 0.07, 0, false)
  for (const sd of [1, -1]) k.tapeBox(x1 - x0 - 0.4, 0.05, 0.004, x1 - x0 - 0.4, (x0 + x1) / 2, deck - 0.2, sd * (beamZ + 0.062))
  const gap0 = tandem[1] + r, gap1 = axles[nAx - 1] - r
  if (gap1 - gap0 > 0.3) {
    const lgx = Math.min(gap0 + 0.45, (gap0 + gap1) / 2)
    for (const sd of [1, -1]) {
      box(0.1, deck - 0.36, 0.1, M.dark, lgx, (deck - 0.32) / 2 + 0.04, sd * 0.95)
      box(0.24, 0.04, 0.24, M.dark, lgx, 0.04, sd * 0.95)
      box(0.08, 0.06, 0.9, M.dark, lgx, deck - 0.36, sd * 0.5)
    }
  }
  for (const ax of axles) {
    for (const sd of [1, -1] as const) { wheel(ax, sd * outerZ, sd); wheel(ax, sd * (outerZ - tw - 0.03), sd, true) }
    k.cyl(0.06, Wo - 0.3, M.dark, ax, r, 0, 'z', 12)
  }
  for (const sd of [1, -1]) {
    box(axles[0] - axles[nAx - 1] + 2 * r + 0.24, 0.03, tw * 2 + 0.12, M.black, (axles[0] + axles[nAx - 1]) / 2, 2 * r + 0.1, sd * (outerZ - tw / 2 - 0.015))
    box(0.02, 0.6, tw * 2 + 0.08, M.rubber, lastAx + r + 0.14, 0.55, sd * (outerZ - tw / 2 - 0.015))
  }
  const by = 0.55
  box(0.1, 0.12, Wo - 0.3, M.dark, x1 + 0.02, by, 0)
  k.tapeBox(0.004, 0.06, Wo - 0.4, Wo - 0.4, x1 + 0.072, by, 0)
  for (const sd of [1, -1]) {
    box(0.08, deck - by - 0.1, 0.08, M.dark, x1 - 0.06, (deck + by) / 2 - 0.05, sd * beamZ)
    k.rbox(0.06, 0.14, 0.34, 0.02, M.black, x1, deck - 0.24, sd * (Wo / 2 - 0.3))
    box(0.04, 0.1, 0.13, M.red, x1 + 0.03, deck - 0.24, sd * (Wo / 2 - 0.22), false)
    box(0.04, 0.1, 0.08, M.amber, x1 + 0.03, deck - 0.24, sd * (Wo / 2 - 0.33), false)
    box(0.04, 0.1, 0.06, M.white, x1 + 0.03, deck - 0.24, sd * (Wo / 2 - 0.41), false)
  }
  if (d.plate) plate(k, d.plate, x1 + 0.03, deck - 0.45, 0, 1, true)

  // vỏ container: thép sơn, tôn sóng; lòng sơn sáng + sàn ván ép
  const shell = k.track(new THREE.MeshStandardMaterial({ color: '#3d5a78', roughness: 0.55, metalness: 0.35 }))
  const shellIn = k.track(new THREE.MeshStandardMaterial({ color: '#c9c7c0', roughness: 0.75, metalness: 0.15, side: THREE.BackSide }))
  const frameMat = k.track(new THREE.MeshStandardMaterial({ color: '#34506c', roughness: 0.6, metalness: 0.35 }))
  const cast = k.track(new THREE.MeshStandardMaterial({ color: '#2a2d31', roughness: 0.7, metalness: 0.4 }))
  const plyTex = k.track(floorTexture(Math.max(5, Math.round(W / 0.3)), true)); plyTex.wrapS = THREE.RepeatWrapping; plyTex.repeat.set(L / 3, 1)
  const ply = k.track(new THREE.MeshStandardMaterial({ map: plyTex, roughness: 0.85 }))
  box(L, 0.03, W, [M.dark, M.dark, ply, M.dark, M.dark, M.dark], L / 2, floorY - 0.015, 0)
  box(Lo, 0.12, Wo - 0.1, M.dark, L / 2, floorY - 0.09, 0, false)                         // dầm đáy
  const sides: Record<1 | -1, THREE.Object3D[]> = { 1: [], [-1]: [] }
  const roof: THREE.Object3D[] = [], liners: THREE.Object3D[] = []
  const skins: { mesh: THREE.Mesh; mat: Mat }[] = []
  const pair = (gm: THREE.BufferGeometry, place: (o: THREE.Object3D) => void, list: THREE.Object3D[]) => {
    const p = skinPair(k, gm, shell, shellIn, place)
    list.push(p.outer, p.inner); liners.push(p.inner); skins.push({ mesh: p.outer, mat: shell })
  }
  const side = geo(corrugated(L, H, 0.28, 0.036))
  pair(side, o => o.position.set(0, floorY, W / 2), sides[1])
  pair(side, o => { o.rotation.y = Math.PI; o.position.set(L, floorY, -W / 2) }, sides[-1])
  skinPair(k, geo(corrugated(W, H, 0.3, 0.032)), shell, shellIn, o => { o.rotation.y = -Math.PI / 2; o.position.set(0, floorY, -W / 2) })   // vách đầu luôn kín
  pair(geo(corrugated(L, W, 0.6, 0.018)), o => { o.rotation.x = -Math.PI / 2; o.position.set(0, floorY + H, W / 2) }, roof)
  // ray trên / dưới, cột góc, góc đúc
  for (const sd of [1, -1] as const) {
    box(Lo, 0.16, 0.06, frameMat, L / 2, floorY - 0.06, sd * (Wo / 2 - 0.03))
    sides[sd].push(box(Lo, 0.09, 0.07, frameMat, L / 2, top - 0.045, sd * (Wo / 2 - 0.035)))
  }
  for (const x of [x0 + 0.06, x1 - 0.06]) for (const sd of [1, -1]) {
    box(0.12, top - (floorY - 0.14), 0.12, frameMat, x, (top + floorY - 0.14) / 2, sd * (Wo / 2 - 0.06))
    for (const y of [floorY - 0.08, top - 0.06]) box(0.18, 0.12, 0.16, cast, x, y, sd * (Wo / 2 - 0.075), false)
  }
  box(0.14, 0.16, Wo, frameMat, x1 - 0.07, top - 0.08, 0)                                  // dầm cửa trên
  box(0.14, 0.16, Wo, frameMat, x1 - 0.07, floorY - 0.06, 0)                               // ngưỡng cửa
  // cửa container mở ~100°: tôn sóng ngang, 2 thanh khoá + tay gạt + chốt cam mỗi cánh
  const leafW = Wo / 2 - 0.02, leafH = top - floorY - 0.04
  const doorGeo = geo(corrugated(leafH, leafW, leafH / 5, 0.03))
  for (const sd of [1, -1]) {
    const pivot = new THREE.Group()
    pivot.position.set(x1 + 0.01, floorY, sd * (Wo / 2))
    pivot.rotation.y = -sd * THREE.MathUtils.degToRad(100)
    // tôn sóng của cánh dựng đứng (sóng theo chiều cao), mặt ngoài hướng +X, cánh trải từ bản lề vào giữa
    for (const m of [shell, shellIn]) {
      const o = new THREE.Mesh(doorGeo, m)
      o.rotation.set(0, Math.PI / 2, Math.PI / 2)
      o.position.set(0, 0.02, sd > 0 ? -leafW : 0)
      o.castShadow = true; o.receiveShadow = true
      pivot.add(o)
    }
    const fr = new THREE.Mesh(geo(new THREE.BoxGeometry(0.05, leafH, 0.06)), frameMat)
    fr.position.set(0, leafH / 2 + 0.02, -sd * (leafW - 0.03)); pivot.add(fr)
    for (const off of [0.3, 0.72]) {
      const bar = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.016, 0.016, leafH - 0.04, 10)), M.steel)
      bar.position.set(0.06, leafH / 2 + 0.02, -sd * leafW * off); pivot.add(bar)
      const handle = new THREE.Mesh(geo(new THREE.BoxGeometry(0.03, 0.03, 0.26)), M.steel)
      handle.position.set(0.08, leafH * 0.42, -sd * (leafW * off - 0.12)); pivot.add(handle)
      for (const y of [0.1, leafH - 0.06]) {
        const cam = new THREE.Mesh(geo(new THREE.BoxGeometry(0.05, 0.08, 0.06)), cast)
        cam.position.set(0.05, y, -sd * leafW * off); pivot.add(cam)
      }
    }
    for (const hy of [0.25, leafH * 0.38, leafH * 0.62, leafH - 0.2]) {
      const hinge = new THREE.Mesh(geo(new THREE.BoxGeometry(0.06, 0.07, 0.14)), cast)
      hinge.position.set(0.03, hy, -sd * 0.06); pivot.add(hinge)
    }
    g.add(pivot)
  }
  bayLines(k, xf - 0.8, x1 + 1.8, Wo / 2 + 0.65)

  return {
    group: g, floorY, setView: wallSwitch(sides, roof, liners, skins, M.wallGlass),
    bounds: { minX: xf - 0.1, maxX: x1 + 0.3, topY: Math.max(top, cabTop), halfW: Wo / 2 + 0.3 },
    dispose: k.dispose,
  }
}

export function buildTruck(d: TruckDimsM): TruckHandle {
  return d.container ? buildContainerRig(d) : buildBoxTruck(d)
}
