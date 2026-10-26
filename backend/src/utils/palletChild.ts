// MÃ PALLET CON ".N" — MỘT nguồn cho Tách pallet (palletOpsController.split) và nhận HÀNG LẺ trả về (26/10): hàng lẻ quay về
// không có tem riêng ⇒ app sinh tem con của tem GỐC, mang nguyên lô / NSX / HSD (user chốt "hàng lẻ in tem mới mang lô gốc").
//   • V1 (`_`): ".N" gắn vào ĐOẠN STT (đoạn 5) — `ddmmyy_Mã_ChuKỳ_Máy_STT.N_NMSX`
//   • V2 (`;`): ".N" gắn vào ĐUÔI MÃ LÔ (đoạn 3) — `Mã;QA;TA260705A018.N;NSX;HSD;Mẻ;Giờ`
// Tách QR rải rác là lỗi đã ghi ở CLAUDE.md (luật "PARSE PHẢI TẬP TRUNG") — sửa luật đặt tên con ở đây.

export type ChildBase = { isV2: boolean; parts: string[]; segs: string[]; baseMalo: string; baseSeq: string }

/** Bóc tem gốc để đặt tên con; `null` + lý do khi tem không đúng định dạng. */
export function childBaseOf(src: string): { base: ChildBase | null; error: string | null } {
  const isV2 = src.includes(';')
  const parts = src.split('_')
  const segs = isV2 ? src.split(';') : []
  const baseMalo = isV2 ? (segs[2] ?? '') : ''
  if (!isV2 && parts.length < 6) return { base: null, error: 'Mã pallet gốc không đúng định dạng QR' }
  if (isV2 && (segs.length < 3 || !baseMalo)) return { base: null, error: 'Mã pallet V2 thiếu mã lô (đoạn 3)' }
  return { base: { isV2, parts, segs, baseMalo, baseSeq: isV2 ? '' : parts[4] }, error: null }
}

/** Mẫu ILIKE thu hẹp ứng viên con (lọc lại chính xác bằng `childIndexOf`). */
export function childLikePattern(b: ChildBase): string {
  return b.isV2 ? `%${b.baseMalo}.%` : `${b.parts.slice(0, 4).join('_')}_${b.baseSeq}.%`
}

/** Số N của một mã nếu đúng là CON trực tiếp của tem gốc; ngược lại null. */
export function childIndexOf(b: ChildBase, code: string): number | null {
  if (b.isV2) {
    // con V2 = mọi đoạn GIỐNG gốc, chỉ đoạn 3 = "<baseMalo>.N" (N thuần số → loại cháu ".1.2")
    const cs = code.split(';')
    if (cs.length === b.segs.length && cs.every((v, idx) => idx === 2 || v === b.segs[idx]) && cs[2].startsWith(`${b.baseMalo}.`)) {
      const suffix = cs[2].slice(b.baseMalo.length + 1)
      if (/^\d+$/.test(suffix)) return parseInt(suffix, 10)
    }
    return null
  }
  const p = code.split('_')
  const ps = b.parts
  if (p.length === ps.length && p[0] === ps[0] && p[1] === ps[1] && p[2] === ps[2] && p[3] === ps[3] && p[5] === ps[5] && p[4].startsWith(`${b.baseSeq}.`)) {
    const n = parseInt(p[4].slice(b.baseSeq.length + 1), 10)
    return isNaN(n) ? null : n
  }
  return null
}

/** Mã con thứ N của tem gốc. */
export function childCodeOf(b: ChildBase, n: number): string {
  if (b.isV2) { const s = [...b.segs]; s[2] = `${b.baseMalo}.${n}`; return s.join(';') }
  const p = [...b.parts]; p[4] = `${b.baseSeq}.${n}`; return p.join('_')
}
