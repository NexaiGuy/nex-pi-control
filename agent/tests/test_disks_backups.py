"""Schijven zonder SMART (USB-adapters), het schijvenoverzicht en de back-upbewaking."""

import json
import time

from hal_agent.collectors.disks import merge, parse_lsblk
from hal_agent.collectors.misc import classify_backups
from hal_agent.collectors.smart import evaluate
from hal_agent.health import compute_health, counts, disk_alarms

NOW = int(time.time())
POLICY = {"max_age_seconds": 36 * 3600, "ignore": [], "snapshots_are_archive": True}


def usb_record(**kw):
    rec = {"device": "/dev/sda", "collected_at": NOW, "size_bytes": 256060514304, "model": "TS256GESD310C", "transport": "usb",
           "serial": "", "exit_code": 1, "smartctl": {}, "unsupported": False}
    rec.update(kw)
    return rec


def test_no_smart_data_is_never_ok():
    # Precies wat de Pi gaf: smartctl herkent de USB-bridge niet (exit 1), geen gegevens. Vroeger: "OK".
    r = evaluate(usb_record())
    assert r["status"] == "unknown"
    assert r["smart_supported"] is False
    assert "apparaattype" in r["reasons"][0]
    assert r["capacity_bytes"] == 256060514304  # terugval op lsblk, geen streepje meer
    assert disk_alarms([r]) == []  # onbekend is geen rode banner


def test_usb_adapter_without_passthrough_is_explained():
    r = evaluate(usb_record(unsupported=True))
    assert r["status"] == "unknown" and "USB-adapter" in r["reasons"][0]


def test_usb_via_sat_reads_normally():
    data = {"model_name": "TS256GESD310C", "serial_number": "X1", "smart_status": {"passed": True}, "user_capacity": {"bytes": 256060514304},
            "temperature": {"current": 38}, "power_on_time": {"hours": 1200}}
    r = evaluate(usb_record(exit_code=0, smartctl=data, device_type="sat"))
    assert r["status"] == "ok" and r["temperature_c"] == 38 and r["device_type"] == "sat"


def test_aborted_direct_sata_still_warns():
    # Een SATA-schijf die SMART-lezen afbreekt (zoals een stervende 870 EVO) blijft een waarschuwing, geen "onbekend".
    r = evaluate({"device": "/dev/sdc", "collected_at": NOW, "exit_code": 4, "transport": "sata", "size_bytes": 1,
                  "smartctl": {"model_name": "Samsung SSD 870 EVO 1TB", "firmware_version": "SVT01B6Q"}})
    assert r["status"] == "warning"
    assert disk_alarms([r])


LSBLK = json.dumps({"blockdevices": [
    {"name": "sda", "type": "disk", "size": 256060514304, "tran": "usb", "model": "TS256GESD310C", "serial": None, "rm": False, "children": [
        {"name": "sda1", "type": "part", "size": 536870912, "fstype": "vfat", "label": "bootfs", "mountpoints": ["/boot/firmware"]},
        {"name": "sda2", "type": "part", "size": 255523643392, "fstype": "ext4", "label": "rootfs", "mountpoints": ["/"]}]},
    {"name": "sdb", "type": "disk", "size": 256060514304, "tran": "usb", "model": "TS256GESD310C", "serial": None, "rm": True, "children": [
        {"name": "sdb1", "type": "part", "size": 256059465728, "fstype": "exfat", "label": "", "mountpoints": ["/mnt/nex-reserve"]}]},
    {"name": "sdc", "type": "disk", "size": 64000000000, "tran": "usb", "model": "Flash Disk", "serial": "AA", "rm": True, "children": []},
    {"name": "mmcblk0", "type": "disk", "size": 63864569856, "tran": None, "model": None, "rm": False, "children": []},
    {"name": "zram0", "type": "disk", "size": 1, "children": []},
    {"name": "loop0", "type": "loop", "size": 1},
]})


def test_inventory_lists_every_physical_disk():
    inv = parse_lsblk(LSBLK)
    assert [d["device"] for d in inv] == ["/dev/sda", "/dev/sdb", "/dev/sdc", "/dev/mmcblk0"]
    assert inv[3]["transport"] == "sd"
    assert inv[0]["partitions"][1]["mountpoints"] == ["/"]


