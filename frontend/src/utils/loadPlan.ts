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
// 8. VUÔNG VẮN — KHÔNG THÁP LẺ (user 27/10: "thạch túi xếp rất cao, hở… hàng tựa vào nhau
//    không đổ"): mọi chỗ đặt thùng LÊN MẶT khối khác (hàng gửi dư, hàng lên nóc pallet) đi
//    qua `levelFill` — RÓT NƯỚC: lát lưới kín ở mặt THẤP nhất trước, đắp ngang mức khối cao
//    nhất rồi mới dâng đều cả mặt; không chất cột trên nóc từng chân. Nhiều mã gửi → mã trước
//    chiếm trọn từng hàng ngang từ phía cabin (mã sau không đè lên mã trước). Pallet gộp hàng
//    lẻ chia lớp cho CAO ĐỀU (không pallet lùn lẻ). Phần sàn (luật 1-7) giữ nguyên.
// 9. PALLET THẬT (user 28/10: "pallet ghép hình khối rất tệ"; "110 thùng – 11 lớp ⇒ 1 lớp 10 thùng"):
//    có số lớp thật ⇒ thùng/lớp = quy cách ÷ số lớp (làm tròn lên), số lớp ≤ số khai; xếp theo mẫu
//    `layerPattern` — gọn trong chân (ghép 2 hướng / chong chóng), chân không chứa nổi thì chờm mép ít
//    nhất và khối pallet chiếm thêm đúng phần chờm (không đè pallet bên). Không khai số lớp ⇒ nhiều
//    thùng nhất gọn trong chân. Phần lẻ của MỖI MÃ giữ NGUYÊN trên MỘT pallet ("100 thùng, quy cách 110
//    mà không lên 1 pallet?"); các phần lẻ dồn PALLET GỘP (trần 1,65m) NẶNG DƯỚI, HÀNG NHẸ (`onTop`)
//    TRÊN CÙNG; muốn pallet riêng ⇒ bể `remPool`. Khối pallet kèm RUỘT (`contents`).
// 10. HÀNG GỬI MỘT KHỐI (user 28/10: "thạch túi lẽ ra xếp trọn ở trên sữa chua chai, độ cao ít chênh
//    lệch, liền kề — nguyên tắc là 1 khối"): xe còn chỗ ⇒ hàng gửi của đơn rót nước thành MỘT khối trên
//    nóc khối nền đầu của đơn; nền hạ thấp trải rộng sao cho nền + gửi ≈ mức khối nền lẽ ra đứng. Mỗi
//    khối sàn chiếm TRỌN hàng ngang (ranh các mã thẳng ngang thùng); xe chật ⇒ cách cũ.
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
  // RUỘT PALLET (28/10): các lớp thùng từ dưới lên — mỗi lớp `n` thùng cỡ l×w×h của dòng hàng `key`
  // (PalletizeInput.key). Để vẽ pallet thành từng lớp thùng thật (pallet gộp thấy rõ mã nào nằm đâu)
  // và kể pallet gộp gồm những gì. Không có = không rõ ruột (mã tính theo cái / thùng to hơn chân).
  contents?: PalletLayer[]
}

// `per` = số thùng một lớp ĐẦY của mã (mẫu xếp `layerPattern`) — lớp thiếu dùng chung vị trí của mẫu đó
export interface PalletLayer { key: string; n: number; per: number; l: number; w: number; h: number }

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

// Gom các khối thành HÀNG NGANG theo DẢI ~1m dọc thân xe (theo tâm khối), từ phía cabin ra.
// Không nối chuỗi "giao nhau": 2 vùng xoay khác nhịp (sâu 420 & 255) chồng mép nhau làm cả đơn
// dính thành 1 hàng (chuyến thật 15/08 _559 — mã gửi đầu trải hết mặt, mã sau bỏ oan 216 thùng).
export function rowsAcross<T extends { x: number; l: number }>(bs: T[], band = 1000): T[][] {
  const by = new Map<number, T[]>()
  for (const b of bs) {
    const k = Math.floor((b.x + b.l / 2) / band)
    const r = by.get(k)
    if (r) r.push(b); else by.set(k, [b])
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1])
}

// Đếm MẶT BÊN LỘ của các thùng `bs`: ngay cạnh mặt bên, ở cao độ giữa thùng, không có thùng nào
// tựa (vách xe = có tựa). Ít mặt lộ = khối gọn, hàng tựa vào nhau — dùng so 2 cách lát hàng gửi.
function exposedSides(all: PlacedBox[], bs: PlacedBox[], truck: TruckDims): number {
  const filled = (x: number, y: number, z: number) => {
    for (const o of all) if (o.x <= x && x < o.x + o.l && o.y <= y && y < o.y + o.w && o.z <= z && z < o.z + o.h) return true
    return false
  }
  let n = 0
  for (const b of bs) {
    const zm = b.z + b.h / 2
    const sides: [number, number, boolean][] = [
      [b.x - 5, b.y + b.w / 2, b.x <= 1], [b.x + b.l + 5, b.y + b.w / 2, b.x + b.l >= truck.length - 1],
      [b.x + b.l / 2, b.y - 5, b.y <= 1], [b.x + b.l / 2, b.y + b.w + 5, b.y + b.w >= truck.width - 1],
    ]
    for (const [x, y, wall] of sides) if (!wall && !filled(x, y, zm)) n++
  }
  return n
}

