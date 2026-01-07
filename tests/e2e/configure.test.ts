import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createTestEnv, createInstalledState, DEFAULT_TEST_CONFIG, type TestEnv } from "../helpers/test-env.ts";
import { runCcmax } from "../helpers/cli-runner.ts";
import { testDb } from "../fixtures/seed-db.ts";
import { join } from "path";

describe("ccmax configure", () => {
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

  describe("help", () => {
    test("--help shows usage information", async () => {
      const result = await runCcmax(["configure", "--help"], env.getEnv());

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("ccmax configure");
      expect(result.stdout).toContain("USAGE:");
      expect(result.stdout).toContain("configure show");
      expect(result.stdout).toContain("configure reset");
    });

    test("-h shows usage information", async () => {
      const result = await runCcmax(["configure", "-h"], env.getEnv());

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("USAGE:");
    });
  });

  describe("show", () => {
    test("shows 'not configured' when working hours disabled", async () => {
      const result = await runCcmax(["configure", "show"], env.getEnv());

      expect(result.exitCode).toBe(0);
      expect(result.cleanStdout).toContain("Current working hours configuration:");
      expect(result.cleanStdout).toContain("Not configured (using automatic detection)");
    });

    test("shows configured hours when enabled", async () => {
      await env.writeConfig({
        ...DEFAULT_TEST_CONFIG,
        working_hours: {
          enabled: true,
          work_days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
          hours: {
            monday: { start: "09:00", end: "17:00" },
            tuesday: { start: "09:00", end: "17:00" },
            wednesday: { start: "09:00", end: "17:00" },
            thursday: { start: "09:00", end: "17:00" },
            friday: { start: "09:00", end: "17:00" },
          },
          auto_adjust_from_usage: true,
        },
      });

      const result = await runCcmax(["configure", "show"], env.getEnv());

      expect(result.exitCode).toBe(0);
      expect(result.cleanStdout).toContain("Work days: Monday, Tuesday, Wednesday, Thursday, Friday");
      expect(result.cleanStdout).toContain("Hours:");
      expect(result.cleanStdout).toContain("Monday: 09:00 - 17:00");
      expect(result.cleanStdout).toContain("Auto-adjust from usage: Yes");
    });

    test("shows custom work days correctly", async () => {
      await env.writeConfig({
        ...DEFAULT_TEST_CONFIG,
        working_hours: {
          enabled: true,
          work_days: ["monday", "wednesday", "friday"],
          hours: {
            monday: { start: "08:00", end: "16:00" },
            wednesday: { start: "10:00", end: "18:00" },
            friday: { start: "09:00", end: "15:00" },
          },
          auto_adjust_from_usage: false,
        },
      });

      const result = await runCcmax(["configure", "show"], env.getEnv());

      expect(result.exitCode).toBe(0);
      expect(result.cleanStdout).toContain("Work days: Monday, Wednesday, Friday");
      expect(result.cleanStdout).toContain("Monday: 08:00 - 16:00");
      expect(result.cleanStdout).toContain("Wednesday: 10:00 - 18:00");
      expect(result.cleanStdout).toContain("Friday: 09:00 - 15:00");
      expect(result.cleanStdout).toContain("Auto-adjust from usage: No");
    });
  });

  describe("reset", () => {
    test("resets working hours to disabled state", async () => {
      // First set up configured working hours
      await env.writeConfig({
        ...DEFAULT_TEST_CONFIG,
        working_hours: {
          enabled: true,
          work_days: ["monday", "tuesday"],
          hours: {
            monday: { start: "09:00", end: "17:00" },
            tuesday: { start: "09:00", end: "17:00" },
          },
          auto_adjust_from_usage: false,
        },
      });

      const result = await runCcmax(["configure", "reset"], env.getEnv());

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Working hours configuration reset");
      expect(result.stdout).toContain("automatic detection");

      // Verify config was actually reset
      const config = await env.readConfig();
      const workingHours = (config as { working_hours?: { enabled: boolean } }).working_hours;
      expect(workingHours?.enabled).toBe(false);
    });

    test("reset sets default work days to Mon-Fri", async () => {
      await env.writeConfig({
        ...DEFAULT_TEST_CONFIG,
        working_hours: {
          enabled: true,
          work_days: ["saturday", "sunday"],
          hours: {},
          auto_adjust_from_usage: false,
        },
      });

      await runCcmax(["configure", "reset"], env.getEnv());

      const config = await env.readConfig();
      const workingHours = (config as { working_hours?: { work_days: string[] } }).working_hours;
      expect(workingHours?.work_days).toEqual(["monday", "tuesday", "wednesday", "thursday", "friday"]);
    });

    test("reset clears hours configuration", async () => {
      await env.writeConfig({
        ...DEFAULT_TEST_CONFIG,
        working_hours: {
          enabled: true,
          work_days: ["monday"],
          hours: {
            monday: { start: "09:00", end: "17:00" },
          },
          auto_adjust_from_usage: false,
        },
      });

      await runCcmax(["configure", "reset"], env.getEnv());

      const config = await env.readConfig();
      const workingHours = (config as { working_hours?: { hours: object } }).working_hours;
      expect(workingHours?.hours).toEqual({});
    });

    test("reset enables auto_adjust_from_usage", async () => {
      await env.writeConfig({
        ...DEFAULT_TEST_CONFIG,
        working_hours: {
          enabled: true,
          work_days: ["monday"],
          hours: {},
          auto_adjust_from_usage: false,
        },
      });

      await runCcmax(["configure", "reset"], env.getEnv());

      const config = await env.readConfig();
      const workingHours = (config as { working_hours?: { auto_adjust_from_usage: boolean } }).working_hours;
      expect(workingHours?.auto_adjust_from_usage).toBe(true);
    });
  });

  describe("error handling", () => {
    test("unknown subcommand shows error and help", async () => {
      const result = await runCcmax(["configure", "unknown"], env.getEnv());

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unknown subcommand: unknown");
      expect(result.stdout).toContain("USAGE:");
    });

    test("requires installation", async () => {
      // Write state without installation
      await env.writeState({});

      const result = await runCcmax(["configure", "show"], env.getEnv());

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not installed");
    });
  });
});
