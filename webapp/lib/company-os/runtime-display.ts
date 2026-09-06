export function formatCompanyOsTimestamp(value: string | null, missing = 'UNOBSERVED') {
  if (!value) return missing;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return missing;
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23',
  }).format(date);
}
