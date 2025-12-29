import { Database } from "bun:sqlite";
import { mkdirSync, existsSync, unlinkSync } from "fs";
import { dirname } from "path";
import { DB_PATH } from "../utils/paths.ts";
import { initializeSchema } from "./schema.ts";
import { logError } from "../utils/errors.ts";

let dbInstance: Database | null = null;

export function getDb(): Database {
  if (dbInstance) {
    return dbInstance;
  }

  // Ensure directory exists
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch (error) {
      logError("db:mkdirSync", error);
      throw new Error(`Failed to create database directory: ${dir}`);
    }
  }

  try {
    dbInstance = new Database(DB_PATH);
    dbInstance.exec("PRAGMA journal_mode = WAL");
    dbInstance.exec("PRAGMA synchronous = NORMAL");

    initializeSchema(dbInstance);
  } catch (error) {
    logError("db:open", error);

    // If database is corrupted, try to recover by deleting and recreating
    if (error instanceof Error && error.message.includes("corrupt")) {
      try {
        if (existsSync(DB_PATH)) {
          unlinkSync(DB_PATH);
        }
        // Also remove WAL and SHM files if they exist
        if (existsSync(DB_PATH + "-wal")) {
          unlinkSync(DB_PATH + "-wal");
        }
        if (existsSync(DB_PATH + "-shm")) {
          unlinkSync(DB_PATH + "-shm");
        }

        dbInstance = new Database(DB_PATH);
        dbInstance.exec("PRAGMA journal_mode = WAL");
        dbInstance.exec("PRAGMA synchronous = NORMAL");
        initializeSchema(dbInstance);

        logError("db:recover", new Error("Database was corrupted and has been recreated"));
      } catch (recoveryError) {
        logError("db:recover:failed", recoveryError);
        throw new Error("Database is corrupted and recovery failed");
      }
    } else {
      throw error;
    }
  }

  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (error) {
      logError("db:close", error);
    }
    dbInstance = null;
  }
}

export function dbExists(): boolean {
  return existsSync(DB_PATH);
}

/**
 * Safely runs a database operation, returning undefined on failure
 */
export function safeDbQuery<T>(operation: () => T): T | undefined {
  try {
    return operation();
  } catch (error) {
    logError("db:query", error);
    return undefined;
  }
}
