// Tree illustration whose mood shows the device state. Inline SVG so CSS can animate parts.

import type { DeviceState } from "@co2lab/shared";

const INK = "#2f3a2a";

function Eyes({ mood }: { mood: DeviceState }) {
  const p = { stroke: INK, strokeWidth: 4, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (mood) {
    case "idle":
      // ^ ^ happy
      return (
        <g {...p}>
          <path d="M70 92 q8 -10 16 0" />
          <path d="M114 92 q8 -10 16 0" />
        </g>
      );
    case "working":
      // > < squint
      return (
        <g {...p}>
          <path d="M70 84 l14 7 l-14 7" />
          <path d="M130 84 l-14 7 l14 7" />
        </g>
      );
    case "offline":
      // closed, sleeping
      return (
        <g {...p}>
          <path d="M70 92 q8 8 16 0" />
          <path d="M114 92 q8 8 16 0" />
        </g>
      );
    case "resting":
      // heavy lids
      return (
        <g {...p}>
          <path d="M69 93 h18" />
          <path d="M113 93 h18" />
          <path d="M71 97 q7 4 14 0" strokeWidth={3} />
          <path d="M115 97 q7 4 14 0" strokeWidth={3} />
        </g>
      );
    case "hot":
      // worried, wide
      return (
        <g>
          <circle cx="78" cy="92" r="5" fill={INK} />
          <circle cx="122" cy="92" r="5" fill={INK} />
          <path d="M68 80 l16 4 M132 80 l-16 4" {...p} strokeWidth={3} />
        </g>
      );
    case "error":
      // dizzy spirals
      return (
        <g {...p} strokeWidth={3} className="tree__dizzy">
          <path d="M78 92 m0 0 a2 2 0 1 1 3 -1 a5 5 0 1 1 -7 -4 a8 8 0 1 1 12 7" />
          <path d="M122 92 m0 0 a2 2 0 1 1 3 -1 a5 5 0 1 1 -7 -4 a8 8 0 1 1 12 7" />
        </g>
      );
    case "revoked":
      return (
        <g {...p}>
          <path d="M71 86 l14 12 M85 86 l-14 12" />
          <path d="M115 86 l14 12 M129 86 l-14 12" />
        </g>
      );
  }
}

function Mouth({ mood }: { mood: DeviceState }) {
  const p = { stroke: INK, strokeWidth: 4, fill: "none", strokeLinecap: "round" as const };
  switch (mood) {
    case "idle":
      return <path d="M88 108 q12 12 24 0" {...p} />;
    case "working":
      return <path d="M94 112 h12" {...p} />;
    case "offline":
      return <ellipse cx="100" cy="112" rx="3.5" ry="4.5" fill={INK} />;
    case "resting":
      return <path d="M90 114 q10 -7 20 0" {...p} />;
    case "hot":
      return <path d="M88 112 q4 -5 8 0 q4 5 8 0 q4 -5 8 0" {...p} strokeWidth={3} />;
    case "error":
      return <ellipse cx="100" cy="113" rx="6" ry="7" fill={INK} />;
    case "revoked":
      return <path d="M90 115 q10 -8 20 0" {...p} />;
  }
}

/** Crown silhouette per mood. */
function Crown({ mood }: { mood: DeviceState }) {
  if (mood === "resting") {
    // drooping: rounded top, leaves sagging down the sides
    return (
      <g className="tree__crown-shape">
        <path d="M44 100 C40 52 72 36 100 36 C128 36 160 52 156 100 C154 122 144 134 132 128 C124 138 110 134 100 128 C90 134 76 138 68 128 C56 134 46 122 44 100Z" />
        <ellipse cx="50" cy="128" rx="9" ry="16" transform="rotate(18 50 128)" className="tree__leaf" />
        <ellipse cx="150" cy="128" rx="9" ry="16" transform="rotate(-18 150 128)" className="tree__leaf" />
      </g>
    );
  }
  if (mood === "offline") {
    // lumpy, like the mock
    return (
      <path
        className="tree__crown-shape"
        d="M46 100 C36 70 58 44 84 42 C98 30 128 34 140 50 C160 56 166 84 154 100 C160 120 140 136 120 130 C108 140 86 140 76 130 C54 136 38 120 46 100Z"
      />
    );
  }
  if (mood === "revoked") {
    return (
      <g className="tree__crown-shape">
        <path d="M58 104 C50 76 70 58 92 60 C104 50 128 56 136 70 C152 76 154 98 142 108 C140 124 120 130 108 124 C96 132 76 130 70 120 C58 120 54 112 58 104Z" />
      </g>
    );
  }
  return <circle className="tree__crown-shape" cx="100" cy="88" r="58" />;
}

export function Tree({ mood }: { mood: DeviceState }) {
  const showCheeks = mood !== "revoked";
  return (
    <svg className={`tree tree--${mood}`} viewBox="0 0 200 200" role="img" aria-label={`Tree looks ${mood}`}>
      <rect className="tree__trunk" x="92" y="128" width="16" height="54" rx="6" />
      <g className="tree__crown">
        <Crown mood={mood} />
        <g className="tree__face">
          {showCheeks && (
            <g className="tree__cheeks">
              <ellipse cx="66" cy="106" rx={mood === "hot" ? 11 : 8} ry={mood === "hot" ? 8 : 6} />
              <ellipse cx="134" cy="106" rx={mood === "hot" ? 11 : 8} ry={mood === "hot" ? 8 : 6} />
            </g>
          )}
          <Eyes mood={mood} />
          <Mouth mood={mood} />
        </g>
      </g>

      {mood === "working" && (
        <path className="tree__sweat" d="M156 40 C156 40 146 54 146 60 a10 10 0 0 0 20 0 C166 54 156 40 156 40Z" />
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
