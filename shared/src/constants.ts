// Timing and health thresholds shared by the hub, dashboard, and devices.

export const HEARTBEAT_MS = 2_000;
/** Hub marks a device offline after this long without a heartbeat. */
export const OFFLINE_AFTER_MS = 6_000;

export const PAIRING_CODE_TTL_MS = 5 * 60_000;
export const PAIRING_CODE_MAX_ATTEMPTS = 5;

/** Device-code pairing (computers): codes live 10 min; the device polls every few seconds. */
export const DEVICE_CODE_TTL_MS = 10 * 60_000;
export const DEVICE_CODE_POLL_S = 3;
/** Per client IP, and in total, so nobody can flood the owner's approval list. */
export const DEVICE_CODE_MAX_PER_IP = 5;
export const DEVICE_CODE_MAX_PENDING = 20;

export const VIEWER_LINK_DEFAULT_TTL_MIN = 120;

/** Live-screen frames: devices downscale to this width and send about this often. */
export const FRAME_MAX_WIDTH = 720;
export const FRAME_INTERVAL_MS = 1_000;

/** Health engine thresholds. */
export const BATTERY_REST_BELOW_PCT = 20;
export const TEMP_PAUSE_AT_C = 42;
export const TEMP_RESUME_BELOW_C = 38;
/**
 * What tempC means depends on the device: Android reports its battery temperature (thresholds above),
 * computers report the CPU thermal zone, which idles around 45-55 °C and throttles near 95-100 °C.
 */
export const CPU_TEMP_PAUSE_AT_C = 90;
export const CPU_TEMP_RESUME_BELOW_C = 80;

/** Pause / resume thresholds for a device kind's tempC. */
export function tempLimits(kind: string): { pauseAtC: number; resumeBelowC: number } {
  return kind === "android"
    ? { pauseAtC: TEMP_PAUSE_AT_C, resumeBelowC: TEMP_RESUME_BELOW_C }
    : { pauseAtC: CPU_TEMP_PAUSE_AT_C, resumeBelowC: CPU_TEMP_RESUME_BELOW_C };
}

/** Android fallback: max Gemini-chosen actions per subtask before failing. */
export const MAX_FALLBACK_ACTIONS = 8;

/** Device reconnect backoff. */
export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 10_000;

export const WS_PATH = "/ws";
