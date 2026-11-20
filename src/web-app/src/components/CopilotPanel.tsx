import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { AgentPendingAction, AgentStep, AgentTurn } from '../types';

/** NSIN Copilot: a Gemini agent that calls real app tools. Write actions need the user's Confirm. */

interface Msg extends AgentTurn {
  steps?: AgentStep[];
  pending?: (AgentPendingAction & { state: 'waiting' | 'running' | 'done' | 'cancelled' | 'error'; result?: string; link?: string })[];
  engine?: string;
  model?: string | null;
  error?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  search_safety_protocols: 'Searched safety protocols',
  list_incidents: 'Listed incidents',
  get_incident: 'Opened incident',
  community_overview: 'Read live community data',
  nearest_responders: 'Found nearest responders',
  file_incident_report: 'Prepared a report',
  update_incident_status: 'Prepared a status change',
  dispatch_nearest_responder: 'Prepared a dispatch',
  report_community_hazard: 'Prepared a hazard report',
};

const RESIDENT_PROMPTS = [
  'Is my neighbourhood safe right now?',
  'Streetlight outside Sector 12 park is broken, report it',
  'Main raat ko akeli ghar ja rahi hoon, kya karoon?',
  'Show my open reports',
];
const STAFF_PROMPTS = [
  'Which open incidents are most urgent?',
  'Who is the nearest responder to the latest SOS?',
  'Dispatch help to the most critical open incident',
  'Summarise hazards for the RWA meeting',
];

/** Minimal, safe rendering: **bold** and line breaks only (no HTML from the model). */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <p key={i} className={line.trim() ? 'mb-1 last:mb-0' : 'h-2'}>
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
            part.startsWith('**') && part.endsWith('**')
              ? <strong key={j}>{part.slice(2, -2)}</strong>
              : <React.Fragment key={j}>{part.replace(/^\s*[*-]\s+/, '• ')}</React.Fragment>)}
        </p>
      ))}
    </>
  );
}

