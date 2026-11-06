import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.includes("/auth/login"))
      window.location.assign(new URL("/login", window.location.origin));
    throw new Error(
      response.status === 409
        ? "הלוח עודכן בחלון אחר. השינויים שלך לא נשמרו. רעננו את הלוח ונסו שוב."
        : [
            data.error || "הפעולה לא הושלמה. נסו שוב.",
            ...(data.issues || [])
              .filter(
                (i: { severity: string }) =>
                  !i.severity || i.severity === "error",
              )
              .slice(0, 3)
              .map((i: { message: string }) => i.message),
          ].join(" "),
    );
  }
  return data as T;
}