def test_merge_shows_disks_without_smart_file_and_usage():
    inv = parse_lsblk(LSBLK)
    smart = [evaluate(usb_record()), evaluate(usb_record(device="/dev/sdb"))]
    mounts = [{"device": "/dev/sda2", "mountpoint": "/", "fstype": "ext4", "total": 234 * 10**9, "used": 142 * 10**9, "free": 92 * 10**9, "percent": 63.2}]
    disks = merge(smart, inv, mounts)
    by = {d["device"]: d for d in disks}
    assert set(by) == {"/dev/sda", "/dev/sdb", "/dev/sdc", "/dev/mmcblk0"}
    assert by["/dev/sdc"]["status"] == "unknown" and "Nog niet gemeten" in by["/dev/sdc"]["reasons"][0]
    root = next(p for p in by["/dev/sda"]["partitions"] if p["device"] == "/dev/sda2")
    assert root["percent"] == 63.2
    assert by["/dev/sdb"]["removable"] is True and by["/dev/sdb"]["capacity_bytes"] == 256060514304


def test_merge_survives_lsblk_failure():
    smart = [evaluate(usb_record())]
    assert [d["device"] for d in merge(smart, [], [])] == ["/dev/sda"]


def backup(name, age_h, path=None):
    return {"name": name, "path": path or f"/var/backups/{name}", "state": "ok", "age_seconds": int(age_h * 3600)}


def test_one_off_snapshots_never_warn():
    items = classify_backups([backup("site.be-20260920-010833", 300), backup("db_2026-09-20", 300), backup("nightly", 2)], POLICY)
    kinds = {b["name"]: b["kind"] for b in items}
    assert kinds == {"site.be-20260920-010833": "archive", "db_2026-09-20": "archive", "nightly": "job"}
    assert not [r for r in compute_health({}, [], [], [], [], [], items)["reasons"] if r["code"] == "backup_old"]
    assert counts([], [], [], items)["last_backup_age_seconds"] == 7200


def test_stopped_recurring_backup_still_warns():
    items = classify_backups([backup("nightly", 150), backup("site.be-20260920-010833", 300)], POLICY)
    reasons = [r for r in compute_health({}, [], [], [], [], [], items)["reasons"] if r["code"] == "backup_old"]
    assert reasons and "nightly" in reasons[0]["text"] and "20260920" not in reasons[0]["text"]


def test_ignore_list_and_custom_age():
    pol = {**POLICY, "ignore": ["oud-*"], "max_age_seconds": 200 * 3600}
    items = classify_backups([backup("oud-export", 999), backup("weekly", 150)], pol)
    assert items[0]["kind"] == "archive" and items[0]["reason"] == "ignored"
    assert not [r for r in compute_health({}, [], [], [], [], [], items)["reasons"] if r["code"] == "backup_old"]


def test_disks_endpoint_lists_all(client, auth_headers):
    r = client.get("/v1/disks", headers=auth_headers)
    assert r.status_code == 200
    devs = [d["device"] for d in r.json()["disks"]]
    assert "/dev/sdb" in devs and "/dev/mmcblk0" in devs


def test_sandbox_tmp_binds_never_replace_root():
    inv = parse_lsblk(json.dumps({"blockdevices": [
        {"name": "sda", "type": "disk", "size": 1, "tran": "usb", "model": "X", "children": [
            {"name": "sda2", "type": "part", "size": 1, "fstype": "ext4", "mountpoints": ["/var/tmp", "/tmp", "/"]}]}]}))
    mounts = [{"device": "/dev/sda2", "mountpoint": "/", "fstype": "ext4", "total": 10, "used": 5, "free": 5, "percent": 50.0}]
    p = merge([], inv, mounts)[0]["partitions"][0]
    assert p["mountpoint"] == "/" and p["mountpoints"] == ["/"] and p["percent"] == 50.0


def test_error_log_unavailable_is_not_a_failure_signal():
    data = {"model_name": "TS256GESD310C", "smart_status": {"passed": True}, "temperature": {"current": 51},
            "ata_smart_attributes": {"table": [{"id": 187, "name": "Reported_Uncorrect", "raw": {"value": 0}}]}}
    r = evaluate(usb_record(exit_code=0, smartctl=data, device_type="sat", error_log={"exit_code": 4, "available": False}))
    assert r["status"] == "ok" and r["error_log_available"] is False
    assert disk_alarms([r]) == []


