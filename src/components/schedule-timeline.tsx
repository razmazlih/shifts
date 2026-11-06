"use client";

import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { localDate, today } from "@/lib/time";
import { getTimelineRange, layoutTimelineShifts } from "@/lib/timeline";
import { GROUP_LABELS, type Group, type Shift } from "@/lib/types";
import "./schedule-timeline.css";

const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("he-IL", options).format(new Date(`${date}T12:00:00`));
const hourLabel = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:00`;

export function ScheduleTimeline({ dates, shifts, admin, group, renderCard, onAdd }: {
  dates: string[]; shifts: Shift[]; admin: boolean; group: "ALL" | Group;
  renderCard: (shift: Shift) => ReactNode;
  onAdd: (date: string, group: Group) => void;
}) {
  const [chosenDate, setChosenDate] = useState(today());
  const [dayView, setDayView] = useState(false);
  const activeDate = dates.includes(chosenDate) ? chosenDate : dates[0];
  const range = getTimelineRange(shifts);
  const hours = Array.from({ length: (range.end - range.start) / 60 + 1 }, (_, i) => range.start + i * 60);
  const height = (range.end - range.start) / 60 * 28;
  const teams = (["MANAGERS", "PATROL"] as Group[]).filter(team => group === "ALL" || team === group);
  return <section className={`schedule-timeline ${dayView ? "timeline-day-view" : ""}`} aria-label="לוח משמרות לפי שעות">
    <div className="timeline-toolbar">
      <span>גובה המשמרת לפי השעות · לחצו לפרטים</span>
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
            {hours.map(minute => <span key={minute} style={{ top: (minute - range.start) / 60 * 28 }} dir="ltr">{hourLabel(minute)}{minute >= 1440 && <small>+{Math.floor(minute / 1440)}</small>}</span>)}
          </div>
        </div>
        {dates.map(date => {
          const dailyShifts = shifts.filter(s => localDate(s.start) === date);
          return <div key={date} className={`timeline-date ${date === activeDate ? "active-date" : ""} ${date === today() ? "timeline-today" : ""}`}>
            <div className="timeline-heading">
              <button onClick={() => { setChosenDate(date); setDayView(true); }} aria-label={`מיקוד ביום ${date}`}>
                {dateLabel(date, { weekday: "long", day: "numeric", month: "numeric" })}{date === today() && <small>היום</small>}
              </button>
              {admin && <div className="timeline-adds">{teams.map(team => <button key={team} onClick={() => onAdd(date, team)} aria-label={`הוספת משמרת ${GROUP_LABELS[team]} ${date}`}><Plus size={12} />{GROUP_LABELS[team]}</button>)}</div>}
            </div>
            <div className="timeline-track" style={{ height }}>
              {hours.map(minute => <div className="timeline-hour-line" key={minute} style={{ top: (minute - range.start) / 60 * 28 }} />)}
              {dailyShifts.length === 0 && <span className="timeline-empty">אין משמרות בתצוגה זו</span>}
              {layoutTimelineShifts(dailyShifts).map(({ shift, start, end, column, columns }) => <div key={shift.id} className={`timeline-event ${end - start < 120 ? "timeline-event-short" : ""}`} style={{ top: (start - range.start) / 60 * 28, height: (end - start) / 60 * 28, width: `${100 / columns}%`, insetInlineStart: `${column * 100 / columns}%` }}>{renderCard(shift)}</div>)}
            </div>
          </div>;
        })}
      </div>
    </div>
    <p className="timeline-note">משמרות לילה נשארות ביום שבו התחילו. ‎+1 בסרגל מציין את היום הבא. משמרות מקבילות מוצגות זו לצד זו.</p>
  </section>;
}
