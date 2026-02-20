import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

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
    .addSubcommandGroup((group) =>
      group
        .setName('user')
        .setDescription('User memory controls')
        .addSubcommand((sub) => sub.setName('on').setDescription('Enable memory'))
        .addSubcommand((sub) => sub.setName('off').setDescription('Disable memory'))
        .addSubcommand((sub) => sub.setName('view').setDescription('View your memory summary'))
        .addSubcommand((sub) => sub.setName('reset').setDescription('Reset your memory'))
    )
    .addSubcommandGroup((group) =>
      group
        .setName('channel')
        .setDescription('Channel memory controls')
        .addSubcommand((sub) =>
          sub
            .setName('allow')
            .setDescription('Allow memory in a channel')
            .addChannelOption((option) =>
              option
                .setName('channel')
                .setDescription('Channel to allow')
                .setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('deny')
            .setDescription('Deny memory in a channel')
            .addChannelOption((option) =>
              option
                .setName('channel')
                .setDescription('Channel to deny')
                .setRequired(true)
            )
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('List channel memory overrides'))
        .addSubcommand((sub) =>
          sub
            .setName('reset')
            .setDescription('Reset memory for a channel')
            .addChannelOption((option) =>
              option
                .setName('channel')
                .setDescription('Channel to reset')
                .setRequired(true)
            )
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName('guild')
        .setDescription('Guild memory controls')
        .addSubcommand((sub) =>
          sub
            .setName('scope')
            .setDescription('Set guild memory scope')
            .addStringOption((option) =>
              option
                .setName('mode')
                .setDescription('Memory scope mode')
                .setRequired(true)
                .addChoices(
                  { name: 'Allowlist only', value: 'allowlist' },
                  { name: 'Allow all visible channels', value: 'allow_all_visible' }
                )
            )
        )
        .addSubcommand((sub) => sub.setName('view').setDescription('View guild memory settings'))
        .addSubcommand((sub) => sub.setName('reset').setDescription('Reset guild memory'))
    )
    .addSubcommandGroup((group) =>
      group
        .setName('admin')
        .setDescription('Admin-only memory actions')
        .addSubcommand((sub) =>
          sub
            .setName('reset-user')
            .setDescription('Reset another user memory')
            .addUserOption((option) =>
              option
                .setName('user')
                .setDescription('Target user')
                .setRequired(true)
            )
        )
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

export const doCommand = {
  data: new SlashCommandBuilder()
    .setName('do')
    .setDescription('Run a natural-language command request')
    .setDMPermission(true)
    .addStringOption((option) =>
      option
        .setName('instruction')
        .setDescription('Instruction to execute, e.g. "enable memory for #general"')
        .setRequired(true)
    )
    .addBooleanOption((option) =>
      option
        .setName('dry_run')
        .setDescription('Preview parsed action without executing')
        .setRequired(false)
    ),
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

export const claimPackCommand = {
  data: new SlashCommandBuilder()
    .setName('claim-pack')
    .setDescription('View and claim available packs (cooldown + admin/event)')
    .setDMPermission(true)
    .addIntegerOption((option) =>
      option.setName('page').setDescription('Queue page').setRequired(false)
    ),
};

export const packsCommand = {
  data: new SlashCommandBuilder()
    .setName('packs')
    .setDescription('Open the interactive pack hub')
    .setDMPermission(true),
};

export const openPackCommand = {
  data: new SlashCommandBuilder()
    .setName('open-pack')
    .setDescription('View unopened packs and open one')
    .setDMPermission(true)
    .addStringOption((option) =>
      option
        .setName('pack_id')
        .setDescription('Open this pack id immediately')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addIntegerOption((option) =>
      option.setName('page').setDescription('Queue page').setRequired(false)
    ),
};

export const viewUnopenedPacksCommand = {
  data: new SlashCommandBuilder()
    .setName('view-unopened-packs')
    .setDescription('Legacy alias: view unopened packs (use /open-pack)')
    .setDMPermission(true)
    .addIntegerOption((option) =>
      option.setName('page').setDescription('Queue page').setRequired(false)
    ),
};

export const viewPackCompletionCommand = {
  data: new SlashCommandBuilder()
    .setName('view-pack-completion')
    .setDescription('Show your completion for a set (owned vs missing cards)')
    .setDMPermission(true)
    .addStringOption((option) =>
      option
        .setName('pack')
        .setDescription('Set name/code (autocomplete)')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addBooleanOption((option) =>
      option.setName('public').setDescription('Show in channel instead of only you').setRequired(false)
    ),
};

export const autoClaimPackCommand = {
  data: new SlashCommandBuilder()
    .setName('auto-claim-pack')
    .setDescription('Configure auto-claim for cooldown packs')
    .setDMPermission(true)
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Auto-claim mode')
        .setRequired(true)
        .addChoices(
          { name: 'On', value: 'on' },
          { name: 'Off', value: 'off' },
          { name: 'Status', value: 'status' }
        )
    ),
};

export const inventoryCommand = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('View your card inventory')
    .setDMPermission(true)
    .addIntegerOption((option) =>
      option.setName('page').setDescription('Inventory page').setRequired(false)
    )
    .addStringOption((option) =>
      option.setName('set_code').setDescription('Filter by set').setRequired(false)
    )
    .addStringOption((option) =>
      option.setName('filter').setDescription('Filter by card name').setRequired(false)
    )
    .addUserOption((option) =>
      option.setName('target_user').setDescription('View another user inventory (admin use)').setRequired(false)
    ),
};

export const cardViewCommand = {
  data: new SlashCommandBuilder()
    .setName('card-view')
    .setDescription('View one card instance details')
    .setDMPermission(true)
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Pick one owned card instance (autocomplete)')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option.setName('card_instance_ids').setDescription('Advanced: card instance id').setRequired(false)
    )
    .addBooleanOption((option) =>
      option.setName('public').setDescription('Show in channel instead of only you').setRequired(false)
    ),
};

export const collectionStatsCommand = {
  data: new SlashCommandBuilder()
    .setName('collection-stats')
    .setDescription('View collection stats, cooldown, and balances')
    .setDMPermission(true)
    .addUserOption((option) =>
      option.setName('target_user').setDescription('View another user stats (admin use)').setRequired(false)
    ),
};

export const tradeOfferCommand = {
  data: new SlashCommandBuilder()
    .setName('trade-offer')
    .setDescription('Offer a trade to another user')
    .setDMPermission(false)
    .addUserOption((option) =>
      option.setName('target_user').setDescription('Target user').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('card_instance_ids').setDescription('CSV of offered card instance IDs').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('request_instance_ids').setDescription('CSV of requested card instance IDs').setRequired(false)
    )
    .addIntegerOption((option) =>
      option.setName('credits').setDescription('Offered credits').setRequired(false)
    )
    .addIntegerOption((option) =>
      option.setName('request_credits').setDescription('Requested credits').setRequired(false)
    ),
};

export const tradeAcceptCommand = {
  data: new SlashCommandBuilder()
    .setName('trade-accept')
    .setDescription('Accept a trade')
    .setDMPermission(true)
    .addStringOption((option) =>
      option.setName('trade_id').setDescription('Trade ID').setRequired(true).setAutocomplete(true)
    ),
};

export const tradeRejectCommand = {
  data: new SlashCommandBuilder()
    .setName('trade-reject')
    .setDescription('Reject a trade')
    .setDMPermission(true)
    .addStringOption((option) =>
      option.setName('trade_id').setDescription('Trade ID').setRequired(true).setAutocomplete(true)
    ),
};

export const tradeCancelCommand = {
  data: new SlashCommandBuilder()
    .setName('trade-cancel')
    .setDescription('Cancel a trade you created')
    .setDMPermission(true)
    .addStringOption((option) =>
      option.setName('trade_id').setDescription('Trade ID').setRequired(true).setAutocomplete(true)
    ),
};

export const tradeViewCommand = {
  data: new SlashCommandBuilder()
    .setName('trade-view')
    .setDescription('View your recent trades')
    .setDMPermission(true),
};

export const marketValueCommand = {
  data: new SlashCommandBuilder()
    .setName('market-value')
    .setDescription('Check value of a card id or instance id')
    .setDMPermission(true)
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Pick one owned card (autocomplete)')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option.setName('card_instance_ids').setDescription('Advanced: card or instance id').setRequired(false)
    ),
};

export const marketBrowseCommand = {
  data: new SlashCommandBuilder()
    .setName('market-browse')
    .setDescription('Browse market singles catalog')
    .setDMPermission(true)
    .addIntegerOption((option) =>
      option.setName('page').setDescription('Catalog page').setRequired(false)
    )
    .addStringOption((option) =>
      option.setName('set_code').setDescription('Filter by set code').setRequired(false)
    )
    .addStringOption((option) =>
      option.setName('filter').setDescription('Filter by card name').setRequired(false)
    ),
};

export const marketQuoteBuyCommand = {
  data: new SlashCommandBuilder()
    .setName('market-quote-buy')
    .setDescription('Quote buy cost for a card')
    .setDMPermission(true)
    .addStringOption((option) =>
      option.setName('card_id').setDescription('Card id to quote').setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName('quantity').setDescription('Quantity to buy').setRequired(false)
    ),
};

export const marketBuyCommand = {
  data: new SlashCommandBuilder()
    .setName('market-buy')
    .setDescription('Buy singles from the market')
    .setDMPermission(true)
    .addStringOption((option) =>
      option.setName('card_id').setDescription('Card id to buy').setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName('quantity').setDescription('Quantity to buy').setRequired(false)
    ),
};

export const marketQuoteSellCommand = {
  data: new SlashCommandBuilder()
    .setName('market-quote-sell')
    .setDescription('Quote sell value by card name or specific instances')
    .setDMPermission(true)
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Pick one owned card (autocomplete)')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addIntegerOption((option) =>
      option.setName('quantity').setDescription('How many copies to quote').setRequired(false)
    )
    .addStringOption((option) =>
      option.setName('card_instance_ids').setDescription('Advanced: CSV of instance ids').setRequired(false)
    ),
};

export const marketSellCommand = {
  data: new SlashCommandBuilder()
    .setName('market-sell')
    .setDescription('Sell by card name (autocomplete) or specific instances')
    .setDMPermission(true)
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Pick one owned card (autocomplete)')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addIntegerOption((option) =>
      option.setName('quantity').setDescription('How many copies to sell').setRequired(false)
    )
    .addStringOption((option) =>
      option.setName('card_instance_ids').setDescription('Advanced: CSV of instance ids').setRequired(false)
    ),
};

