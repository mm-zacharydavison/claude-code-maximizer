import {
  calculateOptimalStartTimesFromProfile,
  type HourlyProfile,
} from "../analyzer/trigger-optimizer.ts";

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

/**
 * Parse a time string (HH:MM) to minutes since midnight.
 */
export function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/**
 * Convert minutes since midnight to HH:MM format.
 */
export function minutesToTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/**
 * Calculate all optimal window start times for a workday.
 *
 * Uses the TLA+ algorithm to find optimal trigger times that:
 * 1. Ensure no window exceeds quota
 * 2. Maximize the number of usable windows
 * 3. Maximize minimum slack (safety margin)
 *
 * @param workStart - Work start time in HH:MM format
 * @param workEnd - Work end time in HH:MM format
 * @param profile - Optional usage profile (uses default if not provided)
 * @returns Array of optimal start times in HH:MM format
 */
export function calculateOptimalStartTimes(
  workStart: string,
  workEnd: string,
  profile?: HourlyProfile
): string[] {
  return calculateOptimalStartTimesFromProfile(workStart, workEnd, profile);
}
