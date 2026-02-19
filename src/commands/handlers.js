import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import {
  getUserSettings,
  isChannelAllowed,
  queueUserMessage,
  setUserMemory,
  setUserAutoreply,
  forgetUser,
  viewMemory,
  getProfileSummary,
  getRecentMessages,
  getUserContext,
  allowChannel,
  denyChannel,
  listChannels,
  resetGuildMemory,
  resetChannelMemory,
  getGuildMetadata,
  getGuildRoles,
  trackBotMessage,
  getBotMessagesInChannel,
  deleteBotMessageRecord,
  setGuildMemoryScope,
  getGuildMemorySettings,
  setGuildStatusVisibility,
  isGuildStatusVisibilityEnabled,
  searchMemory,
  logSearchEvent,
} from '../memory.js';
import { checkRateLimit } from '../rateLimit.js';
import { searchGiphyGif } from '../services/media.js';
import { handlePrompt } from '../handlers/handlePrompt.js';
import { DISCORD_INTERACTION_EXPIRED_CODE, DISCORD_UNKNOWN_MESSAGE_CODE, DISCORD_BULK_DELETE_LIMIT, NUMBER_EMOJIS } from '../utils/constants.js';
import { parseDuration, containsHateSpeech } from '../utils/validators.js';
import {
  createPoll,
  recordVote,
  removeVote,
  tallyVotes,
  closePoll,
} from '../polls.js';
import { shouldRecordMemoryMessage } from '../utils/helpers.js';
import { searchWeb } from '../services/webSearch/index.js';

export async function executeAskCommand(interaction, inMemoryTurns, client) {
  const question = interaction.options.getString('question', true);
  const ghost = interaction.options.getBoolean('ghost') ?? true;
  const settings = getUserSettings(interaction.user.id);
  const memoryChannel = interaction.channel?.isDMBased?.()
    ? true
    : isChannelAllowed(interaction.channelId, interaction.guildId);
  const allowMemoryContext = memoryChannel && settings.memory_enabled;
  const displayName =
    interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
  const username = interaction.user.username;
  const globalName = interaction.user.globalName || '';

  if (containsHateSpeech(question)) {
    await interaction.reply({ content: 'nah, not touching that.', ephemeral: true });
    return;
  }

  const replyFn = async (text) => {
    try {
      let reply;
      if (interaction.deferred) {
        reply = await interaction.editReply({ content: text });
      } else if (interaction.replied) {
        reply = await interaction.followUp({ content: text, ephemeral: ghost });
      } else {
        reply = await interaction.reply({ content: text, ephemeral: ghost });
      }
      if (reply?.id && !ghost) {
        trackBotMessage(reply.id, interaction.channelId, interaction.guildId);
      }
    } catch (err) {
      if (err.code === DISCORD_INTERACTION_EXPIRED_CODE) {
        console.error('Failed to send reply: Interaction expired before response could be sent');
      } else {
        throw err;
      }
    }
  };

  const typingFn = async () => {
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: ghost });
      }
    } catch (err) {
      if (err.code === DISCORD_INTERACTION_EXPIRED_CODE) {
        console.error('Failed to defer reply: Interaction expired before deferReply could be called');
      } else {
        throw err;
      }
    }
  };

  if (allowMemoryContext && shouldRecordMemoryMessage(question, false)) {
    queueUserMessage({
      userId: interaction.user.id,
      channelId: interaction.channelId,
      guildId: interaction.guildId,
      content: question,
      displayName,
      username,
      globalName,
      channelType: interaction.guildId ? 'guild' : 'dm',
    });
  }

  let statusMessageId = null;
  const statusEnabled = interaction.guildId ? isGuildStatusVisibilityEnabled(interaction.guildId) : false;
  const statusFn = statusEnabled
    ? async (stage, details = {}) => {
      const embed = new EmbedBuilder()
        .setTitle('Response Status')
        .setDescription(stage)
        .addFields(
          { name: 'Memory hits', value: String(details.memoryHits ?? 0), inline: true },
          { name: 'Web hits', value: String(details.webHits ?? 0), inline: true },
          { name: 'Scope', value: String(details.escalationStep || details.phase || 'local'), inline: true }
        )
        .setTimestamp(new Date());
      if (!interaction.deferred && !interaction.replied) {
        await typingFn();
      }
      if (!statusMessageId) {
        const statusMessage = await interaction.followUp({ embeds: [embed], ephemeral: true });
        statusMessageId = statusMessage.id;
      } else {
        await interaction.webhook.editMessage(statusMessageId, { embeds: [embed] });
      }
    }
    : null;

  await handlePrompt({
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    prompt: question,
    reply: replyFn,
    replyContextText: '',
    imageUrls: [],
    allowMemory: allowMemoryContext,
    alreadyRecorded: allowMemoryContext,
    onTyping: typingFn,
    onStatus: statusFn,
    displayName,
    userName: username,
    userGlobalName: globalName,
    channelType: interaction.guildId ? 'guild' : 'dm',
    inMemoryTurns,
  });
}

