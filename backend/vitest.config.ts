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
    // mỗi test in ra seed khi đỏ → tái hiện bằng RNG_SEED=<seed> npm test
    reporters: 'default',
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '../frontend/src') },
  },
})
