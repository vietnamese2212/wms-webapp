// Nhãn trên sơ đồ: tên MẢNG hàng (băng nhãn phía trên nóc xe, dàn không đè nhau, có đường dẫn + mũi tên xuống khối)
// và số LỚP theo vùng chân. Dữ liệu do màn chuyến tính (mm, toạ độ thuật toán); ở đây chỉ vẽ.
import * as THREE from 'three'

export interface SceneLabel { text: string; color: string; x: number; y: number; top: number }
export interface SceneBadge { text: string; x: number; y: number; top: number }
export interface SceneMarks { labels: SceneLabel[]; badges: SceneBadge[] }
export interface MarksHandle { group: THREE.Group; dispose: () => void }

const FONT = '"Segoe UI", system-ui, Arial, sans-serif'

function spriteOf(text: string, font: string, minW: number, padW: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
  const m = document.createElement('canvas').getContext('2d')!
  m.font = font
  const el = document.createElement('canvas')
  el.width = Math.max(minW, Math.ceil(m.measureText(text).width) + padW)   // canvas tự giãn theo chữ: hiện ĐỦ tên, không cắt
  el.height = h
  const c = el.getContext('2d')!
  draw(c, el.width, el.height)
  c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle'
  c.fillText(text, el.width / 2, el.height / 2)
  const tex = new THREE.CanvasTexture(el)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, fog: false, toneMapped: false })
  const sprite = new THREE.Sprite(mat)
  sprite.renderOrder = 10; sprite.userData.noAO = true
  return { sprite, mat, tex, aspect: el.width / el.height }
}


export function buildMarks(marks: SceneMarks, truck: { length: number; width: number; height: number }, floorY: number): MarksHandle {
  const group = new THREE.Group()
  const owned: { dispose: () => void }[] = []
  const L = truck.length / 1000, W = truck.width / 1000, H = truck.height / 1000
  const toZ = (y: number) => W / 2 - y / 1000
  // xe dài thì camera lùi xa: nhãn to theo chiều dài xe để vẫn đọc được
  const k = THREE.MathUtils.clamp(L / 4.5, 1, 2.4)
  const LABEL_H = 0.24 * k, LABEL_GAP = 0.15 * k, BADGE_H = 0.17 * k

  const entries = marks.labels.map(l => {
    const s = spriteOf(l.text, 'bold 34px ' + FONT, 220, 60, 96, (c, w, h) => {
      c.fillStyle = 'rgba(255,255,255,0.94)'; c.strokeStyle = l.color; c.lineWidth = 6
      c.beginPath(); c.roundRect(4, 4, w - 8, h - 8, 18); c.fill(); c.stroke()
      c.fillStyle = '#0f172a'
    })
    owned.push(s.mat, s.tex)
    return { ...l, sprite: s.sprite, w: LABEL_H * s.aspect, bx: l.x / 1000, bz: toZ(l.y), btop: floorY + l.top / 1000 }
  }).sort((a, b) => a.bx - b.bx)   // theo vị trí khối dọc thân xe

  const y0 = floorY + H + 0.38 * k
  const rowEnd: number[] = [-Infinity]   // mỗi hàng nhãn đã dàn tới đâu; hết chỗ dọc thân xe thì thêm hàng
  const cone = new THREE.ConeGeometry(0.05, 0.12, 10)
  owned.push(cone)
  for (const e of entries) {
    // Nhãn nằm trong chiều dài xe (chừa đủ cho nhãn dài), hàng thấp nhất còn chỗ gần vị trí khối
    const lo = e.w / 2 - 0.3, hi = Math.max(lo, L + 0.3 - e.w / 2), want = Math.min(hi, Math.max(lo, e.bx))
    let best = rowEnd.findIndex(end => end + LABEL_GAP + e.w / 2 <= hi)
    if (best < 0) { best = rowEnd.length; rowEnd.push(-Infinity) }
    const bestX = Math.max(want, rowEnd[best] + LABEL_GAP + e.w / 2)
    rowEnd[best] = bestX + e.w / 2
    const y = y0 + best * (LABEL_H + 0.06 * k)
    e.sprite.position.set(bestX, y, 0)
    e.sprite.scale.set(e.w, LABEL_H, 1)
    group.add(e.sprite)
    // Đường dẫn từ đáy nhãn → nóc khối + mũi tên
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(bestX, y - LABEL_H / 2, 0), new THREE.Vector3(e.bx, e.btop + 0.14, e.bz)])
    const lineMat = new THREE.LineBasicMaterial({ color: e.color, fog: false })
    const line = new THREE.Line(lineGeo, lineMat)
    const coneMat = new THREE.MeshBasicMaterial({ color: e.color, fog: false })
    const arrow = new THREE.Mesh(cone, coneMat)
    arrow.position.set(e.bx, e.btop + 0.08, e.bz)
    arrow.rotation.x = Math.PI
    arrow.userData.noAO = true
    owned.push(lineGeo, lineMat, coneMat)
    group.add(line, arrow)
  }

  for (const b of marks.badges) {
    const s = spriteOf(b.text, 'bold 40px ' + FONT, 140, 56, 88, (c, w, h) => {
      c.fillStyle = 'rgba(15,23,42,0.88)'
      c.beginPath(); c.roundRect(4, 4, w - 8, h - 8, 40); c.fill()
      c.fillStyle = '#ffffff'
    })
    owned.push(s.mat, s.tex)
    s.sprite.position.set(b.x / 1000, floorY + b.top / 1000 + BADGE_H * 0.75, toZ(b.y))
    s.sprite.scale.set(BADGE_H * s.aspect, BADGE_H, 1)
    group.add(s.sprite)
  }

  return { group, dispose: () => owned.forEach(x => x.dispose()) }
}
