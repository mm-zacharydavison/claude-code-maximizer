/**
 * Scheduler Autostart Tests
 *
 * Tests for the autostart logic that triggers Claude sessions at optimal times.
 * Covers scenarios for on-time triggers, late triggers, and window-already-active detection.
 */

import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test";
import {
  isAutoStartAllowed,
  isWindowAlreadyActive,
  autoStartWindowIfInPeriod,
  resetSchedulerState,
  setLastAutoStartTime,
  AUTOSTART_COOLDOWN_MINUTES,
  WINDOW_DURATION_MINUTES,
} from "../../src/daemon/scheduler.ts";
import { getLastAutoStartTime } from "../../src/config/state.ts";
import type { ClaudeUsage } from "../../src/usage/index.ts";

// Mock the usage module
const mockGetCachedUsage = mock(() => null as ClaudeUsage | null);
const mockGetClaudeUsage = mock(() => Promise.resolve(null as ClaudeUsage | null));

mock.module("../../src/usage/index.ts", () => ({
  getCachedUsage: mockGetCachedUsage,
  getClaudeUsage: mockGetClaudeUsage,
}));

// Mock spawnClaudeSession
const mockSpawnClaudeSession = mock(() =>
  Promise.resolve({ success: true, greeting: "Hello", message: "" })
);

mock.module("../../src/daemon/autostart.ts", () => ({
  spawnClaudeSession: mockSpawnClaudeSession,
}));

