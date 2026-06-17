/**
 * Import nhân viên từ Employee_Template.xlsx vào Supabase.
 * Run: cd backend && NODE_PATH="$(pwd)/node_modules" node ../scripts/import_employees.js ../Employee_Template.xlsx
 * (chạy từ backend để đọc .env; NODE_PATH để tìm xlsx/pg/bcrypt trong backend/node_modules)
 *
 * - chuc_danh / kho khớp tên trong DB; kho nhiều cái cách nhau dấu phẩy
 * - Tạo Employee (password bcrypt) + UserWarehouseAccess cho từng kho
 * - Bỏ qua dòng trùng ma_nhan_vien / ten_dang_nhap (đã tồn tại) và báo lại
 */
const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')
const bcrypt = require('bcrypt')
const { randomUUID } = require('crypto')
const { Client } = require('pg')

const env = fs.readFileSync('.env', 'utf8')
const url = (env.match(/DATABASE_URL=(.*)/) || [])[1].trim().replace(/^"|"$/g, '')
const file = path.resolve(process.argv[2] || '../Employee_Template.xlsx')
const ALL_CATS = ['Thành phẩm', 'NVL', 'POSM', 'Bao bì']
const truthy = v => ['x', '1', 'true', 'có', 'yes'].includes(String(v ?? '').trim().toLowerCase())
const S = v => String(v ?? '').trim()

;(async () => {
  if (!fs.existsSync(file)) { console.error('Không thấy file:', file); process.exit(1) }
  const wb = XLSX.readFile(file)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['NhanVien'] || wb.Sheets[wb.SheetNames[0]], { defval: '' })

  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const jtMap = new Map((await c.query(`SELECT id, lower(name) n FROM "JobTitle"`)).rows.map(r => [r.n, r.id]))
  const whMap = new Map((await c.query(`SELECT id, lower(name) n FROM "Warehouse"`)).rows.map(r => [r.n, r.id]))
  const deptMap = new Map((await c.query(`SELECT id, lower(name) n FROM "Department"`)).rows.map(r => [r.n, r.id]))
  const existCode = new Set((await c.query(`SELECT lower(employee_code) x FROM "Employee" WHERE employee_code IS NOT NULL`)).rows.map(r => r.x))
  const existLogin = new Set((await c.query(`SELECT lower(email) x FROM "Employee" WHERE email IS NOT NULL`)).rows.map(r => r.x))

  let ok = 0; const errs = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], ln = i + 2 // dòng excel (1=header)
    const code = S(r.ma_nhan_vien), name = S(r.ho_ten), login = S(r.ten_dang_nhap), pass = S(r.mat_khau)
    const jtName = S(r.chuc_danh), khoRaw = S(r.kho)
    if (!code && !name && !login) continue // dòng trống
    if (!code || !name || !login || !pass || !jtName || !khoRaw) { errs.push(`Dòng ${ln}: thiếu cột bắt buộc`); continue }
    if (existCode.has(code.toLowerCase())) { errs.push(`Dòng ${ln}: ma_nhan_vien "${code}" đã tồn tại`); continue }
    if (existLogin.has(login.toLowerCase())) { errs.push(`Dòng ${ln}: ten_dang_nhap "${login}" đã tồn tại`); continue }
    const jtId = jtMap.get(jtName.toLowerCase())
    if (!jtId) { errs.push(`Dòng ${ln}: chuc_danh "${jtName}" không khớp danh mục`); continue }
    const khoNames = khoRaw.split(',').map(S).filter(Boolean)
    const whIds = []
    let bad = null
    for (const k of khoNames) { const id = whMap.get(k.toLowerCase()); if (!id) { bad = k; break } whIds.push(id) }
    if (bad) { errs.push(`Dòng ${ln}: kho "${bad}" không khớp danh mục`); continue }

    const deptName = S(r.bo_phan)
    let deptId = null
    if (deptName) {
      deptId = deptMap.get(deptName.toLowerCase())
      if (!deptId) { errs.push(`Dòng ${ln}: bo_phan "${deptName}" không khớp danh mục Phòng ban`); continue }
    }
    const scope = S(r.pham_vi_kho).toUpperCase() === 'NATIONAL' ? 'NATIONAL' : 'ASSIGNED'
    const now = new Date().toISOString()
    const empId = randomUUID()
    try {
      await c.query('BEGIN')
      await c.query(
        `INSERT INTO "Employee"(id,name,employee_code,email,password,job_title_id,warehouse_id,warehouse_scope,department_id,phone,is_driver,allowed_categories,is_active,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,$13)`,
        [empId, name, code, login, await bcrypt.hash(pass, 10), jtId, whIds[0], scope,
         deptId, S(r.sdt) || null, truthy(r.la_tai_xe), ALL_CATS, now]
      )
      for (const wid of whIds)
        await c.query(`INSERT INTO "UserWarehouseAccess"(id,employee_id,warehouse_id) VALUES($1,$2,$3)`, [randomUUID(), empId, wid])
      await c.query('COMMIT')
      existCode.add(code.toLowerCase()); existLogin.add(login.toLowerCase())
      ok++
    } catch (e) { await c.query('ROLLBACK'); errs.push(`Dòng ${ln}: lỗi DB — ${e.message}`) }
  }
  await c.end()
  console.log(`\n✓ Import xong: ${ok} nhân viên.`)
  if (errs.length) { console.log(`\n⚠ ${errs.length} dòng lỗi/bỏ qua:`); errs.forEach(e => console.log('   -', e)) }
})().catch(e => { console.error('Lỗi:', e.message); process.exit(1) })
