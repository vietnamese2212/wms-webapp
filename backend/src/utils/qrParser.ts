// QR pallet — 2 định dạng sống chung vô thời hạn (multi-tenant: mỗi đơn vị 1 format tem CỐ ĐỊNH):
//
// V1 (đơn vị 1, delimiter `_`): ddmmyy_MaterialCode_ChuKy_<Máy|NCC>_PalletSeq_NMSX
//   Đoạn 4 (machine_code) = Máy với thành phẩm; = MÃ NCC với hàng nhập NCC (POSM/Raw/Thùng/Giấy),
//   khi đó NMSX (đoạn 6) = nơi nhận đầu tiên. Parser đọc theo VỊ TRÍ; ý nghĩa do loại hàng quyết định.
//   Example TP:  070526_510000127_C05_M1_001_B
//   Example NCC: 070526_<maPOSM>_C05_10008728_001_B
//
// V2 (đơn vị 2, delimiter `;`, nhà máy in cố định — các đoạn có PADDING SPACE phải trim):
//   MaterialCode;QA;MãLô;NSX;HSD;Giờ;Phút:Giây
//   Example: 50033;      1;TA260705A045;05/07/2026;05/03/2027;      1;05:26
//   - QA: 1=OK, khác 1 (0…)=X
//   - Mã lô: <TắtHàng 2 ký tự><yymmdd><Máy 1 ký tự><SEQ 3 số> — Máy/SEQ trích được như V1
//   - NSX/HSD: dd/mm/yyyy (parse theo THÀNH PHẦN — không toISOString từ local, tránh lệch -1 ngày)
//   pallet_code = chuỗi CHUẨN HÓA (trim từng đoạn, nối lại `;`) → dedup/tra cứu ổn định.

export interface ParsedQR {
  pallet_code:        string
  format:             'v1' | 'v2'
  production_date:    Date | null
  material_code:      string
  cycle:              string
  machine_code:       string
  pallet_sequence:    string   // raw string, e.g. "001"
  pallet_sequence_no: number | null  // parsed integer, e.g. 1
  manufacturer_code:  string
  // V2-only (null/'' với V1):
  qa_ok:              boolean | null  // đoạn 2: true=OK, false=X
  batch:              string | null   // đoạn 3: mã lô nguyên văn
  expiry_date:        Date | null     // đoạn 5: HSD
  production_time:    string | null   // đoạn 6+7: "H:MM:SS"
  is_valid:           boolean
  error?:             string
}

/** Chuẩn hóa chuỗi QR để lưu/tra cứu pallet_code: V2 trim từng đoạn (tem nhà máy đệm space), V1 chỉ trim 2 đầu. */
export function normalizeQR(raw: string): string {
  const clean = (raw ?? '').trim()
  if (!clean.includes(';')) return clean
  return clean.split(';').map(p => p.trim()).join(';')
}

/** Parse dd/mm/yyyy → Date UTC (validate lịch thật, chống roll-over kiểu 30/02). */
function parseDMY(s: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (!m) return null
  const day = parseInt(m[1], 10), month = parseInt(m[2], 10), year = parseInt(m[3], 10)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return d
}

// Mã lô V2: <2 chữ/số><yymmdd><Máy 1 chữ><SEQ 3 số>, cho phép đuôi .n (tem con tách pallet)
const V2_BATCH_RE = /^[A-Z0-9]{2}\d{6}([A-Z])(\d{3})(\.\d+)?$/i

