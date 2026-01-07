#!/usr/bin/env bun

import { install } from "./commands/install.ts";
import { uninstall } from "./commands/uninstall.ts";
import { status } from "./commands/status.ts";
import { hook } from "./commands/hook.ts";
import { stats } from "./commands/stats.ts";
import { analyze } from "./commands/analyze.ts";
import { adjust } from "./commands/adjust.ts";
import { daemon } from "./commands/daemon.ts";
import { config } from "./commands/config.ts";
import { configure } from "./commands/configure.ts";
import { exportData } from "./commands/export.ts";
import { usage } from "./commands/usage.ts";
import { sync } from "./commands/sync.ts";
import { clear } from "./commands/clear.ts";

const HELP = `
ccmax - Claude Code Max Window Maximizer

USAGE:
  ccmax <command> [options]

COMMANDS:
  install       Install the Claude Code hook and set up tracking
  uninstall     Remove the hook and optionally delete data
  configure     Configure working hours interactively
  status        Show tracking status and learning progress
  usage         Show Claude rate limit usage (--refresh to update)
  stats         Show usage statistics with ASCII graph
  analyze       Analyze usage patterns and show recommendations
  adjust        Adaptively adjust optimal times based on recent patterns
  daemon        Manage the background notification daemon
  config        View and modify configuration
  export        Export usage data to JSON or CSV
  sync          Sync data across machines via GitHub Gist
  clear         Clear usage data (--all to include config)
  hook          Internal: Handle hook events (used by Claude Code)
  help          Show this help message

OPTIONS:
  --help, -h    Show help for a command

EXAMPLES:
  ccmax install            Set up ccmax with interactive onboarding
  ccmax status             Check tracking progress
  ccmax stats              View usage graph and impact metrics
  ccmax analyze --save     Analyze patterns and save recommendations
  ccmax adjust --status    Check adaptive adjustment status
  ccmax uninstall --purge  Remove hooks and delete all data
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    console.log(HELP);
    process.exit(0);
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case "install":
      await install(commandArgs);
      break;

    case "uninstall":
      await uninstall(commandArgs);
      break;

    case "status":
      await status(commandArgs);
      break;

    case "usage":
      await usage(commandArgs);
      break;

    case "stats":
      await stats(commandArgs);
      break;

    case "analyze":
      await analyze(commandArgs);
      break;

    case "adjust":
      await adjust(commandArgs);
      break;

    case "daemon":
      await daemon(commandArgs);
      break;

    case "config":
      await config(commandArgs);
      break;

    case "configure":
      await configure(commandArgs);
      break;

    case "export":
      await exportData(commandArgs);
      break;

    case "hook":
      await hook(commandArgs);
      break;

    case "sync":
      await sync(commandArgs);
      break;

    case "clear":
      await clear(commandArgs);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.log("Run 'ccmax help' for usage information.");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
