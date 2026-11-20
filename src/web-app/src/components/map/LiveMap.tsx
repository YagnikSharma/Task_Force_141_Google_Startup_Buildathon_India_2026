/** One map component, two engines: Google Maps when VITE_GOOGLE_MAPS_API_KEY is set at build time,
 *  otherwise the free MapLibre/OpenFreeMap engine. Both are lazy-loaded so pages without a map stay small. */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import type { LiveMapData } from '../../types';
import type { LiveMapProps } from './types';
import './map.css';

export const MAP_ENGINE: 'google' | 'maplibre' = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? 'google' : 'maplibre';

const Engine = lazy(() => (MAP_ENGINE === 'google' ? import('./GoogleLiveMap') : import('./MapLibreMap')));

export function LiveMap(props: LiveMapProps) {
  return (
    <Suspense fallback={<div className={`${props.className ?? ''} nsin-map-loading`}>Loading map…</div>}>
      <Engine {...props} />
    </Suspense>
  );
}

/** Polls /map/live. Pauses while the tab is hidden, so an idle tab costs no requests. */
export function useLiveMap(pollMs = 4000, enabled = true) {
  const [data, setData] = useState<LiveMapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      setData(await api.getLiveMap());
      setUpdatedAt(new Date());
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Live map unavailable');
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const loop = async () => {
      if (stopped) return;
      if (document.visibilityState === 'visible') await refresh();
      timer.current = window.setTimeout(loop, pollMs);
    };
    loop();
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { stopped = true; window.clearTimeout(timer.current); document.removeEventListener('visibilitychange', onVis); };
  }, [enabled, pollMs, refresh]);

  return { data, error, updatedAt, refresh };
}
