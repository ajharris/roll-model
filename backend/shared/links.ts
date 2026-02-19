export const isCoachLinkActive = (item?: Record<string, unknown>): boolean => {
  if (!item) return false;
  const status = item.status;
  if (typeof status !== 'string') return true;
  return status === 'active';
};
