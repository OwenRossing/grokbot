export function shouldOpenAfterClaim({ unopenedAfter }) {
  return Number(unopenedAfter || 0) > 0;
}

export async function runClaimAllAndOpenOne({ claimAllFn, openNextFn }) {
  const claim = await claimAllFn();
  if (!shouldOpenAfterClaim({ unopenedAfter: claim?.unopenedAfter })) {
    return { claim, open: null };
  }
  const open = await openNextFn();
  return { claim, open };
}

