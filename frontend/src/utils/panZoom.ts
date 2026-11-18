// PHÉP TOÁN THU PHÓNG / RÊ của các bản vẽ 2D (Sơ đồ kho · Sơ đồ bồn) — một chỗ cho mọi bản vẽ, có test (backend/tests/unit/panZoom.test.ts).
// Khung nhìn = { scale, ox, oy }: điểm (x, y) của bản vẽ hiện ở toạ độ màn hình (ox + x·scale, oy + y·scale) trong khung.

export interface View { scale: number; ox: number; oy: number }
export interface Pt { x: number; y: number }

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Phóng / thu quanh một điểm của khung (mx, my): điểm bản vẽ nằm dưới con trỏ đứng yên. */
export function zoomAt(v: View, mx: number, my: number, factor: number, min: number, max: number): View {
  const ns = clamp(v.scale * factor, min, max)
  const k = ns / v.scale
  return { scale: ns, ox: mx - (mx - v.ox) * k, oy: my - (my - v.oy) * k }
}

/** Vừa khung: cả bản vẽ (w × h) nằm giữa khung (W × H), chừa lề `pad` mỗi phía; tỉ lệ kẹp trong [min, max]. */
export function fitView(w: number, h: number, W: number, H: number, pad: number, min: number, max: number): View {
  const s = clamp(Math.min((W - 2 * pad) / Math.max(w, 1), (H - 2 * pad) / Math.max(h, 1)), min, max)
  return { scale: s, ox: (W - w * s) / 2, oy: (H - h * s) / 2 }
}

/** Hai ngón: tỉ lệ theo khoảng cách hai ngón; điểm bản vẽ dưới điểm giữa hai ngón lúc bắt đầu đi theo điểm giữa hiện tại (vừa phóng vừa rê). */
export function pinchView(start: View, m0: Pt, d0: number, m1: Pt, d1: number, min: number, max: number): View {
  const ns = clamp(start.scale * (d1 / Math.max(d0, 1)), min, max)
  const wx = (m0.x - start.ox) / start.scale, wy = (m0.y - start.oy) / start.scale
  return { scale: ns, ox: m1.x - wx * ns, oy: m1.y - wy * ns }
}

/** Không cho rê bản vẽ trôi hẳn khỏi khung: luôn chừa ít nhất `margin` px của bản vẽ trong khung (bản vẽ nhỏ hơn thì cả bản vẽ). */
export function keepInView(v: View, w: number, h: number, W: number, H: number, margin: number): View {
  const cw = w * v.scale, ch = h * v.scale
  const mx = Math.min(margin, cw, W / 2), my = Math.min(margin, ch, H / 2)
  return { scale: v.scale, ox: clamp(v.ox, mx - cw, W - mx), oy: clamp(v.oy, my - ch, H - my) }
}

/** Đưa một điểm của bản vẽ (x, y) về giữa khung ở tỉ lệ `scale`. */
export function centerOn(x: number, y: number, scale: number, W: number, H: number): View {
  return { scale, ox: W / 2 - x * scale, oy: H / 2 - y * scale }
}

/** Toạ độ khung → toạ độ bản vẽ. */
export const toWorld = (v: View, sx: number, sy: number): Pt => ({ x: (sx - v.ox) / v.scale, y: (sy - v.oy) / v.scale })
