/** Marker look shared by both map engines (Google Maps and MapLibre), as plain HTML strings. */
import type { MapHazard, MapIncident, MapResponder } from '../../types';

export const PRIORITY_COLOR: Record<string, string> = {
  P1_CRITICAL: '#ea4335',
  P2_HIGH: '#fa7b17',
  P3_MODERATE: '#f9ab00',
  P4_ADVISORY: '#1a73e8',
};

export const SERVICE_EMOJI: Record<string, string> = {
  security: '🛡️',
  medical: '🩺',
  fire: '🚒',
  community_patrol: '🛵',
};

export function esc(text: unknown): string {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function nice(s: string): string {
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

export function etaText(seconds?: number | null): string {
  if (seconds == null) return '';
  if (seconds < 60) return seconds <= 5 ? 'arriving' : `${seconds}s away`;
  // Under 10 minutes, show seconds too, so the countdown is visibly ticking.
  if (seconds < 600) return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s away`;
  return `${Math.round(seconds / 60)} min away`;
}

export function incidentMarkerHtml(i: MapIncident, focused = false): string {
  const color = PRIORITY_COLOR[i.priority] || '#5f6368';
  const pulse = i.priority === 'P1_CRITICAL' || focused;
  const size = focused ? 22 : 16;
  return `<div class="nsin-pin" title="${esc(i.title)}" style="--c:${color};--s:${size}px">
    ${pulse ? '<span class="nsin-pin-pulse"></span>' : ''}
    <span class="nsin-pin-dot"></span>
    ${i.approximate ? '<span class="nsin-pin-approx"></span>' : ''}
  </div>`;
}

/** Straight-line distance in metres. */
export function metres(a: [number, number], b: [number, number]): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distance still to drive: from the unit's current position along the rest of its route. */
export function remainingMetres(r: MapResponder): number | null {
  if (!r.heading_to_incident_id || r.route.length < 2) return null;
  const here: [number, number] = [r.latitude, r.longitude];
  let best = 0, bestD = Infinity;
  r.route.forEach((p, i) => { const d = metres(here, p); if (d < bestD) { bestD = d; best = i; } });
  // Continue from the next route point unless we are already past the closest one.
  let next = best;
  if (best < r.route.length - 1 && metres(here, r.route[best + 1]) < metres(r.route[best], r.route[best + 1])) next = best + 1;
  let total = metres(here, r.route[next]);
  for (let i = next; i < r.route.length - 1; i++) total += metres(r.route[i], r.route[i + 1]);
  return total;
}

export function kmText(m: number | null): string {
  if (m == null) return '';
  return m < 1000 ? `${Math.max(0, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** ~30 km/h, the same city speed the server uses. */
export const ROAD_SPEED_MPS = 8.3;

/** One honest status for a responder. ETA is shown only while the unit is actually moving:
 *  a live GPS unit (ETA from the remaining distance at city speed) or a labelled simulated drive. */
export function unitStatus(r: MapResponder): { moving: boolean; simulated: boolean; badge: string; text: string } {
  const left = remainingMetres(r);
  const dist = kmText(left);
  if (!r.heading_to_incident_id) {
    return { moving: false, simulated: false, badge: '', text: r.is_available ? 'Available' : 'Off duty' };
  }
  if (r.source === 'simulated') {
    const eta = etaText(r.eta_seconds);
    return { moving: true, simulated: true, badge: `Simulated · ${eta}`,
      text: `Simulated responder (demo drive) · ${dist} to go · ${eta}` };
  }
  if (r.source === 'gps') {
    const eta = left != null ? etaText(Math.round(left / ROAD_SPEED_MPS)) : etaText(r.eta_seconds);
    return { moving: true, simulated: false, badge: `${eta} · ${dist}`, text: `Live GPS · ${dist} to go · ${eta}` };
  }
  return { moving: false, simulated: false, badge: '',
    text: `Assigned · not moving yet (no live GPS) · ${dist} away` };
}

export function responderMarkerHtml(r: MapResponder): string {
  const st = unitStatus(r);
  return `<div class="nsin-unit ${st.moving ? 'is-moving' : ''} ${st.simulated ? 'is-simulated' : ''}" title="${esc(r.label)}${st.simulated ? ' (simulated responder)' : ''}">
    <span class="nsin-unit-badge">${SERVICE_EMOJI[r.service_type] || '🛵'}</span>
    ${st.badge ? `<span class="nsin-unit-eta ${st.simulated ? 'is-sim' : ''}">${esc(st.badge)}</span>` : ''}
  </div>`;
}

export function hazardMarkerHtml(h: MapHazard): string {
  return `<div class="nsin-hazard" title="${esc(h.title)}"><span>!</span></div>`;
}

export function incidentPopupHtml(i: MapIncident, appBase: string): string {
  return `<div class="nsin-pop">
    <div class="nsin-pop-k" style="color:${PRIORITY_COLOR[i.priority] || '#5f6368'}">${esc(i.priority.replace('_', ' '))} · ${esc(nice(i.status))}</div>
    <div class="nsin-pop-t">${esc(i.title)}</div>
    <div class="nsin-pop-s">${esc(i.location_address || '')}${i.approximate ? ' (approximate area)' : ''}</div>
    <a class="nsin-pop-a" href="${esc(appBase)}incidents/${i.id}">Open ${esc(i.reference_code)} →</a>
  </div>`;
}

export function responderPopupHtml(r: MapResponder): string {
  const src = r.source === 'gps' ? 'Live GPS' : r.source === 'simulated' ? 'Simulated responder' : 'At base';
  return `<div class="nsin-pop">
    <div class="nsin-pop-k" style="color:#188038">${esc(nice(r.service_type))} · ${esc(src)}</div>
    <div class="nsin-pop-t">${esc(r.label)}</div>
    <div class="nsin-pop-s">${esc(unitStatus(r).text)}</div>
  </div>`;
}

export function hazardPopupHtml(h: MapHazard): string {
  return `<div class="nsin-pop">
    <div class="nsin-pop-k" style="color:#b06000">Hazard · ${esc(nice(h.severity))}</div>
    <div class="nsin-pop-t">${esc(h.title)}</div>
    <div class="nsin-pop-s">${esc(h.address || '')}</div>
  </div>`;
}
