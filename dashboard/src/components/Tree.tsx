// Tree illustration whose mood shows the device state. Inline SVG so CSS can animate parts.
// Shapes follow the hand-drawn mock: soft lumpy crowns (never perfect circles), trunks that
// widen toward the base, eyes a little above centre, the mouth tucked under them, and oval
// cheeks level with the bottom of the mouth.

import type { DeviceState } from "@co2lab/shared";

const INK = "#2f3a2a";

/**
 * Face layout per mood, following the reference: eyes sit a little above the middle of the crown,
 * the mouth is tucked just under them, and the mouth's lowest point is level with the cheek
 * centres. Asleep, the face drops a little into the fuller lower half of the crown.
 */
const CHEEKS: Record<DeviceState, { y: number; dx: number } | null> = {
  idle: { y: 92, dx: 37 },
  working: { y: 93, dx: 37 },
  offline: { y: 100, dx: 40 },
  resting: { y: 94, dx: 37 },
  hot: { y: 94, dx: 37 },
  error: { y: 94, dx: 37 },
  revoked: null,
};

/**
 * Every eye is one cubic curve ("M x y C …") and every mouth is two ("M x y C … C …"), so CSS can
 * morph any expression into any other. A dot is a near-zero-length curve with a thick round stroke;
 * the "o" mouth is a closed pair of curves with a fill.
 */
type Stroke = { d: string; width: number };
type Eyes = { left: Stroke; right: Stroke };
type Mouth = Stroke & { filled: boolean };

const EYES: Record<DeviceState, Eyes> = {
  // ^ ^ happy arches
  idle: { left: { d: "M72 82 C76.67 73.33 81.33 73.33 86 82", width: 4 }, right: { d: "M114 82 C118.67 73.33 123.33 73.33 128 82", width: 4 } },
  // > < squint
  working: { left: { d: "M72 77 C86 81 86 85 72 89", width: 4 }, right: { d: "M128 77 C114 81 114 85 128 89", width: 4 } },
  // closed, sleeping
  offline: { left: { d: "M71 87 C76.33 93.67 81.67 93.67 87 87", width: 4 }, right: { d: "M113 87 C118.33 93.67 123.67 93.67 129 87", width: 4 } },
  // heavy, drooping lids
  resting: { left: { d: "M71 84 C76 87 82 87 87 84", width: 4 }, right: { d: "M113 84 C118 87 124 87 129 84", width: 4 } },
  // wide, worried dots
  hot: { left: { d: "M78.5 83 C78.8 83 79.2 83 79.5 83", width: 10 }, right: { d: "M120.5 83 C120.8 83 121.2 83 121.5 83", width: 10 } },
  // dazed dots (the spirals fade in on top)
  error: { left: { d: "M78.5 83 C78.8 83 79.2 83 79.5 83", width: 3 }, right: { d: "M120.5 83 C120.8 83 121.2 83 121.5 83", width: 3 } },
  // flat, faded
  revoked: { left: { d: "M72 84 C76.67 84 81.33 84 86 84", width: 3 }, right: { d: "M114 84 C118.67 84 123.33 84 128 84", width: 3 } },
};

const MOUTH: Record<DeviceState, Mouth> = {
  // small smile right under the eyes, bottom level with the cheeks
  idle: { d: "M93 88 C95 90.7 97.5 92 100 92 C102.5 92 105 90.7 107 88", width: 4, filled: false },
  // tight, slightly strained
  working: { d: "M94 94 C96 92.7 98 92 100 92 C102 92 104 92.7 106 94", width: 4, filled: false },
  // small "o"
  offline: { d: "M100 97.2 C104.9 97.2 104.9 106.8 100 106.8 C95.1 106.8 95.1 97.2 100 97.2", width: 1.5, filled: true },
  resting: { d: "M92 96 C94.7 94 97.3 93 100 93 C102.7 93 105.3 94 108 96", width: 4, filled: false },
  // wobbly
  hot: { d: "M88 94 C92 88.5 96 88.5 100 94 C104 99.5 108 99.5 112 94", width: 3, filled: false },
  // big "o"
  error: { d: "M100 88 C108 88 108 102 100 102 C92 102 92 88 100 88", width: 1.5, filled: true },
  revoked: { d: "M90 98 C93.3 95.3 96.7 94 100 94 C103.3 94 106.7 95.3 110 98", width: 4, filled: false },
};

