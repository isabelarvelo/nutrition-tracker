import type { Nutrients } from './types';
import { normalizeMatchScore } from './lib/nutrition/score';
import { and, eq, gt } from 'drizzle-orm';
import { getDb } from '../db';
import { providerCache } from '../db/schema';

type UsdaNutrient = { nutrientId?: number; value?: number };
type UsdaMeasure = { disseminationText?:string; modifier?:string; gramWeight?:number; measureUnit?:{name?:string} };
type UsdaFood = { fdcId:number; dataType?:string; description?:string; brandOwner?:string; brandName?:string; servingSize?:number; servingSizeUnit?:string; householdServingFullText?:string; foodMeasures?:UsdaMeasure[]; foodNutrients?:UsdaNutrient[] };
type OffProduct = { code?:string|number; product_name?:unknown; generic_name?:unknown; brands?:unknown; serving_size?:unknown; serving_quantity?:number|string; nutriments?:Record<string,number|string|undefined> };

export type FoodResearchResult = Nutrients & {
  id:string; name:string; brand:string; description:string; serving:string;
  servingQuantity:number; servingUnit:string; servingGrams:number|null;
  unitGrams:Record<string,number>; servingsPerCookedCup:number|null;
  sourceLabel:string; sourceUrl:string; matchScore:number; dataType:string;
};

const nutrientIds={calories:1008,protein:1003,carbs:1005,fat:1004,fiber:1079,iron:1089,calcium:1087,vitaminC:1162} as const;
const searchCache=new Map<string,{expires:number;value:Promise<{results:FoodResearchResult[];searched:string}>}>();
const offSearchTimes:number[]=[];

async function readProviderCache<T>(key:string):Promise<T|null>{
  try{const [row]=await getDb().select({payload:providerCache.payload}).from(providerCache).where(and(eq(providerCache.cacheKey,key),gt(providerCache.expiresAt,new Date().toISOString()))).limit(1);return row?JSON.parse(row.payload) as T:null;}
  catch{return null;}
}
async function writeProviderCache(key:string,value:unknown,days:number){
  try{const fetchedAt=new Date();const expiresAt=new Date(fetchedAt.valueOf()+days*86_400_000);const values={cacheKey:key,payload:JSON.stringify(value),fetchedAt:fetchedAt.toISOString(),expiresAt:expiresAt.toISOString()};await getDb().insert(providerCache).values(values).onConflictDoUpdate({target:providerCache.cacheKey,set:{payload:values.payload,fetchedAt:values.fetchedAt,expiresAt:values.expiresAt}});}
  catch{/* Cache availability must never break capture. */}
}
function cacheKey(provider:string,query:string,suffix=''){return`${provider}:${query.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}:${suffix}`;}
function claimOffSearchSlot(){const cutoff=Date.now()-60_000;while(offSearchTimes[0]<cutoff)offSearchTimes.shift();if(offSearchTimes.length>=10)throw new Error('Open Food Facts search rate limit reached');offSearchTimes.push(Date.now());}

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
    const branded=food.dataType==='Branded';const servingValue=Number(food.servingSize);const servingUnit=food.servingSizeUnit??'';const servingGrams=/^(?:g|grm|gram)$/i.test(servingUnit)?servingValue:/^(?:oz|ounce)$/i.test(servingUnit)?servingValue*28.3495:branded?null:100;const scale=servingGrams?servingGrams/100:1;const scaled=(id:number)=>{const value=nutrient(food,id);return value==null?null:value*scale;};
    const brand=food.brandName||food.brandOwner||'';const description=food.description?.replace(/\s+/g,' ').trim()||'Food';const serving=food.householdServingFullText||(servingGrams?`${servingGrams} g`:'1 serving');const parts=servingParts(serving,servingGrams);
    return{id:String(food.fdcId),name:[brand,description].filter(Boolean).join(' · '),brand,description,dataType:food.dataType||'USDA food',serving,servingQuantity:parts.quantity,servingUnit:parts.unit,servingGrams,unitGrams:unitGramMap(food,servingGrams),servingsPerCookedCup:null,calories:scaled(nutrientIds.calories)??0,protein:scaled(nutrientIds.protein)??0,carbs:scaled(nutrientIds.carbs)??0,fat:scaled(nutrientIds.fat)??0,fiber:scaled(nutrientIds.fiber)??0,iron:scaled(nutrientIds.iron),calcium:scaled(nutrientIds.calcium),vitaminC:scaled(nutrientIds.vitaminC),sourceLabel:`USDA FoodData Central · ${food.dataType||'food record'}`,sourceUrl:`https://fdc.nal.usda.gov/fdc-app.html#/food-details/${food.fdcId}/nutrients`,matchScore:normalizeMatchScore(relevance(food,cleaned))};
  });return{results,searched};
}
export async function researchFoods(query:string,apiKey:string,brandedOnly=false,limit=6){
  const key=`${query.trim().toLowerCase()}|${brandedOnly?'branded':'all'}|${limit}`;const persistentKey=cacheKey('usda',query,`${brandedOnly?'branded':'all'}:${limit}`);const persistent=await readProviderCache<{results:FoodResearchResult[];searched:string}>(persistentKey);if(persistent)return persistent;const cached=searchCache.get(key);if(cached&&cached.expires>Date.now())return cached.value;const value=researchFoodsUncached(query,apiKey,brandedOnly,limit);searchCache.set(key,{expires:Date.now()+10*60_000,value});try{const result=await value;await writeProviderCache(persistentKey,result,30);return result;}catch(error){searchCache.delete(key);throw error;}
}

