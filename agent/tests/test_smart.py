import json
import time
from pathlib import Path

from hal_agent.collectors.smart import SmartStore, evaluate
from hal_agent.health import compute_health, disk_alarms

FIX = Path(__file__).parent / "fixtures" / "smart"


def load(name, fresh=True):
    rec = json.loads((FIX / name).read_text())
    if fresh:
        rec["collected_at"] = int(time.time())
    return rec


def test_healthy_disk_ok():
    r = evaluate(load("healthy_ata.json"))
    assert r["status"] == "ok", r["reasons"]
    assert r["attributes"]["reallocated_sectors"] == 0
    assert r["temperature_c"] == 33


def test_reallocated_and_pending_is_failing():
    r = evaluate(load("failing_ata.json"))
    assert r["status"] == "failing"
    text = " ".join(r["reasons"])
    assert "184 verplaatste sectoren" in text
    assert "12 onleesbare sectoren" in text
    assert "10 onherstelbare leesfouten" in text
    assert "SVT01B6Q" in text
    assert "Foutlog" in text  # exit bit 6


def test_nvme_ok():
    r = evaluate(load("nvme_ok.json"))
    assert r["status"] == "ok" and r["attributes"]["percentage_used"] == 3


def test_nvme_media_errors():
    rec = load("nvme_ok.json")
    rec["smartctl"]["nvme_smart_health_information_log"]["media_errors"] = 5
    rec["smartctl"]["nvme_smart_health_information_log"]["available_spare"] = 5
    r = evaluate(rec)
    assert r["status"] == "failing" and len(r["reasons"]) == 2


def test_command_abort_flagged():
    r = evaluate(load("aborted.json"))
    assert r["status"] == "warning" and any("afgebroken" in x for x in r["reasons"])


def test_capacity_mismatch_failing():
    r = evaluate(load("capacity_mismatch.json"))
    assert r["status"] == "failing" and any("capaciteit" in x for x in r["reasons"])


def test_overall_health_failed():
    r = evaluate(load("health_failed.json"))
    assert r["status"] == "failing" and any("NIET GESLAAGD" in x for x in r["reasons"])


def test_stale_data_warns_but_no_banner():
    rec = load("healthy_ata.json", fresh=False)
    rec["collected_at"] = int(time.time()) - 3600
    r = evaluate(rec)
    assert r["status"] == "warning"
    assert disk_alarms([r]) == []
    h = compute_health({}, [], [r], [], [], [], [])
    assert h["reasons"][0]["code"] == "smart_stale"


def test_crc_increase(tmp_path):
    smart = tmp_path / "smart"
    smart.mkdir()
    rec = load("healthy_ata.json")
    (smart / "sda.json").write_text(json.dumps(rec))
    store = SmartStore(smart, tmp_path / "crc.json")
    assert store.read_all()[0]["status"] == "ok"  # basislijn 4
    rec["smartctl"]["ata_smart_attributes"]["table"][-1]["raw"] = {"value": 9, "string": "9"}
    (smart / "sda.json").write_text(json.dumps(rec))
    r = store.read_all()[0]
    assert r["status"] == "warning" and any("CRC" in x for x in r["reasons"])
    store.acknowledge_crc()
    assert store.read_all()[0]["status"] == "ok"


def test_failing_disk_is_first_reason_and_banner():
    failing = evaluate(load("failing_ata.json"))
    snap = {"temperature_c": 85, "throttling": {"now": ["Gethrottled"]}, "memory": {"percent": 95}}
    services = [{"name": "x.service", "active": "failed"}]
    h = compute_health(snap, [{"mountpoint": "/", "percent": 95}], [failing], services, [], [], [])
    assert h["status"] == "critical"
    assert h["reasons"][0]["code"] == "disk_smart"
    assert "Eerst back-up maken" in h["reasons"][0]["text"]
    alarms = disk_alarms([failing])
    assert alarms and alarms[0]["message"].startswith("Schijf /dev/sda toont tekenen van falen")


def test_overview_mock_disk_scenario(settings, monkeypatch):
    from fastapi.testclient import TestClient

    from hal_agent.main import create_app

    settings.mock_scenario = "disk"
    with TestClient(create_app(settings)) as c:
        body = c.get("/v1/overview", headers={"Authorization": "Bearer " + "t" * 48}).json()
    assert body["health"]["reasons"][0]["code"] == "disk_smart"
    assert body["disk_alarms"][0]["device"] == "/dev/sda"
