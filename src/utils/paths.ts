import { homedir } from "os";
import { join } from "path";
import { isMacOS } from "./platform.ts";

// Support custom data directory for testing
const HOME = process.env.HOME || homedir();
export const DATA_DIR = process.env.CCMAX_DATA_DIR || join(HOME, ".claude-code-maximizer");
export const DB_PATH = join(DATA_DIR, "usage.db");
export const CONFIG_PATH = join(DATA_DIR, "config.json");
export const STATE_PATH = join(DATA_DIR, "state.json");

// Binary installation path (user-writable, same on all platforms)
export const BIN_DIR = join(HOME, ".local", "bin");
export const INSTALLED_BINARY_PATH = join(BIN_DIR, "ccmax");

// Claude Code paths (same on all platforms)
export const CLAUDE_DIR = join(HOME, ".claude");
export const CLAUDE_SETTINGS_PATH = join(CLAUDE_DIR, "settings.json");

// Platform-specific cache directory
export const CACHE_DIR = isMacOS()
  ? join(HOME, "Library", "Caches", "ccmax")
  : join(HOME, ".cache");
export const USAGE_CACHE_PATH = join(CACHE_DIR, "claude-usage.json");

// Platform-specific log directory
export const LOG_DIR = isMacOS()
  ? join(HOME, "Library", "Logs", "ccmax")
  : join(HOME, ".local", "share", "ccmax");
export const DAEMON_LOG_PATH = join(LOG_DIR, "daemon.log");

// Platform-specific service paths
export const LAUNCHD_AGENTS_DIR = join(HOME, "Library", "LaunchAgents");
export const LAUNCHD_PLIST_PATH = join(LAUNCHD_AGENTS_DIR, "com.ccmax.daemon.plist");
export const SYSTEMD_USER_DIR = join(HOME, ".config", "systemd", "user");
export const SYSTEMD_SERVICE_PATH = join(SYSTEMD_USER_DIR, "ccmax.service");