def transcend_sat(extra_msgs=()):
    # Zoals de Pi het teruggaf: -H kent de adapter niet (exit 4), gezondheid via attributen PASSED, attributen schoon.
    msgs = [{"string": "SMART Status command failed: scsi error unsupported scsi opcode", "severity": "error"}, *extra_msgs]
    table = [
        {"id": 1, "name": "Raw_Read_Error_Rate", "value": 100, "raw": {"value": 0}},
        {"id": 9, "name": "Power_On_Hours", "value": 100, "raw": {"value": 5215}},
        {"id": 187, "name": "Reported_Uncorrect", "value": 100, "raw": {"value": 0}},
        {"id": 194, "name": "Temperature_Celsius", "value": 51, "raw": {"value": 51}},
        {"id": 196, "name": "Reallocated_Event_Count", "value": 100, "raw": {"value": 0}},
        {"id": 231, "name": "Unknown_SSD_Attribute", "value": 84, "raw": {"value": 84}},
    ]
    return {"smartctl": {"messages": msgs, "exit_status": 4}, "model_name": "TS256GESD310C", "serial_number": "1505620BJ20655950008",
            "smart_status": {"passed": True}, "ata_smart_attributes": {"table": table}}


def test_usb_adapter_unsupported_status_is_not_a_failure():
    r = evaluate(usb_record(exit_code=4, smartctl=transcend_sat(), device_type="sat"))
    assert r["status"] == "ok", r["reasons"]
    assert r["health_source"] == "attributes"
    assert r["temperature_c"] == 51 and r["power_on_hours"] == 5215
    assert r["attributes"]["life_left"] == 84 and r["attributes"]["reported_uncorrectable"] == 0
    assert disk_alarms([r]) == []


def test_real_abort_still_warns_even_with_data():
    data = transcend_sat([{"string": "Read SMART Data failed: scsi error aborted command", "severity": "error"}])
    r = evaluate(usb_record(exit_code=4, smartctl=data, device_type="sat"))
    assert r["status"] == "warning" and disk_alarms([r])


def test_abort_without_attributes_still_warns():
    data = transcend_sat()
    data["smartctl"]["messages"] = []
    data["ata_smart_attributes"]["table"] = []  # attributen lezen mislukt: dat is wel een signaal
    assert evaluate(usb_record(exit_code=4, smartctl=data))["status"] == "warning"


def test_low_life_left_warns():
    data = transcend_sat()
    data["ata_smart_attributes"]["table"][-1]["value"] = 7
    r = evaluate(usb_record(exit_code=4, smartctl=data))
    assert r["status"] == "warning" and any("levensduur" in x for x in r["reasons"])


def test_usb_abort_without_message_in_json_but_clean_attributes_is_adapter():
    data = transcend_sat()
    data["smartctl"]["messages"] = []  # smartctl zet de -H-fout niet altijd in de JSON
    assert evaluate(usb_record(exit_code=4, smartctl=data))["status"] == "ok"
    # Op SATA (geen USB-adapter) blijft dezelfde afbreking een waarschuwing.
    assert evaluate(usb_record(exit_code=4, smartctl=data, transport="sata"))["status"] == "warning"


def test_backup_timers_are_jobs_with_their_own_period():
    from hal_agent.collectors.backup_timers import build, parse_timers

    us = 1_000_000
    now = 1_790_000_000
    listing = json.dumps([
        {"unit": "nex-kluis.timer", "activates": "nex-kluis.service", "last": (now - 8 * 3600) * us, "next": (now + 16 * 3600) * us},
        {"unit": "debacker-backup.timer", "activates": "debacker-backup.service", "last": (now - 3 * 86400) * us, "next": (now + 3600) * us},
        {"unit": "weekly-backup.timer", "activates": "weekly-backup.service", "last": (now - 5 * 86400) * us, "next": (now + 2 * 86400) * us},
        {"unit": "apt-daily.timer", "activates": "apt-daily.service", "last": now * us, "next": now * us},
    ])
    timers = parse_timers(listing, ["*backup*", "nex-kluis*"])
    assert [t["timer"] for t in timers] == ["nex-kluis.timer", "debacker-backup.timer", "weekly-backup.timer"]
    show = {"nex-kluis.service": {"Result": "success"}, "debacker-backup.service": {"Result": "exit-code", "ActiveState": "failed"},
            "weekly-backup.service": {"Result": "success"}}
    items = build(timers, show, 36 * 3600, now)
    by = {b["name"]: b for b in items}
    assert by["nex-kluis"]["state"] == "ok" and by["nex-kluis"]["age_seconds"] == 8 * 3600
    assert by["debacker-backup"]["state"] == "failed"
    assert by["weekly-backup"]["max_age_seconds"] >= int(7 * 86400 * 1.5) - 1  # wekelijks: 5 dagen is nog op tijd
    reasons = {r["code"]: r["text"] for r in compute_health({}, [], [], [], [], [], items)["reasons"]}
    assert "debacker-backup" in reasons["backup_failed"]
    assert "backup_old" not in reasons  # wekelijks op tijd, de mislukte telt als mislukt, niet als oud
    assert counts([], [], [], items)["last_backup_age_seconds"] == 8 * 3600
