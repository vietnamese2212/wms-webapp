import { create } from 'zustand'
import { get as idbGet, set as idbSet } from 'idb-keyval'
import type { AxiosError } from 'axios'
import { apiClient, OfflineError } from '@/api/client'
import { queryClient } from '@/api/queryClient'

// ─── Hàng đợi quét offline ────────────────────────────────────────────────────
// Nguyên tắc (rút bài học AppSheet "double lệnh, nhận cả 2"):
// 1. CHỈ xếp hàng thao tác quét QR pallet — server đã có khóa dedup tự nhiên
//    (unique (kho,pallet) bên nhập; check (item,pallet) "đã được quét" bên xuất).
//    Thao tác cộng dồn số lượng KHÔNG bao giờ vào queue (gửi đúp = double).
// 2. Server là trọng tài cuối: replay đi qua ĐÚNG endpoint online; bị từ chối
//    → dòng ĐỎ kèm lý do server trả, không âm thầm.
// 3. Gửi lại chỉ khi lỗi MẠNG; nếu lần gửi trước KHÔNG rõ kết quả (response rớt)
//    mà server trả "trùng" → hiểu là ĐÃ lên từ lần trước → đánh dấu thành công.

export interface QueuedScan {
  id: string
  kind: 'inbound' | 'outbound'
  url: string                       // endpoint replay (y hệt online)
  body: Record<string, unknown>
  pallet_code: string               // hiển thị
  label: string                     // ngữ cảnh hiển thị (mã phiếu / mã hàng)
  orderId: string                   // inbound order id / gdo id (đếm chip theo phiếu)
  itemId?: string
  createdAt: string
  status: 'pending' | 'done' | 'rejected'
  // ĐÃ TỪNG gửi mà không nhận được response (timeout/đứt giữa chừng) — kết quả
  // không rõ; replay sau đó server báo "trùng" thì coi là thành công của lần trước.
  uncertain?: boolean
  reason?: string
}

const IDB_KEY = 'wms-scan-queue-v1'
const KEEP_DONE = 20   // giữ tối đa N dòng đã lên để user soi lại, tránh phình IDB

interface ScanQueueState {
  items: QueuedScan[]
  replaying: boolean
  setItems: (items: QueuedScan[]) => void
}

export const useScanQueue = create<ScanQueueState>((set) => ({
  items: [],
  replaying: false,
  setItems: (items) => set({ items }),
}))

function persist(items: QueuedScan[]): void {
  idbSet(IDB_KEY, items).catch(() => {})   // IDB hỏng (private mode…) → queue chỉ sống trong RAM
}

function mutateItems(fn: (items: QueuedScan[]) => QueuedScan[]): void {
  const next = fn(useScanQueue.getState().items)
  useScanQueue.getState().setItems(next)
  persist(next)
}

// ─── API cho component scan ──────────────────────────────────────────────────

export interface EnqueueInput {
  kind: 'inbound' | 'outbound'
  url: string
  body: Record<string, unknown>
  pallet_code: string
  label: string
  orderId: string
  itemId?: string
  uncertain?: boolean
}

/** Xếp 1 lượt quét vào hàng đợi. Trả về số dòng đang chờ (toàn cục) sau khi thêm.
 *  Nếu pallet này ĐÃ chờ cho cùng phiếu/item → không thêm đúp, trả count hiện tại. */
export function enqueueScan(input: EnqueueInput): { queued: number; duplicate: boolean } {
  const items = useScanQueue.getState().items
  const dup = items.some(i =>
    i.status === 'pending' && i.pallet_code === input.pallet_code &&
    i.orderId === input.orderId && i.itemId === input.itemId
  )
  if (!dup) {
    mutateItems(list => [...list, {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      status: 'pending' as const,
    }])
  }
  return { queued: pendingCount(), duplicate: dup }
}

export function pendingCount(orderId?: string, itemId?: string): number {
  return useScanQueue.getState().items.filter(i =>
    i.status === 'pending' &&
    (orderId === undefined || i.orderId === orderId) &&
    (itemId === undefined || i.itemId === itemId)
  ).length
}

export function removeQueued(id: string): void {
  mutateItems(list => list.filter(i => i.id !== id))
}

export function clearDoneQueued(): void {
  mutateItems(list => list.filter(i => i.status !== 'done'))
}

/** Dòng rejected → pending để gửi lại (user đã xử lý nguyên nhân) */
export function retryQueued(id: string): void {
  mutateItems(list => list.map(i =>
    i.id === id ? { ...i, status: 'pending' as const, reason: undefined, uncertain: false } : i
  ))
  void processScanQueue()
}

/** Lỗi do KẾT NỐI (chưa/không rõ tới server) — khác lỗi nghiệp vụ server trả về */
export function isConnectivityError(err: unknown): boolean {
  if (err instanceof OfflineError) return true
  const ax = err as AxiosError
  return !!ax?.isAxiosError && !ax.response
}

