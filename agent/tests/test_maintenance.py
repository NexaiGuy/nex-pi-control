"""Gebeurtenissen, systeemupdates, agent-updates en containers herstarten."""

import importlib.machinery
import importlib.util
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture()
def dclient(tmp_path, monkeypatch):
    """Mock-agent in het scenario "disk": falende schijf, kapotte container, updates klaar."""
    from fastapi.testclient import TestClient

    from hal_agent.config import Settings
    from hal_agent.main import create_app

    monkeypatch.setenv("HAL_AGENT_MOCK", "1")
    monkeypatch.setenv("HAL_AGENT_MOCK_SCENARIO", "disk")
    monkeypatch.setenv("HAL_AGENT_TOKEN", "t" * 48)
    monkeypatch.setenv("HAL_AGENT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("HAL_AGENT_CONFIG_DIR", str(ROOT / "config"))
    with TestClient(create_app(Settings.from_env())) as c:
        yield c


def load_script(name: str):
    loader = importlib.machinery.SourceFileLoader(name.replace("-", "_"), str(ROOT / "bin" / name))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def test_event_store_new_and_resolved(tmp_path):
    from hal_agent.maintenance import EventStore, T

    store = EventStore(tmp_path / "e.db", debounce=False)
    cond = {"service:x.service": {"level": "warning", "kind": "service", "title": T("Dienst x gestopt", "Service x failed"), "body": T("b", "b")}}
    assert store.sync(cond, now=1000) == 1
    assert store.sync(cond, now=1030) == 0  # zelfde probleem: geen dubbele melding
    first = store.list(0, 50)
    assert first["last_id"] == 1 and first["open"] == 1 and first["events"][0]["title"] == "Dienst x gestopt"
    assert store.sync({}, now=1060) == 1  # opgelost
    res = store.list(first["last_id"], 50)
    assert res["open"] == 0 and len(res["events"]) == 1
    ev = res["events"][0]
    assert ev["resolved"] is True and ev["level"] == "ok" and ev["title"].startswith("Opgelost")
    # Komt het terug, dan is het opnieuw een melding.
    assert store.sync(cond, now=1090) == 1
    store.close()


def test_event_store_debounces_flapping(tmp_path):
    """Een site die af en toe één controle mist geeft geen reeks meldingen; een echt probleem wel, één keer."""
    from hal_agent.maintenance import EventStore, T

    store = EventStore(tmp_path / "e.db")
    site = {"site:x.example.com": {"level": "critical", "kind": "site", "title": T("x down", "x down"), "body": T("b", "b")}}
    disk = {"disk:/dev/sda": {"level": "critical", "kind": "disk", "title": T("sda", "sda"), "body": T("b", "b")}}
    t = 1000
    # Flapperen: telkens 1 tot 3 mislukte controles, dan weer goed. Nooit een gebeurtenis.
    for pattern in ([1, 0], [1, 1, 0], [1, 1, 1, 0, 0]):
        for bad in pattern:
            t += 30
            assert store.sync(site if bad else {}, now=t) == 0
    assert store.list(0, 50)["events"] == []
    # Schijfproblemen wachten niet.
    t += 30
    assert store.sync(disk, now=t) == 1
    # Vier mislukte controles na elkaar: één gebeurtenis.
    added = 0
    for _ in range(4):
        t += 30
        added += store.sync({**site, **disk}, now=t)
    assert added == 1 and store.list(0, 50)["open"] == 2
    # Eén goede controle tussendoor lost niets op en geeft bij een nieuwe fout geen tweede melding.
    for cond in ({**disk}, {**site, **disk}, {**disk}, {**site, **disk}):
        t += 30
        assert store.sync(cond, now=t) == 0
    # Pas na zes goede controles na elkaar is de site opgelost.
    resolved = 0
    for _ in range(6):
        t += 30
        resolved += store.sync(disk, now=t)
    assert resolved == 1 and store.list(0, 50)["open"] == 1
    store.close()


def test_event_store_keeps_problems_open_without_data(tmp_path):
    """Na een herstart van de agent zijn de sites nog niet gecontroleerd: dat mag geen "opgelost" plus nieuwe melding geven."""
    from hal_agent.maintenance import EventStore, T

    store = EventStore(tmp_path / "e.db", debounce=False)
    site = {"site:x.example.com": {"level": "critical", "kind": "site", "title": T("x", "x"), "body": T("b", "b")}}
    assert store.sync(site, now=1000) == 1
    for i in range(10):
        assert store.sync({}, now=1030 + i * 30, unknown_kinds={"site"}) == 0
    assert store.list(0, 50)["open"] == 1
    assert store.sync(site, now=1400) == 0
    store.close()


def test_conditions_cover_disks_services_containers_sites_updates():
    from hal_agent.maintenance import conditions

    smart = [{"device": "/dev/sda", "status": "failing", "problems": ["Reallocated_Sector_Ct=8"]}, {"device": "/dev/sdb", "status": "ok"}]
    services = [{"name": "a.service", "active": "failed"}, {"name": "b.service", "active": "active"}]
    containers = [{"name": "web", "state": "exited", "exit_code": 1, "health": None},
                  {"name": "done", "state": "exited", "exit_code": 0, "health": None},
                  {"name": "api", "state": "running", "exit_code": 0, "health": "unhealthy"}]
    sites = [{"hostname": "x.example.com", "state": "down", "status_code": 502}, {"hostname": "y.example.com", "state": "up"}]
    apt = {"security_count": 2}
    keys = set(conditions(smart, services, containers, sites, apt))
    assert keys == {"disk:/dev/sda", "service:a.service", "container:web", "container:api", "site:x.example.com", "updates:security"}


def test_events_endpoint(dclient, auth_headers):
    client = dclient
    r = client.get("/v1/events", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert data["last_id"] >= 1 and data["events"]
    assert all({"id", "ts", "level", "kind", "title", "body", "resolved"} <= set(e) for e in data["events"])
    # Niets nieuw sinds de laatste id.
    again = client.get(f"/v1/events?since={data['last_id']}", headers=auth_headers).json()
    assert again["events"] == []


def test_ok_scenario_has_no_events_and_no_update(client, auth_headers):
    assert client.get("/v1/events", headers=auth_headers).json()["open"] == 0
    assert client.get("/v1/agent/update", headers=auth_headers).json()["update_available"] is False
    assert client.post("/v1/agent/update", headers=auth_headers).status_code == 409


def test_events_requires_auth(client):
    assert client.get("/v1/events").status_code == 401


def test_container_restart_flow(dclient, auth_headers):
    client = dclient
    containers = client.get("/v1/containers", headers=auth_headers).json()["containers"]
    broken = next(c for c in containers if c["state"] != "running")
    assert broken["restart_allowed"] is True
    r = client.post(f"/v1/containers/{broken['name']}/restart", headers=auth_headers)
    assert r.status_code == 200 and r.json()["ok"] is True
    after = {c["name"]: c for c in client.get("/v1/containers", headers=auth_headers).json()["containers"]}
    assert after[broken["name"]]["state"] == "running"
    audit = client.get("/v1/audit", headers=auth_headers).json()
    assert audit[0]["action"] == "container:restart" and audit[0]["target"] == broken["name"]


def test_container_restart_rejects_bad_names(client, auth_headers):
    for bad in ("..", "-rm", "a%20b", "x;reboot"):
        assert client.post(f"/v1/containers/{bad}/restart", headers=auth_headers).status_code in (404, 422)
    assert client.post("/v1/containers/doesnotexist/restart", headers=auth_headers).status_code == 404


def test_container_deny_list(tmp_path):
    from hal_agent.config import ConfigFiles

    (tmp_path / "allowed-actions.yml").write_text("containers: true\ncontainer_deny:\n  - vault\n")
    cf = ConfigFiles(tmp_path)
    assert cf.container_restart_allowed("web") is True and cf.container_restart_allowed("vault") is False
    (tmp_path / "allowed-actions.yml").write_text("containers: false\n")
    import os

    os.utime(tmp_path / "allowed-actions.yml", (time.time() + 5, time.time() + 5))
    assert ConfigFiles(tmp_path).container_restart_allowed("web") is False


def test_updates_flow(dclient, auth_headers):
    client = dclient
    st = client.get("/v1/updates", headers=auth_headers).json()
    assert st["count"] == 5 and st["security_count"] == 2 and st["allowed"] is True
    # Scenario "disk": een falende schijf blokkeert de installatie.
    assert st["blocked_reason"]
    r = client.post("/v1/updates/install", headers=auth_headers)
    assert r.status_code == 409
    assert client.post("/v1/updates/check", headers=auth_headers).json()["ok"] is True


def test_updates_install_without_disk_problem(tmp_path, monkeypatch, auth_headers):
    from fastapi.testclient import TestClient

    from hal_agent.config import Settings
    from hal_agent.main import create_app

    monkeypatch.setenv("HAL_AGENT_MOCK", "1")
    monkeypatch.setenv("HAL_AGENT_MOCK_SCENARIO", "busy")
    monkeypatch.setenv("HAL_AGENT_TOKEN", "t" * 48)
    monkeypatch.setenv("HAL_AGENT_STATE_DIR", str(tmp_path / "s"))
    monkeypatch.setenv("HAL_AGENT_CONFIG_DIR", str(ROOT / "config"))
    with TestClient(create_app(Settings.from_env())) as c:
        st = c.get("/v1/updates", headers=auth_headers).json()
        if st["blocked_reason"]:
            return  # scenario met schijfprobleem, al gedekt hierboven
        r = c.post("/v1/updates/install", headers=auth_headers)
        assert r.status_code == 200
        assert c.post("/v1/updates/install", headers=auth_headers).status_code == 409  # loopt al


def test_agent_update_flow(dclient, auth_headers):
    client = dclient
    from hal_common import VERSION

    st = client.get("/v1/agent/update", headers=auth_headers).json()
    assert st["current"] == VERSION and st["update_available"] is True and st["run"]["running"] is False
    r = client.post("/v1/agent/update", headers=auth_headers)
    assert r.status_code == 200 and r.json()["ok"] is True
    assert client.get("/v1/agent/update", headers=auth_headers).json()["run"]["running"] is True
    assert client.post("/v1/agent/update", headers=auth_headers).status_code in (200, 409)


def test_allowed_and_info_flags(client, auth_headers):
    allowed = client.get("/v1/actions/allowed", headers=auth_headers).json()
    assert allowed["containers"] is True and allowed["updates"] is True and allowed["agent_update"] is True
    info = client.get("/v1/info", headers=auth_headers).json()
    assert {"events", "updates", "agent_update", "container_restart"} <= set(info["features"])


def test_version_compare():
    from hal_agent.maintenance import parse_version, update_available

    assert parse_version("v1.2.3") == (1, 2, 3) and parse_version("1.2") is None
    assert update_available("1.1.1", "1.2.0") and not update_available("1.2.0", "1.2.0") and not update_available("1.2.0", None)


def test_apt_check_parser():
    mod = load_script("hal-apt-check")
    out = mod.parse(
        "Listing...\n"
        "openssl/stable-security 3.5.1-1+deb13u1 arm64 [upgradable from: 3.5.1-1]\n"
        "tzdata/stable 2025b-5 all [upgradable from: 2025b-4]\n"
        "garbage line\n"
    )
    assert out == [
        {"name": "openssl", "from": "3.5.1-1", "to": "3.5.1-1+deb13u1", "security": True},
        {"name": "tzdata", "from": "2025b-4", "to": "2025b-5", "security": False},
    ]


def test_read_apt_status(tmp_path):
    from hal_agent.maintenance import read_apt_status

    assert read_apt_status(tmp_path / "missing.json")["checked_at"] is None
    (tmp_path / "s.json").write_text('{"checked_at": 5, "packages": [{"name": "a", "security": true}, {"bad": 1}], "reboot_required": true}')
    st = read_apt_status(tmp_path / "s.json")
    assert st["count"] == 1 and st["security_count"] == 1 and st["reboot_required"] is True


def test_container_restart_script_validates(monkeypatch):
    mod = load_script("hal-container-restart")
    assert mod.main(["x", "bad name"]) == 2
    assert mod.main(["x", "-rm"]) == 2
    assert mod.main(["x"]) == 2


def test_polkit_rule_contains_new_units(tmp_path):
    mod = load_script("hal-apply-config")
    mod.CONF = str(ROOT / "config")
    mod.RULES = str(tmp_path / "50.rules")
    mod.main()
    rule = Path(mod.RULES).read_text()
    for unit in ("hal-apt-check.service", "hal-apt-upgrade.service", "hal-agent-update.service"):
        assert unit in rule
    assert "hal-container@[A-Za-z0-9]" in rule
    (tmp_path / "conf").mkdir()
    (tmp_path / "conf" / "allowed-actions.yml").write_text("containers: false\nupdates: false\nagent_update: false\n")
    mod.CONF = str(tmp_path / "conf")
    mod.main()
    rule = Path(mod.RULES).read_text()
    assert "hal-apt-upgrade.service" not in rule and "hal-agent-update.service" not in rule
    assert '"start" && false && /^hal-container@' in rule


def test_last_upgrade_summary_only_keeps_what_is_still_open(tmp_path):
    import json as _json

    from hal_agent.maintenance import read_apt_status

    st = tmp_path / "status.json"
    st.write_text(_json.dumps({"checked_at": 1, "packages": [{"name": "foo-bar", "from": "1", "to": "2", "security": False}]}))
    (tmp_path / "last-upgrade.json").write_text(_json.dumps({"at": 5, "rc": 0, "upgraded": 11, "newly_installed": 2, "not_upgraded": 2,
                                                             "kept_back": ["foo-bar", "already-done"]}))
    s = read_apt_status(st)
    assert s["last_upgrade"]["upgraded"] == 11 and s["last_upgrade"]["newly_installed"] == 2
    assert s["last_upgrade"]["kept_back"] == ["foo-bar"]
    (tmp_path / "last-upgrade.json").unlink()
    assert read_apt_status(st)["last_upgrade"] is None


def test_upgrade_script_installs_new_dependencies_but_never_removes():
    from pathlib import Path

    script = (Path(__file__).resolve().parent.parent / "bin" / "hal-apt-upgrade").read_text()
    assert "--with-new-pkgs upgrade" in script
    commands = [ln for ln in script.splitlines() if ln.lstrip().startswith("apt-get")]
    for ln in commands:
        for bad in ("dist-upgrade", "full-upgrade", "autoremove", " remove", " purge"):
            assert bad not in ln, ln


def test_apt_status_held_packages_do_not_count_as_ready(tmp_path):
    import json

    from hal_agent.maintenance import read_apt_status

    p = tmp_path / "status.json"
    p.write_text(json.dumps({"checked_at": 1, "full_upgrade_removes": ["oud-pakket"], "packages": [
        {"name": "rpd-common", "from": "1.31", "to": "1.32", "security": True, "held": True, "reason": "removal"},
        {"name": "tzdata", "from": "a", "to": "b", "security": False},
        {"name": "x", "from": "a", "to": "b", "security": False, "held": True, "reason": "evil; rm"},
    ]}))
    st = read_apt_status(p)
    assert st["count"] == 1 and st["held_count"] == 2 and st["security_count"] == 0
    assert st["full_upgrade_removes"] == ["oud-pakket"]
    assert [x["name"] for x in st["packages"]] == ["tzdata", "rpd-common", "x"]
    assert st["packages"][1]["reason"] == "removal" and st["packages"][2]["reason"] is None
