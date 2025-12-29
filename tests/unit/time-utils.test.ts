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
});
