import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import {
  allowChannel,
  denyChannel,
  forgetUser,
  getGuildMemorySettings,
  isGuildStatusVisibilityEnabled,
  listChannels,
  resetChannelMemory,
  resetGuildMemory,
  setGuildMemoryScope,
  setGuildStatusVisibility,
  setUserMemory,
  viewMemory,
} from '../memory.js';
import {
  hasInteractionAdminAccess,
  hasMessageAdminAccess,
  isSuperAdminUser,
} from '../utils/auth.js';

const CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const pendingConfirmations = new Map();

function makeToken() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function parseUserMentionId(text) {
  const match = String(text || '').match(/<@!?(\d+)>/);
  return match?.[1] || '';
}

function parseChannelMentionId(text) {
  const match = String(text || '').match(/<#(\d+)>/);
  return match?.[1] || '';
}

function normalizeMode(text) {
  const value = String(text || '').toLowerCase();
  if (/allow\s*all\s*visible|allow_all_visible|all\s*visible/.test(value)) {
    return 'allow_all_visible';
  }
  return 'allowlist';
}

export function buildRequestFromMemoryInteraction(interaction) {
  const group = interaction.options.getSubcommandGroup();
  const sub = interaction.options.getSubcommand();

  if (group === 'user') {
    if (sub === 'on') return { id: 'memory.user.on', domain: 'memory', visibility: 'private' };
    if (sub === 'off') return { id: 'memory.user.off', domain: 'memory', visibility: 'private' };
    if (sub === 'view') return { id: 'memory.user.view', domain: 'memory', visibility: 'private' };
    if (sub === 'reset') return { id: 'memory.user.reset', domain: 'memory', visibility: 'private' };
  }

  if (group === 'channel') {
    if (sub === 'allow') {
      const channel = interaction.options.getChannel('channel', true);
      return {
        id: 'memory.channel.allow',
        domain: 'memory',
        visibility: 'public',
        requiresAdmin: true,
        guildOnly: true,
        args: { channelId: channel.id },
      };
    }
    if (sub === 'deny') {
      const channel = interaction.options.getChannel('channel', true);
      return {
        id: 'memory.channel.deny',
        domain: 'memory',
        visibility: 'public',
        requiresAdmin: true,
        guildOnly: true,
        args: { channelId: channel.id },
      };
    }
    if (sub === 'list') {
      return {
        id: 'memory.channel.list',
        domain: 'memory',
        visibility: 'private',
        requiresAdmin: true,
        guildOnly: true,
      };
    }
    if (sub === 'reset') {
      const channel = interaction.options.getChannel('channel', true);
      return {
        id: 'memory.channel.reset',
        domain: 'memory',
        visibility: 'public',
        riskLevel: 'risky',
        requiresAdmin: true,
        guildOnly: true,
        args: { channelId: channel.id },
      };
    }
  }

  if (group === 'guild') {
    if (sub === 'scope') {
      const mode = interaction.options.getString('mode', true);
      return {
        id: 'memory.guild.scope',
        domain: 'memory',
        visibility: 'public',
        requiresAdmin: true,
        guildOnly: true,
        args: { mode: normalizeMode(mode) },
      };
    }
    if (sub === 'view') {
      return {
        id: 'memory.guild.view',
        domain: 'memory',
        visibility: 'private',
        requiresAdmin: true,
        guildOnly: true,
      };
    }
    if (sub === 'reset') {
      return {
        id: 'memory.guild.reset',
        domain: 'memory',
        visibility: 'public',
        riskLevel: 'risky',
        requiresAdmin: true,
        guildOnly: true,
      };
    }
  }

  if (group === 'admin' && sub === 'reset-user') {
    const user = interaction.options.getUser('user', true);
    return {
      id: 'memory.admin.reset_user',
      domain: 'memory',
      visibility: 'private',
      riskLevel: 'risky',
      requiresAdmin: true,
      guildOnly: true,
      args: { targetUserId: user.id, targetUsername: user.username },
    };
  }

  return null;
}

export function buildRequestFromStatusInteraction(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'on') {
    return {
      id: 'status.on',
      domain: 'status',
      visibility: 'public',
      requiresAdmin: true,
      guildOnly: true,
    };
  }
  if (sub === 'off') {
    return {
      id: 'status.off',
      domain: 'status',
      visibility: 'public',
      requiresAdmin: true,
      guildOnly: true,
    };
  }
  if (sub === 'view') {
    return {
      id: 'status.view',
      domain: 'status',
      visibility: 'private',
      requiresAdmin: true,
      guildOnly: true,
    };
  }
  return null;
}

