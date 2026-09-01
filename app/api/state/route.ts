import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import type { FoodItem, Goals, LibraryItem, MealTimes, Nutrients } from '../../types';
import { researchFoods } from '../../food-research';

export const dynamic = 'force-dynamic';

type D1Row = Record<string, string | number | null>;

const DEFAULT_GOALS: Goals = { calories: 2100, protein: 115, carbs: 240, fat: 70, fiber: 28 };
const DEFAULT_MEAL_TIMES: MealTimes = { Breakfast:'08:00', Lunch:'12:30', Dinner:'18:30', Snack:'15:30' };

const catalog: Array<{ terms: string[]; name: string; quantity: number; unit: string; nutrients: Nutrients; exact?:boolean; sourceLabel?:string; sourceUrl?:string }> = [
  { terms:['rx bar','rxbar'], exact:true, name:'RXBAR protein bar', quantity:1, unit:'bar', nutrients:{calories:210.08,protein:12.012,carbs:24.024,fat:8.996,fiber:4.992,iron:2.002,calcium:49.92,vitaminC:null}, sourceLabel:'USDA FoodData Central · Branded', sourceUrl:'https://fdc.nal.usda.gov/fdc-app.html#/food-details/2599185/nutrients' },
  { terms: ['oatmeal', 'oats'], name: 'Rolled oats', quantity: .5, unit: 'cup dry', nutrients: { calories: 150, protein: 5, carbs: 27, fat: 3, fiber: 4, iron: 1.7, calcium: 20, vitaminC: 0 } },
  { terms: ['banana'], name: 'Banana', quantity: 1, unit: 'medium', nutrients: { calories: 105, protein: 1.3, carbs: 27, fat: .4, fiber: 3.1, iron: .3, calcium: 6, vitaminC: 10.3 } },
  { terms: ['almond butter'], name: 'Almond butter', quantity: 1, unit: 'tbsp', nutrients: { calories: 98, protein: 3.4, carbs: 3, fat: 9, fiber: 1.6, iron: .6, calcium: 56, vitaminC: 0 } },
  { terms: ['orgain', 'protein powder', 'protein scoop'], name: 'Vanilla protein powder', quantity: 1, unit: 'scoop', nutrients: { calories: 150, protein: 21, carbs: 15, fat: 4, fiber: 2, iron: 4.5, calcium: 50, vitaminC: 0 } },
  { terms: ['egg', 'eggs'], name: 'Eggs', quantity: 2, unit: 'large', nutrients: { calories: 144, protein: 12.6, carbs: .7, fat: 9.5, fiber: 0, iron: 1.8, calcium: 56, vitaminC: 0 } },
  { terms: ['toast', 'bread'], name: 'Whole-grain toast', quantity: 1, unit: 'slice', nutrients: { calories: 100, protein: 4, carbs: 18, fat: 1.5, fiber: 3, iron: 1.1, calcium: 40, vitaminC: 0 } },
  { terms: ['yogurt'], name: 'Greek yogurt', quantity: 1, unit: 'cup', nutrients: { calories: 130, protein: 23, carbs: 9, fat: 0, fiber: 0, iron: .2, calcium: 250, vitaminC: 0 } },
  { terms: ['chicken'], name: 'Roasted chicken breast', quantity: 4, unit: 'oz', nutrients: { calories: 187, protein: 35, carbs: 0, fat: 4, fiber: 0, iron: 1.1, calcium: 17, vitaminC: 0 } },
  { terms: ['rice'], name: 'Cooked brown rice', quantity: 1, unit: 'cup', nutrients: { calories: 216, protein: 5, carbs: 45, fat: 1.8, fiber: 3.5, iron: .8, calcium: 20, vitaminC: 0 } },
  { terms: ['salad'], name: 'Mixed salad with dressing', quantity: 2, unit: 'cups', nutrients: { calories: 210, protein: 5, carbs: 16, fat: 14, fiber: 6, iron: 2.2, calcium: 90, vitaminC: 32 } },
  { terms: ['salmon'], name: 'Baked salmon', quantity: 5, unit: 'oz', nutrients: { calories: 295, protein: 31, carbs: 0, fat: 18, fiber: 0, iron: .7, calcium: 18, vitaminC: 0 } },
  { terms: ['coffee'], name: 'Coffee with milk', quantity: 1, unit: 'cup', nutrients: { calories: 35, protein: 2, carbs: 3, fat: 1.5, fiber: 0, iron: 0, calcium: 75, vitaminC: 0 } },
  { terms: ['parmesan cheese', 'parmesan'], name: 'Parmesan cheese', quantity: 1, unit: 'sprinkle', nutrients: { calories: 22, protein: 2, carbs: .2, fat: 1.4, fiber: 0, iron: 0, calcium: 65, vitaminC: 0 } },
];

