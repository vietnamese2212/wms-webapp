// Vercel serverless entry → Express backend.
// Bump dòng dưới để buộc Vercel rebuild function khi backend/src thay đổi (tránh chạy bản cache cũ).
// rebuild-token: 2026-07-21.348
import app from '../backend/src/app'
export default app
