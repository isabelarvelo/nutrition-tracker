import type { LibraryItem, NutritionCandidate } from '../../types';
import type { FoodResearchResult } from '../../food-research';
import type { ReceiptFood } from './receipt';

const SANE = (value: number) => Number.isFinite(value) && value >= 0 && value <= 20000;

function usable(result: FoodResearchResult) {
  return result.matchScore >= 0.85
    && Boolean(result.sourceUrl)
    && Boolean(result.serving.trim())
    && [result.calories, result.protein, result.carbs, result.fat, result.fiber].every(SANE);
}

/** Research results and stored candidates are different shapes; bridge them. */
function asCandidate(result: FoodResearchResult): NutritionCandidate {
  return {
    providerId: 'web', externalId: result.id, name: result.name, brand: result.brand || null,
    servingDescription: result.serving, servingGrams: result.servingGrams, unitGrams: result.unitGrams,
    nutrients: {
      calories: result.calories, protein: result.protein, carbs: result.carbs, fat: result.fat,
      fiber: result.fiber, iron: result.iron, calcium: result.calcium, vitaminC: result.vitaminC,
    },
    sourceLabel: result.sourceLabel, sourceUrl: result.sourceUrl,
    matchScore: result.matchScore, dataQuality: 'extracted',
  };
}

function applied(item: LibraryItem, result: FoodResearchResult): LibraryItem {
  return {
    ...item,
    name: result.name,
    alias: [...new Set([item.name, ...item.alias.split(',')].map((value) => value.trim()).filter(Boolean))].join(', '),
    quantity: 1, unit: result.serving,
    servingGrams: result.servingGrams, servingsPerCookedCup: result.servingsPerCookedCup,
    calories: result.calories, protein: result.protein, carbs: result.carbs, fat: result.fat, fiber: result.fiber,
    iron: result.iron, calcium: result.calcium, vitaminC: result.vitaminC,
    sourceLabel: result.sourceLabel, sourceUrl: result.sourceUrl,
    nutritionPending: false, unresolvedReason: null,
  };
}

/** Receipt purchase amounts never define a nutritional serving.
 * Ambiguous results remain pending for manual research in the library.
 */
export async function enrichReceiptItem(
  item: LibraryItem,
  lookup: (query: string) => Promise<{ results: FoodResearchResult[] }>,
  context?: Pick<ReceiptFood, 'lookupQuery' | 'brand' | 'packageSize'>,
): Promise<LibraryItem> {
  try {
    // Search on everything the receipt knew, not just the display name.
    const { results } = await lookup(context?.lookupQuery?.trim() || item.name);
    if (!results.length) return { ...item, unresolvedReason: 'no_match' };

    const ranked = [...results].sort((left, right) => right.matchScore - left.matchScore);
    const [best, runnerUp] = ranked;

    if (!usable(best)) {
      return {
        ...item,
        candidates: ranked.slice(0, 3).map(asCandidate),
        unresolvedReason: best.matchScore < 0.85 ? 'low_confidence' : 'incomplete_source',
      };
    }

    // A near-tie is a real ambiguity — two package sizes of the same product,
    // say. Surface both rather than picking one and presenting it as settled.
    if (runnerUp && usable(runnerUp) && best.matchScore - runnerUp.matchScore < 0.08) {
      return { ...item, candidates: ranked.slice(0, 3).map(asCandidate), unresolvedReason: 'ambiguous_match' };
    }

    return applied(item, best);
  } catch {
    return { ...item, unresolvedReason: 'lookup_failed' };
  }
}
