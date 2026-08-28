// Vercel serverless entry → Express backend.
// Bump dòng dưới để buộc Vercel rebuild function khi backend/src thay đổi (tránh chạy bản cache cũ).
// rebuild-token: 2026-08-28.591
import app from '../backend/src/app'
export default app
