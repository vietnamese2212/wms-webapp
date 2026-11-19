// MODULE HỖ TRỢ — trang "Hướng dẫn sử dụng" (19/11). Danh sách bài hướng dẫn gom theo nhóm; mỗi người chỉ thấy bài của module
// mình có quyền (bài không gắn module thì ai cũng thấy). Ô tìm tìm trong TỪNG BƯỚC của mọi bài (không dấu cũng ra).
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { LifeBuoy, BookOpen, ChevronRight } from 'lucide-react'
import { SearchInput } from '@/components/shared/SearchInput'
import { useAuthStore } from '@/stores/authStore'
import { isAdmin, type ModulePermissions } from '@/config/permissions'
import { visibleGuides, searchSteps, stepCount, stepAnchor } from '@/help/registry'

export default function HelpCenter() {
  const user = useAuthStore(s => s.user)
  const guides = useMemo(() => visibleGuides(user?.module_permissions as ModulePermissions | null ?? null, isAdmin(user)), [user])
  const [q, setQ] = useState('')
  const hits = useMemo(() => searchSteps(guides, q), [guides, q])
  const groups = useMemo(() => {
    const m = new Map<string, typeof guides>()
    for (const g of guides) m.set(g.category, [...(m.get(g.category) ?? []), g])
    return [...m.entries()]
  }, [guides])

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
            <div className="space-y-5 max-w-5xl">
              {groups.map(([cat, list]) => (
                <section key={cat}>
                  <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">{cat}</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {list.map(g => (
                      <div key={g.id} className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 hover:border-sky-300 transition-colors">
                        <Link to={`/help/${g.id}`} className="flex items-start gap-2.5 group" data-testid={`guide-card-${g.id}`}>
                          <span className="grid place-items-center h-9 w-9 rounded-lg bg-sky-50 text-sky-600 shrink-0"><BookOpen className="h-5 w-5" /></span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-slate-800 group-hover:text-sky-700">{g.title}</span>
                            <span className="block text-xs text-slate-500 mt-0.5">{g.summary}</span>
                            <span className="block text-[11px] text-slate-400 mt-1">{stepCount(g)} bước · cập nhật {g.updated}</span>
                          </span>
                        </Link>
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {g.sections.map(s => (
                            <Link key={s.id} to={`/help/${g.id}#${s.id}`}
                              className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:border-sky-300 hover:text-sky-700">
                              {s.title}<ChevronRight className="h-3 w-3" />
                            </Link>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
