// Tệp sổ vết điều vận đã lưu trữ (20/10/2026) — GET /tms/dispatch/history/archives cho dải "Vết cũ đã lưu trữ" ở tab Lịch sử. Việc lưu
// trữ chạy ở bộ bảo trì chung (POST /wms/maintenance/archive — services/dataArchive.ts, cờ retention_days.ledger).
import { Request, Response } from 'express'
import { ok, failAny } from '../../utils/response'
import { listArchiveFiles } from '../../services/dataArchive'

export async function listLedgerArchives(_req: Request, res: Response) {
  try { return ok(res, { files: await listArchiveFiles('outbound_events') }) } catch (e) { return failAny(res, e) }
}
