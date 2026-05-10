/**
 * Generate Outbound_Data_v2.xlsx — queries materials từ Supabase
 * 50 GDOs ngày 10/05/2026 + 20 GDOs ngày 12/05/2026 = 70 tổng
 * Loại xe: Xe tải pallet / Xe container / Xe xá
 * 5% rows Nhặt lẻ=1 (số thùng không chẵn pallet)
 *
 * Run: node scripts/gen_outbound_v2.js   (từ thư mục gốc project)
 */
const path = require('path')
const BASE = path.join(__dirname, '..', 'backend')
const XLSX   = require(path.join(BASE, 'node_modules', 'xlsx'))
const dotenv = require(path.join(BASE, 'node_modules', 'dotenv'))
const { createClient } = require(path.join(BASE, 'node_modules', '@supabase', 'supabase-js'))

dotenv.config({ path: path.join(BASE, '.env') })
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/^<|>$/g, '')
const sb  = createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false } })

const NPPS = [
  'NPP Thăng Long','NPP Sông Hồng','NPP Đông Bắc','NPP Tây Bắc',
  'NPP Miền Trung','NPP Huế','NPP Vinh','NPP Nghệ An',
  'NPP Miền Nam 1','NPP Bình Dương','NPP Cần Thơ','NPP Đồng Nai',
  'NPP Đà Nẵng','MT Hà Nội','MT Hồ Chí Minh','NPP Hải Phòng',
  'NPP Quảng Ninh','NPP Thanh Hóa','NPP Vũng Tàu','NPP Long An',
]
const LOAI_XUAT = ['Nội địa GT','Nội địa MT','Kênh hiện đại','Xuất khẩu']
const CS_LIST   = ['CS01','CS02','CS03','CS04','CS05']

function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function pick(arr)     { return arr[Math.floor(Math.random() * arr.length)] }

