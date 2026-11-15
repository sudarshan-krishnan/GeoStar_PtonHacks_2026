import Link from 'next/link';
export function Star({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path
        d="M20 1L24.8 15.2L39 20L24.8 24.8L20 39L15.2 24.8L1 20L15.2 15.2L20 1Z"
        fill="currentColor"
      />
      <path
        d="M20 10L22.5 17.5L30 20L22.5 22.5L20 30L17.5 22.5L10 20L17.5 17.5L20 10Z"
        fill="var(--brand-center,#121a18)"
      />
    </svg>
  );
}
export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className={`brand ${light ? 'brand-light' : ''}`} aria-label="PlotStar home">
      <Star />
      <span>
        plotstar<span className="brand-dot">.</span>
      </span>
    </Link>
  );
}
