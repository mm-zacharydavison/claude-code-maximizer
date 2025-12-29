import { describe, test, expect } from "bun:test";
import {
  calculateOptimalStartTime,
  calculateDayRecommendation,
  formatTimeFromHourMinute,
} from "../../src/analyzer/optimizer.ts";
import type { DailyUsage, HourlyActivity } from "../../src/analyzer/aggregator.ts";

describe("optimizer", () => {
  describe("calculateOptimalStartTime", () => {
    test("returns null for empty data", () => {
      const result = calculateOptimalStartTime([]);

      expect(result).toBeNull();
    });

    test("recommends start time based on earliest activity", () => {
      // Usage starting at 9am
      const dailyUsage: DailyUsage[] = [
        createDailyUsage("2024-01-15", [9, 10, 11], 50),
        createDailyUsage("2024-01-16", [9, 10, 11], 60),
        createDailyUsage("2024-01-17", [9, 10, 11], 55),
      ];

      const result = calculateOptimalStartTime(dailyUsage);

      expect(result).not.toBeNull();
      // Should recommend starting at 8:45 (15 min before 9)
      expect(result?.startHour).toBe(8);
      expect(result?.startMinute).toBe(45);
    });

    test("calculates expected utilization correctly", () => {
      const dailyUsage: DailyUsage[] = [
        createDailyUsage("2024-01-15", [9, 10, 11], 60),
        createDailyUsage("2024-01-16", [9, 10, 11], 60),
      ];

      const result = calculateOptimalStartTime(dailyUsage);

      expect(result).not.toBeNull();
      // Utilization is capped at 100
      expect(result?.expectedUtilization).toBeGreaterThan(0);
      expect(result?.expectedUtilization).toBeLessThanOrEqual(100);
    });

    test("has high confidence for consistent patterns", () => {
      // 5+ days of data should give full confidence
      const dailyUsage: DailyUsage[] = [
        createDailyUsage("2024-01-15", [9, 10, 11], 50),
        createDailyUsage("2024-01-16", [9, 10, 11], 50),
        createDailyUsage("2024-01-17", [9, 10, 11], 50),
        createDailyUsage("2024-01-18", [9, 10, 11], 50),
        createDailyUsage("2024-01-19", [9, 10, 11], 50),
      ];

      const result = calculateOptimalStartTime(dailyUsage);

      expect(result).not.toBeNull();
      expect(result?.confidence).toBeGreaterThanOrEqual(1.0);
    });

    test("has lower confidence for less data", () => {
      // Only 2 days of data
      const dailyUsage: DailyUsage[] = [
        createDailyUsage("2024-01-15", [9, 10, 11], 50),
        createDailyUsage("2024-01-16", [9, 10, 11], 50),
      ];

      const result = calculateOptimalStartTime(dailyUsage);

      expect(result).not.toBeNull();
      expect(result?.confidence).toBeLessThan(1.0);
    });

    test("handles midnight edge case", () => {
      // Usage at early hours
      const dailyUsage: DailyUsage[] = [
        createDailyUsage("2024-01-15", [0, 1, 2], 50),
      ];

      const result = calculateOptimalStartTime(dailyUsage);

      expect(result).not.toBeNull();
      // Should recommend starting at 23:45 (15 min before midnight)
      expect(result?.startHour).toBe(23);
      expect(result?.startMinute).toBe(45);
    });
  });

  describe("calculateDayRecommendation", () => {
    test("returns empty windows for no data", () => {
      const result = calculateDayRecommendation("monday", []);

      expect(result.day).toBe("monday");
      expect(result.windows.length).toBe(0);
      expect(result.totalExpectedHours).toBe(0);
      expect(result.avgUsage).toBe(0);
    });

    test("calculates expected hours based on active hours", () => {
      const dailyUsage: DailyUsage[] = [
        createDailyUsage("2024-01-15", [9, 10, 11, 12, 13, 14], 50), // 6 hours
      ];

      const result = calculateDayRecommendation("monday", dailyUsage);

      expect(result.totalExpectedHours).toBe(6);
    });

    test("calculates average usage from multiple days", () => {
      const dailyUsage: DailyUsage[] = [
        createDailyUsage("2024-01-15", [9, 10, 11], 40),
        createDailyUsage("2024-01-22", [9, 10, 11], 60),
      ];

      const result = calculateDayRecommendation("monday", dailyUsage);

      expect(result.avgUsage).toBe(50); // (40 + 60) / 2
      expect(result.windows.length).toBe(1);
    });
  });

  describe("formatTimeFromHourMinute", () => {
    test("formats single-digit hours with leading zero", () => {
      expect(formatTimeFromHourMinute(9, 0)).toBe("09:00");
      expect(formatTimeFromHourMinute(9, 30)).toBe("09:30");
    });

    test("formats double-digit hours correctly", () => {
      expect(formatTimeFromHourMinute(14, 0)).toBe("14:00");
      expect(formatTimeFromHourMinute(23, 59)).toBe("23:59");
    });

    test("formats midnight correctly", () => {
      expect(formatTimeFromHourMinute(0, 0)).toBe("00:00");
    });

    test("formats single-digit minutes with leading zero", () => {
      expect(formatTimeFromHourMinute(10, 5)).toBe("10:05");
    });
  });
});

// Helper to create a DailyUsage object with the new interface
function createDailyUsage(date: string, activeHours: number[], avgUsagePct: number): DailyUsage {
  const hours: HourlyActivity[] = activeHours.map(hour => ({
    hour,
    usagePct: avgUsagePct,
  }));

  const peakHour = activeHours.length > 0 ? activeHours[Math.floor(activeHours.length / 2)]! : 0;

  return {
    date,
    hours,
    peakHour,
    peakUsage: avgUsagePct,
    totalActiveHours: hours.length,
    avgUsage: avgUsagePct,
  };
}
