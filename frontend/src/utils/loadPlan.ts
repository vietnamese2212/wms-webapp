// Sơ đồ xếp xe 3D — thuật toán xếp thùng carton vào lòng thùng xe (chạy thuần FE).
// LUẬT XẾP — theo "Quy trình kiểm soát xuất kho" NM Ba Vì (file user đưa 13/07) + các chốt
// của user 12-14/07:
// 1. XẾP BẰNG MẶT: mỗi KHỐI hàng (loại kích thước) chỉ có MỘT CHIỀU CAO duy nhất —
//    "tuyệt đối không xếp 1 loại hàng có 2 chiều cao trở lên". HÀNG THỪA không đủ bằng
//    mặt → CHO HẾT LÊN TRÊN KHỐI (nổi trên nóc, dồn về PHÍA TRONG), KHÔNG đứng dưới sàn —
//    thủ kho đối chiếu: n chân × cao + thừa nổi (vd 1000 thùng cao 12 = 996 + 4 nổi).
// 2. BẬC THANG BỐ CỤC từ trong ra ngoài: khối TRONG giữ CAO kịch (nhường sàn), các khối
//    sau THẤP DẦN ra cửa (trọng số trải tăng dần); hàng ít → hạ để trải HẾT chiều dài xe.
// 3. HÀNG GHÉP PHÍA TRÊN (stack_on_top — túi/POSM) xếp TRƯỚC TIÊN, ở SÂU NHẤT trong
//    cabin, trên THỀM NỀN BẰNG PHẲNG, lát lưới dày kín mặt thềm; trần vùng nhẹ = chiều
//    cao khối nền kế bên (vật lý: không có tháp lẻ không gì đỡ).
// 4. Xếp hết ĐƠN 1 rồi mới tới ĐƠN 2 (1 xe nhiều DO — như xe ghép nhiều điểm).
// 5. Hàng CÙNG (hoặc gần) KÍCH THƯỚC gom thành 1 KHỐI chung — trong khối các mã xếp
//    nối tiếp LIỀN MẠCH, mã sau đè tiếp lên CHÂN DỞ của mã trước (không để hở).
// 6. SÀN XẾP KIỂU SKYLINE (user 14/07: "khoảng hở như thế này là không thực tế"): mỗi
//    chân hàng ĐẨY LÙI ÁP SÁT hàng phía sau nó (mặt tiền từng làn bề rộng) — không còn
//    khe hở dọc giữa các khối do dải cứng; khoảng trống chỉ tồn tại ở đuôi xe.
// 7. XOAY THEO DÃY (user 14/07): thùng ĐƯỢC quay ngang/dọc, nhưng theo TỪNG DÃY (dãy =
//    một lượt mặt tiền x, tính từ trong ra ngoài) — dãy đã bắt đầu hướng nào thì cả dãy
//    hướng đó tới khi hết, KHÔNG "cái dọc cái ngang" trong 1 dãy; sang dãy mới được đổi.
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

  // m = hệ số trải — vòng chọn bên dưới tìm m LỚN NHẤT vẫn xếp đủ (trải tới đuôi xe)
  function pack(m: number) {
    const placed: PlacedBox[] = []
    const leftover: { group: number; count: number }[] = []
    const cols: Col[] = []
    let spilled = 0   // số thùng tràn nóc DO SÀN HỤT (khác "hàng thừa nổi trên khối" — bình thường)
    const used: number[] = groupsIn.map(() => 0)          // số thùng đã dùng của từng mã
    const avail = (gi: number) => Math.max(0, groupsIn[gi].count - used[gi])
    let step = 0

    // ── SKYLINE sàn: mặt tiền x theo từng đoạn bề rộng y — chân mới luôn đặt ÁP SÁT
    // mặt tiền thấp nhất còn vừa (không để khe hở dọc giữa các khối)
    type Seg = { y0: number; y1: number; x: number }
    let sky: Seg[] = [{ y0: 0, y1: truck.width, x: 0 }]
    const skyMaxX = (y0: number, y1: number): number => {
      let mx = 0
      for (const s of sky) { if (s.y1 <= y0 + 1e-9 || s.y0 >= y1 - 1e-9) continue; mx = Math.max(mx, s.x) }
      return mx
    }
    const skyFind = (fw: number, fl: number): { x: number; y: number } | null => {
      let best: { x: number; y: number } | null = null
      const tryY = (y: number) => {
        if (y < -1e-9 || y + fw > truck.width + 1e-9) return
        const x = skyMaxX(y, y + fw)
        if (x + fl > truck.length + 1e-9) return
        if (!best || x < best.x - 1e-9 || (Math.abs(x - best.x) < 1e-9 && y < best.y)) best = { x, y }
      }
      for (const s of sky) tryY(s.y0)
      tryY(truck.width - fw)
      return best
    }
    const skyCommit = (y: number, fw: number, xNew: number) => {
      const out: Seg[] = []
      for (const s of sky) {
        if (s.y1 <= y + 1e-9 || s.y0 >= y + fw - 1e-9) { out.push(s); continue }
        if (s.y0 < y - 1e-9) out.push({ y0: s.y0, y1: y, x: s.x })
        if (s.y1 > y + fw + 1e-9) out.push({ y0: y + fw, y1: s.y1, x: s.x })
      }
      out.push({ y0: y, y1: y + fw, x: xNew })
      out.sort((a, b) => a.y0 - b.y0)
      sky = []
      for (const s of out) {
        const last = sky[sky.length - 1]
        if (last && Math.abs(last.x - s.x) < 1e-9 && Math.abs(last.y1 - s.y0) < 1e-9) last.y1 = s.y1
        else sky.push({ ...s })
      }
    }

    // Trạng thái KHỐI kích thước đang mở — object để TS không narrow sai qua closure
    const st: { openCol: { col: Col; used: number; cap: number } | null } = { openCol: null }   // chân dở — mã sau CÙNG class lấp tiếp
    let classCols: Col[] = []                               // các chân của class hiện tại
    // SỔ HƯỚNG THEO DÃY (toàn xe): dãy = (class, mặt tiền x) trên sàn — dãy đã bắt đầu
    // hướng nào thì MỌI chân sau tại dãy đó phải đúng hướng ấy (kể cả quay lại lấp đoạn
    // dư, kể cả nền thềm PHA 1 với khối PHA 2 cùng class)
    const rankOrient = new Map<string, { fl: number; fw: number }>()
    const rankKey = (g: LoadGroup, x: number) => `${classKeyOf(g)}@${Math.round(x)}`
    // Dây chuyền BẬC THANG TOÀN XE: mức trần (mm) khối kế tiếp được phép bắt đầu
    const chain = { capMm: truck.height }

    // Hướng xoay cho khối: nhiều chân / mm chiều sâu nhất (tie → nông hơn)
    const orientFor = (g: LoadGroup) => {
      const opts = g.l === g.w ? [{ fl: g.l, fw: g.w }] : [{ fl: g.l, fw: g.w }, { fl: g.w, fw: g.l }]
      return opts.filter(o => o.fw <= truck.width && o.fl <= truck.length).sort((a, b) =>
        (Math.floor(truck.width / b.fw) / b.fl) - (Math.floor(truck.width / a.fw) / a.fl) || (a.fl - b.fl))[0] ?? null
    }

    // Đặt 1 chân MỚI của class qua skyline; take = số lớp đổ vào (≤ std).
    // Hướng xoay chốt theo TỪNG DÃY (sổ rankOrient): dãy đã có hướng → chỉ được đặt
    // đúng hướng đó; dãy mới → chọn hướng mặt tiền x NHỎ nhất (lấp sát), tie → mật độ.
    const newColumn = (g: LoadGroup, gi: number, take: number, std: number): boolean => {
      const pref = orientFor(g)
      if (!pref) return false
      const opts = [pref]
      if (g.l !== g.w) {
        const alt = pref.fl === g.l ? { fl: g.w, fw: g.l } : { fl: g.l, fw: g.w }
        if (alt.fw <= truck.width && alt.fl <= truck.length) opts.push(alt)
      }
      const cands = opts
        .map(o => ({ o, s: skyFind(o.fw, o.fl) }))
        .filter((c): c is { o: { fl: number; fw: number }; s: { x: number; y: number } } => c.s !== null)
        // luật 1 dãy 1 hướng: rank đã chốt hướng khác → không được đặt hướng này vào đó
        .filter(c => {
          const ro = rankOrient.get(rankKey(g, c.s.x))
          return !ro || (ro.fl === c.o.fl && ro.fw === c.o.fw)
        })
      if (!cands.length) return false
      let bestC = cands[0]
      for (const c of cands.slice(1)) if (c.s.x < bestC.s.x - 1e-9) bestC = c
      const pick = bestC.o
      const spot = bestC.s
      rankOrient.set(rankKey(g, spot.x), pick)
      step++
      for (let k = 0; k < take; k++)
        placed.push({ x: spot.x, y: spot.y, z: k * g.h, l: pick.fl, w: pick.fw, h: g.h, group: gi, step })
      const col: Col = { x: spot.x, y: spot.y, fl: pick.fl, fw: pick.fw, top: take * g.h, doKey: g.doKey, step, groups: new Set([gi]) }
      cols.push(col); classCols.push(col)
      skyCommit(spot.y, pick.fw, spot.x + pick.fl)
      st.openCol = take < std ? { col, used: take, cap: std } : null
      return true
    }

    // Rải phần dư lên NÓC khối class — ƯU TIÊN: chân CÙNG MÃ trước → chân cùng loại;
    // trong mỗi nhóm đi TỪ PHÍA TRONG ra (user: phần nổi cao hơn dồn về phía cabin).
    const spillOnRoof = (g: LoadGroup, gi: number, rem: number): number => {
      const cands = [...classCols]
        .filter(oc => oc !== st.openCol?.col)
        .sort((a, b) =>
          ((b.groups.has(gi) ? 1 : 0) - (a.groups.has(gi) ? 1 : 0)) || (a.step - b.step))
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

    // Danh sách KHỐI sàn theo thứ tự xếp — hệ số trải m đánh TRỌNG SỐ TĂNG DẦN theo vị
    // trí khối (khối TRONG giữ CAO kịch nhường sàn, phần hạ dồn về các khối sau/đuôi).
    const floorRows: string[] = []
    for (const gi of orderFloor) if (groupsIn[gi].count > 0) {
      const rk = `${groupsIn[gi].doKey}|${classKeyOf(groupsIn[gi])}`
      if (!floorRows.includes(rk)) floorRows.push(rk)
    }
    const finalRow = floorRows[floorRows.length - 1] ?? ''
    // m hiệu dụng của khối thứ idx: m^w, w chạy 0 (khối đầu — giữ nguyên cao) → 1 (khối
    // cuối — hạ đủ m). Chỉ có 1 khối → w=1 (hàng ít hạ cả khối để trải hết xe như cũ).
    const mEffOf = (rowKey: string): number => {
      const idx = floorRows.indexOf(rowKey)
      const K = floorRows.length
      const w = idx < 0 ? 1 : (K > 1 ? idx / (K - 1) : 1)
      return Math.pow(m, w)
    }

    // Đổ TOÀN BỘ 1 class (nhiều mã, liền mạch) thành KHỐI BẰNG MẶT — MỘT chiều cao L.
    // PHẦN THỪA cuối khối không đủ bằng mặt → NỔI LÊN TRÊN KHỐI, không đứng sàn.
    const pourClass = (members: number[], rowKey: string, isFinal = false) => {
      const live = members.filter(gi => avail(gi) > 0)
      if (!live.length) return
      const maxH = Math.max(...live.map(gi => groupsIn[gi].h))
      const full = Math.max(1, Math.floor(truck.height / maxH))
      // Bám mức đuôi khối trước — ceil: chỉ DU DI +1 thùng khi lệch bước (chia hết thì
      // KHÔNG nhô thêm)
      const cap = Math.max(1, Math.min(full, Math.ceil(chain.capMm / maxH)))
      let L = Math.max(1, Math.ceil(cap / mEffOf(rowKey)))   // khối càng về sau hạ càng sâu
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
          // 1) Lấp tiếp CHÂN DỞ (mã sau đè lên chân dở mã trước — không hở)
          // TS không thấy newColumn (closure) gán st.openCol → narrow nhầm null; cast typed
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
            st.openCol = null   // mã này không đổ thêm được vào chân dở (maxLayers) → chân mới
            continue
          }
          const myL = Math.min(L, myCap)
          // 2a) KHỐI CUỐI CÙNG của chuyến: phần cuối không đủ hàng ngang đầy cao L → hạ
          // thành 1 BẬC PHẲNG THẤP lấp KÍN hàng cuối (đuôi phẳng, mọi chân lấp kín),
          // thùng lẻ còn lại nổi lên trên khối
          if (isFinal && isLastOfClass && classCols.length > 0) {
            // ước lượng bề rộng chân theo dãy gần nhất của khối (hướng có thể đổi theo dãy)
            const lastCol = classCols[classCols.length - 1]
            const ow = lastCol ? lastCol.fw : Math.min(g.l, g.w)
            const cl = Math.max(1, Math.floor(truck.width / ow))
            if (remaining < myL * cl) {
              const stepH = Math.floor(remaining / cl)
              if (stepH >= 1) {
                for (let c = 0; c < cl && remaining >= stepH; c++) {
                  if (!newColumn(g, gi, stepH, stepH)) break
                  st.openCol = null
                  remaining -= stepH
                  used[gi] += stepH
                }
              }
              if (remaining > 0) {
                const b4 = remaining
                remaining = spillOnRoof(g, gi, remaining)
                used[gi] += b4 - remaining
              }
              if (remaining > 0) { leftover.push({ group: gi, count: remaining }); used[gi] += remaining }
              break
            }
          }
          // 2b) HÀNG THỪA cuối khối GIỮA chuyến (mã cuối, không đủ 1 chân bằng mặt) →
          // NỔI LÊN TRÊN KHỐI (mặt tiền dở để khối sau áp sát lấp tiếp — hàng kín)
          if (!isFinal && isLastOfClass && remaining < myL && classCols.length > 0) {
            const before = remaining
            remaining = spillOnRoof(g, gi, remaining)
            used[gi] += before - remaining
            if (remaining <= 0) break
            // nóc không đủ (maxLayers/trần) → đành đứng chân ngắn cuối khối
          }
          // 3) Chân mới bằng mặt cao myL
          const take = Math.min(remaining, myL)
          if (!newColumn(g, gi, take, L)) {
            // SÀN HẾT CHỖ → tràn phần dư lên nóc rồi mới bỏ thừa
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

    // Chồng hàng nhẹ lên 1 nóc: đủ số lớp cho phép nhưng KHÔNG nhô cao hơn cột cao nhất
    // đang có (vật lý: không có gì đỡ tháp lẻ). Trả số thùng đã đặt.
    const stackLightOn = (host: Col, gi: number, remaining: number): number => {
      const g = groupsIn[gi]
      const maxTop = cols.length ? Math.max(...cols.map(c => c.top)) : truck.height
      const head = Math.min(truck.height, maxTop) - host.top
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

      // PHA 1 — HÀNG GHÉP PHÍA TRÊN xếp TRƯỚC TIÊN, sâu nhất, trên THỀM NỀN PHẲNG.
      // Nền đổ theo TỪNG DẢI đủ dùng (qua skyline); mặt nền PHẲNG nên hàng nhẹ LÁT LƯỚI
      // DÀY kín mặt dải. Trần vùng nhẹ = T (chiều cao khối nền kế bên — không tháp lẻ).
      if (doLights.length && doFloor.length) {
        const bg0 = groupsIn[doFloor[0]]
        const full0 = Math.max(1, Math.floor(truck.height / bg0.h))
        const m0 = mEffOf(`${dk}|${classKeyOf(bg0)}`)
        const T = Math.min(truck.height, Math.max(bg0.h, (Math.ceil(full0 / m0) + 1) * bg0.h))
        // Chiều cao khối nhẹ mong muốn dưới trần T: theo max_stack_layers; không khai → ~T/2
        const wantStackMm = Math.max(...doLights.map(gi => {
          const g = groupsIn[gi]
          const layers = g.maxLayers ?? Math.max(1, Math.floor((T * 0.5) / g.h))
          return Math.min(layers * g.h, Math.max(0, T - bg0.h))
        }))
        let li = 0                                   // mã nhẹ đang lát (lần lượt, liền mạch)
        let baseIdx = 0                              // mã nền đang dùng
        const lightRemain = () => doLights.reduce((s, gi) => s + avail(gi), 0)
        // nền tích lũy toàn thềm + mép lưới nhẹ đã lát (vùng sau bắt lưới NỐI TIẾP — không lệch mốc)
        const platAll: { x: number; y: number; fl: number; fw: number }[] = []
        let lightFront = -1
        while (lightRemain() > 0 && wantStackMm > 0) {
          while (baseIdx < doFloor.length && avail(doFloor[baseIdx]) <= 0) baseIdx++
          if (baseIdx >= doFloor.length) break       // hết hàng nền → phần nhẹ còn lại đi PHA 3
          const bi0 = doFloor[baseIdx]
          const bg = groupsIn[bi0]
          if (bg.h > truck.height || Math.min(bg.l, bg.w) > truck.width) { baseIdx++; continue }
          // Thềm phẳng: nền cao (T − khối nhẹ), tối thiểu 1 lớp, không vượt T
          const platLayers = Math.max(1, Math.min(
            Math.floor(Math.max(bg.h, T - wantStackMm) / bg.h),
            Math.floor(T / bg.h),
            bg.maxLayers ?? Infinity,
          ))
          const platMm = platLayers * bg.h
          const bo = orientFor(bg)
          if (!bo) break
          while (li < doLights.length && avail(doLights[li]) <= 0) li++
          if (li >= doLights.length) break
          const lg0 = groupsIn[doLights[li]]
          if (T - platMm < lg0.h) break              // dưới trần T không còn chỗ cho nhẹ
          const capStack0 = Math.max(1, Math.min(Math.floor((T - platMm) / lg0.h), lg0.maxLayers ?? Infinity))
          const cellArea = lg0.l * lg0.w
          const areaNeed = Math.ceil(lightRemain() / capStack0) * cellArea * 1.08   // +8% viền lưới
          // 1) ĐỔ NỀN thành VÙNG PHẲNG LIÊN TỤC (nhiều dải, mã nền CÙNG CLASS nối tiếp)
          //    đủ diện tích cho toàn bộ nhẹ còn lại
          const zoneCols: { x: number; y: number }[] = []
          let zoneArea = 0
          let bIdx = baseIdx
          let pourDone = false
          // Đổ theo DẢI TRỌN VẸN (kiểm đủ diện tích SAU mỗi dải — vùng luôn chữ nhật sạch,
          // không chữ L làm ô lưới rơi phần khuyết)
          while (!pourDone && zoneArea < areaNeed) {
            let stripX: number | null = null
            for (;;) {
              while (bIdx < doFloor.length && (
                avail(doFloor[bIdx]) < platLayers ||
                classKeyOf(groupsIn[doFloor[bIdx]]) !== classKeyOf(bg) ||
                (groupsIn[doFloor[bIdx]].maxLayers ?? Infinity) < platLayers   // mã trần thấp không làm nền cao được
              )) bIdx++
              if (bIdx >= doFloor.length) { pourDone = true; break }   // hết nền cùng class
              const bi = doFloor[bIdx]
              const spot = skyFind(bo.fw, bo.fl)
              if (!spot) { pourDone = true; break }                    // hết sàn
              if (stripX !== null && Math.abs(spot.x - stripX) > 1e-9) break   // dải xong
              stripX = spot.x
              step++
              for (let k = 0; k < platLayers; k++)
                placed.push({ x: spot.x, y: spot.y, z: k * bg.h, l: bo.fl, w: bo.fw, h: bg.h, group: bi, step })
              used[bi] += platLayers
              skyCommit(spot.y, bo.fw, spot.x + bo.fl)
              rankOrient.set(rankKey(bg, spot.x), bo)   // nền thềm cũng chốt hướng dãy
              zoneCols.push(spot)
              platAll.push({ x: spot.x, y: spot.y, fl: bo.fl, fw: bo.fw })
              zoneArea += bo.fl * bo.fw
            }
          }
          if (!zoneCols.length) break                // không đổ được nền → PHA 3
          // 2) LÁT NHẸ theo lưới hàng-trộn trên vùng thềm; vùng sau NỐI LƯỚI từ mép lưới
          //    nhẹ trước (không lệch mốc → không khe giữa 2 vùng)
          const zx0 = Math.max(lightFront, Math.min(...zoneCols.map(c => c.x)))
          const zx1 = Math.max(...zoneCols.map(c => c.x)) + bo.fl
          const zy0 = Math.min(...platAll.map(c => c.y))
          const zy1 = Math.max(...platAll.map(c => c.y + c.fw))
          // ô phải nằm TRỌN trên nền thật (tính GỘP mọi cột nền của thềm — vùng có thể chữ L)
          const onPlatform = (x: number, y: number, fl: number, fw: number): boolean => {
            let cov = 0
            for (const c of platAll) {
              const ix = Math.max(0, Math.min(x + fl, c.x + c.fl) - Math.max(x, c.x))
              const iy = Math.max(0, Math.min(y + fw, c.y + c.fw) - Math.max(y, c.y))
              cov += ix * iy
            }
            return cov >= fl * fw - 1
          }
          // Lưới HÀNG-TRỘN: giải tổ hợp nA hàng sâu a + nB hàng sâu b phủ SÁT chiều sâu
          // vùng (vd sâu 900 = 5 hàng 180 khít) — mỗi hàng lát kín 1 hướng → không lỗ trong
          const da = lg0.l, db = lg0.w
          const depth = zx1 - zx0
          let bestMix = { nA: 0, nB: 0, rem: depth }
          for (let nA = 0; nA * da <= depth + 1e-9; nA++) {
            const nB = Math.max(0, Math.floor((depth - nA * da) / db))
            const rem = depth - nA * da - nB * db
            if (rem < bestMix.rem - 1e-9) bestMix = { nA, nB, rem }
          }
          const rowDepths: number[] = []
          for (let r = 0; r < bestMix.nA; r++) rowDepths.push(da)
          for (let r = 0; r < bestMix.nB; r++) rowDepths.push(db)
          let placedAny = false
          let rx = zx0
          tileRows: for (const d of rowDepths) {
            const wd = d === da ? db : da            // bề rộng ô = chiều còn lại
            for (let cy = zy0; cy + wd <= zy1 + 1e-9; cy += wd) {
              while (li < doLights.length && avail(doLights[li]) <= 0) li++
              if (li >= doLights.length) break tileRows
              const gi = doLights[li]
              const g = groupsIn[gi]
              const fitCell = (g.l <= d && g.w <= wd) ? { fl: g.l, fw: g.w }
                : (g.w <= d && g.l <= wd) ? { fl: g.w, fw: g.l } : null
              if (!fitCell) { li++; continue }       // mã nhẹ khác cỡ không vừa ô → chờ PHA 3
              const cap2 = Math.max(0, Math.min(Math.floor((T - platMm) / g.h), g.maxLayers ?? Infinity))
              if (cap2 <= 0) { li++; continue }
              if (!onPlatform(rx, cy, d, wd)) continue   // ô rơi phần khuyết (vùng chữ L)
              const layers = Math.min(cap2, avail(gi))
              step++
              for (let k = 0; k < layers; k++)
                placed.push({ x: rx, y: cy, z: platMm + k * g.h, l: fitCell.fl, w: fitCell.fw, h: g.h, group: gi, step })
              used[gi] += layers
              placedAny = true
              lightFront = Math.max(lightFront, rx + d)
            }
            rx += d
          }
          baseIdx = bIdx                             // nền đã tiêu tới đâu
          if (!placedAny) break                      // không lát được ô nào → PHA 3
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
        pourClass(members, `${dk}|${ck}`, `${dk}|${ck}` === finalRow)
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
