import { localDate, localTime, weekDates } from "./time";
import type { Template, TemplateEntry } from "./types";

/** Recover editable requirements without losing repeated rows or multi-day spans. */
export function templateToEntries(template: Pick<Template, "shifts" | "sourceWeek">): TemplateEntry[] {
  const dates = weekDates(template.sourceWeek);
  const entries: TemplateEntry[] = [];
  for (const shift of template.shifts) {
    const day = dates.indexOf(localDate(shift.start));
    const endDayOffset = Math.round((Date.parse(localDate(shift.end)) - Date.parse(localDate(shift.start))) / 86400000);
    if (day < 0 || endDayOffset < 0 || endDayOffset > 2) throw new Error("טווח התבנית אינו מתאים לעריכה. הנתונים המקוריים נשמרו ללא שינוי.");
    const definition: TemplateEntry = { title: shift.title, group: shift.group, startTime: localTime(shift.start), endTime: localTime(shift.end), endDayOffset, required: shift.required, days: [day] };
    const equivalent = entries.find(entry => !entry.days.includes(day) && entry.title === definition.title && entry.group === definition.group && entry.startTime === definition.startTime && entry.endTime === definition.endTime && entry.endDayOffset === definition.endDayOffset && entry.required === definition.required);
    if (equivalent) equivalent.days.push(day);
    else entries.push(definition);
  }
  return entries.map(entry => ({ ...entry, days: entry.days.sort((a, b) => a - b) }));
}
