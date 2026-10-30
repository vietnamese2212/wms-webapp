/**
 * RÀ GIAO DIỆN MỌI TRANG MENU + MỌI FORM TẠO / THÊM — máy tính 1280 + điện thoại 390 / 360 (giả lập cảm ứng: `pointer: coarse`, sàn
 * chạm 44 px bật như máy thật). Lớp lỗi C4 (giao diện điện thoại) — trước 29/10 lưới của lớp này chỉ là "rà Playwright bằng tay trong
 * check-app", mỗi lần viết lại một script tạm nên không lần nào đo cùng một thứ.
 *
 * Đo 29/10 lần đầu (39 trang, 17 form): nút "Tạo key" ở Kết nối ERP bị khung AI Vision đè (khung bảng co về ~0 trên màn thấp) · ô chọn
 * (`SingleSelect`, cao 44 px trên điện thoại) thò khỏi khung h-7/h-8 đè ô bên dưới ở form Thêm kho / Thêm mã hàng · tab "Quy tắc ca" bẻ
 * 3 dòng · cột "Dùng để" ở Truy xuất lô bẻ 8 dòng · ô "Mọi kho trong phạm vi" thò sang ô bên ở Cước.
 *
 * Mỗi trang nạp MỘT lần mỗi thiết bị (đổi 390 → 360 không nạp lại — rẻ egress, cả lượt ~1 MB API). Đo:
 *   trang/form trượt ngang · nút ra ngoài màn · nút bị phần tử khác che (bấm không trúng) · nút chân form khuất · chữ thò khỏi khung ·
 *   chữ cụt không "…" · chữ bẻ dọc (≥ 3 dòng trong khung < 80 px) · nhãn / ô nhập / ô chọn ĐÈ NHAU · lỗi console · API ≥ 400.
 * Form: bấm các nút "Tạo / Thêm / Lập / Đăng ký…" của trang (tối đa 4), đo trong hộp thoại rồi đóng. Trong lúc mở form MỌI lệnh ghi
 * (POST/PUT/PATCH/DELETE) bị chặn ở trình duyệt ⇒ không đụng dữ liệu.
 *
 * Danh sách trang đọc thẳng từ `frontend/src/config/navigation.ts` (trang mới vào menu là tự được rà). Không nằm trong run-all (CI không có
 * trình duyệt). Chạy tay trước khi báo xong một thay đổi giao diện:
 *   PLAYWRIGHT_DIR=<thư mục có node_modules/playwright> node scripts/qa/ui-mobile-sweep.mjs [lọc-đường-dẫn]
 * Tài khoản: QA_ADMIN_EMAIL / QA_ADMIN_PASSWORD nếu có, không thì tự cấp tài khoản CI (ci-account.mjs) rồi xoá. Mật khẩu không in ra.
 * Ảnh mọi trang / form + report.json ở thư mục tạm (in ra cuối lượt). Thoát mã 1 khi có vấn đề.
 */
