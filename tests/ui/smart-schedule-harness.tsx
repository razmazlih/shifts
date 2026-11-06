import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SmartScheduleDialog } from "../../src/components/manager-workflows";
import type { Group, Shift, Template, WeekData } from "../../src/lib/types";

// Fictional data only. This harness never connects to the application or a DB.
const shift: Shift = { id: "demo-shift", title: "סיור בוקר", group: "PATROL", start: "2026-11-01T05:00:00Z", end: "2026-11-01T13:00:00Z", required: 1, assignments: [] };
const data: WeekData = { weekStart: "2026-11-01", shifts: [shift], revision: 7, publishedRevision: 6, publishedAt: null, hasDraft: true, issues: [], employees: [], rules: { minRestHours: 8, maxShiftHours: 12, defaultMaxWeeklyHours: 40 }, user: { id: "demo-admin", name: "מנהל לדוגמה", role: "ADMIN", employeeId: null } };
const templates: Template[] = [
  { id: "daily", name: "יום רגיל", sourceWeek: data.weekStart, shifts: [shift] },
  { id: "weekly", name: "שבוע רגיל", sourceWeek: data.weekStart, shifts: [shift, { ...shift, id: "monday", start: "2026-11-02T05:00:00Z", end: "2026-11-02T13:00:00Z" }] },
];

function Harness() {
  const params = new URLSearchParams(location.search);
  const [open, setOpen] = useState(true);
  const [template, setTemplate] = useState(params.get("template") ?? "");
  const [result, setResult] = useState("");
  return <main dir="rtl"><h1>הדגמה מקומית בלבד</h1><button onClick={() => setOpen(true)}>פתיחת שיבוץ</button><p role="status">{result}</p>{open && <SmartScheduleDialog
    data={params.has("empty") ? { ...data, shifts: [] } : data}
    templates={params.has("noTemplates") ? [] : templates}
    templatesError={params.has("templateError") ? "טעינה נכשלה" : undefined}
    selectedTemplate={template}
    initialTarget={params.get("target") ?? undefined}
    initialGroups={params.has("group") ? [params.get("group") as Group] : undefined}
    onSelectTemplate={setTemplate}
    onCreateTemplate={() => { setOpen(false); setResult("יצירת תבנית נפתחה"); }}
    onClose={() => setOpen(false)}
    onApplied={() => { setOpen(false); setResult("ההצעה נשמרה בטיוטה"); }}
  />}</main>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
