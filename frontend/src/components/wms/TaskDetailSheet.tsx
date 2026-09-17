// CHI TIẾT MỘT VIỆC — mở từ bảng "Việc cần làm" (13/09).
//
// Vì sao có màn này: user 13/09 — "Việc cần làm chính là nơi giao MỌI việc cho user … nơi mà user
// có thể check được các thông tin liên quan TẠI ĐÓ khi làm việc ở đó." Bảng chỉ đủ chỗ cho câu
// lệnh ngắn (đi đâu · lấy mấy pallet · đưa tới đâu); ba câu hỏi người đứng giữa kho hỏi tiếp thì
// trước 13/09 phải rời trang mới trả lời được:
//   • "Lấy PALLET NÀO trong ô này?" — đo staging 13/09: 16/18 việc đang chờ có ô còn nhiều pallet
//     cùng mã (nhiều nhất 13 pallet), 8/18 ca các pallet đó khác NSX. Kế hoạch đã ghim đúng pallet;
//     người đi lấy phải đọc được cái ghim đó, nếu không thì lấy pallet mặt ngoài là chuyện đương nhiên.
//   • "Đúng date chưa?" — yêu cầu của dòng đơn (Theo quy định kho · ≥ 60 % · còn ≥ 35 ngày) đặt CẠNH
//     %Date thật của từng pallet, để so bằng mắt chứ không phải nhớ.
//   • "Giao cho ai, chuyến còn bao nhiêu?" — NPP · số DO · ghi chú CS · tiến độ dòng hàng.
//
// %Date đi qua `computePctDate` của `utils/shelfLife` (BE⇄FE mirror) — KHÔNG tự so ngày ở đây.
import { Link } from 'react-router-dom'
import { Boxes, ExternalLink } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { dateRuleLabel } from '@/components/wms/SetDateRuleSheet'
import { computeDaysLeft, computePctDate } from '@/utils/shelfLife'
import { pctDateCls, type PctBands } from '@/utils/pctDateBands'
import { qtyLabel, type MatUnits } from '@/utils/qtyUnits'
import { formatDate, formatTimestampTime } from '@/utils/formatters'
import { setReturnTo } from '@/lib/returnTo'
import type { DirectedPallet, DirectedRow, DirectedTrip } from '@/types'

/** Neo "về Việc cần làm" trước khi rời trang — thanh ở Shell + mũi tên trang đích sẽ đưa về đây. */
export const anchorDirected = () => setReturnTo('/wms/directed', 'Việc cần làm')

/**
 * Tên chuyến trên MỌI nội dung = SỐ XE (group_code) trước, biển số sau (user 14/09: "trong nội dung
 * luôn phải gắn kèm với số xe"). Bản cũ in `license_plate ?? group_code` nên chuyến có biển thì Số xe —
 * khoá mà điều vận, SAP và Kế hoạch xuất cùng gọi — biến mất khỏi bảng.
 */
export const tripName = (r: { group_code?: string | null; license_plate?: string | null } | null | undefined) =>
  [r?.group_code, r?.license_plate].filter(Boolean).join(' · ') || '—'

const nf = (n: number) => n.toLocaleString('vi-VN')

/**
 * %Date của MỘT pallet trong dòng việc. Cặp đúng theo hàm chung: nguyên liệu của LÔ
 * (NSX · HSD trên tem · shelflife riêng của lô · NCC) với shelflife + ngoại lệ NCC của MÃ.
 * Xuất khẩu để bảng và thẻ dùng CHUNG — hai chỗ tự tính là hai con số khác nhau ở lần sửa đầu tiên.
 */
export const palletEntry = (p: DirectedPallet) => ({
  production_date: p.production_date, expiry_date: p.expiry_date,
  shelf_life_days: p.shelf_life_days, ncc_id: p.ncc_id,
})
const palletMat = (p: DirectedPallet) => ({
  shelf_life_days: p.mat_shelf_days, supplier_shelf_life_overrides: p.mat_overrides,
})
export const palletPct = (p: DirectedPallet): number | null => computePctDate(palletEntry(p), palletMat(p))
export const palletDays = (p: DirectedPallet): number | null => computeDaysLeft(palletEntry(p), palletMat(p))

/** Yêu cầu date của dòng việc — nhóm gom nhiều mã thì có thể nhiều mức, nói thẳng "nhiều mức". */
export function rowRule(r: DirectedRow): { text: string; cls: string } | null {
  const rules = r.date_rules ?? []
  if (rules.length > 1) return { text: `${rules.length} mức date`, cls: 'bg-indigo-100 text-indigo-700' }
  if (rules.length === 1) return dateRuleLabel(rules[0], r, r.date_required)
  if (Number(r.date_required) > 0) return dateRuleLabel(null, r, r.date_required)
  return null
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 items-baseline min-w-0">
      <span className="w-24 shrink-0 text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className="min-w-0 flex-1 text-xs text-slate-700 break-words">{children}</span>
    </div>
  )
}
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-1.5">
    <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
      <span className="h-3 w-0.5 rounded bg-sky-500" />{title}
    </h3>
    {children}
  </section>
)
const dash = <span className="text-slate-300">—</span>

