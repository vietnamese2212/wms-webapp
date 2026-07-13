// Sơ đồ xếp xe 3D — thuật toán xếp thùng carton vào lòng thùng xe (chạy thuần FE).
// LUẬT XẾP — theo "Quy trình kiểm soát xuất kho" NM Ba Vì (file user đưa 13/07) + các chốt
// của user 12-13/07:
// 1. XẾP BẰNG MẶT: mỗi KHỐI hàng (loại kích thước) chỉ có MỘT CHIỀU CAO duy nhất —
//    "tuyệt đối không xếp 1 loại hàng có 2 chiều cao trở lên". HÀNG THỪA không đủ bằng
//    mặt → CHO HẾT LÊN TRÊN KHỐI (nổi trên nóc, khối vuông vắn), KHÔNG đứng dưới sàn —
//    thủ kho đối chiếu: n chân × cao + thừa nổi (vd 1000 thùng cao 12 = 996 + 4 nổi).
// 2. BẬC THANG BỐ CỤC từ trong ra ngoài: các khối phẳng THẤP DẦN ra cửa (khối sau không
//    nhô cao hơn đuôi khối trước quá 1 thùng của nó — du di lượng tử hóa); hàng ít →
//    hạ chiều cao khối để trải HẾT chiều dài xe.
// 3. HÀNG GHÉP PHÍA TRÊN (stack_on_top — túi/POSM) xếp TRƯỚC TIÊN, ở SÂU NHẤT trong
//    cabin, trên THỀM NỀN BẰNG PHẲNG (hàng nền hạ 1 mức phẳng, khối nhẹ chồng đủ lớp lên
//    trên) — như quy trình Container gửi túi: túi lên trước, khối riêng phía đầu kéo.
// 4. Xếp hết ĐƠN 1 rồi mới tới ĐƠN 2 (1 xe nhiều DO — như xe ghép nhiều điểm).
// 5. Hàng CÙNG (hoặc gần) KÍCH THƯỚC gom thành 1 KHỐI chung — trong khối các mã xếp
//    nối tiếp LIỀN MẠCH, hết mã này tới mã khác, mã sau đè tiếp lên CHÂN DỞ của mã
//    trước (không để hở). 1 khối/dãy KHÔNG có 2 loại kích thước.
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

  // m = hệ số trải (số chân dùng = tối thiểu × m) — chung cho mọi khối; vòng chọn bên
  // dưới tìm m LỚN NHẤT vẫn xếp đủ → bậc thang toàn xe trải tới đuôi.
  function pack(m: number) {
    const placed: PlacedBox[] = []
    const leftover: { group: number; count: number }[] = []
    const cols: Col[] = []
    let spilled = 0   // số thùng tràn nóc DO SÀN HỤT (khác "hàng thừa nổi trên khối" — bình thường)
    const used: number[] = groupsIn.map(() => 0)          // số thùng đã dùng của từng mã
    const avail = (gi: number) => Math.max(0, groupsIn[gi].count - used[gi])
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
    // Dây chuyền BẬC THANG TOÀN XE: mức trần (mm) khối kế tiếp được phép bắt đầu
    const chain = { capMm: truck.height }

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

    // Đổ TOÀN BỘ 1 class (nhiều mã, liền mạch) thành KHỐI BẰNG MẶT — MỘT chiều cao L duy
    // nhất (quy trình: "1 loại hàng chỉ có 1 chiều cao"). L bị trần dây chuyền chain.capMm
    // chặn (+1 thùng du di lượng tử hóa) và hệ số trải m hạ xuống khi hàng ít (trải hết
    // xe). PHẦN THỪA cuối khối không đủ bằng mặt → NỔI LÊN TRÊN KHỐI, không đứng sàn.
    const pourClass = (members: number[], rowKey: string) => {
      const live = members.filter(gi => avail(gi) > 0)
      if (!live.length) return
      const maxH = Math.max(...live.map(gi => groupsIn[gi].h))
      const full = Math.max(1, Math.floor(truck.height / maxH))
      // Bám mức đuôi khối trước, DU DI +1 thùng của chính khối này (thùng khác cỡ không
      // bao giờ khớp mm tuyệt đối — thiếu du di sẽ mất trần oan → hụt sàn)
      const cap = Math.max(1, Math.min(full, Math.floor(chain.capMm / maxH) + 1))
      let L = Math.max(1, Math.ceil(cap / m))            // chiều cao khối (m lớn → khối thấp, trải dài)
      // Có hàng thừa mà trần không còn chỗ nổi (khối kịch trần) → hạ khối 1 lớp để thừa
      // lên được TRÊN KHỐI (quy trình: không đứng chân ngắn dưới sàn)
      const C = live.reduce((s, gi) => s + avail(gi), 0)
      if (C % L !== 0 && (L + 1) * maxH > truck.height) L = Math.max(1, L - 1)
      st.openCol = null; classCols = []
      for (let mi = 0; mi < live.length; mi++) {
        const gi = live[mi]
        const g = groupsIn[gi]
        const myCap = g.maxLayers ?? Infinity
        const isLastOfClass = mi === live.length - 1
        let remaining = avail(gi)
        while (remaining > 0) {
          // 1) Lấp tiếp CHÂN DỞ (mã sau đè lên chân dở mã trước — không hở);
          //    trần hiệu dụng = min(chiều cao khối, maxLayers của mã đang đổ)
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
              used[gi] += take
            }
            if (oc.used >= effCap) st.openCol = null
            if (take > 0) continue
            st.openCol = null   // mã này không đổ thêm được vào chân dở (maxLayers) → sang chân mới
            continue
          }
          const myL = Math.min(L, myCap)
          // 2) HÀNG THỪA cuối khối (mã cuối, không đủ 1 chân bằng mặt) → NỔI LÊN TRÊN KHỐI
          if (isLastOfClass && remaining < myL && classCols.length > 0) {
            const before = remaining
            remaining = spillOnRoof(g, gi, remaining)
            used[gi] += before - remaining
            if (remaining <= 0) break
            // nóc không đủ (maxLayers/trần) → đành đứng chân ngắn cuối khối
          }
          // 3) Chân mới bằng mặt cao myL
          const take = Math.min(remaining, myL)
          if (!newColumn(g, gi, take, L, rowKey)) {
            // SÀN HẾT CHỖ → tràn phần dư lên nóc (cùng mã trước, phía cửa) rồi mới bỏ thừa
            const before = remaining
            remaining = spillOnRoof(g, gi, remaining)
            spilled += before - remaining
            used[gi] += before - remaining
            if (remaining > 0) { leftover.push({ group: gi, count: remaining }); used[gi] += remaining }
            break
          }
          remaining -= take
          used[gi] += take
        }
      }
      st.openCol = null
      chain.capMm = Math.min(chain.capMm, L * maxH)
    }

    // Chồng hàng nhẹ lên 1 nóc: đủ số lớp cho phép (khối liền mạch). Trả số thùng đã đặt.
    const stackLightOn = (host: Col, gi: number, remaining: number): number => {
      const g = groupsIn[gi]
      const head = truck.height - host.top
      if (head < g.h) return 0
      const fit = (g.l <= host.fl && g.w <= host.fw) ? { fl: g.l, fw: g.w }
        : (g.w <= host.fl && g.l <= host.fw) ? { fl: g.w, fw: g.l } : null
      if (!fit) return 0
      const capOwn = Math.min(Math.floor(truck.height / g.h), g.maxLayers ?? Infinity)
      const layers = Math.min(capOwn, Math.floor(head / g.h), remaining)
      if (layers <= 0) return 0
      step++
      for (let k = 0; k < layers; k++)
        placed.push({ x: host.x, y: host.y, z: host.top + k * g.h, l: fit.fl, w: fit.fw, h: g.h, group: gi, step })
      host.top += layers * g.h
      return layers
    }

    for (const dk of doOrder) {
      const doFloor = orderFloor.filter(gi => groupsIn[gi].doKey === dk && groupsIn[gi].count > 0)
      const doLights = topOrder.filter(gi => groupsIn[gi].doKey === dk && groupsIn[gi].count > 0)

      // PHA 1 — HÀNG GHÉP PHÍA TRÊN xếp TRƯỚC TIÊN, sâu nhất, trên THỀM NỀN PHẲNG:
      // nền lấy từ class sàn đầu tiên (footprint lớn — vững), hạ xuống 1 mức phẳng đều
      // chừa đúng chỗ cho khối hàng nhẹ chồng đủ lớp; hết thùng nhẹ mới sang phần sàn còn lại.
      if (doLights.length && doFloor.length) {
        // Chiều cao khối nhẹ mong muốn: theo max_stack_layers; mã không khai → ~nửa trần xe
        const wantStackMm = Math.max(...doLights.map(gi => {
          const g = groupsIn[gi]
          const layers = g.maxLayers ?? Math.max(1, Math.floor((truck.height * 0.5) / g.h))
          return Math.min(layers * g.h, truck.height - g.h)
        }))
        let li = 0                                   // mã nhẹ đang đổ (lần lượt, liền mạch)
        let baseIdx = 0                              // mã nền đang dùng
        while (li < doLights.length) {
          if (avail(doLights[li]) <= 0) { li++; continue }
          while (baseIdx < doFloor.length && avail(doFloor[baseIdx]) <= 0) baseIdx++
          if (baseIdx >= doFloor.length) break       // hết hàng nền → phần nhẹ còn lại xử lý sau
          const bi = doFloor[baseIdx]
          const bg = groupsIn[bi]
          if (bg.h > truck.height || Math.min(bg.l, bg.w) > truck.width) { baseIdx++; continue }
          // Thềm phẳng: nền cao (trần − khối nhẹ), tối thiểu 1 lớp
          const platLayers = Math.max(1, Math.min(
            Math.floor(Math.max(bg.h, truck.height - wantStackMm) / bg.h),
            Math.floor(truck.height / bg.h),
            bg.maxLayers ?? Infinity,
            avail(bi),
          ))
          if (!newColumn(bg, bi, platLayers, platLayers, `${dk}|plat|${classKeyOf(bg)}`)) break   // sàn hết chỗ
          used[bi] += platLayers
          st.openCol = null
          const host = cols[cols.length - 1]
          // Chồng các mã nhẹ lên thềm (mã này hết mới tới mã kế — khối liền mạch)
          let putOnHost = 0
          while (li < doLights.length) {
            const gi = doLights[li]
            if (avail(gi) <= 0) { li++; continue }
            const put = stackLightOn(host, gi, avail(gi))
            if (put <= 0) break                      // nóc thềm này hết chỗ → thềm mới
            used[gi] += put
            putOnHost += put
          }
          // Thềm mới tinh mà không đặt được thùng nhẹ nào (không vừa footprint) → dừng
          // pha thềm, phần nhẹ còn lại đi PHA 3 (tránh dựng thềm rỗng vô ích)
          if (putOnHost === 0) break
        }
      }

      // PHA 2 — phần sàn còn lại theo KHỐI kích thước, bậc thang toàn xe (chain)
      let i = 0
      while (i < doFloor.length) {
        const ck = classKeyOf(groupsIn[doFloor[i]])
        const members: number[] = []
        while (i < doFloor.length && classKeyOf(groupsIn[doFloor[i]]) === ck) members.push(doFloor[i++])
        const live = members.filter(gi => avail(gi) > 0)
        if (!live.length) continue
        const maxH = Math.max(...live.map(gi => groupsIn[gi].h))
        if (maxH > truck.height || Math.min(...live.map(gi => Math.min(groupsIn[gi].l, groupsIn[gi].w))) > truck.width) {
          for (const gi of live) { leftover.push({ group: gi, count: avail(gi) }); used[gi] += avail(gi) }
          continue
        }
        pourClass(members, `${dk}|${ck}`)
      }

      // PHA 3 — hàng nhẹ còn dư (thềm hết nền/hết chỗ): nóc chân cùng đơn từ phía cửa,
      // hết nóc mới xuống sàn như 1 class riêng
      for (const gi of doLights) {
        const g = groupsIn[gi]
        let remaining = avail(gi)
        if (remaining <= 0) continue
        if (g.h <= truck.height) {
          const hosts = [...cols].sort((a, b) =>
            ((a.doKey === dk ? 0 : 1) - (b.doKey === dk ? 0 : 1)) || (b.step - a.step))
          for (const host of hosts) {
            if (remaining <= 0) break
            const put = stackLightOn(host, gi, remaining)
            remaining -= put
            used[gi] += put
          }
        }
        if (remaining > 0) {
          if (g.h > truck.height || Math.min(g.l, g.w) > truck.width) {
            leftover.push({ group: gi, count: remaining }); used[gi] += remaining
            continue
          }
          pourClass([gi], `${dk}|top|${classKeyOf(g)}`)
        }
      }
    }
    return { placed, leftover, step, spilled }
  }

  // Chọn hệ số trải m LỚN NHẤT vẫn xếp đủ (trải tới đuôi xe); ƯU TIÊN phương án SẠCH
  // (không phải tràn nóc — giữ mặt cắt 1 dốc, không nhô); tie-break maxX lớn hơn.
  // Sau lưới thô, nhị phân tinh chỉnh giữa nấc tốt nhất và nấc kế.
  const maxXOf = (placed: PlacedBox[]) => placed.length ? Math.max(...placed.map(b => b.x + b.l)) : 0
  type PackResult = ReturnType<typeof pack>
  const better = (r: PackResult, cur: PackResult): boolean => {
    if (r.leftover.length > 0) return false
    if (cur.leftover.length > 0) return true
    const rClean = r.spilled === 0, cClean = cur.spilled === 0
    if (rClean !== cClean) return rClean
    return maxXOf(r.placed) >= maxXOf(cur.placed)
  }
  const M_GRID = [1, 1.06, 1.13, 1.22, 1.33, 1.5, 1.7, 2, 2.4, 3, 3.8, 5, 6.5, 8.5, 11, 14, 18, 25]
  let best = pack(1)
  let bestIdx = 0
  if (best.leftover.length === 0) {
    for (let i = 1; i < M_GRID.length; i++) {
      const r = pack(M_GRID[i])
      if (better(r, best)) { best = r; bestIdx = i }
    }
    let lo = M_GRID[bestIdx], hi = M_GRID[bestIdx + 1] ?? M_GRID[bestIdx] * 1.3
    for (let i = 0; i < 4; i++) {
      const mid = (lo + hi) / 2
      const r = pack(mid)
      if (better(r, best)) { best = r; lo = mid } else hi = mid
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
