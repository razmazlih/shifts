"use client";

import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { today } from "@/lib/time";
import { buildTimelineBands, getTimelineRange, layoutTimelineShifts, summarizeTimelineShifts } from "@/lib/timeline";
import { GROUP_LABELS, type Group, type Shift } from "@/lib/types";
import "./schedule-timeline.css";

const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("he-IL", options).format(new Date(`${date}T12:00:00`));
const hourLabel = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}${minute >= 1440 ? ` +${Math.floor(minute / 1440)}` : ""}`;

export function ScheduleTimeline({ dates, shifts, admin, group, renderCard, onAdd }: {
  dates: string[]; shifts: Shift[]; admin: boolean; group: "ALL" | Group;
  renderCard: (shift: Shift, sources: Shift[]) => ReactNode;
  onAdd: (date: string, group: Group) => void;
}) {
  const [chosenDate, setChosenDate] = useState(today());
  const [dayView, setDayView] = useState(false);
  const activeDate = dates.includes(chosenDate) ? chosenDate : dates[0];
  const summaries = summarizeTimelineShifts(shifts);
  const envelopes = summaries.map(item => ({ ...item.shift,
    start: item.sources.reduce((value, source) => Date.parse(source.start) < Date.parse(value) ? source.start : value, item.sources[0].start),
    end: item.sources.reduce((value, source) => Date.parse(source.end) > Date.parse(value) ? source.end : value, item.sources[0].end),
  }));
  const range = getTimelineRange(envelopes);
  const bands = buildTimelineBands(envelopes);
  const height = bands.reduce((sum, band) => sum + band.height, 0);
  const position = (minute: number) => {
    const band = bands.find(b => minute >= b.start && minute < b.end);
    return band ? band.top + (minute - band.start) / (band.end - band.start) * band.height : height;
  };
  const ticks = [...new Set([range.end, ...bands.map(b => b.start), ...Array.from({ length: (range.end - range.start) / 60 + 1 }, (_, i) => range.start + i * 60)])].sort((a,b) => a-b);
  const hours = ticks.filter((minute, index) => index === 0 || position(minute) - position(ticks[index - 1]) >= 18 || bands.some(b => b.start === minute));
  const teams = (["MANAGERS", "PATROL"] as Group[]).filter(team => group === "ALL" || team === group);
  return <section className={`schedule-timeline ${dayView ? "timeline-day-view" : ""}`} aria-label="לוח משמרות לפי שעות">
    <div className="timeline-toolbar">
      <span>מי עובד ומתי · לחצו על שם לפירוט השיבוצים</span>
      <button className="timeline-view-toggle" onClick={() => setDayView(!dayView)}>{dayView ? "הצגת כל השבוע" : "מיקוד ביום אחד"}</button>
    </div>
    <nav className="timeline-days" aria-label="בחירת יום בלוח">
      {dates.map(date => <button key={date} aria-pressed={date === activeDate} onClick={() => setChosenDate(date)}>
        <span>{dateLabel(date, { weekday: "short" })}</span><strong>{dateLabel(date, { day: "numeric" })}</strong>
        <small>{summaries.filter(item => item.date === date).length} שיב׳</small>
      </button>)}
    </nav>
    <div className="timeline-scroll">
      <div className="timeline-grid">
        <div className="timeline-axis">
          <div className="timeline-heading">שעה</div>
          <div className="timeline-axis-body" style={{ height }}>
            {hours.map(minute => <span key={minute} style={{ top: position(minute) }} dir="ltr">{hourLabel(minute)}</span>)}
          </div>
        </div>
        {dates.map(date => {
          const daily = summaries.filter(item => item.date === date);
          const dailyShifts = daily.map(item => item.shift);
          const packed = layoutTimelineShifts(envelopes.filter(item => daily.some(summary => summary.shift.id === item.id)));
          const sections: { start: number; end: number; active: typeof summaries }[] = [];
          for (const item of packed) {
            const summary = daily.find(value => value.shift.id === item.shift.id)!;
            const previous = sections.at(-1);
            if (previous && item.start < previous.end) {
              previous.end = Math.max(previous.end, item.end);
              previous.active.push(summary);
            } else sections.push({ start: item.start, end: item.end, active: [summary] });
          }
          return <div key={date} className={`timeline-date ${date === activeDate ? "active-date" : ""} ${date === today() ? "timeline-today" : ""}`}>
            <div className="timeline-heading">
              <button onClick={() => { setChosenDate(date); setDayView(true); }} aria-label={`מיקוד ביום ${date}`}>
                {dateLabel(date, { weekday: "long", day: "numeric", month: "numeric" })}{date === today() && <small>היום</small>}
              </button>
              {admin && <div className="timeline-adds">{teams.map(team => <button key={team} onClick={() => onAdd(date, team)} aria-label={`הוספת משמרת ${GROUP_LABELS[team]} ${date}`}><Plus size={12} />{GROUP_LABELS[team]}</button>)}</div>}
            </div>
            <div className="timeline-track" style={{ height }}>
              {hours.map(minute => <div className="timeline-hour-line" key={minute} style={{ top: position(minute) }} />)}
              {dailyShifts.length === 0 && <span className="timeline-empty">אין משמרות בתצוגה זו</span>}
              {sections.map(band => <section key={band.start} className="timeline-shared-card" aria-label={`שיבוצים ${hourLabel(band.start)}–${hourLabel(band.end)}`} style={{ top: position(band.start), height: position(band.end) - position(band.start) }}>
                <div className="timeline-shared-rows">{band.active.map(item => <div className="timeline-shared-row" key={item.shift.id}>{renderCard(item.shift, item.sources)}</div>)}</div>
              </section>)}
            </div>
          </div>;
        })}
      </div>
    </div>
    <p className="timeline-note">משמרות לילה נשארות ביום שבו התחילו. ‎+1 בסרגל מציין את היום הבא. כל עובד מופיע פעם אחת לכל רצף עבודה בצוות. השעות ליד השם הן שעות העבודה שלו; לחצו לפירוט השיבוצים.</p>
  </section>;
}
