'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, EatingEvent, FoodItem, Goals, LibraryItem, Nutrients } from './types';
import { emptyNutrients } from './types';

type View = 'today' | 'review' | 'trends' | 'library';
const initial: AppState = { events: [], library: [], goals: { calories: 2100, protein: 115, carbs: 240, fat: 70, fiber: 28 }, user: { displayName: 'Food journal', email: '' } };
const nutrientKeys: Array<keyof Pick<Nutrients, 'calories'|'protein'|'carbs'|'fat'|'fiber'>> = ['calories','protein','carbs','fat','fiber'];

function dayKey(value: string) { return new Date(value).toLocaleDateString('en-CA'); }
function todayKey() { return new Date().toLocaleDateString('en-CA'); }
function localDateTimeValue(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function captureTimeForDay(day: string) {
  const now = new Date();
  return `${day}T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}
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
    setCaptureDate(captureTimeForDay(day));
    setCaptureOpen(true);
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
          {([['today','Journal','⌂'],['review','Review','◌'],['trends','Trends','↗'],['library','Library','◇']] as const).map(([id,label,icon]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><span>{icon}</span>{label}{id === 'review' && reviewEvents.length > 0 && <em>{reviewEvents.length}</em>}</button>)}
          <div className="side-note"><span>Private by design</span><p>Your photos and food records are only available to you.</p></div>
        </nav>

        <section className="main-content">
          {view === 'today' && <TodayView events={selectedEvents} totals={selectedTotals} goals={state.goals} coverage={coverage} selectedDay={selectedDay} setSelectedDay={setSelectedDay} expanded={expanded} setExpanded={setExpanded} action={action} onCapture={() => openCapture()} saving={saving} />}
          {view === 'review' && <ReviewView events={reviewEvents} expanded={expanded} setExpanded={setExpanded} action={action} saving={saving} />}
          {view === 'trends' && <TrendsView events={state.events} goals={state.goals} onSave={(goals) => action({ action: 'save_goals', goals }, 'Goals updated.')} onDeleteAll={() => { if (window.confirm('Permanently delete every meal, photo, saved food, and goal? This cannot be undone.')) action({ action:'delete_all' }, 'All food-tracking data was deleted.'); }} />}
          {view === 'library' && <LibraryView items={state.library} onSave={(item) => action({ action: 'save_library', item }, 'Added to your library.')} saving={saving} />}
        </section>
      </div>

      <nav className="mobile-nav" aria-label="Primary navigation">
        {([['today','Journal','⌂'],['review','Review','◌'],['trends','Trends','↗'],['library','Library','◇']] as const).map(([id,label,icon]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><span>{icon}</span>{label}</button>)}
      </nav>
      <button className="mobile-capture" onClick={() => openCapture()} aria-label="Capture a meal">＋</button>

      {captureOpen && <div className="modal-backdrop" onMouseDown={() => !saving && setCaptureOpen(false)}><section className="capture-sheet" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="capture-title">
        <div className="sheet-handle" /><div className="capture-head"><div><span className="eyebrow">Quick capture</span><h2 id="capture-title">What did you have?</h2></div><button className="close-button" onClick={() => setCaptureOpen(false)}>×</button></div>
        <div className="meal-types">{['Breakfast','Lunch','Dinner','Snack'].map((type) => <button key={type} onClick={() => setMealType(type)} className={mealType === type ? 'selected' : ''}>{type}</button>)}</div>
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

function TodayView({ events, totals, goals, coverage, selectedDay, setSelectedDay, expanded, setExpanded, action, onCapture, saving }: { events: EatingEvent[]; totals: Nutrients; goals: Goals; coverage: number; selectedDay:string; setSelectedDay:(day:string)=>void; expanded: string|null; setExpanded: (id:string|null)=>void; action:(body:Record<string,unknown>, success?:string)=>void; onCapture:()=>void; saving:boolean }) {
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
    {events.length ? <div className="event-list">{events.map((event) => <EventCard key={`${event.id}-${event.items.map((item)=>item.id).join('-')}`} event={event} open={expanded === event.id} onToggle={() => setExpanded(expanded === event.id ? null : event.id)} action={action} saving={saving} />)}</div> : <button className="empty-state" onClick={onCapture}><span>＋</span><strong>Nothing logged on this day</strong><p>Add a meal now, or choose another date above.</p></button>}
  </>;
}

function Macro({ label, value, goal }: { label:string; value:number; goal:number }) { const pct = Math.min(100, Math.round((value/goal)*100)); return <div className={`macro-card ${label}`}><div><span>{label}</span><strong>{round(value)}<small>g</small></strong></div><div className="progress"><i style={{ width: `${pct}%` }} /></div><small>{pct}% of {goal}g</small></div>; }

function EventCard({ event, open, onToggle, action, saving }: { event:EatingEvent; open:boolean; onToggle:()=>void; action:(body:Record<string,unknown>, success?:string)=>void; saving:boolean }) {
  const totals = eventTotals(event);
  const [items, setItems] = useState(event.items);
  const [details, setDetails] = useState({ mealType:event.mealType, note:event.note, occurredAt:localDateTimeValue(event.occurredAt) });
  const time = new Date(event.occurredAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  function addFood() {
    setItems((all)=>[...all,{ id:`new-${crypto.randomUUID()}`,name:'',quantity:1,unit:'serving',calories:0,protein:0,carbs:0,fat:0,fiber:0,iron:null,calcium:null,vitaminC:null,source:'manual',confidence:1,completeness:1 }]);
  }
  return <article className={`event-card ${open ? 'open' : ''}`}>
    <button className="event-summary" onClick={onToggle}><div className="meal-icon">{event.mealType === 'Breakfast' ? '☼' : event.mealType === 'Dinner' ? '◐' : event.mealType === 'Snack' ? '◇' : '◒'}</div><div className="event-title"><div><strong>{event.mealType}</strong><span>{time}</span></div><p>{event.items.map((item) => item.name).join(', ') || event.note || 'Evidence captured'}</p></div><div className="event-kcal"><strong>{round(totals.calories)}</strong><span>kcal</span></div><span className={`status ${event.status}`}>{statusLabel(event.status)}</span><span className="chevron">⌄</span></button>
    {open && <div className="event-detail">
      <div className="entry-editor"><div className="items-heading"><span className="detail-label">Entry details</span><span>Edit the date, meal, or description</span></div><div className="entry-fields"><label>Date and time<input type="datetime-local" value={details.occurredAt} onChange={(e)=>setDetails({...details,occurredAt:e.target.value})}/></label><label>Meal<select value={details.mealType} onChange={(e)=>setDetails({...details,mealType:e.target.value})}>{['Breakfast','Lunch','Dinner','Snack'].map((type)=><option key={type}>{type}</option>)}</select></label><label className="entry-note">Description<input value={details.note} onChange={(e)=>setDetails({...details,note:e.target.value})}/></label><button onClick={()=>action({action:'update_event',eventId:event.id,occurredAt:new Date(details.occurredAt).toISOString(),mealType:details.mealType,note:details.note},'Entry details updated.')}>Save details</button></div></div>
      {event.evidence.length > 0 && <div className="evidence-panel"><span className="detail-label">Original evidence</span><div className="evidence-row">{event.evidence.map((item) => item.type === 'photo' && item.url ? <a key={item.id} href={item.url} target="_blank"><img src={item.url} alt={item.filename ?? 'Meal evidence'} /></a> : <blockquote key={item.id}>{item.transcript}</blockquote>)}</div></div>}
      <div className="items-panel"><div className="items-heading"><span className="detail-label">Foods in this entry</span><button className="add-item" onClick={addFood}>＋ Add food</button></div>{items.map((item, index) => <EditableItem key={item.id} item={item} onChange={(next) => setItems((all) => all.map((current, i) => i === index ? next : current))} onSave={(next) => action(next.id.startsWith('new-') ? { action:'add_item',eventId:event.id,item:next } : { action:'update_item',item:next },next.id.startsWith('new-')?'Food added.':'Item updated.')} onDelete={()=>item.id.startsWith('new-')?setItems((all)=>all.filter((current)=>current.id!==item.id)):action({action:'delete_item',itemId:item.id},'Food removed.')} />)}</div>
      <div className="confidence-note"><span>≈</span><p><strong>Estimate confidence</strong><br />Portions and missing micronutrients remain visible. Missing data is never treated as zero.</p></div>
      <div className="event-actions"><button onClick={() => action({ action:'delete_event', eventId:event.id }, 'Meal deleted.')}>Delete</button><button onClick={() => action({ action:'save_event_to_library', eventId:event.id, name:event.note || `${event.mealType} meal` }, 'Saved for quick reuse.')}>Save to library</button><button onClick={() => action({ action:'repeat', eventId:event.id }, 'Meal repeated for today.')}>Repeat today</button>{event.status !== 'verified' && <button className="primary" disabled={saving} onClick={() => action({ action:'verify', eventId:event.id }, 'Meal marked verified.')}>Mark verified ✓</button>}</div>
    </div>}
  </article>;
}

function EditableItem({ item, onChange, onSave, onDelete }: { item:FoodItem; onChange:(item:FoodItem)=>void; onSave:(item:FoodItem)=>void; onDelete:()=>void }) {
  return <div className="editable-item"><input className="food-name" value={item.name} onChange={(e) => onChange({ ...item, name:e.target.value })} placeholder="Food name" /><div className="food-fields"><label>Amount<input type="number" step="0.1" value={item.quantity} onChange={(e) => onChange({ ...item, quantity:Number(e.target.value) })} /></label><label>Unit<input value={item.unit} onChange={(e) => onChange({ ...item, unit:e.target.value })} /></label>{nutrientKeys.map((key) => <label key={key}>{key === 'calories' ? 'kcal' : key}<input type="number" step="0.1" value={item[key]} onChange={(e) => onChange({ ...item, [key]:Number(e.target.value) })} /></label>)}</div><div className="item-meta"><span>{Math.round(item.confidence*100)}% identity confidence</span><span>{Math.round(item.completeness*100)}% nutrient coverage</span><button className="delete-item" onClick={onDelete}>Remove</button><button onClick={() => onSave(item)}>{item.id.startsWith('new-')?'Add food':'Save changes'}</button></div></div>;
}

function ReviewView({ events, expanded, setExpanded, action, saving }: { events:EatingEvent[]; expanded:string|null; setExpanded:(id:string|null)=>void; action:(body:Record<string,unknown>,success?:string)=>void; saving:boolean }) {
  return <><div className="page-heading"><div><span className="eyebrow">Review inbox</span><h1>Resolve what matters</h1><p>Only uncertain meals wait here. Estimates can stay estimates as long as you like.</p></div></div>{events.length ? <div className="review-banner"><span>≈</span><div><strong>{events.length} {events.length === 1 ? 'entry needs' : 'entries need'} a look</strong><p>Recent and lower-confidence entries appear first.</p></div></div> : <div className="all-clear"><span>✓</span><h2>You’re all caught up</h2><p>No captured or estimated meals need attention.</p></div>}<div className="event-list">{events.map((event) => <EventCard key={`${event.id}-${event.items.map((item)=>item.id).join('-')}`} event={event} open={expanded === event.id} onToggle={() => setExpanded(expanded === event.id ? null : event.id)} action={action} saving={saving} />)}</div></>;
}

function TrendsView({ events, goals, onSave, onDeleteAll }: { events:EatingEvent[]; goals:Goals; onSave:(goals:Goals)=>void; onDeleteAll:()=>void }) {
  const [draft, setDraft] = useState(goals);
  const days = Array.from({ length:7 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - (6-index)); const key = date.toLocaleDateString('en-CA'); const dayEvents = events.filter((event) => dayKey(event.occurredAt) === key); return { label:date.toLocaleDateString('en-US',{weekday:'short'}).slice(0,1), totals:sumItems(dayEvents.flatMap((event)=>event.items)), events:dayEvents }; });
  const avg = sumItems(days.flatMap((day) => day.events.flatMap((event) => event.items))); nutrientKeys.forEach((key) => { avg[key] /= 7; });
  const verified = events.filter((event) => event.status === 'verified').length; const completeness = events.length ? Math.round(events.flatMap((e)=>e.items).reduce((s,i)=>s+i.completeness,0)/Math.max(1,events.flatMap((e)=>e.items).length)*100) : 0;
  return <><div className="page-heading"><div><span className="eyebrow">Last 7 days</span><h1>Patterns, not perfection</h1><p>Averages include unlogged days so gaps remain honest.</p></div></div><div className="trend-grid"><section className="chart-card"><div className="chart-head"><div><span>Daily energy</span><strong>{round(avg.calories).toLocaleString()} <small>kcal avg</small></strong></div><span className="soft-pill">7 days</span></div><div className="bar-chart">{days.map((day,index) => <div key={index} className="bar-column"><div className="bar-track"><i style={{ height:`${Math.min(100,(day.totals.calories/goals.calories)*100)}%` }} /></div><span>{day.label}</span></div>)}</div><div className="goal-line"><i />Goal: {goals.calories.toLocaleString()} kcal</div></section><section className="quality-card"><span className="detail-label">Data quality</span><Quality value={events.length ? Math.round((verified/events.length)*100) : 0} label="Events verified" color="#2e7451" /><Quality value={completeness} label="Nutrient coverage" color="#e4a943" /><p>Coverage reflects whether nutrient values are known—not whether your intake is “good.”</p></section></div><section className="averages-card"><div className="section-title"><div><h2>Daily averages</h2><span>Across the last week</span></div></div><div className="average-grid">{(['protein','carbs','fat','fiber'] as const).map((key)=><div key={key}><span>{key}</span><strong>{round(avg[key])}g</strong><small>{Math.round((avg[key]/goals[key])*100)}% of target</small></div>)}</div></section><section className="goals-card"><div><span className="eyebrow">Manual targets</span><h2>Your guide rails</h2><p>These stay put until you choose to change them.</p></div><div className="goal-fields">{nutrientKeys.map((key)=><label key={key}>{key}<span><input type="number" value={draft[key]} onChange={(e)=>setDraft({...draft,[key]:Number(e.target.value)})}/>{key==='calories'?'kcal':'g'}</span></label>)}<button className="primary" onClick={()=>onSave(draft)}>Save targets</button></div></section><section className="data-card"><div><span className="eyebrow">Data control</span><h2>Your journal belongs to you</h2><p>Use the download button in the header for a complete JSON export. Original photos remain available from each meal.</p></div><button onClick={onDeleteAll}>Delete all my data</button></section></>;
}
function Quality({ value,label,color }:{value:number;label:string;color:string}) { return <div className="quality"><div><span>{label}</span><strong>{value}%</strong></div><div className="progress"><i style={{width:`${value}%`,background:color}} /></div></div>; }

function LibraryView({ items, onSave, saving }:{items:LibraryItem[];onSave:(item:LibraryItem)=>void;saving:boolean}) {
  const blank:LibraryItem={id:'',name:'',kind:'food',alias:'',quantity:1,unit:'serving',calories:0,protein:0,carbs:0,fat:0,fiber:0,iron:null,calcium:null,vitaminC:null}; const [draft,setDraft]=useState(blank); const [adding,setAdding]=useState(false);
  function submit(){if(!draft.name.trim()) return;onSave(draft);setDraft(blank);setAdding(false);}
  return <><div className="page-heading"><div><span className="eyebrow">Personal library</span><h1>Your foods, remembered</h1><p>Saved meals and aliases make familiar food faster next time.</p></div><button className="primary" onClick={()=>setAdding(true)}>＋ Add food</button></div>{adding&&<section className="library-form"><div className="capture-head"><div><span className="eyebrow">New library item</span><h2>Save a reliable shortcut</h2></div><button className="close-button" onClick={()=>setAdding(false)}>×</button></div><div className="form-grid"><label className="wide">Name<input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="Overnight oats"/></label><label>Type<select value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value as LibraryItem['kind']})}><option value="food">Food</option><option value="recipe">Recipe</option><option value="meal">Meal</option></select></label><label>Alias<input value={draft.alias} onChange={e=>setDraft({...draft,alias:e.target.value})} placeholder="usual oats"/></label><label>Amount<input type="number" value={draft.quantity} onChange={e=>setDraft({...draft,quantity:Number(e.target.value)})}/></label><label>Unit<input value={draft.unit} onChange={e=>setDraft({...draft,unit:e.target.value})}/></label>{nutrientKeys.map(key=><label key={key}>{key}<input type="number" value={draft[key]} onChange={e=>setDraft({...draft,[key]:Number(e.target.value)})}/></label>)}</div><button className="primary" disabled={saving} onClick={submit}>Save to library</button></section>}{items.length?<div className="library-grid">{items.map(item=><article key={item.id} className="library-card"><div className={`library-icon ${item.kind}`}>{item.kind==='recipe'?'R':item.kind==='meal'?'M':'F'}</div><span className="soft-pill">{item.kind}</span><h3>{item.name}</h3><p>{item.quantity} {item.unit} · {round(item.calories)} kcal</p>{item.alias&&<blockquote>“{item.alias}”</blockquote>}<div><span>P {round(item.protein)}g</span><span>C {round(item.carbs)}g</span><span>F {round(item.fat)}g</span></div></article>)}</div>:!adding&&<div className="all-clear"><span>◇</span><h2>Your library is ready</h2><p>Save a verified meal or add a custom food to begin.</p></div>}</>;
}
