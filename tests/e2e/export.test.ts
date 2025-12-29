import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createTestEnv, createInstalledState, DEFAULT_TEST_CONFIG, type TestEnv } from "../helpers/test-env.ts";
import { runCcmax } from "../helpers/cli-runner.ts";
import { testDb } from "../fixtures/seed-db.ts";
import { join } from "path";
import { readFileSync, existsSync } from "fs";

describe("ccmax export", () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(7, true));
  });

  afterEach(async () => {
    await env.cleanup();
  });

  test("exports JSON to file with all data types", async () => {
    const db = testDb(join(env.dataDir, "usage.db"));
    db.hourly(9, 50)
      .hourly(10, 55)
      .hourly(11, 60)
      .window("09:00", "14:00", { active: 60, usage: 20 })
      .done();

    const outputFile = join(env.testDir, "export.json");
    const result = await runCcmax(["export", outputFile], env.getEnv());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Exporting data");
    expect(result.stdout).toContain("Exported");

    // Verify file was created
    expect(existsSync(outputFile)).toBe(true);

    // Verify JSON content
    const exported = JSON.parse(readFileSync(outputFile, "utf-8"));
    expect(exported.hourlyUsage).toBeArray();
    expect(exported.hourlyUsage.length).toBeGreaterThan(0);
    expect(exported.windows).toBeArray();
    expect(exported.windows.length).toBe(1);
  });

  test("exports CSV format with --csv flag", async () => {
    testDb(join(env.dataDir, "usage.db"))
      .hourly(9, 50)
      .hourly(10, 55)
      .hourly(11, 60)
      .done();

    const outputFile = join(env.testDir, "export.json");
    const result = await runCcmax(["export", "--csv", outputFile], env.getEnv());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Exported");

    // CSV files are named differently
    const hourlyFile = join(env.testDir, "export-hourly.csv");
    expect(existsSync(hourlyFile)).toBe(true);

    // Verify CSV content
    const csvContent = readFileSync(hourlyFile, "utf-8");
    expect(csvContent).toContain("date_hour,usage_pct");
    expect(csvContent).toContain(",");
  });

  test("uses default filename when not specified", async () => {
    testDb(join(env.dataDir, "usage.db"))
      .hourly(9, 50)
      .hourly(10, 55)
      .done();

    const result = await runCcmax(["export"], env.getEnv());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ccmax-export.json");
  });

  test("handles empty database gracefully", async () => {
    testDb(join(env.dataDir, "usage.db")).done();

    const outputFile = join(env.testDir, "empty-export.json");
    const result = await runCcmax(["export", outputFile], env.getEnv());

    expect(result.exitCode).toBe(0);

    // Verify file was created
    expect(existsSync(outputFile)).toBe(true);

    // Verify empty arrays
    const exported = JSON.parse(readFileSync(outputFile, "utf-8"));
    expect(exported.hourlyUsage).toBeArray();
    expect(exported.hourlyUsage.length).toBe(0);
    expect(exported.windows).toBeArray();
    expect(exported.windows.length).toBe(0);
  });

  test("shows not installed message when not installed", async () => {
    // Remove state file to simulate uninstalled
    const { unlinkSync } = await import("fs");
    const statePath = join(env.dataDir, "state.json");
    if (existsSync(statePath)) {
      unlinkSync(statePath);
    }

    const result = await runCcmax(["export"], env.getEnv());

    expect(result.stdout).toContain("not installed");
  });

  test("shows no data message when database doesn't exist", async () => {
    // State exists but no database
    const result = await runCcmax(["export"], env.getEnv());

    expect(result.stdout).toContain("No data to export");
  });

  test("export includes config and state", async () => {
    testDb(join(env.dataDir, "usage.db"))
      .hourly(9, 50)
      .hourly(10, 55)
      .done();

    const outputFile = join(env.testDir, "full-export.json");
    const result = await runCcmax(["export", outputFile], env.getEnv());

    expect(result.exitCode).toBe(0);

    const exported = JSON.parse(readFileSync(outputFile, "utf-8"));
    expect(exported.config).toBeDefined();
    expect(exported.state).toBeDefined();
    expect(exported.exportedAt).toBeDefined();
  });
});
