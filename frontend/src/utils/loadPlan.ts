// Sơ đồ xếp xe 3D — thuật toán xếp thùng carton vào lòng thùng xe (chạy thuần FE).
// LUẬT XẾP — theo SOP "Quy trình kiểm soát xuất kho" NM Ba Vì (file "Quy trình đếm chân
// xe xá.xlsx" thư mục gốc, user đưa 14/07) + các chốt của user 12-14/07:
// 1. XẾP BẰNG MẶT: mỗi KHỐI hàng (loại kích thước) chỉ có MỘT CHIỀU CAO duy nhất —
//    "tuyệt đối không xếp 1 loại hàng có 2 chiều cao trở lên". HÀNG THỪA không đủ bằng
//    mặt → CHO HẾT LÊN TRÊN KHỐI (nổi trên nóc, dồn về PHÍA TRONG), KHÔNG đứng dưới sàn —
//    thủ kho đối chiếu: n chân × cao + thừa nổi (vd 1000 thùng cao 12 = 996 + 4 nổi).
// 1b. NHÓM LIỀN (SOP "lên hết loại hàng này rồi mới đến loại hàng khác"): mỗi loại = 1
//    mảng liền — cột mới ưu tiên CHẠM khối đang mở; hàng gửi lát LƯỚI LIỀN xuyên biên
//    vùng nền (không chừa rãnh giữa xe); gửi dư KHÔNG rải nóc lung tung — nổi tiếp lên
//    vùng gửi, còn nữa mới đứng thành 1 khối riêng liền mạch.
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
  // ĐẾ PALLET (26/08): khối này là pallet → phần đáy cao `h` vẽ MÀU RIÊNG đồng nhất để phân biệt
  // rõ với hàng phía trên (user chốt; màu khai per MÃ pallet — tương lai có pallet dạng khác).
  base?: { h: number; color: string }
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
// Hàng gửi (stack_on_top) không khai max_stack_layers → mặc định 8 LỚP (user chốt 14/07:
// xếp đủ lớp tối đa, chỉ hạ khi xe quá rộng cần trải hết xe)
const LIGHT_MAX_DEFAULT = 8

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
  function pack(m: number, mLast = 1) {
    const placed: PlacedBox[] = []
    const leftover: { group: number; count: number }[] = []
    const cols: Col[] = []
    let spilled = 0   // số thùng tràn nóc DO SÀN HỤT (khác "hàng thừa nổi trên khối" — bình thường)
    let lightPatch = 0   // mảng nóc thềm LỘ đặt-vừa-thùng-gửi (phạt trong chọn phương án)
    let spanMiss = 0     // hàng gửi hụt phủ ngang (mm so 85% bề xe)
    let topMiss = 0      // đỉnh vùng gửi HỤT so mức thân khối tiếp giáp (mm — user 15/07: phải cao bằng)
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
    // Cột thềm KHÔNG có hàng gửi đè (thềm thừa) — khối sàn cùng class XÂY TIẾP lên cho
    // ngang mặt khối (user 14/07: "hết lớp trên thì xếp hàng khác vào, không ô trống")
    const pendingStubs: { x: number; y: number; fl: number; fw: number; top: number; ck: string; doKey: string }[] = []
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
    // Ưu tiên spot CHẠM khối đang mở (SOP nhóm liền — không mọc cột lẻ cách xa khi
    // skyline đuôi lởm chởm); cùng mức chạm → mặt tiền x nhỏ nhất (tie → y nhỏ)
    const touchesClass = (x: number, y: number, fl: number, fw: number) =>
      classCols.some(c => x < c.x + c.fl + 2 && c.x < x + fl + 2 && y < c.y + c.fw + 2 && c.y < y + fw + 2)
    const skyFindZone = (fw: number, fl: number, yA: number, yB: number): { x: number; y: number; t: boolean } | null => {
      let best: { x: number; y: number; t: boolean } | null = null
      for (let y = yA; y + fw <= yB + 1e-9; y += fw) {
        const x = skyMaxX(y, y + fw)
        if (x + fl > truck.length + 1e-9) continue
        const t = classCols.length > 0 && touchesClass(x, y, fl, fw)
        if (!best || (t && !best.t) || (t === best.t && x < best.x - 1e-9)) best = { x, y, t }
      }
      return best
    }

    // Đặt 1 chân MỚI của class: mỗi VÙNG tìm chỗ nép skyline, lấy vùng có mặt tiền x
    // NHỎ nhất (lấp sát vào trong; tie → vùng ưu tiên); take = số lớp đổ vào (≤ std)
    const newColumn = (g: LoadGroup, gi: number, take: number, std: number): boolean => {
      if (!zones.length) zones = zoneMixFor(g)
      let pick: { fl: number; fw: number } | null = null
      let spot: { x: number; y: number; t: boolean } | null = null
      for (const z of zones) {
        const d = zoneDims(g, z)
        const s = skyFindZone(d.fw, d.fl, z.yA, z.yB)
        if (!s) continue
        if (!spot || (s.t && !spot.t) || (s.t === spot.t && s.x < spot.x - 1e-9)) { pick = d; spot = s }
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

    // Phần dư NỔI lên NÓC khối class — ĐẮP CHỖ TRŨNG trước (chân thấp nhất ăn trước),
    // bằng nhau → dồn LIỀN DẢI từ PHÍA TRONG (x,y nhỏ — không xen kẽ theo thứ tự đặt
    // cột thành ụ rải, user 15/07 đơn 130726_01: "rải quá nhiều"); TRẦN NỔI = mặt thân
    // khối + 1 LỚP (SOP 996+4 nổi — dư hơn nữa bỏ lại, không chất tầng lởm chởm).
    const spillOnRoof = (g: LoadGroup, gi: number, rem: number): number => {
      const body = classCols.length ? Math.max(...classCols.map(c => c.top)) : 0
      const capTop = Math.min(truck.height, body + g.h)
      while (rem > 0) {
        const cands = classCols
          .filter(oc => oc !== st.openCol?.col)
          .filter(oc => oc.top + g.h <= capTop + 1e-9)
          .filter(oc => {
            const cap = g.maxLayers ?? (g.onTop ? LIGHT_MAX_DEFAULT : Infinity)
            return cap === Infinity || Math.round(oc.top / g.h) < cap
          })
          .sort((a, b) => (a.top - b.top) ||
            ((b.groups.has(gi) ? 1 : 0) - (a.groups.has(gi) ? 1 : 0)) || (a.x - b.x) || (a.y - b.y))
        const oc = cands[0]
        if (!oc) break
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
    // m hiệu dụng của khối thứ idx: m^w, w = (idx+1)/K — CẢ ĐOÀN hạ dần đều (khối đầu
    // hạ nhẹ nhất, khối cuối hạ sâu nhất; user 14/07: "sắp xếp phải cân đối, không thể
    // đầu xe cao chót vót đuôi xe thấp lè tè"). Xe chật → m≈1 → mọi khối vẫn cao kịch.
    const mEffOf = (rowKey: string): number => {
      const idx = floorRows.indexOf(rowKey)
      const K = floorRows.length
      const w = idx < 0 ? 1 : (idx + 1) / K
      // mLast = nấc hạ RIÊNG khối cuối (user 15/07: "tất cả các lớp bám tới cuối xe" —
      // khối cuối hạ thêm để mép cuối CHẠM đuôi mà không kéo cả đoàn hạ theo)
      return Math.pow(m, w) * (idx === K - 1 ? mLast : 1)
    }

    // Đổ TOÀN BỘ 1 class (nhiều mã, liền mạch) thành KHỐI BẰNG MẶT — MỘT chiều cao L.
    // PHẦN THỪA cuối khối không đủ bằng mặt → NỔI LÊN TRÊN KHỐI, không đứng sàn.
    const pourClass = (members: number[], rowKey: string) => {
      const live = members.filter(gi => avail(gi) > 0)
      if (!live.length) return
      const maxH = Math.max(...live.map(gi => groupsIn[gi].h))
      const full = Math.max(1, Math.floor(truck.height / maxH))
      // Bám mức đuôi khối trước — ceil: chỉ DU DI +1 thùng khi lệch bước (chia hết thì
      // KHÔNG nhô thêm)
      const cap = Math.max(1, Math.min(full, Math.ceil(chain.capMm / maxH)))
      // sàn không hạ dưới 3 lớp (thảm 1-2 lớp kín sàn = phi thực tế — thợ dồn gọn)
      let L = Math.max(Math.min(cap, 3), Math.ceil(cap / mEffOf(rowKey)))
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
        const myCap = g.maxLayers ?? (g.onTop ? LIGHT_MAX_DEFAULT : Infinity)
        const isLastOfClass = mi === live.length - 1
        let remaining = avail(gi)
        while (remaining > 0) {
          // 0) Nhận CỘT THỀM THỪA cùng class làm chân dở — xây tiếp lên mức thân khối
          // (hết hàng gửi thì hàng khác vào, không để ô trống trên nóc thềm)
          if (!st.openCol) {
            const si = pendingStubs.findIndex(s => s.ck === classKeyOf(g) && s.doKey === g.doKey)
            if (si >= 0) {
              const s = pendingStubs.splice(si, 1)[0]
              const col: Col = { x: s.x, y: s.y, fl: s.fl, fw: s.fw, top: s.top, doKey: g.doKey, step, groups: new Set<number>() }
              cols.push(col); classCols.push(col)
              st.openCol = { col, used: Math.round(s.top / maxH), cap: L }
            }
          }
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
          // 2) HÀNG THỪA cuối khối (mã cuối, không đủ 1 chân bằng mặt) → NỔI LÊN TRÊN
          // KHỐI (SOP: "cho hết lên trên khối, KHÔNG xếp dưới sàn — khối 100% vuông vắn,
          // hàng thừa lên trên"; 1 loại hàng TUYỆT ĐỐI không 2 chiều cao thân)
          if (isLastOfClass && remaining < myL && classCols.length > 0) {
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

    for (const dk of doOrder) {
      const doFloor = orderFloor.filter(gi => groupsIn[gi].doKey === dk && groupsIn[gi].count > 0)
      const doLights = topOrder.filter(gi => groupsIn[gi].doKey === dk && groupsIn[gi].count > 0)
      // Vùng gửi của đơn này (ô đã lát + mức mặt bằng chung) — PHA 3 nổi tiếp lên đây
      const laid: { x: number; y: number; fl: number; fw: number; top: number; n: number }[] = []
      let topT = truck.height

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
        // L0 = đúng công thức pourClass sẽ chọn cho khối nền đầu (kể cả sàn min 3 lớp)
        // — đỉnh vùng gửi phải CAO BẰNG mức thân khối tiếp giáp (user 15/07)
        const L0 = Math.min(full0, Math.max(Math.min(full0, 3), Math.ceil(full0 / m0)))
        topT = Math.min(truck.height, Math.max(bg0.h, L0 * bg0.h))
        // Hướng HÀNG nhẹ chủ đạo: phủ bề rộng SÁT nhất; tie → sâu nhỏ
        const bestRowOpt = (g: LoadGroup) =>
          (g.l === g.w ? [{ d: g.l, wd: g.w }] : [{ d: g.l, wd: g.w }, { d: g.w, wd: g.l }])
            .filter(o => o.wd <= truck.width)
            .sort((a, b) =>
              (Math.floor(truck.width / b.wd) * b.wd) - (Math.floor(truck.width / a.wd) * a.wd) || (a.d - b.d))[0] ?? null
        let li = 0                                   // mã nhẹ đang lát (lần lượt, liền mạch)
        let baseIdx = 0                              // mã nền đang dùng
        const lightRemain = () => doLights.reduce((s, gi) => s + avail(gi), 0)
        const platAll: { x: number; y: number; fl: number; fw: number; top: number; ck: string }[] = []
        let lightFront = -1
        let firstPlatMm = -1                         // thềm CHỈ MỘT MỨC (đa mức = lởm chởm)
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
          // GỬI ĐỦ LỚP TỐI ĐA trước (khai max_stack_layers hoặc mặc định 8), NỀN bù bên
          // dưới cho sát mức chung topT; xe quá rộng → topT hạ theo m → lớp gửi tự giảm
          const availBase = doFloor
            .filter(x => classKeyOf(groupsIn[x]) === classKeyOf(bg))
            .reduce((s, x) => s + avail(x), 0)
          const cellArea = lgd.l * lgd.w, colArea = bg.l * bg.w
          const N = lightRemain()
          let Lf = Math.min(lgd.maxLayers ?? LIGHT_MAX_DEFAULT, Math.floor((topT - bg.h) / lgd.h))
          if (Lf < 1) break                          // không còn chỗ cho gửi → PHA 3
          // ĐI HẾT CHIỀU NGANG (user 14/07: "không khối nào nằm 1 góc — dùng tối đa
          // chiều ngang"): hàng gửi ít → hạ lớp để phủ đủ bề ngang ít nhất 1 hàng
          const cellsRowEst = Math.max(1, Math.floor(truck.width / optd.wd))
          Lf = Math.max(1, Math.min(Lf, Math.ceil(N / cellsRowEst)))
          // Chọn cặp (lớp nền, lớp gửi) SÁT topT NHẤT — ƯU TIÊN KHÔNG HỤT (user 15/07:
          // "xếp xong tím phải CAO BẰNG lớp tiếp giáp"; floor thuần từng hụt 80-480mm
          // do bội nền/gửi lệch — vượt nhẹ < 1 thùng nền tốt hơn lõm)
          let platLayers = 1
          if (firstPlatMm >= 0) {
            // Thềm ĐÃ MỞ (mã gửi trước) → mã gửi CỠ KHÁC lát TIẾP trên CÙNG mức thềm
            // (user 23/07: hàng gửi liền vùng, chạy hết ngang — trước đây tính lại mức
            // thềm cho mã mới → lệch firstPlatMm → break → CẢ MÃ rơi PHA 3 thành khối
            // đứng SÀN ở đuôi, tách rời vùng gửi, trái luật "hàng gửi đè lên chân")
            const plCap = Math.min(Math.floor(truck.height / bg.h), bg.maxLayers ?? Infinity)
            if (firstPlatMm % bg.h !== 0 || firstPlatMm / bg.h > plCap) break   // nền class khác không khớp mức thềm
            platLayers = firstPlatMm / bg.h
            if (topT - firstPlatMm < lgd.h - 1e-9) break                        // hết head-room cho mã gửi này
            Lf = Math.min(Lf, Math.max(1, Math.floor((topT - firstPlatMm) / lgd.h)))
          } else {
            const plCap = Math.min(Math.floor(truck.height / bg.h), bg.maxLayers ?? Infinity)
            const Lf0 = Lf
            let bestSc = Infinity
            for (let lf = Lf0; lf >= Math.max(1, Lf0 - 3); lf--) {
              for (const pl of [Math.ceil((topT - lf * lgd.h) / bg.h), Math.floor((topT - lf * lgd.h) / bg.h)]) {
                if (pl < 1 || pl > plCap) continue
                if (pl * bg.h + lf * lgd.h > truck.height + 1e-9) continue
                const delta = pl * bg.h + lf * lgd.h - topT
                const sc = (delta < 0 ? 100000 : 0) + Math.abs(delta) * 10 + (Lf0 - lf)
                if (sc < bestSc - 1e-9) { bestSc = sc; platLayers = pl; Lf = lf }
              }
            }
          }
          // nền còn lại không đủ đổ → hạ bớt nền (đỉnh lõm nhẹ, vẫn giữ đủ lớp gửi) —
          // CHỈ khi đang mở thềm mới (thềm đã neo mức thì giữ nguyên, không phá anchor)
          const colsNeed = Math.ceil(Math.ceil(N / Lf) * cellArea / colArea)
          while (firstPlatMm < 0 && platLayers > 1 && colsNeed * platLayers > availBase * 0.8) platLayers--
          const platMm = platLayers * bg.h
          if (firstPlatMm < 0) firstPlatMm = platMm
          else if (platMm !== firstPlatMm) break     // KHÔNG mở thềm mức khác
          const bZones = zoneMixFor(bg)   // nền thềm cũng chia vùng phủ kín bề rộng
          if (!bZones.length) break
          // TILE-DRIVEN: đi TỪNG HÀNG NHẸ (sâu d theo x) — nền các làn đổ ĐUỔI THEO phủ
          // đủ [rx, rx+d] rồi mới lát hàng → vùng nhẹ liền mạch, không lỗ răng cưa do
          // làn nông/sâu lệch mặt tiền, không cần ước lượng diện tích trước
          let bIdx = baseIdx
          let baseOut = false                        // hết hàng nền cùng class giữa chừng
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
          // NỀN CHỈ MỌC DƯỚI ĐÚNG Ô CẦN (user 14/07: "không bốc xếp nào để hàng trơ
          // trọi" — thềm đổ dư sẽ thành mảng nền trống cạnh khối gửi): trước khi lát 1 ô,
          // đổ đủ cột nền CHẠM vùng ô đó; thềm ôm sát khối gửi, dư chỉ phần rìa bội cột
          const ensureCell = (rx: number, cy: number, d: number, wd: number): boolean => {
            let guard = 0
            while (!onPlatform(rx, cy, d, wd)) {
              if (guard++ > 60) return false
              // đặt 1 cột nền GIAO ô theo bề rộng, tại dải còn nông nhất
              let pick: { fl: number; fw: number } | null = null
              let spot: { x: number; y: number } | null = null
              for (const z of bZones) {
                const dd = zoneDims(bg, z)
                for (let y = z.yA; y + dd.fw <= z.yB + 1e-9; y += dd.fw) {
                  if (y + dd.fw <= cy + 1e-9 || y >= cy + wd - 1e-9) continue   // không giao ô
                  const fx = skyMaxX(y, y + dd.fw)
                  if (fx + dd.fl > truck.length + 1e-9) continue
                  if (fx >= rx + d - 1e-9) continue   // dải này đã phủ đủ sâu cho ô
                  if (!spot || fx < spot.x - 1e-9) { pick = dd; spot = { x: fx, y } }
                }
              }
              if (!pick || !spot) return false        // không phủ nổi ô (hết sàn/vướng)
              while (bIdx < doFloor.length && (
                avail(doFloor[bIdx]) < platLayers ||
                classKeyOf(groupsIn[doFloor[bIdx]]) !== classKeyOf(bg) ||
                (groupsIn[doFloor[bIdx]].maxLayers ?? Infinity) < platLayers   // mã trần thấp không làm nền cao được
              )) bIdx++
              if (bIdx >= doFloor.length) { baseOut = true; return false }   // hết nền cùng class
              const bi = doFloor[bIdx]
              step++
              for (let k = 0; k < platLayers; k++)
                placed.push({ x: spot.x, y: spot.y, z: k * bg.h, l: pick.fl, w: pick.fw, h: bg.h, group: bi, step })
              used[bi] += platLayers
              skyCommit(spot.y, pick.fw, spot.x + pick.fl)
              platAll.push({ x: spot.x, y: spot.y, fl: pick.fl, fw: pick.fw, top: platMm, ck: classKeyOf(bg) })
            }
            return true
          }
          const rx0 = Math.max(0, lightFront)
          // Lưới ô hàng gửi: LƯỚI LIỀN TOÀN BỀ RỘNG XE (user: đi hết chiều ngang, không
          // dồn cục 1 góc) — mỗi HÀNG thuần 1 cỡ ô (bề ô = chiều còn lại của thùng theo
          // nhịp hàng); nhịp SÂU từng hàng chọn realtime KHỚP mặt cột nền (lớp trên ăn
          // khớp lớp đáy — hết hàng gửi là mặt cắt gọn, không khe hở ô trống)
          // 4) lát: mỗi ô chồng TỚI MỨC CHUNG topT (ngang bằng hàng phía sau — không lõm)
          const overlapLaid = (x: number, y: number, fl: number, fw: number) =>
            laid.some(c => x + 1e-9 < c.x + c.fl && c.x + 1e-9 < x + fl && y + 1e-9 < c.y + c.fw && c.y + 1e-9 < y + fw)
          const layCell = (rx: number, cy: number, d: number, wd: number, capL = Lf): boolean => {
            if (overlapLaid(rx, cy, d, wd)) return false
            let z = platMm
            let putAny = false
            let totalLayers = 0                        // tổng lớp trong Ô (cap — đều tăm tắp)
            const inCell = new Map<number, number>()   // số lớp từng mã đã chồng trong Ô
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
                (g.maxLayers ?? LIGHT_MAX_DEFAULT) - (inCell.get(gi) ?? 0),
                capL - totalLayers)
              if (gCap <= 0) break                   // mã đạt trần lớp trong ô
              step++
              for (let k = 0; k < gCap; k++)
                placed.push({ x: rx, y: cy, z: z + k * g.h, l: fit.fl, w: fit.fw, h: g.h, group: gi, step })
              used[gi] += gCap
              inCell.set(gi, (inCell.get(gi) ?? 0) + gCap)
              totalLayers += gCap
              z += gCap * g.h
              putAny = true
            }
            if (putAny) {
              laid.push({ x: rx, y: cy, fl: d, fw: wd, top: z, n: totalLayers })
              lightFront = Math.max(lightFront, rx + d)
            }
            return putAny
          }
          let placedAny = false
          {
            // SÓNG THEO VÙNG NỀN: mỗi vùng con trỏ hàng riêng — (1) phủ NGANG mọi vùng
            // 1 hàng trước (đi hết chiều ngang); (2) rồi mở hàng ở vùng RẺ nhất (thò
            // nền / ô ít nhất — lớp trên ăn khớp lớp đáy, nhịp nền vùng nào theo vùng đó)
            const zonesL = bZones.map(z => ({ yA: z.yA, yB: z.yB, flB: zoneDims(bg, z).fl, rx: rx0 }))
            let thinDone = false
            while (lightRemain() > 0 && !baseOut && !thinDone) {
              let bestZ: typeof zonesL[number] | null = null
              let bestCost = Infinity, bestD = 0
              for (const z of zonesL) {
                if (z.rx >= truck.length - 1e-9) continue
                const zf = skyMaxX(z.yA, z.yB)
                const overAt = (need: number) =>
                  zf >= need - 1e-9 ? 0 : Math.ceil((need - zf) / z.flB) * z.flB + zf - need
                for (const dd of [...new Set([lgd.l, lgd.w])]) {
                  if (z.rx + dd > truck.length + 1e-9) continue
                  const wd2 = dd === lgd.l ? lgd.w : lgd.l
                  const cellsZ = Math.floor((z.yB - z.yA) / wd2)
                  if (cellsZ < 1) continue
                  // NHÌN TRƯỚC 2 HÀNG: còn đủ hàng gửi thì tính thò nền theo CHUỖI 2 nhịp
                  // (vd [180,180]=360 khớp cột 400 chỉ thò 40 — greedy 250 sẽ ép thò 300)
                  const two = lightRemain() >= 2 * Lf * cellsZ
                  const ov = two
                    ? Math.min(...[...new Set([lgd.l, lgd.w])].map(d2 => overAt(z.rx + dd + d2)))
                    : overAt(z.rx + dd)
                  const cost = ov / cellsZ - dd * 0.001 - (z.rx <= rx0 + 1e-9 ? 1e6 : 0)
                  if (cost < bestCost - 1e-9) { bestCost = cost; bestZ = z; bestD = dd }
                }
              }
              if (!bestZ) break
              const d = bestD, wd = d === lgd.l ? lgd.w : lgd.l
              const cellsRow = Math.max(1, Math.floor((bestZ.yB - bestZ.yA) / wd))
              const rem = lightRemain()
              let baseL = Lf, extra = 0
              if (rem < Lf * cellsRow) {
                // hàng cuối: TRẢI MỎNG phủ đủ ngang; quá lẻ (<2 lớp/hàng) hoặc phải kéo
                // NHỊP NỀN MỚI (thò > 40% cột nền) → thôi, thùng lẻ nổi/PHA 3
                if (rem < 2 * cellsRow && laid.length > 0) break
                const zfx = skyMaxX(bestZ.yA, bestZ.yB)
                const needx = bestZ.rx + d
                const ovx = zfx >= needx - 1e-9 ? 0 : Math.ceil((needx - zfx) / bestZ.flB) * bestZ.flB + zfx - needx
                if (ovx > bestZ.flB * 0.4 && laid.length > 0) break
                baseL = Math.max(1, Math.floor(rem / cellsRow))
                extra = Math.max(0, rem - baseL * cellsRow)
                thinDone = true
              }
              let rowAny = false
              // LƯỚI LIỀN xuyên biên vùng nền (SOP nhóm liền — không chừa rãnh giữa xe):
              // vùng sau bắt lưới từ MÉP ô đã lát sát biên (ô được vắt qua biên vùng,
              // ensureCell tự đổ nền cả 2 vùng dưới ô)
              let yStart = bestZ.yA
              if (bestZ.yA > 1e-9) {
                const below = laid.filter(c => c.y < bestZ.yA - 1e-9 && c.y + c.fw > bestZ.yA - wd + 1e-9 && c.y + c.fw <= bestZ.yA + 1e-9)
                // chưa có ô bám → SNAP về lưới toàn-xe (bội wd từ 0) — biên vùng nền lẻ
                // bội sẽ tạo khe 10-60mm xé vùng gửi
                yStart = below.length ? Math.max(...below.map(c => c.y + c.fw)) : Math.floor(bestZ.yA / wd) * wd
              }
              for (let cy = yStart; cy + wd <= bestZ.yB + 1e-9; cy += wd) {
                if (lightRemain() <= 0) break
                const capL = baseL + (extra > 0 ? 1 : 0)
                let ok = ensureCell(bestZ.rx, cy, d, wd) && layCell(bestZ.rx, cy, d, wd, capL)
                // Ô kẹt → XOAY TẠI CHỖ (hàng gửi tự do hướng — miễn ăn khớp lớp đáy)
                if (!ok && !baseOut && d !== wd &&
                  ensureCell(bestZ.rx, cy, wd, d) && layCell(bestZ.rx, cy, wd, d, capL)) ok = true
                if (ok) { rowAny = true; placedAny = true; if (extra > 0) extra-- }
                if (baseOut) break
              }
              if (!rowAny) { bestZ.rx = truck.length; continue }   // vùng tắc → khóa vùng
              bestZ.rx += d
            }
          }
          // Thùng lẻ còn lại → NỔI trên ô gửi THẤP nhất (đắp trũng), không mở hàng mới
          for (;;) {
            if (lightRemain() <= 0) break
            while (li < doLights.length && avail(doLights[li]) <= 0) li++
            if (li >= doLights.length) break
            const gi = doLights[li]
            const g = groupsIn[gi]
            const cand = laid
              .filter(c => (g.l <= c.fl && g.w <= c.fw) || (g.w <= c.fl && g.l <= c.fw))
              .filter(c => c.top + g.h <= topT + 1e-9 && c.n < (g.maxLayers ?? LIGHT_MAX_DEFAULT))
              .sort((a, b) => a.top - b.top)[0]
            if (!cand) break
            const fit = (g.l <= cand.fl && g.w <= cand.fw) ? { fl: g.l, fw: g.w } : { fl: g.w, fw: g.l }
            step++
            placed.push({ x: cand.x, y: cand.y, z: cand.top, l: fit.fl, w: fit.fw, h: g.h, group: gi, step })
            used[gi] += 1
            cand.top += g.h
            cand.n += 1
            placedAny = true
          }
          // (KHÔNG gán baseIdx = bIdx — bIdx là con trỏ scan cục bộ, có thể đã trôi qua
          // mã CÒN HÀNG khác class → vòng sau sẽ dựng thềm mức khác. Vòng sau tự skip
          // mã cạn ở đầu vòng.)
          // Nền cạn / không lát được / còn quá lẻ (mở vòng nữa sẽ thành hàng 1-2 lớp
          // kéo nền) → nhẹ còn lại đi PHA 3
          if (baseOut || !placedAny || lightRemain() < 2 * cellsRowEst) break
        }
        // Có hàng gửi mà KHÔNG dựng được thềm (toàn bộ rơi PHA 3 rải nóc) → phạt nặng
        // để m-search né phương án này
        if (!laid.length && doLights.length) spanMiss += truck.width * 2
        // Cột thềm KHÔNG có hàng gửi đè → giao khối sàn cùng class XÂY TIẾP lên mức
        // thân khối (hết hàng gửi thì hàng khác vào — không ô trống trên nóc thềm)
        const stubbed = new Set<number>()
        for (let ci = 0; ci < platAll.length; ci++) {
          const c = platAll[ci]
          let cov = 0
          for (const l of laid) {
            const ix = Math.max(0, Math.min(c.x + c.fl, l.x + l.fl) - Math.max(c.x, l.x))
            const iy = Math.max(0, Math.min(c.y + c.fw, l.y + l.fw) - Math.max(c.y, l.y))
            cov += ix * iy
          }
          if (cov < 1) {   // tuyệt đối KHÔNG thùng gửi chạm cột (chờm mép cũng không xây được)
            pendingStubs.push({ x: c.x, y: c.y, fl: c.fl, fw: c.fw, top: c.top, ck: c.ck, doKey: dk })
            stubbed.add(ci)
          }
        }
        // CHẤT LƯỢNG vùng gửi (phạt trong chọn phương án): mảng nóc thềm lộ ĐẶT VỪA
        // thùng gửi (quét lát cắt 20mm) + hụt phủ ngang
        if (laid.length) {
          const span = Math.max(...laid.map(c => c.y + c.fw)) - Math.min(...laid.map(c => c.y))
          spanMiss += Math.max(0, truck.width * 0.85 - span)
          // đỉnh vùng gửi HỤT mức thân khối tiếp giáp (topT) → phạt (không được lõm)
          topMiss += Math.max(0, topT - Math.max(...laid.map(c => c.top)))
          const mnD = Math.min(...doLights.map(gi => Math.min(groupsIn[gi].l, groupsIn[gi].w)))
          const mxD = Math.min(...doLights.map(gi => Math.max(groupsIn[gi].l, groupsIn[gi].w)))
          for (let ci = 0; ci < platAll.length; ci++) {
            if (stubbed.has(ci)) continue
            const c = platAll[ci]
            let big = false
            for (const [minY, minX] of [[mnD, mxD], [mxD, mnD]]) {
              let run = 0
              for (let sx = c.x; sx < c.x + c.fl - 1e-9 && !big; sx += 20) {
                const mx = sx + 10   // lấy mẫu ĐIỂM GIỮA lát cắt (tránh false-positive biên)
                const segs = laid.filter(l => l.x <= mx && l.x + l.fl >= mx && l.y < c.y + c.fw && l.y + l.fw > c.y)
                  .map(l => [Math.max(l.y, c.y), Math.min(l.y + l.fw, c.y + c.fw)] as [number, number])
                  .sort((a, b) => a[0] - b[0])
                let gap = 0, cur = c.y
                for (const [a, b] of segs) { gap = Math.max(gap, a - cur); cur = Math.max(cur, b) }
                gap = Math.max(gap, c.y + c.fw - cur)
                if (gap >= minY - 1e-9) { run += 20; if (run >= minX) big = true } else run = 0
              }
              if (big) break
            }
            if (big) lightPatch++
          }
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

      // PHA 3 — hàng gửi còn dư: KHÔNG rải nóc lung tung (SOP: "lên hết loại hàng này
      // rồi mới đến loại hàng khác" — hàng nhóm nào đi LIỀN nhóm đó). Dư → (1) nổi tiếp
      // lên chính VÙNG GỬI: pass 1 lấp ô còn hụt lớp; pass 2 dư kịch mọi ô → NỔI THÊM
      // 1 LỚP trên chính khối gửi, dồn PHÍA TRONG thành dải liền (SOP 996+4 nổi TRÊN
      // KHỐI — user 15/07: "8 thùng tím đang không ở khối của nó" khi đặt sang nóc khối
      // khác); (3) còn nữa → 1 KHỐI RIÊNG liền mạch.
      for (const gi of doLights) {
        const g = groupsIn[gi]
        let remaining = avail(gi)
        if (remaining <= 0) continue
        const capN = g.maxLayers ?? LIGHT_MAX_DEFAULT
        for (const [capL, capZ, inward] of [
          [capN, Math.min(topT, truck.height), false],
          [capN + 1, Math.min(topT + g.h, truck.height), true],
        ] as [number, number, boolean][]) {
          while (remaining > 0) {
            const cand = laid
              .filter(c => (g.l <= c.fl && g.w <= c.fw) || (g.w <= c.fl && g.l <= c.fw))
              .filter(c => c.top + g.h <= capZ + 1e-9 && c.n < capL)
              .sort((a, b) => inward ? ((a.x - b.x) || (a.y - b.y)) : (a.top - b.top))[0]
            if (!cand) break
            const fit = (g.l <= cand.fl && g.w <= cand.fw) ? { fl: g.l, fw: g.w } : { fl: g.w, fw: g.l }
            step++
            placed.push({ x: cand.x, y: cand.y, z: cand.top, l: fit.fl, w: fit.fw, h: g.h, group: gi, step })
            used[gi] += 1
            cand.top += g.h
            cand.n += 1
            remaining -= 1
          }
          if (remaining <= 0) break
        }
        if (remaining > 0) {
          if (g.h > truck.height || Math.min(g.l, g.w) > truck.width) {
            leftover.push({ group: gi, count: remaining }); used[gi] += remaining
            continue
          }
          // (2.5) NỔI LÊN NÓC khối sàn CÙNG ĐƠN, dồn PHÍA TRONG thành dải liền — user
          // 23/07: "đưa hàng gửi lên xếp đè lên nó", hàng gửi dư KHÔNG đứng sàn (cột
          // nhẹ đứng sàn giữa/đuôi xe = đổ hàng + tách rời vùng gửi).
          {
            const capN = g.maxLayers ?? LIGHT_MAX_DEFAULT
            const roofCols = cols
              .filter(c => c.doKey === dk)
              .filter(c => (g.l <= c.fl && g.w <= c.fw) || (g.w <= c.fl && g.l <= c.fw))
              .sort((a, b) => (a.x - b.x) || (a.y - b.y))
            for (const c of roofCols) {
              if (remaining <= 0) break
              const fit = (g.l <= c.fl && g.w <= c.fw) ? { fl: g.l, fw: g.w } : { fl: g.w, fw: g.l }
              const n = Math.min(remaining, capN, Math.floor((truck.height - c.top) / g.h))
              if (n <= 0) continue
              step++
              for (let k = 0; k < n; k++)
                placed.push({ x: c.x, y: c.y, z: c.top + k * g.h, l: fit.fl, w: fit.fw, h: g.h, group: gi, step })
              c.top += n * g.h
              c.groups.add(gi)
              used[gi] += n
              remaining -= n
            }
          }
          if (remaining <= 0) continue
          // (3) Khối gửi đứng sàn CHỈ khi cả xe không có gì để đè (đơn toàn hàng gửi);
          // còn lại → bỏ lại (báo "Không vừa xe") — không dựng cột nhẹ đứng sàn.
          if (cols.length === 0 && !laid.length) {
            const roof = laid.length ? Math.max(...laid.map(l => l.top)) : 0
            if (roof > 0) chain.capMm = Math.min(chain.capMm, Math.max(g.h, Math.floor(roof / g.h) * g.h))
            pourClass([gi], `${dk}|top|${classKeyOf(g)}`)
          } else {
            leftover.push({ group: gi, count: remaining }); used[gi] += remaining
          }
        }
      }
    }
    return { placed, leftover, step, spilled, lightPatch, spanMiss, topMiss }
  }

  // Chọn hệ số trải m LỚN NHẤT vẫn xếp đủ (trải tới đuôi xe); ƯU TIÊN phương án SẠCH
  // (không tràn nóc), rồi ÍT HỐ KÍN trên sàn nhất; tie-break maxX lớn hơn.
  // Sau lưới thô, nhị phân tinh chỉnh giữa nấc tốt nhất và nấc kế.
  const maxXOf = (placed: PlacedBox[]) => placed.length ? Math.max(...placed.map(b => b.x + b.l)) : 0
  // SÀN TRỐNG SAU ĐUÔI LÀN (user 23/07: "để hở mà không dùng hết mặt sàn là không đúng
  // logic"): mm chiều dài TB các làn HỤT so mặt tiền xa nhất (quét dải y 50mm). Trừ vào
  // điểm → m-search tự chọn số lớp cho hàng cuối gần KÍN hàng ngang (đuôi phẳng, hết
  // khe góc sàn); điểm = "chiều dài sàn dùng THẬT" thay vì làn dài nhất.
  const tailNotch = (placed: PlacedBox[]): number => {
    const floor = placed.filter(b => b.z === 0)
    if (!floor.length) return 0
    const mx = Math.max(...floor.map(b => b.x + b.l))
    let area = 0, covered = 0
    for (let y = 25; y < truck.width; y += 50) {
      let front = -1
      for (const b of floor) if (b.y <= y && y < b.y + b.w) front = Math.max(front, b.x + b.l)
      if (front < 0) continue
      covered += 50
      area += (mx - front) * 50
    }
    return covered > 0 ? area / covered : 0
  }
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
  // ĐIỂM: chiều dài sàn dùng THẬT (maxX) − hố kín − sàn trống sau đuôi làn (notch) − nóc
  // gửi xấu. `spilled` (thùng nổi nóc DO SÀN HỤT) chỉ PHẠT NHẸ (40mm/thùng) — user 23/07
  // "để hở mà không dùng hết mặt sàn là không đúng logic": HẠ LỚP để trải KÍN sàn tới đuôi
  // (thừa nổi trên khối = đúng SOP) TỐT HƠN khối cao-gọn chừa 1-2m đuôi. Không hard-veto
  // spilled nữa (trước: sạch>trải → xe vừa tải chọn khối cao ngắn, hở đuôi lớn). Over-spread
  // tự chặn: nổi kịch +1 lớp → phần thật dư thành leftover → leftCnt gạt ở nhánh trên.
  const score = (p: PackResult) => maxXOf(p.placed) - closedHoles(p.placed) * 500
    - tailNotch(p.placed) * 3                                 // đuôi phẳng kín sàn (nặng hơn: hết khe góc)
    - p.spilled * 10                                          // nổi-do-sàn-hụt: phạt NHẸ, đổi lấy trải kín sàn (thừa nổi = SOP)
    - p.lightPatch * 100 - p.spanMiss * 0.5 - p.topMiss * 2   // phạt vùng gửi xấu (lõm đỉnh phạt nặng hơn)
  const better = (r: PackResult, cur: PackResult): boolean => {
    const rl = leftCnt(r), cl = leftCnt(cur)
    if (rl !== cl) return rl < cl
    return score(r) >= score(cur)
  }
  const M_GRID = [1, 1.06, 1.13, 1.22, 1.33, 1.5, 1.7, 2, 2.4, 3, 3.8, 5, 6.5, 8.5, 11, 14, 18, 25]
  let best = pack(1)
  let bestIdx = 0
  let bestM = 1
  for (let i = 1; i < M_GRID.length; i++) {
    const r = pack(M_GRID[i])
    if (better(r, best)) { best = r; bestIdx = i; bestM = M_GRID[i] }
  }
  {
    let lo = M_GRID[bestIdx], hi = M_GRID[bestIdx + 1] ?? M_GRID[bestIdx] * 1.3
    for (let i = 0; i < 4; i++) {
      const mid = (lo + hi) / 2
      const r = pack(mid)
      if (better(r, best)) { best = r; lo = mid; bestM = mid } else hi = mid
    }
  }
  // Tinh chỉnh RIÊNG KHỐI CUỐI (user 15/07: "tất cả các lớp bám tới cuối xe"): hạ thêm
  // chỉ khối cuối để mép cuối CHẠM đuôi xe — không kéo cả đoàn hạ theo. better() giữ
  // luật cũ: phải vẫn xếp đủ + sạch, maxX lớn hơn mới nhận.
  for (const mL of [1.1, 1.2, 1.35, 1.5, 1.7, 2]) {
    const r = pack(bestM, mL)
    if (better(r, best)) best = r
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

// ═══ XE PALLET — gom hàng lên pallet TRƯỚC khi xếp lên xe (26/08) ═══════════════════════════
//
// Xe pallet chở hàng ĐÃ LÊN PALLET: sức chứa nói bằng "16-17 pallet" = số CHỖ PALLET trên sàn,
// không phải số thùng. Nên với loại xe này, sơ đồ phải xếp PALLET chứ không xếp thùng —
// cùng một đơn nhưng hai loại xe cho hai bức tranh khác hẳn nhau.
//
// LUẬT GOM (user chốt 26/08, tinh chỉnh cùng ngày — "coi pallet 1,2m×1m là CHÂN, xếp theo quy
// cách tối đa của thùng trên pallet; KHÔNG phải các pallet đều cao như nhau khi D×R×C thùng khác
// nhau"):
//   • Mỗi mã: pallet ĐẦY = phần NGUYÊN của (số thùng ÷ thùng-mỗi-pallet).
//     CHIỀU CAO pallet đầy TÍNH TỪ THÙNG: số thùng/lớp = xếp lưới thùng lên chân (thử cả 2 hướng),
//     số lớp = quy cách ÷ thùng/lớp (làm tròn lên) → cao = đế + lớp × cao thùng. Mỗi mã một chiều
//     cao — thùng thấp thì pallet thấp, không phải cây 1650 đồng loạt.
//   • Phần DƯ của các mã CỘNG DỒN trong cùng ĐƠN rồi LÀM TRÒN LÊN → pallet GỘP hàng lẻ, cao theo
//     `spec.h` (user chốt 1650 cho hàng lẻ). Vd 0,3 + 0,5 + 0,4 = 1,2 → 2 pallet gộp.
//     Cộng dồn theo ĐƠN chứ không theo cả xe: hàng của hai NPP khác nhau không chất chung pallet.
//   • Mã PALLET (Loscam) là pallet RỖNG chở đi — không chia cho quy cách, số lượng đặt CHÍNH LÀ
//     số pallet; và pallet rỗng CHỒNG được nên để thuật toán tự tính lớp theo chiều cao.
//
// KHÔNG tự bịa: mã chưa khai `cartons_per_pallet` → tạm 1 pallet + NÊU TÊN; mã chưa khai kích
// thước thùng → cao rơi về `spec.h` + đánh dấu ước lượng — vẽ một con số sai trông vẫn "hợp lý"
// còn tệ hơn là nói không biết.

export interface PalletSpec {
  l: number; w: number    // CHÂN pallet (mm) — mặc định 1200×1000
  // Cao pallet HÀNG LẺ (gộp) + trần dự phòng cho mã thiếu kích thước thùng (user chốt 1650).
  // Pallet ĐẦY của từng mã KHÔNG dùng số này — cao của nó tính từ thùng.
  h: number
  baseH: number           // chiều cao ĐẾ pallet rỗng (mm) — cộng vào mọi pallet, và là cao của Loscam rỗng
  baseColor: string       // màu vẽ đế pallet (#rrggbb) — từ Material.pallet_color của mã pallet; mặc định xanh Loscam
  weightKg?: number | null // khối lượng 1 pallet rỗng (Material.weight_kg của mã pallet) — cộng vào KL từng khối
}

export interface PalletizeInput {
  key: string; label: string; doKey: string; doLabel: string
  cartons: number                    // số thùng vật lý đã quy đổi
  cartonsPerPallet: number | null     // Material.cartons_per_pallet
  isPalletCarrier: boolean            // Material.is_pallet_carrier — pallet rỗng chở đi
  weightKg: number | null
  // Kích thước THÙNG đã khai (Material.carton_*_mm) — null khi chưa khai / đang dùng cỡ giả định.
  // Có nó mới tính được chiều cao pallet của mã; thiếu thì rơi về spec.h + đánh dấu ước lượng.
  carton: { l: number; w: number; h: number } | null
}

// Số thùng xếp được trên MỘT LỚP của chân pallet — lưới đều, thử cả 2 hướng đặt (cùng triết lý
// "xoay theo làn" của computeLoadPlan: mục đích là tận dụng mặt chân, không trộn hướng trong lớp).
export function cartonsPerLayer(spec: PalletSpec, carton: { l: number; w: number }): number {
  const grid = (l: number, w: number) => Math.floor(spec.l / l) * Math.floor(spec.w / w)
  return Math.max(grid(carton.l, carton.w), grid(carton.w, carton.l))
}

export interface PalletizeResult {
  groups: LoadGroup[]
  notes: string[]        // giải thích cách ra số pallet — hiện thẳng cho người dùng đọc
  warnings: string[]     // thiếu khai báo / không vừa xe
  palletCount: number
  carrierCount: number   // số pallet MANG HÀNG khai trong đơn (dòng is_pallet_carrier) — để đối chiếu
}

/** Gom danh sách dòng hàng thành các KHỐI PALLET để đưa vào `computeLoadPlan`. */
export function palletizeGroups(items: PalletizeInput[], spec: PalletSpec): PalletizeResult {
  const groups: LoadGroup[] = []
  const notes: string[] = []
  const warnings: string[] = []
  const missingSpec: string[] = []
  const pw = spec.weightKg && spec.weightKg > 0 ? spec.weightKg : 0   // KL 1 pallet rỗng
  let carrierCount = 0

  // Gom theo ĐƠN để phần dư chỉ cộng dồn trong cùng một đơn
  const byDo = new Map<string, PalletizeInput[]>()
  for (const it of items) {
    if (it.cartons <= 0) continue
    const cur = byDo.get(it.doKey)
    if (cur) cur.push(it); else byDo.set(it.doKey, [it])
  }

  for (const [doKey, lines] of byDo) {
    const doLabel = lines[0].doLabel
    let fracSum = 0                       // tổng phần dư (đơn vị: pallet) của đơn này
    let fracW = 0                         // tổng KL hàng của phần dư (kg)
    const fracParts: string[] = []

    for (const it of lines) {
      // ── Dòng PALLET MANG HÀNG (Loscam, is_pallet_carrier): chính là pallet LÓT DƯỚI các khối
      // hàng của đơn — KHÔNG xếp thành khối riêng (user bắt 26/08: vẽ vừa lót dưới hàng vừa chất
      // cột 17 pallet rỗng = đếm TRÙNG). Chỉ ghi nhận số khai để đối chiếu với số sơ đồ cần. ──
      if (it.isPalletCarrier) {
        carrierCount += it.cartons
        notes.push(`${it.label}: ${it.cartons} chiếc = pallet LÓT dưới hàng — không xếp thành khối riêng`)
        continue
      }

      const cpp = it.cartonsPerPallet && it.cartonsPerPallet > 0 ? it.cartonsPerPallet : null
      if (!cpp) {
        // Chưa khai quy cách → KHÔNG đoán. Tạm 1 pallet để hàng vẫn chiếm chỗ trên sơ đồ, và nêu tên.
        missingSpec.push(it.label)
        groups.push({
          key: `${it.key}|full`, label: `${it.label} (chưa khai quy cách)`, doKey, doLabel,
          count: 1, l: spec.l, w: spec.w, h: spec.h,
          base: { h: spec.baseH, color: spec.baseColor },
          weightKg: it.weightKg, assumed: true, maxLayers: 1, onTop: false,
        })
        continue
      }

      const full = Math.floor(it.cartons / cpp)
      const rem  = it.cartons - full * cpp

      // CHIỀU CAO pallet đầy của MÃ NÀY — tính từ thùng thật (user chốt: "không phải các pallet
      // đều cao như nhau"). Thùng to hơn chân (0 thùng/lớp) coi như thiếu dữ liệu tin được.
      const perLayer = it.carton ? cartonsPerLayer(spec, it.carton) : 0
      const layers = perLayer > 0 ? Math.ceil(cpp / perLayer) : 0
      const fullH = layers > 0 ? spec.baseH + layers * it.carton!.h : spec.h
      const hNote = layers > 0
        ? `${perLayer} thùng/lớp × ${layers} lớp → cao ${(fullH / 1000).toFixed(2)}m`
        : 'chưa khai kích thước thùng — tạm cao theo pallet lẻ'

      if (full > 0) {
        groups.push({
          key: `${it.key}|full`, label: it.label, doKey, doLabel,
          count: full, l: spec.l, w: spec.w, h: fullH,
          base: { h: spec.baseH, color: spec.baseColor },
          // KL khối = hàng + CHÍNH CÁI PALLET lót dưới (dòng Loscam không còn là khối riêng)
          weightKg: it.weightKg != null ? it.weightKg * cpp + pw : (pw > 0 ? pw : null),
          assumed: layers === 0,   // cao ước lượng vì thiếu kích thước thùng — panel gắn nhãn
          maxLayers: 1,            // pallet hàng KHÔNG chồng lên nhau
          onTop: false,
        })
      }
      if (rem > 0) {
        fracSum += rem / cpp
        fracW += rem * (it.weightKg ?? 0)
        fracParts.push(`${it.label} dư ${rem}/${cpp}`)
      }
      if (full > 0 || rem > 0)
        notes.push(`${it.label}: ${it.cartons} thùng ÷ ${cpp} = ${full} pallet đầy${rem > 0 ? ` + dư ${rem} thùng` : ''} (${hNote})`)
    }

    // ── Phần dư của cả đơn → pallet GỘP ──
    if (fracSum > 0) {
      const mixed = Math.ceil(fracSum - 1e-9)   // 1e-9: chặn 0,9999999 do chia số thực thành 2 pallet
      groups.push({
        key: `${doKey}|mixed`, label: 'Pallet gộp (hàng lẻ)', doKey, doLabel,
        count: mixed, l: spec.l, w: spec.w, h: spec.h,
        base: { h: spec.baseH, color: spec.baseColor },
        weightKg: fracW > 0 || pw > 0 ? fracW / mixed + pw : null,
        assumed: false, maxLayers: 1, onTop: false,
      })
      notes.push(`Pallet gộp đơn ${doLabel}: ${fracParts.join(' + ')} = ${fracSum.toFixed(2)} pallet → ${mixed} pallet gộp`)
    }
  }

  if (missingSpec.length)
    warnings.push(`${missingSpec.length} mã chưa khai "Thùng/pallet" nên không tính được số pallet — tạm tính 1 pallet mỗi mã: ${missingSpec.slice(0, 6).join(', ')}${missingSpec.length > 6 ? '…' : ''}`)

  const palletCount = groups.reduce((s, g) => s + g.count, 0)
  // Đơn khai N pallet mang hàng mà sơ đồ tính cần M ≠ N → nói ra cho người soát (không chặn:
  // lệch 1-2 chiếc là chuyện thường khi pallet gộp / quy cách chưa chuẩn).
  if (carrierCount > 0 && carrierCount !== palletCount)
    warnings.push(`Đơn khai ${carrierCount} pallet mang hàng nhưng sơ đồ tính cần ${palletCount} pallet cho hàng — rà lại số pallet trong đơn nếu lệch nhiều.`)

  return { groups, notes, warnings, palletCount, carrierCount }
}

/**
 * Pallet có vừa lòng xe không — kiểm CẢ HAI hướng đặt (dọc/ngang) như thuật toán xếp vẫn làm.
 * Trả câu giải thích nếu KHÔNG vừa, null nếu vừa. (user chốt 26/08: "pallet k vừa kích thước xe
 * thì cũng báo lại nha" — báo NGAY ở khâu này, đừng để thuật toán im lặng trả về "xếp được 0 cái".)
 */
export function palletFitError(spec: PalletSpec, truck: TruckDims): string | null {
  const fitsFlat = (l: number, w: number) =>
    (l <= truck.length && w <= truck.width) || (w <= truck.length && l <= truck.width)
  if (!fitsFlat(spec.l, spec.w))
    return `Pallet ${spec.l}×${spec.w}mm KHÔNG vừa mặt sàn xe ${truck.length}×${truck.width}mm (đã thử cả xoay ngang) — kiểm lại kích thước pallet hoặc chọn xe khác.`
  if (spec.h > truck.height)
    return `Pallet hàng lẻ cao ${spec.h}mm vượt chiều cao lòng xe ${truck.height}mm — hạ chiều cao xếp hàng trên pallet hoặc chọn xe khác.`
  return null
}

/**
 * Các KHỐI pallet cao quá lòng xe — cao của pallet đầy nay TÍNH TỪ THÙNG nên phải soi TỪNG khối,
 * `palletFitError` chỉ gác được chân + cao pallet lẻ. Trả tên các mã vượt (rỗng = ổn); caller báo
 * đỏ NGAY thay vì để thuật toán im lặng bỏ khối lại rồi hiện "xếp được N/M" khó hiểu.
 */
export function palletsTooTall(groups: LoadGroup[], truck: TruckDims): string[] {
  return [...new Set(groups.filter(g => g.h > truck.height)
    .map(g => `${g.label} (cao ${(g.h / 1000).toFixed(2)}m)`))]
}

/** Số CHỖ pallet trên sàn xe (1 lớp) — để đối chiếu với sức chứa danh nghĩa ("16-17 pallet"). */
export function palletFloorSlots(spec: PalletSpec, truck: TruckDims): number {
  const grid = (l: number, w: number) =>
    Math.floor(truck.length / l) * Math.floor(truck.width / w)
  return Math.max(grid(spec.l, spec.w), grid(spec.w, spec.l))
}

// Pallet chuẩn dùng chung (user chốt 26/08): Loscam 1200×1000mm, cao 1650mm khi ĐÃ XẾP HÀNG —
// con số này áp cho pallet HÀNG LẺ (gộp nhiều mã), cũng là mặc định cho pallet hàng nguyên khi mã
// chưa khai riêng. `baseH` = đế pallet RỖNG (pallet không chở hàng thì chồng được nhiều lớp).
// baseColor mặc định = xanh Loscam (pallet thuê phổ biến nhất) — mã pallet khai màu riêng thì thắng
export const DEFAULT_PALLET: PalletSpec = { l: 1200, w: 1000, h: 1650, baseH: 150, baseColor: '#1d4ed8' }
