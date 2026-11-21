/** Women in Transit: Safe Route score. Two routes for one trip, blind spots marked, a score from the
 *  config weights in data/women_transit_demo.json. Night mode weighs blind spots more. Demo data only. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Moon, Route, ShieldCheck, Sun, Users, HeartHandshake } from 'lucide-react';
import demo from '../data/women_transit_demo.json';
import { setMapTheme, useMapTheme } from '../components/map/mapTheme';

maplibregl.setWorkerUrl(workerUrl);

type Point = { type: string; lat: number; lng: number; label: string };
type RouteDef = { id: string; name: string; minutes: number; path: number[][]; points: Point[] };
const WEIGHTS = demo.weights as Record<string, number>;
const ROUTES = demo.routes as RouteDef[];
const STYLES = { day: 'https://tiles.openfreemap.org/styles/liberty', night: 'https://tiles.openfreemap.org/styles/dark' };
const NICE: Record<string, string> = {
  no_streetlight: 'No streetlight', no_cctv: 'No CCTV', closed_shops: 'Shops closed', liquor_shop: 'Liquor shop',
  isolated_stretch: 'Isolated stretch', cctv: 'CCTV', open_shop: 'Open shop', police_booth: 'Police booth', well_lit: 'Well lit',
};

/** 100 minus blind-spot weights (times the night multiplier at night), plus the safe-spot bonuses. */
export function routeScore(r: RouteDef, night: boolean): number {
  let penalty = 0, bonus = 0;
  for (const p of r.points) {
    const w = WEIGHTS[p.type] ?? 0;
    if (w > 0) penalty += night ? w * demo.night_multiplier : w;
    else bonus -= w;
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty + Math.min(bonus, demo.max_bonus))));
}
const band = (s: number) => (s >= 75 ? { t: 'Safer', c: '#188038' } : s >= 50 ? { t: 'Caution', c: '#b06000' } : { t: 'Avoid at night', c: '#d93025' });

const SafeRoutePage: React.FC = () => {
  const [theme] = useMapTheme();
  const night = theme === 'night';
  const [selected, setSelected] = useState('main');
  const scored = useMemo(() => ROUTES.map((r) => ({ ...r, score: routeScore(r, night) })).sort((a, b) => b.score - a.score), [night]);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);

  const draw = (m: maplibregl.Map) => {
    for (const r of ROUTES) {
      const id = `route-${r.id}`;
      if (m.getLayer(id)) m.removeLayer(id);
      if (m.getSource(id)) m.removeSource(id);
      m.addSource(id, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.path.map(([la, ln]) => [ln, la]) } } });
      const sc = routeScore(r, theme === 'night');
      m.addLayer({ id, type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': band(sc).c, 'line-width': r.id === selected ? 7 : 4, 'line-opacity': r.id === selected ? 0.95 : 0.45 } });
    }
  };

  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({ container: box.current, style: STYLES[theme], center: [77.2265, 28.6298], zoom: 14.6,
      dragRotate: false, pitchWithRotate: false, touchPitch: false, attributionControl: { compact: true } });
    m.touchZoomRotate.disableRotation();
    m.keyboard.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    for (const r of ROUTES) for (const p of r.points) {
      const bad = (WEIGHTS[p.type] ?? 0) > 0;
      const el = document.createElement('div');
      el.title = p.label;
      el.style.cssText = `width:18px;height:18px;border-radius:9999px;display:grid;place-items:center;font:700 11px system-ui;color:#fff;box-shadow:0 0 0 2px #fff,0 2px 6px rgba(0,0,0,.4);background:${bad ? '#d93025' : '#188038'}`;
      el.textContent = bad ? '!' : '✓';
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat])
        .setPopup(new maplibregl.Popup({ offset: 12, closeButton: false }).setText(`${NICE[p.type] || p.type}: ${p.label}`)).addTo(m));
    }
    map.current = m;
    return () => { markers.current = []; m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Day/night: swap tiles, then redraw the route lines (they live in the style).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const redraw = () => draw(m);
    m.once('style.load', redraw);
    m.setStyle(STYLES[theme], { diff: false });
    return () => { m.off('style.load', redraw); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    const m = map.current;
    if (m && m.isStyleLoaded()) draw(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-800 border border-amber-200">
            {demo.label}
          </div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold text-slate-900">Women in Transit · Safe Route score</h1>
          <p className="text-sm text-slate-600 mt-1">{demo.trip.from} → {demo.trip.to}. Two routes, blind spots marked, scored from transparent weights.</p>
        </div>
        <div className="inline-flex rounded-full border border-slate-300 bg-white p-1 text-xs font-semibold">
          <button onClick={() => setMapTheme('day')} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 ${!night ? 'bg-slate-900 text-white' : 'text-slate-600'}`}><Sun className="w-3.5 h-3.5" /> Day</button>
          <button onClick={() => setMapTheme('night')} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 ${night ? 'bg-slate-900 text-white' : 'text-slate-600'}`}><Moon className="w-3.5 h-3.5" /> Night</button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div ref={box} className="h-[60vh] min-h-[380px] rounded-3xl overflow-hidden border border-slate-200 shadow-sm" />

        <aside className="space-y-3">
          {scored.map((r, i) => {
            const b = band(r.score);
            const spots = r.points.filter((p) => (WEIGHTS[p.type] ?? 0) > 0);
            return (
              <button key={r.id} onClick={() => setSelected(r.id)}
                className={`w-full text-left rounded-3xl border bg-white p-4 shadow-sm ${selected === r.id ? 'border-slate-900' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Route className="w-4 h-4" /> {r.name}</span>
                  {i === 0 && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10.5px] font-bold text-white">Recommended</span>}
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-bold" style={{ color: b.c }}>{r.score}</span>
                  <span className="text-xs font-semibold" style={{ color: b.c }}>/ 100 · {b.t}</span>
                  <span className="ml-auto text-xs text-slate-500">{r.minutes} min walk</span>
                </div>
                <div className="mt-2 text-[11.5px] text-slate-600">
                  {spots.length ? <>Blind spots: {spots.map((p) => NICE[p.type]).join(', ')}</> : 'No blind spots reported.'}
                </div>
              </button>
            );
          })}
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-[11.5px] text-slate-600 space-y-1">
            <div className="font-semibold text-slate-800">How the score works</div>
            <div>Start at 100. Each blind spot subtracts its weight; CCTV, open shops, police booths and lighting add back (at most +{demo.max_bonus}). At night, blind spots count ×{demo.night_multiplier}.</div>
            <div className="text-slate-500">{demo.note}</div>
          </div>
        </aside>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {[{ icon: HeartHandshake, t: 'Check on me', d: 'Share a trip with loved ones; if you do not reach on time, NSIN checks in and can alert them.' },
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
