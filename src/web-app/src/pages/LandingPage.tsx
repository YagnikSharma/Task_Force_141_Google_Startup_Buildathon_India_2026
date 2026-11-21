import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Baby, BadgeCheck, Brain, EyeOff, HeartHandshake, Lock, MapPin, Phone, Route, ScrollText, ShieldAlert, Sparkles, Users,
} from 'lucide-react';
import { Mascot } from '../components/Mascot';

/* Every claim on this page is either live in the product or labelled. Numbers are only ones we measured. */

const STEPS = [
  { icon: ShieldAlert, title: 'Press SOS', text: 'Your live GPS location and your words go out in one tap. Hindi, English or Hinglish.' },
  { icon: Brain, title: 'Priority in ~2 s', text: 'Safety rules set a floor instantly; Gemini triages on top. AI can raise the priority, never lower it.' },
  { icon: BadgeCheck, title: 'A verified neighbour claims it', text: 'The nearest RWA-verified responders see it. One claims it, and you see who is coming.' },
  { icon: ScrollText, title: 'Tracked until closed', text: 'Every step lands on a timeline and an audit log, so the society can see how fast help came.' },
];

const FEATURES: { icon: React.ComponentType<{ className?: string }>; title: string; text: string; tag: 'Live' | 'Demo data'; to: string; tone: string }[] = [
  { icon: ShieldAlert, title: 'One-tap SOS', text: 'Real GPS, "Call 112 now" for critical cases, and a live responder ETA.', tag: 'Live', to: '/sos', tone: 'bg-red-50 text-red-600' },
  { icon: Route, title: 'Safe Route for women', text: 'Score a route for the time you travel: dark gaps, open places, police booths.', tag: 'Demo data', to: '/safe-route', tone: 'bg-violet-50 text-violet-600' },
  { icon: Baby, title: 'Child commutes', text: 'Set an expected arrival. If your child is late, the family and guardians are alerted.', tag: 'Live', to: '/child-safety', tone: 'bg-sky-50 text-sky-600' },
  { icon: HeartHandshake, title: 'Elder check-ins', text: 'Daily check-ins for parents living alone. A missed one raises a welfare alert.', tag: 'Live', to: '/elder-care', tone: 'bg-amber-50 text-amber-600' },
  { icon: Users, title: 'Verified responders', text: 'Guards, resident doctors and volunteers, verified by the RWA before they get alerts.', tag: 'Live', to: '/map', tone: 'bg-green-50 text-green-600' },
  { icon: Sparkles, title: 'Jugnu, the safety assistant', text: 'Ask in plain words. Jugnu can file a report or dispatch help, but only after you press Confirm.', tag: 'Live', to: '/auth?mode=login', tone: 'bg-brand-50 text-brand-600' },
];

const PRIVACY = [
  { icon: EyeOff, title: 'Blurred locations', text: "Other residents' alerts are blurred to about 110 m. No names or phone numbers on the map." },
  { icon: MapPin, title: 'Location only on SOS', text: 'Your exact position is shared when you send an SOS, not all the time.' },
  { icon: ScrollText, title: 'Everything audited', text: 'Every status change and priority override is logged with who did it and why.' },
  { icon: Lock, title: 'No face recognition', text: 'Never. Identity comes from your society account, not your face.' },
];

/** An illustration of the product (not a screenshot of live data). */
const PhonePreview: React.FC = () => (
  <div className="relative mx-auto w-[280px] sm:w-[300px]">
    <div className="absolute -inset-8 rounded-[3rem] bg-gradient-to-br from-brand-200/60 via-white to-red-100/70 blur-2xl" aria-hidden="true" />
    <div className="relative rounded-[2.4rem] border-[10px] border-slate-900 bg-canvas shadow-2xl overflow-hidden">
      <div className="h-6 bg-white flex items-center justify-center"><span className="h-1.5 w-16 rounded-full bg-slate-200" /></div>
      <div className="p-3.5 space-y-3">
        <div className="rounded-2xl bg-white p-3.5 shadow-card">
          <div className="flex items-center justify-between">
            <span className="chip bg-red-50 text-red-700 ring-1 ring-red-200">P1 · Critical</span>
            <span className="text-[10px] text-slate-400">triaged in 2.1 s</span>
          </div>
          <p className="mt-2 text-[13px] font-semibold text-slate-900 leading-snug">"Bachao! Koi peecha kar raha hai, gate 2 ke paas"</p>
          <p className="mt-1 text-[11px] text-slate-500">Someone is following the caller near Gate 2.</p>
        </div>
        <div className="rounded-2xl bg-white p-3.5 shadow-card flex items-center gap-3">
          <span className="grid place-items-center w-9 h-9 rounded-full bg-green-500 text-white text-xs font-bold">VJ</span>
          <div className="flex-1 leading-tight">
            <div className="text-[13px] font-semibold text-slate-900">Vikram is coming</div>
            <div className="text-[11px] text-slate-500">Verified responder · 400 m</div>
          </div>
          <span className="text-[13px] font-bold text-green-600">3 min</span>
        </div>
        <div className="rounded-2xl bg-red-600 p-3 text-center text-white text-[13px] font-semibold shadow-sos flex items-center justify-center gap-2">
          <Phone className="w-4 h-4" /> Call 112 now
        </div>
        <div className="rounded-2xl bg-white p-3 shadow-card">
          <div className="text-[11px] font-semibold text-slate-500 mb-1.5">Timeline</div>
          {['SOS sent with GPS (±12 m)', 'Gemini: P1, pursuit risk', 'Claimed by Vikram'].map((t, i) => (
            <div key={t} className="flex items-center gap-2 py-0.5 text-[11px] text-slate-700">
              <span className={`w-1.5 h-1.5 rounded-full ${i === 2 ? 'bg-green-500' : 'bg-brand-500'}`} /> {t}
            </div>
          ))}
        </div>
      </div>
    </div>
    <p className="mt-3 text-center text-[11px] text-slate-400">Illustration of the SOS flow</p>
  </div>
);

