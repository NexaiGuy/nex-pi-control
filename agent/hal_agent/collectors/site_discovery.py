"""Vindt publieke hostnames automatisch, zodat sites.yml niet bij elke nieuwe site met de hand moet.

Bronnen (enkel lezen, er wordt nooit iets aan cloudflared of nginx veranderd):
- cloudflared-configs met een `ingress`-lijst: /etc/cloudflared, ~/.cloudflared van elke gebruiker,
  de --config van elke cloudflared-unit en de configmappen van cloudflared-containers;
- tunnels die met een token draaien (beheerd in het Cloudflare-dashboard) hebben geen lokale ingress.
  Die worden enkel bij naam gemeld, de token zelf wordt nooit gelezen of bewaard;
- optioneel nginx server_name (sites.yml: discover_nginx: true).

De root-collector bin/hal-sites-discover gebruikt deze functies en schrijft discovered.json.
De agent voegt dat samen met sites.yml in `merge_sites`.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml

HOST_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
LOCAL_RE = re.compile(r"^https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:(\d{1,5}))?(/.*)?$", re.I)
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
CONFIG_ARG_RE = re.compile(r"--config(?:=|\s+)(\S+)")
MAX_SITES = 200


def _local(service: str) -> str | None:
    """Enkel een lokale http-origin is na te gaan vanuit de agent (https-origins en docker-namen niet)."""
    m = LOCAL_RE.match(service.strip())
    if not m or not service.lower().startswith("http://"):
        return None
    port = m.group(3) or "80"
    return f"http://127.0.0.1:{port}"


def tunnel_label(path: str, data: dict[str, Any], unit: str | None = None) -> str:
    """Leesbare naam: de tunnelnaam als dat geen UUID is, anders de unit, anders de bestandsnaam."""
    name = str(data.get("tunnel") or "").strip()
    if name and not UUID_RE.match(name):
        return name[:60]
    if unit:
        return unit.removesuffix(".service")[:60]
    stem = Path(path).stem
    if stem in ("config", "cloudflared"):
        parent = Path(path).parent
        owner = parent.parent.name if parent.name == ".cloudflared" else parent.name
        return f"{stem} ({owner})"[:60]
    return stem[:60]


def parse_ingress(data: Any, label: str) -> list[dict[str, Any]]:
    """Hostnames uit een cloudflared-config. Wildcards, ssh/tcp/rdp en de catch-all vallen weg."""
    if not isinstance(data, dict):
        return []
    out = []
    for rule in data.get("ingress") or []:
        if not isinstance(rule, dict):
            continue
        host = str(rule.get("hostname") or "").strip().lower().rstrip(".")
        service = str(rule.get("service") or "").strip()
        if not HOST_RE.match(host) or not service.lower().startswith(("http://", "https://")):
            continue
        site: dict[str, Any] = {"hostname": host, "source": label, "kind": "tunnel"}
        local = _local(service)
        if local:
            site["local"] = local
        out.append(site)
    return out


def parse_unit_exec(exec_start: str, environment: str = "") -> dict[str, Any]:
    """Uit `systemctl show -p ExecStart,Environment`: het --config-pad en of de tunnel met een token draait."""
    m = CONFIG_ARG_RE.search(exec_start)
    remote = "--token" in exec_start or "TUNNEL_TOKEN=" in environment or "--token-file" in exec_start
    return {"config": m.group(1).strip("'\"") if m else None, "remote": remote}


REMOTE_CFG_RE = re.compile(r'Updated to new configuration config="((?:[^"\\]|\\.)*)"')


def parse_remote_log(lines) -> dict[str, Any] | None:
    """Laatste configuratie die een token-tunnel van Cloudflare kreeg, uit zijn eigen log.

    cloudflared logt bij elke start en wijziging `Updated to new configuration config="{\"ingress\":[...]}"`.
    Daar staan hostnames en origins in, geen token of credentials.
    """
    last = None
    for line in lines:
        if "Updated to new configuration" in line:
            m = REMOTE_CFG_RE.search(line)
            if m:
                last = m.group(1)
    if last is None:
        return None
    try:
        data = json.loads(json.loads(f'"{last}"'))
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _strip_comments(text: str) -> str:
    return "\n".join(line.split("#", 1)[0] for line in text.splitlines())


def parse_nginx(text: str, label: str) -> list[dict[str, Any]]:
    """server_name en listen per server-blok. Regex-namen, wildcards, IP's en `_` vallen weg."""
    text = _strip_comments(text)
    out: list[dict[str, Any]] = []
    depth, server_depth = 0, None
    names: list[str] = []
    ports: list[int] = []
    for tok in re.finditer(r"[{};]|[^{};]+", text):
        s = tok.group(0)
        if s == "{":
            depth += 1
            continue
        if s == "}":
            if server_depth is not None and depth == server_depth:
                port = next((p for p in ports if p != 443), None)
                for n in names:
                    site: dict[str, Any] = {"hostname": n, "source": label, "kind": "nginx"}
                    if port:
                        site["local"] = f"http://127.0.0.1:{port}"
                    out.append(site)
                server_depth, names, ports = None, [], []
            depth = max(0, depth - 1)
            continue
        if s == ";":
            continue
        words = s.split()
        if not words:
            continue
        if words[0] == "server" and len(words) == 1 and text[tok.end():].lstrip().startswith("{"):
            server_depth = depth + 1
        elif server_depth is not None and depth == server_depth:
            if words[0] == "server_name":
                names += [w.lower().rstrip(".") for w in words[1:] if HOST_RE.match(w.lower().rstrip("."))]
            elif words[0] == "listen" and len(words) > 1:
                m = re.search(r"(?:^|:)(\d{1,5})$", words[1])
                if m and "ssl" not in words:
                    ports.append(int(m.group(1)))
    return out


