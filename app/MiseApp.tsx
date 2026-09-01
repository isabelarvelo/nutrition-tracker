'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, EatingEvent, FoodItem, Goals, LibraryItem, MealTimes, Nutrients } from './types';
import { emptyNutrients } from './types';

type View = 'today' | 'review' | 'trends' | 'library';
type FoodResearchResult = Nutrients & { id:string;name:string;brand:string;description:string;serving:string;servingGrams:number|null;servingsPerCookedCup:number|null;sourceLabel:string;sourceUrl:string };
const initial: AppState = { events: [], library: [], goals: { calories: 2100, protein: 115, carbs: 240, fat: 70, fiber: 28 }, mealTimes:{ Breakfast:'08:00', Lunch:'12:30', Dinner:'18:30', Snack:'15:30' }, user: { displayName: 'Food journal', email: '' } };
const nutrientKeys: Array<keyof Pick<Nutrients, 'calories'|'protein'|'carbs'|'fat'|'fiber'>> = ['calories','protein','carbs','fat','fiber'];

function dayKey(value: string) { return new Date(value).toLocaleDateString('en-CA'); }
function todayKey() { return new Date().toLocaleDateString('en-CA'); }
function localDateTimeValue(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function captureTimeForDay(day: string, time:string) { return `${day}T${time}`; }
function sumItems(items: FoodItem[]): Nutrients {
  return items.reduce((sum, item) => ({
    calories: sum.calories + item.calories, protein: sum.protein + item.protein, carbs: sum.carbs + item.carbs,
    fat: sum.fat + item.fat, fiber: sum.fiber + item.fiber,
    iron: (sum.iron ?? 0) + (item.iron ?? 0), calcium: (sum.calcium ?? 0) + (item.calcium ?? 0), vitaminC: (sum.vitaminC ?? 0) + (item.vitaminC ?? 0),
  }), { ...emptyNutrients, iron: 0, calcium: 0, vitaminC: 0 });
}
function eventTotals(event: EatingEvent) { return sumItems(event.items); }
function round(value: number) { return Math.round(value); }
function statusLabel(status: EatingEvent['status']) { return status === 'needs_attention' ? 'Needs attention' : status[0].toUpperCase() + status.slice(1); }
function libraryDraftFromFood(item:FoodItem):LibraryItem { const gramMatch=item.unit.match(/([\d.]+)\s*g\b/i);return{id:'',name:item.name,kind:'food',alias:item.name.toLowerCase(),quantity:item.quantity,unit:item.unit,calories:item.calories,protein:item.protein,carbs:item.carbs,fat:item.fat,fiber:item.fiber,iron:item.iron,calcium:item.calcium,vitaminC:item.vitaminC,servingGrams:gramMatch?Number(gramMatch[1]):null,servingsPerCookedCup:/\bpasta\b/i.test(item.name)?1:null,sourceLabel:item.source,sourceUrl:item.sourceUrl}; }

export default function MiseApp() {
  const [state, setState] = useState(initial);
  const [view, setView] = useState<View>('today');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [note, setNote] = useState('');
  const [transcript, setTranscript] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [mealType, setMealType] = useState('Breakfast');
  const [captureDate, setCaptureDate] = useState(() => localDateTimeValue(new Date()));
  const [selectedDay, setSelectedDay] = useState(todayKey());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [listening, setListening] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load journal');
      setState(await response.json());
    } catch { setToast('Could not load your journal. Please refresh.'); }
    finally { setLoading(false); }
  }, []);
  // The initial server-backed journal load intentionally hydrates client state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3200); return () => clearTimeout(timer); }, [toast]);

  const selectedEvents = useMemo(() => state.events.filter((event) => dayKey(event.occurredAt) === selectedDay), [state.events, selectedDay]);
  const selectedTotals = useMemo(() => sumItems(selectedEvents.flatMap((event) => event.items)), [selectedEvents]);
  const reviewEvents = state.events.filter((event) => event.status !== 'verified');
  const verifiedCalories = selectedEvents.filter((event) => event.status === 'verified').reduce((sum, event) => sum + eventTotals(event).calories, 0);
  const coverage = selectedTotals.calories ? Math.round((verifiedCalories / selectedTotals.calories) * 100) : 0;

  async function action(body: Record<string, unknown>, success?: string) {
    setSaving(true);
    try {
      const response = await fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error();
      await load(); if (success) setToast(success);
    } catch { setToast('That did not save. Please try again.'); }
    finally { setSaving(false); }
  }

  async function capture(reviewNow: boolean) {
    if (!note.trim() && !transcript.trim() && !photos.length) { setToast('Add a note, voice description, or photo first.'); return; }
    setSaving(true);
    const form = new FormData();
    form.set('payload', JSON.stringify({ note, transcript, mealType, occurredAt: new Date(captureDate).toISOString() }));
    photos.forEach((photo) => form.append('photos', photo));
    try {
      const response = await fetch('/api/state', { method: 'POST', body: form });
      if (!response.ok) throw new Error();
      const result = await response.json();
      setNote(''); setTranscript(''); setPhotos([]); setCaptureOpen(false);
      await load();
      if (reviewNow) { setView('review'); setExpanded(result.id); }
      setToast(reviewNow ? 'Estimate ready to review.' : 'Meal captured. You can move on.');
    } catch { setToast('Capture failed. Your draft is still here.'); }
    finally { setSaving(false); }
  }

  function startVoice() {
    const SpeechRecognition = (window as unknown as { webkitSpeechRecognition?: new () => { continuous: boolean; interimResults: boolean; lang: string; onresult: (event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void; onend: () => void; start: () => void } }).webkitSpeechRecognition;
    if (!SpeechRecognition) { setToast('Voice transcription is not supported in this browser. You can type instead.'); return; }
    const recognition = new SpeechRecognition(); recognition.continuous = false; recognition.interimResults = false; recognition.lang = 'en-US';
    recognition.onresult = (event) => setTranscript(Array.from(event.results).map((result) => result[0].transcript).join(' '));
    recognition.onend = () => setListening(false); setListening(true); recognition.start();
  }

  function openCapture(day = selectedDay) {
    setCaptureDate(captureTimeForDay(day,state.mealTimes[mealType as keyof MealTimes]));
    setCaptureOpen(true);
  }

  function selectMealType(type:keyof MealTimes) {
    setMealType(type);
    setCaptureDate(captureTimeForDay(captureDate.slice(0,10)||selectedDay,state.mealTimes[type]));
  }

  function exportData() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `mise-export-${todayKey()}.json`; link.click(); URL.revokeObjectURL(url);
  }

  if (loading) return <div className="loading"><div className="brand-mark">M</div><p>Setting the table…</p></div>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView('today')} aria-label="Go to today"><span className="brand-mark">M</span><span><b>Mise</b><small>your food, in context</small></span></button>
        <div className="top-actions"><span className="user-pill">{state.user.displayName.split(' ')[0]}</span><button className="icon-button" onClick={exportData} title="Export your data">⇩</button></div>
      </header>

      <div className="desktop-grid">
        <nav className="side-nav" aria-label="Primary navigation">
          <div className="nav-date"><strong>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong><span>{new Date().toLocaleDateString('en-US', { weekday: 'long' })}</span></div>
          {([['today','Journal','⌂'],['review','Review','◌'],['trends','Profile','↗'],['library','Library','◇']] as const).map(([id,label,icon]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><span>{icon}</span>{label}{id === 'review' && reviewEvents.length > 0 && <em>{reviewEvents.length}</em>}</button>)}
          <div className="side-note"><span>Private by design</span><p>Your photos and food records are only available to you.</p></div>
        </nav>

        <section className="main-content">
          {view === 'today' && <TodayView events={selectedEvents} library={state.library} totals={selectedTotals} goals={state.goals} coverage={coverage} selectedDay={selectedDay} setSelectedDay={setSelectedDay} expanded={expanded} setExpanded={setExpanded} action={action} onCapture={() => openCapture()} saving={saving} />}
          {view === 'review' && <ReviewView events={reviewEvents} library={state.library} expanded={expanded} setExpanded={setExpanded} action={action} saving={saving} />}
          {view === 'trends' && <TrendsView events={state.events} goals={state.goals} mealTimes={state.mealTimes} onSave={(goals,mealTimes) => action({ action: 'save_goals', goals, mealTimes }, 'Profile updated.')} onDeleteAll={() => { if (window.confirm('Permanently delete every meal, photo, saved food, and goal? This cannot be undone.')) action({ action:'delete_all' }, 'All food-tracking data was deleted.'); }} />}
          {view === 'library' && <LibraryView items={state.library} onSave={(item) => action({ action: 'save_library', item }, 'Added to your library.')} onDelete={(itemId)=>action({action:'delete_library',itemId},'Removed from your library.')} saving={saving} />}
        </section>
      </div>

      <nav className="mobile-nav" aria-label="Primary navigation">
        {([['today','Journal','⌂'],['review','Review','◌'],['trends','Profile','↗'],['library','Library','◇']] as const).map(([id,label,icon]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><span>{icon}</span>{label}</button>)}
      </nav>
      <button className="mobile-capture" onClick={() => openCapture()} aria-label="Capture a meal">＋</button>

      {captureOpen && <div className="modal-backdrop" onMouseDown={() => !saving && setCaptureOpen(false)}><section className="capture-sheet" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="capture-title">
        <div className="sheet-handle" /><div className="capture-head"><div><span className="eyebrow">Quick capture</span><h2 id="capture-title">What did you have?</h2></div><button className="close-button" onClick={() => setCaptureOpen(false)}>×</button></div>
        <div className="meal-types">{(['Breakfast','Lunch','Dinner','Snack'] as Array<keyof MealTimes>).map((type) => <button key={type} onClick={() => selectMealType(type)} className={mealType === type ? 'selected' : ''}>{type}</button>)}</div>
        <label className="capture-date">Date and time<input type="datetime-local" value={captureDate} onChange={(event) => setCaptureDate(event.target.value)} /></label>
        <textarea className="capture-input" value={note} onChange={(event) => setNote(event.target.value)} placeholder='Try “1 cup pasta, 2 eggs, parmesan, and 1 cup cold brew”' autoFocus />
        <p className="capture-hint">Separate foods with commas or “and” and Mise will create an item for each one.</p>
        {transcript && <div className="transcript"><span>Voice note</span><textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} /></div>}
        {photos.length > 0 && <div className="photo-strip">{photos.map((photo, index) => <div key={`${photo.name}-${index}`}><img src={URL.createObjectURL(photo)} alt={`Meal evidence ${index + 1}`} /><button onClick={() => setPhotos((all) => all.filter((_, i) => i !== index))}>×</button></div>)}</div>}
        <input ref={fileRef} className="sr-only" type="file" accept="image/*" multiple capture="environment" onChange={(event) => setPhotos((all) => [...all, ...Array.from(event.target.files ?? [])])} />
        <div className="capture-tools"><button onClick={() => fileRef.current?.click()}>▣ <span>Add photos</span></button><button onClick={startVoice} className={listening ? 'recording' : ''}>● <span>{listening ? 'Listening…' : 'Describe by voice'}</span></button></div>
        <div className="capture-actions"><button className="secondary" disabled={saving} onClick={() => capture(false)}>{saving ? 'Saving…' : 'Save quickly'}</button><button className="primary" disabled={saving} onClick={() => capture(true)}>Review estimate →</button></div>
        <p className="capture-footnote">Your evidence is saved before interpretation. Estimates stay clearly marked until you verify them.</p>
      </section></div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function TodayView({ events, library, totals, goals, coverage, selectedDay, setSelectedDay, expanded, setExpanded, action, onCapture, saving }: { events: EatingEvent[]; library:LibraryItem[]; totals: Nutrients; goals: Goals; coverage: number; selectedDay:string; setSelectedDay:(day:string)=>void; expanded: string|null; setExpanded: (id:string|null)=>void; action:(body:Record<string,unknown>, success?:string)=>void; onCapture:()=>void; saving:boolean }) {
  const progress = Math.min(100, Math.round((totals.calories / goals.calories) * 100));
  const selectedDate = new Date(`${selectedDay}T12:00:00`);
  const isToday = selectedDay === todayKey();
  function moveDay(offset:number) { const next = new Date(selectedDate); next.setDate(next.getDate()+offset); setSelectedDay(next.toLocaleDateString('en-CA')); }
  return <>
    <div className="page-heading"><div><span className="eyebrow">Journal</span><h1>{isToday ? 'How today is taking shape' : selectedDate.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</h1><p>{isToday ? 'Useful direction, without demanding a perfect log.' : 'Review and refine anything you logged on this day.'}</p></div><button className="primary header-capture" onClick={onCapture}>＋ Add to this day</button></div>
    <div className="date-navigator"><button onClick={()=>moveDay(-1)} aria-label="Previous day">‹</button><label><span>Journal date</span><input type="date" value={selectedDay} onChange={(event)=>setSelectedDay(event.target.value)} /></label><button onClick={()=>moveDay(1)} aria-label="Next day">›</button>{!isToday&&<button className="today-jump" onClick={()=>setSelectedDay(todayKey())}>Back to today</button>}</div>
    <section className="today-overview">
      <div className="energy-card"><div className="energy-copy"><span>Energy</span><strong>{round(totals.calories).toLocaleString()}</strong><small>of {goals.calories.toLocaleString()} kcal</small></div><div className="energy-ring" style={{ '--progress': `${progress * 3.6}deg` } as React.CSSProperties}><div><b>{progress}%</b><span>today</span></div></div></div>
      <div className="macro-grid">{(['protein','carbs','fat','fiber'] as const).map((key) => <Macro key={key} label={key} value={totals[key]} goal={goals[key]} />)}</div>
      <div className="trust-card"><div><span className="status-dot verified" /><strong>{coverage}% verified</strong></div><p>{events.filter((event) => event.status !== 'verified').length ? `${events.filter((event) => event.status !== 'verified').length} ${events.filter((event) => event.status !== 'verified').length === 1 ? 'meal is' : 'meals are'} still estimated.` : events.length ? 'Everything logged today has been reviewed.' : 'Log your first meal to begin.'}</p></div>
    </section>
    <div className="section-title"><div><h2>{isToday ? 'Today’s meals' : 'Meals for this day'}</h2><span>{events.length} {events.length === 1 ? 'event' : 'events'}</span></div></div>
    {events.length ? <div className="event-list">{events.map((event) => <EventCard key={`${event.id}-${event.items.map((item)=>item.id).join('-')}`} event={event} library={library} open={expanded === event.id} onToggle={() => setExpanded(expanded === event.id ? null : event.id)} action={action} saving={saving} />)}</div> : <button className="empty-state" onClick={onCapture}><span>＋</span><strong>Nothing logged on this day</strong><p>Add a meal now, or choose another date above.</p></button>}
  </>;
}

function Macro({ label, value, goal }: { label:string; value:number; goal:number }) { const pct = Math.min(100, Math.round((value/goal)*100)); return <div className={`macro-card ${label}`}><div><span>{label}</span><strong>{round(value)}<small>g</small></strong></div><div className="progress"><i style={{ width: `${pct}%` }} /></div><small>{pct}% of {goal}g</small></div>; }

function EventCard({ event, library, open, onToggle, action, saving }: { event:EatingEvent;library:LibraryItem[];open:boolean;onToggle:()=>void;action:(body:Record<string,unknown>, success?:string)=>void;saving:boolean }) {
  const totals = eventTotals(event);
  const [items, setItems] = useState(event.items);
  const [details, setDetails] = useState({ mealType:event.mealType, note:event.note, occurredAt:localDateTimeValue(event.occurredAt) });
  const time = new Date(event.occurredAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  function addFood() {
    setItems((all)=>[...all,{ id:`new-${crypto.randomUUID()}`,name:'',quantity:1,unit:'serving',calories:0,protein:0,carbs:0,fat:0,fiber:0,iron:null,calcium:null,vitaminC:null,source:'Manual entry',sourceUrl:'',libraryItemId:null,confidence:1,completeness:1 }]);
  }
  return <article className={`event-card ${open ? 'open' : ''}`}>
    <button className="event-summary" onClick={onToggle}><div className="meal-icon">{event.mealType === 'Breakfast' ? '☼' : event.mealType === 'Dinner' ? '◐' : event.mealType === 'Snack' ? '◇' : '◒'}</div><div className="event-title"><div><strong>{event.mealType}</strong><span>{time}</span></div><p>{event.items.map((item) => item.name).join(', ') || event.note || 'Evidence captured'}</p></div><div className="event-kcal"><strong>{round(totals.calories)}</strong><span>kcal</span></div><span className={`status ${event.status}`}>{statusLabel(event.status)}</span><span className="chevron">⌄</span></button>
    {open && <div className="event-detail">
      <div className="entry-editor"><div className="items-heading"><span className="detail-label">Entry details</span><span>Edit the date, meal, or description</span></div><div className="entry-fields"><label>Date and time<input type="datetime-local" value={details.occurredAt} onChange={(e)=>setDetails({...details,occurredAt:e.target.value})}/></label><label>Meal<select value={details.mealType} onChange={(e)=>setDetails({...details,mealType:e.target.value})}>{['Breakfast','Lunch','Dinner','Snack'].map((type)=><option key={type}>{type}</option>)}</select></label><label className="entry-note">Description<input value={details.note} onChange={(e)=>setDetails({...details,note:e.target.value})}/></label><button onClick={()=>action({action:'update_event',eventId:event.id,occurredAt:new Date(details.occurredAt).toISOString(),mealType:details.mealType,note:details.note},'Entry details updated.')}>Save details</button></div></div>
      {event.evidence.length > 0 && <div className="evidence-panel"><span className="detail-label">Original evidence</span><div className="evidence-row">{event.evidence.map((item) => item.type === 'photo' && item.url ? <a key={item.id} href={item.url} target="_blank"><img src={item.url} alt={item.filename ?? 'Meal evidence'} /></a> : <blockquote key={item.id}>{item.transcript}</blockquote>)}</div></div>}
      <div className="items-panel"><div className="items-heading"><span className="detail-label">Foods in this entry</span><button className="add-item" onClick={addFood}>＋ Add food</button></div>{items.map((item, index) => {const libraryItem=library.find((saved)=>saved.id===item.libraryItemId||saved.name.toLowerCase()===item.name.toLowerCase());return <EditableItem key={item.id} item={item} libraryItem={libraryItem} onChange={(next) => setItems((all) => all.map((current, i) => i === index ? next : current))} onSave={(next) => action(next.id.startsWith('new-') ? { action:'add_item',eventId:event.id,item:next } : { action:'update_item',item:next },next.id.startsWith('new-')?'Food added.':'Item updated.')} onDelete={()=>item.id.startsWith('new-')?setItems((all)=>all.filter((current)=>current.id!==item.id)):action({action:'delete_item',itemId:item.id},'Food removed.')} onAddLibrary={()=>action({action:'save_library',item:libraryDraftFromFood(item)},'Added this food to your Library.')} onUpdateLibrary={()=>libraryItem&&action({action:'update_library_from_item',libraryItemId:libraryItem.id,item},'Library food updated from this entry.')} />})}</div>
      <div className="confidence-note provenance-note"><span>i</span><p><strong>Source-first nutrition</strong><br />Each food shows where its values came from. Items without a reliable match stay flagged for review instead of receiving a generic estimate.</p></div>
      <div className="event-actions"><button onClick={() => action({ action:'delete_event', eventId:event.id }, 'Meal deleted.')}>Delete</button><button onClick={() => action({ action:'save_event_to_library', eventId:event.id, name:event.note || `${event.mealType} meal` }, 'Saved for quick reuse.')}>Save to library</button><button onClick={() => action({ action:'repeat', eventId:event.id }, 'Meal repeated for today.')}>Repeat today</button>{event.status !== 'verified' && <button className="primary" disabled={saving} onClick={() => action({ action:'verify', eventId:event.id }, 'Meal marked verified.')}>Mark verified ✓</button>}</div>
    </div>}
  </article>;
}

function EditableItem({ item, libraryItem, onChange, onSave, onDelete, onAddLibrary, onUpdateLibrary }: { item:FoodItem;libraryItem?:LibraryItem;onChange:(item:FoodItem)=>void;onSave:(item:FoodItem)=>void;onDelete:()=>void;onAddLibrary:()=>void;onUpdateLibrary:()=>void }) {
  const unresolved=item.source.includes('Needs')||item.source.includes('needs')||item.source.includes('review');
  return <div className="editable-item"><div className="provenance-row"><span className={`provenance-badge ${unresolved?'unresolved':item.source==='Personal Library'?'library':'researched'}`}>{item.source}</span>{item.sourceUrl&&<a href={item.sourceUrl} target="_blank" rel="noreferrer">View source ↗</a>}<span className={`library-state ${libraryItem?'saved':''}`}>{libraryItem?'✓ In Library':'Not in Library'}</span></div><input className="food-name" value={item.name} onChange={(e) => onChange({ ...item, name:e.target.value })} placeholder="Food name" /><div className="food-fields"><label>Amount<input type="number" step="0.1" value={item.quantity} onChange={(e) => onChange({ ...item, quantity:Number(e.target.value) })} /></label><label>Unit<input value={item.unit} onChange={(e) => onChange({ ...item, unit:e.target.value })} /></label>{nutrientKeys.map((key) => <label key={key}>{key === 'calories' ? 'kcal' : key}<input type="number" step="0.1" value={item[key]} onChange={(e) => onChange({ ...item, [key]:Number(e.target.value) })} /></label>)}</div><div className="item-meta"><span>{unresolved?'Nutrition not found—review values':`${Math.round(item.completeness*8)} of 8 tracked nutrients available`}</span><button className="library-item-action" disabled={item.id.startsWith('new-')} onClick={libraryItem?onUpdateLibrary:onAddLibrary}>{libraryItem?'Update Library':'Add to Library'}</button><button className="delete-item" onClick={onDelete}>Remove</button><button onClick={() => onSave(item)}>{item.id.startsWith('new-')?'Add food':'Save changes'}</button></div></div>;
}

function ReviewView({ events, library, expanded, setExpanded, action, saving }: { events:EatingEvent[];library:LibraryItem[];expanded:string|null;setExpanded:(id:string|null)=>void;action:(body:Record<string,unknown>,success?:string)=>void;saving:boolean }) {
  return <><div className="page-heading"><div><span className="eyebrow">Review inbox</span><h1>Resolve what matters</h1><p>Only uncertain meals wait here. Estimates can stay estimates as long as you like.</p></div></div>{events.length ? <div className="review-banner"><span>≈</span><div><strong>{events.length} {events.length === 1 ? 'entry needs' : 'entries need'} a look</strong><p>Recent entries and foods without a reliable source appear here.</p></div></div> : <div className="all-clear"><span>✓</span><h2>You’re all caught up</h2><p>No captured or estimated meals need attention.</p></div>}<div className="event-list">{events.map((event) => <EventCard key={`${event.id}-${event.items.map((item)=>item.id).join('-')}`} event={event} library={library} open={expanded === event.id} onToggle={() => setExpanded(expanded === event.id ? null : event.id)} action={action} saving={saving} />)}</div></>;
}

function TrendsView({ events, goals, mealTimes, onSave, onDeleteAll }: { events:EatingEvent[]; goals:Goals; mealTimes:MealTimes; onSave:(goals:Goals,mealTimes:MealTimes)=>void; onDeleteAll:()=>void }) {
  const [draft, setDraft] = useState(goals);
  const [timeDraft,setTimeDraft]=useState(mealTimes);
  const days = Array.from({ length:7 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - (6-index)); const key = date.toLocaleDateString('en-CA'); const dayEvents = events.filter((event) => dayKey(event.occurredAt) === key); return { label:date.toLocaleDateString('en-US',{weekday:'short'}).slice(0,1), totals:sumItems(dayEvents.flatMap((event)=>event.items)), events:dayEvents }; });
  const avg = sumItems(days.flatMap((day) => day.events.flatMap((event) => event.items))); nutrientKeys.forEach((key) => { avg[key] /= 7; });
  const verified = events.filter((event) => event.status === 'verified').length; const completeness = events.length ? Math.round(events.flatMap((e)=>e.items).reduce((s,i)=>s+i.completeness,0)/Math.max(1,events.flatMap((e)=>e.items).length)*100) : 0;
  return <><div className="page-heading"><div><span className="eyebrow">Profile & last 7 days</span><h1>Your patterns and defaults</h1><p>Set your goals and usual meal times, then see how the week is taking shape.</p></div></div><section className="goals-card profile-card"><div><span className="eyebrow">Your profile</span><h2>Goals & meal rhythm</h2><p>Choosing a meal during capture will start at its usual time. You can still adjust it for any entry.</p></div><div className="profile-fields"><div className="goal-fields">{nutrientKeys.map((key)=><label key={key}>{key}<span><input type="number" value={draft[key]} onChange={(e)=>setDraft({...draft,[key]:Number(e.target.value)})}/>{key==='calories'?'kcal':'g'}</span></label>)}</div><div className="meal-defaults"><strong>Usual meal times</strong><div className="meal-time-grid">{(Object.keys(timeDraft) as Array<keyof MealTimes>).map((type)=><label key={type}>{type}<input type="time" value={timeDraft[type]} onChange={(event)=>setTimeDraft({...timeDraft,[type]:event.target.value})}/></label>)}</div></div><button className="primary profile-save" onClick={()=>onSave(draft,timeDraft)}>Save profile</button></div></section><div className="trend-grid"><section className="chart-card"><div className="chart-head"><div><span>Daily energy</span><strong>{round(avg.calories).toLocaleString()} <small>kcal avg</small></strong></div><span className="soft-pill">7 days</span></div><div className="bar-chart">{days.map((day,index) => <div key={index} className="bar-column"><div className="bar-track"><i style={{ height:`${Math.min(100,(day.totals.calories/goals.calories)*100)}%` }} /></div><span>{day.label}</span></div>)}</div><div className="goal-line"><i />Goal: {goals.calories.toLocaleString()} kcal</div></section><section className="quality-card"><span className="detail-label">Data quality</span><Quality value={events.length ? Math.round((verified/events.length)*100) : 0} label="Events verified" color="#2e7451" /><Quality value={completeness} label="Nutrient coverage" color="#e4a943" /><p>Coverage reflects whether nutrient values are known—not whether your intake is “good.”</p></section></div><section className="averages-card"><div className="section-title"><div><h2>Daily averages</h2><span>Across the last week</span></div></div><div className="average-grid">{(['protein','carbs','fat','fiber'] as const).map((key)=><div key={key}><span>{key}</span><strong>{round(avg[key])}g</strong><small>{Math.round((avg[key]/goals[key])*100)}% of target</small></div>)}</div></section><section className="data-card"><div><span className="eyebrow">Data control</span><h2>Your journal belongs to you</h2><p>Use the download button in the header for a complete JSON export. Original photos remain available from each meal.</p></div><button onClick={onDeleteAll}>Delete all my data</button></section></>;
}
function Quality({ value,label,color }:{value:number;label:string;color:string}) { return <div className="quality"><div><span>{label}</span><strong>{value}%</strong></div><div className="progress"><i style={{width:`${value}%`,background:color}} /></div></div>; }

function LibraryView({ items, onSave, onDelete, saving }:{items:LibraryItem[];onSave:(item:LibraryItem)=>void;onDelete:(itemId:string)=>void;saving:boolean}) {
  const blank:LibraryItem={id:'',name:'',kind:'food',alias:'',quantity:1,unit:'serving',calories:0,protein:0,carbs:0,fat:0,fiber:0,iron:null,calcium:null,vitaminC:null,servingGrams:null,servingsPerCookedCup:null,sourceLabel:'Manual entry',sourceUrl:''};
  const [draft,setDraft]=useState(blank); const [adding,setAdding]=useState(false);
  const [researchQuery,setResearchQuery]=useState(''); const [researching,setResearching]=useState(false); const [researchResults,setResearchResults]=useState<FoodResearchResult[]>([]); const [researchMessage,setResearchMessage]=useState('');
  function submit(){if(!draft.name.trim()) return;onSave(draft);setDraft(blank);setAdding(false);}
  async function research(){
    if(!researchQuery.trim()) return;
    setResearching(true);setResearchMessage('');setResearchResults([]);
    try { const response=await fetch(`/api/food-search?q=${encodeURIComponent(researchQuery.trim())}`);const data=await response.json() as {results?:FoodResearchResult[];note?:string;error?:string};if(!response.ok) throw new Error(data.error);setResearchResults(data.results??[]);setResearchMessage(data.note??(!(data.results?.length)?'No close branded matches found. Try the brand name by itself.':'')); }
    catch(error){setResearchMessage(error instanceof Error&&error.message?error.message:'Could not research that food right now.');}
    finally{setResearching(false);}
  }
  function saveResearch(result:FoodResearchResult){
    const isPasta=/\bpasta\b/i.test(result.description); const aliases=[researchQuery.trim(),isPasta?'cooked pasta':'',isPasta&&result.brand?`${result.brand} pasta`:''].filter(Boolean).join(', ');
    onSave({id:'',name:result.name,kind:'food',alias:aliases,quantity:1,unit:result.serving,...result,servingsPerCookedCup:result.servingsPerCookedCup,sourceLabel:result.sourceLabel,sourceUrl:result.sourceUrl});
    setResearchResults((all)=>all.filter((item)=>item.id!==result.id));
  }
  return <>
    <div className="page-heading"><div><span className="eyebrow">Personal library</span><h1>Your foods, remembered</h1><p>Research a label once. Mise reuses it—and converts familiar portions—next time.</p></div><button className="primary" onClick={()=>setAdding(true)}>＋ Add manually</button></div>
    <section className="research-card"><div className="research-intro"><span className="research-mark">✦</span><div><span className="eyebrow">Food researcher</span><h2>Look up a specific product</h2><p>Searches branded nutrition data online, then lets you confirm what belongs in your library.</p></div></div><form className="research-search" onSubmit={(event)=>{event.preventDefault();research();}}><input value={researchQuery} onChange={(event)=>setResearchQuery(event.target.value)} placeholder="Try “Brami pasta”"/><button className="primary" disabled={researching}>{researching?'Researching…':'Research food'}</button></form>{researchMessage&&<p className="research-message">{researchMessage}</p>}{researchResults.length>0&&<div className="research-results">{researchResults.map((result,index)=><article key={result.id} className="research-result"><div className="result-rank">{index+1}</div><div className="result-main"><span>{result.brand||'Branded food'}</span><h3>{result.description}</h3><p>Per {result.serving} · {round(result.calories)} kcal · P {round(result.protein)}g · C {round(result.carbs)}g · F {round(result.fat)}g</p><a href={result.sourceUrl} target="_blank" rel="noreferrer">View USDA source ↗</a></div>{/\bpasta\b/i.test(result.description)&&<label className="conversion-field">Cooked conversion<span>1 cup cooked = <input type="number" min="0.1" step="0.1" value={result.servingsPerCookedCup??1} onChange={(event)=>setResearchResults((all)=>all.map((item)=>item.id===result.id?{...item,servingsPerCookedCup:Number(event.target.value)}:item))}/> label serving</span><small>Adjust if your package gives a different cooked yield.</small></label>}<button className="save-result" disabled={saving} onClick={()=>saveResearch(result)}>Save to Library</button></article>)}</div>}</section>
    {adding&&<section className="library-form"><div className="capture-head"><div><span className="eyebrow">New library item</span><h2>Save a reliable shortcut</h2></div><button className="close-button" onClick={()=>setAdding(false)}>×</button></div><div className="form-grid"><label className="wide">Name<input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="Overnight oats"/></label><label>Type<select value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value as LibraryItem['kind']})}><option value="food">Food</option><option value="recipe">Recipe</option><option value="meal">Meal</option></select></label><label>Aliases<input value={draft.alias} onChange={e=>setDraft({...draft,alias:e.target.value})} placeholder="usual oats, breakfast oats"/></label><label>Amount<input type="number" value={draft.quantity} onChange={e=>setDraft({...draft,quantity:Number(e.target.value)})}/></label><label>Unit<input value={draft.unit} onChange={e=>setDraft({...draft,unit:e.target.value})}/></label>{nutrientKeys.map(key=><label key={key}>{key}<input type="number" value={draft[key]} onChange={e=>setDraft({...draft,[key]:Number(e.target.value)})}/></label>)}</div><button className="primary" disabled={saving} onClick={submit}>Save to library</button></section>}
    {items.length?<><div className="section-title"><div><h2>Saved foods</h2><span>{items.length} in your library</span></div></div><div className="library-grid">{items.map(item=><article key={item.id} className="library-card"><div className={`library-icon ${item.kind}`}>{item.kind==='recipe'?'R':item.kind==='meal'?'M':'F'}</div><span className="soft-pill">{item.kind}</span><h3>{item.name}</h3><p>{item.quantity} {item.unit} · {round(item.calories)} kcal</p>{item.servingsPerCookedCup&&<p className="conversion-note">1 cooked cup = {item.servingsPerCookedCup} serving{item.servingsPerCookedCup===1?'':'s'}</p>}{item.alias&&<blockquote>Matches “{item.alias}”</blockquote>}<div className="library-macros"><span>P {round(item.protein)}g</span><span>C {round(item.carbs)}g</span><span>F {round(item.fat)}g</span></div><div className="library-links">{item.sourceUrl&&<a className="library-source" href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceLabel} ↗</a>}<button disabled={saving} onClick={()=>onDelete(item.id)}>Remove</button></div></article>)}</div></>:!adding&&<div className="all-clear"><span>◇</span><h2>Your library is ready</h2><p>Research a branded food above, or add a custom food manually.</p></div>}
  </>;
}
