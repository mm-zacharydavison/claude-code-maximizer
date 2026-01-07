import { checkbox, confirm, input } from "@inquirer/prompts";
import {
  loadConfig,
  saveConfig,
  ALL_DAYS,
  DAY_LABELS,
  type DayOfWeek,
  type WorkingHoursDay,
  type WorkingHoursConfig,
} from "../../config/index.ts";
import { isInstalled } from "../../config/state.ts";
import { isValidTimeString } from "../../utils/errors.ts";
import { calculateOptimalStartTimes } from "../../utils/time.ts";

const DEFAULT_START = "09:00";
const DEFAULT_END = "17:00";
const DEFAULT_WORK_DAYS: DayOfWeek[] = ["monday", "tuesday", "wednesday", "thursday", "friday"];

function formatDayList(days: DayOfWeek[]): string {
  return days.map((d) => DAY_LABELS[d]).join(", ");
}

function parseTime(input: string, defaultTime: string): string {
  const trimmed = input.trim();
  if (trimmed === "") {
    return defaultTime;
  }

  // Allow formats: "9", "9:00", "09:00", "9:30"
  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (match && match[1]) {
    const hours = match[1].padStart(2, "0");
    const minutes = match[2] ?? "00";
    const time = `${hours}:${minutes}`;
    if (isValidTimeString(time)) {
      return time;
    }
  }

  console.log(`Invalid time format, using ${defaultTime}.`);
  return defaultTime;
}

async function selectWorkDays(currentDays: DayOfWeek[]): Promise<DayOfWeek[]> {
  const choices = ALL_DAYS.map((day) => ({
    name: DAY_LABELS[day],
    value: day,
    checked: currentDays.includes(day),
  }));

  const selected = await checkbox({
    message: "Which days do you work?",
    choices,
    loop: false,
  });

  if (selected.length === 0) {
    console.log("No days selected, using default (Mon-Fri).");
    return DEFAULT_WORK_DAYS;
  }

  return selected;
}

async function selectWorkingHours(
  workDays: DayOfWeek[],
  currentHours: Partial<Record<DayOfWeek, WorkingHoursDay>>
): Promise<Partial<Record<DayOfWeek, WorkingHoursDay>>> {
  const useSameHours = await confirm({
    message: "Use the same hours for all work days?",
    default: true,
  });

  const hours: Partial<Record<DayOfWeek, WorkingHoursDay>> = {};

  if (useSameHours) {
    // Get default from first work day if available
    const firstDay = workDays[0];
    const existingStart = (firstDay && currentHours[firstDay]?.start) || DEFAULT_START;
    const existingEnd = (firstDay && currentHours[firstDay]?.end) || DEFAULT_END;

    const startInput = await input({
      message: "Start time (24h format)",
      default: existingStart,
    });
    const start = parseTime(startInput, existingStart);

    const endInput = await input({
      message: "End time (24h format)",
      default: existingEnd,
    });
    const end = parseTime(endInput, existingEnd);

    for (const day of workDays) {
      hours[day] = { start, end };
    }
  } else {
    console.log("\nEnter times for each day (24h format, e.g., 9:00 or 09:00):\n");

    for (const day of workDays) {
      const existingStart = currentHours[day]?.start || DEFAULT_START;
      const existingEnd = currentHours[day]?.end || DEFAULT_END;

      console.log(`${DAY_LABELS[day]}:`);

      const startInput = await input({
        message: "  Start",
        default: existingStart,
      });
      const start = parseTime(startInput, existingStart);

      const endInput = await input({
        message: "  End",
        default: existingEnd,
      });
      const end = parseTime(endInput, existingEnd);

      hours[day] = { start, end };
    }
  }

  return hours;
}

async function selectAutoAdjust(currentValue: boolean): Promise<boolean> {
  return await confirm({
    message: "Auto-adjust based on usage data? (blends configured hours with actual usage patterns)",
    default: currentValue,
  });
}

