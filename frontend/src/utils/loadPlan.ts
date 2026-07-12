// Sơ đồ xếp xe 3D — thuật toán xếp thùng carton vào lòng thùng xe (chạy thuần FE).
// Mô hình THỰC TẾ bốc xếp: thùng cùng mã chồng thành CỘT (đứng, không nằm ngang),
// cột xếp theo DẢI ngang lòng xe (shelf packing) từ trong cabin ra cửa sau.
// 1 step = 1 cột — dùng cho thanh trượt "xếp theo thứ tự" hướng dẫn user làm theo.
// Đơn vị: cm.

export interface TruckDims { length: number; width: number; height: number }

export interface LoadGroup {
  key: string          // material_code
  label: string        // tên hiển thị
  count: number        // tổng số thùng cần xếp
  l: number; w: number; h: number
  weightKg: number | null   // kg/thùng
  assumed: boolean     // true = mã chưa khai kích thước, dùng cỡ giả định
}

export interface PlacedBox {
  x: number; y: number; z: number   // góc trong-trái-sàn; x dọc thân xe (0 = sát cabin), y ngang, z cao
  l: number; w: number; h: number   // sau xoay (l theo x, w theo y)
  group: number                     // index vào groups
  step: number                      // cột thứ mấy (1-based)
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
  weightKg: number      // tổng KL thùng đã xếp (0 nếu không mã nào khai KL)
}

// Cỡ thùng giả định khi mã chưa khai kích thước (cm)
export const ASSUMED_CARTON = { l: 40, w: 30, h: 25 }

export function computeLoadPlan(truck: TruckDims, groupsIn: LoadGroup[]): LoadPlan {
  // Xếp nhóm footprint LỚN trước (ổn định, dễ gọn); giữ ổn định để kết quả lặp lại được
  const order = groupsIn.map((g, i) => i).sort((a, b) => {
    const ga = groupsIn[a], gb = groupsIn[b]
    const fa = ga.l * ga.w, fb = gb.l * gb.w
    if (fa !== fb) return fb - fa
    if (ga.h !== gb.h) return gb.h - ga.h
    return a - b
  })

  const placed: PlacedBox[] = []
  const leftover: { group: number; count: number }[] = []
  let step = 0
  // Trạng thái dải (shelf) hiện tại
  let shelfX = 0, shelfDepth = 0, cursorY = 0

  for (const gi of order) {
    const g = groupsIn[gi]
    if (g.count <= 0) continue
    if (g.h > truck.height || Math.min(g.l, g.w) > truck.width || Math.max(g.l, g.w) > Math.max(truck.length, truck.width)) {
      leftover.push({ group: gi, count: g.count })
      continue
    }
    const stackN = Math.max(1, Math.floor(truck.height / g.h))
    let remaining = g.count

    while (remaining > 0) {
      // Chọn hướng đặt cột: (dài theo x, rộng theo y) hoặc xoay 90°
      const opts: Array<{ fl: number; fw: number }> = g.l === g.w
        ? [{ fl: g.l, fw: g.w }]
        : [{ fl: g.l, fw: g.w }, { fl: g.w, fw: g.l }]
      const fitsCurrent = opts.filter(o => shelfX + o.fl <= truck.length && cursorY + o.fw <= truck.width)
      let pick = fitsCurrent.length
        // Cùng vừa → ưu tiên hướng ăn ÍT chiều dài dải hơn (fl nhỏ); tie → fw nhỏ (chừa nhiều ngang)
        ? fitsCurrent.sort((a, b) => (a.fl - b.fl) || (a.fw - b.fw))[0]
        : null
      if (!pick) {
        // Hết chỗ trong dải → mở dải mới sát sau dải cũ
        if (shelfDepth === 0) { break }   // dải trống mà vẫn không vừa → xe hết chỗ cho nhóm này
        shelfX += shelfDepth; shelfDepth = 0; cursorY = 0
        const fitsNew = opts.filter(o => shelfX + o.fl <= truck.length && o.fw <= truck.width)
        if (!fitsNew.length) break
        pick = fitsNew.sort((a, b) => (a.fl - b.fl) || (a.fw - b.fw))[0]
      }

      const inCol = Math.min(stackN, remaining)
      step++
      for (let k = 0; k < inCol; k++) {
        placed.push({ x: shelfX, y: cursorY, z: k * g.h, l: pick.fl, w: pick.fw, h: g.h, group: gi, step })
      }
      remaining -= inCol
      cursorY += pick.fw
      shelfDepth = Math.max(shelfDepth, pick.fl)
    }

    if (remaining > 0) leftover.push({ group: gi, count: remaining })
  }

  const truckVol = truck.length * truck.width * truck.height
  const usedVol = placed.reduce((s, b) => s + b.l * b.w * b.h, 0)
  const weightKg = placed.reduce((s, b) => s + (groupsIn[b.group].weightKg ?? 0), 0)
  const totalCount = groupsIn.reduce((s, g) => s + Math.max(0, g.count), 0)
  return {
    truck, groups: groupsIn, placed, leftover, stepCount: step,
    volumePct: truckVol > 0 ? Math.round((usedVol / truckVol) * 1000) / 10 : 0,
    placedCount: placed.length, totalCount,
    weightKg: Math.round(weightKg * 10) / 10,
  }
}

// Bảng màu nhóm (tô theo mã hàng)
export const GROUP_COLORS = [
  '#0284c7', '#ea580c', '#16a34a', '#9333ea', '#dc2626', '#ca8a04',
  '#0d9488', '#db2777', '#4f46e5', '#65a30d', '#b45309', '#0891b2',
]
