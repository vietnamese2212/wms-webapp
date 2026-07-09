# Bộ QA regression (Tầng 0 — TEST_PLAN_GOLIVE.md)

Chạy trên **Preview (dev) + DB STAGING**. Không dependency — chỉ cần Node 18+.
**Luật: xanh toàn bộ mới được merge main.**

```bash
node scripts/qa/run-all.mjs             # invariant → smoke → race → invariant  (~3–5')
node scripts/qa/run-all.mjs --scale 300 # thêm gói scale seed 300 đơn + dọn    (+~3')
```

Chạy lẻ từng gói: `node scripts/qa/00-invariant.mjs` (read-only, chạy lúc nào cũng được) ·
`01-smoke.mjs` · `02-race.mjs` · `03-scale.mjs [N]`.

## Gói nào kiểm gì
| Gói | Kiểm | Ghi DB? |
|---|---|---|
| `00-invariant` | Tồn không âm · không xuất quá KH · lệnh chuyển kho không mồ côi/không trùng · kế hoạch nhập & scan entry không mồ côi · IN_TRANSIT phải có lệnh | KHÔNG (read-only) |
| `01-smoke` | Login + GET 11 list chính + CRUD đơn xuất (tạo→sửa→xóa) | Có, tự dọn |
| `02-race` | 10× Xuất luôn đồng thời · 10× Hoàn thành đồng thời · xen kẽ Bỏ HT/Xuất luôn — bất biến: 1 lệnh, tồn trừ đúng 1 lần, pool về baseline | Có, tự dọn |
| `03-scale` | Seed N đơn+lệnh → list nóng < 3s & < 5MB → dọn sạch | Có, tự dọn |
| `04-qrformat` | QR pallet V1/V2 theo cờ `label_format`: format đúng nhận + lưu NGUYÊN VĂN (giữ đệm space, bóc batch/HSD), format sai 422, chống quét trùng. Mặc định test cờ HIỆN TẠI; **`--flip` lật cờ test cả 2 chiều rồi trả về — CHỈ chạy ngoài giờ vận hành** (trong ~1' lật, user đang quét sẽ bị 422) | Có, tự dọn |

## Cấu hình
- Mặc định trỏ Preview dev + đọc key staging từ `backend/.env`. Đổi qua env:
  `QA_BASE_URL` · `QA_ADMIN_EMAIL` · `QA_ADMIN_PASSWORD`.
- Dữ liệu nền cố định (kho test, mã pool) khai ở `lib.mjs` → `FIX`. Staging đổi data nền thì sửa ở đó.
- Mọi bản ghi test gắn `dvvt = 'QA-SUITE'` + ngày `2026-12-20` → nhận diện & dọn an toàn.

## Khi có FAIL
1. Invariant đỏ NGAY TỪ ĐẦU → DB đang bẩn từ trước (không phải do đợt test này) — soi bảng nêu trong message trước.
2. Race/scale đỏ → đọc dòng ❌ (có số liệu kỳ vọng vs thực tế) → debug theo skill `debug-systematic`.
3. Dọn khẩn khi script chết giữa chừng: `node -e` gọi lại `cleanupTagged` hoặc chạy lại gói scale (bước cleanup chạy theo tag, idempotent).

## Giới hạn đã biết (nâng cấp sau)
- Invariant quét client-side có cầu chì 50k dòng/bảng — staging hiện nhỏ nên đủ; khi data lớn chuyển các check sang RPC SQL.
- Chưa gồm: race booking slot (đã verify riêng chiến dịch `tms-slot-booking-atomic`, 1800 req), race quét QR kho QR (đã verify `concurrency-hardening`), test UI Playwright (tầng 1/5 của plan).
