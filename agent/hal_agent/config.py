"""Instellingen uit de omgeving (agent.env) en YAML-bestanden in /etc/hal-agent."""

from __future__ import annotations

import json
import os
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from hal_common.auth import normalize_team_domain

from .collectors.site_discovery import merge_sites

ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
UNIT_RE = re.compile(r"^[A-Za-z0-9@_.:\\-]{1,200}\.service$")
MAC_RE = re.compile(r"^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$")
HOST_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")


def _bool(v: str | None) -> bool:
    return (v or "").strip().lower() in ("1", "true", "yes", "on")


@dataclass
class Settings:
    token: str
    mock: bool
    mock_scenario: str
    team_domain: str | None
    aud: str | None
    host: str
    port: int
    config_dir: Path
    state_dir: Path
    docker_proxy: str
    ports_file: Path
    backup_roots: list[Path]
    shell_url: str | None
    hostname_confirm: str
    update_repo: str = "NexaiGuy/nex-pi-control"
    update_check: bool = True

    @classmethod
    def from_env(cls) -> Settings:
        mock = _bool(os.environ.get("HAL_AGENT_MOCK"))
        base = Path(__file__).resolve().parent.parent
        state_default = str(base / ".mockstate") if mock else "/var/lib/hal-agent"
        config_default = str(base / "config") if mock else "/etc/hal-agent"
        token = os.environ.get("HAL_AGENT_TOKEN", "")
        if mock and not token:
            token = "mock-token-for-local-development-only-000000"
        return cls(
            token=token,
            mock=mock,
            mock_scenario=os.environ.get("HAL_AGENT_MOCK_SCENARIO", "ok"),
            team_domain=normalize_team_domain(os.environ.get("CF_ACCESS_TEAM_DOMAIN")),
            aud=(os.environ.get("CF_ACCESS_AUD") or "").strip() or None,
            host=os.environ.get("HAL_AGENT_HOST", "127.0.0.1"),
            port=int(os.environ.get("HAL_AGENT_PORT", "8120")),
            config_dir=Path(os.environ.get("HAL_AGENT_CONFIG_DIR", config_default)),
            state_dir=Path(os.environ.get("HAL_AGENT_STATE_DIR", state_default)),
            docker_proxy=os.environ.get("HAL_AGENT_DOCKER_PROXY", "http://127.0.0.1:2375"),
            ports_file=Path(os.environ.get("HAL_AGENT_PORTS_FILE", "/etc/hal-agent/ports.md")),
            backup_roots=[Path(p) for p in os.environ.get("HAL_AGENT_BACKUP_ROOTS", "/var/backups").split(":") if p],
            shell_url=os.environ.get("HAL_AGENT_SHELL_URL") or None,
            hostname_confirm=os.environ.get("HAL_AGENT_CONFIRM_NAME", ""),
            update_repo=os.environ.get("HAL_UPDATE_REPO", "NexaiGuy/nex-pi-control"),
            update_check=not os.environ.get("HAL_UPDATE_CHECK") or _bool(os.environ.get("HAL_UPDATE_CHECK")),
        )


class YamlConfig:
    """Leest een YAML-bestand opnieuw in zodra het wijzigt."""

    def __init__(self, path: Path, default: dict[str, Any]) -> None:
        self.path = path
        self.default = default
        self._mtime: float | None = None
        self._data: dict[str, Any] = dict(default)
        self._lock = threading.Lock()

    def get(self) -> dict[str, Any]:
        with self._lock:
            try:
                mtime = self.path.stat().st_mtime
            except OSError:
                self._data = dict(self.default)
                self._mtime = None
                return self._data
            if mtime != self._mtime:
                try:
                    loaded = yaml.safe_load(self.path.read_text(encoding="utf-8")) or {}
                    if not isinstance(loaded, dict):
                        loaded = {}
                except (OSError, yaml.YAMLError):
                    loaded = {}
                data = dict(self.default)
                data.update(loaded)
                self._data = data
                self._mtime = mtime
            return self._data


