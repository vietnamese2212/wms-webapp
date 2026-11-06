// Vân bề mặt vẽ bằng canvas — không tải ảnh ngoài, chạy được khi mất mạng.
import * as THREE from 'three'

function canvas(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
  const el = document.createElement('canvas')
  el.width = w; el.height = h
  const c = el.getContext('2d')!
  draw(c, w, h)
  const t = new THREE.CanvasTexture(el)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

// Ngẫu nhiên có hạt giống — vân giữ nguyên mỗi lần dựng lại cảnh (không "nhảy" khi đổi số thùng)
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
}

// Nhiễu hạt mịn — giấy carton, bê tông, gỗ đều cần một chút để không trông như nhựa
function grain(c: CanvasRenderingContext2D, w: number, h: number, amount: number, n = 2400, rnd = Math.random) {
  for (let i = 0; i < n; i++) {
    const v = rnd() < 0.5 ? 0 : 255
    c.fillStyle = `rgba(${v},${v},${v},${rnd() * amount})`
    c.fillRect(rnd() * w, rnd() * h, 1.5, 1.5)
  }
}

function edgeShade(c: CanvasRenderingContext2D, w: number, h: number, strength: number, band = 0.06) {
  const g = c.createLinearGradient(0, 0, w, 0)
  g.addColorStop(0, `rgba(0,0,0,${strength})`); g.addColorStop(band, 'rgba(0,0,0,0)')
  g.addColorStop(1 - band, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${strength})`)
  c.fillStyle = g; c.fillRect(0, 0, w, h)
  const v = c.createLinearGradient(0, 0, 0, h)
  v.addColorStop(0, `rgba(0,0,0,${strength})`); v.addColorStop(band, 'rgba(0,0,0,0)')
  v.addColorStop(1 - band, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${strength})`)
  c.fillStyle = v; c.fillRect(0, 0, w, h)
}

const rgbOf = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
const hexOf = (c: number[]) => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
const mix = (a: string, b: string, t: number) => { const x = rgbOf(a), y = rgbOf(b); return hexOf(x.map((v, i) => v + (y[i] - v) * t)) }
const hashStr = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }

const FONT = '"Segoe UI", system-ui, Arial, sans-serif'

/** Chữ vừa khung: thử cỡ từ lớn xuống, ngắt dòng theo từ, tối đa `lines` dòng. */
function fitText(c: CanvasRenderingContext2D, text: string, maxW: number, maxH: number, lines: number, weight = 700) {
  const words = text.split(/\s+/).filter(Boolean)
  for (let size = Math.floor(maxH / Math.max(1, Math.min(lines, words.length)) / 1.18); size >= 7; size--) {
    c.font = `${weight} ${size}px ${FONT}`
    const out: string[] = []
    let cur = ''
    let ok = true
    for (const wd of words) {
      const next = cur ? cur + ' ' + wd : wd
      if (c.measureText(next).width <= maxW) { cur = next; continue }
      if (!cur || c.measureText(wd).width > maxW) { ok = false; break }
      out.push(cur); cur = wd
    }
    if (cur) out.push(cur)
    if (ok && out.length <= lines && out.length * size * 1.18 <= maxH) return { size, out }
  }
  c.font = `${weight} 7px ${FONT}`
  return { size: 7, out: [text] }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath()
}

function upArrows(c: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  c.strokeStyle = color; c.lineWidth = Math.max(1.5, s * 0.12); c.lineCap = 'round'
  for (const dx of [0, s * 0.55]) {
    c.beginPath(); c.moveTo(x + dx, y + s); c.lineTo(x + dx, y + s * 0.15)
    c.moveTo(x + dx - s * 0.2, y + s * 0.35); c.lineTo(x + dx, y + s * 0.12); c.lineTo(x + dx + s * 0.2, y + s * 0.35); c.stroke()
  }
  c.fillStyle = color; c.fillRect(x - s * 0.2, y + s * 1.08, s * 0.95, Math.max(1.5, s * 0.1))
}

