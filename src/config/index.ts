import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { hostname } from "os";
import { CONFIG_PATH } from "../utils/paths.ts";
import { logError, isValidNumber, isValidTimeString } from "../utils/errors.ts";

export interface OptimalStartTimes {
  monday: string | null;
  tuesday: string | null;
  wednesday: string | null;
  thursday: string | null;
  friday: string | null;
  saturday: string | null;
  sunday: string | null;
}

export type DayOfWeek = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export interface WorkingHoursDay {
  start: string; // HH:MM format
  end: string;   // HH:MM format
}

export interface WorkingHoursConfig {
  enabled: boolean;
  work_days: DayOfWeek[];
  hours: Partial<Record<DayOfWeek, WorkingHoursDay>>;
  auto_adjust_from_usage: boolean; // blend with usage data analysis
}

export interface SyncConfig {
  gist_id: string | null;
  last_sync: string | null;
  last_sync_hash: string | null;
  machine_id: string | null;
}

export interface Config {
  learning_period_days: number;
  notifications_enabled: boolean;
  optimal_start_times: OptimalStartTimes;
  notification_advance_minutes: number;
  auto_adjust_enabled: boolean;
  sync: SyncConfig;
  working_hours: WorkingHoursConfig;
}

const DEFAULT_CONFIG: Config = {
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

/**
 * Validates and sanitizes config values
 */
function sanitizeConfig(parsed: Partial<Config>): Partial<Config> {
  const sanitized: Partial<Config> = {};

  // Validate learning_period_days
  if (isValidNumber(parsed.learning_period_days) && parsed.learning_period_days > 0 && parsed.learning_period_days <= 365) {
    sanitized.learning_period_days = parsed.learning_period_days;
  }

  // Validate notifications_enabled
  if (typeof parsed.notifications_enabled === "boolean") {
    sanitized.notifications_enabled = parsed.notifications_enabled;
  }

  // Validate notification_advance_minutes
  if (isValidNumber(parsed.notification_advance_minutes) && parsed.notification_advance_minutes >= 0 && parsed.notification_advance_minutes <= 60) {
    sanitized.notification_advance_minutes = parsed.notification_advance_minutes;
  }

  // Validate auto_adjust_enabled
  if (typeof parsed.auto_adjust_enabled === "boolean") {
    sanitized.auto_adjust_enabled = parsed.auto_adjust_enabled;
  }

  // Validate optimal_start_times
  if (parsed.optimal_start_times && typeof parsed.optimal_start_times === "object") {
    const times: Partial<OptimalStartTimes> = {};
    const days: (keyof OptimalStartTimes)[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

    for (const day of days) {
      const value = parsed.optimal_start_times[day];
      if (value === null || isValidTimeString(value)) {
        times[day] = value;
      }
    }

    if (Object.keys(times).length > 0) {
      sanitized.optimal_start_times = { ...DEFAULT_CONFIG.optimal_start_times, ...times };
    }
  }

  // Validate sync config
  if (parsed.sync && typeof parsed.sync === "object") {
    const sync: Partial<SyncConfig> = {};
    if (parsed.sync.gist_id === null || typeof parsed.sync.gist_id === "string") {
      sync.gist_id = parsed.sync.gist_id;
    }
    if (parsed.sync.last_sync === null || typeof parsed.sync.last_sync === "string") {
      sync.last_sync = parsed.sync.last_sync;
    }
    if (parsed.sync.last_sync_hash === null || typeof parsed.sync.last_sync_hash === "string") {
      sync.last_sync_hash = parsed.sync.last_sync_hash;
    }
    if (parsed.sync.machine_id === null || typeof parsed.sync.machine_id === "string") {
      sync.machine_id = parsed.sync.machine_id;
    }
    sanitized.sync = { ...DEFAULT_CONFIG.sync, ...sync };
  }

  // Validate working_hours config
  if (parsed.working_hours && typeof parsed.working_hours === "object") {
    const validDays: DayOfWeek[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const workingHours: WorkingHoursConfig = { ...DEFAULT_CONFIG.working_hours };

    if (typeof parsed.working_hours.enabled === "boolean") {
      workingHours.enabled = parsed.working_hours.enabled;
    }

    if (typeof parsed.working_hours.auto_adjust_from_usage === "boolean") {
      workingHours.auto_adjust_from_usage = parsed.working_hours.auto_adjust_from_usage;
    }

    if (Array.isArray(parsed.working_hours.work_days)) {
      const validWorkDays = parsed.working_hours.work_days.filter(
        (d): d is DayOfWeek => validDays.includes(d as DayOfWeek)
      );
      if (validWorkDays.length > 0) {
        workingHours.work_days = validWorkDays;
      }
    }

    if (parsed.working_hours.hours && typeof parsed.working_hours.hours === "object") {
      const hours: Partial<Record<DayOfWeek, WorkingHoursDay>> = {};
      for (const day of validDays) {
        const dayHours = parsed.working_hours.hours[day];
        if (dayHours && typeof dayHours === "object") {
          if (isValidTimeString(dayHours.start) && isValidTimeString(dayHours.end)) {
            hours[day] = { start: dayHours.start, end: dayHours.end };
          }
        }
      }
      workingHours.hours = hours;
    }

    sanitized.working_hours = workingHours;
  }

  return sanitized;
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(content) as Partial<Config>;
    const sanitized = sanitizeConfig(parsed);
    return { ...DEFAULT_CONFIG, ...sanitized };
  } catch (error) {
    logError("config:load", error);
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: Config): void {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export function updateConfig(updates: Partial<Config>): Config {
  const current = loadConfig();
  const updated = { ...current, ...updates };
  saveConfig(updated);
  return updated;
}

export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}

export function setOptimalStartTime(
  day: keyof OptimalStartTimes,
  time: string | null
): void {
  const config = loadConfig();
  config.optimal_start_times[day] = time;
  saveConfig(config);
}

export function getOptimalStartTime(day: keyof OptimalStartTimes): string | null {
  const config = loadConfig();
  return config.optimal_start_times[day];
}

export function getSyncConfig(): SyncConfig {
  const config = loadConfig();
  return config.sync;
}

export function updateSyncConfig(updates: Partial<SyncConfig>): void {
  const config = loadConfig();
  config.sync = { ...config.sync, ...updates };
  saveConfig(config);
}

export function isSyncConfigured(): boolean {
  const config = loadConfig();
  return config.sync.gist_id !== null;
}

export function getWorkingHoursConfig(): WorkingHoursConfig {
  const config = loadConfig();
  return config.working_hours;
}

export function updateWorkingHoursConfig(updates: Partial<WorkingHoursConfig>): void {
  const config = loadConfig();
  config.working_hours = { ...config.working_hours, ...updates };
  saveConfig(config);
}

export function isWorkingHoursConfigured(): boolean {
  const config = loadConfig();
  return config.working_hours.enabled && config.working_hours.work_days.length > 0;
}

export const ALL_DAYS: DayOfWeek[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export const DAY_LABELS: Record<DayOfWeek, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

/**
 * Gets or generates machine ID for identifying this machine's data.
 */
export function getMachineId(): string {
  const config = getSyncConfig();
  if (config.machine_id) {
    return config.machine_id;
  }

  // Generate a new machine ID based on hostname + random suffix
  const machineId = `${hostname()}-${Math.random().toString(36).substring(2, 8)}`;
  updateSyncConfig({ machine_id: machineId });
  return machineId;
}
