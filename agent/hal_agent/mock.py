"""Mock-modus (HAL_AGENT_MOCK=1): realistische nepdata zodat de app zonder Pi ontwikkeld kan worden.

HAL_AGENT_MOCK_SCENARIO=ok | disk | busy   stuurt welke toestand je ziet.
"""

from __future__ import annotations

import asyncio
import math
import random
import time
from typing import Any

from hal_common import VERSION
from hal_common.i18n import L
from hal_common.web import api_error

from .audit import AuditLog
from .collectors.gpio import PINOUT
from .config import ConfigFiles, Settings
from .health import compute_health, counts, disk_alarms
from .history import METRIC_CATALOG, RANGES, describe_metric, summarize
from .maintenance import EventStore, conditions, parse_version

GB = 1024**3

SERVICES = [
    ("home-assistant", "Home Assistant Core", 412), ("pihole-FTL", "Pi-hole FTL DNS", 64),
    ("nextcloud-cron", "Nextcloud background jobs", 0), ("jellyfin", "Jellyfin Media Server", 388),
    ("mosquitto", "Mosquitto MQTT Broker", 12), ("zigbee2mqtt", "Zigbee2MQTT", 96),
    ("grafana-server", "Grafana", 143), ("prometheus", "Prometheus", 221), ("node-exporter", "Prometheus Node Exporter", 18),
    ("uptime-kuma", "Uptime Kuma", 102), ("syncthing@pi", "Syncthing", 71), ("wireguard", "WireGuard VPN", 4),
    ("hal-agent", "Nex Pi Control agent", 58), ("cloudflared", "Cloudflare Tunnel", 36), ("tailscaled", "Tailscale", 41),
    ("nginx", "nginx web server", 24), ("docker", "Docker Application Container Engine", 146),
    ("containerd", "containerd container runtime", 61), ("postgresql@16-main", "PostgreSQL Cluster 16-main", 212),
    ("redis-server", "Redis", 18), ("ssh", "OpenBSD Secure Shell server", 7), ("fail2ban", "Fail2Ban Service", 41),
    ("ufw", "Uncomplicated firewall", 0), ("cron", "Regular background program processing", 3),
    ("systemd-journald", "Journal Service", 44), ("systemd-networkd", "Network Configuration", 6),
    ("systemd-resolved", "Network Name Resolution", 9), ("dbus", "D-Bus System Message Bus", 5),
    ("polkit", "Authorization Manager", 11), ("smartmontools", "Self Monitoring and Reporting", 4),
    ("avahi-daemon", "Avahi mDNS/DNS-SD Stack", 3), ("bluetooth", "Bluetooth service", 5), ("backup", "Nightly backup", 0),
    ("photoprism", "PhotoPrism", 297),
]

FAILED_DEMO = "zigbee2mqtt"

PROJECTS = {
    "homeassistant": ["core", "esphome", "matter-server"],
    "media": ["jellyfin", "sonarr", "radarr", "prowlarr", "qbittorrent"],
    "nextcloud": ["app", "db", "redis", "cron"],
    "monitoring": ["grafana", "prometheus", "node-exporter", "cadvisor", "uptime-kuma"],
    "network": ["pihole", "unbound", "wireguard"],
    "photos": ["photoprism", "mariadb"],
    "automation": ["n8n", "postgres", "mosquitto", "zigbee2mqtt"],
    "tools": ["portainer-agent", "docker-socket-proxy", "vaultwarden", "paperless"],
}
BROKEN_CONTAINER = "automation-zigbee2mqtt-1"

SITES = [
    ("home.example.com", "http://127.0.0.1:8123"), ("cloud.example.com", "http://127.0.0.1:8080"),
    ("media.example.com", "http://127.0.0.1:8096"), ("grafana.example.com", "http://127.0.0.1:3000"),
    ("status.example.com", "http://127.0.0.1:3001"), ("photos.example.com", "http://127.0.0.1:2342"),
    ("n8n.example.com", "http://127.0.0.1:5678"), ("vault.example.com", "http://127.0.0.1:8222"),
    ("pi-api.example.com", "http://127.0.0.1:8120"),
]
DOWN_SITE = "n8n.example.com"
CUSTOM = {"home-assistant", "pihole-FTL", "nextcloud-cron", "jellyfin", "mosquitto", "zigbee2mqtt", "grafana-server", "prometheus", "uptime-kuma", "syncthing@pi", "hal-agent", "backup", "photoprism"}
HOSTNAME = "homelab-pi"


def _wave(t: float, period: float, lo: float, hi: float, seed: int = 0) -> float:
    base = (math.sin(2 * math.pi * t / period + seed) + 1) / 2
    wobble = (math.sin(2 * math.pi * t / (period / 7.3) + seed * 3) + 1) / 2 * 0.25
    return lo + (hi - lo) * min(1.0, base * 0.8 + wobble)