function offNumber(nutrients:Record<string,number|string|undefined>,key:string){const value=Number(nutrients[`${key}_100g`]);return Number.isFinite(value)?value:null;}
function offText(value:unknown):string{
  if(typeof value==='string'||typeof value==='number')return String(value).trim();
  if(Array.isArray(value))return value.map(offText).filter(Boolean).join(', ');
  if(value&&typeof value==='object')return Object.values(value).map(offText).find(Boolean)??'';
  return'';
}
export async function researchOpenFoodFacts(query:string,limit=6):Promise<FoodResearchResult[]>{
  const persistentKey=cacheKey('off',query,String(limit));const persistent=await readProviderCache<FoodResearchResult[]>(persistentKey);if(persistent)return persistent;claimOffSearchSlot();
  const response=await fetch('https://search.openfoodfacts.org/search',{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'MiseNutritionJournal/0.1 (OpenAI Sites app)'},signal:AbortSignal.timeout(12000),body:JSON.stringify({q:query,page_size:Math.min(20,Math.max(limit,6)),langs:['en'],fields:['code','product_name','generic_name','brands','serving_size','serving_quantity','nutriments']})});if(!response.ok)throw new Error(`Open Food Facts search returned ${response.status}`);const payload=await response.json() as {hits?:Array<OffProduct|{_source?:OffProduct}>};const products=(payload.hits??[]).map((hit)=>('_source'in hit&&hit._source?hit._source:hit as OffProduct));
  const results=products.map((product):FoodResearchResult|null=>{
    const description=offText(product.product_name)||offText(product.generic_name);const brand=offText(product.brands);const text=`${brand} ${description}`.trim();const score=normalizeMatchScore(textRelevance(text,brand,query));const nutrients=product.nutriments??{};const calories=offNumber(nutrients,'energy-kcal')??((offNumber(nutrients,'energy-kj')??0)/4.184);if(!description||!calories)return null;
    const servingText=offText(product.serving_size);const servingGrams=Number(product.serving_quantity)||100;const scale=servingGrams/100;const unit=normalizedUnit(servingText)||(searchWords(query).includes('bar')?'bar':'g');const servingQuantity=unit==='g'?servingGrams:1;const scaled=(key:string)=>{const value=offNumber(nutrients,key);return value==null?null:value*scale;};
    return{id:`off-${product.code??compact(text)}`,name:[brand,description].filter(Boolean).join(' · '),brand,description,serving:servingText||`${servingGrams} g`,servingQuantity,servingUnit:unit,servingGrams,unitGrams:{g:1,...(unit!=='g'?{[unit]:servingGrams}:{})},servingsPerCookedCup:null,sourceLabel:'Open Food Facts · product label',sourceUrl:`https://world.openfoodfacts.org/product/${product.code??''}`,matchScore:score,dataType:'Open Food Facts',calories:calories*scale,protein:scaled('proteins')??0,carbs:scaled('carbohydrates')??0,fat:scaled('fat')??0,fiber:scaled('fiber')??0,iron:scaled('iron'),calcium:scaled('calcium'),vitaminC:scaled('vitamin-c')};
  }).filter((item):item is FoodResearchResult=>item!==null).sort((a,b)=>b.matchScore-a.matchScore).slice(0,limit);await writeProviderCache(persistentKey,results,30);return results;
}
