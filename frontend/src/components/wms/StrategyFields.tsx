// CHIẾN THUẬT XUẤT / NHẬP — MỘT bộ control dùng cho CẢ HAI TẦNG (21/08):
//   • tầng KHO   (`mode='warehouse'`): mọi field có giá trị, đây là mặc định toàn kho
//   • tầng LOẠI  (`mode='type'`)     : mỗi field thêm lựa chọn đầu "— Theo kho (…) —" = kế thừa
// Chép 12 field ra hai nơi thì sớm muộn hai bên lệch nhau (đúng lớp lỗi 4-bản-chép-tay của chính
// luật này hồi 14–15/08) ⇒ đặt ở component NGOÀI trang, không khai trong thân component cha
// (khai lồng = ô nhập mất focus sau 1 ký tự — ratchet component_defined_inside_component gác).
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { InfoTip } from '@/components/shared/InfoTip'
import {
  PUTAWAY_PRIORITY_OPTS, PUTAWAY_FALLBACK_OPTS, putawayDateMixOpts, putawayDatePrefOpts,
  putawayExplain,
} from '@/utils/putaway'

// Giá trị của MỘT tầng. null (chỉ ở tầng loại) = kế thừa mặc định kho.
export interface StrategyValue {
  rotation_principle:         string | null
  rotation_required:          boolean | null
  putaway_priority:           string | null
  putaway_date_mix:           string | null
  putaway_max_materials:      number | null
  putaway_block_pick_face:    boolean | null
  putaway_block_qa_hold:      boolean | null
  putaway_block_full:         boolean | null
  putaway_single_ncc:         boolean | null
  putaway_enforced:           string[] | null
  putaway_same_mat_date_pref: string | null
  putaway_fallback:           string | null
  // Nhặt lẻ tự sinh 2 tầng (24/08): REMAINDER = phần lẻ dưới pallet (hành vi gốc) · ALL = toàn bộ SL
  // (POSM soạn full trước) · OFF = không nhặt lẻ (ép 0 cả số tay upload cũ). Trần chỉ áp REMAINDER.
  loose_mode:                 string | null
  loose_max_cartons:          number | null
}

export const STRATEGY_EMPTY: StrategyValue = {
  rotation_principle: null, rotation_required: null, putaway_priority: null, putaway_date_mix: null,
  putaway_max_materials: null, putaway_block_pick_face: null, putaway_block_qa_hold: null,
  putaway_block_full: null, putaway_single_ncc: null, putaway_enforced: null,
  putaway_same_mat_date_pref: null, putaway_fallback: null,
  loose_mode: null, loose_max_cartons: null,
}

export const STRATEGY_WAREHOUSE_DEFAULT: StrategyValue = {
  rotation_principle: 'FEFO', rotation_required: false, putaway_priority: 'CONSOLIDATE',
  putaway_date_mix: 'ANY', putaway_max_materials: null, putaway_block_pick_face: false,
  putaway_block_qa_hold: false, putaway_block_full: false, putaway_single_ncc: false,
  putaway_enforced: [], putaway_same_mat_date_pref: 'NONE', putaway_fallback: 'BY_CODE',
  loose_mode: 'REMAINDER', loose_max_cartons: null,
}

export const LOOSE_MODE_OPTS = [
  { value: 'REMAINDER', label: 'Phần lẻ dưới pallet', sub: 'mặc định — thùng lẻ không chẵn pallet mới nhặt tay' },
  { value: 'ALL',       label: 'Toàn bộ số lượng',    sub: 'cả đơn vào nhặt lẻ — soạn full trước (POSM…)' },
  { value: 'OFF',       label: 'Không nhặt lẻ',       sub: 'xuất nguyên pallet + khai chỗ đặt phần dư' },
] as const

