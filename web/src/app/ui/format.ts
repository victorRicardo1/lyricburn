/** Formatação compartilhada — os mesmos formatos que a CLI imprime. */

/** 146.5 -> "2:26.50" (igual ao summary do plan.py). */
export function mmss(t: number): string {
  const safe = Math.max(0, t || 0);
  const m = Math.floor(safe / 60);
  return m + ':' + (safe - m * 60).toFixed(2).padStart(5, '0');
}

/** O inverso, igual ao parse_time do config.py: 146, "146", "2:26", "2:26.5", "1:02:26". */
export function parseTime(v: string | number | null | undefined): number {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim();
  if (!s) return 0;
  let total = 0;
  for (const part of s.split(':')) {
    const n = Number(part);
    if (!Number.isFinite(n)) return NaN;
    total = total * 60 + n;
  }
  return total;
}

/** 146.5 -> "2:26" (pros eixos da timeline). */
export function mmssShort(t: number): string {
  const safe = Math.max(0, t || 0);
  const m = Math.floor(safe / 60);
  return m + ':' + String(Math.floor(safe - m * 60)).padStart(2, '0');
}

/** Um .lrc tem 2 KB: mostrar "0.0 MB" não ajuda ninguém. */
export function fileSize(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1e6) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1e6).toFixed(1) + ' MB';
}

/** style.position aceita center/bottom/top ou 0–1; o slider trabalha sempre em número. */
export const NAMED_POSITIONS: Record<string, number> = {
  top: 0.14,
  center: 0.5,
  middle: 0.5,
  bottom: 0.86,
};

export function positionToNumber(position: string | number): number {
  if (typeof position === 'number') return position;
  return NAMED_POSITIONS[String(position).toLowerCase()] ?? 0.5;
}

export function positionLabel(position: string | number): string {
  if (typeof position === 'string') return position === 'middle' ? 'centro' : translate(position);
  const match = Object.entries(NAMED_POSITIONS).find(([, v]) => Math.abs(v - position) < 0.005);
  return match ? translate(match[0]) : position.toFixed(2);
}

function translate(name: string): string {
  return { top: 'topo', center: 'centro', middle: 'centro', bottom: 'base' }[name] ?? name;
}
