import { useAuthStore } from '@/stores/authStore'
import { can, canAccess, type ModuleKey, type ModulePermissions } from '@/config/permissions'

export function usePermission() {
  const perms = useAuthStore((s) => s.user?.module_permissions as ModulePermissions | null ?? null)

  return {
    can:       (module: ModuleKey, action: string) => can(perms, module, action),
    canAccess: (module: ModuleKey) => canAccess(perms, module),
    perms,
  }
}
