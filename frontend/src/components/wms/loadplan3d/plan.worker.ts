// Tính sơ đồ xếp xe ngoài luồng màn hình (`usePlanJob.ts`): chuyến nặng tính vài giây, màn hình vẫn gõ / xoay xe được.
import { runJob, type JobKind, type JobOuts, type PlanInput } from './planJob'

export interface JobReq { kind: JobKind; input: PlanInput }
export type JobRes = { out: JobOuts[JobKind] } | { error: string }

self.onmessage = (e: MessageEvent<JobReq>) => {
  let res: JobRes
  try {
    res = { out: runJob(e.data.kind, e.data.input) }
  } catch (err) {
    res = { error: err instanceof Error ? err.message : String(err) }
  }
  self.postMessage(res)
}
