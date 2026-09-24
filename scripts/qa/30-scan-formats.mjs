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

  // ⭐ Engine mặc định của quét LOẠT phải là WASM (zxing). Native = BarcodeDetector đi qua API
  // barcode ĐỜI CŨ của Play Services: bắt QR tốt nhưng trả RẤT ÍT mã 1D khi nhiều mã cùng khung
  // (user đo máy thật: 15 tem chỉ ra 1–2). Trang này KHÔNG có lưới zxing đỡ như luồng quét đơn,
  // nên ưu tiên native = rơi vào nhánh kém nhất mà không có lỗi nào để lần ra.
  const eng = /loadSettings\(\)\.engine \?\? '(native|wasm)'/.exec(ms)
  check('[12] Engine mặc định của trang quét loạt = WASM (native bắt rất ít mã 1D)',
    eng?.[1] === 'wasm', `mặc định = ${eng?.[1] ?? 'không tìm thấy'}`)
  check('[13] Lựa chọn engine được NHỚ giữa các lần mở trang (khỏi âm thầm về native)',
    /saveSettings\(\{ engine: next \}\)/.test(ms))

  // ⭐ Bài học 21/08 (clip user): đổi mặc định `tryHarder` thành true nhưng máy user đã LƯU false
  // ⇒ `?? true` không bao giờ chạy, quét 9 mã chỉ ra 5 mà không có dấu hiệu gì. Hai lớp gác:
  //   (a) khóa localStorage phải được BUMP khi đổi mặc định (v2+);
  //   (b) trạng thái TẮT phải hiện cảnh báo trên màn (không im lặng).
  const key = /const SETTINGS_KEY = 'multi_scan_settings_v(\d+)'/.exec(ms)
  check('[14] Khóa lưu thiết lập đã bump ≥ v2 (mặc định mới mới có tác dụng trên máy đã dùng)',
    !!key && Number(key[1]) >= 2, `khóa = v${key?.[1] ?? '?'}`)
  check('[15] Tắt "quét kỹ" phải hiện CẢNH BÁO trên màn (không im lặng)',
    /!tryHarder && \(/.test(ms) && /TẮT quét kỹ/.test(ms))
  check('[16] Có nút đưa về bộ thiết lập tốt nhất (thoát tổ hợp knob xấu)',
    /function resetToBest/.test(ms) && /Đặt lại tốt nhất/.test(ms))
}

// ── Chống MÃ RÁC và chống ĐẾM HAI LẦN (user 21/08: quét 15 mã vạch mà app hiện 20) ──────────
// (a) 1D không có mã sửa lỗi ⇒ vạch mờ đọc ra số KHÔNG CÓ THẬT. Đo trên khung mờ 1,6px: mặc định
//     zxing (minLineCount 2) sinh rác `0944707820120`; đặt 3 thì rác về 0, không mất mã thật nào.
// (b) CÙNG một tem UPC-A có khung trả 12 số, khung khác trả 13 số có '0' dẫn đầu ⇒ đếm theo chuỗi
//     thô là 1 tem ra 2 dòng. Khoá dedupe phải chuẩn hoá về GTIN-13 (`scanKey`).
{
  const eng = readFileSync(ENGINE_SRC, 'utf8')
  const mlc = /ZXING_MIN_LINE_COUNT = (\d+)/.exec(eng)
  check('[17] Ngưỡng đồng thuận dòng ≥ 3 (chặn mã vạch rác từ vạch mờ)', !!mlc && Number(mlc[1]) >= 3,
    `ZXING_MIN_LINE_COUNT = ${mlc?.[1] ?? 'không khai'}`)
  const users = ['src/utils/scanEngine.ts', 'src/pages/wms/MultiScanTest.tsx']
    .filter(f => readFileSync(join(FE, f), 'utf8').includes('minLineCount'))
  check('[18] Cả 2 đường quét (luồng thật + quét loạt) đều áp ngưỡng đó', users.length === 2, users.join(', '))

  // scanKey: nạp từ chính utils/qr.ts (một nguồn) rồi thử các ca thật
  const m = await loadTs(['src/utils/qr.ts'], ['scanKey'])
  const upcaSame = m.scanKey('036000291452') === m.scanKey('0036000291452')
  check('[19] UPC-A 12 số và EAN-13 13 số của CÙNG tem ra CÙNG khoá', upcaSame,
    `${m.scanKey('036000291452')} vs ${m.scanKey('0036000291452')}`)
  const keep = ['96385074', 'SKU-100294', '080826_510000187_1_122_98266_B', '50033;1;TA260705A018;05/07/2026;05/03/2027']
  const changed = keep.filter(s => m.scanKey(s) !== s)
  check('[20] Mã 8 số, mã chữ và tem pallet GIỮ NGUYÊN (không gộp oan)', changed.length === 0,
    changed.length ? `bị đổi: ${changed.join(' | ')}` : '4 mẫu giữ nguyên')
}

