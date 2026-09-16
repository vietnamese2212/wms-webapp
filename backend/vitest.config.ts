// TEST ĐƠN VỊ + PHÉP KIỂM MIRROR (11/09/2026) — chạy trong vài giây, KHÔNG cần DB, KHÔNG cần Preview.
// `npm test` trong backend/. Tests nằm ở backend/tests/:
//   tests/mirror/  — cùng input, bản BE và bản FE của một helper PHẢI ra cùng kết quả
//                    (lớp lỗi "luật chép tay bản sau thiếu một nhánh" — xem docs/qa/BUG_CLASSES.md)
//   tests/unit/    — bất biến của helper thuần (round-trip, luật số nguyên, lịch thật…)
// FE import thẳng từ ../frontend/src (alias @ trỏ về đó để file FE có `import type '@/types'` vẫn resolve).
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],   // env giả cho module tạo client Supabase lúc import (CI không có .env)
    // mỗi test in ra seed khi đỏ → tái hiện bằng RNG_SEED=<seed> npm test
    reporters: 'default',
    // Phép kiểm mirror chạy N=3000 input ngẫu nhiên nên tốn 1–3 giây MỖI file; trần mặc định
    // 5 giây của vitest nằm quá sát. Đo 16/09: chạy trọn bộ 3 lượt thì 1 lượt ĐỎ với
    // "Test timed out in 5000ms" — không sai kết quả, chỉ là hết giờ lúc máy bận (các file
    // chạy song song). Đỏ kiểu này lên CI là email báo lỗi OAN, đúng lớp C18/C22.
    // Nới trần, KHÔNG giảm N: số input ngẫu nhiên chính là giá trị của phép kiểm.
    testTimeout: 30_000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '../frontend/src') },
  },
})
