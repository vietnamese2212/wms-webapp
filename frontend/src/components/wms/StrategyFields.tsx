// CHIẾN THUẬT XUẤT / NHẬP — MỘT bộ control dùng cho CẢ HAI TẦNG (21/08):
//   • tầng KHO   (`mode='warehouse'`): mọi field có giá trị, đây là mặc định toàn kho
//   • tầng LOẠI  (`mode='type'`)     : mỗi field thêm lựa chọn đầu "— Theo kho (…) —" = kế thừa
// Chép 12 field ra hai nơi thì sớm muộn hai bên lệch nhau (đúng lớp lỗi 4-bản-chép-tay của chính
// luật này hồi 14–15/08) ⇒ đặt ở component NGOÀI trang, không khai trong thân component cha
// (khai lồng = ô nhập mất focus sau 1 ký tự — ratchet component_defined_inside_component gác).
//
// TRÌNH BÀY = khuôn AppSheet (user chốt 24/08): SettingsGroup band tiêu đề + SettingRow
// "tên đậm + diễn giải xám nhìn thấy + control phải/dưới" — xem components/shared/SettingRow.tsx.
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { SettingsGroup, SettingRow } from '@/components/shared/SettingRow'
import {
  PUTAWAY_PRIORITY_OPTS, PUTAWAY_FALLBACK_OPTS, putawayDateMixOpts, putawayDatePrefOpts,
  putawayExplain,
} from '@/utils/putaway'
import { InfoTip } from '@/components/shared/InfoTip'

// Giá trị của MỘT tầng. null (chỉ ở tầng loại) = kế thừa mặc định kho.
export interface StrategyValue {
  rotation_principle:         string | null
  rotation_required:          boolean | null
  putaway_priority:           string | null
  putaway_date_mix:           string | null
  putaway_block_pick_face:    boolean | null
  putaway_block_qa_hold:      boolean | null
  putaway_block_full:         boolean | null
  putaway_single_ncc:         boolean | null
  // Mức xử lý từng luật: `putaway_enforced` = luật ép BẮT BUỘC · `putaway_enforced_off` = luật ép
  // về CHỈ CẢNH BÁO. Ở tầng LOẠI, luật không có trong cả hai = theo kho (kế thừa per-luật, 25/08).
  putaway_enforced:           string[] | null
  putaway_enforced_off:       string[] | null
  putaway_same_mat_date_pref: string | null
  putaway_fallback:           string | null
  // Nhặt lẻ tự sinh 2 tầng (24/08): REMAINDER = phần lẻ dưới pallet (hành vi gốc) · ALL = toàn bộ SL
  // (POSM soạn full trước) · OFF = không nhặt lẻ (ép 0 cả số tay upload cũ). Trần chỉ áp REMAINDER.
  loose_mode:                 string | null
  loose_max_cartons:          number | null
}

export const STRATEGY_EMPTY: StrategyValue = {
  rotation_principle: null, rotation_required: null, putaway_priority: null, putaway_date_mix: null,
  putaway_block_pick_face: null, putaway_block_qa_hold: null,
  putaway_block_full: null, putaway_single_ncc: null,
  putaway_enforced: null, putaway_enforced_off: null,
  putaway_same_mat_date_pref: null, putaway_fallback: null,
  loose_mode: null, loose_max_cartons: null,
}

