import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarMonth, eventDayKey, localDateFor } from './dates.ts';

test('uses the configured timezone across the UTC day boundary', () => {
  assert.equal(localDateFor('2026-09-03T03:30:00.000Z', 'America/Chicago'), '2026-09-02');
  assert.equal(localDateFor('2026-09-03T06:30:00.000Z', 'America/Chicago'), '2026-09-03');
});

test('uses IANA daylight-saving rules', () => {
  assert.equal(localDateFor('2026-01-15T05:30:00.000Z', 'America/Chicago'), '2026-01-14');
  assert.equal(localDateFor('2026-07-15T05:30:00.000Z', 'America/Chicago'), '2026-07-15');
});

test('calendar month stays on journal dates in extreme timezones', () => {
  const instant = '2026-09-01T01:00:00Z';
  const west = calendarMonth(localDateFor(instant, 'Pacific/Honolulu'));
  const east = calendarMonth(localDateFor(instant, 'Pacific/Kiritimati'));
  assert.equal(west.days.at(-1).key, '2026-08-31');
  assert.equal(east.days[0].key, '2026-09-01');
  assert.equal(east.leading, 2);
  assert.equal(calendarMonth('2026-01-01', -1).days[0].key, '2025-12-01');
  assert.equal(calendarMonth('2024-02-01').days.length, 29);
});

test('stored journal day wins over a changed viewing timezone', () => {
  assert.equal(eventDayKey({ localDate: '2026-09-02', occurredAt: '2026-09-03T03:30:00Z' }, 'Asia/Tokyo'), '2026-09-02');
});
