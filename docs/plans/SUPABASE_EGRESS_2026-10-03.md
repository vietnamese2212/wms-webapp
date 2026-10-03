# Supabase staging VƯỢT HẠN BĂNG THÔNG RA (egress) — việc cần soi & sửa

> **Trạng thái 03/10/2026: ĐÃ ĐO, CHƯA SỬA.** Người đo: phiên rà CI. Người sửa: phiên dev điều vận.
> Chủ dự án **giữ gói FREE** (đây là môi trường dev) ⇒ phải giảm tiêu thụ, không nâng gói.

## Việc gấp tới mức nào

Supabase đã gửi cảnh báo Fair Use: hạn **5 GB egress/tháng**, ân hạn tới **02/11/2026**, sau đó
*"may apply service restrictions immediately"*. Còn ~1 tháng — không phải cháy nhà, nhưng đừng để tới hạn.

## Số đo gốc

`pg_stat_statements`, cửa sổ **28/09 14:08 → 03/10 02:26 (4 ngày 12 giờ)**:

```
517.342 request PostgREST  ≈ 115.000/ngày ≈ 1,3 request/giây suốt ngày đêm
```

…trên một DB dev gần như chỉ có MỘT người dùng thật.

**Gốc là SỐ LƯỢNG request, KHÔNG phải kích thước dữ liệu.** Đã đo riêng gói `00-invariant` bằng bộ
đếm byte thật: **1,5 MB / lượt (51 lời gọi)** — nhỏ. Nửa triệu request, mỗi cái mang header + body,
mới là thứ cộng thành GB.

> ⚠️ Lần đo ĐẦU của tôi ra 136 MB/lượt và **sai gấp ~90 lần**: tôi đo `select=*` trên cả bảng, trong
> khi gói thật dùng câu **có lọc, vài cột** (`cartons_remaining=lt.0`…). Ai đo lại thì đo đúng câu
> gói chạy, đừng đo bảng.

## Xếp hạng theo bảng (request · CPU)

| Bảng | Request | CPU |
|---|---:|---:|
| `erp_outbound_orders` | 47.227 | **83 phút** |
| `dispatch_plan` | 45.883 | 6 phút |
| `dispatch_trip_od` | 44.121 | 25 phút |
| `khvc_lines` | 29.490 | 1,5 phút |
| `Warehouse` | 28.303 | 2,5 phút |
| `GroupDeliveryOrder` | 25.910 | 14 phút |
| `dispatch_trip` | 24.879 | 3 phút |

**Điều vận chiếm gần MỘT NỬA toàn bộ request.**

## Hai điểm nóng — chỉ đích danh

**(1) Pool OD đọc lại mỗi lần** — câu tốn nhất của cả DB:

```
erp_outbound_orders — 17.187 lần × 177 ms = 3.049 giây (50 phút CPU)
```

~3.800 lần/ngày. Đây là tập OD mà máy ghép chuyến đọc lại mỗi lần **Lập kế hoạch / Tối ưu lại / mở bàn**.

**(2) Dấu hiệu đọc-từng-dòng:** `dispatch_plan` **45.883 request mà mỗi lần chỉ trả 1 dòng**.
Đúng lớp ratchet `n_plus_1_supabase_in_map` gác — nhưng ratchet chỉ bắt khuôn `.map(async …)`,
không bắt được khuôn này. (Nếu tìm ra khuôn thật ⇒ cân nhắc mở rộng ratchet, đừng chỉ vá chỗ đang nhìn.)

## Luật của CHÍNH dự án đang bị vi phạm

`CLAUDE.md` đã viết sẵn, không phải yêu cầu mới:

- **"SỐ REQUEST PostgREST MỖI LẦN MỞ TRANG LÀ TÀI NGUYÊN HIẾM"** — nút thắt là pool ~10 khe nội bộ
  của PostgREST; request thừa làm chậm **CẢ APP**, không riêng trang đó.
- **"RPC phân trang phải trả về DÒNG (jsonb), KHÔNG trả id rồi để backend nạp lại"**.
- **"Đếm round-trip bằng ĐO, đừng đọc code đếm tay"** (vòng lặp chunk phụ thuộc dữ liệu).

Tức đây là món nợ **đã có luật mà chưa ai soi vào đường điều vận**.

## Việc đề xuất, theo thứ tự giá trị

