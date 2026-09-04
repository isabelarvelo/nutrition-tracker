'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, EatingEvent, FoodItem, Goals, LibraryItem, MealTimes, Nutrients } from './types';
import { emptyNutrients } from './types';
import { withQuantity } from './lib/resolve/portion';
import { localDateFor } from './lib/dates';

type View = 'today' | 'review' | 'trends' | 'library';
import type { FoodResearchResult } from './food-research';
const initial: AppState = { events: [], library: [], goals: { calories: 2100, protein: 115, carbs: 240, fat: 70, fiber: 28 }, mealTimes:{ Breakfast:'08:00', Lunch:'12:30', Dinner:'18:30', Snack:'15:30' }, user: { displayName: 'Food journal', email: '' } };
const nutrientKeys: Array<keyof Pick<Nutrients, 'calories'|'protein'|'carbs'|'fat'|'fiber'>> = ['calories','protein','carbs','fat','fiber'];

function browserTimeZone() { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
function eventDayKey(event: EatingEvent, timezone: string) { return event.localDate ?? localDateFor(event.occurredAt, timezone); }
function todayKey(timezone: string) { return localDateFor(new Date(), timezone); }
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
    iron: sum.iron == null && item.iron == null ? null : (sum.iron ?? 0) + (item.iron ?? 0),
    calcium: sum.calcium == null && item.calcium == null ? null : (sum.calcium ?? 0) + (item.calcium ?? 0),
    vitaminC: sum.vitaminC == null && item.vitaminC == null ? null : (sum.vitaminC ?? 0) + (item.vitaminC ?? 0),
  }), { ...emptyNutrients });
}
function eventTotals(event: EatingEvent) { return sumItems(event.items); }
function itemsSignature(items:FoodItem[]){return JSON.stringify(items);}
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
  const [captureTitle,setCaptureTitle]=useState('');
  const [transcript, setTranscript] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [mealType, setMealType] = useState('Breakfast');
  const [captureDate, setCaptureDate] = useState(() => localDateTimeValue(new Date()));
  const [selectedDay, setSelectedDay] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [listening, setListening] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load journal');
      const next = await response.json() as AppState;
      setState(next);
      setSelectedDay((current) => current || todayKey(next.timezone ?? browserTimeZone()));
    } catch { setToast('Could not load your journal. Please refresh.'); }
    // A failed first load must still leave the journal sitting on a real day.
    finally { setSelectedDay((current) => current || todayKey(browserTimeZone())); setLoading(false); }
  }, []);
  // The initial server-backed journal load intentionally hydrates client state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!state.events.some((event) => event.status === 'captured' || event.status === 'resolving')) return;
    const timer = setInterval(load, 2_500);
    return () => clearInterval(timer);
  }, [load, state.events]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3200); return () => clearTimeout(timer); }, [toast]);

  const timezone = state.timezone ?? browserTimeZone();
  const selectedEvents = useMemo(() => state.events.filter((event) => eventDayKey(event, timezone) === selectedDay), [state.events, selectedDay, timezone]);
  const selectedTotals = useMemo(() => sumItems(selectedEvents.flatMap((event) => event.items)), [selectedEvents]);
  const reviewEvents = state.events.filter((event) => event.status !== 'verified').sort((left,right) => {
    const impact = (event:EatingEvent) => event.items.reduce((sum,item) => sum + (1-item.confidence)*item.calories, 0);
    return impact(right)-impact(left);
  });
  const verifiedCalories = selectedEvents.filter((event) => event.status === 'verified').reduce((sum, event) => sum + eventTotals(event).calories, 0);
  const coverage = selectedTotals.calories ? Math.round((verifiedCalories / selectedTotals.calories) * 100) : 0;

  async function action(body: Record<string, unknown>, success?: string) {
    setSaving(true);
    try {
      const response = await fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) { const failure=await response.json().catch(()=>({})) as {error?:string};throw new Error(failure.error||'That did not save. Please try again.'); }
      const result=await response.json() as {id?:string};
      await load(); if(body.action==='log_library'&&result.id){setView('today');setSelectedDay(todayKey(timezone));setExpanded(result.id);} if (success) setToast(success); return true;
    } catch(error) { setToast(error instanceof Error?error.message:'That did not save. Please try again.'); return false; }
    finally { setSaving(false); }
  }

  async function capture(reviewNow: boolean) {
    if (!note.trim() && !transcript.trim() && !photos.length) { setToast('Add a note, voice description, or photo first.'); return; }
    setSaving(true);
    const form = new FormData();
    form.set('payload', JSON.stringify({ title:captureTitle, note, transcript, mealType, occurredAt: new Date(captureDate).toISOString(), idempotencyKey: crypto.randomUUID() }));
    photos.forEach((photo) => form.append('photos', photo));
    try {
      const response = await fetch('/api/state', { method: 'POST', body: form });
      if (!response.ok) { const failure=await response.json().catch(()=>({})) as {error?:string};throw new Error(failure.error); }
      const result = await response.json() as { id: string };
      setNote(''); setCaptureTitle(''); setTranscript(''); setPhotos([]); setCaptureOpen(false);
      await load();
      if (reviewNow) { setView('review'); setExpanded(result.id); }
      setToast(reviewNow ? 'Meal saved. Review the foods and nutrition estimates.' : 'Meal saved. You can refine it anytime.');
    } catch (error) { setToast(error instanceof Error&&error.message?error.message:'Capture failed. Your draft is still here.'); }
    finally { setSaving(false); }
  }

  function startVoice() {
    const SpeechRecognition = (window as unknown as { webkitSpeechRecognition?: new () => { continuous: boolean; interimResults: boolean; lang: string; onresult: (event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void; onend: () => void; start: () => void } }).webkitSpeechRecognition;
    if (!SpeechRecognition) { setToast('Voice transcription is not supported in this browser. You can type instead.'); return; }
    const recognition = new SpeechRecognition(); recognition.continuous = false; recognition.interimResults = false; recognition.lang = 'en-US';
    recognition.onresult = (event) => setTranscript(Array.from(event.results).map((result) => result[0].transcript).join(' '));
    recognition.onend = () => setListening(false); setListening(true); recognition.start();
  }

  function addPhotos(selected:File[]) {
    const supported=new Set(['image/jpeg','image/png','image/webp','image/gif']);
    if(selected.some((photo)=>!supported.has(photo.type))){setToast('Use JPEG, PNG, WebP, or non-animated GIF images.');return;}
    if(selected.some((photo)=>photo.size>10_000_000)){setToast('Each photo must be 10MB or smaller.');return;}
    const available=6-photos.length;
    if(available<=0){setToast('You can add up to 6 photos to one meal.');return;}
    setPhotos((all)=>[...all,...selected.slice(0,available)]);
    if(selected.length>available)setToast('Only the first 6 photos were added.');
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
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `mise-export-${todayKey(timezone)}.json`; link.click(); URL.revokeObjectURL(url);
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
          {view === 'today' && <TodayView timezone={timezone} events={selectedEvents} library={state.library} totals={selectedTotals} goals={state.goals} coverage={coverage} selectedDay={selectedDay} setSelectedDay={setSelectedDay} expanded={expanded} setExpanded={setExpanded} action={action} onCapture={() => openCapture()} saving={saving} />}
          {view === 'review' && <ReviewView events={reviewEvents} library={state.library} expanded={expanded} setExpanded={setExpanded} action={action} saving={saving} />}
          {view === 'trends' && <TrendsView timezone={timezone} events={state.events} goals={state.goals} mealTimes={state.mealTimes} onSave={(goals,mealTimes) => action({ action: 'save_goals', goals, mealTimes }, 'Profile updated.')} onDeleteAll={() => { if (window.confirm('Permanently delete every meal, photo, saved food, and goal? This cannot be undone.')) action({ action:'delete_all' }, 'All food-tracking data was deleted.'); }} />}
          {view === 'library' && <LibraryView onLog={(itemId)=>action({action:'log_library',itemId,occurredAt:new Date().toISOString(),mealType:'Breakfast'},'Meal added with editable ingredients.')} items={state.library} onSave={(item) => action({ action: item.id ? 'update_library' : 'save_library', item }, item.id ? 'Library entry updated.' : 'Added to your library.')} onDelete={(itemId)=>action({action:'delete_library',itemId},'Removed from your library.')} saving={saving} />}
        </section>
      </div>

      <nav className="mobile-nav" aria-label="Primary navigation">
        {([['today','Journal','⌂'],['review','Review','◌'],['trends','Profile','↗'],['library','Library','◇']] as const).map(([id,label,icon]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><span>{icon}</span>{label}</button>)}
      </nav>
      <button className="mobile-capture" onClick={() => openCapture()} aria-label="Capture a meal">＋</button>

      {captureOpen && <div className="modal-backdrop" onMouseDown={() => !saving && setCaptureOpen(false)}><section className="capture-sheet" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="capture-title">
        <div className="sheet-handle" /><div className="capture-head"><div><span className="eyebrow">Quick capture</span><h2 id="capture-title">What did you have?</h2></div><button className="close-button" onClick={() => setCaptureOpen(false)}>×</button></div>
        <div className="meal-types">{(['Breakfast','Lunch','Dinner','Snack'] as Array<keyof MealTimes>).map((type) => <button key={type} onClick={() => selectMealType(type)} className={mealType === type ? 'selected' : ''}>{type}</button>)}</div>
        <label className="capture-date">Meal title (optional)<input value={captureTitle} maxLength={200} onChange={e=>setCaptureTitle(e.target.value)} placeholder="Mise will suggest a title if left blank"/></label>
        <label className="capture-date">Date and time<input type="datetime-local" value={captureDate} onChange={(event) => setCaptureDate(event.target.value)} /></label>
        <textarea className="capture-input" value={note} onChange={(event) => setNote(event.target.value)} placeholder='Try “1 cup pasta, 2 eggs, parmesan, and 1 cup cold brew”' autoFocus />
        <p className="capture-hint">Separate foods with commas or “and” and Mise will create an item for each one.</p>
        {transcript && <div className="transcript"><span>Voice note</span><textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} /></div>}
        {photos.length > 0 && <div className="photo-strip">{photos.map((photo, index) => <div key={`${photo.name}-${index}`}><img src={URL.createObjectURL(photo)} alt={`Meal evidence ${index + 1}`} /><button onClick={() => setPhotos((all) => all.filter((_, i) => i !== index))}>×</button></div>)}</div>}
        <input ref={cameraRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" onChange={(event) => {addPhotos(Array.from(event.target.files??[]));event.currentTarget.value='';}} />
        <input ref={uploadRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={(event) => {addPhotos(Array.from(event.target.files??[]));event.currentTarget.value='';}} />
        <div className="capture-tools"><button onClick={() => cameraRef.current?.click()}>◉ <span>Take photo</span></button><button onClick={() => uploadRef.current?.click()}>▣ <span>Upload photos</span></button><button onClick={startVoice} className={`voice-tool ${listening ? 'recording' : ''}`}>● <span>{listening ? 'Listening…' : 'Describe by voice'}</span></button></div>
        <div className="capture-actions"><button className="secondary" disabled={saving} onClick={() => capture(false)}>{saving ? 'Processing…' : 'Save meal'}</button><button className="primary" disabled={saving} onClick={() => capture(true)}>{saving?'Estimating nutrition…':'Review estimate →'}</button></div>
        <p className="capture-footnote">Your evidence is saved before interpretation. Estimates stay clearly marked until you verify them.</p>
      </section></div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function TodayView({ timezone, events, library, totals, goals, coverage, selectedDay, setSelectedDay, expanded, setExpanded, action, onCapture, saving }: { timezone: string; events: EatingEvent[]; library:LibraryItem[]; totals: Nutrients; goals: Goals; coverage: number; selectedDay:string; setSelectedDay:(day:string)=>void; expanded: string|null; setExpanded: (id:string|null)=>void; action:(body:Record<string,unknown>, success?:string)=>void; onCapture:()=>void; saving:boolean }) {
  const progress = Math.min(100, Math.round((totals.calories / goals.calories) * 100));
  const selectedDate = new Date(`${selectedDay}T12:00:00`);
  const isToday = selectedDay === todayKey(timezone);
  function moveDay(offset:number) { const next = new Date(selectedDate); next.setDate(next.getDate()+offset); setSelectedDay(localDateFor(next, timezone)); }
  return <>
    <div className="page-heading"><div><span className="eyebrow">Journal</span><h1>{isToday ? 'How today is taking shape' : selectedDate.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</h1><p>{isToday ? 'Useful direction, without demanding a perfect log.' : 'Review and refine anything you logged on this day.'}</p></div><button className="primary header-capture" onClick={onCapture}>＋ Add to this day</button></div>
    <div className="date-navigator"><button onClick={()=>moveDay(-1)} aria-label="Previous day">‹</button><label><span>Journal date</span><input type="date" value={selectedDay} onChange={(event)=>setSelectedDay(event.target.value)} /></label><button onClick={()=>moveDay(1)} aria-label="Next day">›</button>{!isToday&&<button className="today-jump" onClick={()=>setSelectedDay(todayKey(timezone))}>Back to today</button>}</div>
    <section className="today-overview">
      <div className="energy-card"><div className="energy-copy"><span>Energy</span><strong>{round(totals.calories).toLocaleString()}</strong><small>of {goals.calories.toLocaleString()} kcal</small></div><div className="energy-ring" style={{ '--progress': `${progress * 3.6}deg` } as React.CSSProperties}><div><b>{progress}%</b><span>today</span></div></div></div>
      <div className="macro-grid">{(['protein','carbs','fat','fiber'] as const).map((key) => <Macro key={key} label={key} value={totals[key]} goal={goals[key]} />)}</div>
      <div className="trust-card"><div><span className="status-dot verified" /><strong>{coverage}% verified</strong></div><p>{events.filter((event) => event.status !== 'verified').length ? `${events.filter((event) => event.status !== 'verified').length} ${events.filter((event) => event.status !== 'verified').length === 1 ? 'meal is' : 'meals are'} still estimated.` : events.length ? 'Everything logged today has been reviewed.' : 'Log your first meal to begin.'}</p></div>
    </section>
    <div className="section-title"><div><h2>{isToday ? 'Today’s meals' : 'Meals for this day'}</h2><span>{events.length} {events.length === 1 ? 'event' : 'events'}</span></div></div>
    {events.length ? <div className="event-list">{events.map((event) => <EventCard key={event.id} event={event} library={library} open={expanded === event.id} onToggle={() => setExpanded(expanded === event.id ? null : event.id)} action={action} saving={saving} />)}</div> : <button className="empty-state" onClick={onCapture}><span>＋</span><strong>Nothing logged on this day</strong><p>Add a meal now, or choose another date above.</p></button>}
  </>;
}

function Macro({ label, value, goal }: { label:string; value:number; goal:number }) { const pct = Math.min(100, Math.round((value/goal)*100)); return <div className={`macro-card ${label}`}><div><span>{label}</span><strong>{round(value)}<small>g</small></strong></div><div className="progress"><i style={{ width: `${pct}%` }} /></div><small>{pct}% of {goal}g</small></div>; }

function EventCard({ event, library, open, onToggle, action, saving }: { event:EatingEvent;library:LibraryItem[];open:boolean;onToggle:()=>void;action:(body:Record<string,unknown>, success?:string)=>void;saving:boolean }) {
  const totals = eventTotals(event);
  // The server owns items and entry details; these drafts mirror them. Rather
  // than forcing a remount (which also discarded unrelated in-progress input),
  // reset a draft only when the value it mirrors actually changes.
  const serverItems = useMemo(() => itemsSignature(event.items), [event.items]);
  const serverDetails = `${event.title}\u0000${event.mealType}\u0000${event.note}\u0000${event.occurredAt}`;
  const [items, setItems] = useState(event.items);
  const [syncedItems, setSyncedItems] = useState(serverItems);
  if (syncedItems !== serverItems) { setSyncedItems(serverItems); setItems(event.items); }
  const [additionalFoods,setAdditionalFoods]=useState('');
  const detailsFromEvent = () => ({ title:event.title||event.note.slice(0,200)||`${event.mealType} meal`, mealType:event.mealType, note:event.note, occurredAt:localDateTimeValue(event.occurredAt) });
  const [details, setDetails] = useState(detailsFromEvent);
  const [syncedDetails, setSyncedDetails] = useState(serverDetails);
  if (syncedDetails !== serverDetails) { setSyncedDetails(serverDetails); setDetails(detailsFromEvent()); }
  const time = new Date(event.occurredAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  function addFood() {
    setItems((all)=>[...all,{ id:`new-${crypto.randomUUID()}`,name:'',quantity:1,unit:'serving',calories:0,protein:0,carbs:0,fat:0,fiber:0,iron:null,calcium:null,vitaminC:null,source:'Manual entry',sourceUrl:'',libraryItemId:null,confidence:1,completeness:1 }]);
  }
  return <article className={`event-card ${open ? 'open' : ''}`}>
    <button className="event-summary" onClick={onToggle}><div className="meal-icon">{event.mealType === 'Breakfast' ? '☼' : event.mealType === 'Dinner' ? '◐' : event.mealType === 'Snack' ? '◇' : '◒'}</div><div className="event-title"><div><strong>{event.title||event.mealType}</strong><span>{event.mealType} · {time}</span></div><p>{event.items.map((item) => item.name).join(', ') || event.note || 'Evidence captured'}</p></div><div className="event-kcal"><strong>{round(totals.calories)}</strong><span>kcal</span></div><span className={`status ${event.status}`}>{statusLabel(event.status)}</span><span className="chevron">⌄</span></button>
    {open && <div className="event-detail">
      <div className="meal-title-editor"><label>Meal title<input value={details.title} maxLength={200} onChange={e=>setDetails({...details,title:e.target.value})} placeholder="Breakfast bagel sandwich"/></label><button disabled={saving||!details.title.trim()} onClick={()=>action({action:"rename_event",eventId:event.id,title:details.title},"Meal title saved.")}>Save title</button><p>This name keeps the ingredients together in your journal and Library. Only ingredient nutrition counts toward totals.</p></div>
      <div className="entry-editor"><div className="items-heading"><span className="detail-label">Entry details</span><span>Edit the date, meal, or description</span></div><div className="entry-fields"><label>Date and time<input type="datetime-local" value={details.occurredAt} onChange={(e)=>setDetails({...details,occurredAt:e.target.value})}/></label><label>Meal<select value={details.mealType} onChange={(e)=>setDetails({...details,mealType:e.target.value})}>{['Breakfast','Lunch','Dinner','Snack'].map((type)=><option key={type}>{type}</option>)}</select></label><label className="entry-note">Description<input value={details.note} onChange={(e)=>setDetails({...details,note:e.target.value})}/></label><button onClick={()=>action({action:'update_event',eventId:event.id,occurredAt:new Date(details.occurredAt).toISOString(),mealType:details.mealType,note:details.note},'Entry details updated.')}>Save details</button></div></div>
      {event.evidence.length > 0 && <div className="evidence-panel"><span className="detail-label">Original evidence</span><div className="evidence-row">{event.evidence.map((item) => item.type === 'photo' && item.url ? <a key={item.id} href={item.url} target="_blank"><img src={item.url} alt={item.filename ?? 'Meal evidence'} /></a> : <blockquote key={item.id}>{item.transcript}</blockquote>)}</div></div>}
      <div className="items-panel"><div className="items-heading"><span className="detail-label">Foods & components</span><span>Tap any food name to edit</span></div>
        <form className="add-foods-form" onSubmit={(e)=>{e.preventDefault();if(additionalFoods.trim()&&!saving)action({action:'add_foods',eventId:event.id,description:additionalFoods},'Foods added with nutrition estimates.');}}>
          <label htmlFor={`add-foods-${event.id}`}>Missing something? Add foods to this meal</label>
          <div><input id={`add-foods-${event.id}`} value={additionalFoods} onChange={e=>setAdditionalFoods(e.target.value)} placeholder="e.g. 1 tbsp cream cheese, 2 tomato slices" maxLength={2000} disabled={saving}/><button className="primary" disabled={saving||!additionalFoods.trim()||event.status==='captured'||event.status==='resolving'}>{saving?'Working…':'＋ Add & estimate'}</button></div>
          <button className="manual-food-button" type="button" disabled={saving} onClick={addFood}>Or enter a food and nutrition manually</button>
        </form>
        {items.map((item, index) => {const libraryItem=library.find((saved)=>saved.id===item.libraryItemId||saved.name.toLowerCase()===item.name.toLowerCase());return <EditableItem key={item.id} item={item} saving={saving} onBreak={(details)=>action({action:"break_item",itemId:item.id,name:item.name,quantity:item.quantity,unit:item.unit,details},"Replaced the whole food with editable ingredients.")} libraryItem={libraryItem} onChange={(next) => setItems((all) => all.map((current, i) => i === index ? next : current))} onEstimate={()=>action({action:'estimate_item',itemId:item.id,name:item.name,quantity:item.quantity,unit:item.unit},'Nutrition re-estimated. Review the suggested matches.')} onSave={(next) => action(next.id.startsWith('new-') ? { action:'add_item',eventId:event.id,item:next } : { action:'update_item',item:next },next.id.startsWith('new-')?'Food added.':'Item updated.')} onDelete={()=>item.id.startsWith('new-')?setItems((all)=>all.filter((current)=>current.id!==item.id)):action({action:'delete_item',itemId:item.id},'Food removed.')} onResolve={(candidate)=>action({action:'resolve_candidate',itemId:item.id,candidate},'Food matched and nutrition updated.')} onAddLibrary={()=>action({action:'save_library',item:libraryDraftFromFood(item)},'Added this food to your Library.')} onUpdateLibrary={()=>libraryItem&&action({action:'update_library_from_item',libraryItemId:libraryItem.id,item},'Library food updated from this entry.')} />})}</div>
      <div className="confidence-note provenance-note"><span>≈</span><p><strong>A useful estimate, yours to refine</strong><br />Database matches are preferred. AI estimates use typical portions and are clearly labeled; unavailable micronutrients stay unknown. Edit names or amounts, compare other matches, and verify when you’re happy.</p></div>
      <div className="event-actions"><button onClick={() => action({ action:'delete_event', eventId:event.id }, 'Meal deleted.')}>Delete</button><button disabled={saving||!details.title.trim()||!items.length||itemsSignature(items)!==serverItems} title="Save ingredient edits first, then save the whole named meal." onClick={() => action({ action:"save_event_to_library", eventId:event.id, name:details.title }, "Saved the meal title and all ingredients to your Library.")}>Save meal & ingredients to Library</button><button onClick={() => action({ action:'repeat', eventId:event.id }, 'Meal repeated for today.')}>Repeat today</button>{event.status !== 'verified' && <button className="primary" disabled={saving} onClick={() => action({ action:'verify', eventId:event.id }, 'Meal marked verified.')}>Mark verified ✓</button>}</div>
    </div>}
  </article>;
}

function EditableItem({ item, libraryItem, saving, onBreak, onChange, onSave, onDelete, onResolve, onEstimate, onAddLibrary, onUpdateLibrary }: { item:FoodItem;libraryItem?:LibraryItem;saving:boolean;onBreak:(details:string)=>void;onChange:(item:FoodItem)=>void;onSave:(item:FoodItem)=>void;onDelete:()=>void;onResolve:(candidate:NonNullable<FoodItem['candidates']>[number])=>void;onEstimate:()=>void;onAddLibrary:()=>void;onUpdateLibrary:()=>void }) {
  const [quantityDraft,setQuantityDraft]=useState(String(item.quantity));
  const [syncedQuantity,setSyncedQuantity]=useState(item.quantity);
  if(syncedQuantity!==item.quantity){setSyncedQuantity(item.quantity);setQuantityDraft(String(item.quantity));}
  const [breaking,setBreaking]=useState(false);
  const [breakDetails,setBreakDetails]=useState('');
  const unresolved=item.resolutionTier==='unresolved'||item.source.toLowerCase().includes('needs');
  const isNew=item.id.startsWith('new-');
  const valid=Boolean(item.name.trim()&&item.unit.trim()&&item.quantity>0&&nutrientKeys.every(key=>Number.isFinite(item[key])&&item[key]>=0));
  function changeQuantity(quantity:number){
    onChange(withQuantity(item,quantity));
  }
  return <fieldset className="editable-item" disabled={saving}>
    <legend className="sr-only">Edit {item.name||'new food'}</legend>
    <div className="provenance-row"><span className={`provenance-badge ${unresolved||item.resolutionTier==='estimated'?'unresolved':item.source==='Personal Library'?'library':'researched'}`}>{item.source}</span>{item.sourceUrl&&<a href={item.sourceUrl} target="_blank" rel="noreferrer">View source ↗</a>}<span className={`library-state ${libraryItem?'saved':''}`}>{libraryItem?'✓ In Library':'Not in Library'}</span></div>
    <label className="food-name-label">Food name <span>Editable</span><input className="food-name" value={item.name} onChange={(e)=>onChange({...item,name:e.target.value})} placeholder="Name this food" maxLength={200} autoFocus={isNew}/></label>
    {item.clarificationQuestion&&<p className="research-message">{item.clarificationQuestion}</p>}
    {unresolved&&<p className="research-message">No estimate available yet. Use “Re-estimate nutrition” to try again, or enter values yourself.</p>}
    <div className="food-fields"><label>Amount<input type="number" min="0.01" step="any" value={quantityDraft} onChange={e=>setQuantityDraft(e.target.value)} onBlur={()=>{const quantity=Number(quantityDraft);if(quantity>0&&quantity<=20000)changeQuantity(quantity);else setQuantityDraft(String(item.quantity));}}/></label><label>Unit<input value={item.unit} maxLength={80} onChange={e=>onChange({...item,unit:e.target.value})}/></label>{nutrientKeys.map(key=><label key={key}>{key==='calories'?'kcal':`${key} (g)`}<input type="number" min="0" step="any" value={item[key]} onChange={e=>onChange({...item,[key]:Number(e.target.value)})}/></label>)}</div>
    <p className="portion-help">Values are for the full amount above. Changing the amount scales nutrition; after changing the name or unit, re-estimate or edit the values.</p>
    {item.candidates&&item.candidates.length>0&&<details className="match-options" open={item.resolutionTier==='estimated'||unresolved}><summary>Compare {item.candidates.length} possible {item.candidates.length===1?'match':'matches'}</summary><div className="candidate-list">{item.candidates.map(candidate=>{const selected=candidate.name===item.name&&Math.abs(candidate.nutrients.calories-item.calories)<.1&&candidate.sourceLabel===item.source;return <button key={`${candidate.providerId}-${candidate.externalId}`} aria-pressed={selected} onClick={()=>onResolve(candidate)}><div><strong>{selected?'✓ Current: ':''}{candidate.name}</strong><small>{candidate.sourceLabel}{candidate.assumption?` · ${candidate.assumption}`:''}</small></div><span>{candidate.servingDescription} · {round(candidate.nutrients.calories)} kcal<br/>{selected?'Selected':'Use this match'}</span></button>;})}</div></details>}
    {!isNew&&<div className="break-food"><button disabled={!valid} onClick={()=>setBreaking(!breaking)}>{breaking?'Cancel ingredient breakdown':'Break into ingredients'}</button>{breaking&&<div><p>Replace only this whole food with its ingredients. The original photo is reused when available; other foods in the meal stay unchanged.</p><label>What should Mise know?<textarea value={breakDetails} maxLength={2000} onChange={e=>setBreakDetails(e.target.value)} placeholder="e.g. This had an egg, cream cheese, tomato and greens on a bagel."/></label><button className="primary" disabled={!valid||saving} onClick={()=>onBreak(breakDetails)}>Replace with ingredients</button></div>}</div>}
    <div className="item-meta"><span>{unresolved?'Nutrition incomplete':`${Math.round(item.completeness*8)} of 8 tracked nutrients available`}</span>{!isNew&&<button disabled={!valid} onClick={onEstimate}>{saving?'Estimating…':'Re-estimate nutrition'}</button>}<button className="library-item-action" disabled={isNew||!valid} onClick={libraryItem?onUpdateLibrary:onAddLibrary}>{libraryItem?'Update Library':'Add to Library'}</button><button className="delete-item" onClick={onDelete}>Remove</button><button disabled={!valid} onClick={()=>onSave(item)}>{isNew?'Add food':'Save changes'}</button></div>
  </fieldset>;
}

function ReviewView({ events, library, expanded, setExpanded, action, saving }: { events:EatingEvent[];library:LibraryItem[];expanded:string|null;setExpanded:(id:string|null)=>void;action:(body:Record<string,unknown>,success?:string)=>void;saving:boolean }) {
  return <><div className="page-heading"><div><span className="eyebrow">Review inbox</span><h1>Resolve what matters</h1><p>Only uncertain meals wait here. Estimates can stay estimates as long as you like.</p></div></div>{events.length ? <div className="review-banner"><span>≈</span><div><strong>{events.length} {events.length === 1 ? 'entry needs' : 'entries need'} a look</strong><p>Recent entries and foods without a reliable source appear here.</p></div></div> : <div className="all-clear"><span>✓</span><h2>You’re all caught up</h2><p>No captured or estimated meals need attention.</p></div>}<div className="event-list">{events.map((event) => <EventCard key={event.id} event={event} library={library} open={expanded === event.id} onToggle={() => setExpanded(expanded === event.id ? null : event.id)} action={action} saving={saving} />)}</div></>;
}

function TrendsView({ timezone, events, goals, mealTimes, onSave, onDeleteAll }: { timezone:string; events:EatingEvent[]; goals:Goals; mealTimes:MealTimes; onSave:(goals:Goals,mealTimes:MealTimes)=>void; onDeleteAll:()=>void }) {
  const [draft, setDraft] = useState(goals);
  const [timeDraft,setTimeDraft]=useState(mealTimes);
  const days = Array.from({ length:7 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - (6-index)); const key = localDateFor(date, timezone); const dayEvents = events.filter((event) => eventDayKey(event, timezone) === key); return { label:date.toLocaleDateString('en-US',{weekday:'short'}).slice(0,1), totals:sumItems(dayEvents.flatMap((event)=>event.items)), events:dayEvents }; });
  const avg = sumItems(days.flatMap((day) => day.events.flatMap((event) => event.items))); nutrientKeys.forEach((key) => { avg[key] /= 7; });
  const verified = events.filter((event) => event.status === 'verified').length; const completeness = events.length ? Math.round(events.flatMap((e)=>e.items).reduce((s,i)=>s+i.completeness,0)/Math.max(1,events.flatMap((e)=>e.items).length)*100) : 0;
  return <><div className="page-heading"><div><span className="eyebrow">Profile & last 7 days</span><h1>Your patterns and defaults</h1><p>Set your goals and usual meal times, then see how the week is taking shape.</p></div></div><section className="goals-card profile-card"><div><span className="eyebrow">Your profile</span><h2>Goals & meal rhythm</h2><p>Choosing a meal during capture will start at its usual time. You can still adjust it for any entry.</p></div><div className="profile-fields"><div className="goal-fields">{nutrientKeys.map((key)=><label key={key}>{key}<span><input type="number" value={draft[key]} onChange={(e)=>setDraft({...draft,[key]:Number(e.target.value)})}/>{key==='calories'?'kcal':'g'}</span></label>)}</div><div className="meal-defaults"><strong>Usual meal times</strong><div className="meal-time-grid">{(Object.keys(timeDraft) as Array<keyof MealTimes>).map((type)=><label key={type}>{type}<input type="time" value={timeDraft[type]} onChange={(event)=>setTimeDraft({...timeDraft,[type]:event.target.value})}/></label>)}</div></div><button className="primary profile-save" onClick={()=>onSave(draft,timeDraft)}>Save profile</button></div></section><div className="trend-grid"><section className="chart-card"><div className="chart-head"><div><span>Daily energy</span><strong>{round(avg.calories).toLocaleString()} <small>kcal avg</small></strong></div><span className="soft-pill">7 days</span></div><div className="bar-chart">{days.map((day,index) => <div key={index} className="bar-column"><div className="bar-track"><i style={{ height:`${Math.min(100,(day.totals.calories/goals.calories)*100)}%` }} /></div><span>{day.label}</span></div>)}</div><div className="goal-line"><i />Goal: {goals.calories.toLocaleString()} kcal</div></section><section className="quality-card"><span className="detail-label">Data quality</span><Quality value={events.length ? Math.round((verified/events.length)*100) : 0} label="Events verified" color="#2e7451" /><Quality value={completeness} label="Nutrient coverage" color="#e4a943" /><p>Coverage reflects whether nutrient values are known—not whether your intake is “good.”</p></section></div><section className="averages-card"><div className="section-title"><div><h2>Daily averages</h2><span>Across the last week</span></div></div><div className="average-grid">{(['protein','carbs','fat','fiber'] as const).map((key)=><div key={key}><span>{key}</span><strong>{round(avg[key])}g</strong><small>{Math.round((avg[key]/goals[key])*100)}% of target</small></div>)}</div></section><section className="data-card"><div><span className="eyebrow">Data control</span><h2>Your journal belongs to you</h2><p>Use the download button in the header for a complete JSON export. Original photos remain available from each meal.</p></div><button onClick={onDeleteAll}>Delete all my data</button></section></>;
}
function Quality({ value,label,color }:{value:number;label:string;color:string}) { return <div className="quality"><div><span>{label}</span><strong>{value}%</strong></div><div className="progress"><i style={{width:`${value}%`,background:color}} /></div></div>; }

function LibraryView({ items, onSave, onDelete, onLog, saving }:{onLog:(itemId:string)=>void;items:LibraryItem[];onSave:(item:LibraryItem)=>Promise<boolean>;onDelete:(itemId:string)=>void;saving:boolean}) {
  const blank:LibraryItem={id:'',name:'',kind:'food',alias:'',quantity:1,unit:'serving',calories:0,protein:0,carbs:0,fat:0,fiber:0,iron:null,calcium:null,vitaminC:null,servingGrams:null,servingsPerCookedCup:null,sourceLabel:'Manual entry',sourceUrl:''};
  const [researchTarget,setResearchTarget]=useState('');
  const [receiptBusy,setReceiptBusy]=useState(false);
  const [receiptMessage,setReceiptMessage]=useState('');
  const [receiptItems,setReceiptItems]=useState<Array<{name:string;alias:string;selected:boolean}>>([]);
  function editPart(index:number,changes:Partial<FoodItem>){setDraft(current=>({...current,components:current.components?.map((part,i)=>i===index?{...part,...changes}:part)}));}
  function lookupSaved(item:LibraryItem){setResearchQuery(item.name);setResearchTarget(item.id);setResearchResults([]);setResearchMessage('Review the search, then choose Research food to find its nutrition.');window.scrollTo({top:0,behavior:'smooth'});}
  async function uploadReceipt(file:File){
    setReceiptBusy(true);setReceiptItems([]);setReceiptMessage('Reading food items…');
    try{
      const form=new FormData();form.append('receipt',file);
      const response=await fetch('/api/receipt',{method:'POST',body:form});const data=await response.json() as {items?:Array<{name:string;alias:string}>;error?:string};
      if(!response.ok)throw new Error(data.error||'Could not read this receipt.');
      const found=(data.items as Array<{name:string;alias:string}>).filter(food=>!items.some(saved=>saved.name.toLowerCase()===food.name.toLowerCase()));
      setReceiptItems(found.map(food=>({...food,selected:true})));setReceiptMessage(found.length?'Review these foods before adding them.':'No new, clearly identifiable food items found.');
    }catch(error){setReceiptMessage(error instanceof Error?error.message:'Could not read this receipt.');}finally{setReceiptBusy(false);}
  }
  async function saveReceipt(){
    setReceiptBusy(true);let savedCount=0;
    const selected=receiptItems.filter(item=>item.selected&&item.name.trim());
    try{for(const food of selected){
      setReceiptMessage(`Finding nutrition and saving ${savedCount+1} of ${selected.length}: ${food.name}…`);
      if(!await onSave({...blank,name:food.name,alias:food.alias,nutritionPending:true,sourceLabel:'Receipt · nutrition pending'})){setReceiptMessage('Some items could not be saved. Unsaved foods are still here to retry.');return;}
      savedCount++;setReceiptItems(all=>all.filter(item=>item!==food));
    }setReceiptMessage(`${savedCount} food${savedCount===1?'':'s'} added. Nutrition was searched automatically; any unmatched foods are marked for review.`);}finally{setReceiptBusy(false);}
  }
  const [draft,setDraft]=useState(blank); const [adding,setAdding]=useState(false);
  const [researchQuery,setResearchQuery]=useState(''); const [researchContext,setResearchContext]=useState(''); const [submittedQuery,setSubmittedQuery]=useState(''); const [researching,setResearching]=useState(false); const [researchResults,setResearchResults]=useState<FoodResearchResult[]>([]); const [researchMessage,setResearchMessage]=useState('');
  async function submit(){if(!draft.name.trim()) return;if(await onSave({...draft,sourceLabel:draft.nutritionPending?'Receipt · nutrition pending':'Manually edited'})){setDraft(blank);setAdding(false);}}
  async function research(){
    if(!researchQuery.trim()||researching) return;
    setSubmittedQuery(researchQuery.trim());
    setResearching(true);setResearchMessage('');setResearchResults([]);
    try { const response=await fetch(`/api/food-search?q=${encodeURIComponent(researchQuery.trim())}&context=${encodeURIComponent(researchContext.trim())}`);const data=await response.json() as {results?:FoodResearchResult[];note?:string;error?:string};if(!response.ok) throw new Error(data.error);setResearchResults(data.results??[]);setResearchMessage(data.results?.length?'':'No verified matches found. Try adding a brand, flavor or size.'); }
    catch(error){setResearchMessage(error instanceof Error&&error.message?error.message:'Could not research that food right now.');}
    finally{setResearching(false);}
  }
  async function saveResearch(result:FoodResearchResult){
    const isPasta=/\bpasta\b/i.test(result.description); const aliases=[submittedQuery,isPasta?'cooked pasta':'',isPasta&&result.brand?`${result.brand} pasta`:''].filter(Boolean).join(', ');
    const nutrition: Nutrients = result;
    const saved=await onSave({...nutrition,id:researchTarget,name:result.name,kind:'food',alias:aliases,quantity:1,unit:result.serving,servingGrams:result.servingGrams,servingsPerCookedCup:result.servingsPerCookedCup,sourceLabel:result.sourceLabel,sourceUrl:result.sourceUrl});
    if(saved){setResearchResults((all)=>all.filter((item)=>item.id!==result.id));setResearchTarget('');}
  }
  return <>
    <div className="page-heading"><div><span className="eyebrow">Personal library</span><h1>Your foods, remembered</h1><p>Research a label once. Mise reuses it—and converts familiar portions—next time.</p></div><button className="primary" onClick={()=>{setDraft(blank);setAdding(true);}}>＋ Add manually</button></div>
    <section className="research-card"><div className="research-intro"><span className="research-mark">✦</span><div><span className="eyebrow">Food researcher</span><h2>Find a food or product</h2><p>Checks nutrition databases and the web, using your saved foods as clues. Review the match and serving before saving.</p></div></div><form className="research-search" onSubmit={(event)=>{event.preventDefault();research();}}><input aria-label="Food to research" maxLength={100} disabled={researching} value={researchQuery} onChange={(event)=>{setResearchQuery(event.target.value);setResearchTarget('');}} placeholder="Try “jammy balls” or “Brami pasta”"/><button className="primary" disabled={researching}>{researching?'Researching…':'Research food'}</button></form><label className="research-message">Eating preferences or clues (optional)<input aria-label="Eating preferences or clues" maxLength={300} disabled={researching} value={researchContext} onChange={event=>setResearchContext(event.target.value)} placeholder="e.g. plant-based snacks, peanut butter flavor"/></label>{researching&&<p className="research-message" role="status">Checking products and nutrition sources… this can take about a minute.</p>}{researchMessage&&<p className="research-message" role="status">{researchMessage}</p>}{researchResults.length>0&&<div className="research-results">{researchResults.map((result,index)=><article key={result.id} className="research-result"><div className="result-rank">{index+1}</div><div className="result-main"><span>{result.brand||'Food'}</span><h3>{result.description}</h3><p>Per {result.serving} · {round(result.calories)} kcal · P {round(result.protein)}g · C {round(result.carbs)}g · F {round(result.fat)}g</p><a href={result.sourceUrl} target="_blank" rel="noreferrer">{result.sourceLabel} ↗</a></div>{/\bpasta\b/i.test(result.description)&&<label className="conversion-field">Cooked conversion<span>1 cup cooked = <input type="number" min="0.1" step="0.1" value={result.servingsPerCookedCup??1} onChange={(event)=>setResearchResults((all)=>all.map((item)=>item.id===result.id?{...item,servingsPerCookedCup:Number(event.target.value)}:item))}/> label serving</span><small>Adjust if your package gives a different cooked yield.</small></label>}<button className="save-result" disabled={saving} onClick={()=>saveResearch(result)}>Save to Library</button></article>)}</div>}</section>
    <section className="research-card"><h2>Add foods from a receipt</h2><p>Upload a receipt to remember groceries and snacks. Only clearly identified food and drink items are suggested. When you add the selected foods, nutrition is researched and saved automatically. Uncertain matches are marked for review.</p><label>Receipt photo<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={receiptBusy||saving} onChange={event=>{const file=event.target.files?.[0];if(file)uploadReceipt(file);event.target.value='';}}/></label>{receiptMessage&&<p role="status">{receiptMessage}</p>}{receiptItems.map((item,index)=><div className="research-search receipt-food-row" key={index}><input type="checkbox" aria-label={`Include ${item.name}`} checked={item.selected} disabled={receiptBusy} onChange={event=>setReceiptItems(all=>all.map((food,i)=>i===index?{...food,selected:event.target.checked}:food))}/><input aria-label={`Receipt food ${index+1}`} value={item.name} maxLength={200} disabled={receiptBusy} onChange={event=>setReceiptItems(all=>all.map((food,i)=>i===index?{...food,name:event.target.value}:food))}/></div>)}{receiptItems.length>0&&<button className="primary" disabled={receiptBusy||saving||!receiptItems.some(item=>item.selected&&item.name.trim())} onClick={saveReceipt}>{receiptBusy?'Finding nutrition…':'Add foods & find nutrition'}</button>}</section>
    {adding&&<section className="library-form"><div className="capture-head"><div><span className="eyebrow">{draft.id?'Edit library item':'New library item'}</span><h2>{draft.id?draft.name:'Save a reliable shortcut'}</h2></div><button className="close-button" onClick={()=>setAdding(false)}>×</button></div><div className="form-grid"><label className="wide">Name<input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="Overnight oats"/></label><label>Type<select value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value as LibraryItem['kind']})}><option value="food">Food</option><option value="recipe">Recipe</option><option value="meal">Meal</option></select></label><label>Aliases<input value={draft.alias} onChange={e=>setDraft({...draft,alias:e.target.value})} placeholder="usual oats, breakfast oats"/></label><label>Amount<input type="number" value={draft.quantity} onChange={e=>setDraft({...draft,quantity:Number(e.target.value)})}/></label><label>Unit<input value={draft.unit} onChange={e=>setDraft({...draft,unit:e.target.value})}/></label>{draft.nutritionPending&&<label className="wide"><input type="checkbox" checked={!draft.nutritionPending} onChange={()=>setDraft({...draft,nutritionPending:false})}/> I have entered nutrition for the serving below</label>}{nutrientKeys.map(key=><label key={key}>{key}<input type="number" disabled={Boolean(draft.components?.length)} min={0} value={draft[key]} onChange={e=>setDraft({...draft,[key]:Number(e.target.value)})}/></label>)}<label>Serving weight (g)<input type="number" min="0.01" value={draft.servingGrams??''} onChange={e=>setDraft({...draft,servingGrams:e.target.value?Number(e.target.value):null})}/></label><label>Servings per cooked cup<input type="number" min="0.01" value={draft.servingsPerCookedCup??''} onChange={e=>setDraft({...draft,servingsPerCookedCup:e.target.value?Number(e.target.value):null})}/></label>{(['iron','calcium','vitaminC'] as const).map(key=><label key={key}>{key} (mg)<input disabled={Boolean(draft.components?.length)} type="number" min="0" value={draft[key]??''} onChange={e=>setDraft({...draft,[key]:e.target.value?Number(e.target.value):null})}/></label>)}<label className="wide">Source link<input type="url" value={draft.sourceUrl} onChange={e=>setDraft({...draft,sourceUrl:e.target.value})}/></label>{draft.components?.map((part,index)=><fieldset className="wide form-grid library-ingredient" key={part.id}><legend>Ingredient {index+1}</legend><label>Name<input value={part.name} onChange={e=>editPart(index,{name:e.target.value})}/></label><label>Amount<input type="number" min="0.01" value={part.quantity} onChange={e=>editPart(index,{quantity:Number(e.target.value)})}/></label><label>Unit<input value={part.unit} onChange={e=>editPart(index,{unit:e.target.value})}/></label>{nutrientKeys.map(key=><label key={key}>{key}<input type="number" min="0" value={part[key]} onChange={e=>editPart(index,{[key]:Number(e.target.value)})}/></label>)}</fieldset>)}</div><button className="primary" disabled={saving||!draft.name.trim()||draft.quantity<=0||!draft.unit.trim()} onClick={submit}>{saving?'Saving…':draft.id?'Save changes':'Save to library'}</button></section>}
    {items.length?<><div className="section-title"><div><h2>Saved foods</h2><span>{items.length} in your library</span></div></div><div className="library-grid">{items.map(item=><article key={item.id} className="library-card"><div className={`library-icon ${item.kind}`}>{item.kind==='recipe'?'R':item.kind==='meal'?'M':'F'}</div><span className="soft-pill">{item.kind}</span><h3>{item.name}</h3>{item.components?.length? <details className="saved-components"><summary>{item.components.length} saved ingredients</summary>{item.components.map((part,index)=><div key={`${part.id}-${index}`}><strong>{part.name}</strong><span>{part.quantity} {part.unit} · {round(part.calories)} kcal</span></div>)}<p>Use Edit to update the saved ingredients.</p></details>:null}<p>{item.nutritionPending?'Nutrition not yet verified':`${item.quantity} ${item.unit} · ${round(item.calories)} kcal`}</p>{item.servingsPerCookedCup&&<p className="conversion-note">1 cooked cup = {item.servingsPerCookedCup} serving{item.servingsPerCookedCup===1?'':'s'}</p>}{item.alias&&<blockquote>Matches “{item.alias}”</blockquote>}<div className="library-macros">{!item.nutritionPending&&<><span>P {round(item.protein)}g</span><span>C {round(item.carbs)}g</span><span>F {round(item.fat)}g</span></>}</div><button className="primary" disabled={saving} onClick={()=>item.nutritionPending?lookupSaved(item):onLog(item.id)}>{item.nutritionPending?'Find nutrition':'Log to today'}</button><div className="library-links">{item.sourceUrl&&<a className="library-source" href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceLabel} ↗</a>}<button disabled={saving} onClick={()=>{setDraft(structuredClone(item));setAdding(true);}}>Edit</button><button disabled={saving} onClick={()=>onDelete(item.id)}>Remove</button></div></article>)}</div></>:!adding&&<div className="all-clear"><span>◇</span><h2>Your library is ready</h2><p>Research a branded food above, or add a custom food manually.</p></div>}
  </>;
}