import { spawnSync } from 'child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const ROOT = new URL('../../', import.meta.url)
const BASE = process.env.QA_BASE_URL || 'https://wms-webapp-git-dev-vietnamese2212s-projects.vercel.app'
const OUT = join(tmpdir(), 'wms-ui-mobile-sweep'); mkdirSync(OUT, { recursive: true })
const req = createRequire(process.env.PLAYWRIGHT_DIR ? join(process.env.PLAYWRIGHT_DIR, 'x.js') : import.meta.url)
let chromium
try { ({ chromium } = req('playwright')) } catch { console.error('Thiếu playwright — đặt PLAYWRIGHT_DIR tới thư mục có node_modules/playwright'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const nav = readFileSync(fileURLToPath(new URL('frontend/src/config/navigation.ts', ROOT)), 'utf8')
const PAGES = [...new Set([...nav.matchAll(/\bto:\s*'([^']+)'/g)].map(m => m[1]))].sort()
  .filter(p => !process.argv[2] || p.includes(process.argv[2]))

// Đo trong trang (inDialog=false) hoặc trong hộp thoại đang mở trên cùng (true). Trả [{ k: loại, d: mô tả }].
function measure(inDialog) {
  const vw = document.documentElement.clientWidth, vh = window.innerHeight
  const out = []
  const dlgs = [...document.querySelectorAll('[role=dialog], [role=alertdialog]')]
  const root = inDialog ? dlgs[dlgs.length - 1] : document.body
  if (inDialog && !root) return [{ k: 'không-mở-form', d: '' }]
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 }
  const lab = el => (el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '').replace(/\s+/g, ' ').trim() || el.getAttribute('placeholder') || el.tagName).slice(0, 40)
  const clips = cs => cs.overflowX !== 'visible' || cs.overflowY !== 'visible'
  const scrollsX = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) return true } return false }
  const scrollsY = (el, stop) => { for (let p = el.parentElement; p && p !== stop; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return true; return false }
  // điểm nằm trong vùng nhìn của mọi khung cắt bao quanh — hàng bảng thò dưới mép khung cuộn thì chưa phải "bị che"
  const pointVisible = (el, x, y) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (clips(getComputedStyle(p))) { const q = p.getBoundingClientRect(); if (x < q.left || x > q.right || y < q.top || y > q.bottom) return false } } return true }
  const clippedByAncestor = el => { const r = el.getBoundingClientRect(); for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (clips(getComputedStyle(p))) { const q = p.getBoundingClientRect(); if (r.right <= q.left || r.left >= q.right || r.bottom <= q.top || r.top >= q.bottom) return true } } return false }
  // phần THẤY ĐƯỢC của el = giao với mọi khung cắt bao quanh
  const visRect = el => { let { left, top, right, bottom } = el.getBoundingClientRect(); for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (clips(getComputedStyle(p))) { const q = p.getBoundingClientRect(); left = Math.max(left, q.left); top = Math.max(top, q.top); right = Math.min(right, q.right); bottom = Math.min(bottom, q.bottom) } } return { left, top, right, bottom, width: right - left, height: bottom - top } }
  const lines = el => { const rg = document.createRange(); rg.selectNodeContents(el); const tops = new Set(); for (const q of rg.getClientRects()) if (q.width > 1) tops.add(Math.round(q.top / 4)); return tops.size }

  // A. cả trang / cả form trượt ngang
  if (!inDialog) {
    if (document.documentElement.scrollWidth > vw + 1) out.push({ k: 'trang-tràn-ngang', d: `document ${document.documentElement.scrollWidth} > ${vw}` })
    const main = document.querySelector('main')
    if (main && main.scrollWidth > main.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(main).overflowX)) out.push({ k: 'trang-tràn-ngang', d: `<main> ${main.scrollWidth} > ${main.clientWidth}` })
  } else {
    const r = root.getBoundingClientRect()
    if (r.right > vw + 1 || r.left < -1) out.push({ k: 'form-tràn-màn', d: `form x ${Math.round(r.left)}→${Math.round(r.right)} / ${vw}` })
    if (root.scrollWidth > root.clientWidth + 1 && getComputedStyle(root).overflowX !== 'hidden') out.push({ k: 'form-trượt-ngang', d: `${root.scrollWidth} > ${root.clientWidth}` })
    // nút Lưu / Huỷ ở CHÂN form (ngoài vùng cuộn) phải thấy mà không cần cuộn
    const foot = [...root.querySelectorAll('button')].filter(b => vis(b) && !scrollsY(b, root) && /^(Lưu|Tạo|Thêm|Xác nhận|Cập nhật|Huỷ|Hủy|Đóng)/.test((b.textContent || '').trim()))
    for (const b of foot) { const q = b.getBoundingClientRect(); if (q.bottom > vh + 1 || q.top < 0) out.push({ k: 'nút-chân-form-khuất', d: `"${lab(b)}" top ${Math.round(q.top)} / vh ${vh}` }) }
  }
  // B. phần tử bấm được: ra ngoài màn · pointer-events none · bị che
  const ctrls = [...root.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=combobox], [role=checkbox], [role=switch]')].filter(vis)
  for (const el of ctrls) {
    if (el.closest('[aria-hidden=true]') || clippedByAncestor(el)) continue
    const r = el.getBoundingClientRect()
    if ((r.right > vw + 1 || r.left < -1) && !scrollsX(el)) { out.push({ k: 'nút-ngoài-màn', d: `"${lab(el)}" x ${Math.round(r.left)}→${Math.round(r.right)} / ${vw}` }); continue }
    const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true'
    if (!disabled && getComputedStyle(el).pointerEvents === 'none' && el.tagName !== 'INPUT') out.push({ k: 'nút-chết', d: `"${lab(el)}" pointer-events:none` })
    if (disabled || r.top < 0 || r.bottom > vh || r.left < 0 || r.right > vw) continue
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    if (!pointVisible(el, cx, cy)) continue
    const hit = document.elementFromPoint(cx, cy)
    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el) && !(el.id && hit.closest(`label[for="${el.id}"]`)))
      out.push({ k: 'nút-bị-che', d: `"${lab(el)}" bị che bởi <${hit.tagName.toLowerCase()}> "${lab(hit)}"` })
    if (el.tagName === 'BUTTON' && el.scrollHeight > el.clientHeight + 3 && getComputedStyle(el).overflowY !== 'visible') out.push({ k: 'nhãn-nút-tràn', d: `"${lab(el)}" ${el.scrollHeight}>${el.clientHeight}` })
  }
  // C. chữ: bẻ dọc · cụt không "…" · thò khỏi khung · ra ngoài màn
  const leaves = [...root.querySelectorAll('*')].filter(el => !['SCRIPT', 'STYLE', 'svg', 'path', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(el.tagName)
    && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1) && vis(el))
  for (const el of leaves) {
    if (el.closest('[aria-hidden=true]') || clippedByAncestor(el)) continue
    const cs = getComputedStyle(el), r = el.getBoundingClientRect()
    if (r.bottom < 0 || r.top > vh * 3 || r.width <= 2 || r.height <= 2) continue // sr-only
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim()
    const where = el.closest('td, th') ? ' [bảng]' : ''
    if (txt.length >= 4 && r.width < 80 && lines(el) >= 3 && cs.writingMode === 'horizontal-tb') out.push({ k: 'chữ-bẻ-dọc', d: `"${txt.slice(0, 40)}" ${Math.round(r.width)}×${Math.round(r.height)}${where}` })
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && cs.display !== 'inline') {
      if (cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis') out.push({ k: 'chữ-cụt-không-…', d: `"${txt.slice(0, 50)}" ${el.scrollWidth}>${el.clientWidth}${where}` })
      else if (cs.overflowX === 'visible' && !where) {
        const pr = el.parentElement?.getBoundingClientRect(), spill = r.left + el.scrollWidth
        if (pr && spill > pr.right + 2) out.push({ k: 'chữ-tràn-khung', d: `"${txt.slice(0, 50)}" thò ${Math.round(spill - pr.right)}px` })
      }
    }
    if (!where && r.right > vw + 2 && !scrollsX(el) && cs.position !== 'fixed') out.push({ k: 'chữ-ngoài-màn', d: `"${txt.slice(0, 40)}" right ${Math.round(r.right)} / ${vw}` })
  }
  // D. nhãn / ô nhập / ô chọn ĐÈ NHAU (nút 44 px trong khung h-8 thò xuống ô dưới — đè 4 px cũng tính: chạm mép trên ô dưới là trúng ô trên).
  // Bỏ qua: trong bảng · định vị absolute/fixed/sticky (nút ✕ trong ô tìm, popover) · nút chỉ có icon (vùng chạm 44 px trong suốt của ⓘ)
  const floating = el => { for (let p = el; p && p !== root; p = p.parentElement) { const ps = getComputedStyle(p).position; if (ps === 'absolute' || ps === 'fixed' || ps === 'sticky') return true } return false }
  const iconOnly = el => el.tagName === 'BUTTON' && !(el.textContent || '').trim()
  const fields = [...root.querySelectorAll('label, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea, select, button')]
    .filter(el => vis(el) && !iconOnly(el) && !el.closest('table, [aria-hidden=true]') && !floating(el))
    .map(el => ({ el, r: visRect(el) })).filter(({ r }) => r.width > 24 && r.height > 10 && r.bottom > 0 && r.top < vh)
  for (let i = 0; i < fields.length; i++) for (let j = i + 1; j < fields.length; j++) {
    const a = fields[i], b = fields[j]
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top)
    if (w > 6 && h > 1.5) out.push({ k: 'đè-nhau', d: `"${lab(a.el)}" ⟷ "${lab(b.el)}" chồng ${Math.round(w)}×${Math.round(h)}px` })
  }
  const seen = new Set(); return out.filter(x => { const key = x.k + x.d; if (seen.has(key)) return false; seen.add(key); return true })
}

