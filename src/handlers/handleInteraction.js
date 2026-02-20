import { executeTcgAutocomplete, executeTcgPackButton, executeTcgRevealButton, executeTcgTradeButton } from '../commands/tcgHandlers.js';
import { buildInteractionCommandRouter } from '../commands/interactionRouter.js';
import { executeCommandConfirmationButton } from '../commands/commandRuntime.js';
import { hasInteractionAdminAccess, isSuperAdminUser } from '../utils/auth.js';

export async function handleInteraction(interaction, { inMemoryTurns, pollTimers, client, superAdminId }) {
  if (interaction.isAutocomplete()) {
    const handled = await executeTcgAutocomplete(interaction);
    if (handled) return;
    return;
  }
  if (interaction.isButton()) {
    const commandConfirmHandled = await executeCommandConfirmationButton(interaction, { superAdminId });
    if (commandConfirmHandled) return;
    const handled = await executeTcgTradeButton(interaction);
    if (handled) return;
    const packHandled = await executeTcgPackButton(interaction);
    if (packHandled) return;
    const revealHandled = await executeTcgRevealButton(interaction);
    if (revealHandled) return;
    return;
  }
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const isSuperAdmin = isSuperAdminUser(interaction.user.id, superAdminId);
  const hasAdminPerms = hasInteractionAdminAccess(interaction, superAdminId);
  const router = buildInteractionCommandRouter({ inMemoryTurns, pollTimers, client, superAdminId });
  const command = router[commandName];
  if (!command) {
    await interaction.reply({ content: 'Unknown command.', ephemeral: true });
    return;
  }
  if (command.requiresGuildAdmin) {
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
    return await command.execute(interaction);
  } catch (err) {
    console.error(`Error handling command ${commandName}:`, err);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: 'An error occurred while processing your request.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
    }
  }
}