export async function executePollCommand(interaction, pollTimers) {
  const question = interaction.options.getString('question', true);
  const optionsRaw = interaction.options.getString('options', true);
  const durationStr = interaction.options.getString('duration') || '24h';
  const multi = interaction.options.getBoolean('multi') || false;

  const options = optionsRaw.split('|').map((s) => s.trim()).filter(Boolean).slice(0, NUMBER_EMOJIS.length);
  if (options.length < 2) {
    await interaction.reply({ content: 'Need at least two options (use \'A|B|C\').', ephemeral: true });
    return;
  }

  const durationMs = parseDuration(durationStr);
  const closeAt = Date.now() + durationMs;
  await interaction.deferReply({ ephemeral: true });
  const channel = interaction.channel;
  const pollMsg = await channel.send({
    content: `📊 ${question}\n\n${options.map((o, i) => `${NUMBER_EMOJIS[i]} ${o}`).join('\n')}\n\n⏳ closes <t:${Math.floor(closeAt/1000)}:R>`
  });
  trackBotMessage(pollMsg.id, pollMsg.channelId, pollMsg.guildId);
  for (let i = 0; i < options.length; i++) {
    await pollMsg.react(NUMBER_EMOJIS[i]);
  }
  createPoll({
    guildId: pollMsg.guildId || null,
    channelId: pollMsg.channelId,
    messageId: pollMsg.id,
    creatorId: interaction.user.id,
    question,
    options,
    multiVote: multi,
    anonymous: false,
    closesAt: closeAt,
  });
  
  const delayMs = Math.max(0, closeAt - Date.now());
  if (pollTimers.has(pollMsg.id)) {
    clearTimeout(pollTimers.get(pollMsg.id));
  }
  const t = setTimeout(async () => {
    try {
      const poll = await import('../polls.js').then(m => m.getPollByMessageId(pollMsg.id));
      if (!poll || poll.closed) return;
      const pollChannel = await interaction.client.channels.fetch(poll.channel_id);
      const opts = JSON.parse(poll.options_json);
      const counts = tallyVotes(poll.id, opts.length);
      const total = counts.reduce((a, b) => a + b, 0);
      const lines = opts.map((opt, i) => `${NUMBER_EMOJIS[i]} ${opt} — ${counts[i]} vote${counts[i] === 1 ? '' : 's'}`);
      const header = `📊 Poll closed: ${poll.question}`;
      const footer = `Total votes: ${total}`;
      await pollChannel.send({ content: `${header}\n\n${lines.join('\n')}\n\n${footer}` });
      closePoll(poll.id);
    } catch (e) {
      console.error('Failed to auto-close poll', e);
    } finally {
      pollTimers.delete(pollMsg.id);
    }
  }, delayMs);
  pollTimers.set(pollMsg.id, t);

  await interaction.editReply({ content: `Poll created in <#${pollMsg.channelId}>` });
}

