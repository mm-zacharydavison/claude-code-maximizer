import { describe, test, expect } from "bun:test";
import {
  isValidNumber,
  isValidTimestamp,
  isValidTimeString,
  safeParseJson,
  safeExecute,
} from "../../src/utils/errors.ts";

describe("error utilities", () => {
  describe("isValidNumber", () => {
    test("returns true for valid numbers", () => {
      expect(isValidNumber(0)).toBe(true);
      expect(isValidNumber(42)).toBe(true);
      expect(isValidNumber(-10)).toBe(true);
      expect(isValidNumber(3.14)).toBe(true);
    });

    test("returns false for NaN", () => {
      expect(isValidNumber(NaN)).toBe(false);
    });

    test("returns false for Infinity", () => {
      expect(isValidNumber(Infinity)).toBe(false);
      expect(isValidNumber(-Infinity)).toBe(false);
    });

    test("returns false for non-numbers", () => {
      expect(isValidNumber("42")).toBe(false);
      expect(isValidNumber(null)).toBe(false);
      expect(isValidNumber(undefined)).toBe(false);
      expect(isValidNumber({})).toBe(false);
    });
  });

  describe("isValidTimestamp", () => {
    test("returns true for valid ISO timestamps", () => {
      expect(isValidTimestamp("2024-12-28T09:00:00.000Z")).toBe(true);
      expect(isValidTimestamp("2024-12-28T09:00:00Z")).toBe(true);
      expect(isValidTimestamp("2024-01-01")).toBe(true);
    });

    test("returns false for invalid timestamps", () => {
      expect(isValidTimestamp("not a date")).toBe(false);
      expect(isValidTimestamp("2024-99-99")).toBe(false);
      expect(isValidTimestamp("")).toBe(false);
    });

    test("returns false for non-strings", () => {
      expect(isValidTimestamp(null)).toBe(false);
      expect(isValidTimestamp(undefined)).toBe(false);
      expect(isValidTimestamp(123456)).toBe(false);
      expect(isValidTimestamp(new Date())).toBe(false);
    });
  });

  describe("isValidTimeString", () => {
    test("returns true for valid HH:MM format", () => {
      expect(isValidTimeString("09:00")).toBe(true);
      expect(isValidTimeString("00:00")).toBe(true);
      expect(isValidTimeString("23:59")).toBe(true);
      expect(isValidTimeString("12:30")).toBe(true);
    });

    test("returns false for invalid hour", () => {
      expect(isValidTimeString("24:00")).toBe(false);
      expect(isValidTimeString("25:00")).toBe(false);
    });

    test("returns false for invalid minute", () => {
      expect(isValidTimeString("12:60")).toBe(false);
      expect(isValidTimeString("12:99")).toBe(false);
    });

    test("returns false for wrong format", () => {
      expect(isValidTimeString("9:00")).toBe(false); // Missing leading zero
      expect(isValidTimeString("09:0")).toBe(false); // Missing trailing zero
      expect(isValidTimeString("0900")).toBe(false); // Missing colon
      expect(isValidTimeString("09:00:00")).toBe(false); // Extra seconds
    });

    test("returns false for non-strings", () => {
      expect(isValidTimeString(null)).toBe(false);
      expect(isValidTimeString(undefined)).toBe(false);
      expect(isValidTimeString(900)).toBe(false);
    });
  });

  describe("safeParseJson", () => {
    test("parses valid JSON", () => {
      const result = safeParseJson('{"key": "value"}', {});

      expect(result).toEqual({ key: "value" });
    });

    test("returns fallback for invalid JSON", () => {
      const fallback = { default: true };
      const result = safeParseJson("not json", fallback);

      expect(result).toEqual(fallback);
    });

    test("returns fallback for empty string", () => {
      const fallback = { default: true };
      const result = safeParseJson("", fallback);

      expect(result).toEqual(fallback);
    });

    test("parses arrays", () => {
      const result = safeParseJson("[1, 2, 3]", []);

      expect(result).toEqual([1, 2, 3]);
    });

    test("parses primitive values", () => {
      expect(safeParseJson("42", 0)).toBe(42);
      expect(safeParseJson('"hello"', "")).toBe("hello");
      expect(safeParseJson("true", false)).toBe(true);
      expect(safeParseJson("null", "fallback")).toBe(null);
    });
  });

  describe("safeExecute", () => {
    test("returns function result on success", () => {
      const result = safeExecute("test", () => 42);

      expect(result).toBe(42);
    });

    test("returns fallback on error", () => {
      const result = safeExecute(
        "test",
        () => {
          throw new Error("test error");
        },
        "fallback"
      );

      expect(result).toBe("fallback");
    });

    test("returns undefined when error and no fallback", () => {
      const result = safeExecute("test", () => {
        throw new Error("test error");
      });

      expect(result).toBeUndefined();
    });

    test("catches all error types", () => {
      const result1 = safeExecute(
        "test",
        () => {
          throw new Error("Error");
        },
        "fallback"
      );
      const result2 = safeExecute(
        "test",
        () => {
          throw "string error";
        },
        "fallback"
      );
      const result3 = safeExecute(
        "test",
        () => {
          throw 42;
        },
        "fallback"
      );

      expect(result1).toBe("fallback");
      expect(result2).toBe("fallback");
      expect(result3).toBe("fallback");
    });

    test("returns promise when function returns promise", async () => {
      // safeExecute is synchronous, so async errors aren't caught by it
      const result = safeExecute("test", () => Promise.resolve("success"), "fallback");

      // Returns the resolved promise
      expect(result).toBeInstanceOf(Promise);
      expect(await result).toBe("success");
    });
  });
});