// ─── LÁT PHẲNG (user 27/10: "thạch túi xếp rất cao, hở… vuông vắn nhất có thể, hàng tựa vào
// nhau không đổ") ───────────────────────────────────────────────────────────────────────────
// Đặt thùng LÊN MẶT các khối đã xếp theo kiểu RÓT NƯỚC: luôn lát ở MẶT THẤP NHẤT còn chỗ trước
// (đắp trũng cho bằng), mỗi mặt bằng lát LƯỚI KÍN thành từng dải từ phía cabin ra, chạy hết
// chiều ngang — không chất cột đứng trên nóc từng chân (từng tạo tháp 8 lớp + khe hở giữa các
// cột vì 1 thùng nhẹ chỉ chiếm một góc mặt chân). Thùng chỉ đặt lên mặt BẰNG PHẲNG đỡ trọn
// đáy; đỉnh không vượt `capZ`. Bản đồ cao lưới 10mm trên vùng được phép.
const LEVEL_R = 10
export function levelFill(o: {
  boxes: PlacedBox[]                                          // mọi thùng đã đặt (dựng bản đồ cao)
  region: { x: number; y: number; l: number; w: number }[]    // mặt được phép đặt lên
  g: LoadGroup; gi: number; count: number
  capZ: number                                                // trần đỉnh thùng đặt thêm (mm)
  forbidTop?: Set<number>                                     // không đè lên mặt là thùng các mã này
  stepStart: number
}): { placed: PlacedBox[]; left: number; step: number } {
  const { boxes, region, g, gi } = o
  let left = o.count, step = o.stepStart
  const placed: PlacedBox[] = []
  if (left <= 0 || !region.length || g.h <= 0) return { placed, left, step }
  const R = LEVEL_R
  const x0 = Math.min(...region.map(r => r.x)), y0 = Math.min(...region.map(r => r.y))
  const x1 = Math.max(...region.map(r => r.x + r.l)), y1 = Math.max(...region.map(r => r.y + r.w))
  const nx = Math.ceil((x1 - x0) / R - 1e-6), ny = Math.ceil((y1 - y0) / R - 1e-6)
  if (nx <= 0 || ny <= 0) return { placed, left, step }
  const N = nx * ny
  const allowed = new Uint8Array(N), height = new Float64Array(N), topG = new Int32Array(N).fill(-1)
  const cnt = new Int32Array(N)   // số lớp của CHÍNH mã này đã chồng tại ô (trần maxLayers)
  // Thùng đã đặt: ô bị che dù MỘT PHẦN cũng tính (cỡ lẻ 422×233 không được để hở vài mm cho thùng
  // sau chờm vào).
  const mark = (x: number, y: number, l: number, w: number, fn: (k: number) => void) => {
    const i0 = Math.max(0, Math.floor((x - x0) / R + 1e-6)), i1 = Math.min(nx, Math.ceil((x + l - x0) / R - 1e-6))
    const j0 = Math.max(0, Math.floor((y - y0) / R + 1e-6)), j1 = Math.min(ny, Math.ceil((y + w - y0) / R - 1e-6))
    for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) fn(i * ny + j)
  }
  // Vùng được phép: ô phải được các mặt đỡ GHÉP LẠI phủ KÍN. Đường giáp 2 chân 255mm cạnh nhau phủ
  // kín → được (xét từng chân riêng thì dải giáp bị loại, mặt phẳng xé thành dải 250mm → túi 310
  // đặt lác đác); MÉP NGOÀI cùng không kín → không (thùng chờm vài mm ra mép rồi khối dựng SAU ở
  // cạnh đó đâm vào — đo 27/10).
  const cover = new Float64Array(N)
  for (const r of region) mark(r.x, r.y, r.l, r.w, k => {
    const i = Math.floor(k / ny), j = k % ny
    const cx0 = x0 + i * R, cy0 = y0 + j * R
    const ix = Math.min(cx0 + R, r.x + r.l) - Math.max(cx0, r.x), iy = Math.min(cy0 + R, r.y + r.w) - Math.max(cy0, r.y)
    if (ix > 0 && iy > 0) cover[k] += ix * iy
  })
  for (let k = 0; k < N; k++) if (cover[k] >= R * R - 0.5) allowed[k] = 1
  for (const b of boxes) {
    if (b.x >= x1 || b.x + b.l <= x0 || b.y >= y1 || b.y + b.w <= y0) continue
    mark(b.x, b.y, b.l, b.w, k => {
      if (b.z + b.h > height[k] + 1e-6) { height[k] = b.z + b.h; topG[k] = b.group }
      if (b.group === gi) cnt[k]++
    })
  }
  const maxL = g.maxLayers ?? Infinity
  const okAt = (k: number, z: number) => allowed[k] === 1 && Math.abs(height[k] - z) < 0.5 && cnt[k] < maxL &&
    !(topG[k] >= 0 && topG[k] !== gi && o.forbidTop?.has(topG[k]))
  const orients = (g.l === g.w ? [[g.l, g.w]] : [[g.l, g.w], [g.w, g.l]]).map(([l, w]) => ({ l, w }))
  // mức đã thử mà không đặt được thùng nào thì về sau cũng không (ô ở mức đó chỉ có thể bớt đi)
  const dead = new Set<number>()
  for (let guard = 0; left > 0 && guard < 400; guard++) {
    // các mức mặt còn đặt được, THẤP trước
    const levels = new Set<number>()
    for (let k = 0; k < N; k++) if (allowed[k] && cnt[k] < maxL && height[k] + g.h <= o.capZ + 1e-6) levels.add(Math.round(height[k]))
    let done = false
    for (const z of [...levels].sort((a, b) => a - b)) {
      if (dead.has(z)) continue
      // prefix sum ô đặt được ở mức z
      const P = new Int32Array((nx + 1) * (ny + 1))
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++)
        P[(i + 1) * (ny + 1) + j + 1] = (okAt(i * ny + j, z) ? 1 : 0) + P[i * (ny + 1) + j + 1] + P[(i + 1) * (ny + 1) + j] - P[i * (ny + 1) + j]
      const fits = (i: number, j: number, a: number, b: number) =>
        i + a <= nx && j + b <= ny &&
        P[(i + a) * (ny + 1) + j + b] - P[i * (ny + 1) + j + b] - P[(i + a) * (ny + 1) + j] + P[i * (ny + 1) + j] === a * b
      // lát theo DẢI: mỗi dải 1 mốc x, quét hết chiều ngang; dải có thùng → dải sau lùi đúng 1 thùng
      let bestPos: { i: number; j: number; l: number; w: number }[] = []
      for (const { l, w } of orients) {
        // làm tròn LÊN: cỡ lẻ (vd 255mm) chiếm đủ ô, thùng cạnh nhau không bao giờ chờm nhau
        const a = Math.ceil(l / R - 1e-9), b = Math.ceil(w / R - 1e-9)
        const pos: { i: number; j: number; l: number; w: number }[] = []
        for (let i = 0; i + a <= nx;) {
          let any = false
          for (let j = 0; j + b <= ny;) {
            if (fits(i, j, a, b)) { pos.push({ i, j, l, w }); any = true; j += b } else j++
          }
          i += any ? a : 1
        }
        if (pos.length > bestPos.length) bestPos = pos
      }
      if (!bestPos.length) { dead.add(z); continue }
      step++
      for (const p of bestPos.slice(0, left)) {
        const bx = x0 + p.i * R, by = y0 + p.j * R
        placed.push({ x: bx, y: by, z, l: p.l, w: p.w, h: g.h, group: gi, step })
        mark(bx, by, p.l, p.w, k => { height[k] = z + g.h; topG[k] = gi; cnt[k]++ })
        left--
      }
      done = true
      break
    }
    if (!done) break
  }
  return { placed, left, step }
}

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

  // m = hệ số trải — vòng chọn bên dưới tìm m LỚN NHẤT vẫn xếp đủ (trải tới đuôi xe).
  // `fine`: lát phẳng hàng gửi THẬT (levelFill — nặng). Vòng chọn m (~30 lần pack) chỉ cần biết
  // CÒN CHỖ cho bao nhiêu thùng gửi → ước lượng theo diện tích; lát thật 1 lần cho phương án thắng.
  // `rows`: khối chiếm TRỌN hàng ngang (luật 28/10) — tắt khi xe chật mà trọn hàng thì bỏ thùng lại.
  function pack(m: number, mLast = 1, fine = false, rows = true) {
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
    // `forceL`: mức thân ép sẵn (khối nền đỡ hàng gửi — luật 10) thay cho mức theo hệ số trải m
    const pourClass = (members: number[], rowKey: string, forceL?: number) => {
      const live = members.filter(gi => avail(gi) > 0)
      if (!live.length) return
      const maxH = Math.max(...live.map(gi => groupsIn[gi].h))
      const full = Math.max(1, Math.floor(truck.height / maxH))
      // Bám mức đuôi khối trước — ceil: chỉ DU DI +1 thùng khi lệch bước (chia hết thì
      // KHÔNG nhô thêm)
      const cap = Math.max(1, Math.min(full, Math.ceil(chain.capMm / maxH)))
      // sàn không hạ dưới 3 lớp (thảm 1-2 lớp kín sàn = phi thực tế — thợ dồn gọn)
      let Lfloor = Math.min(cap, 3)
      let L = Math.max(Lfloor, Math.ceil(cap / mEffOf(rowKey)))
      // BẬC THANG THOẢI (user 14/07: "hạ độ cao phải hạ DẦN, không rơi vực — đổ hàng"):
      // từ khối thứ 2, mức thân không thấp hơn mức khối trước quá 1 bậc an toàn
      if (floorRows.indexOf(rowKey) > 0) {
        const drop = Math.max(2 * maxH, truck.height * 0.25)
        const Lmin = Math.min(cap, Math.max(1, Math.ceil((chain.capMm - drop) / maxH)))
        if (L < Lmin) L = Lmin
        Lfloor = Math.max(Lfloor, Lmin)
      }
      if (forceL != null) { L = Math.max(1, Math.min(forceL, full)); Lfloor = Math.min(Lfloor, L) }
      // Có hàng thừa mà trần không còn chỗ nổi (khối kịch trần) → hạ khối 1 lớp để thừa
      // lên được TRÊN KHỐI (quy trình: không đứng chân ngắn dưới sàn)
      const C = live.reduce((s, gi) => s + avail(gi), 0)
      if (C % L !== 0 && (L + 1) * maxH > truck.height) L = Math.max(1, L - 1)
      st.openCol = null; classCols = []; zones = []
      // HÀNG NGANG TRỌN (user 28/10: "người bốc xếp xếp từ trong ra ngoài theo thứ tự các mã — xếp
      // hàng 1 nửa từ trong ra là không đúng"): khối chiếm TRỌN một số hàng ngang (đủ mọi làn bề
      // rộng) — số chân = sức chứa đúng một chiều sâu D; mức thân = tổng ÷ số chân (≤ L dự kiến, không
      // dưới sàn 3 lớp / bậc thang), phần dư NỔI trên nóc (luật 1). Mặt tiền khối phẳng ⇒ khối sau bắt
      // đầu trên một đường thẳng ngang thùng, không lấp nửa hàng dở của khối trước. Hàng quá ít (không
      // đủ 1 lớp cho trọn hàng) / khối nhận cột thềm của hàng gửi ⇒ giữ cách cũ.
      let colTarget = Infinity
      const g0 = groupsIn[live[0]]
      if (rows && !pendingStubs.some(s => s.ck === classKeyOf(g0) && s.doKey === g0.doKey)) {
        const lanes = zoneMixFor(g0).map(z => { const d = zoneDims(g0, z); return { n: Math.floor((z.yB - z.yA) / d.fw + 1e-9), fl: d.fl } })
        const capAt = (D: number) => lanes.reduce((s, z) => s + z.n * Math.floor(D / z.fl + 1e-9), 0)
        const depths = [...new Set(lanes.flatMap(z => Array.from({ length: Math.floor(truck.length / z.fl) }, (_, k) => (k + 1) * z.fl)))].sort((a, b) => a - b)
        for (const D of depths) {
          const n = capAt(D)
          const Lr = n > 0 ? Math.floor(C / n) : 0
          if (Lr < Lfloor) break
          if (Lr > L || live.some(gi => (groupsIn[gi].maxLayers ?? Infinity) < Lr)) continue
          if (C - Lr * n > 0 && (Lr + 1) * maxH > truck.height) continue   // thừa không còn chỗ nổi
          L = Lr; colTarget = n; break
        }
      }
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
          // 2b) Khối đã đủ số chân TRỌN HÀNG ⇒ phần còn lại nổi trên nóc (< 1 lớp), không mọc nửa
          // hàng mới (nóc không nhận hết — maxLayers/trần — thì mới đứng chân như cũ)
          if (classCols.length >= colTarget) {
            const before = remaining
            remaining = spillOnRoof(g, gi, remaining)
            used[gi] += before - remaining
            if (remaining <= 0) break
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
      // PHA 1 MỚI (luật 10 — user 28/10: "thạch túi lẽ ra xếp TRỌN ở trên sữa chua chai, độ cao ít
      // chênh lệch, liền kề — nguyên tắc là 1 khối"; luật thềm cũ "gửi đủ lớp tối đa trước" dựng tháp
      // gửi 7 lớp trên thềm hẹp 1 chân, phần dư văng sang nóc khối khác = 2 khối): hàng gửi của đơn
      // thành MỘT khối rót nước trên NÓC KHỐI NỀN ĐẦU của đơn. Mức nền p chọn sao cho nền + hàng gửi
      // ≈ mức khối nền lẽ ra đứng (nền hạ thấp, trải rộng ra ⇒ hàng gửi ít lớp). Xe chật (`rows` tắt)
      // vẫn dùng thềm kiểu cũ bên dưới.
      if (rows && doLights.length && doFloor.length) {
        const ck0 = classKeyOf(groupsIn[doFloor[0]])
        const base = doFloor.filter(gi => classKeyOf(groupsIn[gi]) === ck0)
        const bg = groupsIn[base[0]]
        const lg = groupsIn[doLights[0]]
        if (bg.h <= truck.height && Math.min(bg.l, bg.w) <= truck.width) {
          const rowKey = `${dk}|${ck0}`
          const Cb = base.reduce((s, gi) => s + avail(gi), 0)
          const NL = doLights.reduce((s, gi) => s + avail(gi), 0)
          const fullB = Math.max(1, Math.floor(truck.height / bg.h))
          const capB = Math.max(1, Math.min(fullB, Math.ceil(chain.capMm / bg.h)))
          const Lnorm = Math.max(Math.min(capB, 3), Math.ceil(capB / mEffOf(rowKey)))
          const target = Lnorm * bg.h
          const lightCap = lg.maxLayers ?? LIGHT_MAX_DEFAULT
          let p = Lnorm, bestD = Infinity, topEst = Lnorm * bg.h
          for (let q = Lnorm; q >= 1; q--) {
            const per = Math.floor((Math.ceil(Cb / q) * bg.l * bg.w) / (lg.l * lg.w) * 0.85)   // thùng gửi / lớp ước theo diện tích nóc
            if (per <= 0) continue
            const t = Math.ceil(NL / per)
            if (t > lightCap || q * bg.h + t * lg.h > truck.height) continue
            const d = Math.abs(q * bg.h + t * lg.h - target)
            if (d < bestD - 1e-9) { bestD = d; p = q; topEst = q * bg.h + t * lg.h }
          }
          pourClass(base, rowKey, p)
          // BẬC THANG tính cả khối gửi trên nóc (mặt nhìn thấy) — khối sau không tụt quá 1 bậc so với nó
          chain.capMm = Math.min(truck.height, Math.max(chain.capMm, topEst))
          const region = classCols.map(c => ({ x: c.x, y: c.y, l: c.fl, w: c.fw }))
          if (!fine) {
            // vòng chọn m: chỉ ƯỚC sức chứa nóc khối nền dưới trần (đặt thật 1 lần cho phương án thắng)
            let room = classCols.reduce((s, c) => s + Math.max(0, Math.min(lightCap, Math.floor((truck.height - c.top) / lg.h))) * c.fl * c.fw, 0) * 0.9
            for (const gi of doLights) {
              const g = groupsIn[gi]
              const n = Math.min(avail(gi), Math.floor(room / (g.l * g.w)))
              used[gi] += n
              room -= n * g.l * g.w
            }
          } else if (region.length) {
            for (const gi of doLights) {
              const g = groupsIn[gi]
              const n0 = avail(gi)
              if (n0 <= 0) continue
              const r = levelFill({ boxes: placed, region, g: { ...g, maxLayers: g.maxLayers ?? LIGHT_MAX_DEFAULT }, gi, count: n0, capZ: truck.height, stepStart: step })
              for (const b of r.placed) placed.push(b)
              step = r.step
              used[gi] += n0 - r.left
            }
          }
        }
      } else if (doLights.length && doFloor.length) {
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
        // LÁT LẠI CHO KÍN (user 27/10: "hở"): lưới ô gửi mở lại theo TỪNG vùng nền xoay nên giữa
        // 2 vùng còn rãnh ~1 bề thùng (hẹp hơn thùng → không lấp được, thành khe + chồng lẻ). Gỡ
        // hàng gửi vừa lát, lát lại bằng levelFill trên TOÀN mặt thềm (lưới liền, mặt thấp trước,
        // đỉnh ≤ mức chung topT); phần không lát lại được trả về cho PHA 3.
        if (fine && laid.length && platAll.length) {
          const lightSet = new Set(doLights)
          const mine = placed.filter(b => lightSet.has(b.group))
          const keep = placed.filter(b => !lightSet.has(b.group))
          const laidOrig = laid.slice()
          const stepOrig = step
          const exposedBefore = exposedSides(placed, mine, truck)
          placed.length = 0
          for (const b of keep) placed.push(b)
          for (const b of mine) used[b.group]--
          laid.length = 0
          // trần = mức cao nhất vùng gửi CŨ đã đạt (PHA 1 cố ý cho vượt topT < 1 thùng — "thà nhô
          // nhẹ hơn lõm", user 15/07); lấy đúng topT thì lớp gửi đầu có khi không vừa → bỏ oan
          const capRetile = Math.min(truck.height, Math.max(topT, ...mine.map(b => b.z + b.h)))
          for (const gi of doLights) {
            const n = mine.filter(b => b.group === gi).length
            if (!n) continue
            const g = groupsIn[gi]
            const r = levelFill({
              boxes: placed, region: platAll.map(c => ({ x: c.x, y: c.y, l: c.fl, w: c.fw })),
              g: { ...g, maxLayers: g.maxLayers ?? LIGHT_MAX_DEFAULT }, gi, count: n,
              capZ: capRetile, forbidTop: new Set(doLights.filter(x => x !== gi)), stepStart: step,
            })
            for (const b of r.placed) { placed.push(b); used[gi]++ }
            step = r.step
          }
          // Lát lại KHÔNG phải lúc nào cũng tốt hơn: thềm dựng VỪA KHÍT lưới ô cũ, lưới mới có khi
          // chỉ còn chỗ rời rạc → chồng lẻ. Giữ cách nào ÍT mặt thùng lộ (không có hàng tựa ngang)
          // hơn; lát lại mà thiếu thùng thì cũng giữ cách cũ.
          const fresh = placed.filter(b => lightSet.has(b.group))
          if (fresh.length < mine.length || exposedSides(placed, fresh, truck) >= exposedBefore) {
            placed.length = 0
            for (const b of keep) placed.push(b)
            for (const b of fresh) used[b.group]--
            for (const b of mine) { placed.push(b); used[b.group]++ }
            step = stepOrig
            for (const s of laidOrig) laid.push(s)
          }
          // dựng lại `laid` (chồng gửi theo ô) cho PHA 3 + chấm điểm vùng gửi
          if (!laid.length) {
          const stacks = new Map<string, { x: number; y: number; fl: number; fw: number; top: number; n: number }>()
          for (const b of placed) if (lightSet.has(b.group)) {
            const k = `${b.x},${b.y},${b.l},${b.w}`
            const s = stacks.get(k) ?? { x: b.x, y: b.y, fl: b.l, fw: b.w, top: 0, n: 0 }
            s.top = Math.max(s.top, b.z + b.h); s.n++
            stacks.set(k, s)
          }
          for (const s of stacks.values()) laid.push(s)
          }
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
          // (2.5) LÁT PHẲNG LÊN NÓC khối sàn CÙNG ĐƠN — user 23/07: "đưa hàng gửi lên xếp đè
          // lên nó" (hàng gửi dư KHÔNG đứng sàn). User 27/10 bác cách cũ (chất tới 8 lớp trên
          // nóc TỪNG CHÂN → tháp cao lẻ loi + khe hở giữa các cột): nay RÓT NƯỚC — lát lưới kín
          // ở mặt thấp nhất trước, đỉnh không vượt khối nặng cao nhất của đơn; dư mới nổi
          // thêm đúng 1 lớp (SOP thừa nổi trên khối).
          {
            // MỌI chồng hàng NẶNG của đơn — cả cột thềm PHA 1 (không nằm trong `cols`; chuyến thật
            // 15/08 _559 dồn hết nền vào thềm → không còn chỗ nào để đặt → bỏ oan cả mã 216 thùng)
            const stk = new Map<string, Col>()
            for (const b of placed) {
              const gb = groupsIn[b.group]
              if (gb.onTop || gb.doKey !== dk) continue
              const k = `${b.x},${b.y},${b.l},${b.w}`
              const s = stk.get(k)
              if (s) s.top = Math.max(s.top, b.z + b.h)
              else stk.set(k, { x: b.x, y: b.y, fl: b.l, fw: b.w, top: b.z + b.h, doKey: dk, step: b.step, groups: new Set([b.group]) })
            }
            const ordCols = [...stk.values()]
            if (ordCols.length) {
              const ref = Math.max(...ordCols.map(c => c.top))
              const others = new Set(doLights.filter(x => x !== gi))
              const gCap = g.maxLayers ?? LIGHT_MAX_DEFAULT
              if (!fine) {
                // vòng chọn m: chỉ ƯỚC sức chứa theo diện tích nóc dưới trần xe (không đặt thùng)
                const area = g.l * g.w
                let capN = 0
                for (const c of ordCols) {
                  const lay = Math.min(gCap, Math.floor((truck.height - c.top) / g.h))
                  if (lay > 0) capN += lay * (c.fl * c.fw) / area
                }
                const n = Math.min(remaining, Math.floor(capN * 0.9))
                used[gi] += n
                remaining -= n
              }
              // Thật: đắp ngang mức khối cao nhất của đơn, dư thì DÂNG ĐỀU cả mặt tới trần (vẫn phẳng,
              // không bỏ lại hàng — đo 239 chuyến thật 15/08: chặn ở +1 lớp làm 11 chuyến bỏ lại tới
              // 295 thùng). Còn mã gửi khác chờ sau → mã này chiếm TRỌN TỪNG HÀNG NGANG từ phía
              // cabin (đắp rồi dâng), chừa các hàng phía cửa cho mã sau (mã sau không đè lên mã trước).
              const lastLight = doLights.every(x => x === gi || avail(x) <= 0)
              const regionOf = (cs: Col[]) => cs.map(c => ({ x: c.x, y: c.y, l: c.fl, w: c.fw }))
              const pools = fine ? (lastLight ? [ordCols] : rowsAcross(ordCols.map(c => ({ ...c, l: c.fl }))).map(r => r as Col[])) : []
              for (const pool of pools) for (const cap of [ref, truck.height]) {
                if (remaining <= 0) break
                const r = levelFill({
                  boxes: placed, region: regionOf(pool),
                  g: { ...g, maxLayers: gCap }, gi, count: remaining,
                  capZ: Math.min(cap, truck.height), forbidTop: others, stepStart: step,
                })
                for (const b of r.placed) placed.push(b)
                step = r.step
                used[gi] += remaining - r.left
                remaining = r.left
              }
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
    // Đánh số lại bước liền mạch 1..n (lát lại hàng gửi để lại số bước trống — thanh trượt
    // "xếp theo thứ tự" không được có bước rỗng)
    const stepMap = new Map([...new Set(placed.map(b => b.step))].sort((a, b) => a - b).map((s, i) => [s, i + 1]))
    for (const b of placed) b.step = stepMap.get(b.step)!
    step = stepMap.size
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
  const search = (rows: boolean) => {
    let best = pack(1, 1, false, rows)
    let bestIdx = 0
    let bestM = 1
    for (let i = 1; i < M_GRID.length; i++) {
      const r = pack(M_GRID[i], 1, false, rows)
      if (better(r, best)) { best = r; bestIdx = i; bestM = M_GRID[i] }
    }
    {
      let lo = M_GRID[bestIdx], hi = M_GRID[bestIdx + 1] ?? M_GRID[bestIdx] * 1.3
      for (let i = 0; i < 4; i++) {
        const mid = (lo + hi) / 2
        const r = pack(mid, 1, false, rows)
        if (better(r, best)) { best = r; lo = mid; bestM = mid } else hi = mid
      }
    }
    // Tinh chỉnh RIÊNG KHỐI CUỐI (user 15/07: "tất cả các lớp bám tới cuối xe"): hạ thêm
    // chỉ khối cuối để mép cuối CHẠM đuôi xe — không kéo cả đoàn hạ theo. better() giữ
    // luật cũ: phải vẫn xếp đủ + sạch, maxX lớn hơn mới nhận.
    let bestML = 1
    for (const mL of [1.1, 1.2, 1.35, 1.5, 1.7, 2]) {
      const r = pack(bestM, mL, false, rows)
      if (better(r, best)) { best = r; bestML = mL }
    }
    return { best, bestM, bestML, rows }
  }
  // HÀNG NGANG TRỌN trước; xe chật mà trọn hàng phải bỏ thùng lại ⇒ thử cách cũ (mã sau lấp nốt
  // hàng dở), lấy cách bỏ lại ÍT hơn — không bao giờ chở kém đi vì luật hàng trọn
  let pick = search(true)
  if (leftCnt(pick.best) > 0) {
    const alt = search(false)
    if (leftCnt(alt.best) < leftCnt(pick.best)) pick = alt
  }
  // Phương án thắng → xếp lại 1 lần với lát phẳng hàng gửi THẬT
  const best = pack(pick.bestM, pick.bestML, true, pick.rows)

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
  // TRẦN chiều cao pallet LẺ gộp (user chốt vòng 8: "mức đó chỉ là chiều cao TỐI ĐA") —
  // pallet lẻ vẫn xếp THẬT theo kích thước thùng, chồng vượt trần thì SAN sang pallet khác.
  // Pallet ĐẦY không dùng số này — cao của nó tính từ thùng × quy cách.
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
  // Kích thước THÙNG — thật (Material.carton_*_mm) hoặc CỠ GIẢ ĐỊNH khi mã chưa khai (kèm
  // assumed=true). User chốt 26/08 vòng 7: cao pallet NGUYÊN phải tính từ thùng × quy cách để
  // quy cách 140 vs 216 thùng/pallet ra chiều cao KHÁC NHAU — kể cả khi phải dùng cỡ giả định
  // (có nhãn); "Cao pallet lẻ gộp" CHỈ khống chế pallet LẺ, không đụng pallet chẵn.
  carton: { l: number; w: number; h: number } | null
  assumed?: boolean          // thùng đang là cỡ giả định — truyền xuống nhãn "cỡ giả định"
  // Mã KHÔNG có đơn vị "thùng" (đơn vị gốc cái/kg — POSM quạt, bóng, balo…): quy cách chỉ nói
  // "bao nhiêu CÁI trên 1 pallet", không có thùng để xếp lớp. Coi mỗi CÁI là một thùng cỡ giả
  // định thì phần dư phồng lên khủng khiếp — đo đơn THẬT 15/08 (chuyến 108): 200 cái quạt
  // (4.000 cái/pallet ≈ 0,05 pallet) bị tính thành 20 LỚP, pallet gộp từ ~1,5 vọt lên 5 và cảnh
  // báo "lệch pallet" kêu oan. Mã như vậy: phần dư tính theo TỶ LỆ pallet.
  unitless?: boolean
  // Bể gom phần dư RIÊNG (26/08 — "Pallet riêng" per Loại hàng): phần dư của mã này chỉ trộn
  // với mã CÙNG BỂ trong cùng đơn (vd POSM không nằm chung pallet lẻ với thành phẩm).
  // Không khai = bể chung của đơn.
  remPool?: { key: string; label: string }
  // SỐ LỚP trên 1 pallet chẵn (28/10 — dữ liệu thật: 110 thùng / 11 lớp ⇒ 10 thùng/lớp). Có ⇒ thùng/lớp =
  // quy cách ÷ số lớp (`cartonsPerLayer`). Không khai ⇒ nhiều thùng nhất xếp gọn trong chân.
  layers?: number | null
  // HÀNG NHẸ (28/10 — user: "hàng nào mã ghi là nhẹ ⇒ bắt buộc xếp phía trên cùng"): trên pallet gộp
  // các lớp của mã này luôn nằm TRÊN mọi mã thường (không xét kg/thùng).
  onTop?: boolean
}

type Spot = { x: number; y: number; l: number; w: number }
type GPlan = { n: number; build: (x: number, y: number, out: Spot[]) => void }
const guilloMemo = new Map<string, Map<string, GPlan>>()   // theo cỡ thùng — các khung dùng chung lời giải con

// Toạ độ CHUẨN trên cạnh D: mọi tổ hợp i·cl + j·cw ≤ D (mẫu xếp tối ưu luôn đặt được thùng tại các toạ độ này)
function combos(D: number, cl: number, cw: number): number[] {
  const s = new Set<number>()
  for (let i = 0; i * cl <= D; i++) for (let j = 0; i * cl + j * cw <= D; j++) s.add(i * cl + j * cw)
  return [...s].sort((a, b) => a - b)
}

// MẪU XẾP 1 LỚP thùng cl×cw kiểu CẮT CHÉM (guillotine) GỌN TRONG khung L×W — mỗi mảnh lưới đều một
// hướng, cắt dọc/ngang tại tổ hợp i·cl + j·cw. Thùng 420×255 trên chân 1200×1000: lưới thẳng 8, ghép 2
// hướng 9 (chong chóng 10 — `layerPattern`). Trả về vị trí từng thùng (gốc góc khung), sắp theo hàng.
export function palletPattern(L: number, W: number, cl: number, cw: number): Spot[] {
  if (!(cl > 0 && cw > 0) || L <= 0 || W <= 0) return []
  const cuts = (D: number) => combos(D, cl, cw).filter(v => v > 0 && v < D)
  type Plan = GPlan
  if (guilloMemo.size > 64) guilloMemo.clear()
  const mk = `${cl}x${cw}`
  const memo = guilloMemo.get(mk) ?? new Map<string, Plan>()
  guilloMemo.set(mk, memo)
  const grid = (a: number, b: number, l: number, w: number): Plan => {
    const nx = Math.floor(a / l), ny = Math.floor(b / w)
    return { n: nx * ny, build: (x, y, out) => { for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push({ x: x + i * l, y: y + j * w, l, w }) } }
  }
  const best = (a: number, b: number, depth: number): Plan => {
    const k = `${a}x${b}x${depth}`
    const hit = memo.get(k)
    if (hit) return hit
    let p = grid(a, b, cl, cw)
    const q = grid(a, b, cw, cl)
    if (q.n > p.n) p = q
    if (depth > 0) {
      for (const c of cuts(a)) {
        const A = best(c, b, depth - 1), B = best(a - c, b, depth - 1)
        if (A.n + B.n > p.n) p = { n: A.n + B.n, build: (x, y, out) => { A.build(x, y, out); B.build(x + c, y, out) } }
      }
      for (const c of cuts(b)) {
        const A = best(a, c, depth - 1), B = best(a, b - c, depth - 1)
        if (A.n + B.n > p.n) p = { n: A.n + B.n, build: (x, y, out) => { A.build(x, y, out); B.build(x, y + c, out) } }
      }
    }
    memo.set(k, p)
    return p
  }
  const out: Spot[] = []
  best(L, W, 2).build(0, 0, out)
  return out.sort((a, b) => a.y - b.y || a.x - b.x)
}

// ĐÚNG `n` thùng gọn trong khung L×W kể cả mẫu KHÔNG cắt chém được (chong chóng — 420×255 trên 1200×1000
// được 10, cắt chém chỉ 9): tìm sâu trên toạ độ chuẩn (thùng sắp theo hàng y rồi x), giới hạn số nút —
// không thấy ⇒ null. Cận: thùng sau chỉ đặt từ hàng y hiện tại trở lên ⇒ phần mặt dưới hàng đó còn hở
// là bỏ đi; diện tích còn lại không đủ cho số thùng thiếu thì thôi nhánh.
function exactPattern(L: number, W: number, cl: number, cw: number, n: number, budget = 60_000): Spot[] | null {
  const xs = combos(L, cl, cw), ys = combos(W, cl, cw)
  const cand: Spot[] = []
  for (const y of ys) for (const x of xs) for (const [l, w] of [[cl, cw], [cw, cl]]) if (x + l <= L && y + w <= W) cand.push({ x, y, l, w })
  const hit = (p: Spot, q: Spot) => p.x < q.x + q.l && q.x < p.x + p.l && p.y < q.y + q.w && q.y < p.y + p.w
  const a = cl * cw
  const cur: Spot[] = []
  let nodes = 0, found: Spot[] | null = null
  const dfs = (i: number) => {
    if (cur.length >= n) { found = [...cur]; return }
    if (++nodes > budget || cur.length + cand.length - i < n) return
    let lastY = -1
    for (let k = i; k < cand.length && !found && nodes <= budget; k++) {
      const c = cand[k]
      if (c.y !== lastY) {
        lastY = c.y
        let free = (W - c.y) * L
        for (const p of cur) free -= p.l * Math.max(0, p.y + p.w - Math.max(p.y, c.y))
        if (cur.length + Math.floor(free / a) < n) return
      }
      if (cur.some(p => hit(p, c))) continue
      cur.push(c); dfs(k + 1); cur.pop()
    }
  }
  dfs(0)
  return found
}

const layerMemo = new Map<string, Spot[] | null>()

/**
 * MẪU XẾP MỘT LỚP pallet (user 28/10: "hàng nằm gọn trên pallet"; "110 thùng – 11 lớp ⇒ 1 lớp 10 thùng"):
 * `n` thùng cl×cw CĂN GIỮA chân L×W (gốc = góc chân). Không truyền `n` ⇒ nhiều thùng nhất gọn trong chân.
 * Có `n`: khung cắt chém gọn nhất chứa đủ → mẫu chong chóng trong chân → chân không chứa nổi thì CHỜM MÉP
 * ít nhất (toạ độ âm / vượt L·W — thùng 430×250 11/lớp chờm 45mm mỗi đầu). Chờm quá 25% cạnh ⇒ null.
 */
export function layerPattern(L: number, W: number, cl: number, cw: number, n?: number): Spot[] | null {
  if (!(cl > 0 && cw > 0 && L > 0 && W > 0)) return null
  const key = `${L}|${W}|${cl}|${cw}|${n ?? ''}`
  const hit = layerMemo.get(key)
  if (hit !== undefined) return hit
  // bỏ bớt thùng XA tâm nhất khi mẫu dư chỗ (lỗ nằm ở góc, không thủng giữa)
  const keepN = (g: Spot[], k: number) => {
    if (g.length <= k) return g
    const cx = Math.max(...g.map(s => s.x + s.l)) / 2, cy = Math.max(...g.map(s => s.y + s.w)) / 2
    const d = (s: Spot) => (s.x + s.l / 2 - cx) ** 2 + (s.y + s.w / 2 - cy) ** 2
    const drop = new Set([...g].sort((a, b) => d(b) - d(a)).slice(0, g.length - k))
    return g.filter(s => !drop.has(s))
  }
  let pat: Spot[] | null = null
  if (n == null) {
    pat = palletPattern(L, W, cl, cw)
    // thùng nhỏ (lớp > 16 thùng) cắt chém đã sát tối ưu — không tốn công tìm chong chóng
    const tryMore = (k: number) => (k > 0 && k <= 16 ? exactPattern(L, W, cl, cw, k + 1) : null)
    for (let more = tryMore(pat.length); more; more = tryMore(more.length)) pat = more
    if (!pat.length) pat = null
  } else if (n <= 0) pat = []
  else {
    const sides = (D: number, max: number) => [...new Set([D, ...combos(max, cl, cw).filter(v => v > 0)])]
    const need = n * cl * cw
    const inner = sides(L, L).flatMap(a => sides(W, W).map(b => ({ a, b }))).filter(f => f.a <= L && f.b <= W && f.a * f.b >= need)
      .sort((p, q) => p.a * p.b - q.a * q.b)
    for (const f of inner) { const g = palletPattern(f.a, f.b, cl, cw); if (g.length >= n) { pat = keepN(g, n); break } }
    if (!pat) pat = exactPattern(L, W, cl, cw, n)
    if (!pat) {
      const outer = sides(L, Math.floor(L * 1.25)).flatMap(a => sides(W, Math.floor(W * 1.25)).map(b => ({ a, b, o: Math.max(a - L, b - W) })))
        .filter(f => f.o > 0 && f.a * f.b >= need)
        .sort((p, q) => p.o - q.o || Math.max(0, p.a - L) + Math.max(0, p.b - W) - Math.max(0, q.a - L) - Math.max(0, q.b - W) || p.a * p.b - q.a * q.b)
      for (const f of outer) { const g = palletPattern(f.a, f.b, cl, cw); if (g.length >= n) { pat = keepN(g, n); break } }
    }
  }
  if (pat && pat.length) {
    const ox = Math.round((L - Math.max(...pat.map(s => s.x + s.l))) / 2), oy = Math.round((W - Math.max(...pat.map(s => s.y + s.w))) / 2)
    pat = pat.map(s => ({ ...s, x: s.x + ox, y: s.y + oy })).sort((a, b) => a.y - b.y || a.x - b.x)
  }
  if (layerMemo.size > 512) layerMemo.clear()
  layerMemo.set(key, pat)
  return pat
}

// Số thùng MỘT LỚP pallet chẵn. Có số lớp thật (dữ liệu kho: 110 thùng / 11 lớp) ⇒ quy cách ÷ số lớp,
// làm tròn lên (user 28/10 — bản trước lấy min với mẫu cắt chém trong chân nên 420×255 ra 9/lớp, pallet
// 13 lớp cao 1,69m vượt quy định); xếp không nổi kể cả chờm mép ⇒ coi số liệu sai, về mẫu gọn trong chân.
export function cartonsPerLayer(spec: PalletSpec, carton: { l: number; w: number }, cpp?: number | null, layers?: number | null): number {
  if (cpp && cpp > 0 && layers && layers > 0) {
    const n = Math.ceil(cpp / layers)
    if (layerPattern(spec.l, spec.w, carton.l, carton.w, n)) return n
  }
  return layerPattern(spec.l, spec.w, carton.l, carton.w)?.length ?? 0
}

// Cỡ KHỐI pallet = chân + phần CHỜM của các lớp (mẫu căn giữa chân) — xếp lên xe không đè pallet bên cạnh
export function palletFoot(spec: PalletSpec, ls: { l: number; w: number; per: number }[]): { l: number; w: number } {
  let x0 = 0, y0 = 0, x1 = spec.l, y1 = spec.w
  const seen = new Set<string>()
  for (const c of ls) {
    const k = `${c.l}|${c.w}|${c.per}`
    if (seen.has(k)) continue
    seen.add(k)
    for (const s of layerPattern(spec.l, spec.w, c.l, c.w, c.per) ?? []) {
      x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x + s.l); y1 = Math.max(y1, s.y + s.w)
    }
  }
  return { l: x1 - x0, w: y1 - y0 }
}

/**
 * Cỡ MỘT KHỐI để vẽ, theo thứ tự tin cậy: kích thước ĐÃ KHAI → suy từ quy cách (cái/pallet) →
 * cỡ thùng giả định. Đây là cửa DUY NHẤT chọn cỡ khối — đừng tự `hasDims ? … : assumedCarton` ở
 * màn nào khác (cổng tĩnh `assumed_carton_used_directly` gác).
 *
 * Vì sao có nhánh giữa (user báo 27/08): mã bán theo CÁI mà chưa khai kích thước bị vẽ 1 cái = 1
 * thùng giả định — 200 quạt (quy cách 4.000 cái/pallet) thành 200 thùng ≈ 2m³, gấp ~25 lần chỗ
 * thật; POSM phủ kín nóc xe nên MỌI pallet trông cao bằng nhau, sơ đồ vô nghĩa. Quy cách cái/pallet
 * là thứ duy nhất biết được về cỡ ⇒ thể tích 1 cái = thể tích hàng trên 1 pallet ÷ cpp, giữ TỶ LỆ
 * của cỡ giả định, kẹp trong lòng 1 pallet để hình không vỡ khi cpp quá nhỏ.
 * Mã CÓ đơn vị thùng thì KHÔNG suy kiểu này (số lượng vốn đã đếm theo thùng).
 */
export function cartonBoxOf(
  declared: { l: number; w: number; h: number } | null,
  cpp: number | null,
  assumed: { l: number; w: number; h: number },
  spec: PalletSpec,
  unitless: boolean,
): { l: number; w: number; h: number } {
  if (declared && declared.l > 0 && declared.w > 0 && declared.h > 0) return declared
  const payload = spec.l * spec.w * Math.max(0, spec.h - spec.baseH)
  if (!unitless || !(cpp && cpp > 0) || !(payload > 0) || !(assumed.l > 0 && assumed.w > 0 && assumed.h > 0))
    return assumed
  const f = Math.cbrt((payload / cpp) / (assumed.l * assumed.w * assumed.h))
  if (!(f > 0)) return assumed
  return {
    l: Math.max(20, Math.min(spec.l, Math.round(assumed.l * f))),
    w: Math.max(20, Math.min(spec.w, Math.round(assumed.w * f))),
    h: Math.max(20, Math.min(spec.h - spec.baseH, Math.round(assumed.h * f))),
  }
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
    // Phần DƯ của từng mã trong đơn — gom lại rồi xếp theo LỚP lên pallet gộp
    type RemItem = { key: string; label: string; cartons: number; perLayer: number; light: boolean
      carton: { l: number; w: number; h: number } | null
      weightKg: number | null; assumed: boolean; pool: string; poolLabel: string
      frac: number | null }   // mã tính theo cái/kg → phần dư = tỷ lệ của 1 pallet
    const rems: RemItem[] = []
    // Các lớp thùng của `n` thùng một mã (lớp đủ trước, lớp thiếu trên cùng) — ruột pallet để vẽ
    const layersOfCartons = (key: string, n: number, per: number, c: { l: number; w: number; h: number }): PalletLayer[] => {
      const out: PalletLayer[] = []
      for (let left = n; left > 0; left -= per) out.push({ key, n: Math.min(left, per), per, l: c.l, w: c.w, h: c.h })
      return out
    }

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

      // CHIỀU CAO pallet đầy của MÃ NÀY — luôn tính từ thùng × quy cách (user chốt: "không phải
      // các pallet đều cao như nhau"; quy cách 140 vs 216 phải khác cao dù thùng là cỡ giả định).
      // Thùng to hơn chân (0 thùng/lớp) coi như thiếu dữ liệu tin được → mới rơi về spec.h.
      const perLayer = it.carton && !it.unitless ? cartonsPerLayer(spec, it.carton, cpp, it.layers) : 0
      const layers = perLayer > 0 ? Math.ceil(cpp / perLayer) : 0
      const fullH = layers > 0 ? spec.baseH + layers * it.carton!.h : spec.h
      const hNote = layers > 0
        ? `${perLayer} thùng/lớp × ${layers} lớp → cao ${(fullH / 1000).toFixed(2)}m${it.assumed ? ' (cỡ thùng giả định)' : ''}`
        : it.unitless
          ? 'mã tính theo cái/kg — cao tạm theo pallet lẻ, phần dư tính theo tỷ lệ pallet'
          : 'thiếu kích thước thùng tin được — tạm cao theo pallet lẻ'

      if (full > 0) {
        const contents = layers > 0 ? layersOfCartons(it.key, cpp, perLayer, it.carton!) : null
        const foot = contents ? palletFoot(spec, contents) : { l: spec.l, w: spec.w }
        groups.push({
          key: `${it.key}|full`, label: it.label, doKey, doLabel,
          count: full, l: foot.l, w: foot.w, h: fullH,
          base: { h: spec.baseH, color: spec.baseColor },
          // KL khối = hàng + CHÍNH CÁI PALLET lót dưới (dòng Loscam không còn là khối riêng)
          weightKg: it.weightKg != null ? it.weightKg * cpp + pw : (pw > 0 ? pw : null),
          assumed: it.assumed === true || layers === 0,   // cao từ cỡ giả định — panel gắn nhãn
          maxLayers: 1,            // pallet hàng KHÔNG chồng lên nhau
          onTop: false,
          ...(contents ? { contents } : {}),
        })
      }
      if (rem > 0) rems.push({
        key: it.key, label: it.label, cartons: rem, perLayer, light: it.onTop === true,
        carton: it.carton && it.carton.h > 0 ? it.carton : null,
        weightKg: it.weightKg, assumed: it.assumed === true || layers === 0,
        pool: it.remPool?.key ?? '', poolLabel: it.remPool?.label ?? '',
        frac: it.unitless ? rem / cpp : null,
      })
      if (full > 0 || rem > 0)
        notes.push(`${it.label}: ${it.cartons} thùng ÷ ${cpp} = ${full} pallet đầy${rem > 0 ? ` + dư ${rem} thùng` : ''} (${hNote})`)
    }

    // ── Phần dư của cả đơn → pallet GỘP: xếp THẬT theo LỚP thùng, spec.h là TRẦN (user chốt
    // vòng 8 — "pallet lẻ cũng dựa vào kích thước thùng; mức đó chỉ là cao tối đa, vượt thì
    // san sang pallet khác"). Lớp cuối thiếu thùng vẫn chiếm trọn cao thùng. ──
    if (rems.length) {
      const budget = Math.max(0, spec.h - spec.baseH)   // phần cao dành cho HÀNG (trừ đế)
      // Tách theo BỂ (remPool): loại hàng khai "Pallet riêng" gom bể riêng, còn lại bể chung
      const byPool = new Map<string, RemItem[]>()
      for (const r of rems) {
        const arr = byPool.get(r.pool)
        if (arr) arr.push(r); else byPool.set(r.pool, [r])
      }
      for (const [poolKey, poolRems] of byPool) {
        const poolLabel = poolRems[0].poolLabel
        // 1 lớp: `cut` = ruột thật (null khi không dựng được lớp thùng — mã tính theo cái / thùng to
        // hơn chân); wpc = kg/thùng để xếp NẶNG DƯỚI NHẸ TRÊN
        type Layer = { h: number; kg: number; assumed: boolean; cut: PalletLayer | null; wpc: number; light: boolean }
        const layersOf = (r: RemItem): Layer[] => {
          const wpc = r.weightKg ?? 0, light = r.light
          if (r.frac != null)
            // mã tính theo cái/kg: chiếm đúng TỶ LỆ của một pallet (0,05 pallet = 5% chiều cao),
            // không dựng lớp thùng ảo
            return [{ h: Math.max(1, Math.min(budget, Math.round(budget * r.frac))), kg: r.cartons * wpc, assumed: true, cut: null, wpc, light }]
          if (r.perLayer > 0 && r.carton)
            return layersOfCartons(r.key, r.cartons, r.perLayer, r.carton)
              .map(c => ({ h: c.h, kg: c.n * wpc, assumed: r.assumed, cut: c, wpc, light }))
          // không tính được lớp (thùng to hơn chân pallet / thiếu cao thùng) — chiếm nguyên
          // 1 pallet cao bằng trần, gắn nhãn ước lượng
          return [{ h: budget > 0 ? budget : spec.h, kg: r.cartons * wpc, assumed: true, cut: null, wpc, light }]
        }
        const sumH = (ls: Layer[]) => ls.reduce((s, l) => s + l.h, 0)
        const pushPallet = (key: string, label: string, ls: Layer[]) => {
          const kg = ls.reduce((s, l) => s + l.kg, 0)
          const contents = ls.every(l => l.cut) ? ls.map(l => l.cut!) : null
          const foot = contents ? palletFoot(spec, contents) : { l: spec.l, w: spec.w }
          groups.push({
            key, label, doKey, doLabel, count: 1, l: foot.l, w: foot.w,
            h: spec.baseH + sumH(ls),
            base: { h: spec.baseH, color: spec.baseColor },
            weightKg: kg > 0 || pw > 0 ? kg + pw : null,
            assumed: ls.some(l => l.assumed), maxLayers: 1, onTop: false,
            ...(contents ? { contents } : {}),
          })
        }
        // ── Phần lẻ của bể → PALLET GỘP (user 28/10: "phần lẻ của các pallet dồn lên 1 pallet với nhau,
        // cao không quá 1m65; mã ghi là nhẹ bắt buộc xếp trên cùng"; "100 thùng, quy cách 110 mà không xếp
        // lên 1 pallet?"): phần lẻ của MỖI MÃ là MỘT KHỐI NGUYÊN — không bao giờ vắt sang 2 pallet (bản
        // trước cắt dãy lớp cho các pallet cao đều ⇒ 100 thùng sữa chua nằm 2 pallet, mã khác chui dưới).
        // Khối cao xếp trước vào pallet đầu còn đủ trần (FFD); trong pallet NẶNG DƯỚI, HÀNG NHẸ TRÊN CÙNG.
        // Khối một mình đã cao quá trần vẫn nguyên một pallet (không cưa đôi phần lẻ của một mã).
        // (Muốn phần lẻ một nhóm hàng đứng pallet riêng ⇒ khai bể riêng `remPool`.) ──
        const heavyFirst = (a: { light: boolean; wpc: number }, c: { light: boolean; wpc: number }) => Number(a.light) - Number(c.light) || c.wpc - a.wpc
        const chunks = poolRems.map(r => ({ r, ls: layersOf(r) })).map(b => ({ ...b, h: sumH(b.ls) })).filter(b => b.ls.length)
        if (!chunks.length) continue
        const bins: { h: number; cs: typeof chunks }[] = []
        for (const c of [...chunks].sort((a, b) => b.h - a.h)) {
          const p = bins.find(x => x.h + c.h <= budget)
          if (p) { p.h += c.h; p.cs.push(c) } else bins.push({ h: c.h, cs: [c] })
        }
        const mixedLabel = poolLabel ? `Pallet gộp ${poolLabel}` : 'Pallet gộp (hàng lẻ)'
        const nMixed = bins.filter(b => b.cs.length > 1).length
        let k = 0
        bins.forEach((b, i) => {
          const cs = [...b.cs].sort((a, c) => heavyFirst({ light: a.r.light, wpc: a.r.weightKg ?? 0 }, { light: c.r.light, wpc: c.r.weightKg ?? 0 }))
          // pallet chỉ MỘT mã ⇒ gọi tên mã, không phải "gộp"
          const label = cs.length === 1 ? `${cs[0].r.label} (pallet lẻ)` : nMixed > 1 ? `${mixedLabel} #${++k}` : mixedLabel
          pushPallet(`${doKey}|mixed|${poolKey}|${i}`, label, cs.flatMap(c => c.ls))
        })
        notes.push(`Phần lẻ đơn ${doLabel}${poolLabel ? ` (${poolLabel})` : ''}: ${chunks.length} mã → ${bins.length} pallet (mỗi mã nằm nguyên một pallet, trần ${(spec.h / 1000).toFixed(2)}m)`)
      }
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

// ─── Rải THÙNG RỜI lên MẶT các khối pallet (loại hàng "Lên nóc", 26/08 vòng 10) ─────────────
// Thuật toán thùng-sàn (computeLoadPlan) dựng TIỀN TỆ tháp lẻ loi khi trộn thùng với pallet
// (ảnh nghiệm thu: 278/836 thùng bị bỏ oan) — đường xếp đúng của "lên nóc" là: coi NÓC từng
// pallet đã xếp là một mặt sàn mới, MẶT THẤP LẤP TRƯỚC (giữ tải phẳng), mỗi mặt tile lưới
// thùng (thử 2 hướng), chồng lớp tới trần lòng xe; lớp cuối thiếu thùng vẫn nâng mặt trọn lớp.
export function spreadOnTopOfPallets(plan: LoadPlan, topIdx: number[], groupsIn: LoadGroup[]): LoadPlan {
  if (!topIdx.length) return plan
  // KHÔNG có mặt nào để đặt lên (xe chưa xếp được khối nào) → phải NÓI RA bằng "không vừa xe".
  // Trước 26/08 hàm này lặng lẽ `return plan`: cả xe hàng biến mất, ô "Xếp được" hiện 0/0 mà
  // không một dòng cảnh báo (đo trên đơn THẬT 15/08: 4 chuyến toàn FG02 khai "Lên nóc").
  if (!plan.placed.length) {
    const leftover = [...plan.leftover]
    let addTotal = 0
    for (const gi of topIdx) {
      const g = groupsIn[gi]
      if (g.count > 0) { leftover.push({ group: gi, count: g.count }); addTotal += g.count }
    }
    return { ...plan, leftover, totalCount: plan.totalCount + addTotal }
  }
  const H = plan.truck.height
  // User 27/10: "vuông vắn nhất có thể, không tháp lẻ" — bỏ cách vòng 11 (chất ĐẦY TỚI TRẦN
  // từng mặt pallet → tháp cao hơn hẳn pallet bên cạnh). Nay RÓT NƯỚC (levelFill): (1) đắp các
  // pallet THẤP lên NGANG pallet cao nhất của đơn; (2) dư mới dâng ĐỀU cả mặt tới trần (mỗi lớp
  // lát kín từ phía cabin ra) — mặt hàng luôn phẳng, không cột lẻ. GIỮ luật vòng 11: mã sau
  // KHÔNG đè lên mã trước (forbidTop) — không 1 lớp A dưới 1 lớp B trên cùng chỗ; chồng không
  // quá số lớp tối đa của mã. Hàng nóc của đơn nào đặt lên pallet CỦA ĐƠN ĐÓ trước; thiếu chỗ
  // mới sang pallet đơn khác.
  const pallets = [...plan.placed]
  const foot = (b: PlacedBox) => ({ x: b.x, y: b.y, l: b.l, w: b.w })
  const placed = [...plan.placed]
  const leftover = [...plan.leftover]
  let step = plan.stepCount
  let addVol = 0, addW = 0, addPlaced = 0, addTotal = 0
  const topSet = new Set(topIdx)
  for (const gi of topIdx) {
    const g = groupsIn[gi]
    if (g.count <= 0) continue
    addTotal += g.count
    let left = g.count
    const others = new Set([...topSet].filter(x => x !== gi))
    const own = pallets.filter(b => groupsIn[b.group]?.doKey === g.doKey)
    const fill = (region: PlacedBox[], cap: number) => {
      if (left <= 0 || !region.length) return
      const r = levelFill({ boxes: placed, region: region.map(foot), g, gi, count: left,
        capZ: Math.min(cap, H), forbidTop: others, stepStart: step })
      for (const b of r.placed) { placed.push(b); addPlaced++; addVol += b.l * b.w * b.h; addW += g.weightKg ?? 0 }
      step = r.step
      left = r.left
    }
    // còn mã nóc khác chờ sau → chiếm TRỌN TỪNG HÀNG pallet từ phía cabin (chừa hàng phía cửa cho
    // mã sau — mã sau không được đè lên mã này; trải mỏng khắp xe thì mã sau hết chỗ)
    const isLast = topIdx.every(x => x === gi || groupsIn[x].count <= 0 || topIdx.indexOf(x) < topIdx.indexOf(gi))
    for (const pool of own.length && own.length < pallets.length ? [own, pallets] : [pallets]) {
      const ref = Math.max(...pool.map(b => b.z + b.h))
      for (const part of isLast ? [pool] : rowsAcross(pool)) {
        fill(part, ref)                                       // (1) đắp ngang pallet cao nhất
        fill(part, H)                                         // (2) dư: dâng đều cả mặt tới trần
      }
    }
    if (left > 0) leftover.push({ group: gi, count: left })
  }
  const truckVol = plan.truck.length * plan.truck.width * plan.truck.height
  return {
    ...plan, placed, leftover,
    stepCount: step,
    placedCount: plan.placedCount + addPlaced,
    totalCount: plan.totalCount + addTotal,
    weightKg: plan.weightKg + addW,
    volumePct: Math.round((((plan.volumePct / 100) * truckVol + addVol) / truckVol) * 1000) / 10,
  }
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
