import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import type { FoodItem, Goals, LibraryItem, Nutrients } from '../../types';

export const dynamic = 'force-dynamic';

type D1Row = Record<string, string | number | null>;

const DEFAULT_GOALS: Goals = { calories: 2100, protein: 115, carbs: 240, fat: 70, fiber: 28 };

const catalog: Array<{ terms: string[]; name: string; quantity: number; unit: string; nutrients: Nutrients }> = [
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
    db.prepare(`CREATE TABLE IF NOT EXISTS logged_items (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL, calories REAL NOT NULL, protein REAL NOT NULL, carbs REAL NOT NULL, fat REAL NOT NULL, fiber REAL NOT NULL, iron REAL, calcium REAL, vitamin_c REAL, source TEXT NOT NULL, confidence REAL NOT NULL, completeness REAL NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS library_items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, alias TEXT NOT NULL DEFAULT '', quantity REAL NOT NULL, unit TEXT NOT NULL, calories REAL NOT NULL, protein REAL NOT NULL, carbs REAL NOT NULL, fat REAL NOT NULL, fiber REAL NOT NULL, iron REAL, calcium REAL, vitamin_c REAL, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS goals (user_id TEXT PRIMARY KEY, calories REAL NOT NULL, protein REAL NOT NULL, carbs REAL NOT NULL, fat REAL NOT NULL, fiber REAL NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_events_user_time ON events(user_id, occurred_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_evidence_event ON evidence(event_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_logged_items_event ON logged_items(event_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_library_user ON library_items(user_id)`),
  ]);
  await db.prepare('PRAGMA optimize').run();
}

