import type { UserRole } from '@/types/api';

export const getDefaultRouteForRole = (role: UserRole) => {
  if (role === 'coach') return '/coach';
  if (role === 'admin') return '/admin/config-health';
  return '/entries';
};

