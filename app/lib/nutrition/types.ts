import type { Nutrients } from '../../types';

export type ProviderId = 'library' | 'fatsecret' | 'usda' | 'off' | 'web';

export type NutritionCandidate = {
  providerId: ProviderId;
  externalId: string;
  name: string;
  brand: string | null;
  servingDescription: string;
  servingGrams: number | null;
  unitGrams: Record<string, number>;
  nutrients: Nutrients;
  sourceLabel: string;
  sourceUrl: string;
  matchScore: number;
  dataQuality: 'verified' | 'crowdsourced' | 'extracted';
};

export interface NutritionProvider {
  id: ProviderId;
  search(query: string, options?: { limit?: number }): Promise<NutritionCandidate[]>;
}

export function normalizeMatchScore(raw: number) {
  // The existing relevance heuristic is centered near 5. Map it monotonically
  // into a provider-independent 0–1 range without pretending it is a probability.
  return Math.max(0, Math.min(1, 1 / (1 + Math.exp(-(raw - 3) / 4))));
}
