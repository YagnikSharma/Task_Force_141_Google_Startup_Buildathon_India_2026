import type { LiveMapData } from '../../types';

export interface LiveMapProps {
  data: LiveMapData | null;
  /** Centre and highlight one incident (incident detail page). */
  focusIncidentId?: number;
  /** Report page: let the user tap the map to place the pin. */
  pick?: { lat: number; lng: number } | null;
  onPick?: (lat: number, lng: number) => void;
  /** Fallback centre before data arrives. */
  center?: [number, number];
  className?: string;
  interactive3d?: boolean;
}

/** Fallback centre before data arrives: Connaught Place, New Delhi. */
export const DEFAULT_CENTER: [number, number] = [28.6315, 77.2167];
