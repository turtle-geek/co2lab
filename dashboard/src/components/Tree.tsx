// Tree illustration whose mood shows the device state. Inline SVG so CSS can animate parts.
// Shapes follow the hand-drawn mock: soft lumpy crowns (never perfect circles), trunks that
// widen toward the base, eyes a little above centre, the mouth tucked under them, and oval
// cheeks level with the bottom of the mouth.

import type { DeviceState } from "@co2lab/shared";

const INK = "#2f3a2a";

/**
 * Face layout per mood, following the reference: eyes sit a little above the middle of the crown,
 * the mouth is tucked just under them, and the mouth's lowest point is level with the cheek
 * centres. Asleep, the face drops into the slumped lower half of the crown.
 */
const CHEEKS: Record<DeviceState, { y: number; dx: number } | null> = {
  idle: { y: 92, dx: 37 },
  working: { y: 93, dx: 37 },
  offline: { y: 104, dx: 42 },
  resting: { y: 94, dx: 37 },
  hot: { y: 94, dx: 37 },
  error: { y: 94, dx: 37 },
  revoked: null,
};

function Eyes({ mood }: { mood: DeviceState }) {
  const p = { stroke: INK, strokeWidth: 4, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (mood) {
    case "idle":
      // ^ ^ happy arches
      return (
        <g {...p}>
          <path d="M72 85 q7 -9 14 0" />
          <path d="M114 85 q7 -9 14 0" />
        </g>
      );
    case "working":
      // > < squint
      return (
        <g {...p}>
          <path d="M72 77 l12 6 l-12 6" />
          <path d="M128 77 l-12 6 l12 6" />
        </g>
      );
    case "offline":
      // closed, sleeping
      return (
        <g {...p}>
          <path d="M71 89 q8 7 16 0" />
          <path d="M113 89 q8 7 16 0" />
        </g>
      );
    case "resting":
      // heavy lids
      return (
        <g {...p}>
          <path d="M70 82 h17" />
          <path d="M113 82 h17" />
          <path d="M72 86 q6.5 4 13 0" strokeWidth={3} />
          <path d="M115 86 q6.5 4 13 0" strokeWidth={3} />
        </g>
      );
    case "hot":
      // worried, wide
      return (
        <g>
          <circle cx="79" cy="83" r="5" fill={INK} />
          <circle cx="121" cy="83" r="5" fill={INK} />
          <path d="M69 71 l16 4 M131 71 l-16 4" {...p} strokeWidth={3} />
        </g>
      );
    case "error":
      // dizzy spirals
      return (
        <g {...p} strokeWidth={3} className="tree__dizzy">
          <path d="M79 83 m0 0 a2 2 0 1 1 3 -1 a5 5 0 1 1 -7 -4 a8 8 0 1 1 12 7" />
          <path d="M121 83 m0 0 a2 2 0 1 1 3 -1 a5 5 0 1 1 -7 -4 a8 8 0 1 1 12 7" />
        </g>
      );
    case "revoked":
      return (
        <g {...p}>
          <path d="M72 77 l13 12 M85 77 l-13 12" />
          <path d="M115 77 l13 12 M128 77 l-13 12" />
        </g>
      );
  }
}

function Mouth({ mood }: { mood: DeviceState }) {
  const p = { stroke: INK, strokeWidth: 4, fill: "none", strokeLinecap: "round" as const };
  switch (mood) {
    case "idle":
      // small smile right under the eyes, bottom level with the cheeks
      return <path d="M93 88 q7 8 14 0" {...p} />;
    case "working":
      // tight, slightly strained
      return <path d="M94 94 q6 -4 12 0" {...p} />;
    case "offline":
      return <ellipse cx="100" cy="102" rx="3.5" ry="4.5" fill={INK} />;
    case "resting":
      return <path d="M92 96 q8 -6 16 0" {...p} />;
    case "hot":
      return <path d="M88 94 q4 -5 8 0 q4 5 8 0 q4 -5 8 0" {...p} strokeWidth={3} />;
    case "error":
      return <ellipse cx="100" cy="95" rx="6" ry="7" fill={INK} />;
    case "revoked":
      return <path d="M90 98 q10 -8 20 0" {...p} />;
  }
}

/** Soft, slightly uneven crown. Each mood gets its own silhouette; none is a perfect circle. */
const CROWN: Record<DeviceState, string> = {
  // awake: soft rounded blob with slightly squared sides, like the hand-drawn mock
  idle: "M100 30 C122 29 141 38 151 55 C160 70 160 92 153 108 C145 127 125 138 100 138 C74 138 54 128 46 110 C39 94 40 70 49 55 C59 39 78 31 100 30Z",
  // working: a little wider, squeezed by effort
  working: "M100 34 C124 33 145 41 155 58 C163 72 162 94 155 110 C147 128 126 138 100 138 C73 138 52 128 45 111 C38 95 38 72 46 58 C56 41 77 34 100 34Z",
  // asleep: the normal round top, slumping into a wider oval where the cheeks are
  offline:
    "M100 32 C122 31 141 40 150 57 C156 68 158 80 157 90 C166 100 168 118 158 130 C148 142 124 144 100 142 C76 144 52 142 42 130 C32 118 34 100 43 90 C42 80 44 68 50 57 C59 41 78 33 100 32Z",
  // resting (low battery): rounded top, leaves sagging down the sides
  resting:
    "M44 98 C41 54 70 36 100 36 C130 36 159 54 156 98 C154 120 144 132 132 127 C124 136 110 133 100 127 C90 133 76 136 68 127 C56 132 46 120 44 98Z",
  hot: "M100 30 C122 29 141 38 151 55 C160 70 160 92 153 108 C145 127 125 138 100 138 C74 138 54 128 46 110 C39 94 40 70 49 55 C59 39 78 31 100 30Z",
  error: "M100 30 C122 29 141 38 151 55 C160 70 160 92 153 108 C145 127 125 138 100 138 C74 138 54 128 46 110 C39 94 40 70 49 55 C59 39 78 31 100 30Z",
  // revoked: shrunken and withered
  revoked:
    "M58 104 C50 76 70 58 92 60 C104 50 128 56 136 70 C152 76 154 98 142 108 C140 124 120 130 108 124 C96 132 76 130 70 120 C58 120 54 112 58 104Z",
};

/** Trunk that is narrow under the crown and flares out at the base. */
const TRUNK = "M95 128 L105 128 C105 148 106 166 110 179 C111.5 184 109.5 187 106 187 L94 187 C90.5 187 88.5 184 90 179 C94 166 95 148 95 128Z";

type Placement = { x: number; y: number; width: number; height: number };

/**
 * Standalone tree (login screen) or, with `placement`, a tree nested inside another SVG
 * such as a device screen.
 */
export function Tree({ mood, placement }: { mood: DeviceState; placement?: Placement }) {
  const cheeks = CHEEKS[mood];
  const cheekRx = mood === "hot" ? 11 : 9;
  const cheekRy = mood === "hot" ? 8.5 : 7.8;
  return (
    <svg
      className={`${placement ? "tree-embedded" : "tree"} tree--${mood}`}
      viewBox="0 0 200 200"
      role="img"
      aria-label={`Tree looks ${mood}`}
      overflow="visible"
      {...placement}
    >
      <path className="tree__trunk" d={TRUNK} />
      <g className="tree__crown">
        <g className="tree__crown-shape-group">
          <path className="tree__crown-shape" d={CROWN[mood]} />
          {mood === "resting" && (
            <>
              <ellipse cx="50" cy="126" rx="9" ry="16" transform="rotate(18 50 126)" className="tree__leaf" />
              <ellipse cx="150" cy="126" rx="9" ry="16" transform="rotate(-18 150 126)" className="tree__leaf" />
            </>
          )}
        </g>
        <g className="tree__face">
          {cheeks && (
            <g className="tree__cheeks">
              <ellipse cx={100 - cheeks.dx} cy={cheeks.y} rx={cheekRx} ry={cheekRy} />
              <ellipse cx={100 + cheeks.dx} cy={cheeks.y} rx={cheekRx} ry={cheekRy} />
            </g>
          )}
          <Eyes mood={mood} />
          <Mouth mood={mood} />
        </g>
      </g>

      {mood === "working" && (
        <path className="tree__sweat" d="M156 38 C156 38 146 52 146 58 a10 10 0 0 0 20 0 C166 52 156 38 156 38Z" />
      )}
      {mood === "offline" && (
        <g className="tree__zzz">
          <text x="132" y="44" fontSize="18">z</text>
          <text x="146" y="30" fontSize="24">z</text>
          <text x="164" y="16" fontSize="30">Z</text>
          <circle cx="160" cy="64" r="5" />
          <circle cx="152" cy="80" r="3.5" />
          <circle cx="166" cy="78" r="2.5" />
        </g>
      )}
      {mood === "hot" && (
        <g className="tree__heat">
          <path d="M60 26 q6 -6 0 -12 q-6 -6 0 -12" />
          <path d="M100 18 q6 -6 0 -12 q-6 -6 0 -12" />
          <path d="M140 26 q6 -6 0 -12 q-6 -6 0 -12" />
        </g>
      )}
      {mood === "error" && (
        <g className="tree__stars">
          <path d="M48 40 l3 7 7 1 -5 5 1 7 -6 -3 -6 3 1 -7 -5 -5 7 -1Z" />
          <path d="M150 34 l2.4 5.6 5.6 0.8 -4 4 0.8 5.6 -4.8 -2.4 -4.8 2.4 0.8 -5.6 -4 -4 5.6 -0.8Z" />
        </g>
      )}
      {mood === "revoked" && (
        <g className="tree__falling">
          <ellipse cx="60" cy="150" rx="6" ry="3.5" transform="rotate(30 60 150)" />
          <ellipse cx="146" cy="160" rx="6" ry="3.5" transform="rotate(-20 146 160)" />
          <ellipse cx="124" cy="178" rx="5" ry="3" transform="rotate(10 124 178)" />
        </g>
      )}
    </svg>
  );
}
