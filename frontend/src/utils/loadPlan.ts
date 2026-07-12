// Sơ đồ xếp xe 3D — thuật toán xếp thùng carton vào lòng thùng xe (chạy thuần FE).
// LUẬT XẾP (user chốt 12/07/2026):
// 1. Trải HẾT chiều dài xe — nếu tất cả vẫn vừa khi hạ thấp số lớp, hạ đều để hàng
//    rải khắp sàn thay vì chất kịch nóc phía đầu xe; chiều cao các CHÂN cùng loại
//    chênh nhau ≤ 1 lớp (chia đều thùng cho các chân).
// 2. Xếp hết ĐƠN 1 rồi mới tới ĐƠN 2 (1 xe nhiều DO); trong đơn: XONG HẲN 1 MÃ hàng
//    rồi mới sang mã tiếp theo — mỗi DÃY (dải ngang) chỉ chứa 1 MÃ của 1 đơn.
// 3. Sang mã khác là "khóa" dãy cũ (thùng dư tự nằm trên nóc chân cùng mã nhờ chia đều).
// 4. Mã hàng nhẹ (stack_on_top) được xếp TRÊN mã khác — khi chuyến có hàng nhẹ, các chân
//    hàng NỀN được HẠ ĐỀU chừa "lớp nền phẳng" phía trên (reserve) cho hàng nhẹ trải lên nóc
//    (ưu tiên nóc cùng đơn, hết nóc mới xuống sàn). max_stack_layers giới hạn số lớp.
// 1 step = 1 chân (hoặc 1 cụm đặt lên nóc) — cho thanh trượt "xếp theo thứ tự".
// Đơn vị: mm (user chốt 12/07 — mọi kích thước thùng/lòng xe nhập mm).

export interface TruckDims { length: number; width: number; height: number }

export interface LoadGroup {
  key: string          // doKey|material_code (duy nhất)
  label: string        // tên hàng hiển thị
  doKey: string        // delivery_code — thứ tự đơn theo thứ tự xuất hiện
  doLabel: string      // nhãn đơn (DO · NPP)
  count: number
  l: number; w: number; h: number
  weightKg: number | null
  assumed: boolean     // thiếu kích thước → dùng cỡ giả định
  maxLayers: number | null   // số lớp xếp tối đa (null = theo chiều cao xe)
  onTop: boolean       // hàng nhẹ — được xếp trên mã khác
}

export interface PlacedBox {
  x: number; y: number; z: number   // gốc = góc trong-trái-sàn; x dọc thân xe (0 = sát cabin)
  l: number; w: number; h: number   // sau xoay (l theo x, w theo y)
  group: number
  step: number
}

export interface LoadPlan {
  truck: TruckDims
  groups: LoadGroup[]
  placed: PlacedBox[]
  leftover: { group: number; count: number }[]
  stepCount: number
  volumePct: number
  placedCount: number
  totalCount: number
  weightKg: number
  spreadLayersPct: number   // 100 = chồng kịch trần; thấp hơn = đã hạ lớp để trải dài
}

export const ASSUMED_CARTON = { l: 422, w: 233, h: 100 }   // mm — cỡ thùng chuẩn user đưa 12/07

type Col = { x: number; y: number; fl: number; fw: number; top: number; doKey: string; step: number }

