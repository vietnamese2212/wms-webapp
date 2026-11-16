// TRÌNH SỬA MẪU PHIẾU THEO DÕI — dùng chung cho Cài đặt MES (mẫu chung) và cho MỘT phiếu của mẻ (sửa riêng lần đó, tại bàn).
// Khối "Nhóm ô": mỗi ô một hàng — nhãn · kiểu (Số / Giờ / Chữ) · đơn vị + ngưỡng (ô số) · ⋯ (ô rộng, điền sẵn) · lên / xuống / bỏ.
// Khối "Bảng theo dõi": số lần × cột × ô mỗi cột (vd 8 lần × 3 bồn sục × giờ / °C / pH).
// Mã ô sinh tự động từ nhãn khi ô CÒN MỚI; ô đã có trong bản đã lưu (lockedKeys) giữ nguyên mã — phiếu đã ghi bám vào mã.
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, X, Plus, MoreHorizontal, Table2, LayoutList, Minus, Check } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  KIND_LABEL, PREFILL_LABEL, MAX_CELLS, blockCellCount, slugKey, shortKey, usedKeys, gridKeyFor,
  type FormBlock, type FieldsBlock, type GridBlock, type ProcessField, type FieldKind, type Prefill,
} from '@/config/processForms'
import { parseVnNumber } from '@/utils/vnNumber'

const fmtNum = (n: number | undefined) => (n == null ? '' : String(n).replace('.', ','))
const move = <T,>(a: T[], i: number, d: -1 | 1): T[] => {
  const j = i + d
  if (j < 0 || j >= a.length) return a
  const b = [...a]; [b[i], b[j]] = [b[j], b[i]]; return b
}
const iconBtn = 'touch-target inline-flex items-center justify-center rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent'

/** Ô số giữ chữ đang gõ ("7," chưa xong), chỉ đẩy số ra khi rời ô */
function NumInput({ value, onChange, placeholder, disabled, label }: { value: number | undefined; onChange: (n: number | undefined) => void; placeholder: string; disabled?: boolean; label: string }) {
  const [t, setT] = useState(fmtNum(value))
  useEffect(() => { setT(fmtNum(value)) }, [value])
  const bad = !!t.trim() && parseVnNumber(t) == null
  return (
    <Input value={t} disabled={disabled} placeholder={placeholder} aria-label={label} inputMode="decimal"
      onChange={e => setT(e.target.value)}
      onBlur={() => { const n = t.trim() ? parseVnNumber(t) : undefined; if (n !== null) onChange(n ?? undefined) }}
      className={`h-8 w-14 text-xs text-right tabular-nums px-1.5 ${bad ? 'border-red-400' : ''}`} />
  )
}

