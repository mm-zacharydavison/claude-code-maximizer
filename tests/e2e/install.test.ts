import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createTestEnv, DEFAULT_TEST_CONFIG, createInstalledState, type TestEnv } from "../helpers/test-env.ts";
import { runCcmax } from "../helpers/cli-runner.ts";
import { testDb } from "../fixtures/seed-db.ts";
import { join } from "path";
import { existsSync } from "node:fs";

describe("ccmax install", () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  describe("reinstall", () => {
    test("reinstalls when already installed", async () => {
      // Set up as already installed
      await env.writeConfig(DEFAULT_TEST_CONFIG);
      await env.writeState(createInstalledState(10, false));

      // Create some existing data
      testDb(join(env.dataDir, "usage.db"))
        .hourly(10, 50)
        .window("09:00", "14:00", { active: 150, usage: 60 })
        .done();

      const result = await runCcmax(["install", "-q"], env.getEnv());

      expect(result.stdout).toContain("reinstalled");
      expect(result.exitCode).toBe(0);
    });

    test("reinstall preserves installed_at timestamp", async () => {
      // Set up with a specific installed_at timestamp (10 days ago)
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      await env.writeConfig(DEFAULT_TEST_CONFIG);
      await env.writeState({
        installed_at: tenDaysAgo,
        learning_complete: false,
        current_window_start: null,
        current_window_end: null,
        daemon_pid: null,
      });

      // Create database so isInstalled() returns true
      testDb(join(env.dataDir, "usage.db")).done();

      // Reinstall
      const result = await runCcmax(["install", "-q"], env.getEnv());
      expect(result.exitCode).toBe(0);

      // Verify installed_at was preserved
      const state = await env.readState() as { installed_at: string };
      expect(state.installed_at).toBe(tenDaysAgo);
    });

    test("reinstall preserves learning_complete status", async () => {
      // Set up as already completed learning
      await env.writeConfig(DEFAULT_TEST_CONFIG);
      await env.writeState({
        installed_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
        learning_complete: true,
        current_window_start: null,
        current_window_end: null,
        daemon_pid: null,
      });

      testDb(join(env.dataDir, "usage.db")).done();

      // Reinstall
      const result = await runCcmax(["install", "-q"], env.getEnv());
      expect(result.exitCode).toBe(0);

      // Verify learning_complete was preserved
      const state = await env.readState() as { learning_complete: boolean };
      expect(state.learning_complete).toBe(true);
    });

    test("reinstall preserves learning_period_days config", async () => {
      // Set up with custom learning period
      const customConfig = {
        ...DEFAULT_TEST_CONFIG,
        learning_period_days: 14,
      };
      await env.writeConfig(customConfig);
      await env.writeState(createInstalledState(5, false));

      testDb(join(env.dataDir, "usage.db")).done();

      // Reinstall
      const result = await runCcmax(["install", "-q"], env.getEnv());
      expect(result.exitCode).toBe(0);

      // Verify learning_period_days was preserved
      const config = await env.readConfig() as { learning_period_days: number };
      expect(config.learning_period_days).toBe(14);
    });

    test("reinstall preserves existing database data", async () => {
      await env.writeConfig(DEFAULT_TEST_CONFIG);
      await env.writeState(createInstalledState(7, false));

      // Create database with some data
      const dbPath = join(env.dataDir, "usage.db");
      testDb(dbPath)
        .hourly(10, 50)
        .hourly(11, 60)
        .window("09:00", "14:00", { active: 150, usage: 65 })
        .done();

      // Reinstall
      const result = await runCcmax(["install", "-q"], env.getEnv());
      expect(result.exitCode).toBe(0);

      // Verify database still exists and has data
      expect(existsSync(dbPath)).toBe(true);

      // Run stats to verify data is intact
      const statsResult = await runCcmax(["stats"], env.getEnv());
      expect(statsResult.stdout).toContain("65%");
    });

    test("reinstall preserves sync configuration", async () => {
      const configWithSync = {
        ...DEFAULT_TEST_CONFIG,
        sync: {
          gist_id: "my-gist-id-12345",
          last_sync: "2026-01-01T00:00:00.000Z",
          last_sync_hash: "abc123",
          machine_id: "my-machine-id",
        },
      };
      await env.writeConfig(configWithSync);
      await env.writeState(createInstalledState(7, false));

      testDb(join(env.dataDir, "usage.db")).done();

      // Reinstall
      const result = await runCcmax(["install", "-q"], env.getEnv());
      expect(result.exitCode).toBe(0);

      // Verify sync config was preserved
      const config = await env.readConfig() as { sync: { gist_id: string; machine_id: string } };
      expect(config.sync.gist_id).toBe("my-gist-id-12345");
      expect(config.sync.machine_id).toBe("my-machine-id");
    });

    test("reinstall shows appropriate message", async () => {
      await env.writeConfig(DEFAULT_TEST_CONFIG);
      await env.writeState(createInstalledState(5, false));
      testDb(join(env.dataDir, "usage.db")).done();

      // Run without -q to see full output
      const result = await runCcmax(["install", "--skip-onboarding"], env.getEnv());

      expect(result.stdout).toContain("Reinstalling");
      expect(result.stdout).toContain("preserving existing data");
      expect(result.stdout).toContain("Reinstall complete");
      expect(result.exitCode).toBe(0);
    });

    test("fresh install sets installed_at to current time", async () => {
      // No existing state or config
      const beforeInstall = Date.now();

      const result = await runCcmax(["install", "-q", "--skip-onboarding"], env.getEnv());
      expect(result.exitCode).toBe(0);

      const afterInstall = Date.now();

      // Verify installed_at was set to approximately now
      const state = await env.readState() as { installed_at: string };
      const installedAt = new Date(state.installed_at).getTime();

      expect(installedAt).toBeGreaterThanOrEqual(beforeInstall);
      expect(installedAt).toBeLessThanOrEqual(afterInstall);
    });

    test("fresh install shows welcome message", async () => {
      const result = await runCcmax(["install", "--skip-onboarding"], env.getEnv());

      expect(result.stdout).toContain("Welcome to Claude Code Maximizer");
      expect(result.stdout).toContain("Setup complete");
      expect(result.stdout).not.toContain("Reinstalling");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("analyze status preservation", () => {
    test("days tracked is preserved across reinstall", async () => {
      // Set up as installed 10 days ago with some progress
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      await env.writeConfig({
        ...DEFAULT_TEST_CONFIG,
        learning_period_days: 14,
      });
      await env.writeState({
        installed_at: tenDaysAgo,
        learning_complete: false,
        current_window_start: null,
        current_window_end: null,
        daemon_pid: null,
      });

      testDb(join(env.dataDir, "usage.db")).done();

      // Check status before reinstall
      const beforeResult = await runCcmax(["status"], env.getEnv());
      expect(beforeResult.stdout).toMatch(/Days tracked:\s+10/);

      // Reinstall
      const installResult = await runCcmax(["install", "-q"], env.getEnv());
      expect(installResult.exitCode).toBe(0);

      // Check status after reinstall - should still show 10 days
      const afterResult = await runCcmax(["status"], env.getEnv());
      expect(afterResult.stdout).toMatch(/Days tracked:\s+10/);
    });

    test("learning progress percentage is preserved across reinstall", async () => {
      // Set up as 7 days into a 14 day learning period (50%)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      await env.writeConfig({
        ...DEFAULT_TEST_CONFIG,
        learning_period_days: 14,
      });
      await env.writeState({
        installed_at: sevenDaysAgo,
        learning_complete: false,
        current_window_start: null,
        current_window_end: null,
        daemon_pid: null,
      });

      testDb(join(env.dataDir, "usage.db")).done();

      // Check status before reinstall
      const beforeResult = await runCcmax(["status"], env.getEnv());
      expect(beforeResult.stdout).toMatch(/Progress:\s+.*50%/);

      // Reinstall
      const installResult = await runCcmax(["install", "-q"], env.getEnv());
      expect(installResult.exitCode).toBe(0);

      // Check status after reinstall - should still show 50%
      const afterResult = await runCcmax(["status"], env.getEnv());
      expect(afterResult.stdout).toMatch(/Progress:\s+.*50%/);
    });

    test("completed learning status is preserved across reinstall", async () => {
      // Set up as having completed learning
      await env.writeConfig(DEFAULT_TEST_CONFIG);
      await env.writeState({
        installed_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        learning_complete: true,
        current_window_start: null,
        current_window_end: null,
        daemon_pid: null,
      });

      testDb(join(env.dataDir, "usage.db")).done();

      // Check status before reinstall shows learning complete
      const beforeResult = await runCcmax(["status"], env.getEnv());
      expect(beforeResult.stdout).toMatch(/Status:\s+.*Complete/i);

      // Reinstall
      const installResult = await runCcmax(["install", "-q"], env.getEnv());
      expect(installResult.exitCode).toBe(0);

      // Check status after reinstall - should still show complete
      const afterResult = await runCcmax(["status"], env.getEnv());
      expect(afterResult.stdout).toMatch(/Status:\s+.*Complete/i);
    });
  });
});
