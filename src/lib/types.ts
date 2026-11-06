export type Group = "MANAGERS" | "PATROL";
export type Role = "ADMIN" | "EMPLOYEE";
export interface Assignment {
  employeeId: string;
  start: string;
  end: string;
}
export interface Shift {
  id: string;
  title: string;
  group: Group;
  start: string;
  end: string;
  required: number;
  assignments: Assignment[];
  note?: string;
}
export interface TimeOff {
  start: string;
  end: string;
  reason?: string;
}
export interface Availability {
  day: number;
  start: string;
  end: string;
}
export interface Employee {
  id: string;
  name: string;
  email?: string;
  active: boolean;
  groups: Group[];
  maxWeeklyHours: number;
  availability: Availability[];
  timeOff: TimeOff[];
  preferredDays: number[];
}
export interface Rules {
  minRestHours: number;
  maxShiftHours: number;
  defaultMaxWeeklyHours: number;
}
export interface Issue {
  code: string;
  message: string;
  severity: "error" | "warning";
  shiftId: string;
  employeeId?: string;
}
export interface SessionUser {
  id: string;
  name: string;
  role: Role;
  employeeId: string | null;
}
export interface AutoScheduleSummary {
  changedShiftIds: string[];
  resolvedErrors: number;
  remainingErrors: number;
  unfilledShifts: number;
}
export interface WeekData {
  autoSummary?: AutoScheduleSummary;
  weekStart: string;
  shifts: Shift[];
  revision: number;
  publishedRevision: number | null;
  publishedAt: string | null;
  hasDraft: boolean;
  issues: Issue[];
  employees: Employee[];
  rules: Rules;
  user: SessionUser;
  contextShifts?: Shift[];
}
export interface Template {
  id: string;
  name: string;
  shifts: Shift[];
  sourceWeek: string;
}
export const GROUP_LABELS: Record<Group, string> = {
  MANAGERS: "אחמ״שים",
  PATROL: "סיורים",
};
