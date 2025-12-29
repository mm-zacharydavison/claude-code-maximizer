import { describe, test, expect } from "bun:test";
import { aggregateByDay, getWeekdayDistribution, getHourlyDistribution, type DailyUsage } from "../../src/analyzer/aggregator.ts";
import type { HourlyUsageRecord } from "../../src/db/queries.ts";

describe("aggregator", () => {
  describe("aggregateByDay", () => {
    test("returns empty map for empty input", () => {
      const result = aggregateByDay([]);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    test("groups hourly records by date", () => {
      const records: HourlyUsageRecord[] = [
        { date_hour: "2024-01-15-09", usage_pct: 50, updated_at: "2024-01-15T09:00:00.000Z" },
        { date_hour: "2024-01-15-10", usage_pct: 60, updated_at: "2024-01-15T10:00:00.000Z" },
        { date_hour: "2024-01-14-09", usage_pct: 40, updated_at: "2024-01-14T09:00:00.000Z" },
      ];

      const result = aggregateByDay(records);

      expect(result.size).toBe(2);
      expect(result.get("2024-01-15")?.hours.length).toBe(2);
      expect(result.get("2024-01-14")?.hours.length).toBe(1);
    });

    test("calculates peak hour correctly", () => {
      const records: HourlyUsageRecord[] = [
        { date_hour: "2024-01-15-09", usage_pct: 30, updated_at: "2024-01-15T09:00:00.000Z" },
        { date_hour: "2024-01-15-10", usage_pct: 80, updated_at: "2024-01-15T10:00:00.000Z" },
        { date_hour: "2024-01-15-11", usage_pct: 50, updated_at: "2024-01-15T11:00:00.000Z" },
      ];

      const result = aggregateByDay(records);
      const dayUsage = result.get("2024-01-15");

      expect(dayUsage?.peakHour).toBe(10);
      expect(dayUsage?.peakUsage).toBe(80);
    });

    test("calculates average usage correctly", () => {
      const records: HourlyUsageRecord[] = [
        { date_hour: "2024-01-15-09", usage_pct: 40, updated_at: "2024-01-15T09:00:00.000Z" },
        { date_hour: "2024-01-15-10", usage_pct: 60, updated_at: "2024-01-15T10:00:00.000Z" },
        { date_hour: "2024-01-15-11", usage_pct: 80, updated_at: "2024-01-15T11:00:00.000Z" },
      ];

      const result = aggregateByDay(records);
      const dayUsage = result.get("2024-01-15");

      expect(dayUsage?.avgUsage).toBe(60); // (40 + 60 + 80) / 3
      expect(dayUsage?.totalActiveHours).toBe(3);
    });
  });

  describe("getHourlyDistribution", () => {
    test("returns array of 24 zeros for empty input", () => {
      const result = getHourlyDistribution([]);
      expect(result.length).toBe(24);
      expect(result.every(v => v === 0)).toBe(true);
    });

    test("counts records per hour", () => {
      const records: HourlyUsageRecord[] = [
        { date_hour: "2024-01-15-09", usage_pct: 50, updated_at: "2024-01-15T09:00:00.000Z" },
        { date_hour: "2024-01-16-09", usage_pct: 50, updated_at: "2024-01-16T09:00:00.000Z" },
        { date_hour: "2024-01-15-10", usage_pct: 50, updated_at: "2024-01-15T10:00:00.000Z" },
      ];

      const result = getHourlyDistribution(records);

      expect(result[9]).toBe(2); // Two records at 9am
      expect(result[10]).toBe(1); // One record at 10am
    });
  });

  describe("getWeekdayDistribution", () => {
    test("returns all 7 weekdays", () => {
      const result = getWeekdayDistribution(new Map());
      expect(result.size).toBe(7);
    });

    test("groups daily usage by weekday", () => {
      const dailyUsage = new Map<string, DailyUsage>();

      // 2024-01-15 is a Monday
      dailyUsage.set("2024-01-15", createDailyUsage("2024-01-15"));
      // 2024-01-16 is a Tuesday
      dailyUsage.set("2024-01-16", createDailyUsage("2024-01-16"));

      const result = getWeekdayDistribution(dailyUsage);

      expect(result.get("monday")?.length).toBe(1);
      expect(result.get("tuesday")?.length).toBe(1);
      expect(result.get("wednesday")?.length).toBe(0);
    });

    test("correctly maps dates to weekdays", () => {
      const dailyUsage = new Map<string, DailyUsage>();

      // 2024-12-29 is a Sunday
      // 2024-12-30 is a Monday
      dailyUsage.set("2024-12-29", createDailyUsage("2024-12-29"));
      dailyUsage.set("2024-12-30", createDailyUsage("2024-12-30"));

      const result = getWeekdayDistribution(dailyUsage);

      expect(result.get("sunday")?.length).toBe(1);
      expect(result.get("monday")?.length).toBe(1);
      expect(result.get("tuesday")?.length).toBe(0);
    });
  });
});

function createDailyUsage(date: string): DailyUsage {
  return {
    date,
    hours: [
      { hour: 9, usagePct: 50 },
      { hour: 10, usagePct: 60 },
      { hour: 11, usagePct: 70 },
    ],
    peakHour: 11,
    peakUsage: 70,
    totalActiveHours: 3,
    avgUsage: 60,
  };
}
