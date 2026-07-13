// Sơ đồ xếp xe 3D — thuật toán xếp thùng carton vào lòng thùng xe (chạy thuần FE).
// LUẬT XẾP (user chốt 12/07/2026, chỉnh lần 4 — 13/07):
// 1. Trải HẾT chiều dài xe: khối chân TRONG cao kịch, đuôi hạ DẦN TỪNG BẬC ra cửa
//    ("bậc thang thoải xuống") — không bỏ trống đuôi xe khi còn hạ lớp được.
// 2. Xếp hết ĐƠN 1 rồi mới tới ĐƠN 2 (1 xe nhiều DO).
// 3. Hàng CÙNG (hoặc gần) KÍCH THƯỚC gom thành 1 KHỐI chung — trong khối các mã xếp
//    nối tiếp LIỀN MẠCH, hết mã này tới mã khác, mã sau đè tiếp lên CHÂN DỞ của mã
//    trước (không để hở). 1 khối/dãy KHÔNG có 2 loại kích thước.
// 4. GIAO THOA chỉ xảy ra khi đổi loại kích thước: phần dư của loại cũ không đủ 1 chân
//    → rải LÊN NÓC khối của chính loại cũ (nếu còn trần), không thì đứng chân dở cuối khối.
// 5. Mã hàng nhẹ (stack_on_top) xếp TRÊN mã khác thành KHỐI LIỀN MẠCH: đi từ PHÍA CỬA
//    vào, mỗi nóc chồng đủ số lớp cho phép (max_stack_layers / trần xe) rồi mới sang nóc
//    kế — KHÔNG rải mỏng 1 lớp từ trong ra ngoài. Đuôi bậc thang thấp phía cửa chính là
//    chỗ trống tự nhiên cho khối này; hết nóc mới xuống sàn.
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
  lengthUsedPct: number   // % chiều dài xe đã dùng
}

export const ASSUMED_CARTON = { l: 422, w: 233, h: 100 }   // mm — cỡ thùng chuẩn user đưa 12/07

