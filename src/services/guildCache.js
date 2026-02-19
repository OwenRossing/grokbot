import {
  upsertGuildMetadata,
  getGuildMetadata,
  upsertGuildRole,
  deleteGuildRole,
  getGuildRoles,
  upsertMemberRole,
  deleteMemberRole,
  upsertGuildUser,
} from '../memory.js';

export async function cacheGuildOnStartup(guild, options = {}) {
  try {
    const hydrationMode = options.hydrationMode || 'full';
    await guild.fetch();
    
    upsertGuildMetadata({
      guildId: guild.id,
      name: guild.name,
      ownerId: guild.ownerId,
      memberCount: guild.memberCount,
      createdAt: guild.createdTimestamp,
    });

    for (const role of guild.roles.cache.values()) {
      if (role.name !== '@everyone') {
        upsertGuildRole({
          guildId: guild.id,
          roleId: role.id,
          roleName: role.name,
          color: role.hexColor,
          position: role.position,
          permissions: role.permissions.bitfield.toString(),
        });
      }
    }

    let memberCount = 0;
    if (hydrationMode === 'full') {
      const limit = Number.parseInt(process.env.MEMORY_HYDRATE_MEMBER_LIMIT || '1000', 10);
      const members = await guild.members.fetch({ limit: Number.isFinite(limit) ? limit : 1000 });
      memberCount = members.size;
      for (const member of members.values()) {
        upsertGuildUser({
          guildId: guild.id,
          userId: member.user.id,
          displayName: member.displayName || member.user.username,
          joinedAt: member.joinedTimestamp || Date.now(),
        });

        for (const role of member.roles.cache.values()) {
          if (role.name !== '@everyone') {
            upsertMemberRole(guild.id, member.user.id, role.id);
          }
        }
      }
    }
    
    return { success: true, members: memberCount, roles: guild.roles.cache.size, hydrationMode };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function cacheGuildOnJoin(guild) {
  try {
    upsertGuildMetadata({
      guildId: guild.id,
      name: guild.name,
      ownerId: guild.ownerId,
      memberCount: guild.memberCount,
      createdAt: guild.createdTimestamp,
    });

    for (const role of guild.roles.cache.values()) {
      if (role.name !== '@everyone') {
        upsertGuildRole({
          guildId: guild.id,
          roleId: role.id,
          roleName: role.name,
          color: role.hexColor,
          position: role.position,
          permissions: role.permissions.bitfield.toString(),
        });
      }
    }

    try {
      const members = await guild.members.fetch({ limit: 1000 });
      for (const member of members.values()) {
        upsertGuildUser({
          guildId: guild.id,
          userId: member.user.id,
          displayName: member.displayName || member.user.username,
          joinedAt: member.joinedTimestamp || Date.now(),
        });

        for (const role of member.roles.cache.values()) {
          if (role.name !== '@everyone') {
            upsertMemberRole(guild.id, member.user.id, role.id);
          }
        }
      }
    } catch (err) {
      console.error('Failed to cache members on guildCreate:', err.message);
    }
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export function updateGuildMetadata(guild) {
  upsertGuildMetadata({
    guildId: guild.id,
    name: guild.name,
    ownerId: guild.ownerId,
    memberCount: guild.memberCount,
    createdAt: guild.createdTimestamp,
  });
}

export function handleMemberJoin(member) {
  upsertGuildUser({
    guildId: member.guild.id,
    userId: member.user.id,
    displayName: member.displayName || member.user.username,
    joinedAt: member.joinedTimestamp || Date.now(),
  });

  const metadata = getGuildMetadata(member.guild.id);
  if (metadata) {
    upsertGuildMetadata({
      ...metadata,
      memberCount: member.guild.memberCount,
    });
  }
}

export function handleMemberRemove(member) {
  const metadata = getGuildMetadata(member.guild.id);
  if (metadata) {
    upsertGuildMetadata({
      ...metadata,
      memberCount: member.guild.memberCount,
    });
  }
}

export function handleMemberUpdate(oldMember, newMember) {
  if (oldMember.displayName !== newMember.displayName) {
    upsertGuildUser({
      guildId: newMember.guild.id,
      userId: newMember.user.id,
      displayName: newMember.displayName || newMember.user.username,
      joinedAt: newMember.joinedTimestamp || Date.now(),
    });
  }

  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;

  for (const [roleId, role] of oldRoles) {
    if (!newRoles.has(roleId) && role.name !== '@everyone') {
      deleteMemberRole(newMember.guild.id, newMember.user.id, roleId);
    }
  }

  for (const [roleId, role] of newRoles) {
    if (!oldRoles.has(roleId) && role.name !== '@everyone') {
      upsertMemberRole(newMember.guild.id, newMember.user.id, roleId);
    }
  }
}

export function handleRoleCreate(role) {
  if (role.name !== '@everyone') {
    upsertGuildRole({
      guildId: role.guild.id,
      roleId: role.id,
      roleName: role.name,
      color: role.hexColor,
      position: role.position,
      permissions: role.permissions.bitfield.toString(),
    });
  }
}

export function handleRoleUpdate(newRole) {
  if (newRole.name !== '@everyone') {
    upsertGuildRole({
      guildId: newRole.guild.id,
      roleId: newRole.id,
      roleName: newRole.name,
      color: newRole.hexColor,
      position: newRole.position,
      permissions: newRole.permissions.bitfield.toString(),
    });
  }
}

export function handleRoleDelete(role) {
  deleteGuildRole(role.guild.id, role.id);
}
