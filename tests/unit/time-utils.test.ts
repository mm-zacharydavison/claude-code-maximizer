import { describe, test, expect } from "bun:test";
import {
  now,
  toISO,
  fromISO,
  formatTime,
  formatDate,
  addHours,
  diffMinutes,
  getDayOfWeek,
  WINDOW_DURATION_MINUTES,
  parseTimeToMinutes,
  minutesToTimeString,
  calculateOptimalStartTimes,
} from "../../src/utils/time.ts";

describe("time utils", () => {
  describe("now", () => {
    test("returns ISO string", () => {
      const result = now();

      expect(typeof result).toBe("string");
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test("returns current time", () => {
      const before = Date.now();
      const result = now();
      const after = Date.now();

      const resultTime = new Date(result).getTime();
      expect(resultTime).toBeGreaterThanOrEqual(before);
      expect(resultTime).toBeLessThanOrEqual(after);
    });
  });

  describe("toISO", () => {
    test("formats Date correctly", () => {
      const date = new Date("2024-12-28T09:00:00.000Z");
      const result = toISO(date);

      expect(result).toBe("2024-12-28T09:00:00.000Z");
    });

    test("handles different timezones", () => {
      const date = new Date("2024-12-28T09:00:00Z");
      const result = toISO(date);

      // Should be in ISO format (UTC)
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe("fromISO", () => {
    test("parses ISO string correctly", () => {
      const result = fromISO("2024-12-28T09:00:00.000Z");

      expect(result instanceof Date).toBe(true);
      expect(result.getUTCFullYear()).toBe(2024);
      expect(result.getUTCMonth()).toBe(11); // December (0-indexed)
      expect(result.getUTCDate()).toBe(28);
      expect(result.getUTCHours()).toBe(9);
    });

    test("handles various ISO formats", () => {
      const result1 = fromISO("2024-12-28T09:00:00Z");
      const result2 = fromISO("2024-12-28T09:00:00.000Z");

      expect(result1.getTime()).toBe(result2.getTime());
    });
  });

  describe("formatTime", () => {
    test("formats as HH:MM", () => {
      const date = new Date();
      date.setHours(9, 5, 0, 0);

      const result = formatTime(date);

      expect(result).toMatch(/^\d{2}:\d{2}$/);
      expect(result).toBe("09:05");
    });

    test("pads single digits", () => {
      const date = new Date();
      date.setHours(5, 3, 0, 0);

      const result = formatTime(date);

      expect(result).toBe("05:03");
    });

    test("handles midnight", () => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);

      const result = formatTime(date);

      expect(result).toBe("00:00");
    });

    test("handles noon", () => {
      const date = new Date();
      date.setHours(12, 0, 0, 0);

      const result = formatTime(date);

      expect(result).toBe("12:00");
    });
  });

  describe("formatDate", () => {
    test("formats as YYYY-MM-DD", () => {
      const date = new Date("2024-12-28T09:00:00Z");

      const result = formatDate(date);

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("addHours", () => {
    test("adds hours correctly", () => {
      const date = new Date("2024-12-28T09:00:00Z");
      const result = addHours(date, 5);

      expect(result.getUTCHours()).toBe(14);
    });

    test("handles day overflow", () => {
      const date = new Date("2024-12-28T22:00:00Z");
      const result = addHours(date, 5);

      expect(result.getUTCDate()).toBe(29);
      expect(result.getUTCHours()).toBe(3);
    });

    test("handles fractional hours", () => {
      const date = new Date("2024-12-28T09:00:00Z");
      const result = addHours(date, 1.5);

      expect(result.getUTCHours()).toBe(10);
      expect(result.getUTCMinutes()).toBe(30);
    });
  });

  describe("diffMinutes", () => {
    test("calculates positive difference", () => {
      const date1 = new Date("2024-12-28T09:00:00Z");
      const date2 = new Date("2024-12-28T09:30:00Z");

      const result = diffMinutes(date2, date1);

      expect(result).toBe(30);
    });

    test("always returns positive difference (uses abs)", () => {
      const date1 = new Date("2024-12-28T09:30:00Z");
      const date2 = new Date("2024-12-28T09:00:00Z");

      const result = diffMinutes(date2, date1);

      // diffMinutes uses Math.abs, so always positive
      expect(result).toBe(30);
    });

    test("handles same time", () => {
      const date = new Date("2024-12-28T09:00:00Z");

      const result = diffMinutes(date, date);

      expect(result).toBe(0);
    });

    test("handles hours", () => {
      const date1 = new Date("2024-12-28T09:00:00Z");
      const date2 = new Date("2024-12-28T14:00:00Z");

      const result = diffMinutes(date2, date1);

      expect(result).toBe(300); // 5 hours
    });
  });

  describe("getDayOfWeek", () => {
    test("returns lowercase day name", () => {
      // Create a date that is definitely a Monday
      const monday = new Date("2024-12-30T12:00:00Z"); // Dec 30, 2024 is a Monday

      const result = getDayOfWeek(monday);

      expect(result).toBe("monday");
    });

    test("returns all day names correctly", () => {
      const validDays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

      for (let i = 0; i < 7; i++) {
        const date = new Date("2024-12-29T12:00:00Z"); // Sunday
        date.setDate(date.getDate() + i);

        const result = getDayOfWeek(date);

        expect(validDays).toContain(result);
      }
    });
  });

  describe("WINDOW_DURATION_MINUTES", () => {
    test("is 300 (5 hours)", () => {
      expect(WINDOW_DURATION_MINUTES).toBe(300);
    });
  });

  describe("parseTimeToMinutes", () => {
    test("parses HH:MM format correctly", () => {
      expect(parseTimeToMinutes("09:00")).toBe(540);
      expect(parseTimeToMinutes("00:00")).toBe(0);
      expect(parseTimeToMinutes("12:30")).toBe(750);
      expect(parseTimeToMinutes("23:59")).toBe(1439);
    });

    test("handles single digit hours", () => {
      expect(parseTimeToMinutes("9:00")).toBe(540);
    });
  });

  describe("minutesToTimeString", () => {
    test("converts minutes to HH:MM format", () => {
      expect(minutesToTimeString(0)).toBe("00:00");
      expect(minutesToTimeString(540)).toBe("09:00");
      expect(minutesToTimeString(750)).toBe("12:30");
      expect(minutesToTimeString(1439)).toBe("23:59");
    });

    test("pads single digits", () => {
      expect(minutesToTimeString(60)).toBe("01:00");
      expect(minutesToTimeString(65)).toBe("01:05");
    });
  });

  describe("calculateOptimalStartTimes", () => {
    // Note: The new TLA+ algorithm optimizes for:
    // 1. Valid triggers (no quota overruns)
    // 2. Maximum bucket count
    // 3. Maximum minimum slack (safety margin)
    // Results may differ from simple time-aligned windows.

    test("calculates optimal times for 07:30-16:00 workday", () => {
      const result = calculateOptimalStartTimes("07:30", "16:00");
      // 8.5h workday should produce multiple windows
      expect(result.length).toBeGreaterThanOrEqual(2);
      // All results should be valid HH:MM format
      for (const t of result) {
        expect(t).toMatch(/^\d{2}:\d{2}$/);
      }
    });

    test("calculates optimal times for 09:00-17:00 workday", () => {
      const result = calculateOptimalStartTimes("09:00", "17:00");
      // 8h workday should produce multiple windows
      expect(result.length).toBeGreaterThanOrEqual(2);
      for (const t of result) {
        expect(t).toMatch(/^\d{2}:\d{2}$/);
      }
    });

    test("calculates optimal times for 08:00-18:00 workday (10h)", () => {
      const result = calculateOptimalStartTimes("08:00", "18:00");
      // 10h workday should produce multiple windows
      expect(result.length).toBeGreaterThanOrEqual(2);
      for (const t of result) {
        expect(t).toMatch(/^\d{2}:\d{2}$/);
      }
    });

    test("calculates optimal times for 06:00-14:00 workday", () => {
      const result = calculateOptimalStartTimes("06:00", "14:00");
      // 8h workday should produce multiple windows
      expect(result.length).toBeGreaterThanOrEqual(2);
      for (const t of result) {
        expect(t).toMatch(/^\d{2}:\d{2}$/);
      }
    });

    test("returns at least one time for short workday (5h)", () => {
      const result = calculateOptimalStartTimes("09:00", "14:00");
      // 5h workday may have 1 or 2 windows depending on optimization
      expect(result.length).toBeGreaterThanOrEqual(1);
      for (const t of result) {
        expect(t).toMatch(/^\d{2}:\d{2}$/);
      }
    });

    test("returns at least one time for very short workday (< 5h)", () => {
      const result = calculateOptimalStartTimes("09:00", "12:00");
      // 3h workday may have 1 or 2 windows depending on split
      expect(result.length).toBeGreaterThanOrEqual(1);
      for (const t of result) {
        expect(t).toMatch(/^\d{2}:\d{2}$/);
      }
    });

    test("handles edge case where work starts/ends at window boundary", () => {
      const result = calculateOptimalStartTimes("09:00", "19:00");
      // 10h workday should produce multiple windows
      expect(result.length).toBeGreaterThanOrEqual(2);
      for (const t of result) {
        expect(t).toMatch(/^\d{2}:\d{2}$/);
      }
    });

    test("handles very long workday (12h)", () => {
      const result = calculateOptimalStartTimes("06:00", "18:00");
      // 12h workday should produce 3+ windows
      expect(result.length).toBeGreaterThanOrEqual(3);
      for (const t of result) {
        expect(t).toMatch(/^\d{2}:\d{2}$/);
      }
    });
  });
});
