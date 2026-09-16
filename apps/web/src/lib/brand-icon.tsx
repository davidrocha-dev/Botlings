/** Brand mark rendered with next/og (no CSS classes, inline styles only). */
export function BrandIcon({ size, padded = false }: { size: number; padded?: boolean }) {
  const body = padded ? size * 0.56 : size * 0.72;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(145deg, #1c1830 0%, #0b0b10 100%)",
        borderRadius: padded ? 0 : size * 0.22,
      }}
    >
      <svg width={body} height={body} viewBox="0 0 100 100">
        <defs>
          <linearGradient id="g" x1="0.15" y1="0" x2="0.85" y2="1">
            <stop offset="0" stopColor="#a497ff" />
            <stop offset="1" stopColor="#5b45f5" />
          </linearGradient>
        </defs>
        <path d="M52 8 C74 8 92 24 91 48 C90 70 80 92 52 93 C26 94 9 76 9 52 C9 26 28 8 52 8Z" fill="url(#g)" />
        <path d="M32 50 Q38 42 44 50" stroke="#16112e" strokeWidth="4" strokeLinecap="round" fill="none" />
        <path d="M56 50 Q62 42 68 50" stroke="#16112e" strokeWidth="4" strokeLinecap="round" fill="none" />
        <path d="M39 61 Q50 74 61 61" stroke="#16112e" strokeWidth="4" strokeLinecap="round" fill="none" />
      </svg>
    </div>
  );
}
