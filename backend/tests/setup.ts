// Chạy trước MỌI file test. Test không đụng mạng, nhưng vài module (utils/response → lib/supabase) tạo client
// Supabase lúc import và ném lỗi nếu thiếu env — CI không có backend/.env nên đặt giá trị giả ở đây.
// ⚠️ supabase-js v2.105 còn ném "Node.js 20 detected without native WebSocket support" ngay lúc createClient
// ⇒ test PHẢI chạy Node ≥ 22 (ci.yml / qa-nightly.yml đặt node-version 22; máy dev đang Node 24).
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-key'
process.env.JWT_SECRET ??= 'test-jwt-secret'