export function parseNaturalCommandRequest(text, { actorId } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  const dryRun =
    /\bdry\s*run\b/.test(lower) ||
    /^what would you do/.test(lower) ||
    /^preview\b/.test(lower) ||
    /\bwhat will you do\b/.test(lower);

  const targetChannelId = parseChannelMentionId(raw);
  const targetUserId = parseUserMentionId(raw);

  if (/\b(enable|turn on)\b.*\bmemory\b/.test(lower) && /\bfor\b/.test(lower) && targetChannelId) {
    return {
      request: {
        id: 'memory.channel.allow',
        domain: 'memory',
        visibility: 'public',
        requiresAdmin: true,
        guildOnly: true,
        args: { channelId: targetChannelId },
      },
      dryRun,
    };
  }

  if (/\b(disable|turn off|deny)\b.*\bmemory\b/.test(lower) && /\bfor\b/.test(lower) && targetChannelId) {
    return {
      request: {
        id: 'memory.channel.deny',
        domain: 'memory',
        visibility: 'public',
        requiresAdmin: true,
        guildOnly: true,
        args: { channelId: targetChannelId },
      },
      dryRun,
    };
  }

  if (/\b(reset|clear|wipe)\b.*\bmemory\b/.test(lower) && /\bguild|server\b/.test(lower)) {
    return {
      request: {
        id: 'memory.guild.reset',
        domain: 'memory',
        visibility: 'public',
        riskLevel: 'risky',
        requiresAdmin: true,
        guildOnly: true,
      },
      dryRun,
    };
  }

  if (/\b(reset|clear|wipe)\b.*\bmemory\b/.test(lower) && targetChannelId) {
    return {
      request: {
        id: 'memory.channel.reset',
        domain: 'memory',
        visibility: 'public',
        riskLevel: 'risky',
        requiresAdmin: true,
        guildOnly: true,
        args: { channelId: targetChannelId },
      },
      dryRun,
    };
  }

  if (/\b(reset|clear|wipe)\b.*\bmemory\b/.test(lower) && targetUserId && targetUserId !== actorId) {
    return {
      request: {
        id: 'memory.admin.reset_user',
        domain: 'memory',
        visibility: 'private',
        riskLevel: 'risky',
        requiresAdmin: true,
        guildOnly: true,
        args: { targetUserId },
      },
      dryRun,
    };
  }

  if (/\b(reset|clear|wipe)\b.*\b(my|me|user)?\s*memory\b/.test(lower)) {
    return {
      request: {
        id: 'memory.user.reset',
        domain: 'memory',
        visibility: 'private',
      },
      dryRun,
    };
  }

  if (/\b(memory on|enable my memory|turn on my memory)\b/.test(lower) || (/(\benable\b|\bturn on\b)/.test(lower) && /\bmemory\b/.test(lower) && !targetChannelId)) {
    return {
      request: {
        id: 'memory.user.on',
        domain: 'memory',
        visibility: 'private',
      },
      dryRun,
    };
  }

  if (/\b(memory off|disable my memory|turn off my memory)\b/.test(lower) || (/(\bdisable\b|\bturn off\b)/.test(lower) && /\bmemory\b/.test(lower) && !targetChannelId)) {
    return {
      request: {
        id: 'memory.user.off',
        domain: 'memory',
        visibility: 'private',
      },
      dryRun,
    };
  }

  if (/\b(show|view)\b.*\bmy\b.*\bmemory\b/.test(lower)) {
    return {
      request: {
        id: 'memory.user.view',
        domain: 'memory',
        visibility: 'private',
      },
      dryRun,
    };
  }

  if (/\b(list|show|view)\b.*\b(memory\s+)?channels\b/.test(lower)) {
    return {
      request: {
        id: 'memory.channel.list',
        domain: 'memory',
        visibility: 'private',
        requiresAdmin: true,
        guildOnly: true,
      },
      dryRun,
    };
  }

  if (/\b(set|change|update)\b.*\bmemory scope\b/.test(lower) || /\bmemory scope\b/.test(lower)) {
    return {
      request: {
        id: 'memory.guild.scope',
        domain: 'memory',
        visibility: 'public',
        requiresAdmin: true,
        guildOnly: true,
        args: { mode: normalizeMode(lower) },
      },
      dryRun,
    };
  }

  if (/\b(show|view)\b.*\b(memory settings|memory scope|guild memory)\b/.test(lower)) {
    return {
      request: {
        id: 'memory.guild.view',
        domain: 'memory',
        visibility: 'private',
        requiresAdmin: true,
        guildOnly: true,
      },
      dryRun,
    };
  }

  if (/\b(enable|turn on)\b.*\bstatus\b/.test(lower)) {
    return {
      request: {
        id: 'status.on',
        domain: 'status',
        visibility: 'public',
        requiresAdmin: true,
        guildOnly: true,
      },
      dryRun,
    };
  }

  if (/\b(disable|turn off)\b.*\bstatus\b/.test(lower)) {
    return {
      request: {
        id: 'status.off',
        domain: 'status',
        visibility: 'public',
        requiresAdmin: true,
        guildOnly: true,
      },
      dryRun,
    };
  }

  if (/\b(show|view)\b.*\bstatus\b/.test(lower)) {
    return {
      request: {
        id: 'status.view',
        domain: 'status',
        visibility: 'private',
        requiresAdmin: true,
        guildOnly: true,
      },
      dryRun,
    };
  }

  return null;
}

