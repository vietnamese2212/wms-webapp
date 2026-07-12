// Sơ đồ xếp xe 3D — thuật toán xếp thùng carton vào lòng thùng xe (chạy thuần FE).
// LUẬT XẾP (user chốt 12/07/2026, chỉnh lần 3):
// 1. Trải HẾT chiều dài xe khi hàng ít (hạ số lớp chuẩn đồng loạt); các chân đầy đều
//    nhau ở "số lớp chuẩn" của loại kích thước.
// 2. Xếp hết ĐƠN 1 rồi mới tới ĐƠN 2 (1 xe nhiều DO).
// 3. Hàng CÙNG (hoặc gần) KÍCH THƯỚC gom thành 1 KHỐI chung — trong khối các mã xếp
//    nối tiếp LIỀN MẠCH, hết mã này tới mã khác, mã sau đè tiếp lên CHÂN DỞ của mã
//    trước (không để hở). 1 khối/dãy KHÔNG có 2 loại kích thước.
// 4. GIAO THOA chỉ xảy ra khi đổi loại kích thước: phần dư của loại cũ không đủ 1 chân
//    → rải LÊN NÓC khối của chính loại cũ (nếu còn trần), không thì đứng chân dở cuối khối.
// 5. Mã hàng nhẹ (stack_on_top) xếp TRÊN mã khác: chân hàng nền HẠ ĐỀU chừa "lớp nền
//    phẳng" (reserve) rồi hàng nhẹ trải lên nóc. max_stack_layers giới hạn số lớp.
// 1 step = 1 lượt đặt (1 chân mới / 1 cụm đè lên chân dở / 1 cụm lên nóc) — cho thanh
// trượt "xếp theo thứ tự". Đơn vị: mm.

export interface TruckDims { length: number; width: number; height: number }

export interface LoadGroup {
  key: string          // doKey|material_code (duy nhất)
  label: string
  doKey: string
  doLabel: string
  count: number
  l: number; w: number; h: number
  weightKg: number | null
  assumed: boolean
  maxLayers: number | null
  onTop: boolean
}

export interface PlacedBox {
  x: number; y: number; z: number   // gốc = góc trong-trái-sàn; x dọc thân xe (0 = sát cabin)
  l: number; w: number; h: number
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
  spreadLayersPct: number
}

export const ASSUMED_CARTON = { l: 422, w: 233, h: 100 }   // mm — cỡ thùng chuẩn user đưa 12/07

type Col = { x: number; y: number; fl: number; fw: number; top: number; doKey: string; step: number }

// "Gần kích thước" = trùng nhau khi làm tròn về cm — cùng class thì gom chung khối
const classKeyOf = (g: LoadGroup) => `${Math.round(g.l / 10)}x${Math.round(g.w / 10)}x${Math.round(g.h / 10)}`