/**
 * AI ĐANG CẦM VIỆC NÀY — tên + GIỜ NHẬN (17/09, user: *"Nhận việc: phải biết được ai là người nhận,
 * nhận lúc nào"*). Khoá mềm tự nhả sau 10 phút, nên thiếu giờ thì việc rời tay người ta mà không ai
 * hiểu vì sao; có giờ thì nhìn một cái là biết vừa nhận hay sắp hết hạn. Đặt ở đây (không ở trang)
 * để bảng, thẻ và panel chi tiết kể CÙNG một câu.
 */
export function claimNote(r: DirectedRow, me: string | null): { mine: boolean; text: string } | null {
  if (!r.claim_active || !r.claimed_by) return null
  const at = r.claimed_at ? formatTimestampTime(r.claimed_at) : null
  const mine = r.claimed_by === me
  const who = mine ? 'Bạn' : (r.claimed_by_name ?? 'Người khác')
  return { mine, text: at ? `${who} nhận lúc ${at}` : `${who} đang làm` }
}

export function TaskDetailSheet({ row, tab, trip, bands, canOpenTrip, looseLink, me, actions, busy, onStock, onClose }: {
  row: DirectedRow
  tab: 'LOWER' | 'MOVE' | 'SCAN'
  me?: string | null
  trip: DirectedTrip | undefined
  bands: PctBands
  canOpenTrip: boolean
  // Việc NHẶT LẺ: đường tới dòng hàng nơi thủ kho bấm "Check nhặt lẻ" (bước trừ tồn thật) — null = không có quyền
  looseLink?: string | null
  actions: { key: string; label: string; icon: React.ComponentType<{ className?: string }>; primary?: boolean; onClick: () => void }[]
  busy: boolean
  onStock: (m: { id: string; code: string; mat: DirectedRow | null }) => void
  onClose: () => void
}) {
  const units = row as MatUnits
  const rule = rowRule(row)
  const dest = tab === 'LOWER' ? (row.drop_name ?? row.to_name) : (row.to_name ?? row.to_code)
  const where = tab === 'LOWER' ? row.from_code : row.current_code
  const mats = (row.materials ?? []).filter(m => m?.id)
  const pallets = row.pallets ?? []
  const claim = claimNote(row, me ?? null)
  // Khoá tra sổ chuyển vị trí: một pallet thì tra đúng tem, nhóm nhiều pallet thì tra theo Ô NGUỒN
  // (ô tra được vì sổ lưu cả `location_from_code`) — tra bằng tem đầu danh sách là kể thiếu.
  const moveKey = pallets.length === 1 ? (pallets[0].code ?? null) : (row.from_code ?? null)

  return (
    <Sheet open onOpenChange={v => { if (!v) onClose() }}>
      {/* 34rem chứ không 30: bảng pallet có tem dài ~26 ký tự + NSX + %Date + SL, ở 30rem thì cột SL
          chạm mép. Điện thoại vẫn full bề ngang. */}
      <SheetContent side="right" className="w-full sm:w-[34rem] p-0 flex flex-col gap-0">
        <SheetHeader className="px-4 pt-4 pb-3 border-b space-y-1 text-left">
          <SheetTitle className="text-sm font-semibold text-slate-800">
            {/* Mã ĐỊNH DANH không được cắt cụt trên điện thoại (hiến pháp UI 24/08) */}
            <span className="font-mono break-all">{where ?? 'chưa có trên bản vẽ'}</span>
            <span className="text-slate-400"> → </span>
            <span className="break-all">{dest ?? '—'}</span>
          </SheetTitle>
          <p className="text-[11px] text-slate-500">
            {nf(row.n_pallets)} pallet · {row.material_codes?.filter(Boolean).join(', ') || '—'}
            {row.kind === 'LOOSE_FEED' && <span className="text-purple-600"> · đưa về vị trí nhặt lẻ</span>}
          </p>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
          <Section title="Chuyến">
            <Row label="Số xe">
              <span className="font-mono font-semibold">{tripName(row)}</span>
              {row.dock_name && <span className="text-slate-500"> · {row.dock_name}</span>}
            </Row>
            <Row label="Giao cho">{row.customer_name ?? trip?.customers ?? dash}</Row>
            <Row label="Số DO">{row.do_codes ?? dash}</Row>
            <Row label="Ngày xuất">{row.delivery_date ? formatDate(row.delivery_date) : dash}</Row>
            <Row label="Bắt đầu">{row.started_at ? formatTimestampTime(row.started_at) : dash}</Row>
            {trip && (
              <Row label="Tiến độ">
                <span className="tabular-nums font-semibold">{nf(trip.lines_done)}/{nf(trip.lines_total)}</span> dòng hàng quét đủ
                <span className="text-slate-400"> · còn {nf(trip.tasks_pending)} việc</span>
                {trip.lines_unset > 0 && <span className="text-amber-700"> · {nf(trip.lines_unset)} dòng chưa khai date</span>}
              </Row>
            )}
            {/* Ghi chú CS là CHỮ do người viết — máy không đọc, nhưng người lấy hàng thì nên đọc */}
            {row.cs_note && <Row label="Ghi chú CS"><span className="text-amber-800">{row.cs_note}</span></Row>}
            {(canOpenTrip || looseLink) && (
              <div className="pt-1 flex flex-wrap gap-3">
                {canOpenTrip && (
                  <Link to={`/wms/outbound/${row.gdo_id}`} onClick={() => { anchorDirected(); onClose() }}
                    className="inline-flex items-center gap-1 text-[11px] text-sky-700 hover:underline">
                    <ExternalLink className="h-3 w-3" /> Mở trang chuyến
                  </Link>
                )}
                {/* Hai bước, hai người, cùng gọi là "xong": xe nâng ✓ = pallet đã về vị trí nhặt lẻ;
                    thủ kho "Check nhặt lẻ" ở dòng hàng mới là bước TRỪ TỒN. Trang này chỉ đường tới đó. */}
                {looseLink && (
                  <Link to={looseLink} onClick={() => { anchorDirected(); onClose() }}
                    className="inline-flex items-center gap-1 text-[11px] text-purple-700 hover:underline">
                    <ExternalLink className="h-3 w-3" /> Trừ tồn nhặt lẻ ở dòng hàng
                  </Link>
                )}
              </div>
            )}
          </Section>

          {/* AI ĐANG LÀM / ĐÃ LÀM (17/09) — user: *"Nhận việc: phải biết được ai là người nhận, nhận
              lúc nào"* và *"bấm Xong nghĩa là gì … phòng bấm Xong lung tung rồi hàng hoá chạy loạn"*.
              Dữ liệu vốn có trong DB, chỉ chưa màn nào nói ra. Với việc NHẶT LẺ thì ✓ Xong có GHI TỒN
              (pallet chuyển sang ô kho lẻ) nên nói rõ điều đó + mở thẳng sổ chuyển vị trí. */}
          <Section title="Người làm">
            <Row label="Đang cầm">
              {claim
                ? <span className={claim.mine ? 'text-sky-700 font-medium' : 'text-slate-700'}>{claim.text}</span>
                : <span className="text-slate-400">chưa ai bấm Nhận — việc chung, cứ làm</span>}
            </Row>
            {row.stage_done && (
              <Row label={tab === 'LOWER' ? 'Đã hạ' : 'Đã đưa ra'}>
                {row.last_at ? formatTimestampTime(row.last_at) : dash}
                {row.done_by_name && <span className="text-slate-500"> · {row.done_by_name}</span>}
              </Row>
            )}
            {row.kind === 'LOOSE_FEED' && (
              <>
                <Row label="Nút ✓ Xong">
                  <span className="text-purple-700">chuyển pallet trong sổ tồn về vị trí nhặt lẻ</span>
                  <span className="text-slate-500"> — bấm nhầm thì bấm “Bỏ dấu ✓”, máy hỏi hàng đã đưa xuống chưa rồi ghi lại về ô cũ.</span>
                </Row>
                <Link to={`/wms/move-location?tab=history${moveKey ? `&pallet=${encodeURIComponent(moveKey)}` : ''}`}
                  onClick={() => { anchorDirected(); onClose() }}
                  className="inline-flex items-center gap-1 text-[11px] text-sky-700 hover:underline">
                  <ExternalLink className="h-3 w-3" />
                  {pallets.length === 1 ? 'Lịch sử chuyển vị trí của pallet này' : 'Lịch sử chuyển vị trí từ ô này'}
                </Link>
              </>
            )}
            {row.kind === 'PICK' && (
              <Row label="Nút ✓ Xong">
                <span className="text-slate-600">chỉ đóng mốc giờ cho việc này</span>
                <span className="text-slate-500"> — tồn kho chỉ đổi khi thủ kho quét tem ở cửa xuất.</span>
              </Row>
            )}
          </Section>

          <Section title="Yêu cầu khi lấy">
            <Row label="Quy định date">
              {rule
                ? <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${rule.cls}`}>{rule.text}</span>
                : dash}
            </Row>
            <Row label="Số lượng">
              <span className="font-semibold">{qtyLabel(row.qty_base, units)}</span>
              {row.is_partial && <span className="text-amber-700"> · lấy một phần pallet, phần còn lại để nguyên</span>}
            </Row>
            {row.level_no != null && <Row label="Tầng">{row.level_no}</Row>}
            {tab === 'LOWER' && row.dist_cells != null && <Row label="Quãng đường">{nf(row.dist_cells)} ô</Row>}
          </Section>

          {/* TEM GHIM CHỈ LÀ GỢI Ý (user 14/09): ô cùng date thì pallet nào cũng được — nói thẳng ở đây,
              để người soi kính lúp không đọc danh sách dưới thành mệnh lệnh phải tìm đúng tem. */}
          <Section title={`Pallet kế hoạch ghim (${nf(pallets.length)})`}>
            {(row.n_equiv ?? 0) > pallets.length && (
              <p className="text-[11px] text-slate-600">
                Ô này còn <b>{nf(row.n_equiv ?? 0)}</b> pallet cùng mã, cùng NSX — <b>lấy pallet nào trong số đó cũng được</b>, tem dưới đây chỉ là gợi ý.
                Quét pallet khác cùng NSX vẫn tính là đúng kế hoạch.
              </p>
            )}
            {(row.cell_ndates ?? 1) > 1 && (
              <p className="text-[11px] text-amber-800">Ô này có <b>{nf(row.cell_ndates ?? 0)}</b> NSX khác nhau của cùng mã — phải lấy đúng NSX ghi dưới đây.</p>
            )}
            {pallets.length === 0 ? <p className="text-[11px] text-slate-400">Không có dữ liệu pallet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-[9px] font-medium text-slate-500">
                      <th className="px-1 py-1 text-left">Tem pallet</th>
                      <th className="px-1 py-1 text-left whitespace-nowrap">NSX</th>
                      <th className="px-1 py-1 text-right whitespace-nowrap">%Date</th>
                      <th className="px-1 py-1 text-right whitespace-nowrap">Lấy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pallets.map(p => {
                      const pct = palletPct(p), days = palletDays(p)
                      const off = p.done || p.skipped
                      return (
                        <tr key={p.task_id} className={`border-t border-slate-100 ${off ? 'text-slate-400' : ''}`}>
                          <td className="px-1 py-1">
                            <div className={`font-mono text-[10px] font-semibold break-all ${off ? 'line-through' : ''}`}>{p.code ?? '—'}</div>
                            <div className="text-[9px] text-slate-400">
                              {p.loc_code ?? '—'}{p.level_no != null ? ` · tầng ${p.level_no}` : ''}
                              {p.done ? ' · đã quét' : p.skipped ? ' · đã bỏ' : ''}
                            </div>
                          </td>
                          <td className="px-1 py-1 text-[10px] whitespace-nowrap">{p.production_date ? formatDate(p.production_date) : dash}</td>
                          <td className="px-1 py-1 text-right whitespace-nowrap">
                            {pct == null ? dash : (
                              <>
                                <span className={`text-[11px] font-bold tabular-nums ${off ? '' : pctDateCls(pct, bands)}`}>{pct}%</span>
                                {days != null && <div className="text-[9px] text-slate-400">còn {nf(days)} ngày</div>}
                              </>
                            )}
                          </td>
                          <td className="px-1 py-1 text-right text-[10px] whitespace-nowrap tabular-nums">
                            {qtyLabel(p.qty_base, units)}
                            {p.is_partial && <div className="text-[9px] text-amber-700">một phần</div>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {mats.length > 0 && (
            <Section title="Tra tồn kho">
              <div className="flex flex-wrap gap-1.5">
                {mats.map(m => (
                  <Button key={m.id} variant="outline" className="h-8 px-2 text-[11px]"
                    onClick={() => onStock({ id: m.id, code: m.code ?? '', mat: mats.length === 1 ? row : null })}>
                    <Boxes className="h-3.5 w-3.5 mr-1" />{m.code ?? ''}
                  </Button>
                ))}
              </div>
              {row.material_name && <p className="text-[11px] text-slate-500 pt-1">{row.material_name}</p>}
            </Section>
          )}
        </div>

        {actions.length > 0 && (
          <div className="shrink-0 border-t px-4 py-3 flex gap-2">
            {actions.map(a => (
              <Button key={a.key} variant={a.primary ? 'default' : 'outline'} disabled={busy}
                className={`h-11 text-sm ${a.primary ? 'flex-1' : 'px-3'}`}
                onClick={() => { a.onClick(); onClose() }}>
                <a.icon className="h-4 w-4 mr-1" /> {a.label}
              </Button>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
