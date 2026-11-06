export type Group = "MANAGERS" | "PATROL";
export type Role = "ADMIN" | "EMPLOYEE";
export interface Assignment {
  locked?: boolean;
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
  requestId?: string;
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
  updatedAt?: string;
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
  revision?: number;
  favorite?: boolean;
  name: string;
  shifts: Shift[];
  sourceWeek: string;
}
export interface TemplateEntry {
  title: string;
  group: Group;
  startTime: string;
  endTime: string;
  endDayOffset?: number;
  required: number;
  days: number[];
}
export const GROUP_LABELS: Record<Group, string> = {
  MANAGERS: "אחמ״שים",
  PATROL: "סיורים",
};

export type SchedulingMode = "fill" | "repair";
export interface SchedulingScope {
  days: number[];
  groups: Group[];
}
export interface SchedulingProposal {
  id: string;
  weekStart: string;
  revision: number;
  mode: SchedulingMode;
  scope: SchedulingScope;
  shifts: Shift[];
  changes: { shiftId: string; before: Shift | null; after: Shift | null }[];
  issues: Issue[];
  summary: {
    addedAssignments: number;
    changedAssignments: number;
    unchangedAssignments: number;
    unfilledShifts: number;
  };
  expiresAt: string;
}
