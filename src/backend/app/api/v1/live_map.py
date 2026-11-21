"""Live community map: open incidents, responders (GPS, simulated or at base) and hazards, in one poll.

Privacy rules (same spirit as the incident API):
  * Staff see exact coordinates and names.
  * Residents see their own incidents exactly; other residents' public alerts are rounded to ~110 m.
  * Residents see responders as units ("Security unit CP-704"); the name is shown only to the
    resident whose incident that responder is handling.
"""
import datetime
import math
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session, selectinload

from backend.app.api.deps import ensure_verified_staff, get_current_user, is_staff
from backend.app.api.v1.incidents import ACTIVE_STATUSES, PUBLIC_INCIDENT_TYPES, _apply_status, _get_visible_incident
from backend.app.core.audit import record_audit
from backend.app.core.config import settings
from backend.app.database.base import get_db
from backend.app.models.entities import CommunityHazard, Incident, LocationEvent, Responder, ResponderTrack, User
from backend.app.schemas.safety_schemas import (
    LiveMapResponse, MapHazard, MapIncident, MapResponder, ResponderLocationPing,
)

router = APIRouter(prefix="/map", tags=["Live Map"])

ROAD_SPEED_MPS = 8.3  # ~30 km/h, a realistic city speed for a two-wheeler responder
DEMO_DRIVE_MPS = 10.0  # ~36 km/h for simulated demo drives
EN_ROUTE_STATUSES = ("acknowledged", "responder_en_route")


