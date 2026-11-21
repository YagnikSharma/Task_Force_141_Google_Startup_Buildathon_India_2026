import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, Navigation, Radio, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { LiveMap, MAP_ENGINE, useLiveMap } from '../components/map/LiveMap';
import { PRIORITY_COLOR, SERVICE_EMOJI, etaText, kmText, nice, remainingMetres, unitStatus } from '../components/map/markers';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';

export const LiveMapPage: React.FC = () => {
  const { user } = useAuth();
  const staff = user?.role === 'responder' || user?.role === 'admin';
  const { data, error, updatedAt, refresh, synthetic } = useLiveMap(4000, !!user);
  const [focus, setFocus] = useState<number | undefined>();
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const enRoute = useMemo(() => (data?.responders || []).filter((r) => r.heading_to_incident_id), [data]);
  const titleOf = (id?: number | null) => data?.incidents.find((i) => i.id === id)?.title ?? `Incident #${id}`;

  const dispatch = async (id: number) => {
    setBusy(id); setMsg(null);
    try {
      const unit = await api.demoDispatch(id);
      setMsg(`Simulated responder ${unit.label} dispatched (demo drive, ${kmText(remainingMetres(unit))}). Watch it drive on the map: ${etaText(unit.eta_seconds)}.`);
      setFocus(id);
      await refresh();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (!user) {
    return (
      <div className="max-w-xl mx-auto px-4 py-24 text-center space-y-4">
        <h1 className="text-2xl font-semibold text-slate-900">Live community map</h1>
        <p className="text-slate-600 text-sm">Sign in to see live alerts and responders in your neighbourhood.</p>
        <Link to="/auth?mode=login" className="inline-flex px-5 py-2.5 rounded-full bg-[#1a73e8] text-white text-sm font-semibold">Sign in</Link>
      </div>
    );
  }

  return (
    <div className="max-w-[1500px] mx-auto px-3 sm:px-6 py-5 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#188038]">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#34a853] opacity-60 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#34a853]" />
            </span>
            Live · {data?.city || 'New Delhi'}
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">Community safety map</h1>
          {synthetic && (
            <div className="mt-2 inline-flex rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
              Synthetic demo data · the live feed is unreachable right now
            </div>
          )}
          <p className="text-sm text-slate-500">
            Open alerts, hazards and responders on the move. Updates every 4 seconds.
            {!staff && ' Other residents’ alerts are shown as approximate areas to protect their privacy.'}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="hidden sm:inline">{MAP_ENGINE === 'google' ? 'Google Maps · 3D' : 'Open map · 3D buildings'}</span>
          <button onClick={refresh} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">
            <RefreshCw className="w-3.5 h-3.5" /> {updatedAt ? updatedAt.toLocaleTimeString() : '…'}
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {msg && <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <LiveMap data={data} focusIncidentId={focus} className="h-[62vh] lg:h-[76vh] w-full" />
          <div className="pointer-events-none absolute left-3 bottom-3 flex flex-wrap gap-1.5 text-[11px]">
            {[['P1', PRIORITY_COLOR.P1_CRITICAL], ['P2', PRIORITY_COLOR.P2_HIGH], ['P3', PRIORITY_COLOR.P3_MODERATE], ['P4', PRIORITY_COLOR.P4_ADVISORY]].map(([k, c]) => (
              <span key={k} className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 shadow font-semibold text-slate-700">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} /> {k}
              </span>
            ))}
            <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 shadow font-semibold text-slate-700">🛡️ Responder</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 shadow font-semibold text-slate-700">⚠️ Hazard</span>
          </div>
        </div>

        <aside className="space-y-4 lg:max-h-[76vh] lg:overflow-y-auto pr-0.5">
          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Navigation className="w-4 h-4 text-[#1a73e8]" /> En route now</h2>
            {enRoute.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">No responder is on the move.{staff && ' Dispatch one from an alert below.'}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {enRoute.map((r) => (
                  <li key={r.user_id}>
                    <button onClick={() => setFocus(r.heading_to_incident_id ?? undefined)} className="w-full text-left rounded-2xl border border-blue-100 bg-blue-50/60 px-3 py-2 hover:bg-blue-50">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-900">{SERVICE_EMOJI[r.service_type] || '🛵'} {r.label}</span>
                        {unitStatus(r).badge && (
                          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold text-white ${unitStatus(r).simulated ? 'bg-slate-500' : 'bg-[#1a73e8]'}`}>{unitStatus(r).badge}</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-slate-600 truncate">→ {titleOf(r.heading_to_incident_id)}</div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-blue-100 overflow-hidden">
                        <div className="h-full bg-[#1a73e8] transition-all duration-1000" style={{ width: `${Math.round((r.progress ?? 0.1) * 100)}%` }} />
                      </div>
                      <div className="mt-1 text-[10.5px] text-slate-500">{unitStatus(r).text}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Activity className="w-4 h-4 text-[#ea4335]" /> Open alerts ({data?.incidents.length ?? 0})</h2>
            <ul className="mt-3 space-y-2">
              {(data?.incidents || []).map((i) => (
                <li key={i.id} className={`rounded-2xl border px-3 py-2 ${focus === i.id ? 'border-slate-900' : 'border-slate-200'}`}>
                  <button className="w-full text-left" onClick={() => setFocus(i.id)}>
                    <div className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-wide" style={{ color: PRIORITY_COLOR[i.priority] }}>
                      <span className="h-2 w-2 rounded-full" style={{ background: PRIORITY_COLOR[i.priority] }} />
                      {i.priority.replace('_', ' ')} · {nice(i.status)}
                      {i.mine && <span className="ml-auto rounded-full bg-slate-900 px-1.5 py-0.5 text-[9.5px] text-white">yours</span>}
                    </div>
                    <div className="mt-0.5 text-[13px] font-semibold text-slate-900 leading-snug">{i.title}</div>
                    <div className="text-[11.5px] text-slate-500 truncate">{i.location_address}{i.approximate ? ' · approx.' : ''}</div>
                  </button>
                  <div className="mt-2 flex gap-2">
                    <Link to={`/incidents/${i.id}`} className="text-[11.5px] font-semibold text-[#1a73e8]">Details</Link>
                    {staff && data?.demo_mode && !enRoute.some((r) => r.heading_to_incident_id === i.id) && (
                      <button onClick={() => dispatch(i.id)} disabled={busy === i.id}
                        className="ml-auto inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50">
                        <Send className="w-3 h-3" /> {busy === i.id ? 'Dispatching…' : 'Dispatch (demo)'}
                      </button>
                    )}
                  </div>
                </li>
              ))}
              {data && data.incidents.length === 0 && <li className="text-xs text-slate-500">No open alerts. All quiet.</li>}
            </ul>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><AlertTriangle className="w-4 h-4 text-[#f9ab00]" /> Hazards ({data?.hazards.length ?? 0})</h2>
            <ul className="mt-2 space-y-1.5">
              {(data?.hazards || []).map((h) => (
                <li key={h.id} className="text-[12px] text-slate-700"><span className="font-semibold">{h.title}</span> <span className="text-slate-500">· {h.address}</span></li>
              ))}
            </ul>
          </section>

          <p className="flex items-start gap-1.5 px-1 text-[11px] text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#188038]" />
            Responder positions come from their phones while on duty (<Radio className="inline w-3 h-3" /> live GPS). Demo drives are labelled.
          </p>
        </aside>
      </div>
    </div>
  );
};
