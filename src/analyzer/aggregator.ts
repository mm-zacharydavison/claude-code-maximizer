import type { HourlyUsageRecord } from "../db/queries.ts";

export interface HourlyActivity {
  hour: number;
  usagePct: number;
}

export interface DailyUsage {
  date: string;
  hours: HourlyActivity[];
  peakHour: number;
  peakUsage: number;
  totalActiveHours: number;
  avgUsage: number;
}

/**
 * Parse date_hour format (YYYY-MM-DD-HH) into date and hour
 */
function parseDateHour(dateHour: string): { date: string; hour: number } {
  const parts = dateHour.split("-");
  const date = `${parts[0]}-${parts[1]}-${parts[2]}`;
  const hour = parseInt(parts[3]!, 10);
  return { date, hour };
}

/**
 * Aggregate hourly usage records by day
 */
export function aggregateByDay(records: HourlyUsageRecord[]): Map<string, DailyUsage> {
  const byDay = new Map<string, HourlyActivity[]>();

  for (const record of records) {
    const { date, hour } = parseDateHour(record.date_hour);
    if (!byDay.has(date)) {
      byDay.set(date, []);
    }
    byDay.get(date)!.push({ hour, usagePct: record.usage_pct });
  }

  const result = new Map<string, DailyUsage>();

  for (const [date, hours] of byDay) {
    // Sort by hour
    hours.sort((a, b) => a.hour - b.hour);

    // Find peak hour
    let peakHour = 0;
    let peakUsage = 0;
    let totalUsage = 0;

    for (const h of hours) {
      totalUsage += h.usagePct;
      if (h.usagePct > peakUsage) {
        peakUsage = h.usagePct;
        peakHour = h.hour;
      }
    }

    result.set(date, {
      date,
      hours,
      peakHour,
      peakUsage,
      totalActiveHours: hours.length,
      avgUsage: hours.length > 0 ? totalUsage / hours.length : 0,
    });
  }

  return result;
}

/**
 * Get hourly distribution across all records (count of records per hour)
 */
export function getHourlyDistribution(records: HourlyUsageRecord[]): number[] {
  const hours = new Array(24).fill(0) as number[];

  for (const record of records) {
    const { hour } = parseDateHour(record.date_hour);
    if (hour >= 0 && hour < 24) {
      hours[hour] = (hours[hour] ?? 0) + 1;
    }
  }

  return hours;
}

/**
 * Get average usage per hour across all records
 */
export function getHourlyAvgUsage(records: HourlyUsageRecord[]): number[] {
  const hourTotals = new Array(24).fill(0) as number[];
  const hourCounts = new Array(24).fill(0) as number[];

  for (const record of records) {
    const { hour } = parseDateHour(record.date_hour);
    if (hour >= 0 && hour < 24) {
      hourTotals[hour] = (hourTotals[hour] ?? 0) + record.usage_pct;
      hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
    }
  }

  return hourTotals.map((total, i) =>
    hourCounts[i]! > 0 ? total / hourCounts[i]! : 0
  );
}

/**
 * Group daily usage by weekday
 */
export function getWeekdayDistribution(
  dailyUsage: Map<string, DailyUsage>
): Map<string, DailyUsage[]> {
  const weekdays = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  const result = new Map<string, DailyUsage[]>();
  for (const day of weekdays) {
    result.set(day, []);
  }

  for (const [date, usage] of dailyUsage) {
    const dayOfWeek = weekdays[new Date(date).getDay()]!;
    result.get(dayOfWeek)!.push(usage);
  }

  return result;
}
