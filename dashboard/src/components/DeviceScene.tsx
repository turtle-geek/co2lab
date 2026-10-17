// The device a tree lives in: a clean laptop, phone, or server whose screen is tinted by state,
// with the tree on that screen. Outlines use the trunk's brown so device and tree read as one
// drawing. Screens are sized so the tree keeps a clear margin from the bezel.

import { useId } from "react";
import type { DeviceKind, DeviceState } from "@co2lab/shared";
import { Tree } from "./Tree";

type Rect = { x: number; y: number; width: number; height: number; rx: number };
type Box = { x: number; y: number; width: number; height: number };

/** Where the screen is in each device, and where the tree sits on it (240×220 canvas). */
const LAYOUT: Record<DeviceKind, { screen: Rect; tree: Box }> = {
  laptop: {
    screen: { x: 42, y: 22, width: 156, height: 120, rx: 6 },
    tree: { x: 60, y: 22, width: 120, height: 120 },
  },
  android: {
    screen: { x: 69, y: 15, width: 102, height: 190, rx: 14 },
    tree: { x: 56, y: 40, width: 128, height: 128 },
  },
  cloud: {
    screen: { x: 73, y: 23, width: 94, height: 116, rx: 8 },
    tree: { x: 61, y: 22, width: 118, height: 118 },
  },
};

function Laptop() {
  return (
    <g className="device__body">
      {/* keyboard deck: a trapezoid whose top edge is exactly the lid's bottom edge */}
      <path d="M32 152 H208 L225 184 H15 Z" />
      {/* front edge: a thin slab under the deck for depth; its top edge covers the deck's bottom */}
      <rect className="device__lip" x="13" y="184" width="214" height="7" rx="3.5" />
      <path className="device__detail device__detail--soft" d="M50 158 H190 L198 169 H42 Z" />
      <rect className="device__detail device__detail--soft" x="103" y="173" width="34" height="6" rx="3" />
      {/* lid: rounded on top, square at the hinge so it meets the deck in one line */}
      <path d="M43 12 H197 A11 11 0 0 1 208 23 V152 H32 V23 A11 11 0 0 1 43 12 Z" />
    </g>
  );
}

function Phone() {
  return (
    <g className="device__body">
      {/* side buttons */}
      <rect className="device__detail" x="177.5" y="56" width="3.5" height="26" rx="1.75" />
      <rect className="device__detail" x="177.5" y="90" width="3.5" height="16" rx="1.75" />
      <rect x="61" y="7" width="118" height="206" rx="21" />
    </g>
  );
}

function Server() {
  return (
    <g className="device__body">
      <rect x="63" y="13" width="114" height="194" rx="14" />
      <rect className="device__detail device__detail--soft" x="78" y="152" width="84" height="12" rx="4" />
      <rect className="device__detail device__detail--soft" x="78" y="172" width="84" height="12" rx="4" />
      <circle className="device__led" cx="150" cy="158" r="2.6" />
      <circle className="device__led" cx="150" cy="178" r="2.6" />
    </g>
  );
}

export function DeviceScene({ kind, mood }: { kind: DeviceKind; mood: DeviceState }) {
  const id = useId().replace(/:/g, "");
  // The tree keeps the same spot in every mood so the trunk never jumps; only the crown morphs.
  const { screen, tree } = LAYOUT[kind];
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
      {kind === "laptop" && <circle className="device__cam" cx="120" cy="17" r="2" />}
      {kind === "android" && <circle className="device__cam" cx="120" cy="25" r="3.2" />}
    </svg>
  );
}
