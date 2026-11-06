"use client";

import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { localDate, today } from "@/lib/time";
import { buildTimelineBands, getTimelineRange } from "@/lib/timeline";
import { GROUP_LABELS, type Group, type Shift } from "@/lib/types";
import "./schedule-timeline.css";

const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("he-IL", options).format(new Date(`${date}T12:00:00`));
const hourLabel = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}${minute >= 1440 ? ` +${Math.floor(minute / 1440)}` : ""}`;

export function ScheduleTimeline({ dates, shifts, admin, group, renderCard, onAdd }: {
  dates: string[]; shifts: Shift[]; admin: boolean; group: "ALL" | Group;
  renderCard: (shift: Shift) => ReactNode;
  onAdd: (date: string, group: Group) => void;
}) {
  const [chosenDate, setChosenDate] = useState(today());
  const [dayView, setDayView] = useState(false);
  const activeDate = dates.includes(chosenDate) ? chosenDate : dates[0];
  const range = getTimelineRange(shifts);
  const bands = buildTimelineBands(shifts);
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
      <span>כרטיס משותף לכל טווח שעות · לחצו על שורה לפרטים</span>
      <button className="timeline-view-toggle" onClick={() => setDayView(!dayView)}>{dayView ? "הצגת כל השבוע" : "מיקוד ביום אחד"}</button>
    </div>
    <nav className="timeline-days" aria-label="בחירת יום בלוח">
      {dates.map(date => <button key={date} aria-pressed={date === activeDate} onClick={() => setChosenDate(date)}>
        <span>{dateLabel(date, { weekday: "short" })}</span><strong>{dateLabel(date, { day: "numeric" })}</strong>
        <small>{shifts.filter(s => localDate(s.start) === date).length} משמ׳</small>
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
          const dailyShifts = shifts.filter(s => localDate(s.start) === date);
          const sections: { start: number; end: number; top: number; height: number; active: Shift[] }[] = [];
          for (const band of bands) {
            const active = band.days[date] ?? [];
            if (!active.length) continue;
            const previous = sections.at(-1);
            if (previous && previous.end === band.start && previous.active.map(s => s.id).join(",") === active.map(s => s.id).join(",")) {
              previous.end = band.end;
              previous.height += band.height;
            } else sections.push({ ...band, active });
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
              {sections.map((band, index) => {
                const active = band.active;
                const continued = sections[index - 1]?.end === band.start;
                const continues = sections[index + 1]?.start === band.end;
                return <section key={band.start} className={`timeline-shared-card ${continued ? "continued" : ""} ${continues ? "continues" : ""}`} aria-label={`משמרות ${hourLabel(band.start)}–${hourLabel(band.end)}`} style={{ top: band.top, height: band.height }}>
                  <div className="timeline-band-heading"><span dir="ltr">{hourLabel(band.start)}–{hourLabel(band.end)}</span><small>{active.length} משמ׳</small></div>
                  <div className="timeline-shared-rows">{active.map(shift => <div className="timeline-shared-row" key={shift.id}>{renderCard(shift)}</div>)}</div>
                </section>;
              })}
            </div>
          </div>;
        })}
      </div>
    </div>
    <p className="timeline-note">משמרות לילה נשארות ביום שבו התחילו. ‎+1 בסרגל מציין את היום הבא. בכל מקטע מופיעות רק המשמרות הפעילות בו. מקטעים קצרים מורחבים לקריאות, בהתאמה לסרגל השעות.</p>
  </section>;
}