export interface CartonArt { hex: string; code: string; name: string; l: number; w: number; h: number }

/**
 * Thùng carton IN theo mã: nền màu mã trên giấy, nhãn trắng ghi TÊN hàng (mặt dài), MÃ hàng (mặt đầu),
 * nóc có đường nắp gấp + băng keo. Mỗi mặt vẽ đúng tỉ lệ mm của thùng ⇒ chữ không bị kéo méo.
 */
export function cartonFaces(a: CartonArt) {
  const k = Math.min(1.5, 384 / Math.max(a.l, a.w, a.h))
  const px = (mm: number) => Math.max(24, Math.round(mm * k))
  const rnd = rng(hashStr(a.code + a.name))
  // màu nền = đúng màu ô màu của mã ở danh sách (đã pha giấy kraft) — mắt dò từ danh sách sang thùng
  const base = a.hex
  const band = mix(a.hex, '#0b1424', 0.38)
  const paper = (c: CanvasRenderingContext2D, w: number, h: number, col = base) => {
    c.fillStyle = col; c.fillRect(0, 0, w, h)
    grain(c, w, h, 0.07, Math.round(w * h / 22), rnd)
    // sợi giấy: vệt dọc rất nhạt
    for (let i = 0; i < w / 6; i++) { c.fillStyle = `rgba(255,255,255,${rnd() * 0.035})`; c.fillRect(rnd() * w, 0, 1, h) }
  }
  const long = canvas(px(a.l), px(a.h), (c, w, h) => {
    paper(c, w, h)
    const bh = Math.max(4, h * 0.15)
    c.fillStyle = band; c.fillRect(0, h - bh, w, bh)
    c.fillStyle = 'rgba(255,255,255,0.75)'; c.fillRect(0, h - bh - Math.max(1.5, h * 0.015), w, Math.max(1.5, h * 0.015))
    // nhãn trắng: tên hàng
    const tall = h > w * 0.9
    const lx = w * 0.07, ly = h * (tall ? 0.24 : 0.14), lw = w * (tall ? 0.86 : 0.64), lh = h * (tall ? 0.42 : 0.6)
    roundRect(c, lx, ly, lw, lh, Math.min(lw, lh) * 0.08)
    c.fillStyle = 'rgba(250,250,247,0.94)'; c.fill()
    if (a.name) {
      const pad = Math.min(lw, lh) * 0.1
      const ft = fitText(c, a.name, lw - pad * 2, lh - pad * 2, 3)
      c.fillStyle = '#1b2431'; c.textBaseline = 'middle'; c.textAlign = 'left'
      const y0 = ly + lh / 2 - ((ft.out.length - 1) * ft.size * 1.18) / 2
      ft.out.forEach((s, i) => c.fillText(s, lx + pad, y0 + i * ft.size * 1.18))
    }
    // mã hàng trên dải màu đáy, mũi tên "hướng lên" góc phải
    if (a.code) {
      const ft = fitText(c, a.code, w * 0.4, bh * 0.8, 1)
      c.fillStyle = 'rgba(255,255,255,0.92)'; c.textBaseline = 'middle'; c.textAlign = 'right'
      c.fillText(ft.out[0], w * 0.95, h - bh / 2)
    }
    if (!tall) upArrows(c, w * 0.8, h * 0.18, Math.min(h * 0.3, w * 0.07), 'rgba(20,28,40,0.5)')
    edgeShade(c, w, h, 0.22, 0.04)
  })
  const end = canvas(px(a.w), px(a.h), (c, w, h) => {
    paper(c, w, h)
    const bh = Math.max(4, h * 0.15)
    c.fillStyle = band; c.fillRect(0, h - bh, w, bh)
    // phiếu giao hàng: mã to + vạch mã
    const lx = w * 0.12, ly = h * 0.14, lw = w * 0.76, lh = h * 0.6
    c.fillStyle = 'rgba(252,252,250,0.95)'; c.fillRect(lx, ly, lw, lh)
    const code = a.code || '—'
    const ft = fitText(c, code, lw * 0.86, lh * 0.42, 1)
    c.fillStyle = '#1b2431'; c.textBaseline = 'middle'; c.textAlign = 'center'
    c.fillText(ft.out[0], lx + lw / 2, ly + lh * 0.3)
    const bx = lx + lw * 0.1, bw = lw * 0.8, by = ly + lh * 0.58, bhh = lh * 0.3
    let x = bx
    while (x < bx + bw) {
      const t = 0.6 + rnd() * 2.2
      if (rnd() > 0.42) { c.fillStyle = '#1b2431'; c.fillRect(x, by, t, bhh) }
      x += t + 0.6 + rnd() * 1.6
    }
    edgeShade(c, w, h, 0.22, 0.05)
  })
  const top = canvas(px(a.l), px(a.w), (c, w, h) => {
    paper(c, w, h, mix(base, '#ffffff', 0.05))
    // hai nắp gấp gặp nhau giữa, băng keo trong chạy dọc
    c.fillStyle = 'rgba(0,0,0,0.16)'; c.fillRect(0, h / 2 - 1, w, 2)
    const tw = Math.min(h * 0.32, 48 * k)
    c.fillStyle = 'rgba(255,255,255,0.32)'; c.fillRect(0, h / 2 - tw / 2, w, tw)
    c.fillStyle = 'rgba(0,0,0,0.07)'; c.fillRect(0, h / 2 - tw / 2, w, 1.5); c.fillRect(0, h / 2 + tw / 2 - 1.5, w, 1.5)
    // băng keo dán chờm xuống hai đầu
    edgeShade(c, w, h, 0.2, 0.05)
  })
  return { long, end, top }
}