export const STRATEGY_WAREHOUSE_DEFAULT: StrategyValue = {
  rotation_principle: 'FEFO', rotation_required: false, putaway_priority: 'CONSOLIDATE',
  putaway_date_mix: 'ANY', putaway_block_pick_face: false,
  putaway_block_qa_hold: false, putaway_block_full: false, putaway_single_ncc: false,
  putaway_enforced: [], putaway_enforced_off: null,
  putaway_same_mat_date_pref: 'NONE', putaway_fallback: 'BY_CODE',
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
    if (k === 'putaway_enforced' || k === 'putaway_enforced_off') continue   // ghép per-LUẬT, xem dưới
    const v = type[k]
    if (v !== null && v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  // MIRROR `mergedConfig` bên BE: mức xử lý từng luật kế thừa ĐỘC LẬP — hiệu lực = (kho ∪ loại.bật)
  // \ loại.tắt. Sửa công thức phải sửa CẢ HAI (form nói sai cái BE chạy là lớp lỗi tệ nhất ở đây).
  const off = new Set(type.putaway_enforced_off ?? [])
  out.putaway_enforced = [...new Set([...(wh.putaway_enforced ?? []), ...(type.putaway_enforced ?? [])])]
    .filter(code => !off.has(code))
  return out
}

const INHERIT = '__inherit__'
const BLOCK_ROWS = [
  ['putaway_block_full',      'FULL',      'Không cất vào vị trí đã đầy'],
  ['putaway_block_pick_face', 'PICK_FACE', 'Không cất pallet nguyên vào vị trí nhặt lẻ'],
  ['putaway_block_qa_hold',   'QA_HOLD',   'Không cất vào ô đang có pallet bị QA giữ'],
  ['putaway_single_ncc',      'NCC_MIX',   'Không trộn NCC khác nhau trong một vị trí'],
] as const

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

// Tầng LOẠI: mức xử lý của TỪNG luật có 3 trạng thái độc lập (đồng bộ với các cờ tri-state khác của
// tầng này). Không khai = theo kho — chứ KHÔNG phải "tắt", vì trước 25/08 khai 1 luật là lặng lẽ
// gỡ mọi luật bắt buộc còn lại của kho (đo thật: PM01 khai [Vị trí đầy] làm POSM thoát luật số mã).
type EnfState = 'INHERIT' | 'ON' | 'OFF'
function EnforceTri({ state, whOn, onCycle }: { state: EnfState; whOn: boolean; onCycle: () => void }) {
  const label = state === 'ON' ? 'Bắt buộc'
    : state === 'OFF' ? 'Chỉ cảnh báo'
      : `Theo kho: ${whOn ? 'Bắt buộc' : 'Cảnh báo'}`
  const cls = state === 'ON' ? 'bg-red-50 border-red-300 text-red-700 font-medium'
    : state === 'OFF' ? 'bg-amber-50 border-amber-300 text-amber-700'
      : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
  return (
    <button type="button" onClick={onCycle}
      title="Bấm để đổi: Theo kho → Bắt buộc → Chỉ cảnh báo. Để 'Theo kho' thì luật này chạy đúng như cấu hình kho."
      className={`shrink-0 rounded border px-1.5 py-1 text-[10px] transition-colors ${cls}`}>
      {label}
    </button>
  )
}

export function StrategyFields({ mode, value, inherited, onPatch, idPrefix, wide }: {
  mode: 'warehouse' | 'type'
  value: StrategyValue
  /** Giá trị HIỆU LỰC của tầng kho — tầng loại dùng để in nhãn "— Theo kho (FEFO) —" */
  inherited: StrategyValue
  onPatch: (patch: Partial<StrategyValue>) => void
  idPrefix: string
  /** Panel rộng (form 80% màn hình) → dàn nhóm thành LƯỚI 2 CỘT (user chốt: nhiều cột, khuôn nhất quán) */
  wide?: boolean
}) {
  const isType = mode === 'type'
  // Câu diễn giải luôn nói về CHIẾN THUẬT HIỆU LỰC (sau kế thừa), không phải riêng phần khai thêm
  const eff = isType ? resolveStrategy(inherited, value) : value
  const dateLabel = (eff.rotation_principle ?? 'FEFO') === 'FEFO' ? 'HSD' : 'NSX'
  const enforced = eff.putaway_enforced ?? []
  // Tầng KHO: bật/tắt trực tiếp (kho là gốc, không có gì để kế thừa)
  const toggleEnf = (code: string) => {
    const base = value.putaway_enforced ?? []
    onPatch({ putaway_enforced: base.includes(code) ? base.filter(x => x !== code) : [...base, code] })
  }
  // Tầng LOẠI: xoay vòng Theo kho → Bắt buộc → Chỉ cảnh báo (mảng rỗng ghi null = "không khai")
  const enfStateOf = (code: string): EnfState =>
    (value.putaway_enforced ?? []).includes(code) ? 'ON'
      : (value.putaway_enforced_off ?? []).includes(code) ? 'OFF' : 'INHERIT'
  const cycleEnf = (code: string) => {
    const next: EnfState = enfStateOf(code) === 'INHERIT' ? 'ON' : enfStateOf(code) === 'ON' ? 'OFF' : 'INHERIT'
    const on  = (value.putaway_enforced ?? []).filter(x => x !== code)
    const off = (value.putaway_enforced_off ?? []).filter(x => x !== code)
    const nextOn  = next === 'ON'  ? [...on, code]  : on
    const nextOff = next === 'OFF' ? [...off, code] : off
    onPatch({
      putaway_enforced:     nextOn.length  ? nextOn  : null,
      putaway_enforced_off: nextOff.length ? nextOff : null,
    })
  }
  // Một ô điều khiển cho cả 2 tầng — nơi gọi không phải biết đang ở tầng nào
  const enfCtl = (code: string, id: string) => isType
    ? <EnforceTri state={enfStateOf(code)} whOn={(inherited.putaway_enforced ?? []).includes(code)}
        onCycle={() => cycleEnf(code)} />
    : <EnforceChip id={id} on={enforced.includes(code)} onToggle={() => toggleEnf(code)} />
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
  // Boolean tầng LOẠI = select 3 trạng thái ("không tick" ≠ "theo kho" — loại tắt được luật kho đang bật)
  const triVal = (v: boolean | null) => (v === null ? INHERIT : v ? '1' : '0')
  const triOpts = (inh: boolean) => [
    { value: INHERIT, label: `— Theo kho (${inh ? 'Có' : 'Không'}) —` },
    { value: '1', label: 'Có' },
    { value: '0', label: 'Không' },
  ]
  const boolCtl = (k: keyof StrategyValue, id: string) => isType
    ? <SingleSelect value={triVal(value[k] as boolean | null)}
        onChange={v => onPatch({ [k]: v === INHERIT ? null : v === '1' } as Partial<StrategyValue>)}
        triggerClassName="h-7 w-40 text-[11px]"
        options={triOpts(inherited[k] === true)} />
    : <Switch id={id} checked={value[k] === true}
        onCheckedChange={c => onPatch({ [k]: c } as Partial<StrategyValue>)} />

  return (
    <div className={wide ? 'grid gap-3 xl:grid-cols-2 items-start [&>*]:min-w-0' : 'space-y-3'}>
      {/* ───────── XUẤT — Lấy hàng ───────── */}
      <SettingsGroup title={<>XUẤT — Lấy hàng{own(value.rotation_principle ?? value.rotation_required)}</>}>
        <SettingRow label="Thứ tự lấy hàng"
          desc={<>Khi hai pallet cùng {dateLabel}: app xếp tiếp theo khu gần cửa xuất → ô ít hàng nhất → tên vị trí (thang cố định).</>}>
          <SingleSelect
            value={sel(value.rotation_principle)} onChange={put('rotation_principle')}
            triggerClassName="h-8"
            options={withInherit([
              { value: 'FEFO', label: 'FEFO — hạn dùng ngắn nhất đi trước', sub: 'mặc định, hợp hàng có HSD' },
              { value: 'FIFO', label: 'FIFO — hàng vào trước đi trước',      sub: 'hợp bao bì/vật tư không HSD' },
              { value: 'LIFO', label: 'LIFO — hàng vào sau đi trước',        sub: 'ít dùng, chỉ khi nghiệp vụ yêu cầu' },
            ], inherited.rotation_principle)}
          />
        </SettingRow>
        <SettingRow label={<>Bắt buộc lấy đúng thứ tự{own(value.rotation_required)}</>}
          desc={<>Tắt = chỉ <b>cảnh báo</b> khi quét sai thứ tự. Bật = <b>chặn</b> — quyền "Duyệt lấy khác thứ tự" vẫn qua được nhưng phải chọn lý do (thống kê ở Lịch sử quét).</>}
          htmlFor={isType ? undefined : `${idPrefix}-rotreq`}
          control={boolCtl('rotation_required', `${idPrefix}-rotreq`)} />
      </SettingsGroup>

      {/* ───────── XUẤT — Nhặt lẻ tự sinh (24/08) ───────── */}
      <SettingsGroup title={<>XUẤT — Nhặt lẻ{own(value.loose_mode ?? value.loose_max_cartons)}</>}
        tip={<>
          <b>Không nhặt lẻ</b> ép về 0 kể cả cột "Nhặt lẻ" ghi tay trong file upload kiểu cũ.
          Mã không khai quy cách thùng (CÁI/KG…): chế độ Phần lẻ luôn ra 0 — muốn nhặt lẻ loại đó
          (vd POSM) thì đặt <b>Toàn bộ số lượng</b> ở tầng Loại kho.
        </>}>
        <SettingRow label="Chế độ nhặt lẻ tự sinh"
          desc={<>Áp cho đơn tạo/đồng bộ <b>sau khi đổi</b> — đơn đã tạo giữ số cũ (nút "Tính lại" ở trang Nhặt lẻ).</>}>
          <SingleSelect
            value={sel(value.loose_mode)} onChange={put('loose_mode')}
            triggerClassName="h-8"
            options={withInherit(LOOSE_MODE_OPTS, inherited.loose_mode)}
          />
        </SettingRow>
        {(eff.loose_mode ?? 'REMAINDER') === 'REMAINDER' && (
          <SettingRow label={<>Trần nhặt lẻ (thùng){own(value.loose_max_cartons)}</>}
            desc={<>Phần lẻ quy ra thùng vượt trần → KHÔNG nhặt tay, bốc nguyên pallet rồi khai chỗ đặt phần dư. {isType ? 'Để trống = theo kho.' : 'Để trống = không chặn.'}</>}
            tip={<>Chỉ áp cho chế độ <b>Phần lẻ dưới pallet</b>; so theo quy cách thùng của TỪNG mã.</>}
            control={
              <Input type="number" min={1} max={100000}
                value={value.loose_max_cartons != null ? String(value.loose_max_cartons) : ''}
                onChange={e => {
                  const s = e.target.value.trim()
                  onPatch({ loose_max_cartons: s === '' ? null : Number(s) })
                }}
                placeholder={isType ? `Kho: ${inherited.loose_max_cartons ?? '—'}` : '—'}
                className="h-7 w-24 text-xs text-right" />
            } />
        )}
      </SettingsGroup>

      {/* ───────── NHẬP — thang 3 bước ───────── */}
      <SettingsGroup title="NHẬP — Cất hàng (gợi ý vị trí)"
        tip={<>
          {putawayExplain(eff)}
          <br /><br />
          Áp ở 4 màn cất hàng: form Nhập kho · quét tem (PDA) · đổi vị trí trong phiếu nhập ·
          Chuyển vị trí hàng loạt. Vị trí ★ đứng đầu, vị trí vướng luật xuống cuối.
        </>}>
        <SettingRow label={<>Bước 1 — Ưu tiên nhóm ô{own(value.putaway_priority)}</>}>
          <SingleSelect value={sel(value.putaway_priority)} onChange={put('putaway_priority')}
            triggerClassName="h-8"
            options={withInherit(PUTAWAY_PRIORITY_OPTS, inherited.putaway_priority)} />
          {eff.putaway_priority === 'ABC' && (
            <p className="mt-1 flex items-start gap-1 text-[10px] text-amber-600">
              <span>Cần xếp <b>Hạng nhặt</b> cho khu ở <b>Tối ưu vị trí → Cài đặt</b>, chưa xếp thì chạy như Gom.</span>
              <InfoTip side="top" tip={<>Hạng nhặt: 1 = gần cửa xuất nhất. Hạng ABC của mã lấy từ lượt nhặt <b>30 ngày</b> gần nhất, cùng nguồn với trang Tối ưu vị trí.</>} />
            </p>
          )}
        </SettingRow>
        <SettingRow label={<>Bước 2 — Trong các ô cùng mã, ưu tiên{own(value.putaway_same_mat_date_pref)}</>}
          tip={<>So theo <b>thứ tự lấy</b> của kho nên phát biểu đúng cho cả FEFO (so HSD) lẫn FIFO/LIFO (so NSX). Chỉ có tác dụng khi ô đã có hàng cùng mã và pallet đang cất biết được {dateLabel}.</>}>
          <SingleSelect value={sel(value.putaway_same_mat_date_pref)} onChange={put('putaway_same_mat_date_pref')}
            triggerClassName="h-8"
            options={withInherit(putawayDatePrefOpts(dateLabel), inherited.putaway_same_mat_date_pref)} />
        </SettingRow>
        <SettingRow label={<>Bước 3 — Các vị trí còn lại xếp theo{own(value.putaway_fallback)}</>}
          tip={<>Áp cho các ô KHÔNG thuộc nhóm ưu tiên ở Bước 1. Chiến thuật <b>Rải</b> đã tự xếp theo chỗ trống nên Bước 3 không áp thêm.</>}>
          <SingleSelect value={sel(value.putaway_fallback)} onChange={put('putaway_fallback')}
            triggerClassName="h-8"
            options={withInherit(PUTAWAY_FALLBACK_OPTS, inherited.putaway_fallback)} />
        </SettingRow>
      </SettingsGroup>

      {/* ───────── NHẬP — ràng buộc ───────── */}
      <SettingsGroup title="NHẬP — Ràng buộc vị trí"
        tip={<>
          Không tick <b>Bắt buộc</b> = chỉ <b>cảnh báo</b>: loại khỏi gợi ý + khỏi kế hoạch Slotting, nhưng cất vẫn được và có ghi vết.
          Tick = <b>CHẶN</b> — chỉ người có quyền <b>Duyệt cất khác quy tắc</b> mới qua được, và phải chọn lý do trong danh sách.
          <br /><br />
          Chặn ở <b>mọi thao tác đặt pallet vào vị trí</b>: tạo phiếu nhập · đổi vị trí trong phiếu nhập ·
          quét tem vào vị trí · Chuyển vị trí hàng loạt. Riêng chỗ đặt <b>phần dư khi quét xuất</b> cố ý
          KHÔNG chặn — người quét buộc phải khai được chỗ để lại.
        </>}>
        <SettingRow label={<>Vị trí đánh dấu “Không đưa hàng vào”</>}
          desc="Khai ở trang Vị trí kho. Luôn bị loại khỏi gợi ý — chip Bắt buộc quyết định lúc cất thật có chặn hay không."
          control={enfCtl('NO_IN', `${idPrefix}-enf-noin`)} />
        <SettingRow label={<>Trộn {dateLabel} trong một vị trí{own(value.putaway_date_mix)}</>}
          tip={<>Luật này cần biết {dateLabel} của pallet nên chỉ kết luận được <b>lúc quét/ghi nhận</b>. Ở ô chọn vị trí (trước khi quét) chưa có date để so nên không đánh dấu gì.</>}
          control={eff.putaway_date_mix !== 'ANY'
            ? enfCtl('DATE_MIX', `${idPrefix}-enf-datemix`)
            : undefined}>
          <SingleSelect value={sel(value.putaway_date_mix)} onChange={put('putaway_date_mix')}
            triggerClassName="h-8"
            options={withInherit(putawayDateMixOpts(dateLabel), inherited.putaway_date_mix)} />
        </SettingRow>
        {/* Số mã tối đa: CON SỐ khai ở TỪNG VỊ TRÍ (26/08), không còn ở kho/loại kho — nơi chứa
            chung ("Ngoài đường", "Mặt đất") nằm cùng khu + cùng loại hàng với kệ thường nên không
            tầng nào của kho tách được chúng. Ở đây chỉ còn MỨC XỬ LÝ, đồng bộ với 6 luật kia. */}
        {!isType && (
          <SettingRow label="Số mã tối đa trong một vị trí"
            desc="Khai số ở từng vị trí (trang Vị trí kho — để trống = không giới hạn). Ở đây chỉ chọn: vượt trần thì chặn hay chỉ cảnh báo."
            control={enfCtl('MAX_MATERIALS', `${idPrefix}-enf-maxmat`)} />
        )}
        {BLOCK_ROWS.map(([key, code, title]) => (
          <SettingRow key={key} label={<>{title}{own(value[key])}</>}
            htmlFor={isType ? undefined : `${idPrefix}-${code}`}
            control={<>
              {eff[key] === true && (
                enfCtl(code, `${idPrefix}-${code}-enf`)
              )}
              {boolCtl(key, `${idPrefix}-${code}`)}
            </>} />
        ))}
        <div className="py-2 text-[10px] text-slate-400">
          {enforced.length === 0
            ? <>Hiện <b>không luật nào chặn</b> — tất cả chỉ cảnh báo.</>
            : <><b className="text-red-600">{enforced.length} luật</b> đang chặn thật khi cất hàng.</>}
        </div>
      </SettingsGroup>
    </div>
  )
}
