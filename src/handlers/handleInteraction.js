import { PermissionFlagsBits } from 'discord.js';
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
  executeSearchCommand,
} from '../commands/handlers.js';

export async function handleInteraction(interaction, { inMemoryTurns, pollTimers, client, superAdminId }) {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const isSuperAdmin = interaction.user.id === superAdminId;
  const hasAdminPerms =
    isSuperAdmin || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

  // Commands that require guild context
  const guildOnlyCommands = ['status', 'purge', 'serverinfo'];

  if (guildOnlyCommands.includes(commandName)) {
    if (!interaction.inGuild() && !isSuperAdmin) {
      await interaction.reply({ content: 'Guilds only.', ephemeral: true });
      return;
    }
    if (!hasAdminPerms) {
      await interaction.reply({ content: 'Admin only.', ephemeral: true });
      return;
    }
  }

  try {
    switch (commandName) {
      case 'ask':
        return await executeAskCommand(interaction, inMemoryTurns, client);
      case 'poll':
        return await executePollCommand(interaction, pollTimers);
      case 'gif':
        return await executeGifCommand(interaction);
      case 'memory':
        return await executeMemoryCommand(interaction, { superAdminId });
      case 'purge':
        return await executePurgeCommand(interaction);
      case 'serverinfo':
        return await executeServerInfoCommand(interaction);
      case 'lobotomize':
        return await executeLobotomizeCommand(interaction);
      case 'mydata':
        return await executeMyDataCommand(interaction);
      case 'autoreply':
        return await executeAutoreplyCommand(interaction);
      case 'status':
        return await executeStatusCommand(interaction);
      case 'search':
        return await executeSearchCommand(interaction);
      default:
        await interaction.reply({ content: 'Unknown command.', ephemeral: true });
    }
  } catch (err) {
    console.error(`Error handling command ${commandName}:`, err);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: 'An error occurred while processing your request.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
    }
  }
}
