// Lưu trữ sổ vết điều vận (20/10/2026) — POST /tms/dispatch/history/archive · GET /tms/dispatch/history/archives. Việc nền tách khỏi
// GET lịch sử (luật "việc nền không ké vào GET của người xem"): FE gọi sau khi tab đã hiện, mỗi lượt tối đa `max_months` tháng.
import { Request, Response } from 'express'
import { z } from '../../middlewares/validate'
import { ok, failAny } from '../../utils/response'
import { archiveOldestMonth, listArchiveFiles, type ArchiveResult } from '../../services/ledgerArchive'

export const zArchiveBody = z.object({ max_months: z.number().int().min(1).max(12).optional() })

export async function archiveLedger(req: Request, res: Response) {
  try {
    const b = (req.body ?? {}) as z.infer<typeof zArchiveBody>
    const results: ArchiveResult[] = []
    for (let i = 0; i < (b.max_months ?? 1); i++) {
      const r = await archiveOldestMonth()
      results.push(r)
      if (r.status !== 'archived') break
    }
    return ok(res, { results })
  } catch (e) { return failAny(res, e) }
}

export async function listLedgerArchives(_req: Request, res: Response) {
  try { return ok(res, { files: await listArchiveFiles() }) } catch (e) { return failAny(res, e) }
}
