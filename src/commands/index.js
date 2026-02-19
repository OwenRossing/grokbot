import { SlashCommandBuilder } from 'discord.js';

export const askCommand = {
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask the bot a question')
    .setDMPermission(true)
    .addStringOption((option) =>
      option
        .setName('question')
        .setDescription('What do you want to ask?')
        .setRequired(true)
    )
    .addBooleanOption((option) =>
      option
        .setName('ghost')
        .setDescription('Make the response visible only to you (ghost message)')
        .setRequired(false)
    ),
};

export const pollCommand = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a reaction-based poll')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('question')
        .setDescription('Poll question')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('options')
        .setDescription('Options separated by | (e.g., A|B|C)')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('duration')
        .setDescription('How long the poll runs (e.g., 30m, 2h, 1d). Default 24h')
        .setRequired(false)
    )
    .addBooleanOption((option) =>
      option
        .setName('multi')
        .setDescription('Allow multiple choices per user')
        .setRequired(false)
    ),
};

export const gifCommand = {
  data: new SlashCommandBuilder()
    .setName('gif')
    .setDescription('Search Tenor and post a GIF')
    .setDMPermission(true)
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('What GIF to search for?')
        .setRequired(true)
    ),
};

export const memoryCommand = {
  data: new SlashCommandBuilder()
    .setName('memory')
    .setDescription('Manage memory settings and data')
    .setDMPermission(true)
    .addStringOption((option) =>
      option
        .setName('action')
        .setDescription('Memory action to perform')
        .setRequired(true)
        .addChoices(
          { name: 'User: On', value: 'user_on' },
          { name: 'User: Off', value: 'user_off' },
          { name: 'User: View', value: 'user_view' },
          { name: 'User: Reset', value: 'user_reset' },
          { name: 'Channel: Allow', value: 'channel_allow' },
          { name: 'Channel: Deny', value: 'channel_deny' },
          { name: 'Channel: List', value: 'channel_list' },
          { name: 'Channel: Reset', value: 'channel_reset' },
          { name: 'Guild: Scope', value: 'guild_scope' },
          { name: 'Guild: View', value: 'guild_view' },
          { name: 'Guild: Reset', value: 'guild_reset' },
          { name: 'Admin: Reset User', value: 'admin_reset_user' }
        )
    )
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Used with action=guild_scope')
        .setRequired(false)
        .addChoices(
          { name: 'Allowlist only', value: 'allowlist' },
          { name: 'Allow all visible channels', value: 'allow_all_visible' }
        )
    )
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Used with channel actions')
        .setRequired(false)
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('Used with action=admin_reset_user')
        .setRequired(false)
    ),
};

export const lobotomizeCommand = {
  data: new SlashCommandBuilder()
    .setName('lobotomize')
    .setDescription('Lobotomize yourself or everyone (forget all history)')
    .addStringOption((option) =>
      option
        .setName('scope')
        .setDescription('Who to lobotomize (default: just you)')
        .setRequired(false)
        .addChoices(
          { name: 'Just me', value: 'me' },
          { name: 'Everyone (admin only)', value: 'all' }
        )
    ),
};

export const purgeCommand = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete bot messages in a channel within a time period')
    .setDefaultMemberPermissions(16)
    .addStringOption((option) =>
      option
        .setName('timeframe')
        .setDescription('Time period to purge messages from')
        .setRequired(true)
        .addChoices(
          { name: '1 hour', value: '1h' },
          { name: '6 hours', value: '6h' },
          { name: '12 hours', value: '12h' },
          { name: '24 hours', value: '24h' },
          { name: '7 days', value: '7d' },
          { name: '30 days', value: '30d' },
          { name: 'All time', value: 'all' }
        )
    )
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to purge messages from')
        .setRequired(true)
    ),
};

export const serverInfoCommand = {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('View server information (members, roles, etc.)'),
};

export const myDataCommand = {
  data: new SlashCommandBuilder()
    .setName('mydata')
    .setDescription('View what the bot knows about you'),
};

export const autoreplyCommand = {
  data: new SlashCommandBuilder()
    .setName('autoreply')
    .setDescription('Toggle auto-reply mode (respond without mention)')
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Enable or disable auto-reply')
        .setRequired(true)
        .addChoices(
          { name: 'Enable', value: 'on' },
          { name: 'Disable', value: 'off' }
        )
    ),
};

export const statusCommand = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Configure response status sidecar visibility')
    .setDefaultMemberPermissions(16)
    .addSubcommand((sub) => sub.setName('on').setDescription('Enable status sidecar for this guild'))
    .addSubcommand((sub) => sub.setName('off').setDescription('Disable status sidecar for this guild'))
    .addSubcommand((sub) => sub.setName('view').setDescription('View current status sidecar setting')),
};

export const searchCommand = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search memory and/or the web')
    .setDMPermission(true)
    .addSubcommand((sub) =>
      sub
        .setName('memory')
        .setDescription('Search remembered conversation history')
        .addStringOption((option) =>
          option.setName('query').setDescription('What to search for').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('web')
        .setDescription('Search the web')
        .addStringOption((option) =>
          option.setName('query').setDescription('What to search for').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('all')
        .setDescription('Search memory and web')
        .addStringOption((option) =>
          option.setName('query').setDescription('What to search for').setRequired(true)
        )
    ),
};

export const commands = [
  askCommand,
  pollCommand,
  gifCommand,
  memoryCommand,
  lobotomizeCommand,
  purgeCommand,
  serverInfoCommand,
  myDataCommand,
  autoreplyCommand,
  statusCommand,
  searchCommand,
];
