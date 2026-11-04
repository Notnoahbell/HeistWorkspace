// Dates for hover details: "Nov 4, 2026 at 1:22 PM", and "Noah Bell • Nov 4, 2026 at 1:22 PM".

export function fullDate(ms: number): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} at ${time}`;
}

/** "Who • when", either part optional. */
export function byLine(name: string | null | undefined, ms: number | null | undefined): string {
  return [name, ms ? fullDate(ms) : null].filter(Boolean).join(' • ');
}
