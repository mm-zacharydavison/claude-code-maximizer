import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { CLAUDE_SETTINGS_PATH, CLAUDE_DIR, INSTALLED_BINARY_PATH } from "../utils/paths.ts";

// New hook format with matcher
interface HookEntry {
  type: string;
  command: string;
}

interface MatcherHookConfig {
  matcher: string | { tools?: string[] };
  hooks: HookEntry[];
}

interface ClaudeSettings {
  hooks?: {
    PreToolUse?: MatcherHookConfig[];
    PostToolUse?: MatcherHookConfig[];
    UserPromptSubmit?: MatcherHookConfig[];
    [key: string]: MatcherHookConfig[] | undefined;
  };
  [key: string]: unknown;
}

const HOOK_MARKER = "ccmax";

function getHookCommand(event: string): string {
  return `${INSTALLED_BINARY_PATH} hook --event ${event}`;
}

function hookConfigContainsMarker(config: MatcherHookConfig): boolean {
  return config.hooks?.some((h) => h.command?.includes(HOOK_MARKER)) ?? false;
}

function createHookConfig(event: string): MatcherHookConfig {
  return {
    matcher: ".*",  // Match all tools
    hooks: [
      {
        type: "command",
        command: getHookCommand(event),
      },
    ],
  };
}


export function isHookInstalled(): boolean {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) {
    return false;
  }

  try {
    const content = readFileSync(CLAUDE_SETTINGS_PATH, "utf-8");
    const settings = JSON.parse(content) as ClaudeSettings;

    const preToolHooks = settings.hooks?.PreToolUse ?? [];
    return preToolHooks.some(hookConfigContainsMarker);
  } catch {
    return false;
  }
}

export function installHook(): { success: boolean; error?: string } {
  try {
    // Ensure .claude directory exists
    if (!existsSync(CLAUDE_DIR)) {
      mkdirSync(CLAUDE_DIR, { recursive: true });
    }

    // Load or create settings
    let settings: ClaudeSettings = {};
    if (existsSync(CLAUDE_SETTINGS_PATH)) {
      const content = readFileSync(CLAUDE_SETTINGS_PATH, "utf-8");
      settings = JSON.parse(content) as ClaudeSettings;
    }

    // Ensure hooks object exists
    if (!settings.hooks) {
      settings.hooks = {};
    }

    // Add PreToolUse hook
    if (!settings.hooks.PreToolUse) {
      settings.hooks.PreToolUse = [];
    }

    // Check if already installed
    if (!settings.hooks.PreToolUse.some(hookConfigContainsMarker)) {
      settings.hooks.PreToolUse.push(createHookConfig("pre_tool"));
    }

    // Add PostToolUse hook
    if (!settings.hooks.PostToolUse) {
      settings.hooks.PostToolUse = [];
    }

    if (!settings.hooks.PostToolUse.some(hookConfigContainsMarker)) {
      settings.hooks.PostToolUse.push(createHookConfig("post_tool"));
    }

    // Add UserPromptSubmit hook
    if (!settings.hooks.UserPromptSubmit) {
      settings.hooks.UserPromptSubmit = [];
    }

    if (!settings.hooks.UserPromptSubmit.some(hookConfigContainsMarker)) {
      settings.hooks.UserPromptSubmit.push(createHookConfig("prompt_submit"));
    }

    // Write back
    writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

function containsMarker(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;

  const obj = item as Record<string, unknown>;

  // Check new format with hooks array
  if (Array.isArray(obj.hooks)) {
    return obj.hooks.some((h: unknown) => {
      if (h && typeof h === "object" && "command" in h) {
        return String((h as Record<string, unknown>).command).includes(HOOK_MARKER);
      }
      return false;
    });
  }

  // Check old format with direct command
  if ("command" in obj && typeof obj.command === "string") {
    return obj.command.includes(HOOK_MARKER);
  }

  return false;
}

export function uninstallHook(): { success: boolean; error?: string } {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) {
    return { success: true }; // Nothing to uninstall
  }

  try {
    const content = readFileSync(CLAUDE_SETTINGS_PATH, "utf-8");
    const settings = JSON.parse(content) as ClaudeSettings;

    if (settings.hooks) {
      // Remove our hooks from PreToolUse (handles both old and new formats)
      if (settings.hooks.PreToolUse) {
        settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(
          (h) => !containsMarker(h)
        ) as MatcherHookConfig[];
        if (settings.hooks.PreToolUse.length === 0) {
          delete settings.hooks.PreToolUse;
        }
      }

      // Remove our hooks from PostToolUse (handles both old and new formats)
      if (settings.hooks.PostToolUse) {
        settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
          (h) => !containsMarker(h)
        ) as MatcherHookConfig[];
        if (settings.hooks.PostToolUse.length === 0) {
          delete settings.hooks.PostToolUse;
        }
      }

      // Remove our hooks from UserPromptSubmit
      if (settings.hooks.UserPromptSubmit) {
        settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
          (h) => !containsMarker(h)
        ) as MatcherHookConfig[];
        if (settings.hooks.UserPromptSubmit.length === 0) {
          delete settings.hooks.UserPromptSubmit;
        }
      }

      // Remove hooks object if empty
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }
    }

    writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
