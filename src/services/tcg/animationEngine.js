function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cardLine(card, idx) {
  const tierStars = '★'.repeat(Math.max(1, Math.min(6, Number(card.rarity_tier || 1))));
  return `${idx + 1}. ${card.name} [${card.rarity || 'Unknown'}] ${tierStars}`;
}

export async function runPackRevealAnimation(interaction, mintedCards) {
  const stages = [
    'Preparing booster pack...',
    'Sealing checks complete...',
    'Ripping the foil wrapper...',
    'Cards sliding into reveal position...',
  ];

  for (const stage of stages) {
    await interaction.editReply({ content: stage });
    await delay(550);
  }

  const lines = mintedCards.map((card, idx) => cardLine(card, idx)).join('\n');
  await interaction.editReply({
    content: `Pack opened.\n\n${lines}`,
  });
}

