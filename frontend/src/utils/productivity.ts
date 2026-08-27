// Công thức chỉ số NĂNG SUẤT KHO — MỘT nguồn (user chốt 27/08).
// BE chỉ trả SỐ THÔ (tấn, ngày công, giờ công, giờ OT); mọi TỶ SỐ tính ở đây để ô tổng, bảng theo
// kho và biểu đồ xu hướng không bao giờ lệch nhau vì có người chia lại tại chỗ.
//
// Mẫu số 0 ⇒ trả `null` (màn hình hiện "—"), TUYỆT ĐỐI không trả 0: "0 tấn/công" đọc ra là
// "làm mà không ra gì", còn sự thật là "kỳ này chưa có dữ liệu chấm công" — hai chuyện khác hẳn.

export type ProdCore = {
  tons: number; work_days: number; work_hours: number; ot_hours: number
}

const ratio = (a: number, b: number): number | null =>
  Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null

/** Tấn / NGÀY CÔNG — chỉ số "năng suất" quen dùng nhất khi nói chuyện với kho. */
export const tonsPerWorkDay = (r: ProdCore): number | null => ratio(r.tons, r.work_days)

/**
 * Tấn / GIỜ CÔNG — phải hiện CẠNH tấn/ngày công.
 * Lý do: tăng ca KHÔNG làm tăng số ngày công (1 người làm 12h vẫn là 1 công), nên kho nào chạy
 * nhiều OT thì tấn/công tự trông đẹp lên. Mẫu số ở đây có cả giờ OT nên không bị méo.
 */
export const tonsPerWorkHour = (r: ProdCore): number | null => ratio(r.tons, r.work_hours)

/** Tỷ lệ tăng ca = giờ OT ÷ tổng giờ công (0–1). */
export const otRate = (r: ProdCore): number | null => ratio(r.ot_hours, r.work_hours)

/** Chi phí / tấn — dùng ở đợt module Chi phí; để sẵn đây cho cùng một chỗ. */
export const costPerTon = (costVnd: number, tons: number): number | null => ratio(costVnd, tons)

/** Số VN gọn cho ô chỉ số: giữ tối đa `d` số lẻ, không có số thì "—". */
export function fmtNum(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: d })
}

export function fmtPct(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${(v * 100).toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: d })}%`
}
