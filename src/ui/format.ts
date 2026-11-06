const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a < 1000) return a < 10 && a % 1 !== 0 ? n.toFixed(1) : Math.floor(n).toString();
  const tier = Math.floor(Math.log10(a) / 3);
  if (tier >= SUFFIXES.length) return n.toExponential(2).replace('e+', 'e');
  const scaled = n / 1000 ** tier;
  return `${scaled.toFixed(scaled < 100 ? 2 : 1)}${SUFFIXES[tier]}`;
}

export function fmtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