describe("scheduler autostart", () => {
  beforeEach(() => {
    // Reset state before each test
    resetSchedulerState();
    mockGetCachedUsage.mockReset();
    mockGetClaudeUsage.mockReset();
    mockSpawnClaudeSession.mockReset();

    // Default: no cached usage, no fresh usage
    mockGetCachedUsage.mockReturnValue(null);
    mockGetClaudeUsage.mockResolvedValue(null);
    mockSpawnClaudeSession.mockResolvedValue({ success: true, greeting: "Hi", message: "" });
  });

  // Helper to create a ClaudeUsage object with a session reset time
  function makeUsage(resetIso: string | null): ClaudeUsage {
    return {
      session: {
        percentage: resetIso ? 50 : null,
        resets_at: resetIso ? "in 3 hours" : null,
        resets_at_iso: resetIso,
      },
      week_all_models: { percentage: null, resets_at: null, resets_at_iso: null },
      week_sonnet: { percentage: null, resets_at: null, resets_at_iso: null },
    };
  }

  // Helper to create ISO timestamp relative to now
  function futureIso(hoursFromNow: number): string {
    return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
  }

  function pastIso(hoursAgo: number): string {
    return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  }

  // Helper to create a Date at specific time today
  function timeToday(hours: number, minutes: number): Date {
    const d = new Date();
    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  describe("isAutoStartAllowed", () => {
    it("should return true when no previous auto-start", () => {
      resetSchedulerState();
      expect(isAutoStartAllowed()).toBe(true);
    });

    it("should return false when within cooldown period", () => {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      setLastAutoStartTime(thirtyMinutesAgo);

      expect(isAutoStartAllowed()).toBe(false);
    });

    it("should return true when cooldown has expired", () => {
      const sixtyOneMinutesAgo = new Date(Date.now() - 61 * 60 * 1000);
      setLastAutoStartTime(sixtyOneMinutesAgo);

      expect(isAutoStartAllowed()).toBe(true);
    });

    it("should return false at exactly cooldown boundary", () => {
      // At exactly 60 minutes, diffMinutes might be slightly less due to timing
      const exactlySixtyMinutesAgo = new Date(Date.now() - AUTOSTART_COOLDOWN_MINUTES * 60 * 1000);
      setLastAutoStartTime(exactlySixtyMinutesAgo);

      // Should be true (>= 60)
      expect(isAutoStartAllowed()).toBe(true);
    });
  });

  describe("isWindowAlreadyActive", () => {
    describe("cache says window IS active", () => {
      it("should return true without fetching fresh usage", async () => {
        mockGetCachedUsage.mockReturnValue(makeUsage(futureIso(3)));

        const result = await isWindowAlreadyActive();

        expect(result).toBe(true);
        // Should NOT have called getClaudeUsage since cache confirmed active
        expect(mockGetClaudeUsage).not.toHaveBeenCalled();
      });

      it("should detect active window when reset is 1 minute away", async () => {
        const oneMinuteFromNow = new Date(Date.now() + 60 * 1000).toISOString();
        mockGetCachedUsage.mockReturnValue(makeUsage(oneMinuteFromNow));

        const result = await isWindowAlreadyActive();

        expect(result).toBe(true);
        expect(mockGetClaudeUsage).not.toHaveBeenCalled();
      });
    });

    describe("cache says window is NOT active", () => {
      it("should fetch fresh usage when cache shows past reset time", async () => {
        mockGetCachedUsage.mockReturnValue(makeUsage(pastIso(1)));
        mockGetClaudeUsage.mockResolvedValue(null);

        const result = await isWindowAlreadyActive();

        expect(result).toBe(false);
        expect(mockGetClaudeUsage).toHaveBeenCalledWith({ refresh: true });
      });

      it("should fetch fresh usage when no cache available", async () => {
        mockGetCachedUsage.mockReturnValue(null);
        mockGetClaudeUsage.mockResolvedValue(null);

        const result = await isWindowAlreadyActive();

        expect(result).toBe(false);
        expect(mockGetClaudeUsage).toHaveBeenCalledWith({ refresh: true });
      });

      it("should return true if fresh usage shows active window", async () => {
        mockGetCachedUsage.mockReturnValue(null);
        mockGetClaudeUsage.mockResolvedValue(makeUsage(futureIso(4)));

        const result = await isWindowAlreadyActive();

        expect(result).toBe(true);
        expect(mockGetClaudeUsage).toHaveBeenCalledWith({ refresh: true });
      });

      it("should return false if fresh usage shows no window", async () => {
        mockGetCachedUsage.mockReturnValue(null);
        mockGetClaudeUsage.mockResolvedValue(makeUsage(null));

        const result = await isWindowAlreadyActive();

        expect(result).toBe(false);
      });
    });
  });

  describe("autoStartWindowIfInPeriod", () => {
    describe("scenario 1: normal trigger (on time)", () => {
      it("should trigger when at window start time with no active window", async () => {
        const now = timeToday(6, 0);
        mockGetCachedUsage.mockReturnValue(null);
        mockGetClaudeUsage.mockResolvedValue(null);

        await autoStartWindowIfInPeriod(now, ["06:00"]);

        expect(mockSpawnClaudeSession).toHaveBeenCalled();
        // Verify last autostart time was persisted
        const lastAutoStart = getLastAutoStartTime();
        expect(lastAutoStart).not.toBeNull();
        expect(lastAutoStart!.getTime()).toBe(now.getTime());
      });

      it("should trigger when 5 minutes after window start", async () => {
        const now = timeToday(6, 5);
        mockGetCachedUsage.mockReturnValue(null);
        mockGetClaudeUsage.mockResolvedValue(null);

        await autoStartWindowIfInPeriod(now, ["06:00"]);

        expect(mockSpawnClaudeSession).toHaveBeenCalled();
      });

      it("should NOT trigger when cache shows active window", async () => {
        const now = timeToday(6, 0);
        mockGetCachedUsage.mockReturnValue(makeUsage(futureIso(4)));

        await autoStartWindowIfInPeriod(now, ["06:00"]);

        expect(mockSpawnClaudeSession).not.toHaveBeenCalled();
        // Should not have fetched fresh since cache was sufficient
        expect(mockGetClaudeUsage).not.toHaveBeenCalled();
      });

      it("should NOT trigger when fresh shows window became active", async () => {
        const now = timeToday(6, 0);
        mockGetCachedUsage.mockReturnValue(null);
        mockGetClaudeUsage.mockResolvedValue(makeUsage(futureIso(4)));

        await autoStartWindowIfInPeriod(now, ["06:00"]);

        expect(mockSpawnClaudeSession).not.toHaveBeenCalled();
        expect(mockGetClaudeUsage).toHaveBeenCalled();
      });
    });

    describe("scenario 2: late trigger (machine was off)", () => {
      it("should trigger when 105 minutes late with no active window", async () => {
        const now = timeToday(7, 45); // 1h45m after 06:00
        mockGetCachedUsage.mockReturnValue(null);
        mockGetClaudeUsage.mockResolvedValue(null);

        await autoStartWindowIfInPeriod(now, ["06:00"]);

        expect(mockSpawnClaudeSession).toHaveBeenCalled();
      });

      it("should trigger when 4 hours late (still in 5h window)", async () => {
        const now = timeToday(10, 0); // 4h after 06:00
        mockGetCachedUsage.mockReturnValue(null);
        mockGetClaudeUsage.mockResolvedValue(null);

        await autoStartWindowIfInPeriod(now, ["06:00"]);

        expect(mockSpawnClaudeSession).toHaveBeenCalled();
      });

      it("should NOT trigger when 5+ hours late (outside window)", async () => {
        const now = timeToday(11, 1); // 5h1m after 06:00
        mockGetCachedUsage.mockReturnValue(null);
        mockGetClaudeUsage.mockResolvedValue(null);

        await autoStartWindowIfInPeriod(now, ["06:00"]);

        expect(mockSpawnClaudeSession).not.toHaveBeenCalled();
        // Should not even check usage since we're outside the window
        expect(mockGetClaudeUsage).not.toHaveBeenCalled();
      });

      it("should NOT trigger late if fresh shows window is already active", async () => {
        const now = timeToday(7, 45);
        mockGetCachedUsage.mockReturnValue(null);
        mockGetClaudeUsage.mockResolvedValue(makeUsage(futureIso(2)));

        await autoStartWindowIfInPeriod(now, ["06:00"]);

        expect(mockSpawnClaudeSession).not.toHaveBeenCalled();
      });

      it("should NOT trigger late if cache shows window is already active", async () => {
        const now = timeToday(7, 45);
        mockGetCachedUsage.mockReturnValue(makeUsage(futureIso(1)));

        await autoStartWindowIfInPeriod(now, ["06:00"]);

        expect(mockSpawnClaudeSession).not.toHaveBeenCalled();
      });
    });

    describe("scenario 3: outside window period", () => {
      it("should NOT trigger when before window start", async () => {
        const now = timeToday(5, 30); // 30 min before 06:00
        mockGetCachedUsage.mockReturnValue(null);
        mockGetClaudeUsage.mockResolvedValue(null);

        await autoStartWindowIfInPeriod(now, ["06:00"]);

        expect(mockSpawnClaudeSession).not.toHaveBeenCalled();
        expect(mockGetClaudeUsage).not.toHaveBeenCalled();
      });

      it("should NOT trigger when after window end", async () => {
        const now = timeToday(12, 0); // 6h after 06:00
        mockGetCachedUsage.mockReturnValue(null);
        mockGetClaudeUsage.mockResolvedValue(null);

        await autoStartWindowIfInPeriod(now, ["06:00"]);

        expect(mockSpawnClaudeSession).not.toHaveBeenCalled();
      });
    });

    describe("cooldown behavior", () => {
      it("should NOT trigger when on cooldown", async () => {
        const now = timeToday(6, 0);
        setLastAutoStartTime(new Date(now.getTime() - 30 * 60 * 1000)); // 30 min ago
        mockGetCachedUsage.mockReturnValue(null);
        mockGetClaudeUsage.mockResolvedValue(null);

        await autoStartWindowIfInPeriod(now, ["06:00"]);

        expect(mockSpawnClaudeSession).not.toHaveBeenCalled();
        // Should not check usage since cooldown check fails first
        expect(mockGetClaudeUsage).not.toHaveBeenCalled();
      });

      it("should trigger when cooldown has expired", async () => {
        const now = timeToday(6, 0);
        setLastAutoStartTime(new Date(now.getTime() - 61 * 60 * 1000)); // 61 min ago
        mockGetCachedUsage.mockReturnValue(null);
        mockGetClaudeUsage.mockResolvedValue(null);

        await autoStartWindowIfInPeriod(now, ["06:00"]);

        expect(mockSpawnClaudeSession).toHaveBeenCalled();
      });
    });

    describe("multiple optimal times", () => {
      it("should check each optimal time and trigger on first match", async () => {
        const now = timeToday(10, 30); // Between 06:00 (expired) and 10:00 (active)
        mockGetCachedUsage.mockReturnValue(null);
        mockGetClaudeUsage.mockResolvedValue(null);

        await autoStartWindowIfInPeriod(now, ["06:00", "10:00"]);

        // Should trigger for 10:00 window (06:00 window ended at 11:00, we're in it)
        // Actually 06:00 + 5h = 11:00, and we're at 10:30, so still in first window
        expect(mockSpawnClaudeSession).toHaveBeenCalledTimes(1);
      });

      it("should only trigger once even with multiple matching windows", async () => {
        const now = timeToday(10, 0);
        mockGetCachedUsage.mockReturnValue(null);
        mockGetClaudeUsage.mockResolvedValue(null);

        // Both windows would be active at 10:00 (06:00-11:00 and 10:00-15:00)
        await autoStartWindowIfInPeriod(now, ["06:00", "10:00"]);

        expect(mockSpawnClaudeSession).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("integration: decision matrix", () => {
    // Full truth table verification
    const scenarios = [
      {
        name: "outside window period",
        now: timeToday(5, 0),
        optimal: "06:00",
        cooldown: false,
        cacheActive: false,
        freshActive: false,
        shouldTrigger: false,
        shouldFetchFresh: false,
      },
      {
        name: "in window, on cooldown",
        now: timeToday(6, 0),
        optimal: "06:00",
        cooldown: true, // on cooldown
        cacheActive: false,
        freshActive: false,
        shouldTrigger: false,
        shouldFetchFresh: false,
      },
      {
        name: "in window, cache shows active",
        now: timeToday(6, 0),
        optimal: "06:00",
        cooldown: false,
        cacheActive: true,
        freshActive: false, // won't be checked
        shouldTrigger: false,
        shouldFetchFresh: false,
      },
      {
        name: "in window, cache empty, fresh shows active",
        now: timeToday(6, 0),
        optimal: "06:00",
        cooldown: false,
        cacheActive: false,
        freshActive: true,
        shouldTrigger: false,
        shouldFetchFresh: true,
      },
      {
        name: "in window, all clear - SHOULD TRIGGER",
        now: timeToday(6, 0),
        optimal: "06:00",
        cooldown: false,
        cacheActive: false,
        freshActive: false,
        shouldTrigger: true,
        shouldFetchFresh: true,
      },
      {
        name: "late (1h45m), all clear - SHOULD TRIGGER",
        now: timeToday(7, 45),
        optimal: "06:00",
        cooldown: false,
        cacheActive: false,
        freshActive: false,
        shouldTrigger: true,
        shouldFetchFresh: true,
      },
      {
        name: "late (1h45m), fresh shows active",
        now: timeToday(7, 45),
        optimal: "06:00",
        cooldown: false,
        cacheActive: false,
        freshActive: true,
        shouldTrigger: false,
        shouldFetchFresh: true,
      },
    ];

    for (const scenario of scenarios) {
      it(`${scenario.name}`, async () => {
        resetSchedulerState();
        mockGetCachedUsage.mockReset();
        mockGetClaudeUsage.mockReset();
        mockSpawnClaudeSession.mockReset();

        // Set cooldown state
        if (scenario.cooldown) {
          setLastAutoStartTime(new Date(scenario.now.getTime() - 30 * 60 * 1000));
        }

        // Set cache state
        if (scenario.cacheActive) {
          mockGetCachedUsage.mockReturnValue(makeUsage(futureIso(3)));
        } else {
          mockGetCachedUsage.mockReturnValue(null);
        }

        // Set fresh usage state
        if (scenario.freshActive) {
          mockGetClaudeUsage.mockResolvedValue(makeUsage(futureIso(3)));
        } else {
          mockGetClaudeUsage.mockResolvedValue(null);
        }

        mockSpawnClaudeSession.mockResolvedValue({ success: true, greeting: "Hi", message: "" });

        await autoStartWindowIfInPeriod(scenario.now, [scenario.optimal]);

        if (scenario.shouldTrigger) {
          expect(mockSpawnClaudeSession).toHaveBeenCalled();
        } else {
          expect(mockSpawnClaudeSession).not.toHaveBeenCalled();
        }

        if (scenario.shouldFetchFresh) {
          expect(mockGetClaudeUsage).toHaveBeenCalled();
        } else {
          expect(mockGetClaudeUsage).not.toHaveBeenCalled();
        }
      });
    }
  });
});
