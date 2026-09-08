/**
 * The title, hung on a scroll.
 *
 * Drawn rather than imaged: two rolled ends, a hanging chain, and a vellum
 * field between them. All of it is inline SVG so it scales without an asset and
 * inherits the palette from the sheet around it.
 */
export function ScrollBanner({ title }: { title: string }) {
  return (
    <div className="banner">
      <svg viewBox="0 0 620 116" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <linearGradient id="vellum" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e6d4a4" />
            <stop offset="0.5" stopColor="#cbb279" />
            <stop offset="1" stopColor="#a98d51" />
          </linearGradient>
          <linearGradient id="roll" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d9c186" />
            <stop offset="0.45" stopColor="#9d8145" />
            <stop offset="1" stopColor="#6d5729" />
          </linearGradient>
          <filter id="bannerGlow" x="-30%" y="-60%" width="160%" height="220%">
            <feGaussianBlur stdDeviation="7" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* the chains it hangs from */}
        <g stroke="#6d5729" strokeWidth="2" opacity="0.9">
          <line x1="150" y1="0" x2="176" y2="26" />
          <line x1="470" y1="0" x2="444" y2="26" />
        </g>

        <g filter="url(#bannerGlow)">
          {/* the field */}
          <rect x="86" y="22" width="448" height="72" rx="4" fill="url(#vellum)" />
          <rect
            x="94"
            y="30"
            width="432"
            height="56"
            rx="3"
            fill="none"
            stroke="#6d5729"
            strokeWidth="1.6"
            opacity="0.72"
          />
          {/* rolled ends */}
          <rect x="66" y="14" width="26" height="88" rx="13" fill="url(#roll)" />
          <rect x="528" y="14" width="26" height="88" rx="13" fill="url(#roll)" />
          <circle cx="79" cy="58" r="5" fill="#4a3a1a" opacity="0.5" />
          <circle cx="541" cy="58" r="5" fill="#4a3a1a" opacity="0.5" />
        </g>
      </svg>
      <h1>{title}</h1>
    </div>
  );
}
