/** Free, key-less engine: MapLibre GL + OpenFreeMap vector tiles, tilted with 3D buildings.
 *  Used when no Google Maps key is configured (local development, or as a fallback). */
import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre v6 finds its worker next to its own module, which Vite does not copy. Ship it as an asset.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { LiveMapProps } from './types';
import { LUCKNOW } from './types';
import {
  hazardMarkerHtml, hazardPopupHtml, incidentMarkerHtml, incidentPopupHtml,
  responderMarkerHtml, responderPopupHtml,
} from './markers';

const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const APP_BASE = import.meta.env.BASE_URL;
maplibregl.setWorkerUrl(workerUrl);

type Entry = { marker: maplibregl.Marker; html: string; anim?: number };

function animateTo(entry: Entry, lng: number, lat: number) {
  const from = entry.marker.getLngLat();
  if (Math.abs(from.lng - lng) < 1e-7 && Math.abs(from.lat - lat) < 1e-7) return;
  if (entry.anim) cancelAnimationFrame(entry.anim);
  const start = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - start) / 1200);
    const e = k * (2 - k);
    entry.marker.setLngLat([from.lng + (lng - from.lng) * e, from.lat + (lat - from.lat) * e]);
    if (k < 1) entry.anim = requestAnimationFrame(step);
  };
  entry.anim = requestAnimationFrame(step);
}

export default function MapLibreMap({ data, focusIncidentId, pick, onPick, center, className, interactive3d = true }: LiveMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const entries = useRef(new Map<string, Entry>());
  const pickMarker = useRef<maplibregl.Marker | null>(null);
  const onPickRef = useRef(onPick);
  const ready = useRef(false);
  const focused = useRef<number | null>(null);
  const pending = useRef<(() => void) | null>(null);
  onPickRef.current = onPick;

  // Create the map once.
  useEffect(() => {
    if (!box.current) return;
    const c = center || data?.center || LUCKNOW;
    const m = new maplibregl.Map({
      container: box.current,
      style: STYLE,
      center: [c[1], c[0]],
      zoom: 13.2,
      pitch: interactive3d ? 55 : 0,
      bearing: interactive3d ? -17 : 0,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    m.on('load', () => {
      ready.current = true;
      m.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'routes-casing', type: 'line', source: 'routes',
        paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      m.addLayer({ id: 'routes', type: 'line', source: 'routes',
        paint: { 'line-color': '#1a73e8', 'line-width': 4, 'line-dasharray': [1.5, 1.2] }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      pending.current?.();
      pending.current = null;
    });
    m.on('click', (e: maplibregl.MapMouseEvent) => onPickRef.current?.(e.lngLat.lat, e.lngLat.lng));
    map.current = m;
    return () => {
      entries.current.forEach((en) => en.anim && cancelAnimationFrame(en.anim));
      entries.current.clear();
      m.remove();
      map.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync markers and routes with the latest poll.
  useEffect(() => {
    const m = map.current;
    if (!m || !data) return;
    const apply = () => {
      const seen = new Set<string>();
      const upsert = (key: string, lng: number, lat: number, html: string, popup: string, z: number) => {
        seen.add(key);
        let en = entries.current.get(key);
        if (!en) {
          const el = document.createElement('div');
          el.innerHTML = html;
          el.style.zIndex = String(z);
          const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat])
            .setPopup(new maplibregl.Popup({ offset: 14, closeButton: false, maxWidth: '260px' }).setHTML(popup)).addTo(m);
          en = { marker, html };
          entries.current.set(key, en);
        } else {
          if (en.html !== html) { en.marker.getElement().innerHTML = html; en.html = html; }
          en.marker.getPopup()?.setHTML(popup);
          animateTo(en, lng, lat);
        }
      };
      data.hazards.forEach((h) => upsert(`h${h.id}`, h.longitude, h.latitude, hazardMarkerHtml(h), hazardPopupHtml(h), 1));
      data.incidents.forEach((i) => upsert(`i${i.id}`, i.longitude, i.latitude,
        incidentMarkerHtml(i, i.id === focusIncidentId), incidentPopupHtml(i, APP_BASE), i.id === focusIncidentId ? 3 : 2));
      data.responders.forEach((r) => upsert(`r${r.user_id}`, r.longitude, r.latitude, responderMarkerHtml(r), responderPopupHtml(r), 4));
      entries.current.forEach((en, key) => {
        if (!seen.has(key)) { en.marker.remove(); entries.current.delete(key); }
      });

      const routes = data.responders.filter((r) => r.heading_to_incident_id && r.route.length > 1 &&
        (focusIncidentId == null || r.heading_to_incident_id === focusIncidentId));
      (m.getSource('routes') as maplibregl.GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: routes.map((r) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.route.map(([la, ln]) => [ln, la]) } })),
      });

      if (focusIncidentId != null && focused.current !== focusIncidentId) {
        const inc = data.incidents.find((i) => i.id === focusIncidentId);
        if (inc) {
          focused.current = focusIncidentId;
          m.flyTo({ center: [inc.longitude, inc.latitude], zoom: 15.5, pitch: interactive3d ? 60 : 0, duration: 1600 });
        }
      }
    };
    if (ready.current) apply(); else pending.current = apply;
  }, [data, focusIncidentId, interactive3d]);

  // The pin the user places on the report page.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!pick) { pickMarker.current?.remove(); pickMarker.current = null; return; }
    if (!pickMarker.current) {
      pickMarker.current = new maplibregl.Marker({ color: '#ea4335', draggable: true }).setLngLat([pick.lng, pick.lat]).addTo(m);
      pickMarker.current.on('dragend', () => {
        const p = pickMarker.current!.getLngLat();
        onPickRef.current?.(p.lat, p.lng);
      });
      m.flyTo({ center: [pick.lng, pick.lat], zoom: 16, duration: 1000 });
    } else {
      pickMarker.current.setLngLat([pick.lng, pick.lat]);
    }
  }, [pick]);

  return <div ref={box} className={className} />;
}
