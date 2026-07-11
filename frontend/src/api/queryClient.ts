import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
      // 'always': offline vẫn BẮN mutation → interceptor axios từ chối TỨC THÌ với
      // thông báo rõ (client.ts) → onError hiện banner + rollback optimistic.
      // Mặc định 'online' sẽ PAUSE mutation khi offline → nút treo "đang lưu..." vô hạn
      // rồi tự bắn khi mạng về (ghi muộn bất ngờ) — tối kỵ với thao tác kho.
      networkMode: 'always',
    },
  },
})
