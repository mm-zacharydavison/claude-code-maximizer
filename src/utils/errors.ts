/**
 * Error handling utilities for ccmax
 *
 * Key principle: Hook operations should NEVER fail visibly or slow down Claude Code.
 * All errors in hook context should be silently logged and swallowed.
 */

import { existsSync, appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { DATA_DIR } from "./paths.ts";

const ERROR_LOG_PATH = join(DATA_DIR, "error.log");
const DEBUG_LOG_PATH = join(DATA_DIR, "debug.log");
const MAX_LOG_SIZE_BYTES = 1024 * 1024; // 1MB

/**
 * Logs an error to the error log file
 */
export function logError(context: string, error: unknown): void {
  try {
    const dir = dirname(ERROR_LOG_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const timestamp = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    const entry = `[${timestamp}] ${context}: ${errorMessage}${stack ? `\n${stack}` : ""}\n`;

    // Rotate log if too large
    if (existsSync(ERROR_LOG_PATH)) {
      const stats = Bun.file(ERROR_LOG_PATH).size;
      if (stats > MAX_LOG_SIZE_BYTES) {
        // Truncate by renaming to .old
        const oldPath = ERROR_LOG_PATH + ".old";
        Bun.write(oldPath, Bun.file(ERROR_LOG_PATH));
        Bun.write(ERROR_LOG_PATH, entry);
        return;
      }
    }

    appendFileSync(ERROR_LOG_PATH, entry);
  } catch {
    // If we can't log errors, silently ignore
  }
}

/**
 * Logs a debug message to the debug log file.
 * Used for diagnosing hook behavior.
 */
export function logDebug(context: string, message: string, data?: Record<string, unknown>): void {
  try {
    const dir = dirname(DEBUG_LOG_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    const entry = `[${timestamp}] ${context}: ${message}${dataStr}\n`;

    // Rotate log if too large
    if (existsSync(DEBUG_LOG_PATH)) {
      const stats = Bun.file(DEBUG_LOG_PATH).size;
      if (stats > MAX_LOG_SIZE_BYTES) {
        const oldPath = DEBUG_LOG_PATH + ".old";
        Bun.write(oldPath, Bun.file(DEBUG_LOG_PATH));
        Bun.write(DEBUG_LOG_PATH, entry);
        return;
      }
    }

    appendFileSync(DEBUG_LOG_PATH, entry);
  } catch {
    // Silently ignore
  }
}

/**
 * Wraps a function to catch and log errors without throwing
 * Use for hook operations that must never fail
 */
export function safeExecute<T>(
  context: string,
  fn: () => T,
  fallback?: T
): T | undefined {
  try {
    return fn();
  } catch (error) {
    logError(context, error);
    return fallback;
  }
}

/**
 * Async version of safeExecute
 */
export async function safeExecuteAsync<T>(
  context: string,
  fn: () => Promise<T>,
  fallback?: T
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    logError(context, error);
    return fallback;
  }
}

/**
 * Validates that a value is a valid non-negative number
 */
export function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && !isNaN(value) && isFinite(value);
}

/**
 * Validates that a value is a valid ISO timestamp string
 */
export function isValidTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !isNaN(date.getTime());
}

/**
 * Validates time string format "HH:MM"
 */
export function isValidTimeString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

/**
 * Safely parses JSON with fallback
 */
export function safeParseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
