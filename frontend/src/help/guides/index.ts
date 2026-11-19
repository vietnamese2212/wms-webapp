// DANH SÁCH BÀI của module Hỗ trợ — dữ liệu thuần, không import gì của app (test backend/tests/unit/helpGuides.test.ts đọc
// thẳng file này và kiểm MỌI file trong thư mục guides/ đều có mặt ở đây — viết bài mà quên đăng ký là đỏ).
// Thứ tự = thứ tự công việc (danh mục → nhập → tồn → sản xuất → báo cáo); nhóm trên trang Hỗ trợ xếp theo bài đầu tiên của nhóm.
import type { Guide } from '../types'
import { MA_HANG_GUIDE } from './maHang'
import { NHAP_KHO_GUIDE } from './nhapKho'
import { IN_TEM_GUIDE } from './inTem'
import { TON_KHO_GUIDE } from './tonKho'
import { DON_TACH_GUIDE } from './donTach'
import { KIEM_KE_GUIDE } from './kiemKe'
import { MES_GUIDE } from './mes'
import { TRUY_XUAT_GUIDE } from './truyXuat'
import { LICH_SU_QUET_GUIDE } from './lichSuQuet'

export const ALL_GUIDES: Guide[] = [
  MA_HANG_GUIDE,
  NHAP_KHO_GUIDE, IN_TEM_GUIDE, TON_KHO_GUIDE, DON_TACH_GUIDE, KIEM_KE_GUIDE,
  MES_GUIDE,
  TRUY_XUAT_GUIDE, LICH_SU_QUET_GUIDE,
]
