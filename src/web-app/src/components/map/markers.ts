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

export function responderMarkerHtml(r: MapResponder): string {
  const moving = r.source !== 'base' && r.heading_to_incident_id;
  return `<div class="nsin-unit ${moving ? 'is-moving' : ''}" title="${esc(r.label)}">
    <span class="nsin-unit-badge">${SERVICE_EMOJI[r.service_type] || '🛵'}</span>
    ${moving ? `<span class="nsin-unit-eta">${esc(etaText(r.eta_seconds))}</span>` : ''}
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
  const src = r.source === 'gps' ? 'Live GPS' : r.source === 'simulated' ? 'Live (demo drive)' : 'At base';
  return `<div class="nsin-pop">
    <div class="nsin-pop-k" style="color:#188038">${esc(nice(r.service_type))} · ${esc(src)}</div>
    <div class="nsin-pop-t">${esc(r.label)}</div>
    <div class="nsin-pop-s">${r.heading_to_incident_id ? `En route · ${esc(etaText(r.eta_seconds))}` : r.is_available ? 'Available' : 'Off duty'}</div>
  </div>`;
}

export function hazardPopupHtml(h: MapHazard): string {
  return `<div class="nsin-pop">
    <div class="nsin-pop-k" style="color:#b06000">Hazard · ${esc(nice(h.severity))}</div>
    <div class="nsin-pop-t">${esc(h.title)}</div>
    <div class="nsin-pop-s">${esc(h.address || '')}</div>
  </div>`;
}
