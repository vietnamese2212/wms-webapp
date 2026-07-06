// Render tài liệu bàn giao Markdown → PDF (Chromium print).
// - Ảnh tương đối resolve qua <base href> về docs/handover/
// - Khối ```mermaid render bằng mermaid.js (CDN) trước khi in
const { chromium } = require('playwright')
const { marked } = require('marked')
const fs = require('fs')
const path = require('path')

// docs/handover nằm 2 cấp trên script (scripts/handover-pdf/ → repo root → docs/handover)
const DIR = path.resolve(__dirname, '..', '..', 'docs', 'handover').replace(/\\/g, '/')
const OUT = path.join(DIR, 'pdf')

const CSS = `
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10.5pt; color: #0f172a;
         line-height: 1.55; margin: 0; padding: 0 4mm; }
  h1 { font-size: 20pt; color: #0c4a6e; border-bottom: 3px solid #0ea5e9; padding-bottom: 6px; }
  h2 { font-size: 14.5pt; color: #0c4a6e; margin-top: 22px; border-bottom: 1px solid #bae6fd;
       padding-bottom: 3px; page-break-after: avoid; }
  h3 { font-size: 12pt; color: #075985; margin-top: 16px; page-break-after: avoid; }
  h2, h3 { break-after: avoid-page; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 9pt; page-break-inside: auto; }
  th { background: #0c4a6e; color: #fff; text-align: left; padding: 4px 7px; }
  td { border: 1px solid #cbd5e1; padding: 4px 7px; vertical-align: top; }
  tr { page-break-inside: avoid; }
  tr:nth-child(even) td { background: #f8fafc; }
  img { max-width: 100%; border: 1px solid #e2e8f0; border-radius: 6px; margin: 6px 0;
        page-break-inside: avoid; }
  code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 9pt;
         font-family: Consolas, monospace; }
  pre { background: #f1f5f9; padding: 10px; border-radius: 6px; overflow-x: hidden;
        white-space: pre-wrap; word-break: break-word; font-size: 8.5pt; }
  pre code { background: none; padding: 0; }
  pre.mermaid { background: #fff; text-align: center; page-break-inside: avoid;
        break-inside: avoid; margin: 14px 0; }
  pre.mermaid svg { max-width: 100%; height: auto; display: block; margin: 0 auto; }
  blockquote { border-left: 4px solid #0ea5e9; background: #f0f9ff; margin: 8px 0;
               padding: 6px 12px; color: #334155; }
  a { color: #0369a1; text-decoration: none; }
  li { margin: 2px 0; }
  hr { border: none; border-top: 1px solid #cbd5e1; margin: 18px 0; }
`

async function render(page, mdFile) {
  const raw = fs.readFileSync(path.join(DIR, mdFile), 'utf8')
  const hasMermaid = raw.includes('```mermaid')
  let html = marked.parse(raw)
  // marked bọc mermaid thành <pre><code class="language-mermaid"> → đổi sang <pre class="mermaid">
  html = html.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    (_, body) => {
      // \n trong nhãn → xuống dòng thật (giữ dạng escaped để textContent trả '<br/>')
      const fixed = body.replace(/\\n/g, '&lt;br/&gt;')
      return `<pre class="mermaid">${fixed}</pre>`
    })

  const mermaidScript = hasMermaid ? `
    <script type="module">
      import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'
      mermaid.initialize({
        startOnLoad: false, theme: 'default', securityLevel: 'loose',
        fontFamily: 'Segoe UI, Arial, sans-serif', fontSize: 15,
        flowchart: { htmlLabels: true, useMaxWidth: true, nodeSpacing: 45, rankSpacing: 45, padding: 12, curve: 'basis' },
      })
      await mermaid.run()
      window.__mermaidDone = true
    </script>` : '<script>window.__mermaidDone = true</script>'

  const doc = `<!doctype html><html><head><meta charset="utf-8">
    <style>${CSS}</style></head>
    <body>${html}${mermaidScript}</body></html>`

  // Doc có Mermaid (không ảnh): setContent để import CDN chạy được.
  // Doc có ảnh: ghi HTML tạm vào docs/handover rồi mở file:// để ảnh tương đối nạp được.
  let tmp = null
  if (hasMermaid) {
    await page.setContent(doc, { waitUntil: 'networkidle' })
  } else {
    tmp = path.join(DIR, '__render_tmp.html')
    fs.writeFileSync(tmp, doc)
    await page.goto('file:///' + tmp.replace(/\\/g, '/').replace(/ /g, '%20'), { waitUntil: 'networkidle' })
  }
  await page.waitForFunction('window.__mermaidDone === true', { timeout: 30000 })
  await page.waitForTimeout(500)
  const out = path.join(OUT, mdFile.replace(/\.md$/, '.pdf'))
  await page.pdf({
    path: out, format: 'A4', printBackground: true,
    margin: { top: '14mm', bottom: '14mm', left: '11mm', right: '11mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="width:100%;text-align:center;font-size:8px;color:#64748b;">
      MAL SC — Tài liệu bàn giao · <span class="pageNumber"></span>/<span class="totalPages"></span></div>`,
  })
  if (tmp) fs.unlinkSync(tmp)
  console.log('PDF', mdFile, '->', path.basename(out), Math.round(fs.statSync(out).size / 1024) + 'KB')
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const files = process.argv.slice(2)
  const list = files.length ? files : fs.readdirSync(DIR).filter(f => f.endsWith('.md'))
  const browser = await chromium.launch()
  const page = await browser.newPage()
  for (const f of list) await render(page, f)
  await browser.close()
  console.log('DONE')
}

main().catch(e => { console.error(e); process.exit(1) })
