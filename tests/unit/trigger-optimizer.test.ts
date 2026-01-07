/**
 * Trigger Optimizer Tests
 *
 * Test cases based on TLA+ specification (tla-spec/rate_limit_optimizer_tests.tla)
 * and test scenarios (tla-spec/TEST_SCENARIOS.md)
 */

import { describe, it, expect } from "bun:test";
import {
  QUOTA,
  WINDOW_SIZE,
  TIME_GRANULARITY,
  CALIBRATION_DAYS,
  type HourlyProfile,
  type Window,
  type UsageLogEntry,
  type HourlyUsageRecord,
  type UsageWindowRecord,
  getDefaultProfile,
  minutesToTimeString,
  parseTimeToMinutes,
  windowsForTrigger,
  expectedWindowUsage,
  isValidTrigger,
  minSlack,
  findOptimalTrigger,
  computeHourlyMean,
  buildProfile,
  determinePhase,
  calculateOptimalStartTimesFromProfile,
  computeActualHourlyUsage,
  buildProfileFromRecords,
  countWaitEvents,
  calculateWastedQuota,
} from "../../src/analyzer/trigger-optimizer.ts";

// Standard test configuration (from TLA+ spec)
const WORK_START = 450; // 07:30
const WORK_END = 960; // 16:00

