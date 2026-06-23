---
name: verify-feature
description: BẮT BUỘC chạy TRƯỚC khi báo "đã xong" cho bất kỳ tính năng/sửa lỗi nào. Quy trình kiểm chứng chuẩn của dự án (KHÔNG phải viết unit test — dự án không có test framework): compile (tsc + build) → soi DB thật bằng Postgres MCP → realtime 4 case (tạo/sửa/xóa/làm lại) → UI flow thật bằng Playwright → TẢI ĐỒNG THỜI vài trăm nhân sự (không treo/đá user + không sai dữ liệu) → báo cáo trung thực kèm bằng chứng. Chống thói tuyên bố xong khi chưa chạy thử.
---

# Verify Feature — kiểm chứng trước khi báo xong

Hiện thực hóa CLAUDE.md mục #4 ("tiêu chí thành công verify được") + luật "Realtime & test bắt buộc". **Không claim "xong" nếu chưa qua các cổng dưới.** Báo cáo trung thực: pass/fail kèm bằng chứng; nếu skip bước nào, nói rõ skip.

## Cổng 1 — Compile (luôn luôn)
- Sửa frontend: `cd frontend && npx tsc --noEmit && npm run build`.
- Sửa backend: `cd backend && npx tsc --noEmit`. Nếu sửa `backend/src` → **bump rebuild-token** trong `api/index.ts` (Vercel mới rebuild function).
- Không pass → CHƯA xong, sửa ngay, không báo cáo.

## Cổng 2 — DB là nguồn sự thật (mọi tính năng đụng số liệu)
Dùng **Postgres MCP** (`mcp__postgres__query`, read-only) query trực tiếp bảng liên quan:
- Row tạo/sửa đúng giá trị? Có `id` (UUID) + `updated_at` chưa (DB không default → thiếu = lỗi 23502)?
- Xóa → row mất / số liệu hoàn lại đúng?
- Business date theo giờ VN (`YYYY-MM-DD`)? Timestamp UTC?

## Cổng 3 — Realtime 4 case (bắt buộc nếu có mutation số liệu)
Kiểm đủ: **1) Bắt đầu làm** (tạo mới → số liệu cập nhật ngay) · **2) Sửa** (giá trị mới phản ánh) · **3) Xóa** (hoàn lại đúng) · **4) Làm lại** (tích lũy đúng, không stale cache).
Đọc code xác nhận: `onSettled/onSuccess` của mutation `invalidateQueries` đủ MỌI query key liên quan; `TABLE_QUERY_MAP` trong `realtimeEvents.ts` có query key mới ở bảng DB tương ứng; optimistic update có rollback khi lỗi.

## Cổng 4 — UI flow thật (Playwright MCP)
- **Ưu tiên local dev**: nếu `localhost:5173` (FE) + `:4000` (BE) đang chạy thì test ở đó (an toàn, không đụng prod). Không chạy → hỏi user bật `npm run dev` hoặc cho phép test trên prod `wms-webapp.vercel.app` (lưu ý: thao tác ghi đụng DB production).
- **Login**: đọc `frontend/.env` (gitignored) → `TEST_EMAIL` + `TEST_PASSWORD` (hiện là tài khoản Admin toàn quyền). Trang login dùng **email + mật khẩu**. KHÔNG hardcode credential vào skill/repo/commit.
- **DB dùng chung (quan trọng)**: local dev và prod trỏ về CÙNG 1 Supabase — KHÔNG có DB test riêng. Nên thao tác GHI qua UI là đụng dữ liệu thật → ưu tiên smoke/đọc + verify bằng Postgres MCP; nếu cần test ghi thật thì dùng bản ghi nháp rõ ràng và DỌN sau, hoặc xin phép user.
- Thao tác đúng luồng vừa code (nút action, dialog, scan…) → `browser_snapshot`/`browser_take_screenshot` xác nhận hiển thị đúng.
- **BẮT BUỘC test CẢ desktop VÀ mobile** (không chỉ 1 cỡ) — dùng `browser_resize` rồi chụp từng cỡ:
  - **Desktop browser**: `1280×800` (kiểm bố cục đầy đủ, pane phải/cột, hover).
  - **Mobile**: `390×844` (iPhone) **và** `360×800` (Android nhỏ — mốc tràn màn) — kiểm FilterBar gom thành nút "Lọc", bottom nav, dialog/sheet không vỡ, KHÔNG tràn ngang.
  - (Có pane/tablet-specific) thêm `768×1024`.
  - Đọc lại ảnh từng cỡ để xác nhận, không chỉ chụp.
- Kiểm phân quyền: nút write có bị ẩn đúng khi thiếu `can(perms,…)` không.