function formatRequestPreview(request) {
  const fields = [];
  fields.push(`Command: ${request.id}`);
  if (request.args?.channelId) fields.push(`Channel: <#${request.args.channelId}>`);
  if (request.args?.targetUserId) fields.push(`Target user: <@${request.args.targetUserId}>`);
  if (request.args?.mode) fields.push(`Mode: ${request.args.mode}`);
  fields.push(`Risk: ${request.riskLevel === 'risky' ? 'risky' : 'safe'}`);
  return fields.join('\n');
}

function authorizerFromInteraction(interaction, superAdminId) {
  const isSuperAdmin = isSuperAdminUser(interaction.user.id, superAdminId);
  const hasAdminPerms = hasInteractionAdminAccess(interaction, superAdminId);

  return {
    actorId: interaction.user.id,
    isSuperAdmin,
    hasAdminPerms,
    inGuild: interaction.inGuild(),
    guildId: interaction.guildId,
    guildChannelIds: interaction.guild ? new Set(interaction.guild.channels.cache.keys()) : new Set(),
  };
}

function authorizerFromMessage(message, superAdminId) {
  const isSuperAdmin = isSuperAdminUser(message.author.id, superAdminId);
  const hasAdminPerms = hasMessageAdminAccess(message, superAdminId);

  return {
    actorId: message.author.id,
    isSuperAdmin,
    hasAdminPerms,
    inGuild: Boolean(message.guildId),
    guildId: message.guildId,
    guildChannelIds: message.guild ? new Set(message.guild.channels.cache.keys()) : new Set(),
  };
}

function checkAuthorization(request, auth) {
  if (request.guildOnly && !auth.inGuild && !auth.isSuperAdmin) {
    return 'Guilds only.';
  }
  if (request.requiresAdmin && !auth.hasAdminPerms) {
    return 'Admin only.';
  }
  return '';
}