1. **Soi đường đọc của máy ghép chuyến** — vì sao pool OD phải đọc lại 17k lần. Gom về RPC trả dòng,
   hoặc giữ trong MỘT lần nạp cho cả lượt ghép. *Lợi kép: giảm băng thông + bàn điều vận nhanh hơn.*
2. **Soi `dispatch_plan` 1 dòng/lần × 45k** — tìm vòng lặp đọc từng dòng.
3. **`qa-smoke` không cần chạy MỖI push** — 400 lượt/30 ngày, mà `00-invariant` đọc **trạng thái
   chung của DB**, không phụ thuộc commit (commit sửa docs cũng chạy). Để ở bậc đêm là đủ.
4. **Các phiên chạy gói 61 bằng tay thưa lại** — mỗi lượt chạy máy ghép nhiều lần.

**Xoá dữ liệu test KHÔNG phải cần gạt chính** — vấn đề là số request, không phải kích thước mỗi câu
trả lời. Nếu vẫn muốn xoá: `erp_outbound_orders` (27k dòng, nhập từ SAP, nạp lại được) là ứng viên
hợp lý; **ĐỪNG xoá `InventoryEntry`** (56k) — đó là bộ dữ liệu giúp bộ kiểm bắt lớp lỗi cắt-âm-thầm
ở trần 1000 dòng, mà luật dự án đòi phải seed vượt ngưỡng.

## Điều CHƯA chắc — cần kiểm lại trước khi tin tuyệt đối

Tôi đếm được **REQUEST**, Supabase tính tiền theo **BYTE** — không nhìn được byte từ trong DB.
Ước lượng ~10 KB/phản hồi là **suy** từ phép đo gói invariant, không phải đo trực tiếp.
**Đối chiếu một lần với Usage Dashboard** (nó tách egress theo ngày) sẽ chốt con số thật và xác nhận
đúng ngày nào vọt lên. Chỉ chủ dự án mở được bảng đó.

## Cách đo lại (dán chạy được)

```sql
-- số request PostgREST + cửa sổ thống kê
select (select stats_reset from pg_stat_statements_info) as moc_reset,
       now() - (select stats_reset from pg_stat_statements_info) as cua_so,
       (select sum(calls) from pg_stat_statements where query like 'select set_config%') as so_request;

-- xếp hạng theo bảng
select (regexp_match(query, 'FROM "public"\."([A-Za-z_0-9]+)"'))[1] as bang,
       sum(calls) as so_request, round(sum(total_exec_time)::numeric/1000) as giay_cpu
from pg_stat_statements
where userid = (select oid from pg_roles where rolname='service_role')
  and query like '%pgrst_source%'
group by 1 order by 2 desc limit 20;

-- câu tốn nhất của một bảng
select calls, round(total_exec_time::numeric/1000) as giay, round(mean_exec_time::numeric,1) as ms_tb,
       left(regexp_replace(query,'\s+',' ','g'), 220)
from pg_stat_statements where query like '%erp_outbound_orders%' and query like '%pgrst_source%'
order by calls desc limit 6;
```

Đo băng thông THẬT của một gói QA: bọc `globalThis.fetch`, cộng `(await r.clone().arrayBuffer()).byteLength`
theo host, rồi `import` gói từ một BẢN SAO `scripts/qa` trong hộp cát (ROOT của `lib.mjs` = thư mục cha
của `scripts/qa`, nên bản sao cần cả `backend/.env` + `backend/src` + `frontend/src`).

---

## Việc nhỏ kèm theo (không thuộc egress)

**Mức +10 % sức chứa dòng xe chỉ nằm trong DỮ LIỆU.** Chủ dự án xác nhận 03/10 đây là yêu cầu của
mình ("tôi yêu cầu 10% mà"). Cả danh mục `vehicle_model` đã được cập nhật hàng loạt **×1,10** lúc
`02/10 06:47:03.849` (mọi dòng cùng một mốc `updated_at` ⇒ một lệnh chạy một lần).

**Nhưng KHÔNG có luật nào trong code áp nó** — đã tìm, `vehicleModelController` và
`services/vehicleModelScope` đều không có hệ số nào. Hệ quả: **dòng xe thêm MỚI qua form sẽ mang số
danh định thô, không tự +10 %.** Đây là khuôn "luật chỉ sống trong dữ liệu" — cần chốt có đưa 10 %
thành cấu hình để máy tự áp hay không.

(Phép kiểm `60-freight [1a2]` đã đổi sang chờ `3,85` theo yêu cầu của chủ dự án 03/10.)
