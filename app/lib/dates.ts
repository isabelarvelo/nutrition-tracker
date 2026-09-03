export const DEFAULT_TIMEZONE = 'America/Chicago';

export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function localDateFor(occurredAt: string | Date, timeZone = DEFAULT_TIMEZONE) {
  const date = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  if (Number.isNaN(date.valueOf())) throw new Error('Invalid occurrence date');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