async function executeRequest(request, auth) {
  switch (request.id) {
    case 'memory.user.on':
      setUserMemory(auth.actorId, true);
      return { message: 'Memory is on.', visibility: request.visibility || 'private' };
    case 'memory.user.off':
      setUserMemory(auth.actorId, false);
      return { message: 'Memory is off.', visibility: request.visibility || 'private' };
    case 'memory.user.view': {
      const summary = viewMemory(auth.actorId);
      return { message: summary, visibility: request.visibility || 'private' };
    }
    case 'memory.user.reset':
      forgetUser(auth.actorId);
      return { message: 'Your memory has been reset.', visibility: request.visibility || 'private' };
    case 'memory.channel.allow':
      allowChannel(request.args.channelId);
      return { message: `Allowed memory in <#${request.args.channelId}>.`, visibility: request.visibility || 'public' };
    case 'memory.channel.deny':
      denyChannel(request.args.channelId);
      return { message: `Denied memory in <#${request.args.channelId}>.`, visibility: request.visibility || 'public' };
    case 'memory.channel.list': {
      const allRows = listChannels();
      const rows = allRows.filter((row) => auth.guildChannelIds.has(row.channel_id));
      if (!rows.length) {
        return { message: 'No channels configured in this guild.', visibility: request.visibility || 'private' };
      }
      const formatted = rows
        .map((row) => `• <#${row.channel_id}>: ${row.enabled ? 'allowed' : 'denied'}`)
        .join('\n');
      return { message: formatted, visibility: request.visibility || 'private' };
    }
    case 'memory.channel.reset':
      resetChannelMemory(request.args.channelId);
      return { message: `Memory reset for <#${request.args.channelId}>.`, visibility: request.visibility || 'public' };
    case 'memory.guild.scope': {
      const safeMode = request.args.mode === 'allow_all_visible' ? 'allow_all_visible' : 'allowlist';
      setGuildMemoryScope(auth.guildId, safeMode);
      const label = safeMode === 'allow_all_visible' ? 'allow all visible channels' : 'allowlist only';
      return { message: `Memory scope updated: ${label}.`, visibility: request.visibility || 'public' };
    }
    case 'memory.guild.view': {
      const settings = getGuildMemorySettings(auth.guildId);
      const mode = settings?.scope_mode || 'allowlist';
      return { message: `Memory scope: ${mode}`, visibility: request.visibility || 'private' };
    }
    case 'memory.guild.reset':
      resetGuildMemory(auth.guildId);
      return { message: 'Guild memory reset.', visibility: request.visibility || 'public' };
    case 'memory.admin.reset_user': {
      forgetUser(request.args.targetUserId);
      const userLabel = request.args.targetUsername || `<@${request.args.targetUserId}>`;
      return {
        message: `Memory reset for ${userLabel}. This action has been logged.`,
        visibility: request.visibility || 'private',
      };
    }
    case 'status.on':
      setGuildStatusVisibility(auth.guildId, true);
      return { message: 'Status sidecar is on for this guild.', visibility: request.visibility || 'public' };
    case 'status.off':
      setGuildStatusVisibility(auth.guildId, false);
      return { message: 'Status sidecar is off for this guild.', visibility: request.visibility || 'public' };
    case 'status.view': {
      const enabled = isGuildStatusVisibilityEnabled(auth.guildId);
      const mode = getGuildMemorySettings(auth.guildId)?.scope_mode || 'allowlist';
      return {
        message: `Status sidecar: ${enabled ? 'on' : 'off'}\nMemory scope: ${mode}`,
        visibility: request.visibility || 'private',
      };
    }
    default:
      return { message: `Unknown command request: ${request.id}`, visibility: 'private' };
  }
}

function buildConfirmComponents(token) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cmd_confirm:${token}`)
        .setStyle(ButtonStyle.Danger)
        .setLabel('Confirm'),
      new ButtonBuilder()
        .setCustomId(`cmd_cancel:${token}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Cancel')
    ),
  ];
}

async function sendInteractionReply(interaction, { message, visibility, components }) {
  const ephemeral = visibility === 'private';
  const payload = { content: message, ephemeral, components: components || [] };
  if (interaction.deferred) {
    return interaction.editReply(payload);
  }
  if (interaction.replied) {
    return interaction.followUp(payload);
  }
  return interaction.reply(payload);
}

async function sendMessageReply(message, { text, visibility, components }) {
  if (visibility === 'private') {
    try {
      await message.author.send({ content: text, components: components || [] });
      return message.reply({ content: 'Sent details to your DM.' });
    } catch {
      return message.reply({ content: text, components: components || [] });
    }
  }
  return message.reply({ content: text, components: components || [] });
}

