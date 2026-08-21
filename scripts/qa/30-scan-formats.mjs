// GÓI 30 — TẬP MÃ CAMERA ĐỌC ĐƯỢC (QR + mã vạch 1D), 21/08.
//
// Lớp lỗi gói này gác — cả hai đều IM LẶNG, không log, không exception:
//   1. QUÊN KHAI: trước 21/08 engine chỉ khai `qr_code`/`QRCode` nên mọi mã vạch 1D bị bỏ qua —
//      camera "như không thấy", user tưởng app quét kém chứ không biết là chưa bật (user báo 21/08).
//   2. KHAI SAI TÊN: tên format của zxing là ĐỊNH DANH (`EAN13`), không phải nhãn (`EAN-13`).
//      Gõ nhãn vào thì format đó âm thầm không bật — ratchet tĩnh KHÔNG bắt được, chỉ có đọc THẬT
//      mới bắt (chính lỗi đã mắc khi làm tính năng này, bắt được nhờ phép kiểm này).
//
// Cách kiểm: đọc thẳng danh sách trong frontend/src/utils/scanEngine.ts (một nguồn), rồi SINH ảnh
// mã bằng zxing-wasm/writer và ĐỌC LẠI bằng zxing-wasm/reader với đúng danh sách đó. Không cần
// server, không cần camera, không đụng DB.
// usage: node scripts/qa/30-scan-formats.mjs
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { pathToFileURL } from 'url'

const DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = join(DIR, '..', '..')
const FE = join(ROOT, 'frontend')
const ENGINE_SRC = join(FE, 'src', 'utils', 'scanEngine.ts')

// zxing-wasm nằm trong node_modules của frontend → import theo ĐƯỜNG DẪN (gói QA chạy ở thư mục gốc)
const ZX = join(FE, 'node_modules', 'zxing-wasm', 'dist', 'es')
const { writeBarcode } = await import(pathToFileURL(join(ZX, 'writer', 'index.js')).href)
const { readBarcodes } = await import(pathToFileURL(join(ZX, 'reader', 'index.js')).href)

