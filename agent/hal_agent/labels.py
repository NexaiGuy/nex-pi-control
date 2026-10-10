"""Bewust uitgezet en categorieën voor diensten, containers en sites.

Drie bronnen, in deze volgorde:

1. Wat je in de app instelt (labels.json in de statemap). Gaat altijd voor.
2. groups.yml in de configmap: patronen voor `parked` (bewust uit) en `groups` (categorieën).
3. Automatische regels (`auto_parked: true`, standaard aan):
   - dienst: niet actief en uitgeschakeld (disabled of masked);
   - container: gestopt met exitcode 0, of met 130, 137 of 143 (het signaal van docker stop of compose stop) terwijl
     het herstartbeleid always of unless-stopped is. Een andere exitcode is een crash: Docker herstart een container
     die binnen 10 s na de start stopt niet, die blijft dus gewoon een probleem. Een OOM-kill ook;
   - site: onbereikbaar terwijl de backend bewust uit staat (de tunnelcontainer, de container op die poort, een dienst
     die die poort in zijn unitbestand of in het poortregister heeft);
   - back-up (sinds 1.3.1): de timer is uitgeschakeld, de eigen dienst van de back-up staat bewust uit, of alles waar
     de back-up bij hoort staat bewust uit (ndf2-backup bij het compose-project ndf2). Zie Labels.annotate_backups.

Bewust uit geldt enkel zolang iets niet draait. Start je het opnieuw, dan wordt het meteen weer gewoon bewaakt.
Iets dat bewust uit staat telt niet als probleem, geeft geen melding en staat in de app apart onderaan.
"""

from __future__ import annotations

import fnmatch
import json
import os
import re
import tempfile
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from hal_common.i18n import L

KINDS = ("service", "container", "site")
GROUP_MAX = 40
MAX_ITEMS = 3000
GROUP_RE = re.compile(r"^[^\x00-\x1f\x7f]{1,40}$")

SERVICE_RUNNING = {"active", "activating", "reloading", "deactivating", "refreshing"}
CONTAINER_RUNNING = {"running", "restarting"}
SITE_OK = {"up", "protected"}
# Exitcodes van docker stop (SIGTERM, of SIGKILL na de time-out) en Ctrl+C.
STOP_SIGNALS = {130, 137, 143}
LOCAL_HOSTS = {"127.0.0.1", "localhost", "0.0.0.0", "::1", "[::1]"}
PORT_RE = re.compile(r"(?:--port[= ]|\bPORT=|\b-p\s+|:)(\d{2,5})\b")

# Volgorde van de secties in de app: eerst je eigen categorieën, dan de automatische, systeem helemaal achteraan.
ORDER_AUTO = 1000
ORDER_OTHER = 1500
ORDER_SYSTEM = 2000


def _stem(name: str) -> str:
    return name[:-8] if name.endswith(".service") else name


def base_domain(host: str) -> str:
    parts = host.lower().strip(".").split(".")
    if len(parts) <= 2:
        return ".".join(parts)
    # example.co.uk, example.com.au: drie labels.
    if len(parts[-1]) == 2 and parts[-2] in ("co", "com", "org", "net", "ac", "gov", "edu", "or", "ne"):
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def _clean_patterns(raw: Any) -> list[str]:
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    return [str(p).strip().lower()[:200] for p in raw if isinstance(p, str | int) and str(p).strip()]


def _compile(patterns: list[str]) -> list[tuple[str | None, re.Pattern[str]]]:
    out: list[tuple[str | None, re.Pattern[str]]] = []
    for p in patterns:
        scope, sep, glob = p.partition(":")
        if sep and scope in ("service", "container", "project", "site", "backup"):
            out.append((scope, re.compile(fnmatch.translate(glob))))
        else:
            out.append((None, re.compile(fnmatch.translate(p))))
    return out


def match_any(patterns: list[str] | list[tuple[str | None, re.Pattern[str]]], kind: str, names: dict[str, str]) -> bool:
    """`names`: per soort de naam waarop gematcht wordt. Een patroon zonder voorvoegsel geldt voor elke naam.

    Voorvoegsels: service:, container:, project: (compose-project), site:, backup:.
    """
    compiled = _compile(patterns) if patterns and isinstance(patterns[0], str) else patterns  # type: ignore[arg-type]
    for scope, rx in compiled:  # type: ignore[misc]
        if scope is not None:
            value = names.get(scope)
            if value is not None and rx.match(value):
                return True
            continue
        if any(rx.match(v) for v in names.values()):
            return True
    return False


