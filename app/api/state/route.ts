import { env } from 'cloudflare:workers';
import type { FoodItem, Goals, LibraryItem, MealTimes, Nutrients } from '../../types';
import { researchFoods, researchOpenFoodFacts, type FoodResearchResult } from '../../food-research';
import { requireUser } from '../../lib/auth';
import { DEFAULT_TIMEZONE, localDateFor } from '../../lib/dates';
import { actionSchema, capturePayloadSchema, validationError } from '../../lib/schemas';
import { findLibraryMatch, parseAmount } from '../../lib/resolve/amount';
import { parseMealBundle, type MealImageInput } from '../../lib/resolve/parse';
import { libraryComponents, mealTitle } from '../../lib/resolve/groups';
import { estimateFoods, applyEstimate, isComponentMatch } from '../../lib/resolve/estimate';

export const dynamic = 'force-dynamic';

type D1Row = Record<string, string | number | null>;

const DEFAULT_GOALS: Goals = { calories: 2100, protein: 115, carbs: 240, fat: 70, fiber: 28 };
const DEFAULT_MEAL_TIMES: MealTimes = { Breakfast:'08:00', Lunch:'12:30', Dinner:'18:30', Snack:'15:30' };

function parseCandidates(value: string | number | null) {
  if (!value) return undefined;
  try { return JSON.parse(String(value)) as FoodItem['candidates']; }
  catch { return undefined; }
}

const catalog: Array<{ terms: string[]; name: string; quantity: number; unit: string; nutrients: Nutrients; exact?:boolean; sourceLabel?:string; sourceUrl?:string }> = [
  { terms:['rx bar','rxbar'], exact:true, name:'RXBAR protein bar', quantity:1, unit:'bar', nutrients:{calories:210.08,protein:12.012,carbs:24.024,fat:8.996,fiber:4.992,iron:2.002,calcium:49.92,vitaminC:null}, sourceLabel:'USDA FoodData Central · Branded', sourceUrl:'https://fdc.nal.usda.gov/fdc-app.html#/food-details/2599185/nutrients' },
  { terms: ['oatmeal', 'oats'], name: 'Rolled oats', quantity: .5, unit: 'cup dry', nutrients: { calories: 150, protein: 5, carbs: 27, fat: 3, fiber: 4, iron: 1.7, calcium: 20, vitaminC: 0 } },
  { terms: ['banana'], name: 'Banana', quantity: 1, unit: 'medium', nutrients: { calories: 105, protein: 1.3, carbs: 27, fat: .4, fiber: 3.1, iron: .3, calcium: 6, vitaminC: 10.3 } },
  { terms: ['almond butter'], name: 'Almond butter', quantity: 1, unit: 'tbsp', nutrients: { calories: 98, protein: 3.4, carbs: 3, fat: 9, fiber: 1.6, iron: .6, calcium: 56, vitaminC: 0 } },
  { terms: ['orgain', 'protein powder', 'protein scoop'], name: 'Vanilla protein powder', quantity: 1, unit: 'scoop', nutrients: { calories: 150, protein: 21, carbs: 15, fat: 4, fiber: 2, iron: 4.5, calcium: 50, vitaminC: 0 } },
  { terms: ['egg', 'eggs'], name: 'Egg', quantity: 1, unit: 'large', nutrients: { calories: 72, protein: 6.3, carbs: .35, fat: 4.75, fiber: 0, iron: .9, calcium: 28, vitaminC: 0 } },
  { terms: ['toast', 'bread'], name: 'Whole-grain toast', quantity: 1, unit: 'slice', nutrients: { calories: 100, protein: 4, carbs: 18, fat: 1.5, fiber: 3, iron: 1.1, calcium: 40, vitaminC: 0 } },
  { terms: ['yogurt'], name: 'Greek yogurt', quantity: 1, unit: 'cup', nutrients: { calories: 130, protein: 23, carbs: 9, fat: 0, fiber: 0, iron: .2, calcium: 250, vitaminC: 0 } },
  { terms: ['chicken'], name: 'Roasted chicken breast', quantity: 4, unit: 'oz', nutrients: { calories: 187, protein: 35, carbs: 0, fat: 4, fiber: 0, iron: 1.1, calcium: 17, vitaminC: 0 } },
  { terms: ['rice'], name: 'Cooked brown rice', quantity: 1, unit: 'cup', nutrients: { calories: 216, protein: 5, carbs: 45, fat: 1.8, fiber: 3.5, iron: .8, calcium: 20, vitaminC: 0 } },
  { terms: ['salad'], name: 'Mixed salad with dressing', quantity: 2, unit: 'cups', nutrients: { calories: 210, protein: 5, carbs: 16, fat: 14, fiber: 6, iron: 2.2, calcium: 90, vitaminC: 32 } },
  { terms: ['salmon'], name: 'Baked salmon', quantity: 5, unit: 'oz', nutrients: { calories: 295, protein: 31, carbs: 0, fat: 18, fiber: 0, iron: .7, calcium: 18, vitaminC: 0 } },
  { terms: ['coffee'], name: 'Coffee with milk', quantity: 1, unit: 'cup', nutrients: { calories: 35, protein: 2, carbs: 3, fat: 1.5, fiber: 0, iron: 0, calcium: 75, vitaminC: 0 } },
  { terms: ['parmesan cheese', 'parmesan'], name: 'Parmesan cheese', quantity: 1, unit: 'sprinkle', nutrients: { calories: 22, protein: 2, carbs: .2, fat: 1.4, fiber: 0, iron: 0, calcium: 65, vitaminC: 0 } },
  { terms: ['olive oil'], exact:true, name:'Olive oil', quantity:1, unit:'tsp', nutrients:{calories:40,protein:0,carbs:0,fat:4.5,fiber:0,iron:0,calcium:0,vitaminC:0}, sourceLabel:'USDA FoodData Central · standard reference', sourceUrl:'https://fdc.nal.usda.gov/' },
  { terms:['einkorn berries','einkorn berry','einkorn'],name:'Cooked einkorn berries',quantity:1,unit:'cup cooked',nutrients:{calories:250,protein:9,carbs:52,fat:1.7,fiber:8,iron:2.7,calcium:20,vitaminC:0} },
  { terms:['pesto'],name:'Basil pesto',quantity:1,unit:'tbsp',nutrients:{calories:80,protein:1,carbs:1,fat:8,fiber:.3,iron:.4,calcium:20,vitaminC:.5} },
  { terms:['grape','grapes'],name:'Grapes',quantity:1,unit:'cup',nutrients:{calories:104,protein:1.1,carbs:27.3,fat:.2,fiber:1.4,iron:.5,calcium:15,vitaminC:4.8} },
  { terms:['avocado','avocados'],name:'Avocado',quantity:1,unit:'medium',nutrients:{calories:322,protein:4,carbs:17.1,fat:29.5,fiber:13.5,iron:1.1,calcium:24,vitaminC:20.1} },
];