/** Bản đồ pháp tuyến từ một trường độ cao (0..1) — cạnh vát thùng, đường nắp gấp, mép băng keo. */
function normalMap(w: number, h: number, height: (u: number, v: number) => number, strength: number): THREE.DataTexture {
  const hf = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) hf[y * w + x] = height((x + 0.5) / w, (y + 0.5) / h)
  const data = new Uint8Array(w * h * 4)
  const at = (x: number, y: number) => hf[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength
    const n = new THREE.Vector3(-dx, -dy, 1).normalize()
    const i = (y * w + x) * 4
    data[i] = (n.x * 0.5 + 0.5) * 255; data[i + 1] = (n.y * 0.5 + 0.5) * 255; data[i + 2] = (n.z * 0.5 + 0.5) * 255; data[i + 3] = 255
  }
  const t = new THREE.DataTexture(data, w, h)
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true
  t.needsUpdate = true
  return t
}

const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }

/** Pháp tuyến mặt thùng: mép bo + giấy hơi gợn; `top` thêm rãnh nắp gấp và mép băng keo. */
export function cartonNormal(top: boolean) {
  const rnd = rng(top ? 7 : 3)
  const noise = new Float32Array(64 * 64).map(() => rnd())
  const nz = (u: number, v: number) => noise[(Math.floor(v * 64) % 64) * 64 + (Math.floor(u * 64) % 64)]
  return normalMap(128, 128, (u, v) => {
    const e = Math.min(u, 1 - u, v, 1 - v)
    let hgt = smooth(0, 0.045, e) * 0.9 + nz(u, v) * 0.012
    if (top) {
      const d = Math.abs(v - 0.5)
      hgt -= (1 - smooth(0, 0.012, d)) * 0.25
      hgt += (smooth(0.085, 0.095, d) - smooth(0.095, 0.105, d)) * 0.05
    }
    return hgt
  }, 2.2)
}

