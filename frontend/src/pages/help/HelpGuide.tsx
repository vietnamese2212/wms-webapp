// MODULE HỖ TRỢ — đọc MỘT bài hướng dẫn (/help/:id). Máy tính: mục lục dính bên trái + nội dung; điện thoại: mục lục gập ở đầu.
// Ảnh máy tính trải hết bề rộng nội dung, ảnh điện thoại xếp cạnh nhau khổ hẹp; bấm ảnh để phóng to. Neo #mục / #mục-bước trên URL.
// Số bài = vị trí trong danh sách bài người này được thấy (cùng số ở trang Hỗ trợ); cuối bài có Bài trước / Bài tiếp để người mới
// đọc lần lượt (user 19/11: thứ tự theo việc người mới cần làm).
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ListTree, ChevronDown, Lightbulb, Smartphone, Monitor } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useAuthStore } from '@/stores/authStore'
import { isAdmin, type ModulePermissions } from '@/config/permissions'
import { guideById, visibleGuides, stepAnchor } from '@/help/registry'
import type { GuideImage, GuideStep } from '@/help/types'

/** **đậm** trong câu */
function rich(s: string): ReactNode {
  const parts = s.split(/\*\*(.+?)\*\*/g)
  return parts.map((p, i) => (i % 2 ? <b key={i} className="font-semibold text-slate-800">{p}</b> : <Fragment key={i}>{p}</Fragment>))
}
/** đoạn văn + gạch đầu dòng ("- ") liền nhau gom một danh sách */
function Body({ text }: { text: string[] }) {
  const blocks: ({ ul: string[] } | { p: string })[] = []
  for (const t of text) {
    if (t.startsWith('- ')) {
      const last = blocks[blocks.length - 1]
      if (last && 'ul' in last) last.ul.push(t.slice(2)); else blocks.push({ ul: [t.slice(2)] })
    } else blocks.push({ p: t })
  }
  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed text-slate-700">
      {blocks.map((b, i) => 'ul' in b
        ? <ul key={i} className="list-disc pl-5 space-y-1">{b.ul.map((x, j) => <li key={j}>{rich(x)}</li>)}</ul>
        : <p key={i}>{rich(b.p)}</p>)}
    </div>
  )
}

