"""Back-ups volgen bewust uit (labels.annotate_backups, sinds agent 1.3.1)."""

from hal_agent.collectors.backup_timers import build
from hal_agent.health import compute_health, counts
from hal_agent.labels import backup_stem

from .test_labels import _labels, ctr, svc

NOW = 1_800_000_000


def timer(name, state="failed", next_at=NOW + 3600, age=11 * 3600):
    b = {"name": name, "path": f"systemd:{name}.timer", "kind": "job", "source": "timer", "unit": f"{name}.service",
         "next_at": next_at, "description": "Nightly dump", "result": "exit-code" if state == "failed" else "success",
         "max_age_seconds": 36 * 3600, "state": state}
    if state != "empty":
        b.update(latest_at=NOW - age, age_seconds=age)
    return b


def ndf2_stopped():
    return [ctr("ndf2-web-1", "exited", 0, project="ndf2"), ctr("ndf2-postgres-1", "exited", 137, project="ndf2")]


def annotate(lab, backups, services=(), containers=()):
    s, c, _ = lab.annotate(list(services), list(containers), [], with_groups=False)
    return lab.annotate_backups(backups, s, c)


def test_backup_stem():
    assert backup_stem("ndf2-backup") == "ndf2"
    assert backup_stem("ndf2-backup.service") == "ndf2"
    assert backup_stem("backup-pandly") == "pandly"
    assert backup_stem("debacker_db_dump") == "debacker_db"
    assert backup_stem("nex-kluis") == "nex-kluis"


def test_backup_of_parked_project_is_parked(tmp_path):
    lab = _labels(tmp_path)
    [b] = annotate(lab, [timer("ndf2-backup")], [svc("ndf2-backup", "failed", "static")], ndf2_stopped())
    assert b["parked"] and b["parked_reason"] == "target"
    assert b["state"] == "parked" and b["state_raw"] == "failed"
    assert b["description"].startswith("Bewust uit") and "max_age_seconds" not in b


def test_backup_stays_watched_while_part_of_project_runs(tmp_path):
    lab = _labels(tmp_path)
    cts = [ctr("ndf2-web-1", "running", project="ndf2"), ctr("ndf2-postgres-1", "exited", 0, project="ndf2")]
    [b] = annotate(lab, [timer("ndf2-backup")], [], cts)
    assert not b["parked"] and b["state"] == "failed"


def test_generic_prefix_does_not_hide_a_real_failure(tmp_path):
    # nex-backup hoort bij tientallen nex-diensten die nog draaien: één uitgezette nex-dienst verandert daar niets aan.
    lab = _labels(tmp_path)
    services = [svc("nex-vr-room", "inactive", "disabled"), svc("nex-ai-website"), svc("nex-prospect")]
    [b] = annotate(lab, [timer("nex-backup")], services)
    assert not b["parked"]


def test_backup_without_any_related_item_stays_watched(tmp_path):
    lab = _labels(tmp_path)
    [b] = annotate(lab, [timer("kluis-backup")], [svc("kluis-backup", "failed", "static")])
    assert not b["parked"]


def test_disabled_timer_is_parked(tmp_path):
    lab = _labels(tmp_path)
    [b] = annotate(lab, [timer("old-backup", next_at=0)])
    assert b["parked"] and b["parked_reason"] == "timer_off"


def test_own_service_parked_in_config(tmp_path):
    lab = _labels(tmp_path, "parked:\n  - ndf2-*\n")
    [b] = annotate(lab, [timer("ndf2-backup")], [svc("ndf2-backup", "failed", "static")])
    assert b["parked"] and b["parked_reason"] == "config"


def test_backup_prefix_in_config(tmp_path):
    lab = _labels(tmp_path, "parked:\n  - backup:legacy-*\n")
    [b] = annotate(lab, [timer("legacy-files", state="ok", age=90 * 3600)])
    assert b["parked"] and b["parked_reason"] == "config"


def test_app_setting_wins(tmp_path):
    lab = _labels(tmp_path)
    lab.store.set("backup", "ndf2-backup", {"parked": False})
    [b] = annotate(lab, [timer("ndf2-backup")], [], ndf2_stopped())
    assert not b["parked"] and b["parked_rule"] == "target"
    lab.store.set("backup", "kluis-backup", {"parked": True})
    [b] = annotate(lab, [timer("kluis-backup")])
    assert b["parked"] and b["parked_reason"] == "app"


def test_healthy_backup_is_never_shown_as_parked(tmp_path):
    lab = _labels(tmp_path)
    [b] = annotate(lab, [timer("ndf2-backup", state="ok")], [], ndf2_stopped())
    assert not b["parked"] and b["state"] == "ok" and b["parked_rule"] == "target"


def test_archives_untouched(tmp_path):
    lab = _labels(tmp_path)
    arch = {"name": "site.be-20260920-010833", "kind": "archive", "state": "ok"}
    assert annotate(lab, [arch], [], ndf2_stopped()) == [arch]


def test_health_and_counts_ignore_parked_backups(tmp_path):
    lab = _labels(tmp_path)
    backups = annotate(lab, [timer("ndf2-backup"), timer("db-backup", state="ok", age=3600)], [], ndf2_stopped())
    snap = {"cpu_percent": 5, "temperature_c": 40, "memory": {"percent": 30}, "load": [0.1, 0.1, 0.1], "throttled": None}
    h = compute_health(snap, [], [], [], [], [], backups)
    assert not any(r["code"] == "backup_failed" for r in h["reasons"])
    k = counts([], [], [], backups)["backups"]
    assert k == {"failed": 0, "old": 0, "total": 1, "parked": 1, "all": 2}
    # Zonder bewust uit wel een waarschuwing.
    h2 = compute_health(snap, [], [], [], [], [], [timer("ndf2-backup")])
    assert any(r["code"] == "backup_failed" for r in h2["reasons"])


def test_build_exposes_unit_and_next_run():
    timers = [{"timer": "ndf2-backup.timer", "service": "ndf2-backup.service", "last_us": (NOW - 3600) * 1_000_000, "next_us": 0}]
    [b] = build(timers, {"ndf2-backup.service": {"Result": "exit-code", "ActiveState": "failed"}}, 36 * 3600, now=NOW)
    assert b["unit"] == "ndf2-backup.service" and b["next_at"] == 0 and b["state"] == "failed"
