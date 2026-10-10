"""Bepaalt de algemene gezondheid. Schijfproblemen staan altijd bovenaan."""

from __future__ import annotations

from typing import Any

from hal_common.i18n import L

from .collectors.system import throttle_label

BACKUP_MAX_AGE = 36 * 3600


def compute_health(
    snapshot: dict[str, Any],
    mounts: list[dict[str, Any]],
    smart: list[dict[str, Any]],
    services: list[dict[str, Any]] | None,
    containers: list[dict[str, Any]] | None,
    sites: list[dict[str, Any]] | None,
    backups: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    reasons: list[dict[str, Any]] = []

    def add(level: str, code: str, text: str, target: str | None = None) -> None:
        reasons.append({"level": level, "code": code, "text": text, "target": target})

    # 1. Schijven (altijd eerst)
    for d in smart:
        if d.get("status") in ("failing", "warning"):
            problems = d.get("problems", d.get("reasons") or [])
            if not problems:
                add("warning", "smart_stale", L(f"SMART-controle van {d.get('device')} draait niet meer", f"SMART check for {d.get('device')} is no longer running"), d.get("device"))
                continue
            first = problems[0]
            add("critical", "disk_smart", L(f"Schijf {d.get('device')} toont tekenen van falen: {first}. Eerst back-up maken.", f"Disk {d.get('device')} shows signs of failure: {first}. Back up first."), d.get("device"))
    for m in mounts:
        if m["percent"] >= 90:
            add("critical", "disk_full", L(f"{m['mountpoint']} is {m['percent']:.0f}% vol", f"{m['mountpoint']} is {m['percent']:.0f}% full"), m["mountpoint"])
        elif m["percent"] >= 80:
            add("warning", "disk_usage", L(f"{m['mountpoint']} is {m['percent']:.0f}% vol", f"{m['mountpoint']} is {m['percent']:.0f}% full"), m["mountpoint"])

    # 2. Thermiek en stroom
    t = snapshot.get("temperature_c")
    if t is not None:
        if t >= 80:
            add("critical", "temp", L(f"CPU-temperatuur {t:.0f} °C", f"CPU temperature {t:.0f} °C"))
        elif t >= 70:
            add("warning", "temp", L(f"CPU-temperatuur {t:.0f} °C", f"CPU temperature {t:.0f} °C"))
    thr = snapshot.get("throttling") or {}
    if thr.get("now"):
        add("warning", "throttling", L("Nu actief: ", "Active now: ") + ", ".join(throttle_label(c) for c in thr["now"]).lower())
    mem = (snapshot.get("memory") or {}).get("percent")
    if mem is not None and mem >= 90:
        add("warning", "memory", L(f"RAM {mem:.0f}% in gebruik", f"RAM {mem:.0f}% in use"))

    # 3. Diensten, containers, sites, backups. Wat bewust uit staat (parked, zie labels.py) telt nooit als probleem.
    services = [s for s in services or [] if not s.get("parked")]
    containers = [c for c in containers or [] if not c.get("parked")]
    sites = [s for s in sites or [] if not s.get("parked")]
    if services:
        failed = [s["name"] for s in services if s.get("active") == "failed"]
        if failed:
            add("warning", "services_failed", L(f"{len(failed)} dienst(en) gefaald: ", f"{len(failed)} service(s) failed: ") + ", ".join(failed[:3]) + ("…" if len(failed) > 3 else ""))
    if containers:
        # Enkel draaiende containers: na het stoppen bewaart Docker de laatste healthcheck, die zegt niets meer.
        unhealthy = [c["name"] for c in containers if c.get("health") == "unhealthy" and c.get("state") in ("running", "restarting")]
        if unhealthy:
            add("warning", "containers_unhealthy", L(f"{len(unhealthy)} container(s) ongezond: ", f"{len(unhealthy)} container(s) unhealthy: ") + ", ".join(unhealthy[:3]) + ("…" if len(unhealthy) > 3 else ""))
        crashed = [c["name"] for c in containers if c.get("state") in ("exited", "dead") and c.get("exit_code") not in (0, None)
                   and c.get("restart_policy") not in ("no", None, "")]
        if crashed:
            add("warning", "containers_exited", L(f"{len(crashed)} container(s) gestopt met fout: ", f"{len(crashed)} container(s) exited with an error: ") + ", ".join(crashed[:3]) + ("…" if len(crashed) > 3 else ""))
    if sites:
        down = [s["hostname"] for s in sites if s.get("state") == "down"]
        if down:
            add("warning", "sites_down", L(f"{len(down)} site(s) onbereikbaar: ", f"{len(down)} site(s) unreachable: ") + ", ".join(down[:3]) + ("…" if len(down) > 3 else ""))
        # Antwoordt wel, maar met een foutcode (404, 410, 429...). Telt niet als online, dus ook melden.
        erring = [s for s in sites if s.get("state") == "warning"]
        if erring:
            names = ", ".join(f"{s['hostname']} ({s.get('status_code')})" for s in erring[:3]) + ("…" if len(erring) > 3 else "")
            add("warning", "sites_error", L(f"{len(erring)} site(s) geven een foutcode: ", f"{len(erring)} site(s) return an error code: ") + names)
        for s in sites:
            if s.get("tls_days_left") is not None and s["tls_days_left"] < 14:
                add("warning", "tls", L(f"TLS van {s['hostname']} vervalt over {s['tls_days_left']} dagen", f"TLS for {s['hostname']} expires in {s['tls_days_left']} days"), s["hostname"])
    # Back-ups van wat bewust uit staat (labels.annotate_backups) tellen ook niet.
    backups = [b for b in backups or [] if not b.get("parked")]
    if backups:
        # Enkel terugkerende back-ups (kind "job"); eenmalige kopieën en genegeerde mappen geven nooit een waarschuwing.
        old = [b for b in backups if b.get("kind", "job") == "job" and b.get("state") == "ok"
               and b.get("age_seconds", 0) > b.get("max_age_seconds", BACKUP_MAX_AGE)]
        failed = [b["name"] for b in backups if b.get("source") == "timer" and b.get("state") == "failed"]
        if failed:
            add("warning", "backup_failed", L("Back-up mislukt: ", "Backup failed: ") + ", ".join(failed[:3]) + ("…" if len(failed) > 3 else ""))
        if old:
            hours = round(old[0].get("max_age_seconds", BACKUP_MAX_AGE) / 3600)
            names = ", ".join(b["name"] for b in old[:3]) + ("…" if len(old) > 3 else "")
            add("warning", "backup_old", L(f"Back-up ouder dan {hours} u: ", f"Backup older than {hours} h: ") + names)

    order = {"critical": 0, "warning": 1}
    reasons.sort(key=lambda r: (0 if r["code"] == "disk_smart" else 1, order.get(r["level"], 2)))
    if any(r["level"] == "critical" for r in reasons):
        status, title = "critical", L("Kritiek", "Critical")
    elif reasons:
        n = len(reasons)
        status, title = "warning", L(f"{n} aandachtspunt" + ("en" if n != 1 else ""), f"{n} issue" + ("s" if n != 1 else ""))
    else:
        status, title = "ok", L("Alles in orde", "All good")
    return {"status": status, "title": title, "reasons": reasons}


def counts(services, containers, sites, backups) -> dict[str, Any]:
    """Tellers voor het overzicht. `total` telt enkel wat bewaakt wordt; `parked` is wat bewust uit staat, `all` alles samen."""
    s_all = services or []
    c_all = containers or []
    st_all = sites or []
    s = [x for x in s_all if not x.get("parked")]
    c = [x for x in c_all if not x.get("parked")]
    st = [x for x in st_all if not x.get("parked")]
    newest = None
    jobs_all = [b for b in backups or [] if b.get("kind", "job") == "job"]
    jobs = [b for b in jobs_all if not b.get("parked")]
    for b in jobs:
        if b.get("state") == "ok" and (newest is None or b["age_seconds"] < newest):
            newest = b["age_seconds"]
    failed = sum(1 for b in jobs if b.get("source") == "timer" and b.get("state") == "failed")
    old = sum(1 for b in jobs if b.get("state") == "ok" and b.get("age_seconds", 0) > b.get("max_age_seconds", BACKUP_MAX_AGE))
    return {
        "services": {"active": sum(1 for x in s if x.get("active") == "active"),
                     "failed": sum(1 for x in s if x.get("active") == "failed"), "total": len(s),
                     "parked": len(s_all) - len(s), "all": len(s_all)},
        "containers": {"running": sum(1 for x in c if x.get("state") == "running"),
                       "stopped": sum(1 for x in c if x.get("state") != "running"), "total": len(c),
                       "parked": len(c_all) - len(c), "all": len(c_all)},
        "sites": {"up": sum(1 for x in st if x.get("state") in ("up", "protected")),
                  "down": sum(1 for x in st if x.get("state") == "down"),
                  "warning": sum(1 for x in st if x.get("state") == "warning"), "total": len(st),
                  "parked": len(st_all) - len(st), "all": len(st_all)},
        "last_backup_age_seconds": newest,
        "backups": {"failed": failed, "old": old, "total": len(jobs), "parked": len(jobs_all) - len(jobs), "all": len(jobs_all)},
    }


def disk_alarms(smart: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Schijven waarvoor de rode banner in elke tab moet verschijnen."""
    out = []
    for d in smart:
        if d.get("status") not in ("failing", "warning"):
            continue
        rs = d.get("problems", d.get("reasons") or [])
        if not rs:
            continue
        out.append({
            "device": d.get("device"),
            "status": d.get("status"),
            "model": d.get("model"),
            "message": L(f"Schijf {d.get('device')} toont tekenen van falen. Eerst back-up maken.", f"Disk {d.get('device')} shows signs of failure. Back up first."),
            "reasons": rs,
        })
    return out
