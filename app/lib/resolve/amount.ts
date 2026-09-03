type PortionConversion = {
  servingGrams: number | null;
  servingsPerCookedCup: number | null;
  unitGrams?: Record<string, number>;
};

const numberWords: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, half: .5 };

function singular(value: string) {
  return value.toLowerCase().replace(/tablespoons?/, 'tbsp').replace(/teaspoons?/, 'tsp').replace(/ounces?/, 'oz').replace(/bars?/, 'bar').replace(/slices?/, 'slice').replace(/servings?/, 'serving').replace(/cups?/, 'cup').replace(/grams?/, 'g').replace(/s$/, '').replace(/\s+cooked$/, '');
}

export function parseAmount(segment: string, fallbackQuantity: number, fallbackUnit: string, conversion?: PortionConversion) {
  const match = segment.match(/^\s*(\d+\/\d+|\d+(?:\.\d+)?|a|an|one|two|three|half)\s+(?:(?:a|an)\s+)?(cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|grams?|g|scoops?|slices?|large|medium|small|bars?|servings?)?\b/i);
  if (!match) {
    if (/^\s*sprinkle\b/i.test(segment)) {
      if(singular(fallbackUnit)==='sprinkle')return{quantity:1,unit:'sprinkle',scale:1};
      if(singular(fallbackUnit)==='tsp')return{quantity:1,unit:'sprinkle (~¼ tsp)',scale:.25};
      return{quantity:1,unit:'sprinkle',scale:null};
    }
    if (/^\s*drizzle\b/i.test(segment)) return singular(fallbackUnit)==='tsp'?{quantity:1,unit:'drizzle (~1 tsp)',scale:1}:{quantity:1,unit:'drizzle',scale:null};
    return { quantity: fallbackQuantity, unit: fallbackUnit, scale: 1 };
  }
  const raw = match[1].toLowerCase();
  const quantity = raw.includes('/') ? Number(raw.split('/')[0]) / Number(raw.split('/')[1]) : (numberWords[raw] ?? Number(raw));
  const unit = match[2] ? singular(match[2]) : fallbackUnit;
  if (unit === 'cup' && /\bcooked\b/i.test(segment) && conversion?.servingsPerCookedCup) return { quantity, unit: 'cup cooked', scale: quantity * conversion.servingsPerCookedCup };
  if (conversion?.servingGrams && conversion.unitGrams?.[unit]) return { quantity, unit, scale: quantity * conversion.unitGrams[unit] / conversion.servingGrams };
  if (unit === 'g' && conversion?.servingGrams) return { quantity, unit: 'g', scale: quantity / conversion.servingGrams };
  if (unit === 'oz' && conversion?.servingGrams) return { quantity, unit: 'oz', scale: quantity * 28.3495 / conversion.servingGrams };
  return { quantity, unit, scale: singular(unit) === singular(fallbackUnit) ? quantity / fallbackQuantity : null };
}

function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function findLibraryMatch<T extends { name: string; alias: string }>(segment: string, library: T[]) {
  return library
    .flatMap((item) => [item.name, ...item.alias.split(',')].map((term) => ({ item, term: term.trim() })))
    .filter(({ term }) => term && new RegExp(`(?:^|[^a-z0-9])${escapeRegex(term)}(?:$|[^a-z0-9])`, 'i').test(segment))
    .sort((left, right) => right.term.length - left.term.length)[0]?.item;
}