function Images({ images, onOpen }: { images: GuideImage[]; onOpen: (img: GuideImage) => void }) {
  const desk = images.filter(i => !i.phone), phone = images.filter(i => i.phone)
  return (
    <div className="space-y-3 mt-2.5">
      {desk.map(img => (
        <figure key={img.src}>
          <button type="button" onClick={() => onOpen(img)} className="block w-full cursor-zoom-in" title="Bấm để phóng to">
            <img src={img.src} alt={img.alt} loading="lazy" width={img.w ?? 1280} height={img.h ?? 800} className="w-full h-auto rounded-lg border border-slate-200 shadow-sm" />
          </button>
          <figcaption className="mt-1 flex items-center gap-1 text-[11px] text-slate-500"><Monitor className="h-3 w-3 shrink-0" />{img.alt}</figcaption>
        </figure>
      ))}
      {phone.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {phone.map(img => (
            <figure key={img.src} className="w-[calc(50%-6px)] sm:w-[220px]">
              <button type="button" onClick={() => onOpen(img)} className="block w-full cursor-zoom-in" title="Bấm để phóng to">
                <img src={img.src} alt={img.alt} loading="lazy" width={img.w ?? 780} height={img.h ?? 1688} className="w-full h-auto rounded-2xl border-4 border-slate-800 shadow-sm" />
              </button>
              <figcaption className="mt-1 flex items-start gap-1 text-[11px] text-slate-500"><Smartphone className="h-3 w-3 shrink-0 mt-0.5" />{img.alt}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}

function Step({ step, anchor, n, onOpen }: { step: GuideStep; anchor: string; n: number; onOpen: (img: GuideImage) => void }) {
  return (
    <article id={anchor} className="scroll-mt-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="flex items-start gap-2">
        <span className="grid place-items-center h-6 min-w-6 px-1 rounded-full bg-sky-600 text-white text-[11px] font-semibold shrink-0 mt-0.5">{n}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-800">{step.title}</h3>
          {!!step.who?.length && (
            <div className="mt-1 flex flex-wrap gap-1">
              {step.who.map(w => <span key={w} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{w}</span>)}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2"><Body text={step.text} /></div>
      {step.note && (
        <div className="mt-2.5 flex gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
          <Lightbulb className="h-4 w-4 shrink-0 text-amber-500" /><span>{rich(step.note)}</span>
        </div>
      )}
      {!!step.images?.length && <Images images={step.images} onOpen={onOpen} />}
    </article>
  )
}

export default function HelpGuide() {
  const { id } = useParams()
  const location = useLocation()
  const user = useAuthStore(s => s.user)
  const allowed = useMemo(() => visibleGuides(user?.module_permissions as ModulePermissions | null ?? null, isAdmin(user)), [user])
  const guide = guideById(id)
  const pos = guide ? allowed.findIndex(g => g.id === guide.id) : -1
  const canSee = pos >= 0
  const prev = pos > 0 ? allowed[pos - 1] : null
  const next = pos >= 0 && pos < allowed.length - 1 ? allowed[pos + 1] : null
  const [zoom, setZoom] = useState<GuideImage | null>(null)
  const [tocOpen, setTocOpen] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  // đóng mục lục (điện thoại) TRƯỚC rồi mới cuộn — khung mục lục gập lại làm nội dung dịch lên, cuộn trước thì dừng lệch
  const go = (anchor: string) => {
    setTocOpen(false)
    window.history.replaceState(null, '', `#${anchor}`)
    setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start' }), 30)
  }
  // mở từ đường dẫn có neo (#mục hoặc #mục-bước) ⇒ cuộn tới đó sau khi vẽ
  useEffect(() => {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''))
    if (!h) { scroller.current?.scrollTo({ top: 0 }); return }
    const t = setTimeout(() => document.getElementById(h)?.scrollIntoView({ block: 'start' }), 60)
    return () => clearTimeout(t)
  }, [location.hash, id])

  if (!guide || !canSee) {
    return (
      <div className="p-4 text-sm text-slate-600 space-y-2">
        <p>{guide ? 'Bạn chưa được giao module của hướng dẫn này.' : 'Không tìm thấy hướng dẫn.'}</p>
        <Link to="/help" className="text-sky-700 underline">← Về danh sách hướng dẫn</Link>
      </div>
    )
  }

  const toc = (
    <nav className="space-y-2 text-xs">
      {guide.sections.map(s => (
        <div key={s.id}>
          <button type="button" onClick={() => go(s.id)} className="text-left font-semibold text-slate-700 hover:text-sky-700">{s.title}</button>
          <ul className="mt-1 space-y-0.5 border-l border-slate-200 pl-2">
            {s.steps.map((st, i) => (
              <li key={i}><button type="button" onClick={() => go(stepAnchor(s.id, i))} className="text-left text-slate-500 hover:text-sky-700">{st.title}</button></li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-2 shrink-0 sm:rounded-t-xl flex items-center gap-2">
          <Link to="/help" className="grid place-items-center h-9 w-9 sm:h-7 sm:w-7 rounded-md hover:bg-slate-100 shrink-0" aria-label="Về danh sách hướng dẫn"><ArrowLeft className="h-4 w-4" /></Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold text-slate-800 truncate">{pos + 1}. {guide.title}</h1>
            <p className="text-[11px] text-slate-500 truncate">{guide.category} · cập nhật {guide.updated}</p>
          </div>
          <button type="button" onClick={() => setTocOpen(o => !o)} className="lg:hidden inline-flex items-center gap-1 h-9 rounded-md border border-slate-200 px-2.5 text-xs text-slate-700 shrink-0">
            <ListTree className="h-4 w-4" />Mục lục<ChevronDown className={`h-3.5 w-3.5 transition-transform ${tocOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {tocOpen && <div className="lg:hidden border-b bg-slate-50 px-3 py-2.5 max-h-[50vh] overflow-auto shrink-0">{toc}</div>}
        <div className="flex-1 min-h-0 flex">
          <aside className="hidden lg:block w-64 shrink-0 border-r bg-slate-50/60 overflow-auto p-3">{toc}</aside>
          <div ref={scroller} className="flex-1 min-w-0 overflow-auto bg-slate-50 p-3 sm:p-4 pb-20 lg:pb-6">
            <div className="max-w-4xl space-y-6">
              <p className="text-[13px] text-slate-600">{guide.summary}</p>
              {guide.sections.map(s => (
                <section key={s.id} id={s.id} className="scroll-mt-3 space-y-2.5">
                  <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-sky-800"><span className="h-4 w-1 rounded bg-sky-500" />{s.title}</h2>
                  {s.intro && <p className="text-[13px] text-slate-600">{s.intro}</p>}
                  {s.steps.map((st, i) => <Step key={i} step={st} n={i + 1} anchor={stepAnchor(s.id, i)} onOpen={setZoom} />)}
                </section>
              ))}
              {(prev || next) && (
                <nav className="grid gap-2 sm:grid-cols-2 border-t border-slate-200 pt-4" aria-label="Bài trước, bài tiếp">
                  {prev ? (
                    <Link to={`/help/${prev.id}`} data-testid="guide-prev" className="rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-sky-300">
                      <span className="flex items-center gap-1 text-[11px] text-slate-500"><ArrowLeft className="h-3 w-3" />Bài trước</span>
                      <span className="block text-sm font-medium text-slate-800">{pos}. {prev.title}</span>
                    </Link>
                  ) : <span className="hidden sm:block" />}
                  {next && (
                    <Link to={`/help/${next.id}`} data-testid="guide-next" className="rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2 hover:border-sky-400 sm:text-right">
                      <span className="flex items-center gap-1 text-[11px] text-sky-700 sm:justify-end">Bài tiếp<ArrowRight className="h-3 w-3" /></span>
                      <span className="block text-sm font-medium text-slate-800">{pos + 2}. {next.title}</span>
                    </Link>
                  )}
                </nav>
              )}
            </div>
          </div>
        </div>
      </div>
      <Dialog open={!!zoom} onOpenChange={v => !v && setZoom(null)}>
        <DialogContent className="max-w-[95vw] w-auto p-2 sm:p-3">
          <DialogTitle className="text-xs font-medium text-slate-600 pr-6">{zoom?.alt}</DialogTitle>
          {zoom && <img src={zoom.src} alt={zoom.alt} className="max-h-[82dvh] max-w-full mx-auto object-contain rounded" />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
