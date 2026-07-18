// In Kế hoạch sắp xếp kho (Slotting) — mở cửa sổ in layout tối giản A4, đen trắng
// (thay window.print() in nguyên trang app). Bảng ĐƠN GIẢN giống hệt trên màn: các dòng
// liền nhau cùng vị trí đích nối bracket [ ở mép trái (user 18/07 — KHÔNG chèn hàng subtotal);
// ô ☐ cho công nhân tick trên giấy. Chỉ ĐỌC danh sách đang hiển thị (đã lọc + sort), không gọi API.
import { format } from 'date-fns'
import type { SlottingPlanDetailData, SlottingPlanLineRow } from '@/api/hooks'

function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
const num = (n: number) => n.toLocaleString('vi-VN')

/** Các dòng mà làm xong TRỐNG được vị trí nguồn (mọi pallet còn lại ở nguồn đều thuộc kế hoạch).
 *  Tính trên TOÀN BỘ dòng kế hoạch (không theo bộ lọc) — dùng chung cho sort màn hình + bản in. */
export function computeFreesSet(allLines: SlottingPlanLineRow[]): Set<string> {
  const pendingOut = new Map<string, number>() // from_location_id → Σ pallet còn phải rời đi
  for (const l of allLines) {
    if (!l.from_location_id || l.pending <= 0) continue
    pendingOut.set(l.from_location_id, (pendingOut.get(l.from_location_id) ?? 0) + l.pending)
  }
  const set = new Set<string>()
  for (const l of allLines) {
    if (!l.from_location_id || l.pending <= 0 || l.from_pallets_now == null) continue
    if (l.from_pallets_now - (pendingOut.get(l.from_location_id) ?? 0) <= 0) set.add(l.id)
  }
  return set
}

/** Trả về false nếu trình duyệt chặn popup (caller hiện lỗi). */
export function printSlottingPlan(
  plan: SlottingPlanDetailData,
  lines: SlottingPlanLineRow[],
  printedBy?: string | null,
): boolean {
  const frees = computeFreesSet(plan.lines)
  const bodyRows: string[] = []
  lines.forEach((l, i) => {
    const key = l.to_location_id
    const prevOk = i > 0 && lines[i - 1].to_location_id === key
    const nextOk = i < lines.length - 1 && lines[i + 1].to_location_id === key
    const pos = prevOk && nextOk ? 'mid' : prevOk ? 'last' : nextOk ? 'first' : 'only'
    const brCls = pos === 'only' ? '' : ` br br-${pos}`
    bodyRows.push(`<tr class="${l.status === 'GONE' ? 'gone' : ''}${brCls}">
      <td class="bk"></td>
      <td class="c">${i + 1}</td>
      <td class="mono">${esc(l.material_code)}</td>
      <td>${esc(l.material_name ?? '')}</td>
      <td class="c mono">${esc(l.date_key ?? '—')}</td>
      <td class="mono">${esc(l.from_location_code ?? '—')}${l.from_pallets_now != null ? ` <span class="dim">(${num(l.from_pallets_now)})</span>` : ''}${frees.has(l.id) ? ' <span class="free">→trống</span>' : ''}</td>
      <td class="r"><b>${num(l.n_pallets)}</b></td>
      <td class="mono${pos === 'mid' || pos === 'last' ? ' dim' : ''}"><b>${esc(l.to_location_code ?? '—')}</b>${l.to_pallets_now != null ? ` <span class="dim">(${num(l.to_pallets_now)})</span>` : ''}</td>
      <td class="c tick">☐</td>
    </tr>`)
  })

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
  .sum { margin: 6px 0 2px; border-top: 1px solid #111; padding-top: 4px; font-size: 10px;
         display: flex; gap: 16px; flex-wrap: wrap; }
  .note { font-size: 10px; color: #555; margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { border-top: 1px solid #111; border-bottom: 1px solid #111; padding: 2px 5px;
       font-size: 9px; text-transform: uppercase; letter-spacing: .03em; text-align: left; }
  td { border-bottom: 1px solid #ddd; padding: 2px 5px; vertical-align: top; }
  .c { text-align: center; } .r { text-align: right; }
  th.r { text-align: right; } th.c { text-align: center; }
  .mono { font-family: ui-monospace, Consolas, monospace; }
  .dim { color: #999; }
  .free { font-size: 9px; font-weight: 700; }
  .gone td { color: #999; text-decoration: line-through; }
  .tick { font-size: 13px; }
  tr { page-break-inside: avoid; }
  /* Bracket [ nối các dòng liền nhau cùng vị trí đích — như bảng trên màn */
  td.bk { width: 6px; padding: 0; border-bottom: none; }
  tr.br td.bk { border-left: 2px solid #111; }
  tr.br-first td.bk { border-top: 2px solid #111; }
  tr.br-last td.bk { border-bottom: 2px solid #111; }
  tr.br td { background: #f6f6f6; }
  tr.br-first td { border-top: 1px solid #aaa; }
  tr.br-last td { border-bottom: 1px solid #aaa; }
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
      <div>Tiến độ lúc in: <b>${plan.summary.total_pallets > 0 ? Math.round(((plan.summary.done_pallets + plan.summary.gone_pallets) / plan.summary.total_pallets) * 100) : 0}%</b> (${num(plan.summary.done_pallets + plan.summary.gone_pallets)}/${num(plan.summary.total_pallets)} pallet)</div>
    </div>
  </div>
  <div class="sum">
    <span>Dòng chuyển: <b>${num(lines.length)}</b></span>
    <span>Pallet phải chuyển: <b>${num(lines.reduce((t, l) => t + l.n_pallets, 0))}</b></span>
    <span>Vị trí đích: <b>${num(new Set(lines.map(l => l.to_location_id)).size)}</b></span>
  </div>
  ${partial}
  <table>
    <thead><tr>
      <th style="width:6px"></th>
      <th class="c" style="width:26px">STT</th>
      <th style="width:84px">Mã hàng</th>
      <th>Tên hàng</th>
      <th class="c" style="width:70px">Date</th>
      <th style="width:130px">Từ vị trí (đang có)</th>
      <th class="r" style="width:46px">Pallet</th>
      <th style="width:130px">Đến vị trí (đang có)</th>
      <th class="c" style="width:32px">Xong</th>
    </tr></thead>
    <tbody>${bodyRows.join('')}</tbody>
  </table>
  <div class="foot">
    <span>[ = cùng vị trí đích · →trống = chuyển xong là trống vị trí nguồn · pallet chuyển bằng "Chuyển vị trí" ở Tồn kho</span>
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
