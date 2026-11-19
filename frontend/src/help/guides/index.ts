// DANH SÁCH BÀI của module Hỗ trợ — dữ liệu thuần, không import gì của app (test backend/tests/unit/helpGuides.test.ts đọc
// thẳng file này và kiểm MỌI file trong thư mục guides/ đều có mặt ở đây — viết bài mà quên đăng ký là đỏ).
// THỨ TỰ = thứ tự một người MỚI cần học (user 19/11: "Với 1 người mới hoàn toàn - cần làm việc gì đầu tiên với app chứ?"):
// bắt đầu (đăng nhập, mật khẩu, màn hình) → danh mục → in tem → nhập → tồn → dồn/tách → kiểm kê → sản xuất → báo cáo.
// Trang Hỗ trợ đánh số bài theo đúng thứ tự này (số tính trên các bài người đó được thấy).
import type { Guide } from '../types'
import { BAT_DAU_GUIDE } from './batDau'
import { MA_HANG_GUIDE } from './maHang'
import { IN_TEM_GUIDE } from './inTem'
import { NHAP_KHO_GUIDE } from './nhapKho'
import { TON_KHO_GUIDE } from './tonKho'
import { DON_TACH_GUIDE } from './donTach'
import { KIEM_KE_GUIDE } from './kiemKe'
import { MES_GUIDE } from './mes'
import { TRUY_XUAT_GUIDE } from './truyXuat'
import { LICH_SU_QUET_GUIDE } from './lichSuQuet'

export const ALL_GUIDES: Guide[] = [
  BAT_DAU_GUIDE,
  MA_HANG_GUIDE,
  IN_TEM_GUIDE, NHAP_KHO_GUIDE, TON_KHO_GUIDE, DON_TACH_GUIDE, KIEM_KE_GUIDE,
  MES_GUIDE,
  TRUY_XUAT_GUIDE, LICH_SU_QUET_GUIDE,
]
