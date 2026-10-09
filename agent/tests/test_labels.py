"""Bewust uit en categorieën (labels.py): automatische regels, groups.yml, instellingen uit de app, health en meldingen."""

import time

from hal_agent.collectors.containers import sanitize_inspect
from hal_agent.config import YamlConfig
from hal_agent.health import compute_health, counts
from hal_agent.labels import Labels, LabelStore, auto_parked, base_domain, match_any, parked_keys
from hal_agent.maintenance import EventStore, conditions


def _labels(tmp_path, yml: str = "") -> Labels:
    (tmp_path / "groups.yml").write_text(yml)
    return Labels(YamlConfig(tmp_path / "groups.yml", {"auto_parked": True, "parked": [], "groups": {}}), LabelStore(tmp_path / "labels.json"))


def svc(name, active="active", enabled="enabled", custom=True):
    return {"name": f"{name}.service", "active": active, "sub": "", "enabled": enabled, "custom": custom, "description": ""}


def ctr(name, state="running", exit_code=0, policy="unless-stopped", project="los", ports=(), health="geen"):
    return {"name": name, "state": state, "exit_code": exit_code, "restart_policy": policy, "project": project,
            "host_ports": list(ports), "ports": [], "health": health}


def site(host, state="up", local=None, source=None):
    return {"hostname": host, "state": state, "local": local, "source": source, "status_code": 200 if state == "up" else 502}


# Automatische regels ---------------------------------------------------------------------


def test_auto_rules_services():
    assert auto_parked("service", svc("a", "failed", "disabled")) == "disabled"
    assert auto_parked("service", svc("a", "inactive", "masked")) == "disabled"
    assert auto_parked("service", svc("a", "failed", "enabled")) is None  # gefaald en nog aan: echt probleem
    assert auto_parked("service", svc("a", "inactive", "static")) is None  # timerdienst die rust
    assert auto_parked("service", svc("a", "active", "disabled")) is None


def test_auto_rules_containers():
    assert auto_parked("container", ctr("a", "exited", 0, "no")) == "stopped"
    assert auto_parked("container", ctr("a", "exited", 137, "unless-stopped")) == "stopped"
    assert auto_parked("container", ctr("a", "exited", 143, "always")) == "stopped"
    assert auto_parked("container", ctr("a", "exited", 1, "on-failure")) is None  # crash
    assert auto_parked("container", ctr("a", "exited", 1, "unless-stopped")) is None  # crash binnen 10 s: Docker herstart niet
    assert auto_parked("container", ctr("a", "exited", 127, "unless-stopped")) is None  # kon niet starten
    assert auto_parked("container", ctr("a", "exited", 143, "no")) is None  # geen herstartbeleid: niets te zeggen
    assert auto_parked("container", {**ctr("a", "exited", 137, "always"), "oom_killed": True}) is None
    assert auto_parked("container", ctr("a", "created", 0)) is None
    assert auto_parked("container", ctr("a", "running")) is None


def test_stopped_container_is_never_unhealthy():
    stopped = sanitize_inspect({"State": {"Status": "exited", "Running": False, "ExitCode": 0, "Health": {"Status": "unhealthy"}},
                                "HostConfig": {"PortBindings": {"80/tcp": [{"HostIp": "127.0.0.1", "HostPort": "8081"}], "5432/tcp": None}}})
    assert stopped["health"] == "geen" and stopped["last_health"] == "unhealthy"
    assert stopped["host_ports"] == [8081]
    running = sanitize_inspect({"State": {"Status": "running", "Running": True, "Health": {"Status": "unhealthy"}}})
    assert running["health"] == "unhealthy"
    # Ook zonder labels: een gestopte container met een oude healthcheck geeft geen "ongezond".
    h = compute_health({}, [], [], [], [ctr("db", "exited", 0, health="unhealthy")], [], [])
    assert not [r for r in h["reasons"] if r["code"] == "containers_unhealthy"]


# Sites koppelen aan hun backend ------------------------------------------------------------


def test_site_follows_parked_tunnel_container_and_port(tmp_path):
    lb = _labels(tmp_path)
    containers = [ctr("demo2-tunnel", "exited", 0, "always", project="demo2"), ctr("game-1", "exited", 137, ports=[4310]),
                  ctr("web-1", "running", ports=[8080])]
    sites = [site("demo2.example.com", "down", None, "demo2-tunnel"), site("game.example.com", "down", "http://127.0.0.1:4310", "home"),
             site("web.example.com", "down", "http://127.0.0.1:8080", "home"), site("up.example.com", "up", "http://127.0.0.1:4310")]
    _, c, s = lb.annotate([], containers, sites)
    by = {x["hostname"]: x for x in s}
    assert by["demo2.example.com"]["parked"] and by["demo2.example.com"]["parked_reason"] == "backend"
    assert by["game.example.com"]["parked"]
    assert not by["web.example.com"]["parked"]  # backend draait: echt probleem
    assert not by["up.example.com"]["parked"]  # antwoordt: wordt gewoon bewaakt
    assert [x["name"] for x in c if x["parked"]] == ["demo2-tunnel", "game-1"]