export const CopilotPanel: React.FC = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [shareLocation, setShareLocation] = useState(false);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | undefined>();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!shareLocation || !navigator.geolocation) { setCoords(undefined); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setCoords({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => setShareLocation(false),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [shareLocation]);

  if (!user) return null;
  const staff = user.role === 'responder' || user.role === 'admin';
  const prompts = staff ? STAFF_PROMPTS : RESIDENT_PROMPTS;

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    const history: AgentTurn[] = msgs.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: 'user', content: message }]);
    setInput('');
    setBusy(true);
    try {
      const r = await api.agentChat(message, history, coords);
      setMsgs((m) => [...m, {
        role: 'assistant', content: r.reply, steps: r.steps, engine: r.engine, model: r.model,
        pending: r.pending_actions.map((a) => ({ ...a, state: 'waiting' as const })),
      }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'assistant', content: e?.message || 'Copilot is unavailable. In an emergency call 112.', error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const setAction = (mi: number, ai: number, patch: Partial<NonNullable<Msg['pending']>[number]>) =>
    setMsgs((all) => all.map((m, i) => i !== mi ? m : { ...m, pending: m.pending?.map((a, j) => j === ai ? { ...a, ...patch } : a) }));

  const confirm = async (mi: number, ai: number, a: AgentPendingAction) => {
    setAction(mi, ai, { state: 'running' });
    try {
      const r = await api.agentConfirm(a.tool, a.args);
      setAction(mi, ai, { state: 'done', result: r.message, link: r.link });
    } catch (e: any) {
      setAction(mi, ai, { state: 'error', result: e?.message || 'The action failed.' });
    }
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[1000] flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-teal-500 px-5 py-3 text-sm font-semibold text-white shadow-xl hover:scale-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 transition"
          aria-label="Open NSIN Copilot, the Gemini safety assistant"
        >
          <span aria-hidden>✦</span> Ask Copilot
        </button>
      )}
      {open && (
        <section
          role="dialog"
          aria-label="NSIN Copilot"
          className="fixed bottom-0 right-0 z-[1000] flex h-[100dvh] w-full flex-col bg-white shadow-2xl sm:bottom-5 sm:right-5 sm:h-[620px] sm:max-h-[85vh] sm:w-[400px] sm:rounded-2xl border border-slate-200"
        >
          <header className="flex items-center justify-between rounded-t-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-teal-500 px-4 py-3 text-white">
            <div>
              <h2 className="text-base font-bold leading-tight">NSIN Copilot</h2>
              <p className="text-xs opacity-90">Gemini agent · uses live app data · you confirm every action</p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close Copilot"
              className="rounded-full p-2 hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">✕</button>
          </header>

          <div className="bg-red-50 px-4 py-1.5 text-[11px] text-red-700 border-b border-red-100">
            In immediate danger? Call <a href="tel:112" className="font-bold underline">112</a> or use the SOS button. Copilot is advisory.
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
            {msgs.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  Hi {user.full_name.split(' ')[0]}. I can look up live incidents and hazards, find approved safety
                  protocols, and prepare reports{staff ? ', status changes and dispatches' : ''} for you to confirm.
                  English, Hindi or Hinglish.
                </p>
                <div className="flex flex-wrap gap-2">
                  {prompts.map((p) => (
                    <button key={p} onClick={() => send(p)}
                      className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-left text-xs text-indigo-800 hover:bg-indigo-100">
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {msgs.map((m, mi) => (
              <div key={mi} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${m.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-sm'
                  : m.error ? 'bg-red-50 text-red-800 border border-red-200' : 'bg-slate-100 text-slate-900 rounded-bl-sm'}`}>
                  {m.steps && m.steps.length > 0 && (
                    <ul className="mb-2 flex flex-wrap gap-1" aria-label="Tools the agent used">
                      {m.steps.map((s, si) => (
                        <li key={si} className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${s.ok ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}
                          title={JSON.stringify(s.args)}>
                          🔧 {TOOL_LABELS[s.tool] || s.tool}{s.ok ? '' : ' (failed)'}
                        </li>
                      ))}
                    </ul>
                  )}
                  <RichText text={m.content} />
                  {m.pending?.map((a, ai) => (
                    <div key={ai} className="mt-2 rounded-xl border border-indigo-200 bg-white p-2.5 text-slate-800">
                      <p className="text-xs font-semibold text-indigo-700">Action needs your confirmation</p>
                      <p className="mt-0.5 text-sm">{a.summary}</p>
                      {a.state === 'waiting' && (
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => confirm(mi, ai, a)}
                            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">Confirm</button>
                          <button onClick={() => setAction(mi, ai, { state: 'cancelled' })}
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50">Cancel</button>
                        </div>
                      )}
                      {a.state === 'running' && <p className="mt-2 text-xs text-slate-500">Working…</p>}
                      {a.state === 'cancelled' && <p className="mt-2 text-xs text-slate-500">Cancelled. Nothing was changed.</p>}
                      {(a.state === 'done' || a.state === 'error') && (
                        <p className={`mt-2 text-xs ${a.state === 'done' ? 'text-emerald-700' : 'text-red-700'}`}>
                          {a.state === 'done' ? '✓ ' : '✕ '}{a.result}{' '}
                          {a.link && <Link to={a.link} onClick={() => setOpen(false)} className="font-semibold underline">Open</Link>}
                        </p>
                      )}
                    </div>
                  ))}
                  {m.role === 'assistant' && !m.error && (
                    <p className="mt-1.5 text-[10px] text-slate-400">
                      {m.engine === 'gemini' ? `Gemini · ${m.model ?? ''}` : 'Offline protocol search (Gemini busy)'}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-slate-500" role="status">
                <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-blue-500" />
                <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-red-500 [animation-delay:120ms]" />
                <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-yellow-500 [animation-delay:240ms]" />
                <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-green-500 [animation-delay:360ms]" />
                Gemini is thinking and checking live data…
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="border-t border-slate-200 p-3">
            <label className="mb-2 flex items-center gap-2 text-[11px] text-slate-500">
              <input type="checkbox" checked={shareLocation} onChange={(e) => setShareLocation(e.target.checked)} />
              Share my location with Copilot for this chat {coords ? '(on)' : ''}
            </label>
            <div className="flex gap-2">
              <label htmlFor="copilot-input" className="sr-only">Message Copilot</label>
              <textarea id="copilot-input" ref={inputRef} rows={1} value={input} maxLength={2000}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                placeholder="Ask about safety, incidents, hazards…"
                className="flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
              <button type="submit" disabled={busy || !input.trim()}
                className="rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-40">Send</button>
            </div>
          </form>
        </section>
      )}
    </>
  );
};
