import assert from 'node:assert/strict';
import test from 'node:test';
import { localDateFor } from './dates.ts';

test('uses the configured timezone across the UTC day boundary', () => {
  assert.equal(localDateFor('2026-09-03T03:30:00.000Z', 'America/Chicago'), '2026-09-02');
  assert.equal(localDateFor('2026-09-03T06:30:00.000Z', 'America/Chicago'), '2026-09-03');
});

test('uses IANA daylight-saving rules', () => {
  assert.equal(localDateFor('2026-01-15T05:30:00.000Z', 'America/Chicago'), '2026-01-14');
  assert.equal(localDateFor('2026-07-15T05:30:00.000Z', 'America/Chicago'), '2026-07-15');
});