function mapItem(row: D1Row): FoodItem {
  const legacySource=String(row.source);const source=legacySource==='personal library'?'Personal Library':legacySource==='reference estimate'?'Built-in reference':legacySource==='item estimate'||legacySource==='AI-style estimate'?'Legacy estimate · review':legacySource==='manual'?'Manual entry':legacySource;
  return {
    id: String(row.id), name: String(row.name), quantity: Number(row.quantity), unit: String(row.unit),
    calories: Number(row.calories), protein: Number(row.protein), carbs: Number(row.carbs), fat: Number(row.fat), fiber: Number(row.fiber),
    iron: row.iron == null ? null : Number(row.iron), calcium: row.calcium == null ? null : Number(row.calcium), vitaminC: row.vitamin_c == null ? null : Number(row.vitamin_c),
    source, sourceUrl:String(row.source_url??''), libraryItemId:row.library_item_id==null?null:String(row.library_item_id), confidence: Number(row.confidence), completeness: Number(row.completeness),
    candidates: parseCandidates(row.candidates),
    resolutionTier: row.resolution_tier == null ? null : String(row.resolution_tier) as FoodItem['resolutionTier'],
    unresolvedReason: row.unresolved_reason == null ? null : String(row.unresolved_reason) as FoodItem['unresolvedReason'],
    clarificationQuestion: row.clarification_question == null ? null : String(row.clarification_question),
    quotedSourceText: row.quoted_source_text == null ? null : String(row.quoted_source_text),
  };
}

async function getState(userId: string) {
  const db = env.DB;
  const [eventsResult, itemsResult, evidenceResult, libraryResult, goal] = await Promise.all([
    db.prepare('SELECT * FROM events WHERE user_id = ? ORDER BY occurred_at DESC').bind(userId).all<D1Row>(),
    db.prepare('SELECT li.* FROM logged_items li JOIN events e ON e.id = li.event_id WHERE e.user_id = ?').bind(userId).all<D1Row>(),
    db.prepare('SELECT ev.* FROM evidence ev JOIN events e ON e.id = ev.event_id WHERE e.user_id = ? ORDER BY ev.sort_order').bind(userId).all<D1Row>(),
    db.prepare('SELECT * FROM library_items WHERE user_id = ? ORDER BY name').bind(userId).all<D1Row>(),
    db.prepare('SELECT * FROM goals WHERE user_id = ?').bind(userId).first<D1Row>(),
  ]);
  const itemsByEvent = new Map<string, FoodItem[]>();
  for (const row of itemsResult.results) {
    const eventId = String(row.event_id);
    itemsByEvent.set(eventId, [...(itemsByEvent.get(eventId) ?? []), mapItem(row)]);
  }
  const evidenceByEvent = new Map<string, Array<{ id:string; type:string; transcript:string|null; filename:string|null; url:string|null }>>();
  for (const row of evidenceResult.results) {
    const eventId = String(row.event_id);
    const item = { id: String(row.id), type: String(row.type), transcript: row.transcript == null ? null : String(row.transcript), filename: row.filename == null ? null : String(row.filename), url: row.storage_key ? `/api/files?key=${encodeURIComponent(String(row.storage_key))}` : null };
    evidenceByEvent.set(eventId, [...(evidenceByEvent.get(eventId) ?? []), item]);
  }
  const events = eventsResult.results.map((event) => ({
    title:mealTitle(String(event.title??''),String(event.note),String(event.meal_type)),
    id: String(event.id), occurredAt: String(event.occurred_at), localDate: String(event.local_date), mealType: String(event.meal_type), status: String(event.status), note: String(event.note), createdAt: String(event.created_at),
    items: itemsByEvent.get(String(event.id)) ?? [],
    evidence: evidenceByEvent.get(String(event.id)) ?? [],
  }));
  const library = libraryResult.results.map((row): LibraryItem => ({ ...mapItem({ ...row, source: 'personal', confidence: 1, completeness: .95 }), components:row.components?JSON.parse(String(row.components)) as FoodItem[]:undefined, kind: String(row.kind) as LibraryItem['kind'], alias: String(row.alias), servingGrams: row.serving_grams == null ? null : Number(row.serving_grams), servingsPerCookedCup: row.servings_per_cooked_cup == null ? null : Number(row.servings_per_cooked_cup), sourceLabel: String(row.source_label ?? ''), sourceUrl: String(row.source_url ?? '') }));
  return { events, library, goals: goal ? { calories: Number(goal.calories), protein: Number(goal.protein), carbs: Number(goal.carbs), fat: Number(goal.fat), fiber: Number(goal.fiber) } : DEFAULT_GOALS, mealTimes:goal?{Breakfast:String(goal.breakfast_time??DEFAULT_MEAL_TIMES.Breakfast),Lunch:String(goal.lunch_time??DEFAULT_MEAL_TIMES.Lunch),Dinner:String(goal.dinner_time??DEFAULT_MEAL_TIMES.Dinner),Snack:String(goal.snack_time??DEFAULT_MEAL_TIMES.Snack)}:DEFAULT_MEAL_TIMES, timezone: String(goal?.timezone ?? DEFAULT_TIMEZONE) };
}