export async function executeGifCommand(interaction) {
  // Block specific user from using /gif command
  if (interaction.user.id === '769000875569315850') {
    await interaction.reply({ content: 'You cannot use this command.', ephemeral: true });
    return;
  }
  const query = interaction.options.getString('query', true);
  await interaction.deferReply({ ephemeral: true });
  const url = await searchGiphyGif(query, process.env.GIPHY_API_KEY);
  if (!url) {
    await interaction.editReply({ content: 'No GIF found or Giphy not configured (set GIPHY_API_KEY).' });
    return;
  }
  const sent = await interaction.channel.send({ content: url });
  trackBotMessage(sent.id, interaction.channelId, interaction.guildId);
  await interaction.editReply({ content: 'Posted your GIF!' });
}

export async function executeMemoryCommand(interaction, { superAdminId } = {}) {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  const isSuperAdmin = interaction.user.id === superAdminId;
  const hasAdminPerms =
    isSuperAdmin || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
  const requireAdminGuild = async () => {
    if (!interaction.inGuild() && !isSuperAdmin) {
      await interaction.reply({ content: 'Guilds only.', ephemeral: true });
      return false;
    }
    if (!hasAdminPerms) {
      await interaction.reply({ content: 'Admin only.', ephemeral: true });
      return false;
    }
    return true;
  };

  if (!group || group === 'user') {
    if (sub === 'on') {
      setUserMemory(interaction.user.id, true);
      await interaction.reply({ content: 'Memory is on.', ephemeral: true });
      return;
    }
    if (sub === 'off') {
      setUserMemory(interaction.user.id, false);
      await interaction.reply({ content: 'Memory is off.', ephemeral: true });
      return;
    }
    if (sub === 'view') {
      const summary = viewMemory(interaction.user.id);
      await interaction.reply({ content: summary, ephemeral: true });
      return;
    }
    if (sub === 'reset') {
      forgetUser(interaction.user.id);
      await interaction.reply({ content: 'Your memory has been reset.', ephemeral: true });
      return;
    }
  }

  if (group === 'channel') {
    if (!await requireAdminGuild()) return;
    if (sub === 'allow') {
      const channel = interaction.options.getChannel('channel', true);
      allowChannel(channel.id);
      await interaction.reply({ content: `Allowed memory in <#${channel.id}>.` });
      return;
    }
    if (sub === 'deny') {
      const channel = interaction.options.getChannel('channel', true);
      denyChannel(channel.id);
      await interaction.reply({ content: `Denied memory in <#${channel.id}>.` });
      return;
    }
    if (sub === 'list') {
      const allRows = listChannels();
      const guild = interaction.guild;
      const guildChannelIds = new Set(guild.channels.cache.keys());
      const rows = allRows.filter((row) => guildChannelIds.has(row.channel_id));
      if (!rows.length) {
        await interaction.reply({ content: 'No channels configured in this guild.' });
        return;
      }
      const formatted = rows
        .map((row) => `• <#${row.channel_id}>: ${row.enabled ? 'allowed' : 'denied'}`)
        .join('\n');
      await interaction.reply({ content: formatted });
      return;
    }
    if (sub === 'reset') {
      const channel = interaction.options.getChannel('channel', true);
      resetChannelMemory(channel.id);
      await interaction.reply({ content: `Memory reset for <#${channel.id}>.` });
      return;
    }
  }

  if (group === 'guild') {
    if (!await requireAdminGuild()) return;
    if (sub === 'scope') {
      const mode = interaction.options.getString('mode', true);
      const safeMode = mode === 'allow_all_visible' ? 'allow_all_visible' : 'allowlist';
      setGuildMemoryScope(interaction.guildId, safeMode);
      const label = safeMode === 'allow_all_visible'
        ? 'allow all visible channels'
        : 'allowlist only';
      await interaction.reply({ content: `Memory scope updated: ${label}.` });
      return;
    }
    if (sub === 'view') {
      const settings = getGuildMemorySettings(interaction.guildId);
      const mode = settings?.scope_mode || 'allowlist';
      await interaction.reply({ content: `Memory scope: ${mode}`, ephemeral: true });
      return;
    }
    if (sub === 'reset') {
      resetGuildMemory(interaction.guildId);
      await interaction.reply({ content: 'Guild memory reset.' });
      return;
    }
  }

  if (group === 'admin') {
    if (!await requireAdminGuild()) return;
    if (sub === 'reset-user') {
      const user = interaction.options.getUser('user', true);
      forgetUser(user.id);
      await interaction.reply({ content: `Memory reset for ${user.username}. This action has been logged.` });
      try {
        await user.send(
          `Your conversation memory and personality profile have been reset by an administrator in ${interaction.guild.name}.`
        );
      } catch (dmErr) {
        console.log(`Could not send DM to user ${user.username} about memory reset:`, dmErr.message);
      }
      return;
    }
  }

  await interaction.reply({ content: 'Unknown memory action.', ephemeral: true });
}

