import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createTestEnv, createInstalledState, DEFAULT_TEST_CONFIG, type TestEnv } from "../helpers/test-env.ts";
import { runCcmax } from "../helpers/cli-runner.ts";
import { testDb } from "../fixtures/seed-db.ts";
import { join } from "path";

describe("ccmax config", () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(7, true));

    testDb(join(env.dataDir, "usage.db")).done();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  test("shows all settings with no arguments", async () => {
    const result = await runCcmax(["config"], env.getEnv());

    expect(result.stdout).toContain("learning_period_days");
    expect(result.stdout).toContain("notifications_enabled");
    expect(result.stdout).toContain("Optimal Start Times");
    expect(result.exitCode).toBe(0);
  });

  test("config show displays formatted output", async () => {
    const result = await runCcmax(["config", "show"], env.getEnv());

    expect(result.stdout).toContain("ccmax Configuration");
    expect(result.stdout).toContain("General:");
    expect(result.stdout).toContain("7"); // learning_period_days value
    expect(result.exitCode).toBe(0);
  });

  test("set updates numeric value", async () => {
    const result = await runCcmax(["config", "set", "learning_period_days", "14"], env.getEnv());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Set learning_period_days = 14");

    // Verify config was updated
    const config = await env.readConfig();
    expect((config as { learning_period_days?: number }).learning_period_days).toBe(14);
  });

  test("set updates boolean value", async () => {
    const result = await runCcmax(["config", "set", "notifications_enabled", "false"], env.getEnv());

    expect(result.exitCode).toBe(0);

    const config = await env.readConfig();
    expect((config as { notifications_enabled?: boolean }).notifications_enabled).toBe(false);
  });

  test("set updates optimal start time with optimal.day format", async () => {
    const result = await runCcmax(
      ["config", "set", "optimal.monday", "08:30"],
      env.getEnv()
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Set optimal.monday = 08:30");

    const config = await env.readConfig();
    const optimalTimes = (config as { optimal_start_times?: Record<string, string | null> }).optimal_start_times;
    expect(optimalTimes?.monday).toBe("08:30");
  });

  test("set clears optimal time with null value", async () => {
    // First set a value
    await runCcmax(["config", "set", "optimal.monday", "08:30"], env.getEnv());

    // Then clear it
    const result = await runCcmax(
      ["config", "set", "optimal.monday", "null"],
      env.getEnv()
    );

    expect(result.exitCode).toBe(0);

    const config = await env.readConfig();
    const optimalTimes = (config as { optimal_start_times?: Record<string, string | null> }).optimal_start_times;
    expect(optimalTimes?.monday).toBeNull();
  });

  test("set validates time format", async () => {
    const result = await runCcmax(
      ["config", "set", "optimal.monday", "invalid"],
      env.getEnv()
    );

    // Should fail with invalid format
    expect(result.stdout).toContain("HH:MM format");
  });

  test("set rejects unknown key", async () => {
    const result = await runCcmax(
      ["config", "set", "unknown_key", "value"],
      env.getEnv()
    );

    expect(result.stdout).toContain("Unknown key");
  });

  test("reset restores defaults", async () => {
    // First modify config
    await runCcmax(["config", "set", "learning_period_days", "14"], env.getEnv());
    await runCcmax(["config", "set", "notifications_enabled", "false"], env.getEnv());

    // Then reset
    const result = await runCcmax(["config", "reset"], env.getEnv());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("reset to defaults");

    // Verify defaults restored
    const config = await env.readConfig();
    expect((config as { learning_period_days?: number }).learning_period_days).toBe(7);
    expect((config as { notifications_enabled?: boolean }).notifications_enabled).toBe(true);
  });

  test("path shows config file location", async () => {
    const result = await runCcmax(["config", "path"], env.getEnv());

    expect(result.stdout).toContain("config.json");
    expect(result.exitCode).toBe(0);
  });

  test("unknown subcommand shows help", async () => {
    const result = await runCcmax(["config", "unknown"], env.getEnv());

    expect(result.stdout).toContain("ccmax config");
    expect(result.stdout).toContain("USAGE");
    expect(result.stdout).toMatch(/set|reset|show/i);
  });

  test("config show displays full formatted output with defaults", async () => {
    const result = await runCcmax(["config", "show"], env.getEnv());

    // Extract the main config section (excluding the path line which varies by env)
    const lines = result.cleanStdout.split("\n");
    const startIdx = lines.findIndex(l => l.includes("ccmax Configuration"));
    const endIdx = lines.findIndex(l => l.includes("Config file:"));
    const configSection = lines.slice(startIdx, endIdx).join("\n").trimEnd();

    const expectedOutput = `\
ccmax Configuration
══════════════════════════════════════════════════

General:
  learning_period_days:        7
  notifications_enabled:       true
  auto_adjust_enabled:         true
  notification_advance_minutes: 5

Optimal Start Times:
  monday       (not set)
  tuesday      (not set)
  wednesday    (not set)
  thursday     (not set)
  friday       (not set)
  saturday     (not set)
  sunday       (not set)`;

    expect(configSection).toBe(expectedOutput);
  });

  test("config show displays custom optimal times", async () => {
    await env.writeConfig({
      ...DEFAULT_TEST_CONFIG,
      optimal_start_times: {
        monday: "09:00",
        tuesday: "08:30",
        wednesday: "09:15",
        thursday: null,
        friday: "08:45",
        saturday: "10:00",
        sunday: null,
      },
    });

    const result = await runCcmax(["config", "show"], env.getEnv());

    // Check the optimal times section
    expect(result.cleanStdout).toContain("monday       09:00");
    expect(result.cleanStdout).toContain("tuesday      08:30");
    expect(result.cleanStdout).toContain("wednesday    09:15");
    expect(result.cleanStdout).toContain("thursday     (not set)");
    expect(result.cleanStdout).toContain("friday       08:45");
    expect(result.cleanStdout).toContain("saturday     10:00");
    expect(result.cleanStdout).toContain("sunday       (not set)");
  });

  test("config show displays custom general settings", async () => {
    await env.writeConfig({
      ...DEFAULT_TEST_CONFIG,
      learning_period_days: 14,
      notifications_enabled: false,
      auto_adjust_enabled: false,
      notification_advance_minutes: 10,
    });

    const result = await runCcmax(["config", "show"], env.getEnv());

    expect(result.cleanStdout).toContain("learning_period_days:        14");
    expect(result.cleanStdout).toContain("notifications_enabled:       false");
    expect(result.cleanStdout).toContain("auto_adjust_enabled:         false");
    expect(result.cleanStdout).toContain("notification_advance_minutes: 10");
  });
});
