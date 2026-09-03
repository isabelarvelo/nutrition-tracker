import assert from 'node:assert/strict';
import test from 'node:test';
import { findLibraryMatch, parseAmount } from './amount.ts';

test('scales compatible count servings', () => {
  assert.deepEqual(parseAmount('3 eggs', 1, 'large'), { quantity: 3, unit: 'large', scale: 3 });
});

test('rejects incompatible units instead of silently using one serving', () => {
  assert.equal(parseAmount('3 cups eggs', 1, 'large').scale, null);
});

test('converts weight through serving grams', () => {
  assert.equal(parseAmount('2 oz chicken', 4, 'oz', { servingGrams: 113.398, servingsPerCookedCup: null }).scale, .5);
});

test('library matching respects word boundaries and prefers the longest alias', () => {
  const egg = { name: 'Egg', alias: 'eggs' };
  const eggSalad = { name: 'Egg salad', alias: 'usual egg salad' };
  assert.equal(findLibraryMatch('eggplant parmesan', [egg]), undefined);
  assert.equal(findLibraryMatch('usual egg salad', [egg, eggSalad]), eggSalad);
});
