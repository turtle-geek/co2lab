// Timing and health thresholds shared by the hub, dashboard, and devices.

export const HEARTBEAT_MS = 2_000;
/** Hub marks a device offline after this long without a heartbeat. */
export const OFFLINE_AFTER_MS = 6_000;

export const PAIRING_CODE_TTL_MS = 5 * 60_000;
export const PAIRING_CODE_MAX_ATTEMPTS = 5;

export const VIEWER_LINK_DEFAULT_TTL_MIN = 120;

/** Live-screen frames: devices downscale to this width and send about this often. */
export const FRAME_MAX_WIDTH = 720;
export const FRAME_INTERVAL_MS = 1_000;

/** Health engine thresholds. */
export const BATTERY_REST_BELOW_PCT = 20;
export const TEMP_PAUSE_AT_C = 42;
export const TEMP_RESUME_BELOW_C = 38;

/** Android fallback: max Gemini-chosen actions per subtask before failing. */
export const MAX_FALLBACK_ACTIONS = 8;

/** Device reconnect backoff. */
export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 10_000;

export const WS_PATH = "/ws";
