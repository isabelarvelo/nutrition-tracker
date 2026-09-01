import type { Nutrients } from './types';

type UsdaNutrient = { nutrientId?: number; value?: number };
type UsdaMeasure = { disseminationText?:string; modifier?:string; gramWeight?:number; measureUnit?:{name?:string} };
type UsdaFood = { fdcId:number; dataType?:string; description?:string; brandOwner?:string; brandName?:string; servingSize?:number; servingSizeUnit?:string; householdServingFullText?:string; foodMeasures?:UsdaMeasure[]; foodNutrients?:UsdaNutrient[] };
type OffProduct = { code?:string; product_name?:string; generic_name?:string; brands?:string; serving_size?:string; serving_quantity?:number|string; nutriments?:Record<string,number|string|undefined> };

export type FoodResearchResult = Nutrients & {
  id:string; name:string; brand:string; description:string; serving:string;
  servingQuantity:number; servingUnit:string; servingGrams:number|null;
  unitGrams:Record<string,number>; servingsPerCookedCup:number|null;
  sourceLabel:string; sourceUrl:string; matchScore:number; dataType:string;
};

const nutrientIds={calories:1008,protein:1003,carbs:1005,fat:1004,fiber:1079,iron:1089,calcium:1087,vitaminC:1162} as const;
const searchCache=new Map<string,{expires:number;value:Promise<{results:FoodResearchResult[];searched:string}>}>();

function nutrient(food:UsdaFood,id:number){const found=food.foodNutrients?.find((item)=>item.nutrientId===id)?.value;return found==null?null:Number(found);}
function compact(value:string){return value.toLowerCase().replace(/[^a-z0-9]/g,'');}
function searchWords(query:string){return(query.toLowerCase().match(/[a-z0-9]+/g)??[]).filter((word,index)=>(word.length>2||(index===0&&word.length>=2))&&!['cup','cups','cooked','large','small','medium','with','and','the','of','an'].includes(word));}
function textRelevance(text:string,brand:string,query:string){
  const normalizedText=text.toLowerCase();const normalizedBrand=brand.toLowerCase();const words=searchWords(query);
  let score=words.reduce((total,word)=>total+(normalizedText.includes(word)?3:-2)+(normalizedBrand.includes(word)?3:0),0);
  for(const modifier of ['oil','spray','drink','soda','juice','flavor','flavoured','flavored','sauce','dressing'])if(normalizedText.includes(modifier)&&!words.includes(modifier))score-=8;
  const brandToken=words[0];if(brandToken&&brandToken.length<=3)score+=compact(normalizedBrand).includes(brandToken)?8:-8;
  const compactQuery=compact(query);if(compactQuery.length>=4&&compact(normalizedText).includes(compactQuery))score+=10;
  return score;
}
function relevance(food:UsdaFood,query:string){const brand=`${food.brandName??''} ${food.brandOwner??''}`.trim();return textRelevance(`${brand} ${food.description??''}`,brand,query)+(food.dataType==='Branded'?0:2);}
function normalizedUnit(value:string){
  const unit=value.toLowerCase();
  if(/tablespoon|tbsp/.test(unit))return'tbsp';if(/teaspoon|tsp/.test(unit))return'tsp';if(/ounce|\boz\b/.test(unit))return'oz';if(/\bcups?\b/.test(unit))return'cup';
  if(/\blarge\b/.test(unit))return'large';if(/\bmedium\b/.test(unit))return'medium';if(/\bsmall\b/.test(unit))return'small';if(/\bbars?\b/.test(unit))return'bar';
  if(/\bslices?\b/.test(unit))return'slice';if(/\bservings?\b/.test(unit))return'serving';if(/\bgrams?\b|\bg\b/.test(unit))return'g';return'';
}
function servingParts(text:string|undefined,grams:number|null){
  const match=text?.match(/(\d+(?:\.\d+)?|\d+\/\d+)\s*(cup|cups|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|large|medium|small|bars?|slices?|servings?|g|grams?)\b/i);
  if(!match)return{quantity:grams??1,unit:grams?'g':'serving'};
  const quantity=match[1].includes('/')?Number(match[1].split('/')[0])/Number(match[1].split('/')[1]):Number(match[1]);return{quantity,unit:normalizedUnit(match[2])||'serving'};
}
function unitGramMap(food:UsdaFood,servingGrams:number|null){
  const result:Record<string,number>={};if(servingGrams)result.g=1;
  for(const measure of food.foodMeasures??[]){const label=[measure.disseminationText,measure.modifier,measure.measureUnit?.name].filter(Boolean).join(' ');const unit=normalizedUnit(label);const grams=Number(measure.gramWeight);if(unit&&grams>0&&!result[unit])result[unit]=grams;}
  const householdUnit=normalizedUnit(food.householdServingFullText??'');if(householdUnit&&servingGrams&&!result[householdUnit])result[householdUnit]=servingGrams;return result;
}