def test_site_follows_disabled_service_via_unit_file_and_registry(tmp_path):
    lb = _labels(tmp_path)
    unit = tmp_path / "vr-room.service"
    unit.write_text("[Service]\nEnvironmentFile=/etc/secret.env\nExecStart=/usr/bin/node server.js --port 3002\n")
    services = [svc("vr-room", "inactive", "disabled"), svc("office", "failed", "disabled")]
    sites = [site("vr.example.com", "down", "http://127.0.0.1:3002"), site("office.example.com", "down", "http://localhost:8096"),
             site("other.example.com", "down", "http://127.0.0.1:9999")]
    registry = [{"port": 8096, "address": "127.0.0.1", "service": "office (3D)"}]
    _, _, s = lb.annotate(services, [], sites, {"vr-room.service": str(unit)}, registry)
    by = {x["hostname"]: x["parked"] for x in s}
    assert by == {"vr.example.com": True, "office.example.com": True, "other.example.com": False}


# groups.yml en de app ------------------------------------------------------------------------


def test_config_patterns_and_prefixes(tmp_path):
    lb = _labels(tmp_path, """
parked:
  - project:oldstack
  - site:legacy.*
  - flaky
groups:
  Klanten:
    - shop*
    - site:*.client.be
  Data:
    - "*postgres*"
""")
    services = [svc("flaky", "failed", "enabled"), svc("shop-api"), svc("cron", custom=False), svc("mine")]
    containers = [ctr("oldstack-db-1", "exited", 1, "no", project="oldstack"), ctr("shop-postgres", "running"), ctr("x-postgres", "running"),
                  ctr("flaky", "running")]
    sites = [site("legacy.example.com", "down"), site("www.client.be"), site("a.example.com"), site("b.example.com"), site("solo.org")]
    s, c, st = lb.annotate(services, containers, sites)
    sv = {x["name"]: x for x in s}
    assert sv["flaky.service"]["parked"] and sv["flaky.service"]["parked_reason"] == "config"
    assert sv["shop-api.service"]["group"] == "Klanten" and sv["shop-api.service"]["group_source"] == "config"
    assert sv["cron.service"]["group"] == "Systeem" and sv["mine.service"]["group"] == "Eigen diensten"
    assert sv["cron.service"]["group_order"] > sv["mine.service"]["group_order"] > sv["shop-api.service"]["group_order"]
    cv = {x["name"]: x for x in c}
    assert cv["oldstack-db-1"]["parked"]  # via project:, zelfs met exitcode 1
    assert cv["shop-postgres"]["group"] == "Klanten"  # eerste match wint
    assert cv["x-postgres"]["group"] == "Data"
    assert not cv["flaky"]["parked"] and cv["flaky"]["parked_rule"] == "config"  # draait: gewoon bewaakt
    sv2 = {x["hostname"]: x for x in st}
    assert sv2["legacy.example.com"]["parked"]
    assert sv2["www.client.be"]["group"] == "Klanten"
    assert sv2["a.example.com"]["group"] == "example.com"
    assert sv2["solo.org"]["group"] == "Andere domeinen"


def test_app_setting_wins(tmp_path):
    lb = _labels(tmp_path, "groups:\n  Werk:\n    - api*\n")
    lb.store.set("service", "api.service", {"group": "Klanten"})
    lb.store.set("service", "broken.service", {"parked": True})
    lb.store.set("container", "done-1", {"parked": False})
    s, c, _ = lb.annotate([svc("api"), svc("broken", "failed")], [ctr("done-1", "exited", 0)], [])
    sv = {x["name"]: x for x in s}
    assert sv["api.service"]["group"] == "Klanten" and sv["api.service"]["group_source"] == "app"
    assert sv["broken.service"]["parked"] and sv["broken.service"]["parked_reason"] == "app"
    assert c[0]["parked"] is False and c[0]["parked_setting"] is False and c[0]["parked_rule"] == "stopped"
    assert [g["name"] for g in lb.group_names()] == ["Werk", "Klanten"]
    # Terug naar automatisch: het item verdwijnt uit labels.json.
    lb.store.set("container", "done-1", {"parked": None})
    assert "container:done-1" not in lb.store.items()
    assert oct((tmp_path / "labels.json").stat().st_mode & 0o777) == "0o640"


def test_match_any_and_domains():
    assert match_any(["web*"], "service", {"service": "web-api"})
    assert not match_any(["site:web*"], "service", {"service": "web-api"})
    assert match_any(["project:media"], "container", {"container": "jelly", "project": "media"})
    assert base_domain("a.b.example.co.uk") == "example.co.uk" and base_domain("x.y.example.be") == "example.be"


# Health, tellers en meldingen ----------------------------------------------------------------


