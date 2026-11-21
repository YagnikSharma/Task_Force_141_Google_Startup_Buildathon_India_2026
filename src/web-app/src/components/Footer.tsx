import { Link } from 'react-router-dom';
import Mark from './Mark';
import React from 'react';
import { Phone } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const HELPLINES: [string, string][] = [
  ['112', 'Emergency'],
  ['100', 'Police'],
  ['1091', 'Women'],
  ['1098', 'Childline'],
  ['14567', 'Elders'],
];

/** Helplines are tap-to-call on phones. Signed-in users get only the helpline strip, so app pages stay short. */
export const Footer: React.FC = () => {
  const { user } = useAuth();

  const strip = (
    <div className="border-t border-slate-200 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-red-700 shrink-0">
          <Phone className="w-3.5 h-3.5" /> Helplines (India)
        </span>
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
          {HELPLINES.map(([num, label]) => (
            <a
              key={num}
              href={`tel:${num}`}
              className="shrink-0 inline-flex items-baseline gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 hover:border-red-200 hover:bg-red-50 transition"
            >
              <strong className="text-slate-900">{num}</strong> {label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );

  if (user) return <footer id="helplines" className="mt-auto">{strip}</footer>;

  return (
    <footer id="helplines" className="mt-auto">
      {strip}
      <div className="border-t border-slate-200 bg-canvas">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid gap-8 md:grid-cols-[1.4fr_1fr_1fr] text-sm">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <Mark className="w-8 h-8" />
              <span className="font-display font-bold text-slate-900">nsin</span>
              <span className="text-slate-500">Neighbourhood Safety Intelligence Network</span>
            </div>
            <p className="text-slate-500 max-w-md leading-relaxed">
              The nearest verified neighbour hears about an SOS in seconds, and every SOS is tracked until it is closed.
              NSIN never replaces 112: it adds the help that is already close by.
            </p>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-900 mb-3">Product</h4>
            <ul className="space-y-2 text-slate-500">
              {[
                ['/sos', 'Emergency SOS'],
                ['/map', 'Live safety map'],
                ['/safe-route', 'Safe Route (women in transit)'],
                ['/child-safety', 'Child commutes'],
                ['/elder-care', 'Elder check-ins'],
              ].map(([to, label]) => (
                <li key={to}><Link to={to} className="hover:text-brand-600 transition">{label}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-900 mb-3">Built with</h4>
            <ul className="space-y-2 text-slate-500">
              <li>Gemini triage + safety rules</li>
              <li>Cloud Run · Cloud SQL (pgvector)</li>
              <li>Firebase Hosting</li>
              <li>Jugnu: Gemini agent with function calling</li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8 text-xs text-slate-400">
          © {new Date().getFullYear()} NSIN · Team Task Force 141 · Startup Buildathon India 2026
        </div>
      </div>
    </footer>
  );
};
