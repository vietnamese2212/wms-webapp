// QR code format: ddmmyy_MaterialCode_ChuKy_MayCode_PalletSeq_NMSX
// Example: 070526_510000127_C05_M1_001_A

export interface ParsedQR {
  pallet_code:       string
  production_date:   Date | null
  material_code:     string
  cycle:             string
  machine_code:      string
  pallet_sequence:   string
  manufacturer_code: string
  is_valid:          boolean
  error?:            string
}

export function parseInboundQR(raw: string): ParsedQR {
  const clean = raw.trim()
  const parts = clean.split('_')

  const base: Omit<ParsedQR, 'is_valid' | 'error'> = {
    pallet_code:       clean,
    production_date:   null,
    material_code:     '',
    cycle:             '',
    machine_code:      '',
    pallet_sequence:   '',
    manufacturer_code: '',
  }

  if (parts.length < 6) {
    return { ...base, is_valid: false, error: 'QR không đúng định dạng – cần ít nhất 6 phần ngăn cách bởi _' }
  }

  const [dateStr, materialCode, cycle, machineCode, palletSeq, manufacturerCode] = parts

  // Parse date: ddmmyy → Date
  let production_date: Date | null = null
  if (dateStr && dateStr.length === 6) {
    const day   = parseInt(dateStr.slice(0, 2), 10)
    const month = parseInt(dateStr.slice(2, 4), 10) - 1  // 0-indexed
    const year  = 2000 + parseInt(dateStr.slice(4, 6), 10)
    const d = new Date(Date.UTC(year, month, day))
    if (!isNaN(d.getTime())) production_date = d
  }

  return {
    pallet_code:       clean,
    production_date,
    material_code:     materialCode ?? '',
    cycle:             cycle ?? '',
    machine_code:      machineCode ?? '',
    pallet_sequence:   palletSeq ?? '',
    manufacturer_code: manufacturerCode ?? '',
    is_valid:          true,
  }
}