console.log('── GÓI TẬP MÃ QUÉT (QR + mã vạch 1D) ──')
let pass = 0, fail = 0
const check = (name, ok, note = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}${note ? ' — ' + note : ''}`) }
  else { fail++; console.log(`  ❌ ${name}${note ? ' — ' + note : ''}`) }
}

// ── Danh sách format LẤY TỪ SOURCE (không chép tay — chép tay là hết gác) ──
const src = readFileSync(ENGINE_SRC, 'utf8')
const pick = key => {
  const m = new RegExp(`export const ${key} = \\[([\\s\\S]*?)\\] as const`).exec(src)
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : null
}
const ZXING_FORMATS = pick('ZXING_FORMATS')
const NATIVE_FORMATS = pick('NATIVE_FORMATS')
check('[1] scanEngine khai đủ 2 tập format (zxing + native)', !!ZXING_FORMATS && !!NATIVE_FORMATS,
  `zxing=${ZXING_FORMATS?.length} native=${NATIVE_FORMATS?.length}`)
if (!ZXING_FORMATS || !NATIVE_FORMATS) { console.log('\n[SCAN-FORMATS] ĐỎ'); process.exit(1) }

// QR phải luôn có (tem pallet) và phải có ÍT NHẤT 1 họ 1D (nếu không thì lại về đúng bug 21/08)
check('[2] Có QR trong cả 2 tập', ZXING_FORMATS.includes('QRCode') && NATIVE_FORMATS.includes('qr_code'))
const has1dZx = ZXING_FORMATS.some(f => f !== 'QRCode')
const has1dNat = NATIVE_FORMATS.some(f => f !== 'qr_code')
check('[3] Có mã vạch 1D trong cả 2 tập (không quay lại "chỉ QR")', has1dZx && has1dNat,
  `zxing 1D=${ZXING_FORMATS.filter(f => f !== 'QRCode').join(',')}`)

// Tên native phải là snake_case (BarcodeDetector), tên zxing phải KHÔNG có dấu gạch (định danh)
check('[4] Tên native đúng dạng snake_case', NATIVE_FORMATS.every(f => /^[a-z0-9_]+$/.test(f)),
  NATIVE_FORMATS.join(','))
check('[5] Tên zxing là ĐỊNH DANH, không phải nhãn có gạch (EAN13 ≠ "EAN-13")',
  ZXING_FORMATS.every(f => !f.includes('-')), ZXING_FORMATS.join(','))

// ── Đọc THẬT: mỗi format khai ra phải giải được ảnh do chính nó sinh ──
// Mẫu 1D chọn theo họ; text phải hợp lệ với format (EAN cần đúng check digit, ITF cần chẵn chữ số).
const SAMPLES = {
  QRCode:  ['080826_510000187_1_122_98266_B', '50033;      1;TA260705A018;05/07/2026;05/03/2027;      1;05:26'],
  Code128: ['510000187', 'DO-2026-000123'],
  Code39:  ['PALLET123'],
  EAN13:   ['8934588123450'],
  EAN8:    ['96385074'],
  UPCA:    ['012345678905'],
  ITF:     ['12345678901231'],
}
// UPC-A được trả về dưới dạng EAN-13 (thêm '0' đầu) — đó là chuẩn của thư viện, không phải lỗi.
const sameCode = (want, got) => got === want || got === '0' + want || want === '0' + got
for (const fmt of ZXING_FORMATS) {
  const texts = SAMPLES[fmt]
  if (!texts) { console.log(`  ⚠️  ${fmt}: chưa có mẫu thử trong gói — bổ sung vào SAMPLES nếu format này thực sự cần`); continue }
  for (const text of texts) {
    let img = null, err = ''
    try {
      const w = await writeBarcode(text, { format: fmt, scale: 6 })
      img = w.image
      if (!img) err = w.error || 'writer trả ảnh rỗng'
    } catch (e) { err = e.message }
    if (!img) { check(`[6] ${fmt} giải được mã do chính nó sinh`, false, `không tạo được ảnh mẫu: ${err}`); continue }
    const res = await readBarcodes(img, { formats: ZXING_FORMATS, tryHarder: true, tryRotate: true, maxNumberOfSymbols: 8 })
    const hit = res.find(r => sameCode(text, r.text))
    check(`[6] ${fmt} giải được mã do chính nó sinh`, !!hit,
      hit ? `"${text.slice(0, 34)}"` : `đọc ra ${JSON.stringify(res.map(r => r.text)).slice(0, 80)}`)
  }
}

// ── Đối chứng: cấu hình CHỈ-QR phải TRƯỢT mã vạch — chứng minh phép kiểm trên có sức phân biệt
// (không có bước này thì gói vẫn xanh kể cả khi reader "đọc được mọi thứ" bất chấp danh sách format)
{
  const w = await writeBarcode('510000187', { format: 'Code128', scale: 6 })
  const res = w.image ? await readBarcodes(w.image, { formats: ['QRCode'], tryHarder: true, tryRotate: true }) : []
  check('[7] Đối chứng: chỉ khai QRCode thì KHÔNG đọc được Code128', res.length === 0,
    res.length ? `đọc ra ${JSON.stringify(res.map(r => r.text))}` : 'trượt như kỳ vọng')
}

// ── Mã vạch 1D KHÔNG được nhận là tem pallet (kẻo quét mã hàng trên thùng lại tưởng là pallet) ──
// isValidTem là nguồn dùng chung FE (khung xanh/đỏ) — đọc luật bằng cách nạp chính file utils/qr.ts.
{
  const qrSrc = readFileSync(join(FE, 'src', 'utils', 'qr.ts'), 'utf8')
  // Nạp isValidTem bằng cách bỏ type annotation (file thuần logic, không import gì)
  const js = qrSrc
    .replace(/export /g, '')
    .replace(/: string \| null \| undefined/g, '').replace(/: string/g, '').replace(/: boolean/g, '')
    .replace(/\(raw\)/g, '(raw)')
  const mod = new Function(`${js}; return { isValidTem }`)()
  const notTem = ['510000187', 'DO-2026-000123', '8934588123450', '96385074', 'PALLET123']
  const wrong = notTem.filter(s => mod.isValidTem(s))
  check('[8] Mã vạch 1D không bị nhận là tem pallet', wrong.length === 0, wrong.length ? `nhận sai: ${wrong.join(',')}` : '5 mẫu đều bị loại')
  const tem = ['080826_510000187_1_122_98266_B', '50033;1;TA260705A018;05/07/2026;05/03/2027']
  const missed = tem.filter(s => !mod.isValidTem(s))
  check('[9] Tem pallet thật vẫn hợp lệ (không siết oan)', missed.length === 0, missed.length ? `loại oan: ${missed.join(' | ')}` : '2 format tem đều nhận')
}

// ── Quét NHIỀU mã cùng lúc: "quét kỹ" (tryHarder) phải BẬT mặc định ──────────
// Đo thật 21/08 trên lưới 15 mã (12 barcode 1D + 3 QR) trong CÙNG một khung: tryHarder tắt bắt
// 6–8/15, bật bắt 15/15 — QR đủ ở cả hai chế độ. Nên nếu ai lật mặc định về false thì mã vạch lại
// "bắt kém hơn QR" y như cũ, mà không có lỗi nào để lần ra.
{
  const ms = readFileSync(join(FE, 'src', 'pages', 'wms', 'MultiScanTest.tsx'), 'utf8')
  const th = /loadSettings\(\)\.tryHarder \?\? (true|false)/.exec(ms)
  check('[10] Trang quét loạt mặc định BẬT "quét kỹ" (1D cần, QR thì không)', th?.[1] === 'true',
    `mặc định = ${th?.[1] ?? 'không tìm thấy'}`)
  const ww = /loadSettings\(\)\.wasmWidth \?\? (\d+)/.exec(ms)
  check('[11] Độ phân giải giải mã mặc định ≤ 2560 (3840 không bắt thêm mã mà tốn ~2,4×)',
    !!ww && Number(ww[1]) <= 2560, `mặc định = ${ww?.[1] ?? '?'}px`)
}

console.log(`\n[SCAN-FORMATS] ${pass}/${pass + fail} PASS`)
process.exit(fail ? 1 : 0)
