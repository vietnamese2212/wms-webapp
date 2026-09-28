# TMS — Khung giờ (`tms_slots`)

> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").
> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**

**Trang:** Cài đặt TMS — Khung giờ

**Quyền (BE `ALL_PERMISSIONS`):** view · create · edit · delete

## Giao thoa với
<!-- giao-thoa:start -->
_(chưa ghi nhận)_
<!-- giao-thoa:end -->

## Trang / nghiệp vụ

Cài đặt TMS

## Actions

view, create (gồm "Sửa cả cụm" — endpoint batch), edit (sửa lẻ 1 dòng), delete (xóa lẻ + cả cụm). **`day_of_week` theo quy ước `getUTCDay()`: 0 = CN · 1..6 = T2..T7 — KHÔNG dùng 7.** Chủ Nhật MỞ từ 12/09 (migration `20260912c`): trước đó CHECK ở DB + `slotShapeError` chặn thứ 0 trong khi giao diện VỐN ĐÃ có nút "CN" ⇒ kho chạy Chủ Nhật thì lịch ngày đó RỖNG mà màn hình không nói gì (đo: chuyến Bàu Bàng 06/09 là chuyến duy nhất trong 54 chuyến không đặt được). ⚠ Gói QA 50 phép [19] từng KHOÁ CHÍNH LỖI LẠI (khẳng định "CN phải bị chặn" = chép lại CHECK cũ mà không hỏi nó đúng chưa — lớp `feedback-qa-can-lock-in-the-bug`). **Cửa lưới `POST /slot-templates/batch` GHI ĐÈ CẢ CỤM** (kho, loại xe, loại hàng): `days_of_week × time_slots` là TOÀN BỘ lưới, thứ nào không gửi là bị TẮT — gửi riêng `[0]` để "thêm CN" sẽ tắt sạch T2–T7 (tự sập 12/09); hệ quả kèm theo là lưới KHÔNG diễn tả được Chủ Nhật khác ngày thường, muốn khác thì sửa lẻ `PUT /slot-templates/:id`. **Cửa lẻ chống trùng bằng 409** (bảng không có unique index; trước 12/09 thêm lại đúng khung đã có là đẻ dòng thứ hai ⇒ sinh 2 `DeliverySlot` cùng giờ ⇒ sức chứa kho âm thầm GẤP ĐÔI) và nhận `max_vehicles: 0` = khoá khung giờ y như cửa lưới 