function parsedAmount(segment: string, fallbackQuantity: number, fallbackUnit: string, conversion?: {servingGrams:number|null;servingsPerCookedCup:number|null;unitGrams?:Record<string,number>}) {
  return parseAmount(segment, fallbackQuantity, fallbackUnit, conversion);
}

function scaleNutrients(nutrients: Nutrients, scale: number): Nutrients {
  return {
    calories: nutrients.calories * scale,
    protein: nutrients.protein * scale,
    carbs: nutrients.carbs * scale,
    fat: nutrients.fat * scale,
    fiber: nutrients.fiber * scale,
    iron: nutrients.iron == null ? null : nutrients.iron * scale,
    calcium: nutrients.calcium == null ? null : nutrients.calcium * scale,
    vitaminC: nutrients.vitaminC == null ? null : nutrients.vitaminC * scale,
  };
}

function cleanFoodName(segment: string) {
  const name = segment
    .replace(/^\s*(?:\d+\/\d+|\d+(?:\.\d+)?|a|an|one|two|half)\s+(?:(?:a|an)\s+)?/i, '')
    .replace(/^(?:cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|grams?|g|scoops?|slices?|large|medium|small|servings?)\s+(?:of\s+)?/i, '')
    .replace(/^(?:sprinkle|dash|handful)\s+(?:of\s+)?/i, '')
    .trim();
  return name ? name[0].toUpperCase() + name.slice(1) : 'Food item';
}

function canApplyServing(segment:string,result:FoodResearchResult){
  const entered=segment.match(/^\s*(?:\d+\/\d+|\d+(?:\.\d+)?|a|an|one|two|half)\s+(?:(?:a|an)\s+)?(cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|grams?|g|scoops?|slices?|large|medium|small|bars?|servings?)?\b/i)?.[1];
  if(!entered)return result.servingUnit!=='g';
  const unit=entered.toLowerCase().replace(/tablespoons?/,'tbsp').replace(/teaspoons?/,'tsp').replace(/ounces?/,'oz').replace(/cups?/,'cup').replace(/bars?/,'bar').replace(/slices?/,'slice').replace(/servings?/,'serving');
  const base=result.servingUnit.replace(/s$/,'');if(unit.replace(/s$/,'')===base)return true;
  if((unit==='g'||unit==='oz')&&result.servingGrams)return true;
  if(unit==='cup'&&/\bcooked\b/i.test(segment)&&result.servingsPerCookedCup)return true;
  return Boolean(result.servingGrams&&result.unitGrams[unit]);
}

function toCandidate(result:FoodResearchResult, providerId:'usda'|'off', segment:string):NonNullable<FoodItem['candidates']>[number]{
  const amount=parsedAmount(segment,result.servingQuantity,result.servingUnit,result);
  const compatible=canApplyServing(segment,result)&&amount.scale!=null;
  const quantity=compatible?amount.quantity:result.servingQuantity;
  const unit=compatible?amount.unit:result.servingUnit;
  return {providerId,externalId:result.id,name:result.name,brand:result.brand||null,servingDescription:`${quantity} ${unit}`,quantity,unit,servingGrams:result.servingGrams,unitGrams:result.unitGrams,nutrients:scaleNutrients(result,compatible?amount.scale!:1),sourceLabel:result.sourceLabel,sourceUrl:result.sourceUrl,matchScore:result.matchScore,dataQuality:providerId==='usda'?'verified':'crowdsourced',assumption:compatible?'Nutrition scaled to your entered portion.':`Portion conversion unavailable; choosing this uses ${result.serving}.`};
}

