import { safeExecute } from '../utils/helpers.js';
import { handleMessage, handleMessageUpdate } from '../handlers/handleMessage.js';
import { handleInteraction } from '../handlers/handleInteraction.js';
import {
  cacheGuildOnStartup,
  cacheGuildOnJoin,
  updateGuildMetadata,
  handleMemberJoin,
  handleMemberRemove,
  handleMemberUpdate,
  handleRoleCreate,
  handleRoleUpdate,
  handleRoleDelete,
} from '../services/guildCache.js';
import { listOpenPolls, closePoll, getPollByMessageId, tallyVotes } from '../polls.js';
import { NUMBER_EMOJIS } from '../utils/constants.js';
import { REST, Routes } from 'discord.js';
import { commands } from '../commands/index.js';

export function setupEvents({ client, config, inMemoryTurns, pollTimers }) {
  // ===== MESSAGE EVENTS =====

  client.on('messageCreate', async (message) => {
    await safeExecute('messageCreate', async () => {
      await handleMessage({ client, message, inMemoryTurns });
    });
  });

  client.on('messageUpdate', async (oldMessage, newMessage) => {
    await safeExecute('messageUpdate', async () => {
      await handleMessageUpdate({ client, newMessage, inMemoryTurns });
    });
  });

  client.on('messageReactionAdd', async (reaction, user) => {
    await safeExecute('messageReactionAdd', async () => {
      try {
        if (user.bot) return;
        if (reaction.partial) await reaction.fetch();
        const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
        const emoji = reaction.emoji.name;
        const optionIndex = NUMBER_EMOJIS.indexOf(emoji);
        if (optionIndex === -1) return;
        const poll = getPollByMessageId(message.id);
        if (!poll || poll.closed) return;
        const userReactions = message.reactions.cache.filter(r => NUMBER_EMOJIS.includes(r.emoji.name));
        for (const r of userReactions.values()) {
          if (r.emoji.name !== emoji) {
            try { await r.users.remove(user.id); } catch {}
          }
        }
        const { recordVote } = await import('../polls.js');
        recordVote({ pollId: poll.id, userId: user.id, optionIndex });
      } catch (e) {
        console.error('reactionAdd error', e);
      }
    });
  });

  client.on('messageReactionRemove', async (reaction, user) => {
    await safeExecute('messageReactionRemove', async () => {
      try {
        if (user.bot) return;
        if (reaction.partial) await reaction.fetch();
        const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
        const emoji = reaction.emoji.name;
        const optionIndex = NUMBER_EMOJIS.indexOf(emoji);
        if (optionIndex === -1) return;
        const poll = getPollByMessageId(message.id);
        if (!poll || poll.closed) return;
        const { removeVote } = await import('../polls.js');
        removeVote({ pollId: poll.id, userId: user.id });
      } catch (e) {
        console.error('reactionRemove error', e);
      }
    });
  });

  // ===== INTERACTION EVENTS =====

  client.on('interactionCreate', async (interaction) => {
    await safeExecute('interactionCreate', async () => {
      await handleInteraction(interaction, {
        inMemoryTurns,
        pollTimers,
        client,
        superAdminId: config.SUPER_ADMIN_USER_ID,
      });
    });
  });

  // ===== GUILD & MEMBER EVENTS =====

  client.on('guildCreate', async (guild) => {
    await safeExecute('guildCreate', async () => {
      console.log(`Joined new guild: ${guild.name}`);
      const result = await cacheGuildOnJoin(guild);
      if (!result.success) {
        console.error('Failed to cache guild:', result.error);
      }
    });
  });

  client.on('guildUpdate', async (oldGuild, newGuild) => {
    await safeExecute('guildUpdate', async () => {
      updateGuildMetadata(newGuild);
    });
  });

  client.on('guildDelete', async (guild) => {
    await safeExecute('guildDelete', async () => {
      console.log(`Left guild: ${guild.name}`);
    });
  });

  client.on('guildMemberAdd', async (member) => {
    await safeExecute('guildMemberAdd', async () => {
      handleMemberJoin(member);
      try {
        if (member.guild.systemChannel) {
          await member.guild.systemChannel.send(
            `Welcome to ${member.guild.name}, ${member.user}! 👋`
          );
        }
      } catch (err) {
        // May not have permission
      }
    });
  });

  client.on('guildMemberRemove', async (member) => {
    await safeExecute('guildMemberRemove', async () => {
      handleMemberRemove(member);
    });
  });

  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    await safeExecute('guildMemberUpdate', async () => {
      handleMemberUpdate(oldMember, newMember);
    });
  });

  client.on('roleCreate', async (role) => {
    await safeExecute('roleCreate', async () => {
      handleRoleCreate(role);
    });
  });

  client.on('roleUpdate', async (oldRole, newRole) => {
    await safeExecute('roleUpdate', async () => {
      handleRoleUpdate(newRole);
    });
  });

  client.on('roleDelete', async (role) => {
    await safeExecute('roleDelete', async () => {
      handleRoleDelete(role);
    });
  });

  // ===== READY EVENT =====

  client.once('clientReady', async () => {
    await safeExecute('ready', async () => {
      console.log(`Logged in as ${client.user.tag}`);
      
      // Register commands
      const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
      await rest.put(Routes.applicationCommands(client.user.id), {
        body: commands.map(cmd => cmd.data.toJSON()),
      });
      console.log('Slash commands registered.');

      // Cache guild data
      console.log('Caching guild data...');
      try {
        for (const guild of client.guilds.cache.values()) {
          const result = await cacheGuildOnStartup(guild);
          if (result.success) {
            console.log(`Cached ${guild.name}: ${result.members} members, ${result.roles} roles`);
          } else {
            console.error(`Failed to cache guild ${guild.id}:`, result.error);
          }
        }
        console.log('Guild data caching complete.');
      } catch (e) {
        console.error('Failed to cache guild data:', e);
      }

      // Resume open polls
      try {
        const open = listOpenPolls();
        for (const poll of open) {
          if (poll.closed) continue;
          const remaining = poll.closes_at - Date.now();
          if (remaining <= 0) {
            const channel = await client.channels.fetch(poll.channel_id);
            const opts = JSON.parse(poll.options_json);
            const counts = tallyVotes(poll.id, opts.length);
            const total = counts.reduce((a, b) => a + b, 0);
            const lines = opts.map((opt, i) => `${NUMBER_EMOJIS[i]} ${opt} — ${counts[i]} vote${counts[i] === 1 ? '' : 's'}`);
            await channel.send({ content: `📊 Poll closed: ${poll.question}\n\n${lines.join('\n')}\n\nTotal votes: ${total}` });
            closePoll(poll.id);
          } else {
            const delayMs = Math.max(0, remaining);
            const t = setTimeout(async () => {
              try {
                const p = getPollByMessageId(poll.message_id);
                if (!p || p.closed) return;
                const ch = await client.channels.fetch(p.channel_id);
                const os = JSON.parse(p.options_json);
                const cs = tallyVotes(p.id, os.length);
                const tot = cs.reduce((a, b) => a + b, 0);
                const ls = os.map((o, i) => `${NUMBER_EMOJIS[i]} ${o} — ${cs[i]} vote${cs[i] === 1 ? '' : 's'}`);
                await ch.send({ content: `📊 Poll closed: ${p.question}\n\n${ls.join('\n')}\n\nTotal votes: ${tot}` });
                closePoll(p.id);
              } catch (e) {
                console.error('Failed to auto-close poll', e);
              } finally {
                pollTimers.delete(poll.message_id);
              }
            }, delayMs);
            pollTimers.set(poll.message_id, t);
          }
        }
      } catch (e) {
        console.error('Failed to resume polls', e);
      }
    });
  });
}
