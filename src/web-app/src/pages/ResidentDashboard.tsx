import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ShieldAlert, AlertTriangle, Users, MapPin, ArrowRight, ShieldCheck, HeartPulse, RefreshCw, Baby, CheckCircle2, Phone, ChevronRight, Sparkles, X } from 'lucide-react';
import { priorityInfo, nice, statusTone } from '../lib/labels';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Incident, TrustedContact, CommunityInsights } from '../types';
import { getDeviceLocation } from '../components/map/MapControls';
// Demo region is Delhi NCR: if GPS is denied, fall back to Connaught Place, New Delhi.
const DEFAULT_CITY: [number, number] = [28.6315, 77.2167];

export const ResidentDashboard: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [showAllClosed, setShowAllClosed] = useState(false);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [insights, setInsights] = useState<CommunityInsights | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  
  // SOS Modal state
  const [sosModalOpen, setSosModalOpen] = useState<boolean>(false);
  const [sosCountdown, setSosCountdown] = useState<number>(3);
  const [sosSubmitting, setSosSubmitting] = useState<boolean>(false);
  const [sosSuccessNotice, setSosSuccessNotice] = useState<string | null>(null);
  const [sosLocationNote, setSosLocationNote] = useState<{ text: string; fallback: boolean } | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [incList, contactList, insightData] = await Promise.all([
        api.getIncidents(),
        api.getContacts(),
        api.getCommunityInsights()
      ]);
      setIncidents(incList);
      setContacts(contactList);
      setInsights(insightData);
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // /sos (the red tab-bar button) opens the SOS confirmation straight away.
  useEffect(() => {
    if (location.pathname === '/sos') handleOpenSos();
  }, [location.pathname]);

  const closeSos = () => {
    setSosModalOpen(false);
    if (location.pathname === '/sos') navigate('/dashboard', { replace: true });
  };

  const handleOpenSos = () => {
    setSosModalOpen(true);
    setSosCountdown(3);
    setSosSuccessNotice(null);
    setSosLocationNote(null);
  };

  const handleExecuteSos = async () => {
    setSosSubmitting(true);
    try {
      // The device's real position (high-accuracy GPS). Only if that fails do we fall back to the
      // default city centre, and we say so on screen.
      let lat = DEFAULT_CITY[0];
      let lng = DEFAULT_CITY[1];
      let where: string;
      let locNote: { text: string; fallback: boolean };
      try {
        const fix = await getDeviceLocation(10000);
        lat = fix.lat;
        lng = fix.lng;
        where = `Device GPS (±${Math.round(fix.accuracy)} m)`;
        locNote = { text: `Sent with your live GPS location (±${Math.round(fix.accuracy)} m).`, fallback: false };
      } catch (e: any) {
        where = user?.address ? `${user.address} (GPS unavailable; default city location used)` : 'GPS unavailable; default city location (Connaught Place, New Delhi)';
        locNote = { text: `${e?.message || 'Location unavailable.'} Your SOS was sent with the default city location (Connaught Place, New Delhi), not your exact position. Tell responders where you are by phone.`, fallback: true };
      }
      setSosLocationNote(locNote);

      const res = await api.triggerSOS({
        latitude: lat,
        longitude: lng,
        location_address: where,
        description: `EMERGENCY SOS triggered by ${user?.full_name}. Immediate response requested.`
      });

      setSosSuccessNotice(`Emergency SOS registered! Incident Code: ${res.reference_code}. Responders alerted.`);
      await fetchData();
    } catch (err: any) {
      alert("Failed to send SOS: " + err.message);
    } finally {
      setSosSubmitting(false);
      // The location note stays on the dashboard after the modal closes.
      // The modal stays open with the "Call 112" button until the user taps Done.
    }
  };

  const CLOSED = ['resolved', 'closed', 'false_alarm', 'cancelled'];
  const active = incidents.filter((i) => !CLOSED.includes((i.status || '').toLowerCase()));
  const closed = incidents.filter((i) => CLOSED.includes((i.status || '').toLowerCase()));
  const firstName = (user?.full_name || '').split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const renderIncident = (inc: Incident) => {
    const p = priorityInfo(inc.priority);
    return (
      <Link key={inc.id} to={`/incidents/${inc.id}`} className="group flex gap-3 p-4 hover:bg-slate-50/80 transition">
        <span className={`mt-0.5 grid place-items-center w-10 h-10 shrink-0 rounded-xl text-xs font-bold ${p.tone}`}>{p.short}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-slate-900 text-[15px] leading-snug line-clamp-2">{inc.title}</h3>
            <span className={`chip shrink-0 ${statusTone(inc.status)}`}>{nice(inc.status)}</span>
          </div>
          <p className="text-[13px] text-slate-500 line-clamp-1 mt-0.5">{inc.description}</p>
          <div className="mt-1.5 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-slate-400">
            <span className="font-mono">{inc.reference_code}</span>
            <span>{new Date(inc.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            {inc.location_address && (
              <span className="flex items-center gap-1 min-w-0"><MapPin className="w-3 h-3 shrink-0" /><span className="truncate max-w-[180px]">{inc.location_address}</span></span>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300 self-center group-hover:text-slate-500 transition" />
      </Link>
    );
  };

  return (
    <div className="page space-y-6">

      {/* Greeting + SOS */}
      <section className="card overflow-hidden">
        <div className="relative p-5 sm:p-8 flex flex-col md:flex-row md:items-center gap-6">
          <div className="absolute inset-0 bg-[radial-gradient(36rem_18rem_at_100%_0%,#fde7e4_0%,transparent_60%)]" aria-hidden="true" />
          <div className="relative flex-1">
            <span className="chip bg-green-50 text-green-700"><span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Protected · {contacts.length} trusted contacts</span>
            <h1 className="mt-3 text-2xl sm:text-3xl font-bold text-slate-900">{greeting}, {firstName}</h1>
            <p className="mt-1 text-sm text-slate-500">{user?.address || 'Your neighbourhood network is on.'}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/report-incident" className="btn-secondary !py-2 !px-4"><AlertTriangle className="w-4 h-4 text-amber-600" /> Report something</Link>
              <a href="tel:112" className="btn-ghost !py-2 !px-4 text-red-700"><Phone className="w-4 h-4" /> Call 112</a>
            </div>
          </div>
          <div className="relative flex flex-col items-center md:pr-4">
            <button
              onClick={handleOpenSos}
              className="relative grid place-items-center w-36 h-36 sm:w-40 sm:h-40 rounded-full bg-gradient-to-b from-red-500 to-red-700 text-white shadow-sos active:scale-95 transition"
              aria-label="Send an emergency SOS"
            >
              <span className="absolute inset-0 rounded-full bg-red-500 animate-sos-ring" aria-hidden="true" />
              <span className="absolute inset-3 rounded-full border-2 border-white/25" aria-hidden="true" />
              <span className="relative text-center">
                <ShieldAlert className="w-9 h-9 mx-auto" />
                <span className="block mt-1 font-display text-2xl font-extrabold tracking-wide">SOS</span>
              </span>
            </button>
            <span className="mt-3 text-xs text-slate-500">Tap once. You confirm before it is sent.</span>
          </div>
        </div>
      </section>

      {/* SOS confirmation */}
      {sosModalOpen && (
        <div className="fixed inset-0 z-[1100] flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4" role="dialog" aria-modal="true">
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6 sm:p-7 shadow-2xl space-y-5 animate-fade-up" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
            <div className="flex items-start justify-between">
              <span className="grid place-items-center w-14 h-14 rounded-2xl bg-red-50 text-red-600"><ShieldAlert className="w-8 h-8" /></span>
              {!sosSubmitting && (
                <button type="button" onClick={closeSos} className="p-2 rounded-full hover:bg-slate-100" aria-label="Close"><X className="w-5 h-5 text-slate-500" /></button>
              )}
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-900">{sosSuccessNotice ? 'SOS sent' : 'Send an SOS?'}</h2>
              {!sosSuccessNotice && (
                <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                  Your name, live location and medical notes go to your <strong>{contacts.length} trusted contacts</strong> and the
                  <strong> nearest verified responders</strong>.
                </p>
              )}
            </div>

            {sosSuccessNotice && (
              <div className="p-4 rounded-2xl bg-green-50 text-green-800 text-sm font-medium flex items-start gap-2 border border-green-200">
                <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                <span>{sosSuccessNotice}</span>
              </div>
            )}
            {sosSuccessNotice && (
              <a href="tel:112" className="flex items-center justify-between rounded-2xl bg-red-600 px-4 py-3.5 text-sm font-bold text-white hover:bg-red-700">
                <span className="flex items-center gap-2"><Phone className="w-4 h-4" /> If anyone is in danger, call 112 now</span>
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">112</span>
              </a>
            )}
            {sosLocationNote && sosSuccessNotice && (
              <div className={`p-3 rounded-2xl text-xs border ${sosLocationNote.fallback ? 'bg-amber-50 text-amber-900 border-amber-300' : 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                {sosLocationNote.text}
              </div>
            )}
            {sosSuccessNotice ? (
              <button type="button" onClick={closeSos} className="btn-secondary w-full !py-3 !rounded-2xl">Done</button>
            ) : sosSubmitting ? (
              <div className="flex items-center justify-center gap-2 py-3 text-sm text-slate-500"><RefreshCw className="w-4 h-4 animate-spin" /> Getting your GPS location and sending…</div>
            ) : (
              <div className="grid grid-cols-[1fr_1.6fr] gap-3 pt-1">
                <button type="button" onClick={closeSos} className="btn-secondary !py-3.5 !rounded-2xl">Cancel</button>
                <button type="button" onClick={handleExecuteSos} className="btn-danger !py-3.5 !rounded-2xl text-[15px]">Yes, send SOS</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Where the last SOS was sent from (stays visible after the modal closes). */}
      {sosLocationNote && !sosModalOpen && (
        <div className={`flex items-start gap-2 rounded-2xl border p-4 text-xs font-medium ${sosLocationNote.fallback ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-green-200 bg-green-50 text-green-800'}`} role="status">
          <MapPin className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">SOS location: {sosLocationNote.text}</span>
          <button type="button" onClick={() => setSosLocationNote(null)} className="text-slate-500 hover:text-slate-800">Dismiss</button>
        </div>
      )}

      {/* Quick actions */}
      <section className="grid grid-cols-4 gap-2 sm:gap-4">
        {([
          ['/report-incident', 'Report', 'Hazard, prowler, dark street', AlertTriangle, 'bg-amber-50 text-amber-600'],
          ['/child-safety', 'Child', 'Expected-arrival check', Baby, 'bg-sky-50 text-sky-600'],
          ['/elder-care', 'Elder', 'Daily check-ins', HeartPulse, 'bg-rose-50 text-rose-600'],
          ['/contacts', 'Contacts', `${contacts.length} in your circle`, Users, 'bg-violet-50 text-violet-600'],
        ] as const).map(([to, label, sub, Icon, tone]) => (
          <Link key={to} to={to} className="card p-3 sm:p-5 flex flex-col items-center sm:items-start text-center sm:text-left hover:shadow-lift hover:-translate-y-0.5 transition">
            <span className={`grid place-items-center w-11 h-11 rounded-xl ${tone}`}><Icon className="w-5 h-5" /></span>
            <span className="mt-2 sm:mt-3 text-[13px] sm:text-sm font-semibold text-slate-900">{label}</span>
            <span className="hidden sm:block text-xs text-slate-500 mt-0.5">{sub}</span>
          </Link>
        ))}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Incidents */}
        <section className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="section-title">Your reports and alerts</h2>
              <p className="text-xs text-slate-500">{active.length} active · {closed.length} closed</p>
            </div>
            <button onClick={fetchData} className="p-2 text-slate-500 hover:text-slate-800 rounded-full hover:bg-slate-100 transition" title="Refresh" aria-label="Refresh">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {incidents.length === 0 ? (
            <div className="card p-8 text-center">
              <ShieldCheck className="w-10 h-10 text-green-600 mx-auto" />
              <h3 className="mt-3 font-semibold text-slate-800">All clear</h3>
              <p className="mt-1 text-sm text-slate-500 max-w-sm mx-auto">No alerts right now. Send an SOS or report a hazard any time.</p>
            </div>
          ) : (
            <>
              {active.length > 0 && (
                <div className="card divide-y divide-slate-100 overflow-hidden">
                  <div className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-red-600 bg-red-50/50">Active</div>
                  {active.map(renderIncident)}
                </div>
              )}
              {closed.length > 0 && (
                <div className="card divide-y divide-slate-100 overflow-hidden">
                  <div className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Closed</div>
                  {(showAllClosed ? closed : closed.slice(0, 3)).map(renderIncident)}
                  {closed.length > 3 && (
                    <button onClick={() => setShowAllClosed((v) => !v)} className="w-full py-3 text-sm font-semibold text-brand-600 hover:bg-slate-50">
                      {showAllClosed ? 'Show less' : `Show all ${closed.length}`}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        {/* Side column */}
        <aside className="space-y-6">
          <div className="card card-pad space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 flex items-center gap-2"><Users className="w-4 h-4 text-brand-600" /> Trusted contacts</h3>
              <Link to="/contacts" className="text-xs text-brand-600 hover:text-brand-700 font-semibold">Manage</Link>
            </div>
            {contacts.length === 0 ? (
              <p className="text-sm text-slate-500">No trusted contacts yet. Add family so they hear about your SOS.</p>
            ) : (
              <ul className="space-y-2">
                {contacts.slice(0, 3).map((c) => (
                  <li key={c.id} className="flex items-center gap-3">
                    <span className="grid place-items-center w-9 h-9 rounded-full bg-slate-100 text-slate-600 text-xs font-bold">
                      {c.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                    </span>
                    <div className="flex-1 min-w-0 leading-tight">
                      <div className="text-sm font-semibold text-slate-900 truncate">{c.name}</div>
                      <div className="text-xs text-slate-500 truncate">{c.relationship} · {c.phone}</div>
                    </div>
                    <a href={`tel:${c.phone}`} className="p-2 rounded-full text-slate-500 hover:bg-slate-100" aria-label={`Call ${c.name}`}><Phone className="w-4 h-4" /></a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card card-pad space-y-3">
            <div className="flex items-center justify-between">
              <span className="eyebrow"><Sparkles className="w-3.5 h-3.5" /> Community advisory</span>
              {insights && (
                <span className="text-sm font-bold text-slate-900">{insights.safety_health_score}<span className="text-slate-400 font-medium">/100</span></span>
              )}
            </div>
            {insights && (
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-green-500" style={{ width: `${Math.max(4, Math.min(100, insights.safety_health_score))}%` }} />
              </div>
            )}
            <p className="text-sm text-slate-600 leading-relaxed">{insights?.ai_safety_advisory || 'No advisory right now.'}</p>
            <Link to="/community" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">Community insights <ArrowRight className="w-3.5 h-3.5" /></Link>
          </div>
        </aside>
      </div>
    </div>
  );
};
