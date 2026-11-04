// Section glyph: a tall column with cards stacked inside (after Milanote's
// column icon), drawn to match lucide's stroke style so it sits with the rest.

export function SectionIcon({ size = 18, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} aria-hidden="true">
      <rect x="4" y="2" width="16" height="20" rx="1.5" />
      <rect x="7" y="5" width="10" height="3.5" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="7" y="10.25" width="10" height="3.5" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="7" y="15.5" width="10" height="3.5" rx="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
