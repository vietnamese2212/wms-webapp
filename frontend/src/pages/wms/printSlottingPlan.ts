// In Kế hoạch sắp xếp kho (Slotting) — mở cửa sổ in layout tối giản A4, đen trắng
// (thay window.print() in nguyên trang app). Dòng GOM THEO VỊ TRÍ ĐÍCH: mỗi đích 1 khối,
// kèm số pallet đang chứa + tổng nhận; công nhân tick ô ☐ trên giấy khi chuyển xong.
// Chỉ ĐỌC dữ liệu đang hiển thị (danh sách đã lọc trên màn), không gọi API.
import { format } from 'date-fns'
import type { SlottingPlanDetailData, SlottingPlanLineRow } from '@/api/hooks'

function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
const num = (n: number) => n.toLocaleString('vi-VN')

const LINE_LABEL: Record<string, string> = {
  PENDING: 'Chưa chuyển', PARTIAL: 'Đang chuyển', DONE: 'Xong', GONE: 'Hết tồn',
}

/** Trả về false nếu trình duyệt chặn popup (caller hiện lỗi). */
export function printSlottingPlan(
  plan: SlottingPlanDetailData,
  lines: SlottingPlanLineRow[],
  printedBy?: string | null,
): boolean {
  // Gom theo vị trí đích, giữ thứ tự xuất hiện đầu tiên (thứ tự thực hiện của kế hoạch)
  const groups = new Map<string, SlottingPlanLineRow[]>()
  for (const l of lines) {
    const key = l.to_location_code ?? l.to_location_id
    const g = groups.get(key)
    if (g) g.push(l)
    else groups.set(key, [l])
  }

  let stt = 0
  const bodyRows: string[] = []
  for (const [toCode, gLines] of groups) {
    const recv = gLines.reduce((s, l) => s + l.n_pallets, 0)
    const now = gLines[0].to_pallets_now
    const flow = [...new Set(gLines.map(l => l.flow_note).filter(Boolean))].join(' · ')
    bodyRows.push(`<tr class="grp"><td colspan="8">→ ĐÍCH <span class="mono big">${esc(toCode)}</span>
      — đang chứa <b>${now == null ? '?' : num(now)}</b> pallet · nhận thêm <b>${num(recv)}</b> pallet${flow ? ` · ${esc(flow)}` : ''}</td></tr>`)
    for (const l of gLines) {
      stt++
      const resolved = l.done + l.gone
      bodyRows.push(`<tr${l.status === 'GONE' ? ' class="gone"' : ''}>
        <td class="c">${stt}</td>
        <td class="mono">${esc(l.material_code)}</td>
        <td>${esc(l.material_name ?? '')}</td>
        <td class="c mono">${esc(l.date_key ?? '—')}</td>
        <td class="mono">${esc(l.from_location_code ?? '—')}${l.from_pallets_now != null ? ` <span class="dim">(${num(l.from_pallets_now)} PL)</span>` : ''}</td>
        <td class="r"><b>${num(l.n_pallets)}</b></td>
        <td class="c">${resolved > 0 ? `${num(resolved)}/${num(l.n_pallets)}` : esc(LINE_LABEL[l.status] ?? '')}</td>
        <td class="c tick">☐</td>
      </tr>`)
    }
  }

  const s = plan.summary
  const pct = s.total_pallets > 0 ? Math.round(((s.done_pallets + s.gone_pallets) / s.total_pallets) * 100) : 0
  const partial = lines.length !== plan.lines.length
    ? `<div class="note">⚠ Bản in theo bộ lọc đang chọn: ${num(lines.length)}/${num(plan.lines.length)} dòng của kế hoạch.</div>` : ''

  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>Kế hoạch sắp xếp ${esc(plan.name)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.4 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  h1 { font-size: 16px; letter-spacing: .04em; margin: 0; }
  .meta { text-align: right; font-size: 10px; color: #333; }
  .sum { margin: 6px 0 4px; border-top: 1px solid #111; padding-top: 4px; font-size: 10px;
         display: flex; gap: 16px; flex-wrap: wrap; }
  .sum b { font-size: 12px; }
  .note { font-size: 10px; color: #555; margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { border-top: 1px solid #111; border-bottom: 1px solid #111; padding: 2px 5px;
       font-size: 9px; text-transform: uppercase; letter-spacing: .03em; text-align: left; }
  td { border-bottom: 1px solid #ddd; padding: 2px 5px; vertical-align: top; }
  .c { text-align: center; } .r { text-align: right; }
  th.r { text-align: right; } th.c { text-align: center; }
  .mono { font-family: ui-monospace, Consolas, monospace; }
  .big { font-size: 12px; font-weight: 700; }
  .dim { color: #777; font-size: 10px; }
  .grp td { background: #ededed; border-top: 1px solid #999; border-bottom: 1px solid #bbb;
            padding: 3px 5px; page-break-after: avoid; }
  .gone td { color: #999; text-decoration: line-through; }
  .tick { font-size: 13px; }
  tr { page-break-inside: avoid; }
  .foot { margin-top: 8px; font-size: 9px; color: #999; display: flex; justify-content: space-between; }
</style></head><body>
  <div class="head">
    <div>
      <h1>KẾ HOẠCH SẮP XẾP KHO</h1>
      <div class="note">${esc(plan.name)}${(() => {
        // Không lặp level/principle nếu tên kế hoạch đã chứa sẵn (tên mặc định luôn kèm)
        const nameLc = plan.name.toLowerCase()
        const tag = [plan.level, plan.principle].map(v => v ?? '')
          .filter(v => v && !nameLc.includes(v.toLowerCase())).join(' · ')
        return tag ? ` · ${esc(tag)}` : ''
      })()}</div>
    </div>
    <div class="meta">
      <div>Tạo: <b>${esc(plan.created_by ?? '—')}</b> · ${format(new Date(plan.created_at), 'dd-MM-yyyy HH:mm')}</div>
      <div>Tiến độ lúc in: <b>${pct}%</b> (${num(s.done_pallets + s.gone_pallets)}/${num(s.total_pallets)} pallet)</div>
    </div>
  </div>
  <div class="sum">
    <span>Dòng chuyển: <b>${num(lines.length)}</b></span>
    <span>Pallet phải chuyển: <b>${num(lines.reduce((t, l) => t + l.n_pallets, 0))}</b></span>
    <span>Vị trí đích: <b>${num(groups.size)}</b></span>
  </div>
  ${partial}
  <table>
    <thead><tr>
      <th class="c" style="width:26px">STT</th>
      <th style="width:88px">Mã hàng</th>
      <th>Tên hàng</th>
      <th class="c" style="width:72px">Date</th>
      <th style="width:130px">Từ vị trí (đang có)</th>
      <th class="r" style="width:52px">Pallet</th>
      <th class="c" style="width:70px">Tiến độ</th>
      <th class="c" style="width:36px">Xong</th>
    </tr></thead>
    <tbody>${bodyRows.join('')}</tbody>
  </table>
  <div class="foot">
    <span>Pallet chuyển bằng "Chuyển vị trí" ở Tồn kho — tiến độ trên app tự cập nhật</span>
    <span>In từ WMS · ${esc(printedBy ?? '')} · ${format(new Date(), 'dd-MM-yyyy HH:mm')}</span>
  </div>
</body></html>`

  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) return false
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => { try { w.print() } catch { /* user đóng sớm */ } }, 300)
  return true
}