class JsonFile:
    """Leest een JSON-bestand opnieuw in zodra het wijzigt (zoals discovered.json van de root-collector)."""

    def __init__(self, path: Path | None) -> None:
        self.path = path
        self._mtime: float | None = None
        self._data: Any = None
        self._lock = threading.Lock()

    def get(self) -> Any:
        if self.path is None:
            return None
        with self._lock:
            try:
                mtime = self.path.stat().st_mtime
            except OSError:
                self._data, self._mtime = None, None
                return None
            if mtime != self._mtime:
                try:
                    self._data = json.loads(self.path.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    self._data = None
                self._mtime = mtime
            return self._data


@dataclass
class ConfigFiles:
    config_dir: Path
    discovered_sites_path: Path | None = None
    allowed_actions: YamlConfig = field(init=False)
    commands: YamlConfig = field(init=False)
    wol: YamlConfig = field(init=False)
    sensors: YamlConfig = field(init=False)
    gpio: YamlConfig = field(init=False)
    sites: YamlConfig = field(init=False)
    discovered_sites: JsonFile = field(init=False)
    backups: YamlConfig = field(init=False)

    def __post_init__(self) -> None:
        d = self.config_dir
        self.allowed_actions = YamlConfig(d / "allowed-actions.yml", {"restart": [], "power": True, "containers": True, "container_deny": [], "updates": True, "agent_update": True})
        self.commands = YamlConfig(d / "commands.yml", {"commands": []})
        self.wol = YamlConfig(d / "wol.yml", {"devices": []})
        self.sensors = YamlConfig(d / "sensors.yml", {"sensors": []})
        self.gpio = YamlConfig(d / "gpio.yml", {"allowed_pins": [], "labels": {}})
        self.sites = YamlConfig(d / "sites.yml", {"sites": []})
        self.discovered_sites = JsonFile(self.discovered_sites_path)
        self.backups = YamlConfig(d / "backups.yml", {"max_age_hours": 36, "ignore": [], "snapshots_are_archive": True, "timers": ["*backup*"]})

    # Gevalideerde weergaven -------------------------------------------------

    def restart_units(self) -> list[str]:
        units = self.allowed_actions.get().get("restart") or []
        out = []
        for u in units:
            if isinstance(u, str):
                name = u if u.endswith(".service") else f"{u}.service"
                if UNIT_RE.match(name):
                    out.append(name)
        return out

    def allow(self, key: str) -> bool:
        """Aan/uit-schakelaars in allowed-actions.yml: containers, updates, agent_update, power. Standaard aan."""
        v = self.allowed_actions.get().get(key, True)
        return v is True or (isinstance(v, str) and v.strip().lower() in ("true", "yes", "on", "1"))

    def container_restart_allowed(self, name: str) -> bool:
        if not self.allow("containers"):
            return False
        deny = {str(x) for x in (self.allowed_actions.get().get("container_deny") or []) if isinstance(x, str)}
        return name not in deny

    def command_list(self) -> list[dict[str, Any]]:
        out = []
        for c in self.commands.get().get("commands") or []:
            if not isinstance(c, dict):
                continue
            cid = str(c.get("id", ""))
            if not ID_RE.match(cid):
                continue
            out.append(
                {
                    "id": cid,
                    "name": str(c.get("name") or cid)[:60],
                    "description": str(c.get("description") or "")[:200],
                    "icon": str(c.get("icon") or "terminal")[:30],
                    "dangerous": bool(c.get("dangerous", False)),
                    "timeout": max(5, min(int(c.get("timeout", 120)), 900)),
                    "effect": str(c.get("effect") or "")[:200],
                }
            )
        return out

    def wol_devices(self) -> list[dict[str, Any]]:
        out = []
        for d in self.wol.get().get("devices") or []:
            if not isinstance(d, dict):
                continue
            did, mac = str(d.get("id", "")), str(d.get("mac", ""))
            if ID_RE.match(did) and MAC_RE.match(mac):
                out.append(
                    {
                        "id": did,
                        "name": str(d.get("name") or did)[:60],
                        "mac": mac.upper().replace("-", ":"),
                        "broadcast": str(d.get("broadcast") or "255.255.255.255"),
                        "port": int(d.get("port", 9)),
                    }
                )
        return out

    def sensor_list(self) -> list[dict[str, Any]]:
        out = []
        for s in self.sensors.get().get("sensors") or []:
            if isinstance(s, dict) and ID_RE.match(str(s.get("id", ""))) and s.get("type") in ("ds18b20", "dht", "bmp280"):
                out.append(dict(s))
        return out

    def gpio_allowed(self) -> set[int]:
        pins = set()
        for p in self.gpio.get().get("allowed_pins") or []:
            try:
                n = int(p)
            except (TypeError, ValueError):
                continue
            if 0 <= n <= 27:
                pins.add(n)
        return pins

    def gpio_labels(self) -> dict[int, str]:
        labels = {}
        for k, v in (self.gpio.get().get("labels") or {}).items():
            try:
                labels[int(k)] = str(v)[:40]
            except (TypeError, ValueError):
                continue
        return labels

    def backup_policy(self) -> dict[str, Any]:
        """Welke back-upmappen bewaakt worden en hoe oud ze mogen zijn (backups.yml)."""
        raw = self.backups.get()
        try:
            hours = max(1, min(int(raw.get("max_age_hours", 36)), 24 * 90))
        except (TypeError, ValueError):
            hours = 36
        ignore = [str(x)[:120] for x in (raw.get("ignore") or []) if isinstance(x, str | int)]
        timers = [str(x)[:120] for x in (raw.get("timers") or []) if isinstance(x, str)]
        return {"max_age_seconds": hours * 3600, "ignore": ignore, "snapshots_are_archive": raw.get("snapshots_are_archive", True) is not False,
                "timers": timers}

    def site_list(self, skip_local: set[str] | None = None) -> list[dict[str, Any]]:
        """sites.yml plus de automatisch gevonden hostnames (hal-sites-discover). Zie site_discovery.merge_sites."""
        return merge_sites(self.sites.get(), self.discovered_sites.get(), lambda h: bool(HOST_RE.match(h)), skip_local)

    def site_discovery(self) -> dict[str, Any]:
        """Wat de app toont over de automatische lijst: aan/uit, bronnen en tunnels die enkel in het dashboard staan."""
        manual = self.sites.get()
        d = self.discovered_sites.get()
        d = d if isinstance(d, dict) else {}
        sources = [{"label": str(x.get("label", ""))[:60], "kind": str(x.get("kind", ""))[:12], "count": int(x.get("count") or 0)}
                   for x in d.get("sources") or [] if isinstance(x, dict)]
        return {"enabled": manual.get("discover", True) is not False, "generated_at": d.get("generated_at"), "sources": sources,
                "remote_tunnels": [str(x)[:60] for x in d.get("remote_tunnels") or [] if isinstance(x, str)],
                "excluded": len([x for x in manual.get("exclude") or [] if isinstance(x, str)])}
