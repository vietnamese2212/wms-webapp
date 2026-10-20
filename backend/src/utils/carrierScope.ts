// PHẠM VI CỦA TÀI KHOẢN ĐVVT (`user.ncc_id`) — theo CÔNG TY, không theo kho. MỘT luật cho mọi cửa chạm lệnh vận chuyển.
// C3 lặp HAI lần ngày 20/10: vehicleSlotController (sửa / nhả xe) rồi orderController (sửa lệnh · xem hàng của lệnh · tab Chuyển kho)
// đều cho tài khoản có `ncc_id` "toàn quyền" vì hàm phạm vi kho trả null cho ĐVVT ⇒ ĐVVT 3S thao tác được lệnh của Hải An.
// Ngoại lệ: lệnh CHUYỂN KHO chưa gán hãng (sinh trước 20/10, không mang `ncc_id`) — ĐVVT vẫn khai giờ đến / SĐT cho kho nhận.
// Từ 20/10 lệnh chuyển kho kế thừa ĐVVT của chuyến gốc (outboundController.maybeAutoCreateTransferOrder) nên ngoại lệ chỉ còn dữ liệu cũ.
export type CarrierOrderRow = { ncc_id: string | null; source_type: string | null }

export function carrierMayTouch(userNccId: string, o: CarrierOrderRow): boolean {
  if (o.ncc_id == null) return o.source_type === 'TRANSFER'
  return o.ncc_id === userNccId
}
