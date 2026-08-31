import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';

export const dynamic = 'force-dynamic';

type UsdaNutrient = { nutrientId?: number; value?: number };
type UsdaFood = {
  fdcId: number;
  description?: string;
  brandOwner?: string;
  brandName?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodNutrients?: UsdaNutrient[];
};

const nutrientIds = { calories: 1008, protein: 1003, carbs: 1005, fat: 1004, fiber: 1079, iron: 1089, calcium: 1087, vitaminC: 1162 } as const;

function nutrient(food: UsdaFood, id: number) {
  return Number(food.foodNutrients?.find((item) => item.nutrientId === id)?.value ?? 0);
}

function relevance(food: UsdaFood, query: string) {
  const text = `${food.brandName ?? ''} ${food.brandOwner ?? ''} ${food.description ?? ''}`.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  const brand = `${food.brandName ?? ''} ${food.brandOwner ?? ''}`.toLowerCase();
  return words.reduce((score, word) => score + (text.includes(word) ? 3 : -2) + (brand.includes(word) ? 3 : 0), 0);
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user && process.env.NODE_ENV === 'production') return Response.json({ error: 'Authentication required' }, { status: 401 });
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (query.length < 2 || query.length > 100) return Response.json({ error: 'Enter a specific food or brand.' }, { status: 400 });

  const firstWord = query.split(/\s+/)[0];
  const searchTerm = firstWord.length >= 4 ? firstWord : query;
  const runtime = env as unknown as Record<string, unknown>;
  const apiKey = String(runtime.USDA_API_KEY || 'DEMO_KEY');
  let response: Response;
  try {
    response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: searchTerm, dataType: ['Branded'], pageSize: 30 }),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return Response.json({ error: 'The nutrition source did not respond. Try again shortly.' }, { status: 502 });
  }
  if (!response.ok) return Response.json({ error: 'The nutrition source is temporarily unavailable. Try again shortly.' }, { status: 502 });
  const payload = await response.json() as { foods?: UsdaFood[] };
  const foods = (payload.foods ?? []).sort((a,b) => relevance(b,query)-relevance(a,query)).slice(0,6);
  const results = foods.map((food) => {
    const grams = /^(?:g|grm|gram)$/i.test(food.servingSizeUnit ?? '') ? Number(food.servingSize) : null;
    const scale = grams ? grams / 100 : 1;
    const brand = food.brandName || food.brandOwner || '';
    const description = food.description?.replace(/\s+/g,' ').trim() || 'Branded food';
    return {
      id: String(food.fdcId),
      name: [brand, description].filter(Boolean).join(' · '),
      brand,
      description,
      serving: food.householdServingFullText || (food.servingSize ? `${food.servingSize} ${food.servingSizeUnit ?? ''}`.trim() : '1 serving'),
      servingGrams: grams,
      servingsPerCookedCup: /\bpasta\b/i.test(description) ? 1 : null,
      calories: nutrient(food,nutrientIds.calories) * scale,
      protein: nutrient(food,nutrientIds.protein) * scale,
      carbs: nutrient(food,nutrientIds.carbs) * scale,
      fat: nutrient(food,nutrientIds.fat) * scale,
      fiber: nutrient(food,nutrientIds.fiber) * scale,
      iron: nutrient(food,nutrientIds.iron) * scale || null,
      calcium: nutrient(food,nutrientIds.calcium) * scale || null,
      vitaminC: nutrient(food,nutrientIds.vitaminC) * scale || null,
      sourceLabel: 'USDA FoodData Central',
      sourceUrl: `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${food.fdcId}/nutrients`,
    };
  });
  return Response.json({ results, searched: searchTerm, note: searchTerm !== query ? `Searched the brand term “${searchTerm}” and ranked matches against “${query}”.` : null });
}
