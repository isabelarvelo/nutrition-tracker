'use client';
import { useMemo, useState } from 'react';
import type { EatingEvent } from '../types';
import { calendarMonth, eventDayKey, todayKey } from '../lib/dates';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * A month at a glance.
 *
 * Ink density is the day's energy against goal, so the shape of a month reads
 * without a single number. A hemoglobin rule under a day means it still holds
 * estimates — the same meaning colour carries everywhere else in the app.
 */
export default function MonthCalendar({ events, goalCalories, timezone, selectedDay, onSelectDay }: {
  events: EatingEvent[];
  goalCalories: number;
  timezone: string;
  selectedDay: string;
  onSelectDay: (day: string) => void;
}) {
  const [monthOffset, setMonthOffset] = useState(0);

  const byDay = useMemo(() => {
    const map = new Map<string, { calories: number; estimated: boolean }>();
    for (const event of events) {
      const key = eventDayKey(event, timezone);
      const entry = map.get(key) ?? { calories: 0, estimated: false };
      for (const item of event.items) entry.calories += item.calories;
      if (event.status !== 'verified') entry.estimated = true;
      map.set(key, entry);
    }
    return map;
  }, [events, timezone]);

  const today = todayKey(timezone);
  const { label, cells } = useMemo(() => {
    const month = calendarMonth(today, monthOffset);
    return { label: month.label, cells: [...Array<null>(month.leading).fill(null), ...month.days] };
  }, [monthOffset, today]);

  return (
    <section className="calendar">
      <div className="calendar-head">
        <h2>{label}</h2>
        <div className="item-meta">
          <button type="button" onClick={() => setMonthOffset(monthOffset - 1)} aria-label="Previous month">‹</button>
          <button type="button" onClick={() => setMonthOffset(0)} disabled={monthOffset === 0}>This month</button>
          <button type="button" onClick={() => setMonthOffset(monthOffset + 1)} disabled={monthOffset >= 0} aria-label="Next month">›</button>
        </div>
      </div>

      <div className="calendar-grid">
        {DOW.map((day, index) => <div key={index} className="calendar-dow">{day}</div>)}
        {cells.map((cell, index) => {
          if (!cell) return <div key={`pad-${index}`} className="calendar-day empty" aria-hidden="true" />;
          const entry = byDay.get(cell.key);
          const share = entry && goalCalories ? Math.min(1, entry.calories / goalCalories) : 0;
          // Floor at 8% so a logged-but-light day is still visibly distinct
          // from a day with nothing in it.
          const fill = entry ? Math.max(8, Math.round(share * 88)) : 0;
          const classes = ['calendar-day'];
          if (entry?.estimated) classes.push('estimated');
          if (cell.key === selectedDay) classes.push('selected');
          return (
            <button
              key={cell.key}
              type="button"
              aria-pressed={cell.key === selectedDay}
              className={classes.join(' ')}
              style={{ '--fill': fill } as React.CSSProperties}
              data-fill-high={fill > 52}
              aria-current={cell.key === today ? 'date' : undefined}
              aria-label={`${cell.key}${entry ? `, ${Math.round(entry.calories)} kilocalories${entry.estimated ? ', still estimated' : ''}` : ', nothing logged'}`}
              onClick={() => onSelectDay(cell.key)}
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      <p className="calendar-legend">
        <span>Darker means closer to your energy goal.</span>
        <span className="status estimated">A red rule means the day still holds estimates.</span>
      </p>
    </section>
  );
}
