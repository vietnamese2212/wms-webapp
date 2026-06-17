---
name: debug-systematic
description: DÙNG khi gặp bug / lỗi / hành vi sai mà chưa rõ nguyên nhân (lỗi runtime, số liệu sai, UI hỏng, API trả lỗi, realtime không cập nhật…). Quy trình tìm nguyên nhân gốc 4 bước thay vì đoán-rồi-vá: tái hiện → khoanh vùng bằng bằng chứng (đọc code + soi DB Postgres MCP + log) → giả thuyết & kiểm chứng → sửa tối thiểu rồi verify. Chống sửa mò làm hỏng thêm.
---

# Debug có hệ thống — tìm nguyên nhân gốc

Phỏng theo systematic-debugging. Nguyên tắc: **KHÔNG sửa khi chưa hiểu nguyên nhân.** Mỗi bước phải có bằng chứng, không suy diễn (CLAUDE.md #1).

## Bước 1 — Tái hiện & xác định triệu chứng
- Triệu chứng CHÍNH XÁC là gì? (thông báo lỗi nguyên văn, số liệu sai cụ thể, bước nào trigger).
- Tái hiện được không? Điều kiện nào? Nếu không tái hiện ổn định → thu thập thêm trước khi đoán.

## Bước 2 — Khoanh vùng bằng bằng chứng (không đoán)
Thu hẹp dần "lỗi nằm ở đâu":
- **DB?** → Postgres MCP query trực tiếp: dữ liệu thực tế có đúng không? (phân biệt "lưu sai" vs "hiển thị sai").
- **Backend?** → đọc controller/route liên quan; kiểm payload, filter ngày (giờ VN), `id`/`updated_at`, requirePerm.
- **Frontend?** → đọc hook/component; kiểm query key, invalidateQueries, `TABLE_QUERY_MAP`, optimistic rollback, state.
- **Realtime?** → bảng có trong publication + `TABLE_QUERY_MAP` chưa.
- Dùng Playwright xem hành vi thật + console nếu là lỗi UI.
- Mục tiêu: chỉ ra **1 chỗ** chắc chắn sai, kèm bằng chứng (giá trị DB / dòng code / log).

## Bước 3 — Giả thuyết & kiểm chứng
- Phát biểu giả thuyết nguyên nhân gốc (vì sao chỗ đó sai).
- Kiểm chứng TRƯỚC khi sửa: query thêm / đọc thêm code / log tạm. Sai giả thuyết → quay lại bước 2, đừng cố sửa theo giả thuyết chưa chắc.

## Bước 4 — Sửa tối thiểu + verify
- Sửa đúng nguyên nhân gốc, **phạm vi nhỏ nhất** (CLAUDE.md #3) — không "tiện tay" refactor vùng xung quanh.
- Chạy lại đúng kịch bản tái hiện ở bước 1 → xác nhận hết lỗi.
- Tính năng đụng số liệu → chạy [[verify-feature]] (4 case realtime).
- Nếu là lỗi dễ tái phát: cân nhắc ghi 1 dòng nguyên nhân vào memory/CLAUDE.md (nếu user muốn).

## Cờ đỏ — đang debug sai cách
- Sửa nhiều chỗ cùng lúc "cho chắc" → dừng, khoanh lại 1 nguyên nhân.
- Thêm try/catch nuốt lỗi để "hết báo đỏ" → che triệu chứng, không phải sửa.
- "Chắc là do…" mà chưa query/đọc xác minh → đó là đoán, không phải khoanh vùng.
