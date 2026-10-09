"""Onderhoud: gebeurtenissen (meldingen naar de app), systeemupdates (apt), agent-updates en containers herstarten.

Gebeurtenissen: de agent vergelijkt elke 30 s de toestand met de vorige keer. Een nieuw probleem wordt een gebeurtenis,
een opgelost probleem ook. De app haalt ze op met /v1/events?since=<id> en maakt er lokale meldingen van.
Zo mist de gsm niets, ook niet als Android de achtergrondcontrole uitstelt. Er is geen pushserver.
"""

from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

import httpx

from hal_common.i18n import current

CONTAINER_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$")
VERSION_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")

APT_CHECK_UNIT = "hal-apt-check.service"
APT_UPGRADE_UNIT = "hal-apt-upgrade.service"
AGENT_UPDATE_UNIT = "hal-agent-update.service"


def container_unit(name: str) -> str:
    return f"hal-container@{name}.service"


def T(nl: str, en: str) -> dict[str, str]:
    """Tekst in beide talen, voor opslag. De taal wordt pas gekozen bij het opvragen."""
    return {"nl": nl, "en": en}


# --- Gebeurtenissen ------------------------------------------------------------------------------------


def conditions(smart: list[dict[str, Any]], services: list[dict[str, Any]], containers: list[dict[str, Any]],
               sites: list[dict[str, Any]], apt: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """Alle problemen die nu gelden, per vaste sleutel. Drempelwaarden (temperatuur, schijf %, backup) blijven in de app."""
    out: dict[str, dict[str, Any]] = {}
    for d in smart:
        if d.get("status") in ("failing", "warning") and (d.get("problems") or d.get("reasons")):
            dev = d.get("device")
            first = (d.get("problems") or d.get("reasons"))[0]
            out[f"disk:{dev}"] = {"level": "critical", "kind": "disk",
                                  "title": T(f"Schijf {dev} toont tekenen van falen", f"Disk {dev} shows signs of failure"),
                                  "body": T(f"{first}. Maak eerst een back-up.", f"{first}. Back up first.")}
    # Bewust uit (parked, zie labels.py): geen probleem, dus ook geen gebeurtenis of melding.
    for s in services:
        if s.get("active") == "failed" and not s.get("parked"):
            n = s["name"]
            out[f"service:{n}"] = {"level": "warning", "kind": "service",
                                   "title": T(f"Dienst {n} is gestopt met een fout", f"Service {n} failed"),
                                   "body": T("Bekijk de logs in de app.", "Check the logs in the app.")}
    for c in containers:
        if c.get("parked"):
            continue
        bad_exit = c.get("state") == "exited" and (c.get("exit_code") or 0) != 0
        unhealthy = c.get("health") == "unhealthy" and c.get("state") in ("running", "restarting")
        if bad_exit or unhealthy:
            n = c["name"]
            title = (T(f"Container {n} is gestopt met exitcode {c.get('exit_code')}", f"Container {n} exited with code {c.get('exit_code')}")
                     if bad_exit else T(f"Container {n} is ongezond", f"Container {n} is unhealthy"))
            out[f"container:{n}"] = {"level": "warning", "kind": "container",
                                     "title": title,
                                     "body": T("Je kan hem herstarten vanuit de app.", "You can restart it from the app.")}
    for st in sites:
        if st.get("parked"):
            continue
        if st.get("state") == "down":
            h = st["hostname"]
            out[f"site:{h}"] = {"level": "critical", "kind": "site",
                                "title": T(f"{h} is onbereikbaar", f"{h} is down"),
                                "body": T(f"HTTP {st.get('status_code') or 'geen antwoord'}", f"HTTP {st.get('status_code') or 'no response'}")}
        elif st.get("state") == "warning":
            # Antwoordt, maar met een foutcode (404, 410, 429...). Geen "down", wel iets om te bekijken.
            h = st["hostname"]
            out[f"site:{h}"] = {"level": "warning", "kind": "site",
                                "title": T(f"{h} geeft een foutcode", f"{h} returns an error code"),
                                "body": T(f"HTTP {st.get('status_code')} op {st.get('url') or h}", f"HTTP {st.get('status_code')} at {st.get('url') or h}")}
    if apt and apt.get("security_count"):
        n = int(apt["security_count"])
        out["updates:security"] = {"level": "info", "kind": "updates",
                                   "title": T(f"{n} beveiligingsupdate(s) beschikbaar", f"{n} security update(s) available"),
                                   "body": T("Installeer ze via Meer, Systeemupdates.", "Install them via More, System updates.")}
    return out


# Hoeveel controles na elkaar (elke 30 s) een probleem moet blijven bestaan voor het een gebeurtenis wordt, en hoeveel
# controles na elkaar het weg moet zijn voor het "opgelost" is. Zo geeft een site die één keer traag antwoordt of een
# dienst die even herstart geen reeks meldingen (probleem, opgelost, probleem, ...). Schijf en updates: meteen.
OPEN_AFTER: dict[str, int] = {"site": 4, "service": 2, "container": 2}
CLEAR_AFTER: dict[str, int] = {"site": 6, "service": 2, "container": 2}


class EventStore:
    """Gebeurtenissen in SQLite. Max 30 dagen en 2000 rijen."""

    def __init__(self, path: Path, debounce: bool = True) -> None:
        self.path = path
        self.open_after = OPEN_AFTER if debounce else {}
        self.clear_after = CLEAR_AFTER if debounce else {}
        # Tellers in het geheugen: na een herstart begint de telling opnieuw, wat enkel een melding iets uitstelt.
        self._seen: dict[str, int] = {}
        self._missed: dict[str, int] = {}
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, level TEXT NOT NULL,"
            " kind TEXT NOT NULL, key TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL)"
        )
        self._db.execute("CREATE TABLE IF NOT EXISTS open (key TEXT PRIMARY KEY, event_id INTEGER NOT NULL)")
        self._db.commit()

    def sync(self, current_conditions: dict[str, dict[str, Any]], now: int | None = None, unknown_kinds: set[str] | frozenset[str] = frozenset(),
             parked: set[str] | frozenset[str] = frozenset()) -> int:
        """Vergelijkt met de open problemen. Geeft het aantal nieuwe gebeurtenissen terug.

        unknown_kinds: soorten waarvan de collector nu geen gegevens heeft (net gestart, Docker onbereikbaar). Hun open
        problemen blijven open; "geen gegevens" is niet hetzelfde als "opgelost".
        parked: sleutels van wat nu bewust uit staat. Hun open problemen sluiten meteen, met "Bewust uit" in plaats van
        "Opgelost" (de app haalt de melding dan weg zonder een nieuwe te tonen).
        """
        now = now or int(time.time())
        added = 0
        with self._lock:
            open_keys = dict(self._db.execute("SELECT key, event_id FROM open").fetchall())
            for key, c in current_conditions.items():
                self._missed.pop(key, None)
                if key in open_keys:
                    continue
                self._seen[key] = self._seen.get(key, 0) + 1
                if self._seen[key] < self.open_after.get(c["kind"], 1):
                    continue
                self._seen.pop(key, None)
                cur = self._db.execute(
                    "INSERT INTO events (ts, level, kind, key, resolved, data) VALUES (?,?,?,?,0,?)",
                    (now, c["level"], c["kind"], key, json.dumps({"title": c["title"], "body": c["body"]})),
                )
                self._db.execute("INSERT INTO open (key, event_id) VALUES (?,?)", (key, cur.lastrowid))
                added += 1
            for key in [k for k in self._seen if k not in current_conditions]:
                del self._seen[key]  # de reeks is onderbroken: opnieuw beginnen met tellen
            for key, event_id in open_keys.items():
                if key in current_conditions:
                    continue
                row = self._db.execute("SELECT kind, data FROM events WHERE id=?", (event_id,)).fetchone()
                is_parked = key in parked
                if row and row[0] in unknown_kinds and not is_parked:
                    continue
                if row and not is_parked:
                    self._missed[key] = self._missed.get(key, 0) + 1
                    if self._missed[key] < self.clear_after.get(row[0], 1):
                        continue
                self._missed.pop(key, None)
                self._db.execute("DELETE FROM open WHERE key=?", (key,))
                if not row:
                    continue
                kind, data = row[0], json.loads(row[1])
                title = data.get("title") or {}
                name = key.partition(":")[2] or key
                payload = ({"title": T(f"Bewust uit: {name}", f"Switched off on purpose: {name}"),
                            "body": T("Telt niet meer als probleem zolang het uit staat.", "No longer counts as a problem while it is off.")}
                           if is_parked else
                           {"title": T(f"Opgelost: {title.get('nl', key)}", f"Resolved: {title.get('en', key)}"),
                            "body": T("Het probleem is niet meer aanwezig.", "The problem is gone.")})
                self._db.execute(
                    "INSERT INTO events (ts, level, kind, key, resolved, data) VALUES (?,?,?,?,1,?)",
                    (now, "ok", kind, key, json.dumps(payload)),
                )
                added += 1
            self._db.execute("DELETE FROM events WHERE ts < ?", (now - 30 * 86400,))
            self._db.execute("DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 2000)")
            self._db.commit()
        return added

    def list(self, since: int, limit: int) -> dict[str, Any]:
        lang = current()
        with self._lock:
            rows = self._db.execute(
                "SELECT id, ts, level, kind, key, resolved, data FROM events WHERE id > ? ORDER BY id DESC LIMIT ?", (since, limit)
            ).fetchall()
            last = self._db.execute("SELECT COALESCE(MAX(id), 0) FROM events").fetchone()[0]
            open_count = self._db.execute("SELECT COUNT(*) FROM open").fetchone()[0]
        events = []
        for r in rows:
            data = json.loads(r[6])
            events.append({
                "id": r[0], "ts": r[1], "level": r[2], "kind": r[3], "key": r[4], "resolved": bool(r[5]),
                "title": (data.get("title") or {}).get(lang, ""), "body": (data.get("body") or {}).get(lang, ""),
            })
        return {"last_id": last, "open": open_count, "events": events}

    def close(self) -> None:
        with self._lock:
            self._db.close()