function Face({ mood }: { mood: DeviceState }) {
  const eyes = EYES[mood];
  const mouth = MOUTH[mood];
  const stroke = (s: Stroke) => ({ d: `path("${s.d}")`, strokeWidth: s.width });
  return (
    <>
      <g className="tree__eyes">
        <path className="tree__eye" style={stroke(eyes.left)} />
        <path className="tree__eye" style={stroke(eyes.right)} />
      </g>
      <path className="tree__mouth" style={{ ...stroke(mouth), fill: mouth.filled ? INK : "rgba(47, 58, 42, 0)" }} />
      {mood === "hot" && <path className="tree__extra" d="M69 71 l16 4 M131 71 l-16 4" stroke={INK} strokeWidth={3} strokeLinecap="round" fill="none" />}
      {mood === "error" && (
        <g className="tree__extra tree__dizzy" stroke={INK} strokeWidth={3} strokeLinecap="round" fill="none">
          <path d="M79 83 m0 0 a2 2 0 1 1 3 -1 a5 5 0 1 1 -7 -4 a8 8 0 1 1 12 7" />
          <path d="M121 83 m0 0 a2 2 0 1 1 3 -1 a5 5 0 1 1 -7 -4 a8 8 0 1 1 12 7" />
        </g>
      )}
    </>
  );
}

/**
 * Soft, slightly uneven crown. Each mood gets its own silhouette; none is a perfect circle.
 * Every path has the same commands (M + 6 C + Z) so CSS can morph between moods.
 */
const CROWN: Record<DeviceState, string> = {
  // awake: soft rounded blob with slightly squared sides, like the hand-drawn mock
  idle: "M100 30 C122 29 141 38 151 55 C160 70 160 92 153 108 C145 127 125 138 100 138 C74 138 54 128 46 110 C39 94 40 70 49 55 C59 39 78 31 100 30Z",
  // working: a little wider, squeezed by effort
  working: "M100 34 C124 33 145 41 155 58 C163 72 162 94 155 110 C147 128 126 138 100 138 C73 138 52 128 45 111 C38 95 38 72 46 58 C56 41 77 34 100 34Z",
  // asleep: round, narrower on top and a little chubbier toward a rounded bottom
  offline:
    "M100 34 C126 33 146 47 152 68 C157 84 162 100 158 114 C153 132 130 142 100 142 C70 142 47 132 42 114 C38 100 43 84 48 68 C54 47 74 35 100 34Z",
  // resting (low battery): the normal round crown; the tired face and paler colour do the talking
  resting: "M100 30 C122 29 141 38 151 55 C160 70 160 92 153 108 C145 127 125 138 100 138 C74 138 54 128 46 110 C39 94 40 70 49 55 C59 39 78 31 100 30Z",
  hot: "M100 30 C122 29 141 38 151 55 C160 70 160 92 153 108 C145 127 125 138 100 138 C74 138 54 128 46 110 C39 94 40 70 49 55 C59 39 78 31 100 30Z",
  error: "M100 30 C122 29 141 38 151 55 C160 70 160 92 153 108 C145 127 125 138 100 138 C74 138 54 128 46 110 C39 94 40 70 49 55 C59 39 78 31 100 30Z",
  // revoked: same size as the other moods, but sagging (flatter top, drooping sides); colour does the withering
  revoked:
    "M100 40 C123 39 142 48 151 64 C159 79 160 98 154 113 C146 131 125 140 100 140 C75 140 54 131 46 113 C40 98 41 79 49 64 C58 48 77 41 100 40Z",
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
  const cheekRx = mood === "hot" ? 12.5 : mood === "offline" ? 13.5 : 11.5;
  const cheekRy = mood === "hot" ? 8.5 : 8;
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
          <path className="tree__crown-shape" style={{ d: `path("${CROWN[mood]}")` }} />
        </g>
        <g className="tree__face">
          {cheeks && (
            <g className="tree__cheeks">
              <ellipse style={{ cx: 100 - cheeks.dx, cy: cheeks.y, rx: cheekRx, ry: cheekRy }} />
              <ellipse style={{ cx: 100 + cheeks.dx, cy: cheeks.y, rx: cheekRx, ry: cheekRy }} />
            </g>
          )}
          <Face mood={mood} />
        </g>
      </g>

      {mood === "working" && (
        <path className="tree__sweat" d="M156 38 C156 38 146 52 146 58 a10 10 0 0 0 20 0 C166 52 156 38 156 38Z" />
      )}
      {mood === "offline" && (
        <g className="tree__zzz">
          <text x="122" y="72" fontSize="14">z</text>
          <text x="132" y="61" fontSize="18">z</text>
          <text x="144" y="49" fontSize="24">Z</text>
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
        // Leaves start on the crown's edge and drift down to the ground one after another.
        <g className="tree__falling">
          {[
            [56, 96, "0s"],
            [146, 88, "0.7s"],
            [118, 128, "1.4s"],
            [78, 124, "2.1s"],
            [140, 116, "2.8s"],
          ].map(([x, y, delay], i) => (
            <g key={i} className="tree__leaf-fall" style={{ animationDelay: delay as string }}>
              <path
                d={`M${x} ${y} c4 -5 11 -5 13 0 c-3 5 -10 5 -13 0z`}
                style={{ transformOrigin: `${(x as number) + 6}px ${y}px` }}
              />
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}
