import { useAuthStore } from '@/stores/authStore'
import { can, canAny, type ModuleKey, type ActionKey } from '@/config/permissions'

export function usePermission() {
  const level = useAuthStore((s) => s.user?.action_level ?? null)

  return {
    can:    (module: ModuleKey, action: ActionKey) => can(level, module, action),
    canAny: (module: ModuleKey) => canAny(level, module),
    level,
  }
}