const FORM_BTN = /^(\+\s*)?(Tạo|Thêm|Lập|Đăng ký|Mở chuyến|Mở phiên|Ghi|Hàng trả về|Nhập trả về|Check)/i
const NOT_FORM = /(lọc|Excel|Tải|Xuất|Tạo lại)/i
const issueCount = {}
let problems = 0, apiBytes = 0
const note = (key, issues, extra = '') => {
  const cnt = {}; for (const i of issues) { cnt[i.k] = (cnt[i.k] || 0) + 1; issueCount[i.k] = (issueCount[i.k] || 0) + 1 }
  if (issues.length || extra) problems++
  console.log(`${issues.length || extra ? '⚠' : '✓'} ${key} ${Object.entries(cnt).map(([k, v]) => `${k}:${v}`).join(' ')}${extra}`)
  for (const i of issues.slice(0, 6)) console.log(`     · ${i.k} ${i.d}`)
}

// Mở từng form Tạo / Thêm của trang (tối đa 4), đo, đóng. Mọi lệnh GHI bị chặn trong lúc này.
async function formPhase(page, path, w, name, report) {
  const handler = route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort()
  await page.route('**/api/**', handler)
  try {
    const labels = await page.evaluate(([fb, nf]) => {
      const F = new RegExp(fb, 'i'), N = new RegExp(nf, 'i')
      const lab = el => (el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 40)
      return [...new Set([...(document.querySelector('main') ?? document.body).querySelectorAll('button')]
        .filter(b => b.getBoundingClientRect().width > 0 && !b.disabled && !b.closest('table')).map(lab).filter(t => F.test(t) && !N.test(t)))]
    }, [FORM_BTN.source, NOT_FORM.source])
    for (const label of labels.slice(0, 4)) {
      const url0 = page.url(), key = `${path} @${w} form "${label}"`
      const found = await page.evaluate(l => {
        const lab = el => (el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 40)
        const b = [...(document.querySelector('main') ?? document.body).querySelectorAll('button')].find(x => lab(x) === l && x.getBoundingClientRect().width > 0)
        if (b) b.setAttribute('data-qa-f', '1'); return !!b
      }, label)
      if (!found) continue
      let clickErr = null
      await page.click('[data-qa-f="1"]', { timeout: 5000 }).catch(e => { clickErr = String(e).split('\n')[0].slice(0, 160) })
      await page.evaluate(() => document.querySelectorAll('[data-qa-f]').forEach(x => x.removeAttribute('data-qa-f')))
      if (clickErr) { report[key] = [{ k: 'nút-không-bấm-được', d: clickErr }]; note(`  ${key}`, report[key]); continue }
      await sleep(1300)
      if (page.url() !== url0) { await page.goto(url0, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {}); await sleep(1200); continue }
      if (!await page.locator('[role=dialog], [role=alertdialog]').count()) { await page.keyboard.press('Escape').catch(() => {}); continue }
      const issues = await page.evaluate(measure, true)
      report[key] = issues
      await page.screenshot({ path: join(OUT, `${name}_${w}_F_${label.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 24)}.png`) })
      note(`  ${key}`, issues)
      for (let i = 0; i < 3 && await page.locator('[role=dialog], [role=alertdialog]').count(); i++) { await page.keyboard.press('Escape').catch(() => {}); await sleep(500) }
      if (await page.locator('[role=dialog], [role=alertdialog]').count()) { await page.goto(url0, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {}); await sleep(1200) }
    }
  } finally { await page.unroute('**/api/**', handler) }
}

