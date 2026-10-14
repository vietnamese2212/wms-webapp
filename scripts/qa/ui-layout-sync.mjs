/**
 * BỐ CỤC GIỐNG NHAU Ở MỌI CỠ MÀN MÁY TÍNH (luật 14/10, user: "màn 24 inch hiển thị khác — cần phải làm đồng bộ với các loại màn hình
 * trên máy tính, đó là yêu cầu của toàn app"; lớp lỗi C81).
 *
 * Mỗi trang menu nạp MỘT lần rồi đổi cỡ cửa sổ (không nạp lại — rẻ egress): 1280×800 · 1536×864 · 1920×1080, sidebar mở. Đo phía trên
 * bảng đầu tiên: số HÀNG control, đỉnh bảng (px), control nào đổi hàng giữa 1280 và 1920. Lệch ⇒ ⚠ + ảnh 1280 / 1920 vào thư mục tạm.
 * Đo 14/10 lần đầu: 36/38 trang khớp; lệch = Tối ưu vị trí (chip lọc 2 hàng ở 1280/1536, 1 hàng ở 1920) + Kết nối ERP (nút rớt hàng 2
 * ở 1280) + bàn ghép xe (đầu trang + thanh công cụ + chân bảng — trạng thái có kế hoạch, bộ đo mặc định không mở tới).
 *
 * CHỈ ĐO TRẠNG THÁI MẶC ĐỊNH của trang (chưa chọn kho / chưa mở kế hoạch…) — sửa màn có trạng thái sâu thì tự đo thêm bằng Playwright.
 * Không nằm trong run-all (CI không có trình duyệt). Chạy tay trước khi báo xong một thay đổi bố cục:
 *   PLAYWRIGHT_DIR=<thư mục có node_modules/playwright> node scripts/qa/ui-layout-sync.mjs [lọc-đường-dẫn]
 * Tài khoản: QA_ADMIN_EMAIL / QA_ADMIN_PASSWORD nếu có, không thì tự cấp tài khoản CI (ci-account.mjs) rồi xoá. Mật khẩu không in ra.
 * Thoát mã 1 khi có trang lệch.
 */
import { spawnSync } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createRequire } from 'module'

