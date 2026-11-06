// Hàng trên xe: thùng carton IN theo mã (InstancedMesh mỗi mã — tên hàng ở mặt dài, mã hàng ở mặt đầu, băng keo trên
// nóc) và pallet gỗ thật (ván mặt · ván ngang · 9 cục kê · ván đáy) tô theo màu pallet + từng THÙNG THẬT đã xếp trên mặt
// pallet (`SceneGroup.cartons`); khối quấn màng chỉ còn cho pallet không rõ ruột (chưa khai quy cách / thùng to hơn chân).
// Phần ĐÃ XUẤT thật của một mã (Dự toán) là mesh riêng, mờ đi.
import * as THREE from 'three'
import type { LoadPlan, PlacedBox } from '@/utils/loadPlan'
import { boardTexture, cartonFaces, cartonNormal, wrappedTexture, type CartonArt } from './textures'
import { shownColor } from './colors'

/** Chữ in trên thùng của một mã + cỡ thùng gốc (mm) — để biết thùng đặt xoay hay không. */
export interface CartonPrint { code: string; name: string; l: number; w: number; h: number }
/** Một thùng trên pallet: gốc = góc KHỐI pallet (chân + phần chờm) theo dài × rộng của khối, z từ mặt đế. */
export interface SceneCarton { itemId: string; x: number; y: number; z: number; l: number; w: number; h: number }
/** Dữ liệu vẽ của một nhóm trong `plan.groups` (cùng chỉ số). */
export interface SceneGroup {
  itemId: string | null       // null = pallet gộp nhiều mã
  colorKey: string
  done?: number               // số khối ĐẦU của nhóm (theo thứ tự xếp) đã xuất thật ⇒ vẽ mờ
  cartons?: SceneCarton[]     // pallet: từng thùng đã xếp trên mặt pallet
  deck?: { x: number; y: number; l: number; w: number }   // pallet: chỗ tấm gỗ trong khối (khối = chân + phần thùng chờm mép)
}

export interface CargoHandle {
  group: THREE.Group
  setStep: (step: number | null) => void      // null = hiện hết
  setFocus: (focus: Set<number> | null) => void   // soi: khối ngoài `focus` mờ đi
  dispose: () => void
}

// cum[i] = số instance của i khối đầu CỦA CẢ NHÓM (theo bước) — phần đã xuất / chưa xuất và từng mã trong pallet gộp có số khác nhau
interface Part { mesh: THREE.InstancedMesh; cum: number[]; mats: THREE.Material[]; fade: boolean }
interface GroupMeshes { steps: number[]; parts: Part[] }

/** Thùng / tấm gỗ trên pallet (toạ độ theo khối L×W của nhóm — chân + phần chờm) → toạ độ trong xe của
 *  pallet `b`. Pallet đặt xoay (cạnh dài theo bề ngang xe) thì đổi trục. */
function onPallet<T extends { x: number; y: number; l: number; w: number }>(b: PlacedBox, L: number, cs: T[]): T[] {
  const turned = Math.abs(b.l - L) > 1
  return cs.map(c => turned
    ? { ...c, x: b.x + c.y, y: b.y + c.x, l: c.w, w: c.l }
    : { ...c, x: b.x + c.x, y: b.y + c.y })
}

const upperBound = (a: number[], v: number) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= v) lo = m + 1; else hi = m } return lo }
// lệch rất nhẹ từng thùng (−1..1, cố định theo số thứ tự) — hàng xếp tay không thẳng tắp như máy in
const jit = (i: number, k: number) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return (s - Math.floor(s)) * 2 - 1 }
const PALLET_PARTS = 22   // 7 ván mặt + 3 ván ngang + 9 cục kê + 3 ván đáy

// Mặt in + pháp tuyến dùng lại giữa các lần dựng (quét thùng / đổi số ⇒ tính lại sơ đồ ⇒ dựng lại hàng): vẽ chữ lên canvas
// tốn công, nhất là điện thoại. Giữ ≤ 48 mã gần nhất; bỏ ra thì giải phóng.
const FACES = new Map<string, ReturnType<typeof cartonFaces>>()
function facesCached(a: CartonArt) {
  const k = `${a.hex}|${a.code}|${a.name}|${a.l}|${a.w}|${a.h}`
  const hit = FACES.get(k)
  if (hit) { FACES.delete(k); FACES.set(k, hit); return hit }
  const f = cartonFaces(a)
  FACES.set(k, f)
  if (FACES.size > 48) {
    const [old, v] = FACES.entries().next().value!
    FACES.delete(old); v.long.dispose(); v.end.dispose(); v.top.dispose()
  }
  return f
}
let normals: { side: THREE.Texture; top: THREE.Texture } | null = null
const cartonNormals = () => (normals ??= { side: cartonNormal(false), top: cartonNormal(true) })