export const marketSellDuplicatesCommand = {
  data: new SlashCommandBuilder()
    .setName('market-sell-duplicates')
    .setDescription('Auto-sell low-value duplicates')
    .setDMPermission(true)
    .addIntegerOption((option) =>
      option.setName('keep_per_card').setDescription('Keep at least this many copies').setRequired(false)
    )
    .addIntegerOption((option) =>
      option.setName('max_tier').setDescription('Max rarity tier to sell (1-6)').setRequired(false)
    )
    .addIntegerOption((option) =>
      option.setName('credits').setDescription('Max value per card to auto-sell').setRequired(false)
    )
    .addStringOption((option) =>
      option.setName('confirm').setDescription('Set to yes to execute').setRequired(false)
    ),
};

export const adminGrantPackCommand = {
  data: new SlashCommandBuilder()
    .setName('admin-grant-pack')
    .setDescription('Admin: grant claimable packs to a user')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) =>
      option.setName('target_user').setDescription('Target user').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('set_code').setDescription('Pack set code (e.g. sv1)').setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName('quantity').setDescription('Number of packs').setRequired(false)
    )
    .addStringOption((option) =>
      option.setName('product_code').setDescription('Optional product code override').setRequired(false)
    ),
};

export const adminGrantCreditsCommand = {
  data: new SlashCommandBuilder()
    .setName('admin-grant-credits')
    .setDescription('Admin: grant or remove credits')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) =>
      option.setName('target_user').setDescription('Target user').setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName('credits').setDescription('Credit delta (can be negative)').setRequired(true)
    ),
};

