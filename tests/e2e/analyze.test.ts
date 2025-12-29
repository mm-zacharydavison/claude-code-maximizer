import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createTestEnv, createInstalledState, DEFAULT_TEST_CONFIG, type TestEnv } from "../helpers/test-env.ts";
import { runCcmax } from "../helpers/cli-runner.ts";
import { testDb, generateWeeklyUsage, generateWindows } from "../fixtures/seed-db.ts";
import { join } from "path";

describe("ccmax analyze", () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  test("shows 'not installed' when not installed", async () => {
    const result = await runCcmax(["analyze"], env.getEnv());

    expect(result.stdout).toContain("not installed");
    expect(result.exitCode).toBe(0);
  });

  test("shows 'not enough data' during learning period", async () => {
    await env.writeConfig({ ...DEFAULT_TEST_CONFIG, learning_period_days: 7 });
    await env.writeState(createInstalledState(2, false));

    const db = testDb(join(env.dataDir, "usage.db"));
    generateWeeklyUsage(db, { hoursPerDay: 3, startHour: 9, avgUsage: 50 });
    db.done();

    const result = await runCcmax(["analyze"], env.getEnv());

    expect(result.stdout).toMatch(/not enough data|days remaining/i);
    expect(result.exitCode).toBe(0);
  });

  test("--force bypasses learning period check", async () => {
    await env.writeConfig({ ...DEFAULT_TEST_CONFIG, learning_period_days: 7 });
    await env.writeState(createInstalledState(2, false));

    const db = testDb(join(env.dataDir, "usage.db"));
    generateWeeklyUsage(db, { hoursPerDay: 6, startHour: 9, avgUsage: 50 });
    db.done();

    const result = await runCcmax(["analyze", "--force"], env.getEnv());

    expect(result.stdout).toContain("Weekly Usage Patterns");
    expect(result.stdout).toContain("Recommended Start Times");
    expect(result.exitCode).toBe(0);
  });

  test("shows weekly patterns after learning period", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(14, false));

    const db = testDb(join(env.dataDir, "usage.db"));
    generateWeeklyUsage(db, { hoursPerDay: 6, startHour: 9, avgUsage: 50 });
    db.done();

    const result = await runCcmax(["analyze"], env.getEnv());

    expect(result.stdout).toContain("Weekly Usage Patterns");
    expect(result.stdout).toContain("Recommended Start Times");
    expect(result.stdout).toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday/);
    expect(result.stdout).toContain("Baseline statistics saved");
    expect(result.exitCode).toBe(0);
  });

  test("--save writes optimal times to config", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(14, false));

    const db = testDb(join(env.dataDir, "usage.db"));
    generateWeeklyUsage(db, { hoursPerDay: 6, startHour: 9, avgUsage: 50 });
    db.done();

    const result = await runCcmax(["analyze", "--save"], env.getEnv());

    expect(result.stdout).toContain("Optimal start times saved");
    expect(result.exitCode).toBe(0);

    const config = await env.readConfig();
    const optimalTimes = (config as { optimal_start_times?: Record<string, string | null> }).optimal_start_times;
    expect(optimalTimes).toBeDefined();

    const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday"];
    const hasWeekdayTime = weekdays.some(
      (day) => optimalTimes && optimalTimes[day] !== null
    );
    expect(hasWeekdayTime).toBe(true);
  });

  test("shows confidence scores based on data consistency", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(14, false));

    const db = testDb(join(env.dataDir, "usage.db"));
    generateWeeklyUsage(db, { hoursPerDay: 6, startHour: 9, avgUsage: 50 });
    db.done();

    const result = await runCcmax(["analyze"], env.getEnv());

    expect(result.stdout).toMatch(/\d+% confidence/);
    expect(result.exitCode).toBe(0);
  });

  test("calculates baseline stats on first analysis after learning", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(8, false));

    const db = testDb(join(env.dataDir, "usage.db"));
    generateWeeklyUsage(db, { hoursPerDay: 5, startHour: 10, avgUsage: 50 });
    generateWindows(db, 10, { avgActive: 150 });
    db.done();

    const result = await runCcmax(["analyze"], env.getEnv());

    expect(result.stdout).toContain("Baseline statistics saved");
    expect(result.exitCode).toBe(0);

    const state = await env.readState();
    expect((state as { learning_complete?: boolean }).learning_complete).toBe(true);
  });
});
