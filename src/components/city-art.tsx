export function CityArt({ small = false }: { small?: boolean }) {
  const blocks = [
    { x: 135, y: 122, w: 88, d: 54, h: 120 },
    { x: 245, y: 166, w: 70, d: 46, h: 76 },
    { x: 65, y: 233, w: 105, d: 56, h: 95 },
    { x: 202, y: 276, w: 115, d: 61, h: 165 },
    { x: 345, y: 231, w: 82, d: 52, h: 115 },
    { x: 347, y: 356, w: 83, d: 53, h: 74 },
    { x: 103, y: 361, w: 70, d: 45, h: 64 },
  ];
  return (
    <svg
      viewBox="0 0 620 570"
      className={`city-art ${small ? 'city-art-small' : ''}`}
      role="img"
      aria-label="Conceptual isometric development campus with connected safety sensors"
    >
      <defs>
        <linearGradient id="ground" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#dce4d0" />
          <stop offset="1" stopColor="#aabda7" />
        </linearGradient>
        <linearGradient id="face" x1="0" x2="1">
          <stop stopColor="#f5f1df" />
          <stop offset="1" stopColor="#cbcbb7" />
        </linearGradient>
        <pattern id="lines" width="17" height="14" patternUnits="userSpaceOnUse">
          <path d="M0 0V14M0 12H17" stroke="#6e8b79" strokeWidth="1" opacity=".45" />
        </pattern>
        <filter id="shadow">
          <feDropShadow dx="0" dy="20" stdDeviation="18" floodColor="#0a241b" floodOpacity=".24" />
        </filter>
      </defs>
      <g transform="translate(18 40)" filter="url(#shadow)">
        <path d="M20 284L310 119L579 278L288 448Z" fill="#294b3c" />
        <path d="M20 275L310 110L579 269L288 439Z" fill="url(#ground)" />
        <g stroke="#e9eddc" strokeWidth="16">
          <path d="M87 237L357 395M212 166L482 324M157 361L445 194" />
        </g>
        <g stroke="#73947e" strokeWidth="1" opacity=".5">
          <path d="M20 275L288 439M310 110L579 269" />
        </g>
      </g>
      <g transform="translate(32 -40) scale(.96)">
        {blocks.map((b, i) => (
          <g
            key={i}
            className={`art-building art-building-${i}`}
            style={{ animationDelay: `${i * 0.1}s` }}
          >
            <path d={`M${b.x} ${b.y}l${b.w} 49v${b.h}l-${b.w} -49Z`} fill="#b3c1ad" />
            <path d={`M${b.x + b.w} ${b.y + 49}l${b.d} -33v${b.h}l-${b.d} 33Z`} fill="#748f7d" />
            <path d={`M${b.x} ${b.y}l${b.d} -33l${b.w} 49l-${b.d} 33Z`} fill="url(#face)" />
            <path
              d={`M${b.x + 8} ${b.y + 14}l${b.w - 16} 40v${b.h - 25}l-${b.w - 16} -40Z`}
              fill="url(#lines)"
            />
            <path
              d={`M${b.x + 8} ${b.y + 4}l${b.d - 5} -24l${b.w - 15} 40l-${b.d - 5} 25Z`}
              fill={i === 3 ? '#a2b966' : '#d2d4b9'}
            />
          </g>
        ))}
      </g>
      <g fill="#3c7850">
        {[
          [89, 307],
          [176, 417],
          [476, 291],
          [438, 389],
          [270, 427],
          [347, 154],
          [127, 203],
          [400, 448],
          [520, 340],
        ].map(([x, y], i) => (
          <g key={i}>
            <ellipse cx={x} cy={y + 9} rx="12" ry="6" fill="#355c35" opacity=".3" />
            <path d={`M${x} ${y}v14`} stroke="#5e6442" strokeWidth="3" />
            <circle cx={x} cy={y - 2} r="12" />
            <circle cx={x - 4} cy={y - 6} r="8" fill="#639160" />
          </g>
        ))}
      </g>
      <g stroke="#d8fa8b" fill="#d8fa8b">
        <path
          className="signal-line"
          d="M191 173L292 247L416 228L468 365"
          fill="none"
          strokeDasharray="4 6"
          opacity=".8"
        />
        {[
          [191, 173],
          [292, 247],
          [416, 228],
          [468, 365],
        ].map(([x, y], i) => (
          <g key={i}>
            <circle
              className="signal-ring"
              cx={x}
              cy={y}
              r="13"
              fill="none"
              opacity=".6"
              style={{ animationDelay: `${i * 0.5}s` }}
            />
            <circle cx={x} cy={y} r="4" />
          </g>
        ))}
      </g>
      {!small && (
        <g fontFamily="Arial, sans-serif" fontSize="11">
          <rect x="12" y="415" width="163" height="49" rx="10" fill="#f7f7eb" />
          <circle cx="29" cy="433" r="4" fill="#58864a" />
          <text x="42" y="437" fill="#294b3c" fontWeight="bold">
            REAL COSTAR SITES
          </text>
          <text x="28" y="453" fill="#7a8577">
            Houston · ERCOT grid day · live meters
          </text>
          <rect x="418" y="94" width="152" height="53" rx="10" fill="#f7f7eb" />
          <text x="432" y="115" fill="#294b3c" fontWeight="bold">
            One site. Money, people, planet.
          </text>
          <text x="432" y="132" fill="#7a8577">
            Where → How to run → Prove it
          </text>
        </g>
      )}
    </svg>
  );
}