const ROOT = new URL('../../', import.meta.url)
const BASE = process.env.QA_BASE_URL || 'https://wms-webapp-git-dev-vietnamese2212s-projects.vercel.app'
const OUT = join(tmpdir(), 'wms-ui-layout-sync'); mkdirSync(OUT, { recursive: true })
const req = createRequire(process.env.PLAYWRIGHT_DIR ? join(process.env.PLAYWRIGHT_DIR, 'x.js') : import.meta.url)
let chromium
try { ({ chromium } = req('playwright')) } catch { console.error('Thiếu playwright — đặt PLAYWRIGHT_DIR tới thư mục có node_modules/playwright'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const PAGES = ['/', '/wms/directed', '/wms/control-tower', '/wms/warehouse-costs', '/wms/alerts', '/wms/outbound', '/wms/outbound/date-rules', '/wms/loosepicking',
  '/wms/fill', '/wms/inbound', '/wms/packing', '/wms/pallet-ops', '/wms/pallet-labels', '/wms/move-location', '/wms/stocktake', '/wms/slotting', '/wms/forklift',
  '/wms/multi-scan', '/tms/bookings', '/tms/dispatch', '/tms/freight', '/tms/gate', '/wms/weigh-tickets', '/hr/assignments', '/hr/attendance', '/wms/inventory',
  '/wms/outbound/scan-log', '/wms/trace', '/tms/reports', '/external/do-sap', '/masterdata/materials', '/masterdata/customers', '/wms/locations', '/hr/org',
  '/wms/settings', '/tms/settings', '/masterdata/users', '/masterdata/integration-keys'].filter(p => !process.argv[2] || p.includes(process.argv[2]))
const SIZES = [[1280, 800], [1536, 864], [1920, 1080]]

let email = process.env.QA_ADMIN_EMAIL, password = process.env.QA_ADMIN_PASSWORD, tag = null
if (!email || !password) {
  const p = spawnSync(process.execPath, ['scripts/qa/ci-account.mjs', 'provision'], { cwd: ROOT, encoding: 'utf8' })
  const o = (p.stdout || '') + (p.stderr || '')
  email = (o.match(/email=(\S+)/) || [])[1]; password = (o.match(/password=(\S+)/) || [])[1]; tag = (o.match(/tag=(\S+)/) || [])[1] ?? null
  if (!email) { console.error('cấp tài khoản hỏng', o.replace(/password=\S+/g, 'password=***').slice(0, 300)); process.exit(1) }
}
let bad = 0
try {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  const d = (await r.json()).data
  if (!d?.token) throw new Error(`đăng nhập hỏng (${r.status})`)
  const ticket = JSON.stringify({ state: { user: d.user, isAuthenticated: true, token: d.token, realtimeToken: d.realtime_token ?? null }, version: 0 })
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' })
  await ctx.addInitScript(a => { try { if (!sessionStorage.getItem('qa-init')) { localStorage.setItem('wms-auth', a); sessionStorage.setItem('qa-init', '1') } } catch { /* trang lạ */ } }, ticket)
  const page = await ctx.newPage()
  for (const path of PAGES) {
    try {
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => { /* trang có kết nối sống không bao giờ idle */ })
      await sleep(1500)
      const per = {}
      for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h }); await sleep(700)
        per[w] = await page.evaluate(() => {
          const main = document.querySelector('main') ?? document.body
          const vis = el => { const rc = el.getBoundingClientRect(); const cs = getComputedStyle(el); return rc.width > 0 && rc.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
          const tb = [...main.querySelectorAll('thead, [role=table]')].find(vis)
          const tableTop = tb ? Math.round(tb.getBoundingClientRect().top) : null
          const lab = el => (el.getAttribute('aria-label') || el.getAttribute('placeholder') || (el.textContent || '').replace(/\s+/g, ' ') || el.getAttribute('title') || el.tagName).trim().slice(0, 28)
          const ctrls = [...main.querySelectorAll('button, input, [role=tab], [role=combobox]')].filter(vis)
            .filter(el => { const rc = el.getBoundingClientRect(); return rc.top >= 0 && (tableTop == null ? rc.top < 330 : rc.bottom <= tableTop + 2) && !el.closest('thead, tbody, [role=dialog]') })
          const ys = ctrls.map(el => { const rc = el.getBoundingClientRect(); return Math.round(rc.top + rc.height / 2) })
          const rows = []; for (const y of [...ys].sort((a, b) => a - b)) if (!rows.length || y - rows[rows.length - 1] > 12) rows.push(y)
          const rowOf = y => rows.reduce((bi, ry, i) => Math.abs(ry - y) < Math.abs(rows[bi] - y) ? i : bi, 0)
          const map = {}; ctrls.forEach((el, i) => { const k = lab(el); if (!(k in map)) map[k] = rowOf(ys[i]) })
          return { tableTop, rows: rows.length, map, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 }
        })
      }
      const a = per[1280], m = per[1536], z = per[1920]
      const moved = Object.keys(a.map).filter(k => k in z.map && a.map[k] !== z.map[k])
      const flag = a.rows !== z.rows || a.rows !== m.rows || moved.length > 0 || a.overflowX
        || (a.tableTop != null && z.tableTop != null && Math.abs(a.tableTop - z.tableTop) > 4)
      if (flag) bad++
      console.log(`${flag ? '⚠' : '✓'} ${path.padEnd(28)} hàng ${a.rows}/${m.rows}/${z.rows} · đỉnh bảng ${a.tableTop}/${m.tableTop}/${z.tableTop}${moved.length ? ` · đổi hàng: ${moved.slice(0, 6).join(' | ')}` : ''}${a.overflowX ? ' · TRÀN NGANG 1280' : ''}`)
      if (flag) for (const [w, h] of [[1280, 800], [1920, 1080]]) {
        await page.setViewportSize({ width: w, height: h }); await sleep(500)
        await page.screenshot({ path: join(OUT, `${path.replace(/\//g, '_') || '_root'}_${w}.png`), clip: { x: 0, y: 0, width: w, height: 330 } })
      }
    } catch (e) { bad++; console.log(`✗ ${path} lỗi đo: ${String(e).slice(0, 120)}`) }
  }
  await browser.close()
} finally {
  if (tag !== null || !process.env.QA_ADMIN_EMAIL) spawnSync(process.execPath, ['scripts/qa/ci-account.mjs', 'cleanup'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...(tag ? { QA_CI_TAG: tag } : {}) } })
  writeFileSync(join(OUT, 'last-run.txt'), `${new Date().toISOString()} lệch=${bad}`)
}
console.log(bad ? `\n${bad} trang lệch bố cục giữa các cỡ màn máy tính — ảnh ở ${OUT}` : '\nMọi trang cùng bố cục ở 1280 / 1536 / 1920')
process.exit(bad ? 1 : 0)