async function fetchFoods(query:string,apiKey:string,brandedOnly:boolean){
  const response=await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),body:JSON.stringify({query,dataType:brandedOnly?['Branded']:['Branded','Foundation','SR Legacy','Survey (FNDDS)'],pageSize:40})});
  if(!response.ok){const remaining=response.headers.get('x-ratelimit-remaining');throw new Error(`USDA search returned ${response.status}${remaining?` (${remaining} requests remaining)`:''}`);}return((await response.json())as{foods?:UsdaFood[]}).foods??[];
}
async function researchFoodsUncached(query:string,apiKey:string,brandedOnly:boolean,limit:number):Promise<{results:FoodResearchResult[];searched:string}>{
  const cleaned=query.trim();let searched=cleaned;let foods=await fetchFoods(cleaned,apiKey,brandedOnly);const bestScore=Math.max(-99,...foods.map((food)=>relevance(food,cleaned)));const usefulWords=searchWords(cleaned);const fallbackQuery=usefulWords.find((word)=>word.length>=4)??cleaned;
  if(fallbackQuery.toLowerCase()!==cleaned.toLowerCase()&&bestScore<5){searched=fallbackQuery;const fallbackFoods=await fetchFoods(fallbackQuery,apiKey,brandedOnly);const seen=new Set(fallbackFoods.map((food)=>food.fdcId));foods=[...fallbackFoods,...foods.filter((food)=>!seen.has(food.fdcId))];}
  const results=foods.sort((a,b)=>relevance(b,cleaned)-relevance(a,cleaned)).slice(0,limit).map((food):FoodResearchResult=>{
    const branded=food.dataType==='Branded';const servingGrams=/^(?:g|grm|gram)$/i.test(food.servingSizeUnit??'')?Number(food.servingSize):branded?null:100;const scale=servingGrams?servingGrams/100:1;const scaled=(id:number)=>{const value=nutrient(food,id);return value==null?null:value*scale;};
    const brand=food.brandName||food.brandOwner||'';const description=food.description?.replace(/\s+/g,' ').trim()||'Food';const serving=food.householdServingFullText||(servingGrams?`${servingGrams} g`:'1 serving');const parts=servingParts(serving,servingGrams);
    return{id:String(food.fdcId),name:[brand,description].filter(Boolean).join(' · '),brand,description,dataType:food.dataType||'USDA food',serving,servingQuantity:parts.quantity,servingUnit:parts.unit,servingGrams,unitGrams:unitGramMap(food,servingGrams),servingsPerCookedCup:/\bpasta\b/i.test(description)?1:null,calories:scaled(nutrientIds.calories)??0,protein:scaled(nutrientIds.protein)??0,carbs:scaled(nutrientIds.carbs)??0,fat:scaled(nutrientIds.fat)??0,fiber:scaled(nutrientIds.fiber)??0,iron:scaled(nutrientIds.iron),calcium:scaled(nutrientIds.calcium),vitaminC:scaled(nutrientIds.vitaminC),sourceLabel:`USDA FoodData Central · ${food.dataType||'food record'}`,sourceUrl:`https://fdc.nal.usda.gov/fdc-app.html#/food-details/${food.fdcId}/nutrients`,matchScore:relevance(food,cleaned)};
  });return{results,searched};
}
export async function researchFoods(query:string,apiKey:string,brandedOnly=false,limit=6){
  const key=`${query.trim().toLowerCase()}|${brandedOnly?'branded':'all'}|${limit}`;const cached=searchCache.get(key);if(cached&&cached.expires>Date.now())return cached.value;const value=researchFoodsUncached(query,apiKey,brandedOnly,limit);searchCache.set(key,{expires:Date.now()+10*60_000,value});try{return await value;}catch(error){searchCache.delete(key);throw error;}
}

function offNumber(nutrients:Record<string,number|string|undefined>,key:string){const value=Number(nutrients[`${key}_100g`]);return Number.isFinite(value)?value:null;}
export async function researchOpenFoodFacts(query:string,limit=6):Promise<FoodResearchResult[]>{
  const url=new URL('https://world.openfoodfacts.org/cgi/search.pl');url.searchParams.set('search_terms',query);url.searchParams.set('search_simple','1');url.searchParams.set('action','process');url.searchParams.set('json','1');url.searchParams.set('page_size','20');url.searchParams.set('fields','code,product_name,generic_name,brands,serving_size,serving_quantity,nutriments');
  const response=await fetch(url,{headers:{'User-Agent':'MiseNutritionJournal/0.1 (OpenAI Sites app)'},signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error(`Open Food Facts search returned ${response.status}`);const products=((await response.json())as{products?:OffProduct[]}).products??[];
  return products.map((product):FoodResearchResult|null=>{
    const description=(product.product_name||product.generic_name||'').trim();const brand=(product.brands||'').trim();const text=`${brand} ${description}`.trim();const score=textRelevance(text,brand,query);const nutrients=product.nutriments??{};const calories=offNumber(nutrients,'energy-kcal')??((offNumber(nutrients,'energy-kj')??0)/4.184);if(!description||!calories)return null;
    const servingGrams=Number(product.serving_quantity)||100;const scale=servingGrams/100;const unit=normalizedUnit(product.serving_size??'')||(searchWords(query).includes('bar')?'bar':'g');const servingQuantity=unit==='g'?servingGrams:1;const scaled=(key:string)=>{const value=offNumber(nutrients,key);return value==null?null:value*scale;};
    return{id:`off-${product.code??compact(text)}`,name:[brand,description].filter(Boolean).join(' · '),brand,description,serving:product.serving_size||`${servingGrams} g`,servingQuantity,servingUnit:unit,servingGrams,unitGrams:{g:1,...(unit!=='g'?{[unit]:servingGrams}:{})},servingsPerCookedCup:null,sourceLabel:'Open Food Facts · product label',sourceUrl:`https://world.openfoodfacts.org/product/${product.code??''}`,matchScore:score,dataType:'Open Food Facts',calories:calories*scale,protein:scaled('proteins')??0,carbs:scaled('carbohydrates')??0,fat:scaled('fat')??0,fiber:scaled('fiber')??0,iron:scaled('iron'),calcium:scaled('calcium'),vitaminC:scaled('vitamin-c')};
  }).filter((item):item is FoodResearchResult=>item!==null).sort((a,b)=>b.matchScore-a.matchScore).slice(0,limit);
}
