/** Human-readable labels for the API's enum values (never show raw codes like "P1_CRITICAL"). */

const PRIORITY: Record<string, { short: string; label: string; tone: string }> = {
  P1_CRITICAL: { short: 'P1', label: 'Critical', tone: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
  P2_HIGH: { short: 'P2', label: 'High', tone: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200' },
  P3_MODERATE: { short: 'P3', label: 'Moderate', tone: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200' },
  P4_ADVISORY: { short: 'P4', label: 'Advisory', tone: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200' },
};

export function priorityInfo(p?: string | null) {
  return PRIORITY[p ?? ''] ?? { short: '–', label: p ? nice(p) : 'Not set', tone: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200' };
}

/** "P1 · Critical" */
export function priorityLabel(p?: string | null) {
  const i = priorityInfo(p);
  return i.short === '–' ? i.label : `${i.short} · ${i.label}`;
}

const STATUS_TONE: Record<string, string> = {
  reported: 'bg-red-50 text-red-700',
  acknowledged: 'bg-amber-50 text-amber-800',
  responder_en_route: 'bg-brand-50 text-brand-700',
  en_route: 'bg-brand-50 text-brand-700',
  on_scene: 'bg-violet-50 text-violet-700',
  resolved: 'bg-green-50 text-green-700',
  closed: 'bg-slate-100 text-slate-600',
  false_alarm: 'bg-slate-100 text-slate-600',
};

export function statusTone(s?: string | null) {
  return STATUS_TONE[(s ?? '').toLowerCase()] ?? 'bg-slate-100 text-slate-700';
}

/** "responder_en_route" → "Responder en route" */
export function nice(v?: string | null) {
  if (!v) return '';
  const t = v.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