/** Hàng đã quấn màng trên pallet: lưới thùng mờ dưới lớp màng. */
export const wrappedTexture = () => canvas(256, 256, (c) => {
  const rnd = rng(5)
  c.fillStyle = '#f1ece3'; c.fillRect(0, 0, 256, 256)
  grain(c, 256, 256, 0.04, 2400, rnd)
  c.strokeStyle = 'rgba(0,0,0,0.16)'; c.lineWidth = 2
  for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64, 256); c.stroke() }
  for (let i = 1; i < 6; i++) { c.beginPath(); c.moveTo(0, i * 42.6); c.lineTo(256, i * 42.6); c.stroke() }
  // vệt bóng của màng quấn
  for (let i = 0; i < 9; i++) {
    c.fillStyle = `rgba(255,255,255,${0.10 + rnd() * 0.12})`
    c.fillRect(0, rnd() * 256, 256, 3 + rnd() * 6)
  }
  edgeShade(c, 256, 256, 0.18)
})

/** Một tấm ván pallet: thớ chạy dọc, vài mắt gỗ, hai đầu sẫm hơn. Nền gần trắng — vật liệu nhân với MÀU PALLET khai ở
 *  mã pallet (Material.pallet_color; mặc định xanh Loscam), ra đúng màu mà vẫn thấy vân gỗ. */
export const boardTexture = () => canvas(512, 64, (c, w, h) => {
  const rnd = rng(11)
  c.fillStyle = '#efefef'; c.fillRect(0, 0, w, h)
  for (let k = 0; k < 26; k++) {
    c.strokeStyle = `rgba(120,78,38,${0.06 + rnd() * 0.14})`
    c.lineWidth = 0.6 + rnd() * 1.4
    const y = rnd() * h, a = 1 + rnd() * 2.5, f = 30 + rnd() * 60
    c.beginPath(); c.moveTo(0, y)
    for (let x = 0; x <= w; x += 16) c.lineTo(x, y + Math.sin(x / f + k) * a)
    c.stroke()
  }
  for (let k = 0; k < 3; k++) {
    const x = 40 + rnd() * (w - 80), y = 10 + rnd() * (h - 20), r = 3 + rnd() * 4
    const g = c.createRadialGradient(x, y, 0, x, y, r * 2.2)
    g.addColorStop(0, 'rgba(80,45,15,0.75)'); g.addColorStop(0.45, 'rgba(110,70,30,0.35)'); g.addColorStop(1, 'rgba(110,70,30,0)')
    c.fillStyle = g; c.beginPath(); c.ellipse(x, y, r * 2.6, r * 1.4, 0, 0, Math.PI * 2); c.fill()
  }
  const e = c.createLinearGradient(0, 0, w, 0)
  e.addColorStop(0, 'rgba(70,40,15,0.35)'); e.addColorStop(0.03, 'rgba(70,40,15,0)'); e.addColorStop(0.97, 'rgba(70,40,15,0)'); e.addColorStop(1, 'rgba(70,40,15,0.35)')
  c.fillStyle = e; c.fillRect(0, 0, w, h)
  grain(c, w, h, 0.06, 2600, rnd)
})

