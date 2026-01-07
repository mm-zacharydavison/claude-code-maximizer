export const WINDOW_DURATION_MS = 5 * 60 * 60 * 1000; // 5 hours in ms
export const WINDOW_DURATION_MINUTES = 300; // 5 hours in minutes

export function now(): string {
  return new Date().toISOString();
}

export function toISO(date: Date): string {
  return date.toISOString();
}

export function fromISO(iso: string): Date {
  return new Date(iso);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function diffMinutes(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (60 * 1000);
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDayOfWeek(date: Date): string {
  const days = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  return days[date.getDay()]!;
}

export function isWithinWindow(
  timestamp: Date,
  windowStart: Date,
  windowDurationMs: number = WINDOW_DURATION_MS
): boolean {
  const windowEnd = new Date(windowStart.getTime() + windowDurationMs);
  return timestamp >= windowStart && timestamp < windowEnd;
}

export function getWindowEnd(windowStart: Date): Date {
  const rawEnd = addHours(windowStart, 5);
  return roundToNearestHour(rawEnd);
}

export function roundToNearestHour(date: Date): Date {
  const result = new Date(date);
  // Round to nearest hour (>=30 min rounds up)
  if (result.getMinutes() >= 30) {
    result.setHours(result.getHours() + 1);
  }
  result.setMinutes(0, 0, 0);
  return result;
}
