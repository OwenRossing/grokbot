import { PermissionFlagsBits } from 'discord.js';

export function isSuperAdminUser(userId, superAdminId) {
  if (!userId || !superAdminId) return false;
  return String(userId) === String(superAdminId);
}

export function hasManageGuildPermission(memberPermissions) {
  return Boolean(memberPermissions?.has?.(PermissionFlagsBits.ManageGuild));
}

export function hasInteractionAdminAccess(interaction, superAdminId) {
  return (
    isSuperAdminUser(interaction?.user?.id, superAdminId) ||
    hasManageGuildPermission(interaction?.memberPermissions)
  );
}

export function hasMessageAdminAccess(message, superAdminId) {
  return (
    isSuperAdminUser(message?.author?.id, superAdminId) ||
    hasManageGuildPermission(message?.member?.permissions)
  );
}
