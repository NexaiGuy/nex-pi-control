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

    # 3. Diensten, containers, sites, backups
    if services:
        failed = [s["name"] for s in services if s.get("active") == "failed"]
        if failed:
            add("warning", "services_failed", L(f"{len(failed)} dienst(en) gefaald: ", f"{len(failed)} service(s) failed: ") + ", ".join(failed[:3]) + ("…" if len(failed) > 3 else ""))
    if containers:
        unhealthy = [c["name"] for c in containers if c.get("health") == "unhealthy"]
        if unhealthy:
            add("warning", "containers_unhealthy", L(f"{len(unhealthy)} container(s) ongezond: ", f"{len(unhealthy)} container(s) unhealthy: ") + ", ".join(unhealthy[:3]))
        crashed = [c["name"] for c in containers if c.get("state") in ("exited", "dead") and c.get("exit_code") not in (0, None)
                   and c.get("restart_policy") not in ("no", None, "")]
        if crashed:
            add("warning", "containers_exited", L(f"{len(crashed)} container(s) gestopt met fout: ", f"{len(crashed)} container(s) exited with an error: ") + ", ".join(crashed[:3]))
    if sites:
        down = [s["hostname"] for s in sites if s.get("state") == "down"]
        if down:
            add("warning", "sites_down", L(f"{len(down)} site(s) onbereikbaar: ", f"{len(down)} site(s) unreachable: ") + ", ".join(down[:3]))
        for s in sites:
            if s.get("tls_days_left") is not None and s["tls_days_left"] < 14:
                add("warning", "tls", L(f"TLS van {s['hostname']} vervalt over {s['tls_days_left']} dagen", f"TLS for {s['hostname']} expires in {s['tls_days_left']} days"), s["hostname"])
    if backups:
        old = [b["name"] for b in backups if b.get("state") == "ok" and b.get("age_seconds", 0) > BACKUP_MAX_AGE]
        if old:
            add("warning", "backup_old", L("Backup ouder dan 36 u: ", "Backup older than 36 h: ") + ", ".join(old[:3]))

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
    s = services or []
    c = containers or []
    st = sites or []
    newest = None
    for b in backups or []:
        if b.get("state") == "ok" and (newest is None or b["age_seconds"] < newest):
            newest = b["age_seconds"]
    return {
        "services": {"active": sum(1 for x in s if x.get("active") == "active"),
                     "failed": sum(1 for x in s if x.get("active") == "failed"), "total": len(s)},
        "containers": {"running": sum(1 for x in c if x.get("state") == "running"),
                       "stopped": sum(1 for x in c if x.get("state") != "running"), "total": len(c)},
        "sites": {"up": sum(1 for x in st if x.get("state") in ("up", "protected")),
                  "down": sum(1 for x in st if x.get("state") == "down"), "total": len(st)},
        "last_backup_age_seconds": newest,
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