let email = process.env.QA_ADMIN_EMAIL, password = process.env.QA_ADMIN_PASSWORD, tag = null
if (!email || !password) {
  const p = spawnSync(process.execPath, ['scripts/qa/ci-account.mjs', 'provision'], { cwd: ROOT, encoding: 'utf8' })
  const o = (p.stdout || '') + (p.stderr || '')
  email = (o.match(/email=(\S+)/) || [])[1]; password = (o.match(/password=(\S+)/) || [])[1]; tag = (o.match(/tag=(\S+)/) || [])[1] ?? null
  if (!email) { console.error('cấp tài khoản hỏng', o.replace(/password=\S+/g, 'password=***').slice(0, 300)); process.exit(1) }
}
const report = {}
try {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  const d = (await r.json()).data
  if (!d?.token) throw new Error(`đăng nhập hỏng (${r.status})`)
  const ticket = JSON.stringify({ state: { user: d.user, isAuthenticated: true, token: d.token, realtimeToken: d.realtime_token ?? null }, version: 0 })
  const browser = await chromium.launch({ headless: true })
  const DEVICES = [{ w: 1280, h: 800, more: [] }, { w: 390, h: 844, mobile: true, more: [[360, 780]] }]
  for (const dev of DEVICES) {
    const ctx = await browser.newContext({ viewport: { width: dev.w, height: dev.h }, serviceWorkers: 'block', ...(dev.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) })
    await ctx.addInitScript(a => { try { if (!sessionStorage.getItem('qa-init')) { localStorage.setItem('wms-auth', a); sessionStorage.setItem('qa-init', '1') } } catch { /* trang lạ */ } }, ticket)
    const page = await ctx.newPage()
    const errs = [], bad = []
    page.on('console', m => { if (m.type() === 'error' && !/favicon|vercel-live|ERR_ABORTED|ERR_FAILED/i.test(m.text())) errs.push(m.text().slice(0, 160)) })
    page.on('pageerror', e => errs.push('pageerror ' + String(e).slice(0, 160)))
    page.on('requestfinished', async rq => { if (rq.url().includes('/api/')) { try { apiBytes += (await rq.sizes()).responseBodySize } catch { /* đã đóng */ } } })
    page.on('response', rs => { if (rs.status() >= 400 && rs.url().includes('/api/')) bad.push(`${rs.status()} ${rs.request().method()} ${rs.url().replace(BASE, '').slice(0, 100)}`) })
    for (const path of PAGES) {
      const name = path === '/' ? 'dashboard' : path.slice(1).replace(/\//g, '_')
      try {
        errs.length = 0; bad.length = 0
        await page.setViewportSize({ width: dev.w, height: dev.h })
        await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => { /* trang có kết nối sống không bao giờ idle */ })
        await sleep(1800)
        for (const [w, h] of [[dev.w, dev.h], ...dev.more]) {
          if (w !== dev.w) { await page.setViewportSize({ width: w, height: h }); await sleep(600) }
          const issues = await page.evaluate(measure, false)
          report[`${path} @${w}`] = { issues, console: [...errs], api: [...bad] }
          await page.screenshot({ path: join(OUT, `${name}_${w}.png`) })
          note(`${String(w).padEnd(4)} ${path}`, issues, `${errs.length ? ` console:${errs.length} (${errs[0]})` : ''}${bad.length ? ` api≥400:${bad.join(' · ')}` : ''}`)
        }
        await formPhase(page, path, dev.more.length ? dev.more[dev.more.length - 1][0] : dev.w, name, report)
      } catch (e) { problems++; console.log(`✗ ${path} @${dev.w} lỗi đo: ${String(e).slice(0, 120)}`) }
    }
    await ctx.close()
  }
  await browser.close()
} finally {
  if (tag !== null || !process.env.QA_ADMIN_EMAIL) spawnSync(process.execPath, ['scripts/qa/ci-account.mjs', 'cleanup'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...(tag ? { QA_CI_TAG: tag } : {}) } })
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1))
}
console.log(`\nAPI tải về ${(apiBytes / 1048576).toFixed(1)} MB · ảnh + report.json ở ${OUT}`)
console.log(problems ? `${problems} trang / form có vấn đề: ${Object.entries(issueCount).map(([k, v]) => `${k} ${v}`).join(' · ')}` : 'Mọi trang và form sạch ở 1280 / 390 / 360')
process.exit(problems ? 1 : 0)