export async function executeLobotomizeCommand(interaction) {
  const scope = interaction.options.getString('scope') || 'me';
  
  if (scope === 'all') {
    // const isSuperAdmin = interaction.user.id === process.env.SUPER_ADMIN_USER_ID;
    const hasAdminPerms = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    
    if (!hasAdminPerms) {
      await interaction.reply({ content: 'Admin only.', ephemeral: true });
      return;
    }
    
    // Wipe everything
    const { db } = await import('../memory.js');
    db.exec(`
      DELETE FROM user_messages;
      DELETE FROM user_settings;
      DELETE FROM channel_profiles;
      DELETE FROM guild_profiles;
      DELETE FROM guild_memory_settings;
      DELETE FROM search_events;
    `);
    await interaction.reply({ content: '🧠💥 **TOTAL LOBOTOMY COMPLETE** - All memory wiped across all users, channels, and guilds.' });
  } else {
    forgetUser(interaction.user.id);
    await interaction.reply({ content: 'Your memory has been wiped.' });
  }
}

export async function executeMemoryAllowCommand(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  allowChannel(channel.id);
  await interaction.reply({ content: `Allowed memory in <#${channel.id}>.` });
}

export async function executeMemoryDenyCommand(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  denyChannel(channel.id);
  await interaction.reply({ content: `Denied memory in <#${channel.id}>.` });
}

export async function executeMemoryListCommand(interaction) {
  const allRows = listChannels();
  const guild = interaction.guild;
  const guildChannelIds = new Set(guild.channels.cache.keys());
  const rows = allRows.filter((row) => guildChannelIds.has(row.channel_id));
  
  if (!rows.length) {
    await interaction.reply({ content: 'No channels configured in this guild.' });
    return;
  }
  const formatted = rows
    .map((row) => `• <#${row.channel_id}>: ${row.enabled ? 'allowed' : 'denied'}`)
    .join('\n');
  await interaction.reply({ content: formatted });
}

export async function executeMemoryScopeCommand(interaction) {
  const mode = interaction.options.getString('mode', true);
  const safeMode = mode === 'allow_all_visible' ? 'allow_all_visible' : 'allowlist';
  setGuildMemoryScope(interaction.guildId, safeMode);
  const label = safeMode === 'allow_all_visible'
    ? 'allow all visible channels'
    : 'allowlist only';
  await interaction.reply({ content: `Memory scope updated: ${label}.` });
}

export async function executeStatusCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'on') {
    setGuildStatusVisibility(interaction.guildId, true);
    await interaction.reply({ content: 'Status sidecar is on for this guild.' });
    return;
  }
  if (sub === 'off') {
    setGuildStatusVisibility(interaction.guildId, false);
    await interaction.reply({ content: 'Status sidecar is off for this guild.' });
    return;
  }
  const enabled = isGuildStatusVisibilityEnabled(interaction.guildId);
  const mode = getGuildMemorySettings(interaction.guildId)?.scope_mode || 'allowlist';
  await interaction.reply({
    content: `Status sidecar: ${enabled ? 'on' : 'off'}\nMemory scope: ${mode}`,
    ephemeral: true,
  });
}

function formatSearchRows(rows = []) {
  if (!rows.length) return 'No results.';
  return rows
    .slice(0, 5)
    .map((row, idx) => `${idx + 1}. ${row.display_name || 'Unknown'}: ${row.content}`)
    .join('\n');
}

function formatWebRows(rows = []) {
  if (!rows.length) return 'No results.';
  return rows
    .slice(0, 5)
    .map((row, idx) => `${idx + 1}. ${row.title}\n${row.url}`)
    .join('\n\n');
}

