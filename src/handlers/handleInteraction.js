import {
  executeTcgAutocomplete,
  executeTcgHubButton,
  executeTcgPackButton,
  executeTcgPageButton,
  executeTcgRevealButton,
  executeTcgTradeButton,
} from '../commands/tcgHandlers.js';
import { buildInteractionCommandRouter } from '../commands/interactionRouter.js';
import { executeCommandConfirmationButton } from '../commands/commandRuntime.js';
import { hasInteractionAdminAccess, isSuperAdminUser } from '../utils/auth.js';
import { wrapInteractionForEmbedReplies } from '../utils/embedReply.js';
import { TCG_LEGACY_DEPRECATION_MESSAGE, isTcgLegacyEnabled } from '../utils/features.js';

export async function handleInteraction(interaction, { inMemoryTurns, pollTimers, client, superAdminId }) {
  const wrappedInteraction = wrapInteractionForEmbedReplies(interaction, { defaultTitle: 'Command Result' });
  if (interaction.isAutocomplete()) {
    if (!isTcgLegacyEnabled()) {
      try {
        await interaction.respond([]);
      } catch {
        // Ignore autocomplete response races.
      }
      return;
    }
    const handled = await executeTcgAutocomplete(interaction);
    if (handled) return;
    return;
  }
  if (interaction.isButton()) {
    if (!isTcgLegacyEnabled() && String(interaction.customId || '').startsWith('tcg_')) {
      await wrappedInteraction.reply({ content: TCG_LEGACY_DEPRECATION_MESSAGE, ephemeral: true });
      return;
    }
    const commandConfirmHandled = await executeCommandConfirmationButton(wrappedInteraction, { superAdminId });
    if (commandConfirmHandled) return;
    const handled = await executeTcgTradeButton(wrappedInteraction);
    if (handled) return;
    const pagerHandled = await executeTcgPageButton(wrappedInteraction, { superAdminId });
    if (pagerHandled) return;
    const packHandled = await executeTcgPackButton(wrappedInteraction);
    if (packHandled) return;
    const hubHandled = await executeTcgHubButton(wrappedInteraction);
    if (hubHandled) return;
    const revealHandled = await executeTcgRevealButton(wrappedInteraction);
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
    await wrappedInteraction.reply({ content: 'Unknown command.', ephemeral: true });
    return;
  }
  if (command.requiresGuildAdmin) {
    if (!interaction.inGuild() && !isSuperAdmin) {
      await wrappedInteraction.reply({ content: 'Guilds only.', ephemeral: true });
      return;
    }
    if (!hasAdminPerms) {
      await wrappedInteraction.reply({ content: 'Admin only.', ephemeral: true });
      return;
    }
  }

  try {
    return await command.execute(wrappedInteraction);
  } catch (err) {
    console.error(`Error handling command ${commandName}:`, err);
    if (interaction.deferred || interaction.replied) {
      await wrappedInteraction.followUp({ content: 'An error occurred while processing your request.', ephemeral: true });
    } else {
      await wrappedInteraction.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
    }
  }
}