export async function executeCommandRequestFromInteraction({
  interaction,
  request,
  superAdminId,
  dryRun = false,
  skipConfirmation = false,
}) {
  const auth = authorizerFromInteraction(interaction, superAdminId);
  const authError = checkAuthorization(request, auth);
  if (authError) {
    await sendInteractionReply(interaction, { message: authError, visibility: 'private' });
    return true;
  }

  if (dryRun) {
    await sendInteractionReply(interaction, {
      message: `Dry run preview:\n${formatRequestPreview(request)}`,
      visibility: 'private',
    });
    return true;
  }

  if (request.riskLevel === 'risky' && !skipConfirmation) {
    const token = makeToken();
    pendingConfirmations.set(token, {
      request,
      actorId: auth.actorId,
      guildId: auth.guildId,
      expiresAt: Date.now() + CONFIRMATION_TTL_MS,
      source: 'interaction',
    });
    await sendInteractionReply(interaction, {
      message: `This action is risky and needs confirmation.\n${formatRequestPreview(request)}`,
      visibility: 'private',
      components: buildConfirmComponents(token),
    });
    return true;
  }

  const result = await executeRequest(request, auth);
  await sendInteractionReply(interaction, {
    message: result.message,
    visibility: result.visibility,
  });
  return true;
}

export async function executeCommandRequestFromMessage({
  message,
  request,
  superAdminId,
  dryRun = false,
  skipConfirmation = false,
}) {
  const auth = authorizerFromMessage(message, superAdminId);
  const authError = checkAuthorization(request, auth);
  if (authError) {
    await sendMessageReply(message, { text: authError, visibility: 'private' });
    return true;
  }

  if (dryRun) {
    await sendMessageReply(message, {
      text: `Dry run preview:\n${formatRequestPreview(request)}`,
      visibility: 'private',
    });
    return true;
  }

  if (request.riskLevel === 'risky' && !skipConfirmation) {
    const token = makeToken();
    pendingConfirmations.set(token, {
      request,
      actorId: auth.actorId,
      guildId: auth.guildId,
      expiresAt: Date.now() + CONFIRMATION_TTL_MS,
      source: 'message',
    });
    const confirmVisibility =
      request.guildOnly || request.visibility !== 'private' ? 'public' : 'private';
    await sendMessageReply(message, {
      text: `This action is risky and needs confirmation.\n${formatRequestPreview(request)}`,
      visibility: confirmVisibility,
      components: buildConfirmComponents(token),
    });
    return true;
  }

  const result = await executeRequest(request, auth);
  await sendMessageReply(message, {
    text: result.message,
    visibility: result.visibility,
  });
  return true;
}

export async function executeCommandConfirmationButton(interaction, { superAdminId } = {}) {
  const [prefix, action, token] = String(interaction.customId || '').split(':');
  if (prefix !== 'cmd' || !token) return false;

  const entry = pendingConfirmations.get(token);
  if (!entry) {
    await interaction.reply({ content: 'Confirmation not found or expired.', ephemeral: true });
    return true;
  }

  if (Date.now() > entry.expiresAt) {
    pendingConfirmations.delete(token);
    await interaction.reply({ content: 'Confirmation expired. Please run the command again.', ephemeral: true });
    return true;
  }

  if (interaction.user.id !== entry.actorId) {
    await interaction.reply({ content: 'Only the original requester can confirm this action.', ephemeral: true });
    return true;
  }

  if (action === 'cancel') {
    pendingConfirmations.delete(token);
    await interaction.update({ content: 'Command cancelled.', components: [] });
    return true;
  }

  if (action !== 'confirm') {
    await interaction.reply({ content: 'Unknown confirmation action.', ephemeral: true });
    return true;
  }

  pendingConfirmations.delete(token);

  const auth = authorizerFromInteraction(interaction, superAdminId);
  const authError = checkAuthorization(entry.request, auth);
  if (authError) {
    await interaction.update({ content: authError, components: [] });
    return true;
  }

  const result = await executeRequest(entry.request, auth);
  if (entry.source === 'interaction') {
    if (result.visibility === 'public') {
      await interaction.update({ content: 'Confirmed. Executing command...', components: [] });
      await interaction.followUp({ content: result.message, ephemeral: false });
    } else {
      await interaction.update({ content: result.message, components: [] });
    }
    return true;
  }

  if (result.visibility === 'private') {
    await interaction.update({ content: 'Command executed. Details sent privately.', components: [] });
    await interaction.followUp({ content: result.message, ephemeral: true });
  } else {
    await interaction.update({ content: result.message, components: [] });
  }
  return true;
}