async function identity() {
  const user = await getChatGPTUser();
  if (user) return user;
  if (process.env.NODE_ENV !== 'production') return { userId: 'local-single-user', displayName: 'Food journal', email: 'local@mise.app', fullName: null };
  return null;
}

async function initDb() {
  const db = env.DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, occurred_at TEXT NOT NULL, meal_type TEXT NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, type TEXT NOT NULL, storage_key TEXT, filename TEXT, mime_type TEXT, transcript TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS logged_items (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL, calories REAL NOT NULL, protein REAL NOT NULL, carbs REAL NOT NULL, fat REAL NOT NULL, fiber REAL NOT NULL, iron REAL, calcium REAL, vitamin_c REAL, source TEXT NOT NULL, source_url TEXT NOT NULL DEFAULT '', library_item_id TEXT, confidence REAL NOT NULL, completeness REAL NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS library_items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, alias TEXT NOT NULL DEFAULT '', quantity REAL NOT NULL, unit TEXT NOT NULL, calories REAL NOT NULL, protein REAL NOT NULL, carbs REAL NOT NULL, fat REAL NOT NULL, fiber REAL NOT NULL, iron REAL, calcium REAL, vitamin_c REAL, serving_grams REAL, servings_per_cooked_cup REAL, source_label TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS goals (user_id TEXT PRIMARY KEY, calories REAL NOT NULL, protein REAL NOT NULL, carbs REAL NOT NULL, fat REAL NOT NULL, fiber REAL NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_events_user_time ON events(user_id, occurred_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_evidence_event ON evidence(event_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_logged_items_event ON logged_items(event_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_library_user ON library_items(user_id)`),
  ]);
  const libraryColumns = await db.prepare('PRAGMA table_info(library_items)').all<D1Row>();
  const columnNames = new Set(libraryColumns.results.map((column) => String(column.name)));
  const missingColumns = [
    ['serving_grams', 'REAL'],
    ['servings_per_cooked_cup', 'REAL'],
    ['source_label', "TEXT NOT NULL DEFAULT ''"],
    ['source_url', "TEXT NOT NULL DEFAULT ''"],
  ].filter(([name]) => !columnNames.has(name));
  if (missingColumns.length) await db.batch(missingColumns.map(([name, definition]) => db.prepare(`ALTER TABLE library_items ADD COLUMN ${name} ${definition}`)));
  const loggedColumns=await db.prepare('PRAGMA table_info(logged_items)').all<D1Row>();
  const loggedNames=new Set(loggedColumns.results.map((column)=>String(column.name)));
  const missingLogged=[['source_url',"TEXT NOT NULL DEFAULT ''"],['library_item_id','TEXT']].filter(([name])=>!loggedNames.has(name));
  if(missingLogged.length)await db.batch(missingLogged.map(([name,definition])=>db.prepare(`ALTER TABLE logged_items ADD COLUMN ${name} ${definition}`)));
  const goalColumns=await db.prepare('PRAGMA table_info(goals)').all<D1Row>();
  const goalNames=new Set(goalColumns.results.map((column)=>String(column.name)));
  const missingGoals=[['breakfast_time',"TEXT NOT NULL DEFAULT '08:00'"],['lunch_time',"TEXT NOT NULL DEFAULT '12:30'"],['dinner_time',"TEXT NOT NULL DEFAULT '18:30'"],['snack_time',"TEXT NOT NULL DEFAULT '15:30'"]].filter(([name])=>!goalNames.has(name));
  if(missingGoals.length)await db.batch(missingGoals.map(([name,definition])=>db.prepare(`ALTER TABLE goals ADD COLUMN ${name} ${definition}`)));
  await db.prepare('PRAGMA optimize').run();
}

function mapItem(row: D1Row): FoodItem {
  const legacySource=String(row.source);const source=legacySource==='personal library'?'Personal Library':legacySource==='reference estimate'?'Built-in reference':legacySource==='item estimate'||legacySource==='AI-style estimate'?'Legacy estimate · review':legacySource==='manual'?'Manual entry':legacySource;
  return {
    id: String(row.id), name: String(row.name), quantity: Number(row.quantity), unit: String(row.unit),
    calories: Number(row.calories), protein: Number(row.protein), carbs: Number(row.carbs), fat: Number(row.fat), fiber: Number(row.fiber),
    iron: row.iron == null ? null : Number(row.iron), calcium: row.calcium == null ? null : Number(row.calcium), vitaminC: row.vitamin_c == null ? null : Number(row.vitamin_c),
    source, sourceUrl:String(row.source_url??''), libraryItemId:row.library_item_id==null?null:String(row.library_item_id), confidence: Number(row.confidence), completeness: Number(row.completeness),
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
  const events = eventsResult.results.map((event) => ({
    id: String(event.id), occurredAt: String(event.occurred_at), mealType: String(event.meal_type), status: String(event.status), note: String(event.note), createdAt: String(event.created_at),
    items: itemsResult.results.filter((item) => item.event_id === event.id).map(mapItem),
    evidence: evidenceResult.results.filter((item) => item.event_id === event.id).map((item) => ({ id: String(item.id), type: String(item.type), transcript: item.transcript == null ? null : String(item.transcript), filename: item.filename == null ? null : String(item.filename), url: item.storage_key ? `/api/files?key=${encodeURIComponent(String(item.storage_key))}` : null })),
  }));
  const library = libraryResult.results.map((row): LibraryItem => ({ ...mapItem({ ...row, source: 'personal', confidence: 1, completeness: .95 }), kind: String(row.kind) as LibraryItem['kind'], alias: String(row.alias), servingGrams: row.serving_grams == null ? null : Number(row.serving_grams), servingsPerCookedCup: row.servings_per_cooked_cup == null ? null : Number(row.servings_per_cooked_cup), sourceLabel: String(row.source_label ?? ''), sourceUrl: String(row.source_url ?? '') }));
  return { events, library, goals: goal ? { calories: Number(goal.calories), protein: Number(goal.protein), carbs: Number(goal.carbs), fat: Number(goal.fat), fiber: Number(goal.fiber) } : DEFAULT_GOALS, mealTimes:goal?{Breakfast:String(goal.breakfast_time??DEFAULT_MEAL_TIMES.Breakfast),Lunch:String(goal.lunch_time??DEFAULT_MEAL_TIMES.Lunch),Dinner:String(goal.dinner_time??DEFAULT_MEAL_TIMES.Dinner),Snack:String(goal.snack_time??DEFAULT_MEAL_TIMES.Snack)}:DEFAULT_MEAL_TIMES };
}

function splitFoodList(text: string) {
  return text
    .replace(/^\s*[*•-]\s*/, '')
    .split(/\s*(?:,|;|\n)\s*|\s+and\s+(?=(?:\d+(?:\.\d+)?|\d+\/\d+|a\b|an\b|one\b|two\b|half\b|sprinkle\b|dash\b|handful\b))/i)
    .map((part) => part.replace(/^\s*(?:and|plus)\s+/i, '').trim())
    .filter(Boolean);
}

function parsedAmount(segment: string, fallbackQuantity: number, fallbackUnit: string, conversion?: Pick<LibraryItem,'servingGrams'|'servingsPerCookedCup'>) {
  const numberWords: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, half: .5 };
  const match = segment.match(/^\s*(\d+\/\d+|\d+(?:\.\d+)?|a|an|one|two|half)\s*(cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|grams?|g|scoops?|slices?|large|medium|small|servings?)?\b/i);
  if (!match) {
    if (/^\s*sprinkle\b/i.test(segment)) return { quantity: 1, unit: 'sprinkle', scale: fallbackUnit === 'sprinkle' ? 1 : .25 };
    return { quantity: fallbackQuantity, unit: fallbackUnit, scale: 1 };
  }
  const raw = match[1].toLowerCase();
  const quantity = raw.includes('/') ? Number(raw.split('/')[0]) / Number(raw.split('/')[1]) : (numberWords[raw] ?? Number(raw));
  const unit = match[2]?.toLowerCase().replace(/tablespoons?/, 'tbsp').replace(/teaspoons?/, 'tsp').replace(/ounces?/, 'oz') ?? fallbackUnit;
  if (/^cups?$/.test(unit) && /\bcooked\b/i.test(segment) && conversion?.servingsPerCookedCup) return { quantity, unit: 'cup cooked', scale: quantity * conversion.servingsPerCookedCup };
  if (/^(?:g|grams?)$/.test(unit) && conversion?.servingGrams) return { quantity, unit: 'g', scale: quantity / conversion.servingGrams };
  if (unit === 'oz' && conversion?.servingGrams) return { quantity, unit: 'oz', scale: quantity * 28.3495 / conversion.servingGrams };
  const compatible = unit.replace(/s$/, '') === fallbackUnit.replace(/s$/, '');
  return { quantity, unit, scale: compatible ? quantity / fallbackQuantity : 1 };
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
    .replace(/^\s*(?:\d+\/\d+|\d+(?:\.\d+)?|a|an|one|two|half)\s*/i, '')
    .replace(/^(?:cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|grams?|g|scoops?|slices?|large|medium|small|servings?)\s+(?:of\s+)?/i, '')
    .replace(/^(?:sprinkle|dash|handful)\s+(?:of\s+)?/i, '')
    .trim();
  return name ? name[0].toUpperCase() + name.slice(1) : 'Food item';
}

async function interpretedItems(text: string, library: LibraryItem[], hasPhoto: boolean): Promise<FoodItem[]> {
  const segments = splitFoodList(text);
  const runtime=env as unknown as Record<string,unknown>;const apiKey=String(runtime.USDA_API_KEY||'DEMO_KEY');
  const items = await Promise.all(segments.map(async(segment): Promise<FoodItem> => {
    const lower = segment.toLowerCase();
    const saved = library.map((item) => ({ item, match: [item.name, ...item.alias.split(',')].map((term)=>term.trim()).filter(Boolean).filter((term) => lower.includes(term.toLowerCase())).sort((a,b)=>b.length-a.length)[0] ?? '' })).filter(({match})=>match).sort((a,b)=>b.match.length-a.match.length)[0]?.item;
    if (saved) {
      const amount = parsedAmount(segment, saved.quantity, saved.unit, saved);
      return { ...saved, id: crypto.randomUUID(), quantity: amount.quantity, unit: amount.unit, ...scaleNutrients(saved, amount.scale), source: 'Personal Library', sourceUrl:saved.sourceUrl, libraryItemId:saved.id, confidence: 1, completeness: .95 };
    }
    const normalizedQuery=cleanFoodName(segment).toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
    const food = catalog.find((item) => item.terms.some((term) => item.exact?normalizedQuery===term:lower.includes(term)));
    if (food) {
      const amount = parsedAmount(segment, food.quantity, food.unit);
      return { id: crypto.randomUUID(), name: food.name, quantity: amount.quantity, unit: amount.unit, ...scaleNutrients(food.nutrients, amount.scale), source: food.sourceLabel??'Built-in reference', sourceUrl:food.sourceUrl??'', libraryItemId:null, confidence: 1, completeness: .86 };
    }
    const query=cleanFoodName(segment);
    try{const branded=await researchFoods(query,apiKey,true,3);let result=branded.results.find((candidate)=>candidate.matchScore>=6&&candidate.calories>0);if(!result){const general=await researchFoods(query,apiKey,false,3);result=general.results.find((candidate)=>candidate.matchScore>=6&&candidate.calories>0);}if(result){const amount=parsedAmount(segment,1,result.serving,{servingGrams:result.servingGrams,servingsPerCookedCup:result.servingsPerCookedCup});const known=5+[result.iron,result.calcium,result.vitaminC].filter((value)=>value!=null).length;return{id:crypto.randomUUID(),name:result.name,quantity:amount.quantity,unit:amount.unit,...scaleNutrients(result,amount.scale),source:result.sourceLabel,sourceUrl:result.sourceUrl,libraryItemId:null,confidence:1,completeness:known/8};}}
    catch{/* Preserve the entry for review instead of inventing nutrition values. */}
    const amount=parsedAmount(segment,1,'serving');
    return{id:crypto.randomUUID(),name:query,quantity:amount.quantity,unit:amount.unit,calories:0,protein:0,carbs:0,fat:0,fiber:0,iron:null,calcium:null,vitaminC:null,source:'Needs research',sourceUrl:'',libraryItemId:null,confidence:0,completeness:0};
  }));
  if (!items.length && hasPhoto) items.push({ id: crypto.randomUUID(), name: 'Meal from photo', quantity: 1, unit: 'serving', calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, iron: null, calcium: null, vitaminC: null, source: 'Photo evidence · needs review', sourceUrl:'', libraryItemId:null, confidence: 0, completeness: 0 });
  return items;
}

async function insertItems(eventId: string, items: FoodItem[]) {
  if (!items.length) return;
  await env.DB.batch(items.map((item) => env.DB.prepare(`INSERT INTO logged_items (id,event_id,name,quantity,unit,calories,protein,carbs,fat,fiber,iron,calcium,vitamin_c,source,source_url,library_item_id,confidence,completeness) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(item.id, eventId, item.name, item.quantity, item.unit, item.calories, item.protein, item.carbs, item.fat, item.fiber, item.iron, item.calcium, item.vitaminC, item.source,item.sourceUrl??'',item.libraryItemId??null,item.confidence,item.completeness)));
}

export async function GET() {
  await initDb();
  const user = await identity();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const state = await getState(user.userId);
  return Response.json({ ...state, user: { displayName: user.displayName, email: user.email } });
}

export async function POST(request: Request) {
  await initDb();
  const user = await identity();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const payload = JSON.parse(String(form.get('payload') ?? '{}')) as { note?: string; transcript?: string; occurredAt?: string; mealType?: string };
    const photos = form.getAll('photos').filter((value): value is File => value instanceof File && value.size > 0);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const note = [payload.note, payload.transcript].filter(Boolean).join(' ');
    await env.DB.prepare(`INSERT INTO events (id,user_id,occurred_at,meal_type,status,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).bind(id, user.userId, payload.occurredAt ?? now, payload.mealType ?? 'Meal', 'captured', note, now, now).run();
    const evidenceStatements = [];
    if (payload.note) evidenceStatements.push(env.DB.prepare(`INSERT INTO evidence (id,event_id,type,transcript,sort_order,created_at) VALUES (?,?,?,?,?,?)`).bind(crypto.randomUUID(), id, 'text', payload.note, 0, now));
    if (payload.transcript) evidenceStatements.push(env.DB.prepare(`INSERT INTO evidence (id,event_id,type,transcript,sort_order,created_at) VALUES (?,?,?,?,?,?)`).bind(crypto.randomUUID(), id, 'voice', payload.transcript, 1, now));
    for (let index = 0; index < photos.length; index += 1) {
      const file = photos[index];
      const key = `${user.userId}/${id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
      await env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
      evidenceStatements.push(env.DB.prepare(`INSERT INTO evidence (id,event_id,type,storage_key,filename,mime_type,sort_order,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), id, 'photo', key, file.name, file.type, index + 2, now));
    }
    if (evidenceStatements.length) await env.DB.batch(evidenceStatements);
    const state = await getState(user.userId);
    const items = await interpretedItems(note, state.library, photos.length > 0);
    await insertItems(id, items);
    await env.DB.prepare('UPDATE events SET status = ?, updated_at = ? WHERE id = ?').bind(items.some((item)=>item.source.includes('needs')||item.source==='Needs research') ? 'needs_attention' : 'estimated', new Date().toISOString(), id).run();
    return Response.json({ ok: true, id });
  }

  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action ?? '');
  const ownedEvent = async (eventId: string) => env.DB.prepare('SELECT id FROM events WHERE id = ? AND user_id = ?').bind(eventId, user.userId).first();
  if (action === 'verify' && await ownedEvent(String(body.eventId))) {
    await env.DB.prepare(`UPDATE events SET status = 'verified', updated_at = ? WHERE id = ?`).bind(new Date().toISOString(), body.eventId).run();
  } else if (action === 'update_event' && await ownedEvent(String(body.eventId))) {
    await env.DB.prepare(`UPDATE events SET occurred_at = ?, meal_type = ?, note = ?, updated_at = ? WHERE id = ?`).bind(String(body.occurredAt),String(body.mealType),String(body.note ?? ''),new Date().toISOString(),body.eventId).run();
  } else if (action === 'update_item') {
    const item = body.item as FoodItem;
    const row = await env.DB.prepare('SELECT e.user_id FROM logged_items li JOIN events e ON e.id = li.event_id WHERE li.id = ?').bind(item.id).first<D1Row>();
    if (row?.user_id === user.userId) await env.DB.prepare(`UPDATE logged_items SET name=?,quantity=?,unit=?,calories=?,protein=?,carbs=?,fat=?,fiber=?,iron=?,calcium=?,vitamin_c=? WHERE id=?`).bind(item.name,item.quantity,item.unit,item.calories,item.protein,item.carbs,item.fat,item.fiber,item.iron,item.calcium,item.vitaminC,item.id).run();
  } else if (action === 'add_item' && await ownedEvent(String(body.eventId))) {
    const item = body.item as FoodItem;
    await insertItems(String(body.eventId), [{ ...item, id: crypto.randomUUID(), source: item.source || 'Manual entry',sourceUrl:item.sourceUrl||'',libraryItemId:item.libraryItemId??null, confidence: item.confidence ?? 1, completeness: item.completeness ?? 1 }]);
  } else if (action === 'delete_item') {
    const itemId = String(body.itemId);
    const row = await env.DB.prepare('SELECT e.user_id FROM logged_items li JOIN events e ON e.id = li.event_id WHERE li.id = ?').bind(itemId).first<D1Row>();
    if (row?.user_id === user.userId) await env.DB.prepare('DELETE FROM logged_items WHERE id = ?').bind(itemId).run();
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
    await env.DB.prepare(`INSERT INTO events (id,user_id,occurred_at,meal_type,status,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).bind(id,user.userId,now,source?.meal_type ?? 'Meal','verified',source?.note ?? '',now,now).run();
    await insertItems(id, sourceItems.results.map((row) => ({ ...mapItem(row), id: crypto.randomUUID() })));
  } else if (action === 'save_library') {
    const item = body.item as LibraryItem; const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO library_items (id,user_id,name,kind,alias,quantity,unit,calories,protein,carbs,fat,fiber,iron,calcium,vitamin_c,serving_grams,servings_per_cooked_cup,source_label,source_url,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),user.userId,item.name,item.kind,item.alias,item.quantity,item.unit,item.calories,item.protein,item.carbs,item.fat,item.fiber,item.iron,item.calcium,item.vitaminC,item.servingGrams ?? null,item.servingsPerCookedCup ?? null,item.sourceLabel ?? '',item.sourceUrl ?? '',now).run();
  } else if (action === 'delete_library') {
    await env.DB.prepare('DELETE FROM library_items WHERE id = ? AND user_id = ?').bind(String(body.itemId),user.userId).run();
  } else if(action==='update_library_from_item'){
    const item=body.item as FoodItem;const libraryItemId=String(body.libraryItemId);
    await env.DB.prepare(`UPDATE library_items SET name=?,quantity=?,unit=?,calories=?,protein=?,carbs=?,fat=?,fiber=?,iron=?,calcium=?,vitamin_c=? WHERE id=? AND user_id=?`).bind(item.name,item.quantity,item.unit,item.calories,item.protein,item.carbs,item.fat,item.fiber,item.iron,item.calcium,item.vitaminC,libraryItemId,user.userId).run();
  } else if (action === 'save_event_to_library' && await ownedEvent(String(body.eventId))) {
    const event = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(body.eventId).first<D1Row>();
    const rows = await env.DB.prepare('SELECT * FROM logged_items WHERE event_id = ?').bind(body.eventId).all<D1Row>();
    const totals = rows.results.map(mapItem).reduce((sum, item) => ({ calories: sum.calories+item.calories, protein: sum.protein+item.protein, carbs: sum.carbs+item.carbs, fat: sum.fat+item.fat, fiber: sum.fiber+item.fiber, iron: (sum.iron??0)+(item.iron??0), calcium: (sum.calcium??0)+(item.calcium??0), vitaminC: (sum.vitaminC??0)+(item.vitaminC??0) }), { calories:0,protein:0,carbs:0,fat:0,fiber:0,iron:0,calcium:0,vitaminC:0 });
    const name = String(body.name ?? event?.note ?? 'Saved meal');
    await env.DB.prepare(`INSERT INTO library_items (id,user_id,name,kind,alias,quantity,unit,calories,protein,carbs,fat,fiber,iron,calcium,vitamin_c,serving_grams,servings_per_cooked_cup,source_label,source_url,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),user.userId,name,'meal',name.toLowerCase(),1,'meal',totals.calories,totals.protein,totals.carbs,totals.fat,totals.fiber,totals.iron,totals.calcium,totals.vitaminC,null,null,'Personal meal','',new Date().toISOString()).run();
  } else if (action === 'save_goals') {
    const goals = body.goals as Goals;
    const mealTimes = { ...DEFAULT_MEAL_TIMES, ...(body.mealTimes as Partial<MealTimes>|undefined) };
    await env.DB.prepare(`INSERT INTO goals (user_id,calories,protein,carbs,fat,fiber,breakfast_time,lunch_time,dinner_time,snack_time,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET calories=excluded.calories,protein=excluded.protein,carbs=excluded.carbs,fat=excluded.fat,fiber=excluded.fiber,breakfast_time=excluded.breakfast_time,lunch_time=excluded.lunch_time,dinner_time=excluded.dinner_time,snack_time=excluded.snack_time,updated_at=excluded.updated_at`).bind(user.userId,goals.calories,goals.protein,goals.carbs,goals.fat,goals.fiber,mealTimes.Breakfast,mealTimes.Lunch,mealTimes.Dinner,mealTimes.Snack,new Date().toISOString()).run();
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
