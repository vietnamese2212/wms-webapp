// QR code format: ddmmyy_MaterialCode_ChuKy_MayCode_PalletSeq_NMSX
// Example: 070526_510000127_C05_M1_001_A

export interface ParsedQR {
  pallet_code:        string
  production_date:    Date | null
  material_code:      string
  cycle:              string
  machine_code:       string
  pallet_sequence:    string   // raw string, e.g. "001"
  pallet_sequence_no: number | null  // parsed integer, e.g. 1
  manufacturer_code:  string
  is_valid:           boolean
  error?:             string
}

export function parseInboundQR(raw: string): ParsedQR {
  const clean = raw.trim()
  const parts = clean.split('_')

  const base: Omit<ParsedQR, 'is_valid' | 'error'> = {
    pallet_code:        clean,
    production_date:    null,
    material_code:      '',
    cycle:              '',
    machine_code:       '',
    pallet_sequence:    '',
    pallet_sequence_no: null,
    manufacturer_code:  '',
  }

  if (parts.length < 6) {
    return { ...base, is_valid: false, error: 'QR không đúng định dạng – cần ít nhất 6 phần ngăn cách bởi _' }
  }

  const [dateStr, materialCode, cycle, machineCode, palletSeq, manufacturerCode] = parts

  // Parse date: ddmmyy → Date (with strict calendar validation)
  let production_date: Date | null = null
  if (dateStr && dateStr.length === 6) {
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
    pallet_code:        clean,
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
