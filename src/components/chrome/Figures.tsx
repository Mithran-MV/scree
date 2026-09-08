/**
 * The two figures who keep the chamber.
 *
 * Drawn as flat vector portraits rather than painted illustration, which is an
 * honest constraint rather than a shortcut: a stylised figure that commits to
 * the sheet's own palette reads as designed, where a half-rendered painting
 * reads as a placeholder. Both sit in the same brass bezel as the instruments,
 * so they belong to the room rather than floating over it.
 */

export function DataSeeker() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="robe" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2f4f86" />
          <stop offset="1" stopColor="#16264a" />
        </linearGradient>
      </defs>
      {/* hat */}
      <path d="M32 6 L45 30 L19 30 Z" fill="#2b4778" />
      <path d="M17 30 h30 l-2 4 h-26 z" fill="#20365c" />
      <circle cx="32" cy="17" r="2.6" fill="#57d6e8" />
      {/* face and beard */}
      <path d="M24 33 h16 v6 q0 4 -3 6 l-5 12 l-5 -12 q-3 -2 -3 -6 z" fill="#e6e2d6" />
      <rect x="25" y="33" width="14" height="4" rx="2" fill="#d8ccb0" />
      <circle cx="28.5" cy="35" r="1.5" fill="#0a1330" />
      <circle cx="35.5" cy="35" r="1.5" fill="#0a1330" />
      {/* robe */}
      <path d="M22 40 q-8 5 -10 22 h40 q-2 -17 -10 -22 l-5 13 l-5 -13 z" fill="url(#robe)" />
      {/* staff and its light */}
      <rect x="49" y="16" width="2.4" height="46" rx="1.2" fill="#6d5729" />
      <circle cx="50.2" cy="14" r="4.6" fill="#57d6e8" opacity="0.35" />
      <circle cx="50.2" cy="14" r="2.4" fill="#d9f7ff" />
    </svg>
  );
}

export function RiskEngineer() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="plate" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c9a866" />
          <stop offset="0.5" stopColor="#8a6f3c" />
          <stop offset="1" stopColor="#4e3d1e" />
        </linearGradient>
      </defs>
      {/* head */}
      <path d="M20 14 h24 q4 0 4 4 v20 q0 4 -4 4 h-24 q-4 0 -4 -4 v-20 q0 -4 4 -4 z" fill="url(#plate)" />
      <rect x="20" y="20" width="24" height="10" rx="2" fill="#0a1330" />
      <circle cx="27" cy="25" r="3" fill="#57d6e8" />
      <circle cx="27" cy="25" r="1.2" fill="#eafcff" />
      <rect x="34" y="23.5" width="8" height="3" rx="1.5" fill="#2b7f8e" />
      {/* jaw vents */}
      <g fill="#4e3d1e">
        <rect x="23" y="34" width="18" height="1.6" rx="0.8" />
        <rect x="23" y="37" width="18" height="1.6" rx="0.8" />
      </g>
      {/* antenna */}
      <rect x="31" y="6" width="2" height="8" fill="#6d5729" />
      <circle cx="32" cy="5" r="2.4" fill="#e2603a" />
      {/* shoulders and pistons */}
      <path d="M14 44 h36 q3 0 3 3 v13 h-42 v-13 q0 -3 3 -3 z" fill="#3a2f18" />
      <g fill="url(#plate)">
        <rect x="17" y="47" width="6" height="11" rx="1.5" />
        <rect x="41" y="47" width="6" height="11" rx="1.5" />
      </g>
      <g fill="#57d6e8" opacity="0.85">
        <rect x="27" y="49" width="3" height="3" />
        <rect x="32" y="49" width="3" height="3" />
        <rect x="37" y="49" width="3" height="3" />
      </g>
    </svg>
  );
}

/** The instrument glyphs that sit in the smaller portholes. */
export function ChartGlyph() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <g stroke="#ffe6a8" strokeWidth="1.6" fill="none" strokeLinecap="round">
        <path d="M8 34 h32" opacity="0.4" />
        <path d="M8 34 v-22" opacity="0.4" />
        <path d="M10 16 q8 0 11 8 t13 8" />
        <path d="M10 22 q9 0 12 6 t12 5" opacity="0.6" />
      </g>
    </svg>
  );
}

export function TerraceGlyph() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <g stroke="#ffe6a8" strokeWidth="1.8" fill="none" strokeLinejoin="round">
        <path d="M8 34 h10 v-8 h10 v-8 h12" />
      </g>
      <g stroke="#57d6e8" strokeWidth="1.4" fill="none" strokeLinecap="round">
        <path d="M36 14 v8 M33 17 l3 -3 l3 3" />
        <path d="M36 34 v-6 M33 31 l3 3 l3 -3" />
      </g>
    </svg>
  );
}
