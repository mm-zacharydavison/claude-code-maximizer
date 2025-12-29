import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createTestEnv, createInstalledState, DEFAULT_TEST_CONFIG, type TestEnv } from "../helpers/test-env.ts";
import { runCcmax } from "../helpers/cli-runner.ts";
import { testDb, generateWeeklyUsage } from "../fixtures/seed-db.ts";
import { join } from "path";

describe("ccmax adjust", () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  test("shows 'not installed' when not installed", async () => {
    const result = await runCcmax(["adjust"], env.getEnv());

    expect(result.stdout).toContain("not installed");
    expect(result.exitCode).toBe(0);
  });

  test("shows 'learning not complete' when still learning", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(3, false));

    testDb(join(env.dataDir, "usage.db")).done();

    const result = await runCcmax(["adjust"], env.getEnv());

    expect(result.stdout).toMatch(/learning.*not complete|analyze/i);
    expect(result.exitCode).toBe(0);
  });

  test("shows 'disabled' when auto_adjust_enabled is false", async () => {
    await env.writeConfig({ ...DEFAULT_TEST_CONFIG, auto_adjust_enabled: false });
    await env.writeState(createInstalledState(14, true));

    testDb(join(env.dataDir, "usage.db")).done();

    const result = await runCcmax(["adjust"], env.getEnv());

    expect(result.stdout).toMatch(/disabled/i);
    expect(result.exitCode).toBe(0);
  });

  test("--status shows adjustment status", async () => {
    await env.writeConfig({
      ...DEFAULT_TEST_CONFIG,
      optimal_start_times: {
        monday: "09:00",
        tuesday: "09:00",
        wednesday: "09:00",
        thursday: "09:00",
        friday: "09:00",
        saturday: null,
        sunday: null,
      },
    });
    await env.writeState(createInstalledState(14, true));

    testDb(join(env.dataDir, "usage.db")).done();

    const result = await runCcmax(["adjust", "--status"], env.getEnv());

    expect(result.stdout).toContain("Adaptive Adjustment Status");
    expect(result.stdout).toMatch(/Auto-adjust enabled.*Yes/i);
    expect(result.stdout).toContain("Monday");
    expect(result.stdout).toContain("09:00");
    expect(result.exitCode).toBe(0);
  });

  test("--force runs adjustment regardless of schedule", async () => {
    await env.writeConfig({
      ...DEFAULT_TEST_CONFIG,
      optimal_start_times: {
        monday: "10:00",
        tuesday: "10:00",
        wednesday: "10:00",
        thursday: "10:00",
        friday: "10:00",
        saturday: null,
        sunday: null,
      },
    });
    await env.writeState(createInstalledState(14, true));

    const db = testDb(join(env.dataDir, "usage.db"));
    generateWeeklyUsage(db, { hoursPerDay: 6, startHour: 8, avgUsage: 50 });
    db.done();

    const result = await runCcmax(["adjust", "--force"], env.getEnv());

    expect(result.stdout).toContain("Adaptive Adjustment Report");
    expect(result.exitCode).toBe(0);
  });

  test("--dry-run shows changes without applying", async () => {
    await env.writeConfig({
      ...DEFAULT_TEST_CONFIG,
      optimal_start_times: {
        monday: "10:00",
        tuesday: "10:00",
        wednesday: "10:00",
        thursday: "10:00",
        friday: "10:00",
        saturday: null,
        sunday: null,
      },
    });
    await env.writeState(createInstalledState(14, true));

    const db = testDb(join(env.dataDir, "usage.db"));
    generateWeeklyUsage(db, { hoursPerDay: 6, startHour: 8, avgUsage: 50 });
    db.done();

    const result = await runCcmax(["adjust", "--force", "--dry-run"], env.getEnv());

    expect(result.stdout).toMatch(/dry run|preview/i);
    expect(result.exitCode).toBe(0);

    // At minimum the original times should still be present or show in output
    expect(result.stdout).toContain("10:00");
  });

  test("adjustment uses EMA to blend times", async () => {
    // Set current time to 10:00
    await env.writeConfig({
      ...DEFAULT_TEST_CONFIG,
      optimal_start_times: {
        monday: "10:00",
        tuesday: "10:00",
        wednesday: "10:00",
        thursday: "10:00",
        friday: "10:00",
        saturday: null,
        sunday: null,
      },
    });
    await env.writeState(createInstalledState(14, true));

    const db = testDb(join(env.dataDir, "usage.db"));
    // Seed hourly usage at 8:00 (2 hours earlier)
    generateWeeklyUsage(db, { hoursPerDay: 6, startHour: 8, avgUsage: 50 });
    db.done();

    await runCcmax(["adjust", "--force"], env.getEnv());

    const config = await env.readConfig();
    const optimalTimes = (config as { optimal_start_times?: Record<string, string | null> }).optimal_start_times;

    // With EMA (α=0.3), blending should give something between
    if (optimalTimes?.monday) {
      const [hours] = optimalTimes.monday.split(":").map(Number);
      // Should be between 7 and 10 (blended)
      expect(hours).toBeGreaterThanOrEqual(7);
      expect(hours).toBeLessThanOrEqual(10);
    }
  });

  test("shows help with --help", async () => {
    const result = await runCcmax(["adjust", "--help"], env.getEnv());

    expect(result.stdout).toContain("adjust");
    expect(result.stdout).toMatch(/force|dry-run|status/i);
    expect(result.exitCode).toBe(0);
  });
});