function mapItem(row: D1Row): FoodItem {
  return {
    id: String(row.id), name: String(row.name), quantity: Number(row.quantity), unit: String(row.unit),
    calories: Number(row.calories), protein: Number(row.protein), carbs: Number(row.carbs), fat: Number(row.fat), fiber: Number(row.fiber),
    iron: row.iron == null ? null : Number(row.iron), calcium: row.calcium == null ? null : Number(row.calcium), vitaminC: row.vitamin_c == null ? null : Number(row.vitamin_c),
    source: String(row.source), confidence: Number(row.confidence), completeness: Number(row.completeness),
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
  const library = libraryResult.results.map((row): LibraryItem => ({ ...mapItem({ ...row, source: 'personal', confidence: 1, completeness: .95 }), kind: String(row.kind) as LibraryItem['kind'], alias: String(row.alias) }));
  return { events, library, goals: goal ? { calories: Number(goal.calories), protein: Number(goal.protein), carbs: Number(goal.carbs), fat: Number(goal.fat), fiber: Number(goal.fiber) } : DEFAULT_GOALS };
}

function interpretedItems(text: string, library: LibraryItem[], hasPhoto: boolean): FoodItem[] {
  const lower = text.toLowerCase();
  const matches: FoodItem[] = [];
  for (const saved of library) {
    if ([saved.name, saved.alias].filter(Boolean).some((term) => lower.includes(term.toLowerCase()))) {
      matches.push({ ...saved, id: crypto.randomUUID(), source: 'personal library', confidence: .96, completeness: .95 });
    }
  }
  for (const food of catalog) {
    if (food.terms.some((term) => lower.includes(term)) && !matches.some((item) => item.name === food.name)) {
      matches.push({ id: crypto.randomUUID(), name: food.name, quantity: food.quantity, unit: food.unit, ...food.nutrients, source: 'reference estimate', confidence: .78, completeness: .86 });
    }
  }
  if (!matches.length && (text.trim() || hasPhoto)) {
    matches.push({ id: crypto.randomUUID(), name: text.trim() ? 'Meal estimate' : 'Meal from photo', quantity: 1, unit: 'serving', calories: 450, protein: 22, carbs: 48, fat: 19, fiber: 6, iron: null, calcium: null, vitaminC: null, source: 'AI-style estimate', confidence: hasPhoto ? .45 : .55, completeness: .45 });
  }
  return matches;
}

async function insertItems(eventId: string, items: FoodItem[]) {
  if (!items.length) return;
  await env.DB.batch(items.map((item) => env.DB.prepare(`INSERT INTO logged_items (id,event_id,name,quantity,unit,calories,protein,carbs,fat,fiber,iron,calcium,vitamin_c,source,confidence,completeness) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(item.id, eventId, item.name, item.quantity, item.unit, item.calories, item.protein, item.carbs, item.fat, item.fiber, item.iron, item.calcium, item.vitaminC, item.source, item.confidence, item.completeness)));
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
    const items = interpretedItems(note, state.library, photos.length > 0);
    await insertItems(id, items);
    await env.DB.prepare('UPDATE events SET status = ?, updated_at = ? WHERE id = ?').bind(items.length ? 'estimated' : 'needs_attention', new Date().toISOString(), id).run();
    return Response.json({ ok: true, id });
  }

  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action ?? '');
  const ownedEvent = async (eventId: string) => env.DB.prepare('SELECT id FROM events WHERE id = ? AND user_id = ?').bind(eventId, user.userId).first();
  if (action === 'verify' && await ownedEvent(String(body.eventId))) {
    await env.DB.prepare(`UPDATE events SET status = 'verified', updated_at = ? WHERE id = ?`).bind(new Date().toISOString(), body.eventId).run();
  } else if (action === 'update_item') {
    const item = body.item as FoodItem;
    const row = await env.DB.prepare('SELECT e.user_id FROM logged_items li JOIN events e ON e.id = li.event_id WHERE li.id = ?').bind(item.id).first<D1Row>();
    if (row?.user_id === user.userId) await env.DB.prepare(`UPDATE logged_items SET name=?,quantity=?,unit=?,calories=?,protein=?,carbs=?,fat=?,fiber=?,iron=?,calcium=?,vitamin_c=? WHERE id=?`).bind(item.name,item.quantity,item.unit,item.calories,item.protein,item.carbs,item.fat,item.fiber,item.iron,item.calcium,item.vitaminC,item.id).run();
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
    await env.DB.prepare(`INSERT INTO library_items (id,user_id,name,kind,alias,quantity,unit,calories,protein,carbs,fat,fiber,iron,calcium,vitamin_c,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),user.userId,item.name,item.kind,item.alias,item.quantity,item.unit,item.calories,item.protein,item.carbs,item.fat,item.fiber,item.iron,item.calcium,item.vitaminC,now).run();
  } else if (action === 'save_event_to_library' && await ownedEvent(String(body.eventId))) {
    const event = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(body.eventId).first<D1Row>();
    const rows = await env.DB.prepare('SELECT * FROM logged_items WHERE event_id = ?').bind(body.eventId).all<D1Row>();
    const totals = rows.results.map(mapItem).reduce((sum, item) => ({ calories: sum.calories+item.calories, protein: sum.protein+item.protein, carbs: sum.carbs+item.carbs, fat: sum.fat+item.fat, fiber: sum.fiber+item.fiber, iron: (sum.iron??0)+(item.iron??0), calcium: (sum.calcium??0)+(item.calcium??0), vitaminC: (sum.vitaminC??0)+(item.vitaminC??0) }), { calories:0,protein:0,carbs:0,fat:0,fiber:0,iron:0,calcium:0,vitaminC:0 });
    const name = String(body.name ?? event?.note ?? 'Saved meal');
    await env.DB.prepare(`INSERT INTO library_items (id,user_id,name,kind,alias,quantity,unit,calories,protein,carbs,fat,fiber,iron,calcium,vitamin_c,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),user.userId,name,'meal',name.toLowerCase(),1,'meal',totals.calories,totals.protein,totals.carbs,totals.fat,totals.fiber,totals.iron,totals.calcium,totals.vitaminC,new Date().toISOString()).run();
  } else if (action === 'save_goals') {
    const goals = body.goals as Goals;
    await env.DB.prepare(`INSERT INTO goals (user_id,calories,protein,carbs,fat,fiber,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET calories=excluded.calories,protein=excluded.protein,carbs=excluded.carbs,fat=excluded.fat,fiber=excluded.fiber,updated_at=excluded.updated_at`).bind(user.userId,goals.calories,goals.protein,goals.carbs,goals.fat,goals.fiber,new Date().toISOString()).run();
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
