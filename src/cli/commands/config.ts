import { loadConfig, saveConfig, type Config, type OptimalStartTimes } from "../../config/index.ts";
import { isInstalled } from "../../config/state.ts";
import { CONFIG_PATH } from "../../utils/paths.ts";

export async function config(args: string[]): Promise<void> {
  if (!isInstalled()) {
    console.log("ccmax is not installed. Run 'ccmax install' first.");
    return;
  }

  const subcommand = args[0];

  switch (subcommand) {
    case "show":
    case undefined:
      showConfig();
      break;

    case "set":
      setConfigValue(args[1], args[2]);
      break;

    case "reset":
      resetConfig();
      break;

    case "path":
      console.log(CONFIG_PATH);
      break;

    default:
      showConfigHelp();
  }
}

function showConfig(): void {
  const cfg = loadConfig();

  console.log();
  console.log("ccmax Configuration");
  console.log("═".repeat(50));
  console.log();
  console.log("General:");
  console.log(`  learning_period_days:        ${cfg.learning_period_days}`);
  console.log(`  notifications_enabled:       ${cfg.notifications_enabled}`);
  console.log(`  auto_adjust_enabled:         ${cfg.auto_adjust_enabled}`);
  console.log(`  notification_advance_minutes: ${cfg.notification_advance_minutes}`);
  console.log();
  console.log("Optimal Start Times:");

  const days: (keyof OptimalStartTimes)[] = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];

  for (const day of days) {
    const time = cfg.optimal_start_times[day];
    console.log(`  ${day.padEnd(12)} ${time ?? "(not set)"}`);
  }

  console.log();
  console.log(`Config file: ${CONFIG_PATH}`);
  console.log();
}

function setConfigValue(key: string | undefined, value: string | undefined): void {
  if (!key || !value) {
    console.log("Usage: ccmax config set <key> <value>");
    console.log();
    console.log("Available keys:");
    console.log("  learning_period_days        Number of days (e.g., 7)");
    console.log("  notifications_enabled       true or false");
    console.log("  auto_adjust_enabled         true or false");
    console.log("  notification_advance_minutes Number of minutes (e.g., 5)");
    console.log("  optimal.<day>               Time in HH:MM format (e.g., 09:00)");
    return;
  }

  const cfg = loadConfig();

  if (key.startsWith("optimal.")) {
    const day = key.replace("optimal.", "") as keyof OptimalStartTimes;
    const validDays: (keyof OptimalStartTimes)[] = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];

    if (!validDays.includes(day)) {
      console.log(`Invalid day: ${day}`);
      return;
    }

    if (value === "null" || value === "none") {
      cfg.optimal_start_times[day] = null;
    } else if (/^\d{2}:\d{2}$/.test(value)) {
      cfg.optimal_start_times[day] = value;
    } else {
      console.log("Time must be in HH:MM format (e.g., 09:00)");
      return;
    }
  } else {
    switch (key) {
      case "learning_period_days":
        cfg.learning_period_days = parseInt(value, 10);
        break;
      case "notifications_enabled":
        cfg.notifications_enabled = value === "true";
        break;
      case "auto_adjust_enabled":
        cfg.auto_adjust_enabled = value === "true";
        break;
      case "notification_advance_minutes":
        cfg.notification_advance_minutes = parseInt(value, 10);
        break;
      default:
        console.log(`Unknown key: ${key}`);
        return;
    }
  }

  saveConfig(cfg);
  console.log(`Set ${key} = ${value}`);
}

function resetConfig(): void {
  const defaultConfig: Config = {
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
    working_hours: {
      enabled: false,
      work_days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      hours: {},
      auto_adjust_from_usage: true,
    },
  };

  saveConfig(defaultConfig);
  console.log("Configuration reset to defaults.");
}

function showConfigHelp(): void {
  console.log(`
ccmax config - View and modify configuration

USAGE:
  ccmax config [subcommand]

SUBCOMMANDS:
  show              Show current configuration (default)
  set <key> <value> Set a configuration value
  reset             Reset configuration to defaults
  path              Show path to config file

EXAMPLES:
  ccmax config                          Show all settings
  ccmax config set notifications_enabled false
  ccmax config set optimal.monday 09:00
  ccmax config set optimal.saturday null
  ccmax config reset
`);
}
