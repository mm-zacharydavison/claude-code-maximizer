import { getClaudeUsage, getCachedUsage, formatUsage } from "../../usage/index.ts";

export async function usage(args: string[]): Promise<void> {
  const isRefresh = args.includes("--refresh") || args.includes("-r");
  const isJson = args.includes("--json") || args.includes("-j");
  const isHelp = args.includes("--help") || args.includes("-h");

  if (isHelp) {
    console.log(`
Usage: ccmax usage [options]

Show Claude rate limit usage information.

Options:
  --refresh, -r   Force refresh from Claude (slow, spawns Claude)
  --json, -j      Output as JSON
  --help, -h      Show this help

Without --refresh, shows cached data if available.
Cache is updated when you run with --refresh.
`);
    return;
  }

  let usageData;

  if (isRefresh) {
    console.log("Fetching usage data from Claude...");
    usageData = await getClaudeUsage({ refresh: true });
    if (!usageData) {
      console.error("Failed to get usage data from Claude.");
      process.exit(1);
    }
  } else {
    // Try cache first
    usageData = getCachedUsage();
    if (!usageData) {
      console.log("No cached data. Fetching from Claude...");
      usageData = await getClaudeUsage({ refresh: true });
      if (!usageData) {
        console.error("Failed to get usage data from Claude.");
        process.exit(1);
      }
    }
  }

  if (isJson) {
    console.log(JSON.stringify({
      session: usageData.session,
      week_all_models: usageData.week_all_models,
      week_sonnet: usageData.week_sonnet,
      cached: usageData.cached,
      cache_age: usageData.cache_age,
    }, null, 2));
  } else {
    console.log();
    console.log("Claude Rate Limits:");
    console.log(formatUsage(usageData));
    console.log();
  }
}
