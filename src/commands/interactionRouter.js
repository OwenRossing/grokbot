import {
  executeAskCommand,
  executePollCommand,
  executeGifCommand,
  executeMemoryCommand,
  executeLobotomizeCommand,
  executePurgeCommand,
  executeServerInfoCommand,
  executeMyDataCommand,
  executeAutoreplyCommand,
  executeStatusCommand,
  executeDoCommand,
  executeSearchCommand,
} from './handlers.js';
import {
  executeAchievementsCommand,
  executeBetCommand,
  executeLeaderboardCommand,
  executeMarketsCommand,
  executePortfolioCommand,
} from './marketHandlers.js';
import { isMarketsEnabled } from '../utils/features.js';

export function buildInteractionCommandRouter({ inMemoryTurns, pollTimers, client, superAdminId }) {
  const router = {
    ask: {
      execute: (interaction) => executeAskCommand(interaction, inMemoryTurns, client),
    },
    poll: {
      execute: (interaction) => executePollCommand(interaction, pollTimers),
    },
    gif: {
      execute: (interaction) => executeGifCommand(interaction),
    },
    memory: {
      execute: (interaction) => executeMemoryCommand(interaction, { superAdminId }),
    },
    purge: {
      requiresGuildAdmin: true,
      execute: (interaction) => executePurgeCommand(interaction),
    },
    serverinfo: {
      requiresGuildAdmin: true,
      execute: (interaction) => executeServerInfoCommand(interaction),
    },
    lobotomize: {
      execute: (interaction) => executeLobotomizeCommand(interaction),
    },
    mydata: {
      execute: (interaction) => executeMyDataCommand(interaction),
    },
    autoreply: {
      execute: (interaction) => executeAutoreplyCommand(interaction),
    },
    status: {
      requiresGuildAdmin: true,
      execute: (interaction) => executeStatusCommand(interaction),
    },
    do: {
      execute: (interaction) => executeDoCommand(interaction, { superAdminId }),
    },
    search: {
      execute: (interaction) => executeSearchCommand(interaction),
    },
    markets: {
      execute: (interaction) => executeMarketsCommand(interaction),
    },
    bet: {
      execute: (interaction) => executeBetCommand(interaction),
    },
    portfolio: {
      execute: (interaction) => executePortfolioCommand(interaction),
    },
    leaderboard: {
      execute: (interaction) => executeLeaderboardCommand(interaction),
    },
    achievements: {
      execute: (interaction) => executeAchievementsCommand(interaction),
    },
  };

  if (!isMarketsEnabled()) {
    delete router.markets;
    delete router.bet;
    delete router.portfolio;
    delete router.leaderboard;
    delete router.achievements;
  }

  return router;
}
