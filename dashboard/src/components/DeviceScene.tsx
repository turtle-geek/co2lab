// The device a tree lives in: a hand-drawn laptop, phone, or server whose screen is tinted by
// state, with the tree on that screen. Thick brown outlines match the tree trunk.

import { useId } from "react";
import type { DeviceKind, DeviceState } from "@co2lab/shared";
import { Tree } from "./Tree";

type Rect = { x: number; y: number; width: number; height: number; rx: number };

/** Where the screen is in each device, and where the tree sits on it (240×220 canvas). */
const LAYOUT: Record<DeviceKind, { screen: Rect; tree: { x: number; y: number; width: number; height: number } }> = {
  laptop: {
    screen: { x: 49, y: 31, width: 142, height: 108, rx: 7 },
    tree: { x: 60, y: 20, width: 120, height: 120 },
  },
  android: {
    screen: { x: 76, y: 32, width: 88, height: 150, rx: 9 },
    tree: { x: 56, y: 37, width: 128, height: 128 },
  },
  cloud: {
    screen: { x: 74, y: 28, width: 92, height: 112, rx: 8 },
    tree: { x: 61, y: 20, width: 118, height: 118 },
  },
};

function Laptop() {
  return (
    <g className="device__body">
      {/* lid */}
      <rect x="37" y="19" width="166" height="132" rx="13" />
      <circle className="device__cam" cx="120" cy="25.5" r="2.6" />
      {/* deck */}
      <path d="M33 153 H207 L223 184 H17 Z" strokeLinejoin="round" />
      <path className="device__keys" d="M54 159 H186 L194 172 H46 Z" strokeLinejoin="round" />
      <rect className="device__keys" x="101" y="175.5" width="38" height="5.5" rx="2.75" />
      {/* front lip */}
      <rect x="10" y="184" width="220" height="11" rx="5.5" />
    </g>
  );
}

function Phone() {
  return (
    <g className="device__body">
      {/* side button */}
      <rect x="175" y="62" width="7" height="30" rx="3" />
      <rect x="64" y="10" width="112" height="202" rx="20" />
      <rect className="device__slot" x="104" y="19" width="32" height="5" rx="2.5" />
      <rect className="device__home" x="104" y="190" width="32" height="12" rx="6" />
    </g>
  );
}

function Server() {
  return (
    <g className="device__body">
      <rect x="62" y="16" width="116" height="188" rx="14" />
      <rect className="device__keys" x="78" y="152" width="84" height="12" rx="4" />
      <rect className="device__keys" x="78" y="172" width="84" height="12" rx="4" />
      <circle className="device__led" cx="150" cy="158" r="2.6" />
      <circle className="device__led" cx="150" cy="178" r="2.6" />
    </g>
  );
}

export function DeviceScene({ kind, mood }: { kind: DeviceKind; mood: DeviceState }) {
  const id = useId().replace(/:/g, "");
  const { screen, tree: awake } = LAYOUT[kind];
  // Asleep, the tree shrinks and sinks a little on the screen so its zzz stays visible.
  const tree =
    mood === "offline"
      ? { x: awake.x + awake.width * 0.05, y: awake.y + awake.height * 0.07, width: awake.width * 0.9, height: awake.height * 0.9 }
      : awake;
  const clip = `screen-${id}`;
  const glow = `glow-${id}`;
  return (
    <svg className={`device device--${kind} device--${mood}`} viewBox="0 0 240 220" aria-hidden>
      <defs>
        <clipPath id={clip}>
          <rect {...screen} />
        </clipPath>
        <radialGradient id={glow} cx="50%" cy="48%" r="55%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="60%" stopColor="#ffffff" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {kind === "laptop" ? <Laptop /> : kind === "android" ? <Phone /> : <Server />}

      <g clipPath={`url(#${clip})`}>
        <rect className="device__screen" {...screen} />
        {mood === "working" && <rect className="device__glow" {...screen} fill={`url(#${glow})`} />}
        <Tree mood={mood} placement={tree} />
      </g>
      <rect className="device__screen-edge" {...screen} />
    </svg>
  );
}
