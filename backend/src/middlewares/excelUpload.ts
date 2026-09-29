// Multer cho cửa nạp Excel ngoài router WMS (routes/external.ts). Cùng cấu hình với `upload` trong routes/wms.ts:
// chỉ nhận .xlsx/.xls/.xlsm (chặn feed binary lạ vào XLSX.read), 1 file, trần 10MB. File sai loại → req.file
// undefined → controller trả 400 "Không có file" (không ném lỗi thô).
import multer from 'multer'
import { randomUUID } from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import { db } from '../lib/supabase'
import { ok, fail } from '../utils/response'

export const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /\.(xlsx|xls|xlsm)$/i.test(file.originalname)),
})

// ── FILE LỚN ĐI QUA SUPABASE STORAGE (29/09 — user: "chuyện gì thế này, sao lại không cho upload file", ZSD02 8,4 MB) ──
// Vercel chặn MỌI request có thân > 4,5 MB (413 thô) nên FE từng chặn từ 4 MB và bảo "tách file". Báo cáo SAP 79 cột
// vượt trần đó thường xuyên. Đường mới: FE xin vé ký (`POST /wms/uploads/sign`) → đẩy file THẲNG lên bucket riêng tư
// `excel-uploads` bằng vé (không qua Vercel) → gọi cửa nạp như cũ nhưng thân JSON `{ storage_path }` thay multipart →
// middleware `excelFromStorage` tải file về, dựng `req.file` y như multer, XOÁ file trên bucket ⇒ controller không đổi.
// Trần còn lại là 10 MB (multer) và 30 MB của bucket — cùng cỡ nhau để một chỗ cấu hình.
export const EXCEL_BUCKET = 'excel-uploads'
const MAX_STORAGE_BYTES = 30 * 1024 * 1024
const PATH_RE = /^u\/[A-Za-z0-9_-]{1,64}\/[0-9a-f-]{36}\.(xlsx|xls|xlsm)$/

/** POST /wms/uploads/sign { filename } → { path, token } — vé đẩy MỘT file, đường dẫn theo user, sống 2 giờ (mặc định Storage). */
export async function signExcelUpload(req: Request, res: Response) {
  try {
    const name = String((req.body as { filename?: unknown })?.filename ?? '')
    const ext = (/\.(xlsx|xls|xlsm)$/i.exec(name)?.[1] ?? '').toLowerCase()
    if (!ext) return fail(res, 400, 'VALIDATION_ERROR', 'Chỉ nhận file .xlsx / .xls / .xlsm')
    const owner = String(req.user?.sub ?? 'anon').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'anon'
    const path = `u/${owner}/${randomUUID()}.${ext}`
    const { data, error } = await db.storage.from(EXCEL_BUCKET).createSignedUploadUrl(path)
    if (error || !data) return fail(res, 503, 'STORAGE_UNAVAILABLE', 'Kho tạm cho file lớn chưa sẵn sàng — thử lại sau, hoặc tách file dưới 4MB')
    return ok(res, { path: data.path, token: data.token, bucket: EXCEL_BUCKET, max_bytes: MAX_STORAGE_BYTES })
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e), 500) }
}

/** Sau multer: không có `req.file` mà thân có `storage_path` ⇒ tải từ bucket, dựng `req.file`, xoá file trên bucket. */
export async function excelFromStorage(req: Request, _res: Response, next: NextFunction) {
  try {
    if (req.file) return next()
    const raw = (req.body as { storage_path?: unknown } | undefined)?.storage_path
    const path = typeof raw === 'string' ? raw.trim() : ''
    if (!path) return next()   // không file, không path ⇒ controller trả 400 "Không có file" như cũ
    if (!PATH_RE.test(path)) return next(Object.assign(new Error('storage_path không hợp lệ'), { status: 400, code: 'VALIDATION_ERROR' }))
    // chỉ đọc được file trong ngăn của CHÍNH user (vé ký cấp theo user) — không kéo file của người khác
    const owner = String(req.user?.sub ?? 'anon').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'anon'
    if (!path.startsWith(`u/${owner}/`) && req.user?.is_superadmin !== true) return next(Object.assign(new Error('storage_path không thuộc tài khoản này'), { status: 403, code: 'FORBIDDEN' }))
    const { data, error } = await db.storage.from(EXCEL_BUCKET).download(path)
    if (error || !data) return next(Object.assign(new Error(`Không đọc được file đã tải lên (${error?.message ?? 'không thấy file'}) — tải lại file`), { status: 400, code: 'UPLOAD_MISSING' }))
    const buffer = Buffer.from(await data.arrayBuffer())
    // dọn ngay: file chỉ là trạm trung chuyển; lỗi dọn không chặn nạp
    void db.storage.from(EXCEL_BUCKET).remove([path]).then(() => {}, () => {})
    if (buffer.length > MAX_STORAGE_BYTES) return next(Object.assign(new Error(`File ${(buffer.length / 1048576).toFixed(1)} MB vượt trần ${MAX_STORAGE_BYTES / 1048576} MB`), { status: 413, code: 'PAYLOAD_TOO_LARGE' }))
    const originalname = path.split('/').pop() ?? 'upload.xlsx'
    req.file = {
      fieldname: 'file', originalname, encoding: '7bit', mimetype: 'application/octet-stream',
      size: buffer.length, buffer, destination: '', filename: originalname, path: '', stream: undefined as unknown as Express.Multer.File['stream'],
    }
    return next()
  } catch (e) { return next(e) }
}
