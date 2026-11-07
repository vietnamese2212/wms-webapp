// Gọi phần tính sơ đồ chạy nền. Đầu vào đổi lúc đang tính ⇒ HUỶ HẲN lượt dở (worker không ngắt được giữa chừng, gõ 4 phím từng phải chờ
// 4 lượt tính đủ); cấu hình vừa xem ⇒ hiện ngay từ bộ nhớ. Đang tính thì giữ kết quả cũ (`planning` = đang có lượt mới).
import { useEffect, useState } from 'react'
import { runJob, type JobKind, type JobOuts, type PlanInput } from './planJob'
import type { JobReq, JobRes } from './plan.worker'

// Kết quả chỉ phụ thuộc đầu vào. Dùng chung cho cả hai chế độ, còn nguyên khi đóng / mở lại màn
const CACHE_MAX = 12
const cache = new Map<string, unknown>()
function remember(key: string, out: unknown) {
  cache.delete(key); cache.set(key, out)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
}

export function usePlanJob<K extends JobKind>(kind: K, input: PlanInput | null) {
  const [result, setResult] = useState<JobOuts[K] | null>(null)
  const [planning, setPlanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = input ? JSON.stringify([kind, input]) : ''

  useEffect(() => {
    setError(null)
    if (!input) { setResult(null); setPlanning(false); return }
    const hit = cache.get(key) as JobOuts[K] | undefined
    if (hit) { remember(key, hit); setResult(hit); setPlanning(false); return }
    setPlanning(true)
    let worker: Worker | null = null
    const finish = (out: JobOuts[K]) => { remember(key, out); setResult(out); setPlanning(false) }
    const fail = (message: string) => { setError(message); setPlanning(false) }
    // Không nạp được worker ⇒ vẫn phải có sơ đồ: tính trên màn hình (như trước khi có chạy nền)
    const onScreen = () => { try { finish(runJob(kind, input)) } catch (e) { fail(e instanceof Error ? e.message : String(e)) } }
    const timer = setTimeout(() => {
      try {
        worker = new Worker(new URL('./plan.worker.ts', import.meta.url), { type: 'module' })
      } catch { onScreen(); return }
      worker.onmessage = (e: MessageEvent<JobRes>) => {
        worker?.terminate()
        if ('error' in e.data) fail(e.data.error); else finish(e.data.out as JobOuts[K])
      }
      worker.onerror = ev => { ev.preventDefault(); worker?.terminate(); onScreen() }
      worker.postMessage({ kind, input } satisfies JobReq)
    }, 120)
    return () => { clearTimeout(timer); worker?.terminate() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { result, planning, error }
}