// Ghép 2 tầng — MIRROR `resolvePutawayRules`/`resolveRotation` bên BE để form nói đúng cái BE chạy.
export function resolveStrategy(wh: StrategyValue, type: StrategyValue | null): StrategyValue {
  if (!type) return wh
  const out = { ...wh }
  for (const k of Object.keys(wh) as (keyof StrategyValue)[]) {
    const v = type[k]
    if (v !== null && v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  return out
}

const INHERIT = '__inherit__'
const BLOCK_ROWS = [
  ['putaway_block_full',      'FULL',      'Không cất vào vị trí đã đầy'],
  ['putaway_block_pick_face', 'PICK_FACE', 'Không cất pallet nguyên vào vị trí nhặt lẻ'],
  ['putaway_block_qa_hold',   'QA_HOLD',   'Không cất vào ô đang có pallet bị QA giữ'],
  ['putaway_single_ncc',      'NCC_MIX',   'Không trộn NCC khác nhau trong một vị trí'],
] as const

// Đầu mục khối = mini section-band (đợt UI 24/08 — user chê form "cái thò cái thụt", đầu mục
// không nổi): nền slate + vạch accent sky + chữ IN HOA đậm màu, full-bleed trong khung viền.
function SecTitle({ children, tip }: { children: React.ReactNode; tip: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 -mx-2.5 -mt-2 mb-1 px-2 py-1.5 bg-slate-50 border-b border-slate-200 rounded-t-md">
      <span className="h-3 w-1 rounded-full bg-sky-500 shrink-0" />
      <Label className="text-[11px] font-bold uppercase tracking-wide text-sky-900 flex items-center">{children}</Label>
      <InfoTip tip={tip} />
    </span>
  )
}

function EnforceChip({ id, on, onToggle }: { id: string; on: boolean; onToggle: () => void }) {
  return (
    <label htmlFor={id}
      title={on ? 'Đang CHẶN — bỏ tick để chỉ cảnh báo' : 'Đang chỉ CẢNH BÁO — tick để chặn thật'}
      className={`shrink-0 flex items-center gap-1 cursor-pointer rounded border px-1.5 py-1 text-[10px] transition-colors ${
        on ? 'bg-red-50 border-red-300 text-red-700 font-medium' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
      <input id={id} type="checkbox" checked={on} onChange={onToggle} className="h-3 w-3 rounded accent-red-600 shrink-0" />
      Bắt buộc
    </label>
  )
}

// Ô CÓ/KHÔNG của tầng loại: phải là 3 trạng thái vì "không tick" ≠ "theo kho" — loại tắt được luật
// mà kho đang bật, và đó là ý định hợp lệ (RM01 không cần chặn ô đầy dù kho có chặn).
function TriBool({ value, onChange, label, inherited, tip }: {
  value: boolean | null; onChange: (v: boolean | null) => void
  label: string; inherited: boolean; tip?: React.ReactNode
}) {
  // Nhãn NẰM TRÊN ô chọn (không kẹp cùng hàng): cột hẹp thì nhãn dài bị cắt cụt thành
  // "Không cất vào …" — đọc không ra luật gì. Xếp dọc cũng khớp các ô khác trong cùng khối.
  // KHÔNG px lệch riêng — mọi hàng trong khối thẳng cùng mép trái (user chê "thò thụt" 24/08).
  return (
    <div className="py-1">
      <span className="flex items-center gap-1">
        <span className="text-[11px] text-slate-500">{label}</span>
        {tip ? <InfoTip tip={tip} /> : null}
      </span>
      <SingleSelect
        value={value === null ? INHERIT : value ? '1' : '0'}
        onChange={v => onChange(v === INHERIT ? null : v === '1')}
        triggerClassName="h-7 text-[11px]"
        options={[
          { value: INHERIT, label: `— Theo kho (${inherited ? 'Có' : 'Không'}) —` },
          { value: '1', label: 'Có' },
          { value: '0', label: 'Không' },
        ]}
      />
    </div>
  )
}

export function StrategyFields({ mode, value, inherited, onPatch, idPrefix, wide }: {
  mode: 'warehouse' | 'type'
  value: StrategyValue
  /** Giá trị HIỆU LỰC của tầng kho — tầng loại dùng để in nhãn "— Theo kho (FEFO) —" */
  inherited: StrategyValue
  onPatch: (patch: Partial<StrategyValue>) => void
  idPrefix: string
  /** Panel rộng (form 80% màn hình) → xếp 3 khối thành cột cho đỡ phải cuộn dài */
  wide?: boolean
}) {
  const isType = mode === 'type'
  // Câu diễn giải luôn nói về CHIẾN THUẬT HIỆU LỰC (sau kế thừa), không phải riêng phần khai thêm
  const eff = isType ? resolveStrategy(inherited, value) : value
  const dateLabel = (eff.rotation_principle ?? 'FEFO') === 'FEFO' ? 'HSD' : 'NSX'
  const enforced = eff.putaway_enforced ?? []
  const ownEnforced = value.putaway_enforced
  const toggleEnf = (code: string) => {
    const base = ownEnforced ?? (isType ? [...enforced] : [])
    onPatch({ putaway_enforced: base.includes(code) ? base.filter(x => x !== code) : [...base, code] })
  }
  // Ở tầng loại: chọn "— Theo kho —" nghĩa là ghi null; ô select không nhận null nên quy về sentinel
  const sel = (v: string | null) => (isType && v === null ? INHERIT : (v ?? ''))
  const put = (k: keyof StrategyValue) => (v: string) =>
    onPatch({ [k]: v === INHERIT ? null : v } as Partial<StrategyValue>)
  const withInherit = (opts: readonly { value: string; label: string; sub?: string }[], cur: string | null | undefined) =>
    isType
      ? [{ value: INHERIT, label: `— Theo kho (${opts.find(o => o.value === cur)?.label ?? '—'}) —` }, ...opts]
      : [...opts]
  const own = (v: unknown) => (isType && v !== null && v !== undefined
    ? <span className="ml-1 rounded bg-sky-100 px-1 text-[9px] font-medium text-sky-700">riêng</span> : null)

  return (
    <div className={wide ? 'grid gap-2.5 lg:grid-cols-3 items-start [&>*]:min-w-0' : 'space-y-2.5'}>
      {/* ───────── XUẤT ───────── */}
      <div className="space-y-1.5 rounded-md border border-slate-200 px-2.5 py-2">
        <SecTitle tip={<>
          Thứ tự lấy hàng: <b>{eff.rotation_principle ?? 'FEFO'}</b>
          {eff.rotation_required ? ' — BẮT BUỘC (quét sai thứ tự bị chặn)' : ' — chỉ cảnh báo khi quét sai'}.
          <br /><br />
          Khi hai pallet cùng {dateLabel}, app xếp tiếp theo: <b>khu gần cửa xuất</b> (hạng nhặt khai ở
          Tối ưu vị trí) → <b>ô ít hàng nhất</b> (vét lẻ trước) → tên vị trí. Thang này CỐ ĐỊNH, không
          bao giờ đổi được thứ tự lấy hàng theo nguyên tắc ở trên.
        </>}>XUẤT — Lấy hàng{own(value.rotation_principle ?? value.rotation_required)}</SecTitle>
        <SingleSelect
          value={sel(value.rotation_principle)} onChange={put('rotation_principle')}
          triggerClassName="h-8"
          options={withInherit([
            { value: 'FEFO', label: 'FEFO — hạn dùng ngắn nhất đi trước', sub: 'mặc định, hợp hàng có HSD' },
            { value: 'FIFO', label: 'FIFO — hàng vào trước đi trước',      sub: 'hợp bao bì/vật tư không HSD' },
            { value: 'LIFO', label: 'LIFO — hàng vào sau đi trước',        sub: 'ít dùng, chỉ khi nghiệp vụ yêu cầu' },
          ], inherited.rotation_principle)}
        />
        {isType ? (
          <TriBool label="Bắt buộc lấy đúng thứ tự" value={value.rotation_required}
            inherited={inherited.rotation_required === true} onChange={v => onPatch({ rotation_required: v })}
            tip={<>Chặn quét sai thứ tự cho RIÊNG loại hàng này. Người có quyền <b>Duyệt lấy khác thứ tự</b> vẫn qua được nhưng phải chọn lý do.</>} />
        ) : (
          <div className="flex items-center gap-1.5 py-1 hover:bg-slate-50">
            <label htmlFor={`${idPrefix}-rotreq`} className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
              <input id={`${idPrefix}-rotreq`} type="checkbox" checked={value.rotation_required === true}
                onChange={e => onPatch({ rotation_required: e.target.checked })}
                className="h-4 w-4 rounded accent-blue-600 shrink-0" />
              <span className="text-xs font-medium truncate">Bắt buộc lấy đúng thứ tự</span>
            </label>
            <InfoTip tip={<>Không tick = chỉ <b>cảnh báo</b> khi quét sai thứ tự. Tick = <b>CHẶN</b> — người có quyền <b>Duyệt lấy khác thứ tự</b> vẫn qua được nhưng phải chọn lý do, và lý do được thống kê ở trang Lịch sử quét.</>} />
          </div>
        )}
      </div>

      {/* ───────── XUẤT — Nhặt lẻ tự sinh (24/08) ───────── */}
      <div className="space-y-1.5 rounded-md border border-slate-200 px-2.5 py-2">
        <SecTitle tip={<>
          Khi tạo đơn / upload kế hoạch, app tự tính phần <b>nhặt lẻ</b> của từng mã theo chế độ này.
          Áp cho đơn tạo <b>sau khi đổi</b> — đơn đã tạo giữ số cũ (nút "Tính lại" ở trang Nhặt lẻ).
          <br /><br />
          <b>Không nhặt lẻ</b> ép về 0 kể cả cột "Nhặt lẻ" ghi tay trong file upload kiểu cũ.
          Mã không khai quy cách thùng (CÁI/KG…): chế độ Phần lẻ luôn ra 0 — muốn nhặt lẻ loại đó
          (vd POSM) thì đặt <b>Toàn bộ số lượng</b> ở tầng Loại kho.
        </>}>XUẤT — Nhặt lẻ{own(value.loose_mode ?? value.loose_max_cartons)}</SecTitle>
        <SingleSelect
          value={sel(value.loose_mode)} onChange={put('loose_mode')}
          triggerClassName="h-8"
          options={withInherit(LOOSE_MODE_OPTS, inherited.loose_mode)}
        />
        {(isType ? resolveStrategy(inherited, value).loose_mode ?? 'REMAINDER' : value.loose_mode ?? 'REMAINDER') === 'REMAINDER' && (
          <div>
            <span className="flex items-center gap-1">
              <Label className="text-[11px] text-slate-500">Trần nhặt lẻ (thùng){own(value.loose_max_cartons)}</Label>
              <InfoTip tip={<>Phần lẻ quy ra <b>thùng</b> vượt trần thì KHÔNG đưa vào nhặt lẻ (bốc nguyên pallet rồi khai chỗ đặt phần dư nhanh hơn nhặt tay từng thùng). Chỉ áp cho chế độ <b>Phần lẻ dưới pallet</b>; so theo quy cách thùng của TỪNG mã.</>} />
            </span>
            <Input type="number" min={1} max={100000}
              value={value.loose_max_cartons != null ? String(value.loose_max_cartons) : ''}
              onChange={e => {
                const s = e.target.value.trim()
                onPatch({ loose_max_cartons: s === '' ? null : Number(s) })
              }}
              placeholder={isType
                ? `— Theo kho (${inherited.loose_max_cartons ?? 'không chặn'}) —`
                : 'để trống = không chặn'}
              className="h-8 text-xs" />
          </div>
        )}
      </div>

      {/* ───────── NHẬP — thang 3 bước ───────── */}
      <div className="space-y-1.5 rounded-md border border-slate-200 px-2.5 py-2">
        <SecTitle tip={<>
          {putawayExplain(eff)}
          <br /><br />
          Áp ở 4 màn cất hàng: form Nhập kho · quét tem (PDA) · đổi vị trí trong phiếu nhập ·
          Chuyển vị trí hàng loạt. Vị trí ★ đứng đầu, vị trí vướng luật xuống cuối.
        </>}>NHẬP — Cất hàng (gợi ý vị trí)</SecTitle>
        <div>
          <Label className="text-[11px] text-slate-500">Bước 1 — Ưu tiên nhóm ô{own(value.putaway_priority)}</Label>
          <SingleSelect value={sel(value.putaway_priority)} onChange={put('putaway_priority')}
            triggerClassName="h-8"
            options={withInherit(PUTAWAY_PRIORITY_OPTS, inherited.putaway_priority)} />
          {eff.putaway_priority === 'ABC' && (
            <p className="mt-1 flex items-start gap-1 text-[10px] text-amber-600">
              <span>Cần xếp <b>Hạng nhặt</b> cho khu ở <b>Tối ưu vị trí → Cài đặt</b>, chưa xếp thì chạy như Gom.</span>
              <InfoTip side="top" tip={<>Hạng nhặt: 1 = gần cửa xuất nhất. Hạng ABC của mã lấy từ lượt nhặt <b>30 ngày</b> gần nhất, cùng nguồn với trang Tối ưu vị trí.</>} />
            </p>
          )}
        </div>
        <div>
          <span className="flex items-center gap-1">
            <Label className="text-[11px] text-slate-500">Bước 2 — Trong các ô cùng mã, ưu tiên{own(value.putaway_same_mat_date_pref)}</Label>
            <InfoTip tip={<>So theo <b>thứ tự lấy</b> của kho nên phát biểu đúng cho cả FEFO (so HSD) lẫn FIFO/LIFO (so NSX). Chỉ có tác dụng khi ô đã có hàng cùng mã và pallet đang cất biết được {dateLabel}.</>} />
          </span>
          <SingleSelect value={sel(value.putaway_same_mat_date_pref)} onChange={put('putaway_same_mat_date_pref')}
            triggerClassName="h-8"
            options={withInherit(putawayDatePrefOpts(dateLabel), inherited.putaway_same_mat_date_pref)} />
        </div>
        <div>
          <span className="flex items-center gap-1">
            <Label className="text-[11px] text-slate-500">Bước 3 — Các vị trí còn lại xếp theo{own(value.putaway_fallback)}</Label>
            <InfoTip tip={<>Áp cho các ô KHÔNG thuộc nhóm ưu tiên ở Bước 1. Chiến thuật <b>Rải</b> đã tự xếp theo chỗ trống nên Bước 3 không áp thêm.</>} />
          </span>
          <SingleSelect value={sel(value.putaway_fallback)} onChange={put('putaway_fallback')}
            triggerClassName="h-8"
            options={withInherit(PUTAWAY_FALLBACK_OPTS, inherited.putaway_fallback)} />
        </div>
      </div>

      {/* ───────── NHẬP — ràng buộc ───────── */}
      <div className="space-y-1.5 rounded-md border border-slate-200 px-2.5 py-2">
        <SecTitle tip={<>
          Không tick <b>Bắt buộc</b> = chỉ <b>cảnh báo</b>: loại khỏi gợi ý + khỏi kế hoạch Slotting, nhưng cất vẫn được và có ghi vết.
          Tick = <b>CHẶN</b> — chỉ người có quyền <b>Duyệt cất khác quy tắc</b> mới qua được, và phải chọn lý do trong danh sách.
          <br /><br />
          Chặn ở <b>mọi thao tác đặt pallet vào vị trí</b>: tạo phiếu nhập · đổi vị trí trong phiếu nhập ·
          quét tem vào vị trí · Chuyển vị trí hàng loạt. Riêng chỗ đặt <b>phần dư khi quét xuất</b> cố ý
          KHÔNG chặn — người quét buộc phải khai được chỗ để lại.
        </>}>NHẬP — Ràng buộc vị trí</SecTitle>
        <div className="flex items-center gap-1.5 py-1">
          <span className="text-[11px] text-slate-700 flex-1 min-w-0">Vị trí đánh dấu “Không đưa hàng vào”</span>
          <InfoTip tip={<>Khai ở trang <b>Vị trí kho</b>. Vị trí đó LUÔN bị loại khỏi gợi ý — ô tick bên phải chỉ quyết định lúc cất thật có chặn hay không.</>} />
          <EnforceChip id={`${idPrefix}-enf-noin`} on={enforced.includes('NO_IN')} onToggle={() => toggleEnf('NO_IN')} />
        </div>
        <div>
          <span className="flex items-center gap-1">
            <Label className="text-[11px] text-slate-500">Trộn {dateLabel} trong một vị trí{own(value.putaway_date_mix)}</Label>
            <InfoTip tip={<>Luật này cần biết {dateLabel} của pallet nên chỉ kết luận được <b>lúc quét/ghi nhận</b>. Ở ô chọn vị trí (trước khi quét) chưa có date để so nên không đánh dấu gì.</>} />
          </span>
          <SingleSelect value={sel(value.putaway_date_mix)} onChange={put('putaway_date_mix')}
            triggerClassName="h-8"
            options={withInherit(putawayDateMixOpts(dateLabel), inherited.putaway_date_mix)} />
          {eff.putaway_date_mix !== 'ANY' && (
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[10px] text-slate-500">Mức xử lý khi vi phạm luật trộn date</span>
              <EnforceChip id={`${idPrefix}-enf-datemix`} on={enforced.includes('DATE_MIX')} onToggle={() => toggleEnf('DATE_MIX')} />
            </div>
          )}
        </div>
        <div>
          <Label className="text-[11px] text-slate-500">Số mã tối đa trong một vị trí{own(value.putaway_max_materials)}</Label>
          <Input type="number" min={1} max={1000}
            value={value.putaway_max_materials != null ? String(value.putaway_max_materials) : ''}
            onChange={e => {
              const s = e.target.value.trim()
              onPatch({ putaway_max_materials: s === '' ? null : Number(s) })
            }}
            placeholder={isType
              ? `— Theo kho (${inherited.putaway_max_materials ?? 'không giới hạn'}) —`
              : 'để trống = không giới hạn'}
            className="h-8 text-xs" />
          {eff.putaway_max_materials != null && (
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[10px] text-slate-500">Mức xử lý khi vượt số mã</span>
              <EnforceChip id={`${idPrefix}-enf-maxmat`} on={enforced.includes('MAX_MATERIALS')} onToggle={() => toggleEnf('MAX_MATERIALS')} />
            </div>
          )}
        </div>
        {BLOCK_ROWS.map(([key, code, title]) => (
          isType ? (
            <div key={key} className="space-y-0.5">
              <TriBool label={title} value={value[key] as boolean | null}
                inherited={inherited[key] === true} onChange={v => onPatch({ [key]: v } as Partial<StrategyValue>)} />
              {eff[key] === true && (
                <div className="flex items-center justify-between gap-2 pl-1">
                  <span className="text-[10px] text-slate-500">Mức xử lý</span>
                  <EnforceChip id={`${idPrefix}-${code}-enf`} on={enforced.includes(code)} onToggle={() => toggleEnf(code)} />
                </div>
              )}
            </div>
          ) : (
            <div key={key} className="flex items-center gap-1.5 py-1 hover:bg-slate-50">
              <label htmlFor={`${idPrefix}-${code}`} className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                <input id={`${idPrefix}-${code}`} type="checkbox" checked={value[key] === true}
                  onChange={e => onPatch({ [key]: e.target.checked } as Partial<StrategyValue>)}
                  className="h-4 w-4 rounded accent-blue-600 shrink-0" />
                <span className="text-xs font-medium truncate">{title}</span>
              </label>
              {value[key] === true && (
                <EnforceChip id={`${idPrefix}-${code}-enf`} on={enforced.includes(code)} onToggle={() => toggleEnf(code)} />
              )}
            </div>
          )
        ))}
        <div className="border-t border-slate-100 pt-2 text-[10px] text-slate-400">
          {enforced.length === 0
            ? <>Hiện <b>không luật nào chặn</b> — tất cả chỉ cảnh báo.</>
            : <><b className="text-red-600">{enforced.length} luật</b> đang chặn thật khi cất hàng.</>}
        </div>
      </div>
    </div>
  )
}
