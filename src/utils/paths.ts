import { homedir } from "os";
import { join } from "path";

// Support custom data directory for testing
const HOME = process.env.HOME || homedir();
export const DATA_DIR = process.env.CCMAX_DATA_DIR || join(HOME, ".claude-code-maximizer");
export const DB_PATH = join(DATA_DIR, "usage.db");
export const CONFIG_PATH = join(DATA_DIR, "config.json");
export const STATE_PATH = join(DATA_DIR, "state.json");

export const BIN_DIR = join(HOME, ".local", "bin");
export const INSTALLED_BINARY_PATH = join(BIN_DIR, "ccmax");

export const CLAUDE_DIR = join(HOME, ".claude");
export const CLAUDE_SETTINGS_PATH = join(CLAUDE_DIR, "settings.json");

export const CACHE_DIR = join(HOME, ".cache");
export const USAGE_CACHE_PATH = join(CACHE_DIR, "claude-usage.json");
