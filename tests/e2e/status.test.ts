import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createTestEnv, createInstalledState, DEFAULT_TEST_CONFIG, type TestEnv } from "../helpers/test-env.ts";
import { runCcmax } from "../helpers/cli-runner.ts";
import { testDb } from "../fixtures/seed-db.ts";
import { join } from "path";

/**
 * Extract a section from status output by header name
 */
function extractSection(output: string, sectionName: string): string {
  const lines = output.split("\n");
  const startIdx = lines.findIndex(l => l.includes(sectionName + ":"));
  if (startIdx === -1) return "";

  const endIdx = lines.findIndex((l, i) =>
    i > startIdx && (l.match(/^[A-Z][a-z]+:/) || l.includes("═") || l.includes("Tip:") || l.trim() === "")
  );

  return lines.slice(startIdx, endIdx === -1 ? undefined : endIdx).join("\n");
}

describe("ccmax status", () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  test("shows 'not installed' when state.json does not exist", async () => {
    const result = await runCcmax(["status"], env.getEnv());

    expect(result.stdout).toContain("Installed");
    expect(result.stdout).toMatch(/✗.*No|No/i);
    expect(result.exitCode).toBe(0);
  });

  test("shows learning progress during learning period", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(3, false));

    testDb(join(env.dataDir, "usage.db"))
      .hourly(9, 50)
      .hourly(10, 55)
      .hourly(11, 60)
      .done();

    const result = await runCcmax(["status"], env.getEnv());

    expect(result.stdout).toContain("Learning");
    expect(result.stdout).toMatch(/\d+ \/ 7/);
    expect(result.exitCode).toBe(0);
  });

  test("shows learning complete message after learning period", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(7, true));

    testDb(join(env.dataDir, "usage.db")).done();

    const result = await runCcmax(["status"], env.getEnv());

    expect(result.stdout).toContain("Complete");
    expect(result.exitCode).toBe(0);
  });

  test("shows current window info when window is active", async () => {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const windowEnd = new Date(windowStart.getTime() + 5 * 60 * 60 * 1000);

    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState({
      ...createInstalledState(7, true),
      current_window_start: windowStart.toISOString(),
      current_window_end: windowEnd.toISOString(),
    });

    testDb(join(env.dataDir, "usage.db"))
      .window(
        windowStart.toTimeString().slice(0, 5),
        windowEnd.toTimeString().slice(0, 5),
        { active: 90, usage: 30 }
      )
      .done();

    const result = await runCcmax(["status"], env.getEnv());

    expect(result.stdout).toMatch(/Window|Current|Active/i);
    expect(result.exitCode).toBe(0);
  });

  test("shows installed status when properly set up", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(7, true));

    testDb(join(env.dataDir, "usage.db")).done();

    const result = await runCcmax(["status"], env.getEnv());

    expect(result.stdout).toContain("Installed");
    expect(result.stdout).toMatch(/✓.*Yes|Yes/i);
    expect(result.exitCode).toBe(0);
  });

  test("shows configuration info", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState({
      ...createInstalledState(7, true),
      daemon_pid: null,
    });

    testDb(join(env.dataDir, "usage.db")).done();

    const result = await runCcmax(["status"], env.getEnv());

    expect(result.stdout).toMatch(/Configuration|Learning period|Notifications/i);
    expect(result.exitCode).toBe(0);
  });

  test("shows hourly record count in data collection section", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(3, false));

    testDb(join(env.dataDir, "usage.db"))
      .hourly(9, 50)
      .hourly(10, 55)
      .hourly(11, 60)
      .hourly(12, 65)
      .hourly(13, 70)
      .done();

    const result = await runCcmax(["status"], env.getEnv());

    expect(result.stdout).toContain("Hourly records");
    expect(result.stdout).toMatch(/Hourly records:\s+\d+/);
    expect(result.exitCode).toBe(0);
  });

  test("installation section shows correct format when not installed", async () => {
    const result = await runCcmax(["status"], env.getEnv());

    const installSection = extractSection(result.cleanStdout, "Installation");
    const expectedSection = `\
Installation:
  Installed:      ✗ No
  Hook active:    ✗ No`;

    expect(installSection).toBe(expectedSection);
  });

  test("installation section shows correct format when installed", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(7, true));
    testDb(join(env.dataDir, "usage.db")).done();

    const result = await runCcmax(["status"], env.getEnv());

    const installSection = extractSection(result.cleanStdout, "Installation");
    expect(installSection).toContain("Installed:      ✓ Yes");
  });

  test("configuration section shows correct format", async () => {
    await env.writeConfig({
      ...DEFAULT_TEST_CONFIG,
      learning_period_days: 14,
      auto_adjust_enabled: false,
      notifications_enabled: true,
    });
    await env.writeState(createInstalledState(3, false));
    testDb(join(env.dataDir, "usage.db")).done();

    const result = await runCcmax(["status"], env.getEnv());

    const configSection = extractSection(result.cleanStdout, "Configuration");
    const expectedSection = `\
Configuration:
  Learning period:  14 days
  Auto-adjust:      Disabled
  Notifications:    Enabled`;

    expect(configSection).toBe(expectedSection);
  });

  test("learning progress section shows progress bar when learning", async () => {
    await env.writeConfig({ ...DEFAULT_TEST_CONFIG, learning_period_days: 10 });
    await env.writeState(createInstalledState(5, false));
    testDb(join(env.dataDir, "usage.db")).done();

    const result = await runCcmax(["status"], env.getEnv());

    const learningSection = extractSection(result.cleanStdout, "Learning Progress");

    expect(learningSection).toContain("Learning (5 days remaining)");
    expect(learningSection).toMatch(/\[█+░+\]/);
    expect(learningSection).toContain("50%");
    expect(learningSection).toContain("5 / 10");
  });

  test("learning progress section shows complete status", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(10, true));
    testDb(join(env.dataDir, "usage.db")).done();

    const result = await runCcmax(["status"], env.getEnv());

    const learningSection = extractSection(result.cleanStdout, "Learning Progress");
    expect(learningSection).toContain("Status:           ✓ Complete");
    expect(learningSection).toContain("Days tracked:     10");
  });

  test("data collection section shows counts", async () => {
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(3, false));

    testDb(join(env.dataDir, "usage.db"))
      .hourly(0, 50).hourly(1, 50).hourly(2, 50).hourly(3, 50)
      .hourly(4, 50).hourly(5, 50).hourly(6, 50).hourly(7, 50)
      .hourly(8, 50).hourly(9, 50).hourly(10, 50).hourly(11, 50)
      .window("09:00", "14:00", { active: 60 })
      .window("14:00", "19:00", { active: 90 })
      .window("19:00", "00:00", { active: 120 })
      .done();

    const result = await runCcmax(["status"], env.getEnv());

    const dataSection = extractSection(result.cleanStdout, "Data Collection");
    const expectedSection = `\
Data Collection:
  Hourly records:   12
  Windows tracked:  3`;

    expect(dataSection).toBe(expectedSection);
  });
});