export const adminSetMultiplierCommand = {
  data: new SlashCommandBuilder()
    .setName('admin-set-multiplier')
    .setDescription('Admin: set TCG multipliers')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option.setName('key').setDescription('Key (credit_multiplier, drop_rate_event_multiplier)').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('value').setDescription('Value').setRequired(true)
    ),
};

export const adminEventCreateCommand = {
  data: new SlashCommandBuilder()
    .setName('admin-event-create')
    .setDescription('Admin: create a scheduled TCG live event')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option.setName('name').setDescription('Event name').setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('effect_type')
        .setDescription('Type of event effect')
        .setRequired(true)
        .addChoices(
          { name: 'Bonus Pack', value: 'bonus_pack' },
          { name: 'Drop Boost', value: 'drop_boost' },
          { name: 'Credit Boost', value: 'credit_boost' }
        )
    )
    .addStringOption((option) =>
      option.setName('value').setDescription('Effect value (bonus:1-3, boosts:1.0-3.0)').setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName('start_unix').setDescription('Start time (unix seconds)').setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName('end_unix').setDescription('End time (unix seconds)').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('set_code').setDescription('Optional set scope (e.g. sv1)').setRequired(false)
    )
    .addBooleanOption((option) =>
      option.setName('enabled').setDescription('Start enabled (default true)').setRequired(false)
    ),
};

