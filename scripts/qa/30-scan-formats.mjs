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

// Nạp helper TS của app để kiểm logic THUẦN (dedupe/validate) — transpile bằng esbuild trong
// node_modules của frontend; `import` giữa các file được nối tay theo thứ tự truyền vào.
const { transformSync } = await import(pathToFileURL(join(FE, 'node_modules', 'esbuild', 'lib', 'main.js')).href)
async function loadTs(files, exports) {
  const js = files.map(f => transformSync(readFileSync(join(FE, f), 'utf8'), { loader: 'ts' }).code
    .replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '')).join('\n')
  return new Function(`${js}\nreturn { ${exports.join(', ')} }`)()
}

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
  const mod = await loadTs(['src/utils/qr.ts'], ['isValidTem'])
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

// ── Chống MÃ RÁC và chống ĐẾM HAI LẦN (user 21/08: quét 15 mã vạch mà app hiện 20) ──────────
// (a) 1D không có mã sửa lỗi ⇒ vạch mờ đọc ra số KHÔNG CÓ THẬT. Đo trên khung mờ 1,6px: mặc định
//     zxing (minLineCount 2) sinh rác `0944707820120`; đặt 3 thì rác về 0, không mất mã thật nào.
// (b) CÙNG một tem UPC-A có khung trả 12 số, khung khác trả 13 số có '0' dẫn đầu ⇒ đếm theo chuỗi
//     thô là 1 tem ra 2 dòng. Khoá dedupe phải chuẩn hoá về GTIN-13 (`scanKey`).
{
  const eng = readFileSync(ENGINE_SRC, 'utf8')
  const mlc = /ZXING_MIN_LINE_COUNT = (\d+)/.exec(eng)
  check('[12] Ngưỡng đồng thuận dòng ≥ 3 (chặn mã vạch rác từ vạch mờ)', !!mlc && Number(mlc[1]) >= 3,
    `ZXING_MIN_LINE_COUNT = ${mlc?.[1] ?? 'không khai'}`)
  const users = ['src/utils/scanEngine.ts', 'src/pages/wms/MultiScanTest.tsx']
    .filter(f => readFileSync(join(FE, f), 'utf8').includes('minLineCount'))
  check('[13] Cả 2 đường quét (luồng thật + quét loạt) đều áp ngưỡng đó', users.length === 2, users.join(', '))

  // scanKey: nạp từ chính utils/qr.ts (một nguồn) rồi thử các ca thật
  const m = await loadTs(['src/utils/qr.ts'], ['scanKey'])
  const upcaSame = m.scanKey('036000291452') === m.scanKey('0036000291452')
  check('[14] UPC-A 12 số và EAN-13 13 số của CÙNG tem ra CÙNG khoá', upcaSame,
    `${m.scanKey('036000291452')} vs ${m.scanKey('0036000291452')}`)
  const keep = ['96385074', 'SKU-100294', '080826_510000187_1_122_98266_B', '50033;1;TA260705A018;05/07/2026;05/03/2027']
  const changed = keep.filter(s => m.scanKey(s) !== s)
  check('[15] Mã 8 số, mã chữ và tem pallet GIỮ NGUYÊN (không gộp oan)', changed.length === 0,
    changed.length ? `bị đổi: ${changed.join(' | ')}` : '4 mẫu giữ nguyên')
}

