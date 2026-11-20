/** Overlay buttons shared by both map engines: "recenter on me" (real device GPS) and the day/night toggle. */
import { useState } from 'react';
import { LocateFixed, Moon, Sun } from 'lucide-react';
import type { MapTheme } from './mapTheme';

export type Fix = { lat: number; lng: number; accuracy: number };

/** One high-accuracy GPS fix from the device. Rejects with a human-readable reason. */
export function getDeviceLocation(timeoutMs = 10000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new Error('This browser has no location support.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED
        ? 'Location permission denied (allow location for this site).'
        : 'Could not get your location (no GPS signal). Try again.')),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

export function MapControls({ theme, onToggleTheme, onLocated }: {
  theme: MapTheme; onToggleTheme: () => void; onLocated: (f: Fix) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const locate = async () => {
    setBusy(true); setNote(null);
    try {
      const f = await getDeviceLocation();
      onLocated(f);
      setNote(`You are here (±${Math.round(f.accuracy)} m)`);
    } catch (e: any) {
      setNote(e.message);
    } finally {
      setBusy(false);
      window.setTimeout(() => setNote(null), 5000);
    }
  };
  const btn = 'nsin-map-btn';
  return (
    <div className="nsin-map-controls">
      <button type="button" className={btn} onClick={locate} disabled={busy} title="Recenter on me" aria-label="Recenter on me">
        <LocateFixed className={`w-4 h-4 ${busy ? 'animate-pulse' : ''}`} />
      </button>
      <button type="button" className={btn} onClick={onToggleTheme}
        title={theme === 'day' ? 'Switch map to night' : 'Switch map to day'} aria-label="Toggle day or night map">
        {theme === 'day' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
      </button>
      {note && <div className="nsin-map-note" role="status">{note}</div>}
    </div>
  );
}
