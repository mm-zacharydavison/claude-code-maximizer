import { handleHookEvent, type EventType } from "../../hook/handler.ts";
import { logDebug, logError } from "../../utils/errors.ts";

export async function hook(args: string[]): Promise<void> {
  logDebug("hook:cli", "Hook command invoked", { args });

  // Parse arguments
  let eventType: EventType | null = null;
  let toolName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--event" && args[i + 1]) {
      const event = args[i + 1];
      if (event === "pre_tool" || event === "post_tool" || event === "prompt_submit") {
        eventType = event;
      }
      i++;
    } else if (arg === "--tool" && args[i + 1]) {
      toolName = args[i + 1];
      i++;
    }
  }

  if (!eventType) {
    logDebug("hook:cli", "No valid event type, exiting", { args });
    // Silent fail - don't interrupt Claude Code
    process.exit(0);
  }

  logDebug("hook:cli", "Parsed event", { eventType, toolName });

  try {
    handleHookEvent(eventType, toolName);
    logDebug("hook:cli", "Hook handler completed successfully");
  } catch (error) {
    logError("hook:cli", error);
    // Silent fail - don't interrupt Claude Code
  }

  process.exit(0);
}
