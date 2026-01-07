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
    expect(result.stdout).toMatch(/60%.*used/);
    expect(result.stdout).toMatch(/40%.*used/);
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

  describe("--days-ago flag", () => {
    test("--days-ago 1 shows yesterday's data", async () => {
      await env.writeConfig(DEFAULT_TEST_CONFIG);
      await env.writeState(createInstalledState(3, false));

      const db = testDb(join(env.dataDir, "usage.db"));
      db.hourly(10, 80, db.yesterday)  // Yesterday's data
        .hourly(10, 30)                 // Today's data
        .done();

      const result = await runCcmax(["stats", "--days-ago", "1"], env.getEnv());
      const graph = extractGraphBox(result.cleanStdout);

      // Should show yesterday's 80% usage at hour 10, not today's 30%
      expect(result.stdout).toContain("Usage yesterday");
      expect(graph).toContain("█"); // 80% should have full blocks
      expect(result.exitCode).toBe(0);
    });

    test("--days-ago=1 format works", async () => {
      await env.writeConfig(DEFAULT_TEST_CONFIG);
      await env.writeState(createInstalledState(3, false));

      const db = testDb(join(env.dataDir, "usage.db"));
      db.hourly(12, 60, db.yesterday)
        .done();

      const result = await runCcmax(["stats", "--days-ago=1"], env.getEnv());

      expect(result.stdout).toContain("Usage yesterday");
      expect(result.exitCode).toBe(0);
    });

    test("--days-ago 2 shows data from 2 days ago with date in title", async () => {
      await env.writeConfig(DEFAULT_TEST_CONFIG);
      await env.writeState(createInstalledState(3, false));

      const db = testDb(join(env.dataDir, "usage.db"));
      const twoDaysAgo = db.daysAgo(2);
      db.hourly(14, 70, twoDaysAgo)
        .hourly(14, 40)  // Today's data (should not appear)
        .done();

      const result = await runCcmax(["stats", "--days-ago", "2"], env.getEnv());

      // Should show date in YYYY-MM-DD format (local time, not UTC)
      const year = twoDaysAgo.getFullYear();
      const month = String(twoDaysAgo.getMonth() + 1).padStart(2, "0");
      const day = String(twoDaysAgo.getDate()).padStart(2, "0");
      const expectedDate = `${year}-${month}-${day}`;
      expect(result.stdout).toContain(`Usage ${expectedDate}`);
      expect(result.exitCode).toBe(0);
    });

    test("--days-ago shows empty graph for day with no data", async () => {
      await env.writeConfig(DEFAULT_TEST_CONFIG);
      await env.writeState(createInstalledState(3, false));

      const db = testDb(join(env.dataDir, "usage.db"));
      db.hourly(10, 80)  // Only today has data
        .done();

      const result = await runCcmax(["stats", "--days-ago", "3"], env.getEnv());
      const graph = extractGraphBox(result.cleanStdout);

      // Graph should be empty (no █ characters)
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
      expect(result.exitCode).toBe(0);
    });

    test("--days-ago shows windows for specified day only", async () => {
      await env.writeConfig(DEFAULT_TEST_CONFIG);
      await env.writeState(createInstalledState(7, true));

      const db = testDb(join(env.dataDir, "usage.db"));
      db.window("09:00", "14:00", { active: 200, usage: 65, date: db.yesterday })
        .window("10:00", "15:00", { active: 100, usage: 30 })  // Today
        .done();

      const result = await runCcmax(["stats", "--days-ago", "1"], env.getEnv());

      expect(result.stdout).toMatch(/65%.*used/);
      expect(result.stdout).not.toMatch(/30%.*used/);
      expect(result.exitCode).toBe(0);
    });

    test("--days-ago with no windows shows appropriate message", async () => {
      await env.writeConfig(DEFAULT_TEST_CONFIG);
      await env.writeState(createInstalledState(7, true));

      const db = testDb(join(env.dataDir, "usage.db"));
      db.window("10:00", "15:00", { active: 100, usage: 30 })  // Today only
        .done();

      const result = await runCcmax(["stats", "--days-ago", "1"], env.getEnv());

      expect(result.stdout).toMatch(/no windows recorded yesterday/i);
      expect(result.exitCode).toBe(0);
    });

    test("--days-ago combined with --local works", async () => {
      await env.writeConfig(DEFAULT_TEST_CONFIG);
      await env.writeState(createInstalledState(3, false));

      const db = testDb(join(env.dataDir, "usage.db"));
      db.hourly(11, 55, db.yesterday)
        .done();

      const result = await runCcmax(["stats", "--days-ago", "1", "--local"], env.getEnv());

      expect(result.stdout).toContain("Usage yesterday");
      expect(result.exitCode).toBe(0);
    });

    test("invalid --days-ago value defaults to today", async () => {
      await env.writeConfig(DEFAULT_TEST_CONFIG);
      await env.writeState(createInstalledState(3, false));

      const db = testDb(join(env.dataDir, "usage.db"));
      db.hourly(10, 50)
        .done();

      const result = await runCcmax(["stats", "--days-ago", "invalid"], env.getEnv());

      expect(result.stdout).toContain("Usage today");
      expect(result.exitCode).toBe(0);
    });

    test("negative --days-ago value defaults to today", async () => {
      await env.writeConfig(DEFAULT_TEST_CONFIG);
      await env.writeState(createInstalledState(3, false));

      const db = testDb(join(env.dataDir, "usage.db"));
      db.hourly(10, 50)
        .done();

      const result = await runCcmax(["stats", "--days-ago", "-1"], env.getEnv());

      expect(result.stdout).toContain("Usage today");
      expect(result.exitCode).toBe(0);
    });

    test("--days-ago with aggregate data shows empty graph for day with no data", async () => {
      // Configure sync so aggregate path is used
      const configWithSync = {
        ...DEFAULT_TEST_CONFIG,
        sync: {
          gist_id: "test-gist-id",
          last_sync: new Date().toISOString(),
          last_sync_hash: "abc123",
          machine_id: "test-machine",
        },
      };
      await env.writeConfig(configWithSync);
      await env.writeState(createInstalledState(3, false));

      // Create local DB with today's data
      const db = testDb(join(env.dataDir, "usage.db"));
      db.hourly(12, 85)  // Today at noon, 85% usage
        .hourly(13, 90)  // Today at 1pm, 90% usage
        .done();

      // Create sync cache with today's hourly data (simulating synced data)
      const today = new Date();
      const todayHour12 = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}-12`;
      const todayHour13 = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}-13`;

      await env.writeSyncCache({
        version: 1,
        updated_at: new Date().toISOString(),
        machines: {
          "test-machine": {
            machine_id: "test-machine",
            hostname: "test-host",
            last_update: new Date().toISOString(),
            windows: [],
            hourly_usage: [
              { date_hour: todayHour12, usage_pct: 85 },
              { date_hour: todayHour13, usage_pct: 90 },
            ],
          },
        },
      });

      // Query for 5 days ago (should have no data)
      const result = await runCcmax(["stats", "--days-ago", "5"], env.getEnv());
      const graph = extractGraphBox(result.cleanStdout);

      // Graph should be empty - today's data should NOT bleed through
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
      expect(result.exitCode).toBe(0);
    });
  });
});