async function main() {
  const { data: mats, error: me } = await sb
    .from('Material')
    .select('id, material_code, material_description, cartons_per_pallet, weight_kg')
    .eq('category', 'Thành phẩm')
    .eq('is_active', true)
    .not('cartons_per_pallet', 'is', null)
    .order('material_code')
  if (me || !mats?.length) {
    console.error('Material error:', me?.message || 'no Thành phẩm with cpp')
    process.exit(1)
  }
  console.log(`Loaded ${mats.length} materials`)

  let deliverySeq = 80200001
  let nppIdx      = 0
  let globalRow   = 0   // for 5% Nhặt lẻ cycle
  const VEHICLES  = []

  function buildGroup(dateStr, dateCode, typeCode, dvvt, targetCartons, idxWithinType) {
    const seq        = String(idxWithinType + 1).padStart(2, '0')
    const group_code = `${dateCode}_BV_${typeCode}${seq}`
    const loaiXuat   = pick(LOAI_XUAT)
    const doCount    = rnd(3, 5)
    const rows       = []

    let remaining = targetCartons
    for (let d = 0; d < doCount; d++) {
      const delivery  = String(deliverySeq++)
      const npp       = NPPS[nppIdx++ % NPPS.length]
      const itemCount = rnd(1, 3)
      const perDO     = Math.round(remaining / (doCount - d))

      for (let it = 0; it < itemCount; it++) {
        const mat     = mats[globalRow % mats.length]
        const cpp     = mat.cartons_per_pallet
        const isLoose = (globalRow % 20 === 19)  // every 20th = 5%
        globalRow++

        let cartons
        if (isLoose) {
          // Nhặt lẻ: add partial cartons on top of full pallets
          const fullPallets = Math.max(0, Math.floor(perDO / itemCount / cpp) - 1)
          cartons = fullPallets * cpp + rnd(1, cpp - 1)
          if (cartons <= 0) cartons = rnd(1, cpp - 1)
        } else {
          const pallets = Math.max(1, Math.round(perDO / itemCount / cpp))
          cartons = pallets * cpp
        }

        const pallets = +(cartons / cpp).toFixed(2)
        const weight  = mat.weight_kg
          ? +(cartons * mat.weight_kg / 1000).toFixed(2)
          : 0

        rows.push({
          'Kho xuất':      'Kho Ba Vì',
          'Loại kho':      'Kho TP',
          'Số xe':         group_code,
          'Ngày xuất':     dateStr,
          'DVVT':          dvvt,
          'Delivery':      delivery,
          'Tên NPP':       npp,
          'Material':      mat.material_code,
          'Material_type': 'Thành phẩm',
          'Thùng':         cartons,
          'Hộp':           0,
          'Tải':           weight,
          'Nhặt lẻ':       isLoose ? 1 : 0,
          'Pallet':        pallets,
          'Loại xuất':     loaiXuat,
          'HEADER TEXT':   '',
          'Batch_Yêu cầu': '',
          '%Date_Yêu cầu': '',
          'CS phụ trách':  pick(CS_LIST),
        })
      }
      remaining = Math.max(0, remaining - perDO)
    }
    VEHICLES.push({ group_code, rows })
  }

  // ─── 10/05/2026 — 50 GDOs ────────────────────────────────────
  // 25 Xe tải pallet · 15 Container · 10 Xe xá
  for (let i = 0; i < 25; i++) buildGroup('10/05/2026','100526','P','Xe tải pallet', rnd(2700,3500), i)
  for (let i = 0; i < 15; i++) buildGroup('10/05/2026','100526','C','Xe container',  rnd(3500,5000), i)
  for (let i = 0; i < 10; i++) buildGroup('10/05/2026','100526','X','Xe xá',         rnd(2000,2800), i)

  // ─── 12/05/2026 — 20 GDOs ────────────────────────────────────
  // 10 Xe tải pallet · 7 Container · 3 Xe xá
  for (let i = 0; i < 10; i++) buildGroup('12/05/2026','120526','P','Xe tải pallet', rnd(2700,3500), i)
  for (let i = 0; i < 7;  i++) buildGroup('12/05/2026','120526','C','Xe container',  rnd(3500,5000), i)
  for (let i = 0; i < 3;  i++) buildGroup('12/05/2026','120526','X','Xe xá',         rnd(2000,2800), i)

  // ─── Build Excel ──────────────────────────────────────────────
  const headers = [
    'Kho xuất','Loại kho','Số xe','Ngày xuất','DVVT',
    'Delivery','Tên NPP','Material','Material_type',
    'Thùng','Hộp','Tải','Nhặt lẻ','Pallet',
    'Loại xuất','HEADER TEXT','Batch_Yêu cầu','%Date_Yêu cầu','CS phụ trách',
  ]
  const allRows = VEHICLES.flatMap(v => v.rows)
  const wsData  = [headers, ...allRows.map(r => headers.map(h => r[h] ?? ''))]
  const ws      = XLSX.utils.aoa_to_sheet(wsData)
  ws['!cols']   = [
    {wch:14},{wch:10},{wch:20},{wch:12},{wch:16},
    {wch:10},{wch:22},{wch:12},{wch:14},
    {wch:8},{wch:6},{wch:8},{wch:8},{wch:8},
    {wch:14},{wch:14},{wch:14},{wch:14},{wch:10},
  ]

  // Summary
  const sumData = [
    ['Số xe','Ngày','DVVT','Tổng thùng','Số DO'],
    ...VEHICLES.map(v => {
      const total   = v.rows.reduce((s, r) => s + Number(r['Thùng']), 0)
      const dvvt    = v.rows[0]?.['DVVT'] ?? ''
      const date    = v.rows[0]?.['Ngày xuất'] ?? ''
      const doCount = new Set(v.rows.map(r => r['Delivery'])).size
      return [v.group_code, date, dvvt, total, doCount]
    }),
  ]
  const wsSummary = XLSX.utils.aoa_to_sheet(sumData)
  wsSummary['!cols'] = [{wch:22},{wch:12},{wch:16},{wch:12},{wch:8}]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Outbound')
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary')

  const outPath = path.join(__dirname, '..', 'Outbound_Data_v2.xlsx')
  XLSX.writeFile(wb, outPath)

  const totalCartons = allRows.reduce((s, r) => s + Number(r['Thùng']), 0)
  const looseCount   = allRows.filter(r => r['Nhặt lẻ'] === 1).length
  console.log(`\nGenerated ${VEHICLES.length} GDOs · ${allRows.length} rows · ${totalCartons.toLocaleString()} tổng thùng`)
  console.log(`Nhặt lẻ: ${looseCount} rows (${(looseCount / allRows.length * 100).toFixed(1)}%)`)
  console.log(`Output: Outbound_Data_v2.xlsx`)
}

main().catch(e => { console.error(e); process.exit(1) })