export const LandingPage: React.FC = () => {
  return (
    <div className="overflow-x-hidden">
      {/* Hero */}
      <section className="relative">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_80%_-10%,#d9e7fd_0%,transparent_60%),radial-gradient(40rem_24rem_at_0%_10%,#fde7e4_0%,transparent_55%)]" aria-hidden="true" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-16 sm:pt-16 lg:pt-20 grid lg:grid-cols-[1.15fr_1fr] gap-12 items-center">
          <div className="animate-fade-up">
            <span className="eyebrow"><Sparkles className="w-3.5 h-3.5" /> Built on Gemini and Google Cloud</span>
            <h1 className="mt-5 text-[2.6rem] leading-[1.05] sm:text-6xl font-extrabold text-slate-900">
              Help is two minutes away.
              <span className="block text-brand-600">Now it finds out.</span>
            </h1>
            <p className="mt-5 text-lg text-slate-600 max-w-xl leading-relaxed">
              NSIN sends your SOS to the nearest <strong className="text-slate-800">verified neighbour</strong> in seconds,
              triages it with Gemini, and tracks it until it's closed. For housing societies, women travelling alone,
              children on their way home and parents living alone.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/auth?mode=login" className="btn-primary !px-6 !py-3 text-[15px]">
                Try the live demo <ArrowRight className="w-4 h-4" />
              </Link>
              <Link to="/safe-route" className="btn-secondary !px-6 !py-3 text-[15px]">
                <Route className="w-4 h-4" /> Check a safe route
              </Link>
            </div>
            <p className="mt-4 text-xs text-slate-500">NSIN never replaces 112. Critical cases always show "Call 112 now" first.</p>

            <dl className="mt-10 grid grid-cols-3 gap-3 max-w-lg">
              {[
                ['~2 s', 'Gemini triage, measured live'],
                ['~110 m', 'privacy blur on others’ alerts'],
                ['3 langs', 'Hindi, English, Hinglish'],
              ].map(([v, l]) => (
                <div key={l} className="rounded-2xl border border-slate-200 bg-white/80 p-3.5">
                  <dt className="font-display text-2xl font-bold text-slate-900">{v}</dt>
                  <dd className="text-[11px] leading-snug text-slate-500 mt-0.5">{l}</dd>
                </div>
              ))}
            </dl>
          </div>
          <PhonePreview />
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="bg-white border-y border-slate-200/70">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="max-w-2xl">
            <span className="eyebrow">How it works</span>
            <h2 className="mt-3 text-3xl sm:text-4xl font-bold text-slate-900">From SOS to "safe" in four steps</h2>
            <p className="mt-3 text-slate-600">Every emergency gets an owner, a priority and a record. A WhatsApp group can't do that.</p>
          </div>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-2xl border border-slate-200 p-5 bg-canvas/60">
                <div className="flex items-center gap-3">
                  <span className="grid place-items-center w-10 h-10 rounded-xl bg-white shadow-card text-brand-600"><s.icon className="w-5 h-5" /></span>
                  <span className="font-display text-sm font-semibold text-slate-400">Step {i + 1}</span>
                </div>
                <h3 className="mt-4 font-semibold text-slate-900">{s.title}</h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="max-w-2xl">
          <span className="eyebrow">For the people most often alone</span>
          <h2 className="mt-3 text-3xl sm:text-4xl font-bold text-slate-900">One network, every situation</h2>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Link key={f.title} to={f.to} className="group card card-pad hover:shadow-lift hover:-translate-y-0.5 transition">
              <div className="flex items-start justify-between">
                <span className={`grid place-items-center w-11 h-11 rounded-xl ${f.tone}`}><f.icon className="w-5 h-5" /></span>
                <span className={`chip ${f.tag === 'Live' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800'}`}>{f.tag}</span>
              </div>
              <h3 className="mt-4 font-semibold text-slate-900 group-hover:text-brand-700 transition">{f.title}</h3>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{f.text}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Privacy */}
      <section id="privacy" className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 text-white p-7 sm:p-10 overflow-hidden relative">
          <div className="absolute -right-16 -top-16 w-64 h-64 rounded-full bg-white/10" aria-hidden="true" />
          <div className="relative max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide">
              <Lock className="w-3.5 h-3.5" /> Privacy by design
            </span>
            <h2 className="mt-3 text-3xl sm:text-4xl font-bold">Built to protect people, not to watch them</h2>
          </div>
          <div className="relative mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PRIVACY.map((p) => (
              <div key={p.title} className="rounded-2xl bg-white/10 p-4 backdrop-blur-sm">
                <p.icon className="w-5 h-5 text-white/90" />
                <h3 className="mt-3 font-semibold">{p.title}</h3>
                <p className="mt-1 text-sm text-white/80 leading-relaxed">{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="card p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-6">
          <Mascot className="w-20 h-20 shrink-0" />
          <div className="flex-1 text-center sm:text-left">
            <h2 className="text-2xl font-bold text-slate-900">See it work in under a minute</h2>
            <p className="mt-1 text-slate-600">Sign in with a one-click demo account: resident, responder, senior citizen or admin.</p>
          </div>
          <Link to="/auth?mode=login" className="btn-primary !px-6 !py-3">Open the demo <ArrowRight className="w-4 h-4" /></Link>
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">
          Planned, not built yet: push alerts, phone sign-in, voice SOS, offline SOS by SMS, police escalation, Safe Route on real data.
        </p>
      </section>
    </div>
  );
};