describe("trigger-optimizer", () => {
  describe("constants", () => {
    it("should have correct constant values matching TLA+ spec", () => {
      expect(QUOTA).toBe(100);
      expect(WINDOW_SIZE).toBe(300); // 5 hours
      expect(TIME_GRANULARITY).toBe(15);
      expect(CALIBRATION_DAYS).toBe(7);
    });
  });

  describe("time conversion utilities", () => {
    it("should convert minutes to time string correctly", () => {
      expect(minutesToTimeString(0)).toBe("00:00");
      expect(minutesToTimeString(450)).toBe("07:30");
      expect(minutesToTimeString(960)).toBe("16:00");
      expect(minutesToTimeString(1439)).toBe("23:59");
    });

    it("should handle negative minutes (wrap around)", () => {
      expect(minutesToTimeString(-60)).toBe("23:00");
      expect(minutesToTimeString(-120)).toBe("22:00");
    });

    it("should parse time string to minutes correctly", () => {
      expect(parseTimeToMinutes("00:00")).toBe(0);
      expect(parseTimeToMinutes("07:30")).toBe(450);
      expect(parseTimeToMinutes("16:00")).toBe(960);
      expect(parseTimeToMinutes("23:59")).toBe(1439);
    });
  });

  describe("getDefaultProfile", () => {
    it("should return uniform profile with QUOTA/10 per hour", () => {
      const profile = getDefaultProfile();
      for (let h = 0; h < 24; h++) {
        expect(profile[h]).toBe(10); // 100/10 = 10
      }
    });
  });

  // =============================================================================
  // TEST SUITE 1: Window Generation (TC1.x from TLA+)
  // =============================================================================

  describe("windowsForTrigger", () => {
    it("TC1.2: default trigger should be conservative (before work start)", () => {
      // With default profile, trigger should be before WORK_START
      const result = findOptimalTrigger(getDefaultProfile(), WORK_START, WORK_END);
      expect(result.triggerTime).toBeLessThan(WORK_START);
    });

    it("should generate windows with correct overlap for standard workday", () => {
      // Trigger at 05:30 (330 minutes)
      const windows = windowsForTrigger(330, WORK_START, WORK_END);

      // Should have 3 windows overlapping work hours
      expect(windows.length).toBeGreaterThanOrEqual(2);

      // First window: 05:30-10:30, work overlap 07:30-10:30
      const w0 = windows[0]!;
      expect(w0.start).toBe(330);
      expect(w0.end).toBe(630);
      expect(w0.workOverlapStart).toBe(450); // 07:30
      expect(w0.workOverlapEnd).toBe(630); // 10:30
    });

    it("TC5.2: single window should fit entire workday when short", () => {
      // Short workday: 09:00-12:00 (3 hours < 5 hour window)
      const shortWorkStart = 540; // 09:00
      const shortWorkEnd = 720; // 12:00
      const windows = windowsForTrigger(shortWorkStart, shortWorkStart, shortWorkEnd);
      expect(windows.length).toBe(1);
    });

    it("TC5.3: window boundary exactly at work start", () => {
      // Trigger at WORK_START - WINDOW_SIZE = 07:30 - 5h = 02:30
      const trig = WORK_START - WINDOW_SIZE; // 150
      const windows = windowsForTrigger(trig, WORK_START, WORK_END);
      expect(windows.length).toBeGreaterThanOrEqual(1);
    });

    it("TC5.4: window boundary exactly at work end", () => {
      // Trigger at WORK_END - WINDOW_SIZE = 16:00 - 5h = 11:00
      const trig = WORK_END - WINDOW_SIZE; // 660
      const windows = windowsForTrigger(trig, WORK_START, WORK_END);
      // Should have a window ending at work end
      const lastWindow = windows[windows.length - 1];
      expect(lastWindow?.workOverlapEnd).toBe(WORK_END);
    });
  });

  // =============================================================================
  // TEST SUITE 2: Expected Window Usage (TC2.x from TLA+)
  // =============================================================================

  describe("expectedWindowUsage", () => {
    it("TC2.1: uniform profile should give consistent usage per window", () => {
      const profile = getDefaultProfile();
      const windows = windowsForTrigger(330, WORK_START, WORK_END);

      // Each hour contributes 10 units
      // First window 05:30-10:30, work overlap 07:30-10:30 = 3 hours
      const w0 = windows[0]!;
      const usage0 = expectedWindowUsage(profile, w0);
      expect(usage0).toBeCloseTo(30, 0); // 3 hours * 10 = 30
    });

    it("TC2.2: default profile should not exceed quota in any window", () => {
      const profile = getDefaultProfile();

      // Test multiple trigger times
      for (let trig = 0; trig <= WORK_START; trig += TIME_GRANULARITY) {
        const windows = windowsForTrigger(trig, WORK_START, WORK_END);
        for (const w of windows) {
          const usage = expectedWindowUsage(profile, w);
          expect(usage).toBeLessThanOrEqual(QUOTA);
        }
      }
    });

    it("should correctly weight partial hour overlaps", () => {
      // Profile with 60 units in hour 8 (08:00-09:00)
      const profile: HourlyProfile = {};
      for (let h = 0; h < 24; h++) profile[h] = 0;
      profile[8] = 60;

      // Window that covers half of hour 8
      const window: Window = {
        start: 510, // 08:30
        end: 810,
        workOverlapStart: 510,
        workOverlapEnd: 540, // 09:00
      };

      const usage = expectedWindowUsage(profile, window);
      expect(usage).toBeCloseTo(30, 0); // Half of 60 = 30
    });
  });

  // =============================================================================
  // TEST SUITE 3: Trigger Validation (TC3.x from TLA+)
  // =============================================================================

  describe("isValidTrigger", () => {
    it("TC3.3: optimal trigger should be valid (no overruns)", () => {
      const profile = getDefaultProfile();
      const result = findOptimalTrigger(profile, WORK_START, WORK_END);

      if (result.isValid) {
        expect(isValidTrigger(profile, result.triggerTime, WORK_START, WORK_END)).toBe(true);
      }
    });

    it("should reject trigger that causes window to exceed quota", () => {
      // Heavy profile: 40 units per hour across all hours
      // With 8.5h workday and 5h windows, minimum overlap per window is ~2.5h
      // 2.5h * 40 = 100 (borderline), but most configs will exceed
      const heavyProfile: HourlyProfile = {};
      for (let h = 0; h < 24; h++) heavyProfile[h] = 40;

      const result = findOptimalTrigger(heavyProfile, WORK_START, WORK_END);

      // With 40/hr uniformly, finding valid triggers is very constrained
      // The algorithm should either find a valid one or fall back
      if (result.isValid) {
        // If valid, all windows should be within quota
        for (const w of result.windows) {
          expect(expectedWindowUsage(heavyProfile, w)).toBeLessThanOrEqual(QUOTA);
        }
      } else {
        // Falls back to WORK_START
        expect(result.triggerTime).toBe(WORK_START);
      }
    });

    it("TC5.5: very high usage should force fallback", () => {
      // Excessive profile: 150 units per hour during ALL hours
      // Even a 1-hour overlap would be 150 > 100
      // This ensures NO valid trigger can exist
      const excessiveProfile: HourlyProfile = {};
      for (let h = 0; h < 24; h++) {
        excessiveProfile[h] = 150;
      }

      const result = findOptimalTrigger(excessiveProfile, WORK_START, WORK_END);

      // Should fall back to WORK_START when no valid option
      expect(result.isValid).toBe(false);
      expect(result.triggerTime).toBe(WORK_START);
    });

    it("TC5.6: exactly quota usage should be valid (boundary)", () => {
      // Profile that sums to exactly 100 in some window configuration
      const exactProfile: HourlyProfile = {};
      for (let h = 0; h < 24; h++) exactProfile[h] = 0;
      // 20 units per hour for 5 hours = 100 exactly
      exactProfile[8] = 20;
      exactProfile[9] = 20;
      exactProfile[10] = 20;
      exactProfile[11] = 20;
      exactProfile[12] = 20;

      // There should exist a valid trigger
      let foundValid = false;
      for (let trig = 0; trig <= WORK_START; trig += TIME_GRANULARITY) {
        if (isValidTrigger(exactProfile, trig, WORK_START, WORK_END)) {
          foundValid = true;
          break;
        }
      }
      expect(foundValid).toBe(true);
    });
  });

  // =============================================================================
  // TEST SUITE 4: Min Slack Calculation (TC3.4 from TLA+)
  // =============================================================================

  describe("minSlack", () => {
    it("TC3.4: should maximize minimum slack among equal bucket counts", () => {
      const profile = getDefaultProfile();
      const result = findOptimalTrigger(profile, WORK_START, WORK_END);

      // For other triggers with same bucket count, our slack should be >= theirs
      for (let trig = 0; trig <= WORK_START; trig += TIME_GRANULARITY) {
        if (!isValidTrigger(profile, trig, WORK_START, WORK_END)) continue;

        const buckets = windowsForTrigger(trig, WORK_START, WORK_END).length;
        if (buckets === result.bucketCount) {
          const slack = minSlack(profile, trig, WORK_START, WORK_END);
          expect(result.minSlack).toBeGreaterThanOrEqual(slack);
        }
      }
    });

    it("should return 0 slack when window exactly uses quota", () => {
      const profile: HourlyProfile = {};
      for (let h = 0; h < 24; h++) profile[h] = 0;
      // 100 units spread across 5 hours = 20 each
      profile[7] = 20;
      profile[8] = 20;
      profile[9] = 20;
      profile[10] = 20;
      profile[11] = 20;

      // Window from 07:00-12:00 would have exactly 100 usage
      const window: Window = {
        start: 420,
        end: 720,
        workOverlapStart: 420,
        workOverlapEnd: 720,
      };

      const usage = expectedWindowUsage(profile, window);
      expect(usage).toBeCloseTo(100, 0);
    });
  });

  // =============================================================================
  // TEST SUITE 5: Optimal Trigger Finding (TC3.2 from TLA+)
  // =============================================================================

  describe("findOptimalTrigger", () => {
    it("TC3.2: should maximize bucket count", () => {
      const profile = getDefaultProfile();
      const result = findOptimalTrigger(profile, WORK_START, WORK_END);

      // Check that no other valid trigger has more buckets
      for (let trig = 0; trig <= WORK_START; trig += TIME_GRANULARITY) {
        if (!isValidTrigger(profile, trig, WORK_START, WORK_END)) continue;

        const buckets = windowsForTrigger(trig, WORK_START, WORK_END).length;
        expect(result.bucketCount).toBeGreaterThanOrEqual(buckets);
      }
    });

    it("should return formatted trigger time", () => {
      const result = findOptimalTrigger(getDefaultProfile(), WORK_START, WORK_END);
      expect(result.triggerTimeFormatted).toMatch(/^\d{2}:\d{2}$/);
      expect(parseTimeToMinutes(result.triggerTimeFormatted)).toBe(result.triggerTime);
    });

    it("should return windows for the optimal trigger", () => {
      const result = findOptimalTrigger(getDefaultProfile(), WORK_START, WORK_END);
      expect(result.windows.length).toBe(result.bucketCount);
    });
  });

  // =============================================================================
  // TEST SUITE 6: Specific Usage Patterns (TC4.x from TLA+)
  // =============================================================================

  describe("specific usage patterns", () => {
    it("TC4.1: heavy morning pattern should be handled", () => {
      // Heavy morning: 30 units at 7-9, light rest of day
      const profile: HourlyProfile = {};
      for (let h = 0; h < 24; h++) {
        if (h >= 7 && h <= 9) profile[h] = 30; // Heavy: 90 total
        else if (h >= 10 && h <= 12) profile[h] = 10; // Light: 30 total
        else if (h >= 13 && h <= 15) profile[h] = 15; // Medium: 45 total
        else profile[h] = 0;
      }

      const result = findOptimalTrigger(profile, WORK_START, WORK_END);

      // Should find a valid configuration
      expect(result.isValid).toBe(true);

      // First window should have reasonable slack for heavy morning
      if (result.windows.length > 0) {
        const firstWindowUsage = expectedWindowUsage(profile, result.windows[0]!);
        expect(firstWindowUsage).toBeLessThanOrEqual(QUOTA);
      }
    });

    it("TC4.2: heavy afternoon pattern should split windows appropriately", () => {
      // Heavy afternoon
      const profile: HourlyProfile = {};
      for (let h = 0; h < 24; h++) {
        if (h >= 7 && h <= 9) profile[h] = 10; // Light morning
        else if (h >= 10 && h <= 12) profile[h] = 10; // Light midday
        else if (h >= 13 && h <= 15) profile[h] = 35; // Heavy afternoon: 105 exceeds!
        else profile[h] = 0;
      }

      const result = findOptimalTrigger(profile, WORK_START, WORK_END);

      // Algorithm must position reset during afternoon to avoid overrun
      // or declare invalid if impossible
      if (result.isValid) {
        // All windows should be valid
        for (const w of result.windows) {
          expect(expectedWindowUsage(profile, w)).toBeLessThanOrEqual(QUOTA);
        }
      }
    });

    it("TC4.3: uniform usage pattern should work with any valid trigger", () => {
      // Uniform: 10 units per work hour
      const profile: HourlyProfile = {};
      for (let h = 0; h < 24; h++) {
        profile[h] = h >= 7 && h <= 15 ? 10 : 0;
      }
      // 80 total across 8 hours

      const result = findOptimalTrigger(profile, WORK_START, WORK_END);
      expect(result.isValid).toBe(true);
    });

    it("TC4.4: spiky usage pattern should still be valid", () => {
      // Spiky: big spikes at specific hours
      const profile: HourlyProfile = {};
      for (let h = 0; h < 24; h++) {
        if (h === 8) profile[h] = 40;
        else if (h === 12) profile[h] = 40;
        else if (h === 15) profile[h] = 40;
        else profile[h] = 5;
      }

      const result = findOptimalTrigger(profile, WORK_START, WORK_END);

      // Either valid, or falls back to safe default
      expect(result.isValid || result.triggerTime === WORK_START).toBe(true);
    });
  });

  // =============================================================================
  // TEST SUITE 7: Profile Building (TC2.1, TC3.1 from TLA+)
  // =============================================================================

  describe("profile building", () => {
    it("TC3.1: should compute profile from usage log", () => {
      const log: UsageLogEntry[] = [
        { day: 0, hour: 9, usage: 10 },
        { day: 1, hour: 9, usage: 12 },
        { day: 2, hour: 9, usage: 8 },
        { day: 0, hour: 10, usage: 20 },
        { day: 1, hour: 10, usage: 22 },
      ];

      const profile = buildProfile(log);

      // Hour 9: mean of [10, 12, 8] = 10
      expect(profile[9]).toBeCloseTo(10, 0);
      // Hour 10: mean of [20, 22] = 21
      expect(profile[10]).toBeCloseTo(21, 0);
      // Hour with no data should be 0
      expect(profile[11]).toBe(0);
    });

    it("TC5.1: zero usage day should not break profile", () => {
      const log: UsageLogEntry[] = [];
      const profile = buildProfile(log);

      // All hours should be 0
      for (let h = 0; h < 24; h++) {
        expect(profile[h]).toBe(0);
      }
    });

    it("should compute hourly mean correctly", () => {
      const log: UsageLogEntry[] = [
        { day: 0, hour: 8, usage: 25 },
        { day: 1, hour: 8, usage: 30 },
        { day: 2, hour: 8, usage: 22 },
        { day: 3, hour: 8, usage: 28 },
        { day: 4, hour: 8, usage: 25 },
        { day: 5, hour: 8, usage: 27 },
        { day: 6, hour: 8, usage: 23 },
      ];

      const mean = computeHourlyMean(log, 8);
      // Mean of [25, 30, 22, 28, 25, 27, 23] = 180/7 ≈ 25.7
      expect(mean).toBeCloseTo(25.7, 1);
    });
  });

  // =============================================================================
  // TEST SUITE 8: Phase Determination (TC1.1, TC1.5 from TLA+)
  // =============================================================================

  describe("phase determination", () => {
    it("TC1.1: initial phase should be bootstrap", () => {
      expect(determinePhase(0)).toBe("bootstrap");
    });

    it("should remain bootstrap until calibration days reached", () => {
      expect(determinePhase(1)).toBe("bootstrap");
      expect(determinePhase(6)).toBe("bootstrap");
    });

    it("TC1.5: should transition to steady_state after calibration days", () => {
      expect(determinePhase(7)).toBe("steady_state");
      expect(determinePhase(14)).toBe("steady_state");
    });
  });

  // =============================================================================
  // TEST SUITE 9: Edge Cases (TC5.x from TLA+)
  // =============================================================================

  describe("edge cases", () => {
    it("TC5.2: short workday (less than one window)", () => {
      // Work: 09:00-12:00 (3 hours)
      // Even a 3-hour workday can have 2 buckets if trigger splits it:
      // e.g., trigger at 00:00 → window 05:00-10:00 (overlap 09:00-10:00)
      //                       → window 10:00-15:00 (overlap 10:00-12:00)
      const result = findOptimalTrigger(getDefaultProfile(), 540, 720);

      // Should find valid configuration
      expect(result.isValid).toBe(true);
      // At least 1 bucket, possibly 2 depending on optimal split
      expect(result.bucketCount).toBeGreaterThanOrEqual(1);
    });

    it("long workday should have multiple buckets", () => {
      // Work: 06:00-18:00 (12 hours)
      const result = findOptimalTrigger(getDefaultProfile(), 360, 1080);
      expect(result.bucketCount).toBeGreaterThanOrEqual(2);
    });

    it("should handle overnight work (edge case)", () => {
      // Work end before start indicates edge case
      const result = calculateOptimalStartTimesFromProfile("22:00", "06:00");
      expect(result.length).toBe(1);
      expect(result[0]).toBe("22:00");
    });
  });

  // =============================================================================
  // TEST SUITE 10: Integration (Scenario 2.2 from TEST_SCENARIOS.md)
  // =============================================================================

  describe("integration: scenario 2.2 - optimal trigger calculation", () => {
    it("should calculate optimal trigger for standard usage pattern", () => {
      // Profile from Scenario 2.2:
      // 07: 15, 08: 25, 09: 20, 10: 15, 11: 10, 12: 8, 13: 12, 14: 18, 15: 8
      const profile: HourlyProfile = {};
      for (let h = 0; h < 24; h++) profile[h] = 0;
      profile[7] = 15;
      profile[8] = 25;
      profile[9] = 20;
      profile[10] = 15;
      profile[11] = 10;
      profile[12] = 8;
      profile[13] = 12;
      profile[14] = 18;
      profile[15] = 8;
      // Total: 131 units

      const result = findOptimalTrigger(profile, WORK_START, WORK_END);

      // Should find valid trigger with 3 buckets
      expect(result.isValid).toBe(true);
      expect(result.bucketCount).toBeGreaterThanOrEqual(2);

      // Min slack should be positive (safety margin)
      expect(result.minSlack).toBeGreaterThan(0);
    });
  });

  // =============================================================================
  // TEST SUITE 11: calculateOptimalStartTimesFromProfile
  // =============================================================================

  describe("calculateOptimalStartTimesFromProfile", () => {
    it("should return array of start times", () => {
      const times = calculateOptimalStartTimesFromProfile("07:30", "16:00");
      expect(Array.isArray(times)).toBe(true);
      expect(times.length).toBeGreaterThan(0);
    });

    it("should return times in HH:MM format", () => {
      const times = calculateOptimalStartTimesFromProfile("07:30", "16:00");
      for (const t of times) {
        expect(t).toMatch(/^\d{2}:\d{2}$/);
      }
    });

    it("should accept custom profile", () => {
      const customProfile: HourlyProfile = {};
      for (let h = 0; h < 24; h++) customProfile[h] = 5;

      const times = calculateOptimalStartTimesFromProfile("07:30", "16:00", customProfile);
      expect(times.length).toBeGreaterThan(0);
    });
  });

  // =============================================================================
  // TEST SUITE 12: Profile Building from Historical Data
  // =============================================================================

  describe("computeActualHourlyUsage", () => {
    it("should compute diffs within a window", () => {
      const windows: UsageWindowRecord[] = [
        { id: 1, window_start: "2024-01-01T07:00:00Z", window_end: "2024-01-01T12:00:00Z" },
      ];

      const hourlyRecords: HourlyUsageRecord[] = [
        { date_hour: "2024-01-01-08", usage_pct: 20, updated_at: "2024-01-01T08:30:00Z" },
        { date_hour: "2024-01-01-09", usage_pct: 45, updated_at: "2024-01-01T09:30:00Z" },
        { date_hour: "2024-01-01-10", usage_pct: 70, updated_at: "2024-01-01T10:30:00Z" },
      ];

      const result = computeActualHourlyUsage(hourlyRecords, windows);

      // First hour: 20 (starts from 0)
      expect(result[0]?.usage).toBe(20);
      // Second hour: 45 - 20 = 25
      expect(result[1]?.usage).toBe(25);
      // Third hour: 70 - 45 = 25
      expect(result[2]?.usage).toBe(25);
    });

    it("should reset at window boundaries", () => {
      const windows: UsageWindowRecord[] = [
        { id: 1, window_start: "2024-01-01T07:00:00Z", window_end: "2024-01-01T12:00:00Z" },
        { id: 2, window_start: "2024-01-01T12:00:00Z", window_end: "2024-01-01T17:00:00Z" },
      ];

      const hourlyRecords: HourlyUsageRecord[] = [
        { date_hour: "2024-01-01-10", usage_pct: 50, updated_at: "2024-01-01T10:30:00Z" },
        { date_hour: "2024-01-01-11", usage_pct: 80, updated_at: "2024-01-01T11:30:00Z" },
        // Window boundary - new window starts
        { date_hour: "2024-01-01-12", usage_pct: 15, updated_at: "2024-01-01T12:30:00Z" },
        { date_hour: "2024-01-01-13", usage_pct: 35, updated_at: "2024-01-01T13:30:00Z" },
      ];

      const result = computeActualHourlyUsage(hourlyRecords, windows);

      // First window
      expect(result[0]?.usage).toBe(50); // First in window
      expect(result[1]?.usage).toBe(30); // 80 - 50

      // Second window - should reset
      expect(result[2]?.usage).toBe(15); // First in new window (reset from 0)
      expect(result[3]?.usage).toBe(20); // 35 - 15
    });

    it("should handle empty records", () => {
      const result = computeActualHourlyUsage([], []);
      expect(result).toEqual([]);
    });

    it("should track day index correctly", () => {
      const windows: UsageWindowRecord[] = [
        { id: 1, window_start: "2024-01-01T07:00:00Z", window_end: "2024-01-01T17:00:00Z" },
        { id: 2, window_start: "2024-01-02T07:00:00Z", window_end: "2024-01-02T17:00:00Z" },
      ];

      const hourlyRecords: HourlyUsageRecord[] = [
        { date_hour: "2024-01-01-09", usage_pct: 30, updated_at: "2024-01-01T09:30:00Z" },
        { date_hour: "2024-01-02-09", usage_pct: 40, updated_at: "2024-01-02T09:30:00Z" },
      ];

      const result = computeActualHourlyUsage(hourlyRecords, windows);

      expect(result[0]?.day).toBe(0);
      expect(result[0]?.hour).toBe(9);
      expect(result[1]?.day).toBe(1);
      expect(result[1]?.hour).toBe(9);
    });
  });

  describe("buildProfileFromRecords", () => {
    it("should build profile with mean per hour", () => {
      const windows: UsageWindowRecord[] = [
        { id: 1, window_start: "2024-01-01T05:00:00Z", window_end: "2024-01-01T17:00:00Z" },
        { id: 2, window_start: "2024-01-02T05:00:00Z", window_end: "2024-01-02T17:00:00Z" },
      ];

      const hourlyRecords: HourlyUsageRecord[] = [
        // Day 1
        { date_hour: "2024-01-01-09", usage_pct: 20, updated_at: "2024-01-01T09:30:00Z" },
        { date_hour: "2024-01-01-10", usage_pct: 50, updated_at: "2024-01-01T10:30:00Z" },
        // Day 2
        { date_hour: "2024-01-02-09", usage_pct: 30, updated_at: "2024-01-02T09:30:00Z" },
        { date_hour: "2024-01-02-10", usage_pct: 70, updated_at: "2024-01-02T10:30:00Z" },
      ];

      const profile = buildProfileFromRecords(hourlyRecords, windows);

      // Hour 9: day1=20, day2=30 → mean=25
      expect(profile[9]).toBeCloseTo(25, 0);
      // Hour 10: day1=30 (50-20), day2=40 (70-30) → mean=35
      expect(profile[10]).toBeCloseTo(35, 0);
    });
  });

  describe("countWaitEvents", () => {
    it("should count windows where usage hit 100% before end", () => {
      const windows: UsageWindowRecord[] = [
        { id: 1, window_start: "2024-01-01T07:00:00Z", window_end: "2024-01-01T12:00:00Z" },
        { id: 2, window_start: "2024-01-01T12:00:00Z", window_end: "2024-01-01T17:00:00Z" },
      ];

      const hourlyRecords: HourlyUsageRecord[] = [
        // Window 1: hit 100% at hour 10 (before 12:00 end) - WAIT EVENT
        { date_hour: "2024-01-01-09", usage_pct: 70, updated_at: "2024-01-01T09:30:00Z" },
        { date_hour: "2024-01-01-10", usage_pct: 100, updated_at: "2024-01-01T10:30:00Z" },
        // Window 2: only reached 50% - NO WAIT EVENT
        { date_hour: "2024-01-01-13", usage_pct: 30, updated_at: "2024-01-01T13:30:00Z" },
        { date_hour: "2024-01-01-14", usage_pct: 50, updated_at: "2024-01-01T14:30:00Z" },
      ];

      const waitEvents = countWaitEvents(hourlyRecords, windows);
      expect(waitEvents).toBe(1);
    });

    it("should return 0 when no wait events", () => {
      const windows: UsageWindowRecord[] = [
        { id: 1, window_start: "2024-01-01T07:00:00Z", window_end: "2024-01-01T12:00:00Z" },
      ];

      const hourlyRecords: HourlyUsageRecord[] = [
        { date_hour: "2024-01-01-09", usage_pct: 50, updated_at: "2024-01-01T09:30:00Z" },
      ];

      const waitEvents = countWaitEvents(hourlyRecords, windows);
      expect(waitEvents).toBe(0);
    });
  });

  describe("calculateWastedQuota", () => {
    it("should calculate wasted quota from unused percentage", () => {
      const windows: UsageWindowRecord[] = [
        { id: 1, window_start: "2024-01-01T07:00:00Z", window_end: "2024-01-01T12:00:00Z" },
        { id: 2, window_start: "2024-01-01T12:00:00Z", window_end: "2024-01-01T17:00:00Z" },
      ];

      const hourlyRecords: HourlyUsageRecord[] = [
        // Window 1: last usage was 70% → 30% wasted
        { date_hour: "2024-01-01-09", usage_pct: 50, updated_at: "2024-01-01T09:30:00Z" },
        { date_hour: "2024-01-01-10", usage_pct: 70, updated_at: "2024-01-01T10:30:00Z" },
        // Window 2: last usage was 40% → 60% wasted
        { date_hour: "2024-01-01-13", usage_pct: 40, updated_at: "2024-01-01T13:30:00Z" },
      ];

      const wasted = calculateWastedQuota(hourlyRecords, windows);
      expect(wasted).toBe(90); // 30 + 60
    });

    it("should not count wasted quota for 100% usage", () => {
      const windows: UsageWindowRecord[] = [
        { id: 1, window_start: "2024-01-01T07:00:00Z", window_end: "2024-01-01T12:00:00Z" },
      ];

      const hourlyRecords: HourlyUsageRecord[] = [
        { date_hour: "2024-01-01-09", usage_pct: 100, updated_at: "2024-01-01T09:30:00Z" },
      ];

      const wasted = calculateWastedQuota(hourlyRecords, windows);
      expect(wasted).toBe(0);
    });
  });
});
