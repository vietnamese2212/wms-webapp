// Bảo trì dữ liệu lớn theo năm (20/10/2026) — POST /wms/maintenance/archive · GET /wms/maintenance/archives. Việc nền (luật "việc nền không
// ké vào GET của người xem"): FE gọi sau khi app đã hiện, máy chủ giãn 30 phút giữa hai lượt tự động; `force` (bộ kiểm / người quản trị)
// bỏ giãn cách nhưng vẫn qua ổ khoá — hai lượt không bao giờ chạy chồng. Logic: services/dataArchive.ts.
import { Request, Response } from 'express'
import { z } from '../../middlewares/validate'
import { db } from '../../lib/supabase'
import { ok, failAny } from '../../utils/response'
import { runArchive, listArchiveFiles, ARCHIVE_SPECS } from '../../services/dataArchive'

const AUTO_GAP_S = 30 * 60
export const zRunArchiveBody = z.object({
  force: z.boolean().optional(),
  tasks: z.array(z.enum(['ledger', 'logs', 'sap_lines', 'sap_raw'])).min(1).max(4).optional(),
})

export async function runDataArchive(req: Request, res: Response) {
  try {
    const b = (req.body ?? {}) as z.infer<typeof zRunArchiveBody>
    return ok(res, await runArchive({ minGapS: b.force ? 0 : AUTO_GAP_S, tasks: b.tasks }))
  } catch (e) { return failAny(res, e) }
}

export async function listDataArchives(_req: Request, res: Response) {
  try {
    const [tables, state] = await Promise.all([
      Promise.all(ARCHIVE_SPECS.map(async s => ({ table: s.table, label: s.label, group: s.group, files: await listArchiveFiles(s.table) }))),
      db.from('data_archive_state').select('last_run_at, last_result').eq('id', 'main').maybeSingle(),
    ])
    if (state.error) return failAny(res, state.error)
    return ok(res, { tables, last_run_at: state.data?.last_run_at ?? null, last_result: state.data?.last_result ?? null })
  } catch (e) { return failAny(res, e) }
}
