// In Phiếu xuất kho — mở cửa sổ in với layout tối giản (A4, đen trắng).
// Chỉ ĐỌC dữ liệu GDO đang hiển thị, không gọi API.
import { format, parseISO } from 'date-fns'
import type { GDO } from '@/types'

function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
const num = (n: number) => n.toLocaleString('vi-VN')
const dmy = (iso: string) => format(parseISO(iso), 'dd-MM-yyyy')

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Chờ xuất', IN_PROGRESS: 'Đang xuất', PAUSED: 'Tạm dừng',
  COMPLETED: 'Đã hoàn thành', CANCELLED: 'Đã hủy',
}

/** Trả về false nếu trình duyệt chặn popup (caller hiện lỗi). */
export function printDeliveryNote(gdo: GDO, printedBy?: string | null): boolean {
  const dos = gdo.delivery_orders ?? []
  const multiDO = dos.length > 1
  const hasLoose = dos.some(d => d.items.some(i => (i.loose_picking ?? 0) > 0))
  const hasNote  = dos.some(d => d.items.some(i => (i.header_text ?? '').trim()))

  let stt = 0
  let totalOrdered = 0, totalScanned = 0, totalLoose = 0
  const bodyRows: string[] = []
  const colSpanLeft = 3 // STT + Mã hàng + Tên hàng

  for (const d of dos) {
    if (multiDO) {
      bodyRows.push(`<tr class="grp"><td colspan="${colSpanLeft + 2 + (hasLoose ? 1 : 0) + (hasNote ? 1 : 0)}">DO ${esc(d.delivery_code)}${d.distributor_name ? ` — ${esc(d.distributor_name)}` : ''}</td></tr>`)
    }
    for (const i of d.items) {
      stt++
      totalOrdered += i.cartons_ordered
      totalScanned += i.cartons_scanned
      totalLoose   += i.loose_picking ?? 0
      bodyRows.push(`<tr>
        <td class="c">${stt}</td>
        <td class="mono">${esc(i.material?.material_code ?? i.material_code_raw)}</td>
        <td>${esc(i.material?.short_name ?? i.material_code_raw ?? '—')}</td>
        <td class="r">${num(i.cartons_ordered)}</td>
        ${hasLoose ? `<td class="r">${(i.loose_picking ?? 0) > 0 ? num(i.loose_picking) : ''}</td>` : ''}
        <td class="r">${num(i.cartons_scanned)}</td>
        ${hasNote ? `<td class="note">${esc(i.header_text)}</td>` : ''}
      </tr>`)
    }
  }
  bodyRows.push(`<tr class="total">
    <td colspan="${colSpanLeft}" class="r">TỔNG CỘNG</td>
    <td class="r">${num(totalOrdered)}</td>
    ${hasLoose ? `<td class="r">${totalLoose > 0 ? num(totalLoose) : ''}</td>` : ''}
    <td class="r">${num(totalScanned)}</td>
    ${hasNote ? '<td></td>' : ''}
  </tr>`)

  const npp = [...new Set(dos.map(d => d.distributor_name).filter(Boolean))].join(', ')
  const doCodes = [...new Set(dos.map(d => d.delivery_code).filter(Boolean))].join(' · ')
  const nowVN = new Date()
  const infoRow = (label: string, value: string) =>
    value ? `<div class="row"><span class="lbl">${label}</span><span>${value}</span></div>` : ''

  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>Phiếu xuất kho ${esc(gdo.group_code)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font: 12px/1.45 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  .wh { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  h1 { font-size: 18px; letter-spacing: .06em; margin: 2px 0 0; }
  .meta { text-align: right; font-size: 11px; }
  .meta .code { font-family: ui-monospace, Consolas, monospace; font-weight: 700; font-size: 13px; }
  .status { display: inline-block; border: 1px solid #111; border-radius: 3px; padding: 0 6px; font-size: 10px; margin-top: 2px; }
  .info { margin: 10px 0 8px; border-top: 1px solid #111; padding-top: 6px;
          display: grid; grid-template-columns: 1fr 1fr; gap: 1px 24px; }
  .row { display: flex; gap: 6px; min-width: 0; }
  .lbl { color: #555; flex: 0 0 92px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { border-top: 1px solid #111; border-bottom: 1px solid #111; padding: 3px 6px;
       font-size: 10px; text-transform: uppercase; letter-spacing: .03em; text-align: left; }
  td { border-bottom: 1px solid #ddd; padding: 3px 6px; vertical-align: top; }
  .c { text-align: center; } .r { text-align: right; }
  .mono { font-family: ui-monospace, Consolas, monospace; }
  th.r { text-align: right; }
  .grp td { background: #f2f2f2; font-weight: 600; border-bottom: 1px solid #bbb; }
  .total td { border-top: 1px solid #111; border-bottom: none; font-weight: 700; }
  .note { font-size: 11px; color: #333; }
  .signs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 22px;
           text-align: center; page-break-inside: avoid; }
  .signs .t { font-weight: 600; font-size: 11px; }
  .signs .s { color: #777; font-size: 10px; font-style: italic; }
  .signs .sp { height: 64px; }
  .foot { margin-top: 10px; font-size: 9px; color: #999; text-align: right; }
  @media print { .noprint { display: none; } }
</style></head><body>
  <div class="head">
    <div>
      <div class="wh">${esc(gdo.warehouse?.name ?? '')}</div>
      <h1>PHIẾU XUẤT KHO</h1>
    </div>
    <div class="meta">
      <div class="code">${esc(gdo.group_code)}</div>
      <div>Ngày xuất: <b>${dmy(gdo.delivery_date)}</b></div>
      <div class="status">${esc(STATUS_LABEL[gdo.status] ?? gdo.status)}</div>
    </div>
  </div>
  <div class="info">
    ${infoRow('Khách / Nơi nhận', esc(npp))}
    ${infoRow('Số DO', `<span class="mono">${esc(doCodes)}</span>`)}
    ${infoRow('Đơn vị vận tải', esc(gdo.dvvt))}
    ${infoRow('Biển số xe', gdo.license_plate ? `<b class="mono">${esc(gdo.license_plate)}</b>${gdo.container_number ? ` · Cont ${esc(gdo.container_number)}` : ''}` : '')}
    ${infoRow('Người xuất hàng', esc(gdo.exporter_name))}
    ${infoRow('Người bốc xếp', esc(gdo.loader_name))}
  </div>
  <table>
    <thead><tr>
      <th class="c" style="width:34px">STT</th>
      <th style="width:110px">Mã hàng</th>
      <th>Tên hàng</th>
      <th class="r" style="width:86px">KH (thùng)</th>
      ${hasLoose ? '<th class="r" style="width:64px">Lẻ</th>' : ''}
      <th class="r" style="width:96px">Thực xuất</th>
      ${hasNote ? '<th style="width:150px">Ghi chú</th>' : ''}
    </tr></thead>
    <tbody>${bodyRows.join('')}</tbody>
  </table>
  <div class="signs">
    <div><div class="t">Người lập phiếu</div><div class="s">(Ký, họ tên)</div><div class="sp"></div></div>
    <div><div class="t">Thủ kho</div><div class="s">(Ký, họ tên)</div><div class="sp"></div></div>
    <div><div class="t">Người vận chuyển</div><div class="s">(Ký, họ tên)</div><div class="sp"></div></div>
    <div><div class="t">Người nhận hàng</div><div class="s">(Ký, họ tên)</div><div class="sp"></div></div>
  </div>
  <div class="foot">In từ WMS · ${esc(printedBy ?? '')} · ${format(nowVN, 'dd-MM-yyyy HH:mm')}</div>
</body></html>`

  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) return false
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => { try { w.print() } catch { /* user đóng sớm */ } }, 300)
  return true
}
