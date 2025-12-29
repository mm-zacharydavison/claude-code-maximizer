import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createTestEnv, createInstalledState, DEFAULT_TEST_CONFIG, type TestEnv } from "../helpers/test-env.ts";
import { runCcmax } from "../helpers/cli-runner.ts";
import { testDb } from "../fixtures/seed-db.ts";
import { join } from "path";

/**
 * Extract just the graph box (the bars)
 */
function extractGraphBox(output: string): string {
  const lines = output.split("\n");
  const startIdx = lines.findIndex(l => l.includes("┌"));
  const endIdx = lines.findIndex(l => l.includes("└"));
  if (startIdx === -1 || endIdx === -1) return "";
  return lines.slice(startIdx, endIdx + 1).join("\n");
}

describe("ccmax stats", () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  test("shows 'not installed' when not installed", async () => {
    const result = await runCcmax(["stats"], env.getEnv());

    expect(result.stdout).toContain("not installed");
    expect(result.exitCode).toBe(0);
  });

  test("shows 'no data' when database is empty", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(3, false));

    testDb(join(env.dataDir, "usage.db")).done();

    const result = await runCcmax(["stats"], env.getEnv());

    expect(result.stdout).toMatch(/no data|no windows/i);
    expect(result.exitCode).toBe(0);
  });

  test("displays hourly usage graph with data", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(3, false));

    testDb(join(env.dataDir, "usage.db"))
      .hourly(9, 60)
      .hourly(10, 65)
      .hourly(11, 70)
      .done();

    const result = await runCcmax(["stats"], env.getEnv());

    expect(result.stdout).toContain("Usage today");
    expect(result.stdout).toMatch(/█/);
    expect(result.exitCode).toBe(0);
  });

  test("graph only shows today's data, not yesterday's", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(3, false));

    const db = testDb(join(env.dataDir, "usage.db"));
    db.hourly(20, 95, db.yesterday)  // Should NOT appear
      .hourly(8, 15)                  // Should appear (today)
      .done();

    const result = await runCcmax(["stats"], env.getEnv());
    const graph = extractGraphBox(result.cleanStdout);

    // Expected: only hour 8 has a small bar (15% in 0-20% row = ▆)
    // Yesterday's 95% at hour 20 should NOT appear
    const expectedGraph = `\
     ┌────────────────────────────────────────────────┐
100% │                                                │
 80% │                                                │
 60% │                                                │
 40% │                                                │
 20% │                                                │
  0% │                ▆                               │
     └────────────────────────────────────────────────┘`;

    expect(graph).toBe(expectedGraph);
    expect(result.exitCode).toBe(0);
  });

  test("graph shows graduated bar heights for varying usage", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(3, false));

    testDb(join(env.dataDir, "usage.db"))
      .hourly(2, 15)   // 0-20% row only (▆)
      .hourly(4, 35)   // 20-40% row partial + 0-20% full
      .hourly(6, 95)   // Nearly full height
      .done();

    const result = await runCcmax(["stats"], env.getEnv());
    const graph = extractGraphBox(result.cleanStdout);

    const expectedGraph = `\
     ┌────────────────────────────────────────────────┐
100% │                                                │
 80% │            ▆                                   │
 60% │            █                                   │
 40% │            █                                   │
 20% │        ▆   █                                   │
  0% │    ▆   █   █                                   │
     └────────────────────────────────────────────────┘`;

    expect(graph).toBe(expectedGraph);
  });

  test("graph shows empty when no data for today", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(3, false));

    const db = testDb(join(env.dataDir, "usage.db"));
    db.hourly(10, 80, db.yesterday)
      .hourly(14, 60, db.yesterday)
      .done();

    const result = await runCcmax(["stats"], env.getEnv());
    const graph = extractGraphBox(result.cleanStdout);

    const expectedGraph = `\
     ┌────────────────────────────────────────────────┐
100% │                                                │
 80% │                                                │
 60% │                                                │
 40% │                                                │
 20% │                                                │
  0% │                                                │
     └────────────────────────────────────────────────┘`;

    expect(graph).toBe(expectedGraph);
  });

  test("graph shows full bar at 100% usage", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(3, false));

    testDb(join(env.dataDir, "usage.db"))
      .hourly(12, 100)
      .done();

    const result = await runCcmax(["stats"], env.getEnv());
    const graph = extractGraphBox(result.cleanStdout);

    // 100% fills up to 80-100% row (100% row is for >100%)
    const expectedGraph = `\
     ┌────────────────────────────────────────────────┐
100% │                                                │
 80% │                        █                       │
 60% │                        █                       │
 40% │                        █                       │
 20% │                        █                       │
  0% │                        █                       │
     └────────────────────────────────────────────────┘`;

    expect(graph).toBe(expectedGraph);
  });

  test("shows window utilization summary", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(7, true));

    testDb(join(env.dataDir, "usage.db"))
      .window("02:00", "07:00", { active: 180, usage: 60 })
      .window("08:00", "13:00", { active: 120, usage: 40 })
      .done();

    const result = await runCcmax(["stats"], env.getEnv());

    expect(result.stdout).toContain("Windows");
    expect(result.stdout).toMatch(/180 min active/);
    expect(result.stdout).toMatch(/120 min active/);
    expect(result.exitCode).toBe(0);
  });

  test("shows impact metrics after optimization", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(14, true));

    testDb(join(env.dataDir, "usage.db"))
      .baseline({
        avg_windows_per_day: 2.5,
        avg_utilization: 45,
        avg_wasted_minutes_per_window: 165,
      })
      .impact({
        windowsUsed: 1,
        windowsPredicted: 2,
        avgUtilization: 75,
        isOptimized: true,
      })
      .window("09:00", "14:00", { active: 150, usage: 50 })
      .done();

    const result = await runCcmax(["stats"], env.getEnv());

    expect(result.stdout).toMatch(/impact|Windows avoided|utilization/i);
    expect(result.exitCode).toBe(0);
  });

  test("hides impact section during learning period", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(3, false));

    testDb(join(env.dataDir, "usage.db"))
      .window("09:00", "14:00", { active: 150, usage: 50 })
      .done();

    const result = await runCcmax(["stats"], env.getEnv());

    expect(result.stdout).not.toContain("Windows avoided");
    expect(result.exitCode).toBe(0);
  });
});
