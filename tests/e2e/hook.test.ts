import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createTestEnv, createInstalledState, DEFAULT_TEST_CONFIG, type TestEnv } from "../helpers/test-env.ts";
import { runCcmax } from "../helpers/cli-runner.ts";
import { testDb, queryWindows } from "../fixtures/seed-db.ts";
import { join } from "path";

describe("ccmax hook", () => {
  let env: TestEnv;
  let dbPath: string;

  beforeEach(async () => {
    env = await createTestEnv();
    await env.writeConfig(DEFAULT_TEST_CONFIG);
    await env.writeState(createInstalledState(7, true));

    dbPath = join(env.dataDir, "usage.db");
    testDb(dbPath).done();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  test("ignores pre_tool events (only prompt_submit is recorded)", async () => {
    const result = await runCcmax(["hook", "--event", "pre_tool", "--tool", "Read"], env.getEnv());

    expect(result.exitCode).toBe(0);
    expect(queryWindows(dbPath).length).toBe(0);
  });

  test("ignores post_tool events (only prompt_submit is recorded)", async () => {
    const result = await runCcmax(["hook", "--event", "post_tool", "--tool", "Edit"], env.getEnv());

    expect(result.exitCode).toBe(0);
    expect(queryWindows(dbPath).length).toBe(0);
  });

  test("creates new window on prompt_submit", async () => {
    await env.writeState({
      ...createInstalledState(7, true),
      current_window_start: null,
      current_window_end: null,
    });

    const result = await runCcmax(["hook", "--event", "prompt_submit"], env.getEnv());

    expect(result.exitCode).toBe(0);

    const windows = queryWindows(dbPath);
    expect(windows.length).toBe(1);
    expect(windows[0]?.window_start).toBeDefined();
    expect(windows[0]?.window_end).toBeDefined();
  });

  test("updates window utilization on subsequent prompt_submit events", async () => {
    await env.writeState({
      ...createInstalledState(7, true),
      current_window_start: null,
      current_window_end: null,
    });

    await runCcmax(["hook", "--event", "prompt_submit"], env.getEnv());
    await Bun.sleep(100);
    await runCcmax(["hook", "--event", "prompt_submit"], env.getEnv());

    const windows = queryWindows(dbPath);
    expect(windows.length).toBe(1);
    expect(windows[0]?.active_minutes).toBeGreaterThanOrEqual(1);
  });

  test("multiple prompt_submit events increment active minutes", async () => {
    await env.writeState({
      ...createInstalledState(7, true),
      current_window_start: null,
      current_window_end: null,
    });

    await runCcmax(["hook", "--event", "prompt_submit"], env.getEnv());
    await Bun.sleep(50);
    await runCcmax(["hook", "--event", "prompt_submit"], env.getEnv());
    await Bun.sleep(50);
    await runCcmax(["hook", "--event", "prompt_submit"], env.getEnv());

    const windows = queryWindows(dbPath);
    expect(windows.length).toBe(1);
    expect(windows[0]?.active_minutes).toBeGreaterThanOrEqual(3);
  });

  test("hook execution is fast (under 500ms)", async () => {
    const start = performance.now();
    await runCcmax(["hook", "--event", "prompt_submit"], env.getEnv());
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
  });

  test("hook handles prompt_submit gracefully", async () => {
    await env.writeState({
      ...createInstalledState(7, true),
      current_window_start: null,
      current_window_end: null,
    });

    const result = await runCcmax(["hook", "--event", "prompt_submit"], env.getEnv());

    expect(result.exitCode).toBe(0);
    expect(queryWindows(dbPath).length).toBe(1);
  });
});
