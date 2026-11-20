/** Day/night look for the map tiles, shared by every map on the page and remembered in localStorage.
 *  The first visit follows the device's light/dark setting. */
import { useSyncExternalStore } from 'react';

export type MapTheme = 'day' | 'night';
const KEY = 'nsin-map-theme';
const listeners = new Set<() => void>();

function initial(): MapTheme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'day' || saved === 'night') return saved;
  } catch { /* storage blocked */ }
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
}

let current: MapTheme = initial();

export function setMapTheme(t: MapTheme) {
  current = t;
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export function useMapTheme(): [MapTheme, () => void] {
  const theme = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => current,
    () => current,
  );
  return [theme, () => setMapTheme(theme === 'day' ? 'night' : 'day')];
}