/** Sàn thùng: ván ghép chạy dọc xe, đã dùng lâu (vệt mòn, khe sẫm). `ply` = ván ép container (nâu sẫm, tấm rộng). */
export const floorTexture = (planks: number, ply = false) => canvas(1024, 256, (c, w, h) => {
  const rnd = rng(ply ? 21 : 17)
  const ph = h / planks
  for (let i = 0; i < planks; i++) {
    const base = ply ? 96 + rnd() * 18 : 128 + rnd() * 26
    c.fillStyle = ply ? `rgb(${base + 14},${base - 22},${base - 52})` : `rgb(${base + 12},${base - 14},${base - 46})`
    c.fillRect(0, i * ph, w, ph)
    for (let k = 0; k < 16; k++) {
      c.strokeStyle = `rgba(60,35,15,${0.06 + rnd() * 0.1})`
      c.lineWidth = 0.8 + rnd() * 1.4
      const y = i * ph + rnd() * ph
      c.beginPath(); c.moveTo(0, y)
      for (let x = 0; x <= w; x += 32) c.lineTo(x, y + Math.sin(x / (40 + rnd() * 20) + k) * 1.6)
      c.stroke()
    }
    c.fillStyle = 'rgba(25,14,6,0.6)'; c.fillRect(0, i * ph, w, 2)
    // nối ván so le
    if (!ply) { c.fillStyle = 'rgba(25,14,6,0.45)'; c.fillRect((i * 0.37 % 1) * w, i * ph, 2, ph) }
  }
  // vệt mòn sáng do xe nâng / thùng kéo lê
  for (let i = 0; i < 14; i++) { c.fillStyle = `rgba(255,240,220,${rnd() * 0.06})`; c.fillRect(rnd() * w, 0, 30 + rnd() * 160, h) }
  grain(c, w, h, 0.07, 6000, rnd)
})

