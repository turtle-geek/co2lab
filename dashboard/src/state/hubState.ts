// Dashboard state: built from `state.snapshot`, then patched by incremental events.

import type {
  AgentConfig,
  ApprovalView,
  DeviceView,
  ComputeSetView,
  ExperimentView,
  HubToClient,
  PendingDevice,
  RunView,
} from "@co2lab/shared";

export interface LiveFrame {
  subtaskId: string | null;
  src: string; // data: URL
  width: number;
  height: number;
  at: number;
}

export interface LiveStep {
  subtaskId: string;
  kind: string;
  text: string;
  at: number;
}

export interface PairCode {
  code: string;
  qrPayload: string;
  expiresAt: number;
}

export interface HubState {
  ready: boolean;
  role: "owner" | "viewer" | null;
  devices: DeviceView[];
  runs: RunView[];
  approvals: ApprovalView[];
  experiments: ExperimentView[];
  computeSets: ComputeSetView[];
  defaultConfig: AgentConfig | null;
  frames: Record<string, LiveFrame>;
  steps: Record<string, LiveStep>;
  pairCode: PairCode | null;
  viewerLink: { url: string; expiresAt: number } | null;
  /** Computers waiting for the owner to approve them (device-code pairing). */
  pendingDevices: PendingDevice[];
  /** Public hub URL, for the install one-liner. */
  hubUrl: string | null;
  lastError: { code: string; message: string; at: number } | null;
  /** Ids of devices that showed up after the snapshot (pairing success). */
  newDeviceIds: string[];
}

export const initialState: HubState = {
  ready: false,
  role: null,
  devices: [],
  runs: [],
  approvals: [],
  experiments: [],
  computeSets: [],
  defaultConfig: null,
  frames: {},
  steps: {},
  pairCode: null,
  viewerLink: null,
  pendingDevices: [],
  hubUrl: null,
  lastError: null,
  newDeviceIds: [],
};

export type Action = HubToClient | { type: "local.clearPair" } | { type: "local.clearError" };

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
}

export function reduce(state: HubState, msg: Action): HubState {
  switch (msg.type) {
    case "state.snapshot":
      return {
        ...state,
        ready: true,
        role: msg.role,
        devices: msg.devices,
        runs: msg.runs,
        approvals: msg.approvals,
        experiments: msg.experiments,
        computeSets: msg.computeSets ?? [],
        defaultConfig: msg.defaultConfig,
      };
    case "device.update": {
      const isNew = !state.devices.some((d) => d.id === msg.device.id);
      return {
        ...state,
        devices: upsert(state.devices, msg.device),
        newDeviceIds: isNew ? [...state.newDeviceIds, msg.device.id] : state.newDeviceIds,
      };
    }
    case "device.removed": {
      const { [msg.deviceId]: _f, ...frames } = state.frames;
      const { [msg.deviceId]: _s, ...steps } = state.steps;
      return { ...state, devices: state.devices.filter((d) => d.id !== msg.deviceId), frames, steps };
    }
    case "frame":
      return {
        ...state,
        frames: {
          ...state.frames,
          [msg.deviceId]: {
            subtaskId: msg.subtaskId,
            src: `data:image/jpeg;base64,${msg.jpegBase64}`,
            width: msg.width,
            height: msg.height,
            at: msg.at,
          },
        },
      };
    case "step":
      return {
        ...state,
        steps: {
          ...state.steps,
          [msg.deviceId]: { subtaskId: msg.subtaskId, kind: msg.kind, text: msg.text, at: msg.at },
        },
      };
    case "run.update":
      return { ...state, runs: upsert(state.runs, msg.run) };
    case "pair.code":
      return { ...state, pairCode: { code: msg.code, qrPayload: msg.qrPayload, expiresAt: msg.expiresAt } };
    case "devicecode.list":
      return { ...state, pendingDevices: msg.pending, hubUrl: msg.hubUrl };
    case "viewer.link":
      return { ...state, viewerLink: { url: msg.url, expiresAt: msg.expiresAt } };
    case "approval.request":
      return { ...state, approvals: upsert(state.approvals, msg.approval) };
    case "approval.resolved":
      return { ...state, approvals: state.approvals.filter((a) => a.id !== msg.approvalId) };
    case "compute.update":
      return { ...state, computeSets: upsert(state.computeSets, { ...msg.set }) };
    case "research.update":
      return { ...state, experiments: upsert(state.experiments, msg.experiment) };
    case "error":
      return { ...state, lastError: { code: msg.code, message: msg.message, at: Date.now() } };
    case "local.clearPair":
      return { ...state, pairCode: null, newDeviceIds: [] };
    case "local.clearError":
      return { ...state, lastError: null };
    default:
      return state;
  }
}

/** The run the dashboard focuses on: the newest one. */
export function currentRun(runs: RunView[]): RunView | null {
  let best: RunView | null = null;
  for (const r of runs) if (!best || r.createdAt > best.createdAt) best = r;
  return best;
}