def load_yaml(path: Path) -> Any:
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, yaml.YAMLError):
        return None


def dedupe(sites: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Eerste bron wint; tunnels staan voor nginx, dus een tunnel-hostname krijgt de tunnel als bron."""
    seen: dict[str, dict[str, Any]] = {}
    for s in sorted(sites, key=lambda x: (x.get("kind") != "tunnel", x["hostname"])):
        cur = seen.get(s["hostname"])
        if cur is None:
            seen[s["hostname"]] = dict(s)
        elif not cur.get("local") and s.get("local"):
            cur["local"] = s["local"]
    return list(seen.values())[:MAX_SITES]


def merge_sites(manual: dict[str, Any], discovered: dict[str, Any] | None, host_ok, skip_local: set[str] | None = None) -> list[dict[str, Any]]:
    """sites.yml + discovered.json. Handmatige velden (path, local) winnen, `exclude` haalt een hostname weg.

    `discover: false` in sites.yml zet de automatische lijst uit; dan telt enkel de handmatige lijst.
    `skip_local`: origins die niet als site tellen (hal-shell staat standaard uit en zou anders altijd offline lijken).
    """
    skip = {x.rstrip("/") for x in skip_local or set()}
    exclude = {str(x).strip().lower() for x in (manual.get("exclude") or []) if isinstance(x, str)}
    out: dict[str, dict[str, Any]] = {}
    if manual.get("discover", True) is not False and isinstance(discovered, dict):
        for s in discovered.get("sites") or []:
            if not isinstance(s, dict):
                continue
            host = str(s.get("hostname", "")).lower()
            local = s.get("local")
            if host_ok(host) and host not in exclude and not (local and str(local).rstrip("/") in skip):
                out[host] = {"hostname": host, "local": str(local) if local else None, "path": "/",
                             "source": str(s.get("source") or "")[:60] or None}
    for s in manual.get("sites") or []:
        if not isinstance(s, dict):
            continue
        host = str(s.get("hostname", "")).lower()
        if not host_ok(host) or host in exclude:
            continue
        prev = out.get(host, {})
        local = s.get("local") or prev.get("local")
        out[host] = {"hostname": host, "local": str(local) if local else None, "path": str(s.get("path") or "/"),
                     "source": prev.get("source") or "sites.yml"}
    return sorted(out.values(), key=lambda x: x["hostname"])[:MAX_SITES]