export function KindSeg({ value, onChange, disabled }: { value: FieldKind; onChange: (k: FieldKind) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex h-8 shrink-0 rounded-md border border-slate-200 overflow-hidden text-[11px]">
      {(Object.keys(KIND_LABEL) as FieldKind[]).map((k, i) => (
        <button key={k} type="button" disabled={disabled} onClick={() => onChange(k)}
          className={`px-2 ${i ? 'border-l border-slate-200' : ''} ${value === k ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{KIND_LABEL[k]}</button>
      ))}
    </div>
  )
}

function FieldRow({ f, onChange, onMove, onRemove, first, last, disabled }: {
  f: ProcessField; onChange: (p: Partial<ProcessField>) => void; onMove: (d: -1 | 1) => void; onRemove: () => void; first: boolean; last: boolean; disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1.5 border-b border-slate-100 last:border-b-0">
      <Input value={f.label} disabled={disabled} onChange={e => onChange({ label: e.target.value })} placeholder="Tên ô (vd Nhiệt độ trộn)" maxLength={120}
        aria-label="Tên ô" className={`order-1 h-8 text-xs w-0 basis-0 flex-1 min-w-[9rem] ${!f.label.trim() ? 'border-amber-400' : ''}`} />
      {/* điện thoại: dòng 1 = tên ô + nút; dòng 2 = kiểu + đơn vị + ngưỡng. Máy tính: một dòng */}
      <div className="order-3 sm:order-2 flex items-center gap-1.5">
      <KindSeg value={f.kind} disabled={disabled} onChange={k => onChange(k === 'num' ? { kind: k } : { kind: k, min: undefined, max: undefined })} />
      {f.kind === 'num' && <>
        <Input value={f.unit ?? ''} disabled={disabled} onChange={e => onChange({ unit: e.target.value || undefined })} placeholder="Đ.vị" maxLength={20}
          aria-label="Đơn vị" className="h-8 w-14 text-xs px-1.5" />
        <NumInput value={f.min} onChange={n => onChange({ min: n })} placeholder="≥" label="Ngưỡng dưới" disabled={disabled} />
        <NumInput value={f.max} onChange={n => onChange({ max: n })} placeholder="≤" label="Ngưỡng trên" disabled={disabled} />
      </>}
      </div>
      <div className="order-2 sm:order-3 flex items-center ml-auto">
        {(f.wide || f.prefill) && <span className="hidden sm:inline mr-1 text-[9px] rounded bg-slate-100 px-1 text-slate-500 whitespace-nowrap">{[f.wide && 'rộng', f.prefill && 'điền sẵn'].filter(Boolean).join(' · ')}</span>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button type="button" className={iconBtn} title="Tuỳ chọn khác"><MoreHorizontal className="h-3.5 w-3.5" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="text-xs">
            <DropdownMenuItem onClick={() => onChange({ wide: f.wide ? undefined : true })}>
              <Check className={`h-3.5 w-3.5 mr-1.5 ${f.wide ? '' : 'opacity-0'}`} />Ô rộng cả hàng (ghi chú dài)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] text-slate-500">Phiếu mới tự điền</DropdownMenuLabel>
            {([undefined, 'machine_code', 'planned_qty'] as (Prefill | undefined)[]).map(p => (
              <DropdownMenuItem key={p ?? 'none'} onClick={() => onChange({ prefill: p })}>
                <Check className={`h-3.5 w-3.5 mr-1.5 ${f.prefill === p ? '' : 'opacity-0'}`} />{p ? PREFILL_LABEL[p] : 'Không'}
              </DropdownMenuItem>
            ))}
            {/* điện thoại: lên / xuống nằm trong menu để tên ô + nút đủ một dòng */}
            <DropdownMenuSeparator className="sm:hidden" />
            <DropdownMenuItem className="sm:hidden" disabled={first} onClick={() => onMove(-1)}><ArrowUp className="h-3.5 w-3.5 mr-1.5" />Đưa lên</DropdownMenuItem>
            <DropdownMenuItem className="sm:hidden" disabled={last} onClick={() => onMove(1)}><ArrowDown className="h-3.5 w-3.5 mr-1.5" />Đưa xuống</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" className={`${iconBtn} hidden sm:inline-flex`} disabled={disabled || first} onClick={() => onMove(-1)} title="Lên"><ArrowUp className="h-3.5 w-3.5" /></button>
        <button type="button" className={`${iconBtn} hidden sm:inline-flex`} disabled={disabled || last} onClick={() => onMove(1)} title="Xuống"><ArrowDown className="h-3.5 w-3.5" /></button>
        <button type="button" className={`${iconBtn} hover:text-red-600`} disabled={disabled} onClick={onRemove} title="Bỏ ô"><X className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  )
}

function GridEditor({ g, onChange, disabled }: { g: GridBlock; onChange: (p: Partial<GridBlock>) => void; disabled?: boolean }) {
  return (
    <div className="space-y-2 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-slate-600 w-16 shrink-0">Số lần</span>
        <div className="inline-flex items-center h-8 rounded-md border border-slate-200">
          <button type="button" className={iconBtn} disabled={disabled || g.rows <= 1} onClick={() => onChange({ rows: g.rows - 1 })} title="Bớt một lần"><Minus className="h-3.5 w-3.5" /></button>
          <span className="w-8 text-center text-xs font-semibold tabular-nums">{g.rows}</span>
          <button type="button" className={iconBtn} disabled={disabled || g.rows >= 30} onClick={() => onChange({ rows: g.rows + 1 })} title="Thêm một lần"><Plus className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-slate-600 w-16 shrink-0">Cột</span>
        {g.cols.map((c, i) => (
          <div key={c.key} className="inline-flex items-center rounded-md border border-slate-200 pr-0.5">
            <input value={c.label} disabled={disabled} maxLength={40} aria-label={`Tên cột ${i + 1}`}
              onChange={e => onChange({ cols: g.cols.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })}
              className={`h-8 w-24 bg-transparent px-2 text-xs outline-none ${!c.label.trim() ? 'text-amber-700' : ''}`} />
            <button type="button" className={`${iconBtn} hover:text-red-600`} disabled={disabled || g.cols.length <= 1} title="Bỏ cột"
              onClick={() => onChange({ cols: g.cols.filter((_, j) => j !== i) })}><X className="h-3 w-3" /></button>
          </div>
        ))}
        {g.cols.length < 8 && (
          <button type="button" disabled={disabled} className="touch-target h-8 inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 text-[11px] text-slate-600 hover:bg-slate-50"
            onClick={() => { const label = `Cột ${g.cols.length + 1}`; onChange({ cols: [...g.cols, { key: shortKey(label, new Set(g.cols.map(c => c.key))), label }] }) }}>
            <Plus className="h-3 w-3" />Cột
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-start gap-1.5">
        <span className="text-[11px] text-slate-600 w-16 shrink-0 pt-2">Mỗi cột ghi</span>
        <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
          {g.cells.map((x, i) => (
            <div key={x.key} className="inline-flex items-center gap-1 rounded-md border border-slate-200 p-0.5">
              <input value={x.label} disabled={disabled} maxLength={20} aria-label={`Tên ô ${i + 1} của bảng`}
                onChange={e => onChange({ cells: g.cells.map((y, j) => j === i ? { ...y, label: e.target.value } : y) })}
                className="h-7 w-16 bg-transparent px-1.5 text-xs outline-none" />
              <KindSeg value={x.kind} disabled={disabled} onChange={k => onChange({ cells: g.cells.map((y, j) => j === i ? { ...y, kind: k } : y) })} />
              <button type="button" className={`${iconBtn} hover:text-red-600`} disabled={disabled || g.cells.length <= 1} title="Bỏ ô"
                onClick={() => onChange({ cells: g.cells.filter((_, j) => j !== i) })}><X className="h-3 w-3" /></button>
            </div>
          ))}
          {g.cells.length < 5 && (
            <button type="button" disabled={disabled} className="touch-target h-8 inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 text-[11px] text-slate-600 hover:bg-slate-50"
              onClick={() => onChange({ cells: [...g.cells, { key: shortKey('o', new Set(g.cells.map(c => c.key))), label: 'Ô mới', kind: 'num' }] })}>
              <Plus className="h-3 w-3" />Ô
            </button>
          )}
        </div>
      </div>
      <p className="text-[10px] text-slate-500">{g.rows} lần × {g.cols.length} cột × {g.cells.length} ô = <b>{g.rows * g.cols.length * g.cells.length}</b> ô</p>
    </div>
  )
}

export function ProcessFormEditor({ blocks, onChange, lockedKeys, disabled }: {
  blocks: FormBlock[]; onChange: (b: FormBlock[]) => void
  /** mã ô đã có trong bản đã lưu — không sinh lại mã theo nhãn */
  lockedKeys: Set<string>; disabled?: boolean
}) {
  const setBlock = (i: number, b: FormBlock) => onChange(blocks.map((x, j) => (j === i ? b : x)))
  const setField = (bi: number, fi: number, p: Partial<ProcessField>) => {
    const b = blocks[bi] as FieldsBlock
    const f = { ...b.fields[fi], ...p }
    // ô MỚI (chưa lưu) đổi nhãn ⇒ mã ô đi theo nhãn cho dễ đọc file xuất
    if (p.label !== undefined && !lockedKeys.has(b.fields[fi].key)) {
      const used = usedKeys(blocks); used.delete(b.fields[fi].key)
      f.key = slugKey(p.label || 'o', used)
    }
    for (const k of Object.keys(f) as (keyof ProcessField)[]) if (f[k] === undefined) delete f[k]
    setBlock(bi, { ...b, fields: b.fields.map((x, j) => (j === fi ? f : x)) })
  }
  const addField = (bi: number) => {
    const b = blocks[bi] as FieldsBlock
    setBlock(bi, { ...b, fields: [...b.fields, { key: slugKey('o', usedKeys(blocks)), label: '', kind: 'num' }] })
  }
  const n = blockCellCount(blocks)

  return (
    <div className="space-y-2.5">
      {blocks.map((b, bi) => (
        <div key={bi} className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center gap-1.5 px-2 py-1.5 bg-slate-50 border-b border-slate-200 rounded-t-lg">
            {b.type === 'grid' ? <Table2 className="h-3.5 w-3.5 text-sky-600 shrink-0" /> : <LayoutList className="h-3.5 w-3.5 text-sky-600 shrink-0" />}
            <Input value={b.title} disabled={disabled} maxLength={80} placeholder={b.type === 'grid' ? 'Tên bảng' : 'Tên nhóm ô'} aria-label="Tên khối"
              onChange={e => setBlock(bi, { ...b, title: e.target.value })}
              className={`h-8 text-xs font-semibold flex-1 min-w-0 ${!b.title.trim() ? 'border-amber-400' : ''}`} />
            <Input value={b.hint ?? ''} disabled={disabled} maxLength={160} placeholder="Ghi chú tiêu chuẩn (tuỳ chọn)" aria-label="Ghi chú khối"
              onChange={e => setBlock(bi, { ...b, hint: e.target.value || undefined })} className="h-8 text-[11px] flex-1 min-w-0 hidden sm:block" />
            <button type="button" className={iconBtn} disabled={disabled || bi === 0} onClick={() => onChange(move(blocks, bi, -1))} title="Đưa khối lên"><ArrowUp className="h-3.5 w-3.5" /></button>
            <button type="button" className={iconBtn} disabled={disabled || bi === blocks.length - 1} onClick={() => onChange(move(blocks, bi, 1))} title="Đưa khối xuống"><ArrowDown className="h-3.5 w-3.5" /></button>
            <button type="button" className={`${iconBtn} hover:text-red-600`} disabled={disabled} onClick={() => onChange(blocks.filter((_, j) => j !== bi))} title="Bỏ khối"><X className="h-3.5 w-3.5" /></button>
          </div>
          {b.type === 'grid'
            ? <GridEditor g={b} disabled={disabled} onChange={p => setBlock(bi, { ...b, ...p })} />
            : (
              <div className="px-2.5 py-1">
                {b.fields.map((f, fi) => (
                  <FieldRow key={f.key} f={f} disabled={disabled} first={fi === 0} last={fi === b.fields.length - 1}
                    onChange={p => setField(bi, fi, p)} onRemove={() => setBlock(bi, { ...b, fields: b.fields.filter((_, j) => j !== fi) })}
                    onMove={d => setBlock(bi, { ...b, fields: move(b.fields, fi, d) })} />
                ))}
                {!disabled && (
                  <button type="button" onClick={() => addField(bi)}
                    className="touch-target my-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-50">
                    <Plus className="h-3.5 w-3.5" />Thêm ô
                  </button>
                )}
              </div>
            )}
        </div>
      ))}
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => onChange([...blocks, { type: 'fields', title: '', fields: [{ key: slugKey('o', usedKeys(blocks)), label: '', kind: 'num' }] }])}
            className="touch-target inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
            <LayoutList className="h-3.5 w-3.5" />Thêm nhóm ô
          </button>
          <button type="button"
            onClick={() => {
              const key = gridKeyFor(blocks)
              onChange([...blocks, { type: 'grid', key, title: '', rows: 5, cols: [{ key: 'c1', label: 'Cột 1' }], cells: [{ key: 't', label: 'Giờ', kind: 'time' }] }])
            }}
            className="touch-target inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
            <Table2 className="h-3.5 w-3.5" />Thêm bảng theo dõi
          </button>
          <span className={`ml-auto text-[11px] tabular-nums ${n > MAX_CELLS ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>{n} / {MAX_CELLS} ô</span>
        </div>
      )}
    </div>
  )
}
