import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichReceiptItem } from './receipt-nutrition.ts';

const item = { id: '', name: 'Brand oats', alias: 'BR OATS', quantity: 3, unit: 'packages', nutritionPending: true, calories: 0 };
const result = { id: 'r1', name: 'Brand · Rolled oats', brand: 'Brand', serving: '½ cup dry (40 g)', servingGrams: 40, servingsPerCookedCup: null, unitGrams: {}, calories: 150, protein: 5, carbs: 27, fat: 3, fiber: 4, iron: null, calcium: null, vitaminC: null, sourceLabel: 'Manufacturer label', sourceUrl: 'https://example.com/oats', matchScore: .95 };

/** Nutrition must not have been applied, and the reason must be recorded. */
function assertStillPending(saved, reason) {
  assert.equal(saved.nutritionPending, true);
  assert.equal(saved.calories, 0);
  assert.equal(saved.unit, 'packages');
  assert.equal(saved.unresolvedReason, reason);
}

test('receipt save automatically researches the food and uses a single label serving', async () => {
  let searched;
  const saved = await enrichReceiptItem(item, async (query) => { searched = query; return { results: [result] }; });
  assert.equal(searched, item.name);
  assert.equal(saved.nutritionPending, false);
  assert.equal(saved.quantity, 1);
  assert.equal(saved.unit, result.serving);
  assert.equal(saved.calories, 150);
  assert.equal(saved.sourceUrl, result.sourceUrl);
  assert.equal(saved.iron, null);
  assert.equal(saved.alias, 'Brand oats, BR OATS');
  assert.equal(saved.unresolvedReason, null);
});

test('receipt context is what gets searched, not the bare display name', async () => {
  let searched;
  await enrichReceiptItem(item, async (query) => { searched = query; return { results: [result] }; },
    { lookupQuery: 'Brand rolled oats 18 oz', brand: 'Brand', packageSize: '18 oz' });
  assert.equal(searched, 'Brand rolled oats 18 oz');
});

test('weak matches, missing sources and failed research preserve a pending food', async () => {
  assertStillPending(await enrichReceiptItem(item, async () => ({ results: [] })), 'no_match');
  assertStillPending(await enrichReceiptItem(item, async () => ({ results: [{ ...result, matchScore: .7 }] })), 'low_confidence');
  assertStillPending(await enrichReceiptItem(item, async () => ({ results: [{ ...result, sourceUrl: '' }] })), 'incomplete_source');
  assertStillPending(await enrichReceiptItem(item, async () => ({ results: [{ ...result, protein: undefined }] })), 'incomplete_source');
  assertStillPending(await enrichReceiptItem(item, async () => { throw new Error('offline'); }), 'lookup_failed');
});

test('a near-tie stays pending but keeps both candidates for one-tap resolution', async () => {
  const saved = await enrichReceiptItem(item, async () => ({ results: [result, { ...result, id: 'r2', name: 'Different flavor' }] }));
  assertStillPending(saved, 'ambiguous_match');
  assert.equal(saved.candidates.length, 2);
  assert.equal(saved.candidates[0].name, 'Brand · Rolled oats');
  assert.equal(saved.candidates[0].sourceUrl, result.sourceUrl);
});

test('a clear leader is applied even when weaker alternatives exist', async () => {
  // The previous implementation bailed on results.length !== 1, so any product
  // with a runner-up silently stayed blank. This is the main reason receipt
  // foods never came back with nutrition.
  const saved = await enrichReceiptItem(item, async () => ({ results: [result, { ...result, id: 'r3', name: 'Steel cut', matchScore: .6 }] }));
  assert.equal(saved.nutritionPending, false);
  assert.equal(saved.calories, 150);
});

test('verified zero values are preserved rather than treated as missing', async () => {
  const saved = await enrichReceiptItem(item, async () => ({ results: [{ ...result, calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }] }));
  assert.equal(saved.nutritionPending, false);
  assert.equal(saved.calories, 0);
});
