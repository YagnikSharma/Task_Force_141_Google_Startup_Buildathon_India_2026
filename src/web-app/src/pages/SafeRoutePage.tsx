/** Women in Transit: Safe Route score (demo, synthetic data). For one trip, two routes are scored from
 *  config weights in data/women_transit_demo.json:
 *  - blind spots (no streetlight, no CCTV, liquor shop, isolated stretch), weighted more at night;
 *  - places that are OPEN at the chosen time (a closed shop doesn't help);
 *  - the longest "dark gap" along the route with nothing open, weighted by travel mode.
 *  NSIN shows the trade-off; the traveller decides. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Bike, Footprints, HeartHandshake, Route, ShieldCheck, Users } from 'lucide-react';
import demo from '../data/women_transit_demo.json';
import { setMapTheme } from '../components/map/mapTheme';

maplibregl.setWorkerUrl(workerUrl);

type Blind = { type: string; lat: number; lng: number; label: string };
type Place = Blind & { open: number; close: number };
type RouteDef = { id: string; name: string; minutes: Record<string, number>; path: number[][]; blind: Blind[]; places: Place[] };
type Mode = keyof typeof demo.modes;
const ROUTES = demo.routes as RouteDef[];
const BLIND_W = demo.weights as Record<string, number>;
const PLACE_W = demo.place_weights as Record<string, number>;
const STYLES = { day: 'https://tiles.openfreemap.org/styles/liberty', night: 'https://tiles.openfreemap.org/styles/dark' };
const NICE: Record<string, string> = {
  no_streetlight: 'No streetlight', no_cctv: 'No CCTV', liquor_shop: 'Liquor shop', isolated_stretch: 'Isolated stretch',
  shop: 'Shop', pharmacy: 'Chemist', hospital: 'Hospital', petrol_pump: 'Petrol pump', transport: 'Transport', police_booth: 'Police booth', cctv: 'CCTV',
};
const PIN: Record<string, string> = { shop: '#1a73e8', pharmacy: '#188038', hospital: '#188038', petrol_pump: '#f9ab00', transport: '#9334e6', police_booth: '#174ea6', cctv: '#5f6368' };

const isNight = (h: number) => h % 24 >= 19 || h % 24 < 6;
const isOpen = (p: Place, h: number) => (h >= p.open && h < p.close) || (h + 24 >= p.open && h + 24 < p.close);

// Metres along a path for a point (projection onto the nearest segment; a flat-earth approximation is fine here).
function along(path: number[][], lat: number, lng: number) {
  const k = 111320, kx = k * Math.cos((lat * Math.PI) / 180);
  let best = Infinity, at = 0, run = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [ay, ax] = path[i], [by, bx] = path[i + 1];
    const dx = (bx - ax) * kx, dy = (by - ay) * k, len = Math.hypot(dx, dy);
    const t = Math.max(0, Math.min(1, (((lng - ax) * kx) * dx + ((lat - ay) * k) * dy) / (len * len || 1)));
    const d = Math.hypot((lng - ax) * kx - t * dx, (lat - ay) * k - t * dy);
    if (d < best) { best = d; at = run + t * len; }
    run += len;
  }
  return { at, total: run };
}

export function scoreRoute(r: RouteDef, hour: number, mode: Mode) {
  const night = isNight(hour);
  const open = r.places.filter((p) => isOpen(p, hour));
  const penalty = r.blind.reduce((s, b) => s + (BLIND_W[b.type] ?? 0) * (night ? demo.night_multiplier : 1), 0);
  const bonus = Math.min(demo.max_bonus, open.reduce((s, p) => s + (PLACE_W[p.type] ?? 0), 0));
  const total = along(r.path, r.path[0][0], r.path[0][1]).total;
  const marks = [0, total, ...open.map((p) => along(r.path, p.lat, p.lng).at)].sort((a, b) => a - b);
  const gap = Math.round(marks.slice(1).reduce((m, v, i) => Math.max(m, v - marks[i]), 0));
  const gapPenalty = night ? (Math.max(0, gap - 150) / 100) * demo.modes[mode].gap_per_100m : 0;
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty - gapPenalty + bonus)));
  return { score, open, gap, night };
}
const band = (s: number) => (s >= 75 ? { t: 'Safer', c: '#188038' } : s >= 50 ? { t: 'Caution', c: '#b06000' } : { t: 'Avoid at this hour', c: '#d93025' });

const SafeRoutePage: React.FC = () => {
  const [hour, setHour] = useState(23);
  const [mode, setMode] = useState<Mode>('walk');
  const [selected, setSelected] = useState('main');
  const night = isNight(hour);
  const scored = useMemo(() => ROUTES.map((r) => ({ r, ...scoreRoute(r, hour, mode) })).sort((a, b) => b.score - a.score), [hour, mode]);
  const best = scored[0], other = scored[1];
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);

  useEffect(() => { setMapTheme(night ? 'night' : 'day'); }, [night]);

  const drawRoutes = (m: maplibregl.Map) => {
    for (const { r, score } of scored) {
      const id = `route-${r.id}`;
      if (m.getLayer(id)) m.removeLayer(id);
      if (m.getSource(id)) m.removeSource(id);
      m.addSource(id, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.path.map(([la, ln]) => [ln, la]) } } });
      m.addLayer({ id, type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': band(score).c, 'line-width': r.id === selected ? 7 : 4, 'line-opacity': r.id === selected ? 0.95 : 0.45 } });
    }
  };
  const drawPins = (m: maplibregl.Map) => {
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    const pin = (lng: number, lat: number, bg: string, text: string, title: string, dim = false) => {
      const el = document.createElement('div');  // MapLibre owns the outer element's opacity, so style an inner dot
      el.title = title;
      const dot = document.createElement('div');
      dot.style.cssText = `width:18px;height:18px;border-radius:9999px;display:grid;place-items:center;font:700 10px system-ui;color:#fff;box-shadow:0 0 0 2px #fff,0 2px 6px rgba(0,0,0,.4);background:${bg};opacity:${dim ? 0.3 : 1}`;
      dot.textContent = text;
      el.appendChild(dot);
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat([lng, lat])
        .setPopup(new maplibregl.Popup({ offset: 12, closeButton: false }).setText(title)).addTo(m));
    };
    for (const r of ROUTES) {
      r.blind.forEach((b) => pin(b.lng, b.lat, '#d93025', '!', `${NICE[b.type]}: ${b.label}`));
      r.places.forEach((p) => { const o = isOpen(p, hour); pin(p.lng, p.lat, PIN[p.type] || '#188038', '✓', `${NICE[p.type]}: ${p.label} (${o ? 'open now' : 'closed at this hour'})`, !o); });
    }
  };

  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({ container: box.current, style: STYLES[night ? 'night' : 'day'], center: [77.2265, 28.6298], zoom: 14.6,
      dragRotate: false, pitchWithRotate: false, touchPitch: false, attributionControl: { compact: true } });
    m.touchZoomRotate.disableRotation();
    m.keyboard.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.current = m;
    return () => { markers.current = []; m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tiles follow day/night; routes live in the style, so redraw them after each style load.
  const styleKey = night ? 'night' : 'day';
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const redraw = () => drawRoutes(m);
    m.once('style.load', redraw);
    m.setStyle(STYLES[styleKey], { diff: false });
    return () => { m.off('style.load', redraw); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleKey]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    drawPins(m);
    if (m.isStyleLoaded()) drawRoutes(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scored, selected]);

  const extra = best.r.minutes[mode] - other.r.minutes[mode];
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-800 border border-amber-200">{demo.label}</div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold text-slate-900">Women in Transit · Safe Route score</h1>
          <p className="text-sm text-slate-600 mt-1">{demo.trip.from} → {demo.trip.to}. Not the fastest route: the safest one for the hour you travel.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-full border border-slate-300 bg-white p-1 text-xs font-semibold" role="group" aria-label="Time of travel">
            {demo.times.map((t) => (
              <button key={t.hour} onClick={() => setHour(t.hour)} className={`rounded-full px-3 py-1.5 ${hour === t.hour ? 'bg-brand-500 text-white' : 'text-slate-600'}`}>{t.label}</button>
            ))}
          </div>
          <div className="inline-flex rounded-full border border-slate-300 bg-white p-1 text-xs font-semibold" role="group" aria-label="Travel mode">
            <button onClick={() => setMode('walk')} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 ${mode === 'walk' ? 'bg-brand-500 text-white' : 'text-slate-600'}`}><Footprints className="w-3.5 h-3.5" /> Walk</button>
            <button onClick={() => setMode('ride')} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 ${mode === 'ride' ? 'bg-brand-500 text-white' : 'text-slate-600'}`}><Bike className="w-3.5 h-3.5" /> Two-wheeler</button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
        <strong style={{ color: band(best.score).c }}>{best.r.name}</strong> scores {best.score} vs {other.score}
        {extra > 0 ? `, takes ${extra} min longer` : extra < 0 ? `, and is ${-extra} min faster` : ''}, passes {best.open.length} open places
        (vs {other.open.length}), longest dark gap {best.gap} m (vs {other.gap} m). NSIN shows the trade-off; you choose.
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div ref={box} className="h-[60vh] min-h-[380px] rounded-3xl overflow-hidden border border-slate-200 shadow-sm" />
        <aside className="space-y-3">
          {scored.map(({ r, score, open, gap }, i) => {
            const b = band(score);
            return (
              <button key={r.id} onClick={() => setSelected(r.id)}
                className={`w-full text-left rounded-3xl border bg-white p-4 shadow-sm ${selected === r.id ? 'border-slate-900' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Route className="w-4 h-4" /> {r.name}</span>
                  {i === 0 && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10.5px] font-bold text-white">Recommended</span>}
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-bold" style={{ color: b.c }}>{score}</span>
                  <span className="text-xs font-semibold" style={{ color: b.c }}>/ 100 · {b.t}</span>
                  <span className="ml-auto text-xs text-slate-500">{r.minutes[mode]} min · {demo.modes[mode].label}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11.5px]">
                  <div className="rounded-xl bg-slate-50 px-2 py-1.5"><div className="text-slate-500">Open at this hour</div><div className="font-semibold text-slate-900">{open.length} of {r.places.length} places</div></div>
                  <div className="rounded-xl bg-slate-50 px-2 py-1.5"><div className="text-slate-500">Longest dark gap</div><div className="font-semibold text-slate-900">{gap} m</div></div>
                </div>
                <div className="mt-2 text-[11.5px] text-slate-600">{r.blind.length ? <>Blind spots: {r.blind.map((p) => NICE[p.type]).join(', ')}</> : 'No blind spots reported.'}</div>
              </button>
            );
          })}
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-[11.5px] text-slate-600 space-y-1">
            <div className="font-semibold text-slate-800">How the score works</div>
            <div>Start at 100. Blind spots subtract their weight (×{demo.night_multiplier} at night). Places count only if they are open when you pass (up to +{demo.max_bonus}). At night, every 100 m of dark gap beyond 150 m costs points, more when walking.</div>
            <div className="text-slate-500">{demo.note}</div>
          </div>
        </aside>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {[{ icon: HeartHandshake, t: 'Check on me', d: 'Share a trip with loved ones; if you do not arrive on time, NSIN checks in and can alert them.' },
          { icon: Users, t: 'Women-only locality circle', d: 'Verified women in your locality, identities masked, to flag unsafe stretches and walk together.' }].map(({ icon: I, t, d }) => (
          <div key={t} className="rounded-3xl border border-dashed border-slate-300 bg-white p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-semibold text-slate-900"><I className="w-4 h-4" /> {t}</span>
              <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-[10.5px] font-bold uppercase text-slate-700">Planned</span>
            </div>
            <p className="mt-2 text-xs text-slate-600">{d}</p>
          </div>
        ))}
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><ShieldCheck className="w-3.5 h-3.5" /> Privacy first: no face recognition.</p>
    </div>
  );
};
export default SafeRoutePage;