export const adminEventListCommand = {
  data: new SlashCommandBuilder()
    .setName('admin-event-list')
    .setDescription('Admin: list TCG live events')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName('status')
        .setDescription('Filter by status')
        .setRequired(false)
        .addChoices(
          { name: 'All', value: 'all' },
          { name: 'Scheduled', value: 'scheduled' },
          { name: 'Active', value: 'active' },
          { name: 'Expired', value: 'expired' },
          { name: 'Disabled', value: 'disabled' }
        )
    )
    .addIntegerOption((option) =>
      option.setName('quantity').setDescription('Rows to show').setRequired(false)
    ),
};

export const adminEventEnableCommand = {
  data: new SlashCommandBuilder()
    .setName('admin-event-enable')
    .setDescription('Admin: enable or activate a TCG live event')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option.setName('event_id').setDescription('Event ID').setRequired(true).setAutocomplete(true)
    ),
};

export const adminEventDisableCommand = {
  data: new SlashCommandBuilder()
    .setName('admin-event-disable')
    .setDescription('Admin: disable a TCG live event')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option.setName('event_id').setDescription('Event ID').setRequired(true).setAutocomplete(true)
    ),
};

export const adminEventDeleteCommand = {
  data: new SlashCommandBuilder()
    .setName('admin-event-delete')
    .setDescription('Admin: delete a TCG live event')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option.setName('event_id').setDescription('Event ID').setRequired(true).setAutocomplete(true)
    ),
};

export const adminEventNowCommand = {
  data: new SlashCommandBuilder()
    .setName('admin-event-now')
    .setDescription('Admin: force start/stop a TCG live event')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option.setName('event_id').setDescription('Event ID').setRequired(true).setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Immediate action')
        .setRequired(true)
        .addChoices(
          { name: 'Start Now', value: 'start_now' },
          { name: 'Stop Now', value: 'stop_now' }
        )
    ),
};

export const adminTradeLockCommand = {
  data: new SlashCommandBuilder()
    .setName('admin-trade-lock')
    .setDescription('Admin: lock or unlock trading')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName('filter')
        .setDescription('on or off')
        .setRequired(true)
        .addChoices(
          { name: 'On', value: 'on' },
          { name: 'Off', value: 'off' }
        )
    ),
};

export const adminAuditCommand = {
  data: new SlashCommandBuilder()
    .setName('admin-audit')
    .setDescription('Admin: view recent TCG admin events')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((option) =>
      option.setName('quantity').setDescription('Rows to show').setRequired(false)
    ),
};

export const adminRollbackTradeCommand = {
  data: new SlashCommandBuilder()
    .setName('admin-rollback-trade')
    .setDescription('Admin: rollback a settled trade')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option.setName('trade_id').setDescription('Trade ID').setRequired(true).setAutocomplete(true)
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
  doCommand,
  searchCommand,
  claimPackCommand,
  packsCommand,
  openPackCommand,
  viewUnopenedPacksCommand,
  viewPackCompletionCommand,
  autoClaimPackCommand,
  inventoryCommand,
  cardViewCommand,
  collectionStatsCommand,
  tradeOfferCommand,
  tradeAcceptCommand,
  tradeRejectCommand,
  tradeCancelCommand,
  tradeViewCommand,
  marketValueCommand,
  marketBrowseCommand,
  marketQuoteBuyCommand,
  marketBuyCommand,
  marketQuoteSellCommand,
  marketSellCommand,
  marketSellDuplicatesCommand,
  adminGrantPackCommand,
  adminGrantCreditsCommand,
  adminSetMultiplierCommand,
  adminTradeLockCommand,
  adminEventCreateCommand,
  adminEventListCommand,
  adminEventEnableCommand,
  adminEventDisableCommand,
  adminEventDeleteCommand,
  adminEventNowCommand,
  adminAuditCommand,
  adminRollbackTradeCommand,
];