/** Tấm ốp vách (lòng thùng / vỏ thùng): nối tấm dọc + đinh tán. Lặp theo chiều dài xe. */
export const panelTexture = (base: string, seam: number) => canvas(512, 256, (c, w, h) => {
  const rnd = rng(31)
  c.fillStyle = base; c.fillRect(0, 0, w, h)
  for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(0,0,0,${rnd() * 0.025})`; c.fillRect(rnd() * w, 0, 2 + rnd() * 8, h) }
  grain(c, w, h, 0.035, 3000, rnd)
  for (const x of [0, w / 2]) {
    c.fillStyle = `rgba(0,0,0,${seam})`; c.fillRect(x, 0, 2, h)
    c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(x + 2, 0, 1, h)
    for (let y = 10; y < h; y += 22) { c.fillStyle = `rgba(0,0,0,${seam * 0.9})`; c.beginPath(); c.arc(x + 7, y, 1.6, 0, Math.PI * 2); c.fill() }
  }
})

/** Gai lốp: khối gai so le + rãnh dọc. Dùng làm cả màu lẫn bump. */
export const treadTexture = () => canvas(512, 64, (c, w, h) => {
  c.fillStyle = '#26282b'; c.fillRect(0, 0, w, h)
  const n = 48, bw = w / n
  for (let i = 0; i < n; i++) {
    c.fillStyle = '#34373b'
    c.fillRect(i * bw + 1, 4, bw * 0.62, h * 0.4)
    c.fillRect(i * bw + bw * 0.4, h * 0.52, bw * 0.62, h * 0.42)
  }
  c.fillStyle = '#121314'; c.fillRect(0, h * 0.46, w, 3)
})

/** Hông lốp: vòng tròn đồng tâm mờ. */
export const sidewallTexture = () => canvas(256, 256, (c, w) => {
  const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
  g.addColorStop(0, '#2a2c30'); g.addColorStop(0.62, '#202225'); g.addColorStop(0.8, '#2b2d31'); g.addColorStop(0.97, '#1c1d20'); g.addColorStop(1, '#151618')
  c.fillStyle = g; c.fillRect(0, 0, w, w)
  c.strokeStyle = 'rgba(255,255,255,0.06)'; c.lineWidth = 2
  c.beginPath(); c.arc(w / 2, w / 2, w * 0.4, 0, Math.PI * 2); c.stroke()
})

/** Decal phản quang đỏ - trắng xen kẽ (dán dọc hông + đuôi thùng). Một ô lặp = 1 đỏ + 1 trắng. */
export const tapeTexture = () => canvas(128, 16, (c, w, h) => {
  c.fillStyle = '#c8202c'; c.fillRect(0, 0, w / 2, h)
  c.fillStyle = '#f3f3f0'; c.fillRect(w / 2, 0, w / 2, h)
  c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(0, 2, w, 2)
})

/** Biển số xe kinh doanh vận tải (nền vàng, chữ đen) — chỉ vẽ khi người dùng khai biển số. */
export const plateTexture = (lines: string[], wMM: number, hMM: number) => {
  const k = 512 / wMM
  return canvas(512, Math.round(hMM * k), (c, w, h) => {
    c.fillStyle = '#f2c230'; c.fillRect(0, 0, w, h)
    c.strokeStyle = '#141414'; c.lineWidth = Math.max(4, h * 0.05); roundRect(c, 6, 6, w - 12, h - 12, h * 0.06); c.stroke()
    c.fillStyle = '#141414'; c.textAlign = 'center'; c.textBaseline = 'middle'
    const lh = (h - 24) / lines.length
    lines.forEach((s, i) => {
      const ft = fitText(c, s, w - 48, lh * 0.92, 1, 700)
      c.fillText(ft.out[0], w / 2, 12 + lh * (i + 0.53))
    })
  })
}

/** Bê tông sân bãi: hạt + loang + khe cắt giữa các tấm (mỗi ô texture = một tấm). */
export const concreteTexture = () => {
  const t = canvas(1024, 1024, (c, w, h) => {
    const rnd = rng(41)
    c.fillStyle = '#d3d6d9'; c.fillRect(0, 0, w, h)
    // loang mềm nhiều cỡ (mép mờ dần, không thành chấm tròn khi lát cả sân)
    for (let i = 0; i < 260; i++) {
      const x = rnd() * w, y = rnd() * h, r = 12 + rnd() * rnd() * 160, dark = rnd() < 0.55
      const g = c.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, `rgba(${dark ? '60,62,66' : '255,255,255'},${0.012 + rnd() * 0.02})`); g.addColorStop(1, 'rgba(128,128,128,0)')
      c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2)
    }
    grain(c, w, h, 0.07, 42000, rnd)
    // vết dầu / bánh xe rất nhạt
    for (let i = 0; i < 5; i++) {
      const x = rnd() * w, y = rnd() * h, r = 10 + rnd() * 40
      const g = c.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, 'rgba(40,40,40,0.08)'); g.addColorStop(1, 'rgba(40,40,40,0)')
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill()
    }
    c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(0, 0, w, 3); c.fillRect(0, 0, 3, h)
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(0, 3, w, 1); c.fillRect(3, 0, 1, h)
  })
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  return t
}

/** Vạch sơn trắng đã mòn trên sân. */
export const lineTexture = () => canvas(512, 32, (c, w, h) => {
  const rnd = rng(51)
  c.fillStyle = 'rgba(245,245,240,0.92)'; c.fillRect(0, 0, w, h)
  for (let i = 0; i < 900; i++) { c.clearRect(rnd() * w, rnd() * h, 1 + rnd() * 4, 1 + rnd() * 3) }
  for (let i = 0; i < 12; i++) { c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(rnd() * w, 0, 6 + rnd() * 30, h) }
})

/** Kính xe: sẫm, phần trên ánh trời nhạt — cộng với phản chiếu môi trường cho cảm giác kính thật, không đen đặc. */
export const glassTexture = () => canvas(64, 256, (c, w, h) => {
  const g = c.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#5d728a'); g.addColorStop(0.35, '#2b3a4b'); g.addColorStop(0.7, '#18212c'); g.addColorStop(1, '#10161d')
  c.fillStyle = g; c.fillRect(0, 0, w, h)
})

/** Lưới tản nhiệt: nan ngang tối. */
export const grilleTexture = () => canvas(256, 128, (c) => {
  c.fillStyle = '#121418'; c.fillRect(0, 0, 256, 128)
  for (let i = 0; i < 7; i++) {
    const y = 10 + i * 16
    const g = c.createLinearGradient(0, y, 0, y + 8)
    g.addColorStop(0, '#6a717b'); g.addColorStop(1, '#2a2f36')
    c.fillStyle = g; c.fillRect(8, y, 240, 8)
  }
})