type Col = { x: number; y: number; fl: number; fw: number; top: number; doKey: string; step: number; groups: Set<number> }
type RowStat = { cols: number; fl: number; fw: number }

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

  // nColsMap (tùy chọn): số CHÂN muốn dùng cho từng khối `${dk}|${ck}` — vòng tinh chỉnh
  // bên dưới tăng dần để đuôi bậc thang trải TỚI ĐUÔI XE.
  function pack(nColsMap?: Map<string, number>) {
    const placed: PlacedBox[] = []
    const leftover: { group: number; count: number }[] = []
    const cols: Col[] = []
    const rows = new Map<string, RowStat>()   // thống kê chân/hướng theo khối (cho vòng tinh chỉnh)
    let step = 0
    // Dải (shelf) hiện tại — 1 dải chỉ 1 (đơn × loại kích thước) và 1 HƯỚNG XOAY duy nhất
    // (trộn 2 hướng trong 1 dải làm dải phình sâu mà chứa ít chân — lãng phí sàn)
    let shelfX = 0, shelfDepth = 0, cursorY = 0
    let shelfKey: string | null = null
    let shelfOrient: { fl: number; fw: number } | null = null
    const closeShelf = () => { if (shelfDepth > 0) { shelfX += shelfDepth; shelfDepth = 0; cursorY = 0 } shelfKey = null; shelfOrient = null }

    // Trạng thái KHỐI kích thước đang mở (trong 1 đơn) — object để TS không narrow sai qua closure
    const st: { openCol: { col: Col; used: number; cap: number } | null } = { openCol: null }   // chân dở — mã sau CÙNG class lấp tiếp (cap = trần lớp của chân)
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
      const col: Col = { x: shelfX, y: cursorY, fl: pick.fl, fw: pick.fw, top: take * g.h, doKey: g.doKey, step, groups: new Set([gi]) }
      cols.push(col); classCols.push(col)
      const rs = rows.get(rowKey)
      if (rs) { rs.cols++; rs.fl = pick.fl; rs.fw = pick.fw } else rows.set(rowKey, { cols: 1, fl: pick.fl, fw: pick.fw })
      cursorY += pick.fw
      shelfDepth = Math.max(shelfDepth, pick.fl)
      shelfKey = rowKey
      st.openCol = take < std ? { col, used: take, cap: std } : null
      return true
    }

    // Rải phần dư lên NÓC khối class (CHỈ khi sàn hết chỗ) — ƯU TIÊN: chân CÙNG MÃ trước →
    // chân cùng loại; trong mỗi nhóm đi TỪ PHÍA CỬA vào (step giảm dần — người bốc với tới được).
    const spillOnRoof = (g: LoadGroup, gi: number, rem: number): number => {
      const cands = [...classCols]
        .filter(oc => oc !== st.openCol?.col)
        .sort((a, b) =>
          ((b.groups.has(gi) ? 1 : 0) - (a.groups.has(gi) ? 1 : 0)) || (b.step - a.step))
      for (const oc of cands) {
        if (rem <= 0) break
        if (truck.height - oc.top < g.h) continue
        if (g.maxLayers != null && Math.round(oc.top / g.h) >= g.maxLayers) continue
        step++
        placed.push({ x: oc.x, y: oc.y, z: oc.top, l: oc.fl, w: oc.fw, h: g.h, group: gi, step })
        oc.top += g.h
        oc.groups.add(gi)
        rem -= 1
      }
      return rem
    }

    // Dãy TARGET dạng BẬC THANG THOẢI XUỐNG (user chốt 13/07 — thay 2 mức cũ):
    // các MỨC lớp hạ đều bậc d (~stdBase/9) từ trong ra cửa, mỗi mức là 1 CỤM chân liền
    // nhau (dễ nhìn); nColsWant (nếu có) = tổng số chân muốn dùng — trải hết chiều dài xe.
    const buildTargets = (C: number, stdBase: number, nColsWant?: number): number[] => {
      if (C <= 0) return []
      const n = Math.max(1, Math.max(Math.ceil(C / stdBase), Math.min(nColsWant ?? 0, C)))
      const avg = C / n
      const d = Math.max(1, Math.round(stdBase / 9))
      // Số mức tối đa sao cho mức đỉnh ≤ stdBase và mức đáy ≥ 1 (đỉnh ≈ avg + (k-1)d/2)
      const k = Math.max(1, Math.floor((2 * Math.min(stdBase - avg, avg - 1)) / d) + 1)
      const L1 = Math.min(stdBase, Math.max(1, Math.round(avg + ((k - 1) * d) / 2)))
      const hs: number[] = []            // trong → cửa, không tăng
      for (let j = 0; j < k; j++) {
        const lv = Math.max(1, L1 - j * d)
        const width = Math.floor(n / k) + (j < n % k ? 1 : 0)
        for (let c = 0; c < width; c++) hs.push(lv)
      }
      // Chỉnh tổng đúng = C, giữ dáng không tăng: thiếu → đắp chân TRONG (trần stdBase /
      // chân kề trong); lố → gọt chân NGOÀI (sàn 1 / chân kề ngoài)
      let diff = C - hs.reduce((s, v) => s + v, 0)
      let guard = 0
      while (diff !== 0 && guard++ < 100_000) {
        let moved = false
        if (diff > 0) {
          for (let i = 0; i < hs.length && diff > 0; i++) {
            const cap = i === 0 ? stdBase : hs[i - 1]
            if (hs[i] < cap) { hs[i]++; diff--; moved = true }
          }
        } else {
          for (let i = hs.length - 1; i >= 0 && diff < 0; i--) {
            const floorV = i === hs.length - 1 ? 1 : hs[i + 1]
            if (hs[i] > floorV) { hs[i]--; diff++; moved = true }
          }
        }
        if (!moved) break
      }
      return hs
    }

    const pourClass = (members: number[], capH: number, rowKey: string, nColsWant?: number) => {
      const stdBase = Math.max(1, capH)
      const C = members.reduce((s, gi) => s + groupsIn[gi].count, 0)
      const targets = buildTargets(C, stdBase, nColsWant)
      let t = 0
      st.openCol = null; classCols = []
      for (const gi of members) {
        const g = groupsIn[gi]
        const myCap = g.maxLayers ?? Infinity
        let remaining = g.count
        while (remaining > 0) {
          // 1) Lấp tiếp CHÂN DỞ (mã sau đè lên chân dở mã trước — không hở);
          //    trần hiệu dụng = min(target của chân, maxLayers của mã đang đổ)
          // TS không thấy newColumn (closure) gán st.openCol → narrow nhầm null; cast typed để thoát
          const oc = st.openCol as { col: Col; used: number; cap: number } | null
          if (oc) {
            const effCap = Math.min(oc.cap, myCap)
            const take = Math.min(remaining, Math.max(0, effCap - oc.used))
            if (take > 0) {
              step++
              for (let k = 0; k < take; k++)
                placed.push({ x: oc.col.x, y: oc.col.y, z: oc.col.top + k * g.h, l: oc.col.fl, w: oc.col.fw, h: g.h, group: gi, step })
              oc.col.top += take * g.h
              oc.used += take
              oc.col.groups.add(gi)
              remaining -= take
            }
            if (oc.used >= effCap) st.openCol = null
            if (take > 0) continue
            st.openCol = null   // mã này không đổ thêm được vào chân dở (maxLayers) → sang chân mới
            continue
          }
          // 2) Chân mới theo target kế tiếp (hết dãy target — hụt do maxLayers → dùng stdBase)
          const target = targets[t] ?? stdBase
          t++
          const take = Math.min(remaining, Math.min(target, myCap))
          if (!newColumn(g, gi, take, target, rowKey)) {
            // SÀN HẾT CHỖ → tràn phần dư lên nóc (cùng mã trước, phía cửa) rồi mới bỏ thừa
            remaining = spillOnRoof(g, gi, remaining)
            if (remaining > 0) leftover.push({ group: gi, count: remaining })
            break
          }
          remaining -= take
        }
      }
      st.openCol = null
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
        // Thông số class: chiều cao đại diện = max h.
        // maxLayers áp PER MÃ (chân của mã yếu thấp hơn) — KHÔNG kéo cả khối xuống.
        const maxH = Math.max(...members.map(gi => groupsIn[gi].h))
        if (maxH > truck.height || Math.min(...members.map(gi => Math.min(groupsIn[gi].l, groupsIn[gi].w))) > truck.width) {
          for (const gi of members) leftover.push({ group: gi, count: groupsIn[gi].count })
          continue
        }
        const capH = Math.max(1, Math.floor(truck.height / maxH))
        const rowKey = `${dk}|${ck}`
        pourClass(members, capH, rowKey, nColsMap?.get(rowKey))
      }
      // Hàng nhẹ của đơn — KHỐI LIỀN MẠCH trên nóc: đi từ phía cửa vào, mỗi nóc chồng đủ
      // số lớp cho phép rồi mới sang nóc kế (không rải mỏng); hết nóc mới xuống sàn.
      for (const gi of topOrder) {
        const g = groupsIn[gi]
        if (g.doKey !== dk || g.count <= 0) continue
        let remaining = g.count
        const capOwn = g.h > truck.height ? 0 : Math.max(1, Math.min(Math.floor(truck.height / g.h), g.maxLayers ?? Infinity))
        if (capOwn > 0) {
          // Ưu tiên nóc chân cùng đơn, đi TỪ PHÍA CỬA vào (người bốc với tới được)
          const hosts = [...cols].sort((a, b) =>
            ((a.doKey === dk ? 0 : 1) - (b.doKey === dk ? 0 : 1)) || (b.step - a.step))
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
          if (g.h > truck.height || Math.min(g.l, g.w) > truck.width) { leftover.push({ group: gi, count: remaining }); continue }
          const capOwnH = Math.max(1, Math.floor(truck.height / g.h))
          const savedCount = g.count
          // pourClass đọc count từ groupsIn — tạm thay bằng phần còn lại
          ;(groupsIn[gi] as { count: number }).count = remaining
          pourClass([gi], capOwnH, `${dk}|top|${classKeyOf(g)}`)
          ;(groupsIn[gi] as { count: number }).count = savedCount
        }
      }
    }
    return { placed, leftover, step, rows }
  }

  // Vòng tinh chỉnh "trải tới đuôi xe": xếp thử → còn thừa chiều dài → chia thêm dải cho
  // từng khối (tỷ lệ theo phần sàn nó đang chiếm) → xếp lại với đuôi bậc thang dài hơn.
  // Hàng nhẹ chuyển dần từ sàn lên nóc đuôi thấp → lặp tới khi không cải thiện (tối đa 4).
  const maxXOf = (placed: PlacedBox[]) => placed.length ? Math.max(...placed.map(b => b.x + b.l)) : 0
  let best = pack()
  if (best.leftover.length === 0) {
    for (let iter = 0; iter < 6; iter++) {
      const maxX = maxXOf(best.placed)
      const remLen = truck.length - maxX
      const floorRows = [...best.rows.entries()].filter(([k]) => !k.includes('|top|'))
      if (remLen <= 0 || !floorRows.length) break
      let usedSum = 0
      const info = floorRows.map(([k, s]) => {
        const perShelf = Math.max(1, Math.floor(truck.width / s.fw))
        const used = Math.ceil(s.cols / perShelf) * s.fl
        usedSum += used
        return { k, s, perShelf, used }
      })
      if (usedSum <= 0) break
      const map = new Map<string, number>()
      let any = false
      for (const it of info) {
        const extraShelves = Math.floor((remLen * (it.used / usedSum)) / it.s.fl)
        map.set(it.k, it.s.cols + extraShelves * it.perShelf)
        if (extraShelves > 0) any = true
      }
      if (!any) {
        // Phần dư nhỏ hơn suất chia đều của mọi khối → dồn cả cho 1 khối sâu dải nhất còn vừa
        const fit = [...info].filter(it => it.s.fl <= remLen).sort((a, b) => b.s.fl - a.s.fl)[0]
        if (!fit) break
        map.set(fit.k, fit.s.cols + fit.perShelf)
        any = true
      }
      const r = pack(map)
      if (r.leftover.length > 0 || maxXOf(r.placed) <= maxX) break
      best = r
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
    lengthUsedPct: truck.length > 0 ? Math.round((maxXOf(placed) / truck.length) * 100) : 0,
  }
}

// Bảng màu nhóm (tô theo mã hàng)
export const GROUP_COLORS = [
  '#0284c7', '#ea580c', '#16a34a', '#9333ea', '#dc2626', '#ca8a04',
  '#0d9488', '#db2777', '#4f46e5', '#65a30d', '#b45309', '#0891b2',
]
