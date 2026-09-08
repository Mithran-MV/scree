/**
 * The orrery: a slowly turning crystal on the desk.
 *
 * Pure ornament, and the only thing on the sheet that is. It sits in the corner
 * where nothing is measured, it carries no number, and it is drawn in aether
 * blue so it can never be mistaken for the gold that means a reading.
 */
export function Orrery() {
  return (
    <div className="orrery" aria-hidden="true">
      <svg viewBox="0 0 120 120">
        <defs>
          <radialGradient id="core" cx="50%" cy="45%">
            <stop offset="0" stopColor="#d9f7ff" />
            <stop offset="0.45" stopColor="#57d6e8" />
            <stop offset="1" stopColor="#123c52" />
          </radialGradient>
          <filter id="orreryGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g filter="url(#orreryGlow)">
          {/* the icosahedral cage */}
          <g stroke="#57d6e8" strokeWidth="1" fill="none" opacity="0.75" className="orrery-cage">
            <polygon points="60,16 96,38 96,82 60,104 24,82 24,38" />
            <polygon points="60,30 84,44 84,76 60,90 36,76 36,44" opacity="0.7" />
            <line x1="60" y1="16" x2="60" y2="104" />
            <line x1="24" y1="38" x2="96" y2="82" />
            <line x1="96" y1="38" x2="24" y2="82" />
          </g>
          <circle cx="60" cy="60" r="13" fill="url(#core)" className="orrery-core" />
        </g>

        {/* the ring it turns in */}
        <g className="orrery-ring" stroke="#b08d4a" strokeWidth="1.6" fill="none" opacity="0.85">
          <ellipse cx="60" cy="60" rx="44" ry="15" />
        </g>
        <g className="orrery-ring-2" stroke="#8a7440" strokeWidth="1.2" fill="none" opacity="0.6">
          <ellipse cx="60" cy="60" rx="15" ry="44" />
        </g>
      </svg>
    </div>
  );
}
