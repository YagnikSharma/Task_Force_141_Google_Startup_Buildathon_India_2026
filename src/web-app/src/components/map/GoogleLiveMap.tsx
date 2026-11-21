/** Google Maps engine (used when VITE_GOOGLE_MAPS_API_KEY is set): vector map tilted to 45°
 *  so city buildings render in 3D, Advanced Markers and live route polylines. */
import { useEffect, useState } from 'react';
import { APIProvider, AdvancedMarker, ColorScheme, InfoWindow, Map, useMap } from '@vis.gl/react-google-maps';
import { MapControls, type Fix } from './MapControls';
import { useMapTheme } from './mapTheme';
import type { LiveMapProps } from './types';
import { DEFAULT_CENTER } from './types';
import {
  hazardMarkerHtml, hazardPopupHtml, incidentMarkerHtml, incidentPopupHtml,
  responderMarkerHtml, responderPopupHtml,
} from './markers';

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
// A Map ID with vector rendering enables tilt and 3D buildings. DEMO_MAP_ID works for development.
const MAP_ID = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string) || 'DEMO_MAP_ID';
const APP_BASE = import.meta.env.BASE_URL;

type Open = { lat: number; lng: number; html: string } | null;

function Routes({ data, focusIncidentId }: Pick<LiveMapProps, 'data' | 'focusIncidentId'>) {
  const map = useMap();
  useEffect(() => {
    if (!map || !data) return;
    const lines = data.responders
      .filter((r) => r.heading_to_incident_id && r.route.length > 1 &&
        (focusIncidentId == null || r.heading_to_incident_id === focusIncidentId))
      .map((r) => new google.maps.Polyline({
        map,
        path: r.route.map(([lat, lng]) => ({ lat, lng })),
        strokeOpacity: 0,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: '#1a73e8', scale: 4 }, offset: '0', repeat: '14px' }],
      }));
    return () => lines.forEach((l) => l.setMap(null));
  }, [map, data, focusIncidentId]);
  return null;
}

function Focus({ data, focusIncidentId, pick }: Pick<LiveMapProps, 'data' | 'focusIncidentId' | 'pick'>) {
  const map = useMap();
  const [done, setDone] = useState<number | null>(null);
  useEffect(() => {
    if (!map || !data || focusIncidentId == null || done === focusIncidentId) return;
    const inc = data.incidents.find((i) => i.id === focusIncidentId);
    if (inc) { map.panTo({ lat: inc.latitude, lng: inc.longitude }); map.setZoom(17); setDone(focusIncidentId); }
  }, [map, data, focusIncidentId, done]);
  useEffect(() => {
    if (map && pick) { map.panTo({ lat: pick.lat, lng: pick.lng }); if ((map.getZoom() || 0) < 16) map.setZoom(17); }
    // only when the pin is first placed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pick == null]);
  return null;
}

/** Pans to the device's GPS fix when the user presses "recenter on me". */
function Recenter({ me }: { me: Fix | null }) {
  const map = useMap();
  useEffect(() => {
    if (map && me) { map.panTo({ lat: me.lat, lng: me.lng }); if ((map.getZoom() || 0) < 16) map.setZoom(16); }
  }, [map, me]);
  return null;
}

export default function GoogleLiveMap({ data, focusIncidentId, pick, onPick, center, className, interactive3d = true }: LiveMapProps) {
  const [open, setOpen] = useState<Open>(null);
  const [me, setMe] = useState<Fix | null>(null);
  const [theme, toggleTheme] = useMapTheme();
  const c = center || data?.center || DEFAULT_CENTER;
  return (
    <div className={`${className ?? ''} nsin-map-wrap`}>
      <APIProvider apiKey={KEY}>
        <Map
          // The colour scheme is fixed when a Google map is created, so day/night remounts it.
          key={theme}
          colorScheme={theme === 'night' ? ColorScheme.DARK : ColorScheme.LIGHT}
          mapId={MAP_ID}
          defaultCenter={{ lat: c[0], lng: c[1] }}
          defaultZoom={14}
          defaultTilt={interactive3d ? 45 : 0}
          defaultHeading={0}
          // Simple pan and zoom only: no rotate or tilt gestures, no rotate control.
          headingInteractionEnabled={false}
          tiltInteractionEnabled={false}
          rotateControl={false}
          gestureHandling="greedy"
          renderingType="VECTOR"
          clickableIcons={false}
          style={{ width: '100%', height: '100%' }}
          onClick={(e) => { setOpen(null); const ll = e.detail.latLng; if (ll && onPick) onPick(ll.lat, ll.lng); }}
        >
          {data?.hazards.map((h) => (
            <AdvancedMarker key={`h${h.id}`} position={{ lat: h.latitude, lng: h.longitude }} zIndex={1}
              onClick={() => setOpen({ lat: h.latitude, lng: h.longitude, html: hazardPopupHtml(h) })}>
              <div dangerouslySetInnerHTML={{ __html: hazardMarkerHtml(h) }} />
            </AdvancedMarker>
          ))}
          {data?.incidents.map((i) => (
            <AdvancedMarker key={`i${i.id}`} position={{ lat: i.latitude, lng: i.longitude }} zIndex={i.id === focusIncidentId ? 3 : 2}
              onClick={() => setOpen({ lat: i.latitude, lng: i.longitude, html: incidentPopupHtml(i, APP_BASE) })}>
              <div dangerouslySetInnerHTML={{ __html: incidentMarkerHtml(i, i.id === focusIncidentId) }} />
            </AdvancedMarker>
          ))}
          {data?.responders.map((r) => (
            <AdvancedMarker key={`r${r.user_id}`} position={{ lat: r.latitude, lng: r.longitude }} zIndex={4}
              onClick={() => setOpen({ lat: r.latitude, lng: r.longitude, html: responderPopupHtml(r) })}>
              <div dangerouslySetInnerHTML={{ __html: responderMarkerHtml(r) }} />
            </AdvancedMarker>
          ))}
          {pick && (
            <AdvancedMarker position={{ lat: pick.lat, lng: pick.lng }} draggable zIndex={5}
              onDragEnd={(e) => { const ll = e.latLng; if (ll && onPick) onPick(ll.lat(), ll.lng()); }}>
              <div className="nsin-pick" />
            </AdvancedMarker>
          )}
          {open && (
            <InfoWindow position={{ lat: open.lat, lng: open.lng }} onCloseClick={() => setOpen(null)} pixelOffset={[0, -14]}>
              <div dangerouslySetInnerHTML={{ __html: open.html }} />
            </InfoWindow>
          )}
          <Routes data={data} focusIncidentId={focusIncidentId} />
          {me && (
            <AdvancedMarker position={{ lat: me.lat, lng: me.lng }} zIndex={6} title="You are here">
              <div className="nsin-me" />
            </AdvancedMarker>
          )}
          <Focus data={data} focusIncidentId={focusIncidentId} pick={pick} />
          <Recenter me={me} />
        </Map>
      </APIProvider>
      <MapControls theme={theme} onToggleTheme={toggleTheme} onLocated={(f) => setMe({ ...f })} />
    </div>
  );
}