async function interpretedItems(text: string, library: LibraryItem[], photos: MealImageInput[],requireModel=false) {
  const savedGroup=!photos.length?library.find(item=>item.components?.length&&[item.name,...item.alias.split(',')].some(name=>name.trim().toLowerCase()===text.trim().toLowerCase())):undefined;
  if(savedGroup)return {title:savedGroup.name,items:libraryComponents(savedGroup)};
  const bundle = (text.trim() || photos.length) ? await parseMealBundle(text,photos,{requireModel,apiKey:env.OPENAI_API_KEY?.trim(),model:photos.length?(env.OPENAI_VISION_MODEL?.trim()||'gpt-5.6-luna'):env.OPENAI_MODEL?.trim()}):{title:'',items:[]};
  const parsedFoods=bundle.items;
  const apiKey=env.USDA_API_KEY?.trim();
  const items:FoodItem[]=[];
  const fromResearch=(segment:string,result:FoodResearchResult,confidence:number):FoodItem=>{
    const amount=parsedAmount(segment,result.servingQuantity,result.servingUnit,result);const known=5+[result.iron,result.calcium,result.vitaminC].filter((value)=>value!=null).length;
    if (amount.scale == null) return {id:crypto.randomUUID(),name:cleanFoodName(segment),quantity:amount.quantity,unit:amount.unit,calories:0,protein:0,carbs:0,fat:0,fiber:0,iron:null,calcium:null,vitaminC:null,source:'Needs research',sourceUrl:'',libraryItemId:null,confidence:0,completeness:0,resolutionTier:'unresolved',unresolvedReason:'unit_mismatch'};
    return{id:crypto.randomUUID(),name:result.name,quantity:amount.quantity,unit:amount.unit,...scaleNutrients(result,amount.scale),source:result.sourceLabel,sourceUrl:result.sourceUrl,libraryItemId:null,confidence,completeness:known/8,resolutionTier:'structured'};
  };
  const resolved=await Promise.all(parsedFoods.map(async (parsedFood):Promise<FoodItem[]>=>{
    const items:FoodItem[]=[];
    const segment=parsedFood.rawText;
    const candidates:NonNullable<FoodItem['candidates']>=[];
    const saved = findLibraryMatch(segment, library);
    if (saved) {
      const amount = parsedAmount(segment, saved.quantity, saved.unit, saved);
      if(saved.components?.length&&amount.scale!=null)return libraryComponents(saved,amount.scale);
      if (amount.scale == null) { items.push({id:crypto.randomUUID(),name:cleanFoodName(segment),quantity:amount.quantity,unit:amount.unit,calories:0,protein:0,carbs:0,fat:0,fiber:0,iron:null,calcium:null,vitaminC:null,source:'Needs research',sourceUrl:'',libraryItemId:saved.id,confidence:0,completeness:0,resolutionTier:'unresolved',unresolvedReason:'unit_mismatch'}); return items; }
      items.push({ ...saved, id: crypto.randomUUID(), quantity: amount.quantity, unit: amount.unit, ...scaleNutrients(saved, amount.scale), source: 'Personal Library', sourceUrl:saved.sourceUrl, libraryItemId:saved.id, confidence: 1, completeness: .95, resolutionTier:'library' });return items;
    }
    const query=parsedFood.searchQuery;
    const normalizedQuery=query.toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
    const food=catalog.find((item)=>item.terms.some((term)=>item.exact?normalizedQuery===term:normalizedQuery.includes(term)));
    const preferStandard=/^(?:olive oil|parmesan cheese)$/.test(normalizedQuery);
    if(preferStandard&&food){const amount=parsedAmount(segment,food.quantity,food.unit);if(amount.scale!=null){items.push({id:crypto.randomUUID(),name:food.name,quantity:amount.quantity,unit:amount.unit,...scaleNutrients(food.nutrients,amount.scale),source:food.sourceLabel??'Best inference · standard reference',sourceUrl:food.sourceUrl??'',libraryItemId:null,confidence:parsedFood.confidence,completeness:.86,resolutionTier:'structured',clarificationQuestion:parsedFood.needsClarification});return items;}}
    try{if(!apiKey)throw new Error('USDA_API_KEY is not configured');const researched=await researchFoods(query,apiKey,false,8);researched.results=researched.results.filter(candidate=>isComponentMatch(query,candidate.name));candidates.push(...researched.results.filter(candidate=>candidate.matchScore>=.5).slice(0,3).map((candidate)=>toCandidate(candidate,'usda',segment)));const result=researched.results.find((candidate)=>candidate.matchScore>=.6&&candidate.calories>0&&canApplyServing(segment,candidate));if(result){items.push({...fromResearch(segment,result,Math.min(parsedFood.confidence,.95,.7+result.matchScore*.25)),candidates,clarificationQuestion:parsedFood.needsClarification});return items;}}
    catch(error){console.warn('USDA food resolution failed',{query,error:error instanceof Error?error.message:String(error)});}
    try{const webResults=(await researchOpenFoodFacts(query,6)).filter(candidate=>isComponentMatch(query,candidate.name));candidates.push(...webResults.filter(candidate=>candidate.matchScore>=.5).slice(0,3).map((candidate)=>toCandidate(candidate,'off',segment)));const result=webResults.find((candidate)=>candidate.matchScore>=.65&&candidate.calories>0&&canApplyServing(segment,candidate));if(result){items.push({...fromResearch(segment,result,Math.min(parsedFood.confidence,.86,.55+result.matchScore*.3)),candidates:candidates.slice(0,3),clarificationQuestion:parsedFood.needsClarification});return items;}}
    catch(error){console.warn('Open Food Facts resolution failed',{query,error:error instanceof Error?error.message:String(error)});}
    if(food?.exact){const amount=parsedAmount(segment,food.quantity,food.unit);if(amount.scale!=null){items.push({id:crypto.randomUUID(),name:food.name,quantity:amount.quantity,unit:amount.unit,...scaleNutrients(food.nutrients,amount.scale),source:food.sourceLabel??'Best inference · standard reference',sourceUrl:food.sourceUrl??'',libraryItemId:null,confidence:Math.min(parsedFood.confidence,.9),completeness:.86,candidates,resolutionTier:'structured',clarificationQuestion:parsedFood.needsClarification});return items;}}
    const amount={quantity:parsedFood.quantity??1,unit:parsedFood.unit??'serving'};
    const reason=candidates.length?'unit_mismatch':'no_match';
    items.push({id:crypto.randomUUID(),name:parsedFood.name,quantity:amount.quantity,unit:amount.unit,calories:0,protein:0,carbs:0,fat:0,fiber:0,iron:null,calcium:null,vitaminC:null,source:'Needs research',sourceUrl:'',libraryItemId:null,confidence:0,completeness:0,candidates:candidates.sort((a,b)=>b.matchScore-a.matchScore).slice(0,3),resolutionTier:'unresolved',unresolvedReason:reason,clarificationQuestion:parsedFood.needsClarification??(candidates.length?'Which of these matches what you ate?':null)});
    return items;
  }));
  items.push(...resolved.flat());
  const unresolved=items.filter(item=>item.resolutionTier==='unresolved');
  const estimates=await estimateFoods(unresolved,{apiKey:env.OPENAI_API_KEY?.trim(),model:env.OPENAI_VISION_MODEL?.trim()});
  for(let index=0;index<items.length;index++){
    const choices=estimates.get(items[index].id);
    if(choices?.length)items[index]={...applyEstimate(items[index],choices),candidates:[...choices,...(items[index].candidates??[])].slice(0,6)};
  }
  if (!items.length && photos.length) items.push({ id: crypto.randomUUID(), name: 'Meal from photo', quantity: 1, unit: 'serving', calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, iron: null, calcium: null, vitaminC: null, source: 'Photo evidence · needs review', sourceUrl:'', libraryItemId:null, confidence: 0, completeness: 0, resolutionTier:'unresolved', unresolvedReason:'no_match', clarificationQuestion:'The photo could not be interpreted. What foods and approximate portions are visible?' });
  return {title:bundle.title,items};
}

function itemStatements(eventId:string,items:FoodItem[],replacingId?:string) {
  return items.map((item) => env.DB.prepare(`INSERT INTO logged_items (id,event_id,name,quantity,unit,calories,protein,carbs,fat,fiber,iron,calcium,vitamin_c,source,source_url,library_item_id,confidence,completeness,candidates,resolution_tier,unresolved_reason,clarification_question,quoted_source_text) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?${replacingId?' WHERE EXISTS (SELECT 1 FROM logged_items WHERE id=?)':''}`).bind(item.id, eventId, item.name, item.quantity, item.unit, item.calories, item.protein, item.carbs, item.fat, item.fiber, item.iron, item.calcium, item.vitaminC, item.source,item.sourceUrl??'',item.libraryItemId??null,item.confidence,item.completeness,item.candidates?JSON.stringify(item.candidates):null,item.resolutionTier??null,item.unresolvedReason??null,item.clarificationQuestion??null,item.quotedSourceText??null,...(replacingId?[replacingId]:[])));
}
async function insertItems(eventId: string, items: FoodItem[]) {
  if(items.length)await env.DB.batch(itemStatements(eventId,items));
}