export function computeLoadPlan(truck: TruckDims, groupsIn: LoadGroup[]): LoadPlan {
  const dimsKey = (g: LoadGroup) => `${g.l}x${g.w}x${g.h}`
  // Thứ tự đơn = thứ tự xuất hiện trong groupsIn (caller đưa theo thứ tự DO của chuyến)
  const doOrder: string[] = []
  for (const g of groupsIn) if (!doOrder.includes(g.doKey)) doOrder.push(g.doKey)
  // Sàn: trong 1 đơn, cùng kích thước đứng cạnh nhau (footprint lớn xếp trước)
  const floorOrder = groupsIn.map((_, i) => i)
    .filter(i => !groupsIn[i].onTop)
    .sort((a, b) => {
      const ga = groupsIn[a], gb = groupsIn[b]
      const d = doOrder.indexOf(ga.doKey) - doOrder.indexOf(gb.doKey)
      if (d) return d
      const fa = ga.l * ga.w, fb = gb.l * gb.w
      if (fa !== fb) return fb - fa
      const ka = dimsKey(ga), kb = dimsKey(gb)
      if (ka !== kb) return ka < kb ? -1 : 1
      return a - b
    })
  const topOrder = groupsIn.map((_, i) => i).filter(i => groupsIn[i].onTop)

  // Hàng nhẹ xếp đè → HẠ ĐỀU chân hàng nền: chừa reserve = số lớp hàng nhẹ cần
  // khi trải phẳng trên nóc (ước theo diện tích sàn xe), tối đa nửa chiều cao xe.
  const onTopGroups = groupsIn.filter(g => g.onTop && g.count > 0)
  let reserveH = 0
  if (onTopGroups.length) {
    const floorArea = truck.length * truck.width
    const maxTopH = Math.max(...onTopGroups.map(g => g.h))
    const area1Layer = onTopGroups.reduce((s, g) => s + g.count * g.l * g.w, 0)
    const layers = Math.max(1, Math.ceil(area1Layer / Math.max(1, floorArea * 0.9)))
    reserveH = Math.min(layers * maxTopH, truck.height * 0.5)
  }

  // Số lớp tối đa 1 chân của nhóm dưới trần ceilH (0 = không đặt nổi 1 thùng)
  const capOf = (g: LoadGroup, ceilH: number) => g.h > ceilH ? 0
    : Math.max(1, Math.min(Math.floor(ceilH / g.h), g.maxLayers ?? Infinity))
  // Hàng nền: trần hiệu dụng đã trừ reserve; nếu thùng cao hơn trần hạ (nhưng vẫn vừa xe) → 1 lớp
  const capFloor = (g: LoadGroup) => {
    const c = capOf(g, truck.height - reserveH)
    return c === 0 && g.h <= truck.height ? 1 : c
  }

  function pack(f: number) {
    const placed: PlacedBox[] = []
    const leftover: { group: number; count: number }[] = []
    const cols: Col[] = []
    let step = 0
    // Dải (shelf) hiện tại — 1 dải chỉ 1 (đơn × MÃ hàng)
    let shelfX = 0, shelfDepth = 0, cursorY = 0
    let shelfKey: string | null = null

    const closeShelf = () => { if (shelfDepth > 0) { shelfX += shelfDepth; shelfDepth = 0; cursorY = 0 } shelfKey = null }

    // Đặt 1 chân `layers` thùng của nhóm gi — trả số thùng đặt được (0 = hết chỗ sàn)
    const placeColumn = (g: LoadGroup, gi: number, layers: number): number => {
      const rowKey = `${g.doKey}|${gi}`   // 1 dãy = 1 MÃ của 1 đơn (xong hẳn mã này mới sang mã khác)
      if (shelfKey !== null && shelfKey !== rowKey) closeShelf()
      const opts = g.l === g.w ? [{ fl: g.l, fw: g.w }] : [{ fl: g.l, fw: g.w }, { fl: g.w, fw: g.l }]
      const tryFit = () => opts
        .filter(o => shelfX + o.fl <= truck.length && cursorY + o.fw <= truck.width)
        .sort((a, b) => (a.fl - b.fl) || (a.fw - b.fw))[0] ?? null
      let pick = tryFit()
      if (!pick) {
        if (shelfDepth === 0) return 0
        closeShelf()
        pick = tryFit()
        if (!pick) return 0
      }
      step++
      for (let k = 0; k < layers; k++)
        placed.push({ x: shelfX, y: cursorY, z: k * g.h, l: pick.fl, w: pick.fw, h: g.h, group: gi, step })
      cols.push({ x: shelfX, y: cursorY, fl: pick.fl, fw: pick.fw, top: layers * g.h, doKey: g.doKey, step })
      cursorY += pick.fw
      shelfDepth = Math.max(shelfDepth, pick.fl)
      shelfKey = rowKey
      return layers
    }

    // Xếp 1 nhóm xuống sàn: chia ĐỀU count cho các chân (chênh ≤ 1 lớp — luật 1)
    const placeFloorGroup = (g: LoadGroup, gi: number, count: number) => {
      if (count <= 0) return
      const cap = capFloor(g)
      if (cap === 0 || Math.min(g.l, g.w) > truck.width || Math.max(g.l, g.w) > truck.length) {
        leftover.push({ group: gi, count }); return
      }
      const layers = Math.max(1, Math.min(cap, Math.round(cap * f)))
      const nCols = Math.ceil(count / layers)
      const base = Math.floor(count / nCols), extra = count % nCols
      let remaining = count
      for (let c = 0; c < nCols && remaining > 0; c++) {
        const want = Math.min(remaining, c < extra ? base + 1 : base)
        const got = placeColumn(g, gi, want)
        if (got === 0) { leftover.push({ group: gi, count: remaining }); return }
        remaining -= got
      }
    }

    // Luật 2: đi từng ĐƠN — sàn của đơn xong → hàng nhẹ của đơn lên nóc → mới sang đơn sau
    for (const dk of doOrder) {
      for (const gi of floorOrder) if (groupsIn[gi].doKey === dk) placeFloorGroup(groupsIn[gi], gi, groupsIn[gi].count)
      for (const gi of topOrder) {
        const g = groupsIn[gi]
        if (g.doKey !== dk || g.count <= 0) continue
        let remaining = g.count
        const capOwn = capOf(g, truck.height)
        if (capOwn > 0) {
          // Ưu tiên nóc chân CÙNG ĐƠN, rồi nóc các chân đã xếp trước đó
          const hosts = [...cols].sort((a, b) =>
            ((a.doKey === dk ? 0 : 1) - (b.doKey === dk ? 0 : 1)) || (a.step - b.step))
          for (const host of hosts) {
            if (remaining <= 0) break
            const head = truck.height - host.top
            if (head < g.h) continue
            // Thùng phải nằm gọn trên mặt chân đỡ (2 hướng xoay)
            const fit = (g.l <= host.fl && g.w <= host.fw) ? { fl: g.l, fw: g.w }
              : (g.w <= host.fl && g.l <= host.fw) ? { fl: g.w, fw: g.l } : null
            if (!fit) continue
            const layers = Math.min(capOwn, Math.floor(head / g.h), remaining)
            step++
            for (let k = 0; k < layers; k++)
              placed.push({ x: host.x, y: host.y, z: host.top + k * g.h, l: fit.fl, w: fit.fw, h: g.h, group: gi, step })
            host.top += layers * g.h
            remaining -= layers
          }
        }
        if (remaining > 0) placeFloorGroup(g, gi, remaining)   // hết nóc → xuống sàn như thường
      }
    }
    return { placed, leftover, step }
  }

  // f=1: chồng kịch số lớp cho vừa nhiều nhất. Nếu ĐỦ hết → hạ lớp dần (f nhỏ)
  // để trải hàng ra HẾT chiều dài xe (luật 1), lấy f nhỏ nhất vẫn xếp đủ.
  let best = pack(1)
  let f = 1
  if (best.leftover.length === 0) {
    // f nhỏ nhất vẫn xếp đủ = trải rộng nhất (0.12 → hạ tới 1 lớp khi hàng ít)
    for (const cand of [0.12, 0.2, 0.3, 0.42, 0.55, 0.7, 0.85]) {
      const r = pack(cand)
      if (r.leftover.length === 0) { best = r; f = cand; break }
    }
  }

  const { placed, leftover, step } = best
  const truckVol = truck.length * truck.width * truck.height
  const usedVol = placed.reduce((s, b) => s + b.l * b.w * b.h, 0)
  const weightKg = placed.reduce((s, b) => s + (groupsIn[b.group].weightKg ?? 0), 0)
  const totalCount = groupsIn.reduce((s, g) => s + Math.max(0, g.count), 0)
  return {
    truck, groups: groupsIn, placed, leftover, stepCount: step,
    volumePct: truckVol > 0 ? Math.round((usedVol / truckVol) * 1000) / 10 : 0,
    placedCount: placed.length, totalCount,
    weightKg: Math.round(weightKg * 10) / 10,
    spreadLayersPct: Math.round(f * 100),
  }
}

// Bảng màu nhóm (tô theo mã hàng)
export const GROUP_COLORS = [
  '#0284c7', '#ea580c', '#16a34a', '#9333ea', '#dc2626', '#ca8a04',
  '#0d9488', '#db2777', '#4f46e5', '#65a30d', '#b45309', '#0891b2',
]