function parseV2(clean: string): ParsedQR {
  const parts = clean.split(';').map(p => p.trim())
  const pallet_code = parts.join(';')

  const base: Omit<ParsedQR, 'is_valid' | 'error'> = {
    pallet_code,
    format:             'v2',
    production_date:    null,
    material_code:      '',
    cycle:              '',
    machine_code:       '',
    pallet_sequence:    '',
    pallet_sequence_no: null,
    manufacturer_code:  '',
    qa_ok:              null,
    batch:              null,
    expiry_date:        null,
    production_time:    null,
  }

  if (parts.length < 5) {
    return { ...base, is_valid: false, error: `QR dạng ";" cần ít nhất 5 phần (Mã hàng;QA;Mã lô;NSX;HSD) — nhận được ${parts.length}` }
  }

  const [materialCode, qaStr, batch, nsxStr, hsdStr, hourStr, minSecStr] = parts

  if (!materialCode) return { ...base, is_valid: false, error: 'QR thiếu mã hàng (phần 1)' }
  if (!batch)        return { ...base, is_valid: false, error: 'QR thiếu mã lô (phần 3)' }

  const production_date = parseDMY(nsxStr ?? '')
  if (!production_date) {
    return { ...base, is_valid: false, error: `NSX không hợp lệ — cần dd/mm/yyyy (nhận được: "${nsxStr ?? ''}")` }
  }
  const expiry_date = parseDMY(hsdStr ?? '')
  if (!expiry_date) {
    return { ...base, is_valid: false, error: `HSD không hợp lệ — cần dd/mm/yyyy (nhận được: "${hsdStr ?? ''}")` }
  }

  // Máy + SEQ trích từ mã lô (cấu trúc giống V1); mã lô lệch cấu trúc vẫn hợp lệ — chỉ không trích được
  let machine_code = '', pallet_sequence = '', pallet_sequence_no: number | null = null
  const bm = V2_BATCH_RE.exec(batch)
  if (bm) {
    machine_code    = bm[1].toUpperCase()
    pallet_sequence = bm[2]
    pallet_sequence_no = parseInt(bm[2], 10)
  }

  return {
    ...base,
    material_code:   materialCode,
    machine_code,
    pallet_sequence,
    pallet_sequence_no,
    qa_ok:           qaStr === '1',
    batch,
    production_date,
    expiry_date,
    production_time: (hourStr && minSecStr) ? `${hourStr}:${minSecStr}` : null,
    is_valid:        true,
  }
}

export function parseInboundQR(raw: string): ParsedQR {
  const clean = (raw ?? '').trim()

  // V2 (tem `;` — đơn vị 2): tự nhận theo delimiter, không cần cờ cấu hình
  if (clean.includes(';')) return parseV2(clean)

  const parts = clean.split('_')

  const base: Omit<ParsedQR, 'is_valid' | 'error'> = {
    pallet_code:        clean,
    format:             'v1',
    production_date:    null,
    material_code:      '',
    cycle:              '',
    machine_code:       '',
    pallet_sequence:    '',
    pallet_sequence_no: null,
    manufacturer_code:  '',
    qa_ok:              null,
    batch:              null,
    expiry_date:        null,
    production_time:    null,
  }

  if (parts.length < 6) {
    return { ...base, is_valid: false, error: 'QR không đúng định dạng – cần ít nhất 6 phần ngăn cách bởi _' }
  }

  const [dateStr, materialCode, cycle, machineCode, palletSeq, manufacturerCode] = parts

  // Parse date: ddmmyy → Date (with strict calendar validation)
  if (!dateStr || dateStr.length !== 6) {
    return { ...base, is_valid: false, error: `QR không có ngày hợp lệ — phần ngày cần đúng 6 ký tự ddmmyy (nhận được: "${dateStr ?? ''}")` }
  }
  let production_date: Date | null = null
  {
    const day   = parseInt(dateStr.slice(0, 2), 10)
    const month = parseInt(dateStr.slice(2, 4), 10)
    const year  = 2000 + parseInt(dateStr.slice(4, 6), 10)
    if (month < 1 || month > 12) {
      return { ...base, is_valid: false, error: `Ngày QR không hợp lệ: tháng ${month} không tồn tại (${dateStr})` }
    }
    if (day < 1 || day > 31) {
      return { ...base, is_valid: false, error: `Ngày QR không hợp lệ: ngày ${day} không tồn tại (${dateStr})` }
    }
    const d = new Date(Date.UTC(year, month - 1, day))
    // JS rolls over invalid dates (e.g. Feb 30 → Mar 2); verify month/day unchanged
    if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
      return { ...base, is_valid: false, error: `Ngày QR không hợp lệ: ${day}/${month}/${year - 2000} không tồn tại` }
    }
    production_date = d
  }

  const palletSeqStr = palletSeq ?? ''
  const seqNum = parseInt(palletSeqStr, 10)

  return {
    ...base,
    production_date,
    material_code:      materialCode ?? '',
    cycle:              cycle ?? '',
    machine_code:       machineCode ?? '',
    pallet_sequence:    palletSeqStr,
    pallet_sequence_no: isNaN(seqNum) ? null : seqNum,
    manufacturer_code:  manufacturerCode ?? '',
    is_valid:           true,
  }
}
