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
  };

  return router;
}