class MockBackend:
    mock = True

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.config = ConfigFiles(settings.config_dir)
        settings.state_dir.mkdir(parents=True, exist_ok=True)
        self.audit_log = AuditLog(settings.state_dir / "audit.db")
        self.scenario = settings.mock_scenario
        self.rng = random.Random(9000)
        self.boot = time.time() - 12 * 86400 - 3 * 3600
        self.failed_services = {FAILED_DEMO} if self.scenario in ("disk", "busy", "demo") else set()
        self.gpio_values: dict[int, int] = {}
        self.shell_active_since: float | None = None
        self._net = (0.0, 0.0)
        self.fixed_containers: set[str] = set()
        self.events_store = EventStore(settings.state_dir / "events.db")
        self.apt_packages = [] if self.scenario == "ok" else [
            {"name": "openssl", "from": "3.5.1-1", "to": "3.5.1-1+deb13u1", "security": True},
            {"name": "libssl3t64", "from": "3.5.1-1", "to": "3.5.1-1+deb13u1", "security": True},
            {"name": "raspi-firmware", "from": "1:1.20250430-1", "to": "1:1.20250915-1", "security": False},
            {"name": "docker-ce", "from": "5:28.4.0-1~debian.13", "to": "5:28.5.1-1~debian.13", "security": False},
            {"name": "tzdata", "from": "2025b-4", "to": "2025b-5", "security": False},
        ]
        self.apt_checked_at = int(time.time()) - 2 * 3600
        self.apt_run: dict[str, Any] = {"running": False, "state": "inactive", "result": None, "exit_status": None, "started_at": None, "finished_at": None, "log": []}
        v = parse_version(VERSION) or (1, 0, 0)
        self.latest_version = VERSION if self.scenario == "ok" else f"{v[0]}.{v[1]}.{v[2] + 1}"
        self.agent_run: dict[str, Any] = {"running": False, "state": "inactive", "result": None, "exit_status": None, "started_at": None, "finished_at": None, "log": []}
        self.events_store.sync(self._conditions(), now=int(time.time()) - 3600)

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        self.events_store.close()

    # Nepdata -------------------------------------------------------------

    def _metric_value(self, metric: str, t: float) -> float | None:
        busy = 1.6 if self.scenario == "busy" else 1.0
        if metric == "cpu":
            return round(min(100, _wave(t, 3600, 6, 38, 1) * busy), 1)
        if metric.startswith("cpu.core"):
            i = int(metric[8:])
            return round(min(100, _wave(t, 1800 + i * 300, 3, 45, i + 2) * busy), 1)
        if metric == "ram":
            return round(_wave(t, 86400, 52, 68, 4), 1)
        if metric == "swap":
            return round(_wave(t, 86400, 2, 9, 5), 1)
        if metric == "temp":
            return round(_wave(t, 3600, 46, 61, 1) + (8 if self.scenario == "busy" else 0), 1)
        if metric == "fan":
            return round(_wave(t, 3600, 1800, 3900, 1))
        if metric in ("load1", "load5", "load15"):
            return round(_wave(t, 3600, 0.4, 2.1, {"load1": 1, "load5": 2, "load15": 3}[metric]) * busy, 2)
        if metric == "net.rx":
            return round(_wave(t, 900, 40_000, 2_400_000, 6))
        if metric == "net.tx":
            return round(_wave(t, 900, 60_000, 3_800_000, 7))
        if metric == "disk.read":
            return round(_wave(t, 600, 0, 4_000_000, 8))
        if metric == "disk.write":
            return round(_wave(t, 600, 50_000, 9_000_000, 9))
        if metric == "throttled":
            return 1.0 if self.scenario == "busy" and int(t / 600) % 5 == 0 else 0.0
        if metric == "containers.running":
            return 33.0 if self.scenario == "ok" else 32.0
        if metric == "services.failed":
            return float(len(self.failed_services))
        if metric.startswith("disk.usage:"):
            return {"disk.usage:/": 41.2, "disk.usage:/mnt/data": 73.8 if self.scenario != "busy" else 86.1,
                    "disk.usage:/boot/firmware": 12.4}.get(metric, 30.0) + (t % 86400) / 86400 * 0.3
        if metric.startswith("site.") and metric.endswith(".latency"):
            return round(_wave(t, 1800, 45, 180, len(metric)))
        if metric == "sensor.kast.temp":
            return round(_wave(t, 86400, 21, 27, 2), 1)
        if metric == "sensor.kast.humidity":
            return round(_wave(t, 86400, 38, 55, 3), 1)
        if metric == "sensor.buiten.temp":
            return round(_wave(t, 86400, 9, 19, 5), 1)
        return None

    def _snapshot(self) -> dict[str, Any]:
        t = time.time()
        per_core = [self._metric_value(f"cpu.core{i}", t) for i in range(4)]
        temp = self._metric_value("temp", t)
        busy = self.scenario == "busy"
        return {
            "ts": int(t),
            "cpu": {"percent": round(sum(per_core) / 4, 1), "per_core": per_core, "cores": 4, "freq_mhz": 2400 if not busy else 1500},
            "load": [self._metric_value("load1", t), self._metric_value("load5", t), self._metric_value("load15", t)],
            "memory": {"total": 8 * GB, "used": int(8 * GB * self._metric_value("ram", t) / 100),
                       "available": int(8 * GB * (1 - self._metric_value("ram", t) / 100)), "percent": self._metric_value("ram", t)},
            "swap": {"total": 2 * GB, "used": int(2 * GB * self._metric_value("swap", t) / 100), "percent": self._metric_value("swap", t)},
            "temperature_c": temp,
            "throttling": {"available": True, "now": ["Zachte temperatuurgrens"] if busy else [],
                           "past": ["Zachte temperatuurgrens"] if busy else [], "raw": "0x80008" if busy else "0x0", "active": busy},
            "fan_rpm": self._metric_value("fan", t),
            "network": {"rx_bps": self._metric_value("net.rx", t), "tx_bps": self._metric_value("net.tx", t)},
            "disk_io": {"read_bps": self._metric_value("disk.read", t), "write_bps": self._metric_value("disk.write", t)},
            "uptime_seconds": int(t - self.boot),
        }

    def _mounts(self) -> list[dict[str, Any]]:
        t = time.time()
        rows = [
            ("/dev/nvme0n1p2", "/", "ext4", 476 * GB),
            ("/dev/nvme0n1p1", "/boot/firmware", "vfat", int(0.5 * GB)),
            ("/dev/sda1", "/mnt/data", "ext4", 931 * GB),
        ]
        out = []
        for dev, mp, fs, total in rows:
            pct = self._metric_value(f"disk.usage:{mp}", t)
            used = int(total * pct / 100)
            out.append({"device": dev, "mountpoint": mp, "fstype": fs, "total": total, "used": used,
                        "free": total - used, "percent": round(pct, 1)})
        return out

    def _smart(self) -> list[dict[str, Any]]:
        now = int(time.time())
        nvme = {
            "device": "/dev/nvme0n1", "model": "Samsung SSD 980 PRO 500GB", "serial": "S5GXNX0T123456",
            "firmware": "5B2QGXA7", "protocol": "NVMe", "capacity_bytes": 500107862016, "temperature_c": 41,
            "power_on_hours": 6120, "smart_supported": True, "attributes": {"media_errors": 0, "percentage_used": 3},
            "crc_errors": None, "status": "ok", "reasons": [], "collected_at": now - 90,
        }
        sda = {
            "device": "/dev/sda", "model": "Samsung SSD 870 EVO 1TB", "serial": "S6PTNM0R654321",
            "firmware": "SVT02B6Q", "protocol": "ATA", "capacity_bytes": 1000204886016, "temperature_c": 34,
            "power_on_hours": 9981, "smart_supported": True,
            "attributes": {"reallocated_sectors": 0, "pending_sectors": 0, "offline_uncorrectable": 0, "reported_uncorrectable": 0, "crc_errors": 0},
            "crc_errors": 0, "status": "ok", "reasons": [], "collected_at": now - 90,
        }
        if self.scenario == "disk":
            sda.update({
                "firmware": "SVT01B6Q", "status": "failing",
                "attributes": {"reallocated_sectors": 184, "pending_sectors": 12, "offline_uncorrectable": 3, "reported_uncorrectable": 7, "crc_errors": 21},
                "crc_errors": 21,
                "reasons": [L("184 verplaatste sectoren (reallocated)", "184 reallocated sectors"), L("12 onleesbare sectoren in wachtrij (pending)", "12 pending (unreadable) sectors"),
                            "10 onherstelbare leesfouten (uncorrectable)", "Firmware SVT01B6Q heeft gekende defecten, update aanbevolen"],
            })
        mmc = {"device": "/dev/mmcblk0", "model": L("SD-kaart (SC64G)", "SD card (SC64G)"), "smart_supported": False, "status": "unknown",
               "reasons": [L("SMART niet ondersteund door dit apparaat", "SMART not supported by this device")], "collected_at": now - 90, "attributes": {}}
        return [nvme, sda, mmc]

    def _services(self) -> list[dict[str, Any]]:
        allowed = set(self.config.restart_units())
        out = []
        for i, (name, desc, mem_mb) in enumerate(SERVICES):
            unit = f"{name}.service"
            failed = name in self.failed_services
            oneshot = name in ("backup", "ufw", "nextcloud-cron")
            out.append({
                "name": unit, "description": desc, "custom": name in CUSTOM,
                "active": "failed" if failed else ("inactive" if name in ("backup", "nextcloud-cron") else "active"),
                "sub": "failed" if failed else ("dead" if name in ("backup", "nextcloud-cron") else ("exited" if oneshot else "running")),
                "enabled": "enabled", "uptime_seconds": None if failed else int(time.time() - self.boot - i * 97),
                "memory_bytes": mem_mb * 1024 * 1024 if mem_mb else None, "main_pid": None if failed else 800 + i * 37,
                "restarts": 3 if failed else (1 if i % 11 == 0 else 0),
                "restart_allowed": unit in allowed,
            })
        return out

    def _containers(self) -> list[dict[str, Any]]:
        out, n = [], 0
        for proj, svcs in PROJECTS.items():
            for s in svcs:
                n += 1
                name = f"{proj}-{s}-1"
                stopped = self.scenario != "ok" and name == BROKEN_CONTAINER and name not in self.fixed_containers
                out.append({
                    "id": f"{n:02x}c0ffee{n:04x}"[:12], "name": name,
                    "image": {"postgres": "postgres:16-alpine", "redis": "redis:7-alpine"}.get(s, f"ghcr.io/example/{s}:latest"),
                    "state": "exited" if stopped else "running",
                    "status": "Exited (1) 14 minutes ago" if stopped else f"Up {3 + n % 9} days",
                    "created": int(self.boot), "project": proj, "service": s,
                    "ports": [{"private": 8000 + n, "public": 8000 + n, "ip": "127.0.0.1", "type": "tcp"}] if s in ("web", "api", "dashboard", "factory") else [],
                    "restart_count": 5 if stopped else (1 if n % 13 == 0 else 0),
                    "health": "unhealthy" if stopped else ("healthy" if s in ("api", "postgres", "web") else "geen"),
                    "exit_code": 1 if stopped else 0, "oom_killed": False, "restart_policy": "unless-stopped",
                    "cpu_percent": 0.0 if stopped else round(_wave(time.time(), 300, 0.1, 9.0, n), 1),
                    "memory_bytes": 0 if stopped else (20 + n * 7) * 1024 * 1024, "memory_limit": 8 * GB,
                })
        return out

    def _sites(self) -> list[dict[str, Any]]:
        now = int(time.time())
        out = []
        for i, (host, local) in enumerate(SITES):
            down = self.scenario != "ok" and host == DOWN_SITE
            protected = host in ("vault.example.com", "pi-api.example.com")
            lat = self._metric_value(f"site.{host}.latency", now)
            out.append({
                "hostname": host, "url": f"https://{host}/", "local": local,
                "status_code": 502 if down else (302 if protected else 200), "latency_ms": None if down else lat,
                "state": "down" if down else ("protected" if protected else "up"),
                "tls_expires_at": now + (61 - i * 3) * 86400, "tls_days_left": 61 - i * 3,
                "local_status": None if down else 200, "local_latency_ms": None if down else 3 + i,
                "local_state": "down" if down else "up", "checked_at": now - 20,
            })
        return out

    def _backups(self) -> list[dict[str, Any]]:
        now = int(time.time())
        rows = [("home-assistant", 6 * 3600, 184_000_000), ("nextcloud", 6 * 3600 + 120, 2_420_000_000),
                ("n8n", (50 if self.scenario != "ok" else 6) * 3600, 61_000_000), ("photos", 6 * 3600 + 300, 912_000_000),
                ("config", 30 * 3600, 3_400_000)]
        return [{"name": n, "path": f"/var/backups/{n}", "state": "ok", "latest_file": f"{n}-{time.strftime('%Y%m%d', time.gmtime(now - a))}.tar.zst",
                 "latest_at": now - a, "latest_size": s, "age_seconds": a, "total_size": s * 7, "files": 7} for n, a, s in rows]

    # API ---------------------------------------------------------------------

    def info(self) -> dict[str, Any]:
        return {"hostname": HOSTNAME, "confirm_name": self.settings.hostname_confirm or HOSTNAME, "mock": True, "gpio_available": True,
                "shell_url": self.settings.shell_url or "http://127.0.0.1:8121", "access_configured": False,
                "scenario": self.scenario, "features": ["events", "updates", "agent_update", "container_restart"]}

    async def overview(self) -> dict[str, Any]:
        snap, m, smart = self._snapshot(), self._mounts(), self._smart()
        services, containers, sites, backups = self._services(), self._containers(), self._sites(), self._backups()
        return {
            "ts": int(time.time()),
            "health": compute_health(snap, m, smart, services, containers, sites, backups),
            "disk_alarms": disk_alarms(smart), "system": snap, "mounts": m,
            "smart": [{"device": s["device"], "status": s["status"], "model": s.get("model")} for s in smart],
            "counts": counts(services, containers, sites, backups),
        }

    def device(self) -> dict[str, Any]:
        return {"hostname": HOSTNAME, "model": "Raspberry Pi 5 Model B Rev 1.0", "serial": "a1b2c3d4",
                "os": "Debian GNU/Linux 13 (trixie)", "kernel": "6.12.47+rpt-rpi-2712", "arch": "aarch64", "python": "3.13.5",
                "cpu_cores": 4, "memory_total": 8 * GB,
                "addresses": [{"interface": "eth0", "address": "192.168.1.50"}], "boot_time": int(self.boot)}

    async def disks(self) -> dict[str, Any]:
        smart = self._smart()
        return {"mounts": self._mounts(), "smart": smart, "disk_alarms": disk_alarms(smart)}

    async def acknowledge_crc(self) -> None:
        return None

    async def services(self, filt: str, q: str | None) -> list[dict[str, Any]]:
        out = []
        for s in self._services():
            if filt == "custom" and not s.get("custom"):
                continue
            if filt == "failed" and s["active"] != "failed":
                continue
            if filt == "active" and s["active"] != "active":
                continue
            if q and q.lower() not in s["name"].lower() and q.lower() not in s["description"].lower():
                continue
            out.append(s)
        return out

    async def service_logs(self, name: str, lines: int) -> list[dict[str, Any]]:
        if name not in {s["name"] for s in self._services()}:
            raise api_error(404, "not_found", "Onbekende dienst")
        now = int(time.time())
        msgs = [("info", "GET /api/health 200 3ms"), ("info", "Worker heartbeat ok"), ("notice", L("Cache vernieuwd (412 items)", "Cache refreshed (412 items)")),
                ("info", "POST /api/events 201 48ms"), ("warning", L("Trage query: 812 ms op events", "Slow query: 812 ms on events")), ("info", "GET /api/stats 200 12ms")]
        if name.removesuffix(".service") in self.failed_services:
            msgs += [("err", "Error: connect ECONNREFUSED 127.0.0.1:1883"), ("err", "Main process exited, code=exited, status=1/FAILURE")]
        out = []
        for i in range(lines):
            lvl, m = msgs[i % len(msgs)] if i < lines - 2 else msgs[-(lines - i)]
            out.append({"ts": now - (lines - i) * 17, "level": lvl, "message": m})
        return out

    def containers(self) -> dict[str, Any]:
        deny = self.config.container_restart_allowed
        return {"containers": [{**c, "restart_allowed": deny(c["name"])} for c in self._containers()], "updated_at": int(time.time()) - 12, "error": None}

    # Onderhoud ---------------------------------------------------------------

    def _apt(self) -> dict[str, Any]:
        return {"checked_at": self.apt_checked_at, "count": len(self.apt_packages), "security_count": sum(1 for p in self.apt_packages if p["security"]),
                "packages": self.apt_packages, "reboot_required": False, "error": None}

    def _conditions(self) -> dict[str, dict[str, Any]]:
        return conditions(self._smart(), self._services(), self._containers(), self._sites(), self._apt())

    def events(self, since: int, limit: int) -> dict[str, Any]:
        self.events_store.sync(self._conditions())
        return self.events_store.list(since, limit)

    async def updates(self) -> dict[str, Any]:
        alarms = disk_alarms(self._smart())
        blocked = L(f"Schijf {alarms[0]['device']} toont tekenen van falen. Eerst een back-up maken, daarna pas updates installeren.",
                    f"Disk {alarms[0]['device']} shows signs of failure. Back up first, install updates afterwards.") if alarms else None
        return {**self._apt(), "allowed": self.config.allow("updates"), "checking": False, "upgrade": dict(self.apt_run), "blocked_reason": blocked}

    async def updates_check(self) -> dict[str, Any]:
        self.apt_checked_at = int(time.time())
        return {"ok": True, "message": L("Controle gestart", "Check started")}

    async def updates_install(self) -> dict[str, Any]:
        if disk_alarms(self._smart()):
            raise api_error(409, "conflict", L("Schijf toont tekenen van falen. Eerst een back-up maken.", "Disk shows signs of failure. Back up first."))
        if self.apt_run["running"]:
            raise api_error(409, "conflict", L("Er loopt al een update", "An update is already running"))
        now = int(time.time())
        pkgs = list(self.apt_packages)
        self.apt_run = {"running": True, "state": "activating", "result": None, "exit_status": None, "started_at": now, "finished_at": None,
                        "log": ["Reading package lists...", f"{len(pkgs)} upgraded, 0 newly installed, 0 to remove"]}

        async def finish() -> None:
            await asyncio.sleep(4)
            self.apt_run["log"] += [f"Setting up {p['name']} ({p['to']}) ..." for p in pkgs] + ["Done"]
            self.apt_run.update(running=False, state="inactive", result="success", exit_status=0, finished_at=int(time.time()))
            self.apt_packages = []

        asyncio.get_running_loop().create_task(finish())
        return {"ok": True, "message": L("Updates worden geïnstalleerd", "Installing updates")}

    async def agent_update(self, force: bool = False) -> dict[str, Any]:
        avail = (parse_version(self.latest_version) or (0, 0, 0)) > (parse_version(VERSION) or (0, 0, 0))
        return {"current": VERSION, "latest": self.latest_version, "tag": f"v{self.latest_version}",
                "url": "https://github.com/NexaiGuy/nex-pi-control/releases", "notes": L("Kleine verbeteringen en fixes.", "Small improvements and fixes."),
                "error": None, "update_available": avail, "allowed": self.config.allow("agent_update"), "run": dict(self.agent_run)}

    async def agent_update_start(self) -> dict[str, Any]:
        st = await self.agent_update()
        if not st["update_available"]:
            raise api_error(409, "conflict", L("Je hebt al de nieuwste versie", "You already have the latest version"))
        now = int(time.time())
        self.agent_run = {"running": True, "state": "activating", "result": None, "exit_status": None, "started_at": now, "finished_at": None,
                          "log": [f"Downloading v{self.latest_version}", "Backup: /opt/hal-agent-backups/premigrate-demo"]}

        async def finish() -> None:
            await asyncio.sleep(4)
            self.agent_run["log"] += ["hal-agent restarted and healthy", f"Updated to {self.latest_version}"]
            self.agent_run.update(running=False, state="inactive", result="success", exit_status=0, finished_at=int(time.time()))

        asyncio.get_running_loop().create_task(finish())
        return {"ok": True, "message": L(f"Update naar {self.latest_version} gestart. De agent herstart zo meteen.", f"Update to {self.latest_version} started. The agent restarts shortly.")}

    async def container_restart(self, ref: str) -> dict[str, Any]:
        c = next((x for x in self._containers() if ref in (x["id"], x["name"])), None)
        if not c:
            raise api_error(404, "not_found", "Onbekende container")
        if not self.config.container_restart_allowed(c["name"]):
            raise api_error(403, "forbidden", L("Herstarten van deze container staat uit in allowed-actions.yml", "Restarting this container is disabled in allowed-actions.yml"))
        await asyncio.sleep(0.5)
        self.fixed_containers.add(c["name"])
        return {"ok": True, "name": c["name"], "output": [c["name"]], "message": L(f"{c['name']} herstart", f"{c['name']} restarted")}

    async def container_logs(self, ref: str, lines: int) -> list[str]:
        if ref not in {c["id"] for c in self._containers()} | {c["name"] for c in self._containers()}:
            raise api_error(404, "not_found", "Onbekende container")
        now = time.time()
        return [f"{time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(now - (lines - i) * 9))}.000000000Z INFO request handled in {5 + i % 40}ms"
                for i in range(lines)]

    def sites(self) -> dict[str, Any]:
        return {"sites": self._sites(), "updated_at": int(time.time()) - 20}

    def processes(self, sort: str, limit: int, q: str | None) -> list[dict[str, Any]]:
        names = ["python3", "postgres", "node", "dockerd", "cloudflared", "nginx", "ollama", "redis-server", "containerd", "uvicorn",
                 "systemd", "journald", "sshd", "fail2ban-server", "bash", "arq", "gunicorn", "chromium", "qdrant", "haproxy"]
        rows = []
        for i in range(80):
            n = names[i % len(names)]
            rows.append({"pid": 100 + i * 23, "name": n, "user": "root" if i % 4 == 0 else ("pi" if i % 4 == 1 else "www-data"),
                         "status": "running" if i % 9 == 0 else "sleeping",
                         "cpu_percent": round(_wave(time.time(), 120 + i, 0, 18 if i < 6 else 2, i), 1),
                         "memory_bytes": (300 - i * 3) * 1024 * 1024, "memory_percent": round((300 - i * 3) / 81.92, 2),
                         "threads": 1 + i % 12, "started_at": int(self.boot + i * 60),
                         "command": f"/usr/bin/{n} --config /etc/{n}/{n}.conf"})
        if q:
            rows = [r for r in rows if q.lower() in r["name"] or q == str(r["pid"])]
        key = {"cpu": "cpu_percent", "mem": "memory_bytes", "pid": "pid", "name": "name"}.get(sort, "cpu_percent")
        rows.sort(key=lambda r: r[key], reverse=key not in ("pid", "name"))
        return rows[:limit] if limit else rows

    def backups(self) -> list[dict[str, Any]]:
        return self._backups()

    def ports(self) -> dict[str, Any]:
        reg = [{"port": 8080, "address": "127.0.0.1", "service": "nextcloud", "listening": True},
               {"port": 8096, "address": "127.0.0.1", "service": "jellyfin", "listening": True},
               {"port": 8123, "address": "127.0.0.1", "service": "home-assistant", "listening": True},
               {"port": 5678, "address": "127.0.0.1", "service": "n8n", "listening": self.scenario == "ok"},
               {"port": 8120, "address": "127.0.0.1", "service": "hal-agent", "listening": True},
               {"port": 8121, "address": "127.0.0.1", "service": "hal-shell", "listening": self.shell_active_since is not None},
               {"port": 2375, "address": "127.0.0.1", "service": "docker-socket-proxy", "listening": True},
               {"port": 5432, "address": "127.0.0.1", "service": "postgres 16", "listening": True},
               {"port": 11434, "address": "127.0.0.1", "service": "ollama", "listening": True}]
        return {"registry": reg, "unregistered_listening": [9100], "error": None}

    def gpio_state(self) -> dict[str, Any]:
        allowed = self.config.gpio_allowed() or {17, 27, 22, 23, 24, 25, 5, 6, 16, 26}
        labels = self.config.gpio_labels() or {17: "Relais kast", 27: "Status-LED"}
        pins = []
        for p in PINOUT:
            e = dict(p)
            b = p.get("bcm")
            if b is not None:
                e.update({"label": labels.get(b), "allowed": b in allowed, "mode": "out" if b in self.gpio_values else "in",
                          "value": self.gpio_values.get(b), "owner": "hal-agent" if b in self.gpio_values else None, "pulsing": False})
                if b in (2, 3):
                    e.update({"allowed": False, "owner": "i2c_bcm2835", "protected_reason": L("In gebruik door I2C", "In use by I2C")})
                if b in (0, 1):
                    e.update({"allowed": False, "protected_reason": "HAT-EEPROM"})
            pins.append(e)
        return {"available": True, "error": None, "pins": pins}

    async def gpio_action(self, pin: int, action: str, duration_ms: int) -> dict[str, Any]:
        allowed = self.config.gpio_allowed() or {17, 27, 22, 23, 24, 25, 5, 6, 16, 26}
        if pin not in allowed:
            raise api_error(403, "forbidden", f"GPIO{pin} staat niet in allowed_pins van gpio.yml")
        if action in ("on", "off"):
            self.gpio_values[pin] = 1 if action == "on" else 0
            return {"pin": pin, "value": self.gpio_values[pin]}
        if action == "pulse":
            before = self.gpio_values.get(pin, 0)
            self.gpio_values[pin] = 1 - before
            await asyncio.sleep(min(duration_ms, 3000) / 1000)
            self.gpio_values[pin] = before
            return {"pin": pin, "value": before, "pulsed_ms": duration_ms}
        if action == "read":
            return {"pin": pin, "value": self.gpio_values.get(pin, 0), "mode": "out" if pin in self.gpio_values else "in"}
        if action == "release":
            self.gpio_values.pop(pin, None)
            return {"pin": pin, "released": True}
        raise api_error(400, "bad_request", "Onbekende actie")

    def sensors(self) -> dict[str, Any]:
        t = time.time()
        return {"sensors": [
            {"id": "kast", "name": L("Serverkast", "Server rack"), "type": "dht", "values": {"temp": self._metric_value("sensor.kast.temp", t),
             "humidity": self._metric_value("sensor.kast.humidity", t)}, "error": None, "ts": int(t) - 30},
            {"id": "buiten", "name": L("Buiten", "Outside"), "type": "ds18b20", "values": {"temp": self._metric_value("sensor.buiten.temp", t)},
             "error": None, "ts": int(t) - 30},
            {"id": "druk", "name": L("Luchtdruk bureau", "Office pressure"), "type": "bmp280", "values": None, "error": L("I2C-adres 0x76 antwoordt niet", "I2C address 0x76 does not respond"), "ts": None},
        ], "discovered": {"ds18b20": ["28-3c01d607a1b2"], "iio": ["iio:device0"], "i2c_buses": ["i2c-1"]}}

    def commands(self) -> list[dict[str, Any]]:
        cmds = self.config.command_list() or [
            {"id": "apt-update", "name": L("Pakketlijst vernieuwen", "Refresh package lists"), "description": L("apt update, toont beschikbare updates", "apt update, shows available upgrades"), "icon": "package",
             "dangerous": False, "timeout": 300, "effect": L("Leest enkel de pakketlijsten opnieuw in.", "Only re-reads the package lists.")},
            {"id": "docker-prune", "name": L("Docker opruimen", "Docker clean-up"), "description": L("Verwijdert ongebruikte images en build cache", "Removes unused images and build cache"), "icon": "trash",
             "dangerous": True, "timeout": 600, "effect": L("Ongebruikte images worden definitief verwijderd.", "Unused images are permanently deleted.")},
            {"id": "backup-now", "name": L("Backup nu draaien", "Run backup now"), "description": L("Start de nachtelijke backup meteen", "Starts the nightly backup right away"), "icon": "archive",
             "dangerous": False, "timeout": 900, "effect": L("Kan 2 tot 5 minuten extra schijfbelasting geven.", "May add 2 to 5 minutes of disk load.")},
        ]
        for c in cmds:
            c["last_run"] = self.audit_log.last(f"command:{c['id']}")
        return cmds

    async def run_command(self, cmd_id: str) -> dict[str, Any]:
        if cmd_id not in {c["id"] for c in self.commands()}:
            raise api_error(404, "not_found", "Onbekend commando")
        await asyncio.sleep(1.2)
        return {"ok": True, "output": [f"[demo] {cmd_id}", "Reading package lists...", "12 packages can be upgraded.", "Done."], "reason": ""}

    def wol_devices(self) -> list[dict[str, Any]]:
        devs = self.config.wol_devices() or [
            {"id": "desktop", "name": "Desktop PC", "mac": "3C:7C:3F:12:34:56", "broadcast": "192.168.1.255", "port": 9},
            {"id": "nas", "name": "NAS", "mac": "00:11:32:AB:CD:EF", "broadcast": "192.168.1.255", "port": 9},
        ]
        for d in devs:
            d["last_woken"] = self.audit_log.last(f"wol:{d['id']}")
        return devs

    async def wol_send(self, dev_id: str) -> dict[str, Any]:
        dev = next((d for d in self.wol_devices() if d["id"] == dev_id), None)
        if not dev:
            raise api_error(404, "not_found", "Onbekend apparaat")
        return {"ok": True, "device": dev["name"]}

    async def audit(self, limit: int) -> list[dict[str, Any]]:
        rows = self.audit_log.recent(limit)
        if not rows:
            now = int(time.time())
            rows = [
                {"ts": now - 3600, "actor": "pi-control-app", "ip": "203.0.113.24", "action": "restart-service", "target": "home-assistant.service", "result": "ok", "detail": "", "source": "agent"},
                {"ts": now - 7200, "actor": "pi-control-app", "ip": "203.0.113.24", "action": "terminal:input", "target": "terminal", "result": "ok", "detail": "docker ps", "source": "shell"},
                {"ts": now - 86400, "actor": "pi-control-app", "ip": "203.0.113.24", "action": "command:backup-now", "target": "backup-now", "result": "ok", "detail": "", "source": "agent"},
            ]
        return rows

    def restart_allowed(self) -> list[str]:
        return self.config.restart_units()

    async def restart_service(self, name: str) -> dict[str, Any]:
        if name not in self.config.restart_units():
            raise api_error(403, "forbidden", "Deze dienst staat niet in allowed-actions.yml")
        await asyncio.sleep(1.0)
        self.failed_services.discard(name.removesuffix(".service"))
        return {"ok": True, "message": L(f"{name} herstart", f"{name} restarted")}

    async def power(self, action: str) -> dict[str, Any]:
        return {"ok": True, "message": L("[demo] De server zou nu herstarten", "[demo] The server would restart now") if action == "reboot" else L("[demo] De server zou nu uitschakelen", "[demo] The server would shut down now")}

    async def shell_state(self) -> dict[str, Any]:
        active = self.shell_active_since is not None
        return {"active": active, "state": "active" if active else "inactive",
                "active_seconds": int(time.time() - self.shell_active_since) if active else None,
                "url": self.settings.shell_url or "http://127.0.0.1:8121", "idle_timeout_seconds": 900}

    async def shell_start(self) -> dict[str, Any]:
        self.shell_active_since = time.time()
        return {"ok": True, "message": L("Beheermodus gestart", "Admin mode started")}

    async def shell_stop(self) -> dict[str, Any]:
        self.shell_active_since = None
        return {"ok": True, "message": L("Beheermodus gestopt", "Admin mode stopped")}

    def stats_metrics(self) -> list[dict[str, str]]:
        names = set(METRIC_CATALOG) | {f"cpu.core{i}" for i in range(4)} | {f"disk.usage:{m['mountpoint']}" for m in self._mounts()}
        names |= {f"site.{h}.latency" for h, _ in SITES} | {"sensor.kast.temp", "sensor.kast.humidity", "sensor.buiten.temp"}
        return [describe_metric(m) for m in sorted(names)]

    def stats_history(self, metric: str, range_key: str) -> dict[str, Any]:
        seconds, _table, bucket = RANGES[range_key]
        now = int(time.time())
        start = now - seconds
        start -= start % bucket
        points = []
        for ts in range(start, now, bucket):
            v = self._metric_value(metric, ts)
            if v is None:
                continue
            spread = abs(v) * 0.08 if bucket > 10 else 0
            points.append([ts, round(v, 3), round(v - spread, 3), round(v + spread, 3)])
        return {"metric": metric, "range": range_key, "bucket_seconds": bucket, "points": points,
                "summary": summarize(points, self._metric_value(metric, now)), **describe_metric(metric)}

    def stats_csv(self, metric: str, range_key: str) -> str:
        d = self.stats_history(metric, range_key)
        lines = ["timestamp_utc,gemiddelde,minimum,maximum"]
        for ts, a, mn, mx in d["points"]:
            lines.append(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(ts))},{a},{mn},{mx}")
        return "\n".join(lines) + "\n"
