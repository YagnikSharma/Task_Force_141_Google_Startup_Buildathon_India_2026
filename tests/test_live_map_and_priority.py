"""Human priority override, the rule floor on new reports, and the live community map."""
from backend.app.api.v1.live_map import point_along, street_route

API = "/api/v1"


def _create(client, headers, **kw):
    body = {"title": "Streetlight out", "description": "Dark lane after sunset near the park.",
            "incident_type": "hazard", "priority": "P3_MODERATE",
            "location_address": "Lane 9, Gole Market", "latitude": 28.6360, "longitude": 77.2060, **kw}
    res = client.post(f"{API}/incidents", json=body, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


# --- Priority ---------------------------------------------------------------------------------

def test_rule_floor_stops_a_report_being_filed_below_the_safety_rules(client, resident):
    inc = _create(client, resident, title="Man with a knife", incident_type="suspicious_activity",
                  description="A man is threatening people with a knife outside the gate.", priority="P4_ADVISORY")
    assert inc["priority"] == "P1_CRITICAL"


def test_report_may_be_raised_above_the_rules(client, resident):
    assert _create(client, resident, priority="P2_HIGH")["priority"] == "P2_HIGH"


def test_staff_override_requires_a_reason_and_is_on_the_timeline(client, resident, responder):
    inc = _create(client, resident)
    url = f"{API}/incidents/{inc['id']}/priority"
    assert client.post(url, headers=responder, json={"priority": "P1_CRITICAL"}).status_code == 422
    assert client.post(url, headers=responder, json={"priority": "P1_CRITICAL", "reason": "short"}).status_code == 422
    res = client.post(url, headers=responder,
                      json={"priority": "P1_CRITICAL", "reason": "Live wire is hanging over the lane."})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["priority"] == "P1_CRITICAL"
    assert any("Priority changed P3_MODERATE" in (h["notes"] or "") for h in body["status_history"])
    # Same priority again is a conflict, not a silent no-op.
    assert client.post(url, headers=responder,
                       json={"priority": "P1_CRITICAL", "reason": "Live wire is hanging over the lane."}).status_code == 409


def test_residents_cannot_override_priority(client, resident):
    inc = _create(client, resident)
    res = client.post(f"{API}/incidents/{inc['id']}/priority", headers=resident,
                      json={"priority": "P4_ADVISORY", "reason": "I think it is not urgent."})
    assert res.status_code == 403


# --- Live map ---------------------------------------------------------------------------------

def test_street_route_starts_and_ends_at_the_right_points():
    route = street_route((28.62, 77.21), (28.63, 77.22))
    assert route[0] == (28.62, 77.21) and route[-1] == (28.63, 77.22)
    assert point_along(route, 0) == (28.62, 77.21)
    assert point_along(route, 1) == (28.63, 77.22)
    mid = point_along(route, 0.5)
    assert 28.62 <= mid[0] <= 28.63 and 77.21 <= mid[1] <= 77.22


def test_live_map_masks_other_residents_alerts(client, resident, responder):
    from conftest import auth_headers, unique_email
    inc = _create(client, resident, latitude=28.631234, longitude=77.216567)

    staff_view = client.get(f"{API}/map/live", headers=responder).json()
    mine = next(i for i in staff_view["incidents"] if i["id"] == inc["id"])
    assert (mine["latitude"], mine["approximate"]) == (28.631234, False)
    assert staff_view["city"] == "New Delhi"

    email = unique_email("neighbour")
    assert client.post(f"{API}/auth/register", json={"email": email, "password": "Password123!",
                                                     "full_name": "Neighbour"}).status_code in (200, 201)
    other = auth_headers(client, email)
    seen = next(i for i in client.get(f"{API}/map/live", headers=other).json()["incidents"] if i["id"] == inc["id"])
    assert (seen["latitude"], seen["longitude"], seen["approximate"]) == (28.631, 77.217, True)


def test_demo_dispatch_moves_a_simulated_responder_to_the_incident(client, resident, responder):
    inc = _create(client, resident)
    res = client.post(f"{API}/map/demo/dispatch/{inc['id']}", headers=responder)
    assert res.status_code == 200, res.text
    unit = res.json()
    assert unit["heading_to_incident_id"] == inc["id"] and unit["source"] == "simulated"
    assert client.get(f"{API}/incidents/{inc['id']}", headers=responder).json()["status"] == "responder_en_route"

    live = client.get(f"{API}/map/live", headers=responder).json()
    moving = next(r for r in live["responders"] if r["user_id"] == unit["user_id"])
    assert moving["heading_to_incident_id"] == inc["id"] and moving["eta_seconds"] is not None
    # Residents may not dispatch.
    assert client.post(f"{API}/map/demo/dispatch/{inc['id']}", headers=resident).status_code == 403


def test_responder_gps_ping_wins_over_simulation(client, resident, responder):
    inc = _create(client, resident)
    client.post(f"{API}/map/demo/dispatch/{inc['id']}", headers=responder)
    ping = {"latitude": 28.6340, "longitude": 77.2120, "accuracy": 12, "incident_id": inc["id"]}
    assert client.post(f"{API}/map/responder-location", headers=responder, json=ping).status_code == 204
    live = client.get(f"{API}/map/live", headers=responder).json()
    gps = [r for r in live["responders"] if r["source"] == "gps"]
    assert any(abs(r["latitude"] - 28.6340) < 1e-9 for r in gps)
    assert client.post(f"{API}/map/responder-location", headers=resident, json=ping).status_code == 403
