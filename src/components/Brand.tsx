// The Fleet Ledger mark and the truck artwork used on the sign-in screen.
// Both are inline SVG using theme tokens, so they follow the colours in index.css.

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="sidebar-brand-mark" width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Fleet Ledger">
      <rect width="32" height="32" rx="7" fill="var(--color-primary)" />
      {/* an italic F with two speed lines: a ledger letter that is already moving */}
      <g fill="#fff">
        <rect x="3.5" y="12" width="5.5" height="2" rx="1" opacity="0.7" />
        <rect x="5.5" y="17" width="3.5" height="2" rx="1" opacity="0.7" />
        <g transform="translate(3.3 0) skewX(-12)">
          <rect x="12" y="8" width="4.2" height="17" rx="1" />
          <rect x="12" y="8" width="12.5" height="4.2" rx="1" />
          <rect x="12" y="14.8" width="9" height="3.8" rx="1" />
        </g>
      </g>
    </svg>
  );
}

export function TruckArt() {
  return (
    <svg className="sign-in-truck" viewBox="0 0 440 150" role="img" aria-label="A freight truck on the road">
      {/* speed lines */}
      <g stroke="#fff" strokeOpacity="0.28" strokeWidth="3" strokeLinecap="round">
        <line x1="6" y1="52" x2="40" y2="52" />
        <line x1="0" y1="70" x2="30" y2="70" />
        <line x1="14" y1="88" x2="42" y2="88" />
      </g>
      {/* trailer */}
      <rect x="56" y="22" width="238" height="82" rx="5" fill="var(--color-primary)" />
      <rect x="56" y="82" width="238" height="6" fill="#fff" fillOpacity="0.9" />
      <text x="76" y="64" fill="#fff" fontFamily="var(--font-display)" fontWeight="900" fontSize="22" letterSpacing="3">FLEET LEDGER</text>
      {/* chassis */}
      <rect x="56" y="104" width="318" height="9" rx="2" fill="#0F1720" />
      {/* cab */}
      <path d="M302 104V46q0-6 6-6h40q9 0 14 8l20 33q5 7 5 14v9z" fill="#fff" />
      <path d="M316 50h30q4 0 7 5l15 25h-52z" fill="#17212B" fillOpacity="0.88" />
      <rect x="364" y="94" width="14" height="6" rx="2" fill="#FFD166" />
      {/* wheels */}
      {[100, 140, 330, 366].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="116" r="16" fill="#0F1720" stroke="#fff" strokeOpacity="0.35" strokeWidth="2" />
          <circle cx={cx} cy="116" r="6" fill="#AEB5BC" />
        </g>
      ))}
    </svg>
  );
}