export async function executeSearchCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const query = interaction.options.getString('query', true).trim();
  if (!query) {
    await interaction.reply({ content: 'Query is required.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const start = Date.now();
  const mode = sub;
  const memoryRows = [];
  let webResult = { ok: false, provider: 'web', results: [] };

  if (mode === 'memory' || mode === 'all') {
    const scope = interaction.guildId ? 'guild' : 'user';
    memoryRows.push(
      ...searchMemory({
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        query,
        scope,
        limit: 6,
        respectPolicy: true,
      })
    );
  }

  if (mode === 'web' || mode === 'all') {
    webResult = await searchWeb({ query, limit: 5 });
  }

  logSearchEvent({
    userId: interaction.user.id,
    guildId: interaction.guildId,
    mode,
    query,
    provider: mode === 'memory' ? 'memory' : (webResult.provider || 'web'),
    latencyMs: Date.now() - start,
    hitCount: memoryRows.length + (webResult.results?.length || 0),
  });

  const sections = [];
  if (mode === 'memory' || mode === 'all') {
    sections.push(`**Memory results**\n${formatSearchRows(memoryRows)}`);
  }
  if (mode === 'web' || mode === 'all') {
    if (!webResult.ok) {
      sections.push(`**Web results**\nUnavailable: ${webResult.error || 'unknown error'}`);
    } else {
      sections.push(`**Web results (${webResult.provider})**\n${formatWebRows(webResult.results)}`);
    }
  }

  await interaction.editReply({ content: sections.join('\n\n') || 'No results.' });
}

export async function executeMemoryResetGuildCommand(interaction) {
  resetGuildMemory(interaction.guildId);
  await interaction.reply({ content: 'Guild memory reset.' });
}

export async function executeMemoryResetChannelCommand(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  resetChannelMemory(channel.id);
  await interaction.reply({ content: `Memory reset for <#${channel.id}>.` });
}

export async function executeMemoryResetUserCommand(interaction) {
  const user = interaction.options.getUser('user', true);
  forgetUser(user.id);
  await interaction.reply({ content: `Memory reset for ${user.username}. This action has been logged.` });
  
  try {
    await user.send(
      `Your conversation memory and personality profile have been reset by an administrator in ${interaction.guild.name}.`
    );
  } catch (dmErr) {
    console.log(`Could not send DM to user ${user.username} about memory reset:`, dmErr.message);
  }
}

export async function executePurgeCommand(interaction) {
  const timeframe = interaction.options.getString('timeframe', true);
  const channel = interaction.options.getChannel('channel', true);

  await interaction.deferReply({ ephemeral: true });

  let sinceTimestamp;
  const now = Date.now();
  switch (timeframe) {
    case '1h':
      sinceTimestamp = now - (1 * 60 * 60 * 1000);
      break;
    case '6h':
      sinceTimestamp = now - (6 * 60 * 60 * 1000);
      break;
    case '12h':
      sinceTimestamp = now - (12 * 60 * 60 * 1000);
      break;
    case '24h':
      sinceTimestamp = now - (24 * 60 * 60 * 1000);
      break;
    case '7d':
      sinceTimestamp = now - (7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      sinceTimestamp = now - (30 * 24 * 60 * 60 * 1000);
      break;
    case 'all':
      sinceTimestamp = 0;
      break;
    default:
      sinceTimestamp = 0;
  }

  try {
    const messageIds = getBotMessagesInChannel(channel.id, interaction.guildId, sinceTimestamp);
    
    if (messageIds.length === 0) {
      await interaction.editReply({ 
        content: `No bot messages found in <#${channel.id}> within the specified timeframe.` 
      });
      return;
    }

    let deletedCount = 0;
    let failedCount = 0;

    const timeframeLabels = {
      '1h': '1 hour',
      '6h': '6 hours',
      '12h': '12 hours',
      '24h': '24 hours',
      '7d': '7 days',
      '30d': '30 days',
      'all': 'all time'
    };
    const timeframeText = timeframeLabels[timeframe] || timeframe;

    const fourteenDaysAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
    const canUseBulkDelete = sinceTimestamp >= fourteenDaysAgo && messageIds.length >= 2;
    let bulkDeleteSucceeded = false;

    if (canUseBulkDelete && messageIds.length <= DISCORD_BULK_DELETE_LIMIT) {
      try {
        await channel.bulkDelete(messageIds, true);
        deletedCount = messageIds.length;
        bulkDeleteSucceeded = true;
        for (const messageId of messageIds) {
          deleteBotMessageRecord(messageId);
        }
      } catch (err) {
        console.log('Bulk delete failed, falling back to individual deletion:', err.message);
      }
    }

    if (!bulkDeleteSucceeded) {
      for (const messageId of messageIds) {
        try {
          const msg = await channel.messages.fetch(messageId);
          await msg.delete();
          deletedCount++;
          deleteBotMessageRecord(messageId);
        } catch (err) {
          failedCount++;
          console.log(`Failed to delete message ${messageId}:`, err.message);
          if (err.code === DISCORD_UNKNOWN_MESSAGE_CODE) {
            deleteBotMessageRecord(messageId);
          }
        }
      }
    }

    await interaction.editReply({
      content: `Purged ${deletedCount} bot message(s) from <#${channel.id}> (${timeframeText}).\n` +
               (failedCount > 0 ? `${failedCount} message(s) could not be deleted (already removed or no permission).` : '')
    });
  } catch (err) {
    console.error('Error during purge:', err);
    await interaction.editReply({
      content: 'An error occurred while purging messages. Please check bot permissions and try again.'
    });
  }
}

export async function executeServerInfoCommand(interaction) {
  const guild = interaction.guild;
  const metadata = getGuildMetadata(guild.id);
  const roles = getGuildRoles(guild.id);
  
  let info = `**${guild.name}**\n\n`;
  info += `👥 Members: ${guild.memberCount}\n`;
  info += `👑 Owner: <@${guild.ownerId}>\n`;
  info += `📅 Created: <t:${Math.floor(guild.createdTimestamp / 1000)}:D>\n`;
  
  if (roles.length > 0) {
    const topRoles = roles.slice(0, 10).map(r => r.role_name).join(', ');
    info += `\n🎭 Top Roles: ${topRoles}`;
    if (roles.length > 10) {
      info += ` (+${roles.length - 10} more)`;
    }
  }

  await interaction.reply({ content: info, ephemeral: true });
}

export async function executeMyDataCommand(interaction) {
  const settings = getUserSettings(interaction.user.id);
  const profileSummary = getProfileSummary(interaction.user.id);
  const recentMessages = getRecentMessages(interaction.user.id, 5);
  
  let info = `**Your Data**\n\n`;
  info += `Memory enabled: ${settings.memory_enabled ? 'Yes' : 'No'}\n`;
  info += `Total messages recorded: ${settings.message_count || 0}\n\n`;
  
  if (profileSummary) {
    info += `**Profile:**\n${profileSummary}\n\n`;
  }
  
  if (interaction.inGuild()) {
    const userCtx = getUserContext(interaction.guildId, interaction.user.id);
    if (userCtx) {
      info += `**Server Info:**\n${userCtx}\n\n`;
    }
  }
  
  if (recentMessages.length > 0) {
    info += `**Recent messages (${recentMessages.length}):**\n`;
    info += recentMessages.map(m => `• ${m.substring(0, 60)}${m.length > 60 ? '...' : ''}`).join('\n');
  }
  
  info += `\n\nUse \`/lobotomize\` to clear all your data.`;
  
  await interaction.reply({ content: info, ephemeral: true });
}

export async function executeAutoreplyCommand(interaction) {
  const mode = interaction.options.getString('mode', true);
  const enabled = mode === 'on';
  
  setUserAutoreply(interaction.user.id, enabled);
  
  const status = enabled ? '✅ Auto-reply **enabled**. I\'ll respond to all your messages in this guild.' : '❌ Auto-reply **disabled**. You\'ll need to mention me.';
  await interaction.reply({ content: status, ephemeral: true });
}
