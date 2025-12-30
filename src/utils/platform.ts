/**
 * Platform detection utilities for cross-platform support
 */

export type Platform = "linux" | "macos" | "windows" | "unknown";

/**
 * Get the current platform
 */
export function getPlatform(): Platform {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      return "unknown";
  }
}

/**
 * Check if running on macOS
 */
export function isMacOS(): boolean {
  return process.platform === "darwin";
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  return process.platform === "linux";
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return process.platform === "win32";
}

/**
 * Check if the current platform is supported for daemon operations
 */
export function isPlatformSupported(): boolean {
  return isMacOS() || isLinux();
}

/**
 * Get human-readable platform name
 */
export function getPlatformName(): string {
  switch (getPlatform()) {
    case "macos":
      return "macOS";
    case "linux":
      return "Linux";
    case "windows":
      return "Windows";
    default:
      return "Unknown";
  }
}