## Cổng 5 — TẢI ĐỒNG THỜI: vài trăm nhân sự cùng thao tác (BẮT BUỘC cho mọi tính năng ghi số liệu)
> **Luôn đặt app vào tình huống VÀI TRĂM người cùng làm việc.** App thật chạy cao điểm hàng trăm nhân sự xuất/nhập/booking đồng thời — phải chứng minh 2 điều người dùng sợ nhất KHÔNG xảy ra:
> **(1) App treo / đá user ra đăng nhập.** **(2) Dữ liệu chạy sai khi nhiều người cùng làm.**

Cách mô phỏng (mẫu: `scratchpad/sim_wms.mjs`, `sim_booking.mjs` — setup/dryrun/run/verify/cleanup):
1. **Gọi API THẬT** (login `TEST_EMAIL/PASSWORD` → `fetch` endpoint thật), KHÔNG chỉ ghi DB trực tiếp — để test đúng logic controller dưới đua. (SETUP/CLEANUP thì ghi DB trực tiếp cho nhanh.)
2. **Dữ liệu giả BÁM SÁT DB thật**: kho / loại kho (warehouse_type) / mã hàng theo loại kho / cpp / vị trí theo category… kéo từ DB thật (Postgres MCP) rồi dùng. Đơn phải GIỐNG THẬT (vd đơn thành phẩm = TP + Thùng + POSM). Gắn NHÃN nhận diện (vd pallet_code/group_code chứa `SIMWMS`) để **DỌN SẠCH sau**. KHÔNG đụng dữ liệu thật (chọn mã/khoá chưa có dữ liệu thật, hoàn tác mọi ghi).
3. **Hai kịch bản**: **RẢI** (nhiều mã/bản ghi khác nhau — nhiều người làm nhiều việc khác nhau) + **TRANH CHẤP** (nhiều người cùng 1 pallet/slot/item — bộc lộ race). Và chạy **nhiều module ĐỒNG THỜI** (xuất + nhập + booking) như hệ thống thật.
4. **Quy mô**: tổng vài nghìn thao tác, nhưng **giới hạn ~25–30 request in-flight cùng lúc** (pool/concurrency) — mô phỏng vài trăm user steady-state mà KHÔNG bão hoà `max_connections=60`. **KHÔNG bắn tải lớn khi user thật đang dùng app** (xem [[tms-bookings-scale-auth]]).
5. **Kiểm (1) không treo/văng**: mở Playwright, **REFRESH GIỮA lúc tải nặng nhất** → phải KHÔNG bị đá ra `/login`; console **0 lỗi `ERR_INSUFFICIENT_RESOURCES`** (bão refetch); số liệu tự cập nhật (realtime) không cần refresh.
6. **Kiểm (2) không sai dữ liệu** — bất biến trên DB thật sau tải: tồn **không âm**, **không xuất quá** (imported−remaining = Σ scan entry), bộ đếm cache khớp Σ thật (vd `cartons_scanned`), slot **không overbooking**, `booked_count` không lệch. Còn lệch = CÓ BUG, sửa rồi test lại tới khi 0 lệch.
7. **DỌN SẠCH** + xác nhận 0 sót, không đụng dữ liệu thật.

**Bài học cốt tử:** optimistic-CAS / retry-on-conflict **PHẢI có jitter+backoff** (không thì thundering herd → nửa số request 409 oan). Capacity/counter dùng chung → đếm sống dưới row-lock (RPC) hoặc optimistic-CAS có jitter. Xem [[concurrency-hardening]] + [[tms-slot-booking-atomic]].

## Cổng 6 — Báo cáo trung thực
Liệt kê từng cổng: ✅ pass (bằng chứng: số liệu DB / screenshot) hoặc ❌ fail (output lỗi) hoặc ⊘ skip (lý do). Test fail thì NÓI fail kèm output, không che. Xong + verified mới nói "xong" dứt khoát.

## Checklist nhanh
- [ ] tsc --noEmit + build pass (FE và/hoặc BE)
- [ ] (BE thay đổi) bump rebuild-token
- [ ] Postgres MCP: row đúng, id+updated_at đủ
- [ ] Realtime 4 case + invalidateQueries + TABLE_QUERY_MAP
- [ ] Playwright: luồng UI thật, chụp CẢ desktop (1280) VÀ mobile (390 + 360) + phân quyền
- [ ] **TẢI ĐỒNG THỜI vài trăm user** (tính năng ghi số liệu): API thật + dữ liệu bám DB + rải & tranh chấp + đa-module đồng thời → (1) refresh giữa tải KHÔNG văng + console sạch · (2) bất biến số liệu 0 lệch · dọn sạch
- [ ] Báo cáo pass/fail/skip kèm bằng chứng
