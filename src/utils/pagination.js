import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export function buildPagedEmbed({ title, pages = [], pageIndex = 0 }) {
  const safePages = Array.isArray(pages) && pages.length ? pages : ['No results.'];
  const totalPages = safePages.length;
  const boundedIndex = Math.max(0, Math.min(totalPages - 1, Number(pageIndex || 0)));
  const pageLabel = `Page ${boundedIndex + 1}/${totalPages}`;
  const embed = {
    title: String(title || 'Results').slice(0, 256),
    description: String(safePages[boundedIndex] || 'No results.').slice(0, 4096),
    footer: { text: pageLabel },
  };
  return { embed, pageLabel, pageIndex: boundedIndex, totalPages };
}

export function buildPagerComponents({ pageIndex = 0, totalPages = 1, baseCustomId = '' }) {
  const safeTotal = Math.max(1, Number(totalPages || 1));
  if (safeTotal <= 1) return [];
  const safeIndex = Math.max(0, Math.min(safeTotal - 1, Number(pageIndex || 0)));
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${baseCustomId}:prev:${safeIndex}`)
        .setLabel('Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safeIndex <= 0),
      new ButtonBuilder()
        .setCustomId(`${baseCustomId}:next:${safeIndex}`)
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safeIndex >= safeTotal - 1),
    ),
  ];
}

export function warnIfPagedWithoutPager({ totalPages = 1, components = [], source = 'unknown' }) {
  if (process.env.NODE_ENV === 'production') return;
  if (Number(totalPages || 1) <= 1) return;
  if (!Array.isArray(components) || components.length === 0) {
    console.warn(`[pagination] ${source} rendered ${totalPages} pages without pager controls.`);
  }
}

