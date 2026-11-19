// MODULE HỖ TRỢ — trang "Hướng dẫn sử dụng" (19/11). Mỗi người chỉ thấy bài của module mình có quyền (bài không gắn module thì
// ai cũng thấy). DANH SÁCH GỌN (user 19/11: "cho nó dạng đầu mục trước, vào bên trong thì mới hướng dẫn các bước làm" ·
// "danh mục này chiếm dụng không gian quá"): mỗi bài MỘT dòng, đánh số theo thứ tự người mới cần học (thứ tự ALL_GUIDES);
// ▸ mở các mục của bài; bấm tên bài mới vào các bước. Ô tìm tìm trong TỪNG BƯỚC của mọi bài (không dấu cũng ra).
import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { LifeBuoy, ChevronRight } from 'lucide-react'
import { SearchInput } from '@/components/shared/SearchInput'
import { useAuthStore } from '@/stores/authStore'
import { isAdmin, type ModulePermissions } from '@/config/permissions'
import { visibleGuides, searchSteps, stepCount, stepAnchor } from '@/help/registry'

export default function HelpCenter() {
  const user = useAuthStore(s => s.user)
  const guides = useMemo(() => visibleGuides(user?.module_permissions as ModulePermissions | null ?? null, isAdmin(user)), [user])
  const [q, setQ] = useState('')
  const hits = useMemo(() => searchSteps(guides, q), [guides, q])
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 sm:py-2 shrink-0 sm:rounded-t-xl flex items-center gap-2">
          <span className="hidden sm:flex items-center gap-1.5 text-sm font-semibold text-slate-700 shrink-0"><LifeBuoy className="h-4 w-4 text-sky-600" />Hướng dẫn sử dụng</span>
          <div className="flex-1 min-w-0"><SearchInput value={q} onChange={setQ} placeholder="Tìm trong hướng dẫn — vd: nạp bồn, hết hạn, đổi mật khẩu" /></div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-3 sm:p-4 pb-20 lg:pb-4">
          {q.trim() ? (
            <div className="max-w-3xl space-y-1.5">
              <p className="text-xs text-slate-500">{hits.length ? `${hits.length} bước khớp "${q.trim()}"` : `Không có bước nào khớp "${q.trim()}".`}</p>
              {hits.map(h => (
                <Link key={`${h.guide.id}-${h.sectionId}-${h.index}`} to={`/help/${h.guide.id}#${stepAnchor(h.sectionId, h.index)}`}
                  className="block rounded-lg border border-slate-200 px-3 py-2 hover:border-sky-300 hover:bg-sky-50/50">
                  <div className="text-[11px] text-slate-500 truncate">{h.guide.title} › {h.sectionTitle}</div>
                  <div className="text-sm font-medium text-slate-800">{h.step.title}</div>
                </Link>
              ))}
            </div>
          ) : !guides.length ? (
            <p className="text-sm text-slate-500">Chưa có hướng dẫn cho các module bạn được giao.</p>
          ) : (
            <div className="max-w-3xl">
              <p className="text-xs text-slate-500 mb-2">Người mới: đọc lần lượt từ bài 1. Bấm <ChevronRight className="inline h-3 w-3 -mt-0.5" /> để xem các mục của bài, bấm tên bài để vào các bước.</p>
              <ol className="rounded-lg border border-slate-200 divide-y divide-slate-100" data-testid="guide-list">
                {guides.map((g, i) => {
                  const isOpen = open.has(g.id)
                  const newCat = i === 0 || guides[i - 1].category !== g.category
                  return (
                    <Fragment key={g.id}>
                      {newCat && <li aria-hidden className="bg-slate-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 first:rounded-t-lg">{g.category}</li>}
                      <li>
                        <div className="flex items-center gap-1 pl-1 pr-3">
                          <button type="button" onClick={() => toggle(g.id)} aria-expanded={isOpen} aria-label={`${isOpen ? 'Thu gọn' : 'Xem'} các mục của bài ${i + 1}`}
                            data-testid={`guide-toggle-${g.id}`}
                            className="grid place-items-center h-9 w-9 sm:h-8 sm:w-8 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 shrink-0">
                            <ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                          </button>
                          <Link to={`/help/${g.id}`} data-testid={`guide-card-${g.id}`} className="group flex flex-1 min-w-0 items-center gap-2 py-2">
                            <span className="grid place-items-center h-5 min-w-5 px-1 rounded-full bg-sky-600 text-white text-[11px] font-semibold shrink-0">{i + 1}</span>
                            <span className="flex-1 min-w-0 text-sm font-medium text-slate-800 group-hover:text-sky-700 sm:truncate">{g.title}</span>
                            <span className="text-[11px] text-slate-400 shrink-0 whitespace-nowrap">{stepCount(g)} bước</span>
                          </Link>
                        </div>
                        {isOpen && (
                          <div className="pl-[4.25rem] pr-3 pb-2.5 -mt-0.5">
                            <p className="text-xs text-slate-500 mb-1.5">{g.summary}</p>
                            <ul>
                              {g.sections.map((s, j) => (
                                <li key={s.id}>
                                  <Link to={`/help/${g.id}#${s.id}`} className="block py-1 sm:py-0.5 text-[13px] text-slate-700 hover:text-sky-700">
                                    <span className="mr-1.5 text-[11px] text-slate-400 tabular-nums">{i + 1}.{j + 1}</span>{s.title}
                                    <span className="ml-1.5 text-[11px] text-slate-400 whitespace-nowrap">· {s.steps.length} bước</span>
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </li>
                    </Fragment>
                  )
                })}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
