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
  confidence: number;
  completeness: number;
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
  status: 'captured' | 'estimated' | 'verified' | 'needs_attention';
  note: string;
  createdAt: string;
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

export type AppState = {
  events: EatingEvent[];
  library: LibraryItem[];
  goals: Goals;
  user: { displayName: string; email: string };
};

export const emptyNutrients: Nutrients = {
  calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0,
  iron: null, calcium: null, vitaminC: null,
};
