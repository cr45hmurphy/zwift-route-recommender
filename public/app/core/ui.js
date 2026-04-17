export function formatWorldContextLabel(context, worldName) {
  const worlds = [...(context?.worlds ?? [])].map(worldName).join(' · ');
  return `${worlds} (via ${context?.source ?? 'unknown'})`;
}

export function formatWorldContextSourceDetail(context) {
  const source = context?.source ?? 'unknown';
  const parts = [`Source: ${source}.`];
  const fetchedAt = Number(context?.fetchedAt);

  if (Number.isFinite(fetchedAt)) {
    const formatted = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(fetchedAt));
    parts.push(`Fetched: ${formatted} UTC.`);
  }

  if (source.includes('schedule fallback')) {
    parts.push('Includes built-in schedule fallback for missing guest worlds.');
  }

  return parts.join(' ');
}

export function countRouteCards(list) {
  return list?.querySelectorAll('.route-card').length ?? 0;
}