async function saveResolvedItem(item:FoodItem) {
  await env.DB.prepare(`UPDATE logged_items SET name=?,quantity=?,unit=?,calories=?,protein=?,carbs=?,fat=?,fiber=?,iron=?,calcium=?,vitamin_c=?,source=?,source_url=?,library_item_id=?,confidence=?,completeness=?,candidates=?,resolution_tier=?,unresolved_reason=?,clarification_question=? WHERE id=?`).bind(item.name,item.quantity,item.unit,item.calories,item.protein,item.carbs,item.fat,item.fiber,item.iron,item.calcium,item.vitaminC,item.source,item.sourceUrl,item.libraryItemId,item.confidence,item.completeness,item.candidates?JSON.stringify(item.candidates):null,item.resolutionTier??null,item.unresolvedReason??null,item.clarificationQuestion??null,item.id).run();
}

async function refreshEventStatus(eventId:string) {
  const attention=await env.DB.prepare(`SELECT COUNT(*) AS count FROM logged_items WHERE event_id=? AND (resolution_tier='unresolved' OR clarification_question IS NOT NULL)`).bind(eventId).first<{count:number}>();
  await env.DB.prepare('UPDATE events SET status=?,updated_at=? WHERE id=?').bind(Number(attention?.count??0)>0?'needs_attention':'estimated',new Date().toISOString(),eventId).run();
}

async function enrichEvent(eventId: string, note: string, library: LibraryItem[], photos: MealImageInput[]) {
  try {
    const now = new Date().toISOString();
    await env.DB.prepare(`UPDATE events SET status = 'resolving', updated_at = ? WHERE id = ?`).bind(now, eventId).run();
    const {items,title} = await interpretedItems(note, library, photos);
    await insertItems(eventId, items);
    const status = items.some((item) => item.resolutionTier === 'unresolved' || item.clarificationQuestion) ? 'needs_attention' : 'estimated';
    await env.DB.prepare("UPDATE events SET status=?,title=CASE WHEN title='' THEN ? ELSE title END,updated_at=? WHERE id=?").bind(status,title,new Date().toISOString(),eventId).run();
  } catch (error) {
    console.error('Food enrichment failed', { eventId, error: error instanceof Error ? error.message : String(error) });
    await env.DB.prepare(`UPDATE events SET status = 'needs_attention', updated_at = ? WHERE id = ?`).bind(new Date().toISOString(), eventId).run();
  }
}