export function computeLoadPlan(truck: TruckDims, groupsIn: LoadGroup[]): LoadPlan {
  const doOrder: string[] = []
  for (const g of groupsIn) if (!doOrder.includes(g.doKey)) doOrder.push(g.doKey)

  // Sàn: trong 1 đơn, gom theo LOẠI KÍCH THƯỚC (class) — class footprint lớn xếp trước;
  // trong class giữ thứ tự mã như trong chuyến.
  const floorIdx = groupsIn.map((_, i) => i).filter(i => !groupsIn[i].onTop)
  const topOrder = groupsIn.map((_, i) => i).filter(i => groupsIn[i].onTop)
  const orderFloor = [...floorIdx].sort((a, b) => {
    const ga = groupsIn[a], gb = groupsIn[b]
    const d = doOrder.indexOf(ga.doKey) - doOrder.indexOf(gb.doKey)
    if (d) return d
    const fa = ga.l * ga.w, fb = gb.l * gb.w
    if (fa !== fb) return fb - fa
    const ka = classKeyOf(ga), kb = classKeyOf(gb)
    if (ka !== kb) return ka < kb ? -1 : 1
    return a - b
  })

  // Hàng nhẹ xếp đè → HẠ ĐỀU chân hàng nền chừa reserve (lớp nền phẳng)
  const onTopGroups = groupsIn.filter(g => g.onTop && g.count > 0)
  let reserveH = 0
  if (onTopGroups.length) {
    const floorArea = truck.length * truck.width
    const maxTopH = Math.max(...onTopGroups.map(g => g.h))
    const area1Layer = onTopGroups.reduce((s, g) => s + g.count * g.l * g.w, 0)
    const layers = Math.max(1, Math.ceil(area1Layer / Math.max(1, floorArea * 0.9)))
    reserveH = Math.min(layers * maxTopH, truck.height * 0.5)
  }

  function pack(f: number) {
    const placed: PlacedBox[] = []
    const leftover: { group: number; count: number }[] = []
    const cols: Col[] = []
    let step = 0
    // Dải (shelf) hiện tại — 1 dải chỉ 1 (đơn × loại kích thước) và 1 HƯỚNG XOAY duy nhất
    // (trộn 2 hướng trong 1 dải làm dải phình sâu mà chứa ít chân — lãng phí sàn)
    let shelfX = 0, shelfDepth = 0, cursorY = 0
    let shelfKey: string | null = null
    let shelfOrient: { fl: number; fw: number } | null = null
    const closeShelf = () => { if (shelfDepth > 0) { shelfX += shelfDepth; shelfDepth = 0; cursorY = 0 } shelfKey = null; shelfOrient = null }

    // Trạng thái KHỐI kích thước đang mở (trong 1 đơn)
    let openCol: { col: Col; used: number; cap: number } | null = null   // chân dở — mã sau CÙNG class lấp tiếp (cap = trần lớp của chân)
    let classCols: Col[] = []                               // các chân của class hiện tại (để rải phần dư lên nóc)

    // Đặt 1 chân MỚI của class: shelf logic; take = số lớp đổ vào (≤ std)
    const newColumn = (g: LoadGroup, gi: number, take: number, std: number, rowKey: string): boolean => {
      if (shelfKey !== null && shelfKey !== rowKey) closeShelf()
      const opts = g.l === g.w ? [{ fl: g.l, fw: g.w }] : [{ fl: g.l, fw: g.w }, { fl: g.w, fw: g.l }]
      // Chọn hướng cho CẢ DẢI: nhiều chân / mm chiều sâu nhất (tie → dải nông hơn)
      const pickBest = () => {
        const c = opts.filter(o => shelfX + o.fl <= truck.length && o.fw <= truck.width)
        if (!c.length) return null
        return c.sort((a, b) =>
          (Math.floor(truck.width / b.fw) / b.fl) - (Math.floor(truck.width / a.fw) / a.fl) || (a.fl - b.fl))[0]
      }
      if (!shelfOrient) {
        shelfOrient = pickBest()
        if (!shelfOrient && shelfDepth > 0) { closeShelf(); shelfOrient = pickBest() }
        if (!shelfOrient) return false
      }
      let pick = shelfOrient
      if (cursorY + pick.fw > truck.width || shelfX + pick.fl > truck.length) {
        if (shelfDepth === 0) return false
        closeShelf()
        shelfOrient = pickBest()
        if (!shelfOrient) return false
        pick = shelfOrient
      }
      step++
      for (let k = 0; k < take; k++)
        placed.push({ x: shelfX, y: cursorY, z: k * g.h, l: pick.fl, w: pick.fw, h: g.h, group: gi, step })
      const col: Col = { x: shelfX, y: cursorY, fl: pick.fl, fw: pick.fw, top: take * g.h, doKey: g.doKey, step }
      cols.push(col); classCols.push(col)
      cursorY += pick.fw
      shelfDepth = Math.max(shelfDepth, pick.fl)
      shelfKey = rowKey
      openCol = take < std ? { col, used: take, cap: std } : null
      return true
    }

    // Đổ hàng 1 MÃ vào class đang mở (liền mạch — lấp chân dở trước, rồi chân mới)
    // isClassTail: mã CUỐI của class → phần dư rải lên nóc khối class (giao thoa)
    const pourGroup = (g: LoadGroup, gi: number, count: number, std: number, rowKey: string, isClassTail: boolean) => {
      let remaining = count
      // 1) Lấp tiếp CHÂN DỞ của mã trước (cùng kích thước → đè lên nhau, không hở)
      // Trần chân dở = min(trần chân, trần lớp của mã đang đổ) — mã yếu (max lớp thấp) không bị chồng quá
      if (openCol && remaining > 0) {
        const effCap = Math.min(openCol.cap, std)
        const take = Math.min(remaining, Math.max(0, effCap - openCol.used))
        if (take > 0) {
          step++
          for (let k = 0; k < take; k++)
            placed.push({ x: openCol.col.x, y: openCol.col.y, z: openCol.col.top + k * g.h, l: openCol.col.fl, w: openCol.col.fw, h: g.h, group: gi, step })
          openCol.col.top += take * g.h
          openCol.used += take
          openCol.cap = effCap
          remaining -= take
        }
        if (openCol.used >= effCap) openCol = null
      }
      // 2) Chân mới đầy đủ std lớp
      while (remaining >= std) {
        if (!newColumn(g, gi, std, std, rowKey)) { leftover.push({ group: gi, count: remaining }); return }
        remaining -= std
      }
      if (remaining <= 0) return
      // 3) Đuôi mã
      if (!isClassTail) {
        // mã sau cùng class sẽ lấp tiếp → để chân dở
        if (!newColumn(g, gi, remaining, std, rowKey)) leftover.push({ group: gi, count: remaining })
        return
      }
      // 3b) ĐUÔI CLASS (giao thoa): rải lên NÓC khối của chính class — mỗi chân tối đa 1 lớp thêm
      for (const oc of classCols) {
        if (remaining <= 0) break
        if (oc === openCol?.col) continue
        if (truck.height - oc.top < g.h) continue
        if (g.maxLayers != null && Math.round(oc.top / g.h) >= g.maxLayers) continue   // không vượt trần lớp của mã
        step++
        placed.push({ x: oc.x, y: oc.y, z: oc.top, l: oc.fl, w: oc.fw, h: g.h, group: gi, step })
        oc.top += g.h
        remaining -= 1
      }
      // vẫn còn (không đủ trần) → chân dở đứng CUỐI khối (khối vẫn 1 loại kích thước)
      if (remaining > 0 && !newColumn(g, gi, remaining, std, rowKey)) leftover.push({ group: gi, count: remaining })
    }

    // Luật 2: đi từng ĐƠN — sàn (theo khối kích thước) → hàng nhẹ lên nóc → đơn sau
    for (const dk of doOrder) {
      const doFloor = orderFloor.filter(gi => groupsIn[gi].doKey === dk && groupsIn[gi].count > 0)
      // Chia thành các CLASS liên tiếp (orderFloor đã gom class cạnh nhau)
      let i = 0
      while (i < doFloor.length) {
        const ck = classKeyOf(groupsIn[doFloor[i]])
        const members: number[] = []
        while (i < doFloor.length && classKeyOf(groupsIn[doFloor[i]]) === ck) members.push(doFloor[i++])
        // Thông số class: chiều cao đại diện = max h; cap theo trần đã trừ reserve.
        // maxLayers áp PER MÃ (chân của mã yếu thấp hơn) — KHÔNG kéo cả khối xuống.
        const maxH = Math.max(...members.map(gi => groupsIn[gi].h))
        if (maxH > truck.height || Math.min(...members.map(gi => Math.min(groupsIn[gi].l, groupsIn[gi].w))) > truck.width) {
          for (const gi of members) leftover.push({ group: gi, count: groupsIn[gi].count })
          continue
        }
        const capH = Math.max(1, Math.floor((truck.height - reserveH) / maxH))
        const rowKey = `${dk}|${ck}`
        openCol = null; classCols = []
        members.forEach((gi, idx) => {
          const g = groupsIn[gi]
          const std = Math.max(1, Math.min(Math.round(capH * f), capH, g.maxLayers ?? Infinity))
          pourGroup(g, gi, g.count, std, rowKey, idx === members.length - 1)
        })
        openCol = null
      }
      // Hàng nhẹ của đơn — ưu tiên nóc chân cùng đơn, hết nóc mới xuống sàn
      for (const gi of topOrder) {
        const g = groupsIn[gi]
        if (g.doKey !== dk || g.count <= 0) continue
        let remaining = g.count
        const capOwn = g.h > truck.height ? 0 : Math.max(1, Math.min(Math.floor(truck.height / g.h), g.maxLayers ?? Infinity))
        if (capOwn > 0) {
          const hosts = [...cols].sort((a, b) =>
            ((a.doKey === dk ? 0 : 1) - (b.doKey === dk ? 0 : 1)) || (a.step - b.step))
          for (const host of hosts) {
            if (remaining <= 0) break
            const head = truck.height - host.top
            if (head < g.h) continue
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
        if (remaining > 0) {
          // hết nóc → xuống sàn như 1 class riêng của chính nó
          const ck = classKeyOf(g)
          const cap = g.h > truck.height ? 0 : Math.max(1, Math.min(Math.floor(truck.height / g.h), g.maxLayers ?? Infinity))
          if (cap === 0 || Math.min(g.l, g.w) > truck.width) { leftover.push({ group: gi, count: remaining }); continue }
          const std = Math.max(1, Math.min(cap, Math.round(cap * f)))
          openCol = null; classCols = []
          pourGroup(g, gi, remaining, std, `${dk}|top|${ck}`, true)
          openCol = null
        }
      }
    }
    return { placed, leftover, step }
  }

  // f=1: chồng kịch số lớp. Nếu ĐỦ hết → hạ lớp dần (f nhỏ nhất vẫn xếp đủ) để trải hết chiều dài xe.
  let best = pack(1)
  let f = 1
  if (best.leftover.length === 0) {
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