function applyWorkingHoursToOptimalTimes(config: ReturnType<typeof loadConfig>): void {
  const { working_hours } = config;

  if (!working_hours.enabled) {
    return;
  }

  // Set optimal_start_times based on calculated optimal window times
  for (const day of ALL_DAYS) {
    if (working_hours.work_days.includes(day)) {
      const dayHours = working_hours.hours[day];
      if (dayHours) {
        // Calculate all optimal start times and use the first one
        const optimalTimes = calculateOptimalStartTimes(dayHours.start, dayHours.end);
        config.optimal_start_times[day] = optimalTimes[0] ?? dayHours.start;
      }
    } else {
      // Non-work days: clear optimal time
      config.optimal_start_times[day] = null;
    }
  }
}

function showCurrentConfig(workingHours: WorkingHoursConfig): void {
  console.log("\nCurrent working hours configuration:");

  if (!workingHours.enabled) {
    console.log("  Not configured (using automatic detection)");
    return;
  }

  console.log(`  Work days: ${formatDayList(workingHours.work_days)}`);
  console.log("  Hours:");
  for (const day of workingHours.work_days) {
    const hours = workingHours.hours[day];
    if (hours) {
      console.log(`    ${DAY_LABELS[day]}: ${hours.start} - ${hours.end}`);
    }
  }
  console.log(`  Auto-adjust from usage: ${workingHours.auto_adjust_from_usage ? "Yes" : "No"}`);
}

async function runInteractiveConfig(): Promise<void> {
  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║     Configure Working Hours                   ║");
  console.log("╚═══════════════════════════════════════════════╝");
  console.log();

  const config = loadConfig();
  const currentWorkingHours = config.working_hours;

  // Show current config if already configured
  if (currentWorkingHours.enabled) {
    showCurrentConfig(currentWorkingHours);
    console.log();
    const reconfigure = await confirm({
      message: "Reconfigure?",
      default: true,
    });
    if (!reconfigure) {
      console.log("Configuration unchanged.");
      return;
    }
  }

  // Select work days
  const workDays = await selectWorkDays(currentWorkingHours.work_days);
  console.log(`\nSelected: ${formatDayList(workDays)}\n`);

  // Select working hours
  const hours = await selectWorkingHours(workDays, currentWorkingHours.hours);

  // Select auto-adjust preference
  const autoAdjust = await selectAutoAdjust(currentWorkingHours.auto_adjust_from_usage);

  // Update config
  config.working_hours = {
    enabled: true,
    work_days: workDays,
    hours,
    auto_adjust_from_usage: autoAdjust,
  };

  // Apply to optimal_start_times
  applyWorkingHoursToOptimalTimes(config);

  saveConfig(config);

  console.log();
  console.log("═══════════════════════════════════════════════");
  console.log("Configuration saved!");
  console.log("═══════════════════════════════════════════════");
  showCurrentConfig(config.working_hours);

  if (!autoAdjust) {
    console.log("\n  Notifications will be based on your configured hours.");
  } else {
    console.log("\n  Your hours will be blended with usage patterns after the learning period.");
  }
  console.log();
}

function showHelp(): void {
  console.log(`
ccmax configure - Configure working hours

USAGE:
  ccmax configure           Interactive configuration wizard
  ccmax configure show      Show current configuration
  ccmax configure reset     Reset to automatic detection

EXAMPLES:
  ccmax configure           Set up your work schedule interactively
  ccmax configure show      View your configured hours
  ccmax configure reset     Clear manual config, use auto-detection
`);
}

export async function configure(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "--help" || subcommand === "-h") {
    showHelp();
    return;
  }

  if (!isInstalled()) {
    console.error("ccmax is not installed. Run 'ccmax install' first.");
    process.exit(1);
  }

  if (subcommand === "show") {
    const config = loadConfig();
    showCurrentConfig(config.working_hours);
    return;
  }

  if (subcommand === "reset") {
    const config = loadConfig();
    config.working_hours = {
      enabled: false,
      work_days: DEFAULT_WORK_DAYS,
      hours: {},
      auto_adjust_from_usage: true,
    };
    saveConfig(config);
    console.log("Working hours configuration reset.");
    console.log("ccmax will use automatic detection based on usage patterns.");
    return;
  }

  if (subcommand && subcommand !== "") {
    console.error(`Unknown subcommand: ${subcommand}`);
    showHelp();
    process.exit(1);
  }

  await runInteractiveConfig();
}
