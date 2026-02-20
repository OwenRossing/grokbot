export const VisibilityCategory = Object.freeze({
  SHAREABLE_STATS: 'shareable_stats',
  PRIVATE_INVENTORY: 'private_inventory',
  HIGH_NOISE: 'high_noise',
  ADMIN_CONTROL: 'admin_control',
});

export function resolveEphemeralVisibility({
  category,
  isPublic = false,
  forcePrivate = false,
} = {}) {
  if (forcePrivate) return true;

  switch (category) {
    case VisibilityCategory.SHAREABLE_STATS:
      return false;
    case VisibilityCategory.PRIVATE_INVENTORY:
      return !isPublic;
    case VisibilityCategory.HIGH_NOISE:
      return !isPublic;
    case VisibilityCategory.ADMIN_CONTROL:
      return true;
    default:
      return false;
  }
}
