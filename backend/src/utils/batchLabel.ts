// TEM PALLET CỦA MẺ + CHU KỲ (MES 17/11). Hàm thuần — test ở backend/tests/unit/batchLabel.test.ts.
//   • Mã lô của mẻ do DB ghép (hàm mes_batch_code): <chữ nhà máy><chu kỳ><số mẻ 4 số><mã bồn>, vd B300001BD62.
//   • Tem pallet của mẻ (QA in, dán lên pallet nguyên liệu đã cấp): QR `MEB;<mã lô>;<i>;<n>;<bản tem>`.
//     Bản tem tăng mỗi lần đổi số pallet hoặc đổi mã lô (đổi bồn) ⇒ tem cũ quét sẽ bị từ chối.
//     Tiền tố `MEB;` để không lẫn với tem pallet nhập kho (hai định dạng `_` và `;` của parseInboundQR).

export const BATCH_LABEL_PREFIX = 'MEB'
export interface BatchLabel { batch_code: string; pallet_no: number; pallet_total: number; label_ver: number }

/** Chu kỳ người gõ ⇒ dạng lưu: IN HOA, bỏ khoảng trắng và ký tự lạ. Hợp lệ khi 1–6 chữ / số. */
export function normalizeCycle(raw: string | null | undefined): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}
export const CYCLE_RE = /^[A-Z0-9]{1,6}$/

/** Nội dung QR của tem pallet thứ i / n. */
export function batchLabelQr(batchCode: string, i: number, n: number, ver: number): string {
  return `${BATCH_LABEL_PREFIX};${batchCode};${i};${n};${ver}`
}

/** Đọc QR tem pallet của mẻ. Không phải tem mẻ ⇒ null. */
export function parseBatchLabel(raw: string | null | undefined): BatchLabel | null {
  const parts = String(raw ?? '').trim().split(';').map(s => s.trim())
  if (parts.length !== 5 || parts[0].toUpperCase() !== BATCH_LABEL_PREFIX) return null
  const [, code, i, n, ver] = parts
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(code) || ![i, n, ver].every(x => /^\d{1,3}$/.test(x))) return null
  const pallet_no = Number(i), pallet_total = Number(n), label_ver = Number(ver)
  if (pallet_no < 1 || pallet_total < 1 || pallet_no > pallet_total || pallet_total > 99 || label_ver < 1) return null
  return { batch_code: code.toUpperCase(), pallet_no, pallet_total, label_ver }
}