// ── GOM MÃ TRONG PHIÊN QUÉT: chỉ ĐẾM, KHÔNG tự xoá dòng nào ───────────────────────────────────
// Bối cảnh (21/08): mã vạch 1D không có mã sửa lỗi nên khung mờ ra BẢN ĐỌC SAI của chính tem đang
// nhìn mà vẫn thoả checksum (user: quét 15 ra 18). Đã thử ĐOÁN bản đọc sai theo VỊ TRÍ qua 2 vòng
// vá, cả 2 lần đều LÀM MẤT MÃ THẬT — vòng 2: quét lần lượt 3 tem giữa màn chỉ ra 2, tem thứ hai bị
// xoá lại mỗi khung. "Trùng vị trí" KHÔNG phân biệt được bản-đọc-sai với tem-khác-đưa-vào-cùng-chỗ,
// vì trong dữ liệu hai việc đó y như nhau. Mất mã thật tệ hơn hiện thêm dòng rác (rác thì người
// quét thấy và xoá được; mã thiếu thì không ai biết mà tìm).
// ⇒ Luật CHỐT: gom + đếm, dòng ít lần thấy thì GẮN CỜ "chưa chắc" cho người quét soi. Các phép
//   kiểm dưới đây gác chiều NGƯỢC — không được để ai thêm lại việc tự xoá.
{
  const mod = await loadTs(['src/utils/qr.ts', 'src/utils/scanDedupe.ts'],
    ['registerHit', 'scanKey', 'MIN_HITS_1D'])
  const boxA = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 160 }, { x: 100, y: 160 }]
  const boxB = [{ x: 700, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 160 }, { x: 700, y: 160 }]
  let t = 1_000_000
  const feed = (map, text, box, times) => {
    for (let i = 0; i < times; i++) { mod.registerHit(map, { text, points: box, now: t }); t += 120 }
  }
  const dump = m => [...m.entries()].map(([k, e]) => `${k}=${e.hits}×`).join(' , ')

  // ⭐ CA HỒI QUY user báo: quét LẦN LƯỢT từng tem, tem nào cũng đặt GIỮA MÀN (cùng vùng ảnh).
  const seq = new Map()
  feed(seq, '8934567890120', boxA, 20)
  t += 300
  feed(seq, '5901234123457', boxA, 12)
  t += 300
  feed(seq, '4006381333931', boxA, 12)
  check('[21] Quét LẦN LƯỢT 3 tem ở CÙNG chỗ giữa màn → hiện đủ 3 (không xoá mã thật)',
    seq.size === 3, dump(seq))

  // Ngay cả chuỗi yếu hẳn (bản đọc sai thật) cũng KHÔNG được tự xoá — chỉ đếm, để màn gắn cờ.
  // Đây là chốt CẤM TÁI SINH việc đoán-rồi-xoá.
  const mis = new Map()
  t = 2_000_000
  feed(mis, '96385074', boxA, 40)
  feed(mis, '06384074', boxA, 3)     // bản đọc sai cùng ô, kém 13 lần
  check('[22] Chuỗi yếu KHÔNG bị tự xoá (chỉ đếm — màn hình gắn cờ "chưa chắc")',
    mis.size === 2 && mis.get('06384074')?.hits === 3, dump(mis))
  check('[23] Số lần thấy phân biệt được rác với mã thật (đủ căn cứ để gắn cờ)',
    mis.get('96385074').hits >= mis.get('06384074').hits * 6)

  // Hai tem ở hai vùng khác nhau: hiển nhiên giữ cả hai
  const two = new Map()
  t = 3_000_000
  feed(two, '8934567890120', boxA, 30)
  feed(two, '5901234123457', boxB, 3)
  check('[24] Hai tem ở HAI vùng khác nhau đều còn', two.size === 2, dump(two))

  // Cùng tem UPC-A trả 2 dạng chuỗi ⇒ 1 dòng (lớp gom DUY NHẤT còn lại — an toàn vì không xoá gì)
  const up = new Map()
  t = 4_000_000
  feed(up, '036000291452', boxA, 1)
  feed(up, '0036000291452', boxA, 1)
  check('[25] UPC-A 12 số + EAN-13 13 số của cùng tem = 1 dòng', up.size === 1, `${up.size} dòng`)

  // Ngưỡng hiện mã 1D: chặn "bóng ma" giải rác 1 khung, nhưng không cao tới mức mã thật lên chậm
  check('[26] Ngưỡng hiện mã 1D = 2 (chặn bóng ma 1 khung, không làm mã thật lên chậm)',
    mod.MIN_HITS_1D === 2, `MIN_HITS_1D=${mod.MIN_HITS_1D}`)

  // Chốt cứng: đường gom mã KHÔNG được có lệnh xoá khỏi danh sách
  const dedupeSrc = readFileSync(join(FE, 'src', 'utils', 'scanDedupe.ts'), 'utf8')
  check('[27] utils/scanDedupe không có lệnh xoá mã nào (map.delete)', !/\.delete\(/.test(dedupeSrc))
  const msSrc = readFileSync(join(FE, 'src', 'pages', 'wms', 'MultiScanTest.tsx'), 'utf8')
  check('[28] Trang quét loạt không gọi hàm dọn-đoán nào', !/sweepMisreads/.test(msSrc))
}
// ── LOẠI MÃ THEO TỪNG KHO (`Warehouse.scan_code_types`, 21/08) ────────────────────────────────
// Kiểm bằng ĐỌC THẬT: mỗi chế độ phải giải được đúng loại mã của nó và TRƯỢT loại bị tắt. Nếu chỉ
// so mảng format thì một hôm ai đó nối sai nhánh (vd 'QR' vẫn truyền cả tập) sẽ vẫn xanh.
{
  const mod = await loadTs(['src/utils/scanEngine.ts'], ['nativeFormatsFor', 'zxingFormatsFor'])
  const qrImg = (await writeBarcode('080826_510000187_1_122_98266_B', { format: 'QRCode', scale: 6 })).image
  const bcImg = (await writeBarcode('510000187', { format: 'Code128', scale: 6 })).image
  const read = async (img, t) => img
    ? (await readBarcodes(img, { formats: mod.zxingFormatsFor(t), tryHarder: true, tryRotate: true, maxNumberOfSymbols: 8 })).length
    : -1

  check('[29] Kho "Chỉ tem QR": đọc được QR, KHÔNG đọc mã vạch',
    (await read(qrImg, 'QR')) === 1 && (await read(bcImg, 'QR')) === 0)
  check('[30] Kho "Chỉ mã vạch": đọc được mã vạch, KHÔNG đọc QR',
    (await read(bcImg, 'BARCODE')) === 1 && (await read(qrImg, 'BARCODE')) === 0)
  check('[31] Kho "Cả hai": đọc được cả hai',
    (await read(qrImg, 'BOTH')) === 1 && (await read(bcImg, 'BOTH')) === 1)
  // Tra cấu hình trượt (kho lạ / chưa nạp danh mục) phải NỚI về cả hai — siết thì người quét đứng
  // trước camera "không ăn" mà không có gì để hiểu vì sao.
  check('[32] Không truyền cấu hình ⇒ mặc định đọc CẢ HAI (nới, không siết)',
    mod.zxingFormatsFor().length === mod.zxingFormatsFor('BOTH').length
    && mod.nativeFormatsFor().length === mod.nativeFormatsFor('BOTH').length)

  // Mọi màn quét PHẢI khai codeTypes — ràng buộc KIỂU (prop bắt buộc) là thứ chặn màn mới lọt,
  // ratchet tĩnh chỉ soi thêm cho chắc.
  const scanner = readFileSync(join(FE, 'src', 'components', 'shared', 'QRScanner.tsx'), 'utf8')
  check('[33] QRScanner bắt buộc khai codeTypes (thiếu = lỗi biên dịch, không im lặng)',
    /\n\s*codeTypes: ScanCodeTypes\s*\n/.test(scanner) && !/codeTypes\?:/.test(scanner))
  const carton = readFileSync(join(FE, 'src', 'components', 'wms', 'CartonScanSheet.tsx'), 'utf8')
  check('[34] Màn quét tem THÙNG cũng bắt buộc khai codeTypes',
    /\n\s*codeTypes: ScanCodeTypes\s*\n/.test(carton) && !/codeTypes\?:/.test(carton))
}

console.log(`\n[SCAN-FORMATS] ${pass}/${pass + fail} PASS`)
process.exit(fail ? 1 : 0)
