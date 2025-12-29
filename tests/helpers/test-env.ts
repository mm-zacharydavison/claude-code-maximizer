import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestEnv {
  testDir: string;
  dataDir: string;
  claudeDir: string;
  cleanup: () => Promise<void>;
  getEnv: () => Record<string, string>;
  writeConfig: (config: object) => Promise<void>;
  writeState: (state: object) => Promise<void>;
  writeClaudeSettings: (settings: object) => Promise<void>;
  readConfig: () => Promise<object>;
  readState: () => Promise<object>;
  readClaudeSettings: () => Promise<object>;
}

/**
 * Creates an isolated test environment with its own data directory
 */
export async function createTestEnv(): Promise<TestEnv> {
  const testDir = await mkdtemp(join(tmpdir(), "ccmax-test-"));
  const dataDir = join(testDir, ".claude-code-maximizer");
  const claudeDir = join(testDir, ".claude");

  // Create directories
  await mkdir(dataDir, { recursive: true });
  await mkdir(claudeDir, { recursive: true });

  const cleanup = async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  };

  const getEnv = () => ({
    HOME: testDir,
    CCMAX_DATA_DIR: dataDir,
    CCMAX_TEST_MODE: "1",
  });

  const writeConfig = async (config: object) => {
    await writeFile(join(dataDir, "config.json"), JSON.stringify(config, null, 2));
  };

  const writeState = async (state: object) => {
    await writeFile(join(dataDir, "state.json"), JSON.stringify(state, null, 2));
  };

  const writeClaudeSettings = async (settings: object) => {
    await writeFile(join(claudeDir, "settings.json"), JSON.stringify(settings, null, 2));
  };

  const readConfig = async () => {
    const path = join(dataDir, "config.json");
    if (!existsSync(path)) return {};
    return JSON.parse(await Bun.file(path).text());
  };

  const readState = async () => {
    const path = join(dataDir, "state.json");
    if (!existsSync(path)) return {};
    return JSON.parse(await Bun.file(path).text());
  };

  const readClaudeSettings = async () => {
    const path = join(claudeDir, "settings.json");
    if (!existsSync(path)) return {};
    return JSON.parse(await Bun.file(path).text());
  };

  return {
    testDir,
    dataDir,
    claudeDir,
    cleanup,
    getEnv,
    writeConfig,
    writeState,
    writeClaudeSettings,
    readConfig,
    readState,
    readClaudeSettings,
  };
}

/**
 * Default config for testing
 */
export const DEFAULT_TEST_CONFIG = {
  learning_period_days: 7,
  notifications_enabled: true,
  optimal_start_times: {
    monday: null,
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
    saturday: null,
    sunday: null,
  },
  notification_advance_minutes: 5,
  auto_adjust_enabled: true,
  sync: {
    gist_id: null,
    last_sync: null,
    last_sync_hash: null,
    machine_id: null,
  },
};

/**
 * Default state for testing (installed state)
 */
export function createInstalledState(daysAgo: number = 7, learningComplete: boolean = false) {
  return {
    installed_at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    learning_complete: learningComplete,
    current_window_start: null,
    current_window_end: null,
    daemon_pid: null,
  };
}