def test_health_counts_and_events_ignore_parked(tmp_path):
    lb = _labels(tmp_path)
    services = [svc("office", "failed", "disabled"), svc("api", "active")]
    containers = [ctr("demo-tunnel", "exited", 0, "always"), ctr("demo-db", "exited", 0, "always", health="unhealthy"), ctr("web", "running")]
    sites = [site("demo.example.com", "down", source="demo-tunnel"), site("ok.example.com")]
    s, c, st = lb.annotate(services, containers, sites, with_groups=False)
    h = compute_health({}, [], [], s, c, st, [])
    assert h["status"] == "ok" and h["reasons"] == []
    k = counts(s, c, st, [])
    assert k["services"] == {"active": 1, "failed": 0, "total": 1, "parked": 1, "all": 2}
    assert k["containers"] == {"running": 1, "stopped": 0, "total": 1, "parked": 2, "all": 3}
    assert k["sites"] == {"up": 1, "down": 0, "warning": 0, "total": 1, "parked": 1, "all": 2}
    assert conditions([], s, c, st, None) == {}
    assert parked_keys(s, c, st) == {"service:office.service", "container:demo-tunnel", "container:demo-db", "site:demo.example.com"}


def test_open_event_closes_as_switched_off(tmp_path):
    store = EventStore(tmp_path / "events.db", debounce=True)
    now = int(time.time())
    cond = {"site:demo.example.com": {"level": "critical", "kind": "site", "title": {"nl": "demo is onbereikbaar", "en": "demo is down"},
                                      "body": {"nl": "", "en": ""}}}
    for i in range(4):
        store.sync(cond, now + i)
    assert store.list(0, 10)["open"] == 1
    # Nu bewust uit: meteen dicht (geen 6 rondes wachten), met een eigen titel, ook als sites nog "onbekend" zijn.
    store.sync({}, now + 10, {"site"}, {"site:demo.example.com"})
    out = store.list(0, 10)
    assert out["open"] == 0
    assert out["events"][0]["resolved"] and out["events"][0]["title"].startswith("Bewust uit: demo.example.com")


# API (mock) ------------------------------------------------------------------------------------


def test_api_labels_roundtrip(client, auth_headers):
    info = client.get("/v1/info", headers=auth_headers).json()
    assert "labels" in info["features"]
    svcs = {s["name"]: s for s in client.get("/v1/services", headers=auth_headers).json()}
    assert svcs["minecraft.service"]["parked"] and svcs["minecraft.service"]["parked_reason"] == "disabled"
    assert [s["name"] for s in client.get("/v1/services?filter=parked", headers=auth_headers).json()] == ["minecraft.service"]
    sites = {s["hostname"]: s for s in client.get("/v1/sites", headers=auth_headers).json()["sites"]}
    assert sites["blog.example.com"]["parked"] and sites["blog.example.com"]["parked_reason"] == "backend"
    ov = client.get("/v1/overview", headers=auth_headers).json()
    assert not any("blog.example.com" in r["text"] for r in ov["health"]["reasons"])
    assert ov["counts"]["containers"]["parked"] == 2 and ov["counts"]["sites"]["parked"] == 1

    r = client.post("/v1/labels", json={"kind": "service", "name": "nginx.service", "group": "  Web   servers "}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["group_setting"] == "Web servers"
    r = client.post("/v1/labels", json={"kind": "container", "name": "old-blog-ghost-1", "parked": False}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["parked_setting"] is False
    ctrs = {c["name"]: c for c in client.get("/v1/containers", headers=auth_headers).json()["containers"]}
    assert ctrs["old-blog-ghost-1"]["parked"] is False and ctrs["old-blog-mysql-1"]["parked"] is True
    assert {"name": "Web servers", "source": "app"} in client.get("/v1/labels", headers=auth_headers).json()["groups"]
    svcs = {s["name"]: s for s in client.get("/v1/services", headers=auth_headers).json()}
    assert svcs["nginx.service"]["group"] == "Web servers"
    audit = client.get("/v1/audit", headers=auth_headers).json()
    assert audit[0]["action"] == "label" and audit[0]["target"] == "container:old-blog-ghost-1" and audit[0]["detail"] == "parked=False"

    # Terug naar automatisch.
    r = client.post("/v1/labels", json={"kind": "service", "name": "nginx.service", "group": None}, headers=auth_headers)
    assert r.json()["group_setting"] is None


def test_api_labels_validation(client, auth_headers):
    bad = [
        {"kind": "service", "name": "nginx.service"},  # niets te wijzigen
        {"kind": "service", "name": "nginx; rm", "parked": True},
        {"kind": "site", "name": "NOT A HOST", "parked": True},
        {"kind": "disk", "name": "sda", "parked": True},
        {"kind": "service", "name": "nginx.service", "group": "a\x07b"},
        {"kind": "service", "name": "nginx.service", "group": "x" * 41},
        {"kind": "service", "name": "nginx.service", "parked": True, "extra": 1},
    ]
    for body in bad:
        assert client.post("/v1/labels", json=body, headers=auth_headers).status_code == 422, body
    r = client.post("/v1/labels", json={"kind": "service", "name": "nope.service", "parked": True}, headers=auth_headers)
    assert r.status_code == 404
    assert client.post("/v1/labels", json={"kind": "service", "name": "nginx.service", "parked": True}).status_code == 401
