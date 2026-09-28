"""De echte backend op de Pi: verbindt collectors, achtergrondlussen, statistieken en acties."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from hal_common.i18n import L, tr
from hal_common.web import api_error, run

from . import actions
from .audit import AuditLog, parse_shell_audit
from .collectors import misc
from .collectors.containers import ContainerCollector
from .collectors.gpio import GpioManager, GpioUnavailable, discover_sensors, read_sensor
from .collectors.services import ServiceCollector
from .collectors.sites import SiteChecker
from .collectors.smart import SmartStore
from .collectors.system import SystemSampler, device_info, mounts
from .config import ConfigFiles, Settings
from .health import compute_health, counts, disk_alarms
from .history import METRIC_CATALOG, HistoryStore, describe_metric

log = logging.getLogger("hal.backend")


class RealBackend:
    mock = False

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.config = ConfigFiles(settings.config_dir)
        settings.state_dir.mkdir(parents=True, exist_ok=True)
        self.audit_log = AuditLog(settings.state_dir / "audit.db")
        self.history = HistoryStore(settings.state_dir / "history.db")
        self.sampler = SystemSampler()
        self.smart = SmartStore(settings.state_dir / "smart", settings.state_dir / "smart-crc.json")
        self.services_c = ServiceCollector()
        self.containers_c = ContainerCollector(settings.docker_proxy)
        self.sites_c = SiteChecker()
        self.processes_c = ProcessHolder()
        self.gpio = GpioManager()
        self.sensor_values: dict[str, dict[str, Any]] = {}
        self._backups_cache: tuple[float, list] | None = None
        self._services_snapshot: list[dict[str, Any]] = []
        self._tasks: list[asyncio.Task] = []
        self._pending: set[asyncio.Task] = set()

    # Levenscyclus -----------------------------------------------------------

    async def start(self) -> None:
        self._tasks = [
            asyncio.create_task(self._loop_fast(), name="fast"),
            asyncio.create_task(self._loop_every(30, self._refresh_containers), name="containers"),
            asyncio.create_task(self._loop_every(60, self._refresh_sites), name="sites"),
            asyncio.create_task(self._loop_every(30, self._refresh_services), name="services"),
            asyncio.create_task(self._loop_every(60, self._refresh_sensors), name="sensors"),
            asyncio.create_task(self._loop_every(60, self._maintain), name="maintain"),
        ]

    async def stop(self) -> None:
        for t in self._tasks + list(self._pending):
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self.gpio.close()
        self.history.close()

    async def _loop_every(self, seconds: float, fn) -> None:
        while True:
            try:
                await fn()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Achtergrondtaak %s faalde", getattr(fn, "__name__", fn))
            await asyncio.sleep(seconds)

    async def _loop_fast(self) -> None:
        tick = 0
        while True:
            try:
                self.sampler.sample()
                if tick % 5 == 0:  # elke 10 s
                    values = self.sampler.history_values()
                    if tick % 30 == 0:  # elke 60 s
                        for m in mounts():
                            values[f"disk.usage:{m['mountpoint']}"] = m["percent"]
                        values.update(self.sites_c.history_values())
                        for sid, sv in self.sensor_values.items():
                            for k, v in (sv.get("values") or {}).items():
                                values[f"sensor.{sid}.{k}"] = v
                    cached = self.containers_c.cached()["containers"]
                    if cached:
                        values["containers.running"] = sum(1 for c in cached if c["state"] == "running")
                    if self._services_snapshot:
                        values["services.failed"] = sum(1 for s in self._services_snapshot if s["active"] == "failed")
                    await asyncio.to_thread(self.history.write, int(time.time()), values)
                    await asyncio.to_thread(self.processes_c.prime)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Meting faalde")
            tick += 1
            await asyncio.sleep(2)

    async def _refresh_containers(self) -> None:
        await self.containers_c.refresh()

    async def _refresh_sites(self) -> None:
        await self.sites_c.refresh(self.config.site_list())

    async def _refresh_services(self) -> None:
        self._services_snapshot = await self.services_c.list(force=True)

    async def _refresh_sensors(self) -> None:
        for s in self.config.sensor_list():
            try:
                vals = await asyncio.to_thread(read_sensor, s)
                self.sensor_values[s["id"]] = {"values": vals, "error": None, "ts": int(time.time())}
            except Exception as exc:  # hardwarefouten mogen de lus niet stoppen
                prev = self.sensor_values.get(s["id"], {})
                self.sensor_values[s["id"]] = {"values": prev.get("values"), "error": str(exc)[:200], "ts": prev.get("ts")}

    async def _maintain(self) -> None:
        await asyncio.to_thread(self.history.maintain)

    def _spawn(self, coro) -> None:
        t = asyncio.create_task(coro)
        self._pending.add(t)
        t.add_done_callback(self._pending.discard)

    # Lezen -----------------------------------------------------------------

    def info(self) -> dict[str, Any]:
        return {
            "hostname": device_info()["hostname"],
            "confirm_name": self.settings.hostname_confirm or device_info()["hostname"],
            "mock": False,
            "gpio_available": self.gpio.available,
            "shell_url": self.settings.shell_url,
            "access_configured": bool(self.settings.team_domain and self.settings.aud),
        }

    def _backups(self) -> list[dict[str, Any]]:
        if self._backups_cache and time.monotonic() - self._backups_cache[0] < 300:
            return self._backups_cache[1]
        data = misc.backups(self.settings.backup_roots)
        self._backups_cache = (time.monotonic(), data)
        return data

    async def overview(self) -> dict[str, Any]:
        snap = self.sampler.snapshot
        m = mounts()
        smart = self.smart.read_all()
        services = self._services_snapshot or await self.services_c.list()
        containers = self.containers_c.cached()["containers"]
        sites = list(self.sites_c.results.values())
        backups = await asyncio.to_thread(self._backups)
        return {
            "ts": int(time.time()),
            "health": compute_health(snap, m, smart, services, containers, sites, backups),
            "disk_alarms": disk_alarms(smart),
            "system": snap,
            "mounts": m,
            "smart": [{"device": s.get("device"), "status": s.get("status"), "model": s.get("model")} for s in smart],
            "counts": counts(services, containers, sites, backups),
        }

    def device(self) -> dict[str, Any]:
        return device_info()

    async def disks(self) -> dict[str, Any]:
        smart = self.smart.read_all()
        return {"mounts": mounts(), "smart": smart, "disk_alarms": disk_alarms(smart)}

    async def acknowledge_crc(self) -> None:
        self.smart.acknowledge_crc()

    async def services(self, filt: str, q: str | None) -> list[dict[str, Any]]:
        items = await self.services_c.list()
        allowed = set(self.config.restart_units())
        out = []
        for s in items:
            if filt == "custom" and not s.get("custom"):
                continue
            if filt == "failed" and s["active"] != "failed":
                continue
            if filt == "active" and s["active"] != "active":
                continue
            if q and q.lower() not in s["name"].lower() and q.lower() not in s["description"].lower():
                continue
            out.append({**s, "restart_allowed": s["name"] in allowed})
        return out

    async def service_logs(self, name: str, lines: int) -> list[dict[str, Any]]:
        if name not in await self.services_c.names():
            raise api_error(404, "not_found", "Onbekende dienst")
        return await self.services_c.logs(name, lines)

    def containers(self) -> dict[str, Any]:
        return self.containers_c.cached()

    async def container_logs(self, ref: str, lines: int) -> list[str]:
        cid = self.containers_c.resolve(ref)
        if not cid:
            raise api_error(404, "not_found", "Onbekende container")
        try:
            return await self.containers_c.logs(cid, lines)
        except Exception:
            raise api_error(503, "unavailable", "Docker-proxy onbereikbaar")

    def sites(self) -> dict[str, Any]:
        return {"sites": sorted(self.sites_c.results.values(), key=lambda s: s["hostname"]), "updated_at": self.sites_c.updated_at}

    def processes(self, sort: str, limit: int, q: str | None) -> list[dict[str, Any]]:
        return self.processes_c.collector.list(sort=sort, limit=limit, query=q)

    def backups(self) -> list[dict[str, Any]]:
        return self._backups()

    def ports(self) -> dict[str, Any]:
        return misc.ports(self.settings.ports_file)

    def gpio_state(self) -> dict[str, Any]:
        return self.gpio.state(self.config.gpio_allowed(), self.config.gpio_labels())

    async def gpio_action(self, pin: int, action: str, duration_ms: int) -> dict[str, Any]:
        if pin not in self.config.gpio_allowed() or pin in (0, 1):
            raise api_error(403, "forbidden", L(f"GPIO{pin} staat niet in allowed_pins van gpio.yml", f"GPIO{pin} is not listed in allowed_pins in gpio.yml"))
        try:
            if action == "on":
                return self.gpio.set(pin, 1)
            if action == "off":
                return self.gpio.set(pin, 0)
            if action == "pulse":
                return await self.gpio.pulse(pin, duration_ms)
            if action == "read":
                return self.gpio.read(pin)
            if action == "release":
                self.gpio.release(pin)
                return {"pin": pin, "released": True}
        except GpioUnavailable as exc:
            raise api_error(409, "conflict", tr(str(exc)))
        except OSError as exc:
            raise api_error(409, "conflict", L(f"GPIO{pin} is bezet of niet toegankelijk: {exc.strerror or exc}", f"GPIO{pin} is busy or not accessible: {exc.strerror or exc}"))
        raise api_error(400, "bad_request", "Onbekende actie")

    def sensors(self) -> dict[str, Any]:
        out = []
        for s in self.config.sensor_list():
            v = self.sensor_values.get(s["id"], {})
            out.append({"id": s["id"], "name": s.get("name") or s["id"], "type": s["type"],
                        "values": v.get("values"), "error": v.get("error"), "ts": v.get("ts")})
        return {"sensors": out, "discovered": discover_sensors()}

    def commands(self) -> list[dict[str, Any]]:
        cmds = self.config.command_list()
        for c in cmds:
            c["last_run"] = self.audit_log.last(f"command:{c['id']}")
        return cmds

    async def run_command(self, cmd_id: str) -> dict[str, Any]:
        cmd = next((c for c in self.config.command_list() if c["id"] == cmd_id), None)
        if not cmd:
            raise api_error(404, "not_found", "Onbekend commando")
        ok, lines, reason = await actions.run_oneshot(actions.command_unit(cmd_id), cmd["timeout"])
        return {"ok": ok, "output": lines, "reason": reason}

    def wol_devices(self) -> list[dict[str, Any]]:
        devs = self.config.wol_devices()
        for d in devs:
            d["last_woken"] = self.audit_log.last(f"wol:{d['id']}")
        return devs

    async def wol_send(self, dev_id: str) -> dict[str, Any]:
        dev = next((d for d in self.config.wol_devices() if d["id"] == dev_id), None)
        if not dev:
            raise api_error(404, "not_found", "Onbekend apparaat")
        await asyncio.to_thread(misc.send_wol, dev["mac"], dev["broadcast"], dev["port"])
        return {"ok": True, "device": dev["name"]}

    async def audit(self, limit: int) -> list[dict[str, Any]]:
        rows = self.audit_log.recent(limit)
        r = await run(["journalctl", "--no-pager", "-t", "hal-shell-audit", "-o", "json", "-n", str(limit)], timeout=10)
        rows += parse_shell_audit(r.stdout)
        rows.sort(key=lambda x: x["ts"], reverse=True)
        return rows[:limit]

    def restart_allowed(self) -> list[str]:
        return self.config.restart_units()

    async def restart_service(self, name: str) -> dict[str, Any]:
        if name not in self.config.restart_units():
            raise api_error(403, "forbidden", "Deze dienst staat niet in allowed-actions.yml")
        if name not in await self.services_c.names():
            raise api_error(404, "not_found", "Onbekende dienst")
        ok, msg = await actions.restart_unit(name)
        self.services_c.invalidate()
        return {"ok": ok, "message": msg}

    async def power(self, action: str) -> dict[str, Any]:
        self._spawn(actions.power(action))
        name = device_info()["hostname"]
        return {"ok": True, "message": L(f"{name} herstart over 3 s", f"{name} restarts in 3 s") if action == "reboot" else L(f"{name} schakelt uit over 3 s", f"{name} shuts down in 3 s")}

    async def shell_state(self) -> dict[str, Any]:
        st = await actions.unit_state(actions.SHELL_UNIT)
        return {**st, "url": self.settings.shell_url, "idle_timeout_seconds": 900}

    async def shell_start(self) -> dict[str, Any]:
        ok, msg = await actions.start_unit(actions.SHELL_UNIT)
        return {"ok": ok, "message": msg or (L("Beheermodus gestart", "Admin mode started") if ok else L("Starten mislukt", "Start failed"))}

    async def shell_stop(self) -> dict[str, Any]:
        ok, msg = await actions.stop_unit(actions.SHELL_UNIT)
        return {"ok": ok, "message": msg or (L("Beheermodus gestopt", "Admin mode stopped") if ok else L("Stoppen mislukt", "Stop failed"))}

    # Statistieken -----------------------------------------------------------

    def stats_metrics(self) -> list[dict[str, str]]:
        names = set(self.history.metrics()) | set(METRIC_CATALOG)
        return [describe_metric(m) for m in sorted(names)]

    def stats_history(self, metric: str, range_key: str) -> dict[str, Any]:
        return {**self.history.query(metric, range_key), **describe_metric(metric)}

    def stats_csv(self, metric: str, range_key: str) -> str:
        return self.history.export_csv(metric, range_key)


class ProcessHolder:
    def __init__(self) -> None:
        self.collector = misc.ProcessCollector()

    def prime(self) -> None:
        self.collector.prime()
