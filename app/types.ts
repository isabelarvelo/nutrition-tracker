export type Nutrients = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  iron: number | null;
  calcium: number | null;
  vitaminC: number | null;
};

export type FoodItem = Nutrients & {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  source: string;
  sourceUrl: string;
  libraryItemId: string | null;
  confidence: number;
  completeness: number;
  candidates?: NutritionCandidate[];
  resolutionTier?: 'library' | 'structured' | 'web' | 'unresolved' | null;
  unresolvedReason?: 'no_match' | 'unit_mismatch' | 'ambiguous_serving' | null;
  clarificationQuestion?: string | null;
  quotedSourceText?: string | null;
};

export type NutritionCandidate = {
  providerId: 'library' | 'fatsecret' | 'usda' | 'off' | 'web';
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

export type Evidence = {
  id: string;
  type: 'text' | 'photo' | 'voice';
  transcript: string | null;
  filename: string | null;
  url: string | null;
};

export type EatingEvent = {
  id: string;
  occurredAt: string;
  mealType: string;
  status: 'captured' | 'resolving' | 'estimated' | 'verified' | 'needs_attention';
  note: string;
  createdAt: string;
  localDate?: string;
  items: FoodItem[];
  evidence: Evidence[];
};

export type LibraryItem = Nutrients & {
  id: string;
  name: string;
  kind: 'food' | 'recipe' | 'meal';
  alias: string;
  quantity: number;
  unit: string;
  servingGrams: number | null;
  servingsPerCookedCup: number | null;
  sourceLabel: string;
  sourceUrl: string;
};

export type Goals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
};

export type MealTimes = {
  Breakfast: string;
  Lunch: string;
  Dinner: string;
  Snack: string;
};

export type AppState = {
  events: EatingEvent[];
  library: LibraryItem[];
  goals: Goals;
  mealTimes: MealTimes;
  timezone?: string;
  user: { displayName: string; email: string };
};

export const emptyNutrients: Nutrients = {
  calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0,
  iron: null, calcium: null, vitaminC: null,
};