export async function GET() {
  const user = await requireUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const state = await getState(user.userId);
  return Response.json({ ...state, user: { displayName: user.displayName, email: user.email } });
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    let rawPayload: unknown;
    try { rawPayload = JSON.parse(String(form.get('payload') ?? '{}')); }
    catch { return Response.json({ error: 'payload: Invalid JSON' }, { status: 400 }); }
    const parsedPayload = capturePayloadSchema.safeParse(rawPayload);
    if (!parsedPayload.success) return validationError(parsedPayload.error);
    const payload = parsedPayload.data;
    const photos = form.getAll('photos').filter((value): value is File => value instanceof File && value.size > 0);
    if (photos.length > 6 || photos.some((photo) => photo.size > 10_000_000 || !photo.type.startsWith('image/'))) return Response.json({ error: 'photos: Upload up to 6 images, 10MB each.' }, { status: 400 });
    const supportedPhotoTypes=new Set(['image/jpeg','image/png','image/webp','image/gif']);
    if(photos.some((photo)=>!supportedPhotoTypes.has(photo.type)))return Response.json({error:'photos: Use JPEG, PNG, WebP, or non-animated GIF images.'},{status:400});
    if (!payload.note && !payload.transcript && !photos.length) return Response.json({ error: 'capture: Add a note, transcript, or photo.' }, { status: 400 });
    if (payload.idempotencyKey) {
      const existing = await env.DB.prepare('SELECT id FROM events WHERE user_id = ? AND idempotency_key = ?').bind(user.userId, payload.idempotencyKey).first<D1Row>();
      if (existing) return Response.json({ ok: true, id: String(existing.id), duplicate: true });
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const occurredAt = payload.occurredAt ?? now;
    const settings = await env.DB.prepare('SELECT timezone FROM goals WHERE user_id = ?').bind(user.userId).first<D1Row>();
    const timezone = String(settings?.timezone ?? DEFAULT_TIMEZONE);
    const localDate = localDateFor(occurredAt, timezone);
    const note = [payload.note, payload.transcript].filter(Boolean).join(' ');
    try {
      await env.DB.prepare(`INSERT INTO events (id,user_id,occurred_at,local_date,meal_type,status,note,idempotency_key,created_at,updated_at,title) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id, user.userId, occurredAt, localDate, payload.mealType ?? 'Meal', 'captured', note, payload.idempotencyKey ?? null, now, now,payload.title??'').run();
    } catch (error) {
      if (!payload.idempotencyKey) throw error;
      const existing = await env.DB.prepare('SELECT id FROM events WHERE user_id = ? AND idempotency_key = ?').bind(user.userId, payload.idempotencyKey).first<D1Row>();
      if (existing) return Response.json({ ok: true, id: String(existing.id), duplicate: true });
      throw error;
    }
    const evidenceStatements = [];
    const visionPhotos:MealImageInput[]=[];
    if (payload.note) evidenceStatements.push(env.DB.prepare(`INSERT INTO evidence (id,event_id,type,transcript,sort_order,created_at) VALUES (?,?,?,?,?,?)`).bind(crypto.randomUUID(), id, 'text', payload.note, 0, now));
    if (payload.transcript) evidenceStatements.push(env.DB.prepare(`INSERT INTO evidence (id,event_id,type,transcript,sort_order,created_at) VALUES (?,?,?,?,?,?)`).bind(crypto.randomUUID(), id, 'voice', payload.transcript, 1, now));
    for (let index = 0; index < photos.length; index += 1) {
      const file = photos[index];
      const key = `${user.userId}/${id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
      const bytes=await file.arrayBuffer();
      await env.FILES.put(key, bytes, { httpMetadata: { contentType: file.type } });
      const view=new Uint8Array(bytes);let binary='';const chunkSize=0x8000;
      for(let offset=0;offset<view.length;offset+=chunkSize)binary+=String.fromCharCode(...view.subarray(offset,offset+chunkSize));
      visionPhotos.push({mimeType:file.type as MealImageInput['mimeType'],base64:btoa(binary)});
      evidenceStatements.push(env.DB.prepare(`INSERT INTO evidence (id,event_id,type,storage_key,filename,mime_type,sort_order,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), id, 'photo', key, file.name, file.type, index + 2, now));
    }
    if (evidenceStatements.length) await env.DB.batch(evidenceStatements);
    const state = await getState(user.userId);
    // Keep the request alive through lookup and estimation; waitUntil work can be
    // terminated 30 seconds after a response, leaving longer meals half-resolved.
    await enrichEvent(id, note, state.library, visionPhotos);
    return Response.json({ ok: true, id, status: 'resolved' }, { status: 201 });
  }

  let rawBody: unknown;
  try { rawBody = await request.json(); }
  catch { return Response.json({ error: 'request: Invalid JSON' }, { status: 400 }); }
  const parsedBody = actionSchema.safeParse(rawBody);
  if (!parsedBody.success) return validationError(parsedBody.error);
  const body = parsedBody.data;
  const action = body.action;
  const ownedEvent = async (eventId: string) => env.DB.prepare('SELECT id FROM events WHERE id = ? AND user_id = ?').bind(eventId, user.userId).first();
  if(action==='rename_event'){
    if(!await ownedEvent(body.eventId))return Response.json({error:'Meal not found'},{status:404});
    await env.DB.prepare('UPDATE events SET title=?,updated_at=? WHERE id=?').bind(body.title,new Date().toISOString(),body.eventId).run();
  } else if(action==='break_item'){
    const row=await env.DB.prepare('SELECT li.*,e.user_id FROM logged_items li JOIN events e ON e.id=li.event_id WHERE li.id=?').bind(body.itemId).first<D1Row>();
    if(row?.user_id!==user.userId)return Response.json({error:'Food not found'},{status:404});
    const evidence=await env.DB.prepare("SELECT storage_key,mime_type FROM evidence WHERE event_id=? AND type='photo' ORDER BY sort_order LIMIT 6").bind(row.event_id).all<D1Row>();
    const photos:MealImageInput[]=[];
    for(const photo of evidence.results){
      const object=photo.storage_key?await env.FILES.get(String(photo.storage_key)):null;
      if(!object)continue;
      const bytes=new Uint8Array(await object.arrayBuffer());let binary='';
      for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
      photos.push({mimeType:String(photo.mime_type) as MealImageInput['mimeType'],base64:btoa(binary)});
    }
    const others=await env.DB.prepare('SELECT name FROM logged_items WHERE event_id=? AND id!=?').bind(row.event_id,body.itemId).all<D1Row>();
    const description=`Break ONLY this target food into its editable ingredients: ${body.quantity} ${body.unit} ${body.name}. Use the photos if supplied to identify its layers, not other foods in the photo. Do not include the complete dish as an item. Additional information: ${body.details||'none'}. Other existing entries, which must not be recreated: ${others.results.map(x=>x.name).join(', ')||'none'}. Include all of the target's own ingredients even when they share names with those other entries. If this is already an indivisible ingredient, return just that ingredient.`;
    let items:FoodItem[];
    try{items=(await interpretedItems(description,[],photos,true)).items;}
    catch{return Response.json({error:'Ingredient interpretation is unavailable right now. Nothing was replaced; please try again.'},{status:503});}
    if(items.length<2||items.some(x=>x.resolutionTier==='unresolved'))return Response.json({error:'Could not confidently break this food into estimated ingredients. Nothing was replaced. Add details and try again.'},{status:422});
    const current=await env.DB.prepare('SELECT * FROM logged_items WHERE id=?').bind(body.itemId).first<D1Row>();
    if(!current||JSON.stringify(mapItem(current))!==JSON.stringify(mapItem(row)))return Response.json({error:'This food changed while processing. Refresh and try again.'},{status:409});
    await env.DB.batch([...itemStatements(String(row.event_id),items,body.itemId),env.DB.prepare('DELETE FROM logged_items WHERE id=?').bind(body.itemId),env.DB.prepare("UPDATE events SET title=CASE WHEN title='' THEN ? ELSE title END WHERE id=?").bind(body.name,row.event_id)]);
    await refreshEventStatus(String(row.event_id));
  } else if(action==='log_library'){
    const state=await getState(user.userId);const saved=state.library.find(x=>x.id===body.itemId);
    if(!saved)return Response.json({error:'Library meal not found'},{status:404});
    const id=crypto.randomUUID(),now=new Date().toISOString();
    const parts=saved.components?.length?libraryComponents(saved):[{...saved,id:crypto.randomUUID(),source:'Personal Library',libraryItemId:saved.id,confidence:1,completeness:.95,resolutionTier:'library' as const}];
    await env.DB.batch([env.DB.prepare('INSERT INTO events (id,user_id,occurred_at,local_date,meal_type,status,note,created_at,updated_at,title) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id,user.userId,body.occurredAt,localDateFor(body.occurredAt,state.timezone),body.mealType,'estimated','',now,now,saved.name),...itemStatements(id,parts)]);
    await refreshEventStatus(id);
    return Response.json({ok:true,id});
  } else if (action === 'verify' && await ownedEvent(String(body.eventId))) {
    await env.DB.prepare(`UPDATE events SET status = 'verified', updated_at = ? WHERE id = ?`).bind(new Date().toISOString(), body.eventId).run();
  } else if (action === 'update_event' && await ownedEvent(String(body.eventId))) {
    const settings = await env.DB.prepare('SELECT timezone FROM goals WHERE user_id = ?').bind(user.userId).first<D1Row>();
    await env.DB.prepare(`UPDATE events SET occurred_at = ?, local_date = ?, meal_type = ?, note = ?, updated_at = ? WHERE id = ?`).bind(body.occurredAt,localDateFor(body.occurredAt,String(settings?.timezone ?? DEFAULT_TIMEZONE)),body.mealType,body.note,new Date().toISOString(),body.eventId).run();
  } else if (action === 'update_item') {
    const item = body.item as FoodItem;
    const row = await env.DB.prepare('SELECT e.user_id,li.event_id FROM logged_items li JOIN events e ON e.id = li.event_id WHERE li.id = ?').bind(item.id).first<D1Row>();
    if (row?.user_id === user.userId) {
      await saveResolvedItem({...item,source:'Manually edited',sourceUrl:'',libraryItemId:null,confidence:1,completeness:(5+[item.iron,item.calcium,item.vitaminC].filter(x=>x!=null).length)/8,resolutionTier:'structured',clarificationQuestion:null});
      await refreshEventStatus(String(row.event_id));
    }
  } else if (action === 'add_item' && await ownedEvent(String(body.eventId))) {
    const item = body.item as FoodItem;
    await insertItems(String(body.eventId), [{ ...item, id: crypto.randomUUID(), source: item.source || 'Manual entry',sourceUrl:item.sourceUrl||'',libraryItemId:item.libraryItemId??null, confidence: item.confidence ?? 1, completeness: item.completeness ?? 1 }]);
    await refreshEventStatus(body.eventId);
  } else if (action === 'add_foods') {
    if(!await ownedEvent(body.eventId))return Response.json({error:'Meal not found'},{status:404});
    const state=await getState(user.userId);
    const {items:additions}=await interpretedItems(body.description,state.library,[]);
    if(!additions.length)return Response.json({error:'No foods found. Try a food name and portion, or add it manually.'},{status:422});
    await insertItems(body.eventId,additions);
    await refreshEventStatus(body.eventId);
  } else if (action === 'estimate_item') {
    const row=await env.DB.prepare('SELECT li.*,e.user_id FROM logged_items li JOIN events e ON e.id=li.event_id WHERE li.id=?').bind(body.itemId).first<D1Row>();
    if(row?.user_id!==user.userId)return Response.json({error:'Food not found'},{status:404});
    const item={...mapItem(row),name:body.name,quantity:body.quantity,unit:body.unit};
    const estimates=await estimateFoods([item],{apiKey:env.OPENAI_API_KEY?.trim(),model:env.OPENAI_VISION_MODEL?.trim()});
    const choices=estimates.get(item.id);
    if(!choices?.length)return Response.json({error:'Could not estimate this food right now. Your existing values are unchanged. Try again or enter values manually.'},{status:503});
    await saveResolvedItem(applyEstimate(item,choices));
    await refreshEventStatus(String(row.event_id));
  } else if (action === 'delete_item') {
    const itemId = String(body.itemId);
    const row = await env.DB.prepare('SELECT e.user_id FROM logged_items li JOIN events e ON e.id = li.event_id WHERE li.id = ?').bind(itemId).first<D1Row>();
    if (row?.user_id === user.userId) await env.DB.prepare('DELETE FROM logged_items WHERE id = ?').bind(itemId).run();
  } else if (action === 'resolve_candidate') {
    const candidate=body.candidate;
    const row=await env.DB.prepare('SELECT li.*,e.user_id FROM logged_items li JOIN events e ON e.id=li.event_id WHERE li.id=?').bind(body.itemId).first<D1Row>();
    if(row?.user_id===user.userId){
      const stored=parseCandidates(row.candidates);
      const selected=stored?.find(option=>option.externalId===candidate.externalId&&option.providerId===candidate.providerId);
      if(!selected)return Response.json({error:'This option is no longer available. Refresh the meal and try again.'},{status:409});
      const nutrients=selected.nutrients;const completeness=(5+[nutrients.iron,nutrients.calcium,nutrients.vitaminC].filter((value)=>value!=null).length)/8;
      await saveResolvedItem({...mapItem(row),...nutrients,name:selected.name,quantity:selected.quantity??1,unit:selected.unit??selected.servingDescription,source:selected.sourceLabel,sourceUrl:selected.sourceUrl,libraryItemId:null,confidence:selected.matchScore,completeness,candidates:stored,resolutionTier:selected.providerId==='estimate'?'estimated':'structured',unresolvedReason:null,clarificationQuestion:selected.assumption??null});
      await refreshEventStatus(String(row.event_id));
    }
  } else if (action === 'delete_event' && await ownedEvent(String(body.eventId))) {
    const ev = await env.DB.prepare('SELECT storage_key FROM evidence WHERE event_id = ?').bind(body.eventId).all<D1Row>();
    for (const file of ev.results) if (file.storage_key) await env.FILES.delete(String(file.storage_key));
    await env.DB.batch([
      env.DB.prepare('DELETE FROM logged_items WHERE event_id = ?').bind(body.eventId),
      env.DB.prepare('DELETE FROM evidence WHERE event_id = ?').bind(body.eventId),
      env.DB.prepare('DELETE FROM events WHERE id = ?').bind(body.eventId),
    ]);
  } else if (action === 'repeat' && await ownedEvent(String(body.eventId))) {
    const source = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(body.eventId).first<D1Row>();
    const sourceItems = await env.DB.prepare('SELECT * FROM logged_items WHERE event_id = ?').bind(body.eventId).all<D1Row>();
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const settings = await env.DB.prepare('SELECT timezone FROM goals WHERE user_id = ?').bind(user.userId).first<D1Row>();
    await env.DB.prepare(`INSERT INTO events (id,user_id,occurred_at,local_date,meal_type,status,note,created_at,updated_at,title) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id,user.userId,now,localDateFor(now,String(settings?.timezone ?? DEFAULT_TIMEZONE)),source?.meal_type ?? 'Meal','estimated',source?.note ?? '',now,now,source?.title??'').run();
    await insertItems(id, sourceItems.results.map((row) => ({ ...mapItem(row), id: crypto.randomUUID() })));
  } else if (action === 'save_library') {
    const item = body.item as LibraryItem; const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO library_items (id,user_id,name,kind,alias,quantity,unit,calories,protein,carbs,fat,fiber,iron,calcium,vitamin_c,serving_grams,servings_per_cooked_cup,source_label,source_url,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),user.userId,item.name,item.kind,item.alias,item.quantity,item.unit,item.calories,item.protein,item.carbs,item.fat,item.fiber,item.iron,item.calcium,item.vitaminC,item.servingGrams ?? null,item.servingsPerCookedCup ?? null,item.sourceLabel ?? '',item.sourceUrl ?? '',now).run();
  } else if (action === 'delete_library') {
    await env.DB.prepare('DELETE FROM library_items WHERE id = ? AND user_id = ?').bind(String(body.itemId),user.userId).run();
  } else if(action==='update_library_from_item'){
    const item=body.item as FoodItem;const libraryItemId=String(body.libraryItemId);
    const group=await env.DB.prepare('SELECT components FROM library_items WHERE id=? AND user_id=?').bind(libraryItemId,user.userId).first<D1Row>();
    if(group?.components)return Response.json({error:'This Library entry is a meal group. Log it, edit its ingredients, then save the whole meal.'},{status:400});
    await env.DB.prepare(`UPDATE library_items SET name=?,quantity=?,unit=?,calories=?,protein=?,carbs=?,fat=?,fiber=?,iron=?,calcium=?,vitamin_c=? WHERE id=? AND user_id=?`).bind(item.name,item.quantity,item.unit,item.calories,item.protein,item.carbs,item.fat,item.fiber,item.iron,item.calcium,item.vitaminC,libraryItemId,user.userId).run();
  } else if (action === 'save_event_to_library' && await ownedEvent(String(body.eventId))) {
    const event = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(body.eventId).first<D1Row>();
    const rows = await env.DB.prepare('SELECT * FROM logged_items WHERE event_id = ?').bind(body.eventId).all<D1Row>();
    const totals = rows.results.map(mapItem).reduce<Nutrients>((sum, item) => ({ calories: sum.calories+item.calories, protein: sum.protein+item.protein, carbs: sum.carbs+item.carbs, fat: sum.fat+item.fat, fiber: sum.fiber+item.fiber, iron: sum.iron==null&&item.iron==null?null:(sum.iron??0)+(item.iron??0), calcium: sum.calcium==null&&item.calcium==null?null:(sum.calcium??0)+(item.calcium??0), vitaminC: sum.vitaminC==null&&item.vitaminC==null?null:(sum.vitaminC??0)+(item.vitaminC??0) }), { calories:0,protein:0,carbs:0,fat:0,fiber:0,iron:null,calcium:null,vitaminC:null });
    if(!rows.results.length)return Response.json({error:'Add ingredients before saving this meal to the Library.'},{status:422});
    const name=mealTitle(body.name||String(event?.title??''),String(event?.note??''),String(event?.meal_type??'Saved'));
    await env.DB.prepare(`INSERT INTO library_items (id,user_id,name,kind,alias,quantity,unit,calories,protein,carbs,fat,fiber,iron,calcium,vitamin_c,serving_grams,servings_per_cooked_cup,source_label,source_url,created_at,components) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),user.userId,name,'meal',name.toLowerCase(),1,'meal',totals.calories,totals.protein,totals.carbs,totals.fat,totals.fiber,totals.iron,totals.calcium,totals.vitaminC,null,null,'Personal meal · saved ingredients','',new Date().toISOString(),JSON.stringify(rows.results.map(mapItem))).run();
    if(body.name?.trim())await env.DB.prepare('UPDATE events SET title=?,updated_at=? WHERE id=?').bind(name,new Date().toISOString(),body.eventId).run();
  } else if (action === 'save_goals') {
    const goals = body.goals;
    const mealTimes = { ...DEFAULT_MEAL_TIMES, ...body.mealTimes };
    const timezone = body.timezone ?? DEFAULT_TIMEZONE;
    await env.DB.prepare(`INSERT INTO goals (user_id,calories,protein,carbs,fat,fiber,breakfast_time,lunch_time,dinner_time,snack_time,timezone,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET calories=excluded.calories,protein=excluded.protein,carbs=excluded.carbs,fat=excluded.fat,fiber=excluded.fiber,breakfast_time=excluded.breakfast_time,lunch_time=excluded.lunch_time,dinner_time=excluded.dinner_time,snack_time=excluded.snack_time,timezone=excluded.timezone,updated_at=excluded.updated_at`).bind(user.userId,goals.calories,goals.protein,goals.carbs,goals.fat,goals.fiber,mealTimes.Breakfast,mealTimes.Lunch,mealTimes.Dinner,mealTimes.Snack,timezone,new Date().toISOString()).run();
  } else if (action === 'delete_all') {
    const files = await env.DB.prepare('SELECT ev.storage_key FROM evidence ev JOIN events e ON e.id = ev.event_id WHERE e.user_id = ? AND ev.storage_key IS NOT NULL').bind(user.userId).all<D1Row>();
    for (const file of files.results) await env.FILES.delete(String(file.storage_key));
    await env.DB.batch([
      env.DB.prepare('DELETE FROM logged_items WHERE event_id IN (SELECT id FROM events WHERE user_id = ?)').bind(user.userId),
      env.DB.prepare('DELETE FROM evidence WHERE event_id IN (SELECT id FROM events WHERE user_id = ?)').bind(user.userId),
      env.DB.prepare('DELETE FROM events WHERE user_id = ?').bind(user.userId),
      env.DB.prepare('DELETE FROM library_items WHERE user_id = ?').bind(user.userId),
      env.DB.prepare('DELETE FROM goals WHERE user_id = ?').bind(user.userId),
    ]);
  } else {
    return Response.json({ error: 'Unsupported action' }, { status: 400 });
  }
  return Response.json({ ok: true });
}