// ── BẢN ĐỌC SAI cùng ô phải bị gỡ khỏi danh sách (ca THẬT của user 21/08) ─────────────────────
// Quét lưới 15 mã vạch, app hiện 18 dòng: 3 dòng dư đều là bản đọc sai của chính mã thật, ở ĐÚNG ô
// đó, và đều thoả checksum nên checksum không loại được:
//   96385074 (46×) → 06384074 (5×) · 4006381333931 (26×) → 0086301333931 (3×)
//   0012345678905 (42×) → 0012344672904 (2×)
// Kiểm bằng chuỗi khung mô phỏng đúng tỉ lệ đó (logic thuần ở utils/scanDedupe).
{
  // Nạp CHÍNH nguồn TS của app (một nguồn sự thật) — transpile bằng esbuild của frontend thay vì
  // bóc type bằng regex (regex vỡ mỗi lần code đổi, và vỡ kiểu SyntaxError khó lần).
  const mod = await loadTs(['src/utils/qr.ts', 'src/utils/scanDedupe.ts'],
    ['registerHit', 'sweepMisreads', 'scanKey', 'MIN_HITS_1D'])
  // Trang quét gọi sweepMisreads sau MỖI khung → mô phỏng đúng vậy
  const frame = (map, text, points, now) => { mod.registerHit(map, { text, points, now }); mod.sweepMisreads(map, now) }

  // 2 ô cách nhau; mỗi ô: mã thật thấy nhiều lần, bản đọc sai thấy vài lần ở CÙNG vùng
  const boxA = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 160 }, { x: 100, y: 160 }]
  const boxB = [{ x: 700, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 160 }, { x: 700, y: 160 }]
  const map = new Map()
  let t = 1_000_000
  const feed = (text, points, times) => { for (let i = 0; i < times; i++) frame(map, text, points, (t += 60)) }

  feed('96385074', boxA, 20)            // mã thật ô A
  feed('SKU-100294', boxB, 12)          // mã thật ô B
  feed('06384074', boxA, 5)             // bản đọc sai của ô A
  feed('96385074', boxA, 26)            // tiếp tục thấy mã thật
  const keys = [...map.keys()]
  check('[16] Bản đọc sai cùng ô bị gỡ khỏi danh sách', !keys.includes('06384074'), `còn: ${keys.join(', ')}`)
  check('[17] Mã thật của cả 2 ô vẫn còn (không dọn oan)',
    keys.includes('96385074') && keys.includes('SKU-100294'), keys.join(', '))

  // Bản đọc sai xuất hiện TRƯỚC mã thật ⇒ vẫn phải giữ được mã thật (không được chặn theo vị trí)
  const map2 = new Map()
  t = 2_000_000
  const feed2 = (text, points, times) => { for (let i = 0; i < times; i++) frame(map2, text, points, (t += 60)) }
  feed2('06384074', boxA, 5)
  feed2('96385074', boxA, 30)
  const k2 = [...map2.keys()]
  check('[18] Bản đọc sai đến TRƯỚC vẫn không khoá được mã thật', k2.includes('96385074'), k2.join(', '))
  check('[19] …và chính nó bị gỡ khi mã thật vượt hẳn', !k2.includes('06384074'), k2.join(', '))

  // Hai tem THẬT ở hai ô khác nhau, số lần thấy lệch nhiều → KHÔNG được dọn nhau
  const map3 = new Map()
  t = 3_000_000
  const feed3 = (text, points, times) => { for (let i = 0; i < times; i++) frame(map3, text, points, (t += 60)) }
  feed3('8934567890120', boxA, 40)
  feed3('5901234123457', boxB, 4)
  const k3 = [...map3.keys()]
  check('[20] Hai tem ở HAI ô khác nhau không dọn nhau dù lệch 10×', k3.length === 2, k3.join(', '))

  // Cùng tem UPC-A trả 2 dạng chuỗi ⇒ chỉ 1 dòng
  const map4 = new Map()
  t = 4_000_000
  mod.registerHit(map4, { text: '036000291452', points: boxA, now: t + 60 })
  mod.registerHit(map4, { text: '0036000291452', points: boxA, now: t + 120 })
  check('[21] UPC-A 12 số + EAN-13 13 số của cùng tem = 1 dòng', map4.size === 1, `${map4.size} dòng`)

  // ⭐ CA LỖI USER BÁO 21/08 vòng 2 ("quét 14 ra 17"): bản đọc sai sinh ra ở KHUNG CUỐI, đúng lúc
  // tem sắp rời khung ⇒ SAU ĐÓ KHÔNG CÒN lượt nào của mã thật. Dọn-lúc-ghi-nhận cần lượt đó để
  // kích hoạt nên dòng rác sống tới hết phiên. Phải dọn được mà không cần mã thật thấy thêm.
  const map5 = new Map()
  t = 5_000_000
  const feed5 = (text, points, times) => { for (let i = 0; i < times; i++) frame(map5, text, points, (t += 60)) }
  feed5('4006381333931', boxA, 26)      // mã thật, còn trong khung
  feed5('0086301333931', boxA, 3)       // bản đọc sai ở khung cuối… rồi tem rời khung, hết lượt
  const k5 = [...map5.keys()]
  check('[22] Bản đọc sai ở KHUNG CUỐI vẫn bị dọn (mã thật không cần thấy thêm)',
    k5.length === 1 && k5[0] === '4006381333931', k5.join(', '))

  // Dọn KHÔNG phụ thuộc thứ tự: cùng dữ liệu, đảo mã nào tới trước → kết quả phải như nhau
  const twoWay = (firstKey, firstHits, secondKey, secondHits) => {
    const m = new Map()
    t = 6_000_000
    for (let i = 0; i < firstHits; i++) frame(m, firstKey, boxA, (t += 60))
    for (let i = 0; i < secondHits; i++) frame(m, secondKey, boxA, (t += 60))
    return [...m.keys()]
  }
  const fwd = twoWay('96385074', 30, '06384074', 4)
  const rev = twoWay('06384074', 4, '96385074', 30)
  check('[23] Kết quả dọn giống nhau dù mã nào tới trước', fwd.length === 1 && rev.length === 1
    && fwd[0] === '96385074' && rev[0] === '96385074', `xuôi=[${fwd}] ngược=[${rev}]`)

  // Ngưỡng HIỆN của mã 1D: 1D không có mã sửa lỗi nên 1 khung nhiễu cũng ra số thoả checksum ⇒
  // phải cần ≥3 lần thấy mới hiện. Hạ về 1–2 là mở lại đúng cửa cho dòng rác đếm sai số lượng.
  check('[24] Mã 1D phải thấy ≥3 lần mới được hiện', mod.MIN_HITS_1D >= 3, `MIN_HITS_1D=${mod.MIN_HITS_1D}`)
}

console.log(`\n[SCAN-FORMATS] ${pass}/${pass + fail} PASS`)
process.exit(fail ? 1 : 0)