# --- Systeemupdates ----------------------------------------------------------------------------------------


def read_apt_status(path: Path) -> dict[str, Any]:
    """Leest het resultaat van hal-apt-check (draait als root, schrijft JSON). Ontbreekt het: nog niet gecontroleerd."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"checked_at": None, "count": 0, "held_count": 0, "security_count": 0, "full_upgrade_removes": [], "packages": [], "reboot_required": False,
                "error": None, "last_upgrade": None}
    pkgs = []
    for p in data.get("packages") or []:
        if isinstance(p, dict) and isinstance(p.get("name"), str):
            reason = p.get("reason") if p.get("reason") in ("hold", "phased", "removal", "other") else None
            pkgs.append({"name": p["name"][:100], "from": str(p.get("from") or "")[:60], "to": str(p.get("to") or "")[:60],
                         "security": bool(p.get("security")), "held": bool(p.get("held")), "reason": reason if p.get("held") else None})
    ready = [p for p in pkgs if not p["held"]]
    # Installeerbaar = wat de knop echt bijwerkt. Tegengehouden pakketten tellen apart en geven geen "update klaar".
    return {
        "checked_at": data.get("checked_at"),
        "count": len(ready),
        "held_count": len(pkgs) - len(ready),
        "security_count": sum(1 for p in ready if p["security"]),
        "full_upgrade_removes": [str(x)[:100] for x in data.get("full_upgrade_removes") or [] if isinstance(x, str)][:50],
        "packages": sorted(pkgs, key=lambda p: (p["held"], not p["security"], p["name"]))[:300],
        "reboot_required": bool(data.get("reboot_required")),
        "error": (str(data["error"])[:300] if data.get("error") else None),
        "last_upgrade": _last_upgrade(path.with_name("last-upgrade.json"), {p["name"] for p in pkgs}),
    }


def _last_upgrade(path: Path, still_upgradable: set[str]) -> dict[str, Any] | None:
    """Samenvatting van de laatste installatie (hal-apt-upgrade): hoeveel, en wat tegengehouden werd en nog openstaat."""
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    def num(k: str) -> int | None:
        v = d.get(k)
        return v if isinstance(v, int) and v >= 0 else None
    kept = [str(x)[:100] for x in d.get("kept_back") or [] if isinstance(x, str)]
    return {"at": num("at"), "rc": d.get("rc") if isinstance(d.get("rc"), int) else None, "upgraded": num("upgraded"),
            "newly_installed": num("newly_installed"), "not_upgraded": num("not_upgraded"),
            "kept_back": [k for k in kept if k in still_upgradable][:200]}


# --- Agent-updates -------------------------------------------------------------------------------------------


def parse_version(v: str | None) -> tuple[int, int, int] | None:
    m = VERSION_RE.match((v or "").strip())
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


class ReleaseChecker:
    """Vraagt de nieuwste release op GitHub op. Enkel wanneer de app erom vraagt, en hooguit om de 6 uur."""

    TTL = 6 * 3600

    def __init__(self, repo: str, enabled: bool = True) -> None:
        self.repo = repo if REPO_RE.match(repo or "") else ""
        self.enabled = enabled and bool(self.repo)
        self._cache: tuple[float, dict[str, Any]] | None = None

    async def latest(self, force: bool = False) -> dict[str, Any]:
        if not self.enabled:
            return {"tag": None, "version": None, "url": None, "notes": "", "error": "disabled"}
        if self._cache and not force and time.time() - self._cache[0] < self.TTL:
            return self._cache[1]
        try:
            async with httpx.AsyncClient(timeout=10.0, headers={"Accept": "application/vnd.github+json", "User-Agent": "nex-pi-control-agent"}) as c:
                r = await c.get(f"https://api.github.com/repos/{self.repo}/releases/latest")
            if r.status_code == 404:
                res = {"tag": None, "version": None, "url": None, "notes": "", "error": None}
            else:
                r.raise_for_status()
                j = r.json()
                tag = str(j.get("tag_name") or "")
                ver = parse_version(tag)
                res = {"tag": tag if ver else None, "version": ".".join(map(str, ver)) if ver else None,
                       "url": str(j.get("html_url") or "")[:300], "notes": str(j.get("body") or "")[:2000], "error": None}
        except (httpx.HTTPError, ValueError) as exc:
            res = {"tag": None, "version": None, "url": None, "notes": "", "error": exc.__class__.__name__}
            # Fouten kort cachen, zodat we GitHub niet bestoken.
            self._cache = (time.time() - self.TTL + 300, res)
            return res
        self._cache = (time.time(), res)
        return res


def update_available(current_version: str, latest_version: str | None) -> bool:
    a, b = parse_version(current_version), parse_version(latest_version)
    return bool(a and b and b > a)
