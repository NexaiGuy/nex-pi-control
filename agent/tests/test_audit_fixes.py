"""Bevindingen uit de audit van 3 oktober 2026: wat de app toonde klopte op drie plaatsen niet."""

import asyncio
import json

import httpx

from hal_agent.collectors import sites as sites_mod
from hal_agent.collectors.backup_timers import build, parse_timers
from hal_agent.health import compute_health, counts
from hal_agent.maintenance import conditions


def _checker_with(routes: dict[str, int]):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(routes.get(request.url.path, 404))

    async def no_tls(host, timeout=8.0):
        return None

    return httpx.AsyncClient(transport=httpx.MockTransport(handler)), no_tls


def test_api_host_with_404_on_root_is_up_via_health_path(monkeypatch):
    client, no_tls = _checker_with({"/": 404, "/health": 200})
    monkeypatch.setattr(sites_mod, "tls_expiry", no_tls)
    chk = sites_mod.SiteChecker()
    # Zoals site_discovery.merge_sites hem aanlevert: met path "/" (dat ontbrak in de eerste versie van deze test).
    res = asyncio.run(chk.check_one(client, {"hostname": "xplain-api.example.be", "path": "/"}))
    assert res["state"] == "up" and res["status_code"] == 200
    assert res["probe_path"] == "/health" and res["root_status"] == 404
    assert res["url"] == "https://xplain-api.example.be/health"
    # De volgende ronde probeert hij het gevonden pad eerst.
    assert chk._probe_hint["xplain-api.example.be"] == "/health"


def test_site_with_404_everywhere_stays_warning_and_is_reported(monkeypatch):
    client, no_tls = _checker_with({})
    monkeypatch.setattr(sites_mod, "tls_expiry", no_tls)
    res = asyncio.run(sites_mod.SiteChecker().check_one(client, {"hostname": "kapot.example.be"}))
    assert res["state"] == "warning" and res["status_code"] == 404
    h = compute_health({}, [], [], [], [], [res], [])
    assert [r["code"] for r in h["reasons"]] == ["sites_error"]
    assert "kapot.example.be (404)" in h["reasons"][0]["text"]
    c = counts([], [], [res, {"hostname": "ok.be", "state": "up"}], [])["sites"]
    assert c == {"up": 1, "down": 0, "warning": 1, "total": 2, "parked": 0, "all": 2}
    ev = conditions([], [], [], [res], None)
    assert ev["site:kapot.example.be"]["level"] == "warning"


def test_configured_path_is_never_probed(monkeypatch):
    client, no_tls = _checker_with({"/": 200, "/health": 200, "/app": 404})
    monkeypatch.setattr(sites_mod, "tls_expiry", no_tls)
    res = asyncio.run(sites_mod.SiteChecker().check_one(client, {"hostname": "a.be", "path": "/app"}))
    assert res["state"] == "warning" and "probe_path" not in res


def test_manual_backup_run_counts_as_latest_run():
    us = 1_000_000
    now = 1_791_032_000
    listing = json.dumps([{"unit": "debacker-backup.timer", "activates": "debacker-backup.service",
                           "last": (now - 12 * 3600) * us, "next": (now + 12 * 3600) * us}])
    timers = parse_timers(listing, ["*backup*"])
    # Nacht faalde de timer, daarna een handmatige run die lukte, 20 minuten geleden.
    show = {"debacker-backup.service": {"Result": "success", "ActiveState": "inactive",
                                        "ExecMainStartTimestamp": f"@{now - 1200}"}}
    item = build(timers, show, 36 * 3600, now)[0]
    assert item["state"] == "ok" and item["age_seconds"] == 1200 and item["latest_at"] == now - 1200
    # Zonder (of met lege) starttijd blijft de timer-trigger de maat.
    show["debacker-backup.service"]["ExecMainStartTimestamp"] = "n/a"
    assert build(timers, show, 36 * 3600, now)[0]["age_seconds"] == 12 * 3600


def test_backup_counts_report_failed_and_old():
    items = [{"name": "a", "kind": "job", "source": "timer", "state": "failed"},
             {"name": "b", "kind": "job", "source": "timer", "state": "ok", "age_seconds": 3600, "max_age_seconds": 36 * 3600},
             {"name": "c", "kind": "job", "source": "dir", "state": "ok", "age_seconds": 50 * 3600, "max_age_seconds": 36 * 3600}]
    c = counts([], [], [], items)
    assert c["backups"] == {"failed": 1, "old": 1, "total": 3, "parked": 0, "all": 3}
    assert c["last_backup_age_seconds"] == 3600


def test_probe_also_runs_without_path_and_tries_healthz(monkeypatch):
    client, no_tls = _checker_with({"/": 404, "/health": 404, "/healthz": 200})
    monkeypatch.setattr(sites_mod, "tls_expiry", no_tls)
    res = asyncio.run(sites_mod.SiteChecker().check_one(client, {"hostname": "api.example.be"}))
    assert res["state"] == "up" and res["probe_path"] == "/healthz"


def test_disk_io_ignores_zram_and_loop():
    from collections import namedtuple

    from hal_agent.collectors.system import physical_disk_bytes

    C = namedtuple("C", "read_bytes write_bytes")
    counters = {"sda": C(1000, 2000), "sdb": C(10, 20), "zram0": C(9_999_999, 9_999_999), "loop3": C(500, 0), "nvme0n1": C(1, 2)}
    assert physical_disk_bytes(counters) == (1011, 2022)
    # psutil geeft met perdisk=True ook de partities: die zitten al in de schijf zelf en mogen niet dubbel tellen.
    parts = {"sda1": C(400, 900), "sda2": C(600, 1100), "nvme0n1p1": C(1, 2), "mmcblk0": C(5, 5), "mmcblk0p2": C(5, 5), "dm-0": C(7, 7)}
    assert physical_disk_bytes({**counters, **parts}) == (1016, 2027)
    assert physical_disk_bytes(None) == (0, 0)


def test_history_average_is_exact_not_mean_of_buckets(tmp_path):
    from hal_agent.history import HistoryStore

    h = HistoryStore(tmp_path / "h.sqlite")
    now = 1_791_000_000 - 1_791_000_000 % 60
    # Emmer 1 (60 s): zes metingen van 10. Emmer 2: één meting van 100.
    for i in range(6):
        h.write(now - 120 + i * 10, {"cpu": 10.0})
    h.write(now - 60, {"cpu": 100.0})
    s = h.query("cpu", "6h", now=now)["summary"]
    assert s["avg"] == round((6 * 10 + 100) / 7, 3)  # 22.857, niet (10 + 100) / 2 = 55
    assert s["min"] == 10.0 and s["max"] == 100.0 and s["current"] == 100.0
