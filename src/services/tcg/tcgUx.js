import { formatRarity, resolveSetName } from '../catalog/catalogResolver.js';

export function buildPackOpenHeadline({ openerLabel, setCode }) {
  return `${openerLabel} opened a ${resolveSetName(setCode)} booster.`;
}

export function formatPackCardLines(cards = []) {
  return cards.map((card, idx) => {
    const stars = '★'.repeat(Math.max(1, Math.min(6, Number(card?.rarity_tier || 1))));
    return `${idx + 1}. ${card?.name || 'Unknown'} [${formatRarity(card?.rarity)}] ${stars}`;
  });
}

export function buildPackOpenSummaryText({
  openerLabel,
  setCode,
  mintedCards = [],
  rewards = null,
  remainingUnopened = null,
  prefix = '',
}) {
  const lines = [];
  if (prefix) lines.push(prefix.trim());
  lines.push(buildPackOpenHeadline({ openerLabel, setCode }));
  lines.push(formatPackCardLines(mintedCards).join('\n') || 'No cards.');
  if (rewards) {
    lines.push(
      `Credits earned: ${rewards.earned} (base ${rewards.base} + streak ${rewards.streakBonus})`
    );
  }
  if (Number.isFinite(Number(remainingUnopened))) {
    lines.push(`Unopened packs left: ${remainingUnopened}`);
  }
  return lines.filter(Boolean).join('\n\n');
}

export function buildInventorySummaryText({
  ownerLabel = 'You',
  page = 1,
  totalPages = 1,
  total = 0,
  rows = [],
  includeRef = false,
}) {
  const lines = rows.map((row, idx) => {
    const base = `${idx + 1}. ${row?.name || 'Unknown'} [${formatRarity(row?.rarity)}] (${resolveSetName(row?.set_code || '')})`;
    if (!includeRef) return base;
    return `${base} • ref ${String(row?.instance_id || '').slice(-6) || 'n/a'}`;
  });
  return (
    `${ownerLabel} inventory page ${page}/${totalPages} (${total} cards)\n` +
    `${lines.join('\n') || 'No cards.'}`
  );
}

export function buildCompletionEmbedData(completion) {
  const progressSlots = 10;
  const filled = Math.max(
    0,
    Math.min(progressSlots, Math.round((Number(completion?.ownedUnique || 0) / Math.max(1, Number(completion?.total || 0))) * progressSlots))
  );
  const progressBar = `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, progressSlots - filled))}`;
  const missingPreview = (completion?.missing || [])
    .slice(0, 12)
    .map((row) => `• ${row.name}`)
    .join('\n');
  const dupPreview = (completion?.duplicates || [])
    .slice(0, 8)
    .map((row) => `• ${row.name} x${row.owned_count}`)
    .join('\n');
  const featuredCard = (completion?.missing || [])[0] || (completion?.rows || []).find((row) => Number(row?.owned_count || 0) > 0) || null;

  return {
    title: `${completion?.setName || resolveSetName(completion?.setCode)} Completion`,
    description:
      `Set: **${completion?.setName || resolveSetName(completion?.setCode)}**\n` +
      `Completion: **${completion?.ownedUnique || 0}/${completion?.total || 0}** (${Number(completion?.completionPct || 0).toFixed(1)}%)\n` +
      `${progressBar}`,
    fields: [
      { name: 'Owned Unique', value: `${completion?.ownedUnique || 0}`, inline: true },
      { name: 'Missing', value: `${completion?.missingCount || 0}`, inline: true },
      { name: 'Duplicates', value: `${(completion?.duplicates || []).length}`, inline: true },
      { name: 'Missing Preview', value: missingPreview || 'No missing cards. Set complete.', inline: false },
      { name: 'Duplicate Preview', value: dupPreview || 'No duplicates yet.', inline: false },
      ...(featuredCard
        ? [{
          name: 'Featured Card',
          value: `${featuredCard.name} (${Number(featuredCard.owned_count || 0) > 0 ? 'Owned' : 'Missing'})`,
          inline: false,
        }]
        : []),
    ],
    featuredImageUrl: featuredCard?.image_large || featuredCard?.image_small || '',
  };
}