def _names(kind: str, item: dict[str, Any]) -> dict[str, str]:
    if kind == "service":
        return {"service": _stem(str(item.get("name", ""))).lower()}
    if kind == "container":
        out = {"container": str(item.get("name", "")).lower()}
        proj = item.get("project")
        if proj and proj != "los":
            out["project"] = str(proj).lower()
        return out
    return {"site": str(item.get("hostname", "")).lower()}


# Woorden die een back-up aanduiden. Wat overblijft is waar de back-up bij hoort: ndf2-backup -> ndf2.
BACKUP_WORDS = re.compile(r"(?:^|[-_.])(?:backups?|bak|dump|snapshot|offsite|nightly|daily|weekly)(?=$|[-_.])")
BACKUP_REASONS = {
    "timer_off": ("timer uitgeschakeld", "timer disabled"),
    "target": ("hoort bij iets dat bewust uit staat", "belongs to something switched off"),
    "config": ("groups.yml", "groups.yml"),
    "app": ("ingesteld in de app", "set in the app"),
}


def backup_stem(name: str) -> str:
    s = _stem(str(name or "").lower())
    s = s[:-6] if s.endswith(".timer") else s
    return BACKUP_WORDS.sub("-", s).strip("-_.")


def _related(stem: str, other: str) -> bool:
    """ndf2 hoort bij ndf2, ndf2-web en ndf2_db, niet bij ndf20."""
    if not stem or not other:
        return False
    return other == stem or other.startswith((stem + "-", stem + "_")) or stem.startswith((other + "-", other + "_"))


def is_running(kind: str, item: dict[str, Any]) -> bool:
    if kind == "service":
        return item.get("active") in SERVICE_RUNNING
    if kind == "container":
        return item.get("state") in CONTAINER_RUNNING
    return item.get("state") in SITE_OK


def auto_parked(kind: str, item: dict[str, Any]) -> str | None:
    """Reden waarom iets vanzelf als bewust uit telt, of None. Sites: zie Labels.annotate (hangt af van de backend)."""
    if kind == "service":
        if item.get("active") in ("inactive", "failed") and item.get("enabled") in ("disabled", "masked", "masked-runtime"):
            return "disabled"
        return None
    if kind == "container":
        if item.get("state") not in ("exited", "dead"):
            return None
        code = item.get("exit_code")
        if code == 0:
            return "stopped"
        if code in STOP_SIGNALS and item.get("restart_policy") in ("always", "unless-stopped") and not item.get("oom_killed"):
            return "stopped"
    return None


def unit_ports(path: str | None, cache: dict[str, tuple[float, set[int]]]) -> set[int]:
    """Poorten die in een unitbestand staan (ExecStart, Environment). EnvironmentFile lezen we nooit: daar staan geheimen."""
    if not path:
        return set()
    try:
        st = os.stat(path)
    except OSError:
        return set()
    hit = cache.get(path)
    if hit and hit[0] == st.st_mtime:
        return hit[1]
    ports: set[int] = set()
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read(65536)
    except OSError:
        text = ""
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith(("ExecStart", "Environment=")):
            continue
        for m in PORT_RE.finditer(line):
            n = int(m.group(1))
            if 80 <= n <= 65535:
                ports.add(n)
    cache[path] = (st.st_mtime, ports)
    return ports


def _local_target(local: str | None) -> tuple[str | None, int | None]:
    if not local:
        return None, None
    try:
        u = urlsplit(local if "://" in local else f"http://{local}")
        return (u.hostname or "").lower() or None, u.port or (443 if u.scheme == "https" else 80)
    except ValueError:
        return None, None


