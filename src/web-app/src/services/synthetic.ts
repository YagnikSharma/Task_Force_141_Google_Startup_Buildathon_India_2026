/** Last-resort fallback when the live service can't be reached: a client-side triage and a small map
 *  scene, always labelled "synthetic demo data" in the UI so it never passes for live results. */
import type { AIAnalysisResult, IncidentPriority, LiveMapData } from '../types';

export const SYNTHETIC_ENGINE = 'synthetic';
export const isSynthetic = (engine?: string | null) => engine === SYNTHETIC_ENGINE;

// English + Hindi/Hinglish cues. Severity order matters: the first rule that matches wins.
const RULES: Array<{ p: IncidentPriority; cat: string; words: RegExp; why: string }> = [
  { p: 'P1_CRITICAL', cat: 'medical', why: 'Possible life-threatening medical emergency.',
    words: /\b(not breathing|unconscious|heart attack|stroke|seizure|bleeding heavily|saans nahi|behosh|gir gay[ae]|khoon|dil ka daura|bp (low|crash|gir))\b/i },
  { p: 'P1_CRITICAL', cat: 'suspicious_activity', why: 'Threat of violence with a weapon or pursuit.',
    words: /\b(knife|gun|weapon|armed|stab|attack(ing)?|kidnap|chaku|chhuri|bandook|peecha kar|maar (raha|rahe)|bachao|help me)\b/i },
  { p: 'P1_CRITICAL', cat: 'fire', why: 'Fire or smoke reported.', words: /\b(fire|smoke|gas leak|aag|dhuan)\b/i },
  { p: 'P2_HIGH', cat: 'child_alert', why: 'A child may be missing or late.', words: /\b(child|daughter|son|beti|beta|bachcha).{0,40}(missing|late|not (back|answering)|lapata)\b/i },
  { p: 'P2_HIGH', cat: 'elder_welfare', why: 'An elderly person may need help.', words: /\b(elderly|grandfather|grandmother|dadi|dada|nani|nana|papa|mummy).{0,40}(fell|fall|alone|not answering|gir)\b/i },
  { p: 'P2_HIGH', cat: 'suspicious_activity', why: 'Suspicious person or harassment.', words: /\b(following|stalk|harass|suspicious|ghoom raha|ched|mask)\b/i },
  { p: 'P3_MODERATE', cat: 'hazard', why: 'Infrastructure or safety hazard.', words: /\b(streetlight|dark|pothole|open drain|wire|light (nahi|band)|andhera)\b/i },
];

export function syntheticTriage(text: string): AIAnalysisResult {
  const hit = RULES.find((r) => r.words.test(text));
  const p: IncidentPriority = hit?.p ?? 'P4_ADVISORY';
  const critical = p === 'P1_CRITICAL';
  return {
    parsed_category: hit?.cat ?? 'hazard',
    suggested_priority: p,
    triage_reasoning: `${hit?.why ?? 'No urgent cues found.'} (Synthetic demo response: computed on this device because the live service is unreachable.)`,
    missing_critical_info: ['Exact location or landmark', 'Number of people involved'],
    immediate_safety_checklist: critical
      ? ['Call 112 now', 'Move to a lit, populated place if you can', 'Stay on the line with a trusted contact']
      : ['Keep a safe distance', 'Note landmarks and times', 'Inform your RWA or a trusted contact'],
    retrieved_civic_protocols: [],
    advisory_notice: 'Synthetic demo data. The live AI service could not be reached, so this result was computed locally.',
    ai_engine: SYNTHETIC_ENGINE,
    rule_priority: p,
    escalated: critical,
    gemini: null,
    gemini_error: null,
  };
}

/** A small Delhi scene (around Connaught Place) for the map when the live feed is unreachable. */
export function syntheticLiveMap(): LiveMapData {
  const now = new Date().toISOString();
  return {
    city: 'New Delhi',
    center: [28.6315, 77.2167],
    incidents: [
      { id: -1, reference_code: 'DEMO-1', title: 'Demo: medical emergency, elderly resident', incident_type: 'medical', priority: 'P1_CRITICAL', status: 'reported', latitude: 28.6290, longitude: 77.2330, approximate: true, location_address: 'Bengali Market (synthetic)', mine: false, created_at: now },
      { id: -2, reference_code: 'DEMO-2', title: 'Demo: man following women near the park', incident_type: 'suspicious_activity', priority: 'P2_HIGH', status: 'acknowledged', latitude: 28.6328, longitude: 77.2183, approximate: true, location_address: 'Connaught Place (synthetic)', mine: false, created_at: now },
    ],
    responders: [
      { user_id: -1, label: 'Demo responder', service_type: 'security', latitude: 28.6390, longitude: 77.2090, source: 'base', is_available: true, heading_to_incident_id: null, progress: null, eta_seconds: null, route: [], updated_at: now },
    ],
    hazards: [
      { id: -1, title: 'Demo: streetlight out', hazard_type: 'lighting', severity: 'medium', latitude: 28.6285, longitude: 77.2212, address: 'Tolstoy Marg (synthetic)', status: 'open' },
    ],
    server_time: now,
    demo_mode: true,
  };
}
