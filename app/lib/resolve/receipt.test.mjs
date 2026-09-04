import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptFoods, readReceipt, buildLookupQuery } from './receipt.ts';

const line = (name, extra = {}) => ({
  name, receiptText: name, brand: null, packageSize: null, unitCount: null,
  isHumanFood: true, confidence: 0.98, ...extra,
});

test('receipt review excludes non-food and duplicate products', () => {
  const foods = receiptFoods({ items: [
    line('Brami pasta'), line('BRAMI PASTA'),
    line('Dish soap', { isHumanFood: false }), line('Pet food', { isHumanFood: false }),
    line('Bananas'),
  ] });
  assert.deepEqual(foods.map((food) => food.name), ['Brami pasta', 'Bananas']);
});

test('plausible but uncertain food reaches review instead of vanishing', () => {
  // The old gate dropped everything under .9 silently, which on a real receipt
  // is most of it. Uncertain lines now arrive flagged for confirmation.
  const foods = receiptFoods({ items: [line('Unknown item', { confidence: 0.6 }), line('Illegible', { confidence: 0.2 })] });
  assert.deepEqual(foods.map((food) => food.name), ['Unknown item']);
  assert.equal(foods[0].needsConfirmation, true);
});

test('brand and package size survive into the nutrition lookup query', () => {
  const [food] = receiptFoods({ items: [line('Greek yogurt, plain', { receiptText: 'CHOBANI GRK 5.3OZ', brand: 'Chobani', packageSize: '5.3 oz' })] });
  assert.equal(food.brand, 'Chobani');
  assert.equal(food.packageSize, '5.3 oz');
  assert.equal(food.lookupQuery, 'Chobani Greek yogurt, plain 5.3 oz');
  assert.equal(food.alias, 'CHOBANI GRK 5.3OZ');
});

test('a brand already present in the name is not repeated', () => {
  assert.equal(buildLookupQuery({ name: 'Chobani Greek yogurt', brand: 'Chobani', packageSize: '5.3 oz' }), 'Chobani Greek yogurt 5.3 oz');
});

test('receipt reading rejects incomplete model output without saving invented items', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ status: 'incomplete', output: [] });
  try { await assert.rejects(() => readReceipt({ mimeType: 'image/png', base64: 'test' }, { apiKey: 'test' }), /incomplete/); }
  finally { globalThis.fetch = original; }
});

test('receipt output never carries prices, purchase portions or inferred nutrients', () => {
  const foods = receiptFoods({ items: [line('Oats', { receiptText: 'ORG OATS', calories: 200, quantity: 3, price: 9 })] });
  assert.deepEqual(Object.keys(foods[0]).sort(), ['alias', 'brand', 'lookupQuery', 'name', 'needsConfirmation', 'packageSize']);
});
