import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Sparkles, CheckCircle2, ArrowRight, Loader2, BookOpen, AlertCircle, LocateFixed } from 'lucide-react';
import { LiveMap } from '../components/map/LiveMap';
import { api } from '../services/api';
import { AIAnalysisResult } from '../types';
import { isSynthetic, syntheticTriage } from '../services/synthetic';

export const ReportIncidentPage: React.FC = () => {
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [incidentType, setIncidentType] = useState('hazard');
  const [priority, setPriority] = useState<string | null>(null);
  // GPS first: the phone's location is taken automatically; a landmark is only required without it.
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [gpsState, setGpsState] = useState<'locating' | 'ok' | 'denied' | 'unsupported'>('locating');

  const locate = () => {
    if (!('geolocation' in navigator)) { setGpsState('unsupported'); return; }
    setGpsState('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }); setGpsState('ok'); },
      () => setGpsState('denied'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };
  useEffect(locate, []);
  const [locationAddress, setLocationAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI Assistant state
  const [analyzing, setAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<AIAnalysisResult | null>(null);

  const handleRunAiTriage = async (): Promise<AIAnalysisResult | null> => {
    if (!description || description.length < 5) {
      setError("Please enter a short description first so the AI can analyze the incident.");
      return null;
    }
    setAnalyzing(true);
    try {
      const res = await api.getIncidentAIAssistance(description, incidentType, locationAddress);
      setAiResult(res);
      if (res.suggested_priority) {
        setPriority(res.suggested_priority);
      }
      if (res.parsed_category) {
        setIncidentType(res.parsed_category);
      }
      if (res.extracted_location && !locationAddress) {
        setLocationAddress(res.extracted_location);
      }
      return res;
    } catch (err: any) {
      // Live service unreachable: fall back to a clearly labelled on-device result so the resident still gets guidance.
      console.error("AI assistance failed, using synthetic fallback:", err);
      const res = syntheticTriage(`${description} ${locationAddress || ''}`);
      setAiResult(res);
      setPriority(res.suggested_priority);
      return res;
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      // No triage yet? Run it now, so the priority always comes from Gemini (or the safety rules).
      const triage = aiResult ?? (await handleRunAiTriage());
      const incident = await api.createIncident({
        title,
        description,
        incident_type: triage?.parsed_category || incidentType,
        priority: triage?.suggested_priority || priority || undefined,
        location_address: locationAddress || undefined,
        latitude: gps?.lat,
        longitude: gps?.lng,
      });
      if (triage) {
        // Persist the triage analysis against the new incident (stored in ai_analysis_records).
        try {
          await api.getIncidentAIAssistance(description, incidentType, locationAddress, incident.id);
        } catch (err) {
          console.error("Saving AI triage failed:", err);
        }
      }
      navigate(`/incidents/${incident.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to submit incident report.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Report an Incident or Hazard</h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Submit verified details to alert neighbourhood responders, guardians, and municipal authorities.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Form Column */}
        <form onSubmit={handleSubmit} className="lg:col-span-2 space-y-5 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Incident Category</label>
            <select
              value={incidentType}
              onChange={(e) => setIncidentType(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none bg-white"
            >
              <option value="hazard">Infrastructure Hazard (Broken light, blocked road, open pit)</option>
              <option value="suspicious_activity">Suspicious Activity (Prowler, unverified loitering)</option>
              <option value="medical">Medical Assistance Needed</option>
              <option value="child_alert">Child Safety / Overdue Transit Alert</option>
              <option value="elder_welfare">Senior Citizen Welfare Request</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Incident Summary Title</label>
            <input
              type="text"
              required
              placeholder="e.g. Broken streetlamp creating dark zone on Lane 4"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-700">Detailed Description</label>
              <button
                type="button"
                onClick={handleRunAiTriage}
                disabled={analyzing || !description}
                className="text-xs text-teal-700 hover:text-teal-800 font-semibold flex items-center gap-1.5 disabled:opacity-40"
              >
                {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-teal-600" />}
                Analyze with AI Triage
              </button>
            </div>
            <textarea
              required
              rows={4}
              placeholder="Describe what occurred, any hazards, landmarks, or vehicle details..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none resize-none"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700">Location</label>
              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${gpsState === 'ok' ? 'text-emerald-700' : gpsState === 'locating' ? 'text-slate-500' : 'text-amber-700'}`}>
                {gpsState === 'locating' && <><Loader2 className="w-3 h-3 animate-spin" /> Getting your GPS…</>}
                {gpsState === 'ok' && <><LocateFixed className="w-3 h-3" /> GPS captured{gps?.accuracy ? ` (±${Math.round(gps.accuracy)} m)` : ''}. Drag the pin if needed.</>}
                {(gpsState === 'denied' || gpsState === 'unsupported') && (
                  <button type="button" onClick={locate} className="underline">GPS unavailable. Try again, or tap the map</button>
                )}
              </span>
            </div>
            <LiveMap data={null} pick={gps} onPick={(lat, lng) => { setGps({ lat, lng }); setGpsState('ok'); }}
              interactive3d={false} className="h-48 w-full overflow-hidden rounded-xl border border-slate-200" />
            <div className="relative">
              <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                required={!gps}
                placeholder={gps ? 'Landmark (optional), e.g. near Gate 2, opposite the chemist' : 'Landmark (required without GPS), e.g. Opposite Gate 2'}
                value={locationAddress}
                onChange={(e) => setLocationAddress(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#1a73e8] shrink-0" />
            <span>
              <strong className="text-slate-800">Priority: {priority ? priority.replace('_', ' ') : 'set automatically'}</strong>
              {' '}by Gemini triage and the safety rules when you submit. A verified responder can change it later, with a logged reason.
            </span>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 px-4 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-xl shadow-md transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? 'Registering Incident...' : 'Submit Incident to Responders'}
            <ArrowRight className="w-4 h-4" />
          </button>

        </form>

        {/* AI Assistant Column */}
        <div className="space-y-4">
          <div className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-800 shadow-md space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-teal-400" />
              <h3 className="font-bold text-sm">AI Triage · Gemini</h3>
            </div>

            {aiResult ? (
              <div className="space-y-3 text-xs text-slate-300">
                <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className={`px-2 py-0.5 rounded-full font-bold ${aiResult.ai_engine?.startsWith('gemini') ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' : 'bg-slate-700 text-slate-300'}`}>
                    {aiResult.ai_engine?.startsWith('gemini') ? `Analysed by ${aiResult.ai_engine.replace('gemini:', '')}` : isSynthetic(aiResult.ai_engine) ? 'Synthetic demo response' : 'Offline rule engine'}
                  </span>
                  {aiResult.gemini?.detected_language && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">{aiResult.gemini.detected_language}</span>
                  )}
                  {aiResult.escalated && (
                    <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/40 font-bold">Escalated</span>
                  )}
                </div>

{aiResult.suggested_priority === 'P1_CRITICAL' && (
                  <a href="tel:112" className="flex items-center justify-between gap-2 rounded-xl bg-red-600 px-3 py-2.5 text-white font-bold text-sm shadow-lg shadow-red-900/40 hover:bg-red-500">
                    <span>Life-threatening? Call 112 now</span><span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">112</span>
                  </a>
                )}
                {isSynthetic(aiResult.ai_engine) && (
                  <div className="rounded-xl border border-amber-400/50 bg-amber-500/15 px-3 py-2 text-[11px] text-amber-200">
                    <strong>Synthetic demo data.</strong> The live AI service could not be reached, so this result was computed on your device.
                  </div>
                )}
                {aiResult.gemini?.responder_briefing && (
                  <div className="bg-blue-950/40 p-3 rounded-xl border border-blue-900/50">
                    <span className="text-blue-300 block text-[10px] uppercase font-bold">Responder Briefing</span>
                    <p className="text-[11px] text-slate-200 mt-1">{aiResult.gemini.responder_briefing}</p>
                  </div>
                )}
                <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700">
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Suggested Priority</span>
                  <span className="text-amber-400 font-bold text-sm">{aiResult.suggested_priority}</span>
                  {aiResult.rule_priority && aiResult.rule_priority !== aiResult.suggested_priority && (
                    <span className="block text-[10px] text-blue-300 mt-0.5">
                      Keyword rules said {aiResult.rule_priority}; Gemini escalated it (Gemini can raise a priority, never lower it).
                    </span>
                  )}
                  <p className="text-[11px] text-slate-300 mt-1">{aiResult.triage_reasoning}</p>
                </div>

                {aiResult.missing_critical_info.length > 0 && (
                  <div className="bg-red-950/40 p-3 rounded-xl border border-red-900/40">
                    <span className="text-red-400 font-semibold block mb-1">Missing Critical Information:</span>
                    <ul className="list-disc list-inside space-y-1 text-slate-300 text-[11px]">
                      {aiResult.missing_critical_info.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiResult.immediate_safety_checklist.length > 0 && (
                  <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700">
                    <span className="text-teal-400 font-semibold block mb-1">Immediate Safety Actions:</span>
                    <ul className="space-y-1 text-slate-300 text-[11px]">
                      {aiResult.immediate_safety_checklist.map((a, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <CheckCircle2 className="w-3 h-3 text-teal-400 shrink-0 mt-0.5" />
                          <span>{a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiResult.retrieved_civic_protocols.length > 0 && (
                  <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700">
                    <span className="text-teal-400 font-semibold block mb-1 flex items-center gap-1">
                      <BookOpen className="w-3 h-3" />
                      Retrieved Municipal Protocol:
                    </span>
                    <p className="text-slate-200 font-medium text-[11px]">
                      {aiResult.retrieved_civic_protocols[0].title}
                    </p>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      Source: {aiResult.retrieved_civic_protocols[0].source}
                    </span>
                  </div>
                )}

                <p className="text-[10px] text-slate-500 italic pt-1">
                  {aiResult.advisory_notice}
                </p>
              </div>
            ) : (
              <div className="text-xs text-slate-400 space-y-2 py-4">
                <p>
                  Type your incident description and click <strong>"Analyze with AI Triage"</strong> to receive real-time assistance.
                </p>
                <ul className="space-y-1.5 text-[11px]">
                  <li>• Checks for missing location details</li>
                  <li>• Recommends priority level based on risk</li>
                  <li>• Understands English, Hindi and Hinglish with Gemini</li>
                  <li>• Retrieves official civic safety SOPs (BM25 + Gemini embeddings)</li>
                </ul>
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
};
