import type { EatingEvent } from '../types';
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

/** The journal day an event belongs to, honouring the day it was captured in. */
export function eventDayKey(event: Pick<EatingEvent, 'localDate' | 'occurredAt'>, timeZone = DEFAULT_TIMEZONE) {
  return event.localDate ?? localDateFor(event.occurredAt, timeZone);
}

export function todayKey(timeZone = DEFAULT_TIMEZONE) {
  return localDateFor(new Date(), timeZone);
}

/** Calendar arithmetic uses date-only keys, never the device's UTC offset. */
export function calendarMonth(today: string, offset = 0) {
  const [year, month] = today.split('-').map(Number);
  const anchor = new Date(Date.UTC(year, month - 1 + offset, 1));
  const prefix = anchor.toISOString().slice(0, 7);
  const length = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    label: anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    leading: anchor.getUTCDay(),
    days: Array.from({ length }, (_, index) => ({ key: `${prefix}-${String(index + 1).padStart(2, '0')}`, day: index + 1 })),
  };
}