export function buildCargo(plan: LoadPlan, meta: SceneGroup[], colors: Map<string, string>, floorY: number, prints?: Map<string, CartonPrint>): CargoHandle {
  const root = new THREE.Group()
  const disposables: { dispose: () => void }[] = []
  const track = <T extends { dispose: () => void }>(x: T) => { disposables.push(x); return x }
  const W = plan.truck.width / 1000

  const { side: sideN, top: topN } = cartonNormals()
  const wrapTex = track(wrappedTexture())
  const boardMap = track(boardTexture())
  const unitBox = track(new THREE.BoxGeometry(1, 1, 1))

  const groups: GroupMeshes[] = []
  const tmp = new THREE.Object3D()
  const col = new THREE.Color()

  // Thùng của BƯỚC đang xem — viền sáng để mắt bắt ngay chỗ vừa đặt
  const hlMat = track(new THREE.MeshBasicMaterial({ color: '#4d8dff', transparent: true, opacity: 0.35, depthWrite: false }))
  const hl = new THREE.InstancedMesh(unitBox, hlMat, Math.max(1, plan.placed.length))
  hl.count = 0; hl.renderOrder = 2; hl.frustumCulled = false
  root.add(hl)

  const byGroup = new Map<number, typeof plan.placed>()
  for (const b of plan.placed) {
    const a = byGroup.get(b.group)
    if (a) a.push(b); else byGroup.set(b.group, [b])
  }

  const finish = (mesh: THREE.InstancedMesh) => {
    mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    root.add(mesh)
  }

  // mặt in của từng mã — dùng chung cho mọi khối / pallet của mã đó (và giữa các lần dựng, xem `facesCached`)
  const facesFor = (hex: string, pr: CartonPrint | undefined, fb: { l: number; w: number; h: number }) => {
    const dims: [number, number, number] = pr ? [pr.l, pr.w, pr.h] : [fb.l, fb.w, fb.h]
    return { ...facesCached({ hex, code: pr?.code ?? '', name: pr?.name ?? '', l: dims[0], w: dims[1], h: dims[2] }), dims }
  }

  // THÙNG CARTON (mm, góc x·y·z). Thùng đặt xoay ⇒ quay khối 90° (không kéo giãn) để chữ in luôn đúng mặt, đúng tỉ lệ.
  // Mỗi lô thùng một mesh + vật liệu riêng (làm mờ riêng được khi soi).
  const cartonPart = (list: { x: number; y: number; z: number; l: number; w: number; h: number }[], hex: string, cum: number[], fade: boolean, itemId?: string): Part => {
    const pr = itemId ? prints?.get(itemId) : undefined
    const f = facesFor(hex, pr, list[0] ?? { l: 400, w: 300, h: 250 })
    const [L0, W0, H0] = f.dims
    const mk = (map: THREE.Texture, n: THREE.Texture) => track(new THREE.MeshStandardMaterial({ map, normalMap: n, normalScale: new THREE.Vector2(0.75, 0.75), roughness: 0.88 }))
    const endM = mk(f.end, sideN), longM = mk(f.long, sideN), topM = mk(f.top, topN)
    // thứ tự mặt của BoxGeometry: +x −x +y −y +z −z — trục x của khối = cạnh dài thùng
    const mesh = new THREE.InstancedMesh(unitBox, [endM, endM, topM, topM, longM, longM], Math.max(1, list.length))
    list.forEach((b, i) => {
      let yaw = 0, sx = b.l, sz = b.w
      if (Math.abs(b.h - H0) <= 2) {
        if (Math.abs(b.l - L0) <= 2 && Math.abs(b.w - W0) <= 2) { sx = L0; sz = W0 }
        else if (Math.abs(b.l - W0) <= 2 && Math.abs(b.w - L0) <= 2) { yaw = Math.PI / 2; sx = L0; sz = W0 }
      }
      tmp.position.set((b.x + b.l / 2 + jit(i, 1) * 1.4) / 1000, floorY + (b.z + b.h / 2) / 1000, W / 2 - (b.y + b.w / 2 + jit(i, 2) * 1.4) / 1000)
      tmp.rotation.set(0, yaw + jit(i, 3) * 0.005, 0)
      tmp.scale.set((sx - 6) / 1000, (b.h - 4) / 1000, (sz - 6) / 1000)
      tmp.updateMatrix(); mesh.setMatrixAt(i, tmp.matrix)
      mesh.setColorAt(i, col.setScalar(0.95 + 0.05 * jit(i, 4)))
    })
    finish(mesh)
    return { mesh, cum, mats: [endM, longM, topM], fade }
  }

  /** Pallet gỗ kiểu EUR co theo đúng cỡ chân: ván mặt + ván đáy chạy theo cạnh dài, ván ngang chạy theo cạnh ngắn. */
  const palletBoards = (mesh: THREE.InstancedMesh, i0: number, b: { x: number; y: number; l: number; w: number }, y0: number, bh: number, seed: number) => {
    const lx = b.l / 1000, lz = b.w / 1000
    const cx = (b.x + b.l / 2) / 1000, cz = W / 2 - (b.y + b.w / 2) / 1000
    const alongX = lx >= lz
    const Lg = alongX ? lx : lz, Sh = alongX ? lz : lx
    let i = i0
    // (u dọc cạnh dài, v dọc cạnh ngắn) → toạ độ xe; thớ gỗ (trục x khối đơn vị) theo cạnh dài của tấm
    const put = (u: number, v: number, y: number, du: number, dy: number, dv: number) => {
      const ex = alongX ? du : dv, ez = alongX ? dv : du
      tmp.position.set(alongX ? cx + u : cx + v, y0 + y, alongX ? cz + v : cz + u)
      if (ex >= ez) { tmp.rotation.set(0, 0, 0); tmp.scale.set(ex, dy, ez) } else { tmp.rotation.set(0, Math.PI / 2, 0); tmp.scale.set(ez, dy, ex) }
      tmp.updateMatrix(); mesh.setMatrixAt(i, tmp.matrix)
      mesh.setColorAt(i, col.setScalar(0.86 + 0.12 * jit(seed * 31 + i, 5)))
      i++
    }
    const hb = bh * 0.15, hk = bh * 0.55
    const bu = Lg * 0.12, bv = Sh * 0.145, bw = Sh * 0.12, tw = Sh * 0.1
    const us = [-Lg / 2 + bu / 2, 0, Lg / 2 - bu / 2], vs = [-Sh / 2 + bv / 2, 0, Sh / 2 - bv / 2]
    for (const v of [-Sh / 2 + bw / 2, 0, Sh / 2 - bw / 2]) put(0, v, hb / 2, Lg, hb * 0.96, bw)
    for (const u of us) for (const v of vs) put(u, v, hb + hk / 2, bu, hk, bv)
    for (const u of us) put(u, 0, hb + hk + hb / 2, bu, hb * 0.96, Sh)
    for (let k = 0; k < 7; k++) put(0, -Sh / 2 + tw / 2 + k * (Sh - tw) / 6, 2 * hb + hk + hb / 2, Lg, hb * 0.96, tw)
  }

  for (const [gi, boxesIn] of byGroup) {
    const boxes = [...boxesIn].sort((a, b) => a.step - b.step)
    const m = meta[gi]
    const base = plan.groups[gi]?.base
    const hex = shownColor(m.colorKey, colors)
    const entry: GroupMeshes = { steps: boxes.map(b => b.step), parts: [] }
    const doneN = Math.min(m.done ?? 0, boxes.length)

    // Mỗi nhóm tối đa 2 phần: đã xuất (mờ) + chưa xuất
    for (const fade of doneN > 0 ? [true, false] : [false]) {
      const inPart = (i: number) => (i < doneN) === fade
      const part = boxes.filter((_, i) => inPart(i))
      if (!part.length) continue
      const cumOf = (k: (b: PlacedBox) => number) => {
        const out = [0]; let s = 0
        boxes.forEach((b, i) => { if (inPart(i)) s += k(b); out.push(s) })
        return out
      }

      if (base) {
        // PALLET đúng cỡ chân (`deck`) — thùng chờm mép thì khối rộng hơn tấm gỗ
        const L = plan.groups[gi].l
        const bh = (b: PlacedBox) => Math.min(base.h, b.h)
        const gw = track(new THREE.MeshStandardMaterial({ map: boardMap, color: base.color, roughness: 0.92 }))   // riêng từng nhóm để làm mờ được khi soi mã khác
        const wood = new THREE.InstancedMesh(unitBox, gw, part.length * PALLET_PARTS)
        part.forEach((b0, i) => {
          const b = m.deck ? onPallet(b0, L, [m.deck])[0] : b0
          palletBoards(wood, i * PALLET_PARTS, b, floorY + b0.z / 1000, bh(b0) / 1000, gi * 97 + i)
        })
        finish(wood)
        entry.parts.push({ mesh: wood, cum: cumOf(() => PALLET_PARTS), mats: [gw], fade })
        if (m.cartons?.length) {
          // thùng thật — mỗi MÃ một mesh: pallet gộp thấy rõ từng mã, đúng cỡ thùng, đúng màu, đúng chữ in
          const byItem = new Map<string, { list: SceneCarton[]; cum: number[] }>()
          for (const c of m.cartons) if (!byItem.has(c.itemId)) byItem.set(c.itemId, { list: [], cum: [0] })
          boxes.forEach((b, i) => {
            if (inPart(i)) for (const c of onPallet(b, L, m.cartons!)) byItem.get(c.itemId)!.list.push({ ...c, z: b.z + base.h + c.z })
            for (const v of byItem.values()) v.cum.push(v.list.length)
          })
          for (const [itemId, v] of byItem) entry.parts.push(cartonPart(v.list, shownColor(itemId, colors), v.cum, fade, itemId))
        } else {
          // không rõ ruột: khối hàng quấn màng một màu
          const goods = part.filter(b => b.h - bh(b) > 1)
          if (goods.length) {
            const cargoMat = track(new THREE.MeshPhysicalMaterial({ map: wrapTex, color: hex, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.3 }))
            const cargo = new THREE.InstancedMesh(unitBox, cargoMat, goods.length)
            goods.forEach((b, i) => {
              const l = b.l / 1000, w = b.w / 1000, h = b.h / 1000, bh0 = bh(b) / 1000
              tmp.position.set((b.x + b.l / 2) / 1000, floorY + b.z / 1000 + bh0 + (h - bh0) / 2, W / 2 - (b.y + b.w / 2) / 1000)
              tmp.rotation.set(0, 0, 0); tmp.scale.set(l * 0.985, h - bh0 - 0.004, w * 0.985)
              tmp.updateMatrix(); cargo.setMatrixAt(i, tmp.matrix)
            })
            finish(cargo)
            entry.parts.push({ mesh: cargo, cum: cumOf(b => (b.h - bh(b) > 1 ? 1 : 0)), mats: [cargoMat], fade })
          }
        }
      } else {
        entry.parts.push(cartonPart(part, hex, cumOf(() => 1), fade, m.itemId ?? undefined))
      }
    }
    groups[gi] = entry
  }

  const setStep = (step: number | null) => {
    let h = 0
    for (const e of groups) {
      if (!e) continue
      const n = step == null ? e.steps.length : upperBound(e.steps, step)
      for (const p of e.parts) p.mesh.count = p.cum[n]
    }
    if (step != null) {
      for (const b of plan.placed) {
        if (b.step !== step) continue
        tmp.position.set((b.x + b.l / 2) / 1000, floorY + (b.z + b.h / 2) / 1000, W / 2 - (b.y + b.w / 2) / 1000)
        tmp.rotation.set(0, 0, 0)
        tmp.scale.set(b.l / 1000 + 0.012, b.h / 1000 + 0.012, b.w / 1000 + 0.012); tmp.updateMatrix()
        hl.setMatrixAt(h++, tmp.matrix)
      }
    }
    hl.count = h
    hl.instanceMatrix.needsUpdate = true
  }

  const setFocus = (focus: Set<number> | null) => {
    hl.visible = !focus?.size   // đang soi mã: viền bước không chen vào
    groups.forEach((e, gi) => {
      if (!e) return
      const dim = focus != null && focus.size > 0 && !focus.has(gi)
      for (const p of e.parts) {
        // mờ vừa đủ thấy khối xung quanh — biết khối đang soi nằm trên / cạnh cái gì; phần đã xuất mờ sẵn
        const see = dim ? 0.12 : p.fade ? 0.28 : 1
        for (const mat of p.mats) { mat.transparent = see < 1; mat.opacity = see; mat.depthWrite = see === 1; mat.needsUpdate = true }
        p.mesh.castShadow = see === 1
      }
    })
  }

  setStep(null)
  setFocus(null)
  return { group: root, setStep, setFocus, dispose: () => disposables.forEach(x => x.dispose()) }
}