def _metres(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    """Haversine distance in metres between (lat, lng) pairs."""
    lat1, lng1, lat2, lng2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 6_371_000 * 2 * math.asin(math.sqrt(h))


def street_route(start: Tuple[float, float], end: Tuple[float, float]) -> List[Tuple[float, float]]:
    """A street-like dog-leg path (east-west, then north-south, then east-west) instead of a straight
    line through buildings. Good enough for a demo without paying for a routing API."""
    mid_lng = start[1] + (end[1] - start[1]) * 0.55
    return [start, (start[0], mid_lng), (end[0], mid_lng), end]


def point_along(route: List[Tuple[float, float]], fraction: float) -> Tuple[float, float]:
    fraction = min(1.0, max(0.0, fraction))
    legs = [_metres(route[i], route[i + 1]) for i in range(len(route) - 1)]
    target = sum(legs) * fraction
    for i, leg in enumerate(legs):
        if target <= leg or i == len(legs) - 1:
            t = 0.0 if leg == 0 else min(1.0, target / leg)
            (a_lat, a_lng), (b_lat, b_lng) = route[i], route[i + 1]
            return a_lat + (b_lat - a_lat) * t, a_lng + (b_lng - a_lng) * t
        target -= leg
    return route[-1]


def _service_label(service_type: Optional[str]) -> str:
    return (service_type or "community_patrol").replace("_", " ").title()


@router.get("/live", response_model=LiveMapResponse)
def live_map(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    now = datetime.datetime.utcnow()
    staff = is_staff(current_user)

    # Incidents: open ones with coordinates, filtered by what this viewer may see.
    q = db.query(Incident).filter(Incident.status.in_(ACTIVE_STATUSES), Incident.latitude.isnot(None),
                                  Incident.longitude.isnot(None))
    if not staff:
        q = q.filter((Incident.reporter_id == current_user.id) | (Incident.incident_type.in_(PUBLIC_INCIDENT_TYPES)))
    incidents = q.order_by(Incident.priority.asc(), Incident.created_at.desc()).limit(200).all()
    by_id: Dict[int, Incident] = {i.id: i for i in incidents}

    map_incidents = []
    for inc in incidents:
        mine = inc.reporter_id == current_user.id
        exact = staff or mine
        map_incidents.append(MapIncident(
            id=inc.id, reference_code=inc.reference_code, title=inc.title, incident_type=inc.incident_type,
            priority=inc.priority, status=inc.status,
            latitude=inc.latitude if exact else round(inc.latitude, 3),
            longitude=inc.longitude if exact else round(inc.longitude, 3),
            approximate=not exact, location_address=inc.location_address,
            assigned_responder_id=inc.assigned_responder_id, mine=mine, created_at=inc.created_at,
        ))

    # Responders: latest live GPS ping wins, then an active (simulated) track, then the home base.
    since = now - datetime.timedelta(seconds=settings.RESPONDER_PING_TTL_SECONDS)
    latest_ping: Dict[int, LocationEvent] = {}
    for ev in db.query(LocationEvent).filter(LocationEvent.event_type == "responder_ping",
                                             LocationEvent.timestamp >= since) \
            .order_by(LocationEvent.timestamp.desc()).limit(500):
        latest_ping.setdefault(ev.user_id, ev)
    tracks: Dict[int, ResponderTrack] = {}
    for t in db.query(ResponderTrack).filter(ResponderTrack.active.is_(True)).order_by(ResponderTrack.started_at.desc()):
        tracks.setdefault(t.responder_user_id, t)

    map_responders = []
    for prof in db.query(Responder).options(selectinload(Responder.user)).all():
        user = prof.user
        if user is None or not user.is_active:
            continue
        # Which open incident is this responder heading to?
        target: Optional[Incident] = None
        track = tracks.get(user.id)
        if track and track.incident_id in by_id:
            target = by_id[track.incident_id]
        else:
            target = next((i for i in incidents if i.assigned_responder_id == user.id and i.status in EN_ROUTE_STATUSES), None)
        if target is None and track is not None:
            track = None  # incident closed or not visible to this viewer

        ping = latest_ping.get(user.id)
        route: List[List[float]] = []
        progress = eta = None
        if ping is not None:
            lat, lng, source, updated = ping.latitude, ping.longitude, "gps", ping.timestamp
        elif track is not None and target is not None:
            path = street_route((track.from_lat, track.from_lng), (target.latitude, target.longitude))
            elapsed = (now - track.started_at).total_seconds()
            progress = min(1.0, elapsed / max(1, track.duration_seconds))
            lat, lng = point_along(path, progress)
            source, updated = "simulated", now
            eta = max(0, int(track.duration_seconds - elapsed))
            route = [[p[0], p[1]] for p in path]
        elif prof.current_lat is not None and prof.current_lng is not None:
            lat, lng, source, updated = prof.current_lat, prof.current_lng, "base", prof.created_at
        else:
            continue

        if target is not None and eta is None:
            eta = int(_metres((lat, lng), (target.latitude, target.longitude)) / ROAD_SPEED_MPS)
        if target is not None and not route:
            route = [[lat, lng], [target.latitude, target.longitude]]

        handles_my_incident = target is not None and target.reporter_id == current_user.id
        unit = f"{_service_label(prof.service_type)} unit {prof.badge_number}"
        label = f"{user.full_name} · {prof.badge_number}" if (staff or handles_my_incident) else unit
        map_responders.append(MapResponder(
            user_id=user.id, label=label, service_type=prof.service_type or "community_patrol",
            latitude=lat, longitude=lng, source=source, is_available=bool(prof.is_available),
            heading_to_incident_id=target.id if target else None, progress=progress, eta_seconds=eta,
            route=route, updated_at=updated,
        ))

    hazards = db.query(CommunityHazard).filter(CommunityHazard.status.in_(["active", "verified"]),
                                               CommunityHazard.latitude.isnot(None)).limit(200).all()
    return LiveMapResponse(
        city=settings.MAP_CITY, center=settings.MAP_CENTER, incidents=map_incidents, responders=map_responders,
        hazards=[MapHazard(id=h.id, title=h.title, hazard_type=h.hazard_type, severity=h.severity,
                           latitude=h.latitude, longitude=h.longitude, address=h.address, status=h.status)
                 for h in hazards],
        server_time=now, demo_mode=settings.DEMO_MODE,
    )


@router.post("/responder-location", status_code=status.HTTP_204_NO_CONTENT)
def responder_location(
    req: ResponderLocationPing,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """A responder's phone/browser shares GPS while on duty (every ~10 s while en route)."""
    ensure_verified_staff(current_user)
    db.add(LocationEvent(incident_id=req.incident_id, user_id=current_user.id, latitude=req.latitude,
                         longitude=req.longitude, accuracy=req.accuracy, event_type="responder_ping",
                         timestamp=datetime.datetime.utcnow()))
    # A real GPS position supersedes any simulated drive for this responder.
    db.query(ResponderTrack).filter(ResponderTrack.responder_user_id == current_user.id,
                                    ResponderTrack.active.is_(True), ResponderTrack.simulated.is_(True)) \
        .update({ResponderTrack.active: False}, synchronize_session=False)
    db.commit()


@router.post("/demo/dispatch/{incident_id}", response_model=MapResponder)
def demo_dispatch(
    incident_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Demo mode: send a simulated responder from their base to the incident over ~90 s, so the
    live map shows a moving unit without anyone driving around the city."""
    if not settings.DEMO_MODE:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Demo mode is off.")
    ensure_verified_staff(current_user)
    incident = _get_visible_incident(db, incident_id, current_user)
    if incident.latitude is None or incident.longitude is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This incident has no map location.")
    if incident.status not in ACTIVE_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only open incidents can be dispatched.")

    responder_id = incident.assigned_responder_id
    if responder_id is None:
        # Nearest available responder with a base location.
        candidates = [p for p in db.query(Responder).filter(Responder.is_available.is_(True)).all()
                      if p.current_lat is not None]
        if not candidates:
            raise HTTPException(status.HTTP_409_CONFLICT, "No available responder with a base location.")
        nearest = min(candidates, key=lambda p: _metres((p.current_lat, p.current_lng), (incident.latitude, incident.longitude)))
        responder_id = nearest.user_id
        incident.assigned_responder_id = responder_id
    prof = db.query(Responder).filter(Responder.user_id == responder_id).first()
    if prof is None or prof.current_lat is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "The assigned responder has no base location.")

    if incident.status in ("reported", "acknowledged"):
        _apply_status(db, incident, "responder_en_route", current_user,
                      "Responder dispatched and en route (live tracking on the community map).", request)
    db.query(ResponderTrack).filter(ResponderTrack.responder_user_id == responder_id, ResponderTrack.active.is_(True)) \
        .update({ResponderTrack.active: False}, synchronize_session=False)
    # Drive time from the street distance at a city speed of ~36 km/h (bounded for the demo).
    path = street_route((prof.current_lat, prof.current_lng), (incident.latitude, incident.longitude))
    distance = sum(_metres(path[i], path[i + 1]) for i in range(len(path) - 1))
    track = ResponderTrack(responder_user_id=responder_id, incident_id=incident.id, from_lat=prof.current_lat,
                           from_lng=prof.current_lng, started_at=datetime.datetime.utcnow(),
                           duration_seconds=int(min(600, max(30, distance / DEMO_DRIVE_MPS))), simulated=True, active=True)
    db.add(track)
    record_audit(db, "demo_dispatch", "incident", incident.id, user_id=current_user.id, request=request,
                 details={"responder_user_id": responder_id, "duration_s": track.duration_seconds})
    db.commit()
    path = street_route((track.from_lat, track.from_lng), (incident.latitude, incident.longitude))
    return MapResponder(
        user_id=responder_id, label=prof.badge_number, service_type=prof.service_type or "community_patrol",
        latitude=track.from_lat, longitude=track.from_lng, source="simulated", is_available=bool(prof.is_available),
        heading_to_incident_id=incident.id, progress=0.0, eta_seconds=track.duration_seconds,
        route=[[p[0], p[1]] for p in path], updated_at=track.started_at,
    )
