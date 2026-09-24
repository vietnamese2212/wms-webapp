// Multer cho cửa nạp Excel ngoài router WMS (routes/external.ts). Cùng cấu hình với `upload` trong routes/wms.ts:
// chỉ nhận .xlsx/.xls/.xlsm (chặn feed binary lạ vào XLSX.read), 1 file, trần 10MB. File sai loại → req.file
// undefined → controller trả 400 "Không có file" (không ném lỗi thô).
import multer from 'multer'

export const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /\.(xlsx|xls|xlsm)$/i.test(file.originalname)),
})
