import type { Employee } from "../src/lib/types";

export const DEMO_ROSTER: Pick<Employee, "name" | "groups">[] = [
  { name: "אריק", groups: ["MANAGERS", "PATROL"] },
  { name: "סרגיי", groups: ["MANAGERS", "PATROL"] },
  { name: "דוד", groups: ["MANAGERS", "PATROL"] },
  { name: "יורי", groups: ["MANAGERS", "PATROL"] },
  { name: "בן", groups: ["MANAGERS", "PATROL"] },
  { name: "גרוס", groups: ["MANAGERS"] },
  { name: "לירן", groups: ["MANAGERS"] },
  { name: "חן", groups: ["PATROL"] },
  { name: "רן", groups: ["PATROL"] },
  { name: "משה", groups: ["PATROL"] },
  { name: "אלכס", groups: ["PATROL"] },
  { name: "ארתור", groups: ["MANAGERS", "PATROL"] },
  { name: "דניאל", groups: ["PATROL"] },
  { name: "ציון", groups: ["PATROL"] },
  { name: "שגב", groups: ["PATROL", "MANAGERS"] },
];

// Separate rotation pools keep dual-qualified people from being booked twice.
// Qualifications remain available for manual and automatic scheduling.
export const DEMO_MANAGER_ROTATION = ["אריק", "סרגיי", "דוד", "גרוס", "לירן"];

export function demoAssignees(
  people: Employee[],
  date: string,
  group: Employee["groups"][number],
  night: boolean,
): Employee[] {
  const rotation = Math.floor(Date.parse(date + "T00:00:00Z") / 86400000);
  const groupPeople = people.filter((p) =>
    group === "MANAGERS"
      ? DEMO_MANAGER_ROTATION.includes(p.name)
      : !DEMO_MANAGER_ROTATION.includes(p.name) && p.groups.includes(group),
  );
  const count = group === "PATROL" ? 2 : 1;
  const base = ((rotation + (night ? 2 : 0)) % 5) * count;
  return Array.from({ length: count }, (_, i) => groupPeople[(base + i) % groupPeople.length]);
}