class LabelStore:
    """labels.json: wat in de app ingesteld is. Atomisch geschreven, opnieuw ingelezen als het bestand wijzigt."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._mtime: float | None = None
        self._items: dict[str, dict[str, Any]] = {}

    def items(self) -> dict[str, dict[str, Any]]:
        with self._lock:
            try:
                mtime = self.path.stat().st_mtime
            except OSError:
                self._items, self._mtime = {}, None
                return self._items
            if mtime != self._mtime:
                try:
                    data = json.loads(self.path.read_text(encoding="utf-8"))
                    raw = data.get("items") if isinstance(data, dict) else None
                    self._items = {k: v for k, v in (raw or {}).items() if isinstance(k, str) and isinstance(v, dict)}
                except (OSError, ValueError):
                    self._items = {}
                self._mtime = mtime
            return self._items

    def get(self, kind: str, name: str) -> dict[str, Any]:
        return self.items().get(f"{kind}:{name}", {})

    def set(self, kind: str, name: str, changes: dict[str, Any]) -> dict[str, Any]:
        """changes: parked (True/False/None = automatisch) en/of group (str of None = automatisch)."""
        key = f"{kind}:{name}"
        current = dict(self.items())
        entry = {k: v for k, v in current.get(key, {}).items() if k in ("parked", "group")}
        for field in ("parked", "group"):
            if field in changes:
                if changes[field] is None:
                    entry.pop(field, None)
                else:
                    entry[field] = changes[field]
        if entry:
            if key not in current and len(current) >= MAX_ITEMS:
                raise ValueError("te veel labels")
            entry["ts"] = int(time.time())
            current[key] = entry
        else:
            current.pop(key, None)
        self._write(current)
        return entry

    def _write(self, items: dict[str, dict[str, Any]]) -> None:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(prefix=".labels-", dir=str(self.path.parent))
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as fh:
                    json.dump({"version": 1, "items": items}, fh, ensure_ascii=False, indent=1, sort_keys=True)
                os.chmod(tmp, 0o640)
                os.replace(tmp, self.path)
            except BaseException:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise
            self._mtime = None  # volgende items() leest opnieuw in


class Labels:
    """Koppelt groups.yml, labels.json en de automatische regels aan de lijsten van de collectors."""

    def __init__(self, config, store: LabelStore) -> None:
        self.config = config  # YamlConfig voor groups.yml
        self.store = store
        self._unit_cache: dict[str, tuple[float, set[int]]] = {}
        self._settings_cache: tuple[int, dict[str, Any]] | None = None

    # Instellingen ------------------------------------------------------------------------

    def settings(self) -> dict[str, Any]:
        raw = self.config.get()
        # YamlConfig geeft hetzelfde object terug tot het bestand wijzigt: de gecompileerde patronen hergebruiken.
        if self._settings_cache and self._settings_cache[0] == id(raw):
            return self._settings_cache[1]
        groups: list[tuple[str, list[str]]] = []
        g = raw.get("groups") or {}
        if isinstance(g, dict):
            items = list(g.items())
        elif isinstance(g, list):  # ook toegelaten: - name: X / match: [...]
            items = [(x.get("name"), x.get("match")) for x in g if isinstance(x, dict)]
        else:
            items = []
        for name, pats in items:
            name = str(name or "").strip()[:GROUP_MAX]
            if name and GROUP_RE.match(name):
                groups.append((name, _clean_patterns(pats)))
        parked = _clean_patterns(raw.get("parked"))
        out = {"auto_parked": raw.get("auto_parked", True) is not False, "parked": parked, "groups": groups,
               "parked_rx": _compile(parked), "groups_rx": [(n, _compile(p)) for n, p in groups]}
        self._settings_cache = (id(raw), out)
        return out

    def group_names(self) -> list[dict[str, str]]:
        """Alle categorieën om uit te kiezen in de app: eerst die uit groups.yml, dan wat in de app aangemaakt is."""
        out = [{"name": n, "source": "config"} for n, _ in self.settings()["groups"]]
        seen = {x["name"] for x in out}
        for v in self.store.items().values():
            n = v.get("group")
            if isinstance(n, str) and n not in seen:
                seen.add(n)
                out.append({"name": n, "source": "app"})
        return out

    # Annoteren ---------------------------------------------------------------------------

    def annotate(self, services: list[dict[str, Any]] | None, containers: list[dict[str, Any]] | None, sites: list[dict[str, Any]] | None,
                 unit_paths: dict[str, str] | None = None, port_registry: list[dict[str, Any]] | None = None,
                 with_groups: bool = True) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
        """Geeft kopieën terug met parked, parked_reason, parked_setting, parked_rule en (with_groups) group, group_source, group_order."""
        cfg = self.settings()
        app = self.store.items()
        order = {n: i for i, (n, _) in enumerate(cfg["groups"])}
        app_groups = [x["name"] for x in self.group_names() if x["source"] == "app"]
        for i, n in enumerate(app_groups):
            order.setdefault(n, len(cfg["groups"]) + i)

        def one(kind: str, item: dict[str, Any], key_name: str, extra_rule: str | None = None) -> dict[str, Any]:
            names = _names(kind, item)
            setting = app.get(f"{kind}:{key_name}", {})
            p_setting = setting.get("parked") if isinstance(setting.get("parked"), bool) else None
            rule = "config" if match_any(cfg["parked_rx"], kind, names) else None
            if rule is None and cfg["auto_parked"]:
                rule = auto_parked(kind, item) or extra_rule
            running = is_running(kind, item)
            if p_setting is True:
                parked, reason = not running, "app"
            elif p_setting is False:
                parked, reason = False, None
            else:
                parked, reason = (rule is not None and not running), rule
            out = {**item, "parked": parked, "parked_reason": reason if parked else None, "parked_setting": p_setting, "parked_rule": rule}
            if with_groups:
                g = setting.get("group") if isinstance(setting.get("group"), str) else None
                if g:
                    out.update(group=g, group_source="app", group_order=order.get(g, ORDER_AUTO - 1))
                else:
                    for name, pats in cfg["groups_rx"]:
                        if match_any(pats, kind, names):
                            out.update(group=name, group_source="config", group_order=order[name])
                            break
                    else:
                        out.update(self._auto_group(kind, item))
            return out

        svc = [one("service", s, str(s.get("name", ""))) for s in services or []]
        ctr = [one("container", c, str(c.get("name", ""))) for c in containers or []]

        # Sites: welke backends staan bewust uit?
        parked_ctr = [c for c in ctr if c["parked"]]
        parked_svc = [s for s in svc if s["parked"]]
        names_off = {c["name"].lower() for c in parked_ctr}
        ports_off: set[int] = set()
        for c in parked_ctr:
            for p in c.get("host_ports") or []:
                if isinstance(p, int):
                    ports_off.add(p)
            for p in c.get("ports") or []:
                if isinstance(p, dict) and isinstance(p.get("public"), int):
                    ports_off.add(p["public"])
        for s in parked_svc:
            ports_off |= unit_ports((unit_paths or {}).get(s["name"]), self._unit_cache)
        stems = {_stem(s["name"]).lower() for s in parked_svc} | names_off | {str(c.get("project", "")).lower() for c in parked_ctr if c.get("project") not in (None, "", "los")}
        stems = {x for x in stems if len(x) >= 4}
        if stems:
            for row in port_registry or []:
                text = str(row.get("service", "")).lower()
                if isinstance(row.get("port"), int) and any(st in text for st in stems):
                    ports_off.add(row["port"])

        def site_rule(s: dict[str, Any]) -> str | None:
            if s.get("state") in SITE_OK:
                return None
            src = str(s.get("source") or "").lower()
            if src and src in names_off:
                return "backend"
            host, port = _local_target(s.get("local"))
            if host and host not in LOCAL_HOSTS and host in names_off:
                return "backend"
            if host in LOCAL_HOSTS and port in ports_off:
                return "backend"
            return None

        sit = []
        for s in sites or []:
            sit.append(one("site", s, str(s.get("hostname", "")), site_rule(s)))
        if with_groups:
            self._domain_groups(sit)
        return svc, ctr, sit

    def _auto_group(self, kind: str, item: dict[str, Any]) -> dict[str, Any]:
        if kind == "service":
            if item.get("custom"):
                return {"group": L("Eigen diensten", "Own services"), "group_source": "auto", "group_order": ORDER_AUTO}
            return {"group": L("Systeem", "System"), "group_source": "auto", "group_order": ORDER_SYSTEM}
        if kind == "container":
            proj = item.get("project")
            if proj and proj != "los":
                return {"group": str(proj), "group_source": "auto", "group_order": ORDER_AUTO}
            return {"group": L("Losse containers", "Standalone containers"), "group_source": "auto", "group_order": ORDER_OTHER}
        return {"group": base_domain(str(item.get("hostname", ""))), "group_source": "auto", "group_order": ORDER_AUTO}

    @staticmethod
    def _domain_groups(sites: list[dict[str, Any]]) -> None:
        """Domeinen met maar één site samen in 'Andere domeinen', anders krijg je tientallen secties van één regel."""
        count: dict[str, int] = {}
        for s in sites:
            if s.get("group_source") == "auto":
                count[s["group"]] = count.get(s["group"], 0) + 1
        for s in sites:
            if s.get("group_source") == "auto" and count.get(s["group"], 0) < 2:
                s.update(group=L("Andere domeinen", "Other domains"), group_order=ORDER_OTHER)

    # Back-ups --------------------------------------------------------------------------------

    def annotate_backups(self, backups: list[dict[str, Any]] | None, services: list[dict[str, Any]] | None,
                         containers: list[dict[str, Any]] | None, default_max_age: int = 36 * 3600) -> list[dict[str, Any]]:
        """Back-ups van iets dat bewust uit staat tellen niet als probleem. `services` en `containers` komen uit annotate().

        Een back-up staat bewust uit (enkel zolang hij een waarschuwing zou geven) als:
          1. de app het zegt (backup:<naam>, of de eigen dienst van de back-up staat in de app op bewust uit);
          2. groups.yml hem raakt (backup:<glob>, service:<glob> op de eigen dienst, of een patroon zonder voorvoegsel);
          3. automatisch: de timer is uitgeschakeld (geen volgende run), de eigen dienst staat bewust uit, of alles waar
             de naam bij hoort staat bewust uit en er draait daar niets meer van. "nex-backup" bij tientallen nex-diensten
             die nog draaien blijft dus gewoon bewaakt.
        Het item krijgt state "parked" (zodat oudere apps het grijs tonen, zonder "mislukt"), de echte toestand staat in
        state_raw, en de reden staat vooraan in description.
        """
        cfg = self.settings()
        app = self.store.items()
        svc = services or []
        ctr = containers or []
        by_service = {str(s.get("name", "")): s for s in svc}
        projects: dict[str, list[dict[str, Any]]] = {}
        for c in ctr:
            proj = c.get("project")
            if proj and proj != "los":
                projects.setdefault(str(proj).lower(), []).append(c)
        targets: list[tuple[str, bool]] = []  # (naam, bewust uit)
        for s in svc:
            targets.append((_stem(str(s.get("name", ""))).lower(), bool(s.get("parked"))))
        for c in ctr:
            if not c.get("project") or c.get("project") == "los":
                targets.append((str(c.get("name", "")).lower(), bool(c.get("parked"))))
        for proj, items in projects.items():
            targets.append((proj, all(bool(c.get("parked")) for c in items)))

        out = []
        for b in backups or []:
            item = dict(b)
            if b.get("kind", "job") != "job":
                out.append(item)
                continue
            name = str(b.get("name", ""))
            unit = str(b.get("unit") or (name + ".service" if b.get("source") == "timer" else ""))
            names = {"backup": name.lower()}
            if unit:
                names["service"] = _stem(unit).lower()
            setting = app.get(f"backup:{name}", {})
            p_setting = setting.get("parked") if isinstance(setting.get("parked"), bool) else None
            own = by_service.get(unit) if unit else None
            if own is None and unit:
                own = by_service.get(_stem(unit))
            rule: str | None = None
            if p_setting is True or (own is not None and own.get("parked_reason") == "app"):
                rule = "app"
            elif match_any(cfg["parked_rx"], "backup", names):
                rule = "config"
            elif cfg["auto_parked"]:
                if b.get("source") == "timer" and b.get("next_at") == 0:
                    rule = "timer_off"
                elif own is not None and own.get("parked"):
                    rule = own.get("parked_reason") or "target"
                else:
                    stem = backup_stem(name)
                    own_stem = _stem(unit).lower() if unit else ""
                    hits = [p for t, p in targets if t != own_stem and _related(stem, t)] if len(stem) >= 3 else []
                    if hits and all(hits):
                        rule = "target"
            parked = p_setting is not False and rule is not None and _backup_problem(b, default_max_age)
            item.update(parked=parked, parked_reason=rule if parked else None, parked_setting=p_setting, parked_rule=rule)
            if parked:
                nl, en = BACKUP_REASONS.get(rule or "", BACKUP_REASONS["target"])
                label = L(f"Bewust uit ({nl})", f"Switched off ({en})")
                desc = str(b.get("description") or "")
                item.update(state="parked", state_raw=b.get("state"), description=f"{label} · {desc}" if desc else label)
                item.pop("max_age_seconds", None)
            out.append(item)
        return out

    # Eén item, voor het antwoord op een wijziging ------------------------------------------

    def validate_group(self, group: str | None) -> str | None:
        if group is None:
            return None
        g = " ".join(str(group).split())[:GROUP_MAX]
        if not g:
            return None
        if not GROUP_RE.match(g):
            raise ValueError("ongeldige categorie")
        return g


def _backup_problem(b: dict[str, Any], default_max_age: int) -> bool:
    """Zou deze back-up nu een waarschuwing geven? Enkel dan heeft bewust uit zin."""
    if b.get("kind", "job") != "job":
        return False
    state = b.get("state")
    if state in ("failed", "empty", "no_access"):
        return True
    return state == "ok" and (b.get("age_seconds") or 0) > (b.get("max_age_seconds") or default_max_age)


def parked_keys(services: list[dict[str, Any]], containers: list[dict[str, Any]], sites: list[dict[str, Any]]) -> set[str]:
    """Sleutels zoals in maintenance.conditions, voor alles wat nu bewust uit staat."""
    out = {f"service:{s['name']}" for s in services if s.get("parked")}
    out |= {f"container:{c['name']}" for c in containers if c.get("parked")}
    out |= {f"site:{s['hostname']}" for s in sites if s.get("parked")}
    return out
