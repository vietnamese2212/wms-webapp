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
// 7. XOAY THEO LÀN (user 14/07): mục đích xoay ngang/dọc = TẬN DỤNG MẶT SÀN — 2 bên
//    thành xe không được để trống (hàng đổ). Mỗi khối chia bề rộng xe thành các LÀN
//    chạy dọc chiều dài (trộn nA làn dọc + nB làn ngang PHỦ SÁT bề rộng nhất); mỗi làn
//    (dãy tính từ trong ra ngoài) giữ NGUYÊN hướng tới khi hết khối — không "cái dọc
//    cái ngang" trong 1 dãy.
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
    // VÙNG HƯỚNG của khối hiện tại: bề rộng xe chia tối đa 2 vùng — vùng hướng ưu tiên
    // + vùng hướng xoay (sát thành phải, khi trộn phủ bề rộng sát hơn đáng kể). Trong
    // vùng, cột đặt NÉP SKYLINE (adaptive) → các làn dọc hình thành đều thuần 1 hướng,
    // giao khối trước lởm chởm vẫn lấp kín (không hố).
    type Zone = { yA: number; yB: number; swap: boolean }   // swap=false: fl=l·fw=w
    let zones: Zone[] = []
    // Dây chuyền BẬC THANG TOÀN XE: mức trần (mm) khối kế tiếp được phép bắt đầu
    const chain = { capMm: truck.height }

    // Hướng xoay cho khối: nhiều chân / mm chiều sâu nhất (tie → nông hơn)
    const orientFor = (g: LoadGroup) => {
      const opts = g.l === g.w ? [{ fl: g.l, fw: g.w }] : [{ fl: g.l, fw: g.w }, { fl: g.w, fw: g.l }]
      return opts.filter(o => o.fw <= truck.width && o.fl <= truck.length).sort((a, b) =>
        (Math.floor(truck.width / b.fw) / b.fl) - (Math.floor(truck.width / a.fw) / a.fl) || (a.fl - b.fl))[0] ?? null
    }

    // Chia VÙNG cho khối: trộn nP cột hướng ưu tiên + nA cột hướng kia PHỦ SÁT bề rộng
    // xe nhất (2 bên thành không trống → hàng đổ). CHỈ trộn khi hơn bản thuần ĐÁNG KỂ
    // (≥ 1/4 bề thùng — hở nhỏ hơn thì hàng không nghiêng đổ được, giữ nếp thuần đẹp).
    // Vùng xoay đặt SÁT THÀNH PHẢI, biên = nA × bề cột xoay.
    const zoneMixFor = (g: LoadGroup): Zone[] => {
      const pref = orientFor(g)
      if (!pref) return []
      const prefSwap = pref.fl !== g.l
      const wP = pref.fw
      const altOk = g.l !== g.w && pref.fl <= truck.width && pref.fw <= truck.length
      const wA = pref.fl   // bề rộng cột hướng kia
      const nPure = Math.floor(truck.width / wP)
      let best = { nP: nPure, nA: 0 }
      if (altOk) {
        let bestCov = nPure * wP
        for (let nP = nPure; nP >= 0; nP--) {
          const nA = Math.floor((truck.width - nP * wP) / wA)
          const cov = nP * wP + nA * wA
          if (cov > bestCov + 1e-9) { bestCov = cov; best = { nP, nA } }
        }
        if (best.nA > 0 && bestCov - nPure * wP < Math.min(g.l, g.w) * 0.25) best = { nP: nPure, nA: 0 }
      }
      if (best.nA === 0) return [{ yA: 0, yB: truck.width, swap: prefSwap }]
      // Biên vùng theo LƯỚI CỘT (khít nhau), phần dư bề rộng dồn hết ra SÁT THÀNH PHẢI
      const split = best.nP * wP
      return [
        { yA: 0, yB: split, swap: prefSwap },
        { yA: split, yB: split + best.nA * wA, swap: !prefSwap },
      ]
    }
    const zoneDims = (g: LoadGroup, z: Zone) => z.swap ? { fl: g.w, fw: g.l } : { fl: g.l, fw: g.w }
    // skyFind trong 1 vùng y — cột đặt theo LƯỚI CỐ ĐỊNH của vùng (yA + k·fw, KHÔNG nép
    // segment thừa kế từ khối trước — lệch mốc sẽ kẹt dải hở dọc biên vùng); trong lưới
    // chọn mặt tiền THẤP nhất (tie → y nhỏ)
    const skyFindZone = (fw: number, fl: number, yA: number, yB: number): { x: number; y: number } | null => {
      let best: { x: number; y: number } | null = null
      for (let y = yA; y + fw <= yB + 1e-9; y += fw) {
        const x = skyMaxX(y, y + fw)
        if (x + fl > truck.length + 1e-9) continue
        if (!best || x < best.x - 1e-9) best = { x, y }
      }
      return best
    }

    // Đặt 1 chân MỚI của class: mỗi VÙNG tìm chỗ nép skyline, lấy vùng có mặt tiền x
    // NHỎ nhất (lấp sát vào trong; tie → vùng ưu tiên); take = số lớp đổ vào (≤ std)
    const newColumn = (g: LoadGroup, gi: number, take: number, std: number): boolean => {
      if (!zones.length) zones = zoneMixFor(g)
      let pick: { fl: number; fw: number } | null = null
      let spot: { x: number; y: number } | null = null
      for (const z of zones) {
        const d = zoneDims(g, z)
        const s = skyFindZone(d.fw, d.fl, z.yA, z.yB)
        if (s && (!spot || s.x < spot.x - 1e-9)) { pick = d; spot = s }
      }
      if (!pick || !spot) return false
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
    // m hiệu dụng của khối thứ idx: m^w, w = (idx+1)/K — CẢ ĐOÀN hạ dần đều (khối đầu
    // hạ nhẹ nhất, khối cuối hạ sâu nhất; user 14/07: "sắp xếp phải cân đối, không thể
    // đầu xe cao chót vót đuôi xe thấp lè tè"). Xe chật → m≈1 → mọi khối vẫn cao kịch.
    const mEffOf = (rowKey: string): number => {
      const idx = floorRows.indexOf(rowKey)
      const K = floorRows.length
      const w = idx < 0 ? 1 : (idx + 1) / K
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
      // BẬC THANG THOẢI (user 14/07: "hạ độ cao phải hạ DẦN, không rơi vực — đổ hàng"):
      // từ khối thứ 2, mức thân không thấp hơn mức khối trước quá 1 bậc an toàn
      if (floorRows.indexOf(rowKey) > 0) {
        const drop = Math.max(2 * maxH, truck.height * 0.25)
        const Lmin = Math.min(cap, Math.max(1, Math.ceil((chain.capMm - drop) / maxH)))
        if (L < Lmin) L = Lmin
      }
      // Có hàng thừa mà trần không còn chỗ nổi (khối kịch trần) → hạ khối 1 lớp để thừa
      // lên được TRÊN KHỐI (quy trình: không đứng chân ngắn dưới sàn)
      const C = live.reduce((s, gi) => s + avail(gi), 0)
      if (C % L !== 0 && (L + 1) * maxH > truck.height) L = Math.max(1, L - 1)
      st.openCol = null; classCols = []; zones = []
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
            // số chân 1 lượt ngang = tổng số cột các vùng chứa được
            const cl = Math.max(1, zones.reduce((s, z) => {
              const d = zoneDims(g, z)
              return s + Math.floor((z.yB - z.yA) / d.fw)
            }, 0) || Math.floor(truck.width / Math.min(g.l, g.w)))
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

      // PHA 1 — HÀNG GỬI (ghép phía trên) xếp TRƯỚC TIÊN, sâu nhất, trên THỀM NỀN PHẲNG.
      // LUẬT NGƯỜI XẾP HÀNG (user 14/07): đỉnh hàng gửi phải NGANG BẰNG hàng phía sau
      // (thiếu thì NÂNG NỀN lên, không được lõm thấp hơn các hàng ngoài); hàng gửi được
      // XOAY TỰ DO từng ô để lát kín mặt thềm (chỉ hàng gửi được bỏ luật 1 hàng 1 hướng).
      if (doLights.length && doFloor.length) {
        const bg0 = groupsIn[doFloor[0]]
        const full0 = Math.max(1, Math.floor(truck.height / bg0.h))
        // MỨC MẶT BẰNG CHUNG = đỉnh khối nền THẬT sẽ đứng ngay sau thềm (ăn theo hệ số
        // trải m — hàng ít khối nền hạ thấp thì hàng gửi hạ theo, không thành tháp) —
        // nền + hàng gửi phải CHẠM mức này (ngang bằng hàng phía sau, không lõm)
        const m0 = mEffOf(`${dk}|${classKeyOf(bg0)}`)
        const topT = Math.min(truck.height, Math.max(bg0.h, Math.ceil(full0 / m0) * bg0.h))
        // Hướng HÀNG nhẹ chủ đạo: phủ bề rộng SÁT nhất; tie → sâu nhỏ
        const bestRowOpt = (g: LoadGroup) =>
          (g.l === g.w ? [{ d: g.l, wd: g.w }] : [{ d: g.l, wd: g.w }, { d: g.w, wd: g.l }])
            .filter(o => o.wd <= truck.width)
            .sort((a, b) =>
              (Math.floor(truck.width / b.wd) * b.wd) - (Math.floor(truck.width / a.wd) * a.wd) || (a.d - b.d))[0] ?? null
        let li = 0                                   // mã nhẹ đang lát (lần lượt, liền mạch)
        let baseIdx = 0                              // mã nền đang dùng
        const lightRemain = () => doLights.reduce((s, gi) => s + avail(gi), 0)
        const platAll: { x: number; y: number; fl: number; fw: number }[] = []
        const laid: { x: number; y: number; fl: number; fw: number }[] = []   // ô nhẹ đã lát
        let lightFront = -1
        while (lightRemain() > 0) {
          while (baseIdx < doFloor.length && avail(doFloor[baseIdx]) <= 0) baseIdx++
          if (baseIdx >= doFloor.length) break       // hết hàng nền → phần nhẹ còn lại đi PHA 3
          const bi0 = doFloor[baseIdx]
          const bg = groupsIn[bi0]
          if (bg.h > truck.height || Math.min(bg.l, bg.w) > truck.width) { baseIdx++; continue }
          while (li < doLights.length && avail(doLights[li]) <= 0) li++
          if (li >= doLights.length) break
          const lgd = groupsIn[doLights[li]]         // mã nhẹ chủ đạo
          const optd = bestRowOpt(lgd)
          if (!optd) break
          // Chọn (lớp nền, lớp gửi) sao cho NỀN + GỬI chạm mức chung topT; nền CAO nhất
          // có thể mà lượng nền còn lại vẫn đủ đổ (không thì hạ nền → gửi dày lên)
          const availBase = doFloor
            .filter(x => classKeyOf(groupsIn[x]) === classKeyOf(bg))
            .reduce((s, x) => s + avail(x), 0)
          const cellArea = lgd.l * lgd.w, colArea = bg.l * bg.w
          const N = lightRemain()
          let platLayers = 0, Lf = 0
          const plMax = Math.min(
            Math.floor((topT - lgd.h) / bg.h),
            Math.floor(truck.height / bg.h),
            bg.maxLayers ?? Infinity,
          )
          for (let pl = plMax; pl >= 1; pl--) {
            const L = Math.min(Math.floor((topT - pl * bg.h) / lgd.h), lgd.maxLayers ?? Infinity)
            if (L < 1) continue
            platLayers = pl; Lf = L
            const colsNeed = Math.ceil(Math.ceil(N / L) * cellArea / colArea)
            if (colsNeed * pl <= availBase * 0.8) break   // đủ nền → chốt
          }
          if (platLayers < 1) break                  // không dựng được thềm chạm mức → PHA 3
          const platMm = platLayers * bg.h
          const bZones = zoneMixFor(bg)   // nền thềm cũng chia vùng phủ kín bề rộng
          if (!bZones.length) break
          // TILE-DRIVEN: đi TỪNG HÀNG NHẸ (sâu d theo x) — nền các làn đổ ĐUỔI THEO phủ
          // đủ [rx, rx+d] rồi mới lát hàng → vùng nhẹ liền mạch, không lỗ răng cưa do
          // làn nông/sâu lệch mặt tiền, không cần ước lượng diện tích trước
          let bIdx = baseIdx
          let baseOut = false                        // hết hàng nền cùng class giữa chừng
          // Đổ nền (nép skyline theo vùng) tới khi TOÀN mặt thềm phủ tới target
          const coverTo = (target: number): void => {
            for (;;) {
              let pick: { fl: number; fw: number } | null = null
              let spot: { x: number; y: number } | null = null
              for (const z of bZones) {
                const d = zoneDims(bg, z)
                const s = skyFindZone(d.fw, d.fl, z.yA, z.yB)
                if (s && s.x < target - 1e-9 && (!spot || s.x < spot.x - 1e-9)) { pick = d; spot = s }
              }
              if (!pick || !spot) return              // mọi chỗ đều đã phủ tới target (hoặc hết dài)
              while (bIdx < doFloor.length && (
                avail(doFloor[bIdx]) < platLayers ||
                classKeyOf(groupsIn[doFloor[bIdx]]) !== classKeyOf(bg) ||
                (groupsIn[doFloor[bIdx]].maxLayers ?? Infinity) < platLayers   // mã trần thấp không làm nền cao được
              )) bIdx++
              if (bIdx >= doFloor.length) { baseOut = true; return }   // hết nền cùng class
              const bi = doFloor[bIdx]
              step++
              for (let k = 0; k < platLayers; k++)
                placed.push({ x: spot.x, y: spot.y, z: k * bg.h, l: pick.fl, w: pick.fw, h: bg.h, group: bi, step })
              used[bi] += platLayers
              skyCommit(spot.y, pick.fw, spot.x + pick.fl)
              platAll.push({ x: spot.x, y: spot.y, fl: pick.fl, fw: pick.fw })
            }
          }
          // ô phải nằm TRỌN trên nền thật (tính GỘP mọi cột nền của thềm)
          const onPlatform = (x: number, y: number, fl: number, fw: number): boolean => {
            let cov = 0
            for (const c of platAll) {
              const ix = Math.max(0, Math.min(x + fl, c.x + c.fl) - Math.max(x, c.x))
              const iy = Math.max(0, Math.min(y + fw, c.y + c.fw) - Math.max(y, c.y))
              cov += ix * iy
            }
            return cov >= fl * fw - 1
          }
          // KHỚP LỚP TRÊN VỚI LỚP DƯỚI: lớp gửi DÙNG HẾT diện tích mặt thềm, mỗi ô chồng
          // TỚI MỨC CHUNG topT (không lõm), ô lẻ được XOAY TỰ DO vá kín
          const cellsPerRow = Math.max(1, Math.floor(truck.width / optd.wd))
          const rowsNeed = Math.max(1, Math.ceil(Math.ceil(N / Lf) / cellsPerRow))
          const rx0 = Math.max(0, lightFront)
          // 1) đổ thềm TRỌN cho lượng nhẹ còn lại
          coverTo(rx0 + rowsNeed * optd.d)
          const P = platAll.reduce((s, c) => Math.max(s, c.x + c.fl), 0)
          if (P <= rx0 + 1e-9) break                 // không đổ được nền → PHA 3
          // 2) chia VÙNG lưới nhẹ theo BỀ RỘNG THỀM THẬT (không phải bề rộng xe — nền
          //    hụt hơn xe thì ô cuối rớt khỏi nền → dải sát thành trống): vùng ô chính
          //    + vùng ô XOAY sát mép thềm phủ sát nhất (lớp trên khớp lớp dưới)
          const Py = platAll.reduce((s, c) => Math.max(s, c.y + c.fw), 0)
          const wdP = optd.wd, wdA = optd.d          // bề ô chính / bề ô xoay
          const nPureL = Math.floor(Py / wdP)
          let lmx = { nP: nPureL, nA: 0 }
          if (wdA !== wdP) {
            let cov = nPureL * wdP
            for (let nP = nPureL; nP >= 0; nP--) {
              const nA = Math.floor((Py - nP * wdP) / wdA)
              const c2 = nP * wdP + nA * wdA
              if (c2 > cov + 1e-9) { cov = c2; lmx = { nP, nA } }
            }
            if (lmx.nA > 0 && cov - nPureL * wdP < Math.min(lgd.l, lgd.w) * 0.25) lmx = { nP: nPureL, nA: 0 }
          }
          const lzones = [
            { yA: 0, yB: lmx.nP * wdP, wd: wdP, dz: optd.d },
            ...(lmx.nA > 0 ? [{ yA: lmx.nP * wdP, yB: lmx.nP * wdP + lmx.nA * wdA, wd: wdA, dz: optd.wd }] : []),
          ]
          // 3) gom Ô dùng được trên toàn mặt thềm — mỗi vùng lát hàng theo nhịp sâu riêng
          //    tới P; thứ tự TRONG → ngoài (rx tăng) để phần dư +1 dồn phía trong
          const cells: { rx: number; cy: number; d: number; wd: number }[] = []
          for (const z of lzones) {
            for (let rx = rx0; rx + z.dz <= P + 1e-9; rx += z.dz)
              for (let cy = z.yA; cy + z.wd <= z.yB + 1e-9; cy += z.wd)
                if (onPlatform(rx, cy, z.dz, z.wd)) cells.push({ rx, cy, d: z.dz, wd: z.wd })
          }
          cells.sort((a, b) => a.rx - b.rx || a.cy - b.cy)
          // 4) lát: mỗi ô chồng TỚI MỨC CHUNG topT (ngang bằng hàng phía sau — không lõm)
          const overlapLaid = (x: number, y: number, fl: number, fw: number) =>
            laid.some(c => x + 1e-9 < c.x + c.fl && c.x + 1e-9 < x + fl && y + 1e-9 < c.y + c.fw && c.y + 1e-9 < y + fw)
          const layCell = (rx: number, cy: number, d: number, wd: number): boolean => {
            if (overlapLaid(rx, cy, d, wd)) return false
            let z = platMm
            let putAny = false
            for (;;) {
              while (li < doLights.length && avail(doLights[li]) <= 0) li++
              if (li >= doLights.length) break
              const gi = doLights[li]
              const g = groupsIn[gi]
              const fit = (g.l <= d && g.w <= wd) ? { fl: g.l, fw: g.w }
                : (g.w <= d && g.l <= wd) ? { fl: g.w, fw: g.l } : null
              if (!fit) break                        // mã kế khác cỡ không vừa ô → sang ô sau
              const gCap = Math.min(avail(gi),
                Math.max(0, Math.floor((topT - z) / g.h)),
                g.maxLayers ?? Infinity)
              if (gCap <= 0) break
              step++
              for (let k = 0; k < gCap; k++)
                placed.push({ x: rx, y: cy, z: z + k * g.h, l: fit.fl, w: fit.fw, h: g.h, group: gi, step })
              used[gi] += gCap
              z += gCap * g.h
              putAny = true
            }
            if (putAny) {
              laid.push({ x: rx, y: cy, fl: d, fw: wd })
              lightFront = Math.max(lightFront, rx + d)
            }
            return putAny
          }
          let placedAny = false
          for (const cell of cells) {
            if (lightRemain() <= 0) break
            if (layCell(cell.rx, cell.cy, cell.d, cell.wd)) placedAny = true
          }
          // 5) PASS VÁ — hàng gửi XOAY TỰ DO từng ô (user: chỉ hàng gửi không cần luật
          // 1 hàng 1 hướng): chèn ô xoay vào mảnh thềm còn lộ tới khi không thêm được
          let patching = lightRemain() > 0
          while (patching) {
            patching = false
            while (li < doLights.length && avail(doLights[li]) <= 0) li++
            if (li >= doLights.length) break
            const g = groupsIn[doLights[li]]
            const orients = g.l === g.w ? [{ d: g.l, wd: g.w }] : [{ d: g.l, wd: g.w }, { d: g.w, wd: g.l }]
            const anchors: { x: number; y: number }[] = []
            for (const c of laid) anchors.push({ x: c.x + c.fl, y: c.y }, { x: c.x, y: c.y + c.fw })
            for (const c of platAll) if (c.x + 1e-9 >= rx0) anchors.push({ x: c.x, y: c.y })
            patch: for (const a of anchors) {
              for (const o of orients) {
                if (!onPlatform(a.x, a.y, o.d, o.wd)) continue
                if (layCell(a.x, a.y, o.d, o.wd)) { placedAny = true; patching = lightRemain() > 0; break patch }
              }
            }
          }
          baseIdx = bIdx                             // nền đã tiêu tới đâu
          // Nền cạn / không lát được → nhẹ còn lại đi PHA 3 (KHÔNG mở thềm mức khác — tránh lỗ)
          if (baseOut || !placedAny) break
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
  // (không tràn nóc), rồi ÍT HỐ KÍN trên sàn nhất; tie-break maxX lớn hơn.
  // Sau lưới thô, nhị phân tinh chỉnh giữa nấc tốt nhất và nấc kế.
  const maxXOf = (placed: PlacedBox[]) => placed.length ? Math.max(...placed.map(b => b.x + b.l)) : 0
  // Đếm HỐ KÍN trên sàn: chân có khoảng trống ngang-y sau lưng BỊ hàng chặn phía đuôi
  // (khe mở thông ra đuôi xe = hợp lệ — "hở đẩy ra ngoài")
  const closedHoles = (placed: PlacedBox[]): number => {
    const floor = placed.filter(b => b.z === 0)
    let n = 0
    for (const b of floor) {
      if (b.y <= 1e-9) continue
      let nearest = b.y
      for (const o of floor) {
        if (o === b) continue
        const x0 = Math.max(o.x, b.x), x1 = Math.min(o.x + o.l, b.x + b.l)
        if (x1 <= x0) continue
        const oEnd = o.y + o.w
        if (oEnd <= b.y) nearest = Math.min(nearest, b.y - oEnd)
      }
      if (nearest > 1 && nearest < b.y) {
        const gy0 = b.y - nearest
        if (floor.some(o => o !== b && o.x >= b.x + b.l - 1e-9 &&
          Math.min(o.y + o.w, b.y) - Math.max(o.y, gy0) > 1)) n++
      }
    }
    return n
  }
  type PackResult = ReturnType<typeof pack>
  // Quá tải cũng phải chọn phương án TỐT NHẤT (không bỏ qua tối ưu): xếp ĐƯỢC nhiều
  // nhất → sạch (không tràn nóc) → ĐIỂM = maxX − 500mm/hố kín (đánh đổi: 1 hố nhỏ đổi
  // được ≥0.5m chiều dài thì trải; maxX xấp xỉ nhau thì phương án ít hố thắng)
  const leftCnt = (p: PackResult) => p.leftover.reduce((s, x) => s + x.count, 0)
  const score = (p: PackResult) => maxXOf(p.placed) - closedHoles(p.placed) * 500
  const better = (r: PackResult, cur: PackResult): boolean => {
    const rl = leftCnt(r), cl = leftCnt(cur)
    if (rl !== cl) return rl < cl
    if (rl === 0) {
      const rClean = r.spilled === 0, cClean = cur.spilled === 0
      if (rClean !== cClean) return rClean
    }
    return score(r) >= score(cur)
  }
  const M_GRID = [1, 1.06, 1.13, 1.22, 1.33, 1.5, 1.7, 2, 2.4, 3, 3.8, 5, 6.5, 8.5, 11, 14, 18, 25]
  let best = pack(1)
  let bestIdx = 0
  for (let i = 1; i < M_GRID.length; i++) {
    const r = pack(M_GRID[i])
    if (better(r, best)) { best = r; bestIdx = i }
  }
  {
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
