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
    .setDescription('Manage your memory preferences')
    .setDMPermission(true)
    .addSubcommand((sub) => sub.setName('on').setDescription('Enable memory'))
    .addSubcommand((sub) => sub.setName('off').setDescription('Disable memory'))
    .addSubcommand((sub) => sub.setName('view').setDescription('View stored summary')),
};

export const memoryAllowCommand = {
  data: new SlashCommandBuilder()
    .setName('memory-allow')
    .setDescription('Allow memory writes in a channel')
    .setDefaultMemberPermissions(16)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to allow')
        .setRequired(true)
    ),
};

export const memoryDenyCommand = {
  data: new SlashCommandBuilder()
    .setName('memory-deny')
    .setDescription('Deny memory writes in a channel')
    .setDefaultMemberPermissions(16)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to deny')
        .setRequired(true)
    ),
};

export const memoryListCommand = {
  data: new SlashCommandBuilder()
    .setName('memory-list')
    .setDescription('List channels with memory permissions')
    .setDefaultMemberPermissions(16),
};

export const memoryResetGuildCommand = {
  data: new SlashCommandBuilder()
    .setName('memory-reset-guild')
    .setDescription('Reset memory for this guild')
    .setDefaultMemberPermissions(16),
};

export const memoryResetChannelCommand = {
  data: new SlashCommandBuilder()
    .setName('memory-reset-channel')
    .setDescription('Reset memory for a specific channel')
    .setDefaultMemberPermissions(16)
    .addChannelOption((option) =>
      option.setName('channel').setDescription('Channel to reset').setRequired(true)
    ),
};

export const memoryResetUserCommand = {
  data: new SlashCommandBuilder()
    .setName('memory-reset-user')
    .setDescription('Reset memory for a user')
    .setDefaultMemberPermissions(16)
    .addUserOption((option) =>
      option.setName('user').setDescription('User to reset').setRequired(true)
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

export const contextCommand = {
  data: new SlashCommandBuilder()
    .setName('context')
    .setDescription('Inspect the context used for bot replies')
    .setDMPermission(true)
    .addSubcommand((sub) =>
      sub
        .setName('debug')
        .setDescription('Show stored memory and context snapshot')
    ),
};

export const imagineCommand = {
  data: new SlashCommandBuilder()
    .setName('imagine')
    .setDescription('Generate an image (video mode reserved for future use)')
    .setDMPermission(true)
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Generation mode')
        .setRequired(true)
        .addChoices(
          { name: 'Image', value: 'image' },
          { name: 'Video (disabled)', value: 'video' }
        )
    )
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('Describe what to generate')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('resolution')
        .setDescription('Output resolution preset')
        .setRequired(false)
        .addChoices(
          { name: '512x512', value: '512x512' },
          { name: '768x768', value: '768x768' },
          { name: '1024x1024 (default)', value: '1024x1024' },
          { name: '1024x1536 (portrait)', value: '1024x1536' },
          { name: '1536x1024 (landscape)', value: '1536x1024' }
        )
    )
    .addStringOption((option) =>
      option
        .setName('style')
        .setDescription('Style hint')
        .setRequired(false)
        .addChoices(
          { name: 'Default', value: 'default' },
          { name: 'Vivid', value: 'vivid' },
          { name: 'Natural', value: 'natural' }
        )
    )
    .addBooleanOption((option) =>
      option
        .setName('ghost')
        .setDescription('Make the response visible only to you (ghost message)')
        .setRequired(false)
    ),
};

export const imagePolicyCommand = {
  data: new SlashCommandBuilder()
    .setName('image-policy')
    .setDescription('Manage image generation policy')
    .setDefaultMemberPermissions(16)
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('View effective image policy for this server')
    )
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set a policy key for this server')
        .addStringOption((option) =>
          option
            .setName('key')
            .setDescription('Policy key')
            .setRequired(true)
            .addChoices(
              { name: 'enabled', value: 'enabled' },
              { name: 'max_prompt_chars', value: 'max_prompt_chars' },
              { name: 'user_daily_limit', value: 'user_daily_limit' },
              { name: 'guild_daily_limit', value: 'guild_daily_limit' },
              { name: 'blocked_terms', value: 'blocked_terms' }
            )
        )
        .addStringOption((option) =>
          option
            .setName('value')
            .setDescription('Policy value (comma-separated for blocked_terms)')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('allow-user')
        .setDescription('Allow a user to bypass image policy denies/quotas')
        .addUserOption((option) =>
          option.setName('user').setDescription('User to allow').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('deny-user')
        .setDescription('Deny a user from using image generation')
        .addUserOption((option) =>
          option.setName('user').setDescription('User to deny').setRequired(true)
        )
    ),
};

export const commands = [
  askCommand,
  pollCommand,
  gifCommand,
  imagineCommand,
  memoryCommand,
  memoryAllowCommand,
  memoryDenyCommand,
  memoryListCommand,
  memoryResetGuildCommand,
  memoryResetChannelCommand,
  memoryResetUserCommand,
  lobotomizeCommand,
  purgeCommand,
  serverInfoCommand,
  myDataCommand,
  autoreplyCommand,
  contextCommand,
  imagePolicyCommand,
];
