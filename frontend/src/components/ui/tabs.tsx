import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

const Tabs = TabsPrimitive.Root

// Dải tab tràn khung thì CUỘN được, nhưng cuộn được mà KHÔNG AI BIẾT thì cũng như không (rà điện
// thoại 12/09: Xe nâng 6 tab, ở 360 px chỉ thấy 2 tab rưỡi, 4 tab còn lại nằm ngoài màn mà không
// một dấu hiệu nào nói là vuốt được — khác ca "Sắp quét" ở chỗ nó KHÔNG bị đè, chỉ là vô hình).
// Hai việc, cả hai chỉ chạm scrollLeft của CHÍNH dải tab nên không kéo trang đi đâu:
//   1. Tab ĐANG CHỌN luôn được kéo vào tầm nhìn — mở lại trang mà tab thứ 6 đang active thì không
//      còn cảnh dải tab hiện tab 1 và người dùng tưởng mình đang đứng ở đó.
//   2. Mép nào còn nội dung khuất thì MỜ DẦN — dấu hiệu chuẩn "còn nữa, vuốt đi". Không tràn thì
//      không mờ gì cả (đừng làm nhoè tab cuối của những trang chỉ có 2–3 tab).
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, style, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const [edge, setEdge] = React.useState<'none' | 'left' | 'right' | 'both'>('none')

  const sync = React.useCallback(() => {
    const el = listRef.current
    if (!el) return
    const hidden = el.scrollWidth - el.clientWidth
    if (hidden <= 2) { setEdge('none'); return }
    const l = el.scrollLeft > 2, r = el.scrollLeft < hidden - 2
    setEdge(l && r ? 'both' : l ? 'left' : 'right')
  }, [])

  React.useEffect(() => {
    const el = listRef.current
    if (!el) return
    const reveal = () => {
      const act = el.querySelector<HTMLElement>('[data-state="active"]')
      if (act) {
        const lr = el.getBoundingClientRect(), ar = act.getBoundingClientRect()
        if (ar.left < lr.left) el.scrollLeft += ar.left - lr.left - 8
        else if (ar.right > lr.right) el.scrollLeft += ar.right - lr.right + 8
      }
      sync()
    }
    reveal()
    const mo = new MutationObserver(reveal)
    mo.observe(el, { subtree: true, attributes: true, attributeFilter: ['data-state'] })
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    el.addEventListener('scroll', sync, { passive: true })
    return () => { mo.disconnect(); ro.disconnect(); el.removeEventListener('scroll', sync) }
  }, [sync])

  const mask = edge === 'none' ? null
    : edge === 'both' ? 'linear-gradient(to right, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%)'
    : edge === 'left' ? 'linear-gradient(to right, transparent 0, #000 16px)'
    : 'linear-gradient(to right, #000 calc(100% - 16px), transparent 100%)'

  return (
    <TabsPrimitive.List
      ref={(node) => {
        listRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node
      }}
      style={mask ? { ...style, maskImage: mask, WebkitMaskImage: mask } : style}
      className={cn(
        // justify-START, KHÔNG center: các trang nhiều tab đặt `max-w-full overflow-x-auto` (Cài đặt
        // WMS 8 tab, Cài đặt TMS, Xe nâng). Với `justify-center`, khi nội dung rộng hơn khung thì
        // phần tràn ở ĐẦU nằm NGOÀI vùng cuộn — scrollLeft đã là 0 mà 2 tab đầu vẫn ở x âm ⇒ trên
        // điện thoại 390 KHÔNG CÁCH NÀO bấm được tab "Kho" và "Loại kho" (đo thật 21/08).
        // Tablist là inline-flex (co theo nội dung) nên khi không tràn, đổi justify không thay đổi gì.
        'inline-flex h-10 items-center justify-start rounded-md bg-muted p-1 text-muted-foreground',
        className
      )}
      {...props}
    />
  )
})
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
