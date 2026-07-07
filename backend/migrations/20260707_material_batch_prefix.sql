-- Multi-tenant ĐV2 (tem `;`): thêm mã tắt hàng để SINH mã lô V2.
-- Mã lô V2 = <batch_prefix 2 ký tự><yymmdd><Máy 1 ký tự><SEQ 3 số>, vd TA260705A018.
-- batch_prefix = 2 ký tự tắt tên hàng (khớp mã lô kế toán). NULL với ĐV1 (tem `_` không dùng).
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS batch_prefix text;
