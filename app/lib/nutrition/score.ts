// Maps the raw text-relevance heuristic used by the USDA and Open Food Facts
// adapters onto a provider-independent 0-1 range. The heuristic is centred near
// 5; the logistic keeps the ordering intact without implying a probability.
export function normalizeMatchScore(raw: number) {
  return Math.max(0, Math.min(1, 1 / (1 + Math.exp(-(raw - 3) / 4))));
}
