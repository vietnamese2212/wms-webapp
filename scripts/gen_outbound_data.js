/**
 * Generate Outbound_Test_Data.xlsx — 50 xe test (Xe pallet / Container / Xá)
 * mỗi xe ~3000 thùng, 2 mã hàng: Ba Vì 180 (cpp=110) và Ba Vì 110 (cpp=140)
 * Run: node scripts/gen_outbound_data.js   (từ thư mục gốc project)
 */

const path = require('path')
const BASE = path.join(__dirname, '..', 'backend')
const XLSX = require(path.join(BASE, 'node_modules', 'xlsx'))

// ─── Master data (hardcoded từ DB) ───────────────────────────────
const MAT_180 = { code: '510000127', type: 'Thành phẩm', cpp: 110 }
const MAT_110 = { code: '510000126', type: 'Thành phẩm', cpp: 140 }

const NPPS = [
  'NPP Thăng Long','NPP Sông Hồng','NPP Đông Bắc','NPP Tây Bắc',
  'NPP Miền Trung','NPP Huế','NPP Vinh','NPP Nghệ An',
  'NPP Miền Nam 1','NPP Bình Dương','NPP Cần Thơ','NPP Đồng Nai',
  'NPP Đà Nẵng','MT Hà Nội','MT Hồ Chí Minh',
]
const LOAI_XUAT  = ['Nội địa GT','Nội địa MT','Kênh khác']
const CS_LIST    = ['CS01','CS02','CS03','CS04','CS05']

// ─── Vehicles plan ────────────────────────────────────────────────
// 20 Xe pallet · 20 Xe container · 10 Xe xá = 50 vehicles
const VEHICLES = []
let deliverySeq = 80100001
let nppIdx = 0

function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function pick(arr)      { return arr[Math.floor(Math.random() * arr.length)] }

// Dates: May 12–20, 2026 (9 days)
const DATES = []
for (let d = 12; d <= 20; d++)
  DATES.push(`${d < 10 ? '0'+d : d}/05/2026`)
const DATE_CODES = DATES.map(dt => dt.slice(0,2) + '0526')

function addVehicle(type, dvvt, cartonTarget) {
  const dateIdx   = VEHICLES.length % DATES.length
  const date      = DATES[dateIdx]
  const dateCode  = DATE_CODES[dateIdx]
  const typeCode  = type === 'P' ? 'P' : type === 'C' ? 'C' : 'X'
  const seq       = String(VEHICLES.length + 1).padStart(2, '0')
  const groupCode = `${dateCode}_BV_${typeCode}${seq}`
  const loaiXuat  = pick(LOAI_XUAT)
  const doCount   = rnd(3, 5)
  const rows      = []

  let remaining = cartonTarget
  for (let d = 0; d < doCount; d++) {
    const doCode  = String(deliverySeq++)
    const npp     = NPPS[nppIdx++ % NPPS.length]
    const items   = rnd(2, 4)
    const perDO   = Math.round(remaining / (doCount - d))

    for (let it = 0; it < items; it++) {
      const mat      = (it % 2 === 0) ? MAT_180 : MAT_110
      const isLast   = (it === items - 1)
      const cartons  = isLast
        ? Math.round(perDO / items)
        : rnd(150, 500)
      const pallets  = +(cartons / mat.cpp).toFixed(2)

      rows.push({
        'Kho xuất':       'Kho Ba Vì',
        'Loại kho':       'Kho TP',
        'Số xe':          groupCode,
        'Ngày xuất':      date,
        'DVVT':           dvvt,
        'Delivery':       doCode,
        'Tên NPP':        npp,
        'Material':       mat.code,
        'Material_type':  mat.type,
        'Thùng':          cartons,
        'Hộp':            0,
        'Tải':            +(cartons * (mat.code === MAT_180.code ? 9.82 : 6.1) / mat.cpp).toFixed(1),
        'Nhặt lẻ':        0,
        'Pallet':         pallets,
        'Loại xuất':      loaiXuat,
        'HEADER TEXT':    '',
        'Batch_Yêu cầu':  '',
        '%Date_Yêu cầu':  '',
        'CS phụ trách':   pick(CS_LIST),
      })
    }
    remaining = Math.max(0, remaining - perDO)
  }
  VEHICLES.push({ groupCode, rows })
}

// Generate vehicles
for (let i = 0; i < 20; i++) addVehicle('P','Xe tải pallet', rnd(2700,3200))
for (let i = 0; i < 20; i++) addVehicle('C','Xe container',  rnd(3000,3800))
for (let i = 0; i < 10; i++) addVehicle('X','Xe xá',         rnd(2400,2800))

// ─── Build Excel rows ─────────────────────────────────────────────
const allRows = VEHICLES.flatMap(v => v.rows)

const headers = [
  'Kho xuất','Loại kho','Số xe','Ngày xuất','DVVT',
  'Delivery','Tên NPP','Material','Material_type',
  'Thùng','Hộp','Tải','Nhặt lẻ','Pallet',
  'Loại xuất','HEADER TEXT','Batch_Yêu cầu','%Date_Yêu cầu','CS phụ trách',
]

const wsData = [
  headers,
  ...allRows.map(r => headers.map(h => r[h] ?? '')),
]

const ws = XLSX.utils.aoa_to_sheet(wsData)
ws['!cols'] = [
  {wch:14},{wch:10},{wch:18},{wch:12},{wch:14},
  {wch:10},{wch:22},{wch:12},{wch:14},
  {wch:8},{wch:6},{wch:8},{wch:8},{wch:8},
  {wch:14},{wch:14},{wch:14},{wch:14},{wch:10},
]

const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'Outbound')

// Summary sheet
const summaryData = [
  ['Loại xe','Số xe','Tổng thùng'],
  ...VEHICLES.map(v => {
    const total = v.rows.reduce((s,r) => s + Number(r['Thùng']), 0)
    const dvvt  = v.rows[0]['DVVT']
    return [dvvt, v.groupCode, total]
  })
]
const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
wsSummary['!cols'] = [{wch:16},{wch:18},{wch:12}]
XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary')

const outPath = path.join(__dirname, '..', 'Outbound_Test_Data.xlsx')
XLSX.writeFile(wb, outPath)

const totalCartons = VEHICLES.flatMap(v=>v.rows).reduce((s,r)=>s+Number(r['Thùng']),0)
console.log(`Generated ${VEHICLES.length} vehicles · ${allRows.length} rows · ${totalCartons.toLocaleString()} tổng thùng`)
console.log(`Output: Outbound_Test_Data.xlsx`)