// ─── Replay engine ───────────────────────────────────────────────────────────

// Guard server trả khi bản ghi ĐÃ tồn tại — so khớp CẢ error.code lẫn message
// (verify sống 12/07: nhập trùng trả code DUPLICATE_PALLET nhưng message là
// "đang tồn kho tại đây, chưa được xuất" — chỉ so message sẽ hụt).
const DUP_RE = /đã được quét|đã xuất hết|đã tồn tại|đang tồn kho|DUPLICATE_PALLET|ALREADY_SAVED|đã được lưu thủ công/i

function setItem(id: string, patch: Partial<QueuedScan>): void {
  mutateItems(list => list.map(i => (i.id === id ? { ...i, ...patch } : i)))
}

export async function processScanQueue(): Promise<void> {
  const st = useScanQueue.getState()
  if (st.replaying) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  const pending = st.items.filter(i => i.status === 'pending')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  if (!pending.length) return

  useScanQueue.setState({ replaying: true })
  let anyDone = false
  const touched = new Set<string>()   // orderId đã có thay đổi → invalidate

  try {
    for (const item of pending) {
      const wasUncertain = item.uncertain === true
      // Đánh dấu "không rõ kết quả" TRƯỚC khi gửi + persist — crash/kill app giữa
      // chừng thì lần replay sau vẫn biết lượt này có thể đã lên (dup → thành công).
      setItem(item.id, { uncertain: true })
      try {
        await apiClient.post(item.url, item.body)
        setItem(item.id, { status: 'done', uncertain: false, reason: undefined })
        anyDone = true
        touched.add(`${item.kind}:${item.orderId}`)
      } catch (err) {
        if (err instanceof OfflineError) {
          // Chưa hề chạm mạng → trả lại trạng thái cũ, dừng đợt này
          setItem(item.id, { uncertain: wasUncertain })
          break
        }
        const resp = (err as AxiosError<{ error?: { message?: string; code?: string } }>)?.response
        if (!resp) break                       // lỗi mạng giữa chừng — giữ pending (uncertain=true), thử đợt sau
        if (resp.status >= 500) break          // server lỗi tạm — đừng đốt queue, thử đợt sau
        const msg = resp.data?.error?.message ?? `HTTP ${resp.status}`
        const errCode = resp.data?.error?.code ?? ''
        if (wasUncertain && (DUP_RE.test(msg) || DUP_RE.test(errCode))) {
          // Lần gửi trước đã lên nhưng response rớt → server báo trùng = XÁC NHẬN thành công
          setItem(item.id, { status: 'done', uncertain: false, reason: 'Đã lên từ lần gửi trước (server xác nhận trùng)' })
          anyDone = true
          touched.add(`${item.kind}:${item.orderId}`)
        } else {
          // Lỗi nghiệp vụ dứt khoát (trùng thật / hết tồn / sai mã…) → đỏ, giữ lý do
          setItem(item.id, { status: 'rejected', uncertain: false, reason: msg })
        }
      }
    }
  } finally {
    // Prune done cũ (giữ KEEP_DONE dòng mới nhất)
    mutateItems(list => {
      const done = list.filter(i => i.status === 'done')
      if (done.length <= KEEP_DONE) return list
      const drop = new Set(done.slice(0, done.length - KEEP_DONE).map(i => i.id))
      return list.filter(i => !drop.has(i.id))
    })
    useScanQueue.setState({ replaying: false })
  }

  if (anyDone) {
    for (const key of touched) {
      const [kind, orderId] = key.split(':')
      if (kind === 'inbound') {
        queryClient.invalidateQueries({ queryKey: ['inbound-order', orderId] })
        queryClient.invalidateQueries({ queryKey: ['inbound-orders'] })
      } else {
        queryClient.invalidateQueries({ queryKey: ['gdo', orderId] })
        queryClient.invalidateQueries({ queryKey: ['gdos'] })
        queryClient.invalidateQueries({ queryKey: ['item-inventory'] })
      }
    }
    queryClient.invalidateQueries({ queryKey: ['inventory-entries'] })
    queryClient.invalidateQueries({ queryKey: ['inventory-summary'] })
  }
}

// ─── Khởi động: hydrate từ IndexedDB + lắng nghe mạng về ────────────────────
let initialized = false
export function initScanQueue(): void {
  if (initialized) return
  initialized = true
  idbGet(IDB_KEY).then((stored) => {
    if (Array.isArray(stored) && stored.length) {
      useScanQueue.getState().setItems(stored as QueuedScan[])
    }
    void processScanQueue()   // mở app có mạng + còn hàng chờ → đẩy luôn
  }).catch(() => {})
  window.addEventListener('online', () => {
    // chờ 1.5s cho mạng ổn định rồi mới replay (wifi vừa bắt lại hay chớp)
    setTimeout(() => void processScanQueue(), 1500)
  })
}
